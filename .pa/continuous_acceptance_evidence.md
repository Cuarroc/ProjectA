# M4-Abnahme: vorhandene Testbelege

Stand des geprüften Quellbaums: `origin/main`
`bfbb99d0cc4a7a6664b900520b0a0d9ab90f6ce8` (05.10.2026). Die Belege ordnen
vorhandene Tests den Matrixzeilen in `.pa/continuous_acceptance_matrix.md` zu.
Ein grüner Unit-/Integrationstest ersetzt keinen dort geforderten PC- oder
Nutzerlauf; diese Grenze steht je Zeile als `GAP` dabei. Die Statusspalte der
Matrix ist unverändert; die Einstufung hier ist `erledigt`, `teilweise` oder
`offen`. Zeilen 5, 9, 10: Origin der älteren Tests ist Commit
`c60f2679e222c6d5f676edee3b58c985492f3111` (Import des vorherigen privaten
Repositorys, kein öffentlicher Paket-PR). `file:line` wurde am genannten Stand
mit `rg -n` geprüft. Die `Messung`-Blöcke stammen vom 04.10. (Stand
`e312360`); die Tests aus späteren PRs haben hier keine eigene Messung, ihre
Gates liefen in der Merge-Queue des jeweiligen PR.

## Zeile 1 – fail-closed (teilweise)

- #372: `scripts/lib/continuous-readiness.test.mjs:21::readiness remains fail-closed when observations are missing`
  sowie `:63` und `:72` (App-Release-Attestierung macht den Dauerbetrieb nicht
  releasefähig).
- `GAP:` Skript-Tests, kein Laufzeit-Audit der installierten App mit
  `continuousEligible: false`.

## Zeile 4 – Projektgrenze (teilweise)

- #405: `src-tauri/src/api/tests/project_scope_tests.rs:228::run_credential_reads_its_own_project_context_and_records`
  (positiv) und `:147::hq_context_changes_goals_records_of_a_foreign_project_leak_nothing`
  (negativ, ohne Datenleck) gegen einen echten Store.
- `GAP:` Zugriff über HTTP-Router mit Testtransport; keine installierte App.

## Zeile 5 – Claims und Fences (teilweise)

- `src-tauri/src/store/continuous.rs:1397::concurrent_claims_have_one_winner_and_a_fence`
  und `:1457::stale_fence_cannot_complete_claim_and_expiry_does_not_reclaim`
  (Messung 04.10.: Exit-Code 0, 2 von 2 bestanden).
- #412: `src-tauri/src/workers.rs:3629::concurrent_dispatch_starts_one_worker_and_refuses_stale_writer`
  (zwei gleichzeitige `dispatch_once`, ein Worker, stale Schreiber abgewiesen).
- `GAP:` Fake-Adapter hinter einem Nur-Test-Permit, kein echter Worker-Prozess.

## Zeile 7 – Scheduler (teilweise)

- #412: `src-tauri/src/workers.rs:3617::scheduler_dispatch_requires_the_test_only_permit`,
  `:3548::dispatch_once_refuses_each_missing_gate_without_spawning`,
  `:3495::dispatch_once_refuses_truncated_dependency_set`.
- `GAP:` Negativmatrix belegt; ein positiver End-to-end-Lauf mit echten
  Provider-/Scheduler-Gates fehlt (Dauerbetrieb ist gesperrt).

## Zeile 8 – Team, Rolle, Assignee (offen)

- `src-tauri/src/store/team_assignments.rs:129::check_claim` prüft Rolle und
  Assignee nur, wenn eine Zuweisung existiert (`if let Some(assignment)`, Zeile 134);
  ohne Zuweisungszeile endet die Funktion in Zeile 154 mit `Ok(())`. Der
  Befund vom 05.10. wird in M4-R8-FIX behoben (Paket eingereiht, noch nicht
  gemergt). Bis dahin zählt die Zeile als nicht belegt.

## Zeile 9 – Abhängigkeiten (teilweise)

- `src-tauri/src/store/development_runs.rs:1619::briefing_observes_dependency_states_without_exposing_other_projects`
  und `:1680::briefing_does_not_claim_truncated_dependency_list_is_satisfied`
  (Messung 04.10.: Exit-Code 0, 2 von 2 bestanden).
- #373: `src-tauri/src/store/continuous.rs:1681::claim_accepts_exactly_64_completed_dependencies`,
  `:1691::claim_refuses_more_than_64_completed_dependencies`,
  `:1704::claim_refuses_completed_dependency_from_another_project`.
- #412: `src-tauri/src/workers.rs:3679::dependency_matrix_launches_only_fully_satisfied_task`
  (erfüllt/offen/fehlend/projektfremd/gekürzt, genau ein Start).
- `GAP:` Fake-Adapter, kein echter Worker-Prozess.

## Zeile 10 – Kapazität und RAM (teilweise)

- `src-tauri/src/store/continuous_capacity_tests.rs:5::projects_share_capacity_across_races_restart_pause_and_expired_leases`,
  `continuous_pressure_tests.rs:4::memory_thresholds_and_unknown_observations_reduce_only_admission`,
  `:59::pressure_blocks_new_claims_without_consuming_attempts_or_releasing_work`
  (Messung 04.10.: Exit-Code 0, 3 von 3 bestanden).
