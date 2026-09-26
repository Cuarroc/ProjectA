# MASTERPLAN — alle verbleibende Arbeit, in Ausführungsreihenfolge

Stand: **24.09.2026, 21:00**, abgeglichen gegen `origin/main` @ `04e54d3` (PR #121) und die GitHub-PR-Liste.
Quellen: `docs/PLAN.md` (P: Paket-ID dort), `.pa/plan_projects_w5.md` (W5:Zeile),
`.pa/report_*.md` (R:Name), offene PRs, der Setup-Audit-Plan vom 24.09.

**So liest man dieses Dokument.** Jede Zeile ist ein Paket mit genau einem
Implementer und einem Worktree. Die Tabellen stehen in Ausführungsreihenfolge (Stufen S0–S5).
Innerhalb einer Lane gilt die Tabellenreihenfolge. Pakete mit verschiedenem
Lane-Schlüssel und derselben Stufe dürfen gleichzeitig laufen, solange Build-Slots frei
sind (siehe „Worker-Struktur“). „neu“ heißt: Folgearbeit aus einem Report, noch
nicht in PLAN oder W5-Plan; dazu zählen auch CI- und SETUP-Pakete. Neue Pakete zählen
getrennt (Zeile „zzgl. neue Folgepakete“).

**Erledigtes steht in `docs/ERLEDIGT.md`, nicht hier.** Ein gemergter PR gilt als
erledigt; das Paket wird hier gestrichen und dort eingetragen.

**Folgepakete aus Reports brauchen keine eigene Spec** (Nutzerentscheidung 24.09.): der
Report, auf den die Spalte „Quelle“ zeigt, ist ihre Quelle. Eine `.pa/task_<id>.md` bekommen
nur Pakete aus PLAN oder W5-Plan.

## Fortschritt

Gewichtung: S = 1, M = 3, L = 8 Punkte. Gemergt = erledigt. Größen aus PLAN/W5-Plan;
fehlt dort eine, ist sie geschätzt und in den Tabellen mit „(g)“ markiert.
L steht nur für Sammelpakete, die vor dem Dispatch in M-Kinder geteilt werden.

| Welle | erledigt / gesamt (Punkte) | % | offen | in Arbeit | blockiert |
|---|---|---|---|---|---|
| W1 | 44 / 59 | 74,6 | 5 | 0 | 2 |
| W2 | 14 / 32 | 43,8 | 2 | 3 | 1 |
| W3 | 4 / 16 | 25,0 | 3 | 0 | 3 |
| W4 | 0 / 6 | 0,0 | 1 | 0 | 3 |
| W5 (Projekte) | 5 / 135 | 3,7 | 8 | 0 | 48 |
| DF (DEVFLOW) | 34 / 124 | 27,4 | 6 | 0 | 26 |
| HQ2 | 10 / 46 | 21,7 | 1 | 0 | 6 |
| KI (Einzelpakete) | 1 / 1 | 100 | 0 | 0 | 0 |
| **Summe** | **112 / 419** | **26,7** | **26** | **3** | **89** |
| zzgl. neue Folgepakete (inkl. CI und SETUP) | 19 / 74 | 25,7 | 24 | 5 | 5 |
| **Summe inkl. neu** | **131 / 493** | **26,6** | 50 | 8 | 94 |

„blockiert“ heißt: eine Abhängigkeit ist nicht gemergt, oder eine Nutzer-/PC-Entscheidung fehlt.
Warten auf eine belegte Lane zählt als „offen“. Ein PR in der Merge-Queue zählt als „in Arbeit“.
Gezählt wird je Tabellenzeile; Ausnahme W5-35a–f, das als sechs Pakete zählt. Aliase (unten) zählen
0 Punkte und keine Zeile.

### Rechengrundlage (zum Nachrechnen)

- **W1 erledigt, 44 Punkte:** M (6 × 3 = 18) für W1-01, W1-03 (C-3), W1-03c/d, W1-11, W1-18, W1-19 (Kern, #39).
  S (26 × 1 = 26) für W1-01a, 02, 04, 05 (Doku), 06, 07, 08, 09, 09b, 13, 14, 15, 15b, 16, 21, 21b, 22, 23,
  23b, 24, 24b, 25, 25b, 26, 26b, 26c.
  **Offen, 15 Punkte:** S 03e, 12, 20 (3); M 03f, 05b, 10, 17 (12). W1-19b ist in CI-02 aufgegangen (Alias, 0 Punkte),
  deshalb sinkt W1 von 60 auf 59 Punkte.
- **W2 erledigt, 14 Punkte:** W2-01 M, W2-02 M, W2-04 M, W2-05 M, W2-07 S, W2-09 S.
  **Offen, 18 Punkte:** 03, 06, 08a (g), 08b (g), 09b (g), 10 je M. W2-08 (M) ist in 08a und 08b geteilt
  (Koordinator 24.09.), deshalb wächst W2 von 29 auf 32 Punkte.
- **W3 erledigt, 4 Punkte:** W3-05 S (Entscheidung), W3-06 M. **Offen, 12 Punkte:** 01 M, 02 M, 03 (3 Drills × S), 04 S, 07 S, 08 S.
  W3-09 ist inaktiv (nur wenn W0-05 = zerlegen) und nicht gezählt.
- **W4, 6 Punkte:** 01 M, 02 S, 03 S, 04 S (g). W4-03a ist ein Vorschlag und zählt unter „neu“.
- **W5, 135 Punkte:** Phase A 24 (inkl. W5-02b2 S (g)), B 5, C 14, D 11, E 13, F 7, G 22, H 9, I 18 (35a–f je M), J 12.
  Phase B verliert W5-08a M + 08b S (Aliase → DF-18), Phase D verliert W5-14 S (Alias → DF-30): 140 − 5 = 135.
  Erledigt: W5-00 S + W5-02b M + W5-02b2 S (g) = 5.
- **DF erledigt, 34 Punkte:** DF-00/01/02 je S (3); DF-03 M; DF-04a M, 04b M, 04c S (g); 05a M, 05b M; 06a M;
  07a/b/c je S (g); 08a S (g); 08b M; 08c M; 09a S (g); 15a S (g).
  **Offen, 90 Punkte:** 06b S (g), 07d S (g), 08d M (g), 09b M (g), 10–36 (27 × M = 81), 37 S.
  DF-07d zählte als erledigtes M; bis zum visuellen PASS ist es ein offenes S (g) (Nutzer 24.09.), deshalb
  sinkt DF von 126 auf 124 Punkte.
- **HQ2 erledigt, 10 Punkte:** 00 S, 01 M, 05a M, 11 M (g).
  **Offen, 36 Punkte:** 02, 03, 05b (g), 06 je M (12); 07, 08, 09 je L (g) (24). HQ2-04 M und HQ2-10 L (g) sind
  Aliase (→ DF-10, → DF-35–37): 57 − 11 = 46.
- **KI:** KI-23 S erledigt (#94).
- **Neu, 74 Punkte:** 30 Folgepakete (40 Punkte, davon offen 27 Pakete mit 37 Punkten in der Liste unten;
  erledigt W2-04b, W1-24c, W5-02b6), CI-01 M + CI-02 S (4), SETUP 30 (A 9, B 6, 04 M, 12 M, 15 M,
  00/05/09/10/13/14 je S). **Erledigt 19:** W2-04b, W1-24c, W5-02b6, CI-01, SETUP-A (9), SETUP-00, -05,
  -10, -13.
  Neu aufgenommen am 24.09. abends: W1-30, W2-01d, W2-04g, W5-02b7 (je S (g)).

## Aliase (Nutzerentscheidung 24.09.: bei Überschneidung gewinnt die DF-ID)

Ein Alias ist kein Paket: 0 Punkte, keine Tabellenzeile, kein Dispatch. Sein Inhalt und seine Abnahme gehen
in das Zielpaket über; wer den Alias als Abhängigkeit nennt, wartet auf das Zielpaket. Geprüft wurden alle
Paare der früheren Liste „Doppelungen zwischen den Plänen“:

| Alias | → Ziel | Warum |
|---|---|---|
| W5-08a Postfach in der App (M) | DF-18 | Entscheidungs-Inbox in der App; Abnahme (Screenshot hell/dunkel, Tastatur) geht mit |
| W5-08b Postfach im Cockpit (S) | DF-18 | dieselbe Inbox im HQ |
| W5-14 Anbieter-Scorecards (S) | DF-30 | Provider-Vergleich ist Teil der Statistikprojektionen; Regel „unverifizierte Werte fließen nicht ein“ geht mit |
| HQ2-04 Code-Chat: beratend/aktiv, Providerwechsel (M) | DF-10 | Chat-Modi Plan/Interview/aktive Ausführung |
| HQ2-10 Smokes, Offline-Build, A11y, Release-Gates (L (g)) | DF-35, DF-36, DF-37 | Smokes → DF-35, UI-/A11y-Abnahme → DF-36, Dispositionen/Release-Gates → DF-37; der installierte Offline-/Recovery-Build → HQ2-08 |
| W1-19b Rest W1-19 (S) | CI-02 | Nutzer 24.09.: in CI-02 aufgegangen (kein DF-Paar) |

Kein Alias, weil der Inhalt verschieden ist (Schnittstelle statt Doppelung):
- **W5-06/06b ↔ DF-18:** W5-06 ist der Store der Entscheidungen, W5-06b die API; DF-18 ist nur die Oberfläche
  und hängt jetzt an W5-06b.
- **W5-30b/33 ↔ DF-19/20:** W5-30b ist die Runner-Schicht, W5-33 die harte Kontingent-Buchung; DF-19 empfiehlt,
  DF-20 editiert. DF-19 liest die W5-33-Daten, sobald es sie gibt.
- **W5-12 ↔ DF-29–31:** W5-12 ist die Vertrauensbilanz mit eigenen Regeln (Klasse aus Pfaden, nur signierte
  Werte) und trägt W5-13/15/25/36a; DF-30 hängt jetzt an W5-12.
- **W5-02d ↔ DF-12:** Signatur der Urteile gegen Unabhängigkeit der Modellfamilie; beide nötig.
- **HQ2-03, HQ2-06, HQ2-09:** Design-Tokens, Harness-Schema und Projektstart/Sync haben kein DF-Gegenstück;
  der Statistik-Anteil von HQ2-09 liegt bei DF-29–31, der Dichte-Anteil von HQ2-03 bei DF-07.

## Modellregel (vorläufig, Benchmark folgt)

| Kürzel | Bedeutung | wofür |
|---|---|---|
| **KG·m** | Kimi (kimi-k3) oder GLM (glm-5.2) über OpenCode, Effort medium | Frontend, HQ, Doku, kleine Pakete (S) ohne Nahtstelle und ohne Sicherheitsbezug |
| **O·h** | Claude Opus, Effort high | Nahtstellen (`api.rs`, `main.rs`, `store.rs`/`store/`, `bin/pa.rs`) und alles Sicherheitsrelevante |
| **Cx·m** | Codex, Effort medium | mittelgroßes nahtstellenfreies Rust (M), wenn es passt |
| **N** | Nutzer bzw. PC | Entscheidungen, PC-Proben, Produktionsschlüssel |

**Reviews immer zwei, anbieterfremd:** kimi-k3 + glm-5.2, ersatzweise deepseek-v4-flash über
Ollama Cloud. Nie die Modellfamilie des Autors. **Advisor-Paar** für harte Entscheidungen und
Abschlussreviews: Fable 5.1 (Claude-Subagent) + GPT-6 Astra (Codex CLI, Effort je Aufruf);
Regeln in `AGENTS.md` („Reviews and advisors“).

## Lane-Schlüssel

`st` store.rs + store/ · `api` api.rs · `mn` main.rs · `pa` bin/pa.rs (diese vier sind Nahtstellen,
je Lane ein aktives Paket) · `pty` pty.rs/submit_guard.rs · `wk` workers.rs/profiles.rs ·
`sup` supervisor.rs · `ci` .github/ + scripts/ci/ · `hqL` Legacy-HQ (hq.js, hq.css,
hq-parse.mjs, hq-live.mjs) · `hqS` Studio-Einstiegspunkte docs/dev-hq/concepts/ (FIFO-Integrator) ·
`fe` src/ (disjunkte Komponenten parallel) · `fR` nahtstellenfreies Rust, disjunkte Dateien ·
`doc` Doku · `N` Nutzer/PC.
Die Spalte „Parallel-Gruppe“ steht für Lane/Stufe.

---

## S0 — in Arbeit

| ID | Titel | Gr. | Status | Abhängig von | Lane / Dateien | Parallel-Gruppe | Modell | Quelle |
|---|---|---|---|---|---|---|---|---|
| W2-01b | neu: Review-Route nimmt `reviewerRunId` aus dem Credential | S (g) | in Arbeit (PR #124 in der Merge-Queue) | W2-01 ✓ | api | api/S0 | O·h | R:w2-01 Folge 1 |
| W2-03 | Usage-/Billing-Collectors je Adapter | M | in Arbeit | W2-02 ✓, W2-04b ✓ | st (development_codex_usage.rs, budget.rs) | st/S0 | O·h | P |
| W2-06 | Supervisor: Producer-Audit und Runtime-Notifications | M | in Arbeit | W2-04 ✓, W1-22 ✓ | sup + mn | mn/S0 | O·h | P |
| W2-08a | Ressourcendruck- und Streaming-Enforcement (erster Teil von W2-08) | M (g) | in Arbeit | — | fR (pressure, process_capture) | fR/S0 | Cx·m | P |
| W1-15c | neu: übrige Mutex-Stellen in pty.rs (Setter, Reader-Hook, Trace, Submit-Guard) und `api/agent_access.rs:266` | S (g) | in Arbeit | W1-15b ✓ | pty (+ agent_access.rs) | pty/S0 | KG·m | R:w1-15b, KNOWN_ISSUES KI-14 |

CI-02 (mit W1-19b), SETUP-B und SETUP-04 laufen ebenfalls (Tabellen „CI“ und „SETUP“ unten).

## S1 — sofort bzw. sobald die Lane frei ist (nach Priorität)

| ID | Titel | Gr. | Status | Abhängig von | Lane / Dateien | Parallel-Gruppe | Modell | Quelle |
|---|---|---|---|---|---|---|---|---|
| DF-07d | Visueller PASS der React-Dichte (Code über #70 gemergt): Screenshots komfortabel/kompakt bei 1280×800 und 1920×1080 ansehen; DF-07 ist erst danach abgenommen (Nutzer 24.09.) | S (g) | offen | DF-07a–c ✓ | fe (nur Sichtprüfung) | fe/S1 (kein Cargo) | O·h (Koordinator) | R:df07d_native_density |
| W2-08b | Rest W2-08: Speicher-/CPU-Grenzen je Job, Ressourcendruck bei der Admission | M (g) | blockiert: Nutzerentscheidung zu den Grenzwerten | W2-08a | fR (pressure) | fR/S1 | Cx·m | P, Koordinator 24.09. |
| W5-02a | Koordinator ohne Schreibpfad | M | offen (wk-Lane frei) | W5-02b ✓ | wk (workers.rs, profiles.rs) | wk/S1 | O·h | W5:233 |
| W1-30 | neu: Flake `omniroute::…::management_failures_keep_their_http_and_network_classes` (100-ms-Timeout unter Last) prüfen | S (g) | offen | — | fR (omniroute.rs, Tests) | fR/S1 | KG·m | R:w1-22 |
| DF-09b | Rest DF-09: React-Parität der Chat-Erscheinungen, Admission-Kompatibilität | M (g) | offen | DF-09a ✓ | hqS/fe | fe/S1 | KG·m | P, R:df09a |
| W5-00b | neu: fremden Text in workers.rs-Prompts systematisch suchen und einhüllen | S (g) | offen | W5-00 ✓ | wk (workers.rs) | wk/S1 (nach W5-02a) | O·h | R:w5-00 |
| W2-09b | DeepSeek-V4-Flash-Worker über OpenCode (PTY-Zustellung, Per-Worker-Config) | M (g) | offen | #49, #50, W1-02 ✓ | wk (hooks/capabilities/profile); mn nur seriell | wk/S1 | Cx·m | P, STAND, task_ollama_worker_adapter |
| W1-10 | HQ-Stylesheet: Kontrast-Gate auf hq.css, Light Mode, prefers-contrast | M | offen | — | hqL (hq.css, contrast-check.mjs) | hqL/S1 (kein Cargo) | KG·m | P |
| W1-21c | neu: xterm-`pageerror` in Viewport.syncScrollArea beim Mount | S (g) | offen | — | fe (TerminalView) | fe/S1 | KG·m | R:w1-21b |
| W1-21d | neu: Terminal-Suche mit Schaltern für Groß-/Kleinschreibung und Regex | S (g) | offen | W1-21b ✓ | fe (TerminalView) | fe/S1 (nach W1-21c) | KG·m | R:w1-21, R:w1-21b |
| W1-18b | neu: Probe, ob Codex/OpenCode `.agents/skills` lesen; danach Profile von `Unsupported` heben | S (g) | offen (PC mit CLIs) | W1-18 ✓ | wk (Skills/Profile) | N+wk/S1 | KG·m | R:w1-18 §3 |
| W1-20 | Zweites Setup reproduzieren (Node 24, npm ci, dev:setup, dev:doctor) | S | offen | — | N | N/S1 | N + KG·m | P |

## S2 — nach S1 in derselben Lane

| ID | Titel | Gr. | Status | Abhängig von | Lane / Dateien | Parallel-Gruppe | Modell | Quelle |
|---|---|---|---|---|---|---|---|---|
| W2-01d | neu: CLI-Befehl `pa hq agent review` für die scoped Review-Route | S (g) | blockiert: W2-01b (#124 in der Queue) | W2-01b | pa (bin/pa.rs) | pa/S2 | O·h | PR #124 „NICHT ABGEDECKT“ |
| W5-02b7 | neu: HQ-Profilansicht (`mergeProfileViews`) zeigt `envPolicy` an | S (g) | offen | W5-02b6 ✓ | hqL (scripts/lib/hq-live-lib.mjs, hq-live.mjs) | hqL/S2 (kein Cargo) | KG·m | PR #121 „NICHT ABGEDECKT“ |
| W2-04g | neu: optional eine Versionsspalte für die Attestierungsregel statt Textvergleich (nur relevant bei Rolling-Upgrades mit offenen Retries) | S (g) | offen | W2-04b ✓ | st (development_runs.rs) | st/S2 | O·h | R:w2-04b Folge 2 (KD1) |
| W4-03a | neu: Journal-Teil von W4-03 ohne Aktivierung (Voraussetzung W5-03) | S (g) | blockiert (Schnitt vom Nutzer bestätigen) | W2-04 ✓ | mn | mn/S2 | O·h | W5:53, W5:321 |
| W1-09c | neu: KI-1, Prompt-Zusatz editierbar (Setter st → Command mn/api → Feld fe; in drei Kinder teilen) | M (g) | offen | W1-09b ✓ | st → mn → fe | st/S2, mn/S2, fe/S2 | O·h (st/mn), KG·m (fe) | R:w1-09b, PR #99 |
| W1-03e | F-CORE-3 B.3: `MSG_USER` erst nach bewiesener Zustellung | S (g) | offen | W1-03 ✓ | wk (workers.rs:549) | wk/S2 | KG·m | P, R:w1-03_c3 |
| W1-01b | neu: Kimi-Re-Smoke mit `PROJECTA_PTY_TRACE_DIR` (eine `ESC[A\r` vor dem Write) | S (g) | offen | W1-01a ✓ | pty (Messung) | pty/S2 | KG·m | PR #101 |
| W2-01c | neu: `approvalAuthority` in agent_access.rs:355 angleichen | S (g) | offen | W2-01 ✓ | fR (agent_access.rs) | fR/S2 | O·h | R:w2-01 Folge 2 |
| W2-04e | neu: `dispatch.role` ins Agenten-Briefing (`agent_run_context`) | S (g) | offen | W2-04 ✓ | fR/wk (Datei vor Dispatch prüfen) | wk/S2 | KG·m | R:w2-04 Folge 5 |
| W5-02b4 | neu: Push aus dem Worker in den Runner-Host, Aufgabentexte umstellen, dann `strict` als Voreinstellung | M (g) | offen | W5-02b ✓ | pty (Spawn) + wk | pty/S2 | O·h | R:w5-02b |
| W5-02b5 | neu: Test für `http.extraHeader`-Reset mit lokalem HTTP-Server; GPG unter strict (Nutzerentscheidung) | S (g) | offen | W5-02b ✓ | fR (Tests) | fR/S2 | KG·m | R:w5-02b |
| W2-10 | Live-HQ-Views (vor Dispatch teilen: 10a Goals/Teams, 10b Routing/Budget, 10c Review/Delivery) | M | offen | — | hqL (hq.js, hq-live.mjs) | hqL/S2 (nach W1-10) | KG·m | P |
| W1-17 | HQ-Parser auf PLAN umstellen (erst prüfen, ob DF-06a ihn überholt hat) | M | offen | — | hqL (hq-parse.mjs, hq.js) | hqL/S2 (nach W2-10a) | KG·m | P |
| W1-23c | neu: „-0 Tokens“-Anzeige; MSRV von windows-sys/r-efi messen | S (g) | offen | W1-23b ✓ | fR (budget/status-Format) | fR/S2 | KG·m | R:w1-23b |
| W1-29 | neu: Linux-Flake `testgate::…process_group_with_it` (Run 35630751744) | S (g) | offen | — | fR (testgate.rs) | fR/S2 | KG·m | KNOWN_ISSUES KI-25 |
| W2-07b | neu: Windows-ACL auch für `projecta-api.json` und das Verzeichnis `agent-access/`; Datei-Eigentümer prüfen (Folgen 1, 2, 5) | S (g) | offen | W2-07 ✓ | api/fR (Datei vor Dispatch prüfen) | api/S2 | O·h | R:w2-07 §5 |

## S3 — Store-/API-Kette, W5 Phase A–C, DF-Kern

**st-Reihenfolge verbindlich (siehe Worker-Struktur).** Die W5-Zeilen folgen W5:335–342.

| ID | Titel | Gr. | Status | Abhängig von | Lane / Dateien | Parallel-Gruppe | Modell | Quelle |
|---|---|---|---|---|---|---|---|---|
| W5-05 | Prüfpfad (append-only, Trigger gegen UPDATE/DELETE) | S | offen | — | st | st/S3 | O·h | W5:241 |
| W5-01a | Projektrahmen im Store (Default: keine Autonomie) | M | offen | W2-01 ✓ | st | st/S3 | O·h | W5:230 |
| W1-05b | Rest W1-05: sichere Cancel-Regel für `dispatched`; Dedup der acht toten Tasks (in st- und api-Kind teilen) | M (g) | offen | W1-16 ✓ | st → api | st/S3, api/S3 | O·h | P |
| W2-02b | neu: Gleichstand in derselben Sekunde auflösen, vertrauenswürdige Testquelle, Merge-Ergebnis als neuer Kandidat | M (g) | offen | W2-02 ✓ | st | st/S3 | O·h | PR #96 „Offen“, R:w2-02 Folgearbeit 1+2 |
| W2-04c | neu: rollenbewusste Routen und Credentials beim Launch | M (g) | offen | W2-04 ✓ | st (development_launches.rs) | st/S3 | O·h | R:w2-04 Folge 3 |
| W2-04d | neu: Rollen auf Budget-Zwecke im Ledger abbilden | S (g) | offen | W2-04 ✓ | st | st/S3 | O·h | R:w2-04 Folge 4 |
| W2-04f | neu: Planungsendpunkte nur für den Koordinator | S (g) | offen | W2-04 ✓ | api | api/S3 | O·h | R:w2-04 Folge 6 |
| W5-02b3 | neu: Env-Stufe als globale Einstellung (st → api/mn → fe; in drei Kinder teilen) | M (g) | offen | W5-02b ✓ | st → api → fe | st/S3 | O·h / KG·m (fe) | R:w5-02b |
| W5-02d | Signierte Review-Urteile | S | offen | W2-01 ✓, W5-02b ✓ | fR | fR/S3 | O·h | W5:236 |
| W5-22 | Konfliktvorhersage und Lane-Guard | M | offen | — | fR | fR/S3 | Cx·m | W5:258 |
| W5-28 | Automatischer Laufzeit-Beleg (Sandbox, Queue aus) | M | offen | — | fR | fR/S3 | Cx·m | W5:267 |
| W5-17 | Belegte Notizen mit Verfall | M | offen (st-Warteschlange) | W5-00 ✓ | st | st/S3 | O·h | W5:271 |
| W5-01b | Projektrahmen über die API | S | blockiert | W5-01a | api | api/S3 | O·h | W5:231 |
| W5-01c | Budget-Prüfung vor jedem Dispatch | S | blockiert | W5-01a, W5-05 | st | st/S3 | O·h | W5:232 |
| W5-02c | Integrator-Runner | M | blockiert | W5-02b ✓, W5-01a | fR (eigenes Modul) | fR/S3 | O·h | W5:235 |
| W5-04a | Not-Aus im Store | S | blockiert | W5-01a | st | st/S3 | O·h | W5:238 |
| W5-04b | Not-Aus in der App (10 s Frist) | S | blockiert | W5-04a | mn | mn/S3 | O·h | W5:239 |
| W5-04c | Not-Aus in `pa` | S | blockiert | W5-04a | pa | pa/S3 | O·h | W5:240 |
| W5-03 | Ereignis-Postfach | M | blockiert | W5-00 ✓, W4-03a | st | st/S3 | O·h | W5:237 |
| W5-06 | Entscheidungen im Store | M | blockiert | W5-05 | st | st/S3 | O·h | W5:245 |
| W5-06b | Entscheidungen über die API | S | blockiert | W5-06 | api | api/S3 | O·h | W5:246 |
| W5-07 | Tagesbriefing (8:00/18:00) und Sofortmeldung | S | blockiert | W5-06 | fR (digest.rs) | fR/S3 | KG·m | W5:247 |
| W5-09a | Abonnements im Store | S | blockiert | W5-03 | st | st/S3 | O·h | W5:253 |
| W5-09b | PR- und CI-Abos | M | blockiert | W5-09a | fR (gh.rs) | fR/S3 | Cx·m | W5:254 |
| W5-09c | Zeitplan-Auslöser | S | blockiert | W5-09a | fR | fR/S3 | KG·m | W5:255 |
| W5-10 | Nacharbeit an eigenen PRs | M | blockiert | W5-09b, W2-02 ✓, W5-02d | wk (workers.rs) | wk/S3 | Cx·m | W5:256 |
| W5-11 | Review-Reaktion | M | blockiert | W5-09b | fR | fR/S3 | Cx·m | W5:257 |
| DF-08d | Rest DF-08: native Modellbeobachtung, Adapter-/Profilbelege (Workflow-Teil nach DF-11) | M (g) | offen | DF-08c ✓ | fR (+st) | fR/S3 | Cx·m | P |
| DF-11 | Workflow-Zustand (persistente Stages, append-only Übergänge) | M | offen (st-Warteschlange) | DF-03 ✓ | CORE, st wahrscheinlich | st/S3 | O·h | P |
| DF-21 | Erweiterungskatalog (GitHub-Quellen auf feste Revision) | M | offen | DF-03 ✓ | CORE fR | fR/S3 | Cx·m | P |
| DF-33 | Vorlagenkatalog | M | offen | DF-03 ✓ | CORE fR (+st?) | fR/S3 | Cx·m | P |
| DF-12 | Unabhängigkeitsgate (Autor-Familienmenge) | M | blockiert | DF-08, DF-11 | CORE st | st/S3 | O·h | P |
| DF-13 | Berechtigungsteam (Policy auswerten) | M | blockiert | DF-01 ✓, DF-11 | CORE | fR/S3 | O·h | P |
| DF-14 | Stationsübergabe (Admission/Claims, Fencing) | M | blockiert | DF-12, DF-13 | CORE st | st/S3 | O·h | P |
| DF-15 | Rücklauf und Recovery (Rest nach DF-15a) | M | blockiert | DF-14 | CORE st | st/S3 | O·h | P |
| DF-15b | neu: Token-Reservierung und Delivery-Zeile für `exited_undelivered` freigeben (KI-27) | S (g) | blockiert: Produktentscheidung (gezählt unter „neu“, nicht DF) | DF-15a ✓ | st | st/S3 | O·h | R:df15_early_provider_exit, KNOWN_ISSUES KI-27 |
| DF-16 | Workflow-API | M | blockiert | DF-15 | api/HOST | api/S3 | O·h | P |
| DF-06b | Roadmap: Ausführungszustände | S (g) | blockiert | DF-11, DF-16 | hqS | hqS/S3 | KG·m | P |
| DF-10 | Chat-Modi und Interview; übernimmt HQ2-04 (beratende vs. aktive Sitzung, Providerwechsel mit Übergabe) | M | blockiert | DF-01 ✓, DF-03 ✓, DF-09b | CORE/SEAM/hqS/fe (teilen) | mn/S3 | O·h | P |
| DF-17 | Team-/Stationsgraph | M | blockiert | DF-02 ✓, DF-16 | hqS | hqS/S3 | KG·m | P |
| DF-18 | Entscheidungs-Inbox; übernimmt W5-08a/08b (Postfach in App und Cockpit, Abnahme: Screenshot hell/dunkel, Tastatur) | M | blockiert | DF-16, W5-06b | hqS/fe | hqS/S3 | KG·m | P, W5:248–249 |

## S4 — W5 Phase D–G, DF-Ausbau, HQ2-Mitte, W1/W3-Reste

| ID | Titel | Gr. | Status | Abhängig von | Lane / Dateien | Parallel-Gruppe | Modell | Quelle |
|---|---|---|---|---|---|---|---|---|
| W5-12 | Bilanz je Aufgabenklasse | M | blockiert | W5-05, W2-01 ✓, W5-02d | st | st/S4 | O·h | W5:262 |
| W5-13 | Schatten-Modus (N = 20) | M | blockiert | W5-03, W5-06, W5-12 | st | st/S4 | O·h | W5:263 |
| W5-15 | Kosten-/Zeitangebot | S | blockiert | W5-12 | fR | fR/S4 | KG·m | W5:265 |
| W5-16 | Selbst-Benchmark | S | blockiert | W4-01, W5-01c | ci | ci/S4 | Cx·m | W5:266 |
| W5-18 | HQ-Lessons in App-Worker | S | blockiert | W5-00 ✓, W5-17 | fR (learnings.rs) | fR/S4 | KG·m | W5:272 |
| W5-19 | Lesson → Gate-Vorschlag | M | blockiert | W5-06, W5-18 | fR | fR/S4 | Cx·m | W5:273 |
| W5-20 | Präferenzmodell | M | blockiert | W5-06 | fR | fR/S4 | Cx·m | W5:274 |
| W5-21 | Projektübergreifendes Wissen | M | blockiert | W5-17 | st | st/S4 | O·h | W5:275 |
| W5-23 | Selbstheilender DAG | M | blockiert | W5-22 | st | st/S4 | O·h | W5:279 |
| W5-24 | Pre-Mortem | S | blockiert | W5-11 | fR | fR/S4 | KG·m | W5:280 |
| W5-25 | Koordinator schneidet Pakete im Rahmen | M | blockiert | W5-01a, 01c, 12, 13, 22 | st | st/S4 | O·h | W5:281 |
| W5-30a | Runner-Fähigkeiten im Store | S | blockiert | W5-01a | st | st/S4 | O·h | W5:287 |
| W5-30b | Runner-Schicht (je Runner-Typ ein Kind) | M | blockiert | W5-30a, W5-01c | fR | fR/S4 | Cx·m | W5:288 |
| W5-31a | Runtime-Extraktion | M | blockiert | W5-04b | mn | mn/S4 | O·h | W5:289 |
| W5-31b | `pa daemon` Lebenszyklus (Single-Writer) | M | blockiert | W5-31a, W5-04c | pa | pa/S4 | O·h | W5:290 |
| W5-31c | App als Client | M | blockiert | W5-31b | mn | mn/S4 | O·h | W5:291 |
| W5-32 | Cloud-Runner (nur Abos, kein Geld) | M | blockiert | W5-30b, W5-09b, W5-02b ✓ | fR | fR/S4 | O·h | W5:292 |
| W5-33 | Budget-Routing und Kontingent-Arbitrage | M | blockiert | W2-03, W5-01c | st | st/S4 | O·h | W5:293 |
| W5-34 | Warum-Replay (30 Tage, max. 5 GB) | M | blockiert | W5-05 | fR | fR/S4 | O·h | W5:294 |
| DF-19 | Prioritäten und Advisor | M | blockiert | DF-08, DF-12, DF-03 ✓ | CORE fR | fR/S4 | Cx·m | P |
| DF-20 | Routing-Editor | M | blockiert | DF-19 | hqS/fe | hqS/S4 | KG·m | P |
| DF-22 | Installation und Rücknahme | M | blockiert | DF-13, DF-21 | CORE fR | fR/S4 | O·h | P |
| DF-23 | Katalog-Bedienung | M | blockiert | DF-22 | hqS/fe | hqS/S4 | KG·m | P |
| DF-24 | Task-Preflight | M | blockiert | DF-14, DF-22 | CORE (+st) | st/S4 | Cx·m | P |
| DF-25 | Schneller Entwurfsbereich (Worktree, Live-Preview) | M | blockiert | DF-13, DF-03 ✓ | CORE fR | fR/S4 | Cx·m | P |
| DF-26 | Stärkere Sandbox (Container/VM) | M | blockiert | DF-25 | CORE fR | fR/S4 | O·h | P |
| DF-27 | Architekturansicht | M | blockiert | DF-05 ✓, DF-25 | hqS | hqS/S4 | KG·m | P |
| DF-28 | Gemeinsames Design-Livebild | M | blockiert | DF-17, DF-25 | hqS/fe | hqS/S4 | KG·m | P |
| DF-29 | Messereignisse | M | blockiert | DF-11, DF-08 | CORE st | st/S4 | O·h | P |
| DF-30 | Statistikprojektionen; übernimmt W5-14 (Anbieter-Scorecards: unverifizierte Werte fließen nicht ein) | M | blockiert | DF-29, DF-24, W5-12 | CORE (+st) | st/S4 | Cx·m | P, W5:264 |
| DF-31 | Statistik-Cockpit | M | blockiert | DF-02 ✓, DF-30 | hqS/fe | hqS/S4 | KG·m | P |
| DF-32 | Releaseprognose | M | blockiert | DF-06, DF-30 | CORE/hqS (teilen) | fR/S4 | Cx·m | P |
| DF-34 | Vorlagen im Arbeitsfluss | M | blockiert | DF-10, 18, 23, 33 | hqS/fe | hqS/S4 | KG·m | P |
| HQ2-02 | Demo-/Studio-Abnahme (Inhalt über #70 gemergt) | M (g) | blockiert: Nutzer- und visuelle Prüfung | HQ2-01 ✓ | hqS | N/S4 | N | P |
| HQ2-03 | Gemeinsame Design-Tokens Hell/Dunkel | M | blockiert durch HQ2-02 | HQ2-02 | hqS/fe (neue Token-Dateien) | hqS/S4 | KG·m | P |
| HQ2-05b | Echte Collector-/Billing-Proben je Anbieter | M (g) | offen | HQ2-05a ✓ | fR + N | fR/S4 | Cx·m | P |
| HQ2-06 | Harness-Schema und Validierung | M | blockiert durch F-CORE-3-Rest (W1-03e/f) | W1-03e/f, F6 ✓ | wk (Profile/Capabilities) | wk/S4 | Cx·m | P |
| W1-03f | F-CORE-3 Baustein C: Zustell-Queue, `pa worker done/blocked` | M (g) | blockiert: Z-1-Protokoll am PC | W1-03e | wk + pa | wk/S4 | Cx·m | P, R:w1-03_c3 |
| W1-27 | neu: KI-20, doppelte ESC[6n-Antwort | S (g) | blockiert: Entscheidung (Naht Frontend ↔ pty.rs) | — | pty + fe | pty/S4 | KG·m | KNOWN_ISSUES KI-20 |
| W1-12 | Design-Reste (DiffView hell, Board-Karte, xterm-Farben) | S | blockiert: wartet auf Design-Sitzung | — | fe | fe/S4 | KG·m | P, R:w1-11 |
| W3-01 | Globaler DB-Wartungs-/Write-Lock + Drain (st-Kind, dann mn-Kind) | M | offen | — | st → mn | st/S4 | O·h | P |
| W3-02 | Windows-Recovery-Helper | M | offen | — | fR (Installer), PC | fR/S4 | Cx·m | P |
| W3-08 | Paketierter HQ-v1-Beleg | S | offen | W0-01 ✓ | N | N/S4 | KG·m | P |
| W4-01 | 20-Task-Benchmark | M | offen | — | fR (benchmark/, dev-benchmark.mjs) | fR/S4 | Cx·m | P |

## S5 — Qualität, Cockpit, Freischaltung, Abnahme, Release

| ID | Titel | Gr. | Status | Abhängig von | Lane / Dateien | Parallel-Gruppe | Modell | Quelle |
|---|---|---|---|---|---|---|---|---|
| W5-26 | Angriffs-Reviewer | M | blockiert | W5-11, W5-33 | fR | fR/S5 | Cx·m | W5:300 |
| W5-27 | Mutationstest-Gate (80 %) | M | blockiert | W5-33 | ci | ci/S5 | Cx·m | W5:301 |
| W5-29 | Anbieter-Wettbewerb (2/3 Anbieter) | M | blockiert | W5-33, W2-03 | fR | fR/S5 | Cx·m | W5:302 |
| W5-35a–f | Projekt-Cockpit (je M: Chat, DAG/Flotte, Abos/Budget, Vertrauen/Prüfpfad, Rahmen+Verdict, Not-Aus) | 6 × M | blockiert | #70 ✓, W2-10, W5-01b, W5-04a | hqS | hqS/S5 | KG·m | W5:306 |
| W5-02e | Agenten unter eigenem OS-Benutzer | M | offen (Nutzer legt Benutzer an) | W5-02b ✓, Nutzer ✓ | fR + N | fR/S5 | O·h | W5:312 |
| W5-36a | Vertrauensrampe im Store | M | blockiert | W4-03, W5-12, W5-02c, W5-04a | st | st/S5 | O·h | W5:313 |
| W5-36b | Check `pa/evidence` | M | blockiert | W5-02d, W2-02 ✓ | ci | ci/S5 | O·h | W5:314 |
| W5-37 | Stufe 1: Auto-Merge einfacher Klassen | S | blockiert | W5-36a/b, W5-02e, Nutzer | ci/st | st/S5 | O·h | W5:315 |
| W5-38 | Stufe 2: Frontend und nahtstellenfreier Rust | S | blockiert | W5-37, Nutzer | ci/st | st/S5 | O·h | W5:316 |
| W5-39 | Stufe 3: Nahtstellen | S | blockiert | W5-38, W5-29, Nutzer | ci/st | st/S5 | O·h | W5:317 |
| HQ2-07 | Session-Bridge und Routing-Policy (vor Dispatch in M-Kinder teilen) | L (g) | blockiert | DF-10 (statt HQ2-04), HQ2-05b, HQ2-06 | mehrere Rust-Lanes | st/mn/S5 | O·h | P |
| HQ2-08 | Dev-HQ als installierbarer lokaler Host (Host, API, UI seriell); übernimmt den installierten Offline-/Recovery-Build aus HQ2-10 | L (g) | blockiert | HQ2-03/07 | api + hqS | api/S5 | O·h | P |
| HQ2-09 | Projektstart, GitHub/Linear-Sync, Briefings (Statistik-Anteil → DF-29–31) | L (g) | blockiert | HQ2-07/08 | teilen | —/S5 | Cx·m / KG·m | P |
| DF-35 | Durchgängiger Runtime-Nachweis; übernimmt die Anbieter-Smokes aus HQ2-10 | M | blockiert | DF-20, 24, 26, 27, 28, 31, 32, 34 | Tests/doc | —/S5 | O·h | P |
| DF-36 | PC-Politur und Designabnahme; übernimmt die UI-/A11y-Abnahme aus HQ2-10 | M | blockiert | DF-35, DF-07d | hqS/fe | hqS/S5 | KG·m | P |
| DF-37 | Abschluss und Releaseentscheidung; übernimmt Review-Dispositionen und Release-Gates aus HQ2-10 | S | blockiert | DF-36 | doc | doc/S5 | KG·m | P |
| W3-03 | Paketierte Drills (Singleton, Crash/Power-Loss, Backup) | 3 × S | blockiert | W3-02 | N + Agent | N/S5 | N + KG·m | P |
| W3-04 | Updater-Zustände in App und HQ | S | blockiert | W3-02 | fe + hqL | fe/S5 | KG·m | P |
| W3-07 | Produktionsschlüssel-Build + Signed-Updater-Relaunch | S (g) | blockiert: Nutzer | — | N | N/S5 | N | P |
| W4-02 | Abnahmematrix final (27 Zeilen) | S | blockiert | W2/W3-Belege | doc | doc/S5 | KG·m | P |
| W4-03 | Continuous-Aktivierung | S | blockiert | W4-02, Nutzerfreigabe | mn | mn/S5 | O·h | P |
| W4-04 | Release v1.5.0 | S (g) | blockiert | W4-03, Nutzer | N | N/S5 | N + O·h | P |

---

## CI — Actions-Minuten sparen (Nutzerziel 24.09.)

Nutzervorgabe: möglichst wenige, dafür erfolgversprechende CI-Läufe. Entschieden: Mergify (kostenlos)
als Merge-Queue statt der `strict`-Kaskade; kein self-hosted Runner; volles prepush-Gate einmal vor
dem Öffnen des PRs; Dev Drive und Defender-Ausnahmen richtet der Nutzer ein.

| ID | Titel | Gr. | Status | Abhängig von | Lane / Dateien | Parallel-Gruppe | Modell | Quelle |
|---|---|---|---|---|---|---|---|---|
| CI-02 | Leichtes prepush für Branch-Pushes, volles Gate vor PR-Öffnung; enthält W1-19b (Dependabot-Commits im red-first-Gate, `ci.yml`-Kommentar nach W0-06) und den pre-push-Hook, der den Hauptcheckout statt des Worktrees prüft | S (g) | in Arbeit | CI-01 ✓ | ci (scripts/ci/gates.sh, .githooks, ci.yml) | ci/S0 | O·h | Nutzer 24.09., P (W1-19b) |

CI-01 ist erledigt (#108, `docs/ERLEDIGT.md`). Seither: Required Checks `gates (linux)`, `gates (windows)`,
`red-first` und `Mergify Merge Protections`; die Labels `do-not-merge`, `priority`, `conflict` sind angelegt.

## SETUP — Doku, Agenten-Setup, Automatisierung (Setup-Audit 24.09.)

Quelle: Setup-Audit-Plan des Koordinators vom 24.09. (Pakete SETUP-00 bis SETUP-15). SETUP-11 ist in
W5-02b6 aufgegangen. Erledigt (`docs/ERLEDIGT.md`): SETUP-A (#119, deckt SETUP-01/02/03/06/07 und laut
PR-Text auch SETUP-10 und SETUP-13), SETUP-05 (#114), SETUP-00 (ohne PR). Dateien, die hier einem Paket
gehören (`AGENTS.md`, `CLAUDE.md`, `README.md`, `PRODUCT.md`, `docs/setup/**`, `.github/**`,
`.mergify.yml`), fasst kein anderes Paket an.

| ID | Titel | Gr. | Status | Abhängig von | Lane / Dateien | Parallel-Gruppe | Modell | Quelle |
|---|---|---|---|---|---|---|---|---|
| SETUP-B | Dev-Skripte: Git-/PR-Helfer (SETUP-08a: report-commit, push-verified, prune-worktrees, build-slot, ci-watch) und Plan-/Spec-Helfer (SETUP-08b: pr-status, erledigt-row, spec-close, hygiene), je mit Selbsttests | 2 × M | in Arbeit (SETUP-08a: PR #126 offen; SETUP-08b folgt) | Plan-Dokumente ✓ | scripts/dev, scripts/lib | doc/S0 | O·h | Setup-Audit §5 |
| SETUP-04 | AGENTS.md: Mergify-Block, Reviews/Advisors, PR-/CI-Minuten-Regeln, Setup-Links, Build-Slots; dazu dieser Plan-Nachtrag | M | in Arbeit | CI-01 ✓, Plan-Dokumente ✓, SETUP-A ✓ | doc (AGENTS.md, Plan-Dokumente) | doc/S0 | O·h | Setup-Audit §1.1, §4 |
| SETUP-09 | Lokaler Review-Lauf `scripts/review/run-local.sh` (Kimi K3 + GLM 5.2); `review.yml` ist schon als ruhend markiert (SETUP-A) | S | offen | — | scripts/review | doc/S1 | O·h | Setup-Audit §5 |
| SETUP-12 | Docs-only-Pfadfilter mit Required-Check-Erfüllung, `push: main` reduzieren (CI-01-Folgearbeiten 1 und 2) | M | offen (ci-Lane nach CI-02) | CI-01 ✓ | ci | ci/S2 | O·h | Setup-Audit §5, R:ci-01 |
| SETUP-14 | Nutzer: tote Keys entfernen, OpenCode-Modelle, KI-21-Hook-Status, `ollama signin`, Permission-Regeln aus `docs/setup/permissions-proposal.md` | S | offen (Nutzer) | SETUP-A ✓ | N | N/S2 | N | Setup-Audit §5 |
| SETUP-15 | Abschlussreview aller Setup-Dokumente und Skripte, Fix-Runde, Verifier | M | blockiert | alle SETUP-Pakete | doc | doc/S5 | Fable 5.1 + GPT-6 Astra | Setup-Audit §5 |

## Worker-Struktur

- **Build-Slots:** vier Cargo-Targets (Hauptcheckout-`target/`, `%USERPROFILE%/cargo-targets/projecta-a`, `-b`, `-c`).
  Der Rechner hat 16 GB RAM, deshalb **höchstens drei Cargo-Builds gleichzeitig**, freier RAM vor jedem Lauf
  prüfen. `CARGO_PROFILE_*` nie setzen, das invalidiert den Cache. Regeln: `AGENTS.md` („Build slots“).
- **Gleichzeitig:** Die Zahl der Implementer ist nicht begrenzt (Nutzer 24.09.: die alte Obergrenze „vier
  Implementer“ ist aufgehoben). Begrenzt sind nur die Cargo-Builds (Slots, RAM) und die seriellen Lanes;
  Pakete ohne Cargo (fe, hqL, hqS, ci, doc) laufen daneben. PLAN §4 verweist hierher.
  Reviewer laufen über Ollama Cloud ohne lokalen Build.
- **Serielle Lanes (je ein aktives Paket):** st, api, mn, pa. Dazu die Datei-Lanes pty, wk,
  sup (supervisor.rs läuft mit mn, wegen W2-06), ci, hqS (FIFO-Integrator, PLAN „Planreview-Disposition“) und hqL (hq.js).
  `docs/PLAN.md`, `STAND.md`, `MASTERPLAN.md` und `ERLEDIGT.md` schreibt nur der Koordinator oder das
  Paket, dem er sie ausdrücklich zuweist.
- **st ist der Engpass** (etwa 35 Pakete). Vorgeschlagene Reihenfolge:
  W2-03 (in Arbeit) → W5-05 → W5-01a → W1-05b(st) → W2-02b → W2-04c → W2-04d → W2-04g (optional) → W5-01c →
  W5-04a → DF-11 → W5-17 → DF-12 → W5-03 → W5-06 → W5-09a → DF-14 → DF-15 → DF-15b → W5-12 → W5-13 →
  W5-30a → W5-21 → W5-23 → W5-25 → DF-24 → DF-29 → DF-30 → W5-33 → W3-01(st) → W5-36a.
  Vorschlag zur Entscheidung: eine ADR, die st für unabhängige `store/`-Module teilt (PLAN §5 Nr. 17).
- **mn:** W2-06 (in Arbeit) → W4-03a → W1-09c(mn) → W5-04b → W3-01(mn) → W5-31a → W5-31c → W4-03.
- **api:** W2-01b (#124, Queue) → W2-07b → W1-05b(api) → W2-04f → W5-02b3(api) → W5-01b → W5-06b → DF-16 → HQ2-08(API).
- **pa:** W2-01d → W5-04c → W5-31b (W1-03f anteilig).
- **pty:** W1-15c (in Arbeit) → W1-01b → W5-02b4 → W1-27.
- **wk:** W5-02a → W5-00b → W2-09b → W1-03e → W2-04e → W5-10 → HQ2-06 → W1-03f.
- **hqL:** W1-10 → W5-02b7 → W2-10 → W1-17.
- **ci:** CI-02 (in Arbeit, mit W1-19b) → SETUP-12.
- **doc:** SETUP-B und SETUP-04 (beide in Arbeit, disjunkte Dateien) → SETUP-15.
- **Migrationen:** 22 ist mit DF-15a (#103) vergeben. Jede weitere Migration (W5-01a, W5-05 …)
  bekommt ihre Nummer erst beim Dispatch vom Koordinator.

## Offene Folgearbeiten ohne Paket in PLAN/W5-Plan (neu vorgeschlagen, 27 Pakete, 37 Punkte)

Dazu kommen CI-02 (1 Punkt offen) und die offenen SETUP-Pakete (17 Punkte) aus den Tabellen oben.
Erledigt sind W2-04b, W1-24c und W5-02b6 (`docs/ERLEDIGT.md`). Quelle jedes Pakets ist der genannte Report.

| Neu-ID | Inhalt | Gr. | Lane | Quelle |
|---|---|---|---|---|
| W2-01b | Review-Route: `reviewerRunId` aus dem Credential | S | api | R:w2-01 Folge 1 |
| W2-01c | `approvalAuthority` in agent_access.rs:355 angleichen | S | fR | R:w2-01 Folge 2 |
| W2-01d | CLI-Befehl `pa hq agent review` | S | pa | PR #124 |
| W2-02b | Gleichstand in derselben Sekunde, vertrauenswürdige Testquelle, Merge-Ergebnis als Kandidat | M | st | PR #96, R:w2-02 |
| W2-04c | Rollenbewusste Routen/Credentials beim Launch | M | st | R:w2-04 3 |
| W2-04d | Rollen → Budget-Zwecke | S | st | R:w2-04 4 |
| W2-04e | `dispatch.role` im Briefing | S | wk | R:w2-04 5 |
| W2-04f | Planungsendpunkte nur für den Koordinator | S | api | R:w2-04 6 |
| W2-04g | optional: Versionsspalte für die Attestierungsregel (KD1) | S | st | R:w2-04b Folge 2 |
| W2-07b | Windows-ACL für `projecta-api.json` und `agent-access/`, Eigentümer prüfen | S | api/fR | R:w2-07 §5 |
| DF-15b | Reservierung/Delivery für `exited_undelivered` freigeben (Produktfrage, KI-27) | S | st | R:df15_early_provider_exit |
| W5-00b | Fremden Text in workers.rs-Prompts suchen und einhüllen | S | wk | R:w5-00 |
| W5-02b3 | Env-Stufe als globale Einstellung mit UI (drei Kinder) | M | st → api → fe | R:w5-02b |
| W5-02b4 | Push in den Runner-Host, danach `strict` als Default | M | pty + wk | R:w5-02b, PR #102 |
| W5-02b5 | `http.extraHeader`-Reset-Test; GPG unter strict | S | fR | R:w5-02b |
| W5-02b7 | HQ-Profilansicht zeigt `envPolicy` | S | hqL | PR #121 |
| W1-01b | Kimi-Re-Smoke mit PTY-Trace | S | pty | PR #101 |
| W1-09c | KI-1 editierbar (Setter, Command, Feld) | M | st → mn → fe | R:w1-09b, PR #99 |
| W1-15c | Übrige pty.rs-Mutex-Stellen, `api/agent_access.rs:266` | S | pty | R:w1-15b |
| W1-18b | `.agents/skills`-Probe für Codex/OpenCode | S | wk + N | R:w1-18 |
| W1-21c | xterm-`pageerror` beim Mount | S | fe | R:w1-21b |
| W1-21d | Suchschalter Groß/Klein und Regex | S | fe | R:w1-21, R:w1-21b |
| W1-23c | „-0 Tokens“; MSRV-Messung | S | fR | R:w1-23b |
| W1-27 | KI-20 ESC[6n-Doppelantwort (braucht Entscheidung) | S | pty + fe | KNOWN_ISSUES KI-20 |
| W1-29 | Linux-Flake Prozessgruppen-Test | S | fR | KNOWN_ISSUES KI-25 |
| W1-30 | Flake `omniroute::…management_failures_keep_their_http_and_network_classes` | S | fR | R:w1-22 |
| W4-03a | Journal-Teil von W4-03 ohne Aktivierung (in PLAN als Vorschlag geführt) | S | mn | W5:53/321 |

Kein Paket, nur Daueraufgabe oder Nutzer:
- `SINGLE_VENDOR_PROVIDERS` pflegen (R:w2-01 Folge 5).
- KNOWN_ISSUES KI-24 (SQLite-Lastklasse) und KI-26 (Windows-PTY-Argumenttest) beobachten.
- Idempotenz des Mergify-Konfliktkommentars beim ersten echten Konflikt beobachten (R:ci-01, kimi F6).
- **Nutzer:** Secrets aus Repo-Ebene in geschützte Environments verlegen; Required Reviewers für
  `release`/`review` eintragen; Release-Frage für die Arbeit nach 1.4.1 (PLAN §5 Nr. 14–15);
  `MERGIFY_TOKEN` und CI Insights im Mergify-Dashboard (R:ci-01 „Nutzer-Schritte“).

## Hygiene-Befunde

Erledigt: STAND.md neu geschnitten, neun Specs auf `historisch`, KNOWN_ISSUES v1.4.1 mit KI-24 bis KI-29
(alles #114); die Doppelungen zwischen den Plänen sind als Aliase entschieden (Abschnitt oben); DF-07d
bleibt offen bis zum visuellen PASS; Folgepakete brauchen keine Spec; `task_w1-19.md` ist `historisch`
(W1-19b in CI-02 aufgegangen); PR #105 ist geschlossen, #107 gemergt.

Offen:

1. **PR #70** zeigt „closed“, sein Inhalt ist aber als `fef9eaa` („Merge pull request #70“) auf main.
   Der Branch `codex/dev-hq-unified-141` (Kopf `50192b8`) ist tot und kann gelöscht werden.
2. **pre-push-Hook prüft den Hauptcheckout:** Wegen `core.hooksPath` fährt der Hook die Gates im
   Hauptcheckout statt im Worktree, der gepusht wird; ein rotes Gate dort (z. B. veraltetes
   `node_modules`) blockiert jeden Push. Nicht umgehen (kein `--no-verify`, kein `-c core.hooksPath`);
   Behebung in CI-02.
3. **PLAN-Pakete ohne Spec:** W2-03, W2-06 und W2-08a sind Pakete aus PLAN (keine Folgepakete) und laufen
   ohne `.pa/task_<id>.md` (PLAN §0.6). Ein eigener W1-19-Report fehlt weiter.
4. **Remote-Branches zum Löschen** (der Nutzer muss das tun, Auto-Mode blockiert es; seit 24.09. löscht
   GitHub gemergte Head-Branches selbst):
   - rund 45 gemergte Branches aus der Zeit davor (`claude/w1-*`, `claude/w2-*`, `kimi/*`, `codex/continuous-devhq` …);
   - geschlossen bzw. ersetzt: `claude/w1-13-api-reste` (#58 → #64), `claude/w1-03c-guard-hardening`
     (#81 → #88, 1 Commit vor main, erst prüfen), `codex/dev-hq-unified-141`;
   - alte Vor-Squash-Branches vom 02.–08.09.: `pa/p2f-lint-2026-09-02`, `gt/refinery/7411a522`,
     `docs/readme-redesign`, `cursor/*` (4), `rev9-f8-golden-updater`, `fix/pr26-review`,
     `chore/salvage-leftover-prs`, `cuarroc-dev-hq-usability`.
   - **Zu prüfen:** `claude/w1-16-claim-recovery` hat nach dem Merge von #82 einen Commit,
     der nicht auf main ist.
5. **Offene PRs:** #124 (W2-01b) in der Merge-Queue, #126 (SETUP-08a) und #109 (Dependabot,
   github-actions) sowie #111 (npm).
6. **Lokal:** Im Koordinations-Worktree liegen ungetrackte `MEMORY.md` und `$OUT`.

## Nächste Schritte (Top 5, sobald Slots frei sind)

1. **Queue abarbeiten lassen:** #124 (W2-01b) und #126 (SETUP-08a), danach W2-01d (pa). **W5-02b7**
   (hqL, S, kein Cargo) und
   **W5-02a** (wk) sind seit dem Merge von #121 frei.
2. **Laufende Pakete abschließen:** W2-03 (st), W2-06 (mn), W2-08a (fR), W1-15c (pty), CI-02 (ci), SETUP-B, SETUP-04.
3. **DF-07d:** Screenshots der React-Dichte ansehen und den visuellen PASS festhalten (kein Cargo).
4. **Nach W2-01b:** W2-07b (api).
5. **W1-30** (fR, S): omniroute-Flake klären, bevor er Queue-Läufe rot färbt.

Nebenläufig ohne Build-Slot (KG·m): W1-10, W1-21c, DF-09b, SETUP-09.
