Now I have a complete picture. Let me write the review with concrete findings.

---

# Review of PR #26 (PLAN-01)

## Summary
The candidate implements a major docs/config restructuring: `docs/PLAN.md` becomes the single plan with milestones M1–M4, `AGENTS.md` gets ten core rules with tiered reviews (A/B/C), the PR body replaces `.pa/report_*.md` as the report vehicle (Mergify checks for `## Report`), two dead workflows are deleted, and old specs/prompts move to `.pa/archiv/`. No product code changes.

---

## Findings

### HIGH

**1. `.mergify.yml:137-167` — Transition fallback claimed but not implemented**
The comment (lines 137-140) states: "Der Uebergang fuer PRs, die vor dem 25.09. mit einer `.pa/report_*.md` eroeffnet wurden, endete mit PR #175 ... Einzig betroffener offener Bestands-PR: #176 (Draft) — er traegt den Abschnitt im PR-Text nach."  
However, the actual `success_conditions` (line 167) only contains:
```yaml
- "body ~= (?m)^## Report"
```
There is **no OR condition** accepting `.pa/report_*.md` files. If any pre-25.09 PR other than #176 exists (or if #176 isn't updated before queue entry), it will be incorrectly blocked. The comment describes a transition that the code does not implement.

**2. `.github/pull_request_template.md:66-67` — Mergify regex matches empty section header**
The template includes `## Report` as a header with empty content. The Mergify regex `(?m)^## Report` matches this header even when the section is completely empty. A PR created from the template will pass the merge protection check **before any actual report content is added**. The check validates header presence, not content.

### MEDIUM

**3. `.mergify.yml:160-167` — Hotfix branches bypass report requirement entirely**
The merge protection `if` condition only matches branches matching `^(claude|codex|kimi|opencode|glm)/(w\d+-|df\d+|ki-\d+|hq2-)`. Hotfix branches (`hotfix/...`) and `priority`-labeled non-package branches do **not** match, so they can merge without any `## Report` section. AGENTS.md Rule 8 says "Merge only through the Mergify queue" but doesn't explicitly require reports for hotfixes. This is a documentation gap: emergency fixes can merge with zero traceability in the PR body.

**4. `AGENTS.md:794-799` vs `docs/development/WORKFLOW.md:2184-2200` — Review tier definitions use different terminology for "seam"**
- AGENTS.md Rule 5: "Tier A (seam, security, concurrency, PTY, database)"
- WORKFLOW.md: "Stufe A (Nahtstelle, Sicherheit, Nebenläufigkeit, PTY, Datenbank)"
"Nahtstelle" = "seam" — consistent in meaning, but the German/English mix in the rule reference could confuse a reader checking cross-document consistency. Not a functional bug, but a maintenance risk.

**5. `docs/PLAN.md:1849-1862` — Lane ordering references packages not in milestone tables**
The "Reihenfolge der seriellen Lanes" section lists packages like `W5-02b3(st)`, `W5-02b4(pty)`, `W5-04a`, `W5-05` in lane sequences, but the milestone tables (M1–M4) only show a subset. For example, `st` lane shows `W5-05 → W5-04a → W2-02b → W2-04c → W2-04d → W3-01(st) → W5-02b3(st) → W2-04g` but M4 table only lists `W5-05`, `W5-04a`, `W2-02b`, `W2-04c`, `W2-04d`, `W3-01`, `W5-02b3`, `W2-04g` — actually all are present. However, `W5-02b4` appears in `pty` and `wk` lanes but is **not listed in any milestone table** (M3 has `W5-02b7`, M4 has `W5-02b3/b4/b5` but `W5-02b4` appears as `W5-02b4` in lane ordering — wait, M4 table line 1836 shows `W5-02b4 | Push aus dem Worker über den Runner-Host...`). It's there. Lane ordering appears consistent on full check.

**6. `AGENTS.md:827-830` — Start check references `OPS-02` package that is "offen" (open)**
Rule 9 says: "Before every worker start, run the start check... The package OPS-02 automates this." But PLAN.md M2 table (line 1781) shows `OPS-02 | Startcheck... | S | doc | offen`. The automation doesn't exist yet; the rule mandates a manual check that the automation would replace. This is fine as long as agents know it's manual for now, but the wording "The package OPS-02 automates this" implies it exists.

