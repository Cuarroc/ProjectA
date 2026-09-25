# Review-Auftrag SETUP-04 (ProjectA), Kandidat 2d4d605

Du bist ein unabhängiger Reviewer. Der Autor des Kandidaten hat mit GLM gearbeitet;
darum prüfen hier andere Modellfamilien. Prüfe den Diff unten.

## Paket und Kandidat

- Paket **SETUP-04** (Setup-Audit §1.1 und §4): Überarbeitung von `AGENTS.md`
  (Mergify-Block, Reviews/Advisors, PR-/CI-Minuten-Regeln, Setup-Links,
  Build-Slots) plus Plan-Nachtrag in `STAND.md`, `docs/PLAN.md`,
  `docs/MASTERPLAN.md`, `docs/ERLEDIGT.md` und `.pa/task_w1-19.md`.
- Branch `claude/setup-04-agents-md`, PR #132 (Draft, trägt `do-not-merge`).
- Kandidat-Commit (HEAD): `2d4d605`. Basis: `origin/main` @ `04e54d3`
  (Stand bei PR-Öffnung). Der eingebettete Diff ist
  `git diff 04e54d3...2d4d605`.
- Umfang: 6 Dateien, 383 Zeilen neu, 273 entfernt. `docs/dev-hq/data.js` und
  `docs/dev-hq/data.json` sind generiert und aus dieser Prüfung ausgenommen.
- Es ist ein reiner Doku-Change: kein Code und kein Skript wird geändert.
  Geprüft wird die inhaltliche Richtigkeit der Dokumentation.

## Prüfauftrag (genau vier Fehlerklassen)

1. **Sachliche Fehler:** falsche Zahlen, falsche Kommandos, falsche Namen
   (Checks, Labels, Skripte, Dateien, Paket-IDs), Arithmetikfehler in den
   Fortschrittstabellen (MASTERPLAN „Fortschritt“ vs. „Rechengrundlage“ vs.
   ERLEDIGT-Zeilen vs. STAND-Angabe), falsche oder tote Querverweise.
2. **Widersprüche zu Code und Skripten im Repo:** Jede Behauptung im Diff über
   Gates, Lanes, Workflows, Hooks, Mergify, npm-Skripte oder Datei-Existenz ist
   gegen das eingebettete Referenzmaterial zu prüfen. Das Referenzmaterial ist
   der aktuelle Stand derselben Dateien im Repo — der Diff ändert sie nicht.
3. **Veraltete Aussagen:** Behauptungen, die einen überholten Stand beschreiben,
   obwohl derselbe Diff (oder das Referenzmaterial) den neuen Zustand belegt —
   auch Widersprüche zwischen dem alten und neuen Text ein und derselben Datei,
   wenn der neue Text an einer Stelle noch den alten Zustand behauptet.
4. **Regeln, die anderen Regeln in AGENTS.md widersprechen:** Die resultierende
   AGENTS.md ist vollständig eingebettet (Referenz C). Prüfe die neuen Regeln
   gegen die bestehenden und die geänderten gegen die unangetasteten:
   Nahtstellen/Eigentum, Reviews/Advisors, Gates, Build-Slots, PR-/CI-Minuten,
   Mergify, Berichtspflicht — innerer Widerspruch, Doppelregelung mit
   abweichendem Wortlaut oder eine Regel, die eine andere unbeabsichtigt
   aushebelt.

Nicht zu beanstanden (keine Befunde):

- Aussagen über den Zustand auf GitHub (offene/gemergte PRs, Queue-Stand,
  Labels, Merge-SHAs). Sie beschreiben den Stand vom 24.09.2026, 21:00, und
  sind aus dem Repo allein nicht nachprüfbar. Nur melden, wenn sie **zueinander
  oder zum Diff** im Widerspruch stehen.
- `docs/dev-hq/data.js`/`data.json` (generiert, ausgenommen) und reine
  Stilistik, Wortwahl oder Übersetzung.

Falls Du lesenden Zugriff auf das Repo hast: Du darfst Dateien lesen, aber
nichts ändern; alle nötigen Belege stehen auch in diesem Prompt.

## Schwere

- **blocking** — eine Aussage, die Agenten oder CI/Merge beim Befolgen fehlleitet:
  falsches Kommando, falsche Required Checks, Regelwiderspruch mit
  Handlungsfolge, Arithmetikfehler, der Planzahlen verfälscht.
- **medium** — falsch oder ungenau ohne unmittelbare Fehlleitung; veraltete
  Aussage, die noch als aktuell formuliert ist; Lücke mit Fehlinterpretationsrisiko.
- **low** — kosmetisch, Verständlichkeit, kein Handlungsrisiko.

## Ausgabeformat

1. **Befunde** als nummerierte Liste (R1, R2, …), je: Schwere
   (blocking/medium/low), Datei:Zeile im neuen Stand, ein Satz Befund, Beleg
   (Zitat aus dem Diff oder dem Referenzmaterial mit Herkunftsangabe), kurz
   ein Vorschlag. Erfinde keine Befunde, um die Liste zu füllen: Ist eine
   Fehlerklasse leer, sage das explizit.
2. **Geprüft und bestätigt:** kurz, welche zentralen Behauptungen Du geprüft
   hast und dass sie stimmen (z. B. Checks-Namen, Lane-Liste, Hook-Aufrufe,
   Windows-Plan, npm-Skripte, Paket-Branch-Regex, Report-Existenz,
   Fortschritt-Arithmetik).
3. **Urteil:** freigeben / freigeben mit Auflagen / ablehnen, mit einem Satz
   Begründung.

Schreibe keine Dispositionen (übernimmt der Koordinator) und schlage keine
Commits vor. Antworte auf Deutsch.

## Regeln, gegen die geprüft wird (Auszug aus der resultierenden AGENTS.md)

- Keine Secrets in getrackten Dateien; Doku nennt nur Datei- und
  Variablennamen, nie Werte.
- Die Gate-Liste steht nur in `scripts/ci/gates.sh`; andere Dateien (auch
  AGENTS.md) nennen Kommandos und Bahnen, aber führen keine eigene Gate-Liste.
- Nur Abos, kein OpenRouter, keine zusätzlichen bezahlten API-Ausgaben.
  Alltags-Reviewerpaar `kimi-k3:cloud` + `glm-5.2:cloud` über Ollama Cloud mit
  `.pa/review_transport.py`; nie die Modellfamilie des Autors als Reviewer.
  Advisors: Fable 5.1 (Claude-Subagent) + GPT-6 Astra (Codex CLI,
  `-c model_reasoning_effort=high` je Aufruf; global bleibt `medium`).
- Ein PR je Paket, als Draft öffnen; gemergt wird nur über die Mergify-Queue;
  kein Hand-Merge (Ausnahme nur der Koordinator im Notfall, gebunden an den
  Head-SHA mit grünen Checks).
- Paket-Branches (Regex `^(claude|codex|kimi|opencode|glm)/(w<N>-|df<N>|ki-<N>|hq2-)`,
  case-insensitive) müssen eine `.pa/report_*.md` anfassen
  (Mergify Merge Protections).
- Jedes Paket endet mit `.pa/report_<paket>.md`.
- `docs/PLAN.md`, `STAND.md`, `docs/MASTERPLAN.md` und `docs/ERLEDIGT.md`
  schreibt nur der Koordinator oder das ausdrücklich zugewiesene Paket —
  SETUP-04 ist dieses zugewiesene Paket, deshalb darf dieser Diff sie ändern.
- Beweismaßstab: Eine Behauptung über Code, Skripte oder CI bleibt eine
  Behauptung, bis sie mit dem Repo-Stand übereinstimmt.

## Referenzmaterial (aktueller Repo-Stand; vom Diff nicht geändert)

### A. Gate-Liste: `bash scripts/ci/gates.sh --list` (Ausgabe, 25.09.2026)

```
no-masked        linux,release                              (cd . && bash scripts/ci/no-masked-output.sh)
wf-shell         linux,release                              (cd . && bash scripts/ci/workflow-shell.sh)
wf-pinned        linux,release                              (cd . && bash scripts/ci/actions-pinned.sh)
selftest-gates   linux,release                              (cd . && bash scripts/test-no-masked-output.sh && bash scripts/test-workflow-shell.sh && bash scripts/test-actions-pinned.sh)
selftest-red-first linux,release                              (cd . && bash scripts/test-red-first-output.sh)
selftest-review  linux,release                              (cd . && bash scripts/test-review-transport.sh)
selftest-windows-plan linux,release                              (cd . && bash scripts/test-windows-plan.sh)
fmt              precommit,prepush,linux,windows,release    (cd src-tauri && cargo fmt --check)
cargo-check      precommit                                  (cd src-tauri && cargo check)
typecheck        precommit,prepush,linux,release            (cd . && npm run typecheck)
lint             prepush,linux,release                      (cd . && npm run lint)
fe-test          prepush,linux,release                      (cd . && npm test)
hq-test          prepush,linux,release                      (cd . && npm run test:hq)
hq-visual        linux,release                              (cd . && npm run test:hq:visual)
fe-build         linux,release                              (cd . && npm run build)
e2e              linux,release                              (cd . && npm run test:e2e)
clippy           prepush,linux,windows,release              (cd src-tauri && cargo clippy --all-targets -- -D warnings)
rust-suite       prepush,linux,windows,release              (cd src-tauri && cargo nextest run --profile ci)
native-tests     windows                                    (cd . && bash scripts/ci/native-tests.sh)
audit-rust       audit                                      (cd src-tauri && cargo audit)
audit-npm        audit                                      (cd . && npm audit --audit-level=moderate)
```

### B. `.mergify.yml` (vollstaendig, aktueller Stand)

```
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

    allow_checks_interruption: true
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

### C. `AGENTS.md` — vollstaendiger ERGEBNIS-Stand des Kandidaten (HEAD 2d4d605)

(Der Diff weiter unten zeigt, welche Teile davon neu sind; diese Fassung ist das Ergebnis.)

```
# AGENTS.md

Shared instructions for every agent working on ProjectA. ProjectA is a Tauri 2
agentic terminal: one implementation task, one agent, one git worktree.

## Start with current evidence

Read `STAND.md`, then `docs/MASTERPLAN.md` (all open work in execution order;
package definitions in `docs/PLAN.md`, finished packages in `docs/ERLEDIGT.md`),
then run `bash scripts/sync.sh start`. Check branch, worktrees, working changes
and `.pa/ACTIVITY.md`. Preserve unrelated work. Historical status is not live
evidence. Never launch the desktop app just to inspect it: its queue can
immediately dispatch real workers.

Use the DevHQ website (`npm run hq:live`) for the human cockpit. Agents use the
same backend through `pa hq runtime` and `pa hq context --project <id>`; do not
scrape HTML. If the running app lacks HQ v1, report that limitation.

Setup per provider (which instruction file each harness reads, config names,
reviewer models) lives in `docs/setup/`; check a machine with
`npm run dev:agent-check`. The repo skill `projecta-workflow`
(`.agents/skills/`, copy in `.claude/skills/`) is a short checklist of this
file; where they disagree, this file wins. `npm run dev:doctor -- --json` is
read-only; `npm run dev:setup` sets clone-local hooks and creates
`.pa/HQ-START.md`. None of these enables automation.

## Ownership and proof

Only one implementation lane may edit `src-tauri/src/api.rs`, `main.rs`,
`store.rs` (with `store/`), or `bin/pa.rs` at a time. Declare file ownership
before parallel work. There is no cap on the number of implementers; the
limits are these serial lanes and the build slots below. Use `git -C <path>`
for other worktrees. Never use the shared stash; make a WIP commit instead.

A bug claim needs a compiling, failing regression test. A visual claim needs an
inspected screenshot. Runtime claims need measured evidence. Investigate the
first failure; never hide exit codes or bypass hooks. Check sibling cases after
fixing a bug and consider a lint/gate for the error class.

## Reviews and advisors

Plans and changes over 300 lines or touching a seam need two reviews by other
AI vendors before merge; anything else needs one reviewer who is not the
author. Never let the author's model family judge its own candidate. Record
every finding and its disposition in `.pa/review_<label>_disposition.md`.
Evidence is bound to the actual candidate; later changes invalidate the
affected evidence, so review the delta again.

- **Everyday pair:** Kimi K3 (`kimi-k3:cloud`) + GLM 5.2 (`glm-5.2:cloud`) on
  Ollama Cloud through `.pa/review_transport.py`. Setup, call and prompt rules:
  `docs/setup/ollama-reviewers.md`. The reviewers read only the prompt file,
  never this file.
- **Advisor pair** for hard decisions and final reviews: Fable 5.1 (Claude
  subagent) + GPT-6 Astra (Codex CLI, `-c model_reasoning_effort=high` per
  call; the global default stays `medium`). A worker may call the advisors
  itself for seam, security or architecture decisions, or when stuck for more
  than 30 minutes; otherwise it goes through the coordinator. Questions an
  advisor raises go to the coordinator, who asks the user.
- Subscriptions only: no OpenRouter, no API keys, no extra paid spending.

## Development loop

The user-approved contract for continuous mode is
`.pa/task_continuous_devhq.md`; defaults are in `projecta.dev.json`.
Rust/SQLite owns runtime state. HQ is a host/proxy, not a second scheduler.
Capability configuration is not capability evidence. Do not claim a provider,
actual model, effort, billing source, or token measurement that has not been
observed.

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

Rust tests are inline modules. App/CLI tests remain in their binary targets;
the shared native capture tests run once in the `projecta_capture` library.
CI gates run on pushes to `main`, on non-draft PRs and on merge-queue runs;
installer builds run on release tags. Use appropriate
Test-First/Regression-For/No-Test trailers; never `--no-verify`.

### Build slots

Worktrees under `.claude/worktrees/` have no `target/`. Point cargo at the main
checkout's `target/` or at a warm slot
`%USERPROFILE%/cargo-targets/projecta-{a,b,c}` via `CARGO_TARGET_DIR`, and set
`CARGO_BUILD_JOBS=1`. Never set `CARGO_PROFILE_*` variables: they invalidate
the whole dependency cache. The machine has 16 GB RAM: check free memory before
every cargo or gate run and run at most two or three builds at once. Details:
`docs/setup/claude-code.md` ("Worktrees und Build-Slots").

## Pull requests and CI minutes

Actions minutes are scarce: few runs, each one likely to pass.

- Run the full `bash scripts/ci/gates.sh lane prepush` locally once before
  the PR, then push once at the end. Verify the push with `git ls-remote`, not
  with the push exit code.
- One PR per package, opened as a **draft** (`gh pr create --draft`). Drafts
  get no CI. The coordinator marks it ready once report, review disposition
  and the `NICHT ABGEDECKT` block are in; every later push to a ready PR costs
  a full run.
- Do not merge `main` into your branch without a reason (see Merging); do not
  press "update branch".

## Merging (Mergify queue, since 2026-09-24)

`main` is merged through the Mergify merge queue (`.mergify.yml`); the long
form is `docs/setup/mergify.md`. Required checks are `gates (linux)`,
`gates (windows)`, `red-first` and `Mergify Merge Protections`; "strict
up-to-date" is off. Every non-draft PR to `main` with those checks green, no
conflict and no `do-not-merge` label is queued automatically, tested on top of
the current `main` and merged with a merge commit. Merge `main` into your
branch only to resolve a real conflict (Mergify labels those `conflict`):
merge, never rebase or force-push.

- `do-not-merge` label: keeps a green PR out of the queue.
- `priority` label (coordinator only) or a `hotfix/` branch: queued first.
- Package branches must ship their report. A branch is a package branch when
  it matches `^(claude|codex|kimi|opencode|glm)/(w<N>-|df<N>|ki-<N>|hq2-)`
  (case-insensitive), e.g. `claude/w2-07-credential-acl`, `codex/df09a-...`,
  `claude/ki-23-...`. Such a PR must add or change a `.pa/report_*.md`, or the
  `Mergify Merge Protections` check stays red. Docs/infra branches
  (`claude/masterplan`, `claude/ci-01-...`) are not packages.
- `gates (windows)` skips its lane when no Windows input changed
  (`scripts/ci/windows-plan.sh` lists them and logs the decision); the queue
  and every push to `main` always run it in full.
- **Nobody merges by hand.** Emergency exception: when the queue hangs or
  Mergify is down, the coordinator may merge a finished PR with
  `gh pr merge --merge --match-head-commit <sha>`, bound to the head SHA whose
  checks are green.

## Record and learn

Every package ends with `.pa/report_<package>.md`: what changed, red→green
commits with exit codes, gates and `NICHT ABGEDECKT`, reviews with
disposition, follow-ups. A subagent whose harness may not write that file
returns the complete report as its last message; the coordinator commits it.

Before debugging: `npm run hq:lesson -- search "<symptom>"`. Report worked/failed
outcomes with `--run <runId>` (required; never invent a new ID for a retry);
add a missing lesson with symptom, cause, fix and evidence. An HQ bug must be
logged in `docs/dev-hq/BUGS.md` and queued; if offline, record the pending
queue action explicitly. Do not fabricate the queue entry.

Specs/reports belong in `.pa/`. Follow-up packages taken from a report need no
spec of their own: the report is their source. Record dependency/architecture
decisions in `docs/decisions.md` (what, why, when to reverse). At session end
run `bash scripts/sync.sh note "<agent>" "<summary>"` and update status when
justified. Keep secrets out of tracked files and reports.

## Detailed operating reference

`docs/development/WORKFLOW.md` preserves the full shared operational rules,
architecture, release procedures, environment gotchas and documentation roles.
All paths and commands there are relative to the repository root. Consult the
relevant section when working on those systems; it remains authoritative for
rules not summarized here. Its server/tunnel material and its provider table
are historical (server removed 2026-09-09; current provider setup:
`docs/setup/`). The local Node requirement is 24 or newer.
```

### D. `.github/workflows/ci.yml` — Trigger-Block (Zeilen 21-58) und die Job-/Schrittzeilen

```
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
    # CI-01 (24.09.): Entwuerfe laufen nicht (Job-`if` unten). Damit ein
    # Entwurf beim "Ready for review" seine Checks bekommt, muss dieses
    # Ereignis ausdruecklich dabei sein - die ersten drei sind GitHubs
    # Standardmenge.
    types: [opened, synchronize, reopened, ready_for_review]

# Kein `paths-ignore` mehr. Es war am 03.09. als Ersparnis gedacht und hat in
# diesem PR zweimal ein Gate blind gemacht: `**.md` und `.pa/**` sind die
# Eingaben von `spec-status-check.mjs`, und `red-first` aus #31 waere bei einem
# doku-only-PR stillschweigend uebersprungen worden - ein Gate, das ein anderer
# Agent gerade erst eingezogen hat. "Gruen durch Abwesenheit" ist im selben PR
# der Grund, warum die Windows-Suite ungefiltert laeuft; dieselbe Begruendung
# gilt hier. Gespart wird stattdessen ueber `concurrency` (der ueberholte Lauf
# wird abgebrochen) und ueber die Arbeitsteilung Linux/Windows.
#
# Seit 22.09. sind gates (linux), gates (windows) und red-first Required
# Checks auf main (auch fuer Admins, keine Force-Pushes; "strict" ist seit
# 24.09. AUS, die Aktualitaet gegen main garantiert jetzt die Mergify-Queue,
# siehe .mergify.yml). Keine Pfadfilter einfuehren, die einen dieser Checks
# dauerhaft pending lassen.
#
# CI-01 (Nutzer-Entscheidung 24.09., docs/decisions.md): Die Windows-Bahn
# entscheidet per PLAN-SCHRITT (scripts/ci/windows-plan.sh), ob sie laufen
# muss - kein paths-ignore, kein Job-`if`. Der Job meldet deshalb immer
# success/failure, nie "pending". Auf main-Pushes und in der Merge-Queue
# laeuft er immer voll.
#
# Entwuerfe: jeder Job ueberspringt Draft-PRs - AUSSER den Queue-PRs von
# Mergify (Kopf-Branch mergify/merge-queue/*): die sind technisch Entwuerfe
# und muessen genau dann laufen. Ein Nicht-Entwurf-PR bekommt alle drei
# Checks; der Wechsel Entwurf -> bereit loest `ready_for_review` aus.

