# Dev-HQ in ProjectA 2.0: Bewertung und Rolle

Stand 06.10.2026, Basis `origin/main` 719426c. Eingabe für [`plan.md`](plan.md). Das ist ein Entwurf; der Nutzer entscheidet (Abschnitt 6). Belege sind `rg`-/`wc`-Ausgaben vom 06.10.; was ich nicht gelesen habe, steht als „prüfen“ da. Nichts davon wurde gestartet: weder die App noch `npm run hq:live`.

## 1. Kurzantwort

Das Dev-HQ steht heute neben ProjectA und zeigt zu großen Teilen dasselbe wie die App, nur mit eigener Optik, eigenem Server und einem eigenen Parser. Für v2.0 ist es **keine zweite Oberfläche mehr**. Seine Ansichten wandern in die Bildschirme des Entwurfs „Glass Leitstand“ (Plan, Beweise, Gedächtnis, Kontingente). Übrig bleibt eine einzige eigene Aufgabe, die die App nicht kann: **die Fernansicht**. Wer am Handy oder in einem Browser auf einem anderen Gerät sehen will, was die Agenten tun, und mit „Braucht dich“ antworten oder den Not-Aus drücken will, bekommt dieselben Bildbausteine wie die App (ein Design-System, ein Wörterbuch der sechs Zustände) und dasselbe Backend, nur über einen Browser statt Tauri. Die alten statischen Seiten und das Studio-Konzept werden eingefroren und nach v2.0 entfernt (Löschen entscheidet der Nutzer, vorher Sicherung).

## 2. Was das HQ heute ist (Beleg)

| Teil | Befund | Beleg |
|---|---|---|
| Seiten | sieben Seiten, eine Datei `hq.js` (1721 Zeilen) wählt die Ansicht nach dem Dateinamen | `docs/dev-hq/hq.js:14-20`; `wc -l` |
| Statische Seiten | Now, Proof, Map, Next, Sources, Lessons lesen den eingecheckten Schnappschuss `data.js` (2454 Zeilen) und laufen auch ohne App (`file://`) | `hq.js:1268,1361,1342,1446,1526,1475`; `docs/dev-hq/README.md:18-19` |
| Live-Ansicht | fünf Tabs: Übersicht, Agenten-Teams, Statistiken, Belege, System; spricht über einen Node-Proxy mit der App | `docs/dev-hq/workspace.js:14-20`; `hq.js:257` |
| Server | `npm run hq:live` = `node scripts/hq-live.mjs` (618 Zeilen), nur auf `127.0.0.1` | `package.json:29`; `scripts/hq-live.mjs:614` |
| Zugriff | drei Schichten: erlaubter Host, Sitzungstoken je Prozess, Control-API-Token nur serverseitig; Merge und Urteil brauchen zusätzlich ein Einmal-Token, das der Nutzer einfügt | `hq-live.mjs:54,60-63`; `hq.js:386-387` |
| Schreiben | kann Nachrichten senden, Queue-Einträge abbrechen, mergen, Fragen beantworten, Teams in `agents.json` schreiben | `hq.js:1092-1260,549` (Auszug aus der Recherche; Zeilen vor einem Paket neu prüfen) |
| Dauerbetrieb | eigene Karte für Ziele, Pause, Drain; „no scheduler“ | `docs/dev-hq/continuous.js:1-30` |
| Rust-Seite | `/api/hq/v1/*` (350 Zeilen) und `pa hq …`; `capabilities.continuousScheduler: false`, `launchIntent: false` | `src-tauri/src/api/hq_routes.rs`; `src-tauri/src/bin/pa.rs:36-47`; `main.rs:2909-2910` |
| Studio-Konzept | drei Konzeptseiten, nicht verlinkt; PLAN hat „Mix“ mit Studio-Layout als Richtung festgelegt (HQ2-02, E1) | `docs/dev-hq/concepts/`; `docs/PLAN.md:109,495` |
| Gleiche Aufgaben zweimal | HQ und App lesen dieselbe Control-API (Flotte, Queue, Fragen, Quota); „Nichts doppelt bauen“ steht schon im PLAN | `hq.js:982-1118`; `docs/PLAN.md:253` |
| Optik | eigene dunkle Tokens, Schrift Recursive; Live-Tab zusätzlich Segoe UI und Mint. Kein Token gleicht einem Glass-Token | `hq.css:1,12-19`; `docs/dev-hq/DESIGN.md:5-9`; Glass: `glass/Main.dc.html:19-52` |
| Erzeugte Dateien | `data.js`/`data.json` sind eingecheckt und erzeugen Merge-Konflikte; der Start von `hq:live` schreibt sie neu | `.gitattributes:14-22`; `hq-live.mjs:41-45`; Gate `hotspot-guard` (AGENTS.md) |
| Eigener Parser | `scripts/lib/hq-parse.mjs` (379 Zeilen) liest `docs/PLAN.md`; Rust hat `development_plan.rs` für denselben Plan | `wc -l`; `rg -n development_plan src-tauri/src` (Treffer: `main.rs`, `api/hq_routes.rs`) |
| Bekannte Mängel | Restzeit-Schätzung „4 h je Spec“ unbelegt, Zustand `blocked` fehlt, UTC-Tagesgrenze | `docs/PLAN.md:459-463` (V16-07 behandelt vier davon) |
| Schon vorhandene Fernansicht | die App liefert eine Board-Seite auf Loopback (`/board`, `/board.json`) | `src-tauri/src/web_interface.rs:1-14`; `src/components/WebInterfacePanel.tsx` |

