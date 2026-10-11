//! Pure parser for the Claude CLI run stream (`--output-format stream-json`).
//! Reads observed models from the `result` event and MCP servers from the
//! `system`/`init` event. Wiring into launches and the store is a later package.

/// Connection state of one MCP server as the CLI reported it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McpStatus {
    Connected,
    Failed,
    NeedsAuth,
    Pending,
    /// A status string this parser has not observed; kept verbatim.
    Unknown(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservedModel {
    pub id: String,
    pub canonical: Option<String>,
    pub provider: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpServer {
    pub name: String,
    pub status: McpStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StreamObservation {
    pub models: Vec<ObservedModel>,
    /// True when no `modelUsage` was seen; `models` is then empty, not a guess.
    pub models_not_reported: bool,
    pub mcp_servers: Vec<McpServer>,
    /// True when no `mcp_servers` list was seen in an init event.
    pub mcp_not_reported: bool,
}

/// Parse a complete stream-json capture (one JSON event per line).
pub fn parse_stream(_stdout: &[u8]) -> StreamObservation {
    StreamObservation::default()
}

/// Absorb one already-decoded event (a stream line or a `--output-format json` result).
pub fn absorb_event(_obs: &mut StreamObservation, _event: &serde_json::Value) {}

#[cfg(test)]
mod tests {
    use super::*;

    const STREAM: &str = include_str!("fixtures/claude-stream-json-2.1.287.jsonl");
    const MCP_FAILED: &str = include_str!("fixtures/claude-stream-json-2.1.287-mcp-failed.jsonl");
    const PRINT_JSON: &str = include_str!("../store/fixtures/claude-print-json-2.1.287.json");

    #[test]
    fn model_usage_of_the_real_2_1_287_result_yields_the_canonical_model() {
        let mut obs = StreamObservation::default();
        absorb_event(&mut obs, &serde_json::from_str(PRINT_JSON).unwrap());
        let want = ObservedModel {
            id: "claude-sonnet-5-5".into(),
            canonical: Some("claude-sonnet-5-5".into()),
            provider: Some("firstParty".into()),
        };
        assert_eq!(obs.models, vec![want.clone()]);
        assert!(!obs.models_not_reported);
        assert_eq!(
            parse_stream(STREAM.as_bytes()).models[0].id,
            "claude-opus-5-5"
        );
    }

    #[test]
    fn init_event_lists_mcp_servers_with_their_observed_status() {
        let server = |n: &str, status| McpServer {
            name: n.into(),
            status,
        };
        let obs = parse_stream(STREAM.as_bytes());
        assert_eq!(
            obs.mcp_servers,
            vec![
                server("server-1", McpStatus::Connected),
                server("server-2", McpStatus::NeedsAuth),
                server("server-3", McpStatus::Failed),
                server("server-4", McpStatus::Pending),
            ]
        );
        let failed = parse_stream(MCP_FAILED.as_bytes());
        assert_eq!(
            failed.mcp_servers,
            vec![McpServer {
                name: "server-1".into(),
                status: McpStatus::Failed
            }]
        );
        assert!(!failed.mcp_not_reported);
    }

    #[test]
    fn unknown_mcp_status_is_kept_as_unknown_not_connected() {
        let line = r#"{"type":"system","subtype":"init","mcp_servers":[{"name":"a","status":"quarantined"}]}"#;
        let obs = parse_stream(line.as_bytes());
        assert_eq!(
            obs.mcp_servers[0].status,
            McpStatus::Unknown("quarantined".into())
        );
        assert_ne!(obs.mcp_servers[0].status, McpStatus::Connected);
    }

    #[test]
    fn missing_model_usage_is_not_reported_not_a_guess() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"result":"ok"}"#;
        let obs = parse_stream(line.as_bytes());
        assert!(obs.models.is_empty());
        assert!(obs.models_not_reported);
        assert!(obs.mcp_not_reported);
    }
}
