# Report W2-10a — Live-HQ-View Goals/Teams

Paket: W2-10a (erstes Kind von W2-10 „Live-HQ-Views", Quelle: `docs/PLAN.md`).
Branch `claude/w2-10a`, Arbeitsbaum `public/wt/w2-10a`.

## Was sich geändert hat

Die Karte „Ziele & kontinuierliche Entwicklung" im Dev-HQ (Live-Seite, Panel
„Agenten-Teams") ist jetzt eine echte Live-Ansicht statt einer Ansicht, die den
Bedienende alle 5 s aus dem UI wirft:

- **Ownership-Summary** (`[data-ownership]`, inert via `textContent`): je
  laufendem (nicht geschlossenem) Ziel eine kompakte Zeile — Status, Besetzung
  (Claim-Owner), Team-Sitz (`team/role`) und eigene Dateibereiche. Daten aus
  der vorhandenen HQ-v1-API (`/api/hq/v1/context`), kein neues Backend, keine
  Doppelfunktion zur App (die App kennt nur Produktziele in der ViewBar).
- **Zustandserhalt über den 5-s-Tick**: eine Signatur über
  `{goals, tasks, teams, controlStatus}` überspringt den DOM-Neuaufbau bei
  unveränderten Daten; bei geänderten Daten werden offene `<details>`,
  ungespeicherte Zuweisungs-Entwürfe (dirty Felder) und der Fokus (benannte
  Felder, `summary`, Submit-Button) gesichert und wiederhergestellt. Vorher
  riss `replaceChildren()` alle 5 s Fokus, offene Details und Entwürfe weg.
- **Tastatur**: `g` öffnet von jedem Tab aus das Teams-Panel und fokussiert
  die Karte (`#hq-goals-live`, `tabindex="-1"`); in der `?`-Hilfe dokumentiert.
  Bestehender Typing-Guard greift (kein Feuern in Eingabefeldern).
- Budget/Routing (W2-10b) und Runs/Review/Delivery (W2-10c) unberührt.

Zusatz, gate-blockierend und vorbestehend (nicht von diesem Paket verursacht):

- `src-tauri/src/skills.rs`: ein `assert!` von rustfmt (1.98.0) umgebrochen —
  das fmt-Gate war auf einem sauberen Checkout des initialen öffentlichen
  Releases rot und blockierte jeden Commit (`2781173`, `No-Test`).
- `scripts/hq-live.mjs` + `scripts/lib/hq-routes.test.mjs`: der
  Insights-Schätzer las das ungetrackte, instanzlokale `.pa/ACTIVITY.md`; auf
  einem sauberen Klon des öffentlichen Repos (ein Squash-Commit, kein Journal)
  fiel die Zeitschätzung auf eine einzelne git-Sitzung und der hq-routes-Test
  (`hours > 1`) war rot — das Gate `hq-test` (Bahnen prepush/linux) war auf
  `origin/main` ohne lokale Dateien rot. hq-live ehrt jetzt
  `HQ_ACTIVITY_FILE`, der Test setzt ein Fixture-Journal (`5ec7f8d`).

## Rot → Grün

| Schritt | Befehl | Exit |
|---|---|---|
| Rot (3 neue Tests gegen Bestand) | `node --test scripts/lib/hq-goals-live.test.mjs` | **1** (alle 3 rot) |
| Grün nach Implementierung | derselbe | **0** (4 ✔ inkl. F2-Test) |
| Vorbestehender Basis-Rot (Beleg) | `node --test --test-name-pattern=insights scripts/lib/hq-routes.test.mjs` im sauberen Basis-Worktree (`origin/main`) | **1** („0.5 h") |
| Basis-Fix grün | `node --test scripts/lib/hq-routes.test.mjs` | **0** (8 ✔) |
| F2-Nacharbeit rot ohne Fix | `node --test --test-name-pattern="submit button" scripts/lib/hq-goals-live.test.mjs` (continuous.js gestasht) | **1** |
| F2-Nacharbeit grün | `node --test scripts/lib/hq-goals-live.test.mjs` | **0** |

Commits: `2781173` (fmt), `330356a` (rot, Test-First-Trailer), `ea6ecf9`
(Implementierung), `5ec7f8d` (hermetischer Insights-Fix, Regression-For:
c60f267), `02e6101` (visueller Beleg), `ae41907` (Review-Nacharbeit F1/F2).

## Gates

- `npm run test:hq` → **Exit 0** (270 Tests, 270 pass).
- `HQ_SHOT_DIR=… npm run test:hq:visual` → **Exit 0** (12 Tests; Screenshots
  `goals-teams-ownership.png`, `goals-teams-keyboard-g.png` erzeugt und
  **angesehen**: Ownership-Zeile lesbar und inert; nach `g` ist das
  Agenten-Teams-Panel aktiv und die Karte fokussiert). Die PNGs sind
  reproduzierbar (visueller Harness gegen Mock-API); das öffentliche Repo
  ignoriert `.pa/*`-Binärdateien bewusst (`.gitignore`), darum Beleg als
  reproduzierbarer Testlauf plus inspizierte Aufnahme, nicht als Commit.
- `bash scripts/ci/gates.sh lane prepush` (CARGO_TARGET_DIR Slot projecta-c,
  CARGO_BUILD_JOBS=1) → **Exit 0**: fmt 2 s, typecheck 7 s, lint 31 s,
  fe-test 48 s, hq-test 9 s, clippy 167 s, rust-suite 388 s.
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

GLM 5.2 (nicht die Autorenfamilie; Autor Kimi K3): Gesamtdiff **approve**
(4 Low-Funde), Delta nach Nacharbeit **approve**. Disposition:
`.pa/review_w2-10a_disposition.md` — F1/F2 angenommen (Commit `ae41907`),
F3/F4 begründet abgelehnt. Protokoll: `.pa/review_w2-10a_glm-5.2.md`.
Diff-Umfang 242+/10−, keine Nahtstelle → ein Review ausreichend (AGENTS.md).

## Offene Punkte / Folgearbeit

- W2-10b (Routing/Budget) und W2-10c (Review/Delivery) als eigene Pakete; die
  Abschnitte sind in der Karte markiert und bewusst unberührt.
- Mergify-Regel „Paket-PR bringt `.pa/report_*.md` mit" steht gegen PLAN-01
  („Report im PR-Text"): dieser PR trägt beides, die Regel-Drift ist dem
  Koordinator zu melden.
- Delta-Review-Notiz: falls ein Zuweisungsformular künftig mehrere
  Submit-Buttons oder ungetypte Buttons bekommt, Fokus-Restore mit
  Diskriminator nachrüsten.
- Der Screenshot-Beleg entstand gegen den Mock-API-Harness (hq-visual), nicht
  gegen eine laufende App — bewusst: die App darf zum bloßen Ansehen nicht
  gestartet werden (Queue könnte Worker dispatchen).
