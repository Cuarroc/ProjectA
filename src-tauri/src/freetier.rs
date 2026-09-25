//! Free-tier pools: how much of OmniRoute's keyless capacity is left.
//!
//! Phase 19 T4 lets a blocked profile hand its task to a free one. This module
//! answers the question that comes right after: *is there anything left in the
//! free pools to hand it to?* It reads OmniRoute's own `/api/free-tier/summary`
//! and hands the answer to the provider dialog and the usage view.
//!
//! Two things make this module small on purpose.
//!
//! **It degrades honestly.** The management routes are login-gated - a probe
//! without a token gets a 401, and that is not a number to invent a zero for.
//! Every failure comes back as [`FreeTierSummary::unavailable`] with the reason
//! spelled out: no token stored, token refused, router not reachable, this
//! build has no such route, or the body was not a free-tier document. The UI
//! prints that sentence. It never prints a made-up quota.
//!
//! **It does not pin the payload down.** The route is not part of any
//! documented API and different builds shape it differently, so parsing reads
//! the handful of field names a pool could plausibly carry and leaves every
//! fact it cannot find as `None`. A pool with a name and nothing else is a
//! legitimate answer: "this provider exists, nobody said how much is left".
//!
//! The curated whitelist comes from the shipped combo template
//! (`resources/omniroute-combos.json`, phase 19 T5): the providers ProjectA is
//! willing to route free traffic through. Pools OmniRoute itself flags as
//! terms-of-service `avoid` are dropped here and never reach the UI; anything
//! else is passed through with [`FreeTierPool::whitelisted`] saying whether it
//! is in the curated set.

use std::net::SocketAddr;

use serde::Serialize;
use serde_json::Value;

use crate::store::now_unix_secs;

/// The vault entry holding the router's own login. It is the OmniRoute
/// *provider* id from [`crate::providers::PROVIDERS`], so the provider dialog's
/// key controls fill it - but it is a login for the router, not an upstream
/// provider key, which is why the key push skips it.
pub const VAULT_ID: &str = "omniroute";

/// OmniRoute's free-tier overview. Login-gated, like every management route.
pub const SUMMARY_PATH: &str = "/api/free-tier/summary";

/// No token in the vault, so nothing was asked in the first place.
pub const REASON_NO_TOKEN: &str = "Login fehlt - kein OmniRoute-Token hinterlegt";
/// A token was sent and OmniRoute did not accept it.
pub const REASON_REJECTED: &str = "Login fehlt - OmniRoute hat den Token abgelehnt";
/// Nothing answered on the router's port.
pub const REASON_OFFLINE: &str = "OmniRoute nicht erreichbar";
/// The router answered, but not on this route.
pub const REASON_NO_ROUTE: &str = "Dieser OmniRoute-Build kennt keine Free-Tier-Uebersicht";
/// A 2xx that was not a free-tier document - an HTML error page, say.
pub const REASON_UNREADABLE: &str = "Die Antwort war keine Free-Tier-Uebersicht";

/// The terms-of-service verdict a pool must not carry to be shown at all.
/// OmniRoute's own flagging, taken at its word: a provider it says to avoid is
/// one ProjectA does not put in front of the user as an option.
const TOS_AVOID: &str = "avoid";

/// What is left in one free pool. Every number is optional, and a missing one
/// stays missing: `null` reads as "not reported", a zero would read as "empty".
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeTierPool {
    /// The provider id OmniRoute uses, e.g. `groq`.
    pub provider: String,
    /// What to put on screen; the provider id when the payload named nothing
    /// friendlier.
    pub label: String,
    /// Requests or tokens left in the window, as reported.
    pub remaining: Option<i64>,
    /// The window's ceiling, as reported.
    pub limit: Option<i64>,
    /// How much of the pool is *left*, 0-100 - not how much is used, which is
    /// what [`crate::providers::ProviderUsage::percent`] means. Computed from
    /// `remaining` and `limit` when the payload gave both and no percentage.
    pub remaining_percent: Option<u8>,
    /// Unix seconds at which the window rolls over, when the payload said.
    pub resets_at: Option<i64>,
    /// OmniRoute's terms-of-service note, passed through unlabelled.
    pub tos_status: Option<String>,
    /// Whether this provider is in ProjectA's curated combo whitelist.
    pub whitelisted: bool,
}

