# Phase 16 / Batch F — `pa`-CLI: der Parser hält seine eigene Zusage nicht

Status: historisch

Repo: `<repo-root>`, Branch `main`, im Repo-Root, kein Worktree.
**Nicht committen, nicht pushen, nicht mergen.** Ein Mensch fährt die Gates und committet.

## Deine Datei (EXKLUSIV)

- `src-tauri/src/bin/pa.rs`

**Sonst nichts.** Batch E arbeitet zeitgleich an `workers.rs`, `learnings.rs`,
`roles.rs`, `profiles.rs`, `pty.rs`, `oneshot.rs` und `main.rs`. `api.rs`, `store.rs`,
`queue.rs`, `hooks.rs`, `testgate.rs` und alles unter `src/` sind ebenfalls tabu.

## Kontext

Quelle ist `.pa/triage_p16.md`, Abschnitt P4. **Zeilennummern sind veraltet** — am
Symbolnamen suchen.

Der Modulkopf und die Refusal-Policy dieser Datei formulieren einen klaren Anspruch:
alles, was ein Aufrufer falsch machen kann, soll ein Fehler mit einem Namen sein, und ein
stiller Default wäre schlimmer als eine Ablehnung. Die drei Punkte unten sind Stellen, an
denen der Code diesen Anspruch verfehlt.

## 1. `parse_flags` frisst den nächsten Flag-Token als Wert (echter Bug)

Der Zweig, der einen Wert entnimmt, nimmt `args.next()` ungeprüft. Damit wird
`pa worker list --project --typo` zu einem gültigen `Command` mit
`project_id: Some("--typo")`, geht als echte Anfrage raus, findet erwartungsgemäss keine
Worker, druckt „no workers" und endet mit Exit-Code 0. Ein Tippfehler liest sich wie ein
leeres Ergebnis — genau das, was die Policy im Doc-Kommentar ausschliessen will.

Betroffen ist der gemeinsame Parser, also alle wertnehmenden Flags: worker/queen spawn,
queue, learnings, roles, board, tree, project.

Fix: im Wert-Zweig ablehnen, wenn der nächste Token wie ein Flag aussieht.
`--name=--wert` muss als bewusster Escape-Hatch weiter funktionieren — prüf, dass die
`=`-Form einen anderen Weg nimmt, bevor du etwas änderst.

Der vorhandene Test dazu deckt nur „Flag am Zeilenende ohne Wert" ab, nicht „Flag gefolgt
von Flag". Die Lücke ist also nicht bewusst abgesichert. Schliess sie mit einem Test, der
ohne deinen Fix fehlschlägt.

## 2. Doppelte Flags gewinnen als erste statt als letzte (Verbesserung)

`Flags::value` sucht mit `find` und liefert damit das erste Paar; `parse_flags` schiebt
alle Vorkommen in dieselbe Liste. `--project pj-alt --project pj-neu` sendet `pj-alt`.

Das bricht keinen wohlgeformten Aufruf und ist deterministisch — es ist dieselbe
Policy-Verletzung wie Punkt 1, nur ohne Schaden bei korrekter Eingabe. Die zur Policy
passende Lösung ist Ablehnung („--project given twice"), nicht „der letzte gewinnt":
still das Gegenteil dessen zu tun, was jemand erwartet hat, ist genau der Fehler, den die
Policy vermeiden will. Setz das um, es sei denn du findest im Repo einen Aufrufer, der
sich auf doppelte Flags verlässt — dann sag es im Bericht und lass es.

## 3. Hilfetexte hinken dem Parser hinterher (Verbesserung)

Zwei Stellen:

- Der **Modulkopf** endet bei `pa queue add` und `pa quota`, während der USAGE-Block
  zusätzlich `queue list`, `queue cancel`, `project landing-page`, `set-landing-page`
  und `quota list` führt. Gleich ziehen.
- Die **`queue add`-USAGE-Zeile** nennt `--priority` nicht, obwohl der Parser es
  akzeptiert und `run` es als `i32` parst und mitsendet. Ergänzen — und den Test, der die
  unvollständige Zeile zementiert, mitziehen.

Prüf beide Listen einmal vollständig gegen den Parser, statt nur die genannten Lücken zu
schliessen: seit dem Activity-Feed-Merge gibt es `pa activity`, und es können weitere
Kommandos dazugekommen sein, die in keiner der beiden Listen stehen.

---

## Arbeitsweise

- Der Cargo-Lock ist mit Batch E geteilt. Setz `CARGO_BUILD_JOBS=2` und beschränk dich
  auf `cargo test --bin pa` und `cargo clippy --all-targets -- -D warnings`. Lass
  **nicht** die ganze Suite laufen; die Gesamt-Abnahme macht ein Mensch danach.
- Wenn ein cargo-Aufruf mit `0xc000012d` oder einem mmap-Fehler abbricht, ist das
  Speicherdruck durch den parallelen Worker — kein Code-Problem, einfach nochmal.
- Jeder Punkt braucht mindestens einen Test, der ohne den Fix fehlschlägt. **Überzeug
  dich davon**, indem du den Fix kurz zurücknimmst und den Test laufen lässt.
- Die Datei ist klein und sorgfältig geschrieben. Halte dich an ihren Ton: die
  Fehlermeldungen nennen beim Namen, was falsch war.

## Bericht

Nach `.pa/report_p16_f.md`: pro Punkt was du geändert hast, welcher Test ihn abdeckt und
wie du dich vom Fehlschlagen überzeugt hast, ausdrücklich was du **nicht** gemacht hast
und warum, sowie das Ergebnis deiner vollständigen Gegenprüfung aus Punkt 3 (welche
Kommandos in welcher Liste gefehlt haben). Am Ende die Ergebnisse deiner Läufe.
