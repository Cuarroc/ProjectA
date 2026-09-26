# Disposition: Reviews SETUP-08a (Git-/PR-Helfer unter scripts/dev)

- Artefakt: Commits 2489e1d, a82a029 (SETUP-08a), Draft-PR #126
- Reviews: `.pa/review_setup-b-08a_glm-5.2.md` (G1–G4), `.pa/review_setup-b-08a_kimi-k3.md` (M1–M5, N1–N8)
- Bearbeitet: 2026-09-25 auf Branch `claude/setup-b2-plan-helpers`
- Vorgehen: jeder Befund gegen den Code bestätigt oder widerlegt; angenommene
  Befunde test-first umgesetzt (Selbsttests zuerst rot, dann grün:
  `npm run test:hq` 335/335, Exit 0; `node --check` für jede .mjs, Exit 0).
- Ergebnis: **15 angenommen, 2 abgelehnt (widerlegt)**

| Befund | Schwere | Inhalt | am Code geprüft | Disposition |
|---|---|---|---|---|
| G1 (glm #1) | hoch | `lastActivityMs` in prune-worktrees lese aus `%gd` immer `0` heraus; Idle-Schutz für reine Checkouts ausgehebelt | **Widerlegt**, empirisch (git 2.55.0.windows.3): `git reflog -1 --date=unix --format=%gd HEAD` gibt bei `--date=unix` den Unix-Zeitstempel im Selector aus (`HEAD@{1577836800}`), nicht den Index — die Regex `/@\{(\d+)\}/` extrahiert die Zeit korrekt. Zusätzlich Regressionstest: frisch ausgecheckter Worktree ohne neuen Commit bleibt unter `--min-idle` geschützt (grün). | Abgelehnt (widerlegt), kein Fix |
| G2 (glm #2) | mittel | push-verified stürzt bei detached HEAD ohne `--branch` mit Exit 1 statt 2 ab | Bestätigt: `git.ok("symbolic-ref", …)` warf generischen Error → `withExitCodes` → Exit 1 | Angenommen: `UsageError` („Detached HEAD: --branch ist erforderlich"), Validierung synchron vor dem ersten await; Test |
| G3 (glm #3) | mittel | Windows-Prozessfilter ohne `cargo-clippy.exe`/`build-script-build.exe` | Bestätigt: CIM-Filter listete beide nicht | Angenommen: Filter ergänzt; Test prüft den Filterstring |
| G4 (glm #4) | niedrig | Linux `comm`-Schnitt bei 15 Zeichen: `build-script-build` nie erkannt | Bestätigt (Kernel-Limit, `TASK_COMM_LEN` 16) | Angenommen: `isCargoProcessName` akzeptiert 15-Zeichen-Präfixe bekannter Namen; überall statt der Regex verwendet; Test (= N3) |
| M1 (kimi) | mittel | Worktree-Stash wird von keiner Schutzregel erfasst und beim Entfernen zerstört | **Widerlegt**, empirisch im Test mit echtem Repo: `refs/stash` liegt im gemeinsamen Ref-Store (common dir), nicht unter `.git/worktrees/<name>/`; `git worktree remove` lässt den Stash unangetastet — Test stasht im Worktree, entfernt es per `applyPrune` und findet den Stash-Eintrag danach im Hauptcheckout (grün). Prämisse des Befunds („per-worktree ref") ist falsch. | Abgelehnt (widerlegt); der Test bleibt als Beleg |
| M2 (kimi) | mittel | Ignorierte Dateien (`.env`, lokale Notizen) werden wortlos mitgelöscht | Bestätigt: Schmutz-Check lief mit `--untracked-files=normal`, Ignoriertes unsichtbar | Angenommen: vor `remove` `status --porcelain -z --ignored=matching -uall`; „!!"-Einträge außerhalb der Allowlist `node_modules`/`target`/`dist` → keep mit Grund; 2 Tests (.env hält, reine Build-Artefakte nicht) |
| M3 (kimi) | mittel | build-slot: Slot falsch „frei"; (a) env-Attribution auf Windows unlesbar, (b) Frische-Heuristik nur ohne Prozessliste, (c) `unattributed` nicht in `busy` | Bestätigt: (b) und (c) im Code nachgewiesen; (a) ist die dokumentierte Plattformgrenze | Angenommen: Lock/deps/.fingerprint-Frische gilt jetzt auch MIT Prozessliste („vermutlich belegt" in der Start-/Linkphase), unattributed Prozesse zählen konservativ in `busy`/`MAX_PARALLEL` ein; 2 Tests. (a) bleibt als dokumentierte Grenze, wird durch (b) abgefedert |
| M4 (kimi) | mittel | `report-commit --merge`: untracked Dateien passieren die Sauberkeitsprüfung → Merge läuft, Refusal danach → HEAD bereits bewegt trotz Exit 3 | Bestätigt: Prüfung ließ `??`-Einträge durch | Angenommen: `--merge` verlangt komplett sauberen Baum (inkl. untracked) und lehnt VOR dem Merge ab; Test beweist unbewegten HEAD |
| M5 (kimi) | mittel | Kein Zeitlimit pro Aufruf; hängender Credential-Helper blockiert unbegrenzt | Bestätigt: `makeRunner` Default `timeoutMs = 0`, `GIT_TERMINAL_PROMPT`/`GCM_INTERACTIVE` ungesetzt | Angenommen: `cleanEnv` setzt `GIT_TERMINAL_PROMPT=0` + `GCM_INTERACTIVE=never`; `makeRunner` bildet Timeout auf Exit 124 ab (per Default und per Aufruf); push-verified: Push 15 min (Hooks!), ls-remote 2 min; 3 Tests. Kein globales Default-Timeout: pre-push-Hooks laufen legitim minutenlang |
| N1 (kimi) | niedrig | report-commit verwirft Hand-Edit an `data.*` direkt nach Merge stumm | Bestätigt: `git checkout --` ohne Sicherung | Angenommen: verworfene Fassungen werden vorher in ein Tmp-Verzeichnis kopiert, Pfad im Log und im Ergebnis (`backupDir`); Test |
| N2 (kimi) | niedrig | build-slot-Heuristik prüft nur `debug/` | Bestätigt: Probes fest auf `debug/` | Angenommen: Probes für `debug` und `release`; Test |
| N3 (kimi) | niedrig | = G4 (`comm` 15 Zeichen) | Bestätigt | Angenommen: mit G4 behoben (gleicher Fix, gleicher Test) |
| N4 (kimi) | niedrig | ci-watch: `graceEmpty` zählt Polls, nicht Zeit (bei `--interval 5s` nur ~15 s Karenz) | Bestätigt: Zähler pro leerem Poll | Angenommen: `graceMs` zeitbasiert (Default 3 min), Summary nennt die Karenz; 2 Tests (37 Polls bei 5 s Intervall/180 s Karenz) |
| N5 (kimi) | niedrig | report-commit: `git add -- .pa/report_<id>.md` relativ zu `cwd` statt Toplevel | Bestätigt: Add schlug aus Unterverzeichnis fehl | Angenommen: alle git-Operationen laufen über `gitIn(run, top)` am Toplevel; Test mit `cwd` = Unterverzeichnis |
| N6 (kimi) | niedrig | prune-worktrees: `norm()` nutzt `process.platform`, Windows-Kleinschreibung unter Linux-CI untestbar; Symlink-Pfade unsichtbar konservativ | Bestätigt (Plattform-Teil) | Angenommen: `makeNorm(platform)` exportiert und injizierbar, win32-Pfadvergleich durchgetestet. Nebenbefund Symlink: bewusst offen — Fehlrichtung ist konservativ (nichts wird entfernt), kein Datenverlust möglich |
| N7 (kimi) | niedrig | Testlücken: namesSlot-Negativtest, echter `worktree lock`, Stash, detached, aktuelles Verzeichnis, prunable, ignorierte Dateien, report-commit untracked/gestaged, ls-remote-Fehler, Branchname-Validierung, kaputtes gh-JSON | Bestätigt: Fälle fehlten | Angenommen: alle genannten Fälle als Tests ergänzt (u. a. `git check-ref-format --branch` vor dem ersten Push; ls-remote-Fehler wird als solcher gemeldet statt „belegt"); alle grün |
| N8 (kimi) | niedrig | Doku/Scope: (a) Exit-Tabelle vs. prune-worktrees gh-Fehler, (b) `HQ_DATA` feste Liste statt `data.*`-Glob, (c) Beleg „42 neue Tests" vs. 48 gezählte Blöcke | (a) Bestätigt: prune-worktrees endet bei gh-Fehler mit 0 und Hinweis. (b) Bestätigt als bewusste Liste. (c) Bestätigt: der 08a-Diff enthält 48 Testblöcke | Angenommen: (a) README-Exit-Tabelle präzisiert. (b) Bewusst Liste statt Glob: der Hook regeneriert genau diese zwei Dateien; ein künftiges drittes `data.*` wäre ein bewusster Eingriff, kein stiller Glob — hier dokumentiert. (c) Zählung hier korrigiert vermerkt (48); der Bericht mit „42" liegt außerhalb der für diesen Auftrag änderbaren Pfade |

## Hinweise

- Zwei Befunde widerlegt (G1, M1) — beide Widerlegungen sind durch grüne
  Tests mit echten Git-Repos belegt, nicht nur statisch argumentiert.
- Der Teil von M3(a) (CARGO_TARGET_DIR-Attribution auf Windows unlesbar) und
  der Symlink-Nebenbefund aus N6 bleiben als dokumentierte, konservative
  Grenzen offen.
- Selbsttests: `npm run test:hq` → 335/335 grün (Exit 0); `node --check`
  auf allen `scripts/dev/*.mjs` und `scripts/lib/dev-*.mjs` → jeweils Exit 0.
