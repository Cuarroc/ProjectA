#!/usr/bin/env bash
# main-red-guard.sh — CI-04: a red run on main stops the Mergify queue.
#
# Why this script exists: main is merged through the Mergify queue, which
# tests every batch before merging — so a red main should be rare, but the
# weekly full run (new stable rustc, runner-image drift) can turn main red
# anyway. While main is red, every queued merge would add untested code on
# top of a broken base. This script is the reaction, wired as the job
# `main-red` in ci.yml (needs: linux + windows, only on refs/heads/main):
#
#   red run   -> freeze the queue via the Mergify scheduled-freeze API
#                (reason marker "ci-red:", scope base=main, exception
#                label=hotfix so the fix PR can still merge) and THEN open
#                an issue (label `ci-red`, run ID + run URL + SHA in the
#                body; comment instead of duplicating when one is open) so
#                the issue can report the freeze state that ACTUALLY
#                happened — never a freeze that was skipped or failed
#                (review predecessor PR, sonnet S-3). Exception: a stale run whose
#                SHA is no longer the main head only comments and never
#                freezes — otherwise a slow old red run could freeze again
#                after a newer run already went green (S-5 / opus O-5).
#   green run -> delete every "ci-red:" freeze FIRST, then close the open
#                issues (S-7 / O-6) — but only when BOTH lanes REALLY ran
#                (lane-plan.sh output `run`). A light push whose lanes were
#                skipped is no green proof, and neither is a push where
#                only one lane ran (S-6 / O-1): lane-plan cache inputs
#                differ per lane, so e.g. a package-lock-only push runs
#                linux fully while windows stays light. While a ci-red
#                freeze/issue is open such a run points at the manual full
#                run (`gh workflow run ci.yml`) — the merge push after the
#                hotfix is light by CI-02 design and cannot unfreeze (S-1 /
#                O-3).
#   else      -> cancelled/skipped/mixed results and every ref != main are
#                a no-op (the job `if` guards too; this is the double guard).
#
# Mergify API (same endpoints and wire format the official mergify-cli
# uses, crates/mergify-freeze — verified 2026-09-25 against create.rs /
# delete.rs / list.rs): POST /v1/repos/<repo>/scheduled_freeze with
# start/end = null (the documented open-ended emergency-freeze shape),
# GET .../scheduled_freeze (answer key `scheduled_freezes`),
# POST .../scheduled_freeze/<id>/delete with {"delete_reason": ...},
# auth `Authorization: Bearer $MERGIFY_TOKEN`. Without MERGIFY_TOKEN the
# freeze steps are skipped with a ::warning (the issue is the fallback —
# same degrade pattern as the Test-Insights upload in ci.yml). Every other
# external failure is LOUD (exit 1): a guard that cannot freeze while main
# is red must not be green by absence (AGENTS.md).
#
# Inputs (env): GIT_REF, LINUX_RESULT, WINDOWS_RESULT, LINUX_RAN,
# WINDOWS_RAN (lane-plan outputs "true"/"false"), RUN_ID, RUN_URL, SHA,
# REPO (owner/repo), GH_TOKEN (used by gh itself), MERGIFY_TOKEN.
#
# Self-test: scripts/test-main-red-guard.sh
set -uo pipefail

: "${GIT_REF:?}" "${LINUX_RESULT:?}" "${WINDOWS_RESULT:?}" \
  "${LINUX_RAN:=}" "${WINDOWS_RAN:=}" \
  "${RUN_ID:?}" "${RUN_URL:?}" "${SHA:?}" "${REPO:?}"
MERGIFY_TOKEN="${MERGIFY_TOKEN:-}"

API="https://api.mergify.com/v1/repos/$REPO"
MARKER="ci-red:"

note() { echo "::notice title=main-red-guard::$*"; }
warn() { echo "::warning title=main-red-guard::$*"; }
fail() { echo "::error title=main-red-guard::$*"; exit 1; }

summary() {
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"
  return 0
}

# --- helpers ---------------------------------------------------------------

# mg_api <method> <path> [json-body] [retry] — one Mergify API call, loud on
# failure. --fail-with-body keeps the server's error message visible (plain
# -f would discard it); --max-time so a hanging API cannot eat the whole
# 5-minute job budget. Retry only where the call is idempotent (GET,
# delete) — never on the create POST (review predecessor PR, S-10 / opus O-8).
mg_api() {
  local method="$1" path="$2" body="${3:-}" retry="${4:-}"
  local args=(-sS --fail-with-body --max-time 30 -X "$method" -H "Authorization: Bearer $MERGIFY_TOKEN")
  [ -n "$retry" ] && args+=(--retry 2 --retry-all-errors)
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" --data "$body")
  curl "${args[@]}" "$API$path"
}

# freeze_ids — IDs of our freezes (reason starts with the marker), one/line.
freeze_ids() {
  mg_api GET /scheduled_freeze "" retry | node -e '
    const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
    for (const f of d.scheduled_freezes || [])
      if (f.id && (f.reason || "").startsWith("ci-red:")) console.log(f.id);
  '
}

