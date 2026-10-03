# PLAN — der einzige Plan für ProjectA

Stand: 03.10.2026 (Paket PLAN-SYNTHESIS-03 auf `origin/main` 1b38596; davor PLAN-SYNC, 02.10.2026).
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
| HQ2-02 | Abnahme der Konzeptdemo und Studio-Variante; legt die Richtung für „HQ als Hauptbereich der App“ fest | M | hqS + N | offen |
| HQ2-03 | Gemeinsame Design-Tokens hell/dunkel, nach HQ2-02 | M | hqS | offen |
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
| W1-01b | Kimi-Re-Smoke mit `PROJECTA_PTY_TRACE_DIR` | S | pty | blockiert (Kimi-Abo abgelaufen 02.10.) |
| W1-27 | KI-20, doppelte `ESC[6n`-Antwort; welche Seite antwortet, entscheidet der Advisor (Nutzer 25.09.) | S | pty + fe | PR #140 (offen, ersetzt das geschlossene #112; `do-not-merge` bis Stufe-A-Prüfung und eigener `prepush`) |
| W3-08 | Paketierter HQ-v1-Beleg | S | N | offen |
| R-1 | Zwischenrelease v1.5.0-beta als Abschluss von M3 | S | N + doc | offen |

### M4 — Dauerbetrieb abgenommen, v1.5.0

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| W5-05 | Prüfpfad (append-only, Trigger gegen UPDATE/DELETE) | S | st | ✓ #44 |
| W5-04a | Not-Aus im Store, **global ohne Projektrahmen** (Schnitt 25.09., W5-01a bleibt geparkt) | S | st | ✓ #69 |
| W5-04b | Not-Aus in der App (10 s Frist) | S | mn | ✓ #125 (Backend W5-04d ✓ #157, Release-Auth W5-04e ✓ #158) |
| W5-04c | Not-Aus in `pa` | S | pa | ✓ #124 |
| W2-02b | Gleichstand in derselben Sekunde, vertrauenswürdige Testquelle, Merge-Ergebnis als Kandidat | M | st | teilweise: Gleichstand ✓ #82, Testquelle ✓ #122; „Merge-Ergebnis als Kandidat“ nicht belegt |
| W2-04c | Rollenbewusste Routen und Credentials beim Launch | M | st | Teil 1: PR #178 (Entwurf, ersetzt #147; Prüfung läuft) |
| W2-04d | Rollen auf Budget-Zwecke abbilden | S | st | ✓ #15 |
| W2-04g | Optional: Versionsspalte für die Attestierungsregel | S | st | offen |
| DF-15b | Reservierung und Delivery bei `exited_undelivered` freigeben (KI-27; Nutzer 25.09.: ja) | S | st | ✓ #16 |
| W2-07b | Windows-ACL für `projecta-api.json` und `agent-access/` | S | api | ✓ #12 |
| W2-08b | Speicher-/CPU-Grenzen je Job (Nutzer 25.09.: ja); Stillstand früh erkennen (Denk- und Fortschrittszeichen prüfen, sonst nach 15 min) | M | fR | ✓ #53 |
| W2-09b | DeepSeek-V4-Flash-Worker über OpenCode | M | wk | ✓ #78 |
| HQ2-05b | Echte Collector-/Billing-Proben je Anbieter; vorher prüfen, ob W2-03 es schon abdeckt | M | fR + N | offen |
| W5-02b3 | Env-Stufe als globale Einstellung (st → api → fe) | M | st → api → fe | offen |
| W5-02b4 | Push aus dem Worker über den Runner-Host, danach `strict` als Voreinstellung | M | pty + wk | ✓ #65 |
| W5-02b5 | Test für den `http.extraHeader`-Reset; GPG unter `strict` | S | fR | ✓ #17 |
| W1-03f | F-CORE-3 Baustein C: Zustell-Queue, `pa worker done/blocked` (braucht das Z-1-Protokoll am PC) | M | wk + pa | offen |
| W3-01 | Globaler DB-Wartungs-/Write-Lock + Drain (st-Kind, dann mn-Kind) | M | st → mn | offen |
| W3-02 | Windows-Recovery-Helper | M | fR + N | offen |
| W3-03 | Paketierte Drills: Singleton, Crash/Power-Loss, Backup (3 × S) | S | N | offen |
| W3-04 | Updater-Zustände in App und HQ | S | fe + hqL | ✓ #119 |
| W3-07 | Produktionsschlüssel-Build + Signed-Updater-Relaunch (Nutzer: später) | S | N | offen |
| W4-01 | Benchmark, verkleinert auf 5 Aufgaben statt 20 (E2, Nutzer 02.10.) | M | fR | ✓ #73 |
| W4-02 | Abnahmematrix final (27 Zeilen) | S | doc | ✓ #48 |
| W4-03 | Continuous-Aktivierung, nur nach W4-02 und mit Freigabe des Nutzers | S | mn | offen |
| W4-04 | Release v1.5.0 | S | N | offen |

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

