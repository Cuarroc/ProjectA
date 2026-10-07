use super::Store;

impl Store {
    /// One application setting, or `None` when nobody has written it. The
    /// callers in [`crate::learnings`] decide what a missing key means; the
    /// store only reports its absence.
    pub async fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?1")
            .bind(key)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| format!("failed to read setting: {e}"))?;
        Ok(row.map(|(value,)| value))
    }

    /// Write a setting, replacing whatever was there. Toggles are flipped far
    /// more often than they are created, so upsert is the only useful shape.
    pub async fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(key)
        .bind(value)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to store setting: {e}"))?;
        Ok(())
    }

    /// The global environment isolation stage for ordinary agents. Missing
    /// settings fail closed so an older database starts at `strict`.
    #[allow(dead_code)] // API and frontend consumers land in the next package slices.
    pub async fn agent_env_isolation(&self) -> Result<crate::profiles::EnvIsolation, String> {
        let Some(value) = self.get_setting("agent.env_isolation").await? else {
            return Ok(crate::profiles::EnvIsolation::Strict);
        };
        value
            .parse::<crate::profiles::EnvIsolation>()
            .map_err(|error| error.to_string())
    }

    /// Persist the global environment isolation stage for ordinary agents.
    #[allow(dead_code)] // API and frontend consumers land in the next package slices.
    pub async fn set_agent_env_isolation(
        &self,
        isolation: crate::profiles::EnvIsolation,
    ) -> Result<(), String> {
        self.set_setting("agent.env_isolation", isolation.as_str())
            .await
    }

    /// Every setting whose key starts with `prefix`, sorted by key.
    ///
    /// The settings table is a flat key-value store, so a family of keys -
    /// `budget.<profile>.five_hour_pct` and its siblings - can only be listed
    /// by prefix. `LIKE` is not used: the prefix is caller-supplied and `%`
    /// and `_` are wildcards in it, so a key containing an underscore would
    /// otherwise match prefixes nobody asked for.
    pub async fn list_settings(&self, prefix: &str) -> Result<Vec<(String, String)>, String> {
        let rows: Vec<(String, String)> =
            sqlx::query_as("SELECT key, value FROM settings ORDER BY key")
                .fetch_all(&self.pool)
                .await
                .map_err(|e| format!("failed to list settings: {e}"))?;
        Ok(rows
            .into_iter()
            .filter(|(key, _)| key.starts_with(prefix))
            .collect())
    }

    /// Remove a setting. Writing an empty value would be a value of its own -
    /// "no limit" has to be the absence of the key, or every reader would have
    /// to know which empty string means what.
    pub async fn delete_setting(&self, key: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM settings WHERE key = ?1")
            .bind(key)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to delete setting: {e}"))?;
        Ok(())
    }
}
