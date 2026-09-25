# Anbieter, Modelle, Einsatz — die Routing-Tabelle für den Orchestrator

Welche Agenten der Orchestrator einsetzen kann, mit welchem Modell und welchem
Effort, für welche Art Arbeit. Stand **25.09.2026**, geprüft auf dem
Entwicklungsrechner. Die Einrichtung je Harness steht in den Nachbarseiten
([codex.md](codex.md), [kimi.md](kimi.md), [opencode.md](opencode.md),
[ollama-reviewers.md](ollama-reviewers.md), [claude-code.md](claude-code.md)).

**Nur Abos.** Keine API-Keys, kein OpenRouter, keine OpenCode-Zen-Modelle
(`opencode/*` — die rechnen Guthaben ab), keine zusätzlichen bezahlten Ausgaben
(Nutzerentscheidung 25.09.). Diese Seite nennt nie Schlüsselwerte.

„Geprüft“ heißt: am 25.09. mit einem echten Aufruf belegt. „Ungeprüft“ heißt:
installiert oder im Abo enthalten, aber noch nicht als Worker gelaufen — vor dem
ersten echten Paket einmal proben.

## Ziel der Verteilung

1. **Claude spart.** Claude (Abo) ist Orchestrator und sonst nichts
   Alltägliches. Claude-Worker nur für Nahtstellen oder Security, und nur wenn
   das Wochenlimit unter 70 % steht. Der Orchestrator prüft das Limit vor jedem
   Start (`get_usage` in der Claude-App, sonst die Nutzungsanzeige).
2. **Die übrigen Abos gleichmäßig ausschöpfen.** Neue Pakete gehen reihum an
   den Anbieter, der zuletzt am wenigsten bekommen hat; ein Anbieter mit
   Limit-Treffer (429, „usage limit“) fällt aus der Runde, bis sein Fenster
   zurückgesetzt ist.
3. **Review nie beim Autor-Anbieter.** Zwei Reviewer anderer Anbieter
   (`AGENTS.md`, Beweismaßstab). Das Ollama-Paar deckt den Alltag ab; kommt der
   Autor selbst von Kimi oder GLM, ersetzt Codex oder Copilot den gleichnamigen
   Reviewer.
4. **RAM ist die harte Grenze.** 16 GB, oft unter 2 GB frei. Höchstens
   2–3 Worker gleichzeitig und nie mehr als ein `cargo`-Build zur selben Zeit;
   vor jedem Start freien Speicher prüfen (unter 1,5 GB kein neuer Worker).

## Übersicht

| Anbieter (Abo) | Harness / Start | Status 25.09. | Stärkstes Modell | Arbeitspferd | Schnell / billig |
|---|---|---|---|---|---|
| OpenAI (ChatGPT-Abo) | Codex CLI 0.154 | geprüft | `gpt-6-astra` | `gpt-6-sol` | `gpt-6-luna` |
| Moonshot (Kimi-Code-Abo) | Kimi Code CLI 2.1 | geprüft (`kimi -p`) | `kimi-code/k3` | `kimi-code/k3` | `kimi-code/kimi-for-coding-highspeed` |
| OpenCode Go (Abo) | OpenCode CLI | geprüft (Orca-Worker, GLM-5.3-Flash) | `opencode-go/glm-5.3`, `opencode-go/deepseek-v4-pro`, `opencode-go/qwen3.8-max` | `opencode-go/glm-5.3` | `opencode-go/glm-5.3-flash` |
| Ollama Cloud (Abo) | `.pa/review_transport.py`, HTTP `localhost:11434` | geprüft | `kimi-k3:cloud` | `glm-5.2:cloud` | `deepseek-v4-flash:cloud` |
| GitHub Copilot (Abo) | OpenCode, Provider `github-copilot` | ungeprüft | `github-copilot/gpt-5.6-terra`, `github-copilot/claude-sonnet-5` | `github-copilot/gpt-5.4` | `github-copilot/gpt-5-mini` |
| Cursor (Abo) | `cursor-agent` | **Login fehlt** (`cursor-agent login`) | — | — | — |
| Google (Antigravity / Gemini) | Antigravity IDE | ungeprüft, kein Agent-CLI im PATH | — | — | — |
| xAI (SuperGrok Lite) | Grok CLI 1.0.41 (`~/.grok/bin/grok`) | installiert, **Login fehlt** (`grok` startet den Browser-Login); ob Lite für die CLI reicht, ist ungeprüft | `grok-4.7` | `grok-4.7` | — |
| Anthropic (Claude Pro) | Claude Code (Desktop-App) | geprüft | Fable 5.1 (Advisor) | Opus 5.5 (Orchestrator) | — |

## Einsatz nach Aufgabe

