# Not-Aus-Drill (W3-03d, Matrixzeile 20)

Du prüfst, ob der Not-Aus alle Worker innerhalb von 10 Sekunden beendet. Das
Skript liest nur (Zustand über `pa estop status`, Prozessliste); den Not-Aus
löst **du** aus. Dauer: etwa 5 Minuten. Voraussetzung: die **installierte**
ProjectA-App, PowerShell 7, Node 24, `pa` im PATH und dieses Repository.

1. **Version notieren.** In ProjectA unter „Info" die Versionsnummer ablesen.
2. **Mehrere Worker starten** (mindestens drei) und warten, bis sie arbeiten.
   Die App muss offen bleiben.
3. **Skript starten.** PowerShell 7 im Repository-Ordner:
   `pwsh scripts/drills/estop-drill.ps1 -AppVersion 1.4.1 -OutDir C:\Belege\estop-drill`
   (ohne `-OutDir` entsteht ein neuer Ordner mit Zeitstempel). Der Zielordner
   muss neu oder leer sein. Erwartet: Zeile `>>> Jetzt Not-Aus ausloesen`.
4. **Not-Aus auslösen** (du hast 2 Minuten), auf einem von zwei Wegen:
   - in der App den Knopf „Not-Aus auslösen" (Einstellungen), oder
   - in einem zweiten Fenster: `pa estop on`.
5. **Warten.** Das Skript misst ab dem Moment, in dem die API „aktiv" meldet,
   bis keine Worker-Prozesse mehr laufen (Abfrage alle 250 ms, höchstens 15 s).
   Bestanden: leer innerhalb von 10 Sekunden. Übrig gebliebene Prozesse
   stehen mit Name, PID und Eltern-PID im Ergebnis.
6. **Not-Aus aufheben** (erneut 2 Minuten): Knopf „Not-Aus aufheben" oder
   `pa estop off --verdict-token <Token>`. Das Skript prüft danach den Zustand.
7. **Ausgabe lesen.** Erwartet: vier Zeilen `OK` und `Ergebnis: pass`. Bei
   `FEHLER` den Ordner behalten und melden.
8. **Beleg.** Im Ordner liegen `manifest.json` (Version, Zeiten, Schritte,
   Ergebnis, Nicht-abgedeckt), Zustände vorher/nachher, Prozesslisten und die
   Messreihe. Tokens werden nie gespeichert; Texte sind geschwärzt.

Nicht abgedeckt: ob die Agenten sauber endeten (nur die Prozessliste wird
geprüft), die GUI selbst, Linux/macOS.
