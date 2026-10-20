# Planhistorie bis Oktober 2026

Quelle: `docs/PLAN.md` auf `653db64985563c8a3e1603cd6d30906648ada41d`.
Die folgenden Quellblöcke sind unverändert archiviert. Sie sind keine neuen
Aufträge; aktuelle Aufgaben, Freigaben und Restabnahmen stehen im [Masterplan](../../PLAN.md).
Gültige Anforderungen und Entscheidungen bleiben als verlinkte Verträge erhalten.

### Serverreserve 3 — begrenzte Werkzeug-Härtung (historisch, erledigt)

Root-Auftrag 09.10. 00:52 CEST (msg-0mv04muwa), keine zweite Produktroadmap. Gemeinsame Basis `a8f00322b510dd48df67cc50ad0650b879902e40`; fünf unabhängige
Dateipaare ohne Nähte/package.json/gemeinsame Helfer oder Gate-Änderungen. Owner jeweils EIN vorhandener, durch Root/Stabschef benannter Worker; kein Dispatch
oder Fehlernachweis durch diesen Eintrag. Erst bestehenden Testbestand lesen,
benanntes kompilierendes Rot vor Source-Fix; kein Befund/kein Zusatznutzen = Rückgabe
mit Beleg statt erfundener Änderung. Jede Einheit ≤ 180 ALL, ein Worktree/PR.
Hypothesen stammen aus begrenztem Source-Nachlesen; Graphzugang war nicht angeboten.
| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| Z2-STATUS-CI | main-Gates nicht durch jüngeren grünen CodeQL-Lauf verdecken; gemischte Workflow-Fixture; exklusiv scripts/dev/status-report.mjs + scripts/lib/dev-status-report.test.mjs | Root/Stabschef benennt einen vorhandenen Owner | main a8f0032; unabhängig | Codex Cloud Node 20 möglich; Server Node 24 | B | Erledigt #773 (merged 2026-10-09T00:48:18Z) | benanntes Rot: ältere rote CI + jüngeres grünes CodeQL bleibt sichtbarer CI-Blocker; bestehende Zeit-/Zeilenlimitfälle erhalten | 77c993f3 |
| Z2-SETUP-VERSION | Nicht-endliche/ungültige Node-Versionsangaben dürfen Pflichtcheck nicht grün machen; exklusiv scripts/dev/agent-setup-check.mjs + scripts/lib/agent-setup-check.test.mjs | Root/Stabschef benennt einen vorhandenen Owner | main a8f0032; unabhängig | Codex Cloud Node 20 möglich; Server Node 24 | B | Erledigt #772 (merged 2026-10-09T00:48:05Z) | benanntes Rot: Infinity/ungültige Majorversion fail; echte Node 24 bleibt ok, fehlende optionale Programme weiterhin nur Warnung | 77c993f3 |
| Z2-ERLEDIGT-META | Fehlerhafte Merge-Metadaten vor Tabellenwrite ablehnen; exklusiv scripts/dev/erledigt-row.mjs + scripts/lib/dev-erledigt-row.test.mjs | Root/Stabschef benennt einen vorhandenen Owner | main a8f0032; unabhängig | Codex Cloud Node 20 möglich; Server Node 24 | B | Erledigt #769 (merged 2026-10-09T00:48:09Z) | benanntes Rot: ungültiges mergedAt erzeugt keine NaN-Datumszeile/keinen Write; gültiges UTC-Datum/Replay erhalten; nur temporäre Fixture | 77c993f3 |
| Z2-SPEC-STATUS | Unbekannten Spec-Status nicht still als historisch umschreiben; exklusiv scripts/dev/spec-close.mjs + scripts/lib/dev-spec-close.test.mjs | Root/Stabschef benennt einen vorhandenen Owner | main a8f0032; unabhängig | Server | B | Erledigt #767 (merged 2026-10-09T00:33:27Z) | benanntes Rot: Status-Tippfehler verweigert ohne Änderung an Spec/STAND; erlaubte Statuswerte aus bestehendem Spec-Vertrag lesen/pinnen; dry-run und historische Wiederholung erhalten | 77c993f3 |
| Z2-PUSH-REMOTE | Optionsähnlichen Remote-Wert vor Git-Aufruf abweisen; exklusiv scripts/dev/push-verified.mjs + scripts/lib/dev-push-verified.test.mjs | Root/Stabschef benennt einen vorhandenen Owner | main a8f0032; unabhängig | Server | A | Erledigt #788 (merged 2026-10-09T01:17:15Z); ersetzt: In Prüfung: Draft #788 (GitHub 09.10.) | benanntes Rot: --remote -x verweigert ohne Push/Netzwerk; gültiger Remote/Branch sowie Remote-SHA-Beweis erhalten; nur injizierter Runner | 77c993f3 |

