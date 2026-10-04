# Updater-Drill (W3-03e, Matrixzeile 23)

Du prüfst drei Fälle des Updates an der **installierten Beta** auf deinem
Windows-PC: Update klappt, Update abbrechen, Update scheitert. Bei jedem Fall
bleibt eine gespeicherte Worker-Zeile erhalten. Das Skript liest nur (API, Journal-Datei) und
schreibt einen Beleg-Ordner. Dauer: je Fall etwa 10 Minuten.

Voraussetzung: ProjectA-Beta installiert, mit einer neueren Beta als Update
bereit; PowerShell 7, Node 24 und dieses Repository sind da. Alle Live-Sitzungen
müssen beendet sein: Der Updater verweigert Installationen, solange ein Worker läuft.

**Für jeden der drei Fälle** (`success`, `cancel`, `fail`):

1. **Alte Version notieren.** Öffne „Info" in ProjectA, merke die Versionsnummer.
2. **Worker-Zeile vorbereiten.** Lege einen Worker an und beende seine Live-Sitzung,
   ohne den Worker zu löschen. Ohne gespeicherte Worker-Zeile meldet das Skript `FEHLER`.
3. **Skript starten** (zweites Fenster, PowerShell 7 im Repository-Ordner):
   `pwsh scripts/drills/updater-drill.ps1 -Scenario success -OldVersion 0.9.0 -NewVersion 0.9.1 -OutDir C:\Belege\updater-success`
   Nimm `cancel` oder `fail` statt `success`. Jeder Lauf braucht einen neuen
   oder leeren Zielordner. Das Skript wartet höchstens 10 Minuten (`-TimeoutMin`).
4. **Jetzt in ProjectA handeln** (das Skript beobachtet mit):
   - `success`: „Update installieren" klicken, Neustart abwarten. Erwartet: die App
     schließt und kommt von selbst wieder; die Worker-Zeile steht danach in der Liste.
   - `cancel`: „Update installieren" klicken und den Download **abbrechen**.
     Erwartet: die App bleibt offen und zeigt wieder „Update verfügbar".
   - `fail`: Flugmodus an, dann „Update installieren". Erwartet: ProjectA zeigt
     eine Fehlermeldung, die App bleibt offen. Flugmodus danach wieder aus.
5. **Anzeige abschreiben.** Schau in ProjectA und im Dev-HQ auf den Update-Status
   und schreibe den Text in eine Datei `angezeigt.txt` im Beleg-Ordner.
6. **Ausgabe lesen.** Erwartet: vier `OK`-Zeilen und `Ergebnis: pass`. Bei
   `FEHLER` den Ordner nicht löschen und mir melden.
7. **Beleg prüfen.** `manifest.json` (Schritte, Exit-Codes, Ergebnis, Nicht-abgedeckt),
   `before.json`/`after.json` (Worker-Zeilen, Journal-Zusammenfassung),
   `updater-phases.json` (Phasen mit Zeit), `processes.txt`. Alles ist geschwärzt;
   die Zugangsdaten aus `projecta-api.json` werden nie gespeichert.

Das Wiederherstellungs-Journal (`update-recovery.json`, W3-02) wird nur als
Phase, Größe und Hash festgehalten, nicht im Wortlaut. Fehlt die Datei, steht im
Beleg „absent": die installierte Version schreibt es dann noch nicht.

## Nicht abgedeckt (bleibt offen)

- **Signierter Produktions-Build (W3-07, dein Teil):** Signatur-Prüfung und das
  echte Release-Update gehen erst mit einem signierten Build. Bis dahin steht die
  Zeile „NICHT ABGEDECKT"; die Beta beweist nur den Ablauf.
- Netzabbruch (Flugmodus) und Abbrechen-Klick machst du von Hand.
- Update-Text in Fenster und HQ liest das Skript nicht, du schreibst ihn in `angezeigt.txt`.
