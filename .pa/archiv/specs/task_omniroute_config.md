# Task OmniRoute-Config: OmniRoute optimieren und konfigurieren

Status: historisch

Du bist ein Konfigurations-Worker auf einem Linux-Server. Ziel: den laufenden
OmniRoute-Proxy so einstellen, dass ProjectA ein möglichst großes, aber
ToS-sicheres Free-Tier-Portfolio nutzen kann. Du arbeitest NUR im Worktree
`/home/worker/wt/omniroute` (Branch `kimi/omniroute-config`, aktuelles main).
NIEMALS main anfassen, niemals force-push.

## Kontext

OmniRoute (github.com/diegosouzapw/OmniRoute, v3.8.x) läuft auf dem Desktop des
Nutzers (`127.0.0.1:<omniroute-port>`) und ist vom Server aus per SSH-Reverse-Tunnel
erreichbar. Der Nutzer hat sich gerade in OmniRoute bei mehreren Providern
angemeldet. Ein Management-Token liegt root-only unter
`/home/worker/specs/omniroute.env`.

- Plan-Referenz: `docs/superpowers/plans/2026-08-27-omniroute-optimale-nutzung.md`,
  Abschnitt T5 (ToS-sichere Free-Policy + Provider-Übersicht).
- Management-API-Beispiele:
  - `GET /api/providers`
  - `GET /api/combos`
  - `GET /api/usage/logs`
  - `POST /api/combos` (oder entsprechender Endpunkt — verifiziere)

## Aufgaben

1. **Inventur:**
   - Lies `/home/worker/specs/omniroute.env` und mache einen Snapshot der
     aktuellen Konfiguration: verbundene Provider, Keys, Combos, ToS-Flags,
     Free-Tier-Restquoten.
   - Speichere den Snapshot (anonymisiert, ohne echte Keys) als
     `.pa/omniroute-snapshot.json`.

2. **Curated Free-Combo:**
   - Erstelle eine Combo/Vorlage namens `projecta-free` basierend auf der
     Whitelist aus dem Plan: **Mistral, Gemini Flash, Groq, Cerebras,
     Cloudflare, SambaNova, OpenRouter `:free`, Ollama Cloud**.
   - Strategie: `cost-optimized` oder `reset-window` (was für Free-Tier sinnvoll
     ist — begründe im Bericht).
   - Filter: Provider mit ToS-Flag aus dem OmniRoute-eigenen ToS-Flagging
     ausschließen.
   - Ausgabe: `src-tauri/resources/omniroute-combos.json` mit der Vorlage.

3. **Optionale Anwendung (falls API sauber ist):**
   - Versuche, die Combo direkt über die Management-API an OmniRoute zu senden
     (POST /api/combos o.ä.). Falls der Endpunkt unklar/instabil ist, dokumentiere
     stattdessen die manuellen Klicks im OmniRoute-Dashboard.

4. **Provider-Übersicht für ProjectA:**
   - Eine Markdown-Tabelle `.pa/omniroute-providers.md` mit:
     Provider, Modell-Beispiel, Free-Limit/Monat, ToS-Status, Empfohlene Verwendung.
   - Falls `/api/free-tier/summary` existiert, ziehe echte Restquoten ein.

5. **Smoke-Test:**
   - Ein einzelner Request gegen `/v1/chat/completions` oder `/v1/messages`
     mit `model: auto` (oder der neuen Combo) sollte durchlaufen und die
     Decision-Header (`x-omniroute-decision`, `x-omniroute-response-cost`)
     zurückliefern. Dokumentiere das Ergebnis.

## Regeln

- Keine Produktiv-Geheimnisse ins Repo (Token, Keys, machineId). Snapshot
  anonymisieren.
- Gates: Dieser Task ändert primär JSON/Doku; fahre trotzdem `cargo test`
  und `cargo clippy --all-targets -- -D warnings` in `src-tauri/`, falls du
  Code anfasst. Ansonsten reicht `cargo check`.
- Commit-Messages: Englisch, konventionell.
- Bericht `.pa/report_omniroute_config.md` + Kopie nach
  `/root/logs/omniroute-config-report.md`, dann `git push origin kimi/omniroute-config`.
- Rufe den Nutzer nicht ab; wenn etwas am Dashboard unklar ist, dokumentiere
  es als „manuell erforderlich".
