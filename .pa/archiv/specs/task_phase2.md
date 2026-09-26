# Task-Spec: Phase 2 — Betriebsblindheit & App-Härtung (Ausführungsplan)

Status: historisch

> **Status: HISTORISCH — durch `docs/SANIERUNGSPLAN.md` Rev 9 (03.09.2026)
> ersetzt. Nicht mehr ausführen.** Insbesondere P2-B (Web-Ausbau), P2-E
> (Multi-Instanz) und die alte Oberflächenaufteilung sind nicht mehr bindend.

Datum: 2026-09-01 · Autor: Kimi · damaliger Status: **Rev 2 nach Dual-Review Runde 1**
(GLM: ÜBERARBEITEN, 17 Befunde; Gemini: ÜBERARBEITEN, 5 Befunde — Disposition
in `.pa/review_phase2_{glm,gemini}.md` bzw. Tabelle unten). Nutzer-Entscheidungen
vom 01.09.: Logging handgerollt, NT-6-Token-Feld wird entfernt, CSP restriktiv
mit Dev-Build-Gate.

## Kontext und Belege

Sanierungsplan §4 Phase 2 (3–5 AT), verzahnt mit Strang O. Rev-7-Belege:
NT-5 (Agenten-Fehler erreichen den Dialog nicht), NT-6 (Updater-Check ohne
Token funktional tot — hoch), NT-8 (zweite Instanz ohne Hinweis), NT-10
(Web-Interface-Token nur per SQLite-Hand-Edit). Vollbelege:
`docs/audits/2026-09-01-nutzungs-test-v1.2.1.md`.

Code-Kartierung (Explore 01.09.) + Review-getriebene Nachverifikation:

- `worker:status`-Payload trägt `attention_reason: Option<String>`
  (`status.rs:309-312`, publiziert status.rs:961, emit main.rs:2226). Quota-
  Heuristik erzeugt `Verdict::with_reason(COL_NEEDS_YOU, …)` (status.rs:343).
  → **P2-D braucht kein neues Event und keine Nahtstelle** (GLM-2 aufgelöst).
- `tauri.conf.json` Updater-Block: pubkey + endpoint + `installMode passive`,
  **keine** headers (GLM-10 verifiziert — P2-A muss die Config nicht anfassen).
- Capabilities: nur `capabilities/default.json` (core:default, updater:*,
  process:allow-restart). Kein opener/dialog/notification/log-Plugin.
- Kein Toast-System; Fehler = view-lokale `convo-error`-Flächen
  (ConversationView.tsx:129-146). Kein Logging-Framework, 68× `eprintln!`,
  kein Panic-Hook. `redact.rs` liefert chunk-sichere Maskierung.
- `api.rs` schreibt beim Start `projecta-api.json` {port, token} (CSPRNG) ins
  App-Data — die Control-API startet **immer** (pa-Bridge), unabhängig vom
  Web-Interface (GLM-5 aufgelöst: Deskriptor ist immer da).
- `openExternal` (`src/lib/ipc.ts:1793-1800`): opener-invoke schlägt immer
  fehl (Plugin nie registriert) → faktisch `window.open`-Fallback.
- `SettingsView.tsx:365-368`: ohne Token kein Check, Button nicht gerendert
  (`:877-881`); Token in localStorage.
- Sprach-Audit Top-5: StatisticsView 23, SettingsView 17, ConversationView 15,
  QuestionsView 14, QueuePanel 12 deutsche String-Zeilen. Keine i18n-Abstraktion.

## Leitplanken

- Nahtstellen (`api.rs`, `main.rs`, `store.rs`, `bin/pa.rs`) nur auf L-Int,
  seriell. **`src/lib/ipc.ts` ist für diese Phase ebenfalls L-Int-only**
  (Review-Befund GLM-1/Gemini-1: zwei Pakete wollten sie gleichzeitig).
- Beweismaßstab: roter Test zuerst (kompiliert + schlägt fehl), Screenshot
  für Gestaltung, Messung für Verhalten. Grün-Regel: Test+Fix gemeinsam grün.
