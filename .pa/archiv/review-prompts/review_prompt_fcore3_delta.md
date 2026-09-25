# Delta-Review: F-CORE-3 Spec Rev 2 gegen die Disposition

## Kontext

Du hast die Rev 1 dieser Spec reviewed (dein Review: `.pa/review_fcore3_claude.md`,
Befunde S-01…S-12). Die Disposition liegt in `.pa/review_fcore3_disposition.md`;
die revidierte Spec ist `.pa/task_f_core3_delivery.md` (**Rev 2**, `Status:
entwurf`). Dies ist die vereinbarte kurze Gegenrunde: **ein** Reviewer,
Delta-Sicht.

## Dein Auftrag — zwei Prüfrichtungen, mehr nicht

**1. Dispositions-Abgleich.** Gehe die neun Konsens-Punkte und die
Einzelbefunde der Disposition durch und prüfe je: in Rev 2 korrekt umgesetzt /
teilweise / nicht umgesetzt. Beleg je mit Zeile aus der Rev 2. Verlasse dich
nicht auf die Behauptung der Tabelle im Autorenbericht — miss an der Datei.

**2. Regressions-Suche.** Was hat die Revision neu verschlechtert oder
eingeführt? Prüfe gezielt:
- Sind die neuen Formulierungen intern konsistent (Bausteine A/B/C,
  Dateigrenzen, Abnahme-Kriterien widersprechen sich nicht)?
- Stimmen die neuen Code-Zeilenangaben noch (Stichproben an
  `submit_guard.rs`, `pty.rs`, `main.rs`, `questions.rs`, `profiles.rs`)?
- Hat die Revision einen der drei ursprünglichen, als korrekt bestätigten
  roten Tests verwässert?

## Ausgabeformat (exakt einhalten)

DISPOSITIONS-ABGLEICH: <Tabelle: Punkt → umgesetzt|teilweise|nicht + Zeile>

REGRESSIONEN: <Liste oder „keine">

URTEIL FÜR REV 2: <ausführbar-nach-Aktivierung | erneut überarbeiten>

Nur lesen, nichts verändern. Auf Deutsch, knapp.
