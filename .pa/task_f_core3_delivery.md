# F-CORE-3: Zustellung an Agenten vereinheitlichen

Status: aktiv

Revision 3 nach dem Delta-Review (`.pa/review_fcore3_delta.md`, Urteil „erneut
überarbeiten — aber knapp daneben", R-1 bis R-11). Rev 2 folgte dem
Drei-Anbieter-Review (Disposition `.pa/review_fcore3_disposition.md`).

Quellen: `docs/audits/2026-09-03-analyse-claude-web/befunde/kern-nebenlaeufigkeit.md`
(F-CORE-3, Zeilen 58-81), `docs/SANIERUNGSPLAN.md` §1 Lücke 1 (Zeilen 99-111),
`docs/decisions.md` 2026-09-03 (NT-17-Nachlauf, Zeilen **294-297** — nach dem
09-09-Eintrag nachgemessen).

**Revision 4 (09.09., Aktivierung):** Baustein A und B.1 sind gemergt
(`fix/f-core-3`, Merge auf main nach Dual-Review `.pa/review_fcore3_fix_a/b.md`,
Disposition `.pa/review_fcore3_fix_disposition.md`; Umsetzungsberichte
`.pa/report_f_core3_delivery.md` und `.pa/report_fcore3_fixes.md`).
Aktiviert durch die Koordinations-Session (Owner bis zur B.2-Vergabe).
Präzisierung zur Readiness-Marker-Regel aus dem C-1-Fix, siehe A.1.

## Owner und Lane

- Paket **F-CORE-3**, schließt SANIERUNGSPLAN §1 **Lücke 1** (Zustellung an den
  Agenten, NT-17-Nachlauf, vom Nutzer am 03.09. priorisiert).
- Owner wird bei Aktivierung benannt. Aktivierung (`Status: aktiv`) erfordert
  einen Eintrag in der Spec-Tabelle in `STAND.md` — `scripts/lib/active-specs.mjs`
  lässt `aktiv` ohne Listung nicht durch.
- Lane-Matrix für die nachgelagerten Fenster (STAND.md §3):
  - **`main.rs` ist seriell**: `f1_single_instance` → `f1_diagnostics` →
    `f4_review_ui`. Das F-CORE-3-`main.rs`-Fenster kommt **danach** — es hängt
    **nicht** an f4_authority.
  - **`bin/pa.rs`** hängt an **f4_authority** (seriell `api.rs` dann `pa.rs`);
    SHA folgt, sobald diese Welle committet ist.
  - **`workers.rs`** gehört zu **f4_guard** (keine Nahtstelle, nach Readiness).

## Ziel

Die zwei Schreibpfade zum Agenten bekommen eine gemeinsame, belegbare
Zustellgarantie:

1. der echo-verifizierte Submit-Guard (`start_task_delivery`), und
2. der blinde `{text}\r`-Write für `pa worker send` (`main.rs:1990-1992`,
   `send_to_worker`) und Fragen-Antworten (`questions.rs:325`).

Zitat-Drift-Korrektur (aus Rev 2 übernommen): `send_to_orchestrator` ist
**kein** blinder Pfad — er liefert bereits über den Guard aus
(`workers.rs:548`, „Guarded delivery, not a blind write"). Die Audit-Angabe
`workers.rs:521-522` zeigt heute auf `Some(worker) => worker.clone()`.
`bin/pa.rs:330` ist ein reiner HTTP-Client und enthält keinen Schreibpfad.

## Baustein A: Guard-Härtung (sofort, ohne jedes nachgelagerte Fenster)

Dateien exklusiv: `src-tauri/src/submit_guard.rs`, `src-tauri/src/pty.rs`,
`src-tauri/src/profiles.rs`. Baustein A ist vollständig in diesen drei Dateien
ausführbar; alles, was `main.rs`/`workers.rs`/`bin/pa.rs` berührt, liegt in
Baustein B/C.

### Die vier Löcher, je mit rotem Test

1. **Echo-Suche im gesamten 32-KiB-Tail** (`submit_guard.rs:358-360`): das
   24-Zeichen-Fragment eines früheren Textes steht bei wiederholten Writes
   bereits im Tail → falsches „Echo".
   Roter Test T1:
   `submit_guard::tests::an_echo_that_was_already_in_the_tail_before_the_write_does_not_count`
   — Fragment schon in IdleWatching im Tail; nach `WriteTask{1}` derselbe Tail
   ohne neue Bytes → exakt `tick == None` **und**
   `guard.state() == SubmitState::AwaitingEcho`. **Heute rot** (liefert
   `SendEnter{0}`, `submit_guard.rs:205-212`).

2. **Das bestätigte Zustell-Signal feuert auf irgendein Byte**
   (`submit_guard.rs:312-316`): Cursor-Blink, Spinner, Statuszeilen-Uhr
   erfüllen `output_bytes > bytes_at_enter` innerhalb von 100 ms.
   Roter Test T2:
   `submit_guard::tests::a_status_bar_redraw_after_the_enter_is_not_delivery`
   — Profil **mit** Antwort-Marker; nach `SendEnter{0}` Tail unverändert bis
   auf Spinner-Zeichen, `output_bytes+3` → Assertion: der Guard liefert **kein**
   `SubmitAction::ConfirmDelivery` und `guard.is_confirmed()` bleibt `false`
   (der interne Byte-Fortschritt darf weitergehen). `ConfirmDelivery`/
   `is_confirmed()` sind die benannte neue Guard-API aus Fix A.2 und existieren
   heute nicht — der Test ist daher **build-rot** (zweite Wahl nach der Regel;
   eine laufzeit-rote Fassung ist hier nicht konstruierbar, weil Variante A den
   internen `Delivered`-Zustand bewusst unverändert lässt und Events erst in
   `pty.rs`/`main.rs` entstehen).

3. **Der 30-s-Fallback umgeht den NT-17-Marker** (`submit_guard.rs:241-257`):
   `ready = marker_seen || gave_up_waiting` schreibt nach 30 s Stille blind.
   Roter Test T3:
   `submit_guard::tests::a_configured_marker_is_not_overridden_by_the_thirty_second_give_up`
   — Marker konfiguriert, 31 s **Stille** ohne Marker (letzter Output ≥
   `READY_IDLE_AFTER` zurück) → exakt `tick == Some(SubmitAction::Escalate)`
   **und** `guard.state() == SubmitState::Escalated`. **Heute rot** (liefert
   `WriteTask{1}`, `submit_guard.rs:251-255`).

4. **Der Readiness-Marker hat dasselbe Volltail-Loch**
   (`submit_guard.rs:249-250`): „Ask anything" aus dem ersten Prompt steht in
   der Historie einer laufenden OpenCode-Session → `marker_seen` sofort wahr →
   `WriteTask{1}` in eine besetzte Eingabe. NT-17 durch die Hintertür.
   Roter Test T4:
   `submit_guard::tests::a_readiness_marker_left_over_from_a_previous_prompt_does_not_arm_the_write`
   — Marker steht seit einem früheren Prompt im Tail, **kein** Marker nach der
   Write-Baseline → exakt `tick == None` **und**
   `guard.state() == SubmitState::IdleWatching`. **Heute rot** (`marker_seen`
   matcht den Volltail, `submit_guard.rs:249-250`).

### Fix-Richtung A

1. **Baseline-Mechanik (festgenagelt):** `Scrollback` (`pty.rs:69-71`) um
   `total_pushed: u64` erweitern; der Guard-Snapshot liefert `(tail, abs_pos)`
   unter **einem** Lock, und `Observation.output_bytes` wird aus demselben
   Schnappschuss gespeist statt aus dem separaten `AtomicU64` — die
   Reader-Reihenfolge `pty.rs:676-679` (erst Ring, dann Zähler) ist sonst nicht
   atomar gegen den Guard-Thread (`pty.rs:495-501`, bis zu einem
   8-KiB-`READ_CHUNK`-Fenster). `pty.rs` merkt im Write-Zweig von
   `start_submit_guard` (nicht beim Tick) die monotone Marke **pro
   Write-Versuch** (auch bei Rewrite 2/3 neu) und baut pro Tick ein bereits
   normalisiertes Feld `tail_since_write: &str` (char-boundary-sicherer Slice,
   partielle UTF-8 am Rand wie `tail_lossy` behandeln). Der Guard bleibt
   PTY-frei. Die Baseline gilt für **alle drei** Tail-Suchen: Echo,
   Readiness-Marker, Antwort-Marker. Die Vorkommen-Zähl-Alternative ist
   gestrichen (gleitendes Fenster).
   **Präzisierung (Rev 4, C-1-Fix):** für den Readiness-Marker gilt zusätzlich
   die Ruheregel — steht der Marker im Endfenster des sichtbaren Schirms
   (letzte `MARKER_SCREEN_CHARS` = 2048 Zeichen) und ist die Sitzung seit
   ≥ `READY_IDLE_AFTER` still, gilt sie als bereit. Sie deckt den ruhenden
   Fall, den die Baseline sonst nie freigibt (eine ruhende TUI gibt den
   Marker nicht neu aus); der arbeitende Agent bleibt über T4 geschützt
   (frischer Output sperrt die Regel). Echo- und Antwort-Marker bleiben
   strikt baseline-gebunden. Beleg: Rot-/Grün-Tests in
   `.pa/report_fcore3_fixes.md`.
2. **Delivered-Semantik (Variante A) mit benannter neuer Guard-API:** der
   Zustand `Delivered` bleibt **Byte-basiert als internes Fortschrittssignal**.
   Neu: der Guard führt das bestätigte Zustell-Signal als eigenes
   `SubmitAction::ConfirmDelivery` (plus Prädikat `is_confirmed()`) — es feuert
   nur, wenn der Antwort-Marker **nach** der Write-Baseline im
   `tail_since_write` erscheint. Antwort-Marker werden als `caps`-Feld pro
   Profil geführt (wie `readiness_marker`; `profiles.rs`; Marker aus echten
   Captures belegen, nicht erfinden). **Profile ohne konfigurierten
   Antwort-Marker behalten bit-exakt das heutige Verhalten** — inklusive des
   heutigen Ablaufs, der in `pty.rs` zum `Delivered`-Event führt.
3. **Retry-Uhr und Zustellbeweis trennen:** `submit_guard.rs:312-332` füttert
   heute beides aus derselben Bedingung. Neu: ein Lebenszeichen (Byte-Anstieg)
   setzt die Retry-Frist zurück — wie `AwaitingEcho` es mit `ECHO_BUSY_CAP`
   bereits macht —, der Inhaltsbeweis läuft separat über die neue API aus A.2.
   Roter Test T6:
   `submit_guard::tests::a_working_agent_without_an_answer_marker_is_not_typed_into`
   — Marker-Profil; nach dem Enter fließt Output über alle `RETRY_BACKOFF`-
   Fenster hinweg, der Antwort-Marker erscheint nicht → Assertion: kein
   `SendEnter`, `guard.is_confirmed() == false`, Zustand nicht `Escalated`
   (der Guard wartet bis zur Kappe aus A.5). Referenziert die neue API aus A.2
   → **build-rot** (zweite Wahl, benannt; laufzeit-rot ist nicht konstruierbar,
   weil der heutige Code bei fließendem Output sofort `Delivered` setzt und
   `None` liefert — genau das Verhalten, das die Trennung ersetzt).
4. **Escalate nur bei Stille am Fristende; die Frist gleitet bei Output.**
   Bei fließendem Output gleitet die Marker-Frist wie `ECHO_BUSY_CAP`; erst
   Stille am Fristende eskaliert. Roter Test T5:
   `submit_guard::tests::a_busy_marker_tui_is_not_escalated_while_output_flows`
   — Marker konfiguriert, `READY_MAX_WAIT` überschritten, aber Output fließt
   (letzter Output jünger als `READY_IDLE_AFTER`), kein Marker nach der
   Baseline → exakt `tick == None` **und**
   `guard.state() == SubmitState::IdleWatching` (Frist gleitet, kein
   `WriteTask`, kein `Escalate`). **Heute rot**: `submit_guard.rs:251-255`
   liefert bei `gave_up_waiting` `WriteTask{1}` und geht nach `AwaitingEcho` —
   beide Assertionen schlagen fehl.
5. **Abbruchbedingungen benennen (keine neuen Warte-Loops ohne Kappe):**
   - Die gleitende Readiness-Marker-Frist ist nach oben gekappt:
     **`MARKER_BUSY_CAP`** (neue Konstante, Größenordnung `ECHO_BUSY_CAP` =
     120 s). Läuft sie bei dauerhaft fließendem Output ab, ohne dass der
     Marker kam → `Escalate` (kein Deadlock für Profile, deren UI sich
     geändert hat).
   - Die Antwort-Marker-Wartephase aus A.2/A.3 ist gekappt:
     **`ANSWER_MARKER_CAP`** (neue Konstante, Größenordnung 10 min nach dem
     Enter). Ohne Marker bis dahin → `Escalate` mit eigenem Grund (Task wurde
     geschrieben und ge-echot, aber keine Antwort bestätigt). Ohne diese
     Kappe kehrt der Guard-Thread nie zurück (`pty.rs:538-543` endet nur bei
     `is_done()`).
6. **Gestrichen gegenüber Rev 1:** die Bedingung „Fragment verschwunden aus
   der Input-Box" (Prompt-Spiegel-Falle: der abgeschickte Prompt wandert als
   Transkript-Zeile weiter) und der `UserPromptSubmit`-Hook-Weg (unverdrahtbar
   spezifiziert). Der Beweis steht allein auf dem positionierten Marker nach
   der Baseline.
7. **Degenerate-Case leerer/Whitespace-Task:** `fragment.is_empty()`
   deaktiviert heute den Echo-Check
   (`a_whitespace_only_task_disables_the_echo_check`, `submit_guard.rs:856-868`).
   Neu: bei leerem Task zählt nur der Marker; ohne konfigurierten Marker gilt
   die heutige Regel unverändert.

### Bewusst anzupassende bestehende Tests (namentlich)

Nach der Regel „Hilfsfunktion im Status quo" (decisions.md 03.09.): die
`obs()`-Hilfsfunktion (`submit_guard.rs:480-493`) darf das neue Pflichtfeld
(`tail_since_write`) mit Default befüllen — ein kompilierender roter Test ist
dadurch nicht „kaputt". Drei Tests werden angefasst:

- `output_after_the_enter_marks_the_task_delivered` (`submit_guard.rs:658`) —
  läuft auf dem unmarkierten Default-Profil, dessen Verhalten bit-exakt
  bleibt; die **Assertion bleibt unverändert grün**. Angepasst wird nur die
  Benennung/Kommentierung: `Delivered` ist internes Fortschrittssignal, keine
  Zustellbestätigung. Kein roter Zwischenschritt nötig; im Report als
  „Klarstellung, Assertion unverändert" geführt.
- `a_dialog_marker_in_agent_output_after_the_enter_is_not_answered`
  (`submit_guard.rs:871-888`, trägt den Vermerk „Review-Auflage") — die
  ursprüngliche Aussage bleibt wörtlich erhalten: ein Dialog-Marker in
  Agentenausgabe löst keine Tastenanschläge aus. Angepasst wird nur die
  Klarstellung, dass `is_delivered()` interner Fortschritt ist; der
  Assertionskern bleibt.
- `a_marked_tui_that_never_shows_the_marker_falls_back_to_the_max_wait`
  (`submit_guard.rs:546-558`) — **wird ersetzt, nicht geflickt.** Die alte
  Fixture (letzter Output bei 29 s, Tick bei 30 s) ist unter der gleitenden
  Frist aus A.4 kein Stille-Fall, und eine Stille-Variante würde T3
  doppeln. Der ursprüngliche Gegenstand — kein Deadlock für Marker-Profile,
  deren UI sich geändert hat — wird von der `MARKER_BUSY_CAP`-Kappe aus A.5
  übernommen. Neuer Test:
  `submit_guard::tests::a_marked_tui_that_stays_busy_past_the_marker_cap_escalates`
  — Marker konfiguriert, Output fließt durchgehend (Frist gleitet), Marker
  kommt nie, `MARKER_BUSY_CAP` überschritten → exakt
  `tick == Some(SubmitAction::Escalate)` **und**
  `guard.state() == SubmitState::Escalated`. **Heute rot**: der heutige Code
  schreibt bei t=30 (`gave_up_waiting`) `WriteTask{1}` — die Sequenz divergiert
  ab der ersten Assertion bei t=30.

## Baustein B: blinde Pfade durch den Guard führen + Auffangnetz

Drei Unterfenster, je an ihrer Lane:

- **B.1 `questions.rs` (frei, sofort):** die Fragen-Antwort
  (`questions.rs:325`) stellt über `start_task_delivery` zu statt über den
  direkten `write("{answer}\r")`; die `MSG_USER`-Logzeile wandert hinter die
  bewiesene Zustellung. Roter Test T7:
  `questions::tests::an_answer_is_delivered_through_the_guard` — mit dem
  vorhandenen `AgentControl`-Doppelgänger `Typist` (`questions.rs:423-450`)
  konstruierbar: Assertion, dass der Pfad `start_task_delivery` mit dem
  Profil-Marker aufruft und **kein** rohes `write("{answer}\r")` mehr beim
  Typist ankommt. **Heute rot** (der Typist sieht genau den blinden Write).
- **B.2 `main.rs`-Fenster (serielle `main.rs`-Lane: nach
  `f1_single_instance` → `f1_diagnostics` → `f4_review_ui`, STAND.md §3 —
  nicht f4_authority):**
  - `send_to_worker` (`main.rs:1990-1992`) stellt über den Guard zu. Da
    `send_to_worker` am `ApiBackend { app: AppHandle, … }`
    (`main.rs:1911-1917`) hängt und `main::tests` nur reine Funktionen prüft,
    wird der Schreibschritt hinter die bestehende `AgentControl`-Naht gezogen
    (Vorbild `Typist`, `questions.rs:423-450`): eine AppHandle-freie Funktion
    nimmt `&dyn AgentControl` und ruft `start_task_delivery`; der Test läuft
    gegen diese Naht.
  - Roter Test T8:
    `main::tests::send_to_worker_contains_no_blind_write` — Quellscan-Test
    nach dem Vorbild des `proc.rs`-Quellscans: `send_to_worker` darf kein
    `write(&session_id, &format!("{text}\r"))` mehr enthalten. **Heute rot**
    (die Zeile steht wörtlich in `main.rs:1992`). Ergänzend der Verhaltens-Test
    an der neuen Naht (Typist-Muster).
  - Event-Texte (`main.rs:383-389`): „task delivery confirmed" wird nur noch
    bei `ConfirmDelivery` (A.2) emittiert; die Marker-Eskalation meldet den
    neuen Text **„readiness marker never appeared; task not written"**;
    die Antwort-Marker-Kappe (A.5) bekommt einen eigenen, davon
    unterscheidbaren Text.
  - Auffangnetz (aus Rev-2-A.5 hierher verschoben): bei Eskalation wird der
    unzugestellte Text über das **bestehende** `insert_message` als Nachricht
    mit konkretem nächstem Schritt persistiert („Text X wurde nicht
    zugestellt; im Terminal Y nachreichen") — kein `store.rs`-Umbau nötig
    (`store.rs` bleibt Tabu). Der Attention-Inbox-Teil bleibt bei Lane F3.
  - **Mitgelegt (Rev 4, aus dem Dual-Review `.pa/review_api_stats_r1/r2.md`
    verbindlich):** der dritte Geschwister des stats-range-Textbefunds —
    `main.rs:1299` sendet denselben lügenden Fehlertext (`unknown range …
    today, week, month or all` ohne 7d/30d) und der Doc-Kommentar
    `main.rs:1277` unterschlägt die Aliase. Fix mit derselben
    Doppelassertion wie `api.rs` (Text nennt Aliase + Alias wird
    akzeptiert), roter Test zuerst.
- **B.3 `workers.rs:549` (Lane f4_guard, Koordinationsnotiz — keine eigene
  Datei dieser Spec):** `log_message` als `MSG_USER` darf erst nach bewiesener
  Zustellung geschrieben werden. Wird im f4_guard-Fenster abgestimmt, nicht
  von dieser Spec angefasst.

## Baustein C: Zustell-Queue mit `pa worker done|blocked` (nachgelagert)

Zweiter Baustein der 03.09.-Decision. Ausdrückliche Kopplung an Z-1: **der
Umfang der Queue wird erst nach dem Z-1-Experiment festgenagelt.** Eigene
Zurücknahmebedingung der Decision, wörtlich (decisions.md:294-297):
„Zurücknehmen: wenn Z-1 zeigt, dass der Marker-Fix allein 20/20 trifft (dann
Queue kleiner, Selbstmeldung bleibt)."

`bin/pa.rs` gehört zur Lane **f4_authority** — diese Datei erst nach deren
Commit (SHA folgt).

### Z-1-Protokoll (festgenagelt)

- 20 × `pa orchestrator send` gegen das Profil **`opencode`**
  (`profiles.rs:183-191`) — **nicht** `opencode-glm-53-flash`
  (`profiles.rs:196-201`); beide tragen `readiness_marker: Some("Ask
  anything")`, Z-1 misst gegen das Default-OpenCode-Profil. Bedingung:
  langsamer MCP-Start (> 30 s).
- **Treffer = im Terminal bestätigter Empfang** des Prompts (manuell geprüft),
  nicht das Guard-Event — der bisherige `Delivered`-Beweis ist ja gerade der
  beanstandete.
- Protokoll als Tabelle im Report (Lauf, Latenz, Marker gesehen ja/nein,
  Empfang bestätigt ja/nein).
- 20/20 → Queue schrumpft auf die Selbstmeldung (`done|blocked` ohne
  Queue-Infrastruktur). < 20/20 → volle Queue.

## Dateigrenzen

- **Sofort (exklusiv):** `submit_guard.rs`, `pty.rs`, `profiles.rs`
  (Baustein A), `questions.rs` (B.1).
- **Serielle `main.rs`-Lane (nach f1_single_instance → f1_diagnostics →
  f4_review_ui), abgestimmtes Fenster:** `main.rs` (B.2: `send_to_worker`,
  Event-Texte 383-389, Eskalations-Nachricht via bestehendem
  `insert_message`).
- **Nach dem f4_authority-Commit (SHA folgt):** `bin/pa.rs` (Baustein C).
- **Gehört zu f4_guard, nicht zu dieser Spec:** `workers.rs` (B.3,
  `workers.rs:549`).
- **Tabu:** `api.rs`, `store.rs` (Nahtstellen, andere Lanes).

## Abnahme-Kriterien

1. **Acht rote Tests** — T1 bis T8 wie oben benannt: T1, T3, T4, T5, T7, T8
   und der `MARKER_BUSY_CAP`-Ersatztest sind gegen den heutigen Baum
   **laufzeit-rot** (kompilieren und schlagen fehl; Fehlerausgabe im Report).
   T2 und T6 referenzieren die neue Guard-API (`ConfirmDelivery`/
   `is_confirmed()`) und sind **build-rot** — zweite Wahl nach der Regel,
   hier ausdrücklich benannt und begründet. Nach dem Fix sind alle acht grün.
2. Die drei namentlich geführten bestehenden Tests sind wie beschrieben
   angefasst (zwei Klarstellungen mit unverändertem Assertionskern, ein
   Ersatz); alle übrigen `submit_guard`-/`pty`-Tests unverändert grün. Die
   `obs()`-Hilfsfunktion darf das neue Feld mit Default befüllen.
3. Profile ohne Antwort-Marker: Verhalten bit-exakt wie heute — belegt durch
   die unverändert grünen Tests des unmarkierten Pfads.
4. Event-Texte (Baustein B.2): „task delivery confirmed" nur bei
   `ConfirmDelivery`; Marker-Eskalation meldet „readiness marker never
   appeared; task not written"; der unzugestellte Text ist mit nächstem
   Schritt persistiert.
5. Z-1-Protokoll als Tabelle im Report; Queue-Umfang folgt daraus
   deterministisch (20/20 → Selbstmeldung, sonst volle Queue).
6. Gates: `cargo test submit_guard::`, `cargo test pty::`,
   `cargo test questions::`, `cargo test profiles::`,
   `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check` (jeweils
   `CARGO_BUILD_JOBS=2`).

## Grenze

- Der Guard beweist Zustellung bis zur Annahme durch die TUI (Echo nach
  Baseline + Antwort-Marker), nicht bis zur fachlich richtigen Antwort.
- Die Ringpuffer-Kapazität (1 MiB, `SCROLLBACK_CAPACITY`) bleibt unangetastet;
  **`GUARD_TAIL_BYTES` ist aus dieser Grenze ausgenommen** (darf angehoben
  werden). Überlauf-Regel: das Echo gilt, wenn es nach der Baseline steht
  **oder** das Fenster seit dem Write übergelaufen ist — sonst schreibt der
  Rewrite-Arm den ganzen Task bis zu dreimal in einen arbeitenden Agenten.
- Dialog-Erkennung (Trust-Prompts) bleibt unverändert; kein Screen-Buffer/halber
  Terminal-Emulator; `queue.rs` bleibt außen vor; die Attention-Inbox-Mechanik
  bleibt bei F3; der `UserPromptSubmit`-Hook-Kanal ist ausdrücklich nicht im
  Scope.

Report: `.pa/report_f_core3_delivery.md`.

## W1-03-Folgepunkt aus PR49 (22.09. uebernommen)

Nach einer bestaetigten Claude-Trust-Antwort nicht erneut auf denselben
stale Dialogtext reagieren. Regression mit No->Move->Yes->Enter und
anschliessend unveraendertem Tail; Antwortbudget nicht durch alte Dialoge
verbrauchen. In derselben Lane KI-20 klaeren: genau ein Verantwortlicher
fuer ESC[6n-Reply, Headless und gemountete xterm-Ansicht pruefen. Die
W1-03-Lane erweitert dafuer gezielt den Dialogzustand; die alte allgemeine
Grenze 'Dialog-Erkennung bleibt unveraendert' gilt fuer diesen Folgepunkt
nicht. Kompilierende rote Tests erforderlich, Compile-Fehler kein Beleg.
