# Phase 16 / Batch E — Injektionspfad: Guard, Playbook-Herkunft, Kommandozeile

Status: historisch

Repo: `<repo-root>`, Branch `main`, im Repo-Root, kein Worktree.
**Nicht committen, nicht pushen, nicht mergen.** Ein Mensch fährt die Gates und committet.

## Deine Dateien (EXKLUSIV)

- `src-tauri/src/workers.rs`
- `src-tauri/src/learnings.rs`
- `src-tauri/src/roles.rs`
- `src-tauri/src/profiles.rs`
- `src-tauri/src/pty.rs`
- `src-tauri/src/oneshot.rs`
- `src-tauri/src/main.rs` — nur wo die Punkte unten es verlangen
- `src-tauri/src/critic.rs` — nur falls Punkt 2 es verlangt

**Nicht anfassen:** `pa.rs` (läuft parallel als Batch F), `api.rs`, `store.rs`, `queue.rs`,
`hooks.rs`, `testgate.rs`, alles unter `src/` (Frontend, gehört Batch D).

## Kontext

Quelle ist `.pa/triage_p16.md`. **Zeilennummern sind veraltet** — seither sind der
Activity-Feed-Merge und die Batches A, B und C gelandet. Am Symbolnamen suchen.

Zwei der Punkte hier sind ausdrückliche Entscheidungen des Nutzers, keine Vorschläge:
Punkt 2 (Playbook unter App-Data) und Punkt 3 (Kommandozeile). Setz sie um, auch wenn
dir eine kleinere Lösung einfällt — aber sag es im Bericht, wenn du sie für falsch hältst.

---

## 1. `respawn_worker` umgeht `ensure_profile_enabled` (P1-3, echter Bug)

Zwischen dem Laden der Worker-Zeile und `agents.spawn` kommt in `respawn_worker` kein
`enabled` vor — auch nicht im Block, den Fix 1 (`bb65a5c`) dort neu eingezogen hat.
Crateweit rufen nur vier Stellen den Guard, und der Respawn ist keine davon.

Der Doc-Vertrag in `learnings.rs` verspricht ausdrücklich einen Guard für *jeden*
Spawn-Pfad, „however the request arrived". Zwei erreichbare Auslöser: der Board-Button
und der automatische Reattach-Pass beim Anwendungsstart, der ohne Zutun bis
`DEFAULT_MAX_CONCURRENT` Worker respawnt. Ein abgeschaltetes Profil kommt damit nach
jedem Neustart von selbst wieder hoch.

Fix: Guard nach dem Laden der Zeile, vor dem Aufräumen der generierten Dateien. Für den
Reattach zusätzlich entscheiden, ob dort gefiltert oder der Fehler nur geloggt wird — ein
Startvorgang darf nicht an einem abgeschalteten Profil scheitern. Begründe die Wahl.

## 2. `PLAYBOOK.md` bekommt eine autoritative Kopie unter App-Data (P3-2, Entscheidung des Nutzers)

Heute ist die Repo-Datei die Wahrheit. Orchestrator, Queen und Scout laufen aber mit
`cwd = repo_path` und haben sie damit im Arbeitsverzeichnis; der Orchestrator-Prompt
verbietet Dateien nicht einmal, er befiehlt Anhängen an `MEMORY.md`. Direkt
geschriebener Text geht durch `split_blocks`, das eine Markdown-Überschrift am
Zeilenanfang ehrt — also genau das Escape, das auf dem approved Pfad durch `one_line`
blockiert ist. Die Modul-Behauptung „Nothing reaches the file without a person saying
yes" ist damit schlicht falsch.

**Umsetzung:** Die autoritative Kopie liegt unter dem App-Data-Verzeichnis, pro Projekt.
Nur `playbook_append` schreibt sie. `playbook_excerpt` — die Quelle für alles, was in
Prompts injiziert wird — liest **ausschliesslich** von dort. Die Datei im Repo bleibt
erhalten und wird weiter geschrieben, aber nur noch als lesbarer Spiegel für den
Menschen; was ein Agent hineinschreibt, erreicht keinen Prompt mehr.

