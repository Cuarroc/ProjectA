# Review request PR #14 (W2-10b): live budget/routing view in the Dev HQ — final candidate

You are an independent reviewer (not the author; the author is a Kimi model).
Review the COMPLETE final candidate below for correctness bugs, gaps against
the requirements, and safety regressions. Be concrete: cite file and line,
say what breaks and when. Rate each finding high/medium/low. Do not restate
the diff. If something is fine, say nothing about it. Answer in English or
German. This is a READ-ONLY review: do not modify any files.

## Context

Repo: ProjectA, a Tauri 2 "agentic terminal" (Rust backend in src-tauri/,
public GitHub repo). The Dev HQ is a local live web page (docs/dev-hq/,
served by scripts/hq-live.mjs on 127.0.0.1) that reads an HQ v1 API.
`docs/dev-hq/continuous.js` builds the "Ziele & kontinuierliche Entwicklung"
card on that page; `docs/dev-hq/hq.js` wires the page shell and the
single-key shortcuts. The page polls every 5 seconds.

Evidence standard (project rule): nothing may be shown as measured,
available or done that is not observed — missing data needs an honest
fallback, never an assumption. Dynamic content must be inert: textContent
only, no innerHTML with runtime data. No secrets, no personal data, no
costs in the diff.

## Package requirement (plan wording, translated)

W2-10b, second child of W2-10 "live HQ views": the "Budget & Routing"
section of the continuous card must become a real live view, following the
W2-10a pattern (goals/teams, already part of this branch). Acceptance per
plan: keyboard and screenshot evidence per flow. Hard rule from the
assignment: no function twice in app and HQ — the app shows provider
quota/costs (UsageView), the HQ view shows ONLY the continuous token budget
per root goal and the routing/cost receipts from the HQ v1 API.

Data (already in the HQ v1 API, no backend change):
- `/api/hq/v1/context` → `snapshot.effectiveLimits.rootPolicies[]` with
  `policy` (incl. `routing`: billing, quotaReservePercent, additionalPaidApi)
  and `tokens` = TokenBalance (allowance.maxPerGoal, measuredTokens,
  reservedTokens, verificationRemaining, availableTokens,
  implementationAvailable, unresolvedOperations, usageState ∈
  {no_allowance, no_receipts, partial, measured} — a closed set, see
  src-tauri/src/store/development_budget.rs — plus the separate booleans
  exceeded, exhausted).
- `/api/hq/v1/runs` → per run `launch.routeJson` (routing receipt:
  `selection.resolved` {provider, profileId, resolvedModel, effort},
  `executionObservation.reason`) and `usage` (cost receipt: state ∈
  {measured, rejected, not_reported}, tokens, reason, provenance.collector).

Note on the diff scope: the branch stacks the not-yet-merged W2-10a
(goals/teams live view, shortcut `g`, signature gating, focus/draft
preservation across rebuilds). W2-10a already passed its own review; focus
on the W2-10b delta (renderBudget, budget signature gating, shortcut `b`,
the new tests), but report NEW bugs anywhere in the candidate.

## Review history (already addressed — verify, don't just re-report)

W2-10b was reviewed by GLM 5.2 and Qwen 2.5 Coder on the pre-merge
candidate (full protocols and disposition: `.pa/review_w2-10b_*.md`,
`.pa/review_w2-10b_disposition.md`). All findings were REJECTED with
reasons; the candidate was not changed:

- GLM F1 (low, rejected): "USAGE_STATE_LABELS misses exceeded/exhausted".
  Premise wrong: usage_state is a closed 4-value set (all labelled);
  exceeded/exhausted are separate booleans, already rendered as flags.
- Qwen F1–F5 (medium/low, rejected): "race between renderBudget and the
  signature gating". No mechanism: signature compute/compare/render/store
  run synchronously in one block without await; JS is single-threaded;
  stale async completions are caught by the generation guard from W2-10a.
- W2-10a findings (accepted and fixed earlier, part of this branch):
  submit-button focus restore across rebuilds (`part='submit'`,
  restore via `button[type="submit"]`); the g-key test pins the
  `#live-keys-enabled` default before dispatching.

Check whether those rejections/fixes are actually sound, and hunt for NEW
bugs anywhere in the candidate.

## Diff (git diff origin/main...HEAD, complete final candidate)

