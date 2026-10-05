# Drill-Runbook: die PC-Gates für v1.5.0 (Beta) und v1.5.1

Das ist deine Einstiegsseite für W3-03 (paketierte Drills), W3-07 (signierter
Updater-Relaunch) und W3-08 (HQ-Beleg), siehe `docs/PLAN.md` (R-1-Voraussetzungen).
Jeder Drill hat eine eigene Seite mit allen Schritten. Hier steht nur die
Reihenfolge und was du vorher wissen musst. Befehle stehen nur auf den
Drill-Seiten, nicht hier.

## Vorher

- Nimm die **installierte** ProjectA-Version, nicht den Quellcode. Der
  Singleton-Drill sagt das ausdrücklich; Not-Aus, HQ-Beleg und Updater
  verlangen ebenfalls die installierte App.
- Du brauchst auf dem Windows-PC: PowerShell 7, Node 24, dieses Repository
  und bei einigen Drills den Befehl `pa` im Pfad (oder `-Pa <Pfad>`).
- Schließe alle anderen ProjectA-Fenster. Beende ProjectA im Tray, wenn die
  Drill-Seite es verlangt (Backup, Singleton).
- Freien Speicherplatz und RAM nennen die Drill-Seiten nicht. Sorge für
  Luft; der RAM-Druck-Drill belegt absichtlich eigenen Speicher.
- **Version notieren:** In ProjectA „Info" öffnen, Versionsnummer merken. Jeder
  Drill fragt sie als `-AppVersion` ab. Die Zahl in den Beispielen ist nur ein
  Beispiel: nimm deine echte.
- **Beleg-Ordner:** Mit `-OutDir` bestimmst du ihn (die Beispiele nutzen
  `C:\Belege\<name>`). Ohne `-OutDir` entsteht ein Ordner mit Zeitstempel im
  aktuellen Ordner. Er muss neu oder leer sein, sonst bricht der Drill ab.
- Bei `FEHLER`: Ordner **nicht löschen**, melden.

## Reihenfolge

„Frei" heißt: Der Orchestrator hat „Drills frei" gemeldet (W3-02i gemergt).
Vorher nur die Zeilen mit „nein".

| Nr | Drill | Beweist (Matrixzeile) | Datei | Minuten | Produktionsschlüssel | Erst nach „Drills frei" |
|----|-------|-----------------------|-------|---------|----------------------|-------------------------|
| 1 | Singleton | läuft nur einmal, Sitzungen überleben Absturz (25) | [singleton-drill.md](singleton-drill.md) | ca. 10 | nein | nein |
| 2 | Not-Aus | alle Worker in 10 s beendet (20) | [estop-drill.md](estop-drill.md) | ca. 5 | nein | nein |
| 3 | Absturz | nach hartem Abbruch „reconciling" (21) | [crash-drill.md](crash-drill.md) | ca. 10 je Übergang | nein | nein |
| 4 | RAM-Druck | weniger neue Arbeit bei knappem RAM (10) | [capacity-drill.md](capacity-drill.md) | ca. 10 | nein | nein |
| 5 | Provider | Anbieter, Modell, Verbrauch ehrlich (11, 12) | [provider-drill.md](provider-drill.md) | ca. 15 je Anbieter (3) | nein | nein |
| 6 | Backup | Sicherung wieder lesbar (22) | [backup-drill.md](backup-drill.md) | ca. 5 | nein | **ja** |
| 7 | Updater (W3-03e, W3-07) | Update ok / abbrechen / scheitern (23) | [updater-drill.md](updater-drill.md) | ca. 10 je Fall (3) | **ja**, nur für W3-07 | **ja** |
| 8 | HQ-Beleg (W3-08) | HQ v1 in der installierten App | [hq-proof-drill.md](hq-proof-drill.md) | 1–3 Stunden | nein | nein |

Die Spalte „Erst nach Drills frei" für die Drills 1–5 und 8 ist meine
Ableitung: Die Drill-Seiten nennen W3-02i nur bei Backup (Wartungsmodus) und
Updater (Wiederherstellungs-Journal). Im Zweifel frag den Orchestrator.

