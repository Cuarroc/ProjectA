# OpenCode

Rolle: Docs, Skripte, Zweitreview (GLM; DeepSeek als Worker offen, W2-09b). Stand: OpenCode 1.18.32.
Zurück zur Übersicht: [README.md](README.md).

## Konfiguration `~/.config/opencode/opencode.jsonc` (nur Struktur)

Geprüft am 04.10.2026 auf diesem PC; weiterhin nur Namen, keine Werte.

- MCP-Server `codebase-memory-mcp`.
- `model` = `opencode-go/glm-5.3`, `small_model` = `opencode-go/glm-5.3-flash`.
- Provider `ollama` (lokaler Endpunkt `127.0.0.1:11434/v1`) mit den Modellen
  `kimi-k3:cloud`, `glm-5.2:cloud`, `deepseek-v4-flash:cloud`,
  `kimi-k2.7-code:cloud`, `qwen3.8:latest`.
- Login-Zustand für den OpenCode-eigenen Weg (Zen / „OpenCode Go"):
  `~/.local/share/opencode/auth.json` (nur Präsenz prüfen, nie Inhalt zeigen).
- Keine `instructions`, keine projektspezifischen Agents.

**Lücken (Nutzeraufgabe, prüfen):**

- Das App-Profil `opencode-ollama-deepseek-v4-flash` wählt
  `ollama/deepseek-v4-flash:cloud` explizit. Das Manifest belegt weder Login
  noch Modellverfügbarkeit; ein modellgenauer interaktiver Capture fehlt.
  Das Profil trägt den Readiness-Marker `Ask anything` des OpenCode-TUI
  (NT-17, nicht modellabhängig); HQ zeigt die Verfügbarkeit ohne
  Laufzeitbeleg als unbekannt.
- Das App-Profil `opencode-glm-53-flash` ruft `opencode -m
  opencode-go/glm-5.3-flash`. Ob das Modell über den OpenCode-Go-Login
  erreichbar ist, zeigt `opencode models` — auf diesem PC nicht belegt.

## Instruktionen und Skills

- `AGENTS.md` liest OpenCode selbst aus der Projektwurzel. Ein Repo-`.opencode/`
  ist nicht nötig.
- Repo-Skills: OpenCode 1.18.32 findet `.agents/skills/` von selbst — geprobt
  am 25.09. (W1-18b) mit `opencode debug skill --pure` in einem isolierten
  Canary-Workspace, kein Modellaufruf (Beleg: PR-Text von W1-18b).
  Das eingebaute Profil steht seitdem auf `conventionAt` `.agents/skills`,
  die App stellt OpenCode-Workern also Packs bereit. Globale Skills unter
  `~/.config/opencode/`.

## Belegte Eigenschaften

- **Pfadgrenze:** OpenCode verweigert jeden Pfad außerhalb seines
  Arbeitsordners, auch `/tmp` — und dann **den ganzen Befehl**, nicht nur den
  Zugriff. Temporäres in den eigenen Arbeitsordner legen.
- **Keine Bilder** (keine Screenshot-Prüfung über OpenCode).
- **Zustellung per PTY belegt** (PR #66) auf der Default-Route; der
  DeepSeek-Worker-Adapter ist W2-09b und offen.
