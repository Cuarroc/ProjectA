# Review Runde 3 SETUP-A: Abgleich der Mergify-Doku mit der gemergten CI-01-Konfiguration

Du bist unabhängiger Reviewer (Autor: Claude). CI-01 wurde parallel gemergt. Prüfe,
ob der Diff unten (Kandidat bf1a7ad, Basis dc1fbe5) die Referenz korrekt wiedergibt:
`.mergify.yml` und `AGENTS.md` auf origin/main (beide unten vollständig).
Suche nach: sachlich falschen Aussagen über Queue, Labels, Berichtsschutz, Konfliktbehandlung,
Draft/CI; Widersprüchen zu AGENTS.md; Widersprüchen zwischen Skill, README, PRODUCT, mergify.md.
Ausgabe: Befunde (ID M1.., Schwere, Datei:Zeile, Befund, Vorschlag) oder "keine neuen Befunde"; Urteil.

## Referenz: .mergify.yml (origin/main)
```yaml
# Mergify: Merge-Queue fuer main (CI-01, Nutzer-Entscheidung 24.09.2026).
#
# Warum es diese Datei gibt: Bis zum 24.09. verlangte die Branch Protection
# "strict" (Branch muss auf dem Stand von main sein). 39 % aller PR-Laeufe
# waren dadurch reine "merge main"-Aktualisierungen - jede davon ein voller
# Windows-Lauf. "strict" ist jetzt AUS; die Garantie "main bleibt gruen"
# uebernimmt diese Queue: sie testet PRs (gebuendelt) gegen den aktuellen
# main, bevor sie mergt. Begruendung und Messwerte: docs/decisions.md
# (2026-09-24).
#
# Jeder Schluessel ist gegen das offizielle JSON-Schema geprueft
# (https://docs.mergify.com/mergify-configuration-schema.json), nicht aus dem
# Gedaechtnis geschrieben. `autoqueue` ist veraltet und wird zusammen mit
# `auto_merge_conditions` sogar abgelehnt - daher unten
# merge_protections_settings.auto_merge_conditions.
#
# Die drei Required Checks heissen exakt so, wie ci.yml sie meldet:
#   gates (linux), gates (windows), red-first
# Eine Umbenennung dort muss HIER nachgezogen werden, sonst wartet die Queue
# auf einen Check, der nie kommt.

queue_rules:
  - name: default
    # Merge-Commits bleiben: die red->green-Commits mit Test-First-Trailern
    # muessen in der Historie von main sichtbar bleiben (red-first,
    # AGENTS.md). squash/rebase wuerden sie einebnen bzw. neu schreiben.
    merge_method: merge
    # Nur relevant, wenn Mergify einen PR selbst aktualisiert: Merge statt
    # Rebase, damit die Commit-SHAs (und ihre Belege) stabil bleiben.
    update_method: merge
    # Dynamische Buendel: bei leerer Queue einzeln (schnelles Feedback), bei
    # Stau bis zu vier PRs in EINEM CI-Lauf - das ist die eigentliche
    # Minuten-Ersparnis gegenueber "jeder PR einzeln gegen main".
    batch_size:
      min: 1
      max: 4
    batch_max_wait_time: 10 min
    # Fester Wert statt `auto`: `auto` greift erst nach ~20 Laeufen
    # Historie, eine neue Queue haette bis dahin GAR kein Timeout
    # (docs.mergify.com/merge-queue/lifecycle#checks-timeout). Der langsamste
    # Job hat timeout-minutes 35 (ci.yml); 60 min lassen Platz fuer
    # Runner-Wartezeit.
    checks_timeout: 60 min
    # Wird ein PR aufgenommen, wenn ...
    queue_conditions:
      - base = main
      - -draft
      - -conflict
      - label != do-not-merge
      - check-success = gates (linux)
      - check-success = gates (windows)
      - check-success = red-first
    # ... und gemergt, wenn der Queue-Lauf (Draft-PR auf
    # mergify/merge-queue/*) dieselben drei Checks gruen meldet. Fuer die
    # Checks wertet Mergify hier den temporaeren Draft-PR aus, nicht den
    # Original-PR (Schema-Beschreibung von merge_conditions).
    merge_conditions:
      - label != do-not-merge
      - check-success = gates (linux)
      - check-success = gates (windows)
      - check-success = red-first

merge_queue:
  # serial: PRs werden kumulativ getestet (Buendel n enthaelt alles davor),
  # gemergt wird in Queue-Reihenfolge. `parallel` (Stub aus #105) verlangt
  # Scopes und testet unabhaengige PRs NICHT gegeneinander - fuer ein Repo,
  # dessen Nahtstellen (api.rs, store.rs, ...) fast jeder PR beruehrt, die
  # falsche Wahl.
  mode: serial
  # Hoechstens zwei spekulative Queue-Laeufe gleichzeitig. Jeder davon ist ein
  # voller Windows-Lauf; mehr Parallelitaet kauft Durchsatz mit Minuten, die
  # verworfen werden, sobald ein Buendel davor scheitert.
  max_parallel_checks: 2
  # Nur Endergebnisse kommentieren (gemergt / mit Grund entfernt), nicht jeden
  # Zwischenschritt.
  status_comments: outcomes
  queued_label: queued

merge_protections_settings:
  # Automatisch einreihen: jeder PR auf main, der kein Entwurf ist, keinen
  # Konflikt hat, kein `do-not-merge` traegt und dessen drei Checks gruen
  # sind. Das ersetzt das veraltete `queue_rules[].autoqueue`
  # (docs.mergify.com/merge-protections/auto-merge). Die aktiven
  # merge_protections unten muessen zusaetzlich erfuellt sein.
  #
  # ACHTUNG: diese Liste ist absichtlich identisch mit queue_conditions oben.
  # Wer die eine aendert, aendert die andere mit (Befund kimi-k3, Review
  # CI-01) - sonst wird ein PR eingereiht, den die Queue nicht nimmt, oder
  # umgekehrt nie automatisch eingereiht.
  auto_merge_conditions:
    - base = main
    - -draft
    - -conflict
    - label != do-not-merge
    - check-success = gates (linux)
    - check-success = gates (windows)
    - check-success = red-first

merge_protections:
  # Ein Arbeitspaket ist erst fertig, wenn sein Bericht im Repo liegt
  # (.pa/report_<paket>.md). Paket-Branches erkennt die Regel am Namen:
  # Anbieter-Praefix plus Paket-ID aus docs/PLAN.md - w<N>-, df<N>, ki-<N>,
  # hq2-. Gross-/Kleinschreibung egal.
  #
  # Bewusst NICHT erfasst (kein Paket, kein Bericht verlangt):
  #   - Doku-/Infra-Branches desselben Anbieters, z. B. claude/masterplan,
  #     claude/ci-01-..., kimi/release-141
  #   - mergify/merge-queue/* (Queue-Laeufe) und mergify/* (Konfig-PRs)
  #   - dependabot/*
  # Die Regel steht auch in AGENTS.md, damit Worker sie kennen.
  - name: Paket-PR bringt seinen Bericht mit
    description: >-
      Package branches (w<N>-, df<N>, ki-<N>, hq2-) must add or change
      .pa/report_*.md before merging.
    if:
      - base = main
      - head ~= (?i)^(claude|codex|kimi|opencode|glm)/(w\d+-|df\d+|ki-\d+|hq2-)
    success_conditions:
      - files ~= ^\.pa/report_.*\.md$

priority_rules:
  - name: Dringend (Label priority oder hotfix-Branch)
    conditions:
      - or:
          - label = priority
          - head ~= ^hotfix/
    priority: high

pull_request_rules:
  # Konflikt sichtbar machen. `toggle` setzt das Label, solange die
  # Bedingungen gelten, und nimmt es wieder ab, sobald der Konflikt geloest
  # ist. Den Kommentar postet Mergify, wenn die Regel zu greifen beginnt;
  # ob er bei spaeteren Pushes ohne Loesung erneut kommt, ist nicht
  # dokumentiert - beim ersten echten Konflikt beobachten (Befund kimi-k3
  # F6, Review CI-01, offen).
  - name: Konflikt markieren
    conditions:
      - base = main
      - -closed
      - conflict
    actions:
      label:
        toggle:
          - conflict
      comment:
        message: >-
          @{{author}} Dieser PR hat einen Konflikt mit main und kann nicht in
          die Merge-Queue. Bitte main hineinmergen (kein Rebase, kein
          Force-Push) und den Konflikt loesen; das Label `conflict`
          verschwindet danach von selbst.

```

