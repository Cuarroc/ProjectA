# F4: Merge-Kandidat und Setup-Ausführung

Status: historisch

Auftrag: Nutzer fordert den Rest von `docs/SANIERUNGSPLAN.md` Rev 9.
Owner: Codex, serielle Lane. Keine Commits/Merges ohne abgeschlossene Gates.

Dateien: `src-tauri/src/testgate.rs`, `src-tauri/src/testgate/candidate.rs`,
`src-tauri/src/workers.rs`; anschließend Setup-Vertrag in `setupgate.rs` und
`readiness.rs`. UI-Wiring folgt seriell über `main.rs`, `src/lib/ipc.ts`,
`src/types.ts`, `src/components/DiffView.tsx`.

1. Regression: Test benötigt eine Datei aus vorgerücktem Base-Tip.
2. Isolierter Checkout entspricht exakt dem gemessenen Merge-Tree.
3. Worker bleibt unverändert; Kandidat, Quell-Tupel und Policy werden geprüft.
4. Kindprozesse enden vor Validierung/Cleanup, auch bei erfolgreichem Shell-Exit.
5. Setup verlangt Projektidentität + Kandidateninputs + Base-SHA; Resultate
   werden pro Worker/Kandidat getrennt. Kein stilles Vertrauen.
6. Setup/Test-Policy bindet gemeinsam den Testbeleg; UI bestätigt sichtbare Inputs.
7. Regressionen, Rust-Gates und paketierter Lauf, dann zwei unabhängige Reviews.

Grenze: Isolation verhindert gewöhnliche Worker-Eingriffe, keine beliebigen
zwischenzeitlichen Selbständerungen eines Testkommandos mit Wiederherstellung.

Report: `.pa/report_sanierung_rest_2026-09-08.md`.
