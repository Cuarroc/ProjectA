# PLAN — der einzige Plan für ProjectA

Stand: 04.10.2026 (Paket PLAN-SYNC-06 auf `origin/main` effef1a, abgeglichen mit `gh pr list`/`gh pr view`; davor PLAN-STATUS-03 auf 6598890, PLAN-SYNTHESIS-03 auf 1b38596 und PLAN-SYNC, 02.10.2026).
Dieses Dokument ist der **einzige** Plan. `docs/MASTERPLAN.md` ist nur noch ein
Verweis hierher; die alten Fassungen von PLAN, MASTERPLAN und STAND liegen
unverändert unter `.pa/archiv/` (`*_2026-09-24.md`). Ältere Pläne:
`docs/archive/plaene-2026-09/`. Wer hier nichts findet, arbeitet an nichts.

## Für den Nutzer

1. **Nächster Meilenstein:** M2 „Überblick und Setup“ (M1 „Alles Laufende
   gelandet, App startbar“ ist erreicht, 26.09.2026). Was noch offen ist, steht
   in der Tabelle M2 (Spalte „Stand“).
2. **Was du entscheiden musst:** die Entscheidungs-Inbox unten. Fragen kommen
   gebündelt dorthin, nicht einzeln in den Chat.
3. **Was du am PC tun musst:** W1-20 (zweites Setup), SETUP-14, später W3-02,
   W3-03, W3-07 und die Abnahme jedes Meilensteins.

4. **Bis v1.5.0 keine neuen Funktionen** (Nutzer 04.10.): neue Ideen kommen nur
   in den Abschnitt „Später“; danach folgt M5.

**Ziel ab 04.10.: v1.5.0 releasefähig** (Tag und Veröffentlichung macht der
Orchestrator, sobald alle Gates und die 27 Matrixzeilen belegt sind).

**Ziel:** ProjectA und das DevHQ sind auf dem PC des Nutzers voll benutzbar und
werden zum Entwickeln von ProjectA selbst eingesetzt; danach wird der Continuous
Mode abgenommen und mit v1.5.0 freigeschaltet. **Baseline:** v1.4.1 (22.09.2026,
`3bcaed3`) ist der jüngste Release; alles danach liegt nur auf `main`.

## Meilensteine

| M | Titel | Abnahme in Alltagssprache |
|---|---|---|
| M1 | Alles Laufende gelandet, App startbar | Keine offenen Paket-PRs aus M1, `main` grün. Die App startet vom aktuellen `main`, ohne dass alte Queue-Einträge Agenten losschicken; tote Einträge lassen sich gezielt verwerfen (W1-05b). |
| M2 | Überblick und Setup | Du fragst Claude „Was heißt das?“ und bekommst eine einfache Antwort. Ein Skript schreibt Status und Tagesbericht. Ein Plan, zehn Regeln, gestufte Reviews. Ein roter `main` hält die Queue an. Limits und RAM werden vor jedem Worker-Start geprüft. Backup läuft. |
| M3 | App im Alltag + Zwischenrelease v1.5.0-beta | Du installierst v1.5.0-beta über den Updater. In der installierten App gibst du drei echte kleine Aufgaben an Agenten, verfolgst sie im HQ, prüfst den Diff in der App, und der PR landet über die Queue. Das HQ ist hell und dunkel lesbar (Screenshots angesehen, auch die DF-07-Dichte). |
| M4 | Dauerbetrieb abgenommen, v1.5.0 | Du schaltest den Continuous Mode selbst ein. Ein Not-Aus stoppt alles in 10 Sekunden. Alle 27 Zeilen der Abnahmematrix haben einen Beleg oder ein Nutzer-Gate. Update-Drills sind am PC durchgespielt. Du installierst v1.5.0. |
| M5 | Aufräumen und erste Tester (nach v1.5.0) | 3–5 externe Tester haben v1.5.0 benutzt, ihre Rückmeldungen sind festgehalten. Die Architektur-Befunde sind abgearbeitet, `docs/architecture-rules.md` gibt es und ein Drift-Gate läuft in der CI. Die vier Nahtstellen sind kleiner als bei v1.5.0. ProjectA ersetzt die externen Orchestrierungs-Skripte Schritt für Schritt. |