Benannte Rotfälle (exakte neue Testnamen, je Zeile obiges Dateipaar):
`STATUS-CI: newer CodeQL cannot mask failing ci`,
`SETUP-VERSION: non-finite node major fails mandatory check`,
`ERLEDIGT-META: invalid merge date refuses without write`,
`SPEC-STATUS: unknown status refuses without write`,
`PUSH-REMOTE: option-like remote refuses before push`.
Für jedes Paar: `node --test --test-name-pattern='<exakter neuer Testname>' <Testdatei>`
auf Basis rot und Kopf grün; danach `node --test <Testdatei>` und eigene vollständige
`bash scripts/ci/gates.sh lane prepush` auf Server Node 24, Exitcodes unverdeckt.
Cloud darf nur die isolierten Node-20-Fixtures ausführen; das senkt keine Projekt-
Node-24-Voraussetzung. Keine realen GitHub-/Git-/Spec-/Ledger-Schreibtests.
B: ein Reviewer außerhalb der Autorenfamilie; A: zwei andere Anbieter, jeweils
an Kandidaten-SHA gebunden (OpenAI-Autor: Anthropic plus zulässiger Ollama-Weg
nach frischem Laufzeit-/Creditbeleg). Fehlender Reviewer bleibt Blocker.
Vor Start aktuelle offene PR-Dateien, Owner, Modell/Quote/RAM/Prozesse prüfen;
vor Merge Root-Abnahme. Folgeumfang/unklare Vertragswerte an Root zurückgeben.


## Lanes (5 parallel) — historisch (v1.6.0, erledigt 09.10.)

| Lane | Reihenfolge | Ort |
|---|---|---|
| L1 Denkraum-Backend | DR-01 → DR-01a → DR-02 → DR-03 → DR-04a → DR-04b → DR-04c → DR-06a → DR-06b → DR-05 / DR-07; DR-15 | Server |
| L2 Denkraum-UI | DR-08 → DR-09 → DR-10 → DR-11 → DR-12 → DR-13 → DR-14; dann DR-16, DR-17 | egal / Server |
| L3 Nähte (seriell) | st: V16-KI30 #737 exklusiv bis Tag v1.6.0 · mn: #728 D5b gemergt → D5-GUARD → V16-UPD-CANCEL (vor Start Backend/IPC → UI teilen) → V16-06; E2 beantwortet · api: frei · pa: frei | Server |
| L4 Setup/Dev | PLAN-C1 → GOALS-B mit Z2-RULE10; danach Archiv-/Bereinigungsschnitte und Z2-PLANPARSER; Z2-REGELN, Z2-DOKSYNC, Z2-BOARD, Z2-REVIEW, Z2-RAM, Z2-ROUTE, Z2-PACER, Z2-AUTOSTART | egal |
| L5 Doku/PC | V16-ADR-A1 (erledigt), V16-CHANGELOG | PC / egal |

Nie zwei aktive Pakete auf derselben Naht (`api.rs`, `main.rs`, `store.rs` + `store/`,
`bin/pa.rs`). Historisch bis v1.6.0 (09.10.): neue V2-Pakete starteten vor Z1 nur bei leerer Lane und mit Root-Zustimmung; aktuelle Arbeit: v2.0 eng (Entscheid 15.10., `plan/v2.0/plan.md` Abschnitt 10).

GOALS-A läuft leicht parallel zur Produktlieferung; GOALS-C nutzt vorhandene Arbeit.
GOALS-B und weitere PLAN-Edits sind beim Chief seriell. Z1 behält Vorrang;
Prozessarbeit belegt keine Z1-Dateien oder Nähte. Native Goal-Ausgaben und Adoption
stehen im Ticket, nicht in gespeicherten Profilen oder zugestellten Nachrichten.

### DR-07c/d/e1/e2: vier weitere P1-Testports (historischer Startvertrag; erledigt: 07c #752, 07d #753, 07e1 #751, 07e2 #755)

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

### Serverreserve: drei disjunkte Startverträge (Root 08.10., 20:45Z; historisch, erledigt #725/#726/#727)

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

