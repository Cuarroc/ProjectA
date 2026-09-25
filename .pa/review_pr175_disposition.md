# Dispositionen PR #175 (PLAN-01: Nutzerentscheidungen 25.09.)

Kandidat: `3ee7c88` (Branch `claude/plan-01-decisions`), Diff
`origin/main...HEAD` (230 Dateien, +1895/−1783, davon 200 reine Umbenennungen
R100 nach `.pa/archiv/`). Reviews:
- `.pa/review_pr175_glm-5.2.md` (Befunde F1–F2), 200 s;
- `.pa/review_pr175_kimi-k3.md` (Befunde F-1 bis F-9), 364 s.

Beide liefen über `.pa/review_transport.py` gegen den lokalen Ollama-Endpunkt;
angefragt `glm-5.2:cloud` und `kimi-k3:cloud`, bedient `glm-5.2` und `kimi-k3`,
beide Status ok, Exit 0, kein Geld ausgegeben. Autor des Kandidaten: claude —
kein Reviewer aus der Modellfamilie des Autors. Der Prompt
(`review_prompt_pr175.md`, 356.516 Zeichen, voller Diff) liegt unversioniert im
Worktree; Regel 7 (keine eingecheckten Review-Prompts) gilt seit diesem Branch.

Zeilenangaben beziehen sich auf den Kandidaten `3ee7c88`.

| Befund | Schwere | Inhalt | am Kandidaten geprüft | Disposition |
|---|---|---|---|---|
| G-F1 = K-F-9 | low | Relative Links in `.pa/archiv/STAND_2026-09-24.md` (Zeilen 6–9) und `PLAN_2026-09-24.md` (Zeilen 14–15) zeigen nach dem Umzug ins Leere (`.pa/archiv/docs/…` existiert nicht). | **bestätigt**: sechs Links, `[…](docs/MASTERPLAN.md)`, `[…](docs/ERLEDIGT.md)`, `[…](.pa/plan_projects_w5.md)`, `[…](MASTERPLAN.md)`, `[…](ERLEDIGT.md)`. | **angenommen, umgesetzt**: Links auf `../../docs/…` bzw. `../../.pa/…` korrigiert; zusätzlich ein Hinweissatz in `.pa/archiv/README.md`, dass übrige relative Links in archivierten Dateien auf ihren ursprünglichen Ort zeigen. |
| G-F2 = K-F-8 | low | `docs/dev-hq/data.js`/`data.json`: F0 von `"done"` auf `"waiting"` — der HQ-Parser findet die F-Wellenstruktur im neuen PLAN.md nicht mehr. | **bestätigt als erwarteten Zwischenstand**: Nebeneffekt des Plan-Umbaus; die Parser-Umstellung ist W1-17. Zusätzlich bindet der Test „live specs" (`scripts/lib/hq-pages.test.mjs:97`) den Snapshot an die „Aktive Specs" in STAND.md — nach K-F-7 wäre der Snapshot sonst rot. | **angenommen, umgesetzt**: W1-17-Zeile in `docs/PLAN.md` nennt die Fehlanzeige der F-Meilensteine ausdrücklich; der Snapshot wurde mit `npm run hq` neu erzeugt (4 aktive Specs statt 7), `npm run test:hq` grün. Die F-Meilenstein-Anzeige bleibt bis W1-17 „waiting" — das ist der dokumentierte Zwischenstand, kein Datenfehler. |
| K-F-1 | medium | `AGENTS.md:180` behauptet „CI runs only when a PR is marked ready and in the merge queue“ als Ist-Zustand; das ist das CI-03-Verhalten, und CI-03 ist der offene PR #149. `SKILL.md:91–92` sagt das Gegenteil („Every push to a ready PR costs a CI run“). | **bestätigt**: `ci.yml:112/197/320` filtert nur Drafts (`!draft`), jeder Push auf einen ready PR löst CI aus; PLAN.md:61 führt CI-03 als „PR #149“ (offen, ready). | **angenommen, umgesetzt**: AGENTS.md beschreibt jetzt den Ist-Zustand (kein CI für Drafts, jeder Push auf einen ready PR kostet einen Lauf) und benennt CI-03/PR #149 als die Änderung auf „nur in der Queue“. |
| K-F-2 | medium | `README.md:69` hält am alten Fluss fest: PR „opened at the end“. Widerspricht Regel 4 (push early) und dem Draft-früh-Fluss in AGENTS.md und SKILL.md. | **bestätigt**: wörtlich „one PR per package, opened at the end and kept as a draft until …“. | **angenommen, umgesetzt**: README-Zeile auf den neuen Fluss umgeschrieben (Draft früh, Push nach jedem grünen Schritt, ready erst mit Report/Disposition/NICHT-ABGEDECKT). |
| K-F-3 | medium | W5-„Kern“ still größer als beschlossen: PLAN.md:206 und `.pa/plan_projects_w5.md:5–6` listen zusätzlich W5-00b, W5-02b3–b5/b7 und W5-05. | **bestätigt**: die Entscheidung (`pa-orch/decisions/decisions.js`, `w5-auf-kern`) lautet „W5-22, W5-28, W5-02a und Not-Aus bleiben, rund 93 Punkte werden geparkt“. Die Erweiterung ist redaktionell, nicht entschieden. | **angenommen als Inbox-Eintrag (E7)**: die Plan-Substanz ändert nur der Nutzer; die Erweiterung ist jetzt als offene Bestätigungsfrage mit Empfehlung in der Entscheidungs-Inbox ausgewiesen statt still im Kern. Keine Zeilen verschoben. |
| K-F-4 | medium | `docs/setup/README.md:29` dreht die Implementierungsrolle für Nahtstellen/Security um (Claude nur noch „als Ausweichen“), ohne dass eine 25.09.-Entscheidung das deckt. | **bestätigt als Diff-Bestandteil**, mit Einordnung: `docs/setup/providers.md:54` (in diesem PR unverändert) routete Nahtstelle/Security schon vorher primär auf Codex `gpt-6-astra`; die alte MASTERPLAN-Modellregel war ausdrücklich „vorläufig“. Der PR hat README an die bestehende Routing-Quelle angeglichen. In `pa-orch/decisions/answers.json` gibt es keine Rollen-Entscheidung. | **teilweise angenommen**: der alte README-Text wird **nicht** restauriert (er widerspräche providers.md, das dieser PR zur einzigen Routing-Quelle erklärt). Stattdessen Inbox-Eintrag E8: der Nutzer bestätigt das Routing ausdrücklich. |
| K-F-5 | low | Die Single-Writer-Regel für die Plandokumente (archivierter MASTERPLAN, „Worker-Struktur“) ist ersatzlos gefallen; die doc-Lane hat keine Reihenfolge, und M2 plant OPS-01, OPS-02, SETUP-09, SETUP-15 parallel. | **bestätigt**: PLAN.md Regel 5 verlangt von jedem gemergten Paket eigene Stand-Updates; eine Schreibregel für PLAN.md/STAND.md fehlt, die Lane-Liste (PLAN.md:145–152) kennt keine doc-Ordnung. | **angenommen, umgesetzt**: ein Satz in „Regeln für diesen Plan“ — PLAN.md, STAND.md und ERLEDIGT.md schreibt außerhalb der eigenen Stand-Zeile nur der Koordinator oder ein Paket mit ausdrücklicher Zuweisung. |
| K-F-6 | low | `.mergify.yml:124–125`: die `files ~= ^\.pa/report_.*\.md$`-Alternative ist ein Übergang ohne Ende — ein permanenter Bypass um die `## Report`-Pflicht. | **bestätigt**. Blast-Radius des Entfernens geprüft: von den offenen PRs ist nur #176 (Draft) ein Paket-Branch mit `.pa/report_*.md` (1 Datei); die ready PRs #149/#153/#164/#170/#172 matchen den Paket-Branch-Regex nicht und brauchen den Check nicht. #176 kann den Abschnitt jederzeit in den PR-Text setzen. | **angenommen, umgesetzt**: `files`-Alternative entfernt, Übergangskommentar in `.mergify.yml`, der Transition-Satz in `AGENTS.md` und `docs/setup/mergify.md:60–61` angepasst (Übergang endet mit diesem PR; #176 als einziger Bestands-PR benannt). |
| K-F-7 | low | STAND.md listet `.pa/task_ollama_worker_adapter.md` (M4), `.pa/task_hq2-02.md` und `.pa/task_w1-10.md` (M3) als ausführbar, obwohl die Lane-Ordnung sie sperrt. | **bestätigt** für alle drei: wk-Lane hat sechs Pakete vor W2-09b, hqL hat W1-17 vor W1-10, und HQ2-02 hängt zusätzlich an Inbox E1 (Nutzer muss die Demo abnehmen). | **angenommen, umgesetzt**: die drei Specs auf `Status: entwurf` (mit Grund im Status-Kommentar), ihre Zeilen aus „Aktive Specs“ in STAND.md entfernt; `npm run specs` (Exit 0) belegt die Konsistenz — das Gate verlangt aktiv ⇔ gelistet. |