- Gates je Paket: cargo test/clippy/fmt/build + npm typecheck/test/lint/build.
- Keine neuen Dependencies (Nutzer-Entscheidung: Logging handgerollt).
- Heavy-Budget ≤5 schwere Agenten global, Reviews mitgezählt.
- Modelle: kein Kimi/Claude als Worker. App-Worker: `opencode-glm-53-flash`,
  Fallback `opencode-free`. Server: `launch.sh <name> auto/coding:reliable`
  (Preflight 01.09. OK). Bei „adaptive thinking is not supported" sofort
  stoppen → O-0.
- Dual-Review für diesen Plan (2 Runden) und für Diffs >300 Z. / Nahtstellen.
- Worker-Reports müssen enthalten: roter-Test-Beleg (Fehlerausgabe),
  Gates-Ausgabe, `git diff --name-only <base>...HEAD` (Dateigrenzen, M9).
- Worker-Briefs referenzieren **jede Datei als absoluten Pfad** (Worktree-Root
  ausgeschrieben; Gemini-r2-2/r3 — gegen Pfad-Halluzinationen).

## Arbeitspakete

### P2-A — Updater-Tab an den Mirror-Kanal (NT-6, hoch) — Lane: App-Worker
- **Dateien:** `src/components/SettingsView.tsx`,
  `src/components/SettingsView.updates.test.tsx` (neu). **Keine** anderen.
- **Inhalt:** Token-Feld + localStorage-Pfad komplett entfernen; `check()`
  ohne Authorization-Header; „Check for updates"-Button immer rendern;
  Copy **englisch** (der Tab ist bereits englisch — GLM-3: keine deutschen
  Neutexte, die P2-G2 gleich wieder übersetzt); Hinweistexte 869-881
  ersetzen durch ehrliche Mirror-Beschreibung.
- **Akzeptanz:** Roter jsdom-Test zuerst (Button ohne Token gerendert +
  `check` ohne Authorization-Option aufgerufen — schlägt heute fehl).
  Wire-Beleg ist der stehende anonyme curl auf die Mirror-latest.json
  (zuletzt v1.2.3: 200). Screenshot des Tabs.
- **Hinweis:** Der eigentliche HTTP-Request läuft Rust-seitig (reqwest im
  Updater-Plugin) — CSP betrifft ihn nicht (GLM-4 abgelehnt, s. Tabelle).

### P2-B — Web-Interface ohne Hand-Edit (NT-10) — Lane: **L-Int (ich)**
- **Dateien:** `src-tauri/src/web_interface.rs`, `src-tauri/src/main.rs`
  (Kommando-Registrierung), `src-tauri/src/store.rs` (Setting schreiben),
  `src/components/WebInterfacePanel.tsx`, `src/lib/ipc.ts` (L-Int!).
- **Inhalt:** IPC `set_web_interface_config { bind?, token? }` +
  `generate_web_interface_token` (CSPRNG wie `api.rs new_token`); Panel:
  Token-Feld + „Generieren" + Bind-Auswahl + komplette URL kopierbar.
  **Token-Geltung ohne Neustart:** `authorized()` liest den Token pro Request
  aus der settings-Tabelle (`web_interface.rs:563-582` — das bei der Umsetzung
  verifizieren und per Rust-Test belegen: neuer Token gilt sofort für den
  laufenden Server). **Bind-Änderung braucht weiterhin Neustart** (Listener-
  Socket) — das Panel sagt das ehrlich.
- **Akzeptanz:** Rust-Test (Setting-Roundtrip, Token 32 Hex, Token gilt
  sofort), vitest Panel, Screenshot; roter Test zuerst.
- **Gate-Zusatz:** `git diff --name-only` darf ipc.ts nur zusammen mit den
  genannten Dateien zeigen (M9).

### P2-C — Logging + Panic-Hook + Redaction — Lane: **L-Int (ich)**
- **Dateien:** neu `src-tauri/src/logging.rs` (**eigenes Modul, eigene Makros,
  kein `log`-Crate** — Budget ~150 Zeilen), `src-tauri/src/main.rs`.
