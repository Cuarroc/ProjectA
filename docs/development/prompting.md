# Rekursives Prompting

Standard für jeden Prompt in ProjectA: **Entwurf → Kritik gegen die Checkliste → Verfeinerung**, höchstens **zwei Runden**, protokolliert. Der Plan dahinter steht in `docs/plan/v1.6.0/plan.md` Abschnitt 6; bei Widerspruch gilt `AGENTS.md`.

## Ablauf

1. **Entwurf:** der Autor schreibt den Prompt (Auftrag, Brief, Review, Schritt).
2. **Kritik:** gegen die Checkliste unten, nicht nach Gefühl. Beim Auftrag kritisiert eine andere Modellfamilie (nur Text), beim Worker-Brief der Worker selbst.
3. **Verfeinerung:** jeden Punkt „PROBLEM“ beheben. Stopp, sobald kein Punkt „hoch“ offen ist.
4. **Grenze:** nach Runde 2 ungelöst → der Orchestrator entscheidet und vermerkt es im Kopf des Auftrags. Zeigt die Kritik, dass der Auftrag selbst falsch ist (schon erledigt, Nahtkollision, fehlende Entscheidung), schreibt der Worker `BLOCKIERT: <Punkt>` und hört auf.
5. **Protokoll:** im PR-Text unter `### Prompt-Log` (Entwurf, Kritik, Endfassung; `rounds`, `critic`, `findings`, `changed`).

## Checkliste

1. Jeder Beleg ist eingefügte `rg -n`-Ausgabe, ein SHA oder ein gemergter PR, sonst steht „prüfen“ da.
2. Das Paket ist nicht schon erledigt (`git log --grep`, `gh pr list --search`).
3. Lane und Naht stehen fest; der Auftrag wartet auf den Vorgänger an derselben Naht oder Datei und fasst keine Datei eines offenen PRs an.
4. Höchstens 300 Diffzeilen, sonst vorher schneiden.
5. Die Abnahme hat Befehl und Exit-Code; der rote Test ist als `Test-First: <Pfad>::<Test>` benannt.
6. Eine nötige Nutzerentscheidung steht schon in `docs/PLAN.md`.
7. Der Ort passt zur Umgebung (Abhängigkeiten, Build-Slot, Windows).
8. Die Stufe folgt aus den Dateien. Nichts Persönliches, kein Geld, keine Installation.
9. Ein Modell ohne Gedächtnis versteht den Auftrag allein (Basis-SHA, Ausgabeform).
10. Der wahrscheinlichste Grund für „BLOCKIERT“ ist ausgeräumt.

## Selbstprüfung vor dem Push

Der Autor prüft sein Ergebnis selbst, bevor er pusht; das fängt Fehler ab, die sonst erst ein Review-Fix-Commit behebt (Ziel: Code-PRs mit Review-Fix-Commit von 15 % auf höchstens 8 %). Jeder Punkt hat einen Befehl, dessen Ausgabe und Exit-Code in den PR-Text gehören (Checkliste 4, 5, 9):

1. **Größe (4):** `git diff --shortstat origin/main...HEAD` zeigt höchstens 300 Zeilen einschließlich Tests; sonst vor dem Push schneiden.
2. **Abnahme und Trailer (5):** der Abnahmebefehl aus dem Auftrag läuft mit Exit 0; jede Commit-Nachricht trägt `Test-First: <Pfad>::<Test>`, `Regression-For:` oder `No-Test: <Grund>`; Code-PRs: `bash scripts/ci/red-first.sh --plan`. Nach dem Commit `git log -1 --format=%s%n%b` lesen, nicht durch `tail` oder `head` leiten.
3. **Allein verständlich (9):** der PR-Text nennt Basis-SHA, drei deutsche Sätze für den Nutzer, `## Report`, `### Prompt-Log` und `NICHT ABGEDECKT`.
4. **Sicherheit:** Secret-Scan vor jedem Commit; nichts Persönliches (Namen, E-Mails außer noreply, Pfade mit Benutzernamen, Kosten).
5. **Grün:** `bash scripts/ci/gates.sh lane prepush` am letzten Commit im eigenen Arbeitsbaum, Exit 0 ungemaskiert; erst danach pushen und mit `git ls-remote` prüfen.

Ein roter Punkt wird vor dem Push behoben. Er zählt nicht als Fixrunde.

## Nacharbeit: genau eine Fixrunde

Ist nach dem Push Nacharbeit nötig (Review-Befund, rote Prüfung), gilt (Plan Abschnitt 6 und 7b):

