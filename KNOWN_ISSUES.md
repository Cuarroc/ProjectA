# Known Issues — v1.4.1

Bewusst offen gelassene Befunde. Quelle ist die Batch-D-Neuprüfung gegen den
Post-U2/Q2-Stand (Re-Triage-Bericht, 2026-08-28; Einstufungen von dort) plus
Betriebsbefunde aus der Konsolidierung; nachgeführt 2026-09-15 auf Stand
v1.4.0 und 2026-09-24 auf Stand v1.4.1 (Release 22.09., `gh release list`); die
Beobachtungs-KIs (KI-7, 21, 22, 24 bis 27) am 2026-10-02 (KI-OBS).
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

KI-9 bis KI-12 kommen aus dem Abhängigkeits-Audit vom 2026-08-29
(`cargo audit` 0.22.2 gegen advisory-db `6420e39`, `npm audit` mit und ohne
dev-Deps). Der Bericht von damals ist **nicht mehr erreichbar**. Ergebnis dort:
**0 Vulnerabilities**, 17 Warnungen, von denen 11 im Windows-Build gar nicht
vorkommen — die Einstufung „nur Linux" heißt genau das und ist per
`cargo tree --target x86_64-pc-windows-msvc` belegt, nicht vermutet.

## Offen

| # | Befund | Stufe | Warum offen |
|---|---|---|---|
| KI-1 | Rollen-Approve im `LearningsPanel`: der Prompt-Zusatz ist nicht editierbar | niedrig | **Teilweise behoben 2026-09-23 (W1-09, PR #78) und 2026-09-24 (W1-09b, PR #99):** `roles.rs::parse_distilled` deckelt `system_prompt` jetzt (`roles.rs:59`), und das Panel zeigt den Zusatz vor dem Verdict an. Offen ist nur „nicht editierbar": dafür braucht es einen Setter im Store, ein Command und ein Feld im Frontend, also drei Lanes. Paket **W1-09c** (`docs/PLAN.md`, geparkt bis nach M4). Ein Mensch löst das Approve aus, und der Marker-Schutz (`forbidden_marker`) greift. |
| KI-5 | Die Token-Sektion des Statistik-Tabs ist flottenweit, nicht pro Projekt | — (dokumentierte Grenze) | `usage_events` hat keine Projektdimension: OmniRoutes Log kennt weder Session noch Client, und `X-OmniRoute-Session-Id` ist nicht clientseitig setzbar. Steht im Tab, im README und im Code-Kommentar (`omniroute::attribute`). |
| KI-7 | Die `#[cfg(unix)]`-Tests aus Phase-16-Batch C (Dateirechte, Prozessgruppen-Kill) kompilieren auf der Windows-Entwicklungsmaschine nicht mit; sie brauchen eine Linux-Umgebung | — (Betrieb) | **Neu bewertet 2026-09-17 (W1-06):** Heimat dieser Tests ist der CI-Job `gates (linux)` (`.github/workflows/ci.yml`, nextest über die ganze Suite) oder WSL2 auf dem Entwicklungsrechner. Beide Plattformen werden weiter gegatet (Linux in CI, Windows in CI und lokal); eine Maschine, die beides nativ prüft, existiert nicht. Die 0600-Modus-Tests sind seit 2026-10-03 nachgezogen, siehe KI-19 (Behoben). **Nachgeführt 2026-10-02 (KI-OBS):** Die Linux-Hälfte läuft jetzt zusätzlich auf einem eigenen Linux-Server neben CI; die Windows-Hälfte (`#[cfg(windows)]`) bleibt auf der Windows-Bahn bzw. in der Merge-Queue. |
| KI-9 | `glib` 0.18.5, Unsoundness in den `Iterator`/`DoubleEndedIterator`-Impls von `glib::VariantStrIter` ([RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)) | mittel — nur Linux | **Stand 2026-10-09:** weiterhin aktive informative Warnung `unsound`, nicht zurückgezogen. Im geprüften Build-Graphen nur unter `x86_64-unknown-linux-gnu`, nicht unter `x86_64-pc-windows-msvc` vorhanden. Upstream behoben ab `glib >= 0.20`; kein semver-kompatibles Update für `^0.18`. Die Behebung benötigt eine abgestimmte Aktualisierung des Tauri/tao/wry/GTK-Abhängigkeitsasts; GTK4 ist dafür keine belegte Voraussetzung. Quelle: Audit `ki-audit-9-10-a1d9a5fba38d.md` vom 2026-10-09, RustSec-DB `550efd3d`; `cargo audit` und zielbezogene `cargo tree --locked --offline`-Abfragen. |
| KI-10 | `proc-macro-error` 1.0.4 ([RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html)) ist weiterhin *unmaintained* | niedrig — nur Linux | **Stand 2026-10-09:** aktive informative Warnung, `patched: []`; im geprüften Linux-Build-Graphen über `glib-macros` und `gtk3-macros` vorhanden, im Windows-Graphen (`x86_64-pc-windows-msvc`) nicht. Kein kompatibles Update behebt sie. Bewusst *nicht* per `cargo audit --ignore` stummgeschaltet, damit der Tag auffällt, an dem eine davon zur echten Vulnerability wird. Die zehn GTK3-Advisories RUSTSEC-2024-0411…0420 wurden am **2026-08-14 zurückgezogen** (`withdrawn`, Pflege wieder aufgenommen) und gehören nicht mehr zu den offenen Warnungen; die Kisten bleiben im `Cargo.lock`. Quelle: Audit `ki-audit-9-10-a1d9a5fba38d.md` vom 2026-10-09, RustSec-DB `550efd3d`; `cargo audit` und zielbezogene `cargo tree --locked --offline`-Abfragen. |
| KI-24 | SQLite-Lastklasse: einzelne Store-Tests scheiterten unter paralleler Last mit `database is locked (code: 5)` bzw. `pool timed out` — `store::continuous::tests::stale_fence_cannot_complete_claim_and_expiry_does_not_reclaim` (Linux, Run 35288206709 auf `main` @ `4e409d9`, 17.09.) und `workers::tests::an_agent_that_exits_during_respawn_is_not_revived_as_running` (Linux, Run 35025975338, 15.09.) | niedrig (bearbeitet, beobachten) | Aus `STAND.md` übernommen 2026-09-24. **Bearbeitet** mit W1-25 (PR #77: Transaktionen schließen, Pool-Frist) und W1-25b (PR #85: Store-Schreiber gegen fremde Schreiber). Nicht reproduziert ist der ursprüngliche Drop-Wettlauf (`.pa/report_w1-25.md`, „Nicht abgedeckt"). Der frühere `delivery_recovery`-Fall ist mit W1-04 (PR #55, 20/20 unter Last) abgenommen. Tritt einer der Tests wieder auf, ist das ein neuer Befund mit Run-ID, kein „Flake". **Nachgeführt 2026-10-02 (KI-OBS): tritt wieder auf, offen.** Suche über 301 abgeschlossene CI-Läufe vom 25.09. bis 02.10. (50 rot, alle per `gh run view --log-failed` auf `database is locked` / `pool timed out` und die Testnamen geprüft): die beiden in diesem Eintrag genannten Tests scheiterten nicht erneut, aber die Lastklasse trat zweimal auf der Windows-Bahn von `main` auf, mit anderen Tests: Run 36165944208 (25.09., `main` @ `a18dcd6`; `api::tests::review_route_maps_store_refusals_and_replays_at_the_seam` und `review_route_takes_the_reviewer_run_from_the_credential_not_the_body`, `api.rs:4775`: „failed to reopen migrated database … (code: 5) database is locked“, in beiden Versuchen) und Run 36215024767 (26.09., `main` @ `da20f22`; `store::development_launches::tests::schema15_upgrade_keeps_old_launch_identity_without_inventing_baseline`, `development_launches.rs:705`: „failed to open …projecta.db … (code: 5) database is locked“, in beiden Versuchen). Beide Stellen öffnen eine Test-DB erneut, die kurz vorher geschlossen wurde; das sieht nach dem Windows-Dateisperr-Fenster aus, ist aber nicht gemessen. Neuer Befund mit Run-ID, wie oben vorgesehen; Paketkandidat für die Store-Lane. |
| KI-28 | Der Capture-Host (`bin/pa-capture-host.rs`) läuft nur unter Windows | — (dokumentierte Grenze) | Entscheidung 16.09. (W3-05, `docs/decisions.md`; `pa-capture-host.rs:142`). Aus `STAND.md` übernommen 2026-09-24. Die frühere Einschränkung „acht native Tests laufen in CI nie" gilt nicht mehr: W3-06 (PR #75) fährt sie im Gate `native-tests` der Windows-Bahn. Linux-CI prüft nur die Kompilation. |
| KI-29 | F-SEC-4, Restrisiko des OmniRoute-Schlüssel-Syncs: wer den Opt-in einschaltet, schickt die Vault-Schlüssel an den Listener auf dem OmniRoute-Port, ohne dessen Identität zu prüfen | niedrig (bewusst in Kauf genommen) | Default ist seit W1-24 (PR #62) „kein Push"; W1-24b (PR #98) hat daraus ein ausdrückliches Opt-in-Setting gemacht, das im UI das Restrisiko benennt (`.pa/report_w1-24b.md`, „Hinweise und Folgearbeiten"). Eine Listener-Identität gibt es nicht: `/api/version` bräche Builds, die es weglassen, und ein Management-Token als Bearer gäbe es einem Horcher mit (PLAN, frühere Entscheidung Nr. 13). Solange der Sync aus bleibt, besteht kein Risiko. Paket W1-24c. |
| KI-30 | Windows-Gate `native-tests`: vier der acht `real_native_*`-Tests scheitern sporadisch in Merge-Queue-Läufen, jedes Mal nach grüner `rust-suite` | mittel (Flake, blockiert die Queue) | Stand 2026-10-05 (V16-01): Ursache für den Early-Exit-Fall belegt und behoben, die serielle Minderung ist entfernt. Offen bleibt der Beleg über die nächsten 40 Queue-Läufe und die Ursache der übrigen drei Tests. Details im Abschnitt „KI-30“ unten. |
| KI-31 | In-App-Update aus einem main-Build blockiert den nächsten Start (`update-recovery.json`, `IdentityMismatch`) | hoch (Release-Blocker R-1; Journal-Pfad behoben, siehe Stand) | Nach einem echten Update vergleicht die Startprüfung den Hash der laufenden exe mit dem Hash des Update-Pakets und den Datenbank-Snapshot-Hash mit der Live-Datenbank; beides passt nach dem Update nicht mehr, die App startet nicht. Befund aus PR #457 und Berater Fable 5.1 (05.10.). **Workaround:** kein In-App-Update aus main-Builds vor W3-02j; die Datei `update-recovery.json` im App-Datenordner zu entfernen löst den Block. **Stand 2026-10-05:** für Updates, die über den Journal-Pfad installiert werden, behoben durch W3-02j (PR #462, Trust-on-first-run-Handshake: die Startprüfung übernimmt exe- und Datenbank-Identität als Erbe des Journals). **Offen:** ein echter Lauf „Update installieren und neu starten“ auf dem Windows-PC ist nicht belegt; Updates, die nicht über den Journal-Pfad installiert wurden, deckt der Fix nicht ab. Der Workaround gilt bis dahin für diese Fälle. |

## Behoben

Nummern bleiben hier stehen, damit ältere Verweise (Reports, `TRIAGE.md`) ein
Ziel haben.

| # | Befund | Behoben | Beleg |
|---|---|---|---|
| KI-15 | Prompts standen im argv des Agentenprozesses (`workers.rs::with_system_prompt`, Zweig `SystemPrompt::Arg`) | 2026-10-03, PR #116 (Merge `c3de8410ff4e4335fc24a5149d0ecbc5bb515928`) | Claude nutzt das von `claude --help` dokumentierte `--append-system-prompt-file`, Kimi bereits `--agent-file`, und Codex verweist über `--config model_instructions_file=…` auf die private Prompt-Datei (Konfigurationsschlüssel laut offizieller Codex-Referenz). Regressionstests prüfen für Claude und Codex, dass der Koordinatorprompt nicht im argv steht und unverändert aus der Worker-Datei gelesen wird. `opencode --help` (1.18.34) zeigt keinen Systemprompt-Dateikanal und bleibt `unsupported`. Die Ollama-CLI war auf der Prüfmaschine nicht installiert, daher bleibt auch dieses Profil vorsichtig `unsupported`, ohne eine unbelegte Fähigkeit zu behaupten. Das Hook-Secret ist seit `933dfcd` über eine private `--config`-Datei geschützt. |
| KI-16 | `PtyManager::spawn` lief synchron auf der Tokio-Runtime (openpty plus Prozesserzeugung) | Linux: PR #141 (Merge `376f75f55406d813732dc8a638c5a94d06e90e02`, 2026-10-03) und PR #438 (Merge `cd7ec3207e84b3cafd7947d92ae691701aa24a0e`, 2026-10-05) | `spawn_with_id` (und damit `spawn`) gibt den Runtime-Worker per `block_in_place` frei, sobald es auf einer Multi-Thread-Tokio-Runtime läuft (`off_runtime_thread`, `pty.rs`); ohne diese Runtime bleibt die Arbeit inline. Wächter: `pty::tests::blocking_spawn_work_leaves_the_runtime_worker_free`. Seit #438 ist der Tauri-Befehl `spawn_pty` (`main.rs`) `async` und ruft `PtyManager::spawn` auf diesem Runtime-Worker auf. Ein eigener Test für `spawn_pty` fehlt; die Windows-Bahn (ConPTY) ist hier nicht gelaufen. |
| KI-33 | Windows-Gate: `retention::tests::deletion_runs_in_chunks_until_the_table_is_clean` überschritt das nextest-Limit (TIMEOUT nach 120 s) | PR #543 (Merge `04ea1a4313649d8882b70e0bd11643e7ee0ac525`, 2026-10-05); Windows-Queue-Beleg am 2026-10-08 | Der Test fügt seine 1200 Zeilen jetzt in einer Transaktion ein; Zeilenzahl und Assertions bleiben gleich. Zuvor Timeouts in den Läufen 37343111847 und 37327651607. Queue-Lauf **37767556830**, Kopf `729393d684f1fa94b00439ccfd5af80233a466f0` (enthält #543), Job `gates (windows)` **success**: Test **PASS [1.812s]**. Beleg: `gh run view 37767556830 --job 113278804180 --log`; keine Aussage über langfristige Flake-Freiheit aus diesem einzelnen Lauf. |
| KI-32 | `main-red-guard` auf `main` rot, obwohl Linux und Windows grün waren (Lauf 37156370787, Kopf `dfe459f`) | 2026-10-04, kein Codefehler: der Schritt „red main -> issue + queue freeze“ bekam von GitHub bei `gh issue list` ein `503 Service Unavailable` mit leerem JSON (`SyntaxError: Unexpected end of JSON input`, Exit 1); `gates (linux)` und `gates (windows)` desselben Laufs waren `success`. | `gh run view 37156370787 --attempt 1 --log-failed` zeigt den 503; Versuch 2 desselben Laufs (nur der fehlgeschlagene Job neu gestartet) ist `success` auf demselben SHA `dfe459f`. Kein Code und keine Gate-Logik geändert. |
| KI-20 | Doppelte Antwort auf die Cursor-Abfrage `ESC[6n`: der Reader-Thread antwortete mit `ESC[1;1R`, und xterm.js antwortete beim Scrollback-Replay ein zweites Mal | 2026-10-03, W1-27, PR #140 (Merge `56266cce31a905b6f3e946e774bfd3ad1ccd3044`; Advisor-Entscheidung: nur das Backend antwortet) | `CursorReportScanner::strip` entfernt die beantwortete Anfrage aus Scrollback und UI; Test `a_cursor_position_query_never_reaches_the_terminal_view`; `docs/decisions.md` (16.09., Auflösung). Die Antwort bleibt fest `1;1` (Kommentar an `CURSOR_POSITION_REPLY`). Kein Live-Kimi-Re-Smoke (W1-01b blockiert). |
| KI-19 | Unix-Modus-Tests (0600) für Vault und API-Deskriptor fehlten | 2026-10-03, PR #123 (Paket KI-19, Linux-Server): Tests `providers::tests::a_vault_file_is_private_from_the_moment_it_exists` und `a_rewritten_vault_stays_private_and_leaves_no_temp_file`, `api::tests::the_api_descriptor_is_owner_only_even_over_a_stale_loose_file` sowie der Run-Deskriptor-Test (0600, `agent-access/` 0700) laufen grün; die Rechte waren schon richtig, kein Produktivcode geändert | `cargo test --bin projecta` (Filter auf die drei Tests), Exit 0 |
| B-2 | Submit-Guard hielt drei Sekunden Stille für Bereitschaft und schickte Eingaben in eine TUI, die noch nicht zuhörte | 2026-09-01, `6165a53`, released in **v1.2.3** (Echo-Verifikation statt Stille-Schwelle) | `STATUS.md` 2026-09-01 Abend; `.pa/report_nt3.md` |
| — | Die 16 roten Tests der Nacht-Branches `nacht/kern` und `nacht/front-b` | laut `TRIAGE.md`-Kopf (31.08.2026) mit allen 55 roten Beweisen gefixt und auf main (Phase 1 abgeschlossen) | `TRIAGE.md` |
| KI-3 | Ein in der Kommandoleiste (`CommandChat`) getippter Entwurf überlebte den Projektwechsel und ginge bei Enter an den Orchestrator des neuen Projekts | 2026-09-23, W1-09, PR #78 (`b719cd9`): der Entwurf wird beim Projektwechsel verworfen | `src/components/CommandChat.test.tsx`; `.pa/report_w1-09.md` |
| KI-6 | Fehlertexte mit `refused: `-Präfix erreichten die UI wörtlich | 2026-09-23, W1-09, PR #78 (`b719cd9`): `describeError` streift das Präfix ab | `src/lib/ipc.test.ts` („KI-6 strips …"); `.pa/report_w1-09.md` |
| KI-8 | Board-Spinner blieb hängen, wenn ein `refresh()` den Erst-Load überholte | `2a902d8` (PR #32): in `src/lib/useBoard.ts` räumt der letzte stehende Lauf den Spinner auf, wie im Zwilling `useQuestions` | gegen den Code verifiziert 2026-09-15 |
| KI-13 | Claim-Recovery spawnte beim App-Start verwaiste Claims auch bei `max_workers = 0` | 2026-09-23 geprüft (W1-16, PR #82): im heutigen Code nicht erzeugbar; der Stand vom 31.08. ist nach dem History-Squash nicht rekonstruierbar | Wächter `queue::tests::orphaned_claims_stay_ready_after_the_restart_while_the_cap_is_zero`; `.pa/report_w1-16.md`. Beim Prüfen gefunden: KI-23 |
| KI-14 | Poisoned-Mutex-Stillverwerfer (`.lock().ok()?` ohne Log) an rund 20 Stellen | 2026-09-23, W1-15 (PR #76, `84b869b`) und W1-15b (PR #87, `a889f51`): loggen statt schlucken. Am 24.09. findet `grep -rn '.lock().ok()?' src-tauri/src` nur noch eine Stelle: `api/agent_access.rs:266`, später hinzugekommener Code | `.pa/report_w1-15.md`, `.pa/report_w1-15b.md`. **Nachgeführt 2026-09-24 (W1-15c, Branch `claude/w1-15c-pty-mutex`):** `pty.rs` (Setter, Reader-Hook, Trace, Submit-Guard) übernimmt vergiftete Locks über `recover()` und loggt einmal; `api/agent_access.rs` räumt unter Poison ab (`revoke_all`, Rollback in `issue_run_descriptor_file`) und bleibt beim Nachschlagen (`lookup`) fail-closed, jetzt mit Log. Regressionen: sechs `poisoned`-Tests in `pty::tests` und `api::agent_access::tests` (rot → grün). **KI-14-Rest, geprüft 2026-10-02:** `grep -rnF '.lock().ok()?' src-tauri/src` und die zeilenübergreifende Suche finden keine Stelle; der historische Fund in `api/agent_access.rs` ist bereits durch W1-15c mit Logging und Poison-Test behoben. **W1-15d-a, 2026-10-03:** `budget.rs` übernimmt den vergifteten Lesestand und schreibt `last_stop_observation` weiter; `queue.rs` übernimmt den vergifteten `PreflightCache` und serialisiert Lesen/Aktualisieren eines Verdicts. Beide Pfade loggen die erste Wiederherstellung und sind durch rote Poison-Regressionen belegt. **Offener Rest:** `store/native_completion.rs:12` (`ClosingBinding::drop`) → Folgepaket **W1-15d-b** |
| KI-17 | Reaper-Map-Remove bei poisoned Registry (`pty.rs`): Sessions fielen bei Poison nicht aus der Map | 2026-09-23, W1-15b, PR #87 (`pty kill_all` erholt sich vom Poison) | `.pa/report_w1-15b.md`; der `pty.rs`-Rest ist mit W1-15c erledigt (siehe KI-14) |
| KI-18 | Lint-Budget-Verbraucher `DiffView.tsx:53` (`useMemo`-Warnung) | 2026-09-17 als erledigt belegt: `npm run lint` fährt seit PR #29 mit `--max-warnings=0` und ist grün | `.pa/report_w1-06.md` |
| KI-23 | Die Attribution in `release_claimed_queue_entries` griff beim echten Start praktisch nie; ein gestarteter Claim fiel auf `ready` und wurde doppelt gestartet | 2026-09-24, Paket KI-23, PR #94 (`27b4769`): Reattach-Pass und Claim-Freigabe in `main.rs::reattach_workers_and_resolve_claims`, Dispatcher erst nach der Startfreigabe | Regressionen `queue::tests::a_claim_whose_worker_started_stays_with_it_after_the_reattach_pass`, `tests::the_dispatcher_starts_only_after_the_startup_claims_are_resolved` (beide rot → grün); `.pa/report_ki-23.md` |
| KI-2 | `githubRemote` ist in `types.ts` non-optional, `toProject` setzt keinen Default | 2026-10-02, PR #85 (öffentliches Repo) | `toProject` normalisiert ein fehlendes Flag aus älteren Core-Payloads auf `false`; die Regression `src/lib/ipc.test.ts` belegt ein Projekt ohne `githubRemote`. |
| KI-12 | Abgleich `cargo audit`/`npm audit` gegen die Dependabot-Alerts war nicht belegt | 2026-10-02, Paket KI-12: deckungsgleich, Tabelle unten. Dependabot-Alerts sind seit 2026-10-02 eingeschaltet; `gh api repos/Cuarroc/ProjectA/dependabot/alerts?state=open,fixed,dismissed,auto_dismissed --paginate` liefert genau einen Alert, Exit 0 | `cargo audit --json` in `src-tauri` (advisory-db 1280 Einträge, Stand 2026-10-02, 564 Kisten): 0 Vulnerabilities, 2 Warnungen; `npm audit --json`: 0 in allen Stufen |

### KI-12: Abgleich vom 2026-10-02

Quellen: `gh api …/dependabot/alerts` (alle Zustände), `cargo audit --json`
(0.22.2), `npm audit --json`, jeweils im Arbeitsbaum auf `main` @ `bb0089a`.

| Advisory | Paket | Dependabot | `cargo audit` / `npm audit` | Bewertung |
|---|---|---|---|---|
| GHSA-wrw7-89jp-8q8g = RUSTSEC-2024-0429 | `glib` 0.18.5 | open, mittel | Warnung `unsound` | deckungsgleich; nur Linux (KI-9) |
| RUSTSEC-2024-0370 | `proc-macro-error` 1.0.4 | kein Alert (nur RustSec, keine GHSA-ID) | Warnung `unmaintained` | erwartete Abweichung: Dependabot meldet nur Advisories mit GHSA-ID; nur Linux (KI-10) |
| RUSTSEC-2024-0411…0420 (GTK3) | `gtk`, `atk`, `gdk` und Geschwister 0.18.2 | kein Alert | nicht mehr gemeldet | in der advisory-db seit 2026-08-14 `withdrawn`; Kisten noch im Lock (KI-10) |
| RUSTSEC-2025-0075/0080/0081/0098/0100 | `unic-*` 0.9.0 | kein Alert | nicht mehr gemeldet | `urlpattern` ist 0.6.0, keine `unic-*`-Kiste mehr im Lock (KI-11) |
| npm | alle | kein Alert | 0 Funde | deckungsgleich |

Ergebnis: Es gibt keinen Dependabot-Alert ohne Entsprechung in `cargo audit`,
und keine Abweichung ohne Erklärung. Die 17 Warnungen vom 2026-08-29 sind auf 2
gesunken (Withdrawals der advisory-db und der `urlpattern`-Bump). Unbelegt
bleibt: der Windows-Graph wurde nicht neu gezogen; `cargo tree --target
x86_64-pc-windows-msvc -i glib` liefert weiterhin nichts (2026-10-02).
| KI-21 | Das Nutzer-Plugin ruflo-core (Claude Code, `PreToolUse`/`PostToolUse Bash`) überschrieb eine per Shell-Redirect geschriebene Datei eines Claude-Workers mit seiner eigenen Ausgabe | 2026-10-02 (KI-OBS): das Plugin ruflo ist seit 25.09.2026 abgeschaltet (Nutzerangabe); damit ist die Umgebungs-KI erledigt | Übernommen 2026-09-17 aus dem Claude-Adapter-Smoke (PR #49, `.pa/report_provider_adapter_smoke_claude.md`); war nie ein ProjectA-Fehler, Home-Plugins lädt Claude Code selbst. Nicht im Repo prüfbar (liegt in der Nutzerumgebung); tritt der Effekt bei einem neuen Claude-Worker-Lauf wieder auf, ist es ein neuer Befund. |
| KI-22 | Der Claude-API-Pfad (Review-Subagenten über API-Key) hatte kein Guthaben (400 „credit balance too low“, 14.09.) | 2026-10-02 (KI-OBS): geschlossen als dokumentierte Grenze, Nutzerentscheidung 24.09. | Es laufen nur Abo-Pfade, kein API-Geld (`AGENTS.md`, „Subscriptions only“). Reviews laufen über Kimi K3 + GLM 5.2 auf Ollama Cloud (`.pa/review_transport.py`); der OpenRouter-Weg (`review.yml`) ruht. Kein Handlungsbedarf im Code. |
| KI-25 | Linux-Prozessgruppen-Test `testgate::tests::a_timeout_takes_the_whole_process_group_with_it` scheiterte einmal (Run 35630751744, 21.09.) | 2026-10-02 (KI-OBS): Fix aus W1-29 ist auf `main` (`testgate.rs:780`, `X`/`x` zählen als tot); kein erneutes Auftreten | Beleg: 301 abgeschlossene CI-Läufe vom 25.09. bis 02.10. (50 rot, alle 50 per `--log-failed` auf den Testnamen durchsucht): der Test steht nie als FAIL. Ursache und Messung im alten Eintrag: `.pa/report_w1-29.md`. **Rest behoben in PR #780 (KI25-SETUP-XDEAD / W1-29b):** Der Testhelfer in `setupgate.rs` zählt Z, X und x als tot; ein Unit-Test sichert auch R, S und D als lebend ab. Läuft der Test wieder rot, ist das ein neuer Befund. |
| KI-26 | Windows-PTY-Argumenttest `pty::tests::a_quote_and_a_variable_reach_the_process_unchanged` scheiterte sporadisch (Run 35266952403, 17.09.; Run 35917374303, 23.09.) | 2026-10-02 (KI-OBS): seit dem Node-Vorstart im Test (24.09.) kein erneutes Auftreten | Beleg: 301 abgeschlossene Läufe vom 25.09. bis 02.10., darunter die Windows-Bahn; in den fünf roten Windows-Läufen dieses Zeitraums steht der Test als PASS (0,3–0,5 s), nie als FAIL. Die Kaltstart-Erklärung ist damit nicht widerlegt (`.pa/report_ci_native_pty_marker.md`); wird der Test wieder rot, gilt sie als widerlegt. |
| KI-27 | Ein nativer Provider, der vor dem Lesen seines Inputs endet (`exited_undelivered`), hielt Token-Reservierung und Delivery-Zeile auf `started` | 2026-10-02 (KI-OBS): mit DF-15a (PR #103) und DF-15b (PR #16, 25.09.) behoben; kein erneutes Auftreten | Beleg: 301 abgeschlossene Läufe vom 25.09. bis 02.10. (50 rot, alle durchsucht); die `exited_undelivered`-Tests in `store::development_launches::tests` stehen nie als FAIL. Der Mechanismus (Freigabe im Exit-Commit, abgeleiteter `effectiveState`, Start-Abgleich) steht im alten Eintrag und im Code; weiterhin fail-closed: ein Absturz zwischen Host-Ende und Store-Commit bleibt `spawning` mit gehaltener Reservierung. |

### KI-30: `real_native_*`-Flake auf der Windows-Bahn (Stand 2026-10-04)

**Symptom.** Im Merge-Queue-Lauf scheitert das Gate `native-tests`
(`scripts/ci/native-tests.sh`, `cargo test --bin projecta real_native_ --
--ignored`, acht Tests, kein `--test-threads`) mit 1 bis 2 roten Tests. Das
Gate `rust-suite` davor ist in allen sieben Fällen grün (zuletzt 1733 von 1733).
Beim selben Code laufen die acht Tests in anderen Queue-Läufen durch (40 bis
49 s). Ein Fehlschlag wirft den PR aus der Queue, obwohl er den Code gar nicht
berührt (Lauf 37104184524 gehörte zu PR #199, reinen UI-Texten).

**Betroffene Tests** (Zeilen auf `main` @ `f48af09`):

| Test | Deklaration | Assertion, die auslöste |
|---|---|---|
| `workers::tests::real_native_provider_exit_before_input_delivery_reconciles_as_exited` | `src-tauri/src/workers.rs:4148` | `:4228` „native launch left unresolved instead of reconciled“ |
| `workers::tests::real_native_launch_service_owns_worktree_credentials_and_exit` | `src-tauri/src/workers.rs:3960` | `:4070` `drained.unresolved.is_empty()` ist `false` |
| `store::development_capture::managed_tests::real_native_runner_bounds_capacity_and_accepts_out_of_order_completion` | `src-tauri/src/store/native_managed_tests.rs:290` | `:449` `drained.unresolved.is_empty()` (der `unwrap` bei `:478` ist nur die Folge) |
| `store::development_capture::managed_tests::real_native_job_revokes_credentials_before_retirement_or_reconciliation` | `src-tauri/src/store/native_managed_tests.rs:133` | `:173` Fall 0: „native host did not complete cleanly; checkpoint owner no longer waiting; launch retained for reconciliation“ |

**Belege.** Quelle: `gh run list --workflow ci --limit 300` (Läufe vom
2026-10-02 17:45 UTC bis 2026-10-03 06:47 UTC; davon 58 Queue-Läufe auf
`mergify/merge-queue/*`: 46 grün, 11 rot, 1 ohne Ergebnis) und `gh run view
<id> --log-failed` für alle 33 roten Läufe der Stichprobe. Nur vorhandene Logs,
keine neuen Läufe. Sieben rote Queue-Läufe tragen einen der vier Tests:

| Lauf (Queue) | Beginn UTC | Test(s) rot |
|---|---|---|
| 37068740486 | 10-02 21:45 | `…job_revokes_credentials…` und `…bounds_capacity…` |
| 37082745894 | 10-03 00:36 | `…provider_exit_before_input_delivery…` |
| 37085248919 | 10-03 01:13 | `…provider_exit_before_input_delivery…` |
| 37089103958 | 10-03 02:14 | `…bounds_capacity…` |
| 37096906110 | 10-03 04:32 | `…provider_exit_before_input_delivery…` und `…bounds_capacity…` |
| 37099907810 | 10-03 05:28 | `…launch_service_owns_worktree…` |
| 37104184524 | 10-03 06:47 | `…provider_exit_before_input_delivery…` |

Die übrigen vier roten Queue-Läufe haben andere Ursachen und gehören nicht zu
diesem Eintrag: 37102667685 (`workers::tests::a_withdrawn_variant_costs_the_addition_not_the_respawn`,
`workers.rs:5418`, in `rust-suite`), 37044790937 (Runner-Start: `install-action`
„bash startup failure“, danach `pa-capture-host --self-test-host: Exit 2`) und
37063228246 sowie 37066349860 (`red-first`). Die Windows-Bahn eines gewöhnlichen
PR ist seit CI-03 ein Stub; deshalb taucht der Flake nur in Queue-, Push- und
Wochenläufen auf. Die Push-Läufe auf `main` der Stichprobe (69 grün, 4
abgebrochen) zeigen keinen Fall.

**Was die Logs über den Mechanismus hergeben.** Drei der vier Tests scheitern
immer am selben Punkt: nach dem Drain bleibt ein Start unaufgelöst
(`unresolved` nicht leer). Beim Early-Exit-Test steht im selben Log jedes Mal,
dass das Test-Temp-Verzeichnis nicht gelöscht werden konnte („The process cannot
access the file because it is being used by another process“, os error 32):
ein Prozess (Capture-Host oder Kindprozess) lief bei der Assertion noch oder
hielt das Verzeichnis offen. Die Laufzeit der acht Tests unterscheidet rote und
grüne Läufe nicht eindeutig (rot 39 bis 68 s, grün 40 bis 49 s).

**Vermutung (nicht belegt).** Die acht Tests laufen im Gate parallel in einem
Prozess und starten je echte ConPTY-/Job-Objekt-Kindprozesse auf dem
gehosteten Windows-Runner. Unter Last gewinnt gelegentlich das Zeitfenster
(`drain`/`wait_completion` mit 10 bis 40 s, `shutdown` mit 25 s) oder die
Reihenfolge „Host beendet, Store-Abgleich, Prüfung“ nicht, sodass der Start
noch `unresolved` ist. Alternative: ein echter Fehler in der Abgleichsreihenfolge
(vgl. KI-27, DF-15), der nur bei knappem Timing sichtbar wird. Beides ist
nicht unterschieden.

**Nächster Schritt.** (1) Kein Test wird abgeschwächt und kein Zeitlimit
„einfach“ erhöht, bevor die Ursache eingegrenzt ist. (2) Das Gate
`native-tests` führt die acht Tests vorübergehend mit `--test-threads=1` aus;
das ist eine Minderung für parallele ConPTY-Kindprozesse, keine Behebung der
Ursache. (3) Bei Reproduktion im Test den
Zustand von `unresolved` und die noch lebenden Prozesse ausgeben, bevor
assertiert wird. (4) Eigenes Paket mit rotem Regressionstest; die vier
Assertionen liegen in Nahtstellen-Nähe (`store/`, `workers.rs`), also
seriell und mit Prüfung der Stufe A. Auf Linux nicht nachstellbar: das Gate
verlangt ein echtes Windows (`native-tests.sh` bricht sonst ab).

**Neue Beobachtung 2026-10-03 (PR #252, ARCH-08f).** Queue-Lauf 37154872281
(Queue-Kopf `5a79d6a`): `rust-suite` 1749 von 1749 grün, `native-tests` 7
grün, 1 rot: `real_native_runner_bounds_capacity_and_accepts_out_of_order_completion`,
`src-tauri/src/store/native_managed_tests.rs:449` (`drained.unresolved.is_empty()`),
Folgefehler `:478`. Dasselbe Muster wie oben; #252 ändert nur Frontend-Dateien.
Die Queue hat #252 um 21:54 UTC entlassen; der Koordinator reiht ihn genau einmal
unverändert neu ein (Queue-PR #257). **Nicht als gelöst vermerkt**: erst ein
frischer Lauf am gleichen Quellstand sagt etwas, und auch ein grüner Lauf belegt
die Ursache nicht.

**Stand 2026-10-03 23:26 UTC (beobachtet; Quellstand `origin/main` cc95a57, Merge #260 um 23:16:34 UTC).** Die Ursache bleibt **unbekannt**; es gibt keine
Behebung und keinen Beleg für „Flake“ oder „echter Fehler“. Der erste Queue-Lauf
37154872281 von #252 scheiterte mit `native_managed_tests.rs:449`; der
kontrollierte einmalige Neulauf 37157889878 am gleichen Quellstand war grün.
Das widerlegt die Ursache nicht. PR #262 (Kopf `14e1532`) gibt nur
`unresolved`-IDs und Abschlussergebnisse in der Assertion-Meldung aus: er
ändert weder Bedingungen noch Timing noch Produktionscode. Die Änderung liegt
in Windows-Tests und wurde auf Linux nicht kompiliert; den Beleg liefert die
Windows-Bahn in der Queue.

**Neue Beobachtung 2026-10-04 (Queue-PR #281, prüft #273 auf `effef1a`).**
Queue-Lauf 37196272431 (Beginn 10:43 UTC; `gh run view 37196272431 --log-failed`):
nur `gates (windows)` rot, `native-tests` 7 grün, 1 rot:
`workers::tests::real_native_provider_exit_before_input_delivery_reconciles_as_exited`,
`src\workers.rs:4069` „native launch left unresolved instead of reconciled:
["pty-1a1068ef219-1"]“. Im selben Log steht „failed to remove test temp
directory … os error 32“. Dasselbe Muster wie oben; #273 ändert nur
Review-Skripte und Doku. Eine Ursache wird daraus nicht abgeleitet; #262
(Diagnose) war da schon in `main`.

**Forschungsstand 2026-10-04.** In 8 von 42 untersuchten Queue-Läufen trat
KI-30 auf. Cluster B überschritt die Deadline um ungefähr 50 Sekunden; Cluster
A endete mit „unknown error“ und zusätzlich `os error 32`. Das grenzt den
Mechanismus ein, beweist aber weiterhin keine Ursache. Die serielle Ausführung
des unveränderten Bestands von acht `real_native_*`-Tests bleibt deshalb eine
als **TEMPORÄR** gekennzeichnete Minderung und wird mit der eigentlichen
KI-30-Behebung wieder entfernt.

**Ursache belegt 2026-10-05 (V16-01, Branch `claude/w16-01-ki30-gate-drain`).**
In beiden roten Läufen vom 05.10. (37301269691, 37308669763) meldet der
Early-Exit-Test als einzigen Fehler `checkpoint owner no longer waiting; launch
retained for reconciliation`: Die native Seite war erfolgreich, nur die
Bestätigung eines Checkpoints scheiterte. Mechanismus: Beendet sich der
Provider, bevor seine Eingabe ankommt, wartet der Elternprozess auf keine
Quittung mehr. `execute_host_inner` (`process_capture/windows_capture.rs`) kehrte
zurück, während der Process-Checkpoint noch in SQLite geschrieben wurde. Damit
fiel der Antwortkanal weg, die Bestätigung des Checkpoint-Akteurs
(`checkpoints.rs`, `acknowledge`) scheiterte, `managed::run` übersprang
`finalize_native_undelivered_exit`, und der Start blieb `unresolved`. „os error
32“ ist nur Aufräumrauschen nach dem Panic. Belegt durch den deterministischen
Test `process_capture::managed::tests::real_native_owned_host_waits_for_pending_checkpoints_after_an_undelivered_exit`
(Process-Bestätigung 3 s verzögert): rot in Lauf 37323778974 mit
`[(Launch, Ok(())), (Process, Err("checkpoint owner no longer waiting"))]`,
grün nach dem Fix in 37325836015, 37327636278 und 37332693087 (37327651607
dazwischen rot nur durch einen fremden Timeout in `rust-suite`,
`retention::tests::deletion_runs_in_chunks_until_the_table_is_clean`). Fix: Der
Undelivered-Pfad wartet, bis jeder eingereichte Checkpoint bestätigt ist
(höchstens 10 s); Ablehnung, Verlust und Zeitüberschreitung bleiben Fehler.
Danach ist `--test-threads=1` aus `scripts/ci/native-tests.sh` entfernt
(Lauf siehe PR-Text). **Nicht belegt:** ob dieselbe Ursache die anderen drei
Tests trifft (`…bounds_capacity…`, `…launch_service_owns_worktree…`,
`…job_revokes_credentials…`; Letzterer trug ebenfalls „checkpoint owner no
longer waiting“, aber neben einem nativen Fehler). Geschlossen wird KI-30 erst
nach 0 Fehlschlägen in den nächsten 40 Queue-Läufen (`docs/plan/v1.6.0/plan.md`,
V16-01).

**Zusatzbeobachtung 2026-10-08 (KI-30, anderer Test).** In den Queue-Runs
[37810056116](https://github.com/Cuarroc/ProjectA/actions/runs/37810056116)
(Branch `mergify/merge-queue/cc3f3a946c`, Head `622f2e21`) und
[37814405700](https://github.com/Cuarroc/ProjectA/actions/runs/37814405700)
(Branch `mergify/merge-queue/f8a5121bb4`, Head `5b4452b7`) scheiterte
`store::development_capture::managed_tests::real_native_completed_receipt_survives_sqlite_writer_within_busy_timeout`.
Die gelesenen Windows-Logs nennen `native host did not complete cleanly` und
am Receipt-Checkpoint `checkpoint owner no longer waiting`; die Assertion
steht dort in `src-tauri/src/store/native_managed_tests.rs:195`, der folgende
Join-Fehler bei `:202`. Beide Runs: Windows rot, Linux und red-first grün.
Quelle: `gh run view <id> --json headBranch,headSha,conclusion,jobs` und
`gh run view <id> --log-failed`, jeweils Exit 0; kein neuer Testlauf.

Root ordnet dies derselben Windows-Native-Flake-Klasse zu und meldet andere
grüne Batches im Zeitfenster sowie die erneute Einreihung von #663/#700.
Das belegt keine gemeinsame Ursache mit KI-24b oder den früheren KI-30-Tests;
der Befund bleibt offen. Zur Eingrenzung im bestehenden Z4-ARCH-11 aufnehmen,
solange der Schnitt bei dieser Klasse bleibt; vorhandene Store-Reservierung,
Windows-RED, Größen-/Tier-A-Gates erhalten. Keine Blanket-Retries oder
abgeschwächte Assertionen aus dieser Dokumentation ableiten.