# Review-Disposition W5-28

Kandidat: Branch `claude/w5-28`, zuletzt `c1632e3`. Autor: kimi-k3 (Worker).
Gefordert: zwei Reviews anderer Anbieter (>300 Zeilen). Autorenfamilie Kimi
durfte nicht selbst prüfen; das Advisor-Paar war nicht erreichbar
(GPT-6 Astra: Codex-Kontingent bis 30.09. ausgeschöpft, Fehlermeldung im
Lauf protokolliert; Fable-5.1-Subagent: HTTP 402 des Kontos). Ersatzweise
zweiter Anbieter: qwen2.5-coder:7b lokal (Alibaba). deepseek-v4-flash:cloud
war bei Ollama Cloud gelöscht (HTTP 410), qwen3.8:latest antwortete auch mit
kleiner Probe nicht (HTTP 500 bzw. keine Antwort in 120 s).

## Reviews

- `review_w5-28_glm-5.2.md` (R1, Kandidat `870ba09`): 4 Befunde.
- `review_w5-28_qwen2.5-coder.md` (Kandidat `870ba09`): kein neuer Befund;
  weitgehend Nacherzählung des Diffs, ein sprachlich wirrer Hinweis auf den
  PrintWindow-Fallback (durch F3-Fix b1e952b/c1632e3 abgedeckt).
- `review_w5-28-r2_glm-5.2.md` (Delta `870ba09..b1e952b`): bestätigt F1/F2,
  beanstandet F3 weiter, ein neues Low.

## Dispositionen

| ID | Quelle | Schwere | Befund | Disposition |
|---|---|---|---|---|
| F1 | glm-5.2 R1 | hoch | Verdikt-Passing bei Nicht-Array/leerer Entry-Liste | angenommen, b1e952b: Verdikt verlangt Array und >= seeded Einträge, roter Test zuerst (a42deed) |
| F2 | glm-5.2 R1 | mittel | Retention hätte fremde Verzeichnisse unter dem Proof-Root gelöscht | angenommen, b1e952b: nur runStamp-förmige Namen sind löschbar, roter Test zuerst (a42deed) |
| F3 | glm-5.2 R1 | mittel | -TargetPid fiel auf Titel-Match zurück (Foto der Produktiv-Instanz möglich) | angenommen, b1e952b; R2-Einspruch (Write-Error nicht terminierend) war durch `$ErrorActionPreference='Stop'` bereits gedeckt, dennoch auf `throw` geschärft (c1632e3) |
| F4 | glm-5.2 R1 | niedrig | globaler Alt-Tastenschlag in window-shot.ps1 | abgelehnt: ohne ihn verweigert Windows SetForegroundWindow aus der Hintergrund-Konsole; Alt allein öffnet kein Menü. Kommentar im Skript |
| R2-1 | glm-5.2 R2 | niedrig | `[null]`-Elemente in der Queue-Antwort ließen den Treiber abstürzen | angenommen, c1632e3: Elemente mappen auf Status `malformed`, das Verdikt schlägt sauber fehl |

Nach den Fix-Commits liegt kein offener Befund vor. Der Endkandidat wurde
per Release-Build (`com.projecta.proof`, custom-protocol) erneut live
belegt: Lauf 2026-09-25T14-20-58Z, Exit 0.

## Weiteres Review (Stufe B, PR #11)

Ein dritter, unabhängiger Reviewer (grok, xAI) prüfte den Endkandidaten
`cae91c0` vollständig: Befund G1 (mittel, WebView2-Profil des Proofs war
nicht sandboxed) — angenommen und umgesetzt. Review, Disposition und
Laufzeit-Beleg: `.pa/review_pr11_disposition.md`.
