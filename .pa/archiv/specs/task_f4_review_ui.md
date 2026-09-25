# F4-Review-UI: Readiness auf der bestehenden Diff-Fläche

Status: historisch

Repo: `<repo-root>`. **Nicht committen.**

Plan: Rev 9 F4 Review-UI. **Kein** `App.tsx`-Sechs-Ziele-Gut. `docs/ia/` wartet
auf den Menschen.

## Nahtstellen-Lane

Nach `.pa/task_f4_setup.md`. Dann **seriell `main.rs`**: ein Command
`get_worker_readiness`. Optional `set_diff_comment_disposition` wenn der
Setter in `store.rs` schon existiert (kein neues Schema).

Frontend (parallel, dateidisjunkt zum Runner):

- `src/components/DiffView.tsx` (+ Test)
- `src/lib/ipc.ts`, `src/types.ts`
- `src/styles.css` — Tokens, 1280px, Fokus

## Auftrag

1. Blockers[] und Ahead/Behind aus der Engine rendern, nicht erfinden.
2. Offene Kommentare als Disposition `open`/`done` schaltbar.
3. Tastatur, UIA-Name, sichtbarer Fokus (F7).

## Report

`.pa/report_f4_review_ui.md`