## Referenz: AGENTS.md (origin/main)
```markdown
# AGENTS.md

Shared instructions for every agent working on ProjectA. ProjectA is a Tauri 2
agentic terminal: one implementation task, one agent, one git worktree.

## Start with current evidence

Read `STAND.md`, then `docs/PLAN.md` (the only work plan), then run
`bash scripts/sync.sh start`. Check branch, worktrees,
working changes and `.pa/ACTIVITY.md`. Preserve unrelated work. Historical status
is not live evidence. Never launch the desktop app just to inspect it: its queue
can immediately dispatch real workers.

Use the DevHQ website (`npm run hq:live`) for the human cockpit. Agents use the
same backend through `pa hq runtime` and `pa hq context --project <id>`; do not
scrape HTML. If the running app lacks HQ v1, report that limitation. Setup:
`npm run dev:doctor -- --json` is read-only; `npm run dev:setup` explicitly sets
clone-local hooks and creates `.pa/HQ-START.md`. Neither enables automation.

## Ownership and proof

Only one implementation lane may edit `src-tauri/src/api.rs`, `main.rs`,
`store.rs`, or `bin/pa.rs` at a time. Declare file ownership before parallel work.
Use `git -C <path>` for other worktrees. Do not use a shared stash blindly.

A bug claim needs a compiling, failing regression test. A visual claim needs an
inspected screenshot. Runtime claims need measured evidence. Investigate the
first failure; never hide exit codes or bypass hooks. Check sibling cases after
fixing a bug and consider a lint/gate for the error class.

Plans and changes over 300 lines or touching a shared seam require two other AI
reviewers before merge. Record every finding and its disposition. Evidence is
bound to the actual candidate; subsequent changes invalidate affected evidence.

## Development loop

The approved specification is `.pa/task_continuous_devhq.md`; defaults are in
`projecta.dev.json`. Rust/SQLite owns runtime state. HQ is a host/proxy, not a
second scheduler. Capability configuration is not capability evidence. Do not
claim a provider, actual model, effort, billing source, or token measurement that
has not been observed. No extra paid API spending is authorized.

Continuous mode remains disabled until its acceptance gates pass. Agents cannot
expand their own approval, credential, budget, or release policy. Never treat an
expired lease as proof that a worker process has stopped. Never reinstall over
active sessions or restore an old database after new writes have been accepted.

## Checks

The gate list lives in exactly one place: `scripts/ci/gates.sh`. Until
2026-09-09 it stood five times over — both hooks, `ci.yml`, `release.yml` and as
prose here — and it drifted (`pre-push` ran `cargo test`, CI ran
`cargo nextest run --profile ci`). A sixth copy in this file would be the same
mistake, so this section names commands, not gates:

```sh
bash scripts/ci/doctor.sh              # what can this machine prove?
bash scripts/ci/gates.sh --list        # the list, always current
bash scripts/ci/gates.sh lane prepush  # the full local lane
bash scripts/ci/gates.sh --from clippy lane linux   # resume after a failure
```

Lanes: `precommit`, `prepush`, `linux`, `windows`, `release`, `audit`. `ci.yml`,
`release.yml`, `audit.yml` and both git hooks call exactly these lanes — one
step per lane, no list left in the YAML. Drift is not checked, it is impossible.
Run the gates locally rather than waiting for CI; see `docs/ci-lokal.md`.

Every run ends with a `NICHT ABGEDECKT` block, and that block belongs in the PR
text or `.pa/ACTIVITY.md`: the `#[cfg(unix)]` tests do not compile on Windows,
the `#[cfg(windows)]` tests do not compile on Linux (`KNOWN_ISSUES` KI-7) — no
single machine covers both halves. "All gates green" without that block is a
claim, not evidence. Since the server was removed the Linux half comes from WSL2
with the clone on ext4.

