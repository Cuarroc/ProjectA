@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## `AGENTS.md` ist die Quelle

Die erste Zeile importiert [`AGENTS.md`](AGENTS.md) (Claude liest sie nicht von
selbst; `npm run dev:agent-check` prüft die Zeile). Hier steht **keine eigene
Fassung** von Regeln: Codex, Kimi und OpenCode lesen `CLAUDE.md` nicht, und zwei
Fassungen driften (belegt durch ein Doku-Audit). Nur Claude-Spezifisches
gehört hierher. Provider-Setup: [`docs/setup/`](docs/setup/README.md), Details
zu Claude Code: [`docs/setup/claude-code.md`](docs/setup/claude-code.md).

Vor dem ersten Schreibzugriff: [`STAND.md`](STAND.md) lesen, dann
`bash scripts/sync.sh start` (Rest: „Start with current evidence" in `AGENTS.md`;
der Skill `projecta-workflow` ist die Checkliste dazu).

## Claude-spezifisch

- **Repo-Einstellungen:** `.claude/settings.json` erlaubt nur lesende
  git-/cargo-/npm-Befehle, sperrt das Lesen von `target/`, `node_modules/` und
  `.pa/archiv/` (Deny, Nutzer-Freigabe 05.10.) und hängt zwei Hooks ein: `SessionStart` →
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