/// The whole answer, including the honest negative one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeTierSummary {
    /// Whether `pools` is worth reading. `false` means `reason` says why not.
    pub available: bool,
    /// Why there are no numbers, in one sentence for the user.
    pub reason: Option<String>,
    pub pools: Vec<FreeTierPool>,
    /// The curated provider ids, so the UI can say what "whitelisted" means
    /// without a second copy of the list.
    pub whitelist: Vec<String>,
    pub observed_at: i64,
}

impl FreeTierSummary {
    /// No numbers, and the reason instead of a fabricated zero.
    pub fn unavailable(reason: &str) -> Self {
        Self {
            available: false,
            reason: Some(reason.to_string()),
            pools: Vec::new(),
            whitelist: whitelist(),
            observed_at: now_unix_secs(),
        }
    }
}

/// The providers the shipped `projecta-free` combo is allowed to draw on.
///
/// Read from the template that defines the combo rather than restated here:
/// one list, in the file the router is configured from, so the two cannot
/// drift apart. A template that stops parsing yields an empty whitelist, which
/// marks every pool as uncurated - visibly cautious, never silently permissive.
pub fn whitelist() -> Vec<String> {
    let raw = include_str!("../resources/omniroute-combos.json");
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return Vec::new();
    };
    let mut ids: Vec<String> = value["templates"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|template| template["allowedProviders"].as_array())
        .flatten()
        .filter_map(Value::as_str)
        .map(|id| id.trim().to_ascii_lowercase())
        .filter(|id| !id.is_empty())
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

/// Ask OmniRoute what is left in the free pools.
///
/// `token` is the bearer the vault holds for the router, if it holds one.
/// Blocking: one socket, one request, the probe timeout from
/// [`crate::omniroute`]. Callers run it off the thread serving the UI.
pub fn fetch(addr: SocketAddr, token: Option<&str>) -> FreeTierSummary {
    let Some(token) = token.map(str::trim).filter(|token| !token.is_empty()) else {
        return FreeTierSummary::unavailable(REASON_NO_TOKEN);
    };
    let Some((status, body)) = crate::omniroute::get_authorized(
        addr,
        SUMMARY_PATH,
        Some(token),
        crate::omniroute::PROBE_TIMEOUT,
        crate::omniroute::MAX_RESPONSE,
    ) else {
        return FreeTierSummary::unavailable(REASON_OFFLINE);
    };
    match status {
        401 | 403 => return FreeTierSummary::unavailable(REASON_REJECTED),
        200..=299 => {}
        _ => return FreeTierSummary::unavailable(REASON_NO_ROUTE),
    }
    parse(&body)
}

/// Turn a `2xx` body into a summary, or into the honest negative.
pub fn parse(body: &str) -> FreeTierSummary {
    let Ok(value) = serde_json::from_str::<Value>(body.trim()) else {
        return FreeTierSummary::unavailable(REASON_UNREADABLE);
    };
    let Some(rows) = pool_array(&value) else {
        return FreeTierSummary::unavailable(REASON_UNREADABLE);
    };

    let whitelist = whitelist();
    let pools: Vec<FreeTierPool> = rows
        .iter()
        .filter_map(|row| pool(row, &whitelist))
        .filter(|pool| {
            !pool
                .tos_status
                .as_deref()
                .is_some_and(|status| status.eq_ignore_ascii_case(TOS_AVOID))
        })
        .collect();

    FreeTierSummary {
        available: true,
        reason: None,
        pools,
        whitelist,
        observed_at: now_unix_secs(),
    }
}

/// The array of pools, wherever this build put it.
fn pool_array(value: &Value) -> Option<&Vec<Value>> {
    if let Some(rows) = value.as_array() {
        return Some(rows);
    }
    ["providers", "pools", "summary", "freeTiers", "free_tiers"]
        .into_iter()
        .find_map(|key| value.get(key).and_then(Value::as_array))
}

/// One row, as far as it can be read. `None` only when there is no provider to
/// name it by, because a pool nobody can identify is not one to show.
fn pool(row: &Value, whitelist: &[String]) -> Option<FreeTierPool> {
    let provider = string(row, &["provider", "providerId", "provider_id", "id"])?;
    let label = string(row, &["name", "label"]).unwrap_or_else(|| provider.clone());
    let remaining = number(row, &["remaining", "remainingTokens", "remaining_tokens"]);
    let limit = number(row, &["limit", "total", "quota"]);

    Some(FreeTierPool {
        remaining_percent: remaining_percent(row, remaining, limit),
        whitelisted: whitelist
            .iter()
            .any(|id| *id == provider.to_ascii_lowercase()),
        provider,
        label,
        remaining,
        limit,
        resets_at: number(row, &["resetsAt", "resets_at", "resetAt"]),
        tos_status: string(row, &["tos", "tosStatus", "tos_status"]),
    })
}

