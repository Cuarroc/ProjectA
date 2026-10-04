# M4-Abnahme: vorhandene Testbelege

Stand des geprüften Quellbaums: `origin/main`
`e312360d10eb7ed20f27dd26a92cf39453f36dd5` (04.10.2026). Die folgenden
Belege ordnen vorhandene Store-Tests den Matrixzeilen 5, 9, 10, 14, 15 und 17
zu. Ein grüner Unit-/Integrationstest ersetzt keinen in der Matrix geforderten
End-to-end- oder PC-Lauf; diese Grenze steht je Zeile als `GAP` dabei.

## Zeile 5 – Claims und Fences

- `src-tauri/src/store/continuous.rs:1370::concurrent_claims_have_one_winner_and_a_fence`
  lässt zwei Claims auf dieselbe Task konkurrieren und erwartet genau einen
  Gewinner mit Fence 1. Origin: Commit `c60f2679e222c6d5f676edee3b58c985492f3111`,
  aus dem Import des vorherigen privaten Repositorys; kein zuordenbarer
  öffentlicher Paket-PR.
- `src-tauri/src/store/continuous.rs:1430::stale_fence_cannot_complete_claim_and_expiry_does_not_reclaim`
  weist einen zweiten Claim trotz abgelaufener Lease sowie einen veralteten
  Fence zurück und akzeptiert nur den aktuellen Fence. Origin: Commit
  `c60f2679e222c6d5f676edee3b58c985492f3111`, aus dem Import des vorherigen
  privaten Repositorys; kein zuordenbarer öffentlicher Paket-PR.

Messung auf diesem Server:

```text
cargo nextest run --profile ci --bin projecta -E 'test(=store::continuous::tests::concurrent_claims_have_one_winner_and_a_fence) or test(=store::continuous::tests::stale_fence_cannot_complete_claim_and_expiry_does_not_reclaim)'
Exit-Code 0; 2 Tests ausgeführt, 2 bestanden.
```

`GAP:` Das sind konkurrierende Store-Aufrufe, kein Scheduler-End-to-end-Lauf
mit echtem Dispatch und anschließendem Schreibversuch. Dieser Nachweis hängt
weiter von M4-R7-01 und M4-R7-02 ab.

## Zeile 9 – Abhängigkeiten

- `src-tauri/src/store/development_runs.rs:1619::briefing_observes_dependency_states_without_exposing_other_projects`
  prüft erfüllte, offene, fehlende und fremde Abhängigkeiten, schirmt fremde
  Details ab und setzt `satisfied` nur für vollständig erfüllte Abhängigkeiten.
  Origin: Commit `c60f2679e222c6d5f676edee3b58c985492f3111`, aus dem Import des
  vorherigen privaten Repositorys; kein zuordenbarer öffentlicher Paket-PR.
- `src-tauri/src/store/development_runs.rs:1680::briefing_does_not_claim_truncated_dependency_list_is_satisfied`
  hält eine auf 64 Einträge gekürzte Liste bei insgesamt 65 Abhängigkeiten
  fail-closed. Origin: Commit `c60f2679e222c6d5f676edee3b58c985492f3111`,
  aus dem Import des vorherigen privaten Repositorys; kein zuordenbarer
  öffentlicher Paket-PR.

Messung auf diesem Server:

```text
cargo nextest run --profile ci --bin projecta -E 'test(=store::development_runs::tests::briefing_observes_dependency_states_without_exposing_other_projects) or test(=store::development_runs::tests::briefing_does_not_claim_truncated_dependency_list_is_satisfied)'
Exit-Code 0; 2 Tests ausgeführt, 2 bestanden.
```

`GAP:` Die Tests belegen die Store-Auswertung und das Briefing, aber keinen
Scheduler-End-to-end-Lauf, der bei jeder negativen Variante den Start
tatsächlich unterlässt. Dieser Nachweis hängt weiter von M4-R7-01 und
M4-R7-02 ab.

## Zeile 10 – Kapazität und RAM

- `src-tauri/src/store/continuous_capacity_tests.rs:5::projects_share_capacity_across_races_restart_pause_and_expired_leases`
  prüft das globale Host-Limit über mehrere Projekte, einen Claim-Wettlauf und
  den unveränderten Verbrauch nach Pause, Lease-Ablauf und Neustart. Origin:
  Commit `c60f2679e222c6d5f676edee3b58c985492f3111`, aus dem Import des
  vorherigen privaten Repositorys; kein zuordenbarer öffentlicher Paket-PR.
- `src-tauri/src/store/continuous_pressure_tests.rs:4::memory_thresholds_and_unknown_observations_reduce_only_admission`
  prüft die Claim-Limits 2/1/0 an den RAM-Schwellen und die konservative
  Begrenzung bei unbekannter oder ungültiger Messung. Origin: Commit
  `c60f2679e222c6d5f676edee3b58c985492f3111`, aus dem Import des vorherigen
  privaten Repositorys; kein zuordenbarer öffentlicher Paket-PR.
- `src-tauri/src/store/continuous_pressure_tests.rs:59::pressure_blocks_new_claims_without_consuming_attempts_or_releasing_work`
  prüft, dass kritischer, begrenzter und unbekannter RAM-Zustand neue Claims
  blockieren, Versuche nicht verbrauchen und bestehende Claims nicht lösen.
  Origin: Commit `c60f2679e222c6d5f676edee3b58c985492f3111`, aus dem Import des
  vorherigen privaten Repositorys; kein zuordenbarer öffentlicher Paket-PR.

