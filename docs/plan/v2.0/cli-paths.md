# V2-CLI-0 — Anbieter-Wege (Claude, Codex, Ollama)

Stand der Beobachtung: 2026-10-10 auf dem ProjectA-Server-Arbeiter
(Linux). Nur die drei Wege aus `plan.md` Abschnitt 3.1 (V2-CLI-0). Kein
Laufzeitcode; Folgepakete: V2-CLI-1 (Claude/Codex-Aufrufe), V2-LOCAL-1
(lokales Ollama-Modell). Profil-Befehle heute in
`src-tauri/resources/agent-defaults.json` (vor dem Start neu prüfen).

**Hinweis:** Keine Rechtsberatung. Nutzungsbedingungen nur mit Quelle und
Abrufdatum; ohne belegte Quelle steht „prüfen“.

## 1. Drei Wege — beobachtete Aufrufe

| Weg | Befehl | Version | Exit | Lizenz |
|---|---|---|---|---|
| Claude Code | `claude --version` | `2.1.287 (Claude Code)` | 0 | prüfen |
| Codex CLI | `codex --version` | `codex-cli 0.160.0` | 0 | prüfen |
| Ollama (lokal) | `ollama --version` | prüfen (Befehl nicht im PATH; Meldung „Command not found“) | 127 | prüfen |

Beobachtungsdatum: 2026-10-10. Ohne erneute Beobachtung gilt „prüfen“.
Ein Modellname gehört nicht in diese Tabelle; den liefert erst ein
beobachteter Lauf (V2-CLI-1 / V2-LOCAL-1). Ein Ollama-Modell mit Endung
`:cloud` zählt laut Plan **nicht** als lokaler Weg.

## 2. Nutzungsbedingungen (Abo-CLIs, automatisierte Nutzung)

| Weg | Aussage zu automatisierter Abo-CLI-Nutzung | Quelle | Abrufdatum |
|---|---|---|---|
| Claude Code | prüfen | prüfen | prüfen |
| Codex CLI | prüfen | prüfen | prüfen |
| Ollama | prüfen | prüfen | prüfen |

Ohne Quelle und Abrufdatum keine Behauptung. „Pause statt Rechnung“ bleibt
Projektregel (`AGENTS.md` / `plan.md`); das ersetzt keine Anbieter-ToS.

## 3. Geparkte CLIs (Board `AgentStarten.dc.html`)

Die Boards listen zehn CLIs (`AgentStarten.dc.html`, Array `CLIS`). Drei
Wege sind aktiv (oben). Die übrigen sieben sind **geparkt** bis ein
eigenes Paket sie freigibt:

| id (Board) | Name (Board) | Status |
|---|---|---|
| kimi | Kimi CLI | geparkt |
| opencode | OpenCode | geparkt |
| gemini | Gemini CLI | geparkt |
| copilot | Copilot CLI | geparkt |
| kilo | Kilo | geparkt |
| cursor | Cursor Agent | geparkt |
| grok | Grok CLI | geparkt |

## 4. Abnahme (V2-CLI-0)

| Kriterium | Beleg |
|---|---|
| Tabelle je Weg: Befehl, Version, Exit | Abschnitt 1 |
| Ohne Beobachtung: „prüfen“ | Ollama-Version/Lizenz; alle Lizenzen; alle ToS-Zellen |
| Geparkte sieben CLIs genannt | Abschnitt 3 |
| Keine Rechtsberatung | Abschnitt 2 |

## 5. Nicht abgedeckt hier

- Beobachteter Prompt-Lauf mit Modellname (V2-CLI-1, V2-LOCAL-1)
- RAM-/Token-Messung für lokales Modell (V2-LOCAL-1)
- Failover-Kette und Kontingentfenster (V2-B2a/b, V2-B1)
- Windows-Installation der CLIs (nur Linux-Server beobachtet)
