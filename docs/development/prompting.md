# Rekursives Prompting

Selektiv für komplexe Pläne, viele Abhängigkeiten, schwierige Diagnosen und anspruchsvolle Entwürfe mit prüfbaren Kriterien (Elias, 08.10.2026). Ziele, Anforderungen und Abnahme bleiben erhalten; nur nötige Teilfragen bilden. `docs/PLAN.md` bleibt einziger Plan; bei Widerspruch gilt `AGENTS.md`. Keine zusätzliche Runtime, Agenten oder Hintergrunddienste dafür starten.

## Ablauf

1. **Erste Lösung:** Auftrag, Brief, Diagnose oder Ergebnis gegen das unveränderte Ziel ausarbeiten.
2. **Neutrale Zusatzprüfung:** eine Runde gegen Anforderungen, Abnahme und Evidenz; „kein Mangel“ ist ein gültiges Ergebnis. Die Checkliste unterstützt, erzeugt aber keine unnötigen Teilfragen.
3. **Korrektur:** nur konkrete Mängel beheben, dann das Ganze einschließlich Schnittstellen prüfen. Eine zweite Zusatzrunde braucht einen konkreten verbleibenden Mangel.
4. **Stopp:** Abnahme erfüllt, keine neue Erkenntnis, unveränderter Blocker oder Zeit-/Quota-/Budgetgrenze. Anforderungen nicht abschwächen. Blocker mit Ursache/Hypothese, Beleg, Auswirkung, Owner und nächstem Schritt dokumentieren; unabhängige freigegebene Arbeit fortsetzen.
5. **Protokoll:** Ticket/PR nennt Anlass, geprüfte Kriterien, Mangel/kein Mangel, Bestätigung, Korrektur und verbleibende Grenzen. Selbstprüfung ersetzt weder unabhängiges Review noch Nutzerfreigabe.

GOALS-C nutzt genau drei bereits offene Aufgaben (Lane F, DR-02, HOOK-WIN).
Je Ticket: übersehene Anforderung/Mangel oder kein Mangel, Bestätigung,
beobachtete Regressionen und nur gemessener Zusatzaufwand. Nicht gemessen heißt
unbelegt; Gate-Laufzeit ist keine isolierte Rekursionszeit. Drei Aufgaben sind
eine Stichprobe, kein Wirksamkeitsbeweis. Überwiegt der Aufwand, Anwendung
einschränken; keine zusätzlichen QA-Bots, Testagenten oder Benchmarks.

## Checkliste

1. Materielle Aussagen haben aktuelle Werkzeug-/Source-/SHA-Belege mit geprüftem Umfang; sonst steht „unbelegt“ oder „prüfen“ da.
2. Das Paket ist nicht schon erledigt (`git log --grep`, `gh pr list --search`).
3. Lane und Naht stehen fest; der Auftrag wartet auf den Vorgänger an derselben Naht oder Datei und fasst keine Datei eines offenen PRs an.
4. Höchstens 300 Diffzeilen, sonst vorher schneiden.
5. Die Abnahme hat Befehl und Exit-Code; der rote Test ist als `Test-First: <Pfad>::<Test>` benannt.
6. Eine nötige Nutzerentscheidung steht schon in `docs/PLAN.md`.
7. Der Ort passt zur Umgebung (Abhängigkeiten, Build-Slot, Windows).
8. Die Stufe folgt aus den Dateien; gültige konkrete Freigaben erhalten, keine Rechte-/Budgetausweitung.
9. Ein Modell ohne Gedächtnis versteht den Auftrag allein (Basis-SHA, Ausgabeform).
10. Der wahrscheinlichste Grund für „BLOCKIERT“ ist ausgeräumt.

## Selbstprüfung vor dem Push

Der Autor prüft die erforderlichen Abnahmebelege vor dem Push. Diese regulären Gates werden nicht ohne konkreten Anlass als zusätzliche Rekursionsrunden wiederholt. Befehle, Ausgabe und Exit-Code gehören in den PR-Text:

1. **Größe (4):** `git diff --shortstat origin/main...HEAD` zeigt höchstens 300 Zeilen einschließlich Tests; sonst vor dem Push schneiden.
2. **Abnahme und Trailer (5):** der Abnahmebefehl aus dem Auftrag läuft mit Exit 0; jede Commit-Nachricht trägt `Test-First: <Pfad>::<Test>`, `Regression-For:` oder `No-Test: <Grund>`; Code-PRs: `bash scripts/ci/red-first.sh --plan`. Nach dem Commit `git log -1 --format=%s%n%b` lesen, nicht durch `tail` oder `head` leiten.
3. **Allein verständlich (9):** der PR-Text nennt Basis-SHA, drei deutsche Sätze, `## Report`, `NICHT ABGEDECKT`; einen Prompt-Log, wenn eine Zusatzprüfung sinnvoll war.
4. **Sicherheit:** Secret-Scan vor jedem Commit; nichts Persönliches (Namen, E-Mails außer noreply, Pfade mit Benutzernamen, Kosten).
5. **Grün:** `bash scripts/ci/gates.sh lane prepush` am letzten Commit im eigenen Arbeitsbaum, Exit 0 ungemaskiert; erst danach pushen und mit `git ls-remote` prüfen.

