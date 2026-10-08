# PLAN — der einzige Plan für ProjectA

Stand: 08.10.2026 (Entwurf v3). Git-Basis: `origin/main` 1c09ebb;
PR-Zwischenstände nach Koordinator-Auftrag vom 08.10., ohne neue Online-Prüfung.
Dieses Dokument ist der **einzige** Plan. Andere Plandateien
sind untergeordnete Unterpläne oder Archiv (Liste am Ende). Neue Arbeit entsteht nur
hier. Wer hier nichts findet, arbeitet an nichts.

> **Für Agenten:** Lies „Für den Nutzer“, die Regeln und die Tabelle deines Ziels.
> Suche dein Paket mit `grep -n "<ID>" docs/PLAN.md`. Anhang A und B sind
> maschinenlesbar und historisch; dort entsteht keine neue Arbeit.

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
| DR-01 | Gerüst `tools/denkraum/`, Gate-Zeile in `scripts/ci/gates.sh`, Hygiene-Check (LF-Regel in `.gitattributes`, kein State-Pfad im Repo) | Seniorentwickler | – | PC | B | angenommen, Mergify ausstehend (PR #635) | `bash scripts/ci/gates.sh lane prepush` Exit 0; neue Gate-Zeile läuft die Denkraum-Tests | 55ea21ce |
| DR-01a | Überlauf im Hygiene-Check beheben, roter Test zuerst; vor DR-02 mergen | Seniorentwickler | DR-01 | Server | B | Geplant | Überlauf-Test vor Fix rot, danach grün; `bash scripts/ci/gates.sh lane prepush` Exit 0; Merge vor DR-02 | – |
| DR-02 | Ledger-Modell als Modul, Split-Beweis (verhaltensgleich) | Seniorentwickler | DR-01, DR-01a | Server | A | In Prüfung (PR #636) | FIT-Abnahme; bestehende Store-Tests unverändert grün; jede Datei ≤ 300 Zeilen; prepush Exit 0; DR-01a vor DR-02 gemergt | 55ea21ce, b0e90b72 |
| DR-03 | DeskStore-Kern | Seniorentwickler | DR-02 | Server | A | Geplant | Store-Tests grün, Revision/Konflikt verlieren keine Daten | 55ea21ce |
| DR-04 | Antworten, Quittungen, Benachrichtigungen | Seniorentwickler | DR-03 | Server | A | Geplant | Tests für Antwort/Quittung/Dedupe grün | 55ea21ce |
| DR-05 | P1-Tests der Ideen-Metadaten (Kategorie ≤ 80 UTF-16, `userPriority`) | Seniorentwickler | DR-03 | Server | A | Geplant | Metadaten-Tests grün, Grenzfälle rot vor Fix | 55ea21ce |
| DR-06 | HTTP-Server + CLI, State-Pfad außerhalb des Repos; D2: `DECISION_DESK_ROOT_AGENT_ID` per ENV/Startparameter, fail-closed | Seniorentwickler | DR-04 | Server | A | Geplant | Tests: ohne State-Pfad oder Root-Agent-ID Start verweigert; Pfad im Repo abgelehnt; fehlende Root-Agent-ID im HTTP-Pfad → 503; keine interne ID im Code/Test | 55ea21ce |
| DR-07 | Tests: API, Patches, Fortschritt, freie Antwort, Fragen-Import | Seniorentwickler | DR-06 | Server | C | Geplant | Testsuite grün im Gate | 55ea21ce |
| DR-08 | UI-Hülle `index.html` + Style, byte-genau auf Stand B1 | UX-Architekt | FIT vorbereitet, Root-FIT-Abnahme; DR-01 | egal | B | Geplant | Byte-Vergleich mit B1-Kandidat; prepush Exit 0 | 55ea21ce, 6713479b |
| DR-09 | App-Teil Fragen | UX-Architekt | DR-08 | egal | B | Geplant | Fragen-Ablauf wie B1, Harness grün | 55ea21ce |
| DR-10 | App-Teil Ideen + Werkbank auf Stand B1 | UX-Architekt | DR-08 | egal | B | Geplant | Ideen-Ablauf wie B1, Harness grün | 55ea21ce, 5945accc |
| DR-11 | UI-Harness auf `@playwright/test` portieren (nur relative Pfade) | UX-Architekt | DR-10 | Server | B | Geplant | Harness läuft im Gate auf dem Server | 55ea21ce |
| DR-12 | B2 Kategorie inkl. Pflicht-Fix R1 (Polling baut `<select>` neu, `app.js:349`), roter Test zuerst | UX-Architekt | DR-10 | egal | B | Geplant | roter Test vor Fix, danach grün; Auswahl bleibt über 15-s-Poll erhalten | 98fa8267 |
| DR-13 | Filter Priorität und Station | UX-Architekt | DR-12 | Server | B | Geplant | Filtertests grün | 98fa8267 |
| DR-14 | Stabile Sortierung | UX-Architekt | DR-13 | Server | B | Geplant | Sortiertests grün | 98fa8267 |
| DR-15 | Sicherer Start ohne manuelle Secret-Eingabe | Seniorentwickler | – | Server | A | Geplant | Start ohne Eingabe; kein Secret in Datei/Log/Commit (Secret-Scan Exit 0) | 55ea21ce |
| DR-16 | P3-Live-Schaltung: Schreibpause, Sicherung, metadatensicherer Rückweg | Stabschef | DR-07, DR-14, DR-15 | PC | A | Geplant | Drill: Pause → Sicherung → Umschalten → Rückweg ohne Datenverlust, protokolliert | b0e90b72 |
| DR-17 | Öffentliche README, Anleitung in 5 Schritten, CHANGELOG-Abschnitt Denkraum | Technischer Autor | DR-16 | egal | C | Geplant | Trockenlauf der 5 Schritte im PR-Text | 55ea21ce |

Größe vor dem Start messen: `store.mjs` (570), `app.js` (504/527) und `store.test.mjs`
(358) überschreiten je 300 Zeilen; D1 erzwingt deshalb den Split.

## Z2 — Setup und Entwicklung

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| Z2-PLAN-COMMIT | Plan v3 und Archiv gemeinsam als `docs/PLAN.md` und `docs/archive/plan-2026-10-08.md` übernehmen | Stabschef | – | egal | C | Geplant | Anhang A bytegleich; M1–M5 parsebar; `npm run test:hq` Exit 0; beide Dateien in derselben PR | – |
| Z2-RULE10 | AGENTS.md Regel 10: einen Satz zu Nutzerfreigaben aus der Projekt-Memory ergänzen; Geld, Passwörter und Releases bleiben beim Nutzer | Stabschef | – | egal | C | Geplant | Ein Satz mit dieser Regel in AGENTS.md; `bash scripts/ci/gates.sh lane precommit` Exit 0; eigene PR | – |
| Z2-REGELN | Regelwerk 2.0: Lane-A-Korrekturen (6) abschließen, Anweisungsdateien entschlacken (Lane C, Commit 6918bea), Altlasten-Audit liefert „Deine Regeln: bestätigen oder ändern“ | Stabschef + Codebase Archäologe | – | egal | C | In Arbeit | Lane-C-PR gemergt; `npm run dev:agent-check` Exit 0; Regel-Vorschläge R1–R5 in der Inbox entschieden | 77c993f3 |
| Z2-PLANPARSER | `hq-parse.mjs`, `dev-hq.mjs` und `hygiene.mjs` lesen die Z-Tabellen (Spalte Status, 8 Werte); danach Anhang B entfernen | Implementierer · Claude | Z2-PLAN-COMMIT | Server | B | Geplant | `npm run test:hq` Exit 0; HQ zeigt Z1–Z4; prepush Exit 0 | – |
| Z2-DOKSYNC | `KNOWN_ISSUES.md` „Offen“ bereinigen: KI-15, KI-16, KI-20 mit PR-Beleg; KI-33 bleibt „Kandidat“, bis ein Windows-Queue-Lauf mit der Änderung beobachtet ist | Stabschef | – | egal | C | Bereit | Jede verschobene Zeile nennt PR und Merge; KI-33 nur mit Windows-Queue-Lauf-ID und Dauer nach „Behoben“; precommit-Lane Exit 0 | – |
| Z2-AUTOSTART | Denkraum startet nach der Windows-Anmeldung von selbst, ohne Secret-Eingabe | Desktop-App-Entwickler | DR-15, DR-06 | PC | A | Geplant | PC-Neustart → `127.0.0.1:4791` antwortet ohne Eingabe; kein Secret im Klartext | – |
| Z2-PACER | Pacer läuft: Trigger mit Werkzeugen, aber nur lesend; Bericht alle 20 min | Stabschef | Inbox R5 | PC | C | Blockiert | drei Läufe nacheinander mit Bericht, keine Schreibaktion | – |
| Z2-REVIEW | Zwei feste Fremdanbieter-Wege für Stufe A: Gemini/Cursor auf dem Server (Workspace Trust), Ollama Kimi K3 + GLM, Codex; je Weg eine Probe mit beobachtetem Modell | Git- und CI-Spezialist | Inbox WT | Server | C | Blockiert | Probe je Weg mit Modellname und Zeit; Weg in `docs/setup/` beschrieben | c77f6955 |
| Z2-RAM | RAM-/Server-Standard: schwer = Server; PC nur leicht bei ≥ 1,5 GiB; idle Konsolen schließen; RAM-Wächter | Autonomer Optimierungsarchitekt | – | PC + Server | C | Geplant | 24 h ohne „local heavy STOP“, Messung im Ticket | – |
| Z2-ROUTE | Verteilung nach Verbrauchstempo über `usage_overview`; Quota-Regeln erneuern; Officer-Routine neu anmelden | Architekt für Multi-Agenten-Systeme | Nutzer: Re-Login | PC | C | Geplant | eine Woche ohne Anbieter am Limit; Routing-Beleg je Start | 492a9e36 |
| Z2-BOARD | Board aufräumen: erledigte/veraltete Tickets schließen (ef39c814, 2720b77f, 5945accc, 5de5c4c9, 7b66731d), Kurzstand-Block je Ticket, Ready-Queue ≥ 5 pflegen | Stabschef | – | egal | – | Bereit | `backlog_list`: keine erledigten Tickets mehr offen | – |

## Z3 — Rest von v1.6.0

Fertig heißt (Unterplan v1.6.0): alle Kernpakete gemergt und jede Naht unter
Baseline. Gemessen 07.10. auf 1c09ebb: `api.rs` 7908 < 8091, `store.rs` 7224 < 7227,
`bin/pa.rs` 6293 < 6490, **`main.rs` 5133, nicht unter 5133**.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| V16-ARCH-D4-05 | Queue-Routen aus `api.rs` (PR #631) | Implementierer · Codex, Abnahme Root | – | Server | A | angenommen, Mergify ausstehend | Merge über Mergify; `api.rs` 7858 | b9606dd4 |
| V16-ARCH-D7 | Einstellungen nach `store/settings.rs` (PR #632) | Implementierer · Codex | V16-ARCH-D4-05 (Review seriell) | Server | A | In Prüfung (Gemini PASS, vollständig gelesen; wartet Root-Abnahme); Entwurf | Root-Abnahme am Kandidaten `e154e4d`; dann Ready und Merge über Mergify | 782d9e58 |
| V16-06 | Start nach Update ohne Journal blockiert nicht stumm | MCP-Integrationsentwickler | Inbox V16-F3; Update-Drill | PC | A | Blockiert | roter Test zuerst; Drill Erfolg/Abbruch/Fehler | 2557db66 |
| V16-UPD-CANCEL | Abbrechen-Knopf beim Update-Download (sonst ist der Drill „Abbruch“ unmöglich) | Desktop-App-Entwickler | – | PC | B | Geplant | roter Test zuerst; Drill „Abbruch“ möglich | – |
| V16-ARCH-D2 | Doppelte Projektanlage in `main.rs` zusammenführen | Implementierer · Claude | V16-06 (Lane mn; Vorziehen: Inbox V16-D2) | Server | A | Geplant | `rg -c 'fn create_project' src-tauri/src/main.rs` → eine Umsetzung; `main.rs` < 5133 | – |
| V16-ARCH-D5a | Diagnosebefehle aus `main.rs` lösen | Implementierer · Claude | V16-ARCH-D2 | Server | A | Geplant | `main.rs` −150 Zeilen | – |
| V16-ARCH-D5b | Einstellungsbefehle aus `main.rs` lösen | Implementierer · Claude | V16-ARCH-D5a | Server | A | Geplant | `main.rs` −150 Zeilen | – |
| V16-ARCH-D8a | Ereignisnamen als Konstanten in `main.rs` | Implementierer · Claude | V16-ARCH-D5b | Server | A | Geplant | `rg -n -F -e '"worker:status"' -e '"supervisor:notification"' src-tauri/src/main.rs` → 0 Treffer außerhalb des gemeinsamen Konstantenmoduls; `cargo test --manifest-path src-tauri/Cargo.toml` Exit 0 | – |
| V16-ARCH-D8b | Ereignisnamen in PTY | Implementierer · Claude | V16-ARCH-D8a | Server | A | Geplant | `rg -n -F -e '"pty:output:' -e '"pty:exit:' src-tauri/src/pty.rs` → 0 Treffer außerhalb des gemeinsamen Konstantenmoduls; `cargo test --manifest-path src-tauri/Cargo.toml` Exit 0 | – |
| V16-ARCH-D8c | Ereignisnamen im Frontend | Implementierer · Codex | V16-ARCH-D8b | egal | B | Geplant | `rg -n -e '["\x27\x60]worker:status' -e '["\x27\x60]supervisor:notification' -e '["\x27\x60]pty:output:' -e '["\x27\x60]pty:exit:' src` → 0 Treffer außerhalb des gemeinsamen Konstantenmoduls; `npm run typecheck` und `npm run test:unit` Exit 0 | – |
| V16-ADR-A1 | ADR A1 (`ApiBackend` teilen) in `docs/decisions.md` entscheiden | Architekturberater Fable + Astra | – | egal | C | Bereit | `docs/decisions.md` A1 nicht mehr „Vorschlag (offen)“; precommit-Lane Exit 0 | – |
| V16-ADR-A7 | ADR A7 (st-Lane teilen) | Architekturberater Fable + Architekturberater Astra | V16-NACHBEOB (zwei Wochenmessungen) | egal | C | Verschoben | Eintrag in `docs/decisions.md` | – |
| V16-KI30 | KI-30 Windows-Flake: Restursache nach V16-01 | Performance- und Benchmark-Spezialist | – | Server | A | Geplant | neuer Beleg (Queue-Lauf-ID) vor Fix; danach 10 Queue-Läufe ohne KI-30 | – |
| V16-03 | Tester-Kit: Installation, Rückmeldeformular, Grenzen | Implementierer · Codex | Inbox E16; frisches Windows-Konto (Nutzer) | PC | C | Blockiert | Trockenlauf im frischen Konto | – |
| V16-CHANGELOG | CHANGELOG v1.6.0 und Release-Notiz | Stabschef | DR-17, alle Z3-Pakete | egal | C | Geplant | Eintrag `v1.6.0` über `v1.5.1` | – |
| V16-RELEASE | Tag v1.6.0 (Beta-Regel x.y.0) | Elias | Z1, Z3 | PC | – | Geplant | Elias’ Entscheidung, danach Release-Pipeline grün | – |
| V16-NACHBEOB | Zwei Wochenmessungen und 40 Queue-Läufe; Messgrößen-Leitfaden | Stabschef | v1.6.0 | Server | C | Verschoben | Wochenberichte BENCH-01/02 im Ticket | b8b16ec8 |

## Z4 — Wichtig, aber liegen geblieben

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| Z4-ARCH-D1-REST | Vierten HTTP-Fehlertext-Klassifizierer `error_status` in den gemeinsamen Klassifizierer übernehmen; ARCH-D1 bleibt offen | Implementierer · Codex | – | Server | B | Geplant | `rg -n "fn error_status" src-tauri/src/development_plan_access.rs` → 0 Treffer außerhalb des gemeinsamen Klassifizierers; `cargo test --manifest-path src-tauri/Cargo.toml` Exit 0 | – |
| Z4-E14 | Update-Signierschlüssel offline sichern (verschlüsselter Export in deinen Passwort-Manager) | Elias | – | PC | – | Geplant | Sicherung vorhanden, Schlüssel nirgends im Klartext | – |
| Z4-ARCH-11 | KI-24b: Test-DB-Wettlauf auf Windows reproduzieren und absichern (F6) | Implementierer · Claude | – | PC | A | Geplant | Vor Start betroffene Testdateien und RAM prüfen; bei `store.rs` auf V16-ARCH-D7 warten; roter Test auf Windows vor Fix, danach grün; prepush Exit 0 | – |
| Z4-R19-09 | Vollständige Audit-Envelopes für den Pfad Wartung (Matrixzeile 19) | Implementierer · Codex | V16-ARCH-D7 | Server | A | wartet #632 (store.rs) | roter Test zuerst; prepush Exit 0 | – |
| Z4-R19-ST | Audit-Envelopes Ziel/Task, Claim/Checkpoint, Intent/Launch, Kandidat/Evidence/Review (M4-R19-02/03/04/07) | Implementierer · Codex | V16-ARCH-D7 (st-Naht) | Server | A | Geplant | je Pfad roter Test; je Paket ≤ 300 | – |
| Z4-VERIFY | Offene Altzeilen prüfen: W1-03f-Rest, W3-03 (PC-Drills unbelegt), W3-07 (Produktionsschlüssel-Build), W1-18b (Codex-Probe), M4-Blocker-TOCTOU nach #306 | Codeprüfer · Claude | – | egal | C | Geplant | je Zeile Erledigt mit Beleg oder neues Paket | – |
| Z4-SERVER-DISK | Server-Platte: alte Worktrees (~151 GB) aufräumen; erst Backup | Elias entscheidet, Stabschef führt aus | Inbox E17 | Server | – | Geplant | Platte < 60 %, Backup-Beleg | – |
| Z4-RCLONE | Eigene rclone-`client_id` vor Ende 2026 | Elias | – | PC | – | Geplant | Backup läuft mit eigener ID | – |
| Z4-SETUP-14 | Rest SETUP-14: tote Keys, Permission-Regeln | Elias | – | PC | – | Geplant | Liste abgehakt | – |
| Z4-M5-01 | Testerrunde mit 3–5 externen Testern | Elias | V16-03, E16 | egal | – | Verschoben | Rückmeldungen festgehalten | – |
| Z4-M5-04 | Dogfooding: ein Orchestrierungsschritt zieht in ProjectA um | Root | Z1 | egal | – | Verschoben | Umfang festgelegt | – |

## Lanes (5 parallel)

| Lane | Reihenfolge | Ort |
|---|---|---|
| L1 Denkraum-Backend | DR-01 → DR-01a → DR-02 → DR-03 → DR-04 → DR-05 → DR-06 → DR-07; DR-15 | Server |
| L2 Denkraum-UI | DR-08 → DR-09/DR-10 → DR-11 / DR-12 → DR-13 → DR-14; dann DR-16, DR-17 | egal / Server |
| L3 Nähte (seriell) | api: #631 · st: #632 → Z4-R19-ST / Z4-R19-09 · mn: Z4-R19-09 **oder** V16-06 → D2 → D5a → D5b → D8a → D8b → D8c · pa: frei | Server |
| L4 Setup/Dev | Z2-PLAN-COMMIT → Z2-PLANPARSER; Z2-RULE10, Z2-REGELN, Z2-DOKSYNC, Z2-BOARD, Z2-REVIEW, Z2-RAM, Z2-ROUTE, Z2-PACER, Z2-AUTOSTART | egal |
| L5 Doku/PC | V16-ADR-A1, Z4-ARCH-11, V16-UPD-CANCEL, V16-KI30, V16-CHANGELOG | PC / egal |

Nie zwei aktive Pakete auf derselben Naht (`api.rs`, `main.rs`, `store.rs` + `store/`,
`bin/pa.rs`). Neue V2-Pakete starten vor Z1 nur, wenn eine Lane leer ist und Root zustimmt.

## Ready-Queue (Belegstand 07.10. 23:45 UTC)

Bereit: V16-ADR-A1, Z2-DOKSYNC, Z2-BOARD. Für diese Zeilen sind keine
Vorgänger, offenen PRs oder Dateikollisionen verzeichnet; Owner und Abnahme stehen
fest. Belege: interne Liste des Koordinators. Vor jedem Start erneut prüfen.
DR-01 und DR-02 sind in Prüfung; DR-08 wartet auf DR-01 und FIT-Abnahme.
Z4-ARCH-11 braucht den Datei-/RAM-Check; Z4-R19-09 wartet auf #632.

## Schnitt nötig (> 300 Zeilen)

| Was | Größe | Nächster Schritt |
|---|---|---|
| ARCH-12 `ApiBackend` aus `main.rs` | ~715 | nach V16-ADR-A1 in Domänenports schneiden |
| DD-RECEIPT Quittungsanzeige (285001a5) | 495 | Root wählt minimalen Schnitt nach Z1 |
| Planeditor Teil02 (73aa18e3) | ≥ 315 | nach Z1 neu schneiden |
| DD-R2-B2-02 Katalog-Grenze (31e75c00) | 340 | nach Z1 neu schneiden |

## Park-Liste

| Was | Wann wieder |
|---|---|
| v2.0-Pakete (Unterplan v2.0), Draft-PRs #613 (V2-H2), #614 (README-Galerie), #574 (UI-v2-Richtungen) | nach Z1; Disposition der Drafts in der Inbox |
| Ideenfließband P4 und P10 | nach Z1; bewusst geparkt (Koordinator, Priorität G2, 08.10.): Z1 zuerst |
| Ideenfließband P5–P9 (Vorbereitung, Pipeline, Freigabe, Board, Last) | nach Z1 |
| DD-RECEIPT, Planeditor, Studio S1a, DD-R2-Katalog, Pilot „Lernende Entwicklungskoordination“ (44ac79d9) | nach Z1 |
| W5 außerhalb des Kerns, DEVFLOW-Motor und -Ausbau, HQ2-04 und HQ2-06–10 | nach der Oberflächen-Entscheidung |
| W1-09c, W1-12, W4-03a, W3-09, W1-24c (KI-29), W2-02b-Rest, INV-SEC-PRIVATE-PATHS | bei Bedarf |
| Einschalten des Dauerbetriebs (W4-03 gebaut und gesperrt) | Entscheidung des Nutzers |
| „Später“-Themen vom 25.09. (Protokollsteuerung, Vorzeige-README, Prompt-Kompression, Command Palette, Remote-Board, hermes-agent, Dependabot-Majors, Tauri-Plugins, OmniRoute-Cutover) | wie bisher notiert |
| Ideen aus AgentsRoom (UX, HQ, Sicherheit, Orchestrierung, Abhängigkeiten, Flakes) | interne Liste des Koordinators, Disposition `park` |
| Offene HQ-Bugs in `docs/dev-hq/BUGS.md` (leere Worker, NT-17, TTL-Flake, ollama-coder, Capture) | nach Z2 |
| Orchestrator-lokal: L1–L6, BENCH-03, Tagesradar T5 | interne Liste des Koordinators, kein Repo-Paket |

## Später

Agentenideen kommen hierher. Je Zeile: Nutzen / Aufwand / Risiko.
Ein Ja des Nutzers macht daraus ein Paket.

| ID | Vorschlag | Nutzen / Aufwand / Risiko |
|---|---|---|
| VOR-RUNNER-PIN | Linux-Läufe auf ein festes Runner-Image statt `ubuntu-latest` (**Frist 19.10.**; `ci-shape.sh:130` verlangt heute `ubuntu-latest`) | hoch / S / mittel (CI-Form ändern) |
| VOR-HQ-CODEQL | HQ-Teil in CodeQL getrennt auswerten | mittel / S / niedrig |
| VOR-HQ-GH | GitHub-Lage im HQ (rotes `main`, rote PRs, Konflikte) | mittel / M / niedrig |
| VOR-STAND-CHECK | Check: STAND.md führt keine erledigten Pakete | mittel / S / niedrig |
| VOR-MUTATION | Mutationstest-Pilot (1–2 Module) | mittel / M / Abo-Verbrauch |
| VOR-ENTLASTUNG | 50 Punkte zur Entlastung des Orchestrators (Rollen trennen, weniger Mails, Kurzstand) | hoch / M / niedrig |
| VOR-ULTRA | Regeln für Ultra-/Workflow-Einsatz mit Budget und Ledger | mittel / S / Kosten |
| VOR-FE-HISTORY | `HistoryView.tsx:47` verschluckt den IPC-Fehler | niedrig / S / niedrig |
| VOR-QUEUE-REST | `queue.rs`: blockierter Eintrag ohne Zeit, negative Worker-Limits, 30-s-Sweep | mittel / M / Runtime eingefroren |
| VOR-FU-REST | Folgepunkte FU-521-a, FU-524-a, FU-535-b, FU-544-a, FU-PIPE-hotfix | niedrig / S je / niedrig |
| VOR-API-DESCRIPTOR | Descriptor-Datei unter Unix privat anlegen | mittel / S / niedrig |
| VOR-SPAETER-593…597 | Headless-Abschlussvertrag, sicheres Aktionsmuster, Startcheck-Doku, PTY-Diagnose, M4-W2-Merge-Vertrag (Texte im Archiv) | je mittel / S–M / niedrig |

## Entscheidungs-Inbox

| # | Frage | Empfehlung | Status |
|---|---|---|---|
| E14 | Update-Signierschlüssel offline sichern | ja, verschlüsselt in den Passwort-Manager; ohne Kopie geht das Update-Vertrauen bei Verlust verloren | offen, dringend |
| V16-F3 | Start nach Update ohne Journal: gesperrt bleiben mit Anleitung, oder dem ersten Start vertrauen? | gesperrt mit Anleitung (fail-closed) | offen |
| V16-F4 | Review-Fahrer auf den Server? | ja | offen |
| V16-D2 | ARCH-D2 vor V16-06 ziehen, weil V16-06 auf V16-F3 wartet? | ja, Lane mn ist frei | offen (Root) |
| WT | Gemini-/Cursor-Weg auf dem Server: Workspace Trust für den Review-Ordner | nur für den Review-Ordner | entschieden: Nutzerfreigabe F1 (08.10.) |
| R1–R5 | Regel-Vorschläge: Stufe A neu fassen; 300-Zeilen-Grenze ohne Tests/Hilfsdateien; RAM-Gate nur für schwere Arbeit; Review-Bündel = Diff + Abhängigkeiten; Pacer-Trigger ohne Einschränkung, aber nur lesend | einzeln entscheiden | offen |
| V2-OFFEN | v2.0-Fragen 5–9 und 11 | nach Z1 | offen |
| PR-ALT | Draft-PRs #613, #614, #574 (Autor Grok bzw. alte UI-Richtung): schließen oder übernehmen? | #613 mit Z2-PLANPARSER abgleichen, dann schließen oder übernehmen; #614/#574 parken | offen |
| E3 | Secrets in geschützte Environments, Required Reviewers für `release` | ja, einmal im Browser | offen |
| E15 | Bleibt der gemietete Server? (laufende Kosten) | nach v1.6.0 mit Nutzen und Kosten bewerten | offen |
| E16 | Lizenz und Geschäftsmodell vor externen Testern | vor V16-03 entscheiden | offen |
| E17 | Alte Arbeitsbäume löschen (mit Backup) | ja, zusammen mit Z4-SERVER-DISK | offen |
| M4-B | M4-Blocker `planning_access`: Projektrahmen mit #306 gemergt; ist die TOCTOU-Lücke damit erledigt? | über Z4-VERIFY prüfen, dann schließen | offen |
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

## Regeln für diesen Plan

1. **Ein Plan.** Jedes Paket steht als eine Zeile in genau einer Z-Tabelle. Neue
   Pakete entstehen nur hier; Unterpläne liefern Details, keine Pakete.
2. **Freigabe.** Was Elias beauftragt oder angestoßen hat, gilt in Planreihenfolge als
   freigegeben. Agentenideen kommen in den Abschnitt „Später“.
3. **Größe.** ≤ 300 geänderte Zeilen einschließlich Tests und Hilfsdateien; Größeres
   wird vor dem Dispatch geschnitten.
4. **Nähte seriell**, Stufen nach AGENTS.md, roter Test zuerst bei jedem Bug.
5. **Status nur mit Beleg** (Befehl, PR, Zeit). Historischer Text ist kein Live-Stand.
6. **Keine Chronik hier.** Erledigtes kommt nach `docs/ERLEDIGT.md`, Geschichte ins Archiv.
7. **Continuous bleibt eingefroren**, bis der Nutzer es freigibt.
8. **CI-Geld:** Ziel 0 €; höchstens 20 € im Monat nur nach Freigabe.

## Roadmap nach v1.6.0 (freigegeben 06.10.)

Die freigegebene v2.0-Richtung bündelt die alten Etappen in einem großen Release.

- v1.6.1: Fixrunde aus Testerrunde und Nachbeobachtung von v1.6.0.
- v1.7.0: kein Zwischenrelease; Nähte und Erststart gehen in v2.0 auf.
- v1.7.1: kein eigenes Endrelease der früheren v1.7-Etappe.
- v1.8.0: kein Zwischenrelease; Projektrahmen und eine Oberfläche gehen in v2.0 auf.
- v1.8.1: kein eigenes Endrelease der früheren v1.8-Etappe.
- v1.9.0: kein Zwischenrelease; die frühere Betriebs-Etappe geht in v2.0 auf.
- v1.9.1: kein eigenes Endrelease der früheren v1.9-Etappe.
- v2.0.0: ein großes Release für eigene Entwicklung und Kundenaufträge; ein Core, drei Anbieter-Wege.

## Unterpläne und Archiv

| Datei | Rolle |
|---|---|
| `docs/plan/v1.6.0/plan.md` | Unterplan (Details zu Z3; keine eigenen Pakete) |
| `docs/plan/v2.0/plan.md` | Freigegebener Unterplan nach Z1; PLAN-L0-SINGLE ersetzt Q10 |
| `docs/plan/roadmap/` | Alter Fahrplan; Richtung in der kurzen Roadmap oben, Details durch v2.0 ersetzt |
| `docs/MASTERPLAN.md` | Verweis; Archiv-Kandidat |
| `docs/roadmap-2.0.md` | öffentliche Übersicht für Tester (bleibt, verweist hierher) |
| [docs/archive/plan-2026-10-08.md](docs/archive/plan-2026-10-08.md) | Archiv: Ideenfließband V1.0, Modellzuordnung, Lieferprotokoll, Vision, Architektur-Rat, INV-Synthese, alte Inbox und Roadmap |
| `.pa/task_continuous_devhq.md`, `.pa/continuous_acceptance_matrix.md`, `.pa/plan_projects_w5.md`, `docs/development/HQ2_CONTRACT.md`, `docs/ERLEDIGT.md` | Verträge und Belege, gelten weiter |

Belegkorrektur zum historischen Anhang A: DF-00 bis DF-05 und DF-07 tragen
`alt-` mit Codebeleg `src-tauri/src/development_plan.rs`. PR #70 ist ein
geschlossener Queue-PR und kein Merge-Beleg für diese Pakete. Die eingefrorene
Tabelle bleibt für den Parser unverändert; maßgeblich ist diese Korrektur.

## Anhang A — DEVFLOW-Tabelle (Quelle des Planimports DF-04, unverändert)

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

## Anhang B — Meilensteine M1–M5 (historisch; Stand-Spalte am 08.10. nachgeführt; bleibt für HQ maschinenlesbar bis Z2-PLANPARSER)

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
| SETUP-14 | Nutzer: tote Keys, OpenCode-Modelle, `ollama signin`, Permission-Regeln | S | N | teilweise: → Z4-SETUP-14 (tote Keys, Permission-Regeln) |
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
| ARCH-11 | KI-24b auf Windows reproduzieren, Test-DB-Wettlauf absichern (siehe Tabelle Architektur-Pakete) | S | fR + N | offen → Z4-ARCH-11 |
| R-1 | Zwischenrelease v1.5.0 (Beta) als Abschluss von M3; Tag und Veröffentlichung darf der Orchestrator selbst, sobald alle Gates und die 27 Matrixzeilen in der Fassung vom 04.10. belegt sind (Nutzer 04.10.) | S | N + doc | ✓ v1.5.0 veröffentlicht 05.10. (`gh release list`) |

**R-1 Voraussetzungen (Stand 05.10.):** Der Tag `v1.5.0` (Beta; E24: A) setzt voraus:

- W3-02 vollständig, einschließlich W3-02f bis W3-02i. Die vier Release-Blocker sind W3-02g (Journal-Erzeuger), W3-02h (Bytes und Version ans Journal, #411-Befund C1), W3-02j (Handshake-Identität nach dem Update) und W3-02i (Wartungs-Lease, #411-Befund C2). W3-02j, weil nach jedem echten Update die App heute nicht mehr startet: die Startprüfung vergleicht den Hash der laufenden exe mit dem Hash des Update-Pakets, dazu den Datenbank-Snapshot-Hash mit der Live-Datenbank (Befund aus PR #457 und Berater Fable 5.1, 05.10.).
- Die PC-Drills 1-6 und 8 aus W3-03 (paketierte Drills) sowie der Beleg W3-08 (paketierter HQ-v1-Beleg). Sie laufen auf einem lokal signierten Installer: `node scripts/build-signed-windows.mjs` (`scripts/build-signed-windows.mjs:12` verlangt `TAURI_SIGNING_PRIVATE_KEY`, `:22-24` einen sauberen Checkout). Der Signierschlüssel steht nur in der eigenen PowerShell-Sitzung des Nutzers, vorher Backup, Installation über v1.4.1 (E25: A).
- Alle Gates und die 27 Matrixzeilen (Fassung vom 04.10.).

**Abnahme der Beta (nach dem Tag, E25: A):** Der Updater-Drill (W3-03e) und W3-07 (Produktionsschlüssel-Build, Signed-Updater-Relaunch) sind keine Voraussetzung des Tags mehr, denn sie brauchen ein echtes veröffentlichtes Update (fester Endpoint `src-tauri/tauri.conf.json:54-56`). Sie gehören zur Abnahme der Beta: Der Nutzer aktualisiert v1.4.1 bzw. v1.5.0 über den Updater. Reihenfolge der Updater-Fälle: `cancel`, `fail`, `success`.

**Versionsnamen (E24: A, 05.10.):** Die Beta trägt den Tag `v1.5.0`, das Endrelease ist `v1.5.1`, weil die Release-Pipeline nur x.y.z annimmt (`scripts/verify-windows-package.ps1:5`, `scripts/release.cmd:16`). In den Entscheidungszeilen und Notizen vom 04.10. meint „v1.5.0“ noch das Endrelease; gelesen als v1.5.1.

### M4 — Dauerbetrieb abgenommen, v1.5.1

M4 ist offen: W3-07 und der TOCTOU-Blocker sind nicht belegt geschlossen.
Ein veröffentlichtes v1.5.1 belegt die M4-Abnahme nicht.

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
| HQ2-05b | Echte Collector-/Billing-Proben je Anbieter; vorher prüfen, ob W2-03 es schon abdeckt; echte Proben mit Claude/Codex/OpenCode dürfen Abo-Kontingent verbrauchen (Nutzer 04.10.) | M | fR + N | ✓ #289, #299, #318, #341 |
| W5-02b3 | Env-Stufe als globale Einstellung (st → api → fe); Produktfrage entschieden (Nutzer 04.10.): die globale Stufe ersetzt die Isolation je Profil für gewöhnliche Agenten, Koordinatoren bleiben immer `strict`, profilspezifisches `passthrough` bleibt | M | st → api → fe | ✓ #336, #438, #442 |
| W5-02b4 | Push aus dem Worker über den Runner-Host, danach `strict` als Voreinstellung | M | pty + wk | ✓ #65 |
| W5-02b5 | Test für den `http.extraHeader`-Reset; GPG unter `strict` | S | fR | ✓ #17 |
| W1-03f | F-CORE-3 Baustein C: Zustell-Queue, `pa worker done/blocked` (braucht das Z-1-Protokoll am PC) | M | wk + pa | offen → Z4-VERIFY (Teile ✓ #301, #337, #352) |
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
| W3-03 | Paketierte Drills: Singleton, Crash/Power-Loss, Backup (3 × S) | S | N | unbelegt → Z4-VERIFY; Kits #364, #376, #379, #382, #377, #380, #384 gemergt, PC-Läufe nicht einzeln belegt |
| W3-04 | Updater-Zustände in App und HQ | S | fe + hqL | ✓ #119 |
| W3-07 | Produktionsschlüssel-Build + Signed-Updater-Relaunch; der bestehende Schlüssel bleibt (E4) | S | N | offen → Z4-VERIFY |
| W4-01 | Benchmark, verkleinert auf 5 Aufgaben statt 20 (E2, Nutzer 02.10.) | M | fR | ✓ #73 |
| W4-02 | Abnahmematrix final (27 Zeilen) | S | doc | ✓ #48 |
| W4-03 | Continuous-Aktivierung, nur nach W4-02 und mit Freigabe des Nutzers; der Schalter darf jetzt gebaut werden, fail-closed (gesperrt, bis die Zeilen 1–26 der Abnahmematrix belegt sind); einschalten tut der Nutzer selbst am Ende (Zeile 2) (Nutzer 04.10., E5) | S | mn | ✓ #481 |
| W4-04 | Release v1.5.1 (Endrelease) | S | N | ✓ v1.5.1 veröffentlicht 06.10. (`gh release list`) |
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
| M5-01 | Testerrunde mit 3–5 externen Testern (N = Zahl noch offen) | S | N | Verschoben → Z4-M5-01 |
| M5-02 | Produktfokus als Aussage im README: „sicherer Dauerbetrieb für KI-Agenten: Not-Aus, Kostenkontrolle, Protokoll“ | S | doc | ✓ #576 |
| M5-03 | ARCH-G1 Regeldokument `docs/architecture-rules.md` + ARCH-G2 Drift-Gate in der CI | M | ci + doc | ✓ G1 #316, G2 #304 (04.10.) |
| M5-04 | Dogfooding: ein Orchestrierungsschritt zieht in ProjectA um (Umfang später festlegen) | M | später | Verschoben → Z4-M5-04 |
| ARCH-D1 | Vier HTTP-Fehlertext-Klassifizierer zu einem | S | api | offen → Z4-ARCH-D1-REST; drei Klassifizierer mit #596 gebündelt |
| ARCH-D2 | Projektanlage ist in `main.rs` doppelt umgesetzt | S | mn | offen → Z3 V16-ARCH-D2 |
| ARCH-D3 | Elf direkte `BEGIN IMMEDIATE` zu einem Store-Helfer | M | st | ✓ #577, #587 |
| ARCH-D4 | Restlicher API-Router mit 51 Zweigen: kleinere serielle Teil-PRs, insgesamt ≥ 300 Zeilen Netto-Abbau in `api.rs`; je PR ≤ 300 Gesamtdiffzeilen einschließlich Tests (ARCH-D4-PLAN) | M | api | offen → Z3 V16-ARCH-D4-05 (Teile 1–4 ✓ #623, #625, #627, #629) |
| ARCH-D5 | Diagnose- und Einstellungsbefehle aus dem Befehls-Monolithen in `main.rs` herauslösen | M | mn | offen → Z3 V16-ARCH-D5a/b |
| ARCH-D6 | `pa::run` vermischt Verteilung und Darstellung | M | pa | ✓ #579, #589 |
| ARCH-D7 | Einstellungs-Speicherung in ein Untermodul unter `store/` | M | st | offen → Z3 V16-ARCH-D7 |
| ARCH-D8 | Ereignisnamen als gemeinsame Konstanten in Rust und TypeScript | M | mn → pty → fe | offen → Z3 V16-ARCH-D8a–c |
| M4-R19-02 | Vollständige Audit-Envelopes für die Pfade Ziel/Task (Matrixzeile 19) | S | st | offen → Z4-R19-ST |
| M4-R19-03 | Vollständige Audit-Envelopes für die Pfade Claim/Checkpoint (Matrixzeile 19) | S | st | offen → Z4-R19-ST |
| M4-R19-04 | Vollständige Audit-Envelopes für die Pfade Intent/Launch (Matrixzeile 19) | S | st | offen → Z4-R19-ST |
| M4-R19-07 | Vollständige Audit-Envelopes für die Pfade Kandidat/Evidence/Review (Matrixzeile 19) | S | st | offen → Z4-R19-ST |
| M4-R19-09 | Vollständige Audit-Envelopes für den Pfad Wartung (Matrixzeile 19) | S | mn | offen → Z4-R19-09 |
