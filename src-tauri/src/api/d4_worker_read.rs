//! Compiling-red proposal: parent retains all original worker read arms.
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
        reply(inner, "POST", "/api/queens", "invalid json"),
        Response::error(410, crate::workers::ERR_QUEEN_RETIRED)
    );
    assert_eq!(
        reply(inner, "GET", "/api/workers/missing/messages", ""),
        Response::error(404, "unknown worker: missing")
    );
    assert_eq!(reply(inner, "GET", "/api/board", "").status, 200);
    assert_eq!(reply(inner, "GET", "/api/workers", "").status, 200);
    assert_eq!(reply(inner, "GET", "/api/workers/missing", "").status, 404);
    assert_none(inner, "GET", "/api/queens");
    assert_none(inner, "POST", "/api/workers");
    assert_none(inner, "POST", "/api/workers/missing");
    assert_none(inner, "POST", "/api/workers/missing/messages");
    assert_none(inner, "POST", "/api/board");
}
