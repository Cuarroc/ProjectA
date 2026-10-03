//! `/api/hq/v1/*` routes, split out of `route()` (ARCH-10).
//!
//! `route` returns `None` for every request it does not own, so the caller
//! falls through to the remaining arms in their original order. Status, body
//! and auth are unchanged by the move.

use super::*;

pub(super) fn route(
    backend: &dyn ControlBackend,
    request: &Request,
    method: &str,
    path: &[&str],
    project_id: Option<&str>,
) -> Option<Response> {
    // Ownership test for this slice only: it goes away with ARCH-10b, when
    // every hq arm lives here and the fallback is the final 404.
    let owned = matches!(
        (method, path),
        (_, ["api", "hq", "v1", "agent", ..])
            | ("GET", ["api", "hq", "v1", "runtime" | "plan" | "runs"])
            | ("POST", ["api", "hq", "v1", "plan", "import"])
    );
    owned.then(|| handle(backend, request, method, path, project_id))
}

fn handle(
    backend: &dyn ControlBackend,
    request: &Request,
    method: &str,
    path: &[&str],
    project_id: Option<&str>,
) -> Response {
    match (method, path) {
        (_, ["api", "hq", "v1", "agent", ..]) => {
            Response::error(403, "this route requires a scoped run credential")
        }
        ("GET", ["api", "hq", "v1", "runtime"]) => {
            continuous_response(backend.continuous_runtime())
        }
        ("GET", ["api", "hq", "v1", "plan"]) => {
            if request
                .query
                .keys()
                .any(|key| !matches!(key.as_str(), "projectId" | "planId" | "revision"))
            {
                return Response::error(400, "unknown plan query field");
            }
            let project_id = match project_id.map(str::trim).filter(|value| !value.is_empty()) {
                Some(value) => value,
                None => return Response::error(400, "projectId is required"),
            };
            let plan_id = match request
                .query
                .get("planId")
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                Some(value) => value,
                None => return Response::error(400, "planId is required"),
            };
            let revision = match request.query.get("revision") {
                Some(raw) => match raw.parse::<i64>() {
                    Ok(value) if value > 0 => Some(value),
                    _ => return Response::error(400, "revision must be a positive integer"),
                },
                None => None,
            };
            plan_response(backend.development_plan(project_id, plan_id, revision))
        }
        ("POST", ["api", "hq", "v1", "plan", "import"]) => {
            if !request.query.is_empty() {
                return Response::error(400, "plan import does not accept query fields");
            }
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(error) => return Response::error(400, error),
            };
            if let Err(error) = only_keys(
                &body,
                &[
                    "projectId",
                    "planId",
                    "expectedProjectionRevision",
                    "rollbackReason",
                ],
            ) {
                return Response::error(400, error);
            }
            let project_id = match required_str(&body, "projectId") {
                Ok(value) => value,
                Err(error) => return Response::error(400, error),
            };
            let plan_id = match required_str(&body, "planId") {
                Ok(value) => value,
                Err(error) => return Response::error(400, error),
            };
            let expected = match body
                .get("expectedProjectionRevision")
                .and_then(Value::as_i64)
            {
                Some(value) if (0..i64::MAX).contains(&value) => value,
                _ => return Response::error(
                    400,
                    "expectedProjectionRevision must be non-negative and below the maximum integer",
                ),
            };
            let rollback_reason = match body.get("rollbackReason") {
                None => None,
                Some(Value::String(value)) => Some(value.as_str()),
                Some(_) => return Response::error(400, "rollbackReason must be a string"),
            };
            plan_response(backend.import_development_plan(
                &project_id,
                &plan_id,
                expected,
                rollback_reason,
            ))
        }
        ("GET", ["api", "hq", "v1", "runs"]) => {
            let project_id = match project_id {
                Some(value) if !value.is_empty() => value,
                _ => return Response::error(400, "projectId is required"),
            };
            if let Some(reply) = unknown_project(backend, Some(project_id)) {
                return reply;
            }
            continuous_response(backend.development_records(project_id))
        }
        _ => unreachable!("route() only hands over owned arms"),
    }
}
