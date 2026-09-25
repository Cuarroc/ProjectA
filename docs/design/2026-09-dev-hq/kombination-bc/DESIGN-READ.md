# Kombination B + C — Werkbank mit Messpult

## Leitidee

Diese Richtung verbindet C als Arbeitsmodell mit B als Messmodell. Die
Übersicht zeigt die nächste Entscheidung und die belegten Engpässe. Agenten-
Teams erhalten einen eigenen Arbeitsbereich, in dem Rollen, Ablauf, Effort und
Provider-Grenzen gemeinsam sichtbar sind. Statistiken stehen in einem eigenen
Tab, damit Kennzahlen nicht die operative Arbeit überlagern.

## Was sich gegenüber den Einzelrichtungen ändert

- Die lange Einzelansicht wird durch fünf Tabs ersetzt: Übersicht,
  Agenten-Teams, Statistiken, Belege und System.
- Jede Ansicht hat eine feste Arbeitsfläche; nur der jeweilige Inhaltsbereich
  scrollt. Auf kleinen Breiten stapeln sich die Spalten.
- Abschnittsgrenzen entstehen durch eine einheitliche Kopfzeile, Haarlinie,
  Abstand und einen klaren Hintergrundschritt. Karten gruppieren nur Inhalte,
  die gemeinsam gelesen oder bedient werden.
- Zahlen tragen Einheit, Zeitraum und Messstatus. Beispielwerte sind als Demo
  markiert; nicht abgefragte, leere und fehlgeschlagene Zustände bleiben
  verschieden.

## Interaktion

Die Tab-Leiste verwendet `role=tablist` und `role=tabpanel`. Klick, Pfeil links/
rechts, Pos1 und Ende wechseln den Bereich; der Hash macht einen Tab direkt
verlinkbar. Die Teamliste setzt genau eine Vorlage aktiv. „Vorlage bearbeiten"
öffnet einen Dialog und ändert nur den Vorschauzustand. Die Zeitraumauswahl
ändert die dargestellte Beispieldatenreihe, ohne eine Live-Abfrage vorzutäuschen.

## Designsystem

Die selbständige HTML-Datei nutzt eine dunkle, grünlich-blaue Arbeitsfläche,
helle Primärschrift, gedämpfte Sekundärschrift sowie Mint, Amber, Rot und Blau
für Zustände. Alle Zahlen verwenden tabellarische Ziffern; Pfade und IDs stehen
in einer Monospace-Schrift. Fokus, Auswahl, Caret und Scrollbar sind explizit
gestaltet. Es gibt keine Netzwerkanfragen und keine externe Schrift.

## Kosten und Grenzen der Umsetzung

Als statischer Prototyp ist die Richtung eine einzelne Datei. Für die echte
Live-Ansicht müssen Tabs an die vorhandenen HQ-Payloads gebunden werden,
Teamvorlagen ein API- und Persistenzmodell erhalten und die Statistikdaten ihre
Quellen sowie Fehlerzustände aus der Control-API beziehen. Die Provider-Grenzen
bleiben sichtbar: Skills sind im Projektpfad für Claude und Kimi unterstützt,
für Codex und OpenCode nicht. Kosten dürfen wegen der fehlenden
Projekt-Dimension im Ledger nicht pro Team behauptet werden.

## Offenes Risiko

Die visuelle Abnahme der lokalen Vorschau konnte in dieser Sitzung wegen der
Browser-Nutzungsgrenze nicht erneut durchgeführt werden. Der Entwurf wurde
syntaktisch geprüft und die Teamansicht war zuvor im Browser sichtbar. Vor einer
Produktionsintegration sind Screenshots bei 1280×800 und 1024×768 sowie eine
Bedienprüfung der fünf Tabs erforderlich.
