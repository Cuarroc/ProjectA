@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## `AGENTS.md` ist die Quelle

Die erste Zeile dieser Datei importiert [`AGENTS.md`](AGENTS.md): Claude Code
liest `AGENTS.md` nicht von selbst (Codex, OpenCode und Kimi Code tun es per
Konvention), erst der `@AGENTS.md`-Import lädt es in jede Sitzung.
`npm run dev:agent-check` prüft, dass die Zeile da ist.

In `AGENTS.md` stehen Architektur, Befehle, Gates, die vier Nahtstellen und der
Beweismaßstab. Die Eigenschaften der einzelnen Anbieter und ihre Einrichtung
stehen in [`docs/setup/`](docs/setup/README.md); ältere Betriebs-Gotchas in
`docs/development/WORKFLOW.md`.

Diese Datei führt **keine eigene Fassung** davon. Der Grund ist ein belegter:
An diesem Repo arbeiten Claude, Codex, Kimi und OpenCode parallel, und
`CLAUDE.md` liest nur Claude. Wissen, das hier stand und dort nicht, war für die
anderen Anbieter unsichtbar — und zwei Fassungen derselben Wahrheit driften
auseinander. Genau diese Fehlerklasse hat ein Doku-Audit mit zehn Befunden
belegt.

Was hier steht, ist ausschließlich das, was *nur* für Claude Code gilt.
Einrichtung im Detail: [`docs/setup/claude-code.md`](docs/setup/claude-code.md).

## Vor dem ersten Schreibzugriff

1. [`STAND.md`](STAND.md) — wo wir gerade stehen, was sofort zu prüfen ist
2. `AGENTS.md` — per Import schon geladen; der Skill `projecta-workflow`
   (`.claude/skills/`) ist die Kurzfassung als Checkliste
3. `bash scripts/sync.sh start` — das Briefing aus git

## Claude-spezifisch

- **Repo-Einstellungen:** `.claude/settings.json` erlaubt nur lesende
  git-/cargo-/npm-Befehle und hängt zwei Hooks ein: `SessionStart` →
  `scripts/install-hooks.sh`, `PostToolUse` (Write/Edit) →
  `.claude/hooks/red-first.sh` (Warnung, kein Blocker). Vorschlag für weitere
  Allow-/Deny-Regeln: [`docs/setup/permissions-proposal.md`](docs/setup/permissions-proposal.md)
  — der Nutzer entscheidet und trägt ein, kein Agent.
- **MCP-Server und Plugins:** Der Start lädt MCP-Server, Plugins und Skills.
  Das kostet Zeit; `ruflo` und `desktop-commander` können dabei mit
  `CONNECT_TIMEOUT` hängen, ohne dass etwas kaputt ist (`memorix` verbindet in
  der Regel). Das Zeitlimit setzt `MCP_TIMEOUT` in `~/.claude/settings.json`.
- **Worktrees:** Claude Code arbeitet oft in `.claude/worktrees/<name>` statt im
  Hauptcheckout. Der git-Stash-Stapel ist dabei **geteilt** — nie blankes
  `git stash` / `git stash pop` benutzen, sonst greifst du in die Arbeit einer
  anderen Sitzung. Lieber ein WIP-Commit.
- **Build-Slots:** Worktrees haben kein `target/`. Vor Commit und Push
  `CARGO_TARGET_DIR` auf einen Slot setzen (`%USERPROFILE%/cargo-targets/projecta-{a,b,c}`,
  höchstens 2–3 Builds gleichzeitig). Nie `CARGO_PROFILE_*` setzen.
- **Auto-Mode:** Der Klassifikator blockt `git worktree remove` und
  `git branch -d`. Aufräumen übernimmt der Nutzer. Ob eine Allow-Regel (etwa
  für ein Prune-Skript) den Klassifikator übersteuert, ist noch nicht belegt
  (Permission-Vorschlag, Hinweis 3).
- **Subagenten und Berichte:** Schreibzugriffe von Subagenten auf
  `.pa/report_*.md` können blockiert sein. Dann den Bericht als Text an den
  Koordinator zurückgeben; der Koordinator committet ihn. Nicht umgehen.
- **Gates laufen lokal und in Push-/PR-CI**; Installer-Builds nur auf `v*`-Tags.
  Exit-Codes ungemaskiert lesen — ein `| tail` verschluckt den Status.
