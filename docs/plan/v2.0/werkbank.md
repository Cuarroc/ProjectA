# Werkbank je Projekt (V2-WEG, V2-TRES, V2-CMD, V2-SKL, V2-DB)

Stand 11.10.2026, Basis `origin/main` 4ef2a21. Dies ist **der eine Sammeleintrag** für neun Wünsche des Nutzers; `docs/PLAN.md` („Später“) verweist nur hierher. Es ist ein Konzept, kein Auftrag: Pakete starten erst mit einem Paketauftrag des Koordinators. `plan.md` bleibt unverändert; was hier „neu“ heißt, steht noch nicht in `plan.md`.

**Entscheid.** Der Nutzer hat am 11.10.2026 (~01:50 CEST) die Empfehlungen zu E1–E4 angenommen (Wortlaut in Abschnitt 5, Eintrag in `docs/decisions.md`). Quellen: ein Vorschlag und eine Gegenprüfung mit 21 Befunden (beide vom 11.10., nicht im Repo); jeder Befund mit Stufe hoch oder mittel ist unten eingearbeitet (Abschnitt 7).

**Release-Schnitt.** v2.0 / v2.1 / v2.2 ist die Entscheidung des Nutzers vom 10.10. (~08:56Z, „klingt gut“). Der Einwand D1 der Gegenprüfung, der Schnitt sei erfunden, ist falsch; richtig ist ihre Folgerung: **Der Tresor kommt vor B6a-2 und vor B19**, denn beide brauchen `tresor://`-Verweise. Die Reihenfolge ist bindend, in welchem Release B6a-2 und B19 auch landen (offener Punkt 1).

## 1. Die neun Bereiche

Kein neuer Eintrag in der Seitenleiste (`ia.md` Abschnitt 5: keine Parallel-Navigation). Jeder Bereich liegt in einem vorhandenen Bildschirm. Fachlogik kommt in neue Module; die vier Nähte bekommen nur Hooks (V2-ARCH-1).