Lane-Schlüssel: `st` store.rs + store/ · `api` api.rs · `mn` main.rs · `pa`
bin/pa.rs (diese vier sind Nahtstellen, je ein aktives Paket) · `pty` pty.rs ·
`wk` workers.rs/profiles.rs · `sup` supervisor.rs · `ci` .github/ + scripts/ci/ ·
`hqL` Legacy-HQ (hq.js, hq.css, hq-parse.mjs, hq-live.mjs) · `hqS`
docs/dev-hq/concepts/ · `fe` src/ · `fR` nahtstellenfreies Rust · `doc` Doku und
scripts/dev · `N` Nutzer/PC. Welches Modell welches Paket nimmt:
`docs/setup/providers.md`. Stand-Spalte: `✓ #n` = gemergt, sonst offener PR
oder „offen“ (Momentaufnahme; den Live-Stand liefert OPS-01). **`alt-#n`** ist
eine Nummer aus der Zählung vor dem öffentlichen Import; sie ist nicht prüfbar und
kollidiert mit heutigen PRs (Beispiel: alt-#124 in W2-01b, heute #124 = W5-04c).
Nummern ohne Präfix in den Zeilen ab alt-#128 abwärts sind nicht einzeln nachgeprüft.

### M1 — Alles Laufende gelandet, App startbar ✓ erreicht

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| W2-03 | Usage-/Billing-Collectors je Adapter | M | st | ✓ alt-#140 |
| W2-06 | Supervisor: Producer-Audit und Runtime-Notifications | M | mn + sup | ✓ alt-#152 |
| W2-08a | Ressourcendruck- und Streaming-Enforcement | M | fR | ✓ alt-#134 |
| W2-04f | Planungsendpunkte nur für den Koordinator | S | api | ✓ alt-#135 |
| W2-01b | Review-Route nimmt `reviewerRunId` aus dem Credential | S | api | ✓ alt-#124 |
| W2-01c | `approvalAuthority` in agent_access.rs angleichen | S | fR | ✓ alt-#150 |
| W1-15c | Übrige Mutex-Stellen in pty.rs | S | pty | ✓ alt-#137 |
| W1-23c | „-0 Tokens“-Anzeige, MSRV gemessen | S | fR | ✓ alt-#136 |
| W1-29 | Linux-Flake im Prozessgruppen-Test | S | fR | ✓ alt-#138 |
| W1-21c | xterm-`pageerror` beim Mount | S | fe | ✓ alt-#151 |
| SETUP-04 | AGENTS.md: Mergify, Reviews, Build-Slots | M | doc | ✓ alt-#132 |
| HOOK-01 | Hook-ROOT-Fix einzeln vor CI-02 (Nutzer 25.09.) | S | ci | ✓ alt-#156 |
| W1-05b | Sichere Cancel-Regel für `dispatched`, Dedup der toten Tasks; erst st-Kind, dann api-Kind; Zahl der toten Einträge read-only nachzählen | M | st → api | ✓ #19 |
| W1-03e | `MSG_USER` erst nach bewiesener Zustellung (F-CORE-3 B.3) | S | wk | ✓ alt-#171 |
| W1-20 | Zweites Setup reproduzieren (Node 24, `npm ci`, `dev:setup`, `dev:doctor`) | S | N | ✓ alt-#166 |
| CI-02 | Leichter main-Push, Docs-only, Dependabot im red-first (enthält W1-19b) | S | ci | ✓ alt-#133 |
| CI-03 | Actions-Kosten senken: CI nur bei „ready“ und in der Queue, Windows nur in Queue und Wochenlauf, Budgetstopp ab 80 % | M | ci | ✓ alt-#149 |
| SETUP-08 | Git-/PR- und Plan-Helfer unter `scripts/dev` (08a + 08b) | M | doc | ✓ #22 |
| SEC-01 | Geheimnis-Scan (gitleaks) als precommit-Gate | S | ci | ✓ #20 |

### M2 — Überblick und Setup

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| M2-FRAG | Frag-mich-Skill für Einsteiger-Erklärungen | S | doc | ✓ alt-#161 |
| PLAN-01 | Ein Plan, zehn Regeln, gestufte Reviews, PR-Text ist der Bericht, Archiv | M | doc | ✓ #26 |
| PLAN-SYNC | Gemergte Pakete seit 25.09.2026 und M1-Status im Plan nachführen | S | doc | ✓ #45 |
| OPS-01 | Status und Tagesbericht per Skript aus GitHub und git (was läuft, was fertig ist, was du entscheidest) | M | doc | ✓ alt-#164 |
| OPS-02 | Startcheck vor jedem Worker: Modell beobachtet, Limit, freier RAM, laufende Cargo-Builds; harte Stopps | S | doc | ✓ #35 |
| CI-04 | Roter `main` stoppt die Queue: Issue mit Run-ID, Label, Queue-Pause | S | ci | ✓ #28 |
| W1-21d | Suchschalter im Scrollback (Groß-/Kleinschreibung, Regex) | S | fe | ✓ #27 |
| W1-30 | Flake `omniroute::…management_failures_keep_their_http_and_network_classes` (100-ms-Timeout) | S | fR | ✓ #32 |
| CLEAN-01 | Toten Code löschen: npm `@tauri-apps/plugin-process`, drei ungenutzte TS-Funktionen und Exporte (Prüfung B, S6) | S | fe | ✓ #31 |
| CLEAN-02 | Stillgelegten Queen-Anlegepfad löschen (Trait-Methode in api.rs, Umsetzung in main.rs, drei Funktionen in workers.rs) | S | api → mn → wk | ✓ #25 |
| W1-17 | HQ-Parser: prüfen, ob OPS-01 oder DF-06a ihn überholt haben; sonst auf die Meilenstein-Tabellen umstellen. Bis dahin zeigt der eingecheckte HQ-Snapshot (`docs/dev-hq/data.js`/`data.json`) die alten F-Meilensteine als „waiting“ — bekannter Zwischenstand, kein Datenfehler | S | hqL | ✓ #38 |
| SETUP-09 | Lokaler Review-Lauf `scripts/review/run-local.sh` | S | doc | ✓ #39 |
| SETUP-12 | Rest des Docs-only-Pfadfilters, soweit CI-02/CI-03 ihn nicht abdecken | S | ci | ✓ #36 |
| SETUP-14 | Nutzer: tote Keys, OpenCode-Modelle, `ollama signin`, Permission-Regeln | S | N | teilweise: `ollama signin` und OpenCode-Modelle geprüft (02.10.); offen: tote Keys, Permission-Regeln |
| SETUP-15 | Abschlussreview der Setup-Doku, verkleinert | S | doc | ✓ #51 |

PC-Setup außerhalb des Repos (Orchestrator, Nutzerentscheidungen 25.09.):
Backup mit Kopia nach Google Drive, TypeScript-Sprachserver und PowerShell-Profil,
Statuszeile mit Limits, Lernpfad in Häppchen, ruflo/oh-my-claudecode aus,
Gedächtnis = eingebautes Claude-Gedächtnis plus memorix.

### M3 — App im Alltag + Zwischenrelease v1.5.0-beta

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| HQ2-02 | Abnahme der Konzeptdemo und Studio-Variante; legt die Richtung für „HQ als Hauptbereich der App“ fest | M | hqS + N | ✓ entschieden (Nutzer 04.10., E1: Mix) |
| HQ2-03 | Gemeinsame Design-Tokens hell/dunkel, nach HQ2-02 | M | hqS | freigegeben (Nutzer 04.10.); offen |
| W1-10 | HQ-Stylesheet: Kontrast-Gate auf hq.css, Light Mode, `prefers-contrast` | M | hqL | ✓ #33 |
| M3-01 | Drei deutschsprachige Aufgaben-Vorlagen mit eingebautem Abnahmekriterium (nur Doku) | S | doc | ✓ #144 |
| W2-10 | Live-HQ-Views (vor Dispatch teilen: 10a Ziele/Teams, 10b Routing/Budget, 10c Review/Delivery) | M | hqL | 10a ✓ #13, 10b ✓ #21, 10c ✓ #62 |
| W5-02b7 | HQ-Profilansicht zeigt `envPolicy` | S | hqL | ✓ #58 |
| W5-02a | Koordinator ohne Schreibpfad | M | wk | ✓ #24 |
| W5-22 | Konfliktvorhersage und Lane-Guard | M | fR | ✓ #9 |
| W5-28 | Automatischer Laufzeitbeleg (Sandbox, Queue aus) | M | fR | ✓ #11 |
| W5-00b | Fremden Text in workers.rs-Prompts suchen und einhüllen | S | wk | ✓ #18 |
| W2-04e | `dispatch.role` ins Agenten-Briefing | S | wk | ✓ #50 |
| W2-01d | CLI-Befehl `pa hq agent review` | S | pa | ✓ #46 |
| W1-18b | Probe, ob Codex/OpenCode `.agents/skills` lesen | S | wk + N | OpenCode ✓ #30, Codex △ headless-Probe 02.10.2026: `projecta-workflow` gemeldet, direkte Dateisystemabfrage durch Read-only-Policy blockiert |
| W1-01b | Kimi-Re-Smoke mit `PROJECTA_PTY_TRACE_DIR` | S | pty | gestrichen (Nutzer 04.10.: Kimi-Abo abgelaufen; Smoke ✓ #192) |
| W1-27 | KI-20, doppelte `ESC[6n`-Antwort; welche Seite antwortet, entscheidet der Advisor (Nutzer 25.09.) | S | pty + fe | ✓ #140 (ersetzt das geschlossene #112; gemergt 03.10.) |
| W3-08 | Paketierter HQ-v1-Beleg | S | N | offen |
| ARCH-11 | KI-24b auf Windows reproduzieren, Test-DB-Wettlauf absichern (siehe Tabelle Architektur-Pakete) | S | fR + N | angenommener M3-Kandidat (Nutzer 04.10., F6); Windows-Lauf am PC des Nutzers erlaubt; offen |
| R-1 | Zwischenrelease v1.5.0-beta als Abschluss von M3; Tag und Veröffentlichung darf der Orchestrator selbst, sobald alle Gates und die 27 Matrixzeilen in der Fassung vom 04.10. belegt sind (Nutzer 04.10.) | S | N + doc | offen |

**R-1 Voraussetzungen (Stand 05.10.):** Der Tag `v1.5.0-beta` setzt voraus:

- W3-02 vollständig, einschließlich W3-02f bis W3-02i. Die vier Release-Blocker sind W3-02g (Journal-Erzeuger), W3-02h (Bytes und Version ans Journal, #411-Befund C1), W3-02j (Handshake-Identität nach dem Update) und W3-02i (Wartungs-Lease, #411-Befund C2). W3-02j, weil nach jedem echten Update die App heute nicht mehr startet: die Startprüfung vergleicht den Hash der laufenden exe mit dem Hash des Update-Pakets, dazu den Datenbank-Snapshot-Hash mit der Live-Datenbank (Befund aus PR #457 und Berater Fable 5.1, 05.10.).
- Die PC-Drills W3-03 (paketierte Drills) und W3-07 (Produktionsschlüssel-Build und Signed-Updater-Relaunch) sowie der Beleg W3-08 (paketierter HQ-v1-Beleg).
- Alle Gates und die 27 Matrixzeilen (Fassung vom 04.10.).

### M4 — Dauerbetrieb abgenommen, v1.5.0

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| W5-05 | Prüfpfad (append-only, Trigger gegen UPDATE/DELETE) | S | st | ✓ #44 |
| W5-04a | Not-Aus im Store, **global ohne Projektrahmen** (Schnitt 25.09., W5-01a bleibt geparkt) | S | st | ✓ #69 |
| W5-04b | Not-Aus in der App (10 s Frist) | S | mn | ✓ #125 (Backend W5-04d ✓ #157, Release-Auth W5-04e ✓ #158) |
| W5-04c | Not-Aus in `pa` | S | pa | ✓ #124 |
| W2-02b | Gleichstand in derselben Sekunde, vertrauenswürdige Testquelle (Rest „Merge-Ergebnis als Kandidat“ siehe „Später“) | M | st | Gleichstand ✓ #82, Testquelle ✓ #122; Rest „Merge-Ergebnis als Kandidat“ auf später verschoben (Nutzer 04.10.) |
| W2-04c | Rollenbewusste Routen und Credentials beim Launch | M | st | ✓ #222 (Teil 2, gemergt 03.10.); Teil 1 ✓ #178 (ersetzt #147; gemergt 03.10.) |
| W2-04d | Rollen auf Budget-Zwecke abbilden | S | st | ✓ #15 |
| W2-04g | Optional: Versionsspalte für die Attestierungsregel | S | st | gestrichen (Nutzer 04.10.) |
| DF-15b | Reservierung und Delivery bei `exited_undelivered` freigeben (KI-27; Nutzer 25.09.: ja) | S | st | ✓ #16 |
| W2-07b | Windows-ACL für `projecta-api.json` und `agent-access/` | S | api | ✓ #12 |
| W2-08b | Speicher-/CPU-Grenzen je Job (Nutzer 25.09.: ja); Stillstand früh erkennen (Denk- und Fortschrittszeichen prüfen, sonst nach 15 min) | M | fR | ✓ #53 |
| W2-09b | DeepSeek-V4-Flash-Worker über OpenCode | M | wk | ✓ #78 |
| HQ2-05b | Echte Collector-/Billing-Proben je Anbieter; vorher prüfen, ob W2-03 es schon abdeckt; echte Proben mit Claude/Codex/OpenCode dürfen Abo-Kontingent verbrauchen (Nutzer 04.10.) | M | fR + N | offen |
| W5-02b3 | Env-Stufe als globale Einstellung (st → api → fe); Produktfrage entschieden (Nutzer 04.10.): die globale Stufe ersetzt die Isolation je Profil für gewöhnliche Agenten, Koordinatoren bleiben immer `strict`, profilspezifisches `passthrough` bleibt | M | st → api → fe | offen |
| W5-02b4 | Push aus dem Worker über den Runner-Host, danach `strict` als Voreinstellung | M | pty + wk | ✓ #65 |
| W5-02b5 | Test für den `http.extraHeader`-Reset; GPG unter `strict` | S | fR | ✓ #17 |
| W1-03f | F-CORE-3 Baustein C: Zustell-Queue, `pa worker done/blocked` (braucht das Z-1-Protokoll am PC) | M | wk + pa | offen |
| W3-01 | Globaler DB-Wartungs-/Write-Lock + Drain (st-Kind, dann mn-Kind) | M | st → mn | offen |
| W3-02 | Windows-Recovery-Helper | M | fR + N | offen |
| W3-02a | Journal-Treiber, eine Aktion je Schritt | S | fR | ✓ #291 |
| W3-02b | Staged-Update-Identitäten binden | S | fR | ✓ #321 |
| W3-02c | Datenbank-Wiederherstellung ans Journal binden | S | fR | ✓ #357 |
| W3-02d | Installer-Adapter (Exit-/UAC-/Sharing-Klassifikation, kein Retry) | S | fR | ✓ #348 |
| W3-02e | Installation nur über das Wiederherstellungs-Journal | S | fR | ✓ #411 (gemergt 05.10.; Befunde C1/C2 zurückgestellt, siehe W3-02h/i) |
| W3-02f | Wiederherstellung beim Start | M | fR | in Arbeit (Branch `claude/w3-02f-startup-recovery`) |
| W3-02g | Release-Blocker R-1 (Beta): Journal-Erzeuger. `update-recovery.json` legt heute nichts an, daher lehnt das Selbst-Update in der App immer ab (offener Punkt aus #411). Stufe A | M | mn | offen |
| W3-02h | Release-Blocker R-1 (Beta): #411-Befund C1, die installierten Bytes und die Version an das Journal binden (`signed_artifact_sha256`, `candidate_version`; heute verwirft `InstallOnly` beide). Stufe A | M | mn | offen |
| W3-02j | Release-Blocker R-1 (Beta): Handshake-Identität nach dem Update. Die Startprüfung muss die laufende exe und die Live-Datenbank nach einem echten Update als Erbe des Journals anerkennen (Vertrauen beim ersten Start, siehe `docs/decisions.md`), sonst blockiert `IdentityMismatch` den Start. Befund aus #457. Stufe A | M | mn | offen |
| W3-02i | Release-Blocker R-1 (Beta): #411-Befund C2, Wartungs-Lease statt Momentaufnahme von `is_maintenance_active()`; berührt auch `store.rs` (Naht, nur seriell). Stufe A | M | mn | offen |
| W3-03 | Paketierte Drills: Singleton, Crash/Power-Loss, Backup (3 × S) | S | N | offen |
| W3-04 | Updater-Zustände in App und HQ | S | fe + hqL | ✓ #119 |
| W3-07 | Produktionsschlüssel-Build + Signed-Updater-Relaunch; der bestehende Schlüssel bleibt (E4) | S | N | offen |
| W4-01 | Benchmark, verkleinert auf 5 Aufgaben statt 20 (E2, Nutzer 02.10.) | M | fR | ✓ #73 |
| W4-02 | Abnahmematrix final (27 Zeilen) | S | doc | ✓ #48 |
| W4-03 | Continuous-Aktivierung, nur nach W4-02 und mit Freigabe des Nutzers; der Schalter darf jetzt gebaut werden, fail-closed (gesperrt, bis die Zeilen 1–26 der Abnahmematrix belegt sind); einschalten tut der Nutzer selbst am Ende (Zeile 2) (Nutzer 04.10., E5) | S | mn | offen |
| W4-04 | Release v1.5.0 | S | N | offen |
| M4-R7-01 | Scheduler-`dispatch_once` hinter einem Nur-Test-Permit (Matrixzeile 7) | S | wk | offen |
| M4-R7-02 | Negative Fake-Adapter-Matrix (Matrixzeile 7): Tests, die Starts ohne akzeptierte Gates ablehnen, plus Matrixzeilen 5 und 9: zwei gleichzeitige `dispatch_once` auf eine Aufgabe starten genau einen Worker, der veraltete Schreiber wird abgewiesen; Abhängigkeiten erfüllt/offen/fehlend/projektfremd/65 Einträge -> genau ein Start nur im erfüllten Fall | S | wk | offen |
| M4-ROW15-PROOF | HTTP-Beleg Zeile 15 (eingeengt): Bindung/Idempotenz Kandidat und Evidenz, Lesen nur im eigenen Run, fremde/stale Evidenz abgewiesen, veränderte Root-Policy ändert `policy_json` nicht und meldet fail-closed | S | api-Tests | offen |
| M4-ROW17-PROOF | HTTP-Beleg Zeile 17 (eingeengt): Kandidat-Delta macht Evidenz und Reviews sichtbar ungültig, auch nach Neustart; Freigabe bleibt per Schema unmöglich | S | api-Tests | offen |
| M4-E2E-14 | Echter HTTP-Router + Store + Fake-Agentenprozess: Checkpoint -> Abbruch -> Fortsetzen (Zeile 14) | S | api | offen |
| M4-R19-01 | Typisierter Audit-Envelope: Einträge ohne project/run/result/sourceRef werden abgewiesen (Matrixzeile 19) | S | st | offen |
| M4-R19-05 | Vollständige Audit-Envelopes für Delivery-Start/-Enqueue und W1-03f done/blocked mit Erfolg und Ablehnung (Matrixzeile 19) | S | st | offen |
| M4-R19-06 | Vollständige Audit-Envelopes für Not-Aus an/aus und Barrier-/Store-Fehler (Matrixzeile 19) | S | st | offen |
| M4-R19-08 | Vollständige Audit-Envelopes für Planungs-Autorisierungsablehnungen und Planungs-Schreibvorgänge (Matrixzeile 19) | S | api | offen |
| M4-R27-01 | Readiness für App-Release und Continuous-Release getrennt ausweisen (E20) | S | scripts | ✓ #372 |
| M4-R27-02 | Release-Attestierung für den App-Release prüfen, ohne Continuous freizugeben (E20) | S | scripts | ✓ #398 |
| M4-R27-03 | Matrixzeilen 18 und 27 an den menschlich kontrollierten App-Release-Pfad anpassen (E20) | S | doc | offen |
| M4-R27-04 | Store-Test: Continuous-Integrationsstufe wird bei `approval_eligible = 0` abgewiesen | S | st | offen |

### M5 — Aufräumen und erste Tester (nach v1.5.0)

Nutzerentscheidung 04.10. (Empfehlungen des Orchestrators angenommen). Abnahme in
Alltagssprache:

- 3–5 externe Tester haben v1.5.0 benutzt und ihre Rückmeldungen sind festgehalten.
- Die Architektur-Befunde (Pakete ARCH-D*/STATE-* aus der Drift-Karte und dem
  Zustands-Audit; die STATE-Zeilen kommen dazu, sobald sie existieren) sind
  abgearbeitet.
- `docs/architecture-rules.md` gibt es und ein Drift-Gate läuft in der CI.
- Die vier Nahtstellen sind kleiner als bei v1.5.0 (Zeilen messen und vergleichen).
- ProjectA ersetzt die externen Orchestrierungs-Skripte Schritt für Schritt
  (Dogfooding, laut Vision).

Die ARCH-D-Pakete ändern kein Verhalten. Sie laufen erst nach v1.5.0, weil sie die
seriellen Nahtstellen des Release-Wegs belegen; jedes nutzt den Prompt „ProjectA
refactoring package“.

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| M5-01 | Testerrunde mit 3–5 externen Testern (N = Zahl noch offen) | S | N | offen, nach v1.5.0 |
| M5-02 | Produktfokus als Aussage im README: „sicherer Dauerbetrieb für KI-Agenten: Not-Aus, Kostenkontrolle, Protokoll“ | S | doc | offen, nach v1.5.0 |
| M5-03 | ARCH-G1 Regeldokument `docs/architecture-rules.md` + ARCH-G2 Drift-Gate in der CI (noch nicht gemergt; sonst hier ✓ mit PR-Nummer) | M | ci + doc | offen |
| M5-04 | Dogfooding: ein Orchestrierungsschritt zieht in ProjectA um (Umfang später festlegen) | M | später | offen, nach v1.5.0 |
| ARCH-D1 | Vier HTTP-Fehlertext-Klassifizierer zu einem | S | api | offen, nach v1.5.0 |
| ARCH-D2 | Projektanlage ist in `main.rs` doppelt umgesetzt | S | mn | offen, nach v1.5.0 |
| ARCH-D3 | Elf direkte `BEGIN IMMEDIATE` zu einem Store-Helfer | M | st | offen, nach v1.5.0 |
| ARCH-D4 | Restlicher API-Router mit 51 Zweigen | M | api | offen, nach v1.5.0 |
| ARCH-D5 | Diagnose- und Einstellungsbefehle aus dem Befehls-Monolithen in `main.rs` herauslösen | M | mn | offen, nach v1.5.0 |
| ARCH-D6 | `pa::run` vermischt Verteilung und Darstellung | M | pa | offen, nach v1.5.0 |
| ARCH-D7 | Einstellungs-Speicherung in ein Untermodul unter `store/` | M | st | offen, nach v1.5.0 |
| ARCH-D8 | Ereignisnamen als gemeinsame Konstanten in Rust und TypeScript | M | mn → pty → fe | offen, nach v1.5.0 |
| M4-R19-02 | Vollständige Audit-Envelopes für die Pfade Ziel/Task (Matrixzeile 19) | S | st | offen, nach v1.5.0 (Nutzer 04.10.) |
| M4-R19-03 | Vollständige Audit-Envelopes für die Pfade Claim/Checkpoint (Matrixzeile 19) | S | st | offen, nach v1.5.0 (Nutzer 04.10.) |
| M4-R19-04 | Vollständige Audit-Envelopes für die Pfade Intent/Launch (Matrixzeile 19) | S | st | offen, nach v1.5.0 (Nutzer 04.10.) |
| M4-R19-07 | Vollständige Audit-Envelopes für die Pfade Kandidat/Evidence/Review (Matrixzeile 19) | S | st | offen, nach v1.5.0 (Nutzer 04.10.) |
| M4-R19-09 | Vollständige Audit-Envelopes für den Pfad Wartung (Matrixzeile 19) | S | mn | offen, nach v1.5.0 (Nutzer 04.10.) |

### Reihenfolge der seriellen Lanes (nach Meilensteinen)

Ein Paket aus einem späteren Meilenstein startet nur, wenn seine Lane im
früheren nichts mehr hat.

- **st:** W1-05b(st) → W5-05 → W5-04a → W2-02b → W2-04c → W2-04d → W3-01(st) → W5-02b3(st) → W2-04g.
- **api:** W1-05b(api) → CLEAN-02(api) → W5-02b3(api).
- **mn:** CLEAN-02(mn) → W5-04b → W3-01(mn) → W4-03.
- **pa:** W2-01d → W5-04c → W1-03f(pa).
- **pty:** W1-01b → W1-27 → W5-02b4(pty).
- **wk:** W1-03e → CLEAN-02(wk) → W5-02a → W2-04e → W1-18b → W2-09b → W5-02b4(wk) → W1-03f.
- **hqL:** W1-17 → W1-10 → W5-02b7 → W2-10 → W3-04(hqL). **hqS:** HQ2-02 → HQ2-03.
- **ci:** CI-02/CI-03 → SEC-01 → CI-04 → SETUP-12.
- **Migrationen:** Nummern vergibt der Koordinator erst beim Dispatch.

## Regeln für diesen Plan

1. **Ein Plan.** Jedes Paket steht als eine Zeile in genau einer
   Meilenstein-Tabelle. Neue Pakete entstehen nur hier.
2. **Neue Ideen bis M4 auf „Später“.** Sie kommen in den Abschnitt unten, nicht
   in M1–M4, außer der Nutzer entscheidet es.
3. **Continuous-Code bis M4 eingefroren.** Keine neuen Migrationen und keine
   neuen Funktionen für den Continuous Mode außerhalb der M4-Pakete.
4. **Nichts doppelt bauen.** Neues entsteht an einer Stelle, HQ oder App, nicht
   in beiden.
5. **Status per Skript.** Die Stand-Spalte ist eine Momentaufnahme. Den
   Live-Stand und den Tagesbericht erzeugt OPS-01 aus GitHub und git. Nach dem
   Merge: `✓ #PR` hier, Zeile in `docs/ERLEDIGT.md` (`npm run dev:erledigt-row`).
   Über die eigene Stand-Zeile hinaus schreiben `docs/PLAN.md`, `STAND.md` und
   `docs/ERLEDIGT.md` nur der Koordinator oder ein Paket mit ausdrücklicher
   Zuweisung.
6. **Spec nur für M-Pakete.** Ein M-Paket bekommt beim Start
   `.pa/task_<id>.md` (`Status: aktiv`) und eine Zeile unter „Aktive Specs“ in
   `STAND.md`; `npm run specs` prüft beides. S-Pakete und Folgepakete aus einem
   PR: der Auftrag steht im PR-Text.
7. **Größen:** S ≤ 150, M ≤ 300 Diffzeilen einschließlich Tests. Was größer
   wird, teilt der Koordinator vor dem Dispatch in Kinder.
8. **CI-Geld:** Ziel 0 €. Wird die CI der Engpass, sind höchstens 20 € im Monat
   erlaubt, und erst nach Freigabe des Nutzers.

## Vision (Nutzer 25.09.)

- **Eine Oberfläche:** Das Dev-HQ wird nach M3 der Hauptbereich im App-Fenster.
  Ein Kern, ein Fenster. HQ2-02 legt die Richtung fest.
- **Orca als Brücke:** Bis M3 wird mit Orca, Claude Code und Codex gearbeitet,
  danach schrittweise mit ProjectA selbst.
- **Agenten-Abteilungen mit Leitern:** Die erste Abteilung ist Prüfung/Reviews.
  Sie startet klein nach M1, mit eigenem Budget.

## Gestrichen/Geparkt (25.09.)

„Gestrichen“ heißt: fällt weg, bei Bedarf neu einplanen. „Geparkt“ heißt: die
ID bleibt, wird nicht gezählt und nicht dispatcht, und kommt erst nach M4
zurück. Die DEVFLOW-Zeilen tragen ihren Status zusätzlich in der Tabelle unten.

### Gestrichen

| Was | Grund |
|---|---|
| W5 Phase H: W5-26 Angriffs-Reviewer, W5-27 Mutationstest-Gate, W5-29 Anbieter-Wettbewerb | vervielfachen den Abo-Verbrauch und helfen dem Ziel nicht |
| DF-12, DF-18, DF-19, DF-20, DF-26, DF-35, DF-36, DF-37 | DEVFLOW-Doppelungen: schon anderswo geplant oder gebaut (Gründe je Zeile in der DEVFLOW-Tabelle) |
| Aliase auf gestrichene DF-Pakete | W5-08a/08b (Alias von DF-18) werden wieder eigene, geparkte W5-Pakete; HQ2-10 (Alias von DF-35–37) ist mit HQ2-06–10 geparkt |
| `.github/workflows/review.yml`, `anthropic-wif-test.yml` | tote Workflows, in PLAN-01 gelöscht (git behält sie) |
| Pflicht-Berichtsdatei, eingecheckte Review-Prompts, Spec für S-Pakete | ersetzt durch den PR-Text (AGENTS.md, Regel 7) |

### Geparkt

| Was | Grund | Wann wieder |
|---|---|---|
| **W5 außerhalb des Kerns:** W5-01a/b/c, 02c, 02d, 02e, 03, 06, 06b, 07, 08a, 08b, 09a/b/c, 10, 11, 12–16, 17–21, 23–25, 30a/b, 31a–c, 32–34, 35a–f, 36a/b, 37–39 | Das Projekt-System hilft dem Ziel nicht. Kern in M3/M4: W5-02a, W5-22, W5-28, W5-00b, W5-02b3–b5/b7, Not-Aus W5-04a–c, Prüfpfad W5-05 | nach M4; zuerst W5-31 (App zu, Worker laufen weiter); Phase J (autonomer Merge) erst nach vier Wochen Continuous ohne Rückschlag. Konzept: `.pa/plan_projects_w5.md` |
| **DEVFLOW-Motor:** DF-11, DF-13–17, DF-06b, DF-08d | zweite Steuerung neben dem fertigen Continuous-Kern | nach M4 als Erweiterung des Continuous-Runtime neu schneiden |
| **DEVFLOW-Ausbau:** DF-09b, DF-10, DF-21–25, DF-27–34 | hilft dem Ziel nicht; DF-09b wäre ein Doppelbau | nach M4 |
| **HQ2-04, HQ2-06 bis HQ2-10** | große Pakete, jedes ein eigenes Projekt | nach der Oberflächen-Entscheidung (HQ2-02) neu planen |
| W1-09c (KI-1 editierbar), W1-12 (Design-Reste) | Komfort, niedriger Nutzen | nach M4 |
| W4-03a (Journal-Teil ohne Aktivierung) | nur für das geparkte W5-03 nötig (Nutzer 25.09.: später) | mit W5-03 |
| W3-09 (Struktur-Split) | inaktiv, nur wenn W0-05 = zerlegen | bei Bedarf |

### Später (neue Ideen und zurückgestellte Themen)

| Thema | Wann wieder |
|---|---|
| Agenten per Protokoll statt Tippen steuern (strukturierte Schnittstellen der Anbieter) | nach M4 (Nutzer 25.09.: später) |
| ADR, die die st-Lane für unabhängige `store/`-Module teilt | nach M1 (Nutzer 25.09.: später) |
| Öffentlicher Neustart des Repos ohne Historie (Prüfung E) | nach M1; vorher Scan-Bericht, der Nutzer gibt frei (nicht umkehrbar) |
| Vorzeige-README für die Bewerbung | später |
| Prompt-Kompression, MCP-Injektion | wenn ein Worker nachweislich am Kontextlimit scheitert |
| Command Palette, globale FTS-Suche, Fokusmodus | wenn der Nutzer sie im Alltag vermisst |
| Remote-Board, Multi-Prozess-Deskriptor | wenn ein zweiter Rechner dazukommt |
| Ideen-Pipeline, Zeitachse, Vorschlags-Tab | nach M4, mit Kostenschätzung |
| hermes-agent, Multi-Harness | nach M4 (HQ2-06 ist geparkt) |
| Dependabot-Majors (Vite 8 → eslint 10 → TS 7 → React 19 → sqlx 0.9) | einzeln, nach M4 |
| Tauri-Plugins `dialog`, `notification`, `window-state` | wenn ein Paket sie braucht |
| OmniRoute-Cutover in den Produktmodus | erst mit gemessenem Kostensieg |
| Design Studio, Queen/Employee-Neuanlage | nie (gestrichen; der Anlegepfad fällt mit CLEAN-02) |
| W2-02b-Rest „Merge-Ergebnis als Kandidat“ (der Vertrag der vertrauenswürdigen Upstream-Quelle ist ungeklärt; nur lesend geprüft am Kopf d1fce9c, kein Regressionstest ausgeführt) | nach M4 (Nutzer 04.10.: auf später verschoben) |
| Vorschlag: Abschlussvertrag für Headless-Läufe: Gates und Push synchron im Vordergrund; „fertig“ nur mit Gate-Exit, Kandidaten-SHA, `ls-remote` und PR, nicht mit `JOBEXIT0` (echte Abbrüche beobachtet) | nach M4; Vorschlag, keine Freigabe |
| Sicheres Aktionsmuster für Agenten (Anregung aus dem MIT-Projekt browser-use/jev-ultrafast, geprüft 04.10.): Die KI wählt nur aus einer nummerierten Liste erlaubter Aktionen/Ziele, die aus dem beobachteten Zustand erzeugt wird; Modellausgabe wird nie zu Selektoren, Koordinaten, Shell-Befehlen oder ausführbarem Code; jede gewählte Aktion wird vor der Ausführung gegen den aktuellen Zustand geprüft. Kein Code und keine Abhängigkeit übernommen (das Projekt braucht kostenpflichtige API-Schlüssel). Prüfen nach v1.5.0, z. B. für Agentenbefehle oder Freigaben. | nach v1.5.0 |
| Vorschlag: Startcheck-Doku an die Wahrheit anpassen und nur lesend Abhängigkeits-Drift prüfen (nicht optionale installierte Pakete gegen die Kandidaten-Lock); OPS-02 #35 und SETUP-09 #56 bleiben gemergt, dies ist ein begrenzter Folgeschritt | nach M4; Vorschlag, kein Duplikat |
| Vorschlag: PTY-Read/Emit-Diagnose erst nach eingespeistem Beweis; Drain und panikfreie Senke bewahren, den `eprintln`-Rückfall in `logging::log` nicht blind nutzen; Stderr-Verlust im Release ungemessen | nach M4, mit Laufzeitbeleg; ohne Graph-/Windows-Beleg |
| Vorschlag: M4-W2-Merge-Vertrag: frische geschützte Upstream-Bestätigung, gebunden an Kandidat/Lauf/Fence/Scope; lokale Refs und Start-Pin genügen später nicht; Scope-Prüfung Basis → Kandidat auf dem End-Baum nach Merge oder Rebase (Quelle `6fb08b0`, `workers/candidate_scope.rs:56-112`); Continuous nicht aktivieren | nach M4; ohne Graph-/Laufzeit-/Windows-Beleg |

### Architektur-Pakete aus dem Architektur-Rat (03.10.2026)

Die folgenden Pakete sind neue Ideen und bleiben nach AGENTS.md unter „Später“.
ARCH-11 ist die Ausnahme: Es ist ein angenommener M3-Kandidat (Nutzer 04.10., F6
und Zeile in der M3-Tabelle), ohne die M3-Abnahme-Tabelle zu ändern.

| ID | Ziel | Dateien | Lane | Naht | Tier | Test-Trailer | Reihenfolge |
|---|---|---|---|---|---|---|---|
| ARCH-01 | Toten Kleinkram in FE/HQ entfernen: `hqCapacity.ts` samt Test löschen, `setLandingPage`-Wrapper und Design-Studio-Mock entfernen; `hq-live.mjs` akzeptiert zusätzlich `PROJECTA_API_FILE`. | 4–5 Dateien, ~150 Diff | fe + hqL | nein | B | Test-First: `descriptorCandidates({PROJECTA_API_FILE})` liefert genau diesen Pfad; Löschungen No-Test | jetzt; Löschung mit Nutzer-Ja (F5) |
| ARCH-02 | `queue.rs`: `enqueue` und `enqueue_with_enhancer` über gemeinsamen `insert_entry()`-Pfad führen; Test-Kopie entfernen. | `queue.rs`, Δ−35 | fR | nein | B | No-Test: mechanische Deduplizierung; 17 `queue::tests` decken Verhalten ab | nach Merge von PR #130 |
| ARCH-03 | Einen atomaren `write_atomic`/`replace_file`-Pfad in `fsutil.rs` bündeln und in Retention, Provider und Delivery-Recovery verwenden; alten MSRV-Kommentar entfernen. `db_restore.rs:137` bleibt Folgepaket der pa-Lane. | 4 Dateien, ~220 Diff | fR | nein | A (Vault) | No-Test: Konsolidierung; bestehende Provider-, Retention- und Recovery-Tests | jetzt |
| ARCH-04 | `retention::run_once` soll alte Sitzungsdateien über `sessionpersist::sweep(root, now)` löschen; globales Dead-Code-Allow entfernen, Item-Allow nur für `persist_draft` behalten. | `retention.rs`, `sessionpersist.rs`, ~120 Diff | fR | nein | B | Test-First: alte Sitzungsdatei verschwindet nach `run_once` | nach Inbox-Antwort F2 |
| ARCH-05 | Binärmodule von `pub mod` auf `mod` umstellen und die dadurch sichtbaren Dead-Code-Warnungen einzeln mit Paket-ID erlauben. | `main.rs` + 2–3 Module, ~30 Diff | mn | ja | A (Naht) | No-Test: Sichtbarkeits-Lint; Force-Warn-Lauf vorher/nachher und Clippy | jetzt |
| ARCH-06 | `AppAgentControl` und `PtyAgents` auf freie Funktionen umstellen; `ApiBackend::agents()` statt sieben `with_port`-Aufrufen verwenden. | `main.rs`, Δ−90 | mn | ja | A | No-Test: mechanische Deduplizierung; bestehende Worker-, API- und Main-Tests | nach ARCH-05, vor W5-04b |
| ARCH-07 | Store-Kleinkram verschieben: `SRC_HOOK`/`SRC_HEURISTIC` löschen, Fehlercodes in neues `errors.rs` legen und die Rückkante store→workers entfernen. | `store.rs`, `store/queue_cancel.rs`, `workers.rs`, `errors.rs`, ~40 Diff | st | ja | A | No-Test: mechanische Verschiebung; bestehende Store-, Queue-Cancel- und API-Tests | nach #147/#44, gemäß st-Reihenfolge |
| ARCH-08 | `SettingsView.tsx` je Tab in eigene Komponenten aufteilen. | `src/components/Settings*/`, je ≤300 | fe | nein | B | No-Test: mechanische Verschiebung; vorhandene Settings-Tests | nach PR #154 |
| ARCH-09 | `ipc.ts` als Barrel behalten und PTY-, Projekt- und Worker-Domänenmodule auslagern. | `src/lib/ipc/*.ts`, je ≤300 | fe | nein | B | No-Test: mechanische Verschiebung; IPC- und Komponententests | nach ARCH-08, niedrige Priorität |
| ARCH-10 | `/api/hq/v1/*` als Unter-Router mit 14 Armen aus `route()` in `api/hq_routes.rs` auslagern. | `api.rs`, `api/hq_routes.rs` | api | ja | A | No-Test: mechanische Verschiebung; FakeBackend-Servertests behalten Status, Body und Auth | vor W5-02b3 (api) |
| ARCH-11 | **M3-Kandidat:** KI-24b auf Windows reproduzieren und den Test-DB-Wiederöffnungs-Wettlauf durch bewiesenes Pool-Schließen oder gezieltes Warten absichern. | `testutil.rs` + betroffene Tests | fR + N | nein | A (DB) | Regression-For: KI-24-Läufe 36165944208/36215024767; 20× close→reopen auf Windows | M3-Kandidat angenommen (Nutzer 04.10.); Windows-Lauf nötig, der PC des Nutzers darf dafür genutzt werden |
| ARCH-12 | `impl ControlBackend for ApiBackend` aus `main.rs` auslagern. Das Paket bleibt gesperrt, weil der Trait-Block als reine Verschiebung mehr als 300 Diffzeilen erzeugt. | `main.rs`, `api/backend.rs`, ~715 Z. | mn + api | ja | A | No-Test: mechanische Verschiebung erst nach ADR A1 | nach ADR A1; gesperrt |

### Synthese der Bestandsaufnahmen INV-01..08 und des Architektur-Rats (03.10.2026)

Quelle der Bestandsaufnahmen sind die PR-Texte (Abschnitt „Bestandsaufnahme“);
sie liegen nicht als Dateien im Repo. Der Architektur-Rat ist die Tabelle oben.
Alles hier ist **Quellenbefund oder Hypothese, kein reproduzierter Fehler**: ein
Bugpaket braucht zuerst einen kompilierenden roten Test, eine Laufzeit- oder
Performanceaussage eine Messung. Nichts davon ist in M1–M4 aufgenommen. Die
Nummern unten sind heutige PR-Nummern, beobachtet am 03.10.2026 mit
`gh pr view` auf `origin/main` 1b38596; der Paketstand darunter ist am 04.10.2026 nachgeführt.

**Stand der Pakete.** Architektur-Rat und Team-Katalog sind abgeschlossen.
Status beobachtet 04.10.2026 13:50 UTC (15:50 Berlin), gelesen mit `gh pr list --state all`/`gh pr view <n>` auf `origin/main` effef1a (Merge #279 um 10:03:23 UTC, `ci`-Lauf 37194125481 grün). Gemergt (bis `cc95a57` Stand 03.10. 23:26 UTC, danach die Nachträge unten):
ARCH-02 #191, ARCH-03 als #214 und #217 (das erste #211 ist geschlossen: es
überschritt die 300-Zeilen-Grenze), ARCH-03c #256 (`08faff8`, 23:04 UTC), ARCH-04 #169, ARCH-05 #182, ARCH-06 #219,
ARCH-07 #202, ARCH-08a #181, 08b #221, 08c #229, 08d #244, 08e #247 und 08f #252 (`f1a33de`, 22:31 UTC),
ARCH-09a #260 (`cc95a57`), ARCH-10a #220, 10b #236, 10c #246 und 10d #250,
W1-27 #140, W2-04c Teil 2 #222, PTY-READ-01 #206, PTY-RETIRE-01 #215,
PTY-GUARD-01 #230, SEC-ARCHIVE-01 #225, M3-02 #189, PLAN-sync-04 #258 (`070a1d5`, 22:49 UTC) und
UX-03 als #199 (#186 ist geschlossen). Ersetzt: #152 → #172, #147 → #178,
#130 → #183 (alle gemergt). ARCH-10b ist trotz E13 gemergt (#236); E13 ist
am 03.10. vom Nutzer freigegeben und der installationsfreie Starter auf dem Server
eingespielt; Worker-Läufe über ihn haben seitdem PRs geliefert (siehe E13).
**ARCH-03c** #256: die Windows-Bahn war per `workflow_dispatch` echt rot am
Test-First-Commit `2b9fd1c` (Lauf 37155715659) und grün am Kopf `7af0aa5` (Lauf
37156526153); danach gemergt. **ARCH-08** ist mit #252 vollständig.
**ARCH-09:** 09a (Projekt-Wrapper in `ipc/projects.ts`) ist mit #260 gemergt;
ARCH-09b (Worker-IPC) ist mit #264 gemergt (`db76682`, 03.10. 23:57:09 UTC);
ARCH-09c (PTY-Wrapper, #269) ist Draft mit Label `do-not-merge`, nicht gemergt
(`gh pr view 269`, 04.10. 13:50 UTC). **ARCH-10** ist
vollständig: `src-tauri/src/api.rs:1384` delegiert nur noch an `hq_routes::route`,
in `api.rs` steht kein `"hq", "v1"`-Arm mehr (`grep` leer); `api/hq_routes.rs:20-34`
listet den Besitztest mit 15 Methode/Pfad-Kombinationen, `handle` hat 14 Arme
(≥ 14 geplant). Die Produktions-Routenarme sind verschoben, die bestehenden
Testpfade bleiben. Eine Aufschlüsselung der Servertests je Arm ist nicht geprüft.
**Nachträge seit `cc95a57`** (`gh pr view <n>`, Merge-Zeit UTC): #262 (nur
Diagnose zu KI-30) `e87b17e`, 03.10. 23:39:47; #264 ARCH-09b `db76682`, 23:57:09;
#266 PLAN-sync-05 `7ea73b2`, 04.10. 00:08:49; #274 W1-17-Folgefix (`teilweise:`
in der Stand-Zelle) `4846c84`, 09:21:50; #275 SETUP-15-Folgekorrektur `f33f40d`,
09:47:29; #279 Mergify-Doku „explizit einreihen“ `effef1a`, 10:03:23.
**Offen** (`gh pr list`, 04.10. 13:50 UTC): #269 ARCH-09c (Draft, `do-not-merge`);
#270 OPS-02-Doku und #273 SETUP-09-Fix (beide Label `queued`, laufen als
Queue-PR #283 zusammen); #282 SETUP-12-Rest (Draft). Queue-Lauf 37196272431 (#273
allein, Queue-PR #281) scheiterte nur an einem KI-30-Test auf Windows, siehe
`KNOWN_ISSUES.md`. Der Stand von Queue und CI ist neu zu lesen; er kann sich
schon geändert haben.
Veraltete Altangaben (#130, #147, #152, #112 als „offen und maßgeblich“) gelten nicht mehr.

**Serielle Reihenfolgen** (jede Scheibe ≤ 300 Diffzeilen **einschließlich**
Verschiebungen und Tests; Überschneidungen trotz anderer Paketnamen prüfen):

| Lane | Reihenfolge |
|---|---|
| `mn` | ARCH-05 (#182) → ARCH-06 (#219) → ARCH-03: alle gelandet; die Vault-Quellenbefunde unten sind bewertet und behoben (#200, #225). |
| `fR` queue | ARCH-02 (#191) nach #160 und #183: gelandet. |
| `pty` | #140 ✓ → PTY-READ-01 ✓ #206 → PTY-RETIRE-01 ✓ #215 → PTY-GUARD-01 ✓ #230; nie zwei zugleich. Guard belegt Produktionspfad und Überlauf, keine stillen Eingabeverluste. |
| `st` / `api` | ARCH-07 ✓ #202; W2-04c Teil 2 ✓ #222 → ARCH-10b ✓ #236; ARCH-10a ✓ #220, 10c ✓ #246, 10d ✓ #250; ARCH-10 vor W5-02b3. Keine neuen Continuous-Migrationen. |
| `fe` | ARCH-08: a ✓ #181, b ✓ #221, c ✓ #229, d ✓ #244, e ✓ #247, f ✓ #252; ARCH-09: a ✓ #260, b ✓ #264, c Draft #269 (nicht gemergt); M3-02 ✓ #189 und UX-03 ✓ #199 gelandet. |

ARCH-11/KI-24b ist der laut Architektur-Rat nützlichste weitere Schutz (ein
roter Test-DB-Wettlauf auf Windows hält die Queue an). Er ist **priorisierter
Kandidat** und mit F6 am 04.10. in M3 aufgenommen. ARCH-12 bleibt
gesperrt (> 300 Diffzeilen, F1). Abgelehnt bleibt: Rust↔TS-Codegen ohne
belegten Vertragsbruch, ein neuer lib/store/`CoreError`-Split, der Review-Lock
bleibt in-process, `delivery_recovery.rs` wird nicht gelöscht (W3-02).

**Korrektur:** Die Behauptung „Vault- und CSP-Vorschläge durch #138 erledigt“ ist
falsch. #138 hat nur `oneshot.rs` geändert (Unix-Verzeichnisprüfung).

#### Später: getrennte Security-Kandidaten (neu zu prüfen, kein M4-Code)

Je Kandidat zuerst Quelle neu bestätigen, dann ein roter Test, dann ein kleines
Tier-A-Paket. Beobachtet am Kopf 90676c5 und am aktuellen Stand erneut gelesen
(`providers.rs:867/728`, `tauri.conf.json:28`).

| Kandidat | Quellenbefund | Voraussetzung |
|---|---|---|
| INV-SEC-VAULT-TEMP | `providers.rs:867` `write_atomic`: vorhersehbarer Tempname `provider-keys.json.tmp-<pid>`, `create(true).truncate(true)`; ein untergeschobener Symlink könnte den Schreibvorgang umleiten (Hypothese, nicht belegt). | ✓ #200 gemergt (03.10.); vorher roter Symlink-Test |
| INV-SEC-VAULT-ARCHIVE | `providers.rs:728` `archive_corrupt`: Name aus Sekunde + PID; zwei Reparaturen in einer Sekunde könnten kollidieren. | ✓ #225 gemergt (03.10.); vorher roter Zwei-Reparaturen-Test |
| INV-SEC-CSP-SPLIT | `tauri.conf.json:28`: die Release-CSP enthält `ws://localhost:1420/1421`. | Test, der die Release-Form prüft; Entwicklungs- und Release-CSP trennen |
| INV-SEC-CREDENTIAL-EXPIRY / -CLEANUP | `api/agent_access.rs:312/361`: abgelaufene Grants bleiben als Datei liegen, Löschfehler werden verschluckt (niedrig). | nach #158 (gelandet) neu lesen |
| API-Descriptor | Private Erstellung/Ersetzung der Descriptor-Datei unter Unix prüfen. | nach #158 prüfen |
| INV-SEC-PRIVATE-PATHS | Einheitliche no-follow-Erstellung privater Dateien (Idee). | nach M4 |

**M4-Blocker** (siehe Inbox): `planning_access` ohne Projektrahmen und die
TOCTOU-Lücke dort. Der eingefrorene Continuous-Code wird jetzt nicht erweitert.

#### Später: weitere Quellenbefunde nach Bereich

- **Frontend (stale Antworten):** `AttentionInbox.tsx:63`, `ActivityView.tsx:48`
  (Digest), `HistoryView.tsx:36` (Worker-Wechsel), `HistoryView.tsx:25`
  (verschluckter IPC-Fehler), `SessionRestorePanel.tsx:67` (Sprachmix),
  überlappende Poll-Antworten. Zuerst gegen schon gelandete ähnliche Fixes
  ausschließen: #133 (Empfehlungen), #134/#135 (Projektwechsel), #149
  (History-Polling serialisiert). Dann ein roter Wechseltest je Fund; kein
  allgemeiner Event-/Polling-Neubau.
- **Queue (`queue.rs`):** unbegrenzt blockierter Eintrag ohne Zeit
  (`status.rs:1474`), Dispatcher-Panik beendet den Thread, `launch` ohne
  Zeitlimit, ungültige/negative Worker-Limits (`set_project_max_workers`),
  30-s-Sweep. Änderungen am eingefrorenen Runtime nur in bestehenden M4-Paketen.
- **HQ:** die Restzeitschätzung in `hq-live.mjs` (4 h je Spec) ist unbelegt;
  fehlender `blocked`-Zustand (`hq-parse.mjs:240`); veraltete Abhängigkeitskanten
  (`PACKAGE_EDGES`); Tages-/UTC-Grenzen (`hq-stats.mjs:6-22`); keine
  Request-Body-Grenze. Konfiguration ist kein Beleg tatsächlicher Fähigkeiten.
- **Tests/Plattform:** feste 4096-Byte-Seite (`resources.rs:128`), unlesbare
  Unterordner zählen 0 (`resources.rs:38-56`), Linux-`None` bei Platte/CPU,
  fehlende Gegenfälle in `native_launch`/`native_supervisor`/`native_runner`.
  Timing-Flakes sind Hypothesen bis zur Messung.
- **Performance (erst messen, dann ändern):** `useQuestions` ohne SQL-Limit,
  Digest lädt alle Nachrichten, überlappende Attention-Batches.
- **Ops-Prozess:** Mutex-/Budget-Recovery wird als Tier B statt A eingestuft;
  eine Überschrift „Review disposition“ gilt schon als Reviewabschluss; ein
  stiller Worker-/Watchdog-Neustart belegt nicht, dass der alte Prozess
  gestoppt ist. Eine Pipeline-Änderung wäre ein eigenes, red-first getestetes
  Ops-Paket, nicht Teil dieser Synthese.
- **Wartezeit:** CI-06 (#170) prüft lokal nur `--plan` (Form und Referenzen),
  **nicht** semantisch einen roten Test auf der Merge-Base. Folgeideen: engere
  `pfad::testname`-Form, echte parallele unabhängige Reviews, Konfliktvorhersage.
  Flake-Auswertung nur aus vorhandenen Logs; zusätzliche Actions-Läufe sind E11.
- **Doku:** Link-Prüfer, README/KNOWN_ISSUES-Linkcheck, W2-02b-Teil „Merge-Ergebnis
  als Kandidat“ nachweisen oder als eigenes Paket abtrennen.

Nicht erfasst: Die Bestandsaufnahme in #132 (CI) enthält nur den dort behobenen
SIGPIPE-Fund. Die Zuordnung INV-nn → PR steht nicht in den Texten; es wurden
#129–#133, #138, #142 und #149 gelesen.

## Entscheidungs-Inbox

Offene Fragen an den Nutzer stehen hier gebündelt, mit Empfehlung. Am 04.10. hat der Nutzer E1, E4, E5, E10, E11, E12, F1, F3 und F6 beantwortet (zwei
neue Zeilen halten die Freigaben fest). Offen sind E3, der M4-Blocker, E14 (dringend), E15 und E16 (beide nach v1.5.0), E17 (niedrig, nicht auf dem v1.5.0-Pfad), E18 (hoch, auf dem v1.5.0-Pfad) sowie E21–E23; E20 hat der Nutzer am 04.10. entschieden (Option A); E19 ist als Beraterentscheid festgehalten und kann vom Nutzer überstimmt werden. Falls der Nutzer E21–E23 in der nächsten Sitzung nicht beantwortet, entscheiden Fable + Astra; der Nutzer kann überstimmen. F2, F4, F5 und E13 (am 03.10. freigegeben und eingespielt,
Nachweis siehe E13) sind entschieden und werden nicht neu gefragt. Agenten
unterbrechen den Nutzer nicht einzeln im Chat, sondern tragen die Frage hier ein
(AGENTS.md, Regel 10).

| # | Frage | Empfehlung | Wer entscheidet? | Status |
|---|---|---|---|---|
| E1 | HQ2-02: Demo und Studio ansehen und die Richtung für die eine Oberfläche festlegen. Der Entscheid blockiert die Farbthemen T2–T5 in HQ2-03. | In M3 entscheiden und danach HQ2-03 starten. | Nutzer | ✓ entschieden (Nutzer 04.10.): Mix. Das Studio-Layout (`hq2-concept`/`hq2-studio`) ist die Richtung für „HQ als Hauptbereich der App“, dazu die Einleitungsleiste und die Entscheidungsbox „Dein Urteil ist gefragt“ aus der Demo (zweite Antwort ~17:15). HQ2-03 ist freigegeben und baut darauf auf. |
| E1-Hinweis | HQ2-02/03 blockiert die Farbthemen T2–T5. | Erst HQ2-02 festlegen, dann die Farbthemen in HQ2-03 bearbeiten. | Nutzer | Hinweis |
| E2 | W4-01: Benchmark auf 5 Aufgaben verkleinern oder durch ein Nutzer-Gate ersetzen | 5 Aufgaben | Nutzer | ✓ entschieden: 5 Aufgaben (Nutzer 02.10.) |
| E3 | Secrets aus der Repo-Ebene in geschützte Environments, Required Reviewers für `release` | ja; einmal im Browser klicken | Nutzer | offen (Nutzer) |
| E4 | W3-07 Produktionsschlüssel | vor v1.5.0 | Nutzer | ✓ entschieden (Nutzer 04.10.): der bestehende Updater-Schlüssel bleibt (passt zum Public Key in `src-tauri/tauri.conf.json`). Am 04.10. hat der Orchestrator die Environment-Secrets `TAURI_SIGNING_PRIVATE_KEY` und `UPDATES_MIRROR_TOKEN` aus dem früheren privaten Repository in das `release`-Environment dieses Repos kopiert (einmaliger Workflow, Werte nie angezeigt, temporärer Token und Branch danach entfernt). Damit kann v1.4.1 auf v1.5.0 automatisch aktualisieren. Beleg (nur Namen): `gh api repos/Cuarroc/ProjectA/environments/release/secrets --jq '.secrets[].name'` liefert beide Namen (04.10.). |
| E5 | W4-03 Continuous-Aktivierung | erst nach W4-02 | Nutzer | ✓ entschieden (Nutzer 04.10.): der Aktivierungsschalter darf jetzt gebaut werden, fail-closed (gesperrt, bis die Zeilen 1–26 der Abnahmematrix belegt sind); der Nutzer schaltet selbst am Ende ein (Zeile 2). Das löst den Zirkel zwischen Matrixzeile 2 und der Entscheidungsregel von W4-03. |
| E6 | W5-02e eigener Windows-Benutzer für Agenten | nach M4 | Nutzer | später (Nutzer 25.09.) |
| E7 | W5-Kern: beschlossen waren W5-22, W5-28, W5-02a und Not-Aus; PLAN-01 hat zusätzlich W5-00b, W5-02b3–b5/b7 und den Prüfpfad W5-05 in M3/M4 eingeordnet | erweiterten Kern bestätigen | Nutzer | ✓ bestätigt (Nutzer 02.10.) |
| E8 | Routing Nahtstellen/Security: `docs/setup/providers.md` routet primär auf Codex `gpt-6-astra`, Claude-Worker nur als Ausweichen — die alte Modellregel ist damit ersetzt | Routing bestätigen | Nutzer | ✓ bestätigt (Nutzer 02.10.) |
| E9 | M3-01 und M3-02 wurden im Auftrag des Orchestrators in M3 vorgezogen. | Nur als bereits getroffene Reihenfolge vermerken. | Orchestrator | ✓ entschieden (03.10.) |
| E10 | Soll der Landing-Page-/DesignStudio-Abschnitt in `src/App.tsx` (etwa Zeilen 1277–1280) entfernt werden? | Ja, Abschnitt löschen. | Nutzer | ✓ entschieden (Nutzer 04.10.): ja, entfernen, als eigenes `fe`-Paket. |
| E11 | Soll die Windows-Flake-Erkennung weiterlaufen, obwohl sie Actions-Minuten kostet? | Kosten und Nutzen abwägen; Empfehlung: nur mit belegtem Nutzen behalten. | Nutzer | ✓ entschieden (Nutzer 04.10.): ja, behalten (öffentliches Repo, Actions-Minuten kosten nichts). |
| F1 | Soll die große Verbindungsschicht `ApiBackend` mit etwa 715 Zeilen bis nach M4 in `main.rs` bleiben? | Ja; danach das Trait in Domänenports teilen. | Nutzer | ✓ entschieden (Nutzer 04.10.): ja, `ApiBackend` bleibt bis nach M4 in `main.rs`. |
| F2 | Alte verschlüsselte Sitzungsdateien sollen mit derselben Frist wie die übrige Aufräumfunktion gelöscht werden. | Ja; Umsetzung als ARCH-04. | Nutzer | ✓ entschieden (03.10.) |
| F3 | Die Audit-Tabelle bleibt bis zum Not-Aus in M4 leer. Ist das in Ordnung? | Ja, solange M4 die Audit-Abnahme enthält. | Nutzer | ✓ entschieden (Nutzer 04.10.): ja, leere Audit-Tabelle bis zum Not-Aus ist in Ordnung, solange M4 die Audit-Abnahme hat. |
| F4 | Doppelte PRs schließen. | Ja; #112, #113, #115, #91 und #146 sind geschlossen. | Orchestrator | ✓ entschieden (03.10.) |
| F5 | Toten Code löschen. | Ja; Umsetzung als ARCH-01b und ARCH-07. | Nutzer | ✓ entschieden (03.10.) |
| F6 | KI-24b als ARCH-11 in M3 aufnehmen? | Ja, als M3-Kandidat mit Windows-Lauf. | Nutzer | ✓ entschieden (Nutzer 04.10.): ja, ARCH-11 (KI-24b) kommt in M3, mit Windows-Lauf (der PC des Nutzers darf genutzt werden). |
| E12 | memorix und desktop-commander im Claude-Start abschalten (hängen teils mit `CONNECT_TIMEOUT`; PLAN M2 nennt memorix als Gedächtnis). | Nutzer entscheidet; keine Änderung ohne Ja. | Nutzer | ✓ entschieden (Nutzer 04.10.): ja, in beiden abschalten im Claude-Start der Projekt-Agenten (vom Orchestrator außerhalb des Repos erledigt). |
| E13 | Der externe Server-Starter führt `npm ci` selbst aus und verstößt damit gegen die Installationsregel; ARCH-10b war deshalb angehalten und ist inzwischen gemergt (#236). | Installationsfreien Starter einführen: nur vorhandene Abhängigkeiten, `CARGO_BUILD_JOBS=1`, kein Dienstneustart, keine Unterbrechung aktiver Sitzungen. Die Remote-Konfiguration wird erst nach getrennter Freigabe des Nutzers eingespielt. | Nutzer | freigegeben 03.10. (17:30 UTC, Nutzerantwort „ja er soll ersetzt werden“); Starter am 03.10. 19:38 auf dem Server eingespielt (SHA-Prüfung, `bash -n`, Backup des Originals). Beobachtet 04.10.: Worker-Läufe über den Starter haben PRs #244, #246, #247, #250 und #251 geliefert, alle über die Queue gemergt; PR #256 nennt im Text einen vollen `prepush`-Lauf (Exit 0) auf dem Server. Diese Sitzung (Sonnet 5.5) lief selbst über den Starter. Das Kontingent ist von hier nicht beobachtbar; die Angabe dazu liefert der Koordinator. Nicht belegt: je Modell eine Aufschlüsselung (Fable) der Läufe. |
| N1 | Darf der Orchestrator v1.5.0-beta und v1.5.0 selbst taggen und veröffentlichen? | Ja, sobald alle Gates und die 27 Matrixzeilen belegt sind. | Nutzer | ✓ entschieden (Nutzer 04.10.): ja (R-1, W4-04). |
| N2 | Echte Proben und Tests am PC | Erlauben. | Nutzer | ✓ entschieden (Nutzer 04.10.): echte Proben mit Claude/Codex/OpenCode sind erlaubt und dürfen Abo-Kontingent verbrauchen (HQ2-05b, P0); Agenten dürfen den PC des Nutzers für Tests nutzen und die ProjectA-App öffnen, bedienen und schließen. |
| W5-02b3 | Produktfrage: Verhältnis der globalen Env-Stufe zur Isolation je Profil | Globale Stufe ersetzt die Profil-Isolation. | Nutzer | ✓ entschieden (Nutzer 04.10.): die globale Stufe ersetzt die Isolation je Profil für gewöhnliche Agenten; Koordinatoren bleiben immer `strict`; profilspezifisches `passthrough` bleibt. |
| M4-Blocker | Planning-access-Befunde 3/4 aus dem Security-Review vom 03.10. blockieren M4 (`planning_access` ohne Projektrahmen, TOCTOU). | Vor M4-Abnahme beheben und erneut prüfen. | Nutzer | offen |
| E14 | Offline-Sicherung des Updater-Signierschlüssels. Er liegt heute nur als Repository-Environment-Secret, es gibt keine lokale Kopie. | Verschlüsselter einmaliger Export in den Passwort-Manager des Nutzers; ohne Kopie geht bei Verlust das Update-Vertrauen verloren. | Nutzer | offen, Nutzer, dringend |
| E15 | Bleibt der gemietete Build-Server nach dem Release? (Kostenentscheidung; Betrag steht hier nicht.) | Nach v1.5.0 mit Nutzen und Kosten bewerten. | Nutzer | offen, nach v1.5.0 |
| E16 | Lizenz und Geschäftsmodell vor den ersten externen Nutzern. Heute MIT; Optionen: MIT bleiben, Open Core, Doppellizenz. Für echte Verkäufe rechtliche Beratung einholen. | Vor M5-01 entscheiden. | Nutzer | offen, nach v1.5.0 |
| E17 | Alte Arbeitsbäume entfernen? 29 von 81 sind nachweislich sicher (PR gemergt oder geschlossen, 0 geänderte Dateien, 0 ungepushte Commits, 0 Commits außerhalb von main); Liste liegt beim Orchestrator. Löschen entscheidet der Nutzer, vorher Backup. | Niedrige Priorität; nicht auf dem v1.5.0-Pfad. | Nutzer | offen, niedrig |
| E18 | Matrixzeile 3 (riskante Übergänge, `resume`): Für v1.5.0 einengen? Vorschlag (Empfehlung): `resume` ist in v1.5.0 nicht verfügbar; ein Laufzeittest mit echtem Store belegt, dass `resume` ohne, mit falschem und mit aktuellem Urteil abgelehnt wird und nichts verändert, auch nach Neustart (Paket M4-ROW3-A eingereiht). Alternative: urteilsgebundenes `resume` bauen (5 Pakete, davon 2 auf der st-Spur, v1.5.0 ca. 1–2 Tage später). Bis zur Antwort gilt der Vorschlag als Arbeitsannahme. | Hohe Priorität; v1.5.0-Pfad, Empfehlung annehmen. | Nutzer | offen, hoch |
| E19 | Matrixzeilen 15 und 17 eingeengt statt neu gebaut (Berater Fable + Astra, 04.10., beide Empfehlung: einengen). Echte Policy-Revision je Kandidat (DF-13) und echte Freigabe-Widerrufung (W5-02d) werden in M5 nachgeprüft. Gilt als Beraterentscheid; der Nutzer kann widersprechen. | Hohe Priorität; v1.5.0-Pfad. | Nutzer | entschieden (Berater), Nutzer kann widersprechen |
| E20 | Zeilen 18 und 27 blockieren v1.5.0 in der heutigen Fassung: `releaseEligible` verlangt Review-Befugnis (W5-02d, nach M4 geparkt) und zugleich eingeschalteten Dauerbetrieb, obwohl E5 sagt, der Dauerbetrieb bleibt bis nach der Abnahme aus. Optionen: (A, Empfehlung beider Berater) v1.5.0 = App-Release über den menschlich kontrollierten Weg PR -> Gates -> Merge-Queue; Dauerbetrieb wird aus und nicht releasefähig ausgeliefert; Zeile 18/27 und das Audit werden getrennt (App-Release vs. Dauerbetrieb), der Nutzer bestätigt die Abnahme selbst in einer Datei; (B) Review-Befugnis jetzt bauen (mehrere Stufe-A-Pakete an Nahtstellen, v1.5.0 deutlich später); (C) Release verschieben. | Höchste Priorität; v1.5.0-Blocker. | Nutzer | ✓ entschieden (Nutzer 04.10.): Option A — v1.5.0 = App-Release, Dauerbetrieb aus und nicht releasefähig, Abnahme per Nutzer-Attestierung |
| E21 | Matrixzeile 2 (Aktivierung durch eine einzelne Nutzerentscheidung): Dauerbetrieb bleibt in v1.5.0 aus (E20). Optionen: (A, Empfehlung) Zeile 2 lautet für v1.5.0 „Schalter gebaut und gesperrt (W4-03), Einschalten erst nach v1.5.0“; (B) Zeile 2 nach M5 verschieben. | v1.5.0-Pfad klären. | Nutzer | offen, Nutzer |
| E22 | Matrixzeile 16 (unabhängige Reviews): Heute laufen Reviews als PR-Text mit anderer Modellfamilie; eine Review-Freigabe in der App gibt es in v1.5.0 nicht (W5-02d nach M4 geparkt). Optionen: (A, Empfehlung) Zeile 16 für v1.5.0 auf „Review durch andere Modellfamilie im PR, an denselben Kandidaten gebunden“ verengen, echte App-Freigabe in M5; (B) offen lassen bis M5. | v1.5.0-Pfad klären. | Nutzer | offen, Nutzer |
| E23 | Matrixzeile 24 (Benchmark 5 Aufgaben, W4-01 #73): Ein echter Lauf verbraucht Abo-Kontingent. Optionen: (A) freigeben, Lauf am PC mit den 5 bestätigten Aufgaben; (B) nach v1.5.0 verschieben. | Nutzerfreigabe vor dem Lauf. | Nutzer | offen, Nutzer |
| E24 | Name der Beta: Die Release-Pipeline akzeptiert nur x.y.z (`scripts/verify-windows-package.ps1:5`, `scripts/release.cmd:16`). Beta heißt v1.5.0, Endrelease v1.5.1? | Empfehlung: ja (kein Umbau). Alternative: echte `-beta`-Tags = `release.yml`-Umbau (Stufe A). | Nutzer | offen (05.10.) |
| E25 | R-1 ist zirkulär: Update-Drill (success/cancel/fail) und W3-07 brauchen ein echtes veröffentlichtes Update (fester Endpoint `tauri.conf.json:54-56`), R-1 verlangt sie aber vor dem Tag. Sollen sie Teil der Beta-Abnahme werden statt Voraussetzung? | Empfehlung: ja; Drills 1-6 und 8 vorher auf lokal signiert gebautem Installer (`node scripts/build-signed-windows.mjs`). | Nutzer | offen (05.10.) |
| R19 | Matrix-Zeile 19 enger gefasst: v1.5.0 verlangt vollständige Audit-Envelopes nur für die sicherheitskritischen Pfade (M4-R19-01/-05/-06/-08); die übrigen Pfade (M4-R19-02/-03/-04/-07/-09) folgen nach v1.5.0 in M5. | Auf die sicherheitskritischen Pfade verengen; Rest in M5. | Nutzer | ✓ entschieden (Nutzer 04.10.) |

Entschieden am 25.09. (Entscheidungsseite des Orchestrators, umgesetzt in
PLAN-01): Meilensteine M1–M4; Streichen, Parken und Vereinfachen wie oben;
Zwischenrelease v1.5.0-beta als Abschluss von M3; DF-07d erledigt; DF-15b ja;
W2-08b ja; W1-27 entscheidet der Advisor; Spec nur für M-Pakete; gestufte
Reviews; PR-Text ist der Bericht; CI nur bei „ready“ und in der Queue.
Frühere Entscheidungen (Nr. 1–17): `.pa/archiv/PLAN_2026-09-24.md` §5 und
`docs/decisions.md`.

## Belege und Verträge, die weiter gelten

- `.pa/task_continuous_devhq.md` — Vertrag für den Continuous Mode (10.09.).
- `.pa/continuous_acceptance_matrix.md` — Abnahmematrix, 27 Zeilen.
- `.pa/plan_projects_w5.md` — Konzept der Welle W5 (Pakete außerhalb des Kerns geparkt).
- `docs/development/HQ2_CONTRACT.md` — Verträge von HQ, App und CLI (DF-03).
- `docs/ERLEDIGT.md` — erledigte Pakete mit PR, Merge-SHA und Bericht.
- `.pa/archiv/` — alte Plan- und Standfassungen, historische Specs, Review-Prompts.

## DEVFLOW-Tabelle (Quelle des Planimports DF-04)

Der Planimport (`src-tauri/src/development_plan.rs`) liest genau diese Tabelle
und erwartet alle 38 Zeilen DF-00 bis DF-37. Deshalb bleibt sie vollständig;
der Status steht am Anfang der letzten Spalte. Die Zeilen sind nicht Teil der
Meilensteine (DF-15b ist erledigt, PR #16).

| ID | Paket / Agent / Scope | Nach | Konkretes Ergebnis und Abnahme |
|---|---|---|---|
| DF-00 | Bestandsabgleich · Architekt · DOC · S | — | Erledigt (PR #70). Live-Git, PR, offene HQ2/W-Gates, vorhandene Implementierungen und Fähigkeiten abgleichen; Pfad-Allowlist und Überlappungsmatrix für alle Pakete, keine doppelte Implementierung. |
| DF-01 | Autonomie-Interview · Koordinator · DOC · S | DF-00 | Erledigt (PR #70). Entscheidungen zu Repo-Schreiben, Commit/Push, Merge/Release, Netzwerk/Installation, Secrets, destruktiven Aktionen, Isolation und Eskalation erfassen. |
| DF-02 | Gemeinsame Desktop-Richtung · design-director · DOC · S | DF-00 | Erledigt (PR #70). Bestehende PC-Ansichten kritisch prüfen, Designvertrag mit Navigationshierarchie, Zuständen, Dichte und Live-Vorschau; Impeccable anwenden, Screenshots als Ausgangsevidenz. |
| DF-03 | Domain-/Eventvertrag · Architekt · DOC · M | DF-00 | Erledigt (PR #70). Obige Verträge mit vorhandenen APIs abgleichen; Übergangstabelle, Fehlerfälle, Migration/Versionsstrategie und App/HQ-Parität festlegen; zwei unabhängige Reviews vor Integration der gemeinsamen Nahtstelle. |
| DF-04 | Planimport · Backend · CORE · M | DF-03 | Erledigt (PR #70, DF-04a/b/c). Markdown-Pakete mit stabilen IDs und Quellenrevision projizieren; Tests für fehlende IDs, Zyklen, geänderte Quelle, Wiederimport ohne Duplikate. |
| DF-05 | Plan-Lesezugriff · Integrator · SEAM/HOST · M | DF-04 | Erledigt (PR #70, DF-05a/b). Gemeinsamen lesenden App/HQ/CLI-Vertrag anbinden; identische Paketdaten und explizite Fehler statt leeren Erfolgs prüfen. |
| DF-06 | Grafische Roadmap · Frontend · HQ · M | DF-02, DF-05 | **Geparkt (25.09.)** DF-06b hängt am Workflow-Motor (DF-11/16). DF-06a erledigt (PR #70). Ursprünglich: DF-06a erledigt (PR #70). Offen DF-06b: Ausführungszustände bereit/aktiv/erledigt nach DF-11/DF-16 mit belegter Paket-/Run-Bindung; bis dahin bleibt der Ausführungsstatus unbekannt. Hierarchie, Abhängigkeiten, kritischer Pfad, Quellenklick und Prioritätsgrund mit echtem Plan und leeren/fehlerhaften Daten prüfen. |
| DF-07 | Desktop-Dichte · Frontend · HQ/APP · M | DF-02 | **Erledigt.** DF-07a–c über PR #70; DF-07d hat der Nutzer am 25.09. als erledigt bestätigt, die Sichtprüfung gehört zur M3-Abnahme. Ursprünglich: DF-07a–c erledigt (PR #70). Offen DF-07d: visueller PASS der React-Dichte (Code über PR #70 gemergt, `.pa/report_df07d_native_density.md`); DF-07 ist erst danach abgenommen. Komfortabel/Kompakt ändern messbar Zeilenhöhe, Abstand, Paneelgrößen und sichtbare Informationsmenge; Screenshots bei 1280×800 und 1920×1080, Tastatur und Zoom prüfen. |
| DF-08 | Ausführungsidentität · Backend · CORE · M | DF-03 | **Geparkt (25.09.)** DF-08d hängt an DF-11. DF-08a–c erledigt (PR #70). Ursprünglich: DF-08a–c erledigt (PR #70). Offen DF-08d: native Modellbeobachtung, Adapter-/Profilbelege, Workflow-Anbindung nach DF-11. Provider, Modell/Familie, Adapter und Erscheinungsprofil getrennt führen; konfiguriert ist nicht beobachtet; Alias-/Unbekannt-Fälle testen. |
| DF-09 | Profilwahl im Chat · Frontend · HQ/APP · M | DF-02, DF-08 | **Geparkt (25.09.)** DF-09b wäre ein Doppelbau (React neben HQ); erst nach der Entscheidung „HQ als Hauptbereich der App“. DF-09a erledigt (PR #100). Ursprünglich: DF-09a erledigt (PR #100, lokale Chat-Erscheinungen). Offen DF-09b: React-Parität und Admission-Kompatibilität. UI-Profil Codex/Claude/DeepSeek unabhängig vom belegten Modell wählen; unterstützte native Kombinationen von reiner Darstellung unterscheiden, inkompatible Starts verweigern. |
| DF-10 | Chat-Modi und Interview · Integrator · CORE/SEAM/HQ/APP · M | DF-01, DF-03, DF-09 | **Geparkt (25.09.)** Zusammen mit HQ2-04; kommt mit der einen Oberfläche nach M4 zurück. Ursprünglich: Übernimmt HQ2-04 (beratende und aktive Sitzung getrennt sichtbar, manueller Providerwechsel mit Übergabe). Plan/Interview/aktive Ausführung mit konkreten Rückfragen und Projektkontext; Planmodus darf keine Schreibbefugnis erzeugen. Reale Sitzung mit Antwort belegen; Integration bei Bedarf in Kinder teilen. |
| DF-11 | Workflow-Zustand · Backend · CORE · M | DF-03 | **Geparkt (25.09.)** Workflow-Motor: zweite Steuerung neben dem fertigen Continuous-Kern. Ursprünglich: Persistente Stage-Zustände und append-only Übergangsereignisse auf vorhandener Queue; ungültige Übergänge und Neustart testen. |
| DF-12 | Unabhängigkeitsgate · Backend · CORE · M | DF-08, DF-11 | **Gestrichen (25.09.)** Doppelung: die Autor-Familiensperre steckt in W2-01 ✓ und W5-02d. Ursprünglich: Kandidatenweite Autor-Familienmenge sperrt eigene Review-/Testbewertung, auch nach Handoff/Alias/Review-Fix; unbekannte Identität blockiert Attestation. Negativtests zwingend. |
| DF-13 | Berechtigungsteam · Backend · CORE · M | DF-01, DF-11 | **Geparkt (25.09.)** Workflow-Motor. Ursprünglich: Versionierte, vom Nutzer festgelegte Policy auswerten; erlauben/ablehnen/eskalieren mit Gründen. Keine Selbst-Erweiterung, kein gefälschter Human-Verdict; Replay und Scopewechsel testen. |
| DF-14 | Stationsübergabe · Backend · CORE · M | DF-12, DF-13 | **Geparkt (25.09.)** Workflow-Motor. Ursprünglich: Bestehende Admission/Claims für nächste Station nutzen; atomare Übergabe, Idempotenz, Fencing, Budget aller Nachfahren. Doppelzustellung und Crash vor/nach Spawn testen. |
| DF-15 | Rücklauf und Recovery · Backend · CORE · M | DF-14 | **Geparkt (25.09.)** Workflow-Motor; DF-15a erledigt (PR #103), DF-15b erledigt (PR #16). Ursprünglich: Review→Fix→neuer Review, Pause/Cancel, Quota/Auth-Ausfall, begrenzte Wiederholung und Wiederaufnahme; Leaseablauf nie als Prozessende werten. Der frühe Provider-Exit vor dem Lesen des Task-Inputs ist als DF-15a erledigt (PR #103, Endzustand `exited_undelivered`, Migration 22); die dabei offen gebliebene Freigabe von Reservierung und Delivery ist als DF-15b erledigt (KNOWN_ISSUES KI-27: Reservierung `cancelled` und Delivery-Freigabe journalisiert, atomar im bewiesenen Exit-Commit, ohne neue Migration). |
| DF-16 | Workflow-API · Integrator · SEAM/HOST · M | DF-15 | **Geparkt (25.09.)** Workflow-Motor. Ursprünglich: Start/Pause/Status/Decision über denselben Kern für App/HQ/CLI; Autorisierung, Konflikt und Event-Replay prüfen, kein Scheduler im Host. |
| DF-17 | Team-/Stationsgraph · Frontend · HQ · M | DF-02, DF-16 | **Geparkt (25.09.)** hängt an DF-16. Ursprünglich: Ideen→Interview→Plan→Koordination→Architektur→Code/Design→Review→Test→Kritik mit konfigurierbaren Stationen, Rollen, Zuständen und Übergabegründen; native Teams/Lessons erhalten. |
| DF-18 | Entscheidungs-Inbox · Frontend · HQ/APP · M | DF-16 | **Gestrichen (25.09.)** Doppelung mit W5-06/06b/08a/08b (die selbst geparkt sind). Ursprünglich: Nur echte Nutzerfragen/Freigaben, Kontext/Optionen/Auswirkung, Zielprojekt und Version sichtbar; doppelte/veraltete Entscheidung abweisen und auflösen. |
| DF-19 | Prioritäten und Advisor · Backend · CORE · M | DF-08, DF-12, DF-03 | **Gestrichen (25.09.)** Routing ist dreifach geplant (DF-19/20, W5-30b/33, HQ2-07); später eine gemeinsame Fassung. Ursprünglich: Taskklasse, Abhängigkeiten, Evidenz, Benchmark/Erfahrung, Quota und Policy in erklärbare Empfehlungen für Priorität/Modell/Effort übersetzen; fehlende Daten und manuelle Overrides testen. |
| DF-20 | Routing-Editor · Frontend · HQ/APP · M | DF-19 | **Gestrichen (25.09.)** wie DF-19. Ursprünglich: Anbieterreihenfolge, Regeln, Taskklassen, Reserven, Ausschlüsse, Fallbacks und Override editieren; Simulation erklärt Auswahl/Ablehnung, Revision verhindert verlorene Änderungen. |
| DF-21 | Erweiterungskatalog · Backend · CORE · M | DF-03 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: GitHub-Quellen zu Plugins/Skills auf feste Revision auflösen, Quelle/Kompatibilität/Rechte/Scope anzeigen; bestehende Installer wiederverwenden, untrusted Metadaten nicht ausführen. |
| DF-22 | Installation und Rücknahme · Backend · CORE · M | DF-13, DF-21 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Kontrollierte Installation, Update, Deaktivierung und Rollback über geprüften Pfad; Traversal/Symlink, abgebrochenen Download und Versionswechsel testen; globale Änderungen nach Policy. |
| DF-23 | Katalog-Bedienung · Frontend · HQ/APP · M | DF-22 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: GitHub-Link hinzufügen und ein Klick installieren, soweit Policy erlaubt; sonst begründete Entscheidung. Realer Installationszustand statt bloßer Prompt-Auswahl. |
| DF-24 | Task-Preflight · Backend · CORE · M | DF-14, DF-22 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Vor Task und Scopewechsel erforderliche/hilfreiche Skills/Plugins auswählen; nur relevante laden, Auswahlgrund/Version/tatsächliche Verwendung protokollieren; fehlende Pflichtfähigkeit blockiert. |
| DF-25 | Schneller Entwurfsbereich · Backend · CORE · M | DF-13, DF-03 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Worktree, isolierte Projektdaten und Live-Preview-Lebenszyklus; Start/Stop/Recovery, keine fremden Prozesse beenden. Klar als Arbeitsisolation kennzeichnen. |
| DF-26 | Stärkere Sandbox · Backend · CORE · M | DF-25 | **Gestrichen (25.09.)** Container/VM ist auf 16 GB RAM unter Windows fraglich. Ursprünglich: Einen belegbar verfügbaren Container- oder VM-Adapter mit Filesystem-/Netzwerk-/Ressourcengrenzen integrieren; fehlende Voraussetzungen anzeigen, kein stiller schwacher Fallback. |
| DF-27 | Architekturansicht · Frontend · HQ · M | DF-05, DF-25 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Reale Modul-/Abhängigkeitsdaten mit Quellen und Abdeckung visualisieren; Änderungsvorschlag→Diff→Test→Übernahme, unbekannte Analysebereiche sichtbar. |
| DF-28 | Gemeinsames Design-Livebild · Frontend · HQ/APP · M | DF-17, DF-25 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Laufende echte App/Website, gewählter Schritt, Agentendelta und Feedback nebeneinander; Änderungen fortlaufend nachvollziehbar, Wiederverbindung/Fehler testen. |
| DF-29 | Messereignisse · Backend · CORE · M | DF-11, DF-08 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Zyklus-/Wartezeit, Rework, Review/Test, Recovery, Routing und beobachtete Usage mit Quelle erfassen; Deduplikation, Einheit, fehlende Werte, Retention/Redaktion prüfen. |
| DF-30 | Statistikprojektionen · Backend · CORE · M | DF-29, DF-24 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Filterbare Task-/Modell-/Provider-/Skill-Vergleiche, Stichproben und Qualitätsmetriken, API/Export; keine Gleichsetzung von Korrelation und Ursache oder Abo-Quoten. |
| DF-31 | Statistik-Cockpit · Frontend · HQ/APP · M | DF-02, DF-30 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Große Analysefläche mit Trends, Verteilungen, Engpässen, Rework, Teststabilität, Kapazität, Quellen-Drilldown und Einstellungen; echte Daten plus kenntliche Fixture-Tests. |
| DF-32 | Releaseprognose · Backend/Frontend · CORE/HQ · M | DF-06, DF-30 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Kritischen Pfad und beobachteten Durchsatz mit Unsicherheitsintervall verbinden; ohne ausreichende Daten kein Datum. Readiness separat aus offenen Gates, Reviews/Tests und Blockern anzeigen. |
| DF-33 | Vorlagenkatalog · Backend · CORE · M | DF-03 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Versionierte editierbare Templates für Idee/Projekt/Plan/Team/Harness/Review/Test/Policy/Release; Kontextvorschlag mit Vorschau, kein stilles Überschreiben. |
| DF-34 | Vorlagen im Arbeitsfluss · Frontend · HQ/APP · M | DF-10, DF-18, DF-23, DF-33 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Passende Vorlagen an Eingabestellen anbieten; übernehmen/anpassen/verwerfen, Entwürfe bei Navigation erhalten und gleiche Semantik in App/HQ prüfen. |
| DF-35 | Durchgängiger Runtime-Nachweis · Tester · DOC/Tests · M | DF-20, DF-24, DF-26, DF-27, DF-28, DF-31, DF-32, DF-34 | **Gestrichen (25.09.)** ersetzt durch die Abnahme je Meilenstein. Ursprünglich: Isoliertes Projekt vom Plan bis zu modellunabhängigem Review/Test; reale Modellantwort, Übergaben, Rückfrage, Neustart und Datenparität messen; negative Gates mitprüfen. |
| DF-36 | PC-Politur und Designabnahme · design-director · HQ/APP · M | DF-35, DF-07 | **Gestrichen (25.09.)** ersetzt durch die Abnahme je Meilenstein. Ursprünglich: Impeccable-Kritik anhand echter Screenshots; leere/ladende/fehlerhafte/dichte Ansichten, Fokus, Zoom, Kontrast und Hell/Dunkel prüfen; Befunde nachvollziehbar schließen. |
| DF-37 | Abschluss und Releaseentscheidung · Integrator/Reviewer · DOC · S | DF-36 | **Gestrichen (25.09.)** ersetzt durch die Abnahme je Meilenstein. Ursprünglich: Zwei unabhängige Reviews für große/Shared-Seam-Änderungen, Dispositionen, aktuelle Gates und NICHT ABGEDECKT; Readinessbericht. Merge/Release/Continuous nur mit geltender menschlicher Freigabe. |

Größen und Abschlussprotokoll der DEVFLOW-Pakete, Verträge und Scopes stehen in
`.pa/archiv/PLAN_2026-09-24.md` (Abschnitt DEVFLOW).
