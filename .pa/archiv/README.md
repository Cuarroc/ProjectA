# .pa/archiv — nur Beleg, nichts davon ist ein Auftrag

Angelegt am 25.09.2026 (Paket PLAN-01, Nutzerentscheidung „Alte .pa-Dateien
ins Archiv“). Hier liegt, was Agenten beim Lesen von `.pa/` verwirrt hat. Es
wurde verschoben, nicht gelöscht; die Historie jeder Datei zeigt
`git log --follow <pfad>`.

| Pfad | Inhalt |
|---|---|
| `PLAN_2026-09-24.md` | `docs/PLAN.md` vor dem Umbau auf Meilensteine (Wellen W0–W4, HQ2, DEVFLOW mit Verträgen und Protokoll, W5-Verweis, Register Nr. 1–17) |
| `MASTERPLAN_2026-09-24.md` | der frühere `docs/MASTERPLAN.md` (Stufen S0–S5, Aliase, Fortschrittsrechnung, Worker-Struktur, Hygiene-Befunde) |
| `STAND_2026-09-24.md` | die frühere Langfassung von `STAND.md` |
| `specs/` | alle Specs `task_*.md` mit `Status: historisch` (abgeschlossene oder abgelöste Aufträge) |
| `review-prompts/` | eingecheckte Review-Prompts `review_prompt_*.md`; sie enthielten meist den ganzen Diff und werden nicht mehr eingecheckt (AGENTS.md, Regel 7) |

Links in älteren Berichten, die auf `.pa/task_*.md` oder
`.pa/review_prompt_*.md` zeigen, finden die Datei unter demselben Namen in
`specs/` bzw. `review-prompts/`. Relative Links innerhalb der archivierten
Dateien sind an ihren neuen Ort angepasst, soweit sie ins Repo zeigen; Links
innerhalb von `specs/` und `review-prompts/` beziehen sich auf den
ursprünglichen Ablageort der jeweiligen Datei.