Präzedenzfall für den Pfad ist der Key-Vault aus Phase 7.2, der ebenfalls im
App-Data-Verzeichnis liegt; `app_data_dir` gibt es in `main.rs`. Wie du den Pfad zu
`learnings.rs` bringst, ist deine Entscheidung — schau dir die Aufrufer an, bevor du
eine Signatur änderst, und halte den Testpfad ohne Tauri-App lauffähig (die vorhandenen
Tests dürfen keinen `AppHandle` brauchen).

Bestandsdaten: bestehende Projekte haben nur die Repo-Datei. Überleg dir, was beim
ersten Start nach dem Update passiert (einmalig übernehmen oder leer starten), und
begründe es. Ein stillschweigender Verlust angenommener Learnings wäre das schlechteste
Ergebnis.

Und: zieh die Modul-Doku und die Trait-Docs nach, die heute etwas versprechen, das der
Code nicht hält.

## 3. Injizierter Text darf nicht zu Kommandosyntax werden (P1-7, Entscheidung des Nutzers)

`SystemPrompt::Arg` reicht den Playbook-Auszug als Argument durch. `append_quoted` in
`portable-pty` escapet ein internes Anführungszeichen als Backslash-Quote — was `cmd.exe`
nicht kennt, es zählt nur Quotes. Ein gewöhnliches Anführungszeichen in menschlich
freigegebenem Text (ein zitierter Dateiname, eine Fehlermeldung) zerlegt damit die
Kommandozeile; `%VAR%` wird zusätzlich expandiert.

**Lies das Ziel, nicht den Buchstaben:** Der Nutzer hat „über den Datei-Kanal statt als
Argument" entschieden. Das ist aber keine freie Wahl — `SystemPrompt` ist eine Fähigkeit
des jeweiligen CLI. `kimi` deklariert `File { --agent-file }` und ist damit schon sicher;
`claude` deklariert `Arg { --append-system-prompt }` und hat kein Datei-Flag. **Erfinde
kein Flag** — der Codebase-Stil ist, fehlende Fähigkeiten ehrlich als `Unsupported` zu
benennen, nicht sie zu erfinden.

Der eigentliche Fehler liegt eine Ebene tiefer: `pty.rs::build_command` schickt einen
`.cmd`-Shim über `%COMSPEC% /C`, und dieses erneute Parsen macht aus dem Argument wieder
Syntax. Löse das dort — den Shim auf sein echtes Ziel auflösen, statt über `cmd.exe` zu
gehen, sodass das Argument den Prozess unverändert erreicht. `oneshot::program_invocation`
hat dieselbe Form und dieselbe Schwäche.

Prüf vorher nach, ob meine Diagnose stimmt, statt sie zu glauben: sieh dir
`build_command` und die vendored `portable-pty`-Quelle an und beschreib im Bericht, was
tatsächlich passiert. Wenn du zu einem anderen Schluss kommst, ist das ein Ergebnis —
schreib es hin, statt eine Lösung zu bauen, an die du nicht glaubst.

Ein Test, der ein Anführungszeichen und ein `%VAR%` durch den Kommandobau schickt und
prüft, dass sie als Daten ankommen, ist hier wichtiger als jeder andere.

## 4. Der Respawn ist ein zweiter, ungeprüfter Injektionszeitpunkt (P3-3, klein)

Durch `bb65a5c` liest der Respawn `PLAYBOOK.md` zur Respawn-Zeit frisch. Das ist gewollt
und der funktionale Fix war richtig — aber es heisst, dass Text, der nach dem Spawn ins
Playbook kam, auch **bestehende** Aufträge erreicht. Die menschliche Handlung heisst
„Worker wiederherstellen", nicht „neue Anweisungen geben", und es gibt weder Diff noch
Rückfrage.