/// The reported remaining percentage, or the one `remaining` and `limit` imply.
///
/// A limit of zero yields nothing rather than a division: an empty pool and an
/// unreported one are different answers, and only one of them is a number.
fn remaining_percent(row: &Value, remaining: Option<i64>, limit: Option<i64>) -> Option<u8> {
    if let Some(percent) = number(row, &["remainingPercent", "remaining_percent"]) {
        return u8::try_from(percent.clamp(0, 100)).ok();
    }
    let (remaining, limit) = (remaining?, limit?);
    if limit <= 0 {
        return None;
    }
    // `i128` on the way: the pool size is a foreign number the JSON parser
    // accepts up to `i64::MAX`, and `* 100` overflows `i64` two orders of
    // magnitude before that.
    let percent = (i128::from(remaining.clamp(0, limit)) * 100 / i128::from(limit)) as i64;
    u8::try_from(percent).ok()
}

/// The first of these keys that carries a non-empty string.
fn string(row: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| row.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// The first of these keys that carries a number. A float is truncated; these
/// are token counts and reset times, and neither wants a fraction.
fn number(row: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|key| {
        let value = row.get(*key)?;
        value
            .as_i64()
            .or_else(|| value.as_f64().map(|number| number as i64))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{Ipv4Addr, TcpListener};

    /// A throwaway server that answers one canned reply and records the
    /// `Authorization` header it was sent, which is half of what these tests
    /// are about.
    fn serve(status: u16, body: &'static str) -> (SocketAddr, std::sync::mpsc::Receiver<String>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind");
        let addr = listener.local_addr().expect("addr");
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut buf = [0u8; 2048];
                let Ok(n) = stream.read(&mut buf) else {
                    continue;
                };
                let _ = tx.send(String::from_utf8_lossy(&buf[..n]).into_owned());
                let response = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\n\
                     Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        (addr, rx)
    }

    /// An address nothing is listening on: bound to claim it, then dropped.
    fn dead_addr() -> SocketAddr {
        TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .expect("bind")
            .local_addr()
            .expect("addr")
    }

    #[test]
    fn the_whitelist_comes_from_the_shipped_combo_template() {
        let ids = whitelist();
        // The curated eight of phase 19 T5, and nothing OmniRoute flags.
        for expected in [
            "cerebras",
            "cloudflare-ai",
            "gemini",
            "groq",
            "mistral",
            "ollama-cloud",
            "openrouter",
            "sambanova",
        ] {
            assert!(ids.iter().any(|id| id == expected), "{expected} in {ids:?}");
        }
        let mut sorted = ids.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(ids, sorted, "the list is sorted and free of duplicates");
    }

    #[test]
    fn without_a_token_nothing_is_asked_and_the_reason_says_so() {
        let (addr, rx) = serve(200, "[]");
        let summary = fetch(addr, None);
        assert!(!summary.available);
        assert_eq!(summary.reason.as_deref(), Some(REASON_NO_TOKEN));
        assert!(summary.pools.is_empty());
        // Not a fabricated zero, and not a request either.
        assert!(rx.try_recv().is_err(), "no token means no call");

        // A blank vault entry is no token at all.
        assert_eq!(
            fetch(addr, Some("   ")).reason.as_deref(),
            Some(REASON_NO_TOKEN)
        );
    }

    #[test]
    fn a_rejected_token_reads_as_a_missing_login_not_as_an_empty_pool() {
        let (addr, _rx) = serve(401, "{\"error\":\"unauthorized\"}");
        let summary = fetch(addr, Some("nope"));
        assert!(!summary.available);
        assert_eq!(summary.reason.as_deref(), Some(REASON_REJECTED));
        assert!(summary.pools.is_empty());
        // The whitelist is still worth reporting: it is what ProjectA intends
        // to use once somebody logs in.
        assert!(!summary.whitelist.is_empty());
    }

    #[test]
    fn an_unreachable_router_and_a_missing_route_are_told_apart() {
        assert_eq!(
            fetch(dead_addr(), Some("token")).reason.as_deref(),
            Some(REASON_OFFLINE)
        );
        let (addr, _rx) = serve(404, "");
        assert_eq!(
            fetch(addr, Some("token")).reason.as_deref(),
            Some(REASON_NO_ROUTE)
        );
    }

    #[test]
    fn a_token_is_sent_as_a_bearer() {
        let (addr, rx) = serve(200, "[]");
        fetch(addr, Some("secret-jwt"));
        let request = rx.recv().expect("a request was made");
        assert!(
            request.contains("Authorization: Bearer secret-jwt"),
            "{request}"
        );
        assert!(
            request.starts_with(&format!("GET {SUMMARY_PATH} ")),
            "{request}"
        );
    }

    #[test]
    fn pools_are_read_with_whatever_facts_the_payload_carries() {
        let summary = parse(
            r#"{"providers":[
                 {"provider":"groq","name":"Groq","remaining":8000,"limit":10000,
                  "resetsAt":1756000000,"tos":"ok"},
                 {"providerId":"mistral"},
                 {"provider":"nobody-curated","remaining":5,"limit":0}
               ]}"#,
        );
        assert!(summary.available);
        assert_eq!(summary.reason, None);
        assert_eq!(summary.pools.len(), 3);

        let groq = &summary.pools[0];
        assert_eq!(groq.label, "Groq");
        assert_eq!(groq.remaining, Some(8000));
        assert_eq!(groq.limit, Some(10000));
        assert_eq!(groq.remaining_percent, Some(80));
        assert_eq!(groq.resets_at, Some(1_756_000_000));
        assert!(groq.whitelisted);

        // A row with nothing but an id is still a row, and every number it did
        // not report stays unreported.
        let mistral = &summary.pools[1];
        assert_eq!(mistral.provider, "mistral");
        assert_eq!(mistral.label, "mistral", "the id stands in for a name");
        assert_eq!(mistral.remaining, None);
        assert_eq!(mistral.remaining_percent, None);
        assert!(mistral.whitelisted);

        // A limit of zero is not divided by, and an uncurated provider says so.
        let other = &summary.pools[2];
        assert_eq!(other.remaining_percent, None);
        assert!(!other.whitelisted);
    }

    #[test]
    fn a_huge_but_valid_pool_does_not_overflow_the_percentage_math() {
        // `remaining.clamp(0, limit) * 100` overflows `i64` once the pool size
        // exceeds `i64::MAX / 100` - far smaller than the maximum the JSON
        // parser will accept. The dense math must not panic the free-tier probe.
        let row = serde_json::json!({
            "provider": "openrouter-free",
            "remaining": 200_000_000_000_000_000_i64,
            "limit": 200_000_000_000_000_000_i64,
        });
        let result = std::panic::catch_unwind(|| pool(&row, &[]));
        assert!(
            result.is_ok(),
            "a big but valid free-tier pool must not crash the probe"
        );
    }

    /// OmniRoute's own terms-of-service flagging decides this, not a list of
    /// ours: a pool it marks `avoid` never reaches the user as an option.
    #[test]
    fn a_pool_flagged_avoid_is_dropped() {
        let summary = parse(
            r#"[{"provider":"groq","tos":"ok"},
                {"provider":"risky","tosStatus":"AVOID"},
                {"provider":"maybe","tos":"caution"}]"#,
        );
        let ids: Vec<&str> = summary.pools.iter().map(|p| p.provider.as_str()).collect();
        assert_eq!(ids, ["groq", "maybe"]);
        assert_eq!(summary.pools[1].tos_status.as_deref(), Some("caution"));
    }

    #[test]
    fn a_body_that_is_not_a_free_tier_document_is_not_pretended_to_be_one() {
        for body in ["<!doctype html><p>login</p>", "{\"ok\":true}", ""] {
            let summary = parse(body);
            assert!(!summary.available, "{body}");
            assert_eq!(summary.reason.as_deref(), Some(REASON_UNREADABLE), "{body}");
        }
        // An empty list, on the other hand, is an answer: nothing is free.
        let empty = parse("[]");
        assert!(empty.available);
        assert!(empty.pools.is_empty());
        assert_eq!(empty.reason, None);
    }

    /// A percentage the payload states outright wins over the one the counts
    /// imply, and an absurd one is clamped rather than truncated into nonsense.
    #[test]
    fn a_reported_percentage_wins_and_is_clamped() {
        let summary = parse(
            r#"[{"provider":"groq","remainingPercent":42,"remaining":1,"limit":100},
                {"provider":"mistral","remainingPercent":250},
                {"provider":"cerebras","remainingPercent":-5}]"#,
        );
        assert_eq!(summary.pools[0].remaining_percent, Some(42));
        assert_eq!(summary.pools[1].remaining_percent, Some(100));
        assert_eq!(summary.pools[2].remaining_percent, Some(0));
    }
}
