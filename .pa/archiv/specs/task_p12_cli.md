# Phase 12 Sub-Task C (CLI): queue add --on-behalf-of, recommendations accept/dismiss

Status: historisch

Repo: `<repo-root>`, CLI in `src-tauri/src/bin/pa.rs`.
Phase 11 ist committed (`9b4a2c2`), der Tree ist sauber.

## Deine Datei

Du aenderst **ausschliesslich `src-tauri/src/bin/pa.rs`**.

Parallel arbeiten ein Worker im uebrigen Rust-Kern (`store.rs`, `api.rs`,
`queue.rs`, `status.rs`, `main.rs`, neu `testgate.rs`) und einer im Frontend.
Fass **nichts** davon an - insbesondere **nicht `api.rs`**. Lesen darfst du
alles. Wenn du glaubst, eine andere Datei muesse sich aendern: **melde es,
aendere sie nicht.**

## Ausgangslage

`pa` ist die Bruecke fuer die Orchestrator-Agenten: liest `projecta-api.json`,
macht einen HTTP-Request auf den Loopback-Port, druckt Klartext, fertig.
Bewusst dependency-frei ausser `serde_json`.

Zwei Luecken aus Phase 9, die jetzt geschlossen werden.

## 1. `pa queue add --on-behalf-of <workerId>`

Heute kennt `queue add` die Flags `--project`, `--task`, `--profile`,
`--priority`, `--sharpen`. Neu kommt **optional** `--on-behalf-of <workerId>`
hinzu; gesetzt, wandert der Wert als **`spawnedBy`** in den POST-Body von
`/api/queue`, sonst bleibt das Feld weg (**nicht `null` senden**).

**Warum:** eine Queen, die wegen des vollen Worker-Limits `queue add` statt
`worker spawn` benutzt, verliert sonst ihre Buchung in der Hierarchie - der
Dispatcher legt den Worker ohne Controller an. Dieselbe Semantik wie
`worker spawn --on-behalf-of`, das es schon gibt: **schau es dir an und mach es
genauso.**

Die Serverseite - Spalte, Struct, Dispatcher, Route - baut der Rust-Worker
parallel. Du baust nur gegen `spawnedBy` im Body.

## 2. `pa recommendations accept <id>` und `pa recommendations dismiss <id>`

Heute gibt es nur `pa recommendations list`. Die Routen existieren bereits in
`api.rs` (nur lesen, nicht aendern):

- `POST /api/recommendations/<id>/accept`
- `POST /api/recommendations/<id>/status`

**Sieh in `api.rs` nach, welchen Body die `status`-Route erwartet** und welcher
Wert "abgelehnt" bedeutet - rate nicht, der Feldname steht dort.

- `accept` reiht die Integrationsarbeit ein und nimmt die Empfehlung an; gib
  aus, was zurueckkommt (es ist ein Queue-Eintrag - dafuer gibt es bereits
  einen Renderer, benutz ihn).
- `dismiss` setzt den Status auf abgelehnt; kurze Bestaetigungszeile im Stil
  der vorhandenen Kommandos (vgl. was `queue cancel` druckt).
- Fehlende oder ueberzaehlige Argumente ergeben einen Fehler mit einer
  `usage:`-Zeile, genau im Stil der Nachbarn.

## 3. USAGE, NOTES, Modul-Header

Die drei neuen Aufrufformen in die `USAGE`-Konstante an die passende Stelle,
einen knappen Satz je Neuerung in `NOTES`, und den Modul-Header oben (den
`text`-Block mit den Beispielaufrufen) mitziehen, damit er nicht luegt.

## 4. Tests

Inline im vorhandenen `#[cfg(test)] mod tests`, im Stil der Nachbarn:

1. `queue add` **mit** und **ohne** `--on-behalf-of` parst in das erwartete
   `Command`; ohne das Flag bleibt es `None`.
2. `recommendations accept <id>` und `recommendations dismiss <id>` parsen.
3. Fehlende Id bzw. ein unbekanntes Unterkommando werden abgewiesen.
4. Ein Usage-Test im Stil von `the_usage_names_the_github_commands`, der belegt,
   dass `USAGE` die neuen Kommandos nennt.

## Konventionen

- Kommentare **Englisch** (WARUM, nicht WAS). Fehler als `Result<_, String>`.
- **Keine neuen Dependencies** - `serde_json` und `std` muessen reichen.
- Nutze die vorhandenen Helfer (`parse_flags`, `required`, `flags.value`,
  `api.post`, `encode`, die `render_*`-Funktionen) statt neuer Mechanik.

## Verboten

- **Keine Git-Mutationen.** **Kein `npm run tauri dev`.**
- Keine andere Datei als `src-tauri/src/bin/pa.rs`.
- **Setz niemals `CARGO_PROFILE_*`** - das entwertet den Dependency-Cache und
  erzwingt einen Rebuild von rund 400 Crates, den diese Maschine kaum schafft.

## Gate

In `src-tauri/`:

```
cargo test --bin pa
```

Muss gruen sein; Exit-Code separat pruefen, nicht durch `tail` maskieren.

**Wichtig:** der Rust-Kern wird parallel umgebaut, deshalb kann der
Gesamt-Build zwischendurch rot sein. Baut `--bin pa` deswegen gar nicht erst,
weise nach, dass **deine** Datei sauber ist (`cargo check --bin pa
--message-format=short` und Sichtung, dass keine Diagnose auf `bin/pa.rs`
zeigt) und melde es. **Starte keinen vollen `cargo test`-Lauf** - der Speicher
der Maschine vertraegt keine zwei parallelen cargo-Laeufe.

## Fertig

Berichte: neue Kommandos, den Body, den du fuer `dismiss` gefunden hast, die
Namen deiner Tests und das Gate-Ergebnis mit Exit-Code.
