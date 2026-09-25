# PLAN — der eine Arbeitsplan für ProjectA und das DevHQ

Stand: 24.09.2026. Dieses Dokument ersetzt den Sanierungsplan Rev 9 und alle
früheren Plan-, Spec- und Entscheidungspapiere; die liegen unter
`docs/archive/plaene-2026-09/` und sind nur noch Beleg.
Wer hier nichts findet, arbeitet an nichts.

**Drei Dokumente, drei Aufgaben:**

- **Dieses Dokument** hält die Paketdefinitionen der offenen Arbeit, die
  Regeln und das Entscheidungsregister. Neue Pakete entstehen nur hier (oder im
  W5-Plan, siehe unten).
- **Die geordnete Übersicht** aller offenen Pakete mit Status, Lane, Modell
  und Fortschritt steht in [`docs/MASTERPLAN.md`](MASTERPLAN.md).
- **Erledigtes** steht in [`docs/ERLEDIGT.md`](ERLEDIGT.md), neueste zuerst,
  mit PR, Merge-SHA und Report. Ein gemergtes Paket wird hier gestrichen und
  dort eingetragen. Ausnahme: die DEVFLOW-Tabelle behält alle 38 Zeilen, weil
  der Planimport (DF-04) sie liest; erledigte Zeilen tragen dort „Erledigt".

**Baseline:** v1.4.1 ist der jüngste veröffentlichte Release (22.09.2026,
`3bcaed3`). Alles danach liegt auf `main`, ist aber nicht ausgeliefert.

## HQ2 — gemeinsames Dev-HQ und ProjectA (Entscheidung 23.09.2026)

Die Nutzervorgabe ersetzt die bisherige Zurückstellung von Multi-Harness.
Technische Reihenfolge bleibt **F-CORE-3 → F6 → Multi-Harness**; W4-03 wird
dadurch nicht vorgezogen. Rust/SQLite bleibt einzige Autorität für Ausführung,
Policy, Budget und Freigabe. HQ und App verwenden denselben versionierten
Vertrag. Abos sind getrennte, belegte Kapazitäten in einer gemeinsamen
Routing-Oberfläche, keine gemeinsame Token-Währung.

Erledigt (→ `docs/ERLEDIGT.md`): HQ2-00, HQ2-01, HQ2-05a und HQ2-11, alle über
PR #70.

