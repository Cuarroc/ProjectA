# Review-Disposition W2-10b

Autor: Kimi K3. Kandidat: `34532aa` (Branch `claude/w2-10b`, stapelt auf
`claude/w2-10a`). Diff-Umfang +359/−23 (> 300 Zeilen) → zwei Reviews anderer
Anbieter erforderlich (AGENTS.md).

Reviewer:

1. **GLM 5.2** (`glm-5.2:cloud`, Ollama Cloud) — Urteil: freigeben mit
   Auflagen (1 Low-Befund). Protokoll: `.pa/review_w2-10b_glm-5.2.md`.
2. **Qwen 2.5 Coder 14B** (`qwen2.5-coder:14b`, lokal via Ollama) — Urteil:
   freigeben mit Auflagen (5 Befunde, inhaltlich identisch). Protokoll:
   `.pa/review_w2-10b_qwen2.5-coder.md`.

Ersatzweg (Prozess-Transparenz): Das Advisor-Paar war nicht verfügbar —
Fable 5.1 (Claude-Subagent) scheiterte mit 402 „Insufficient account funds",
GPT-6 Astra (Codex CLI) mit „usage limit" bis 30.09.2026,
deepseek-v4-flash:cloud ist aus Ollama Cloud entfernt (HTTP 410). Zweites
Review daher durch qwen2.5-coder:14b — anderer Anbieter (Alibaba), nicht die
Autorenfamilie, auf dieser Maschine bereits früher als Reviewer eingesetzt
(u. a. Paket b-s2). Kein Geld ausgegeben.

## Befunde und Disposition

| ID | Quelle | Schwere | Befund | Disposition |
|---|---|---|---|---|
| F1 | GLM 5.2 | low | `USAGE_STATE_LABELS` fehlen `exceeded`/`exhausted`; rohes Englisch + Redundanz zu den Flags | **abgelehnt mit Grund**: Prämisse falsch. `usage_state` ist in `src-tauri/src/store/development_budget.rs:124-133` eine geschlossene Menge (`no_allowance`, `no_receipts`, `partial`, `measured`) — alle vier haben deutsche Labels. `exceeded`/`exhausted` sind separate Booleans (development_budget.rs:84-85) und werden bereits als „· Überschritten"/„· erschöpft" gerendert. Labels für nie auftretende Werte wären toter Code; der Fallback auf den rohen Zustandsstring ist für unbekannte künftige Zustände der ehrlichere Pfad. Die Mehrdeutigkeit kam aus der Prompt-Aufzählung („usageState ∈ {…}, exceeded, exhausted" als Feldliste gelesen). |
| F1–F5 | Qwen 2.5 Coder | medium/low | „Race-Bedingung" zwischen `renderBudget` und Signatur-Gating (5× wortgleich) | **abgelehnt mit Grund**: kein Mechanismus. Signaturberechnung, Vergleich, `renderBudget`-Aufruf und Signatur-Speicherung laufen synchron in einem Block (continuous.js:241-251) ohne `await`; JS ist single-threaded, Interleaving ist ausgeschlossen. Veraltete async-Abschlüsse fängt der Generation-Guard aus W2-10a (`generation !== sequence` → early return direkt nach dem `Promise.all`) ab, und der Test „unchanged refresh leaves the budget DOM alone; changed balances rebuild it" belegt beide Pfade mit DOM-Referenzgleichheit. |
| Auflage 3 | Qwen 2.5 Coder | — | „prüfen, ob alle erforderlichen Tests implementiert sind" | **erledigt ohne Codeänderung**: die Red-first-Suite (7 Tests) deckt Budget-Summary, exceeded/exhausted, Fallbacks, Routing-Übersicht, Usage-Provenienz, Signatur-Gating und den `b`-Shortcut ab; Browser-Test liefert die beiden Screenshot-Belege. |

Kein Befund angenommen → **keine Nacharbeit am Kandidaten**, kein
Delta-Review nötig (Kandidat unverändert `34532aa`; Evidenz bleibt gebunden).
