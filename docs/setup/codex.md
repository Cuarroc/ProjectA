# Codex CLI (GPT-6 Astra)

Rolle: Advisor für harte Entscheidungen, daneben Worker. Stand: Codex CLI
0.154.0. Zurück zur Übersicht: [README.md](README.md).

## Konfiguration `~/.codex/config.toml` (nur Felder)

| Feld | Wert auf diesem PC | Bedeutung |
|---|---|---|
| `model` | `gpt-6-astra` | Standardmodell |
| `model_reasoning_effort` | `medium` | global bewusst mittel — Worker bleiben günstig |
| `approval_policy` | `never` | keine Rückfragen |
| `sandbox_mode` | `danger-full-access` | volle Rechte im Dateisystem |
| `[projects.'<ProjectA-Pfad>'] trust_level` | `trusted` | Projekt vertraut |
| `[features] memories` | `true` | Codex-eigenes Gedächtnis |

MCP-Server: `node_repl`, `codebase-memory-mcp`. `shell_environment_policy.set`
trägt Kopien einiger Claude-Variablen — harmlos.

## Advisor-Aufruf

```sh
codex exec -c model_reasoning_effort=high "<Frage mit vollständigem Kontext>"
```

Effort `high` nur per Aufruf, nie global. Wann Worker das selbst dürfen: siehe
[README.md](README.md#advisors). Codex hat **keinen Zugriff auf ruflo-Memory**
(MCP-Handshake scheitert) — den nötigen Kontext immer in den Auftragstext
schreiben.

## Instruktionen und Skills

- `AGENTS.md` liest Codex selbst (Konvention, von der Projektwurzel aus).
- `~/.codex/AGENTS.md` ist privat und projektfremd (persönliches
  Verhaltensmodell) — gehört dem Nutzer, nicht dem Repo.
- Repo-Skills: `.agents/skills/` (Codex-Konvention; hier
  `projecta-workflow`). Eine headless Probe am 02.10.2026 mit Codex CLI
  0.154.0 (`codex exec --ephemeral --sandbox read-only --cd <worktree> -`,
  Prompt über stdin, Exit-Code 0) meldete `projecta-workflow` als tatsächlich
  entdeckt und nannte keinen weiteren Skill. Der Lauf beobachtete
  `gpt-5.6-sol` beim Provider `openai`.

  Der Nachweis ist eingeschränkt: Die vom Probe-Agenten gestarteten direkten
  Dateisystemabfragen wurden von der Read-only-Ausführungsrichtlinie blockiert;
  seine abschließende Skill-Liste stützte sich deshalb auf das anwendbare
  Repository-Inventar. Damit ist die Repo-Konvention dokumentiert, aber kein
  vollständiger unabhängiger Dateisystem-Nachweis erbracht (W1-18b).
  Globale Skills: `~/.codex/skills`, `~/.agents/skills`. Von der App
  gestartete Codex-Worker bekommen keine Packs (eingebautes Profil: `skills`
  = `unsupported`; `ConventionAt` nur per `agents.json`, PR #57).

## Hooks `.codex/hooks.json` (lokal, gitignored)

`.codex/` ist per `.gitignore` bewusst lokal, eine Datei je Checkout. Sie wird
**erzeugt, nicht kopiert**: `npm run dev:setup -- --apply` schreibt sie
(`scripts/lib/codex-hooks.mjs`), `npm run dev:doctor` meldet eine veraltete.
Eingehängt sind:

- `PostToolUse` (Write|Edit) → `.claude/hooks/red-first.sh` dieses Checkouts
- `SessionStart` → `scripts/install-hooks.sh` dieses Checkouts

Beide mit **absolutem Pfad** auf den Checkout, für den die Datei erzeugt wurde.
Die Skripte arbeiten mit `git rev-parse --show-toplevel` im aktuellen
Verzeichnis, prüfen also den Worktree, in dem Codex gerade arbeitet.

**Windows (HOOK-WIN, 07.10.2026):** Codex führt Hooks in der Shell seiner
Umgebung aus (meist PowerShell). Ein nacktes `bash` ist dort der
WindowsApps-WSL-Starter; ohne WSL-Distribution endet er mit Exit 1, und jede
Codex-Sitzung meldete „hook exited with code 1“. Deshalb trägt jeder Hook ein
`commandWindows`, das `scripts/lib/codex-git-bash-hook.ps1` aufruft: Der Wrapper
nimmt Git Bash aus `PROJECTA_GIT_BASH` oder dem Standardpfad von Git for
Windows, nie aus `PATH`. Fehlt Git Bash, endet der Hook sichtbar mit Exit 127.
stdin und der Exit-Code des Skripts gehen unverändert durch. Eine
handkopierte alte `hooks.json` ersetzt `dev:setup`; die alte Fassung bleibt
als `hooks.json.<sha12>.bak` daneben liegen.

## Belegte Eigenschaften

- **Bilder:** `codex -i <datei>` — Codex kann Screenshots ansehen.
- **Security-Themen:** Codex hat Sicherheitsaufgaben früher verweigert
  („flagged for possible cybersecurity risk", `docs/development/WORKFLOW.md`).
  Für GPT-6 Astra nicht neu belegt. Das Routing steht in
  [providers.md](providers.md) — Nahtstelle und Security zuerst an Codex
  `gpt-6-astra`, Claude-Worker nur als Ausweichen (E8 in `docs/PLAN.md`, vom
  Nutzer am 02.10.2026 bestätigt).
- **Prozessgruppe:** Codex räumt beim Befehlsende seine Prozessgruppe ab; per
  `&` gestartete Hintergrundprozesse sterben mit. Abhilfe: `setsid`.
