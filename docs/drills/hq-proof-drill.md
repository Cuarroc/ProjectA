# HQ-v1-Beleg (W3-08, M3-Abnahme)

Du gibst der **installierten** App drei echte kleine Aufgaben, folgst ihnen im
HQ, prüfst den Diff in der App und siehst die PRs über die Queue landen. Das
Skript sammelt dabei nur Belege (lesend über `pa hq runtime` und
`pa hq context`; keine Datenbank, kein HTML). Dauer: je nach Aufgaben 1–3 Stunden,
das Skript selbst braucht je Lauf unter einer Minute.

Voraussetzung: ProjectA (installierte Version), PowerShell 7, Node 24, dieses
Repository, `pa` im Pfad (oder `-Pa <Pfad>`). Die Aufgaben-Vorlagen stehen in
[`docs/vorlagen/aufgaben.md`](../vorlagen/aufgaben.md). Die Projekt-ID zeigt
das HQ oder `pa hq runtime`. Agenten starten die App nie; das tust nur du.

1. **Version notieren.** App starten, „Info" öffnen, Versionsnummer merken
   (unten `1.5.0-beta` als Beispiel).
2. **Vorher-Lauf.** Bei laufender App in PowerShell 7 im Repository-Ordner:
   `pwsh scripts/drills/hq-proof-drill.ps1 -Phase before -Project <ID> -AppVersion 1.5.0-beta -OutDir C:\Belege\hq-vorher`
   Erwartet: zwei Zeilen `OK`, `Ergebnis: pass`. Der Zielordner muss neu oder leer sein.
3. **Drei Aufgaben geben.** Nimm die drei Vorlagen (Fehler mit Test, Text in der
   Oberfläche, Doku-Abschnitt) und gib sie in der App an Agenten.
4. **Im HQ folgen.** Öffne das HQ und sieh zu, wie jede Aufgabe läuft. Notiere
   dir Uhrzeit und Ergebnis.
5. **Diff prüfen.** Öffne je Aufgabe den Diff in der App; er soll zur Vorlage
   passen.
6. **Bildschirmfotos machen** (Fenster 1280×800 oder größer) und in **einem
   Ordner**, z. B. `C:\Belege\hq-bilder`, mit genau diesen Namen speichern:
   - `hq-hell-komfortabel.png` — HQ im hellen Modus, Dichte „Komfortabel"
   - `hq-hell-kompakt.png` — HQ hell, Dichte „Kompakt"
   - `hq-dunkel-komfortabel.png` — HQ dunkel, „Komfortabel"
   - `hq-dunkel-kompakt.png` — HQ dunkel, „Kompakt"
   - `diff-in-app.png` — der Diff einer der drei Aufgaben in der App

   Schau sie dir an: Text lesbar, und „Kompakt" zeigt sichtbar mehr Zeilen.
7. **PRs landen lassen.** Der Koordinator reiht sie in die Queue ein. Warte, bis
   alle drei auf GitHub als „Merged" stehen.
8. **Nachher-Lauf.** App läuft noch:
   `pwsh scripts/drills/hq-proof-drill.ps1 -Phase after -Project <ID> -AppVersion 1.5.0-beta -Before C:\Belege\hq-vorher -Screenshots C:\Belege\hq-bilder -OutDir C:\Belege\hq-nachher`
   Fehlt eine PR-Adresse in der Ausgabe, gib sie mit `-Pr <URL>` an (mehrfach möglich).
   Erwartet: vier Zeilen `OK`, `Ergebnis: pass`. Bei `FEHLER` den Ordner nicht löschen und melden.
9. **Beleg prüfen.** In `hq-nachher` liegen `manifest.json` (Version, Zeiten,
   Schritte, Exit-Codes, Ergebnis, Nicht-abgedeckt), `ids-new.json` (neue
   Aufgaben-/Lauf-IDs und PR-Adressen), die geschwärzten `pa`-Ausgaben,
   `processes.txt` und `screenshots/`. Die Bilder sind **nicht** geschwärzt:
   prüfe sie auf Privates, bevor du sie weitergibst.

Nicht abgedeckt: ob die Bilder wirklich gut lesbar sind (das siehst nur du), ob die
PRs wirklich gemergt sind (das zeigt GitHub), und die Qualität der Diffs.