- **Inhalt:** File-Log `<app data>/logs/projecta.log` (Rotation bei 1 MiB,
  5 Dateien). **I/O entkoppelt (Gemini-r2):** das Makro formatiert + maskiert
  (`redact::Redactor`) und sendet die fertige Zeile über einen
  `std::sync::mpsc`-Channel an einen einmalig gestarteten Writer-Thread, der
  blockierend schreibt und rotiert — kein Sync-I/O im Aufrufer. Panic-Handler
  als testbare Funktion `handle_panic(info)` (GLM-13), die ins Log schreibt
  und den Marker `.panic-last` anlegt; `main.rs` prüft den Marker beim Setup,
  **rotiert ihn zu `.panic-previous`** (nicht löschen — P2-H schnürt ihn ins
  Diagnose-Paket, Gemini-r2) und zeigt einen Start-Hinweis. `eprintln!`-
  Altstellen bleiben unangetastet; neue Laufzeit-Logs ab jetzt über
  logging.rs.
- **Akzeptanz:** Unit-Tests (Logzeile redacted im File; Rotation; handle_panic
  schreibt Marker+Log); Messung: Datei existiert nach App-Start; Dev-Build
  verifiziert Registrierung.

### P2-D — Fehler-Kanal in den Dialog (NT-5) — Lane: App-Worker
- **Dateien:** `src/components/ConversationView.tsx`,
  `src/lib/orchestratorChat.ts`, Testdatei daneben. **`src/lib/ipc.ts` ist
  tabu** (L-Int) — der `worker:status`-Listener muss aus dem vorhandenen
  Datenfluss kommen; reicht das nicht, stoppen und eskalieren.
- **Inhalt:** Wenn der **im Dialog aktive** Agent einen Quota-/Laufzeitfehler
  trägt (`attention_reason` im worker:status-Payload — Payload gilt pro
  worker_id, **Matching auf den aktiven Agenten ist Pflicht**, GLM-r2-6:
  Fehler von Hintergrund-Agenten dürfen die Fläche nicht auslösen), zeigt der
  Dialog eine abweisbare Fehlerfläche (Muster `convo-error`) mit
  „was tun"-Hinweis.
- **Akzeptanz:** roter vitest zuerst (Fehlerzustand → Fläche sichtbar),
  visuell im Dev-Build.
- **Nachtrag aus dem P2-J-Review (02.09., GLM-1/Gemini-2):** `openExternal`
  in `ipc.ts` wirft jetzt, wenn das Opener-Plugin verweigert **und** der
  Webview das Pop-up blockiert (vorher: stilles `void`). Die drei Aufrufer
  (`BoardView.tsx:445`, `RecommendationsPanel.tsx:305`,
  `WebInterfacePanel.tsx:141/152`) rufen `void openExternal(url)` und lassen
  die Rejection unbehandelt. P2-D hängt sie an denselben Fehler-Kanal (Toast
  oder `convo-error`-Fläche) — entweder Dateigrenze um die drei Komponenten
  erweitern oder als Mini-Paket P2-D2 direkt danach. Roter Test: Klick auf
  den PR-Link mit gemocktem Plugin-Fehler + `window.open → null` zeigt die
  Fehlerfläche.

### P2-E — Multi-Instanz-Deskriptor (NT-8) — Lane: **L-Int (ich)**
- **Dateien:** `src-tauri/src/main.rs`, `src-tauri/src/api.rs`, Frontend-Hinweis
  `src/App.tsx`.