## Messungen

| Befehl | Stand | Ergebnis |
|---|---|---|
| `python .pa/review_transport.py .pa/review_prompt_pr175.md .pa pr175` | `3ee7c88` | beide Reviewer ok, **Exit 0** |
| `npm run specs` (Spec-Status-Gate) | nach Umsetzung | **Exit 0** (11 Specs, 4 aktiv, 7 historisch; zuerst Exit 1 mit den drei neuen entwurf-Specs, weil der Hinweissatz in STAND.md ihre `.pa/`-Pfade nannte — nach Umformulierung grün) |
| `cargo test canonical_plan_has_exactly_38_devflow_packages` (Importer liest das echte `docs/PLAN.md` per `include_str!`) | nach Umsetzung | 1 passed, **Exit 0** |
| `npm run hq` (Snapshot-Regeneration) + `npm run test:hq` | nach Umsetzung | `test:hq` zuerst **Exit 1** („live specs: every executable spec is listed in STAND" — Snapshot noch mit den drei entwurf-Specs); nach Regeneration **Exit 0** |
| `python -c "yaml.safe_load(.mergify.yml)"` | nach Umsetzung | **yaml ok** |
| pre-push-Hook (`lane prepush`) | beim Push | siehe Push-Ausgabe |

## Ergebnis

Neun Befunde (zwei davon deckungsgleich bei beiden Reviewern), keine hohen,
vier medium, Rest low. Angenommen und umgesetzt: G-F1/K-F-9, G-F2/K-F-8,
K-F-1, K-F-2, K-F-5, K-F-6, K-F-7; als Inbox-Eintrag angenommen: K-F-3 (E7);
teilweise angenommen: K-F-4 (Routing bleibt, Nutzerbestätigung als E8). Nichts
vollständig abgelehnt. Alle Änderungen sind Doku/Config plus der neu erzeugte
HQ-Snapshot — Red-first entfällt
(AGENTS.md, Regel 2: nur reine Doku ist befreit; hier liegt ausschließlich Doku
und Mergify-Config ohne Laufzeitwirkung vor, das `## Report`-Verhalten prüft
Mergify selbst im Queue-Lauf). Der Importer-Hard-Constraint ist von beiden
Reviewern unabhängig als erfüllt bestätigt und nach den Änderungen per Test
erneut grün (genau eine DF-Tabelle, 38 Zeilen, keine Konkurrenztabelle).