- **Eine begrenzte Fixrunde auf demselben Branch, kein neuer PR.** Der Fix ist ein Commit (kein Force-Push, kein Rebase), danach ein erneutes `prepush` und ein Push.
- Jeder Befund steht im PR-Text unter `### Nacharbeit` als `Datei:Zeile` mit Befehl und Exit-Code. Ein Befund ohne `Datei:Zeile` zählt als unbelegt.
- Die Runde behebt nur die genannten Befunde; Neues kommt in ein eigenes Paket.
- Bleibt ein Befund offen oder ist ein gepushter Commit selbst falsch (etwa ein Trailer), folgt keine zweite Fixrunde: der Worker schreibt `BLOCKIERT: <Grund>`, der Nutzer entscheidet (AGENTS.md, Regel 5: Zusammenführen, Aufteilen oder Verwerfen).
- FLOW-05 zählt die Fixrunden je PR.

## Vorlagen

Die Vorlagen sind englisch, weil sie an Agenten gehen; die Erläuterungen sind deutsch.

### 1. Auftrag (Job-Spec, Orchestrator)

```
Package: <ID> · Lane: <lane> (<seam or none>) · Tier: <A/B/C> · Size: <S|M> (<=300 diff lines incl. tests)
Base: origin/main <sha>. Predecessors (AFTER_BRANCH): <branches or none>. Decision: <E-id merged in docs/PLAN.md or none>
Prompt-Rounds: <0-2> · Critique-By: <model> · Critique-Findings: <n high / n other>
Goal (one sentence, user value): ...
Evidence (pasted `rg -n` output only, else "verify"): ...
Not done yet: `git log origin/main --oneline --grep <ID>` -> <result>; `gh pr list --state all --search <ID>` -> <result>
Files you may touch: ... (no file of an open PR: <list>)
Acceptance: <command> exit 0; red test `Test-First: <path>::<test>` | `No-Test: <reason>`
Out of scope / forbidden: seams not listed, installs, money, personal data, history rewrite.
If a predecessor is not merged or a decision is missing: write "BLOCKIERT: needs <x>" and stop.
Handover: PR body (3 German sentences, `## Report`, `### Prompt-Log`, `NICHT ABGEDECKT`).
```

### 2. Kritik-Prompt (andere Modellfamilie, nur Text)

```
You critique a job spec for an autonomous coding agent that has no memory. Do not rewrite it.
For each checklist item 1-10 answer: OK | PROBLEM (high/medium) + one-line fix. Then list the single most
likely reason this job ends in "BLOCKIERT". Output a table only. Spec follows:
<spec>
```
Stopp: alle „high“-Punkte erledigt → fertig; sonst verfeinern, Runde 2; nach Runde 2 ungelöst → Orchestrator entscheidet und vermerkt das im Spec-Kopf.

### 3. Worker-Brief (erste Handlung des Workers)

```
Before editing: write a plan of at most 15 lines (files, red test, acceptance command, risks).
Check it against the RP checklist (items 1-10). Fix every PROBLEM, at most 2 rounds.
Record in the PR body under `### Prompt-Log`: rounds=<n>, critic=<self|model>, findings=<n>, changed=<one line>.
If the check shows the spec itself is wrong (already done, seam collision, missing decision): BLOCKIERT with the item number.
```

### 4. Review-Prompt (Pipeline, je Reviewer)

```
Role: independent tier-<A/B> reviewer, model family <x>, author family <y>.
Inputs (all included, you read nothing else): task text from the PR, full `git diff origin/main...HEAD` at <sha>,
AGENTS.md rules 1-10 excerpt, docs/architecture-rules.md excerpt.
Phase 1 FIND: findings with file:line, severity high/medium/low, evidence. No style.
Phase 2 CHALLENGE: try to refute each finding against the diff (already covered? out of package? unprovable?). Keep survivors only.
Always check architecture drift (second pattern for a solved problem).
Output: table ID | severity | file:line | finding | evidence | verdict. Last line: PASS | CHANGES | BLOCKIERT: <finding>.
```
Vorab mechanisch prüfen (Skript, Exit 1 = Prompt nicht senden): Diff nicht leer und nicht gekürzt, Kandidat-SHA genannt, Regelauszug enthalten, Ausgabeformat enthalten.
Vorab mechanisch prüfen (Skript, Exit 1 = Prompt nicht senden): Diff nicht leer und nicht gekürzt, Kandidat-SHA genannt, Regelauszug enthalten, Ausgabeformat enthalten.

### 5. Team-Schritt

Jede Schritt-Anweisung eines Team-Laufs endet mit:

```
First write your own working prompt as a draft -> critique -> refine (max. 2 rounds) via team_post_note;
critique against checklist items 1-10.
```