- **Inhalt (Reihenfolge ist der Fix, Gemini-r2-1):** **Erst lesen und proben,
  dann schreiben.** Beim Start: existiert `projecta-api.json`, probe die darin
  genannte Control-API **token-authentifiziert** (`GET /api/projects` mit dem
  gelesenen Token; 200 = andere Instanz lebt, 401/refused/timeout = Leiche).
  - **Probe live:** Banner „Zweite Instanz — gleiche Datenbank, zwei
    Dispatcher" + Kennung (eigener Port/PID) in der Statusbar; die zweite
    Instanz schreibt ihren Deskriptor als `projecta-api-<pid>.json` und lässt
    die kanonische Datei der ersten Instanz unberührt (deren pa-Erreichbarkeit
    bleibt intakt).
  - **Probe tot** (oder mtime > 24 h): Leiche — die kanonische Datei wird wie
    bisher vom eigenen Start überschrieben (GLM-r2-4: Übernahme explizit, als
    Test abgedeckt).
  Kein harter Lock (8.6: Multi-Instanz gewollt, nur sichtbar).
- **Akzeptanz:** Rust-Tests: die **Probe-Entscheidung ist eine reine Funktion**
  (`decide_descriptor_action(probe: ProbeResult) -> DescriptorAction`,
  GLM-r3-1 — kein HTTP im Test); HTTP-Prober (200/401/refused/timeout) gegen
  einen lokalen Test-Server; Leichen-Übernahme; Instanz-Nebendeskriptor.
  Screenshot Zweitstart mit Banner (L-Int-Integration, per CDP).

### P2-F — Plugin-/Capability-Matrix + CSP + opener — Lane: Server-Worker
- **Dateien:** `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`,
  `src-tauri/Cargo.toml` (tauri-plugin-opener), `src/lib/markdown.ts`,
  `docs/plugin-matrix.md` (neu). **NICHT** `src/lib/ipc.ts` (L-Int — die
  openExternal-Umstellung erfolgt bei der Integration durch mich, nach P2-B).
- **Vor-Schritt (Pflicht, GLM-4/Gemini-5):** alle webview-seitigen
  Verbindungen enumerieren (`fetch(|WebSocket|EventSource|open(` in `src/`)
  — Erwartung: nur IPC. Ergebnis in den Report; CSP deckt exakt das.
- **Inhalt:** Matrix-Tabelle (Plugin × Permission × Begründung);
  `tauri-plugin-opener` registrieren; in `capabilities/default.json` die
  Permission `opener:allow-open-url` **mit hartcodiertem URL-Scope**
  (Whitelist-Muster, z. B. `https://github.com/**` — finales Muster gegen das
  Plugin-Schema der installierten Version prüfen und im Report benennen,
  GLM-9/Gemini-r2-4); Domain-Allowlist zusätzlich im Code (L-Int-Teil).
  CSP unter **`app.security.csp`** (Tauri-2-Pfad, GLM-8) restriktiv setzen —
  **gleiche CSP in Dev und Prod**; das Gate ist die *Verifikation im
  Dev-Build* (App läuft, Konsole ohne CSP-Verletzungen, Screenshot), **kein**
  Config-Split per cfg (GLM-r2-3 abgelehnt: Nutzer-Entscheidung meinte
  Verifikation, nicht Aufweichung). Config-Assert-Test prüft Pfad **und**
  Wert (Muster `src/updater-config.test.ts`).
- **Akzeptanz:** Config-Test grün (rot zuerst), Capability-Assert-Test
  (Scope-Muster vorhanden), vitest: `markdown.ts` rendert Links so, dass der
  Klick den opener-Invoke auslöst (GLM-r2-5: Browser-Öffnen selbst ist
  **L-Int-Integrations-Schritt** per CDP, nicht Worker-Pflicht). Dev-Build-
  Console-Screenshot.

### P2-G — Sprachdurchgang Englisch — Lane: 2 App-Worker, sequentiell
- **Glossar zuerst:** `docs/glossary-en.md` (ich, 20 Min: Warteschlange→Queue,
  Einreihen→Enqueue, Schärfen→Sharpen, Verlauf→History, Empfehlungen→
  Recommendations, Fragen→Questions, Aktivität→Activity, Statistik→Statistics,
  Einstellungen→Settings, Bereit→Ready …).
- **G1:** StatisticsView, QueuePanel, QuestionsView, ViewBar, UsageView.
- **G2 (erst nach den Merges von P2-A, P2-D **und** P2-E — SettingsView,
  ConversationView **und** App.tsx sind dann frei, GLM-r2-1):** SettingsView
  (Rest), ConversationView, App.tsx, übrige.
