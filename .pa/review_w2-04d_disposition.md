# Review-Disposition: w2-04d

- Kandidat bei Review: `913851f` (base `origin/main` c60f267)
- Reviewer: glm-5.2:cloud (ok) und qwen2.5-coder:7b (ok) über
  `.pa/review_transport.py` (Ollama), Stufe A (Nahtstelle store/), Autor Kimi k3
- deepseek-v4-flash:cloud fiel als zweiter Reviewer aus: HTTP 410 Gone
  (Modell bei Ollama Cloud nicht mehr vorhanden), Protokoll
  `.pa/review_w2-04d_deepseek-v4-flash.md`. Ersatz: qwen2.5-coder:7b
  (Precedent `.pa/review_b-s2_qwen2.5-coder.md` im privaten Archiv).
- Delta nach den Reviews: nur der Test zu G2/Q5 (Commit `9e6386b`), kein
  Produktionscode — die Review-Evidenz bleibt an den Kandidaten gebunden,
  keine Delta-Runde nötig.

## glm-5.2 (Urteil: freigeben)

| ID | Schwere | Befund | Disposition |
|---|---|---|---|
| G1 | niedrig | Rassefestigkeit des Ein-Reservierung-Checks hängt an der Serialisierung über die Goal-Zeile | Angenommen als Bestätigung, kein Code nötig: das sperrende `UPDATE continuous_goals` steht in derselben Transaktion vor allen Reads (development_budget.rs, Reihenfolge: Lock → Idempotenz → Run/Role-Checks). Beleg: Test `a_run_holds_exactly_one_token_reservation`. |
| G2 | niedrig | Test für Stornierung + Neu-Reservierung desselben Runs fehlt | Angenommen, umgesetzt in `9e6386b`: `cancelled_run_reservation_frees_the_run_for_a_new_one` (deckt cancel → re-reserve → consume_worker → for_run). |
| G3 | niedrig | Idempotenz-Replay greift vor dem Purpose/Run-Mismatch-Check; Caller mit gleichem Key und anderem Purpose bekäme still die alte Zeile | Abgelehnt (kein Defekt): das ist das dokumentierte Idempotenz-Verhalten; die Felder goal/purpose/run/tokens werden beim Replay verglichen und bei Abweichung mit "token reservation idempotency conflict" abgelehnt (development_budget.rs, Block `if let Some(previous)`). Der Reviewer selbst stuft es als kein Risiko ein. |

## qwen2.5-coder (Urteile gemischt: 1× freigeben, 3× ablehnen, 1× Auflagen)

Der Reviewer bezog seine Zeilenangaben und drei seiner Befunde auf den
Stand VOR dem Diff (er beschreibt `purpose='implementation'`-Filter, die der
Diff gerade entfernt). Dispositionen mit Code-Beleg:

| ID | Schwere | Befund | Disposition |
|---|---|---|---|
| Q1 | niedrig | skills.rs-Fundstelle fachlich irrelevant | Angenommen (kein Handlungsbedarf): die skills.rs-Änderung ist ein reiner rustfmt-Hunk, weil main sonst am fmt-Gate hängt (gleiche Korrektur wie der offene Base-Repair-PR #4). |
| Q2 | hoch | "Reservierungs-Bedingung gilt nur für Implementation, sollte generalisiert werden" | Abgelehnt mit Beleg: genau das tut der Diff — `BudgetPurpose::for_dispatch_role` mappt alle vier Rollen und `reserve_development_tokens` erzwingt den gemappten Zweck je Run (Fehler "run dispatches as ..., which holds ... budget, not ..."). Beleg-Tests: `run_budget_purpose_must_match_the_dispatch_role`, `coordinator_and_integrator_runs_bind_planning_and_verification`. |
| Q3 | hoch | "for_run wahrt Eindeutigkeit durch purpose='implementation', sollte durch Rolle ersetzt werden" | Abgelehnt mit Beleg: der Diff entfernt diesen Filter in `for_run`; Eindeutigkeit kommt von der Invariante "ein Run hält höchstens eine nicht-stornierte Reservierung" (erzwungen in reserve, getestet in `a_run_holds_exactly_one_token_reservation` und `cancelled_run_reservation_frees_the_run_for_a_new_one`). Ein Worker kann kein fremdes Budget ziehen: alle Abfragen filtern strikt `run_id=?`, und die Settlement prüft Run+Session-Binding. |
| Q4 | hoch | "Idempotenz-Prüfung sollte auf den gemappten Zweck generalisiert werden" | Abgelehnt mit Beleg: der Idempotenz-Vergleich prüft bereits `previous.purpose != purpose.name()` und `run_id` (development_budget.rs, `previous`-Block) — ein Replay mit abweichendem Zweck schlägt fehl ("token reservation idempotency conflict"). Die Empfehlung "separate Migration" widerspricht der Paketvorgabe (keine neue Migration, wenn vermeidbar); das Schema-CHECK enthält alle sechs Zwecke bereits. |
| Q5 | mittel | Testfall Stornierung + Neu-Reservierung fehlt | Angenommen, umgesetzt in `9e6386b` (gleicher Test wie G2). |

## Ergebnis

Beide wirksamen Reviews sind eingegangen und dispositionsbereinigt. glm-5.2:
freigeben. qwen: seine drei "hoch"-Ablehnungen beruhen auf dem alten Stand und
sind mit Code- und Test-Beleg widerlegt; sein einziger sachlicher Befund (Q5)
ist umgesetzt. Kein Befund offen.