# open_ci_red_issues — numbers of open issues with label ci-red, one/line.
open_ci_red_issues() {
  gh issue list --repo "$REPO" --label ci-red --state open --json number --limit 50 |
    node -e '
      const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
      for (const i of d) console.log(i.number);
    '
}

# issue_body <failed-lanes> <freeze-state-sentence>
issue_body() {
  cat <<EOF
**main ist rot** (CI-04).

- Run-ID: $RUN_ID
- Run: $RUN_URL
- Commit: $SHA
- Rote Bahn(en): $1

**Freeze-Status:** $2

Wie es weitergeht:

1. Fix-PR mit Label \`hotfix\` — der Freeze laesst \`label=hotfix\` durch
   (der Branch-Name allein reicht NICHT).
2. Der Push nach dem Queue-Merge des Fixes ist ein LEICHTER Lauf (Bahnen
   uebersprungen) und hebt den Freeze nicht auf. Nach dem Merge des Fixes
   einen vollen Lauf starten: \`gh workflow run ci.yml\` (Actions -> ci ->
   Run workflow, Branch main). Ein gruener Lauf, bei dem BEIDE Bahnen
   wirklich gelaufen sind, loescht den Freeze und schliesst dieses Issue
   automatisch.
3. Manuell: Mergify-Dashboard -> Merge Protections -> Scheduled Freezes,
   Freeze \`ci-red: ...\` loeschen, danach dieses Issue schliessen.
EOF
}

# --- double guard: only main -----------------------------------------------
if [ "$GIT_REF" != "refs/heads/main" ]; then
  note "ref $GIT_REF ist nicht main - nichts zu tun (Job-if greift zuerst)."
  exit 0
fi

red="false"
[ "$LINUX_RESULT" = "failure" ] && red="true"
[ "$WINDOWS_RESULT" = "failure" ] && red="true"
green="false"
[ "$LINUX_RESULT" = "success" ] && [ "$WINDOWS_RESULT" = "success" ] && green="true"

if [ "$red" = "false" ] && [ "$green" = "false" ]; then
  note "Ergebnisse linux=$LINUX_RESULT windows=$WINDOWS_RESULT - weder rot noch gruen (cancelled/skipped), nichts zu tun."
  exit 0
fi

# --- red: freeze first, then an issue that reports the ACTUAL state --------
if [ "$red" = "true" ]; then
  failed=""
  [ "$LINUX_RESULT" = "failure" ] && failed="gates (linux)"
  [ "$WINDOWS_RESULT" = "failure" ] && failed="${failed:+$failed, }gates (windows)"

  gh label create ci-red --repo "$REPO" --color B60205 --force \
    --description "main ist rot (CI-04)" ||
    fail "gh label create fehlgeschlagen"

  # A stale run (its SHA is no longer the main head) must not freeze again:
  # main runs do not cancel each other, so a slow old red run could finish
  # after a newer run already went green (review predecessor PR, S-5 / O-5).
  head="$(gh api "repos/$REPO/commits/main" --jq .sha)" ||
    fail "gh api commits/main fehlgeschlagen"
  if [ "$head" != "$SHA" ]; then
    note "ueberholter Lauf: $SHA ist nicht mehr der main-Kopf ($head) - kein neuer Freeze."
    existing="$(open_ci_red_issues)" || fail "gh issue list fehlgeschlagen"
    if [ -n "$existing" ]; then
      first="$(printf '%s\n' "$existing" | head -1)"
      gh issue comment "$first" --repo "$REPO" \
        --body "Ueberholter Lauf rot: Run $RUN_ID ($RUN_URL), Commit $SHA - der main-Kopf ist inzwischen $head. Kein neuer Freeze; der Lauf auf dem Kopf entscheidet." ||
        fail "gh issue comment fehlgeschlagen"
      echo "Issue #$first kommentiert (ueberholter Lauf, kein Freeze)."
    fi
    summary "### main-red-guard: ROT (ueberholt)" "$SHA != Kopf $head - kein Freeze"
    exit 0
  fi

  freeze_state="" freeze_failed=0
  if [ -z "$MERGIFY_TOKEN" ]; then
    freeze_state="Der Queue-Freeze wurde NICHT gesetzt (MERGIFY_TOKEN fehlt) - bitte manuell einfrieren: Mergify-Dashboard -> Merge Protections -> Scheduled Freezes, Grund 'ci-red:', Scope base=main, Ausnahme label=hotfix."
    warn "MERGIFY_TOKEN ist nicht gesetzt - Queue-Freeze uebersprungen. Das Issue bleibt die Absicherung; Freeze manuell im Mergify-Dashboard setzen."
  elif ! ids="$(freeze_ids)"; then
    freeze_state="ACHTUNG: die Mergify-Freeze-Liste war nicht lesbar (API-Fehler) - der Freeze-Status ist unbekannt, bitte manuell pruefen und noetigenfalls einfrieren."
    freeze_failed=1
  elif [ -n "$ids" ]; then
    freeze_state="Die Mergify-Queue war bereits eingefroren (Marker ci-red:, ID(s): $(printf '%s' "$ids" | tr '\n' ' '))."
    echo "Freeze mit Marker '$MARKER' existiert bereits: $(printf '%s' "$ids" | tr '\n' ' ')- kein zweiter."
  else
    payload="$(printf '{"reason":"ci-red: main red, run %s","start":null,"end":null,"timezone":"UTC","matching_conditions":["base=main"],"exclude_conditions":["label=hotfix"]}' "$RUN_ID")"
    if mg_api POST /scheduled_freeze "$payload" > /dev/null; then
      freeze_state="Die Mergify-Queue wurde eingefroren (ci-red: main red, run $RUN_ID; Ausnahme: label=hotfix)."
      echo "Queue eingefroren (ci-red: main red, run $RUN_ID; Ausnahme: label=hotfix)."
    else
      freeze_state="ACHTUNG: der Queue-Freeze konnte NICHT angelegt werden (Mergify-API-Fehler) - die Queue laeuft weiter, obwohl main rot ist! Bitte manuell einfrieren (s. unten)."
      freeze_failed=1
    fi
  fi

  body="$(issue_body "$failed" "$freeze_state")"
  existing="$(open_ci_red_issues)" || fail "gh issue list fehlgeschlagen"
  if [ -z "$existing" ]; then
    gh issue create --repo "$REPO" --label ci-red \
      --title "Roter main: Run $RUN_ID" --body "$body" ||
      fail "gh issue create fehlgeschlagen"
    echo "Issue angelegt (Label ci-red, Run $RUN_ID)."
  else
    first="$(printf '%s\n' "$existing" | head -1)"
    gh issue comment "$first" --repo "$REPO" \
      --body "Erneut rot: Run $RUN_ID ($RUN_URL), Commit $SHA, Bahn(en): $failed. Freeze-Status: $freeze_state" ||
      fail "gh issue comment fehlgeschlagen"
    echo "Issue #$first schon offen - kommentiert statt dupliziert."
  fi

  [ "$freeze_failed" = 1 ] &&
    fail "Mergify: Freeze nicht gesichert - die Queue laeuft moeglicherweise weiter, obwohl main rot ist (Details im Issue)."
  summary "### main-red-guard: ROT" "$freeze_state"
  exit 0
fi

# --- green: only a FULL run (both lanes) is proof ---------------------------
if [ "$LINUX_RAN" != "true" ] || [ "$WINDOWS_RAN" != "true" ]; then
  msg="kein voller Lauf (linux run=${LINUX_RAN:-leer}, windows run=${WINDOWS_RAN:-leer}) - kein Gruen-Beweis, Freeze bleibt"
  existing="$(open_ci_red_issues)" || fail "gh issue list fehlgeschlagen"
  ids=""
  if [ -n "$MERGIFY_TOKEN" ]; then
    ids="$(freeze_ids)" || fail "Mergify: Freeze-Liste nicht lesbar"
  fi
  if [ -n "$existing" ] || [ -n "$ids" ]; then
    note "$msg. Ein ci-red-Freeze/Issue ist noch offen - nach dem Fix-Merge einen vollen Lauf starten: gh workflow run ci.yml (Branch main). Nur der entfriert."
  else
    note "$msg."
  fi
  exit 0
fi

# Delete our freezes BEFORE closing the issues (S-7/O-6): if a delete fails
# the issue must stay open - a closed issue with a live freeze would look
# resolved while the queue is still frozen.
del_failed=0
lift_note="Freeze aufgehoben (CI-04)."
if [ -z "$MERGIFY_TOKEN" ]; then
  lift_note="Freeze-Status nicht geprueft (MERGIFY_TOKEN fehlt) - falls einer aktiv ist, manuell im Mergify-Dashboard loeschen (CI-04)."
  warn "MERGIFY_TOKEN ist nicht gesetzt - kann keinen Freeze loeschen. Falls einer aktiv ist: manuell im Mergify-Dashboard loeschen."
else
  ids="$(freeze_ids)" || fail "Mergify: Freeze-Liste nicht lesbar"
  for id in $ids; do
    if mg_api POST "/scheduled_freeze/$id/delete" \
        "{\"delete_reason\":\"main green again, run $RUN_ID\"}" retry > /dev/null; then
      echo "Freeze $id geloescht."
    else
      echo "::error title=main-red-guard::Mergify: Freeze $id konnte nicht geloescht werden"
      del_failed=1
    fi
  done
fi
[ "$del_failed" = 1 ] &&
  fail "Freeze(s) konnten nicht geloescht werden - Issue(s) bleiben offen, bis der Freeze weg ist."

closed=""
existing="$(open_ci_red_issues)" || fail "gh issue list fehlgeschlagen"
for n in $existing; do
  gh issue close "$n" --repo "$REPO" \
    --comment "Gruen bewiesen: Run $RUN_ID ($RUN_URL), Commit $SHA - beide Bahnen gelaufen. $lift_note" ||
    fail "gh issue close #$n fehlgeschlagen"
  closed="$closed #$n"
done
[ -n "$closed" ] && echo "Issues geschlossen:$closed"
summary "### main-red-guard: GRUEN" "Issues geschlossen:${closed:-keine}" "Freezes geloescht: ${ids:-keine/uebersprungen}"
exit 0
