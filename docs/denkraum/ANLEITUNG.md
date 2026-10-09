# Denkraum in fünf Schritten — Entwurf

Der Denkraum hilft dir, Fragen zu beantworten und Ideen mit ihrem Stand zu
überblicken. Diese Anleitung ist noch nicht durch einen Trockenlauf geprüft.
Sie bleibt Entwurf, bis Root das Protokoll der Umschaltung auf dem PC (DR-16b)
angenommen hat und ein Trockenlauf sie bestätigt. Bis dahin kann ein bereits
laufender Denkraum noch eine ältere Fassung zeigen. DR-Nummern benennen die
Arbeitspakete im [Projektplan](../PLAN.md).

Voraussetzung: Ein vorbereiteter ProjectA-Quellordner, Node.js ab Version 24
und eine eingerichtete Denkraum-Umgebung auf deinem Rechner. Der Server liest
Datendatei, Empfänger und Zugänge aus Umgebungsvariablen, die bei der
Einrichtung gesetzt werden; die Daten liegen außerhalb des Quellordners.
Zugänge gibst du nie in einen Chat, eine Datei oder ein Protokoll ein.

## 1. Denkraum starten

Öffne ein Terminal im vorbereiteten ProjectA-Quellordner. Prüfe zuerst die
Einrichtung und starte dann den Server:

```sh
node tools/denkraum/config.mjs --check
node tools/denkraum/server.mjs
```

Die Prüfung meldet je Einstellung „valid“ und zeigt keine Werte. Fehlt etwas,
nennt sie nur den Namen der Einstellung und den Grund; lass dann die
Einrichtung prüfen. Ohne Webhook-Adresse läuft der Denkraum ohne
Benachrichtigungen.
Lass das Terminal offen. Der Server meldet
`Entscheidungsseite: http://127.0.0.1:4791`. Meldet er stattdessen eine
Einstellung oder einen belegten Anschluss, ist der Start nicht gelungen.
Es gibt keinen Denkraum-Startbefehl in der Skriptliste von `npm run`.

## 2. Seite öffnen

Öffne auf demselben Rechner im Browser <http://127.0.0.1:4791/>.
Die Adresse gehört immer zum eigenen Rechner, auch wenn du sie anderswo
eingibst. Die Bedienoberfläche ist nur lokal erreichbar.
Warte, bis die Fragen geladen sind. Bei einem Verbindungsfehler prüfe die
Meldung im Terminal aus Schritt 1 und nutze anschließend „Aktualisieren“.

## 3. Eine Frage beantworten

Wähle im Bereich „Fragen“ eine offene Frage und lies die Begründung.
Wähle eine Antwortmöglichkeit oder schreibe bei einer freien Frage deinen Text.
Klicke auf „Auswahl prüfen“ beziehungsweise „Antwort prüfen“.
Lies die Zusammenfassung und bestätige erst dann mit „Auswahl verbindlich
speichern“ beziehungsweise „Antwort speichern“. Warte auf die Speicherbestätigung.

Du kannst auch „Später entscheiden“ oder „Rückfrage stellen“ wählen und
anschließend bestätigen. Eine Empfehlung wird nicht automatisch ausgewählt.
Sind keine Fragen vorhanden, gibt es hier noch nichts zu beantworten.

## 4. Status und Ideen lesen

„Gespeichert“ bedeutet, dass deine Eingabe abgelegt wurde. „Root empfangen“
bestätigt getrennt den Empfang durch den zuständigen Orchestrator.
„Geprüft“, „Für Patch geplant“ und „Umgesetzt“ sind weitere, getrennte Stände.
Eine gespeicherte Antwort oder Idee allein erteilt keinen Ausführungsauftrag.
Unter „Geplant“ erscheint ein Termin erst, wenn eine passende Planung vorliegt.

Wechsle zu „Ideen“, um gespeicherte Ideen und deren aktuelle Fassung zu lesen.
Ein Text im Entwurfsfeld ist noch keine gespeicherte Idee; erst „Idee
speichern“ legt sie ab. Beachte die Meldung unter dem Feld. Über deinen
gespeicherten Ideen helfen dir diese Auswahlfelder:

- **Reihenfolge:** Voreingestellt ist „Gespeicherte Reihenfolge“. Daneben gibt
  es „Nutzerpriorität, dann neueste Fassung“, „Neueste Fassung zuerst“,
  „Älteste Fassung zuerst“ und „Titel, dann Ideen-ID“. Gleiche Werte werden
  durch Titel und Ideen-ID eindeutig geordnet; die Auswahl ändert keine Daten.
- **Titel oder Originaltext durchsuchen:** Suche nach Wörtern aus der Idee.
- **Kategorie · Nutzerangabe (ungeprüft):** Wähle eine Kategorie oder „Alle
  Kategorien“. „Keine Kategorie“ bedeutet, dass keine angegeben wurde.
- **Nutzerpriorität:** Filtere nach „Dringend“, „Hoch“, „Normal“ oder „Später“.
  „Nicht lesbar“ kennzeichnet ungültige Angaben. Die Priorität ist ein Wunsch,
  keine Zusage zur Ausführung.
- **Belegte Zuordnung:** Filtere nach „Eingang · Aktuelle Fassung gespeichert“
  oder „Noch nicht zugeordnet“. Weitere Stationen mit „Wird ergänzt“ sind noch
  kein belegter Fortschritt.

Alle Filter wirken zusammen; die Zeile „… von … gespeicherten Ideen“ zeigt,
wie viele passen. Erscheint „Keine Ideen für diese Auswahl.“, leere die Suche
und stelle „Alle Kategorien“, „Alle Prioritäten“ und „Alle Zuordnungen“ ein.

## 5. Denkraum stoppen

Warte zuerst auf die Bestätigung einer laufenden Speicherung.
Wechsle zum Terminal aus Schritt 1 und drücke **Strg+C**. Warte, bis die
Eingabeaufforderung zurückkehrt; danach kannst du den Browser-Tab schließen.
Nur den Tab zu schließen beendet den Server nicht. Bereits gespeicherte Daten
bleiben erhalten. Dieser Schritt gilt für den manuellen Start aus Schritt 1.

Möchtest du den Stand sichern, etwa vor einer Aktualisierung, dann erst
nach dem Stoppen:

```sh
node tools/denkraum/switch.mjs backup --state <Datendatei> --out <neuer Ordner> --port 4791
```

Schreibe beide Pfade vollständig aus; den Ordner darf es noch nicht geben.
Antwortet der Denkraum noch, verweigert der Befehl die Sicherung. Einen älteren
Stand spielt er absichtlich nie zurück: Der Rückweg ist, den Denkraum
angehalten zu lassen und die Einrichtung prüfen zu lassen.
