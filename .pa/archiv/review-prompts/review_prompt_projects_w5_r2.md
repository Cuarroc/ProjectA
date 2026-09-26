# Review-Auftrag, Runde 2 — Plan „ProjectA-Projekte“ (Welle W5), Revision 2

Du bist unabhängiger Plan-Reviewer. Du hast den Plan nicht geschrieben.
Autor: Claude Code (Anthropic). Du bist die anbieterfremde Gegenprobe.

## Kontext

ProjectA ist eine Tauri-2-App (Rust-Kern mit SQLite-Store, React-Frontend),
die CLI-Agenten mehrerer Anbieter (Claude, Codex, Kimi, OpenCode, Ollama) in
PTYs startet und über ein lokales Dev-HQ-Webcockpit gesteuert wird. Regeln des
Repos: Bug nur mit rotem Regressionstest; Nahtstellen `api.rs`, `main.rs`,
`store.rs`/`store/`, `bin/pa.rs` je in einer seriellen Lane; Pakete S ≤ 150,
M ≤ 300 Diff-Zeilen; Pläne und Nahtstellen-Diffs brauchen zwei anbieterfremde
Reviews; keine bezahlte API-Nutzung ohne Entscheidung; Continuous Mode ist
bewusst fail-closed, bis seine Abnahme (W4-03) steht. Vorhandene offene
Pakete, auf die der Plan aufsetzt: W2-01 (trusted reviewer principal), W2-02
(Belege an den Kandidaten binden), W2-03 (Usage-Collectors), W2-04
(Rollen-Dispatch), W2-10 (HQ-Views), W4-01 (Benchmark), W4-03
(Continuous-Aktivierung).

Die im Plan genannten Nutzerentscheidungen (§3) sind gesetzt. Stelle sie
nicht in Frage, prüfe aber, ob der Plan sie sicher umsetzt.

## Worauf du achten sollst

1. **Sicherheit der Autonomie:** Halten die Invarianten I1–I7 wirklich, wenn
   ein Agent (auch der Koordinator) sie umgehen will? Gibt es Lücken, zum
   Beispiel Selbstbeförderung über die Bilanz, Umgehung des Not-Aus,
   Prompt-Injection über Kontext, Lessons oder Reviews, oder autonome Merges
   an Nahtstellen ohne ausreichende Belege?
2. **Reihenfolge und Abhängigkeiten:** Fehlen Voraussetzungen? Stimmt der
   kritische Pfad? Kommt etwas zu früh (vor dem Messen, vor W4-03)?
3. **Paketschnitt:** Sind Pakete realistisch in S/M? Welche sind zu groß oder
   unklar abgegrenzt? Sind die Lanes richtig zugeordnet, etwa bei Kollisionen
   in store.rs?
4. **Abnahme:** Ist jede Abnahme prüfbar und belegbar? Wo fehlt ein roter
   Test oder eine Messung?
5. **Kosten:** Wo droht unkontrollierter Kontingent- oder Geldverbrauch?
6. **Lücken:** Was fehlt gegenüber Cursor Projects oder für den Alltag des
   Nutzers?

## Antwortformat

Befunde als `P1`, `P2`, … je mit Schwere (hoch/mittel/niedrig), Abschnitt
oder Paket-ID, Begründung und konkretem Vorschlag. Schließe mit einem Urteil:
`tragfähig`, `tragfähig nach Überarbeitung` oder `nicht tragfähig`.
Erfinde keine Paket-IDs oder Abschnitte, die nicht im Plan stehen.

## Der Plan

Das ist Runde 2. In Runde 1 haben zwei andere Reviewer 27 Befunde gemeldet;
die Disposition steht unten. Prüfe vor allem:

- Sind die angenommenen Befunde im Plan tatsächlich und wirksam umgesetzt,
  oder nur benannt?
- Haben die neuen Mechanismen (§4a Durchsetzung, §4b Klassifikation, §4c
  Injection, I8, I9, W5-00, W5-01c, W5-02b) selbst Lücken oder neue Risiken?
- Ist die neue Reihenfolge (§8) widerspruchsfrei zu den Abhängigkeiten in §7?

### Disposition der Runde 1

## kimi-k3

