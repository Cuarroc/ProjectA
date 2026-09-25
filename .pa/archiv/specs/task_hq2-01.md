# HQ2-01 — Gemeinsamer Vertrag für Dev-HQ 2 und ProjectA

Status: historisch
Basis: ProjectA v1.4.1 (`3bcaed3`), 23.09.2026
Paketgröße: M, höchstens 300 Diff-Zeilen; ein Agent, ein Worktree
Dateien: `.pa/task_hq2-01.md`, `docs/development/HQ2_CONTRACT.md`

## Ziel

Einen reviewbaren v1-Vertrag für Projektkoordination, Code-Sitzungen,
Harness-Konfiguration, Anbieter-Kapazität, Ereignisse und Agenten-Briefings
festhalten. Der Vertrag unterscheidet vorhandene ProjectA-API von vorgeschlagenen
HQ2-Erweiterungen und bindet Ausführung sowie Freigaben an Rust/SQLite.

## Abnahme

- Der Vertrag benennt Autorität, Datentypen, Übergaben, Ausfälle und
  Sicherheitsgrenzen ohne einen zweiten Scheduler zu erlauben.
- Die fünf vorhandenen HQ-Tabs sind auf die neue Navigation und eine
  nachprüfbare Paritätsmatrix abgebildet.
- Unbelegte Quoten, Modelle, Billing-Quellen und Tokenwerte erscheinen als
  unbekannt; Abos werden nicht zu einem erfundenen Guthaben addiert.
- `npm run specs` erkennt dieses Paket nach Eintragung im einzigen Arbeitsplan
  und unter „Aktive Specs“ in `STAND.md` durch die Integrations-Lane.
- Ein unabhängiger Reviewer prüft Vertrag und tatsächliche API-Belege;
  Befunde werden vor Integration dispositioniert.

## Abhängigkeiten und Grenzen

`docs/PLAN.md` bleibt der einzige ausführbare Plan; die Integrations-Lane
trägt HQ2-01 dort ein. Dieses Paket implementiert keine API. Die bestehende
Reihenfolge F-CORE-3 → F6 → Multi-Harness und die Continuous-Abnahme-Gates
werden durch diesen Vertrag nicht übersprungen.
