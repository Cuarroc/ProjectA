# Review-Auftrag — Plan „ProjectA-Projekte“ (Welle W5)

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

# Vorschlag — ProjectA-Projekte (Welle W5)

Status: Vorschlag, Review ausstehend. Noch kein ausführbarer Plan.
Autor: Claude Code (Koordination Welle 2), 23.09.2026.
Grundlage: Nutzergespräch vom 23.09. und die Code-Bestandsaufnahme weiter unten.
Aufnahme in `docs/PLAN.md` erst nach dem Merge von PR #70 (die Datei gehört
bis dahin dem PR). Bis dahin ist dieses Dokument der einzige Ort des Vorschlags.

## 1. Anlass und Ziel

Cursor hat am 10.09.2026 „Projects“ vorgestellt: Ein Koordinator-Agent
schreibt selbst keinen Code, delegiert an viele Subagents, läuft in der Cloud
weiter, pflegt einen gemeinsamen Kontext und reagiert über Abonnements (Slack,
Zeitplan, PRs, CI) von selbst.

**Ziel in einem Satz:** ProjectA und das Dev-HQ können dasselbe, aber mit
belegter statt behaupteter Qualität, über alle Abos des Nutzers verteilt und
mit einer messbaren, vom Nutzer begrenzten Autonomie.

Was ProjectA Cursor schon voraus hat und was dieser Vorschlag ausbaut:
red-first-Beweismaßstab, anbieterfremde Reviews, Verdict-Token als harte
Trennung zwischen Mensch und Agent, ehrliche Fähigkeitsmeldung zur Laufzeit
(`main.rs:2288-2297`), mehrere Anbieter mit Quota-Fallback,
Budget-Provenienz, fail-closed Policy.

## 2. Bestandsaufnahme (im Code geprüft, 23.09.)

| Fähigkeit | Stand | Beleg |
|---|---|---|
| Koordinator delegiert | vorhanden; „schreibt keinen Code“ nur im Prompt, läuft im Repo-Root | `workers.rs:695`, `:787`, `:1316` |
| Rollen Koordinator/Worker/Reviewer/Integrator | gespeichert, nicht ausgeführt | `store/team_assignments.rs:116`, W2-04 |
| Parallele Worker | 4 je Projekt, ein Dispatch je 30 s; Continuous auf 2 begrenzt und abgeschaltet | `queue.rs:33,35`, `development_policy.rs:16,174,224` |
| Weiterlaufen ohne App | fehlt; `pa` braucht die laufende App | `bin/pa.rs:3-6` |
| Gemeinsamer Kontext | Critic → Learnings → Playbook, menschlich freigegeben, in jeden Worker injiziert (≤ 4000 Zeichen); HQ-Lessons erreichen App-Worker nicht | `learnings.rs:88,588`, `critic.rs` |
| Ereignisse an den Koordinator | fehlt; er muss `pa board` pollen | `status.rs:500` |
| Abonnements | fehlt; `gh.rs` pollt PRs nur für Board-Spalten | `gh.rs:167` |
| Discovery | `reserve_discovery_scan` ohne Aufrufer | `store/discovery.rs:40` |
| Trusted reviewer principal | „not implemented“ | `store/development_runs.rs:603,736`, W2-01 |
| Vertrauensrampe | fehlt | — |
| Lesson → Gate | fehlt | — |
| Projekt-Cockpit | fehlt; Chat nur in der App, HQ-Views W2-10 offen | `docs/dev-hq/hq.js`, `continuous.js` |

Folgerung: Das Fundament ist der Continuous-Runtime (Claims, Leases, Rollen,
Budget-Ledger, Journal-Watch). Er ist gebaut, aber bewusst fail-closed. W5
setzt auf W2 auf und ersetzt es nicht.

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

Diese gelten für jedes Paket und werden als Tests und Gates festgenagelt, nicht
als Prosa. Kein Agent kann sie ändern (`AGENTS.md`: „Agents cannot expand their
own approval, credential, budget, or release policy“).

