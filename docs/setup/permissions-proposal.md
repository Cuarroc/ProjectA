# Vorschlag: Berechtigungsregeln für Claude Code

**Status: Vorschlag.** Der Nutzer entscheidet und trägt ein; kein Agent ändert
`.claude/settings.json` oder `.claude/settings.local.json` selbst. Zurück zur
Übersicht: [README.md](README.md).

## Wo

Empfohlen: Repo-`.claude/settings.json` (per PR nachvollziehbar, gilt für jede
Claude-Sitzung im Repo, auch in Worktrees). Alternativen: `~/.claude/settings.json`
(nur dieser PC) oder `.claude/settings.local.json` (lokal, ungetrackt).

Die Regeln unten **ergänzen** die bestehende Allow-Liste (lesende git-, cargo-
und npm-Befehle) und lassen die Hooks unverändert. Eine Änderung an
`.claude/settings.json` braucht einen Commit-Trailer (`No-Test:` mit Grund).

## Regeln

Skripte, die in dieser Liste stehen, aber noch nicht existieren
(`scripts/dev/prune-worktrees.sh`, `report-commit.sh`, `push-verified.sh`,
`ci-watch.sh`, `pr-status.mjs`, `erledigt-row.mjs`, `spec-close.mjs`,
`scripts/review/run-local.sh`), kommen aus den Paketen SETUP-08a/08b/09. Ihre
Regeln erst eintragen, wenn das jeweilige Skript gemergt ist.

```jsonc
{
  "permissions": {
    "allow": [
      // Repo-Skripte (Default jeweils Dry-Run bzw. nur lesend)
      "Bash(node scripts/dev/agent-setup-check.mjs *)",   // nur lesend, existiert
      "Bash(npm run dev:agent-check)", "Bash(npm run dev:agent-check *)",
      "Bash(bash scripts/ci/gates.sh *)",                  // Gates lokal
      "Bash(bash scripts/ci/doctor.sh)",
      "Bash(bash scripts/dev/prune-worktrees.sh *)",      // siehe Hinweis 1
      "Bash(bash scripts/dev/report-commit.sh *)",        // commit+push auf den genannten Branch, nie main
      "Bash(bash scripts/dev/push-verified.sh *)",
      "Bash(bash scripts/dev/ci-watch.sh *)",
      "Bash(bash scripts/review/run-local.sh *)",         // nur lokaler Ollama-Endpunkt
      "Bash(node scripts/dev/pr-status.mjs *)",
      "Bash(node scripts/dev/erledigt-row.mjs *)",
      "Bash(node scripts/dev/spec-close.mjs *)",
      "Bash(python .pa/review_transport.py *)",

      // git, lesend bzw. ohne Datenverlust
      "Bash(git fetch *)", "Bash(git ls-remote *)", "Bash(git rev-parse *)",
      "Bash(git worktree prune)",
      "Bash(git checkout -- docs/dev-hq/data.js docs/dev-hq/data.json)",

      // gh, lesend + PR-Verwaltung
      "Bash(gh pr view *)", "Bash(gh pr list *)", "Bash(gh pr checks *)", "Bash(gh pr diff *)",
      "Bash(gh run list *)", "Bash(gh run view *)", "Bash(gh release list *)", "Bash(gh label list *)",
      "Bash(gh pr create *)", "Bash(gh pr ready *)", "Bash(gh pr edit *)",

      // Berichte und Plan-Buchführung
      "Write(.pa/report_*.md)", "Edit(.pa/report_*.md)",
      "Write(.pa/review_*.md)",
      "Write(.pa/task_*.md)", "Edit(.pa/task_*.md)",
      "Edit(docs/ERLEDIGT.md)", "Edit(docs/MASTERPLAN.md)", "Edit(.pa/ACTIVITY.md)"
    ],
    "deny": [
      "Bash(git stash)", "Bash(git stash *)",              // geteilter Stash-Stapel
      "Bash(git push --force)", "Bash(git push --force *)", "Bash(git push -f)", "Bash(git push -f *)",
      "Bash(git push --force-with-lease)", "Bash(git push --force-with-lease *)",
      "Bash(git reset --hard)", "Bash(git reset --hard *)",
      "Bash(git commit --no-verify)", "Bash(git commit --no-verify *)", "Bash(git push --no-verify)", "Bash(git push --no-verify *)",
      "Bash(git worktree remove --force *)", "Bash(git worktree remove -f *)",
      "Bash(git branch -D *)", "Bash(git branch -d --force *)", "Bash(git branch -df *)",
      "Bash(git branch -fd *)", "Bash(git branch -d -f *)",
      "Edit(.claude/settings.json)", "Edit(.claude/settings.local.json)",
      "Write(.claude/settings.json)", "Write(.claude/settings.local.json)"
      // optional, siehe Hinweis 2:
      // "Bash(gh pr merge *)"
    ]
  }
}
```

