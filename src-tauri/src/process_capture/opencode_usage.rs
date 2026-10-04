//! Pure parser for one completed `opencode run --format json` capture.
//! Runtime, routing and ledger wiring belong to later packages.

/// Outcome of parsing one process-owned OpenCode capture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenCodeUsage {
    Measured { tokens: i64 },
    Rejected { reason: &'static str },
}

impl OpenCodeUsage {
    pub fn state(&self) -> &'static str {
        match self {
            Self::Measured { .. } => "measured",
            Self::Rejected { .. } => "rejected",
        }
    }

    pub fn tokens(&self) -> Option<i64> {
        match self {
            Self::Measured { tokens } => Some(*tokens),
            Self::Rejected { .. } => None,
        }
    }

    pub fn reason(&self) -> Option<&'static str> {
        match self {
            Self::Measured { .. } => None,
            Self::Rejected { reason } => Some(reason),
        }
    }
}

/// Classify one complete process-owned capture without touching application state.
pub fn complete_usage(stdout: &[u8], exit_code: Option<i32>) -> OpenCodeUsage {
    if exit_code != Some(0) {
        return OpenCodeUsage::Rejected {
            reason: "process exit code is not zero",
        };
    }

    let mut finish = None;
    for line in stdout
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        let event: serde_json::Value = match serde_json::from_slice(line) {
            Ok(event) => event,
            Err(_) => {
                return OpenCodeUsage::Rejected {
                    reason: "output contains invalid JSON",
                };
            }
        };
        if event.get("type").and_then(serde_json::Value::as_str) == Some("step_finish") {
            finish = Some(event);
        }
    }

    let Some(tokens) = finish
        .as_ref()
        .and_then(|event| event.pointer("/part/tokens"))
    else {
        return OpenCodeUsage::Rejected {
            reason: "final step is missing token usage",
        };
    };
    let fields = [
        tokens.get("total"),
        tokens.get("input"),
        tokens.get("output"),
        tokens.get("reasoning"),
        tokens.pointer("/cache/write"),
        tokens.pointer("/cache/read"),
    ];
    let Some(total) = fields[0].and_then(serde_json::Value::as_i64) else {
        return OpenCodeUsage::Rejected {
            reason: "usage count is missing, negative or not an integer",
        };
    };
    if fields.iter().any(|value| {
        value
            .and_then(serde_json::Value::as_i64)
            .is_none_or(|count| count < 0)
    }) {
        return OpenCodeUsage::Rejected {
            reason: "usage count is missing, negative or not an integer",
        };
    }

    OpenCodeUsage::Measured { tokens: total }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    const REAL_CAPTURE: &[u8] = include_bytes!("fixtures/opencode-run-json-1.18.34.jsonl");

    fn capture_with_finish(finish: Value) -> Vec<u8> {
        let events = [
            json!({"type":"step_start","part":{"type":"step-start"}}),
            json!({"type":"text","part":{"type":"text","text":"ok"}}),
            finish,
        ];
        let mut capture = events
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n")
            .into_bytes();
        capture.push(b'\n');
        capture
    }

    fn finish(tokens: Value) -> Value {
        json!({"type":"step_finish","part":{"type":"step-finish",
            "reason":"stop","tokens":tokens}})
    }

    #[test]
    fn real_opencode_1_18_34_json_maps_observed_token_counters() {
        let usage = complete_usage(REAL_CAPTURE, Some(0));
        assert_eq!(usage.state(), "measured");
        assert_eq!(usage.tokens(), Some(16_464));
        assert_eq!(usage.reason(), None);
    }

    #[test]
    fn opencode_output_without_usage_is_rejected_with_a_named_reason() {
        let usage = complete_usage(
            &capture_with_finish(json!({"type":"step_finish","part":{
                "type":"step-finish","reason":"stop"}})),
            Some(0),
        );
        assert_eq!(usage.state(), "rejected");
        assert_eq!(usage.tokens(), None);
        assert_eq!(usage.reason(), Some("final step is missing token usage"));
    }

    #[test]
    fn negative_or_missing_opencode_counters_are_rejected() {
        for tokens in [
            json!({"total":3,"input":-1,"output":4,"reasoning":0,
                "cache":{"write":0,"read":0}}),
            json!({"total":5,"input":1,"reasoning":0,
                "cache":{"write":0,"read":0}}),
            json!({"total":5,"input":1,"output":4,"reasoning":0,
                "cache":{"read":0}}),
        ] {
            let usage = complete_usage(&capture_with_finish(finish(tokens)), Some(0));
            assert_eq!(usage.state(), "rejected");
            assert_eq!(usage.tokens(), None);
            assert_eq!(
                usage.reason(),
                Some("usage count is missing, negative or not an integer")
            );
        }
    }

    #[test]
    fn opencode_error_run_is_rejected_instead_of_zero() {
        let capture = capture_with_finish(finish(json!({"total":5,"input":1,
            "output":4,"reasoning":0,"cache":{"write":0,"read":0}})));
        for exit_code in [Some(1), None] {
            let usage = complete_usage(&capture, exit_code);
            assert_eq!(usage.state(), "rejected");
            assert_eq!(usage.tokens(), None);
            assert_eq!(usage.reason(), Some("process exit code is not zero"));
        }
    }
}