- **I1 Rahmen nur durch den Menschen.** Projektziel, Budgetrahmen, maximale
  Vertrauensstufe je Klasse und Sperrliste ändern sich nur mit dem
  Verdict-Token. Die Rampe bewegt sich innerhalb des Rahmens und hebt ihn nie an.
- **I2 Nie autonom:** Release und Tags, Credentials und Secrets, Budget- und
  Policy-Änderungen, Branch-Protection, Installation auf dem Nutzer-PC,
  Änderungen an diesen Invarianten selbst.
- **I3 Autonomer Merge nur mit vollem Beleg:** CI grün (alle Required
  Checks), red-first-Nachweis, anbieterfremde Reviews (zwei bei Nahtstelle
  oder > 300 Zeilen) mit Disposition, Beleg an genau diesen Kandidaten
  gebunden (W2-02), freigegebene Stufe der Klasse erreicht.
- **I4 Rückschlag-Automatik.** Ein Revert, ein roter `main` nach Merge oder
  eine ausgelieferte Regression senkt die Stufe der betroffenen Klasse sofort,
  stoppt autonome Merges dort und legt eine Entscheidung ins Postfach.
- **I5 Not-Aus.** Ein Schalter in Cockpit, App und `pa` hält alle Projekte an
  und lässt laufende Worker sauber enden. Er wirkt ohne Netz und ohne Agent.
- **I6 Prüfpfad.** Jede autonome Aktion schreibt, wer sie ausgelöst hat,
  warum, mit welchem Beleg und auf welcher Stufe. Alles ist im Cockpit
  nachvollziehbar.
- **I7 Ehrliche Fähigkeit.** Kein Runner, Anbieter oder Modell gilt als
  verfügbar, bevor es beobachtet wurde. Konfiguration ist kein Beleg.

## 5. Architektur in einem Absatz

Ein **Projekt** ist eine dauerhafte Einheit im Store: Ziel, Paket-DAG,
Kontextbasis, Abonnements, Vertrauensprofil, Budgetrahmen. Der
**Koordinator** ist ein Agent ohne Schreibrecht; er arbeitet nur über die
Store-API (Pakete anlegen, Worker beauftragen, Entscheidungen vorlegen). Er
bekommt Ereignisse in ein **Postfach** gepusht statt zu pollen. **Runner** sind
austauschbare Ausführungsorte (lokale PTY, `pa daemon`, Cloud-Sitzung, später
VM). Jeder meldet seine Fähigkeiten, und der Scheduler wählt je Paket Ort,
Anbieter und Zeitfenster und begründet die Wahl mit einem Routing-Beleg. Eine
**Bilanz** misst je Aufgabenklasse Qualität, Kosten und Tempo. Daraus ergeben
sich Vertrauensstufe, Scorecards und Prognosen. **Kontext** ist eine Sammlung
belegter Notizen, die bei Codeänderung verfallen.

## 6. Alleinstellungsmerkmale