Bestehende IDs sind gegen `plan.md` geprüft (`rg`). „Teilpaket“ heißt: Die Zeile in `plan.md` trägt den Hauptnamen, die Teile a/b sind ein Zuschnitt (B5a in main #1112, B15a in main #1109, B12a in main #1090, B15b Draft, B6a-1 Draft #1122).

| # | Bereich | Was es ist | Schon geplant | Neu | Ort in der App | Release | Besser als AgentsRoom |
|---|---|---|---|---|---|---|---|
| 1 | Dev-Befehle | Gespeicherte Projekt-Befehle (`npm run dev`, Tests) mit Start, Stopp, Ausgabe, Exit-Code | nichts (der Tab „Befehle“ in V2-S06b meint App-Wissen und Palette) | V2-CMD-1a, 1b, 2, 3 (neu) | `/automatik/befehle`, Abschnitt „Projekt-Befehle“ | v2.2, hinter Schalter | Jeder Lauf endet mit Exit-Code und Dauer, und der Not-Aus beendet ihn. |
| 2 | Datenbanken | Nur lesender Blick in die Entwicklungs-Datenbank des eigenen Projekts | V2-PRIV-3 (Kunden-Datenbanken gesperrt) | V2-DB-1 (neu) | `/einstellungen/mcp` | später | Schreiben scheitert im Test, Kundenprojekte sind gesperrt. |
| 3 | Feintuning | Agenten einstellen (Modell, Denkstufe, Skills, Rechte), mit Messung; dazu Modelfile-Voreinstellungen für Ollama | V2-B17, V2-B18, V2-CTX, V2-S02, V2-B20, V2-S07b, V2-CORE-7 | kein Paket; Prüfauftrag, siehe unten | `/team/personas`, Start-Sheet, `/steuerung/verbesserungen` | v2.0 Kern | Jede Einstellung hat eine Wirkstelle im Code und eine Messung statt Bauchgefühl. |
| 4 | Server | Agenten laufen per SSH auf dem eigenen Server | V2-LOC-0, V2-DOC-SRV, V2-B5 (Teilpaket B5a), V2-B6a, V2-B6b | kein Paket | Start-Sheet (Ort), `/einstellungen/projekt` | v2.0 Kern (Kriterium 7) | Host-Schlüssel wird geprüft, kein Passwort gespeichert, der Not-Aus erreicht den Server-Lauf. |
| 5 | Trigger | Uhrzeit- und Webhook-Auslöser für Hinweise und Testläufe | V2-B15 (Teilpakete B15a, B15b), V2-ST-C1, V2-S06a, V2-KP-6, V2-EX-2 | kein Paket | `/automatik`, Tab Trigger | Backend Kern; Bildschirm v2.x; „Agent starten“ erst nach M4 | Gefälschte Signatur wird abgelehnt, Rate begrenzt (6 je Stunde), Testlauf ohne Verbrauch. |
| 6 | Automationen | Mehrschritt-Abläufe mit Gates, Start nur per Klick | V2-RUN-1 bis V2-RUN-4, V2-ST-C1, V2-S06b, V2-KP-2, V2-DOG-1 | kein Paket | `/automatik/ablaeufe` | Engine Kern; Bildschirm v2.x | Eine Maschine für Paket- und Testauftrag, jeder Schritt mit Beleg. |
| 7 | Secrets + Tresor | Ein verschlüsselter Speicher für alle Geheimnisse, überall nur als `tresor://`-Verweis | nur die Verweise: V2-B19, V2-B6a, V2-ST-A2, V2-KP-4, V2-S10b | V2-TRES-1, 2, 3 (neu) | `/einstellungen/mcp` (MCP & Tresor) | v2.1, **vor B6a-2 und B19** | Der Agent bekommt nie einen Wert zu sehen; Rest-Risiken stehen ehrlich im Text (Abschnitt 3). |
| 8 | Skills-Bibliothek | Skills durchsuchen, je Projekt oder Persona einschalten, eigene Repo-Skills mit Herkunft | Pakete je Projekt (vorhanden in der App), V2-B26 | V2-SKL-1 (neu); Skills je Persona als Folgepaket von V2-B17 | `/gedaechtnis` (Filter „Skills“), Auswahl in `/team/personas` | v2.2, hinter Schalter | Herkunft, Lizenz und Größenbudget je Skill; kein Skript wird installiert oder ausgeführt. |
| 9 | Bewährte Wege | Ein belegter Weg zu einem Ziel als Vorlage für Agenten | Bausteine V2-RUN-1, V2-B9, V2-RUN-3, V2-UAT-1, V2-B12, V2-B25, V2-H5, V2-ST-B3; DF-33/34 (geparkt) | V2-WEG-0 (dieses Dokument), V2-WEG-a bis -d (neu) | `/gedaechtnis` (Filter „Wege“); „Aus Weg starten“ in `/automatik/ablaeufe` | Pilot jetzt ohne App-Code; App v2.2, nur bei bestandenem Pilot | Ein Weg gilt erst mit Beleg am Commit, fremdem Review und deiner Abnahme, und er verfällt, wenn der Beleg sich verschiebt. |

**Feintuning, Prüfauftrag (kein Paket).** Der Paketauftrag von V2-B17 prüft, ob Denkstufe und Skills je Persona gespeichert werden; heute hat `profiles.rs` kein Feld dafür. Fehlt es, kommt es als Folgepaket von V2-B17. Die Ollama-Modelfile-Voreinstellungen (Systemtext, Parameter) sind Kandidaten für V2-B20 auf dem lokalen Weg (V2-LOCAL-1); nur Bestandteile mit belegter Wirkung (Regel von V2-B20).

**Datenbanken, offene Bedeutung.** „Datenbanken“ kann auch Shop-, Postgres- oder Supabase-Datenbanken des Nutzers meinen. Das ist nicht gefragt und wird hier nur festgehalten, keine Karte (der Plan erlaubt höchstens 3 offene Entscheidungen). Das Board `MCP.dc.html` bietet Postgres „für Kundenprojekte“ an; der Plan verbietet das (V2-PRIV-3) und gewinnt.

## 2. Neue Pakete

Größe M = höchstens 300 Diff-Zeilen. IDs kollidieren nicht mit `plan.md` (`rg "V2-(WEG|TRES|CMD|SKL|DB)"` dort leer). Eingefaltet, ohne eigenes Paket: Speicherung der Wege in V2-ST-C1; `pa wege` und `pa befehle` in V2-PA-2 (Agenten dürfen Befehle nur auflisten oder vorschlagen, nie anlegen oder starten ohne Freigabe des Nutzers).

| ID | Ziel | Naht | Stufe | Größe | Vorgänger |
|---|---|---|---|---|---|
| V2-WEG-0 | dieses Dokument, Eintrag in `docs/PLAN.md` und `docs/decisions.md` | nein | C | S | E1 |
| V2-TRES-1 | Tresor-Kern: benannte Geheimnisse, **einziger** Besitzer des Bereichsmodells (global, Projekt, Kunde) und eines einzigen `TresorRef`-Parsers (zieht ihn aus V2-B6a-1, Draft #1122); Lesezugriffe ohne Wert protokolliert; **führt die Verweigerung ein**: ohne OS-Schutz kein Speichern (heute bleibt der Speicher unter Unix Klartext); „Verweis ohne Wert“ nach Wiederherstellung (V2-B24) | Speicher entscheiden: Datei neben `KeyVault` oder Tabelle (dann Teil von V2-ST-A2 oder Paket in der store-Spur) | A | M | G0 |
| V2-TRES-2 | Auflöser, zwei Wege, **nie in die Umgebung des Agenten**: (a) Umgebung nur für Prozesse, die die App selbst startet und die nicht der Agent sind (App-eigenes SSH, vermittelnder MCP-Server); (b) für SSH-Schlüssel eine Temporärdatei 0600 oder ssh-agent, Löschen garantiert. Die aufgelösten Werte gehen an den PTY-Redactor | nein | A | M | TRES-1 |
| V2-TRES-3 | Hooks in `api.rs`/`main.rs`, `pa tresor list` (nur Namen) | **ja** (api, main, pa) | A | S | TRES-2; seriell zu CMD-2 |
| V2-SKL-1 | Skills aus `.agents/skills/` des Projekts lesen: Herkunft, Lizenz, Größenbudget, Laden bei Bedarf; **kein Abruf aus dem Netz, keine Skripte installiert oder ausgeführt** | nein | A | M | – |
| V2-WEG-a | Stufen-Automat, Schwellen, Erneute Prüfung, Rangfolge (Modul `learnings/recipe.rs`) | nein | A | M | B12a, RUN-1, Pilot bestanden |
| V2-WEG-b | Entwurfsbauer mit Secret-Scan und Maskierung, feste Vorlage (Abschnitt 4) | nein | A | M | RUN-1, B25, WEG-a |
| V2-WEG-c | Auslieferung an den Agenten über `skills::install` in V2-RUN-2, ohne Spuren im Repo | nein | A | S | RUN-2, WEG-a |
| V2-WEG-d | Export für alle Projekte über die Schleuse V2-PRIV-2; für Kundenprojekte gesperrt (fester Sperr-Test) | nein | A | M | PRIV-2 |
| V2-CMD-1a | Einmal-Befehle über das vorhandene `setupgate::run_if_trusted`, mit Exit-Code, Dauer, Env-Vorgaben (`CARGO_BUILD_JOBS=1`) | nein | A | M | TRES-2 |
| V2-CMD-1b | Langläufer (`npm run dev`): Ausgabe streamen, Prozessbaum beenden (Windows Job Object), Anmeldung beim Not-Aus; Naht vor Start benennen | prüfen | A | M | CMD-1a |
| V2-CMD-2 | Speicher, API, `pa befehle` (nur listen/vorschlagen) | **ja** (st, api, pa) | A | M | CMD-1b, V2-ST-C1 |
| V2-CMD-3 | Abschnitt „Projekt-Befehle“ | nein | B | M | V2-S06b, CMD-2 |
| V2-DB-1 | Lesender SQLite-Eintrag im MCP-Register; Tests: Schreiben scheitert; **Projekt mit Kundenmarkierung wird abgelehnt** (V2-PRIV-3) | nein | A | S | V2-B19, TRES-2 |

V2-KP-4 (Tresor-Zugang je Kundenprojekt) schrumpft auf kundenspezifische Prüfungen und nennt V2-TRES-1 als Vorgänger; das Bereichsmodell gehört TRES-1, nicht zweimal.

## 3. Tresor: was er schützt und was nicht

- Die Verschlüsselung (DPAPI) gilt für das Benutzerkonto. Sie schützt vor anderen Benutzern und einer gestohlenen Platte. Sie schützt **nicht** vor Agenten, die als derselbe Benutzer laufen: Sie könnten die Tresor-Datei selbst entschlüsseln.
- Darum sind Agenten durch die Auflösung geschützt, nicht durch die Verschlüsselung: Werte gehen nie in die Umgebung des Agenten und nie in seinen Prompt (TRES-2). Rot-Test: Umgebung und Scrollback eines gestarteten Agenten enthalten keinen aufgelösten Wert.
- Restrisiko, ehrlich genannt: Ein Agent mit Shell-Zugriff kann die Datei lesen. Gegenmaßnahmen sind die strikte Umgebungsregel, der Redactor und der Not-Aus, nicht Geheimhaltung.
- Sicherung und Umzug ohne Schlüssel (V2-B24): Nach einer Wiederherstellung zeigt der Tresor „Verweis ohne Wert“, mit Test.

## 4. Bewährte Wege

**Modell (eins, keine zweite Wahrheit).** Ein Weg ist eine Ablauf-Vorlage (V2-RUN-1, mit V2-S06b) plus Beleg-Felder, kein neuer Speicher; er erweitert die geparkten DF-33/34, keine parallele Planung. Felder sind **strukturiert mit Längengrenze** und werden durch eine feste Vorlage ausgegeben: Ziel, Erfolgskriterium als Prüfbefehl mit Exit-Code, Stack-Tags, Voraussetzungen, Schritte, Fallstricke als **Verweise auf Lesson-IDs**, Herkunft (PR, SHA), Version, Prüfdatum. Befehle nur als Verweise auf bekannte Namen (Lanes von `gates.sh`, Skripte aus `package.json`), geprüft. Freitext steckt im Fremdtext-Umschlag von `learnings.rs`. Im Weg-Ordner liegt nur `SKILL.md`, keine Datei sonst. Zähler werden **berechnet, nicht gespeichert**; jeder Auftrag trägt `weg_id` und `weg_version`; „Verpasst“ kommt aus dem Nutzungsprotokoll von V2-B26. Jede Änderung am Inhalt ist eine neue Version, die Zähler beginnen neu.

**Stufen** (Namen so gewählt, dass sie nicht mit „proven“ im Lessons-Werkzeug kollidieren): `Entwurf` → `Belegt` (einmal ausgeliefert, fremdes Review ok, vom Nutzer abgenommen, V2-UAT-1) → `Erprobt` (mindestens 5 Läufe aus mindestens 2 Autoren-Modellfamilien). Dazu `Umstritten` (sichtbar, nicht eingefügt), `Veraltet`, `Ausgemustert`. Ein Entwurf wird nie in einen Auftrag eingefügt.

**Sicherungen.**

1. **Eingeschleuste Anweisungen** (D7): Quellen eines Entwurfs sind Terminal-Ausgabe, PR-Berichte und Lessons, bei Kundenprojekten auch Webseiten. Secret-Scan, `redact.rs` und `forbidden_marker` fangen Geheimnisse, keine Anweisungen. Darum: feste Vorlage, Längengrenze, Befehle nur als geprüfte Verweise, nur `SKILL.md`, und **vor der Stufe „Belegt“ ein Review durch eine andere Modellfamilie** zusätzlich zur Abnahme des Nutzers (er kann Code nicht prüfen; seine Abnahme ist keine Kontrolle gegen Einschleusung).
2. **Codex legt Skills ins Repo** (D8): Für Codex schreibt `skills::install` nach `.agents/skills`, einen mit dem Repo geteilten Ordner. WEG-c trägt den Weg-Ordner in `info/exclude` des Arbeitsbaums ein oder liefert ihn als Auszug im Auftrag. Test: `git status --porcelain` nach der Installation sauber.
3. **Alle Projekte**: Standard ist „nur eigenes Projekt“. Export nur ausdrücklich (WEG-d), nur Gerüst, Entscheidungen und Zähler, keine Datei:Zeile-Belege, durch V2-PRIV-2, für Kundenprojekte gesperrt. In einem neuen Projekt beginnt ein Weg als `Entwurf`.
4. **Qualität:** Erneute Prüfung aus V2-B12a: Fehlt ein Beleg oder hat er sich verschoben, wird der Weg `Veraltet`. Drei Fehlschläge hintereinander erzeugen nur einen **Antrag** auf Ausmustern (Rolle nach dem Vorbild `roles.rs`, nur als Analogie).
5. **Abgrenzung:** Lessons = Fehlerwissen; Playbook = einzeilige Regeln, immer eingefügt; Notizen = Fakten mit Beleg; Skills = Fremdwissen ohne Beleg; Weg = Ablauf mit Beleg, nur bei Treffer, höchstens einer je Auftrag. Gilt ein Schritt für alle Aufträge, wird er ein Learning.

**Pilot jetzt, ohne App-Code, als Thema von DEV-KNOW-01** (E1). Kein neues Skript: Ein Weg ist ein Eintrag mit `kind: recipe` im vorhandenen `hq-lessons`-Werkzeug (`npm run hq:lesson`); heute kennt es kein `kind`-Feld, das Feld wird im Pilot ergänzt oder der Pilot wählt die Form im Rahmen von DEV-KNOW-01; V2-H5 führt später beides zusammen. Der Pilot ist **kein zweiter Wissenspilot**: Er läuft innerhalb DEV-KNOW-01 oder nach dessen Urteil.

- **Messgröße vor dem Start festlegen:** Prüfrunden und Nachbesserungs-Commits aus git/GitHub, verglichen mit passenden früheren Paketen. Die Selbstauskunft „worked“ des Agenten zählt nicht als Beleg.
- **Saat-Wege, offen als „Entwurf“ gekennzeichnet:** `glass-ui-politur` (Herkunft #979, #1082; keine Abnahme belegt). Ein Red-first-Weg verweist auf AGENTS.md Regel 2 und die Skill-Checkliste und enthält nur Schritte, die keine Regel sind, keine dritte Kopie. Ein Patch-Release-Weg endet bei „Nutzer gibt frei“ (Regel 10) oder bleibt aus dem Pilot.
- **Abbruch:** Zeigt der Vergleich keinen Vorteil, wird kein App-Paket gebaut.

## 5. Reihenfolge und Entscheide E1–E4

**Reihenfolge (E1).** (1) Wege-Pilot, ohne App-Code. (2) Tresor TRES-1 → TRES-2 → TRES-3 (v2.1), **vor B6a-2 und B19**. (3) v2.2, hinter Schaltern: SKL-1, Befehle CMD-1a bis 3, Wege-App WEG-a bis -d nur bei bestandenem Pilot und nach G-Kern (WEG-d nach PRIV-2). (4) Datenbank DB-1 später. „Agent starten“ aus Triggern und Abläufen bleibt bis M4 eingefroren (AGENTS.md). Die Naht-Spur: TRES-3 und CMD-2 laufen nacheinander, Stufe A mit zwei Fremd-Reviews.

Entscheide des Nutzers vom 11.10.2026, Wortlaut „Ich nehme alle Empfehlungen bei den Entscheidungen E1-E4 an“. Die Nummern E1–E4 gehören zu den Karten der Root-Übersicht, nicht zu den historischen E-Nummern in `docs/PLAN.md`.

- **E1 ja:** ein Sammeleintrag; Wege-Pilot jetzt ohne App-Code als Thema von DEV-KNOW-01 (`kind: recipe` im vorhandenen `hq-lessons`-Werkzeug, kein neues Skript); Reihenfolge Tresor (v2.1, vor B6a-2/B19) → Skills, Befehle, Wege-App (v2.2, Wege-App nur bei bestandenem Pilot) → Datenbank (später).
- **E2 ja:** Feintuning heißt Agenten einstellen (Modell, Denkstufe, Skills, Rechte) mit Messung, plus Ollama-Modelfile-Voreinstellungen; kein Modell-Training.
- **E3 ja:** nur eigene Entwicklungs-Datenbanken, nur lesend; Kunden-Datenbanken gesperrt (V2-PRIV-3).
- **E4 ja:** Vor größeren Glass-UI-Paketen erzeugt Root 2–3 ArtCraft-Varianten aus Screenshot oder Skizze, der Nutzer wählt, das Bild geht in den Paketauftrag (rund 50 Credits je Bildschirm aus dem Basic-Abo, kein Zusatzgeld).

**Umkehrbar** sind alle vier: Fällt der Pilot durch, wird nichts in die App gebaut; Training oder Kunden-Datenbanken bräuchten ein neues Ja des Nutzers.

## 6. Offene Punkte

1. Landen B6a-2 und B19 im v2.0-Kern (`plan.md` Abschnitt 1a), gehören TRES-1/2 technisch dazu. Der Koordinator legt das im ersten Paketauftrag fest; der Plan-Freeze (höchstens eine Planänderung je Woche) gilt.
2. Speicherort des Tresors (Datei oder Tabelle) und damit die Naht von TRES-1.
3. Wo Hosts verwaltet werden (V2-S10b oder V2-S10c).
4. Änderung an `ia.md` (Typ-Filter Notiz/Lesson/Skill/Weg in `/gedaechtnis`) als Folgepaket zu V2-IA-1.
5. Größe von WEG-a bis -d ist geschätzt, nicht gemessen; `HEAVY_DOCS` um `docs/wege/` nur, falls der Pilot Dateien dort ablegt.

## 7. Befunde der Gegenprüfung: wo behandelt

| Befund | Stufe | Behandelt in |
|---|---|---|
| D1 Tresor nach den Paketen, die ihn brauchen; Schnitt „erfunden“ | hoch | Kopf (Schnitt ist Entscheid 10.10.; Tresor vor B6a-2/B19), Abschnitt 5, Punkt 6.1 |
| D2 Agent kann Werte aus dem Tresor lesen | hoch | Abschnitt 2 (TRES-2), Abschnitt 3 |
| D3 Zeile sagt das Gegenteil (Unix Klartext) | mittel | Abschnitt 2 (TRES-1 führt die Verweigerung ein) |
| D4 falscher Lieferweg, zweiter `TresorRef` | mittel | Abschnitt 2 (TRES-1, TRES-2 a/b) |
| D5 Bereichsmodell doppelt zu V2-KP-4 | mittel | Abschnitt 2 (TRES-1; Absatz zu KP-4) |
| D6 „Naht nein“ nicht glaubwürdig | mittel | Abschnitt 2 (TRES-1 Speicher), Punkt 6.2 |
| D7 Einschleusung über Wege | hoch | Abschnitt 4, Sicherung 1 |
| D8 Codex-Pfad ins Repo | mittel | Abschnitt 4, Sicherung 2 (WEG-c) |
| D9 zweites Lessons-Werkzeug | mittel | Abschnitt 4 (Pilot: `kind: recipe`, kein Skript) |
| D10 Dublette zu Vorlagen DF-33/34, B26 | mittel | Abschnitt 1 (Zeile 9), Abschnitt 4 (Modell) |
| D11 zweiter Wissenspilot | mittel | Abschnitt 4 (Pilot als Thema von DEV-KNOW-01), E1 |
| D12 Saat-Wege brechen eigene Regeln | mittel | Abschnitt 4 (Saat-Wege) |
| D13 Messung kann nicht scheitern | mittel | Abschnitt 4 (Messgröße, Stufe „Erprobt“) |
| D14 Grenze der offenen Entscheidungen falsch gelesen | mittel | Abschnitt 5: ein Sammeleintrag, DB-Frage ohne Karte (Abschnitt 1) |
| D15 CMD-1 passt nicht in 300 Zeilen | mittel | Abschnitt 2 (CMD-1a/1b) |
| D16 Gegenargument zu Feintuning falsch | niedrig | Abschnitt 1 (Feintuning, Modelfile), E2 |
| D17 Datenbank-Bedeutung offen, Kundensperre | niedrig | Abschnitt 1 (Datenbanken), Abschnitt 2 (DB-1) |
| D18 Namen und Verweise | niedrig | Abschnitt 4 (Stufen, `roles.rs` nur Analogie) |
| D19 SKL-1 Stufe B | niedrig | Abschnitt 2 (Stufe A, kein Abruf, keine Skripte) |
| D20 WEG-a Stufe B | niedrig | Abschnitt 2 (Stufe A) |
| D21 Wiederherstellung ohne Schlüssel | niedrig | Abschnitt 2 (TRES-1), Abschnitt 3 |
