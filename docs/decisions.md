# Entscheidungen — aktueller Index

<a id="entscheidungs-journal"></a> Stand: 20.10.2026. Autorität, Geltung und Endbedingung stehen je Eintrag; Gründe, Anforderungen und Belege bleiben im verlinkten [Originaljournal](archive/decisions-2026-10/journal.md). Historische Zustände sind keine Live-Belege. Ein Datum allein beendet keine Regel; wiederholte kurze Kennungen behalten ihren Scope.
Der [PLAN](PLAN.md#entscheidungs-inbox) führt offene Entscheidungen und den neueren Nutzbar-1-Fokus; [AGENTS.md](../AGENTS.md) die geltenden Betriebsregeln. Der Dokumentationsauftrag vom 20.10. beendet die Zusatz-App, lässt die Fabrik-Arbeit getrennt bestehen und verlangt getrennte Prüfer. Dieser Index erteilt keine Ausführungsfreigabe; proposed bleibt proposed. Datumsüberschriften und ihre Reihenfolge bleiben für Leser und alte Anker erhalten. Archivierte relative Quellenlinks führen über reine Weiterverweise zum aktuellen Dokument.

## 2026-10-13 — V2-ARCH-0 architecture sketch

**Agentenvorschlag (proposed)** · Gilt: 13.10.; V2-ARCH-0, sieben ADRs; keine Integration beschlossen. · Ende: Berater-Gegenprüfung und Root-Abnahme offen; keine Runtime-/Migrationsfreigabe. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-13--v2-arch-0-architecture-sketch).

### ADR-V2-01 — One Core setting writer and append-only journal