| ID | Schwere | Befund | Disposition |
|---|---|---|---|
| P1 | hoch | I3 nicht technisch erzwungen, Agenten können per `gh pr merge` mergen | **angenommen, am Code belegt.** Neuer §4a: Required Check `pa/evidence`, gesetzt nur vom Integrator bei gebundenen Belegen; neues Paket W5-02b filtert Tokens beim Spawn; Branch-Protection bleibt beim Menschen. Rebindung bei neuem Head-SHA als Abnahme in W5-10. |
| P2 | hoch | W5-36 ohne Abnahme | **angenommen.** Rote Suite (a)–(g) in W5-36. |
| P3 | hoch | Selbstbeförderung über Klassifikation und goodhart-bare Kennzahlen | **angenommen.** Neuer §4b: deterministische Klassifikation aus Pfaden, Regeln sind Rahmen (I1/I2), strengste Klasse bei Mischpaketen, Mindeststichprobe und Mindestalter als hartes Gate; Abnahme in W5-12. |
| P4 | hoch | Prompt-Injection unbehandelt; „belegt“ ersetzt stillschweigend „freigegeben“ | **angenommen.** Neue Invariante I8, §4c, erstes Paket W5-00, Provenienz-Gate in W5-18, Abhängigkeit W2-01 bei W5-10, adversarielle Fixtures, Importprüfung in W5-21. Menschliche Freigabe bleibt ausdrücklich. |
| P5 | hoch | „Ohne Schreibrecht“ ohne Mechanismus | **angenommen, am Code belegt.** Anspruch präzisiert zu „kein Schreibpfad“ (kein Push-/Merge-Token, cwd außerhalb der Worktrees, Guard verwirft Artefakte), Test „kein Koordinator-Commit landet“. OS-Sandbox als Ausbaustufe und offene Nutzerentscheidung (§9). |
| P6 | hoch | verdeckte Abhängigkeit vom fail-closed Runtime; Submit-Guard undefiniert | **teilweise angenommen.** Der Submit-Guard hängt *nicht* am Continuous-Runtime (`pty.rs:833`), der Begriff ist jetzt in §5 definiert. Die Ereignisquelle `store/journal_watch.rs` gehört aber zu ihm: W2-01/02/04 und der Journal-Teil von W4-03 stehen jetzt auf dem kritischen Pfad von Phase A (§2, §8). |
| P7 | mittel | Not-Aus prüft nur Dispatch | **angenommen.** I5 erweitert; W5-04 geteilt (Store-Flag / Schalter), Abnahme: kein Merge durch vorher gestartete Worker, kein Daemon-Dispatch, Test ohne Netz. |
| P8 | mittel | Fristverhalten undefiniert | **angenommen.** I9 „Fristablauf = keine Aktion“, roter Test in W5-06. |
| P9 | mittel | Budget-Hartstopp ohne Besitzer, Ledger kennt kein Kontingent | **angenommen.** Neues Paket W5-01c (Prüfung vor jedem Dispatch, Geld und Kontingent), W5-33 verbucht Kontingent-Einheiten je Abo. |
| P10 | mittel | Formatdisziplin ab Phase D erodiert, store-Lane nicht seriell | **angenommen.** Jedes Paket hat jetzt Größe, Lane, rote Abnahme und Abhängigkeit; feste serielle store-Reihenfolge in §8; W5-22 in Phase C vorgezogen. |
| P11 | mittel | W5-30/31 zu groß, Lane-Verstoß, SQLite-Eigentum | **angenommen.** W5-31 in 31a/b/c geteilt (je eine Lane), W5-30 je Runner-Typ, Single-Writer-Test. |
| P12 | mittel | Austritt aus dem Schatten undefiniert | **angenommen.** Austritt nur per Freigabe nach N Übereinstimmungen (W5-13); N ist offene Nutzerentscheidung. |
| P13 | mittel | Kostenmultiplikatoren ohne Deckel | **angenommen.** Spalte „Deckel“ in §6, Iterationsgrenze beim Angriffs-Reviewer, Zeitbox beim Mutationstest, Schwellen sind Rahmen, Phase G nach W5-33. |
| P14 | niedrig | sichere Richtung, Rot-auf-main-Playbook, Dringlichkeit | **angenommen.** I1 erlaubt Senken ohne Verdict, I4 mit Ein-Klick-Revert und Sofortmeldung, W5-07 testet sie. |
| P15 | niedrig | Projektanlage im Cockpit fehlt | **angenommen.** Teil 35e. Die Regel „Rahmen wird bei jedem Dispatch neu geprüft“ steckt in W5-01c. |
| P16 | niedrig | Replay-Treue, Secrets, Plattenwachstum | **angenommen.** W5-34: Redaction, Größen- und Aufbewahrungsgrenze, Deklaration je Runner-Typ; Risiko in §10. |
| P17 | niedrig | Beobachtungen veralten; bezahlter Pfad nur prozessual | **angenommen.** I7 um Verfall erweitert (W5-30), roter Test in W5-32. |
| P18 | niedrig | Append-only nur behauptet | **angenommen.** W5-05: Transaktion plus Trigger gegen UPDATE/DELETE. |
| P19 | niedrig | Voreinstellung der Migration offen | **angenommen.** I9 und Abnahme in W5-01a. |

## glm-5.2

| ID | Schwere | Befund | Disposition |
|---|---|---|---|
| P1 | hoch | Phase G vor dem Budget-Routing | **angenommen.** Phase G erst nach W5-01c und W5-33 (§7, §8). Deckt sich mit kimi P9/P13. |
| P2 | hoch | selbstberichtete Kennzahlen | **angenommen.** §4b: nur verifizierte Quellen (GitHub-Check, CI-red-first, trusted reviewer principal, Git-Historie), selbstberichtete Werte als „unverifiziert“ ohne Wirkung. Deckt sich mit kimi P3. |
| P3 | hoch | Injection über Ereignisse und Reviews | **angenommen.** §4c trennt strukturierte Metadaten von Freitext, Freitext nie als Paketziel. Deckt sich mit kimi P4. |
| P4 | mittel | store-Lane bei Parallelität | **angenommen.** Durchgehende serielle Reihenfolge in §8. |
| P5 | mittel | Koordinator könnte die Zwei-Review-Schwelle unterlaufen | **angenommen.** Roter Test in W5-25; W5-22 ist harte Voraussetzung. Zusätzlich zählt nach §4b ein Mischpaket zur strengsten Klasse. |
| P6 | mittel | keine roten Tests in Phase J | **angenommen.** W5-36 bis W5-39 haben jetzt rote Tests. |
| P7 | niedrig | W5-18 ohne Abnahme | **angenommen.** Roter Test gegen nicht freigegebene, veraltete oder gesperrte Lessons. |
| P8 | niedrig | Zuordnung der Cloud-PRs | **angenommen.** Branch-Schema `<runner>/w5-<paket>` in W5-09, von W5-32 verlangt. |

