# Provider-Drill (W3-03g, Matrixzeilen 11 und 12)

Du prüfst pro Anbieter (Claude, Codex, OpenCode), ob ProjectA richtig
aufschreibt, **welcher Anbieter und welches Modell wirklich gelaufen ist** und
**wie viel verbraucht wurde, ohne etwas zu schätzen**. Es gilt nur dein
Abo, keine bezahlten API-Schlüssel. Pro Anbieter ein Durchlauf, etwa 15 Minuten.
Das Skript liest nur (über `pa`); es startet nichts und verändert keine Datenbank.

Voraussetzung: installiertes ProjectA läuft, du bist beim Anbieter angemeldet,
PowerShell 7, Node 24, `pa` im PATH und dieses Repository sind da.

1. **Version notieren.** In ProjectA „Info" öffnen; Versionsnummer merken
   (kommt als `-AppVersion` in Schritt 6).
2. **Vorher-Stand speichern.** In PowerShell 7 im Repository-Ordner:
   `pwsh scripts/drills/provider-drill.ps1 -Phase Before -Adapter claude -ProjectId <deine-Projekt-ID>`
   Erwartet: „Vorher-Stand gespeichert". (Adapter: `claude`, `codex` oder `opencode`.)
3. **Eine kleine Aufgabe laufen lassen.** In ProjectA genau eine kleine Aufgabe
   mit diesem Anbieter starten (z. B. „lege eine Datei hallo.txt an") und
   warten, bis sie fertig ist. Nur diese eine Aufgabe, sonst sind es mehrere neue Läufe.
4. **Beleg beim Anbieter kopieren.** Öffne die Nutzungs-/Abo-Seite des Anbieters
   (Claude: Einstellungen › Usage; Codex/ChatGPT: Einstellungen › Usage; OpenCode:
   die Anzeige deines Anbieter-Kontos). Kopiere die Zahlen in eine Textdatei
   `snapshot.txt` und lösche vorher E-Mail-Adressen und Kontonamen. Notiere die
   Uhrzeit der Ansicht.
5. **Nachher-Stand und Beleg erzeugen:**
   `pwsh scripts/drills/provider-drill.ps1 -Phase After -Adapter claude -ProjectId <ID> -AppVersion 1.4.1 -SnapshotFile snapshot.txt -SnapshotSource "Claude Usage-Seite" -SnapshotObservedAt "2026-10-05 10:30" -OutDir C:\Belege\provider-claude`
   (`-OutDir` weglassen: neuer Ordner mit Zeitstempel im aktuellen Ordner; der Zielordner muss neu oder leer sein.)
6. **Ausgabe lesen.** Erwartet: drei Zeilen mit `OK` und `Ergebnis: pass`.
   Bei `FEHLER` den Ordner behalten und melden. `pass` mit „usage not_reported"
   ist richtig, wenn es für den Anbieter keinen Messweg gibt: es wird nie geschätzt.
7. **Beleg prüfen.** `manifest.json` (Schritte, Exit-Codes, Hashes), `run-summary.json`
   (Route, Transport, beobachtete Identität, Reservierung, Messergebnis mit Quelle und
   Zeit), `run-record.json`, `provider-snapshot.txt`, `processes.txt`.
   Tokens und dein Benutzerpfad sind geschwärzt; lies trotzdem einmal drüber,
   bevor du etwas weitergibst. Der Arbeitsordner `provider-drill-work` enthält die
   rohen Lauflisten und gehört nicht in den Beleg.
8. Schritte 2 bis 7 für die beiden anderen Anbieter wiederholen.

Nicht abgedeckt: Das Skript kann deinen Anbieter-Beleg nicht gegen den Anbieter
prüfen (du tippst ihn ab); Abrechnung in Geld wird nicht gemessen; echter
Windows-Lauf nur auf deinem PC.
