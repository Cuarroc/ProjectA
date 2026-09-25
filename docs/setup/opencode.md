# OpenCode

Rolle: Docs, Skripte, Zweitreview (GLM; DeepSeek als Worker offen, W2-09b). Stand: OpenCode 1.18.32.
Zurück zur Übersicht: [README.md](README.md).

## Konfiguration `~/.config/opencode/opencode.jsonc` (nur Struktur)

- MCP-Server `codebase-memory-mcp`.
- Provider `ollama` (lokaler Endpunkt `127.0.0.1:11434/v1`) mit den Modellen
  `kimi-k2.7-code:cloud`, `glm-5.2:cloud`, `qwen3.8:latest`.
- Login-Zustand für den OpenCode-eigenen Weg (Zen / „OpenCode Go"):
  `~/.local/share/opencode/auth.json` (nur Präsenz prüfen, nie Inhalt zeigen).
- Kein `model`-Default, keine `instructions`, keine projektspezifischen Agents.

**Lücken (Nutzeraufgabe, prüfen):**

- `deepseek-v4-flash:cloud` steht **nicht** im `ollama`-Provider dieser
  Konfiguration, ist also in OpenCode nicht wählbar. Das Modell selbst ist in
  Ollama vorhanden (`ollama list`); das App-Profil `ollama-coder` startet es
  direkt über `ollama run`, nicht über OpenCode. Wer DeepSeek als
  OpenCode-Worker will (W2-09b), trägt es unter `provider.ollama.models` ein.
- Das App-Profil `opencode-glm-53-flash` ruft `opencode -m
  opencode-go/glm-5.3-flash`. Ob das Modell über den OpenCode-Go-Login
  erreichbar ist, zeigt `opencode models` — auf diesem PC nicht belegt.

## Instruktionen und Skills

- `AGENTS.md` liest OpenCode selbst aus der Projektwurzel. Ein Repo-`.opencode/`
  ist nicht nötig.
- Repo-Skills: ob OpenCode `.agents/skills/` von selbst findet, ist nicht
  belegt (Probe W1-18b offen). Die App stellt OpenCode-Workern keine Packs
  bereit (eingebautes Profil: `skills` = `unsupported`); per `agents.json`
  ließe sich `ConventionAt` setzen (PR #57). Globale Skills unter
  `~/.config/opencode/`.

## Belegte Eigenschaften

- **Pfadgrenze:** OpenCode verweigert jeden Pfad außerhalb seines
  Arbeitsordners, auch `/tmp` — und dann **den ganzen Befehl**, nicht nur den
  Zugriff. Temporäres in den eigenen Arbeitsordner legen.
- **Keine Bilder** (keine Screenshot-Prüfung über OpenCode).
- **Zustellung per PTY belegt** (PR #66) auf der Default-Route; der
  DeepSeek-Worker-Adapter ist W2-09b und offen.
