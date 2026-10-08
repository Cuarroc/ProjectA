# Anbieter, Modelle, Einsatz — die Routing-Tabelle für den Orchestrator

Welche Agenten der Orchestrator einsetzen kann, mit welchem Modell und welchem
Effort, für welche Art Arbeit. Stand **25.09.2026**, geprüft auf dem
Entwicklungsrechner; Nachtrag **02.10.2026**: Kimi-Code-Abo abgelaufen,
Codex-Modellnamen aus `~/.codex/models_cache.json` korrigiert. Die Einrichtung
je Harness steht in den Nachbarseiten
([codex.md](codex.md), [kimi.md](kimi.md), [opencode.md](opencode.md),
[ollama-reviewers.md](ollama-reviewers.md), [claude-code.md](claude-code.md)).

**Nur Abos.** Keine API-Keys, kein OpenRouter, keine OpenCode-Zen-Modelle
(`opencode/*` — die rechnen Guthaben ab), keine zusätzlichen bezahlten Ausgaben
(Nutzerentscheidung 25.09.). Diese Seite nennt nie Schlüsselwerte.

„Geprüft“ heißt: am 25.09. mit einem echten Aufruf belegt. „Ungeprüft“ heißt:
installiert oder im Abo enthalten, aber noch nicht als Worker gelaufen — vor dem
ersten echten Paket einmal proben.

## Ziel der Verteilung

1. **Claude spart.** Claude (Pro-Abo) ist Orchestrator und sonst nichts
   Alltägliches. Claude-Worker nur für Nahtstellen oder Security, und nur wenn
   das Wochenlimit unter 70 % steht. Der Orchestrator prüft das Limit vor jedem
   Start (`get_usage` in der Claude-App, sonst die Nutzungsanzeige).
2. **Die übrigen Abos gleichmäßig ausschöpfen.** Neue Pakete gehen reihum an
   den Anbieter, der zuletzt am wenigsten bekommen hat; ein Anbieter mit
   Limit-Treffer (429, „usage limit“) fällt aus der Runde, bis sein Fenster
   zurückgesetzt ist.
3. **Review nie beim Autor-Anbieter.** Zwei Reviewer anderer Anbieter
   (`AGENTS.md`, Beweismaßstab). Das Ollama-Paar deckt den Alltag ab; kommt der
   Autor selbst von GLM, ersetzt Codex oder Copilot den gleichnamigen
   Reviewer.
4. **RAM ist die harte Grenze.** 16 GB, oft unter 2 GB frei. Höchstens
   2–3 Worker gleichzeitig und höchstens drei `cargo`-Builds, bei knappem RAM
   zwei (AGENTS.md, „Build slots“); vor jedem Start freien Speicher prüfen
   (unter 1,5 GB kein neuer Worker, AGENTS.md Regel 9).

## Übersicht

| Anbieter (Abo) | Harness / Start | Status 25.09. | Stärkstes Modell | Arbeitspferd | Schnell / billig |
|---|---|---|---|---|---|
| OpenAI (ChatGPT-Abo) | Codex CLI 0.160 | geprüft (Skill-Sonde 08.10.2026 positiv, siehe [codex.md](codex.md)) | `gpt-6-astra` | `gpt-5.6-sol` | `gpt-5.6-luna` (Mitte: `gpt-5.6-terra`) |
| Moonshot (Kimi-Code-Abo) | Kimi Code CLI 2.1 | **Abo abgelaufen (02.10.)**, nicht einplanen | — | — | — |
| OpenCode Go (Abo) | OpenCode CLI | geprüft (Orca-Worker, GLM-5.3-Flash) | `opencode-go/glm-5.3`, `opencode-go/deepseek-v4-pro`, `opencode-go/qwen3.8-max` | `opencode-go/glm-5.3` | `opencode-go/glm-5.3-flash` |
| Ollama Cloud (Abo) | `.pa/review_transport.py`, HTTP `localhost:11434` | geprüft | `kimi-k3:cloud` | `glm-5.2:cloud` | `deepseek-v4-flash:cloud` |
| GitHub Copilot (Abo) | OpenCode, Provider `github-copilot` | ungeprüft | `github-copilot/gpt-5.6-terra`, `github-copilot/claude-sonnet-5` | `github-copilot/gpt-5.4` | `github-copilot/gpt-5-mini` |
| Google (Antigravity / Gemini) | Antigravity IDE | ungeprüft, kein Agent-CLI im PATH | — | — | — |
| xAI (SuperGrok Lite) | Grok CLI 1.0.41 (`~/.grok/bin/grok`) | installiert, **Login fehlt** (`grok` startet den Browser-Login); ob Lite für die CLI reicht, ist ungeprüft | `grok-4.7` | `grok-4.7` | — |
| Anthropic (Claude Pro) | Claude Code (Desktop-App) | geprüft | Fable 5.1 (Advisor) | Opus 5.5 (Orchestrator) | — |

## Einsatz nach Aufgabe

