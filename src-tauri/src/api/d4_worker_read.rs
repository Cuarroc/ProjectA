//! Whole-arm worker read routes from ARCH-D4.
use super::*;

pub(super) fn route(
    inner: &Inner,
    request: &Request,
    method: &str,
    path: &[&str],
    project_id: Option<&str>,
    status: Option<&str>,
) -> Option<Response> {
    let owned = matches!(
        (method, path),
        ("POST", ["api", "queens"])
            | ("GET", ["api", "workers"])
            | ("GET", ["api", "workers", _])
            | ("GET", ["api", "workers", _, "messages"])
            | ("GET", ["api", "board"])
    );
    owned.then(|| handle(inner, request, method, path, project_id, status))
}

fn handle(
    inner: &Inner,
    request: &Request,
    method: &str,
    path: &[&str],
    project_id: Option<&str>,
    _status: Option<&str>,
) -> Response {
    let backend = inner.backend.as_ref();
    match (method, path) {
        ("POST", ["api", "queens"]) => {
            // Rev 9: queens remain readable. A 410 is the write-route refusal,
            // not a missing handler — GET is already 405.
            Response::error(410, crate::workers::ERR_QUEEN_RETIRED)
        }

        ("GET", ["api", "workers"]) => {
            if let Some(reply) = unknown_project(backend, project_id) {
                return reply;
            }
            into_response(backend.list_workers(project_id))
        }

        ("GET", ["api", "workers", worker_id]) => match backend.worker_state(worker_id) {
            Ok(Some(state)) => into_response(Ok(state)),
            Ok(None) => Response::error(404, format!("unknown worker: {worker_id}")),
            Err(err) => Response::error(500, err),
        },

        ("GET", ["api", "workers", worker_id, "messages"]) => {
            // `list_messages` answers an unknown id with an empty set, which
            // reads exactly like a worker that has not said anything yet. Ask
            // first, so a typo in the id is a 404 here as it is one segment up.
            match backend.worker_state(worker_id) {
                Ok(Some(_)) => {}
                Ok(None) => return Response::error(404, format!("unknown worker: {worker_id}")),
                Err(err) => return Response::error(500, err),
            }
            let limit = request
                .query
                .get("limit")
                .and_then(|value| value.parse().ok());
            into_response(backend.list_worker_messages(worker_id, limit))
        }

        ("GET", ["api", "board"]) => {
            if let Some(reply) = unknown_project(backend, project_id) {
                return reply;
            }
            into_response(backend.board(project_id))
        }

        _ => unreachable!("ownership checked before handling"),
    }
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
    let write = request("POST", "/api/workers", "invalid json");
    assert!(route(inner, &write, "POST", &["api", "workers"], None, None).is_none());
    assert_none(inner, "POST", "/api/workers/missing");
    assert_none(inner, "POST", "/api/workers/missing/messages");
    assert_none(inner, "POST", "/api/board");
}
