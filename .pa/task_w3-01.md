# W3-01: Global database maintenance

Status: aktiv

Package from `docs/PLAN.md` M4. Size: M. Ordered seams: `st`, then `mn`.

## W3-01a — store seam (this package)

- Add a process-global maintenance state shared by every `Store` clone.
- Enter by taking SQLite's writer reservation after existing writes drain.
- Keep reads available; new writes wait only for the configured five-second
  SQLite busy timeout and then fail without changing data.
- Expose explicit enter, leave, and active-query methods.
- Do not add a migration or continuous-mode behavior.

## W3-01b — main seam (separate package)

- Drain interactive sessions before entering maintenance.
- Surface the bounded write refusal and coordinate maintenance operations.
- W3-01a does not edit `main.rs`, `api.rs`, or `bin/pa.rs`.

## Acceptance

- Maintenance becomes observable only after the SQLite reservation is held.
- An existing store write during maintenance fails within a bounded wait.
- The rejected write changes no rows; reads retain prior rows.
- Leaving maintenance restores writes, and clone handles share the state.

## Red test

Enter maintenance, attempt `create_project`, assert bounded failure and no
insert, leave maintenance, then assert the same write succeeds.
