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
- Repo-Skills: `.agents/skills/` (Codex-Konvention; hier `projecta-workflow`).
  Dass Codex den Repo-Skill in diesem Repo wirklich lädt, ist nicht geprobt
  (W1-18b).
  Globale Skills: `~/.codex/skills`, `~/.agents/skills`. Von der App
  gestartete Codex-Worker bekommen keine Packs (eingebautes Profil: `skills`
  = `unsupported`; `ConventionAt` nur per `agents.json`, PR #57).

## Hooks `.codex/hooks.json` (lokal, gitignored)

`.codex/` ist per `.gitignore` bewusst lokal. `hooks.json` hängt ein:

- `PostToolUse` (Write|Edit) → `bash '<Hauptcheckout>\.codex\hooks\red-first.sh'`
  (**absoluter Pfad**)
- `SessionStart` → `bash scripts/install-hooks.sh` (relativ)

Der absolute Pfad ist **richtig so** und soll nicht relativ werden: Weil
`.codex/` gitignored ist, gibt es das Skript in Codex-Worktrees gar nicht — ein
relativer Pfad liefe dort ins Leere. Das Skript selbst arbeitet mit
`git rev-parse --show-toplevel` im aktuellen Verzeichnis, prüft also immer den
Worktree, in dem Codex gerade arbeitet (geprüft 24.09.2026).

## Belegte Eigenschaften

- **Bilder:** `codex -i <datei>` — Codex kann Screenshots ansehen.
- **Security-Themen:** Codex hat Sicherheitsaufgaben früher verweigert
  („flagged for possible cybersecurity risk", `docs/development/WORKFLOW.md`).
  Für GPT-6 Astra nicht neu belegt — Security-Lanes weiter an Claude.
- **Prozessgruppe:** Codex räumt beim Befehlsende seine Prozessgruppe ab; per
  `&` gestartete Hintergrundprozesse sterben mit. Abhilfe: `setsid`.
