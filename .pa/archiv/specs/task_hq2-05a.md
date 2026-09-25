# HQ2-05a — Anbietergetrennte Kapazitätsprojektion

Status: historisch
Basis: ProjectA v1.4.1 (`3bcaed3`)
Paketgröße: M, höchstens 300 Diff-Zeilen
Dateien: `src/lib/hqCapacity.ts`, `src/lib/hqCapacity.test.ts`

Ziel: Fünf vom Nutzer genannte Abos als getrennte Zeilen abbilden. Messung,
Quelle, Zeitpunkt und Profilbudget bleiben getrennt; lokale/heuristische
Werte sind kein Abo- oder Billing-Nachweis. Collector-Integration folgt in
HQ2-05b.

Abnahme: unbekannte Werte bleiben unbekannt; lokale Ollama-Instanz zählt
nicht als Ollama Pro; ausdrückliche Quota-Sperren und Stale-Zeiten stimmen;
TypeScript und gezielte Unit-Tests bestehen; Review-Befunde sind erledigt.
