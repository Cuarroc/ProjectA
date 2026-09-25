# Kimi Code CLI (Kimi K3)

Rolle: Frontend-/HQ-Worker, Reviews. Zurück zur Übersicht: [README.md](README.md).

## Welche Harness

Die Harness ist **Kimi Code CLI 2.0** — `~/.kimi-code/bin/kimi.EXE`,
Konfiguration `~/.kimi-code/config.toml`, Standardmodell `kimi-code/k3`.
Andere Verzeichnisse `~/.kimi`, `~/.kimi-work`, `~/.kimi_openclaw`,
`~/.kimi-webbridge` gehören zu anderen Produkten (Claw, OpenClaw,
WebBridge-Daemon) und sind **nicht** die Harness.

Relevante Felder in `config.toml` (nur Namen): `default_model`,
`default_plan_mode = true`, `default_permission_mode`, Abschnitte
`[providers.…]`, `[models.…]`. Selbstprüfung: `kimi doctor`.

## Anmeldung: OAuth-Datei, kein API-Key

- Der Kimi-Code-Provider `[providers."managed:kimi-code"]` meldet sich über
  **OAuth** an: `[providers."managed:kimi-code".oauth] storage = "file"`, die
  Zugangsdaten liegen unter `~/.kimi-code/credentials/`. Anmelden mit
  `kimi login` (Device-Code-Ablauf).
- `MOONSHOT_API_KEY` wird von dieser Konfiguration **nirgends** benutzt. Die
  Annahme in `src-tauri/src/profiles.rs` („`MOONSHOT_API_KEY` for a Kimi …")
  gilt für diese Harness nicht; das behandelt W5-02b6.
- Folge für eine Umgebungs-Allowlist (W5-02b6): Kimi braucht `USERPROFILE`,
  `HOME`, `APPDATA`, `LOCALAPPDATA` (Zugriff auf `~/.kimi-code/credentials/`),
  nicht `MOONSHOT_API_KEY`. Abnahme: `kimi -p "sieben mal sechs"` unter der
  Allowlist-Umgebung muss `42` liefern.

## Im Worker

- Die App startet Kimi mit `--auto` (Never-Ask-Modus) und Repo-Skills über
  `--skills-dir <dir>` (`src-tauri/src/profiles.rs`, `capabilities.rs`).
- `default_plan_mode = true` startet interaktive Sitzungen im Plan-Modus.
- `AGENTS.md` des Repos liest Kimi Code selbst; `~/.kimi-code/AGENTS.md` ist
  eine globale, private Datei des Nutzers.
- MCP: `codebase-memory-mcp` (`~/.kimi-code/mcp.json`).

## Provider-Keys: Stand und Nutzeraufgabe

**Keine Env-Referenzen möglich.** Kimi Code CLI 2.0 kennt als
Provider-Zugangsdaten nur ein literales `api_key` oder `oauth`. Ein Feld
`api_key_env` gibt es nicht (geprüft im Binary `~/.kimi-code/bin/kimi.EXE`).
Der einzige Env-Fallback hängt am Provider-Typ und liest ausschließlich aus der
`env`-Tabelle des Providers in `config.toml` (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `KIMI_API_KEY`), **nicht** aus der Prozessumgebung — ein
Key stünde also trotzdem im Klartext in der Datei.

**Stand 24.09.2026** (vom Koordinator mit Nutzerfreigabe umgesetzt):

| Provider | Zugang | Stand |
|---|---|---|
| `managed:kimi-code` | OAuth | aktiv, Standardmodell `kimi-code/k3` |
| `anthropic` | — | Key geleert (nach „nur Abos" ungenutzt) |
| `openrouter` | — | Key geleert (kein OpenRouter) |
| `opencode` | literaler `api_key` | bleibt bewusst: ein globales `OPENAI_API_KEY` würde Codex auf API-Abrechnung umstellen (Regel „nur Abos") |

Die Sicherung vor dem Leeren liegt neben `config.toml`.

**Was der Nutzer selbst macht** (kein Agent liest oder zeigt die Werte):

1. **Alte Sicherungen löschen.** Im Ordner `~/.kimi-code/` enthalten die
   Sicherungen `config.toml.bak*` (u. a. `config.toml.bak`,
   `config.toml.bak-sessionhook`) und `config.toml.20260823-040800.bak` sowie
   die Sicherung vom Leeren noch die Klartext-Keys. Wenn nicht mehr gebraucht,
   löschen.
2. **Rotieren.** Die Keys, die im Klartext auf der Platte lagen (Anthropic,
   OpenRouter, OpenCode), beim jeweiligen Anbieter neu erzeugen und den alten
   widerrufen. Den neuen OpenCode-Key wieder als `api_key` in
   `[providers.opencode]` eintragen — mit einem Editor, der UTF-8 erhält (nicht
   PowerShell `Set-Content`), und nicht über eine Shell-Zeile (History).
3. **Prüfen:** `kimi provider list` zeigt die Provider-IDs (hier
   `anthropic`, `managed:kimi-code`, `opencode`, `openrouter`); `kimi doctor`
   prüft die Konfiguration. Nicht mehr gebrauchte Provider lassen sich mit
   `kimi provider remove <providerId>` ganz entfernen (entfernt auch die
   Modell-Aliase, die darauf zeigen).
