# PLAN — der einzige Plan für ProjectA

Stand: 08.10.2026 10:20 UTC (Chief-Fortschreibung; #643, #644, #641 und #645
sind gemergt; dieser PLAN-Nachtrag benötigt eigene Gates und Root-Abnahme).
Beobachtete main-Basis: `7e3a7af`; Paket-Mergebase `4032800`, nur PLAN geändert.
GitHub-PR-Readbacks und CI `37750580401` (success auf `7e3a7af`) geprüft;
`37750580524` ist CodeQL und kein Beleg der CI-Gates.
Dieses Dokument ist der **einzige** Plan. Andere Plandateien
sind untergeordnete Verträge oder Historie. Neue Arbeit entsteht nur
hier. Wer hier nichts findet, arbeitet an nichts.

> **Für Agenten:** Lies „Für den Nutzer“, die Regeln und die Tabelle deines Ziels.
> Suche dein Paket mit `grep -n "<ID>" docs/PLAN.md`. Der historische Vertrags- und Parserbestand unten bleibt erhalten;
> dort entsteht keine neue Arbeit. Die aktuellen Z-Tabellen sind maßgeblich.

## Für den Nutzer

1. **Erstes Ziel (Z1): der Denkraum wird fertig und kommt mit v1.6.0 heraus.** Er zieht
   als `tools/denkraum/` ins öffentliche ProjectA-Repo, in kleinen Paketen (DR-01 bis
   DR-17, einschließlich DR-01a). Den Release selbst entscheidest du.
2. **Danach (Z2): Setup und Entwicklung reparieren.** Regelwerk 2.0, Denkraum startet von
   selbst, der Taktgeber (Pacer) läuft, Reviews durch fremde Anbieter haben feste Wege,
   schwere Arbeit läuft auf dem Server, Agenten werden nach Verbrauchstempo verteilt.
3. **Z3: der Rest von v1.6.0** (zwei PRs in Prüfung, `main.rs` kleiner machen, Changelog).
4. **Z4: Wichtiges, das liegen geblieben ist** (Schlüssel-Sicherung, Server-Platte,
   Windows-Testfehler, Audit-Reste).
5. **Was du tun musst:** die Entscheidungs-Inbox unten. Dringend: E14 (Sicherung des
   Update-Schlüssels) und V16-F3 (Start nach Update ohne Journal).

Fünf Lanes ziehen parallel (siehe „Lanes“). Die vier Nahtstellen laufen nur seriell.
Schwere Arbeit (Rust-Builds, Reviews, Playwright) läuft auf dem Server.

## Statuswerte

Grundwerte je Paket: **Geplant**, **Bereit**, **In Arbeit**, **In Prüfung**,
**Erledigt**, **Blockiert**, **Verschoben**, **Entfallen**. „Bereit“ heißt: Vorgänger
erfüllt, kein offener PR, keine Dateikollision, Owner und Abnahme stehen fest.
„Angenommen, Mergify ausstehend“ und „Entwurf“ gehören zu „In Prüfung“;
„wartet“ gehört zu „Blockiert“. Angenommen heißt noch nicht gemergt.

Stufe A/B/C nach AGENTS.md Regel 5. Ort: **PC**, **Server** oder **egal**.
Jedes Paket ≤ 300 geänderte Zeilen einschließlich Tests und Hilfsdateien.

## Z1 — Denkraum release-fertig für v1.6.0

Abnahme Z1 (alles muss belegt sein):

- P1-Store angenommen (DR-02 bis DR-07 gemergt, Gates grün).
- Vollständige P2-Oberfläche mit Kategorie, Prioritäts-/Stationsfilter und Sortierung
  (DR-08 bis DR-14), einschließlich R1-Fix (`app.js:349`, Neuaufbau beim Polling) mit
  rotem Test zuerst.
- P3-Live-Schaltung mit Schreibpause, Sicherung und metadatensicherem Rückweg (DR-16).
  Rückweg = vollständige Pause, P1-Store und aktuelles Ledger bleiben; nie ein älteres
  Ledger nach angenommenen Schreibvorgängen zurückspielen.
- Start ohne manuelle Secret-Eingabe (DR-15).
- Alles gemergt mit grünen Gates und den Reviews der Stufe.
- Anleitung in 5 Schritten und Changelog-Eintrag (DR-17).
- Der Release v1.6.0 ist Elias’ Entscheidung (V16-RELEASE).

Root-Entscheide 07.10. 23:13 UTC: **D1** verhaltensgleicher Modul-Split, keine
Größenausnahme. **D2** keine interne Agenten-ID im öffentlichen Code oder in Tests;
`DECISION_DESK_ROOT_AGENT_ID` per ENV/Startparameter, fail-closed; Umsetzung in DR-06.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DR-01 | Gerüst `tools/denkraum/`, Gate-Zeile in `scripts/ci/gates.sh`, Hygiene-Check (LF-Regel in `.gitattributes`, kein State-Pfad im Repo) | Seniorentwickler | – | PC | B | Erledigt: #635 `e9f8ce8` durch Mergify am 08.10. 06:44:21 UTC gemergt (`0b56f1a`); keine erneute Source-Abnahme | `bash scripts/ci/gates.sh lane prepush` Exit 0; neue Gate-Zeile läuft die Denkraum-Tests | 55ea21ce |
| DR-01a | Überlauf im Hygiene-Check beheben, roter Test zuerst; vor DR-02 mergen | Seniorentwickler | DR-01 | Server | A | Erledigt: #637 `a2dbf09` durch Mergify am 08.10. 07:56:31 UTC gemergt (`8f7c499`); Queue 655 / CI 37745165188 mit echtem Windows-PASS | Überlauf-Test vor Fix rot, danach grün; eigene prepush Exit 0; zwei unabhängige Vendor-Belege samt Disposition; Merge vor DR-02 | 55ea21ce |
| DR-02 | Ledger-Modell als Modul, Split-Beweis (verhaltensgleich) | Seniorentwickler | DR-01, DR-01a | Server | A | Erledigt: #636 `4ef2ac2` durch Mergify am 08.10. 08:33:02 UTC gemergt (`7e3a7af`); Batch 659 / CI 37748898151 volle Windows-, Linux- und red-first-Gates grün; DR-03 folgt | FIT-Abnahme; bestehende Store-Tests unverändert grün; jede Datei ≤ 300 Zeilen; prepush Exit 0; DR-01a vor DR-02 gemergt | 55ea21ce, b0e90b72 |
| DR-03 | DeskStore-Kern; P1/Z1 nach integriertem Ledger-Modell | Seniorentwickler-Profil, ein nativer Ausführungsowner `qfytpd`; Chief disponiert | DR-02 gemergt; eigene Goal-/Laufzeitbelege, frische Guards | eigener Worktree; schwere Gates Server | A | Erledigt: #661 `c80456a` am 08.10. 14:22:17Z durch Mergify gemergt (`3003748`); F01 und reale DR-04-Komposition bleiben offen | Store-Tests grün, Revision/Konflikt verlieren keine Daten; Folgepunkte aus DR-02: Längenlimit für Ledger-Listen, Antwort-Elemente prüfen (DeskError statt TypeError); eigene prepush und zwei Fremdvendor-Reviews am Kandidaten, Root-Abnahme | ee12d457, 8fa3ef8e, 55ea21ce |
| DR-04 | Antworten, Quittungen, Benachrichtigungen; getrennte Schnitte DR-04a und DR-04b | bestehender DR-03-Ausführungsowner qfytpd; Root disponiert | freigegebener DR-03-Stack `c80456a`, danach DR-04a → DR-04b | PC; Gates Server | A | #666 `1e11bb8` Ready; #669 `dc34cae` Draft, zwei Fremdvendor-Approvals/Root-Abnahme laut Root und PR; Restbefund nach DR-04B-FU; Merge/Komposition getrennt | Tests für Antwort/Quittung/Dedupe grün; Quittungs-Wiederholung und v1-Ack laufen über die D2-Prüfung (Test) | 55ea21ce |
| DR-04a | Antworten, Quittungen und Root-gebundene Acks | bestehender qfytpd; kein zweiter Owner | DR-03-Stack `c80456a` | PC; Gates Server | A | Ready #666 `1e11bb8`, 219 ALL; OpenAI + Google approve und review-ok laut Root, Ready aktuell beobachtet; kein Merge-/Integrationsbeleg | eigene prepush, zwei Fremdvendor-Belege am Kandidaten, Disposition und Root-Abnahme; D2-Ack fail-closed und 503 bei progressTransition | cffccf40 |
| DR-04b | Pending, Inbox und Delivery in den Store übernehmen | bestehender qfytpd; kein zweiter Owner | DR-04a-Stack `1e11bb8` | PC; Gates Server | A | Draft #669 `dc34cae`; OpenAI + Google am Head und Root-Abnahme im PR; R669-O1-Rest/R669-G1 als DR-04B-FU, kein Blocker; Root richtet Base/Ready erst nach Vorgänger-Merge | ≤ 300 ALL; vollständige P1-Komposition, eigene prepush, zwei Fremdvendor-Belege mit Disposition und Root-Abnahme | a27e7eb0 |
| DR-04B-FU | In `tools/denkraum/store/delivery.mjs::flushNotifications()` Root-Prüfung vor Transport-Prüfung: V2 ohne Root/Transport antwortet 503 statt `not-configured` | bestehende Denkraum-Lane qfytpd; alternativ Root-Serverjob nach eindeutiger Zuweisung, kein Doppelstart | #669 gemergt; unabhängiger Schnitt von Root am 08.10. 20:45Z vorgezogen; Basis `fc85e3d` | Server | A | Startvertrag im Reserve-Abschnitt; kein Dispatch; R669-O1-Rest (OpenAI medium) / R669-G1 (Google low) von Root als Follow-up disponiert, kein #669-Blocker | ≤ 50 ALL; kompilierender roter Test in `delivery.test.mjs`: rootloser V2-Store ohne Transport → 503, kein Write/Send; V1-Vertrag erhalten; grün, eigene prepush, zwei Fremdvendor-Reviews am Kandidaten mit Disposition und Root-Abnahme | a27e7eb0 |
| DR-04c | Fehlende P1-Operationen putQuestion/putIdea/putPatch/putProgress verhaltensgleich auf DeliveryStore zusammensetzen; progressTransition an #progress, store.mjs-Reexport | bestehender qfytpd, Root-Option A/D1 | DR-04b-Stack `dc34cae` | eigener Worktree; Gates Server | A | Drafts #671 `5d31ef5` / #674 `39bc839`; zwei Fremdvendor-Approvals laut Root, aktuelle Heads geprüft; Base/Ready nach Vorgänger-Merge bei Root, Integration separat | P1 `store.mjs@592b309d` Zeilen 264–382/392–415 erhalten; kompilierendes Rot, eigene prepush, zwei Fremdvendor-Reviews/Disposition, Root-Abnahme | 1671ee11 |
| DR-05 | P1-Tests der Ideen-Metadaten (Kategorie ≤ 80 UTF-16, `userPriority`), vollständiger Testimport gemäß G1 α | Seniorentwickler | DR-06b (Store, Delivery, Server und CLI benötigt) | Server | C bei reinem Testdiff; sonst B, höhere Risiken nach Regel 5 | Geplant | Alle 16 Tests grün, P1-SHA-Mapping; Grenzfälle rot vor Fix; eigener vollständiger prepush Exit 0 | 55ea21ce |
| DR-06 | HTTP-Server + CLI, State-Pfad außerhalb des Repos; D2: `DECISION_DESK_ROOT_AGENT_ID` per ENV/Startparameter, fail-closed | bestehender qfytpd; Root disponiert | DR-04c; getrennte Lieferung DR-06a → DR-06b | PC; Gates Server | A | Server und CLI getrennt als Drafts #676/#681 geliefert; #676 zwei Fremdvendor-Approvals laut Root; #681-Abnahme und Stack-Integration getrennt | Tests: ohne State-Pfad oder Root-Agent-ID Start verweigert; Pfad im Repo abgelehnt; fehlende Root-Agent-ID im HTTP-Pfad → 503; keine interne ID im Code/Test | 672767c8, 55ea21ce |
| DR-06a | P1-Server mit D2/H2; externen physischen State-Pfad und Root-ID fail-closed prüfen | bestehender qfytpd | DR-04c | eigener Worktree; Gates Server | A | Draft #676 `3cf949b`; zwei Fremdvendor-Approvals laut Root am aktuell geprüften Head; Root disponiert Base/Ready nach Vorgänger-Merge; kein Integrationsbeleg | kompilierendes Rot, eigene prepush/zwei Fremdreviews; `/api/state.rootAgentId` nur bei tatsächlichem Frontend-Leser, sonst D2-Meta-Tag erhalten | c044dc2b |
| DR-06b | P1-CLI verhaltensgleich nach Server übernehmen | bestehender Root-Serverjob, Claude Sonnet laut Root; qfytpd nur Fixrunde | DR-06a | Server | A | Draft #681 `72715ec`; eigene Lieferung beobachtet, Runtime-Modell und vollständige Abnahme getrennt | kompilierendes Rot, originale CLI-Verträge erhalten, eigene prepush/zwei Fremdreviews mit Disposition und Root-Abnahme | e4ad8296 |
| DR-07 | Tests: API, Patches, Fortschritt, freie Antwort, Fragen-Import; ergänzende P1-Ports getrennt | bestehende Denkraum-Lane qfytpd; Root dispatcht/nimmt ab | DR-06b/#681 gemergt `85ab286` | Server | C, Root kann B verlangen | In Prüfung: #731 (07a), #732 (07b); folgende vier Verträge vorbereitet, kein neuer Start | Testsuite grün im Gate; P1-Digest/Test-Mapping und D2-Delta; eigene volle prepush; keine Scratch-/Gesamt-Abnahme ableiten | 55ea21ce |
| DR-07c | P1-Sender-Tests portieren; HTTP-Verhalten gegen aktuellen Repo-Server belegen | bestehende Denkraum-Lane qfytpd nach Root-Zuweisung | #681 gemergt; Basis `85ab286`; unabhängig von 07d/e1/e2 | Server | C bei reinem Testport; Root kann B verlangen | Startvertrag unten, noch kein Branch/Commit/Dispatch | nur sender.test.mjs; gemeldete 214 ALL/12 Tests; ≤ 300 tatsächlich; P1/D2-Mapping, Node/Suite/prepush grün, Root-Abnahme | 55ea21ce |
| DR-07d | P1-Prioritäts-Tests portieren; ergänzt DR-05 | bestehende Denkraum-Lane qfytpd nach Root-Zuweisung | #681 gemergt; Basis `85ab286`; DR-05-Verknüpfung kein neuer Dateivorgänger | Server | C bei reinem Testport; Root kann B verlangen | Startvertrag unten, noch kein Branch/Commit/Dispatch | nur priority.test.mjs; gemeldete 110 ALL/6 Tests; ≤ 300 tatsächlich; P1/D2-Mapping, Node/Suite/prepush grün, Root-Abnahme | 55ea21ce |
| DR-07e1 | P1-Store-Receipt-/Recovery-Tests vollständig portieren | bestehende Denkraum-Lane qfytpd nach Root-Zuweisung | #681 gemergt; Basis `85ab286`; unabhängig von e2 | Server | C bei reinem Testport; Befund neu einstufen | Startvertrag unten, noch kein Branch/Commit/Dispatch | nur store-receipts.test.mjs; gemeldete 169 ALL/10 Tests; ≤ 300 tatsächlich; eingefrorenes P1 1–34 + 35–169, Node/Suite/prepush grün | 55ea21ce |
| DR-07e2 | P1-Store-Antwort-/Migrations-Tests vollständig portieren | bestehende Denkraum-Lane qfytpd nach Root-Zuweisung | #681 gemergt; Basis `85ab286`; unabhängig von e1 | Server | C bei reinem Testport; Befund neu einstufen | Startvertrag unten, noch kein Branch/Commit/Dispatch | nur store-answers-migration.test.mjs; gemeldete 224 ALL/18 Tests; ≤ 300 tatsächlich; eingefrorenes P1 1–34 + 170–359, Child-Source unverändert, Node/Suite/prepush grün | 55ea21ce |
| DR-08 | UI-Hülle `index.html` + Style, byte-genau auf Stand B1 | UX-Architekt | FIT vorbereitet, Root-FIT-Abnahme; DR-01 | egal | B | Erledigt: #640 `2c57bd3` durch Mergify am 08.10. 08:09:51 UTC gemergt (`cd64c1c`); benutzbare Gesamtlösung weiter offen | Byte-Vergleich mit B1-Kandidat; prepush Exit 0 | 55ea21ce, 6713479b |
| DR-09 | App-Teil Fragen (B1 `app.js` Zeilen 1–238, byte-genau) | Implementierer · Codex | DR-01 | Server | B | Blockiert: Source #638 `b972766` abgenommen; Queue 656 / CI 37745186568 scheiterte im echten Windows-Fixture-Test; DR-09-WIN vor erneuter Admission, kein blinder Retry | Fragen-Ablauf wie B1, Harness grün | 55ea21ce |
| DR-09-WIN | P1/Z1: Windows-Fixture schließt Ressourcen nachvollziehbar vor temporärer Verzeichnisentfernung; sicherer Queue-Beleg statt Zeitfenster-Vergrößerung | bestehender DR-01a-Owner; Chief disponiert, Root nimmt ab | Queue-656-Befund; frische Guards, Windows-Ort und freier Build-Slot | PC / vorhandener Windows-Ort | A | In Prüfung: Draft #660 `3dc6e29`, 57 ALL, Push-SHA bestätigt; Windows-RED 101, Fixgrün/21 Fragen-Tests und red-first 0; eigene Windows-prepush 22 Gates/390 s Exit 0; eigenes begrenztes Handovergoal COMPLETE berichtet; Anthropic-R1 APPROVE mit A1 Low/Abdeckungsgrenzen, Google-Ergebnis und Root-Abnahme offen; B/C tatsächlich freigegeben | ≤ 300 ALL; kompilierendes deterministisches Rot auf Basis und Grün am Kandidaten; originaler Cleanup-Test und eigene prepush Exit 0 auf Windows; zwei Fremdvendor-Reviews am Head; Root vor Ready, Mergify; historischer Lockhalter ungeklärt | 1d708b0f, a6677e75, 8fa3ef8e, 55ea21ce |
| ARCH-D7-WIN | P1/Z1: tatsächlichen nativen Receipt-Fehler getrennt diagnostizieren und kontrolliert rot belegen; verlässliche Queue-Integration für #632 | bestehender DR-15a-Owner; Chief disponiert, Root nimmt ab | CI 37746602240 / Windowsjob 113209450490; Store-Lane frei, schwere Läufe nach DR-09-WIN | vorhandener Windows-Ort | A | In Arbeit: erster nativer Windows-Lauf 1 PASS; Channel-Gegenfall am `f1555662`-Sourcehash kompiliert/grün 1 PASS für frühe und absichtlich späte Verarbeitung, Originalreceipt geprüft; spätes DB-Commit bei failedsettlement und zurückgewiesenem Ack belegt; kein Runtimebug-RED/historischer Ursachen-/Fixbeleg; Native-Goal mangels Resume-Funktion ehrlich BLOCKED | ≤ 300 ALL; Host-/SQLite-/Writer-Zeitpunkte kausal unterscheiden, deterministischer kompilierender Rotnachweis; tatsächliche Windows-Prüfung und eigene prepush am Fix-Head; zwei Fremdvendor-Reviews und Root vor Ready; keine pauschalen Zeitfenster-/Retry-Erhöhungen | c4d05a97, 782d9e58 |
| DR-10 | App-Teil Ideen + Werkbank auf Stand B1 | Root-Job `srv-dr-10-opus`; kein zweiter UI-Owner | DR-09-Stack `b972766`; Verdrahtung getrennt als DR-10-WIRE | Server | B | Draft #665 `ee8c131`, 286 ALL; Google-Fremdreview offen; `index.html` fehlt auf der Stack-Basis, keine vollständige UI-Integration | Ideen-Ablauf wie B1, Harness grün; eigene prepush, Fremdreview/Disposition und Root-Abnahme; DR-10-WIRE separat | 08342807, 5945accc |
| DR-10-WIRE | `ideas.js` in die vorhandene UI-Hülle verdrahten; nur `tools/denkraum/index.html` plus notwendiger begrenzter Test | UI/UX auf Claude Opus 5.5 (1M) xhigh; Chief weist einen Owner zu | #638 und #665 gemergt; danach exakter main-SHA | eigener Worktree | B | Blockiert bis beide Merges; kleiner separater Schnitt ≤ 300 ALL, kein Doppelstart von DR-10 | rote Verdrahtungsregression vor Fix; Ideen-Harness und inspiziertes Laufzeitbild, eigene prepush/Fremdreview/Disposition, Root-Abnahme | 4e0b5b37 |
| DR-11 | UI-Harness auf `@playwright/test` portieren (nur relative Pfade), permanenter D4-Fall | UX-Architekt | DR-10 | Server | C bei reinem Testdiff; höhere Risiken nach Regel 5 | Geplant | B1-Harness und D4-Test: fehlende/leere Root-ID sperrt alle POST-Aktionen mit Grundtext und ohne Writes; Harness läuft im Gate auf dem Server | 55ea21ce |
| DR-12 | B2 Kategorie inkl. Pflicht-Fix R1 (Polling baut `<select>` neu, `app.js:349`), roter Test zuerst | UX-Architekt | DR-11 (Kategorie- und R1-Tests benötigen dessen Harness) | egal | B | Geplant | roter Test vor Fix, danach grün; unveränderte Optionen behalten ihre Nodes und Auswahl über 15-s-Poll; Textfeld-Rand mit Kontrast ≥ 3:1 (Folgepunkt aus DR-08) | 98fa8267 |
| DR-13 | Filter Priorität und Station | UX-Architekt | DR-12 | Server | B | Geplant | Filtertests grün | 98fa8267 |
| DR-14 | Stabile Sortierung | UX-Architekt | DR-13 | Server | B | Geplant | Sortiertests grün | 98fa8267 |
| DR-15 | Sicherer Start ohne manuelle Secret-Eingabe; 15a Basismodul und CLI-Korrektur getrennt, 15b Einbindung nach DR-06 (Secrets über den Secret-Manager von AgentsRoom) | Implementierer · Codex | DR-15a-BASE, DR-15a-CLI (15b: DR-06) | Server | A | In Prüfung: G1-Teilung tatsächlich geliefert, #647 und #639 gemergt; begrenzte 15a-Source gemeinsam integriert, 15b und gesamte Start-/Nutzerabnahme offen | Basismodul und korrigierter CLI-Aufruf zusammen integriert; Start ohne Eingabe; kein Secret in Datei/Log/Commit; physische STATE-Pfadprüfung bleibt 15b | 55ea21ce |
| DR-15a-BASE | Z1: exakt geprüftes Startmodul `5f501f1` erhalten; lexikalische Prüfung ohne Dateisystemauflösung | vorhandener Implementierer · Codex | DR-01; gemeinsame Abnahme mit DR-15a-CLI | Server | A | Erledigt: #647 `5f501f1` durch Mergify am 08.10. 07:26:49 UTC gemergt (`cd3bffa`); Lieferung zusammen mit CLI, DR-15b offen | unveränderter Head `5f501f1`, alter eigener prepush 22/188s Exit 0 und Reviewbelege erhalten; Draft auf #635; Lieferung erst mit CLI-Korrektur erfüllt | 868dbc83 |
| DR-15a-CLI | Z1: vorhandenen Alias-Entry-Fix getrennt abnehmen; bestehende Commits erhalten, keine Wiederholung | derselbe Implementierer · Codex | DR-15a-BASE | Server | A | Erledigt: #639 `3bf5a8b` durch Mergify am 08.10. 08:09:55 UTC gemergt (`7ac5985`); kombinierte Source-Abnahme erhalten, DR-15b offen | #639 auf Baseline retargetet, gleicher Head; Symlink/Junction und Node-24.0-Einstieg benannt rot→grün; eigener prepush am neuen Head Exit 0; Node >= 24 erhalten; zwei Vendoren außerhalb OpenAI am neuen Delta und Root-Abnahme | f1a2ade9 |
| DR-15b | Startintegration nach Server; bestehendes Startmodul/Entry aus 15a, konkreten Dateischnitt vor Dispatch pinnen | Chief weist einen Codex-Owner zu | DR-06a und integrierte DR-15a-BASE/CLI | eigener Worktree | A | Pending; ≤ 300 ALL, sonst teilen; keine Wiederholung erledigter 15a-Arbeit | loadStartConfig bei fehlender ROOT_AGENT_ID an 06a angleichen: Start verweigern statt nur Benachrichtigungen abschalten; physischer externer STATE-Pfad/H2 und Secret-Manager-Vertrag erhalten; Rot, eigene prepush/zwei Fremdreviews | a463151a |
| DR-16 | P3-Live-Schaltung: Schreibpause, Sicherung, metadatensicherer Rückweg | Stabschef | DR-07, DR-14, DR-15 | PC | A | Geplant | Drill: Pause → Sicherung → Umschalten → Rückweg ohne Datenverlust, protokolliert | b0e90b72 |
| DR-17 | Öffentliche README, Anleitung in 5 Schritten, CHANGELOG-Abschnitt Denkraum | Technischer Autor | DR-16 | egal | C | Geplant | Trockenlauf der 5 Schritte im PR-Text | 55ea21ce |

