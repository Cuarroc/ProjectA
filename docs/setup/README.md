# Agenten-Setup je Anbieter

Wie die KI-Werkzeuge auf dem Entwicklungsrechner für ProjectA eingerichtet
sind, was jedes davon liest und wie man prüft, ob alles da ist. Stand
24.09.2026 (Audit SETUP-A). Diese Seiten nennen für Zugangsdaten **nur
Dateinamen und Namen von Umgebungsvariablen, nie Werte**; Einstellungswerte
ohne Geheimnis (Modellname, Effort) stehen dabei.

Die Arbeitsregeln selbst stehen in [`AGENTS.md`](../../AGENTS.md); diese Seiten
beschreiben nur die Einrichtung.

## Prüfen

```sh
npm run dev:agent-check            # Textausgabe
npm run dev:agent-check -- --json  # maschinenlesbar
```

Exit 1 nur bei einem Pflichtfehler: Node ≥ 24, `git`, `gh`, `cargo`,
`AGENTS.md`, `@AGENTS.md`-Import in `CLAUDE.md`, `core.hooksPath` → `.githooks`,
beide Kopien des Skills `projecta-workflow` identisch. Alles andere
(optionale Harnesses, Reviewer-Modelle, `gh`-Login, Build-Slots,
Konfig-Dateien) ist eine Warnung.

## Wer macht was

| Anbieter | Harness | Rolle | Seite |
|---|---|---|---|
| Claude (Opus / Fable 5.1) | Claude Code | Koordinator; Fable 5.1 als Advisor; Nahtstellen/Security nur als Ausweichen (Routing: [providers.md](providers.md)) | [claude-code.md](claude-code.md) |
| OpenAI GPT-6 Astra | Codex CLI | Advisor (Effort `high` je Aufruf), Worker | [codex.md](codex.md) |
| Kimi K3 | Kimi Code CLI | Frontend/HQ-Worker, Reviews | [kimi.md](kimi.md) |
| GLM (DeepSeek offen, W2-09b) | OpenCode | Docs, Skripte, Zweitreview | [opencode.md](opencode.md) |
| kimi-k3 + glm-5.2 (Ollama Cloud) | `.pa/review_transport.py` | Alltags-Reviewerpaar | [ollama-reviewers.md](ollama-reviewers.md) |
| — | Mergify | Merge-Queue für `main` (`.mergify.yml`) | [mergify.md](mergify.md) |

Welcher Anbieter mit welchem Modell und Effort für welche Aufgabe, und wie die
Abos gleichmäßig ausgeschöpft werden: [providers.md](providers.md).

Nur Abos, kein OpenRouter, keine zusätzlichen bezahlten API-Ausgaben.

## Welche Instruktionsdatei liest wer

| Harness | `AGENTS.md` | Repo-Skills |
|---|---|---|
| Claude Code | über den Import `@AGENTS.md` in der ersten Zeile von `CLAUDE.md` (nicht von selbst) | `.claude/skills/` |
| Codex CLI | automatisch (Konvention, Projektwurzel) | `.agents/skills/` laut Codex-Konvention; auf diesem PC nicht geprobt (W1-18b, Codex-Probe nach dem Rate-Limit am 30.09.) |
| OpenCode | automatisch (Projektwurzel) | `.agents/skills/`, geprobt 25.09. mit OpenCode 1.18.32 (W1-18b, Beleg im PR-Text) |
| Kimi Code CLI | automatisch | `--skills-dir <dir>` (so startet die App Kimi-Worker) |
| Ollama-Reviewer | **nie** — sie sehen nur die Prompt-Datei | — |

Die App stellt Skill-Packs für Claude (Konvention), Kimi (`--skills-dir`) und
OpenCode (`conventionAt` `.agents/skills`, eingebautes Profil seit W1-18b)
bereit; für Codex steht das eingebaute Profil weiter auf `unsupported`
(`src-tauri/resources/agent-defaults.json`), bis die Probe nachgeholt ist. Der
Modus `ConventionAt` (PR #57) lässt sich zusätzlich per `agents.json` setzen.

Der Repo-Skill `projecta-workflow` ist die Kurzfassung der Arbeitsweise als
Checkliste. Er liegt zweimal im Repo, byte-gleich bis auf Zeilenenden:
`.agents/skills/projecta-workflow/SKILL.md` (Codex-Konvention; findet OpenCode seit der W1-18b-Probe ebenfalls) und
`.claude/skills/projecta-workflow/SKILL.md` (Claude Code). Geändert wird die
`.agents`-Fassung, dann kopiert; `dev:agent-check` schlägt bei Abweichung an.

## Advisors

Für harte Entscheidungen und Abschlussreviews gilt das Advisor-Paar
**Fable 5.1** (Claude-Subagent, maximaler Effort) + **GPT-6 Astra** (Codex CLI,
`-c model_reasoning_effort=high` je Aufruf; global bleibt `medium`). Worker
dürfen die Advisors selbst rufen bei Nahtstellen-, Security- und
Architekturentscheidungen und wenn sie länger als 30 Minuten feststecken; sonst
über den Koordinator. Rückfragen der Advisors gehen an den Koordinator, der
den Nutzer fragt. Alltagsreviews laufen über das Ollama-Paar.

## Berechtigungen

Vorschlag für Allow-/Deny-Regeln in `.claude/settings.json`:
[permissions-proposal.md](permissions-proposal.md). Der Nutzer entscheidet und
trägt sie ein; kein Agent ändert seine eigenen Rechte.