Use `CARGO_BUILD_JOBS=2` under load; never set `CARGO_PROFILE_*` variables.
Rust tests are inline modules. App/CLI tests remain in their binary targets;
the shared native capture tests run once in the `projecta_capture` library.
CI gates run on main pushes and PRs; installer builds run on release tags.
Use appropriate Test-First/Regression-For/No-Test trailers; never `--no-verify`.

## Merging (Mergify queue, since 2026-09-24)

`main` is merged only through the Mergify merge queue (`.mergify.yml`). Every
non-draft PR to `main` whose three required checks — `gates (linux)`,
`gates (windows)`, `red-first` — are green, that has no conflict and no
`do-not-merge` label is queued automatically and merged with a merge commit.
Branches no longer have to be up to date with `main`: do not merge `main` into
your branch just to refresh it (that was 39 % of all CI runs); merge it only to
resolve a real conflict (Mergify labels those `conflict`).

- Draft PRs get no CI. Open as draft while working, mark ready when done.
- `do-not-merge` label: keeps a green PR out of the queue.
- `priority` label or a `hotfix/` branch: queued ahead of others.
- Package branches must ship their report. A branch is a package branch when
  it matches `^(claude|codex|kimi|opencode|glm)/(w<N>-|df<N>|ki-<N>|hq2-)`
  (case-insensitive), e.g. `claude/w2-07-credential-acl`, `codex/df09a-...`,
  `claude/ki-23-...`. Such a PR must add or change a `.pa/report_*.md`, or the
  `Mergify Merge Protections` check stays red. Docs/infra branches
  (`claude/masterplan`, `claude/ci-01-...`) are not packages.
- `gates (windows)` skips its lane when no Windows input changed
  (`scripts/ci/windows-plan.sh` lists them and logs the decision); the queue
  and every push to `main` always run it in full.

## Record and learn

Before debugging: `npm run hq:lesson -- search "<symptom>"`. Report worked/failed
outcomes with `--run <runId>` (required; never invent a new ID for a retry); add a missing lesson with symptom, cause, fix and evidence. An HQ bug
must be logged in `docs/dev-hq/BUGS.md` and queued; if offline, record the pending
queue action explicitly. Do not fabricate the queue entry.

Specs/reports belong in `.pa/`. Record dependency/architecture decisions in
`docs/decisions.md` (what, why, when to reverse). At session end run
`bash scripts/sync.sh note "<agent>" "<summary>"` and update status when justified.
Keep secrets out of tracked files and reports.

## Detailed operating reference

`docs/development/WORKFLOW.md` preserves the full shared operational rules,
architecture, release procedures, environment gotchas and documentation roles.
All paths and commands there are relative to the repository root. Consult the
relevant section when working on those systems; it remains authoritative for
rules not summarized here. Its server/tunnel material is historical: the server
was removed on 2026-09-09. The local Node requirement is 24 or newer.

```

## Diff dc1fbe5..bf1a7ad
```diff
diff --git a/.agents/skills/projecta-workflow/SKILL.md b/.agents/skills/projecta-workflow/SKILL.md
index a6123dd..41ce9b5 100644
--- a/.agents/skills/projecta-workflow/SKILL.md
+++ b/.agents/skills/projecta-workflow/SKILL.md
@@ -28,9 +28,10 @@ per provider: `docs/setup/README.md`. Check your machine with
 - Every gate run ends with a `NICHT ABGEDECKT` block; put it in the PR text.
 - Worktrees under `.claude/worktrees/` have no `target/`. Point cargo at a
   build slot: `export CARGO_TARGET_DIR=$HOME/cargo-targets/projecta-<a|b|c>`
-  (on the dev PC: `%USERPROFILE%/cargo-targets/…`; another root via
-  `PROJECTA_BUILD_SLOTS_ROOT`) and `CARGO_BUILD_JOBS=1` or `2`. At most 2–3 builds at once; check free RAM
-  first. **Never set `CARGO_PROFILE_*`** — it invalidates the whole cache.
+  and `CARGO_BUILD_JOBS=1` or `2` (on the dev PC `$HOME` is `%USERPROFILE%`;
+  slots elsewhere: point `CARGO_TARGET_DIR` there and set
+  `PROJECTA_BUILD_SLOTS_ROOT` so `dev:agent-check` finds them). At most 2–3
+  builds at once; check free RAM first. **Never set `CARGO_PROFILE_*`** — it invalidates the whole cache.
 - Read exit codes unmasked: `| tail` swallows the status.
 
 ## 3. Red first — commit trailers
