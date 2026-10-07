//! Whole-arm governance routes from ARCH-D4.
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
        ("POST", ["api", "recommendations", _, "status"])
            | ("GET", ["api", "learnings"])
            | ("POST", ["api", "learnings", _, "approve"])
            | ("POST", ["api", "learnings", _, "reject"])
            | ("GET", ["api", "activity"])
    );
    owned.then(|| handle(inner, request, method, path, project_id, status))
}

fn handle(
    inner: &Inner,
    request: &Request,
    method: &str,
    path: &[&str],
    project_id: Option<&str>,
    status: Option<&str>,
) -> Response {
    let backend = inner.backend.as_ref();
    match (method, path) {
        ("POST", ["api", "recommendations", id, "status"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let status = match required_str(&body, "status") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            // The vocabulary is the one part of this request the route can
            // decide on its own, as with the GitHub url and the digest date, so
            // it is decided here and stays a 400 once the core speaks in
            // statuses. That is not symmetry for its own sake: the core's own
            // refusal reads `unknown recommendation status: …` (`scout.rs:434`),
            // which opens with [`crate::workers::ERR_UNKNOWN`], so
            // [`error_status`] would answer 404 - and 404 here means "an id that
            // names nothing", which this is not. The check has to stay in front
            // of the core, however redundant it looks beside `scout.rs`.
            // Behind it the core's own words are read: this route
            // answered 400 for every failure, one line below the `accept` route
            // that had already learned to tell them apart - an id that names
            // nothing and a store that fell over both came back as the caller's
            // mistake, which tells a script to fix a request that was fine.
            if status != crate::store::REC_ACCEPTED && status != crate::store::REC_DISMISSED {
                return Response::error(
                    400,
                    format!(
                        "unknown recommendation status: {status} (expected {} or {})",
                        crate::store::REC_ACCEPTED,
                        crate::store::REC_DISMISSED
                    ),
                );
            }
            // Not [`core_response`]: the reply is `{ok: true}`, which a
            // serialized `()` is not. Only the reading of the failure is shared.
            match backend.set_recommendation_status(id, &status) {
                Ok(()) => Response::ok(json!({ "ok": true })),
                Err(err) => Response::error(error_status(&err, StatusPolicy::Core), err),
            }
        }

        // -- learnings (Phase 14) --------------------------------------------
        ("GET", ["api", "learnings"]) => {
            if let Some(reply) = unknown_project(backend, project_id) {
                return reply;
            }
            into_response(backend.list_learnings(project_id, status))
        }

        ("POST", ["api", "learnings", id, "approve"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            // Unlike `worker send`, blank is not a legitimate value here: an
            // empty learning would put an empty bullet into the playbook.
            let text = match required_str(&body, "text") {
                Ok(value) => value,
                Err(_) => return Response::error(400, "text is required and must not be empty"),
            };
            match backend.approve_learning(id, &text) {
                Ok(()) => Response::ok(json!({ "ok": true })),
                Err(err) => Response::error(error_status(&err, StatusPolicy::Verdict), err),
            }
        }

        ("POST", ["api", "learnings", id, "reject"]) => match backend.reject_learning(id) {
            Ok(()) => Response::ok(json!({ "ok": true })),
            Err(err) => Response::error(error_status(&err, StatusPolicy::Verdict), err),
        },

        // -- activity feed (Phase 16) --------------------------------------
        ("GET", ["api", "activity"]) => {
            // Read-only by construction: the feed is a view over tables the
            // other routes write. An absent or unreadable limit is the
            // default, anything above the cap is the cap.
            if let Some(reply) = unknown_project(backend, project_id) {
                return reply;
            }
            let limit = request
                .query
                .get("limit")
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(50)
                .min(200);
            into_response(backend.get_activity(project_id, limit))
        }

        _ => unreachable!("ownership checked before handling"),
    }
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
