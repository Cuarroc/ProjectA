# W4-01 — Five-task worker benchmark
Status: aktiv

## Scope

- Replace the obsolete twenty-case comparison contract with five small,
  deterministic tasks whose expected JSON results are fixed in source.
- Run the tasks sequentially through a worker-adapter module and write results
  plus durations as JSON.
- Test exclusively with a local fixture; do not call a provider.

## Acceptance

- Exactly five task IDs and expectations are stable and reproducible.
- A passing fixture run writes five results and measured durations.
- Adapter errors and wrong answers are recorded and make the command fail.
- No seam file (`api.rs`, `main.rs`, `store.rs`, `bin/pa.rs`) is changed.
