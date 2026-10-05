# Benchmark v1.6.0: Arbeiten wir effektiver als früher? (Entwurf)

Stand 05.10.2026, Basis `2ec6960`. Alle Befehle nur lesend, ausgeführt am 05.10.2026, Exit 0.

## 1. Frage und Urteil

Frage: Arbeitet das Projekt seit der Pipeline (Mergify-Queue, gestufte Reviews, Server-Autopilot) effektiver als vorher?
Urteil: **teilweise belegt.**
- Belegt: PRs landen viel schneller (p90 von 127 h auf 3 h) und viel kleiner.
- Teilweise belegt: Rote PR-Köpfe sind seltener, aber Windows wird auf PRs nicht mehr geprüft; das rote Ergebnis zeigt sich jetzt erst in der Queue.
- Nicht belegt: Weniger Nacharbeit gibt es nicht (gleich viel pro Paket, pro Codezeile mehr), und die Codemenge pro Tag ist nur um etwa 15 % gestiegen.
- Nicht messbar: Nutzer-Eingriffe und Kontingent pro PR. Dafür fehlt heute die Messung.

## 2. Zeitfenster und Quellen

| Fenster | Repo | Zeitraum (UTC, Merge-Datum) | Warum |
|---|---|---|---|
| **F** früher | Archiv (privat) | 21.–23.09. (3 Tage) | Die 3 Tage direkt vor Mergify (24.09.), zugleich die aktivsten vor der Pipeline. Konservativ: begünstigt „früher“. |
| **J** jetzt | öffentliches Repo | 02.–04.10. (3 Tage) | Die ersten 3 vollen Tage mit pipeline.py, Queue und Stufen. |
| F2 / J2 | wie oben | alle Archiv-Tage vor 24.09. / 02.10. bis Basis | Zweites Fenster zur Prüfung der Empfindlichkeit. |
| L0 | lokales Ereignislog | 25.–26.09. | Autopilot ohne pipeline.py. Das Log beginnt erst am 25.09., für F gibt es keins. |