Historischer Fehlerabgleich 08.10. 08:24 UTC auf `013513b`: #631 bereits gemergt;
die späteren Merges oben haben eigene Zeitbelege. #632 Source angenommen, aber nach Batch 658
mit separatem nativen Receipt-Fehler dequeued. Queue-656-Windows-Log unverändert gesichert (459476 Bytes, SHA256
`bafcfc1e90a0d6b124292d40833789a53808a333310e938ccbf46525d6889f4b`).
Auslöser: SharingViolation 32, `questions.rs:651`; bisheriger Zustand: Source
#638 akzeptiert, echte Windows-Integration fehlgeschlagen. Anpassung: eigener
enger DR-09-WIN-Schnitt, Original-Source/Reviewbelege bleiben erhalten. Offen:
kontrollierter Rotnachweis, Mechanismus, Windows-Gates, Fremdreviews, Root-Abnahme
und Queue-Integration. Nächster Schritt/Eigentümer: DR-01a-Owner liefert nach
bestätigtem Rot→Grün die volle prepush- und Draft-Rückgabe. Pilot DEV-KNOW-01 bleibt parallel leicht und nachrangig bei
einem einzigen bestehenden Messowner; Chief hält PLAN-Publikation und Übergabe.
Keine Prozessarbeit reserviert dafür einen zweiten Z1-Build-Slot.
Batch 658 bleibt getrennt: Rust 1922 PASS / 19 skip, nativ 9 PASS / 1 FAIL;
Hostreturn 5,3108033 s, Receipt 5,771698 s, Owner nicht mehr wartend.
Originaljoblog 464284 Bytes / SHA256
`26e08a88bce6fb6d2d43b8c79f117b9cdfe88f020d71cb012250413ee13814e0`.
ARCH-D7-WIN: erster nativer Lauf 09:57:53–10:02:06 UTC ist geprüft, Kompilierung/
Hostselbsttest Exit 0, kontrollierter rechtzeitiger Fall 1 PASS. Rollback 4,6226584 s,
Receipt 4,7320788 s, Ack 4,7320891 s vor Hostende 4,7410857 s. Kein lokaler RED,
historischer Ursachen- oder Fixbeleg. Derselbe Owner hat einen Channel-Gegenfall
vorbereitet (112 ALL, ein Testpfad): absichtlich spätes Receipt nach tatsächlichem
Hostende gegen frühe Kontrolle; keine Sleep-/Budget-/Produktassertionsänderung.
Chief gab den einen vorhandenen nativen Runner nach tatsächlichem PLAN-Laufende
und frischen Guards frei. Neuer Test hatte zunächst einen Compilerfehler E0599
(kein semantischer RED); konkreter Testausdruck korrigiert, danach Kompilierung 0
und Paartest 1 PASS. Frühe Kontrolle beendet den Host erfolgreich; absichtlich
spätes Receipt wurde nach Hostende 5,6401899 s erfolgreich gespeichert, Ack abgelehnt.
Das belegt die fehlende Zeitpremisse, keine historische Ursache oder Produktionsreparatur.
Alte Endstatusdiagnose `5de5c4c9` bleibt separat offen.
Fortschreibung 08.10. 09:02 UTC: DR-02 tatsächlich gemergt, aktuelles `origin/main`
`7e3a7af`; main-CI 37750580401 SUCCESS (früher irrtümlich CodeQL 37750580524 genannt).
DR-03 startet nativ aus dem vorhandenen
Profil auf sauberer Basis; Quota-Anpassung nur je Ticket (Claude-Prognose 67 %, Codex 214 %).
Annahme, Tests, Reviews und Abnahme bleiben unverändert. PLAN-Fortschreibung ist
vorbereitet; neue vollständige Gates, Veröffentlichung und Root-Rückgabe offen.

Fortschreibung 08.10. 09:58 UTC: Auslöser sind die geprüften Draft-Handover #660/#661
und tatsächliche B/C-Freigabe. Vorher waren Gates, Drafts und Slot-Ende offen;
jetzt folgen die Fremdreview-Dispositionen parallel zur seriellen Receipt-Diagnose.
#660 hat eine tatsächliche Anthropic-Stimme, #661 eine tatsächliche OpenAI-Stimme;
Google ist nativ zugewiesen, Laufzeitmodell und zwei Einzelverdicts noch unbelegt.
Der vorbereitete weitere OpenAI-R1 wird wegen des gelieferten Root-R1 nicht gestartet.
DR-03 F01 bleibt einschließlich ursprünglicher Abnahme offen; Indexierung oder ein
isolierter Scanmesswert ersetzt das Limit nicht. Der dokumentierte nohup/setsid-Verstoß
bleibt erhalten, erfolgreiche Gates werden nicht deshalb wiederholt; Folgeausführung
nativ. Chief bestätigt sein neues begrenztes Z1-Koordinationsgoal nativ ACTIVE
(08.10. 09:36:16 UTC); Review-Handover, Receipt-Belege und PLAN-Publikation sind dessen
offene Meilensteine, Root-Abnahme/Ready/Queue bleiben getrennt.

Größe vor dem Start messen: `store.mjs` (570), `app.js` (504/527) und `store.test.mjs`
(358) überschreiten je 300 Zeilen; D1 erzwingt deshalb den Split.

## Z2 — Setup und Entwicklung

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| Z2-PLAN-COMMIT | P2: v3 in kohärenten Paketen übernehmen; PLAN-C1 stellt Z1–Z4 vor den unveränderten historischen Parserbestand, danach getrennte Archiv-/Bereinigungsschnitte ≤ 300 ALL | Stabschef | Root-Abnahme je Kandidat | egal | C | In Prüfung: PLAN-C1 #643 `1088909` tatsächlich 05:46:58 UTC gemergt; #642 bleibt historischer Entwurf, #646 ist bestehender Statusnachtrag; weitere Archiv-/Bereinigungsschnitte offen | ein kanonischer Plan; DF-Zeilen bytegleich; M1–M5 parsebar; eigene prepush-Lane Exit 0; Archiv erst nach vollständigem Quellenvergleich bereinigen | 55ea21ce |
| MAIN-PROTECT-01 | P0 Sicherheit: geltenden Main-Mergevertrag mit effektivem GitHub-Schutz verankern; tatsächliche Wirkung abgenommen | vorhandener Git-/CI-Owner; Chief disponiert, Root nimmt ab | frische Schutz-/App-/Produkt-/Queuebelege; konkrete Root-Abnahme je Handlung; getrennt von GOALS-B | PC | A | Erledigt: Root-Finalabnahme 06:53:57 UTC; Rulesets A `24699347` und B `24700455` ACTIVE/exakt main, vier App-Checks ohne Checkbypass in A, nur App `10562` Update-Bypass in B; Chief-REST-Readback 10:20 bestätigt Konfiguration, Root-Beleg enthält tatsächliche geschützte Queue #635; keine erneute Produktivaktion | vor jeder Einstellung leere Queue und echte Akteur-/Label-/Dispatch-Pause; vorhandene Produkte erhalten; exakter vierter App-Kontext (nichtpassendes Doku-Paket nur belegtes NEUTRAL); voller Windows-Batch und getrennte Root-A/B-Abnahme | 52f46527 |
| Z2-RULE10 | P2: konkrete bereits erteilte Nutzerfreigaben erhalten; keine Rechteausweitung; Geld, Passwörter und Releases bleiben beim Nutzer | Stabschef | PLAN-C1; gemeinsam mit GOALS-B | egal | C | Erledigt: Root-abgenommener #644 `4032800` am 08.10. 07:12:55 UTC gemergt, nach #643; allgemeine Sitzungsadoption nicht daraus abgeleitet | freigegebene Handlung nicht erneut erfragen; keine abgeleitete Pauschalfreigabe; eigene prepush-Lane Exit 0; Root-Abnahme | 52f46527 |
| HOOK-WIN | P1: Windows-Hook-Reparatur und echte Unix-Quote-Korrektur integrieren; abgeschlossene Home-Reparaturen erhalten | vorhandener Implementierer · Claude; Chief koordiniert | vorhandene Runtime-/Rot-/Gate-/Vendor-Belege; finaler PR-Bericht vor Ready | PC | A | Erledigt: Root-abgenommene Source #641 `bf89c435`/292 ALL am 08.10. 06:10:42 UTC gemergt; Home-Wirksamkeit nur durch separate jeweilige Runtimebelege, keine neue pauschale Behauptung | eigene Windows-prepush 21/295s Exit 0; tatsächliche Google- und OpenAI-Reviews mit Autorgrenzen/Disposition; Root-Abnahme; Merge und Home-Wirksamkeit getrennt berichten | b14492cb |
| HOOK-WIN-DOC | P2: erhaltene 33-ALL-Hookanleitung liefern; Größenlimit der Source-Reparatur wahren | derselbe Implementierer · Claude | HOOK-WIN; eigener Docs-Head | PC | C | Erledigt: #645 `094e2db`, 33 ALL, eigene Windows-prepush 21/456s Exit 0 und Root-Abnahme; tatsächlich nach #641 am 08.10. 07:13:16 UTC gemergt | nur `docs/setup/codex.md`, erhaltener Hunk unverändert, eigener prepush Exit 0; Draft auf #641; erst nach Source-Merge retargeten/abnehmen | fc99616e |
| GOALS-A | P1 jetzt: Ist-Abgleich früherer Aufträge, realer Native-Goals, laufender Owner und PLAN; verhindert Doppelstarts und unbelegte Abschlüsse | Stabschef; Root nimmt ab | bestehende Übergaben und eigene Goal-Werkzeuge je Session | egal | C | Erledigt: begrenztes Ist-Abgleich-Handover von Root 02:56 UTC angenommen; Chief-Native-Abschluss 02:57:37 belegt, spätere Koordination hat eigenes aktives Ziel | eine Zeile je Live-Agent: Ziel, eigener get/create-Beleg oder belegte Nichtverfügbarkeit plus Ticketziel, Meilenstein und Grenze; kein Plantext als Goal-Beleg | 52f46527 |
| GOALS-B | P2: Rollen-Goals, Anpassung, Grenzen und selektive Rekursion in AGENTS.md, projecta-workflow und Übergabevorlage verankern; nur Prozessdoku, kein Runtime-Ausbau | Stabschef als Editor; Root nimmt ab | PLAN-C1; Z2-RULE10 im selben Dokumentationspaket | egal | C | Erledigt: Root-abgenommenes Dokumentationspaket #644 `4032800` tatsächlich 07:12:55 UTC gemergt; vier bestehende Skills gespeichert/zurückgelesen; Adoption bleibt ausschließlich sitzungsweise belegt, keine allgemeine Wirksamkeitsbehauptung | ≤ 300 ALL; Anforderungen GOALS-01 2–7 erhalten; 1 zusätzliche Selbstprüfung, 2. nur konkreter Restmangel; Stops und unabhängige Reviews/Nutzerfreigaben unverändert; prepush Exit 0 | 52f46527 |
| GOALS-C | P2 begleitend: drei vorhandene Praxisproben Lane F, DR-02 und HOOK-WIN auswerten; Stichprobe, kein Wirksamkeitsbeweis; keine neuen Jobs/QA/Benchmarks | ausführende Owner dokumentieren; Root bewertet | vorhandene Fix-, Review- und Runtimebelege | egal | C | Erledigt: genau drei Proben samt Messlücken von Root 02:56 UTC angenommen; selektive Nutzung, kein vierter Versuch aus späteren Fixes | je Ticket Mangel/kein Mangel, Bestätigung, beobachtete Regressionen, nur gemessener Zusatzaufwand; bei überwiegendem Aufwand Anwendung begrenzen | 52f46527, 55ea21ce, b14492cb |
| DEV-KNOW-01 | P2: freigegebenen EIN-Thema-Wissenspilot begrenzt auswerten; Quellenindex gegen zwölf Karten, kein Ausbau ohne belegten Nutzen | einziger Messowner Implementierer · Codex `8qyt6d`; Chief übernimmt Bericht, Root nimmt ab | Vorbereitung #651 `1205081` angenommen; eingefrorene neun Quellen und fünf Fragen; Z1-Slots frei halten | private leichte Messroute | C | Erledigt: 20+6-Originalübergabe samt Korrekturappend Root-ACCEPT 09:22:35 (`198949e8`); rationale-only-Nachtrag separat ACCEPT 10:10:29 (`1dbb4ebb`, operative REPORT `8f3f0796`, Input `20c2571d`, Assessment `71d3d6df`, Handover `b5c7a645`), Originale erhalten; eigene Mess-/Koordinationsgoals COMPLETE; kein konsistenter Nettoqualitätsgewinn, Quellenindex empfohlen; keine neue Messung/automatische Übernahme | getrennte Claude-/Codex-Vergleiche, gleiche Fragen/Revisionen und Parameter je Anbieter; Qualität/Kontext/Sucharbeit/Pflege mit Messlücken, sechs begrenzte Fälle; Nullbefund zulässig, keine automatische Übernahme | 57979887 |
| Z2-REGELN | Regelwerk 2.0: Lane-A-Korrekturen (6) abschließen, Anweisungsdateien entschlacken (Lane C, Commit 6918bea), Altlasten-Audit liefert „Deine Regeln: bestätigen oder ändern“ | Stabschef + Codebase Archäologe | – | egal | C | In Arbeit | Lane-C-PR gemergt; `npm run dev:agent-check` Exit 0; Regel-Vorschläge R1–R5 in der Inbox entschieden | 77c993f3 |
| DOC-OPERATORS | Operatoren-Katalog und Briefvertrag in AGENTS.md und beiden projecta-workflow-Skills verankern | bestehender Root-Serverjob; kein zweiter Anweisungseditor | konkrete Disposition zu #642 erhalten | Server | C | Draft #683 `d47274a` geliefert; Root-Abnahme/Merge offen | nur Abschnitt vor Detailed operating reference und Skill-Dateiende; ≤ 300 ALL, eigene prepush, Regeln/Freigaben unverändert | 77c993f3 |
| Z2-AGENTS-SLIM | AGENTS.md auf etwa ≤ 8 KB reduzieren: Kernregeln, Befehle und Merge-Kurzregel erhalten, Referenzdetails per eindeutigem Pfad auslagern | ein von Stabschef Ausführung benannter Doku-Owner; Chief pflegt nur PLAN | DOC-OPERATORS/#683 integriert; #642-Anweisungs-/Archivdelta ausdrücklich disponiert; keine Dateikollision | Server | C | Vorgeschlagen, blockiert; kein Ready-Kandidat vor Vorgängern und genauem Schnitt | AGENTS.md plus vorhandene docs/setup/ oder WORKFLOW-Referenzziele; globale CLAUDE/MEMORY und Standard-Skills ausgenommen; Regel-für-Regel-Mapping, Linkcheck, dev:agent-check und eigene prepush Exit 0; ≤ 300 ALL, sonst vor Start serielle Schnitte; Byteziel ist kein Token-/Wirksamkeitsbeleg | 77c993f3 |
| Z2-RECHTE | Konsolidiertes Rechtekonzept V3, Herkunft und Disposition erhalten | Konzeptowner lz0jwp; finale Konzeptabnahme Root | privates Bundle V3 `B368BB476E8E`; E1–E5 entschieden | bestehender Konzept-Arbeitsort | C | Konzept von Root nach Fable-CONCUR abgenommen (08.10., 15:23Z); E5 bestätigt 15:26Z; keine technische Aktivierung | vier Original-/Kopie-Paare gegen Manifest geprüft; Umsetzung nur über folgende getrennte Schnitte; E2-Schreibhost noch zu benennen | b2f36f8a |
| Z2-RECHTE-P1 | Ein privater Quellen-/Rechte-/Dispositionseintrag für den ausgewählten Werkzeugfall; Originaltexte und Ersetzungslinks erhalten | bestehender Konzeptowner lz0jwp; Ausführungskoordination beim neuen Stabschef | V3 + E5; konkreter privater Zielpfad und Ausgangsdigest vor Start festhalten | privater bestehender Wissensbereich | C | Geschnitten, noch nicht gestartet; Dokumentation, keine Settings-/Rechteaktivierung | ≤ 300 ALL; Quelle/Datum/Digest, ursprünglicher Scope, geltende Disposition, Projektion, Owner, fehlende Belege und nächster Schritt; Reset-, alte RH-C9- und Force-push-Ersetzungen getrennt; QA bleibt ausdrücklich beauftragt; kein privater Wortlaut in Git/PR | b2f36f8a |
| Z2-RECHTE-PILOT | Ein realer rust-analyzer/rust-src-Fall: manuelle Baseline gegen Shadow-Vorbereitung vergleichen | neuer Stabschef benennt bestehenden Werkzeugowner und genau einen tatsächlichen Schreibhost vor Zulassung; Root nimmt Shadow ab | P1; frischer Toolchain-/Client-/Komponenten-/PATH-/Home-Beleg, Quellenbindung und freie Eigentümerschaft | tatsächlicher Windows-Zielhost, noch ungebunden | C für Messbericht; technische Folgedeltas nach Dateien neu einstufen | Pending: Owner/Host und vergleichbare Ausgangslage fehlen; Shadow ohne Installation/Start/Reset/Triggeränderung | ≤ 300 ALL je Schnitt; ein gepaarter Nicht-Z2-Fall, Zeit-/Aufrufbelege einschließlich Vorbereitung/Prüfung/Nacharbeit/Recovery; Netto-Nutzen > 0 und > gemessene Vergleichsunsicherheit, sonst nicht belegt; negative Shadow-Fälle keine Laufzeit-PASS; tatsächlicher Effekt erst separat nach Shadow-Abnahme, danach installiert/geladen/funktional getrennt belegen | b2f36f8a |
| Z2-PLANPARSER | `hq-parse.mjs`, `dev-hq.mjs` und `hygiene.mjs` lesen die Z-Tabellen (Spalte Status, 8 Werte); danach Anhang B entfernen | Implementierer · Claude | Z2-PLAN-COMMIT | Server | B | Geplant | `npm run test:hq` Exit 0; HQ zeigt Z1–Z4; prepush Exit 0 | – |
| Z2-DOKSYNC | `KNOWN_ISSUES.md` „Offen“ bereinigen: KI-15, KI-16, KI-20 mit PR-Beleg; KI-33 bleibt „Kandidat“, bis ein Windows-Queue-Lauf mit der Änderung beobachtet ist | bestehender Root-Serverjob, kein zweiter Owner | – | Server | C | Root-abgenommen, Ready #670 `e13d003`; Queue laut Root; Merge separat beobachten | Jede verschobene Zeile nennt PR und Merge; KI-33 nur mit Windows-Queue-Lauf-ID und Dauer nach „Behoben“; precommit-Lane Exit 0 | 051bdfa0 |
| Z2-AUTOSTART | Denkraum startet nach der Windows-Anmeldung von selbst, ohne Secret-Eingabe | Desktop-App-Entwickler | DR-15, DR-06 | PC | A | Geplant | PC-Neustart → `127.0.0.1:4791` antwortet ohne Eingabe; kein Secret im Klartext | – |
| Z2-PACER | Pacer läuft: Trigger mit Werkzeugen, aber nur lesend; Bericht alle 20 min | Stabschef | Inbox R5 | PC | C | Blockiert | drei Läufe nacheinander mit Bericht, keine Schreibaktion | – |
| Z2-REVIEW | Zwei feste Fremdanbieter-Wege für Stufe A: Gemini/Cursor auf dem Server (Workspace Trust), Ollama Kimi K3 + GLM, Codex; je Weg eine Probe mit beobachtetem Modell | Root disponiert Fremdvendor-Reviews; Git-/CI-Owner qualifiziert Wege | WT entschieden (F1, 08.10.); Modell-/Head-Belege weiter Pflicht | Server | C | Root übernimmt Tier-A-Zweitanbieter über vorhandenen Ollama-GLM/Kimi-Weg laut Übergabe; kein Google-Folgelauf, Modell-/Head-Belege weiter Pflicht | Probe je Weg mit Modellname und Zeit; Weg in `docs/setup/` beschrieben | c77f6955 |
| Z2-RAM | RAM-/Server-Standard: schwer = Server; PC nur leicht bei ≥ 1,5 GiB; idle Konsolen schließen; RAM-Wächter | Autonomer Optimierungsarchitekt | – | PC + Server | C | Geplant | 24 h ohne „local heavy STOP“, Messung im Ticket | – |
| Z2-RAM-SLOTS | Konfigurierten Warm-Slot-Root im bestehenden `build-slot` beachten; keine zweite RAM-Messung | Root weist einen vorhandenen Serverworker zu; nur `scripts/dev/build-slot.mjs` und eigener Test | Basis `fc85e3d`, unabhängig von DR-04B-FU und HYGIENE | Server | A (Start-/Ressourcenempfehlung) | Startvertrag unten; geprüftes bestehendes Auswahlproblem, kein Dispatch | ≤ 180 ALL; kompilierendes Rot, Root-/Override-/Fehler- und belegte-Slot-Fälle; bestehende Schwellen/Heuristiken erhalten; eigene prepush + zwei Fremdvendor-Reviews am Kandidaten | – |
| Z2-HYGIENE-STATUS | Aktuelle Draft-/Ready-/In-Arbeit-Zeilen im lesenden Hygiene-Werkzeug erkennen | Root weist einen vorhandenen Serverworker zu; nur `scripts/dev/hygiene.mjs` und eigener Test | Basis `fc85e3d`, unabhängig von beiden anderen Reservepaketen | Server | B | Startvertrag unten; Dreizeilen-Statusprobe liefert bisher keine Einträge, kein Dispatch | ≤ 160 ALL; benanntes kompilierendes Rot, Kandidaten-PR-Nummern von Vorgänger-/historischen Nummern trennen; keine Board-/PLAN-/GitHub-Schreibwirkung; eigene prepush + Fremdreview am Kandidaten | – |
| Z2-PR-PROTECTION | Merge-Protection in lesender PR-Bereitempfehlung berücksichtigen | Root benennt bestehenden Serverworker; Dateipaar unten exklusiv | main `9d9eaa7`; unabhängig | Server | B | Startvertrag unten; Draft zur Root-Abnahme, kein Dispatch | ≤ 160 ALL; benanntes Rot, Protection-Fälle und Queue-Fakt; volle prepush und Fremdreview | 77c993f3 |
| Z2-STATUS-UNKNOWN | Unbekannte CI-Kontexte und fehlende Checks nicht als grün darstellen | Root benennt bestehenden Serverworker; Dateipaar unten exklusiv | main `9d9eaa7`; unabhängig | Server | B | Startvertrag unten; Draft zur Root-Abnahme, kein Dispatch | ≤ 140 ALL; benanntes Rot und Bericht-Fixtures; volle prepush und Fremdreview | 77c993f3 |
| Z2-START-MEASURE | Ungültige RAM-/Usage-Messwerte und leere Usage-Datei verweigern | Root benennt bestehenden Serverworker; Dateipaar unten exklusiv | main `9d9eaa7`; unabhängig von RAM-SLOTS #725 | Server | A | Startvertrag unten; Draft zur Root-Abnahme, kein Dispatch | ≤ 160 ALL; benanntes Rot, CLI Exit 1, gültige Defaults erhalten; volle prepush und zwei Fremdvendor-Reviews | 77c993f3 |
| Z2-CIWATCH-SHAPE | Ungültige Check-Objekte als Lesefehler verweigern statt abstürzen | Root benennt bestehenden Serverworker; Dateipaar unten exklusiv | main `9d9eaa7`; unabhängig | Server | B | Startvertrag unten; Draft zur Root-Abnahme, kein Dispatch | ≤ 140 ALL; benanntes Rot, Exit 3 ohne Folgepoll/Grün; volle prepush und Fremdreview | 77c993f3 |
| Z2-MRP-COMPLETE | Teilweise ausgefülltes Prompt-Log nicht als vollständigen Messbeleg zählen | Root benennt bestehenden Serverworker; Dateipaar unten exklusiv | main `9d9eaa7`; unabhängig | Server | B | Startvertrag unten; Draft zur Root-Abnahme, kein Dispatch | ≤ 120 ALL; benanntes Rot, Zähler-/Bench-Fixture, Nullbefund gültig; volle prepush und Fremdreview | 77c993f3 |
| Z2-ROUTE | Verteilung nach Verbrauchstempo über `usage_overview`; Quota-Regeln erneuern; Officer-Routine neu anmelden | Stabschef Ausführung beobachtet/routet; keine eigenmächtige Quota-Regeländerung | Nutzer: Re-Login | PC | C | Geplant | eine Woche ohne Anbieter am Limit; Routing-Beleg je Start | 492a9e36 |
| Z2-BOARD | Board aufräumen: erledigte/veraltete Tickets schließen (ef39c814, 2720b77f, 5945accc, 5de5c4c9, 7b66731d), Kurzstand-Block je Ticket, Ready-Queue ≥ 5 pflegen | Stabschef Ausführung: Ready-Reserve, Lane-/Blocker-Beobachtung; Chief nur PLAN | – | egal | – | Bereit | `backlog_list`: keine erledigten Tickets mehr offen | – |