- **Akzeptanz (GLM-14):** `scripts/glossary-check.mjs` (neu, klein): jeder
  geänderte UI-String ist im Glossar oder als Ausnahme markiert; npm test
  grün; Screenshot-Matrix der geänderten Views; Lint-Budget eingehalten.
  Docs/Code-Kommentare bleiben deutsch (8.3).

### P2-H — Diagnose-Paket — **nach P2-C-Merge**, Lane: L-Int
- Settings-Tab „Diagnose": Log-Pfad anzeigen/öffnen (opener), „Paket
  schnüren" (logs + settings ohne Secrets + DB-Metadaten als zip ins
  App-Data), „Warum?"-Sicht je Worker (letzte Guard-/Status-Events aus
  `status_events`). Wird bei P2-C-Integration final geschnitten.

## Reihenfolge (Review-Slots explizit, GLM-11)

```
Welle 1:  App-W1: P2-A          ‖ Server-W: P2-F        ‖ ich: Glossar + P2-C-Start
Review:   P2-A + P2-F (parallel, beide <300 Z. → Einzelreview reicht,
          >300 Z. → Dual)
Welle 2:  ich: P2-C fertig → Dual-Review (Nahtstelle)
          App-W1: P2-D          ‖ App-W2: P2-G1
Welle 3:  ich: P2-E → Dual-Review; danach P2-B → Dual-Review
          App-W2: P2-G2 (nach P2-A/P2-D-Merges)
Welle 4:  ich: P2-H; Integration; Release v1.2.4 (kohärente Schnitte §0.4,
          ggf. zwei Schnitte: A+F früh, Rest danach)
```

## Dogfood / Bug-Jagd