- `GAP:` Kontrollierte Testeingaben; kein Lauf unter echtem Speicherdruck mit
  realen Worker-Prozessen.

## Zeile 11, 12, 20, 24, 25, 27 – PC-/Nutzer-Gates (offen)

- Kein Testbeleg möglich oder gewollt: je ein echter PC-Lauf bzw. die
  Entscheidung des Nutzers. Zeile 27: der Weg ist vorbereitet (#372 trennt
  App- von Dauerbetrieb-Release, #390/#413 halten Entscheidung E20 fest); die
  Attestierung `.pa/release_attestation_v1.5.0.json` fehlt, der Nutzer erstellt
  sie selbst.

## Zeile 14 – Checkpoints und Fortschritt (erledigt)

- `src-tauri/src/store/development_runs.rs:1714::structured_checkpoint_is_durable_fenced_and_idempotent`
  (Store-Vertrag; Messung 04.10.: Exit-Code 0, 1 von 1 bestanden).
- #365: `src-tauri/src/api/tests/continuous_e2e_tests.rs:34::checkpoint_survives_agent_abort_and_is_resumed_by_the_next_run`
  (echter HTTP-Router, Store und Fake-Agentenprozess: Checkpoint, Abbruch,
  Wiederaufnahme).
- `GAP:` keiner für die Zeile; kein echter Provider-Agent (Zeile 11).

## Zeile 15 – Candidate und Evidence (erledigt)

- `src-tauri/src/store/development_runs.rs:1863`, `:2003`, `:2054`
  (Run-/Commit-/Fence-Bindung im Store; Messung 04.10.: Exit-Code 0, 3 von 3).
- #360, alle in `src-tauri/src/api/agent_access.rs` über HTTP:
  `:845::candidate_and_evidence_bind_to_commit_and_run_and_replay_idempotently`,
  `:858::evidence_is_readable_only_inside_its_own_run`,
  `:872::foreign_and_stale_evidence_are_refused`,
  `:1010::rewritten_root_policy_leaves_run_policy_unchanged_and_fails_closed`.
- Das frühere `GAP` zur Policy-Revision ist durch den engeren Matrixtext
  geschlossen (Root-Policy einmalig eingefroren, `policy_json` je Run); die
  Revision je Candidate/Evidence (HumanPolicySnapshot, DF-13) folgt in M5.

## Zeile 17 – Invalidierung nach Candidate-Änderung (erledigt)

- `src-tauri/src/store/development_runs.rs:1863::evidence_idempotency_and_candidate_change_invalidate_review`
  (Store; Messung 04.10.: Exit-Code 0, 1 von 1).
- #374: `src-tauri/src/api/agent_access.rs:890::candidate_delta_invalidates_prior_chain_over_http`
  (A-Kette `valid`, nach B `invalidated` mit `invalidatedByCommit`, auch nach
  Wiederöffnen; `approvalEligible` bleibt false).
- Das frühere `GAP` (Release-Entscheidung) ist mit dem verengten Matrixtext
  (E19) entfallen: belegt wird die Ungültigkeit der Kette, nicht der Widerruf
  einer echten Freigabe (M5); die Zeilen 18 und 27 sind damit nicht erfüllt.

## Zeile 19 – Audit-Envelopes (teilweise)

- #358: `src-tauri/src/store/audit.rs:182`, `:193`, `:204`, `:215`
  (`domain_audit_without_{project,source_ref,run,result}_is_rejected_without_row`)
  und `:226::complete_domain_audit_appends_one_immutable_row`.
- #408 (R19-05): `src-tauri/src/workers.rs:3846`, `:3900`, `:3925`, `:3949`,
  `:3980`, `:4004` (`worker_delivery_*_appends_one_complete_audit_envelope`),
  `:4891::development_delivery_start_appends_one_complete_audit_envelope`,
  `:5130::development_delivery_enqueue_appends_one_complete_audit_envelope`.
- #423 (R19-06): `src-tauri/src/store/emergency_stop_tests.rs:118`, `:125`,
  `:136`, `:151`, `:166` (Not-Aus an/aus, Barrier-, Store-, Begin-Fehler).
- `GAP:` offen sind M4-R19-08 (Planungs-Autorisierung und -Schreibvorgänge)
  und der UPDATE/DELETE-Bypass-Beleg der Matrixzeile.

## Zeile 22, 23 – Backup, Update-Recovery (teilweise, Nutzer-Gate)

- #411 (W3-02e): `src-tauri/src/delivery_recovery/install.rs:134::production_install_never_reaches_the_installer_without_evidence`,
  `:154::production_install_persists_installing_then_runs_the_installer_once`,
  `installer.rs:217::swapped_installer_error_names_expected_and_actual_digest`.
- `GAP:` Befunde C1 (Bytes/Version ans Journal) und C2 (Wartungs-Lease)
  sind zurückgestellt auf W3-02h/W3-02i; der installierte Update-Drill fehlt.

## Zeile 21 – Crash und Power-Loss (offen)

- Kein Beleg. Ein Kill-Point-Test ist eingereiht, noch nicht gemergt; der
  Wiederanlauf-Drill am PC bleibt Nutzer-Gate.