## Nächster Schritt

Die Revision 2 ändert Invarianten und Paketschnitt wesentlich. Nach der Regel,
dass Belege an den Kandidaten gebunden sind, braucht sie eine zweite
Review-Runde, bevor sie in `docs/PLAN.md` übernommen wird.

### Plan, Revision 2

# Plan-Vorschlag — ProjectA-Projekte (Welle W5)

Status: Vorschlag, Revision 2 nach der ersten Review-Runde. Noch kein
ausführbarer Plan.
Autor: Claude Code (Koordination Welle 2), 23.09.2026.
Reviews: `.pa/review_projects_w5_kimi-k3.md`, `.pa/review_projects_w5_glm-5.2.md`,
Disposition `.pa/review_projects_w5_disposition.md`.
Aufnahme in `docs/PLAN.md` erst nach dem Merge von PR #70 (die Datei gehört
bis dahin dem PR) und nach einer zweiten Review-Runde über diese Revision.

## 1. Anlass und Ziel

Cursor hat am 10.09.2026 „Projects“ vorgestellt: Ein Koordinator-Agent
schreibt selbst keinen Code, delegiert an viele Subagents, läuft in der Cloud
weiter, pflegt einen gemeinsamen Kontext und reagiert über Abonnements (Slack,
Zeitplan, PRs, CI) von selbst.

**Ziel in einem Satz:** ProjectA und das Dev-HQ können dasselbe, aber mit
belegter statt behaupteter Qualität, über alle Abos des Nutzers verteilt und
mit einer messbaren, vom Nutzer begrenzten und *technisch erzwungenen*
Autonomie.

ProjectA hat Cursor schon voraus: red-first-Beweismaßstab, anbieterfremde
Reviews, Verdict-Token als harte Trennung zwischen Mensch und Agent, ehrliche
Fähigkeitsmeldung zur Laufzeit (`main.rs:2288-2297`), mehrere Anbieter mit
Quota-Fallback, Budget-Provenienz und eine fail-closed Policy.

## 2. Bestandsaufnahme (im Code geprüft, 23.09.)

| Fähigkeit | Stand | Beleg |
|---|---|---|
| Koordinator delegiert | vorhanden; „schreibt keinen Code“ nur im Prompt, läuft im Repo-Root | `workers.rs:695`, `:787`, `:1316` |
| Zustellung an Agenten | Submit-Guard der PTY-Schicht, unabhängig vom Continuous-Runtime | `pty.rs:833` |
| Umgebung der Agenten | PTY-Kinder erben die volle Umgebung; `gh` samt Nutzer-Credentials ist erreichbar | `pty.rs:696-699` |
| Rollen Koordinator/Worker/Reviewer/Integrator | gespeichert, nicht ausgeführt | `store/team_assignments.rs:116`, W2-04 |
| Parallele Worker | 4 je Projekt, ein Dispatch je 30 s; Continuous auf 2 begrenzt und abgeschaltet | `queue.rs:33,35`, `development_policy.rs:16,174,224` |
| Weiterlaufen ohne App | fehlt; `pa` braucht die laufende App | `bin/pa.rs:3-6` |
| Gemeinsamer Kontext | Critic → Learnings → Playbook, menschlich freigegeben, in jeden Worker injiziert (≤ 4000 Zeichen); HQ-Lessons erreichen App-Worker nicht | `learnings.rs:88,588`, `critic.rs` |
| Ereignisquelle | `store/journal_watch.rs`, Teil des Continuous-Runtime (fail-closed) | `store/journal_watch.rs` |
| Ereignisse an den Koordinator | fehlt; er muss `pa board` pollen | `status.rs:500` |
| Abonnements | fehlt; `gh.rs` pollt PRs nur für Board-Spalten | `gh.rs:167` |
| Trusted reviewer principal | „not implemented“ | `store/development_runs.rs:603,736`, W2-01 |
| Vertrauensrampe, Lesson → Gate, Projekt-Cockpit | fehlen | — |

**Folgerung:** Das Fundament ist der Continuous-Runtime (Claims, Leases,
Rollen, Budget-Ledger, Journal). Er ist gebaut, aber bewusst fail-closed. W5
setzt auf W2 auf und ersetzt es nicht. Weil die Ereignisquelle zum
Continuous-Teil gehört, liegen **W2-01, W2-02, W2-04 und ein Teil von W4-03 auf
dem kritischen Pfad von Phase A** (siehe §8), nicht erst von Phase J.

## 3. Nutzerentscheidungen (23.09.)

1. **Laufort:** lokal (PTY und `pa daemon`) plus Cloud-Runner. Ein bezahlter
   Runner braucht vorher einen Eintrag in `docs/decisions.md` mit harter
   Budgetgrenze; bis dahin gilt `AGENTS.md` („No extra paid API spending is
   authorized“).
2. **Schwerpunkte, alle vier:** selbstlaufende Reaktion, messbare
   Vertrauensrampe, belegter und verfallender Kontext, Multi-Anbieter- und
   Budget-Routing.
3. **Bedienung:** Projekt-Cockpit im Dev-HQ und derselbe Chat in der App.
4. **Obergrenze der Autonomie:** bis zu autonomen Merges, auch an Nahtstellen,
   sofern die Bilanz der Klasse es trägt und der Nutzer die Stufe freigegeben hat.