@@ -81,15 +82,17 @@ who asks the user.
    points. If your harness blocks writes to `.pa/report_*`, return the report
    as text to the coordinator — do not work around the block.
 2. Push once and open **one PR per package at the end**. Open it as **draft**
-   while report, disposition or the `NICHT ABGEDECKT` block is missing; mark it
-   ready (`gh pr ready <n>`) only when all are in. Every push to an open PR
-   costs a full Linux + Windows CI run. Verify a push with `git ls-remote`,
-   not with the push exit code.
-3. `main` is merged by the **Mergify** merge queue, not by hand (config and
-   labels arrive with package CI-01 — check `docs/setup/mergify.md` for the
-   current state). Labels:
-   `do-not-merge` keeps a PR out of the queue; `priority` (coordinator only)
-   moves it to the front; `conflict` is set by Mergify — rebase, push, it
-   clears. Details: `docs/setup/mergify.md`.
+   while report, disposition or the `NICHT ABGEDECKT` block is missing (drafts
+   get no CI); mark it ready (`gh pr ready <n>`) only when all are in. Every
+   push to a ready PR costs a full CI run. Verify a push with `git ls-remote`,
+   not with the push exit code. Package branches
+   (`<vendor>/w<N>-…`, `df<N>`, `ki-<N>`, `hq2-`) must add a `.pa/report_*.md`
+   or Mergify's merge protection stays red.
+3. `main` is merged only by the **Mergify** merge queue (`.mergify.yml`,
+   `AGENTS.md` "Merging"). Do not merge `main` into your branch just to
+   refresh it; only to resolve a real conflict — merge, never rebase or
+   force-push. Labels: `do-not-merge` keeps a PR out of the queue; `priority`
+   (coordinator only) moves it to the front; `conflict` is set and cleared by
+   Mergify. Details: `docs/setup/mergify.md`.
 4. After a merge in your worktree, restore generated snapshots:
    `git checkout -- docs/dev-hq/data.js docs/dev-hq/data.json`.
diff --git a/.claude/skills/projecta-workflow/SKILL.md b/.claude/skills/projecta-workflow/SKILL.md
index a6123dd..41ce9b5 100644
--- a/.claude/skills/projecta-workflow/SKILL.md
+++ b/.claude/skills/projecta-workflow/SKILL.md
@@ -28,9 +28,10 @@ per provider: `docs/setup/README.md`. Check your machine with
 - Every gate run ends with a `NICHT ABGEDECKT` block; put it in the PR text.
 - Worktrees under `.claude/worktrees/` have no `target/`. Point cargo at a
   build slot: `export CARGO_TARGET_DIR=$HOME/cargo-targets/projecta-<a|b|c>`
-  (on the dev PC: `%USERPROFILE%/cargo-targets/…`; another root via
-  `PROJECTA_BUILD_SLOTS_ROOT`) and `CARGO_BUILD_JOBS=1` or `2`. At most 2–3 builds at once; check free RAM
-  first. **Never set `CARGO_PROFILE_*`** — it invalidates the whole cache.
+  and `CARGO_BUILD_JOBS=1` or `2` (on the dev PC `$HOME` is `%USERPROFILE%`;
+  slots elsewhere: point `CARGO_TARGET_DIR` there and set
+  `PROJECTA_BUILD_SLOTS_ROOT` so `dev:agent-check` finds them). At most 2–3
+  builds at once; check free RAM first. **Never set `CARGO_PROFILE_*`** — it invalidates the whole cache.
 - Read exit codes unmasked: `| tail` swallows the status.
 
 ## 3. Red first — commit trailers
@@ -81,15 +82,17 @@ who asks the user.
    points. If your harness blocks writes to `.pa/report_*`, return the report
    as text to the coordinator — do not work around the block.
 2. Push once and open **one PR per package at the end**. Open it as **draft**
-   while report, disposition or the `NICHT ABGEDECKT` block is missing; mark it
-   ready (`gh pr ready <n>`) only when all are in. Every push to an open PR
-   costs a full Linux + Windows CI run. Verify a push with `git ls-remote`,
-   not with the push exit code.
-3. `main` is merged by the **Mergify** merge queue, not by hand (config and
-   labels arrive with package CI-01 — check `docs/setup/mergify.md` for the
-   current state). Labels:
-   `do-not-merge` keeps a PR out of the queue; `priority` (coordinator only)
-   moves it to the front; `conflict` is set by Mergify — rebase, push, it
-   clears. Details: `docs/setup/mergify.md`.
+   while report, disposition or the `NICHT ABGEDECKT` block is missing (drafts
+   get no CI); mark it ready (`gh pr ready <n>`) only when all are in. Every
+   push to a ready PR costs a full CI run. Verify a push with `git ls-remote`,
+   not with the push exit code. Package branches
+   (`<vendor>/w<N>-…`, `df<N>`, `ki-<N>`, `hq2-`) must add a `.pa/report_*.md`
+   or Mergify's merge protection stays red.
+3. `main` is merged only by the **Mergify** merge queue (`.mergify.yml`,
+   `AGENTS.md` "Merging"). Do not merge `main` into your branch just to
+   refresh it; only to resolve a real conflict — merge, never rebase or
+   force-push. Labels: `do-not-merge` keeps a PR out of the queue; `priority`
+   (coordinator only) moves it to the front; `conflict` is set and cleared by
+   Mergify. Details: `docs/setup/mergify.md`.
 4. After a merge in your worktree, restore generated snapshots:
    `git checkout -- docs/dev-hq/data.js docs/dev-hq/data.json`.
