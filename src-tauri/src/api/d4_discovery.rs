//! Whole-arm discovery routes from ARCH-D4.
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
        ("POST", ["api", "scout"])
            | ("POST", ["api", "scout", "triage"])
            | ("GET", ["api", "recommendations"])
            | ("POST", ["api", "recommendations"])
            | ("POST", ["api", "recommendations", _, "accept"])
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
        // -- scout and recommendations (Phase 7.1) -------------------------
        ("POST", ["api", "scout"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let project_id = match required_str(&body, "projectId") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            core_response(backend.create_scout(&project_id))
        }

        ("POST", ["api", "scout", "triage"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let project_id = match required_str(&body, "projectId") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let urls: Vec<String> = body
                .get("urls")
                .and_then(Value::as_array)
                .map(|urls| {
                    urls.iter()
                        .filter_map(Value::as_str)
                        .map(str::trim)
                        .filter(|url| !url.is_empty())
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            if urls.is_empty() {
                return Response::error(400, "urls is required");
            }
            core_response(backend.triage_repos(&project_id, &urls))
        }

        ("GET", ["api", "recommendations"]) => {
            if let Some(reply) = unknown_project(backend, project_id) {
                return reply;
            }
            into_response(backend.list_recommendations(project_id))
        }

        ("POST", ["api", "recommendations"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let project_id = match required_str(&body, "projectId") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let title = match required_str(&body, "title") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let rationale = match required_str(&body, "rationale") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            core_response(backend.add_recommendation(
                &project_id,
                &title,
                &rationale,
                optional_str(&body, "url"),
                optional_str(&body, "effort"),
            ))
        }

        ("POST", ["api", "recommendations", id, "accept"]) => {
            core_response(backend.accept_recommendation(id))
        }

        _ => unreachable!("ownership checked before handling"),
    }
}

#[cfg(test)]
pub(super) fn contract(inner: &Inner) {
    assert_eq!(reply(inner, "POST", "/api/scout", "{}").status, 400);
    let body = r#"{"projectId":"pj-1","urls":["  https://example.com/a  "," ",7]}"#;
    assert_eq!(reply(inner, "POST", "/api/scout/triage", body).status, 200);
    assert_none(inner, "GET", "/api/scout/triage");
    assert_none(inner, "POST", "/api/scout/extra");
}
