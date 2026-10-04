//! Pure parser for one completed `claude -p --output-format json` capture.
//! Runtime and ledger wiring belong to a later serial package.
use super::usage_receipt::UsageReceipt;

pub(in crate::store) const CLAUDE_COLLECTOR: &str = "claude-print-json-v1";
pub(in crate::store) const CLAUDE_TRANSPORT: &str = "native_claude_print_json";

/// Classify one complete process-owned capture without touching the store.
pub(in crate::store) fn complete_usage(_stdout: &[u8], _exit_code: Option<i32>) -> UsageReceipt {
    UsageReceipt::NotReported {
        provider: "claude".into(),
        transport: CLAUDE_TRANSPORT.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const REAL_CAPTURE: &[u8] = include_bytes!("fixtures/claude-print-json-2.1.287.json");

    #[test]
    fn real_claude_2_1_287_json_maps_observed_token_counters() {
        let receipt = complete_usage(REAL_CAPTURE, Some(0));
        assert_eq!(receipt.state(), "measured");
        // 2 uncached + 1,857 cache creation + 535 cache read + 4 output.
        assert_eq!(receipt.tokens(), Some(2_398));
        assert!(receipt
            .ledger_source()
            .unwrap()
            .starts_with("claude-print-json-v1:sha256:"));
    }

    #[test]
    fn claude_json_without_usage_is_not_reported_instead_of_zero() {
        let receipt = complete_usage(
            br#"{"type":"result","subtype":"success","is_error":false}"#,
            Some(0),
        );
        assert_eq!(receipt.state(), "not_reported");
        assert_eq!(receipt.tokens(), None);
        assert!(receipt.to_json(Some(1))["reason"]
            .as_str()
            .unwrap()
            .contains("JSON result did not include a usage object"));
    }

    #[test]
    fn negative_or_missing_claude_counters_are_rejected() {
        for usage in [
            serde_json::json!({"input_tokens":-1,"cache_creation_input_tokens":2,
                "cache_read_input_tokens":3,"output_tokens":4}),
            serde_json::json!({"input_tokens":1,"cache_creation_input_tokens":2,
                "output_tokens":4}),
            serde_json::json!({"input_tokens":1,"cache_creation_input_tokens":2,
                "cache_read_input_tokens":3,"output_tokens":null}),
        ] {
            let capture = serde_json::json!({"type":"result","subtype":"success",
                "is_error":false,"usage":usage});
            let receipt = complete_usage(capture.to_string().as_bytes(), Some(0));
            assert_eq!(receipt.state(), "rejected", "{capture}");
            assert_eq!(receipt.tokens(), None);
        }
    }

    #[test]
    fn claude_error_run_is_rejected_instead_of_zero() {
        let capture = serde_json::json!({"type":"result","subtype":"error",
            "is_error":true,"usage":{"input_tokens":1,"cache_creation_input_tokens":2,
                "cache_read_input_tokens":3,"output_tokens":4}});
        for exit_code in [Some(0), Some(1), None] {
            let receipt = complete_usage(capture.to_string().as_bytes(), exit_code);
            assert_eq!(receipt.state(), "rejected", "{exit_code:?}");
            assert_eq!(receipt.tokens(), None);
        }
    }
}
