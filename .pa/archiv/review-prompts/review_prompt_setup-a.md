# Review-Auftrag SETUP-A (ProjectA), Kandidat 7546c8c234fae2b5730fe273f6132c8ab7d76356

Du bist ein unabhängiger Reviewer (anderer Anbieter als der Autor, Claude). Prüfe den Diff unten.

## Paket
SETUP-A bündelt: Setup-Doku je KI-Anbieter unter docs/setup/, einen Repo-Skill
`projecta-workflow` (zwei identische Kopien .agents/skills/ und .claude/skills/),
ein Prüfskript scripts/dev/agent-setup-check.mjs mit Test
scripts/lib/agent-setup-check.test.mjs (npm run dev:agent-check), Korrekturen in
CLAUDE.md (@AGENTS.md-Import), README.md, PRODUCT.md, WORKFLOW.md-Hinweis,
review.yml-Kopfkommentar.

## Regeln, gegen die zu prüfen ist (Auszug AGENTS.md und Nutzerentscheidungen)
- Keine Secrets in getrackten Dateien; die Doku nennt nur Dateinamen und Namen von Umgebungsvariablen, nie Werte.
- Das Prüfskript ist read-only, zeigt nie Konfig-Inhalte, Exit != 0 nur bei Pflichtfehlern.
  Der Test muss ohne Netz und ohne echte Binaries laufen (injizierte Fake-Umgebung) und auf Linux-CI grün sein (keine Windows-Annahmen).
- Die Gate-Liste steht nur in scripts/ci/gates.sh; keine Kopie der Gate-Liste in anderen Dateien.
- Nur Abos, kein OpenRouter. Advisor-Paar Fable 5.1 (Claude-Subagent) + GPT-6 Astra (Codex, -c model_reasoning_effort=high je Aufruf). Alltags-Reviewerpaar kimi-k3:cloud + glm-5.2:cloud via Ollama Cloud.
- AGENTS.md bleibt die Quelle; Skill und CLAUDE.md dürfen ihr nicht widersprechen.
- Commit-Trailer: Test-First: <pfad>::<testname> (bei .mjs immer mit Testname), Regression-For: <sha>, No-Test: <grund>.
- Nie git stash, nie --no-verify, nie CARGO_PROFILE_*.
- Mergify-Regeln: PR am Ende, Draft bis fertig, Labels do-not-merge/priority/conflict.
- Die Berechtigungsdatei ist nur ein Vorschlag; .claude/settings.json wird nicht geändert.

## Gewünschte Ausgabe
1. Befunde als Liste, je: ID (R1, R2, ...), Schwere (hoch/mittel/niedrig/nit), Datei:Zeile, Befund, Begründung, Vorschlag.
   Achte besonders auf: sachliche Fehler oder Widersprüche zwischen den Dokumenten, Sicherheitslücken im Skript
   (Shell-Ausführung, Pfade), Testlücken, plattformabhängige Annahmen im Test, falsche Kommandos in der Doku.
2. Urteil: freigeben / freigeben mit Auflagen / ablehnen.

## Diff (origin/main...7546c8c)

