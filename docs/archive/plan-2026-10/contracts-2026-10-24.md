# Historische Quellen und weiterhin gebundene Verträge — 24.10.2026

Quelle: `docs/PLAN.md` an `47cfc971d546d7749dac517715b86e3d713724ce`. Datierte Originale; kein Dispatch. Spätere Entscheidungen und aktive Pflichten stehen im [Master](../../PLAN.md). Relative Navigation ist unten ausdrücklich aufgelöst; die Quellblöcke bleiben bytegleich.

## reserve-3
```text
### Serverreserve 3 — begrenzte Werkzeug-Härtung (historisch, erledigt)
[Originaltext][historie]

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
```
## release-order
```text
### Release-Reihenfolge — Nutzer-Entscheid 08.10., Root 22:04Z (historisch, v1.6.0 am 09.10. erschienen)

[Historische Reihenfolge](archive/plan-2026-10/history.md#release-reihenfolge-vor-v160).

V16-NACHBEOB, V16-ADR-A7, V16-03 und D8a–c sind keine Vorgänger von V16-RELEASE.
Tester-Kit/Trockenlauf bleibt ein eigener offener Nachweis; die optionale Windows-Sandbox
ist nicht aktiviert; ihre Aktivierung ist nicht freigegeben. E16 vor externen Testern bleibt offen.
Wissenspilot/#651 ist geschlossen (nicht gemergt), DEV-KNOW-01 bleibt verschoben; der abgeschlossene Messschnitt
wird nicht wiederholt. „Lernende Entwicklungskoordination“ ist ebenfalls nach v1.6.0
verschoben (Nutzer 08.10.); im geprüften aktiven Z-Kopf fehlt eine eigene Paketzeile,
daher kein neuer Ausführungsvertrag/Ticket aus diesem Namen. Z2-RECHTE-PILOT bleibt verschoben.
Z4-M4B-0-AUTH (#1607) und Z4-M4B-1a-PLUMB (#1836, 9cc16b85) sind gemergt.
GOAL (#1842, `fa4f2d9a`), TASK (#1849, `8c86bfc4`) und ASSIGN (#1852,
`88ef0b77`) sind angenommen und gemergt; IMPORT (#1855, `d39a03f1`, 23.10. 02:42:19Z) ist ebenfalls gemergt.
Root schließt damit den Source-Lade-/Autorisierungsbefund, nicht alle M4B-Pflichten;
Import-Testnachlauf c91a08d0, GOAL-Restbefunde (Ticket 2dbc396c-9b74-4556-9c28-d9e00f5c6310), separate Audit-Transaktion
und Windows-Nachweis bleiben offen. Continuous bleibt deaktiviert und eingefroren.
#722 ist seit 21:28:34Z gemergt; dessen Reserven wurden geliefert (#725/#726/#727),
kein erneuter Dispatch aus den historischen Startformulierungen unten.

```
## lanes
```text
## Lanes (5 parallel) — historisch (v1.6.0, erledigt 09.10.)
[Originaltext][historie]

### DR-07c/d/e1/e2: vier weitere P1-Testports (historischer Startvertrag; erledigt: 07c #752, 07d #753, 07e1 #751, 07e2 #755)
[Originaltext][historie]


[Abgeschlossene P1-Testports](archive/plan-2026-10/context-2026-10-23.md#completed-p1-test-ports-on-8-october).

### Serverreserve: drei disjunkte Startverträge (Root 08.10., 20:45Z; historisch, erledigt #725/#726/#727)
[Originaltext][historie]

### Serverreserve 2: fünf zusätzliche Startverträge (Root 08.10., 21:27Z; historisch, erledigt #738/#739/#742/#745/#746)
[Originaltext][historie]

### Anpassungsnachweis DR-15a und Übergaben (08.10. 04:40 UTC, historisch)
[Originaltext][historie]

### Anpassungsnachweis PLAN-C1 (historisch)
[Originaltext][historie]

```
## l0
```text
## Ehemals aktive Ziele und L0-Schnitt (07.10., historisch)

[Ideenfließband V1.0](archive/plan-2026-10/history.md#ideenfließband-anforderungen-und-historischer-übergabestand-v10) steht vollständig und unverändert im Archiv als historischer Anforderungs-/Übergabestand. Aktuellen Status, Freigaben und Verträge führt ausschließlich dieser Masterkopf. Cloud-/Assistentenfassungen sind historische Übergaben, keine synchronisierte zweite Planquelle; PA r05iwt erhält den bestätigten Ref erst nach Integration.
Root-Auftrag und Site-Amende: Child `ec223b75-7972-4555-a442-43e0e32c8fcd`, Chief-Mail `msg-0muy8gvba-939fb23b`, 07.10.2026 14:59 UTC. PM besitzt nur diesen Dokumentenschnitt, Gesamtowner IDEAS-L0 ist Root; Chief disponiert, Root prüft FIT und nimmt ab.
[Historische L0-Vorhersage](archive/plan-2026-10/history.md#l0-vorhersage). Ein Dokumentabschluss beweist keine nutzbare Lieferung.

| Ziel / bestehender Auftrag | Wirkung, Umfang / Nichtziele | Owner / Vorgänger | Abnahme / Evidenz / Status | Nächster Schritt / Blocker / Stand UTC |
|---|---|---|---|---|
| IDEAS-L0 / PLAN-L0-P0 `ec223b75-7972-4555-a442-43e0e32c8fcd` | dauerhaft erfassen, bearbeiten, wiederfinden; kein Planeditor/Graph/Pilot/Autorecherche | Root Gesamtziel; PM cwqxbk Dokument; Backend mctdww; UI d567gh; Chief Integration/FIT an Root | Unbekannt (zu prüfen): P1/P2 über DR-02 bis DR-14 gemergt, L0-Nutzerabnahme nicht belegt; ursprünglich: P0 In Prüfung; Vorbereitung tatsächlich15:05:57Z, Source noch nicht gestartet; Produktlieferung offen; Quellbasis oben, V1.0-SHA329a53ca…124b2c; Zuweisung ist kein Runtime-Start | vollständiger Diff/Metadatenvertrag → Root; anschließend Backend/UI und echte Nutzerabnahme; 07.10.15:00:47 |
| DD-RECEIPT `285001a5-ede9-4940-b039-42d0dd892e96` | bestehende Frage-Quittungsanzeige, disjunkt zu L0 | alleiniger UI d567gh; bestehender V2-Receiptvertrag | Verschoben nach L0; Child pending, Root15:10:09Z; 495 ALL NOT FIT, unimplementiert | ganze Programme/23 Fälle/Pins erhalten; keine zweite Revision/Integration; Frageanzeigebug blockiert Ideensammlung nicht |
| V16-ARCH-D4 `b9606dd4-4dab-460c-9229-a47699702f6d` | restliche API-Entlastung; kein L0-Vorgänger/Releasebeleg | alleiniger API-Owner Root; Part4 Mergify #629 auf3db3407 | In Prüfung laut Root15:20Z: [PR631](https://github.com/Cuarroc/ProjectA/pull/631)/1d4b5bc, eigene Gates0, beide CI37631238380 erfolgreich, Sonnet ACCEPT; kein Merge | zweiter Vendor403, Reviewgate offen; keine frische PM-CI-/Sourceprüfung, Chief API seriell — Nachtrag 15.10.: #631 am 08.10. gemergt (`013513b2`), siehe Z3 V16-ARCH-D4 |

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
[Originaltext][historie]

### Minimaler additiver Ideenmetadatenvertrag (Root-Disposition 07.10.15:20 UTC)

Root15:20Z hat flache optionale Request-/Revisionsfelder genehmigt (ersetzt den früheren Envelope-Vorschlag): `category` = getrimmter Text ≤80 UTF-16-Codeunits, leer erlaubt; `userPriority` = `urgent|high|normal|later` (UI dringend/hoch/normal/später). Keine Pflichtoptionen zur Freitextidee, keine Metadaten im Originaltext und keine neue Schema-/Jobarchitektur.
Fehlende historische Metadaten nur lesend als `category=""` (UI „Nicht eingeordnet“) / `userPriority="normal"` projizieren; alte gespeicherte Objekte, Originaltexte, Request-Payloads und Antwortbytes nicht rückwirkend umschreiben. `questionPriority` ist niemals `ideaPriority`/`userPriority`.
Neue explizite Metadaten werden Teil der normalisierten Request-Identität und des neuen append-only Ideensnapshots; gleicher RequestId/geänderte Metadaten muss409 bleiben. Bei vollständig ausgelassenen Metadaten exakt den bisherigen kanonischen Replaypfad/Bytes erhalten; historische Replays bleiben historische Antworten.
Neue CAS-Revisionen übernehmen bei ausgelassenen Feldern die aktuelle Kategorie/Priorität erst nach der bestehenden Replayprüfung; historischer Replay wird nicht neu ausgerechnet. Nur explizite Eingabe ändert Werte, kein Default-Reset. Neues Schreiben verlangt explizite CAS-Revision, veralteter neuer Edit409; vorhandene atomare Schreib-/Recoverypfade verwenden.
Titel/Text/Quelle/Herkunft und alte Ideen-/Fragen-/Antwort-/Receipt-/Planreferenzen erhalten; `actor/source` sind Provenienz, niemals Freigabe. `incoming` heißt Eingang, nicht bereits geprüft; automatische Bewertungen bleiben sichtbar ungeprüft. Vormerken erzeugt keinen Agentenauftrag und keine Root-/Nutzerfreigabe.
Pflichtkompatibilität P1: alte Requests/byteidentischer Replay nach Neustart; neue Defaults, alle vier Prioritäten, Kategoriegrenze; Metadaten-only Edit, omit-preserve, changed-request409, stale-CAS409; Fehlwrite/Retry ohne Datenverlust; unveränderte Geschwister/Receipt-/Provenienzfälle. Tatsächliche Tests erst im zuständigen Paket, nicht hier behauptet.
P2 liest nur erkannte Felder, sucht Text/Titel, filtert Kategorie/Priorität/Station und sortiert stabil; zeigt Herkunft und „Noch nicht geprüft“ sowie vollständiges Stationsband mit unfertigen Stationen „Wird ergänzt“. Alte Inhalte ohne Felder bleiben bedienbar; Wechsel zur tatsächlich gewählten Idee gegen erhaltenen ungesicherten Entwurf prüfen, bevor Bearbeiten als geliefert gilt; kein Editor/Graph als Voraussetzung.
L0-Abnahme: Der Nutzer speichert drei Ideen, bearbeitet eine samt Kategorie/Priorität, sucht/sortiert, lädt neu; Inhalt bleibt gleich. Speicherfehler erhält den Entwurf; CAS-Konflikt/replay/restart verlieren nichts. Funktionierender Nutzerlink mit Zugriffsvoraussetzungen und tatsächlicher Prüfung, relevante unabhängige Reviews und kontrollierte Integration sind erforderlich; P0-Dokuabschluss erfüllt dies nicht.

<a id="ideas-l0-v1-0"></a>

```
## ideas
```text
## Ideenfließband-Anforderungen und historischer Übergabestand (V1.0)
[Originaltext][historie]

# ProjectA: Ideenfließband – Umsetzungsplan
[Originaltext][historie]

## 1. Verbindlicher Auftrag und erste Lieferung
[Originaltext][historie]

## 2. Ausgangslage und Evidenzgrenze
[Originaltext][historie]

## 3. Produktmodell: zwei miteinander verbundene Bereiche
[Originaltext][historie]

### Stationen und eindeutige Austrittskriterien
[Originaltext][historie]

## 4. Freigabe und Priorisierung
[Originaltext][historie]

## 5. UI und UX: schnell erfassen, gut überblicken, gezielt vertiefen
[Originaltext][historie]

## 6. Anlagen, Recherche und Planentwurf
[Originaltext][historie]

## 7. Daten und technische Leitplanken
[Originaltext][historie]

## 8. Umsetzungspakete und Parallelisierung
[Originaltext][historie]

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
## 9. Blocker, Bestätigungen und Cloud-Dokument
[Originaltext][historie]

## 10. Die stärksten Einwände und ihre Behebung
[Originaltext][historie]

## 11. Abnahme, Erfolg und sofortiger Arbeitsauftrag
[Originaltext][historie]

### Lieferprotokoll
[Originaltext][historie]

```
## parked
```text
## Gestrichen/Geparkt (25.09.)

Historisch (25.09.): „nach M1/M4“ ist kein Termin mehr; das Urteil je Zeile steht in [`plan/v2.0/mapping.md`](plan/v2.0/mapping.md) (06.10.).

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
| **W5 außerhalb des Kerns:** W5-01a/b/c, 02c, 02d, 02e, 03, 06, 06b, 07, 08a, 08b, 09a/b/c, 10, 11, 12–16, 17–21, 23–25, 30a/b, 31a–c, 32–34, 35a–f, 36a/b, 37–39 | Das Projekt-System hilft dem Ziel nicht. Kern in M3/M4: W5-02a, W5-22, W5-28, W5-00b, W5-02b3–b5/b7, Not-Aus W5-04a–c, Prüfpfad W5-05 | nach M4; zuerst W5-31 (App zu, Worker laufen weiter); Phase J (autonomer Merge) erst nach vier Wochen Continuous ohne Rückschlag. Konzept: `.pa/plan_projects_w5.md` (nicht im öffentlichen Repo) |
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
| ADR, die die st-Lane für unabhängige `store/`-Module teilt | Verschoben nach V16-ADR-A7 / V2-ARCH-0 (mapping.md); ursprünglich: nach M1 (Nutzer 25.09.: später) |
| Öffentlicher Neustart des Repos ohne Historie (Prüfung E) | siehe „Entschiedene Fragen“: Neustart mit `c60f267` („Initial public release of ProjectA“) dort als erledigt geführt; ursprünglich: nach M1; vorher Scan-Bericht, der Nutzer gibt frei (nicht umkehrbar) |
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
| Plan für v1.6.0 (Pakete, Wellen, Arbeitsweise, Benchmark-Nachweis): [`docs/plan/v1.6.0/plan.md`](plan/v1.6.0/plan.md) | Nutzerentscheidung 06.10.2026: zwei Wochenmessungen und 40 Queue-Läufe bleiben offene Nachbeobachtung nach v1.6.0; Befunde für v1.6.1, kritische früher. Details und unveränderte Originalkriterien in Abschnitt 7a.1; weitere Planfragen und Pakete bleiben in ihrem bisherigen Zustand, nichts davon wird in M1–M4 aufgenommen. Nachtrag 15.10.: v1.6.0 erschienen (09.10.); KI-30-Schluss #874 (42 Läufe ab 09.10.), Wochenmessungen offen (V16-NACHBEOB). |
| Fahrplan v1.6.1 bis v2.0.0 (Pakete, Wellen, Nähte, Nacharbeit je Release): [`docs/plan/roadmap/README.md`](plan/roadmap/README.md) | Ersetzt durch [`plan/v2.0/plan.md`](plan/v2.0/plan.md) (Nutzerentscheid 06.10.: v2.0 als ein Release, keine Zwischenreleases v1.7–v1.9; Kopfzeile von `docs/plan/roadmap/README.md`) und RELEASE-PAUSE (15.10.); Datei historisch, nicht disponieren |
| Werkbank je Projekt (V2-WEG/TRES/CMD/SKL/DB): Dev-Befehle, Datenbanken, Feintuning, Server, Trigger, Automationen, Tresor, Skills-Bibliothek, Bewährte Wege → [`docs/plan/v2.0/werkbank.md`](plan/v2.0/werkbank.md) | Entscheid Nutzer 11.10. E1–E4 (`docs/decisions.md`); Wege-Pilot jetzt ohne App-Code als Thema von DEV-KNOW-01, Tresor vor V2-B6a-2/V2-B19, Rest nach v2.0 hinter Schaltern; nichts davon steht in M1–M4 |
| Paperclip-Kandidaten (COMP-PAPERCLIP-3) → Block direkt darunter | Nutzer 11.10. ~04:30Z: einreihen erlaubt; Richtung, kein neuer Meilenstein; nichts davon steht in M1–M4 oder ändert die v2-Release-Reihenfolge |
| LUMIO: Rückfragen und Freigaben ohne Fensterwechsel (Halle zeigt, wer wartet; Antwortkarte mit Zahlentasten; Windows-Benachrichtigung) → Block LUMIO darunter | nach dem Urteil des Nutzers über die Probe-Halle (DS-H-07); Nutzer 18.10.2026 |
| AGENT-WERKZEUGE: RTK und Repomix messen, eigene Log-Kürzung; Caveman, Headroom-Proxy, OpenCLI, Gitingest, Printing Press abgelehnt → Block AGENT-WERKZEUGE darunter | Messungen nur nach Nutzer-Ja zur Installation; Nutzer 18.10.2026 |

#### LUMIO — Rückfragen und Freigaben ohne Fensterwechsel (Nutzer 18.10.2026)

Quelle: Nutzer im Root-Chat 18.10.2026 ~20:45 MESZ („ja schreibe die Erkenntnisse aus dem video in den plan, ausführlich und für unsere zwecke optimiert“). Root hat das Video im Browser des Nutzers angesehen: TikTok @lumio.mac, ~20 s, Mac-App „Lumio“ (kostenlos, lumiomac.com). Beobachtet, nicht übernommen: kein Code, keine Grafik, keine Texte von Lumio; unsere Kunst bleibt Code nach E-2 (DS-FABRIK-ZIEL).

Was das Video zeigt (beobachtet 18.10.):
- Ein Pixel-Büro mit Agentenfiguren an Schreibtischen; Kopfzeile „Working: 4 · Resting: 3“; ruhende Agenten sitzen in einer Lounge-Ecke.
- Braucht ein Agent eine Antwort, steht seine Figur auf und zeigt eine Sprechblase mit der Frage („SQLite or PostgreSQL?“); die MacBook-Notch leuchtet orange.
- Ein Klick öffnet eine Antwortkarte direkt an der Notch: Anbieter (Claude Code), Agentenname, Aufgabentitel, Kontext 22 %, 27 Aktionen, die Frage, nummerierte Optionen 1–3 mit Kurzbeschreibung plus „4 Other…“, „Number — pick“ (Zahlentaste wählt), ein Countdown, Knöpfe „In chat“ und „Answer“.
- Nach der Antwort setzt sich die Figur wieder an die Arbeit („Got it — he's back to work“).
- Werbeversprechen: Option wählen oder Befehl freigeben, ohne das Fenster zu wechseln; Claude Code und Codex.

Warum es für ProjectA zählt: Der Nutzer betreut viele Agenten gleichzeitig. Heute muss er für jede Rückfrage oder Freigabe das richtige Terminal finden. Die Probe-Halle (DS-H-00 bis DS-H-07) zeigt schon Figuren mit Posen; DS-H-06 hält die Geste für `need` zurück, bis ein beobachtetes Wechselsignal existiert. LUMIO liefert genau den Anwendungsfall dafür: „Wer braucht mich, was fragt er, antworte mit einem Tastendruck.“

Für ProjectA angepasst (Windows, Tauri, „Grün heißt bewiesen“):
- Keine Notch unter Windows. Ersatz: Zähler „Braucht dich: N“ im Kopf der App, ein Infobereich-Symbol mit Zahl und eine Windows-Benachrichtigung mit Knöpfen (Tauri-Plugin `notification`, steht bereits in „Später“). Ein kleines, immer sichtbares Fenster ist nur eine Option. Kein Fokusdiebstahl.
- Ehrlichkeit vor Effekt (AGENTS.md Regel 9): Eine Sprechblase oder Antwortkarte erscheint nur, wenn ein Agent nachweislich wartet (strukturiertes Ereignis des Anbieters oder erkannte Eingabeaufforderung im PTY). Ohne Signal bleibt der Zustand `unknown`; nichts wird erraten.
- Sicheres Aktionsmuster (Zeile oben, 04.10.): Optionen kommen nur aus der strukturierten Frage des Agenten. Die Antwort ist genau der gewählte Optionstext oder Freitext des Nutzers. Modellausgabe wird nie zu einem Befehl, den die App selbst ausführt.
- Freigaben von Befehlen zeigen den Befehl wörtlich und unverkürzt. Zustimmen braucht immer einen ausdrücklichen Klick oder eine Taste, nie eine Vorauswahl. Not-Aus bleibt in jeder Ansicht erreichbar.
- Kein Countdown mit Automatik: Lumio zeigt eine ablaufende Zeit. Wir zeigen nur, seit wann die Frage wartet, und wählen nie selbst eine Antwort.
- Kontextangaben (Anbieter, Modell, Kontext-%, Aktionen) nur, wenn sie beobachtet sind; sonst „unbekannt“.

| ID | Ziel | Abhängigkeit | Stufe | Status |
|---|---|---|---|---|
| LUMIO-0 | Recherche und Vertrag (Doku): Welche Anbieter liefern heute ein beobachtbares „wartet auf Antwort/Freigabe“-Signal samt Optionen (Claude Code, Codex, Kimi, OpenCode; Hooks, strukturierte Ausgabe, PTY-Muster)? Ergebnis: Ereignistyp `AgentQuestion {agent, frage, optionen[], art: wahl\|freitext\|freigabe, befehl?, seit}`, Quelle je Anbieter, Lücken als `unknown`; `docs/design/hall/QUESTIONS.md` | DS-H-07 (Urteil des Nutzers über die Probe-Halle) | C | Geplant: nicht disponiert (18.10.) |
| LUMIO-1 | Rückfrage in der Halle: Die Figur eines wartenden Agenten zeigt die Pose `need` und eine Sprechblase mit der gekürzten Frage; die volle Frage steht im Inspektor (DS-H-05); nach der Antwort zurück an die Arbeit. Bewegung im Budget von DS-H-06 (höchstens zwölf Figuren, Aus und reduzierte Bewegung statisch) | LUMIO-0, DS-H-06, DS-H-07 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-2 | Antwortkarte: Frage, nummerierte Optionen mit Kurzbeschreibung, „Andere …“ als Freitext; Zahlentasten 1–9 wählen, Enter sendet, Escape schließt, „Im Terminal öffnen“ als Ausweg; voll per Tastatur und Screenreader bedienbar; Texte über `src/i18n/de.ts` | LUMIO-0; Popover DS-X-26 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-3 | Befehlsfreigabe in der Antwortkarte: Befehl wörtlich, Arbeitsordner, Agent; „Erlauben“/„Ablehnen“ nur ausdrücklich, keine Vorauswahl; Weitergabe an den Agenten nur über seinen eigenen Freigabeweg | LUMIO-2 | A (Sicherheit, PTY) | Geplant: nicht disponiert (18.10.) |
| LUMIO-4 | Melden ohne Fensterwechsel unter Windows: Zähler „Braucht dich: N“ im Kopf, Infobereich-Symbol mit Zahl, Windows-Benachrichtigung mit Knopf „Antworten“, der die Antwortkarte öffnet; ein kleines, immer sichtbares Fenster nur nach Nutzerentscheid | LUMIO-2; Tauri-Plugin `notification` (Zeile oben) | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-5 | Zähler in Halle und Kopf: „Arbeiten · Ruhen · Braucht dich · Unbekannt“ aus beobachteten Zuständen, jede Zahl führt zur gefilterten Liste | LUMIO-0, DS-H-05 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-6 | Ruhezone in der Halle: Untätige Agenten sitzen in einer Ruhe-Ecke statt an ihrer Station, damit „arbeitet“ und „ruht“ auf einen Blick verschieden aussehen; neue Kacheln als Code (E-2) | DS-H-07; DS-H-02b | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-7 | Wartezeit statt Countdown: Antwortkarte und Liste zeigen „wartet seit …“ und sortieren danach; keine automatische Antwort, kein stiller Ablauf | LUMIO-2 | B | Geplant: nicht disponiert (18.10.) |

Nicht übernehmen: macOS-Notch, automatische Antwort nach Zeitablauf, vorausgewählte Freigaben, Lumio-Grafik oder -Code, Kontextzahlen ohne Beobachtung.
Erfolgsmaß nach Umsetzung: Zeit von der Frage bis zur Antwort und Zahl der Fensterwechsel je Rückfrage, gemessen an echten Läufen; Ziel ist eine Antwort in unter 10 Sekunden ohne Terminalsuche.
Reihenfolge: erst das Urteil des Nutzers über die Probe-Halle (DS-H-07), dann LUMIO-0, dann LUMIO-1/2/5 parallel, danach 3, 4, 6, 7. Kein Paket startet vor einem Nutzer-Ja zur Probe-Halle.

Nachtrag aus dem zweiten Lumio-Video (Nutzer 18.10.2026 ~20:55 MESZ: „wie vorhin auch dieses Video und übernimm sinnvolles in den plan“; TikTok @lumio.mac, ~38 s, von Root im Browser des Nutzers angesehen):
- Ausgangsproblem im Video: fünf Agenten in fünf Fenstern; einer „denkt noch“, ein anderer wartet seit 23 Minuten auf ein „Ja“ zu `npm install stripe`. Genau dieses Problem hat der Nutzer bei ProjectA: Wartezeit, die niemand sieht.
- Hinweis an der Notch: „Claude Code — Needs permission · Luma 4 · Waiting for "yes": npm install stripe“, also Anbieter, Art (Freigabe oder Frage), Agent und der Befehl in einer Zeile.
- Freigabekarte: Zweck in Worten („Installs dependencies“), darunter der Befehl wörtlich, Knöpfe „Deny“ und „Allow“, Enter bestätigt.
- Laufliste („All 7 chats“): je Agent eine Zeile mit Aufgabe, Agentenname, Anbieter, aktueller Tätigkeit in Worten („Waiting for "yes"“, „Edits OfficeScene.swift“, „Starts a helper · plan 3/5“, „Thinking…“, „Waiting for a task“), Füllstand des Kontexts als Balken (22 %, 34 %, 58 %, 84 % rot, 12 %) und Laufzeit; „Needs you“ als Marke, wartende Läufe oben.
- Eine Tastenkombination (zweimal Command) öffnet das Pixel-Büro als schwebende Übersicht über dem Desktop.

Für ProjectA angepasst: Kontext-Füllstand und Tätigkeit nur, wenn beobachtet (Regel 9); sonst „unbekannt“. Die Kontextwarnung passt zur eigenen Regel „Sitzungen deutlich unter ~150k Tokens, früh übergeben“ (AGENTS.md Regel 4). Die Freigabekarte bietet nur „einmal erlauben“ oder „ablehnen“. Dauerhafte Freigaben („nicht mehr fragen“) erweitern Rechte und bleiben im eigenen Dialog des Anbieters.

| ID | Ziel | Abhängigkeit | Stufe | Status |
|---|---|---|---|---|
| LUMIO-8 | Laufliste kompakt: eine Zeile je Agent mit Aufgabe, Agent, Anbieter, Tätigkeit in Worten, Kontextbalken, Laufzeit; „Braucht dich“ zuerst, dann nach Wartezeit; Klick öffnet Antwortkarte oder Terminal; dieselben Daten wie Halle und Zähler (eine Quelle) | LUMIO-0, LUMIO-5 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-9 | Kontext-Füllstand je Agent: Balken nur aus beobachteten Zahlen des Anbieters; ab 80 % Warnfarbe plus Text „bald übergeben“, nie nur Farbe; keine automatische Aktion | LUMIO-0 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-10 | Tätigkeit in Worten: aus beobachteten Werkzeugaufrufen und Ereignissen eine kurze deutsche Zeile („bearbeitet `Datei`“, „wartet auf Freigabe: `Befehl`“, „denkt“, „wartet auf Auftrag“); unbekannt bleibt „unbekannt“; Befehle und Pfade ungekürzt im Tooltip oder Inspektor | LUMIO-0 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-11 | Erinnerung statt Vergessen: wartet eine Freigabe oder Frage länger als eine einstellbare Zeit (Vorschlag 5 min), einmal eine Windows-Benachrichtigung; keine Wiederholungsflut, keine automatische Antwort | LUMIO-4, LUMIO-7 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-12 | Schnellblick per Tastenkürzel: ein globales Kürzel (Tauri-Plugin `global-shortcut`, Nutzerentscheid über die Taste) zeigt Halle und Laufliste als schwebende Übersicht und schließt mit Escape; kein Fokusdiebstahl ohne Tastendruck | LUMIO-8; Plugin-Installation braucht ein Nutzer-Ja | B | Geplant: nicht disponiert (18.10.) |

Erfolgsmaß ergänzt: längste unbemerkte Wartezeit je Tag (Ziel unter 5 Minuten) und Zahl der Übergaben, die vor dem Kontextlimit statt danach passieren.

#### AGENT-WERKZEUGE — Werkzeuge für weniger Tokens und besseren Kontext (Nutzer 18.10.2026)

Quelle: Nutzer im Root-Chat 18.10.2026 ~21:10 MESZ („prüfe auch das“): TikTok-Bildstrecke @martn.ai „9 GitHub repos for coding agents“, von Root im Browser des Nutzers gelesen. Sterne und Lizenzen stammen von den Bildern (Stand der Aufnahme), nicht live geprüft; vor jeder Nutzung erneut prüfen. Installationen, neue Abhängigkeiten und Änderungen an Agenten-Einstellungen bleiben Nutzerentscheide (AGENTS.md Regel 10).

| Werkzeug (Repo, Lizenz laut Bild) | Was es tut (laut Bild) | Urteil für ProjectA |
|---|---|---|
| Ponytail (DietrichGebert/ponytail, MIT) | Agent prüft vor dem Bauen, ob Code nötig ist; Benchmark laut Repo 54 % weniger Code, 22 % weniger Tokens | Bereits im Einsatz (Claude-Plugin des Nutzers); Update 5.3.2 offen beim Nutzer; nichts Neues |
| Caveman (JuliusBrussee/caveman, Lizenz unklar) | Kürzere Agentenantworten, komprimiert die Eingabe; laut Repo 33,2 % weniger Eingabetokens | Nicht für Root oder Nutzertexte (Berichte, PR-Texte und deutsche Sätze müssen vollständig bleiben). Höchstens beobachten, kein Paket |
| RTK (rtk-ai/rtk, Apache-2.0) | CLI-Proxy, kürzt Ausgaben gängiger Entwicklerbefehle vor dem Agenten (laut Repo bis 90 % weniger Bash-Ausgabe), ein Rust-Binary | Kandidat: unsere Gate-, cargo- und npm-Ausgaben sind groß. Nur mit Messung (AGENT-TOOLS-1); Exit-Codes und erste Fehlzeile dürfen nie verloren gehen (Regel 3/9) |
| Headroom (headroomlabs-ai/headroom, Apache-2.0) | Kompressionsschicht für Logs, Dateien, Werkzeugausgaben, Verlauf; Originale abrufbar; Bibliothek, Proxy, MCP | Nicht als Proxy vor Abo-Anbietern (gleiches Risiko wie beim OmniRoute-Proxy: Kontosperre, Kostenweg unklar). Idee „Original bleibt abrufbar“ übernehmen wir für eigene Log-Kürzung |
| CLI-Anything (HKUDS/CLI-Anything, Apache-2.0) | Erzeugt Kommandozeilen für bestehende Software, damit Agenten sie deterministisch bedienen | Bestätigt unseren Weg: Agenten nutzen `pa` und `pa hq` statt HTML-Scraping (AGENTS.md). Kein Paket |
| OpenCLI (jackwener/OpenCLI, Apache-2.0) | Macht Webseiten zu CLI-Befehlen über die eingeloggte Browsersitzung | Abgelehnt: nutzt fremde eingeloggte Sitzungen, Sicherheitsrisiko |
| Repomix (yamadashy/repomix, MIT) | Packt ein ganzes Repo in eine KI-freundliche Datei; Kompressionsmodus behält die Codestruktur | Kandidat für die kostenlosen Reviewer, die das Repo nicht selbst lesen können (AGENT-TOOLS-2); nur mit Geheimnis-Scan und auf öffentlichem Stand |
| Gitingest (coderamp-labs/gitingest, MIT) | Repo-URL wird zu Prompt-Text | Abgelehnt: doppelt zu Repomix und schickt das Repo an einen fremden Dienst |
| Printing Press Library (mvanhorn/printing-press-library) | Katalog mit 388 fertigen Agenten-CLIs | Abgelehnt: ungeprüfte fremde Binärdateien |

| ID | Ziel | Abhängigkeit | Stufe | Status |
|---|---|---|---|---|
| AGENT-TOOLS-1 | RTK messen (MESSEN, Server, nur Scratch, kein Repo-Eingriff): dieselbe Gate-Lane mit und ohne RTK; Messgrößen: Zeichen der Ausgabe, die der Agent sieht, unveränderter Exit-Code, erste Fehlzeile und `NICHT ABGEDECKT`-Block noch sichtbar, an einem roten und einem grünen Lauf. Danach Nutzerentscheid über die Installation auf dem Server | Nutzer-Ja zur Installation auf dem Server (Server-Änderung außerhalb der Jobqueue) | C | Geplant: nicht disponiert (18.10.) |
| AGENT-TOOLS-2 | Repomix für den kostenlosen Review-Weg prüfen (MESSEN): an zwei bereits gemergten PRs Review mit bisherigem Prompt gegen Prompt plus `repomix --compress`-Auszug der betroffenen Ordner; Messgrößen: belegte Befunde mit `file:line`, Fehlzitate, Prompt-Größe; Geheimnis-Scan auf dem Auszug Pflicht | Nutzer-Ja zur Nutzung (neue Abhängigkeit oder `npx`-Download) | C | Geplant: nicht disponiert (18.10.) |
| AGENT-TOOLS-3 | Eigene Log-Kürzung für Worker-Berichte nach dem Headroom-Prinzip: lange Gate-Ausgaben gekürzt zeigen, Original immer als Datei verlinkt, Exit-Code und erste Fehlzeile immer oben; ohne Proxy, ohne neue Abhängigkeit | AGENT-TOOLS-1 (Ergebnis) | B | Geplant: nicht disponiert (18.10.) |

#### v2 — VERBUND / DevHQ und Denkraum (Beschluss 15.10.2026)

V2-H1..H7 bleiben der DevHQ-Pfad; keine zweite Roadmap. Root nimmt ab, Chief
weist Folgepakete zu; bestehende Design-Owner und gemeinsame Dateien bleiben
seriell. DN-Status ist Planstand, kein Laufzeitbeleg. V-01 zieht DN-09 vor,
V-02 entspricht DN-11a, V-03 DN-15; keine doppelten Aufträge.

| ID | Ziel | Abhängigkeit / Status |
|---|---|---|
| V-01 | Quellen- und Befugnisvertrag | Erledigt: DOC-SYNC-2 / #1557 (merged 2026-10-15T15:12:57Z, `3853bbbe`); Stufe C |
| V-02 | Begrenzte lesende Denkraum-Projektion | Geplant nach V-01; Stufe A, kein Schreibpfad |
| V-03 | Nativer Leseadapter | Geplant nach V-02; Stufe A, `main.rs` seriell, Hostweg belegen |
| DN-01 | Kanonisches Designsystem-CSS bündeln | Erledigt: #1549 gemergt; `gh pr view 1549 --json state`, 15.10.2026 |
| DN-02 | Gemeinsame Spur-/Kugel-Bausteine | Geplant, als Nächstes nach DN-01 |
| DN-03 | Denkraum-Hülle und Jetzt im Designsystem | Geplant nach DN-02 |
| DN-04 | Fragenliste, Details und Bestätigung | Geplant nach DN-03 |
| DN-05 | Ideenerfassung, Liste und Details | Geplant nach DN-04; Entwürfe und Verlauf erhalten |
| DN-06 | Werkbank und Geplant gestalten | Geplant nach DN-05; fehlendes Speichern ehrlich anzeigen |
| DN-07 | Belege in Stationsanzeige übersetzen | Geplant nach DN-06 und V-01; unbekannt bleibt unbekannt |
| DN-08 | Zugängliche Spur-/Listenansicht | Geplant nach DN-07; Auswahl beim Aktualisieren erhalten |
| IDEEN-HANDY-1 | Ideen vom Handy erfassen | Geplant, scope TBD; vor jeder Denkraum-Ablösung |

#### PLAN-AUTO / ROADMAP (Auftrag 15.10.2026)

Nutzer 15.10. ~16:20 MESZ: eine Roadmap mit dem Designsystem, die den Plan
spiegelt (erledigt / jetzt / als Nächstes, Versionen, Pakete und Resttage,
Abhängigkeiten, Blocker, was wann und wo geändert werden muss). ~16:25 MESZ:
die Roadmap wird aus `docs/PLAN.md` erzeugt, und der Plan bleibt bei jeder
Änderung sicher automatisch aktuell und wird geprüft (Inbox: PLAN-AKTUELL).
Keine zweite Roadmap neben dem Plan; der Plan bleibt die einzige Quelle.

| ID | Ziel | Abhängigkeit | Status |
|---|---|---|---|
| PLAN-AUTO-1 | PLAN-Modell + `npm run plan:check` (Befunde: PR ohne Planzeile, Status widerspricht GitHub, unbekannte Abhängigkeit, Job ohne Zeile, Entscheidung ohne Zeile, Plan veraltet) | – | Erledigt: #1564 (merged 2026-10-15T16:44:07Z, `244c4775`); Planzeilen #1570 (merged 2026-10-15T16:07:25Z, `d1def61a`); Nachläufer → PLAN-AUTO-1b |
| PLAN-AUTO-1b | Nachläufer zu PLAN-AUTO-1 und ROADMAP-1a, geteilt in 1b-a (Alias-Auflösung der v2-Abhängigkeiten), 1b-b (bekannte Grenzen aus #1564) und 1b-c (Review-Befunde B1–B4 und C1 aus #1580) | PLAN-AUTO-1, ROADMAP-1a | Erledigt: 1b-a mit #1594 (merged 2026-10-16T00:59:37Z, `e21710de`) und 1b-c mit #1598 (merged 2026-10-16T02:11:54Z, `c8b613ea`); der Rest steht in PLAN-AUTO-1b-b |
| AGENTS-PLAN-REVIEW | Reviews prüfen, ob `docs/PLAN.md` aktuell ist: Paketzeile per `Plan-ID:`, übrige Zeilen, „Für den Nutzer“ und Entscheidungs-Inbox gegen `gh`; Abweichungen vor `review-ok` im selben PR korrigieren | PLAN-AUTO-1 | Erledigt: #1588 (merged 2026-10-15T19:54:21Z, `c7a43fbd`); Stufe C |
| PLAN-AUTO-1b-c | Roadmap-Nachläufer: R1580-B1–B4/C1 und REFS-07 | PLAN-AUTO-1 | Erledigt mit Merge von PR #1598; Alias-Teil #1594 (PLAN-AUTO-1b-a) bleibt separat |
| PLAN-AUTO-1b-b | Bekannte Grenzen aus #1564, vor jeder `--strict`- oder Gate-Nutzung zu beheben (PLAN-GATE wartet darauf) | PLAN-AUTO-1 | Geplant: nicht disponiert (16.10.) |
| PLAN-AUTO-2 | `npm run plan:sync`: widersprüchliche Statuszellen nach bestätigtem Merge abgleichen; Vorschau als Standard, `--write` atomar, alter Text bleibt; Root bringt Änderungen nach einer Merge-Welle über einen Stufe-C-PR auf main | PLAN-AUTO-1 | Erledigt: #1711 (merged 2026-10-20); ursprünglich: In Prüfung: Branch `codex/plan-auto-2`, Stufe B; nach Merge sind Skript, Offline-Regressionstests und Ablauf dokumentiert; kein automatischer Commit oder Push |
| PLAN-AUTO-3 | Status-Abgleich als Skript statt LLM: stündlich, Docs-PR, automatisch eingereiht | PLAN-AUTO-1 | geplant |
| PLAN-NORM-n | Pakettabellen auf feste Spalten (ID, Ziel, Richtung, Version, Abhängigkeit, Status, Owner), je ≤300 Zeilen | PLAN-AUTO-1 | geplant |
| PLAN-CLEAN-1 | Plan bereinigen, Schnitt 1: Status gegen GitHub, „Für den Nutzer“, Entscheidungs-Inbox, fehlende Zeilen und gemergte Arbeit ohne frühere Planzeile; übernimmt die gültigen Inhalte von #1586 und #1587 | PLAN-AUTO-1 | Erledigt: #1591 (merged 2026-10-15T23:52:32Z, `23d0c91e`); Gesamtbereinigung und Root-Abnahme separat |
| PLAN-CLEAN-2 | Plan bereinigen, Schnitt 2: v2.0- und v1.6.0-Unterplan und `STAND.md` abgleichen | PLAN-CLEAN-1 | Erledigt: #1592 (merged 2026-10-16T00:04:20Z, `a3b61066`); Gesamtbereinigung und Root-Abnahme separat |
| PLAN-CLEAN-3 | Plan bereinigen, Schnitt 3: historische Abschnitte von `docs/PLAN.md` kennzeichnen, tote Verweise und Dubletten bereinigen | PLAN-CLEAN-2 | Erledigt: #1596; historische Abschnitte gekennzeichnet, tote Verweise und Dubletten dieses Schnitts bereinigt; Gesamtbereinigung und Root-Abnahme separat |
| PLAN-CLEAN-4 | Plan bereinigen, Schnitt 4: Entscheidungen vom 16.10. buchen, Designziel und neue Paketzeilen eintragen, gemergte PRs ohne Planzeile zuordnen (Sammelzeilen und v2-Zuordnung), Herkunft von COMP, DR2, OPS-* und DS-KONTRAST-FU festhalten | PLAN-CLEAN-3 | Erledigt: #1616 (16.10.) |
| PLAN-GATE | `npm run plan:check` als Pflicht-Gate, damit der Plan nicht mehr veralten kann; vorher Parser-Korrekturen (~~v2-Kurz-IDs wie `MN-A` auflösen~~ erledigt: #1594; Beschreibungstabellen nicht als Dubletten zählen, Zweig-Treffer bei erledigten Zeilen begrenzen); Verdrahtung laut `scripts/ci/lane-plan.sh` bei PLAN-AUTO-2 abgleichen, `scripts/ci/` gehört laut CODEOWNERS dem Nutzer | PLAN-CLEAN-4, PLAN-AUTO-1b-b, PLAN-AUTO-2 | Erledigt: #1625 (merged 2026-10-16); plan check runs as gate `plan-check` (`node scripts/plan-check.mjs --offline`) in lanes precommit, prepush, branchpush, linux, linux_1; `docs/decisions.md` jetzt schwer (`lane-plan.sh`); Nutzer-Ja 16.10. (Root-Chat ~02:22 MESZ), Vorbedingung `plan:check` auf `main` 0 Befunde (Root 16.10.) |
| ROADMAP-0 | Konzept (Root + Rechte Hand) und UX/UI-Entwurf mit dem Designsystem | – | Erledigt: Konzept und UX-/UI-Entwurf am 15.10. angenommen (laut Root, kein PR); Umsetzung in ROADMAP-1a und ROADMAP-1b |
| ROADMAP-1 | Generator: Roadmap-Seite aus PLAN.md, bei jedem Merge neu | PLAN-AUTO-1, ROADMAP-0 | Verschoben nach ROADMAP-1a, ROADMAP-1b und ROADMAP-1c (15.10.): #1580 trägt die Plan-ID ROADMAP-1, liefert aber nur die Datenschicht, keine Seite; der Renderer kam mit #1597 (ROADMAP-1b), Aufrufer und Neuerzeugung bei jedem Merge sind ROADMAP-1c |
| ROADMAP-1a | Erster Generator-Schnitt: Roadmap-Daten aus `docs/PLAN.md` und GitHub ableiten | PLAN-AUTO-1, ROADMAP-0 | Erledigt: #1580 (merged 2026-10-15T18:37:52Z, `c9d4ca35`) |
| ROADMAP-1b | Angenommenen Roadmap-Entwurf in Pakete ≤ 300 Zeilen schneiden und die Seite aus dem Datenvertrag von ROADMAP-1a rendern | ROADMAP-1a, ROADMAP-0 | Erledigt: eigenständiger HTML-Renderer `scripts/lib/roadmap-page.mjs` mit #1597 (merged 2026-10-16T02:19:17Z, `648fba44`); Aufrufer, Neuerzeugung bei jedem Merge, Hosting und Root-Browserabnahme: ROADMAP-1c |
| ROADMAP-1c-1 | Aufrufer: `npm run roadmap:page` schreibt die Roadmap-Seite `.pa/roadmap.html` aus denselben origin/main-Daten wie `roadmap:data`; Root-Browserabnahme | ROADMAP-1b | Erledigt: #1652 (merged 2026-10-16), Branch `claude/roadmap-1c-1` |
| ROADMAP-1c-2 | Neuerzeugung bei jedem Merge, Anzeige im HQ, kein Hosting auf GitHub (Nutzer 18.10.) | ROADMAP-1c-1 | Erledigt: #1659 (merged 2026-10-16), Branch `claude/roadmap-1c-2`; `post-merge` erzeugt `.pa/roadmap.html` auf main neu, `npm run hq:live` zeigt sie unter `/roadmap.html`; Hosting-Entscheid gebucht: ROADMAP-HOST (18.10.) |
| ROADMAP-1d | Roadmap-Seite härten (Review-Nachträge R1659-K1, K2, K4): Änderungszeilen nur mit ISO-Datum, eine Diagnosezeile auf stderr bei unlesbarer Plan-Prüfung, Tests für die Überspringpfade des `post-merge`-Schritts | ROADMAP-1c-2 | Erledigt: #1674 (merged 2026-10-17), Branch `claude/roadmap-1d` (Plan-ID ROADMAP-1d), Stufe B |
| README-ARCH-1 | README-Architekturgrafik präzisieren (Status vs. Freigabe, Startsperre, Sandbox-Grenze, Steuerungsclient) | – | Erledigt: README und Architekturgrafik mit PR #1605 präzisiert (Stufe C; Owner Root) |
| NAME-NUTZER | Persönliche Namensnennung durch neutrale Nutzerformulierung ersetzen | – | Erledigt: #1582 (merged 2026-10-15T18:33:45Z, `0f2cd8de`) |
| KONZEPT-0 | Gliederung für ein neues `docs/KONZEPT.md` (nur lesend): wie ProjectA arbeitet, Regeln, GitHub-Verhalten, Rechte, Ziel, Funktionen, Konfiguration; später von Orchestrator/Wächter aktuell gehalten | – | läuft: nur lesender Gliederungsauftrag, kein PR (laut Root 15.10.); Abnahme Root |
| KONZEPT-n | `docs/KONZEPT.md` nach angenommener Gliederung in Paketen ≤ 300 Zeilen schreiben | KONZEPT-0 | Geplant: erst nach Annahme der Gliederung |

#### Paperclip-Kandidaten (Nutzer 11.10. ~04:30Z: einreihen erlaubt)

Quelle: `pa-orch/wissen/02-recherchen/2026-10-11_comp-paperclip-3-synthese.md`
(Abschnitte „Katalog und Wertung“, „Wellen“, „Nicht übernehmen“). Alle `PC-…`
sind Kandidaten. Wert, Größe (S ≤150, M ≤300 Diffzeilen) und Naht stehen
dort je Zeile. Root prüft jede Einreihung erneut am aktuellen main.

[Abgeschlossene Paperclip-Welle 1](archive/plan-2026-10/context-2026-10-23.md#completed-paperclip-wave-on-11-october); kein erneuter Start aus ihren datierten Jobständen.

**Welle 2: nur Kandidaten.** Reine Kerne dürfen vorbereitet werden. Die
Anschlüsse laufen seriell durch die betroffenen Nähte. SQLite, PTY, Rechte und
Nebenläufigkeit sind Stufe A. Ein Eingriff in eingefrorenen Continuous-Code
braucht vorher Roots Bestätigung des genehmigten v2-/M4-Pakets.

- Abschlussnachweise:
  - PC-TRUST-1: Abnahmekriterium als accepted/missing/rejected/unverifiable klassifizieren.
  - PC-TRUST-2: Done von geprüft/angenommen im gespeicherten Lauf trennen.
  - PC-TRUST-11: Abschlussbelege über Read-only-IPC bereitstellen.
  - PC-TRUST-12: Echte Abschlussbelege in Beweiskette/Chip anzeigen.
- Zustand und Wiederherstellung:
  - PC-ARCH-1: Kleines Zustandsmodell mit Frist, Besitzer und erreichbarem Ausgang.
  - PC-ARCH-2: Echte Queue gegen das Modell prüfen; Gegenbeispiele aufzeichnen.
  - PC-ARCH-3: Schema: eine Wiederherstellungsakte je Quelle/Fingerprint.
  - PC-ARCH-4: Verwaistes Schärfen nach Neustart sicher wieder auffindbar machen.
  - PC-ARCH-12: Wiederherstellungsakte mit geprüften Übergängen bedienen.
- Aufrufschutz, Grenzen, Stopps:
  - PC-BUDGET-2: Schärfen ebenfalls vor bekanntem Limit stoppen.
  - PC-BUDGET-3: Leeres Critic-Ergebnis und Versuch dauerhaft merken.
  - PC-BUDGET-7: Reservierungs-Ledger für gemeinsame Kontingente.
  - PC-BUDGET-8: Ledger für versuchte und quittierte Budget-Stopps.
  - PC-BUDGET-14: Startpfad an Quota-Reservierung anbinden.
  - PC-BUDGET-15: Offene Stoppzustellung wiederaufnehmen und quittieren.
  - PC-BUDGET-16: Fehler-Fingerprint und Versuchszähler dauerhaft anbinden.

**Welle 3: offene Entscheidungen.** Sie gehen erst an den Nutzer, wenn sie reif
sind. Die Prioritätstabelle nimmt keine davon vorweg.

- Soll das Critic-Signaltor tatsächlich sperren? Erst messen, ohne Sperrwirkung (PC-BUDGET-4).
- Welche Warnschwellen bekommen die Kontingent-Meter (PC-BUDGET-12)?
- Detailblatt oder nichtmodaler Inspector? Empfehlung: zuerst das vorhandene zugängliche Sheet.
- Onboarding: Empfehlung ist eine modellfreie Beispielkarte vor einem bewusst gestarteten Probeauftrag.
- Unklare Queue-Aufträge: Empfehlung ist sichtbares Parken statt Autostart mit ungeprüftem Rohtext.
- Mobile Nutzung, Marketing, Import und weitere Plattformen.
- Echte Verbrauchsmessungen.

**Nicht übernehmen** (Langfassung in der Quelle):

- CEO-/Manager-Agenten, die ungefragt Unteragenten oder neue Produktziele erzeugen.
- Modellbehauptung, Prosa, Exit 0 oder teilgrüne Zeilen gelten nicht als Abschlussbeweis.
- Keine Zeitgeber, die ohne vorhandene Arbeit Modelle wecken. Keine unbegrenzten Retries.
- Unbekannter Verbrauch gilt nie als 0. Ein beobachtetes Modell wird nie aus der Konfiguration abgeleitet.
- Keine Freigaben ohne geprüften Umfang und keine stille Rechteerweiterung. Agentengenerierte Skills wirken erst nach Freigabe.
- Firmen-, HR-, Gantt- oder Plugin-Welten nicht als Navigation kopieren. Keine zweiten Scheduler, Datenbanken oder Dienste nur zur Nachahmung.

### Architektur-Pakete aus dem Architektur-Rat (03.10.2026, historisch)

Die folgenden Pakete sind neue Ideen und bleiben nach AGENTS.md unter „Später“.
ARCH-11 ist die Ausnahme: Es ist ein angenommener M3-Kandidat (Nutzer 04.10., F6
und Zeile in der M3-Tabelle), ohne die M3-Abnahme-Tabelle zu ändern.

| ID | Ziel | Dateien | Lane | Naht | Tier | Test-Trailer | Stand / Reihenfolge |
|---|---|---|---|---|---|---|---|---|
| ARCH-01 | [Archiv: Historie][historie] | siehe Archiv | fe + hqL | nein | B | siehe Archiv | Erledigt #166/#167; Reihenfolge: jetzt; Löschung mit Nutzer-Ja (F5) |
| ARCH-02 | [Archiv: Historie][historie] | siehe Archiv | fR | nein | B | siehe Archiv | Erledigt #191; Reihenfolge: nach Merge von PR #130 |
| ARCH-03 | [Archiv: Historie][historie]; `db_restore.rs:137` bleibt Folgepaket der pa-Lane. | siehe Archiv | fR | nein | A (Vault) | siehe Archiv | Erledigt #214/#217/#256; Reihenfolge: jetzt |
| ARCH-04 | [Archiv: Historie][historie] | siehe Archiv | fR | nein | B | siehe Archiv | Erledigt #169; Reihenfolge: nach Inbox-Antwort F2 |
| ARCH-05 | [Archiv: Historie][historie] | siehe Archiv | mn | ja | A (Naht) | siehe Archiv | Erledigt #182; Reihenfolge: jetzt |
| ARCH-06 | [Archiv: Historie][historie] | siehe Archiv | mn | ja | A | siehe Archiv | Erledigt #219; Reihenfolge: nach ARCH-05, vor W5-04b |
| ARCH-07 | [Archiv: Historie][historie] | siehe Archiv | st | ja | A | siehe Archiv | Erledigt #202; Reihenfolge: nach #147/#44, gemäß st-Reihenfolge |
| ARCH-08 | [Archiv: Historie][historie] | siehe Archiv | fe | nein | B | siehe Archiv | Erledigt #181/#221/#229/#244/#247/#252; Reihenfolge: nach PR #154 |
| ARCH-09 | [Archiv: Historie][historie] | siehe Archiv | fe | nein | B | siehe Archiv | Erledigt #260/#264/#269; Reihenfolge: nach ARCH-08, niedrige Priorität |
| ARCH-10 | [Archiv: Historie][historie] | siehe Archiv | api | ja | A | siehe Archiv | Erledigt #220/#236/#246/#250; Reihenfolge: vor W5-02b3 (api) |
| ARCH-11 | **M3-Kandidat:** KI-24b auf Windows reproduzieren und den Test-DB-Wiederöffnungs-Wettlauf durch bewiesenes Pool-Schließen oder gezieltes Warten absichern. | `testutil.rs` + betroffene Tests | fR + N | nein | A (DB) | Regression-For: KI-24-Läufe 36165944208/36215024767; 20× close→reopen auf Windows | Verschoben nach Z4-ARCH-11; Reihenfolge: M3-Kandidat angenommen (Nutzer 04.10.); Windows-Lauf nötig, der PC des Nutzers darf dafür genutzt werden |
| ARCH-12 | `impl ControlBackend for ApiBackend` aus `main.rs` auslagern. Das Paket bleibt gesperrt, weil der Trait-Block als reine Verschiebung mehr als 300 Diffzeilen erzeugt. | `main.rs`, `api/backend.rs`, ~715 Z. | mn + api | ja | A | No-Test: mechanische Verschiebung erst nach ADR A1 | nach ADR A1; gesperrt |

### Synthese der Bestandsaufnahmen INV-01..08 und des Architektur-Rats (03.10.2026)

Quelle der Bestandsaufnahmen sind die PR-Texte (Abschnitt „Bestandsaufnahme“);
sie liegen nicht als Dateien im Repo. Der Architektur-Rat ist die Tabelle oben.
Alles hier ist **Quellenbefund oder Hypothese, kein reproduzierter Fehler**: ein
Bugpaket braucht zuerst einen kompilierenden roten Test, eine Laufzeit- oder
Performanceaussage eine Messung. Nichts davon ist in M1–M4 aufgenommen. Die
Nummern unten sind heutige PR-Nummern, beobachtet am 03.10.2026 mit
`gh pr view` auf `origin/main` 1b38596; der Paketstand darunter ist am 04.10.2026 nachgeführt.

[Historischer Paketstand und Reihenfolgen](archive/plan-2026-10/history.md#synthese-der-bestandsaufnahmen-inv-0108-und-des-architektur-rats-03102026).

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
| INV-SEC-VAULT-TEMP | [Archiv: Historie][historie] | ✓ #200 gemergt (03.10.); vorher roter Symlink-Test |
| INV-SEC-VAULT-ARCHIVE | [Archiv: Historie][historie] | ✓ #225 gemergt (03.10.); vorher roter Zwei-Reparaturen-Test |
| INV-SEC-CSP-SPLIT | [Archiv: Historie][historie] | ✓ #288 gemergt (04.10.): `devCsp` getrennt, Release-CSP ohne `ws://localhost` |
| INV-SEC-CREDENTIAL-EXPIRY / -CLEANUP | `api/agent_access.rs:312/361`: abgelaufene Grants bleiben als Datei liegen, Löschfehler werden verschluckt (niedrig). | nach #158 (gelandet) neu lesen |
| API-Descriptor | Private Erstellung/Ersetzung der Descriptor-Datei unter Unix prüfen. | nach #158 prüfen |
| INV-SEC-PRIVATE-PATHS | Einheitliche no-follow-Erstellung privater Dateien (Idee). | nach M4 |

