# Review request PR #22 (SETUP-08a+b): Git/PR and plan/spec helpers under scripts/dev

You are an independent reviewer (not the author; the author is a Kimi model).
Review the COMPLETE candidate below for correctness bugs, gaps against the
requirements, and safety regressions. Be concrete: cite file and line, say
what breaks and when. Rate each finding high/medium/low. Do not restate the
diff. If something is fine, say nothing about it. Answer in English or
German. This is a READ-ONLY review: do not modify any files, run no commands
that write, and do not call any tools that touch the network.

## Context

Repo: ProjectA, a Tauri 2 "agentic terminal" (public GitHub repo, Node 24+
for scripts, Rust in src-tauri/). This PR ports two developer-tooling
packages into the public repo: nine Node ESM helpers under scripts/dev/
(report-commit, push-verified, prune-worktrees, build-slot, ci-watch,
pr-status, erledigt-row, spec-close, hygiene), the shared module
scripts/lib/dev-tools.mjs, node:test suites scripts/lib/dev-*.test.mjs,
npm scripts (dev:*), docs/MASTERPLAN.md, docs/ERLEDIGT.md and
scripts/dev/README.md. Rules that matter for the review:

- Many agents work in parallel git worktrees of one clone; the git stash
  stack and refs are SHARED. Helpers must never destroy another worktree's
  work (prune-worktrees is the destructive one: it must refuse anything
  dirty, locked, unmerged, recently active, or holding a cargo build).
- Nothing may be merged past the Mergify queue; nobody pushes without
  verification; git hooks are never bypassed (no --no-verify).
- Helpers call git and gh (GitHub CLI) as child processes; on Windows and
  Linux. They must not hang (no interactive prompts), must not mask exit
  codes, and must use documented exit codes (0 ok, 1 finding/refusal,
  2 usage, 3 environment/tool error as described in scripts/dev/README.md).
- Public repo: no personal data, no secrets, no absolute user paths.

## Review history (already addressed - verify the fixes, do not just re-report)

Two earlier reviewers (glm-5.2 and kimi-k3) reviewed 08a and 08b in a
private branch; 15 + 17 findings were dispositioned (see the two
.pa/review_setup-b-08*_disposition.md files in the diff), most accepted and
fixed test-first. G1 and M1 (08a) were refuted with real-repo tests;
K4/K8 (08b) were rejected with reasons. Check those fixes are actually
correct and hunt for NEW bugs, especially: destructive paths in
prune-worktrees, argument/shell injection in the child-process wrapper
(scripts/lib/dev-tools.mjs), Windows-vs-POSIX path handling, race
conditions between check and act, wrong exit codes, and tests that pass
without proving what they claim.

## Diff (git diff origin/main...HEAD at b9bc39e; the two raw review
## transcripts .pa/review_setup-b-08*_{glm-5.2,kimi-k3}.md are omitted,
## everything else is included)