5. **Reaktion:** Der Koordinator darf innerhalb des freigegebenen Ziels und
   Budgets selbst neue Pakete schneiden und starten.
6. **Zusätzliche Alleinstellungsmerkmale, alle 16 angenommen:** siehe §6.
7. **Erstes sichtbares Merkmal nach dem Fundament:** Entscheidungs-Postfach
   plus Tagesbriefing.
8. **Anbieter-Wettbewerb:** automatisch nur für Nahtstellen und riskante Klassen.
9. **Präferenzmodell und projektübergreifendes Wissen:** lokal im
   App-Datenverzeichnis, versioniert, mit Herkunft; ins Repo nur, was alle
   Agenten brauchen.

## 4. Harte Invarianten

Diese gelten für jedes Paket. Kein Agent kann sie ändern (`AGENTS.md`: „Agents
cannot expand their own approval, credential, budget, or release policy“). Wie
jede Invariante erzwungen wird, steht in §4a; eine Invariante ohne Mechanismus
gilt als nicht erfüllt.

- **I1 Rahmen nur durch den Menschen.** Projektziel, Budgetrahmen, maximale
  Vertrauensstufe je Klasse, Klassifikationsregeln, Schwellen und Sperrliste
  ändern sich nur mit dem Verdict-Token. Die Rampe bewegt sich innerhalb des
  Rahmens und hebt ihn nie an. **Sichere Richtung ohne Verdict:** Stufe senken,
  Sperrliste erweitern und Not-Aus darf jeder, auch ein Agent.
- **I2 Nie autonom:** Release und Tags, Credentials und Secrets, Budget-,
  Policy- und Klassifikationsänderungen, Branch-Protection, Installation auf dem
  Nutzer-PC, Änderungen an diesen Invarianten selbst.
- **I3 Autonomer Merge nur mit vollem Beleg:** CI grün (alle Required
  Checks), red-first-Nachweis, anbieterfremde Reviews (zwei bei Nahtstelle
  oder > 300 Zeilen) mit Disposition, Beleg an genau diesen Head-SHA gebunden
  (W2-02; jeder neue Commit entwertet alte Belege), freigegebene Stufe der
  Klasse erreicht, Budget nicht erschöpft.
- **I4 Rückschlag-Automatik.** Ein Revert, ein roter `main` nach Merge oder
  eine ausgelieferte Regression senkt die Stufe der betroffenen Klasse sofort,
  stoppt autonome Merges dort, schlägt einen Ein-Klick-Revert vor und
  benachrichtigt den Nutzer sofort (OS-Benachrichtigung), nicht erst im Briefing.
- **I5 Not-Aus.** Ein Schalter in Cockpit, App und `pa` hält alle Projekte an.
  Nach dem Schalter entsteht kein Dispatch, kein Merge und keine neue Sitzung
  mehr, auch nicht durch einen vorher gestarteten Worker, den Daemon oder den
  Koordinator. Er wirkt ohne Netz und ohne Agent.
- **I6 Prüfpfad.** Jede autonome Aktion schreibt in derselben Transaktion,
  wer sie ausgelöst hat, warum, mit welchem Beleg und auf welcher Stufe. Der
  Prüfpfad ist append-only.
- **I7 Ehrliche und frische Fähigkeit.** Kein Runner, Anbieter oder Modell gilt
  als verfügbar, bevor es beobachtet wurde, und eine Beobachtung verfällt nach
  einer festen Zeit. Konfiguration ist kein Beleg.
- **I8 Fremder Text ist Daten.** Text aus PRs, CI-Logs, Reviews, Lessons,
  Notizen und Importen erreicht einen Agenten nur als gekennzeichneter
  Datenblock, nie als Anweisung, und kann weder Rahmen noch Gates ändern.
- **I9 Fail-closed Voreinstellung.** Ein neues Projekt erlaubt keinerlei
  autonome Aktion. Eine abgelaufene Entscheidungsfrist löst keine Aktion aus.

## 4a. Durchsetzung

| Invariante | Mechanismus | Paket |
|---|---|---|
| I1, I9 | Rahmen-Tabelle nur über einen Store-Schreibpfad mit Verdict-Nachweis; Default „keine Autonomie“ | W5-01a/b |
| I2, I3 | **Required Check `pa/evidence`** in der Branch-Protection: gesetzt nur vom Integrator, wenn der Store gebundene Belege zum Head-SHA hält. Worker und Koordinator bekommen **kein** GitHub-Token mit Merge-, Tag- oder Admin-Recht (Umgebung wird beim Spawn gefiltert, eigenes Token mit engem Scope nur für den Integrator). Branch-Protection bleibt beim Menschen (I2). | W5-02b, W5-36 |
| I3 (Koordinator) | Koordinator ohne Schreibpfad: kein Push- oder Merge-Token, cwd außerhalb jedes Worktrees, der Guard verwirft jedes Koordinator-Artefakt; der Nachweis ist ein Test, dass kein Koordinator-Commit landen kann. Ein OS-Sandbox-Profil (eigener Benutzer oder read-only Mount) ist Ausbaustufe. | W5-02a |
| I4 | Revert-/Rot-Erkennung aus Abos, Stufensenkung ohne Verdict (sichere Richtung) | W5-36 |
| I5 | Store-Flag, das Dispatch, Integrator und Daemon vor jeder Aktion neu lesen | W5-04 |
| I6 | Aktion und Protokolleintrag in einer Transaktion; SQLite-Trigger verweigern UPDATE/DELETE | W5-05 |
| I7 | Fähigkeiten mit Heartbeat und Ablauf; abgelaufene sind nicht einplanbar | W5-30 |
| I8 | Datenblock-Hülle für fremden Text, Provenienz-Gate für Injektion | W5-00 |
| Budget | Prüfung vor jedem Dispatch gegen Ledger und Rahmen, Geld und Kontingent je Abo | W5-01c |