**M4-B, Fortschreibung 23.10.:** Der frühere Projektrahmen-/TOCTOU-Befund ist durch AUTH/PLUMB/GOAL/TASK/ASSIGN und IMPORT/#1855 geschlossen (Root; Source-Lade-/Autorisierungsbefund). Tests c91a08d0, GOAL-/M4B-Reste 2dbc396c, separate Audit-Transaktion und Windows-Nachweis bleiben offen; siehe aktive GOAL-/IMPORT-Zeilen und Inbox. Continuous bleibt deaktiviert und eingefroren; keine Gesamtfreigabe.

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

```
## Aufgelöste Navigation der Quellblöcke

[Quelle 1](../../archive/plan-2026-10/history.md#release-reihenfolge-vor-v160) · [Quelle 2](../../archive/plan-2026-10/context-2026-10-23.md#completed-p1-test-ports-on-8-october) · [Quelle 3](../../archive/plan-2026-10/history.md#ideenfließband-anforderungen-und-historischer-übergabestand-v10) · [Quelle 4](../../archive/plan-2026-10/history.md#l0-vorhersage) · [Quelle 5](https://github.com/Cuarroc/ProjectA/pull/631) · [Quelle 6](../../plan/v2.0/mapping.md) · [Quelle 7](../../plan/v1.6.0/plan.md) · [Quelle 8](../../plan/roadmap/README.md) · [Quelle 9](../../plan/v2.0/plan.md) · [Quelle 10](../../plan/v2.0/werkbank.md) · [Quelle 11](../../archive/plan-2026-10/context-2026-10-23.md#completed-paperclip-wave-on-11-october) · [Quelle 12](../../archive/plan-2026-10/history.md#synthese-der-bestandsaufnahmen-inv-0108-und-des-architektur-rats-03102026) · [historie](history.md) · [pakete](completed.md)