diff --git a/.pa/review_setup-a_disposition.md b/.pa/review_setup-a_disposition.md
index 1027b96..37b0e57 100644
--- a/.pa/review_setup-a_disposition.md
+++ b/.pa/review_setup-a_disposition.md
@@ -28,6 +28,34 @@ voller Diff `origin/main...7546c8c`). Fixes im Commit nach `7546c8c`
 | G-R5 | glm-5.2 | nit | `git push origin x --force` fällt nicht unter die Deny-Regel. | **Dokumentiert, keine Änderung** (Hinweis 5: Leitplanke, kein Ersatz für Branch-Schutz). |
 | G-R6 | glm-5.2 | nit | kimi.md nennt nur Feldnamen. | Keine Änderung (bestätigender Befund). |
 
-Zählung: 21 Befunde (15 kimi-k3, 6 glm-5.2; K-R3/G-R2 und K-R14/G-R4 decken
+## Delta-Runde (Kandidat `dc1fbe5`)
+
+`.pa/review_setup-a-delta_kimi-k3.md` (freigeben mit Auflagen: D1),
+`.pa/review_setup-a-delta_glm-5.2.md` (freigeben, keine neuen Befunde). Prompt
+`.pa/review_prompt_setup-a-delta.md` (Diff `7546c8c..dc1fbe5` ohne Roh-Reviews).
+Beide bestätigen die Umsetzung der angenommenen Befunde und die Ablehnungen
+K-R1, K-R11, G-R1, G-R3.
+
+| ID | Quelle | Schwere | Befund | Disposition |
+|----|--------|---------|--------|-------------|
+| D1 | kimi-k3 | niedrig (Auflage) | Nackte Formen `git push --force`/`-f`/`--force-with-lease`, `git commit --no-verify` fehlen in deny. | **Angenommen**, ergänzt; Syntax-Absatz nennt sie. |
+| D2 | kimi-k3 | nit | `git branch -fd *`, `git branch -d -f *` fehlen. | **Angenommen**, ergänzt. |
+| D3 | kimi-k3 | nit | README/Skill Präsens „is merged" vs PRODUCT „is to be merged". | **Angenommen**, README und Skill auf „is to be merged". |
+| D4 | kimi-k3 | nit | KI-21-Wortlaut in claude-code.md ohne Dispositionszeile. | **Geprüft, belegt.** `KNOWN_ISSUES.md` KI-21: ruflo-core `PreToolUse`/`PostToolUse Bash` „überschreibt eine per Shell-Redirect geschriebene Datei … mit seiner eigenen Ausgabe" — der neue Wortlaut folgt dem wörtlich; der alte („kann Befehle verändern") war falsch. Selbstkorrektur beim Abgleich zu K-R15. |
+| D5 | kimi-k3 | nit | `PROJECTA_BUILD_SLOTS_ROOT` klingt, als steuere es den Build. | **Angenommen.** Skill: Slots woanders → `CARGO_TARGET_DIR` dorthin, `PROJECTA_BUILD_SLOTS_ROOT` nur für `dev:agent-check`. |
+
+Zählung Runde 1: 21 Befunde (15 kimi-k3, 6 glm-5.2; K-R3/G-R2 und K-R14/G-R4 decken
 sich). Angenommen: K-R2–R10, K-R12–R14 (+ G-R2, G-R4). Abgelehnt mit Beleg:
 K-R1, K-R11, G-R1, G-R3. Nur dokumentiert/geprüft: K-R15, G-R5, G-R6.
+
+## Nachtrag: Abgleich mit CI-01 (nach der Delta-Runde)
+
+Während der Reviews wurde CI-01 gemergt (PR #108, `.mergify.yml`, neuer
+`AGENTS.md`-Abschnitt „Merging"). `docs/setup/mergify.md`, Skill §6, README,
+PRODUCT und der Permission-Vorschlag (Hinweis 2) wurden daran angeglichen:
+Konflikt lösen durch `main` hineinmergen (nicht rebasen), Draft-PRs ohne CI,
+Berichtsschutz über das Branch-Muster (nicht über Dateipfade; die Disposition
+prüft Mergify nicht), `queued`-Label, `hotfix/`-Branches, Windows-Lane-Plan;
+Freeze/Auto-Retry als nicht in `.mergify.yml` konfiguriert markiert; Labels
+`do-not-merge`/`priority` noch nicht angelegt (`gh label list`). Prüfung:
+Runde 3 (`.pa/review_setup-a-ci01_*.md`).
diff --git a/PRODUCT.md b/PRODUCT.md
index 0ca2a4f..cec5e85 100644
--- a/PRODUCT.md
+++ b/PRODUCT.md
@@ -98,8 +98,8 @@ which is locked behind whom.
   Control API.
 - The surrounding ritual: `STAND.md` is read first every session; gates run
   locally and in CI on pushes to `main` and on pull requests (installer
-  builds only on `v*` tags), exit codes unmasked; `main` is to be merged by
-  the Mergify merge queue (package CI-01); diffs over 300 lines
+  builds only on `v*` tags), exit codes unmasked; `main` is merged by the
+  Mergify merge queue; diffs over 300 lines
   or touching a Nahtstelle need two independent AI reviews with a logged
   disposition; every session appends to `.pa/ACTIVITY.md`.
 - Work happens across many concurrent git worktrees with a shared stash stack.
