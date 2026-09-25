# W1-25: die SQLite-Lastklasse in CI (zwei Tests)

Status: historisch

Abgeschlossen: gemergt mit PR #77 (Zeile in `docs/ERLEDIGT.md`); diese Spec ist nur noch Beleg.

> **Notiz (Agent, `claude/w1-25-sqlite-load`):** Auftrag bearbeitet, Ursache
> benannt und Fix vorhanden — Details in `.pa/report_w1-25.md`. Status bleibt
> `entwurf` stehen: die Aktivierung braucht laut Vertrag einen
> STAND.md-Eintrag, und STAND.md ist für diese Lane tabu (PR #70). Der
> Koordinator setzt `Status: aktiv`/`historisch` und den STAND.md-Eintrag.

Angelegt 2026-09-21 aus einem CI-Befund, nicht aus dem Plan-Schnitt. Kein
Auftrag, solange er hier `entwurf` steht; wer ihn aufnimmt, setzt ihn auf
`aktiv` und traegt ihn in STAND.md unter „Aktive Specs" ein.
Groesse: S. Lane: `store.rs` (Nahtstelle — nur in der eigenen Lane).

## Der Befund

Der Befund ist **nicht neu** — er stand vor dieser Spec schon in `STAND.md`
unter „Bewusst offene Produktbefunde", und zwar als **Klasse mit zwei Faellen**.
Diese Spec macht daraus einen Auftrag, sie entdeckt nichts.

Fall 1, `gates (linux)` rot auf **`main`** im Push-Lauf zu `4e409d9`
(Run 35288206709, 17.09.2026):

```
store::continuous::tests::stale_fence_cannot_complete_claim_and_expiry_does_not_reclaim
panicked at src/store/continuous.rs:1359:18:
called `Result::unwrap()` on an `Err` value:
"write continuous checkpoint: error returned from database: (code: 5) database is locked"
```

`gates (windows)` war im selben Lauf gruen. Also lastabhaengig: der Test
faellt ueber einen SQLITE_BUSY im eigenen Fixture, nicht ueber die Logik.
Das ist **kein** Fehler eines der offenen PRs — er lag auf `main`.

Fall 2, dieselbe Klasse, anderer Test:
`workers::tests::an_agent_that_exits_during_respawn_is_not_revived_as_running`
(Linux, Run 35025975338, `pool timed out`, 15.09.2026).

**Wichtiger Hinweis zur Ursachensuche:** PR #60 hat einen Last-Flake derselben
Herkunft an anderer Stelle behoben — die Route-Fixture gab dem Kandidaten 60 s
gegen die *Wanduhr*, waehrend ein zweiter Cargo-Lauf auf demselben Target 190 s
brauchte; der Fix war eine Frist von 3600 s und ein stabiler Zeitstempel, kein
Datenbankparameter. Bevor hier an `busy_timeout` gedreht wird, also zuerst
pruefen, ob der geteilte `CARGO_TARGET_DIR` und die parallelen Laeufe auch
diese zwei Faelle erklaeren.

## Vertrag

- Ursache benennen: welcher zweite Schreiber haelt die Sperre, und warum
  wartet der erste nicht (fehlender `busy_timeout`? zwei Verbindungen auf
  dieselbe Datei? ein nicht abgeschlossener Schreibvorgang aus einem
  vorherigen Schritt desselben Tests?).
- Fix im Fixture oder in der Verbindungskonfiguration, nicht im Test-Ablauf;
  ein `sleep` oder ein Retry im Testkoerper ist keine Loesung, sondern eine
  zweite Sorte Flake.

## Abnahme

- **Beide** Tests laufen unter Last wiederholt gruen (z. B. `cargo nextest run
  --test-threads=<n>` mit ausgelasteter Maschine, Anzahl der Laeufe im Report
  genannt) **und** die Ursache steht im Report mit Datei:Zeile.
- Abwesenheit eines roten Laufs allein genuegt nicht: ohne benannte Ursache
  bleibt der Befund offen, wie bei W1-04 beschrieben.

## Regeln

- Nahtstelle `store.rs`: nur, wenn die Lane frei ist (derzeit haelt sie
  niemand; W1-16 ist die naechste geplante).
- Keine `--no-verify`, Exit-Codes ungemaskiert.

## Abschluss

Report `.pa/report_w1-25.md`, diese Datei auf `Status: historisch`, Haekchen in
`docs/PLAN.md`, Zeile aus STAND.md „Aktive Specs" entfernen.
