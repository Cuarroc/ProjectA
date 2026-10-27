use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Number, Value};

pub(crate) fn project(raw: Value) -> Result<Value, String> {
    let snapshot: Snapshot = serde_json::from_value(raw)
        .map_err(|_| "invalid development records snapshot".to_string())?;
    Ok(
        json!({"apiVersion":1,"executionEnabled":false,"sourceTimestamp":snapshot.source_timestamp,
        "approvalAuthority":crate::store::development_runs::approval_authority(),"runs":snapshot.runs}),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    source_timestamp: i64,
    runs: Vec<Record>,
}

#[derive(Deserialize, Serialize)]
struct Record {
    run: Run,
    candidate: Option<Candidate>,
    evidence: Vec<Evidence>,
    reviews: Vec<Review>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Run {
    id: String,
    task_id: String,
    worker_id: Option<String>,
    status: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Candidate {
    run_id: String,
    candidate_commit: String,
    #[serde(deserialize_with = "source")]
    source: String,
    observed_at: i64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Evidence {
    id: String,
    run_id: String,
    candidate_commit: String,
    #[serde(deserialize_with = "source")]
    source: String,
    observed_at: i64,
    trusted_test_source: bool,
    invalidated_at: Option<i64>,
    invalidated_by_commit: Option<String>,
    #[serde(deserialize_with = "measurement")]
    measurement: Measurement,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Review {
    id: String,
    run_id: String,
    evidence_id: String,
    candidate_commit: String,
    #[serde(deserialize_with = "source")]
    source: String,
    observed_at: i64,
    disposition: String,
    status: String,
    #[serde(skip_deserializing)]
    approval_eligible: bool,
    #[serde(deserialize_with = "attestation")]
    reviewer_attestation: String,
    invalidated_at: Option<i64>,
    invalidated_by_commit: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
enum Measurement {
    Measured { value: Number },
    Unavailable { reason: &'static str },
}

fn measurement<'de, D: Deserializer<'de>>(d: D) -> Result<Measurement, D::Error> {
    use crate::store::development_runs::EvidenceMeasurement;
    Ok(match EvidenceMeasurement::deserialize(d)? {
        EvidenceMeasurement::Measured {
            value: Value::Number(value),
        } => Measurement::Measured { value },
        _ => Measurement::Unavailable {
            reason: "No numeric measurement available",
        },
    })
}

fn source<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(match String::deserialize(d)?.as_str() {
        "git" => "git",
        "test-gate" => "test-gate",
        _ => "unverified",
    }
    .into())
}

fn attestation<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(if String::deserialize(d)?.starts_with("unavailable") {
        "unavailable"
    } else {
        "unverified"
    }
    .into())
}

#[cfg(test)]
mod tests {
    use super::project;
    use serde_json::{json, Value};

    fn snapshot() -> Value {
        json!({"sourceTimestamp":9,"apiVersion":99,"executionEnabled":true,
            "approvalAuthority":{"detail":"/private/projection-canary"},"future":"secret",
            "runs":[{"run":{"id":"r","taskId":"t","workerId":null,"status":"intent",
                "policyJson":"secret","policy_json":"secret","claimOwner":"secret","claimFence":7,
                "processId":17,"terminalDetail":"secret","future":"secret"},
                "candidate":{"runId":"r","candidateCommit":"b","source":"git","observedAt":4,"future":"secret"},
                "taskCheckpoint":{"path":"/private/projection-canary"},"launch":{"workspace":"secret"},
                "executionIdentity":{"path":"secret"},"tokens":{"secret":1},"usage":{"path":"secret"},
                "future":"secret",
                "evidence":[{"id":"e","runId":"r","candidateCommit":"a","source":"test-gate",
                    "observedAt":2,"trustedTestSource":false,"invalidatedAt":4,"invalidatedByCommit":"b",
                    "measurement":{"state":"measured","value":0,"future":"secret"},
                    "payload":{"nested":{"path":"/private/projection-canary"}},"idempotencyKey":"secret","future":"secret"}],
                "reviews":[{"id":"v","runId":"r","evidenceId":"e","candidateCommit":"a",
                    "source":"/private/projection-canary","observedAt":3,"disposition":"approved","status":"invalidated",
                    "approvalEligible":true,"reviewerAttestation":"verified: /private/projection-canary",
                    "invalidatedAt":4,"invalidatedByCommit":"b","reviewerIdentity":"secret",
                    "implementerIdentity":"secret","idempotencyKey":"secret","future":"secret"}]}]})
    }

    #[test]
    fn development_records_projection_allowlists_every_level() {
        let actual = project(snapshot()).unwrap();
        assert_eq!(
            actual,
            json!({"apiVersion":1,"executionEnabled":false,"sourceTimestamp":9,
            "approvalAuthority":{"state":"unavailable","reviewerPrincipal":"launch-route-receipt",
                "detail":"reviewer principals come from launch route receipts; approval needs signed verdicts, which are not implemented"},
            "runs":[{"run":{"id":"r","taskId":"t","workerId":null,"status":"intent"},
                "candidate":{"runId":"r","candidateCommit":"b","source":"git","observedAt":4},
                "evidence":[{"id":"e","runId":"r","candidateCommit":"a","source":"test-gate","observedAt":2,
                    "trustedTestSource":false,"invalidatedAt":4,"invalidatedByCommit":"b",
                    "measurement":{"state":"measured","value":0}}],
                "reviews":[{"id":"v","runId":"r","evidenceId":"e","candidateCommit":"a",
                    "source":"unverified","observedAt":3,"disposition":"approved","status":"invalidated",
                    "approvalEligible":false,"reviewerAttestation":"unverified","invalidatedAt":4,"invalidatedByCommit":"b"}]}]})
        );
        let encoded = actual.to_string();
        for forbidden in [
            "secret",
            "projection-canary",
            "policyJson",
            "policy_json",
            "payload",
            "future",
        ] {
            assert!(!encoded.contains(forbidden));
        }
        for value in [
            json!("/private/projection-canary"),
            json!({"path":"secret"}),
            json!([1]),
            json!(true),
            Value::Null,
        ] {
            let mut raw = snapshot();
            raw["runs"][0]["candidate"] = Value::Null;
            raw["runs"][0]["evidence"][0]["source"] = json!("/private/projection-canary");
            raw["runs"][0]["evidence"][0]["measurement"]["value"] = value;
            raw["runs"][0]["reviews"][0]["reviewerAttestation"] = json!("unavailable: secret");
            let view = project(raw).unwrap();
            assert_eq!(view["runs"][0]["candidate"], Value::Null);
            assert_eq!(view["runs"][0]["evidence"][0]["source"], "unverified");
            assert_eq!(
                view["runs"][0]["evidence"][0]["measurement"],
                json!({"state":"unavailable","reason":"No numeric measurement available"})
            );
            assert_eq!(
                view["runs"][0]["reviews"][0]["reviewerAttestation"],
                "unavailable"
            );
        }
        let mut raw = snapshot();
        raw["runs"][0]["evidence"][0]["measurement"] =
            json!({"state":"unavailable","reason":"/private/projection-canary"});
        assert_eq!(
            project(raw).unwrap()["runs"][0]["evidence"][0]["measurement"],
            json!({"state":"unavailable","reason":"No numeric measurement available"})
        );
        assert_eq!(
            project(json!({"sourceTimestamp":9,"runs":[]})).unwrap()["runs"],
            json!([])
        );
    }

    #[test]
    fn development_records_projection_rejects_malformed_without_echo() {
        let mut raw = snapshot();
        raw["runs"][0]["run"]["id"] = json!({"/private/projection-canary":"secret"});
        for malformed in [
            raw,
            json!({"runs":[]}),
            json!({"sourceTimestamp":9,"runs":"/private/projection-canary"}),
        ] {
            assert_eq!(
                project(malformed).unwrap_err(),
                "invalid development records snapshot"
            );
        }
    }
}
