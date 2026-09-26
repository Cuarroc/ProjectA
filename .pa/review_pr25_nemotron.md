Now I'll search for any remaining references to the removed symbols and check for the issues mentioned in the review request.
Now let me check the test more carefully and look for any other potential issues:
Now I have a complete picture. Let me compile the findings:

---

## Review Findings for PR #25

### High Findings: None

### Medium Findings:

1. **Respawn test for queen may not catch a broken respawn if multiple spawn calls occur** (src-tauri/src/workers.rs:6007)
   - The modified test `a_respawned_queen_keeps_her_marching_orders` uses `agents.args.lock().unwrap()[0].clone()` to get the first (and expected only) spawn call.
   - If the respawn logic were broken and made multiple spawn calls (e.g., one failing then one succeeding), the test would only check the first call and might pass incorrectly.
   - The original test (before deletion) created a queen then respawned it, so it used index `[1]` for the respawn call. Now with direct row insertion, only one call exists, so `[0]` is correct — but the test doesn't assert that exactly one call was made.

### Low Findings:

2. **Historical references to deleted workflows remain in documentation and comments** (multiple files)
   - `KNOWN_ISSUES.md:49`, `ci.yml:133`, `release.yml:17,42`, `audit.yml:20`, `docs/ci-lokal.md:120-134`, `docs/decisions.md:201,242,270,659,679`, `scripts/ci/doctor.sh:194`, `scripts/ci/no-masked-output.sh:8`, `scripts/ci/workflow-shell.sh:11`, `scripts/ci/actions-pinned.sh:9`
   - These are all historical comments documenting past issues (pipefail, OIDC, OpenRouter key handling) — not active code references. They don't affect functionality but could confuse future readers.

3. **Comment in SettingsView.tsx references removed npm package** (src/components/SettingsView.tsx:544)
   - The comment explains why `plugin:process|restart` is invoked directly "keeps the maybe-absent npm package out of the build" — this is correct documentation of the design decision, not a bug.

### Correct/Expected (No Findings):

- **`tauri-plugin-process` Rust crate correctly retained** — Cargo.toml/Cargo.lock still have it; `main.rs` calls `tauri_plugin_process::init()`; capability `process:allow-restart` in `default.json`; SettingsView invokes `plugin:process|restart` directly. This matches the requirement: "the Rust plugin stays".
- **`ERR_QUEEN_RETIRED` constant correctly retained** — Used in `api.rs:1609` for the 410 response on POST `/api/queens`. The requirement explicitly states "Queen READS must stay: the 410 route".
- **`queen_domain` and `queen_profile` correctly retained** — Used in respawn logic (`workers.rs:2491-2494`) and tested (`the_queen_domain_prefix_round_trips`, `a_queen_carries_her_role_above_the_playbook`, `the_queen_domain_arrives_as_data_not_instructions`, `the_whole_domain_is_inside_the_block_and_nowhere_else`).
- **No remaining references to removed symbols** — `create_queen`, `create_queen_as_role`, `queen_task`, `ControlBackend::create_queen`, `ApiBackend::create_queen`, `FakeBackend::create_queen`, `isEmptySummary`, `saveOnboardingHints`, `assertCitations` — all fully removed with no dynamic/string references remaining.
- **Lane-plan and mergify configs clean** — No references to deleted workflow files in `.mergify.yml`, `lane-plan.sh`, or `ci.yml` job definitions.
- **Lockfile consistent** — `package-lock.json` correctly removes `@tauri-apps/plugin-process`; `Cargo.lock` retains `tauri-plugin-process` (Rust crate, different package).
- **API test for 410 route exists** — `a_queen_is_no_longer_started_through_the_api` in `api.rs:5714` tests the POST `/api/queens` 410 response.

---

### Summary

| Category | Count |
|----------|-------|
| High     | 0     |
| Medium   | 1     |
| Low      | 3     |

The PR correctly removes the retired queen creation path, unused functions, npm dependency, and dormant workflows. The medium finding is a test robustness concern; the low findings are documentation hygiene.