| Aufgabe | 1. Wahl | Effort | Ausweichen |
|---|---|---|---|
| Nahtstelle (`api.rs`, `main.rs`, `store/`, `bin/pa.rs`), Security | Codex `gpt-6-astra` | `high` | Claude-Worker (nur < 70 % Wochenlimit) |
| Rust-Paket ohne Nahtstelle | Codex `gpt-6-sol` | `medium`, bei rotem Test `high` | Kimi `k3` |
| Frontend / HQ (React, TS, `scripts/lib`) | Kimi `k3` | thinking `high` (Standard) | OpenCode `glm-5.3` |
| Doku, Plan, Berichte, kleine Skripte | OpenCode `glm-5.3` | `medium` | Kimi `kimi-for-coding-highspeed` |
| Triviales (Tippfehler, Tabellenzeile, `npm run hq`) | OpenCode `glm-5.3-flash` | `low` | Codex `gpt-6-luna` `low` |
| Alltagsreview (Paar) | Ollama `kimi-k3:cloud` + `glm-5.2:cloud` | — | Copilot `gpt-5.6-terra`, OpenCode `deepseek-v4-pro` |
| Zweitmeinung zu einer Architekturfrage | Codex `gpt-6-astra` | `xhigh` | OpenCode `qwen3.8-max` |
| Harte Entscheidung / Abschlussreview (Advisor-Paar) | Fable 5.1 + Codex `gpt-6-astra` | max / `high` | — (siehe README, Abschnitt Advisors) |

Die Zuordnung ist eine Empfehlung des Orchestrators, keine Messung. Wer einen
Anbieter für eine Aufgabenart als besser oder schlechter belegt, trägt den
Beleg hier ein.

Effort-Stufen: Codex kennt `low` bis `ultra` für `astra`/`sol`, bis `max` für
`luna`; global steht `medium` in `~/.codex/config.toml`. Mehr als `high` nur
für Architektur- und Security-Fragen — `xhigh` und darüber brennen das
Codex-Fenster schnell ab. Kimi K3 läuft mit `thinking: high`, ein Effort-Flag
gibt es in Kimi Code nicht. OpenCode Go zeigt `high` in der Statuszeile; das
Modell stellt man im TUI mit `/models` oder mit `-m` beim Start.

## Start-Rezepte

Headless aus der Orchestrator-Sitzung (Hintergrund-Job; meldet sich beim Ende,
kein Polling nötig):

```sh
codex exec -m gpt-6-sol -c model_reasoning_effort=medium --sandbox workspace-write - < spec.md
kimi -p "$(cat spec.md)" -m kimi-code/k3
opencode run -m opencode-go/glm-5.3 "$(cat spec.md)"
opencode run -m github-copilot/gpt-5.6-terra "$(cat spec.md)"   # ungeprüft
grok -p "$(cat spec.md)" -m grok-4.7 --reasoning-effort high   # ungeprüft, nach Login
```

Reviews immer lesend: `codex exec --sandbox read-only -m gpt-6-astra -c model_reasoning_effort=high - < prompt`,
Ollama über `.pa/review_transport.py`.

Über Orca (sichtbares TUI, Postfach mit `worker_done`; der Orchestrator
braucht dafür ein eigenes Orca-Terminal als Absender, `--from <handle>`):

```sh
orca orchestration worker-start --spec "<Auftrag>" --worktree branch:<branch> --agent opencode --run <run> --from <handle> --json
orca orchestration worker-start --spec "<Auftrag>" --worktree branch:<branch> --agent codex --model gpt-6-sol --effort medium --run <run> --from <handle> --json
```

Befunde aus dem Orca-Pilot am 25.09. (Orca 1.4.210):

- OpenCode: startet in etwa 10 s und arbeitet den Auftrag ab.
- Kimi Code 2.1.1: Orca erkennt es nicht als Agent (`agent_unconfigured`,
  Bereitschaft läuft in den Timeout) → Kimi nur headless.
- Jeder neue Arbeitsbaum fragt bei Kimi einmal „Trust this folder?“.
- `--model`/`--effort` gelten nur für Claude, Codex, Cursor und Antigravity;
  bei OpenCode greift das Modell aus dessen Konfiguration (Standard
  `glm-5.3-flash`).
- Orca selbst belegt rund 0,75 GB RAM, ein OpenCode-TUI knapp 1 GB.

## Wie voll ist welches Abo?

| Anbieter | Wo nachsehen |
|---|---|
| Claude | Claude-App → Nutzung; im Orchestrator `get_usage` (5-h-Fenster, Woche, Extra-Nutzung) |
| Codex | `/status` im Codex-TUI; headless gibt es keine Anzeige, ein Limit-Treffer bricht den Lauf ab |
| Kimi | Kimi-Code-Konto auf kimi.com |
| OpenCode Go | Statuszeile im TUI, Konto auf opencode.ai |
| Ollama Cloud | HTTP 429 „session limit“ = Fenster voll; Konto auf ollama.com |
| Copilot | github.com → Settings → Copilot (Premium-Anfragen) |

Nutzungszahlen nie schätzen und nie als gemessen ausgeben, was nur konfiguriert
ist (`AGENTS.md`, Development loop).

## Offen

- Cursor: `cursor-agent login` durch den Nutzer, dann ein Probelauf `cursor-agent -p`.
- Antigravity / Gemini: Agent-CLI finden oder installieren, dann proben.
- Grok: Nutzer meldet sich einmal mit `grok` an; dann Probelauf `grok -p`. Hinweis:
  der Installer legt auch `~/.grok/bin/agent.exe` an und steht vorn im PATH —
  `agent` startet damit Grok, nicht Cursor; für Cursor `cursor-agent` benutzen.
- Copilot über OpenCode: Login und Premium-Kontingent einmal belegen.
- Kimi in Orca: erneut prüfen, sobald Orca Kimi Code 2.x erkennt.
