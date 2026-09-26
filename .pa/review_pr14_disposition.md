# Review-Disposition PR #14 (W2-10b)

Autor: Kimi K3. Reviewer Stufe B (ein Reviewer, nicht die Autorenfamilie):
**xAI Grok** (grok CLI, Single-Turn, read-only), Protokoll unverändert in
`.pa/review_pr14_grok.md`, Prompt in `.pa/review_prompt_pr14.md`. Kandidat:
`origin/main...HEAD` nach dem Merge von `origin/main` (Merge-Commit
`3e566fb`, Konflikt in `scripts/lib/hq-routes.test.mjs` aufgelöst).

Urteil des Reviewers: 6 Befunde (2 high, 3 medium, 1 low); die beiden
früheren Ablehnungen (GLM F1, Qwen-Race) bestätigt er als haltbar, die
W2-10a-Fokus-Reparatur hält er für wirkungslos (F4).

## Befunde und Disposition

| ID | Schwere | Befund | Disposition |
|---|---|---|---|
| F1 | high | `routingSummary` liest `resolvedModel.value`/`effort.value`, die API serialisiert `Observation<T>` extern getaggt (`measured.value`, `requested.value`, `unavailable.reason`) — echte Belege zeigen „Modell unbekannt · Aufwand unbekannt" | **angenommen**. Verifiziert: `src-tauri/src/development_policy.rs` (`enum Observation`, Serializer-Test `serialized["resolvedModel"]["measured"]["value"]`). Alle drei Fixtures (hq-budget-live, hq-continuous, hq-visual) hatten die nie gesendete Kurzform gepinnt. Rot-Test (Fixture auf echte Shape + Assertion) Exit 1, Fix in `61f93c3`, grün. |
| F2 | high | „die Reservierung bleibt bestehen" bei jedem nicht-`measured`-Beleg — falsch für `not_reserved`, `cancelled`, `unclassified` | **angenommen**. Verifiziert: `run_receipt` in `development_usage_receipt.rs` — nur `pending`, `rejected`, `not_reported` halten die Reservierung. Suffix jetzt zustandsgebunden; Rot-Test Exit 1, Fix `61f93c3`. |
| F3 | medium | Fehlgeschlagener Runs-Fetch wird als „Keine Routing-Belege" dargestellt und ersetzt gute Belege; Signatur bildet Fehler und leere Liste auf denselben Wert ab | **angenommen**. Verifiziert: `renderBudget` unterschied `null` nicht (die Runs-Sektion darunter sehr wohl). Jetzt „Run- und Kostenbelege nicht verfügbar" + eigener Signaturwert (`receipts: null` vs `[]`). Rot-Test Exit 1, Fix `61f93c3`. |
| F4 | medium | Submit-Fokus stirbt im Browser bei jedem 5-s-Tick: `enable(false)` vor dem Fetch blurrt das fokussierte Control, `captureListState` läuft erst nach dem `await`; JSDOM blurrt nicht, darum blieb es grün | **angenommen**. Verifiziert am Code (disable vor capture; JSDOM-Verhalten in der Probe reproduziert: kein Fokus-Fixup, `blur()` auf disabled ist No-op). Fix: Fokus-Identität vor dem Disable erfassen, nach `enable(true)` zurückgeben — nur wenn der Fokus wirklich verloren ging (kein Focus-Stealing). Rot-Test mit simuliertem Browser-Fixup (Setter-Patch) Exit 1, Fix `61f93c3`. |
| F5 | medium | Projektwechsel leert `[data-runs]` nicht; schlägt der Kontext des neuen Projekts fehl, bleiben die Runs des alten Projekts stehen | **angenommen**. Verifiziert: Projektwechsel-Clear ohne `runsList`. Jetzt mitgeleert. Rot-Test Exit 1, Fix `61f93c3`. |
| F6 | low | Plural falsch: „2 offener Vorgänge" | **angenommen**. „offene Vorgänge" für n ≠ 1. Rot-Test Exit 1, Fix `61f93c3`. |

Alle sechs Befunde angenommen → Nacharbeit am Kandidaten, gebunden an
red-first-Tests (Rot-Commit `4f7f7cb`, Exit 1 gegen den Pre-Fix-Stand;
Grün-Nachweis: `node --test scripts/lib/hq-budget-live.test.mjs
scripts/lib/hq-goals-live.test.mjs scripts/lib/hq-continuous.test.mjs`
24/24 Exit 0; `npm run test:hq` 294/294 Exit 0; `HQ_SHOT_DIR=… npm run
test:hq:visual` 13/13 Exit 0; Screenshot `budget-routing-live.png` zeigt
„Modell kimi-k3 · Aufwand high" aus der echten Observation-Shape).

## Hinweise des Reviewers ohne Befund-Status

- Grok bestätigt die Ablehnung von GLM F1 (usage_state ist eine
  geschlossene Menge) und der Qwen-Race (synchroner Block, Generation-Guard)
  nach Lektüre des Codes — die früheren Dispositionen bleiben tragfähig.
