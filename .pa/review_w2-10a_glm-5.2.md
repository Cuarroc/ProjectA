# Review W2-10a — glm-5.2:cloud (Ollama Cloud), unabhängiger Reviewer

Autor des Kandidaten: Kimi K3 (deshalb Reviewer GLM 5.2, nicht das
Autoren-Modell). Transport: lokaler Ollama-Endpunkt
(`http://127.0.0.1:11434/api/generate`), da `.pa/review_transport.py` im
öffentlichen Repo nicht vorhanden ist; Prompt manuell mit Skript zusammengesetzt
(Regeln-Auszug + vollständiger Diff, 27 KB), Antwort ungekürzt unten.

## Teil 1 — Gesamtdiff origin/main...02e6101

Verdict: **approve** (4 Low-Funde F1–F4).

---

## Review findings

**F1 — low — `scripts/lib/hq-goals-live.test.mjs:99-109`**
The `g`-key test dispatches `keydown` on `document` and asserts the teams panel is revealed and focus lands on the card, but it never checks `#live-keys-enabled`. The handler in `hq.js` early-returns when `!keysToggle.checked`. The test only passes if unseen initialization code in `hq.js` defaults the checkbox to checked (or restores it from storage). The same assumption is present in the Playwright test (`hq-visual.browser.mjs:257`). This is likely fine (the commit presumably passes CI), but the test is not self-contained — it silently depends on a default that isn't visible in the diff.

**F2 — low — `docs/dev-hq/continuous.js:127-131` (restoreListState)**
Focus restoration uses `active.name || active.tagName.toLowerCase()` as the `part` key and then queries `[name="${part}"]`. This works for named form fields (`assignee`, `teamId`, `role`) and the `summary` fallback, but a focused `<button>` without a `name` attribute (e.g., a submit button in the assignment form) would produce `part = "button"`, the querySelector `[name="button"]` would miss it, and focus would be silently dropped. Impact is minor since the primary operator-state concern is text fields and selects, but it's a gap in the "focus survives refresh" guarantee.

**F3 — low — `docs/dev-hq/continuous.js:173`**
The rebuild signature is `JSON.stringify({ goals, tasks, teams, controlStatus })`, and `teams` is declared at line 55 (`let teams = []`), but the diff doesn't show where `teams` is assigned within `refresh()`. If `teams` is never updated in the unshown portion of the function, team membership changes wouldn't trigger a goals rebuild, and the ownership summary could go stale. This is probably handled in code outside the diff hunk, but it's worth confirming that `teams` is populated before the signature is computed.

**F4 — low — `docs/dev-hq/continuous.js:85-99` (renderOwnership)**
When `goal.status` is missing or empty, `String(goal.status || '').toLowerCase()` yields `''`, which is not in the `closed` set, so the goal is treated as running. This is a reasonable default (unknown ≠ closed), but the displayed status text falls back to `'unbekannt'` (unknown). No bug, just noting the implicit assumption that any non-closed status is "running."

Rules-Compliance-Tabelle des Reviewers: visueller Beleg ✅, Red-first ✅,
keine Secrets ✅, inertes Rendering ✅, Offline-/Fehlerzustand unterscheidbar ✅,
Refresh-Zustandserhalt ✅, Shortcut-Typing-Guard ✅, fmt ✅.

`VERDICT: approve`

## Teil 2 — Delta nach Nacharbeit (Commit ae41907)

Verdict: **approve** (nur Info-Notizen).

- F1 (info): part-Mapping button→'submit' greift nur bei namenlosen Buttons;
  keine Kollision mit den benannten Feld-/Summary-Pfaden.
- F2 (info): `button[type="submit"]` ist ein Attribut-Selektor; das Produkt-
  Markup trägt explizites `type="submit"` (Test grün) — Zukunftsfallstrich
  bei ungetypten Buttons, keine Aktion jetzt.
- F3 (info): bei mehreren Submit-Buttons je Task würde der erste fokussiert;
  aktuell genau einer je Formular.
- F4 (low): Test-Soundness bestätigt; Rot-Behauptung gegen den Pre-Fix-Stand
  glaubhaft (part='button' matchte nichts, activeElement fiele auf body).
- F5 (info): F1-Assertion vor dem keydown-Dispatch macht die Abhängigkeit vom
  Shortcut-Default explizit.

`VERDICT: approve`
