//! Serial ARCH-D4 delegation; only exact verb/path pairs are owned.
use super::*;
#[path = "d4_discovery.rs"]
mod discovery;
#[path = "d4_governance.rs"]
mod governance;
#[path = "d4_worker_read.rs"]
mod worker_read;

pub(super) fn route(
    inner: &Inner,
    request: &Request,
    method: &str,
    path: &[&str],
    project_id: Option<&str>,
    status: Option<&str>,
) -> Option<Response> {
    type Router =
        fn(&Inner, &Request, &str, &[&str], Option<&str>, Option<&str>) -> Option<Response>;
    let routers: &[Router] = &[discovery::route, governance::route, worker_read::route];
    routers
        .iter()
        .find_map(|route| route(inner, request, method, path, project_id, status))
}

#[cfg(test)]
fn request(method: &str, path: &str, body: &str) -> Request {
    Request {
        method: method.into(),
        path: path.into(),
        query: HashMap::new(),
        headers: HashMap::new(),
        body: body.into(),
    }
}

#[cfg(test)]
fn reply(inner: &Inner, method: &str, path: &str, body: &str) -> Response {
    let request = request(method, path, body);
    let segments = request.segments();
    let path: Vec<&str> = segments.iter().map(String::as_str).collect();
    route(inner, &request, method, &path, None, None).expect("owned ARCH-D4 route")
}

#[cfg(test)]
fn assert_none(inner: &Inner, method: &str, path: &str) {
    let request = request(method, path, "invalid json");
    let segments = request.segments();
    let path: Vec<&str> = segments.iter().map(String::as_str).collect();
    assert!(route(inner, &request, method, &path, None, None).is_none());
}

#[cfg(test)]
pub(super) fn assert_contract(inner: &Inner) {
    discovery::contract(inner);
    governance::contract(inner);
    worker_read::contract(inner);
    assert_none(inner, "POST", "/api/not-owned");
}
