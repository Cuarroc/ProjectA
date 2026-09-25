# Dev-HQ Bug Log

## 2026-09-25 · /__hq/insights las das ACTIVITY-Journal aus dem cwd statt aus dem gemessenen Repo
- **Wo:** `scripts/hq-live.mjs`, `repositoryInsights()`.
- **Was:** Die Commit-Historie der Insights-Schätzung folgt `GIT_DIR`/`GIT_WORK_TREE` (im Test das Synthetic-Repo, in Hooks der Export von git), das Journal `.pa/ACTIVITY.md` wurde dagegen aus `process.cwd()` gelesen. In einem Worktree mit ≥3 Journal-Einträgen (3 × 45 min = 2,3 h > 1,8 h Git-Sitzungen) schlug der Test `/__hq/insights estimates whole-project time …` fehl und blockierte die prepush-Bahn (Gate `hq-test`, Exit 1).
- **Repro:** Worktree mit drei Journal-Einträgen, `node --test scripts/lib/hq-routes.test.mjs` → Exit 1, „time estimate from the synthetic history: 2.3 h" (erwartet 1.8).
- **Fix:** Journal-Pfad folgt `GIT_WORK_TREE` (Fallback cwd) und ist über die neue Test-Naht `HQ_ACTIVITY_FILE` (Muster wie `HQ_LESSONS_FILE`) explizit setzbar; der Test zeigt damit auf das (fehlende) Journal des Synthetic-Repos. Rot→Grün in `claude/lic-01-license-audit` (Rot: Exit 1, 2.3 h; Grün: 8/8, Exit 0).
- **Queue:** Kein Queue-Eintrag; Fix direkt in PR #10 (blockierte dessen Push).
- **Status:** gefixt.

## 2026-09-23 · Studio-Dichte verändert zu wenig und ist nur in Analyse erreichbar
- **Wo:** concepts/studio-workspace.js, studio-workspace.css, hq2-studio.html.
- **Was:** Nutzerbefund: Komfortabel/Kompakt ändert fast nichts; Desktop-Inspektion bestätigt nur geringe Abstandsänderungen.
- **Fix:** DF-07a/b: globale Auswahl mit zugänglichem Namen, persistente Einstellung und wirksame Zeilen-/Paneel-/Control-Tokens; Regression vor Fix rot, danach UI/HTTP 13/13 grün.
- **Beleg:** .pa/report_df07_desktop-density.md; bei 1920×1080 steigen vollständig sichtbare Profilzeilen von 5 auf 7, bei 1280×800 von 3 auf 5.
- **Queue:** Keine neue Queue-ID erzeugt; Bearbeitung direkt in Draft PR #70. Queue-Nachführung weiterhin ausstehend, kein Eintrag behauptet.
- **Status:** Studio behoben und extern nachgeprüft; native React-Parität und tatsächlicher 200%-Zoom bleiben offen (DF-07d/DF-36).

## 2026-09-21 · Eingereihte HQ-Bug-Tasks liefen als leere claude-Worker ab, die Queue bleibt `dispatched`
- **Wo:** Queue-Dispatcher der installierten v1.4.0 (`task_queue`, `workers`, `messages`), Profil `claude`, Projekt `pj-1a05e752f9b-1`.
- **Was:** Die acht Tasks aus `npm run hq:queue-open-points -- --apply` (15.09. 21:35 UTC, lokale Claude-Sitzung) wurden ohne weiteres Zutun an Worker mit Profil `claude` verteilt: vier eine Minute nach dem Einreihen, vier am 17.09. gegen 13:16 UTC. Jeder Worker hat genau vier Systemzeilen (`Routing: requested reliable (auto/coding); resolved unresolved`, `Worker created with profile claude`, Task, ruflo-Pfad) und steht auf `exited`. Kein Branch `pa/wk-*` hat einen Commit über `c1d2b27` hinaus, alle acht Worktrees unter `Desktop\.projecta-worktrees` sind sauber. Die Queue-Zeilen stehen trotzdem auf `dispatched`, `error` leer. Erwartet: ein Worker, der ohne Arbeit endet, gibt seinen Task mit Grund zurück, statt ihn als verteilt zu führen; ob „resolved unresolved" überhaupt spawnen darf, ist zu klären. Die Abbruchursache selbst ist nicht belegt (Claude-Adapter hat laut STAND kein API-Guthaben).
- **Repro:** lesend aus `%APPDATA%\com.projecta.app\projecta.db`: `select id,status,worker_id from task_queue where id like 'tq-1a0a6ff7%'` → 8× `dispatched`; `select id,status from workers where id in (…)` → 8× `exited`; `select * from messages where worker_id=…` → je vier Systemzeilen. Zuordnung: `tq-1a0a6ff70e8-1` Kimi-Zustellung NT-17 (p3) → `wk-1a0a6ffd562-9` (15.09. 21:36 UTC); `tq-1a0a6ff70ed-2` OpenCode-Zustellung NT-17 (p3) → `wk-1a0a7004f26-18` (15.09. 21:36 UTC); `tq-1a0a6ff70f2-3` Baustein B Antwort-Marker (p2) → `wk-1a0a700c99b-27` (15.09. 21:37 UTC); `tq-1a0a6ff70f7-4` Flake delivery_recovery (p2) → `wk-1a0a70143f9-36` (15.09. 21:37 UTC); `tq-1a0a6ff70fc-5` Windows-PTY-Argumenttest (p2) → `wk-1a0af82bb67-1` (17.09. 13:16 UTC); `tq-1a0a6ff7100-6` Capture-Settlement (p1) → `wk-1a0af833c8c-10` (17.09. 13:16 UTC); `tq-1a0a6ff7105-7` Cross-Project-Kapazität (p1) → `wk-1a0af83bbd8-19` (17.09. 13:17 UTC); `tq-1a0a6ff710a-8` Abnahmematrix-Tabelle (p0) → `wk-1a0af84426e-28` (17.09. 13:17 UTC).
- **Schwere:** blockierend für die Queue als Arbeitsweg — die offenen Punkte gelten als verteilt, bearbeitet wird keiner. Gleiche Klasse wie die zwei Zombie-Einträge aus W0-07 (`tq-1a05a98c9e4-16`, `tq-1a05e8af9b9-2`, `dispatched` seit 01.09., Worker `archived`).
- **Queue:** Bewusst nicht eingereiht. Die App lief am 21.09. nicht (kein Deskriptor), und ein neuer Task liefe über denselben Dispatcher wieder in einen `claude`-Worker. Nächster Schritt am PC: die zehn toten `dispatched`-Einträge über `pa` verwerfen (W0-07/W1-05), die acht Punkte erst neu einreihen, wenn das Profil ausdrücklich auf einen Adapter mit belegter Zustellung zeigt (Codex), und diesen Eintrag dann selbst einreihen.
- **Status:** offen. Nebenwirkung festgehalten: das `--apply` vom 15.09. hat acht Worker-Starts ausgelöst, obwohl STAND „Stehende Regeln" genau davor warnt; es entstanden keine Commits, keine Kosten sind belegt. Nachtrag zu den Vermerken „Einreihung am PC nachholen" weiter unten: die Einreihung ist am 15.09. 21:35 UTC erfolgt (zweiter Lauf 0 offen, idempotent), danach meldete `npm run dev:doctor -- --json` gegen die laufende App `manifest.state: matched` (f66ec09a… beidseitig). Diese Vermerke sind damit überholt, die Punkte selbst bleiben unbearbeitet. Beleg `.pa/report_devhq_setup_2026-09-15.md` §6 und §7.
- **Nachtrag (Claude, 21.09.):** Zwei Punkte stimmen mit den Messungen vom 17.09. nicht überein. Erstens geht das Verwerfen über `pa` bzw. die API derzeit nicht: `POST /api/queue/<id>/cancel` antwortet für `dispatched`-Einträge mit `400 not queued or ready` (Eintrag 17.09. „Zombie-Queue-Einträge …“); vorher braucht es die Cancel-Regel in `api.rs`/`store.rs`. Zweitens ist die Abbruchursache belegt: alle acht Worker liefen im Submit-Guard in „task never echoed; manual Enter required“ (`status_events`, Eintrag 17.09. „Claude-Zustellung …“). Der Claude-Adapter läuft laut Entscheidung 16.09. über das Abo der CLI, nicht über API-Guthaben.

