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
    assert_eq!(reply(inner, "POST", "/api/scout", "{}").status, 400);
    let body = r#"{"projectId":"pj-1","urls":["  https://example.com/a  "," ",7]}"#;
    assert_eq!(reply(inner, "POST", "/api/scout/triage", body).status, 200);
    assert_none(inner, "GET", "/api/scout/triage");
    assert_none(inner, "POST", "/api/scout/extra");
}