```diff
diff --git a/.pa/review_setup-b-08a_disposition.md b/.pa/review_setup-b-08a_disposition.md
new file mode 100644
index 0000000..c98c7a8
--- /dev/null
+++ b/.pa/review_setup-b-08a_disposition.md
@@ -0,0 +1,39 @@
+# Disposition: Reviews SETUP-08a (Git-/PR-Helfer unter scripts/dev)
+
+- Artefakt: Commits 2489e1d, a82a029 (SETUP-08a), Draft-PR #126
+- Reviews: `.pa/review_setup-b-08a_glm-5.2.md` (G1–G4), `.pa/review_setup-b-08a_kimi-k3.md` (M1–M5, N1–N8)
+- Bearbeitet: 2026-09-25 auf Branch `claude/setup-b2-plan-helpers`
+- Vorgehen: jeder Befund gegen den Code bestätigt oder widerlegt; angenommene
+  Befunde test-first umgesetzt (Selbsttests zuerst rot, dann grün:
+  `npm run test:hq` 335/335, Exit 0; `node --check` für jede .mjs, Exit 0).
+- Ergebnis: **15 angenommen, 2 abgelehnt (widerlegt)**
+
+| Befund | Schwere | Inhalt | am Code geprüft | Disposition |
+|---|---|---|---|---|
+| G1 (glm #1) | hoch | `lastActivityMs` in prune-worktrees lese aus `%gd` immer `0` heraus; Idle-Schutz für reine Checkouts ausgehebelt | **Widerlegt**, empirisch (git 2.55.0.windows.3): `git reflog -1 --date=unix --format=%gd HEAD` gibt bei `--date=unix` den Unix-Zeitstempel im Selector aus (`HEAD@{1577836800}`), nicht den Index — die Regex `/@\{(\d+)\}/` extrahiert die Zeit korrekt. Zusätzlich Regressionstest: frisch ausgecheckter Worktree ohne neuen Commit bleibt unter `--min-idle` geschützt (grün). | Abgelehnt (widerlegt), kein Fix |
+| G2 (glm #2) | mittel | push-verified stürzt bei detached HEAD ohne `--branch` mit Exit 1 statt 2 ab | Bestätigt: `git.ok("symbolic-ref", …)` warf generischen Error → `withExitCodes` → Exit 1 | Angenommen: `UsageError` („Detached HEAD: --branch ist erforderlich"), Validierung synchron vor dem ersten await; Test |
+| G3 (glm #3) | mittel | Windows-Prozessfilter ohne `cargo-clippy.exe`/`build-script-build.exe` | Bestätigt: CIM-Filter listete beide nicht | Angenommen: Filter ergänzt; Test prüft den Filterstring |
+| G4 (glm #4) | niedrig | Linux `comm`-Schnitt bei 15 Zeichen: `build-script-build` nie erkannt | Bestätigt (Kernel-Limit, `TASK_COMM_LEN` 16) | Angenommen: `isCargoProcessName` akzeptiert 15-Zeichen-Präfixe bekannter Namen; überall statt der Regex verwendet; Test (= N3) |
+| M1 (kimi) | mittel | Worktree-Stash wird von keiner Schutzregel erfasst und beim Entfernen zerstört | **Widerlegt**, empirisch im Test mit echtem Repo: `refs/stash` liegt im gemeinsamen Ref-Store (common dir), nicht unter `.git/worktrees/<name>/`; `git worktree remove` lässt den Stash unangetastet — Test stasht im Worktree, entfernt es per `applyPrune` und findet den Stash-Eintrag danach im Hauptcheckout (grün). Prämisse des Befunds („per-worktree ref") ist falsch. | Abgelehnt (widerlegt); der Test bleibt als Beleg |
+| M2 (kimi) | mittel | Ignorierte Dateien (`.env`, lokale Notizen) werden wortlos mitgelöscht | Bestätigt: Schmutz-Check lief mit `--untracked-files=normal`, Ignoriertes unsichtbar | Angenommen: vor `remove` `status --porcelain -z --ignored=matching -uall`; „!!"-Einträge außerhalb der Allowlist `node_modules`/`target`/`dist` → keep mit Grund; 2 Tests (.env hält, reine Build-Artefakte nicht) |
+| M3 (kimi) | mittel | build-slot: Slot falsch „frei"; (a) env-Attribution auf Windows unlesbar, (b) Frische-Heuristik nur ohne Prozessliste, (c) `unattributed` nicht in `busy` | Bestätigt: (b) und (c) im Code nachgewiesen; (a) ist die dokumentierte Plattformgrenze | Angenommen: Lock/deps/.fingerprint-Frische gilt jetzt auch MIT Prozessliste („vermutlich belegt" in der Start-/Linkphase), unattributed Prozesse zählen konservativ in `busy`/`MAX_PARALLEL` ein; 2 Tests. (a) bleibt als dokumentierte Grenze, wird durch (b) abgefedert |
+| M4 (kimi) | mittel | `report-commit --merge`: untracked Dateien passieren die Sauberkeitsprüfung → Merge läuft, Refusal danach → HEAD bereits bewegt trotz Exit 3 | Bestätigt: Prüfung ließ `??`-Einträge durch | Angenommen: `--merge` verlangt komplett sauberen Baum (inkl. untracked) und lehnt VOR dem Merge ab; Test beweist unbewegten HEAD |
+| M5 (kimi) | mittel | Kein Zeitlimit pro Aufruf; hängender Credential-Helper blockiert unbegrenzt | Bestätigt: `makeRunner` Default `timeoutMs = 0`, `GIT_TERMINAL_PROMPT`/`GCM_INTERACTIVE` ungesetzt | Angenommen: `cleanEnv` setzt `GIT_TERMINAL_PROMPT=0` + `GCM_INTERACTIVE=never`; `makeRunner` bildet Timeout auf Exit 124 ab (per Default und per Aufruf); push-verified: Push 15 min (Hooks!), ls-remote 2 min; 3 Tests. Kein globales Default-Timeout: pre-push-Hooks laufen legitim minutenlang |
+| N1 (kimi) | niedrig | report-commit verwirft Hand-Edit an `data.*` direkt nach Merge stumm | Bestätigt: `git checkout --` ohne Sicherung | Angenommen: verworfene Fassungen werden vorher in ein Tmp-Verzeichnis kopiert, Pfad im Log und im Ergebnis (`backupDir`); Test |
+| N2 (kimi) | niedrig | build-slot-Heuristik prüft nur `debug/` | Bestätigt: Probes fest auf `debug/` | Angenommen: Probes für `debug` und `release`; Test |
+| N3 (kimi) | niedrig | = G4 (`comm` 15 Zeichen) | Bestätigt | Angenommen: mit G4 behoben (gleicher Fix, gleicher Test) |
+| N4 (kimi) | niedrig | ci-watch: `graceEmpty` zählt Polls, nicht Zeit (bei `--interval 5s` nur ~15 s Karenz) | Bestätigt: Zähler pro leerem Poll | Angenommen: `graceMs` zeitbasiert (Default 3 min), Summary nennt die Karenz; 2 Tests (37 Polls bei 5 s Intervall/180 s Karenz) |
+| N5 (kimi) | niedrig | report-commit: `git add -- .pa/report_<id>.md` relativ zu `cwd` statt Toplevel | Bestätigt: Add schlug aus Unterverzeichnis fehl | Angenommen: alle git-Operationen laufen über `gitIn(run, top)` am Toplevel; Test mit `cwd` = Unterverzeichnis |
+| N6 (kimi) | niedrig | prune-worktrees: `norm()` nutzt `process.platform`, Windows-Kleinschreibung unter Linux-CI untestbar; Symlink-Pfade unsichtbar konservativ | Bestätigt (Plattform-Teil) | Angenommen: `makeNorm(platform)` exportiert und injizierbar, win32-Pfadvergleich durchgetestet. Nebenbefund Symlink: bewusst offen — Fehlrichtung ist konservativ (nichts wird entfernt), kein Datenverlust möglich |
+| N7 (kimi) | niedrig | Testlücken: namesSlot-Negativtest, echter `worktree lock`, Stash, detached, aktuelles Verzeichnis, prunable, ignorierte Dateien, report-commit untracked/gestaged, ls-remote-Fehler, Branchname-Validierung, kaputtes gh-JSON | Bestätigt: Fälle fehlten | Angenommen: alle genannten Fälle als Tests ergänzt (u. a. `git check-ref-format --branch` vor dem ersten Push; ls-remote-Fehler wird als solcher gemeldet statt „belegt"); alle grün |
+| N8 (kimi) | niedrig | Doku/Scope: (a) Exit-Tabelle vs. prune-worktrees gh-Fehler, (b) `HQ_DATA` feste Liste statt `data.*`-Glob, (c) Beleg „42 neue Tests" vs. 48 gezählte Blöcke | (a) Bestätigt: prune-worktrees endet bei gh-Fehler mit 0 und Hinweis. (b) Bestätigt als bewusste Liste. (c) Bestätigt: der 08a-Diff enthält 48 Testblöcke | Angenommen: (a) README-Exit-Tabelle präzisiert. (b) Bewusst Liste statt Glob: der Hook regeneriert genau diese zwei Dateien; ein künftiges drittes `data.*` wäre ein bewusster Eingriff, kein stiller Glob — hier dokumentiert. (c) Zählung hier korrigiert vermerkt (48); der Bericht mit „42" liegt außerhalb der für diesen Auftrag änderbaren Pfade |
+
+## Hinweise
+
+- Zwei Befunde widerlegt (G1, M1) — beide Widerlegungen sind durch grüne
+  Tests mit echten Git-Repos belegt, nicht nur statisch argumentiert.
+- Der Teil von M3(a) (CARGO_TARGET_DIR-Attribution auf Windows unlesbar) und
+  der Symlink-Nebenbefund aus N6 bleiben als dokumentierte, konservative
+  Grenzen offen.
+- Selbsttests: `npm run test:hq` → 335/335 grün (Exit 0); `node --check`
+  auf allen `scripts/dev/*.mjs` und `scripts/lib/dev-*.mjs` → jeweils Exit 0.
diff --git a/.pa/review_setup-b-08b_disposition.md b/.pa/review_setup-b-08b_disposition.md
new file mode 100644
index 0000000..86824ca
--- /dev/null
+++ b/.pa/review_setup-b-08b_disposition.md
@@ -0,0 +1,45 @@
+# Disposition: Reviews SETUP-08b (Plan-/Spec-Helfer unter scripts/dev)
+
+- Artefakt: Commits e7b63e8, 273453f (SETUP-08b), PR #153 (Draft)
+- Reviews: `.pa/review_setup-b-08b_glm-5.2.md` (G1–G6), `.pa/review_setup-b-08b_kimi-k3.md` (K1–K11); beide unverändert aus `pa-orch/reviews/review_pr153_*.md`. Beide Urteile: keine Blocking-Befunde, mergebar: ja.
+- Bearbeitet: 2026-09-25 auf Branch `claude/setup-b2-plan-helpers`
+- Vorgehen: jeder Befund gegen den Code geprüft; Angenommenes test-first
+  (Commit aab4b33: 15 von 56 Tests in den vier Testdateien rot, Exit 1),
+  Fix in bab7e4c (56/56 grün). `npm run test:hq` 358/358, Exit 0.
+- Ergebnis: **17 Befunde, 14 angenommen (einer davon in anderer Form), 3 abgelehnt** (K7 ist dasselbe wie G3)
+
+| Befund | Schwere | Inhalt | am Code geprüft | Disposition |
+|---|---|---|---|---|
+| G1 | mittel | hygiene: Fehler bei `git fetch --prune` wird nur gewarnt, der Bericht läuft auf veralteten Remote-Refs weiter | Bestätigt: `io.err`-Hinweis, danach normaler Lauf | Angenommen: Exit 3 (`RefusedError`) mit Hinweis auf `--no-fetch`; Test prüft Exit 3, leere Ausgabe und dass `--no-fetch` weiter geht |
+| G2 | mittel | pr-status: Required-Check-Namen fest verdrahtet, Drift gegen `gates.sh` | Teilweise bestätigt: die Namen stehen nicht in `gates.sh`, sondern in `.mergify.yml` (`check-success`) und als Job-Namen in `ci.yml`; die Duplikation und das Driftrisiko sind real | Angenommen: Liste bleibt (Anzeige), aber ein Test vergleicht sie mit `.mergify.yml` und `ci.yml`. Der Test war sofort grün (Drift-Wächter, kein Fehler); Wirksamkeit belegt: Namen im Quelltext testweise geändert → Test rot, zurückgesetzt |
+| G3 / K7 | niedrig | hygiene: Oktal-Escapes bei Nicht-ASCII-Namen ungetrackter Dateien | Bestätigt (`core.quotePath` Standard) | Angenommen: `git -c core.quotePath=false status …`; Test mit `Möbel.md` |
+| G4 | niedrig | erledigt-row/spec-close normalisieren gemischte Zeilenenden auf das vorherrschende | Bestätigt als Verhalten; im Repo praktisch nicht erreichbar: `STAND.md`, `ERLEDIGT.md`, `MASTERPLAN.md` sind einheitlich (0 gemischte Zeilen, per Zählung geprüft) | Abgelehnt: die Normalisierung geht in die sichere Richtung und ist im `git diff` sichtbar, nicht still; Zeilen-für-Zeilen-Patching würde alle drei Funktionen umbauen für einen Fall, der nicht vorkommt |
+| G5 | niedrig | erledigt-row: `--title ""` fällt still auf den PR-Titel zurück | Bestätigt (`title \|\| …`) | Angenommen in anderer Form: leerer Titel würde eine leere Titelzelle erzeugen, also ist er ein Aufruffehler (Exit 2, Meldung nennt den Ausweg); Test |
+| G6 / K11 | niedrig | fehlende Fehlerfall-Tests (Tabelle nicht gefunden, Datei fehlt, gh-Fehler, „nichts zu tun“, STAND fehlt, Multi-ID, Escaping) | Bestätigt | Angenommen: Tests für Tabelle fehlt/Datei fehlt (Exit 3, Datei unverändert), gh-Fehler in erledigt-row und hygiene (Exit 3), spec-close „nichts zu tun“ und STAND fehlt, Multi-ID/Altformat. Windows-Pfade laufen weiter über die Windows-Gate-CI |
+| K1 | mittel | erledigt-row: Idempotenz bricht bei Mehrfach-ID-Zeile und anderem Linkformat, Doppelzeile | Bestätigt: exakte URL plus exakte ID-Zelle | Angenommen: PR über `#<nr>`/`pull/<nr>` erkannt (`#15` ≠ `#150`), ID-Zelle an Komma gesplittet, Groß-/Kleinschreibung und `-`/`—` normalisiert; 3 Tests |
+| K2 | mittel | hygiene: fehlende oder umformatierte Eingaben werden still „leer“, `--strict` kann leer bestehen | Bestätigt: `readOr` → `""`, Header-Erkennung starr | Angenommen: fehlende Datei = `null`, fehlender Abschnitt/Tabellenkopf wird erkannt; Abschnitt „Nicht geprüft“ im Bericht, zählt für `--strict` als Befund. Bewusst kein Exit 3, damit die übrigen Prüfungen weiter Auskunft geben. Test gegen die echten Dateien (leer) und gegen fehlende/umgebaute (gefüllt) |
+| K3 | niedrig | stille cwd-Fallbacks bei `git rev-parse`-Fehler (erledigt-row, spec-close, hygiene) | Bestätigt | Angenommen: alle drei brechen mit Exit 3 und der git-Meldung ab. erledigt-row löst den Pfad dafür erst mit `--apply` auf; der Probelauf zeigt ohne `--file` nur `docs/ERLEDIGT.md`. Tests für spec-close und hygiene |
+| K4 | niedrig | Schreibzugriffe nicht atomar, parallele Läufe verlieren Updates | Bestätigt als Eigenschaft | Abgelehnt (Doku statt Code): beide Dateien sind versioniert, jede Änderung steht im `git diff` und ist mit `git checkout` rücknehmbar; ein Absturz zwischen den zwei `spec-close`-Schreibvorgängen ist per Wiederholung heilbar (idempotent). Ein Lock würde das Lost-Update-Rennen nicht vollständig schließen, und der Koordinator führt die Helfer nacheinander aus. README nennt die Grenze jetzt |
+| K5 | niedrig | `MACHINE_BRANCH` prefix-matcht zu breit (`maintenance/…`) | Bestätigt | Angenommen: `/^(?:main\|HEAD\|origin)$\|^(?:mergify\|gh-readonly-queue)\//`; Test (Branch und PR) |
+| K6 | niedrig | `gh pr list`-Limits schneiden still ab | Bestätigt | Angenommen: hygiene meldet Listen am Limit (200/1000) unter „Nicht geprüft“, pr-status warnt auf stderr; Tests |
+| K8 | niedrig | Markdown-Escaping unvollständig (Newlines, Backticks) | Bestätigt, aber nicht erreichbar: GitHub-PR-Titel und Label-Namen sind einzeilig, git-Refs enthalten keine Steuerzeichen, `\|` in Tabellenzellen wird schon maskiert, hygiene rendert Aufzählungen statt Tabellen | Abgelehnt: kein erreichbarer Fehlerfall, rein kosmetisch |
+| K9 | niedrig | `gh pr view --json files` liefert höchstens 100 Dateien, Report-Spalte kann fehlen | Bestätigt | Angenommen: Warnung auf stderr bei 100 Dateien ohne `--report`; Test |
+| K10 | niedrig | spec-close verwirft den Rest der Status-Zeile | Bestätigt; die 135 echten Specs haben durchweg `Status: aktiv\|historisch\|entwurf` | Angenommen: nur `Status: <ein Wort>` wird akzeptiert, Zusätze führen zu Exit 3 statt zu stillem Verlust; Test |
+
+## Hinweise
+
+- Kein Befund war blocking; die Reviewer empfahlen G1/G2 und K1/K2 als
+  zeitnahe Nachzügler — alle vier sind umgesetzt.
+- Bewusst nicht geändert: Zeilenende-Normalisierung (G4), Locking der
+  Schreiber (K4), Markdown-Escaping (K8). Begründungen in der Tabelle.
+- Der Probelauf von erledigt-row zeigt ohne `--file` nicht mehr den
+  aufgelösten absoluten Pfad, sondern `docs/ERLEDIGT.md` (Folge von K3).
+
+## Nachweis
+
+- Rot (aab4b33, Stand 273453f): `node --test` über die vier Testdateien:
+  56 Tests, 41 grün, **15 rot**, Exit 1.
+- Grün (bab7e4c): dieselben vier Dateien 56/56, Exit 0.
+- `node --check` auf allen `scripts/dev/*.mjs`: Exit 0.
+- Echtlauf `node scripts/dev/hygiene.mjs --no-fetch` gegen dieses Repo: Exit 0,
+  „Nicht geprüft (0)“.
diff --git a/docs/ERLEDIGT.md b/docs/ERLEDIGT.md
new file mode 100644
index 0000000..0fe3de5
--- /dev/null
+++ b/docs/ERLEDIGT.md
@@ -0,0 +1,9 @@
+# ERLEDIGT — abgeschlossene Pakete
+
+Neueste zuerst. Ein gemergtes Paket wird aus `docs/PLAN.md` gestrichen und
+hier eingetragen; `npm run dev:erledigt-row` baut die Zeile aus den PR-Daten
+(Datum = `mergedAt` UTC, 7-stelliger Merge-SHA, vom PR berührte
+`.pa/report_*.md`).
+
+| Datum | ID | Titel | PR | Merge-SHA | Report |
+|---|---|---|---|---|---|
diff --git a/docs/MASTERPLAN.md b/docs/MASTERPLAN.md
new file mode 100644
index 0000000..f431178
--- /dev/null
+++ b/docs/MASTERPLAN.md
@@ -0,0 +1,27 @@
+# MASTERPLAN — geordnete Übersicht der offenen Pakete
+
+Die Paketdefinitionen stehen in `docs/PLAN.md`; dieses Dokument ist die
+geordnete Übersicht mit Status, Lane, Modell und Fortschritt. Erledigtes
+wandert nach `docs/ERLEDIGT.md`. Geschrieben wird nur vom Koordinator;
+`npm run dev:hygiene` prüft u. a., ob Pakete „in Arbeit" einen offenen PR
+haben.
+
+## Worker-Struktur
+
+Build-Slots für Cargo: `~/cargo-targets/projecta-{a,b,c}` plus das
+`target/` des Hauptcheckouts; Belegung und freier RAM per
+`npm run dev:build-slot`. Ein Paket, ein Implementer, ein Worktree.
+
+## S0 — in Arbeit
+
+| ID | Titel | Gr. | Status | Abhängig von | Lane / Dateien | Parallel-Gruppe | Modell | Quelle |
+|---|---|---|---|---|---|---|---|---|
+| W1-05b | api: cancel route über die dispatched rule | M | in Arbeit PR #19 | W1-05a ✓ | api | api/S0 | K | P |
+| W5-02b5 | extraHeader-Reset-Test mit lokalem HTTP-Server | S | in Arbeit PR #17 | W5-02b ✓ | fe | fe/S0 | C | P |
+| DF-15b | Release-Reservierung und Zustellung nach belegtem undelivered (KI-27) | M | in Arbeit PR #16 | DF-15a ✓ | rs | rs/S0 | C | P |
+| W2-04d | dispatch-Rollen auf Budget-Zwecke im Token-Ledger | M | in Arbeit PR #15 | W2-04c ✓ | rs | rs/S0 | C | P |
+| W2-10b | Live-HQ-View Routing/Budget | M | in Arbeit PR #14 | W2-10a | hq | hq/S0 | C | P |
+| W2-10a | goals/teams live view im Dev-HQ | M | in Arbeit PR #13 | HQ2 | hq | hq/S0 | C | P |
+| W2-07b | Windows-ACL für projecta-api.json und agent-access/ | S | in Arbeit PR #12 | W2-07a ✓ | rs | rs/S0 | C | P |
+| LIC-01 | Lizenz-Audit, Allowlist-Gate, Third-Party-Notices | M | in Arbeit PR #10 | — | ci | doc/S0 | C | P |
+| README-01 | README ehrlich neu schreiben | S | in Arbeit PR #6 | — | docs | doc/S0 | C | P |
diff --git a/package.json b/package.json
index effa387..ea93db1 100644
--- a/package.json
+++ b/package.json
@@ -31,7 +31,16 @@
     "tauri": "tauri",
     "hq:lesson": "node scripts/hq-lesson.mjs",
     "hq:queue-open-points": "node scripts/hq-queue-open-points.mjs",
-    "proof:runtime": "node scripts/runtime-proof.mjs"
+    "proof:runtime": "node scripts/runtime-proof.mjs",
+    "dev:report-commit": "node scripts/dev/report-commit.mjs",
+    "dev:push-verified": "node scripts/dev/push-verified.mjs",
+    "dev:prune-worktrees": "node scripts/dev/prune-worktrees.mjs",
+    "dev:build-slot": "node scripts/dev/build-slot.mjs",
+    "dev:ci-watch": "node scripts/dev/ci-watch.mjs",
+    "dev:pr-status": "node scripts/dev/pr-status.mjs",
+    "dev:erledigt-row": "node scripts/dev/erledigt-row.mjs",
+    "dev:spec-close": "node scripts/dev/spec-close.mjs",
+    "dev:hygiene": "node scripts/dev/hygiene.mjs"
   },
   "dependencies": {
     "@tauri-apps/api": "^2.1.1",
diff --git a/scripts/dev/README.md b/scripts/dev/README.md
index 714ea12..625a05c 100644
--- a/scripts/dev/README.md
+++ b/scripts/dev/README.md
@@ -1,16 +1,26 @@
-# scripts/dev
+# scripts/dev — Werkzeuge für Agenten und Koordinator
 
-Read-only helpers for the people and agents working on ProjectA. None of them
-changes repository or GitHub state. Each one keeps machine access in a single
-`collect()` function with injected probes, so its test (in `scripts/lib/`) runs
-without the real tools and without a network.
+Kleine Node-Helfer für wiederkehrende Git-, PR- und Plan-Handgriffe. Sie gelten
+für jeden Anbieter (Claude, Codex, Kimi, OpenCode) gleich: Node 24, kein Shell-
+String, externe Programme (`git`, `gh`, `powershell`) nur als Argumentliste.
+Jedes Werkzeug hat `--help` und ist als `npm run dev:<name>` erreichbar;
+Argumente nach `--` weitergeben, z. B. `npm run dev:ci-watch -- 123`.
+
+Die Logik steht in `scripts/dev/<name>.mjs`, gemeinsame Bausteine in
+`scripts/lib/dev-tools.mjs`. Die Selbsttests (`scripts/lib/dev-*.test.mjs`)
+laufen in `npm run test:hq` ohne Netz und ohne echtes `gh`: Wegwerf-Repos in
+tmp und injizierte Runner. `agent-setup-check` und `status-report` ändern
+nichts am Repo oder auf GitHub; bei den SETUP-08-Werkzeugen steht in der
+Tabelle, welche etwas ändern.
+
+## Maschinencheck und Tagesbericht
 
 | Script | Command | What it answers |
 |---|---|---|
 | `agent-setup-check.mjs` | `npm run dev:agent-check [-- --json]` | Is this machine ready for an agent to work on ProjectA? (`docs/setup/README.md`) |
 | `status-report.mjs` | `npm run dev:status [-- --out <file>]` | What is done today, what is running, what does the user decide? |
 
-## status-report.mjs
+### status-report.mjs
 
 Reads GitHub through `gh` (open PRs with checks, PRs merged today, the latest
 CI runs on `main`) and prints a short German markdown overview with three
@@ -38,3 +48,110 @@ written (a clean error on stderr, no crash), `2` bad arguments.
 It needs `gh` on `PATH` and logged in (`gh auth status`); it makes three read
 calls (`gh pr list` twice, `gh run list` once) and spends no money. The test is
 `scripts/lib/dev-status-report.test.mjs`, part of `npm run test:hq`.
+
+## Exit-Codes der SETUP-08-Werkzeuge
+
+| Code | Bedeutung |
+|---|---|
+| 0 | erledigt bzw. alles grün |
+| 1 | Ergebnis negativ (Push nicht belegt, CI rot, Entfernen gescheitert) oder unerwarteter Fehler |
+| 2 | Aufruffehler (fehlende/unzulässige Argumente) |
+| 3 | Vorbedingung nicht erfüllt, nichts geändert (schmutziger Baum, kein Slot frei, gh-Fehler bei ci-watch — Ausnahme: `prune-worktrees` fährt bei gh-Fehler nur eingeschränkt fort und endet mit 0) |
+| 4 | Zeitlimit erreicht |
+
+## Git- und PR-Helfer (SETUP-08a)
+
+| npm-Skript | Zweck | ändert etwas? |
+|---|---|---|
+| `dev:report-commit` | `.pa/report_<id>.md` aus einer Datei übernehmen und allein committen (`No-Test:` + `Co-Authored-By:`); setzt vorher `docs/dev-hq/data.*` zurück, wenn nur ein Merge sie verändert hat (die verworfene Fassung wird vorher in ein Tmp-Verzeichnis gesichert und der Pfad ausgegeben); optional `--merge <ref>` davor und `--push` danach | ja (Commit); `--dry-run` nicht |
+| `dev:push-verified` | `HEAD` pushen und per `git ls-remote` gegen den lokalen `HEAD` belegen, begrenzter Retry, kein Retry nach `[rejected]`; einzelne Aufrufe haben ein Zeitlimit (Push 15 min wegen der Hooks, ls-remote 2 min), ein abgelaufenes Zeitlimit zählt als gescheiterter Versuch (Exit 124 des Aufrufs) | ja (Push) |
+| `dev:prune-worktrees` | fertige Worktrees unter `.claude/worktrees/` und Codex-Worktrees finden (in `origin/main` enthalten oder PR MERGED/CLOSED); entfernt nur mit `--apply` | nur mit `--apply` |
+| `dev:build-slot` | freie Cargo-Slots (`~/cargo-targets/projecta-{a,b,c}`, Haupt-`target/`), freier RAM, Empfehlung für `CARGO_TARGET_DIR` | nein |
+| `dev:ci-watch` | Required Checks eines PRs bis zum Abschluss verfolgen; ein PR ohne Checks gilt erst nach einer zeitbasierten Karenz (3 min) als „bekommt keine CI", weil GitHub Required Checks bei Rulesets verzögert registriert | nein |
+
+### Sicherheitsregeln, die die Werkzeuge selbst einhalten
+
+- **Kein `--no-verify`, kein `--force`.** Commits und Pushes laufen durch die
+  normalen Hooks (pre-commit, pre-push). Ein Bericht-Commit dauert deshalb so
+  lange wie die precommit-Bahn.
+- **Push-Beleg ist `ls-remote`, nicht der Exit-Code von `git push`.** Alle
+  Helfer laufen mit `GIT_TERMINAL_PROMPT=0` und `GCM_INTERACTIVE=never` — kein
+  Credential-Helper und kein Terminal-Prompt kann einen Lauf blockieren.
+- **`report-commit --merge` verlangt einen komplett sauberen Baum** (auch
+  keine ungetrackten Dateien) und lehnt VOR dem Merge ab — „abgelehnt =
+  nichts geändert" gilt ausnahmslos.
+- **`report-commit` setzt HQ-Daten nur zurück, wenn der Merge die einzige
+  Ursache sein kann:** `data.*` geändert, aber nicht gestaged, keine andere
+  Datei geändert, und die letzte HEAD-Bewegung war ein Merge (oder
+  `--merge` lief eben auf einem sauberen Baum). Sonst: Abbruch mit Exit 3.
+- **`prune-worktrees` fasst nie an:** Worktrees mit uncommitteten Änderungen,
+  mit Commits auf keinem Remote-Branch, mit ignorierten Dateien außerhalb der
+  Build-Artefakt-Allowlist (`node_modules`, `target`, `dist` — eine `.env`
+  oder lokale Notiz hält den Worktree am Leben), gesperrte
+  (`git worktree lock`, so markiert Claude Code laufende Agenten), das
+  aktuelle Verzeichnis und alles, was jünger als `--min-idle` (Standard 12 h)
+  aktiv war. Entfernt wird mit `git worktree remove` ohne `--force`; Branches
+  löscht es nicht.
+- **`build-slot` setzt nie `CARGO_PROFILE_*`.** „Belegt" heißt: ein
+  cargo/rustc-Prozess (auch `cargo-clippy`, `build-script-build`; unter Linux
+  auch der auf 15 Zeichen gekürzte `comm`-Name) nennt den Slot in seiner
+  Kommandozeile. Zusätzlich gilt die Frische von `.cargo-lock`/`deps`/
+  `.fingerprint` (jünger als 2 min, Profile `debug` und `release`) immer als
+  zweites Signal — auch wenn eine Prozessliste vorliegt, denn zwischen zwei
+  rustc-Aufrufen (Dep-Auflösung, Linken) nennt kein Prozess den Slot.
+  cargo-Prozesse ohne Slot in der Kommandozeile zählen konservativ in die
+  Höchstzahl paralleler Builds ein. Der RAM kommt aus `os.freemem()`, es wird
+  also keine lokalisierte Zahl („3,25") geparst. `PA_BUILD_SLOTS="pfad;pfad"`
+  ersetzt die Slotliste.
+
+## Plan- und Spec-Helfer (SETUP-08b)
+
+| npm-Skript | Zweck | ändert etwas? |
+|---|---|---|
+| `dev:pr-status` | offene PRs als Kompakttabelle: Draft, Queue-Zustand (in Queue / bereit / wartet auf CI / rot / Konflikt / gesperrt / Draft), Labels, die drei Required Checks | nein |
+| `dev:erledigt-row` | aus PR-Nummer und Paket-ID die `docs/ERLEDIGT.md`-Zeile bauen (Datum = `mergedAt` UTC, 7-stelliger Merge-SHA, vom PR berührte `.pa/report_*.md`) und oben einfügen; idempotent, nur für gemergte PRs | nur mit `--apply` |
+| `dev:spec-close` | `.pa/task_<id>.md` auf `Status: historisch` setzen und die Zeile unter „Aktive Specs“ in `STAND.md` entfernen; danach `npm run hq` (oder `--hq`) | nur mit `--apply` |
+| `dev:hygiene` | read-only Bericht als Markdown: offene PRs > 24 h ohne Aktivität, Remote-Branches ohne PR, aktive Specs zu gemergten PRs, MASTERPLAN-Pakete „in Arbeit“ ohne offenen PR, ungetrackte Dateien im Hauptcheckout; `--strict` → Exit 1 bei Befunden | nein (nur `git fetch --prune`, abschaltbar mit `--no-fetch`) |
+
+`docs/PLAN.md`, `STAND.md`, `MASTERPLAN.md` und `ERLEDIGT.md` schreibt nur der
+Koordinator; `erledigt-row` und `spec-close` sind seine Werkzeuge dafür.
+Die Paket-Zuordnung in `hygiene` vergleicht IDs mit Branch-Namen
+(`…/w1-22-…`) und PR-Titeln als ganzes Wort (W1-22 trifft nie W1-22b) —
+Befunde sind Hinweise zum Prüfen, keine Urteile.
+
+Verhalten an den Rändern (Review SETUP-08b):
+
+- `erledigt-row` erkennt „schon vorhanden“ an der PR-Nummer in jeder Linkform
+  und an der ID auch in Mehrfach-Zellen (`W1-05, W1-06`); `--title ""` ist ein
+  Aufruffehler; liefert `gh` genau 100 Dateien, warnt der Helfer, dass die
+  Report-Spalte unvollständig sein kann (`--report` setzen). Den Pfad der
+  Zieldatei löst er erst mit `--apply` auf; ein scheiterndes
+  `git rev-parse --show-toplevel` ist Exit 3, kein stiller Fallback aufs cwd.
+- `spec-close` akzeptiert nur `Status: <ein Wort>` und verweigert eine Zeile
+  mit Zusatz, statt ihn zu verwerfen. Beide Schreiber lesen, ändern und
+  schreiben ohne Sperre: parallele Läufe gegen dieselbe Datei sind nicht
+  vorgesehen (der Koordinator führt sie nacheinander aus; jede Änderung
+  steht im `git diff`).
+- `hygiene` bricht mit Exit 3 ab, wenn `git fetch --prune origin` scheitert
+  (`--no-fetch` wertet dann bewusst nur den lokalen Stand aus). Fehlende oder
+  nicht mehr lesbare Eingaben (`STAND.md`, `docs/MASTERPLAN.md`,
+  `docs/ERLEDIGT.md`) und `gh`-Listen am Limit stehen unter „Nicht geprüft“
+  und zählen für `--strict` als Befund — ein leerer Bericht heißt „geprüft und
+  sauber“, nie „nicht geprüft“.
+- `pr-status.mjs` führt die drei Required Checks als Liste; ein Test vergleicht
+  sie mit `.mergify.yml` (`check-success`) und den Job-Namen in `ci.yml`.
+
+### Beispiele
+
+```sh
+npm run dev:pr-status
+npm run dev:erledigt-row -- 106 W2-07          # Probelauf, zeigt die Zeile
+npm run dev:spec-close -- w1-22 --apply --hq
+npm run dev:hygiene -- --strict
+npm run dev:build-slot
+npm run dev:report-commit -- --id w2-07 --from /tmp/report.md --co-author "Claude Opus 5.5 <noreply@anthropic.com>" --dry-run
+npm run dev:push-verified -- --branch claude/w2-07-credential-acl
+npm run dev:ci-watch -- 123 --timeout 45m
+npm run dev:prune-worktrees            # Probelauf
+npm run dev:prune-worktrees -- --apply
+```
diff --git a/scripts/dev/build-slot.mjs b/scripts/dev/build-slot.mjs
new file mode 100644
index 0000000..a5827c4
--- /dev/null
+++ b/scripts/dev/build-slot.mjs
@@ -0,0 +1,236 @@
+#!/usr/bin/env node
+// SETUP-08a — build-slot: which Cargo target directory is free right now?
+//
+// Slots (MASTERPLAN "Worker-Struktur"): ~/cargo-targets/projecta-{a,b,c} and
+// the main checkout's src-tauri/target; PA_BUILD_SLOTS ("pfad;pfad") replaces
+// the list. A slot is busy when a cargo/rustc process names it on its command
+// line (rustc always gets --out-dir/-L dependency=<target>/...); cargo's own
+// environment (CARGO_TARGET_DIR) is not readable for other processes on
+// Windows. Without a process list the fallback is a heuristic: the slot's
+// debug/.cargo-lock or deps directory changed within the last two minutes.
+//
+// Free RAM comes from os.freemem() (available physical memory on Windows and
+// Linux), so there is no localized "3,25" text to parse. At most three builds
+// at once, never below 2.5 GB free. This tool never sets CARGO_PROFILE_*.
+import { statSync } from "node:fs";
+import { homedir, freemem, platform as osPlatform } from "node:os";
+import { join, resolve, dirname } from "node:path";
+import { readdirSync, readFileSync } from "node:fs";
+import { parseArgs } from "node:util";
+import { EXIT, makeRunner, gitIn, isMain, runCli, withExitCodes } from "../lib/dev-tools.mjs";
+
+export const MIN_FREE_GB = 2.5;
+export const MAX_PARALLEL = 3;
+const RECENT_MS = 120_000;
+const CARGO_BASE_NAMES = ["cargo", "rustc", "clippy-driver", "cargo-nextest", "cargo-clippy", "rustdoc", "build-script-build"];
+
+// The kernel truncates /proc/<pid>/comm to 15 characters, so a 15-character
+// name that prefixes a known cargo tool counts as that tool (G4/N3):
+// "build-script-build" (18) shows up as "build-script-bu".
+export function isCargoProcessName(name) {
+  const n = String(name || "").trim().replace(/\.exe$/i, "").toLowerCase();
+  if (CARGO_BASE_NAMES.includes(n)) return true;
+  return n.length === 15 && CARGO_BASE_NAMES.some((base) => base.startsWith(n));
+}
+
+const HELP = `build-slot — freien Cargo-Build-Slot finden
+
+Aufruf:
+  npm run dev:build-slot -- [--json]
+
+Slots: ~/cargo-targets/projecta-{a,b,c} und <Hauptcheckout>/src-tauri/target
+       (PA_BUILD_SLOTS="pfad;pfad" ersetzt die Liste).
+Belegt: ein cargo/rustc-Prozess nennt den Slot in seiner Kommandozeile;
+        ohne Prozessliste: .cargo-lock/deps juenger als 2 min (Heuristik).
+Regeln: hoechstens ${MAX_PARALLEL} Builds gleichzeitig, mindestens ${MIN_FREE_GB} GB freier RAM.
+
+Exit-Codes: 0 Empfehlung vorhanden, 3 jetzt kein Slot (warten), 2 Aufruffehler.
+Setzt nie CARGO_PROFILE_* (das invalidiert den Cache).
+`;
+
+export function defaultSlots({ home = homedir(), mainCheckout, env = process.env }) {
+  if (env.PA_BUILD_SLOTS) {
+    return env.PA_BUILD_SLOTS.split(";")
+      .map((p) => p.trim())
+      .filter(Boolean)
+      .map((p) => ({ name: p.split(/[\\/]/).filter(Boolean).pop(), path: p }));
+  }
+  const slots = ["a", "b", "c"].map((x) => ({ name: `projecta-${x}`, path: join(home, "cargo-targets", `projecta-${x}`).replace(/\\/g, "/") }));
+  if (mainCheckout) slots.push({ name: "main", path: join(mainCheckout, "src-tauri", "target").replace(/\\/g, "/") });
+  return slots;
+}
+
+function normPath(p, platform) {
+  const n = String(p).replace(/\\/g, "/").replace(/\/+$/, "");
+  return platform === "win32" ? n.toLowerCase() : n;
+}
+
+// A command line names the slot when the slot path appears followed by a
+// path separator or the end of a token (so projecta-a never matches projecta-ab).
+export function namesSlot(cmd, slotPath, platform) {
+  const c = normPath(cmd, platform);
+  const s = normPath(slotPath, platform);
+  let i = c.indexOf(s);
+  while (i !== -1) {
+    const next = c[i + s.length];
+    if (next === undefined || next === "/" || next === " " || next === '"' || next === "'") return true;
+    i = c.indexOf(s, i + 1);
+  }
+  return false;
+}
+
+// Freshness of lock/deps/fingerprint, across the profiles cargo writes to
+// (debug AND release — N2). Used as the only signal without a process list,
+// and as a second signal with one (M3: between two rustc invocations no
+// process names the slot, e.g. during dependency resolution or linking).
+function freshestProbe(stat, slotPath) {
+  const probes = ["debug", "release"].flatMap((profile) => [
+    join(slotPath, profile, ".cargo-lock"),
+    join(slotPath, profile, "deps"),
+    join(slotPath, profile, ".fingerprint"),
+  ]);
+  return Math.max(0, ...probes.map((p) => stat(p)).filter((x) => x.exists).map((x) => x.mtimeMs));
+}
+
+export function slotStatus({ slots, processes, freeBytes, stat, now = Date.now(), platform = osPlatform() }) {
+  const cargo = processes ? processes.filter((p) => isCargoProcessName(p.name)) : null;
+  const attributed = new Set();
+  const out = slots.map((slot) => {
+    const s = stat(slot.path);
+    if (!s.exists) return { ...slot, state: "fehlt", reason: "Verzeichnis nicht vorhanden (kalter Slot)" };
+    const newest = freshestProbe(stat, slot.path);
+    const freshSecs = newest ? Math.round((now - newest) / 1000) : null;
+    if (cargo) {
+      const hits = cargo.filter((p) => namesSlot(p.cmd || "", slot.path, platform));
+      hits.forEach((p) => attributed.add(p.pid));
+      if (hits.length) return { ...slot, state: "belegt", reason: `${hits.length} Prozess(e): ${[...new Set(hits.map((p) => p.name))].join(", ")}` };
+      if (freshSecs !== null && freshSecs * 1000 < RECENT_MS) {
+        return { ...slot, state: "vermutlich belegt", reason: `kein Prozess nennt den Slot, aber vor ${freshSecs} s geaendert (Startphase/Linken?)` };
+      }
+      return { ...slot, state: "frei", reason: "kein cargo/rustc-Prozess nennt diesen Slot" };
+    }
+    if (freshSecs !== null && freshSecs * 1000 < RECENT_MS) {
+      return { ...slot, state: "vermutlich belegt", reason: `Heuristik: vor ${freshSecs} s geaendert` };
+    }
+    return { ...slot, state: "frei", reason: "Heuristik: seit > 2 min unveraendert (Prozessliste nicht verfuegbar)" };
+  });
+  const freeGb = freeBytes / 1024 ** 3;
+  const unattributed = cargo ? cargo.filter((p) => !attributed.has(p.pid)).length : null;
+  // Unattributed cargo processes count conservatively toward the parallel
+  // limit (M3): a build whose processes do not name a slot still builds.
+  const busy = out.filter((s) => s.state === "belegt" || s.state === "vermutlich belegt").length + (unattributed || 0);
+  const free = out.filter((s) => s.state === "frei");
+  let recommendation;
+  if (freeGb < MIN_FREE_GB) {
+    recommendation = { slot: null, text: `warten: nur ${freeGb.toFixed(1)} GB freier RAM (< ${MIN_FREE_GB} GB)`, env: "" };
+  } else if (busy >= MAX_PARALLEL) {
+    recommendation = { slot: null, text: `warten: schon ${busy} Builds aktiv (hoechstens drei gleichzeitig)`, env: "" };
+  } else if (!free.length) {
+    recommendation = { slot: null, text: "warten: kein freier Slot", env: "" };
+  } else {
+    const slot = free[0];
+    recommendation = {
+      slot,
+      text: `${slot.name} verwenden`,
+      env: `CARGO_TARGET_DIR=${slot.path} CARGO_BUILD_JOBS=${busy >= 1 || freeGb < 6 ? 1 : 2}`,
+    };
+  }
+  return { slots: out, freeGb: Math.round(freeGb * 10) / 10, busy, unattributed, source: cargo ? "prozesse" : "heuristik", recommendation };
+}
+
+// `Get-CimInstance ... | ConvertTo-Json` prints one object for one match.
+export function parseWindowsProcesses(text) {
+  const t = String(text || "").trim();
+  if (!t) return [];
+  const data = JSON.parse(t);
+  return (Array.isArray(data) ? data : [data]).map((p) => ({ pid: p.ProcessId, name: p.Name || "", cmd: p.CommandLine || "" }));
+}
+
+function listLinuxProcesses() {
+  const out = [];
+  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
+    try {
+      const name = readFileSync(`/proc/${pid}/comm`, "utf8").trim();
+      if (!isCargoProcessName(name)) continue;
+      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ");
+      let envDir = "";
+      try {
+        const env = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
+        envDir = (env.find((e) => e.startsWith("CARGO_TARGET_DIR=")) || "").slice(17);
+      } catch {
+        /* other user's process */
+      }
+      out.push({ pid: Number(pid), name, cmd: envDir ? `${cmd} ${envDir}/` : cmd });
+    } catch {
+      /* process ended */
+    }
+  }
+  return out;
+}
+
+// null = could not determine (then the heuristic is used)
+export function listCargoProcesses({ run, platform = osPlatform() }) {
+  try {
+    if (platform === "win32") {
+      const filter = "Name='cargo.exe' OR Name='rustc.exe' OR Name='clippy-driver.exe' OR Name='cargo-nextest.exe' OR Name='cargo-clippy.exe' OR Name='rustdoc.exe' OR Name='build-script-build.exe'";
+      const r = run("powershell", [
+        "-NoProfile",
+        "-NonInteractive",
+        "-Command",
+        `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`,
+      ]);
+      if (r.code !== 0) return null;
+      return parseWindowsProcesses(r.stdout);
+    }
+    if (platform === "linux") return listLinuxProcesses();
+    return null;
+  } catch {
+    return null;
+  }
+}
+
+function realStat(p) {
+  try {
+    const s = statSync(p);
+    return { exists: true, mtimeMs: s.mtimeMs };
+  } catch {
+    return { exists: false };
+  }
+}
+
+function mainCheckoutOf(run, cwd) {
+  const git = gitIn(run, cwd);
+  const r = git("rev-parse", "--path-format=absolute", "--git-common-dir");
+  if (r.code !== 0) return null;
+  return dirname(r.stdout.trim());
+}
+
+function format(s) {
+  const lines = [`Freier RAM: ${s.freeGb} GB · aktive Builds: ${s.busy} · Quelle: ${s.source}`];
+  for (const x of s.slots) lines.push(`  ${x.state.padEnd(17)} ${x.name.padEnd(11)} ${x.path}  (${x.reason})`);
+  if (s.unattributed) lines.push(`  Hinweis: ${s.unattributed} cargo/rustc-Prozess(e) ohne Slot in der Kommandozeile (z. B. cargo selbst in der Startphase)`);
+  lines.push(`Empfehlung: ${s.recommendation.text}`);
+  if (s.recommendation.env) lines.push(`  ${s.recommendation.env}`);
+  return lines.join("\n") + "\n";
+}
+
+export const main = withExitCodes(async (argv, io, deps) => {
+  const { values } = parseArgs({ args: argv, options: { json: { type: "boolean" }, help: { type: "boolean" } }, strict: true });
+  if (values.help) {
+    io.out(HELP);
+    return EXIT.OK;
+  }
+  const run = deps.run || makeRunner();
+  const slots = deps.slots || defaultSlots({ mainCheckout: mainCheckoutOf(run, resolve(process.cwd())) });
+  const s = slotStatus({
+    slots,
+    processes: deps.processes ? deps.processes() : listCargoProcesses({ run }),
+    freeBytes: deps.freeBytes ? deps.freeBytes() : freemem(),
+    stat: deps.stat || realStat,
+    now: deps.now ? deps.now() : Date.now(),
+  });
+  io.out(values.json ? JSON.stringify(s, null, 2) + "\n" : format(s));
+  return s.recommendation.slot ? EXIT.OK : EXIT.REFUSED;
+});
+
+if (isMain(import.meta.url)) runCli(main);
diff --git a/scripts/dev/ci-watch.mjs b/scripts/dev/ci-watch.mjs
new file mode 100644
index 0000000..566ef89
--- /dev/null
+++ b/scripts/dev/ci-watch.mjs
@@ -0,0 +1,118 @@
+#!/usr/bin/env node
+// SETUP-08a — ci-watch: follow the REQUIRED checks of one PR until they are
+// done, with a bounded run time and an exit code that says how it ended.
+// Polls `gh pr checks <pr> --required --json name,state,bucket,link`; gh's
+// own exit code (8 = pending, 1 = failed) is not used, the JSON is.
+//
+//   npm run dev:ci-watch -- 123 [--timeout 60m] [--interval 30s] [--fail-fast]
+import { parseArgs } from "node:util";
+import { EXIT, UsageError, makeRunner, isMain, runCli, withExitCodes, parseDuration, SLEEP } from "../lib/dev-tools.mjs";
+
+const HELP = `ci-watch — Required Checks eines PRs bis zum Abschluss verfolgen
+
+Aufruf:
+  npm run dev:ci-watch -- <pr-nummer> [Optionen]
+
+Optionen:
+  --timeout <dauer>   hoechstens so lange warten (Standard: 60m)
+  --interval <dauer>  Abfrageabstand (Standard: 30s, mindestens 5s)
+  --fail-fast         beim ersten roten Check aufhoeren
+  --help              diese Hilfe
+
+Exit-Codes: 0 alle Required Checks gruen (skipping zaehlt als erledigt),
+            1 mindestens einer rot oder abgebrochen,
+            2 Aufruffehler,
+            3 gh-Fehler oder der PR bekommt keine Required Checks (z. B. Draft: keine CI),
+            4 Zeitlimit erreicht, Checks laufen noch.
+`;
+
+const DONE_OK = new Set(["pass", "skipping"]);
+const DONE_BAD = new Set(["fail", "cancel"]);
+
+function fetchChecks(run, pr) {
+  const r = run("gh", ["pr", "checks", pr, "--required", "--json", "name,state,bucket,link"]);
+  const text = r.stdout.trim();
+  if (!text.startsWith("[")) {
+    // gh prints "no required checks reported" on stderr and exits 1 for a PR without checks
+    if (/no (required )?checks reported/i.test(r.stderr)) return { checks: [] };
+    return { error: (r.stderr || r.stdout || `gh Exit ${r.code}`).trim() };
+  }
+  try {
+    return { checks: JSON.parse(text) };
+  } catch {
+    return { error: "gh lieferte keine gueltige JSON-Ausgabe" };
+  }
+}
+
+function summarize(checks) {
+  return checks.map((c) => `${c.name}: ${c.bucket}`).join(", ");
+}
+
+export async function watchChecks({ run, pr, timeoutMs = 3_600_000, intervalMs = 30_000, failFast = false, graceMs = 180_000, sleep = SLEEP, now = Date.now, log = () => {} }) {
+  const start = now();
+  let emptySince = null;
+  let last = [];
+  for (;;) {
+    const res = fetchChecks(run, pr);
+    if (res.error) return { code: EXIT.REFUSED, checks: last, summary: `gh: ${res.error}` };
+    const checks = res.checks;
+    last = checks;
+    if (checks.length === 0) {
+      // GitHub registers required checks (rulesets) only seconds to a minute
+      // after push — the grace is a TIME budget, not a poll count (N4).
+      if (emptySince === null) emptySince = now();
+      if (now() - emptySince >= graceMs) {
+        return { code: EXIT.REFUSED, checks, summary: `keine Required Checks nach ${Math.round(graceMs / 1000)} s Karenz (Draft-PR? Draft-PRs bekommen keine CI)` };
+      }
+    } else {
+      emptySince = null;
+      const bad = checks.filter((c) => DONE_BAD.has(c.bucket));
+      const pending = checks.filter((c) => !DONE_OK.has(c.bucket) && !DONE_BAD.has(c.bucket));
+      log(`[${Math.round((now() - start) / 1000)} s] ${summarize(checks)}\n`);
+      if (bad.length && (failFast || pending.length === 0)) {
+        return { code: EXIT.FAIL, checks, summary: `rot: ${bad.map((c) => `${c.name} (${c.link || c.state})`).join(", ")}` };
+      }
+      if (pending.length === 0) return { code: EXIT.OK, checks, summary: `gruen: ${summarize(checks)}` };
+    }
+    if (now() - start + intervalMs > timeoutMs) {
+      return { code: EXIT.TIMEOUT, checks, summary: `Zeitlimit erreicht, noch offen: ${summarize(checks.filter((c) => !DONE_OK.has(c.bucket) && !DONE_BAD.has(c.bucket))) || "-"}` };
+    }
+    await sleep(intervalMs);
+  }
+}
+
+export const main = withExitCodes(async (argv, io, deps) => {
+  const { values, positionals } = parseArgs({
+    args: argv,
+    options: {
+      timeout: { type: "string" },
+      interval: { type: "string" },
+      "fail-fast": { type: "boolean" },
+      help: { type: "boolean" },
+    },
+    allowPositionals: true,
+    strict: true,
+  });
+  if (values.help) {
+    io.out(HELP);
+    return EXIT.OK;
+  }
+  const pr = positionals[0];
+  if (!pr || !/^\d+$/.test(pr) || positionals.length > 1) throw new UsageError("genau eine PR-Nummer erwartet");
+  const intervalMs = values.interval ? parseDuration(values.interval) : 30_000;
+  if (intervalMs < 5000) throw new UsageError("--interval mindestens 5s");
+  const res = await watchChecks({
+    run: deps.run || makeRunner(),
+    pr,
+    timeoutMs: values.timeout ? parseDuration(values.timeout) : 3_600_000,
+    intervalMs,
+    failFast: Boolean(values["fail-fast"]),
+    sleep: deps.sleep,
+    now: deps.now,
+    log: io.out,
+  });
+  (res.code === EXIT.OK ? io.out : io.err)(`PR #${pr}: ${res.summary}\n`);
+  return res.code;
+});
+
+if (isMain(import.meta.url)) runCli(main);
diff --git a/scripts/dev/erledigt-row.mjs b/scripts/dev/erledigt-row.mjs
new file mode 100644
index 0000000..03b4497
--- /dev/null
+++ b/scripts/dev/erledigt-row.mjs
@@ -0,0 +1,144 @@
+#!/usr/bin/env node
+// SETUP-08b — erledigt-row: build the docs/ERLEDIGT.md line for a merged PR
+// and insert it at the top of the table (newest first). Dry run by default.
+//
+//   npm run dev:erledigt-row -- 106 W2-07            # zeigt die Zeile
+//   npm run dev:erledigt-row -- 106 W2-07 --apply    # fuegt sie oben ein
+//
+// Format (docs/ERLEDIGT.md): | Datum | ID | Titel | PR | Merge-SHA | Report |
+// Datum = GitHub mergedAt in UTC as "DD.MM.", Merge-SHA = 7 characters,
+// Report = the .pa/report_*.md files the PR touched (or "—").
+import { readFileSync, writeFileSync, existsSync } from "node:fs";
+import { resolve, join } from "node:path";
+import { parseArgs } from "node:util";
+import { EXIT, UsageError, RefusedError, makeRunner, gitIn, ghJson, isMain, runCli, withExitCodes } from "../lib/dev-tools.mjs";
+
+const REPO_URL = "https://github.com/Cuarroc/ProjectA/pull/";
+const ID = /^[A-Za-z0-9][A-Za-z0-9 .,/()–-]*$/;
+const GH_FILES_LIMIT = 100; // `gh pr view --json files` returns at most 100 files
+
+const HELP = `erledigt-row — ERLEDIGT-Zeile fuer einen gemergten PR erzeugen und oben einfuegen
+
+Aufruf:
+  npm run dev:erledigt-row -- <pr-nummer> <paket-id> [Optionen]
+
+  <paket-id>  z. B. W2-07; "-" fuer Arbeit ohne Paket (wird "—")
+
+Optionen:
+  --title <text>   Titel statt des PR-Titels (ohne "feat(x):"-Praefix)
+  --report <pfad>  Report-Spalte statt der vom PR beruehrten .pa/report_*.md
+  --file <pfad>    Zieldatei (Standard: docs/ERLEDIGT.md im aktuellen Checkout)
+  --apply          wirklich einfuegen (Standard: Probelauf, zeigt nur die Zeile)
+  --help           diese Hilfe
+
+Exit-Codes: 0 ok (auch: Zeile schon vorhanden), 2 Aufruffehler,
+            3 PR nicht gemergt, gh-Fehler oder Tabelle nicht gefunden.
+Daten kommen aus: gh pr view <nr> --json number,title,state,mergedAt,mergeCommit,files
+`;
+
+const esc = (s) => String(s).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
+
+// "feat(api): W2-07: Text (W2-07)" -> "Text": the ID has its own column.
+export function cleanTitle(title, id = "") {
+  let t = String(title || "").replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "").trim();
+  if (id && id !== "—") {
+    const i = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
+    t = t.replace(new RegExp(`^${i}:\\s*`, "i"), "").replace(new RegExp(`\\s*\\(${i}\\)$`, "i"), "").trim();
+  }
+  return t;
+}
+
+export function makeRow({ pr, id, title, report }) {
+  const d = new Date(pr.mergedAt);
+  const date = `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.`;
+  const reports = report ? [report] : (pr.files || []).map((f) => f.path).filter((p) => /^\.pa\/report_[^/]+\.md$/.test(p));
+  const sha = String(pr.mergeCommit?.oid || "").slice(0, 7);
+  return `| ${date} | ${esc(id)} | ${esc(title || cleanTitle(pr.title, id))} | [#${pr.number}](${REPO_URL}${pr.number}) | ${sha} | ${reports.length ? esc(reports.join(", ")) : "—"} |`;
+}
+
+const PR_REF = /(?:pull\/|#)(\d+)(?!\d)/; // "[#150](…/pull/150)", "#150", older link forms
+const normId = (s) => (String(s).trim() === "-" ? "—" : String(s).trim().toLowerCase());
+
+// Inserts `row` directly below the separator of the first table whose header
+// starts with "| Datum | ID |". Idempotent for the same PR number + ID: the
+// PR is recognised by its number in any link form, the ID cell may list
+// several IDs ("W1-05, W1-06").
+export function insertRow(text, row, { prNumber, id }) {
+  const eol = text.includes("\r\n") ? "\r\n" : "\n";
+  const lines = text.split(/\r?\n/);
+  const header = lines.findIndex((l) => /^\|\s*Datum\s*\|\s*ID\s*\|/.test(l));
+  if (header === -1 || !/^\|[-|: ]+\|\s*$/.test(lines[header + 1] || "")) {
+    throw new RefusedError("Tabelle mit Kopf \"| Datum | ID | ...\" nicht gefunden.");
+  }
+  let end = header + 2;
+  while (end < lines.length && lines[end].startsWith("|")) end++;
+  const already = lines.slice(header + 2, end).some((l) => {
+    const c = l.replace(/^\|/, "").split(/(?<!\\)\|/).map((x) => x.trim());
+    const ref = PR_REF.exec(c[3] || "");
+    if (!ref || Number(ref[1]) !== Number(prNumber)) return false;
+    return (c[1] || "").split(/\s*,\s*/).some((x) => normId(x) === normId(id));
+  });
+  if (already) return { text, already: true };
+  lines.splice(header + 2, 0, row);
+  return { text: lines.join(eol), already: false };
+}
+
+export const main = withExitCodes(async (argv, io, deps) => {
+  const { values, positionals } = parseArgs({
+    args: argv,
+    options: {
+      title: { type: "string" },
+      report: { type: "string" },
+      file: { type: "string" },
+      apply: { type: "boolean" },
+      help: { type: "boolean" },
+    },
+    allowPositionals: true,
+    strict: true,
+  });
+  if (values.help) {
+    io.out(HELP);
+    return EXIT.OK;
+  }
+  const [prArg, idArg] = positionals;
+  if (positionals.length !== 2 || !/^\d+$/.test(prArg || "")) throw new UsageError("erwartet: <pr-nummer> <paket-id>");
+  const id = idArg === "-" ? "—" : idArg;
+  if (id !== "—" && !ID.test(id)) throw new UsageError(`Paket-ID unzulaessig: ${idArg}`);
+  if (values.title !== undefined && !values.title.trim()) throw new UsageError("--title darf nicht leer sein (ohne --title wird der PR-Titel genommen)");
+  const run = deps.run || makeRunner();
+  let pr;
+  try {
+    pr = ghJson(run, ["pr", "view", prArg, "--json", "number,title,state,mergedAt,mergeCommit,files"]);
+  } catch (e) {
+    throw new RefusedError(e.message);
+  }
+  if (pr.state !== "MERGED" || !pr.mergedAt || !pr.mergeCommit?.oid) {
+    throw new RefusedError(`PR #${prArg} ist nicht gemergt (state ${pr.state}); ERLEDIGT fuehrt nur gemergte PRs.`);
+  }
+  if (!values.report && (pr.files || []).length >= GH_FILES_LIMIT) {
+    io.err(`Hinweis: gh liefert hoechstens ${GH_FILES_LIMIT} Dateien; die Report-Spalte kann unvollstaendig sein (${GH_FILES_LIMIT} Dateien im PR). Mit --report angeben.\n`);
+  }
+  const row = makeRow({ pr, id, title: values.title, report: values.report });
+  if (!values.apply) {
+    io.out(`Probelauf — ${values.file ? resolve(values.file) : "docs/ERLEDIGT.md"} bleibt unveraendert. Mit --apply oben eingefuegt:\n${row}\n`);
+    return EXIT.OK;
+  }
+  let file = values.file;
+  if (!file) {
+    const top = gitIn(run, process.cwd())("rev-parse", "--show-toplevel");
+    if (top.code !== 0) throw new RefusedError(`git rev-parse --show-toplevel scheiterte (${top.stderr.trim()}); --file angeben.`);
+    file = join(top.stdout.trim(), "docs", "ERLEDIGT.md");
+  }
+  file = resolve(file);
+  if (!existsSync(file)) throw new RefusedError(`${file} fehlt`);
+  const res = insertRow(readFileSync(file, "utf8"), row, { prNumber: pr.number, id });
+  if (res.already) {
+    io.out(`schon vorhanden (PR #${pr.number}, ${id}); nichts geaendert.\n`);
+    return EXIT.OK;
+  }
+  writeFileSync(file, res.text);
+  io.out(`eingefuegt in ${file}:\n${row}\n`);
+  return EXIT.OK;
+});
+
+if (isMain(import.meta.url)) runCli(main);
diff --git a/scripts/dev/hygiene.mjs b/scripts/dev/hygiene.mjs
new file mode 100644
index 0000000..0d03416
--- /dev/null
+++ b/scripts/dev/hygiene.mjs
@@ -0,0 +1,270 @@
+#!/usr/bin/env node
+// SETUP-08b — hygiene: read-only check of the repo's bookkeeping, as Markdown.
+//
+//   1. open PRs without activity for more than 24 h
+//   2. remote branches without any PR (merged ones are deletable)
+//   3. specs under STAND.md "Aktive Specs" whose package already has a merged PR
+//   4. MASTERPLAN rows "in Arbeit" without an open PR
+//   5. untracked files in the main checkout
+//
+// Nothing is changed. The only write is `git fetch --prune origin`, which
+// updates remote-tracking refs; --no-fetch skips it. Findings are hints for a
+// human ("pruefen"), not verdicts: package IDs are matched against branch
+// names and PR titles.
+import { readFileSync, existsSync } from "node:fs";
+import { join, resolve } from "node:path";
+import { parseArgs } from "node:util";
+import { EXIT, RefusedError, makeRunner, gitIn, ghJson, isMain, runCli, withExitCodes } from "../lib/dev-tools.mjs";
+import { listedInStand } from "../lib/active-specs.mjs";
+
+const STALE_MS = 24 * 3_600_000;
+const SECTION = /^#{2,4}\s*Aktive Specs\s*$/;
+const MACHINE_BRANCH = /^(?:main|HEAD|origin)$|^(?:mergify|gh-readonly-queue)\//;
+const OPEN_LIMIT = 200;
+const ALL_LIMIT = 1000;
+
+const HELP = `hygiene — Buchfuehrung des Repos pruefen (read-only), Ausgabe als Markdown
+
+Aufruf:
+  npm run dev:hygiene -- [--strict] [--json] [--no-fetch] [--root <pfad>]
+
+Prueft:
+  1. offene PRs aelter als 24 h ohne Aktivitaet
+  2. Remote-Branches ohne PR (gemergt = loeschbar, sonst pruefen)
+  3. aktive Specs (STAND.md) zu Paketen mit gemergtem PR
+  4. MASTERPLAN-Pakete "in Arbeit" ohne offenen PR
+  5. ungetrackte Dateien im Hauptcheckout
+  + "Nicht geprueft": fehlende/unlesbare Eingaben (STAND.md, MASTERPLAN.md,
+    ERLEDIGT.md) und gh-Listen am Limit; zaehlt als Befund fuer --strict
+
+Optionen:
+  --strict       Exit 1, sobald es einen Befund gibt
+  --json         Befunde als JSON
+  --no-fetch     vorher kein git fetch --prune origin
+  --root <pfad>  Checkout, aus dem STAND.md/docs gelesen werden (Standard: aktueller)
+  --help         diese Hilfe
+
+Exit-Codes: 0 Bericht erstellt, 1 Befunde mit --strict, 2 Aufruffehler,
+            3 gh/git-Fehler (auch: git fetch scheitert — dann --no-fetch).
+`;
+
+const lower = (s) => String(s).toLowerCase();
+const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
+const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
+
+// true when `id` names this PR: branch segment "<id>" or "<id>-..." after a
+// slash, or the ID as a whole word in the title (W1-22 never matches W1-22b).
+export function prMatchesId(pr, id) {
+  const i = escRe(lower(id));
+  if (new RegExp(`(^|/)${i}(-|$)`).test(lower(pr.headRefName))) return true;
+  return new RegExp(`(^|[^a-z0-9-])${i}([^a-z0-9]|$)`).test(lower(pr.title));
+}
+
+// Column index of "Status" when lines[i] is the header of a MASTERPLAN status
+// table (first column "ID", separator row below), else -1.
+function statusColumn(lines, i) {
+  if (!lines[i].startsWith("|") || !/^\|[-|: ]+\|\s*$/.test(lines[i + 1] || "")) return -1;
+  const head = cells(lines[i]);
+  return head[0] === "ID" ? head.indexOf("Status") : -1;
+}
+
+export function hasStatusTable(md) {
+  const lines = String(md).split(/\r?\n/);
+  return lines.some((_, i) => statusColumn(lines, i) !== -1);
+}
+
+export function inProgressPackages(md) {
+  const lines = String(md).split(/\r?\n/);
+  const out = [];
+  for (let i = 0; i < lines.length - 1; i++) {
+    const statusIdx = statusColumn(lines, i);
+    if (statusIdx === -1) continue;
+    for (let j = i + 2; j < lines.length && lines[j].startsWith("|"); j++) {
+      const c = cells(lines[j]);
+      const status = c[statusIdx] || "";
+      if (!/^in Arbeit/.test(status)) continue;
+      out.push({ id: c[0], title: c[1] || "", status, prNumbers: [...status.matchAll(/PR #(\d+)/g)].map((m) => Number(m[1])) });
+    }
+  }
+  return out;
+}
+
+export function activeSpecIds(stand) {
+  const lines = String(stand).split(/\r?\n/);
+  const start = lines.findIndex((l) => SECTION.test(l));
+  const listed = listedInStand(stand).names;
+  const byName = new Map();
+  if (start !== -1) {
+    for (const line of lines.slice(start + 1)) {
+      if (/^#{1,4}\s/.test(line)) break;
+      const m = /\.pa\/(task_[A-Za-z0-9_.-]+\.md)/.exec(line);
+      if (!m || byName.has(m[1])) continue;
+      let ids = [];
+      if (line.startsWith("|")) {
+        const pkg = /^([A-Z][A-Z0-9]*(?:-[A-Za-z0-9.]+)+)/.exec(cells(line)[1] || "");
+        if (pkg) ids = [pkg[1]];
+      }
+      byName.set(m[1], ids);
+    }
+  }
+  return listed.map((spec) => ({ spec, ids: byName.get(spec)?.length ? byName.get(spec) : [spec.replace(/^task_/, "").replace(/\.md$/, "")] }));
+}
+
+function erledigtRows(md) {
+  return String(md)
+    .split(/\r?\n/)
+    .filter((l) => /^\|\s*\d\d\.\d\d\.\s*\|/.test(l))
+    .map((l) => {
+      const c = cells(l);
+      return { ids: c[1].split(/\s*,\s*/), pr: Number((/\/pull\/(\d+)/.exec(c[3]) || [])[1]) || null };
+    });
+}
+
+export function collectHygiene({ now, prsOpen, prsAll, remoteBranches, standText: standIn, masterplanText: masterplanIn, erledigtText: erledigtIn, untracked, limits = [] }) {
+  const [standText, masterplanText, erledigtText] = [standIn ?? "", masterplanIn ?? "", erledigtIn ?? ""];
+  const humanOpen = prsOpen.filter((p) => !MACHINE_BRANCH.test(p.headRefName));
+  const stalePrs = humanOpen
+    .filter((p) => now - Date.parse(p.updatedAt) > STALE_MS)
+    .map((p) => ({ number: p.number, branch: p.headRefName, title: p.title, updatedAt: p.updatedAt, hours: Math.round((now - Date.parse(p.updatedAt)) / 3_600_000) }))
+    .sort((a, b) => a.number - b.number);
+
+  const heads = new Set(prsAll.map((p) => p.headRefName));
+  const branchesWithoutPr = remoteBranches.filter((b) => !MACHINE_BRANCH.test(b.name) && !heads.has(b.name));
+
+  const merged = prsAll.filter((p) => p.state === "MERGED");
+  const done = erledigtRows(erledigtText);
+  const specsOfMergedPrs = [];
+  for (const { spec, ids } of activeSpecIds(standText)) {
+    for (const id of ids) {
+      const pr = merged.find((p) => prMatchesId(p, id));
+      const row = done.find((r) => r.ids.some((x) => lower(x) === lower(id)));
+      if (pr) specsOfMergedPrs.push({ spec, id, pr: pr.number, via: `PR #${pr.number} ${pr.headRefName}` });
+      else if (row) specsOfMergedPrs.push({ spec, id, pr: row.pr, via: "docs/ERLEDIGT.md" });
+    }
+  }
+
+  const openNumbers = new Set(humanOpen.map((p) => p.number));
+  const inProgressWithoutPr = inProgressPackages(masterplanText).filter(
+    (r) => !humanOpen.some((p) => prMatchesId(p, r.id)) && !r.prNumbers.some((n) => openNumbers.has(n)),
+  );
+  // A missing input or one that no longer parses makes checks 3/4 silently
+  // empty; say so instead of reporting "clean" (counts as a finding for --strict).
+  const notChecked = [...limits];
+  if (standIn == null) notChecked.push("STAND.md fehlt — aktive Specs nicht geprüft");
+  else if (!standText.split(/\r?\n/).some((l) => SECTION.test(l))) notChecked.push('STAND.md: Abschnitt "Aktive Specs" nicht gefunden — aktive Specs nicht geprüft');
+  if (masterplanIn == null) notChecked.push('docs/MASTERPLAN.md fehlt — Pakete „in Arbeit“ nicht geprüft');
+  else if (!hasStatusTable(masterplanText)) notChecked.push('docs/MASTERPLAN.md: keine Tabelle mit den Spalten ID und Status — Pakete „in Arbeit“ nicht geprüft');
+  if (erledigtIn == null) notChecked.push("docs/ERLEDIGT.md fehlt — Specs zu erledigten Paketen nur über PRs geprüft");
+  else if (!/^\|\s*Datum\s*\|\s*ID\s*\|/m.test(erledigtText)) notChecked.push('docs/ERLEDIGT.md: keine Tabelle „| Datum | ID |“ — Specs zu erledigten Paketen nur über PRs geprüft');
+  return { stalePrs, branchesWithoutPr, specsOfMergedPrs, inProgressWithoutPr, untracked, notChecked };
+}
+
+export function countFindings(f) {
+  return f.stalePrs.length + f.branchesWithoutPr.length + f.specsOfMergedPrs.length + f.inProgressWithoutPr.length + f.untracked.length + (f.notChecked?.length || 0);
+}
+
+export function formatHygiene(f, { now = Date.now() } = {}) {
+  const out = [`# Hygiene — ${new Date(now).toISOString().slice(0, 16).replace("T", " ")} UTC`, "", `Befunde: ${countFindings(f)} (Hinweise zum Pruefen, keine Urteile)`, ""];
+  const section = (title, items, render) => {
+    out.push(`## ${title} (${items.length})`, "");
+    if (!items.length) out.push("- keine");
+    for (const x of items) out.push(`- ${render(x)}`);
+    out.push("");
+  };
+  section("Offene PRs ohne Aktivität seit über 24 h", f.stalePrs, (p) => `#${p.number} \`${p.branch}\` — zuletzt ${p.updatedAt} (${p.hours} h): ${p.title}`);
+  const mergedB = f.branchesWithoutPr.filter((b) => b.merged);
+  const openB = f.branchesWithoutPr.filter((b) => !b.merged);
+  section("Branches ohne PR", [...openB, ...mergedB], (b) => `\`${b.name}\` — ${b.merged ? "in main enthalten, löschbar" : "nicht in main, prüfen"}`);
+  section("Aktive Specs zu gemergten PRs", f.specsOfMergedPrs, (s) => `\`.pa/${s.spec}\` (${s.id}) — ${s.via}; ggf. \`npm run dev:spec-close -- ${s.spec.replace(/^task_|\.md$/g, "")}\``);
+  section("MASTERPLAN-Pakete „in Arbeit“ ohne offenen PR", f.inProgressWithoutPr, (r) => `${r.id} — ${r.status}`);
+  section("Ungetrackte Dateien im Hauptcheckout", f.untracked, (p) => `\`${p}\``);
+  section("Nicht geprüft", f.notChecked || [], (n) => n);
+  return out.join("\n");
+}
+
+// null = file missing; collectHygiene reports it under "Nicht geprüft".
+function readOrNull(path) {
+  return existsSync(path) ? readFileSync(path, "utf8") : null;
+}
+
+export function gather({ run, cwd, now = Date.now() }) {
+  const git = gitIn(run, cwd);
+  const top = git("rev-parse", "--show-toplevel");
+  if (top.code !== 0) throw new Error(`git rev-parse --show-toplevel (Exit ${top.code}): ${top.stderr.trim()} — --root prüfen`);
+  const root = top.stdout.trim() || cwd;
+  const wt = git.ok("worktree", "list", "--porcelain");
+  const mainPath = (/^worktree (.+)$/m.exec(wt.replace(/\r/g, "")) || [])[1] || root;
+
+  const refs = git.ok("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin");
+  const remoteBranches = refs
+    .split(/\r?\n/)
+    .map((l) => l.trim().replace(/^origin\//, ""))
+    .filter((n) => n && n !== "HEAD" && n !== "origin")
+    .map((name) => ({ name, merged: git("merge-base", "--is-ancestor", `origin/${name}`, "origin/main").code === 0 }));
+
+  const prsOpen = ghJson(run, ["pr", "list", "--state", "open", "--limit", String(OPEN_LIMIT), "--json", "number,title,headRefName,updatedAt,isDraft"], { cwd });
+  const prsAll = ghJson(run, ["pr", "list", "--state", "all", "--limit", String(ALL_LIMIT), "--json", "number,title,headRefName,state"], { cwd });
+  const limits = [];
+  if (prsOpen.length >= OPEN_LIMIT) limits.push(`gh pr list --state open: ${prsOpen.length} Einträge (Limit ${OPEN_LIMIT}) — Liste ggf. unvollständig`);
+  if (prsAll.length >= ALL_LIMIT) limits.push(`gh pr list --state all: ${prsAll.length} Einträge (Limit ${ALL_LIMIT}) — Liste ggf. unvollständig`);
+
+  // quotePath=false: non-ASCII names stay readable instead of "d\303\244t.txt".
+  const status = gitIn(run, mainPath).ok("-c", "core.quotePath=false", "status", "--porcelain", "--untracked-files=normal");
+  const untracked = status
+    .split(/\r?\n/)
+    .filter((l) => l.startsWith("?? "))
+    .map((l) => l.slice(3).replace(/^"(.*)"$/, "$1"));
+
+  return {
+    now,
+    root,
+    mainPath,
+    prsOpen,
+    prsAll,
+    remoteBranches,
+    untracked,
+    limits,
+    standText: readOrNull(join(root, "STAND.md")),
+    masterplanText: readOrNull(join(root, "docs", "MASTERPLAN.md")),
+    erledigtText: readOrNull(join(root, "docs", "ERLEDIGT.md")),
+  };
+}
+
+export const main = withExitCodes(async (argv, io, deps) => {
+  const { values } = parseArgs({
+    args: argv,
+    options: {
+      strict: { type: "boolean" },
+      json: { type: "boolean" },
+      "no-fetch": { type: "boolean" },
+      root: { type: "string" },
+      help: { type: "boolean" },
+    },
+    strict: true,
+  });
+  if (values.help) {
+    io.out(HELP);
+    return EXIT.OK;
+  }
+  const run = deps.run || makeRunner();
+  const cwd = resolve(values.root || process.cwd());
+  const now = deps.now ? deps.now() : Date.now();
+  if (!values["no-fetch"]) {
+    const f = gitIn(run, cwd)("fetch", "-q", "--prune", "origin");
+    if (f.code !== 0) {
+      throw new RefusedError(`git fetch --prune origin scheiterte (${f.stderr.trim()}); ein Bericht auf veralteten Remote-Refs wäre irreführend. Mit --no-fetch nur den lokalen Stand auswerten.`);
+    }
+  }
+  let data;
+  try {
+    data = gather({ run, cwd, now });
+  } catch (e) {
+    io.err(`Fehler beim Einsammeln: ${e.message}\n`);
+    return EXIT.REFUSED;
+  }
+  const findings = collectHygiene(data);
+  io.out(values.json ? JSON.stringify(findings, null, 2) + "\n" : formatHygiene(findings, { now }) + "\n");
+  return values.strict && countFindings(findings) > 0 ? EXIT.FAIL : EXIT.OK;
+});
+
+if (isMain(import.meta.url)) runCli(main);
diff --git a/scripts/dev/pr-status.mjs b/scripts/dev/pr-status.mjs
new file mode 100644
index 0000000..8dc1bb6
--- /dev/null
+++ b/scripts/dev/pr-status.mjs
@@ -0,0 +1,118 @@
+#!/usr/bin/env node
+// SETUP-08b — pr-status: compact table of the open PRs with draft, queue,
+// label and required-check state. One `gh pr list` call, read-only.
+//
+//   npm run dev:pr-status            # Markdown-Tabelle
+//   npm run dev:pr-status -- --json
+//
+// Queue column (AGENTS.md "Merging"): Mergify queues every non-draft PR whose
+// three required checks are green, without conflict and without the
+// do-not-merge label. The merge-queue PRs Mergify opens itself
+// (mergify/merge-queue/*) name the PRs they are checking in their title;
+// those PRs are "in Queue". Everything else is derived from the PR's own data.
+import { parseArgs } from "node:util";
+import { EXIT, RefusedError, makeRunner, ghJson, isMain, runCli, withExitCodes } from "../lib/dev-tools.mjs";
+
+// Must match the checks .mergify.yml requires and the job names in
+// .github/workflows/ci.yml; scripts/lib/dev-pr-status.test.mjs guards the drift.
+export const REQUIRED = [
+  ["linux", "gates (linux)"],
+  ["windows", "gates (windows)"],
+  ["redFirst", "red-first"],
+];
+const LIMIT = 200;
+const FIELDS = "number,title,headRefName,isDraft,labels,updatedAt,mergeStateStatus,statusCheckRollup";
+
+const HELP = `pr-status — offene PRs mit Draft-/Queue-/Label-Status und Required Checks
+
+Aufruf:
+  npm run dev:pr-status -- [--json]
+
+Spalten: Draft, Queue (in Queue / bereit / wartet auf CI / rot / Konflikt /
+gesperrt (do-not-merge) / Draft (keine CI)), Labels, gates (linux),
+gates (windows), red-first (ok / rot / laeuft / uebersprungen / —).
+Liest nur: gh pr list --state open --json ${FIELDS}
+
+Exit-Codes: 0 ok, 2 Aufruffehler, 3 gh-Fehler.
+`;
+
+const time = (c) => Date.parse(c.completedAt || c.startedAt || 0) || 0;
+
+export function checkState(rollup, name) {
+  const runs = (rollup || []).filter((c) => (c.name || c.context) === name);
+  if (!runs.length) return "—";
+  const c = runs.sort((a, b) => time(b) - time(a))[0];
+  if (c.__typename === "StatusContext" || (c.state && !c.status)) {
+    return { SUCCESS: "ok", PENDING: "läuft", EXPECTED: "läuft" }[c.state] || "rot";
+  }
+  if (c.status !== "COMPLETED") return "läuft";
+  if (c.conclusion === "SUCCESS") return "ok";
+  if (c.conclusion === "SKIPPED" || c.conclusion === "NEUTRAL") return "übersprungen";
+  return "rot";
+}
+
+function queuedNumbers(prs) {
+  const nums = new Set();
+  for (const p of prs) {
+    if (!String(p.headRefName).startsWith("mergify/merge-queue/")) continue;
+    for (const m of String(p.title).matchAll(/#(\d+)/g)) nums.add(Number(m[1]));
+  }
+  return nums;
+}
+
+export function buildRows(prs) {
+  const queued = queuedNumbers(prs);
+  return prs
+    .filter((p) => !String(p.headRefName).startsWith("mergify/merge-queue/"))
+    .map((p) => {
+      const labels = (p.labels || []).map((l) => l.name);
+      const checks = Object.fromEntries(REQUIRED.map(([key, name]) => [key, checkState(p.statusCheckRollup, name)]));
+      const states = Object.values(checks);
+      let queue;
+      if (queued.has(p.number)) queue = "in Queue";
+      else if (p.isDraft) queue = "Draft (keine CI)";
+      else if (labels.includes("do-not-merge")) queue = "gesperrt (do-not-merge)";
+      else if (labels.includes("conflict") || p.mergeStateStatus === "DIRTY") queue = "Konflikt";
+      else if (states.includes("rot")) queue = "rot";
+      else if (states.every((s) => s === "ok" || s === "übersprungen")) queue = "bereit";
+      else queue = "wartet auf CI";
+      return { number: p.number, branch: p.headRefName, title: p.title, draft: Boolean(p.isDraft), queue, labels, checks, updatedAt: p.updatedAt };
+    })
+    .sort((a, b) => a.number - b.number);
+}
+
+const cell = (s) => String(s).replace(/\|/g, "\\|");
+
+export function formatTable(rows) {
+  const out = [
+    "| # | Branch | Draft | Queue | Labels | linux | windows | red-first | aktualisiert (UTC) |",
+    "|---|---|---|---|---|---|---|---|---|",
+  ];
+  for (const r of rows) {
+    out.push(
+      `| #${r.number} | ${cell(r.branch)} | ${r.draft ? "ja" : "nein"} | ${r.queue} | ${cell(r.labels.join(", ") || "—")} | ${r.checks.linux} | ${r.checks.windows} | ${r.checks.redFirst} | ${String(r.updatedAt || "").slice(0, 16).replace("T", " ")} |`,
+    );
+  }
+  if (!rows.length) out.push("| — | keine offenen PRs | | | | | | | |");
+  return out.join("\n") + "\n";
+}
+
+export const main = withExitCodes(async (argv, io, deps) => {
+  const { values } = parseArgs({ args: argv, options: { json: { type: "boolean" }, help: { type: "boolean" } }, strict: true });
+  if (values.help) {
+    io.out(HELP);
+    return EXIT.OK;
+  }
+  let prs;
+  try {
+    prs = ghJson(deps.run || makeRunner(), ["pr", "list", "--state", "open", "--limit", String(LIMIT), "--json", FIELDS]);
+  } catch (e) {
+    throw new RefusedError(e.message);
+  }
+  if (prs.length >= LIMIT) io.err(`Hinweis: gh lieferte ${prs.length} PRs (Limit ${LIMIT}); die Liste kann unvollstaendig sein.\n`);
+  const rows = buildRows(prs);
+  io.out(values.json ? JSON.stringify(rows, null, 2) + "\n" : formatTable(rows));
+  return EXIT.OK;
+});
+
+if (isMain(import.meta.url)) runCli(main);
diff --git a/scripts/dev/prune-worktrees.mjs b/scripts/dev/prune-worktrees.mjs
new file mode 100644
index 0000000..0bc104f
--- /dev/null
+++ b/scripts/dev/prune-worktrees.mjs
@@ -0,0 +1,243 @@
+#!/usr/bin/env node
+// SETUP-08a — prune-worktrees: list agent worktrees that are finished, and
+// remove them only on --apply.
+//
+// In scope: worktrees under <main checkout>/.claude/worktrees/ (Claude Code)
+// and Codex worktrees (path contains /.codex/worktrees/ or branch codex/*),
+// both found through `git worktree list --porcelain`. Everything else (the
+// main checkout, app-worker worktrees, Copilot, ...) is never touched.
+//
+// Finished = the branch tip is contained in origin/main, or gh reports the
+// branch's PR as MERGED or CLOSED. A finished worktree is still KEPT when it
+// has uncommitted changes, commits that are on no remote branch, a lock, is
+// the current directory, or was active within --min-idle (default 12h; a
+// brand-new worktree is "contained in main" too).
+import { resolve, sep } from "node:path";
+import { parseArgs } from "node:util";
+import { EXIT, makeRunner, gitIn, ghJson, isMain, runCli, withExitCodes, parseDuration } from "../lib/dev-tools.mjs";
+
+const HELP = `prune-worktrees — fertige Agenten-Worktrees finden (Probelauf) und mit --apply entfernen
+
+Aufruf:
+  npm run dev:prune-worktrees -- [--apply] [Optionen]
+
+Betrachtet: <Hauptcheckout>/.claude/worktrees/* und Codex-Worktrees (/.codex/worktrees/ oder Branch codex/*).
+Fertig:     Branch-Spitze in origin/main enthalten, oder PR laut gh MERGED/CLOSED.
+Nie entfernt: uncommittete Aenderungen, ungepushte Commits, gesperrte Worktrees,
+            das aktuelle Verzeichnis, Aktivitaet juenger als --min-idle.
+
+Optionen:
+  --apply            wirklich entfernen (git worktree remove, ohne --force)
+  --repo <pfad>      irgendein Checkout des Repos (Standard: aktuelles Verzeichnis)
+  --base <ref>       Vergleichsbasis (Standard: origin/main)
+  --min-idle <dauer> Mindestruhezeit (Standard: 12h)
+  --no-gh            PR-Status nicht abfragen (nur "in main enthalten")
+  --no-fetch         vorher kein git fetch
+  --json             Plan als JSON
+  --help             diese Hilfe
+
+Exit-Codes: 0 ok, 1 mindestens ein Entfernen scheiterte, 2 Aufruffehler.
+Branches werden nicht geloescht; die Ausgabe nennt sie.
+`;
+
+export function parseWorktreeList(text) {
+  const out = [];
+  for (const block of String(text).replace(/\r/g, "").split(/\n\n+/)) {
+    const lines = block.split("\n").filter(Boolean);
+    if (!lines.length || !lines[0].startsWith("worktree ")) continue;
+    const e = { path: lines[0].slice(9), head: null, branch: null, detached: false, bare: false, locked: false, prunable: false };
+    for (const l of lines.slice(1)) {
+      if (l.startsWith("HEAD ")) e.head = l.slice(5);
+      else if (l.startsWith("branch ")) e.branch = l.slice(7).replace(/^refs\/heads\//, "");
+      else if (l === "detached") e.detached = true;
+      else if (l === "bare") e.bare = true;
+      else if (l === "locked" || l.startsWith("locked ")) e.locked = true;
+      else if (l === "prunable" || l.startsWith("prunable ")) e.prunable = true;
+    }
+    out.push(e);
+  }
+  return out;
+}
+
+// Injectable for tests (N6): the Windows case-folding never runs in the
+// Linux CI otherwise. The win32 branch folds backslashes first so the
+// normalization does not depend on the host platform's resolve/sep.
+export function makeNorm(platform = process.platform) {
+  if (platform === "win32") {
+    return (p) => resolve(p.replaceAll("\\", "/")).split(sep).join("/").toLowerCase();
+  }
+  return (p) => resolve(p).split(sep).join("/");
+}
+
+const norm = makeNorm();
+
+function kindOf(entry, mainPath) {
+  const p = norm(entry.path);
+  if (p.startsWith(norm(mainPath) + "/.claude/worktrees/")) return "claude";
+  if (p.includes("/.codex/worktrees/") || (entry.branch || "").startsWith("codex/")) return "codex";
+  return null;
+}
+
+function lastActivityMs(git) {
+  // Newest of: the last HEAD-reflog entry of this worktree (checkout, commit,
+  // reset — its own time, not the commit's) and the HEAD commit time.
+  const r = git("reflog", "-1", "--date=unix", "--format=%gd", "HEAD");
+  const m = r.code === 0 ? /@\{(\d+)\}/.exec(r.stdout) : null;
+  const reflog = m ? Number(m[1]) * 1000 : 0;
+  const c = git("log", "-1", "--format=%ct", "HEAD");
+  const commit = c.code === 0 ? Number(c.stdout.trim()) * 1000 : 0;
+  return Math.max(reflog || 0, commit || 0);
+}
+
+// Ignored files that may be dropped silently with the worktree: only pure
+// build artifacts are expendable; everything else (e.g. .env, local notes)
+// is unsaved work and keeps the worktree alive (M2).
+const IGNORE_ALLOW = new Set(["node_modules", "target", "dist"]);
+
+function unsafeIgnoredFiles(wgit) {
+  const r = wgit("status", "--porcelain", "-z", "--ignored=matching", "-uall");
+  if (r.code !== 0) return [];
+  return r.stdout
+    .split("\0")
+    .filter((e) => e.startsWith("!! "))
+    .map((e) => e.slice(3))
+    .filter((p) => !p.split("/").some((seg) => IGNORE_ALLOW.has(seg)));
+}
+
+export function planPrune({ run, cwd, base = "origin/main", minIdleMs = 12 * 3_600_000, useGh = true, now = Date.now() }) {
+  const git = gitIn(run, cwd);
+  const list = parseWorktreeList(git.ok("worktree", "list", "--porcelain"));
+  const mainPath = list[0]?.path;
+  const here = norm(git.ok("rev-parse", "--show-toplevel").trim());
+  let prs = new Map();
+  let ghError = null;
+  if (useGh) {
+    try {
+      const all = ghJson(run, ["pr", "list", "--state", "all", "--limit", "1000", "--json", "number,headRefName,state,updatedAt"], { cwd });
+      // newest PR per branch wins
+      for (const pr of [...all].sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)))) prs.set(pr.headRefName, pr);
+    } catch (e) {
+      ghError = e.message;
+    }
+  }
+  const entries = [];
+  let ignored = 0;
+  for (const wt of list.slice(1)) {
+    const kind = kindOf(wt, mainPath);
+    if (!kind || wt.bare) {
+      ignored++;
+      continue;
+    }
+    const e = { path: wt.path, branch: wt.branch, head: wt.head, kind, action: "keep", reason: "" };
+    const inBase = wt.head ? git("merge-base", "--is-ancestor", wt.head, base).code === 0 : false;
+    const pr = wt.branch ? prs.get(wt.branch) : undefined;
+    if (inBase) e.finished = `in ${base} enthalten`;
+    else if (pr && (pr.state === "MERGED" || pr.state === "CLOSED")) e.finished = `PR #${pr.number} ${pr.state}`;
+    if (!e.finished) continue; // still in progress: not listed at all
+    const wgit = gitIn(run, wt.path);
+    if (wt.prunable) {
+      e.reason = `${e.finished}; Verzeichnis fehlt (git worktree prune raeumt das auf)`;
+    } else if (wt.locked) {
+      e.reason = `${e.finished}; gesperrt (git worktree lock)`;
+    } else if (norm(wt.path) === here) {
+      e.reason = `${e.finished}; das ist das aktuelle Verzeichnis`;
+    } else {
+      const status = wgit("status", "--porcelain", "--untracked-files=normal");
+      const unpushed = wgit("rev-list", "--count", "HEAD", "--not", "--remotes");
+      const idle = now - lastActivityMs(wgit);
+      if (status.code !== 0 || status.stdout.trim()) {
+        e.reason = `${e.finished}; uncommittete Aenderungen`;
+      } else if (unpushed.code !== 0 || Number(unpushed.stdout.trim()) > 0) {
+        e.reason = `${e.finished}; ${unpushed.stdout.trim() || "?"} ungepushte Commits`;
+      } else if (idle < minIdleMs) {
+        e.reason = `${e.finished}; zuletzt aktiv vor ${Math.round(idle / 60_000)} min (< --min-idle)`;
+      } else {
+        const unsafe = unsafeIgnoredFiles(wgit);
+        if (unsafe.length) {
+          const shown = unsafe.slice(0, 5).join(", ");
+          e.reason = `${e.finished}; ignorierte ungesicherte Dateien: ${shown}${unsafe.length > 5 ? `, … (${unsafe.length})` : ""}`;
+        } else {
+          e.action = "remove";
+          e.reason = e.finished;
+        }
+      }
+    }
+    entries.push(e);
+  }
+  return { mainPath, base, entries, ignored, ghError };
+}
+
+export function applyPrune(plan, { run, cwd, log = () => {} }) {
+  const git = gitIn(run, cwd);
+  const failed = [];
+  for (const e of plan.entries.filter((x) => x.action === "remove")) {
+    const r = git("worktree", "remove", e.path);
+    if (r.code === 0) {
+      e.removed = true;
+      log(`entfernt: ${e.path}\n`);
+    } else {
+      failed.push(e);
+      log(`NICHT entfernt: ${e.path}: ${(r.stderr || r.stdout).trim()}\n`);
+    }
+  }
+  return { failed };
+}
+
+function formatPlan(plan, apply) {
+  const lines = [];
+  lines.push(apply ? "Entfernen:" : "Probelauf — entfernt wird erst mit --apply:");
+  const remove = plan.entries.filter((e) => e.action === "remove");
+  const keep = plan.entries.filter((e) => e.action === "keep");
+  for (const e of remove) lines.push(`  entfernen  ${e.path}  [${e.branch || "detached"}]  (${e.reason})`);
+  if (!remove.length) lines.push("  (nichts)");
+  if (keep.length) {
+    lines.push("Fertig, aber behalten:");
+    for (const e of keep) lines.push(`  behalten   ${e.path}  [${e.branch || "detached"}]  (${e.reason})`);
+  }
+  lines.push(`Nicht betrachtet (ausserhalb .claude/worktrees und Codex): ${plan.ignored}`);
+  if (plan.ghError) lines.push(`Hinweis: gh nicht nutzbar, nur "in ${plan.base} enthalten" geprueft (${plan.ghError})`);
+  const branches = remove.map((e) => e.branch).filter(Boolean);
+  if (branches.length) lines.push(`Branches danach von Hand loeschen, falls gewuenscht: ${branches.join(" ")}`);
+  return lines.join("\n") + "\n";
+}
+
+export const main = withExitCodes(async (argv, io, deps) => {
+  const { values } = parseArgs({
+    args: argv,
+    options: {
+      apply: { type: "boolean" },
+      repo: { type: "string" },
+      base: { type: "string" },
+      "min-idle": { type: "string" },
+      "no-gh": { type: "boolean" },
+      "no-fetch": { type: "boolean" },
+      json: { type: "boolean" },
+      help: { type: "boolean" },
+    },
+    strict: true,
+  });
+  if (values.help) {
+    io.out(HELP);
+    return EXIT.OK;
+  }
+  const run = deps.run || makeRunner();
+  const cwd = resolve(values.repo || process.cwd());
+  if (!values["no-fetch"]) {
+    const f = gitIn(run, cwd)("fetch", "-q", "origin");
+    if (f.code !== 0) io.err(`Hinweis: git fetch fehlgeschlagen, vergleiche mit lokalem Stand (${f.stderr.trim()})\n`);
+  }
+  const plan = planPrune({
+    run,
+    cwd,
+    base: values.base || "origin/main",
+    minIdleMs: values["min-idle"] === undefined ? undefined : parseDuration(values["min-idle"]),
+    useGh: !values["no-gh"],
+  });
+  if (values.json) io.out(JSON.stringify(plan, null, 2) + "\n");
+  else io.out(formatPlan(plan, Boolean(values.apply)));
+  if (!values.apply) return EXIT.OK;
+  const { failed } = applyPrune(plan, { run, cwd, log: io.out });
+  return failed.length ? EXIT.FAIL : EXIT.OK;
+});
+
+if (isMain(import.meta.url)) runCli(main);
diff --git a/scripts/dev/push-verified.mjs b/scripts/dev/push-verified.mjs
new file mode 100644
index 0000000..2ff0dd6
--- /dev/null
+++ b/scripts/dev/push-verified.mjs
@@ -0,0 +1,119 @@
+#!/usr/bin/env node
+// SETUP-08a — push-verified: push HEAD, then prove it arrived. The exit code
+// of `git push` is not evidence here (hooks and the Windows credential helper
+// have reported 1 for pushes that landed, and 0 for pushes that did not);
+// `git ls-remote` against the local HEAD is. Bounded retry, never
+// --no-verify, never --force.
+//
+//   npm run dev:push-verified -- [--branch <name>] [--retries 3]
+import { resolve } from "node:path";
+import { parseArgs } from "node:util";
+import { EXIT, UsageError, makeRunner, gitIn, isMain, runCli, withExitCodes, parseDuration, SLEEP } from "../lib/dev-tools.mjs";
+
+const HELP = `push-verified — HEAD pushen und per ls-remote belegen
+
+Aufruf:
+  npm run dev:push-verified -- [Optionen]
+
+Optionen:
+  --worktree <pfad>  Arbeitsbaum (Standard: aktuelles Verzeichnis)
+  --remote <name>    Remote (Standard: origin)
+  --branch <name>    Ziel-Branch (Standard: der aktuelle Branch)
+  --retries <n>      hoechstens n Push-Versuche (Standard: 3, 1..10)
+  --delay <dauer>    Pause zwischen Versuchen (Standard: 5s)
+  --help             diese Hilfe
+
+Exit-Codes: 0 Remote-SHA == lokaler HEAD, 1 nicht belegt (oder abgelehnt), 2 Aufruffehler.
+Der pre-push-Hook laeuft bei jedem Versuch; --no-verify und --force gibt es hier nicht.
+Ein abgelehnter Push ([rejected], non-fast-forward) wird nicht wiederholt.
+`;
+
+const BRANCH = /^[A-Za-z0-9._/-]+$/;
+
+// Generous per-call limits (M5): a push with hooks may take minutes, a mere
+// ls-remote never may. The runner maps a killed call to exit code 124.
+const PUSH_TIMEOUT_MS = 15 * 60_000;
+const LS_REMOTE_TIMEOUT_MS = 120_000;
+
+function remoteSha(run, cwd, remote, branch) {
+  const r = run("git", ["-C", cwd, "ls-remote", remote, `refs/heads/${branch}`], { timeoutMs: LS_REMOTE_TIMEOUT_MS });
+  if (r.code !== 0) return { sha: null, error: (r.stderr || r.stdout).trim() };
+  const line = r.stdout.split(/\r?\n/).find((l) => l.endsWith(`\trefs/heads/${branch}`));
+  return { sha: line ? line.split("\t")[0] : null, error: null };
+}
+
+// Not `async` on purpose: argument and precondition violations (UsageError)
+// throw synchronously, so callers and tests see them without awaiting.
+export function pushVerified({ run, cwd, remote = "origin", branch, retries = 3, delayMs = 5000, sleep = SLEEP, log = () => {} }) {
+  const git = gitIn(run, cwd);
+  const local = git.ok("rev-parse", "HEAD").trim();
+  const sym = branch ? null : git("symbolic-ref", "--short", "HEAD");
+  const target = branch || (sym.code === 0 ? sym.stdout.trim() : "");
+  if (!target) throw new UsageError("Detached HEAD: --branch <name> ist erforderlich");
+  if (!BRANCH.test(target) || target.startsWith("-")) throw new UsageError(`Branch-Name unzulaessig: ${target}`);
+  if (git("check-ref-format", "--branch", target).code !== 0) {
+    throw new UsageError(`Branch-Name unzulaessig (git check-ref-format): ${target}`);
+  }
+  return attemptPush({ run, cwd, remote, target, local, retries, delayMs, sleep, log });
+}
+
+async function attemptPush({ run, cwd, remote, target, local, retries, delayMs, sleep, log }) {
+  let last = { sha: null, error: null };
+  let reason = "";
+  for (let attempt = 1; attempt <= retries; attempt++) {
+    const push = run("git", ["-C", cwd, "push", remote, `HEAD:refs/heads/${target}`], { timeoutMs: PUSH_TIMEOUT_MS });
+    last = remoteSha(run, cwd, remote, target);
+    log(`Versuch ${attempt}: push-exit=${push.code} remote=${last.sha ? last.sha.slice(0, 7) : "-"} lokal=${local.slice(0, 7)}\n`);
+    if (last.sha === local) return { ok: true, attempts: attempt, localSha: local, remoteSha: last.sha, branch: target };
+    const text = `${push.stdout}\n${push.stderr}`;
+    if (/\[(remote )?rejected\]/.test(text)) {
+      reason = `rejected: ${text.split(/\r?\n/).find((l) => /rejected/.test(l))?.trim()}`;
+      log(`${reason}\nKein weiterer Versuch: ein abgelehnter Push wird durch Wiederholen nicht besser.\n`);
+      return { ok: false, attempts: attempt, localSha: local, remoteSha: last.sha, branch: target, reason };
+    }
+    reason = last.error ? `ls-remote: ${last.error}` : "Remote-SHA weicht vom lokalen HEAD ab";
+    const tail = text.trim().split(/\r?\n/).slice(-5).join("\n");
+    if (tail) log(`${tail}\n`);
+    if (attempt < retries) await sleep(delayMs);
+  }
+  return { ok: false, attempts: retries, localSha: local, remoteSha: last.sha, branch: target, reason };
+}
+
+export const main = withExitCodes(async (argv, io, deps) => {
+  const { values } = parseArgs({
+    args: argv,
+    options: {
+      worktree: { type: "string" },
+      remote: { type: "string" },
+      branch: { type: "string" },
+      retries: { type: "string" },
+      delay: { type: "string" },
+      help: { type: "boolean" },
+    },
+    strict: true,
+  });
+  if (values.help) {
+    io.out(HELP);
+    return EXIT.OK;
+  }
+  const retries = values.retries === undefined ? 3 : Number(values.retries);
+  if (!Number.isInteger(retries) || retries < 1 || retries > 10) throw new UsageError("--retries erwartet 1..10");
+  const res = await pushVerified({
+    run: deps.run || makeRunner(),
+    cwd: resolve(values.worktree || process.cwd()),
+    remote: values.remote || "origin",
+    branch: values.branch,
+    retries,
+    delayMs: values.delay ? parseDuration(values.delay) : 5000,
+    sleep: deps.sleep,
+    log: io.out,
+  });
+  if (res.ok) {
+    io.out(`belegt: ${res.branch} = ${res.remoteSha}\n`);
+    return EXIT.OK;
+  }
+  io.err(`NICHT belegt: ${res.branch} (${res.reason})\n`);
+  return EXIT.FAIL;
+});
+
+if (isMain(import.meta.url)) runCli(main);
diff --git a/scripts/dev/report-commit.mjs b/scripts/dev/report-commit.mjs
new file mode 100644
index 0000000..f53aef9
--- /dev/null
+++ b/scripts/dev/report-commit.mjs
@@ -0,0 +1,199 @@
+#!/usr/bin/env node
+// SETUP-08a — report-commit: take a report file into `.pa/report_<id>.md` and
+// commit it alone, with a `No-Test:` trailer and a Co-Authored-By line.
+//
+//   npm run dev:report-commit -- --id w2-07 --from <datei> --co-author "Name <mail>"
+//
+// Before committing, docs/dev-hq/data.{js,json} are restored to HEAD when a
+// merge is the only thing that changed them (the post-merge hook regenerates
+// the HQ snapshot; a report commit must not carry that). "Only a merge" means:
+// the snapshot files are modified but not staged, nothing else is modified,
+// and the last HEAD movement was a merge (or --merge was used right here on a
+// clean tree). Anything else is refused and nothing is changed.
+import { copyFileSync, existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
+import { basename, join, resolve } from "node:path";
+import { tmpdir } from "node:os";
+import { parseArgs } from "node:util";
+import { EXIT, UsageError, RefusedError, makeRunner, gitIn, isMain, runCli, withExitCodes } from "../lib/dev-tools.mjs";
+import { pushVerified } from "./push-verified.mjs";
+
+export const HQ_DATA = ["docs/dev-hq/data.js", "docs/dev-hq/data.json"];
+const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
+
+const HELP = `report-commit — Bericht nach .pa/report_<id>.md uebernehmen und allein committen
+
+Aufruf:
+  npm run dev:report-commit -- --id <id> --from <datei> --co-author "Name <mail>" [Optionen]
+
+Optionen:
+  --id <id>            Paket-/Berichtskennung, z. B. w2-07 (nur A-Z a-z 0-9 . _ -)
+  --from <datei>       Quelldatei des Berichts
+  --co-author <zeile>  "Name <mail>" fuer Co-Authored-By (Standard: $PA_CO_AUTHOR)
+  --worktree <pfad>    Arbeitsbaum (Standard: aktuelles Verzeichnis)
+  --merge <ref>        vorher \`git merge --no-edit <ref>\` (Baum muss sauber sein)
+  --subject <text>     Betreffzeile (Standard: "docs(pa): <id> Bericht")
+  --push               danach push-verified auf den aktuellen Branch
+  --dry-run            nur anzeigen, was passieren wuerde
+  --help               diese Hilfe
+
+Exit-Codes: 0 ok, 1 Fehler (git/Push), 2 Aufruffehler, 3 abgelehnt (nichts geaendert).
+Der Commit laeuft durch die normalen Hooks; --no-verify gibt es hier nicht.
+`;
+
+function porcelain(git) {
+  // -z keeps paths exact; entries are "XY path".
+  return git
+    .ok("status", "--porcelain=v1", "-z", "--untracked-files=normal")
+    .split("\0")
+    .filter(Boolean)
+    .filter((e, i, all) => !(i > 0 && /^R|^C/.test(all[i - 1])))
+    .map((e) => ({ x: e[0], y: e[1], path: e.slice(3) }));
+}
+
+function lastHeadMoveWasMerge(git) {
+  const r = git("reflog", "-1", "--format=%gs", "HEAD");
+  return r.code === 0 && /^merge\b/i.test(r.stdout.trim());
+}
+
+// Returns the HQ files to restore, or throws RefusedError.
+export function hqResetPlan(git, { mergedHere = false } = {}) {
+  const entries = porcelain(git);
+  const hq = entries.filter((e) => HQ_DATA.includes(e.path));
+  if (hq.length === 0) return [];
+  const others = entries.filter((e) => !HQ_DATA.includes(e.path));
+  if (hq.some((e) => e.x !== " " && e.x !== "?")) {
+    throw new RefusedError("docs/dev-hq/data.* ist gestaged; das entscheidet der Autor, nicht dieses Werkzeug.");
+  }
+  if (others.length > 0) {
+    throw new RefusedError(
+      "docs/dev-hq/data.* ist geaendert, aber auch andere Dateien: " +
+        others.map((e) => e.path).join(", ") +
+        ". Ob die HQ-Daten nur vom Merge stammen, ist so nicht belegbar.",
+    );
+  }
+  if (!mergedHere && !lastHeadMoveWasMerge(git)) {
+    throw new RefusedError("docs/dev-hq/data.* ist geaendert, die letzte HEAD-Bewegung war aber kein Merge.");
+  }
+  return hq.map((e) => e.path);
+}
+
+export function reportCommit({ run, cwd, id, from, coAuthor, merge, subject, dryRun = false, log = () => {} }) {
+  if (!id || !ID.test(id)) throw new UsageError(`--id fehlt oder ist unzulaessig: ${id ?? ""}`);
+  if (!from) throw new UsageError("--from fehlt");
+  if (!coAuthor || !/^[^<>\n]+ <[^<>\s]+>$/.test(coAuthor.trim())) {
+    throw new UsageError('--co-author fehlt oder hat nicht die Form "Name <mail>" (oder PA_CO_AUTHOR setzen)');
+  }
+  const src = resolve(from);
+  if (!existsSync(src)) throw new UsageError(`Berichtsdatei fehlt: ${from}`);
+  // All report paths are repo-relative, so every git call runs at the
+  // toplevel — a --worktree pointing at a subdirectory must still work (N5).
+  const top = gitIn(run, cwd).ok("rev-parse", "--show-toplevel").trim();
+  const git = gitIn(run, top);
+  const target = `.pa/report_${id}.md`;
+  const actions = [];
+
+  if (git.ok("diff", "--cached", "--name-only").trim()) {
+    throw new RefusedError("Im Index liegen schon Aenderungen; der Bericht-Commit soll nur den Bericht enthalten.");
+  }
+  let mergedHere = false;
+  if (merge) {
+    // M4: refuse BEFORE anything moves when the tree is not completely clean
+    // (untracked files included) — "abgelehnt = nichts geaendert" must hold.
+    if (porcelain(git).length > 0) {
+      throw new RefusedError("--merge braucht einen komplett sauberen Arbeitsbaum (auch keine ungetrackten Dateien).");
+    }
+    actions.push(`git merge --no-edit ${merge}`);
+    if (!dryRun) {
+      const r = git("merge", "--no-edit", merge);
+      if (r.code !== 0) throw new Error(`Merge von ${merge} fehlgeschlagen:\n${r.stdout}${r.stderr}`);
+      mergedHere = true;
+    }
+  }
+  const reset = dryRun && merge ? [] : hqResetPlan(git, { mergedHere });
+  for (const p of reset) actions.push(`git checkout -- ${p}`);
+  actions.push(`kopieren ${src} -> ${target}`, `git add ${target}`, "git commit -F <nachricht>");
+  if (dryRun) {
+    for (const a of actions) log(`  ${a}\n`);
+    return { dryRun: true, actions, reset, commit: null, backupDir: null };
+  }
+  let backupDir = null;
+  if (reset.length) {
+    // N1: the discarded HQ snapshot may contain a deliberate hand edit made
+    // right after the merge — keep a copy and name the path, never lose it
+    // silently.
+    backupDir = mkdtempSync(join(tmpdir(), "report-commit-hq-backup-"));
+    for (const p of reset) copyFileSync(join(top, p), join(backupDir, basename(p)));
+    log(`Backup der zurueckgesetzten HQ-Daten: ${backupDir}\n`);
+    git.ok("checkout", "--", ...reset);
+  }
+  mkdirSync(join(top, ".pa"), { recursive: true });
+  copyFileSync(src, join(top, target));
+  git.ok("add", "--", target);
+  const staged = git.ok("diff", "--cached", "--name-only").trim();
+  if (!staged) throw new RefusedError(`${target} ist unveraendert, es gibt nichts zu committen.`);
+  const msg = [
+    subject || `docs(pa): ${id} Bericht`,
+    "",
+    "No-Test: reiner Bericht unter .pa/, kein Code",
+    "",
+    `Co-Authored-By: ${coAuthor.trim()}`,
+    "",
+  ].join("\n");
+  const tmp = mkdtempSync(join(tmpdir(), "report-commit-"));
+  try {
+    const file = join(tmp, "msg.txt");
+    writeFileSync(file, msg);
+    const r = git("commit", "-q", "-F", file);
+    if (r.code !== 0) throw new Error(`git commit fehlgeschlagen (Exit ${r.code}):\n${r.stdout}${r.stderr}`);
+  } finally {
+    rmSync(tmp, { recursive: true, force: true });
+  }
+  return { dryRun: false, actions, reset, commit: git.ok("rev-parse", "HEAD").trim(), backupDir };
+}
+
+export const main = withExitCodes(async (argv, io, deps) => {
+  const { values } = parseArgs({
+    args: argv,
+    options: {
+      id: { type: "string" },
+      from: { type: "string" },
+      "co-author": { type: "string" },
+      worktree: { type: "string" },
+      merge: { type: "string" },
+      subject: { type: "string" },
+      push: { type: "boolean" },
+      "dry-run": { type: "boolean" },
+      help: { type: "boolean" },
+    },
+    strict: true,
+  });
+  if (values.help) {
+    io.out(HELP);
+    return EXIT.OK;
+  }
+  const run = deps.run || makeRunner();
+  const cwd = resolve(values.worktree || process.cwd());
+  const dryRun = Boolean(values["dry-run"]);
+  if (dryRun) io.out("Probelauf — es wird nichts geaendert:\n");
+  const res = reportCommit({
+    run,
+    cwd,
+    id: values.id,
+    from: values.from,
+    coAuthor: values["co-author"] ?? process.env.PA_CO_AUTHOR,
+    merge: values.merge,
+    subject: values.subject,
+    dryRun,
+    log: io.out,
+  });
+  if (dryRun) return EXIT.OK;
+  if (res.reset.length) io.out(`zurueckgesetzt: ${res.reset.join(", ")}\n`);
+  io.out(`committet: ${res.commit}\n`);
+  if (values.push) {
+    const p = await pushVerified({ run, cwd, log: io.out, sleep: deps.sleep });
+    return p.ok ? EXIT.OK : EXIT.FAIL;
+  }
+  return EXIT.OK;
+});
+
+if (isMain(import.meta.url)) runCli(main);
diff --git a/scripts/dev/spec-close.mjs b/scripts/dev/spec-close.mjs
new file mode 100644
index 0000000..1755212
--- /dev/null
+++ b/scripts/dev/spec-close.mjs
@@ -0,0 +1,133 @@
+#!/usr/bin/env node
+// SETUP-08b — spec-close: after a merge, set `.pa/task_<id>.md` to
+// `Status: historisch` and remove its line under "Aktive Specs" in STAND.md
+// (STAND.md rule: "beim Merge wird die Spec Status: historisch und die Zeile
+// verschwindet"). Dry run by default. Afterwards `npm run hq` regenerates the
+// HQ snapshot; --hq runs the generator directly.
+//
+//   npm run dev:spec-close -- w1-22            # zeigt die Aenderungen
+//   npm run dev:spec-close -- w1-22 --apply    # schreibt sie
+import { readFileSync, writeFileSync, existsSync } from "node:fs";
+import { join, resolve } from "node:path";
+import { parseArgs } from "node:util";
+import { EXIT, UsageError, RefusedError, makeRunner, gitIn, isMain, runCli, withExitCodes } from "../lib/dev-tools.mjs";
+import { listedInStand } from "../lib/active-specs.mjs";
+
+const SECTION = /^#{2,4}\s*Aktive Specs\s*$/; // same rule as scripts/lib/active-specs.mjs
+const HEAD_LINES = 8; // same rule as scripts/lib/active-specs.mjs
+
+const HELP = `spec-close — Spec auf "Status: historisch" setzen und aus STAND.md "Aktive Specs" austragen
+
+Aufruf:
+  npm run dev:spec-close -- <id> [--apply] [--hq] [--root <pfad>]
+
+  <id>  w1-22, task_w1-22.md oder .pa/task_w1-22.md
+
+Optionen:
+  --apply        wirklich schreiben (Standard: Probelauf)
+  --hq           danach node scripts/dev-hq.mjs ausfuehren (= npm run hq)
+  --root <pfad>  Repo-Wurzel (Standard: Wurzel des aktuellen Checkouts)
+  --help         diese Hilfe
+
+Exit-Codes: 0 ok (auch: schon historisch und nicht gelistet), 1 --hq scheiterte,
+            2 Aufruffehler, 3 Spec fehlt oder Status-Zeile ungueltig.
+`;
+
+export function specName(arg) {
+  const base = String(arg || "").replace(/^\.pa[\\/]/, "").replace(/^task_/, "").replace(/\.md$/, "");
+  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(base)) throw new UsageError(`Spec-Kennung unzulaessig: ${arg}`);
+  return `task_${base}.md`;
+}
+
+export function closeSpec(text) {
+  const eol = text.includes("\r\n") ? "\r\n" : "\n";
+  const lines = text.split(/\r?\n/);
+  const hits = lines.slice(0, HEAD_LINES).map((l, i) => [l, i]).filter(([l]) => /^Status:/.test(l));
+  if (hits.length !== 1) throw new RefusedError(`genau eine Status-Zeile in den ersten ${HEAD_LINES} Zeilen erwartet, gefunden: ${hits.length}`);
+  const [line, i] = hits[0];
+  const value = /^Status:\s*(\S+)\s*$/.exec(line);
+  if (!value) throw new RefusedError(`Status-Zeile nicht im Format "Status: <Wert>" (ein Wort, kein Zusatz): ${line.trim()}`);
+  const previous = value[1];
+  if (previous === "historisch") return { text, changed: false, previous };
+  lines[i] = "Status: historisch";
+  return { text: lines.join(eol), changed: true, previous };
+}
+
+export function removeFromStand(text, name) {
+  const eol = text.includes("\r\n") ? "\r\n" : "\n";
+  const lines = text.split(/\r?\n/);
+  const start = lines.findIndex((l) => SECTION.test(l));
+  if (start === -1) throw new RefusedError('STAND.md: Abschnitt "Aktive Specs" fehlt.');
+  let end = start + 1;
+  while (end < lines.length && !/^#{1,4}\s/.test(lines[end])) end++;
+  const ref = new RegExp(`\\.pa/${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_.-])`);
+  const removed = [];
+  const kept = lines.filter((l, i) => {
+    if (i > start && i < end && ref.test(l)) {
+      removed.push(l);
+      return false;
+    }
+    return true;
+  });
+  return { text: kept.join(eol), removed };
+}
+
+export const main = withExitCodes(async (argv, io, deps) => {
+  const { values, positionals } = parseArgs({
+    args: argv,
+    options: { apply: { type: "boolean" }, hq: { type: "boolean" }, root: { type: "string" }, help: { type: "boolean" } },
+    allowPositionals: true,
+    strict: true,
+  });
+  if (values.help) {
+    io.out(HELP);
+    return EXIT.OK;
+  }
+  if (positionals.length !== 1) throw new UsageError("genau eine Spec-Kennung erwartet");
+  const name = specName(positionals[0]);
+  const run = deps.run || makeRunner();
+  let root = values.root;
+  if (!root) {
+    const top = gitIn(run, process.cwd())("rev-parse", "--show-toplevel");
+    if (top.code !== 0) throw new RefusedError(`git rev-parse --show-toplevel scheiterte (${top.stderr.trim()}); --root angeben.`);
+    root = top.stdout.trim();
+  }
+  root = resolve(root);
+  const specPath = join(root, ".pa", name);
+  const standPath = join(root, "STAND.md");
+  if (!existsSync(specPath)) throw new RefusedError(`.pa/${name} fehlt`);
+  if (!existsSync(standPath)) throw new RefusedError("STAND.md fehlt");
+  const spec = closeSpec(readFileSync(specPath, "utf8"));
+  const stand = removeFromStand(readFileSync(standPath, "utf8"), name);
+  if (listedInStand(stand.text).names.includes(name)) {
+    throw new RefusedError(`.pa/${name} steht nach dem Austragen noch unter "Aktive Specs" (unbekanntes Zeilenformat); nichts geschrieben.`);
+  }
+  const plan = [
+    spec.changed ? `.pa/${name}: Status: ${spec.previous} -> historisch` : `.pa/${name}: schon historisch`,
+    stand.removed.length ? `STAND.md: entferne ${stand.removed.length} Zeile(n):\n${stand.removed.map((l) => `    ${l}`).join("\n")}` : "STAND.md: keine Zeile unter \"Aktive Specs\"",
+  ];
+  if (!spec.changed && !stand.removed.length) {
+    io.out(`nichts zu tun: ${plan.join("; ")}\n`);
+    return EXIT.OK;
+  }
+  if (!values.apply) {
+    io.out(`Probelauf — geschrieben wird erst mit --apply:\n  ${plan.join("\n  ")}\n`);
+    return EXIT.OK;
+  }
+  if (spec.changed) writeFileSync(specPath, spec.text);
+  if (stand.removed.length) writeFileSync(standPath, stand.text);
+  io.out(`geschrieben:\n  ${plan.join("\n  ")}\n`);
+  if (!values.hq) {
+    io.out("Danach: npm run hq (HQ-Momentaufnahme neu erzeugen) und docs/dev-hq/data.* mitcommitten.\n");
+    return EXIT.OK;
+  }
+  const r = run(process.execPath, ["scripts/dev-hq.mjs"], { cwd: root });
+  if (r.code !== 0) {
+    io.err(`npm run hq scheiterte (Exit ${r.code}):\n${r.stderr || r.stdout}\n`);
+    return EXIT.FAIL;
+  }
+  io.out("HQ-Momentaufnahme neu erzeugt (docs/dev-hq/data.*).\n");
+  return EXIT.OK;
+});
+
+if (isMain(import.meta.url)) runCli(main);
diff --git a/scripts/lib/dev-build-slot.test.mjs b/scripts/lib/dev-build-slot.test.mjs
new file mode 100644
index 0000000..1c67874
--- /dev/null
+++ b/scripts/lib/dev-build-slot.test.mjs
@@ -0,0 +1,161 @@
+// SETUP-08a: build-slot decides from injected processes, file times and RAM.
+import { test } from "node:test";
+import assert from "node:assert/strict";
+import { parseLocaleNumber } from "./dev-tools.mjs";
+import { slotStatus, parseWindowsProcesses, defaultSlots, listCargoProcesses, main } from "../dev/build-slot.mjs";
+
+const GB = 1024 ** 3;
+const NOW = Date.parse("2026-09-24T20:00:00Z");
+const slots = [
+  { name: "projecta-a", path: "C:/work/u/cargo-targets/projecta-a" },
+  { name: "projecta-b", path: "C:/work/u/cargo-targets/projecta-b" },
+  { name: "projecta-c", path: "C:/work/u/cargo-targets/projecta-c" },
+  { name: "main", path: "C:/work/u/ProjectA/src-tauri/target" },
+];
+// every slot exists, nothing touched for an hour
+const quietStat = () => ({ exists: true, mtimeMs: NOW - 3_600_000 });
+
+test("parseLocaleNumber reads German and C decimal separators", () => {
+  assert.equal(parseLocaleNumber("3,25"), 3.25);
+  assert.equal(parseLocaleNumber("3.25"), 3.25);
+  assert.equal(parseLocaleNumber(" 12 "), 12);
+  assert.ok(Number.isNaN(parseLocaleNumber("n/a")));
+});
+
+test("build-slot marks a slot busy when a rustc command line names it", () => {
+  const processes = [
+    { pid: 1, name: "rustc.exe", cmd: "rustc --crate-name x --out-dir C:\\work\\u\\cargo-targets\\projecta-a\\debug\\deps -L dependency=C:\\work\\u\\cargo-targets\\projecta-a\\debug\\deps" },
+    { pid: 2, name: "cargo.exe", cmd: "cargo clippy --all-targets" },
+  ];
+  const s = slotStatus({ slots, processes, freeBytes: 8 * GB, stat: quietStat, now: NOW });
+  assert.equal(s.slots[0].state, "belegt");
+  assert.match(s.slots[0].reason, /rustc/);
+  assert.equal(s.slots[1].state, "frei");
+  assert.equal(s.recommendation.slot.name, "projecta-b");
+  assert.equal(s.unattributed, 1);
+});
+
+test("build-slot matches paths regardless of slash direction and case on Windows", () => {
+  const processes = [{ pid: 3, name: "rustc", cmd: "--out-dir c:/work/U/Cargo-Targets/projecta-b/debug/deps" }];
+  const s = slotStatus({ slots, processes, freeBytes: 8 * GB, stat: quietStat, now: NOW, platform: "win32" });
+  assert.equal(s.slots[1].state, "belegt");
+});
+
+test("build-slot falls back to the lock-file heuristic", () => {
+  const stat = (p) =>
+    /projecta-a[\\/]debug[\\/]\.cargo-lock$/.test(p) ? { exists: true, mtimeMs: NOW - 20_000 } : quietStat(p);
+  const s = slotStatus({ slots, processes: null, freeBytes: 8 * GB, stat, now: NOW });
+  assert.equal(s.slots[0].state, "vermutlich belegt");
+  assert.equal(s.recommendation.slot.name, "projecta-b");
+});
+
+test("build-slot skips a missing slot directory", () => {
+  const stat = (p) => (p.includes("projecta-a") ? { exists: false } : quietStat(p));
+  const s = slotStatus({ slots, processes: [], freeBytes: 8 * GB, stat, now: NOW });
+  assert.equal(s.slots[0].state, "fehlt");
+  assert.equal(s.recommendation.slot.name, "projecta-b");
+});
+
+test("build-slot recommends waiting under 2.5 GB free RAM", () => {
+  const s = slotStatus({ slots, processes: [], freeBytes: 2 * GB, stat: quietStat, now: NOW });
+  assert.equal(s.recommendation.slot, null);
+  assert.match(s.recommendation.text, /RAM/);
+});
+
+test("build-slot recommends waiting when three builds already run", () => {
+  const processes = ["a", "b", "c"].map((x, i) => ({ pid: i, name: "rustc", cmd: `--out-dir C:/work/u/cargo-targets/projecta-${x}/debug/deps` }));
+  const s = slotStatus({ slots, processes, freeBytes: 12 * GB, stat: quietStat, now: NOW });
+  assert.equal(s.recommendation.slot, null);
+  assert.match(s.recommendation.text, /drei|3/);
+});
+
+test("build-slot recommendation never sets CARGO_PROFILE_*", () => {
+  const s = slotStatus({ slots, processes: [], freeBytes: 8 * GB, stat: quietStat, now: NOW });
+  assert.match(s.recommendation.env, /CARGO_TARGET_DIR=/);
+  assert.doesNotMatch(s.recommendation.env, /CARGO_PROFILE/);
+});
+
+test("parseWindowsProcesses accepts a single object and an array", () => {
+  const one = parseWindowsProcesses('{"ProcessId":5,"Name":"rustc.exe","CommandLine":"x"}');
+  assert.deepEqual(one, [{ pid: 5, name: "rustc.exe", cmd: "x" }]);
+  const many = parseWindowsProcesses('[{"ProcessId":5,"Name":"rustc.exe","CommandLine":null},{"ProcessId":6,"Name":"cargo.exe","CommandLine":"cargo"}]');
+  assert.equal(many.length, 2);
+  assert.equal(many[0].cmd, "");
+  assert.deepEqual(parseWindowsProcesses(""), []);
+});
+
+test("defaultSlots honours PA_BUILD_SLOTS", () => {
+  const d = defaultSlots({ home: "C:/work/u", mainCheckout: "C:/r", env: {} });
+  assert.deepEqual(d.map((s) => s.name), ["projecta-a", "projecta-b", "projecta-c", "main"]);
+  const custom = defaultSlots({ home: "/h", mainCheckout: "/r", env: { PA_BUILD_SLOTS: "/x/one;/x/two" } });
+  assert.deepEqual(custom.map((s) => s.path), ["/x/one", "/x/two"]);
+});
+
+test("build-slot CLI exits 3 when no slot is usable and 0 otherwise", async () => {
+  const out = [];
+  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
+  const deps = { slots, processes: () => [], freeBytes: () => 1 * GB, stat: quietStat, now: () => NOW };
+  assert.equal(await main([], io, deps), 3);
+  assert.equal(await main(["--json"], io, { ...deps, freeBytes: () => 8 * GB }), 0);
+  assert.equal(JSON.parse(out.at(-1)).recommendation.slot.name, "projecta-a");
+});
+
+test("build-slot --help exits 0", async () => {
+  const out = [];
+  assert.equal(await main(["--help"], { out: (s) => out.push(s), err: (s) => out.push(s) }), 0);
+  assert.match(out.join(""), /build-slot/);
+});
+
+test("the Windows process query includes clippy and build-script processes (G3)", () => {
+  const seen = [];
+  const run = (cmd, args) => {
+    seen.push(args.join(" "));
+    return { code: 0, stdout: "[]", stderr: "" };
+  };
+  listCargoProcesses({ run, platform: "win32" });
+  const filter = seen.join(" ");
+  assert.match(filter, /cargo-clippy\.exe/);
+  assert.match(filter, /build-script-build\.exe/);
+});
+
+test("isCargoProcessName accepts comm names truncated at 15 characters (G4/N3)", async () => {
+  const { isCargoProcessName } = await import("../dev/build-slot.mjs");
+  assert.equal(typeof isCargoProcessName, "function");
+  assert.equal(isCargoProcessName("cargo"), true);
+  assert.equal(isCargoProcessName("rustc.exe"), true);
+  assert.equal(isCargoProcessName("build-script-bu"), true); // /proc/<pid>/comm Schnitt bei 15 Zeichen
+  assert.equal(isCargoProcessName("build-script-build"), true);
+  assert.equal(isCargoProcessName("build-script-bu2"), false);
+  assert.equal(isCargoProcessName("my-cargo-build"), false);
+  assert.equal(isCargoProcessName("cargo-fmt"), false);
+});
+
+test("namesSlot never matches a longer slot name (end-of-token)", async () => {
+  const { namesSlot } = await import("../dev/build-slot.mjs");
+  assert.equal(typeof namesSlot, "function");
+  assert.equal(namesSlot("rustc --out-dir C:/u/cargo-targets/projecta-ab/debug/deps", "C:/u/cargo-targets/projecta-a", "win32"), false);
+  assert.equal(namesSlot("rustc --out-dir C:/u/cargo-targets/projecta-a-x/debug/deps", "C:/u/cargo-targets/projecta-a", "win32"), false);
+  assert.equal(namesSlot("rustc --out-dir C:/u/cargo-targets/projecta-a/debug/deps", "C:/u/cargo-targets/projecta-a", "win32"), true);
+  assert.equal(namesSlot("rustc --out-dir C:/u/cargo-targets/projecta-a", "C:/u/cargo-targets/projecta-a", "win32"), true);
+});
+
+test("build-slot treats a fresh lock as probably busy even with a process list (M3)", () => {
+  const stat = (p) => (/projecta-a[\\/]debug[\\/]\.cargo-lock$/.test(p) ? { exists: true, mtimeMs: NOW - 20_000 } : quietStat(p));
+  const processes = [{ pid: 9, name: "cargo.exe", cmd: "cargo build" }]; // Startphase: kein Slot in der Kommandozeile
+  const s = slotStatus({ slots, processes, freeBytes: 8 * GB, stat, now: NOW });
+  assert.equal(s.slots[0].state, "vermutlich belegt");
+});
+
+test("build-slot counts unattributed cargo processes toward the busy limit (M3)", () => {
+  const processes = [1, 2, 3].map((i) => ({ pid: i, name: "cargo.exe", cmd: "cargo test" }));
+  const s = slotStatus({ slots, processes, freeBytes: 12 * GB, stat: quietStat, now: NOW });
+  assert.equal(s.busy, 3);
+  assert.equal(s.recommendation.slot, null);
+  assert.match(s.recommendation.text, /drei|3/);
+});
+
+test("build-slot heuristic also watches the release profile (N2)", () => {
+  const stat = (p) => (/projecta-b[\\/]release[\\/]deps$/.test(p) ? { exists: true, mtimeMs: NOW - 30_000 } : quietStat(p));
+  const s = slotStatus({ slots, processes: null, freeBytes: 8 * GB, stat, now: NOW });
+  assert.equal(s.slots[1].state, "vermutlich belegt");
+});
diff --git a/scripts/lib/dev-ci-watch.test.mjs b/scripts/lib/dev-ci-watch.test.mjs
new file mode 100644
index 0000000..ce3bb00
--- /dev/null
+++ b/scripts/lib/dev-ci-watch.test.mjs
@@ -0,0 +1,103 @@
+// SETUP-08a: ci-watch follows the required checks of a PR through a fake gh.
+import { test } from "node:test";
+import assert from "node:assert/strict";
+import { watchChecks, main } from "../dev/ci-watch.mjs";
+
+// gh prints the checks as JSON and exits 8 while any is pending, 1 on failure.
+function fakeGh(rounds) {
+  let i = 0;
+  const calls = [];
+  const run = (cmd, args) => {
+    calls.push([cmd, ...args]);
+    const checks = rounds[Math.min(i++, rounds.length - 1)];
+    if (checks instanceof Error) return { code: 1, stdout: "", stderr: checks.message };
+    const pending = checks.some((c) => c.bucket === "pending");
+    const failed = checks.some((c) => c.bucket === "fail");
+    return { code: pending ? 8 : failed ? 1 : 0, stdout: JSON.stringify(checks), stderr: "" };
+  };
+  return { run, calls };
+}
+const c = (name, bucket) => ({ name, bucket, state: bucket.toUpperCase(), link: `https://example.invalid/${name}` });
+const clock = () => {
+  let t = 0;
+  return { now: () => t, sleep: async (ms) => { t += ms; } };
+};
+
+test("ci-watch polls until every required check is done and exits 0 when green", async () => {
+  const gh = fakeGh([
+    [c("gates (linux)", "pending"), c("red-first", "pending")],
+    [c("gates (linux)", "pass"), c("red-first", "pending")],
+    [c("gates (linux)", "pass"), c("red-first", "pass")],
+  ]);
+  const k = clock();
+  const res = await watchChecks({ run: gh.run, pr: "42", intervalMs: 1000, timeoutMs: 60_000, ...k });
+  assert.equal(res.code, 0);
+  assert.equal(gh.calls.length, 3);
+  assert.ok(gh.calls.every((a) => a.includes("--required") && a.includes("--json")));
+});
+
+test("ci-watch exits 1 when a required check fails", async () => {
+  const gh = fakeGh([[c("gates (linux)", "fail"), c("red-first", "pass")]]);
+  const res = await watchChecks({ run: gh.run, pr: "42", intervalMs: 1000, timeoutMs: 60_000, ...clock() });
+  assert.equal(res.code, 1);
+  assert.match(res.summary, /gates \(linux\)/);
+});
+
+test("ci-watch treats cancel as failure and skipping as done", async () => {
+  const gh = fakeGh([[c("gates (windows)", "skipping"), c("red-first", "cancel")]]);
+  const res = await watchChecks({ run: gh.run, pr: "42", intervalMs: 1000, timeoutMs: 60_000, ...clock() });
+  assert.equal(res.code, 1);
+  const green = fakeGh([[c("gates (windows)", "skipping"), c("red-first", "pass")]]);
+  assert.equal((await watchChecks({ run: green.run, pr: "42", intervalMs: 1000, timeoutMs: 60_000, ...clock() })).code, 0);
+});
+
+test("ci-watch --fail-fast stops on the first failure while others still run", async () => {
+  const gh = fakeGh([[c("gates (linux)", "fail"), c("gates (windows)", "pending")]]);
+  const res = await watchChecks({ run: gh.run, pr: "42", intervalMs: 1000, timeoutMs: 60_000, failFast: true, ...clock() });
+  assert.equal(res.code, 1);
+  assert.equal(gh.calls.length, 1);
+});
+
+test("ci-watch exits 4 after the bounded run time", async () => {
+  const gh = fakeGh([[c("gates (linux)", "pending")]]);
+  const res = await watchChecks({ run: gh.run, pr: "42", intervalMs: 10_000, timeoutMs: 30_000, ...clock() });
+  assert.equal(res.code, 4);
+  assert.ok(gh.calls.length <= 5);
+});
+
+test("ci-watch exits 3 when the PR never gets required checks", async () => {
+  const gh = fakeGh([[]]);
+  const res = await watchChecks({ run: gh.run, pr: "42", intervalMs: 1000, timeoutMs: 600_000, graceMs: 2000, ...clock() });
+  assert.equal(res.code, 3);
+  assert.equal(gh.calls.length, 3);
+});
+
+test("ci-watch waits for GitHub to register checks: the empty grace is time-based, not poll-based (N4)", async () => {
+  const gh = fakeGh([[]]);
+  const res = await watchChecks({ run: gh.run, pr: "42", intervalMs: 5000, timeoutMs: 600_000, graceMs: 180_000, ...clock() });
+  assert.equal(res.code, 3);
+  assert.equal(gh.calls.length, 37); // 180 s Karenz / 5 s Intervall + 1, nicht 3 Polls
+  assert.match(res.summary, /180 s/);
+});
+
+test("ci-watch exits 3 when gh prints broken JSON", async () => {
+  const run = () => ({ code: 0, stdout: "[broken", stderr: "" });
+  const res = await watchChecks({ run, pr: "42", intervalMs: 1000, timeoutMs: 60_000, ...clock() });
+  assert.equal(res.code, 3);
+  assert.match(res.summary, /JSON/);
+});
+
+test("ci-watch exits 3 when gh itself fails", async () => {
+  const gh = fakeGh([new Error("could not find pull request")]);
+  const res = await watchChecks({ run: gh.run, pr: "999", intervalMs: 1000, timeoutMs: 60_000, ...clock() });
+  assert.equal(res.code, 3);
+});
+
+test("ci-watch CLI validates its arguments", async () => {
+  const out = [];
+  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
+  assert.equal(await main([], io), 2);
+  assert.equal(await main(["abc"], io), 2);
+  assert.equal(await main(["--help"], io), 0);
+  assert.match(out.join(""), /ci-watch/);
+});
diff --git a/scripts/lib/dev-cli-wiring.test.mjs b/scripts/lib/dev-cli-wiring.test.mjs
new file mode 100644
index 0000000..d0fe96e
--- /dev/null
+++ b/scripts/lib/dev-cli-wiring.test.mjs
@@ -0,0 +1,27 @@
+// SETUP-B: every `dev:*` helper under scripts/dev/ is reachable through
+// package.json and answers --help as a real process with exit 0.
+import { test } from "node:test";
+import assert from "node:assert/strict";
+import { readFileSync, existsSync } from "node:fs";
+import { join, resolve } from "node:path";
+import { spawnSync } from "node:child_process";
+
+const root = resolve(import.meta.dirname, "../..");
+const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;
+// The SETUP-B tools; other scripts/dev entries (e.g. agent-setup-check) have
+// their own tests and help format.
+const TOOLS = ["report-commit", "push-verified", "prune-worktrees", "build-slot", "ci-watch", "pr-status", "erledigt-row", "spec-close", "hygiene"];
+
+test("package.json wires the scripts/dev helpers", () => {
+  for (const t of TOOLS) assert.equal(scripts[`dev:${t}`], `node scripts/dev/${t}.mjs`, `dev:${t} fehlt in package.json`);
+});
+
+for (const t of TOOLS) {
+  test(`dev:${t} --help runs as a process and exits 0`, () => {
+    const file = `scripts/dev/${t}.mjs`;
+    assert.ok(existsSync(join(root, file)), `${file} fehlt`);
+    const r = spawnSync(process.execPath, [file, "--help"], { cwd: root, encoding: "utf8" });
+    assert.equal(r.status, 0, r.stderr);
+    assert.match(r.stdout, /Exit-Codes/);
+  });
+}
diff --git a/scripts/lib/dev-erledigt-row.test.mjs b/scripts/lib/dev-erledigt-row.test.mjs
new file mode 100644
index 0000000..fd4bbde
--- /dev/null
+++ b/scripts/lib/dev-erledigt-row.test.mjs
@@ -0,0 +1,175 @@
+// SETUP-08b: erledigt-row builds the ERLEDIGT line from gh data (fake gh).
+import { test } from "node:test";
+import assert from "node:assert/strict";
+import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
+import { tmpdir } from "node:os";
+import { join, resolve } from "node:path";
+import { makeRow, insertRow, main } from "../dev/erledigt-row.mjs";
+
+const root = resolve(import.meta.dirname, "../..");
+const PR = {
+  number: 106,
+  title: "feat(api): Windows-ACL-Verifikation der scoped Credentials",
+  state: "MERGED",
+  mergedAt: "2026-09-24T21:30:00Z",
+  mergeCommit: { oid: "2caa3bd0123456789abcdef0123456789abcdef0" },
+  files: [{ path: "src-tauri/src/x.rs" }, { path: ".pa/report_w2-07.md" }, { path: ".pa/review_w2-07_kimi-k3.md" }],
+};
+const cells = (line) => line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/);
+
+test("erledigt-row formats a row like the existing ERLEDIGT rows", () => {
+  const row = makeRow({ pr: PR, id: "W2-07" });
+  assert.equal(
+    row,
+    "| 24.09. | W2-07 | Windows-ACL-Verifikation der scoped Credentials | [#106](https://github.com/Cuarroc/ProjectA/pull/106) | 2caa3bd | .pa/report_w2-07.md |",
+  );
+});
+
+test("erledigt-row drops the package ID and the commit type from the PR title", () => {
+  assert.match(makeRow({ pr: { ...PR, title: "W2-07: Windows-ACL" }, id: "W2-07" }), /\| W2-07 \| Windows-ACL \|/);
+  assert.match(makeRow({ pr: { ...PR, title: "feat(dev): Helfer (SETUP-08a)" }, id: "SETUP-08a" }), /\| SETUP-08a \| Helfer \|/);
+});
+
+test("erledigt-row uses the UTC merge date", () => {
+  const row = makeRow({ pr: { ...PR, mergedAt: "2026-09-24T23:30:00Z" }, id: "X-1" });
+  assert.match(row, /^\| 24\.09\. \|/);
+});
+
+test("erledigt-row escapes pipes and falls back to a dash without report", () => {
+  const row = makeRow({ pr: { ...PR, title: "a | b", files: [] }, id: "X-1" });
+  assert.match(row, /\| a \\\| b \|/);
+  assert.match(row, /\| — \|$/);
+});
+
+test("erledigt-row matches the column count of the real docs/ERLEDIGT.md header", () => {
+  const text = readFileSync(join(root, "docs/ERLEDIGT.md"), "utf8");
+  const header = text.split(/\r?\n/).find((l) => l.startsWith("| Datum |"));
+  assert.ok(header, "Kopfzeile in docs/ERLEDIGT.md");
+  assert.equal(cells(makeRow({ pr: PR, id: "W2-07" })).length, cells(header).length);
+});
+
+test("insertRow puts the row directly under the table header and keeps line endings", () => {
+  const text = "# T\r\n\r\n| Datum | ID | Titel | PR | Merge-SHA | Report |\r\n|---|---|---|---|---|---|\r\n| 23.09. | A | a | [#1](https://github.com/Cuarroc/ProjectA/pull/1) | abc1234 | — |\r\n";
+  const res = insertRow(text, "| 24.09. | B | b | [#2](https://github.com/Cuarroc/ProjectA/pull/2) | def5678 | — |", { prNumber: 2, id: "B" });
+  const lines = res.text.split("\r\n");
+  assert.equal(lines[4], "| 24.09. | B | b | [#2](https://github.com/Cuarroc/ProjectA/pull/2) | def5678 | — |");
+  assert.equal(lines[5].slice(0, 10), "| 23.09. |");
+  assert.equal(res.already, false);
+});
+
+test("insertRow is idempotent for the same PR and ID", () => {
+  const text = "| Datum | ID | Titel | PR | Merge-SHA | Report |\n|---|---|---|---|---|---|\n| 24.09. | B | b | [#2](https://github.com/Cuarroc/ProjectA/pull/2) | def5678 | — |\n";
+  const res = insertRow(text, "| 24.09. | B | b | [#2](https://github.com/Cuarroc/ProjectA/pull/2) | def5678 | — |", { prNumber: 2, id: "B" });
+  assert.equal(res.already, true);
+  assert.equal(res.text, text);
+});
+
+function fakeGh(pr) {
+  return (cmd, args) => (cmd === "gh" && args[0] === "pr" && args[1] === "view" ? { code: 0, stdout: JSON.stringify(pr), stderr: "" } : { code: 1, stdout: "", stderr: "unexpected" });
+}
+
+test("erledigt-row is a dry run by default and writes only with --apply", async (t) => {
+  const dir = mkdtempSync(join(tmpdir(), "dev-erledigt-"));
+  t.after(() => rmSync(dir, { recursive: true, force: true }));
+  const file = join(dir, "ERLEDIGT.md");
+  const before = "| Datum | ID | Titel | PR | Merge-SHA | Report |\n|---|---|---|---|---|---|\n";
+  writeFileSync(file, before);
+  const out = [];
+  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
+  assert.equal(await main(["106", "W2-07", "--file", file], io, { run: fakeGh(PR) }), 0);
+  assert.equal(readFileSync(file, "utf8"), before);
+  assert.match(out.join(""), /Probelauf/);
+  assert.equal(await main(["106", "W2-07", "--file", file, "--apply"], io, { run: fakeGh(PR) }), 0);
+  assert.match(readFileSync(file, "utf8"), /\| W2-07 \|/);
+});
+
+test("erledigt-row refuses a PR that is not merged", async () => {
+  const out = [];
+  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
+  assert.equal(await main(["106", "W2-07", "--file", "unused.md"], io, { run: fakeGh({ ...PR, state: "OPEN", mergedAt: null, mergeCommit: null }) }), 3);
+});
+
+test("erledigt-row validates its arguments", async () => {
+  const out = [];
+  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
+  assert.equal(await main([], io), 2);
+  assert.equal(await main(["x", "W2-07"], io), 2);
+  assert.equal(await main(["--help"], io), 0);
+});
+
+// --- Review SETUP-08b (kimi-k3 #1, #9; glm-5.2 #5, #6) ---
+
+const HEAD2 = "| Datum | ID | Titel | PR | Merge-SHA | Report |\n|---|---|---|---|---|---|\n";
+const ROW = (pr, id) => `| 24.09. | ${id} | t | [#${pr}](https://github.com/Cuarroc/ProjectA/pull/${pr}) | abc1234 | — |`;
+
+test("insertRow is idempotent for a multi-ID row of the same PR (kimi #1)", () => {
+  const text = `${HEAD2}${ROW(150, "W1-05, W1-06")}\n`;
+  const res = insertRow(text, ROW(150, "W1-05"), { prNumber: 150, id: "W1-05" });
+  assert.equal(res.already, true);
+  assert.equal(res.text, text);
+  assert.equal(insertRow(text, ROW(150, "W1-06"), { prNumber: 150, id: "W1-06" }).already, true);
+});
+
+test("insertRow recognises the PR by number even with an older link format (kimi #1)", () => {
+  const text = `${HEAD2}| 24.09. | W1-05 | t | [#150](https://github.com/Cuarroc/ProjectA/pull/150/) | abc1234 | — |\n`;
+  assert.equal(insertRow(text, ROW(150, "W1-05"), { prNumber: 150, id: "W1-05" }).already, true);
+  const plain = `${HEAD2}| 24.09. | w1-05 | t | #150 | abc1234 | — |\n`;
+  assert.equal(insertRow(plain, ROW(150, "W1-05"), { prNumber: 150, id: "W1-05" }).already, true);
+});
+
+test("insertRow still adds a row for another PR, another ID or a longer PR number (kimi #1)", () => {
+  const text = `${HEAD2}${ROW(150, "W1-05, W1-06")}\n`;
+  assert.equal(insertRow(text, ROW(150, "W1-07"), { prNumber: 150, id: "W1-07" }).already, false);
+  assert.equal(insertRow(text, ROW(15, "W1-05"), { prNumber: 15, id: "W1-05" }).already, false);
+  assert.equal(insertRow(text, ROW(1500, "W1-05"), { prNumber: 1500, id: "W1-05" }).already, false);
+});
+
+test("insertRow refuses a file without the ERLEDIGT table (glm #6)", () => {
+  assert.throws(() => insertRow("# nur Text\n", ROW(1, "A"), { prNumber: 1, id: "A" }), /Tabelle/);
+  assert.throws(() => insertRow("| Datum | ID |\nkeine Trennzeile\n", ROW(1, "A"), { prNumber: 1, id: "A" }), /Tabelle/);
+});
+
+async function runMain(argv, pr) {
+  const out = [];
+  const err = [];
+  const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s) }, { run: fakeGh(pr) });
+  return { code, out: out.join(""), err: err.join("") };
+}
+
+test("erledigt-row --apply refuses a missing file and a file without table with exit 3 (glm #6)", async (t) => {
+  const dir = mkdtempSync(join(tmpdir(), "dev-erledigt-"));
+  t.after(() => rmSync(dir, { recursive: true, force: true }));
+  const missing = join(dir, "fehlt.md");
+  assert.equal((await runMain(["106", "W2-07", "--file", missing, "--apply"], PR)).code, 3);
+  const bad = join(dir, "bad.md");
+  writeFileSync(bad, "# nichts\n");
+  assert.equal((await runMain(["106", "W2-07", "--file", bad, "--apply"], PR)).code, 3);
+  assert.equal(readFileSync(bad, "utf8"), "# nichts\n");
+});
+
+test("erledigt-row reports a gh failure as exit 3 (glm #6)", async () => {
+  const run = () => ({ code: 1, stdout: "", stderr: "HTTP 502" });
+  const err = [];
+  const code = await main(["106", "W2-07", "--file", "x.md"], { out: () => {}, err: (s) => err.push(s) }, { run });
+  assert.equal(code, 3);
+  assert.match(err.join(""), /502/);
+});
+
+test("erledigt-row rejects an empty --title instead of silently using the PR title (glm #5)", async () => {
+  assert.equal((await runMain(["106", "W2-07", "--title", ""], PR)).code, 2);
+  assert.equal((await runMain(["106", "W2-07", "--title", "   "], PR)).code, 2);
+  const ok = await runMain(["106", "W2-07", "--title", "Eigener Titel"], PR);
+  assert.equal(ok.code, 0);
+  assert.match(ok.out, /\| Eigener Titel \|/);
+});
+
+test("erledigt-row warns when gh returns 100 files and the report column may be incomplete (kimi #9)", async () => {
+  const files = Array.from({ length: 100 }, (_, i) => ({ path: `src/f${i}.rs` }));
+  const res = await runMain(["106", "W2-07"], { ...PR, files });
+  assert.equal(res.code, 0);
+  assert.match(res.err, /100 Dateien/);
+  assert.match(res.err, /--report/);
+  const explicit = await runMain(["106", "W2-07", "--report", ".pa/report_x.md"], { ...PR, files });
+  assert.equal(explicit.err, "");
+  assert.equal((await runMain(["106", "W2-07"], PR)).err, "");
+});
diff --git a/scripts/lib/dev-hygiene.test.mjs b/scripts/lib/dev-hygiene.test.mjs
new file mode 100644
index 0000000..99493bf
--- /dev/null
+++ b/scripts/lib/dev-hygiene.test.mjs
@@ -0,0 +1,257 @@
+// SETUP-08b: hygiene checks, fed with fixed inputs (no network, no gh).
+import { test } from "node:test";
+import assert from "node:assert/strict";
+import { mkdtempSync, readFileSync, rmSync } from "node:fs";
+import { tmpdir } from "node:os";
+import { join, resolve } from "node:path";
+import { collectHygiene, countFindings, formatHygiene, inProgressPackages, activeSpecIds, gather, main } from "../dev/hygiene.mjs";
+
+const root = resolve(import.meta.dirname, "../..");
+const NOW = Date.parse("2026-09-25T12:00:00Z");
+
+const MASTERPLAN = [
+  "## S0 — in Arbeit",
+  "",
+  "| ID | Titel | Gr. | Status | Abhängig von | Lane / Dateien | Parallel-Gruppe | Modell | Quelle |",
+  "|---|---|---|---|---|---|---|---|---|",
+  "| W2-05 | Discovery | M | in Arbeit PR #107 (eigene Datei) | W2-04 ✓ | st | st/S0 | O·h | P |",
+  "| W1-22 | tauri-plugin-log | S | in Arbeit (Worker läuft, noch kein PR) | W1-15 ✓ | mn | mn/S0 | O·h | P |",
+  "| SETUP-B | Dev-Skripte | 2 × M | in Arbeit | — | scripts/dev | doc/S1 | O·h | Setup |",
+  "| W2-08 | Druck | M | offen | — | fR | fR/S1 | Cx·m | P |",
+  "",
+  "| Neu-ID | Inhalt | Gr. | Lane | Quelle |",
+  "|---|---|---|---|---|",
+  "| W2-01b | Review-Route | S | api | R |",
+  "",
+].join("\n");
+
+const STAND = [
+  "## Aktive Specs",
+  "",
+  "- `.pa/task_devflow.md`: DEVFLOW.",
+  "",
+  "| Spec | Paket | Lane |",
+  "|---|---|---|",
+  "| `.pa/task_w1-05.md` | W1-05b: Queue-Abnahmerest | parallel |",
+  "| `.pa/task_w1-22.md` | W1-22: tauri-plugin-log | seriell |",
+  "",
+  "## Danach",
+].join("\n");
+
+const ERLEDIGT = "| Datum | ID | Titel | PR | Merge-SHA | Report |\n|---|---|---|---|---|---|\n| 24.09. | W1-05 | Doku | [#40](x) | abc | — |\n";
+
+const input = {
+  now: NOW,
+  prsOpen: [
+    { number: 107, title: "W2-05 Discovery", headRefName: "claude/w2-05-discovery", updatedAt: "2026-09-24T01:00:00Z", isDraft: false },
+    { number: 125, title: "SETUP-B", headRefName: "claude/setup-b-dev-scripts", updatedAt: "2026-09-25T11:00:00Z", isDraft: true },
+    { number: 120, title: "merge queue: checking #112", headRefName: "mergify/merge-queue/abc", updatedAt: "2026-09-20T00:00:00Z", isDraft: true },
+  ],
+  prsAll: [
+    { number: 107, headRefName: "claude/w2-05-discovery", state: "OPEN", title: "W2-05" },
+    { number: 125, headRefName: "claude/setup-b-dev-scripts", state: "OPEN", title: "SETUP-B" },
+    { number: 130, headRefName: "claude/w1-22-plugin-log", state: "MERGED", title: "W1-22 tauri-plugin-log" },
+    { number: 40, headRefName: "claude/w1-05-docs", state: "MERGED", title: "W1-05 Doku" },
+  ],
+  remoteBranches: [
+    { name: "main", merged: true },
+    { name: "claude/w2-05-discovery", merged: false },
+    { name: "claude/old-merged", merged: true },
+    { name: "kimi/lost-work", merged: false },
+    { name: "mergify/merge-queue/abc", merged: false },
+  ],
+  standText: STAND,
+  masterplanText: MASTERPLAN,
+  erledigtText: ERLEDIGT,
+  untracked: ["MEMORY.md", "$OUT"],
+};
+
+test("inProgressPackages reads the Status column of every MASTERPLAN table", () => {
+  const rows = inProgressPackages(MASTERPLAN);
+  assert.deepEqual(rows.map((r) => r.id), ["W2-05", "W1-22", "SETUP-B"]);
+  assert.deepEqual(rows[0].prNumbers, [107]);
+});
+
+test("inProgressPackages parses the real docs/MASTERPLAN.md", () => {
+  const rows = inProgressPackages(readFileSync(join(root, "docs/MASTERPLAN.md"), "utf8"));
+  for (const r of rows) {
+    assert.match(r.status, /^in Arbeit/);
+    assert.match(r.id, /^[A-Z]/);
+  }
+});
+
+test("activeSpecIds prefers the package column over the file name", () => {
+  const ids = activeSpecIds(STAND);
+  assert.deepEqual(ids, [
+    { spec: "task_devflow.md", ids: ["devflow"] },
+    { spec: "task_w1-05.md", ids: ["W1-05b"] },
+    { spec: "task_w1-22.md", ids: ["W1-22"] },
+  ]);
+});
+
+test("hygiene finds all five kinds of findings", () => {
+  const f = collectHygiene(input);
+  assert.deepEqual(f.stalePrs.map((p) => p.number), [107]);
+  assert.deepEqual(f.branchesWithoutPr.map((b) => b.name), ["claude/old-merged", "kimi/lost-work"]);
+  assert.deepEqual(f.specsOfMergedPrs.map((s) => [s.spec, s.id, s.pr]), [["task_w1-22.md", "W1-22", 130]]);
+  assert.deepEqual(f.inProgressWithoutPr.map((r) => r.id), ["W1-22"]);
+  assert.deepEqual(f.untracked, ["MEMORY.md", "$OUT"]);
+});
+
+test("hygiene does not match an ID as a prefix of a longer ID", () => {
+  const f = collectHygiene({ ...input, prsAll: [...input.prsAll, { number: 131, headRefName: "claude/w1-05b-cancel", state: "MERGED", title: "W1-05b" }] });
+  assert.deepEqual(f.specsOfMergedPrs.map((s) => s.id).sort(), ["W1-05b", "W1-22"]);
+  const g = collectHygiene({ ...input, prsAll: [...input.prsAll, { number: 132, headRefName: "claude/w1-22b-more", state: "MERGED", title: "W1-22b" }] });
+  assert.deepEqual(g.specsOfMergedPrs.map((s) => s.pr), [130]);
+});
+
+test("hygiene renders markdown with one section per check", () => {
+  const md = formatHygiene(collectHygiene(input));
+  for (const h of ["Offene PRs ohne Aktivität", "Branches ohne PR", "Aktive Specs zu gemergten PRs", "„in Arbeit“ ohne offenen PR", "Ungetrackte Dateien im Hauptcheckout"]) {
+    assert.ok(md.includes(h), h);
+  }
+  assert.match(md, /#107/);
+  assert.match(md, /kimi\/lost-work/);
+});
+
+test("gather reads git and gh read-only and hygiene --strict exits 1 on findings", async () => {
+  const calls = [];
+  const fake = (cmd, args) => {
+    calls.push([cmd, ...args]);
+    const a = args.join(" ");
+    if (cmd === "gh" && a.includes("--state open")) return { code: 0, stdout: JSON.stringify(input.prsOpen), stderr: "" };
+    if (cmd === "gh" && a.includes("--state all")) return { code: 0, stdout: JSON.stringify(input.prsAll), stderr: "" };
+    if (a.includes("worktree list")) return { code: 0, stdout: `worktree ${root}\nHEAD abc\nbranch refs/heads/main\n\n`, stderr: "" };
+    if (a.includes("for-each-ref")) return { code: 0, stdout: "origin/main\norigin/HEAD\norigin/kimi/lost-work\n", stderr: "" };
+    if (a.includes("merge-base")) return { code: 1, stdout: "", stderr: "" };
+    if (a.includes("status")) return { code: 0, stdout: "?? MEMORY.md\n?? $OUT\n M tracked.txt\n", stderr: "" };
+    return { code: 0, stdout: "", stderr: "" };
+  };
+  const data = gather({ run: fake, cwd: root, now: NOW });
+  assert.deepEqual(data.remoteBranches.map((b) => b.name), ["main", "kimi/lost-work"]);
+  assert.deepEqual(data.untracked, ["MEMORY.md", "$OUT"]);
+  for (const c of calls) {
+    const a = c.join(" ");
+    assert.doesNotMatch(a, /\b(push|commit|checkout|reset|merge --|worktree remove|branch -d|pr (create|edit|merge))\b/);
+  }
+  const out = [];
+  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
+  assert.equal(await main(["--no-fetch"], io, { run: fake, now: () => NOW }), 0);
+  assert.equal(await main(["--no-fetch", "--strict"], io, { run: fake, now: () => NOW }), 1);
+  assert.match(out.join(""), /# Hygiene/);
+});
+
+test("hygiene --help exits 0", async () => {
+  const out = [];
+  assert.equal(await main(["--help"], { out: (s) => out.push(s), err: (s) => out.push(s) }), 0);
+  assert.match(out.join(""), /hygiene/);
+});
+
+// --- Review SETUP-08b (glm-5.2 #1, #3, #6; kimi-k3 #2, #3, #5, #6, #7) ---
+
+function fakeRun(over = {}) {
+  return (cmd, args) => {
+    const a = args.join(" ");
+    for (const [needle, res] of Object.entries(over)) if (a.includes(needle)) return typeof res === "function" ? res(cmd, args) : res;
+    if (cmd === "gh" && a.includes("--state open")) return { code: 0, stdout: JSON.stringify(input.prsOpen), stderr: "" };
+    if (cmd === "gh" && a.includes("--state all")) return { code: 0, stdout: JSON.stringify(input.prsAll), stderr: "" };
+    if (a.includes("rev-parse")) return { code: 0, stdout: `${root}\n`, stderr: "" };
+    if (a.includes("worktree list")) return { code: 0, stdout: `worktree ${root}\nHEAD abc\nbranch refs/heads/main\n\n`, stderr: "" };
+    if (a.includes("for-each-ref")) return { code: 0, stdout: "origin/main\n", stderr: "" };
+    if (a.includes("status")) return { code: 0, stdout: "", stderr: "" };
+    return { code: 0, stdout: "", stderr: "" };
+  };
+}
+const collect = (patch) => collectHygiene({ ...input, ...patch });
+
+test("hygiene refuses with exit 3 when git fetch fails and does not report stale data (glm #1)", async () => {
+  const out = [];
+  const err = [];
+  const io = { out: (s) => out.push(s), err: (s) => err.push(s) };
+  const run = fakeRun({ "fetch": { code: 128, stdout: "", stderr: "Could not resolve host" } });
+  assert.equal(await main([], io, { run, now: () => NOW }), 3);
+  assert.equal(out.join(""), "");
+  assert.match(err.join(""), /Could not resolve host/);
+  assert.match(err.join(""), /--no-fetch/);
+  assert.equal(await main(["--no-fetch"], io, { run, now: () => NOW }), 0);
+});
+
+test("hygiene lists untracked files with non-ASCII names unescaped (glm #3, kimi #7)", () => {
+  const calls = [];
+  const run = fakeRun({ status: (cmd, args) => (calls.push(args), { code: 0, stdout: "?? Möbel.md\n", stderr: "" }) });
+  const data = gather({ run, cwd: root, now: NOW });
+  assert.deepEqual(data.untracked, ["Möbel.md"]);
+  assert.ok(calls[0].join(" ").includes("core.quotePath=false"), calls[0].join(" "));
+});
+
+test("MACHINE_BRANCH only excludes the exact machine branches (kimi #5)", () => {
+  const f = collect({
+    remoteBranches: [
+      { name: "maintenance/w3-docs", merged: false },
+      { name: "origin-x/foo", merged: false },
+      { name: "mergify/merge-queue/abc", merged: false },
+      { name: "gh-readonly-queue/main/pr-1", merged: false },
+    ],
+    prsAll: [],
+  });
+  assert.deepEqual(f.branchesWithoutPr.map((b) => b.name), ["maintenance/w3-docs", "origin-x/foo"]);
+  const g = collect({ prsOpen: [{ number: 9, title: "x", headRefName: "maintenance/w3-docs", updatedAt: "2026-09-01T00:00:00Z", isDraft: false }] });
+  assert.deepEqual(g.stalePrs.map((p) => p.number), [9]);
+});
+
+test("hygiene reports missing or unrecognisable inputs as not checked and --strict fails (kimi #2)", () => {
+  const ok = collect({});
+  assert.deepEqual(ok.notChecked, []);
+  const missing = collect({ standText: null, masterplanText: null, erledigtText: null });
+  assert.equal(missing.notChecked.length, 3);
+  assert.match(missing.notChecked.join("\n"), /STAND\.md/);
+  assert.match(missing.notChecked.join("\n"), /MASTERPLAN\.md/);
+  assert.match(missing.notChecked.join("\n"), /ERLEDIGT\.md/);
+  const drifted = collect({ standText: "# ohne Abschnitt\n", masterplanText: "| Foo | Bar |\n|---|---|\n", erledigtText: "keine Tabelle\n" });
+  assert.equal(drifted.notChecked.length, 3);
+  assert.ok(countFindings(missing) >= 3);
+  assert.match(formatHygiene(missing), /Nicht geprüft/);
+});
+
+test("hygiene notChecked stays empty for the real repo files (kimi #2)", () => {
+  const read = (p) => readFileSync(join(root, p), "utf8");
+  const f = collect({ standText: read("STAND.md"), masterplanText: read("docs/MASTERPLAN.md"), erledigtText: read("docs/ERLEDIGT.md") });
+  assert.deepEqual(f.notChecked, []);
+});
+
+test("gather returns null for an input file that does not exist (kimi #2)", () => {
+  const dir = mkdtempSync(join(tmpdir(), "dev-hygiene-"));
+  try {
+    const data = gather({ run: fakeRun({ "rev-parse": { code: 0, stdout: `${dir}\n`, stderr: "" } }), cwd: dir, now: NOW });
+    assert.equal(data.standText, null);
+    assert.equal(data.masterplanText, null);
+    assert.equal(data.erledigtText, null);
+  } finally {
+    rmSync(dir, { recursive: true, force: true });
+  }
+});
+
+test("hygiene names the git error when rev-parse fails instead of using the cwd (kimi #3)", async () => {
+  const err = [];
+  const run = fakeRun({ "rev-parse": { code: 128, stdout: "", stderr: "fatal: not a git repository" } });
+  assert.equal(await main(["--no-fetch"], { out: () => {}, err: (s) => err.push(s) }, { run, now: () => NOW }), 3);
+  assert.match(err.join(""), /not a git repository/);
+});
+
+test("hygiene flags gh lists that hit their limit as possibly incomplete (kimi #6)", () => {
+  const many = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1, title: "t", headRefName: `claude/x${i}`, updatedAt: "2026-09-25T11:00:00Z", isDraft: false, state: "OPEN" }));
+  const run = fakeRun({ "--state open": { code: 0, stdout: JSON.stringify(many(200)), stderr: "" }, "--state all": { code: 0, stdout: JSON.stringify(many(1000)), stderr: "" } });
+  const data = gather({ run, cwd: root, now: NOW });
+  assert.equal(data.limits.length, 2);
+  const f = collectHygiene(data);
+  assert.equal(f.notChecked.filter((n) => /gh/.test(n) && /200|1000/.test(n)).length, 2);
+  const small = gather({ run: fakeRun(), cwd: root, now: NOW });
+  assert.deepEqual(small.limits, []);
+});
+
+test("hygiene reports a gh failure as exit 3 (glm #6)", async () => {
+  const err = [];
+  const run = fakeRun({ "--state open": { code: 1, stdout: "", stderr: "gh: not logged in" } });
+  assert.equal(await main(["--no-fetch"], { out: () => {}, err: (s) => err.push(s) }, { run, now: () => NOW }), 3);
+  assert.match(err.join(""), /not logged in/);
+});
diff --git a/scripts/lib/dev-pr-status.test.mjs b/scripts/lib/dev-pr-status.test.mjs
new file mode 100644
index 0000000..821a4b7
--- /dev/null
+++ b/scripts/lib/dev-pr-status.test.mjs
@@ -0,0 +1,100 @@
+// SETUP-08b: pr-status turns `gh pr list` JSON into a compact table (fake gh).
+import { test } from "node:test";
+import assert from "node:assert/strict";
+import { readFileSync } from "node:fs";
+import { join, resolve } from "node:path";
+import { REQUIRED, buildRows, checkState, formatTable, main } from "../dev/pr-status.mjs";
+
+const repoRoot = resolve(import.meta.dirname, "../..");
+
+const run = (name, conclusion, status = "COMPLETED", startedAt = "2026-09-24T10:00:00Z") => ({ __typename: "CheckRun", name, status, conclusion, startedAt });
+const green = [run("gates (linux)", "SUCCESS"), run("gates (windows)", "SUCCESS"), run("red-first", "SUCCESS")];
+const PRS = [
+  { number: 120, title: "merge queue: checking #112 on main (a2b2041)", headRefName: "mergify/merge-queue/143c", isDraft: true, labels: [], mergeStateStatus: "BLOCKED", statusCheckRollup: [], updatedAt: "2026-09-24T19:00:00Z" },
+  { number: 112, title: "feat: a", headRefName: "claude/a", isDraft: false, labels: [], mergeStateStatus: "CLEAN", statusCheckRollup: green, updatedAt: "2026-09-24T19:00:00Z" },
+  { number: 119, title: "docs: b", headRefName: "claude/b", isDraft: false, labels: [{ name: "do-not-merge" }], mergeStateStatus: "CLEAN", statusCheckRollup: green, updatedAt: "2026-09-24T19:00:00Z" },
+  { number: 121, title: "wip", headRefName: "claude/c", isDraft: true, labels: [], mergeStateStatus: "DRAFT", statusCheckRollup: [], updatedAt: "2026-09-24T19:00:00Z" },
+  { number: 122, title: "rot", headRefName: "claude/d", isDraft: false, labels: [], mergeStateStatus: "BLOCKED", statusCheckRollup: [run("gates (linux)", "FAILURE"), run("gates (windows)", "", "IN_PROGRESS"), run("red-first", "SUCCESS")], updatedAt: "2026-09-24T19:00:00Z" },
+  { number: 123, title: "konflikt", headRefName: "claude/e", isDraft: false, labels: [{ name: "conflict" }], mergeStateStatus: "DIRTY", statusCheckRollup: green, updatedAt: "2026-09-24T19:00:00Z" },
+  { number: 124, title: "grün", headRefName: "claude/f", isDraft: false, labels: [], mergeStateStatus: "CLEAN", statusCheckRollup: green, updatedAt: "2026-09-24T19:00:00Z" },
+];
+
+test("checkState reads the newest run of a required check", () => {
+  const rollup = [run("red-first", "FAILURE", "COMPLETED", "2026-09-24T09:00:00Z"), run("red-first", "SUCCESS", "COMPLETED", "2026-09-24T10:00:00Z")];
+  assert.equal(checkState(rollup, "red-first"), "ok");
+  assert.equal(checkState([run("red-first", "", "IN_PROGRESS")], "red-first"), "läuft");
+  assert.equal(checkState([run("red-first", "SKIPPED")], "red-first"), "übersprungen");
+  assert.equal(checkState([{ __typename: "StatusContext", context: "red-first", state: "FAILURE" }], "red-first"), "rot");
+  assert.equal(checkState([], "red-first"), "—");
+});
+
+test("pr-status derives the queue state from Mergify labels draft and checks", () => {
+  const rows = buildRows(PRS);
+  const q = Object.fromEntries(rows.map((r) => [r.number, r.queue]));
+  assert.equal(rows.some((r) => r.number === 120), false, "Mergify-Queue-PR selbst ist keine Zeile");
+  assert.equal(q[112], "in Queue");
+  assert.equal(q[119], "gesperrt (do-not-merge)");
+  assert.equal(q[121], "Draft (keine CI)");
+  assert.equal(q[122], "rot");
+  assert.equal(q[123], "Konflikt");
+  assert.equal(q[124], "bereit");
+  const r122 = rows.find((r) => r.number === 122);
+  assert.deepEqual(r122.checks, { linux: "rot", windows: "läuft", redFirst: "ok" });
+});
+
+test("pr-status prints a markdown table with one row per PR", () => {
+  const table = formatTable(buildRows(PRS));
+  const lines = table.trim().split("\n");
+  assert.match(lines[0], /^\| # \| Branch \|/);
+  assert.equal(lines.filter((l) => /^\| #\d+ /.test(l)).length, 6);
+  assert.match(table, /\| #119 \| claude\/b \|.*do-not-merge/);
+});
+
+test("pr-status CLI calls gh pr list once and exits 0", async () => {
+  const calls = [];
+  const fake = (cmd, args) => {
+    calls.push([cmd, ...args]);
+    return { code: 0, stdout: JSON.stringify(PRS), stderr: "" };
+  };
+  const out = [];
+  const code = await main([], { out: (s) => out.push(s), err: (s) => out.push(s) }, { run: fake });
+  assert.equal(code, 0);
+  assert.equal(calls.length, 1);
+  assert.deepEqual(calls[0].slice(0, 5), ["gh", "pr", "list", "--state", "open"]);
+  assert.match(out.join(""), /#124/);
+});
+
+test("pr-status CLI exits 3 when gh fails", async () => {
+  const fake = () => ({ code: 4, stdout: "", stderr: "gh auth login" });
+  const code = await main([], { out: () => {}, err: () => {} }, { run: fake });
+  assert.equal(code, 3);
+});
+
+test("pr-status --help exits 0", async () => {
+  const out = [];
+  assert.equal(await main(["--help"], { out: (s) => out.push(s), err: (s) => out.push(s) }), 0);
+  assert.match(out.join(""), /pr-status/);
+});
+
+// --- Review SETUP-08b (glm-5.2 #2, kimi-k3 #6) ---
+
+test("REQUIRED lists exactly the checks Mergify requires and the jobs ci.yml defines (glm #2)", () => {
+  const mergify = readFileSync(join(repoRoot, ".mergify.yml"), "utf8");
+  const ci = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
+  const required = [...new Set([...mergify.matchAll(/check-success = (.+)$/gm)].map((m) => m[1].trim()))].sort();
+  assert.deepEqual(REQUIRED.map(([, name]) => name).sort(), required);
+  for (const [, name] of REQUIRED) assert.match(ci, new RegExp(`^\\s+name: ${name.replace(/[()]/g, "\\$&")}\\s*$`, "m"), `ci.yml job "${name}"`);
+});
+
+test("pr-status warns when gh returns as many PRs as the limit (kimi #6)", async () => {
+  const many = Array.from({ length: 200 }, (_, i) => ({ number: i + 1, title: "t", headRefName: `claude/x${i}`, isDraft: true, labels: [], mergeStateStatus: "DRAFT", statusCheckRollup: [], updatedAt: "2026-09-24T19:00:00Z" }));
+  const fake = () => ({ code: 0, stdout: JSON.stringify(many), stderr: "" });
+  const err = [];
+  assert.equal(await main([], { out: () => {}, err: (s) => err.push(s) }, { run: fake }), 0);
+  assert.match(err.join(""), /200/);
+  assert.match(err.join(""), /unvollst/);
+  const few = [];
+  const fakeFew = () => ({ code: 0, stdout: JSON.stringify(PRS), stderr: "" });
+  await main([], { out: () => {}, err: (s) => few.push(s) }, { run: fakeFew });
+  assert.equal(few.join(""), "");
+});
diff --git a/scripts/lib/dev-prune-worktrees.test.mjs b/scripts/lib/dev-prune-worktrees.test.mjs
new file mode 100644
index 0000000..7b4d1d8
--- /dev/null
+++ b/scripts/lib/dev-prune-worktrees.test.mjs
@@ -0,0 +1,258 @@
+// SETUP-08a: prune-worktrees against a real repository with linked worktrees
+// in tmp and a fake `gh` (no network).
+import { test } from "node:test";
+import assert from "node:assert/strict";
+import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync } from "node:fs";
+import { tmpdir } from "node:os";
+import { join } from "node:path";
+import { makeRunner } from "./dev-tools.mjs";
+import { parseWorktreeList, planPrune, applyPrune, main } from "../dev/prune-worktrees.mjs";
+
+const real = makeRunner();
+
+function setup(t) {
+  const base = realpathSync(mkdtempSync(join(tmpdir(), "dev-prune-")));
+  t.after(() => {
+    real("git", ["-C", join(base, "main"), "worktree", "prune"]);
+    rmSync(base, { recursive: true, force: true });
+  });
+  const remote = join(base, "remote.git");
+  const dir = join(base, "main");
+  const git = (cwd, ...args) => {
+    const r = real("git", ["-C", cwd, ...args]);
+    assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.stderr}`);
+    return r.stdout.trim();
+  };
+  git(base, "init", "-q", "--bare", remote);
+  git(base, "init", "-q", "-b", "main", dir);
+  git(dir, "config", "user.name", "test");
+  git(dir, "config", "user.email", "test@example.invalid");
+  git(dir, "remote", "add", "origin", remote);
+  writeFileSync(join(dir, ".git/info/exclude"), ".claude/\n");
+  writeFileSync(join(dir, "a.txt"), "a\n");
+  git(dir, "add", "a.txt");
+  git(dir, "commit", "-qm", "a");
+  git(dir, "push", "-q", "origin", "main");
+
+  const wt = (rel, branch) => {
+    const path = join(base, rel);
+    git(dir, "worktree", "add", "-q", "-b", branch, path, "main");
+    return path;
+  };
+  const commitIn = (path, name) => {
+    writeFileSync(join(path, name), name + "\n");
+    git(path, "add", name);
+    git(path, "commit", "-qm", name);
+  };
+  const mergeToMain = (branch) => {
+    git(dir, "merge", "-q", "--no-ff", "--no-edit", branch);
+    git(dir, "push", "-q", "origin", "main");
+  };
+
+  const p = {};
+  p.merged = wt("main/.claude/worktrees/merged", "claude/merged");
+  commitIn(p.merged, "m.txt");
+  git(p.merged, "push", "-q", "origin", "claude/merged");
+  mergeToMain("claude/merged");
+
+  p.dirty = wt("main/.claude/worktrees/dirty", "claude/dirty");
+  commitIn(p.dirty, "d.txt");
+  git(p.dirty, "push", "-q", "origin", "claude/dirty");
+  mergeToMain("claude/dirty");
+  writeFileSync(join(p.dirty, "d.txt"), "local edit\n");
+
+  p.squashed = wt("main/.claude/worktrees/squashed", "claude/squashed");
+  commitIn(p.squashed, "s.txt");
+  git(p.squashed, "push", "-q", "origin", "claude/squashed");
+
+  p.unpushed = wt("main/.claude/worktrees/unpushed", "claude/unpushed");
+  commitIn(p.unpushed, "u.txt");
+
+  p.open = wt("main/.claude/worktrees/open", "claude/open");
+  commitIn(p.open, "o.txt");
+  git(p.open, "push", "-q", "origin", "claude/open");
+
+  p.codex = wt("elsewhere/codex-x", "codex/x");
+  commitIn(p.codex, "c.txt");
+  git(p.codex, "push", "-q", "origin", "codex/x");
+  mergeToMain("codex/x");
+
+  p.other = wt("elsewhere/app-worker", "pa/wk-1");
+
+  git(dir, "fetch", "-q", "origin");
+  const prs = [
+    { number: 5, headRefName: "claude/squashed", state: "MERGED", updatedAt: "2026-09-24T10:00:00Z" },
+    { number: 6, headRefName: "claude/unpushed", state: "CLOSED", updatedAt: "2026-09-24T10:00:00Z" },
+    { number: 7, headRefName: "claude/open", state: "OPEN", updatedAt: "2026-09-24T10:00:00Z" },
+  ];
+  const run = (cmd, args, opts) => {
+    if (cmd === "gh") return { code: 0, stdout: JSON.stringify(prs), stderr: "" };
+    return real(cmd, args, opts);
+  };
+  return { base, dir, p, run };
+}
+
+const byPath = (plan, path) =>
+  plan.entries.find((e) => e.path.toLowerCase().replace(/\\/g, "/") === path.toLowerCase().replace(/\\/g, "/"));
+
+test("parseWorktreeList reads branch, detached and locked entries", () => {
+  const list = parseWorktreeList(
+    "worktree C:/r\nHEAD aaa\nbranch refs/heads/main\n\nworktree C:/r/.claude/worktrees/x\nHEAD bbb\ndetached\nlocked busy\n\n",
+  );
+  assert.equal(list.length, 2);
+  assert.equal(list[0].branch, "main");
+  assert.equal(list[1].detached, true);
+  assert.equal(list[1].locked, true);
+});
+
+test("prune-worktrees plans merged and closed worktrees and protects dirty and unpushed ones", (t) => {
+  const f = setup(t);
+  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 0 });
+  assert.equal(byPath(plan, f.p.merged).action, "remove");
+  assert.equal(byPath(plan, f.p.squashed).action, "remove");
+  assert.match(byPath(plan, f.p.squashed).reason, /MERGED/);
+  assert.equal(byPath(plan, f.p.codex).action, "remove");
+  assert.equal(byPath(plan, f.p.dirty).action, "keep");
+  assert.match(byPath(plan, f.p.dirty).reason, /uncommitt/i);
+  assert.equal(byPath(plan, f.p.unpushed).action, "keep");
+  assert.match(byPath(plan, f.p.unpushed).reason, /ungepusht/i);
+  assert.equal(byPath(plan, f.p.open), undefined);
+  assert.equal(byPath(plan, f.p.other), undefined);
+  assert.equal(byPath(plan, f.dir), undefined);
+});
+
+test("prune-worktrees keeps worktrees that were active recently", (t) => {
+  const f = setup(t);
+  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 3_600_000 });
+  assert.equal(byPath(plan, f.p.merged).action, "keep");
+  assert.match(byPath(plan, f.p.merged).reason, /aktiv/);
+});
+
+test("prune-worktrees is a dry run by default and --apply removes only the planned ones", async (t) => {
+  const f = setup(t);
+  const out = [];
+  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
+  assert.equal(await main(["--repo", f.dir, "--min-idle", "0s"], io, { run: f.run }), 0);
+  assert.ok(existsSync(f.p.merged));
+  assert.match(out.join(""), /Probelauf/);
+
+  assert.equal(await main(["--repo", f.dir, "--min-idle", "0s", "--apply"], io, { run: f.run }), 0);
+  assert.ok(!existsSync(f.p.merged));
+  assert.ok(!existsSync(f.p.squashed));
+  assert.ok(!existsSync(f.p.codex));
+  assert.ok(existsSync(f.p.dirty));
+  assert.ok(existsSync(f.p.unpushed));
+  assert.ok(existsSync(f.p.open));
+});
+
+test("applyPrune never forces a removal", (t) => {
+  const f = setup(t);
+  const seen = [];
+  const run = (cmd, args, opts) => {
+    if (cmd === "git" && args.includes("remove")) seen.push(args);
+    return f.run(cmd, args, opts);
+  };
+  const plan = planPrune({ run, cwd: f.dir, minIdleMs: 0 });
+  applyPrune(plan, { run, cwd: f.dir });
+  assert.ok(seen.length > 0);
+  for (const args of seen) assert.ok(!args.includes("--force") && !args.includes("-f"));
+});
+
+test("prune-worktrees works without gh (merged-into-main only)", (t) => {
+  const f = setup(t);
+  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 0, useGh: false });
+  assert.equal(byPath(plan, f.p.merged).action, "remove");
+  assert.equal(byPath(plan, f.p.squashed), undefined);
+});
+
+test("prune-worktrees --help exits 0", async () => {
+  const out = [];
+  assert.equal(await main(["--help"], { out: (s) => out.push(s), err: (s) => out.push(s) }), 0);
+  assert.match(out.join(""), /prune-worktrees/);
+});
+
+test("prune-worktrees keeps a finished worktree that holds ignored files beyond build artifacts (M2)", (t) => {
+  const f = setup(t);
+  writeFileSync(join(f.dir, ".git/info/exclude"), ".claude/\n.env\n");
+  writeFileSync(join(f.p.merged, ".env"), "SECRET=1\n");
+  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 0 });
+  const e = byPath(plan, f.p.merged);
+  assert.equal(e.action, "keep");
+  assert.match(e.reason, /ignorierte ungesicherte Dateien/);
+  assert.match(e.reason, /\.env/);
+});
+
+test("prune-worktrees removes a worktree whose only ignored files are build artifacts", (t) => {
+  const f = setup(t);
+  writeFileSync(join(f.dir, ".git/info/exclude"), ".claude/\nnode_modules/\nsrc-tauri/target\n");
+  mkdirSync(join(f.p.merged, "node_modules/pkg"), { recursive: true });
+  mkdirSync(join(f.p.merged, "src-tauri/target/debug"), { recursive: true });
+  writeFileSync(join(f.p.merged, "node_modules/pkg/x"), "junk");
+  writeFileSync(join(f.p.merged, "src-tauri/target/debug/.cargo-lock"), "lock");
+  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 0 });
+  assert.equal(byPath(plan, f.p.merged).action, "remove");
+});
+
+test("prune-worktrees removes worktrees with a stash: refs/stash is shared, not per-worktree (M1 widerlegt)", (t) => {
+  const f = setup(t);
+  writeFileSync(join(f.p.merged, "m.txt"), "local edit\n");
+  assert.equal(f.run("git", ["-C", f.p.merged, "stash", "-q"]).code, 0);
+  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 0 });
+  assert.equal(byPath(plan, f.p.merged).action, "remove");
+  applyPrune(plan, { run: f.run, cwd: f.dir });
+  assert.ok(!existsSync(f.p.merged));
+  const list = real("git", ["-C", f.dir, "stash", "list"]);
+  assert.equal(list.code, 0);
+  assert.match(list.stdout, /WIP on claude\/merged/);
+});
+
+test("prune-worktrees keeps a really locked worktree (git worktree lock)", (t) => {
+  const f = setup(t);
+  assert.equal(real("git", ["-C", f.dir, "worktree", "lock", "--reason", "agent laeuft", f.p.merged]).code, 0);
+  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 0 });
+  const e = byPath(plan, f.p.merged);
+  assert.equal(e.action, "keep");
+  assert.match(e.reason, /gesperrt/);
+});
+
+test("prune-worktrees removes a detached worktree parked at a merged commit", (t) => {
+  const f = setup(t);
+  const det = join(f.base, "main/.claude/worktrees/detached");
+  assert.equal(real("git", ["-C", f.dir, "worktree", "add", "--detach", "-q", det, "main"]).code, 0);
+  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 0 });
+  assert.equal(byPath(plan, det).action, "remove");
+});
+
+test("prune-worktrees never removes the worktree it runs in", (t) => {
+  const f = setup(t);
+  const plan = planPrune({ run: f.run, cwd: f.p.merged, minIdleMs: 0 });
+  const e = byPath(plan, f.p.merged);
+  assert.equal(e.action, "keep");
+  assert.match(e.reason, /aktuelle Verzeichnis/);
+});
+
+test("prune-worktrees reports a worktree whose directory is gone as prunable", (t) => {
+  const f = setup(t);
+  rmSync(f.p.merged, { recursive: true, force: true });
+  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 0 });
+  const e = byPath(plan, f.p.merged);
+  assert.equal(e.action, "keep");
+  assert.match(e.reason, /Verzeichnis fehlt/);
+});
+
+test("prune-worktrees keeps a freshly checked-out worktree that made no commit (Reflog-Aktivitaet, G1 widerlegt)", (t) => {
+  const f = setup(t);
+  const wt = join(f.base, "main/.claude/worktrees/fresh");
+  assert.equal(real("git", ["-C", f.dir, "worktree", "add", "-q", "-b", "claude/fresh", wt, "main"]).code, 0);
+  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 3_600_000 });
+  const e = byPath(plan, wt);
+  assert.equal(e.action, "keep");
+  assert.match(e.reason, /aktiv/);
+});
+
+test("makeNorm is injectable and normalizes case only on win32 (N6)", async () => {
+  const mod = await import("../dev/prune-worktrees.mjs");
+  assert.equal(typeof mod.makeNorm, "function");
+  assert.equal(mod.makeNorm("win32")("C:\\Repo\\.Claude\\Worktrees\\X"), mod.makeNorm("win32")("c:/repo/.claude/worktrees/x"));
+  assert.notEqual(mod.makeNorm("linux")("/Repo/X"), mod.makeNorm("linux")("/repo/x"));
+});
diff --git a/scripts/lib/dev-push-verified.test.mjs b/scripts/lib/dev-push-verified.test.mjs
new file mode 100644
index 0000000..bf3616b
--- /dev/null
+++ b/scripts/lib/dev-push-verified.test.mjs
@@ -0,0 +1,142 @@
+// SETUP-08a: push-verified against a bare remote in tmp; the push result is
+// judged by ls-remote, never by the exit code of `git push`.
+import { test } from "node:test";
+import assert from "node:assert/strict";
+import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
+import { tmpdir } from "node:os";
+import { join } from "node:path";
+import { makeRunner, UsageError } from "./dev-tools.mjs";
+import { pushVerified, main } from "../dev/push-verified.mjs";
+
+const real = makeRunner();
+
+function setup(t) {
+  const base = mkdtempSync(join(tmpdir(), "dev-push-verified-"));
+  t.after(() => rmSync(base, { recursive: true, force: true }));
+  const remote = join(base, "remote.git");
+  const dir = join(base, "work");
+  const sh = (cwd, ...args) => {
+    const r = real("git", ["-C", cwd, ...args]);
+    assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.stderr}`);
+    return r.stdout.trim();
+  };
+  sh(base, "init", "-q", "--bare", remote);
+  sh(base, "init", "-q", "-b", "main", dir);
+  sh(dir, "config", "user.name", "test");
+  sh(dir, "config", "user.email", "test@example.invalid");
+  sh(dir, "remote", "add", "origin", remote);
+  writeFileSync(join(dir, "a.txt"), "a\n");
+  sh(dir, "add", "a.txt");
+  sh(dir, "commit", "-qm", "a");
+  sh(dir, "checkout", "-qb", "feature");
+  return { dir, remote, git: (...a) => sh(dir, ...a) };
+}
+
+const noSleep = async () => {};
+
+test("push-verified pushes and confirms the remote SHA", async (t) => {
+  const f = setup(t);
+  const res = await pushVerified({ run: real, cwd: f.dir, sleep: noSleep });
+  assert.equal(res.ok, true);
+  assert.equal(res.attempts, 1);
+  assert.equal(res.remoteSha, f.git("rev-parse", "HEAD"));
+});
+
+test("push-verified trusts ls-remote over a failing push exit code", async (t) => {
+  const f = setup(t);
+  const run = (cmd, args, opts) => {
+    const r = real(cmd, args, opts);
+    return args.includes("push") ? { ...r, code: 1, stderr: "error: spurious" } : r;
+  };
+  const res = await pushVerified({ run, cwd: f.dir, sleep: noSleep });
+  assert.equal(res.ok, true);
+});
+
+test("push-verified retries a bounded number of times when the remote does not move", async (t) => {
+  const f = setup(t);
+  let pushes = 0;
+  const run = (cmd, args, opts) => {
+    if (args.includes("push")) {
+      pushes++;
+      return { code: 0, stdout: "", stderr: "" };
+    }
+    return real(cmd, args, opts);
+  };
+  const res = await pushVerified({ run, cwd: f.dir, retries: 3, sleep: noSleep });
+  assert.equal(res.ok, false);
+  assert.equal(pushes, 3);
+});
+
+test("push-verified stops at once on a rejected push", async (t) => {
+  const f = setup(t);
+  let pushes = 0;
+  const run = (cmd, args, opts) => {
+    if (args.includes("push")) {
+      pushes++;
+      return { code: 1, stdout: "", stderr: " ! [rejected]        HEAD -> feature (non-fast-forward)\n" };
+    }
+    return real(cmd, args, opts);
+  };
+  const res = await pushVerified({ run, cwd: f.dir, retries: 3, sleep: noSleep });
+  assert.equal(res.ok, false);
+  assert.equal(pushes, 1);
+  assert.match(res.reason, /rejected/);
+});
+
+test("push-verified never passes --no-verify or --force", async (t) => {
+  const f = setup(t);
+  const seen = [];
+  const run = (cmd, args, opts) => {
+    if (args.includes("push")) seen.push(args);
+    return real(cmd, args, opts);
+  };
+  await pushVerified({ run, cwd: f.dir, sleep: noSleep });
+  for (const args of seen) {
+    assert.ok(!args.includes("--no-verify"));
+    assert.ok(!args.some((a) => a.startsWith("--force") || a === "-f"));
+  }
+});
+
+test("push-verified CLI exits 1 when the push is not on the remote", async (t) => {
+  const f = setup(t);
+  const run = (cmd, args, opts) => (args.includes("push") ? { code: 0, stdout: "", stderr: "" } : real(cmd, args, opts));
+  const out = [];
+  const code = await main(["--worktree", f.dir, "--retries", "1"], { out: (s) => out.push(s), err: (s) => out.push(s) }, { run, sleep: noSleep });
+  assert.equal(code, 1);
+});
+
+test("push-verified --help exits 0", async () => {
+  const out = [];
+  const code = await main(["--help"], { out: (s) => out.push(s), err: (s) => out.push(s) });
+  assert.equal(code, 0);
+  assert.match(out.join(""), /push-verified/);
+});
+
+test("push-verified demands --branch on a detached HEAD instead of crashing (G2)", async (t) => {
+  const f = setup(t);
+  f.git("checkout", "-q", "--detach");
+  assert.throws(() => pushVerified({ run: real, cwd: f.dir, sleep: noSleep }), UsageError);
+});
+
+test("push-verified rejects an invalid branch name before any push (check-ref-format)", async (t) => {
+  const f = setup(t);
+  const pushes = [];
+  const run = (cmd, args, opts) => {
+    if (cmd === "git" && args.includes("push")) pushes.push(args);
+    return real(cmd, args, opts);
+  };
+  assert.throws(() => pushVerified({ run, cwd: f.dir, branch: "..evil", sleep: noSleep }), UsageError);
+  assert.throws(() => pushVerified({ run, cwd: f.dir, branch: "feature.lock", sleep: noSleep }), UsageError);
+  assert.equal(pushes.length, 0);
+});
+
+test("push-verified reports an ls-remote failure instead of proving anything", async (t) => {
+  const f = setup(t);
+  const run = (cmd, args, opts) => {
+    if (args.includes("ls-remote")) return { code: 128, stdout: "", stderr: "fatal: could not read from remote repository" };
+    return real(cmd, args, opts);
+  };
+  const res = await pushVerified({ run, cwd: f.dir, retries: 2, sleep: noSleep });
+  assert.equal(res.ok, false);
+  assert.match(res.reason, /ls-remote/);
+});
diff --git a/scripts/lib/dev-report-commit.test.mjs b/scripts/lib/dev-report-commit.test.mjs
new file mode 100644
index 0000000..8ef8d66
--- /dev/null
+++ b/scripts/lib/dev-report-commit.test.mjs
@@ -0,0 +1,208 @@
+// SETUP-08a: report-commit against throwaway git repositories in tmp.
+import { test } from "node:test";
+import assert from "node:assert/strict";
+import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from "node:fs";
+import { tmpdir } from "node:os";
+import { join } from "node:path";
+import { makeRunner, UsageError, RefusedError } from "./dev-tools.mjs";
+import { reportCommit, main } from "../dev/report-commit.mjs";
+
+const run = makeRunner();
+
+function repo(t) {
+  const dir = mkdtempSync(join(tmpdir(), "dev-report-commit-"));
+  t.after(() => rmSync(dir, { recursive: true, force: true }));
+  const git = (...args) => {
+    const r = run("git", ["-C", dir, ...args]);
+    assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.stdout}${r.stderr}`);
+    return r.stdout.trim();
+  };
+  git("init", "-q", "-b", "main");
+  git("config", "user.name", "test");
+  git("config", "user.email", "test@example.invalid");
+  git("config", "core.autocrlf", "false");
+  mkdirSync(join(dir, "docs/dev-hq"), { recursive: true });
+  mkdirSync(join(dir, ".pa"));
+  writeFileSync(join(dir, "docs/dev-hq/data.json"), '{"v":1}\n');
+  writeFileSync(join(dir, "docs/dev-hq/data.js"), "window.HQ_DATA = {};\n");
+  writeFileSync(join(dir, "STAND.md"), "stand\n");
+  git("add", ".");
+  git("commit", "-qm", "base");
+  const report = join(dir, "..", `${dir.split(/[\\/]/).pop()}-report.md`);
+  writeFileSync(report, "# Report X-1\n\nInhalt\n");
+  t.after(() => rmSync(report, { force: true }));
+  return { dir, git, report };
+}
+
+// Simulates the real post-merge hook: after a merge the HQ snapshot is
+// regenerated in the working tree, unstaged.
+function installRegeneratingHook(dir, git) {
+  mkdirSync(join(dir, ".hooks"));
+  const hook = join(dir, ".hooks/post-merge");
+  writeFileSync(hook, '#!/bin/sh\necho \'{"v":"regenerated"}\' > docs/dev-hq/data.json\n');
+  chmodSync(hook, 0o755);
+  git("config", "core.hooksPath", ".hooks");
+  writeFileSync(join(dir, ".git/info/exclude"), ".hooks/\n");
+}
+
+function topicMerge(dir, git) {
+  git("checkout", "-qb", "topic");
+  writeFileSync(join(dir, "feature.txt"), "x\n");
+  git("add", "feature.txt");
+  git("commit", "-qm", "topic");
+  git("checkout", "-q", "main");
+}
+
+test("report-commit copies the report and commits it with No-Test and Co-Authored-By", (t) => {
+  const f = repo(t);
+  const res = reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>" });
+  assert.equal(readFileSync(join(f.dir, ".pa/report_x-1.md"), "utf8"), "# Report X-1\n\nInhalt\n");
+  const msg = f.git("log", "-1", "--format=%B");
+  assert.match(msg, /^docs\(pa\): x-1 Bericht/);
+  assert.match(msg, /^No-Test: /m);
+  assert.match(msg, /^Co-Authored-By: Tester <t@example\.invalid>$/m);
+  assert.equal(f.git("show", "--name-only", "--format=", "HEAD"), ".pa/report_x-1.md");
+  assert.equal(f.git("status", "--porcelain"), "");
+  assert.equal(res.commit, f.git("rev-parse", "HEAD"));
+});
+
+test("report-commit resets HQ data that only a merge changed", (t) => {
+  const f = repo(t);
+  installRegeneratingHook(f.dir, f.git);
+  topicMerge(f.dir, f.git);
+  f.git("merge", "-q", "--no-ff", "--no-edit", "topic");
+  assert.match(f.git("status", "--porcelain"), /docs\/dev-hq\/data\.json/);
+  const res = reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>" });
+  assert.deepEqual(res.reset, ["docs/dev-hq/data.json"]);
+  assert.equal(f.git("status", "--porcelain"), "");
+  assert.equal(f.git("show", "--name-only", "--format=", "HEAD"), ".pa/report_x-1.md");
+});
+
+test("report-commit --merge merges the ref first and then resets the regenerated HQ data", (t) => {
+  const f = repo(t);
+  installRegeneratingHook(f.dir, f.git);
+  topicMerge(f.dir, f.git);
+  reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>", merge: "topic" });
+  assert.ok(existsSync(join(f.dir, "feature.txt")));
+  assert.equal(f.git("status", "--porcelain"), "");
+  assert.equal(readFileSync(join(f.dir, "docs/dev-hq/data.json"), "utf8"), '{"v":1}\n');
+});
+
+test("report-commit refuses when HQ data is dirty next to other local edits", (t) => {
+  const f = repo(t);
+  const head = f.git("rev-parse", "HEAD");
+  writeFileSync(join(f.dir, "docs/dev-hq/data.json"), '{"v":"local"}\n');
+  writeFileSync(join(f.dir, "STAND.md"), "lokal geaendert\n");
+  assert.throws(
+    () => reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>" }),
+    RefusedError,
+  );
+  assert.equal(f.git("rev-parse", "HEAD"), head);
+  assert.equal(readFileSync(join(f.dir, "docs/dev-hq/data.json"), "utf8"), '{"v":"local"}\n');
+});
+
+test("report-commit refuses when something else is already staged", (t) => {
+  const f = repo(t);
+  writeFileSync(join(f.dir, "other.txt"), "x\n");
+  f.git("add", "other.txt");
+  assert.throws(
+    () => reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>" }),
+    RefusedError,
+  );
+});
+
+test("report-commit needs a co-author and a safe id", (t) => {
+  const f = repo(t);
+  assert.throws(() => reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "" }), UsageError);
+  assert.throws(
+    () => reportCommit({ run, cwd: f.dir, id: "../evil", from: f.report, coAuthor: "Tester <t@example.invalid>" }),
+    UsageError,
+  );
+});
+
+test("report-commit --dry-run changes nothing", async (t) => {
+  const f = repo(t);
+  const head = f.git("rev-parse", "HEAD");
+  const out = [];
+  const code = await main(
+    ["--worktree", f.dir, "--id", "x-1", "--from", f.report, "--co-author", "Tester <t@example.invalid>", "--dry-run"],
+    { out: (s) => out.push(s), err: (s) => out.push(s) },
+  );
+  assert.equal(code, 0);
+  assert.equal(f.git("rev-parse", "HEAD"), head);
+  assert.ok(!existsSync(join(f.dir, ".pa/report_x-1.md")));
+  assert.match(out.join(""), /Probelauf/);
+});
+
+test("report-commit --help exits 0", async () => {
+  const out = [];
+  const code = await main(["--help"], { out: (s) => out.push(s), err: (s) => out.push(s) });
+  assert.equal(code, 0);
+  assert.match(out.join(""), /report-commit/);
+});
+
+test("report-commit --merge refuses BEFORE merging when untracked files lie around (M4)", (t) => {
+  const f = repo(t);
+  installRegeneratingHook(f.dir, f.git);
+  topicMerge(f.dir, f.git);
+  const head = f.git("rev-parse", "HEAD");
+  writeFileSync(join(f.dir, "untracked.txt"), "lokal\n");
+  assert.throws(
+    () => reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>", merge: "topic" }),
+    RefusedError,
+  );
+  assert.equal(f.git("rev-parse", "HEAD"), head);
+  assert.ok(!existsSync(join(f.dir, "feature.txt")));
+});
+
+test("report-commit backs up HQ data before resetting it (N1)", (t) => {
+  const f = repo(t);
+  installRegeneratingHook(f.dir, f.git);
+  topicMerge(f.dir, f.git);
+  f.git("merge", "-q", "--no-ff", "--no-edit", "topic");
+  const out = [];
+  const res = reportCommit({
+    run,
+    cwd: f.dir,
+    id: "x-1",
+    from: f.report,
+    coAuthor: "Tester <t@example.invalid>",
+    log: (s) => out.push(s),
+  });
+  assert.deepEqual(res.reset, ["docs/dev-hq/data.json"]);
+  assert.ok(res.backupDir, "Pfad des Backups fehlt");
+  assert.equal(readFileSync(join(res.backupDir, "data.json"), "utf8"), '{"v":"regenerated"}\n');
+  assert.match(out.join(""), /Backup/);
+});
+
+test("report-commit works when --worktree is a subdirectory of the repo (N5)", (t) => {
+  const f = repo(t);
+  const res = reportCommit({ run, cwd: join(f.dir, "docs"), id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>" });
+  assert.ok(res.commit);
+  assert.equal(f.git("show", "--name-only", "--format=", "HEAD"), ".pa/report_x-1.md");
+});
+
+test("report-commit refuses when untracked files sit next to dirty HQ data", (t) => {
+  const f = repo(t);
+  const head = f.git("rev-parse", "HEAD");
+  writeFileSync(join(f.dir, "docs/dev-hq/data.json"), '{"v":"local"}\n');
+  writeFileSync(join(f.dir, "lokal.txt"), "lokal\n");
+  assert.throws(
+    () => reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>" }),
+    RefusedError,
+  );
+  assert.equal(f.git("rev-parse", "HEAD"), head);
+});
+
+test("report-commit refuses when HQ data itself is staged and leaves the index alone", (t) => {
+  const f = repo(t);
+  const head = f.git("rev-parse", "HEAD");
+  writeFileSync(join(f.dir, "docs/dev-hq/data.json"), '{"v":"local"}\n');
+  f.git("add", "docs/dev-hq/data.json");
+  assert.throws(
+    () => reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>" }),
+    RefusedError,
+  );
+  assert.equal(f.git("rev-parse", "HEAD"), head);
+  assert.match(f.git("status", "--porcelain"), /^M  docs\/dev-hq\/data\.json/);
+});
diff --git a/scripts/lib/dev-spec-close.test.mjs b/scripts/lib/dev-spec-close.test.mjs
new file mode 100644
index 0000000..89006c1
--- /dev/null
+++ b/scripts/lib/dev-spec-close.test.mjs
@@ -0,0 +1,143 @@
+// SETUP-08b: spec-close marks a spec historic and removes its STAND line.
+import { test } from "node:test";
+import assert from "node:assert/strict";
+import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
+import { tmpdir } from "node:os";
+import { join } from "node:path";
+import { listedInStand } from "./active-specs.mjs";
+import { closeSpec, removeFromStand, specName, main } from "../dev/spec-close.mjs";
+
+const STAND = [
+  "# Stand",
+  "",
+  "## Aktive Specs",
+  "",
+  "- `.pa/task_devflow.md`: DEVFLOW-Ausführung.",
+  "",
+  "| Spec | Paket | Lane |",
+  "|---|---|---|",
+  "| `.pa/task_w1-05.md` | W1-05b: Queue | parallel |",
+  "| `.pa/task_w1-05b.md` | nur zum Test: aehnlicher Name | parallel |",
+  "| `.pa/task_w1-22.md` | W1-22: tauri-plugin-log | seriell `main.rs` |",
+  "",
+  "## Bewusst offene Produktbefunde",
+  "",
+  "- `.pa/task_w1-22.md` wird hier nur erwaehnt und bleibt stehen.",
+  "",
+].join("\n");
+
+test("specName accepts id, file name and path", () => {
+  assert.equal(specName("w1-22"), "task_w1-22.md");
+  assert.equal(specName("task_w1-22.md"), "task_w1-22.md");
+  assert.equal(specName(".pa/task_w1-22.md"), "task_w1-22.md");
+  assert.throws(() => specName("../x"));
+});
+
+test("removeFromStand removes only the exact spec line inside Aktive Specs", () => {
+  const res = removeFromStand(STAND, "task_w1-05.md");
+  assert.equal(res.removed.length, 1);
+  assert.match(res.text, /task_w1-05b\.md/);
+  assert.doesNotMatch(res.text, /\| `\.pa\/task_w1-05\.md` \|/);
+  assert.deepEqual(listedInStand(res.text).names, ["task_devflow.md", "task_w1-05b.md", "task_w1-22.md"]);
+});
+
+test("removeFromStand leaves mentions outside the section alone", () => {
+  const res = removeFromStand(STAND, "task_w1-22.md");
+  assert.equal(res.removed.length, 1);
+  assert.match(res.text, /wird hier nur erwaehnt/);
+});
+
+test("closeSpec sets the status line to historisch and keeps CRLF", () => {
+  const res = closeSpec("# Spec\r\n\r\nStatus: aktiv\r\nText\r\n");
+  assert.equal(res.text, "# Spec\r\n\r\nStatus: historisch\r\nText\r\n");
+  assert.equal(res.previous, "aktiv");
+  assert.equal(res.changed, true);
+});
+
+test("closeSpec refuses a spec without exactly one status line in its head", () => {
+  assert.throws(() => closeSpec("# Spec\nText\n"));
+  assert.throws(() => closeSpec("Status: aktiv\nStatus: entwurf\n"));
+});
+
+function repo(t) {
+  const dir = mkdtempSync(join(tmpdir(), "dev-spec-close-"));
+  t.after(() => rmSync(dir, { recursive: true, force: true }));
+  mkdirSync(join(dir, ".pa"));
+  writeFileSync(join(dir, "STAND.md"), STAND);
+  writeFileSync(join(dir, ".pa/task_w1-22.md"), "# W1-22\n\nStatus: aktiv\n\nText\n");
+  return dir;
+}
+
+test("spec-close is a dry run by default and changes both files with --apply", async (t) => {
+  const dir = repo(t);
+  const out = [];
+  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
+  assert.equal(await main(["w1-22", "--root", dir], io), 0);
+  assert.match(readFileSync(join(dir, ".pa/task_w1-22.md"), "utf8"), /Status: aktiv/);
+  assert.match(out.join(""), /Probelauf/);
+  assert.equal(await main(["w1-22", "--root", dir, "--apply"], io), 0);
+  assert.match(readFileSync(join(dir, ".pa/task_w1-22.md"), "utf8"), /Status: historisch/);
+  assert.ok(!listedInStand(readFileSync(join(dir, "STAND.md"), "utf8")).names.includes("task_w1-22.md"));
+  assert.match(out.join(""), /npm run hq/);
+});
+
+test("spec-close --hq runs the HQ generator through the runner", async (t) => {
+  const dir = repo(t);
+  const calls = [];
+  const run = (cmd, args, opts) => {
+    calls.push([cmd, ...args, opts?.cwd]);
+    return { code: 0, stdout: "", stderr: "" };
+  };
+  const io = { out: () => {}, err: () => {} };
+  assert.equal(await main(["w1-22", "--root", dir, "--apply", "--hq"], io, { run }), 0);
+  assert.equal(calls.length, 1);
+  assert.equal(calls[0][1], "scripts/dev-hq.mjs");
+  assert.equal(calls[0].at(-1), dir);
+});
+
+test("spec-close refuses a missing spec", async (t) => {
+  const dir = repo(t);
+  const io = { out: () => {}, err: () => {} };
+  assert.equal(await main(["w9-99", "--root", dir, "--apply"], io), 3);
+});
+
+test("spec-close --help exits 0", async () => {
+  const out = [];
+  assert.equal(await main(["--help"], { out: (s) => out.push(s), err: (s) => out.push(s) }), 0);
+  assert.match(out.join(""), /spec-close/);
+});
+
+// --- Review SETUP-08b (kimi-k3 #3, #10; glm-5.2 #6) ---
+
+test("closeSpec refuses a status line with a suffix instead of dropping it (kimi #10)", () => {
+  assert.throws(() => closeSpec("# Spec\nStatus: aktiv ( gebunden an PR #150 )\n"), /Status/);
+  assert.throws(() => closeSpec("# Spec\nStatus: aktiv, Stand 24.09.\n"), /Status/);
+  assert.equal(closeSpec("# Spec\nStatus: aktiv\n").text, "# Spec\nStatus: historisch\n");
+  assert.equal(closeSpec("# Spec\nStatus:   entwurf  \n").previous, "entwurf");
+});
+
+test("spec-close leaves everything alone when the spec is historic and not listed (glm #6)", async (t) => {
+  const dir = repo(t);
+  writeFileSync(join(dir, ".pa/task_w1-22.md"), "# W1-22\n\nStatus: historisch\n");
+  writeFileSync(join(dir, "STAND.md"), "## Aktive Specs\n\n- `.pa/task_devflow.md`: x\n\n## Danach\n");
+  const out = [];
+  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
+  assert.equal(await main(["w1-22", "--root", dir, "--apply"], io), 0);
+  assert.match(out.join(""), /nichts zu tun/);
+  assert.equal(readFileSync(join(dir, ".pa/task_w1-22.md"), "utf8"), "# W1-22\n\nStatus: historisch\n");
+});
+
+test("spec-close refuses when STAND.md is missing (glm #6)", async (t) => {
+  const dir = repo(t);
+  rmSync(join(dir, "STAND.md"));
+  assert.equal(await main(["w1-22", "--root", dir, "--apply"], { out: () => {}, err: () => {} }), 3);
+  assert.match(readFileSync(join(dir, ".pa/task_w1-22.md"), "utf8"), /Status: aktiv/);
+});
+
+test("spec-close names the git error instead of falling back to the cwd (kimi #3)", async () => {
+  const err = [];
+  const run = () => ({ code: 128, stdout: "", stderr: "fatal: not a git repository" });
+  const code = await main(["w1-22"], { out: () => {}, err: (s) => err.push(s) }, { run });
+  assert.equal(code, 3);
+  assert.match(err.join(""), /not a git repository/);
+});
diff --git a/scripts/lib/dev-tools.mjs b/scripts/lib/dev-tools.mjs
new file mode 100644
index 0000000..5f738ee
--- /dev/null
+++ b/scripts/lib/dev-tools.mjs
@@ -0,0 +1,132 @@
+// scripts/lib/dev-tools.mjs — shared plumbing for the scripts/dev/* helpers
+// (SETUP-B). Every external program is started through a runner that takes
+// an argument ARRAY (spawnSync without a shell): no command strings, no
+// quoting bugs, identical on Windows and Linux. Tests inject a fake runner.
+import { spawnSync } from "node:child_process";
+import { pathToFileURL } from "node:url";
+import { resolve } from "node:path";
+
+// Exit codes shared by all dev helpers (documented in scripts/dev/README.md).
+export const EXIT = Object.freeze({
+  OK: 0, // done / everything green
+  FAIL: 1, // the checked result is negative (push not on remote, CI red, findings with --strict)
+  USAGE: 2, // wrong arguments
+  REFUSED: 3, // precondition not met, nothing was changed (dirty tree, PR not merged, ...)
+  TIMEOUT: 4, // bounded wait ran out
+});
+
+export class UsageError extends Error {}
+export class RefusedError extends Error {}
+
+// Variables that would silently redirect `git -C <path>` to another
+// repository (a hook environment sets them). gates.sh strips the same list.
+const GIT_REDIRECTS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY"];
+
+export function cleanEnv(base = process.env) {
+  const env = { ...base };
+  for (const name of GIT_REDIRECTS) delete env[name];
+  // No credential-helper GUI and no terminal prompt may ever block a helper:
+  // git asks nobody, the Git Credential Manager answers "never" (M5).
+  env.GIT_TERMINAL_PROMPT = "0";
+  env.GCM_INTERACTIVE = "never";
+  return env;
+}
+
+// run(cmd, args, {cwd, input, timeoutMs}) -> {code, stdout, stderr}. Never
+// throws for a non-zero exit: callers decide. A missing program yields code
+// 127, a killed time-out yields 124 (like GNU timeout). The default is no
+// time limit (timeoutMs 0) — pre-push hooks legitimately run for minutes;
+// callers that talk to the network pass an explicit per-call limit.
+export function makeRunner({ env = cleanEnv(), timeoutMs = 0 } = {}) {
+  return function run(cmd, args = [], opts = {}) {
+    const limit = opts.timeoutMs ?? timeoutMs;
+    const r = spawnSync(cmd, args, {
+      cwd: opts.cwd,
+      env,
+      input: opts.input,
+      encoding: "utf8",
+      maxBuffer: 64 * 1024 * 1024,
+      timeout: limit,
+      windowsHide: true,
+    });
+    if (r.error && r.error.code === "ENOENT") return { code: 127, stdout: "", stderr: `${cmd}: nicht gefunden` };
+    if (r.error && r.error.code === "ETIMEDOUT") {
+      return { code: 124, stdout: r.stdout || "", stderr: `${cmd}: Zeitlimit ueberschritten (${limit} ms)` };
+    }
+    if (r.error) return { code: 1, stdout: r.stdout || "", stderr: String(r.error.message || r.error) };
+    return { code: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || "" };
+  };
+}
+
+// git(cwd)(...args) -> result; gitOk throws a readable error on failure.
+export function gitIn(run, cwd) {
+  const git = (...args) => run("git", ["-C", cwd, ...args]);
+  git.ok = (...args) => {
+    const r = git(...args);
+    if (r.code !== 0) throw new Error(`git ${args.join(" ")} (Exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
+    return r.stdout;
+  };
+  return git;
+}
+
+// gh with JSON output; throws on failure or unparsable output.
+export function ghJson(run, args, { cwd } = {}) {
+  const r = run("gh", args, { cwd });
+  if (r.code !== 0 && !r.stdout.trim().startsWith("[") && !r.stdout.trim().startsWith("{")) {
+    throw new Error(`gh ${args.join(" ")} (Exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
+  }
+  try {
+    return JSON.parse(r.stdout);
+  } catch {
+    throw new Error(`gh ${args.join(" ")}: keine gueltige JSON-Ausgabe`);
+  }
+}
+
+// "90s", "45m", "2h", "500ms" or plain seconds -> milliseconds.
+export function parseDuration(text) {
+  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(text).trim());
+  if (!m) throw new UsageError(`Dauer nicht lesbar: ${text} (Beispiele: 30s, 45m, 2h)`);
+  const n = Number(m[1]);
+  const unit = m[2] || "s";
+  return Math.round(n * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit]);
+}
+
+// A number as Windows prints it in a German locale ("3,25") or as C prints it
+// ("3.25"). Thousands separators are not expected (callers pass plain values).
+export function parseLocaleNumber(text) {
+  const t = String(text).trim().replace(/\s/g, "");
+  if (!/^-?\d+([.,]\d+)?$/.test(t)) return NaN;
+  return Number(t.replace(",", "."));
+}
+
+export function isMain(importMetaUrl) {
+  return Boolean(process.argv[1]) && importMetaUrl === pathToFileURL(resolve(process.argv[1])).href;
+}
+
+// Wraps a CLI body so that thrown errors become exit codes: UsageError and
+// node:util parseArgs errors -> 2, RefusedError -> 3, anything else -> 1.
+export function withExitCodes(body) {
+  return async function main(argv, io, deps = {}) {
+    try {
+      return (await body(argv, io, deps)) ?? EXIT.OK;
+    } catch (e) {
+      if (e instanceof UsageError || String(e?.code || "").startsWith("ERR_PARSE_ARGS")) {
+        io.err(`Fehler: ${e.message}\n(--help zeigt die Aufrufe)\n`);
+        return EXIT.USAGE;
+      }
+      if (e instanceof RefusedError) {
+        io.err(`Abgelehnt: ${e.message}\n`);
+        return EXIT.REFUSED;
+      }
+      io.err(`Fehler: ${e?.message || e}\n`);
+      return EXIT.FAIL;
+    }
+  };
+}
+
+export async function runCli(main, argv = process.argv.slice(2)) {
+  const io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) };
+  process.exitCode = await main(argv, io);
+}
+
+export const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
diff --git a/scripts/lib/dev-tools.test.mjs b/scripts/lib/dev-tools.test.mjs
new file mode 100644
index 0000000..022be03
--- /dev/null
+++ b/scripts/lib/dev-tools.test.mjs
@@ -0,0 +1,45 @@
+// SETUP-08a (Review): shared plumbing — cleanEnv and makeRunner.
+import { test } from "node:test";
+import assert from "node:assert/strict";
+import { cleanEnv, makeRunner } from "./dev-tools.mjs";
+
+test("cleanEnv strips git redirects and keeps the helpers non-interactive (M5)", () => {
+  const env = cleanEnv({
+    GIT_DIR: "x",
+    GIT_WORK_TREE: "y",
+    GIT_INDEX_FILE: "z",
+    GIT_OBJECT_DIRECTORY: "o",
+    KEEP: "1",
+    GIT_TERMINAL_PROMPT: "1",
+  });
+  assert.equal(env.GIT_DIR, undefined);
+  assert.equal(env.GIT_WORK_TREE, undefined);
+  assert.equal(env.GIT_INDEX_FILE, undefined);
+  assert.equal(env.GIT_OBJECT_DIRECTORY, undefined);
+  assert.equal(env.KEEP, "1");
+  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
+  assert.equal(env.GCM_INTERACTIVE, "never");
+});
+
+test("makeRunner reports a timeout as exit code 124 instead of hanging forever (M5)", () => {
+  const run = makeRunner({ timeoutMs: 150 });
+  const r = run(process.execPath, ["-e", "setTimeout(() => {}, 5000)"]);
+  assert.equal(r.code, 124);
+  assert.match(r.stderr, /Zeitlimit/);
+});
+
+test("makeRunner honors a per-call timeout over the default", () => {
+  const run = makeRunner();
+  const ok = run(process.execPath, ["-e", "console.log('x')"]);
+  assert.equal(ok.code, 0);
+  const slow = run(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { timeoutMs: 150 });
+  assert.equal(slow.code, 124);
+  assert.match(slow.stderr, /Zeitlimit/);
+});
+
+test("makeRunner keeps 127 for a missing program", () => {
+  const run = makeRunner();
+  const r = run("definitely-missing-cmd-projecta", ["--foo"]);
+  assert.equal(r.code, 127);
+  assert.match(r.stderr, /nicht gefunden/);
+});
```
