# Paketgrößenregel — ursprünglicher Vorschlag

Unveränderter Text aus [`docs/plan/v2.0/plan.md`](https://github.com/Cuarroc/ProjectA/blob/653db64985563c8a3e1603cd6d30906648ada41d/docs/plan/v2.0/plan.md#L641-L684),
Basis `653db64985563c8a3e1603cd6d30906648ada41d`, Zeilen 641–684.
Die damaligen Antworten bleiben in [Abschnitt 7](../../plan/v2.0/plan.md#7-entscheidungs-inbox-eine-gebündelte-liste-11-fragen);
dieser Archivort ändert ihren Status nicht. Maßgeblich ist heute [AGENTS.md, Regel 1](../../../AGENTS.md#the-ten-core-rules).
Der relative Link `size-evidence.md` im Original bezieht sich auf die [Belegdatei im ursprünglichen Verzeichnis](../../plan/v2.0/size-evidence.md).

## 6. Vorschlag: Paketgrößenregel

**Heute** (AGENTS.md, Regel 1): höchstens 300 Diffzeilen einschließlich Tests, für alle Pakete gleich.

**Befund.** Rechenweg, Befehle und Grenzen: [`size-evidence.md`](size-evidence.md). Stichprobe: 301 gemergte PRs vom 25.09. bis 05.10.2026 (10 Tage), dazu 28 ohne Merge geschlossene (240 Queue-Entwürfe ausgenommen).

| Größe (Diffzeilen, roh) | gemergt | Folge-Fix binnen 72 h (streng) | ohne Merge geschlossen | Median offen → Merge | p90 |
|---|---|---|---|---|---|
| ≤ 150 | 168 | 4 (2 %) | 12 (7 %) | 1,1 h | 3,0 h |
| 151–300 | 84 | 0 | 6 (7 %) | 1,2 h | 3,0 h |
| 301–600 | 27 | 0 | 7 (21 %) | 1,5 h | 32,3 h (netto 5,5 h) |
| 601–1200 | 4 | 0 | 0 | 0,9 h | 4,3 h |
| > 1200 | 18 | 1 | 3 (14 %) | 4,1 h | 140 h |

| Typ | gemergt | Folge-Fix (streng) | ohne Merge geschlossen |
|---|---|---|---|
| nur Doku | 53 | 4 | 0 |
| Frontend (`src/`) | 40 | 0 | 6 |
| Rust | 120 | 0 | 12 |
| Rust + Frontend | 7 | 0 | 3 |
| `scripts/` und `.github/` | 77 | 1 | 5 |
| übrige (keiner der Typen oben) | 4 | 0 | 2 |

**Was die Zahlen sagen und was nicht.**
- 84 % der PRs halten die 300 schon ein (Median 124 Zeilen). Die Regel bremst heute wenig.
- Zwischen ≤ 300 und 301–600 gibt es **keinen belegten Qualitätsunterschied**, aber auch keinen Beleg dagegen: Folge-Fixes sind selten (fünf Fälle: #463, #284, #266, #208, #38), der Bereich 301–600 hat 27 PRs, 601–1200 nur 4. Aus fünf Fällen lässt sich kein Größeneffekt ablesen.
- Das Schließen ohne Merge liegt bei 301–600 höher (21 % von 7 Fällen gegenüber 7 %): ein Hinweis, kein Beweis.
- Die Wartezeit hängt kaum an der Größe (Median rund 1 h über alle Stufen); die Ausreißer im p90 sind große Importe und erzeugte Dateien.
- **Nicht gemessen:** Review-Runden je PR (ein API-Aufruf je PR; nicht ausgeführt), rote Queue-Läufe je Größe (der `ci`-Workflow zeigt kein Ereignis `merge_group`, die Queue läuft über Zweige `mergify/merge-queue/*`), Seam-PRs getrennt nach Größe (63 Seam-PRs, Median 185 Zeilen, keine Auffälligkeit).
- Die breite Suche nach „Fix-PRs“ (Titel mit fix, gemeinsame Datei) trifft 49 bis 64 % und ist unbrauchbar; verwendet ist nur die strenge Zuordnung (Paket-ID oder Branch-Stamm), die eine Untergrenze liefert.

**Vorschlag.** Größe nach Art und Stufe, gemessen **netto** (ohne erzeugte Dateien: `docs/dev-hq/data.*`, Lockfiles, `*.snap`, Fixtures; Verschiebungen zählen einfach):

| Art | Grenze (netto, mit Tests) | Begründung |
|---|---|---|
| Nahtstelle, Sicherheit, PTY, Datenbank (Stufe A) | 300, wie heute | Zwei Fremd-Reviews je Paket; der Seam-Median liegt mit 185 darunter; hier hilft Kleinheit der Prüfung |
| Rust und Skripte ohne Naht (Stufe B) | 400 | Kein Beleg für Nachteile oberhalb 300; kleine Lockerung |
| Nur Frontend (`src/`, keine Naht, Stufe B) | 600 | Ein Bildschirm ist ein Stück (Board 471 bis 1527 Zeilen); Schnitte durch ein Bild erzeugen halbe Oberflächen; Frontend hatte in der Stichprobe 0 Folge-Fixes bei 40 PRs |
| Doku, Tests, Snapshots, Konfiguration ohne Laufzeitwirkung (Stufe C) | keine Zeilengrenze; lesbar bleiben (Plan < 600 Zeilen) | Prüfung sind die Gates |

Mit der Frontend-Grenze 600 sinkt die Zahl der reinen Frontend-Pakete etwa auf die Hälfte (Zählung nach beiden Regeln: Abschnitt 3.14). Das ist eine Schätzung; das erste Paket misst die tatsächliche Umrechnung von Boardzeilen in Diffzeilen.

**Absicherung.** Probe über zwei Wochen, gemessen durch `node scripts/dev/bench-weekly.mjs` (BENCH-01): Steigt der Anteil der Fix-PRs binnen 72 h bei den größeren Paketen über 8 % (Ziel aus v1.6.0, Abschnitt 7a), kehrt die Regel zurück. Jedes Paket über der Grenze braucht einen Satz „Warum nicht geteilt“ im PR. Die Änderung selbst ist **nicht** in diesem PR: Sie wird das Paket V2-RULE1, das erst nach Freigabe von D3 startet.

Ende des unveränderten Originalblocks.