```diff
diff --git a/.pa/report_w2-10a.md b/.pa/report_w2-10a.md
new file mode 100644
index 0000000..f15cead
--- /dev/null
+++ b/.pa/report_w2-10a.md
@@ -0,0 +1,104 @@
+# Report W2-10a — Live-HQ-View Goals/Teams
+
+Paket: W2-10a (erstes Kind von W2-10 „Live-HQ-Views", Quelle: `docs/PLAN.md`).
+Branch `claude/w2-10a`, Arbeitsbaum `public/wt/w2-10a`.
+
+## Was sich geändert hat
+
+Die Karte „Ziele & kontinuierliche Entwicklung" im Dev-HQ (Live-Seite, Panel
+„Agenten-Teams") ist jetzt eine echte Live-Ansicht statt einer Ansicht, die den
+Bedienende alle 5 s aus dem UI wirft:
+
+- **Ownership-Summary** (`[data-ownership]`, inert via `textContent`): je
+  laufendem (nicht geschlossenem) Ziel eine kompakte Zeile — Status, Besetzung
+  (Claim-Owner), Team-Sitz (`team/role`) und eigene Dateibereiche. Daten aus
+  der vorhandenen HQ-v1-API (`/api/hq/v1/context`), kein neues Backend, keine
+  Doppelfunktion zur App (die App kennt nur Produktziele in der ViewBar).
+- **Zustandserhalt über den 5-s-Tick**: eine Signatur über
+  `{goals, tasks, teams, controlStatus}` überspringt den DOM-Neuaufbau bei
+  unveränderten Daten; bei geänderten Daten werden offene `<details>`,
+  ungespeicherte Zuweisungs-Entwürfe (dirty Felder) und der Fokus (benannte
+  Felder, `summary`, Submit-Button) gesichert und wiederhergestellt. Vorher
+  riss `replaceChildren()` alle 5 s Fokus, offene Details und Entwürfe weg.
+- **Tastatur**: `g` öffnet von jedem Tab aus das Teams-Panel und fokussiert
+  die Karte (`#hq-goals-live`, `tabindex="-1"`); in der `?`-Hilfe dokumentiert.
+  Bestehender Typing-Guard greift (kein Feuern in Eingabefeldern).
+- Budget/Routing (W2-10b) und Runs/Review/Delivery (W2-10c) unberührt.
+
+Zusatz, gate-blockierend und vorbestehend (nicht von diesem Paket verursacht):
+
+- `src-tauri/src/skills.rs`: ein `assert!` von rustfmt (1.98.0) umgebrochen —
+  das fmt-Gate war auf einem sauberen Checkout des initialen öffentlichen
+  Releases rot und blockierte jeden Commit (`2781173`, `No-Test`).
+- `scripts/hq-live.mjs` + `scripts/lib/hq-routes.test.mjs`: der
+  Insights-Schätzer las das ungetrackte, instanzlokale `.pa/ACTIVITY.md`; auf
+  einem sauberen Klon des öffentlichen Repos (ein Squash-Commit, kein Journal)
+  fiel die Zeitschätzung auf eine einzelne git-Sitzung und der hq-routes-Test
+  (`hours > 1`) war rot — das Gate `hq-test` (Bahnen prepush/linux) war auf
+  `origin/main` ohne lokale Dateien rot. hq-live ehrt jetzt
+  `HQ_ACTIVITY_FILE`, der Test setzt ein Fixture-Journal (`5ec7f8d`).
+
+## Rot → Grün
+
+| Schritt | Befehl | Exit |
+|---|---|---|
+| Rot (3 neue Tests gegen Bestand) | `node --test scripts/lib/hq-goals-live.test.mjs` | **1** (alle 3 rot) |
+| Grün nach Implementierung | derselbe | **0** (4 ✔ inkl. F2-Test) |
+| Vorbestehender Basis-Rot (Beleg) | `node --test --test-name-pattern=insights scripts/lib/hq-routes.test.mjs` im sauberen Basis-Worktree (`origin/main`) | **1** („0.5 h") |
+| Basis-Fix grün | `node --test scripts/lib/hq-routes.test.mjs` | **0** (8 ✔) |
+| F2-Nacharbeit rot ohne Fix | `node --test --test-name-pattern="submit button" scripts/lib/hq-goals-live.test.mjs` (continuous.js gestasht) | **1** |
+| F2-Nacharbeit grün | `node --test scripts/lib/hq-goals-live.test.mjs` | **0** |
+
+Commits: `2781173` (fmt), `330356a` (rot, Test-First-Trailer), `ea6ecf9`
+(Implementierung), `5ec7f8d` (hermetischer Insights-Fix, Regression-For:
+c60f267), `02e6101` (visueller Beleg), `ae41907` (Review-Nacharbeit F1/F2).
+
+## Gates
+
+- `npm run test:hq` → **Exit 0** (270 Tests, 270 pass).
+- `HQ_SHOT_DIR=… npm run test:hq:visual` → **Exit 0** (12 Tests; Screenshots
+  `goals-teams-ownership.png`, `goals-teams-keyboard-g.png` erzeugt und
+  **angesehen**: Ownership-Zeile lesbar und inert; nach `g` ist das
+  Agenten-Teams-Panel aktiv und die Karte fokussiert). Die PNGs sind
+  reproduzierbar (visueller Harness gegen Mock-API); das öffentliche Repo
+  ignoriert `.pa/*`-Binärdateien bewusst (`.gitignore`), darum Beleg als
+  reproduzierbarer Testlauf plus inspizierte Aufnahme, nicht als Commit.
+- `bash scripts/ci/gates.sh lane prepush` (CARGO_TARGET_DIR Slot projecta-c,
+  CARGO_BUILD_JOBS=1) → **Exit 0**: fmt 2 s, typecheck 7 s, lint 31 s,
+  fe-test 48 s, hq-test 9 s, clippy 167 s, rust-suite 388 s.
+- Der Push-Hook fährt dieselbe Lane am finalen Kopf erneut.
+
+### NICHT ABGEDECKT (aus dem Gate-Lauf, Windows)
+
+- die `#[cfg(unix)]`-Tests (Dateirechte, Prozessgruppen-Kill) — kompilieren
+  unter Windows nicht (KNOWN_ISSUES KI-7); die Linux-Arme von clippy.
+  Dieser Lauf belegt die Windows-Hälfte, nicht die Linux-Hälfte
+  (Linux: WSL2 mit Clone auf ext4, siehe docs/ci-lokal.md).
+- Bahn `prepush` ist die schnelle Schleife: Browser-Smoke, Frontend-Build und
+  die Workflow-Gates laufen erst in der Bahn `linux` (CI bzw. Merge-Queue).
+- Der Zustand externer Dienste (Updater-Endpoint, OmniRoute, Mirror) wird von
+  keinem Gate geprüft.
+- `hq-visual` lief lokal (Chromium vorhanden); in CI läuft es in der
+  Linux-Bahn.
+
+## Reviews
+
+GLM 5.2 (nicht die Autorenfamilie; Autor Kimi K3): Gesamtdiff **approve**
+(4 Low-Funde), Delta nach Nacharbeit **approve**. Disposition:
+`.pa/review_w2-10a_disposition.md` — F1/F2 angenommen (Commit `ae41907`),
+F3/F4 begründet abgelehnt. Protokoll: `.pa/review_w2-10a_glm-5.2.md`.
+Diff-Umfang 242+/10−, keine Nahtstelle → ein Review ausreichend (AGENTS.md).
+
+## Offene Punkte / Folgearbeit
+
+- W2-10b (Routing/Budget) und W2-10c (Review/Delivery) als eigene Pakete; die
+  Abschnitte sind in der Karte markiert und bewusst unberührt.
+- Mergify-Regel „Paket-PR bringt `.pa/report_*.md` mit" steht gegen PLAN-01
+  („Report im PR-Text"): dieser PR trägt beides, die Regel-Drift ist dem
+  Koordinator zu melden.
+- Delta-Review-Notiz: falls ein Zuweisungsformular künftig mehrere
+  Submit-Buttons oder ungetypte Buttons bekommt, Fokus-Restore mit
+  Diskriminator nachrüsten.
+- Der Screenshot-Beleg entstand gegen den Mock-API-Harness (hq-visual), nicht
+  gegen eine laufende App — bewusst: die App darf zum bloßen Ansehen nicht
+  gestartet werden (Queue könnte Worker dispatchen).
diff --git a/.pa/report_w2-10b.md b/.pa/report_w2-10b.md
new file mode 100644
index 0000000..a7c544a
--- /dev/null
+++ b/.pa/report_w2-10b.md
@@ -0,0 +1,115 @@
+# Report W2-10b — Live-HQ-View Routing/Budget
+
+Paket: W2-10b (zweites Kind von W2-10 „Live-HQ-Views", Quelle: `docs/PLAN.md`).
+Branch `claude/w2-10b`, Arbeitsbaum `public/wt/w2-10b`. **Stapelt auf dem
+ungemergten `claude/w2-10a`** (W2-10a war bei Paketbeginn nicht auf main;
+Auftrag: dann auf dessen Branch aufsetzen und im PR vermerken).
+
+## Was sich geändert hat
+
+Die Sektion „Budget & Routing" der Karte „Ziele & kontinuierliche Entwicklung"
+im Dev-HQ (Live-Seite) ist jetzt eine echte Live-Ansicht nach dem Muster von
+W2-10a:
+
+- **Budget-Summary je Root-Goal** (`docs/dev-hq/continuous.js`, inert via
+  `textContent`): Limit, gemessen, reserviert, verfügbar, Umsetzungsbudget,
+  Prüfungsschutz (verificationRemaining), Status als ehrliches deutsches Label
+  (gemessen / teilweise belegt / keine Belege erfasst / kein Budget
+  eingeräumt), Sichtbarmachung von `exceeded`/`exhausted` (un-gemutet +
+  Text-Flags) und der offenen Vorgänge ohne Beleg. Daten aus der vorhandenen
+  HQ-v1-API (`/api/hq/v1/context` → `effectiveLimits.rootPolicies[].tokens` =
+  TokenBalance), kein neues Backend.
+- **Routing- & Kostenbelege** (`[data-routing]`): je Root-Goal die
+  Policy-Routing-Regeln (erlaubte Billing-Quellen, Quota-Reserve,
+  zusätzliche kostenpflichtige API), je Run der aggregierte Routing-Beleg aus
+  `launch.routeJson` (Provider · Profil · Modell · Aufwand · Ausführungsbeleg,
+  bestehende `routingSummary`) und der W2-03-Kostenbeleg mit Provenienz
+  (Collector, Messung) — oder der benannte Grund, warum keiner existiert.
+  Unlesbare Belege werden als unlesbar benannt, nichts wird angenommen.
+- **Signatur-Gating**: eine Signatur über Policies + Belege lässt den 5-s-Tick
+  die Sektion bei unveränderten Daten unangetastet (vorher: Rebuild bei jedem
+  Tick); Projektwechsel setzt die Signatur zurück.
+- **Tastatur**: `b` öffnet von jedem Tab aus das Teams-Panel und fokussiert
+  die Sektion (`#hq-budget-live`, `tabindex="-1"`); in der `?`-Hilfe
+  dokumentiert. Bestehender Typing-Guard und Opt-out greifen.
+- **Keine Doppelfunktion App/HQ**: die App (UsageView) zeigt Provider-Quota/
+  Kosten; diese View zeigt ausschließlich das Continuous-Tokenbudget und
+  Routing-/Kostenbelege aus HQ v1. Runs/Review/Delivery (W2-10c) und die
+  Ownership-View (W2-10a) unberührt.
+
+## Rot → Grün
+
+| Schritt | Befehl | Exit |
+|---|---|---|
+| Rot (6 neue Tests gegen Bestand) | `node --test scripts/lib/hq-budget-live.test.mjs` | **1** (6 von 7 rot; der Fallback-Test war durch 10a-Texte bereits grün) |
+| Grün nach Implementierung | derselbe | **0** (7 ✔) |
+
+Commits: `ea411d5` (rot, Test-First-Trailer), `0a73728` (Implementierung),
+`34532aa` (visueller Beleg).
+
+## Gates
+
+- `npm run test:hq` → **Exit 0** (278 Tests, 278 pass).
+- `HQ_SHOT_DIR=… npm run test:hq:visual` → **Exit 0** (13 Tests; Screenshots
+  `budget-routing-live.png`, `budget-routing-keyboard-b.png` erzeugt und
+  **angesehen**: Budget-Zeilen und Belege lesbar und inert; nach `b` ist das
+  Agenten-Teams-Panel aktiv und die Sektion sichtbar fokussiert). Beleg als
+  reproduzierbarer Testlauf plus inspizierte Aufnahme, nicht als Commit
+  (Repo ignoriert `.pa/*`-Binärdateien bewusst; Harness = Mock-API, die App
+  wird zum Ansehen nicht gestartet).
+- `bash scripts/ci/gates.sh lane prepush` (CARGO_TARGET_DIR Slot projecta-c,
+  CARGO_BUILD_JOBS=1) → **Exit 0**: fmt 6 s, typecheck 13 s, lint 32 s,
+  fe-test 91 s, hq-test 24 s, clippy 126 s, rust-suite 267 s.
+- Der Push-Hook fährt dieselbe Lane am finalen Kopf erneut.
+
+### NICHT ABGEDECKT (aus dem Gate-Lauf, Windows)
+
+- die `#[cfg(unix)]`-Tests (Dateirechte, Prozessgruppen-Kill) — kompilieren
+  unter Windows nicht (KNOWN_ISSUES KI-7); die Linux-Arme von clippy.
+  Dieser Lauf belegt die Windows-Hälfte, nicht die Linux-Hälfte
+  (Linux: WSL2 mit Clone auf ext4, siehe docs/ci-lokal.md).
+- Bahn `prepush` ist die schnelle Schleife: Browser-Smoke, Frontend-Build und
+  die Workflow-Gates laufen erst in der Bahn `linux` (CI bzw. Merge-Queue).
+- Der Zustand externer Dienste (Updater-Endpoint, OmniRoute, Mirror) wird von
+  keinem Gate geprüft.
+- `hq-visual` lief lokal (Chromium vorhanden); in CI läuft es in der
+  Linux-Bahn.
+
+## Reviews
+
+Diff +359/−23 (> 300 Zeilen) → zwei Reviews anderer Anbieter (Autor Kimi K3,
+beide Reviewer nicht die Autorenfamilie):
+
+- **GLM 5.2** (`glm-5.2:cloud`, Ollama Cloud): **freigeben mit Auflagen**
+  (1 Low-Befund). Protokoll `.pa/review_w2-10b_glm-5.2.md`.
+- **Qwen 2.5 Coder 14B** (`qwen2.5-coder:14b`, lokal via Ollama):
+  **freigeben mit Auflagen** (5 inhaltlich identische Befunde). Protokoll
+  `.pa/review_w2-10b_qwen2.5-coder.md`.
+
+Disposition: `.pa/review_w2-10b_disposition.md` — alle Befunde begründet
+abgelehnt (GLM-F1: Prämisse falsch, `usage_state` ist eine geschlossene
+Vierermenge und vollständig übersetzt; Qwen-F1–F5: behauptete Race ohne
+Mechanismus — Signatur-Prüfung und Render laufen synchron in einem Block,
+Generation-Guard fängt veraltete Abschlüsse ab, Test belegt beide Pfade).
+Kein Befund angenommen → keine Nacharbeit, kein Delta-Review nötig.
+
+Ersatzweg (Transparenz): das Advisor-Paar war nicht verfügbar — Fable 5.1
+(Claude-Subagent) 402 „Insufficient account funds", GPT-6 Astra (Codex CLI)
+„usage limit" bis 30.09.2026, deepseek-v4-flash:cloud aus Ollama Cloud
+entfernt (HTTP 410). Kein Geld ausgegeben; Qwen 2.5 Coder war auf dieser
+Maschine bereits als Reviewer etabliert.
+
+## Offene Punkte / Folgearbeit
+
+- W2-10c (Runs/Review/Delivery) als eigenes Paket; die Runs-Sektion ist
+  markiert und bewusst unberührt. Die per-Run-Routing-Zeile dort bleibt
+  vorerst — Aggregat (10b) vs. Detail (10c) ist abgestimmt, bei 10c prüfen,
+  ob die Detailzeile entfällt.
+- Stacking: dieser Branch enthält die W2-10a-Commits; landet W2-10a zuerst
+  auf main, ist der Diff dieses PR automatisch nur noch das 10b-Delta.
+- Mergify-Regel „Paket-PR bringt `.pa/report_*.md` mit" steht weiter gegen
+  PLAN-01 („Report im PR-Text"): dieser PR trägt beides (wie W2-10a), die
+  Regel-Drift ist dem Koordinator gemeldet.
+- Reviewer-Verfügbarkeit: deepseek-v4-flash:cloud ist aus Ollama Cloud
+  verschwunden (410); `docs/setup/ollama-reviewers.md` nennt nur das
+  Paar kimi-k3/glm-5.2 — bei Bedarf Ersatz-Reviewer dokumentieren.
diff --git a/.pa/review_w2-10a_disposition.md b/.pa/review_w2-10a_disposition.md
new file mode 100644
index 0000000..852fa1f
--- /dev/null
+++ b/.pa/review_w2-10a_disposition.md
@@ -0,0 +1,27 @@
+# Review-Disposition W2-10a
+
+Reviewer: GLM 5.2 (`glm-5.2:cloud`, Ollama Cloud) — nicht die Autorenfamilie
+(Autor: Kimi K3). Kandidat: `02e6101`, Delta nach Nacharbeit: `ae41907`.
+Review-Protokoll: `.pa/review_w2-10a_glm-5.2.md`. Urteile: approve / approve.
+
+## Befunde und Disposition
+
+| ID | Schwere | Befund | Disposition |
+|---|---|---|---|
+| F1 | low | g-Key-Test hängt still am Default von `#live-keys-enabled` | **angenommen**, Commit `ae41907`: Test assertet den Default explizit vor dem Dispatch |
+| F2 | low | Fokus auf Submit-Button ohne `name` ging bei Rebuild verloren (`part='button'` matcht nichts) | **angenommen**, Commit `ae41907`: Buttons → `part='submit'`, Restore via `button[type="submit"]`; neuer Test war rot gegen den Pre-Fix-Stand (`node --test --test-name-pattern="submit button"` → Exit 1) und ist grün |
+| F3 | low | `teams`-Zuweisung im Diff nicht sichtbar — ginge die Signatur bei Team-Änderung nicht mit? | **abgelehnt mit Grund**: `teams` wird in `refresh()` (continuous.js, Zuweisung aus `effectiveLimits.rootPolicies`) vor der Signaturberechnung gesetzt; die Signatur enthält `teams`, Team-Änderungen lösen den Rebuild aus. Im Quelltext verifiziert. |
+| F4 | low | Unbekannter/fehlender Goal-Status gilt als „laufend" | **abgelehnt mit Grund**: bewusstes Design — „unbekannt ≠ geschlossen" folgt dem Belegstandard (nichts wird als erledigt angenommen, das nicht belegt ist); der Status wird als `unbekannt` angezeigt. |
+
+## Delta-Review (ae41907), Info-Notizen
+
+- D-F1/D-F2/D-F3 (info): korrekte Selektoren, Attribut-Selektor-Falle bei
+  künftigen ungetypten Buttons, Erste-Treffer-Regel bei mehreren Submits —
+  **zur Kenntnis**, keine Aktion; als Folgearbeit notiert, falls ein
+  Zuweisungsformular je mehrere Submit-Buttons bekommt.
+- D-F4 (low): Test-Soundness bestätigt — keine Aktion.
+- D-F5 (info): Assertion-Platzierung korrekt — keine Aktion.
+
+Nach der Nacharbeit wurde das Delta erneut reviewt (Regel: neue Evidenz an
+den geänderten Kandidaten binden). Stand danach: zwei Urteile „approve",
+keine offenen Befunde.
diff --git a/.pa/review_w2-10a_glm-5.2.md b/.pa/review_w2-10a_glm-5.2.md
new file mode 100644
index 0000000..b97b195
--- /dev/null
+++ b/.pa/review_w2-10a_glm-5.2.md
@@ -0,0 +1,51 @@
+# Review W2-10a — glm-5.2:cloud (Ollama Cloud), unabhängiger Reviewer
+
+Autor des Kandidaten: Kimi K3 (deshalb Reviewer GLM 5.2, nicht das
+Autoren-Modell). Transport: lokaler Ollama-Endpunkt
+(`http://127.0.0.1:11434/api/generate`), da `.pa/review_transport.py` im
+öffentlichen Repo nicht vorhanden ist; Prompt manuell mit Skript zusammengesetzt
+(Regeln-Auszug + vollständiger Diff, 27 KB), Antwort ungekürzt unten.
+
+## Teil 1 — Gesamtdiff origin/main...02e6101
+
+Verdict: **approve** (4 Low-Funde F1–F4).
+
+---
+
+## Review findings
+
+**F1 — low — `scripts/lib/hq-goals-live.test.mjs:99-109`**
+The `g`-key test dispatches `keydown` on `document` and asserts the teams panel is revealed and focus lands on the card, but it never checks `#live-keys-enabled`. The handler in `hq.js` early-returns when `!keysToggle.checked`. The test only passes if unseen initialization code in `hq.js` defaults the checkbox to checked (or restores it from storage). The same assumption is present in the Playwright test (`hq-visual.browser.mjs:257`). This is likely fine (the commit presumably passes CI), but the test is not self-contained — it silently depends on a default that isn't visible in the diff.
+
+**F2 — low — `docs/dev-hq/continuous.js:127-131` (restoreListState)**
+Focus restoration uses `active.name || active.tagName.toLowerCase()` as the `part` key and then queries `[name="${part}"]`. This works for named form fields (`assignee`, `teamId`, `role`) and the `summary` fallback, but a focused `<button>` without a `name` attribute (e.g., a submit button in the assignment form) would produce `part = "button"`, the querySelector `[name="button"]` would miss it, and focus would be silently dropped. Impact is minor since the primary operator-state concern is text fields and selects, but it's a gap in the "focus survives refresh" guarantee.
+
+**F3 — low — `docs/dev-hq/continuous.js:173`**
+The rebuild signature is `JSON.stringify({ goals, tasks, teams, controlStatus })`, and `teams` is declared at line 55 (`let teams = []`), but the diff doesn't show where `teams` is assigned within `refresh()`. If `teams` is never updated in the unshown portion of the function, team membership changes wouldn't trigger a goals rebuild, and the ownership summary could go stale. This is probably handled in code outside the diff hunk, but it's worth confirming that `teams` is populated before the signature is computed.
+
+**F4 — low — `docs/dev-hq/continuous.js:85-99` (renderOwnership)**
+When `goal.status` is missing or empty, `String(goal.status || '').toLowerCase()` yields `''`, which is not in the `closed` set, so the goal is treated as running. This is a reasonable default (unknown ≠ closed), but the displayed status text falls back to `'unbekannt'` (unknown). No bug, just noting the implicit assumption that any non-closed status is "running."
+
+Rules-Compliance-Tabelle des Reviewers: visueller Beleg ✅, Red-first ✅,
+keine Secrets ✅, inertes Rendering ✅, Offline-/Fehlerzustand unterscheidbar ✅,
+Refresh-Zustandserhalt ✅, Shortcut-Typing-Guard ✅, fmt ✅.
+
+`VERDICT: approve`
+
+## Teil 2 — Delta nach Nacharbeit (Commit ae41907)
+
+Verdict: **approve** (nur Info-Notizen).
+
+- F1 (info): part-Mapping button→'submit' greift nur bei namenlosen Buttons;
+  keine Kollision mit den benannten Feld-/Summary-Pfaden.
+- F2 (info): `button[type="submit"]` ist ein Attribut-Selektor; das Produkt-
+  Markup trägt explizites `type="submit"` (Test grün) — Zukunftsfallstrich
+  bei ungetypten Buttons, keine Aktion jetzt.
+- F3 (info): bei mehreren Submit-Buttons je Task würde der erste fokussiert;
+  aktuell genau einer je Formular.
+- F4 (low): Test-Soundness bestätigt; Rot-Behauptung gegen den Pre-Fix-Stand
+  glaubhaft (part='button' matchte nichts, activeElement fiele auf body).
+- F5 (info): F1-Assertion vor dem keydown-Dispatch macht die Abhängigkeit vom
+  Shortcut-Default explizit.
+
+`VERDICT: approve`
diff --git a/.pa/review_w2-10b_disposition.md b/.pa/review_w2-10b_disposition.md
new file mode 100644
index 0000000..da05824
--- /dev/null
+++ b/.pa/review_w2-10b_disposition.md
@@ -0,0 +1,32 @@
+# Review-Disposition W2-10b
+
+Autor: Kimi K3. Kandidat: `34532aa` (Branch `claude/w2-10b`, stapelt auf
+`claude/w2-10a`). Diff-Umfang +359/−23 (> 300 Zeilen) → zwei Reviews anderer
+Anbieter erforderlich (AGENTS.md).
+
+Reviewer:
+
+1. **GLM 5.2** (`glm-5.2:cloud`, Ollama Cloud) — Urteil: freigeben mit
+   Auflagen (1 Low-Befund). Protokoll: `.pa/review_w2-10b_glm-5.2.md`.
+2. **Qwen 2.5 Coder 14B** (`qwen2.5-coder:14b`, lokal via Ollama) — Urteil:
+   freigeben mit Auflagen (5 Befunde, inhaltlich identisch). Protokoll:
+   `.pa/review_w2-10b_qwen2.5-coder.md`.
+
+Ersatzweg (Prozess-Transparenz): Das Advisor-Paar war nicht verfügbar —
+Fable 5.1 (Claude-Subagent) scheiterte mit 402 „Insufficient account funds",
+GPT-6 Astra (Codex CLI) mit „usage limit" bis 30.09.2026,
+deepseek-v4-flash:cloud ist aus Ollama Cloud entfernt (HTTP 410). Zweites
+Review daher durch qwen2.5-coder:14b — anderer Anbieter (Alibaba), nicht die
+Autorenfamilie, auf dieser Maschine bereits früher als Reviewer eingesetzt
+(u. a. Paket b-s2). Kein Geld ausgegeben.
+
+## Befunde und Disposition
+
+| ID | Quelle | Schwere | Befund | Disposition |
+|---|---|---|---|---|
+| F1 | GLM 5.2 | low | `USAGE_STATE_LABELS` fehlen `exceeded`/`exhausted`; rohes Englisch + Redundanz zu den Flags | **abgelehnt mit Grund**: Prämisse falsch. `usage_state` ist in `src-tauri/src/store/development_budget.rs:124-133` eine geschlossene Menge (`no_allowance`, `no_receipts`, `partial`, `measured`) — alle vier haben deutsche Labels. `exceeded`/`exhausted` sind separate Booleans (development_budget.rs:84-85) und werden bereits als „· Überschritten"/„· erschöpft" gerendert. Labels für nie auftretende Werte wären toter Code; der Fallback auf den rohen Zustandsstring ist für unbekannte künftige Zustände der ehrlichere Pfad. Die Mehrdeutigkeit kam aus der Prompt-Aufzählung („usageState ∈ {…}, exceeded, exhausted" als Feldliste gelesen). |
+| F1–F5 | Qwen 2.5 Coder | medium/low | „Race-Bedingung" zwischen `renderBudget` und Signatur-Gating (5× wortgleich) | **abgelehnt mit Grund**: kein Mechanismus. Signaturberechnung, Vergleich, `renderBudget`-Aufruf und Signatur-Speicherung laufen synchron in einem Block (continuous.js:241-251) ohne `await`; JS ist single-threaded, Interleaving ist ausgeschlossen. Veraltete async-Abschlüsse fängt der Generation-Guard aus W2-10a (`generation !== sequence` → early return direkt nach dem `Promise.all`) ab, und der Test „unchanged refresh leaves the budget DOM alone; changed balances rebuild it" belegt beide Pfade mit DOM-Referenzgleichheit. |
+| Auflage 3 | Qwen 2.5 Coder | — | „prüfen, ob alle erforderlichen Tests implementiert sind" | **erledigt ohne Codeänderung**: die Red-first-Suite (7 Tests) deckt Budget-Summary, exceeded/exhausted, Fallbacks, Routing-Übersicht, Usage-Provenienz, Signatur-Gating und den `b`-Shortcut ab; Browser-Test liefert die beiden Screenshot-Belege. |
+
+Kein Befund angenommen → **keine Nacharbeit am Kandidaten**, kein
+Delta-Review nötig (Kandidat unverändert `34532aa`; Evidenz bleibt gebunden).
diff --git a/.pa/review_w2-10b_glm-5.2.md b/.pa/review_w2-10b_glm-5.2.md
new file mode 100644
index 0000000..f522c53
--- /dev/null
+++ b/.pa/review_w2-10b_glm-5.2.md
@@ -0,0 +1,45 @@
+# Review: w2-10b — glm-5.2
+
+- Autor des Artefakts: Kimi K3
+- Reviewer: glm-5.2 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `glm-5.2:cloud`, bedient `glm-5.2`
+- Datum: 2026-09-25 16:39 UTC, Dauer 68 s, Status: ok
+- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
+- Prompt: `review_prompt_w2-10b.md` (30699 Zeichen)
+
+## Roh-Urteil des Reviewers
+
+## Review: W2-10b — Live-HQ-View Routing/Budget
+
+### Befunde
+
+**F1 — low — `docs/dev-hq/continuous.js:84-88`**
+
+`USAGE_STATE_LABELS` enthält nur `measured`, `partial`, `no_receipts`, `no_allowance`. Laut Kontext ist `usageState ∈ {no_allowance, no_receipts, partial, measured, exceeded, exhausted}`. Treten `exceeded` oder `exhausted` als `usageState` auf, greift der Fallback `tokens.usageState || 'unbekannt'` und zeigt den rohen englischen String an — z. B. „Status exceeded · Überschritten". Das ist erstens eine Sprachmischung (englisch/deutsch) und zweitens redundant, da die booleschen Flags `exceeded`/`exhausted` ohnehin separat als „Überschritten"/„erschöpft" angehängt werden. Die fehlenden Labels sollten ergänzt werden (z. B. `exceeded: 'überschritten'`, `exhausted: 'erschöpft'`), damit der Status-Text konsistent auf Deutsch erscheint.
+
+---
+
+### Weitere Prüfungen (ohne Befund)
+
+**Signatur-Gating:** Die Budget-Signatur wird via `JSON.stringify` über `policies` und die auf `id/route/usage` reduzierten Runs gebildet. Bei unveränderten Daten wird `renderBudget` nicht aufgerufen — DOM bleibt stabil. Bei veränderten Daten wird die Sektion sauber neu gebaut (`replaceChildren()` + `text()`). Der Test „unchanged refresh leaves the budget DOM alone; changed balances rebuild it" bestätigt beide Pfade mit Referenzgleichheit der DOM-Knoten. Korrekt.
+
+**exceeded/exhausted/unresolvedOperations:** Die booleschen Flags werden über `alarm` (entfernt `muted`-Klasse → Hervorhebung) und explizite Text-Flags „· Überschritten"/„· erschöpft" sichtbar dargestellt. `unresolvedOperations > 0` erzeugt einen Hinweis, dass die Reservierung vollständig bestehen bleibt. Die Fallbacks für fehlende Policies/Tokens verwenden „nicht verfügbar"/„unbekannt" und nehmen keine Kosten oder Modelle an. Ehrlich.
+
+**Race-Bedingungen:** Beim Projektwechsel wird `lastBudgetSignature = null` zurückgesetzt und `budgetList.replaceChildren()` geleert. Der `generation`/`sequence`-Wächter aus W2-10a verhindert veraltete Renders. Keine Race erkennbar.
+
+**Inerte Darstellung:** Alle Laufzeitdaten werden über `text()` (textContent) gesetzt. Kein `innerHTML` mit dynamischen Inhalten. Der Test prüft explizit `budget.querySelector('img') === null`.
+
+**Keine Funktionsduplikation:** Die Budget-View zeigt ausschließlich `rootPolicies` (Tokenbudget je Root-Goal) und Routing-/Kostenbelege aus Runs. Provider-Quota bleibt in der App. Regel eingehalten.
+
+**Shortcut `b`:** Folgt dem gleichen Muster wie `g` (reveal + focus). Hilfe-Text aktualisiert. Test prüft Reveal + Focus + Hilfe-Eintrag. Konsistent mit dem bestehenden Design (opt-out via `live-keys-enabled`).
+
+**Testabdeckung:** Rot-erst-Reihenfolge eingehalten (Commit ea411d5 vor 0a73728). Tests decken alle Flows ab: Budget-Summary, Flags, Fallbacks, Routing, Provenance, Signatur-Gating, Shortcut. Visual-Test erzeugt beide geforderten Screenshot-Belege (`budget-routing-live.png`, `budget-routing-keyboard-b.png`).
+
+**Keine Secrets/Kosten im Diff:** Nichts gefunden.
+
+---
+
+### Gesamturteil
+
+**freigeben mit Auflagen**
+
+Der einzige Befund (F1) ist kosmetischer Natur — fehlende deutsche Labels für `exceeded`/`exhausted` als `usageState`. Die Information ist nicht verloren (die booleschen Flags werden separat angezeigt), aber die Sprachmischung und Redundanz sollten vor Merge korrigiert werden. Alle funktionalen Aspekte — Signatur-Gating, ehrliche Fallbacks, inerte Darstellung, Race-Safety, Testabdeckung, Screenshot/Keyboard-Belege — sind korrekt umgesetzt.
diff --git a/.pa/review_w2-10b_qwen2.5-coder.md b/.pa/review_w2-10b_qwen2.5-coder.md
new file mode 100644
index 0000000..b9f375c
--- /dev/null
+++ b/.pa/review_w2-10b_qwen2.5-coder.md
@@ -0,0 +1,46 @@
+# Review: w2-10b — qwen2.5-coder
+
+- Autor des Artefakts: Kimi K3
+- Reviewer: qwen2.5-coder (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `qwen2.5-coder:14b`, bedient `qwen2.5-coder:14b`
+- Datum: 2026-09-25 16:43 UTC, Dauer 474 s, Status: ok
+- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
+- Prompt: `review_prompt_w2-10b.md` (30699 Zeichen)
+
+## Roh-Urteil des Reviewers
+
+**Befund 1:**  
+ID: F1  
+Schwere: Medium  
+Datei: `docs/dev-hq/continuous.js:238`  
+Begründung: Die Signatur-Gating Logik wurde nicht berührt, aber es fehlt eine Überprüfung, ob `renderBudget` korrekt mit der Signatur-Gating-Logik interagiert. Es könnte eine Race-Bedingung geben, wenn `renderBudget` parallel zu einem Tick ausgeführt wird.
+
+**Befund 2:**  
+ID: F2  
+Schwere: Medium  
+Datei: `docs/dev-hq/continuous.js:182`  
+Begründung: Der Vergleich von `budgetSignature` mit `lastBudgetSignature` könnte zu einer Race-Bedingung führen, wenn `renderBudget` parallel zu einem Tick ausgeführt wird. Es sollte sichergestellt werden, dass die Signatur-Gating-Logik und der `renderBudget`-Aufruf synchronisiert sind.
+
+**Befund 3:**  
+ID: F3  
+Schwere: Medium  
+Datei: `docs/dev-hq/continuous.js:182`  
+Begründung: Es fehlt eine Überprüfung, ob `renderBudget` korrekt mit der Signatur-Gating-Logik interagiert. Es könnte eine Race-Bedingung geben, wenn `renderBudget` parallel zu einem Tick ausgeführt wird.
+
+**Befund 4:**  
+ID: F4  
+Schwere: Low  
+Datei: `docs/dev-hq/continuous.js:238`  
+Begründung: Es fehlt eine Überprüfung, ob `renderBudget` korrekt mit der Signatur-Gating-Logik interagiert. Es könnte eine Race-Bedingung geben, wenn `renderBudget` parallel zu einem Tick ausgeführt wird.
+
+**Befund 5:**  
+ID: F5  
+Schwere: Low  
+Datei: `docs/dev-hq/continuous.js:238`  
+Begründung: Es fehlt eine Überprüfung, ob `renderBudget` korrekt mit der Signatur-Gating-Logik interagiert. Es könnte eine Race-Bedingung geben, wenn `renderBudget` parallel zu einem Tick ausgeführt wird.
+
+**Gesamturteil:** **freigeben mit Auflagen**
+
+**Auflagen:**
+1. Überprüfen Sie die Interaktion zwischen `renderBudget` und der Signatur-Gating-Logik, um Race-Bedingungen zu vermeiden.
+2. Stellen Sie sicher, dass die Signatur-Gating-Logik und der `renderBudget`-Aufruf synchronisiert sind.
+3. Überprüfen Sie, ob alle erforderlichen Tests implementiert sind, um potenzielle Defekte zu entdecken.
diff --git a/docs/dev-hq/continuous.js b/docs/dev-hq/continuous.js
index 632a4d5..ad7d12b 100644
--- a/docs/dev-hq/continuous.js
+++ b/docs/dev-hq/continuous.js
@@ -3,12 +3,15 @@
   window.createHQContinuous = function ({ container, api, project }) {
     const card = document.createElement('section');
     card.className = 'live-card continuous-card';
+    card.id = 'hq-goals-live';
+    card.tabIndex = -1;
     card.innerHTML = `
       <h2>Ziele & kontinuierliche Entwicklung</h2>
       <p data-state role="status" aria-live="polite">Projekt auswählen.</p>
       <p data-runtime role="status" aria-live="polite" class="muted">Runtime-Identität wird geprüft.</p>
       <p data-source class="muted"></p>
-      <section data-budget><h2>Budget & Routing</h2></section>
+      <div data-ownership class="continuous-ownership" aria-label="Besetzung laufender Ziele"></div>
+      <section data-budget id="hq-budget-live" tabindex="-1" aria-label="Budget und Routing"></section>
       <p class="muted">Diese Steuerung betrifft die HQ-Planung. Bestehende Worker und der bisherige Dispatcher laufen unabhängig weiter. Automatisches Starten und Ausliefern sind noch nicht freigegeben.</p>
       <div class="continuous-actions">
         <button type="button" data-action="pause">Aufnahme pausieren</button>
@@ -44,6 +47,7 @@
     const budgetList = card.querySelector('[data-budget]');
     const errorBox = card.querySelector('[data-error]');
     const list = card.querySelector('[data-goals]');
+    const ownership = card.querySelector('[data-ownership]');
     const runsList = card.querySelector('[data-runs]');
     const select = card.querySelector('[name=goalId]');
     let sequence = 0;
@@ -51,6 +55,8 @@
     let online = false;
     let busy = false;
     let teams = [];
+    let lastSignature = null;
+    let lastBudgetSignature = null;
     function error(value) { errorBox.hidden = !value; errorBox.textContent = value?.message || ''; }
     function enable(available) {
       card.querySelectorAll('button').forEach(button => { button.disabled = !available || busy || button.dataset.locked === 'true'; });
@@ -75,11 +81,129 @@
         return 'Routingbeleg unlesbar; kein Modell oder Preis wird angenommen.';
       }
     }
+    const USAGE_STATE_LABELS = {
+      measured: 'gemessen',
+      partial: 'teilweise belegt',
+      no_receipts: 'keine Belege erfasst',
+      no_allowance: 'kein Budget eingeräumt',
+    };
+    function renderBudget(policies, records) {
+      budgetList.replaceChildren();
+      text(budgetList, 'h2', 'Budget & Routing');
+      if (!policies.length) {
+        text(budgetList, 'p', 'Budget- und Routingstatus nicht verfügbar; keine Kosten- oder Modellfähigkeit wird angenommen.', 'muted');
+        return;
+      }
+      for (const item of policies) {
+        const tokens = item.tokens;
+        const article = document.createElement('article'); article.className = 'continuous-budget'; budgetList.append(article);
+        text(article, 'h3', `Root ${item.rootGoalId || 'unbekannt'}`);
+        if (!tokens) {
+          text(article, 'p', 'Tokenbudget nicht verfügbar; keine Nutzung wird angenommen.', 'muted');
+        } else {
+          const allowance = tokens.allowance?.maxPerGoal;
+          const limit = Number.isFinite(allowance) ? allowance : 'unbekannt';
+          text(article, 'p', `Limit ${limit} · gemessen ${tokens.measuredTokens ?? 'unbekannt'} · reserviert ${tokens.reservedTokens ?? 'unbekannt'}`);
+          const alarm = tokens.exceeded === true || tokens.exhausted === true;
+          const flags = `${tokens.exceeded === true ? ' · Überschritten' : ''}${tokens.exhausted === true ? ' · erschöpft' : ''}`;
+          text(article, 'p', `Verfügbar ${tokens.availableTokens ?? 'unbekannt'} · Umsetzung ${tokens.implementationAvailable ?? 'unbekannt'} · Prüfungsschutz ${tokens.verificationRemaining ?? 'unbekannt'} · Status ${USAGE_STATE_LABELS[tokens.usageState] || tokens.usageState || 'unbekannt'}${flags}`, alarm ? undefined : 'muted');
+          if (tokens.unresolvedOperations > 0) text(article, 'p', `${tokens.unresolvedOperations} offener Vorgang${tokens.unresolvedOperations === 1 ? '' : 'e'} ohne Beleg; die Reservierung bleibt vollständig bestehen.`, 'muted');
+        }
+      }
+      const routingRegion = document.createElement('div');
+      routingRegion.dataset.routing = '';
+      budgetList.append(routingRegion);
+      text(routingRegion, 'h3', 'Routing- & Kostenbelege');
+      for (const item of policies) {
+        const routing = item.policy?.routing;
+        if (!routing) continue;
+        const billing = Array.isArray(routing.billing) && routing.billing.length ? routing.billing.join(', ') : 'keine';
+        text(routingRegion, 'p', `Root ${item.rootGoalId || 'unbekannt'} erlaubt: ${billing} · Quota-Reserve ${routing.quotaReservePercent ?? 'unbekannt'} % · Zusätzliche kostenpflichtige API: ${routing.additionalPaidApi ? 'ja' : 'nein'}`, 'muted');
+      }
+      const runs = Array.isArray(records?.runs) ? records.runs : [];
+      if (!records || !runs.length) {
+        text(routingRegion, 'p', 'Keine Routing-Belege vorhanden; kein Modell oder Preis wird angenommen.', 'muted');
+        return;
+      }
+      for (const record of runs) {
+        const runId = record.run?.id || 'unbekannt';
+        text(routingRegion, 'p', `${runId}: ${routingSummary(record.launch)}`);
+        const usage = record.usage;
+        if (usage?.state === 'measured') {
+          text(routingRegion, 'p', `${runId}: Kostenbeleg ${usage.tokens ?? 'unbekannt'} Token · ${usage.provenance?.collector || 'Collector unbekannt'} (${usage.provenance?.measurement || 'Messung unbekannt'})`, 'muted');
+        } else if (usage) {
+          text(routingRegion, 'p', `${runId}: kein Kostenbeleg (${usage.state || 'unbekannt'})${usage.reason ? ` — ${usage.reason}` : ''}; die Reservierung bleibt bestehen.`, 'muted');
+        }
+      }
+    }
+    function renderOwnership(goals, tasks) {
+      ownership.replaceChildren();
+      const closed = new Set(['closed', 'completed', 'done', 'cancelled']);
+      const running = goals.filter(goal => !closed.has(String(goal.status || '').toLowerCase()));
+      if (!running.length) { text(ownership, 'p', 'Keine laufenden Ziele.', 'muted'); return; }
+      for (const goal of running) {
+        const ownTasks = tasks.filter(task => task.goalId === goal.id);
+        const owners = [...new Set(ownTasks.map(task => task.claim?.owner || task.assignment?.assignee).filter(Boolean))];
+        const seats = [...new Set(ownTasks.map(task => task.assignment ? `${task.assignment.teamId}/${task.assignment.role}` : null).filter(Boolean))];
+        const paths = [...new Set(ownTasks.flatMap(task => task.ownedPaths || []))];
+        const line = document.createElement('p');
+        line.className = 'continuous-ownership-line';
+        line.textContent = `${goal.status || 'unbekannt'} · ${goal.objective} · ${ownTasks.length} Arbeitspakete`
+          + ` · ${owners.length ? `Besetzt: ${owners.join(', ')}` : 'unbesetzt'}`
+          + `${seats.length ? ` · ${seats.join(', ')}` : ''}`
+          + `${paths.length ? ` · Bereiche: ${paths.join(', ')}` : ''}`;
+        ownership.append(line);
+      }
+    }
+    // The 5 s tick must not throw the operator out of the card: capture the
+    // interactive state before a rebuild, hand it back afterwards.
+    function captureListState() {
+      const openTasks = new Set([...list.querySelectorAll('details[data-task-id][open]')].map(node => node.dataset.taskId));
+      const drafts = new Map();
+      for (const form of list.querySelectorAll('form.continuous-assignment')) {
+        const draft = {};
+        const assignee = form.elements.assignee;
+        if (assignee && assignee.value !== assignee.defaultValue) draft.assignee = assignee.value;
+        for (const name of ['teamId', 'role']) {
+          const field = form.elements[name];
+          if (field && [...field.options].some(option => option.selected !== option.defaultSelected)) draft[name] = field.value;
+        }
+        if (Object.keys(draft).length) drafts.set(form.dataset.taskId, draft);
+      }
+      const active = document.activeElement;
+      let focus = null;
+      if (active && list.contains(active)) {
+        const host = active.closest('details[data-task-id]');
+        const part = active.name || (active.tagName === 'BUTTON' ? 'submit' : active.tagName.toLowerCase());
+        focus = { taskId: host?.dataset.taskId || null, part };
+      }
+      return { openTasks, drafts, focus };
+    }
+    function restoreListState(saved) {
+      for (const node of list.querySelectorAll('details[data-task-id]')) {
+        if (saved.openTasks.has(node.dataset.taskId)) node.open = true;
+      }
+      for (const form of list.querySelectorAll('form.continuous-assignment')) {
+        const draft = saved.drafts.get(form.dataset.taskId);
+        if (!draft) continue;
+        for (const [name, value] of Object.entries(draft)) {
+          const field = form.elements[name];
+          if (field) field.value = value;
+        }
+      }
+      if (saved.focus?.taskId) {
+        const host = list.querySelector(`details[data-task-id="${saved.focus.taskId}"]`);
+        const target = host?.querySelector(`[name="${saved.focus.part}"]`)
+          || (saved.focus.part === 'summary' ? host?.querySelector('summary') : null)
+          || (saved.focus.part === 'submit' ? host?.querySelector('button[type="submit"]') : null);
+        target?.focus();
+      }
+    }
     async function refresh() {
       const current = project();
       const generation = ++sequence;
       online = false; enable(false);
-      if (current !== loadedProject) { list.replaceChildren(); select.replaceChildren(); loadedProject = null; }
+      if (current !== loadedProject) { list.replaceChildren(); select.replaceChildren(); ownership.replaceChildren(); budgetList.replaceChildren(); loadedProject = null; lastSignature = null; lastBudgetSignature = null; }
       if (!current) { state.textContent = 'Projekt auswählen, um Ziele und Arbeitspakete zu sehen.'; source.textContent = ''; enable(false); return; }
       try {
         const [value, runtimeValue, records] = await Promise.all([
@@ -105,32 +229,29 @@
         state.textContent = `Zustand: ${control.status || 'unbekannt'} · ${goals.length} Ziele · ${tasks.length} Arbeitspakete`;
         source.textContent = `Quelle: Rust/SQLite · ${snapshot.sourceTimestamp || value.observedAt || 'Zeitpunkt unbekannt'} · Cursor ${value.cursor ?? 'unbekannt'}. ${snapshot.commit ? `Commit ${snapshot.commit}` : 'Commit nicht gemessen.'}`;
         error(null);
+        const signature = JSON.stringify({ goals, tasks, teams, controlStatus: control.status || null });
+        const rebuildGoals = signature !== lastSignature;
+        const saved = rebuildGoals ? captureListState() : null;
         const previous = select.value;
-        select.replaceChildren();
-        list.replaceChildren();
-        budgetList.replaceChildren();
-        text(budgetList, 'h2', 'Budget & Routing');
+        if (rebuildGoals) {
+          select.replaceChildren();
+          list.replaceChildren();
+          renderOwnership(goals, tasks);
+        }
         const policies = Array.isArray(effectiveLimits.rootPolicies) ? effectiveLimits.rootPolicies : [];
-        if (!policies.length) {
-          text(budgetList, 'p', 'Budget- und Routingstatus nicht verfügbar; keine Kosten- oder Modellfähigkeit wird angenommen.', 'muted');
-        } else {
-          for (const item of policies) {
-            const tokens = item.tokens;
-            const article = document.createElement('article'); article.className = 'continuous-budget'; budgetList.append(article);
-            text(article, 'h3', `Root ${item.rootGoalId || 'unbekannt'}`);
-            if (!tokens) {
-              text(article, 'p', 'Tokenbudget nicht verfügbar; keine Nutzung wird angenommen.', 'muted');
-              continue;
-            }
-            const allowance = tokens.allowance?.maxPerGoal;
-            const limit = Number.isFinite(allowance) ? allowance : 'unbekannt';
-            text(article, 'p', `Limit ${limit} · gemessen ${tokens.measuredTokens ?? 'unbekannt'} · reserviert ${tokens.reservedTokens ?? 'unbekannt'}`);
-            text(article, 'p', `Verfügbar ${tokens.availableTokens ?? 'unbekannt'} · Prüfungsschutz ${tokens.verificationRemaining ?? 'unbekannt'} · Status ${tokens.usageState || 'unbekannt'}`, 'muted');
-          }
+        const budgetSignature = JSON.stringify({
+          policies,
+          receipts: (Array.isArray(records?.runs) ? records.runs : []).map(record => ({
+            id: record.run?.id, route: record.launch?.routeJson || null, usage: record.usage || null,
+          })),
+        });
+        if (budgetSignature !== lastBudgetSignature) {
+          renderBudget(policies, records);
+          lastBudgetSignature = budgetSignature;
         }
         runsList.replaceChildren();
         text(runsList, 'h2', 'Runs, Evidenz & Lieferung');
-        for (const goal of goals) {
+        if (rebuildGoals) for (const goal of goals) {
           const option = document.createElement('option'); option.value = goal.id; option.textContent = goal.objective; select.append(option);
           const section = document.createElement('article'); section.className = 'continuous-goal'; list.append(section);
           text(section, 'h3', goal.objective);
@@ -140,6 +261,7 @@
           if (!ownTasks.length) text(section, 'p', 'Noch keine Arbeitspakete.', 'muted');
           for (const task of ownTasks) {
             const details = document.createElement('details'); section.append(details);
+            details.dataset.taskId = task.id;
             text(details, 'summary', `${task.status} · ${task.objective}`);
             text(details, 'p', `ID ${task.id} · Profil ${task.profileId || 'nicht zugewiesen'} · Versuche ${task.attempts ?? 0}`);
             text(details, 'p', `Bereiche: ${(task.ownedPaths || []).join(', ') || 'keine'} · Abhängigkeiten: ${(task.dependencies || []).join(', ') || 'keine'}`);
@@ -147,6 +269,7 @@
             if (task.assignment) text(details, 'p', `Team ${task.assignment.teamId} · Rolle ${task.assignment.role} · ${task.assignment.assignee} · Revision ${task.assignment.revision}`, 'muted');
             const assignmentForm = document.createElement('form');
             assignmentForm.className = 'continuous-assignment';
+            assignmentForm.dataset.taskId = task.id;
             const teamLabel = document.createElement('label'); teamLabel.textContent = 'Team';
             const teamSelect = document.createElement('select'); teamSelect.name = 'teamId'; teamSelect.required = true;
             const roleLabel = document.createElement('label'); roleLabel.textContent = 'Rolle';
@@ -183,8 +306,12 @@
             if (task.detail || task.checkpoint) text(details, 'pre', task.detail || task.checkpoint);
           }
         }
-        if ([...select.options].some(option => option.value === previous)) select.value = previous;
-        if (!goals.length) text(list, 'p', 'Noch keine Ziele. Ein Ziel beschreibt Ergebnis und überprüfbare Abnahme.', 'muted');
+        if (rebuildGoals) {
+          if ([...select.options].some(option => option.value === previous)) select.value = previous;
+          if (!goals.length) text(list, 'p', 'Noch keine Ziele. Ein Ziel beschreibt Ergebnis und überprüfbare Abnahme.', 'muted');
+          restoreListState(saved);
+          lastSignature = signature;
+        }
         if (!records) {
           text(runsList, 'p', 'Run- und Lieferstatus nicht verfügbar; keine Evidenz wird angenommen.', 'muted');
         } else if (!Array.isArray(records.runs) || !records.runs.length) {
diff --git a/docs/dev-hq/hq.js b/docs/dev-hq/hq.js
index 3548323..c4b9fd6 100644
--- a/docs/dev-hq/hq.js
+++ b/docs/dev-hq/hq.js
@@ -270,7 +270,7 @@
         </div>
       </div>
       <div id="live-error" class="live-error" role="alert" hidden></div>
-      <div id="live-keys-help" class="keys-help" lang="en" hidden><b>Keys</b> <kbd>/</kbd> search memory · <kbd>f</kbd> filter fleet · <kbd>r</kbd> refresh · <kbd>?</kbd> this help · <kbd>Esc</kbd> close panels <label class="keys-toggle"><input type="checkbox" id="live-keys-enabled"> single-key shortcuts on</label></div>
+      <div id="live-keys-help" class="keys-help" lang="en" hidden><b>Keys</b> <kbd>/</kbd> search memory · <kbd>f</kbd> filter fleet · <kbd>g</kbd> goals &amp; teams · <kbd>b</kbd> budget &amp; routing · <kbd>r</kbd> refresh · <kbd>?</kbd> this help · <kbd>Esc</kbd> close panels <label class="keys-toggle"><input type="checkbox" id="live-keys-enabled"> single-key shortcuts on</label></div>
 
       ${section("01", "What matters now", "Ranked from the live fleet, capacity, questions, the lesson memory and the repository.", '<ol id="live-signals" class="signals" tabindex="0" aria-label="What matters now"><li class="muted">Reading the desk…</li></ol>', "live-signals-section", "paper")}
 
@@ -1029,6 +1029,8 @@
       if (typing || event.metaKey || event.ctrlKey || event.altKey || !keysToggle.checked) return;
       if (event.key === "/") { event.preventDefault(); workspace.reveal("#lesson-query"); el.querySelector("#lesson-query").focus(); }
       else if (event.key === "f") { event.preventDefault(); workspace.reveal("#live-fleet-filter"); el.querySelector("#live-fleet-filter").focus(); }
+      else if (event.key === "g") { event.preventDefault(); const goalsCard = el.querySelector("#hq-goals-live"); if (goalsCard) { workspace.reveal(goalsCard); goalsCard.focus(); } }
+      else if (event.key === "b") { event.preventDefault(); const budgetSection = el.querySelector("#hq-budget-live"); if (budgetSection) { workspace.reveal(budgetSection); budgetSection.focus(); } }
       else if (event.key === "r") { event.preventDefault(); refresh(); }
       else if (event.key === "?") { event.preventDefault(); keysHelp.hidden = !keysHelp.hidden; }
     });
diff --git a/scripts/hq-live.mjs b/scripts/hq-live.mjs
index b930949..85537da 100644
--- a/scripts/hq-live.mjs
+++ b/scripts/hq-live.mjs
@@ -289,7 +289,7 @@ function repositoryInsights() {
   if (Date.now() - insightsCache.at < 60000 && insightsCache.value) return insightsCache.value;
   const timestamps = tryGit(["log", "--format=%at"]).split(/\r?\n/).filter(Boolean).map(Number);
   const git = workSessions(timestamps);
-  const activityPath = join(root, ".pa", "ACTIVITY.md");
+  const activityPath = process.env.HQ_ACTIVITY_FILE || join(root, ".pa", "ACTIVITY.md");
   const activity = existsSync(activityPath) ? activitySessions(readFileSync(activityPath, "utf8")) : [];
   const volume = diffVolume(tryGit(["log", "--numstat", "--format="]));
   insightsCache = { at: Date.now(), value: { timestamps, git, activity, volume, heat: heatmap(timestamps) } };
diff --git a/scripts/lib/hq-budget-live.test.mjs b/scripts/lib/hq-budget-live.test.mjs
new file mode 100644
index 0000000..a7ab416
--- /dev/null
+++ b/scripts/lib/hq-budget-live.test.mjs
@@ -0,0 +1,246 @@
+// scripts/lib/hq-budget-live.test.mjs — W2-10b: the budget/routing section of
+// the continuous card must be a real live view: a compact token-budget
+// summary per root goal, policy routing and aggregated routing/usage receipts
+// with provenance, a 5 s refresh that leaves the DOM alone while data is
+// unchanged, and a keyboard shortcut that jumps to the section. Honest
+// fallbacks only: nothing assumes a cost, model or balance that was not
+// observed.
+import test from 'node:test';
+import assert from 'node:assert/strict';
+import { readFileSync } from 'node:fs';
+import { JSDOM } from 'jsdom';
+
+const source = (path) => readFileSync(path, 'utf8');
+
+const ROUTE_RECEIPT = JSON.stringify({
+  selection: { resolved: { provider: 'kimi', profileId: 'kimi', resolvedModel: { value: 'kimi-k3' }, effort: { value: 'high' } } },
+  executionObservation: { reason: 'exit 0 observed' },
+});
+
+const CONTEXT = {
+  cursor: 7,
+  snapshot: {
+    sourceTimestamp: '2026-09-25T10:00:00Z',
+    commit: 'abc1234',
+    control: { status: 'paused' },
+    goals: [
+      { id: 'goal-1', projectId: 'p1', objective: 'Ship live budget view', acceptanceCriteria: 'Tests pass', status: 'open' },
+    ],
+    tasks: [
+      {
+        id: 'task-1', goalId: 'goal-1', objective: 'Render the budget', profileId: 'kimi',
+        status: 'running', attempts: 1, ownedPaths: ['docs/dev-hq/continuous.js'], dependencies: [],
+        claim: { owner: 'worker-1', fence: 3 },
+        assignment: { teamId: 'development', role: 'implementer', assignee: 'worker-1', revision: 2 },
+      },
+    ],
+    effectiveLimits: {
+      rootPolicies: [{
+        rootGoalId: 'root-1',
+        source: 'projecta.dev.json',
+        observedAt: 1758000000,
+        policy: {
+          teams: [{ id: 'development', roles: ['implementer', 'reviewer'] }],
+          routing: { additionalPaidApi: false, quotaReservePercent: 20, billing: ['subscription', 'free', 'local'] },
+          providers: ['claude', 'kimi'],
+        },
+        tokens: {
+          allowance: { maxPerGoal: 200000, verificationReserve: 40000 },
+          measuredTokens: 45000,
+          reservedTokens: 10000,
+          verificationRemaining: 40000,
+          availableTokens: 145000,
+          implementationAvailable: 105000,
+          unresolvedOperations: 1,
+          usageState: 'partial',
+          exceeded: false,
+          exhausted: false,
+        },
+      }],
+    },
+  },
+};
+
+const RUNS = {
+  executionEnabled: false,
+  approvalAuthority: { state: 'unavailable' },
+  runs: [{
+    run: { id: 'run-1', taskId: 'task-1', status: 'completed', claimOwner: 'worker-1', claimFence: 3 },
+    candidate: { candidateCommit: 'def5678', source: 'worker-push' },
+    launch: { routeJson: ROUTE_RECEIPT },
+    evidence: [],
+    reviews: [],
+    tokens: { availableTokens: 145000, usageState: 'partial' },
+    usage: {
+      state: 'measured', tokens: 43210, reservation: 'settled',
+      provenance: { collector: 'codex-exec-json-v1', measurement: 'live', source: 'process-owned stdout', sourceSha256: 'deadbeef', observedAt: 1758000100 },
+    },
+  }, {
+    run: { id: 'run-2', taskId: 'task-1', status: 'failed', claimOwner: 'worker-2', claimFence: 1 },
+    candidate: null,
+    launch: { routeJson: '{broken json' },
+    evidence: [],
+    reviews: [],
+    tokens: null,
+    usage: { state: 'not_reported', reason: 'no trusted collector for provider kimi over transport headless_cli', reservation: 'retained', provenance: { collector: null, measurement: 'none', provider: 'kimi', transport: 'headless_cli' } },
+  }],
+};
+
+function apiFor({ context = CONTEXT, runs = RUNS } = {}) {
+  return async (path) => {
+    if (path.startsWith('/api/hq/v1/context')) return context;
+    if (path.startsWith('/api/hq/v1/runs')) return runs;
+    if (path.startsWith('/api/hq/v1/runtime')) return { apiVersion: 1 };
+    throw new Error(`unexpected api path ${path}`);
+  };
+}
+
+function continuousFixture(api) {
+  const dom = new JSDOM('<main></main>', { runScripts: 'outside-only' });
+  dom.window.eval(source('docs/dev-hq/continuous.js'));
+  const controller = dom.window.createHQContinuous({
+    container: dom.window.document.querySelector('main'),
+    api,
+    project: () => 'p1',
+  });
+  return { dom, controller, document: dom.window.document, window: dom.window };
+}
+
+test('budget summary shows limit, measured, reserved, available and verification guard per root policy', async (t) => {
+  const f = continuousFixture(apiFor());
+  t.after(() => f.dom.window.close());
+  await f.controller.refresh();
+  const budget = f.document.querySelector('[data-budget]');
+  assert.ok(budget, 'continuous card exposes a [data-budget] section');
+  const text = budget.textContent;
+  assert.match(text, /root-1/, 'root goal id is visible');
+  assert.match(text, /200000/, 'allowance limit is visible');
+  assert.match(text, /45000/, 'measured tokens are visible');
+  assert.match(text, /10000/, 'reserved tokens are visible');
+  assert.match(text, /145000/, 'available tokens are visible');
+  assert.match(text, /105000/, 'implementation-available tokens are visible');
+  assert.match(text, /40000/, 'verification guard is visible');
+  assert.match(text, /teilweise belegt/, 'usage state is rendered as an honest label');
+  assert.match(text, /1 offener Vorgang|1 offene/, 'unresolved operations are named');
+  assert.equal(budget.querySelector('img'), null, 'budget text is inert');
+});
+
+test('budget flags exceeded and exhausted balances instead of hiding them', async (t) => {
+  const blown = JSON.parse(JSON.stringify(CONTEXT));
+  blown.snapshot.effectiveLimits.rootPolicies[0].tokens = {
+    ...blown.snapshot.effectiveLimits.rootPolicies[0].tokens,
+    measuredTokens: 250000, availableTokens: 0, implementationAvailable: 0,
+    usageState: 'measured', exceeded: true, exhausted: true,
+  };
+  const f = continuousFixture(apiFor({ context: blown }));
+  t.after(() => f.dom.window.close());
+  await f.controller.refresh();
+  const text = f.document.querySelector('[data-budget]').textContent;
+  assert.match(text, /[Üü]berschritten/, 'exceeded balance is flagged');
+  assert.match(text, /erschöpft/, 'exhausted balance is flagged');
+});
+
+test('missing policies or balances produce honest fallbacks, never assumed costs', async (t) => {
+  const empty = JSON.parse(JSON.stringify(CONTEXT));
+  empty.snapshot.effectiveLimits.rootPolicies = [];
+  const f = continuousFixture(apiFor({ context: empty }));
+  t.after(() => f.dom.window.close());
+  await f.controller.refresh();
+  assert.match(
+    f.document.querySelector('[data-budget]').textContent,
+    /nicht verfügbar/,
+    'absent policies state that no budget is assumed',
+  );
+
+  const noTokens = JSON.parse(JSON.stringify(CONTEXT));
+  delete noTokens.snapshot.effectiveLimits.rootPolicies[0].tokens;
+  const g = continuousFixture(apiFor({ context: noTokens }));
+  t.after(() => g.dom.window.close());
+  await g.controller.refresh();
+  const text = g.document.querySelector('[data-budget]').textContent;
+  assert.match(text, /nicht verfügbar/, 'absent balance is named');
+  assert.doesNotMatch(text, /145000/, 'no balance is invented');
+});
+
+test('routing overview shows policy billing, quota reserve and aggregated receipts', async (t) => {
+  const f = continuousFixture(apiFor());
+  t.after(() => f.dom.window.close());
+  await f.controller.refresh();
+  const routing = f.document.querySelector('[data-budget] [data-routing]');
+  assert.ok(routing, 'budget section carries a [data-routing] region');
+  const text = routing.textContent;
+  assert.match(text, /subscription/, 'allowed billing sources are visible');
+  assert.match(text, /20 ?%/, 'quota reserve percent is visible');
+  assert.match(text, /kimi/, 'resolved provider is visible');
+  assert.match(text, /kimi-k3/, 'resolved model is visible');
+  assert.match(text, /high/, 'resolved effort is visible');
+  assert.match(text, /exit 0 observed/, 'execution observation is visible');
+  assert.match(text, /unlesbar/, 'the broken receipt is named as unreadable, not guessed');
+});
+
+test('usage receipts show provenance; missing receipts name their reason', async (t) => {
+  const f = continuousFixture(apiFor());
+  t.after(() => f.dom.window.close());
+  await f.controller.refresh();
+  const text = f.document.querySelector('[data-budget]').textContent;
+  assert.match(text, /43210/, 'measured receipt tokens are visible');
+  assert.match(text, /codex-exec-json-v1/, 'collector provenance is visible');
+  assert.match(text, /no trusted collector/, 'a missing receipt names its reason');
+});
+
+test('unchanged refresh leaves the budget DOM alone; changed balances rebuild it', async (t) => {
+  let measured = 45000;
+  const context = () => {
+    const value = JSON.parse(JSON.stringify(CONTEXT));
+    value.snapshot.effectiveLimits.rootPolicies[0].tokens.measuredTokens = measured;
+    return value;
+  };
+  const g = continuousFixture(async (path) => {
+    if (path.startsWith('/api/hq/v1/context')) return context();
+    if (path.startsWith('/api/hq/v1/runs')) return RUNS;
+    if (path.startsWith('/api/hq/v1/runtime')) return { apiVersion: 1 };
+    throw new Error(`unexpected api path ${path}`);
+  });
+  t.after(() => g.dom.window.close());
+  await g.controller.refresh();
+  const before = g.document.querySelector('[data-budget] article');
+  assert.ok(before, 'budget article rendered');
+  await g.controller.refresh();
+  assert.strictEqual(
+    g.document.querySelector('[data-budget] article'),
+    before,
+    'unchanged data keeps the existing budget DOM nodes',
+  );
+  measured = 46000;
+  await g.controller.refresh();
+  const rebuilt = g.document.querySelector('[data-budget] article');
+  assert.notStrictEqual(rebuilt, before, 'changed balances rebuild the section');
+  assert.match(rebuilt.textContent, /46000/, 'new balance is rendered');
+});
+
+function liveFixture() {
+  const dom = new JSDOM(source('docs/dev-hq/live.html'), { url: 'http://localhost/live.html', runScripts: 'outside-only' });
+  const { window } = dom;
+  window.HQ_DATA = JSON.parse(source('docs/dev-hq/data.json'));
+  window.fetch = () => new Promise(() => {});
+  window.matchMedia = () => ({ matches: true });
+  window.HTMLElement.prototype.scrollIntoView = function () {};
+  window.eval(source('docs/dev-hq/workspace.js'));
+  window.eval(source('docs/dev-hq/continuous.js'));
+  window.eval(source('docs/dev-hq/hq.js'));
+  return { dom, window, document: window.document };
+}
+
+test('b key reveals and focuses the budget and routing section', async (t) => {
+  const f = liveFixture();
+  t.after(() => f.dom.window.close());
+  const { document: d } = f;
+  assert.equal(d.querySelector('#panel-teams').hidden, true, 'teams panel starts hidden on the overview tab');
+  assert.equal(d.querySelector('#live-keys-enabled').checked, true, 'single-key shortcuts default to on (the b flow depends on it)');
+  d.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
+  const section = d.querySelector('#hq-budget-live');
+  assert.ok(section, 'budget/routing section carries the stable id hq-budget-live');
+  assert.equal(d.querySelector('#panel-teams').hidden, false, 'teams panel is revealed');
+  assert.equal(d.activeElement, section, 'keyboard focus lands on the budget section');
+  assert.match(d.querySelector('#live-keys-help').innerHTML, /<kbd>b<\/kbd>/, 'keys help documents b');
+});
diff --git a/scripts/lib/hq-goals-live.test.mjs b/scripts/lib/hq-goals-live.test.mjs
new file mode 100644
index 0000000..44fd059
--- /dev/null
+++ b/scripts/lib/hq-goals-live.test.mjs
@@ -0,0 +1,140 @@
+// scripts/lib/hq-goals-live.test.mjs — W2-10a: the goals/teams card must be a
+// real live view: a compact ownership summary per running goal, and a 5 s
+// refresh that never throws the operator out of the UI (focus, open details
+// and unsaved assignment drafts survive unchanged data), plus a keyboard
+// shortcut that jumps to the card.
+import test from 'node:test';
+import assert from 'node:assert/strict';
+import { readFileSync } from 'node:fs';
+import { JSDOM } from 'jsdom';
+
+const source = (path) => readFileSync(path, 'utf8');
+
+const CONTEXT = {
+  cursor: 7,
+  snapshot: {
+    sourceTimestamp: '2026-09-25T10:00:00Z',
+    commit: 'abc1234',
+    control: { status: 'paused' },
+    goals: [
+      { id: 'goal-1', projectId: 'p1', objective: 'Ship live goals view', acceptanceCriteria: 'Tests pass', status: 'open' },
+      { id: 'goal-2', projectId: 'p1', objective: 'Closed paperwork', acceptanceCriteria: 'Done', status: 'closed' },
+    ],
+    tasks: [
+      {
+        id: 'task-1', goalId: 'goal-1', objective: 'Render ownership', profileId: 'codex',
+        status: 'running', attempts: 1, ownedPaths: ['docs/dev-hq/continuous.js'], dependencies: [],
+        claim: { owner: 'worker-1', fence: 3 },
+        assignment: { teamId: 'development', role: 'implementer', assignee: 'worker-1', revision: 2 },
+      },
+      {
+        id: 'task-2', goalId: 'goal-1', objective: 'Review the view', profileId: 'kimi',
+        status: 'open', attempts: 0, ownedPaths: [], dependencies: ['task-1'],
+      },
+    ],
+    effectiveLimits: {
+      rootPolicies: [{ policy: { teams: [{ id: 'development', roles: ['implementer', 'reviewer'] }] } }],
+    },
+  },
+};
+
+function continuousFixture(api) {
+  const dom = new JSDOM('<main></main>', { runScripts: 'outside-only' });
+  dom.window.eval(source('docs/dev-hq/continuous.js'));
+  const controller = dom.window.createHQContinuous({
+    container: dom.window.document.querySelector('main'),
+    api,
+    project: () => 'p1',
+  });
+  return { dom, controller, document: dom.window.document, window: dom.window };
+}
+
+test('ownership summary lists claim, team assignment and owned paths per running goal', async (t) => {
+  const f = continuousFixture(async () => CONTEXT);
+  t.after(() => f.dom.window.close());
+  await f.controller.refresh();
+  const ownership = f.document.querySelector('[data-ownership]');
+  assert.ok(ownership, 'goals card exposes a [data-ownership] summary region');
+  const text = ownership.textContent;
+  assert.match(text, /Ship live goals view/);
+  assert.match(text, /worker-1/, 'claim owner is visible');
+  assert.match(text, /development/, 'team is visible');
+  assert.match(text, /implementer/, 'role is visible');
+  assert.match(text, /docs\/dev-hq\/continuous\.js/, 'owned path is visible');
+  assert.doesNotMatch(text, /Closed paperwork/, 'closed goals stay out of the running summary');
+  assert.equal(ownership.querySelector('img'), null, 'summary text is inert');
+});
+
+test('refresh with unchanged data preserves open details, focus and form drafts', async (t) => {
+  const f = continuousFixture(async () => CONTEXT);
+  t.after(() => f.dom.window.close());
+  await f.controller.refresh();
+  const details = [...f.document.querySelectorAll('[data-goals] details')]
+    .find((node) => node.textContent.includes('Render ownership'));
+  assert.ok(details, 'task details rendered');
+  details.open = true;
+  const assignee = details.querySelector('input[name=assignee]');
+  assignee.value = 'worker-9';
+  assignee.focus();
+  assert.equal(f.document.activeElement, assignee);
+  await f.controller.refresh();
+  const again = [...f.document.querySelectorAll('[data-goals] details')]
+    .find((node) => node.textContent.includes('Render ownership'));
+  assert.ok(again.open, 'open details stay open across a no-change refresh');
+  const assigneeAgain = again.querySelector('input[name=assignee]');
+  assert.equal(assigneeAgain.value, 'worker-9', 'unsaved assignment draft survives');
+  assert.equal(f.document.activeElement, assigneeAgain, 'focus stays on the drafted field');
+});
+
+test('changed-data rebuild restores focus to a submit button', async (t) => {
+  let attempts = 0;
+  const f = continuousFixture(async () => ({
+    ...CONTEXT,
+    snapshot: {
+      ...CONTEXT.snapshot,
+      tasks: CONTEXT.snapshot.tasks.map((task) => task.id === 'task-2' ? { ...task, attempts } : task),
+    },
+  }));
+  t.after(() => f.dom.window.close());
+  await f.controller.refresh();
+  const details = [...f.document.querySelectorAll('[data-goals] details')]
+    .find((node) => node.textContent.includes('Review the view'));
+  details.open = true;
+  const submit = details.querySelector('button[type=submit]');
+  assert.equal(submit.disabled, false, 'unlocked task has an enabled submit button');
+  submit.focus();
+  assert.equal(f.document.activeElement, submit);
+  attempts = 1; // changed data forces a rebuild
+  await f.controller.refresh();
+  const again = [...f.document.querySelectorAll('[data-goals] details')]
+    .find((node) => node.textContent.includes('Review the view'));
+  assert.ok(again.open, 'open details stay open across a changed-data rebuild');
+  assert.equal(f.document.activeElement, again.querySelector('button[type=submit]'), 'submit button focus is restored');
+});
+
+function liveFixture() {
+  const dom = new JSDOM(source('docs/dev-hq/live.html'), { url: 'http://localhost/live.html', runScripts: 'outside-only' });
+  const { window } = dom;
+  window.HQ_DATA = JSON.parse(source('docs/dev-hq/data.json'));
+  window.fetch = () => new Promise(() => {});
+  window.matchMedia = () => ({ matches: true });
+  window.HTMLElement.prototype.scrollIntoView = function () {};
+  window.eval(source('docs/dev-hq/workspace.js'));
+  window.eval(source('docs/dev-hq/continuous.js'));
+  window.eval(source('docs/dev-hq/hq.js'));
+  return { dom, window, document: window.document };
+}
+
+test('g key reveals and focuses the goals and teams card', async (t) => {
+  const f = liveFixture();
+  t.after(() => f.dom.window.close());
+  const { document: d } = f;
+  assert.equal(d.querySelector('#panel-teams').hidden, true, 'teams panel starts hidden on the overview tab');
+  assert.equal(d.querySelector('#live-keys-enabled').checked, true, 'single-key shortcuts default to on (the g flow depends on it)');
+  d.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'g', bubbles: true }));
+  const card = d.querySelector('#hq-goals-live');
+  assert.ok(card, 'goals/teams card carries the stable id hq-goals-live');
+  assert.equal(d.querySelector('#panel-teams').hidden, false, 'teams panel is revealed');
+  assert.equal(d.activeElement, card, 'keyboard focus lands on the card');
+  assert.match(d.querySelector('#live-keys-help').innerHTML, /<kbd>g<\/kbd>/, 'keys help documents g');
+});
diff --git a/scripts/lib/hq-routes.test.mjs b/scripts/lib/hq-routes.test.mjs
index 0310382..9bfdc43 100644
--- a/scripts/lib/hq-routes.test.mjs
+++ b/scripts/lib/hq-routes.test.mjs
@@ -53,9 +53,16 @@ function spawnHq(dir, extraEnv = {}) {
         PROJECTA_API_DESCRIPTOR: join(dir, "descriptor.json"),
         PROJECTA_AGENTS_FILE: join(dir, "agents.json"),
         HQ_LESSONS_FILE: join(dir, "lessons.json"),
+        // The insights estimate reads the agent journal `.pa/ACTIVITY.md`,
+        // which is deliberately untracked (instance-local append log) and
+        // counts into the time estimate (max of git sittings and journal
+        // sessions). Pin it to a per-instance empty fixture so the estimate
+        // is hermetic — a host journal would shift it on developer machines.
+        HQ_ACTIVITY_FILE: join(dir, "ACTIVITY.md"),
       },
       stdio: ["ignore", "pipe", "pipe"],
     });
+    writeFileSync(join(dir, "ACTIVITY.md"), "# Activity\n");
     writeFileSync(join(dir, "descriptor.json"), JSON.stringify({ port: 1, token: "unused" }));
     let stderr = "";
     child.stderr.on("data", (chunk) => { stderr += chunk; });
diff --git a/scripts/lib/hq-visual.browser.mjs b/scripts/lib/hq-visual.browser.mjs
index ab9a2d0..f64cfe9 100644
--- a/scripts/lib/hq-visual.browser.mjs
+++ b/scripts/lib/hq-visual.browser.mjs
@@ -31,9 +31,26 @@ function startMockApi() {
   const routes = {
     "/api/hq/v1/context": { cursor: 1, snapshot: { sourceTimestamp: "2026-09-10T12:00:00Z", commit: null,
       control: { status: "paused" }, goals: [{ id: "goal-1", projectId: "pj-1", objective: "Verify continuous development", acceptanceCriteria: "Claims and restart tests pass", status: "open" }],
-      effectiveLimits: { rootPolicies: [{ policy: { teams: [{ id: "development", roles: ["coordinator", "implementer", "reviewer", "integrator"] }] } }] },
-      tasks: [{ id: "task-1", goalId: "goal-1", objective: "Check ownership", profileId: "codex", status: "pending", attempts: 0, ownedPaths: ["src-tauri/src/queue.rs"], dependencies: [] }] } },
-    "/api/hq/v1/runs": { executionEnabled: false, approvalAuthority: { state: "unavailable" }, runs: [] },
+      effectiveLimits: { rootPolicies: [{ rootGoalId: "goal-1", source: "projecta.dev.json", observedAt: 1758000000,
+        policy: { teams: [{ id: "development", roles: ["coordinator", "implementer", "reviewer", "integrator"] }],
+          routing: { additionalPaidApi: false, quotaReservePercent: 20, billing: ["subscription", "free", "local"] },
+          providers: ["claude", "kimi"] },
+        tokens: { allowance: { maxPerGoal: 200000, verificationReserve: 40000 }, measuredTokens: 45000, reservedTokens: 10000,
+          verificationRemaining: 40000, availableTokens: 145000, implementationAvailable: 105000, unresolvedOperations: 1,
+          usageState: "partial", exceeded: false, exhausted: false } }] },
+      tasks: [{ id: "task-1", goalId: "goal-1", objective: "Check ownership", profileId: "codex", status: "pending", attempts: 0, ownedPaths: ["src-tauri/src/queue.rs"], dependencies: [],
+        claim: { owner: "worker-1", fence: 2 },
+        assignment: { teamId: "development", role: "implementer", assignee: "worker-1", revision: 1 } }] } },
+    "/api/hq/v1/runs": { executionEnabled: false, approvalAuthority: { state: "unavailable" }, runs: [{
+      run: { id: "run-1", taskId: "task-1", status: "completed", claimOwner: "worker-1", claimFence: 2 },
+      candidate: { candidateCommit: "def5678", source: "worker-push" },
+      launch: { routeJson: JSON.stringify({
+        selection: { resolved: { provider: "kimi", profileId: "kimi", resolvedModel: { value: "kimi-k3" }, effort: { value: "high" } } },
+        executionObservation: { reason: "exit 0 observed" } }) },
+      evidence: [], reviews: [],
+      tokens: { availableTokens: 145000, usageState: "partial" },
+      usage: { state: "measured", tokens: 43210, reservation: "settled",
+        provenance: { collector: "codex-exec-json-v1", measurement: "live", source: "process-owned stdout", sourceSha256: "deadbeef", observedAt: 1758000100 } } }] },
     "/api/projects": [{ id: "pj-1", name: "ProjectA" }],
     "/api/board": [
       {
@@ -235,6 +252,57 @@ test("continuous goals use the selected project and show blocked runtime honestl
   await page.close();
 });
 
+test("goals live view renders ownership and the g key jumps to the card", async () => {
+  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
+  await page.goto(`http://127.0.0.1:${hqPort}/live.html`);
+  await page.waitForSelector('.live-status.ok', { timeout: 20000 });
+  await page.selectOption('#live-project', 'pj-1');
+  await page.waitForFunction(() => document.querySelector('[data-ownership]')?.textContent.includes('Verify continuous development'), { timeout: 10000 });
+  const ownership = await page.textContent('[data-ownership]');
+  assert.match(ownership, /Besetzt: worker-1/);
+  assert.match(ownership, /development\/implementer/);
+  assert.match(ownership, /src-tauri\/src\/queue\.rs/);
+  await page.click('#tab-teams');
+  await page.locator('#hq-goals-live').scrollIntoViewIfNeeded();
+  await page.locator('#hq-goals-live').screenshot({ path: join(shotDir, 'goals-teams-ownership.png') });
+  // Keyboard flow: from another tab, with focus outside any typing context,
+  // g reveals the teams panel and focuses the goals/teams card.
+  await page.click('#tab-overview');
+  await page.evaluate(() => document.activeElement?.blur());
+  await page.keyboard.press('g');
+  await page.waitForSelector('#panel-teams:not([hidden])', { timeout: 5000 });
+  assert.equal(await page.evaluate(() => document.activeElement?.id), 'hq-goals-live');
+  await page.screenshot({ path: join(shotDir, 'goals-teams-keyboard-g.png'), fullPage: false });
+  await page.close();
+});
+
+test("budget live view renders balances and routing receipts, the b key jumps to the section", async () => {
+  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
+  await page.goto(`http://127.0.0.1:${hqPort}/live.html`);
+  await page.waitForSelector('.live-status.ok', { timeout: 20000 });
+  await page.selectOption('#live-project', 'pj-1');
+  await page.waitForFunction(() => document.querySelector('[data-budget]')?.textContent.includes('Limit 200000'), { timeout: 10000 });
+  const budget = await page.textContent('[data-budget]');
+  assert.match(budget, /gemessen 45000/);
+  assert.match(budget, /teilweise belegt/);
+  assert.match(budget, /subscription/, 'policy billing sources are visible');
+  assert.match(budget, /kimi-k3/, 'resolved model is visible');
+  assert.match(budget, /43210/, 'measured usage receipt is visible');
+  assert.match(budget, /codex-exec-json-v1/, 'collector provenance is visible');
+  await page.click('#tab-teams');
+  await page.locator('#hq-budget-live').scrollIntoViewIfNeeded();
+  await page.locator('#hq-budget-live').screenshot({ path: join(shotDir, 'budget-routing-live.png') });
+  // Keyboard flow: from another tab, with focus outside any typing context,
+  // b reveals the teams panel and focuses the budget/routing section.
+  await page.click('#tab-overview');
+  await page.evaluate(() => document.activeElement?.blur());
+  await page.keyboard.press('b');
+  await page.waitForSelector('#panel-teams:not([hidden])', { timeout: 5000 });
+  assert.equal(await page.evaluate(() => document.activeElement?.id), 'hq-budget-live');
+  await page.screenshot({ path: join(shotDir, 'budget-routing-keyboard-b.png'), fullPage: false });
+  await page.close();
+});
+
 test("worker detail opens on click, shows messages, sends a reply", async () => {
   const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
   await page.goto(`http://127.0.0.1:${hqPort}/live.html`);
```
