# Known Issues — v1.6.6

Bewusst offen gelassene Befunde. Quelle ist die Batch-D-Neuprüfung gegen den
Post-U2/Q2-Stand (Re-Triage-Bericht, 2026-08-28; Einstufungen von dort) plus
Betriebsbefunde aus der Konsolidierung; nachgeführt 2026-09-15 auf Stand
v1.4.0 und 2026-09-24 auf Stand v1.4.1 (Release 22.09., `gh release list`); die
Beobachtungs-KIs (KI-7, 21, 22, 24 bis 27) am 2026-10-02 (KI-OBS).
**Nachgeführt 2026-10-15 (Plan-Abgleich) auf Stand v1.6.6:** `package.json` und
`src-tauri/tauri.conf.json` stehen auf 1.6.6, der Tag v1.6.6 liegt auf `a8b00911`;
v1.6.6 ist seit 2026-10-15 09:07Z veröffentlicht (`gh release view v1.6.6`).
Geändert wurde nur die Titelzeile samt diesem Satz; Befunde sind nicht neu bewertet.
**Nachgeführt 2026-10-14 (AP-5a) auf Stand v1.6.3:** `package.json` und
`src-tauri/tauri.conf.json` stehen auf 1.6.3, `gh release list` nennt v1.6.3
(2026-10-11) als jüngstes Release. Die Titelzeile hieß bis dahin v1.6.0; die
Einträge selbst tragen ihre eigenen Prüfdaten und sind mit diesem Schritt nicht
neu bewertet worden. Nur die unten genannten Zeilenverweise und Stände wurden
gegen den Baum geprüft.
Was hier steht, ist mittel oder niedrig und hat je einen Satz Begründung,
warum es den Release nicht aufhält. Behobene Befunde stehen im Block
„Behoben" am Ende; ihre Nummern bleiben dort, damit ältere Verweise ein Ziel
haben.

Seit 2026-09-24 ist diese Datei auch das Zuhause der bewusst offenen
Produktbefunde und Test-Flakes, die vorher in `STAND.md` standen (KI-24 bis
KI-29). `STAND.md` verweist nur noch hierher.

**Zur Lücke KI-4 in der Nummerierung** (nachgeführt 2026-09-17, W1-06):
KI-4 war „`max_workers = 0` heißt ‚nicht gesetzt', nicht ‚aus'" und ist am
2026-08-30 mit v1.0.1 entschieden und behoben worden; die Weiche dazu steht in
`docs/archive/plaene-2026-09/ENTSCHEIDUNGEN-ZU-PRUEFEN.md` Nr. 3. Die Nummer
bleibt frei, damit Verweise aus älteren Reports nicht auf einen fremden Befund
zeigen.

**Zu Verweisen auf Berichte (geprüft 2026-10-14, `git ls-files`):** Dateien wie
`.pa/report_w1-*.md`, `.pa/report_ki-23.md`, `TRIAGE.md`, `STATUS.md` und
`docs/archive/plaene-2026-09/ENTSCHEIDUNGEN-ZU-PRUEFEN.md` sind im Baum nicht
mehr vorhanden; `.pa/archiv/` wurde nicht geprüft (für Agenten gesperrt).
Solche Verweise sind Historie; der Beleg ist der genannte PR bzw. Commit.

KI-9 bis KI-12 kommen aus dem Abhängigkeits-Audit vom 2026-08-29
(`cargo audit` 0.22.2 gegen advisory-db `6420e39`, `npm audit` mit und ohne
dev-Deps). Der Bericht von damals ist **nicht mehr erreichbar**. Ergebnis dort:
**0 Vulnerabilities**, 17 Warnungen, von denen 11 im Windows-Build gar nicht
vorkommen — die Einstufung „nur Linux" heißt genau das und ist per
`cargo tree --target x86_64-pc-windows-msvc` belegt, nicht vermutet.

## Offen