Ein roter Punkt wird vor dem Push behoben. Er zählt nicht als Fixrunde.

## Nacharbeit bei konkreten Befunden

Ist nach dem Push Nacharbeit nötig (Review-Befund, rote Prüfung), gilt:

- **Begrenzter Fix auf demselben Branch.** Normaler Commit (kein Force-Push/Rebase), eigenes `prepush`, Push und Remote-Beleg; betroffene Kandidatenevidenz erneuern.
- Jeder Befund steht im PR-Text unter `### Nacharbeit` als `Datei:Zeile` mit Befehl und Exit-Code. Ein Befund ohne `Datei:Zeile` zählt als unbelegt.
- Die Runde behebt nur die genannten Befunde; Neues kommt in ein eigenes Paket.
- Die unabhängigen Reviewrunden bleiben nach AGENTS.md Regel 5 begrenzt: zweite nur bei hohem Befund, danach entscheidet Elias. Selbstprüfungsrunden erlauben keine zusätzliche Fremdreviewrunde oder neue Freigabe.
- FLOW-05 zählt die Fixrunden je PR.

## Vorlagen

Die Vorlagen sind englisch, weil sie an Agenten gehen; die Erläuterungen sind deutsch.

### 1. Auftrag (Job-Spec, Orchestrator)

```
Package: <ID> · Lane: <lane> (<seam or none>) · Tier: <A/B/C> · Size: <S|M> (<=300 diff lines incl. tests)
Base: origin/main <sha>. Predecessors (AFTER_BRANCH): <branches or none>. Decision: <valid approval evidence + PLAN reference or none>
Extra-Check: <none | one neutral round; second only for named remaining defect>
Goal (one sentence, user value): ...
Parent / ticket / owner: ... · Native goal: <own create/get output or verified unavailable + ticket goal>
Evidence (actual tools/source/SHA with bounded scope, else "verify"): ...
Not done yet: `git log origin/main --oneline --grep <ID>` -> <result>; `gh pr list --state all --search <ID>` -> <result>
Files you may touch: ... (no file of an open PR: <list>)
Acceptance: <command> exit 0; red test `Test-First: <path>::<test>` | `No-Test: <reason>`
Out of scope / forbidden: seams not listed, unapproved installs/cost/permissions, personal data, history rewrite.
If blocked: cause/hypothesis, evidence, impact, owner/next; continue independent approved work.
Adaptation: trigger/evidence, prior state, change, remaining duties/acceptance, next owner/step.
Handover: base/head, command+exit, goal evidence, distinct implemented/tested/reviewed/accepted/merged/usable states,
limits and next owner/step; worker goal may end at checked handover, parent stays open.
PR body: 3 German sentences, `## Report`, applicable Prompt-Log, `NICHT ABGEDECKT`.
```

### 2. Kritik-Prompt (andere Modellfamilie, nur Text)

```
You critique a job spec for an autonomous coding agent that has no memory. Do not rewrite it.
For each checklist item 1-10 answer: OK | PROBLEM (high/medium) + one-line fix. Then list the single most
likely reason this job ends in "BLOCKIERT". Output a table only. Spec follows:
<spec>
```
Keine Pflicht zu einem neuen Kritiker: nur wenn nötig im vorhandenen Auftrag nutzen. „Kein Mangel“ zulassen; Stoppbedingungen oben, keine Abschwächung der Abnahme.

### 3. Worker-Brief (erste Handlung des Workers)

```
Confirm previous assignments, own native goal/functions and bounded scope before editing.
If useful: first solution -> one neutral extra check -> concrete fixes -> integrated/interface check.
Second extra round only for a named remaining defect. Stop at acceptance/no insight/unchanged blocker/limits.
Record findings or no defect, confirmation, regressions and measured effort only; do not replace independent review.
Wrong spec: document blocker cause/evidence/impact/next owner; continue independent approved work.
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
Confirm your own bounded native goal and the approved handoff. Use selective prompting only where useful:
one neutral extra check; second only for a concrete remaining defect; preserve acceptance and stop conditions.
Record actual evidence and next owner; self-check is not independent review or user approval.
```
