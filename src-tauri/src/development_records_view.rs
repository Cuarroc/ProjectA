#[cfg(test)]
fn project(raw: serde_json::Value) -> Result<serde_json::Value, String> {
    Ok(raw)
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
