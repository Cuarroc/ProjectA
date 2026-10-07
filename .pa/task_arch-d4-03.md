# ARCH-D4 serial slice 3: worker read routes
Status: aktiv

Source: docs/PLAN.md ARCH-D4; docs/plan/v1.6.0/plan.md section3.
Decision: ARCH-D4-PLAN rev1, serial-total300, answer6b733c02.
Base:153e54e04abfb344f5063ee2f798d81aa2d8029d, actual Mergify PR625.
Chain baseline20d0e32e2a6aa37b5ebc5e704056d93c362da2a0/api8164.
Existing Root only, Chief dispatch453bc36f; exclusive api.rs, warm slotB/jobs1.
Move unchanged POST queens and GET workers/list/id/messages/board only.
Keep auth/verdict/HQ/body ordering, remaining writes and404/405 fallback.
Preserve exact410/404/500/JSON/project/limit handling and full surviving merge arm.
Keep Part2 governance160 and eight accepted contract lines unchanged.
Before every worker/build observe model, native quota/rules, RAM>=1.5GiB, Cargo/rustc<=2.
Measure all additions+deletions<=300 at RED/final/eachcommit/push incl this spec.
Pre-code critique actualKimi d909c12f; Root full disposition e0c263a6.
Original reviewed --lib invocation was incorrect; API is --bin projecta.
Exact: cargo test --manifest-path src-tauri/Cargo.toml --bin projecta api::tests::d4_routes_preserve_dispatch_and_fallback -- --exact --nocapture
Require exactly1 compiled RED, owned ARCH-D4 route panic/Cargo101; GREEN0.
Original parent arms remain at RED; complete minimal None stub/contract below.
Retained public witnesses: workers_can_be_listed_filtered_and_read_one_at_a_time,
a_queen_is_no_longer_started_through_the_api, a_listing_route_refuses_an_unknown_project,
messages_for_an_unknown_worker_are_a_404_not_an_empty_list, observed full prepush.
Secret scan and normal hooks; own fullprepush/SHA/path/NICHTABGEDECKT.
Two actual outside-OpenAI TierA reviews, every finding candidate-bound/disposed.
One draftPR; real full early WIN01 before ready, then ordinary checks/Mergify only.
API prospective7975/cumulative189: final>=300 chain criterion remains open.
No release/install/delete/newhelper/QA/config changes.

## Compiling RED stub and complete private contract
```rust
//! Compiling-red proposal: parent retains all original worker read arms.
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
    assert_none(inner, "POST", "/api/workers");
    assert_none(inner, "POST", "/api/workers/missing");
    assert_none(inner, "POST", "/api/workers/missing/messages");
    assert_none(inner, "POST", "/api/board");
}
```