- Ausgeschlossen: Mergify-Prüf-PRs (`mergify/*`) und Dependabot. Die Port-PRs vom 25./26.09. liegen außerhalb von J.
- Diffzeilen: `git diff --numstat <merge>^1 <merge>`, ohne `*.lock`, `package-lock.json`, `docs/dev-hq/data.*` und das eingebettete Skill-Datenpaket (`src-tauri/resources/skills/*/data`, PR #45 im Archiv, 64 Tsd. Zeilen).
- Code = alles außer `*.md`, `docs/`, `.pa/`.
- Die F-Zahlen kann nur nachrechnen, wer Lesezugriff auf das private Archiv-Repo hat.

## 3. Ergebnisse

| ID | Metrik | F | J | F2 | J2 | Urteil | Vorbehalt |
|---|---|---|---|---|---|---|---|
| M-THR | gemergte PRs / aktiver Tag | 12,0 (36/3) | 64,3 (193/3) | 4,3 | 57,2 | teilweise belegt | Größtenteils kleinerer Zuschnitt, s. Codezeilen |
| M-THR | Code-Zeilen / aktiver Tag | 6 973 | 8 047 | 4 900 | 7 221 | teilweise belegt | +15 % gegen F, +47 % F2→J2 |
| M-THR | verschiedene Pakete / aktiver Tag | 5,7 (17) | 27,3 (82) | 1,3 | 21,3 | belegt | Paket-ID aus dem Branchnamen |
| M-LEAD | PR erstellt → Merge, Median / p90 (h) | 3,8 / 127,3 | 1,1 / 3,1 | 3,4 / 119,3 | 1,1 / 3,0 | **belegt** | Kleinere PRs sind von Natur aus schneller |
| M-LEAD | erster Commit → Merge, Median / p90 (h) | 3,9 / 126,3 | 1,3 / 3,3 | 3,9 / 122,0 | 1,2 / 3,0 | **belegt** | Prüft „PR erst spät öffnen“: hält stand |
| Regel 1 | PRs über 300 Zeilen | 81 % (29/36) | 5 % (10/189) | 77 % | 6 % | belegt | Regel steht erst seit 23.09. in AGENTS.md |
| Größe | Median Zeilen pro PR | 733 | 106 | 788 | 110 | — | Faktor 7 kleiner |
| Review | Code-PRs mit Review-Fix-Commit | 72 % (21/29) | 12 % (18/155) | — | 15 % | **nicht belegt** | Näherung per Regex; Stufe C hat jetzt gar kein Review |
| Review | PR-Text nennt Runde 2 | 8 % (3/36) | 14 % (26/189) | — | 12 % | nicht belegt | Früher gab es keinen strukturierten Report |
| CI | rote PR-Köpfe (ci, pull_request) | 25,2 % (37/147) | 9,2 % (30/327) | 38,0 % | 8,0 % | teilweise belegt | Windows auf PR ist seit CI-03 nur ein Stub, Drafts haben kein CI |
| CI | rote Queue-Läufe (`mergify/*`) | — | 17,5 % (28/160) | — | 15,5 % | Baseline | Das Windows-Urteil wird erst hier gefällt |
| M-REDMAIN | rote main-Vorfälle / rote Stunden | 0 / 0 (35 Läufe) | 0 / 0 (179) | 3 / 137 h | 0 / 0 (215) | teilweise belegt | Push auf main ist jetzt „leicht“; KI-32 zeigt, dass Versuch-1-Rot im Endergebnis verschwindet |
| M-REWORK | Fix-PR, gleiches Paket, ≤ 72 h | 13 % (3/23) | 12,5 % (16/128) | 11,5 % | 15,7 % | **nicht belegt** | pro 100 Zeilen 0,005 → 0,052 (schlechter) |
| M-REWORK | ohne Merge geschlossen (echte PRs) | 7,1 % (2/28) | 9,0 % (19/210) | 12,5 % | 7,9 % | nicht belegt | — |
| M-REWORK | Hotfix-/Revert-PRs | 0 | 4 | 0 | 4 | nicht belegt | — |
| M-TRAILER | Commits mit red-first-Trailer | 94 % (193/205) | 99 % (485/490) | 83 % | 99 % | belegt | — |
| M-HUMAN | Nutzer-Eingriffe | — | 20 Inbox-Einträge E1–E20 | — | 25 | **nicht belegt** | Ein Account für alles; eine Inbox gibt es erst jetzt |
| Kontingent | Verbrauch pro gemergtem PR | — | — | — | — | **nicht belegt** | Nicht pro PR beobachtet; Codex ist seit J bis 11.10. erschöpft |
| M-RP | Prompts mit Kritik-Protokoll | — | 40/655 Job-Specs (nur lokal) | — | — | nicht belegt | Keine Baseline vor dem 05.10. |
| Anbieter | gemergte PRs nach Branch-Präfix seit 02.10. | — | — | — | claude 134 / codex 81 / opencode 4 / übrige 7 (Stand 05.10., 12:08 UTC) | Baseline | Ein Anbieter trägt 59 %; Befehl in Abschnitt 5 |

**Orchestrator-Ereignislog** (nur lokal, nicht reproduzierbar, nur Aggregate), L0 (2 Tage) gegen J (3 Tage):

| Ereignis | L0 | J | Urteil |
|---|---|---|---|
| Jobs mit Exit ≠ 0 / beendete Jobs | 21 % (33/154) | 5 % (9/181) | belegt (lokal) |
| HAENGT+NEUSTART / Job-Start | 2,2 % (3/137) | 6,3 % (9/142) | schlechter |
| ALARM gesamt (LEERLAUF / BLOCKIERT / FEHLER) | Alarmart gab es noch nicht | 113 (99 / 9 / 5) bei 460 Jobs (142 lokal + 318 Server) | Baseline |
| KEIN-PR | — | 0 (J2: 1) | Baseline |
| Aufträge mit Ende BLOCKIERT je Start; Konflikt-Aufträge (anderes Fenster: 03.–05.10.) | — | 6,7 % (32/479), davon 13 im Auftrag vermeidbar und 10 durch die Umgebung; 28 Konflikt-Aufträge | Baseline |

## 4. Störgrößen (was davon die Unterschiede erklären könnte)

1. **Kleinerer Zuschnitt (Regel 1):** PRs sind etwa 7-mal kleiner. Das erklärt den größten Teil des Faktors 5 bei PRs/Tag. Pro Codezeile bleiben nur etwa +15 %.
2. **Mehr Agenten und Anbieter:** Codex-PRs stiegen von 4 auf 78 (41 % von J). Dazu kamen ab 02.10. 8 Server-Slots. Danach war das Codex-Wochenlimit erschöpft. Das J-Tempo ist deshalb nicht dauerhaft gesichert, und ein großer Teil von M-THR geht auf mehr Kapazität zurück, nicht auf die Arbeitsweise.
3. **CI-Regeln:** Seit CI-03 hat ein PR auf Windows nur einen Stub, Drafts bekommen kein CI, Doku-PRs überspringen Linux. Das senkt die Rotquote der PR-Köpfe künstlich; das rote Windows-Ergebnis verschiebt sich in die Queue (17,5 %). Im Archiv lag vom 18. bis 24.09. zeitweise das Actions-Ausgabenlimit an. Ein Teil der roten F-Läufe kann daher Abrechnung statt Code sein; das ist nicht ausgezählt.
4. **Doku-Mischung:** Früher wurden Review-Prompts und Reports mitcommittet (35 Tsd. Doku-Zeilen in F gegen 6 Tsd. in J). Deshalb wird nur auf Code-Zeilen normiert.
5. **Neuheitseffekt und Fenster:** J sind die ersten Tage mit Nachtläufen. F2/J2 zeigen dieselbe Richtung, das Urteil kippt in keiner Metrik.
6. **Näherungen:** Paket-ID per Regex aus dem Branch. Nacharbeit wird nur über „fix“ im Titel erkannt. Mehr Teilpakete (a/b/c) in J geben mehr Gelegenheit für Treffer. Review-Runden über Commit-Betreffs.
7. **Neustart:** Das öffentliche Repo hat eine importierte Historie ohne PRs. Nur das Archiv hat echte PR-Daten für „früher“.

## 5. Reproduktion (nur lesend)

```sh
REPO=<öffentliches Repo>; ARCHIV=<Archiv-Repo, privat>
F='number,title,headRefName,createdAt,mergedAt,state,additions,deletions,author,mergeCommit'
gh pr list -R "$REPO" --state all --limit 1000 --json "$F" > now_prs.json
gh pr list -R "$ARCHIV" --state all --limit 1000 --json "$F" > old_prs.json
R='databaseId,event,headBranch,headSha,conclusion,createdAt,workflowName'
for d in 02 03 04 05; do gh run list -R "$REPO" -w ci --limit 1000 --created 2026-10-$d --json "$R"; done
gh run list -R "$ARCHIV" -w ci --limit 1000 --created 2026-08-20..2026-10-03 --json "$R"
git diff --numstat <merge>^1 <merge>                          # Zeilen je PR (Filter s. Abschnitt 2)
git log --no-merges --format='%s%n%b' <merge>^1..<merge>^2    # Trailer, Review-Fix-Commits
git log origin/main -p -- docs/PLAN.md | grep -E '^\+\| *E[0-9]+'   # Inbox-Einträge
gh pr list -R "$REPO" --state merged --limit 1000 --search 'merged:>=2026-10-02' --json headRefName   # Anbieter = Branch-Präfix, ohne mergify/ und dependabot/
```

- Ein `gh run list` liefert höchstens 1000 Zeilen, deshalb tageweise abfragen. Die Archiv-Abfrage lieferte 870 Zeilen und liegt unter der Grenze.
- Der Auswerter war ein Wegwerf-Skript und ist nicht erhalten. Die Muster für Paket-ID, Fix-PR, Review-Fix-Commit und „Runde 2“ stehen deshalb nirgends. Die Zeilen „verschiedene Pakete“, Review und M-REWORK sowie die Nenner 189 und 210 (statt 193) sind bis BENCH-01 nicht nachrechenbar. BENCH-01 schreibt die Muster ins Skript und weist M-LEAD je Stufe und Größenklasse aus.
- Rohsummen F / F2 / J / J2: aktive Tage 3 / 15 / 3 / 4; gemergt 36 / 64 / 193 / 229; Paket-PRs 23 / 26 / 128 / 140; Code-Zeilen 20 919 / 73 506 / 24 141 / 28 885; Commits 205 / 422 / 490 / 555; PR-Läufe 147 / 403 / 327 / 376, davon rot 37 / 153 / 30 / 30; Queue-Läufe J / J2: 160 / 200, davon rot 28 / 31.

## 6. Vorwärts-Benchmark v1.6.0

Baseline = J2 (02.10. bis Basis). Ziele gelten pro Woche, gemessen am Montag:

| ID | Baseline | Ziel v1.6.0 |
|---|---|---|
| M-THR | 7 221 Code-Zeilen / 21 Pakete pro aktivem Tag | ≥ 7 000 / ≥ 20, auch in Wochen ohne Codex |
| M-LEAD | p90 3,0 h | p90 ≤ 6 h |
| M-REWORK | 15,7 % Fix-PRs ≤ 72 h pro Paket-PR; 4 Hotfix/Revert | ≤ 8 %; ≤ 1 pro Woche |
| CI | 8,0 % rote PR-Köpfe; 15,5 % rote Queue-Läufe | ≤ 7 %; ≤ 10 % |
| M-REDMAIN | 0 Vorfälle (Endergebnis) | 0, gezählt **pro Versuch** |
| Regel 1 | 6 % über 300 Zeilen | ≤ 3 % |
| M-TRAILER | 99 % | ≥ 99 % |
| M-HUMAN | 25 Inbox-Einträge in 4 Tagen | ≤ 10 neue pro Woche; neu messen: Nutzer-Kommentare und Freigaben |
| M-IDLE | 31 LEERLAUF-Alarme pro Tag (lokal, J2; im Fenster J 99 in 3 Tagen = 33) | ≤ 10 pro Tag |
| M-RP | 6 % der Job-Specs (lokal); kein PR vor #488 trägt `### Prompt-Log` | ≥ 90 % der Paket-PRs mit Prompt-Log (FLOW-05); Nacharbeit mit vs. ohne getrennt ausgewiesen |
| Kontingent | nicht beobachtet | für ≥ 80 % der Jobs Anbieter + Verbrauchsbeleg je PR erfasst |

Pakete für die Wochenmessung (nicht umgesetzt):
- **BENCH-01**, M ≤ 300 Zeilen, Lane `ci`, Stufe B, `Test-First:`: `scripts/dev/bench-weekly.mjs`. Rechnet die Tabelle oben aus `gh`/`git` nach (nur lesen), Ausgabe als JSON und Markdown. Getestet mit JSON-Fixtures.
- **BENCH-02**, S ≤ 150 Zeilen, Lane `ci`, Stufe B, `No-Test: workflow wiring`: ein eigener Workflow, montags (wie der Wochenlauf) und per `workflow_dispatch`. Nur Leserechte, schreibt in die Job-Summary und ein Artefakt, kein Commit. Kosten: Actions-Minuten im öffentlichen Repo.
- **BENCH-03**, lokal beim Orchestrator, nicht im Repo: Wochen-Aggregat für M-IDLE, M-HUMAN, M-RP und Kontingent je Job, als Eingabe für BENCH-01.

## 7. NICHT ABGEDECKT

- Ob die PRs von J mehr **Nutzen** bringen: Die Zahl der PRs ist kein Wertmaß. Der W4-01-Aufgabenbenchmark ist nicht gelaufen (E23 offen).
- Wie viele rote F-Läufe auf das Actions-Ausgabenlimit gingen: nicht per `--log-failed` ausgezählt.
- Rot im ersten Versuch auf main: `gh run list` zeigt nur das Endergebnis (siehe KI-32).
- Nutzerzeit, Unterbrechungen und Kontingent: nicht gemessen. Die Ereignislog-Werte sind nur lokal.
- Die Fenster haben 3 Tage. Eine Woche Betrieb ohne Codex steht noch aus.
