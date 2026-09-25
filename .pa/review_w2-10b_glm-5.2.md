# Review: w2-10b — glm-5.2

- Autor des Artefakts: Kimi K3
- Reviewer: glm-5.2 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `glm-5.2:cloud`, bedient `glm-5.2`
- Datum: 2026-09-25 16:39 UTC, Dauer 68 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_w2-10b.md` (30699 Zeichen)

## Roh-Urteil des Reviewers

## Review: W2-10b — Live-HQ-View Routing/Budget

### Befunde

**F1 — low — `docs/dev-hq/continuous.js:84-88`**

`USAGE_STATE_LABELS` enthält nur `measured`, `partial`, `no_receipts`, `no_allowance`. Laut Kontext ist `usageState ∈ {no_allowance, no_receipts, partial, measured, exceeded, exhausted}`. Treten `exceeded` oder `exhausted` als `usageState` auf, greift der Fallback `tokens.usageState || 'unbekannt'` und zeigt den rohen englischen String an — z. B. „Status exceeded · Überschritten". Das ist erstens eine Sprachmischung (englisch/deutsch) und zweitens redundant, da die booleschen Flags `exceeded`/`exhausted` ohnehin separat als „Überschritten"/„erschöpft" angehängt werden. Die fehlenden Labels sollten ergänzt werden (z. B. `exceeded: 'überschritten'`, `exhausted: 'erschöpft'`), damit der Status-Text konsistent auf Deutsch erscheint.

---

### Weitere Prüfungen (ohne Befund)

**Signatur-Gating:** Die Budget-Signatur wird via `JSON.stringify` über `policies` und die auf `id/route/usage` reduzierten Runs gebildet. Bei unveränderten Daten wird `renderBudget` nicht aufgerufen — DOM bleibt stabil. Bei veränderten Daten wird die Sektion sauber neu gebaut (`replaceChildren()` + `text()`). Der Test „unchanged refresh leaves the budget DOM alone; changed balances rebuild it" bestätigt beide Pfade mit Referenzgleichheit der DOM-Knoten. Korrekt.

**exceeded/exhausted/unresolvedOperations:** Die booleschen Flags werden über `alarm` (entfernt `muted`-Klasse → Hervorhebung) und explizite Text-Flags „· Überschritten"/„· erschöpft" sichtbar dargestellt. `unresolvedOperations > 0` erzeugt einen Hinweis, dass die Reservierung vollständig bestehen bleibt. Die Fallbacks für fehlende Policies/Tokens verwenden „nicht verfügbar"/„unbekannt" und nehmen keine Kosten oder Modelle an. Ehrlich.

**Race-Bedingungen:** Beim Projektwechsel wird `lastBudgetSignature = null` zurückgesetzt und `budgetList.replaceChildren()` geleert. Der `generation`/`sequence`-Wächter aus W2-10a verhindert veraltete Renders. Keine Race erkennbar.

**Inerte Darstellung:** Alle Laufzeitdaten werden über `text()` (textContent) gesetzt. Kein `innerHTML` mit dynamischen Inhalten. Der Test prüft explizit `budget.querySelector('img') === null`.

**Keine Funktionsduplikation:** Die Budget-View zeigt ausschließlich `rootPolicies` (Tokenbudget je Root-Goal) und Routing-/Kostenbelege aus Runs. Provider-Quota bleibt in der App. Regel eingehalten.

**Shortcut `b`:** Folgt dem gleichen Muster wie `g` (reveal + focus). Hilfe-Text aktualisiert. Test prüft Reveal + Focus + Hilfe-Eintrag. Konsistent mit dem bestehenden Design (opt-out via `live-keys-enabled`).

**Testabdeckung:** Rot-erst-Reihenfolge eingehalten (Commit ea411d5 vor 0a73728). Tests decken alle Flows ab: Budget-Summary, Flags, Fallbacks, Routing, Provenance, Signatur-Gating, Shortcut. Visual-Test erzeugt beide geforderten Screenshot-Belege (`budget-routing-live.png`, `budget-routing-keyboard-b.png`).

**Keine Secrets/Kosten im Diff:** Nichts gefunden.

---

### Gesamturteil

**freigeben mit Auflagen**

Der einzige Befund (F1) ist kosmetischer Natur — fehlende deutsche Labels für `exceeded`/`exhausted` als `usageState`. Die Information ist nicht verloren (die booleschen Flags werden separat angezeigt), aber die Sprachmischung und Redundanz sollten vor Merge korrigiert werden. Alle funktionalen Aspekte — Signatur-Gating, ehrliche Fallbacks, inerte Darstellung, Race-Safety, Testabdeckung, Screenshot/Keyboard-Belege — sind korrekt umgesetzt.
