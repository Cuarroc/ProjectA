# Core authority and verification contract — ungranted draft

Plan-ID: V36-M0-P2. This prepares the approved v3.6 section 4 rights sheet and section 5.2 reviewer/interface contract. It grants no rights and claims no built, installed, effective or user-accepted behavior. [PLAN](../../PLAN.md) remains the sole schedule; the [acceptance contract](ms0-acceptance-contract.md), [core specification](core.md) and [v2.0 plan](plan.md) retain their complete obligations.

Source fingerprint: `f4696eb52f57f43bf6021d19f332391b5874b0356b39de1fb4e957fa33e55720`. The draft records the STANDARD boundaries without publishing private conversations or choosing a new product target.

## One rights sheet for Elias, before the protected step

Root prepares one concrete sheet for Elias before the first actual protected run, by MS-3 before MS-4. Until Elias decides that sheet, the product Orchestrator executes nothing autonomously. Afterward, only individually listed actions within a valid authorization may run. A general label such as “stage 1 in the project” is insufficient.

| Sheet field | Draft requirement | Current state / next owner |
|---|---|---|
| Projects and target objects | Bind the exact newly requested product, named root, allowed objects and intended artifacts. Product Git stays in `produkt/`, control in sibling `.projecta/`; existing projects stay in place. Resolve actual targets/links/Git control paths and preserve existing files. | Actual target not chosen; Root fills from Elias' concrete request before effect. |
| Existing execution paths | List only actually available and explicitly admitted locations and combinations. No new key, remote-control capability, account, service or paid provider follows from this sheet. | Root binds available paths and their observed evidence. |
| Executor | The core is the single execution route; the product Orchestrator submits typed project-bound requests. UI/helpers cannot bypass admission or accept their own result. | Interface implementation and actual boundary evidence still open. |
| Individually proposed automatic actions | Scoped reads of allowed inputs, reports, narrowly bounded healing with a report, and explicitly requested new-product directory/Git/template creation. Classify and justify each action separately. | Proposals only; exact actions, objects and limits need Elias' sheet decision. |
| Concrete protected decisions | Money/paid services, secret changes, releases/tags, installs, rights changes, disabling protection and deletions retain their applicable concrete user authorization. Autonomy never enlarges it. | Root preserves valid prior grants and bundles only the actually missing decision. |
| Revocation | Immediately prevent new effects; halt running steps with an independently observed process/stop receipt. Distinguish requested stop, confirmed stop and completed effects; show the applicable return path. | Build and verify before activation; no automatic rollback claim. |
| Operating model | Authorized local user and admitted existing execution locations; no added multi-user operation, phone pairing or permanent operation from this draft. Concurrency and action limits belong to the concrete sheet. | Root binds actual target/action limits; first-flow proof uses one active admitted request. |
| Technical trust | Root/architecture bind identity and trusted authority, safe admission and evidence. Writable rules, checksums, labels, cwd and same-user CLI are not proof of isolation. | No cryptographic choice or infrastructure approval is asked of Elias by this draft. |

If the sheet has not been decided when the MS-4 real flow is due, only that effectful track waits with “Decision required: rights sheet”. Inert cards/data, simulated tests and unrelated authorized work continue through their normal gates. Silence is not consent.

The app approval channel is a separately built feature. Effective grants remain inactive until built, accepted, operating and covered by Elias' concrete activation instruction. This does not reopen an already answered channel/design decision or grant general execution rights.

## Common request, effect and receipt boundary

| Boundary | Required contract and negative check | Evidence / owner |
|---|---|---|
| Admission | Bind request identity, project, actual target, action, valid scope, owner, execution path and expiry. Missing, damaged, revoked or stale authority rejects the protected action before effect. | V36-C01/C02/C03 and V36-P01/P03p/P03b; exact public boundary tests, then actual-path receipts. |
| Execution | One effective owner per setting/request and one register/journal truth. Serialize competing writes; helpers submit typed requests through the same boundary. | V36-K01–K09 and V36-C03/C04; actual owner/writer evidence. |
| Duplicate or unknown acceptance | Reconcile the same identity to one accepted run/result. Lost connection leaves uncertainty until actual receipt reconciliation, without blindly starting again. | V36-C03/C05; request/run IDs and independent native observations. |
| Hold, cancel and revoke | No new steps while held/revoked; a cancel request is not confirmed process completion. Retain the source's ≤10 s emergency-stop proof on the applicable server/core boundary. | V36-C02/C04, V36-K16; timestamped process identity and stop measurement. |
| Path protection | Verify every admitted App, Shell/CLI, MCP and child-process path, including links, target changes and external Git control paths. Block agents' access to protected approvals/secret references before effect; state the true scope. | V36-P03b/P04t/P04g/P04b/P06; actual path evidence, not hidden UI controls. |
| Backup and return | Verify concrete matching backup, preserve concurrent user work or stop on conflict; refuse corrupt/ambiguous restoration. Return itself requires applicable authorization. | V36-P05d/P05r/P06; fixture and actual protected-path evidence before claims. |
| Result and acceptance | Bind artifact/result to candidate, request, target, observed source and time. Model text and an editable log cannot accept their own output. Renewal follows changed candidates. | V36-C05/C10/C13; independent receipt and honest state projection. |

