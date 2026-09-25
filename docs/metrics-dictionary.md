# Metrik-Wörterbuch (F0)

Ereignis, Start/Ende, Einheit, Datenschutz/Retention und Erhebungsort.
Absolute Grenzwerte kommen erst nach dieser Baseline.

| Ereignis | Start / Ende | Einheit | Datenschutz / Retention | Erhebungsort |
|---|---|---|---|---|
| Menschliche Interaktionen je akzeptierter Änderung | erster Klick auf die Task → Merge/Archiv | Zählung | keine PII; mit der Task-Zeile | UI-Telemetry, später F8-Harness |
| Aktive Bedienzeit je akzeptierter Änderung | Fokus auf Attention/Review/Merge | Sekunden | keine Inhalte, nur Dauer | UI, Golden-Path-Harness |
| Zeit Blockade → sichtbare Attention | Hook/Heuristik-Signal → Attention-Quelle sichtbar | Sekunden | Reason-Code, kein Secret | `status` + Attention-Inbox |
| Bestätigte Erstzustellungen | erste Attention-Zustellung → Nutzer öffnet dieselbe Task | Anteil | Worker-Id | Attention + Board |
| Stale Test-/Reviewbelege vor Merge | Evidence geschrieben → Merge-Gate | Anteil erkannt | SHA, kein Diff-Text im Wörterbuch | Review-Evidence, Test-Gate |
| Konfliktrate | `worker-diff-ready` → Merge-Tree | Konflikte / Task | Branch-Namen | Git + F8-Harness |
| Zeit bis Konfliktauflösung | Konflikt erkannt → erwarteter Tree-OID | Sekunden | keine Dateiinhalte | F8-Harness |
| Verworfene Agentenergebnisse | Spawn → Archive ohne Merge | Zählung | Worker-Id | Board / Store |
| Provider- und Tokenkosten je gemergter Task | erste Route → Merge | Tokens, USD soweit gepreist | Ledger ohne Worker-Id (OmniRoute-Limit) | `usage_events`, Insights |
| App-/Agent-CPU | Prozessstart → Beobachtung | ‰ der Maschine | nur Prozess, kein Trace | `resources` / Insights |
| App-RAM | Beobachtung | Bytes (Working Set) | nur Prozess | `resources` / Insights |
| Disk AppData + frei | Beobachtung | Bytes | Pfad nicht exportiert | `resources` / Insights |
| Token ein/aus | Ledger-Fenster (unbegrenzt bis Retention) | Tokens | Modell/Provider, kein Prompt | OmniRoute-Ledger |

Drei Invarianten ohne Toleranz: **null false-ready, null doppelte Ausführung, null Secret-Canary im Export/argv/Log**.
