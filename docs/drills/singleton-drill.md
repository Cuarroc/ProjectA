# Singleton-Drill (W3-03b, Matrixzeile 25)

Du prüfst, dass ProjectA nur **einmal** läuft, auch wenn du es zweimal startest,
und dass nach einem Absturz (und nach einem Update) deine Sitzungen noch da sind.
Das Skript schaut nur zu: Es liest die Prozessliste und ruft die API einmal
lesend ab (`GET /api/workers`). Deine Datenbank wird nicht angefasst. Dauer:
etwa 10 Minuten. Das Skript fragt dich bei jedem Schritt, wann es weitermachen soll.

Voraussetzung: ProjectA ist **installiert** (nicht aus dem Quellcode gestartet),
PowerShell 7, Node 24 und dieses Repository sind da. Lege vorher in ProjectA
mindestens eine Sitzung an, damit es etwas zu vergleichen gibt.

1. **Version notieren.** Öffne „Info" in ProjectA, merke dir die Versionsnummer.
   Schließe dann ProjectA ganz (auch im Tray beenden).
2. **Skript starten.** PowerShell 7 im Repository-Ordner:
   `pwsh scripts/drills/singleton-drill.ps1 -AppVersion 1.4.1 -OutDir C:\Belege\singleton`
   (ohne `-OutDir` entsteht ein neuer Ordner mit Zeitstempel im aktuellen Ordner;
   der Zielordner muss neu oder leer sein).
3. **Ausgangslage.** Starte ProjectA **einmal**, warte auf das Fenster, drücke im
   Skript Enter. Erwartet: `OK 1. baseline`. **Screenshot 1:** das ProjectA-Fenster
   mit deinen Sitzungen.
4. **Zweiter Start.** Starte ProjectA noch einmal (Startmenü oder Symbol). Erwartet:
   kein zweites Fenster, das alte kommt nach vorn. Warte 5 Sekunden, drücke Enter.
   Erwartet: `OK 2. second-start`. **Screenshot 2:** Task-Manager, Reiter „Details",
   sortiert nach Name, mit nur **einer** Zeile `ProjectA.exe`.
5. **Absturz.** Öffne den Task-Manager, Rechtsklick auf `ProjectA.exe`, „Task
   beenden". **Screenshot 3:** der Task-Manager direkt danach. Starte ProjectA neu,
   warte auf das Fenster, Enter. Erwartet: `OK 3. crash`; deine Sitzungen stehen
   noch in der Liste (das Skript vergleicht sie mit der Ausgangslage).
6. **Update (nur wenn eines angeboten wird).** Installiere es, wähle „Neu starten",
   warte auf das Fenster, tippe im Skript `j`. Gibt es kein Update: nur Enter, der
   Schritt wird als übersprungen vermerkt.
7. **Ausgabe lesen.** Erwartet: am Ende `Ergebnis: pass`. Bei `FEHLER` den Ordner
   nicht löschen und melden.
8. **Beleg prüfen.** Der Ordner enthält `manifest.json` (Schritte, Ergebnis,
   Nicht-abgedeckt) und je Schritt eine `snapshot-*.json` mit Prozess-IDs, offenen
   Ports und Sitzungs-Kennungen. Das Token aus `projecta-api.json` wird nie
   gespeichert. Lege die drei Screenshots dazu.

Nicht abgedeckt: Screenshots (von dir), ein Update-Neustart ohne angebotenes
Update, portable oder andere Plattformen. Die Sitzungsprüfung vergleicht nur
Kennungen und Status, nicht den Inhalt der Terminals.