## 4b. Klassifikation und Bilanz (gegen Selbstbeförderung)

- Die Aufgabenklasse wird **deterministisch aus den geänderten Pfaden und
  Lane-Regeln** bestimmt, nie vom Agenten angegeben. Die Regeln sind Teil des
  Rahmens (I1/I2). Jede Klassifikation steht im Prüfpfad.
- Ein Paket, das Pfade mehrerer Klassen berührt, zählt zur strengsten.
- In die Bilanz fließen nur **verifizierte** Kennzahlen: CI-Ergebnis vom
  GitHub-Check, red-first aus dem CI-Lauf, Review-Urteile des trusted reviewer
  principal (W2-01), Reverts aus der Git-Historie. Selbstberichtete Werte werden
  als „unverifiziert“ gespeichert und zählen nicht.
- Eine Stufe braucht eine Mindeststichprobe je Klasse und ein Mindestalter
  (Merges ohne Rückschlag über einen Zeitraum), damit viele triviale Merges
  nichts beweisen. Die konkreten Werte schlägt W5-12 aus echten Daten vor, und
  der Nutzer legt sie fest.

## 4c. Injection-Härtung

- Ereignisse tragen strukturierte Metadaten (Typ, PR-Nummer, Check-Name,
  Status). Freitext (PR-Titel, Logs, Kommentare) wird nur als gekennzeichneter
  Datenblock mitgegeben und nie als Paketziel übernommen.
- Nacharbeit (W5-10) reagiert nur auf Dispositionen des trusted reviewer
  principal und auf CI-Checks, nicht auf Inline-PR-Kommentare.
- Injiziert werden nur freigegebene Lessons und Notizen. „Belegt“ ersetzt
  „freigegeben“ nicht; die menschliche Freigabe des heutigen Playbooks bleibt.
- Adversarielle Testfixtures (Lesson, Review, PR-Text und Log mit
  Anweisungsmustern) dürfen weder Gate noch Rahmen noch Dispatch auslösen.
- Importe aus anderen Projekten (W5-21) durchlaufen dieselbe Prüfung plus eine
  eigene Freigabe.

## 5. Architektur in einem Absatz

Ein **Projekt** ist eine dauerhafte Einheit im Store: Ziel, Paket-DAG,
Kontextbasis, Abonnements, Vertrauensprofil, Budgetrahmen. Der
**Koordinator** hat keinen Schreibpfad; er arbeitet nur über die Store-API
(Pakete anlegen, Worker beauftragen, Entscheidungen vorlegen). Ereignisse
erreichen ihn über ein **Postfach**; zugestellt wird über den Submit-Guard der
PTY-Schicht (`pty.rs:833`), die Quelle ist das Journal des Continuous-Runtime.
**Runner** sind austauschbare Ausführungsorte (lokale PTY, `pa daemon`,
Cloud-Sitzung, später VM). Jeder meldet frische Fähigkeiten, und der Scheduler
wählt je Paket Ort, Anbieter und Zeitfenster und begründet die Wahl mit einem
Routing-Beleg. Eine **Bilanz** misst je Klasse verifizierte Qualität, Kosten
und Tempo. Daraus ergeben sich Stufe, Scorecards und Prognosen. **Kontext** ist
eine Sammlung belegter, freigegebener Notizen, die bei Codeänderung verfallen.

## 6. Alleinstellungsmerkmale

| Gruppe | Merkmal | Kern | Deckel |
|---|---|---|---|
| Qualität | Anbieter-Wettbewerb | Kritische Pakete parallel bei 2–3 Anbietern; der Kandidat mit den besten Belegen gewinnt | nur Nahtstellen und riskante Klassen, verschoben bei knappem Kontingent |
| Qualität | Angriffs-Reviewer | Der Reviewer schreibt rote Tests gegen den Kandidaten | nur Klassen ab „Rust“ aufwärts; höchstens zwei Reparaturrunden, dann Postfach |
| Qualität | Mutationstest-Gate | Neue Tests müssen Mutationen in den geänderten Zeilen fangen | nur geänderte Zeilen, Zeitbox je Lauf; Schwellen sind Rahmen (I1) |
| Qualität | Laufzeit-Beleg | App in Sandbox (eigenes Datenverzeichnis, Queue aus), Screenshot und Messung | nur Frontend-, UI- und Laufzeitpakete |
| Planung | Kosten-/Zeitangebot | Prognose vor Start, Soll/Ist danach | — |
| Planung | Selbstheilender DAG | Teilung bei > 300 Zeilen oder Scheitern, Umplanung | jeder Eingriff im Prüfpfad |
| Planung | Konfliktvorhersage | Datei- und Lane-Kollisionen vor dem Dispatch | harte Voraussetzung für W5-25 |
| Planung | Pre-Mortem | Zwei Anbieter sammeln unabhängig Risiken | nur M-Pakete und Nahtstellen |
| Zusammenspiel | Entscheidungs-Postfach + Briefing | Nur echte Nutzerentscheidungen, mit Empfehlung und Belegen | Fristablauf = keine Aktion (I9) |
| Zusammenspiel | Präferenzmodell | Lernt aus Dispositionen und Korrekturen | lokal, abschaltbar, jede Regel freigegeben |
| Zusammenspiel | Warum-Replay | Jede Aktion nachspielbar | Redaction, Größen- und Aufbewahrungsgrenze |
| Zusammenspiel | Schatten-Modus | Neue Autonomie entscheidet erst parallel zum Nutzer | Austritt nur per Freigabe nach N Übereinstimmungen |
| Ökonomie | Kontingent-Arbitrage | Arbeit in frische Abo-Fenster legen; lokale Modelle für einfache Klassen | — |
| Ökonomie | Projektübergreifendes Wissen | Belegte Lessons und Gates zwischen Projekten | Import nur mit eigener Freigabe (§4c) |
| Ökonomie | Anbieter-Scorecards | Qualität, Kosten und Tempo je Anbieter und Klasse | nur verifizierte Werte (§4b) |
| Ökonomie | Selbst-Benchmark | Fester Aufgabenkatalog regelmäßig | bis W5-33 nur bei Leerlauf-Kontingent |