Eine Zeile aus der Recherche habe ich nicht übernommen: Die Aussage „Token-Zahlen sind belegt“ gilt nicht, die Zahlen der Live-Statistik sind zum Teil Schätzungen („Zeilen × 10 × 6“, Faktor 0,5 bis 2; `docs/dev-hq/README.md:109-123`). Sie dürfen in v2.0 nicht als Messwert erscheinen.

## 3. Jede Ansicht: behalten, in die App, Fernansicht oder streichen

Spalte „Vorbild“ nennt das Board des Entwurfs (`docs/design/2026-10-ui-v2/glass/<Name>.dc.html`).

| HQ-Ansicht | Beleg | Entscheidung | Vorbild | Begründung |
|---|---|---|---|---|
| **Now** (`index.html`): nächste Entscheidung aus `STAND.md`, Spec-Spuren | `hq.js:1268` | **in die App** | Plan, Leitstand | „Plan und Entscheidungen im selben Fenster“ (Inventar, Zeile „Plan & Entscheidungen“) ersetzt sie. Die Quelle ist `docs/PLAN.md`, nicht eine zweite Kopie |
| **Map** (`map.html`): Meilensteintabellen | `hq.js:1342` | **in die App** | Plan (Roadmap) | Das Board hat Roadmap, Graph, Board, Charts und Entscheidungen; die Tabellen sind eine Teilmenge |
| **Next** (`next.html`): startbar, wartet, offen | `hq.js:1446` | **in die App** | Plan (kritischer Pfad), Team-Lauf | Dasselbe berechnet der Orchestrator mit Naht-Spur und Abhängigkeiten |
| **Proof** (`proof.html`): Fakt / Behauptung / unbelegt | `hq.js:1361` | **in die App** | Beweise | Die Idee bleibt (ein Satz ohne Beleg gilt nicht), sie wird zur Beweiskette und zum Block NICHT ABGEDECKT am Commit |
| **Sources** (`sources.html`): Pfad und SHA-256 der Eingaben | `hq.js:1526` | **streichen** (Daten bleiben im Beweis) | Beweise, Aktivität | Als eigene Seite liest sie niemand; die Herkunft gehört an den Beleg |
| **Lessons** (`lessons.html`) und `npm run hq:lesson` | `hq.js:1475`; `package.json:33`; `lessons.json` (623 Zeilen) | **in die App** (CLI bleibt) | Gedächtnis (Lessons mit Abstimmung) | Das Board führt Notizen und Lessons zusammen; der Befehl, den Agenten benutzen, bleibt, bis die App denselben Speicher hat (Paket V2-H5) |
| **Live · Übersicht** | `workspace.js:14-16` | **in die App** | Leitstand | Flotte, Queue, Fragen, Empfehlungen sind der Leitstand |
| **Live · Agenten-Teams** (schreibt `agents.json`) | `hq.js:345,549`; `README.md:50-62` | **in die App** | Organigramm, Personas | Teams, Rechte, Failover gehören in den Store, nicht in eine Datei, die ein Node-Skript schreibt |
| **Live · Statistiken** (Zeit, Token, Commit-Heatmap) | `workspace.js:14-20`; `README.md:109-123` | **in die App**, Schätzung streichen | Kontingente (Kostenbuch, Zeugnisse) | Gemessene Werte (Usage-Ledger) ja; die Schätzformel nein |
| **Live · Belege** | `workspace.js:14-20` | **in die App** | Beweise, Gedächtnis | wie Proof und Lessons |
| **Live · System** (Setup-Helfer) | `hq.js:721` | **in die App** | Ersteinrichtung, Einstellungen | Die App hat schon `FirstRunChecklist.tsx`; das Board erweitert sie |
| **Dauerbetrieb-Karte** | `continuous.js:1-30` | **behalten, eingefroren** | Leitstand, Team-Lauf (ehrlicher Zustand) | Bleibt bis M4 aus (AGENTS.md, „Development loop“); die Oberfläche zeigt „aus, gesperrt bis …“ statt einer Attrappe |
| **Fernansicht** (neu, aus `live.html` + Proxy) | `hq-live.mjs:373-412`; `web_interface.rs:1-14` | **wird die Fernansicht** | Benachrichtigungen & Handy, Leitstand | siehe Abschnitt 4 |
| **Studio-Konzept** (`concepts/`) | `docs/dev-hq/concepts/` | **streichen** nach v2.0 | – | Die Glass-Boards ersetzen die Studio-Richtung (Nutzerentscheid 06.10.); der Eintrag E1/HQ2-02 wird dadurch überholt (Frage D6 in `plan.md`) |
| **Schnappschuss-Erzeuger** `dev-hq.mjs`, `data.js/json` | `scripts/dev-hq.mjs`; `.gitattributes:14-22` | **streichen**, sobald Plan und Beweise in der App laufen | – | Beendet die Konflikt-Quelle; bis dahin eingefroren |

