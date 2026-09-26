# F4-Authority: Merge und Freigabe hinter dem Verdict-Token

Status: historisch

Repo: `<repo-root>`. **Nicht committen, nicht pushen, nicht
mergen.**

Plan: `docs/SANIERUNGSPLAN.md` Rev 9, F4. Schließt **F0-1**. Ultragoal:
`G007-f4`.

## Nahtstellen-Lane

Zuerst **`api.rs`**, danach **`bin/pa.rs`**. Nie beide in derselben
Edit-Welle. Nach `.pa/task_f4_readiness.md`. `store.rs` gehört
`.pa/task_f4_persist.md` — hier nur lesen, außer ein winziger Getter ist
unvermeidlich; dann abbrechen und Persistenz zuerst fertigmachen.

F1-SI-1 (Deskriptor-Löschen nach Pfad) ist **nicht** dieser Auftrag. Wenn der
Diff `remove_file(descriptor)` anfasst, ist der Schnitt falsch. Melden, nicht
mitbauen.

## Warum

`is_verdict` deckt nur Learnings/Roles approve|reject. `POST
/api/workers/<id>/merge` und `pa worker merge` laufen mit dem API-Token, den
jeder Agent lesen kann. Dieselbe Begründung, die den zweiten Token erfunden
hat (`api.rs` Modul-Doku), trifft auf Merge und auf das Prägen von
`approved`/`changes_requested` zu.

Nur Desktop oder ein Request mit Verdict-Token darf Freigabe prägen.
Gewöhnlicher API-/`pa`-Token darf das weder minten noch replayen.

## Deine Dateien

Welle 1 (exklusiv):

- `src-tauri/src/api.rs`

Welle 2 (exklusiv, nach grüner Welle 1):

- `src-tauri/src/bin/pa.rs`

## Auftrag

1. `is_verdict` um `POST /api/workers/<id>/merge` und um die Routen, die
   `approved` / `changes_requested` prägen, erweitern. Ohne Verdict-Header:
   403, Merge und Approval finden nicht statt.

2. Bestehenden Test `merging_a_worker_passes_the_worktree_flag_through`
   umdrehen: API-Token allein → 403; API-Token + Verdict → Flag wie bisher.
   Falsches Verdict-Token → 403, Backend nicht aufgerufen. Replay eines
   Approval-Bodies auf ein anderes Worker-/Evidence-Ziel schlägt fehl.

3. `pa worker merge` verlangt `--verdict-token` / `PA_VERDICT_TOKEN` wie die
   vier bestehenden Verdict-Kommandos. Parse-Tests und der Send-Test (beide
   Header) gehören dazu. Ohne Token: Usage/Fehler, kein Merge-POST.

4. Ordinary token cannot mint approval: eine Approval-Route (wenn sie in dieser
   Welle entsteht) oder die dokumentierte Weigerung, Approval über den
   Control-API-Token zu schreiben. Wenn Approval erst nach Persistenz eine
   Route hat, die Route hier anlegen — sonst explizit im Report, welcher
   Follow-up die Route trägt, und Merge trotzdem hinter das Token ziehen.

## Beweismaßstab

Kompilierender roter Test in `api.rs`, dann grün. Danach `pa`-Tests. Exit-Codes
in den Report.

## Gates

```text
cargo test --bin projecta merging_a_worker
cargo test --bin pa
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

## Report

`.pa/report_f4_authority.md`.
