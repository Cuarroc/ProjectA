# Klick-Checkliste v2.0 „eng“ (Hülle + Leitstand)

Eine Seite zum Durchklicken auf dem Beta-Build. Du musst keinen Code lesen.
Stand: 15.10.2026. Sie beschreibt den Stapel #1484 → #1499 → #1540; auf `main`
ist die neue Oberfläche noch aus. Gilt erst, wenn der Beta-Build diese Stände
enthält.

**So füllst du jeden Punkt aus:** Klicke, schau hin, setze genau ein Kreuz.
- **neu** = so sieht es anders aus als die klassische Oberfläche.
- **bewiesen** = es verhält sich wie beschrieben.
- **nicht abgedeckt** = ging nicht oder konnte ich nicht prüfen (schreib kurz dazu, was).

„Beleg" nennt, was das schon vorab prüft. „nur Sichtprüfung" heißt: nur du kannst es sehen.

**Vorsicht:** Punkt 6 beendet alle laufenden Agenten. Mach ihn nur, wenn nichts
Wichtiges läuft. Bei „Archivieren" (Punkt 4) klickst du nie auf „Ja, endgültig".

---

### 1. Start und Seitenleiste
- **Klicke:** Starte die App.
- **Du siehst:** die neue Oberfläche mit einer Leiste links. Dort stehen nur **Leitstand** und **Einstellungen**.
- **Beleg:** #1484 (neue Oberfläche standardmäßig an), #1499 (nur diese zwei Bereiche); `src/shell/scope.test.tsx`.
- ☐ neu ☐ bewiesen ☐ nicht abgedeckt

### 2. Leitstand: Karten und Filter
- **Klicke:** Leitstand, Reiter **Haupt**. Klicke nacheinander die Filter **Alle**, **Läuft**, **Braucht dich**, **Fehler**.
- **Du siehst:** je Agent eine Karte. Hinter jedem Filter steht eine Zahl, auch die 0. Ohne Agenten steht da „Noch kein Agent". Ein Filter ohne Treffer sagt „Kein Agent im Zustand …".
- **Beleg:** `LeitstandRoute.test.tsx` („shows the cards and the Braucht dich list …"), `LeitstandCards.test.tsx` („shows one card per agent … and filters by state"). Die Karten zeigen noch „Beweis nicht verbunden": das ist gewollt und ehrlich.
- ☐ neu ☐ bewiesen ☐ nicht abgedeckt

