# Report W2-10b — Live-HQ-View Routing/Budget

Paket: W2-10b (zweites Kind von W2-10 „Live-HQ-Views", Quelle: `docs/PLAN.md`).
Branch `claude/w2-10b`, Arbeitsbaum `public/wt/w2-10b`. **Stapelt auf dem
ungemergten `claude/w2-10a`** (W2-10a war bei Paketbeginn nicht auf main;
Auftrag: dann auf dessen Branch aufsetzen und im PR vermerken).

## Was sich geändert hat

Die Sektion „Budget & Routing" der Karte „Ziele & kontinuierliche Entwicklung"
im Dev-HQ (Live-Seite) ist jetzt eine echte Live-Ansicht nach dem Muster von
W2-10a:

- **Budget-Summary je Root-Goal** (`docs/dev-hq/continuous.js`, inert via
  `textContent`): Limit, gemessen, reserviert, verfügbar, Umsetzungsbudget,
  Prüfungsschutz (verificationRemaining), Status als ehrliches deutsches Label
  (gemessen / teilweise belegt / keine Belege erfasst / kein Budget
  eingeräumt), Sichtbarmachung von `exceeded`/`exhausted` (un-gemutet +
  Text-Flags) und der offenen Vorgänge ohne Beleg. Daten aus der vorhandenen
  HQ-v1-API (`/api/hq/v1/context` → `effectiveLimits.rootPolicies[].tokens` =
  TokenBalance), kein neues Backend.
- **Routing- & Kostenbelege** (`[data-routing]`): je Root-Goal die
  Policy-Routing-Regeln (erlaubte Billing-Quellen, Quota-Reserve,
  zusätzliche kostenpflichtige API), je Run der aggregierte Routing-Beleg aus
  `launch.routeJson` (Provider · Profil · Modell · Aufwand · Ausführungsbeleg,
  bestehende `routingSummary`) und der W2-03-Kostenbeleg mit Provenienz
  (Collector, Messung) — oder der benannte Grund, warum keiner existiert.
  Unlesbare Belege werden als unlesbar benannt, nichts wird angenommen.
- **Signatur-Gating**: eine Signatur über Policies + Belege lässt den 5-s-Tick
  die Sektion bei unveränderten Daten unangetastet (vorher: Rebuild bei jedem
  Tick); Projektwechsel setzt die Signatur zurück.
- **Tastatur**: `b` öffnet von jedem Tab aus das Teams-Panel und fokussiert
  die Sektion (`#hq-budget-live`, `tabindex="-1"`); in der `?`-Hilfe
  dokumentiert. Bestehender Typing-Guard und Opt-out greifen.
- **Keine Doppelfunktion App/HQ**: die App (UsageView) zeigt Provider-Quota/
  Kosten; diese View zeigt ausschließlich das Continuous-Tokenbudget und
  Routing-/Kostenbelege aus HQ v1. Runs/Review/Delivery (W2-10c) und die
  Ownership-View (W2-10a) unberührt.

## Rot → Grün

| Schritt | Befehl | Exit |
|---|---|---|
| Rot (6 neue Tests gegen Bestand) | `node --test scripts/lib/hq-budget-live.test.mjs` | **1** (6 von 7 rot; der Fallback-Test war durch 10a-Texte bereits grün) |
| Grün nach Implementierung | derselbe | **0** (7 ✔) |

Commits: `ea411d5` (rot, Test-First-Trailer), `0a73728` (Implementierung),
`34532aa` (visueller Beleg).

## Gates

- `npm run test:hq` → **Exit 0** (278 Tests, 278 pass).
- `HQ_SHOT_DIR=… npm run test:hq:visual` → **Exit 0** (13 Tests; Screenshots
  `budget-routing-live.png`, `budget-routing-keyboard-b.png` erzeugt und
  **angesehen**: Budget-Zeilen und Belege lesbar und inert; nach `b` ist das
  Agenten-Teams-Panel aktiv und die Sektion sichtbar fokussiert). Beleg als
  reproduzierbarer Testlauf plus inspizierte Aufnahme, nicht als Commit
  (Repo ignoriert `.pa/*`-Binärdateien bewusst; Harness = Mock-API, die App
  wird zum Ansehen nicht gestartet).
- `bash scripts/ci/gates.sh lane prepush` (CARGO_TARGET_DIR Slot projecta-c,
  CARGO_BUILD_JOBS=1) → **Exit 0**: fmt 6 s, typecheck 13 s, lint 32 s,
  fe-test 91 s, hq-test 24 s, clippy 126 s, rust-suite 267 s.
- Der Push-Hook fährt dieselbe Lane am finalen Kopf erneut.

### NICHT ABGEDECKT (aus dem Gate-Lauf, Windows)

- die `#[cfg(unix)]`-Tests (Dateirechte, Prozessgruppen-Kill) — kompilieren
  unter Windows nicht (KNOWN_ISSUES KI-7); die Linux-Arme von clippy.
  Dieser Lauf belegt die Windows-Hälfte, nicht die Linux-Hälfte
  (Linux: WSL2 mit Clone auf ext4, siehe docs/ci-lokal.md).
- Bahn `prepush` ist die schnelle Schleife: Browser-Smoke, Frontend-Build und
  die Workflow-Gates laufen erst in der Bahn `linux` (CI bzw. Merge-Queue).
- Der Zustand externer Dienste (Updater-Endpoint, OmniRoute, Mirror) wird von
  keinem Gate geprüft.
- `hq-visual` lief lokal (Chromium vorhanden); in CI läuft es in der
  Linux-Bahn.

## Reviews

Diff +359/−23 (> 300 Zeilen) → zwei Reviews anderer Anbieter (Autor Kimi K3,
beide Reviewer nicht die Autorenfamilie):

- **GLM 5.2** (`glm-5.2:cloud`, Ollama Cloud): **freigeben mit Auflagen**
  (1 Low-Befund). Protokoll `.pa/review_w2-10b_glm-5.2.md`.
- **Qwen 2.5 Coder 14B** (`qwen2.5-coder:14b`, lokal via Ollama):
  **freigeben mit Auflagen** (5 inhaltlich identische Befunde). Protokoll
  `.pa/review_w2-10b_qwen2.5-coder.md`.

Disposition: `.pa/review_w2-10b_disposition.md` — alle Befunde begründet
abgelehnt (GLM-F1: Prämisse falsch, `usage_state` ist eine geschlossene
Vierermenge und vollständig übersetzt; Qwen-F1–F5: behauptete Race ohne
Mechanismus — Signatur-Prüfung und Render laufen synchron in einem Block,
Generation-Guard fängt veraltete Abschlüsse ab, Test belegt beide Pfade).
Kein Befund angenommen → keine Nacharbeit, kein Delta-Review nötig.

Ersatzweg (Transparenz): das Advisor-Paar war nicht verfügbar — Fable 5.1
(Claude-Subagent) 402 „Insufficient account funds", GPT-6 Astra (Codex CLI)
„usage limit" bis 30.09.2026, deepseek-v4-flash:cloud aus Ollama Cloud
entfernt (HTTP 410). Kein Geld ausgegeben; Qwen 2.5 Coder war auf dieser
Maschine bereits als Reviewer etabliert.

## Offene Punkte / Folgearbeit

- W2-10c (Runs/Review/Delivery) als eigenes Paket; die Runs-Sektion ist
  markiert und bewusst unberührt. Die per-Run-Routing-Zeile dort bleibt
  vorerst — Aggregat (10b) vs. Detail (10c) ist abgestimmt, bei 10c prüfen,
  ob die Detailzeile entfällt.
- Stacking: dieser Branch enthält die W2-10a-Commits; landet W2-10a zuerst
  auf main, ist der Diff dieses PR automatisch nur noch das 10b-Delta.
- Mergify-Regel „Paket-PR bringt `.pa/report_*.md` mit" steht weiter gegen
  PLAN-01 („Report im PR-Text"): dieser PR trägt beides (wie W2-10a), die
  Regel-Drift ist dem Koordinator gemeldet.
- Reviewer-Verfügbarkeit: deepseek-v4-flash:cloud ist aus Ollama Cloud
  verschwunden (410); `docs/setup/ollama-reviewers.md` nennt nur das
  Paar kimi-k3/glm-5.2 — bei Bedarf Ersatz-Reviewer dokumentieren.
