# Absturz-Drill (W3-03c, Matrixzeile 21)

Du prüfst, ob ProjectA nach einem harten Abbruch nichts Unklares zurücklässt:
Der unterbrochene Lauf muss auf „reconciling" (wird abgeglichen) stehen, und es
darf kein neuer Lauf für dieselbe Aufgabe starten, bevor Prozess und Datenbank
übereinstimmen. Deine Datenbank wird nur über eine Kopie **gelesen**. Das
Beenden des Prozesses ist der vereinbarte Ersatz für einen Stromausfall.
Dauer: etwa 10 Minuten je Übergang.

Voraussetzung: installiertes ProjectA, PowerShell 7, Node 24, dieses Repository.
Die Übergänge „beansprucht", „Absicht notiert", „Prüfpunkt" und „Abschluss"
gibt es nur bei Development-Läufen (Continuous AN, bis M4 gesperrt). Ohne
Continuous findet der Drill keinen offenen Lauf und meldet `FEHLER`: das ist
dann kein Bestanden, sondern „nicht abgedeckt".

1. **Version notieren** (ProjectA, „Info"); du gibst sie als `-AppVersion` an.
2. **Übergang erreichen.** Starte die Arbeit und warte auf den Moment: zum
   Beispiel „Prozess startet" oder „Eingabe wird übergeben". Du hast nur wenige
   Sekunden.
3. **Prozess hart beenden.** Task-Manager, `projecta` wählen, „Task beenden"
   (bei mehreren Einträgen alle). Nicht über das Menü schließen.
4. **Zustand sichern.** In PowerShell 7 im Repository-Ordner, ProjectA noch
   geschlossen:
   `pwsh scripts/drills/crash-drill.ps1 -Phase before -Transition process-starting -AppVersion 1.5.0 -OutDir C:\Belege\crash-vorher`
   Erlaubt für `-Transition`: claimed, intent, process-starting, input-delivery,
   checkpoint, completion. Erwartet: eine Zeile `OK`, `Ergebnis: pass`.
5. **ProjectA neu starten** und etwa 2 Minuten warten, bis die App ruhig ist.
   Niemanden einen neuen Lauf starten lassen.
6. **Prüfen.**
   `pwsh scripts/drills/crash-drill.ps1 -Phase after -BeforeDir C:\Belege\crash-vorher -AppVersion 1.5.0 -OutDir C:\Belege\crash-nachher`
   Erwartet: zwei Zeilen `OK` und `Ergebnis: pass`. Bei `FEHLER` beide Ordner
   behalten und melden.
7. **Beleg:** `crash-nachher` enthält `manifest.json`, Zustand vorher/nachher
   und Prozessliste, alles geschwärzt. Wiederhole 2–6 für jeden Übergang in
   einem neuen, leeren Ordner.

Nicht abgedeckt: echter Stromausfall, Übergänge ohne Continuous, Zeitverlauf
der Wiederherstellung (nur ein Schnappschuss).
