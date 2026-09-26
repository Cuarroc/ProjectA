# Task omniw4eval — Kompression vermessen, bevor sie jemand einschaltet

Status: historisch

Recherche-Task, **kein Produktionscode**. Worktree `~/wt/omniw4eval`
(Branch `omni/w4-eval`, Basis `origin/main`). Gesamtplan:
`docs/superpowers/plans/omniroute-integration.md` (W4).

Kontext: OmniRoute v3.8.49 stapelt 12 Kompressions-Engines (Versprechen:
15–95 % Token-Ersparnis, Code/JSON bleiben byte-genau erhalten). ProjectA
will das pro Agentenrolle einschalten — aber erst nach Messung. Du lieferst
die Messung.

## Aufgaben

1. **Erreichbare Eval-Wege klären:** Die Instanz (per Tunnel
   `127.0.0.1:<omniroute-port>`, Management-Token in `~/specs/omniroute.env`, nur
   lesend + Testanfragen) bietet u. a. `/api/compression/compare`,
   `/api/compression/preview`, `/api/compression/engines`,
   `/api/analytics/compression`. Finde heraus (Doku im npm-Paket oder
   vorsichtige GETs), welcher Endpunkt ein Prompt/Transkript nimmt und
   Ersparnis + Ergebnistext zurückgibt. Auth: Bearer-Token aus der env-Datei.
   **Keine POSTs, die Konfiguration dauerhaft ändern** — nur
   compare/preview-Reads bzw. stateless Testaufrufe.
2. **Realistische Last aufbauen:** Stelle 3 echte Arbeits-Payloads aus dem
   Repo-Kontext nach: (a) eine Worker-Spec (nimm `~/specs/omniw1a.md`),
   (b) einen fiktiven, aber realistischen Tool-Output-Stapel (baue ihn aus
   echter `cargo test`-Ausgabe in deinem Worktree + `git log`), (c) einen
   langen Konversationsverlauf mit Wiederholungen (duplizierte Blöcke, wie
   sie in Agenten-Sessions entstehen). Keine Secrets in den Payloads.
3. **Messen:** Jede Payload durch die gefundenen Eval-Endpunkte, für die
   Stufen Lite / Standard (Caveman) / Aggressive / Stacked (RTK→Caveman),
   soweit wählbar. Aufzeichnen: Token vorher/nachher, Ersparnis in %,
   und — entscheidend — **ob Code-Blöcke, Pfade und Kommandos im
   Ergebnis byte-genau erhalten bleiben** (per Diff prüfen, nicht annehmen).
4. **Empfehlung:** Pro Agentenrolle (Worker = lange Tool-Sessions, Scout =
   Recherche, Critic = kurze Reviews) eine Stufe empfehlen oder vom
   Einschalten abraten — mit Zahlen.

## Grenzen

- Kein `git commit` auf Produktivdateien. Einzige Artefakte: dein Bericht.
- Du darfst die lokale OmniRoute-Instanz nur über den Tunnel erreichen;
  Pfade außerhalb deines Worktrees sind tabu (außer Lesen von ~/specs und
  ~/logs für diesen Auftrag).

## Bericht

`BERICHT.md` im Worktree (darf auf `omni/w4-eval` committed + gepusht
werden): gefundene Endpunkt-Verträge (Request/Response-Form, belegt),
Messtabelle (Payload × Stufe → Ersparnis, Byte-Treue ja/nein mit Beispiel),
Empfehlung pro Rolle, Risiken. Push `origin omni/w4-eval`.
