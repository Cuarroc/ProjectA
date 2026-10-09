# Denkraum in fünf Schritten — Entwurf

Der Denkraum hilft dir, Fragen zu beantworten und Ideen mit ihrem Stand zu
überblicken. Diese Anleitung ist noch nicht durch einen Trockenlauf geprüft.
Sie bleibt Entwurf, bis DR-16a gemergt und das DR-16b-Protokoll von Root
angenommen ist. DR-Nummern benennen die Arbeitspakete im [Projektplan](../PLAN.md).

Voraussetzung: Ein vorbereiteter ProjectA-Quellordner, Node.js ab Version 24
und eine eingerichtete Denkraum-Umgebung auf deinem Rechner. Datenordner,
Empfänger und Zugänge werden bei der Einrichtung festgelegt; die Daten liegen
außerhalb des Quellordners. Der Start ohne manuelle Eingabe von Geheimnissen
wird noch eingebunden (erscheint mit DR-15b). Die freigegebene Live-Umgebung
folgt mit der Umschaltung (erscheint mit DR-16).

## 1. Denkraum starten (erscheint mit DR-16)

Öffne ein Terminal im vorbereiteten ProjectA-Quellordner. Starte dort:

```sh
node tools/denkraum/server.mjs
```

Lass das Terminal offen. Bei der vorgesehenen Einrichtung meldet es
`Entscheidungsseite: http://127.0.0.1:4791`.
Meldet es fehlende Einstellungen oder einen belegten Anschluss, ist der Start
nicht gelungen; lass die Einrichtung prüfen, bevor du fortfährst.
Der Befehl ist der vorhandene Server-Einstieg. Es gibt derzeit keinen
Denkraum-Startbefehl in der Skriptliste von `npm run`.

## 2. Seite öffnen (erscheint mit DR-16)

Öffne auf demselben Rechner im Browser <http://127.0.0.1:4791/>.
Die Adresse gehört immer zum eigenen Rechner, auch wenn du sie anderswo
eingibst. Die Bedienoberfläche ist nur lokal erreichbar.
Warte, bis die Fragen geladen sind. Bei einem Verbindungsfehler prüfe die
Meldung im Terminal aus Schritt 1 und nutze anschließend „Aktualisieren“.

## 3. Eine Frage beantworten (erscheint mit DR-16)

Wähle im Bereich „Fragen“ eine offene Frage und lies die Begründung.
Wähle eine Antwortmöglichkeit oder schreibe bei einer freien Frage deinen Text.
Klicke auf „Auswahl prüfen“ beziehungsweise „Antwort prüfen“.
Lies die Zusammenfassung und bestätige erst dann mit „Auswahl verbindlich
speichern“ beziehungsweise „Antwort speichern“. Warte auf die Speicherbestätigung.

Du kannst auch „Später entscheiden“ oder „Rückfrage stellen“ wählen und
anschließend bestätigen. Eine Empfehlung wird nicht automatisch ausgewählt.
Sind keine Fragen vorhanden, gibt es hier noch nichts zu beantworten.

## 4. Status und Ideen lesen (erscheint mit DR-16)

„Gespeichert“ bedeutet, dass deine Eingabe abgelegt wurde. „Root empfangen“
bestätigt getrennt den Empfang durch den zuständigen Orchestrator.
„Geprüft“, „Für Patch geplant“ und „Umgesetzt“ sind weitere, getrennte Stände.
Eine gespeicherte Antwort oder Idee allein erteilt keinen Ausführungsauftrag.
Unter „Geplant“ erscheint ein Termin erst, wenn eine passende Planung vorliegt.

Wechsle zu „Ideen“, um gespeicherte Ideen und deren aktuelle Fassung zu lesen.
Ein Text im Entwurfsfeld ist noch keine gespeicherte Idee; beachte die Meldung
darunter. Für die Übersicht kommen folgende Auswahlfelder hinzu:

- **Kategorie (erscheint mit DR-12):** Wähle eine Kategorie oder „Alle
  Kategorien“. „Keine Kategorie“ bedeutet, dass keine angegeben wurde.
  Kategorien sind ungeprüfte Nutzerangaben.
- **Nutzerpriorität (erscheint mit DR-13):** Filtere nach „Dringend“, „Hoch“,
  „Normal“ oder „Später“. „Nicht lesbar“ kennzeichnet ungültige Angaben.
  Die Priorität ist ein Wunsch, keine Zusage zur Ausführung.
- **Belegte Zuordnung (erscheint mit DR-13):** Filtere nach „Eingang · Aktuelle
  Fassung gespeichert“ oder „Noch nicht zugeordnet“. Weitere Stationen mit
  „Wird ergänzt“ sind noch kein belegter Fortschritt.
- **Reihenfolge (erscheint mit DR-14):** Wähle „Gespeicherte Reihenfolge“,
  „Nutzerpriorität, dann neueste Fassung“, „Neueste Fassung zuerst“,
  „Älteste Fassung zuerst“ oder „Titel, dann Ideen-ID“. Gleiche Werte werden
  durch Titel und Ideen-ID eindeutig geordnet; die Auswahl ändert keine Daten.

Wenn eine Idee fehlt, leere die Suche und stelle die Filter auf „Alle“ zurück.

## 5. Denkraum stoppen (erscheint mit DR-16)

Warte zuerst auf die Bestätigung einer laufenden Speicherung.
Wechsle zum Terminal aus Schritt 1 und drücke **Strg+C**. Warte, bis die
Eingabeaufforderung zurückkehrt; danach kannst du den Browser-Tab schließen.
Nur den Tab zu schließen beendet den Server nicht. Bereits gespeicherte Daten
bleiben erhalten. Dieser Schritt gilt für den manuellen Start aus Schritt 1.