Files remains a passive reader with the correct two roots, viewer-specific read authority, accurate guard badges, keyboard/assistive use and no executable preview. Finder editing and later capabilities remain in their explicitly assigned scope. A secret scan is a bounded check, never a guarantee that a protected artifact is safe to display/export.

## Reviewer-family, quota and return contract

- Risk follows actual changed files and AGENTS rule 5: A requires two distinct non-author families; B requires two distinct non-author families with the subscription/OpenRouter rule and current E1 exception; C gates only; C+ one outside reviewer. A source-required independent architecture/security assessment remains a separate duty; this document does not perform it.
- For an OpenAI author, proposed review families are Anthropic and Moonshot; for Anthropic, OpenAI and Moonshot; for Moonshot, OpenAI and Anthropic. These are candidates, never proof of availability or an automatic start.
- At the real review start, Stabs observes provider/model/family, valid access, remaining native quota, resources, current family independence and applicable E1 credit condition. Missing/unknown/empty quota or unproven model pauses the affected review or leads to a lawful rebind; no paid top-up, free-model substitution, same-family self-count or skipped review.
- Review input names operator, purpose/non-goals, fixed base/head or bounded delta, exact files, source acceptance criteria, evidence paths, author family, required reviewer family, finding IDs and return path. A shared Relay context does not prove independent review.
- Review output binds actual observed model/family and candidate, file:line, severity, concrete consequence, coverage/limits and verdict. No defect is a valid result. An extra neutral check is selective; a second extra check needs a remaining concrete defect and does not create a third review round.
- Each finding is accepted with fix commit, rejected with reason, or left as a separately owned follow-up in the PR report. After two rounds Root decides continue/split/drop; no self-retry. Fix-delta reviews follow actual touched risk, and changed candidates invalidate affected evidence.
- Root accepts the fixed head and owns Ready/review-ok/Mergify. Source delivery, technical check, integration, installation, actual effect and user acceptance remain distinct.

## AGENTS rules 1–5 comparison

| Rule | Contract here | Result |
|---|---|---|
| 1 package ownership and size | One owner/branch/worktree/PR, ≤300 added+deleted lines including tests; ≤400 only for a finding-forced fix with recorded IDs. | Matches; no exception. |
| 2 red first | Actual compiling failing public regression before a bugfix; pure docs exempt; visual claims inspected, runtime claims measured. | Matches; this draft performs no bugfix or product observation. |
| 3 own prepush | Full own-worktree prepush, actual candidate/exit, no hook bypass or masked exit. | Matches; no checker weakening. |
| 4 early commit and push | Normal commit/push after green steps, remote SHA verification, no shared stash or local-only handover. | Matches. |
| 5 risk reviews and limit | Exact family/count/E1/C+ and fix-delta rules above; Root disposition at round two. | Matches; review availability still observed at real start. |

## Delivery boundary and next owner

Stabs is the sole dispatcher, file/seam coordinator and PLAN writer; PM prepares cuts, Chief independently checks, Root prioritizes and accepts. Existing valid concrete Motion/updater/install permissions retain their exact scope and prerequisites; this draft neither revokes nor enlarges them. The standing K5 patch-release approval retains its documented scope; minor/major releases, including v2.0.0, still need fresh user approval. NAV-0/MS-4, real protection, user data and current development-loop constraints remain binding. Parked work is not resumed by a rights draft.

After this bounded source contract is merged and Root accepts the remaining MS-0 duties, Root hands catalog, matrix and thresholds once to Alfred and verifies he read them. That reading is an observed duty, not an assumed delivery receipt. Only then MS-1; before relevant R2 image approval, only types/data/text and inactive Gallery components, preserving active views/global tokens.

NICHT ABGEDECKT: actual rights-sheet decision, trusted-channel implementation, protected path enforcement, actual tool/model runs, native stop/revocation/backup effect, installation, runtime, visual/user acceptance and parent MS-0/product completion. Each remains with its named implementation/acceptance owner.
