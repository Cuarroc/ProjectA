//! ARCH-D4 queue RED proposal; parent still contains all original arms.
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
