# Review: pr175 — glm-5.2

- Autor des Artefakts: claude (branch claude/plan-01-decisions)
- Reviewer: glm-5.2 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `glm-5.2:cloud`, bedient `glm-5.2`
- Datum: 2026-09-25 05:26 UTC, Dauer 200 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_pr175.md` (356516 Zeichen)

## Roh-Urteil des Reviewers

## Findings

### F1 — Low — `.pa/archiv/STAND_2026-09-24.md`, `.pa/archiv/PLAN_2026-09-24.md`: relative markdown links broken after move

The three archived files were moved from the repo root / `docs/` into `.pa/archiv/`, but their internal relative links were not adjusted. They now resolve to non-existent paths.

Quoted examples from `.pa/archiv/STAND_2026-09-24.md`:
> `[`docs/MASTERPLAN.md`](docs/MASTERPLAN.md)`
> `[`docs/ERLEDIGT.md`](docs/ERLEDIGT.md)`
> `[`.pa/plan_projects_w5.md`](.pa/plan_projects_w5.md)`

From `.pa/archiv/PLAN_2026-09-24.md`:
> `[`docs/MASTERPLAN.md`](MASTERPLAN.md)`
> `[`docs/ERLEDIGT.md`](ERLEDIGT.md)`

These resolve to `.pa/archiv/docs/MASTERPLAN.md` etc., which don't exist. The `.pa/archiv/README.md` notes that links to moved `.pa/task_*` and `.pa/review_prompt_*` files can be found under new paths, but doesn't cover the intra-document links broken by the directory change.

**Suggested fix:** Either prepend `../../` to the relative links in the archived files, or add a note to `.pa/archiv/README.md` that all relative links in the archived plan/stand files refer to their original locations.

---

### F2 — Low — `docs/dev-hq/data.js` / `data.json`: F0 status changed from `"done"` to `"waiting"`

The generated HQ data files now show F0 with `"current": "waiting"` (was `"done"`). The new `docs/PLAN.md` no longer contains the F0–F8 wave structure the parser expects, so the parser can no longer find F0's completed status and defaults to `"waiting"`. The HQ would display F0 as waiting instead of done.

**Suggested fix:** This is an expected side effect of the plan restructuring and will be addressed by W1-17 ("HQ-Parser prüfen", M2). No action needed in this PR beyond awareness; the data files will be correct once the parser is updated.

---

No high or medium findings. The plan importer constraint (exactly one table with the required header, 38 DF rows, no competing table with ID + Paket* + Nach columns) is satisfied. The Mergify `(?m)^## Report` regex correctly matches the PR template. All user decisions from 25.09. are represented: milestones M1–M4, tiered reviews, PR-text-as-report, CI cost target, frozen continuous code, decision inbox, Gestrichen/Geparkt sections with reasons, and the 200 renames into `.pa/archiv/`. No references to the deleted `review.yml` or `anthropic-wif-test.yml` point into the void — all were updated to historical notes.