**Optional**, nur wenn Aufräumen *nicht* ausschließlich über das Prune-Skript
laufen soll (sonst weglassen — jede dieser Regeln öffnet Varianten, die die
Deny-Liste abfangen muss, etwa `-f` statt `--force`):

```jsonc
"Bash(git worktree remove *)",   // ohne --force/-f verweigert git bei Änderungen
"Bash(git branch -d *)"          // nur gemergte Branches; -D, -d --force, -df bleiben gesperrt
```

Syntax: `Bash(befehl *)` ist die Form, die die bestehende
`.claude/settings.json` schon benutzt (`Bash(cargo test *)`); die ältere Form
`Bash(befehl:*)` ist gleichbedeutend. Ein Muster mit ` *` trifft den nackten
Befehl ohne Argumente **nicht** — deshalb stehen `git stash`,
`git reset --hard`, die `git push`-Force-Formen und die `--no-verify`-Formen
zusätzlich ohne Stern da.

Für die PowerShell-Werkzeuge gelten dieselben Regeln mit `PowerShell(…)` statt
`Bash(…)`; die bestehende Datei führt beide Formen.

## Hinweise

1. **Prune-Umfang.** `prune-worktrees.sh` (SETUP-08a) soll mit `--dry-run` als
   Standard laufen, nie `--force` benutzen und nur Worktrees entfernen, deren
   Branch-PR gemergt ist (Prüfung über `gh`): `.claude/worktrees/*`,
   `.worktrees/*` **und gemergte Codex-Worktrees** (`~/.codex/worktrees/*`,
   `.projecta-worktrees/codex-pr*`). App-eigene `pa/wk-*`-Worktrees bleiben
   außen vor (die App-Datenbank verweist auf sie).
2. **`gh pr merge` sperren — Nutzerentscheidung.** Seit CI-01 (PR #108) sagt
   `AGENTS.md`: `main` wird nur über die Mergify-Queue gemergt. Die Regel
   `Bash(gh pr merge *)` in `deny` setzt das für Claude technisch durch. Der
   Koordinator darf als Notfall-Ausnahme (Queue hängt, Mergify fällt aus)
   weiter von Hand mergen (Nutzerentscheidung 24.09., siehe
   [mergify.md](mergify.md#hand-merge)). Eine Deny-Regel in der Repo-Datei
   gälte auch für den Koordinator; wer sie einträgt, braucht für den Notfall
   den Nutzer oder eine Ausnahme in der lokalen Einstellung des Koordinators.
3. **Auto-Mode.** Ob explizite Allow-Regeln den Auto-Mode-Klassifikator bei
   `git worktree remove` wirklich übersteuern, ist noch nicht belegt. Nach dem
   Eintragen einmal an einem Wegwerf-Worktree prüfen.
4. **`Edit(…)`/`Write(…)` auf `.claude/settings*.json` in `deny`** schützt vor
   Selbstberechtigung: Neue Rechte kommen nur vom Nutzer.
5. **Grenzen der Deny-Regeln.** Die Muster greifen auf den Befehlsanfang.
   `git push origin x --force` (Flag hinten) fällt nicht unter
   `Bash(git push --force *)`. Die Deny-Liste ist eine Leitplanke, kein
   Ersatz für den Branch-Schutz auf GitHub.
