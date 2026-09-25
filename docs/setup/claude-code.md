# Claude Code

Rolle: Koordinator, Nahtstellen-Lanes, Security; Fable 5.1 als Advisor.
Zurück zur Übersicht: [README.md](README.md).

## Pflichtdateien im Repo

- **`CLAUDE.md`** — eine eigene Zeile `@AGENTS.md` (hier die erste). Ohne diesen Import lädt Claude
  Code `AGENTS.md` **nicht**; `npm run dev:agent-check` prüft die Zeile.
- **`.claude/settings.json`** — Allow-Liste nur für lesende git-, cargo- und
  npm-Befehle; zwei Hooks:
  - `SessionStart` → `bash scripts/install-hooks.sh` (setzt `core.hooksPath`)
  - `PostToolUse` (Write|Edit) → `bash .claude/hooks/red-first.sh` — warnt, wenn
    Quellcode ohne Test-Diff geändert wurde; blockiert nicht.
- **`.claude/skills/projecta-workflow/SKILL.md`** — Kopie von
  `.agents/skills/projecta-workflow/SKILL.md`; nur die `.agents`-Fassung
  bearbeiten, dann kopieren.

Weitere Regeln schlägt [permissions-proposal.md](permissions-proposal.md) vor;
eintragen tut sie der Nutzer.

## Globale Einstellungen, die das Projekt voraussetzt

In `~/.claude/settings.json` (nur Namen):

- `permissions.defaultMode` = `auto` — der Auto-Mode-Klassifikator blockt u. a.
  `git worktree remove` und `git branch -d`.
- `env.MCP_TIMEOUT` — Startzeitlimit der MCP-Server.
- `env.RUFLO_FUNNEL`, `env.CLAUDE_FLOW_MEMORY_PATH` — ruflo-Memory (optional).
- `SessionEnd`-Hook → `scripts/session-end-hook.sh claude` (absoluter Pfad auf
  den Hauptcheckout; funktioniert in Worktrees, weil das Skript mit
  `git rev-parse` im aktuellen Verzeichnis arbeitet).

## MCP-Server

- Erwartet: `codebase-memory-mcp` (global in `~/.claude.json`).
- Optional: `memorix`, `ruflo`, `desktop-commander` über Plugins. `ruflo` und
  `desktop-commander` enden oft mit `CONNECT_TIMEOUT` — das ist kein Fehler
  des Repos, die Sitzung arbeitet ohne sie weiter.
- Ruflo-Memory ist nur für Claude sichtbar. Wissen, das alle Anbieter brauchen,
  gehört ins Repo (`AGENTS.md`, `docs/decisions.md`, HQ-Lessons).

## Worktrees und Build-Slots

- Sitzungen laufen oft in `.claude/worktrees/<name>`. Der Stash-Stapel ist
  geteilt: nie `git stash`, lieber WIP-Commit.
- Worktrees haben kein `target/`. Vor jedem Commit (der `pre-commit`-Hook
  fährt `cargo check`) und vor den Gates einen Build-Slot setzen:

  ```sh
  export CARGO_TARGET_DIR=%USERPROFILE%/cargo-targets/projecta-a   # oder -b, -c
  export CARGO_BUILD_JOBS=1
  bash scripts/ci/gates.sh lane prepush
  ```

  Höchstens 2–3 Builds gleichzeitig; vorher freien Arbeitsspeicher prüfen
  (unter ~2,5 GB warten). `npm run dev:agent-check` sucht die Slots unter
  `~/cargo-targets/`; ein anderes Wurzelverzeichnis über
  `PROJECTA_BUILD_SLOTS_ROOT`. **Nie `CARGO_PROFILE_*` setzen** — das entwertet den
  ganzen Cache.
- Eine Isolationsschranke für Subagenten lehnt verkettete Shell-Zeilen mit
  `git` ab: einzelne `git -C <worktree> …`-Befehle verwenden.

## Subagenten und Berichte

Subagenten dürfen `.pa/report_*.md` unter Umständen nicht schreiben. Dann
geben sie den Bericht als Text zurück, und der Koordinator committet ihn.
Nicht umgehen (kein Schreiben über Umwege).

## Advisor Fable 5.1

Subagent mit `model: fable` und maximalem Effort. Worker dürfen ihn selbst
rufen bei Nahtstellen-, Security- und Architekturentscheidungen und wenn sie
länger als 30 Minuten feststecken; sonst über den Koordinator. Gegenstück:
GPT-6 Astra über Codex ([codex.md](codex.md)).

## Gotchas

- **Nie Quelldateien mit PowerShell `Get-Content`/`Set-Content` umschreiben** —
  Umlaute und Gedankenstriche gehen kaputt. Edit-Werkzeug oder Node verwenden.
- **`| tail` verschluckt den Exit-Code** — Status ungemaskiert lesen.
- **Push-Exit-Code ist nicht verlässlich** — Push mit `git ls-remote origin <branch>`
  prüfen.
- **KI-21:** der ruflo-core-Bash-Hook (`PreToolUse`/`PostToolUse Bash`) kann
  eine per Shell-Umleitung geschriebene Datei mit seiner eigenen Ausgabe
  überschreiben — Dateien mit dem Write-Werkzeug oder einem Skript schreiben,
  nicht mit `>`. Status in `KNOWN_ISSUES.md`.
