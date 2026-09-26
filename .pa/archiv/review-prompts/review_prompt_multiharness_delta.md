# Delta-Review: Multi-Harness Spec Rev 2 gegen die Disposition

Du hast Rev 1 dieser Spec reviewed (dein Review: `.pa/review_multiharness_deepseek.md`,
Befunde H-01…H-09). Disposition: `.pa/review_multiharness_disposition.md`;
revidierte Spec: `.pa/task_multi_harness.md` (Rev 2, `Status: entwurf`). Kurze
Gegenrunde, ein Reviewer, Delta-Sicht.

## Zwei Prüfrichtungen

**1. Dispositions-Abgleich.** Die 13 Konsens-Punkte: je umgesetzt / teilweise /
nicht, Beleg mit Zeile aus Rev 2. Miss an der Datei, nicht am Autorenbericht.

**2. Regressions-Suche.** Was ist neu schlechter oder neu falsch? Gezielt:
- Das neue Build-Zeit-Attestat: ist die Fingerabdruck-Mechanik in sich
  konsistent (wer erzeugt, wer prüft, wann)? Der Autor warnt selbst: der
  Generator-Test muss die gehashte Feldliste pinnen, sonst neue stille Lücke.
  Ist das in der Spec verankert?
- Stimmen neue Zeilenangaben noch (Stichproben in `profiles.rs`,
  `submit_guard.rs`, `hooks.rs`, `pty.rs`, `status.rs`, `oneshot.rs`,
  `scout.rs`)?
- Wurde ein als tragfähig bestätigter Teil der Rev 1 verwässert (Lane-
  Zuordnungen, „Default = heutiges Verhalten", Einschränkung als Default)?

## Ausgabeformat (exakt)

DISPOSITIONS-ABGLEICH: <Tabelle: Punkt → umgesetzt|teilweise|nicht + Zeile>

REGRESSIONEN: <Liste oder „keine">

URTEIL FÜR REV 2: <ausführbar-nach-Aktivierung | erneut überarbeiten>

Nur lesen, nichts verändern. Auf Deutsch, knapp.
