# Task-Spec: T-1 Test-First-Beweis (S1)

Status: historisch

Reaktiviert: 2026-09-06 · Branch: `cursor/t1-t3-clean-fea3`
Ursprung: SANIERUNGSPLAN Rev 9.1 §5 S1 / §7; Nutzerentscheid nach Schließen
von PR #19, frisch auf Rev-9-`main`.

## Inhalt

- `.githooks/commit-msg` — Trailer-Anwesenheit, kein Testlauf
- `scripts/lib/test-first.sh` — gemeinsame Klassifikation
- `scripts/ci/red-first.sh` + Job `red-first` in `ci.yml`
- `.claude/hooks/red-first.sh` + SessionStart `install-hooks.sh`
- `scripts/test-red-first.sh` — Probe in frischem Temp-Repo
- `AGENTS.md` Test-First-Absatz (≤15 Zeilen)

## Akzeptanz

- Probe lehnt Quell-Commit ohne Trailer ab und nimmt mit Trailer an
- Kontrolle: ohne Hook ginge der schlechte Commit durch
- `red-first` auf diesem PR: `scripts/test-red-first.sh` fehlt auf main, am Kopf grün
