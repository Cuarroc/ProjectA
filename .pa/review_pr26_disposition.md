# PR #26 (PLAN-01 port) - review disposition, stage B

Candidate: `8da1f9b` (docs/config only; +976/-1450 outside `.pa/archiv/` and the
generated HQ data). Author: Claude (Sonnet 5). One reviewer, not a Claude model:

| Reviewer | Model | Transport | Raw answer |
|---|---|---|---|
| Kilo | `kilo/nvidia/nemotron-3-ultra-550b-a55b:free` | `kilo run`, prompt attached with `-f`, run in an empty scratch directory (read-only, no repository in reach) | `.pa/review_pr26_kilo-nemotron.md` |

Prompt: `.pa/review_prompt_pr26.md` (context, requirement, `git diff
origin/main...HEAD` without `.pa/archiv/**`, the generated `docs/dev-hq/data.*`
and the earlier `.pa/review_pr175_*` records). The answer is stored unchanged
except that terminal colour escape codes were stripped. Ollama and OpenCode were
not used (weekly limit). Ids: K = Kilo. Every claim was checked against the
files, not against the diff alone.

## Findings

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| K1 | high | `.mergify.yml` comment describes a transition for `.pa/report_*.md` PRs, but `success_conditions` only has the body check | **Accepted, in a corrected form.** The code is right (a hard cut, deliberately: a transition without an end is a permanent bypass), the prose is wrong: `.mergify.yml`, `AGENTS.md` and `docs/setup/mergify.md` cited PR #175 / #176 of the predecessor repo, which do not exist here (`gh pr view 176` fails; no open PR here is a vendor package branch without `## Report`, checked with `gh pr list`). The three places now say "no transition; an open package PR must carry the section". The PR text said the opposite ("during the transition a report file still passes") and is corrected. |
| K2 | high | `## Report` in the template matches although the section is empty, so a template-only PR passes | **Rejected.** A regex cannot prove content: the template's own placeholder line (`**Package:** <ID ...>`) would satisfy any "non-empty" pattern too. The gate is the coordinator, who marks a PR ready only with report, disposition and the `NICHT ABGEDECKT` block in (AGENTS.md rule 7 / the skill). The template comment does not match by accident: no line of it starts with `## Report` (checked). |
| K3 | med | `hotfix/` and `priority` branches are not package branches, so they merge without a report | **Rejected.** Unchanged by this PR and stated in the config comment ("Bewusst NICHT erfasst"): the rule covers package branches by design; a hotfix is coordinator-only (AGENTS.md rule 8) and still goes through the queue. |
| K4 | med | "seam" vs "Nahtstelle" mix German/English across documents | **Rejected.** Same meaning; AGENTS.md is English, the German documents use German terms throughout. No contradiction. |
| K5 | med | Lane order lists packages not in milestone tables | **Rejected.** The reviewer retracts it in the same paragraph ("Lane ordering appears consistent"). |
| K6 | med | Rule 9 says "OPS-02 automates this" but OPS-02 is open | **Accepted (wording).** AGENTS.md now reads "until the package OPS-02 (open) automates it, it is a manual check". |
| K7 | med | `PROJECTA_BUILD_SLOTS_ROOT` not documented elsewhere | **Rejected, factually wrong.** It is read by `scripts/dev/agent-setup-check.mjs:262` and documented in `docs/setup/claude-code.md:59`; the skill sentence is unchanged from `main`. |
| K8 | med | `ci-lokal.md`: `review.yml` line removed, `release.yml` warning stays | **Rejected.** The reviewer finds it consistent itself. |
| K9 | med | `providers.md` routing table has unobserved model names | **Rejected.** The table states that unobserved names must be confirmed by the start check (rule 9); capability configuration is not evidence (AGENTS.md). No claim is made. |
| K10 | med | Inbox E3/E7/E8 say "Nutzer 25.09." but status "offen" | **Rejected.** The middle column is the recommendation, the status column is whether the user's action is done. E3 needs a browser click, E7/E8 ask the user to confirm what PLAN-01 added beyond the 25.09. decision. Nothing contradicts. |
| K11 | low | AGENTS.md says the user is a beginner who cannot review code | **Rejected.** It is the reason for the rules (the user's own decision of 25.09.), contains no personal data, and is a rule rationale, not a statement about identity. |
| K12-K17, K19, K20 | low | Consistency notes the reviewer itself marks "no issue"/"consistent" | **No action** (no defect claimed). |
| K18 | low | AGENTS.md lost the sentence on when CI gates run; it is split between PLAN.md and AGENTS.md "Merging" | **Rejected.** The "Merging" section of AGENTS.md keeps the triggers (non-draft PR, merge queue, `main` push); no contradiction. |

## Evidence

Changes are wording only (comment in `.mergify.yml`, prose in two `.md` files);
trailer `No-Test:`. The reviewer's conclusion "conditional pass, two high"
resolves to K1 (accepted, wording) and K2 (rejected with reason).