### Architektur-Pakete aus dem Architektur-Rat (03.10.2026)

Die folgenden Pakete sind neue Ideen und bleiben nach AGENTS.md unter „Später“.
ARCH-11 ist die Ausnahme: Es ist als M3-Kandidat vorgemerkt, ohne die
M3-Abnahme-Tabelle zu ändern.

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
| ARCH-11 | **M3-Kandidat:** KI-24b auf Windows reproduzieren und den Test-DB-Wiederöffnungs-Wettlauf durch bewiesenes Pool-Schließen oder gezieltes Warten absichern. | `testutil.rs` + betroffene Tests | fR + N | nein | A (DB) | Regression-For: KI-24-Läufe 36165944208/36215024767; 20× close→reopen auf Windows | als M3-Kandidat aufnehmen; Windows-Lauf nötig |
| ARCH-12 | `impl ControlBackend for ApiBackend` aus `main.rs` auslagern. Das Paket bleibt gesperrt, weil der Trait-Block als reine Verschiebung mehr als 300 Diffzeilen erzeugt. | `main.rs`, `api/backend.rs`, ~715 Z. | mn + api | ja | A | No-Test: mechanische Verschiebung erst nach ADR A1 | nach ADR A1; gesperrt |

### Synthese der Bestandsaufnahmen INV-01..08 und des Architektur-Rats (03.10.2026)

Quelle der Bestandsaufnahmen sind die PR-Texte (Abschnitt „Bestandsaufnahme“);
sie liegen nicht als Dateien im Repo. Der Architektur-Rat ist die Tabelle oben.
Alles hier ist **Quellenbefund oder Hypothese, kein reproduzierter Fehler**: ein
Bugpaket braucht zuerst einen kompilierenden roten Test, eine Laufzeit- oder
Performanceaussage eine Messung. Nichts davon ist in M1–M4 aufgenommen. Die
Nummern unten sind heutige PR-Nummern, beobachtet am 03.10.2026 mit
`gh pr view` auf `origin/main` 1b38596.

