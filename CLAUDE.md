@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## `AGENTS.md` ist die Quelle

Die erste Zeile importiert [`AGENTS.md`](AGENTS.md) (Claude liest sie nicht von
selbst; `npm run dev:agent-check` prüft die Zeile). Hier steht **keine eigene
Fassung** von Regeln: Codex, Kimi und OpenCode lesen `CLAUDE.md` nicht, und zwei
Fassungen driften. Nur Claude-Spezifisches gehört hierher. Provider-Setup:
[`docs/setup/`](docs/setup/README.md), Details zu Claude Code:
[`docs/setup/claude-code.md`](docs/setup/claude-code.md).

Vor dem ersten Schreibzugriff: „Start with current evidence" in `AGENTS.md`
(der Skill `projecta-workflow` ist die Checkliste dazu).

## Claude-spezifisch

- **Repo-Einstellungen:** `.claude/settings.json` erlaubt lesende
  git-/cargo-Befehle sowie `cargo build`/`npm run build`/`npm install`, sperrt das Lesen von
  `target/`, `target-red-first-*/` und `node_modules/` (überall im Baum) sowie `.pa/archiv/` (Deny, Nutzer-Freigabe 05.10.) und hängt zwei Hooks ein: `SessionStart` →
  `scripts/install-hooks.sh`, `PostToolUse` (Write/Edit) →
  `.claude/hooks/red-first.sh` (Warnung, kein Blocker). Vorschlag für weitere
  Allow-/Deny-Regeln: [`docs/setup/permissions-proposal.md`](docs/setup/permissions-proposal.md)
  — der Nutzer entscheidet und trägt ein, kein Agent.
- **MCP-Server und Plugins:** Der Start lädt MCP-Server, Plugins und Skills und
  dauert. Ein Server, der mit `CONNECT_TIMEOUT` hängt, ist kein Defekt; das
  Zeitlimit setzt `MCP_TIMEOUT` in `~/.claude/settings.json`.
- **Worktrees:** Claude Code arbeitet oft in `.claude/worktrees/<name>`. Der
  git-Stash-Stapel ist mit allen Worktrees **geteilt** (Regel 4): kein
  `git stash`/`git stash pop`, lieber ein WIP-Commit.
- **Build-Slots:** Worktrees haben kein `target/`, der `pre-commit`-Hook fährt
  aber `cargo check`, sobald ein Rust-Input (auch `docs/PLAN.md`) im Commit
  ist. Vor Commit und Push also `CARGO_TARGET_DIR` setzen („Build slots" in
  `AGENTS.md`).
- **Auto-Mode:** Der Klassifikator blockt `git worktree remove` und
  `git branch -d`. Aufräumen übernimmt der Nutzer. Ob eine Allow-Regel (etwa
  für ein Prune-Skript) den Klassifikator übersteuert, ist noch nicht belegt
  (Permission-Vorschlag, Hinweis 3).
- **Subagenten und Berichte:** Kann ein Subagent keinen PR öffnen oder nicht
  in `.pa/` schreiben, gibt er den Bericht als Text an den Koordinator zurück
  („Record and learn" in `AGENTS.md`). Nicht umgehen.
- **Installer-Builds** laufen nur auf `v*`-Tags.
