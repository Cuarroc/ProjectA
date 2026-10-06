# Der Weg zu ProjectA 2.0

Diese Seite erklärt in einfachen Worten, was Version 2.0 werden soll und in
welcher Reihenfolge sie gebaut wird. Sie fasst den freigegebenen Plan
[`docs/plan/v2.0/plan.md`](plan/v2.0/plan.md) zusammen; bei Widersprüchen gilt
der Plan.

## Was 2.0 verspricht

ProjectA 2.0 gilt drei Versprechen: **Grün heißt bewiesen** – nichts gilt als
fertig ohne prüfbaren Beleg. **Kein Modell prüft sich selbst** – jede Änderung
prüft ein Modell eines anderen Anbieters. **Der Mensch behält die Kontrolle** –
über Kosten, Stopp und jede Freigabe.

Dafür wird die Oberfläche neu gebaut: zehn Bildschirme mit echten Daten aus dem
Rust-Kern. Ein Bildschirm ohne Datenquelle zeigt ehrlich „noch nicht
verbunden“ – nie erfundene Werte. Kern von 2.0 sind:

- die **Beweis-Schicht**: jede abgeschlossene Arbeit trägt ihren Beleg
  (Prüflauf, Exit-Code, Commit) am Ergebnis; ein neuer Commit entwertet ihn,
- der **Leitstand**: alle laufenden Agenten auf einen Blick, mit Antworten auf
  „Braucht dich“ direkt ins Terminal,
- **drei Anbieter-Wege**: Claude, Codex und ein lokales Modell als Pflicht-
  Ersatz bei Sperre oder Limit – danach gilt „Pause statt Rechnung“,
- **Kontingente und Failover**: die App prüft Limits selbst und wechselt nach
  festen Regeln,
- der **Not-Aus überall sichtbar**, wirksam binnen zehn Sekunden,
- der **Core**: eine App-KI mit klar begrenzten Rechten, die Vorbereitungen
  übernimmt, aber nie ihre eigenen Rechte erweitert,
- die **Ersteinrichtung**, die bis zum ersten laufenden Agenten führt.

## Die App in neun Bereichen

Die Seitenleiste führt durch neun Bereiche: **Leitstand** (laufende Arbeit),
**Eingang & Plan**, **Beweise**, **Team**, **Automatik**, **Core** und
**Core · Steuerung** (die App-KI und ihre Grenzen), **Gedächtnis** und
**Einstellungen**. Dazu kommt die Ersteinrichtung beim ersten Start.

Nicht alles davon gehört zum Kern. Alles außerhalb des Kerns wird zwar gebaut,
liegt aber hinter Funktionsschaltern und ist standardmäßig aus: sichtbar wird
es erst mit Freigabe durch den Nutzer – spätere 2.x-Versionen schalten es ohne
neues großes Release zu.

## Der Weg in sechs Wellen

- **Welle 0 – Fundament:** die neue Designsprache (Farben, Bewegung, Bausteine,
  Texte), unsichtbar hinter einem Schalter, dazu Architektur- und Sicherheits-
  Skizzen.
- **Welle 1 – Beweis-Schicht und Maschine:** Auftrag, Arbeit, Beweis,
  Fremdprüfung, Freigabe und Ausliefern laufen durch **einen** Zustandsautomaten;
  dazu der Kern des Core.
- **Welle 2 – Kern-Bildschirme:** Leitstand, Agent starten, Beweise und die
  übrigen Kernseiten bekommen echte Daten.
- **Welle 3 – Rest des Kerns:** Wachhund, Sicherung und Umzug, Aufzeichnung;
  die Nutzerabnahme des Kerns. Parallel erste Bildschirme hinter Schaltern.
- **Welle 4 – Release-Pfad:** Updater, Migration und die restlichen
  Bildschirme hinter Schaltern.
- **Welle 5 – Abschluss:** die Gesamtabnahme aller Kernkriterien und das
  Einfrieren des Plans.
- **Welle 6 – Nach dem Kern:** Kundenprojekte mit Datenschutz-Schleuse und die
  Fernansicht, alles hinter Schaltern.

## Die Tore

- **G0 – Plan freigegeben:** erreicht am 06.10.2026. Seitdem läuft Welle 0.
- **G-Kern – der Kern steht:** alle Kernteile erfüllt, das Sicherheitsreview
  ohne offenen schweren Befund, der Nutzer hat den Kern abgenommen.
- **Release 2.0.0:** G-Kern erreicht, die Gesamtabnahme ist grün und der Nutzer
  gibt das Release frei. Installiert wird über den eingebauten Updater.

## Kein fester Termin

Es gibt bewusst **keinen festen Termin** für 2.0. Der Durchsatz der Agenten ist
erst seit kurzem gemessen – aus den bisherigen Zahlen folgt keine ehrliche
Terminzusage. Stattdessen gilt: jede Welle und jedes Tor ist an Belege und
Abnahmen gebunden, nicht an ein Datum.

## Was 2.0 bewusst nicht ist

Kein eingeschalteter Dauerbetrieb, kein Zugang aus dem Internet, keine
Geldausgaben durch Agenten, kein Verkauf der App an Dritte. Der Dauerbetrieb
bleibt aus, bis der Nutzer ihn selbst freigibt.