**Agentenvorschlag (proposed)** · Gilt: 13.10.; ADR-V2-01: ein Settings-Owner, append-only Journal, typisierte Adapter. · Ende: nicht darstellbares Setting vor Enrollment neu entwerfen; Annahme offen. · [Quelle](archive/decisions-2026-10/journal.md#adr-v2-01--one-core-setting-writer-and-append-only-journal).

### ADR-V2-02 — Requests, serialization, probation and recovery

**Agentenvorschlag (proposed)** · Gilt: 13.10.; ADR-V2-02: FIFO, Revision, 24 h beobachtete Probezeit, Recovery/Not-Aus. · Ende: unsicher kompensierbarer Adapter bleibt proposal-only; Annahme offen. · [Quelle](archive/decisions-2026-10/journal.md#adr-v2-02--requests-serialization-probation-and-recovery).

### ADR-V2-03 — Rights are code guards, approval is scoped evidence

**Agentenvorschlag (proposed)** · Gilt: 13.10.; ADR-V2-03: off als Default; Einwilligung bindet Scope/Diff/Revision. · Ende: neuer Nutzerkanal nur mit Freigabe und Negativtests; Annahme offen. · [Quelle](archive/decisions-2026-10/journal.md#adr-v2-03--rights-are-code-guards-approval-is-scoped-evidence).

### ADR-V2-04 — Personas configure runs within department ceilings

**Agentenvorschlag (proposed)** · Gilt: 13.10.; ADR-V2-04: Persona-Rechte im Schnitt vorhandener Obergrenzen. · Ende: Mehrabteilungs-Zuordnung erst nach Vertrag; Annahme offen. · [Quelle](archive/decisions-2026-10/journal.md#adr-v2-04--personas-configure-runs-within-department-ceilings).

### ADR-V2-05 — Durable triggers and authenticated webhook ingress

**Agentenvorschlag (proposed)** · Gilt: 13.10.; ADR-V2-05: dauerhafte Trigger-/Webhook-Deduplizierung, kein Selbststart. · Ende: neues Protokoll braucht getesteten Adapter; Erreichbarkeit/Annahme offen. · [Quelle](archive/decisions-2026-10/journal.md#adr-v2-05--durable-triggers-and-authenticated-webhook-ingress).

### ADR-V2-06 — One workflow engine, evidence bound to the candidate

**Agentenvorschlag (proposed)** · Gilt: 13.10.; ADR-V2-06: eine Engine; Kandidatenwechsel entwertet Belege; alte Reviewzahl ersetzt durch [Nachtrag](#2026-10-15---reviewer-count-per-tier). · Ende: Ledger-Ersatz nur nach Migrations-ADR; Annahme offen. · [Quelle](archive/decisions-2026-10/journal.md#adr-v2-06--one-workflow-engine-evidence-bound-to-the-candidate).

### ADR-V2-07 — ADR-A7: separate modules, one serial store lane

**Agentenvorschlag (proposed)** · Gilt: 13.10.; ADR-V2-07/ADR-A7: eine serielle Store-Lane, ApiBackend nach A1/F1. · Ende: vier Wochen Lane-Messung und ausdrückliche Regeländerung; Annahme offen. · [Quelle](archive/decisions-2026-10/journal.md#adr-v2-07--adr-a7-separate-modules-one-serial-store-lane).

## 2026-10-08

**technische Voraussetzung (entschieden)** · Gilt: A1, 08.10.: ApiBackend bis nach M4 in main.rs, dann kleine Ports; ARCH-12 wartet. · Ende: zwei bereite M4-Pakete je >7 Tage nur mn-Warten; Portzuschnitt bei belegter Unteilbarkeit neu prüfen. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-08).

## 2026-10-05

**technische Voraussetzung** · Gilt: 05.10.: App-Release unter menschlicher Kontrolle ist keine Continuous-Freigabe. · Ende: Matrixzeilen 18/27 erst mit W5-02d wiederherstellen; Aktivierung braucht Abnahme und Ja. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-05).

## 2026-10-03

**Agentenvorschlag / technische Voraussetzung** · Gilt: 03.10.: offene ADRs und getrennte CodeQL-Einordnung unten. · Ende: eigene Annahme je Vorschlag; Alert-Begründung nur bei gleichem Datenfluss. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-03).

### ADR-Entscheidungen und offene Vorschläge

**Agentenvorschlag (proposed); CodeQL: technische Voraussetzung** · Gilt: 03.10.: A2–A7 offen; SEC-02e Session-/Worker-IDs nur Labels. · Ende: A2 Lint-Hygiene; A3 WRITE_THROUGH-Engpass; A4 dritter Transport; A5 zweiter SQLite-Schreiber; A6 zweiter Drift; A7 vier Wochen OPS-01; Alerts bei Berechtigungsfunktion neu prüfen. · [Quelle](archive/decisions-2026-10/journal.md#adr-entscheidungen-und-offene-vorschläge).

## 2026-09-21

**technische Voraussetzung** · Gilt: 21.09.: Shell-Heuristik, GITHUB_OUTPUT-Auswahl, getrennte Build-Ziele; Gate-Hashes/Mindestlisten; leere Antwort kein Review. · Ende: je Einzelbefund: gleichwertiger Parser-/Cargo-/Review-Beleg; verworfene Promptgrößen-Hypothese nicht wiederbeleben. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-21).

## 2026-09-17

**Nutzerbeschluss / technische Voraussetzung (historisch)** · Gilt: 17.09.: W1 Zuteilung/Protection/Server-Handover; alter Selbstmerge ersetzt durch [Nachtrag](#2026-09-24---ci-01-mergify-queue-und-actions-minuten-nutzer-entscheidung), Reviews ersetzt durch [Nachtrag](#2026-10-15---reviewer-count-per-tier). · Ende: alte Zuteilung endet bei Übernahme; heutige Belegung nicht belegt. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-17).

## 2026-09-16

**Nutzerbeschluss / technische Voraussetzung** · Gilt: 16./17.09.: W0, Scout-Adoptionen, Abo-Pfad, Route-Fixture 3600 s; Ollama Helper ersetzt durch [Nachtrag](#2026-09-03-abends-rev-91-nach-drei-externen-reviews) und ersetzt durch [Nachtrag](#22092026--deepseek-worker-richtung-und-startfehler). · Ende: Struktur bei belegter Blockade; Fixture mit injizierter Uhr; Modell bei fehlendem Abo-/Tool-Beleg sperren. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-16).

## 2026-09-15

**technische Voraussetzung** · Gilt: 15.09.: docs/PLAN.md einziger Arbeitsplan, andere Pläne/Specs nur Archivbelege. · Ende: nie rückwirkend; zweiter Plan nur eigener Beschluss. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-15).

## 2026-09-09

**Nutzerbeschluss / technische Voraussetzung** · Gilt: 09.09.: Multi-Harness, keine Browser-Retries, bash/pipefail, SHA Pinning, eine Gate-Liste, getrennte Testbäume, Release-Environment; Windows je PR ersetzt durch [Nachtrag](#2026-09-25---ci-03-github-actions-cost---windows-only-in-the-queue-red-first-in-the-linux-job-user-decision). · Ende: Harness nach Bedarfsbeleg; Schutz nur gleichwertig ersetzen; Linux-Beleg WSL/ext4, keine behauptete act-Parität. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-09).

## 2026-09-08

**technische Voraussetzung** · Gilt: 08.09.: Spec-First für Trust/Nahtstellen; alte freie Pflichtreviewer ersetzt durch [Nachtrag](#2026-10-15---reviewer-count-per-tier). · Ende: neu bewerten nach zwei Vorprüfungen ohne zusätzlichen Befund; aktuelle Unabhängigkeit bleibt. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-08).

## 2026-09-07

**technische Voraussetzung** · Gilt: 07.09.: Same-Origin-Proxy, API-Token nie im Browser; behind==0-Ersatz zurückgenommen (33477dd). · Ende: Proxy nur gleich privat ersetzen; Evidence-Ersatz mit Merge-Tree-OID Checkout beendet. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-07).

## 2026-09-06

**technische Voraussetzung** · Gilt: 06.09., korrigiert 03.10.: argv-only zurückgenommen, Claude/Codex Dateikanäle; OpenCode/Ollama ohne Beleg unsupported. · Ende: neuer CLI-/Capture-Beleg; Konfiguration beweist keine Fähigkeit. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-06).

## 2026-09-04

**technische Voraussetzung** · Gilt: 04.09. erster Block: review_evidence getrennt, Verdict-Token, expliziter Respawn; DPAPI-Dateien 7 Tage/2 MB, nach Archive/Merge entfernen; isolierte Daten und Offline-Restore. · Ende: Retention nur belegter längerer Restore; DB nur gleich verschlüsselt mit Leak-Test; anderer Human-Proof für Berechtigung; alte Server-Werkzeuge historisch. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-04).

## 2026-09-02

**technische Voraussetzung; Erweiterungen abgelehnte Agentenvorschläge** · Gilt: 02.09.: keine Produktions-Sourcemaps; Tauri-Plugins; Redis/Kontexttools nur Bedarfsbeleg; Majors einzeln. AP-10b verengt http auf localhost-Board ohne Userinfo; Dependabot-Rhythmus ersetzt durch [Nachtrag](#2026-09-24---ci-01-mergify-queue-und-actions-minuten-nutzer-entscheidung). · Ende: Plugin-/Last-/Token-Beleg; Opener bei LAN Bindung neu prüfen; alte Provider/Release/Cleanup-Zuweisung ist Historie. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-02).

## 2026-09-03

**technische Voraussetzung; Provider-Zuteilung historisch** · Gilt: 03.09. erster Block: Golden Path, Single-Instance, inkrementelle Struktur, Task-Alias, Lifecycle/blockers getrennt, Setup-Trust; Export vor Retirement; Specs ersetzt durch [Nachtrag](#2026-09-04-1). · Ende: Task-Identität erst roter Recovery-Test; mehrere Schreiber erst verriegelte Owner; Rechte nur gleichwertig ersetzen. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-03).

## 2026-09-04

**technische Voraussetzung** · Gilt: 04.09. zweiter Block: Spec-Gate, Rohtext-Export, ein Single-Instance-Plugin zuerst; drei DB-Generationen, Diagnose-Allowlist, keine Logs via API; HQ abgeleitet. · Ende: Fixtures bei neuem Schema erweitern; Sperre nur gleichwertig ersetzen; HQ bei ersetzt lebendem Quellregister prüfen. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-04-1).

## 2026-09-06

**technische Voraussetzung (Adoption)** · Gilt: 06.09. zweiter Block: Coverage und Browser mit Tauri mockIPC; alte Versionen sind Beobachtungen. · Ende: nur strengere Testschicht ersetzt Abdeckung. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-06-1).

## 2026-09-03 (Befragung der Claude-Web-Sitzung, 16 Antworten)

**Nutzerbeschluss / Agentenvorschlag (historisch)** · Gilt: 03.09. Befragung: alte Kalibrierung, Struktur-Light, NT-17, Skills, hermes-agent und Nachtlaufgrenzen; Reviewverfahren ersetzt durch [Nachtrag](#2026-10-15---reviewer-count-per-tier), CI ersetzt durch [Nachtrag](#2026-09-25---ci-03-github-actions-cost---windows-only-in-the-queue-red-first-in-the-linux-job-user-decision). · Ende: Einzelbedingungen im Volltext; Designstopp am 09.09. aufgehoben; keine neue Startfreigabe. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-03-befragung-der-claude-web-sitzung-16-antworten).

## 2026-09-03 (abends, Rev 9.1 nach drei externen Reviews)

**technische Voraussetzung; Nutzerbeschlüsse im Volltext getrennt** · Gilt: 03.09. abends, Nachträge 10.–17.09.: red-first, volle Windows-Suite, geschützte Workflows, Skillpfade; Rust/SQLite besitzt Policy/Ledger; Native-Identity/Recovery/Registry/ACKs und projecta_capture bleiben Verträge. · Ende: gleichwertige Fencing-/Crash-/Privacy-Belege; Aktivierung gesperrt. CI ersetzt durch [Nachtrag](#2026-09-25---ci-03-github-actions-cost---windows-only-in-the-queue-red-first-in-the-linux-job-user-decision); PTY am 02.10. auf Backend-Owner/strip aufgelöst; Ollama ersetzt durch [Nachtrag](#22092026--deepseek-worker-richtung-und-startfehler). · [Quelle](archive/decisions-2026-10/journal.md#2026-09-03-abends-rev-91-nach-drei-externen-reviews).

## 22.09.2026 — DeepSeek-Worker-Richtung und Startfehler

**Nutzerbeschluss / technische Voraussetzung** · Gilt: 22.09.: DeepSeek ersetzt Qwen-W2-09b; Konfigurationsfehler sperrt Start; hqdata-Treiber clone-lokal; Zustellung nicht belegt. · Ende: neuer Nutzerentscheid/sicherer Spawn-Vertrag; Treiber erst bei nicht mehr eingechecktem Snapshot entbehrlich. · [Quelle](archive/decisions-2026-10/journal.md#22092026--deepseek-worker-richtung-und-startfehler).

## 2026-09-22 - controlled dependency adoption

**technische Voraussetzung (Adoption)** · Gilt: 22.09.: Workflow-/jsdom-Adoption mit Pins und normalen Gates. · Ende: bei Kompatibilitätsfehler zurücknehmen; Checks nicht schwächen. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-22---controlled-dependency-adoption).

## 2026-09-23 — gemeinsamer Dev-HQ-/ProjectA-Kern

**technische Voraussetzung (Architektur)** · Gilt: 23.09.: App/HQ teilen Rust/SQLite; Node hostet/proxyt, kein zweiter Scheduler; Kapazitäten getrennt. · Ende: Autorität nur mit transaktionaler Fencing-/Recovery-/Verdict-Parität neu verteilen. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-23--gemeinsamer-dev-hq-projecta-kern).

## 2026-09-23 — HQ2 Studio verwendet die bestehende Runtime

**technische Voraussetzung** · Gilt: 23.09.: Studio nutzt HQ-Proxy/Runtime; Host nur Routing/Quellenkatalog, unbekannte Benchmarks bleiben unbekannt. · Ende: attestierter Plan-/Plugin-/Benchmarkvertrag; keine aktuelle Funktion aus alter Lieferung ableiten. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-23--hq2-studio-verwendet-die-bestehende-runtime).

## 2026-09-23 — DEVFLOW als Erweiterung des HQ2-Vertrags (DF-03)

**technische Voraussetzung (Dokumentvertrag angenommen)** · Gilt: 23.09.: DF-03: HQ2-Übergänge mit Revision, kein Scheduler; Queue/Continuous getrennt; Human-Policy und Kandidat binden Autorität. · Ende: belegter Widerspruch und neues Vertragsreview; Runtime-Abnahme paketweise. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-23--devflow-als-erweiterung-des-hq2-vertrags-df-03).

## 2026-09-23 — Revisionsgebundener Planimport (DF-04)

**technische Voraussetzung** · Gilt: 23.09.: DF-04 immutable Planprojektion/CAS; entfernte IDs nicht dispatchbare Historie; begrenzter Reader/Projekt-Join. · Ende: Retention/Löschung erst explizit beschlossen und geprüft; Import erteilt keine Autorität. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-23--revisionsgebundener-planimport-df-04).

## 2026-09-23 - insta snapshot tests (W1-23)

**Nutzerbeschluss (Adoption) / technische Voraussetzung** · Gilt: 23.09.: W1-23 insta Default-Features, gesamte Abhängigkeits-MSRV; .snap.new ignoriert, Scope budget/status. · Ende: CI Schutz umgehbar oder Snapshots zu laut; alte Messungen bleiben datiert. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-23---insta-snapshot-tests-w1-23).

### 2026-09-23 — DF08 identity history retention and trust boundary

**technische Voraussetzung** · Gilt: 23.09.: DF08/Migration21 Identität append-only, CAS/Identity atomar; FK ist kein Trust-Beleg. · Ende: Retention mit Migrations-/Readerbeleg; keine Agentenattestierung; ungültiger Provider sperrt Bindung. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-23--df08-identity-history-retention-and-trust-boundary).

