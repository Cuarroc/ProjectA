//! Whole-arm queue routes from ARCH-D4.
use super::*;

pub(super) fn route(
    inner: &Inner,
    request: &Request,
    method: &str,
    path: &[&str],
    project_id: Option<&str>,
    _status: Option<&str>,
) -> Option<Response> {
    let owned = matches!(
        (method, path),
        ("POST", ["api", "queue"])
            | ("GET", ["api", "queue"])
            | ("POST", ["api", "queue", _, "cancel"])
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
        ("POST", ["api", "queue"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let project_id = match required_str(&body, "projectId") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let raw_text = match required_str(&body, "rawText") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let profile_id = body
                .get("profileId")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string);
            let sharpen = body
                .get("sharpen")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let priority = body
                .get("priority")
                .and_then(Value::as_i64)
                .and_then(|value| i32::try_from(value).ok());
            let spawned_by = optional_str(&body, "spawnedBy");
            core_response(backend.enqueue_task(
                &project_id,
                &raw_text,
                profile_id,
                sharpen,
                priority,
                spawned_by,
            ))
        }

        ("GET", ["api", "queue"]) => {
            if let Some(reply) = unknown_project(backend, project_id) {
                return reply;
            }
            into_response(backend.list_queue(project_id))
        }

        ("POST", ["api", "queue", id, "cancel"]) => core_response(
            backend
                .cancel_queued_task(id)
                .map(|()| json!({ "ok": true })),
        ),

        _ => unreachable!("ownership checked before handling"),
    }
}

#[cfg(test)]
pub(super) fn contract(inner: &Inner) {
    let body =
        r#"{"projectId":"pj-1","rawText":"task","profileId":" custom ","priority":2147483648}"#;
    let result = reply(inner, "POST", "/api/queue", body);
    assert_eq!(result.status, 200);
    let body: Value = serde_json::from_str(&result.body).unwrap();
    assert_eq!(body["profileId"], " custom ");
    assert_eq!(body["priority"], 0);
    assert_eq!(body["status"], "ready");
    assert_eq!(body["rawText"], "task");
    assert_eq!(
        reply(inner, "POST", "/api/queue", "invalid json").status,
        400
    );
    assert_eq!(reply(inner, "POST", "/api/queue", "{}").status, 400);
    assert_eq!(
        reply(inner, "GET", "/api/queue", "invalid json"),
        Response::ok(json!([]))
    );
    let scoped = request("GET", "/api/queue", "");
    assert_eq!(
        route(
            inner,
            &scoped,
            "GET",
            &["api", "queue"],
            Some("pj-nope"),
            None
        )
        .unwrap()
        .status,
        404
    );
    assert_eq!(
        reply(inner, "POST", "/api/queue/tq-1/cancel", "invalid json"),
        Response::ok(json!({"ok": true}))
    );
    for (id, status) in [("tq-nope", 404), ("tq-busy", 409), ("tq-boom", 500)] {
        assert_eq!(
            reply(
                inner,
                "POST",
                &format!("/api/queue/{id}/cancel"),
                "invalid json"
            )
            .status,
            status
        );
    }
    for (method, path) in [
        ("DELETE", "/api/queue"),
        ("GET", "/api/queue/tq-1/cancel"),
        ("POST", "/api/queue/tq-1/extra"),
    ] {
        assert_none(inner, method, path);
    }
    let foreign = request("POST", "/api/workers", "invalid json");
    assert!(route(inner, &foreign, "POST", &["api", "workers"], None, None).is_none());
}