```diff
diff --git a/.agents/skills/projecta-workflow/SKILL.md b/.agents/skills/projecta-workflow/SKILL.md
new file mode 100644
index 0000000..c350f37
--- /dev/null
+++ b/.agents/skills/projecta-workflow/SKILL.md
@@ -0,0 +1,92 @@
+---
+name: projecta-workflow
+description: Working playbook for one implementation package in the ProjectA repo (Tauri 2 agentic terminal) — gates, red-first commit trailers, cross-vendor reviews with disposition, report file, PR and Mergify rules, cargo build slots, advisors. Use when starting, committing, reviewing or opening a PR for any ProjectA package.
+---
+
+# ProjectA workflow (short playbook)
+
+`AGENTS.md` at the repository root is the source of truth. This skill is a
+checklist that points into it; where the two disagree, `AGENTS.md` wins. Setup
+per provider: `docs/setup/README.md`. Check your machine with
+`npm run dev:agent-check`.
+
+## 1. Start
+
+1. Read `STAND.md`, then `AGENTS.md`, then run `bash scripts/sync.sh start`.
+2. Work in your own worktree and branch, created from the newest `origin/main`.
+   Use `git -C <path>` for other worktrees.
+3. Never `git stash` (the stash stack is shared by all worktrees) — use a WIP
+   commit. Never `--no-verify`, never `--force` pushes.
+4. Only one lane at a time may edit the seams `src-tauri/src/api.rs`, `main.rs`,
+   `store.rs`, `bin/pa.rs`. Declare ownership before touching them.
+
+## 2. Build and gates
+
+- The gate list lives only in `scripts/ci/gates.sh`. Run
+  `bash scripts/ci/gates.sh lane prepush` before pushing; `npm ci` first when
+  `node_modules` is missing or stale.
+- Every gate run ends with a `NICHT ABGEDECKT` block; put it in the PR text.
+- Worktrees under `.claude/worktrees/` have no `target/`. Point cargo at a
+  build slot: `export CARGO_TARGET_DIR=%USERPROFILE%/cargo-targets/projecta-<a|b|c>`
+  and `CARGO_BUILD_JOBS=1` or `2`. At most 2–3 builds at once; check free RAM
+  first. **Never set `CARGO_PROFILE_*`** — it invalidates the whole cache.
+- Read exit codes unmasked: `| tail` swallows the status.
+
+## 3. Red first — commit trailers
+
+Every commit that changes source (`src/`, `src-tauri/`, `scripts/`,
+`.github/workflows/`, `package.json`, …) needs one trailer line
+(`scripts/lib/test-first.sh`):
+
+- `Test-First: <path>::<testname>` — the test is red on the PR base and green
+  on the head (CI job `red-first`). For `.mjs` tests always name the test:
+  `Test-First: scripts/lib/foo.test.mjs::exact test name`. A path-only `.mjs`
+  trailer runs the whole file, which is already green on the base when the
+  file only gains tests — red-first then rejects it. Rust:
+  `Test-First: src-tauri/src/x.rs::test_fn` or the fully qualified test path.
+- `Regression-For: <sha>` — for a regression of that commit.
+- `No-Test: <reason>` — docs, config, or changes that cannot be tested; give
+  the real reason.
+
+Several pieces of evidence = several lines, never a list. Commit the failing
+test first, then the fix.
+
+## 4. Reviews and disposition
+
+- Plans and changes over 300 lines or touching a seam need two reviews from
+  other vendors before merge. Everyday pair: `kimi-k3:cloud` + `glm-5.2:cloud`
+  via Ollama Cloud and `.pa/review_transport.py` (setup and command:
+  `docs/setup/ollama-reviewers.md`).
+- Output: `.pa/review_<label>_<model>.md`. Record every finding in
+  `.pa/review_<label>_disposition.md` (ID, source, severity, finding,
+  disposition: accepted with commit / rejected with reason / follow-up).
+- Evidence is bound to the candidate commit; a later change invalidates the
+  affected evidence — re-run the review on the delta.
+
+## 5. Advisors (subscriptions only, no OpenRouter)
+
+For hard decisions and final reviews use the advisor pair: **Fable 5.1**
+(Claude subagent, max effort) + **GPT-6 Astra** (Codex CLI,
+`codex exec -c model_reasoning_effort=high …`; the global default stays
+medium). Workers may call the advisors themselves for seam, security or
+architecture decisions and when stuck for more than 30 minutes; otherwise go
+through the coordinator. Questions the advisors raise go to the coordinator,
+who asks the user.
+
+## 6. Report, PR, merge
+
+1. Write the report `.pa/report_<id>.md`: what changed per file, evidence
+   (test names, gate lanes, `NICHT ABGEDECKT`), reviews + disposition, open
+   points. If your harness blocks writes to `.pa/report_*`, return the report
+   as text to the coordinator — do not work around the block.
+2. Push once and open **one PR per package at the end**. Open it as **draft**
+   while report, disposition or the `NICHT ABGEDECKT` block is missing; mark it
+   ready (`gh pr ready <n>`) only when all are in. Every push to an open PR
+   costs a full Linux + Windows CI run. Verify a push with `git ls-remote`,
+   not with the push exit code.
+3. `main` is merged by the **Mergify** merge queue, not by hand. Labels:
+   `do-not-merge` keeps a PR out of the queue; `priority` (coordinator only)
+   moves it to the front; `conflict` is set by Mergify — rebase, push, it
+   clears. Details: `docs/setup/mergify.md`.
+4. After a merge in your worktree, restore generated snapshots:
+   `git checkout -- docs/dev-hq/data.js docs/dev-hq/data.json`.
diff --git a/.claude/skills/projecta-workflow/SKILL.md b/.claude/skills/projecta-workflow/SKILL.md
new file mode 100644
index 0000000..c350f37
--- /dev/null
+++ b/.claude/skills/projecta-workflow/SKILL.md
@@ -0,0 +1,92 @@
+---
+name: projecta-workflow
+description: Working playbook for one implementation package in the ProjectA repo (Tauri 2 agentic terminal) — gates, red-first commit trailers, cross-vendor reviews with disposition, report file, PR and Mergify rules, cargo build slots, advisors. Use when starting, committing, reviewing or opening a PR for any ProjectA package.
+---
+
+# ProjectA workflow (short playbook)
+
+`AGENTS.md` at the repository root is the source of truth. This skill is a
+checklist that points into it; where the two disagree, `AGENTS.md` wins. Setup
+per provider: `docs/setup/README.md`. Check your machine with
+`npm run dev:agent-check`.
+
+## 1. Start
+
+1. Read `STAND.md`, then `AGENTS.md`, then run `bash scripts/sync.sh start`.
+2. Work in your own worktree and branch, created from the newest `origin/main`.
+   Use `git -C <path>` for other worktrees.
+3. Never `git stash` (the stash stack is shared by all worktrees) — use a WIP
+   commit. Never `--no-verify`, never `--force` pushes.
+4. Only one lane at a time may edit the seams `src-tauri/src/api.rs`, `main.rs`,
+   `store.rs`, `bin/pa.rs`. Declare ownership before touching them.
+
+## 2. Build and gates
+
+- The gate list lives only in `scripts/ci/gates.sh`. Run
+  `bash scripts/ci/gates.sh lane prepush` before pushing; `npm ci` first when
+  `node_modules` is missing or stale.
+- Every gate run ends with a `NICHT ABGEDECKT` block; put it in the PR text.
+- Worktrees under `.claude/worktrees/` have no `target/`. Point cargo at a
+  build slot: `export CARGO_TARGET_DIR=%USERPROFILE%/cargo-targets/projecta-<a|b|c>`
+  and `CARGO_BUILD_JOBS=1` or `2`. At most 2–3 builds at once; check free RAM
+  first. **Never set `CARGO_PROFILE_*`** — it invalidates the whole cache.
+- Read exit codes unmasked: `| tail` swallows the status.
+
+## 3. Red first — commit trailers
+
+Every commit that changes source (`src/`, `src-tauri/`, `scripts/`,
+`.github/workflows/`, `package.json`, …) needs one trailer line
+(`scripts/lib/test-first.sh`):
+
+- `Test-First: <path>::<testname>` — the test is red on the PR base and green
+  on the head (CI job `red-first`). For `.mjs` tests always name the test:
+  `Test-First: scripts/lib/foo.test.mjs::exact test name`. A path-only `.mjs`
+  trailer runs the whole file, which is already green on the base when the
+  file only gains tests — red-first then rejects it. Rust:
+  `Test-First: src-tauri/src/x.rs::test_fn` or the fully qualified test path.
+- `Regression-For: <sha>` — for a regression of that commit.
+- `No-Test: <reason>` — docs, config, or changes that cannot be tested; give
+  the real reason.
+
+Several pieces of evidence = several lines, never a list. Commit the failing
+test first, then the fix.
+
+## 4. Reviews and disposition
+
+- Plans and changes over 300 lines or touching a seam need two reviews from
+  other vendors before merge. Everyday pair: `kimi-k3:cloud` + `glm-5.2:cloud`
+  via Ollama Cloud and `.pa/review_transport.py` (setup and command:
+  `docs/setup/ollama-reviewers.md`).
+- Output: `.pa/review_<label>_<model>.md`. Record every finding in
+  `.pa/review_<label>_disposition.md` (ID, source, severity, finding,
+  disposition: accepted with commit / rejected with reason / follow-up).
+- Evidence is bound to the candidate commit; a later change invalidates the
+  affected evidence — re-run the review on the delta.
+
+## 5. Advisors (subscriptions only, no OpenRouter)
+
+For hard decisions and final reviews use the advisor pair: **Fable 5.1**
+(Claude subagent, max effort) + **GPT-6 Astra** (Codex CLI,
+`codex exec -c model_reasoning_effort=high …`; the global default stays
+medium). Workers may call the advisors themselves for seam, security or
+architecture decisions and when stuck for more than 30 minutes; otherwise go
+through the coordinator. Questions the advisors raise go to the coordinator,
+who asks the user.
+
+## 6. Report, PR, merge
+
+1. Write the report `.pa/report_<id>.md`: what changed per file, evidence
+   (test names, gate lanes, `NICHT ABGEDECKT`), reviews + disposition, open
+   points. If your harness blocks writes to `.pa/report_*`, return the report
+   as text to the coordinator — do not work around the block.
+2. Push once and open **one PR per package at the end**. Open it as **draft**
+   while report, disposition or the `NICHT ABGEDECKT` block is missing; mark it
+   ready (`gh pr ready <n>`) only when all are in. Every push to an open PR
+   costs a full Linux + Windows CI run. Verify a push with `git ls-remote`,
+   not with the push exit code.
+3. `main` is merged by the **Mergify** merge queue, not by hand. Labels:
+   `do-not-merge` keeps a PR out of the queue; `priority` (coordinator only)
+   moves it to the front; `conflict` is set by Mergify — rebase, push, it
+   clears. Details: `docs/setup/mergify.md`.
+4. After a merge in your worktree, restore generated snapshots:
+   `git checkout -- docs/dev-hq/data.js docs/dev-hq/data.json`.
diff --git a/.github/workflows/review.yml b/.github/workflows/review.yml
index 3f6a6fc..d505095 100644
--- a/.github/workflows/review.yml
+++ b/.github/workflows/review.yml
@@ -1,3 +1,10 @@
+# RUHEND (seit 24.09.2026, SETUP-A): Reviews laufen lokal ueber das
+# Ollama-Cloud-Paar kimi-k3 + glm-5.2 (docs/setup/ollama-reviewers.md).
+# Nutzerentscheidung "nur Abos, kein OpenRouter": dieser Workflow braucht
+# OPENROUTER_KEY und wird nicht mehr gestartet. Nicht loeschen, nicht auf
+# Ollama umbauen (der Runner erreicht Ollama Cloud nicht). Gilt ebenso fuer
+# scripts/review/resolve_models.py.
+#
 # Externe Plan-/Diff-Reviews durch Nicht-Anthropic-Modelle (Regel aus docs/PLAN.md §0; historisch SANIERUNGSPLAN §0.3, §4.4).
 #
 # ACHTUNG, die wichtigste Zeile dieser Datei: es gibt KEINEN `push`-Trigger mehr.
diff --git a/.gitignore b/.gitignore
index 4faa7ba..8f3a3b2 100644
--- a/.gitignore
+++ b/.gitignore
@@ -12,6 +12,9 @@
 !.claude/settings.json
 !.claude/hooks/
 !.claude/hooks/*.sh
+# Repo-Skill fuer Claude Code; identische Kopie von .agents/skills/ (SETUP-A,
+# Gleichheit prueft `npm run dev:agent-check`).
+!.claude/skills/
 # Codex-Pendant zu .claude/hooks: bindet Codex an red-first. Bleibt lokal,
 # weil hooks.json einen absoluten Pfad dieser Maschine traegt.
 .codex/
diff --git a/CLAUDE.md b/CLAUDE.md
index a0c5bf1..0b4aae8 100644
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -1,37 +1,63 @@
+@AGENTS.md
+
 # CLAUDE.md
 
 This file provides guidance to Claude Code (claude.ai/code) when working with
 code in this repository.
 
-## Lies `AGENTS.md`
+## `AGENTS.md` ist die Quelle
+
+Die erste Zeile dieser Datei importiert [`AGENTS.md`](AGENTS.md): Claude Code
+liest `AGENTS.md` nicht von selbst (Codex, OpenCode und Kimi Code tun es per
+Konvention), erst der `@AGENTS.md`-Import lädt es in jede Sitzung.
+`npm run dev:agent-check` prüft, dass die Zeile da ist.
 
-**Das gesamte Projektwissen steht in [`AGENTS.md`](AGENTS.md)** — Architektur,
-Befehle, Gates, die vier Nahtstellen, der Beweismaßstab, die Eigenschaften der
-einzelnen Anbieter und die hart erlernten Betriebs-Gotchas.
+In `AGENTS.md` stehen Architektur, Befehle, Gates, die vier Nahtstellen und der
+Beweismaßstab. Die Eigenschaften der einzelnen Anbieter und ihre Einrichtung
+stehen in [`docs/setup/`](docs/setup/README.md); ältere Betriebs-Gotchas in
+`docs/development/WORKFLOW.md`.
 
-Diese Datei hier führt **keine eigene Fassung** davon. Der Grund ist ein
-belegter: An diesem Repo arbeiten Claude, Codex, Kimi und OpenCode parallel, und
+Diese Datei führt **keine eigene Fassung** davon. Der Grund ist ein belegter:
+An diesem Repo arbeiten Claude, Codex, Kimi und OpenCode parallel, und
 `CLAUDE.md` liest nur Claude. Wissen, das hier stand und dort nicht, war für die
 anderen Anbieter unsichtbar — und zwei Fassungen derselben Wahrheit driften
 auseinander. Genau diese Fehlerklasse hat ein Doku-Audit mit zehn Befunden
 belegt.
 
 Was hier steht, ist ausschließlich das, was *nur* für Claude Code gilt.
+Einrichtung im Detail: [`docs/setup/claude-code.md`](docs/setup/claude-code.md).
 
 ## Vor dem ersten Schreibzugriff
 
 1. [`STAND.md`](STAND.md) — wo wir gerade stehen, was sofort zu prüfen ist
-2. [`AGENTS.md`](AGENTS.md) — wie hier gearbeitet wird
+2. `AGENTS.md` — per Import schon geladen; der Skill `projecta-workflow`
+   (`.claude/skills/`) ist die Kurzfassung als Checkliste
 3. `bash scripts/sync.sh start` — das Briefing aus git
 
 ## Claude-spezifisch
 
-- **Skills und Plugins:** Dieser Arbeitsbereich lädt beim Start MCP-Server,
-  Plugins und Skills. Das kostet Zeit; `memorix` und `ruflo` können dabei mit
-  `CONNECT_TIMEOUT` hängen, ohne dass etwas kaputt ist.
-- **Worktrees:** Claude Code arbeitet oft in
-  `.claude/worktrees/<name>` statt im Hauptcheckout. Der git-Stash-Stapel ist
-  dabei **geteilt** — nie blankes `git stash` / `git stash pop` benutzen, sonst
-  greifst du in die Arbeit einer anderen Sitzung. Lieber ein WIP-Commit.
-- **Gates laufen lokal und in Push-/PR-CI**; Installer-Builds nur auf `v*`-Tags. Exit-Codes
-  ungemaskiert lesen — ein `| tail` verschluckt den Status.
+- **Repo-Einstellungen:** `.claude/settings.json` erlaubt nur lesende
+  git-/cargo-/npm-Befehle und hängt zwei Hooks ein: `SessionStart` →
+  `scripts/install-hooks.sh`, `PostToolUse` (Write/Edit) →
+  `.claude/hooks/red-first.sh` (Warnung, kein Blocker). Vorschlag für weitere
+  Allow-/Deny-Regeln: [`docs/setup/permissions-proposal.md`](docs/setup/permissions-proposal.md)
+  — der Nutzer entscheidet und trägt ein, kein Agent.
+- **MCP-Server und Plugins:** Der Start lädt MCP-Server, Plugins und Skills.
+  Das kostet Zeit; `ruflo` und `desktop-commander` können dabei mit
+  `CONNECT_TIMEOUT` hängen, ohne dass etwas kaputt ist (`memorix` verbindet in
+  der Regel). Das Zeitlimit setzt `MCP_TIMEOUT` in `~/.claude/settings.json`.
+- **Worktrees:** Claude Code arbeitet oft in `.claude/worktrees/<name>` statt im
+  Hauptcheckout. Der git-Stash-Stapel ist dabei **geteilt** — nie blankes
+  `git stash` / `git stash pop` benutzen, sonst greifst du in die Arbeit einer
+  anderen Sitzung. Lieber ein WIP-Commit.
+- **Build-Slots:** Worktrees haben kein `target/`. Vor Commit und Push
+  `CARGO_TARGET_DIR` auf einen Slot setzen (`%USERPROFILE%/cargo-targets/projecta-{a,b,c}`,
+  höchstens 2–3 Builds gleichzeitig). Nie `CARGO_PROFILE_*` setzen.
+- **Auto-Mode:** Der Klassifikator blockt `git worktree remove` und
+  `git branch -d`. Aufräumen übernimmt der Nutzer (oder ein Skript mit eigener
+  Allow-Regel, siehe Permission-Vorschlag).
+- **Subagenten und Berichte:** Schreibzugriffe von Subagenten auf
+  `.pa/report_*.md` können blockiert sein. Dann den Bericht als Text an den
+  Koordinator zurückgeben; der Koordinator committet ihn. Nicht umgehen.
+- **Gates laufen lokal und in Push-/PR-CI**; Installer-Builds nur auf `v*`-Tags.
+  Exit-Codes ungemaskiert lesen — ein `| tail` verschluckt den Status.
diff --git a/PRODUCT.md b/PRODUCT.md
index 05d5155..cec5e85 100644
--- a/PRODUCT.md
+++ b/PRODUCT.md
@@ -2,6 +2,12 @@
 
 <!-- impeccable:product-schema 1 -->
 
+> Scope: this file is the Impeccable product schema **for the Dev-HQ** (the
+> project's own cockpit), not a description of ProjectA as a product — for
+> that see `README.md`. Quotations marked *historical* cite an earlier German
+> `AGENTS.md`; the current `AGENTS.md` is English and phrases these rules
+> differently.
+
 ## Platform
 
 web
@@ -15,9 +21,12 @@ own documentation. Knows the vocabulary cold — Nahtstellen, Lanes, serial lock
 F-package IDs, the Beweismaßstab. Needs density and recall, not onboarding. No
 explainers, no tooltips, no first-run guidance.
 
-**The agents (mandated).** `AGENTS.md` §"Pflicht: das Dev-HQ
-ist dein Cockpit" requires every agent working this repo to use the Live view as
-its primary window onto fleet, queue, capacity, providers and recommendations.
+**The agents (mandated).** The earlier `AGENTS.md` (*historical*, §"Pflicht:
+das Dev-HQ ist dein Cockpit") required every agent working this repo to use the
+Live view as its primary window onto fleet, queue, capacity, providers and
+recommendations. Today `AGENTS.md` ("Start with current evidence") names the
+DevHQ website as the human cockpit and `pa hq runtime` / `pa hq context` as the
+agents' path to the same backend.
 **Confirmed by the operator (2026-09-09): back then, the agents almost never
 actually did.** The mandate existed; the adoption did not.
 
@@ -52,7 +61,7 @@ fleet — you don't type in it."*
 
 DEV-HQ is the surface for working **on the project itself** rather than in it. It
 exists so neither the operator nor an agent has to re-derive state that is
-already known — `AGENTS.md`: *"Ein Agent, der stattdessen manuell `pa`-Kommandos
+already known — earlier `AGENTS.md` (*historical*): *"Ein Agent, der stattdessen manuell `pa`-Kommandos
 zusammenklickt oder den Zustand errät, tut doppelte Arbeit, die das HQ schon
 anzeigt."*
 
@@ -68,8 +77,9 @@ and an agent reaches the same truth without a browser.
 
 The mechanism a neighbouring dashboard could not truthfully copy: **every claim
 carries its source, and the tool holds itself to the project's own evidence
-standard.** `AGENTS.md`: *"Ein Fund ohne roten Test ist eine Behauptung. Ein Fund
-mit rotem Test ist eine Tatsache."* Concretely — findings are typed FACT vs
+standard.** Earlier `AGENTS.md` (*historical*): *"Ein Fund ohne roten Test ist
+eine Behauptung. Ein Fund mit rotem Test ist eine Tatsache."* — today: "A bug
+claim needs a compiling, failing regression test." Concretely — findings are typed FACT vs
 CLAIM; every input file is listed with its SHA-256; estimates state their basis
 and a range rather than one confident number.
 
@@ -87,7 +97,9 @@ which is locked behind whom.
   that works with no app running, and a **Live** view proxying the loopback
   Control API.
 - The surrounding ritual: `STAND.md` is read first every session; gates run
-  locally (CI only on `v*` tags) with exit codes unmasked; diffs over 300 lines
+  locally and in CI on pushes to `main` and on pull requests (installer
+  builds only on `v*` tags), exit codes unmasked; `main` is merged by the
+  Mergify merge queue; diffs over 300 lines
   or touching a Nahtstelle need two independent AI reviews with a logged
   disposition; every session appends to `.pa/ACTIVITY.md`.
 - Work happens across many concurrent git worktrees with a shared stash stack.
@@ -111,13 +123,19 @@ groups profiles visually while the Rust core ignores it.
 
 **Known constraints on that ambition:**
 
-- Skills currently reach only 2 of 5 providers (`capabilities.rs`: `claude` →
-  Convention, `kimi` → Flag; `codex`, `opencode`, `ollama` → `Unsupported`). A
-  team template promising "skills" cannot deliver them on three providers.
+- The app delivers skill packs only to 2 of 5 built-in providers
+  (`src-tauri/resources/agent-defaults.json`: `claude` → Convention, `kimi` →
+  Flag `--skills-dir`; `codex`, `opencode`, `ollama` → `unsupported`). The
+  `ConventionAt` mode (PR #57, e.g. `.agents/skills`) exists but is only set
+  through an `agents.json` override; whether Codex/OpenCode pick up
+  `.agents/skills` on their own is the open probe W1-18b. A team template
+  promising "skills" cannot yet deliver them on three providers.
 - Harness properties are a Rust enum, not data. Making them configurable is
   already an accepted roadmap item (`docs/decisions.md`, 2026-09-09,
-  Multi-Harness) with a spec at `.pa/task_multi_harness.md`, status `entwurf`.
-  Team templates overlap this work and must not fork it.
+  Multi-Harness) with a spec at `.pa/task_multi_harness.md` (status
+  `entwurf`). Its deferral was lifted on 2026-09-23 (`docs/PLAN.md`); the
+  technical order stays F-CORE-3 → F6 → Multi-Harness. Team templates overlap
+  this work and must not fork it.
 - Per-project cost attribution is capped: `usage_events` has no project
   dimension and OmniRoute's ledger knows neither session nor client
   (`KNOWN_ISSUES.md` KI-5). Money cannot be honestly attributed per project.
@@ -138,9 +156,10 @@ beyond a typographic `HQ` mark.
 
 Real, in-repo, usable as design content — nothing needs inventing:
 
-- `docs/dev-hq/data.json` — 19 specs with lanes and serial owners, 9 typed
-  findings, a 10-node package DAG, 23 SHA-256 source hashes.
-- `docs/dev-hq/lessons.json` — 16 real known-error entries.
+- `docs/dev-hq/data.json` — the specs with lanes and serial owners, typed
+  findings, the package DAG and a SHA-256 hash per source file (regenerated on
+  every merge, so no fixed counts here).
+- `docs/dev-hq/lessons.json` — real known-error entries.
 - `scripts/lib/hq-visual.browser.mjs` — a realistic mock Control API (2 workers,
   queue, questions, quota, budgets, usage, providers, recommendations).
 - `.pa/ACTIVITY.md` — the real session journal; `.pa/review_*.md` — real dual
diff --git a/README.md b/README.md
index c443833..e3d05a3 100644
--- a/README.md
+++ b/README.md
@@ -3,7 +3,7 @@
   <br />
   <p><strong>One task is one agent in one git worktree — ProjectA runs a whole fleet of them, side by side.</strong></p>
   <p>
-    <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-v1.4.0-22d3ee?style=flat-square&labelColor=0d1117" alt="Version v1.4.0" /></a>
+    <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-v1.4.1-22d3ee?style=flat-square&labelColor=0d1117" alt="Version v1.4.1" /></a>
     <img src="https://img.shields.io/badge/platform-Windows-8b949e?style=flat-square&labelColor=0d1117&logo=windows&logoColor=white" alt="Platform: Windows" />
     <img src="https://img.shields.io/badge/Tauri-2-34d399?style=flat-square&labelColor=0d1117&logo=tauri&logoColor=white" alt="Tauri 2" />
     <img src="https://img.shields.io/badge/Rust-core-a78bfa?style=flat-square&labelColor=0d1117&logo=rust&logoColor=white" alt="Rust core" />
@@ -17,7 +17,7 @@
 
 ProjectA is an **agentic terminal**: a Tauri 2 desktop app that runs a fleet of parallel CLI coding agents — `claude`, `kimi`, `codex`, `opencode`, `ollama` — side by side. Every task gets its own agent in its own git worktree, with its own PTY session, and every delivery into that session is verified before it counts. A live kanban board shows who is working, who is stuck and who is waiting on you; diffs are reviewed in the app and line comments land back in the agent's terminal. Coordinating agents drive the whole fleet through a token-guarded API and their own bridge CLI, `pa`.
 
-## The fleet today — v1.4.0
+## The fleet today — v1.4.1
 
 | Area | What you get |
 | --- | --- |
@@ -25,7 +25,7 @@ ProjectA is an **agentic terminal**: a Tauri 2 desktop app that runs a fleet of
 | **Delivery guard** | Tasks, questions and `worker send` pass a delivery guard: it waits for a readiness marker, verifies the echo in the scrollback and retries Enter; only a proven delivery appears in the history, and failure leaves a system note with the next step. Folder-trust dialogs are answered automatically — for Codex, the staged start chain (hooks review) gets Enter only once the selector visibly sits on the safe option |
 | **Orchestration** | Task queue with dispatcher, orchestrator and scout agents, conversation-first UI with the board as a rail, blocking decisions via `pa ask` — agents ask, you answer straight into their terminal |
 | **Review & merge** | Unified diff view with line comments, merge/push pipeline with test gates, pull requests via `gh`. Pre-merge tests run in a disposable merge-candidate tree; approval binds the object IDs, the merge tree and the diff it actually saw |
-| **Dev-HQ** | Machine interface HQ v1 inside the app — `pa hq runtime`, `pa hq context --project <id>` — plus the Dev-HQ website at `npm run hq:live` (port 4173) with five tabs: the situation board from STAND.md, the package DAG, the evidence matrix, the timeline |
+| **Dev-HQ** | Machine interface HQ v1 inside the app — `pa hq runtime`, `pa hq context --project <id>` — plus the Dev-HQ website at `npm run hq:live` (port 4173): static pages generated from STAND.md and the specs (Now, Map with the package DAG, Proof with the evidence matrix, Next, Sources, Lessons) plus the Live view on the running app |
 | **Prompting & learning** | Dialogic prompt sharpening — vague tasks produce questions, not guesses — skill packs per project, and a learning loop whose playbook entries require a human verdict |
 | **Providers & cost** | Provider registry with encrypted key vault (DPAPI), optional OmniRoute routing with quota telemetry, per-profile budget stops |
 | **Packaging & updates** | Signed NSIS installer (plus MSI) for Windows; the release builder requires signed host manifests, and auto-updates arrive over the public mirror at [Cuarroc/ProjectA-updates](https://github.com/Cuarroc/ProjectA-updates) |
@@ -50,7 +50,7 @@ npm run tauri dev   # the desktop app — this is the real thing
 
 `npm run dev` serves the UI alone on `http://localhost:1420` for styling work; the IPC commands only exist inside the Tauri runtime.
 