Fix klein halten: den Playbook-Auszug beim Respawn im Message-Log getrennt vom Task
ausweisen, sodass sichtbar ist, dass der Agent nicht mit denselben Instruktionen
zurückkommt. Kein Dialog, keine neue UI — das wäre Batch D.

## 5. Section-Marker werden nie geprüft (P3-5, klein)

`--- TASK ---` und `--- PROJEKT-PLAYBOOK ---` werden nur beim Schreiben referenziert, nie
beim Prüfen. Auf dem approved Pfad entschärft `one_line` sie zufällig, aber niemand prüft
es, und der Konsument ist ein LLM. Lehn beide Marker-Strings in `approve_learning` neben
der Leer-Prüfung und in `parse_distilled` ab.

## 6. `insert_into_section` faltet den Bullet, die Überschrift nicht (P5, klein)

`one_line` wird auf den Bullet angewandt, nicht auf die Überschrift, obwohl beide in
dieselbe Datei geschrieben werden. Heute nicht erreichbar, weil jeder API-Pfad die
Profil-Id gegen die Registry prüft — aber die Asymmetrie ist eine Falle. Dieselbe
Normalisierung auf beide.

## 7. Aufrufer-Fehler von Server-Fehlern unterscheidbar machen (Vorarbeit für api.rs)

Batch B musste sieben Routen bei 500 belassen, weil `workers.rs` `unknown project`,
`unknown agent profile` und Worktree-/Spawn-Fehler in einem untypisierten `String`
mischt. `api.rs` gehört dir **nicht** — ändere dort nichts.

Was du tun sollst: die Fehler in `workers.rs` so vereinheitlichen, dass ein Aufrufer sie
später unterscheiden kann. Der Codebase hat dafür schon ein Muster — `api.rs` erkennt an
anderer Stelle `unknown project` am Präfix. Zieh die Fehlertexte auf eine konsistente,
dokumentierte Form und halte im Doc-Kommentar fest, welche Präfixe Aufrufer-Fehler
bezeichnen. Ändere keine Erfolgspfade und erfinde keinen neuen Fehlertyp, wenn ein
konsistentes Präfix reicht.

---

## Arbeitsweise

- Der Cargo-Lock ist mit Batch F geteilt. Setz `CARGO_BUILD_JOBS=2` und beschränk dich
  auf die Module, die du anfasst (`cargo test workers::` usw.) plus
  `cargo clippy --all-targets -- -D warnings`. Lass **nicht** die ganze Suite laufen;
  die Gesamt-Abnahme macht ein Mensch danach.
- Reihenfolge-Empfehlung: 1, dann 5 und 6 (klein, unabhängig), dann 3, dann 2, dann 4
  und 7. Punkt 2 ist der grösste Eingriff — mach ihn nicht als Erstes.
- Doc-Kommentare in diesem Codebase erklären das Warum. Mehrere Punkte hier sind
  Kommentare, die etwas versprechen, das der Code nicht hält. Zieh sie nach.
- Jeder Punkt braucht mindestens einen Test, der ohne den Fix fehlschlägt. **Überzeug
  dich davon**, indem du den Fix kurz zurücknimmst und den Test laufen lässt — nicht
  indem du es annimmst. Wo das nicht geht, schreib es in den Bericht.

## Bericht

Nach `.pa/report_p16_e.md`: pro Punkt was du geändert hast, welcher Test ihn abdeckt und
wie du dich vom Fehlschlagen überzeugt hast, und ausdrücklich was du **nicht** gemacht
hast und warum. Die Entscheidungen aus Punkt 1 (Reattach), Punkt 2 (Bestandsdaten) und
Punkt 3 (Diagnose) begründest du explizit. Am Ende die angefassten Dateien und die
Ergebnisse deiner Läufe.
