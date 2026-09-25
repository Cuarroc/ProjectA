# MASTERPLAN — geordnete Übersicht der offenen Pakete

Die Paketdefinitionen stehen in `docs/PLAN.md`; dieses Dokument ist die
geordnete Übersicht mit Status, Lane, Modell und Fortschritt. Erledigtes
wandert nach `docs/ERLEDIGT.md`. Geschrieben wird nur vom Koordinator;
`npm run dev:hygiene` prüft u. a., ob Pakete „in Arbeit" einen offenen PR
haben.

## Worker-Struktur

Build-Slots für Cargo: `~/cargo-targets/projecta-{a,b,c}` plus das
`target/` des Hauptcheckouts; Belegung und freier RAM per
`npm run dev:build-slot`. Ein Paket, ein Implementer, ein Worktree.

## S0 — in Arbeit

| ID | Titel | Gr. | Status | Abhängig von | Lane / Dateien | Parallel-Gruppe | Modell | Quelle |
|---|---|---|---|---|---|---|---|---|
| W1-05b | api: cancel route über die dispatched rule | M | in Arbeit PR #19 | W1-05a ✓ | api | api/S0 | K | P |
| W5-02b5 | extraHeader-Reset-Test mit lokalem HTTP-Server | S | in Arbeit PR #17 | W5-02b ✓ | fe | fe/S0 | C | P |
| DF-15b | Release-Reservierung und Zustellung nach belegtem undelivered (KI-27) | M | in Arbeit PR #16 | DF-15a ✓ | rs | rs/S0 | C | P |
| W2-04d | dispatch-Rollen auf Budget-Zwecke im Token-Ledger | M | in Arbeit PR #15 | W2-04c ✓ | rs | rs/S0 | C | P |
| W2-10b | Live-HQ-View Routing/Budget | M | in Arbeit PR #14 | W2-10a | hq | hq/S0 | C | P |
| W2-10a | goals/teams live view im Dev-HQ | M | in Arbeit PR #13 | HQ2 | hq | hq/S0 | C | P |
| W2-07b | Windows-ACL für projecta-api.json und agent-access/ | S | in Arbeit PR #12 | W2-07a ✓ | rs | rs/S0 | C | P |
| LIC-01 | Lizenz-Audit, Allowlist-Gate, Third-Party-Notices | M | in Arbeit PR #10 | — | ci | doc/S0 | C | P |
| README-01 | README ehrlich neu schreiben | S | in Arbeit PR #6 | — | docs | doc/S0 | C | P |