diff --git a/README.md b/README.md
index 8c2cc87..123d7fb 100644
--- a/README.md
+++ b/README.md
@@ -66,7 +66,7 @@ npm run dev:agent-check          # is this machine ready for an agent? (--json a
 
 The human cockpit is the Dev-HQ website: `npm run hq:live`, then `http://localhost:4173`. One implementation task, one agent, one git worktree — the coordination protocol is [AGENTS.md](AGENTS.md); how each provider (Claude Code, Codex, OpenCode, Kimi Code, the Ollama reviewers) is set up is in [docs/setup/](docs/setup/README.md).
 
-Pull requests: one PR per package, opened at the end and kept as a draft until report, review disposition and the `NICHT ABGEDECKT` block are in. `main` is merged by the Mergify merge queue, not by hand; its configuration and labels arrive with package CI-01 ([docs/setup/mergify.md](docs/setup/mergify.md) has the current state).
+Pull requests: one PR per package, opened at the end and kept as a draft until report, review disposition and the `NICHT ABGEDECKT` block are in. `main` is merged only through the Mergify merge queue (`.mergify.yml`, [docs/setup/mergify.md](docs/setup/mergify.md)).
 
 ## Documentation
 
diff --git a/docs/setup/README.md b/docs/setup/README.md
index 3d11ae7..6c9425d 100644
--- a/docs/setup/README.md
+++ b/docs/setup/README.md
@@ -31,7 +31,7 @@ Konfig-Dateien) ist eine Warnung.
 | Kimi K3 | Kimi Code CLI | Frontend/HQ-Worker, Reviews | [kimi.md](kimi.md) |
 | GLM (DeepSeek offen, W2-09b) | OpenCode | Docs, Skripte, Zweitreview | [opencode.md](opencode.md) |
 | kimi-k3 + glm-5.2 (Ollama Cloud) | `.pa/review_transport.py` | Alltags-Reviewerpaar | [ollama-reviewers.md](ollama-reviewers.md) |
-| — | Mergify | Merge-Queue für `main` | [mergify.md](mergify.md) |
+| — | Mergify | Merge-Queue für `main` (`.mergify.yml`) | [mergify.md](mergify.md) |
 
 Nur Abos, kein OpenRouter, keine zusätzlichen bezahlten API-Ausgaben.
 
diff --git a/docs/setup/mergify.md b/docs/setup/mergify.md
index ea48850..921a641 100644
--- a/docs/setup/mergify.md
+++ b/docs/setup/mergify.md
@@ -1,66 +1,86 @@
 # Mergify — die Merge-Queue für `main`
 