## 2026-09-23

**technische Voraussetzung** · Gilt: 23.09.: W1-21 search ~0.15 für xterm 5.5; fehlende peerDependencies kein Beleg; fit ersetzt durch [Nachtrag](#2026-09-23---addon-fit-zurueck-auf-die-xterm-5-linie-w1-21b). · Ende: xterm 6 nur gemeinsam mit Addons/API migrieren. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-23).

## 2026-09-23 - addon-fit zurueck auf die xterm-5-Linie (W1-21b)

**technische Voraussetzung** · Gilt: 23.09.: W1-21b fit ~0.10 misst echte Scrollbar, Regressionstest bleibt. · Ende: gemeinsamer xterm-6-Sprung. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-23---addon-fit-zurueck-auf-die-xterm-5-linie-w1-21b).

## 2026-09-26 - npm-Sammel-Update ohne xterm-6-Addons (deps-npm)

**technische Voraussetzung** · Gilt: 26.09.: inkompatible Addons aus npm-Gruppe ausgenommen; Updater JS/Rust passend, keine Downgrades. · Ende: xterm/fit/search gemeinsam migrieren und Terminalbetrieb prüfen. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-26---npm-sammel-update-ohne-xterm-6-addons-deps-npm).

## 2026-09-24 - CI-01: Mergify-Queue und Actions-Minuten (Nutzer-Entscheidung)