| Gruppe | Merkmal | Kern |
|---|---|---|
| Qualität | Anbieter-Wettbewerb | Kritische Pakete parallel bei 2–3 Anbietern; der Kandidat mit den besten Belegen gewinnt. Automatisch nur für Nahtstellen und riskante Klassen. |
| Qualität | Angriffs-Reviewer | Der Reviewer schreibt rote Tests gegen den Kandidaten; überlebender Code zählt als stärkerer Beleg. |
| Qualität | Mutationstest-Gate | Neue Tests müssen eingebaute Mutationen in den geänderten Zeilen fangen. |
| Qualität | Automatischer Laufzeit-Beleg | App in Sandbox (eigenes Datenverzeichnis, Queue aus), Screenshot und Messung als Beleg. |
| Planung | Kosten-/Zeitangebot | Prognose vor Start aus der eigenen Historie, Soll/Ist danach. |
| Planung | Selbstheilender Plan-DAG | Teilung bei > 300 Zeilen oder Scheitern, Umplanung der Abhängigen. |
| Planung | Konfliktvorhersage | Datei- und Lane-Kollisionen vor dem Dispatch, Reihenfolge automatisch. |
| Planung | Pre-Mortem | Zwei Anbieter sammeln unabhängig Risiken; die werden zu Abnahmekriterien. |
| Zusammenspiel | Entscheidungs-Postfach + Briefing | Nur echte Nutzerentscheidungen, gebündelt mit Empfehlung und Belegen. |
| Zusammenspiel | Präferenzmodell | Lernt aus Dispositionen und Korrekturen, lokal, belegt, abschaltbar. |
| Zusammenspiel | Warum-Replay | Jede Aktion nachspielbar (PTY-Trace, Prompt, Kontext), mit belegter Begründungskette. |
| Zusammenspiel | Schatten-Modus | Neue Autonomie entscheidet erst parallel zum Nutzer; Abweichungen sichtbar, bevor sie wirkt. |
| Ökonomie | Kontingent-Arbitrage | Arbeit in frische Abo-Fenster legen; lokale Modelle für einfache Aufgaben, wenn alles leer ist. |
| Ökonomie | Projektübergreifendes Wissen | Belegte Lessons und Gates zwischen Projekten, mit Herkunft und eigener Freigabe. |
| Ökonomie | Anbieter-Scorecards | Qualität, Kosten und Tempo je Anbieter und Klasse; das Routing folgt den Zahlen. |
| Ökonomie | Selbst-Benchmark | Fester Aufgabenkatalog regelmäßig; Verbesserung und Regression messbar (baut auf W4-01). |

## 7. Paketschnitt

Lesart wie in `docs/PLAN.md`: **ID · Titel** · Größe · Lane · Abnahme ·
Abhängigkeit. S ≤ 150, M ≤ 300 Diff-Zeilen. Jedes Paket mit Nahtstelle oder
> 300 Zeilen braucht zwei anbieterfremde Reviews.

### Phase A — Fundament (setzt W2-01, W2-02, W2-04 voraus)

- **W5-01a Projektrahmen im Store** · M · Lane store.rs · Migration für
  Ziel, Budgetrahmen, maximale Stufe je Klasse, Sperrliste; nur schreibbar mit
  gültigem Verdict-Nachweis · Abnahme: roter Test „Rahmen ohne Verdict ändert
  sich nicht“ (I1) · nach W2-01.
- **W5-01b Projektrahmen über die API** · S · Lane api.rs · Endpunkte lesen
  und ändern, Verdict-Token Pflicht · Abnahme: 403-Test ohne Token · nach W5-01a.
- **W5-02 Koordinator ohne Schreibrecht** · M · `workers.rs`, `profiles.rs`
  · eigenes Profil, cwd außerhalb jedes Worktrees, Tool-Allowlist nur
  Lesen und `pa` · Abnahme: roter Test „Schreibversuch des Koordinators wird
  abgelehnt“; Smoke mit einem echten Anbieter.
- **W5-03 Ereignis-Postfach** · M · Lane store.rs, `journal_watch.rs` ·
  typisierte Ereignisse (Worker fertig, gescheitert, braucht Eingabe; CI; PR)
  werden dem Koordinator über den Submit-Guard zugestellt, statt dass er pollt
  · Abnahme: Ereignis erreicht den Koordinator in ≤ 5 s, keine doppelte
  Zustellung nach Neustart.
- **W5-04 Not-Aus** · S · Lane main.rs · I5 in App, `pa stop-all`, Cockpit ·
  Abnahme: Test, dass nach dem Schalter kein neuer Dispatch entsteht.
- **W5-05 Prüfpfad** · S · Lane store.rs · I6 als append-only Tabelle ·
  Abnahme: jede autonome Aktion der Folgepakete schreibt einen Eintrag (Gate).

### Phase B — Entscheidungs-Postfach (erstes sichtbares Merkmal)

- **W5-06 Entscheidungen im Store** · M · Lane store.rs · Entscheidung mit
  Frage, Empfehlung, Optionen, Belegen, Frist; Antwort nur mit Verdict-Token.
- **W5-07 Tagesbriefing** · S · `digest.rs` · aus Journal und Prüfpfad; nur
  offene Entscheidungen, Rückschläge, Budgetstand.