### Serverreserve 2: fünf zusätzliche Startverträge (Root 08.10., 21:27Z; historisch, erledigt #738/#739/#742/#745/#746)

Auftrag `msg-0mv01rpmz-e52b4baf`: ENTWERFEN/PFLEGEN; Root dispatcht.
Gemeinsame geprüfte Basis: `9d9eaa78e2d135bc0144809ae9712e2cda51da31`
(origin/main, #722 gemergt). Die drei #722-Umsetzungen bleiben bei den vorhandenen
Eigentümern: #725 `94eca3b`, #726 `5cb73e1`, #727 `a4e0fc9`, laut Root damals in Prüfung; alle drei gemergt (#725 `5bc5a55b`, #726 `ea6ca7e2`, #727 `fbb6be67`).
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
Multi-Naht-Parserfall zählt nicht mit: #574 ist als überholt geschlossen
(Nutzer 08.10.); daraus entsteht kein neuer Parserauftrag. CIWATCH ersetzt ihn mit einem unabhängigen Dateipaar.
Diese fünf Z2-Paare
benötigen keinen der blockierten Pfade.

### Anpassungsnachweis DR-15a und Übergaben (08.10. 04:40 UTC, historisch)

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

### Anpassungsnachweis PLAN-C1 (historisch)

Anlass: Root-Prüfung von #642 am 6183605 meldet 2068 ALL > 300 und konkrete
Status-/Regelwidersprüche. Vorher: ein kombinierter, nicht abgenommener Entwurf.
Änderung: zuerst der vollständige aktive Z1–Z4-Kopf mit GOALS-A/B/C; alter Bestand
bleibt wortgleich als Historie und Parserquelle im selben PLAN. #642 ist als überholt geschlossen (Nutzer 08.10.); Audit- und
Originalbelege bleiben erhalten. Rest: Archivierung/Bereinigung in eigenen kleinen Paketen,
GOALS-B samt Z2-RULE10 und betroffene Delta-Belege; Anforderungen bleiben gleich.
Abnahme dieses Schnitts: DF-Bestand bytegleich, M1–M5 parsebar, Pointer in STAND
zeigen Z1, ≤ 300 ALL und prepush Exit 0. Nächster Owner: Chief legt den Kandidaten
Root vor; Root nimmt ab, erst danach Ready/Queue. Merge/Wirksamkeit separat melden.


### Beantwortete Karten vom 13.10.2026 — Zwei-Modi und Anbieter

Quelle: Root-Nachricht `msg-0mv6r7v7k-cf69b2e2`, erstellt am
13.10.2026 um 14:06:16.256 UTC; überliefert durch Interview & Entscheidungen
in `msg-0mv7eepdo-81fd35b6` vom 14.10.2026. Root berichtet die Antwort des Nutzers
„ich folge allen von deinen Empfehlungen.“ gegen 14:05 UTC; zu Anbieter-E1
zuvor „Ja ich folge allen empfehlungen“ gegen 13:25 UTC. Die Chatzeiten sind
laut Root, keine unabhängig gelesenen Chat-Zeitstempel. Der Inhalt steht bereits
im Freigaberegister `user-standing-permissions`; dieser Nachtrag dokumentiert
die Antworten und erteilt keine neue Freigabe.

| # | Beschlossene Empfehlung | Status / Geltungsbereich |
|---|---|---|
| Z1 (Zwei-Modi, 13.10.) | Eine App mit Autopilot und gemeinsamem Entwerfen; gemeinsames Entwerfen als Einstieg | angenommen laut Root gegen 14:05 UTC |
| Z2 (Zwei-Modi, 13.10.) | Autopilot darf Design und Architektur innerhalb des freigegebenen Auftrags entscheiden, mit unabhängiger Prüfung | angenommen; neue Ziele und Schutzgrenzen bleiben beim Nutzer |
| Z3 (Zwei-Modi, 13.10.) | Live-Vorschau, zwei Varianten und „hier ändern“ neben dem Chat; dritte Variante nur auf Wunsch | angenommen |
| Z4 (Zwei-Modi, 13.10.) | Schrittweise ab v2.2 | angenommen; v2.0/v2.1-Umfang unverändert |
| E1 (Anbieter, 13.10.) | Ollama als Arbeiter auf dem Server | ja laut Root gegen 13:25 UTC; Installation/Anbindung über den eigenen Login des Nutzers und späteren run-job-Providerfall; keine neuen Kosten |
| E2 (Anbieter, 13.10.) | Codex Pro 500 / Ultrafast | nein laut Root gegen 14:05 UTC; kein Upgrade |
| E3 (Anbieter, 13.10.) | Jev-Ultrafast-Probe | erst nach v2.0, Idea Radar `95aeb521`; keine Freigabe eines kostenpflichtigen Schlüssels |

Die Konzeptkarten heißen im Konzeptbericht E1–E4, im Register Z1–Z4.
Diese Themenlabels ersetzen weder die älteren PLAN-E-Karten noch die
Projektziele Z1–Z4. Beschlossen bedeutet nicht umgesetzt oder wirksam;
aus dem Nachtrag entsteht kein Umsetzungsauftrag und keine Freigabe neuer
Kosten, Schlüssel oder Releases. Keine offene Nutzer-Frage; nicht erneut vorlegen.

Beleggrenze: `konzept-zwei-modi.md` lag laut Übergabe am geprüften lokalen
Berichtspfad nicht vor; keine Originalbericht-Prüfung. Die historische Nachricht
belegt keinen aktuellen Ollama-Job- oder Loginzustand. Chief pflegt den Nachtrag;
Root nimmt ihn ab und disponiert spätere Umsetzung.

GitHub-Quellen zum Statusabgleich (09.10.2026 00:59 UTC):
`gh pr view <n> --json state,mergedAt` für #749, #738, #745, #751, #755, #752,
#728, #767, #768, #764, #777, #769, #772 und #773: alle MERGED; Zeitpunkte stehen an den Paketzeilen.
`gh pr list --state merged --search 'merged:>=2026-10-09T00:33:48Z' --limit 100 --json number,state,mergedAt`:
nach #749 die Merges #768, #764, #769, #772 und #773 beobachtet. Offene Draft-/Ready-Stände aus `gh pr list`
und den jeweiligen PR-Berichten; Merge ist keine neue Laufzeitabnahme.
`gh api repos/Cuarroc/ProjectA/environments/release`: Regel `required_reviewers`,
Typ User, Login Cuarroc. Kein Secret gelesen, keine Environment-Einstellung geändert.


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


## Ideenfließband-Anforderungen und historischer Übergabestand (V1.0)

Der folgende vollständige Originaltext ist unverändert importiert (SHA329a53ca…124b2c, 198 Zeilen). Sein Lieferprotokoll/Statuslog und seine Cloud-/Ticket-Pflegebeschreibung sind historischer Übergabestand; ausschließlich der obige PLAN-Kopf und aktuelle datierte Dispositionen führen Status/Freigaben. Unterpläne entstehen erst mit abhakbarem Umfang; hier wird keine weitere Plandatei angelegt.

<!-- PLAN-L0-P0 V1.0 BEGIN -->
# ProjectA: Ideenfließband – Umsetzungsplan
Version 1.0 · 7. Oktober 2026 · Auftraggeber: Nutzer · Ausführungsverantwortung: bestehender ProjectA-Orchestrator

## 1. Verbindlicher Auftrag und erste Lieferung

Der Nutzer möchte jetzt möglichst bald Ideen im Denkraum erfassen, langfristig sammeln, geordnet wiederfinden und bereits erste Einordnungen sehen. Die Oberfläche soll während ihrer Weiterentwicklung benutzbar bleiben. Das vollständige Fließband wächst um diesen nutzbaren Kern herum. Neue Ideen sollen laufende Entwicklungsarbeit nicht unterbrechen.

Diese Anweisung autorisiert den Orchestrator zur Umsetzung dieses Produktausbaus, zum Einsatz seiner Agenten, geeigneter Workflows und des vorhandenen Servers. Vorhandene Kosten-, Sicherheits- und Betriebsgrenzen bleiben verbindlich; „volle Power“ ist keine unbegrenzte Beschaffungserlaubnis. Der Orchestrator organisiert verfügbare Kapazitäten selbst und meldet konkrete Grenzen statt pauschal auf weitere Freigaben zu warten. Es wird keine neue QA-Bot-Delegation beauftragt.

**Lieferziel L0: Der Nutzer kann die Website öffnen, eine Textidee speichern, nach Neuladen wiederfinden, bearbeiten und nach Kategorie, Wichtigkeit und Bearbeitungsstand sortieren.** Ein sichtbarer Abschnitt „Noch nicht geprüft“ verhindert, dass erste Vermutungen wie fertige Bewertungen erscheinen. Eine einfache Stationsübersicht zeigt, wo Ideen stehen. Die aufwendige Graphansicht, automatische Recherche und komplette Patchplanung dürfen diese erste Lieferung nicht blockieren.

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
| Zur Entscheidung | lesbare, feste Planversion mit Alternativen | Der Nutzer genehmigt genau diese Version oder verlangt Änderung |
| Bereit | genehmigter und ausführbarer Plan | Kapazität und Voraussetzungen für Patch vorhanden |
| Eingeplant | verbindliches Paket mit Owner und Abhängigkeiten | Orchestrator startet tatsächlich |
| Umsetzung | belegte Arbeitsstände und Ergebnisse | Integration und relevante Abnahme nachgewiesen |
| Geliefert | erreichbare Funktion und Beleg | Ergebnis für Nutzer verfügbar |

„Wartet auf den Nutzer“, „Wartet auf Abhängigkeit“, „Blockiert“, „Zurück zur Ausarbeitung“ und „Geparkt“ sind zusätzliche Zustände, keine erfundenen Fortschrittsschritte. Eine große Idee kann mehrere Lieferteile und Patches haben. Der Elternstatus ergibt sich aus deren tatsächlichem Umfang.

Die vollständige Stationsfolge wird zunächst angezeigt, auch wenn nur frühe Stationen arbeiten. Unfertige Stationen sind eindeutig als „Wird ergänzt“ gekennzeichnet. Gespeicherte Ideen bleiben dort vorgemerkt; nach Aktivierung verarbeitet ein kontrollierter Rückstandslauf sie ohne Neueingabe.

## 4. Freigabe und Priorisierung

Agenten und Orchestrator dürfen Ideen vorschlagen und bis zum entscheidungsreifen Plan vorbereiten. **Agentenideen dürfen erst nach ausdrücklicher Freigabe durch den Nutzer verbindlich eingeplant oder umgesetzt werden.** Herkunft bleibt im UI sichtbar. Für Nutzerideen ist das Erfassen allein ebenfalls keine Umsetzungsfreigabe. Dieser Produktausbau selbst ist durch den aktuellen Auftrag autorisiert.

Freigabe bindet Ideenrevision, Planversion und relevanten Umfang. Wesentliche Änderungen an Ziel, Aufwand, Risiko oder Abnahme machen eine alte Freigabe überprüfungsbedürftig. Empfang, Speichern, automatische Bewertung und Root-Quittierung ersetzen keine Freigabe.

Erste Sortierung einfach und erklärbar:
- Nutzerpriorität: dringend / hoch / normal / später; vom Nutzer jederzeit korrigierbar.
- Nutzen: erwartete Wirkung plus kurze Begründung.
- Aufwand: klein / mittel / groß / unbekannt; später Bandbreite mit Annahmen.
- Risiko: niedrig / mittel / hoch / ungeprüft; konkrete Stolperfallen separat.
- Abhängigkeiten und frühester sinnvoller Zeitpunkt.
- Evidenz: ungeprüft / plausibel / belegt; Herkunft und Prüfdaten.

„Schwere“ wird bei Fehlern als Schweregrad verwendet. Bei Featureideen heißt das Feld Risiko oder Komplexität; ein großes Feature ist nicht automatisch ein schwerer Fehler.

Agenten geben Empfehlungen, der Nutzer kann sie ändern. Keine undurchsichtige Gesamtnote als alleinige Wahrheit. Die Umsetzung berücksichtigt Nutzen, Dringlichkeit, Abhängigkeiten, Aufwand, Unsicherheit und verfügbare Kapazität. Große wertvolle Ideen werden bei Bedarf geteilt, nicht automatisch nach hinten verdrängt. Wartende Ideen regelmäßig neu ansehen, damit kleine schnelle Aufgaben sie nicht dauerhaft verdrängen.

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
| P2 | Frontend: Eingabe, Liste, Filter, Sortierung und Detail | P0, abgestimmter P1-Vertrag | Der Nutzer kann den vollständigen L0-Ablauf bedienen |
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

Kein Agent stoppt geräuschlos. Ein Blocker meldet betroffene Aufgabe, konkreten Grund, Zuständigkeit, bereits vorbereiteten nächsten Schritt und benötigte Nutzerhandlung. Fehlende Anmeldung soweit möglich vorbereiten; der Nutzer führt nur den unvermeidbaren interaktiven Schritt aus. Danach funktionierenden Zugriff prüfen und Arbeit tatsächlich wieder aufnehmen.

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

Die erste reale Nutzerprüfung: Der Nutzer erfasst drei unterschiedliche Ideen, verändert eine, setzt Priorität und Kategorie, sucht sie wieder, lädt die Seite neu und findet denselben Inhalt. Mindestens eine Idee bleibt sichtbar als noch ungeprüft; ihre spätere Bearbeitung ist vorgemerkt. Ein simulierter Speicherfehler zeigt einen erhaltenen Entwurf statt einer falschen Erfolgsmeldung. Bestehende Inhalte und Quittierungswege bleiben funktionsfähig.

Weitere Pflichtfälle der zuständigen Entwickler: konkurrierende Revisionen, wiederholtes Ereignis, Neustart während Job, alte Planfreigabe nach wesentlicher Änderung, Agentenidee ohne Freigabe, blockierte Abhängigkeit und abgeschlossene Lieferung mit tatsächlichem Beleg. Testumfang nach realer Änderung wählen; vorhandene passende Prüfungen verwenden. Es wird kein QA Bot gestartet.

Erfolg zuerst messen an: Zeit bis zur ersten wirklich nutzbaren Sammlung, erfolgreich erhaltenen Eingaben, Zeit vom Erfassen bis Einordnen, Anteil nachvollziehbarer Bewertungen und sichtbar aufgelösten Blockern. Später Plan-Durchlaufzeit, Nacharbeit und gelieferter Nutzen ergänzen. Anzahl Agenten, Kritikpunkte oder Nachrichten ist keine Erfolgsmetrik.

**An den Orchestrator:** Lies den Plan vollständig. Ordne ihn den bestehenden Tickets zu und benenne den kleinsten sicheren L0-Lieferweg. Dispone bestehende Paket-/Zugriffsblocker innerhalb deiner Befugnisse. Starte konkrete parallele Aufgaben mit eindeutigen Ownern und nutze den vorhandenen Server sinnvoll. Liefere zuerst die erreichbare, dauerhafte Ideensammlung; entwickle die übrigen Stationen danach weiter, während der Nutzer bereits Ideen sammelt. Bestätige echten Empfang, tatsächlichen Start und den ersten benutzbaren Stand jeweils mit Belegen. Melde nur reale Grenzen; behauptete Ausführung ersetzt keine Lieferung.

### Lieferprotokoll

| Stand | Beleg | Status |
| --- | --- | --- |
| Plan V1.0 erstellt | Cloud-Seite und lokale Markdown-Fassung | Dokument fertig |
| Root hat persönlich gelesen | noch einzutragen | nicht bestätigt |
| L0 tatsächlich gestartet | Ticket / Owner / Arbeitsbeleg einzutragen | nicht bestätigt |
| L0 für den Nutzer erreichbar | Link / Zugriffsprüfung / Abnahme einzutragen | nicht bestätigt |

<!-- PLAN-L0-P0 V1.0 END -->


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


## Vision (Nutzer 25.09., historisch)

- **Eine Oberfläche:** Das Dev-HQ wird nach M3 der Hauptbereich im App-Fenster.
  Ein Kern, ein Fenster. HQ2-02 legt die Richtung fest.
- **Orca als Brücke:** Bis M3 wird mit Orca, Claude Code und Codex gearbeitet,
  danach schrittweise mit ProjectA selbst (überholt: seit 03.10. AgentsRoom statt Orca, v2-Plan Abschnitt 4a).
- **Agenten-Abteilungen mit Leitern:** Die erste Abteilung ist Prüfung/Reviews.
  Sie startet klein nach M1, mit eigenem Budget.


## Entscheidungs-Inbox (historisch 04.10., nicht maßgeblich)

Offene Fragen an den Nutzer stehen hier gebündelt, mit Empfehlung. Am 04.10. hat der Nutzer E1, E4, E5, E10, E11, E12, F1, F3 und F6 beantwortet (zwei
neue Zeilen halten die Freigaben fest). Offen sind E3, der M4-Blocker, E14 (dringend), E15 und E16 (beide nach v1.5.0), E17 (niedrig, nicht auf dem v1.5.0-Pfad), E18 (hoch, auf dem v1.5.0-Pfad) sowie E21–E23; E20 hat der Nutzer am 04.10. entschieden (Option A); E19 ist als Beraterentscheid festgehalten und kann vom Nutzer überstimmt werden. Falls der Nutzer E21–E23 in der nächsten Sitzung nicht beantwortet, entscheiden Fable + Astra; der Nutzer kann überstimmen. F2, F4, F5 und E13 (am 03.10. freigegeben und eingespielt,
Nachweis siehe E13) sind entschieden und werden nicht neu gefragt. Agenten
unterbrechen den Nutzer nicht einzeln im Chat, sondern tragen die Frage hier ein
(AGENTS.md, Regel 10).
Nachtrag 15.10.: E3 (09.10.) und E14 (14.10., laut Root) sind erledigt; maßgeblich ist die aktuelle Inbox oben.

| # | Frage | Empfehlung | Wer entscheidet? | Status |
|---|---|---|---|---|
| PLAN-L0-SINGLE | Nur EIN Plandokument `docs/PLAN.md`; Masterplaninhalte an richtiger Stelle integrieren, Unterpläne erst bei abhakbarem Umfang. | Ganzen 198-Zeilen-V1.0-Text inline erhalten; 255/270-Zwei-Dateien-Kandidaten nur historische Übergaben, nicht integrieren. | Nutzerauftrag laut Root-Mail `msg-0muy9f100-5279e4be`, 07.10.15:25:47 UTC | Entschieden; finale Ein-Datei-Anwendung bleibt an Root-FIT und normale Gates gebunden; keine Cloud-Synchronisierung behauptet. |
| ARCH-D4-PLAN | ARCH-D4a/D4b: das API-Abbauziel mit kleineren seriellen Teil-PRs erreichen? | Gesamtziel ≥ 300 Zeilen Netto-Abbau in `api.rs` beibehalten; je Teil-PR ≤ 300 Gesamtdiffzeilen einschließlich Tests. | Nutzer | ✓ entschieden (06.10.2026): `serial-total300`, Frage Revision 1; Antwort `6b733c02-a4ff-466e-aaf6-905511d5570c`, gespeichert 21:55:57.174 UTC, Rootempfang 21:57:52.126 UTC (State-Revision 7). Keine Vorgabe ≥ 150 je Teil-PR. Red-first, vollständige Gates, Tier A mit zwei anderen Anbietern und serielle API-Naht bleiben verbindlich. Umsetzungskriterien: `docs/plan/v1.6.0/plan.md`, Abschnitt 3. Empfang ist kein Umsetzungsbeleg. |
| E1 | HQ2-02: Demo und Studio ansehen und die Richtung für die eine Oberfläche festlegen. Der Entscheid blockiert die Farbthemen T2–T5 in HQ2-03. | In M3 entscheiden und danach HQ2-03 starten. | Nutzer | ✓ entschieden (Nutzer 04.10.): Mix. Das Studio-Layout (`hq2-concept`/`hq2-studio`) ist die Richtung für „HQ als Hauptbereich der App“, dazu die Einleitungsleiste und die Entscheidungsbox „Dein Urteil ist gefragt“ aus der Demo (zweite Antwort ~17:15). HQ2-03 ist freigegeben und baut darauf auf. |
| E1-Hinweis | HQ2-02/03 blockiert die Farbthemen T2–T5. | Erst HQ2-02 festlegen, dann die Farbthemen in HQ2-03 bearbeiten. | Nutzer | Hinweis |
| E2 | W4-01: Benchmark auf 5 Aufgaben verkleinern oder durch ein Nutzer-Gate ersetzen | 5 Aufgaben | Nutzer | ✓ entschieden: 5 Aufgaben (Nutzer 02.10.) |
| E3 | Secrets aus der Repo-Ebene in geschützte Environments, Required Reviewers für `release` | ja; einmal im Browser klicken | Nutzer | Nachtrag 15.10.: erledigt (siehe „E3 (Altfrage)“ in der aktuellen Inbox); ursprünglich: offen (Nutzer) |
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
| E14 | Offline-Sicherung des Updater-Signierschlüssels. Er liegt heute nur als Repository-Environment-Secret, es gibt keine lokale Kopie. | Verschlüsselter einmaliger Export in den Passwort-Manager des Nutzers; ohne Kopie geht bei Verlust das Update-Vertrauen verloren. | Nutzer | beantwortet: Durchführung 14.10. laut Root (siehe Z4-E14); ursprünglich: offen, Nutzer, dringend |
| E15 | Bleibt der gemietete Build-Server nach dem Release? (Kostenentscheidung; Betrag steht hier nicht.) | Nach v1.6.0 mit Nutzen und Kosten bewerten. | Nutzer | offen, nach v1.6.0 |
| E16 | Lizenz und Geschäftsmodell vor den ersten externen Nutzern. Heute MIT; Optionen: MIT bleiben, Open Core, Doppellizenz. Für echte Verkäufe rechtliche Beratung einholen. | Vor V16-03 entscheiden. | Nutzer | offen, vor externen Testern |
| E17 | Alte Arbeitsbäume entfernen? 29 von 81 sind nachweislich sicher (PR gemergt oder geschlossen, 0 geänderte Dateien, 0 ungepushte Commits, 0 Commits außerhalb von main); Liste liegt beim Orchestrator. Löschen entscheidet der Nutzer, vorher Backup. | Niedrige Priorität; nicht auf dem v1.5.0-Pfad. | Nutzer | offen, niedrig |
| E18 | Matrixzeile 3 (riskante Übergänge, `resume`): Für v1.5.0 einengen? Vorschlag (Empfehlung): `resume` ist in v1.5.0 nicht verfügbar; ein Laufzeittest mit echtem Store belegt, dass `resume` ohne, mit falschem und mit aktuellem Urteil abgelehnt wird und nichts verändert, auch nach Neustart (Paket M4-ROW3-A eingereiht). Alternative: urteilsgebundenes `resume` bauen (5 Pakete, davon 2 auf der st-Spur, v1.5.0 ca. 1–2 Tage später). Bis zur Antwort gilt der Vorschlag als Arbeitsannahme. | Hohe Priorität; v1.5.0-Pfad, Empfehlung annehmen. | Nutzer | v1.5.x ausgeliefert — neu zu formulieren |
| E19 | Matrixzeilen 15 und 17 eingeengt statt neu gebaut (Berater Fable + Astra, 04.10., beide Empfehlung: einengen). Echte Policy-Revision je Kandidat (DF-13) und echte Freigabe-Widerrufung (W5-02d) werden in M5 nachgeprüft. Gilt als Beraterentscheid; der Nutzer kann widersprechen. | Hohe Priorität; v1.5.0-Pfad. | Nutzer | entschieden (Berater), Nutzer kann widersprechen |
| E20 | Zeilen 18 und 27 blockieren v1.5.0 in der heutigen Fassung: `releaseEligible` verlangt Review-Befugnis (W5-02d, nach M4 geparkt) und zugleich eingeschalteten Dauerbetrieb, obwohl E5 sagt, der Dauerbetrieb bleibt bis nach der Abnahme aus. Optionen: (A, Empfehlung beider Berater) v1.5.0 = App-Release über den menschlich kontrollierten Weg PR -> Gates -> Merge-Queue; Dauerbetrieb wird aus und nicht releasefähig ausgeliefert; Zeile 18/27 und das Audit werden getrennt (App-Release vs. Dauerbetrieb), der Nutzer bestätigt die Abnahme selbst in einer Datei; (B) Review-Befugnis jetzt bauen (mehrere Stufe-A-Pakete an Nahtstellen, v1.5.0 deutlich später); (C) Release verschieben. | Höchste Priorität; v1.5.0-Blocker. | Nutzer | ✓ entschieden (Nutzer 04.10.): Option A — v1.5.0 = App-Release, Dauerbetrieb aus und nicht releasefähig, Abnahme per Nutzer-Attestierung |
| E21 | Matrixzeile 2 (Aktivierung durch eine einzelne Nutzerentscheidung): Dauerbetrieb bleibt in v1.5.0 aus (E20). Optionen: (A, Empfehlung) Zeile 2 lautet für v1.5.0 „Schalter gebaut und gesperrt (W4-03), Einschalten erst nach v1.5.0“; (B) Zeile 2 nach M5 verschieben. | v1.5.0-Pfad klären. | Nutzer | v1.5.x ausgeliefert — neu zu formulieren |
| E22 | Matrixzeile 16 (unabhängige Reviews): Heute laufen Reviews als PR-Text mit anderer Modellfamilie; eine Review-Freigabe in der App gibt es in v1.5.0 nicht (W5-02d nach M4 geparkt). Optionen: (A, Empfehlung) Zeile 16 für v1.5.0 auf „Review durch andere Modellfamilie im PR, an denselben Kandidaten gebunden“ verengen, echte App-Freigabe in M5; (B) offen lassen bis M5. | v1.5.0-Pfad klären. | Nutzer | v1.5.x ausgeliefert — neu zu formulieren |
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


Aktuelle Aufgaben: [Masterplan](../../PLAN.md).