-Checks before a commit: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` — and from `src-tauri`: `cargo test`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check`.
+Checks: the gate list lives in exactly one place, `scripts/ci/gates.sh`. Run `bash scripts/ci/gates.sh --list` to see it and `bash scripts/ci/gates.sh lane prepush` before pushing (`lane precommit` is the fast loop the git hook runs). CI runs the same lanes on pushes to `main` and on pull requests; details in [docs/ci-lokal.md](docs/ci-lokal.md).
 
 ## For agents and Dev-HQ
 
@@ -61,9 +61,12 @@ pa hq runtime                    # what the running app exposes
 pa hq context --project <id>     # project context for this worktree
 npm run dev:doctor -- --json     # read-only setup diagnosis
 npm run dev:setup                # installs clone-local hooks (.githooks), writes .pa/HQ-START.md
+npm run dev:agent-check          # is this machine ready for an agent? (--json available)
 ```
 
-The human cockpit is the Dev-HQ website: `npm run hq:live`, then `http://localhost:4173`. One implementation task, one agent, one git worktree — the coordination protocol is [AGENTS.md](AGENTS.md).
+The human cockpit is the Dev-HQ website: `npm run hq:live`, then `http://localhost:4173`. One implementation task, one agent, one git worktree — the coordination protocol is [AGENTS.md](AGENTS.md); how each provider (Claude Code, Codex, OpenCode, Kimi Code, the Ollama reviewers) is set up is in [docs/setup/](docs/setup/README.md).
+
+Pull requests: one PR per package, opened at the end and kept as a draft until report, review disposition and the `NICHT ABGEDECKT` block are in. `main` is merged by the Mergify merge queue, not by hand ([docs/setup/mergify.md](docs/setup/mergify.md)).
 
 ## Documentation
 
@@ -76,10 +79,17 @@ The human cockpit is the Dev-HQ website: `npm run hq:live`, then `http://localho
 | [STAND.md](STAND.md) | Current hand-off state and operational notes |
 | [STATUS.md](STATUS.md) | Running log of the build, newest entries on top |
 | [TRIAGE.md](TRIAGE.md) | Evidence findings sorted by severity, with dispositions |
-| [PRODUCT.md](PRODUCT.md) | Product definition and platform description |
+| [PRODUCT.md](PRODUCT.md) | Product schema of the Dev-HQ (users, purpose, principles) for design work |
 | [docs/development/WORKFLOW.md](docs/development/WORKFLOW.md) | The full operating reference: architecture, releases, environment gotchas |
 | [docs/dev-hq/](docs/dev-hq/) | Dev-HQ: design, bugs, lessons and the live site |
-| [docs/PLAN.md](docs/PLAN.md) | The one work plan: waves, packages, decisions |
+| [docs/MASTERPLAN.md](docs/MASTERPLAN.md) | Open work: waves and packages still to do |
+| [docs/ERLEDIGT.md](docs/ERLEDIGT.md) | Finished packages with PR and merge commit |
+| [docs/PLAN.md](docs/PLAN.md) | Source and archive of the plan: waves, packages, decisions |
+| [docs/setup/](docs/setup/README.md) | Agent setup per provider, reviewers, Mergify, permission proposal |
+| [docs/ci-lokal.md](docs/ci-lokal.md) | Running the gate lanes locally (Windows, WSL2) |
+| [docs/decisions.md](docs/decisions.md) | Dependency and architecture decisions: what, why, when to reverse |
+| [docs/plugin-matrix.md](docs/plugin-matrix.md) | Tauri plugins and capabilities the app uses, and why |
+| [docs/agents-json.md](docs/agents-json.md) | The `agents.json` profile format |
 
 ---
 
diff --git a/docs/development/WORKFLOW.md b/docs/development/WORKFLOW.md
index 5e36254..6054d62 100644
--- a/docs/development/WORKFLOW.md
+++ b/docs/development/WORKFLOW.md
@@ -322,6 +322,13 @@ Zwei Hälften, verbunden über Tauris IPC (Command-Tabelle und Events: `README.m
 Keine Tagesform, sondern Werkzeugeigenschaften. Wer sie ignoriert, verbrennt
 Kontingent an einer Wand.
 
+> **Historisch (Stand vor dem 24.09.2026).** Die Tabelle und die
+> Arbeitsteilung darunter beschreiben den OmniRoute-/Free-Tier-Betrieb; Kimi
+> Code, das Ollama-Reviewerpaar und die Advisors fehlen. Die aktuelle
+> Einrichtung und Rollenverteilung je Anbieter steht in
+> [`docs/setup/`](../setup/README.md). Die Einzelbefunde unten (Bilder,
+> Prozessgruppe, Pfadgrenze) sind dort übernommen.
+
 | | Codex | OpenCode (über OmniRoute) | Claude |
 |---|---|---|---|
 | Agentisch arbeiten | ja | ja | ja |