### 3. „Braucht dich"
- **Klicke:** Schau rechts neben die Karten.
- **Du siehst:** offene Fragen von Agenten. Drei feste Zeilen: **Geld**, **Installieren**, **Löschen** („… braucht deine Freigabe"). Ohne offene Frage steht dort „Keine offene Entscheidung."
- **Beleg:** `NeedsYou.test.tsx` („shows the money one-liner …", „answers a delete question from its own row"). Eine echte Antwort kannst du nur geben, wenn gerade eine Frage offen ist; sonst „nicht abgedeckt".
- ☐ neu ☐ bewiesen ☐ nicht abgedeckt

### 4. Agentenkarte: Öffnen und Archivieren
- **Klicke:** Auf einer Karte **Öffnen**. Zurück, dann **Archivieren** und in der Rückfrage **Abbrechen**.
- **Du siehst:** „Öffnen" zeigt die Terminal-Ansicht dieses Agenten. „Archivieren" fragt erst nach („Endgültig: der Agent wird beendet …") und tut nichts, bis du „Ja, endgültig" klickst. Du klickst es nicht.
- **Beleg:** `AgentCard.test.tsx` („archive asks inline first and only the confirmation calls archiveWorker"). Terminal-Ansicht: nur Sichtprüfung. Ohne Karte: „nicht abgedeckt".
- ☐ neu ☐ bewiesen ☐ nicht abgedeckt

### 5. Reiter und Suche
- **Klicke:** Im Leitstand nacheinander **Betrieb**, **Klassisch**, **Werkzeuge**, **Haupt**. Dann `Strg K`, tippe „Verlauf", Enter.
- **Du siehst:** Der gewählte Reiter ist markiert und der Inhalt wechselt. „Klassisch" zeigt die alte Arbeitsansicht. Die Suche findet „Verlauf" und öffnet ihn (alte Ansicht darin).
- **Beleg:** `LeitstandRoute.test.tsx` („reaches Betrieb from Haupt by its tab link and goes back", „keeps the old Work view reachable as the tab Klassisch"), `header.test.tsx` („opens on Ctrl K …"). Ob Betrieb und Werkzeuge zufriedenstellen: nur Sichtprüfung.
- ☐ neu ☐ bewiesen ☐ nicht abgedeckt

### 6. Not-Aus (beendet alle Agenten!)
- **Klicke:** Oben in der Leiste **Not-Aus** („stoppt alles in 10 s"). Warte bis zu 10 Sekunden. Dann im Band **Fortsetzen**.
- **Du siehst:** ein Band „Not-Aus ist aktiv: neue Aufgaben sind gesperrt." und die Agenten enden. Nach „Fortsetzen" verschwindet das Band. Das Band und der Not-Aus-Knopf sind auf jeder Seite da, auch in den Einstellungen.
- **Beleg:** `header.test.tsx` („shows while Not-Aus is active and lifts it with Fortsetzen"), `stopband.test.tsx` (zwölf Seiten). Ob wirklich jeder Agent in 10 Sekunden endet: nur du siehst das, im Test nicht bewiesen.
- ☐ neu ☐ bewiesen ☐ nicht abgedeckt

### 7. Einstellungen
- **Klicke:** **Einstellungen** in der Leiste, dann alle Reiter durch (Allgemein, MCP & Tresor, Benachrichtigungen, Projekt). Unter „Darstellung" **Hell**, **Dunkel**, **System** wählen.
- **Du siehst:** Abschnitte Darstellung, Vorschau-Funktionen, Version & Updates, Diagnose, Not-Aus, Weitere Einstellungen. Hell/Dunkel wechselt sofort. Reiter, die noch nicht fertig sind, sagen „… noch nicht verbunden".
- **Beleg:** `EinstellungenScreen.test.tsx` (Abschnittsliste), `contrast-check.mjs` (704 Farbpaare lesbar). Wie schön es aussieht: nur Sichtprüfung (die Bilder prüft V2-SHOT-BASE).
- ☐ neu ☐ bewiesen ☐ nicht abgedeckt

### 8. Zurück zur klassischen Oberfläche
- **Klicke:** Einstellungen → **Vorschau-Funktionen** → **Neue Oberfläche (Vorschau)** ausschalten. Danach wieder einschalten. Zum Schluss App schließen und neu starten.
- **Du siehst:** Ausgeschaltet: die alte Oberfläche. Eingeschaltet: die neue. Nach dem Neustart bleibt deine Wahl.
- **Beleg:** `mount.test.tsx` („is switched on and off from Settings General and persists"). Neustart der echten App: nur Sichtprüfung.
- ☐ neu ☐ bewiesen ☐ nicht abgedeckt

### 9. Ersteinrichtung
- **Klicke:** `Strg K`, tippe „Ersteinrichtung", Enter (kein Eintrag in der Leiste). Klicke **nichts**, was installiert.
- **Du siehst:** sechs Schritte (Willkommen bis Fertig) und einen Hinweis: Installieren, Löschen und Geldausgeben brauchen deine Freigabe. Das Lesen der Projektregeln kann noch „Noch nicht verbunden" melden.
- **Beleg:** `ErsteinrichtungScreen.test.tsx` („lists the six steps in order …"), `StartRoute.test.tsx`. Die Schritt-Knöpfe selbst: nur Sichtprüfung.
- ☐ neu ☐ bewiesen ☐ nicht abgedeckt

### 10. Tastatur
- **Klicke:** Nichts. Drücke `Tab` mehrmals, dann `Umschalt Tab`, auf Leitstand und Einstellungen.
- **Du siehst:** Ein sichtbarer Rahmen wandert über Leiste, Reiter und Knöpfe und wieder zurück. Nichts bleibt hängen.
- **Beleg:** `src/shell/acceptance/keyboard.test.ts` (zwölf Seiten). Fokus in Dialogen ist nicht überall geprüft: „nicht abgedeckt".
- ☐ neu ☐ bewiesen ☐ nicht abgedeckt

---

## Kommt noch (nicht testen)
- **Fabrik**: wird ein Reiter im Leitstand und ersetzt „Fluss". Noch nicht gebaut.
- **Lichtkugeln ruhig/lebhaft** (Standard ruhig): in der App noch nicht vorhanden.
- Alle anderen Bereiche (Plan, Team, Automatik …): bleiben versteckt.

## Glossar
- **Leitstand**: die Übersicht, was jeder Agent gerade tut.
- **Agent**: ein KI-Helfer, der eine Aufgabe in einem eigenen Arbeitsordner erledigt.
- **Not-Aus**: Sofort-Stopp; beendet alle Agenten, sperrt neue Aufgaben.
- **Gates**: automatische Prüfungen, die vor dem Zusammenführen grün sein müssen.
- **PR**: ein Änderungsvorschlag am Code. Die Nummer (#1540) findest du auf GitHub.
- **Beweis**: der Nachweis, dass eine Arbeit wirklich geprüft wurde (Test, Befehl, Exit-Code).
- **Vorschau-Funktion**: ein Schalter für etwas Neues, das du an- und ausschalten kannst.
- **Beta-Build**: die Testfassung, die noch keine fertige Version ist.
