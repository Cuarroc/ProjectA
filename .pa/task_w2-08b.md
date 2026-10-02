# W2-08b: Per-job resource limits and early stall detection
Status: historisch
Package from `docs/PLAN.md`, size M, lane fR; active while dispatched, now historical.
## Contract
- Apply a 4 GiB aggregate memory ceiling and a 40% system CPU hard cap to each Windows native provider job before resume; keep the parent host uncapped.
- Keep the 15-minute no-progress deadline, but reset it only for complete, structured Codex progress events; arbitrary output must not keep a stall alive.
- Limits do not enable continuous mode, add a scheduler, or change PTY workers.
## Acceptance
- Compiling red-first tests prove absent caps and false progress; Windows native tests and the full prepush lane pass.
- Tier-A review by two outside-family models has no unresolved high finding.
- Diff stays at or below 300 lines and does not touch a serial seam.
