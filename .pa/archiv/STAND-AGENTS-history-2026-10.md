# Verlauf aus STAND.md, AGENTS.md und CLAUDE.md (ausgelagert am 08.10.2026)

Nur Beleg, kein Auftrag. Beim Aufräumen vom 08.10.2026 wörtlich aus den
Anweisungsdateien herausgenommen, weil es Verlauf ist (Ereignisse, Hashes,
Run-IDs, überholte Stände). Die geltenden Regeln stehen in `AGENTS.md`, der
Stand in `STAND.md`. Die vollständigen alten Fassungen zeigt
`git show 1c09ebb:<datei>`.

## Aus `STAND.md` (Fassung vom 04.10.2026)

Kopf:

```text
# Stand — 04.10.2026
```

Release (überholt: v1.5.0 am 05.10., v1.5.1 am 06.10. veröffentlicht):

```text
- **Release:** v1.4.1 (22.09.) ist der jüngste; alles danach liegt nur auf `main`.
  Nächster Release: v1.5.0 (Beta) als Abschluss von M3.
```

Zuletzt gelandet bei Erreichen von M1:

```text
  (26.09.2026, PLAN.md, Tabelle M1). Zuletzt gelandet: SEC-01 (PR #20),
  CLEAN-02 (PR #25), W1-21d (PR #27), CI-04 (PR #28), W1-18b (PR #30),
  CLEAN-01 (PR #31), W1-30 (PR #32), W1-10 (PR #33).
```

Live-Stand (OPS-01 ist inzwischen gemergt):

```text
- **Live-Stand** kommt aus `gh pr list` und `git log origin/main`, bald aus OPS-01.
```

Schnappschuss Architektur-Rat:

```text
- **Pakete Architektur-Rat (Status beobachtet 04.10.2026 13:50 UTC = 15:50 Berlin mit `gh pr list`/`gh pr view`; Quellstand `origin/main` effef1a, `ci`-Lauf 37194125481 grün):**
  ARCH-08 (a–f), ARCH-03c (#256), ARCH-09a (#260), ARCH-09b (#264) und ARCH-10
  sind gemergt, ebenso #262 (KI-30-Diagnose), #274, #275 und #279. Offen:
  #269 ARCH-09c (Draft, `do-not-merge`), #270 OPS-02-Doku und #273 SETUP-09-Fix
  (in der Queue), #282 SETUP-12-Rest (Draft). Einzelheiten und Nachweise:
  `docs/PLAN.md`. Das ist ein Schnappschuss, kein Live-Stand.
```

Befunde:

```text
- KI-30: … neue Beobachtung 04.10. (Queue-Lauf 37196272431).
- KI-20: doppelte Antwort auf `ESC[6n` behoben (W1-27): das Backend antwortet allein, die Anfrage wird aus Scrollback und UI entfernt.
```

## Aus `AGENTS.md` (Fassung `1c09ebb`)

Warum die Gate-Liste nur in `gates.sh` steht:

```text
The gate list lives in exactly one place: `scripts/ci/gates.sh`. Until
2026-09-09 it stood five times over — both hooks, `ci.yml`, `release.yml` and as
prose here — and it drifted (`pre-push` ran `cargo test`, CI ran
`cargo nextest run --profile ci`). A sixth copy in this file would be the same
mistake, so this section names commands, not gates:
```

Herkunft der Windows-Stub-Regel und des Mergify-Starts:

```text
  get no CI; a push to a ready PR runs the linux lane and red-first (since
  CI-03, PR #149, the Windows lane on a PR is a stub — its verdict comes from
  the merge queue and the weekly run). The coordinator marks a PR ready once
## Merging (Mergify queue, since 2026-09-24)
```

Beleg für „explizit einreihen“:

```text
**Enqueue explicitly:** observed on 2026-10-04, eligible PRs were not picked
up on their own - each of the last 14 merged PRs (#240-#266) and the open
#274/#275 carry an explicit `@Mergifyio queue` comment. So once
`gh pr checks <n>` is green, the coordinator comments `@Mergifyio queue` on
the PR. Why automatic enqueueing does not take effect is unresolved (only
hypotheses); the queue run on `main` is still checked by Mergify.
```

Roter `main` vor der Automatik durch CI-04 (#28):

```text
- **Red `main`:** the queue stops (until CI-04 automates it); the coordinator puts `do-not-merge` on
  queued PRs, records the run ID in `KNOWN_ISSUES.md` and fixes `main` first.
```

Drift-Gate vor ARCH-G2 (#304):

```text
and the drift gate `scripts/ci/architecture-drift.mjs` (package ARCH-G2, may
not exist yet) enforces them.
```

## Aus `CLAUDE.md` (Fassung `1c09ebb`)

```text
Fassungen driften (belegt durch ein Doku-Audit).
- **MCP-Server und Plugins:** Der Start lädt MCP-Server, Plugins und Skills.
  Das kostet Zeit; `ruflo` und `desktop-commander` können dabei mit
  `CONNECT_TIMEOUT` hängen, ohne dass etwas kaputt ist (`memorix` verbindet in
  der Regel). Das Zeitlimit setzt `MCP_TIMEOUT` in `~/.claude/settings.json`.
- **Subagenten und Berichte:** Schreibzugriffe von Subagenten auf
  `.pa/report_*.md` können blockiert sein. Dann den Bericht als Text an den
  Koordinator zurückgeben; der Koordinator committet ihn. Nicht umgehen.
```