## W3-07: signierter Updater-Relaunch

Die Schritte stehen im [Updater-Drill](updater-drill.md); der Abschnitt
„Nicht abgedeckt (bleibt offen)" dort nennt W3-07 als dein Teil: Signatur-Prüfung
und echtes Release-Update gehen erst mit einem **signierten Build**. Den Build
liefert der Orchestrator. Der bestehende Updater-Schlüssel bleibt (E4 in
`docs/PLAN.md`).

**Der Produktionsschlüssel kommt nie in einen Chat, nie in eine Datei im
Repository und nie in ein Log.** Du brauchst ihn für die Drills nicht
einzutippen. Fragt dich ein Skript, ein Agent oder jemand anderes danach:
aufhören und melden.

## W3-08: HQ-Beleg

Siehe [hq-proof-drill.md](hq-proof-drill.md). Du gibst der installierten App drei
kleine Aufgaben (Vorlagen: [`docs/vorlagen/aufgaben.md`](../vorlagen/aufgaben.md)),
folgst ihnen im HQ, machst fünf Bildschirmfotos und lässt die PRs über die Queue
landen. Das Skript läuft zweimal (vorher, nachher).

## Sichtprüfung: Umgebung der Agenten

Öffne „Einstellungen" → „Allgemein" → „Umgebung der Agenten" (PR #442). Es gibt
drei Auswahlpunkte: „Streng (empfohlen)", „Erlaubnisliste" und „Erbt alles
(schwächste Stufe)". Prüfe: Sieht der Block ordentlich aus, ist der Text lesbar
und passt nichts über den Rand? Ein Bildschirmfoto hilft. Stelle danach die
Auswahl wieder auf „Streng (empfohlen)".

## Was du mir danach schickst

Pro Drill den **Beleg-Ordner**, mindestens die Datei `manifest.json` (Schritte,
Exit-Codes, Ergebnis, Nicht-abgedeckt). Dazu je nach Drill:

- Singleton: die drei Screenshots.
- Updater: `angezeigt.txt` und alle drei Fall-Ordner.
- HQ-Beleg: `hq-nachher` (mit `ids-new.json`, `screenshots/`); die Bilder sind
  nicht geschwärzt, prüfe sie vorher auf Privates.
- Provider: pro Anbieter ein Ordner, ohne `provider-drill-work`.
- Backup: **nie** den Unterordner `backup` (volle Datenbank mit Tokens).

Nie senden: Token, Schlüssel, `projecta-api.json`, E-Mail-Adressen, Kontonamen.
Texte sind geschwärzt; lies sie trotzdem einmal durch.

## NICHT ABGEDECKT / offene Widersprüche

- Die Drill-Seiten widersprechen sich bei den Beispiel-Versionen: `1.4.1`
  (Backup, Singleton, Absturz, Not-Aus, Provider), `1.5.0` (RAM-Druck, HQ-Beleg), `0.9.0`/`0.9.1` (Updater, `-OldVersion`/`-NewVersion`).
  Nicht aufgelöst: nimm die Zahl aus „Info"; beim Updater frag, was für
  `-OldVersion`/`-NewVersion` gilt.
- Absturz-Drill (21) und RAM-Druck-Drill (10) brauchen Continuous AN; das ist
  bis M4 gesperrt. Ohne Continuous sind beide „nicht abgedeckt" bzw. „nur
  Beobachtung", Zeile 10 bleibt offen.
- Der Auftrag nannte die Zeilen 10, 11, 12, 20, 22, 23, 25; Zeile 21 (Absturz)
  steht zusätzlich in der Tabelle, weil es die Drill-Seite gibt.
- Not-Aus: Der `--verdict-token` für `pa estop off` wird auf der Drill-Seite
  nicht erklärt; woher du ihn bekommst, ist offen.
- `docs/ci-lokal.md` enthält keine Drill-Befehle, nur die Abgrenzung, dass die
  Gates den Quelltext belegen, nicht die installierte App (W3-08).
- Windows-Lauf nur auf deinem PC; kein Linux-Beleg.
