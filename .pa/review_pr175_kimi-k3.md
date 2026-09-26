# Review: pr175 — kimi-k3

- Autor des Artefakts: claude (branch claude/plan-01-decisions)
- Reviewer: kimi-k3 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `kimi-k3:cloud`, bedient `kimi-k3`
- Datum: 2026-09-25 05:30 UTC, Dauer 364 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_pr175.md` (356516 Zeichen)

## Roh-Urteil des Reviewers

## Review findings — PR #175 (PLAN-01)

**F-1 (medium) — AGENTS.md states CI-03's not-yet-merged behavior as current fact, contradicting SKILL.md**
- `AGENTS.md`, "Pull requests and CI minutes": "CI runs only when a PR is marked ready **and in the merge queue**"
- `.agents/skills/projecta-workflow/SKILL.md` §6.2 (and the identical `.claude/` copy): "Every push to a ready PR costs a CI run."
- `docs/PLAN.md`, M1: "| CI-03 | Actions-Kosten senken: CI nur bei „ready" und in der Queue, … | M | ci | **PR #149** |" — i.e. the new trigger behavior is still an open PR.
Until CI-03 lands, the two rule documents tell workers opposite things about when CI minutes burn. Suggested fix: mark the AGENTS.md sentence as effective with CI-03 / after merge of #149, or align both documents to the same (current) behavior and flip it in the CI-03 PR.

**F-2 (medium) — README left on the old "PR at the end" flow, contradicting rule 4**
- `README.md` (unchanged context line in the diff): "Pull requests: one PR per package, **opened at the end** and kept as a draft until re[ady]"
- `AGENTS.md`, rule 4: "Commit *and push* after every green step; nothing stays only local"; § "Pull requests and CI minutes": "One PR per package, opened as a **draft** (`gh pr create --draft`)". SKILL.md §6.2: "Commit and push after every green step. Open **one PR per package** as **draft**…".
The old phrase "at the end" was deliberately removed from the SKILL file but survives in the README. Suggested fix: rewrite the README line to the new flow (draft early, push early, ready only when the report is complete).

**F-3 (medium) — W5 "core" silently larger than the decided core**
- Decision (25.09.): shrink W5 to core "W5-22, W5-28, W5-02a, emergency stop".
- `docs/PLAN.md`, "Geparkt": "Kern in M3/M4: W5-02a, W5-22, W5-28, **W5-00b, W5-02b3–b5/b7**, Not-Aus W5-04a–c, **Prüfpfad W5-05**"; same expansion in `.pa/plan_projects_w5.md`: "der Kern (W5-02a, W5-22, W5-28, W5-00b, W5-02b3–b5/b7, … Prüfpfad W5-05)". Consequently M3 contains W5-00b/W5-02b7 and M4 contains W5-05, W5-02b3/b4/b5.
W5-05 (a new store-migration package) and the five follow-ups were not in the enumerated core. Suggested fix: either record an explicit user decision for the enlarged core (the b-follow-ups being report follow-ups is a reason, but it needs to be the user's reason), or move these rows to "Geparkt".

**F-4 (medium) — Claude's implementer role reversed without a visible decision**
- `docs/setup/README.md`: "| Claude (Opus / Fable 5.1) | Claude Code | Koordinator; Fable 5.1 als Advisor; **Nahtstellen/Security nur als Ausweichen** (Routing: providers.md) |"
- Previous rule (archived MASTERPLAN, "Modellregel"): "**O·h** | Claude Opus … | Nahtstellen (`api.rs`, `main.rs`, `store.rs`/`store/`, `bin/pa.rs`) **und alles Sicherheitsrelevante**".
None of the listed 25.09. decisions changes who *implements* tier-A work; this row reroutes seam/security implementation away from the previously designated model. Suggested fix: confirm the decision with the user and cite it, otherwise restore the previous routing text.

**F-5 (low) — the single-writer rule for the plan documents was dropped; doc lane has no order**
- Archived `MASTERPLAN` ("Worker-Struktur"): "`docs/PLAN.md`, `STAND.md`, `MASTERPLAN.md` und `ERLEDIGT.md` schreibt nur der Koordinator oder das Paket, dem er sie ausdrücklich zuweist."
- New `docs/PLAN.md`, rule 5 requires *every* merged package to edit the Stand column itself ("Nach dem Merge: `✓ #PR` hier, Zeile in `docs/ERLEDIGT.md`"), and "Reihenfolge der seriellen Lanes" defines no order for the doc lane, while M2 schedules OPS-01, OPS-02, SETUP-09, SETUP-15 in parallel, all of which touch PLAN.md/STAND.md.
Suggested fix: re-add a one-line writer/serialization rule for the plan documents (or give the doc lane an explicit order).

