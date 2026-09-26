# Review: setup-b-08a — glm-5.2

- Autor des Artefakts: Claude Opus 5.5 (Claude Code, setup-b-worker)
- Reviewer: glm-5.2 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `glm-5.2:cloud`, bedient `glm-5.2`
- Datum: 2026-09-24 20:48 UTC, Dauer 256 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_a.md` (80155 Zeichen)

## Roh-Urteil des Reviewers

## Review-Ergebnis: SETUP-08a

### Befunde

**1. Hoch — `scripts/dev/prune-worktrees.mjs:73` (Fehlerhafte Reflog-Zeitermittlung)**
Die Funktion `lastActivityMs` versucht, den Zeitstempel des letzten Reflog-Eintrags zu extrahieren:
`const r = git("reflog", "-1", "--date=unix", "--format=%gd", "HEAD");`
`const m = r.code === 0 ? /@\{(\d+)\}/.exec(r.stdout) : null;`
Git gibt für `--format=%gd` bei `--date=unix` jedoch den Reflog-Selector `HEAD@{0}` aus (Index, nicht Datum). Die Regex extrahiert somit immer `0`, und `reflog` wird zu `0 * 1000 = 0`.
Infolgedessen fällt `Math.max(reflog, commit)` immer auf die Commit-Zeit (`commit`) zurück. Wenn ein Agent einen Worktree frisch auscheckt (`git checkout` erzeugt einen Reflog-Eintrag), aber keine neuen Commits anlegt, ist die "letzte Aktivität" laut Skript der Zeitpunkt des Basis-Commits (z. B. 12+ Stunden her). Der Worktree wird dann fälschlicherweise als "idle" eingestuft und mit `--apply` entfernt, obwohl er gerade eben ausgecheckt wurde. Die Schutzregel "juengst aktive Worktrees behalten" ist damit faktisch ausgehebelt fuer reine Checkouts.
*Fix:* Den Zeitstempel aus der Standardausgabe von `git reflog` extrahieren (steht bei `--date=unix` in der ersten Spalte):
```javascript
const r = git("reflog", "-1", "--date=unix", "HEAD");
const m = r.code === 0 ? /^(\d+)/.exec(r.stdout) : null;
const reflog = m ? Number(m[1]) * 1000 : 0;
```

**2. Mittel — `scripts/dev/push-verified.mjs:25` (Absturz bei Detached HEAD)**
Wenn man `push-verified` ohne `--branch` in einem Detached-HEAD-Zustand aufruft, wirft `git.ok("symbolic-ref", "--short", "HEAD")` einen generischen Error (Exit-Code 128), der von `withExitCodes` als harter Fehler (Exit 1) abgefangen wird. Ein Aufruffehler sollte jedoch Exit 2 (`USAGE`) sein.
*Fix:* Statt `git.ok` den nicht-werfenden Wrapper nutzen und sauber abfangen:
```javascript
const sym = git("symbolic-ref", "--short", "HEAD");
const target = branch || (sym.code === 0 ? sym.stdout.trim() : "");
if (!target) throw new UsageError("Detached HEAD: --branch ist erforderlich");
```

**3. Mittel — `scripts/dev/build-slot.mjs:155` (Fehlende Prozessnamen im Windows-Filter)**
In der PowerShell-Abfrage (`listCargoProcesses`) fehlen `cargo-clippy.exe` und `build-script-build.exe` im CIM-Filter:
`const filter = "Name='cargo.exe' OR Name='rustc.exe' OR Name='clippy-driver.exe' OR Name='cargo-nextest.exe' OR Name='rustdoc.exe'";`
Zwar deckt das Regex-Array `CARGO_NAMES` diese ab, aber da sie nicht von PowerShell geladen werden, fallen sie unnoetig auf die Lock-Datei-Heuristik zurueck, was zu "vermutlich belegt" statt "belegt" fuehrt.
*Fix:* `Name='cargo-clippy.exe' OR Name='build-script-build.exe'` in den Filter-String aufnehmen.

**4. Niedrig — `scripts/dev/build-slot.mjs:111` (Linux `comm`-Limit)**
Die Funktion `listLinuxProcesses` liest `/proc/<pid>/comm`. Der Kernel beschneidet diesen Wert auf 15 Zeichen. Der Name `build-script-build` (18 Zeichen) wird somit zu `build-script-bu` und matcht nie auf `CARGO_NAMES`. Da `build-script-build` normalerweise ohnehin nur transient unter einem `rustc`-Prozess laeuft, ist die Auswirkung gering, aber es ist eine Inkonsistenz zur Regex-Definition.
*Fix:* Entweder `build-script-build` aus der Regex entfernen (und dokumentieren, dass es nicht einzeln getracked wird) oder stattdessen die Kommandozeile unter `/proc/<pid>/cmdline` auf Cargo-Namen untersuchen.

### Nicht geprueft
- Die vom Autor angegebenen Probelaufe an echten Repos (11 entfernbare Worktrees, 4 freie Slots, 3,2 GB RAM) sowie die behauptete grüne CI (`npm run test:hq` 269/269) konnte ich anhand des reinen Diffs nicht verifizieren.
- Die Lauffaehigkeit des `powershell -Command`-Aufrufs auf echten Windows-Systemen mit strengen Execution-Policies konnte nicht getestet werden (erscheint aber durch `-NoProfile` sicherheitstechnisch unbedenklich).

### Gesamturteil
**Freigeben mit Auflagen**
Die Architektur (Trennung von Logik und CLI, injizierte Runner, echte Git-Repos in Tests, Windows-Normalisierung) ist exzellent umgesetzt und die Sicherheitsregeln wurden stringent eingehalten. Der Fehler in der Reflog-Parserei (Befund 1) ist jedoch ein K.O.-Kriterium fuer den produktiven Einsatz, da er die Idle-Sicherung aushebelt und aktive Worktrees gefaehrdet. Dieser muss zwingend behoben werden. Die weiteren Befunde sind kosmetisch bzw. Verbesserungen der Robustheit.