## 2026-09-16 · UI/UX-Audit gegen ui-ux-pro-max: 22 Befunde, alle umgesetzt
- **Wo:** docs/dev-hq/hq.js, hq.css, workspace.css, continuous.js (Live-Seite und statische Seiten).
- **Was:** Statischer Audit gegen die zehn Prioritaetsklassen des gebuendelten Packs `ui-ux-pro-max`: Flottenzeilen mit role=button ohne Tastaturpfad, abgeschaltete Fokusringe, Fokusverlust beim 5-Sekunden-Refresh, aria-live auf ganzen Grossregionen, Labels ohne Feldbindung im Zuweisungsformular, unerreichbare Scroll-Listen, Fehlerbox ohne Alarm-Semantik, Bedienelement-Rahmen unter 3:1, Setup-Zustand nur ueber Farbe, Tabstopps im Mini-DAG, "Lauf beenden" ohne Rueckfrage, toter Zahlen-Animationscode. Vollstaendig: .pa/report_uiux_audit_devhq.md (HQ-1 bis HQ-22).
- **Repro:** scripts/lib/hq-a11y.test.mjs, zwoelf Tests, vor dem Fix alle rot (jsdom-Fixture der Live-Seite mit gemockter Control-API).
- **Fix:** Alle 22 Befunde innerhalb des B/C-Vertrags (keine Palette, keine Schrift, kein Layout): HQ-1 bis 8, 10, 13, 15, 19, 20, 22 am 16.09.; HQ-9 (Tabellen zu Sparkline/Heatmap), 11 (sichtbare Controls-Labels), 12 (`lang="de"` plus `lang="en"`-Bloecke), 14 (Kuerzel-Schalter), 16, 17 (Team-Radiogroup), 18 (Skip-Link), 21 (Inline-Formulare statt `window.prompt`) am 17.09.
- **Queue:** Kein Queue-Eintrag; die Arbeit lief direkt im Draft-PR #45.
- **Status:** gefixt im Draft-PR #45; Gates `npm run test:hq` 162/162 am 17.09., nach Merge und HQ-9/11/12/14/16/17/18/21 inklusive Review-Runde 2 (22.09.) 175/175, `npm run test:hq:visual` 11/11. Screenshot-Abnahme (Liste in `.pa/task_uiux_pro_max.md`) am 22.09. durch die Integrationsinstanz erbracht (`.pa/pr45-shots/`), Befund B-8 nicht reproduziert — GH+ passt in die 24px-Flaeche.