**F-6 (low) — Mergify "transition" has no end; the file path stays a permanent bypass**
- Decision: "**replace** the report-file requirement … by 'PR body contains a section ## Report'".
- `.mergify.yml`: `success_conditions: - or: - "body ~= (?m)^## Report" - files ~= ^\.pa/report_.*\.md$`. As configured, any PR touching a `.pa/report_*.md` passes forever without a `## Report` section. (`docs/setup/mergify.md` itself notes "PR-Text ergänzen genügt, kein neuer Push nötig", so the fallback is cheap to drop.)
Suggested fix: remove the `files` alternative (the seven open M1 PRs can add the section to their body), or record an owner/end date for the transition. — The regex itself is correct for Mergify's Python evaluation: `(?m)^## Report` is a valid inline-flag multiline search, survives CRLF bodies, and does not match `### Report`.

**F-7 (low) — M3/M4 packages listed as executable in STAND.md**
- `STAND.md`, "Aktive Specs" states "Nur hier gelistete `.pa/task_*.md` mit `Status: aktiv` sind **ausführbar**", yet the table keeps `.pa/task_ollama_worker_adapter.md` "(M4)", `.pa/task_hq2-02.md` and `.pa/task_w1-10.md` (both M3), while PLAN.md gates later milestones ("Ein Paket aus einem späteren Meilenstein startet nur, wenn seine Lane im früheren nichts mehr hat") and the lane orders put other packages ahead (e.g. wk: "W1-03e → CLEAN-02(wk) → W5-02a → … → W2-09b").
Suggested fix: mark those specs `Status: entwurf` until their lane reaches them (as done for `task_w1-12.md`), or note the gating next to the table.

**F-8 (low) — committed HQ snapshot now shows finished milestones as "waiting"**
- `docs/dev-hq/data.js` / `data.json`: `"id": "F0", …, "current": "waiting", "source": "docs/PLAN.md"` (was `"done"`). The regenerated snapshot was parsed from the rewritten PLAN.md, which no longer carries the F-milestone status; the graphs block also still lists F-IDs that no longer exist in the plan.
Suggested fix: regenerate after W1-17 re-points/validates `hq-parse.mjs`, and mention the intermediate misdisplay in the W1-17 row.

**F-9 (low) — relative links inside the archived copies misresolve from their new location**
- `.pa/archiv/STAND_2026-09-24.md` links `[`docs/MASTERPLAN.md`](docs/MASTERPLAN.md)` etc.; from `.pa/archiv/` these resolve to `.pa/archiv/docs/…`, and the archived PLAN's `[…](MASTERPLAN.md)` resolves to `.pa/archiv/MASTERPLAN.md` — neither exists. The archive README declares everything "nur Beleg", so impact is small.
Suggested fix: point those links at root (`/docs/…`) or convert them to plain text.

## Explicitly checked, no issue found

- **Plan importer (hard constraint):** the new `docs/PLAN.md` contains exactly one table with header `| ID | Paket / Agent / Scope | Nach | Konkretes Ergebnis und Abnahme |`, with all 38 rows DF-00–DF-37 in order and unchanged "Nach" values. Every other table (`| M | Titel | …`, `| ID | Paket | Gr. | Lane | Stand |` in M1–M4, Gestrichen/Geparkt/Später/Inbox) lacks a "Nach" column, so none forms the forbidden triple.
- **Deleted workflows:** the remaining mentions of `review.yml`/`anthropic-wif-test.yml` in `docs/ci-lokal.md` and `docs/setup/ollama-reviewers.md` were rewritten as historical statements ("ist am 25.09.2026 gelöscht"); no active link points into the void.
- **Archive renames:** `.pa/archiv/README.md`'s inventory matches the renamed files, `.gitignore` un-ignores `!.pa/archiv/`, the specs still referenced by STAND/data.json were *not* renamed, and `task_w1-12.md`/`task_devflow.md` statuses are consistent with the new STAND spec list.
- **Lane order/dependencies otherwise:** the per-lane sequences are milestone-monotonic (verified st/api/mn/pa/pty/wk/hqL/hqS/ci), W5-04a's removal of the W5-01a dependency is explicitly documented ("Schnitt 25.09."), and all Gestrichen/Geparkt assignments match the decision lists (incl. DF-12/18/19/20/26/35–37 cut, W5 Phase H cut, HQ2-06–10 parked).
