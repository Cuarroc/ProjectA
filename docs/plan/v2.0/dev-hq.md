# Dev-HQ in ProjectA 2.0: geht in der App auf

Stand 06.10.2026, Basis `origin/main` 01a0bf7. Eingabe für [`plan.md`](plan.md). Entwurf; der Nutzer entscheidet (Frage 6). Belege sind `rg`-/`wc`-Ausgaben; was nicht gelesen wurde, steht als „prüfen“. Nichts wurde gestartet: weder die App noch `npm run hq:live`.

## 1. Kurzantwort (Runde 3)

Das Dev-HQ ist in v2.0 **keine eigene Oberfläche** mehr. Jede seiner Ansichten geht in einen der 10 Bildschirme der App auf (Abschnitt 3); Rust und SQLite besitzen den Zustand, kein Node-Parser und kein zweiter Server daneben. Die **Systemkarte ist Doku, kein Bildschirm** (V2-DOC-MAP). Was bleibt, ist ein Zugang zu derselben App über einen Browser auf einem anderen Gerät (die **Fernansicht**, hinter einem Schalter, nach dem Kern): derselbe Code, dieselben Bausteine, dasselbe Backend, nur mit eingeschränkten Rechten (antworten, stoppen; nicht starten, nicht mergen). Die alten statischen Seiten und das Studio-Konzept werden eingefroren und nach v2.0 entfernt (Löschen entscheidet der Nutzer, vorher Sicherung).

## 2. Was das HQ heute ist (Beleg)

| Teil | Befund | Beleg |
|---|---|---|
| Seiten | sieben Seiten, eine Datei `hq.js` (1721 Zeilen) wählt die Ansicht nach dem Dateinamen; Now, Proof, Map, Next, Sources, Lessons lesen den eingecheckten Schnappschuss `data.js` (2454 Zeilen) und laufen auch ohne App | `docs/dev-hq/hq.js:14-20,1268,1361,1342,1446,1526,1475`; `wc -l` |
| Live-Ansicht und Server | fünf Tabs (Übersicht, Agenten-Teams, Statistiken, Belege, System) über einen Node-Proxy nur auf `127.0.0.1`; drei Schichten (Host, Sitzungstoken, Control-API-Token nur serverseitig) | `docs/dev-hq/workspace.js:14-20`; `package.json:29`; `scripts/hq-live.mjs:54,60-63,614` |
| Schreiben | Nachrichten, Queue-Einträge abbrechen, mergen, Fragen beantworten, Teams in `agents.json` schreiben | `hq.js:1092-1260,549` (aus einer Recherche; vor einem Paket neu prüfen) |
| Dauerbetrieb | eigene Karte, „no scheduler“; `capabilities.continuousScheduler: false` | `docs/dev-hq/continuous.js:1-30`; `main.rs:2909-2910` |
| Rust-Seite | `/api/hq/v1/*` und `pa hq …` | `src-tauri/src/api/hq_routes.rs`; `src-tauri/src/bin/pa.rs:36-47` |
| Gleiche Aufgaben zweimal | HQ und App lesen dieselbe Control-API; „Nichts doppelt bauen“ steht schon im PLAN | `hq.js:982-1118`; `docs/PLAN.md:253` |
| Eigener Parser, erzeugte Dateien | `scripts/lib/hq-parse.mjs` (379 Zeilen) liest `docs/PLAN.md`, Rust hat `development_plan.rs`; `data.js`/`data.json` sind eingecheckt und erzeugen Merge-Konflikte | `wc -l`; `.gitattributes:14-22`; Gate `hotspot-guard` |
| Schon vorhandene Fernansicht | die App liefert eine Board-Seite auf Loopback (`/board`, `/board.json`) | `src-tauri/src/web_interface.rs:1-14` |

Die Token-Zahlen der Live-Statistik sind zum Teil Schätzungen („Zeilen × 10 × 6“, Faktor 0,5 bis 2; `docs/dev-hq/README.md:109-123`); sie dürfen in v2.0 nicht als Messwert erscheinen.

## 3. Jede Ansicht: Ziel-Bildschirm

Bildschirme und Routen: [`plan.md`](plan.md), Abschnitt 3.4 (V2-IA-1 bestätigt sie).

