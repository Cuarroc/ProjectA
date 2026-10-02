# W2-08b: Per-job resource limits and early stall detection

Status: aktiv

Package from `docs/PLAN.md`, size M, lane fR. This specification is active
for the dispatched package; the plan remains the source of truth.

## Contract

- Apply a 4 GiB aggregate memory ceiling and a 40% system CPU hard cap to each
  Windows native provider job before its suspended process can run. Keep the
  parent host uncapped so nested CPU rates do not multiply.
- Keep the 15-minute no-progress deadline, but reset it only for complete,
  structured Codex JSON events that demonstrate thinking or task progress.
  Arbitrary stdout/stderr bytes must not keep a stalled worker alive.
- Limits remain compile-time native-runner policy. They do not enable
  continuous mode, add a scheduler, or change PTY workers.

## Acceptance

- Compiling red-first tests prove both absent Job Object caps and the current
  false-progress behavior; the same tests pass after the implementation.
- Windows native tests and the full prepush lane pass in this worktree.
- Tier-B review by a model outside the author's family has no unresolved
  high-severity finding; all findings are dispositioned in the PR report.
- Diff stays at or below 300 lines and does not touch a serial seam.