-`main` wird von der Mergify-Merge-Queue gemergt, nicht von Hand. Zurück zur
-Übersicht: [README.md](README.md).
-
-> **Stand 24.09.2026:** Mergify ist installiert, die Konfiguration
-> `.mergify.yml` kommt mit dem Paket **CI-01** (bis dahin gibt es nur den
-> Bot-PR #105 mit einem Stub). Die Labels `do-not-merge`, `priority` und
-> `conflict` sind im Repo noch **nicht angelegt** (`gh label list`). Regel- und
-> Labelnamen unten sind mit CI-01 abzugleichen, sobald es gemergt ist; bei
-> Abweichung gilt `.mergify.yml`.
-
-## Grundregeln
-
-- **Branch-Schutz:** Pflicht-Checks `gates (linux)`, `gates (windows)` und
-  `red-first`. „Strict up-to-date" ist **aus**: Die Queue testet jeden
-  Kandidaten auf dem aktuellen `main`. Also nicht rebasen oder `main`
-  hineinmergen, nur um CI zu befriedigen.
+Seit 24.09.2026 (PR #108, Paket CI-01) wird `main` nur noch über die
+Mergify-Merge-Queue gemergt. Quelle der Wahrheit ist `.mergify.yml`; die
+Kurzfassung steht in `AGENTS.md` („Merging"). Diese Seite ist die Langfassung
+für den Alltag. Zurück zur Übersicht: [README.md](README.md).
+
+## Wie die Queue arbeitet
+
+- **Branch-Schutz:** Pflicht-Checks `gates (linux)`, `gates (windows)`,
+  `red-first`; „strict up-to-date" ist **aus**.
+- **Automatisch eingereiht** wird jeder PR auf `main`, der kein Draft ist,
+  keinen Konflikt hat, kein `do-not-merge` trägt und dessen drei Checks grün
+  sind. Die Queue (`mode: serial`, Bündel bis zu vier PRs) testet die
+  Kandidaten gegen den aktuellen `main` und merged mit Merge-Commit — die
+  Test-First-Commits bleiben in der Historie sichtbar.
+- **`main` nicht hineinmergen, nur um aufzufrischen** (das waren 39 % aller
+  CI-Läufe). `main` nur hineinmergen, um einen echten Konflikt zu lösen —
+  **mergen, nicht rebasen, kein Force-Push**.
+- **`gates (windows)`** überspringt seine Lane, wenn kein Windows-relevanter
+  Pfad geändert wurde (`scripts/ci/windows-plan.sh`); Queue-Läufe und Pushes
+  auf `main` fahren sie immer voll.
+
+## Arbeitsweise im Paket
+
 - **Ein PR je Paket, erst am Ende.** Im eigenen Worktree arbeiten,
   `bash scripts/ci/gates.sh lane prepush` lokal fahren, dann einmal pushen und
-  den PR öffnen. Jeder Push auf einen offenen PR kostet einen vollen Linux- und
-  Windows-Lauf.
-- **Draft = nicht fertig.** Als Draft öffnen, solange Bericht,
-  Review-Disposition oder der `NICHT ABGEDECKT`-Block fehlen; erst dann
-  `gh pr ready <n>`. Mergify reiht keinen Draft ein.
+  den PR öffnen. Jeder Push auf einen offenen, fertigen PR kostet einen vollen
+  CI-Lauf.
+- **Draft = nicht fertig.** Draft-PRs bekommen keine CI und kommen nicht in die
+  Queue. Als Draft öffnen, solange Bericht, Review-Disposition oder der
+  `NICHT ABGEDECKT`-Block fehlen; dann `gh pr ready <n>`.
 
 ## Labels
 
-| Label | Wer setzt es | Wirkung | Beispiel |
-|---|---|---|---|
-| `do-not-merge` | jeder | hält einen fertigen PR aus der Queue („Nutzer soll erst draufsehen") | `gh pr edit <n> --add-label do-not-merge` |
-| `priority` | nur der Koordinator | stellt den PR nach vorn (Hotfix, Blocker anderer Lanes) | `gh pr edit <n> --add-label priority` |
-| `conflict` | Mergify | PR merged nicht mehr sauber | Branch rebasen, pushen — das Label verschwindet von selbst |
+| Label | Wer setzt es | Wirkung |
+|---|---|---|
+| `do-not-merge` | jeder | hält einen grünen PR aus der Queue („Nutzer soll erst draufsehen") |
+| `priority` | nur der Koordinator | reiht vorn ein (ebenso ein Branch `hotfix/…`) |
+| `conflict` | Mergify (setzt und entfernt es selbst) | PR merged nicht sauber mit `main` — `main` hineinmergen, Konflikt lösen, pushen |
+| `queued` | Mergify | PR steht in der Queue |
+
+Setzen/Entfernen: `gh pr edit <n> --add-label do-not-merge`,
+`gh pr edit <n> --remove-label do-not-merge`.
 
-Entfernen: `gh pr edit <n> --remove-label <label>`.
+> **Stand 24.09.2026:** Die Labels `do-not-merge` und `priority` sind im Repo
+> noch **nicht angelegt** (`gh label list`); `gh pr edit --add-label`
+> scheitert dann. Einmalig anlegen (Nutzer oder Koordinator):
+> `gh label create do-not-merge` und `gh label create priority`.
 
 ## Berichtsschutz
 
-Ein PR, der `src-tauri/`, `src/` oder `scripts/` ändert, kommt ohne seinen
-`.pa/report_<id>.md` nicht in die Queue — und bei Nahtstelle oder mehr als 300
-Diff-Zeilen nicht ohne die Review-Disposition. Fehlender Bericht = fehlender
-Beleg = kein Merge.
+Die Merge-Protection „Paket-PR bringt seinen Bericht mit" greift auf
+**Paket-Branches**: Name passt auf
+`^(claude|codex|kimi|opencode|glm)/(w<N>-|df<N>|ki-<N>|hq2-)` (ohne
+Groß-/Kleinschreibung), z. B. `claude/w2-07-credential-acl`. Ein solcher PR
+muss eine `.pa/report_*.md` hinzufügen oder ändern, sonst bleibt der Check
+`Mergify Merge Protections` rot. Doku-/Infra-Branches (`claude/masterplan`,
+`claude/ci-01-…`, `claude/setup-a-…`) sind keine Pakete. Die
+Review-Disposition prüft Mergify **nicht** — sie bleibt Pflicht nach
+`AGENTS.md` (Nahtstelle oder mehr als 300 Zeilen).
 
 ## Freeze, Retry
 
 - **Freeze** nur manuell, nur für ein Release, nur durch den Nutzer
-  (Mergify-Dashboard). Niemand sonst friert ein oder taut auf.
-- **Flaky Jobs** werden automatisch wiederholt (Dashboard-Einstellung). Ein
-  roter Lauf, der kein bekannter Flake ist, bleibt rot: erst untersuchen, dann
-  neu pushen.
+  (Mergify-Dashboard). `.mergify.yml` konfiguriert keinen Freeze.
+- **Automatische Wiederholung** flakiger Jobs ist in `.mergify.yml` nicht
+  konfiguriert. Ein roter Lauf bleibt rot: erst untersuchen (bekannte Flakes:
+  `STAND.md`, `KNOWN_ISSUES.md`), dann neu anstoßen.
 
 ## Nach dem Merge
 
 Der Branch wird automatisch gelöscht (`delete_branch_on_merge`). Der
 Koordinator trägt das Paket in `docs/ERLEDIGT.md` ein, entfernt den Worktree
 und setzt die Spec auf `historisch`. Einen gemergten Branchnamen nicht
-wiederverwenden. Im eigenen Worktree nach einem `main`-Merge die generierten
-Snapshots zurücksetzen: `git checkout -- docs/dev-hq/data.js docs/dev-hq/data.json`.
+wiederverwenden. Wer `main` in seinen Worktree gemergt hat, setzt die
+generierten Snapshots zurück:
+`git checkout -- docs/dev-hq/data.js docs/dev-hq/data.json`.
 
 ## Hand-Merge
 
-Der Koordinator hat eine stehende Merge-Erlaubnis des Nutzers für fertige PRs
-(Stand 24.09.). Ob `gh pr merge` künftig ganz der Queue überlassen und per
+Der Koordinator hat eine stehende Merge-Erlaubnis des Nutzers für fertige
+PRs (Stand 24.09.). Ob `gh pr merge` künftig ganz der Queue überlassen und per
 Deny-Regel gesperrt wird, entscheidet der Nutzer — siehe
 [permissions-proposal.md](permissions-proposal.md).
 
@@ -69,6 +89,6 @@ Deny-Regel gesperrt wird, entscheidet der Nutzer — siehe
 1. Er ist ein Draft → `gh pr ready <n>`.
 2. Er trägt `do-not-merge`.
 3. Ein Pflicht-Check ist rot oder fehlt (`gh pr checks <n>`).
-4. Der Bericht `.pa/report_<id>.md` oder die Disposition fehlt.
-5. Er trägt `conflict` → rebasen und pushen.
+4. Paket-Branch ohne `.pa/report_*.md` → `Mergify Merge Protections` rot.
+5. Er trägt `conflict` → `main` hineinmergen, Konflikt lösen, pushen.
 6. Die Queue ist eingefroren (Release) — warten.
diff --git a/docs/setup/permissions-proposal.md b/docs/setup/permissions-proposal.md
index 2c27f18..50c4e60 100644
--- a/docs/setup/permissions-proposal.md
+++ b/docs/setup/permissions-proposal.md
@@ -59,11 +59,13 @@ Regeln erst eintragen, wenn das jeweilige Skript gemergt ist.
     ],
     "deny": [
       "Bash(git stash)", "Bash(git stash *)",              // geteilter Stash-Stapel
-      "Bash(git push --force *)", "Bash(git push -f *)", "Bash(git push --force-with-lease *)",
+      "Bash(git push --force)", "Bash(git push --force *)", "Bash(git push -f)", "Bash(git push -f *)",
+      "Bash(git push --force-with-lease)", "Bash(git push --force-with-lease *)",
       "Bash(git reset --hard)", "Bash(git reset --hard *)",
-      "Bash(git commit --no-verify *)", "Bash(git push --no-verify)", "Bash(git push --no-verify *)",
+      "Bash(git commit --no-verify)", "Bash(git commit --no-verify *)", "Bash(git push --no-verify)", "Bash(git push --no-verify *)",
       "Bash(git worktree remove --force *)", "Bash(git worktree remove -f *)",
       "Bash(git branch -D *)", "Bash(git branch -d --force *)", "Bash(git branch -df *)",
+      "Bash(git branch -fd *)", "Bash(git branch -d -f *)",
       "Edit(.claude/settings.json)", "Edit(.claude/settings.local.json)",
       "Write(.claude/settings.json)", "Write(.claude/settings.local.json)"
       // optional, siehe Hinweis 2:
@@ -86,7 +88,8 @@ Syntax: `Bash(befehl *)` ist die Form, die die bestehende
 `.claude/settings.json` schon benutzt (`Bash(cargo test *)`); die ältere Form
 `Bash(befehl:*)` ist gleichbedeutend. Ein Muster mit ` *` trifft den nackten
 Befehl ohne Argumente **nicht** — deshalb stehen `git stash`,
-`git reset --hard` und `git push --no-verify` zusätzlich ohne Stern da.
+`git reset --hard`, die `git push`-Force-Formen und die `--no-verify`-Formen
+zusätzlich ohne Stern da.
 
 Für die PowerShell-Werkzeuge gelten dieselben Regeln mit `PowerShell(…)` statt
 `Bash(…)`; die bestehende Datei führt beide Formen.
@@ -99,11 +102,13 @@ Für die PowerShell-Werkzeuge gelten dieselben Regeln mit `PowerShell(…)` stat
    `.worktrees/*` **und gemergte Codex-Worktrees** (`~/.codex/worktrees/*`,
    `.projecta-worktrees/codex-pr*`). App-eigene `pa/wk-*`-Worktrees bleiben
    außen vor (die App-Datenbank verweist auf sie).
-2. **`gh pr merge` sperren — Nutzerentscheidung.** Wenn die Mergify-Queue der
-   einzige Merge-Weg sein soll, gehört `Bash(gh pr merge *)` in `deny`. Der
-   Koordinator hat heute eine stehende Merge-Erlaubnis des Nutzers für fertige
-   PRs; mit der Deny-Regel entfällt sie, Hand-Merges macht dann nur noch der
-   Nutzer. Ohne Mergify als Merge-Weg die Regel weglassen.
+2. **`gh pr merge` sperren — Nutzerentscheidung.** Seit CI-01 (PR #108) sagt
+   `AGENTS.md`: `main` wird nur über die Mergify-Queue gemergt. Die Regel
+   `Bash(gh pr merge *)` in `deny` setzt das für Claude technisch durch. Der
+   Koordinator hat eine stehende Merge-Erlaubnis des Nutzers für fertige PRs
+   (Stand 24.09.); mit der Deny-Regel entfällt sie, Hand-Merges macht dann nur
+   noch der Nutzer. Soll der Koordinator im Notfall (Queue hängt) weiter von
+   Hand mergen dürfen, die Regel weglassen.
 3. **Auto-Mode.** Ob explizite Allow-Regeln den Auto-Mode-Klassifikator bei
    `git worktree remove` wirklich übersteuern, ist noch nicht belegt. Nach dem
    Eintragen einmal an einem Wegwerf-Worktree prüfen.

```