**Stand der Pakete.** Architektur-Rat und Team-Katalog sind abgeschlossen; die
Umsetzung von ARCH-02/03/06/07/09/10/12 (und die Rest-Aufteilung von ARCH-08)
ist offen. Ersetzt: #152 → #172 (gemergt), #147 → #178 (Entwurf), #130 → #183
(offen, in der Queue). Gemergt über die Queue: #154, #157, #158, #160, #73,
#169 (ARCH-04), #170 (CI-06), #172, #175. Offen: #140 (PTY, `do-not-merge`),
#178, #181 (ARCH-08a), #182 (ARCH-05, Entwurf), #183, #186 (UX-03, Entwurf).
Veraltete Altangaben (#130, #147, #152, #112 als „offen und maßgeblich“) gelten nicht mehr.

**Serielle Reihenfolgen** (jede Scheibe ≤ 300 Diffzeilen **einschließlich**
Verschiebungen und Tests; Überschneidungen trotz anderer Paketnamen prüfen):

| Lane | Reihenfolge |
|---|---|
| `mn` | ARCH-05 (#182; #157 ist gelandet) → ARCH-06. ARCH-03 braucht zusätzlich freie `mn`-Lane, ARCH-05 **und** ARCH-04 (#169, gelandet) und vorher die Bewertung der Vault-Quellenbefunde unten, damit die Konsolidierung deren Muster nicht verbreitet. |
| `fR` queue | ARCH-02 erst nach #160 (gelandet) **und** #183. |
| `pty` | #140 → PTY-READ-01 → PTY-RETIRE-01 → PTY-GUARD-01; nie zwei zugleich. Guard belegt Produktionspfad und Überlauf, keine stillen Eingabeverluste. |
| `st` / `api` | ARCH-07 nach #178 und gemäß st-Reihenfolge; `api` nach #158 (gelandet), ARCH-10 vor W5-02b3. Keine neuen Continuous-Migrationen. |
| `fe` | ARCH-08 nach #154 (gelandet; #181 ist Scheibe a); M3-02 und UX-03 nach #172 (gelandet), UX-03 liegt als #186 vor. ARCH-09 nach ARCH-08. |

ARCH-11/KI-24b ist der laut Architektur-Rat nützlichste weitere Schutz (ein
roter Test-DB-Wettlauf auf Windows hält die Queue an). Er ist **priorisierter
Kandidat**; die Aufnahme in M3 bleibt Nutzerentscheidung F6. ARCH-12 bleibt
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
| INV-SEC-VAULT-TEMP | `providers.rs:867` `write_atomic`: vorhersehbarer Tempname `provider-keys.json.tmp-<pid>`, `create(true).truncate(true)`; ein untergeschobener Symlink könnte den Schreibvorgang umleiten (Hypothese, nicht belegt). | Roter Symlink-Test; **vor ARCH-03** |
| INV-SEC-VAULT-ARCHIVE | `providers.rs:728` `archive_corrupt`: Name aus Sekunde + PID; zwei Reparaturen in einer Sekunde könnten kollidieren. | Roter Zwei-Reparaturen-Test; vor ARCH-03 |
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

Offene Fragen an den Nutzer stehen hier gebündelt, mit Empfehlung. Offen sind
E1, E10, E11, E12, F1, F3 und F6; F2, F4 und F5 sind entschieden und werden nicht
neu gefragt. Agenten
unterbrechen den Nutzer nicht einzeln im Chat, sondern tragen die Frage hier ein
(AGENTS.md, Regel 10).

| # | Frage | Empfehlung | Wer entscheidet? | Status |
|---|---|---|---|---|
| E1 | HQ2-02: Demo und Studio ansehen und die Richtung für die eine Oberfläche festlegen. Der Entscheid blockiert die Farbthemen T2–T5 in HQ2-03. | In M3 entscheiden und danach HQ2-03 starten. | Nutzer | offen |
| E1-Hinweis | HQ2-02/03 blockiert die Farbthemen T2–T5. | Erst HQ2-02 festlegen, dann die Farbthemen in HQ2-03 bearbeiten. | Nutzer | Hinweis |
| E2 | W4-01: Benchmark auf 5 Aufgaben verkleinern oder durch ein Nutzer-Gate ersetzen | 5 Aufgaben | Nutzer | ✓ entschieden: 5 Aufgaben (Nutzer 02.10.) |
| E3 | Secrets aus der Repo-Ebene in geschützte Environments, Required Reviewers für `release` | ja; einmal im Browser klicken | Nutzer | offen (Nutzer) |
| E4 | W3-07 Produktionsschlüssel | vor v1.5.0 | Nutzer | später (Nutzer 25.09.) |
| E5 | W4-03 Continuous-Aktivierung | erst nach W4-02 | Nutzer | offen |
| E6 | W5-02e eigener Windows-Benutzer für Agenten | nach M4 | Nutzer | später (Nutzer 25.09.) |
| E7 | W5-Kern: beschlossen waren W5-22, W5-28, W5-02a und Not-Aus; PLAN-01 hat zusätzlich W5-00b, W5-02b3–b5/b7 und den Prüfpfad W5-05 in M3/M4 eingeordnet | erweiterten Kern bestätigen | Nutzer | ✓ bestätigt (Nutzer 02.10.) |
| E8 | Routing Nahtstellen/Security: `docs/setup/providers.md` routet primär auf Codex `gpt-6-astra`, Claude-Worker nur als Ausweichen — die alte Modellregel ist damit ersetzt | Routing bestätigen | Nutzer | ✓ bestätigt (Nutzer 02.10.) |
| E9 | M3-01 und M3-02 wurden im Auftrag des Orchestrators in M3 vorgezogen. | Nur als bereits getroffene Reihenfolge vermerken. | Orchestrator | ✓ entschieden (03.10.) |
| E10 | Soll der Landing-Page-/DesignStudio-Abschnitt in `src/App.tsx` (etwa Zeilen 1277–1280) entfernt werden? | Ja, Abschnitt löschen. | Nutzer | offen |
| E11 | Soll die Windows-Flake-Erkennung weiterlaufen, obwohl sie Actions-Minuten kostet? | Kosten und Nutzen abwägen; Empfehlung: nur mit belegtem Nutzen behalten. | Nutzer | offen |
| F1 | Soll die große Verbindungsschicht `ApiBackend` mit etwa 715 Zeilen bis nach M4 in `main.rs` bleiben? | Ja; danach das Trait in Domänenports teilen. | Nutzer | offen |
| F2 | Alte verschlüsselte Sitzungsdateien sollen mit derselben Frist wie die übrige Aufräumfunktion gelöscht werden. | Ja; Umsetzung als ARCH-04. | Nutzer | ✓ entschieden (03.10.) |
| F3 | Die Audit-Tabelle bleibt bis zum Not-Aus in M4 leer. Ist das in Ordnung? | Ja, solange M4 die Audit-Abnahme enthält. | Nutzer | offen |
| F4 | Doppelte PRs schließen. | Ja; #112, #113, #115, #91 und #146 sind geschlossen. | Orchestrator | ✓ entschieden (03.10.) |
| F5 | Toten Code löschen. | Ja; Umsetzung als ARCH-01b und ARCH-07. | Nutzer | ✓ entschieden (03.10.) |
| F6 | KI-24b als ARCH-11 in M3 aufnehmen? | Ja, als M3-Kandidat mit Windows-Lauf. | Nutzer | offen |
| E12 | memorix und desktop-commander im Claude-Start abschalten (hängen teils mit `CONNECT_TIMEOUT`; PLAN M2 nennt memorix als Gedächtnis). | Nutzer entscheidet; keine Änderung ohne Ja. | Nutzer | offen |
| M4-Blocker | Planning-access-Befunde 3/4 aus dem Security-Review vom 03.10. blockieren M4 (`planning_access` ohne Projektrahmen, TOCTOU). | Vor M4-Abnahme beheben und erneut prüfen. | Nutzer | offen |

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
