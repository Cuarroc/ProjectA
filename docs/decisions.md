# Entscheidungs-Journal

Pro Eintrag genau drei Zeilen: **Was? — Warum? — Wann zurücknehmen?**
(Log, keine zweite AGENTS.md — M12, Rev-8-SANIERUNGSPLAN §9/8.31.)

## 2026-09-21

- Der pwsh-Detektor in `scripts/ci/workflow-shell.sh` erkennt PowerShell am
  Verb-Nomen-Muster (`Get-`, `Test-`, `Invoke-`, … plus Grossbuchstabe) statt
  an acht festen Ausdruecken, und wertet nur noch den Rumpf von `run:` aus —
  die erste Fassung haette `Test-Path`, `Get-Process`, `param(` und
  `throw $ex` durchgelassen, also fast jedes PS-Skript ohne `$LASTEXITCODE`,
  und umgekehrt an einem Schrittnamen angeschlagen (Befunde kimi-k2.7-code
  R-1/R-2 und gemini-2.5-pro R-1) — Zurücknehmen: wenn ein YAML-Parser als
  Abhaengigkeit des Gates vertretbar wird; eine Heuristik bleibt eine
  Heuristik.
- `ci.yml` schreibt nur noch die Zeilen `count=`/`specs=` nach
  `$GITHUB_OUTPUT`, nicht die ganze `--plan`-Ausgabe — die beiden
  Kopfzeilen `red-first: BASE=...` gehen heute durch, weil `count` trotzdem
  gesetzt wird, aber eine kuenftige Zeile ohne `=` liesse den Schritt mit
  "Invalid format" scheitern (Befund kimi-k2.7-code R-5) — Zurücknehmen:
  nie; was nach GITHUB_OUTPUT geht, wird ausgewaehlt, nicht durchgereicht.
- **Abgelehnt: ein Gate, das per GitHub-API prueft, ob `environment: release`
  Required Reviewers hat** (Vorschlag kimi-k2.7-code R-6). Der Befund ist
  richtig und bleibt als offener Punkt stehen; der Vorschlag braucht aber
  Rechte, die `GITHUB_TOKEN` im Release-Job nicht hat — sie ihm zu geben
  hiesse, dem Job mit dem Signing-Key Repo-Administrationsrechte zu geben
  und damit die Angriffsflaeche zu vergroessern, die der Eintrag
  verkleinern soll. Dazu ist die Environments-API vom Sitzungs-Proxy
  gesperrt, der Gate waere also unbelegt auf dem Signing-Pfad —
  Zurücknehmen: wenn GitHub den Zustand ohne Adminrechte lesbar macht.
- `red-first` baut den Kopf nur dann in das normale `src-tauri/target`, wenn
  der Checkout WIRKLICH der Kopf ist; weicht er ab, bekommt der Kopf-Worktree
  ein eigenes `target-red-first-head` — sonst baut fremder Code in das
  `target/` des Arbeitsbaums, also genau die Artefakt-Vermischung, gegen die
  die Trennung ueberhaupt gemacht wurde (Befund kimi-k2.7-code R-14) —
  Zurücknehmen: nie das Trennen; das Teilen im Gleichstand-Fall, sobald cargo
  den Paketpfad in den `-C metadata`-Hash aufnimmt.
- `.pa/review_transport.py` trennt den Reviewer-Ausfall (`ReviewerError`,
  saubere Meldung) vom unerwarteten Fehlertyp (Traceback im Protokoll plus
  der Satz, dass es kein Reviewer-Ausfall sein muss) — die breite
  `except`-Liste fing dieselben Klassen, in die auch ein Programmierfehler
  in diesem Skript faellt, und tarnte ihn als ausgefallenen Anbieter (Befund
  kimi-k2.7-code R-1) — Zurücknehmen: nie; "Absturz gegen stillen Fehler" ist
  genau dann ein schlechter Tausch, wenn er den eigenen Bug verdeckt.
- Das Befehlsfeld der Gate-Liste wird mit `cut -f4-` gelesen, nicht `-f4`,
  und der Arbeitsbaum-Waechter fuehrt Inhalts-Hashes statt nur Statuszeilen —
  beide Befunde des externen Dual-Reviews (konvergent bzw. Schwere hoch): mit
  `-f4` verschwand alles hinter einer Pipe im Gate-Befehl still, und der
  Waechter war blind, sobald eine Datei schon vorher geaendert war, also
  ausgerechnet im haeufigsten lokalen Fall — Zurücknehmen: nie; beides ist
  die Fehlerklasse, gegen die dieses Skript antritt.
- Die Pflichtliste in `scripts/test-gates.sh` fuehrt eine Mindestbesetzung
  fuer JEDE Bahn statt einer Teilmenge von zweien — ein Gate konnte aus
  `linux` verschwinden, solange es irgendwo sonst blieb, und `prepush`/
  `windows` waren gar nicht abgedeckt; ein Waechter mit Loechern an den
  wichtigsten Stellen erzeugt Vertrauen, das er nicht traegt — Zurücknehmen:
  nie; die Liste ist bewusst eine Mindest-, keine Sollbesetzung, damit ein
  neues Gate sie nicht rot macht.
- **Die Prompt-Groesse als Ursache des Reviewer-Ausfalls ist verworfen:**
  `gemini-2.5-pro` lieferte am 21.09. erneut `content = null`, diesmal bei
  53 KB statt 103 KB, waehrend zwei andere Reviewer denselben Prompt
  vollstaendig beantworteten. Die Teilung in drei Auftraege war genau darauf
  gemuenzt und hat an diesem Modell nichts geaendert — sie bleibt trotzdem,
  weil drei kleinere Auftraege auch sonst besser zu lesen sind —
  Zurücknehmen: die Teilung, sobald die echte Ursache bekannt ist.
- `.pa/review_transport.py` behandelt jede inhaltslose Antwort als Ausfall
  dieses Reviewers (Protokoll mit `Status: failed`, Exit 1) statt als
  Absturz — am 09.09. lieferte ein Reviewer `content: null`, `text.strip()`
  warf einen AttributeError, und der Lauf endete OHNE Protokoll fuer beide
  Reviewer, auch fuer den, der geantwortet hatte; eine leere Antwort galt
  sogar als gueltiges Review (Exit 0), also gruen durch Abwesenheit —
  Zurücknehmen: nie; ein Reviewer, der still fehlt, ist kein Review.
- `scripts/ci/workflow-shell.sh` erkennt zusaetzlich PowerShell in einem
  run-Schritt ohne eigenes `shell:` — der Workflow-Default `shell: bash`
  (09.09.) haertet gegen fehlendes pipefail, stellt aber auf windows-latest
  auch jeden pwsh-Schritt auf Git-Bash um; beim Merge von main traf das den
  Schritt `Gate - native Parent-Host-Prozessgrenze` — Zurücknehmen: wenn der
  Default je job- statt dateiweit gesetzt wird.
- Zwei Selbsttests sind eigene Gates in `linux`/`release` (`selftest-review`,
  `selftest-red-first`) und stehen in der Pflichtliste von
  `scripts/test-gates.sh` — sie belegen, dass der Review-Transport und die
  Test-First-Auswertung ueberhaupt scheitern KOENNEN, und ohne die
  Pflichtliste waeren genau sie beim Merge auf die Bahn-Struktur still
  verschwunden — Zurücknehmen: nie.

## 2026-09-17

- Alle W1-Pakete als `.pa/task_w1-XX.md` (`Status: aktiv`) angelegt und in
  STAND.md gelistet; die Claude-Code-Cloud-Sitzung fährt W1-04/05/06/07/08/18/19
  und die Nahtstellen-Lanes W1-13…16 seriell; Zweitreviews dort durch
  unabhängige Claude-Subagenten; Docs-PRs merge die Sitzung selbst, Code-PRs
  warten auf den Nutzer — Warum: Nutzerentscheidung 17.09., Codex bis 19.09.
  gecappt, OpenCode/Ollama aus der Cloud nicht erreichbar — Zurücknehmen: wenn
  ein Codex-Worker eine Lane übernimmt, gibt die Sitzung sie ab.
- Branch-Protection auf `main` (W0-06) setzt der Nutzer (GitHub Pro seit 17.09.);
  der Sitzungs-Proxy verweigert den Protection-Endpunkt — Warum: 403
  „not permitted through this proxy“ — Zurücknehmen: nie.
- Server-Skripte entfernt (W1-07): `scripts/remote-server-*`,
  `scripts/omniroute-tunnel.cmd`, `scripts/server/*`, `scripts/test-pa-ops.sh`;
  `scripts/omniroute-serve.cmd` bleibt (lokaler Daemon) — der Server ist seit
  09.09. weg, die Skripte lasen eine nicht existierende `.pa/remote-server.env`
  und brachen mit Exit 2 ab; tote Werkzeuge in einer lebenden Doku sind eine
  belegte Fehlerklasse — Zurücknehmen: bei Neuanschaffung eines Servers aus
  Tag `v1.4.0` holen, nicht neu schreiben.

## 2026-09-16

- W0-Entscheidungen des Nutzers (AskUser-Runde): PR #38 und #39 werden
  rebased und weitergeführt (W1-18/W1-19); Aggregatdateien werden beobachtet,
  kein `lib.rs`/store-Split vor Abschluss von W2; Branch-Protection auf `main`
  mit Required Checks `gates (linux)`/`gates (windows)`/`red-first` (Nutzer
  setzt sie); Zombie-Queue-Einträge werden verworfen; alle drei
  Scout-Recommendations (xterm-Search, tauri-plugin-log, insta) angenommen als
  W1-21…23; Ollama bleibt Helper (kein Worker-Adapter); Capture-Host bleibt
  Windows-only; Dependabot nur mergen, wenn CI grün — Warum: die Fragen
  blockierten W1; Struktur- und Adapter-Arbeit ohne belegten Bedarf kostet
  Review-Bandbreite — Zurücknehmen: Struktur bei messbar blockierten Lanes;
  Ollama-Adapter, wenn ein Cloud-Coder-Smoke Tool-Aufrufe belegt; Capture-Host
  auf Unix, sobald ProjectA dort installiert wird.
- Claude läuft über das Abo (CLI-Login), nicht über den API-Key (kein
  Guthaben) — Warum: der 400-Beleg betraf den API-Pfad des Review-Subagenten,
  nicht die CLI — Zurücknehmen: wenn API-Guthaben aufgefüllt wird.
