# Spickzettel — die 20 wichtigsten Befehle und Klicks

Kernaussage: **Du brauchst fast nur Lesen und Entscheiden.** Alles hier ändert
nichts an Code oder Geld. Unbekannte Wörter: [Glossar](glossar.md). Hilfe im
Chat: der Skill `frag-mich` (`/frag-mich Warum ist der Check rot?`).

Befehle laufen im Terminal im Projektordner (Git Bash oder PowerShell).
`<n>` = PR-Nummer, `<id>` = Run-Nummer aus der Checks-Liste.

## Sehen, was los ist

| # | Ich will … | Befehl / Klick |
| --- | --- | --- |
| 1 | Alle offenen PRs sehen | `gh pr list --repo Cuarroc/ProjectA` |
| 2 | Einen PR im Browser lesen | `gh pr view <n> --web` (oder auf GitHub → *Pull requests*) |
| 3 | Wissen, ob die Checks grün sind | `gh pr checks <n>` — grün = ok, rot = Fehler, gelb = läuft |
| 4 | Lesen, warum ein Check rot ist | `gh run view <id> --log-failed` — nur die Fehlerzeilen |
| 5 | Den aktuellen Stand lesen | Datei `STAND.md`; offene Arbeit: `docs/PLAN.md` |
| 6 | Ein Briefing aus git | `bash scripts/sync.sh start` |
| 7 | Sehen, welche Arbeitsbäume es gibt | `git worktree list` |
| 8 | Sehen, was ich selbst geändert habe | `git status --short --branch` |

## Limits und Kosten

| # | Ich will … | Befehl / Klick |
| --- | --- | --- |
| 9 | Claude-Limit prüfen | Claude-App → *Nutzung*, oder `/usage` in Claude Code. Über 85 % = pausieren |
| 10 | Codex-Limit prüfen | `/status` im Codex-Terminal |
| 11 | Wissen, ob Ollama voll ist | Fehler `429 session limit` = Fenster voll; Konto auf ollama.com |

## Entscheiden

| # | Ich will … | Befehl / Klick |
| --- | --- | --- |
| 15 | Ein Dev-HQ-Cockpit öffnen | `npm run hq:live`, dann <http://localhost:4173> |

## Orca und Flotte

| # | Ich will … | Befehl / Klick |
| --- | --- | --- |
| 16 | Sehen, welche Terminals laufen | Orca-App öffnen (Tabs je Worktree) oder `orca terminal list` |
| 17 | Mitlesen, was ein Worker tut | `orca terminal read --terminal <handle> --screen` (Handle aus Nr. 16) |

## Prüfen, ob mein Rechner bereit ist

| # | Ich will … | Befehl / Klick |
| --- | --- | --- |
| 19 | Den Rechner prüfen (nur lesend) | `npm run dev:doctor -- --json` oder `bash scripts/ci/doctor.sh` |
| 20 | Alle Prüfstufen sehen / lokal laufen lassen | `bash scripts/ci/gates.sh --list`, dann `bash scripts/ci/gates.sh lane prepush` |

## Nie ohne Nachdenken

- **Nicht** `git stash` (geteilt mit allen Arbeitsbäumen), **nicht** `--no-verify`, **nicht** die Desktop-App
  „nur zum Ansehen“ starten (die Warteschlange kann sofort echte Worker starten).
- Löschen, Geld, Installationen und Releases entscheidest **du** — frag im Zweifel mit `/frag-mich Was soll ich entscheiden?`.
