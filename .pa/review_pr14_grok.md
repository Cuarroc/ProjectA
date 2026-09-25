I'll review the W2-10b candidate against the live code and the HQ v1 types, and check whether the earlier rejections still hold.The two earlier rejections hold. The submit-button focus fix does not.

GLM F1 is wrong on the types. `usage_state` is only `no_allowance`, `no_receipts`, `partial`, or `measured` (`src-tauri/src/store/development_budget.rs` 125–133). `exceeded` and `exhausted` are separate booleans (84–85, 122, 141) and are already rendered as flags (`docs/dev-hq/continuous.js` 107–109). The Qwen race is not real: after the `await`, the generation check at line 214 returns before any paint, and the signature compare, `renderBudget`, and the store at 242–251 run in one synchronous block.

## Findings

### 1. High — real routing receipts render the model and effort as unknown

`routingSummary` (`docs/dev-hq/continuous.js` 77–79) reads `resolvedModel.value` and `effort.value` (or a top-level `.reason`). The HQ payload is an externally tagged `Observation` (`src-tauri/src/development_policy.rs` 684–690). A measured model is `resolvedModel.measured.value`, and effort is `effort.requested.value` or `effort.unavailable.reason` (942–953). The serializer test reads that shape at 1117–1119.

On a live `/api/hq/v1/runs` receipt the line still shows the provider and profile, then `Modell unbekannt · Aufwand unbekannt`, while the measured model sits in the JSON. The same helper feeds the new aggregate at `continuous.js` 130 and the existing per-run line at 327.

The new tests never load that shape. `scripts/lib/hq-budget-live.test.mjs` 15–17, `scripts/lib/hq-continuous.test.mjs` 104, and the screenshot mock in `scripts/lib/hq-visual.browser.mjs` 47–49 all use `{ value: "kimi-k3" }`, which this API does not emit. `executionObservation.reason` is a flat field and does display.

The tag is the evidence class (`measured`, `configured`, `requested`, `estimated`, `unavailable`). Effort in particular is the requested value, not an execution measurement (`development_policy.rs` 948–952).

### 2. High — every non-measured cost receipt says the reservation still stands

`continuous.js` 132–136 prints `die Reservierung bleibt bestehen` for every `usage` object whose `state` is not `measured`. The runs snapshot always attaches `run_receipt` (`src-tauri/src/store/development_runs.rs` 599–613), and that object is not a three-value set:

- No implementation reservation: `not_reserved` / "run holds no implementation token reservation" (`development_usage_receipt.rs` 156–158). This is every run that has not reserved implementation tokens. The line then says the reservation remains.
- Cancelled reservation: `cancelled` / "reservation cancelled before work started" (162–163). The suffix says it remains.
- Settled row missing tokens or source: `unclassified` (177–179). That reservation is already settled, not held.

`rejected`, `not_reported`, and the `pending` reasons do keep the reservation. The suffix is unconditional, so those true cases and the false ones look the same.

### 3. Medium — a failed runs fetch is shown as “no receipts”, and it replaces receipts already on screen

`/api/hq/v1/runs` failures become `null` (`continuous.js` 212). `renderBudget` treats that the same as an empty list (123–126): `Keine Routing-Belege vorhanden`. The runs section below distinguishes the two (315–318: `nicht verfügbar` versus `Noch keine kontinuierlichen Runs`).

The budget signature maps both a failure and an empty list to `receipts: []` (244–246). After a tick that showed real receipts, the next tick whose runs call fails changes the signature, calls `renderBudget`, and replaces those receipts with the absence sentence. Context can still succeed, so the token balances stay up and the two sections on the card disagree. This happens whenever the runs request rejects and the context request does not.

### 4. Medium — submit-button focus still dies on every 5s tick in a browser

`refresh` disables every button before the fetch (`continuous.js` 61–63, 205). `captureListState` runs only after the `await`, and only when the goals signature changed (234). In a browser, disabling the focused control runs the HTML focus fixup and moves focus to the document before capture. The saved focus is then null, so `restoreListState` (194–199) never runs for that button. `enable(true)` at 338 re-enables it and does not put focus back.

The page calls `continuous.refresh()` on the 5s poll (`docs/dev-hq/hq.js` 944, 1231). An unlocked assignment submit (`continuous.js` 279; enabled once the task is `open` and unclaimed) loses focus on every tick, including a no-change tick, which does not capture or restore at all. The same blur hits `Ziel speichern` and `Arbeitspaket speichern` (27, 37), which sit outside `[data-goals]` and are not in the restore path.

`scripts/lib/hq-goals-live.test.mjs` 89–114 stays green because JSDOM does not move focus when a button is disabled, and it never polls. Inputs and selects are not disabled, so their preservation path is unaffected.

### 5. Medium — switching projects leaves the previous project’s runs on the card

The project-change clear (`continuous.js` 206) empties the goals list, ownership, and budget, and resets both signatures. It does not empty `[data-runs]`. If the context request for the new project throws, the `catch` (339–343) sets the unavailable banner and returns. The runs section still shows the previous project’s status, claim owner, candidate commit, and routing line, under the newly selected project, until a later refresh succeeds. Budget and ownership are already blank, so the card mixes an empty budget with another project’s runs.

### 6. Low — plural for unresolved operations is wrong for every count other than 1

`continuous.js` 110 builds `` `${n} offener Vorgang` `` and only appends `e` when `n !== 1`. One started reservation reads `1 offener Vorgang`. Two or more read `2 offener Vorgänge`. The adjective stays in the singular. The budget test only matches the singular (`hq-budget-live.test.mjs`, the `1 offener Vorgang` assertion), so the plural path is untested. `unresolvedOperations` is the count of `started` reservations (`development_budget.rs` 111–112), so any root with two started rows hits this.
