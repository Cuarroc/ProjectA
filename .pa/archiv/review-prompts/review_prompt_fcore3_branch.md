# Code-Review: Branch fix/f-core-3 (F-CORE-3 Baustein A + B.1)

## Kontext

Du reviewst den Branch `fix/f-core-3` im Repo <repo-root> —
die Implementierung der Spec `.pa/task_f_core3_delivery.md` (Rev 3), Baustein A
(Guard-Härtung) + B.1 (Fragen-Antworten durch den Guard). Arbeitskopie im
Worktree `.worktrees/f-core-3/` (lies geänderte Dateien dort). Du bist einer
von zwei unabhängigen Reviewern; kein Anteil am Code (M2).

Die Spec war selbst zweimal reviewed (Dispositionen:
`.pa/review_fcore3_disposition.md`, Delta `.pa/review_fcore3_delta.md`) —
der Code wird an der Spec gemessen, nicht am Bauchgefühl.

## Pflichtlektüre

1. `.pa/task_f_core3_delivery.md` (Rev 3) — Bausteine A und B.1, Tests T1–T8,
   die benannten Bestandstest-Anpassungen
2. `.pa/report_f_core3_delivery.md` im Worktree (`.worktrees/f-core-3/.pa/`) —
   der Implementierungs-Report mit den drei dokumentierten Abweichungen
3. Geänderte Dateien: `src-tauri/src/pty.rs`, `submit_guard.rs`, `profiles.rs`,
   `questions.rs` (im Worktree), plus zwei kleine `workers.rs`-Stellen
   (dead_code-Allow :146, Fake-Test :3486 — als Koordinationsnotiz markiert)

## Prüfen

1. **Spec-Konformität:** Baustein A vollständig? Baseline gilt für alle drei
   Tail-Suchen? Kappen korrekt? Bit-exakt-Regel für markerlose Profile hält?
2. **Die drei Abweichungen** (T4 build-rot statt laufzeit; Antwort-Marker als
   profiles-Tabelle statt caps-Feld; neue API test-seitig) — tragbar oder
   rückgängig zu machen?
3. **Test-Beweise:** die roten Ausgaben im Report/Commits echt prüfen —
   besonders T1, T3, T5, T7 (laufzeit-rot) und die Ersatz-Logik für T4.
4. **Nebenwirkungen:** `Observation.output_bytes` aus dem Snapshot statt
   AtomicU64 — Konsumenten (status.rs, workers.rs lesen ggf. output_bytes)
   unverändert korrekt? `EscalationReason`-Logpfade sinnvoll?
5. **Merge-Risiko:** die zwei workers.rs-Stellen gegen die uncommittete
   F4-Welle im Hauptbaum (workers.rs dort schwer geändert) — Kollision
   wahrscheinlich?

## Ausgabeformat

URTEIL: <annehmen | annehmen mit Auflagen | überarbeiten | ablehnen>
BEGRÜNDUNG: <3–6 Sätze>
BEFUNDE: ### C-NN — Titel / Schwere / Behauptung / Beleg (Datei:Zeile) / Vorschlag
## Was trägt (max. 5)

Deutsch. Nur lesen, nichts verändern.