- **W5-08 Postfach in App und Cockpit** · M · Frontend, `docs/dev-hq/hq.js`
  · Abnahme: Screenshot hell/dunkel, Tastaturbedienung · nach PR #70.

### Phase C — Reaktionen

- **W5-09 Abonnements** · M · Lane store.rs, `gh.rs` · CI-, PR- und
  Zeitplan-Abos je Projekt; `gh.rs` erzeugt Ereignisse statt nur Spalten.
- **W5-10 Nacharbeit an eigenen PRs** · M · CI rot → Reparatur-Worker, Review-
  Befund → Nacharbeit, `main` nachziehen; nur an PRs des Projekts ·
  Abnahme: simulierter roter Lauf führt zu genau einem Reparatur-Auftrag.
- **W5-11 Review-Reaktion** · M · PR offen → anbieterfremder Reviewer,
  Disposition als Datei · nach W2-01.

### Phase D — Messen, noch ohne Wirkung

- **W5-12 Bilanz je Aufgabenklasse** · M · Lane store.rs · Klassifikation
  (Doku, Test, Frontend, Rust, Nahtstelle, Sicherheit, …) und Kennzahlen
  (red-first-Quote, Review-Ablehnungen, Reverts, Nacharbeit, Tokens, Dauer).
  Nur aufzeichnen.
- **W5-13 Schatten-Modus** · M · Koordinator-Entscheidungen parallel zu den
  Nutzerentscheidungen, Abweichungsbericht im Briefing.
- **W5-14 Anbieter-Scorecards** · S · aus W5-12.
- **W5-15 Kosten-/Zeitangebot** · S · Prognose vor Start, Soll/Ist danach.
- **W5-16 Selbst-Benchmark** · S · Katalog aus W4-01 regelmäßig, Trend im
  Cockpit.

### Phase E — Kontext

- **W5-17 Belegte Notizen mit Verfall** · M · Notiz mit Quelle, Beleg und
  Hash der betroffenen Dateien; wird bei Änderung als veraltet markiert und
  nicht mehr injiziert · Abnahme: roter Test „veraltete Notiz wird nicht
  injiziert“.
- **W5-18 HQ-Lessons in App-Worker** · S · `learnings.rs` · belegte Lessons
  in die Worker-Injektion, gleiche Obergrenze.
- **W5-19 Lesson → Gate-Vorschlag** · M · zweites Auftreten derselben Lesson
  → Paket „Gate/Lint mit rotem Test“ ins Postfach.
- **W5-20 Präferenzmodell** · M · lokal, versioniert, jede Regel mit
  Herkunft; abschaltbar.
- **W5-21 Projektübergreifendes Wissen** · M · Export/Import belegter
  Lessons mit eigener Freigabe je Zielprojekt.

### Phase F — Planung

- **W5-22 Konfliktvorhersage** · M · Datei- und Lane-Prognose je Paket,
  Reihenfolge automatisch · Abnahme: gegen die Welle 2 vom 23.09. rückgerechnet
  (store-, status.rs-, pty.rs-Lanes) liefert sie dieselbe Reihenfolge.
- **W5-23 Selbstheilender DAG** · M · Teilung bei > 300 Zeilen oder
  Scheitern, Umplanung der Abhängigen, jeder Eingriff im Prüfpfad.
- **W5-24 Pre-Mortem** · S · zwei Anbieter, Risiken werden Abnahmekriterien.
- **W5-25 Koordinator schneidet Pakete im Rahmen** · M · nur innerhalb
  von I1; neue Pakete landen zuerst im Schatten-Modus.

### Phase G — Qualität

- **W5-26 Angriffs-Reviewer** · M · Reviewer darf nur Tests schreiben;
  ein roter Angriffstest blockiert den Merge.
- **W5-27 Mutationstest-Gate** · M · `scripts/ci/` · Mutationen nur in
  geänderten Zeilen (Rust und TS); Schwelle je Klasse · Abnahme: Selbsttest
  mit einem absichtlich schwachen Test ist rot.
