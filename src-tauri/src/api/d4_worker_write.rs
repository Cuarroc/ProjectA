//! Compiling RED: parent retains all original worker-write arms.
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
    assert_eq!(
        reply(inner, "POST", "/api/workers/wk-1/send", r#"{"text":""}"#),
        Response::ok(json!({"ok":true}))
    );
    assert_eq!(
        reply(inner, "POST", "/api/workers/missing/send", r#"{"text":""}"#).status,
        409
    );
    assert_eq!(reply(inner, "POST", "/api/workers", "{}").status, 400);
    assert_eq!(
        reply(inner, "POST", "/api/workers/wk-1/merge", "").status,
        200
    );
    let read = request("GET", "/api/workers", "invalid json");
    assert!(route(inner, &read, "GET", &["api", "workers"], None, None).is_none());
    assert_none(inner, "DELETE", "/api/workers");
    assert_none(inner, "GET", "/api/workers/wk-1/send");
    assert_none(inner, "GET", "/api/workers/wk-1/merge");
    assert_none(inner, "POST", "/api/workers/wk-1/foreign");
}
