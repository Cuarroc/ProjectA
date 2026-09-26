# Review: setup-b-08a — kimi-k3

- Autor des Artefakts: Claude Opus 5.5 (Claude Code, setup-b-worker)
- Reviewer: kimi-k3 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `kimi-k3:cloud`, bedient `kimi-k3`
- Datum: 2026-09-24 20:39 UTC, Dauer 481 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_a.md` (80155 Zeichen)

## Roh-Urteil des Reviewers

# Review SETUP-08a: Git-/PR-Helfer unter scripts/dev

Geprüft wurde ausschließlich der gelieferte Diff (statisch, ohne Ausführung). Befundlage unten; Ausführungsbelege des Autors sind als solche nicht verifizierbar (siehe „Nicht prüfbar").

---

## Befunde

### Schwere: hoch

Keine.

### Schwere: mittel

**M1 — `prune-worktrees`: Stash im Worktree wird von keiner Schutzregel erfasst und beim Entfernen zerstört.**
`refs/stash` ist pro Worktree (per-worktree ref, liegt unter `.git/worktrees/<name>/`). Der Worktree-Stash taucht weder in `git status --porcelain` (Prüfung in `planPrune`, Diff ~Z. 119–133) noch in `rev-list HEAD --not --remotes` auf, und `git worktree remove` (ohne `--force`) warnt ebenfalls nicht davor. Szenario: Agent stasht Arbeit, Rest ist sauber, gepusht, PR gemergt, >12 h idle → `action: "remove"` → Stash unwiederbringlich weg. Das verletzt die Kernzusage „ungesicherte Arbeit NIE anfassen".
*Fix:* Vor `action="remove"` zusätzlich `git -C <wt> stash list` (oder `rev-parse -q --verify refs/stash`) prüfen; nicht-leer → `keep` mit Grund. Test im Fake-Repo ergänzen (Worktree mit Stash muss behalten werden).

**M2 — `prune-worktrees`: Ignorierte Dateien (z. B. `.env`, `.claude/settings.local.json`, lokale Notizen) werden wortlos mitgelöscht.**
Der Schmutz-Check läuft mit `--untracked-files=normal`, d. h. `.gitignore`-/`info/exclude`-abgedeckte Dateien sind unsichtbar; `git worktree remove` löscht sie ebenfalls ohne Rückfrage. `.env`-artige Dateien sind ungesicherte Arbeit im Sinne des Auftrags.
*Fix:* Vor dem Entfernen `git -C <wt> status --porcelain -z --ignored=matching -uall` auswerten; Treffer außerhalb einer kleinen Allowlist (`node_modules`, `target`, `dist`) → `keep` mit Grund, mindestens aber im Plan ausgeben/auflisten. Test ergänzen.

**M3 — `build-slot`: Slot kann fälschlich „frei" gemeldet werden, obwohl ein Build darauf läuft; `MAX_PARALLEL` ist dadurch aushebelbar.**
`slotStatus` (Diff ~Z. 66–100) verlässt sich bei verfügbarer Prozessliste ausschließlich auf die Kommandozeilen-Attribution. Lücken: (a) cargo-Prozesse mit gesetztem `CARGO_TARGET_DIR` nennen den Slot nicht in der Kommandozeile (auf Windows nicht auslesbar, laut eigenem Kommentar) — zwischen zwei rustc-Aufrufen (Dep-Auflösung, Linkphase) ist dann kein Prozess dem Slot zugeordnet; (b) die 2-Minuten-Heuristik wird bei verfügbarer Prozessliste **gar nicht** angewandt (nur `else`-Zweig), auch nicht als zweites Signal; (c) `unattributed` Prozesse werden nur als Hinweis ausgegeben, fließen aber nicht in `busy` ein. Folge: Ein zweiter Agent kann denselben Slot empfohlen bekommen (cargo-Lock serialisiert zwar korrekt, kostet aber Wartezeit), und die 3-Builds-/RAM-Schranke ist durchlässig.
*Fix:* Bei verfügbarer Prozessliste zusätzlich die Frische von `debug/.cargo-lock`/`deps`/`/.fingerprint` prüfen und ggf. „vermutlich belegt" setzen; `unattributed`-Zahl konservativ in `busy` einrechnen.

**M4 — `report-commit --merge`: teilweise Zustandsänderung trotz Exit 3 („nichts geändert" laut README).**
Die Sauberkeitsprüfung vor dem Merge (`reportCommit`, Diff ~Z. 104: `porcelain(git).some((e) => e.x !== "?")`) lässt untracked Dateien durch. Der Merge läuft dann, anschließend lehnt `hqResetPlan` wegen „auch andere Dateien geändert" ab → `RefusedError`, Exit 3 — aber HEAD ist bereits gemergt. Der dokumentierte Vertrag „abgelehnt = nichts geändert" ist verletzt.
*Fix:* Bei `--merge` einen vollständig sauberen Baum verlangen (inkl. untracked), oder die Refusal-Bedingungen vor dem Merge vollständig prüfen. Test: `--merge` mit liegender untracked Datei muss **vor** dem Merge ablehnen.

**M5 — `push-verified`: kein Zeitlimit pro Versuch; hängender Credential-Helper blockiert unbegrenzt.**
`makeRunner` (dev-tools.mjs, Diff ~Z. 40–52) hat `timeoutMs = 0` (kein Timeout), `GIT_TERMINAL_PROMPT`/`GCM_INTERACTIVE` werden nicht gesetzt. Gerade der im Auftrag genannte Windows-Credential-Helper kann einen GUI-/Konsolen-Prompt aufwerfen (stdin geht zwar sofort zu, die Helper-GUI nicht zwingend) — dann hängt ein Push-Versuch endlos, „begrenzter Retry" begrenzt nur die Anzahl. Gleiches gilt für `ls-remote` bei Netzparalyse und für das `git fetch` in `prune-worktrees` (minder).
*Fix:* `--timeout` für Einzel-Aufrufe (z. B. 120 s) in `spawnSync` durchreichen, daraus Exit 4 oder abgezählten Versuch machen; `GIT_TERMINAL_PROMPT=0` (und ggf. `GCM_INTERACTIVE=never`) in `cleanEnv` setzen.

### Schwere: niedrig

**N1 — `report-commit`: Die „nur durch Merge verändert"-Regel kann eine Hand-Änderung direkt nach dem Merge nicht unterscheiden.**
Szenario: Merge → Hook regeneriert `data.*` → jemand editiert `data.json` bewusst nach → Baum sonst sauber → Reflog zeigt „merge" → Reset verwirft die Hand-Änderung still (`report-commit.mjs`, `hqResetPlan`, ~Z. 61–80). Die Richtung ist zwar der Sinn des Werkzeugs, aber der Verlust ist stumm.
*Fix:* Vor `git checkout --` die verworfenen Fassungen in einen Backup-Pfad (tmp) kopieren und den Pfad ausgeben; optional den HQ-Generator in ein Temp-Verzeichnis laufen lassen und nur bei identischem Inhalt automatisch zurücksetzen, sonst ablehnen. Mindestens im README als bekannte Grenze benennen.

**N2 — `build-slot`: Sperr-/Frische-Heuristik prüft nur `debug/`.**
Bei `cargo build --release` (oder anderem Profil) liegen `.cargo-lock`, `deps`, `.fingerprint` unter `release/`; ohne Prozessliste gilt der Slot als frei (~Z. 88–92).
*Fix:* Auch `release/.cargo-lock`, `release/deps`, `release/.fingerprint` (gern generisch: `<slot>/*/.cargo-lock` einschränkend) mit einbeziehen.

**N3 — `build-slot` (Linux): `comm` ist auf 15 Zeichen gekürzt.**
`build-script-build` (18 Zeichen) wird in `/proc/<pid>/comm` zu `build-script-bu` und von `CARGO_NAMES` nie erkannt (`listLinuxProcesses`, ~Z. 130–150). rustc/cargo bleiben erkannt, daher geringe Auswirkung.
*Fix:* Gekürzte Namen akzeptieren oder die Namensprüfung auf Basis von `cmdline[0]` statt `comm` machen.

**N4 — `ci-watch`: `graceEmpty` zählt Polls, nicht Zeit.**
Mit `--interval 5s` endet die Karenz nach ~15 s mit Exit 3, obwohl GitHub Required Checks bei Rulesets oft erst nach 10–60 s registriert (`watchChecks`, ~Z. 66–72).
*Fix:* Karenz zeitbasiert (z. B. fest 3–5 min oder `min(3 Polls, 5 min)`).

**N5 — `report-commit`: `git add -- .pa/report_<id>.md` läuft relativ zu `cwd`, nicht zum Toplevel.**
Bei `--worktree <unterverzeichnis>` schlägt das Add fehl oder greift daneben (`reportCommit` ~Z. 118–120).
*Fix:* `gitIn(run, top)` verwenden oder absoluten Pfad adden; zusätzlich im Hilfetext klarmachen, dass `--worktree` die Wurzel sein soll.

**N6 — `prune-worktrees`: `norm()` benutzt `process.platform` statt einer injizierbaren Plattform.**
Die Windows-Kleinschreibung läuft in der Linux-CI nie; im Gegensatz zu `build-slot` (`platform`-Parameter) ist das hier nicht testbar (~Z. 62–65). Daneben: Ist der Hauptcheckout über einen Symlink erreichbar, können Pfadpräfixe von `worktree list` und `rev-parse` auseinanderlaufen — Ergebnis wäre „alles ignored" (konservativ, aber als Fehlverhalten unsichtbar).
*Fix:* Plattform/Normalisierung injizierbar machen und einen win32-Pfadvergleich durchtesten; optional `realpath` auf `mainPath` anwenden und bei 0 erkannten Kandidaten einen Hinweis ausgeben.

**N7 — Testlücken (Verhalten vs. Attrappe).**
Die Suite ist überwiegend verhaltensnah (echte Repos/Worktrees/Merges, echter post-merge-Hook, bare Remote), aber folgende in den Prüffragen genannten Fälle fehlen:
- Teilpfad-Negativtest für `namesSlot` (`projecta-a` darf `projecta-ab`/`projecta-a-x` nicht treffen, End-of-Token-Fall) — Code sieht korrekt aus, ist aber unbelegt;
- echter `git worktree lock` im Fake-Repo (bisher nur handgeschriebenes `--porcelain`-Listing);
- Stash-Fall, detached-HEAD-Worktree, „aktuelles Verzeichnis"-Schutz, `prunable`-Fall, ignorierte Dateien im Worktree;
- `report-commit`: untracked Datei neben schmutzigen HQ-Daten; `--merge` mit untracked Datei (siehe M4); gestagte `data.*`;
- `push-verified`: `ls-remote`-Fehlerpfad, ungültiger Branchname vorab (`. .`-haltige Namen laufen in 3 Push-Versuche statt in Exit 2 — `git check-ref-format` vorab wäre billig);
- `ci-watch`: ungültiges JSON von `gh`.
*Fix:* Die genannten Fälle ergänzen; besonders M1/M2/M4 gehören unter Test.

**N8 — Kleinigkeiten Doku/Scope.**
- README-Gesamttabelle ordnet „gh-Fehler" Exit 3 zu; `prune-worktrees` fährt bei gh-Fehler fort und gibt 0 aus (Tool-Hilfe sagt das auch so) — entweder Tabelle präzisieren oder Verhalten angleichen.
- `HQ_DATA` ist fest `[data.js, data.json]`, der Auftrag sagt `docs/dev-hq/data.*` — falls weitere `data.*` dazukommen, werden sie nicht zurückgesetzt/abgesichert. Glob statt Liste oder bewusst dokumentieren.
- Beleg „42 neue Tests": Im Diff zähle ich 48 Testblöcke (12+8+6+7+7+8). Zählung klären oder Beleg korrigieren.

---

## Zugeordnete Antworten auf die Prüffragen

1. **`prune-worktrees --apply`:** Die Kernfälle sind abgedeckt — detached HEAD mit eigenen Commits ist nie „fertig" (weder in main noch PR zuordenbar); gelöschter Remote-Branch → `unpushed > 0` → keep; fremder laufender Agent → lock/dirty/unpushed/in-progress/min-idle halten; frischer Worktree ohne Commit → min-idle, und es gibt ohnehin nichts zu verlieren (Branches bleiben bestehen). **Verbleibende echte Lücken: M1 (Stash) und M2 (ignorierte Dateien).**
2. **HQ-Regel:** Grunddesign ist korrekt konservativ (gestaged → Abbruch, Fremdänderung → Abbruch, kein Merge → Abbruch). Verwerfen kann sie nur in N1 (Hand-Edit direkt nach Merge) und über den Teilstaat in M4.
3. **`push-verified`:** Kein falsch-positives „belegt" gefunden: exakter Zeilenvergleich auf `refs/heads/<branch>` (Tail-Match von `ls-remote` greift bei vollständigem Ref nicht), `[rejected]` bricht korrekt ab, Retry ist begrenzt. Schwachpunkt ist nur die fehlende Zeitbegrenzung (M5).
4. **Windows:** Durchgehend Argument-Arrays ohne Shell; Pfadvergleiche normalisiert (Ausnahme N6); CRLF an allen relevanten Stellen behandelt (`-z`, `/\r?\n/`, `replace(/\r/g, "")`). PowerShell-Aufruf ist sauber parametrisiert; Nicht-ASCII-Pfade (Umlaute im Benutzerprofil) sind wegen Konsole-Encoding ungetestet.
5. **`build-slot`:** Teilpfad-Treffer sind durch die Nachfolgezeichen-Prüfung fachlich gelöst (ungetestet, N7). Falsch-„frei" bleibt über cargo-Startphase/env-Attribution (M3) und release-Profile (N2).
6. **Testqualität:** Keine reinen Attrappen — Push/Prune/Report laufen gegen echte git-Repos; ci-watch ist konsequent injiziert inklusive simulierter Uhr; der Verdrahtungstest startet echte Prozesse. Lücken siehe N7.

## Nicht prüfbar (ausdrücklich)

- Ob `npm run test:hq` die neuen `scripts/lib/dev-*.test.mjs` tatsächlich aufnimmt (Definition/Glob von `test:hq` ist nicht im Diff; im Diff werden nur die `dev:*`-Skripte ergänzt). Die 269/269-Behauptung kann ich nicht nachrechnen.
- Die Probelauf-Belege am echten Repo (11 entfernbare Worktrees) und `build-slot` am echten Rechner (3,2 GB RAM).
- Dass `gh pr checks --required` im Fehlerfall wirklich „no (required )?checks reported" auf stderr schreibt (gh 2.97); der Regex in `fetchChecks` beruht auf dieser Annahme, die ich nur statisch beurteilen kann.
- Die Prämisse, dass Claude Code laufende Agenten-Worktrees per `git worktree lock` sperrt.
- Ob im Zielrepo außer `data.js`/`data.json` weitere `data.*`-Dateien existieren.
- Die Behauptung „rustc bekommt immer `--out-dir <slot>/…`" — plausibel, aus dem Diff heraus nicht belegbar.

## Gesamturteil

**freigeben mit Auflagen.** Kein hoch-Schwere-Befund, aber fünf Mittel-Befunde, die die Kernzusagen des Auftrags betreffen (M1/M2: „ungesicherte Arbeit NIE anfassen"; M4: „abgelehnt = nichts geändert"; M5: „begrenzt"; M3: Slot-Sicherheit). M1–M5 vor Merge beheben inklusive Tests; N1–N8 zeitnah nachziehen.
