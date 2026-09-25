//! W2-04f: planning writes through a scoped run credential need the
//! coordinator dispatch role.
//!
//! A run credential used to be refused on every route outside
//! `/api/hq/v1/agent/`. The four planning writes below are now open to it
//! exactly when its run dispatches as `coordinator`. The role is resolved per
//! request from the grant's run under its owner/fence (W2-04 `run_role`),
//! never from the request. Implementer, integrator and reviewer runs are
//! refused with their role named; a role that does not resolve is refused as
//! well (fail closed).
//!
//! Two operator decisions stay out of a coordinator's reach: admitting a new
//! autonomous root (its own budget) and assigning the coordinator role (which
//! would multiply planning authority). Not checked here, and a follow-up of
//! review pr135: whether the target project, goal or task belongs to the
//! coordinator's own run.
//!
//! Role and authority are read before the write, in a separate transaction,
//! like on every agent route. A fence that moves in between lets that one
//! write through; the planning writes themselves do not take the fence.
//!
//! The operator token (window, `pa`, DevHQ) is not a dispatch credential and
//! plans as before.
use super::*;
use crate::store::development_launches::DispatchRole;

/// Plan import, goal and task creation, team assignment. Reordering and
/// priorities have no route of their own; the legacy `/api/queue` and the
/// continuous `control` switch are not planning and stay operator-only.
pub(super) fn is_planning(request: &Request) -> bool {
    if request.method != "POST" {
        return false;
    }
    let segments = request.segments();
    let path: Vec<&str> = segments.iter().map(String::as_str).collect();
    matches!(
        path.as_slice(),
        ["api", "hq", "v1", "plan", "import"]
            | ["api", "hq", "v1", "goals"]
            | ["api", "hq", "v1", "goals", _, "tasks"]
            | ["api", "hq", "v1", "tasks", _, "assignment"]
    )
}

const NEEDS_COORDINATOR: &str = "planning requires the coordinator dispatch role";

pub(super) fn handle(
    inner: &Inner,
    request: &Request,
    run: &str,
    owner: &str,
    fence: i64,
) -> Response {
    // The same limits as every other run-credential route.
    if request.headers.contains_key(VERDICT_TOKEN_HEADER) || !request.query.is_empty() {
        return Response::error(
            403,
            "run credentials cannot carry verdict authority or override scope",
        );
    }
    match inner.backend.agent_dispatch_role(run, owner, fence) {
        Ok(DispatchRole::Coordinator) => {}
        Ok(role) => {
            return Response::error(
                403,
                format!(
                    "{NEEDS_COORDINATOR}; this run credential dispatches as {}",
                    role.as_str()
                ),
            )
        }
        Err(error) => {
            return Response::error(
                403,
                format!(
                    "{NEEDS_COORDINATOR}; the role of this run credential is unresolved: {error}"
                ),
            )
        }
    }
    if admits_new_root(request) {
        return Response::error(
            403,
            "admitting a new autonomous root goal is an operator decision; a coordinator \
             admits only replans of an existing goal (sourceGoalId)",
        );
    }
    if assigns_coordinator(request) {
        return Response::error(
            403,
            "assigning the coordinator role is an operator decision; a coordinator \
             assigns only implementer, reviewer and integrator work",
        );
    }
    route(inner, request, VerdictProof::Absent)
}

/// `POST /api/hq/v1/goals` with `admit: true` and no `sourceGoalId` opens a
/// new root with its own time and token budget. An agent cannot grant itself
/// that budget (AGENTS.md); a replan spends its root's. Read with the route's
/// own helpers, so a blank `sourceGoalId` counts as absent here exactly as it
/// does there. A body the route would refuse with 400 is left to the route.
fn admits_new_root(request: &Request) -> bool {
    if request.segments() != ["api", "hq", "v1", "goals"] {
        return false;
    }
    let Ok(body) = parse_body(&request.body) else {
        return false;
    };
    matches!(optional_bool(&body, "admit"), Ok(Some(true)))
        && optional_str(&body, "sourceGoalId").is_none()
}

/// `POST /api/hq/v1/tasks/<id>/assignment` with the coordinator role would
/// hand planning authority to another run (review pr135 G2/K2). Parsed as the
/// route parses it; the store trims the role, so this compares it trimmed. A
/// body the route would refuse with 400 is left to the route.
fn assigns_coordinator(request: &Request) -> bool {
    let segments = request.segments();
    let path: Vec<&str> = segments.iter().map(String::as_str).collect();
    if !matches!(
        path.as_slice(),
        ["api", "hq", "v1", "tasks", _, "assignment"]
    ) {
        return false;
    }
    serde_json::from_str::<crate::store::team_assignments::AssignmentRequest>(&request.body)
        .is_ok_and(|body| body.role.trim() == DispatchRole::Coordinator.as_str())
}