**Nutzerbeschluss** · Gilt: 24.09.: CI-01 Mergify/Merge-Commits, keine Draft-CI; Dependabot monatlich, Security sofort; immer-voll-main ersetzt durch [Nachtrag](#2026-09-24---ci-02-leichter-main-push-wochenlauf-docs-only-plan-nutzer-entscheidung), Windows-Auswahl ersetzt durch [Nachtrag](#2026-09-25---ci-03-github-actions-cost---windows-only-in-the-queue-red-first-in-the-linux-job-user-decision). · Ende: Queue nur nach mehrwöchiger Messung neu bewerten; Cache bei belegtem Median-Nachteil; Zulassung auch CI-HARDEN-02. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-24---ci-01-mergify-queue-und-actions-minuten-nutzer-entscheidung).

## 2026-09-24 - CI-02: leichter main-Push, Wochenlauf, Docs-only-Plan (Nutzer-Entscheidung)

**Nutzerbeschluss / technische Voraussetzung** · Gilt: 24.09.: CI-02 leichter main-Push nur Queue-belegt ohne Cacheänderung; Woche/manuell voll; Docs nach Gate-Eingaben, Zweifel schwer; light ersetzt kein prepush. · Ende: neuen Reader in HEAVY_DOCS aufnehmen; Wochenlauf nie ersatzlos; ungequeue-te Docs ersetzt durch [Nachtrag](#2026-09-26---setup-12-unqueued-docs-only-pushes-to-main-stay-full); Bot-Ausnahme nur exakte Identität/Manifeste. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-24---ci-02-leichter-main-push-wochenlauf-docs-only-plan-nutzer-entscheidung).

## 2026-09-25 - Hotfix: Hooks pruefen den Arbeitsbaum, der committet/pusht

**Nutzerbeschluss / technische Voraussetzung** · Gilt: 25.09.: Hooks bestimmen tatsächlich committeten/gepushten Worktree per git rev-parse. · Ende: nie fremden Baum als geprüft ausgeben. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-25---hotfix-hooks-pruefen-den-arbeitsbaum-der-committetpusht).

## 2026-09-25 - CI-03: GitHub Actions cost - Windows only in the queue, red-first in the linux job (user decision)

**Nutzerbeschluss** · Gilt: 25.09.: CI-03 Windows nur Queue/Woche/Dispatch, PR Stub; red-first im Linux-Job mit fail-closed Verdikt; parallel=1 ersetzt durch [Nachtrag](#2026-10-04---ci-queue-02-mergify-max_parallel_checks-from-1-to-2). · Ende: bei Windows-Queue-Fehlern neu messen; red-first bei Toolchainbedarf/Timeout trennen; Checknamen stabil. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-25---ci-03-github-actions-cost---windows-only-in-the-queue-red-first-in-the-linux-job-user-decision).

## 2026-09-25 - W5-28: PROJECTA_QUEUE=off und der automatische Laufzeit-Beleg

**technische Voraussetzung** · Gilt: 25.09.: W5-28 PROJECTA_QUEUE=off vor Dispatcher; runtime-proof isoliert mit API/Log/Bild. · Ende: persistierter Not-Aus ersetzt Schalter; gleichwertiger Treiber ersetzt Belegfunktion; keine Startfreigabe. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-25---w5-28-projecta_queueoff-und-der-automatische-laufzeit-beleg).

## 2026-09-25 - gitleaks als Pflicht-Gate vor jedem Commit

**Nutzerbeschluss** · Gilt: 25.09.: gitleaks vor Commit auf Index; fehlender Scanner Fehler, Allowlist nur begründete Testwerte. · Ende: nur ausdrückliche Aufhebung der Nutzerregel. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-25---gitleaks-als-pflicht-gate-vor-jedem-commit).

