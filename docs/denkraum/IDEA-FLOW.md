# IdeaFlow v1 store contract (DR2-2a)

`putIdea(input)` starts a flow only with explicit `mode: dialog|solo`, atomically with content and the existing pending notification. Omission keeps legacy semantics, including edits. Each idea revision optionally holds `flow: {version:1, mode, revision:0, events:[]}`; mode is the initial mode. No implicit migration invents agent activity. Titles retain the existing 200-character limit.

`putIdeaFlow(input, trustedContext)` runs inside the existing ledger transaction. The host must supply `{role:'root', rootAgentId:<configured Root>}` independently of request data, after authenticating/attesting its source. Payload actor/role never authorizes a write. This store API does not authenticate HTTP clients or verify external processes; the host must verify job and start evidence before calling it. Agent text remains untrusted data.

Every command requires `requestId`, `ideaRef:{kind:'idea',eventId,ideaId,ideaRevision}`, `expectedFlowRevision` (initially 0), `turnId`, and `jobId`. IDs follow the existing 80-character ID contract. Canonical payloads contain these fields plus the command-specific fields below, in fixed order; irrelevant fields confer no meaning. Return value is the appended event (canonical request, payload, revision, actor, rootAgentId, at, phase, and optional thread text).

| Command | Required additional input | Allowed predecessor | Phase after / fixed actor |
|---|---|---|---|
| reserve | optional `mode: dialog|solo` (otherwise retain current mode) | submitted or answered; never a parallel turn | unchanged / root |
| started | `startProof`: nonempty observed evidence, ≤2000 characters | reserve, same turn and job | elaborating / agent |
| asked | `questionRef:{questionId,questionRevision}` | started in dialog mode | awaiting_user / agent |
| answered | `answerId` | asked, same turn and job | elaborating / user |

All other transitions reject. Reserve uses fresh turn and job IDs; answered ends the question turn, and further work needs a new reserve/start. Mode changes occur only in that reservation. Asked binds a current, unanswered, free question created through `putQuestion`, with the exact idea source; its title becomes the stored thread text. Answered binds the current saved free answer from `answer`, matching the open question and idea; its note becomes thread text. Each contribution is nonempty and ≤4000 characters, without truncation. Events are append-only, at most 100 per idea revision; flow revision equals event count. Phase is derived by replay; no extra progress status or plan approval is created.

Identical canonical request replay returns the original event before freshness/CAS checks, including after restart or idea supersession. Request IDs are unique across flow events in the ledger; changed payloads or stale/new writes return 409. A missing idea, idea revision, question or answer returns 404; malformed input/unsupported command returns 400; missing/mismatched trusted Root context returns 403; unconfigured Root returns 503. At 100 events, new commands return 409 while replay remains valid.

Reads validate version, commands, revision sequence, references, roles, timestamps, payloads, thread bounds and transitions; answered events retain their historical answer binding even after later answers. Corrupt flows fail with 503 and cannot be overwritten. Unknown optional legacy fields survive unchanged; V1 migration, ownership, backups, receipts, patches and notification delivery retain their existing contracts. New idea content uses a new idea revision; old jobs cannot mutate that revision.

DR2-2b will add completed/handedOver/accepted/rejected and result fields to the same command reducer, validation and ledger transaction. They currently reject; no completion, handover, acceptance, release or execution authority is implied. HTTP routes, UI and dispatch are outside this contract.
