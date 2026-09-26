# Review disposition: PR #15 (W2-04d), stage B

- Candidate: `96e5a0a` (branch `claude/w2-04d`, merged with current `main`);
  delta after the review: one test commit, no production code.
- Author: Kimi k3. Reviewer (other model family): Nemotron 3 Ultra 550B
  (`kilo/nvidia/nemotron-3-ultra-550b-a55b:free`, Kilo, read-only), one
  reviewer as ordered for stage B. Prompt: `.pa/review_prompt_w2-04d_b.md`,
  verbatim answer: `.pa/review_pr15_nemotron-3-ultra.md`. Verdict of the
  reviewer: approve with conditions (3 conditions, no blocker).
- Stage A (glm-5.2, qwen2.5-coder): `.pa/review_w2-04d_disposition.md`.

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| B-01 | low | Mapping coordinator→planning, implementer→implementation, reviewer→review, integrator→verification is sound and fail-closed | Confirmation, no action. |
| B-02 | medium | One-reservation-per-run check is race-safe: it runs inside the transaction that already holds the write lock on the goal row | Confirmation, no action (same as stage A G1). |
| B-03 | medium | `consume_worker` / `for_run` no longer filter on `purpose='implementation'`; uniqueness holds via the one-reservation invariant. Hint: add `ORDER BY ... LIMIT 1` to `consume_worker` | Invariant confirmed. The hint is **rejected**: `consume_worker` selects `state='reserved'`, which a cancelled row can never match, and the invariant is enforced under the goal-row lock, so two matching rows only exist after out-of-band DB tampering. An `ORDER BY` there would silently pick one row and mask that corruption instead of surfacing it; `for_run` needs the ordering only because it must also show cancelled history. |
| B-04 | low | Idempotency replay precedes the one-reservation check; order is correct | Confirmation, no action. |
| B-05 | medium | Mismatch tests cover reviewer and implementer only; coordinator and integrator have no negative test | **Accepted**, test `coordinator_and_integrator_runs_reject_every_other_purpose` (commit `b226682`). Green on the head; mutation proof: with `Integrator => Implementation` the test fails ("a integrator run must not reserve Implementation budget", exit 101), mapping restored afterwards. Red on the PR base as well, because the base accepted `implementation` for any run role. |
| B-06 | low | Comment "protected verification reserve" is misleading because review and verification share the protected pool | **Rejected**: "verification reserve" is the name of the policy field (`verification_reserve`) and of the balance field (`verification_remaining`); the same comment already says that review and integration both draw from it. Renaming the comment would diverge from the code names. |
| B-07 | low | `for_run` ordering `state='cancelled', created_at DESC, id DESC` is correct and deterministic | Confirmation, no action. |

Result: no open finding. Condition 1 accepted and implemented, condition 2
and 3 rejected with reasons.
