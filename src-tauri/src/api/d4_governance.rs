//! Compiling-red proposal: production parent still owns all original arms.
use super::*;

pub(super) fn route(
    _inner: &Inner,
    _request: &Request,
    _method: &str,
    _path: &[&str],
    _project_id: Option<&str>,
    _status: Option<&str>,
) -> Option<Response> {
    None
}

#[cfg(test)]
pub(super) fn contract(inner: &Inner) {
    let invalid = reply(
        inner,
        "POST",
        "/api/recommendations/rc-1/status",
        r#"{"status":"other"}"#,
    );
    assert_eq!(invalid.status, 400);
    let accepted = reply(
        inner,
        "POST",
        "/api/recommendations/rc-1/status",
        r#"{"status":"dismissed"}"#,
    );
    assert_eq!(accepted, Response::ok(json!({"ok": true})));
    assert_eq!(
        reply(
            inner,
            "POST",
            "/api/learnings/lr-1/approve",
            r#"{"text":" "}"#
        )
        .status,
        400
    );
    assert_none(inner, "GET", "/api/learnings/lr-1/approve");
}
