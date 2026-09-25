# F6-O0: Router erreichbar, echte Sonden

Status: historisch

Repo: `<repo-root>`. **Nicht committen.**

Plan: `docs/SANIERUNGSPLAN.md` Rev 9, F6. Geht nur, wenn OmniRoute auf
`:<omniroute-port>` echte Antworten gibt — sonst Blocker und skip.

## Nahtstellen-Lane

`omniroute.rs` / `routing.rs` zuerst. `store.rs` / `api.rs` / `pa.rs` erst
für Attribution, und dann **seriell nach F4-Persistenz**.

## Auftrag (dieses Paket: O-0)

1. Direkte Route, aufgelöstes Modell, Status, Latenz, Thinking-Parameter
   protokollieren — mit Requests, deren Antwort **nicht in der Frage steht**.
2. Produktmodi `reliable` / `cheap` / `review` als ProjectA-Verträge, nicht
   als OmniRoute-Namen. Fallback-Regeln aus dem Plan.
3. Keine Secrets in argv/Logs.

Volle 20-Lauf-Suite und Insights-UI sind Folgepakete, sobald O-0 steht.

## Report

`.pa/report_f6_o0.md`.
