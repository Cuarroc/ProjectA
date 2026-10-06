# ProjectA testen – Anleitung für Beta-Tester

Danke, dass du ProjectA ausprobierst! Diese Seite führt dich in etwa einer
halben Stunde durch die wichtigsten Funktionen der aktuellen Version `v1.5.1`
und erklärt, wie du deine Beobachtungen meldest.

## Installation

1. Lade den Installer `ProjectA_<Version>_x64-setup.exe` von der
   [Release-Seite](https://github.com/Cuarroc/ProjectA-updates/releases/latest)
   herunter und führe ihn aus (nur Windows).
2. Spätere Updates kommen über den eingebauten, mit Minisign signierten
   Updater – du musst nichts erneut herunterladen.
3. Installiere mindestens eine Agent-CLI (zum Beispiel Claude Code oder Codex
   CLI) und melde dich dort an. ProjectA bringt kein eigenes KI-Modell und
   keine Anbieterzugänge mit; es steuert die Werkzeuge, die du schon nutzt.

## Was du ausprobieren kannst

Jeder Punkt ist ein kurzer Klickweg in der installierten App:

1. **Projekt hinzufügen:** Links unter „Projekte“ auf „+“ klicken und ein
   beliebiges Git-Repository von deiner Festplatte auswählen.
2. **Worker starten:** Auf „Neuer Worker“ klicken, eine kleine Aufgabe
   beschreiben (zum Beispiel „Erstelle eine Datei hallo.txt mit einer Zeile
   Text“) und ein Agenten-Profil wählen.
3. **Zusehen:** Den Fortschritt auf dem Board verfolgen, das Terminal des
   Workers öffnen und danach seine Änderungen in der Diff-Ansicht ansehen.
4. **Not-Aus testen:** Während ein Worker läuft den Not-Aus auslösen – alle
   Agenten werden binnen zehn Sekunden beendet und neue Aufträge sind
   blockiert, bis du ihn wieder löst.
5. **Budget und Rollen ansehen:** In den Einstellungen die Budgetgrenzen und
   die Rechte je Rolle durchsehen.
6. **Learnings freigeben:** Wenn ein Agent etwas über dein Projekt gelernt hat,
   erscheint es unter Learnings – es wird erst wirksam, wenn du es freigibst.
7. **Neustart-Probe:** Die App schließen und wieder öffnen – Verlauf und
   Entwürfe deiner Sitzungen bleiben erhalten.

Deine installierte Version findest du in der App unter „Info“.

## Was absichtlich ausgeschaltet ist

Der automatische **Dauerbetrieb** (Continuous Mode, Agenten holen sich selbst
Folgearbeit) ist in v1.5.1 ausgeschaltet und lässt sich nicht per Einstellung
freischalten. Das ist Absicht: Er wird erst freigegeben, wenn seine Abnahme
vollständig belegt ist – und nur durch den Menschen, nie durch einen Agenten.
Ein Linux- oder macOS-Paket gibt es nicht.

## Wie du meldest, was dir auffällt

Öffne im Repository ein
[neues Issue](https://github.com/Cuarroc/ProjectA/issues/new/choose) und wähle
die Vorlage **„Tester-Feedback“**. Sie fragt dich: Was hast du gemacht? Was
hast du erwartet? Was ist passiert? Dazu deine Versionsnummer aus „Info“ –
mehr braucht es nicht. Ein Screenshot hilft, ist aber freiwillig; achte dann
darauf, dass keine Zugangsdaten oder persönlichen Daten zu sehen sind.

ProjectA ist ein persönliches Projekt ohne Support-Zusage: Es kann dauern, bis
jemand antwortet. Bekannte Befunde: [`KNOWN_ISSUES.md`](../KNOWN_ISSUES.md).
Tiefergehende Prüfabläufe: [`docs/drills/`](drills/README.md).