| Aufgabe | 1. Wahl | Effort | Ausweichen |
|---|---|---|---|
| Nahtstelle (`api.rs`, `main.rs`, `store/`, `bin/pa.rs`), Security | Codex `gpt-6-astra` | `high` | Claude-Worker (nur < 70 % Wochenlimit) |
| Rust-Paket ohne Nahtstelle | Codex `gpt-5.6-sol` | `medium`, bei rotem Test `high` | OpenCode `deepseek-v4-pro` |
| Frontend / HQ (React, TS, `scripts/lib`) | Codex `gpt-5.6-terra` | `medium` | OpenCode `glm-5.3` |
| Doku, Plan, Berichte, kleine Skripte | OpenCode `glm-5.3` | `medium` | Codex `gpt-5.6-luna` |
| Triviales (Tippfehler, Tabellenzeile, `npm run hq`) | OpenCode `glm-5.3-flash` | `low` | Codex `gpt-5.6-luna` `low` |
| Alltagsreview (Paar) | Ollama `kimi-k3:cloud` + `glm-5.2:cloud` | — | Copilot `gpt-5.6-terra`, OpenCode `deepseek-v4-pro` |
| Zweitmeinung zu einer Architekturfrage | Codex `gpt-6-astra` | `xhigh` | OpenCode `qwen3.8-max` |
| Harte Entscheidung / Abschlussreview (Advisor-Paar) | Fable 5.1 + Codex `gpt-6-astra` | max / `high` | — (siehe README, Abschnitt Advisors) |

Modellnamen in dieser Tabelle, die oben nicht als „geprüft“ stehen, sind nicht
beobachtet (Prüfung C, F9): vor dem ersten Einsatz mit dem Startcheck bestätigen
(AGENTS.md, Regel 9). Diese Tabelle ist die einzige Routing-Quelle.

Die Zuordnung ist eine Empfehlung des Orchestrators, keine Messung. Wer einen
Anbieter für eine Aufgabenart als besser oder schlechter belegt, trägt den
Beleg hier ein.

Effort-Stufen: Codex kennt `low` bis `ultra` für `astra`/`sol`, bis `max` für
`luna`; global stehen `gpt-6-astra` und `medium` in `~/.codex/config.toml`
(geprüft 04.10.2026, wie in [codex.md](codex.md)). Mehr als `high` nur
für Architektur- und Security-Fragen — `xhigh` und darüber brennen das
Codex-Fenster schnell ab. OpenCode Go zeigt `high` in der Statuszeile; das
Modell stellt man im TUI mit `/models` oder mit `-m` beim Start.

## Start-Rezepte

Headless aus der Orchestrator-Sitzung (Hintergrund-Job; meldet sich beim Ende,
kein Polling nötig):

```sh
codex exec -m gpt-5.6-sol -c model_reasoning_effort=medium --sandbox workspace-write - < spec.md
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
orca orchestration worker-start --spec "<Auftrag>" --worktree branch:<branch> --agent codex --model gpt-5.6-sol --effort medium --run <run> --from <handle> --json
```

Befunde aus dem Orca-Pilot am 25.09. (Orca 1.4.210):

- OpenCode: startet in etwa 10 s und arbeitet den Auftrag ab.
- `--model`/`--effort` gelten nur für Claude, Codex und Antigravity;
  bei OpenCode greift das Modell aus dessen Konfiguration: `model` =
  `opencode-go/glm-5.3`, `small_model` = `opencode-go/glm-5.3-flash`
  (`~/.config/opencode/opencode.jsonc`, geprüft 04.10.2026).
- Orca selbst belegt rund 0,75 GB RAM, ein OpenCode-TUI knapp 1 GB.

## Wie voll ist welches Abo?

| Anbieter | Wo nachsehen |
|---|---|
| Claude | Claude-App → Nutzung; im Orchestrator `get_usage` (5-h-Fenster, Woche, Extra-Nutzung) |
| Codex | `/status` im Codex-TUI; headless: das letzte `rate_limits`-Objekt in `~/.codex/sessions/<Datum>/*.jsonl` (`used_percent`, `resets_at`) |
| OpenCode Go | Statuszeile im TUI, Konto auf opencode.ai |
| Ollama Cloud | HTTP 429 „session limit“ = Fenster voll; Konto auf ollama.com |
| Copilot | github.com → Settings → Copilot (Premium-Anfragen) |

Nutzungszahlen nie schätzen und nie als gemessen ausgeben, was nur konfiguriert
ist (`AGENTS.md`, Development loop).

## Offen

- Antigravity / Gemini: Agent-CLI finden oder installieren, dann proben.
- Grok: Nutzer meldet sich einmal mit `grok` an; dann Probelauf `grok -p`. Hinweis:
  der Installer legt auch `~/.grok/bin/agent.exe` an und steht vorn im PATH —
  `agent` startet damit Grok.
- Copilot über OpenCode: Login und Premium-Kontingent einmal belegen.