| HQ-Ansicht | Beleg | Entscheidung | Ziel-Bildschirm | Begründung |
|---|---|---|---|---|
| **Now** (nächste Entscheidung aus `STAND.md`, Spec-Spuren) | `hq.js:1268` | in die App | Eingang & Plan (Tab Plan), Leitstand | Quelle bleibt `docs/PLAN.md` (V2-H2), nicht eine zweite Kopie |
| **Map** (Meilensteintabellen) | `hq.js:1342` | in die App | Eingang & Plan (Roadmap) | Teilmenge des Plan-Boards |
| **Next** (startbar, wartet, offen) | `hq.js:1446` | in die App | Eingang & Plan (kritischer Pfad), Leitstand (Verlauf) | dasselbe rechnet die Maschine mit Naht-Spur (V2-RUN-2) |
| **Proof** (Fakt / Behauptung / unbelegt) | `hq.js:1361` | in die App | Beweise | wird Beweiskette und Block NICHT ABGEDECKT am Commit (V2-B9) |
| **Sources** (Pfad und SHA-256 der Eingaben) | `hq.js:1526` | streichen (Daten bleiben im Beweis) | Beweise, Leitstand (Verlauf) | als eigene Seite liest sie niemand |
| **Lessons** und `npm run hq:lesson` | `hq.js:1475`; `package.json:33` | in die App (CLI bleibt) | Gedächtnis | derselbe Speicher (V2-H5) |
| **Live · Übersicht** | `workspace.js:14-16` | in die App | Leitstand | Flotte, Queue, Fragen, Empfehlungen |
| **Live · Agenten-Teams** (schreibt `agents.json`) | `hq.js:345,549` | in die App | Team (Organigramm, Personas) | Teams, Rechte, Failover gehören in den Store |
| **Live · Statistiken** | `workspace.js:14-20` | in die App, Schätzung streichen | Core · Steuerung (Kontingente, Kostenbuch) | gemessene Werte (Usage-Ledger) ja, die Schätzformel nein |
| **Live · Belege** | `workspace.js:14-20` | in die App | Beweise, Gedächtnis | wie Proof und Lessons |
| **Live · System** (Setup-Helfer) | `hq.js:721` | in die App | Ersteinrichtung, Einstellungen | `FirstRunChecklist.tsx` existiert schon |
| **Dauerbetrieb-Karte** | `continuous.js:1-30` | behalten, eingefroren | Leitstand (ehrlicher Zustand „aus, gesperrt bis …“) | bleibt bis M4 aus (AGENTS.md) |
| **Fernansicht** (neu, aus Live und Proxy) | `hq-live.mjs:373-412`; `web_interface.rs:1-14` | Zugang zur App im Browser | Einstellungen (Tab Benachrichtigungen & Handy), Leitstand | Abschnitt 4 |
| **Studio-Konzept** (`concepts/`) | `docs/dev-hq/concepts/` | streichen nach v2.0 | – | die Glass-Boards ersetzen es (Frage 6b) |
| **Schnappschuss-Erzeuger** `dev-hq.mjs`, `data.js/json` | `scripts/dev-hq.mjs`; `.gitattributes:14-22` | streichen, sobald Plan und Beweise in der App laufen | – | beendet die Konfliktquelle |

Reihenfolge: Eine Ansicht wird erst gestrichen, wenn ihr Ersatz in der App echte Daten zeigt.

## 4. Fernansicht (hinter Schalter, nach dem Kern)

Dieselbe Oberfläche als Browser-Build mit einem Übertragungsweg über HTTP statt Tauri (V2-H3). Sie zeigt den Leitstand, „Braucht dich“, die Kontingente und den Not-Aus; ein gekoppeltes Gerät darf nur antworten und stoppen (V2-H4: `merge` und `start` liefern 403).

- Die App läuft in E2E-Tests schon im Browser, aber nur gegen eine Attrappe: `src/main.tsx:8-10` lädt `tauriBrowserMock` nur bei `import.meta.env.DEV` und `VITE_TAURI_MOCKS`. Alle 89 `invoke<`-Aufrufe in `src/lib/ipc.ts` laufen heute über Tauri; ein Adapter an dieser einen Stelle genügt, solange keine Komponente `invoke` selbst ruft (prüfen: `rg -ln 'invoke\(' src --glob '!*.test.*'`).
- Der Not-Aus ist verdrahtet (`estop.rs:9`, 10 s; `main.rs:1401`; `api.rs:545`); es fehlt nur die Sichtbarkeit in der Kopfleiste (`EmergencyStop` hängt nur in `src/components/settings/GeneralTab.tsx:113`).
- **Nicht:** ein zweiter Scheduler, ein Weg um die Freigabe des Nutzers, ein Zugang aus dem Internet ohne Entscheidung (Frage 5).

## 5. Zustandsformen

Das HQ bekommt keinen eigenen Look; es gibt nur noch die Bausteine aus `src/design/`. Zuordnung der HQ-Wörter auf die sechs Formen (Teil von V2-F3):

| HQ-Wort | Glass-Form |
|---|---|
| startable / wartet / blockiert / pausiert | keine Form im Entwurf: Text in grauer Schrift (Frage 6a); `Main.dc.html:489` zeigt „0 alte Aufträge pausiert“ nur als Text |
| FACT | Erledigt (Haken) |
| CLAIM | In Prüfung (halber Kreis) |
| UNPROVEN | Fehler (Dreieck), wenn ein Beleg verlangt war; sonst „veraltet“ (gestrichelter Kreis, `Gedaechtnis.dc.html:273`) |
| aktiv / running | Läuft |
| wartet auf den Nutzer | Braucht dich |

## 6. Pakete

Siehe [`plan.md`](plan.md), Abschnitt 3.6: V2-H1 (Hinweis „geht in der App auf“ und Zuordnung), V2-H2 (ein Plan-Parser in Rust), V2-H3, V2-H4, V2-H6 (Fernansicht, hinter Schalter), V2-H5 (Lessons im Store), V2-H7 (Aufräumen von `docs/dev-hq/` nach Freigabe, mit Sicherung).

## 7. NICHT ABGEDECKT

- `hq.js` nicht Zeile für Zeile gelesen; Zeilenangaben aus einer Recherche, vor einem Paketstart neu prüfen (`hq.js:1092-1260`, `hq.js:549`, `hq-live.mjs:373-412`).
- Ob alle Komponenten nur über `ipc.ts` mit dem Backend sprechen, ist ungeprüft (V2-H3 beginnt mit dieser Zählung).
- Die Boards wurden als Text gelesen, nicht gerendert; es wurde kein Build, kein Test und keine App gestartet.