diff --git a/docs/setup/README.md b/docs/setup/README.md
new file mode 100644
index 0000000..eb2dd7d
--- /dev/null
+++ b/docs/setup/README.md
@@ -0,0 +1,72 @@
+# Agenten-Setup je Anbieter
+
+Wie die KI-Werkzeuge auf dem Entwicklungsrechner für ProjectA eingerichtet
+sind, was jedes davon liest und wie man prüft, ob alles da ist. Stand
+24.09.2026 (Audit SETUP-A). Diese Seiten nennen **nur Dateinamen und
+Namen von Umgebungsvariablen, nie Werte**.
+
+Die Arbeitsregeln selbst stehen in [`AGENTS.md`](../../AGENTS.md); diese Seiten
+beschreiben nur die Einrichtung.
+
+## Prüfen
+
+```sh
+npm run dev:agent-check            # Textausgabe
+npm run dev:agent-check -- --json  # maschinenlesbar
+```
+
+Exit 1 nur bei einem Pflichtfehler: Node ≥ 24, `git`, `gh`, `cargo`,
+`AGENTS.md`, `@AGENTS.md`-Import in `CLAUDE.md`, `core.hooksPath` → `.githooks`,
+beide Kopien des Skills `projecta-workflow` identisch. Alles andere
+(optionale Harnesses, Reviewer-Modelle, `gh`-Login, Build-Slots,
+Konfig-Dateien) ist eine Warnung.
+
+## Wer macht was
+
+| Anbieter | Harness | Rolle | Seite |
+|---|---|---|---|
+| Claude (Opus / Fable 5.1) | Claude Code | Koordinator, Nahtstellen, Security; Fable 5.1 als Advisor | [claude-code.md](claude-code.md) |
+| OpenAI GPT-6 Astra | Codex CLI | Advisor (Effort `high` je Aufruf), Worker | [codex.md](codex.md) |
+| Kimi K3 | Kimi Code CLI | Frontend/HQ-Worker, Reviews | [kimi.md](kimi.md) |
+| GLM / DeepSeek | OpenCode | Docs, Skripte, Zweitreview | [opencode.md](opencode.md) |
+| kimi-k3 + glm-5.2 (Ollama Cloud) | `.pa/review_transport.py` | Alltags-Reviewerpaar | [ollama-reviewers.md](ollama-reviewers.md) |
+| — | Mergify | Merge-Queue für `main` | [mergify.md](mergify.md) |
+
+Nur Abos, kein OpenRouter, keine zusätzlichen bezahlten API-Ausgaben.
+
+## Welche Instruktionsdatei liest wer
+
+| Harness | `AGENTS.md` | Repo-Skills |
+|---|---|---|
+| Claude Code | über den Import `@AGENTS.md` in der ersten Zeile von `CLAUDE.md` (nicht von selbst) | `.claude/skills/` |
+| Codex CLI | automatisch (Konvention, Projektwurzel) | `.agents/skills/` (Codex-Konvention) |
+| OpenCode | automatisch (Projektwurzel) | nicht belegt — Probe W1-18b offen |
+| Kimi Code CLI | automatisch | `--skills-dir <dir>` (so startet die App Kimi-Worker) |
+| Ollama-Reviewer | **nie** — sie sehen nur die Prompt-Datei | — |
+
+Die App stellt Skill-Packs heute nur Claude (Konvention) und Kimi (`--skills-dir`)
+bereit; für Codex und OpenCode stehen die eingebauten Profile auf
+`unsupported` (`src-tauri/resources/agent-defaults.json`). Der Modus
+`ConventionAt` (PR #57) existiert, wird aber nur per `agents.json` gesetzt.
+
+Der Repo-Skill `projecta-workflow` ist die Kurzfassung der Arbeitsweise als
+Checkliste. Er liegt zweimal im Repo, byte-gleich bis auf Zeilenenden:
+`.agents/skills/projecta-workflow/SKILL.md` (Codex; weitere Harnesses nach W1-18b) und
+`.claude/skills/projecta-workflow/SKILL.md` (Claude Code). Geändert wird die
+`.agents`-Fassung, dann kopiert; `dev:agent-check` schlägt bei Abweichung an.
+
+## Advisors
+
+Für harte Entscheidungen und Abschlussreviews gilt das Advisor-Paar
+**Fable 5.1** (Claude-Subagent, maximaler Effort) + **GPT-6 Astra** (Codex CLI,
+`-c model_reasoning_effort=high` je Aufruf; global bleibt `medium`). Worker
+dürfen die Advisors selbst rufen bei Nahtstellen-, Security- und
+Architekturentscheidungen und wenn sie länger als 30 Minuten feststecken; sonst
+über den Koordinator. Rückfragen der Advisors gehen an den Koordinator, der
+den Nutzer fragt. Alltagsreviews laufen über das Ollama-Paar.
+
+## Berechtigungen
+
+Vorschlag für Allow-/Deny-Regeln in `.claude/settings.json`:
+[permissions-proposal.md](permissions-proposal.md). Der Nutzer entscheidet und
+trägt sie ein; kein Agent ändert seine eigenen Rechte.
diff --git a/docs/setup/claude-code.md b/docs/setup/claude-code.md
new file mode 100644
index 0000000..8785f88
--- /dev/null
+++ b/docs/setup/claude-code.md
@@ -0,0 +1,83 @@
+# Claude Code
+
+Rolle: Koordinator, Nahtstellen-Lanes, Security; Fable 5.1 als Advisor.
+Zurück zur Übersicht: [README.md](README.md).
+
+## Pflichtdateien im Repo
+
+- **`CLAUDE.md`** — erste Zeile `@AGENTS.md`. Ohne diesen Import lädt Claude
+  Code `AGENTS.md` **nicht**; `npm run dev:agent-check` prüft die Zeile.
+- **`.claude/settings.json`** — Allow-Liste nur für lesende git-, cargo- und
+  npm-Befehle; zwei Hooks:
+  - `SessionStart` → `bash scripts/install-hooks.sh` (setzt `core.hooksPath`)
+  - `PostToolUse` (Write|Edit) → `bash .claude/hooks/red-first.sh` — warnt, wenn
+    Quellcode ohne Test-Diff geändert wurde; blockiert nicht.
+- **`.claude/skills/projecta-workflow/SKILL.md`** — Kopie von
+  `.agents/skills/projecta-workflow/SKILL.md`; nur die `.agents`-Fassung
+  bearbeiten, dann kopieren.
+
+Weitere Regeln schlägt [permissions-proposal.md](permissions-proposal.md) vor;
+eintragen tut sie der Nutzer.
+
+## Globale Einstellungen, die das Projekt voraussetzt
+
+In `~/.claude/settings.json` (nur Namen):
+
+- `permissions.defaultMode` = `auto` — der Auto-Mode-Klassifikator blockt u. a.
+  `git worktree remove` und `git branch -d`.
+- `env.MCP_TIMEOUT` — Startzeitlimit der MCP-Server.
+- `env.RUFLO_FUNNEL`, `env.CLAUDE_FLOW_MEMORY_PATH` — ruflo-Memory (optional).
+- `SessionEnd`-Hook → `scripts/session-end-hook.sh claude` (absoluter Pfad auf
+  den Hauptcheckout; funktioniert in Worktrees, weil das Skript mit
+  `git rev-parse` im aktuellen Verzeichnis arbeitet).
+
+## MCP-Server
+
+- Erwartet: `codebase-memory-mcp` (global in `~/.claude.json`).
+- Optional: `memorix`, `ruflo`, `desktop-commander` über Plugins. `ruflo` und
+  `desktop-commander` enden oft mit `CONNECT_TIMEOUT` — das ist kein Fehler
+  des Repos, die Sitzung arbeitet ohne sie weiter.
+- Ruflo-Memory ist nur für Claude sichtbar. Wissen, das alle Anbieter brauchen,
+  gehört ins Repo (`AGENTS.md`, `docs/decisions.md`, HQ-Lessons).
+
+## Worktrees und Build-Slots
+
+- Sitzungen laufen oft in `.claude/worktrees/<name>`. Der Stash-Stapel ist
+  geteilt: nie `git stash`, lieber WIP-Commit.
+- Worktrees haben kein `target/`. Vor jedem Commit (der `pre-commit`-Hook
+  fährt `cargo check`) und vor den Gates einen Build-Slot setzen:
+
+  ```sh
+  export CARGO_TARGET_DIR=%USERPROFILE%/cargo-targets/projecta-a   # oder -b, -c
+  export CARGO_BUILD_JOBS=1
+  bash scripts/ci/gates.sh lane prepush
+  ```
+
+  Höchstens 2–3 Builds gleichzeitig; vorher freien Arbeitsspeicher prüfen
+  (unter ~2,5 GB warten). **Nie `CARGO_PROFILE_*` setzen** — das entwertet den
+  ganzen Cache.
+- Eine Isolationsschranke für Subagenten lehnt verkettete Shell-Zeilen mit
+  `git` ab: einzelne `git -C <worktree> …`-Befehle verwenden.
+
+## Subagenten und Berichte
+
+Subagenten dürfen `.pa/report_*.md` unter Umständen nicht schreiben. Dann
+geben sie den Bericht als Text zurück, und der Koordinator committet ihn.
+Nicht umgehen (kein Schreiben über Umwege).
+
+## Advisor Fable 5.1
+
+Subagent mit `model: fable` und maximalem Effort. Worker dürfen ihn selbst
+rufen bei Nahtstellen-, Security- und Architekturentscheidungen und wenn sie
+länger als 30 Minuten feststecken; sonst über den Koordinator. Gegenstück:
+GPT-6 Astra über Codex ([codex.md](codex.md)).
+
+## Gotchas
+
+- **Nie Quelldateien mit PowerShell `Get-Content`/`Set-Content` umschreiben** —
+  Umlaute und Gedankenstriche gehen kaputt. Edit-Werkzeug oder Node verwenden.
+- **`| tail` verschluckt den Exit-Code** — Status ungemaskiert lesen.
+- **Push-Exit-Code ist nicht verlässlich** — Push mit `git ls-remote origin <branch>`
+  prüfen.
+- **KI-21:** ein globaler ruflo-Bash-Hook kann Befehle verändern; Status in
+  `KNOWN_ISSUES.md`.
diff --git a/docs/setup/codex.md b/docs/setup/codex.md
new file mode 100644
index 0000000..531d48a
--- /dev/null
+++ b/docs/setup/codex.md
@@ -0,0 +1,62 @@
+# Codex CLI (GPT-6 Astra)
+
+Rolle: Advisor für harte Entscheidungen, daneben Worker. Stand: Codex CLI
+0.154.0. Zurück zur Übersicht: [README.md](README.md).
+
+## Konfiguration `~/.codex/config.toml` (nur Felder)
+
+| Feld | Wert auf diesem PC | Bedeutung |
+|---|---|---|
+| `model` | `gpt-6-astra` | Standardmodell |
+| `model_reasoning_effort` | `medium` | global bewusst mittel — Worker bleiben günstig |
+| `approval_policy` | `never` | keine Rückfragen |
+| `sandbox_mode` | `danger-full-access` | volle Rechte im Dateisystem |
+| `[projects.'<ProjectA-Pfad>'] trust_level` | `trusted` | Projekt vertraut |
+| `[features] memories` | `true` | Codex-eigenes Gedächtnis |
+
+MCP-Server: `node_repl`, `codebase-memory-mcp`. `shell_environment_policy.set`
+trägt Kopien einiger Claude-Variablen — harmlos.
+
+## Advisor-Aufruf
+
+```sh
+codex exec -c model_reasoning_effort=high "<Frage mit vollständigem Kontext>"
+```
+
+Effort `high` nur per Aufruf, nie global. Wann Worker das selbst dürfen: siehe
+[README.md](README.md#advisors). Codex hat **keinen Zugriff auf ruflo-Memory**
+(MCP-Handshake scheitert) — den nötigen Kontext immer in den Auftragstext
+schreiben.
+
+## Instruktionen und Skills
+
+- `AGENTS.md` liest Codex selbst (Konvention, von der Projektwurzel aus).
+- `~/.codex/AGENTS.md` ist privat und projektfremd (persönliches
+  Verhaltensmodell) — gehört dem Nutzer, nicht dem Repo.
+- Repo-Skills: `.agents/skills/` (Codex-Konvention; hier `projecta-workflow`).
+  Globale Skills: `~/.codex/skills`, `~/.agents/skills`. Von der App
+  gestartete Codex-Worker bekommen keine Packs (eingebautes Profil: `skills`
+  = `unsupported`; `ConventionAt` nur per `agents.json`, PR #57).
+
+## Hooks `.codex/hooks.json` (lokal, gitignored)
+
+`.codex/` ist per `.gitignore` bewusst lokal. `hooks.json` hängt ein:
+
+- `PostToolUse` (Write|Edit) → `bash '<Hauptcheckout>\.codex\hooks\red-first.sh'`
+  (**absoluter Pfad**)
+- `SessionStart` → `bash scripts/install-hooks.sh` (relativ)
+
+Der absolute Pfad ist **richtig so** und soll nicht relativ werden: Weil
+`.codex/` gitignored ist, gibt es das Skript in Codex-Worktrees gar nicht — ein
+relativer Pfad liefe dort ins Leere. Das Skript selbst arbeitet mit
+`git rev-parse --show-toplevel` im aktuellen Verzeichnis, prüft also immer den
+Worktree, in dem Codex gerade arbeitet (geprüft 24.09.2026).
+
+## Belegte Eigenschaften
+
+- **Bilder:** `codex -i <datei>` — Codex kann Screenshots ansehen.
+- **Security-Themen:** Codex hat Sicherheitsaufgaben früher verweigert
+  („flagged for possible cybersecurity risk", `docs/development/WORKFLOW.md`).
+  Für GPT-6 Astra nicht neu belegt — Security-Lanes weiter an Claude.
+- **Prozessgruppe:** Codex räumt beim Befehlsende seine Prozessgruppe ab; per
+  `&` gestartete Hintergrundprozesse sterben mit. Abhilfe: `setsid`.
diff --git a/docs/setup/kimi.md b/docs/setup/kimi.md
new file mode 100644
index 0000000..be71dde
--- /dev/null
+++ b/docs/setup/kimi.md
@@ -0,0 +1,85 @@
+# Kimi Code CLI (Kimi K3)
+
+Rolle: Frontend-/HQ-Worker, Reviews. Zurück zur Übersicht: [README.md](README.md).
+
+## Welche Harness
+
+Die Harness ist **Kimi Code CLI 2.0** — `~/.kimi-code/bin/kimi.EXE`,
+Konfiguration `~/.kimi-code/config.toml`, Standardmodell `kimi-code/k3`.
+Andere Verzeichnisse `~/.kimi`, `~/.kimi-work`, `~/.kimi_openclaw`,
+`~/.kimi-webbridge` gehören zu anderen Produkten (Claw, OpenClaw,
+WebBridge-Daemon) und sind **nicht** die Harness.
+
+Relevante Felder in `config.toml` (nur Namen): `default_model`,
+`default_plan_mode = true`, `default_permission_mode`, Abschnitte
+`[providers.…]`, `[models.…]`. Selbstprüfung: `kimi doctor`.
+
+## Anmeldung: OAuth-Datei, kein API-Key
+
+- Der Kimi-Code-Provider `[providers."managed:kimi-code"]` meldet sich über
+  **OAuth** an: `[providers."managed:kimi-code".oauth] storage = "file"`, die
+  Zugangsdaten liegen unter `~/.kimi-code/credentials/`. Anmelden mit
+  `kimi login` (Device-Code-Ablauf).
+- `MOONSHOT_API_KEY` wird von dieser Konfiguration **nirgends** benutzt. Die
+  Annahme in `src-tauri/src/profiles.rs` („`MOONSHOT_API_KEY` for a Kimi …")
+  gilt für diese Harness nicht (Eingabe für W5-02b6).
+- Folge für eine Umgebungs-Allowlist (W5-02b6): Kimi braucht `USERPROFILE`,
+  `HOME`, `APPDATA`, `LOCALAPPDATA` (Zugriff auf `~/.kimi-code/credentials/`),
+  nicht `MOONSHOT_API_KEY`. Abnahme: `kimi -p "sieben mal sechs"` unter der
+  Allowlist-Umgebung muss `42` liefern.
+
+## Im Worker
+
+- Die App startet Kimi mit `--auto` (Never-Ask-Modus) und Repo-Skills über
+  `--skills-dir <dir>` (`src-tauri/src/profiles.rs`, `capabilities.rs`).
+- `default_plan_mode = true` startet interaktive Sitzungen im Plan-Modus.
+- `AGENTS.md` des Repos liest Kimi Code selbst; `~/.kimi-code/AGENTS.md` ist
+  eine globale, private Datei des Nutzers.
+- MCP: `codebase-memory-mcp` (`~/.kimi-code/mcp.json`).
+
+## Nutzeraufgabe: literale Keys aus `config.toml` entfernen
+
+`config.toml` enthält für drei Provider **literale API-Keys** im Klartext
+(`[providers.opencode]`, `[providers.anthropic]`, `[providers.openrouter]`, je
+Feld `api_key`). Das ist ein Sicherheitsbefund. Kimi Code kennt dafür das Feld
+**`api_key_env`**: es nennt den *Namen* einer Umgebungsvariable, aus der der
+Key gelesen wird. `api_key` und `api_key_env` schließen sich aus — pro Provider
+genau eines (Kimi-Code-Doku, *Configuration → Providers*).
+
+Diese Schritte macht **der Nutzer selbst**; kein Agent liest oder zeigt die
+Werte.
+
+1. **Sichern:** `config.toml` nach `config.toml.setup-a.bak` kopieren (der Name
+   `config.toml.bak` ist schon belegt) und die Sicherung nach Schritt 6
+   löschen (sie enthält die Keys).
+2. **Entscheiden, was bleibt.** Nach der Entscheidung „nur Abos, kein
+   OpenRouter" ist der OpenRouter-Key tot, der Anthropic-Key laut KI-22
+   ungenutzt. Abschnitte, die nicht mehr gebraucht werden, ganz entfernen —
+   am saubersten mit `kimi provider remove openrouter` bzw.
+   `kimi provider remove anthropic` (entfernt auch die Modell-Aliase, die
+   darauf zeigen).
+3. **Für jeden verbleibenden Provider** (voraussichtlich `opencode`) eine
+   Benutzer-Umgebungsvariable anlegen, z. B. `KIMI_OPENCODE_API_KEY`:
+   Windows → *Systemeigenschaften → Umgebungsvariablen → Benutzervariablen →
+   Neu*. Den Wert dort einfügen, nicht in eine Shell-Zeile (landet sonst in der
+   History).
+4. **In `config.toml`** im Abschnitt `[providers.opencode]` die Zeile
+   `api_key = "…"` löschen und stattdessen schreiben:
+
+   ```toml
+   api_key_env = "KIMI_OPENCODE_API_KEY"
+   ```
+
+   Mit einem Editor, der UTF-8 erhält (nicht PowerShell `Set-Content`).
+5. **Prüfen:** neues Terminal öffnen (damit die Variable geladen ist), dann
+   `kimi doctor` und `kimi -p "sieben mal sechs"` mit einem Modell dieses
+   Providers (`-m <alias>`). Erwartet: `42`.
+6. **Aufräumen:** `config.toml.setup-a.bak` löschen. Im selben Ordner liegen
+   ältere Sicherungen (`config.toml.bak`, `config.toml.bak-sessionhook`,
+   `config.toml.20260823-040800.bak`); sie enthalten sehr wahrscheinlich
+   dieselben Klartext-Keys — prüfen, ob noch gebraucht, sonst ebenfalls
+   löschen. Keys, die im Klartext gelegen haben, beim Anbieter **rotieren**
+   (neu erzeugen, alten widerrufen) — die Dateien lagen unverschlüsselt auf
+   der Platte.
+
+Der Provider `managed:kimi-code` bleibt unverändert (OAuth, leeres `api_key`).
diff --git a/docs/setup/mergify.md b/docs/setup/mergify.md
new file mode 100644
index 0000000..ea48850
--- /dev/null
+++ b/docs/setup/mergify.md
@@ -0,0 +1,74 @@
+# Mergify — die Merge-Queue für `main`
+
+`main` wird von der Mergify-Merge-Queue gemergt, nicht von Hand. Zurück zur
+Übersicht: [README.md](README.md).
+
+> **Stand 24.09.2026:** Mergify ist installiert, die Konfiguration
+> `.mergify.yml` kommt mit dem Paket **CI-01** (bis dahin gibt es nur den
+> Bot-PR #105 mit einem Stub). Die Labels `do-not-merge`, `priority` und
+> `conflict` sind im Repo noch **nicht angelegt** (`gh label list`). Regel- und
+> Labelnamen unten sind mit CI-01 abzugleichen, sobald es gemergt ist; bei
+> Abweichung gilt `.mergify.yml`.
+
+## Grundregeln
+
+- **Branch-Schutz:** Pflicht-Checks `gates (linux)`, `gates (windows)` und
+  `red-first`. „Strict up-to-date" ist **aus**: Die Queue testet jeden
+  Kandidaten auf dem aktuellen `main`. Also nicht rebasen oder `main`
+  hineinmergen, nur um CI zu befriedigen.
+- **Ein PR je Paket, erst am Ende.** Im eigenen Worktree arbeiten,
+  `bash scripts/ci/gates.sh lane prepush` lokal fahren, dann einmal pushen und
+  den PR öffnen. Jeder Push auf einen offenen PR kostet einen vollen Linux- und
+  Windows-Lauf.
+- **Draft = nicht fertig.** Als Draft öffnen, solange Bericht,
+  Review-Disposition oder der `NICHT ABGEDECKT`-Block fehlen; erst dann
+  `gh pr ready <n>`. Mergify reiht keinen Draft ein.
+
+## Labels
+
+| Label | Wer setzt es | Wirkung | Beispiel |
+|---|---|---|---|
+| `do-not-merge` | jeder | hält einen fertigen PR aus der Queue („Nutzer soll erst draufsehen") | `gh pr edit <n> --add-label do-not-merge` |
+| `priority` | nur der Koordinator | stellt den PR nach vorn (Hotfix, Blocker anderer Lanes) | `gh pr edit <n> --add-label priority` |
+| `conflict` | Mergify | PR merged nicht mehr sauber | Branch rebasen, pushen — das Label verschwindet von selbst |
+
+Entfernen: `gh pr edit <n> --remove-label <label>`.
+
+## Berichtsschutz
+
+Ein PR, der `src-tauri/`, `src/` oder `scripts/` ändert, kommt ohne seinen
+`.pa/report_<id>.md` nicht in die Queue — und bei Nahtstelle oder mehr als 300
+Diff-Zeilen nicht ohne die Review-Disposition. Fehlender Bericht = fehlender
+Beleg = kein Merge.
+
+## Freeze, Retry
+
+- **Freeze** nur manuell, nur für ein Release, nur durch den Nutzer
+  (Mergify-Dashboard). Niemand sonst friert ein oder taut auf.
+- **Flaky Jobs** werden automatisch wiederholt (Dashboard-Einstellung). Ein
+  roter Lauf, der kein bekannter Flake ist, bleibt rot: erst untersuchen, dann
+  neu pushen.
+
+## Nach dem Merge
+
+Der Branch wird automatisch gelöscht (`delete_branch_on_merge`). Der
+Koordinator trägt das Paket in `docs/ERLEDIGT.md` ein, entfernt den Worktree
+und setzt die Spec auf `historisch`. Einen gemergten Branchnamen nicht
+wiederverwenden. Im eigenen Worktree nach einem `main`-Merge die generierten
+Snapshots zurücksetzen: `git checkout -- docs/dev-hq/data.js docs/dev-hq/data.json`.
+
+## Hand-Merge
+
+Der Koordinator hat eine stehende Merge-Erlaubnis des Nutzers für fertige PRs
+(Stand 24.09.). Ob `gh pr merge` künftig ganz der Queue überlassen und per
+Deny-Regel gesperrt wird, entscheidet der Nutzer — siehe
+[permissions-proposal.md](permissions-proposal.md).
+
+## Warum steht mein PR nicht in der Queue?
+
+1. Er ist ein Draft → `gh pr ready <n>`.
+2. Er trägt `do-not-merge`.
+3. Ein Pflicht-Check ist rot oder fehlt (`gh pr checks <n>`).
+4. Der Bericht `.pa/report_<id>.md` oder die Disposition fehlt.
+5. Er trägt `conflict` → rebasen und pushen.
+6. Die Queue ist eingefroren (Release) — warten.
diff --git a/docs/setup/ollama-reviewers.md b/docs/setup/ollama-reviewers.md
new file mode 100644
index 0000000..ad6671b
--- /dev/null
+++ b/docs/setup/ollama-reviewers.md
@@ -0,0 +1,66 @@
+# Ollama-Reviewerpaar (kimi-k3 + glm-5.2)
+
+Rolle: das Alltags-Reviewerpaar für Pläne und Diffs (Regel in `AGENTS.md`:
+über 300 Zeilen oder Nahtstelle → zwei Reviews anderer Anbieter vor dem Merge).
+Zurück zur Übersicht: [README.md](README.md).
+
+## Voraussetzungen
+
+- Ollama läuft lokal (`http://127.0.0.1:11434`), angemeldet bei Ollama Cloud:
+  `ollama signin`.
+- Die beiden Modelle sind vorhanden: `ollama list` zeigt `kimi-k3:cloud` und
+  `glm-5.2:cloud` (sonst `ollama pull <modell>`). `npm run dev:agent-check`
+  prüft das.
+- `python` (3.x) für `.pa/review_transport.py`.
+- Kein Key: der lokale Ollama-Endpunkt braucht keinen `REVIEWER_n_KEY`.
+
+## Aufruf
+
+`.pa/review_transport.py` wird nur über Umgebungsvariablen konfiguriert
+(`REVIEWER_<n>_NAME`, `_KIND`, `_URL`, `_MODEL`, optional `_KEY`):
+
+```sh
+export REVIEWER_1_NAME=kimi-k3 REVIEWER_1_KIND=ollama \
+       REVIEWER_1_URL=http://127.0.0.1:11434/api/generate REVIEWER_1_MODEL=kimi-k3:cloud
+export REVIEWER_2_NAME=glm-5.2 REVIEWER_2_KIND=ollama \
+       REVIEWER_2_URL=http://127.0.0.1:11434/api/generate REVIEWER_2_MODEL=glm-5.2:cloud
+python .pa/review_transport.py .pa/review_prompt_<label>.md .pa <label> --author "<Instanz>"
+```
+
+- Ergebnis: `.pa/review_<label>_kimi-k3.md` und `.pa/review_<label>_glm-5.2.md`.
+- **Exit 0 nur, wenn jeder Reviewer geantwortet hat.** Exit 1 = mindestens ein
+  Reviewer ohne Urteil; das Protokoll hält den Ausfall fest. Nochmals laufen
+  lassen, nicht als Review werten.
+
+## Prompt
+
+Ollama-Reviewer lesen **kein** `AGENTS.md` und keinen Code außerhalb des
+Prompts. Die Prompt-Datei `.pa/review_prompt_<label>.md` muss deshalb alles
+enthalten:
+
+1. Auftrag und Paket-ID, Kandidat-Commit.
+2. Den vollständigen Diff bzw. die geänderten Dateien.
+3. Die Regeln, gegen die geprüft wird (Auszug aus `AGENTS.md`: Beweismaßstab,
+   Nahtstellen, keine Secrets, …).
+4. Das gewünschte Ausgabeformat: Befunde mit ID, Schwere, Datei:Zeile,
+   Begründung, Urteil (freigeben / freigeben mit Auflagen / ablehnen).
+
+Den Prompt mit einem Skript zusammensetzen, nicht per Shell-Umleitung: ein
+Hook-Ausgabe-Überschreiben hat schon einmal einen 238-Zeichen-Prompt erzeugt
+(`.pa/review_w2-02_disposition.md`). Antworten wie „keine Frage erkannt" sind
+kein Review.
+
+## Disposition
+
+Jeder Befund bekommt eine Zeile in `.pa/review_<label>_disposition.md`:
+ID, Quelle, Schwere, Befund, Disposition (angenommen mit Commit / abgelehnt mit
+Grund / Folgearbeit). Vorlage: `.pa/review_w2-02_disposition.md`. Ändert sich
+der Kandidat danach, wird das Delta erneut geprüft.
+
+## Reviewer oder Advisor?
+
+Das Ollama-Paar prüft Diffs und Pläne im Alltag. Für harte Entscheidungen und
+Abschlussreviews gilt das Advisor-Paar Fable 5.1 + GPT-6 Astra (siehe
+[README.md](README.md#advisors)). `.github/workflows/review.yml` (OpenRouter)
+ist ruhend — der Runner erreicht Ollama Cloud nicht, OpenRouter wird nicht
+mehr benutzt.
diff --git a/docs/setup/opencode.md b/docs/setup/opencode.md
new file mode 100644
index 0000000..48496c5
--- /dev/null
+++ b/docs/setup/opencode.md
@@ -0,0 +1,43 @@
+# OpenCode
+
+Rolle: Docs, Skripte, Zweitreview (GLM, DeepSeek). Stand: OpenCode 1.18.32.
+Zurück zur Übersicht: [README.md](README.md).
+
+## Konfiguration `~/.config/opencode/opencode.jsonc` (nur Struktur)
+
+- MCP-Server `codebase-memory-mcp`.
+- Provider `ollama` (lokaler Endpunkt `127.0.0.1:11434/v1`) mit den Modellen
+  `kimi-k2.7-code:cloud`, `glm-5.2:cloud`, `qwen3.8:latest`.
+- Login-Zustand für den OpenCode-eigenen Weg (Zen / „OpenCode Go"):
+  `~/.local/share/opencode/auth.json` (nur Präsenz prüfen, nie Inhalt zeigen).
+- Kein `model`-Default, keine `instructions`, keine projektspezifischen Agents.
+
+**Lücken (Nutzeraufgabe, prüfen):**
+
+- `deepseek-v4-flash:cloud` steht **nicht** im `ollama`-Provider dieser
+  Konfiguration, ist also in OpenCode nicht wählbar. Das Modell selbst ist in
+  Ollama vorhanden (`ollama list`); das App-Profil `ollama-coder` startet es
+  direkt über `ollama run`, nicht über OpenCode. Wer DeepSeek als
+  OpenCode-Worker will (W2-09b), trägt es unter `provider.ollama.models` ein.
+- Das App-Profil `opencode-glm-53-flash` ruft `opencode -m
+  opencode-go/glm-5.3-flash`. Ob das Modell über den OpenCode-Go-Login
+  erreichbar ist, zeigt `opencode models` — auf diesem PC nicht belegt.
+
+## Instruktionen und Skills
+
+- `AGENTS.md` liest OpenCode selbst aus der Projektwurzel. Ein Repo-`.opencode/`
+  ist nicht nötig.
+- Repo-Skills: ob OpenCode `.agents/skills/` von selbst findet, ist nicht
+  belegt (Probe W1-18b offen). Die App stellt OpenCode-Workern keine Packs
+  bereit (eingebautes Profil: `skills` = `unsupported`); per `agents.json`
+  ließe sich `ConventionAt` setzen (PR #57). Globale Skills unter
+  `~/.config/opencode/`.
+
+## Belegte Eigenschaften
+
+- **Pfadgrenze:** OpenCode verweigert jeden Pfad außerhalb seines
+  Arbeitsordners, auch `/tmp` — und dann **den ganzen Befehl**, nicht nur den
+  Zugriff. Temporäres in den eigenen Arbeitsordner legen.
+- **Keine Bilder** (keine Screenshot-Prüfung über OpenCode).
+- **Zustellung per PTY belegt** (PR #66) auf der Default-Route; der
+  DeepSeek-Worker-Adapter ist W2-09b und offen.
diff --git a/docs/setup/permissions-proposal.md b/docs/setup/permissions-proposal.md
new file mode 100644
index 0000000..d21aa8b
--- /dev/null
+++ b/docs/setup/permissions-proposal.md
@@ -0,0 +1,101 @@
+# Vorschlag: Berechtigungsregeln für Claude Code
+
+**Status: Vorschlag.** Der Nutzer entscheidet und trägt ein; kein Agent ändert
+`.claude/settings.json` oder `.claude/settings.local.json` selbst. Zurück zur
+Übersicht: [README.md](README.md).
+
+## Wo
+
+Empfohlen: Repo-`.claude/settings.json` (per PR nachvollziehbar, gilt für jede
+Claude-Sitzung im Repo, auch in Worktrees). Alternativen: `~/.claude/settings.json`
+(nur dieser PC) oder `.claude/settings.local.json` (lokal, ungetrackt).
+
+Die Regeln unten **ergänzen** die bestehende Allow-Liste (lesende git-, cargo-
+und npm-Befehle) und lassen die Hooks unverändert. Eine Änderung an
+`.claude/settings.json` braucht einen Commit-Trailer (`No-Test:` mit Grund).
+
+## Regeln
+
+Skripte, die in dieser Liste stehen, aber noch nicht existieren
+(`scripts/dev/prune-worktrees.sh`, `report-commit.sh`, `push-verified.sh`,
+`ci-watch.sh`, `pr-status.mjs`, `erledigt-row.mjs`, `spec-close.mjs`,
+`scripts/review/run-local.sh`), kommen aus den Paketen SETUP-08a/08b/09. Ihre
+Regeln erst eintragen, wenn das jeweilige Skript gemergt ist.
+
+```jsonc
+{
+  "permissions": {
+    "allow": [
+      // Repo-Skripte (Default jeweils Dry-Run bzw. nur lesend)
+      "Bash(node scripts/dev/agent-setup-check.mjs *)",   // nur lesend, existiert
+      "Bash(npm run dev:agent-check)", "Bash(npm run dev:agent-check *)",
+      "Bash(bash scripts/ci/gates.sh *)",                  // Gates lokal
+      "Bash(bash scripts/ci/doctor.sh)",
+      "Bash(bash scripts/dev/prune-worktrees.sh *)",      // siehe Hinweis 1
+      "Bash(bash scripts/dev/report-commit.sh *)",        // commit+push auf den genannten Branch, nie main
+      "Bash(bash scripts/dev/push-verified.sh *)",
+      "Bash(bash scripts/dev/ci-watch.sh *)",
+      "Bash(bash scripts/review/run-local.sh *)",         // nur lokaler Ollama-Endpunkt
+      "Bash(node scripts/dev/pr-status.mjs *)",
+      "Bash(node scripts/dev/erledigt-row.mjs *)",
+      "Bash(node scripts/dev/spec-close.mjs *)",
+      "Bash(python .pa/review_transport.py *)",
+
+      // git, lesend bzw. ohne Datenverlust
+      "Bash(git fetch *)", "Bash(git ls-remote *)", "Bash(git rev-parse *)",
+      "Bash(git worktree prune)",
+      "Bash(git checkout -- docs/dev-hq/data.js docs/dev-hq/data.json)",
+      // nur wenn Aufräumen NICHT ausschließlich über das Skript laufen soll:
+      "Bash(git worktree remove *)",                       // ohne --force verweigert git bei Änderungen
+      "Bash(git branch -d *)",                             // nur gemergte Branches; -D bleibt gesperrt
+
+      // gh, lesend + PR-Verwaltung
+      "Bash(gh pr view *)", "Bash(gh pr list *)", "Bash(gh pr checks *)", "Bash(gh pr diff *)",
+      "Bash(gh run list *)", "Bash(gh run view *)", "Bash(gh release list *)", "Bash(gh label list *)",
+      "Bash(gh pr create *)", "Bash(gh pr ready *)", "Bash(gh pr edit *)",
+
+      // Berichte und Plan-Buchführung
+      "Write(.pa/report_*.md)", "Edit(.pa/report_*.md)",
+      "Write(.pa/review_*.md)",
+      "Write(.pa/task_*.md)", "Edit(.pa/task_*.md)",
+      "Edit(docs/ERLEDIGT.md)", "Edit(docs/MASTERPLAN.md)", "Edit(.pa/ACTIVITY.md)"
+    ],
+    "deny": [
+      "Bash(git stash)", "Bash(git stash *)",              // geteilter Stash-Stapel
+      "Bash(git push --force *)", "Bash(git push -f *)", "Bash(git push --force-with-lease *)",
+      "Bash(git reset --hard *)",
+      "Bash(git commit --no-verify *)", "Bash(git push --no-verify *)",
+      "Bash(git worktree remove --force *)", "Bash(git branch -D *)",
+      "Edit(.claude/settings.json)", "Edit(.claude/settings.local.json)"
+      // optional, siehe Hinweis 2:
+      // "Bash(gh pr merge *)"
+    ]
+  }
+}
+```
+
+Für die PowerShell-Werkzeuge gelten dieselben Regeln mit `PowerShell(…)` statt
+`Bash(…)`; die bestehende Datei führt beide Formen.
+
+## Hinweise
+
+1. **Prune-Umfang.** `prune-worktrees.sh` (SETUP-08a) soll mit `--dry-run` als
+   Standard laufen, nie `--force` benutzen und nur Worktrees entfernen, deren
+   Branch-PR gemergt ist (Prüfung über `gh`): `.claude/worktrees/*`,
+   `.worktrees/*` **und gemergte Codex-Worktrees** (`~/.codex/worktrees/*`,
+   `.projecta-worktrees/codex-pr*`). App-eigene `pa/wk-*`-Worktrees bleiben
+   außen vor (die App-Datenbank verweist auf sie).
+2. **`gh pr merge` sperren — Nutzerentscheidung.** Wenn die Mergify-Queue der
+   einzige Merge-Weg sein soll, gehört `Bash(gh pr merge *)` in `deny`. Der
+   Koordinator hat heute eine stehende Merge-Erlaubnis des Nutzers für fertige
+   PRs; mit der Deny-Regel entfällt sie, Hand-Merges macht dann nur noch der
+   Nutzer. Ohne Mergify als Merge-Weg die Regel weglassen.
+3. **Auto-Mode.** Ob explizite Allow-Regeln den Auto-Mode-Klassifikator bei
+   `git worktree remove` wirklich übersteuern, ist noch nicht belegt. Nach dem
+   Eintragen einmal an einem Wegwerf-Worktree prüfen.
+4. **`Edit(.claude/settings*.json)` in `deny`** schützt vor
+   Selbstberechtigung: Neue Rechte kommen nur vom Nutzer.
+5. **Grenzen der Deny-Regeln.** Die Muster greifen auf den Befehlsanfang.
+   `git push origin x --force` (Flag hinten) fällt nicht unter
+   `Bash(git push --force *)`. Die Deny-Liste ist eine Leitplanke, kein
+   Ersatz für den Branch-Schutz auf GitHub.
diff --git a/package.json b/package.json
index bc0b291..42e45b4 100644
--- a/package.json
+++ b/package.json
@@ -11,6 +11,7 @@
     "dev:setup": "node scripts/dev-setup.mjs --apply",
     "dev:benchmark": "node scripts/dev-benchmark.mjs",
     "dev:continuous-audit": "node scripts/continuous-audit.mjs",
+    "dev:agent-check": "node scripts/dev/agent-setup-check.mjs",
     "dev": "vite",
     "build": "tsc --noEmit && node scripts/contrast-check.mjs && node scripts/spec-status-check.mjs && vite build",
     "preview": "vite preview",
diff --git a/scripts/dev/agent-setup-check.mjs b/scripts/dev/agent-setup-check.mjs
new file mode 100644
index 0000000..289e7dd
--- /dev/null
+++ b/scripts/dev/agent-setup-check.mjs
@@ -0,0 +1,294 @@
+#!/usr/bin/env node
+// SETUP-02 — agent setup check: "is this machine ready for an agent to work on
+// ProjectA?" Read-only. It never prints the content of a config file, only
+// whether the file exists, and it never changes anything.
+//
+//   npm run dev:agent-check            # text
+//   npm run dev:agent-check -- --json  # machine-readable
+//
+// Exit code 1 only when a mandatory check fails (node, git, gh, cargo,
+// AGENTS.md + its import in CLAUDE.md, core.hooksPath, identical skill
+// copies). Everything else — optional harnesses, reviewer models, gh login,
+// build slots, config presence — is a warning: a docs-only machine may
+// legitimately lack Kimi or a cargo build slot.
+//
+// Structure: collect() is the only function that touches the machine, through
+// injected probes; evaluate() is pure. The test drives both with a fake
+// environment (scripts/lib/agent-setup-check.test.mjs), so it needs neither
+// the binaries nor the network. Setup documentation: docs/setup/README.md.
+import { existsSync, readFileSync } from "node:fs";
+import { spawnSync } from "node:child_process";
+import { homedir } from "node:os";
+import { join, resolve, dirname } from "node:path";
+import { fileURLToPath, pathToFileURL } from "node:url";
+
+export const REVIEWER_MODELS = ["kimi-k3:cloud", "glm-5.2:cloud"];
+export const BUILD_SLOTS = ["projecta-a", "projecta-b", "projecta-c"];
+const SKILL_AGENTS = ".agents/skills/projecta-workflow/SKILL.md";
+const SKILL_CLAUDE = ".claude/skills/projecta-workflow/SKILL.md";
+
+// Fixed allow list: the only programs collect() may start, each with fixed
+// arguments. `--version` output is local; `gh auth status` and `ollama list`
+// talk to the local keyring / local Ollama daemon.
+const OPTIONAL_BINARIES = {
+  "cargo-nextest": { args: ["nextest", "--version"], cmd: "cargo", why: "rust-suite gate (cargo nextest run --profile ci)", fix: "cargo install cargo-nextest --locked" },
+  python: { args: ["--version"], why: ".pa/review_transport.py (Ollama reviews)", fix: "Install Python 3 and make `python` resolve on PATH." },
+  claude: { args: ["--version"], why: "Claude Code harness", fix: "See docs/setup/claude-code.md." },
+  codex: { args: ["--version"], why: "Codex CLI harness / GPT-6 Astra advisor", fix: "See docs/setup/codex.md." },
+  opencode: { args: ["--version"], why: "OpenCode harness", fix: "See docs/setup/opencode.md." },
+  kimi: { args: ["--version"], why: "Kimi Code CLI harness", fix: "See docs/setup/kimi.md." },
+  ollama: { args: ["--version"], why: "reviewer pair via Ollama Cloud", fix: "See docs/setup/ollama-reviewers.md." },
+};
+const REQUIRED_BINARIES = {
+  git: { args: ["--version"], fix: "Install git." },
+  gh: { args: ["--version"], fix: "Install the GitHub CLI (https://cli.github.com); PRs are opened with gh." },
+  cargo: { args: ["--version"], fix: "Install rustup (https://rustup.rs); every gate lane runs cargo." },
+};
+
+const CONFIGS = {
+  claudeSettings: "~/.claude/settings.json",
+  codexConfig: "~/.codex/config.toml",
+  opencodeConfig: "~/.config/opencode/opencode.jsonc",
+  kimiConfig: "~/.kimi-code/config.toml",
+  kimiCredentials: "~/.kimi-code/credentials/",
+};
+
+const ok = (detail) => ({ state: "ok", detail, fix: null });
+const warn = (detail, fix) => ({ state: "warn", detail, fix });
+const fail = (detail, fix) => ({ state: "fail", detail, fix });
+const normalize = (text) => String(text).replace(/\r\n/g, "\n");
+
+// `@AGENTS.md` imports only as a line of its own (Claude Code import syntax);
+// inside backticks or prose it is text, not an import.
+export function hasAgentsImport(claudeMd) {
+  if (typeof claudeMd !== "string") return false;
+  return normalize(claudeMd).split("\n").some((line) => line.trim() === "@AGENTS.md");
+}
+
+function binaryCheck(name, spec, required) {
+  return {
+    id: `bin-${name}`,
+    label: `${name} on PATH`,
+    required,
+    run: (p) => {
+      const version = p.binaries?.[name];
+      if (version) return ok(version);
+      return required ? fail(`${name} not found`, spec.fix) : warn(`${name} not found — needed for ${spec.why}`, spec.fix);
+    },
+  };
+}
+
+export const CHECKS = [
+  {
+    id: "node",
+    label: "Node.js >= 24",
+    required: true,
+    run: (p) => {
+      const major = Number(String(p.nodeVersion || "").replace(/^v/, "").split(".")[0]);
+      return major >= 24 ? ok(`node ${p.nodeVersion}`) : fail(`node ${p.nodeVersion || "missing"}`, "Install Node.js 24 or newer, then npm ci.");
+    },
+  },
+  ...Object.entries(REQUIRED_BINARIES).map(([name, spec]) => binaryCheck(name, spec, true)),
+  ...Object.entries(OPTIONAL_BINARIES).map(([name, spec]) => binaryCheck(name, spec, false)),
+  {
+    id: "agents-md",
+    label: "AGENTS.md at the repository root",
+    required: true,
+    run: (p) => (p.agentsMd ? ok("AGENTS.md present") : fail("AGENTS.md missing", "Run from the repository root of a ProjectA checkout.")),
+  },
+  {
+    id: "claude-md-import",
+    label: "CLAUDE.md imports AGENTS.md",
+    required: true,
+    run: (p) =>
+      hasAgentsImport(p.claudeMd)
+        ? ok("@AGENTS.md import line present")
+        : fail(p.claudeMd == null ? "CLAUDE.md missing" : "no `@AGENTS.md` line in CLAUDE.md", "Add a line containing only @AGENTS.md at the top of CLAUDE.md; Claude Code does not read AGENTS.md on its own."),
+  },
+  {
+    id: "hooks-path",
+    label: "git core.hooksPath points at .githooks",
+    required: true,
+    run: (p) => {
+      const value = String(p.hooksPath || "").trim().replace(/[\\/]+$/, "");
+      return /(^|[\\/])\.githooks$/.test(value)
+        ? ok(`core.hooksPath=${value}`)
+        : fail(`core.hooksPath=${value || "(unset)"}`, "npm run dev:setup  (or: git config core.hooksPath .githooks)");
+    },
+  },
+  {
+    id: "skill-copies",
+    label: "projecta-workflow skill: both copies identical",
+    required: true,
+    run: (p) => {
+      if (p.skillAgents == null || p.skillClaude == null) {
+        const missing = [p.skillAgents == null && SKILL_AGENTS, p.skillClaude == null && SKILL_CLAUDE].filter(Boolean).join(", ");
+        return fail(`missing: ${missing}`, `Restore the file from git; ${SKILL_AGENTS} and ${SKILL_CLAUDE} must both exist.`);
+      }
+      return normalize(p.skillAgents) === normalize(p.skillClaude)
+        ? ok(`${SKILL_AGENTS} == ${SKILL_CLAUDE}`)
+        : fail(`${SKILL_AGENTS} and ${SKILL_CLAUDE} differ`, `Edit ${SKILL_AGENTS}, then copy it over ${SKILL_CLAUDE} (byte-identical apart from line endings).`);
+    },
+  },
+  {
+    id: "gh-auth",
+    label: "gh is logged in",
+    required: false,
+    run: (p) => (p.ghAuth ? ok("gh auth status: logged in") : warn("gh auth status: not logged in (or gh missing)", "gh auth login")),
+  },
+  {
+    id: "reviewer-models",
+    label: "Ollama reviewer pair available",
+    required: false,
+    run: (p) => {
+      const have = new Set(p.ollamaModels || []);
+      const missing = REVIEWER_MODELS.filter((m) => !have.has(m));
+      if (missing.length === 0) return ok(REVIEWER_MODELS.join(" + "));
+      return warn(`missing: ${missing.join(", ")}`, `ollama signin; ${missing.map((m) => `ollama pull ${m}`).join("; ")}`);
+    },
+  },
+  {
+    id: "build-slots",
+    label: "cargo build slots (Windows)",
+    required: false,
+    run: (p) => {
+      if (p.platform !== "win32") return ok("not used on this platform");
+      const missing = BUILD_SLOTS.filter((s) => !p.slots?.[s]);
+      if (missing.length === 0) return ok(`${BUILD_SLOTS.join(", ")} under ${p.slotRoot}`);
+      return warn(`missing under ${p.slotRoot}: ${missing.join(", ")}`, "Build slots are warm copies of target/ (docs/setup/claude-code.md); without them set CARGO_TARGET_DIR yourself. Never set CARGO_PROFILE_*.");
+    },
+  },
+  {
+    id: "configs",
+    label: "harness config files present (names only)",
+    required: false,
+    run: (p) => {
+      const missing = Object.entries(CONFIGS).filter(([key]) => !p.configs?.[key]).map(([, path]) => path);
+      if (missing.length === 0) return ok(Object.values(CONFIGS).join(", "));
+      return warn(`not found: ${missing.join(", ")}`, "Only needed for the harnesses you run; see docs/setup/.");
+    },
+  },
+];
+
+export function evaluate(probe) {
+  const checks = CHECKS.map((check) => {
+    let outcome;
+    try {
+      outcome = check.run(probe);
+    } catch (error) {
+      outcome = { state: check.required ? "fail" : "warn", detail: `check crashed: ${error.message}`, fix: null };
+    }
+    return { id: check.id, label: check.label, required: check.required, ...outcome };
+  });
+  const counts = { ok: 0, warn: 0, fail: 0 };
+  for (const c of checks) counts[c.state] += 1;
+  return { ok: counts.fail === 0, counts, checks };
+}
+
+export function exitCode(result) {
+  return result.ok ? 0 : 1;
+}
+
+export function formatText(result) {
+  const lines = ["agent-setup-check (docs/setup/README.md)", ""];
+  for (const c of result.checks) {
+    lines.push(`[${c.state}] ${c.id}${c.required ? " (mandatory)" : ""}: ${c.detail}`);
+    if (c.fix && c.state !== "ok") lines.push(`       fix: ${c.fix}`);
+  }
+  lines.push("", `ok ${result.counts.ok} · warn ${result.counts.warn} · fail ${result.counts.fail} — ${result.ok ? "ready" : "NOT ready (mandatory check failed)"}`);
+  return lines.join("\n") + "\n";
+}
+
+function firstLine(text) {
+  return String(text || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || null;
+}
+
+// The only place that touches the machine. Every dependency is injectable.
+export function collect({
+  root = process.cwd(),
+  home = homedir(),
+  env = process.env,
+  platform = process.platform,
+  nodeVersion = process.version,
+  exists = existsSync,
+  readFile = (p) => readFileSync(p, "utf8"),
+  run = defaultRun(platform),
+} = {}) {
+  const readOrNull = (p) => {
+    try {
+      return readFile(p);
+    } catch {
+      return null;
+    }
+  };
+  const version = (cmd, args) => {
+    const res = run(cmd, args);
+    return res && res.status === 0 ? firstLine(res.stdout) || firstLine(res.stderr) : null;
+  };
+
+  const binaries = {};
+  for (const [name, spec] of Object.entries({ ...REQUIRED_BINARIES, ...OPTIONAL_BINARIES })) {
+    binaries[name] = version(spec.cmd || name, spec.args);
+  }
+
+  const hooks = run("git", ["config", "--get", "core.hooksPath"]);
+  // Asked directly, not gated on `--version`: a missing binary simply fails.
+  const gh = run("gh", ["auth", "status"]);
+  const ollama = run("ollama", ["list"]);
+  const ollamaModels =
+    ollama && ollama.status === 0
+      ? String(ollama.stdout || "")
+          .split(/\r?\n/)
+          .slice(1)
+          .map((l) => l.trim().split(/\s+/)[0])
+          .filter(Boolean)
+      : [];
+
+  const at = (rel) => join(root, ...rel.split("/"));
+  const inHome = (tilde) => join(home, ...tilde.replace(/^~\//, "").split("/").filter(Boolean));
+  const configs = {};
+  for (const [key, path] of Object.entries(CONFIGS)) configs[key] = Boolean(exists(inHome(path)));
+
+  const slotRoot = env.PROJECTA_BUILD_SLOTS_ROOT || join(home, "cargo-targets");
+  const slots = {};
+  for (const s of BUILD_SLOTS) slots[s] = Boolean(exists(join(slotRoot, s)));
+
+  return {
+    platform,
+    nodeVersion,
+    binaries,
+    agentsMd: Boolean(exists(at("AGENTS.md"))),
+    claudeMd: readOrNull(at("CLAUDE.md")),
+    hooksPath: hooks && hooks.status === 0 ? firstLine(hooks.stdout) : null,
+    skillAgents: readOrNull(at(SKILL_AGENTS)),
+    skillClaude: readOrNull(at(SKILL_CLAUDE)),
+    configs,
+    ollamaModels,
+    ghAuth: Boolean(gh && gh.status === 0),
+    slotRoot,
+    slots,
+  };
+}
+
+function defaultRun(platform) {
+  const options = { encoding: "utf8", timeout: 15000, windowsHide: true };
+  // npm-installed CLIs (codex, opencode) are .cmd shims on Windows, which
+  // spawnSync only starts through a shell. cmd and args are fixed literals
+  // from the tables above, never user input, so one joined command line is safe.
+  if (platform === "win32") return (cmd, args) => spawnSync([cmd, ...args].join(" "), { ...options, shell: true });
+  return (cmd, args) => spawnSync(cmd, args, options);
+}
+
+export function main(argv = process.argv.slice(2), { probe = () => collect({ root: repoRoot() }), write = (s) => process.stdout.write(s) } = {}) {
+  const result = evaluate(probe());
+  write(argv.includes("--json") ? JSON.stringify(result, null, 2) + "\n" : formatText(result));
+  return exitCode(result);
+}
+
+function repoRoot() {
+  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
+}
+
+if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
+  process.exitCode = main();
+}
diff --git a/scripts/lib/agent-setup-check.test.mjs b/scripts/lib/agent-setup-check.test.mjs
new file mode 100644
index 0000000..a2afea4
--- /dev/null
+++ b/scripts/lib/agent-setup-check.test.mjs
@@ -0,0 +1,239 @@
+// SETUP-02: the agent setup check must be provable without this machine.
+// Every test injects a fake environment — no binary is spawned, no network is
+// touched, no path separator is assumed — so the file runs the same in
+// `npm run test:hq` on Windows and on the Linux CI runner.
+import { test } from "node:test";
+import assert from "node:assert/strict";
+import { join } from "node:path";
+import {
+  CHECKS,
+  REVIEWER_MODELS,
+  BUILD_SLOTS,
+  evaluate,
+  exitCode,
+  collect,
+  formatText,
+  main,
+} from "../dev/agent-setup-check.mjs";
+
+const SKILL = "---\nname: projecta-workflow\ndescription: x\n---\nbody\n";
+
+const healthy = {
+  platform: "win32",
+  nodeVersion: "v24.19.0",
+  binaries: {
+    git: "git version 2.51.0",
+    gh: "gh version 2.97.0",
+    cargo: "cargo 1.98.0",
+    "cargo-nextest": "cargo-nextest 0.9.146",
+    python: "Python 3.13.14",
+    claude: "2.3.0 (Claude Code)",
+    codex: "codex-cli 0.154.0",
+    opencode: "1.18.32",
+    kimi: "kimi, version 2.0.0",
+    ollama: "ollama version is 0.30.1",
+  },
+  agentsMd: true,
+  claudeMd: "@AGENTS.md\n\n# CLAUDE.md\n",
+  hooksPath: ".githooks",
+  skillAgents: SKILL,
+  skillClaude: SKILL,
+  configs: {
+    claudeSettings: true,
+    codexConfig: true,
+    opencodeConfig: true,
+    kimiConfig: true,
+    kimiCredentials: true,
+  },
+  ollamaModels: ["kimi-k3:cloud", "glm-5.2:cloud", "qwen3.8:latest"],
+  ghAuth: true,
+  slotRoot: "/slots",
+  slots: { "projecta-a": true, "projecta-b": true, "projecta-c": true },
+};
+
+const byId = (result, id) => result.checks.find((c) => c.id === id);
+
+test("healthy machine passes every mandatory check", () => {
+  const result = evaluate(healthy);
+  assert.equal(result.ok, true);
+  assert.equal(result.counts.fail, 0);
+  assert.equal(result.checks.length, CHECKS.length);
+  assert.ok(
+    result.checks.every((c) => c.state === "ok"),
+    JSON.stringify(result.checks.filter((c) => c.state !== "ok")),
+  );
+  assert.equal(exitCode(result), 0);
+});
+
+test("missing AGENTS import in CLAUDE.md is a mandatory failure", () => {
+  const result = evaluate({ ...healthy, claudeMd: "# CLAUDE.md\n\nLies AGENTS.md\n" });
+  assert.equal(result.ok, false);
+  const check = byId(result, "claude-md-import");
+  assert.equal(check.state, "fail");
+  assert.equal(check.required, true);
+  assert.match(check.fix, /@AGENTS\.md/);
+  assert.equal(exitCode(result), 1);
+});
+
+test("an import that is only mentioned in prose does not count", () => {
+  const result = evaluate({ ...healthy, claudeMd: "# CLAUDE.md\n\nUse `@AGENTS.md` some day.\n" });
+  assert.equal(byId(result, "claude-md-import").state, "fail");
+});
+
+test("diverging skill copies fail and name both paths", () => {
+  const result = evaluate({ ...healthy, skillClaude: SKILL + "drift\n" });
+  const check = byId(result, "skill-copies");
+  assert.equal(check.state, "fail");
+  assert.match(check.detail, /\.agents\/skills\/projecta-workflow\/SKILL\.md/);
+  assert.match(check.detail, /\.claude\/skills\/projecta-workflow\/SKILL\.md/);
+  assert.equal(result.ok, false);
+});
+
+test("line ending differences between skill copies are not drift", () => {
+  const result = evaluate({ ...healthy, skillClaude: SKILL.replace(/\n/g, "\r\n") });
+  assert.equal(byId(result, "skill-copies").state, "ok");
+});
+
+test("a missing skill copy fails", () => {
+  const result = evaluate({ ...healthy, skillAgents: null });
+  assert.equal(byId(result, "skill-copies").state, "fail");
+});
+
+test("hooks path accepts the relative and the absolute githooks form", () => {
+  assert.equal(byId(evaluate(healthy), "hooks-path").state, "ok");
+  const abs = evaluate({ ...healthy, hooksPath: "C:\\Users\\x\\ProjectA\\.githooks" });
+  assert.equal(byId(abs, "hooks-path").state, "ok");
+  const unset = evaluate({ ...healthy, hooksPath: null });
+  assert.equal(byId(unset, "hooks-path").state, "fail");
+  assert.match(byId(unset, "hooks-path").fix, /dev:setup|core\.hooksPath/);
+});
+
+test("old node fails, missing optional harness only warns", () => {
+  const result = evaluate({
+    ...healthy,
+    nodeVersion: "v22.1.0",
+    binaries: { ...healthy.binaries, kimi: null, opencode: null },
+  });
+  assert.equal(byId(result, "node").state, "fail");
+  assert.equal(byId(result, "bin-kimi").state, "warn");
+  assert.equal(byId(result, "bin-opencode").state, "warn");
+  assert.equal(result.counts.fail, 1);
+  assert.equal(exitCode(result), 1);
+});
+
+test("missing reviewer model warns with the pull command and never fails", () => {
+  const result = evaluate({ ...healthy, ollamaModels: ["kimi-k3:cloud"] });
+  const check = byId(result, "reviewer-models");
+  assert.equal(check.state, "warn");
+  assert.equal(check.required, false);
+  assert.match(check.detail, /glm-5\.2:cloud/);
+  assert.match(check.fix, /ollama pull glm-5\.2:cloud/);
+  assert.equal(result.ok, true);
+  assert.deepEqual(REVIEWER_MODELS, ["kimi-k3:cloud", "glm-5.2:cloud"]);
+});
+
+test("unauthenticated gh and missing build slots are warnings", () => {
+  const result = evaluate({ ...healthy, ghAuth: false, slots: { "projecta-a": true } });
+  assert.equal(byId(result, "gh-auth").state, "warn");
+  const slots = byId(result, "build-slots");
+  assert.equal(slots.state, "warn");
+  assert.match(slots.detail, /projecta-b/);
+  assert.equal(result.ok, true);
+  assert.deepEqual(BUILD_SLOTS, ["projecta-a", "projecta-b", "projecta-c"]);
+});
+
+test("build slots are not expected on linux", () => {
+  const result = evaluate({ ...healthy, platform: "linux", slots: {} });
+  assert.equal(byId(result, "build-slots").state, "ok");
+});
+
+test("config presence reports names only, never content", () => {
+  const result = evaluate({ ...healthy, configs: { ...healthy.configs, kimiCredentials: false } });
+  const check = byId(result, "configs");
+  assert.equal(check.state, "warn");
+  assert.match(check.detail, /\.kimi-code\/credentials/);
+  const text = JSON.stringify(result);
+  assert.doesNotMatch(text, /api_key|sk-|token=/i);
+});
+
+// collect() is the only function that touches the machine; here the machine
+// is a fake: a command table and an in-memory file system.
+function fakeMachine({ files = {}, dirs = [], commands = {} } = {}) {
+  const calls = [];
+  return {
+    calls,
+    deps: {
+      root: "/repo",
+      home: "/home/u",
+      env: {},
+      platform: "linux",
+      nodeVersion: "v24.19.0",
+      exists: (p) => p in files || dirs.includes(p),
+      readFile: (p) => {
+        if (!(p in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
+        return files[p];
+      },
+      run: (cmd, args) => {
+        calls.push([cmd, ...args].join(" "));
+        const hit = commands[[cmd, ...args].join(" ")];
+        return hit ?? { status: null, stdout: "", stderr: "", error: new Error("ENOENT") };
+      },
+    },
+  };
+}
+
+test("collect reads the repo and machine through injected probes only", () => {
+  const ok = (stdout) => ({ status: 0, stdout, stderr: "" });
+  const machine = fakeMachine({
+    files: {
+      [join("/repo", "CLAUDE.md")]: "@AGENTS.md\n",
+      [join("/repo", "AGENTS.md")]: "# AGENTS.md\n",
+      [join("/repo", ".agents", "skills", "projecta-workflow", "SKILL.md")]: SKILL,
+      [join("/repo", ".claude", "skills", "projecta-workflow", "SKILL.md")]: SKILL,
+      [join("/home/u", ".codex", "config.toml")]: "secret = 1\n",
+    },
+    commands: {
+      "git --version": ok("git version 2.51.0\n"),
+      "git config --get core.hooksPath": ok(".githooks\n"),
+      "gh --version": ok("gh version 2.97.0 (2026-09-01)\nhttps://github.com/cli/cli\n"),
+      "gh auth status": ok("Logged in\n"),
+      "cargo --version": ok("cargo 1.98.0\n"),
+      "ollama list": ok("NAME ID SIZE MODIFIED\nkimi-k3:cloud 630e - 5 weeks ago\nglm-5.2:cloud 7e91 - 5 weeks ago\n"),
+    },
+  });
+  const probe = collect(machine.deps);
+  assert.equal(probe.claudeMd, "@AGENTS.md\n");
+  assert.equal(probe.agentsMd, true);
+  assert.equal(probe.hooksPath, ".githooks");
+  assert.equal(probe.binaries.gh, "gh version 2.97.0 (2026-09-01)");
+  assert.equal(probe.binaries.kimi, null);
+  assert.equal(probe.ghAuth, true);
+  assert.deepEqual(probe.ollamaModels, ["kimi-k3:cloud", "glm-5.2:cloud"]);
+  assert.equal(probe.configs.codexConfig, true);
+  assert.equal(probe.configs.kimiConfig, false);
+  assert.equal(probe.skillAgents, SKILL);
+  // Presence is a boolean: the content of a config file never enters the probe.
+  assert.doesNotMatch(JSON.stringify(probe), /secret/);
+  // No command may reach out beyond the fixed allow list.
+  for (const call of machine.calls) {
+    assert.match(call, /^(git|gh|cargo|cargo-nextest|python|claude|codex|opencode|kimi|ollama) /, call);
+  }
+  const result = evaluate(probe);
+  assert.equal(byId(result, "reviewer-models").state, "ok");
+});
+
+test("main prints json and returns the exit code without touching the machine", () => {
+  const out = [];
+  const code = main(["--json"], { probe: () => ({ ...healthy, hooksPath: null }), write: (s) => out.push(s) });
+  assert.equal(code, 1);
+  const parsed = JSON.parse(out.join(""));
+  assert.equal(parsed.ok, false);
+  assert.equal(parsed.checks.find((c) => c.id === "hooks-path").state, "fail");
+});
+
+test("text output marks each state and lists fixes", () => {
+  const text = formatText(evaluate({ ...healthy, ghAuth: false }));
+  assert.match(text, /\[ok\]/);
+  assert.match(text, /\[warn\] gh-auth/);
+  assert.match(text, /gh auth login/);
+});

```
