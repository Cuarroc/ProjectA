# Protokoll Gegner-Lauf (manueller Bogen)

> Ein Bogen je Lauf (Task × Lauf-Nr. × Gegner). Ausfüllen während und direkt
> nach dem Lauf. Aufzeichnung läuft ab Task-Anlage bis Merge/Verwurf.
> „nicht gemessen" eintragen statt schätzen (Ehrlichkeitsregel §6.4).
> Ungültige Läufe (§5.6) werden ersetzt; der Grund bleibt in diesem Bogen.

## Kopf

| Feld | Wert |
|---|---|
| Datum | |
| Gegner | Emdash / kandev |
| Gegner-Version | |
| Task | T1 / T2 / T3 / T4 / T5 |
| Lauf-Nr. (1–3) | |
| Agenten-CLI + Modellversion (eingefrorener Stand) | |
| Basis-SHA (B0) | `4f7bfeacd1b42c3ca336f05ceaeff7389b1a7c23` |
| Aufzeichnungs-Datei (Pfad im Benchmark-Ordner) | |
| Protokollant | |

## Zeiten

| Feld | Wert |
|---|---|
| Start (Task angelegt, Uhrzeit mit Sekunden) | |
| Ende (Merge-Commit oder Verwurf, Uhrzeit) | |
| Aktive Bedienzeit des Menschen (Fokus-Summe aus Aufzeichnung, min:s) | |

## Eingriffs-Log (jede menschliche Interaktion ab Task-Anlage bis Merge)

| # | Zeit | Art (Klick/Tastatur) | Aktion | Grund |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |

**Summe Interaktionen:** |

## Ergebnis

| Feld | Wert |
|---|---|
| Ausgang | gemergt / verworfen / gescheitert (§5.4 a/b/c) |
| Merge-Commit-SHA (Scratch-Repo) | |
| Verwurf-/Abbruchgrund | |
| Konflikt aufgetreten? (T3) | ja/nein |
| Zeitstempel Konflikt sichtbar → Auflösungs-Commit | → |
| Tokens in / out (Quelle: CLI-Output / Provider-Dashboard, exakte Quelle nennen) | / |
| Akzeptanzkriterium geprüft mit (Befehl + Ausgabe einfügen) | |

## Akzeptanz-Check (Kommandos siehe benchmark/README.md, Task-Tabelle)

```
<Befehl und reale Ausgabe hier einfügen>
```

## Ungültig nach §5.6?

| Grund (Harness-Bug / Provider-Ausfall / nachträgliche Änderung / Eingriff außerhalb Protokoll) | ja/nein + Beschreibung |
|---|---|
| | |

## Auffälligkeiten

-
