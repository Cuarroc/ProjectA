# Phase 16 / Batch C — Hook-Auth, Testgate-Timeout, Prozessbäume

Status: historisch

Repo: `<repo-root>`, Branch `main`, im Repo-Root, kein Worktree.
**Nicht committen, nicht pushen, nicht mergen.** Ein Mensch fährt die Gates und committet.

## Deine Dateien (EXKLUSIV)

- `src-tauri/src/hooks.rs`
- `src-tauri/src/testgate.rs`
- `src-tauri/src/oneshot.rs`
- `src-tauri/src/main.rs` — **nur** der Reattach-Block für Befund 3, sonst nichts

**Nicht anfassen:** `api.rs` (gehört parallel Batch B), `store.rs`, `queue.rs`, `pa.rs`,
`workers.rs`, `learnings.rs`, `roles.rs`, alles unter `src/`.

## Kontext

Quelle ist `.pa/triage_p16.md`, Abschnitte P0 und P1. **Vorsicht mit Zeilennummern:** die
Triage prüfte gegen `b2d48a3`, seither kam der Activity-Feed-Merge dazu. Am Symbolnamen
suchen, nicht an der Zeile.

## Befunde

### 1. Der Hook-Empfänger ist unauthentifiziert und speist die Critic-Evidenz (P0-3, Blocker)

`hooks::serve` prüft kein Token — anders als der Control-API-Port, der jede Anfrage über
eine Token-Prüfung führt. `parse_request` akzeptiert jedes `POST /hook/<id>` mit einem
`hook_event_name` und übernimmt ein mitgeliefertes `message` unverändert in
`store.insert_message`. Jeder lokale Prozess kann damit fremde Worker-Logs füllen.

Das ist nicht nur Kosmetik: `critic::read_messages` speist genau dieses Log in das
Critic-Dokument, aus dem Learnings destilliert werden, und ein `Stop`-Event schiebt die
Karte nach `done`, was den Critic überhaupt erst auslöst. Die Modul-Doku behauptet
obendrein, das Einzige, was mit einer Anfrage passiere, sei das Verschieben einer Karte
— das stimmt nicht, es wird auch geschrieben.

Fix: pro Worker ein Secret beim Schreiben der Settings-Datei erzeugen, in der
weitergereichten Hook-Kommandozeile mitgeben und in `serve` prüfen. Anfragen ohne oder
mit falschem Secret werden abgelehnt, ohne dass etwas in die Datenbank geht.

Achte auf zwei Dinge:
- Das Secret landet in einer Datei unter dem Temp-Verzeichnis, die der Agent lesen kann
  und muss. Das ist in Ordnung — es geht darum, dass *fremde* Prozesse nicht in *fremde*
  Worker schreiben, nicht darum, den Agenten vor sich selbst zu schützen. Schreib genau
  das als Kommentar hin, damit die nächste Person die Grenze richtig versteht.
- Bestehende Worker haben noch keine Settings-Datei mit Secret. Überleg dir, was mit
  einem Hook passiert, der nach einem Update ohne Secret ankommt, und triff eine bewusste
  Entscheidung (ablehnen oder einmalig nachschreiben). Begründe sie im Bericht.
- Korrigier die Modul-Doku auf das, was der Code wirklich tut.

### 2. Der Testgate-Timeout wartet auf geschlossene Pipes statt auf das Kind (P1-1)

Die Warteschleife bricht nur bei `RecvTimeoutError::Disconnected` ab, und der Sender wird
erst freigegeben, wenn die Drain-Threads EOF sehen. EOF kommt aber erst, wenn *alle*
Schreib-Enden zu sind — ein vom Testlauf gestarteter, nicht eingesammelter
Hintergrundprozess hält seines offen, unabhängig davon, ob die Shell längst mit 0 beendet
hat. `child.try_wait()` wird vor der Entscheidung nie gefragt.

Folge: eine grüne Suite endet nach dem vollen Timeout als `fail`, der Merge ist gesperrt,
und die Karte steht zehn Minuten falsch auf „Test läuft". Der Code weiß das an anderer
Stelle selbst — direkt darunter steht als Begründung, warum die Drain-Threads nicht
gejoint werden, genau dieses Enkel-Szenario.

Fix: in der Schleife auf `child.try_wait()` pollen. `oneshot.rs` macht das schon richtig,
nimm es als Vorbild. Die Pipes bleiben zum Einsammeln der Ausgabe.

### 3. `test_status='running'` wird beim Start nie zurückgesetzt (P1-2)