Messung auf diesem Server:

```text
cargo nextest run --profile ci --bin projecta -E 'test(=store::continuous::capacity_tests::projects_share_capacity_across_races_restart_pause_and_expired_leases) or test(=store::continuous::capacity::tests::memory_thresholds_and_unknown_observations_reduce_only_admission) or test(=store::continuous::capacity::tests::pressure_blocks_new_claims_without_consuming_attempts_or_releasing_work)'
Exit-Code 0; 3 Tests ausgeführt, 3 bestanden.
```

`GAP:` Die RAM-Werte sind kontrollierte Testeingaben; es fehlt ein Lauf unter
echtem Betriebssystem-Speicherdruck mit realen Worker-Prozessen. Damit sind
weder die Laufzeitanpassung noch das Verhalten laufender Worker unter Druck
gemessen.

## Zeile 14 – Checkpoints und Fortschritt

- `src-tauri/src/store/development_runs.rs:1714::structured_checkpoint_is_durable_fenced_and_idempotent`
  prüft unveränderte Wiederholung, Konflikt bei gleicher Idempotency-ID, stale
  Revision/Fence, fehlende Evidence, einen konkurrierenden Schreibgewinner,
  Neustartbeständigkeit und run-gebundenes Lesen. Origin: Commit
  `c60f2679e222c6d5f676edee3b58c985492f3111`, aus dem Import des vorherigen
  privaten Repositorys; kein zuordenbarer öffentlicher Paket-PR.

Messung auf diesem Server:

```text
cargo nextest run --profile ci --bin projecta -E 'test(=store::development_runs::tests::structured_checkpoint_is_durable_fenced_and_idempotent)'
Exit-Code 0; 1 Test ausgeführt, 1 bestanden.
```

`GAP:` Der Store-Vertrag ist belegt; ein echter Agentenlauf durch Transport,
Checkpoint-API, Prozessabbruch und Wiederaufnahme ist nicht beobachtet.

## Zeile 15 – Candidate und Evidence

- `src-tauri/src/store/development_runs.rs:1863::evidence_idempotency_and_candidate_change_invalidate_review`
  bindet Evidence an Run und Commit, prüft unveränderte Wiederholung und weist
  eine abweichende Wiederholung zurück. Origin: Commit
  `c60f2679e222c6d5f676edee3b58c985492f3111`, aus dem Import des vorherigen
  privaten Repositorys; kein zuordenbarer öffentlicher Paket-PR.
- `src-tauri/src/store/development_runs.rs:2003::agent_context_matches_run_evidence_and_rechecks_current_task_fence`
  prüft berechtigtes Lesen, lehnt fremde Evidence und Eigentümer ab und sperrt
  Lesen wie Schreiben nach einem Fence-Wechsel. Origin: Commit
  `c60f2679e222c6d5f676edee3b58c985492f3111`, aus dem Import des vorherigen
  privaten Repositorys; kein zuordenbarer öffentlicher Paket-PR.
- `src-tauri/src/store/development_runs.rs:2054::candidate_replay_returns_persisted_provenance`
  beweist, dass ein Replay die zuerst gespeicherte Candidate-Herkunft und
  Beobachtungszeit zurückgibt statt neue Provenienz zu erfinden. Origin:
  Commit `c60f2679e222c6d5f676edee3b58c985492f3111`, aus dem Import des
  vorherigen privaten Repositorys; kein zuordenbarer öffentlicher Paket-PR.

Messung auf diesem Server:

```text
cargo nextest run --profile ci --bin projecta -E 'test(=store::development_runs::tests::evidence_idempotency_and_candidate_change_invalidate_review) or test(=store::development_runs::tests::agent_context_matches_run_evidence_and_rechecks_current_task_fence) or test(=store::development_runs::tests::candidate_replay_returns_persisted_provenance)'
Exit-Code 0; 3 Tests ausgeführt, 3 bestanden.
```

`GAP:` Die Tests belegen Run-, Commit-, Fence- und Lesebindung im Store. Sie
belegen nicht als End-to-end-Lauf, dass eine Policy-Revision in allen
Candidate-/Evidence-Schnittstellen unveränderlich mitgeführt und eine fremde
Policy abgewiesen wird.

## Zeile 17 – Invalidierung nach Candidate-Änderung

- `src-tauri/src/store/development_runs.rs:1863::evidence_idempotency_and_candidate_change_invalidate_review`
  bindet zunächst Evidence und Review an Commit A, wechselt auf Commit B und
  erwartet zwei invalidierte Datensätze sowie den sichtbaren Review-Status
  `invalidated` mit `invalidatedByCommit`. Origin: Commit
  `c60f2679e222c6d5f676edee3b58c985492f3111`, aus dem Import des vorherigen
  privaten Repositorys; kein zuordenbarer öffentlicher Paket-PR.

Messung auf diesem Server:

```text
cargo nextest run --profile ci --bin projecta -E 'test(=store::development_runs::tests::evidence_idempotency_and_candidate_change_invalidate_review)'
Exit-Code 0; 1 Test ausgeführt, 1 bestanden.
```

`GAP:` Die Store-Invalidierung ist belegt. Es fehlt der geforderte
End-to-end-Lauf vom Candidate-Delta bis zur Release-Entscheidung, der zeigt,
dass die alte Evidence und Review einen Release nicht mehr autorisieren.