Reihenfolge: Eine Ansicht wird erst gestrichen, wenn ihr Ersatz in der App echte Daten zeigt (Abnahme je Paket in `plan.md`).

## 4. Rolle in v2.0

**Empfehlung (ein Absatz).** Das Dev-HQ hört auf, ein zweites Produkt zu sein. Alles, was ein Entwickler im Alltag braucht, steht in der App (Plan, Beweise, Gedächtnis, Kontingente), mit den Bausteinen des Glass-Entwurfs und einem Backend: Rust und SQLite besitzen den Zustand, kein Node-Parser daneben. Das HQ lebt als **Fernansicht** weiter: derselbe Code der Oberfläche, gebaut als Browser-Variante, mit einem Übertragungsweg über HTTP statt Tauri. Sie zeigt den Leitstand, die Fragen („Braucht dich“), die Kontingente und den Not-Aus, und sie erlaubt nur, was ein gekoppeltes Gerät darf (antworten, stoppen; nicht starten, nicht mergen), wie es das Board „Benachrichtigungen & Handy“ zeigt. So gehört das HQ zu ProjectA 2.0, statt daneben zu stehen: ein Gerät, ein Look, ein Wörterbuch.

**Warum das tragfähig ist (Belege).**
- Die App läuft in E2E-Tests schon im Browser, aber nur gegen eine Attrappe: `src/main.tsx:8-10` lädt `tauriBrowserMock` nur bei `import.meta.env.DEV` und `VITE_TAURI_MOCKS`. Das ist kein Produktionsweg. Der Übertragungsweg über HTTP ist deshalb ein eigenes Paket (V2-H3). Alle 89 `invoke<`-Aufrufe in `src/lib/ipc.ts` laufen heute über Tauri (`rg -c 'invoke<' src/lib/ipc.ts` → 89); ein Adapter an dieser einen Stelle genügt, solange keine Komponente `invoke` selbst ruft (prüfen: `rg -ln 'invoke\(' src --glob '!*.test.*'`).
- Die Control-API (Token, Host-Prüfung) und der Proxy sind schon gebaut und getestet; neu sind nur die Kopplung und die eingeschränkten Rechte.
- Der Not-Aus ist schon verdrahtet (`estop.rs:9`, 10 s; `main.rs:1401`; `api.rs:545`). Es fehlt nur die Sichtbarkeit in der Kopfleiste: `EmergencyStop` hängt nur in `src/components/settings/GeneralTab.tsx:113`.