## 2026-09-25 - W5-02a: coordinators run without a write path

**technische Voraussetzung** · Gilt: 25.09.: W5-02a App-Koordinator strict, auch Failover, kein Repo-Schreibpfad; harte Grenze braucht W5-02e. · Ende: Repo-Memory über Workerauftrag; gleiches Konto ist keine Isolation; Scouts ausgenommen. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-25---w5-02a-coordinators-run-without-a-write-path).

## 2026-09-25 - CI-04: roter main friert die Mergify-Queue ein (scheduled freeze)

**technische Voraussetzung** · Gilt: 25.09.: CI-04 rot friert Queue, nur voll grün taut auf; Issue-Fallback/Hotfix-Ausnahme. · Ende: anderer Queue-Owner oder fehlendes Freeze-Recht; heutiger Token-Scope unbelegt. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-25---ci-04-roter-main-friert-die-mergify-queue-ein-scheduled-freeze).

## 2026-09-26 - SETUP-12: unqueued docs-only pushes to main stay full

**technische Voraussetzung** · Gilt: 26.09.: SETUP-12 ungequeue-te main-Pushes auch für Docs voll; Queue voll wegen dynamischer Reader. · Ende: erst maschinengeprüfte geschlossene Allowlist sämtlicher Gate-Eingaben. · [Quelle](archive/decisions-2026-10/journal.md#2026-09-26---setup-12-unqueued-docs-only-pushes-to-main-stay-full).

## 2026-10-04 - CI-QUEUE-02: Mergify `max_parallel_checks` from 1 to 2

**technische Voraussetzung (beschlossen)** · Gilt: 04.10.: CI-QUEUE-02 parallel_checks=2 ersetzt 1 aus CI-03; weiterhin serieller Modus. · Ende: Runner-Limit oder Funktionsberechtigung ändert sich. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-04---ci-queue-02-mergify-max_parallel_checks-from-1-to-2).