## 2026-09-17 · Claude-Zustellung (NT-17-Klasse): acht Worker, kein einziger Submit
- **Wo:** Submit-Guard (`pty.rs`/`workers.rs`) gegen Profil `claude` (Claude Code 2.1.266, Abo, laut Live-HQ „signed in").
- **Was:** Beim Start der installierten v1.4.0 (17.09. 13:16 UTC) dispatchte die Queue die vier `ready`-Einträge sofort (`wk-1a0af82bb67-1`, `wk-1a0af833c8c-10`, `wk-1a0af83bbd8-19`, `wk-1a0af84426e-28`). Alle vier liefen in dieselbe Sequenz wie die vier vom 16.09.: „task written after TUI readiness; awaiting echo" → write 2 → write 3 → „task never echoed; manual Enter required", Spalte `needs_you`. Kein Worker hat begonnen; die Worktrees blieben unverändert (`c1d2b27`, kein Diff). Um 18:27 lokal wurde die App geschlossen (nicht durch diese Sitzung), alle vier `exited`; `pa worker send` danach: „is ProjectA running?". Damit ist die Zustellung für Claude achtmal in Folge gescheitert.
- **Repro:** App starten, Queue-Eintrag mit Profil `claude` einreihen, `status_events` des Workers lesen (`kind=submit_guard`).
- **Schwere:** blockiert (kein automatischer Claude-Worker möglich; gleiche Klasse wie Kimi/OpenCode NT-17, Pakete W1-01/W1-02).
- **Queue:** eingereiht (die acht Einträge oben); Fix gehört in W1-01/W1-02 (Echo-Regel je Profil), Claude als dritter Fall.
- **Status:** offen. Scrollbacks sind DPAPI-verschlüsselt, der Terminal-Inhalt (Trust-Dialog? Composer gefüllt?) ist ohne App-Fenster nicht lesbar; nächster Schritt: Roh-Capture wie `capture_kimi_output` für Claude.

## 2026-09-17 · Zombie-Queue-Einträge lassen sich über die API nicht verwerfen
- **Wo:** `POST /api/queue/<id>/cancel` (`api.rs`), Einträge `tq-1a05a98c9e4-16` und `tq-1a05e8af9b9-2`.
- **Was:** Beide sind `dispatched`, ihre Worker `archived`. Cancel antwortet `400 {"error":"task … is not queued or ready"}`. Ein Eintrag, dessen Worker archiviert ist, bleibt damit dauerhaft `dispatched` und ist weder über HQ noch über `pa` zu bereinigen (W0-07 verlangt „verwerfen").
- **Repro:** mit laufender App `node`-Fetch auf den Cancel-Pfad (siehe `.pa/report_devhq_setup_2026-09-15.md` §4f).
- **Schwere:** stört (Zombie-Buchhaltung, W1-05 kann die Entscheidung nicht umsetzen).
- **Queue:** Pending — Nutzerentscheidung 17.09.: als Bug loggen, nicht in der DB umschreiben; gehört zu W1-05.
- **Status:** offen. Fix: Cancel für `dispatched` erlauben, wenn der Worker `archived`/`exited` ist (roter Test in `api.rs`, Store-Regel in `store.rs` — Nahtstellen-Lane).

## 2026-09-17 · Last-Flake: `native_handoff_*`-Tests scheitern an der 60-s-Gültigkeit der Route-Fixture
- **Wo:** `src-tauri/src/workers/development_route.rs` `tests::fixture` (`expires_at: now + 60`), genutzt von `test_native_route()`; Tests `workers::tests::native_handoff_owns_one_durable_launch_without_pty_delivery` und `native_handoff_dispatch_failure_preserves_identity_and_reconciles`.
- **Was:** Im Pre-Push-Hook (voller `cargo test`, 190 s, parallel ein fremder `cargo test` einer anderen Sitzung auf demselben Target) fielen beide Tests mit „candidate attestation is stale or lacks provenance" (`development_policy.rs:557`, `expires_at <= now`) bzw. Folgefehler `assertion failed: error.contains("injected native dispatch failure")` (`workers.rs:3600`). Der Kandidat der Fixture ist 60 s nach Erzeugung abgelaufen; unter Last dauert der Weg von Fixture bis Route-Prüfung länger. Zweimal hintereinander rot (17.09.), davor am 16.09. einmal rot (Detail damals abgeschnitten) und einmal grün mit identischem Quellstand.
- **Repro:** unter Last `cargo test --bin projecta`; isoliert `cargo test --bin projecta native_handoff` → 3 passed in 24 s (grün). Dieselbe Klasse wie der `delivery_recovery`-Flake (W1-04).
- **Schwere:** stört (blockiert Pushes über den Hook, kein Produktfehler).
- **Queue:** Pending — App lief nicht (Mutex durch fremdes Debug-`projecta.exe`); kein Eintrag erfunden. Gehört zu W1-04.
- **Status:** offen. Nächster Schritt: Fixture-TTL für Route-Tests entkoppeln (wie `test_route()` mit `OnceLock`-Zeitstempel und 3600 s) oder die Ablaufprüfung im Test mit injizierter Uhr fahren; roter Test zuerst.

## 2026-09-16 · Queue-Einträge für die offenen Punkte
- **Wo:** Queue der installierten v1.4.0, Projekt `pj-1a05e752f9b-1` (ProjectA); Skript `scripts/hq-queue-open-points.mjs` (`POST /api/queue`).
- **Was:** Die acht Punkte aus `.pa/report_devhq_setup_2026-09-15.md` §4a sind eingereiht (Prefix `HQ-Bug:`, Profil `claude`, angelegt 15.09. 21:35 UTC; korrigiert 21.09., vorher hier fälschlich „16.09. ~09:35“). Zuordnung Punkt → Queue-ID:
  - Kimi-Zustellung (NT-17) → `tq-1a0a6ff70e8-1` (p3, dispatched → Worker `wk-1a0a6ffd562-9`, exited)
  - OpenCode-Zustellung (NT-17) → `tq-1a0a6ff70ed-2` (p3, dispatched → `wk-1a0a7004f26-18`, exited)
  - Baustein B Antwort-Marker → `tq-1a0a6ff70f2-3` (p2, dispatched → `wk-1a0a700c99b-27`, exited)
  - Flake `delivery_recovery` → `tq-1a0a6ff70f7-4` (p2, dispatched → `wk-1a0a70143f9-36`, exited)
  - Windows-PTY-Argumenttest CI 34721209783 → `tq-1a0a6ff70fc-5` (p2, ready)
  - Capture-Settlement Transport/Recovery-Vertrag (11.09.) → `tq-1a0a6ff7100-6` (p1, ready)
  - Cross-Project-Kapazität Ressourcendruck (11.09.) → `tq-1a0a6ff7105-7` (p1, ready)
  - Abnahmematrix-Tabelle → `tq-1a0a6ff710a-8` (p0, ready)
- **Repro:** `task_queue` in `%APPDATA%\com.projecta.app\projecta.db` (read-only gelesen, `node:sqlite`); mit laufender App `npm run hq:queue-open-points` → „0 von 8 Punkten noch nicht in der Queue" erwartet.
- **Schwere:** Buchhaltung; damit gelten die elf `Queue: Pending`-Einträge vom 10.–15.09. als eingereiht, soweit sie in §4a konsolidiert sind.
- **Queue:** siehe Zuordnung oben. Die vier dispatchten `claude`-Worker endeten alle im Submit-Guard mit „task never echoed; manual Enter required" (`status_events`, 09:36–09:38 UTC) — kein Fix wurde ausgeführt. Laut Entscheidung 16.09. läuft Claude über das Abo der CLI (nicht mehr credit-blockiert); die vier `ready`-Einträge können beim nächsten App-Start weitere `claude`-Worker starten.
- **Status:** eingereiht, nicht bearbeitet. Die beiden älteren dispatchten Einträge `tq-1a05a98c9e4-16` (QUEUE-TEST) und `tq-1a05e8af9b9-2` (task_p2a) sind Zombies und laut W0-Entscheidung 16.09. zu verwerfen (W1-05).

## 2026-09-16 · Profil `ollama-coder` zeigt auf ein zurückgezogenes Cloud-Modell
- **Wo:** `src-tauri/resources/agent-defaults.json` Profil `ollama-coder` (`ollama run qwen3-coder:480b-cloud`), `docs/decisions.md` 15.09.
- **Was:** Mit angemeldetem Ollama 0.34.1 (User `cuarroc`) bricht `ollama run qwen3-coder:480b-cloud` sofort ab: „qwen3-coder:480b was retired at 2026-07-15 00:00:00 -0700 PDT (ref 8466d4d1-507b-4878-8621-ad3ee91efd08)". `qwen3-coder-next:cloud` ist ebenfalls retired; `qwen3-coder:cloud` und `qwen3.5-coder:cloud` existieren nicht. Das Profil kann am PC keinen Worker starten.
- **Repro:** `ollama run qwen3-coder:480b-cloud "OK"` → Exit 1 nach 1 s, keine Anfrage an die Cloud.
- **Schwere:** stört (ausgeliefertes Profil nicht lauffähig; Billing-Beleg der Cloud-Route unmöglich).
- **Queue:** Pending — App lief nicht; kein Eintrag erfunden. Entscheidung über das Nachfolgemodell liegt beim Nutzer (Rücknahmebedingung in decisions.md ist eingetreten; lokal vorhandene Cloud-Modelle: `kimi-k2.7-code:cloud`, `glm-5.2:cloud`, `deepseek-v4-flash:cloud`, `kimi-k3:cloud`).
- **Status:** offen. Beleg `.pa/report_devhq_setup_2026-09-15.md` §4c.

## 2026-09-16 · Doctor-Manifest gegen installierte v1.4.0 bleibt `mismatch` (echt, nicht CRLF)
- **Wo:** `scripts/dev-setup.mjs` `runtime.manifest`; `src-tauri/resources/agent-defaults.json`.
- **Was:** Der CRLF-Fix aus #43 wirkt (Arbeitskopie 0 CR-Bytes, Doctor-Hash 226b3497… = LF-Hash von HEAD). Trotzdem meldet der Doctor gegen die installierte v1.4.0 (Runtime-Hash f66ec09a…) weiterhin `mismatch`, weil `2f0f887` (Profil `ollama-coder`) das Manifest nach dem Tag um 9 Zeilen erweitert hat. Es ist ein echter Versionsunterschied Quelle ↔ Installation.
- **Repro:** `git show v1.4.0:src-tauri/resources/agent-defaults.json | tr -d '\r' | sha256sum` → f66ec09a…; dasselbe für `HEAD` → 226b3497….
- **Schwere:** kosmetisch bis zum nächsten Build; die Matrix-Zeile „installed build must confirm the manifest digest" ist nur für v1.4.0 (f66e…) belegt, nicht für main.
- **Queue:** Pending — App lief nicht; kein Eintrag erfunden. `matched` erfordert einen Build ab `cea7dbe` oder das nächste Release.
- **Status:** dokumentiert; nur zur Laufzeit gegen die App nicht erneut gemessen (App nicht gestartet, siehe Queue-Eintrag oben).

## 2026-09-15 · Setup doctor reports a manifest mismatch on CRLF checkouts
- **Wo:** `scripts/dev-setup.mjs` `sha256File`, Doctor-Zeile `runtime.manifest`.
- **Was:** Auf einem Windows-Checkout mit autocrlf meldete der Doctor gegen die frisch installierte v1.4.0 `manifest.state: mismatch` (lokal f2ae…, Runtime f66e…), obwohl Quellstand und Build identisch sind. Die Rust-Seite hasht CRLF-normalisiert, der Node-Doctor hashte die Rohbytes.
- **Repro:** `scripts/lib/dev-runtime-crlf.test.mjs` (fehlt an der Merge-Base, rot vor dem Fix).
- **Schwere:** stört (falscher "restart or rebuild"-Hinweis, Matrix-Beleg blockiert).
- **Queue:** Pending; kein Queue-Eintrag aus der Remote-Sitzung erzeugt. Einreihung am PC nachholen: `npm run hq:queue-open-points -- --apply` gegen die laufende App (Skript aus PR #43).
- **Status:** behoben und gemergt — PR #43 (`cbb280a`, Merge `cea7dbe`, 16.09.): Normalisierung wie Rust + `.gitattributes eol=lf` für das Manifest; Beleg `.pa/report_devhq_setup_2026-09-15.md` §4b. Am PC noch offen: `dev:doctor` nach `git pull` muss `matched` zeigen (docs/PLAN.md W0-01).

## 2026-09-15 · Statuskonsolidierung nach v1.4.0 (kein neuer Bug)
- **Wo:** dieser Log; Einträge 10.09.–14.09.
- **Was:** Elf Einträge trugen `Queue: Pending`; sechs begründeten das mit einem HQ-v1-HTTP-404, das seit 14.09. widerlegt ist (die installierte v1.2.3 hatte kein HQ v1; ein Debug-Build antwortete 200/401, `.pa/report_hq_v1_runtime_migration.md`). Zwei Einträge ("Profile editing lost metadata", "Setup accepted Node 22") standen auf "review pending im uncommitted Branch": beide sind mit PR #40 (Merge `270a858`, 15.09., v1.4.0) auf main.
- **Repro:** `git log --oneline 270a858 -1`; `grep -c "Queue: Pending" docs/dev-hq/BUGS.md`.
- **Schwere:** kosmetisch (Dokumentationsstand), aber jeder Pending-Eintrag bleibt laut Regel unten eine Beobachtung ohne eingereihten Fix.
- **Queue:** Weiterhin ausstehend. In der Remote-Sitzung war keine App erreichbar, daher wurde bewusst kein Queue-Eintrag erfunden. Einreihung am PC nachholen: `npm run hq:queue-open-points -- --apply` gegen die laufende App (Skript aus PR #43, `bfdeb2d`); es reiht die konsolidierten technisch offenen Punkte aus `.pa/report_devhq_setup_2026-09-15.md` §4a ein (Kimi/OpenCode-Zustellung NT-17, Antwort-Marker, Flake, Windows-PTY-Argumenttest, Capture-Settlement-Transport, Ressourcendruck, Matrix-Tabelle). Einträge, deren Fix bereits gemergt ist, bekommen keinen eigenen Task mehr — für sie ist die Queue-Zeile nur Buchhaltung.
- **Status:** Stand dokumentiert in `.pa/report_devhq_setup_2026-09-15.md`. Technisch noch offen (nicht nur Queue-Buchhaltung): Capture-Settlement-Transport/Recovery-Vertrag (11.09.), Ressourcendruck-Adaption (11.09. Capacity), Codex-Billing-Hinweis manuell (14.09.). Nachzug 17.09. (W1-05, `.pa/report_w1-05.md`): überholte Vermerke („uncommitted branch / review pending", „HTTP 404 / lacks HQ v1") in den Einträgen unten auf den gemergten Stand gebracht, Einträge streng absteigend nach Datum geordnet, die überholte Platzhalterzeile „noch keine Einträge" entfernt und die Vorlage ans Dateiende gestellt. Kein Eintrag wurde hinzugefügt oder gelöscht.

## 2026-09-14 · Terminal view crashes on live worker (xterm _isDisposed)
- **Where:** App frontend, Agents/Terminal view of a running worker (debug build HEAD 630515a, vite dev URL).
- **Observed:** Opening the terminal view of a live Codex worker reproducibly crashed the workspace: "Der Arbeitsbereich ist abgestürzt. Cannot read properties of undefined (reading '_isDisposed')". Reproducible across view reloads; Work/Attention views unaffected.
- **Repro:** Start app against scratch data, spawn codex worker, open its card, click Terminal — crash within seconds. Screenshot evidence retained in session media.
- **Queue:** Pending; no queue entry fabricated. Einreihung am PC nachholen: `npm run hq:queue-open-points -- --apply` gegen die laufende App (Skript aus PR #43); der Fix ist bereits in v1.4.0.
- **Status:** FIXED same day; released in v1.4.0 (`a7c262c`, Merge `270a858` via PR #40, 15.09.); the pin is additionally kept out of Dependabot since PR #43 (`9ce8396`, `f73d6a5`). Root cause: version mismatch — @xterm/addon-webgl 0.19.0 expects xterm 5.6 internals (`_core._store`) while xterm 5.5.0 is installed; the addon's dispose callback then reads `_isDisposed` on undefined. React StrictMode's dev double-mount runs the disposal immediately, so the view crashed on open. Fix: addon pinned to 0.18.0 (the 5.5.0 pairing) plus single shared renderer disposal in TerminalView.tsx (rot→grün regression tests in TerminalView.test.tsx). Live-verified: the terminal view now shows a running codex worker without crashing.

## 2026-09-14 · Codex PTY task submission not echoed (needs_you escalation)
- **Where:** Production PTY launch path, codex profile, submit guard.
- **Observed:** First real adapter smoke through the ProjectA launch path (scratch env, bounded file task): spawn, branch, worktree and PTY session succeeded; the codex CLI process ran but idle; the task was never submitted — the submit guard exhausted its rewrites and escalated to needs_you ("Eingabe wurde nicht abgeschickt"). No probe.txt; worker still running after 10 minutes.
- **Assessment:** Same error class as NT-17 (OpenCode TUI does not echo guard writes); whether codex TUI echoed at all could not be visually confirmed because of the terminal-view crash above.
- **Queue:** Pending. Einreihung am PC nachholen: `npm run hq:queue-open-points -- --apply` gegen die laufende App (Skript aus PR #43); the codex fix itself is in v1.4.0, the remaining NT-17 work for Kimi/OpenCode is what the script queues.
- **Status:** FIXED same day; released in v1.4.0 (`a7c262c`, `bd0af1c`, Merge `270a858` via PR #40, 15.09.). True cause found via real TUI capture: not a missing echo (the codex composer echoes input fine) but codex's modal startup chain swallowing the task writes — directory trust, hooks review, then a usage-limit notice. Fix: CodexTrust + CodexHooksReview blocking dialogs with captured keystrokes, position-based dialog choice (latest marker in the tail wins, so the answered trust dialog is not re-answered while the hooks review is up), and the captured readiness marker "Ask Codex to do anything" on the codex profile. The billing notice is deliberately NOT auto-answered. Rerun passed end-to-end: probe.txt with the exact marker (`.pa/report_provider_adapter_smoke_codex.md`). Codex adapter acceptance through the production PTY path: passed (automated).

## 2026-09-12 · Scoped candidate submission did not verify worktree ownership
- **Wo:** HQ v1 agent candidate API and development launch service.
- **Was:** An unlaunched run could bind an arbitrary commit; declared file ownership was not checked against Git.
- **Repro:** Compiled regression `development_candidate_requires_backend_observed_worktree` failed before the service check. Independent review also reproduced hidden gitlinks; `submodule_ignore_configuration_cannot_hide_out_of_scope_gitlinks` failed before the explicit submodule diff override.
- **Schwere:** blockierend for autonomous integration.
- **Queue:** Pending; tracked by `.pa/task_continuous_devhq.md` and `.pa/report_candidate_ownership.md`. Die damalige Begründung „installed runtime's missing HQ v1" ist durch `.pa/report_hq_v1_runtime_migration.md` aufgeklärt (installiert war v1.2.3 ohne HQ v1; seit 15.09. ist v1.4.0 installiert). No executing legacy queue task was fabricated. Einreihung am PC nachholen: `npm run hq:queue-open-points -- --apply` gegen die laufende App (Skript aus PR #43).
- **Status:** gemergt mit PR #40 (Merge `270a858`, 15.09.), released in v1.4.0; exact validation and independent review dispositions in `.pa/report_candidate_ownership.md`.

## 2026-09-11 · Capture settlement identity race
- **Where:** store/development_codex_usage.rs and development_budget.rs.
- **Observed:** A compiled SQLite writer-race regression allowed settlement after a competing route change committed.
- **Repair:** Recheck exact route JSON and exit code under the settlement writer lock before accepting new usage or replay.
- **Queue:** Pending under .pa/task_continuous_devhq.md; no running-app queue entry submitted. Einreihung am PC nachholen: `npm run hq:queue-open-points -- --apply` gegen die laufende App (Skript aus PR #43, Punkt `capture-settlement-transport`).
- **Evidence:** .pa/report_continuous_capture_atomicity.md. Fix gemergt mit PR #40 (Merge `270a858`, 15.09., v1.4.0). Native capture transport and its full identity/recovery contract remain open.

## 2026-09-11 · Run journal write contention
- **Wo:** src-tauri/src/store/development_runs.rs.
- **Was:** A deferred read-to-write transaction upgrade can fail immediately when another SQLite writer exists.
- **Repro:** CI34633414526 reported database is locked; the compiled launch contention regression failed before BEGIN IMMEDIATE and passes afterward.
- **Queue:** Pending under .pa/task_continuous_devhq.md; no running-app queue entry submitted. Einreihung am PC nachholen: `npm run hq:queue-open-points -- --apply` gegen die laufende App (Skript aus PR #43).
- **Status:** Repaired; gemergt mit PR #40 (Merge `270a858`, 15.09., v1.4.0). Evidence: .pa/report_continuous_run_contention.md.

## 2026-09-11 · Cross-project worker capacity
- **Where:** Rust continuous task claims, store/continuous.rs.
- **Observed:** With one active claim, two other projects both acquired a claim, exceeding the shared two-worker ceiling.
- **Proof:** Compiling regression projects_share_capacity_across_races_restart_pause_and_expired_leases failed with two winners instead of one; passed after repair.
- **Repair:** Count host-wide running claims in the existing serialized transaction, while retaining each project's frozen limit. Pause and lease expiry do not release capacity.
- **Queue:** Pending; die damalige Begründung „installed HQv1 probe unavailable" ist durch `.pa/report_hq_v1_runtime_migration.md` aufgeklärt (installiert war v1.2.3; seit 15.09. v1.4.0). No queue entry or worker dispatch was fabricated. Einreihung am PC nachholen: `npm run hq:queue-open-points -- --apply` gegen die laufende App (Skript aus PR #43, Punkt `capacity-resource-pressure`).
- **Status:** Focused regression passed; full gates recorded in .pa/report_continuous_capacity.md. Gemergt mit PR #40 (Merge `270a858`, 15.09., v1.4.0). Resource-pressure adaptation and operational dispatch remain open.

## 2026-09-11 · Supervisor notification failure and oversized checkpoint labels
- **Where:** New Rust policy supervisor and HQ context, before commit/activation.
- **Observed:** An observer error suppressed authoritative limit checking; unbounded owner/worker labels could enlarge retained checkpoints.
- **Proof:** Compiling observer regression failed with injected observer error; oversized-label regression checks 256-character limits and intact canonical ownership.
- **Repair:** Observer is only a wake hint; store reconciliation continues with visible degraded health. Bounded display labels report truncation.
- **Queue:** Pending; das damalige „HTTP404" der installierten App ist durch `.pa/report_hq_v1_runtime_migration.md` aufgeklärt (installiert war v1.2.3 ohne HQ v1; seit 15.09. v1.4.0). No queue entry fabricated or legacy worker dispatched. Tracked in .pa/report_continuous_policy_supervisor.md. Einreihung am PC nachholen: `npm run hq:queue-open-points -- --apply` gegen die laufende App (Skript aus PR #43).
- **Status:** Seven focused regressions and all final gates pass; both independent re-reviews return ship. Gemergt mit PR #40 (Merge `270a858`, 15.09., v1.4.0). No continuous-mode activation. Full evidence in the report.

## 2026-09-11 · Runtime journal and context freshness
- **Where:** Rust HQ runtime journal, checkpoint/budget events and migration resync.
- **Observed:** Run/evidence/review/launch writes had no change notices; resync and manual events could leave an older context timestamp.
- **Proof:** Compiling regression first returned an empty run journal; migration freshness regression retained timestamp 1 after a new resync event.
- **Repair:** Migration12 transactional runtime notices and a central journal snapshot stamp preserving commit/run identity.
- **Queue:** Pending; das damalige „HTTP404" ist durch `.pa/report_hq_v1_runtime_migration.md` aufgeklärt (installiert war v1.2.3 ohne HQ v1; seit 15.09. v1.4.0). No queue entry fabricated or legacy worker dispatched. Tracked in .pa/report_continuous_runtime_journal.md. Einreihung am PC nachholen: `npm run hq:queue-open-points -- --apply` gegen die laufende App (Skript aus PR #43).
- **Status:** Four focused regressions pass and both independent re-reviews return ship; final gates recorded in the report. Gemergt mit PR #40 (Merge `270a858`, 15.09., v1.4.0).

## 2026-09-11 · Token ceiling and legacy migration boundaries
- **Where:** Rust root budget state and legacy policy migration exposed through HQ context.
- **Observed:** Exact measured exhaustion left a root open; v4 policy backfill picked up newly added token defaults.
- **Proof:** Both budget_boundary regressions compiled and failed before repair (open versus blocked; unexpected legacy allowance).
- **Repair:** Block after measured exhaustion as well as overdrawn allocations; preserve tokens=None during legacy policy backfill.
- **Queue:** Pending; das damalige „HTTP404" ist durch `.pa/report_hq_v1_runtime_migration.md` aufgeklärt (installiert war v1.2.3 ohne HQ v1; seit 15.09. v1.4.0). No legacy task dispatched. Tracked in .pa/report_continuous_budgets.md. Einreihung am PC nachholen: `npm run hq:queue-open-points -- --apply` gegen die laufende App (Skript aus PR #43).
- **Status:** Fixed; both compiled regressions pass after repair. Full Rust/frontend/HQ gates and two independent re-reviews pass; evidence in the budget report. Gemergt mit PR #40 (Merge `270a858`, 15.09., v1.4.0).

## 2026-09-11 · Test fixtures advertised as built-in agent profiles
- **Wo:** HQ Teams/profile list, scripts/lib/hq-live-lib.mjs.
- **Was:** Regex scanning profiles.rs included test-only claude-omni and claudeomni (command x); capability fields were omitted and variant inheritance differed from Rust.
- **Repro:** hq-builtin-profiles.test.mjs failed before repair: eight profiles instead of the six shipped defaults.
- **Queue:** Pending; das damalige „HQv1 HTTP404" ist durch `.pa/report_hq_v1_runtime_migration.md` aufgeklärt (installiert war v1.2.3 ohne HQ v1; seit 15.09. v1.4.0). No legacy worker dispatched; work tracked in .pa/report_continuous_profiles.md. Einreihung am PC nachholen: `npm run hq:queue-open-points -- --apply` gegen die laufende App (Skript aus PR #43).
- **Status:** Fixed with a shared embedded JSON manifest, Rust-compatible HQ merging and runtime provenance warnings. HQ123/123, browser11/11 and two independent source reviews pass; full evidence in .pa/report_continuous_profiles.md. Gemergt mit PR #40 (Merge `270a858`, 15.09., v1.4.0).

## 2026-09-11 · Run candidate provenance and retry conflict status
- **Wo:** Rust HQ v1 run snapshot and task checkpoint API.
- **Was:** Current candidate binding was absent from the run response; premature retry returned HTTP500 instead of409.
- **Repro:** Snapshot binding/rebinding and retry conflict regressions in development_runs.rs and api.rs.
- **Queue:** Pending; das damalige „running app lacks HQv1 (HTTP404)" ist durch `.pa/report_hq_v1_runtime_migration.md` aufgeklärt (installiert war v1.2.3 ohne HQ v1; seit 15.09. v1.4.0). No legacy worker dispatched. Einreihung am PC nachholen: `npm run hq:queue-open-points -- --apply` gegen die laufende App (Skript aus PR #43).
- **Status:** Fixed in this persistence checkpoint; evidence in .pa/report_continuous_runtime.md. Gemergt mit PR #40 (Merge `270a858`, 15.09., v1.4.0).

## 2026-09-10 · Backend directory ownership lost overlap
- **Wo:** HQ task ownedPaths, src-tauri/src/store/continuous.rs.
- **Was:** A protected ancestor became a sentinel and no longer conflicted with ordinary files below it.
- **Repro:** Compiled Rust regression `protected_scopes_are_normalized_without_file_descendants` failed on queue.rs overlap before the fix.
- **Schwere:** blockierend (exclusive ownership).
- **Queue:** Pending; implementation tracked in .pa/task_continuous_devhq.md. No duplicate legacy worker dispatched. Einreihung am PC nachholen: `npm run hq:queue-open-points -- --apply` gegen die laufende App (Skript aus PR #43).
- **Status:** Fixed; gemergt mit PR #40 (Merge `270a858`, 15.09., v1.4.0). Final verification in .pa/report_continuous_runtime.md.

## 2026-09-10 · Profile editing lost metadata and accepted corrupt input
- **Wo:** Teams profile editor, scripts/lib/hq-live-lib.mjs.
- **Was:** Wrapper metadata could be dropped on save; malformed input could become an empty profile set and then be overwritten.
- **Repro:** scripts/lib/hq-profile-contract.test.mjs failed 3/3 before the fix and passes 3/3 after it.
- **Schwere:** blockierend (configuration loss).
- **Queue:** Pending; tracked by .pa/task_continuous_devhq.md. Das damalige „running app lacks HQ v1" ist durch `.pa/report_hq_v1_runtime_migration.md` aufgeklärt (installiert war v1.2.3; seit 15.09. v1.4.0). No duplicate executing legacy queue task was submitted. Einreihung am PC nachholen: `npm run hq:queue-open-points -- --apply` gegen die laufende App (Skript aus PR #43).
- **Status:** Fixed; gemergt mit PR #40 (`codex/continuous-devhq`, Merge `270a858`, 15.09.), released in v1.4.0.

## 2026-09-10 · Setup accepted Node 22 despite the Node 24 contract
- **Wo:** Live HQ Setup Helper, scripts/lib/hq-setup.mjs.
- **Was:** The setup check advertised an unsupported toolchain as ready.
- **Repro:** The Node 22 regression in scripts/lib/hq-continuous.test.mjs failed before the version floor was corrected.
- **Schwere:** stört.
- **Queue:** Pending; tracked by .pa/task_continuous_devhq.md, same implementation as above. Einreihung am PC nachholen: `npm run hq:queue-open-points -- --apply` gegen die laufende App (Skript aus PR #43).
- **Status:** Fixed; gemergt mit PR #40 (`codex/continuous-devhq`, Merge `270a858`, 15.09.), released in v1.4.0.

---

Append-only. Wer im Live-Dev-HQ (`npm run hq:live`) einen Bug findet, trägt
ihn **hier** ein und stellt zusätzlich einen echten Fix-Task in die Queue
(HQ → Human Controls → „task to queue", `POST /api/queue` direkt, oder für
die konsolidierten offenen Punkte `npm run hq:queue-open-points -- --apply`)
— siehe `AGENTS.md` § „Record and learn". Ein Eintrag hier ohne Queue-Task
ist eine Beobachtung, kein eingereihter Fix.

Neue Einträge oben anhängen (streng absteigend nach Datum), nichts
umschreiben oder löschen; überholte Vermerke werden durch einen datierten
Nachtrag korrigiert, nicht durch Streichen (so geschehen am 17.09., W1-05).
Format:

```
## YYYY-MM-DD · <Kurztitel>
- **Wo:** Karte/Panel/Aktion (z. B. "Providers-Karte", "Worker-Detail: Send")
- **Was:** was passiert vs. was erwartet wurde
- **Repro:** Schritte, die zuverlässig dorthin führen
- **Schwere:** blockierend / stört / kosmetisch
- **Queue:** Task-ID oder Queue-Eintrag-Text, der zum Fix eingereiht wurde
- **Status:** offen / in Arbeit / behoben (Commit/PR-Link)
```

Nichts einzutragen bedeutet nicht "kein Bug gefunden" — es bedeutet, dass
seit dem letzten Eintrag keiner *dokumentiert* wurde. Bei Zweifel: eintragen.

## 2026-09-22 · HQ post-merge verliert lokale Arbeit oder laesst Daten veraltet
- Wo: PR #38, .githooks/post-merge.
- Repro: scripts/lib/hq-post-merge.test.mjs war mit altem Hook 3/3 rot.
- Ursache: Keep-ours erzeugt keinen Ergebnis-Diff; Generator schreibt in lokale Ausgaben. Temp-Erzeugung braucht lessons.json als Eingabe.
- Fix: dirty/staged Schutz, temporaere Erzeugung mit Lessons, Paar validieren; 6/6 Regressionen gruen.
- Review: zwei unabhaengige Reviewer, alle drei Befunde angenommen, Delta frei.
- Beleg: .pa/report_pr38_followup_2026-09-22.md.
- Queue: ausstehend, App am 22.09. offline; kein Queue-Eintrag erfunden.

## Integrationsnachtrag 22.09.2026 — PR60

Die historischen Eintraege zum zurueckgezogenen Ollama-Coder-Modell und
zur kurzen native_handoff-Fixture-Frist haben einen Branch-Fix in PR60.
Modell jetzt deepseek-v4-flash:cloud, weiterhin Helper; TTL-Fix nur Testcode.
Zwei Reviews ohne Blocker, Integration/Checks siehe
.pa/report_pr60_integration_2026-09-22.md. Runtime- und installierter
Manifest-Beleg bleiben offen; kein neuer Queue-Eintrag behauptet.
# 2026-09-23 · Studio: Code-Chat, Kapazität und Einstellungen unsichtbar

- **Ursache:** Überzähliges HTML-Endtag in der Kontextsektion; nachfolgende Sektionen wurden außerhalb von `main` geparst und nicht durch `showView` aktiviert.
- **Regression:** `hq2-studio.smoke.cjs` scheitert vor Fix mit `chat must remain inside main`; nach Fix Navigation aller Sektionen grün.
- **Status:** Konzeptdatei repariert; Screenshot-Abnahme auf Nutzerwunsch in anderer Instanz. Bericht `.pa/report_hq2-studio-revision.md`.
- **Queue:** Pending; kein Live-Queue-Eintrag erstellt, keine Runtime-Verbindung für diese Sitzung belegt. Keine Queue-ID erfunden.

## 2026-09-23 · Studio Runtime-Regressionsschutz

- Kontext-/Eingabeverlust, veraltete Projektaktionen, Profilzuordnung, Advisor-Gewichtung, caps-Kopie und optionsJson korrigiert; jeweils rote Regression vor Fix.
- Disposition und Nachprüfungen: .pa/report_hq2-11.md.
- Offener Runtime-Beleg: Codex-Testworker/PTY gestartet, aber keine Modellantwort im Nachrichtenkanal beobachtet. Ursache nicht belegt.
- Queue: ausstehend. Normale Runtime ohne registriertes Projekt; isolierter Test ist kein Entwicklungsauftrag. Kein Queue-Eintrag behauptet.

## 2026-09-23 · PR70 CommonJS-Smoke im Red-first-Runner

- CI-Job 107138675387 scheiterte am vorhandenen Test-First-Verweis auf hq2-studio.smoke.cjs: nicht unterstützter Dateityp.
- Ursache: Node-Runner und Klassifikation akzeptierten nur .mjs.
- Fix: .cjs verwendet denselben node --test-Vertrag; Exit-Code-/Base-/Head-Prüfungen bleiben unverändert. Isolierte Regression in scripts/test-red-first.sh zuerst Exit 1, nach Fix grün.
- Queue: ausstehend; normales Runtime-Projekt weiterhin nicht registriert. Kein Queue-Eintrag behauptet.

## 2026-09-23 · Neue Roadmap: Zustandsanzeige, Import-Rennen und überladene Tabelle
- **Wo:** concepts/studio-roadmap.js, studio-workspace.js und Roadmap-CSS (DF06a, noch separater Worktree).
- **Was:** Geladene Projektion zeigte „Projekt auswählen“; Neuladen konnte einen laufenden Import überholen; die Tabelle wiederholte Titel und zeigte sehr hohe Zeilen. Unabhängige Reviews fanden außerdem ungeschützte ungültige Graphantworten.
- **Beleg:** Drei ausgeführte Verhaltensassertionen vor dem Fix rot, danach25/25 gezielte und212/212 HQ-Tests grün. Screenshots1280×800 und1920×1080 vor der Korrektur inspiziert;1280×800 nach der Korrektur bestätigt Status/Platzgewinn. Finaler Browserdurchgang durch getrennte Browser-Verbindung unterbrochen.
- **Fix:** Validierung, eindeutige Importzustände, Import-/Reload-Sperre, erweiterter Rollback-Dialog, Titel einmal und kurze Abnahmevorschau. SVG wird bei Dichtewechsel neu berechnet und hat gerichtete Pfeilspitzen. Offenzustände und sichtbarer Fokus bleiben auch bei Auswahl entfernter Pakete erhalten.
- **Queue:** Produktionsruntime für isolierte QA geschlossen; Queue-Nachführung ausstehend, kein Queue-Eintrag behauptet. Direkte Bearbeitung in Draft PR70 läuft.
- **Status:** Nach zwei unabhängigen Kimi-Reviews und gezielten Nachprüfungen integriert, final 28/28 gezielte und 215/215 HQ-Tests. R2-Graph/Table-Screenshots inspiziert; R3-Disclosure-Korrektur mit Verhaltensregression und Nachreview belegt. Gesamtintegrationsgates und spätere Live-Ausführungszustände bleiben getrennt.
