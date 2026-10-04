# RAM-Druck-Drill (W3-03f, Matrixzeile 10)

Du prüfst, ob ProjectA bei knappem Arbeitsspeicher weniger neue Arbeit annimmt:
Grenze 2 bei normal, 1 bei knapp, 0 bei kritisch; laufende Worker bleiben
unberührt. Deine Datenbank wird **nur gelesen**. Dauer: etwa 10 Minuten.

**Wichtig:** Diese Grenzen gibt es nur bei **eingeschaltetem Continuous**.
In v1.5.0 ist Continuous standardmäßig aus. Dann zeigt der Drill nur, was
gemessen wird, und der Lauf ist **kein Beleg für Zeile 10** (siehe unten).

Voraussetzung: installiertes ProjectA, der `pa`-Befehl im Pfad (sonst `-Pa <Pfad\zu\pa.exe>`), PowerShell 7, Node 24, dieses
Repository; Arbeit in mindestens zwei Projekten ist angenommen (Continuous an)
und mindestens ein Worker läuft.

1. **Version notieren.** ProjectA öffnen, „Info", Versionsnummer merken.
2. **Projekt-IDs notieren** (zwei Projekte mit Arbeit) und merken, wie viele
   Worker laufen. ProjectA bleibt offen und läuft.
3. **Fenster 1 (Messung) starten.** PowerShell 7 im Repository-Ordner:
   `pwsh scripts/drills/capacity-drill.ps1 -Project <id1>,<id2> -Continuous on -AppVersion 1.5.0 -OutDir C:\Belege\capacity-drill`
   (ohne `-OutDir` entsteht ein neuer Ordner mit Zeitstempel; der Ordner muss neu oder leer sein).
   Alle 2 Sekunden werden freier Speicher und die Kapazitätsanzeige gelesen.
4. **Fenster 2 (Druck) starten**, innerhalb von 30 Sekunden:
   `pwsh scripts/drills/memory-pressure.ps1`
   Es belegt nur eigenen Speicher, hält zwei Stufen je 60 s (knapp, dann kritisch),
   gibt alles bei Ende, Strg+C oder nach höchstens 10 Minuten wieder frei und
   fasst keinen anderen Prozess an. Erwartet: Textzeilen zu den Stufen.
5. **Während „kritisch"**: In ProjectA versuchen, neue Arbeit anzustoßen.
   Erwartet: sie wird nicht angenommen; laufende Worker laufen weiter.
6. **Warten**, bis Fenster 2 „Speicher freigegeben" meldet; die Messung in
   Fenster 1 endet nach 10 Minuten selbst (oder `-Seconds 300` für kürzer).
7. **Ausgabe lesen.** Erwartet: `OK` und `Ergebnis: pass`. Bei `FEHLER` den Ordner
   behalten und melden. Im Ordner: `manifest.json`, `samples.json`, `verdict.json`,
   `processes.txt` (alles geschwärzt; das Token verlässt das Skript nie).

## Mit Continuous aus (v1.5.0)

Starte Schritt 3 mit `-Continuous off`. Beobachtbar: freier Speicher und, falls
die Anzeige antwortet, die gemeldete Grenze. Es gibt dann keine Zusage zu
Grenze 2/1/0, keine Annahme-Prüfung und keinen Nachweis zu „kein neuer Auftrag
bei kritisch". Das Ergebnis lautet „nur Beobachtung".

## Nicht abgedeckt

- Zeile 10 ist erst mit Continuous an belegt; bei aus bleibt sie offen.
- „Messung nicht verfügbar → Grenze 1" lässt sich am PC nicht erzwingen; das
  deckt der Rust-Test in `continuous_capacity.rs`, der Drill nur zufällig.
- Die Antwortform von `pa hq context` wurde hier nicht an der installierten App geprüft;
  fehlt die Kapazitätsanzeige, steht `no capacity snapshot` im Ergebnis (rot, nie still grün).
- Der Drill zählt Arbeit über die Claim-Zahl, nicht pro Worker-Prozess.