## 2026-10-05 - CI-HARDEN-02: review disposition gates queue admission

**technische Voraussetzung** · Gilt: 05.10.: CI-HARDEN-02 review-ok in beiden Zulassungslisten; nur Orchestrator nach Disposition ohne offene hohe Befunde, kandidatgebunden. · Ende: andere Merge-Autorität mit gleichem Invariant; keine Selbstqueue. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-05---ci-harden-02-review-disposition-gates-queue-admission).

## 2026-10-05 - W3-02e (#411) merged with review findings C1/C2 deferred

**technische Voraussetzung (historische Disposition)** · Gilt: 05.10.: W3-02e/#411 C1/C2 nach W3-02h/i, Producer W3-02g; fail-closed, keine allgemeine High-Ausnahme. · Ende: Nachfolgerbelege vor Schließen prüfen; früheres Beta-Tag nur Nutzerentscheid; Status im PLAN. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-05---w3-02e-411-merged-with-review-findings-c1c2-deferred).

## 2026-10-05 - Trust on first run for the post-update handshake identity (W3-02j)

**technische Voraussetzung** · Gilt: 05.10.: W3-02j vertraut einmal EXE/Live-DB nach abgeschlossenem Update, danach fail-closed. · Ende: signiertes Manifest/Build-ID bindet installierte Bytes: ersten Start verifizieren. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-05---trust-on-first-run-for-the-post-update-handshake-identity-w3-02j).

## 2026-10-09 - AGENTS-API-CREDITS: Max-plan included Anthropic API credits

**Nutzerbeschluss** · Gilt: 09.10.: AGENTS-API-CREDITS enge enthaltene Anthropic-Ausnahme, begrenzter Workspace, Schlüssel im Tresor; OpenRouter-Bann ersetzt durch [Nachtrag](#2026-10-15---reviewer-count-per-tier). · Ende: unerlaubte Belastung/geänderte Bedingungen/Widerruf; bei Erschöpfung Abos, keine Erweiterung. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-09---agents-api-credits-max-plan-included-anthropic-api-credits).

## 2026-10-11 - DEV-AUTO-1: build Dev installers after each main push

**technische Voraussetzung (Lieferweg)** · Gilt: 11.10.: DEV-AUTO-1 main-Push/manuell, aktiver Lauf bleibt, jüngster Pending wartet; Preview kein Release. · Ende: automatische Previews abgewählt: Trigger samt Shape-Gates ändern. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-11---dev-auto-1-build-dev-installers-after-each-main-push).