**7. `.agents/skills/projecta-workflow/SKILL.md:102-103` and `.claude/skills/projecta-workflow/SKILL.md:190-191` — `PROJECTA_BUILD_SLOTS_ROOT` introduced but not documented elsewhere**
The skills mention: "set `PROJECTA_BUILD_SLOTS_ROOT` so `dev:agent-check` finds them". This env var and the `dev:agent-check` script are not referenced in AGENTS.md, WORKFLOW.md, PLAN.md, or setup docs. If `dev:agent-check` depends on it, the setup is incomplete. (May exist in codebase outside diff.)

**8. `docs/ci-lokal.md:2102-2105` — Reference to deleted `review.yml` removed but `release.yml` secret warning remains**
The table still warns: "Die Härtung von `release.yml` hinge lokal an einer Klartextdatei `.secrets` auf dem PC — **die Secret-Härtung wäre lokal ausgehebelt.**" This is correct for `release.yml` (not deleted), but the prior line about `review.yml` was removed. Consistent.

**9. `docs/setup/providers.md:2433-2435` — Routing table claims to be "die einzige Routing-Quelle" but model names unobserved**
The note says: "Modellnamen in dieser Tabelle, die oben nicht als „geprüft“ stehen, sind nicht beobachtet (Prüfung C, F9): vor dem ersten Einsatz mit dem Startcheck bestätigen (AGENTS.md, Regel 9)." This correctly pushes verification to the start check (Rule 9), but the table includes models like `gpt-6-astra`, `qwen3.8-max`, `kimi-k3:cloud`, `glm-5.2:cloud` — some may not be "geprüft" (observed). The burden is on the agent to verify. Acceptable but worth noting.

**10. `docs/PLAN.md:1999-2026` — Entscheidungs-Inbox entries E3, E7, E8 reference "Nutzer 25.09." decisions but status is "offen"**
- E3: "Secrets aus der Repo-Ebene in geschützte Environments... (Nutzer 25.09.); einmal im Browser klicken | offen (Nutzer)"
- E7: "W5-Kern: beschlossen waren... PLAN-01 hat zusätzlich... (Review PR #175, kimi-k3 F-3) | offen (Nutzer)"
- E8: "Routing Nahtstellen/Security... alte Modellregel... ist damit ersetzt | offen (Nutzer)"
These are marked as user decisions made on 25.09. but status remains "offen". If decided, they should be "entschieden" or moved to the "Entschieden am 25.09." block. Contradiction between "entschieden" in description and "offen" in status.

### LOW

**11. `AGENTS.md:767-769` — "The user is a beginner who cannot review code"**
This statement in the preamble is unusual for a shared agent instruction file. It doesn't affect correctness but may be inappropriate for a repo README-adjacent document. No functional impact.

**12. `docs/PLAN.md:1904-1912` — "Gestrichen" table includes `.github/workflows/review.yml`, `anthropic-wif-test.yml` as "tote Workflows, in PLAN-01 gelöscht"**
These are correctly deleted in this PR. The archived copies in `.pa/archiv/` (per archive README) retain history. No issue.

**13. `docs/PLAN.md:1917-1926` — "Geparkt" table lists W5-01a/b/c etc. as "nach M4" but W5-04a/c (Not-Aus) are in M4**
W5-04a/b/c are in M4 milestone table (lines 1823-1825) while W5-01a is parked "nach M4". The dependency "W5-04a (Schnitt 25.09., W5-01a bleibt geparkt)" on line 1823 acknowledges this. Consistent.

**14. `STAND.md:1219-1221` — "Neue Specs gibt es nur für M-Pakete; die Alt-Specs der S-Pakete W1-03e, W1-17 und W1-20 laufen mit ihrem Paket aus."**
But W1-03e is in M1 (line 1767), W1-17 in M2 (line 1786), W1-20 in M1 (line 1768). They are M/S packages, not M-packages per PLAN.md Rule 6 ("Spec nur für M-Pakete"). W1-03e is size S (line 1767), W1-17 size S (line 1786), W1-20 size S (line 1768). The statement "Alt-Specs der S-Pakete... laufen mit ihrem Paket aus" is a grandfathering exception. Documented, so acceptable.

