//! `/api/hq/v1/*` routes, split out of `route()` (ARCH-10).
//!
//! `route` returns `None` for every request it does not own, so the caller
//! falls through to the remaining arms in their original order. Status, body
//! and auth are unchanged by the move.

use super::*;

pub(super) fn route(
    inner: &Inner,
    request: &Request,
    method: &str,
    path: &[&str],
    project_id: Option<&str>,
) -> Option<Response> {
    // Ownership test for the arms moved so far: it goes away once every hq
    // arm lives here and the fallback is the final 404.
    let owned = matches!(
        (method, path),
        (_, ["api", "hq", "v1", "agent", ..])
            | ("GET", ["api", "hq", "v1", "runtime" | "plan" | "runs"])
            | ("GET", ["api", "hq", "v1", "context" | "changes"])
            | ("POST", ["api", "hq", "v1", "plan", "import"])
            | ("GET" | "POST", ["api", "hq", "v1", "goals"])
            | ("POST", ["api", "hq", "v1", "goals", _, "tasks"])
    );
    owned.then(|| handle(inner, request, method, path, project_id))
}

fn handle(
    inner: &Inner,
    request: &Request,
    method: &str,
    path: &[&str],
    project_id: Option<&str>,
) -> Response {
    let backend = inner.backend.as_ref();
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
        ("GET", ["api", "hq", "v1", resource]) if matches!(*resource, "context" | "changes") => {
            let project_id = match project_id {
                Some(value) if !value.is_empty() => value,
                _ => return Response::error(400, "projectId is required"),
            };
            let cursor = match request.query.get("cursor") {
                Some(value) => match value.parse::<i64>() {
                    Ok(value) if value >= 0 => value,
                    _ => return Response::error(400, "cursor must be a non-negative integer"),
                },
                None => 0,
            };
            if *resource == "changes" {
                let wait_ms = match request.query.get("waitMs") {
                    Some(value) => match value.parse::<u64>() {
                        Ok(value) if value <= 25_000 => value,
                        _ => return Response::error(400, "waitMs must be between 0 and 25000"),
                    },
                    None => 0,
                };
                if let Some(reply) = unknown_project(backend, Some(project_id)) {
                    return reply;
                }
                if wait_ms == 0 {
                    continuous_response(backend.continuous_changes(project_id, cursor))
                } else {
                    let Some(_permit) = try_acquire_connection(&inner.journal_waits) else {
                        return Response::error(
                            503,
                            "continuous journal waiting capacity exhausted",
                        );
                    };
                    continuous_response(
                        backend.wait_continuous_changes(project_id, cursor, wait_ms),
                    )
                }
            } else {
                if request.query.contains_key("waitMs") {
                    return Response::error(400, "waitMs is supported only by changes");
                }
                continuous_response(backend.continuous_context(project_id, cursor))
            }
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
        ("GET", ["api", "hq", "v1", "goals"]) => {
            let project_id = match project_id {
                Some(value) if !value.is_empty() => value,
                _ => return Response::error(400, "projectId is required"),
            };
            match backend.list_continuous_goals(project_id) {
                Ok(goals) => Response::ok(json!({ "goals": goals })),
                Err(err) => continuous_error(err),
            }
        }
        ("POST", ["api", "hq", "v1", "goals"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            if let Err(err) = only_keys(
                &body,
                &[
                    "projectId",
                    "objective",
                    "acceptanceCriteria",
                    "sourceGoalId",
                    "admit",
                ],
            ) {
                return Response::error(400, err);
            }
            let project_id = match required_str(&body, "projectId") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let objective = match required_str(&body, "objective") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let admit = match optional_bool(&body, "admit") {
                Ok(value) => value.unwrap_or(false),
                Err(err) => return Response::error(400, err),
            };
            match backend.create_continuous_goal(
                &project_id,
                &objective,
                optional_str(&body, "acceptanceCriteria"),
                optional_str(&body, "sourceGoalId"),
                admit,
            ) {
                Ok(goal) => Response::ok(json!({ "goal": goal })),
                Err(err) => continuous_error(err),
            }
        }
        ("POST", ["api", "hq", "v1", "goals", goal_id, "tasks"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let objective = match required_str(&body, "objective") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let owned_paths = match string_array(&body, "ownedPaths") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let dependencies = match string_array(&body, "dependencies") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            match backend.create_continuous_task(
                goal_id,
                &objective,
                optional_str(&body, "profileId"),
                owned_paths,
                dependencies,
            ) {
                Ok(task) => Response::ok(json!({ "task": task })),
                Err(err) => continuous_error(err),
            }
        }
        _ => unreachable!("route() only hands over owned arms"),
    }
}