## 2026-10-11 - Werkbank je Projekt und Bewährte Wege (E1–E4)

**Nutzerbeschluss** · Gilt: 11.10., Werkbank E1–E4: Tresor vor B6a-2/B19; Recipe-Pilot ohne App-Code; Konfiguration statt Training, eigene DB read-only; E4 größere Glass-Entwürfe. · Ende: Pilot ohne Nutzen beendet App-Folge; Training/Kundendaten neues Ja; vorgezogene Konsumenten brauchen Tresor; heutiger Fokus im PLAN. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-11---werkbank-je-projekt-und-bewährte-wege-e1e4).

## 2026-10-11 - v2.0-Schnitt: Hülle + Leitstand, D1 Standard an, Verlauf in v2.1

**Nutzerbeschluss** · Gilt: 11.10., Schnitt E-V2-D1/E-V2-S01C: Hülle/Leitstand v2.0, Verlauf v2.1; Kriterien ersetzt durch [Nachtrag](#2026-10-15---v20-eng-narrow), Classic-Rückweg ersetzt durch [Nachtrag](#2026-10-15---classic-ui-leaves-the-app). · Ende: neuer Nutzerentscheid; verschoben nicht gestrichen; kein Release-Ja. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-11---v20-schnitt-hülle--leitstand-d1-standard-an-verlauf-in-v21).

## 2026-10-15 - v2.0 eng (narrow)

**Nutzerbeschluss** · Gilt: 15.10., Schnitt-Karte E1: Kriterien 7/12/14/15/16, Server-Teil von 6 nach v2.1; 10/17 nach Core; Classic-Rückweg ersetzt durch [Nachtrag](#2026-10-15---classic-ui-leaves-the-app). · Ende: neuer Nutzerentscheid oder notwendiges zurückgeholtes Kriterium samt Paketen; Major frisches Ja. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-15---v20-eng-narrow).

## 2026-10-15 - The user answers seven questions (v2.0 eng)

**Nutzerbeschluss** · Gilt: 15.10., sieben Antworten: PA_SEAM_ALLOW je Root-Auftrag; Zustandsvokabular/Farben, ruhige umstellbare Orbs; fremde Agentenkonfiguration nach Backup, eigene ausgenommen; Navigation 2/5 ersetzt durch [Nachtrag](#2026-10-16---ds-fabrik-ziel-the-whole-app-becomes-an-agent-factory-with-original-pixel-figures) und ersetzt durch [Nachtrag](#2026-10-16---nav-0-six-navigation-areas-three-visible-in-v20-tab-linie). · Ende: neuer Nutzerentscheid; Konfigurationsumkehr aus Backup; Zustimmung beweist keine Umsetzung. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-15---the-user-answers-seven-questions-v20-eng).

## 2026-10-15 - Classic UI leaves the app

**Nutzerbeschluss** · Gilt: 15.10.: Classic entfällt, ein Designsystem-UI; ersetzt D1 Rückweg, Releaseschnitt bleibt. · Ende: nur ausdrückliches neues Nutzer-Ja stellt Classic wieder her. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-15---classic-ui-leaves-the-app).

## 2026-10-15 - Reviewer count per tier

**Nutzerbeschluss** · Gilt: 15.10.: A zwei fremde Familien; B zwei (Abo/OpenRouter), beide nicht Autor; C Gates, C+ eins; Fixdelta eins/zwei bei A; freie nur Zusatz; bestehende Rechte bleiben. · Ende: nur Nutzeränderung, Mangel senkt Abnahme nicht; Routen ersetzt durch [Nachtrag](#2026-10-16---owner-karten-1016-cards-k1-k15-release-amendment-review-route-and-routing), E1 ersetzt durch [Nachtrag](#2026-10-20-e1---subscription-alternative-for-the-second-tier-b-reviewer); Dokumentationsauftrag hat eigene Prüferanweisung. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-15---reviewer-count-per-tier).

## 2026-10-15 - VERBUND option C

**Nutzerbeschluss** · Gilt: 15.10.: VERBUND C eine App, DevHQ nach Leitstand/Betrieb, Denkraum als Eingang; Braucht dich, Datenowner bleiben. · Ende: Ablösung erst Parität, echte Quelldaten/Receipts, Handy-Erfassung; Umkehr bewahrt angenommene Writes. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-15---verbund-option-c).

### V-01 — source and authority contract

**technische Voraussetzung (Vertrag zum Beschluss)** · Gilt: 15.10.: V-01 Owner: Rust/SQLite Runtime, Ledger Ideen, PLAN Planung, pa-orch Jobs; Quelle/Revision/Zeit/Frische; Receipt ist keine Erlaubnis. · Ende: V-02/03 begrenztes Lesen, Writes separat; Retirement erst Parität/Handy/Backup; Remote nur neues Ja; kein Scheduler. · [Quelle](archive/decisions-2026-10/journal.md#v-01--source-and-authority-contract).

## 2026-10-15 - Design-system decisions D1–D7 (Root by delegation, the user may overrule)

**Nutzerbeschluss (delegierte Details)** · Gilt: 15.10., Design D1–D7: Inter/OFL, drei Motion-Modi mit OS Vorrang, Farbe/Aliasse, Orbs; Galerie read-only in jedem Build; Header bei 1440 px. · Ende: Nutzer überstimmt; D5 nach Probehalle prüfen; D6 ersetzt DS-03 dev-only; keine visuelle Abnahme. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-15---design-system-decisions-d1d7-root-by-delegation-the-user-may-overrule).

## 2026-10-15 - RELEASE-PAUSE: no patch release or tag until v2.0

**Nutzerbeschluss (geändert)** · Gilt: 15.10.: absolute RELEASE-PAUSE ersetzt durch [Nachtrag](#2026-10-16---owner-karten-1016-cards-k1-k15-release-amendment-review-route-and-routing) (K5); Patchklassen erlaubt, Minor/Major frisches Ja. · Ende: bis v2.0 oder neuer Beschluss; Versionssnapshot kein Freigabebeleg. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-15---release-pause-no-patch-release-or-tag-until-v20).

## 2026-10-16 - DS-FABRIK-ZIEL: the whole app becomes an agent factory with original pixel figures

**Nutzerbeschluss** · Gilt: 16.10., Design E-1 bis E-3: Fabrik/eigene Pixel-Figuren; Trustfixes vor Probe, Migration erst Ja; MIT Codekunst, keine Fremdpacks/Generatorbilder; D5 offen. · Ende: Ablehnung/Änderung durch Nutzer; IDs stabil; neuerer Fokus im [PLAN](PLAN.md#entscheidungen-18102026-elias); keine neue Designfreigabe. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-16---ds-fabrik-ziel-the-whole-app-becomes-an-agent-factory-with-original-pixel-figures).

## 2026-10-16 - OWNER-KARTEN-1016: cards K1-K15, release amendment, review route and routing

**Nutzerbeschluss** · Gilt: 16.10., Owner K1–K15: keine frühe Queue/Retry/Benchmark; Cleanup begrenzt, Security seriell; DR-16b wartet, RAM Prüfung bleibt, Pacer geparkt, Continuous/resume gesperrt; K5 Patches, K14 Server nach V2-CAP-1, K15 Lizenz vor Testern; weitere Ausnahmen im Volltext. · Ende: neuer Beschluss; Cleanup sauber/Remote-Head/Backupliste; Reviewroute endet 22.10. 09:05 oder früher mit freiem berechtigtem Abo-Reviewer; Saldo unbekannt. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-16---owner-karten-1016-cards-k1-k15-release-amendment-review-route-and-routing).

## 2026-10-16 - NAV-0: six navigation areas, three visible in v2.0, tab "Linie"

**Nutzerbeschluss** · Gilt: 16.10., NAV-0/Navigation E-1: sechs Bereiche, v2.0 zunächst Fabrik/Betrieb/Einstellungen; Linie, nach Probe Halle; Räume nicht beschlossen, IDs stabil. · Ende: Nutzeränderung; weitere Bereiche erst verbunden/hinter Schalter; Umbenennung nach DS-H-07, nicht Datum. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-16---nav-0-six-navigation-areas-three-visible-in-v20-tab-linie).

## 2026-10-20 E1 - subscription alternative for the second tier-B reviewer

**Nutzerbeschluss (bedingte Ausnahme)** · Gilt: 20.10., Review E1: B bei OpenRouter <=0 zwei verschiedene Nicht-Autor-Abo-Familien; freie zählen nie. · Ende: Guthaben kehrt zurück/Nutzer ändert Regel: reguläres Paar; kein aktueller Saldo behauptet. · [Quelle](archive/decisions-2026-10/journal.md#2026-10-20-e1---subscription-alternative-for-the-second-tier-b-reviewer).
