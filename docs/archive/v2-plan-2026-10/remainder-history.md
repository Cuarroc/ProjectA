# v2-Plan: datierte Resthistorie

Unveränderte Quellblöcke aus dem [v2-Unterplan](../../plan/v2.0/plan.md), archiviert am 21.10.2026 nach Roots DOC-3-Option B.
Basis `b07bc2a63c3e830e41208e3a0a106c19b69b2019`; die v2-Quelldatei ist gegenüber `213d29a3` bytegleich. Zeilen und SHA-256 unten beziehen sich auf diese Basis.
Datierte Zahlen, Laufzeitbehauptungen und Prüfgrenzen sind Historie. Die heutigen Ausführungs- und Reviewregeln stehen in [AGENTS.md](../../../AGENTS.md#the-ten-core-rules), Aufträge im [Masterplan](../../PLAN.md).
Nicht widerrufene Einzelpflichten bleiben verbindlich, auch in verlinkten Originalblöcken; Alter allein hebt sie nicht auf. Der Freeze in §9 war bereits ausdrücklich ersetzt.
Die relativen Originalverweise bleiben bytegleich: `size-evidence.md` führt zur [Belegdatei](../../plan/v2.0/size-evidence.md), `mapping.md` zur [Zuordnung](../../plan/v2.0/mapping.md) im ursprünglichen Verzeichnis.

| Quelle (fest) | Ziel im Archiv | Bytes | SHA-256 |
|---|---|---|---|
| [Zeilen 457–478](https://github.com/Cuarroc/ProjectA/blob/b07bc2a63c3e830e41208e3a0a106c19b69b2019/docs/plan/v2.0/plan.md#L457-L478) | [Originalblock](#314-paketzahl-runde-3) | 3140 | `346b37891df43d69e3785794058100677a218a65e57ad02f79e1d6b35cfb602d` |
| [Zeilen 559–569](https://github.com/Cuarroc/ProjectA/blob/b07bc2a63c3e830e41208e3a0a106c19b69b2019/docs/plan/v2.0/plan.md#L559-L569) | [Originalblock](#41-nahtstellen-und-die-übernommenen-v160-pakete-stand-gh-pr-list-und-git-log-originmain-vom-06102026) | 2370 | `990d341bf0606f7f6c418dd736d098704bd521001c3ac05353668ac88a030a3b` |
| [Zeilen 673–714](https://github.com/Cuarroc/ProjectA/blob/b07bc2a63c3e830e41208e3a0a106c19b69b2019/docs/plan/v2.0/plan.md#L673-L714) | [Originalblock](#8-nicht-abgedeckt) | 4993 | `80988bf25b5890797466a20ffd675ef689951ee3478e06aec33b0811aaf97de2` |
| [Zeilen 897–908](https://github.com/Cuarroc/ProjectA/blob/b07bc2a63c3e830e41208e3a0a106c19b69b2019/docs/plan/v2.0/plan.md#L897-L908) | [Originalblock](#104-zuordnung-gemergter-v2-prs-ohne-eigene-planzeile-stand-16102026-erledigt) | 3011 | `9319929c227ae94ccfad74c78c855868a7f5c6bc3a2dfcd7f69e40c1718c22a1` |

### 3.14 Paketzahl (Runde 3)

**Zählweise.** Ein Paket ist eine Zeile mit eigener ID in den Tabellen ab 3.1 und in 4a, eindeutig nach ID; „2×M“ und „3×M“ zählen als so viele Pakete (jeder Schnitt ist ein PR); Nutzer-Aufgaben (V2-REL, V2-N1) und die geparkten Zeilen aus 3.13 zählen nicht; die übernommenen Pakete aus `mapping.md` kommen dazu. Das Zählskript steht in [`size-evidence.md`](size-evidence.md). „Kern“ ist genau die ausgeschriebene Liste in 1a.

| Zahl | Runde 2 (Stand `25e7c95`) | Runde 3 |
|---|---|---|
| Zeilen mit eigener ID | 163 | 155 |
| Pakete mit Schnitten, Regel 300 | 204 | 193 |
| davon **Kern** (Liste in 1a) | nicht ausgewiesen | 125 (107 Zeilen) |
| davon nach dem Kern, hinter Schaltern | nicht ausgewiesen | 68 |
| übernommene Pakete (`mapping.md`) | 17 | 17 |
| **Summe mit Übernommenen** | 221 | 210 |
| **Kern mit Übernommenen** | – | **142** |
| Summe mit Übernommenen, wenn die Größenregel aus Abschnitt 6 gilt (Frontend B 600) | 196 | 191 |
| Kern mit Übernommenen unter der Regel 600 | – | 135 |

**Bilanz gegenüber Runde 2 (Pakete mit Schnitten).** Geparkt −11 (V2-DEMO-1, V2-I18N, V2-WEB-1, V2-LEGAL-1, V2-FB-1, V2-TEST-1, V2-MAN-1, V2-CLI-2) und −1 durch drei statt zehn Anbieter-Wege (V2-CLI-1 von 2 auf 1); zusammengelegt −14 (V2-B16, V2-O1 bis V2-O5, V2-EX-3, V2-DIET-1, V2-STOP-1, V2-SRV-1, V2-LEARN-1, V2-BAK-1, V2-CORE-8), davon +2 in den aufnehmenden Paketen (V2-CORE-AT, V2-B24); Bildschirme 63 → 54 (27 → 22 Zeilen, die Systemkarte wird V2-DOC-MAP); neu +21 (Maschine V2-RUN-1 bis 4: 5, lokales Modell V2-LOCAL-1 und V2-B2b: 3, V2-IA-1: 1, Schleuse V2-PRIV-1 bis 3: 3, Kundenprojekte V2-KP-1 bis 7: 9). Rechnung: 204 − 11 − 1 − 14 + 2 − 9 + 21 = 192. **Runde 3b (Fremdkritik):** +1 (V2-DOC-SRV, Server-Anleitung) = 193; V2-B23 und V2-B27 wechseln vom Kern hinter die Schalter (Kern −2, nach dem Kern +2, Summe unverändert), V2-SEC-1b hat keine eigene Zeile und zählt nicht. Aufschlüsselung je Bündel: [`size-evidence.md`](size-evidence.md), „Kern je Bündel“.

**Ziel „etwa 120 bis 160“.** Erreicht ist es für den **Kern mit Übernommenen (142, unter Regel 600: 135)**, also für das, was bis v2.0 fertig sein muss. Die **Gesamtzahl (210)** liegt darüber und sank gegenüber Runde 2 nur wenig: Die Richtungsentscheidung streicht oder verschmilzt netto 33 Pakete, bringt aber neue (+21). Von den 68 Paketen nach dem Kern sind 12 Kundenprojekte und Schleuse, 3 die Fernansicht, 31 Bildschirme hinter Schaltern; das sind die Hebel, wenn der Nutzer die Gesamtzahl weiter senken will (Frage 2). Die Zahl 230 bis 300 aus der Vorgabe ist mit diesem Zählverfahren nicht nachrechenbar: Runde 2 ergibt 221.

**Zeitrahmen.** Eine Aussage in Wochen ist **nicht berechenbar**, solange V2-CAP-1 keine Token-Messung hat (`benchmark.md` enthält keine Token-Zahlen). Gemessen ist nur der Durchsatz der letzten zehn Tage (301 gemergte PRs, Median 124 Zeilen, `size-evidence.md`); daraus folgt keine Terminzusage. V2-CAP-1 rechnet später Pakete gegen die Wochenlimits der drei Anbieter-Wege und gibt eine Spanne mit Stichprobengröße aus.

### 4.1 Nahtstellen und die übernommenen v1.6.0-Pakete (Stand `gh pr list` und `git log origin/main` vom 06.10.2026)

| Naht | Heute belegt durch | Übernommene v1.6.0-Pakete (`mapping.md`) | v2.0-Pakete in dieser Spur | Länge der Spur |
|---|---|---|---|---|
| `store.rs` | #577 ARCH-D3a ist gemergt; #587 ARCH-D3b ist ein offener Entwurf | D3b → D7 | ST-B1, K1, A1, A2, A3, B2, B3, C1, C2, H5 | 2 + 10 = 12 |
| `bin/pa.rs` | #579 ARCH-D6a ist gemergt | D6b | PA-1, PA-2 | 1 + 2 = 3 |
| `api.rs` | #578 ändert nur `api/agent_access.rs` (`gh pr view 578 --json files`), `api.rs` ist frei | ARCH-D1 → D4a → D4b | API-B (Kern), A, K, B (Rest), C (2×M), H4, SEC-2, EX-2 (Webhook) | 3 + 9 = 12 |
| `main.rs` | frei | V2-R-06 → D2 → D5a → D5b → D8a | MN-B (Kern), A, K, B (Rest), C (mit UPD-1), H6 | 5 + 6 = 11 |

Befund: Die längsten Spuren sind `store.rs` und `api.rs` mit je 12 seriellen Paketen, danach `main.rs` mit 11. Der Core fügt je Naht ein Paket hinzu (K). Das Fundament (Abschnitt 2) ist davon unabhängig. **Vorschlag (Frage 4):** je Naht abwechselnd ein übernommenes Paket, dann ein v2.0-Paket, ab dem nächsten freien Platz; ein bereits offenes Paket läuft zu Ende. So bleibt jede Spur in Bewegung, und die D-Pakete machen die Nahtdateien kleiner, bevor v2.0 sie größer macht. Das Gate V2-ARCH-1 hält neue Logik aus den Nähten heraus. **Risiko und Gegenmittel (Befund der Fremdkritik: die `store.rs`-Spur ist der wahrscheinlichste Engpass, weil der kritische Pfad durch sie läuft, `ST-B1 → ST-K1 → ST-A1 …`).** (1) Die Domänenlogik steht in `store/<name>.rs` und nicht in `store.rs`; ARCH-D3a/b/D7 verkleinern die Datei vorab. (2) Zwei Pakete derselben Spur, deren Tabellen voneinander unabhängig sind, dürfen **ein** PR sein, wenn der Diff zusammen unter der Grenze bleibt (erst die Messung im Paket entscheidet, nie vorab). (3) **Frage 4d:** Pakete, die nur verschiedene Dateien unter `store/` ändern, dürfen parallel laufen, per Skript geprüft; ohne Antwort bleibt es seriell (AGENTS.md, Regel 6). (4) Die Wartezeit je Spur (Tage von „startbar“ bis Start) steht im Wochenbrief; steht ein Paket zwei Wochen in Folge länger als eine Woche, kommt die Spur als Frage in die Inbox. Keine Tageszusage: Die Messung der Nahtpakete (Median 185 Diffzeilen, `size-evidence.md`) sagt nichts über die Wartezeit in der Spur.

## 8. NICHT ABGEDECKT

- Kein Build, kein Test, keine App wurde gestartet; die Zeilennummern gelten an der Basis 719426c.
- Die Boards wurden als Text gelesen, nicht gerendert; Zahlen und Namen in ihnen sind Beispieldaten.
- Die Größenschätzungen der Bildschirme (Abschnitt 3.4, 6) sind nicht gemessen.
- Anbieter, Modelle und Limits sind Vorschläge nach `docs/setup/providers.md`, nicht beobachtet.
- `pa-orch` ist nicht im Repo und wurde nicht gelesen.
- Review-Runden und rote Queue-Läufe je PR-Größe sind nicht gemessen (Abschnitt 6).
- Die Windows-Hälfte der späteren Pakete ist hier nicht Gegenstand; sie läuft in der Merge-Queue.
- Fremdkritik Runde 3 (06.10.): erledigt für den Stand `dcacc11` durch `glm-5.2:cloud` über Ollama (13 Befunde, Entscheidung je Befund im PR-Text #585). Der Stand nach Runde 3b ist **nicht** erneut fremdgeprüft; der Prompt liegt nicht im Repo.
- Runde 2: Der Core, die Ausführung und die 36 Ergänzungen sind Entwurf; Datei-, Tabellen- und Schlüsselnamen legt V2-ARCH-0 fest. Das Board `glass/Core.dc.html` liegt jetzt im Repo.
- AgentsRoom, `pa-orch`, `pipeline.py` und die lokalen Orchestrator-Zahlen sind nicht prüfbar; Aussagen darüber sind Nutzerangaben (siehe `evidence-r2.md`, Abschnitt 1).
- Die Schwellen der Quota-Regeln (70/90 %), die Reserve von 16, die Wochenziele und die Zulage je Naht sind Vorschläge; V2-CAP-1 und V2-ARCH-1 messen sie.
- Rechtliche, steuerliche und markenrechtliche Aussagen: keine geprüft; der Verkauf ist geparkt; die Nutzungsbedingungen der Anbieter prüft V2-CLI-0 mit Quellen, keine Beratung.
- Die Zuordnung (`mapping.md`) beruht auf `git log origin/main --grep` und `gh pr list` am 06.10.; ein „erledigt“ ist nur dort belegt, wo eine PR-Nummer steht.
- Runde 3: Die Paketzahl (3.14) ist aus den Tabellen dieses Plans gezählt, die Größen der Bildschirm-Pakete sind Schätzungen aus Boardzeilen. Die Zeilenanker der Boards wurden für die in diesem Plan genannten Stellen am 06.10. an der endgültigen Fassung neu geprüft; andere Anker aus Runde 1 und 2 vor dem Paketstart prüfen.
- Lokales Modell: Ollama wurde nicht gestartet, kein Modell beobachtet; Aussagen darüber stützen sich auf `providers.rs`, `agent-defaults.json` und die Boards.
- Datenschutz-Schleuse: nur Entwurf. Die Wirksamkeit des Filters ist ungeprüft (die PII-Muster existieren noch nicht, `redact.rs` hat keine); keine Rechtsberatung, kein Urteil über Einwilligung oder WCAG-Berichte als Rechtsmittel.
- Kundenprojekte: keine Prüfwerkzeug-Lizenz außer Playwright (Apache-2.0) geprüft; PDF-Erzeugung ohne neue Abhängigkeit ist eine Annahme, die V2-KP-3 prüft.
- Review dieses PR: ausstehend (Stufe C, Gates genügen).

## 9. Ein Plandokument: Zuordnung und Freeze

**Ersetzt (07.10.):** PLAN-L0-SINGLE — `docs/PLAN.md` bleibt der einzige Plan, dieser Plan ist Unterplan; Frage 10 ist ersetzt, V2-FREEZE-1a/1b entfallen in alter Form (`docs/PLAN.md`, „Entschiedene Fragen“). Der folgende Abschnitt ist historisch.

Nach der Freigabe ist dieser Plan das **einzige** Plandokument. Er übernimmt `docs/PLAN.md` (M1 bis M4, M5, „Später“, Geparkt) und den v1.6.0-Plan; die alten Pläne kommen ins Archiv. Dieser PR ändert **nicht** `docs/PLAN.md`.

[`mapping.md`](mapping.md) gibt jedem offenen Paket genau ein Urteil mit Grund:

| Quelle | übernehmen (mit v2.0-ID) | nach v2.0 parken | streichen |
|---|---|---|---|
| `docs/PLAN.md` (M2 bis M5, Später, Geparkt, Inbox) | 33 Zeilen | 23 | 14 |
| `docs/plan/v1.6.0/plan.md` | 15 Zeilen | 1 | 8 (alles Gemergte) |

Fünf Hinweise zur Lesart: (1) Eine Zeile kann mehrere Pakete bündeln (Gruppen wie DEVFLOW). (2) „Streichen“ heißt bei Gemergtem „erledigt“ mit PR-Nummer, bei Offenem „fällt weg, bei Bedarf neu einplanen“. (3) Die Stand-Spalten beider Pläne sind veraltet: `docs/PLAN.md` führt R-1 und W4-04 als offen, v1.5.1 ist veröffentlicht. (4) Übernommene Pakete tragen `V2-` vor der alten ID und behalten Lane, Stufe, Größe und Abnahme der Quellzeile, bis V2-FREEZE-1a sie in den Plan kopiert. (5) Dauerbetrieb bleibt aus: seine Pakete sind geparkt oder gestrichen (D7), nicht übernommen.

**Freeze in zwei Paketen, beide erst nach Frage 10 (freigegeben am 06.10.):**
- **V2-FREEZE-1a** (Leserliste): 25 Dateien nennen `docs/PLAN.md` (`rg -l "docs/PLAN.md" scripts src-tauri/src src .github package.json`, 06.10.). Darunter lesen `development_plan.rs` (DEVFLOW-Tabelle, 38 Zeilen), `hq-parse.mjs`, `ci.yml` und die PR-Vorlage den Plan maschinell. Jeder Leser bekommt ein Ziel; V2-H2 (ein Plan-Parser) ist Voraussetzung. Die übernommenen Zeilen werden nach `docs/plan/v2.0/` kopiert.
- **V2-FREEZE-1b** (Folge-PR): `docs/PLAN.md` wird zum Verweis, die alten Pläne und `docs/plan/roadmap/` gehen ins Archiv, `STAND.md` und `docs/ERLEDIGT.md` folgen, mit Sicherung vorher.

Ab dann gilt Regel „Plan-Freeze“ (Abschnitt 4b): nur Ausführung, höchstens eine Planänderung je Woche mit Kosten, Nutzen und Freigabe des Nutzers.

#### 10.4 Zuordnung gemergter v2-PRs ohne eigene Planzeile (Stand 16.10.2026, erledigt)

Gemergte PRs vom 06.–15.10. zu den Paketen dieses Plans, soweit ihre Nummer in keiner Tabellenzeile stand (Folgefixes tragen den Namen des Elternpakets, z. B. `V2-FU-S11` unter V2-S11). Zuordnung nach Titel und Branch; ein Eintrag hier heißt nur „PR gemergt“, nicht „Paket fertig“. Liste reproduzierbar mit `gh pr list --state merged --search "merged:2026-10-02..2026-10-15"`.

| Bereich | Pakete mit PRs | Gemergt |
|---|---|---|
| Fundament | V2-F1 (inkl. V2-TH-0, V2-TH-VAR-1/2, V2-FU-VAR): #615, #1031, #1032, #1048, #1062; V2-F2: #1020; V2-F3: #1017, #1365; V2-F4a: #1015, #1034, #1368, #1377, #1378, #1380; V2-F4b: #1022, #1035, #1373, #1375, #1379, #1381; V2-F5a: #1023, #1350, #1366, #1371; V2-F5b: #1033, #1056, #1082, #1362, #1367, #1369; V2-F6: #1012, #1099; V2-F7: #1013; V2-F8 (inkl. V2-F8a/b, V2-F8-PROJ/PAL/HASH/THEME, Kopfzeilen-Nachläufer): #1039, #1054, #1085, #1116, #1133, #1176, #1349, #1356, #1374, #1376; V2-F9: #1055, #1065; V2-FLAG-1: #1018; V2-IA-1: #1011; V2-CLI-0: #1028 | 06.10.–14.10. |
| Backend-Kerne | V2-B1: #1025; V2-B2a: #1073; V2-B2b: #1098; V2-B3: #1024, #1041; V2-B4: #1108, #1139; V2-B5: #1112, #1187; V2-B6a: #1122, #1198; V2-B8: #1120, #1148, #1296, #1308; V2-B9 (inkl. B9a/B9b und V2-FU-TIER-NAMES): #1080, #1094, #1121, #1157; V2-B10: #1081, #1101, #1125, #1164; V2-B11: #1045; V2-B12: #1090; V2-B13: #1044; V2-B14: #1092; V2-B15: #1109, #1117, #1189; V2-B17: #1111, #1129, #1194, #1213; V2-B21: #1113; V2-B22: #1083, #1135, #1192, #1320; V2-B28: #1042 | 10.10.–13.10. |
| Leitstand | V2-S01a (inkl. V2-FU-LS, V2-FIX-TIME-DE-2): #1049, #1050, #1067, #1069, #1144, #1188, #1200, #1212, #1359, #1372, #1387; V2-S01b: #1100, #1136, #1154; V2-S01c: #1153, #1357; V2-S01d (Terminal, Beschreibung `terminal.md`): #1140, #1150, #1262, #1293, #1313 | 10.10.–14.10. |
| Bildschirme | V2-S02: #1168, #1339, #1360; V2-S03a: #1182, #1203, #1344; V2-S04a: #1181, #1201, #1353; V2-S05a: #1074, #1091, #1130, #1196, #1348; V2-S05b: #1128, #1163, #1343, #1346; V2-S07a: #1177, #1352; V2-S07b: #1095, #1107, #1158, #1354, #1355; V2-S09: #1160, #1364; V2-S10a: #1068, #1089, #1123, #1319, #1363; V2-S10b: #1134, #1167, #1342, #1347; V2-S10d (inkl. V2-FU-DEVNOTES): #1162, #1218; V2-S11: #1070, #1076, #1078, #1131, #1179, #1351 | 10.10.–14.10. |
| Kern und Plan | V2-H1: #611; V2-H2: #1295, #1315, #1328; V2-HYG-1: #1294, #1305; V2-O0: #1301; V2-ARCH-0: #1299; V2-SEC-0: #1300; V2-CORE-1: #1312; V2-CORE-2: #1325; V2-E2E-0: #1267; V2-ST-B1: #1318, #1326; V2-OBS-1: #1220; V2-OBS-2: #1197, #1219; V2-RUN-1: #1398 | 06.10.–15.10. |
| Planung und Rückbau | V2-PLAN (Masterplan v2.0): #585; V2-RETIRE-0 (Inventar `retire.md`): #1132; V2-RT (Klassik-Rückbau RT-1a (#1277), RT-4b (#1159); siehe 10.2): #1159, #1277; V2-WEG-0 (Beschreibung `werkbank.md`): #1141; V2-SCOPE-Plan (Release-Schnitt und enger Schnitt (PLAN-V2-SCOPE, V2-NARROW-PLAN)): #1259, #1475 | 06.10.–15.10. |