## 7. Paketschnitt

Format je Paket: **ID · Titel** · Größe · Lane · Abnahme · Abhängigkeit. S ≤ 150,
M ≤ 300 Diff-Zeilen. Jede Abnahme beginnt mit einem roten Test, außer wo eine
Messung verlangt ist. Nahtstelle oder > 300 Zeilen: zwei anbieterfremde Reviews.
Lanes: **st** = store.rs/store/, **api** = api.rs, **mn** = main.rs,
**pa** = bin/pa.rs, **fe** = Frontend, **hq** = docs/dev-hq/**, **ci** =
scripts/ci/, **frei** = keine Nahtstelle.

### Phase A — Fundament

Voraussetzungen: W2-01, W2-02, W2-04 und die Journal-Teile aus W4-03 (§8).

- **W5-00 Datenblock-Hülle für fremden Text** · S · frei (`learnings.rs`, Prompt-Bau) · rot: eine Lesson mit „ignoriere Gate X“ erscheint im Worker-Prompt als gekennzeichneter Datenblock, nicht als Anweisung; adversarielle Fixtures · keine.
- **W5-01a Projektrahmen im Store** · M · st · rot: Rahmen ohne Verdict ändert sich nicht; frisches Projekt erlaubt keine autonome Aktion (I9); Senken der Stufe geht ohne Verdict · W2-01.
- **W5-01b Projektrahmen über die API** · S · api · rot: 403 ohne Token beim Anheben, 200 beim Senken · W5-01a.
- **W5-01c Budget-Prüfung vor jedem Dispatch** · S · st · rot: Dispatch bei erschöpftem Rahmen (Geld oder Kontingent) wird verweigert und protokolliert · W5-01a, W5-05.
- **W5-02a Koordinator ohne Schreibpfad** · M · frei (`workers.rs`, `profiles.rs`) · rot: ein Koordinator-Commit oder -Push kommt nicht an; cwd liegt außerhalb jedes Worktrees · keine.
- **W5-02b Gefilterte Agenten-Umgebung** · M · frei (`pty.rs` Spawn) · rot: ein Worker sieht kein Token mit Merge-, Tag- oder Admin-Recht; nur der Integrator bekommt sein enges Token · keine.
- **W5-03 Ereignis-Postfach** · M · st · Messung: Ereignis erreicht den Koordinator in ≤ 5 s; rot: keine doppelte Zustellung nach Neustart; Freitext nur als Datenblock (I8) · W5-00, W4-03-Journal.
- **W5-04 Not-Aus** · M, geteilt in 04a Store-Flag (st) und 04b Schalter in App, `pa` und Cockpit (mn, pa) · rot: nach dem Schalter kein Dispatch, kein Merge durch einen vorher gestarteten Worker, kein Daemon-Dispatch; Test ohne Netz · W5-01a.
- **W5-05 Prüfpfad** · S · st · rot: UPDATE/DELETE auf der Tabelle scheitert; eine Aktion ohne Eintrag wird zurückgerollt · keine.

**Serielle Reihenfolge der store-Lane in Phase A:** 05 → 01a → 01c → 04a → 03.

### Phase B — Entscheidungs-Postfach (erstes sichtbares Merkmal)

- **W5-06 Entscheidungen im Store** · M · st · rot: Antwort nur mit Verdict; Fristablauf löst keine Aktion aus (I9) · W5-05.
- **W5-06b Entscheidungen über die API** · S · api · rot: 403 ohne Token · W5-06.
- **W5-07 Tagesbriefing und Sofortmeldung** · S · frei (`digest.rs`) · rot: ein I4-Fall erzeugt sofort eine OS-Benachrichtigung, nicht erst im Briefing · W5-06.
- **W5-08 Postfach in App und Cockpit** · M · fe, hq · Screenshot hell/dunkel angesehen, Tastaturbedienung · W5-06b, PR #70.

### Phase C — Reaktionen

- **W5-09 Abonnements** · M · st, dann frei (`gh.rs`) · rot: ein PR-Ereignis wird deterministisch dem Projekt und Paket zugeordnet (Branch-Schema `<runner>/w5-<paket>`), fremde PRs nicht · W5-03.
- **W5-10 Nacharbeit an eigenen PRs** · M · frei (`workers.rs`) · rot: ein simulierter roter Lauf führt zu genau einem Reparatur-Auftrag; ein Inline-Kommentar mit Anweisung führt zu keinem; ein neuer Head-SHA entwertet alte Dispositionen · W5-09, W2-01, W2-02.
- **W5-11 Review-Reaktion** · M · frei · rot: PR offen → Reviewer eines anderen Anbieters als der Autor; zwei bei Nahtstelle · W5-09, W2-01.
- **W5-22 Konfliktvorhersage** (vorgezogen aus F) · M · frei · Rückrechnung gegen Welle 2 vom 23.09. (store-, status.rs- und pty.rs-Lanes) liefert dieselbe Reihenfolge · keine.

### Phase D — Messen, noch ohne Wirkung

- **W5-12 Bilanz je Aufgabenklasse** · M · st · rot: Klasse wird aus Pfaden bestimmt, eine Agentenangabe wird ignoriert; ein Paket mit Nahtstelle und Doku zählt als Nahtstelle; selbstberichtete Werte zählen nicht (§4b) · W5-05, W2-01.
- **W5-13 Schatten-Modus** · M · st · rot: eine Schattenentscheidung löst keine Aktion aus; Austritt aus dem Schatten nur per Freigabe im Postfach nach N Übereinstimmungen · W5-03, W5-06.
- **W5-14 Anbieter-Scorecards** · S · frei · rot: unverifizierte Werte fließen nicht ein · W5-12.
- **W5-15 Kosten-/Zeitangebot** · S · frei · Messung: Soll/Ist-Abweichung je Paket im Prüfpfad · W5-12.
- **W5-16 Selbst-Benchmark** · S · ci · Trend im Cockpit; bis W5-33 nur bei Leerlauf-Kontingent · W4-01, W5-01c.

### Phase E — Kontext

- **W5-17 Belegte Notizen mit Verfall** · M · st · rot: eine veraltete Notiz (Hash der betroffenen Dateien geändert) wird nicht injiziert · W5-00.
- **W5-18 HQ-Lessons in App-Worker** · S · frei (`learnings.rs`) · rot: eine nicht freigegebene, veraltete oder aus einem gesperrten Projekt stammende Lesson wird nicht injiziert · W5-00, W5-17.
- **W5-19 Lesson → Gate-Vorschlag** · M · frei · rot: zweites Auftreten derselben Lesson erzeugt genau eine Entscheidung „Gate mit rotem Test“ im Postfach · W5-06, W5-18.
- **W5-20 Präferenzmodell** · M · frei (App-Datenverzeichnis) · rot: eine nicht freigegebene Regel wirkt nicht; Abschalten wirkt sofort · W5-06.
- **W5-21 Projektübergreifendes Wissen** · M · st · rot: ein Import ohne Freigabe des Zielprojekts wird nicht injiziert; adversarielle Fixtures (§4c) · W5-17.

### Phase F — Planung

- **W5-23 Selbstheilender DAG** · M · st · rot: ein Paket über 300 Zeilen wird geteilt und die Abhängigen werden umgeplant; jeder Eingriff steht im Prüfpfad · W5-22.
- **W5-24 Pre-Mortem** · S · frei · Risiken erscheinen als Abnahmekriterien im Paket · W5-11.
- **W5-25 Koordinator schneidet Pakete im Rahmen** · M · st · rot: ein Paket an einer Nahtstelle oder über 300 Zeilen ohne Flag für zwei Reviews wird nicht dispatcht; ein Paket außerhalb des Ziels oder Budgets wird verweigert; neue Pakete starten im Schatten-Modus · W5-13, W5-22, W5-01c.

### Phase G — Qualität

Erst nach W5-01c und W5-33 (Kostenbremse), siehe §8.

- **W5-26 Angriffs-Reviewer** · M · frei · rot: ein roter Angriffstest blockiert den Merge; nach zwei Reparaturrunden landet der Fall im Postfach · W5-11, W5-33.
- **W5-27 Mutationstest-Gate** · M · ci · Selbsttest: ein absichtlich schwacher Test ist rot; Zeitbox wird eingehalten · W5-33.
- **W5-28 Automatischer Laufzeit-Beleg** · M · frei · rot: der Beleg entsteht, ohne dass ein echter Worker startet (eigenes Datenverzeichnis, Queue aus) · keine.
- **W5-29 Anbieter-Wettbewerb** · M · frei · rot: startet nur für Nahtstellen und riskante Klassen und nicht bei knappem Kontingent · W5-33, W2-03.

### Phase H — Runner und Ökonomie

- **W5-30 Runner-Schicht** · M, je Runner-Typ ein Teilpaket · frei · rot: ein Runner mit abgelaufener Beobachtung wird nicht eingeplant (I7) · W5-01c.
- **W5-31 `pa daemon`** · geteilt in 31a Runtime-Extraktion (mn), 31b Daemon-Lebenszyklus (pa), 31c App als Client (mn), je M · rot: App und Daemon schreiben nie gleichzeitig in die Datenbank; Abnahme: App schließen, Worker laufen weiter, App öffnen, Zustand vollständig · W5-04.
- **W5-32 Cloud-Runner** · M · frei · rot: ohne Eintrag in `docs/decisions.md` ist ein bezahlter Runner nicht aktivierbar; Cloud-PRs folgen dem Branch-Schema aus W5-09 · W5-30, W5-09.
- **W5-33 Budget-Routing und Kontingent-Arbitrage** · M · st · rot: Kontingent-Einheiten je Abo werden neben Geld verbucht und stoppen hart · W2-03, W5-01c.
- **W5-34 Warum-Replay** · M · frei · rot: Secrets erscheinen im Trace maskiert; Größen- und Aufbewahrungsgrenze greift; je Runner-Typ ist deklariert, was aufgezeichnet wird (Cloud-Sitzungen ohne PTY-Trace) · W5-05.

### Phase I — Cockpit

- **W5-35 Projekt-Cockpit** · M je Teil, hq · 35a Chat-Parität, 35b DAG und Flotte, 35c Abos und Budget, 35d Vertrauen und Prüfpfad, 35e Projektrahmen anlegen und ändern samt Verdict-Fluss · Screenshots hell/dunkel angesehen, Tastaturbedienung · PR #70, W2-10, W5-01b.

### Phase J — Freischaltung (je Stufe eine Nutzerfreigabe)

- **W5-36 Vertrauensrampe wirksam** · M · st, dann ci (Check `pa/evidence`) · rote Suite: (a) Merge ohne gebundene Belege scheitert trotz freigegebener Stufe; (b) die Rampe überschreitet nie das Rahmen-Maximum (I1); (c) ein simulierter Revert senkt die Stufe sofort und stoppt Auto-Merges (I4); (d) jeder Auto-Merge schreibt einen Prüfpfad-Eintrag (I6); (e) Tag-, Release- und Policy-Versuche eines Agenten scheitern (I2); (f) Schwellen ändern sich nur mit Verdict; (g) Not-Aus blockiert den Merge (I5) · W4-03, W5-12, W5-02b, W5-04.
- **W5-37 Stufe 1: Auto-Merge einfacher Klassen** · S · Doku, Tests, Lint · rot: eine Nahtstelle mit nur einem Review wird nicht gemergt · W5-36, Nutzerfreigabe.
- **W5-38 Stufe 2: Frontend und nahtstellenfreier Rust** · S · rot wie 37 für die Klasse · W5-37, Nutzerfreigabe.
- **W5-39 Stufe 3: Nahtstellen** · S · rot: ohne Anbieter-Wettbewerb und zwei Reviews kein Merge · W5-38, W5-29, Nutzerfreigabe.

## 8. Reihenfolge und Parallelität

**Kritischer Pfad:** W2-01 → W2-02 → W2-04 → Journal-Teil von W4-03 →
Phase A → B → C → D → (G nach W5-33) → J. Die W2-/W4-Voraussetzungen sind der
eigentliche Engpass; W5 beschleunigt sie nicht.

**Parallel:** W5-00, W5-02a/b, W5-22 und W5-28 haben keine W2-Abhängigkeit und
können sofort nach Aufnahme in den Plan starten. E und F laufen ab D parallel zu
H. G startet erst, wenn W5-01c und W5-33 gemergt sind (Kostenbremse). I folgt
nach PR #70 und W2-10. J erst nach W4-03 und ausreichender, verifizierter Bilanz.

**store-Lane seriell über die ganze Welle:** 05 → 01a → 01c → 04a → 03 → 06 →
09 → 12 → 13 → 17 → 21 → 23 → 25 → 33 → 36. Pakete anderer Lanes laufen
daneben. W5-22 (in C vorgezogen) prüft ab dann jede Dispatch-Reihenfolge.

## 9. Offene Nutzerentscheidungen

- Budgetgrenze und Anbieter für einen bezahlten Cloud-Runner (vor W5-32 Teil 2).
- Klassen, Mindeststichprobe, Mindestalter und Schwellen der Rampe (nach W5-12).
- N für den Austritt aus dem Schatten-Modus (nach W5-13).
- Ob ein OS-Sandbox-Profil für den Koordinator nötig ist (nach W5-02a).
- Ob Slack/Discord später als Kanal dazukommt (nicht im Umfang).

## 10. Risiken

- **Kontingent und Geld:** Wettbewerb, Angriffs-Reviewer, Mutationstests,
  Pre-Mortem und die Pflicht-Doppelreviews vervielfachen den Verbrauch.
  Gegenmittel: Deckel je Merkmal (§6), Budget-Prüfung vor jedem Dispatch
  (W5-01c), Phase G erst nach W5-33.
- **Selbstbeförderung und Goodhart:** Gegenmittel: deterministische
  Klassifikation, nur verifizierte Kennzahlen, Mindeststichprobe und
  Mindestalter (§4b), Schatten-Modus, I4.
- **Prompt-Injection:** vier neue Aufnahmeflächen (Ereignisse, Reviews,
  Lessons/Notizen, Importe). Gegenmittel: I8 und §4c, W5-00 als erstes Paket.
- **Credentials in Agentenprozessen:** heute erben PTY-Kinder die volle
  Umgebung. Gegenmittel: W5-02b vor jeder Autonomie, Check `pa/evidence`.
- **Nahtstellen-Engpass:** Die store-Lane trägt 15 Pakete. Gegenmittel: die
  feste Reihenfolge in §8, Pakete bleiben S/M, W5-22 ab Phase C.
- **Datenbank-Eigentum zwischen App und Daemon:** Gegenmittel: W5-31 mit
  Single-Writer-Test.
- **Cloud-Runner ohne Rückkanal:** Gegenmittel: Beobachtung über das
  Branch-Schema, PRs und Reports, wie in Welle 2 praktiziert.
- **Plattenwachstum:** Traces, Screenshots und Messungen. Gegenmittel:
  Aufbewahrungsgrenze in W5-34 und W5-28.

## 11. Nicht im Umfang

Slack/Discord, bezahlte Runner ohne Budgetentscheidung, Änderungen an der
Release-Pipeline, jede Lockerung von I1–I9.
