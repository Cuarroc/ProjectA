# Protokoll ProjectA-Lauf (Telemetrie-Abzug)

> Ein Bogen je Lauf (Task × Lauf-Nr.). Datenquellen laut Design §3.2:
> `usage_events` (gefiltert!), `workers`, `status_events`, F8-Harness-Log,
> git direkt. „nicht gemessen" eintragen statt schätzen.

## Kopf

| Feld | Wert |
|---|---|
| Datum | |
| Projekt-ID / Worker-ID | |
| Branch / Worktree | |
| Task | T1 / T2 / T3 / T4 / T5 |
| Lauf-Nr. (1–3) | |
| Agenten-CLI + Modellversion (eingefrorener Stand) | |
| Basis-SHA (B0) | `4f7bfeacd1b42c3ca336f05ceaeff7389b1a7c23` |
| ProjectA-Commit-Stand | |

## Zeiten

| Feld | Wert |
|---|---|
| Spawn-Zeit (Queue/Spawn, ts) | |
| Ende (Merge-Commit oder Archivierung, ts) | |
| Aktive Bedienzeit (Harness-UI-Log bzw. Bildschirmaufzeichnung, min:s) | |
| Interaktionen gezählt (Quelle: Harness / Aufzeichnung) | |

## Tokens (Attribution per Zeitkorrelation — Unsicherheit ausweisen!)

Filter zwingend: `model != 'connection-test'` (97,6 % Poller-Rauschen,
Baseline-Nebenbefund 2). `profile_id` ist NULL — Zuordnung über
Ledger-`ts` im Lebensfenster des Workers.

```sql
SELECT ts, provider, model, tokens_in, tokens_out
FROM usage_events
WHERE model != 'connection-test'
  AND ts BETWEEN '<spawn-ts>' AND '<ende-ts>'
ORDER BY ts;
```

| Summe tokens_in | Summe tokens_out | Modelle im Fenster | Unsicherheit der Zuordnung (±, Begründung) |
|---|---|---|---|
| | | | |

## Worker-Endzustand

```sql
SELECT id, status, merge_state FROM workers WHERE id = '<wk-...>';
```

| status | merge_state | Ausgang abgeleitet (gemergt / verworfen = archived ohne merge_state) |
|---|---|---|
| | | |

## Konflikt (nur T3)

| Feld | Wert |
|---|---|
| `git merge-tree --write-tree main <worker-branch>` Ausgabe | |
| Zeitstempel Konflikt sichtbar (Harness-Log) | |
| Zeitstempel Auflösungs-Commit | |
| Finaler Tree-OID == T3_TREE (`7102dc781e99bd1b3e005708a3d274eb476d1ae9`)? | ja/nein |

## Merge / Evidence

| Feld | Wert |
|---|---|
| Merge-Commit-SHA | |
| review_evidence (approval_source, Diff-Tupel) | |
| T4: zwei Evidence-Sets vorhanden? Merge erst nach zweiter Freigabe? | |

## Akzeptanz-Check (Kommandos siehe benchmark/README.md, Task-Tabelle)

```
<Befehl und reale Ausgabe hier einfügen>
```

## Ungültig nach §5.6?

| Grund | ja/nein + Beschreibung |
|---|---|
| | |

## Auffälligkeiten

-