| ID | Paket und Abnahme | Größe / Eigentum | Voraussetzung |
|---|---|---|---|
| HQ2-02 | Abnahme der Konzeptdemo und Studio-Variante (Inhalt über PR #70 auf `main`): Nutzer- und visuelle Browserprüfung vor Übernahme; simulierte Zustände markiert | getrennte Demodateien und Reviewbericht | HQ2-01 ✓ |
| HQ2-03 | Gemeinsame Design-Tokens für Hell/Dunkel, Typografie, Dichte, Fokus und reduzierte Bewegung; App/HQ erhalten jeweils passende Layouts | M, neue Token-Dateien | HQ2-02-Review |
| HQ2-04 | **Alias → DF-10** (Nutzerentscheidung 24.09.: bei Überschneidung gewinnt die DF-ID). Inhalt: Code-Chat-Oberfläche, beratende und aktive Worktree-Sitzung sichtbar trennen; manueller Providerwechsel mit expliziter Übergabe | 0 Punkte, kein Dispatch | — |
| HQ2-05b | Echte Collector-/Billing-Proben je Anbieter, danach Kapazitätsanbindung | getrennte S/M-Pakete | HQ2-05a ✓ |
| HQ2-06 | Harness-Schema und Validierung, geführte Vorlagen plus Expertenfelder | M, Profile/Capabilities-Lane | F-CORE-3-Rest (W1-03e/f) und F6 |
| HQ2-07 | Gemeinsame Session-Bridge und Routing-Policy, erst manuell, dann Auto innerhalb bestehender Budgets | je M, getrennte Rust-Lanes | DF-10 (statt HQ2-04), HQ2-05b, HQ2-06 |
| HQ2-08 | Dev-HQ als installierbarer lokaler App-Host ohne Node/Repo; bisheriges App-Webinterface ablösen, bestehende HQ-Funktionen erhalten, kein LAN-Zugang | serielle M-Pakete für Host, API und UI | HQ2-03/07 |
| HQ2-09 | Projektstart/-koordination, GitHub/Linear-Sync, belegbare Statistiken (Statistik-Anteil bei DF-29–31) und knappe Agenten-Briefings | getrennte M-Pakete nach Integrationsgrenze | HQ2-07/08 |
| HQ2-10 | **Alias → DF-35/36/37** (Nutzerentscheidung 24.09.). Inhalt: Anbieter-Smokes (→ DF-35), UI-/A11y-Abnahme (→ DF-36), Review-Dispositionen und Release-Gates (→ DF-37); der installierte Offline-/Recovery-Build gehört zu HQ2-08 | 0 Punkte, kein Dispatch | — |

Ein Paket, ein Implementer, ein Worktree. HQ2-06 erst nach seinen Gates.
Gleiche Datei und die vier Nahtstellen bleiben seriell. S/M-Grenzen und
Reviewerpflicht aus Abschnitt 0 gelten auch hier. Wie viele gleichzeitig laufen,
regelt `docs/MASTERPLAN.md` („Worker-Struktur"). Keine Demo-Interaktion löst
reale Worker, Ausgaben oder externe Schreibzugriffe aus. Der Nutzer und ein
unabhängiger AI-Reviewer prüfen die tatsächliche Demo; erst danach wird die
visuelle Richtung in App und HQ umgesetzt.

## DEVFLOW — grafischer Entwicklungsablauf (in Ausführung seit 23.09.2026)

Nutzerauftrag: „Starte in diesem Chat mit dem Gesamtprompt“. Anforderung und
Startprompt: [`.pa/prompt_devflow.md`](../.pa/prompt_devflow.md). Keine
Aktivierung von Continuous, keine implizite Release- oder Kostenfreigabe.
Ausführungsstand und Policy: `.pa/report_devflow_execution.md`.

**Erledigt** (→ `docs/ERLEDIGT.md`): DF-00 bis DF-05 vollständig, DF-06a,
DF-07a–c, DF-08a–c (alle über PR #70), DF-09a (PR #100) und DF-15a
(PR #103). Offen sind DF-06b, DF-07d (der Code ist über PR #70 gemergt, der
visuelle PASS fehlt; DF-07 bleibt bis dahin offen, Nutzerentscheidung 24.09.),
DF-08d, der Rest von DF-09 und DF-15 sowie DF-10 bis DF-37.

### Anschluss an HQ2 und die Wellen

DEVFLOW konkretisiert und erweitert HQ2, ersetzt aber keine offenen Gates:
Darstellung → HQ2-03; Chat → HQ2-04 (Alias, liegt bei DF-10); Kapazität → HQ2-05b/07;
Profile → HQ2-06; gemeinsamer Host → HQ2-08; Analyse → HQ2-09 (Statistik-Anteil
bei DF-29–31); Abnahme → HQ2-10 (Alias, liegt bei DF-35/36/37). F-CORE-3 → F6 → Multi-Harness und W2-09b bleiben
Voraussetzungen echter Provider-Ausführung. W4-01 liefert Benchmark-Evidenz;
W4-02/03 bleiben Abnahme und menschliche Continuous-Aktivierung.
Überschneidungen mit HQ2 und W5 sind einem einzigen Paket zugeordnet
(Nutzerentscheidung 24.09.): **bei Überschneidung gewinnt die DF-ID**, die
überlappende HQ2- oder W5-Zeile wird ein Alias ohne Punkte (HQ2-04 → DF-10,
HQ2-10 → DF-35/36/37, W5-08a/08b → DF-18, W5-14 → DF-30). Liste und
Begründung, auch für die geprüften Paare ohne Alias: `docs/MASTERPLAN.md`,
„Aliase". Keine Doppelarbeit.

### Verträge und Zuständigkeiten

Rust/SQLite besitzt Laufzeit, Rechte, Routingentscheidung und Übergänge.
HQ, App und CLI sind Clients desselben versionierten Vertrags. Plan-Markdown
ist die Quelle der geplanten Arbeit; der Runtime-Status referenziert Planrevision
und stabile Paket-ID. Änderungen am Plan benötigen einen nachvollziehbaren Diff;
kein zweiter widersprüchlicher Browserplan und kein Node-Scheduler.

DF-03 hat diese Verträge fixiert (`docs/development/HQ2_CONTRACT.md`):

| Vertrag | Erforderliche Felder / Verhalten |
|---|---|
| PlanPackage | stabile ID, Eltern-ID, Quelle mit Revision, Abhängigkeiten, Priorität mit Begründung, Abnahmekriterien; Zyklen/fehlende IDs als Fehler |
| Run / Stage / Event | Projekt, Paket, Kandidat-Hash, Versuch, Status, Version, Claim/Fence, Idempotency-Key, Zeit und Quelle; optimistische Konflikterkennung |
| ExecutionIdentity | angefordertes und beobachtetes Modell/Familie getrennt, Provider, ausführender Adapter, UI-Profil, Capability-Beleg und Aktualität |
| ReviewEvidence | exakter Kandidat, Autor-Familienmenge, Reviewer-/Tester-Identität, Umfang und Urteil; Änderungen invalidieren betroffene Belege |
| Decision / Policy | Typ, Optionen, benötigte menschliche Entscheidung, Geltungsbereich, Ablauf, Policyrevision, Entscheider, Auditspur |
| Measurement | Einheit, Stichprobe, Zeitraum, Taskklasse, Quelle, Unsicherheit; unbekannt/veraltet/konfiguriert/beobachtet getrennt |
| Capability / Template | Quelle, feste Version, Kompatibilität, Rechte, Installationsscope, Auswahlgrund, tatsächliche Nutzung und Ergebnis |

Die folgenden Eigentumsbereiche sind **Scopes, keine Behauptung bestehender
Dateien**. Jedes Dispatch-Briefing trägt exakte existierende Pfade und geplante
neue Dateien ein. Ein Paket ohne präzise Write-Allowlist startet nicht.

| Scope | Eigentum und Grenze |
|---|---|
| DOC | `docs/PLAN.md`, `.pa/`-Briefings/Berichte; Vertragsänderungen in `docs/development/HQ2_CONTRACT.md`, ADR in `docs/decisions.md` |
| CORE | bestehende Rust-Domainmodule unter `src-tauri/src/`; neue Module nur nach Bestandsabgleich, Tests inline |
| SEAM | `api.rs`, `main.rs`, `store.rs`/Store-Module, `bin/pa.rs`: ein Integrator, seriell; keine parallelen Agenten an diesen Dateien |
| HQ | `docs/dev-hq/concepts/`; vorhandene `studio-workspace.js`, `studio-model.js`, CSS und HTML nur durch jeweiligen Integrator; Fachansichten möglichst getrennte Module |
| HOST | `scripts/hq-live.mjs`, `scripts/lib/hq-studio.mjs` und zugehörige Tests; ausschließlich Host/Proxy/Präferenzen |
| APP | bestehende React-Chat-, Projekt-, Statistik- und Einstellungsflächen unter `src/`; exakte Komponenten vor Dispatch |

### Agentenpakete und Abnahme

Die Tabelle ist die Quelle des Planimports (DF-04) und behält deshalb alle
38 Zeilen; erledigte Zeilen beginnen mit „Erledigt". Jedes Paket hat genau
einen Implementer und einen Worktree. Zielgröße S ≤150, M ≤300 Diffzeilen
einschließlich Tests. Übersteigt ein Paket das Limit, teilt der Koordinator es
**vor Dispatch** in nummerierte Kinder mit eigenem Ergebnis und Abnahme auf;
die Elternzeile wird dann nur Sammelpunkt. Die unten angegebenen M sind
Budgets, keine Behauptung, dass ein ganzes Subsystem in 300 Zeilen fertig wird.
Jede Abnahme gilt zusätzlich zum gemeinsamen Abschlussprotokoll weiter unten.

| ID | Paket / Agent / Scope | Nach | Konkretes Ergebnis und Abnahme |
|---|---|---|---|
| DF-00 | Bestandsabgleich · Architekt · DOC · S | — | Erledigt (PR #70). Live-Git, PR, offene HQ2/W-Gates, vorhandene Implementierungen und Fähigkeiten abgleichen; Pfad-Allowlist und Überlappungsmatrix für alle Pakete, keine doppelte Implementierung. |
| DF-01 | Autonomie-Interview · Koordinator · DOC · S | DF-00 | Erledigt (PR #70). Entscheidungen zu Repo-Schreiben, Commit/Push, Merge/Release, Netzwerk/Installation, Secrets, destruktiven Aktionen, Isolation und Eskalation erfassen. |
| DF-02 | Gemeinsame Desktop-Richtung · design-director · DOC · S | DF-00 | Erledigt (PR #70). Bestehende PC-Ansichten kritisch prüfen, Designvertrag mit Navigationshierarchie, Zuständen, Dichte und Live-Vorschau; Impeccable anwenden, Screenshots als Ausgangsevidenz. |
| DF-03 | Domain-/Eventvertrag · Architekt · DOC · M | DF-00 | Erledigt (PR #70). Obige Verträge mit vorhandenen APIs abgleichen; Übergangstabelle, Fehlerfälle, Migration/Versionsstrategie und App/HQ-Parität festlegen; zwei unabhängige Reviews vor Integration der gemeinsamen Nahtstelle. |
| DF-04 | Planimport · Backend · CORE · M | DF-03 | Erledigt (PR #70, DF-04a/b/c). Markdown-Pakete mit stabilen IDs und Quellenrevision projizieren; Tests für fehlende IDs, Zyklen, geänderte Quelle, Wiederimport ohne Duplikate. |
| DF-05 | Plan-Lesezugriff · Integrator · SEAM/HOST · M | DF-04 | Erledigt (PR #70, DF-05a/b). Gemeinsamen lesenden App/HQ/CLI-Vertrag anbinden; identische Paketdaten und explizite Fehler statt leeren Erfolgs prüfen. |
| DF-06 | Grafische Roadmap · Frontend · HQ · M | DF-02, DF-05 | DF-06a erledigt (PR #70). Offen DF-06b: Ausführungszustände bereit/aktiv/erledigt nach DF-11/DF-16 mit belegter Paket-/Run-Bindung; bis dahin bleibt der Ausführungsstatus unbekannt. Hierarchie, Abhängigkeiten, kritischer Pfad, Quellenklick und Prioritätsgrund mit echtem Plan und leeren/fehlerhaften Daten prüfen. |
| DF-07 | Desktop-Dichte · Frontend · HQ/APP · M | DF-02 | DF-07a–c erledigt (PR #70). Offen DF-07d: visueller PASS der React-Dichte (Code über PR #70 gemergt, `.pa/report_df07d_native_density.md`); DF-07 ist erst danach abgenommen. Komfortabel/Kompakt ändern messbar Zeilenhöhe, Abstand, Paneelgrößen und sichtbare Informationsmenge; Screenshots bei 1280×800 und 1920×1080, Tastatur und Zoom prüfen. |
| DF-08 | Ausführungsidentität · Backend · CORE · M | DF-03 | DF-08a–c erledigt (PR #70). Offen DF-08d: native Modellbeobachtung, Adapter-/Profilbelege, Workflow-Anbindung nach DF-11. Provider, Modell/Familie, Adapter und Erscheinungsprofil getrennt führen; konfiguriert ist nicht beobachtet; Alias-/Unbekannt-Fälle testen. |
| DF-09 | Profilwahl im Chat · Frontend · HQ/APP · M | DF-02, DF-08 | DF-09a erledigt (PR #100, lokale Chat-Erscheinungen). Offen DF-09b: React-Parität und Admission-Kompatibilität. UI-Profil Codex/Claude/DeepSeek unabhängig vom belegten Modell wählen; unterstützte native Kombinationen von reiner Darstellung unterscheiden, inkompatible Starts verweigern. |
| DF-10 | Chat-Modi und Interview · Integrator · CORE/SEAM/HQ/APP · M | DF-01, DF-03, DF-09 | Übernimmt HQ2-04 (beratende und aktive Sitzung getrennt sichtbar, manueller Providerwechsel mit Übergabe). Plan/Interview/aktive Ausführung mit konkreten Rückfragen und Projektkontext; Planmodus darf keine Schreibbefugnis erzeugen. Reale Sitzung mit Antwort belegen; Integration bei Bedarf in Kinder teilen. |
| DF-11 | Workflow-Zustand · Backend · CORE · M | DF-03 | Persistente Stage-Zustände und append-only Übergangsereignisse auf vorhandener Queue; ungültige Übergänge und Neustart testen. |
| DF-12 | Unabhängigkeitsgate · Backend · CORE · M | DF-08, DF-11 | Kandidatenweite Autor-Familienmenge sperrt eigene Review-/Testbewertung, auch nach Handoff/Alias/Review-Fix; unbekannte Identität blockiert Attestation. Negativtests zwingend. |
| DF-13 | Berechtigungsteam · Backend · CORE · M | DF-01, DF-11 | Versionierte, vom Nutzer festgelegte Policy auswerten; erlauben/ablehnen/eskalieren mit Gründen. Keine Selbst-Erweiterung, kein gefälschter Human-Verdict; Replay und Scopewechsel testen. |
| DF-14 | Stationsübergabe · Backend · CORE · M | DF-12, DF-13 | Bestehende Admission/Claims für nächste Station nutzen; atomare Übergabe, Idempotenz, Fencing, Budget aller Nachfahren. Doppelzustellung und Crash vor/nach Spawn testen. |
| DF-15 | Rücklauf und Recovery · Backend · CORE · M | DF-14 | Review→Fix→neuer Review, Pause/Cancel, Quota/Auth-Ausfall, begrenzte Wiederholung und Wiederaufnahme; Leaseablauf nie als Prozessende werten. Der frühe Provider-Exit vor dem Lesen des Task-Inputs ist als DF-15a erledigt (PR #103, Endzustand `exited_undelivered`, Migration 22); die dabei offen gebliebene Freigabe von Reservierung und Delivery ist als DF-15b erledigt (KNOWN_ISSUES KI-27: Reservierung `cancelled` und Delivery-Freigabe journalisiert, atomar im bewiesenen Exit-Commit, ohne neue Migration). |
| DF-16 | Workflow-API · Integrator · SEAM/HOST · M | DF-15 | Start/Pause/Status/Decision über denselben Kern für App/HQ/CLI; Autorisierung, Konflikt und Event-Replay prüfen, kein Scheduler im Host. |
| DF-17 | Team-/Stationsgraph · Frontend · HQ · M | DF-02, DF-16 | Ideen→Interview→Plan→Koordination→Architektur→Code/Design→Review→Test→Kritik mit konfigurierbaren Stationen, Rollen, Zuständen und Übergabegründen; native Teams/Lessons erhalten. |
| DF-18 | Entscheidungs-Inbox · Frontend · HQ/APP · M | DF-16 | Nur echte Nutzerfragen/Freigaben, Kontext/Optionen/Auswirkung, Zielprojekt und Version sichtbar; doppelte/veraltete Entscheidung abweisen und auflösen. |
| DF-19 | Prioritäten und Advisor · Backend · CORE · M | DF-08, DF-12, DF-03 | Taskklasse, Abhängigkeiten, Evidenz, Benchmark/Erfahrung, Quota und Policy in erklärbare Empfehlungen für Priorität/Modell/Effort übersetzen; fehlende Daten und manuelle Overrides testen. |
| DF-20 | Routing-Editor · Frontend · HQ/APP · M | DF-19 | Anbieterreihenfolge, Regeln, Taskklassen, Reserven, Ausschlüsse, Fallbacks und Override editieren; Simulation erklärt Auswahl/Ablehnung, Revision verhindert verlorene Änderungen. |
| DF-21 | Erweiterungskatalog · Backend · CORE · M | DF-03 | GitHub-Quellen zu Plugins/Skills auf feste Revision auflösen, Quelle/Kompatibilität/Rechte/Scope anzeigen; bestehende Installer wiederverwenden, untrusted Metadaten nicht ausführen. |
| DF-22 | Installation und Rücknahme · Backend · CORE · M | DF-13, DF-21 | Kontrollierte Installation, Update, Deaktivierung und Rollback über geprüften Pfad; Traversal/Symlink, abgebrochenen Download und Versionswechsel testen; globale Änderungen nach Policy. |
| DF-23 | Katalog-Bedienung · Frontend · HQ/APP · M | DF-22 | GitHub-Link hinzufügen und ein Klick installieren, soweit Policy erlaubt; sonst begründete Entscheidung. Realer Installationszustand statt bloßer Prompt-Auswahl. |
| DF-24 | Task-Preflight · Backend · CORE · M | DF-14, DF-22 | Vor Task und Scopewechsel erforderliche/hilfreiche Skills/Plugins auswählen; nur relevante laden, Auswahlgrund/Version/tatsächliche Verwendung protokollieren; fehlende Pflichtfähigkeit blockiert. |
| DF-25 | Schneller Entwurfsbereich · Backend · CORE · M | DF-13, DF-03 | Worktree, isolierte Projektdaten und Live-Preview-Lebenszyklus; Start/Stop/Recovery, keine fremden Prozesse beenden. Klar als Arbeitsisolation kennzeichnen. |
| DF-26 | Stärkere Sandbox · Backend · CORE · M | DF-25 | Einen belegbar verfügbaren Container- oder VM-Adapter mit Filesystem-/Netzwerk-/Ressourcengrenzen integrieren; fehlende Voraussetzungen anzeigen, kein stiller schwacher Fallback. |
| DF-27 | Architekturansicht · Frontend · HQ · M | DF-05, DF-25 | Reale Modul-/Abhängigkeitsdaten mit Quellen und Abdeckung visualisieren; Änderungsvorschlag→Diff→Test→Übernahme, unbekannte Analysebereiche sichtbar. |
| DF-28 | Gemeinsames Design-Livebild · Frontend · HQ/APP · M | DF-17, DF-25 | Laufende echte App/Website, gewählter Schritt, Agentendelta und Feedback nebeneinander; Änderungen fortlaufend nachvollziehbar, Wiederverbindung/Fehler testen. |
| DF-29 | Messereignisse · Backend · CORE · M | DF-11, DF-08 | Zyklus-/Wartezeit, Rework, Review/Test, Recovery, Routing und beobachtete Usage mit Quelle erfassen; Deduplikation, Einheit, fehlende Werte, Retention/Redaktion prüfen. |
| DF-30 | Statistikprojektionen · Backend · CORE · M | DF-29, DF-24 | Filterbare Task-/Modell-/Provider-/Skill-Vergleiche, Stichproben und Qualitätsmetriken, API/Export; keine Gleichsetzung von Korrelation und Ursache oder Abo-Quoten. |
| DF-31 | Statistik-Cockpit · Frontend · HQ/APP · M | DF-02, DF-30 | Große Analysefläche mit Trends, Verteilungen, Engpässen, Rework, Teststabilität, Kapazität, Quellen-Drilldown und Einstellungen; echte Daten plus kenntliche Fixture-Tests. |
| DF-32 | Releaseprognose · Backend/Frontend · CORE/HQ · M | DF-06, DF-30 | Kritischen Pfad und beobachteten Durchsatz mit Unsicherheitsintervall verbinden; ohne ausreichende Daten kein Datum. Readiness separat aus offenen Gates, Reviews/Tests und Blockern anzeigen. |
| DF-33 | Vorlagenkatalog · Backend · CORE · M | DF-03 | Versionierte editierbare Templates für Idee/Projekt/Plan/Team/Harness/Review/Test/Policy/Release; Kontextvorschlag mit Vorschau, kein stilles Überschreiben. |
| DF-34 | Vorlagen im Arbeitsfluss · Frontend · HQ/APP · M | DF-10, DF-18, DF-23, DF-33 | Passende Vorlagen an Eingabestellen anbieten; übernehmen/anpassen/verwerfen, Entwürfe bei Navigation erhalten und gleiche Semantik in App/HQ prüfen. |
| DF-35 | Durchgängiger Runtime-Nachweis · Tester · DOC/Tests · M | DF-20, DF-24, DF-26, DF-27, DF-28, DF-31, DF-32, DF-34 | Isoliertes Projekt vom Plan bis zu modellunabhängigem Review/Test; reale Modellantwort, Übergaben, Rückfrage, Neustart und Datenparität messen; negative Gates mitprüfen. |
| DF-36 | PC-Politur und Designabnahme · design-director · HQ/APP · M | DF-35, DF-07 | Impeccable-Kritik anhand echter Screenshots; leere/ladende/fehlerhafte/dichte Ansichten, Fokus, Zoom, Kontrast und Hell/Dunkel prüfen; Befunde nachvollziehbar schließen. |
| DF-37 | Abschluss und Releaseentscheidung · Integrator/Reviewer · DOC · S | DF-36 | Zwei unabhängige Reviews für große/Shared-Seam-Änderungen, Dispositionen, aktuelle Gates und NICHT ABGEDECKT; Readinessbericht. Merge/Release/Continuous nur mit geltender menschlicher Freigabe. |

### Offene Zuschnitte

**DF-06b:** Ausführungszustände bereit/aktiv/erledigt nach DF-11/DF-16 mit
belegter Paket-/Run-Bindung ergänzen. Bis dahin bleibt der Ausführungsstatus
unbekannt; reine Markdown-Abhängigkeiten belegen keine Admission. DF-06 ist
erst nach 06a und 06b abgenommen.

**DF-08d:** Das produktive Register ist leer; konfigurierte Modellnamen sind
keine beobachtete Ausführungsidentität. DF-08c bindet die Herkunft bestätigter
nativer Capture-Abschlüsse an, weiterhin UNKNOWN ohne erfundene
Provider-/Modellbehauptung. Offen: native Modellbeobachtung, Adapter-/Profilbelege
und operative Workflow-Anbindung (nach DF-11). Berichte:
`.pa/report_df08a_identity.md`, `.pa/report_df08b_identity_store.md`,
`.pa/report_df08c_native_observation.md`.

**DF-09b:** React-Parität der Chat-Erscheinungen und Admission-Kompatibilität;
der echte Provider-Rücklauf bleibt Teil der Abnahme von DF-10/DF-36
(`.pa/report_df09a_chat_appearance.md`, „NICHT ABGEDECKT").

### Reihenfolge

Vorbereitung (DF-00 bis DF-03) und das erste sichtbare Ergebnis (DF-04,
DF-05, DF-06a, DF-07a–c, DF-08a–c) sind erledigt; DF-07d wartet auf den
visuellen PASS. Weiter:

1. **Erste echte Kette:** DF-11, dann DF-12→13→14→15→16, dann DF-17/18; eine
   kleine vorhandene Planaufgabe mit echter Antwort, unabhängiger Abnahme und
   Recovery.
2. **Ausbau:** Katalog DF-21→24, Routing DF-19/20, Sandboxes DF-25→28,
   Messung DF-29→32, Vorlagen DF-33/34. Jeweils Abhängigkeiten beachten.
3. **Abnahme:** DF-35→36→37; Funktionalität pro Inkrement liefern, keine
   monatelange Sammeldemo. Keine Kalenderzusage vor Durchsatzmessung.

Gemeinsame HTML-/JS-/React-Einstiegspunkte und SEAM werden auch bei
unabhängigen Fachmodulen seriell integriert. Reviewer brauchen freie Slots.

### Planreview-Disposition (23.09.2026)

Kimi-Dokumentreview: `.pa/review_devflow_plan_kimi.md` (keine Codeabnahme).
HQ-Einstiegspunkte haben eine FIFO-Integrationslane; unabhängige neue Module
dürfen vorarbeiten.
DF-01 wird als unveränderlicher menschlicher Policy-Snapshot mit Digest an
DF-13/22 gebunden. Paketaufteilung/-Zusammenführung braucht explizite Herkunft;
historische Runs/Belege behalten ihre ursprünglichen Paket- und Revisions-IDs.
DF-19 darf vor DF-29 nur belegte importierte Messwerte verwenden oder fehlende
Daten ausweisen; DF-20 muss diesen Zustand in der Simulation sichtbar machen.

Fehlende globale Sandbox-Infrastruktur oder unabhängige Modellfähigkeit wird
als echte Decision-/Capability-Abhängigkeit geführt. Das jeweilige Gate bleibt
offen; andere Pakete dürfen weiterlaufen. „Nicht verfügbar“ ist kein bestandener
Sandbox-/Runtime-Test. Kein Evidenzersatz, keine zusätzlichen API-Kosten und
keine globale Installation zur Umgehung dieser Blocker.

### Dispatch- und Abschlussprotokoll für subagent-driven-development

Vor Start den Skill lesen; seine Hilfsskripte aus dem tatsächlichen Skillpfad
auflösen, nicht als vorhandene Repo-Skripte voraussetzen. Ledger an diesen
Planabschnitt und seine Revision binden; erledigte Kandidaten nicht erneut
dispatchen. Konflikttabelle für gemeinsame Dateien/Verträge vor der ersten
Implementierung erstellen. Kein Agent erhält unbeschränkte Schreibrechte.

Jedes Briefing enthält: Paket-ID und Ziel; Nicht-Ziele; exakte Write-Allowlist;
Abhängigkeiten/Commits; vorhandene Symbole und Quellen; Vertrag/Fixtures;
Abnahmefälle; erforderliche Skills; Budget/Policy; beobachtete Modellfamilie;
Testkommandos; Berichtspfad. Neue Agenten erhalten diesen begrenzten Kontext.
Sie sind nicht allein im Repo und dürfen fremde Änderungen nicht zurücksetzen.

Zyklus: Implementer → unabhängiger Spec-/Code-Reviewer → unabhängige
Testbewertung → Fix bei Befunden → betroffene Nachprüfung → Integrator.
Deterministische Tests darf der Implementer ausführen; das ersetzt keine
unabhängige Testgestaltung/Bewertung. Keine Autor-Modellfamilie darf den eigenen
Kandidaten abnehmen, auch nicht in anderer Sitzung oder anderem Harness.
Ein Reviewer, der Code ändert, wird Autor des neuen Kandidaten. Fehlt ein
nachweislich unabhängiges verfügbares Modell, bleibt das Gate blockiert;
keine zusätzlichen API-Kosten und keine erfundene Unabhängigkeit.

Fertig bedeutet: geprüfter Diff, passende Tests, tatsächliche Runtime-Belege
bei Runtime-Änderungen, inspizierte Screenshots bei visuellen Änderungen,
Reviewdisposition, Commit-/Kandidatenbindung und dokumentierte Restgrenzen.
Die Gate-Liste wird aus `scripts/ci/gates.sh` bezogen, nicht hier dupliziert.
Fehler zuerst untersuchen; Fix-/Retrybudget aus bestehender Policy übernehmen.
Nicht behobene Sicherheits-/Korrektheitsblocker werden nicht als fertig erklärt.
Berichte und Freigabeevidenz dauerhaft in `.pa/` sichern; temporäre
SDD-Artefakte nicht mit produktiven Daten oder fremdem WIP löschen.

**NICHT ABGEDECKT (Planungsstand):** Tatsächliche Modellkombinationen und
Sandboxfähigkeit brauchen Laufzeitbelege; Windows- und Unix-Gates werden je
Paket getrennt belegt.

## W5 — ProjectA-Projekte (freigegeben 24.09.2026)

Welle W5 macht aus ProjectA ein Projekt-System nach dem Vorbild von Cursor
„Projects“: ein Koordinator ohne Schreibpfad, Abonnements, ein
Entscheidungs-Postfach, eine messbare und technisch erzwungene Vertrauensrampe.
Der vollständige Plan mit Invarianten, Paketschnitt (Phasen A–J, W5-00 bis
W5-39) und Nutzerentscheidungen steht in
[`.pa/plan_projects_w5.md`](../.pa/plan_projects_w5.md) (Revision 3, vom Nutzer
am 24.09.2026 freigegeben). Er wird hier nicht kopiert; seine Paket-IDs sind
stabil und gelten wie die Pakete dieses Plans. Aufgenommen am 24.09.2026, nach
dem Merge von PR #70, wie es der W5-Plan vorsah.

- **Kritischer Pfad:** W2-01 ✓ → W2-02 ✓ → W2-04 ✓ → Journal-Teil von W4-03
  (Vorschlag W4-03a, siehe W4 und §5) → Phase A → B → C → D → G → H → J.
- **Erledigt:** W5-00 (PR #95), W5-02b (PR #93), W5-02b2 (PR #102); dazu das
  Folgepaket W5-02b6 (PR #121).
- **Folgepakete aus Reports** (W5-00b, W5-02b3 bis W5-02b5, W5-02b7) und die
  Einordnung aller W5-Pakete in die Lanes: `docs/MASTERPLAN.md`.
- **Überschneidungen mit DEVFLOW** (Nutzerentscheidung 24.09.: die DF-ID
  gewinnt): W5-08a/08b sind Aliase von DF-18, W5-14 ist Alias von DF-30.
  W5-06/06b, W5-12, W5-30b/33 und W5-02d bleiben eigene Pakete, weil ihr
  Inhalt verschieden ist (Begründung: `docs/MASTERPLAN.md`, „Aliase").

---

**Ziel in einem Satz:** ProjectA und das DevHQ sind auf dem PC des Nutzers
voll benutzbar und werden zum Entwickeln von ProjectA selbst eingesetzt;
danach wird der Continuous Mode abgenommen und freigeschaltet.

---

## 0. Regeln

1. **Beweismaßstab** (AGENTS.md): Bug = kompilierender roter Regressionstest,
   dann grün. Gestaltung = angesehener Screenshot. Laufzeit = Messung.
   Provider-/Modell-/Billing-Aussagen nur mit Beobachtung.
2. **Ein Paket = ein Agent = ein Worktree.** Kein Agent bekommt zwei Pakete.
3. **Nahtstellen** (`src-tauri/src/api.rs`, `main.rs`, `store.rs` samt
   `store/`, `bin/pa.rs`): pro Lane ein aktives Paket. Gleiche Datei =
   gleiche Lane, auch außerhalb der Nahtstellen.
4. **Reviews:** Nahtstelle oder Diff > 300 Zeilen = zwei unabhängige
   Reviews; sonst ein Reviewer ≠ Autor. Nur Abos, kein API-Geld. Alltagspaar:
   Kimi K3 (`kimi-k3:cloud`) + GLM 5.2 (`glm-5.2:cloud`) über Ollama Cloud
   mit `.pa/review_transport.py`, ersatzweise `deepseek-v4-flash:cloud`; nie
   die Modellfamilie des Autors. Harte Entscheidungen und Abschlussreviews:
   Advisor-Paar Fable 5.1 + GPT-6 Astra (Regeln in `AGENTS.md`).
5. **Größen:** S = eine Sitzung, ≤ 150 Diff-Zeilen. M = ≤ 300 Diff-Zeilen.
   Kein L; was größer wird, wird geteilt (Teilungsvorschlag steht am Paket).
6. **Mechanik eines Pakets:**
   - Start: `.pa/task_<id>.md` anlegen (`Status: aktiv` in den ersten acht
     Zeilen; Ziel, Dateien, Abnahme aus diesem Plan übernehmen) **und** in
     STAND.md unter „Aktive Specs" eintragen. `npm run specs` erzwingt beides.
     **Folgepakete aus Reports** (die „neu"-Pakete im MASTERPLAN) brauchen
     keine eigene Spec; ihr Report ist die Quelle (Nutzerentscheidung 24.09.).
   - Abschluss: `.pa/report_<id>.md` mit Belegen und Review-Disposition,
     Spec (falls vorhanden) auf `Status: historisch` und aus STAND.md austragen, Paket hier
     und in `docs/MASTERPLAN.md` streichen, Zeile in `docs/ERLEDIGT.md`,
     `scripts/sync.sh note`.
   - Paket-IDs sind stabil. Neue Pakete nur hier oder im W5-Plan, nie in
     einem dritten Plan.
7. **Nicht vergessen:** keine App nur zur Sichtprüfung starten (Queue kann
   Worker auslösen); niemals über eine aktive Sitzung installieren; Exit-Codes
   ungemaskiert; `--no-verify` verboten.

---

## 1. Ausführungswege

| Weg | Belegter Stand | Geeignet für |
|---|---|---|
| **Claude Code** (Abo, CLI-Login) | Claude-Adapter-Smoke vollautomatisch (W2-09, PR #49); kein API-Guthaben (KNOWN_ISSUES KI-22) | Nahtstellen, Sicherheit, Koordination |
| **Codex** (PTY-Launch-Pfad) | vollautomatische Zustellung belegt (`.pa/report_provider_adapter_smoke_codex.md`); Billing-Dialog bleibt manuell | mittelgroßes Rust ohne Nahtstelle |
| **OpenCode** | Zustellung im ProjectA-Worker belegt (W1-02, PR #66), $0,00-Anzeige | Docs, Scripts, HQ-JS |
| **Kimi** (K3) | im ProjectA-Worker vollautomatisch, null Assists (W1-01, PR #50) | Frontend, HQ-UI, Reviews |
| **Ollama Cloud** | Reviewer-Pool (kimi-k3, glm-5.2, deepseek-v4-flash); Helper `ollama-coder`. DeepSeek als Worker erst nach W2-09b | Reviews, Helper |
| **Orca** (Agenten-Steuerprogramm des Nutzers) | steuert Agenten außerhalb von ProjectA | Koordination mehrerer Pakete |

Welcher Weg welches Paket nimmt, steht als Modellregel in `docs/MASTERPLAN.md`.
Nahtstellen-Pakete nur über einen Weg mit belegter automatischer Zustellung
oder unter Aufsicht eines Menschen. Jede Aussage „Weg X hat Paket Y erledigt"
braucht den Report.

---

## 2. Wellen

Lesart einer Zeile: **ID · Titel** · Größe · Dateien/Lane · Abnahme · Weg ·
Abhängigkeit. Hier stehen nur offene Pakete; Erledigtes steht in
`docs/ERLEDIGT.md`, die Folgepakete aus Reports („neu") in
`docs/MASTERPLAN.md`.

### W0 — Nutzer, sofort, ohne Agent

Vollständig erledigt (W0-01 bis W0-07, → `docs/ERLEDIGT.md`).

### W1 — parallel, ohne gegenseitige Abhängigkeit

Erledigt (→ `docs/ERLEDIGT.md`): W1-01, W1-01a, W1-02, W1-03 (C-3), W1-03c/d,
W1-04, W1-05 (Doku-Teil), W1-06, W1-07, W1-08, W1-09, W1-09b, W1-11, W1-13,
W1-14, W1-15, W1-15b, W1-16, W1-18, W1-19 (Kern, PR #39), W1-21, W1-21b,
W1-22, W1-23, W1-23b, W1-24, W1-24b, W1-25, W1-25b, W1-26, W1-26b, W1-26c.
W1-19b ist in CI-02 aufgegangen (Nutzerentscheidung 24.09., `docs/MASTERPLAN.md`).

**Zustellung (NT-17)**

- [ ] **W1-03e F-CORE-3 B.3** · S · `workers.rs:549` · `MSG_USER` erst nach bewiesener Zustellung · Spec `.pa/task_f_core3_delivery.md` · Beleg `.pa/report_w1-03_c3.md`.
- [ ] **W1-03f F-CORE-3 Baustein C** · M · `workers.rs` + `bin/pa.rs` · Zustell-Queue, `pa worker done/blocked`, Antwort-Marker-Verdrahtung · braucht das Z-1-Protokoll am PC · nach W1-03e.

**Dokumentation und Hygiene**

- [ ] **W1-05b Queue-Abnahmerest** · M, in st- und api-Kind teilen · Runtime/Queue/Worker read-only prüfen, sichere Cancel-Regel für `dispatched` (seit W1-16/PR #82 antwortet `cancel` mit 404/409/500, für `dispatched` also 409; die Regel selbst fehlt), danach nur nach bestätigtem Prozessende gezielt bereinigen. Acht bestehende Tasks deduplizieren, kein pauschales erneutes `--apply`. Offline keinen Appstart mit ungeprüfter Queue · Spec `.pa/task_w1-05.md`.

**Frontend, HQ, Accessibility**

- [ ] **W1-10 HQ-Stylesheet** · M · `scripts/contrast-check.mjs` auf `docs/dev-hq/hq.css` ausweiten, Light Mode, `prefers-contrast` · Abnahme: Gate rot → grün, Screenshots hell/dunkel angesehen · Weg: Kimi/OpenCode.
- [ ] **W1-12 Design-Reste** · S · `DiffView.tsx` (Hellmodus rendern und ansehen), Board-Karte (Zustandsformen), `TerminalView.tsx` (xterm-Farben aus der Tokenschicht), Tab-Hover-Beleg · Weg: Kimi · wartet auf die Design-Sitzung.
- [ ] **W1-17 HQ-Parser auf diesen Plan umstellen** · M · `scripts/lib/hq-parse.mjs` (Paket-DAG aus `docs/PLAN.md`-Wellen und IDs statt hartem F0–F8), `docs/dev-hq/hq.js`, Tests; M13 (`Next` zeigt einzige Zeile als `waits`) mit lösen · erst prüfen, ob DF-06a ihn überholt hat · Abnahme: `npm run test:hq`, Screenshot Map/Next · Weg: OpenCode/Kimi.

**Nahtstellen und Übernahme**

- [ ] **W1-20 Zweites Setup reproduzieren** · S · Nutzer + Agent · Node 24, `npm ci`, `npm run dev:setup`, `npm run dev:doctor` grün auf einer zweiten Maschine oder WSL; Report · schließt Matrix-Zeile 1.

### W2 — Continuous Phase 3/4 (Runtime)

Erledigt (→ `docs/ERLEDIGT.md`): W2-01, W2-02, W2-04 (erster Schnitt), W2-04b,
W2-05, W2-07, W2-09. Die Folgepakete aus den Reports (W2-01b bis W2-01d,
W2-02b, W2-04c bis W2-04g, W2-07b) stehen in `docs/MASTERPLAN.md`.

Store-Lane seriell: W2-03 zuerst. W2-06 teilt sich die main.rs-Lane; W2-08a/b,
W2-09b und W2-10 laufen parallel.

- [ ] **W2-03 Usage-/Billing-Collectors je Adapter** · M · Lane store.rs · `store/development_codex_usage.rs`, `budget.rs`; Codex-JSON, Kimi/OpenCode-Statuszeilen; Live-Quota-Provenienz · Abnahme: kein „unavailable" mehr im Kostenbeleg · in Arbeit.
- [ ] **W2-06 Supervisor: Producer-Audit und Runtime-Notifications** · M · `supervisor.rs`, Lane **main.rs** · `startsWorkers` bleibt hinter dem Gate · in Arbeit.
- [ ] **W2-08 Ressourcendruck- und Streaming-Enforcement** · M, geteilt (Koordinator 24.09.) · `pressure`, `process_capture` · **W2-08a** Ressourcendruck- und Streaming-Enforcement, in Arbeit · **W2-08b** Speicher-/CPU-Grenzen je Job und Druck bei der Admission, wartet auf die Nutzerentscheidung zu den Grenzwerten.
- [ ] **W2-09b DeepSeek-V4-Flash-Worker über OpenCode** · M · hooks/capabilities/profile; main.rs nur seriell für die fallible Spawn-Integration · CLI-Probe belegt, PTY-Zustellung und Per-Worker-Config offen · Spec `.pa/task_ollama_worker_adapter.md`.
- [ ] **W2-10 Live-HQ-Views** · M, teilbar in 10a Goals/Teams/Ownership, 10b Routing/Budget, 10c Review/Delivery · `docs/dev-hq/hq.js`, `scripts/hq-live.mjs` · Abnahme: Keyboard- und Screenshot-Belege je Flow · Weg: Kimi/OpenCode.

### W3 — Continuous Phase 5 (Delivery und Installation), PC-nah

Erledigt (→ `docs/ERLEDIGT.md`): W3-05 (Entscheidung Windows-only), W3-06
(native Tests im Gate `native-tests`, PR #75).

- [ ] **W3-01 Globaler DB-Wartungs-/Write-Lock + Drain** · M, zwei Teilpakete · Lane store.rs (Lock) und Lane main.rs (Drain aller interaktiven Sitzungen).
- [ ] **W3-02 Windows-Recovery-Helper** · M · Installer-Transitionen, Journal angebunden („recovery journal module is not yet connected to an installer helper") · Weg: Codex, PC.
- [ ] **W3-03 Paketierte Drills** · S je Drill · Singleton-Handshake (alte Instanz scheitert, Nutzersitzungen überleben), Crash/Power-Loss an jeder Transition, kohärentes Backup vor Installer · Nutzer-PC + Agent-Protokoll.
- [ ] **W3-04 Updater-Zustände in App und HQ** · S · Frontend + `hq.js` an den Helper anschließen; unbefristetes Warten bei aktiven Sitzungen sichtbar.
- [ ] **W3-07 Produktionsschlüssel-Build + Signed-Updater-Relaunch-Beleg** · Nutzer · `scripts/f8-signed-updater.ps1` lokal (Key liegt nur als GitHub-Secret).
- [ ] **W3-08 Paketierter HQ-v1-Beleg** · S · installierter Build antwortet auf `/api/hq/v1/runtime`, Manifest-Digest stimmt.
- [ ] **W3-09 Struktur** (nur wenn W0-05 = zerlegen; inaktiv) · `lib.rs`, `store`-Split in Scheiben ≤ 300 Zeilen · Lanes store.rs/main.rs seriell.

### W4 — Rollout und Freischaltung

- [ ] **W4-01 20-Task-Benchmark** · M · `benchmark/`, `scripts/dev-benchmark.mjs` · Token, Zeit, Rejection, Rework, Regression, Recovery; Ziel −20 % Tokens / −15 % Zeit erst nach dem Qualitätsgate.
- [ ] **W4-02 Abnahmematrix final** · S · jede der 27 Zeilen mit Laufzeitbeleg oder ausdrücklichem Nutzer-Gate.
- [ ] **W4-03a Journal-Teil von W4-03 ohne Aktivierung** (Vorschlag, Schnitt vom Nutzer zu bestätigen, §5) · S · Lane main.rs · die Ereignisquelle (`store/journal_watch.rs`) läuft, ohne dass `continuous.enabled` fällt · Voraussetzung für W5-03.
- [ ] **W4-03 Continuous-Aktivierung** · S · Lane main.rs · `development_policy.rs:224` hinter die Abnahmebelege legen, `continuousExecutionEnabled` als Nutzerentscheidung, Capability-Wahrheit in `main.rs` · **nur nach W4-02 und Freigabe des Nutzers**.
- [ ] **W4-04 Release v1.5.0** · Vertrag: Nutzererweiterung vom 11.09.

---

## 3. Bewusst zurückgestellt (kein Paket)

Wieder aufnehmen nur mit belegtem Bedarf und neuem Eintrag hier.

| Thema | Wann wieder |
|---|---|
| Prompt-Kompression, MCP-Injektion | wenn ein Worker nachweislich am Kontextlimit scheitert |
| Command Palette, globale FTS-Suche, Fokusmodus | wenn Nutzer sie im Alltag vermisst |
| Remote-Board, Multi-Prozess-Deskriptor | bei Neuanschaffung eines Servers |
| Design Studio, Queen/Employee-Neuanlage | nie (gestrichen) |
| Ideen-Pipeline, Zeitachse, Vorschlags-Tab | nach W4, mit Kostenschätzung gegen den Budgetdeckel |
| hermes-agent | nach W3-09 bzw. bei belegtem Bedarf; Multi-Harness ist oben als HQ2-06 aufgenommen |
| Dependabot-Majors (Vite 8 → eslint 10 → TS 7 → React 19 → sqlx 0.9) | einzeln, nach W3-09 |
| Maßnahmen M1–M11 (Arbeitsweise, Archiv `pa/plan_arbeitsweise_optimierung.md`) | nur auf gesondertes Kommando |
| Tauri-Plugins `dialog`, `notification`, `window-state` | wenn ein Paket sie braucht |
| OmniRoute-Cutover cheap → Produktmodus | erst mit gemessenem Kostensieg |

---

## 4. Parallelität

- Wie viele Pakete gleichzeitig laufen, bestimmen die Build-Slots und die
  seriellen Lanes; beides steht in `docs/MASTERPLAN.md` („Worker-Struktur").
  Die frühere Angabe „W1 bis zu 22 gleichzeitige Agenten" ist überholt.
- Nahtstellen-Lanes st, api, mn, pa: je ein aktives Paket.
- W2: Store-Lane seriell (W2-03 zuerst); W2-06 in der main.rs-Lane; W2-08a/b,
  W2-09b, W2-10 parallel.
- Die Zahl der Implementer ist nicht begrenzt (Nutzerentscheidung 24.09.);
  begrenzt sind Cargo-Builds (höchstens drei, RAM) und die seriellen Lanes.
- Ein Paket pro Agent. M-Pakete tragen einen Teilungsvorschlag; teilen ist
  erlaubt, zusammenlegen nicht.
- Review-Pool nach §0.4.

---

## 5. Nutzerentscheidungen (Register)

Entschieden und umgesetzt: Nr. 1–9 (W0-01 bis W0-07, W2-09 Ollama bleibt
Helper, W3-05 Capture-Host Windows-only; Einzelheiten in `docs/ERLEDIGT.md`
und `docs/decisions.md`) und Nr. 13 (F-SEC-4: Opt-in, W1-24/W1-24b, PR #62
und #98; Restrisiko KNOWN_ISSUES KI-29). Branch-Protection auf `main` ist
seit 22.09. gesetzt; `strict` ist seit 24.09. zugunsten der Mergify-Queue aus
(CI-01, PR #108).

Entschieden am 24.09. (umgesetzt in `AGENTS.md` und `docs/MASTERPLAN.md`):
`main` wird über die Mergify-Queue gemergt, Hand-Merge nur durch den
Koordinator als Notfall-Ausnahme, gebunden an den Head-SHA; keine Obergrenze
für die Zahl der Implementer; bei Überschneidung DF/HQ2/W5 gewinnt die DF-ID
(Aliase); DF-07 bleibt offen bis zum visuellen PASS von DF-07d; SETUP-A deckt
SETUP-01/02/03/06/07 (laut PR-Text auch SETUP-10/13); Folgepakete aus Reports ohne eigene Spec; W1-19b ist in
CI-02 aufgegangen.

| # | Entscheidung | Status |
|---|---|---|
| 10 | W3-07 Produktionsschlüssel-Build | offen |
| 11 | W4-03 Continuous-Aktivierung | offen (erst nach W4-02) |
| 12 | Kostendeckel Ideen-Pipeline, M1–M11 | zurückgestellt |
| 14 | Secrets aus der Repo-Ebene in geschützte Environments verlegen; Required Reviewers für `release`/`review` eintragen | offen (Nutzer, Browser) |
| 15 | Release der Arbeit nach v1.4.1 | offen |
| 16 | Schnitt W4-03a: Journal-Teil von W4-03 ohne Aktivierung vorziehen (Voraussetzung W5-03) | offen, Vorschlag |
| 17 | ADR, die die st-Lane für unabhängige `store/`-Module teilt | offen, Vorschlag aus `docs/MASTERPLAN.md` |

---

## 6. Belege und Verträge, die weiter gelten

- `.pa/task_continuous_devhq.md` — vom Nutzer am 10.09. genehmigter Vertrag
  für den Continuous Mode (sechs Phasengates, kein zusätzliches API-Geld).
- `.pa/continuous_acceptance_matrix.md` — Abnahmematrix, 27 Zeilen.
- `.pa/plan_projects_w5.md` — Plan der Welle W5 (freigegeben 24.09.).
- `.pa/report_*.md` — Belege je Paket; `.pa/review_*.md` — Reviews.
- `docs/development/CONTINUOUS.md`, `docs/development/WORKFLOW.md`,
  `docs/development/HQ2_CONTRACT.md` — Verträge und Betriebsregeln.
- Archiv: `docs/archive/plaene-2026-09/` (Sanierungsplan Rev 9, alle
  Superpowers-Pläne und -Specs, `.pa/plan_*`, Design-Brief und -Vertrag,
  STAND.md-Vollfassung vom 15.09.).
