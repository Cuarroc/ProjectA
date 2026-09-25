//! Bounded, run-scoped record traversal for the compact agent briefing.
use super::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    version: u8,
    run: String,
    collection: String,
    after: i64,
    through: i64,
}

pub(in crate::store) async fn apply_page_migration(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<(), String> {
    sqlx::query("CREATE TABLE development_record_order(sequence INTEGER PRIMARY KEY AUTOINCREMENT, collection TEXT NOT NULL CHECK(collection IN ('evidence','reviews')), record_id TEXT NOT NULL, run_id TEXT NOT NULL, UNIQUE(collection,record_id))")
        .execute(&mut **tx).await.map_err(db("create record order"))?;
    sqlx::query("CREATE INDEX development_record_order_run ON development_record_order(run_id,collection,sequence)")
        .execute(&mut **tx).await.map_err(db("index record order"))?;
    for (collection, table) in [
        ("evidence", "development_run_evidence"),
        ("reviews", "development_run_reviews"),
    ] {
        sqlx::query(&format!("INSERT INTO development_record_order(collection,record_id,run_id) SELECT '{collection}',id,run_id FROM {table} ORDER BY observed_at,id"))
            .execute(&mut **tx).await.map_err(db("backfill record order"))?;
        sqlx::query(&format!("CREATE TRIGGER development_{collection}_order AFTER INSERT ON {table} BEGIN INSERT INTO development_record_order(collection,record_id,run_id) VALUES('{collection}',NEW.id,NEW.run_id); END"))
            .execute(&mut **tx).await.map_err(db("bind record order inserts"))?;
    }
    Ok(())
}

impl Store {
    pub async fn agent_record_page(
        &self,
        run: &str,
        owner: &str,
        fence: i64,
        collection: &str,
        cursor: Option<&str>,
    ) -> Result<Value, String> {
        // Table and projection are closed constants, never interpolated input.
        let (table, projection) = match collection {
            "evidence" => ("development_run_evidence", "json_object('id',id,'source',source,'observedAt',observed_at,'candidateCommit',candidate_commit,'invalidatedAt',invalidated_at,'invalidatedByCommit',invalidated_by_commit)"),
            "reviews" => ("development_run_reviews", "json_object('id',id,'evidenceId',evidence_id,'source',source,'observedAt',observed_at,'candidateCommit',candidate_commit,'disposition',disposition,'reviewerIdentity',reviewer_identity,'reviewerAttestation',reviewer_attestation,'approvalEligible',json(CASE WHEN approval_eligible THEN 'true' ELSE 'false' END),'status',status,'invalidatedAt',invalidated_at,'invalidatedByCommit',invalidated_by_commit)"),
            _ => return Err("unknown record collection".into()),
        };
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(db("begin scoped record page"))?;
        require_run_authority(&mut tx, run, owner, fence).await?;
        let (maximum,): (i64,) = sqlx::query_as(
            "SELECT COALESCE(MAX(sequence),0) FROM development_record_order WHERE run_id = ? AND collection = ?"
        )
        .bind(run)
        .bind(collection)
        .fetch_one(&mut *tx)
        .await
        .map_err(db("read page boundary"))?;
        let mut cursor = match cursor {
            None => Cursor {
                version: 1,
                run: run.into(),
                collection: collection.into(),
                after: 0,
                through: maximum,
            },
            Some(encoded) => {
                if encoded.len() > 1024 {
                    return Err("invalid record cursor".into());
                }
                let bytes = URL_SAFE_NO_PAD
                    .decode(encoded)
                    .map_err(|_| "invalid record cursor")?;
                let cursor: Cursor =
                    serde_json::from_slice(&bytes).map_err(|_| "invalid record cursor")?;
                if cursor.version != 1
                    || cursor.run != run
                    || cursor.collection != collection
                    || cursor.after < 0
                    || cursor.through < cursor.after
                    || cursor.through > maximum
                {
                    return Err("invalid or mismatched record cursor".into());
                }
                cursor
            }
        };
        // Explicit INTEGER PRIMARY KEY sequence survives VACUUM and restart;
        // unlike implicit rowids on the existing TEXT-primary-key tables.
        let from = format!("FROM {table} record JOIN development_record_order ordering ON ordering.record_id = record.id AND ordering.run_id = record.run_id AND ordering.collection = ? WHERE record.run_id = ?");
        let (total,): (i64,) = sqlx::query_as(&format!(
            "SELECT COUNT(*) {from} AND ordering.sequence <= ?"
        ))
        .bind(collection)
        .bind(run)
        .bind(cursor.through)
        .fetch_one(&mut *tx)
        .await
        .map_err(db("count scoped records"))?;
        let mut rows: Vec<(i64, String)> = sqlx::query_as(&format!("SELECT ordering.sequence, {projection} {from} AND ordering.sequence > ? AND ordering.sequence <= ? ORDER BY ordering.sequence LIMIT 33"))
            .bind(collection).bind(run).bind(cursor.after).bind(cursor.through).fetch_all(&mut *tx).await.map_err(db("read scoped record page"))?;
        let has_more = rows.len() > 32;
        rows.truncate(32);
        let mut items = Vec::with_capacity(rows.len());
        for (position, json) in rows {
            cursor.after = position;
            items.push(
                serde_json::from_str::<Value>(&json)
                    .map_err(|e| format!("invalid record projection: {e}"))?,
            );
        }
        let next_cursor = if has_more {
            Some(URL_SAFE_NO_PAD.encode(serde_json::to_vec(&cursor).map_err(|e| e.to_string())?))
        } else {
            None
        };
        tx.commit().await.map_err(db("commit scoped record page"))?;
        // A bounded insertion set, not a historical snapshot: invalidation is
        // always reported as currently recorded in this page's read transaction.
        Ok(
            serde_json::json!({"apiVersion":1,"source":"rust/sqlite","sourceTimestamp":now_unix_secs(),
            "runId":run,"collection":collection,"items":items,"limit":32,"total":total,
            "nextCursor":next_cursor,"consistency":"bounded-insertions-current-state"}),
        )
    }
}