- App-Worker laufen in der installierten v1.2.3 auf dem ProjectA-Repo
  (Projekt „ProjectA", repo `.`) — erste Live-Bewährung des NT-3-Fixes.
- Beobachtung meinerseits: Screenshots, `pa board`, `pa activity`,
  Statusbar; jede Auffälligkeit → Notiz in den Phasen-Report (NT-17+).

## Review-Disposition Runde 1

| # | Befund | Entscheidung |
|---|---|---|
| GLM-1 + Gemini-1 | ipc.ts-Kollision P2-B/P2-F | **angenommen** — ipc.ts ist L-Int-only; P2-F ohne ipc.ts; openExternal-Umstellung bei Integration |
| GLM-2 | P2-D-Lane unentschieden | **angenommen** — verifiziert: `worker:status` trägt `attention_reason`; P2-D frontend-only, App-Worker |
| GLM-3 | P2-A deutscher Copy → Doppelarbeit | **angenommen** — P2-A schreibt direkt englisch |
| GLM-4 | CSP blockiert Mirror-Update | **abgelehnt** — Updater-Request läuft Rust-seitig (reqwest), CSP gilt nur für die Webview; der Generik-Punkt (erst enumerieren) ist als P2-F-Vor-Schritt übernommen |
| GLM-5 + Gemini-4 | Instanz-Erkennung: falscher Deskriptor / blinder Probe | **angenommen, verschmolzen** — projecta-api.json (startet immer) + token-authentifizierter Probe |
| GLM-6 | P2-H nicht eingeplant | **angenommen** — Slot nach P2-C, L-Int |
| GLM-7/16 | `log`-Crate-Widerspruch | **angenommen** — eigenes Modul, eigene Makros, ~150 Zeilen |
| GLM-8 | Tauri-2-CSP-Pfad verifizieren | **angenommen** — `app.security.csp` + Pfad-assertierender Test |
| GLM-9 | opener-Permission-Schema | **angenommen** — Permission+Scope aus installiertem Plugin-Schema, im Report benennen |
| GLM-10 | Updater-headers in tauri.conf.json? | **angenommen als verifiziert** — keine headers vorhanden, P2-A fasst Config nicht an |
| GLM-11 | Review-Last ohne Slot | **angenommen** — explizite Review-Slots |
| GLM-12 | Akzeptanz „mit Token" nicht testbar | **angenommen** — Kriterium umformuliert (kein Fallback; check ohne Authorization) |
| GLM-13 + Gemini-3 | Panic-Hook untestbar / Marker fehlt | **angenommen** — `handle_panic` extrahiert + `.panic-last`-Marker |
| GLM-14 | P2-G Snapshots prüfen nichts | **angenommen** — glossary-check-Skript |
| GLM-15 | Token-Logik als versteckter Fallback behalten | **abgelehnt** — unsichtbarer Hand-Edit-Pfad wäre NT-10s Krankheit; Nutzer hat Entfernung entschieden |
| Gemini-2 | jsdom kann Header nicht beweisen | **angenommen mit Anpassung** — jsdom prüft die Frontend-Übergabe (kein Authorization in den Optionen), Wire-Beleg = anonymer curl |
| Gemini-5 | CSP killt evtl. Server-Traffic | **angenommen als Prüfschritt** — Enumeration vorab (Erwartung: nur IPC) |

## Review-Disposition Runde 2

| # | Befund | Entscheidung |
|---|---|---|
| GLM-r2-1 | P2-G2 ↔ P2-E kollidieren an `App.tsx` | **angenommen** — G2 wartet zusätzlich auf den P2-E-Merge |
| GLM-r2-2 | P2-B: Token-Geltung im laufenden Server unklar | **angenommen** — per-Request-Read in `authorized()` verifizieren + testen; Bind-Änderung braucht Neustart (UI sagt es) |
| GLM-r2-3 | CSP Dev-Gate als cfg-Split | **abgelehnt** — Nutzer-Entscheidung meinte *Verifikation* im Dev-Build, nicht Aufweichung; gleiche CSP in Dev+Prod |
| GLM-r2-4 | Leichen-Deskriptor-Verhalten unklar | **angenommen** — Übernahme explizit + Rust-Test |
| GLM-r2-5 | Browser-Öffnen nicht worker-prüfbar | **angenommen** — Unit-Test beim Worker; Browser-Check per CDP bei L-Int-Integration |
| GLM-r2-6 | `attention_reason` ohne worker_id-Matching | **angenommen** — Matching auf den aktiven Agenten ist Pflicht |
| Gemini-r2-1 | Race: Instanz B überschreibt `projecta-api.json` vor der Probe | **angenommen** — erst lesen+proben, dann schreiben; Zweitinstanz schreibt `projecta-api-<pid>.json` und lässt die kanonische Datei unberührt |
| Gemini-r2-2 | Absolute Pfade in Worker-Briefs | **angenommen** — Briefs nennen das absolute Worktree-Root |
| Gemini-r2-3 | `.panic-last` löschen sabotiert P2-H | **angenommen** — Rotation zu `.panic-previous` statt Löschung |
| Gemini-r2-4 | Opener-Scope gehört in die Capability-JSON | **angenommen** — hartcodiertes URL-Scope-Muster + Assert-Test |
| Gemini-r2-5 | Blocking-I/O im handgerollten Logging | **angenommen** — mpsc-Channel + Writer-Thread |

## Review-Disposition Runde 3 (Delta)

| # | Befund | Entscheidung |
|---|---|---|
| GLM-r3-1 | P2-E-Probe nicht unit-testbar ohne Extraktion | **angenommen** — reine Entscheidungsfunktion `decide_descriptor_action` ist Pflicht im Akzeptanz |
| Gemini-r3 | FREIGEBEN unter Prämisse absolute Pfade in Briefs | **umgesetzt** — Leitplanken fordern absolute Pfade für jede Datei-Referenz im Brief |

**Plan-Status: freigegeben zur Ausführung** (3 Runden × 2 Reviewer;
GLM r1 17 Befunde, Gemini r1 5, GLM r2 6, Gemini r2 5, GLM r3 1 — alle
disponiert).

## Nicht-Ziele

Strang-O-Umbauten (O-1+), Phase-3+-Themen, Test-Ausbau über Paket-Tests hinaus.