Routing-Freigabe Elias 08.10.: Codex und vorhandene dynamische Workflows voll nutzen;
bei tatsächlich beobachteten ≥ 98 % Wochenverbrauch den vorhandenen banked reset
über den unterstützten nativen Weg verbrauchen, danach Kontingent neu prüfen.
Kein Reset vor der Schwelle, keine Quota-Kappenänderung; RAM-, Prozess-, Naht-,
Review- und Freigabegates bleiben bestehen. Root hat am 08.10. 01:43:49 UTC
40 % und einen Full-reset-Credit beobachtet; damit ist noch kein Reset ausgeführt.

## Z3 — Rest von v1.6.0

Fertig heißt (Unterplan v1.6.0): alle Kernpakete gemergt und jede Naht unter
Baseline. Gemessen 07.10. auf 1c09ebb: `api.rs` 7908 < 8091, `store.rs` 7224 < 7227,
`bin/pa.rs` 6293 < 6490, **`main.rs` 5133, nicht unter 5133**.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| V16-ARCH-D4-05 | Queue-Routen aus `api.rs` (PR #631) | Implementierer · Codex, Abnahme Root | – | Server | A | angenommen, Mergify ausstehend | Merge über Mergify; `api.rs` 7858 | b9606dd4 |
| V16-ARCH-D7 | Einstellungen nach `store/settings.rs` (PR #632) | Implementierer · Codex | V16-ARCH-D4-05 (Review seriell) | Server | A | Root-Abnahme am `e154e4d` gemeldet; Ready, Mergify ausstehend; frühere Zeitangabe falsch als UTC etikettiert, exakte UTC-Abnahme unbelegt | Merge über Mergify | 782d9e58 |
| V16-06 | Start nach Update ohne Journal blockiert nicht stumm | MCP-Integrationsentwickler | Inbox V16-F3; Update-Drill | PC | A | Blockiert | roter Test zuerst; Drill Erfolg/Abbruch/Fehler | 2557db66 |
| V16-UPD-CANCEL | Abbrechen-Knopf beim Update-Download (sonst ist der Drill „Abbruch“ unmöglich) | Desktop-App-Entwickler; Startzuweisung durch Ausführungs-Stabschef | V16-ARCH-D2 / #664 muss gemergt sein; mn neu zuweisen | PC-Drill; Gates Server möglich | A | Pending: `main.rs` ist die Update-/Installationsnaht, bis #664-Merge reserviert; Größenprognose 260–295 ALL laut Pin-Bericht, kein gemessener Diff | compiling RED vor Fix; Abbruch nur vor Installation autoritativ quittieren, Ende/Thaw vor Retry; Drill und Screenshot; eigene prepush + zwei Fremdvendor-Reviews; >300 ALL vor Start in Backend/IPC und nachgelagerte UI teilen | – |
| V16-ARCH-D2 | Doppelte Projektanlage in `main.rs` zusammenführen | Root-Job `srv-v16-arch-d2`; mn bleibt bis Merge reserviert | vor V16-06 freigegeben (Inbox V16-D2) | Server | A | Draft #664 `b68c7da`, 13+/15-; OpenAI und Zweitanbieter GLM/Kimi bei Root; kein Google-Folgelauf; Root-Abnahme offen | `rg -c 'fn create_project' src-tauri/src/main.rs` → eine Umsetzung; `main.rs` < 5133; eigene prepush und zwei Fremdvendor-Belege mit Disposition | 257e3a7b |
| V16-ARCH-D5a | Diagnosebefehle aus `main.rs` lösen | Implementierer · Claude | V16-ARCH-D2 | Server | A | Geplant | `main.rs` −150 Zeilen | – |
| V16-ARCH-D5b | Einstellungsbefehle aus `main.rs` lösen | Implementierer · Claude | V16-ARCH-D5a | Server | A | Geplant | `main.rs` −150 Zeilen | – |
| V16-ARCH-D8a | Ereignisnamen als Konstanten in `main.rs` | Implementierer · Claude | V16-ARCH-D5b | Server | A | Geplant | `rg -n -F -e '"worker:status"' -e '"supervisor:notification"' src-tauri/src/main.rs` → 0 Treffer außerhalb des gemeinsamen Konstantenmoduls; `cargo test --manifest-path src-tauri/Cargo.toml` Exit 0 | – |
| V16-ARCH-D8b | Ereignisnamen in PTY | Implementierer · Claude | V16-ARCH-D8a | Server | A | Geplant | `rg -n -F -e '"pty:output:' -e '"pty:exit:' src-tauri/src/pty.rs` → 0 Treffer außerhalb des gemeinsamen Konstantenmoduls; `cargo test --manifest-path src-tauri/Cargo.toml` Exit 0 | – |
| V16-ARCH-D8c | Ereignisnamen im Frontend | Implementierer · Codex | V16-ARCH-D8b | egal | B | Geplant | `rg -n -e '["\x27\x60]worker:status' -e '["\x27\x60]supervisor:notification' -e '["\x27\x60]pty:output:' -e '["\x27\x60]pty:exit:' src` → 0 Treffer außerhalb des gemeinsamen Konstantenmoduls; `npm run typecheck` und `npm run test:unit` Exit 0 | – |
| V16-ADR-A1 | ADR A1 (`ApiBackend` teilen) in `docs/decisions.md` entscheiden | bestehender Root-Job `srv-v16-adr-a1`; Fable bei Root | – | Server | C | Root-abgenommen nach Fable F1–F5; Ready #667 `8096d88`, Queue laut Root; Merge offen | `docs/decisions.md` A1 nicht mehr „Vorschlag (offen)“; precommit-Lane Exit 0; Root-Abnahme am SHA | 72f47044 |
| V16-ADR-A7 | ADR A7 (st-Lane teilen) | Architekturberater Fable + Architekturberater Astra | V16-NACHBEOB (zwei Wochenmessungen) | egal | C | Verschoben | Eintrag in `docs/decisions.md` | – |
| V16-KI30 | KI-30 Windows-Flake: Restursache nach V16-01 | Performance- und Benchmark-Spezialist | – | Server | A | Geplant | neuer Beleg (Queue-Lauf-ID) vor Fix; danach 10 Queue-Läufe ohne KI-30 | – |
| V16-03 | Tester-Kit: Installation, Rückmeldeformular, Grenzen | Implementierer · Codex | Inbox E16; frisches Windows-Konto (Nutzer) | PC | C | Blockiert | Trockenlauf im frischen Konto | – |
| V16-CHANGELOG | CHANGELOG v1.6.0 und Release-Notiz | Stabschef | DR-17, alle Z3-Pakete | egal | C | Geplant | Eintrag `v1.6.0` über `v1.5.1` | – |
| V16-RELEASE | Tag v1.6.0 (Beta-Regel x.y.0) | Elias | Z1, Z3 | PC | – | Geplant | Elias’ Entscheidung, danach Release-Pipeline grün | – |
| V16-NACHBEOB | Zwei Wochenmessungen und 40 Queue-Läufe; Messgrößen-Leitfaden | Stabschef | v1.6.0 | Server | C | Verschoben | Wochenberichte BENCH-01/02 im Ticket | b8b16ec8 |

## Z4 — Wichtig, aber liegen geblieben

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| Z4-ARCH-D1-REST | Vierten HTTP-Fehlertext-Klassifizierer `error_status` in den gemeinsamen Klassifizierer übernehmen; ARCH-D1 bleibt offen | Root-Job `srv-z4-arch-d1-rest`; api bleibt bis Merge reserviert | – | Server | A | Draft #663 `c8f2b8f`, 182 ALL; OpenAI und Zweitanbieter GLM/Kimi bei Root; kein Google-Folgelauf; Allowlist18 und Rotnachweis prüfen, keine Abnahme | `rg -n "fn error_status" src-tauri/src/development_plan_access.rs` → 0 Treffer außerhalb des gemeinsamen Klassifizierers; eigene prepush und zwei Fremdvendor-Belege mit Disposition | 7810a005 |
| Z4-E14 | Update-Signierschlüssel offline sichern (verschlüsselter Export in deinen Passwort-Manager) | Elias | – | PC | – | Geplant | Sicherung vorhanden, Schlüssel nirgends im Klartext | – |
| Z4-ARCH-11 | KI-24b: Test-DB-Wettlauf auf Windows reproduzieren und absichern; zusätzlich KI-30-Queue-Befund im Native-Receipt-Test | Implementierer · Claude; Ausführungs-Stabschef weist Lane zu | #632 / V16-ARCH-D7 gemergt (`b2769b8`, 08.10. 15:25Z); st durch `srv-r19-02-fix1` laut Root reserviert, vor Start neu zuweisen | Windows-PC für RED | A | Pending: D7-Vorgänger erfüllt; PC-RAM laut Root blockiert, vor Start aktuell messen; keine Windows-RED-/Ursachenmessung vorhanden | Dateien `testutil.rs`, `store/development_launches.rs`, `store.rs` vor Start binden; 180–280 ALL nur Prognose; kompilierende Windows-REDs für Launch-Drop/Reopen und getrennt Migration-Reopen; zusätzlich `real_native_completed_receipt_survives_sqlite_writer_within_busy_timeout` (Queue-Runs 37810056116/37814405700) eingrenzen; Zuordnung zur Windows-Flake-Klasse ist keine bewiesene gemeinsame Ursache; API-Ursache offen, keine Blanket-Retries; Fix nur nach Beleg, >300 ALL trennen; eigene prepush + zwei Fremdvendor-Reviews | 0e7793b4 |
| Z4-R19-09 | Vollständige Audit-Envelopes für den Pfad Wartung (Matrixzeile 19) | Implementierer · Codex | V16-ARCH-D7 | Server | A | wartet #632 (store.rs) | roter Test zuerst; prepush Exit 0 | – |
| Z4-R19-ST | Audit-Envelopes Ziel/Task, Claim/Checkpoint, Intent/Launch, Kandidat/Evidence/Review (M4-R19-02/03/04/07) | bestehender Root-Job `srv-r19-02-fix1`; keine zweite st-Lane | #632/D7 gemergt; Store exklusiv bis Übergabe reserviert | Server | A | #698 (426 ALL) bleibt Referenz; ersetzt durch #702 (02a) und #705 (02b/03a), Fixrunde 1 laut Root; keine Gesamt-Abnahme | ≤ 300 ALL je Schnitt; vorhandene Envelopes wiederverwenden, übrige Pfade getrennt belegen; Rot/grün, eigene prepush, zwei Fremdvendor-Reviews/Disposition und Root-Abnahme | – |
| M4-R19-02a | Ziel-/Task-Erstellung und gemeinsamer Audit-Helper atomar | bestehender Root-Job `srv-r19-02-fix1` | #632/D7 gemergt; st reserviert | Server | A | Draft #702 `a21d52f`, 295 ALL vor Fixrunde; Anthropic/Google-Disposition und Fixrunde laut Root, keine Abnahme | Erstellung/Audit und Rollback mit kompilierendem Rot/grün belegen; ≤ 300 ALL auch nach Fix; eigene prepush, zwei Fremdvendor-Reviews am Kandidaten mit vollständiger Disposition | – |
| M4-R19-02b / M4-R19-03a | Task-/Projektsteuerung und vorhandene Claim-/Checkpoint-Audit-Envelopes aus #705 | derselbe bestehende Fixrundenowner; st seriell | #702 `a21d52f`; auf dessen Branch gestapelt | Server | A | Draft #705 `105b118`, 253 ALL vor Fixrunde; R705-A1 von Root als zusätzlicher R19-03a-Umfang disponiert; Fixrunde 1 laut Root | Helper aus 02a und Envelopes in späterem R19-03 wiederverwenden; keine doppelte Auditierung; Rot/grün und Rollbackbelege, ≤ 300 ALL nach Fix, eigene prepush/zwei Fremdvendor-Reviews/Disposition; #698 erst nach Root-Abnahme beider Schnitte disponieren | – |
| Z4-VERIFY | Fünf Altzeilen gegen aktuelle Quellen prüfen und begrenzt schneiden | Root-Job `srv-z4-verify`; Chief integriert | Quelle `a167486` | Server | C | Prüfbericht geliefert: `pa-orch/reports/z4-verify-20261008.md`, SHA256 `77341da8`; alle fünf Altzeilen NEUES PAKET, elf FITs unten; keine frischen Laufzeit-/Testbelege | Belege/Teilpässe erhalten; konkrete Reste und NICHT ABGEDECKT statt Altzeilen pauschal schließen | 77c993f3 |
| Z4-W103F-WIRE | Produktionsadapter `agent_record_delivery` anbinden; `main.rs`, ggf. API-Integrationstest und notwendige Adapter-Allowlist; 120–220 ALL | Chief weist einen Codex-Implementierer zu | #664 gemergt; mn frei; bestehende #301/#337/#352 erhalten | eigener Worktree | A | Pending; PM prüft Startvertrag, kein neuer Worker | kompilierendes Produktionsadapter-Rot; danach done/blocked persistiert, wiederholtes done unverändert, falsche/veraltete Credentials abgewiesen; eigene prepush, zwei Fremdvendor-Reviews | 8e7b877f |
| Z4-W103F-Z1 | Originaler PC-Zustellbeleg mit 20 Versuchen, nur bereinigter Bericht ≤ 120 Zeilen | Chief weist einen Messowner zu | WIRE integriert; PC/App/Default-opencode und MCP-Start > 30 s belegt | PC | C | Pending; reale Voraussetzungen und Zeitpunkt offen | je Versuch Version/Latenz/Marker/terminalbestätigter Empfang; 20/20 bzw. < 20/20 bestimmt Queue-Rest; keine erfundenen Pässe | 1c6d9ed8 |
| Z4-W303-PC-REST | Fehlende Crash-/Kapazitäts-/Provider-Belege aus bestehenden Drills, nur Bericht ≤ 180 Zeilen | Chief weist einen Messowner zu | gültige M4-Aktivierung, PC-Rechte und HQ-Läufe | PC | C | Pending; M4-Freeze erhalten; #500-Teilpässe nicht wiederholen | Crash je spezifiziertem Übergang plus Kapazität/Provider mit Version/Befehl/Exit/Manifest; Singleton/Estop/Backup aus #500 erhalten | abf51cef |
| Z4-W307-PC-UPDATE | Signiertes installiertes Client-Update und Neustart, nur Bericht ≤ 150 Zeilen | Chief weist einen Messowner zu | autorisierter Windows-PC, Backup/Rückweg, neuere veröffentlichte Version und Abbruchpfad | PC | C | Pending; Release-Build ist kein Client-Laufbeleg | cancel/fail/success in dieser Reihenfolge; alte/neue Version, echte Signaturprüfung/Neustart, Fall-Manifeste/Exits; kein neuer Schlüssel/Release | c58c630b |
| Z4-W118B-PROBE | Native Codex-Skill-Erkennung mit unabhängigem Canary/Kontrolle; Setup-Doku ≤ 120 ALL | bestehender Root-Job; kein Doppelstart | eigener Harness-/Modell-/Startcheck, keine Installation | Server | C | Root-abgenommene positive Probe: Ready #675 `6cebda1`; Queue laut Root, Merge separat | Canary-Wert fehlt in Prompt/Katalog; reale Discovery-/Read-Spur und Kontrolle samt Befehl/Exit; gesperrter Zugriff ist kein PASS | e4bae87c |
| Z4-W118B-PROFILE | Nur nachgewiesene Codex-Capability anheben; agent-defaults.json, profiles.rs und Setup-Doku, 80–160 ALL | bestehender Root-Serverjob, Claude Sonnet; kein Doppelstart | positive PROBE von Root abgenommen | eigener Worktree | B | Ready #678 `1b94e79`; OpenAI-Delta-Approve und review-ok laut Root (08.10.); Ready aktuell geprüft, Merge/Installation separat | kompilierendes Capability-/Pack-Rot, danach nachgewiesener Pfad; fremde Profile unverändert, eigene prepush und Fremdreview | 67c1ca17 |
| Z4-M4B-0-AUTH | Transaktionslokale Run-/Owner-/Fence-/Rollen-/Projektautorisierung, store/development_runs.rs und ggf. development_launches.rs, 180–260 ALL | Chief weist einen Nahtowner zu | st nach #632 frei; freigegebene Sicherheitskorrektur bei deaktiviertem Continuous Mode | eigener Worktree | A | Pending; Helfer allein schließt M4-B nicht | dieselbe Schreibtransaktion, stale/fremd/falsche Rolle/fehlendes Ziel abweisen; keine neue Auth-Transaktion/Migration; Rot vor Fix, eigene prepush und zwei Fremdreviews | fea04970 |
| Z4-M4B-1-GOAL | Atomare Autorisierung und Goal/Replan, continuous.rs plus api/planning_access/Tests/main, 220–290 ALL | ein serieller st/api/mn-Owner | AUTH und freie Nähte; freigegebene Sicherheitskorrektur ohne Continuous-Aktivierung | eigener Worktree | A | Pending; kein neuer Worker | deterministisches kompilierendes Fence-Interleaving-Rot; stale ohne Goal/Event, gültiger Coordinator erfolgreich; autonome Root operator-only, Operator/Audit erhalten; eigene prepush/zwei Fremdreviews | 2be81e2e |
| Z4-M4B-2-TASK | Atomare Taskanlage, gleicher begrenzter Dateisatz wie GOAL, 180–270 ALL | ein serieller st/api/mn-Owner | AUTH und GOAL-Nahtübergabe | eigener Worktree | A | Pending; kein paralleler Nahtstart | Fence-Interleaving-Rot; stale ohne Task/Event; eigenes Projekt erfolgreich, fremde Goals/Dependencies abweisen, Operator erhalten; eigene prepush/zwei Fremdreviews | 8dbd5dc7 |
| Z4-M4B-3-ASSIGN | Atomare Zuweisung, team_assignments.rs plus api/planning_access/Tests/main, 200–280 ALL | ein serieller st/api/mn-Owner | AUTH und TASK-Nahtübergabe | eigener Worktree | A | Pending; kein paralleler Nahtstart | Fence-Interleaving-Rot; stale ohne Assignment/Revision/Event; Selbsteskalation abweisen, gültige Zuweisung/Operator erhalten; eigene prepush/zwei Fremdreviews | 15d92066 |
| Z4-M4B-4-IMPORT | Autorisierung nach Source-Laden im Import-Schreibvorgang, development_plan/access plus api/planning_access/Tests/main, 230–300 ALL | ein serieller st/api/mn-Owner | AUTH und ASSIGN-Nahtübergabe | eigener Worktree | A | Pending; M4-B erst nach vier integrierten Schreibpfaden abnehmen | Fence beim Source-Laden ändern; Rot vor Fix; stale ohne Projektion/Revision/Event, gültiger Import/CAS/Sourceprüfung erhalten; vier Pfade integriert prüfen, eigene prepush/zwei Fremdreviews | e7c9e018 |
| Z4-SERVER-DISK | Server-Platte: alte Worktrees (~151 GB) aufräumen; erst Backup | Elias entscheidet, Stabschef führt aus | Inbox E17 | Server | – | Geplant | Platte < 60 %, Backup-Beleg | – |
| Z4-RCLONE | Eigene rclone-`client_id` vor Ende 2026 | Elias | – | PC | – | Geplant | Backup läuft mit eigener ID | – |
| Z4-SETUP-14 | Rest SETUP-14: tote Keys, Permission-Regeln | Elias | – | PC | – | Geplant | Liste abgehakt | – |
| Z4-M5-01 | Testerrunde mit 3–5 externen Testern | Elias | V16-03, E16 | egal | – | Verschoben | Rückmeldungen festgehalten | – |
| Z4-M5-04 | Dogfooding: ein Orchestrierungsschritt zieht in ProjectA um | Root | Z1 | egal | – | Verschoben | Umfang festgelegt | – |

## Lanes (5 parallel)

| Lane | Reihenfolge | Ort |
|---|---|---|
| L1 Denkraum-Backend | DR-01 → DR-01a → DR-02 → DR-03 → DR-04a → DR-04b → DR-04c → DR-06a → DR-06b → DR-05 / DR-07; DR-15 | Server |
| L2 Denkraum-UI | DR-08 → DR-09 → DR-10 → DR-11 → DR-12 → DR-13 → DR-14; dann DR-16, DR-17 | egal / Server |
| L3 Nähte (seriell) | api: #631 · st: `srv-r19-02-fix1` (#702/#705, Root-Meldung 19:25Z) reserviert; #632 gemergt; Z4-ARCH-11 / weitere R19-Schnitte erst nach belegter Freigabe und frischer Zuweisung · mn: Z4-R19-09 **oder** V16-06 → D2 → D5a → D5b → D8a → D8b → D8c · pa: frei | Server |
| L4 Setup/Dev | PLAN-C1 → GOALS-B mit Z2-RULE10; danach Archiv-/Bereinigungsschnitte und Z2-PLANPARSER; Z2-REGELN, Z2-DOKSYNC, Z2-BOARD, Z2-REVIEW, Z2-RAM, Z2-ROUTE, Z2-PACER, Z2-AUTOSTART | egal |
| L5 Doku/PC | V16-ADR-A1, Z4-ARCH-11, V16-UPD-CANCEL, V16-KI30, V16-CHANGELOG | PC / egal |

Nie zwei aktive Pakete auf derselben Naht (`api.rs`, `main.rs`, `store.rs` + `store/`,
`bin/pa.rs`). Neue V2-Pakete starten vor Z1 nur, wenn eine Lane leer ist und Root zustimmt.

GOALS-A läuft leicht parallel zur Produktlieferung; GOALS-C nutzt vorhandene Arbeit.
GOALS-B und weitere PLAN-Edits sind beim Chief seriell. Z1 behält Vorrang;
Prozessarbeit belegt keine Z1-Dateien oder Nähte. Native Goal-Ausgaben und Adoption
stehen im Ticket, nicht in gespeicherten Profilen oder zugestellten Nachrichten.

### DR-07c/d/e1/e2: vier weitere P1-Testports

Chief-Disposition zum Root-Vorschlag `msg-0mv02koqa-49ce4f1b`:
keine Ausnahme von 300 ALL. Ownerbelege `msg-0mv02o72m-1e798c11` (21:52Z)
sind nur Scratch-Vorbereitung; nichts implementiert, kein Branch/Commit/Start.
Basis für jeden unabhängigen Schnitt: `85ab28626a3fbccf0a262afc64fb57383222fb8b`
(main, #681 am 08.10. 21:42:27Z gemergt). Die offenen #731/#732/#734 berühren
andere Testdateien und werden nicht wiederholt. DR-07d ergänzt DR-05; vorhandene
Ideen-Tests bleiben erhalten. Vollständiger Parent: `55ea21ce-1f3d-4fcb-9bf7-704db5660b19`;
die abweichende UUID der Mail wurde nativ als nicht vorhanden erkannt.

P1-Quellen `decision-desk`, rohe SHA256 unabhängig am 08.10. geprüft:
- sender.test.mjs: `35d2c6f63b55bd6e7981f67bf7412ec40afec74aca8b7e83a2378df16044246c`.
- priority.test.mjs: `233bfb172e03fe8ca50674790065bcb968a3ef3fe6c1769d491d9e724eca721b`.
- store.test.mjs: `8d24458cf1a6b39754f7021f1b2381698ca42eb6656c43e21ee50d7e6dc54454`.
Vor Port erneut rohe Hashes gegen dieses Manifest prüfen; Änderungen stoppen.
Dateizeilen unten sind 1-basiert im hashgebundenen P1-Text; letzter leerer
Split-Eintrag ist keine zusätzliche Testzeile. ALL ist der tatsächliche Git-Diff
des neuen Zieltests einschließlich Imports, dupliziertem Header und ROOT-Zeile.

| Paket | Einziger exklusiver Zielpfad | Vollständiger P1-Bereich | Owner meldet ALL / Tests |
|---|---|---|---|
| DR-07c | tools/denkraum/sender.test.mjs | sender ganz | 214 / 12 |
| DR-07d | tools/denkraum/priority.test.mjs | priority ganz | 110 / 6 |
| DR-07e1 | tools/denkraum/store-receipts.test.mjs | store 1–34 und 35–169 | 169 / 10 |
| DR-07e2 | tools/denkraum/store-answers-migration.test.mjs | store 1–34 und 170–359 | 224 / 18 |

Je Paket ≤ 300 ALL, eigenes Worktree/Branch/Draft-PR. Keine Runtime-/Delivery-/
Playwright-/package.json-/Helper-Änderung und keine realen Agent-IDs im Ziel.
Owner bleibt qfytpd, Root benennt den tatsächlichen Server-Ausführungsplatz nach
frischem Modell-/Kontingent-/RAM-/Cargo-/Datei-/Slotcheck. Derselbe Owner arbeitet
seine Pakete nacheinander; disjunkte Dateipaare erzeugen keine künstliche
Implementierungsabhängigkeit. Keine neuen Agenten, kein QA-Bot/Dispatcher/Team.
Vorhandene Port → Node/Suite/prepush → Root-Kette genügt; bei explizitem B-Review
eine fremde Vendorfamilie zum tatsächlich beobachteten Autor am konkreten Kopf.

Erlaubte D2-Abweichungen, sonst P1-Testkörper und Testnamen erhalten:
1. Echter P1-Root-Literal wird synthetisch; `const ROOT = 'test-root-agent'`.
2. `rootAgentId: ROOT` nur bei DeskStore-/Server-Fixture-Konstruktoren einfügen;
   Klammern und `join(...)` korrekt beachten. Owner meldet sender 18, e1 13,
   e2 8 Injektionen; priority verwendet reine Funktionen (0 Injektionen).
3. Child-Process-Source im Test „process termination during a partial temporary
   write preserves the last commit“ bleibt unverändert (Teststart P1:248,
   Konstruktor im Source-String P1:251): Child hat kein ROOT, putQuestion braucht
   keinen Root; äußere Fixture-Konstruktoren werden normal angepasst.
4. CRLF nach LF; nur notwendige Rand-Blankzeilen an Splitgrenzen normalisieren.
   Kein Test entfällt; keine gemeinsame Helper-Datei zur Größenumgehung.

Quellenmapping der Store-Testblöcke unabhängig gelesen: e1 beginnt an P1-Zeilen
35, 56, 71, 80, 100, 112, 124, 135, 145, 155 (10 vollständige Tests);
e2 beginnt an 170, 176, 183, 190, 195, 203, 210, 216, 223, 234, 248, 259,
271, 277, 305, 317, 337, 347 (18). Beide zusammen sind exakt alle 28 P1-Tests.
Im jeweiligen PR vollständige Testnamen, Quellhash/Zeilen und erlaubte Änderungen
ausweisen; e1/e2 zusammen keine ausgelassene oder doppelte Testidentität.

Abnahme je Schnitt: kompilierender `node --test <Zielpfad>`, genaue 12/6/10/18
Testidentitäten; `npm run test:denkraum` (inklusive Hygiene) und eigene vollständige
`bash scripts/ci/gates.sh lane prepush` Exit 0. tatsächliche ALL mit git diff
--numstat prüfen; unveränderter P1-/D2-Vergleich und kompletter kombinierter
Testnamen-Vergleich im Report. Reiner Testport C benötigt keinen künstlichen
Rotnachweis. Wenn er einen Befund zeigt: compiling RED festhalten, Root disponiert
separaten Fix/Scope/Tier/Review; kein stiller Produktionsfix im Testport.
Root nimmt Kandidaten ab; danach Ready, Mergify; kein Live-Deploy/Release.

NICHT ABGEDECKT: Owner meldet 101/101 Scratch-Pässe mit altem P1-server.mjs und
Root-Shim; das ist kein Pass gegen R676-Rootgate/Allowlist im Repo. Sender-HTTP
(/api/notifications/retry und Website-Save) muss tatsächlich auf der komponierten
Repo-Basis laufen. Noch keine Repo-Test-/prepush-/Review-/Abnahme-/Windowsbelege
für diese vier Ports; diese PLAN-Dokumentation verändert keinen Runtime-Test.

### Serverreserve: drei disjunkte Startverträge (Root 08.10., 20:45Z)

Auftrag `msg-0mv00abqi-b5191dcb`: drei Pakete ohne Rust-Nähte mn/st/api liefern;
Root übernimmt den Dispatch. Diese Verträge sind zur Abnahme vorgelegt, keine
laufenden Worker oder bereits gefüllte native Ready-Queue. Gemeinsame geprüfte
Basis ist `origin/main@fc85e3da33d163b9fd64c4f0163e1872940dae74`.
Jedes Paket: eigener Branch/Worktree/PR, Dateieigentum nur im genannten Paar;
keine gemeinsame Implementierungsdatei und keine Geschwister-Abhängigkeit.
Vor einem tatsächlichen Start prüft Root Modell/Quota, RAM ≥ 1,5 GiB, Cargo-
Prozesse/Buildslot und aktuelle Dateieigentümer erneut. Neue Quelle oder belegter
Konflikt wird eingegrenzt; weder alte Lease noch zugestellte Mail beweist Ende.
Bestehende Server-RED→GREEN→Review→Root-Kette je Einzelpaket wiederverwenden;
keine neue Teamdefinition, kein zweiter Dispatcher und kein QA-Bot.

**Ausführung/Reviewvertrag:** Root weist pro Paket einen vorhandenen Serverworker
zu; ein geplanter Modellname ist kein Laufzeitbeleg. Stufe A braucht zwei Familien
außerhalb des beobachteten Autors: OpenAI → Google + Anthropic; Google → OpenAI +
Anthropic; Anthropic → OpenAI + Google. Stufe B braucht eine andere Familie
(OpenAI → Google, Google/Anthropic → OpenAI). Vorhandene Root-Reviewwege:
Codex/Astra, Cursor/Gemini und Anthropic/Sonnet, keine bezahlten API-Aufrufe.
Befunde/Disposition und `NICHT ABGEDECKT` im PR, Root-Abnahme vor Ready; Mergify.
Kein Paket verändert Budget, Quotenregeln, Profile, Hooks oder Automatisierung.

**DR-04B-FU — rootloser V2-Store ohne Transport (≤ 50 ALL, Stufe A).**
- Ziel: `flushNotifications()` prüft V2-Root vor der fehlenden Transportkonfiguration;
  fehlende Root-Kennung → 503, ohne Write/Send. V1 bleibt rootlos lesbar; gültiger
  V2-Root ohne Transport bleibt `not-configured`. Keine Erweiterung der Delivery-
  Semantik, Server/CLI/UI, Dedupe oder Ledgergrenzen.
- Eigentum: nur `tools/denkraum/store/delivery.mjs` und `delivery.test.mjs` im selben
  Ordner. Root verwendet die vorhandene qfytpd-Lane oder genau einen vorhandenen
  Serverworker. Keine zweite Delivery-Lane während aktiver gleicher Datei.
- Vorgänger: #669 ist seit 16:35:44Z gemergt. Root zieht den disjunkten Schnitt
  ausdrücklich vor; #676/#681 betreffen Server/CLI, #718 UI/Playwright. Die alte
  Gesamtstack-Wartebedingung wird nur für dieses Folgepaket ersetzt.
- RED auf Basis: benannter Test `delivery.test.mjs::rootless V2 without transport
  refuses notification flush with 503`; bestehenden Store importieren/instanziieren,
  synthetische V2-Daten, kein Transport, Reject mit Code 503 und unveränderte Bytes.
  Bestehender `not-configured`-Fall muss zunächst scheitern, kein Importfehler.
- Abnahme: `node --test tools/denkraum/store/delivery.test.mjs`,
  `npm run test:denkraum`, eigene `bash scripts/ci/gates.sh lane prepush`, jeweils
  Exit 0; negative/leere/fremde-event-ID-Fälle sowie V1/gültiger Root erhalten.
  RED/GREEN am exakten Base/Head, zwei Fremdvendor-Reviews, Root-Abnahme.

**Z2-RAM-SLOTS — tatsächlichen Warm-Slot-Root nutzen (≤ 180 ALL, Stufe A).**
- Ziel: bestehendes `defaultSlots()`/CLI beachtet `PROJECTA_BUILD_SLOTS_ROOT`;
  explizites `PA_BUILD_SLOTS` behält Vorrang. Bei gesetztem Root nur dortige
  unmittelbare Verzeichnisse `projecta-a/b/c` oder `slot[1-9][0-9]*`, deterministisch;
  Dateien/fremde Namen ignorieren. Fehlender/unlesbarer/leerer Root → nachvollziehbar
  verweigern, kein stiller Main-/Home-Fallback. Ohne Root alte Defaults erhalten.
- Eigentum: nur `scripts/dev/build-slot.mjs`, `scripts/lib/dev-build-slot.test.mjs`.
  Read-only; keine Verzeichnisse anlegen, Slots reservieren, Prozesse starten/enden,
  Wächter/Timer installieren, Hooks oder `agent-setup-check.mjs` ändern. Z2-RAM-
  Gesamtziel/24-h-Messung bleibt offen. Die separate RAM-Messvermutung ist verworfen:
  Node meldet auf dem geprüften Server bereits verfügbaren Speicher.
- Beleg: CLI auf obiger Basis mit gesetztem Root listet Home-Defaults und empfiehlt
  Main, obwohl die vorhandenen warmen Server-Slots im konfigurierten Root liegen.
  Das ist ein Auswahlbefund, keine gemessene fehlerhafte RAM-/Belegtheitsmeldung.
- RED: `dev-build-slot.test.mjs::configured slot root takes precedence over home
  defaults`; bestehendes `defaultSlots()` mit synthetischem Root und injizierter
  Verzeichnisliste aufrufen, erwartete Root-Pfade prüfen. Kein neues Symbol nötig,
  bestehende Funktion ignoriert den Parameter: kompilierendes Assertion-RED.
- Abnahme: `node --test scripts/lib/dev-build-slot.test.mjs` Exit 0; expliziter
  Override gewinnt, gesetzter Root schlägt keine fremden/fehlenden Slots vor,
  Standardfall/Windows-Pfade und busy/unknown/lock-Fälle bleiben konservativ.
  `MIN_FREE_GB=2.5`, `MAX_PARALLEL=3` unverändert, keine Behauptung freien Slots aus
  Prozesslücken/Lease. Eigene prepush Exit 0; readonly CLI-Beleg mit tatsächlichem
  Root/Prozessen, Windows nur Fixture-Beleg; zwei Fremdvendor-Reviews/Root-Abnahme.

**Z2-HYGIENE-STATUS — aktuelle PLAN-Statuswerte lesen (≤ 160 ALL, Stufe B).**
- Ziel: `inProgressPackages()` erkennt neben alten `in Arbeit`/`PR #...` auch
  `In Arbeit`, `Draft #n`, `Drafts #n/#m`, `Ready #n`; kandidatrelevante PR-Nummern
  erfassen, keine Vorgänger-/historischen Nummern aus späteren Erläuterungen.
  `Erledigt`, `Blockiert`, `Pending`, `Geplant`, geparkte/historische Zeilen nicht
  als startbar oder laufend umdeuten. Keine Statuskorrektur/Promotion durchführen.
- Eigentum: nur `scripts/dev/hygiene.mjs`, `scripts/lib/dev-hygiene.test.mjs`.
  Keine PLAN-/STAND-Änderung, Fetch/Netzwerk-/GitHub-Schreibwirkung, Cache-/App-
  Plumbing, neue Abhängigkeit oder andere Hygiene-Klassifikatoren in diesem Paket.
- Beleg: bestehende Funktion auf obiger Basis liefert für drei synthetische aktuelle
  Statuszeilen `Draft #1`, `Ready #2`, `In Arbeit` eine leere Liste (Node Exit 0).
- RED: `dev-hygiene.test.mjs::current PLAN Draft Ready and In Arbeit statuses are
  recognized`; vorhandene Funktion mit begrenzter Tabelle, drei erwartete Einträge,
  Test kompiliert und scheitert gegen unveränderte Basis. Geschwister prüfen:
  alte Statuswerte, zwei Kandidaten, erklärter Vorgänger und negative Statuswerte.
- Abnahme: `node --test scripts/lib/dev-hygiene.test.mjs`, eigene prepush, Exit 0;
  `collectHygiene`-Fixture mit offenem/fehlendem Kandidaten-PR erhält korrekte Befunde,
  keine echten Remote-Schreibtests; ein Fremdvendor-Review und Root-Abnahme.

Nicht als freie Reserve zählen: R19-09 benötigt die besetzte Store-Naht;
DR-10-WIRE überschneidet sich mit der aktiven #718-UI-Dateiliste (index/ideas).
DR-05/07 und DR-12 behalten ihre wirklichen Vorgänger. Die drei Verträge oben
benötigen keine dieser Änderungen; nach Head-/Owner-Wechsel vor Dispatch neu prüfen.

### Serverreserve 2: fünf zusätzliche Startverträge (Root 08.10., 21:27Z)

Auftrag `msg-0mv01rpmz-e52b4baf`: ENTWERFEN/PFLEGEN; Root dispatcht.
Gemeinsame geprüfte Basis: `9d9eaa78e2d135bc0144809ae9712e2cda51da31`
(origin/main, #722 gemergt). Die drei #722-Umsetzungen bleiben bei den vorhandenen
Eigentümern: #725 `94eca3b`, #726 `5cb73e1`, #727 `a4e0fc9`, laut Root in Prüfung.
Sie zählen nicht als fünf neue Verträge; keine Wiederholung dieser Arbeit.

Je folgendem Paket genau ein von Root benannter bestehender Serverworker,
eigener Branch/Worktree/PR. Die fünf Dateipaare sind untereinander und zu den
beobachteten offenen Paket-PRs disjunkt. Keine Rust-Naht, package.json, gemeinsamen
Helfer oder Gates ändern; kein ausstehender Implementierungsvorgänger.
Root prüft vor Dispatch frische Datei-/Prozessbesitzer, tatsächliches Modell,
Kontingent, RAM ≥ 1,5 GiB, Cargo und freien Build-Slot. Lease/Queue/Mail beweisen
kein Prozessende/Start. Kein neuer Agent, kein zweiter Dispatcher.
Vorhandene einzelne RED → GREEN → unabhängiges Review → Root-Ketten reichen;
ein neues Team würde bei diesen einstufigen Dateipaaren keine Übergabelücke lösen.

Root routet Codex unter 98 %, Cursor auto, Claude sparsam. A bei OpenAI-Autor:
Kimi und GLM über den von Root freigegebenen bestehenden Ollama-Credit-Weg;
bei Anthropic-Autor OpenAI plus Kimi oder GLM. B: eine andere Vendorfamilie.
Bei Cursor auto zuerst tatsächlichen Autorenvendor belegen, dann andere wählen;
Transportname ist kein Vendor-/Modellbeleg. Je Review Kandidaten-SHA, beobachtetes
Modell, Befunde mit Datei:Zeile und Disposition. Keine Kappen-/Reset-/Installations-
oder zusätzliche API-Ausgabenentscheidung. Root nimmt Kopf ab; danach Ready,
Merge nur Mergify. Diese Dokumentation selbst ist C, keine Umsetzung/Abnahme.

**Z2-PR-PROTECTION — ehrliche Bereitempfehlung (≤ 160 ALL, B).**
- Ziel/Beleg: `buildRows` liefert auf der Basis bei drei grünen CI-Jobs plus
  roter `Mergify Merge Protections` trotzdem „bereit“. Fehlende/rote/laufende
  Protection darf keine Bereitempfehlung ergeben.
- Exklusiv: `scripts/dev/pr-status.mjs`, `scripts/lib/dev-pr-status.test.mjs`.
  Nichtziele: YAML/Branch-Protection/CI/Ready/Labels ändern. Die `REQUIRED`-Liste
  der drei YAML-Jobs separat erhalten; externe Protection zusätzlich prüfen,
  keinen erfundenen CI-Job in den bestehenden YAML-Shape-Test aufnehmen.
- Kompilierendes Rot zuerst: `dev-pr-status.test.mjs::red merge protection
  prevents ready recommendation`; bestehendes `buildRows` mit drei SUCCESS-
  CheckRuns plus roter Protection aufrufen, „bereit“ ausschließen.
- Abnahme: Protection fehlt/pending/rot/grün; unbekannt ist keine Freigabe,
  NEUTRAL/SKIPPED nur gemäß tatsächlichem Schutzvertrag. Beobachteter Queue-PR
  bleibt „in Queue“ ohne Mergeversprechen. Draft/do-not-merge/Konflikt-Prioritäten
  erhalten; Protection in Tabelle/JSON, Shapes nur im eigenen Test anpassen.
  `node --test scripts/lib/dev-pr-status.test.mjs`, eigene volle prepush Exit 0,
  ein Fremdvendor-Review; NICHT ABGEDECKT: tatsächliche Queue-Zulassung.

**Z2-STATUS-UNKNOWN — unbekannt ist kein Grün (≤ 140 ALL, B).**
- Ziel/Beleg: `checkState` liefert für `StatusContext.state=UNKNOWN` derzeit
  `green`. Unbekannt/leerer Kontext wird pending; `classify` nennt PRs ohne
  Checks nicht „grün, wartet auf die Queue“.
- Exklusiv: `scripts/dev/status-report.mjs`,
  `scripts/lib/dev-status-report.test.mjs`. Nichtziele: pr-status, GH_CALLS,
  Limits, Tagesgrenze, Output-Pfad oder Remote-Zustand ändern.
- Kompilierendes Rot zuerst: `dev-status-report.test.mjs::unknown status
  context is pending rather than green`; vorhandenes `checkState` mit UNKNOWN
  aufrufen, pending erwarten. Zweites Rot für Bericht ohne Checks.
- Abnahme: SUCCESS/PENDING/EXPECTED/FAILURE/ERROR, leer/unbekannt, CheckRun-
  Schlusswerte, fehlende Rollups; failing vor pending. Leere Checks bleiben
  `none`; Bericht behauptet keine Prüfung. Main-Rot, Draft-/Queue-/Konflikt-
  Zählung und 25-Zeilen-Grenze erhalten. `node --test scripts/lib/dev-status-report.test.mjs`,
  eigene volle prepush Exit 0, ein Fremdvendor-Review;
  NICHT ABGEDECKT: live GitHub-Gesamtzustand.

**Z2-START-MEASURE — kaputte Messwerte stoppen (≤ 160 ALL, A).**
- Ziel/Beleg: `checkRam(NaN)` und `checkUsage({})` liefern auf der Basis `ok`.
  Nicht endliche/negative RAM-Werte, leere oder inhaltlich ungültige vorhandene
  Usage-Daten müssen STOPP ergeben, kein OK/Exit 0 als Messbeleg.
- Exklusiv: `scripts/dev/start-check.mjs`, `scripts/lib/dev-start-check.test.mjs`.
  Nichtziele: build-slot/#725, Defaults/Grenzen/Kontingente ändern, neue
  Messquelle, Prozessaktion, Hook/Scheduler. Kein --usage/fehlende Datei behalten
  dokumentierten Warnmodus; Root muss Pflichtbelege separat einholen.
- Kompilierendes Rot zuerst: `dev-start-check.test.mjs::invalid measurements
  cannot pass start check`; bestehendes `checkRam` mit NaN muss stopp liefern;
  getrennte Rotprobe für vorhandenes leeres Objekt über `checkUsage`.
- Abnahme: NaN/Infinity/negative RAM-Werte, leeres Usage-Objekt, negative/nicht
  endliche Prozentwerte; gültige Null/Schwellen und normale CLI-Aufrufe erhalten.
  Injizierter kaputter CLI-Messwert gibt Exit 1/JSON `ok:false`. Warnungen nicht
  als gemessene Freigabe ausgeben. `node --test scripts/lib/dev-start-check.test.mjs`,
  eigene volle prepush Exit 0, zwei Fremdvendor-Reviews;
  NICHT ABGEDECKT: 24-h-RAM-Ziel, realer Start und vollständige Gateautomatisierung.

**Z2-CIWATCH-SHAPE — kaputte Check-Liste verweigern (≤ 140 ALL, B).**
- Ziel/Beleg: `watchChecks` stürzt bei syntaktisch gültigem JSON `[null]` mit
  TypeError ab. Ungültige Check-Einträge müssen kontrolliert Exit 3 liefern,
  keine grüne Aussage, kein Folgepoll und kein ungefangener Absturz.
- Exklusiv: `scripts/dev/ci-watch.mjs`, `scripts/lib/dev-ci-watch.test.mjs`.
  Nichtziele: echter Watcher/Command/Workflow starten, gh-Aufruf/Pollbudget,
  Standardintervalle, Karenz oder Status-/Quota-/Retrypolitik ändern.
- Kompilierendes Rot zuerst: `dev-ci-watch.test.mjs::malformed check entries
  refuse without polling`; vorhandenes `watchChecks` mit injiziertem Runner
  (code 0, stdout `[null]`) aufrufen, Ergebniscode 3 statt Rejection erwarten;
  Schlaf darf nicht aufgerufen werden, Runner genau einmal.
- Abnahme: null/primitive Einträge, fehlender/leerer Name oder bucket geben
  Exit 3 mit begrenzter Diagnose. Gültige pass/fail/cancel/skipping/pending-
  Fixtures, leere Liste/Karenz, Timeout und unbekannter nichtleerer bucket als
  pending behalten ihren Vertrag; kein vorschnelles Grün. CLI mit Fake-Runner
  bestätigt Exit 3. `node --test scripts/lib/dev-ci-watch.test.mjs`, eigene
  volle prepush Exit 0, ein Fremdvendor-Review;
  NICHT ABGEDECKT: live GitHub-Fehler oder tatsächlicher Langzeit-Watchlauf.

**Z2-MRP-COMPLETE — unfertiges Log nicht mitzählen (≤ 120 ALL, B).**
- Ziel/Beleg: rounds 1 plus `n high / n other` liefert derzeit `filled:true`/0/0.
  Nur numerische rounds UND findings sind gefüllt; Platzhalter sind kein Nullbefund.
- Exklusiv: `scripts/dev/mrp-count.mjs`, `scripts/lib/dev-mrp-count.test.mjs`.
  Nichtziele: Template/Bench/Workflow/Paketbranch-Regel ändern oder neue
  Prompt-Pflichten; nur vorhandene M-RP-Messdefinition korrekt lesen.
- Kompilierendes Rot zuerst: `dev-mrp-count.test.mjs::partial prompt log
  placeholders are not complete evidence`; bestehendes `parsePromptLog` mit
  rounds 1/Platzhalter-findings aufrufen, `filled:false` erwarten.
- Abnahme: fehlende/teilweise/nichtnumerische findings nicht withLog; gültige
  0 high / 0 other, rounds 0–2 und vollständige Logs bleiben gültig. `countRp`
  und vorhandener `measure`-Fixture-Aufruf belegen Zähler/Nenner/Fixrunden-
  Zuordnung ohne Bench-Datei-/Netzwerkänderung. `node --test scripts/lib/dev-mrp-count.test.mjs`,
  eigene volle prepush Exit 0, ein Fremdvendor-Review;
  NICHT ABGEDECKT: allgemeine Prompt-Adoption oder Wirksamkeit.

Evidenzgrenze: vier ausführbare Assertions und die ungültige Check-Probe waren RED;
explorative Proben, keine committed Test-First-/Fixbelege. Worker schreiben zuerst
die benannten Regressionstests und binden Rot/Grün an ihre Basis/Köpfe.
Graphwerkzeuge waren nach Tool-Katalog-/Runtime-Prüfung nicht gebunden; bekannte
Hilfsdateien und Tests wurden direkt gelesen. W118B-PROFILE #678 ist seit
15:58:08Z gemergt, kein neuer Start. DR-13/14 bleiben nach DR-12, KI-30 beim
laufenden Owner; kein Sibling-Fix ohne Eigentumsabgrenzung. Der ebenfalls belegte
Multi-Naht-Parserfall zählt nicht mit: #574 berührt dessen Testdatei und ist
noch nicht disponiert. CIWATCH ersetzt ihn mit einem unabhängigen Dateipaar.
Diese fünf Z2-Paare
benötigen keinen der blockierten Pfade.

### Anpassungsnachweis DR-15a und Übergaben (08.10. 04:40 UTC)

Anlass/Beleg: Root las den wirklichen CLI-Alias-Rotnachweis und `f78122d`;
G1 erlaubt die konkrete inverse Teilung (Disposition im Ticket 55ea21ce).
Vorher: #639 enthielt Basismodul und bereits geprüfte CLI-Korrektur, 247 ALL.
Änderung: eigener Baseline-Entwurf am unveränderten `5f501f1`; #639 bekommt
nach Retarget das echte CLI-Delta von 37 ALL. R1/R2 bleiben an der Baseline,
kein drittes Ganzreview, keine Fix- oder Gate-Wiederholung wegen der Topologie.
Rest/Abnahme: beide Drafts, zwei tatsächliche Fremdvendor-Reviews am CLI-Delta,
Root-Abnahme und Integration in Reihenfolge #635 → Baseline → CLI.
Nächster Schritt/Owner: Baseline-Branch/Worktree sind beim Codex-Owner vorbereitet;
nach geprüftem PLAN-Ref publiziert er den Draft und retargetet #639. Danach folgt
der minimale ENTRYPOINT-Kompatibilitätsfix im CLI-Paket.
Root maß Node 24.0: gültig kompilierender Test rot (`0 !== 1`, kein Skip);
Node >= 24 bleibt erhalten, STATE-Auflösung bleibt 15b. Neuer Head braucht eigene
Gates und die zwei ersten CLI-Delta-Reviews. Chief bleibt alleiniger PLAN-Editor.
GOALS-A/C-Handover ist angenommen; GOALS-B-Merge und allgemeine Adoption bleiben
offen. Die abgenommenen #643/#644-Köpfe bleiben für ihre Mergekette unverändert.
HOOK-Anleitung läuft im eigenen P2-Dokumentationspaket parallel ohne Z1-Dateien.

### Anpassungsnachweis PLAN-C1

Anlass: Root-Prüfung von #642 am 6183605 meldet 2068 ALL > 300 und konkrete
Status-/Regelwidersprüche. Vorher: ein kombinierter, nicht abgenommener Entwurf.
Änderung: zuerst der vollständige aktive Z1–Z4-Kopf mit GOALS-A/B/C; alter Bestand
bleibt wortgleich als Historie und Parserquelle im selben PLAN. #642 und Audits
bleiben erhalten. Rest: Archivierung/Bereinigung in eigenen kleinen Paketen,
GOALS-B samt Z2-RULE10 und betroffene Delta-Belege; Anforderungen bleiben gleich.
Abnahme dieses Schnitts: DF-Bestand bytegleich, M1–M5 parsebar, Pointer in STAND
zeigen Z1, ≤ 300 ALL und prepush Exit 0. Nächster Owner: Chief legt den Kandidaten
Root vor; Root nimmt ab, erst danach Ready/Queue. Merge/Wirksamkeit separat melden.

## Entscheidungs-Inbox

| # | Frage | Empfehlung | Status |
|---|---|---|---|
| E14 | Update-Signierschlüssel offline sichern | ja, verschlüsselt in den Passwort-Manager; ohne Kopie geht das Update-Vertrauen bei Verlust verloren | offen, dringend |
| DR03-F01 | Gesamtgröße des Ledgers begrenzen: WRITE-/Listenlimits getrennt von harter SAFE-READ-/Vor-Parse-Bytegrenze, alle Top-Level-/Nested-Listen, Bestandslesen/503 und spätere Konfigänderungen disponieren | neue übergroße Writes nichtdestruktiv ablehnen; keine Trunkierung/Archivierung/Retention; keine Lesbarkeitszusage jenseits sicherer Lesegrenze; erst repräsentative reale Ledgerform/-größe/-kosten, keine erfundenen Grenzwerte | offen; Interview-Vorbereitung im bestehenden Ticket, Empfehlungen keine Entscheidung; zwei Nutzerfragen bis Belegbasis bei Root geparkt, gesamte DR-03-Abnahme offen |
| V16-F3 | Start nach Update ohne Journal: gesperrt bleiben mit Anleitung, oder dem ersten Start vertrauen? | gesperrt mit Anleitung (fail-closed) | offen |
| V16-F4 | Review-Fahrer auf den Server? | ja | offen |
| V16-D2 | ARCH-D2 vor V16-06 ziehen, weil V16-06 auf V16-F3 wartet? | ja, Lane mn ist frei | entschieden: Root-JA, Übergabe vom 08.10. `msg-0muzkavts-72d53e4b`; `srv-v16-arch-d2` ist exklusiver mn-Owner; Start ist keine Abnahme |
| WT | Gemini-/Cursor-Weg auf dem Server: Workspace Trust für den Review-Ordner | nur für den Review-Ordner | entschieden: Nutzerfreigabe F1 (08.10.) |
| Z2-RECHTE-E5 | Veraltete Reset-/RH-C9-/Force-push-Regeln durch geltende V3-Disposition ersetzen | Originale erhalten, aktuelle Quellenbindung dokumentieren | entschieden: Elias-Ja laut Root (08.10., 15:26Z; `msg-0muzow0w0-d9db7d39`); 98-%-Resetfreigabe samt Ergänzung gilt unter ihren Bedingungen; alte RH-C9 ersetzt; Force-push weiterhin verboten. E1–E4 entschieden; E2-Hostbindung ist verbleibende Pilot-Zulassung, keine erneut offene Grundsatzfrage |
| R1–R5 | Regel-Vorschläge: Stufe A neu fassen; 300-Zeilen-Grenze ohne Tests/Hilfsdateien; RAM-Gate nur für schwere Arbeit; Review-Bündel = Diff + Abhängigkeiten; Pacer-Trigger ohne Einschränkung, aber nur lesend | einzeln entscheiden | offen |
| V2-OFFEN | v2.0-Fragen 5–9 und 11 | nach Z1 | offen |
| PR-ALT | Draft-PRs #613, #614, #574 (Autor Grok bzw. alte UI-Richtung): schließen oder übernehmen? | #613 mit Z2-PLANPARSER abgleichen, dann schließen oder übernehmen; #614/#574 parken | offen |
| E3 | Secrets in geschützte Environments, Required Reviewers für `release` | ja, einmal im Browser | offen |
| E15 | Bleibt der gemietete Server? (laufende Kosten) | nach v1.6.0 mit Nutzen und Kosten bewerten | offen |
| E16 | Lizenz und Geschäftsmodell vor externen Testern | vor V16-03 entscheiden | offen |
| E17 | Alte Arbeitsbäume löschen (mit Backup) | ja, zusammen mit Z4-SERVER-DISK | offen |
| M4-B | M4-Blocker `planning_access`: Projektrahmen mit #306 gemergt; TOCTOU weiter offen laut Z4-VERIFY@`a167486` | AUTH und vier Schreibpfade seriell beheben; keine M4-Aktivierung aus Bericht ableiten | offen; Quellbefund, kein neues Laufzeitrot/Exploit-/Fixbeleg; Z4-M4B-0 bis 4 erforderlich |
| E18 | Matrixzeile 3: `resume` weiter gesperrt lassen oder urteilsgebunden bauen? | Sperre beibehalten, bis entschieden | offen; Nutzerbestätigung unbelegt |
| E21 | Matrixzeile 2: Schalter gebaut und gesperrt; Einschalten später? | gesperrt lassen | offen; Nutzerbestätigung unbelegt |
| E22 | Matrixzeile 16: unabhängigen Review im PR am selben Kandidaten anerkennen? | getrennt von einer App-Freigabe entscheiden | offen; Nutzerbestätigung unbelegt |
| E23 | Benchmark mit fünf Aufgaben durchführen? Er verbraucht Abo-Kontingent | nur nach Nutzerfreigabe laufen lassen | offen; Nutzerfreigabe erforderlich |
| TODO | Interne Liste des Koordinators: Copilot-Budget, Groq/OpenRouter-Keys (widerspricht „nur Abos“), Geldmodus | veraltete Punkte streichen | offen |

## Entschiedene Fragen

PLAN-1 ist durch PLAN-L0-SINGLE entschieden (07.10.): `docs/PLAN.md` bleibt
der einzige Plan, v2.0 ist ein Unterplan. Q10 ist ersetzt; V2-FREEZE-1a/1b entfallen
in ihrer alten Form, die Parser-Pflege übernimmt Z2-PLANPARSER.
Der öffentliche Repo-Neustart ist erledigt: `c60f267` „Initial public release of ProjectA“.
E1–E13 (außer E3), E19, E20, E24, E25, F1–F6, N1, N2, R19, W5-02b3 und
ARCH-D4-PLAN stehen im Archiv und werden nicht neu gefragt.

## Historischer Vertrags- und Parserbestand (Übergang)

Die folgenden bisherigen Tabellen, Prioritäten und Inbox-Texte sind historisch.
Sie begründen keine zusätzlichen Aufträge und ersetzen keine oben bestätigte
Entscheidung. Bestehende Antworten/Verträge bleiben erhalten; M1–M5 und alle
DF-Zeilen bleiben als Parserquelle wortgleich, bis ihre Leser gezielt umgestellt
und die kohärenten Archivpakete geprüft sind. Nur die Z-Tabellen oben disponieren.

## Aktive Ziele und verbindlicher L0-Schnitt

[Ideenfließband V1.0](#ideas-l0-v1-0) steht vollständig mit unveränderten 198 Zeilen in diesem Dokument als historischer Anforderungs-/Übergabestand. Aktuellen Status, Freigaben und Verträge führt ausschließlich dieser Masterkopf. Cloud-/Assistentenfassungen sind historische Übergaben, keine synchronisierte zweite Planquelle; PA r05iwt erhält den bestätigten Ref erst nach Integration.
Root-Auftrag und Site-Amende: Child `ec223b75-7972-4555-a442-43e0e32c8fcd`, Chief-Mail `msg-0muy8gvba-939fb23b`, 07.10.2026 14:59 UTC. PM besitzt nur diesen Dokumentenschnitt, Gesamtowner IDEAS-L0 ist Root; Chief disponiert, Root prüft FIT und nimmt ab.
Vorhersage vor Vorbereitung: vorhandener Masterplan plus kompletter Teilplan spart eine neue Planarchitektur und macht L0 ohne Editor/Graph ausführbar. Unvalidiert; ein Dokumentabschluss beweist keine nutzbare Lieferung.

| Ziel / bestehender Auftrag | Wirkung, Umfang / Nichtziele | Owner / Vorgänger | Abnahme / Evidenz / Status | Nächster Schritt / Blocker / Stand UTC |
|---|---|---|---|---|
| IDEAS-L0 / PLAN-L0-P0 `ec223b75-7972-4555-a442-43e0e32c8fcd` | dauerhaft erfassen, bearbeiten, wiederfinden; kein Planeditor/Graph/Pilot/Autorecherche | Root Gesamtziel; PM cwqxbk Dokument; Backend mctdww; UI d567gh; Chief Integration/FIT an Root | P0 In Prüfung; Vorbereitung tatsächlich15:05:57Z, Source noch nicht gestartet; Produktlieferung offen; Quellbasis oben, V1.0-SHA329a53ca…124b2c; Zuweisung ist kein Runtime-Start | vollständiger Diff/Metadatenvertrag → Root; anschließend Backend/UI und echte Nutzerabnahme; 07.10.15:00:47 |
| DD-RECEIPT `285001a5-ede9-4940-b039-42d0dd892e96` | bestehende Frage-Quittungsanzeige, disjunkt zu L0 | alleiniger UI d567gh; bestehender V2-Receiptvertrag | Verschoben nach L0; Child pending, Root15:10:09Z; 495 ALL NOT FIT, unimplementiert | ganze Programme/23 Fälle/Pins erhalten; keine zweite Revision/Integration; Frageanzeigebug blockiert Ideensammlung nicht |
| V16-ARCH-D4 `b9606dd4-4dab-460c-9229-a47699702f6d` | restliche API-Entlastung; kein L0-Vorgänger/Releasebeleg | alleiniger API-Owner Root; Part4 Mergify #629 auf3db3407 | In Prüfung laut Root15:20Z: [PR631](https://github.com/Cuarroc/ProjectA/pull/631)/1d4b5bc, eigene Gates0, beide CI37631238380 erfolgreich, Sonnet ACCEPT; kein Merge | zweiter Vendor403, Reviewgate offen; keine frische PM-CI-/Sourceprüfung, Chief API seriell |

Verbindliche acht Nutzerstatuswerte: Root-Original `msg-0muy9i618-c05a9ee8`, 07.10.2026 15:28:14.348 UTC, vollständig im P0-Child; Chief-Mail `msg-0muy9ivvz-44910681`. B-STATUS ist damit geklärt. Zuweisung allein ist nicht In Arbeit.

| Status | Bedeutung |
|---|---|
| Geplant | beschrieben, noch nicht ausführungsbereit |
| Bereit | Voraussetzungen und Abnahme geklärt |
| In Arbeit | tatsächliche Bearbeitung begonnen |
| In Prüfung | Ergebnis vorhanden, Abnahme offen |
| Erledigt | Abschlusskriterien erfüllt und belegt |
| Blockiert | konkrete Voraussetzung verhindert Fortsetzung |
| Verschoben | bewusst späteres Lieferfenster |
| Entfallen | durch dokumentierte Entscheidung aus Umfang genommen |

### L0-Mapping auf vorhandene Arbeit

P0 im importierten V1.0-Text = PLAN-L0-P0; dieser Schnitt besitzt ausschließlich `docs/PLAN.md` (Tier C). Keine Runtime-/Gate-/Supportänderung; kompletter materialisierter Diff einschließlich Unterstützung muss ≤300 ALL sein.
P1 = bestehender DD3b `b0e90b72-c328-4fe5-8c12-b158c8ab6e83`, alleiniger Backendowner mctdww: Store/API-Vertrag, Metadaten, Daten-/Replay-/CAS-Regressionen; keine UI-Dateien. Bestehende DD1/DD3a-Vorgänger done laut Ticket; DD3b insgesamt weiter offen.
P2 = bestehender DD2 `6713479b-4e9b-46a6-98f4-3b8c0c76344f`, alleiniger UI-Owner d567gh: Eingabe/Liste/Detail, Suche/Filter/Sortierung, Entwürfe und Stationsband; keine Store-/Serverdateien. Start erst nach Root-FIT des P1-Vertrags und Chief-Abgrenzung der freigegebenen UI-Dateien; keine neue parallele Ticketserie.
P3 = Chief/Root bestehende Betriebs-/Integrationsverantwortung nach P1/P2: Backup, kontrollierte Integration und tatsächlicher Nutzerzugriff. Ein neuer Child/Arbeitsbeginn ist hier nicht behauptet. HTTP200 lokal ist kein Handy-/Öffentlichkeitsbeleg.
P4–P10 bleiben mit allen Originalanforderungen im folgenden V1.0-Abschnitt; keine vorgezogene Umsetzung. Teil02-A `73aa18e3-8f3b-4f92-93e8-279e858b6d01` ist nach L0 verschoben, Original/tests/transport/pins erhalten; kein dritter Lauf. Studio `7e16930a-2dee-449b-ad8c-7ed642d8bb7b` und Pilot `44ac79d9-48fb-4fb7-8eb7-ee35608bd964` sind keine L0-Abhängigkeiten.
B3-Store ED6A560E und W3-r app51C5D7E8 sind Root-berichtete deployte Quellen, keine frisch hier auditierte oder synchronisierte Workbench/PlanDraft-Komposition. Angenommen, integriert, erreichbar und abgenommen bleiben getrennt. Backend/UI prüfen ihre vollständige tatsächliche Basis vor Source-Start.

### Modellzuordnung: geplant, konfiguriert, wirksam, erfolgreich benutzt

Direkter Nutzerauftrag/Root-Amende07.10.: nur Fable5.1, Opus5.5, Sonnet5.5 und Codex; kein älterer stiller Fallback. Pflege dieses Abschnitts Root/PM, Dispatch ausschließlich Chief. Kein Wechsel laufender PM-/Backend-/UI-Kontexte. Tabelle Stand Root-Beleg15:09Z/Chief-Mail `msg-0muy8wfxd-8b83643c`; Planung ist keine Ausführungs-/Qualitätszusage.
| Rolle / vorhandener Owner | Geplant (Begründung) | Konfiguriert | Wirksame Sitzung | Erfolgreich benutzt / datierter Beleg |
|---|---|---|---|---|
| Root / Chief | Codex Sol/medium für Priorität/Integration, laufenden Kontext halten | kein Wechsel in diesem Paket | exakte neue Turn-/Startbelege beim jeweiligen Owner; hier nicht frisch geprüft | bisherige operative Arbeit; keine neue Modell-/Qualitätsmessung |
| PM cwqxbk | Codex Sol; Sonnet5.5 nur bei Bedarf am sauberen Übergang für begrenzte Doku | unverändert; Ticketalias opus ist kein Threadbeleg | eigener turn_context07.10.15:25:49Z: gpt-6.1-sol/medium; served unbekannt | P0-255ALL-Materialisierung15:05:57Z, keine Sonnet-PM-Sitzung |
| Backend mctdww / UI d567gh | laufendes Codex bis L0-Handoff, Autor-/Evidenzbindung erhalten | keine Umstellung | neue eigene Owner-Startbelege erforderlich | vorhandene Paketbelege bleiben kandidatengebunden; kein L0-Erfolg behauptet |
| Reviewer jl1dcg | Sonnet5.5/high für fremde OpenAI-Kandidaten, vorhandenes R1 wiederverwenden | offline: Alias sonnet + cliOptions `--model claude-sonnet-5-5`, Effort high gespeichert/readback (Root) | neuer Sidebar-Start mit Pin unbewiesen | echtes Sonnet5.5-R1 laut Root; kein zweiter Vendor durch anderen Claude-Modellnamen |
| Implementierer et2cqi | Opus5.5/medium für schwierige isolierte Umsetzung | offline: opus-5.5[1m] + `--model claude-opus-5-5`, Effort medium gespeichert/readback (Root) | neue Implementierersitzung unbewiesen | Root-Serverprobe15:05:08.355Z: actual0/MODEL_ACCESS_OK, modelUsage claude-opus-5-5/firstParty; Zugriff, keine Implementierungsqualität |
| Architekturberater dga50i | Fable5.1/high für konkrete folgenreiche Architekturfrage | offline: fable + `--model claude-fable-5-1`, Effort high gespeichert/readback (Root) | neue Beratersitzung unbewiesen | Root-Serverprobe15:05:10.969Z: actual0/MODEL_ACCESS_OK, modelUsage claude-fable-5-1/firstParty; Zugriff, keine Beratungsqualität |
Root-Beleg im P0-Child15:11:10Z: vorhandene PC/server CLIs2.1.291/2.1.287, Max/claude.ai/firstParty; native full-ID-Picker wurde abgewiesen, Alias blieb. cliOptions-Readback gilt nur für nächsten Start; keine wirksame Sitzung daraus. Proben/MCP-/Tool-/Writes deaktiviert; keine API-Key-/PAYG-/Installfreigabe.
Kontingente sind datiert: PM native Codex21% USED/Session unbekannt; Root Claude27% Session/2% Woche (15:01Z), keine neue Quotenmessung hier. Vor jedem echten Start frische Auth/Quota/RAM/Naht-/Modellbelege. Zugriff auf Modell ist keine Source-Review/FIT-/Lieferabnahme.
Alle Claude-Modelle gehören zum selben Anbieter. Tier A benötigt weiterhin zwei geeignete andere Anbieter als der Autor; zweiter Fremdanbieter ist laut Root offen (Zen/NVIDIA403, kein RAMfehler). Root qualifiziert bestehenden authentifizierten zulässigen Weg; bis tatsächlichem gebundenem Review sichtbarer Blocker. Keine zusätzlichen Reviewer/Agenten/Quota-/Runtimeänderungen.

### Minimaler additiver Ideenmetadatenvertrag (Root-Disposition 07.10.15:20 UTC)

Root15:20Z hat flache optionale Request-/Revisionsfelder genehmigt (ersetzt den früheren Envelope-Vorschlag): `category` = getrimmter Text ≤80 UTF-16-Codeunits, leer erlaubt; `userPriority` = `urgent|high|normal|later` (UI dringend/hoch/normal/später). Keine Pflichtoptionen zur Freitextidee, keine Metadaten im Originaltext und keine neue Schema-/Jobarchitektur.
Fehlende historische Metadaten nur lesend als `category=""` (UI „Nicht eingeordnet“) / `userPriority="normal"` projizieren; alte gespeicherte Objekte, Originaltexte, Request-Payloads und Antwortbytes nicht rückwirkend umschreiben. `questionPriority` ist niemals `ideaPriority`/`userPriority`.
Neue explizite Metadaten werden Teil der normalisierten Request-Identität und des neuen append-only Ideensnapshots; gleicher RequestId/geänderte Metadaten muss409 bleiben. Bei vollständig ausgelassenen Metadaten exakt den bisherigen kanonischen Replaypfad/Bytes erhalten; historische Replays bleiben historische Antworten.
Neue CAS-Revisionen übernehmen bei ausgelassenen Feldern die aktuelle Kategorie/Priorität erst nach der bestehenden Replayprüfung; historischer Replay wird nicht neu ausgerechnet. Nur explizite Eingabe ändert Werte, kein Default-Reset. Neues Schreiben verlangt explizite CAS-Revision, veralteter neuer Edit409; vorhandene atomare Schreib-/Recoverypfade verwenden.
Titel/Text/Quelle/Herkunft und alte Ideen-/Fragen-/Antwort-/Receipt-/Planreferenzen erhalten; `actor/source` sind Provenienz, niemals Freigabe. `incoming` heißt Eingang, nicht bereits geprüft; automatische Bewertungen bleiben sichtbar ungeprüft. Vormerken erzeugt keinen Agentenauftrag und keine Root-/Nutzerfreigabe.
Pflichtkompatibilität P1: alte Requests/byteidentischer Replay nach Neustart; neue Defaults, alle vier Prioritäten, Kategoriegrenze; Metadaten-only Edit, omit-preserve, changed-request409, stale-CAS409; Fehlwrite/Retry ohne Datenverlust; unveränderte Geschwister/Receipt-/Provenienzfälle. Tatsächliche Tests erst im zuständigen Paket, nicht hier behauptet.
P2 liest nur erkannte Felder, sucht Text/Titel, filtert Kategorie/Priorität/Station und sortiert stabil; zeigt Herkunft und „Noch nicht geprüft“ sowie vollständiges Stationsband mit unfertigen Stationen „Wird ergänzt“. Alte Inhalte ohne Felder bleiben bedienbar; Wechsel zur tatsächlich gewählten Idee gegen erhaltenen ungesicherten Entwurf prüfen, bevor Bearbeiten als geliefert gilt; kein Editor/Graph als Voraussetzung.
L0-Abnahme: Elias speichert drei Ideen, bearbeitet eine samt Kategorie/Priorität, sucht/sortiert, lädt neu; Inhalt bleibt gleich. Speicherfehler erhält den Entwurf; CAS-Konflikt/replay/restart verlieren nichts. Funktionierender Nutzerlink mit Zugriffsvoraussetzungen und tatsächlicher Prüfung, relevante unabhängige Reviews und kontrollierte Integration sind erforderlich; P0-Dokuabschluss erfüllt dies nicht.

<a id="ideas-l0-v1-0"></a>

## Ideenfließband-Anforderungen und historischer Übergabestand (V1.0)

Der folgende vollständige Originaltext ist unverändert importiert (SHA329a53ca…124b2c, 198 Zeilen). Sein Lieferprotokoll/Statuslog und seine Cloud-/Ticket-Pflegebeschreibung sind historischer Übergabestand; ausschließlich der obige PLAN-Kopf und aktuelle datierte Dispositionen führen Status/Freigaben. Unterpläne entstehen erst mit abhakbarem Umfang; hier wird keine weitere Plandatei angelegt.

<!-- PLAN-L0-P0 V1.0 BEGIN -->
# ProjectA: Ideenfließband – Umsetzungsplan
Version 1.0 · 7. Oktober 2026 · Auftraggeber: Elias · Ausführungsverantwortung: bestehender ProjectA-Orchestrator

## 1. Verbindlicher Auftrag und erste Lieferung

Elias möchte jetzt möglichst bald Ideen im Denkraum erfassen, langfristig sammeln, geordnet wiederfinden und bereits erste Einordnungen sehen. Die Oberfläche soll während ihrer Weiterentwicklung benutzbar bleiben. Das vollständige Fließband wächst um diesen nutzbaren Kern herum. Neue Ideen sollen laufende Entwicklungsarbeit nicht unterbrechen.

Diese Anweisung autorisiert den Orchestrator zur Umsetzung dieses Produktausbaus, zum Einsatz seiner Agenten, geeigneter Workflows und des vorhandenen Servers. Vorhandene Kosten-, Sicherheits- und Betriebsgrenzen bleiben verbindlich; „volle Power“ ist keine unbegrenzte Beschaffungserlaubnis. Der Orchestrator organisiert verfügbare Kapazitäten selbst und meldet konkrete Grenzen statt pauschal auf weitere Freigaben zu warten. Es wird keine neue QA-Bot-Delegation beauftragt.

**Lieferziel L0: Elias kann die Website öffnen, eine Textidee speichern, nach Neuladen wiederfinden, bearbeiten und nach Kategorie, Wichtigkeit und Bearbeitungsstand sortieren.** Ein sichtbarer Abschnitt „Noch nicht geprüft“ verhindert, dass erste Vermutungen wie fertige Bewertungen erscheinen. Eine einfache Stationsübersicht zeigt, wo Ideen stehen. Die aufwendige Graphansicht, automatische Recherche und komplette Patchplanung dürfen diese erste Lieferung nicht blockieren.

**Nach L0 folgen unmittelbar** dateibasierte Anhänge, nachvollziehbare automatische Einordnung und die Planungspipeline. Falls vorhandene Funktionen sichere Anhänge oder Kategorien bereits unterstützen, in L0 wiederverwenden; keine funktionsfähigen Teile künstlich zurückhalten.

Für L0 zunächst den vorhandenen erreichbaren Denkraum nutzen. „Live“ bedeutet zuerst eine tatsächlich erreichbare, geprüfte Nutzeroberfläche auf dem vereinbarten Zugangsweg. Lokales HTTP200 beweist weder Zugriff vom Handy noch eine öffentliche Bereitstellung. Der Orchestrator nennt den funktionierenden Link und seine Zugriffsvoraussetzungen. Serverbetrieb bevorzugt vorhandene authentifizierte Verbindungen; private Inhalte werden nicht ungefragt öffentlich exponiert.

## 2. Ausgangslage und Evidenzgrenze

Dieser Plan baut auf ProjectA-Projektnotizen und Backlogständen sowie dem aktuellen Nutzerauftrag auf. Er ist kein neuer Quellcodeaudit und keine abgeschlossene visuelle Abnahme.

Dokumentiert sind ein revisioniertes lokales DeskStore-Ledger, Workbench-Ausarbeitungen, Planentwürfe mit festen Ideenreferenzen sowie ein bestehender API-/UI-Unterbau. Die Notizen nennen GET /api/state, GET /api/inbox und POST /api/plan-drafts. Vor Erweiterungen prüft der jeweilige Owner den aktuellen Vertrag im tatsächlichen Quellstand; hier werden keine zusätzlichen Endpunkte als bereits vorhanden behauptet.

Die Projektmemory vom 07.10.2026 berichtet wiederhergestellte Denkraum-Erreichbarkeit auf localhost:4791 mit HTTP200. Zugleich wurde Planeditor-Teil02 A-R1 wegen mindestens315 statt erlaubter300 ALL-Zeilen terminal als NOT FIT geparkt. Der vollständige Planeditor darf deshalb nicht stillschweigend Voraussetzung der ersten Ideensammlung werden. Die Root-Disposition für bestehende Paketregeln bleibt erforderlich. Bei einem Split funktionale Fälle und vollständige Transport-/Testbestandteile erhalten; keine versteckten Hilfsprogramme oder automatische weitere Vorbereitungsrunde.

Bestehende Referenzen für die Arbeitszuordnung:
- Planeditor-Gesamtumfang: 41e7c585-21e5-42b7-8085-5edb1c12402a.
- Geparkter Teil02: 73aa18e3-8f3b-4f92-93e8-279e858b6d01.
- Studio-Vorbereitung: 7e16930a-2dee-449b-ad8c-7ed642d8bb7b.
- Begrenzter Koordinationspilot: 44ac79d9-48fb-4fb7-8eb7-ee35608bd964.

Der Orchestrator prüft den aktuellen Status dieser Tickets vor Zuordnung. Vorhandene Arbeit fortsetzen oder ausdrücklich abgrenzen; keine doppelte Umsetzung und keine erledigten Tickets ohne Beleg wieder öffnen.

## 3. Produktmodell: zwei miteinander verbundene Bereiche

**Ideensammlung:** nahezu reibungsfreie Erfassung, Suche, Sortierung, langfristige Planung. Eine Idee ist noch kein Entwicklungsauftrag.

**Fließband:** begrenzte Vorbereitung ausgewählter Ideen bis zum prüfbaren Plan, anschließend Nutzerfreigabe, Patchplanung und Ausführung. Ein Eingang mit vielen Ideen erzeugt nicht automatisch ebenso viele aktive Agentenaufträge.

Eine Idee besitzt Originaltext, Anlagen, Herkunft und Versionen. Daneben stehen bearbeitbare Interpretation, Kategorien, Bewertungen, offene Fragen und Planstände. Der Originaltext bleibt erhalten. Agenten verbessern Formulierung und Struktur, verändern aber keine Nutzerabsicht unbemerkt. Ergänzungen heißen „Vorschlag“, Unsicherheiten „Hypothese“.

### Stationen und eindeutige Austrittskriterien

| Station | Ergebnis | Weiter, wenn |
| --- | --- | --- |
| Eingang | dauerhaft gespeicherter Originaltext und Herkunft | Speicherung bestätigt |
| Einordnen | verständlicher Titel, Kategorie, Tags, erste Nutzen-/Risikoeinschätzung | Einordnung vorhanden, Unsicherheit sichtbar |
| Prüfen | Machbarkeit, Abhängigkeiten, ähnliche Ideen, Stolperfallen | wesentliche Fragen beantwortet oder konkret markiert |
| Ausarbeiten | recherchierter Kontext und nachvollziehbarer Planentwurf | Aufgaben, Umfang, Abnahme und offene Entscheidungen beschrieben |
| Zur Entscheidung | lesbare, feste Planversion mit Alternativen | Elias genehmigt genau diese Version oder verlangt Änderung |
| Bereit | genehmigter und ausführbarer Plan | Kapazität und Voraussetzungen für Patch vorhanden |
| Eingeplant | verbindliches Paket mit Owner und Abhängigkeiten | Orchestrator startet tatsächlich |
| Umsetzung | belegte Arbeitsstände und Ergebnisse | Integration und relevante Abnahme nachgewiesen |
| Geliefert | erreichbare Funktion und Beleg | Ergebnis für Nutzer verfügbar |

„Wartet auf Elias“, „Wartet auf Abhängigkeit“, „Blockiert“, „Zurück zur Ausarbeitung“ und „Geparkt“ sind zusätzliche Zustände, keine erfundenen Fortschrittsschritte. Eine große Idee kann mehrere Lieferteile und Patches haben. Der Elternstatus ergibt sich aus deren tatsächlichem Umfang.

Die vollständige Stationsfolge wird zunächst angezeigt, auch wenn nur frühe Stationen arbeiten. Unfertige Stationen sind eindeutig als „Wird ergänzt“ gekennzeichnet. Gespeicherte Ideen bleiben dort vorgemerkt; nach Aktivierung verarbeitet ein kontrollierter Rückstandslauf sie ohne Neueingabe.

## 4. Freigabe und Priorisierung

Agenten und Orchestrator dürfen Ideen vorschlagen und bis zum entscheidungsreifen Plan vorbereiten. **Agentenideen dürfen erst nach ausdrücklicher Freigabe durch Elias verbindlich eingeplant oder umgesetzt werden.** Herkunft bleibt im UI sichtbar. Für Nutzerideen ist das Erfassen allein ebenfalls keine Umsetzungsfreigabe. Dieser Produktausbau selbst ist durch den aktuellen Auftrag autorisiert.

Freigabe bindet Ideenrevision, Planversion und relevanten Umfang. Wesentliche Änderungen an Ziel, Aufwand, Risiko oder Abnahme machen eine alte Freigabe überprüfungsbedürftig. Empfang, Speichern, automatische Bewertung und Root-Quittierung ersetzen keine Freigabe.

Erste Sortierung einfach und erklärbar:
- Nutzerpriorität: dringend / hoch / normal / später; vom Nutzer jederzeit korrigierbar.
- Nutzen: erwartete Wirkung plus kurze Begründung.
- Aufwand: klein / mittel / groß / unbekannt; später Bandbreite mit Annahmen.
- Risiko: niedrig / mittel / hoch / ungeprüft; konkrete Stolperfallen separat.
- Abhängigkeiten und frühester sinnvoller Zeitpunkt.
- Evidenz: ungeprüft / plausibel / belegt; Herkunft und Prüfdaten.

„Schwere“ wird bei Fehlern als Schweregrad verwendet. Bei Featureideen heißt das Feld Risiko oder Komplexität; ein großes Feature ist nicht automatisch ein schwerer Fehler.

Agenten geben Empfehlungen, Elias kann sie ändern. Keine undurchsichtige Gesamtnote als alleinige Wahrheit. Die Umsetzung berücksichtigt Nutzen, Dringlichkeit, Abhängigkeiten, Aufwand, Unsicherheit und verfügbare Kapazität. Große wertvolle Ideen werden bei Bedarf geteilt, nicht automatisch nach hinten verdrängt. Wartende Ideen regelmäßig neu ansehen, damit kleine schnelle Aufgaben sie nicht dauerhaft verdrängen.

Langfristige Planung nutzt Jetzt / Als Nächstes / Später sowie Themen oder Zielhorizonte. Patchnummern werden nur bei realer Planung verbindlich. Überschreitet ein Paket seine Kapazität, benennt der Orchestrator den verschobenen Teil, Ursache, Auswirkung und neues Planungsfenster.

## 5. UI und UX: schnell erfassen, gut überblicken, gezielt vertiefen

Bestehende ProjectA-Komponenten, Navigation, Typografie, Abstände, Farben und Materialwirkung übernehmen. Keine unabhängige Designwelt daneben schaffen. Die erste Iteration poliert Hierarchie, Lesbarkeit und Zustandsführung; ein großer visueller Neubau gehört nicht auf den kritischen Pfad.

**Desktop:** links kompakte Navigation mit Eingang, Sammlung, Fließband, Entscheidungen und Roadmap; in der Mitte filterbare Liste oder Board; rechts bei Auswahl der Ideendetailbereich. **Mobil:** zuerst Erfassung und Liste, Details auf eigener Ansicht; keine drei schmalen Spalten.

Die primäre Aktion lautet „Idee festhalten“. Ein Textfeld genügt; Titel und Einordnung können später folgen. Mehrere Absätze dürfen mehrere Gedanken enthalten: Trennvorschläge anbieten, vor einer tatsächlichen Aufteilung bestätigen lassen. Enter in langen Texten erzeugt keinen überraschenden Versand.

Eine kompakte Karte zeigt Titel, Herkunft, aktuelle Station, Nutzerpriorität, Nutzen, Risiken und nächste Aktion. Detailansicht ergänzt Original, Interpretation, Anlagen, Verlauf, Fragen, Quellen, Plan und Freigabe. Erweiterte Felder schrittweise offenlegen.

Filter kombinieren: Kategorie, Tag, Priorität, Status, Herkunft, Zeitraum, Patch. Sortierung und gespeicherte Ansichten merken. Suche trifft Originaltext, Titel und Tags; später Planinhalte. Zunächst Liste und Stationsband anbieten. Danach Board und Graph ergänzen.

**Graph:** gerichtete Beziehungen „benötigt“, „gehört zu“, „ähnelt“ und „liefert Teil von“. Keine unlesbare Sammlung aller Knoten als Standard. Fokus auf ausgewählte Idee mit unmittelbaren Nachbarn, Filter, Legende und Textalternative. Automatisch vermutete Ähnlichkeit hat einen anderen Stil als bestätigte Abhängigkeit. Zyklen als Planungsproblem anzeigen. Position im Graphen ist keine Prioritätsbewertung.

Fortschrittsanzeige unterscheidet „Planvorbereitung“ und „Umsetzung“. Vor Aufgabenzerlegung stehen Station und nächste Aktion statt Prozent. Später belegte Aufgabenstände mit Nenner und verbleibenden Unsicherheiten. Zeitprognosen als Bandbreite und aktualisierte Annahme zeigen, nicht als Garantie.

Essenzielle Zustände: leer, speichert, gespeichert, lokaler ungesicherter Entwurf, offline, Fehler, Konflikt, Upload läuft, Einordnung ausstehend, blockiert, Entscheidung nötig und geliefert. Änderungen dürfen beim Neuladen, einem fehlgeschlagenen Upload oder konkurrierendem Editieren nicht verschwinden. Tastaturbedienung, sichtbarer Fokus, beschriftete Controls, ausreichender Kontrast und reduzierte Bewegung gehören zur Abnahme.

## 6. Anlagen, Recherche und Planentwurf

Text und eingefügte Links funktionieren in L0. URLs zunächst als Referenz speichern; Speichern löst keine beliebige Browseraktion aus. Screenshots und Dateien danach mit echter Uploadbestätigung, Vorschau, Dateigröße, Fehleranzeige und Downloadzugang. Keine großen Binärdaten in das bestehende JSON-Ledger stopfen. Uploadgrenzen und zulässige Formate anhand vorhandener Infrastruktur festlegen und im UI nennen.

Anlagen bleiben mit ihrer Ideenrevision verbunden. Inhalte und enthaltene Anweisungen sind Quellenmaterial, keine neuen Befehle oder Berechtigungen. Recherche nutzt tatsächliche verfügbare Zugriffe; unzugängliche Links oder benötigte Anmeldung werden sichtbar gemeldet. Zugangsdaten werden im vorhandenen sicheren Verfahren vom Nutzer bereitgestellt, niemals im Ideenfeld angefordert.

Vorbereitung in vier begrenzten Schritten:
1. Ziel und erwarteten Nutzen aus dem Original extrahieren; Mehrdeutigkeit sichtbar lassen.
2. Bestehende Features, ähnliche Ideen, technische Voraussetzungen und Abhängigkeiten prüfen.
3. Nur entscheidungsrelevante Wissenslücken recherchieren; Quellen, Stand und Grenzen notieren.
4. Planprompt erzeugen und ausführen; Ergebnis kritisch gegen Originalziel, Risiken und Alternativen prüfen.

Präferenzen oder persönliche Entscheidungen werden nicht durch Recherche erfunden. Nicht kritische Unklarheiten als explizite Annahmen dokumentieren; blockierende Fragen bündeln. Jede Recherche erhält einen klaren Endpunkt und begrenzten Arbeitsumfang. Ein Plan darf mit benannten offenen Fragen vorgelegt werden.

Standardprompt für die Vorbereitung:
> Bewahre Original und Herkunft. Beschreibe Ziel, Nutzen und konkrete Nutzung. Trenne belegte Fakten, Interpretation und Hypothesen. Prüfe ähnliche Funktionen, Abhängigkeiten, Machbarkeit und die stärksten Einwände. Recherchiere nur fehlende entscheidungsrelevante Fakten. Erstelle die kleinste nutzbare Lieferung und anschließende Ausbaustufen mit Aufgaben, Abnahmen und Risiken. Kennzeichne Annahmen und Agentenergänzungen. Binde Ergebnis an die aktuelle Ideenrevision. Beantrage keine Umsetzung und simuliere keine Nutzerfreigabe.

Jeder gespeicherte Plan enthält Problem, Ziel, Nutzungsablauf, Umfang, Ausnahmen, vorhandene Grundlage, Alternativen, Tasks, Abhängigkeiten, Aufwandannahmen, Akzeptanzkriterien, Risiken, offene Entscheidungen, Quellen und genaue Version.

## 7. Daten und technische Leitplanken

Vorhandene Ledger-/Workbench-/PlanDraft-Verträge erweitern statt eine zweite Wahrheit einzuführen. Die folgenden Felder sind ein Vorschlag für die Vertragserweiterung und müssen gegen den aktuellen Quellstand geprüft werden:

Idee: ID, Revision, Original, Titel, Herkunft, Kategorien/Tags, Nutzerpriorität, Bewertungsstände, Beziehungen, Anlagenreferenzen, Station, Wartegrund, nächste Aktion, Planreferenzen, Zeitpunkte. Plan: stabile ID, unveränderliche Version, Ideenreferenz, Aufgaben/Abnahmen, Freigabereferenz, Patchzuordnung. Job: Eingangsrevision, Typ, Status, Owner, Start/Ende, Wiederholungskennung, Fehler und Ergebnisreferenz.

Bestehende Compare-and-swap-Prüfungen und atomare Schreibwege erhalten. Veraltete neue Schreibversuche erzeugen einen verständlichen Konflikt; nicht still überschreiben. Wiederholter Auftrag derselben Referenz erzeugt keine zweite Entscheidung oder doppelte Umsetzung. Event-Duplikate sind von einem ausdrücklich neuen Job zu unterscheiden.

Die Sammlung muss vor Start automatischer Jobs bereits dauerhaft speichern. Ein fehlgeschlagener Agentenlauf darf die Idee nicht verlieren. Rückstandsläufe, Revisionen und Neustarts benötigen wiederaufnehmbare Zustände. Backup, Export und kontrolliertes Wiederherstellen vor Migrationen vorsehen. Kein vorschneller Datenbankwechsel nur wegen „vielen Ideen“; zunächst gemessene Grenzen bestimmen.

Als vorgeschlagene Lastfälle 1.000 Ideen und anschließend 10.000 synthetische Ideen verwenden. Listen werden begrenzt geladen; Graphen zeigen fokussierte Ausschnitte. Rohdaten und lange Anlagen nicht für jede Karte vollständig laden. Produktionsähnliche Antwortzeiten messen und vom Owner begründete Grenzwerte vor Abnahme festhalten.

## 8. Umsetzungspakete und Parallelisierung

| Paket | Inhalt / Ownerrolle | Voraussetzung | Abnahme |
| --- | --- | --- | --- |
| P0 | Root + PM: Quellstand, Zugriff, bestehende Tickets und Paketgrenzen disponieren | aktueller Auftrag | Owner, erster kritischer Pfad, Blocker und Lieferprognose dokumentiert |
| P1 | Backend: sichere Erfassung, Revision, Liste und Bearbeitung wiederverwenden/ergänzen | P0 | Idee überlebt Reload/Neustart; Konflikt und Fehlversuch verlieren keine Daten |
| P2 | Frontend: Eingabe, Liste, Filter, Sortierung und Detail | P0, abgestimmter P1-Vertrag | Elias kann vollständigen L0-Ablauf bedienen |
| P3 | Betrieb/Integration: erreichbarer Zugang, stabile Instanz, Backup und L0-Verifikation | P1/P2 | echter Nutzerlink, getesteter Speicherweg, Rückfallmöglichkeit |
| P4 | Backend + Frontend: Anlagen und Vorschau | L0, Uploadvertrag | Datei bleibt zugeordnet; Fehler/Limit/Rechte verständlich |
| P5 | Vorbereitung: Kategorien, Dublettenhinweise, Nutzen/Risiko mit Provenienz | P1, Jobvertrag | konkrete Einordnung sichtbar/korrigierbar; unbekannt bleibt unbekannt |
| P6 | Pipeline: Jobs, begrenzte Recherche und revisionierter Plan | P5, bestehende PlanDraft-Verträge | Ergebnis referenziert richtige Revision; Retry erzeugt kein Duplikat |
| P7 | Freigabe + Roadmap + Orchestrator-Handoff | P6 | exakte Planfreigabe; tatsächlicher Empfang/Start/Abschluss getrennt |
| P8 | Board, fokussierter Graph, Langfristansichten | stabile Beziehungen aus P5/P7 | Filter/Textalternative/Zyklen; keine Verzögerung von L0 |
| P9 | Last, Mobilpolitur, Export/Wiederherstellung | inkrementell nach L0 | gemessene Grenzen und bestandene relevante Regressionen |
| P10 | Arbeitsregeln, Skills/Prompts/Trigger und begrenzter Kritikerpilot | bestehender Pilotauftrag | messbare Entlastung, keine neue dauerhafte Koordinationslast |

P1 und P2 parallel nach einem kurzen verbindlichen Vertragsschritt. P3 kann Zugriff, Betrieb und Abnahmevorbereitung parallel bearbeiten. P5 fachlich vorbereiten, ohne vorzeitig eine konkurrierende Datenimplementierung zu beginnen. Gemeinsame Schema-/Integrationsänderungen seriell verantworten.

Bestehende Regel „maximal drei parallele Implementierungen“ bleibt Ausgangspunkt, bis Root sie anhand aktueller Ressourcen und zulässiger Disposition verändert. Zusätzliche Kapazität kann konkrete Recherche, UX-Spezifikation, Regression, Betriebsarbeit und Review übernehmen. Auslastung ohne verwertbaren Output ist kein Erfolg.

Der vorhandene Server darf für geeignete Builds, Prüfungen und Agentenarbeit genutzt werden. Vor Start Ressourcen, authentifizierten Zugang und Rückgabeweg feststellen. Keine neuen Server kaufen und keine zweite unkontrollierte Denkrauminstanz starten. Modelle und Reasoning nach Aufgabe wählen: anspruchsvolle Planung/Architektur starke Modelle; Routineausführung angemessen dimensionieren. „Superagent“ beschreibt Verantwortung und Fähigkeit, keine unbelegte Produkteigenschaft.

Fast Mode für Führungsagenten muss bei ausdrücklichem Nutzerbefehl aktivierbar und als Präferenz festgehalten sein; Worker nicht pauschal aktivieren. Die jetzige Leistungsanforderung ersetzt keinen konkreten Fast-Schalterbefehl und keine Prüfung vorhandener Provider-/Kostenregeln.

## 9. Blocker, Bestätigungen und Cloud-Dokument

Kein Agent stoppt geräuschlos. Ein Blocker meldet betroffene Aufgabe, konkreten Grund, Zuständigkeit, bereits vorbereiteten nächsten Schritt und benötigte Nutzerhandlung. Fehlende Anmeldung soweit möglich vorbereiten; Elias führt nur den unvermeidbaren interaktiven Schritt aus. Danach funktionierenden Zugriff prüfen und Arbeit tatsächlich wieder aufnehmen.

Der Orchestrator bestätigt:
1. Dokument persönlich gelesen und Auftrag verstanden.
2. Tatsächlichen Start mit Ticket/Owner und erster Lieferstufe.
3. Erste nutzbare Lieferung mit funktionierendem Zugangslink.
4. Spätere Paketabschlüsse oder konkrete Blocker mit Belegen.

Dieser Cloud-Plan ist fachliche Referenz. Tickets bleiben die Ausführungsquelle und enthalten Owner, Status und Abhängigkeiten. Cloud-Zugriff wird geprüft, nicht aus dem Link angenommen. Eine lokale gleichlautende Markdown-Fassung dient als zugängliche Übergabe, falls Agenten keinen Cloud-Zugang haben.

Dokumentpflege hat einen benannten Owner; andere Agenten schlagen gezielte Änderungen vor. Änderungen an Anforderungen, Beschlüssen und Abnahme werden versioniert. Reine Fortschrittsupdates stehen im Lieferprotokoll. Widersprüche zwischen Cloud, lokaler Fassung und Ticket werden ausdrücklich aufgelöst statt still übernommen.

## 10. Die stärksten Einwände und ihre Behebung

| Kritik | Konsequenz |
| --- | --- |
| „Ein komplexes System verhindert endlich nutzbare Ergebnisse.“ | L0 separat liefern; Graph, Rat und vollständige Planung nicht als Vorbedingung. |
| „Automatische Ordnung ist nur Scheingenauigkeit.“ | Begründungen, Provenienz, Unsicherheit und Korrekturmöglichkeit; keine unbelegte Punktzahl. |
| „Viele Ideen lösen teure Dauerrecherche aus.“ | Sammlung von aktiver Vorbereitung trennen; begrenzte Warteschlange und Priorität. |
| „Die ersten Ideen gehen bei Umbauten verloren.“ | Dauerhafte IDs, Migration/Backup/Export; gespeicherte Rückstände nachziehen. |
| „Agenten setzen ihre eigenen Wünsche durch.“ | Original/Herkunft erhalten, exakte Nutzerfreigabe für Agentenpläne. |
| „Ein Graph ist hübsch, aber unbedienbar.“ | Fokussierte Beziehungen; Liste und Textalternative bleiben vollständig. |
| „Volle Auslastung produziert Reviewstau und Konflikte.“ | Parallelität nach Abschlusskapazität; ein Integrationsowner pro Nahtstelle. |
| „Der Kritiker produziert Kritik statt Nutzen.“ | Gemeinsame Ergebnisziele; nur belegte Fälle, begrenzter Pilot, Jury nur bei materieller Uneinigkeit. |
| „Größenregeln sind inzwischen die Hauptarbeit.“ | Root entscheidet zulässigen funktionalen Split oder Parken; kein wiederholtes Zählen ohne Lieferweg. |
| „Live bedeutet hier bloß lokaler Dienst.“ | Nutzerzugriff gesondert testen; echten Link und Reichweite nennen. |

## 11. Abnahme, Erfolg und sofortiger Arbeitsauftrag

Die erste reale Nutzerprüfung: Elias erfasst drei unterschiedliche Ideen, verändert eine, setzt Priorität und Kategorie, sucht sie wieder, lädt die Seite neu und findet denselben Inhalt. Mindestens eine Idee bleibt sichtbar als noch ungeprüft; ihre spätere Bearbeitung ist vorgemerkt. Ein simulierter Speicherfehler zeigt einen erhaltenen Entwurf statt einer falschen Erfolgsmeldung. Bestehende Inhalte und Quittierungswege bleiben funktionsfähig.

Weitere Pflichtfälle der zuständigen Entwickler: konkurrierende Revisionen, wiederholtes Ereignis, Neustart während Job, alte Planfreigabe nach wesentlicher Änderung, Agentenidee ohne Freigabe, blockierte Abhängigkeit und abgeschlossene Lieferung mit tatsächlichem Beleg. Testumfang nach realer Änderung wählen; vorhandene passende Prüfungen verwenden. Es wird kein QA Bot gestartet.

Erfolg zuerst messen an: Zeit bis zur ersten wirklich nutzbaren Sammlung, erfolgreich erhaltenen Eingaben, Zeit vom Erfassen bis Einordnen, Anteil nachvollziehbarer Bewertungen und sichtbar aufgelösten Blockern. Später Plan-Durchlaufzeit, Nacharbeit und gelieferter Nutzen ergänzen. Anzahl Agenten, Kritikpunkte oder Nachrichten ist keine Erfolgsmetrik.

**An den Orchestrator:** Lies den Plan vollständig. Ordne ihn den bestehenden Tickets zu und benenne den kleinsten sicheren L0-Lieferweg. Dispone bestehende Paket-/Zugriffsblocker innerhalb deiner Befugnisse. Starte konkrete parallele Aufgaben mit eindeutigen Ownern und nutze den vorhandenen Server sinnvoll. Liefere zuerst die erreichbare, dauerhafte Ideensammlung; entwickle die übrigen Stationen danach weiter, während Elias bereits Ideen sammelt. Bestätige echten Empfang, tatsächlichen Start und den ersten benutzbaren Stand jeweils mit Belegen. Melde nur reale Grenzen; behauptete Ausführung ersetzt keine Lieferung.

### Lieferprotokoll

| Stand | Beleg | Status |
| --- | --- | --- |
| Plan V1.0 erstellt | Cloud-Seite und lokale Markdown-Fassung | Dokument fertig |
| Root hat persönlich gelesen | noch einzutragen | nicht bestätigt |
| L0 tatsächlich gestartet | Ticket / Owner / Arbeitsbeleg einzutragen | nicht bestätigt |
| L0 für Elias erreichbar | Link / Zugriffsprüfung / Abnahme einzutragen | nicht bestätigt |

<!-- PLAN-L0-P0 V1.0 END -->

## Meilensteine

| M | Titel | Abnahme in Alltagssprache |
|---|---|---|
| M1 | Alles Laufende gelandet, App startbar | Keine offenen Paket-PRs aus M1, `main` grün. Die App startet vom aktuellen `main`, ohne dass alte Queue-Einträge Agenten losschicken; tote Einträge lassen sich gezielt verwerfen (W1-05b). |
| M2 | Überblick und Setup | Du fragst Claude „Was heißt das?“ und bekommst eine einfache Antwort. Ein Skript schreibt Status und Tagesbericht. Ein Plan, zehn Regeln, gestufte Reviews. Ein roter `main` hält die Queue an. Limits und RAM werden vor jedem Worker-Start geprüft. Backup läuft. |
| M3 | App im Alltag + Zwischenrelease v1.5.0 (Beta) | Du installierst v1.5.0 (Beta) über den Updater. In der installierten App gibst du drei echte kleine Aufgaben an Agenten, verfolgst sie im HQ, prüfst den Diff in der App, und der PR landet über die Queue. Das HQ ist hell und dunkel lesbar (Screenshots angesehen, auch die DF-07-Dichte). |
| M4 | Dauerbetrieb abgenommen, v1.5.1 | Du schaltest den Continuous Mode selbst ein. Ein Not-Aus stoppt alles in 10 Sekunden. Alle 27 Zeilen der Abnahmematrix haben einen Beleg oder ein Nutzer-Gate. Update-Drills sind am PC durchgespielt. Du installierst v1.5.1. |
| M5 | Aufräumen und erste Tester (nach v1.5.1) | 3–5 externe Tester haben v1.5.1 benutzt, ihre Rückmeldungen sind festgehalten. Die Architektur-Befunde sind abgearbeitet, `docs/architecture-rules.md` gibt es und ein Drift-Gate läuft in der CI. Die vier Nahtstellen sind kleiner als bei v1.5.0. ProjectA ersetzt die externen Orchestrierungs-Skripte Schritt für Schritt. |

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

### M3 — App im Alltag + Zwischenrelease v1.5.0 (Beta)

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| HQ2-02 | Abnahme der Konzeptdemo und Studio-Variante; legt die Richtung für „HQ als Hauptbereich der App“ fest | M | hqS + N | ✓ entschieden (Nutzer 04.10., E1: Mix) |
| HQ2-03 | Gemeinsame Design-Tokens hell/dunkel, nach HQ2-02 | M | hqS | ✓ #311 |
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
| W3-08 | Paketierter HQ-v1-Beleg | S | N | ✓ #381; Drill 8 PASS am 05.10. (Beleg: Datum aus `events.log`, lokal) |
| ARCH-11 | KI-24b auf Windows reproduzieren, Test-DB-Wettlauf absichern (siehe Tabelle Architektur-Pakete) | S | fR + N | angenommener M3-Kandidat (Nutzer 04.10., F6); Windows-Lauf am PC des Nutzers erlaubt; offen |
| R-1 | Zwischenrelease v1.5.0 (Beta) als Abschluss von M3; Tag und Veröffentlichung darf der Orchestrator selbst, sobald alle Gates und die 27 Matrixzeilen in der Fassung vom 04.10. belegt sind (Nutzer 04.10.) | S | N + doc | offen |

**R-1 Voraussetzungen (Stand 05.10.):** Der Tag `v1.5.0` (Beta; E24: A) setzt voraus:

- W3-02 vollständig, einschließlich W3-02f bis W3-02i. Die vier Release-Blocker sind W3-02g (Journal-Erzeuger), W3-02h (Bytes und Version ans Journal, #411-Befund C1), W3-02j (Handshake-Identität nach dem Update) und W3-02i (Wartungs-Lease, #411-Befund C2). W3-02j, weil nach jedem echten Update die App heute nicht mehr startet: die Startprüfung vergleicht den Hash der laufenden exe mit dem Hash des Update-Pakets, dazu den Datenbank-Snapshot-Hash mit der Live-Datenbank (Befund aus PR #457 und Berater Fable 5.1, 05.10.).
- Die PC-Drills 1-6 und 8 aus W3-03 (paketierte Drills) sowie der Beleg W3-08 (paketierter HQ-v1-Beleg). Sie laufen auf einem lokal signierten Installer: `node scripts/build-signed-windows.mjs` (`scripts/build-signed-windows.mjs:12` verlangt `TAURI_SIGNING_PRIVATE_KEY`, `:22-24` einen sauberen Checkout). Der Signierschlüssel steht nur in der eigenen PowerShell-Sitzung des Nutzers, vorher Backup, Installation über v1.4.1 (E25: A).
- Alle Gates und die 27 Matrixzeilen (Fassung vom 04.10.).

**Abnahme der Beta (nach dem Tag, E25: A):** Der Updater-Drill (W3-03e) und W3-07 (Produktionsschlüssel-Build, Signed-Updater-Relaunch) sind keine Voraussetzung des Tags mehr, denn sie brauchen ein echtes veröffentlichtes Update (fester Endpoint `src-tauri/tauri.conf.json:54-56`). Sie gehören zur Abnahme der Beta: Der Nutzer aktualisiert v1.4.1 bzw. v1.5.0 über den Updater. Reihenfolge der Updater-Fälle: `cancel`, `fail`, `success`.

**Versionsnamen (E24: A, 05.10.):** Die Beta trägt den Tag `v1.5.0`, das Endrelease ist `v1.5.1`, weil die Release-Pipeline nur x.y.z annimmt (`scripts/verify-windows-package.ps1:5`, `scripts/release.cmd:16`). In den Entscheidungszeilen und Notizen vom 04.10. meint „v1.5.0“ noch das Endrelease; gelesen als v1.5.1.

### M4 — Dauerbetrieb abgenommen, v1.5.1

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
| W1-03f | F-CORE-3 Baustein C: Zustell-Queue, `pa worker done/blocked` (braucht das Z-1-Protokoll am PC) | M | wk + pa | Teilpakete gemergt (#337 W1-03f-api, #301 W1-03f-a); Hauptpaket offen |
| W3-01 | Globaler DB-Wartungs-/Write-Lock + Drain (st-Kind, dann mn-Kind) | M | st → mn | ✓ #285, #335, #402 |
| W3-02 | Windows-Recovery-Helper | M | fR + N | ✓ (Teilpakete W3-02a bis W3-02k gemergt, zuletzt #475) |
| W3-02a | Journal-Treiber, eine Aktion je Schritt | S | fR | ✓ #291 |
| W3-02b | Staged-Update-Identitäten binden | S | fR | ✓ #321 |
| W3-02c | Datenbank-Wiederherstellung ans Journal binden | S | fR | ✓ #357 |
| W3-02d | Installer-Adapter (Exit-/UAC-/Sharing-Klassifikation, kein Retry) | S | fR | ✓ #348 |
| W3-02e | Installation nur über das Wiederherstellungs-Journal | S | fR | ✓ #411 (gemergt 05.10.; Befunde C1/C2 zurückgestellt, siehe W3-02h/i) |
| W3-02f | Wiederherstellung beim Start | M | fR | ✓ #425 |
| W3-02g | Release-Blocker R-1 (Beta): Journal-Erzeuger. `update-recovery.json` legt heute nichts an, daher lehnt das Selbst-Update in der App immer ab (offener Punkt aus #411). Stufe A | M | mn | ✓ #446 |
| W3-02h | Release-Blocker R-1 (Beta): #411-Befund C1, die installierten Bytes und die Version an das Journal binden (`signed_artifact_sha256`, `candidate_version`; heute verwirft `InstallOnly` beide). Stufe A | M | mn | ✓ #457 |
| W3-02j | Release-Blocker R-1 (Beta): Handshake-Identität nach dem Update. Die Startprüfung muss die laufende exe und die Live-Datenbank nach einem echten Update als Erbe des Journals anerkennen (Vertrauen beim ersten Start, siehe `docs/decisions.md`), sonst blockiert `IdentityMismatch` den Start. Befund aus #457. Stufe A | M | mn | ✓ #462 |
| W3-02i | Release-Blocker R-1 (Beta): #411-Befund C2, Wartungs-Lease statt Momentaufnahme von `is_maintenance_active()`; berührt auch `store.rs` (Naht, nur seriell). Stufe A | M | mn | ✓ #471 |
| W3-03 | Paketierte Drills: Singleton, Crash/Power-Loss, Backup (3 × S) | S | N | ✓ Drill-Kits #364, #376, #379, #382, #377, #380, #384 gemergt; die Läufe am PC stehen laut R-1-Voraussetzungen noch aus |
| W3-04 | Updater-Zustände in App und HQ | S | fe + hqL | ✓ #119 |
| W3-07 | Produktionsschlüssel-Build + Signed-Updater-Relaunch; der bestehende Schlüssel bleibt (E4) | S | N | offen |
| W4-01 | Benchmark, verkleinert auf 5 Aufgaben statt 20 (E2, Nutzer 02.10.) | M | fR | ✓ #73 |
| W4-02 | Abnahmematrix final (27 Zeilen) | S | doc | ✓ #48 |
| W4-03 | Continuous-Aktivierung, nur nach W4-02 und mit Freigabe des Nutzers; der Schalter darf jetzt gebaut werden, fail-closed (gesperrt, bis die Zeilen 1–26 der Abnahmematrix belegt sind); einschalten tut der Nutzer selbst am Ende (Zeile 2) (Nutzer 04.10., E5) | S | mn | ✓ #481 |
| W4-04 | Release v1.5.1 (Endrelease) | S | N | offen |
| M4-R7-01 | Scheduler-`dispatch_once` hinter einem Nur-Test-Permit (Matrixzeile 7) | S | wk | ✓ #340 |
| M4-R7-02 | Negative Fake-Adapter-Matrix (Matrixzeile 7): Tests, die Starts ohne akzeptierte Gates ablehnen, plus Matrixzeilen 5 und 9: zwei gleichzeitige `dispatch_once` auf eine Aufgabe starten genau einen Worker, der veraltete Schreiber wird abgewiesen; Abhängigkeiten erfüllt/offen/fehlend/projektfremd/65 Einträge -> genau ein Start nur im erfüllten Fall | S | wk | ✓ #412 (ersetzt #407) |
| M4-ROW15-PROOF | HTTP-Beleg Zeile 15 (eingeengt): Bindung/Idempotenz Kandidat und Evidenz, Lesen nur im eigenen Run, fremde/stale Evidenz abgewiesen, veränderte Root-Policy ändert `policy_json` nicht und meldet fail-closed | S | api-Tests | ✓ #360 |
| M4-ROW17-PROOF | HTTP-Beleg Zeile 17 (eingeengt): Kandidat-Delta macht Evidenz und Reviews sichtbar ungültig, auch nach Neustart; Freigabe bleibt per Schema unmöglich | S | api-Tests | ✓ #374 |
| M4-E2E-14 | Echter HTTP-Router + Store + Fake-Agentenprozess: Checkpoint -> Abbruch -> Fortsetzen (Zeile 14) | S | api | ✓ #365 |
| M4-R19-01 | Typisierter Audit-Envelope: Einträge ohne project/run/result/sourceRef werden abgewiesen (Matrixzeile 19) | S | st | ✓ #358 |
| M4-R19-05 | Vollständige Audit-Envelopes für Delivery-Start/-Enqueue und W1-03f done/blocked mit Erfolg und Ablehnung (Matrixzeile 19) | S | st | ✓ #408 |
| M4-R19-06 | Vollständige Audit-Envelopes für Not-Aus an/aus und Barrier-/Store-Fehler (Matrixzeile 19) | S | st | ✓ #423 |
| M4-R19-08 | Vollständige Audit-Envelopes für Planungs-Autorisierungsablehnungen und Planungs-Schreibvorgänge (Matrixzeile 19) | S | api | ✓ #444 |
| M4-R27-01 | Readiness für App-Release und Continuous-Release getrennt ausweisen (E20) | S | scripts | ✓ #372 |
| M4-R27-02 | Release-Attestierung für den App-Release prüfen, ohne Continuous freizugeben (E20) | S | scripts | ✓ #398 |
| M4-R27-03 | Matrixzeilen 18 und 27 an den menschlich kontrollierten App-Release-Pfad anpassen (E20) | S | doc | ✓ #413 |
| M4-R27-04 | Store-Test: Continuous-Integrationsstufe wird bei `approval_eligible = 0` abgewiesen | S | st | ✓ #448 |

### M5 — Aufräumen und erste Tester (nach v1.5.1)

Nutzerentscheidung 04.10. (Empfehlungen des Orchestrators angenommen). Abnahme in
Alltagssprache:

- 3–5 externe Tester haben v1.5.1 benutzt und ihre Rückmeldungen sind festgehalten.
- Die Architektur-Befunde (Pakete ARCH-D*/STATE-* aus der Drift-Karte und dem
  Zustands-Audit; die STATE-Zeilen kommen dazu, sobald sie existieren) sind
  abgearbeitet.
- `docs/architecture-rules.md` gibt es und ein Drift-Gate läuft in der CI.
- Die vier Nahtstellen sind kleiner als bei v1.5.1 (Zeilen messen und vergleichen).
- ProjectA ersetzt die externen Orchestrierungs-Skripte Schritt für Schritt
  (Dogfooding, laut Vision).

Die ARCH-D-Pakete ändern kein Verhalten. Sie laufen erst nach v1.5.1, weil sie die
seriellen Nahtstellen des Release-Wegs belegen; jedes nutzt den Prompt „ProjectA
refactoring package“.

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| M5-01 | Testerrunde mit 3–5 externen Testern (N = Zahl noch offen) | S | N | offen, nach v1.5.1 |
| M5-02 | Produktfokus als Aussage im README: „sicherer Dauerbetrieb für KI-Agenten: Not-Aus, Kostenkontrolle, Protokoll“ | S | doc | offen, nach v1.5.1 |
| M5-03 | ARCH-G1 Regeldokument `docs/architecture-rules.md` + ARCH-G2 Drift-Gate in der CI | M | ci + doc | ✓ G1 #316, G2 #304 (04.10.) |
| M5-04 | Dogfooding: ein Orchestrierungsschritt zieht in ProjectA um (Umfang später festlegen) | M | später | offen, nach v1.5.1 |
| ARCH-D1 | Vier HTTP-Fehlertext-Klassifizierer zu einem | S | api | offen, nach v1.5.1 |
| ARCH-D2 | Projektanlage ist in `main.rs` doppelt umgesetzt | S | mn | offen, nach v1.5.1 |
| ARCH-D3 | Elf direkte `BEGIN IMMEDIATE` zu einem Store-Helfer | M | st | offen, nach v1.5.1 |
| ARCH-D4 | Restlicher API-Router mit 51 Zweigen: kleinere serielle Teil-PRs, insgesamt ≥ 300 Zeilen Netto-Abbau in `api.rs`; je PR ≤ 300 Gesamtdiffzeilen einschließlich Tests (ARCH-D4-PLAN) | M | api | offen, nach v1.5.1; Schnitt vor Dispatch messen |
| ARCH-D5 | Diagnose- und Einstellungsbefehle aus dem Befehls-Monolithen in `main.rs` herauslösen | M | mn | offen, nach v1.5.1 |
| ARCH-D6 | `pa::run` vermischt Verteilung und Darstellung | M | pa | offen, nach v1.5.1 |
| ARCH-D7 | Einstellungs-Speicherung in ein Untermodul unter `store/` | M | st | offen, nach v1.5.1 |
| ARCH-D8 | Ereignisnamen als gemeinsame Konstanten in Rust und TypeScript | M | mn → pty → fe | offen, nach v1.5.1 |
| M4-R19-02 | Vollständige Audit-Envelopes für die Pfade Ziel/Task (Matrixzeile 19); zugeschnitten in 02a #702 und 02b/03a #705, #698 Referenz | S | st | Fixrunde 1 laut Root (08.10. 19:25Z); ursprüngliche Nach-v1.5.1-Zuordnung erhalten, keine Gesamt-Abnahme |
| M4-R19-03 | Vollständige Audit-Envelopes für die Pfade Claim/Checkpoint (Matrixzeile 19); 03a bereits im #705-Zuschnitt, vorhandene Envelopes wiederverwenden, Restumfang vor Dispatch prüfen | S | st | Rest offen; #705-Fixrunde/Abnahme getrennt, keine doppelte Implementierung; ursprüngliche Nach-v1.5.1-Zuordnung erhalten |
| M4-R19-04 | Vollständige Audit-Envelopes für die Pfade Intent/Launch (Matrixzeile 19) | S | st | offen, nach v1.5.1 (Nutzer 04.10.) |
| M4-R19-07 | Vollständige Audit-Envelopes für die Pfade Kandidat/Evidence/Review (Matrixzeile 19) | S | st | offen, nach v1.5.1 (Nutzer 04.10.) |
| M4-R19-09 | Vollständige Audit-Envelopes für den Pfad Wartung (Matrixzeile 19) | S | mn | offen, nach v1.5.1 (Nutzer 04.10.) |

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
| Vorschlag: Alltagssprachliche Diff-Erklärung als gekennzeichnete Einschätzung neben echtem Diff/Befunden (Radar 99235669); A/B/C/unbekannt aus M3-02/#189 erhalten, keine Sicherheitsampel-Zusage | nach M4; kleiner Folgeumfang, keine Wiederholung von #189 |
| Vorschlag: Aufgaben-Vorlagen im App-Arbeitsfluss bei belegtem Nutzungsbedarf (Radar 8985d001); drei Doku-Vorlagen M3-01/#144 sind bereits gemergt | Bestandteil der geparkten DF-33/34; keine parallele neue Planung |
| Vorschlag: Dispatcher nach Start entschärft mit Vorschau (Radar 12d7a534); Not-Aus, Env-Vorfahrt und Reattach erhalten | Später; ausdrückliche Sicherheits-/Umfangsentscheidung, serielle st/mn/pa-Schnitte und Tier-A-Reviews vor Umsetzung |
| Vorschlag: Linux-Runner-Image gezielt pinnen (Radar bbe0db91) | bestehendes CI-Umbrella c77f6955; zuerst behauptete Frist 19.10. und Gate-Kopplung offiziell belegen, dann gesondert priorisieren; kein Bruch oder Pin freigegeben |
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
| Plan für v1.6.0 (Pakete, Wellen, Arbeitsweise, Benchmark-Nachweis): [`docs/plan/v1.6.0/plan.md`](plan/v1.6.0/plan.md) | Nutzerentscheidung 06.10.2026: zwei Wochenmessungen und 40 Queue-Läufe bleiben offene Nachbeobachtung nach v1.6.0; Befunde für v1.6.1, kritische früher. Details und unveränderte Originalkriterien in Abschnitt 7a.1; weitere Planfragen und Pakete bleiben in ihrem bisherigen Zustand, nichts davon wird in M1–M4 aufgenommen. |
| Fahrplan v1.6.1 bis v2.0.0 (Pakete, Wellen, Nähte, Nacharbeit je Release): [`docs/plan/roadmap/README.md`](plan/roadmap/README.md) | Entwurf, Nutzer entscheidet; nichts davon steht in M1–M4 |

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
| INV-SEC-CSP-SPLIT | `tauri.conf.json:28`: die Release-CSP enthält `ws://localhost:1420/1421`. | ✓ #288 gemergt (04.10.): `devCsp` getrennt, Release-CSP ohne `ws://localhost` |
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
  **Stand 05.10. (V16-02):** ✓ gemergt: Inbox und History bei Projekt-/Worker-
  Wechsel #194, Inbox und Digest #312, übrige Guards #345 und gemeinsamer
  Poll-Guard #324, Sprachmix #199. Offen bleibt `HistoryView.tsx:47` (der
  `catch` verschluckt den IPC-Fehler weiter).
- **Queue (`queue.rs`):** unbegrenzt blockierter Eintrag ohne Zeit
  (`status.rs:1474`), Dispatcher-Panik beendet den Thread, `launch` ohne
  Zeitlimit, ungültige/negative Worker-Limits (`set_project_max_workers`),
  30-s-Sweep. **Stand 05.10. (V16-02):** ✓ Dispatcher-Panik
  (FJ-2, #319), ✓ `launch` ohne Zeitlimit (FJ-3, #450); die übrigen drei Punkte
  sind ohne PR-Beleg offen. Änderungen am eingefrorenen Runtime nur in bestehenden M4-Paketen.
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
| PLAN-L0-SINGLE | Nur EIN Plandokument `docs/PLAN.md`; Masterplaninhalte an richtiger Stelle integrieren, Unterpläne erst bei abhakbarem Umfang. | Ganzen 198-Zeilen-V1.0-Text inline erhalten; 255/270-Zwei-Dateien-Kandidaten nur historische Übergaben, nicht integrieren. | Nutzerauftrag laut Root-Mail `msg-0muy9f100-5279e4be`, 07.10.15:25:47 UTC | Entschieden; finale Ein-Datei-Anwendung bleibt an Root-FIT und normale Gates gebunden; keine Cloud-Synchronisierung behauptet. |
| ARCH-D4-PLAN | ARCH-D4a/D4b: das API-Abbauziel mit kleineren seriellen Teil-PRs erreichen? | Gesamtziel ≥ 300 Zeilen Netto-Abbau in `api.rs` beibehalten; je Teil-PR ≤ 300 Gesamtdiffzeilen einschließlich Tests. | Nutzer | ✓ entschieden (06.10.2026): `serial-total300`, Frage Revision 1; Antwort `6b733c02-a4ff-466e-aaf6-905511d5570c`, gespeichert 21:55:57.174 UTC, Rootempfang 21:57:52.126 UTC (State-Revision 7). Keine Vorgabe ≥ 150 je Teil-PR. Red-first, vollständige Gates, Tier A mit zwei anderen Anbietern und serielle API-Naht bleiben verbindlich. Umsetzungskriterien: `docs/plan/v1.6.0/plan.md`, Abschnitt 3. Empfang ist kein Umsetzungsbeleg. |
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
| E15 | Bleibt der gemietete Build-Server nach dem Release? (Kostenentscheidung; Betrag steht hier nicht.) | Nach v1.5.0 mit Nutzen und Kosten bewerten. | Nutzer | offen, nach v1.5.1 |
| E16 | Lizenz und Geschäftsmodell vor den ersten externen Nutzern. Heute MIT; Optionen: MIT bleiben, Open Core, Doppellizenz. Für echte Verkäufe rechtliche Beratung einholen. | Vor M5-01 entscheiden. | Nutzer | offen, nach v1.5.1 |
| E17 | Alte Arbeitsbäume entfernen? 29 von 81 sind nachweislich sicher (PR gemergt oder geschlossen, 0 geänderte Dateien, 0 ungepushte Commits, 0 Commits außerhalb von main); Liste liegt beim Orchestrator. Löschen entscheidet der Nutzer, vorher Backup. | Niedrige Priorität; nicht auf dem v1.5.0-Pfad. | Nutzer | offen, niedrig |
| E18 | Matrixzeile 3 (riskante Übergänge, `resume`): Für v1.5.0 einengen? Vorschlag (Empfehlung): `resume` ist in v1.5.0 nicht verfügbar; ein Laufzeittest mit echtem Store belegt, dass `resume` ohne, mit falschem und mit aktuellem Urteil abgelehnt wird und nichts verändert, auch nach Neustart (Paket M4-ROW3-A eingereiht). Alternative: urteilsgebundenes `resume` bauen (5 Pakete, davon 2 auf der st-Spur, v1.5.0 ca. 1–2 Tage später). Bis zur Antwort gilt der Vorschlag als Arbeitsannahme. | Hohe Priorität; v1.5.0-Pfad, Empfehlung annehmen. | Nutzer | offen, hoch |
| E19 | Matrixzeilen 15 und 17 eingeengt statt neu gebaut (Berater Fable + Astra, 04.10., beide Empfehlung: einengen). Echte Policy-Revision je Kandidat (DF-13) und echte Freigabe-Widerrufung (W5-02d) werden in M5 nachgeprüft. Gilt als Beraterentscheid; der Nutzer kann widersprechen. | Hohe Priorität; v1.5.0-Pfad. | Nutzer | entschieden (Berater), Nutzer kann widersprechen |
| E20 | Zeilen 18 und 27 blockieren v1.5.0 in der heutigen Fassung: `releaseEligible` verlangt Review-Befugnis (W5-02d, nach M4 geparkt) und zugleich eingeschalteten Dauerbetrieb, obwohl E5 sagt, der Dauerbetrieb bleibt bis nach der Abnahme aus. Optionen: (A, Empfehlung beider Berater) v1.5.0 = App-Release über den menschlich kontrollierten Weg PR -> Gates -> Merge-Queue; Dauerbetrieb wird aus und nicht releasefähig ausgeliefert; Zeile 18/27 und das Audit werden getrennt (App-Release vs. Dauerbetrieb), der Nutzer bestätigt die Abnahme selbst in einer Datei; (B) Review-Befugnis jetzt bauen (mehrere Stufe-A-Pakete an Nahtstellen, v1.5.0 deutlich später); (C) Release verschieben. | Höchste Priorität; v1.5.0-Blocker. | Nutzer | ✓ entschieden (Nutzer 04.10.): Option A — v1.5.0 = App-Release, Dauerbetrieb aus und nicht releasefähig, Abnahme per Nutzer-Attestierung |
| E21 | Matrixzeile 2 (Aktivierung durch eine einzelne Nutzerentscheidung): Dauerbetrieb bleibt in v1.5.0 aus (E20). Optionen: (A, Empfehlung) Zeile 2 lautet für v1.5.0 „Schalter gebaut und gesperrt (W4-03), Einschalten erst nach v1.5.0“; (B) Zeile 2 nach M5 verschieben. | v1.5.0-Pfad klären. | Nutzer | offen, Nutzer |
| E22 | Matrixzeile 16 (unabhängige Reviews): Heute laufen Reviews als PR-Text mit anderer Modellfamilie; eine Review-Freigabe in der App gibt es in v1.5.0 nicht (W5-02d nach M4 geparkt). Optionen: (A, Empfehlung) Zeile 16 für v1.5.0 auf „Review durch andere Modellfamilie im PR, an denselben Kandidaten gebunden“ verengen, echte App-Freigabe in M5; (B) offen lassen bis M5. | v1.5.0-Pfad klären. | Nutzer | offen, Nutzer |
| E23 | Matrixzeile 24 (Benchmark 5 Aufgaben, W4-01 #73): Ein echter Lauf verbraucht Abo-Kontingent. Optionen: (A) freigeben, Lauf am PC mit den 5 bestätigten Aufgaben; (B) nach v1.5.0 verschieben. | Nutzerfreigabe vor dem Lauf. | Nutzer | offen, Nutzer |
| E24 | Name der Beta: Die Release-Pipeline akzeptiert nur x.y.z (`scripts/verify-windows-package.ps1:5`, `scripts/release.cmd:16`). Beta heißt v1.5.0, Endrelease v1.5.1? | Empfehlung: ja (kein Umbau). Alternative: echte `-beta`-Tags = `release.yml`-Umbau (Stufe A). | Nutzer | entschieden (Nutzer 05.10.): A |
| E25 | R-1 ist zirkulär: Update-Drill (success/cancel/fail) und W3-07 brauchen ein echtes veröffentlichtes Update (fester Endpoint `tauri.conf.json:54-56`), R-1 verlangt sie aber vor dem Tag. Sollen sie Teil der Beta-Abnahme werden statt Voraussetzung? | Empfehlung: ja; Drills 1-6 und 8 vorher auf lokal signiert gebautem Installer (`node scripts/build-signed-windows.mjs`). | Nutzer | entschieden (Nutzer 05.10.): A |
| R19 | Matrix-Zeile 19 enger gefasst: v1.5.0 verlangt vollständige Audit-Envelopes nur für die sicherheitskritischen Pfade (M4-R19-01/-05/-06/-08); die übrigen Pfade (M4-R19-02/-03/-04/-07/-09) folgen nach v1.5.0 in M5. | Auf die sicherheitskritischen Pfade verengen; Rest in M5. | Nutzer | ✓ entschieden (Nutzer 04.10.) |

Entschieden am 25.09. (Entscheidungsseite des Orchestrators, umgesetzt in
PLAN-01): Meilensteine M1–M4; Streichen, Parken und Vereinfachen wie oben;
Zwischenrelease v1.5.0 (Beta) als Abschluss von M3; DF-07d erledigt; DF-15b ja;
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
