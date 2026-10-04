# Backup-Drill (W3-03a, Matrixzeile 22)

Du prüfst, ob eine Sicherung deiner ProjectA-Datenbank wirklich wieder lesbar
ist. Deine echte Datenbank wird dabei **nur gelesen**, nie verändert; die
Wiederherstellung läuft in einem Wegwerf-Ordner. Dauer: etwa 5 Minuten.

Voraussetzung: ProjectA, PowerShell 7, Node 24 und dieses Repository sind da.

1. **Version notieren.** Starte ProjectA einmal, öffne „Info" und merke dir die
   Versionsnummer; du gibst sie in Schritt 4 mit `-AppVersion` an.
2. **Wartungsmodus starten.** Warte, bis kein Worker mehr läuft. Klicke
   „Einstellungen" → Reiter „Allgemein" → „Wartungsmodus starten" → „Ja,
   Wartungsmodus starten". Erwartet: Das Kennzeichen „Aktiv" erscheint. Eine rote
   Meldung heißt: es läuft noch Arbeit; warten und erneut versuchen.
3. **ProjectA schließen** (Fenster zu, auch im Tray beenden). Erwartet: Die Datei
   `projecta-api.json` im App-Ordner ist weg.
4. **Skript starten.** Öffne PowerShell 7 im Repository-Ordner und tippe:
   `pwsh scripts/drills/backup-drill.ps1 -AppVersion 1.4.1 -OutDir C:\Belege\backup-drill`
   (ohne `-OutDir` entsteht ein neuer Ordner mit Zeitstempel im aktuellen Ordner).
   Jeder Lauf braucht einen neuen oder leeren Zielordner, damit keine alten Dateien in den Beleg geraten.
5. **Ausgabe lesen.** Erwartet: fünf Zeilen mit `OK` und am Ende `Ergebnis: pass`.
   Bei `FEHLER` den Ordner nicht löschen und mir melden.
6. **Beleg prüfen.** Im Ordner liegt `manifest.json` (Schritte, Exit-Codes,
   Hashes, Ergebnis, Nicht-abgedeckt) und die Prüfdateien. Die Textbelege sind
   geschwärzt. **Der Unterordner `backup` enthält die vollständige, ungeschwärzte
   Datenbank mit privaten Inhalten und Tokens: nie weitergeben.** Textbelege erst prüfen.
7. **ProjectA wieder starten**; alles soll wie vorher aussehen. Wurde der
   Wartungsmodus nicht durch das Schließen beendet: „Einstellungen" → „Allgemein"
   → „Wartungsmodus beenden".

Nicht abgedeckt: Wartungs-Drain per App (Knopf vorhanden, nicht im Drill-Skript geprüft), Sicherung bei laufender
App, Wiederherstellung über die Live-Datenbank.
