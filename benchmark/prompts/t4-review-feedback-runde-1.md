# T4 — Reviewer-Feedback Runde 1 (fest, wortgleich auf beiden Seiten)

Die erste Review lehnt die Lösung **immer** mit exakt diesem Text ab,
unabhängig von der Qualität der ersten Lösung:

> Abgelehnt: Die Grenzfälle fehlen. Bitte teste zusätzlich explizit:
> `value` unter `min`, `value` über `max` und `value` genau auf beiden
> Grenzen (`value === min` und `value === max`). Ergänze die Tests in
> `test/clamp.test.js` und reiche erneut ein.

Die zweite Review entscheidet nach den Akzeptanzkriterien: `npm test` grün
und die vier geforderten Grenzfall-Tests vorhanden. Erst die zweite Freigabe
führt zum Merge; beide Evidence-Sets (Ablehnung + Freigabe) werden
protokolliert.