permissions:

--- ci.yml: Jobnamen, `if`-Zeilen, gates.sh-Aufrufe (grep -n) ---

22:  push:
59:  contents: read
62:  actions: read
82:  group: ci-${{ github.ref }}${{ startsWith(github.head_ref, 'mergify/merge-queue/') && format('-{0}', github.sha) || '' }}
83:  cancel-in-progress: ${{ github.event_name == 'pull_request' && !startsWith(github.head_ref, 'mergify/merge-queue/') }}
105:  run:
109:  linux:
110:    name: gates (linux)
112:    if: github.event_name != 'pull_request' || !github.event.pull_request.draft || startsWith(github.head_ref, 'mergify/merge-queue/')
164:        run: bash scripts/ci/gates.sh lane linux
191:  windows:
192:    name: gates (windows)
197:    if: github.event_name != 'pull_request' || !github.event.pull_request.draft || startsWith(github.head_ref, 'mergify/merge-queue/')
301:        run: bash scripts/ci/gates.sh lane windows
317:  red-first:
318:    name: red-first
320:    if: github.event_name == 'pull_request' && (!github.event.pull_request.draft || startsWith(github.head_ref, 'mergify/merge-queue/'))
```

### E. `.github/workflows/release.yml` und `audit.yml` — Trigger und Lane-Aufrufe

```
on:
  push:
    tags: ["v*"]

permissions:
  contents: write

--- release.yml: Lane-Aufruf (grep -n) ---

94:        run: bash scripts/ci/gates.sh lane release

--- audit.yml: Trigger und Lane-Aufruf ---

on:
  schedule:
    - cron: "37 4 * * 1" # montags 04:37 UTC
  workflow_dispatch:

65:        run: bash scripts/ci/gates.sh lane audit
```

### F. `.githooks/pre-commit` und `.githooks/pre-push` (vollstaendig)

```
#!/usr/bin/env bash
# .githooks/pre-commit — die schnelle Bahn vor jedem Commit.
#
# Der Hook fuehrt keine eigene Gate-Liste mehr. Bis zum 09.09. tat er es, und
# sie wich von allen anderen ab: hier `cargo check`, in pre-push `cargo test`,
# in CI `cargo nextest run --profile ci`, in AGENTS.md wieder etwas anderes.
# Die Liste steht jetzt einmal in scripts/ci/gates.sh; was hier laeuft, ist
# genau die Bahn `precommit` daraus.
#
# Nachsehen, was das ist:  bash scripts/ci/gates.sh --list precommit
# Aktivierung: git config core.hooksPath .githooks (scripts/install-hooks.sh)
set -e

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
exec bash "$ROOT/scripts/ci/gates.sh" lane precommit

--- .githooks/pre-push ---

#!/usr/bin/env bash
# .githooks/pre-push — die volle lokale Bahn vor jedem Push.
#
# Wie pre-commit: keine eigene Liste mehr, sondern die Bahn `prepush` aus
# scripts/ci/gates.sh. Zwei Aenderungen gegenueber der alten Fassung, beide
# beabsichtigt:
#
#   - `cargo test` wird zu `cargo nextest run --profile ci`. Das ist, was CI
#     misst: eigener Prozess je Test, keine Retries, harter slow-timeout.
#     Vorher belegte ein gruener Push etwas anderes als ein gruener CI-Lauf.
#     Fehlt nextest: `cargo install cargo-nextest --locked` (gates.sh sagt es
#     im Fehlerfall selbst). KEIN stiller Rueckfall auf `cargo test` — das
#     waere genau die Drift zurueck.
#   - `npm run test:hq` kommt dazu (12 node:test-Dateien unter scripts/lib/),
#     das lief bis zum 09.09. in keinem Hook und in keinem Workflow.
#
# Das Unset von GIT_DIR & Co. steht jetzt in gates.sh, nicht mehr hier: von
# dort aus starten die Tests, und der naechste Aufrufer soll nicht erneut
# darueber stolpern (AGENTS.md, Regel 5).
#
# Nachsehen, was das ist:  bash scripts/ci/gates.sh --list prepush
set -e

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
exec bash "$ROOT/scripts/ci/gates.sh" lane prepush
```

### G. `scripts/ci/windows-plan.sh` — Kommentarblock mit der Eingabeliste der Windows-Bahn (Zeilen 1-60)

```
#!/usr/bin/env bash
# windows-plan.sh — braucht dieser Lauf die Windows-Bahn ueberhaupt?
#
# Herkunft: CI-01 (Nutzer-Entscheidung 24.09.2026, docs/decisions.md).
# gates (windows) macht 70 % der Actions-Minuten aus (Windows zaehlt doppelt,
# gruener PR-Lauf im Median 15,3 min). Ein PR, der nur Doku, Frontend oder
# Berichte aendert, kann auf Windows nichts beweisen, was die Bahn `windows`
# misst: fmt, clippy, Rust-Suite und native-tests lesen keine dieser Dateien.
#
# Warum ein PLAN-SCHRITT und kein `paths-ignore` / kein Job-`if`:
#   - `paths-ignore` war am 03.09. schon einmal da und hat zwei Gates blind
#     gemacht (docs/decisions.md 2026-09-04): es filtert nach Dateiendung,
#     nicht nach den Eingaben eines Gates, und ein Required Check, dessen
#     Workflow gar nicht startet, bleibt fuer immer "pending".
#   - Ein Job-`if` meldet "skipped"; ob das den Required Check erfuellt, ist
#     GitHub-Semantik, die sich aendern kann, und im Log steht kein Grund.
#   - Hier entscheidet das Gate selbst anhand einer EXPLIZITEN Liste seiner
#     Eingaben, protokolliert die Entscheidung und den ausloesenden Pfad, und
#     `gates (windows)` endet immer mit success oder failure. Dasselbe Muster
#     wie `red-first.sh --plan`.
#
# Sicherheitsnetz, in dieser Reihenfolge:
#   1. Jedes Ereignis ausser pull_request (Push auf main, workflow_dispatch)
#      -> immer volle Bahn.
#   2. Queue-Laeufe von Mergify (Kopf-Branch mergify/merge-queue/*) -> immer
#      volle Bahn. Die Queue ist der letzte Halt vor main.
#   3. Die Liste der geaenderten Dateien laesst sich nicht bestimmen -> volle
#      Bahn. Nie "gruen durch Abwesenheit" (AGENTS.md).
#   4. Sonst: volle Bahn genau dann, wenn eine geaenderte Datei eine Eingabe
#      der Bahn ist.
#
# Eingaben der Bahn `windows` (abgeleitet aus scripts/ci/gates.sh, Gates fmt,
# clippy, rust-suite, native-tests):
#   src-tauri/**               der ganze Crate: Quelltext, Cargo.toml/.lock,
#                              build.rs, tauri.conf.json, resources/,
#                              testdata/, .config/nextest.toml, icons/
#   scripts/ci/**              gates.sh, native-tests.sh, dieses Skript
#   .github/**                 der Job selbst und seine Actions
#   .config/**                 Werkzeug-Konfiguration auf Wurzelebene
#   rust-toolchain, rust-toolchain.toml
#   .cargo/**, rustfmt.toml, .rustfmt.toml, clippy.toml, .clippy.toml
#                              cargo/rustfmt/clippy suchen sie auch in den
#                              Elternverzeichnissen des Crates
#   .gitattributes             Zeilenenden auf dem Windows-Checkout -> fmt
#   package.json, package-lock.json
#                              native-tests startet node (ConPTY-Fixture)
#   docs/PLAN.md               include_str! in src/development_plan.rs
#   docs/agents-json.md        zur Laufzeit gelesen von einem Test in
#                              src/profiles.rs (CARGO_MANIFEST_DIR/../docs)
#   + jede Datei ausserhalb von src-tauri/, die ein `include_str!`/
#     `include_bytes!` mit Literal-Pfad irgendwo im Crate (auch build.rs,
#     tests/) referenziert. Die werden bei JEDEM Lauf frisch aus dem
#     Quelltext ermittelt - ein neues include_str!("../../x") braucht also
#     keine Pflege dieser Liste. Festgenagelt in scripts/test-windows-plan.sh.
#     NICHT erkennbar sind concat!/env!-Pfade und Laufzeit-Lesezugriffe ueber
#     CARGO_MANIFEST_DIR/.. - die stehen von Hand in der Liste
#     (docs/agents-json.md); Queue und main fahren ohnehin voll.
#
# Ausgabe (stdout), fuer $GITHUB_OUTPUT gedacht:
#   run=true|false
```

### H. `package.json` — Skripte (Namen und Kommandos)

```
{
 "dev:doctor": "node scripts/dev-setup.mjs",
 "dev:setup": "node scripts/dev-setup.mjs --apply",
 "dev:benchmark": "node scripts/dev-benchmark.mjs",
 "dev:continuous-audit": "node scripts/continuous-audit.mjs",
 "dev:agent-check": "node scripts/dev/agent-setup-check.mjs",
 "dev": "vite",
 "build": "tsc --noEmit && node scripts/contrast-check.mjs && node scripts/spec-status-check.mjs && vite build",
 "preview": "vite preview",
 "test": "vitest run --coverage",
 "test:unit": "vitest run",
 "test:e2e": "playwright test",
 "test:watch": "vitest",
 "typecheck": "tsc --noEmit",
 "lint": "eslint src --max-warnings=0",
 "contrast": "node scripts/contrast-check.mjs",
 "specs": "node scripts/spec-status-check.mjs",
 "hq": "node scripts/dev-hq.mjs",
 "hq:live": "node scripts/hq-live.mjs",
 "test:hq": "node --test scripts/lib/*.test.mjs",
 "test:hq:visual": "node --test scripts/lib/hq-visual.browser.mjs",
 "tauri": "tauri",
 "hq:lesson": "node scripts/hq-lesson.mjs",
 "hq:queue-open-points": "node scripts/hq-queue-open-points.mjs"
}
```

### I. Existenz der im ERLEDIGT-Diff referenzierten `.pa/`-Dateien (geprueft am 25.09.2026)

```
existiert: .pa/report_w5-02b6.md
existiert: .pa/report_w1-22.md
existiert: .pa/report_w2-04b.md
existiert: .pa/report_w2-05.md
existiert: .pa/report_ci-01.md
existiert: .pa/review_setup-a_disposition.md
existiert: .pa/report_df07d_native_density.md
existiert: .pa/report_w2-07.md
existiert: .pa/report_df09a_chat_appearance.md
existiert: .pa/report_w5-02b2.md
existiert: .pa/report_w1-26c.md
existiert: .pa/report_df05b_clients.md
existiert: .pa/report_df06a_roadmap.md
existiert: .pa/report_df07_desktop-density.md
existiert: .pa/report_df08a_identity.md
existiert: .pa/report_df08b_identity_store.md
existiert: .pa/report_df08c_native_observation.md
existiert: .pa/report_ci_native_pty_marker.md
```

### J. `STAND.md` — vollstaendiger ERGEBNIS-Stand des Kandidaten (HEAD 2d4d605)

```
# Stand — 24.09.2026

Kurze Momentaufnahme für die nächste Instanz: wo wir stehen, was gerade läuft,
welche Specs ausführbar sind. Alles Weitere steht an genau einem Ort:

- **Offene Arbeit, geordnet, mit Fortschritt:** [`docs/MASTERPLAN.md`](docs/MASTERPLAN.md)
- **Erledigte Arbeit (gemergte PRs):** [`docs/ERLEDIGT.md`](docs/ERLEDIGT.md)
- **Paketdefinitionen offener Arbeit:** [`docs/PLAN.md`](docs/PLAN.md), W5 in
  [`.pa/plan_projects_w5.md`](.pa/plan_projects_w5.md)
- **Offene Befunde und Flakes:** [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md)

Historie: git, `CHANGELOG.md`, `STATUS.md`, `.pa/ACTIVITY.md`. Die frühere
PR-#39-Übergabe liegt in `.pa/report_pr39_handoff_historical_2026-09-21.md`,
die Vollfassung vom 15.09. unter `docs/archive/plaene-2026-09/STAND-2026-09-15.md`.

## Wo wir stehen