| # | Befund | Stufe | Warum offen |
|---|---|---|---|
| KI-1 | Rollen-Approve im `LearningsPanel`: der Prompt-Zusatz ist nicht editierbar | niedrig | **Teilweise behoben 2026-09-23 (W1-09, PR #78) und 2026-09-24 (W1-09b, PR #99):** `roles.rs::parse_distilled` deckelt `system_prompt` jetzt (`SYSTEM_PROMPT_MAX`, `roles.rs:75`, angewandt in `roles.rs:371`), und das Panel zeigt den Zusatz vor dem Verdict an. Offen ist nur „nicht editierbar": dafür braucht es einen Setter im Store, ein Command und ein Feld im Frontend, also drei Lanes. Paket **W1-09c** (`docs/PLAN.md`, geparkt bis nach M4). Ein Mensch löst das Approve aus, und der Marker-Schutz (`forbidden_marker`) greift. |
| KI-5 | Die Token-Sektion des Statistik-Tabs ist flottenweit, nicht pro Projekt | — (dokumentierte Grenze) | `usage_events` hat keine Projektdimension: OmniRoutes Log kennt weder Session noch Client, und `X-OmniRoute-Session-Id` ist nicht clientseitig setzbar. Steht im Tab, im README und im Code-Kommentar (`omniroute::attribute`). |
| KI-7 | Die `#[cfg(unix)]`-Tests aus Phase-16-Batch C (Dateirechte, Prozessgruppen-Kill) kompilieren auf der Windows-Entwicklungsmaschine nicht mit; sie brauchen eine Linux-Umgebung | — (Betrieb) | **Neu bewertet 2026-09-17 (W1-06):** Heimat dieser Tests ist der CI-Job `gates (linux)` (`.github/workflows/ci.yml`, nextest über die ganze Suite) oder WSL2 auf dem Entwicklungsrechner. Beide Plattformen werden weiter gegatet (Linux in CI, Windows in CI und lokal); eine Maschine, die beides nativ prüft, existiert nicht. Die 0600-Modus-Tests sind seit 2026-10-03 nachgezogen, siehe KI-19 (Behoben). **Nachgeführt 2026-10-02 (KI-OBS):** Die Linux-Hälfte läuft jetzt zusätzlich auf einem eigenen Linux-Server neben CI; die Windows-Hälfte (`#[cfg(windows)]`) bleibt auf der Windows-Bahn bzw. in der Merge-Queue. |
| KI-9 | `glib` 0.18.5, Unsoundness in den `Iterator`/`DoubleEndedIterator`-Impls von `glib::VariantStrIter` ([RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)) | mittel — nur Linux | **Stand 2026-10-09:** weiterhin aktive informative Warnung `unsound`, nicht zurückgezogen. Im geprüften Build-Graphen nur unter `x86_64-unknown-linux-gnu`, nicht unter `x86_64-pc-windows-msvc` vorhanden. Upstream behoben ab `glib >= 0.20`; kein semver-kompatibles Update für `^0.18`. Die Behebung benötigt eine abgestimmte Aktualisierung des Tauri/tao/wry/GTK-Abhängigkeitsasts; GTK4 ist dafür keine belegte Voraussetzung. Quelle: Audit `ki-audit-9-10-a1d9a5fba38d.md` vom 2026-10-09, RustSec-DB `550efd3d`; `cargo audit` und zielbezogene `cargo tree --locked --offline`-Abfragen. |
| KI-10 | `proc-macro-error` 1.0.4 ([RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html)) ist weiterhin *unmaintained* | niedrig — nur Linux | **Stand 2026-10-09:** aktive informative Warnung, `patched: []`; im geprüften Linux-Build-Graphen über `glib-macros` und `gtk3-macros` vorhanden, im Windows-Graphen (`x86_64-pc-windows-msvc`) nicht. Kein kompatibles Update behebt sie. Bewusst *nicht* per `cargo audit --ignore` stummgeschaltet, damit der Tag auffällt, an dem eine davon zur echten Vulnerability wird. Die zehn GTK3-Advisories RUSTSEC-2024-0411…0420 wurden am **2026-08-14 zurückgezogen** (`withdrawn`, Pflege wieder aufgenommen) und gehören nicht mehr zu den offenen Warnungen; die Kisten bleiben im `Cargo.lock`. Quelle: Audit `ki-audit-9-10-a1d9a5fba38d.md` vom 2026-10-09, RustSec-DB `550efd3d`; `cargo audit` und zielbezogene `cargo tree --locked --offline`-Abfragen. |
| KI-24 | SQLite-Lastklasse: einzelne Store-Tests scheiterten unter paralleler Last mit `database is locked (code: 5)` bzw. `pool timed out` — `store::continuous::tests::stale_fence_cannot_complete_claim_and_expiry_does_not_reclaim` (Linux, Run 35288206709 auf `main` @ `4e409d9`, 17.09.) und `workers::tests::an_agent_that_exits_during_respawn_is_not_revived_as_running` (Linux, Run 35025975338, 15.09.) | niedrig (bearbeitet, beobachten) | Aus `STAND.md` übernommen 2026-09-24. **Bearbeitet** mit W1-25 (PR #77: Transaktionen schließen, Pool-Frist) und W1-25b (PR #85: Store-Schreiber gegen fremde Schreiber). Nicht reproduziert ist der ursprüngliche Drop-Wettlauf (`.pa/report_w1-25.md`, „Nicht abgedeckt"). Der frühere `delivery_recovery`-Fall ist mit W1-04 (PR #55, 20/20 unter Last) abgenommen. Tritt einer der Tests wieder auf, ist das ein neuer Befund mit Run-ID, kein „Flake". **Nachgeführt 2026-10-02 (KI-OBS): tritt wieder auf, offen.** Suche über 301 abgeschlossene CI-Läufe vom 25.09. bis 02.10. (50 rot, alle per `gh run view --log-failed` auf `database is locked` / `pool timed out` und die Testnamen geprüft): die beiden in diesem Eintrag genannten Tests scheiterten nicht erneut, aber die Lastklasse trat zweimal auf der Windows-Bahn von `main` auf, mit anderen Tests: Run 36165944208 (25.09., `main` @ `a18dcd6`; `api::tests::review_route_maps_store_refusals_and_replays_at_the_seam` und `review_route_takes_the_reviewer_run_from_the_credential_not_the_body`, `api.rs:4775`: „failed to reopen migrated database … (code: 5) database is locked“, in beiden Versuchen) und Run 36215024767 (26.09., `main` @ `da20f22`; `store::development_launches::tests::schema15_upgrade_keeps_old_launch_identity_without_inventing_baseline`, `development_launches.rs:705`: „failed to open …projecta.db … (code: 5) database is locked“, in beiden Versuchen). Beide Stellen öffnen eine Test-DB erneut, die kurz vorher geschlossen wurde; das sieht nach dem Windows-Dateisperr-Fenster aus, ist aber nicht gemessen. Neuer Befund mit Run-ID, wie oben vorgesehen; Paketkandidat für die Store-Lane. **Nachgeführt 2026-10-14: dritter Beleg, Fix auf `claude/ki-24-reopen-busy`.** Merge-Queue-Run 38621267673 (`main` @ `3b07a29`, Windows): `store::team_assignments::tests::assignment_races_and_journal_failures_preserve_revision`, `team_assignments.rs:191`, wieder „failed to reopen migrated database … (code: 5) database is locked“ (Testdauer 10,9 s, also länger als die 5-s-Busy-Frist). Auf Linux nicht reproduzierbar (480 `Store::open` auf frischen Datenbanken, 16 parallel: 0 Fehler); die Ursache auf Windows bleibt **Hypothese** (Sperre nach `pool.close()` vom Betriebssystem verzögert freigegeben, sqlx 0.8.6 setzt die Busy-Frist vor den Pragmas, aber manche SQLite-Sperren werden nie abgewartet). Fix: `store/connect_retry.rs` wiederholt den Pool-Verbindungsaufbau in `Store::open` (erster Aufbau und Wiedereröffnung) bis zu 3-mal mit 250/500 ms Pause, **nur** bei SQLITE_BUSY; alle Fehlertexte bleiben. Belegt ist die Wiederholung (Test `open_waits_out_a_lock_that_outlasts_the_busy_timeout`: rot auf der Basis, grün danach), nicht die Windows-Ursache; ob der Flake verschwindet, zeigt erst die Merge-Queue. Bleibt offen/beobachten. **Nachgeführt 2026-10-15: zwei weitere Windows-Belege, beide ein Läufer-Stillstand, kein bewiesener Code-Fehler; kein Fix.** (a) `main`-Run 38645317206, Versuch 1 (`main` @ `587cf97`): `store::development_launches::tests::schema15_upgrade_keeps_old_launch_identity_without_inventing_baseline` endete als nextest-TIMEOUT nach 130 s. Das Testprotokoll zeigt aber „test result: ok. 1 passed … finished in 119.05s“: der Test **bestand**, er überschritt nur die 2×60-s-Frist, und „failed to remove test temp directory … (os error 32)“ ist die Folge des Abschusses bei offenem Pool, keine Sperre. Im Versuch 2 liefen dieselben vier Tests in 1,3–2,4 s; im Versuch 1 brauchten vier Datenbank-Tests gleichzeitig 84–119 s (Gesamtlauf 453 s statt 167 s). (b) Merge-Queue-Run 38626890781 (PR-Kopf `54d09dc`): `workers::tests::a_respawn_injects_the_playbook_the_project_has_now` scheiterte nach 40 s mit „failed to insert message: … (code: 5) database is locked“ (`insert_message` ist ein einzelnes `INSERT` ohne Transaktion, also keine lesen-dann-schreiben-Falle; `log_message` startet mehrere solche Schreiber gleichzeitig); derselbe Test braucht im grünen Lauf 4 s, andere `workers`-Tests dauerten im selben Fenster 12–49 s statt unter 4 s (Gesamtlauf 357 s). Gemeinsame Lesart (Hypothese, nicht gemessen): ein Stillstand des Windows-Läufers (Dateisystem/Virenscanner) dehnt jeden `synchronous=FULL`-Commit auf Sekunden, wartende Schreiber überschreiten die 5-s-Busy-Frist. Nicht reproduziert auf Linux: 160 Läufe von (b) mit 24 parallelen Prozessen und sechs `fsync`-Schreibern daneben, 0 Fehler; ein Pool-Verbindungsaufbau während ein fremder Schreiber hält, wartet korrekt (833 ms bei 800 ms Haltezeit). Ein deterministisch roter Test ist für beide Fälle nicht möglich, ein Fix ohne ihn wird nicht ausgeliefert. Offen: auf der Windows-Bahn messen (Zeit je `Store::open`/Commit im Stillstandsfenster), bevor die Busy-Frist oder die Wiederholung angefasst werden. **Stand 2026-10-15:** Der Wiederholungs-Fix `store/connect_retry.rs` ist mit PR #1463 gemergt (2026-10-14T20:59:21Z); der Eintrag bleibt offen/beobachten, weil die zwei Läufer-Stillstand-Belege von 2026-10-15 ohne Fix stehen. |
| KI-28 | Der Capture-Host (`bin/pa-capture-host.rs`) läuft nur unter Windows | — (dokumentierte Grenze) | Entscheidung 16.09. (W3-05, `docs/decisions.md`; `pa-capture-host.rs:157`, Zweig `#[cfg(not(windows))]`). Aus `STAND.md` übernommen 2026-09-24. Die frühere Einschränkung „acht native Tests laufen in CI nie" gilt nicht mehr: W3-06 (PR #75) fährt sie im Gate `native-tests` der Windows-Bahn. Linux-CI prüft nur die Kompilation. |
| KI-29 | F-SEC-4, Restrisiko des OmniRoute-Schlüssel-Syncs: wer den Opt-in einschaltet, schickt die Vault-Schlüssel an den Listener auf dem OmniRoute-Port, ohne dessen Identität zu prüfen | niedrig (bewusst in Kauf genommen) | Default ist seit W1-24 (PR #62) „kein Push"; W1-24b (PR #98) hat daraus ein ausdrückliches Opt-in-Setting gemacht, das im UI das Restrisiko benennt (`.pa/report_w1-24b.md`, „Hinweise und Folgearbeiten"). Eine Listener-Identität gibt es nicht: `/api/version` bräche Builds, die es weglassen, und ein Management-Token als Bearer gäbe es einem Horcher mit (PLAN, frühere Entscheidung Nr. 13). Solange der Sync aus bleibt, besteht kein Risiko. Paket W1-24c. |
| KI-31 | In-App-Update aus einem main-Build blockiert den nächsten Start (`update-recovery.json`, `IdentityMismatch`) | hoch (Release-Blocker R-1; Journal-Pfad behoben, siehe Stand) | Nach einem echten Update vergleicht die Startprüfung den Hash der laufenden exe mit dem Hash des Update-Pakets und den Datenbank-Snapshot-Hash mit der Live-Datenbank; beides passt nach dem Update nicht mehr, die App startet nicht. Befund aus PR #457 und Berater Fable 5.1 (05.10.). **Hinweis 2026-10-14:** „Release-Blocker R-1“ bezog sich auf v1.5.0; v1.5.0 bis v1.6.3 sind seither veröffentlicht (`gh release list`), die Bezeichnung ist also historisch. Der Rest unten ist unverändert offen und nicht neu geprüft. **Workaround:** kein In-App-Update aus main-Builds vor W3-02j; die Datei `update-recovery.json` im App-Datenordner zu entfernen löst den Block. **Stand 2026-10-05:** für Updates, die über den Journal-Pfad installiert werden, behoben durch W3-02j (PR #462, Trust-on-first-run-Handshake: die Startprüfung übernimmt exe- und Datenbank-Identität als Erbe des Journals). **Offen:** ein echter Lauf „Update installieren und neu starten“ auf dem Windows-PC ist nicht belegt; Updates, die nicht über den Journal-Pfad installiert wurden, deckt der Fix nicht ab. Der Workaround gilt bis dahin für diese Fälle. |

### KI-24: Windows-Wiederauftreten und erfolgreicher Wiederanlauf (22.10.2026)

Neuer Befund, weiter **offen/beobachten**, Ursache unbewiesen: [Run 39754937862,
Windows-1-Job 119744455069](https://github.com/Cuarroc/ProjectA/actions/runs/39754937862/job/119744455069)
in Queue #1826 für #1825, Basis `3bdfa0817615aeee7b10112f8bdc110627ce292b`,
Queue-Kopf `8cc33f5811713dd7717a0b6d75dcedced1dd3c33`.
Einziger fehlgeschlagener Test: `store::continuous::tests::goal_task_audit_uses_one_connection`,
`src-tauri/src/store/continuous.rs:1454:10`, Fehler
`audit must not acquire a second pooled connection while holding the writer: Elapsed(())`;
danach scheiterte die Entfernung des eigenen temporären Verzeichnisses mit `os error 32`.
nextest: 13.674 s, inneres Testprotokoll: 12.76 s; Windows-1-Batch: 455.475 s,
1183 ausgeführt, 1182 bestanden, 1 fehlgeschlagen, 1200 übersprungen.
Der zusätzliche rote Sammeljob `gates (windows)` (119750089057) ist kein zweiter Testfehler.

**PASSED ON REQUEUE:** [Run 39758048587, Windows-1-Job 119754964410](https://github.com/Cuarroc/ProjectA/actions/runs/39758048587/job/119754964410),
Queue #1827, Kopf `8948bac08386746415807d42455b3c3c27542b9e`: derselbe Test
bestand um 09:51:52Z in 1.508 s; Zusammenfassung 09:54:15Z: 1183/1183 bestanden,
1200 übersprungen, Batch 200.864 s. Windows-1, Windows-2, native Windows-Tests,
Sammeljob `gates (windows)` und der gesamte CI-Lauf endeten erfolgreich.
Der eigenständige Requeue-Kommentar [6337774341](https://github.com/Cuarroc/ProjectA/pull/1825#issuecomment-6337774341)
kam um 09:46:30Z, Queue #1827 entstand um 09:46:45Z; #1825 wurde um 09:59:50Z
als `0fa721bd133ff15ec57de84d8e52ebc939596bdd` gemergt. Keine verbleibende Merge-Sperre für #1825.
Quellen: vorhandene GitHub-Läufe und Jobprotokolle, am 22.10. per `gh run view`
und `gh pr view` erneut gelesen (Exit 0); keine neue lokale Windows-Messung.
Ein Fehlschlag mit anschließendem PASS beweist weder einen harmlosen Flake noch
Ursache, Fix oder Abschluss von KI-24. Weiter auf Windows messen, bevor Fristen
oder Wiederholungen geändert werden; kein Produktfix-Paket aus diesem Nachtrag.

### Offener CI-Befund: selftest-win-signal ohne Timeout-Schlusszeile (22.10.2026)

Weiter **offen**, Stufe niedrig, nur Prüfung: [Run 39834041335,
Linux-1-Job 120017507651](https://github.com/Cuarroc/ProjectA/actions/runs/39834041335/job/120017507651)
scheiterte in Queue #1847 für #1835 (`fc1d4662`) auf Basis `fa4f2d9a`,
Queue-Kopf `84f8d345421c338748a7261a68406f62b6d3e5f4`, am Gate
`selftest-win-signal` mit `never-finishing-run-times-out-with-3 (rc=3)`.
Jobfehler und Quellprädikat wurden von der Koordination unabhängig gelesen;
laut Roots Prüfung des Rohprotokolls stimmte der erwartete Exit-Code 3,
aber die exakte stdout-Zeile `conclusion=timeout` fehlte. Diese Rohbeobachtung
stammt von Root; `gh` verweigerte die Ausgabe wegen roher Terminal-Steuerzeichen.
`scripts/test-win-signal.sh` prüft beide Bedingungen und verwendet für diesen
Poll eine Sekunde Zeitlimit ohne Wartepause (`WIN_SIGNAL_SLEEP=0`). Ein
Timing-Wettlauf oder Flake ist eine Hypothese, keine bewiesene Ursache oder
Entwarnung; Timeout, Wiederholungen und Assertion bleiben unverändert.

Der erfolgreiche [main-Lauf 39832698357](https://github.com/Cuarroc/ProjectA/actions/runs/39832698357)
auf `fa4f2d9a` traf in `linux_1` nur die Auswahlentscheidung; die eigentlichen
Gates waren `SKIPPED`. Er belegt keinen erfolgreichen Lauf dieses Selbsttests.
Root reihte über Queue #1848 erneut ein; #1835 wurde am 22.10. um 19:07:35Z
als `5a07fc0895ff6bb813df265fa9d730d38d1b1ed9` gemergt. Der Merge allein
beweist weder einen PASS dieses Selbsttests noch Ursache oder Fix; hier wird
kein solcher PASS behauptet. Run-/Jobstatus, Auswahl und Merge wurden per
`gh run view` und `gh pr view` am 22.10. erneut gelesen (Exit 0).
Folgeauftrag `d2d1a8a8-0882-435e-902b-c3cad4e695fb` bleibt offen, niedrig,
nur Prüfung; kein Fix in TASK/ASSIGN. Dieser Eintrag dokumentiert den CI-Befund;
die bestehenden R908-Testzeitfenster sind damit nicht als neuer Fehler belegt.

### Offener Testbefund: DiffView-Fokus und Tabstop (28.10.2026)

Weiter **offen**, Stufe niedrig (Prüfbefund, Quellarbeit geparkt).
In `src/components/DiffView.lines.public.test.tsx:60:54` wurde nach
bestandener Fokusprüfung an Zeile 59 der Tabstop für Kommentarzeile 2
erwartet, aber Kommentarzeile 1 empfangen. Das ist ein intermittierend
beobachteter Testfehler; deterministische Ursache, Produktionsfehler im
Browser und eine tatsächliche Korrektur sind unbekannt. Ein späterer PASS
beweist weder einen harmlosen Flake noch Ursache oder Behebung; entsprechend
der bestehenden KI-24-Semantik bleibt jedes Wiederauftreten ein eigener Befund.

**Erster Rotbeleg:** [CI 40747970777, Versuch 1, Job 123026724940](https://github.com/Cuarroc/ProjectA/actions/runs/40747970777/job/123026724940),
Kopf `87b6d4bdd7dd63a547fec1cd8ad2f5ed4d18fd02`, am 28.10.2026
18:49:10Z: genau diese Assertion scheiterte; Fokus an Zeile 59 bestand.
Der vorhandene grüne Versuch 2 hebt Versuch 1 nicht auf.

**Zweiter Rotbeleg:** einmalige freigegebene Diagnose am 28.10.2026
20:17:51–20:17:53Z mit
`npm run test:unit -- src/components/DiffView.lines.public.test.tsx -t "names diff lines while preserving literal hunks navigation drafts and empty files"`:
kompiliert, genau 1 Test ausgewählt, Exit 1, gleicher Befund.
Basis `1ebdf490cde6b47121b4a2bb5fb7ad658963f727` und tatsächlicher
Diagnose-Arbeitsbaumkopf `610654eceda7569a4396423518263b5f853d5ea0`
hatten denselben vollständigen Git-Baum
`1815231ec78e4c713031049de2ecb567837708be`; 1.884 Dateien und Index
blieben unverändert. Diagnoseprotokoll-SHA256:
`3f69ed13643036497c721fca117570a08edbc49a4477e9419aaedf060ad3fa4f`.
Diese Einzelbeobachtung bestimmt weder Häufigkeit noch Ursache.

**Dritter Rotbeleg:** erster normaler Push-Hook am später öffentlichen
P1-Kopf `d9263f13a946f1b4c10b53ea0adba2c91eb7729b`: `fe-test`
Exit 1, 1 von 1.861 Tests fehlgeschlagen, dieselbe Assertion.
Die vorherige manuelle prepush-Bahn am gleichen Baum bestand (Exit 0, 279 s).
Die abnehmende Projektkoordination erlaubte genau einen unveränderten
normalen Push erneut; dessen echter Hook bestand (Versuch 2, Exit 0;
Protokollkennung `normal-push.log`). Spätere CI am Kopf war grün;
[PR #2013](https://github.com/Cuarroc/ProjectA/pull/2013) wurde als
`75f65f52cf7a409b0d9f45fd4aed15222ae0216f` gemergt.
Das erste lokale Hook-Protokoll hat in den übernommenen Belegen keine
separate Run-/Job-ID oder genaue Uhrzeit; hier werden keine ergänzt.

**Quellarbeit geparkt:** Versuch 1 auf Basis `1ebdf490` führte den
ursprünglichen Selektor einmal aus: 1 Test, Exit 0, 1,59 s, keine act-Warnung;
eigener Rotnachweis fehlte, deshalb Stopp ohne Fix. Versuch 2 ergänzte den
55-zeiligen öffentlichen Kandidaten
`keeps one matching tabstop after committed focus navigation and selected path changes`:
einmal ausgewählt, 1 Test, Exit 0, 1,21 s. Er schließt anfänglichen Fokus
in act ab und wechselt den ausgewählten Pfad; der ursprüngliche Test blieb
unverändert und war nur durch den Namensselektor nicht ausgewählt.
Der Kandidat deckt allein das ursprüngliche ungekapselte Fokus-Timing nicht
ab und löste weder H1 noch H2 rot aus. Keine Korrektur, kein dritter Versuch.
Die abnehmende Projektkoordination parkte nach beiden erfolglosen Rotnachweisen.

Der unveränderte WIP liegt auf
[`codex/flk-diffview-lines-fix-1` @ `f577fa994925ca6c8c369c52fa8ff1ed45a9a7a0`](https://github.com/Cuarroc/ProjectA/commit/f577fa994925ca6c8c369c52fa8ff1ed45a9a7a0):
56 RAW (55 Testzeilen und 1 geparkte Planzeile),
`No-Test: parked WIP candidate, not red`, normale Hooks Exit 0.
Das ist gesicherter Beleg ohne PR, ohne red-first-Nachweis und ohne
gemergte Produktionskorrektur. H1 (ausstehendes direktes Fokus-/Commit-Ordering)
und H2 (Reset beim Pfadwechsel) bleiben Hypothesen. Wiederaufnahme nur durch
einen neuen Zuschnitt der abnehmenden Projektkoordination mit neuer konkreter
Hypothese und Beleg, etwa CI-ROT samt Trace oder separat freigegebener,
begrenzter Messung zur Eingrenzung des Auslösers. Kein neuer Probe-,
Benchmark- oder Laufzeitauftrag aus diesem Eintrag; ein echter Quellfix braucht
deterministisches red-first und Stufe B mit zwei zulässigen Nicht-Autor-Familien.

**Bestehende betriebliche Ausnahme der abnehmenden Projektkoordination:**
Nur wenn ausschließlich die bekannte `DiffView.lines:60`-Assertion in CI
oder einem **Push-Hook** scheitert **und** das Kandidaten-Delta keinerlei
DiffView-Dateien berührt, ist **eine** dokumentierte Wiederholung mit den
normalen echten Gates erlaubt. Jedes Auftreten erhält Run, Job, Protokoll,
Kopf und Versuch; lokale Kennungen und ausdrücklich „nicht anwendbar“ ersetzen
bei Hooks die nicht vorhandenen CI-IDs. CI-Wiederholungen auf Autor-PRs bleiben
ausschließlich Sache der abnehmenden Projektkoordination. Keine allgemeine
Wiederholung manueller prepush-Läufe, keine Schleife, kein Skip, keine
Timeout-/Assertion-Änderung und kein Bypass. Ein PASS beweist weder Ursache
noch Fix. Solange die offizielle main-CI grün ist, folgt aus diesem Befund
kein Queue-Stopp; bei roter offizieller main-CI gilt unverändert AGENTS-Regel 8.
Dieser Text hält eine bestehende Disposition fest und führt keinen Retry ein.

## Behoben

Historische Befunde samt vollständigen Belegen stehen im
[Archiv der behobenen Befunde](docs/archive/issues-2026-10/resolved.md#behoben).
Die Nummern bleiben als Wegweiser erhalten: KI-15, KI-16, KI-35, KI-34, KI-33, KI-32, KI-20, KI-19, B-2, KI-3, KI-6, KI-8, KI-13, KI-17, KI-18, KI-23, KI-2, KI-12, KI-30, KI-21, KI-22, KI-25, KI-26, KI-27.

Eintrag ohne Nummer (—): [16 rote Tests der Nacht-Branches](docs/archive/issues-2026-10/resolved.md#behoben).

KI-14: Rest offen unten; volle Historie im [Archiv](docs/archive/issues-2026-10/resolved.md#behoben).

| # | Befund | Behoben | Beleg |
|---|---|---|---|
| KI-14 | Poisoned-Mutex-Stillverwerfer (`.lock().ok()?` ohne Log) an rund 20 Stellen | 2026-09-23, W1-15 (PR #76, `84b869b`) und W1-15b (PR #87, `a889f51`): loggen statt schlucken. Am 24.09. findet `grep -rn '.lock().ok()?' src-tauri/src` nur noch eine Stelle: `api/agent_access.rs:266`, später hinzugekommener Code | `.pa/report_w1-15.md`, `.pa/report_w1-15b.md`. **Nachgeführt 2026-09-24 (W1-15c, Branch `claude/w1-15c-pty-mutex`):** `pty.rs` (Setter, Reader-Hook, Trace, Submit-Guard) übernimmt vergiftete Locks über `recover()` und loggt einmal; `api/agent_access.rs` räumt unter Poison ab (`revoke_all`, Rollback in `issue_run_descriptor_file`) und bleibt beim Nachschlagen (`lookup`) fail-closed, jetzt mit Log. Regressionen: sechs `poisoned`-Tests in `pty::tests` und `api::agent_access::tests` (rot → grün). **KI-14-Rest, geprüft 2026-10-02:** `grep -rnF '.lock().ok()?' src-tauri/src` und die zeilenübergreifende Suche finden keine Stelle; der historische Fund in `api/agent_access.rs` ist bereits durch W1-15c mit Logging und Poison-Test behoben. **W1-15d-a, 2026-10-03:** `budget.rs` übernimmt den vergifteten Lesestand und schreibt `last_stop_observation` weiter; `queue.rs` übernimmt den vergifteten `PreflightCache` und serialisiert Lesen/Aktualisieren eines Verdicts. Beide Pfade loggen die erste Wiederherstellung und sind durch rote Poison-Regressionen belegt. **Offener Rest:** `store/native_completion.rs:12` (`ClosingBinding::drop`) → Folgepaket **W1-15d-b** |

### KI-12: Abgleich vom 2026-10-02

[Vollständiger datierter Befund im Archiv](docs/archive/issues-2026-10/resolved.md#ki-12-abgleich-vom-2026-10-02).

### KI-30: `real_native_*`-Flake auf der Windows-Bahn (geschlossen 2026-10-09)

[Vollständiger datierter Befund im Archiv](docs/archive/issues-2026-10/resolved.md#ki-30-real_native_-flake-auf-der-windows-bahn-geschlossen-2026-10-09).