- **W5-28 Automatischer Laufzeit-Beleg** · M · App mit eigenem
  Datenverzeichnis und abgeschalteter Queue; Screenshot und Messung · Abnahme:
  Beleg entsteht, ohne dass ein echter Worker startet.
- **W5-29 Anbieter-Wettbewerb** · M · nur Nahtstellen und riskante Klassen,
  verschoben bei knappem Kontingent.

### Phase H — Runner und Ökonomie

- **W5-30 Runner-Schicht** · M · Abstraktion und Fähigkeitsmeldung je Ort (I7).
- **W5-31 `pa daemon`** · M · Lane main.rs · Runtime ohne Fenster; die App
  wird zum Client · Abnahme: App schließen, Worker laufen weiter, App öffnen,
  Zustand vollständig.
- **W5-32 Cloud-Runner** · M · zuerst Claude-Code-Cloud-Sitzungen (Abo, $0)
  mit Branch/PR-Beobachtung; bezahlte Runner erst nach Eintrag in
  `docs/decisions.md` mit Budgetgrenze.
- **W5-33 Budget-Routing und Kontingent-Arbitrage** · M · Fenster je Abo,
  lokales Modell als Fallback für einfache Klassen · nach W2-03.
- **W5-34 Warum-Replay** · M · PTY-Trace, Prompt und injizierter Kontext je
  Aktion, im Cockpit abspielbar.

### Phase I — Cockpit

- **W5-35 Projekt-Cockpit** · M, teilbar in 35a Chat-Parität, 35b DAG und
  Flotte, 35c Abos und Budget, 35d Vertrauen und Prüfpfad · `docs/dev-hq/**`
  · nach PR #70 und W2-10.

### Phase J — Freischaltung (je Stufe eine Nutzerfreigabe)

- **W5-36 Vertrauensrampe wirksam** · M · Lane store.rs · Stufen je Klasse
  aus W5-12, I3/I4 als Gate · nach W4-03.
- **W5-37 Stufe 1: Auto-Merge einfacher Klassen** · S · Doku, Tests, Lint.
- **W5-38 Stufe 2: Frontend und nahtstellenfreier Rust** · S.
- **W5-39 Stufe 3: Nahtstellen** · S · zuletzt, nur mit Anbieter-Wettbewerb
  und zwei Reviews.

## 8. Reihenfolge und Parallelität

A → B → C → D ist der kritische Pfad. E, F und G laufen ab D parallel, je nach
Lane. H hängt an A und W2-03. I folgt nach PR #70 und W2-10. J erst nach W4-03
und nach ausreichender Bilanz; die Schwelle je Stufe schlägt W5-12 aus echten
Daten vor, und der Nutzer legt sie fest.

## 9. Offene Nutzerentscheidungen

- Budgetgrenze und Anbieter für einen bezahlten Cloud-Runner (vor W5-32 Teil 2).
- Klassen und Schwellen der Vertrauensrampe (nach Auswertung von W5-12).
- Ob Slack/Discord später als Kanal dazukommt (nicht im Umfang).

## 10. Risiken

- **Kontingent:** Wettbewerb, Angriffs-Reviewer und Mutationstests
  vervielfachen den Verbrauch. Gegenmittel: nur für riskante Klassen,
  Arbitrage, harte Budgetgrenze im Ledger.
- **Scheinsicherheit der Rampe:** kleine Stichproben. Gegenmittel: erst
  messen (D), Schatten-Modus, Mindestanzahl je Klasse, I4.
- **Nahtstellen-Engpass:** viele Pakete berühren store.rs. Gegenmittel:
  W5-22 ordnet die Lane, Pakete bleiben S/M.
- **Cloud-Runner ohne Rückkanal:** Heutige Cloud-Sitzungen können nicht
  zurückmelden. Gegenmittel: Beobachtung über Branches, PRs und Reports, wie in
  Welle 2 praktiziert.

## 11. Nicht im Umfang

Slack/Discord, bezahlte Runner ohne Budgetentscheidung, Änderungen an der
Release-Pipeline, jede Lockerung von I1–I7.
