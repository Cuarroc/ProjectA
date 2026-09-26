# Review-Disposition README-01

Kandidat: neues `README.md` (Branch `docs/readme-refresh`). Autor: Claude.
Reviewer: Kimi K3 über Ollama Cloud (`/api/chat`, beobachtetes Modell
`kimi-k3`), ein Durchgang. Reiner Doku-Diff unter 300 Zeilen, keine
Nahtstelle: ein Reviewer genügt (AGENTS.md).

| # | Befund (Stufe) | Disposition |
|---|---|---|
| 1 | „no public installer" widerspricht release.yml (MAJOR) | angenommen: umformuliert, Installer werden für die eigene Maschine gebaut und nicht für andere angeboten |
| 2 | „20-task benchmark" unbelegt (MAJOR) | abgelehnt: steht wörtlich in `docs/PLAN.md` (W4-01 „20-Task-Benchmark") |
| 3 | OmniRoute ohne Beleg (MAJOR) | angenommen: Beleg ergänzt (`resources/agents-omniroute.json`, `omniroute.rs`), als opt-in gekennzeichnet |
| 4 | kein Text-Titel (MINOR) | angenommen: `# ProjectA` ergänzt |
| 5 | „Kimi CLI" vs. „Kimi Code" (MINOR) | angenommen: einheitlich „Kimi CLI" (Profilname in `agent-defaults.json`) |
| 6 | „answer … their work" (MINOR) | angenommen: Satz umgebaut |
| 7 | „author's model family" mehrdeutig (MINOR) | angenommen: umformuliert |
| 8 | „per-process token" unbelegt (MINOR) | abgelehnt: `api.rs` Test `two_servers_do_not_share_a_token` |
| 9 | „clone-local" Jargon (MINOR) | angenommen: umformuliert |
| 10 | W1-05b, F-CORE-3, HQ2-08, v1.4.1, React 18 unbelegt (MINOR) | abgelehnt: alle in `docs/PLAN.md`, `STAND.md` bzw. `package.json` (`react ^18.3.1`) nachgeprüft |
| 11 | Status-Taxonomie ohne „planned" (MINOR) | angenommen: Continuous Mode und Cancel als „planned" geführt |

Kein Delta-Review nach den Änderungen: nur Wortlaut, keine neue Behauptung
außer dem OmniRoute-Beleg (Dateien per `ls`/`grep` geprüft).
