//! Whole-arm worker write routes from ARCH-D4.
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
        ("POST", ["api", "workers"])
            | ("POST", ["api", "workers", _, "send"])
            | ("POST", ["api", "workers", _, "merge"])
    );
    owned.then(|| handle(inner, request, method, path, project_id, status))
}

fn handle(
    inner: &Inner,
    request: &Request,
    method: &str,
    path: &[&str],
    _project_id: Option<&str>,
    _status: Option<&str>,
) -> Response {
    let backend = inner.backend.as_ref();
    match (method, path) {
        ("POST", ["api", "workers"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let project_id = match required_str(&body, "projectId") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let task = match required_str(&body, "task") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let profile_id = body
                .get("profileId")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(DEFAULT_PROFILE);
            core_response(backend.create_worker(
                &project_id,
                &task,
                profile_id,
                optional_str(&body, "spawnedBy"),
            ))
        }

        ("POST", ["api", "workers", worker_id, "send"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            // An empty line is a legitimate thing to send - it is how you say
            // "yes, go on" to an agent waiting at a prompt - so `text` only has
            // to be present, not filled in.
            let Some(text) = body.get("text").and_then(Value::as_str) else {
                return Response::error(400, "text is required");
            };
            match backend.send_to_worker(worker_id, text) {
                Ok(()) => Response::ok(json!({ "ok": true })),
                // No session for this id: either the worker never existed or
                // its agent has exited. The backend cannot tell those apart, so
                // neither can this - and 409 is true of both, where 404 would
                // claim a worker that is merely finished does not exist.
                Err(err) if err.contains("has no running agent") => Response::error(409, err),
                Err(err) => Response::error(500, err),
            }
        }

        ("POST", ["api", "workers", worker_id, "merge"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            // An empty body is the ordinary call. The flag is read under both
            // spellings: `removeWorktree` is the house style everywhere else on
            // this port, `remove_worktree` is what the CLI flag is called.
            let remove_worktree = body
                .get("removeWorktree")
                .or_else(|| body.get("remove_worktree"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            match backend.merge_worker(worker_id, remove_worktree) {
                Ok(worker) => into_response(Ok(worker)),
                Err(err) => Response::error(error_status(&err, StatusPolicy::Merge), err),
            }
        }

        _ => unreachable!("ownership checked before handling"),
    }
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