Es gibt genau zwei Stellen, die `TEST_RUNNING` schreiben bzw. lesen: der Gate setzt es,
und `run_test_gate_if_due` behandelt es als „nicht fällig". Der Reattach-Block beim
Anwendungsstart setzt nur `status`, nie `test_status`.

Häufigster Auslöser braucht keinen Fehler: die App wird während des bis zu zehn Minuten
langen Laufs geschlossen. Danach ist der automatische Gate für diesen Worker dauerhaft
blockiert und der Merge verweigert; nur der unbedingte manuelle Befehl kommt noch heraus.
Der Doc-Kommentar am Timeout behauptet, dieser löse genau dieses Problem — er löst es nur
innerhalb einer Sitzung.

Fix zweiteilig: im Reattach-Pass beim Start jedes hängengebliebene `running` zurücksetzen,
**und** in `run_test_gate` die Fehlerpfade zwischen dem Setzen von `running` und dem
Schreiben des Ergebnisses den Status wieder freigeben lassen. In `main.rs` fasst du
ausschließlich diesen Reattach-Block an.

### 4. Der Timeout-Kill trifft nur die Shell, nicht den Prozessbaum (P1-6)

Getötet wird immer nur der Interpreter: `testgate` startet grundsätzlich über
`cmd /C` bzw. `sh -c`, und `oneshot` auf Windows über `%COMSPEC% /C` auf einen
`.cmd`-Shim. Crateweit gibt es keine Prozessgruppe und kein Job-Objekt — eine Suche nach
`creation_flags`, `process_group` und `JobObject` liefert null Treffer.

Folge: ein Critic- oder Rollen-Destiller-Lauf, der in den 180-Sekunden-Timeout läuft,
lässt den eigentlichen Agenten mit vollem Diff und Message-Log weiterlaufen. Bei
`oneshot` kommt dazu, dass das Temp-Verzeichnis unter dem noch laufenden Prozess weg
gelöscht wird.

Fix ohne neue Abhängigkeiten:
- **Windows** (die Zielplattform): `taskkill /T /F /PID <pid>` als Kindprozess starten.
  Das beendet den Baum und braucht nichts ausser `std`.
- **Unix**: `std::os::unix::process::CommandExt::process_group(0)` beim Start setzen und
  beim Timeout die Gruppe beenden. Ohne `libc` geht das über einen `kill`-Aufruf mit
  negativer PID.
- Der Kommentar an der Kill-Stelle behauptet, der Prozess sei danach tot. Zieh ihn nach.
- Bei `oneshot`: erst der Kill, dann das Aufräumen des Workspace.

Halte das schlicht. Wenn eine Plattform sich nicht sauber abdecken lässt, ist ein
ehrlicher Kommentar besser als eine Konstruktion, die so tut als ob.

### 5. Vorhersagbare Temp-Pfade und Default-Rechte (P5, klein)

Die Hook-Wurzel und der One-shot-Workspace liegen unter voll vorhersagbaren Namen und
werden mit der Standard-umask angelegt. Auf Windows ist das Temp-Verzeichnis
benutzerprivat und die Annahme ist ohnehin ein Einzelnutzer-Desktop — das ist Härtung,
kein Loch. Mit Befund 1 liegt dort jetzt aber ein Secret, was den Punkt aufwertet:
Wurzeln auf unix mit `0o700` anlegen, One-shot-Workspace mit Zufallssuffix statt
`pid-seq`.

## Arbeitsweise

- Der Cargo-Lock ist mit Batch B geteilt. Setz `CARGO_BUILD_JOBS=2` und lass **nicht** die
  ganze Suite laufen — `cargo test hooks::` / `testgate::` / `oneshot::` reicht dir, die
  Gesamt-Abnahme macht ein Mensch danach.
- Halte dich an den Stil der Dateien: Doc-Kommentare erklären das Warum. Mehrere Befunde
  hier sind verfallene Zusagen in genau solchen Kommentaren — zieh sie nach, statt sie
  stehen zu lassen.
- Jeder Befund bekommt mindestens einen Test, der ohne den Fix fehlschlägt. Wo ein Test
  echte Prozesse bräuchte und deshalb nicht deterministisch ist, schreib das lieber in
  den Bericht als einen Test, der nichts prüft.

## Bericht

Schreib nach `.pa/report_p16_c.md`: pro Befund was du geändert hast, welcher Test ihn
abdeckt, und ausdrücklich was du **nicht** gemacht hast und warum. Nenn am Ende die
angefassten Dateien und das Ergebnis deiner Testläufe. Begründe die Entscheidung zu
Hooks ohne Secret aus Befund 1 explizit.