**Was die Fernansicht nicht ist.** Kein zweiter Scheduler (`docs/PLAN.md`, „HQ is a host/proxy“, AGENTS.md), kein Weg, die Freigabe des Nutzers zu umgehen, keine Öffnung ins Internet ohne Entscheidung des Nutzers (Frage D5 in `plan.md`, mit Empfehlung: nur im eigenen Netz oder über SSH-Tunnel).

## 5. Anpassung des Aussehens

Regel: **Das HQ bekommt keinen eigenen Look.** Die Fernansicht benutzt die Bausteine aus `src/design/` (Paketfolge V2-F1 bis V2-F5), nicht eine Kopie.

| Thema | Heute im HQ | Ziel (Glass) | Beleg Glass |
|---|---|---|---|
| Farben | `--ground #1c2228`, `--paper #dfe6ea`, Akzent Stahlblau/Ember (`hq.css:12-19`) | `--ground #E9EDF3` hell / `#0D1219` dunkel, Akzent `#1F57D6` / `#6E9BFF` | `glass/Main.dc.html:19-31,40-52` |
| Hell/Dunkel | dunkel als Standard, hell nur per Systemeinstellung (`hq.css:2797`) | beide gleichwertig, Umschalter | `glass/Main.dc.html:468` (`themeClass`) |
| Schrift | Recursive (statisch), Segoe UI (live) | Geist, Geist Mono, Rückfall Segoe UI | `glass/Main.dc.html:13,35` |
| Oberfläche | deckend | Glas mit Weichzeichner, zwei Materialien (`chrome`, `glass`) | `glass/Main.dc.html:65-68` |
| Zustände | eigene Wörter und Farben je Seite | sechs Formen mit Wort und Farbe: Läuft (Ring), Braucht dich (Raute), In Prüfung (halber Kreis), Bereit zum Mergen (voller Kreis), Erledigt (Haken), Fehler (Dreieck) | `glass/Main.dc.html:185-195,362-367` |
| Bewegung | keine Regel | 120/200/320 ms, ein Puls für „Läuft“, `prefers-reduced-motion` schaltet ab | `glass/Main.dc.html:33-34,217-229` |

Zuordnung der HQ-Wörter auf die sechs Formen (Vorschlag; die Zuordnung ist ein Teil von Paket V2-F3):

| HQ-Wort | Glass-Form |
|---|---|
| startable / wartet / blockiert / pausiert | **keine Form im Entwurf.** Das Board `Main` kennt „Wartet“ und „Pausiert“ nur als Text (`glass/Main.dc.html:432`: „0 alte Aufträge pausiert“), nicht als Zustand einer Karte. Vorschlag: Queue-Zustände bleiben Text in grauer Schrift ohne Form; eine siebte Form nur, wenn der Nutzer es will (D4) |
| FACT | Erledigt (Haken) |
| CLAIM | In Prüfung (halber Kreis) |
| UNPROVEN | Fehler (Dreieck) nur, wenn ein Beleg verlangt war; sonst die Form „veraltet“ (gestrichelter Kreis) aus `glass/Gedaechtnis.dc.html:234-239` |
| aktiv / running | Läuft |
| wartet auf den Nutzer | Braucht dich |

