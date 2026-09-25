//! Ingestion for one completed native `codex exec --json` invocation. Callers
//! must own stdout and the process exit handle; never pass worker-authored files
//! or PTY text. This does not itself establish a trusted capture transport.
use super::usage_receipt::CODEX_COLLECTOR;
use super::{CaptureLaunchIdentity, RunUsageBinding, Store};
use serde_json::Value;
use sha2::{Digest, Sha256};

impl Store {
    pub async fn settle_codex_run_capture(
        &self,
        reservation: &str,
        binding: RunUsageBinding<'_>,
        stdout: &[u8],
        exit_code: Option<i32>,
        observed_at: i64,
    ) -> Result<(), String> {
        let launch = self
            .development_launch(binding.run_id)
            .await?
            .ok_or("Codex usage has no reserved launch")?;
        let route: Value = serde_json::from_str(launch.route_json.as_deref().unwrap_or("null"))
            .map_err(|_| "invalid stored provider route")?;
        if route["selection"]["resolved"]["provider"] != "codex"
            || launch.exit_code != exit_code
            || launch.state != "exited"
            || launch.session_id.as_deref() != Some(binding.session_id)
        {
            return Err("Codex usage does not match its exited provider launch".into());
        }
        let tokens = complete_usage(stdout, exit_code)
            .map_err(|reason| format!("Codex usage rejected: {reason}"))?;
        let source = format!("{CODEX_COLLECTOR}:sha256:{:x}", Sha256::digest(stdout));
        self.settle_tokens_bound(
            reservation,
            tokens,
            &source,
            observed_at,
            Some(binding),
            Some(CaptureLaunchIdentity {
                route_json: launch
                    .route_json
                    .as_deref()
                    .ok_or("missing capture route")?,
                exit_code,
            }),
        )
        .await
    }
}

/// Final usage of one complete capture, or the named reason it was refused.
/// Any refusal keeps the whole reservation; nothing is ever settled as zero.
pub(in crate::store) fn complete_usage(
    stdout: &[u8],
    exit_code: Option<i32>,
) -> Result<i64, &'static str> {
    const COUNT: &str = "usage count is missing, negative or not an integer";
    if exit_code != Some(0) {
        return Err("process exit code is not zero");
    }
    if stdout.is_empty() {
        return Err("capture is empty");
    }
    if stdout.len() > 1_048_576 {
        return Err("capture exceeds 1 MiB");
    }
    if !stdout.ends_with(b"\n") {
        return Err("capture is truncated before a final newline");
    }
    let text = std::str::from_utf8(stdout).map_err(|_| "capture is not UTF-8")?;
    let mut stage = 0;
    let mut total = None;
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let event: Value = serde_json::from_str(line).map_err(|_| "capture line is not JSON")?;
        if event.get("is_error").is_some_and(|v| v != false) {
            return Err("provider reported an error event");
        }
        match (stage, event["type"].as_str()) {
            (0, Some("thread.started"))
                if event["thread_id"].as_str().is_some_and(|s| !s.is_empty()) =>
            {
                stage = 1
            }
            (1, Some("turn.started")) => stage = 2,
            (2, Some("item.started" | "item.updated" | "item.completed")) => {
                if !event["item"].is_object() {
                    return Err("item event without an item object");
                }
            }
            (2, Some("turn.completed")) => {
                let usage = &event["usage"];
                // Nonzero cache-write semantics have not been observed yet.
                if usage
                    .get("cache_write_input_tokens")
                    .is_some_and(|v| v.as_i64() != Some(0))
                {
                    return Err("nonzero cache-write tokens are unsupported");
                }
                let input = usage["input_tokens"]
                    .as_i64()
                    .filter(|v| *v >= 0)
                    .ok_or(COUNT)?;
                let output = usage["output_tokens"]
                    .as_i64()
                    .filter(|v| *v >= 0)
                    .ok_or(COUNT)?;
                // Cached input and reasoning output are subsets, not extra spend.
                for (key, upper) in [
                    ("cached_input_tokens", input),
                    ("reasoning_output_tokens", output),
                ] {
                    if let Some(value) = usage.get(key) {
                        if !value.as_i64().is_some_and(|v| v >= 0 && v <= upper) {
                            return Err(
                                "cached or reasoning count is invalid or exceeds its total",
                            );
                        }
                    }
                }
                total = input.checked_add(output).filter(|v| *v <= 1_000_000_000);
                if total.is_none() {
                    return Err("usage total exceeds the ledger limit");
                }
                stage = 3;
            }
            _ => return Err("unexpected or out-of-order event"),
        }
    }
    total
        .filter(|_| stage == 3)
        .ok_or("no final turn.completed event")
}

#[cfg(test)]
#[path = "development_codex_usage_tests.rs"]
mod tests;
