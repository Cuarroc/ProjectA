#!/usr/bin/env bash
# prepush-lane.sh — welche Bahn faehrt .githooks/pre-push?
#
# CI-02 (MASTERPLAN: "Leichtes prepush fuer Branch-Pushes, volles Gate vor
# PR-Oeffnung"). Draft-PRs bekommen seit CI-01 keine CI mehr; ein Push auf
# einen Arbeits-Branch kostet also keine Actions-Minute, und die volle Bahn
# `prepush` (clippy + Rust-Suite, lokal 10-20 min) vor JEDEM solchen Push
# bremst nur. Belegt werden muss der Stand, der in CI geht - also vor dem
# Oeffnen bzw. Bereitmelden des PRs.
#
# Regel:
#   PA_PREPUSH nicht gesetzt oder "full" -> prepush (wie bisher; Standard)
#   PA_PREPUSH=light                     -> branchpush (ohne clippy/Rust-Suite)
#                                           AUSSER ein Ziel ist main/master:
#                                           dann trotzdem prepush
#   jeder andere Wert                    -> Aufruffehler (Exit 2), kein
#                                           stilles Raten
#
# Bewusst opt-in: wer den Schalter nicht kennt, faehrt weiter voll. Die volle
# Bahn vor dem PR bleibt Pflicht (AGENTS.md "Merging"):
#   bash scripts/ci/gates.sh lane prepush
#
# Eingabe: stdin des pre-push-Hooks, je Zeile
#   <local ref> <local sha> <remote ref> <remote sha>
# Ausgabe: der Bahnname auf stdout; Begruendung auf stderr.
# Selbsttest: scripts/test-prepush-lane.sh
set -uo pipefail

mode="${PA_PREPUSH:-full}"
case "$mode" in
  full)
    echo prepush
    exit 0
    ;;
  light) ;;
  *)
    echo "prepush-lane: PA_PREPUSH='$mode' ist unbekannt (full|light)" >&2
    exit 2
    ;;
esac

while read -r _local_ref _local_sha remote_ref _remote_sha; do
  case "${remote_ref:-}" in
    refs/heads/main | refs/heads/master)
      echo "prepush-lane: Push nach $remote_ref - volle Bahn prepush trotz PA_PREPUSH=light" >&2
      echo prepush
      exit 0
      ;;
  esac
done

echo "prepush-lane: PA_PREPUSH=light - Bahn branchpush (ohne clippy/Rust-Suite). Vor dem PR: bash scripts/ci/gates.sh lane prepush" >&2
echo branchpush