Die Lücke (Warten, Blockiert, Pausiert haben im Entwurf keine Form) ist ein echter Befund und steht in der Entscheidungs-Inbox von `plan.md` (D4).

## 6. Pakete, die daraus folgen

Sie stehen auch in der Paketliste von [`plan.md`](plan.md), Abschnitt 3. Größe nach der heutigen Regel (S ≤ 150, M ≤ 300 Zeilen).

| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Abnahme |
|---|---|---|---|---|---|---|---|
| V2-H1 | HQ einfrieren: Hinweis „Vorgänger der App-Ansichten“ in `docs/dev-hq/README.md`, kein neues Feature in `hq.js`/`hq.css`; Zuordnung aus Abschnitt 3 als Tabelle dort | doc | – | C | S | – | `npm run dev:agent-check` Exit 0 |
| V2-H2 | Ein Plan-Parser: `docs/PLAN.md` wird nur noch von Rust gelesen (`development_plan.rs` um Pakete, Abhängigkeiten, Wellen, Inbox erweitern), `hq-parse.mjs` ruft ihn nicht mehr; Grundlage für die Boards Plan und Team-Lauf | fR | – | B | M | – | roter Test zuerst: Fixture mit allen Spalten der Meilenstein-Tabellen; `cargo nextest run --profile ci` Exit 0 |
| V2-H3 | Browser-Übertragungsweg: `src/lib/transport/` mit Adapter „Tauri“ und Adapter „HTTP“ hinter dem heutigen `ipc.ts`; zweiter Vite-Einstieg `remote.html` | fe | – | B | M | V2-F1 | Test: derselbe Aufruf über beide Adapter liefert dieselbe Form; `npm run build` Exit 0; Screenshot 1440×900 hell und dunkel |
| V2-H4 | Kopplung und eingeschränkte Rechte (QR-Kopplung, Recht nur „antworten, stoppen“, Ablauf, Widerruf); die Control-API-Tokens bleiben serverseitig | api | api.rs (Hook), `api/` | A | M | V2-H3, V2-ST-C2 | zwei Fremd-Reviews; roter Test: gekoppeltes Gerät darf `merge` und `start` nicht (HTTP 403); Not-Aus-Probe über die Fernansicht ≤ 10 s |
| V2-H5 | Lessons im Store: `npm run hq:lesson` liest und schreibt denselben Speicher wie das Board Gedächtnis; `lessons.json` wird einmal migriert | fR + st | store/ | A | M | V2-ST-B3 | Test: Migration verlustfrei (Anzahl, Abstimmungen); `npm run hq:lesson -- search` Exit 0 |
| V2-H6 | Fernansicht ausliefern: die Rust-Seite liefert den Browser-Build aus (`web_interface.rs`), Node-Proxy entfällt | mn | main.rs | A | M | V2-H4 | zwei Fremd-Reviews; `npm run hq:live` wird nicht mehr gebraucht; Host-/DNS-Rebinding-Test bleibt grün |
| V2-H7 | Aufräumen: `docs/dev-hq/` (Seiten, Studio, Schnappschuss, Erzeuger) entfernen | doc | – | C | S | V2-H2, V2-H5, v2.0 abgenommen, Freigabe des Nutzers | Sicherung vorher; `npm run dev:agent-check` Exit 0 |

## 7. NICHT ABGEDECKT

- Ich habe `hq.js` nicht Zeile für Zeile gelesen; Zeilenangaben ab Abschnitt 2 stammen aus einer Recherche und sind für `hq.js:1092-1260`, `hq.js:549` und `hq-live.mjs:373-412` vor dem Paketstart neu zu prüfen.
- Ob alle Komponenten nur über `ipc.ts` mit dem Backend sprechen, ist ungeprüft (V2-H3 beginnt mit dieser Zählung).
- Die Boards wurden als Text gelesen, nicht gerendert (sie brauchen die Laufzeit des Entwurfswerkzeugs, die nicht im Repo liegt).
- Es wurde kein Build, kein Test und keine App gestartet.