- `red-first` lehnt Dependabot-Commits ohne Trailer ab (#42/#34) — Warum:
  Gate-Regel, kein Flake; Behandlung (Ausnahme für `dependabot[bot]` oder
  manuelles Nachziehen wie in #43) gehört zu W1-19 — Zurücknehmen: mit W1-19.

- 2026-09-17: Profil `ollama-coder` auf `ollama run deepseek-v4-flash:cloud`
  (Nutzerentscheidung). `qwen3-coder:480b-cloud` und `qwen3-coder-next` hat
  Ollama am 2026-07-15 zurueckgezogen, das ausgelieferte Profil konnte am PC
  nicht starten (BUGS.md 17.09.); `deepseek-v4-flash:cloud` antwortet dort in
  19 s. Die Rücknahmebedingung der Entscheidung vom 15.09. ist damit
  eingetreten. Ollama bleibt laut W0 vom 16.09. Helper, kein Worker-Adapter;
  die Billing-Provenienz der Cloud-Route ist weiterhin unbelegt — Zurücknehmen:
  wenn auch dieses Modell zurückgezogen wird oder ein Smoke zeigt, dass die
  Route ohne Abo bezahlt wuerde.
- 2026-09-17: Die Route-Fixtures der Rust-Tests laufen 3600 s statt 60 s
  (`FIXTURE_ROUTE_TTL_SECS`) — Warum: die Ablaufpruefung nutzt die Wanduhr, ein
  ausgelasteter Gesamtlauf ueberschritt das 60-s-Fenster und faerbte
  `native_handoff_*` rot (BUGS.md 17.09.) — Zurücknehmen: wenn die Pruefung
  eine injizierte Uhr bekommt, dann braucht die Fixture keine Reserve mehr.

## 2026-09-15

- `docs/PLAN.md` ist der einzige Arbeitsplan; Sanierungsplan Rev 9, alle
  `docs/superpowers/`-Pläne und -Specs, `.pa/plan_*`, Design-Brief/-Vertrag
  und die STAND.md-Vollfassung liegen unter `docs/archive/plaene-2026-09/`
  (nur Beleg); STAND.md ist auf Briefing + Spec-Tabelle verschlankt, die 18
  abgenommenen F-Specs sind `historisch` — Warum: über 40 teils überholte
  Plan-Dokumente drifteten (Bestandsaufnahme 15.09.), Agenten sollen
  garantiert nur mit einem Plan arbeiten; Pakete sind klein und parallel
  geschnitten — Zurücknehmen: nie rückwirkend; ein zweiter Plan nur per
  Eintrag hier.

## 2026-09-09

- Lücken-Zuordnung nachgeholt (F0-Pflicht aus SANIERUNGSPLAN §1, Befund B-06):
  F-CORE-3 → Paket `.pa/task_f_core3_delivery.md` (Spec Rev 4, `Status:
  aktiv`; A+B.1 gemergt 09.09., Rest B.2/B.3 in Lanes); F-SEC-7/8 → Branch
  `fix/f-sec-7-8` (gemergt 09.09., `ac56cbc`); F-SEC-1 → Gesamt-Deadline in
  `read_request` (`hooks.rs`), mit `fix/f-sec-7-8` gemergt — §1 auferlegte F0
  die Paketzuordnung; alle drei Lücken sind ihrem Paket zugeordnet und
  geschlossen bzw. in Umsetzung — Zurücknehmen:
  wenn ein Paket seine Lücke nicht schließt, neu zuordnen.

- Linux-Server (Hetzner-Worker-Host) wurde gelöscht — entfällt als Worker-Host samt
  `launch.sh`/`worker-*`-Werkzeugen, OmniRoute-SSH-Tunnel und als Heimat der
  `#[cfg(unix)]`-Rot-Läufe (KI-7-Pfad); OmniRoute läuft lokal weiter — neue
  Heimat für Unix-Rot-Läufe: Linux-CI (sobald Kontingent) oder WSL —
  Zurücknehmen: nie rückwirkend; bei Neuanschaffung eines Servers gelten die
  Abschnitte in STAND.md §5/AGENTS.md wieder.
- Multi-Harness-Konfiguration kommt auf den Fahrplan (Nutzerentscheidung):
  Harnesses wie Claude Code, Codex, DeepSeek sollen einstellbar sein, nicht
  nur die fünf festen Profile — Richtung: Harness-Eigenschaften als Daten
  (Settings), nicht als Rust-Enum; Spec erst nach F-CORE-3 und per
  Spec-First-Review — Zurücknehmen: wenn die Profil-Vermessung zeigt, dass
  die fünf festen Profile den Bedarf decken.
- DEV-HQ-Redesign ist die Wiedervorlage der Designschuld-Scheibe; die Auflage
  „kein Design-Paket vor S8+" (03.09.) ist durch Nutzerentscheid abgelöst —
  ein S-Stufen-Tracker existiert im Baum nicht, die Marke war ein Termin und
  keine Messgröße — Zurücknehmen: nie rückwirkend; ein künftiger Designstopp
  braucht eine eigene Zeile.
- Die Rücknahmebedingung des HQ (Eintrag 04.09.) wird geteilt: der Umfangsteil
  („Produktchrome, F2-Ziele, Variant B nachbilden") bleibt unverändert scharf,
  der Ästhetikteil („SaaS cards") entfällt — er verbietet Form statt
  Beliebigkeit und ist damit gleichzeitig zu eng (verbietet legitime
  Gruppierung) und zu weit (mit Hairlines ist man genauso beliebig); ersetzt
  durch den Austauschbarkeitstest und die Rechtfertigungspflicht je Element im
  Shell-Vertrag (`docs/design/2026-09-dev-hq/VERTRAG-ENTWURF.md`, vom Nutzer
  freigegeben 09.09.) — Zurücknehmen: sobald ein HQ-Screen unverändert für ein
  fremdes Produkt funktionieren würde.
- Der Browser-Smoke wiederholt keinen fehlgeschlagenen Test mehr, auch nicht
  unter CI (`playwright.config.ts`, vorher `retries: process.env.CI ? 1 : 0`) —
  Regel G-2 galt bis dahin nur fuer die Rust-Suite, und der lokale Lauf war
  damit strenger als CI, konnte also nicht fuer ihn buergen; Stabilitaet belegt
  `scripts/flake.sh`, nicht eine stille Wiederholung — Zurücknehmen: nie;
  ein Flake-Budget gehoert in eine Messung, nicht in ein Gate.
- Jeder Workflow deklariert `defaults: run: shell: bash` und ein Gate
  (`scripts/ci/workflow-shell.sh`) erzwingt das — ohne die Angabe startet
  GitHub `run:` als `bash -e {0}` OHNE pipefail, und der Exit-Code links einer
  Pipe geht verloren (05.09. review.yml, 04.09. clippy lokal);
  `no-masked-output.sh` fing nur die Schreibvorgaenge nach `$GITHUB_OUTPUT`,
  nicht die Klasse darunter — Zurücknehmen: wenn GitHub pipefail zum Default
  macht.
- Alle `uses:` sind auf einen 40-stelligen Commit-SHA gepinnt, mit dem
  Versionstag als Kommentar, und ein Gate (`scripts/ci/actions-pinned.sh`)
  haelt es so — `dtolnay/rust-toolchain@stable` war ein BRANCH und
  `taiki-e/install-action@nextest` ein wandernder Tag: beide konnten ihren
  Inhalt ohne einen Commit in diesem Repo aendern, in Jobs, in denen der
  Tauri-Signing-Key, der Mirror-PAT und der OPENROUTER_KEY liegen —
  Zurücknehmen: nie; die Anhebung ist Dependabots Aufgabe, nicht die eines
  beweglichen Zeigers.
- Die Gate-Liste steht einmal in `scripts/ci/gates.sh`; ci.yml, release.yml,
  audit.yml und beide Hooks rufen eine BAHN daraus auf — sie stand vorher
  fünffach da und driftete (pre-push `cargo test` gegen CI
  `nextest --profile ci`), und zwei Gates liefen nirgends (`npm run test:hq`,
  die Selbsttests der Workflow-Gates) — Zurücknehmen: nie; eine zweite Liste
  ist die Rückkehr des Problems.
- Ein Workflow-Schritt je BAHN statt je Gate — dann existiert keine Liste im
  YAML, die abweichen könnte: Drift wird unmöglich statt geprüft, und ein
  Drift-Wächter, der selbst falsch sein kann, entfällt; die Aufschlüsselung je
  Gate liefert `::group::` plus die Job-Summary — Zurücknehmen: wenn die
  Schritt-Granularität im Actions-UI je wichtiger wird als die Fehlerfreiheit
  der Verdrahtung.
- `red-first` baut Merge-Base und Kopf in GETRENNTE, aber stabile
  Verzeichnisse (`src-tauri/target` und `src-tauri/target-red-first-base`) und
  überschreibt ein von außen gesetztes `CARGO_TARGET_DIR` — ein geteiltes
  Verzeichnis ließ den Kopf-Lauf das Binary der Merge-Base ausführen
  (gemessen: „Finished in 0.02s", Backtrace auf `.../base/src-tauri/...`), der
  Test war „am Kopf rot", obwohl der Code grün ist; stabile Pfade halten die
  549 Abhängigkeiten über Läufe hinweg warm (158s → 42s) — Zurücknehmen: nie
  das Trennen; das Warmhalten, sobald cargo den Paketpfad in den
  `-C metadata`-Hash aufnimmt.
- `red-first.sh --plan` entscheidet vor der ~4-minütigen Toolchain-Installation,
  ob es überhaupt Belege gibt — kein paths-ignore-Verwandter: das Gate wertet
  seine EIGENEN Eingaben aus und protokolliert das Ergebnis, und der
  Trailer-Formcheck läuft mit, sonst wäre ein Commit ohne Trailer ein stilles
  `count=0` — Zurücknehmen: wenn der Plan-Modus je etwas anderes zählt als der
  Lauf selbst.
- `release.yml` bekommt `environment: release` — der Job hält Signing-Key und
  Mirror-PAT und wird von einem Tag-Push ausgelöst, den jeder mit Push-Recht
  machen kann (dieselbe Klasse wie der review.yml-Befund vom 06.09.); wirksam
  erst mit Required Reviewers in Settings > Environments — Zurücknehmen: nie.
- Der Windows-Job bleibt vorerst auf jedem PR (Nutzer-Entscheidung 09.09.):
  erst die red-first-Befunde umsetzen und neu messen, dann die Kürzungsfrage
  stellen — eine Kürzung spart Minutenäquivalente je Push, verschiebt
  die Windows-Regression aber hinter den Merge — Zurücknehmen: entfällt, die
  Entscheidung ist die Vertagung selbst.
- **Die Windows-Kürzung ist ENTSCHIEDEN: sie kommt nicht** (Nutzer-Entscheidung
  09.09., nach zwei Messungen) — zwei CI-Läufe desselben Codes auf PR #39
  streuen so stark, dass sie keine Entscheidung tragen: `gates (windows)`
  1246s → 546s (0,44x), `gates (linux)` 546s → 674s (1,23x), `red-first`
  68s → 508s (7,47x), Summe 51,8 → 37,9 Minutenäquivalente. Der Windows-Anteil,
  an dem die Frage hing, springt damit zwischen 80 % und 48 %. „Kalt gegen
  warm" war die falsche Achse; was dominiert, ist Laufzeitstreuung. Und der
  Job ist das Einzige, was eine Windows-Regression VOR dem Merge sichtbar
  macht — dafür eine streuende Zahl einzutauschen wäre ein schlechter Handel —
  Zurücknehmen: wenn die Actions-Minuten knapp werden; dann aber mit einer
  Messreihe über mehrere reelle PR-Läufe, nicht mit einem Einzelwert.
- **Offen und ausdrücklich nicht als „Flake" abgelegt:** im warmen Lauf brauchte
  `red-first` 459s im Bootstrap (`setup-linux`) bei 7s Gate-Laufzeit, während
  dieselbe Composite Action im Job `gates (linux)` stabil 70s/78s brauchte. Die
  Ursache ist unbekannt; die Roh-Logs mit der Aufschlüsselung innerhalb der
  Action liegen auf einem Blob-Host, den der Egress-Proxy der Cloud-Sitzung
  nicht erreicht — Zurücknehmen: sobald jemand mit Log-Zugriff die Schritte
  innerhalb der Action aufschlüsselt; „Flake" ist keine Ursache, sondern das
  Aufhören zu suchen.
- Der Linux-Belegpfad ist WSL2 mit einem Clone auf ext4, nicht `act` — act
  kann keine windows-latest-Jobs, ignoriert `environment:` (die Secret-Härtung
  von review.yml und release.yml wäre lokal ausgehebelt) und hat kein
  GitHub-OIDC; es beweist Workflow-Syntax, nicht Gate-Äquivalenz, und deshalb
  liegt bewusst keine `.actrc` im Repo — Zurücknehmen: wenn act
  Windows-Container und `environment:` unterstützt.

## 2026-09-08

- Spec-First-Review für Nahtstellen-/Trust-Specs: **vor** der Implementierung
  ein Multi-Anbieter-Spec-Review (2–3 externe Modelle, ~30–40 min, Free-Tier
  reicht) — die F4-Merge-Kandidat-Welle kaufte Befunde wie „Trust-Grant bindet
  `merge_tree_oid` nicht" erst in Code-Review-Runden r6/r13/r15, während ein
  unabhängiges Spec-Review an der 25-zeiligen Spec sie in **einer** Runde fand
  (`.pa/review_f4mc_*.md` vs. `.pa/review_f4_r*.md`); Review-Bandbreite ist der
  belegte Engpass (03.09.) — Zurücknehmen: wenn zwei Spec-Vorreviews in Folge
  nichts finden, was spätere Code-Reviews nicht ohnehin gefunden hätten.

## 2026-09-07

- Live Dev HQ uses a same-origin Node proxy to the loopback Control API, not the
  read-only remote board; the browser never receives the API token — Rücknahme:
  only when the Tauri app exposes an equally private embedded HQ surface.
- Test-Evidence bindet nur bei `behind == 0` und sauberem Checkout (Worktree
  == Merge-Tree); ein echter Runner gegen den Merge-Tree-OID bleibt offen —
  ein Pass auf dem Worker-Baum beweist sonst nichts über den Merge-Baum (§5),
  und ein OID-Checkout-Runner ist ein eigenes Paket — Zurücknehmen: sobald
  der Gate-Lauf gegen einen Checkout des Merge-Tree-OID läuft.
  **Zurückgenommen 09.09.: genau das tut `33477dd` (wegwerfbarer Kandidat per
  `commit-tree` + `worktree add --detach`, validiert gegen den Tree-OID).**

## 2026-09-06

- Arg-mode `--append-system-prompt` bleibt argv (Claude/Scout/Orchestrator);
  File-mode nur wo das CLI ein Prompt-File-Flag hat — Claude hat keines, ein
  Fake-File wäre eine Lüge — Zurücknehmen: sobald Claude ein offizielles Flag hat.

## 2026-09-04

- Review-Evidence in eigener Tabelle `review_evidence`, nicht auf `WorkerRow` —
  Insert-Stellen und F0-Fixtures bleiben unberührt; Legacy-`pass` darf nicht zu
  ready werden — Zurücknehmen: nie in die Worker-Zeile mischen.
- Merge und Freigabe hinter dem Verdict-Token — derselbe Grund wie Learnings:
  der API-Token liegt in einer Datei, die jeder Agent liest — Zurücknehmen:
  nur mit einem anderen Human-Proof, der nicht im Deskriptor steht.
- Scrollback/Drafts: Retention 7 Tage oder 2 MB je Session, nach Archive/Merge
  weg; Verschlüsselung wie der Vault (DPAPI), Drafts nicht als Klartext in SQLite;
  Export nur über die Diagnose-Allowlist, Löschen in Settings — Zurücknehmen:
  erst nach einem belegten Restore-Bedarf, der länger als 7 Tage braucht.
- Session-Restore ist ein expliziter Respawn, keine vorgetäuschte Live-Session —
  PTY überlebt den Prozess nicht — Zurücknehmen: nie vortäuschen.
- Scrollback/Drafts liegen als DPAPI-Dateien unter `session-buffers/`, nicht in
  SQLite — Klartext in `projecta.db` wäre die Policy-Lüge — Zurücknehmen: nur
  mit gleichwertiger Verschlüsselung in der DB und einem roten Leak-Test.
- Produktmodi `reliable`/`cheap`/`review` mappen auf `auto/coding`, `auto/cheap`,
  `auto/review` — OmniRoute-Namen dürfen nicht die Verträge sein; fehlendes
  Review-Combo ist 4xx, kein stiller Fallback — Zurücknehmen: wenn ein belegtes
  unabhängiges Review-Combo denselben Vertrag trägt.
- Queen-Neuanlage über UI/API/CLI ist retired (410 / `pa queen spawn` ohne HTTP);
  bestehende Queens bleiben lesbar — Rev 9 streicht Hierarchie ohne Altbestand
  zu löschen — Zurücknehmen: nur bei belegter Koordinationslast über Orchestrator+Worker.
- `PROJECTA_APP_DATA` legt das App-Datenverzeichnis (DB, Log, Deskriptor) um,
  ohne die Bundle-ID / den Single-Instance-Mutex zu ändern — F8 darf nicht die
  Produktions-Queue öffnen — Zurücknehmen: nie für den Default-Pfad; Override
  bleibt opt-in.
- `pa db restore` ersetzt `projecta.db` durch eine `.pre-migration-*.bak` als
  Dateikopie, nie über `Store::open` und nie über HTTP — Öffnen migriert das
  Bak; der API-Token liegt in einer Datei — Zurücknehmen: nur mit einem
  Offline-Pfad, der das Bak nicht als Live-DB öffnet.
- Cheap-vs-Reliable-Kosten kommen aus OmniRoute-`/api/usage/history` `totalCost`,
  nicht aus dem zeilenweisen Log (`cost_usd` leer) — gleiche Totals sind kein
  Sieg; Spawn bleibt `auto/cheap` — Zurücknehmen: wenn das Log Preise trägt
  oder ein Cutover-Schalter gemessen umgelegt wird.
- `POST /api/projects` und `pa project create` registrieren dasselbe wie IPC
  `create_project` (`ensure_git_repo` + `store.create_project`) — Golden Path
  ohne UI in der isolierten App — Zurücknehmen: nie einen zweiten Create-Pfad.
- `POST /api/projects` braucht das Verdict-Token, außer die App läuft mit
  `PROJECTA_APP_DATA` (F8-Scratch) — der API-Token liegt in einer Datei, die
  jeder Agent liest — Zurücknehmen: nur mit einem anderen Human-Proof.
- `scripts/server/pa-ops.sh` ist der schmale Betriebs-Wrapper
  (`status|preflight|worker-stop`); Stop nur über validierte PID-Datei und
  `PID == PGID`, kein `pkill -f` — Zurücknehmen: wenn O-9 die Vollversion trägt.

## 2026-09-02

- Sourcemaps im Produktions-Build aus — privater Code landete im öffentlich
  verteilten NSIS-Installer — Zurücknehmen: niemals; Debug-Fälle laufen über den
  Dev-Build.
- Dependabot eingeführt (wöchentlich, gruppiert, glib/gtk ausgenommen) — Update-
  Drift war rein manuell, audit.yml deckt nur CVEs — Zurücknehmen: wenn
  Dependabot-PR-Lärm > Nutzen nach 2 Monaten (Regel-Review).
- B2/B3/B1 als offizielle Tauri-Plugins statt Handrollung — Edge-Cases
  (Off-Screen, AppUserModelID) sind der eigentliche Aufwand — Zurücknehmen:
  bei Plugin-Blockaden im CI (Linux-Gate) neu bewerten.
- Redis-Response-Cache abgelehnt — Hit-Rate ≈ 0 (Agent-Prompts enthalten
  Diffs/Timestamps, nie byte-identisch; Provider-Prompt-Caching fängt den
  Gewinn ein) — Wiedervuf: nur bei nachgewiesener identischer-Request-Last.
- Context-Eng (Caveman/RTK) gestrichen — Routing ist nachweislich instabil
  (O-0), keine Baseline messbar — Wiedervuf: bei belegtem Token-Engpass.
- `auto/coding`-Routen-Streuung belegt (Opus↔Gemini pro Request) — Combos erst
  nach R1–R3-Route-Diagnose — Zurücknehmen der Combo-Pläne: falls R3 ergibt,
  dass 400 kein Failover auslöst (dann Root-Cause zuerst).
- `kimi/handover` (29.08., 3607 Z.) archiviert statt gemergt, Idee als Spec
  `docs/superpowers/plans/2026-08-29-handover-provider-neutral.md` — ~170
  Commits hinter main, kollidiert mit Phase-1/2-Schnitten in queue/workers/
  stuck — Wiedervorlage: nach P2-E, als Phase-3- oder Phase-8-Paket.
- Single-Instance-Diff (`tauri-plugin-single-instance`, Worker wk-…-15, 30.08.)
  als `.pa/patches/single-instance-2026-08-30.diff` gesichert, nicht gebaut —
  widerspricht NT-8/P2-E (gewollte Multi-Instanz braucht Deskriptor, kein
  Verbot) — Zurücknehmen: falls P2-E ergibt, dass Multi-Instanz doch verboten
  wird; dann ist der Patch der Startpunkt.
- P2-F läuft lokal als Orca-Worker, nicht auf dem Server — der
  `auto/coding:reliable`-Pool hat w1a/w2 mit „adaptive thinking not supported"
  getötet (O-0 offen), codex fehlt dort — Zurücknehmen: nach O-0 (Modell-Pin +
  Preflight-Voll-Lauf).
- v1.2.4 erst nach P2-C **und** P2-J (P2-A schon ohne Release gemergt) — ein
  Release weniger, Opener-Verdrahtung kommt mit — Zurücknehmen: wenn P2-J
  länger als zwei Tage braucht, dann v1.2.4 mit P2-A+P2-C sofort.
- Dependabot ohne Majors: acht Major-PRs geschlossen (react 19, vite 8, TS 7,
  eslint 10, sqlx 0.9, base64 0.23, getrandom 0.4, windows-sys 0.61),
  `version-update:semver-major` für cargo + npm ignoriert — Majors fassen
  Build-Kette und Nahtstellen an, gehören in Phase 6 als geplantes Paket —
  Zurücknehmen: mit Phase 6, dann einzeln und gegatet.
- Minor/Patch-Gruppen von Dependabot werden lokal gegatet und gemergt (#7
  xterm-Addons, #5 Actions am 02.09.) — dafür ist Dependabot da — Zurücknehmen:
  wenn ein Minor-Bump zweimal Gates bricht, dann Gruppe auf Patch-only.
- `HANDOVER.md` gelöscht, `sync.sh`-mtime-Check entfernt — zwei Übergabe-
  Dokumente drifteten, `STAND.md` + Sanierungsplan sind führend — Zurücknehmen:
  nie; Historie in git.
- Review-Skripte `.pa/review_*.py` und Patches `.pa/patches/*.diff` versioniert
  (`.gitignore`-Ausnahmen) — „Was nur an einem Ort liegt, ist verloren" —
  Zurücknehmen: falls ein Skript je ein Secret braucht (dann Env-Var, nie Datei).
- WIP-Sicherungen `server/omni/w1a` + `omni/w2` werden Basis für O-1, vorher
  Dual-Review — Teilarbeit (store.rs/stats.rs 670 Z.) nicht wegwerfen, aber
  nichts Halbgares als Startpunkt — Zurücknehmen: wenn das Review „verwerfen"
  sagt, dann O-1 frisch aus Spec.
- `backup/wip-*` (28.08.) als Patches gesichert, Branches werden gelöscht —
  Wegwerf-Sicherungen vor einem Cleanup, 320–370 Commits hinter main —
  Zurücknehmen: Patch in `.pa/patches/` anwenden.
- Server-Fleet: neun `jagd/*`-Worker-Einträge + Worktrees entfernt, Zustand in
  `/home/worker/archiv/jagd-2026-09-02.tgz`, `report_doku2.md` ins Repo —
  Liste war nur noch Beleg toter Läufe — Zurücknehmen: Tarball entpacken.
- GitHub-Dependabot-Alert `glib` (RUSTSEC-2024-0429) dismissed als „not used"
  mit KI-9-Begründung — im Windows-Artefakt nicht enthalten — Zurücknehmen:
  sobald ProjectA für Linux ausgeliefert wird.
- P2-J Opener-Scope `https://*` + `http://*` statt GitHub-only-Whitelist (wie
  in der P2-F-Spec vom 01.09.) — openExternal öffnet auch LAN-URLs des
  Web-Interface und Empfehlungs-Links; ipc.ts weist alles außer http(s) vorher
  ab — Zurücknehmen: falls ein Review zeigt, dass Worker-Output den Pfad
  erreicht (dann Allowlist + Bestätigungsdialog).
- P2-F läuft parallel zu P2-J, Dateigrenzen neu gezogen: P2-J = Cargo.toml,
  main.rs, capabilities, ipc.ts; P2-F = CSP, plugin-matrix.md, markdown.ts —
  die Spec vom 01.09. hatte die Opener-Registrierung doppelt — Zurücknehmen: —.
- NT-17-Fix nach v1.2.4, vor P2-D; O-0 (Route-Diagnose) erst, wenn Server-Worker
  gebraucht werden — Phase 2 läuft lokal, Logging aus v1.2.4 macht NT-17
  belegbar — Zurücknehmen: falls NT-17 vor dem Release erneut Arbeit kostet.
- `vitest.config.ts` setzt `NODE_ENV=test` explizit — eine geerbte
  Produktionsumgebung lädt sonst Reacts Production-Build und legt das gesamte
  Testgate lahm — Zurücknehmen: wenn Vitest geerbte Werte selbst überschreibt.

## 2026-09-03

- Cursor-Skill (nicht im öffentlichen Repo): Cursor plant, Claude-Worker
  führen aus — das Abo soll die Hands tragen, Cursor nur das Orchestrieren —
  Zurücknehmen: wenn die Abo-Quota die Hands nicht mehr trägt oder OmniRoute/
  OpenCode wieder Default-Hand sein soll.
- Produktachse auf Aufgabe → Agent/Worktree → Attention → Review → Merge
  begrenzt — neun konkurrierende Hauptsichten verdeckten den Golden Path —
  Zurücknehmen: wenn Nutzungsmessungen eine fehlende eigenständige Sicht zeigen.
- Aktive Agentenarten auf Orchestrator und Worker reduziert; Scout wird Preset,
  Queen/Employee nur historische Daten — 3–5 Agenten brauchen keine Hierarchie —
  Zurücknehmen: bei belegter Koordinationslast jenseits einer flachen Ebene.
- Design Studio aus ProjectA entfernen — Website-Gestaltung trägt nicht zum
  Worktree-/Review-Kern bei — Zurücknehmen: nie im selben Produkt; ggf. Fork.
- Single-Instance ersetzt den Rev-8-Multi-Instanz-Deskriptor — atomare Queue-
  Claims halten, doch API-Deskriptor/Ingester/Reattach hätten mehrere Owner —
  Zurücknehmen: bei belegtem Bedarf an getrennten schreibenden Prozessen.
- OmniRoute auf `reliable`, `cheap`, `review` begrenzen — ein allgemeiner
  Combo-Editor macht ProjectA zur Router-Konsole — Zurücknehmen: wenn feste Modi
  einen gemessenen Routingbedarf nicht ausdrücken können.
- Remote-Board-Ausbau, globale Suche, Fokusmodus, Prompt-Kompression und
  allgemeine MCP-Injektion zurückgestellt — Review/Attention ist der Engpass —
  Zurücknehmen: einzeln, nur mit Nutzungsmessung und eigener Akzeptanz.
- Struktur wird bei Berührung inkrementell getrennt, ohne Merge-Sperre; `lib.rs`,
  `ts-rs` und Codegen brauchen einen roten Drift-Beleg — Big-Bang-Umbau blockiert
  Produktnutzen — Zurücknehmen: nur bei unteilbarer, belegter Strukturmigration.
- Task nutzt zunächst Queue→Worker-Alias statt neuer Tabelle — bestehende IDs,
  Direktstarts und Respawns bleiben kompatibel; `spawned_by` ist nur Akteur —
  Zurücknehmen: roter Deep-Link-/Recovery-Test verlangt echte Task-Identität.
- Review trennt Lifecycle von `blockers[]`; Freigabe und Tests binden an Worker-
  HEAD/Base/Tree plus Policy/Akzeptanz und geschützte Autorität — sonst ist
  `ready` selbstprägbar/stale — Zurücknehmen: nie; nur Schema darf wechseln.
- Scout bleibt intern eigener Root-/Ingest-Lifecycle, erscheint aber als Preset —
  gewöhnlicher Worker könnte `.pa-scout.jsonl` und Branchlosigkeit nicht abbilden —
  Zurücknehmen: mit sicherem, migrationsbelegtem Worker-Empfehlungskanal.
- Design-Studio-Editor geht, `landing_page_markdown` bleibt read-only/exportierbar
  — Entfernen darf bestehende Nutzerdaten nicht verwaisen — Zurücknehmen: bei
  expliziter Löschentscheidung nach verifiziertem Export.
- Agentenerzeugte URLs erzwingen neue Domain-/Bestätigungsprüfung — Empfehlungen
  erreichen `openExternal`, daher ist allgemeines HTTP(S)-Scope kein Endbeleg —
  Zurücknehmen: nur wenn Datenfluss technisch unmöglich und per Test gesperrt ist.
- Nur Specs mit `Status: aktiv` und Listung in `STAND.md` sind ausführbar —
  Rev-8-Specs widersprechen Single-Instance und Evidence-Readiness —
  Zurücknehmen: wenn ein maschinengeprüftes Spec-Manifest dieselbe Grenze ersetzt.
- Setup-Trust bindet Repo, Befehl, Base-SHA und ausführbare Inputs — gleicher
  Text kann über geänderte Lifecycle-Scripts anderen Code starten —
  Zurücknehmen: nur für bewusst breit vertraute Repos mit gleichwertiger Warnung.

## 2026-09-04

- Spec-Status-Gate als Skript statt Konvention (`scripts/spec-status-check.mjs`,
  in `npm run build`) — 77 Rev-8-Specs lagen ohne Statuszeile in `.pa/` und lasen
  sich alle wie ein gültiger Auftrag — Zurücknehmen: nie; ersetzt die am
  03.09. angekündigte Manifest-Grenze.
- F0-Abnahme auf drei DB-Generationen erweitert (0→2, 1→2, 2→2) statt nur
  v1.2.4 — eine v1.2.4-DB steht schon auf dem Zielstand, der Lauf steigt früh aus
  und beweist nur „liest zurück" — Zurücknehmen: wenn eine Migration je einen
  Bestand rückwärts anfasst (dann ist mehr nötig, nicht weniger).
- Ein Overlay ohne Verhalten wird nicht angezeigt — `defaultProfileId`, `active`
  und `webPort` werden gespeichert und von keinem Startpfad gelesen; benannt im
  neuen UI wären sie eine sichtbare Lüge — Zurücknehmen: nie; entweder
  verdrahten oder entfernen.
- Landing-Page-Export-Button wird auf Rohtext korrigiert, **bevor** der Editor
  geht — er kopiert heute die HTML-Projektion, der einzige verlustlose Weg ist
  das CLI — Zurücknehmen: nur wenn ein UI-Export ganz entfällt.
- Merge wandert hinter den Verdict-Token — der API-Token liegt in einer Datei,
  die jeder Agent lesen kann; die Modul-Doku begründet den zweiten Token selbst
  damit — Zurücknehmen: nie, solange Agenten den Deskriptor lesen können.
- Neue Abhängigkeit `tauri-plugin-single-instance` (2.4.4, Desktop-Target-Filter)
  — es gibt eine `projecta.db` und einen 30-Sekunden-Dispatcher, ein zweiter
  Prozess ist also ein zweiter Dispatcher auf demselben Bestand und ein zweites
  `projecta-api.json` unter dem `pa` der ersten Instanz — Zurücknehmen: nur wenn
  Bestand, Dispatcher und Deskriptor prozessübergreifend verriegelt sind.
- Der Guard ist ausschließlich das Plugin, kein eigener Mutex/Lockfile daneben —
  das Plugin gibt Mutex und Fenster auf `RunEvent::Exit` frei und weist eine
  zweite Instanz nur ab, wenn es *beides* findet; ein Lockfile überlebt einen
  harten `process::exit` und würde genau den Updater-Relaunch abweisen —
  Zurücknehmen: nie ohne gleichwertigen Fail-Open-Beleg (Test
  `nothing_guards_startup_beside_the_plugin`).
- Registrierung als **erstes** Plugin am Builder statt in `.setup()` — Plugins
  werden am Ende von `Builder::build` in Registrierungsreihenfolge initialisiert,
  die Setup-Closure erst beim `Ready`-Event und damit *nach* dem Bau des
  `main`-Fensters; später registriert malt der überflüssige Prozess erst ein
  zweites Fenster samt WebView2 — Zurücknehmen: nie; der Platz ist der Zweck.
- Development HQ als statische, dateigenerierte Site unter `docs/dev-hq/`
  (`npm run hq`), nicht in `npm run build` und nicht in `src/` — der Mensch
  braucht eine belegte Übersicht über Specs, Lanes und Proof, ohne die
  Produkt-UI oder das Remote-Board zu klonen — Zurücknehmen: wenn STAND+aktive
  Specs durch ein anderes lebendes Register ersetzt werden, oder sobald die
  Site Produktchrome (F2-Ziele, Variant B) nachbildet.
- HQ-Map: Paket-IDs matchen am Prefix mit Token-Grenze (`:` / Space / `-`);
  nacktes `F6:` belegt `F6-UI`, weil es keinen DAG-Knoten `F6` gibt —
  Zurücknehmen: sobald `PACKAGE_EDGES` einen eigenen F6-Knoten hat.
- Drei eingecheckte DB-Generationen unter `src-tauri/testdata/db/` statt nur
  v1.2.4 — ein Test gegen die aktuelle Version beweist „liest zurück", nicht
  „migriert verlustfrei" — Zurücknehmen: wenn `user_version` einen weiteren
  Schritt bekommt, Generator neu laufen.
- Diagnosepaket ist eine getypte Feld-Allowlist, danach Strip bekannter
  Produkt-Secrets, danach `redact` — Heuristik allein ist kein Beleg, und
  Freitext eines Agenten ist kein Diagnosefeld — Zurücknehmen: nie für Keys;
  Allowlist nur erweitern mit Canary-Zelle.
- `GET /api/diagnosis` und `pa diagnosis` liefern nur Logpfad plus Panic-Flags,
  nicht das Paket — ein Agent mit API-Token soll keine Logauszüge mitnehmen —
  Zurücknehmen: wenn Diagnose bewusst ein Agentenwerkzeug wird.
- F2-Navigation zuerst als klickbarer Entwurf unter `docs/ia/index.html` —
  sechs Ziele prüfen, bevor `App.tsx` die neun Sichten verliert — Zurücknehmen:
  sobald der Umbau in der App denselben Vertrag trägt.

## 2026-09-06

- Vitest-V8-Coverage 4.1.11 plus Playwright 1.62.1 als T-3-Testschicht —
  Coverage wird auf alle Produktions-TS/TSX-Dateien geratscht und der echte
  Browser bootet über Tauri `mockIPC` — Zurücknehmen: mit T-4 durch strengere Gates ersetzen.

## 2026-09-03 (Befragung der Claude-Web-Sitzung, 16 Antworten)

- Halbtags-Kalibrierung: begrenzte Wochenstunden, gedeckeltes API-Budget, Scheiben à ≤30 h
  — der Wochenplan Rev 5 (2–2,5 Stränge) war nie Realität — Zurücknehmen: wenn
  drei Scheiben in Folge unter 20 h bleiben (dann kleinere Scheiben).
- Struktur-Light (lib.rs, store-Split, eprintln→logf, CoreError) als Scheibe 2
  vor jeder Feature-Phase — ohne lib.rs keine Integrationstests, Nahtstellen-
  Lane ist Symptom — Zurücknehmen: nie; Umfang darf schrumpfen, Reihenfolge nicht.
- NT-17-Nachlauf als Regressionstest **und** Zustell-Queue mit `pa worker
  done|blocked` — zwei Zustellpfade mit verschiedenen Garantien sind die
  Wurzel — Zurücknehmen: wenn Z-1 zeigt, dass der Marker-Fix allein 20/20 trifft
  (dann Queue kleiner, Selbstmeldung bleibt).
- Externe Plan-Reviews nur über `REVIEWER_n_*`-Umgebungsvariablen (OpenRouter),
  Schlüssel nie im Repo — GitGuardian hat einen PEM-Header in einem Test-Sketch
  geflaggt, Historie musste umgeschrieben werden — Zurücknehmen: nie.
- Linux-CI komplett (ubuntu-Job, paths-ignore, nextest), Windows-Job nur
  cfg(windows)+Release — 57 % Doku-Commits lösten Windows-Läufe aus, Linux-
  Regressionen kamen erst auf dem Server hoch — Zurücknehmen: wenn CI-Minuten
  das Kontingent sprengen (dann Linux nur auf PR).
- Server bleibt Worker-Host (gegen Empfehlung der Analyse) — Nutzerentscheidung
  — Bedingung: O-0 (Modell-Pin + Preflight auf echtem Worker-Pfad) vor jedem
  Dispatch; Zurücknehmen: falls O-0 zweimal in Folge rot.
- Strang O auf O-0 + O-9 gekürzt, `claude-code-router` als 2-h-Trial — O-1…O-8
  setzen stabilen Transport voraus, der fehlt (B-R2) — Wiedervorlage O-8: nach
  4 Wochen grünem O-0.
- Doku-Diät: fünf lebende Dateien (AGENTS, STAND ≤150, SANIERUNGSPLAN,
  decisions, ACTIVITY), Rest nach `docs/archive/2026-09-03/` — zwei Fassungen
  derselben Wahrheit drifteten (Doku-Audit, 10 Befunde) — Zurücknehmen: nie;
  neue lebende Datei nur per Eintrag hier.
- Dual-Review nur für Nahtstellen, Migrationen, Pläne; sonst ein Reviewer ≠
  Autor — Review-Overhead 15–25 % bei halbtags; Befunde ohne Nahtstelle meist
  formal — Zurücknehmen: wenn ein Einfach-Review-Paket einen Kern-Bug in main
  bringt (dann Dual für dessen Modul).
- TDD-Schichten a+b sofort (Hook, Zwei-Commit-Protokoll mit Trailern,
  Pre-Commit, CI red-first), c später (Coverage-Ratsche, mutants --in-diff) —
  „roter Test zuerst" war Regel ohne Gate — Zurücknehmen: Schicht b, falls
  die Trailer >20 % der Commits als `No-Test:` markieren (dann Regel prüfen).
- Skills im Task-Text für alle Anbieter + superpowers/ponytail als Plugins,
  Dialekte aus echten Captures — Kimi kann keine Plugins, Heuristiken ohne
  Fixtures brechen still (NT-17) — Zurücknehmen: Plugins, wenn sie
  `CONNECT_TIMEOUT`-Hänger verursachen.
- hermes-agent: Konzepte jetzt (Usage-JSON, Hook-Wire-Format, Skill-Trust) +
  2-h-Spike, Vollintegration nach Struktur-Light — Python-3.11-Runtime und
  fehlendes `--system-prompt` sind Integrationskosten — Zurücknehmen: wenn der
  Spike keinen Oneshot-Lauf mit `--usage-file` schafft.
- Alle vier Feature-Gruppen aus dem Wettbewerb (Setup/Teardown-Hooks,
  CI-Status + Konflikt-Vorschau, Reviewer-Agent ≠ Autor, Toasts + Stall→Retry
  + Cron) in S6/S7 — Review-Bandbreite ist der belegte Kategorie-Flaschenhals —
  Zurücknehmen: einzeln, wenn ein Paket seine Schätzung >100 % überzieht (M15).
- Design-Entwürfe (macOS/„apple", ui-variants) gesichert und archiviert — kein
  Design-Paket vor S8+ — Wiedervorlage: Designschuld-Scheibe.
- Dependabot-Majors einzeln nach Struktur-Light: Vite 8 → eslint 10 → TS 7 →
  React 19 → sqlx 0.9 → windows-sys — jede Major ist ein eigener Fehlerraum —
  Zurücknehmen: nie gebündelt.
- Loopback als Netz-Default, LAN nur hinter Tailscale/SSH;
  `tauri-plugin-single-instance` als Warnung mit Instanz-Deskriptor, kein
  Verbot — Slowloris-Befund (F-SEC-1) und gewollte Multi-Instanz (NT-8) —
  Zurücknehmen: LAN-Modus ganz streichen, falls H-1 nicht reicht.
- Nachtläufe ja, nach NT-17-Paket + Gates-Automation, gekappt durch
  `max_iterations` + Budget-Deckel — ohne Selbstmeldung und Kill-Mechanik
  (K-2) wären sie Doppel-Agenten-Generatoren — Zurücknehmen: nach einer Nacht
  mit Budgetüberschreitung >2×.

## 2026-09-03 (abends, Rev 9.1 nach drei externen Reviews)

- Test-First-Beweis in CI gegen die Merge-Base (`red-first`), Trailer nur noch
  Deklaration, Squash erlaubt — pre-commit kennt die Commit-Nachricht nicht,
  SHAs in Trailern sterben beim Rebase (Gemini G-01/G-06, Kimi K-20) —
  Zurücknehmen: wenn `red-first` je PR länger als 10 min läuft (dann nur
  geänderte Crates).
- Scheiben auf ≤25 h netto + ~5 h Review gedeckelt, Aufwände ST-1/ST-5/Z-2/H-3/
  P2-E/R-1 angehoben, 12 Scheiben ≈ 22 Wochen bei 15 h/Woche — drei Reviewer
  hielten 28–30 h ohne Puffer für unhaltbar (G-16, D-8, K-3/K-8) — Zurücknehmen:
  wenn drei Scheiben in Folge unter 20 h Ist bleiben.
- Nachtläufe mit festem Kostendeckel pro Nacht und Monat, Deckel im Skript — ein höherer Deckel hätte
  das Monatsbudget gesprengt (G-02, K-1) — Zurücknehmen: bei belegtem Nutzen
  und höherem Budget (Q1 neu stellen).
- Nahtstellen-Lane bleibt für `api.rs`/`workers.rs` bis ST-6 — 5 121 und 4 893
  Zeilen bleiben Monolithen nach S2 (G-03/G-21) — Zurücknehmen: nach ST-6.
- Headless-JSON-Streams als Primärpfad abgelehnt (G-19) — das interaktive
  Terminal ist das Produkt; Oneshot-Pfad existiert — Wiedervorlage: Nachtläufe
  mit Headless-Profilen, wenn N-1 Zustellprobleme zeigt.

- `paths-ignore` (`**.md`, `docs/**`, `.pa/**`) bleibt auch am
  `pull_request`-Trigger, obwohl es dort nur doku-only PRs spart — `main` ist
  unprotected, ein übersprungener `gates` kann also keinen PR blockieren
  (gemessen 03.09.) — Zurücknehmen: sobald `gates` ein Required Check wird;
  dann Filter beim PR-Trigger entfernen oder No-op-Job mit gleichem Namen.

- Windows-CI läuft die **ganze** Rust-Suite, nicht einen Namensfilter auf
  `cfg(windows)`-Tests — die 8 echten heißen `run_in_pty`, `npm_shim`,
  `spawns_a_cmd_shim_through_comspec` …, der geplante Filter hätte fast keinen
  getroffen und der Job wäre grün durch Abwesenheit gewesen (gemessen 03.09.)
  — Zurücknehmen: wenn ein verlässliches Auswahlkriterium existiert, etwa ein
  eigenes `#[cfg_attr(windows, ignore)]`-Muster oder ein Test-Feature-Flag.
- Gespart wird auf Windows an den Gates, die dort nichts beweisen (npm ci,
  fmt, typecheck, Frontend-Tests, lint) — Windows-Minuten kosten doppelt, und
  diese Gates sind plattformneutral — Zurücknehmen: wenn ein Frontend-Fehler
  auftritt, den nur Windows zeigt (dann Frontend-Gates dort zusätzlich).
- `Test-First`-Commits bringen die Hilfsfunktion im Status quo mit, wenn Test
  und Hilfe in derselben Datei liegen — ein Test, der nur am Build scheitert,
  macht `git bisect` unbrauchbar — Zurücknehmen: nie; ein fehlender Test bleibt
  gültiger roter Zustand, nur zweite Wahl.
- Job-Namen in `ci.yml` bleiben ab jetzt stabil (`gates (linux)`,
  `gates (windows)`) — `Swatinem/rust-cache` schlüsselt nach Job-Namen, die
  Umbenennung am 03.09. hat den Rust-Cache beider Plattformen entwertet und
  den ersten Lauf auf 17 min getrieben — Zurücknehmen: nur mit bewusstem
  Cache-Verlust und Notiz im Commit.
- Die Unix-Zusicherung „der Hintergrundjob hat den Timeout nicht überlebt"
  wartet den Zustandswechsel gepuffert ab (3 s, 20-ms-Takt), statt ihn einmal
  zu behaupten — `kill -9 -- -pgid` ist asynchron, und `await_drains` kehrt beim
  EOF der Pipe zurück, also bevor der Job den Zustand `Z` erreicht (gemessen:
  1,0–5,1 ms statt der 500 ms DRAIN_GRACE, Job stirbt ~1,1 ms nach dem
  Messpunkt) — Zurücknehmen: wenn `run_command_with_timeout` selbst auf den
  Gruppentod synchronisiert; dann ist die Schleife überflüssig, nicht falsch.
- Kein `| tee` und keine andere Pipe schreibt nach `$GITHUB_OUTPUT` oder
  `$GITHUB_ENV` — GitHub startet `run:` als `bash -e {0}` **ohne** `pipefail`,
  der Status ist der des letzten Glieds; in `review.yml` hätte das einen
  gescheiterten Modell-Resolver in einen grünen Zwei-von-drei-Lauf verwandelt —
  Zurücknehmen: nie; die Regel ist als Gate in `ci.yml` verdrahtet.
- `paths-ignore` ist aus `ci.yml` ersatzlos entfernt — die Rücknahme der
  Entscheidung vom 03.09., und zwar unter genau der Bedingung, die dort notiert
  war. Es hat in einem einzigen PR zwei Gates blind gemacht: `**.md` und
  `.pa/**` sind die Eingaben von `spec-status-check.mjs`, und `red-first` aus
  #31 wäre bei einem doku-only-PR übersprungen worden. Der eigens gebaute
  Umweg `specs.yml` entfällt damit wieder — Zurücknehmen: wenn die
  Actions-Minuten knapp werden und ein Filter gefunden ist, der nachweislich
  keine Gate-Eingabe enthält; dann mit Liste der Eingaben je Gate, nicht nach
  Dateiendung.
- `scripts/flake.sh` prüft seine Eingaben, bevor es misst (positive Ganzzahl,
  Filter trifft mindestens einen Test) und nimmt die Zahl der tatsächlich
  gelaufenen Durchgänge in die Exit-Bedingung auf — ein Nachweis über null
  Läufe ist kein Nachweis — Zurücknehmen: nie.
- Ein Test für `scripts/review/resolve_models.py` ist Folgearbeit, nicht Teil
  von PR #29 — er braucht eine eingefrorene `models.json` als Fixture, und ein
  Fixture-Paket gehört nicht als Anhängsel in einen Merge — Zurücknehmen:
  sobald jemand die Auswahlregeln ändert; dann zuerst der Test.
- `review.yml` hat **keinen `push`-Trigger** mehr, nur noch `workflow_dispatch`,
  dazu `permissions: contents: read`, kein Commit-Schritt und ein
  `environment: review` — der externe Dual-Review zu PR #29 hat konvergent
  gezeigt, dass der Push-Trigger eine Rechte-Eskalation war: der Workflow lief
  aus dem gepushten Commit, also konnte jeder mit Push-Recht
  `review_transport.py` praeparieren und `$OPENROUTER_KEY` samt schreibendem
  `GITHUB_TOKEN` abziehen — Zurücknehmen: nie ohne Environment mit Required
  Reviewers vor dem Secret; der Komfort eines Push-Triggers wiegt einen
  Schlüssel nicht auf.
- Der Detektor gegen maskierte Exit-Codes liegt als Skript in `scripts/ci/`
  statt als `grep` im Workflow und hat einen Selbsttest mit sechs Fällen —
  inline hätte er seine eigene Definition gefunden, und sein erstes Muster
  hätte `echo "x=$(a | b)" >> "$GITHUB_OUTPUT"` fälschlich abgelehnt, also
  genau das rote Rauschen erzeugt, das er verhindern soll — Zurücknehmen: nie;
  ein Gate ohne Falsch-Positiv-Test ist unbelegt.
- Die Gates im Linux-Job laufen billig → teuer (fmt, typecheck, lint,
  Frontend-Tests, Build, Browser-Smoke, clippy, nextest) — ein kaputtes
  Frontend soll nicht erst nach der ganzen Rust-Suite sichtbar werden, und seit
  das Actions-Kontingent aufgebraucht ist, zählt jede Minute doppelt —
  Zurücknehmen: wenn ein Gate von einem späteren abhängt.
- Der Zombie-Test ist `cfg(target_os = "linux")` statt `cfg(unix)` — er wartet
  auf `Z` in `/proc/<pid>/stat`, und procfs gibt es auf macOS und den BSDs
  nicht; dort wäre er nach 5 s rot mit der irreführenden Meldung, das Kind habe
  den Zombie-Zustand nie erreicht — Zurücknehmen: wenn der Test seinen
  Zustand plattformneutral erfragt.
- `web_interface.rs` behält vorerst das Toleranzfenster `60..=65` statt einer
  injizierten Uhr — beide externen Reviewer nennen das Symptombekämpfung und
  haben recht; der saubere Fix ist eine einspeisbare Zeitquelle im
  Board-Aufbau und gehört als eigenes Paket in F3, nicht als Anhängsel in
  diesen Merge — Zurücknehmen: sobald der Test erneut flackert; dann die Uhr,
  nicht das nächste Band.
- `SkillsDiscovery` bekommt `ConventionAt { dir }`, und `skills::skills_path_for`
  wird die einzige Stelle, die ein Ziel für die Packs bestimmt — die
  Codex-Familie liest Repo-Skills aus `<projekt>/.agents/skills`
  (`AGENTS_DIR_NAME`/`SKILLS_DIR_NAME` in openinterpreters
  `codex-rs/ext/skills/src/host_roots.rs:23-24`, benutzt in
  `repo_agents_skill_roots` 146-152), nie aus `.claude/skills`; bis dahin war
  ein solcher Agent nur als `Unsupported` beschreibbar und bekam gar nichts,
  obwohl er liest. Der Pfad aus `agents.json` ist Nutzereingabe und wird
  abgewiesen statt zurechtgebogen, wenn er den Worktree verlässt — `install`
  ruft `remove_dir_all` — Zurücknehmen: wenn alle unterstützten CLIs sich auf
  ein Verzeichnis einigen; dann wieder eine Konvention statt einer Variante.

- 2026-09-10: DEV-HQ Live adds scoped workspace.js/css and optional profile.briefing metadata.
  Existing DOM/API bindings are retained; briefing fields document intent without inventing CLI capability flags.
  Revisit when a real team scheduling model or typed provider effort contract replaces profile grouping.

- 2026-09-10: HQ v1 planning state lives in Rust/SQLite; Node only hosts and proxies it.
  Atomic fenced claims and shared context avoid a competing website task database; execution remains disabled pending acceptance.
  Revisit the API version when executable scheduling, scoped credentials, and run evidence are implemented.

- 2026-09-11: Freeze development policy per root in SQLite, including the deadline
  shared by replans. Store candidate-bound evidence separately from authority:
  caller labels never establish reviewer independence. Reverse only with a versioned
  migration preserving consumed budgets and a trusted principal verifier.
- 2026-09-11: The external recovery journal uses OS file locks plus revision checks,
  requiring Rust 1.89. Process exit releases the lock without deleting its inode.
  Keep installer hashes distinct from installed binary identity and resume writes
  before stable promotion. Revisit only with tested equivalent crash guarantees.
- 2026-09-11: Rust and HQ consume the same versioned built-in profile manifest.
  A normalized-LF SHA-256 distinguishes matching compiled defaults from checkout
  previews; source-code regexes included test fixtures and omitted capabilities.
  Revisit if the core exposes complete safe profile definitions over the API;
  keep credentials and runtime capability attestations outside this manifest.
- 2026-09-11: Token accounting belongs to the frozen root policy and SQLite ledger.
  Reserve before work, retain unknown usage, protect verification and consume
  worker allocations atomically with launch; replans cannot reset these totals.
  Revisit the initial 200k/40k limits after the fixed-task measurement set;
  changing configuration never rewrites an existing root's frozen allowance.
- 2026-09-11: Scoped evidence/review pages use an explicit SQLite insertion
  sequence, backfilled in migration 11 and maintained by transactional triggers.
  This preserves traversal boundaries across backdated observations, retries,
  restart and VACUUM while exposing current invalidation. Revisit before adding
  record deletion or retention compaction; never silently recycle cursor positions.
- 2026-09-11: New continuous claims use a physical-memory admission signal:
  below512MiB/5% zero new claims, below2GiB/15% one, otherwise two; either
  absolute or relative threshold reduces capacity. Unknown values allow at most
  one and remain marked unavailable. Sample under the claim writer lock and
  retain existing ownership. Revisit thresholds using measured workload/recovery
  outcomes; this signal does not represent CPU/GPU/container limits or authorize
  starting workers without the remaining routing and execution gates.
- 2026-09-11: The capture-host suspended diagnostic uses native CreateProcessW
  with an explicit application path, CREATE_NO_WINDOW, a retained primary-thread
  handle and a pre-creation job-list attribute. Standard Command spawn does not
  expose that full contract at our MSRV. Keep this adapter confined to the host;
  ordinary process creation still uses proc::command. Revisit when a supported
  runtime abstraction provides those guarantees. Diagnostic success does not
  authorize resume, provider execution or automatic admission.
- 2026-09-12: Candidate ownership is measured against the immutable checkout
  HEAD observed by the backend before the worker process starts. A moving base
  branch cannot conceal changes by absorbing them upstream. Rewrites and base
  merges that introduce out-of-scope changes are refused; use a new authorized
  task scope instead. Git diff must expose both rename sides and ignored
  submodule gitlinks. Revisit only with a verified contribution model that
  retains the same ownership and exact-candidate guarantees. Scope verification
  itself does not establish tests, independent reviews, or merge authority.
- 2026-09-12: The native parent/host diagnostic uses the existing held-image and
  pre-creation Windows Job adapter for both process boundaries. Wire JSON may
  exceed the raw 1 MiB provider ceiling only by a fixed encoding allowance;
  strict decoding follows owned-host exit/pipe/cleanup checks. This reuses one
  native lifecycle implementation while the full streaming adapter is built.
  Replace the final batch reply with reviewed streaming/acknowledgement framing
  before operational reserved-run activation; a diagnostic success is not a
  durable delivery receipt or recoverable usage authority.
- 2026-09-12: Session ownership uses one registry through reservation, startup
  and interactive execution. Unknown inventory and uncertain native waits must
  not authorize idle updates. Keep pending entries until confirmed cleanup;
  failed snapshots reject at IPC rather than returning an empty array. Extend
  this same registry for batch drain/persistence and backend maintenance locking;
  do not turn the snapshot guard into a second admission system.
- 2026-09-12: Manual installation downloads signature-verified bytes before
  atomically closing session admission through the existing registry mutex.
  Once the installer is invoked, retain the latch on error or panic until
  process restart because replacement may already have begun. Remove direct
  frontend installer capabilities to keep one guarded path. Revisit latch
  recovery only with the verified binary/database recovery protocol; this
  session guard does not supply that protocol or a database maintenance lock.
- 2026-09-12: Schema 17 commits a process-attempt identity before scoped spawn
  and a single-use prompt digest before PTY task enqueue in the existing store.
  Preserve unknown legacy identities; distinguish enqueue from native delivery
  completion. FULL synchronization is required. After schema changes retire the
  startup connection pool before publishing Store to avoid stale column metadata.
  Revisit the transport states when the native host is integrated, retaining
  exact attempt binding, no ambiguous redelivery and the shared session registry.
- 2026-09-12: The native reaper awaits critical exit/credential bookkeeping and
  retains a Retiring registry entry during owned resource release or on failure.
  No registry mutex spans that work. This acknowledgement does not cover
  independent readers or best-effort logging/scrollback. Extend the same gate
  with explicit drain/maintenance acknowledgements before automated updates;
  never infer complete drain from the core bookkeeping result alone.
- 2026-09-12: Include the translated-profile digest in the immutable route and
  compare the complete prepared/stored receipt before session consumption. Keep
  raw profile credentials out of receipts and fail closed on legacy bindings.
  The digest stops at worktree/session overlays; extend with separate native
  invocation evidence when integrating batch transport, without relabeling this
  prepared-profile observation as final runtime provenance.
- 2026-09-12: Hand native lifecycle checkpoints to a separate owner through four
  ordered one-use response lanes. Native callbacks only try_send/try_recv so
  storage latency cannot suspend pipe draining or deadline checks. Delay input
  and terminal ACK until the corresponding owner responses. Integrate durable
  writes and actor lifetime in the existing store/session registry; private
  request payloads and provisional receipts must not become public evidence or
  final settlement before native EOF and cleanup are confirmed.
- 2026-09-12: Persist native checkpoint acknowledgements through a single-use,
  deadline-bound owner in the authoritative store. Serialize stage/claim/route
  validation, evidence and cursor notification before acknowledging. Keep only
  provisional metadata and hashes; do not recover authority from a stored row.
  Owner closure is a write barrier, not actor drain or native cleanup. Extend
  this consumer in the common session registry before batch activation; reverse
  the storage shape only with equivalent fencing and privacy evidence.
- 2026-09-12: Compile the shared native capture implementation once in the
  projecta_capture library. Both binaries use identical types, and low-level
  tests have one owner instead of ambiguous aliases. Keep SQLite and managed
  session lifetime in the app. The common registry retains native inventory
  through actor join, durable closure and final handling; aggregate simultaneous
  failures rather than hiding cleanup uncertainty. Extend provider routing and
  final accounting before activation, retaining these ownership boundaries.
- 2026-09-13: Share signed native resource verification through projecta_capture
  so the packaging host and app cannot drift into separate trust implementations.
  Build with source identity before signing host bytes, then bundle separately
  and verify unchanged inputs. MSI inventory remains separate from payload and
  installed acceptance. Reverse this arrangement only with equivalent compiled
  trust binding, shared validation and proof that packaging preserves signed bytes.
- 2026-09-15: `@xterm/addon-webgl` hart auf 0.18.0 gepinnt (kein Caret) und
  zusammen mit `@xterm/xterm` aus Dependabot genommen — 0.19 erwartet
  xterm-5.6-Interna und stürzte mit dem installierten xterm 5.5 reproduzierbar
  ab (`_isDisposed`, BUGS.md 14.09.); die Minor-Gruppe hätte den Bump erneut
  eingeschleppt — Zurücknehmen: als geplantes Major-Paket, wenn xterm und
  Addon gemeinsam gehoben und die Terminal-Ansicht mit laufendem Worker
  belegt ist.
- 2026-09-15: `tsconfig` `lib` auf ES2022 (Target bleibt ES2021) und
  `@types/node` auf ^24 passend zu `engines.node >=24` — Tests nutzen
  `Array.prototype.at`, das bisher nur über die Node-22-Typdeklarationen
  durchging — Zurücknehmen: nie; Runtime (WebView2, Node 24) kann ES2022.
- 2026-09-15: Ausgeliefertes Profil `ollama-coder` = `ollama run
  qwen3-coder:480b-cloud` (Nutzerentscheidung: Ollama Cloud statt lokalem
  VRAM; staerkstes agentisches Coding-Modell der Ollama-Bibliothek, 256K
  Kontext). Das Basisprofil `ollama` bleibt bei `llama3.2` als lokaler
  Fallback; Billing-Provenienz der Cloud-Route ist wie bei jedem Adapter
  erst mit einem Smoke belegt — Zurücknehmen: wenn ein Smoke zeigt, dass die
  Cloud-Route ohne Abo bezahlt wuerde (Routing verbietet zusaetzliche
  Paid-API) oder ein staerkeres Coding-Modell in Ollama Cloud verfuegbar ist.
- 2026-09-15: Bundle `ui-ux-pro-max` (nextlevelbuilder, CLI 2.15.0, MIT) as the
  eighth skill pack under `src-tauri/resources/skills/`, unchanged from the
  installer output, so every spawned worker finds it in `.claude/skills/` like
  the other packs. Only this pack; the installer's six companions (design-system,
  design, ui-styling, brand, slides, banner-design) are not bundled. The pack is
  a rule source for audits (ten priority categories, searchable via its Python
  scripts); its design-system generator is not used because the App
  (`docs/archive/plaene-2026-09/DESIGN-IMPLEMENTIERUNG.md`) and the Dev-HQ (`docs/dev-hq/DESIGN.md`)
  already carry approved design contracts. Reverse if the 3.6 MB bundle growth
  or the Python dependency of the search scripts becomes a problem; the
  SKILL.md stays readable without Python.
- 2026-09-17: Three calls from the ui-ux-pro-max audit round (Draft-PR #45).
  (a) The 36 hardcoded rgba() tints in styles.css move onto the existing
  --state-*-bg tokens (merge, danger, needs) rather than onto new tokens with
  their old values: a small visible shift is accepted so that the contrast gate
  sees the pairing the text actually sits on. Reverse if a state tint proves
  wrong for a badge; then add a token with the old value and its pairing.
  (b) docs/dev-hq/live.html declares lang="de" and marks its English blocks
  (Fleet, Queue, Review card titles, setup texts) with lang="en" per
  container; the static pages stay English. Reverse only by translating the
  German UI strings, tests included.
  (c) #45 merges with a merge commit, not a squash: every fix commit carries
  its Test-First trailer and is a bisect point for red-first.


- 2026-09-16: Der PTY-Reader beantwortet die ConPTY-Cursorabfrage `ESC[6n`
  selbst mit `ESC[1;1R` (`pty.rs`, Weak auf die Session) — Claude Code
  2.1.266 (und laut W1-01 auch Kimi 0.43) stellt sie als erstes Byte und
  zeichnet ohne Antwort nie; bisher antwortete nur xterm.js, also nur bei
  gemountetem Terminal-Tab, und per `pa` gespawnte Worker hingen. Eine
  zweite Antwort durch xterm.js beim späteren Öffnen des Tabs ist für die
  TUI eine unbekannte Tastensequenz (drei Läufe ohne Folgen). Beleg
  `.pa/report_provider_adapter_smoke_claude.md` — Zurücknehmen: wenn die
  Frontend-Seite für jede Session ein unsichtbares xterm hält oder ein
  Adapter nachweislich auf die Doppelantwort reagiert; dann Reply nur ohne
  gemountete Ansicht.
- 2026-09-16: Claudes Trust-Dialog wird zweistufig beantwortet
  (`ClaudeTrustMove` = Down, `ClaudeTrust` = Enter nur bei sichtbarem
  Selektor auf „Yes, I trust this folder"), wie die Codex-Hooks-Review —
  2.1.266 preselektiert „No, exit", das alte blanke Enter beendete den
  Agenten. Zurücknehmen: nie blind; wenn die Dialogtexte sich ändern, neuer
  Roh-Capture (`testutil::capture_claude_output`) und neue Fixture.
- 2026-09-17: Ollama wird Worker — nicht als eigener Adapter, sondern als
  Modellroute von OpenCode (Nutzerentscheidungen 17.09., revidiert gegenüber
  dem 16.09. „Helper bleibt"): Profil `opencode-ollama-qwen3-coder` =
  `opencode -m ollama/qwen3-coder:480b-cloud`, weil `ollama run` eine
  Chat-REPL ohne Datei-/Shell-Werkzeuge ist; ProjectA erzeugt die
  OpenCode-Modellconfig selbst (`OPENCODE_CONFIG`, Muster
  `hooks.rs::write_settings`), die Nutzer-Config bleibt unberührt; die
  OpenCode-Statuszeile ist der Billing-Beleg. Spec
  `.pa/task_ollama_worker_adapter.md` (W2-09b, aktiv seit 21.09. nach drei
  Review-Runden) — Zurücknehmen: wenn der Capture zeigt, dass
  `qwen3-coder` über den `openai-compatible`-Adapter keine Tool-Calls
  liefert, `OPENCODE_CONFIG` nicht greift, oder die Statuszeile Kosten > 0
  zeigt (Routing verbietet zusätzliche Paid-API).



## 22.09.2026 — DeepSeek-Worker-Richtung und Startfehler

Nutzerauftrag: deepseek-v4-flash:cloud ueber Ollama/OpenCode pruefen. Die
Qwen-Richtung aus W2-09b ist ersetzt. Beobachtet: isolierte CLI-Konfiguration
und Read/Write; automatische ProjectA-Zustellung nicht belegt. Helper bleibt.
Verbindliche Provider-Konfiguration darf nicht best-effort scheitern:
Fehler verhindern den Worker-Start, andernfalls koennte eine Home-/alte
Route gelten. Spawn-Schnittstelle bei Bedarf fallible machen, main seriell.
Umkehr erst nach neuer Nutzerentscheidung bzw. belegtem anderen sicheren
Spawn-Vertrag. cost=0 ist beobachtete OpenCode-Anzeige, keine unabhaengige
Abrechnung; fehlender Wert unbekannt. Keine bezahlte Ersatzroute.
- `docs/dev-hq/data.js|.json` bekommen den Merge-Treiber `hqdata`
  (`.gitattributes`, `.githooks/merge-hqdata`, registriert von
  `scripts/install-hooks.sh`, Nachlauf `.githooks/post-merge`): die beiden
  Dateien sind Erzeugnisse von `scripts/dev-hq.mjs`, werden aber eingecheckt,
  weil die statischen HQ-Seiten sie per `<script src>` laden — am 21.09. war
  das in sieben von zehn offenen PRs der einzige Konflikt, und ein Erzeugnis
  wird nicht ausgehandelt, sondern neu erzeugt. **Grenze, die mitgesagt gehört:**
  Merge-Treiber sind clone-lokal, GitHubs „Merge"-Knopf führt sie nicht aus —
  der Fix hilft dem Weg, den hier alle gehen (main lokal hereinmergen, dann
  pushen), nicht dem Server — Zurücknehmen: wenn die Momentaufnahme nicht mehr
  eingecheckt werden muss, weil die HQ-Seiten sie zur Laufzeit holen; dann ist
  der Treiber überflüssig statt nur klein.

## 2026-09-22 - controlled dependency adoption

Adopt PR34's setup-python/upload-artifact v7 upgrades while retaining full
commit-SHA pins; adopt PR61's exact jsdom30.1.0 lockfile. This preserves
current workflow policy and supplies an ordinary reviewed commit instead
of exempting bot commits from gates. Reverse the dependency upgrade if
frontend/HQ or workflow compatibility checks fail; do not weaken checks.
No review workflow execution or paid model spending is part of this update.

## 2026-09-23 — gemeinsamer Dev-HQ-/ProjectA-Kern

Dev-HQ wird als gebündelter lokaler Client des bestehenden Rust-/SQLite-Kerns
gebaut. Derselbe Kern besitzt Session-Start, Worktrees, Claims, Budgets und
Freigaben; App und Browser lesen denselben versionierten Vertrag. Der
installierte HQ-Host serviert Ressourcen und proxyt die Loopback-API, führt
aber keinen zweiten Scheduler. Grund: doppelte Ausführungsautorität könnte
Leases, Budgetgrenzen und menschliche Verdicts gegeneinander ausspielen.
Der Browser bekommt nur seine kurzlebige HQ-Sitzung; ein menschliches
Verdict-Token wird pro konkreter Aktion ausdrücklich geliefert und nicht vom
Host ergänzt. Die Anbieter-Abos werden als getrennte Kapazitäten mit
Herkunft angezeigt und geroutet, niemals als addiertes Guthaben.

Umkehrkriterium: Erst wenn ein unabhängiger HQ-Scheduler nachweislich dieselben
Fencing-, Recovery-, Budget- und Verdict-Gates in einer gemeinsamen
Transaktion wahrt und ein installierter Offline-Build die volle HQ-Parität
belegt, darf die Ausführungsautorität neu verteilt werden. Bis dahin bleibt
Continuous Mode an seine bisherigen Abnahme-Gates gebunden.

## 2026-09-23 — HQ2 Studio verwendet die bestehende Runtime

Studio nutzt den bestehenden authentifizierten HQ-Proxy und Rust-Worker-/Projekt-/Queue-API. Hostseitig liegen nur Routingpräferenzen mit Revision und ein begrenzter Quellenkatalog. Benchmarkbelege werden nach Aufgabe, Profilkonfiguration, Modell und Effort getrennt; fehlende Werte bleiben unbekannt. Plan/Interview sind explizite Agentenanweisungen, solange ein Harness keine native Enforcement-Konfiguration bietet. Umkehren/erweitern, sobald die Runtime einen attestierten Plan-/Plugin- oder Benchmarkvertrag anbietet. Beleg: .pa/report_hq2-11.md.

## 2026-09-23 — DEVFLOW als Erweiterung des HQ2-Vertrags (DF-03)

Entwurf: Planpakete referenzieren Quelle/Revision und bestehende Runtime-IDs;
Stages ergänzen persistente Übergänge, keinen zweiten Scheduler. Klassische
Queue und ContinuousTask bleiben explizit getrennte Ausführungsbindungen.
Grund: importierte Planung darf weder Arbeit doppelt dispatchen noch Admission
oder offene Continuous-Gates umgehen. Das vorhandene Metadatenjournal ist
kein replayfähiger Workflow. Details: `development/HQ2_CONTRACT.md`, DEVFLOW v1.

Unabhängige Review-/Testabnahme prüft die beobachtete Familie gegen sämtliche
Autoren des Kandidaten; Adapter und UI-Profil sind keine Identitätsbelege.
Menschliche Entscheidungen binden Scope, Kandidat und Policyrevision.
DF-01-Herkunft wird durch unveränderliche Human-Policy-Snapshots gebunden;
DF-13/22 verweigern unbekannte Revisionen. Paketnachfolge erhält explizite
Revisionsreferenzen, ohne historische Runs oder Belege umzuschreiben.
Automatische unabhängige Reviews innerhalb der Nutzerpolicy sind zulässig;
Merge, Release, Continuous und Policyüberschreitungen bleiben menschliche Gates.
Umkehr/Revision nur nach belegtem Widerspruch im Implementierungsabgleich und
erneutem Vertragsreview; keine Abschwächung der Nutzergrenzen durch Migration.
Status: Dokumentvertrag nach zwei unabhängigen Kimi-Reviews und gezielten Korrekturen angenommen; Runtime-Abnahme erfolgt paketweise (siehe .pa/report_df-03.md).

## 2026-09-23 — Revisionsgebundener Planimport (DF-04)

Planimporte speichern vollständige, unveränderliche Quellenprojektionen in SQLite.
Ein aktueller Zeiger wird unter Schreibsperre mit erwarteter Revision geprüft;
auch ein identischer Wiederimport darf einen veralteten CAS nicht umgehen.
Entfernte IDs bleiben als nicht neu dispatchbare historische Pakete erhalten.
Der Dateiimport verwendet den vorhandenen begrenzten Reader für docs/PLAN.md
im registrierten Projekt; Größenlimit, UTF8- und geöffnete-Handle-Prüfung werden
nicht in einem zweiten Reader nachgebaut. Import erzeugt keine Workerautorität.

Die bestehende Store-Policy deaktiviert globale SQLite-Fremdschlüsselprüfung.
Deshalb prüfen Planimporte die Projektzugehörigkeit unter Schreibsperre und
Lesezugriffe über einen Projekt-Join. Nach Projektlöschung bleiben historische
Zeilen physisch erhalten, sind über diese Methoden aber nicht mehr lesbar.
Keine automatische Löschung wird im Planimport eingeführt. Umkehren, wenn eine
explizite projektweite Aufbewahrungs-/Löschregel beschlossen und geprüft ist.
Beleg: .pa/report_df04b_store.md; Dateiimport-Nachweis folgt in DF04c.

## 2026-09-23 - insta snapshot tests (W1-23)

New dev-dependency `insta = "1.48"` (`src-tauri/Cargo.toml`), default
features only (`colors`/`console`) — no `json`/`csv`/`redactions` extras.
insta itself declares MSRV 1.66.0, but that is not the floor of what the
lockfile resolves under it: `console` 0.16.6 declares `rust-version = "1.71"`
and `getrandom` 0.4.3 (via `tempfile`) declares 1.85, the highest value among
the resolved crates checked. `windows-sys` (0.45.0–0.61.2), `windows-link`,
`r-efi` and `encode_unicode` were measured in W1-23c: the manifests declare
1.48–1.71 (`encode_unicode` 1.0.0 declares nothing; only its README says
1.56). Measured, with the feature union the lockfile graph enables: all of
them build with 1.89 and pass `cargo check` with 1.71 on
`x86_64-pc-windows-gnu`, r-efi also on `x86_64-unknown-uefi`. The declared
floors below 1.71 are read, not tested; no per-crate bisection, no `-msvc`,
no link step (`.pa/report_w1-23c.md`). Corrected 2026-09-23 in W1-23b — the
first version of this entry claimed nothing needed more than 1.66. Everything
stays under this crate's `rust-version = "1.89"` and the 1.94.1 toolchain in
use here. First
snapshots cover two pure parser/formatter pairs: `budget::limits_from_settings`
+ `BudgetStop::reason()` (`src-tauri/src/budget.rs`), and
`status::parse_statusline` + `status::format_tokens`
(`src-tauri/src/status.rs`) — both are pipe ends of the same `statusLine`
payload (Claude Code's usage hook), so pinning both catches drift on either
side of it. `redact.rs` was the plan's other target (`.pa/task_w1-23.md`)
but is under active work in PR #73; the coordinator narrowed W1-23's scope
to budget.rs and a non-redact parser to avoid a merge conflict there — its
snapshots follow once #73 lands. Already user-approved in principle as one
of three Scout recommendations accepted 2026-09-16 (see that entry); this is
the concrete adoption. `*.snap.new` (insta's local-mismatch scratch file) is
git-ignored — never meant to be committed. Reverse: if insta's `CI` env
detection (which forbids accepting a new/changed snapshot in CI, verified
2026-09-23 in `.pa/report_w1-23.md`) is found to be bypassable, or if the
snapshot set proves noisier than the point assertions it complements.

### 2026-09-23 — DF08 identity history retention and trust boundary
Migration21 retains run identity headers and observations append-only. Store::open deliberately keeps SQLite foreign_keys disabled for the preexisting project removal/archive model; FK declarations are documentation, not enforced identity provenance. The trusted route CAS and identity writes share one transaction and preserve run linkage in code. No generic agent evidence writer can attest identities. Privileged SQL/migrations are outside this boundary.
No deletion/backfill of historical identities is introduced. Future retention must preserve run/history references or receive an explicit reviewed retention design; reverse this decision only with migration and historical-reader evidence. Malformed non-null configured providers abort/roll back route binding; absent configuration stays unknown. A separate final authority recheck after project guidance collection does not change the original coherent data snapshot.

## 2026-09-23

- **Korrigiert am selben Tag (Review W1-21, Befund U1):** `package.json`
  bekommt `@xterm/addon-search@~0.15.0` (W1-21, Scrollback-Suche in
  `TerminalView.tsx`), NICHT `^0.16.0` wie der erste Entwurf dieses Eintrags
  behauptete. `@xterm/addon-search@0.16.0` und `@xterm/xterm@6.0.0` wurden
  beide am 2025-12-22 (`npm view <pkg> time --json`) veroeffentlicht — vom
  selben Release-Zug, nicht unabhaengig; die Behauptung „es gibt keinen
  xterm-6-Release" war schlicht falsch, `@xterm/xterm@latest` ist `6.0.0`.
  Installiert ist `@xterm/xterm@5.5.0`; dafuer passt `0.15.0`, dessen
  `peerDependencies` (`{"@xterm/xterm": "^5.0.0"}`) das explizit sagt.
  `0.16.0` fuehrt das `peerDependencies`-Feld nur deshalb nicht mehr, weil es
  denselben Major-Sprung macht wie `@xterm/xterm` selbst und sich nicht mehr
  gegen 5.x deklariert — kein Zeichen von Kompatibilitaet, wie der erste
  Entwurf es (falsch) gelesen hat. **Nebenbefund, hier NICHT geaendert:**
  `@xterm/addon-fit@0.11.0` traegt denselben Zeitstempel wie
  `@xterm/addon-search@0.16.0` (`npm view @xterm/addon-fit time --json` →
  `0.11.0` ebenfalls 2025-12-22) und ist damit vermutlich ebenfalls das
  xterm-6-Begleit-Addon, faelschlich gegen `@xterm/xterm@5.5.0` installiert —
  das war schon vor W1-21 im Lockfile und wird hier nicht angefasst (siehe
  `.pa/report_w1-21.md`, Abschnitt „Folgeaufgabe addon-fit"). Zurücknehmen:
  wenn das Projekt geschlossen auf `@xterm/xterm` 6.x springt — dann alle
  `@xterm/addon-*`-Pakete im Gleichschritt, inklusive `addon-fit` und der
  API-Anpassungen, die `@xterm/addon-search@0.16.0`s `#RRGGBB`-only-Vorgabe
  fuer Decoration-Farben ohnehin schon zeigt.

## 2026-09-23 - addon-fit zurueck auf die xterm-5-Linie (W1-21b)

- `@xterm/addon-fit` von `^0.11.0` auf `~0.10.0`. Der W1-21-Nebenbefund
  oben ist jetzt belegt, nicht nur vermutet: `0.11.0` fuehrt keine
  `peerDependencies` mehr, `0.10.0` deklariert `{"@xterm/xterm": "^5.0.0"}`.
  Der Quelltextvergleich zeigt die konkrete Unvertraeglichkeit: `0.11.0`
  zieht in `proposeDimensions()` fest `overviewRuler.width || 14` ab — die
  Breite der eigenen Scrollbar von xterm 6 —, `0.10.0` dagegen die von
  xterm 5.5 gemessene native Breite `_core.viewport.scrollBarWidth`
  (Windows klassisch 17px, Fallback 15px). Mit `0.11.0` gegen 5.5 bekommt
  das Terminal bei breiter nativer Scrollbar eine Spalte zu viel, die unter
  der Scrollbar liegt. Beleg: `src/components/xtermFitCompat.test.ts`
  (echtes Paket, rot mit 0.11, gruen mit 0.10). Lockfile per `npm install`.
  Zuruecknehmen: beim geschlossenen Sprung auf `@xterm/xterm` 6.x, wie oben.

## 2026-09-24 - CI-01: Mergify-Queue und Actions-Minuten (Nutzer-Entscheidung)

Messbasis (Analyse 24.09.): ~3000 Windows-gewichtete Actions-Minuten/Tag;
`gates (windows)` = 70 % davon; 39 % aller PR-Laeufe waren reine
"merge main"-Aktualisierungen, erzwungen durch "strict" (Branch muss aktuell
sein); gruener PR-Lauf im Median Windows 15,3 min, Linux 7,0, red-first 8,0;
Cache-Speicher 10,34 von 10 GB; die zwei "607-Minuten-Laeufe" waren ein
Spending-Limit-Abbruch plus ein Rerun 10 h spaeter, kein Haenger - aber
`timeout-minutes` fehlte ueberall.

- "strict" ist aus (Koordinator, 24.09.), `main` wird nur noch ueber die
  Mergify-Queue gemergt (`.mergify.yml`: serial, Buendel 1-4 dynamisch,
  10 min Wartezeit, max. 2 parallele Queue-Laeufe, merge_method `merge`,
  Auto-Queue ueber `merge_protections_settings.auto_merge_conditions`, weil
  `autoqueue` veraltet ist) - Warum: die Queue testet gegen den aktuellen
  main, ohne dass jeder PR sich selbst per "merge main" aktualisieren muss;
  Buendel teilen sich einen Lauf; Merge-Commits halten die Test-First-
  Historie sichtbar - Zuruecknehmen: wenn die Queue-Laeufe (Draft-PRs auf
  `mergify/merge-queue/*`) mehr Minuten kosten als die eingesparten
  Aktualisierungen; Messreihe ueber mehrere Wochen, kein Einzelwert.
- **Teilweise Ruecknahme von 2026-09-09 ("Die Windows-Kuerzung kommt
  nicht"):** `gates (windows)` laeuft auf PRs nur noch, wenn eine Eingabe der
  Bahn geaendert ist - entschieden von einem PLAN-SCHRITT
  (`scripts/ci/windows-plan.sh`) im Job, nicht von `paths-ignore` und nicht
  von einem Job-`if`; der Required Check meldet also immer success/failure.
  Die Eingabeliste ist aus `gates.sh` (fmt, clippy, rust-suite, native-tests)
  abgeleitet und nennt ausdruecklich die Dateien ausserhalb des Crates
  (`docs/PLAN.md` per include_str!, `docs/agents-json.md` per Testlesung,
  `.gitattributes`, npm-Manifeste); neue include_str!-Ziele findet das Skript
  bei jedem Lauf selbst. Queue-Laeufe und Pushes auf main fahren IMMER voll -
  die Windows-Regression wird damit spaetestens vor dem Merge sichtbar, nicht
  erst danach. Das war der Einwand vom 09.09., und die damalige
  Ruecknahmebedingung ("wenn die Minuten knapp werden; mit Messreihe, nicht
  Einzelwert") ist mit der Messbasis oben erfuellt; die Bedingung vom 04.09.
  fuer Pfadfilter ("Liste der Eingaben je Gate, nicht nach Dateiendung") auch.
  Selbsttest `scripts/test-windows-plan.sh` (Gate `selftest-windows-plan`) -
  Zuruecknehmen: sobald eine Windows-Regression durch einen PR rutscht, den
  der Plan als "nicht noetig" eingestuft hat; dann zuerst die Eingabeliste
  pruefen, nicht den Plan-Schritt entfernen.
- Keine CI auf Draft-PRs (Job-`if`, ausser Mergify-Queue-Entwuerfen),
  `ready_for_review` als Ausloeser; `concurrency` bricht ueberholte PR-Laeufe
  ab, aber nie Laeufe auf main und nie Queue-Laeufe (die Queue wertet einen
  abgebrochenen Check als "checks-interrupted" und wirft den PR hinaus);
  `timeout-minutes` linux 20, red-first 25, windows 35; rust-cache speichert
  nur noch auf main (`save-if`) - Warum: Minuten und der ueberlaufende
  Cache-Speicher. Preis: red-first laeuft nie auf main, seine beiden stabilen
  Baum-Verzeichnisse werden nicht mehr gespeichert und bauen kalt, wenn ein
  PR Test-First-Belege hat - Zuruecknehmen: `save-if` fuer red-first, wenn
  dessen Median dadurch spuerbar steigt.
- Dependabot monatlich, je Oekosystem ein Sammel-PR; Security-Updates
  bleiben sofort (eigener GitHub-Mechanismus, nicht `schedule`) - Warum: jeder
  Dependabot-PR ist ein voller Lauf inkl. Windows - Zuruecknehmen: wenn ein
  Monatsbuendel regelmaessig an einer einzelnen Abhaengigkeit scheitert;
  dann diese als eigene Gruppe.
- JUnit-Berichte (nextest-Profil `ci`, Vitest bei `PA_JUNIT=1`) gehen per
  `mergifyio/gha-mergify-ci` (SHA-gepinnt, v25) an Mergify Test Insights,
  ohne zusaetzlichen Lauf; der Upload ist `continue-on-error`, laeuft auch
  bei roten Laeufen und schaltet sich ohne Secret `MERGIFY_TOKEN` ab -
  Zuruecknehmen: wenn Test Insights nicht genutzt wird.

## 2026-09-24 - CI-02: leichter main-Push, Wochenlauf, Docs-only-Plan (Nutzer-Entscheidung)

Messbasis wie CI-01 (~3000 gewichtete Minuten/Tag, ~17 main-Pushes/Tag,
gruener Lauf Median windows 16,1 min, linux 7,3). Ein voller main-Push kostet
also ~7,3 + 2 x 16,1 = ~40 gewichtete Minuten, ~670/Tag - fuer Code, der im
Queue-Lauf (`mergify/merge-queue/*`) eben schon voll geprueft wurde.

- **Ruecknahme von CI-01 "Pushes auf main fahren IMMER voll":** Ein Push auf
  main faehrt linux und windows nur noch voll, wenn eine Cache-Eingabe
  geaendert ist - fuer beide Bahnen die rust-cache-Schluessel
  (`Cargo.toml`/`Cargo.lock` im Crate und an der Wurzel, `rust-toolchain*`,
  `.cargo/*`), fuer linux zusaetzlich `package-lock.json` (setup-node).
  Sonst meldet der Plan-Schritt Erfolg nach ~1 min. Warum: rust-cache und
  npm-Cache speichern nur auf main (`save-if`, CI-01); aendert sich ein
  Schluessel und main baut nicht voll, laufen alle folgenden PR-Laeufe kalt.
  Aendert sich keiner, bringt ein voller main-Lauf dem Cache nichts, denn
  rust-cache sichert nur Abhaengigkeiten, nicht den Crate. Rechnung: leichter
  Push ~3 gewichtete Minuten (1 linux + 2 windows, Abrechnung rundet je Job
  auf), voll nur bei ~5-10 % der Pushes -> ~90/Tag statt ~670, rund
  580 gewichtete Minuten/Tag (~19 % des Gesamtverbrauchs) gespart. Unsicher
  bei jedem Fehler (kein Vorgaenger, Vorgaenger nicht holbar, Diff scheitert
  oder leer, Push nicht auf main) -> voll. Zuruecknehmen: wenn eine
  Regression erst nach dem Merge auf main sichtbar wird, die der Queue-Lauf
  nicht haette zeigen koennen (z. B. Merge-Reihenfolge ausserhalb der Queue).
- **Wochenlauf:** `schedule` Montag 05:17 UTC und `workflow_dispatch` fahren
  linux und windows immer voll auf main. Warum: faengt, was der leichte
  Push nicht sieht - vor allem ein neues stabiles rustc (aendert den
  rust-cache-Schluessel, ohne dass eine Datei im Repo sich aendert) und
  Drift externer Abhaengigkeiten. Zuruecknehmen: nie ersatzlos; wenn ein
  rustc-Release PR-Laeufe eine Woche lang kalt macht, zusaetzlich einen
  rustc-Versions-Check in den Plan nehmen.
- **Docs-only fast-success fuer die Linux-Bahn:** `scripts/ci/lane-plan.sh`
  (ersetzt `windows-plan.sh`, Selbsttest `scripts/test-lane-plan.sh`, Gate
  `selftest-lane-plan`) laesst einen PR die Linux-Bahn nur auslassen, wenn
  JEDE geaenderte Datei eine `.md` an der Wurzel, unter `docs/` oder `.pa/`
  ist, die kein Gate liest. "Gelesen" ist: statische Liste fuer Leser per
  Verzeichnis-Listing/Regex (`STAND.md`, `.pa/task_*.md`, `.pa/report_f0*`,
  `.pa/HQ-START.md`, `docs/PLAN.md`, `docs/agents-json.md`, `docs/dev-hq/*`),
  alle include_str!-Ziele, und jeder Literal-Verweis (`*.md`, `docs/...`,
  `.pa/...`) in `src-tauri/ src/ e2e/ scripts/` und den Werkzeug-Configs -
  bei jedem Lauf frisch gesucht, Kommentarzeilen ausgenommen, plus eine
  dateigebundene Ausnahmeliste `NOT_A_READ` fuer Tokens, die nachweislich
  keine Lesung sind. Im Zweifel schwer. Stand heute: 815 leichte, 154
  schwere Doku-Dateien; pruefen mit `bash scripts/ci/lane-plan.sh --classify
  <datei>`. Kein `paths-ignore` (Required Checks muessen melden, 2026-09-04).
  Queue- und Wochenlaeufe fahren immer voll. Zuruecknehmen/nachziehen: wenn
  ein Gate eine Doku-Datei ueber einen Pfad liest, den die Suche nicht sieht
  (concat!/env!, Pfad aus Variablen) - dann in `HEAVY_DOCS` eintragen, nicht
  den Plan entfernen.
- **Concurrency:** Nicht-PR-Laeufe und Queue-Laeufe haben je Ereignis+SHA
  eine eigene Gruppe; ein Wochenlauf kann so keinen main-Push abbrechen und
  umgekehrt.
- **W1-19b Dependabot in red-first:** ein Commit ist ohne Test-First/No-Test-
  Trailer erlaubt, wenn Autor exakt `dependabot[bot]
  <49699333+dependabot[bot]@users.noreply.github.com>`, Committer
  `noreply@github.com` und jede Datei ein Manifest ist (`package.json`,
  `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
  `.github/workflows/*.yml`, `.github/actions/*/action.yml`). Warum:
  Dependabot kann keine Trailer schreiben; PRs #109-#111 waren nur daran rot.
  Das ist eine Herkunftsregel, keine Sicherheitsgrenze: faelschbar, aber nur
  fuer Manifeste, die alle anderen Gates voll pruefen. Zuruecknehmen: wenn
  Dependabot Quelltext aendert oder die Identitaet wechselt.
- **Lokal `PA_PREPUSH=light` (opt-in):** pre-push auf Branches faehrt die
  Bahn `branchpush` (fmt, typecheck, lint, fe-test, hq-test - kein clippy,
  keine Rust-Suite); ein Push nach main/master und der Standard bleiben
  `prepush`. Vor PR-Eroeffnung / Ready weiter `gates.sh lane prepush`.
  Zuruecknehmen: wenn Queue-Laeufe haeufiger an clippy/Rust-Suite scheitern.
- **Hooks pruefen den Arbeitsbaum, der committet/pusht:** vorgezogen als
  Hotfix (Cuarroc/ProjectA#156, Eintrag 2026-09-25 unten) - dort Begruendung
  und Zuruecknehmen-Kriterium.
- **Review-Nachzug CI-02 (25.09., Disposition `.pa/review_ci-02_disposition.md`):**
  die beiden Reviews (glm-5.2, kimi-k3) brachten zwoelf Befunde; zehn wurden
  angenommen, zwei mit korrigierter Schwere (glm-5.2 F1, kimi-k3 F5 - die
  behaupteten roten red-first-Laeufe sind heute unerreichbar, die Listen-
  Ergaenzungen sind Haertung). Substanz: der leichte main-Push laeuft nur
  noch hinter einem belegten Queue-Merge (HEAD = genau ein Merge-Commit von
  `mergify[bot]`, Committer GitHub, unmittelbar auf dem Push-Vorgaenger) -
  ein direkter Push oder eine Queue-Umgehung faellt auf die volle Bahn
  zurueck, statt ungeprueft gruen zu melden. Zuruecknehmen: wenn Mergify
  Autor/Committer der Queue-Merges aendert (dann schlaegt die Pruefung fehl
  und JEDER Push faehrt voll - sichere Richtung, aber teuer).

## 2026-09-25 - Hotfix: Hooks pruefen den Arbeitsbaum, der committet/pusht

Einzeln aus CI-02 (PR #133) vorgezogen, Nutzer-Freigabe 25.09.

- **Hooks pruefen den Arbeitsbaum, der committet/pusht:** pre-commit,
  pre-push und commit-msg bestimmen ROOT mit `git rev-parse --show-toplevel`
  statt aus ihrem eigenen Pfad. Anlass: `core.hooksPath` zeigt absolut auf
  `<hauptcheckout>/.githooks`, also prueften Commits und Pushes aus jedem
  Worktree die Gates des Hauptcheckouts (Koordinator-Befund 24.09.).
  Selbsttest `scripts/test-hook-root.sh` (Gate `selftest-gates`) -
  Zuruecknehmen: nie; eine Bahn muss den Baum pruefen, der gepusht wird.

## 2026-09-25 - CI-03: GitHub Actions cost - Windows only in the queue, red-first in the linux job (user decision)

Measurement (24.09. 12:10 to 25.09. 00:24, 120 runs of `ci`): `gates (windows)`
110 runs / 1424 min, `gates (linux)` 113 / 718, `red-first` 112 / 408. By
event: pull_request 1699 min, push to main 471, merge queue 380. Windows
minutes are billed twice on private repos, so Windows alone was ~2850 of
~3970 billed minutes. Builds on CI-02 (light main push, weekly full run).

- **`gates (windows)` never runs its lane on an ordinary PR.** It runs in the
  Mergify queue (`mergify/merge-queue/*`), on the weekly run and on
  `workflow_dispatch` (also usable on a branch to get a Windows verdict
  before queueing). On an ordinary PR the job runs on `ubuntu-latest` and the
  plan (`lane-plan.sh windows`) reports success, logging each changed Windows
  input so the author knows the queue gives the first Windows verdict. A
  guard step fails the job if the plan wants the lane on a non-Windows
  runner, so `gates (windows)` can never be green with Linux results.
  Why a running job and not a job-level `if` (which would cost 0 min):
  GitHub counts a skipped job as success for branch protection
  (docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions:
  "A job that is skipped will report its status as 'Success'. It will not
  prevent a pull request from merging, even if it is a required check."),
  but Mergify's `check-success` does not match a skipped check -
  `check-skipped` is a separate attribute in its configuration schema
  (docs.mergify.com/mergify-configuration-schema.json) - and how Mergify
  injects the branch protection's required checks into its conditions is not
  documented. A skipped check could leave PRs unqueued. Mergify's own advice
  (merge-queue/scopes/file-patterns) is the same: jobs always run and report.
  Cost of the stub: 1 Linux minute per PR run instead of >= 2 billed Windows
  minutes (light) or ~31 (full).
  Risk: a Windows-only failure (cfg(windows) code, CRLF, path handling) now
  shows up in the queue, not on the PR - it throws the PR (and, when
  batched, its batch) out of the queue and costs one queue run.
  Reverse when: queue runs fail on Windows often enough that the wasted queue
  runs cost more than the PR runs did (watch the Mergify "removed" comments),
  or when Mergify documents `check-success` as matching skipped checks (then
  switch to a job-level `if` and save the stub minute too).
- **red-first runs inside `gates (linux)`.** Plan and proof are two
  `continue-on-error` steps there, sharing setup-linux; the job `red-first`
  only `needs: linux` and turns their outcome into the required check
  (`scripts/ci/red-first-verdict.sh`, fail-closed: missing, skipped or
  cancelled outcomes are red). The proof runs last and switches the checkout
  from the merge commit to the PR head, so the head builds into the warm
  `src-tauri/target` exactly as before. Measured on 25.09. (W2-03a, run
  36075581077): the own job spent 1:21 of 3:17 min on setup. Reverse when:
  red-first needs a different toolchain than the gates, or the combined job
  hits its timeout (55 min since the review below; any timeout there is the
  trigger to split the job again).
- **Merge queue: `max_parallel_checks: 1` (was 2).** With dynamic batch
  sizing (`batch_size` min 1, max 4) Mergify keeps batches at `min` while the
  queue fits into the parallel checks (docs: merge-queue/batches, "Dynamic
  Batch Sizing"), so two queued PRs were two runs; now they are one batch.
  The schema says "Setting this value to 1 disables speculative checks" -
  no speculative run is thrown away when the batch before it fails, which
  matters more now that the queue is the first Windows run. Safety is
  unchanged: serial mode tests each batch on top of everything before it,
  and a failed batch is split and retested until the culprit is out. Cost:
  latency, about one Windows lane (~16-18 min) per batch. Reverse when: the
  queue regularly holds more than ~4 PRs for longer than an hour.
- **Caches (checked, no change):** npm cache hits on PRs ("Cache hit occurred
  on the primary key node-cache-Linux-x64-npm-...", red-first job of run
  36075581077); rust-cache hits on Linux (the head build compiled only the
  own crate, 43 s); the Windows rust-cache step took 79 s on the same run, a
  download - a miss finishes in seconds. Not cached today: Playwright's
  Chromium (~12 s download plus apt fonts) and the apt packages of
  setup-linux; both live in `.github/actions/setup-linux`, outside this
  package - candidates for a follow-up. The red-first merge-base tree
  (`target-red-first-base`) stays cold on every PR with evidence, because
  caches are saved on main only (CI-01) and red-first never runs there.
- **Estimate (not a measurement), on the 120-run window above:** Windows
  minutes by event are not in the measurement; assuming ~15 queue runs and
  ~21 main pushes at the green median (windows 15.3, linux 7.0, red-first
  3.6 min), PRs account for ~880 of the 1424 Windows minutes (~1760 billed).
  Saved: ~1680 billed (Windows on PRs minus ~75 Linux stub minutes), ~100
  (red-first setup on runs with evidence), ~100-200 (fewer queue runs by
  batching, Windows counted twice) - together roughly 1.9k of ~3.97k billed
  minutes, about half, on top of CI-02's main-push saving.
- **Guard:** `scripts/ci/ci-shape.sh` (gate `ci-shape`, self-test
  `scripts/test-ci-shape.sh`) pins the structure: the three required check
  names agree between ci.yml and .mergify.yml, queue_conditions ==
  auto_merge_conditions, the Windows job's runner choice and guard, and
  red-first without its own setup.
- **Review follow-up (25.09., disposition `.pa/review_pr149_disposition.md`):**
  glm-5.2 and kimi-k3 both judged "mergeable, nothing blocking"; nine
  findings, seven accepted. Substance: the ci-shape self-test harness
  swallowed stale mutations (`mutate` ran in `$( )`) and now requires each
  mutation to change the file and fail for its own reason; ci-shape checks
  the Windows guard step semantically (`if` with both conjuncts, `exit 1`,
  comments ignored) and that the red-first proof never starts on an empty
  count; the linux job timeout is 55 min. On the "merge past the queue"
  risk (glm-5.2 F3): a merge that does not come from the queue (GitHub
  merge button, admin, squash, direct push) is not a `mergify[bot]` merge
  commit, so the CI-02 provenance check runs the FULL Windows lane on that
  push to main (`test-lane-plan.sh`: windows/push-merge-ohne-queue,
  push-direkter-commit) - detected right after the merge, not only in the
  weekly run, but still after it. Reverse/extend: if merges past the queue
  happen, require the queue in the branch protection/ruleset (user
  setting, not in this repo).
- **red-first: evidence already proven on main (25.09., found on PR #149):**
  a `Test-First:` spec that is green at the merge base no longer fails when
  a commit reachable from the merge base carries the IDENTICAL `Test-First:`
  line - main's red-first proved it red->green when that commit landed.
  Case: CI-02's hook fix (5bab3db) reached main separately as hotfix #156
  (b147927, same trailer); after merging main, PR #149 (and PR #133 alike)
  could never show the test red again. Any other green-at-base spec still
  fails, the head must still be green. Self-test
  `scripts/test-red-first-landed.sh` (gate `selftest-red-first`). Reverse
  when: trailers on main stop being gated by red-first (then a trailer there
  would no longer prove anything).

## 2026-09-25 - W5-28: PROJECTA_QUEUE=off und der automatische Laufzeit-Beleg

- `PROJECTA_QUEUE=off` (auch `0`/`false`) laesst `queue::start` vor dem
  Dispatcher-Thread aussteigen; die App startet sonst vollstaendig — W5-28
  braucht einen Lauf, in dem alte Queue-Eintraege nachweislich keinen Agenten
  erreichen, und ein per Sweep gelesener Schalter liesse den Thread
  weiterlaufen (Beleg im Log statt im Prozessbild) — Zurücknehmen: wenn der
  Dispatcher selbst einen persistierten Not-Aus bekommt (W5-31b), der Schalter
  ist bewusst prozesslokal und ohne DB-Zustand.
- `scripts/runtime-proof.mjs` (npm run proof:runtime) faehrt den Beleg lokal:
  eigener `PROJECTA_APP_DATA`-Sandbox, zwei Starts, zwei alte Queue-Eintraege,
  Verdikt aus API-Auskunft (Eintraege `ready`, keine Worker) plus Logzeile und
  Screenshot, Aufbewahrung der zehn juengsten Laeufe — die M1-Abnahme war
  manuell und damit nicht wiederholbar — Zurücknehmen: nie das Verdikt als
  Funktion; der Treiber darf durch einen `pa`-Unterbefehl ersetzt werden,
  sobald der Daemon (W5-31b) die Sandboxes selbst verwaltet.

## 2026-09-25 - gitleaks als Pflicht-Gate vor jedem Commit

Nutzer-Regel (freigegeben 25.09.), Umsetzung aus JOB sec-gitleaks.

- **Geheimnis-Scan vor jedem Commit:** das Gate `secrets` in der Bahn
  `precommit` (scripts/ci/secret-scan.sh) fuehrt `gitleaks git --staged` aus -
  nur der Index, unter einer Sekunde. Die Allowlist in `.gitleaks.toml`
  deckt genau die Test-Kanarienvoegel aus Pruefung E (Veroeffentlichungs-Pruefung vom 25.09.2026), jeder Eintrag mit Quelle.
  Ohne gitleaks endet das Gate laut (Exit 2, Installationshinweis) - bewusst
  kein stiller Rueckfall, denn ein Scanner, der bei Abwesenheit gruen wird,
  schuetzt nicht. Der Selbsttest `scripts/test-secret-scan.sh` (Gate
  `selftest-secrets`, Bahn `prepush`) belegt, dass der Scan scheitern kann -
  Warum: Pruefung E fand 36 gitleaks-Treffer, alle Testwerte; damit neue
  Commits diese Klasse sauber halten statt sie nachtraeglich auditieren zu
  muessen. Der Scan ist ein reines Lokal-Werkzeug (CI faehrt kein
  `precommit`); nur der red-first-Beleg fuehrt den Selbsttest am Kopf in CI
  aus, deshalb installiert `.github/actions/setup-linux` gitleaks 8.30.1
  gepinnt mit SHA-256-Pruefung (PR #20: ohne das Werkzeug war der Beleg am
  Kopf rot) - Zuruecknehmen: nur wenn der Nutzer die Regel aufhebt; ein
  Vollscan der Historie in CI waere ein eigener Auftrag, keine
  Aufweichung dieses Gates.

## 2026-09-25 - W5-02a: coordinators run without a write path

- **Coordinator without a write path (W5-02a):** orchestrator and
  queen start under the `strict` environment (applied to the *routed*
  profile, so a failover cannot weaken it) in an empty directory
  `<app data>/hooks-cwd/<worker id>` outside the repository and every
  checkout, on create and on respawn; a continuous run dispatched in the
  coordinator role is refused before a worktree exists. The orchestrator
  prompt no longer tells it to append to `MEMORY.md` in the repository root -
  that was a write path into the tree; reading stays. Why: I3 (the
  coordinator delegates, it never commits). Limit: same OS user, so a
  deliberate `git -C <repo> commit` still works locally (it cannot be pushed:
  no token, no credential helper) - the hard boundary is W5-02e. Scouts are
  not covered: their result channel is a file in the repository root
  (`SCOUT_FILE`), so they need a store channel first. Reverse when: a
  coordinator needs a repository-side memory again - then via a worker task,
  not a coordinator write.