- **Release:** v1.4.1 ist der jüngste veröffentlichte Release (22.09.,
  PR #69, `3bcaed3`). Alles danach ist auf `main`, aber nicht ausgeliefert;
  ob und wann es ein Release wird, entscheidet der Nutzer. Die installierte
  App bleibt bis dahin unangetastet.
- **Fortschritt:** `docs/MASTERPLAN.md` rechnet 112 von 419 Punkten der
  geplanten Pakete als erledigt (26,7 %), mit den neu vorgeschlagenen
  Folgepaketen 131 von 493 (26,6 %). Überschneidende HQ2-/W5-Pakete sind
  Aliase der DF-Pakete und zählen nicht mehr doppelt.
- **Sanierungsplan Rev 9:** F0 ist abgeschlossen; alle F-Pakete sind mit
  Report abgenommen und `historisch`, bis auf den F-CORE-3-Rest B.3/C
  (W1-03e/f).
- **Continuous Mode bleibt fail-closed abgeschaltet.** `development_policy.rs`
  lehnt `continuous.enabled=true` ab; die Freischaltung ist W4-03 nach der
  Abnahmematrix (`.pa/continuous_acceptance_matrix.md`, 27 Zeilen) und nur
  mit Freigabe des Nutzers.
- **Queue:** die zehn toten `dispatched`-Einträge vom 15./17.09. sind weiter
  nicht verwerfbar. `POST /api/queue/<id>/cancel` antwortet seit W1-16
  (PR #82) für `dispatched` mit 409 statt 400; die sichere Cancel-Regel selbst
  fehlt noch (W1-05b). Bis dahin keine App mit dieser Queue starten.
- **CI und Merge:** `main` wird seit 24.09. über die Mergify-Merge-Queue
  gemergt (CI-01, PR #108; Regeln in `AGENTS.md` „Merging", Langfassung
  `docs/setup/mergify.md`). Required Checks: `gates (linux)`,
  `gates (windows)`, `red-first`, `Mergify Merge Protections`; `strict` ist
  aus. Draft-PRs bekommen keine CI.
- **Bekannter Blocker beim Push:** Der pre-push-Hook fährt die Gates im
  Hauptcheckout statt im gepushten Worktree (`core.hooksPath`); ist dort ein
  Gate rot, scheitert jeder Push. Nicht umgehen; Behebung in CI-02.

## Was gerade läuft

| Paket | Stand | Lane |
|---|---|---|
| W2-01b Review-Route nimmt den Reviewer-Run aus dem Credential | PR #124 in der Merge-Queue | api |
| W2-03 Usage-/Billing-Collectors | Worker läuft | st |
| W2-06 Supervisor: Producer-Audit, Runtime-Notifications | Worker läuft | mn (+ sup) |
| W2-08a Ressourcendruck- und Streaming-Enforcement | Worker läuft | fR |
| W1-15c übrige Mutex-Stellen in pty.rs | Worker läuft | pty |
| CI-02 leichtes prepush, W1-19b, pre-push-Hook | Worker läuft | ci |
| SETUP-B Dev-Skripte | Worker läuft | scripts/dev |
| SETUP-04 AGENTS.md und dieser Plan-Nachtrag | dieser Stand | doc |

Hinweis: PR #70 steht auf GitHub als „closed" statt „merged". Sein Inhalt ist
vollständig über `fef9eaa` auf `main` (GitHub-Störung beim Auto-Merge am 24.09.;
nur der Support kann das Flag setzen). `docs/ERLEDIGT.md` führt ihn als gemergt.

## Nächster Griff

1. Die laufenden Pakete abschließen (Tabelle oben); die Queue mergt fertige
   PRs selbst. Danach die Reihenfolge je Lane aus `docs/MASTERPLAN.md`
   („Worker-Struktur") ziehen; DF-07d (visueller PASS) braucht keinen
   Build-Slot.
2. W1-05b: sichere Cancel-Regel für `dispatched` implementieren und testen,
   Prozessende verifizieren, doppelte Neueinreihung verhindern; die produktive
   Queue bis dahin nicht durch einen App-Start dispatchen.
3. Nutzerentscheidungen einholen, die Pakete blockieren: Schnitt W4-03a
   (Journal-Teil ohne Aktivierung, Voraussetzung für W5-03), Grenzwerte für
   W2-08b, Secrets aus der Repo-Ebene in geschützte Environments,
   Release-Frage für die Arbeit nach v1.4.1 (Liste in `docs/PLAN.md` §5).

## Aktive Specs

- `.pa/task_devflow.md`: DEVFLOW-Ausführung; Pakete DF-00 bis DF-37, einzelne Pakete nur mit erfüllten Abhängigkeiten und Write-Allowlist.

Eine `.pa/task_*.md` ist nur ausführbar, wenn sie hier aufgeführt ist **und**
selbst `Status: aktiv` trägt; `npm run specs` (in `npm run build`) erzwingt
beides. Ein Paket aus `docs/PLAN.md` wird beim Start als `.pa/task_<id>.md`
angelegt und hier eingetragen; beim Merge wird die Spec `Status: historisch`
und die Zeile verschwindet. Folgepakete aus Reports brauchen keine Spec, ihr
Report ist die Quelle.

| Spec | Paket | Lane |
|---|---|---|
| `.pa/task_f_core3_delivery.md` | W1-03e/f: F-CORE-3 Rest B.3/C (C-3 selbst erledigt, PR #72) | `pty.rs` / `workers.rs` (keine Nahtstelle) |
| `.pa/task_w1-05.md` | W1-05b: Queue-Abnahmerest, Cancel-Regel für `dispatched` | parallel (keine Nahtstelle) |
| `.pa/task_w1-10.md` | W1-10: HQ-Stylesheet | parallel (keine Nahtstelle) |
| `.pa/task_w1-12.md` | W1-12: Design-Reste | parallel (keine Nahtstelle) |
| `.pa/task_w1-17.md` | W1-17: HQ-Parser auf diesen Plan umstellen | parallel (keine Nahtstelle) |
| `.pa/task_w1-20.md` | W1-20: Zweites Setup reproduzieren | parallel (keine Nahtstelle) |
| `.pa/task_ollama_worker_adapter.md` | W2-09b: DeepSeek V4 Flash Cloud ueber OpenCode; CLI-Probe belegt, TUI/Worker offen | hooks/capabilities/profile; main nur seriell fuer fallible Spawn-Integration |
| `.pa/task_hq2-02.md` | HQ2-02: Konzeptdemo, Inhalt über #70 auf main; Nutzer- und visuelle Abnahme offen | isolierte Demo-Datei, keine Produkt-UI-Lane |

## Bewusst offene Produktbefunde

Das Zuhause dieser Befunde ist seit 24.09. `KNOWN_ISSUES.md`. Hier steht nur
der Verweis:

- KI-24: SQLite-Lastklasse (`database is locked` / `pool timed out`), mit #77/#85 bearbeitet, beobachten.
- KI-25: Linux-Prozessgruppen-Test in `testgate.rs`, einmal rot, Ursache offen (W1-29).
- KI-26: Windows-PTY-Argumenttest, Kaltstart-Fix seit PR #104, beobachten.
- KI-27: `exited_undelivered` lässt Token-Reservierung und Delivery `started` (DF-15b, Produktfrage).
- KI-28: Capture-Host bleibt Windows-only (Entscheidung 16.09.).
- KI-29: F-SEC-4-Restrisiko des OmniRoute-Schlüssel-Syncs bei eingeschaltetem Opt-in.
- KI-20: doppelte Antwort auf `ESC[6n`, braucht eine Entscheidung (W1-27).

## Stehende Regeln

- Vier Nahtstellen, je eine serielle Lane: `src-tauri/src/api.rs`, `main.rs`,
  `store.rs` (samt `store/`), `bin/pa.rs`.
- Plan oder großer/Nahtstellen-Diff: zwei unabhängige Reviews mit
  protokollierter Disposition.
- Bugfix: kompilierender roter Regressionstest, dann grün. Gestaltung:
  angesehener Screenshot. Laufzeit/Routing: echte Messung vorher/nachher.
- Keine App nur zur Sichtprüfung starten, solange eine gefüllte Queue echte
  Worker auslösen könnte. Nie über eine aktive Sitzung installieren.
- Kein Ergebnis aus Formularstatus ableiten, wenn Git, Prozess oder Testbeleg
  die Wahrheit liefern. Exit-Codes ungemaskiert lesen.
- PR als Draft öffnen, einmal pushen; gemergt wird nur über die
  Mergify-Queue (Hand-Merge nur Koordinator im Notfall, `AGENTS.md`).
- Gemergtes Paket: aus PLAN/MASTERPLAN streichen, Zeile in `docs/ERLEDIGT.md`,
  Spec auf `Status: historisch`.
- Session-Ende über `bash scripts/sync.sh note "<agent>" "<summary>"`.

## Dokumente

| Datei | Zweck |
|---|---|
| `docs/MASTERPLAN.md` | alle offene Arbeit in Ausführungsreihenfolge, Fortschritt |
| `docs/ERLEDIGT.md` | erledigte Pakete mit PR, Merge-SHA und Report |
| `docs/PLAN.md` | Paketdefinitionen offener Arbeit, Regeln, Entscheidungen |
| `STAND.md` | diese Momentaufnahme |
| `AGENTS.md` | Arbeitsregeln für alle Agenten |
| `KNOWN_ISSUES.md` | offene bekannte Befunde und Flakes |
| `CHANGELOG.md` | ausgelieferte Nutzeränderungen |
| `STATUS.md` | abgeschlossene Meilensteine |
| `.pa/task_*.md` | ausführbare Paketspezifikationen |
| `.pa/report_*.md` | Belege und Review-Disposition |
| `.pa/continuous_acceptance_matrix.md` | Abnahmematrix Continuous Mode |
| `.pa/ACTIVITY.md` | append-only Instanzjournal |
| `docs/archive/plaene-2026-09/` | archivierte Pläne und Specs (nur Beleg) |
```

## Diff (`git diff 04e54d3...2d4d605`, ohne die generierten `docs/dev-hq/data.*`)

```diff
diff --git a/.pa/task_w1-19.md b/.pa/task_w1-19.md
index c532b3d..ad8bdba 100644
--- a/.pa/task_w1-19.md
+++ b/.pa/task_w1-19.md
@@ -1,6 +1,9 @@
 # W1-19: PR #39 rebasen: eine Gate-Quelle
 
-Status: aktiv
+Status: historisch
+
+Historisch seit 24.09.2026: der Kern ist über PR #39 erledigt, der Rest W1-19b
+ist in CI-02 aufgegangen (Nutzerentscheidung, `docs/MASTERPLAN.md`).
 
 Paket aus `docs/PLAN.md` (Welle W1). Angelegt 2026-09-17 als ausfuehrbare
 Spezifikation; der Plan ist die Quelle, diese Datei der Auftrag.
diff --git a/AGENTS.md b/AGENTS.md
index 415cb27..c8f25ee 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -5,40 +5,67 @@ agentic terminal: one implementation task, one agent, one git worktree.
 
 ## Start with current evidence
 
-Read `STAND.md`, then `docs/PLAN.md` (the only work plan), then run
-`bash scripts/sync.sh start`. Check branch, worktrees,
-working changes and `.pa/ACTIVITY.md`. Preserve unrelated work. Historical status
-is not live evidence. Never launch the desktop app just to inspect it: its queue
-can immediately dispatch real workers.
+Read `STAND.md`, then `docs/MASTERPLAN.md` (all open work in execution order;
+package definitions in `docs/PLAN.md`, finished packages in `docs/ERLEDIGT.md`),
+then run `bash scripts/sync.sh start`. Check branch, worktrees, working changes
+and `.pa/ACTIVITY.md`. Preserve unrelated work. Historical status is not live
+evidence. Never launch the desktop app just to inspect it: its queue can
+immediately dispatch real workers.
 
 Use the DevHQ website (`npm run hq:live`) for the human cockpit. Agents use the
 same backend through `pa hq runtime` and `pa hq context --project <id>`; do not
-scrape HTML. If the running app lacks HQ v1, report that limitation. Setup:
-`npm run dev:doctor -- --json` is read-only; `npm run dev:setup` explicitly sets
-clone-local hooks and creates `.pa/HQ-START.md`. Neither enables automation.
+scrape HTML. If the running app lacks HQ v1, report that limitation.
+
+Setup per provider (which instruction file each harness reads, config names,
+reviewer models) lives in `docs/setup/`; check a machine with
+`npm run dev:agent-check`. The repo skill `projecta-workflow`
+(`.agents/skills/`, copy in `.claude/skills/`) is a short checklist of this
+file; where they disagree, this file wins. `npm run dev:doctor -- --json` is
+read-only; `npm run dev:setup` sets clone-local hooks and creates
+`.pa/HQ-START.md`. None of these enables automation.
 
 ## Ownership and proof
 
 Only one implementation lane may edit `src-tauri/src/api.rs`, `main.rs`,
-`store.rs`, or `bin/pa.rs` at a time. Declare file ownership before parallel work.
-Use `git -C <path>` for other worktrees. Do not use a shared stash blindly.
+`store.rs` (with `store/`), or `bin/pa.rs` at a time. Declare file ownership
+before parallel work. There is no cap on the number of implementers; the
+limits are these serial lanes and the build slots below. Use `git -C <path>`
+for other worktrees. Never use the shared stash; make a WIP commit instead.
 
 A bug claim needs a compiling, failing regression test. A visual claim needs an
 inspected screenshot. Runtime claims need measured evidence. Investigate the
 first failure; never hide exit codes or bypass hooks. Check sibling cases after
 fixing a bug and consider a lint/gate for the error class.
 
-Plans and changes over 300 lines or touching a shared seam require two other AI
-reviewers before merge. Record every finding and its disposition. Evidence is
-bound to the actual candidate; subsequent changes invalidate affected evidence.
+## Reviews and advisors
+
+Plans and changes over 300 lines or touching a seam need two reviews by other
+AI vendors before merge; anything else needs one reviewer who is not the
+author. Never let the author's model family judge its own candidate. Record
+every finding and its disposition in `.pa/review_<label>_disposition.md`.
+Evidence is bound to the actual candidate; later changes invalidate the
+affected evidence, so review the delta again.
+
+- **Everyday pair:** Kimi K3 (`kimi-k3:cloud`) + GLM 5.2 (`glm-5.2:cloud`) on
+  Ollama Cloud through `.pa/review_transport.py`. Setup, call and prompt rules:
+  `docs/setup/ollama-reviewers.md`. The reviewers read only the prompt file,
+  never this file.
+- **Advisor pair** for hard decisions and final reviews: Fable 5.1 (Claude
+  subagent) + GPT-6 Astra (Codex CLI, `-c model_reasoning_effort=high` per
+  call; the global default stays `medium`). A worker may call the advisors
+  itself for seam, security or architecture decisions, or when stuck for more
+  than 30 minutes; otherwise it goes through the coordinator. Questions an
+  advisor raises go to the coordinator, who asks the user.
+- Subscriptions only: no OpenRouter, no API keys, no extra paid spending.
 
 ## Development loop
 
-The approved specification is `.pa/task_continuous_devhq.md`; defaults are in
-`projecta.dev.json`. Rust/SQLite owns runtime state. HQ is a host/proxy, not a
-second scheduler. Capability configuration is not capability evidence. Do not
-claim a provider, actual model, effort, billing source, or token measurement that
-has not been observed. No extra paid API spending is authorized.
+The user-approved contract for continuous mode is
+`.pa/task_continuous_devhq.md`; defaults are in `projecta.dev.json`.
+Rust/SQLite owns runtime state. HQ is a host/proxy, not a second scheduler.
+Capability configuration is not capability evidence. Do not claim a provider,
+actual model, effort, billing source, or token measurement that has not been
+observed.
 
 Continuous mode remains disabled until its acceptance gates pass. Agents cannot
 expand their own approval, credential, budget, or release policy. Never treat an
@@ -72,25 +99,49 @@ single machine covers both halves. "All gates green" without that block is a
 claim, not evidence. Since the server was removed the Linux half comes from WSL2
 with the clone on ext4.
 
-Use `CARGO_BUILD_JOBS=2` under load; never set `CARGO_PROFILE_*` variables.
 Rust tests are inline modules. App/CLI tests remain in their binary targets;
 the shared native capture tests run once in the `projecta_capture` library.
-CI gates run on main pushes and PRs; installer builds run on release tags.
-Use appropriate Test-First/Regression-For/No-Test trailers; never `--no-verify`.
+CI gates run on pushes to `main`, on non-draft PRs and on merge-queue runs;
+installer builds run on release tags. Use appropriate
+Test-First/Regression-For/No-Test trailers; never `--no-verify`.
+
+### Build slots
+
+Worktrees under `.claude/worktrees/` have no `target/`. Point cargo at the main
+checkout's `target/` or at a warm slot
+`%USERPROFILE%/cargo-targets/projecta-{a,b,c}` via `CARGO_TARGET_DIR`, and set
+`CARGO_BUILD_JOBS=1`. Never set `CARGO_PROFILE_*` variables: they invalidate
+the whole dependency cache. The machine has 16 GB RAM: check free memory before
+every cargo or gate run and run at most two or three builds at once. Details:
+`docs/setup/claude-code.md` ("Worktrees und Build-Slots").
+
+## Pull requests and CI minutes
+
+Actions minutes are scarce: few runs, each one likely to pass.
+
+- Run the full `bash scripts/ci/gates.sh lane prepush` locally once before
+  the PR, then push once at the end. Verify the push with `git ls-remote`, not
+  with the push exit code.
+- One PR per package, opened as a **draft** (`gh pr create --draft`). Drafts
+  get no CI. The coordinator marks it ready once report, review disposition
+  and the `NICHT ABGEDECKT` block are in; every later push to a ready PR costs
+  a full run.
+- Do not merge `main` into your branch without a reason (see Merging); do not
+  press "update branch".
 
 ## Merging (Mergify queue, since 2026-09-24)
 
-`main` is merged only through the Mergify merge queue (`.mergify.yml`). Every
-non-draft PR to `main` whose three required checks — `gates (linux)`,
-`gates (windows)`, `red-first` — are green, that has no conflict and no
-`do-not-merge` label is queued automatically and merged with a merge commit.
-Branches no longer have to be up to date with `main`: do not merge `main` into
-your branch just to refresh it (that was 39 % of all CI runs); merge it only to
-resolve a real conflict (Mergify labels those `conflict`).
+`main` is merged through the Mergify merge queue (`.mergify.yml`); the long
+form is `docs/setup/mergify.md`. Required checks are `gates (linux)`,
+`gates (windows)`, `red-first` and `Mergify Merge Protections`; "strict
+up-to-date" is off. Every non-draft PR to `main` with those checks green, no
+conflict and no `do-not-merge` label is queued automatically, tested on top of
+the current `main` and merged with a merge commit. Merge `main` into your
+branch only to resolve a real conflict (Mergify labels those `conflict`):
+merge, never rebase or force-push.
 
-- Draft PRs get no CI. Open as draft while working, mark ready when done.
 - `do-not-merge` label: keeps a green PR out of the queue.
-- `priority` label or a `hotfix/` branch: queued ahead of others.
+- `priority` label (coordinator only) or a `hotfix/` branch: queued first.
 - Package branches must ship their report. A branch is a package branch when
   it matches `^(claude|codex|kimi|opencode|glm)/(w<N>-|df<N>|ki-<N>|hq2-)`
   (case-insensitive), e.g. `claude/w2-07-credential-acl`, `codex/df09a-...`,
@@ -100,18 +151,29 @@ resolve a real conflict (Mergify labels those `conflict`).
 - `gates (windows)` skips its lane when no Windows input changed
   (`scripts/ci/windows-plan.sh` lists them and logs the decision); the queue
   and every push to `main` always run it in full.
+- **Nobody merges by hand.** Emergency exception: when the queue hangs or
+  Mergify is down, the coordinator may merge a finished PR with
+  `gh pr merge --merge --match-head-commit <sha>`, bound to the head SHA whose
+  checks are green.
 
 ## Record and learn
 
+Every package ends with `.pa/report_<package>.md`: what changed, red→green
+commits with exit codes, gates and `NICHT ABGEDECKT`, reviews with
+disposition, follow-ups. A subagent whose harness may not write that file
+returns the complete report as its last message; the coordinator commits it.
+
 Before debugging: `npm run hq:lesson -- search "<symptom>"`. Report worked/failed
-outcomes with `--run <runId>` (required; never invent a new ID for a retry); add a missing lesson with symptom, cause, fix and evidence. An HQ bug
-must be logged in `docs/dev-hq/BUGS.md` and queued; if offline, record the pending
+outcomes with `--run <runId>` (required; never invent a new ID for a retry);
+add a missing lesson with symptom, cause, fix and evidence. An HQ bug must be
+logged in `docs/dev-hq/BUGS.md` and queued; if offline, record the pending
 queue action explicitly. Do not fabricate the queue entry.
 
-Specs/reports belong in `.pa/`. Record dependency/architecture decisions in
-`docs/decisions.md` (what, why, when to reverse). At session end run
-`bash scripts/sync.sh note "<agent>" "<summary>"` and update status when justified.
-Keep secrets out of tracked files and reports.
+Specs/reports belong in `.pa/`. Follow-up packages taken from a report need no
+spec of their own: the report is their source. Record dependency/architecture
+decisions in `docs/decisions.md` (what, why, when to reverse). At session end
+run `bash scripts/sync.sh note "<agent>" "<summary>"` and update status when
+justified. Keep secrets out of tracked files and reports.
 
 ## Detailed operating reference
 
@@ -119,5 +181,6 @@ Keep secrets out of tracked files and reports.
 architecture, release procedures, environment gotchas and documentation roles.
 All paths and commands there are relative to the repository root. Consult the
 relevant section when working on those systems; it remains authoritative for
-rules not summarized here. Its server/tunnel material is historical: the server
-was removed on 2026-09-09. The local Node requirement is 24 or newer.
+rules not summarized here. Its server/tunnel material and its provider table
+are historical (server removed 2026-09-09; current provider setup:
+`docs/setup/`). The local Node requirement is 24 or newer.
diff --git a/STAND.md b/STAND.md
index 808ec52..b7d9d53 100644
--- a/STAND.md
+++ b/STAND.md
@@ -19,9 +19,10 @@ die Vollfassung vom 15.09. unter `docs/archive/plaene-2026-09/STAND-2026-09-15.m
   PR #69, `3bcaed3`). Alles danach ist auf `main`, aber nicht ausgeliefert;
   ob und wann es ein Release wird, entscheidet der Nutzer. Die installierte
   App bleibt bis dahin unangetastet.
-- **Fortschritt:** `docs/MASTERPLAN.md` rechnet 111 von 435 Punkten der
-  geplanten Pakete als erledigt (25,5 %), mit den neu vorgeschlagenen
-  Folgepaketen 111 von 505 (22,0 %).
+- **Fortschritt:** `docs/MASTERPLAN.md` rechnet 112 von 419 Punkten der
+  geplanten Pakete als erledigt (26,7 %), mit den neu vorgeschlagenen
+  Folgepaketen 131 von 493 (26,6 %). Überschneidende HQ2-/W5-Pakete sind
+  Aliase der DF-Pakete und zählen nicht mehr doppelt.
 - **Sanierungsplan Rev 9:** F0 ist abgeschlossen; alle F-Pakete sind mit
   Report abgenommen und `historisch`, bis auf den F-CORE-3-Rest B.3/C
   (W1-03e/f).
@@ -33,20 +34,27 @@ die Vollfassung vom 15.09. unter `docs/archive/plaene-2026-09/STAND-2026-09-15.m
   nicht verwerfbar. `POST /api/queue/<id>/cancel` antwortet seit W1-16
   (PR #82) für `dispatched` mit 409 statt 400; die sichere Cancel-Regel selbst
   fehlt noch (W1-05b). Bis dahin keine App mit dieser Queue starten.
-- **CI:** Required Checks `gates (linux)`, `gates (windows)`, `red-first`.
-  `strict` ist seit 24.09. aus; Mergify als Merge-Queue ist in Arbeit (CI-01,
-  Bot-PR #105).
+- **CI und Merge:** `main` wird seit 24.09. über die Mergify-Merge-Queue
+  gemergt (CI-01, PR #108; Regeln in `AGENTS.md` „Merging", Langfassung
+  `docs/setup/mergify.md`). Required Checks: `gates (linux)`,
+  `gates (windows)`, `red-first`, `Mergify Merge Protections`; `strict` ist
+  aus. Draft-PRs bekommen keine CI.
+- **Bekannter Blocker beim Push:** Der pre-push-Hook fährt die Gates im
+  Hauptcheckout statt im gepushten Worktree (`core.hooksPath`); ist dort ein
+  Gate rot, scheitert jeder Push. Nicht umgehen; Behebung in CI-02.
 
 ## Was gerade läuft
 
 | Paket | Stand | Lane |
 |---|---|---|
-| W2-05 Discovery: Scan und Dispatch | PR #107 offen | st (`store/discovery.rs`) |
-| W2-04b `verified` verlangt Reviewer-Rolle | Worker läuft, noch kein PR | st |
-| W1-22 tauri-plugin-log | Worker läuft, noch kein PR | mn |
-| CI-01 Actions-Minuten, Mergify-Queue | Worker läuft | ci |
-| SETUP-A Setup-Doku, `agent-setup-check` | Worker läuft | doc/scripts |
-| Plan-Dokumente (MASTERPLAN, ERLEDIGT, PLAN/STAND/KNOWN_ISSUES) | dieser Stand | doc |
+| W2-01b Review-Route nimmt den Reviewer-Run aus dem Credential | PR #124 in der Merge-Queue | api |
+| W2-03 Usage-/Billing-Collectors | Worker läuft | st |
+| W2-06 Supervisor: Producer-Audit, Runtime-Notifications | Worker läuft | mn (+ sup) |
+| W2-08a Ressourcendruck- und Streaming-Enforcement | Worker läuft | fR |
+| W1-15c übrige Mutex-Stellen in pty.rs | Worker läuft | pty |
+| CI-02 leichtes prepush, W1-19b, pre-push-Hook | Worker läuft | ci |
+| SETUP-B Dev-Skripte | Worker läuft | scripts/dev |
+| SETUP-04 AGENTS.md und dieser Plan-Nachtrag | dieser Stand | doc |
 
 Hinweis: PR #70 steht auf GitHub als „closed" statt „merged". Sein Inhalt ist
 vollständig über `fef9eaa` auf `main` (GitHub-Störung beim Auto-Merge am 24.09.;
@@ -54,16 +62,17 @@ nur der Support kann das Flag setzen). `docs/ERLEDIGT.md` führt ihn als gemergt
 
 ## Nächster Griff
 
-1. Die laufenden Pakete abschließen und mergen: W2-05 (PR #107), W2-04b,
-   W1-22, CI-01, SETUP-A. Danach die Reihenfolge je Lane aus
-   `docs/MASTERPLAN.md` („Worker-Struktur") ziehen.
+1. Die laufenden Pakete abschließen (Tabelle oben); die Queue mergt fertige
+   PRs selbst. Danach die Reihenfolge je Lane aus `docs/MASTERPLAN.md`
+   („Worker-Struktur") ziehen; DF-07d (visueller PASS) braucht keinen
+   Build-Slot.
 2. W1-05b: sichere Cancel-Regel für `dispatched` implementieren und testen,
    Prozessende verifizieren, doppelte Neueinreihung verhindern; die produktive
    Queue bis dahin nicht durch einen App-Start dispatchen.
 3. Nutzerentscheidungen einholen, die Pakete blockieren: Schnitt W4-03a
-   (Journal-Teil ohne Aktivierung, Voraussetzung für W5-03), Secrets aus der
-   Repo-Ebene in geschützte Environments, Release-Frage für die Arbeit nach
-   v1.4.1 (Liste in `docs/PLAN.md` §5).
+   (Journal-Teil ohne Aktivierung, Voraussetzung für W5-03), Grenzwerte für
+   W2-08b, Secrets aus der Repo-Ebene in geschützte Environments,
+   Release-Frage für die Arbeit nach v1.4.1 (Liste in `docs/PLAN.md` §5).
 
 ## Aktive Specs
 
@@ -73,7 +82,8 @@ Eine `.pa/task_*.md` ist nur ausführbar, wenn sie hier aufgeführt ist **und**
 selbst `Status: aktiv` trägt; `npm run specs` (in `npm run build`) erzwingt
 beides. Ein Paket aus `docs/PLAN.md` wird beim Start als `.pa/task_<id>.md`
 angelegt und hier eingetragen; beim Merge wird die Spec `Status: historisch`
-und die Zeile verschwindet.
+und die Zeile verschwindet. Folgepakete aus Reports brauchen keine Spec, ihr
+Report ist die Quelle.
 
 | Spec | Paket | Lane |
 |---|---|---|
@@ -82,7 +92,6 @@ und die Zeile verschwindet.
 | `.pa/task_w1-10.md` | W1-10: HQ-Stylesheet | parallel (keine Nahtstelle) |
 | `.pa/task_w1-12.md` | W1-12: Design-Reste | parallel (keine Nahtstelle) |
 | `.pa/task_w1-17.md` | W1-17: HQ-Parser auf diesen Plan umstellen | parallel (keine Nahtstelle) |
-| `.pa/task_w1-19.md` | W1-19b: Rest nach PR #39 (Dependabot im red-first-Gate, ci.yml-Kommentar) | parallel (keine Nahtstelle) |
 | `.pa/task_w1-20.md` | W1-20: Zweites Setup reproduzieren | parallel (keine Nahtstelle) |
 | `.pa/task_ollama_worker_adapter.md` | W2-09b: DeepSeek V4 Flash Cloud ueber OpenCode; CLI-Probe belegt, TUI/Worker offen | hooks/capabilities/profile; main nur seriell fuer fallible Spawn-Integration |
 | `.pa/task_hq2-02.md` | HQ2-02: Konzeptdemo, Inhalt über #70 auf main; Nutzer- und visuelle Abnahme offen | isolierte Demo-Datei, keine Produkt-UI-Lane |
@@ -112,6 +121,8 @@ der Verweis:
   Worker auslösen könnte. Nie über eine aktive Sitzung installieren.
 - Kein Ergebnis aus Formularstatus ableiten, wenn Git, Prozess oder Testbeleg
   die Wahrheit liefern. Exit-Codes ungemaskiert lesen.
+- PR als Draft öffnen, einmal pushen; gemergt wird nur über die
+  Mergify-Queue (Hand-Merge nur Koordinator im Notfall, `AGENTS.md`).
 - Gemergtes Paket: aus PLAN/MASTERPLAN streichen, Zeile in `docs/ERLEDIGT.md`,
   Spec auf `Status: historisch`.
 - Session-Ende über `bash scripts/sync.sh note "<agent>" "<summary>"`.
diff --git a/docs/ERLEDIGT.md b/docs/ERLEDIGT.md
index f88cbd7..727fbc9 100644
--- a/docs/ERLEDIGT.md
+++ b/docs/ERLEDIGT.md
@@ -5,6 +5,16 @@ Offene Arbeit: `docs/MASTERPLAN.md`. PR-Links: `https://github.com/Cuarroc/Proje
 
 | Datum | ID | Titel | PR | Merge-SHA | Report |
 |---|---|---|---|---|---|
+| 24.09. | W5-02b6 | Kimi und der agents.json-Default auf allowlist (`USERPROFILE`/`HOME`/`APPDATA`/`LOCALAPPDATA`) | [#121](https://github.com/Cuarroc/ProjectA/pull/121) | 04e54d3 | .pa/report_w5-02b6.md |
+| 24.09. | SETUP-A (SETUP-01/02/03/06/07/10/13) | Setup-Doku je Anbieter (`docs/setup/`), Skill `projecta-workflow`, `npm run dev:agent-check`, `@AGENTS.md`-Import, README/PRODUCT, Permission-Vorschlag, Hygiene WORKFLOW/`review.yml` | [#119](https://github.com/Cuarroc/ProjectA/pull/119) | 670221e | — (.pa/review_setup-a_disposition.md) |
+| 24.09. | W1-22 | tauri-plugin-log statt handgerolltem File-Logging | [#113](https://github.com/Cuarroc/ProjectA/pull/113) | 8a6180c | .pa/report_w1-22.md |
+| 24.09. | W2-04b | `verified` verlangt die Reviewer-Rolle; Kandidatenrolle im Store geprüft | [#112](https://github.com/Cuarroc/ProjectA/pull/112) | 30a4429 | .pa/report_w2-04b.md |
+| 24.09. | Plan-Dokumente, SETUP-05, W1-24c | MASTERPLAN und ERLEDIGT angelegt; PLAN/STAND/KNOWN_ISSUES bereinigt (v1.4.1, KI-24 bis KI-29) | [#114](https://github.com/Cuarroc/ProjectA/pull/114) | a2b2041 | — |
+| 24.09. | — | Mergify-Konfiguration auf das aktuelle Format (Bot-PR) | [#116](https://github.com/Cuarroc/ProjectA/pull/116) | 36e2a57 | — |
+| 24.09. | — | Dependabot: cargo-Gruppe in `src-tauri` (3 Updates) | [#110](https://github.com/Cuarroc/ProjectA/pull/110) | 6267b4e | — |
+| 24.09. | CI-01 | Mergify-Queue und Actions-Minuten sparen | [#108](https://github.com/Cuarroc/ProjectA/pull/108) | 3216bbf | .pa/report_ci-01.md |
+| 24.09. | W2-05 | Discovery: deterministischer Scan und Dispatch innerhalb der Admission | [#107](https://github.com/Cuarroc/ProjectA/pull/107) | 1a56ca8 | .pa/report_w2-05.md |
+| 24.09. | SETUP-00 | Reihenfolge mit CI-01 geklärt: Labels angelegt, Mergify-Block von CI-01, Bot-PR #105 geschlossen; Docs-only-Filter → SETUP-12 | — | — | — |
 | 24.09. | — | STAND: PTY-Kaltstart-Beleg und PR-#70-Merge-Vorfall, Konfliktmarker entfernt | [#104](https://github.com/Cuarroc/ProjectA/pull/104) | c4779c5 | .pa/report_ci_native_pty_marker.md |
 | 24.09. | DF-09a | Unabhängige lokale Chat-Erscheinungen (andere Sitzung, Cherry-pick von Codex) | [#100](https://github.com/Cuarroc/ProjectA/pull/100) | 9ed5e3f | .pa/report_df09a_chat_appearance.md |
 | 24.09. | W2-07 | Windows-ACL-Verifikation der scoped Credentials + Recovery-Sweep | [#106](https://github.com/Cuarroc/ProjectA/pull/106) | 2caa3bd | .pa/report_w2-07.md |
@@ -29,7 +39,7 @@ Offene Arbeit: `docs/MASTERPLAN.md`. PR-Links: `https://github.com/Cuarroc/Proje
 | 24.09. | DF-05b | `pa hq plan`/`plan-import` + IPC | [#70](https://github.com/Cuarroc/ProjectA/pull/70) | fef9eaa | .pa/report_df05b_clients.md |
 | 24.09. | DF-06a | Struktur-Roadmap | [#70](https://github.com/Cuarroc/ProjectA/pull/70) | fef9eaa | .pa/report_df06a_roadmap.md |
 | 24.09. | DF-07a–c | Dichtetokens, persistente Dichtewahl, Korrekturen | [#70](https://github.com/Cuarroc/ProjectA/pull/70) | fef9eaa | .pa/report_df07_desktop-density.md |
-| 24.09. | DF-07d | React-Parität der Dichte | [#70](https://github.com/Cuarroc/ProjectA/pull/70) | fef9eaa | .pa/report_df07d_native_density.md |
+| 24.09. | DF-07d (Code) | React-Parität der Dichte; visueller PASS offen, DF-07d und DF-07 bleiben in `docs/MASTERPLAN.md` offen | [#70](https://github.com/Cuarroc/ProjectA/pull/70) | fef9eaa | .pa/report_df07d_native_density.md |
 | 24.09. | DF-08a | Identitätstypen und Familienregister | [#70](https://github.com/Cuarroc/ProjectA/pull/70) | fef9eaa | .pa/report_df08a_identity.md |
 | 24.09. | DF-08b | Schema 21, Runbindung, Identitätshistorie | [#70](https://github.com/Cuarroc/ProjectA/pull/70) | fef9eaa | .pa/report_df08b_identity_store.md |
 | 24.09. | DF-08c | Native Capture-Herkunft (UNKNOWN) | [#70](https://github.com/Cuarroc/ProjectA/pull/70) | fef9eaa | .pa/report_df08c_native_observation.md |
diff --git a/docs/MASTERPLAN.md b/docs/MASTERPLAN.md
index 298da6a..e761c52 100644
--- a/docs/MASTERPLAN.md
+++ b/docs/MASTERPLAN.md
@@ -1,6 +1,6 @@
 # MASTERPLAN — alle verbleibende Arbeit, in Ausführungsreihenfolge
 
-Stand: **24.09.2026, 19:45**, abgeglichen gegen `origin/main` @ `c4779c5` und die GitHub-PR-Liste.
+Stand: **24.09.2026, 21:00**, abgeglichen gegen `origin/main` @ `04e54d3` (PR #121) und die GitHub-PR-Liste.
 Quellen: `docs/PLAN.md` (P: Paket-ID dort), `.pa/plan_projects_w5.md` (W5:Zeile),
 `.pa/report_*.md` (R:Name), offene PRs, der Setup-Audit-Plan vom 24.09.
 
@@ -15,6 +15,10 @@ getrennt (Zeile „zzgl. neue Folgepakete“).
 **Erledigtes steht in `docs/ERLEDIGT.md`, nicht hier.** Ein gemergter PR gilt als
 erledigt; das Paket wird hier gestrichen und dort eingetragen.
 
+**Folgepakete aus Reports brauchen keine eigene Spec** (Nutzerentscheidung 24.09.): der
+Report, auf den die Spalte „Quelle“ zeigt, ist ihre Quelle. Eine `.pa/task_<id>.md` bekommen
+nur Pakete aus PLAN oder W5-Plan.
+
 ## Fortschritt
 
 Gewichtung: S = 1, M = 3, L = 8 Punkte. Gemergt = erledigt. Größen aus PLAN/W5-Plan;
@@ -23,48 +27,79 @@ L steht nur für Sammelpakete, die vor dem Dispatch in M-Kinder geteilt werden.
 
 | Welle | erledigt / gesamt (Punkte) | % | offen | in Arbeit | blockiert |
 |---|---|---|---|---|---|
-| W1 | 43 / 60 | 71,7 | 6 | 1 | 2 |
-| W2 | 11 / 29 | 37,9 | 5 | 1 | 0 |
+| W1 | 44 / 59 | 74,6 | 5 | 0 | 2 |
+| W2 | 14 / 32 | 43,8 | 2 | 3 | 1 |
 | W3 | 4 / 16 | 25,0 | 3 | 0 | 3 |
 | W4 | 0 / 6 | 0,0 | 1 | 0 | 3 |
-| W5 (Projekte) | 5 / 140 | 3,6 | 8 | 0 | 51 |
-| DF (DEVFLOW) | 37 / 126 | 29,4 | 5 | 0 | 26 |
-| HQ2 | 10 / 57 | 17,5 | 2 | 0 | 7 |
+| W5 (Projekte) | 5 / 135 | 3,7 | 8 | 0 | 48 |
+| DF (DEVFLOW) | 34 / 124 | 27,4 | 6 | 0 | 26 |
+| HQ2 | 10 / 46 | 21,7 | 1 | 0 | 6 |
 | KI (Einzelpakete) | 1 / 1 | 100 | 0 | 0 | 0 |
-| **Summe** | **111 / 435** | **25,5** | **30** | **2** | **92** |
-| zzgl. neue Folgepakete (inkl. CI und SETUP) | 0 / 70 | — | 25 | 5 | 9 |
-| **Summe inkl. neu** | **111 / 505** | **22,0** | 55 | 7 | 101 |
+| **Summe** | **112 / 419** | **26,7** | **26** | **3** | **89** |
+| zzgl. neue Folgepakete (inkl. CI und SETUP) | 19 / 74 | 25,7 | 24 | 5 | 5 |
+| **Summe inkl. neu** | **131 / 493** | **26,6** | 50 | 8 | 94 |
 
 „blockiert“ heißt: eine Abhängigkeit ist nicht gemergt, oder eine Nutzer-/PC-Entscheidung fehlt.
-Warten auf eine belegte Lane zählt als „offen“. Gezählt wird je Tabellenzeile; Ausnahme
-W5-35a–f, das als sechs Pakete zählt.
+Warten auf eine belegte Lane zählt als „offen“. Ein PR in der Merge-Queue zählt als „in Arbeit“.
+Gezählt wird je Tabellenzeile; Ausnahme W5-35a–f, das als sechs Pakete zählt. Aliase (unten) zählen
+0 Punkte und keine Zeile.
 
 ### Rechengrundlage (zum Nachrechnen)
 
-- **W1 erledigt, 43 Punkte:** M (6 × 3 = 18) für W1-01, W1-03 (C-3), W1-03c/d, W1-11, W1-18, W1-19 (Kern, #39).
-  S (25 × 1 = 25) für W1-01a, 02, 04, 05 (Doku), 06, 07, 08, 09, 09b, 13, 14, 15, 15b, 16, 21, 21b, 23, 23b,
-  24, 24b, 25, 25b, 26, 26b, 26c.
-  **Offen, 17 Punkte:** S 03e, 12, 19b, 20, 22 (5); M 03f, 05b, 10, 17 (12).
-- **W2 erledigt, 11 Punkte:** W2-01 M, W2-02 M, W2-04 M, W2-07 S, W2-09 S.
-  **Offen, 18 Punkte:** 03, 05, 06, 08, 09b (g), 10 je M.
+- **W1 erledigt, 44 Punkte:** M (6 × 3 = 18) für W1-01, W1-03 (C-3), W1-03c/d, W1-11, W1-18, W1-19 (Kern, #39).
+  S (26 × 1 = 26) für W1-01a, 02, 04, 05 (Doku), 06, 07, 08, 09, 09b, 13, 14, 15, 15b, 16, 21, 21b, 22, 23,
+  23b, 24, 24b, 25, 25b, 26, 26b, 26c.
+  **Offen, 15 Punkte:** S 03e, 12, 20 (3); M 03f, 05b, 10, 17 (12). W1-19b ist in CI-02 aufgegangen (Alias, 0 Punkte),
+  deshalb sinkt W1 von 60 auf 59 Punkte.
+- **W2 erledigt, 14 Punkte:** W2-01 M, W2-02 M, W2-04 M, W2-05 M, W2-07 S, W2-09 S.
+  **Offen, 18 Punkte:** 03, 06, 08a (g), 08b (g), 09b (g), 10 je M. W2-08 (M) ist in 08a und 08b geteilt
+  (Koordinator 24.09.), deshalb wächst W2 von 29 auf 32 Punkte.
 - **W3 erledigt, 4 Punkte:** W3-05 S (Entscheidung), W3-06 M. **Offen, 12 Punkte:** 01 M, 02 M, 03 (3 Drills × S), 04 S, 07 S, 08 S.
   W3-09 ist inaktiv (nur wenn W0-05 = zerlegen) und nicht gezählt.
 - **W4, 6 Punkte:** 01 M, 02 S, 03 S, 04 S (g). W4-03a ist ein Vorschlag und zählt unter „neu“.
-- **W5, 140 Punkte:** Phase A 24 (inkl. W5-02b2 S (g)), B 9, C 14, D 12, E 13, F 7, G 22, H 9, I 18 (35a–f je M), J 12.
+- **W5, 135 Punkte:** Phase A 24 (inkl. W5-02b2 S (g)), B 5, C 14, D 11, E 13, F 7, G 22, H 9, I 18 (35a–f je M), J 12.
+  Phase B verliert W5-08a M + 08b S (Aliase → DF-18), Phase D verliert W5-14 S (Alias → DF-30): 140 − 5 = 135.
   Erledigt: W5-00 S + W5-02b M + W5-02b2 S (g) = 5.
-- **DF erledigt, 37 Punkte:** DF-00/01/02 je S (3); DF-03 M; DF-04a M, 04b M, 04c S (g); 05a M, 05b M; 06a M;
-  07a/b/c je S (g); 07d M; 08a S (g); 08b M; 08c M; 09a S (g); 15a S (g).
-  **Offen, 89 Punkte:** 06b S (g), 08d M (g), 09b M (g), 10–36 (27 × M = 81), 37 S.
-  DF-09 war ein M; mit der Teilung in 09a S (g) und 09b M (g) wächst DF von 125 auf 126 Punkte.
+- **DF erledigt, 34 Punkte:** DF-00/01/02 je S (3); DF-03 M; DF-04a M, 04b M, 04c S (g); 05a M, 05b M; 06a M;
+  07a/b/c je S (g); 08a S (g); 08b M; 08c M; 09a S (g); 15a S (g).
+  **Offen, 90 Punkte:** 06b S (g), 07d S (g), 08d M (g), 09b M (g), 10–36 (27 × M = 81), 37 S.
+  DF-07d zählte als erledigtes M; bis zum visuellen PASS ist es ein offenes S (g) (Nutzer 24.09.), deshalb
+  sinkt DF von 126 auf 124 Punkte.
 - **HQ2 erledigt, 10 Punkte:** 00 S, 01 M, 05a M, 11 M (g).
-  **Offen, 47 Punkte:** 02, 03, 04, 05b (g), 06 je M (15); 07, 08, 09, 10 je L (g) (32).
+  **Offen, 36 Punkte:** 02, 03, 05b (g), 06 je M (12); 07, 08, 09 je L (g) (24). HQ2-04 M und HQ2-10 L (g) sind
+  Aliase (→ DF-10, → DF-35–37): 57 − 11 = 46.
 - **KI:** KI-23 S erledigt (#94).
-- **Neu, 70 Punkte:** 26 Folgepakete (36 Punkte, Liste unten), CI-01 M + CI-02 S (4),
-  SETUP 30 (A 9, B 6, 04 M, 12 M, 15 M, 00/05/09/10/13/14 je S). Davon in Arbeit: W2-04b, W1-24c,
-  CI-01, SETUP-A, SETUP-05; blockiert: W4-03a, W1-27, DF-15b, CI-02, SETUP-04/10/12/14/15.
+- **Neu, 74 Punkte:** 30 Folgepakete (40 Punkte, davon offen 27 Pakete mit 37 Punkten in der Liste unten;
+  erledigt W2-04b, W1-24c, W5-02b6), CI-01 M + CI-02 S (4), SETUP 30 (A 9, B 6, 04 M, 12 M, 15 M,
+  00/05/09/10/13/14 je S). **Erledigt 19:** W2-04b, W1-24c, W5-02b6, CI-01, SETUP-A (9), SETUP-00, -05,
+  -10, -13.
+  Neu aufgenommen am 24.09. abends: W1-30, W2-01d, W2-04g, W5-02b7 (je S (g)).
+
+## Aliase (Nutzerentscheidung 24.09.: bei Überschneidung gewinnt die DF-ID)
 
-Achtung: HQ2 und DF überschneiden sich fachlich (PLAN, DEVFLOW „Anschluss an HQ2“). HQ2-03/04/06/09/10 und
-DF-02/07/09/10/19/35–37 können Doppelzählung enthalten; siehe „Hygiene-Befunde“.
+Ein Alias ist kein Paket: 0 Punkte, keine Tabellenzeile, kein Dispatch. Sein Inhalt und seine Abnahme gehen
+in das Zielpaket über; wer den Alias als Abhängigkeit nennt, wartet auf das Zielpaket. Geprüft wurden alle
+Paare der früheren Liste „Doppelungen zwischen den Plänen“:
+
+| Alias | → Ziel | Warum |
+|---|---|---|
+| W5-08a Postfach in der App (M) | DF-18 | Entscheidungs-Inbox in der App; Abnahme (Screenshot hell/dunkel, Tastatur) geht mit |
+| W5-08b Postfach im Cockpit (S) | DF-18 | dieselbe Inbox im HQ |
+| W5-14 Anbieter-Scorecards (S) | DF-30 | Provider-Vergleich ist Teil der Statistikprojektionen; Regel „unverifizierte Werte fließen nicht ein“ geht mit |
+| HQ2-04 Code-Chat: beratend/aktiv, Providerwechsel (M) | DF-10 | Chat-Modi Plan/Interview/aktive Ausführung |
+| HQ2-10 Smokes, Offline-Build, A11y, Release-Gates (L (g)) | DF-35, DF-36, DF-37 | Smokes → DF-35, UI-/A11y-Abnahme → DF-36, Dispositionen/Release-Gates → DF-37; der installierte Offline-/Recovery-Build → HQ2-08 |
+| W1-19b Rest W1-19 (S) | CI-02 | Nutzer 24.09.: in CI-02 aufgegangen (kein DF-Paar) |
+
+Kein Alias, weil der Inhalt verschieden ist (Schnittstelle statt Doppelung):
+- **W5-06/06b ↔ DF-18:** W5-06 ist der Store der Entscheidungen, W5-06b die API; DF-18 ist nur die Oberfläche
+  und hängt jetzt an W5-06b.
+- **W5-30b/33 ↔ DF-19/20:** W5-30b ist die Runner-Schicht, W5-33 die harte Kontingent-Buchung; DF-19 empfiehlt,
+  DF-20 editiert. DF-19 liest die W5-33-Daten, sobald es sie gibt.
+- **W5-12 ↔ DF-29–31:** W5-12 ist die Vertrauensbilanz mit eigenen Regeln (Klasse aus Pfaden, nur signierte
+  Werte) und trägt W5-13/15/25/36a; DF-30 hängt jetzt an W5-12.
+- **W5-02d ↔ DF-12:** Signatur der Urteile gegen Unabhängigkeit der Modellfamilie; beide nötig.
+- **HQ2-03, HQ2-06, HQ2-09:** Design-Tokens, Harness-Schema und Projektstart/Sync haben kein DF-Gegenstück;
+  der Statistik-Anteil von HQ2-09 liegt bei DF-29–31, der Dichte-Anteil von HQ2-03 bei DF-07.
 
 ## Modellregel (vorläufig, Benchmark folgt)
 
@@ -76,7 +111,9 @@ DF-02/07/09/10/19/35–37 können Doppelzählung enthalten; siehe „Hygiene-Bef
 | **N** | Nutzer bzw. PC | Entscheidungen, PC-Proben, Produktionsschlüssel |
 
 **Reviews immer zwei, anbieterfremd:** kimi-k3 + glm-5.2, ersatzweise deepseek-v4-flash über
-Ollama Cloud. Nie die Modellfamilie des Autors.
+Ollama Cloud. Nie die Modellfamilie des Autors. **Advisor-Paar** für harte Entscheidungen und
+Abschlussreviews: Fable 5.1 (Claude-Subagent) + GPT-6 Astra (Codex CLI, Effort je Aufruf);
+Regeln in `AGENTS.md` („Reviews and advisors“).
 
 ## Lane-Schlüssel
 
@@ -94,26 +131,26 @@ Die Spalte „Parallel-Gruppe“ steht für Lane/Stufe.
 
 | ID | Titel | Gr. | Status | Abhängig von | Lane / Dateien | Parallel-Gruppe | Modell | Quelle |
 |---|---|---|---|---|---|---|---|---|
-| W2-05 | Discovery: echter Scan und Dispatch | M | in Arbeit PR #107 (eigene Datei store/discovery.rs, keine Migration) | W2-04 ✓ | st (store/discovery.rs) | st/S0 ⚠ neben W2-04b, nur eigene Datei | O·h | P |
-| W2-04b | neu: `verified` verlangt Reviewer-Rolle (`run_role` in `RunPrincipal`); Rollencheck in die `bind_development_run_candidate`-Transaktion | S (g) | in Arbeit (Worker läuft, noch kein PR) | W2-02 ✓ | st (development_runs.rs) | st/S0 | O·h | R:w2-04 Folge 1+2, R:w2-01 Folge 3 |
-| W1-22 | tauri-plugin-log statt handgerolltem File-Logging | S | in Arbeit (Worker läuft, noch kein PR) | W1-15 ✓ | mn (main.rs, logging.rs, plugin-matrix.md) | mn/S0 | O·h | P |
+| W2-01b | neu: Review-Route nimmt `reviewerRunId` aus dem Credential | S (g) | in Arbeit (PR #124 in der Merge-Queue) | W2-01 ✓ | api | api/S0 | O·h | R:w2-01 Folge 1 |
+| W2-03 | Usage-/Billing-Collectors je Adapter | M | in Arbeit | W2-02 ✓, W2-04b ✓ | st (development_codex_usage.rs, budget.rs) | st/S0 | O·h | P |
+| W2-06 | Supervisor: Producer-Audit und Runtime-Notifications | M | in Arbeit | W2-04 ✓, W1-22 ✓ | sup + mn | mn/S0 | O·h | P |
+| W2-08a | Ressourcendruck- und Streaming-Enforcement (erster Teil von W2-08) | M (g) | in Arbeit | — | fR (pressure, process_capture) | fR/S0 | Cx·m | P |
+| W1-15c | neu: übrige Mutex-Stellen in pty.rs (Setter, Reader-Hook, Trace, Submit-Guard) und `api/agent_access.rs:266` | S (g) | in Arbeit | W1-15b ✓ | pty (+ agent_access.rs) | pty/S0 | KG·m | R:w1-15b, KNOWN_ISSUES KI-14 |
 
-CI-01 und SETUP-A laufen ebenfalls (Tabellen „CI" und „SETUP" unten).
+CI-02 (mit W1-19b), SETUP-B und SETUP-04 laufen ebenfalls (Tabellen „CI“ und „SETUP“ unten).
 
 ## S1 — sofort bzw. sobald die Lane frei ist (nach Priorität)
 
 | ID | Titel | Gr. | Status | Abhängig von | Lane / Dateien | Parallel-Gruppe | Modell | Quelle |
 |---|---|---|---|---|---|---|---|---|
-| W2-08 | Ressourcendruck- und Streaming-Enforcement | M | offen | — | fR (pressure, process_capture) | fR/S1 | Cx·m | P |
-| W2-01b | neu: Review-Route nimmt `reviewerRunId` aus dem Credential | S (g) | offen (api-Lane frei) | W2-01 ✓ | api | api/S1 | O·h | R:w2-01 Folge 1 |
-| W5-02b6 | neu: Kimi auf allowlist mit `USERPROFILE`/`HOME`/`APPDATA`/`LOCALAPPDATA` plus Probe `kimi -p`; agents.json ohne envPolicy → Default `allowlist` (Nutzer 24.09.: Variante a) | S (g) | offen | W5-02b2 ✓ | wk (profiles) | wk/S1 | O·h | PR #102 „Offen“, Setup-Plan §2.4/Rückfrage 6 |
-| W5-02a | Koordinator ohne Schreibpfad | M | offen (wk nach W5-02b6) | W5-02b ✓ | wk (workers.rs, profiles.rs) | wk/S1 | O·h | W5:233 |
+| DF-07d | Visueller PASS der React-Dichte (Code über #70 gemergt): Screenshots komfortabel/kompakt bei 1280×800 und 1920×1080 ansehen; DF-07 ist erst danach abgenommen (Nutzer 24.09.) | S (g) | offen | DF-07a–c ✓ | fe (nur Sichtprüfung) | fe/S1 (kein Cargo) | O·h (Koordinator) | R:df07d_native_density |
+| W2-08b | Rest W2-08: Speicher-/CPU-Grenzen je Job, Ressourcendruck bei der Admission | M (g) | blockiert: Nutzerentscheidung zu den Grenzwerten | W2-08a | fR (pressure) | fR/S1 | Cx·m | P, Koordinator 24.09. |
+| W5-02a | Koordinator ohne Schreibpfad | M | offen (wk-Lane frei) | W5-02b ✓ | wk (workers.rs, profiles.rs) | wk/S1 | O·h | W5:233 |
+| W1-30 | neu: Flake `omniroute::…::management_failures_keep_their_http_and_network_classes` (100-ms-Timeout unter Last) prüfen | S (g) | offen | — | fR (omniroute.rs, Tests) | fR/S1 | KG·m | R:w1-22 |
 | DF-09b | Rest DF-09: React-Parität der Chat-Erscheinungen, Admission-Kompatibilität | M (g) | offen | DF-09a ✓ | hqS/fe | fe/S1 | KG·m | P, R:df09a |
 | W5-00b | neu: fremden Text in workers.rs-Prompts systematisch suchen und einhüllen | S (g) | offen | W5-00 ✓ | wk (workers.rs) | wk/S1 (nach W5-02a) | O·h | R:w5-00 |
 | W2-09b | DeepSeek-V4-Flash-Worker über OpenCode (PTY-Zustellung, Per-Worker-Config) | M (g) | offen | #49, #50, W1-02 ✓ | wk (hooks/capabilities/profile); mn nur seriell | wk/S1 | Cx·m | P, STAND, task_ollama_worker_adapter |
 | W1-10 | HQ-Stylesheet: Kontrast-Gate auf hq.css, Light Mode, prefers-contrast | M | offen | — | hqL (hq.css, contrast-check.mjs) | hqL/S1 (kein Cargo) | KG·m | P |
-| W1-19b | Rest W1-19: Dependabot-Commits im red-first-Gate, ci.yml-Kommentar | S (g) | offen | #39 ✓ | ci | ci/S1 (kein Cargo) | KG·m | P |
-| W1-24c | neu: KNOWN_ISSUES-Eintrag zum F-SEC-4-Restrisiko (Opt-in, keine Listener-Identität) | S (g) | in Arbeit (im PR der Plan-Dokumente als KI-29) | W1-24b ✓ | doc | doc/S0 | KG·m | R:w1-24b |
 | W1-21c | neu: xterm-`pageerror` in Viewport.syncScrollArea beim Mount | S (g) | offen | — | fe (TerminalView) | fe/S1 | KG·m | R:w1-21b |
 | W1-21d | neu: Terminal-Suche mit Schaltern für Groß-/Kleinschreibung und Regex | S (g) | offen | W1-21b ✓ | fe (TerminalView) | fe/S1 (nach W1-21c) | KG·m | R:w1-21, R:w1-21b |
 | W1-18b | neu: Probe, ob Codex/OpenCode `.agents/skills` lesen; danach Profile von `Unsupported` heben | S (g) | offen (PC mit CLIs) | W1-18 ✓ | wk (Skills/Profile) | N+wk/S1 | KG·m | R:w1-18 §3 |
@@ -123,12 +160,12 @@ CI-01 und SETUP-A laufen ebenfalls (Tabellen „CI" und „SETUP" unten).
 
 | ID | Titel | Gr. | Status | Abhängig von | Lane / Dateien | Parallel-Gruppe | Modell | Quelle |
 |---|---|---|---|---|---|---|---|---|
-| W2-06 | Supervisor: Producer-Audit und Runtime-Notifications | M | offen | W2-04 ✓ | sup + mn | mn/S2 (nach W1-22) | O·h | P |
-| W2-03 | Usage-/Billing-Collectors je Adapter | M | offen (st nach W2-04b) | W2-02 ✓ | st (development_codex_usage.rs, budget.rs) | st/S2 (nach W2-04b) | O·h | P |
+| W2-01d | neu: CLI-Befehl `pa hq agent review` für die scoped Review-Route | S (g) | blockiert: W2-01b (#124 in der Queue) | W2-01b | pa (bin/pa.rs) | pa/S2 | O·h | PR #124 „NICHT ABGEDECKT“ |
+| W5-02b7 | neu: HQ-Profilansicht (`mergeProfileViews`) zeigt `envPolicy` an | S (g) | offen | W5-02b6 ✓ | hqL (scripts/lib/hq-live-lib.mjs, hq-live.mjs) | hqL/S2 (kein Cargo) | KG·m | PR #121 „NICHT ABGEDECKT“ |
+| W2-04g | neu: optional eine Versionsspalte für die Attestierungsregel statt Textvergleich (nur relevant bei Rolling-Upgrades mit offenen Retries) | S (g) | offen | W2-04b ✓ | st (development_runs.rs) | st/S2 | O·h | R:w2-04b Folge 2 (KD1) |
 | W4-03a | neu: Journal-Teil von W4-03 ohne Aktivierung (Voraussetzung W5-03) | S (g) | blockiert (Schnitt vom Nutzer bestätigen) | W2-04 ✓ | mn | mn/S2 | O·h | W5:53, W5:321 |
 | W1-09c | neu: KI-1, Prompt-Zusatz editierbar (Setter st → Command mn/api → Feld fe; in drei Kinder teilen) | M (g) | offen | W1-09b ✓ | st → mn → fe | st/S2, mn/S2, fe/S2 | O·h (st/mn), KG·m (fe) | R:w1-09b, PR #99 |
 | W1-03e | F-CORE-3 B.3: `MSG_USER` erst nach bewiesener Zustellung | S (g) | offen | W1-03 ✓ | wk (workers.rs:549) | wk/S2 | KG·m | P, R:w1-03_c3 |
-| W1-15c | neu: übrige Mutex-Stellen in pty.rs (Setter, Reader-Hook, Trace, Submit-Guard) und `api/agent_access.rs:266` | S (g) | offen (pty-Lane frei) | W1-15b ✓ | pty (+ agent_access.rs) | pty/S2 | KG·m | R:w1-15b, KNOWN_ISSUES KI-14 |
 | W1-01b | neu: Kimi-Re-Smoke mit `PROJECTA_PTY_TRACE_DIR` (eine `ESC[A\r` vor dem Write) | S (g) | offen | W1-01a ✓ | pty (Messung) | pty/S2 | KG·m | PR #101 |
 | W2-01c | neu: `approvalAuthority` in agent_access.rs:355 angleichen | S (g) | offen | W2-01 ✓ | fR (agent_access.rs) | fR/S2 | O·h | R:w2-01 Folge 2 |
 | W2-04e | neu: `dispatch.role` ins Agenten-Briefing (`agent_run_context`) | S (g) | offen | W2-04 ✓ | fR/wk (Datei vor Dispatch prüfen) | wk/S2 | KG·m | R:w2-04 Folge 5 |
@@ -168,8 +205,6 @@ CI-01 und SETUP-A laufen ebenfalls (Tabellen „CI" und „SETUP" unten).
 | W5-06 | Entscheidungen im Store | M | blockiert | W5-05 | st | st/S3 | O·h | W5:245 |
 | W5-06b | Entscheidungen über die API | S | blockiert | W5-06 | api | api/S3 | O·h | W5:246 |
 | W5-07 | Tagesbriefing (8:00/18:00) und Sofortmeldung | S | blockiert | W5-06 | fR (digest.rs) | fR/S3 | KG·m | W5:247 |
-| W5-08a | Postfach in der App | M | blockiert | W5-06b | fe | fe/S3 | KG·m | W5:248 |
-| W5-08b | Postfach im Cockpit | S | blockiert | W5-06b, #70 ✓ | hqS | hqS/S3 | KG·m | W5:249 |
 | W5-09a | Abonnements im Store | S | blockiert | W5-03 | st | st/S3 | O·h | W5:253 |
 | W5-09b | PR- und CI-Abos | M | blockiert | W5-09a | fR (gh.rs) | fR/S3 | Cx·m | W5:254 |
 | W5-09c | Zeitplan-Auslöser | S | blockiert | W5-09a | fR | fR/S3 | KG·m | W5:255 |
@@ -186,9 +221,9 @@ CI-01 und SETUP-A laufen ebenfalls (Tabellen „CI" und „SETUP" unten).
 | DF-15b | neu: Token-Reservierung und Delivery-Zeile für `exited_undelivered` freigeben (KI-27) | S (g) | blockiert: Produktentscheidung (gezählt unter „neu“, nicht DF) | DF-15a ✓ | st | st/S3 | O·h | R:df15_early_provider_exit, KNOWN_ISSUES KI-27 |
 | DF-16 | Workflow-API | M | blockiert | DF-15 | api/HOST | api/S3 | O·h | P |
 | DF-06b | Roadmap: Ausführungszustände | S (g) | blockiert | DF-11, DF-16 | hqS | hqS/S3 | KG·m | P |
-| DF-10 | Chat-Modi und Interview | M | blockiert | DF-01 ✓, DF-03 ✓, DF-09b | CORE/SEAM/hqS/fe (teilen) | mn/S3 | O·h | P |
+| DF-10 | Chat-Modi und Interview; übernimmt HQ2-04 (beratende vs. aktive Sitzung, Providerwechsel mit Übergabe) | M | blockiert | DF-01 ✓, DF-03 ✓, DF-09b | CORE/SEAM/hqS/fe (teilen) | mn/S3 | O·h | P |
 | DF-17 | Team-/Stationsgraph | M | blockiert | DF-02 ✓, DF-16 | hqS | hqS/S3 | KG·m | P |
-| DF-18 | Entscheidungs-Inbox (⚠ Überschneidung mit W5-06/08) | M | blockiert | DF-16 | hqS/fe | hqS/S3 | KG·m | P |
+| DF-18 | Entscheidungs-Inbox; übernimmt W5-08a/08b (Postfach in App und Cockpit, Abnahme: Screenshot hell/dunkel, Tastatur) | M | blockiert | DF-16, W5-06b | hqS/fe | hqS/S3 | KG·m | P, W5:248–249 |
 
 ## S4 — W5 Phase D–G, DF-Ausbau, HQ2-Mitte, W1/W3-Reste
 
@@ -196,7 +231,6 @@ CI-01 und SETUP-A laufen ebenfalls (Tabellen „CI" und „SETUP" unten).
 |---|---|---|---|---|---|---|---|---|
 | W5-12 | Bilanz je Aufgabenklasse | M | blockiert | W5-05, W2-01 ✓, W5-02d | st | st/S4 | O·h | W5:262 |
 | W5-13 | Schatten-Modus (N = 20) | M | blockiert | W5-03, W5-06, W5-12 | st | st/S4 | O·h | W5:263 |
-| W5-14 | Anbieter-Scorecards | S | blockiert | W5-12 | fR | fR/S4 | KG·m | W5:264 |
 | W5-15 | Kosten-/Zeitangebot | S | blockiert | W5-12 | fR | fR/S4 | KG·m | W5:265 |
 | W5-16 | Selbst-Benchmark | S | blockiert | W4-01, W5-01c | ci | ci/S4 | Cx·m | W5:266 |
 | W5-18 | HQ-Lessons in App-Worker | S | blockiert | W5-00 ✓, W5-17 | fR (learnings.rs) | fR/S4 | KG·m | W5:272 |
@@ -224,13 +258,12 @@ CI-01 und SETUP-A laufen ebenfalls (Tabellen „CI" und „SETUP" unten).
 | DF-27 | Architekturansicht | M | blockiert | DF-05 ✓, DF-25 | hqS | hqS/S4 | KG·m | P |
 | DF-28 | Gemeinsames Design-Livebild | M | blockiert | DF-17, DF-25 | hqS/fe | hqS/S4 | KG·m | P |
 | DF-29 | Messereignisse | M | blockiert | DF-11, DF-08 | CORE st | st/S4 | O·h | P |
-| DF-30 | Statistikprojektionen | M | blockiert | DF-29, DF-24 | CORE (+st) | st/S4 | Cx·m | P |
+| DF-30 | Statistikprojektionen; übernimmt W5-14 (Anbieter-Scorecards: unverifizierte Werte fließen nicht ein) | M | blockiert | DF-29, DF-24, W5-12 | CORE (+st) | st/S4 | Cx·m | P, W5:264 |
 | DF-31 | Statistik-Cockpit | M | blockiert | DF-02 ✓, DF-30 | hqS/fe | hqS/S4 | KG·m | P |
 | DF-32 | Releaseprognose | M | blockiert | DF-06, DF-30 | CORE/hqS (teilen) | fR/S4 | Cx·m | P |
 | DF-34 | Vorlagen im Arbeitsfluss | M | blockiert | DF-10, 18, 23, 33 | hqS/fe | hqS/S4 | KG·m | P |
 | HQ2-02 | Demo-/Studio-Abnahme (Inhalt über #70 gemergt) | M (g) | blockiert: Nutzer- und visuelle Prüfung | HQ2-01 ✓ | hqS | N/S4 | N | P |
 | HQ2-03 | Gemeinsame Design-Tokens Hell/Dunkel | M | blockiert durch HQ2-02 | HQ2-02 | hqS/fe (neue Token-Dateien) | hqS/S4 | KG·m | P |
-| HQ2-04 | Code-Chat: beratende vs. aktive Sitzung, Providerwechsel | M | offen | HQ2-01 ✓ | fe (React-Chat) | fe/S4 | KG·m | P |
 | HQ2-05b | Echte Collector-/Billing-Proben je Anbieter | M (g) | offen | HQ2-05a ✓ | fR + N | fR/S4 | Cx·m | P |
 | HQ2-06 | Harness-Schema und Validierung | M | blockiert durch F-CORE-3-Rest (W1-03e/f) | W1-03e/f, F6 ✓ | wk (Profile/Capabilities) | wk/S4 | Cx·m | P |
 | W1-03f | F-CORE-3 Baustein C: Zustell-Queue, `pa worker done/blocked` | M (g) | blockiert: Z-1-Protokoll am PC | W1-03e | wk + pa | wk/S4 | Cx·m | P, R:w1-03_c3 |
@@ -255,13 +288,12 @@ CI-01 und SETUP-A laufen ebenfalls (Tabellen „CI" und „SETUP" unten).
 | W5-37 | Stufe 1: Auto-Merge einfacher Klassen | S | blockiert | W5-36a/b, W5-02e, Nutzer | ci/st | st/S5 | O·h | W5:315 |
 | W5-38 | Stufe 2: Frontend und nahtstellenfreier Rust | S | blockiert | W5-37, Nutzer | ci/st | st/S5 | O·h | W5:316 |
 | W5-39 | Stufe 3: Nahtstellen | S | blockiert | W5-38, W5-29, Nutzer | ci/st | st/S5 | O·h | W5:317 |
-| HQ2-07 | Session-Bridge und Routing-Policy (vor Dispatch in M-Kinder teilen) | L (g) | blockiert | HQ2-04/05/06 | mehrere Rust-Lanes | st/mn/S5 | O·h | P |
-| HQ2-08 | Dev-HQ als installierbarer lokaler Host (Host, API, UI seriell) | L (g) | blockiert | HQ2-03/07 | api + hqS | api/S5 | O·h | P |
-| HQ2-09 | Projektstart, GitHub/Linear-Sync, Statistiken, Briefings | L (g) | blockiert | HQ2-07/08 | teilen | —/S5 | Cx·m / KG·m | P |
-| HQ2-10 | Anbieter-Smokes, Offline-/Recovery-Build, A11y, Release-Gates | L (g) | blockiert | HQ2-08/09 | teilen | N/S5 | N + KG·m | P |
-| DF-35 | Durchgängiger Runtime-Nachweis | M | blockiert | DF-20, 24, 26, 27, 28, 31, 32, 34 | Tests/doc | —/S5 | O·h | P |
-| DF-36 | PC-Politur und Designabnahme | M | blockiert | DF-35, DF-07 ✓ | hqS/fe | hqS/S5 | KG·m | P |
-| DF-37 | Abschluss und Releaseentscheidung | S | blockiert | DF-36 | doc | doc/S5 | KG·m | P |
+| HQ2-07 | Session-Bridge und Routing-Policy (vor Dispatch in M-Kinder teilen) | L (g) | blockiert | DF-10 (statt HQ2-04), HQ2-05b, HQ2-06 | mehrere Rust-Lanes | st/mn/S5 | O·h | P |
+| HQ2-08 | Dev-HQ als installierbarer lokaler Host (Host, API, UI seriell); übernimmt den installierten Offline-/Recovery-Build aus HQ2-10 | L (g) | blockiert | HQ2-03/07 | api + hqS | api/S5 | O·h | P |
+| HQ2-09 | Projektstart, GitHub/Linear-Sync, Briefings (Statistik-Anteil → DF-29–31) | L (g) | blockiert | HQ2-07/08 | teilen | —/S5 | Cx·m / KG·m | P |
+| DF-35 | Durchgängiger Runtime-Nachweis; übernimmt die Anbieter-Smokes aus HQ2-10 | M | blockiert | DF-20, 24, 26, 27, 28, 31, 32, 34 | Tests/doc | —/S5 | O·h | P |
+| DF-36 | PC-Politur und Designabnahme; übernimmt die UI-/A11y-Abnahme aus HQ2-10 | M | blockiert | DF-35, DF-07d | hqS/fe | hqS/S5 | KG·m | P |
+| DF-37 | Abschluss und Releaseentscheidung; übernimmt Review-Dispositionen und Release-Gates aus HQ2-10 | S | blockiert | DF-36 | doc | doc/S5 | KG·m | P |
 | W3-03 | Paketierte Drills (Singleton, Crash/Power-Loss, Backup) | 3 × S | blockiert | W3-02 | N + Agent | N/S5 | N + KG·m | P |
 | W3-04 | Updater-Zustände in App und HQ | S | blockiert | W3-02 | fe + hqL | fe/S5 | KG·m | P |
 | W3-07 | Produktionsschlüssel-Build + Signed-Updater-Relaunch | S (g) | blockiert: Nutzer | — | N | N/S5 | N | P |
@@ -279,78 +311,80 @@ dem Öffnen des PRs; Dev Drive und Defender-Ausnahmen richtet der Nutzer ein.
 
 | ID | Titel | Gr. | Status | Abhängig von | Lane / Dateien | Parallel-Gruppe | Modell | Quelle |
 |---|---|---|---|---|---|---|---|---|
-| CI-01 | Minuten sparen: Mergify-Queue (Batch 1–4), timeout-minutes, cancel-in-progress, kein CI auf Drafts, Windows-Plan-Schritt, Dependabot monatlich, Test-Insights-Upload | M (g) | in Arbeit (Worker läuft; strict ist seit 24.09. aus, Auto-Retry im Dashboard gesetzt; Mergify-Bot-PR #105 offen) | — | ci (.github/workflows/ci.yml, .mergify.yml) | ci/S0 | O·h | Nutzer 24.09. |
-| CI-02 | Leichtes prepush für Branch-Pushes, volles Gate vor PR-Öffnung | S (g) | blockiert durch CI-01 | CI-01 | ci (scripts/ci/gates.sh, .githooks) | ci/S2 | O·h | Nutzer 24.09. |
+| CI-02 | Leichtes prepush für Branch-Pushes, volles Gate vor PR-Öffnung; enthält W1-19b (Dependabot-Commits im red-first-Gate, `ci.yml`-Kommentar nach W0-06) und den pre-push-Hook, der den Hauptcheckout statt des Worktrees prüft | S (g) | in Arbeit | CI-01 ✓ | ci (scripts/ci/gates.sh, .githooks, ci.yml) | ci/S0 | O·h | Nutzer 24.09., P (W1-19b) |
+
+CI-01 ist erledigt (#108, `docs/ERLEDIGT.md`). Seither: Required Checks `gates (linux)`, `gates (windows)`,
+`red-first` und `Mergify Merge Protections`; die Labels `do-not-merge`, `priority`, `conflict` sind angelegt.
 
 ## SETUP — Doku, Agenten-Setup, Automatisierung (Setup-Audit 24.09.)
 
 Quelle: Setup-Audit-Plan des Koordinators vom 24.09. (Pakete SETUP-00 bis SETUP-15). SETUP-11 ist in
-W5-02b6 aufgegangen. Dateien, die hier einem Paket gehören (`AGENTS.md`, `CLAUDE.md`, `README.md`,
-`PRODUCT.md`, `docs/setup/**`, `.github/**`, `.mergify.yml`), fasst kein anderes Paket an.
+W5-02b6 aufgegangen. Erledigt (`docs/ERLEDIGT.md`): SETUP-A (#119, deckt SETUP-01/02/03/06/07 und laut
+PR-Text auch SETUP-10 und SETUP-13), SETUP-05 (#114), SETUP-00 (ohne PR). Dateien, die hier einem Paket
+gehören (`AGENTS.md`, `CLAUDE.md`, `README.md`, `PRODUCT.md`, `docs/setup/**`, `.github/**`,
+`.mergify.yml`), fasst kein anderes Paket an.
 
 | ID | Titel | Gr. | Status | Abhängig von | Lane / Dateien | Parallel-Gruppe | Modell | Quelle |
 |---|---|---|---|---|---|---|---|---|
-| SETUP-A | Setup-Doku je Anbieter (`docs/setup/`), Prüfskript `agent-setup-check` (`npm run dev:agent-check`), `@AGENTS.md`-Import in CLAUDE.md, README/PRODUCT nachziehen (SETUP-01/02/03/06/07) | 2 × M + 3 × S (g) | in Arbeit (Branch `claude/setup-a-docs-skill-check`, noch kein PR) | — | doc + scripts/dev (CLAUDE.md, README.md, PRODUCT.md, docs/setup/**) | doc/S0 | O·h / Sonnet | Setup-Audit §5 |
-| SETUP-00 | Reihenfolge mit CI-01 festzurren (Labels, Mergify-Block, Docs-only-Filter, PR #105) | S | offen | — | Koordinator | N/S1 | Koordinator | Setup-Audit §5 |
-| SETUP-05 | KNOWN_ISSUES nachziehen, KI-24… aus STAND übernehmen | S | in Arbeit (im PR der Plan-Dokumente) | #104 ✓ | doc (KNOWN_ISSUES.md) | doc/S0 | O·h | Setup-Audit §1.3 |
-| SETUP-B | Dev-Skripte: Git-/PR-Helfer (SETUP-08a: report-commit, push-verified, prune-worktrees, build-slot, ci-watch) und Plan-/Spec-Helfer (SETUP-08b: pr-status, erledigt-row, spec-close, hygiene), je mit Selbsttests | 2 × M | offen (08b erst nach Merge der Plan-Dokumente) | 08b: Plan-Dokumente | scripts/dev, scripts/lib | doc/S1 | O·h | Setup-Audit §5 |
-| SETUP-09 | Lokaler Review-Lauf `scripts/review/run-local.sh` (Kimi K3 + GLM 5.2), `review.yml` als ruhend markieren | S | offen | — | scripts/review | doc/S1 | O·h | Setup-Audit §5 |
-| SETUP-13 | Repo-Hygiene: WORKFLOW.md-Altabschnitt historisch, `.codex/hooks.json` relativer Pfad, Kopfkommentar `review.yml` | S | offen | — | docs/development, .codex, .github | doc/S1 | Sonnet | Setup-Audit §5 |
-| SETUP-04 | AGENTS.md: Mergify-Block, Reviews/Advisors, PR-/CI-Minuten-Regeln, Setup-Links, Build-Slots | M | blockiert | CI-01, Plan-Dokumente, SETUP-A | doc (AGENTS.md) | doc/S2 | O·h | Setup-Audit §1.1, §4 |
-| SETUP-10 | `docs/setup/permissions-proposal.md` (der Nutzer trägt die Regeln ein) | S | blockiert | SETUP-B (Skriptnamen) | doc | doc/S2 | Sonnet | Setup-Audit §6.2 |
-| SETUP-12 | Docs-only-Pfadfilter mit Required-Check-Erfüllung, `push: main` reduzieren | M | blockiert | SETUP-00, CI-01, Nutzer-Rückfragen 3/4 | ci | ci/S2 | O·h | Setup-Audit §5 |
-| SETUP-14 | Nutzer: tote Keys entfernen, OpenCode-Modelle, KI-21-Hook-Status, `ollama signin`, Permission-Regeln | S | blockiert | SETUP-A, SETUP-10 | N | N/S2 | N | Setup-Audit §5 |
+| SETUP-B | Dev-Skripte: Git-/PR-Helfer (SETUP-08a: report-commit, push-verified, prune-worktrees, build-slot, ci-watch) und Plan-/Spec-Helfer (SETUP-08b: pr-status, erledigt-row, spec-close, hygiene), je mit Selbsttests | 2 × M | in Arbeit (SETUP-08a: PR #126 offen; SETUP-08b folgt) | Plan-Dokumente ✓ | scripts/dev, scripts/lib | doc/S0 | O·h | Setup-Audit §5 |
+| SETUP-04 | AGENTS.md: Mergify-Block, Reviews/Advisors, PR-/CI-Minuten-Regeln, Setup-Links, Build-Slots; dazu dieser Plan-Nachtrag | M | in Arbeit | CI-01 ✓, Plan-Dokumente ✓, SETUP-A ✓ | doc (AGENTS.md, Plan-Dokumente) | doc/S0 | O·h | Setup-Audit §1.1, §4 |
+| SETUP-09 | Lokaler Review-Lauf `scripts/review/run-local.sh` (Kimi K3 + GLM 5.2); `review.yml` ist schon als ruhend markiert (SETUP-A) | S | offen | — | scripts/review | doc/S1 | O·h | Setup-Audit §5 |
+| SETUP-12 | Docs-only-Pfadfilter mit Required-Check-Erfüllung, `push: main` reduzieren (CI-01-Folgearbeiten 1 und 2) | M | offen (ci-Lane nach CI-02) | CI-01 ✓ | ci | ci/S2 | O·h | Setup-Audit §5, R:ci-01 |
+| SETUP-14 | Nutzer: tote Keys entfernen, OpenCode-Modelle, KI-21-Hook-Status, `ollama signin`, Permission-Regeln aus `docs/setup/permissions-proposal.md` | S | offen (Nutzer) | SETUP-A ✓ | N | N/S2 | N | Setup-Audit §5 |
 | SETUP-15 | Abschlussreview aller Setup-Dokumente und Skripte, Fix-Runde, Verifier | M | blockiert | alle SETUP-Pakete | doc | doc/S5 | Fable 5.1 + GPT-6 Astra | Setup-Audit §5 |
 
 ## Worker-Struktur
 
 - **Build-Slots:** vier Cargo-Targets (Hauptcheckout-`target/`, `%USERPROFILE%/cargo-targets/projecta-a`, `-b`, `-c`).
-  Der Rechner hat 16 GB RAM, deshalb **höchstens drei Cargo-Builds gleichzeitig**.
-  `CARGO_PROFILE_*` nie setzen, das invalidiert den Cache.
-- **Gleichzeitig:** höchstens 3 Rust-Implementer (je ein Slot) plus Pakete ohne Cargo
-  (fe, hqL, hqS, ci, doc). PLAN §4 verweist für die Gleichzeitigkeit hierher; die alte Obergrenze
-  „vier Implementer“ (HQ2/DEVFLOW) ist gestrichen, offen als Frage an den Nutzer.
-  Reviewer laufen über Ollama Cloud/OpenCode ohne lokalen Build.
+  Der Rechner hat 16 GB RAM, deshalb **höchstens drei Cargo-Builds gleichzeitig**, freier RAM vor jedem Lauf
+  prüfen. `CARGO_PROFILE_*` nie setzen, das invalidiert den Cache. Regeln: `AGENTS.md` („Build slots“).
+- **Gleichzeitig:** Die Zahl der Implementer ist nicht begrenzt (Nutzer 24.09.: die alte Obergrenze „vier
+  Implementer“ ist aufgehoben). Begrenzt sind nur die Cargo-Builds (Slots, RAM) und die seriellen Lanes;
+  Pakete ohne Cargo (fe, hqL, hqS, ci, doc) laufen daneben. PLAN §4 verweist hierher.
+  Reviewer laufen über Ollama Cloud ohne lokalen Build.
 - **Serielle Lanes (je ein aktives Paket):** st, api, mn, pa. Dazu die Datei-Lanes pty, wk,
   sup (supervisor.rs läuft mit mn, wegen W2-06), ci, hqS (FIFO-Integrator, PLAN „Planreview-Disposition“) und hqL (hq.js).
-  `docs/PLAN.md`, `STAND.md`, `MASTERPLAN.md` und `ERLEDIGT.md` schreibt nur der Koordinator.
+  `docs/PLAN.md`, `STAND.md`, `MASTERPLAN.md` und `ERLEDIGT.md` schreibt nur der Koordinator oder das
+  Paket, dem er sie ausdrücklich zuweist.
 - **st ist der Engpass** (etwa 35 Pakete). Vorgeschlagene Reihenfolge:
-  W2-04b (in Arbeit) ∥ W2-05 (#107, nur `store/discovery.rs`) → W2-03 → W5-05 → W5-01a → W1-05b(st) →
-  W2-02b → W2-04c → W2-04d → W5-01c → W5-04a → DF-11 → W5-17 → DF-12 → W5-03 → W5-06 → W5-09a → DF-14 →
-  DF-15 → DF-15b → W5-12 → W5-13 → W5-30a → W5-21 → W5-23 → W5-25 → DF-24 → DF-29 → DF-30 → W5-33 →
-  W3-01(st) → W5-36a.
+  W2-03 (in Arbeit) → W5-05 → W5-01a → W1-05b(st) → W2-02b → W2-04c → W2-04d → W2-04g (optional) → W5-01c →
+  W5-04a → DF-11 → W5-17 → DF-12 → W5-03 → W5-06 → W5-09a → DF-14 → DF-15 → DF-15b → W5-12 → W5-13 →
+  W5-30a → W5-21 → W5-23 → W5-25 → DF-24 → DF-29 → DF-30 → W5-33 → W3-01(st) → W5-36a.
   Vorschlag zur Entscheidung: eine ADR, die st für unabhängige `store/`-Module teilt (PLAN §5 Nr. 17).
-- **mn:** W1-22 (in Arbeit) → W2-06 → W4-03a → W1-09c(mn) → W5-04b → W3-01(mn) → W5-31a → W5-31c → W4-03.
-- **api:** W2-01b → W2-07b → W1-05b(api) → W2-04f → W5-02b3(api) → W5-01b → W5-06b → DF-16 → HQ2-08(API).
-- **pa:** W5-04c → W5-31b (W1-03f anteilig).
-- **pty:** W1-15c → W1-01b → W5-02b4 → W1-27.
-- **wk:** W5-02b6 → W5-02a → W5-00b → W2-09b → W1-03e → W2-04e → W5-10 → HQ2-06 → W1-03f.
-- **ci:** CI-01 (in Arbeit) → W1-19b → CI-02 → SETUP-12.
-- **doc:** Plan-Dokumente (in Arbeit) → SETUP-B(08b) → SETUP-04.
+- **mn:** W2-06 (in Arbeit) → W4-03a → W1-09c(mn) → W5-04b → W3-01(mn) → W5-31a → W5-31c → W4-03.
+- **api:** W2-01b (#124, Queue) → W2-07b → W1-05b(api) → W2-04f → W5-02b3(api) → W5-01b → W5-06b → DF-16 → HQ2-08(API).
+- **pa:** W2-01d → W5-04c → W5-31b (W1-03f anteilig).
+- **pty:** W1-15c (in Arbeit) → W1-01b → W5-02b4 → W1-27.
+- **wk:** W5-02a → W5-00b → W2-09b → W1-03e → W2-04e → W5-10 → HQ2-06 → W1-03f.
+- **hqL:** W1-10 → W5-02b7 → W2-10 → W1-17.
+- **ci:** CI-02 (in Arbeit, mit W1-19b) → SETUP-12.
+- **doc:** SETUP-B und SETUP-04 (beide in Arbeit, disjunkte Dateien) → SETUP-15.
 - **Migrationen:** 22 ist mit DF-15a (#103) vergeben. Jede weitere Migration (W5-01a, W5-05 …)
   bekommt ihre Nummer erst beim Dispatch vom Koordinator.
 
-## Offene Folgearbeiten ohne Paket in PLAN/W5-Plan (neu vorgeschlagen, 26 Pakete, 36 Punkte)
+## Offene Folgearbeiten ohne Paket in PLAN/W5-Plan (neu vorgeschlagen, 27 Pakete, 37 Punkte)
 
-Dazu kommen CI-01/02 (4 Punkte) und die SETUP-Pakete (30 Punkte) aus den Tabellen oben.
+Dazu kommen CI-02 (1 Punkt offen) und die offenen SETUP-Pakete (17 Punkte) aus den Tabellen oben.
+Erledigt sind W2-04b, W1-24c und W5-02b6 (`docs/ERLEDIGT.md`). Quelle jedes Pakets ist der genannte Report.
 
 | Neu-ID | Inhalt | Gr. | Lane | Quelle |
 |---|---|---|---|---|
 | W2-01b | Review-Route: `reviewerRunId` aus dem Credential | S | api | R:w2-01 Folge 1 |
 | W2-01c | `approvalAuthority` in agent_access.rs:355 angleichen | S | fR | R:w2-01 Folge 2 |
+| W2-01d | CLI-Befehl `pa hq agent review` | S | pa | PR #124 |
 | W2-02b | Gleichstand in derselben Sekunde, vertrauenswürdige Testquelle, Merge-Ergebnis als Kandidat | M | st | PR #96, R:w2-02 |
-| W2-04b | `verified` nur mit Reviewer-Rolle; Rollencheck in der bind-Transaktion | S | st | R:w2-04 1+2, R:w2-01 3 |
 | W2-04c | Rollenbewusste Routen/Credentials beim Launch | M | st | R:w2-04 3 |
 | W2-04d | Rollen → Budget-Zwecke | S | st | R:w2-04 4 |
 | W2-04e | `dispatch.role` im Briefing | S | wk | R:w2-04 5 |
 | W2-04f | Planungsendpunkte nur für den Koordinator | S | api | R:w2-04 6 |
+| W2-04g | optional: Versionsspalte für die Attestierungsregel (KD1) | S | st | R:w2-04b Folge 2 |
 | W2-07b | Windows-ACL für `projecta-api.json` und `agent-access/`, Eigentümer prüfen | S | api/fR | R:w2-07 §5 |
 | DF-15b | Reservierung/Delivery für `exited_undelivered` freigeben (Produktfrage, KI-27) | S | st | R:df15_early_provider_exit |
 | W5-00b | Fremden Text in workers.rs-Prompts suchen und einhüllen | S | wk | R:w5-00 |
 | W5-02b3 | Env-Stufe als globale Einstellung mit UI (drei Kinder) | M | st → api → fe | R:w5-02b |
 | W5-02b4 | Push in den Runner-Host, danach `strict` als Default | M | pty + wk | R:w5-02b, PR #102 |
 | W5-02b5 | `http.extraHeader`-Reset-Test; GPG unter strict | S | fR | R:w5-02b |
-| W5-02b6 | Kimi auf allowlist (+ `USERPROFILE`/`HOME`/`APPDATA`/`LOCALAPPDATA`, Probe); Default für agents.json | S | wk | PR #102, Setup-Audit |
+| W5-02b7 | HQ-Profilansicht zeigt `envPolicy` | S | hqL | PR #121 |
 | W1-01b | Kimi-Re-Smoke mit PTY-Trace | S | pty | PR #101 |
 | W1-09c | KI-1 editierbar (Setter, Command, Feld) | M | st → mn → fe | R:w1-09b, PR #99 |
 | W1-15c | Übrige pty.rs-Mutex-Stellen, `api/agent_access.rs:266` | S | pty | R:w1-15b |
@@ -358,41 +392,39 @@ Dazu kommen CI-01/02 (4 Punkte) und die SETUP-Pakete (30 Punkte) aus den Tabelle
 | W1-21c | xterm-`pageerror` beim Mount | S | fe | R:w1-21b |
 | W1-21d | Suchschalter Groß/Klein und Regex | S | fe | R:w1-21, R:w1-21b |
 | W1-23c | „-0 Tokens“; MSRV-Messung | S | fR | R:w1-23b |
-| W1-24c | KNOWN_ISSUES F-SEC-4-Restrisiko (KI-29) | S | doc | R:w1-24b |
 | W1-27 | KI-20 ESC[6n-Doppelantwort (braucht Entscheidung) | S | pty + fe | KNOWN_ISSUES KI-20 |
 | W1-29 | Linux-Flake Prozessgruppen-Test | S | fR | KNOWN_ISSUES KI-25 |
+| W1-30 | Flake `omniroute::…management_failures_keep_their_http_and_network_classes` | S | fR | R:w1-22 |
 | W4-03a | Journal-Teil von W4-03 ohne Aktivierung (in PLAN als Vorschlag geführt) | S | mn | W5:53/321 |
 
 Kein Paket, nur Daueraufgabe oder Nutzer:
 - `SINGLE_VENDOR_PROVIDERS` pflegen (R:w2-01 Folge 5).
 - KNOWN_ISSUES KI-24 (SQLite-Lastklasse) und KI-26 (Windows-PTY-Argumenttest) beobachten.
+- Idempotenz des Mergify-Konfliktkommentars beim ersten echten Konflikt beobachten (R:ci-01, kimi F6).
 - **Nutzer:** Secrets aus Repo-Ebene in geschützte Environments verlegen; Required Reviewers für
-  `release`/`review` eintragen; Release-Frage für die Arbeit nach 1.4.1 (PLAN §5 Nr. 14–15).
+  `release`/`review` eintragen; Release-Frage für die Arbeit nach 1.4.1 (PLAN §5 Nr. 14–15);
+  `MERGIFY_TOKEN` und CI Insights im Mergify-Dashboard (R:ci-01 „Nutzer-Schritte“).
 
 ## Hygiene-Befunde
 
-Erledigt im PR der Plan-Dokumente: STAND.md ist neu geschnitten (historische PR-#39-Übergabe und
-Integrationswellen-Blöcke entfernt, Konfliktmarker waren schon mit #104 weg); die neun Specs
-`task_w1-09`, `-11`, `-15`, `-16`, `-21`, `-23`, `-25`, `-26` und `task_hq2-11` stehen auf
-`historisch`; KNOWN_ISSUES heißt v1.4.1, behobene KIs stehen im Block „Behoben", die Flakes aus STAND
-sind KI-24 bis KI-29; der Lane-Verstoß #96/#103 ist mit beiden Merges gegenstandslos.
+Erledigt: STAND.md neu geschnitten, neun Specs auf `historisch`, KNOWN_ISSUES v1.4.1 mit KI-24 bis KI-29
+(alles #114); die Doppelungen zwischen den Plänen sind als Aliase entschieden (Abschnitt oben); DF-07d
+bleibt offen bis zum visuellen PASS; Folgepakete brauchen keine Spec; `task_w1-19.md` ist `historisch`
+(W1-19b in CI-02 aufgegangen); PR #105 ist geschlossen, #107 gemergt.
 
 Offen:
 
 1. **PR #70** zeigt „closed“, sein Inhalt ist aber als `fef9eaa` („Merge pull request #70“) auf main.
    Der Branch `codex/dev-hq-unified-141` (Kopf `50192b8`) ist tot und kann gelöscht werden.
-2. **Es fehlen Specs** (`.pa/task_<id>.md` + STAND-Zeile, PLAN §0.6) für die gelaufenen oder laufenden
-   W2-01, W2-02, W2-04, W2-04b, W2-05, W2-07, W5-00, W5-02b, W5-02b2, KI-23, W1-09b und W1-01a.
-   Ein eigener W1-19-Report fehlt. Vorschlag: für Folgepakete aus Reports keine Spec-Pflicht, sonst ab
-   sofort mit Spec dispatchen (Frage an den Nutzer).
-3. **Doppelungen zwischen den Plänen**, vor dem Dispatch je ein Paket festlegen:
-   DF-18 ↔ W5-06/08a/08b (Postfach), DF-19/20 ↔ W5-30b/33 (Routing), DF-29–31 ↔ W5-12/14 (Statistik),
-   DF-12 ↔ W2-01 + W5-02d (Unabhängigkeit/Signatur), HQ2-03/04/06/09/10 ↔ DF-02/07/09/10/19/35–37.
-4. **DF-07d:** Der Report sagt „kein visueller PASS, das Gate übernimmt der Koordinator“, die alte
-   PLAN-Zeile sprach von gemessenen Screenshots. PLAN nennt DF-07 jetzt nur „erledigt“; die visuelle
-   Abnahme holt DF-36 nach. Bestätigung durch den Nutzer offen.
-5. **Remote-Branches zum Löschen** (der Nutzer muss das tun, Auto-Mode blockiert es):
-   - rund 45 gemergte Branches (`claude/w1-*`, `claude/w2-*`, `kimi/*`, `codex/continuous-devhq` …);
+2. **pre-push-Hook prüft den Hauptcheckout:** Wegen `core.hooksPath` fährt der Hook die Gates im
+   Hauptcheckout statt im Worktree, der gepusht wird; ein rotes Gate dort (z. B. veraltetes
+   `node_modules`) blockiert jeden Push. Nicht umgehen (kein `--no-verify`, kein `-c core.hooksPath`);
+   Behebung in CI-02.
+3. **PLAN-Pakete ohne Spec:** W2-03, W2-06 und W2-08a sind Pakete aus PLAN (keine Folgepakete) und laufen
+   ohne `.pa/task_<id>.md` (PLAN §0.6). Ein eigener W1-19-Report fehlt weiter.
+4. **Remote-Branches zum Löschen** (der Nutzer muss das tun, Auto-Mode blockiert es; seit 24.09. löscht
+   GitHub gemergte Head-Branches selbst):
+   - rund 45 gemergte Branches aus der Zeit davor (`claude/w1-*`, `claude/w2-*`, `kimi/*`, `codex/continuous-devhq` …);
    - geschlossen bzw. ersetzt: `claude/w1-13-api-reste` (#58 → #64), `claude/w1-03c-guard-hardening`
      (#81 → #88, 1 Commit vor main, erst prüfen), `codex/dev-hq-unified-141`;
    - alte Vor-Squash-Branches vom 02.–08.09.: `pa/p2f-lint-2026-09-02`, `gt/refinery/7411a522`,
@@ -400,16 +432,18 @@ Offen:
      `chore/salvage-leftover-prs`, `cuarroc-dev-hq-usability`.
    - **Zu prüfen:** `claude/w1-16-claim-recovery` hat nach dem Merge von #82 einen Commit,
      der nicht auf main ist.
-6. **Offene PRs:** #107 (W2-05) und #105 (Mergify-Bot, Konfiguration; entscheidet CI-01/SETUP-00).
-7. **Lokal:** Im Koordinations-Worktree liegen ungetrackte `MEMORY.md` und `$OUT`.
+5. **Offene PRs:** #124 (W2-01b) in der Merge-Queue, #126 (SETUP-08a) und #109 (Dependabot,
+   github-actions) sowie #111 (npm).
+6. **Lokal:** Im Koordinations-Worktree liegen ungetrackte `MEMORY.md` und `$OUT`.
 
 ## Nächste Schritte (Top 5, sobald Slots frei sind)
 
-1. **Laufende Pakete mergen:** W2-05 (#107), W2-04b, W1-22, CI-01, SETUP-A, Plan-Dokumente.
-2. **W2-03** (st, M, O·h) direkt nach W2-04b; **W2-06** (sup + mn, M, O·h) direkt nach W1-22.
-3. **W2-08** (fR, M, Cx·m) sofort, keine Nahtstelle, belegt einen Build-Slot.
-4. **W2-01b** (api, S, O·h) sofort, die api-Lane ist frei; danach W2-07b.
-5. **W5-02b6** (wk, S, O·h) sofort, Entscheidung liegt vor; danach W5-02a. **W1-15c** (pty) sofort.
+1. **Queue abarbeiten lassen:** #124 (W2-01b) und #126 (SETUP-08a), danach W2-01d (pa). **W5-02b7**
+   (hqL, S, kein Cargo) und
+   **W5-02a** (wk) sind seit dem Merge von #121 frei.
+2. **Laufende Pakete abschließen:** W2-03 (st), W2-06 (mn), W2-08a (fR), W1-15c (pty), CI-02 (ci), SETUP-B, SETUP-04.
+3. **DF-07d:** Screenshots der React-Dichte ansehen und den visuellen PASS festhalten (kein Cargo).
+4. **Nach W2-01b:** W2-07b (api).
+5. **W1-30** (fR, S): omniroute-Flake klären, bevor er Queue-Läufe rot färbt.
 
-Nebenläufig ohne Build-Slot (KG·m): W1-10, W1-19b (mit CI-01 abstimmen), W1-21c, DF-09b, SETUP-B(08a),
-SETUP-09, SETUP-13.
+Nebenläufig ohne Build-Slot (KG·m): W1-10, W1-21c, DF-09b, SETUP-09.
diff --git a/docs/PLAN.md b/docs/PLAN.md
index 4256f40..c23dffd 100644
--- a/docs/PLAN.md
+++ b/docs/PLAN.md
@@ -36,13 +36,13 @@ PR #70.
 |---|---|---|---|
 | HQ2-02 | Abnahme der Konzeptdemo und Studio-Variante (Inhalt über PR #70 auf `main`): Nutzer- und visuelle Browserprüfung vor Übernahme; simulierte Zustände markiert | getrennte Demodateien und Reviewbericht | HQ2-01 ✓ |
 | HQ2-03 | Gemeinsame Design-Tokens für Hell/Dunkel, Typografie, Dichte, Fokus und reduzierte Bewegung; App/HQ erhalten jeweils passende Layouts | M, neue Token-Dateien | HQ2-02-Review |
-| HQ2-04 | Code-Chat-Oberfläche: beratende und aktive Worktree-Sitzung sichtbar trennen; manueller Providerwechsel mit expliziter Übergabe | M, React-Chat-Dateien | HQ2-01 ✓ |
+| HQ2-04 | **Alias → DF-10** (Nutzerentscheidung 24.09.: bei Überschneidung gewinnt die DF-ID). Inhalt: Code-Chat-Oberfläche, beratende und aktive Worktree-Sitzung sichtbar trennen; manueller Providerwechsel mit expliziter Übergabe | 0 Punkte, kein Dispatch | — |
 | HQ2-05b | Echte Collector-/Billing-Proben je Anbieter, danach Kapazitätsanbindung | getrennte S/M-Pakete | HQ2-05a ✓ |
 | HQ2-06 | Harness-Schema und Validierung, geführte Vorlagen plus Expertenfelder | M, Profile/Capabilities-Lane | F-CORE-3-Rest (W1-03e/f) und F6 |
-| HQ2-07 | Gemeinsame Session-Bridge und Routing-Policy, erst manuell, dann Auto innerhalb bestehender Budgets | je M, getrennte Rust-Lanes | HQ2-04/05/06 |
+| HQ2-07 | Gemeinsame Session-Bridge und Routing-Policy, erst manuell, dann Auto innerhalb bestehender Budgets | je M, getrennte Rust-Lanes | DF-10 (statt HQ2-04), HQ2-05b, HQ2-06 |
 | HQ2-08 | Dev-HQ als installierbarer lokaler App-Host ohne Node/Repo; bisheriges App-Webinterface ablösen, bestehende HQ-Funktionen erhalten, kein LAN-Zugang | serielle M-Pakete für Host, API und UI | HQ2-03/07 |
 | HQ2-09 | Projektstart/-koordination, GitHub/Linear-Sync, belegbare Statistiken und knappe Agenten-Briefings | getrennte M-Pakete nach Integrationsgrenze | HQ2-07/08 |
-| HQ2-10 | Anbieter-Smokes, installierter Offline-/Recovery-Build, UI-/A11y-Abnahme, Review-Dispositionen und Release-Gates | S/M-Proben je Bereich | HQ2-08/09 |
+| HQ2-10 | **Alias → DF-35/36/37** (Nutzerentscheidung 24.09.). Inhalt: Anbieter-Smokes (→ DF-35), UI-/A11y-Abnahme (→ DF-36), Review-Dispositionen und Release-Gates (→ DF-37); der installierte Offline-/Recovery-Build gehört zu HQ2-08 | 0 Punkte, kein Dispatch | — |
 
 Ein Paket, ein Implementer, ein Worktree. HQ2-06 erst nach seinen Gates.
 Gleiche Datei und die vier Nahtstellen bleiben seriell. S/M-Grenzen und
@@ -60,9 +60,10 @@ Aktivierung von Continuous, keine implizite Release- oder Kostenfreigabe.
 Ausführungsstand und Policy: `.pa/report_devflow_execution.md`.
 
 **Erledigt** (→ `docs/ERLEDIGT.md`): DF-00 bis DF-05 vollständig, DF-06a,
-DF-07 (a–d), DF-08a–c (alle über PR #70), DF-09a (PR #100) und DF-15a
-(PR #103). Offen sind DF-06b, DF-08d, der Rest von DF-09 und DF-15 sowie
-DF-10 bis DF-37.
+DF-07a–c, DF-08a–c (alle über PR #70), DF-09a (PR #100) und DF-15a
+(PR #103). Offen sind DF-06b, DF-07d (der Code ist über PR #70 gemergt, der
+visuelle PASS fehlt; DF-07 bleibt bis dahin offen, Nutzerentscheidung 24.09.),
+DF-08d, der Rest von DF-09 und DF-15 sowie DF-10 bis DF-37.
 
 ### Anschluss an HQ2 und die Wellen
 
@@ -72,9 +73,12 @@ Profile → HQ2-06; gemeinsamer Host → HQ2-08; Analyse → HQ2-09;
 Abnahme → HQ2-10. F-CORE-3 → F6 → Multi-Harness und W2-09b bleiben
 Voraussetzungen echter Provider-Ausführung. W4-01 liefert Benchmark-Evidenz;
 W4-02/03 bleiben Abnahme und menschliche Continuous-Aktivierung.
-Überschneidungen mit HQ2 und W5 sind vor dem Dispatch einem einzigen Paket
-zuzuordnen (offene Liste in `docs/MASTERPLAN.md`, „Hygiene-Befunde"): keine
-Doppelarbeit.
+Überschneidungen mit HQ2 und W5 sind einem einzigen Paket zugeordnet
+(Nutzerentscheidung 24.09.): **bei Überschneidung gewinnt die DF-ID**, die
+überlappende HQ2- oder W5-Zeile wird ein Alias ohne Punkte (HQ2-04 → DF-10,
+HQ2-10 → DF-35/36/37, W5-08a/08b → DF-18, W5-14 → DF-30). Liste und
+Begründung, auch für die geprüften Paare ohne Alias: `docs/MASTERPLAN.md`,
+„Aliase". Keine Doppelarbeit.
 
 ### Verträge und Zuständigkeiten
 
@@ -129,7 +133,7 @@ Jede Abnahme gilt zusätzlich zum gemeinsamen Abschlussprotokoll weiter unten.
 | DF-04 | Planimport · Backend · CORE · M | DF-03 | Erledigt (PR #70, DF-04a/b/c). Markdown-Pakete mit stabilen IDs und Quellenrevision projizieren; Tests für fehlende IDs, Zyklen, geänderte Quelle, Wiederimport ohne Duplikate. |
 | DF-05 | Plan-Lesezugriff · Integrator · SEAM/HOST · M | DF-04 | Erledigt (PR #70, DF-05a/b). Gemeinsamen lesenden App/HQ/CLI-Vertrag anbinden; identische Paketdaten und explizite Fehler statt leeren Erfolgs prüfen. |
 | DF-06 | Grafische Roadmap · Frontend · HQ · M | DF-02, DF-05 | DF-06a erledigt (PR #70). Offen DF-06b: Ausführungszustände bereit/aktiv/erledigt nach DF-11/DF-16 mit belegter Paket-/Run-Bindung; bis dahin bleibt der Ausführungsstatus unbekannt. Hierarchie, Abhängigkeiten, kritischer Pfad, Quellenklick und Prioritätsgrund mit echtem Plan und leeren/fehlerhaften Daten prüfen. |
-| DF-07 | Desktop-Dichte · Frontend · HQ/APP · M | DF-02 | Erledigt (PR #70, DF-07a–d). Komfortabel/Kompakt ändern messbar Zeilenhöhe, Abstand, Paneelgrößen und sichtbare Informationsmenge; Screenshots bei 1280×800 und 1920×1080, Tastatur und Zoom prüfen. |
+| DF-07 | Desktop-Dichte · Frontend · HQ/APP · M | DF-02 | DF-07a–c erledigt (PR #70). Offen DF-07d: visueller PASS der React-Dichte (Code über PR #70 gemergt, `.pa/report_df07d_native_density.md`); DF-07 ist erst danach abgenommen. Komfortabel/Kompakt ändern messbar Zeilenhöhe, Abstand, Paneelgrößen und sichtbare Informationsmenge; Screenshots bei 1280×800 und 1920×1080, Tastatur und Zoom prüfen. |
 | DF-08 | Ausführungsidentität · Backend · CORE · M | DF-03 | DF-08a–c erledigt (PR #70). Offen DF-08d: native Modellbeobachtung, Adapter-/Profilbelege, Workflow-Anbindung nach DF-11. Provider, Modell/Familie, Adapter und Erscheinungsprofil getrennt führen; konfiguriert ist nicht beobachtet; Alias-/Unbekannt-Fälle testen. |
 | DF-09 | Profilwahl im Chat · Frontend · HQ/APP · M | DF-02, DF-08 | DF-09a erledigt (PR #100, lokale Chat-Erscheinungen). Offen DF-09b: React-Parität und Admission-Kompatibilität. UI-Profil Codex/Claude/DeepSeek unabhängig vom belegten Modell wählen; unterstützte native Kombinationen von reiner Darstellung unterscheiden, inkompatible Starts verweigern. |
 | DF-10 | Chat-Modi und Interview · Integrator · CORE/SEAM/HQ/APP · M | DF-01, DF-03, DF-09 | Plan/Interview/aktive Ausführung mit konkreten Rückfragen und Projektkontext; Planmodus darf keine Schreibbefugnis erzeugen. Reale Sitzung mit Antwort belegen; Integration bei Bedarf in Kinder teilen. |
@@ -182,8 +186,9 @@ der echte Provider-Rücklauf bleibt Teil der Abnahme von DF-10/DF-36
 
 ### Reihenfolge
 
-Vorbereitung (DF-00 bis DF-03) und das erste sichtbare Ergebnis (DF-04 bis
-DF-07, DF-08a–c) sind erledigt. Weiter:
+Vorbereitung (DF-00 bis DF-03) und das erste sichtbare Ergebnis (DF-04,
+DF-05, DF-06a, DF-07a–c, DF-08a–c) sind erledigt; DF-07d wartet auf den
+visuellen PASS. Weiter:
 
 1. **Erste echte Kette:** DF-11, dann DF-12→13→14→15→16, dann DF-17/18; eine
    kleine vorhandene Planaufgabe mit echter Antwort, unabhängiger Abnahme und
@@ -263,12 +268,14 @@ dem Merge von PR #70, wie es der W5-Plan vorsah.
 
 - **Kritischer Pfad:** W2-01 ✓ → W2-02 ✓ → W2-04 ✓ → Journal-Teil von W4-03
   (Vorschlag W4-03a, siehe W4 und §5) → Phase A → B → C → D → G → H → J.
-- **Erledigt:** W5-00 (PR #95), W5-02b (PR #93), W5-02b2 (PR #102).
-- **Folgepakete aus Reports** (W5-00b, W5-02b3 bis W5-02b6) und die
+- **Erledigt:** W5-00 (PR #95), W5-02b (PR #93), W5-02b2 (PR #102); dazu das
+  Folgepaket W5-02b6 (PR #121).
+- **Folgepakete aus Reports** (W5-00b, W5-02b3 bis W5-02b5, W5-02b7) und die
   Einordnung aller W5-Pakete in die Lanes: `docs/MASTERPLAN.md`.
-- **Überschneidungen mit DEVFLOW** (DF-18 ↔ W5-06/08, DF-19/20 ↔ W5-30b/33,
-  DF-29–31 ↔ W5-12/14, DF-12 ↔ W5-02d) werden vor dem Dispatch dem einen oder
-  dem anderen Paket zugeordnet.
+- **Überschneidungen mit DEVFLOW** (Nutzerentscheidung 24.09.: die DF-ID
+  gewinnt): W5-08a/08b sind Aliase von DF-18, W5-14 ist Alias von DF-30.
+  W5-06/06b, W5-12, W5-30b/33 und W5-02d bleiben eigene Pakete, weil ihr
+  Inhalt verschieden ist (Begründung: `docs/MASTERPLAN.md`, „Aliase").
 
 ---
 
@@ -291,15 +298,18 @@ danach wird der Continuous Mode abgenommen und freigeschaltet.
    Reviews; sonst ein Reviewer ≠ Autor. Nur Abos, kein API-Geld. Alltagspaar:
    Kimi K3 (`kimi-k3:cloud`) + GLM 5.2 (`glm-5.2:cloud`) über Ollama Cloud
    mit `.pa/review_transport.py`, ersatzweise `deepseek-v4-flash:cloud`; nie
-   die Modellfamilie des Autors.
+   die Modellfamilie des Autors. Harte Entscheidungen und Abschlussreviews:
+   Advisor-Paar Fable 5.1 + GPT-6 Astra (Regeln in `AGENTS.md`).
 5. **Größen:** S = eine Sitzung, ≤ 150 Diff-Zeilen. M = ≤ 300 Diff-Zeilen.
    Kein L; was größer wird, wird geteilt (Teilungsvorschlag steht am Paket).
 6. **Mechanik eines Pakets:**
    - Start: `.pa/task_<id>.md` anlegen (`Status: aktiv` in den ersten acht
      Zeilen; Ziel, Dateien, Abnahme aus diesem Plan übernehmen) **und** in
      STAND.md unter „Aktive Specs" eintragen. `npm run specs` erzwingt beides.
+     **Folgepakete aus Reports** (die „neu"-Pakete im MASTERPLAN) brauchen
+     keine eigene Spec; ihr Report ist die Quelle (Nutzerentscheidung 24.09.).
    - Abschluss: `.pa/report_<id>.md` mit Belegen und Review-Disposition,
-     Spec auf `Status: historisch` und aus STAND.md austragen, Paket hier
+     Spec (falls vorhanden) auf `Status: historisch` und aus STAND.md austragen, Paket hier
      und in `docs/MASTERPLAN.md` streichen, Zeile in `docs/ERLEDIGT.md`,
      `scripts/sync.sh note`.
    - Paket-IDs sind stabil. Neue Pakete nur hier oder im W5-Plan, nie in
@@ -344,7 +354,8 @@ Vollständig erledigt (W0-01 bis W0-07, → `docs/ERLEDIGT.md`).
 Erledigt (→ `docs/ERLEDIGT.md`): W1-01, W1-01a, W1-02, W1-03 (C-3), W1-03c/d,
 W1-04, W1-05 (Doku-Teil), W1-06, W1-07, W1-08, W1-09, W1-09b, W1-11, W1-13,
 W1-14, W1-15, W1-15b, W1-16, W1-18, W1-19 (Kern, PR #39), W1-21, W1-21b,
-W1-23, W1-23b, W1-24, W1-24b, W1-25, W1-25b, W1-26, W1-26b, W1-26c.
+W1-22, W1-23, W1-23b, W1-24, W1-24b, W1-25, W1-25b, W1-26, W1-26b, W1-26c.
+W1-19b ist in CI-02 aufgegangen (Nutzerentscheidung 24.09., `docs/MASTERPLAN.md`).
 
 **Zustellung (NT-17)**
 
@@ -363,24 +374,20 @@ W1-23, W1-23b, W1-24, W1-24b, W1-25, W1-25b, W1-26, W1-26b, W1-26c.
 
 **Nahtstellen und Übernahme**
 
-- [ ] **W1-19b Rest aus W1-19** · S · Dependabot-Commits im `red-first`-Gate behandeln (#42/#34 rot wegen fehlendem Trailer) und den `ci.yml:36`-Kommentar nach W0-06 anpassen · Spec `.pa/task_w1-19.md` · mit CI-01 abstimmen.
-- [ ] **W1-22 tauri-plugin-log statt handgerolltem File-Logging** · S · Lane **main.rs**, `logging.rs`, `docs/plugin-matrix.md` · Abnahme: Redaction-Canaries bleiben leer, Diagnostics zeigt weiter den Logpfad · in Arbeit.
 - [ ] **W1-20 Zweites Setup reproduzieren** · S · Nutzer + Agent · Node 24, `npm ci`, `npm run dev:setup`, `npm run dev:doctor` grün auf einer zweiten Maschine oder WSL; Report · schließt Matrix-Zeile 1.
 
 ### W2 — Continuous Phase 3/4 (Runtime)
 
-Erledigt (→ `docs/ERLEDIGT.md`): W2-01, W2-02, W2-04 (erster Schnitt), W2-07,
-W2-09. Die Folgepakete aus den Reports (W2-01b/c, W2-02b, W2-04b bis W2-04f,
-W2-07b) stehen in `docs/MASTERPLAN.md`.
+Erledigt (→ `docs/ERLEDIGT.md`): W2-01, W2-02, W2-04 (erster Schnitt), W2-04b,
+W2-05, W2-07, W2-09. Die Folgepakete aus den Reports (W2-01b bis W2-01d,
+W2-02b, W2-04c bis W2-04g, W2-07b) stehen in `docs/MASTERPLAN.md`.
 
-Store-Lane seriell: W2-04b → W2-03 und W2-05 (eigene Datei
-`store/discovery.rs`, also ebenfalls st-Lane). W2-06 teilt sich die
-main.rs-Lane; W2-08, W2-09b und W2-10 laufen parallel.
+Store-Lane seriell: W2-03 zuerst. W2-06 teilt sich die main.rs-Lane; W2-08a/b,
+W2-09b und W2-10 laufen parallel.
 
-- [ ] **W2-03 Usage-/Billing-Collectors je Adapter** · M · Lane store.rs · `store/development_codex_usage.rs`, `budget.rs`; Codex-JSON, Kimi/OpenCode-Statuszeilen; Live-Quota-Provenienz · Abnahme: kein „unavailable" mehr im Kostenbeleg · nach W2-04b.
-- [ ] **W2-05 Discovery: echter Scan und Dispatch** · M · `store/discovery.rs` (st-Lane) · innerhalb der reservierten Admission (Migration 15) · in Arbeit (PR #107).
-- [ ] **W2-06 Supervisor: Producer-Audit und Runtime-Notifications** · M · `supervisor.rs`, Lane **main.rs** · `startsWorkers` bleibt hinter dem Gate · nach W1-22.
-- [ ] **W2-08 Ressourcendruck- und Streaming-Enforcement** · M · `pressure`, `process_capture` · CPU/Container-Limits, Streaming-Abbruch.
+- [ ] **W2-03 Usage-/Billing-Collectors je Adapter** · M · Lane store.rs · `store/development_codex_usage.rs`, `budget.rs`; Codex-JSON, Kimi/OpenCode-Statuszeilen; Live-Quota-Provenienz · Abnahme: kein „unavailable" mehr im Kostenbeleg · in Arbeit.
+- [ ] **W2-06 Supervisor: Producer-Audit und Runtime-Notifications** · M · `supervisor.rs`, Lane **main.rs** · `startsWorkers` bleibt hinter dem Gate · in Arbeit.
+- [ ] **W2-08 Ressourcendruck- und Streaming-Enforcement** · M, geteilt (Koordinator 24.09.) · `pressure`, `process_capture` · **W2-08a** Ressourcendruck- und Streaming-Enforcement, in Arbeit · **W2-08b** Speicher-/CPU-Grenzen je Job und Druck bei der Admission, wartet auf die Nutzerentscheidung zu den Grenzwerten.
 - [ ] **W2-09b DeepSeek-V4-Flash-Worker über OpenCode** · M · hooks/capabilities/profile; main.rs nur seriell für die fallible Spawn-Integration · CLI-Probe belegt, PTY-Zustellung und Per-Worker-Config offen · Spec `.pa/task_ollama_worker_adapter.md`.
 - [ ] **W2-10 Live-HQ-Views** · M, teilbar in 10a Goals/Teams/Ownership, 10b Routing/Budget, 10c Review/Delivery · `docs/dev-hq/hq.js`, `scripts/hq-live.mjs` · Abnahme: Keyboard- und Screenshot-Belege je Flow · Weg: Kimi/OpenCode.
 
@@ -432,8 +439,10 @@ Wieder aufnehmen nur mit belegtem Bedarf und neuem Eintrag hier.
   seriellen Lanes; beides steht in `docs/MASTERPLAN.md` („Worker-Struktur").
   Die frühere Angabe „W1 bis zu 22 gleichzeitige Agenten" ist überholt.
 - Nahtstellen-Lanes st, api, mn, pa: je ein aktives Paket.
-- W2: Store-Lane seriell (W2-04b → W2-03; W2-05 in `store/discovery.rs` ist
-  ebenfalls st); W2-06 in der main.rs-Lane; W2-08, W2-09b, W2-10 parallel.
+- W2: Store-Lane seriell (W2-03 zuerst); W2-06 in der main.rs-Lane; W2-08a/b,
+  W2-09b, W2-10 parallel.
+- Die Zahl der Implementer ist nicht begrenzt (Nutzerentscheidung 24.09.);
+  begrenzt sind Cargo-Builds (höchstens drei, RAM) und die seriellen Lanes.
 - Ein Paket pro Agent. M-Pakete tragen einen Teilungsvorschlag; teilen ist
   erlaubt, zusammenlegen nicht.
 - Review-Pool nach §0.4.
@@ -447,7 +456,15 @@ Helper, W3-05 Capture-Host Windows-only; Einzelheiten in `docs/ERLEDIGT.md`
 und `docs/decisions.md`) und Nr. 13 (F-SEC-4: Opt-in, W1-24/W1-24b, PR #62
 und #98; Restrisiko KNOWN_ISSUES KI-29). Branch-Protection auf `main` ist
 seit 22.09. gesetzt; `strict` ist seit 24.09. zugunsten der Mergify-Queue aus
-(CI-01).
+(CI-01, PR #108).
+
+Entschieden am 24.09. (umgesetzt in `AGENTS.md` und `docs/MASTERPLAN.md`):
+`main` wird über die Mergify-Queue gemergt, Hand-Merge nur durch den
+Koordinator als Notfall-Ausnahme, gebunden an den Head-SHA; keine Obergrenze
+für die Zahl der Implementer; bei Überschneidung DF/HQ2/W5 gewinnt die DF-ID
+(Aliase); DF-07 bleibt offen bis zum visuellen PASS von DF-07d; SETUP-A deckt
+SETUP-01/02/03/06/07; Folgepakete aus Reports ohne eigene Spec; W1-19b ist in
+CI-02 aufgegangen.
 
 | # | Entscheidung | Status |
 |---|---|---|
```
