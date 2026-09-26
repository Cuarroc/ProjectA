# PR #25 review disposition (port/clean-02)

Reviewer: Nemotron 3 Ultra 550B (`kilo/nvidia/nemotron-3-ultra-550b-a55b:free`, Kilo, read-only),
one reviewer per the stage-B contract; author family is Claude. Raw answer:
`.pa/review_pr25_nemotron.md` (a first run ended without findings because the model
tried `cargo check`, which Kilo auto-rejects; the second run, told to use read/grep only,
is the one recorded). Prompt: `.pa/review_prompt_pr25.md`, candidate 0c3ba40.

| ID | Source | Severity | Finding | Disposition |
|----|--------|----------|---------|-------------|
| N1 | nemotron | medium | `a_respawned_queen_keeps_her_marching_orders` reads `args[0]` and does not assert exactly one spawn, so a broken respawn making several spawn calls could pass. | Rejected. Before this PR the queen was created through `create_queen` (one spawn) and respawned (second spawn), hence `[1]`; with the row inserted directly the respawn is the only spawn, so `[0]` is the respawn call. The test asserts kind, status, the `--append-system-prompt` flag and that the domain and worker id survive in it; a respawn that spawned something else first would fail on the flag or content assertion. The scenario is hypothetical, is not caused by this deletion, and tightening the test would cost a Rust build plus a CI run on a ready PR for no observed defect. |
| N2 | nemotron | low | Deleted workflows are still mentioned in `KNOWN_ISSUES.md`, `ci.yml`/`release.yml`/`audit.yml` comments, `docs/decisions.md`, `docs/ci-lokal.md`, `docs/setup/ollama-reviewers.md`, `scripts/ci/*.sh` comments. | Split. **Accepted** for the two live docs that describe the deleted files as present: `docs/ci-lokal.md` (act limits table and "Was gar nicht lokal gehört" list) and `docs/setup/ollama-reviewers.md` ("`review.yml` ist ruhend") now say the workflows are removed. **Rejected** for `docs/decisions.md`, `KNOWN_ISSUES.md` and the dated incident comments in `ci.yml`, `release.yml`, `audit.yml`, `scripts/ci/*.sh`: they are a dated record of what happened in `review.yml` (lost exit code, OIDC) and stay accurate as history; the workflow files would also cost a full Windows-lane run. |
| N3 | nemotron | low | Comment in `SettingsView.tsx` mentions the removed npm package. | Rejected: the reviewer itself calls it correct. The comment explains why `plugin:process\|restart` is invoked directly; the Rust plugin and the `process:allow-restart` capability stay. |

The reviewer also confirmed: no remaining reference to a removed symbol, `ERR_QUEEN_RETIRED` and the
queen reads kept, the Rust `tauri-plugin-process` kept, lane-plan/mergify/ci config free of the deleted
workflows, `package-lock.json` consistent.
