<!--
Start with three plain German sentences for the user: What changes? Why?
What does the user have to do or decide (or "nichts")?
Then keep the report below (AGENTS.md, rule 7). Mergify requires a line that
starts with "## Report" on package branches.
-->

## Report

**Package:** <ID from docs/PLAN.md> · **Review tier:** A / B / C (AGENTS.md, rule 5)

**Goal / benefit:** <bounded result> · **Parent / ticket / owner:** <references>
**Native evidence:** <own create/get output or verified unavailable + documented ticket goal>
**Scope / limits / dependencies / acceptance:** <approved contract>

### What changed

- 

### Prompt-Log

<!-- Only when useful: first solution, one neutral extra check (no defect valid), concrete fixes, integration/interfaces. Second extra round only for a remaining defect; stop conditions in prompting.md. -->

- **rounds:** 0-2 · **critic:** self / model · **findings:** n high / n other · **changed:** one line
- **Draft** (plan, at most 15 lines): 
- **Critique:** 
- **Final:** 

### Evidence

| Command | Exit code |
|---|---|
|  |  |

### NICHT ABGEDECKT

- 

### Reviews and disposition

| ID | Source | Severity | Finding | Disposition |
|---|---|---|---|---|
|  |  |  |  |  |

### Nacharbeit

<!-- Concrete findings only. Preserve independent review/approval limits and candidate-bound evidence; see prompting.md. -->

| Finding (`file:line`) | Command | Exit code | Fix commit |
|---|---|---|---|
|  |  |  |  |

### Open points

- **State:** implemented / tested / reviewed / accepted / merged / usable (evidence separately)
- **Adaptation, if any:** trigger + evidence; previous state; change; remaining duties/acceptance
- **Blocker, if any:** cause/hypothesis; evidence; impact; owner + next step
- **Handover:** candidate/base; goal evidence; remaining limits; next owner/step. Checked worker handover may end its goal; parent remains open until its own acceptance.