**15. `KNOWN_ISSUES.md:1043-1044` — KI-1 references `docs/MASTERPLAN.md` changed to `docs/PLAN.md` but says "geparkt bis nach M4"**
The old text: "Paket **W1-09c** (`docs/MASTERPLAN.md`)." New: "Paket **W1-09c** (`docs/PLAN.md`, geparkt bis nach M4)." W1-09c is not in any milestone table (parked per PLAN.md line 1924). The reference is correct.

**16. `README.md:1077` — OmniRoute port changed from `:20128` to `:<omniroute-port>`**
Parameterized correctly. But `docs/development/WORKFLOW.md:2209` and `:492` also changed. Consistent.

**17. `AGENTS.md:899-900` — "Continuous mode stays disabled and its code is frozen until milestone M4"**
But PLAN.md M4 table includes `W4-03 | Continuous-Aktivierung... | S | mn | offen` (line 1846). The code freeze applies to *new* migrations/features; W4-03 is the activation gate itself. Consistent.

**18. `AGENTS.md:926-930` — CI gates description removed "CI gates run on pushes to main, on non-draft PRs and on merge-queue runs; installer builds run on release tags"**
New text only says "Use appropriate Test-First/Regression-For/No-Test trailers; never `--no-verify`." The trigger description moved to CI-03 package (PLAN.md line 1770: "CI nur bei „ready“ und in der Queue, Windows nur in Queue und Wochenlauf"). The old description was in AGENTS.md; now it's in PLAN.md. No contradiction, but the information is split.

**19. `docs/development/WORKFLOW.md:2294-2304` — Document role table updated but `STATUS.md` and `TRIAGE.md` described as "Chronik bis v1.4.0 bzw. abgeschlossene Triage (nur Geschichte)"**
README.md (line 1096-1097) lists them as separate docs: `| [STATUS.md](STATUS.md) | History of the build up to v1.4.0 |` and `| [TRIAGE.md](TRIAGE.md) | Closed triage of evidence findings (history) |`. Consistent.

**20. `.gitignore:629` — `!.pa/archiv/` admitted but archive contains 200+ files per review prompt**
The archive is explicitly admitted. The review prompt says `.pa/archiv/**` (about 200 files) omitted from diff. This is intentional per PLAN-01 requirement #5. No issue.

---

## Gaps Against Requirements

| Requirement (from prompt) | Status |
|---------------------------|--------|
| 1. `docs/PLAN.md` only plan, M1-M4, rules, vision, Gestrichen/Geparkt, Später, decision inbox; DEVFLOW 38 rows kept; MASTERPLAN points to it; old snapshots in `.pa/archiv/` | ✅ Done |
| 2. `AGENTS.md` ten core rules (tiered reviews, PR text = report, push at once, red main stops queue, start check, secret scan...); other docs follow | ✅ Done |
| 3. `.mergify.yml`: merge protection = PR body has `## Report` line; transition allows `.pa/report_*.md`; new PR template | ⚠️ **Transition not implemented in code** (Finding #1) |
| 4. Dead workflows `review.yml`, `anthropic-wif-test.yml` deleted; nothing else references them | ✅ Done (references updated/removed) |
| 5. Old specs/prompts to `.pa/archiv/`; `.gitignore` admits it | ✅ Done |
| 6. Public repo: no personal data in tracked files | ✅ Verified (paths parameterized, secrets in deleted files only) |
| 7. No product code changes; `No-Test:` trailer | ✅ Diff is docs/config only |

---

## Safety Regressions

- **None found.** Secret handling improved (OpenRouter workflow deleted, Ollama Cloud subscriptions only). Mergify queue still gates merges. Red `main` stops queue (CI-04 to automate). Agents cannot self-expand approval/budget (Rule 10).

---

## Verdict

**Conditional pass.** The two HIGH findings must be addressed before merge:

1. **Implement the transition fallback in `.mergify.yml`** — add an OR condition for `files ~= ^\.pa/report_.*\.md$` alongside the body check, or explicitly document that the transition is "hard cut" (only #176 affected, already a draft) and the comment is aspirational.
2. **Strengthen the Mergify regex** — require content after `## Report`, e.g., `(?m)^## Report\s*\n.+` or check for a non-empty section. Otherwise the template alone passes the gate.

All MEDIUM/LOW items are documentation consistency or future-maintenance nits; they don't block correctness.
