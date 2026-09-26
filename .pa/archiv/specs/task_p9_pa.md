# Phase 9 Sub-Task B: `pa`-CLI um Hierarchie-Kommandos erweitern

Status: historisch

Repo: `<repo-root>`, Rust-Kern in `src-tauri/`.

## Deine Datei

Du aenderst **ausschliesslich `src-tauri/src/bin/pa.rs`**. Ein anderer Worker
sitzt parallel in `src-tauri/src/main.rs`, andere Module werden ebenfalls
angefasst. Fass keine andere Datei an. Wenn du glaubst, eine andere Datei muesse
sich aendern: melde es, aendere sie nicht.

## Ausgangslage

`pa` ist die Bruecke, ueber die Orchestrator-Agenten ProjectA steuern: es liest
`projecta-api.json`, macht **einen** HTTP-Request auf den Loopback-Port, druckt
die Antwort als Klartext, fertig. Bewusst dependency-frei ausser `serde_json`.

Phase 9 hat die API bereits erweitert (uncommitted im Worktree, lies sie in
`src-tauri/src/api.rs` nach). Es fehlt nur noch die CLI-Seite.

## Die API-Vertraege (bereits fix, erfinde nichts)

- `POST /api/workers` - Body `{projectId, task, profileId?, spawnedBy?}` -> `Worker`
- `POST /api/queens` - Body `{projectId, task, profileId?, spawnedBy?}` -> `Worker`
- `GET /api/projects/<id>/tree` -> `{ "coordinators": [Node], "workers": [Node] }`
  wobei `Node` ein flach eingebetteter `Worker` **plus** `"children": [Node]` ist.
  Ein `Worker` serialisiert camelCase: `id, projectId, task, profileId, branch,
  worktreePath, sessionId, status, kind, prUrl, spawnedBy, createdAt`.
  `coordinators` sind die Wurzeln (Orchestrator/Queen/Scout ohne lebenden
  Controller) mit ihrem Unterbaum, `workers` die Employees, die niemand
  beansprucht hat.
- `GET /api/projects` -> Liste von Projekten (jedes mit mindestens `id`, `name`).

## Auftrag

### 1. `pa worker spawn --on-behalf-of <workerId>`

Neues **optionales** Flag an `worker spawn`. Gesetzt, wandert es als
`spawnedBy` in den POST-Body von `/api/workers`; nicht gesetzt, bleibt das Feld
weg (nicht `null` senden). Das ist die Buchung, mit der eine Queen ihre
Employees unter sich einhaengt.

### 2. `pa queen spawn --project <projectId> --task <Domaene> [--profile <profileId>] [--on-behalf-of <workerId>]`

Neues Verb `queen` mit dem Unterkommando `spawn`. POST auf `/api/queens` mit
`{projectId, task}` plus `profileId`/`spawnedBy`, wenn gegeben. Ausgabe: das
vorhandene `render_worker` - eine Queen ist ein `Worker`.

Ein unbekanntes Unterkommando meldet `unknown queen subcommand: <x>`, ein
fehlendes meldet `queen needs a subcommand: spawn` - genau im Stil der
bestehenden Verben `worker`, `queue`, `scout`, `github`.

### 3. `pa tree [--project <projectId>]`

Eingerueckte Text-Baumansicht der Agenten-Hierarchie.

- **Mit** `--project`: ein `GET /api/projects/<id>/tree`.
- **Ohne** `--project`: erst `GET /api/projects`, dann pro Projekt ein
  `GET /api/projects/<id>/tree`; jeder Baum bekommt seinen Projektnamen als
  Ueberschrift. (Die Tree-Route ist pfadgebunden und braucht immer eine id -
  deshalb dieser Umweg. Setz einen Kommentar hin, der genau dieses WARUM sagt.)

Rendering: eine **reine** Funktion, die den `Value` in einen `String`
verwandelt, damit sie testbar ist - genau wie `render_worker_list` und
`render_queue_list` es vormachen. Pro Zeile mindestens Worker-Id, `kind`,
`status` und die Aufgabe; Kinder eine Ebene tiefer eingerueckt.
`coordinators` zuerst, danach die herrenlosen `workers`. Ein Projekt ganz ohne
Agenten druckt eine ruhige Zeile statt einer leeren Ausgabe - so wie die
anderen `render_*_list` es mit leeren Listen halten.

### 4. `USAGE` und Modul-Header

- Die drei neuen Aufrufformen in die `USAGE`-Konstante, an der Stelle, wo sie
  hingehoeren (die `worker`-Zeile waechst um `[--on-behalf-of <workerId>]`,
  `queen spawn` direkt danach, `tree` zu den Uebersichts-Kommandos zu `board`).
- In `NOTES` zwei knappe Saetze: wofuer `--on-behalf-of` da ist (Buchung in der
  Hierarchie) und was `tree` zeigt.
- Den `//!`-Modul-Header oben (den `text`-Block mit den Beispielaufrufen)
  mitziehen, damit er nicht luegt.

## Tests

Inline `#[cfg(test)] mod tests`, im Stil der vorhandenen. Mindestens:

1. `worker spawn` **mit** und **ohne** `--on-behalf-of` parst in das erwartete
   `Command` (und ohne das Flag bleibt es `None`).
2. `queen spawn` parst; `--project` und `--task` sind Pflicht und fehlen sie,
   kommt ein Fehler; ein unbekanntes Unterkommando wird abgewiesen.
3. `tree` parst mit und ohne `--project`.
4. Die Renderfunktion nistet Kinder unter ihre Eltern: bau von Hand einen
   `serde_json::json!`-Baum (Orchestrator -> Queen -> zwei Employees, dazu ein
   herrenloser Employee) und pruefe, dass die Einrueckung mit der Tiefe waechst
   und jeder Worker genau einmal vorkommt.
5. Ein Projekt mit leerem Baum rendert die ruhige Zeile statt nichts.
6. Zieh den vorhandenen Usage-Test-Stil nach (vgl.
   `the_usage_names_the_github_commands`): ein Test, der belegt, dass `USAGE`
   die neuen Kommandos nennt.

## Konventionen

- Kommentare und Docs **Englisch**, und sie erklaeren das **WARUM**, nicht das WAS.
- Fehler als `Result<_, String>`. **Keine neuen Dependencies** - `serde_json`
  und `std` muessen reichen.
- Nutze die vorhandenen Helfer (`parse_flags`, `required`, `flags.value`,
  `api.post`, `api.get`, `encode`, `render_worker`) statt neuer Mechanik.
- Halte dich exakt an den Stil der umstehenden Arme in `parse_args` und im
  `match command`-Block.

## Verboten

- **Kein `git add`, `git commit`, `git checkout`, `git stash`** - keinerlei
  Git-Mutation. Der Mensch commitet.
- **Kein `npm run tauri dev`**, kein Start der App.
- Keine anderen Dateien - insbesondere nicht `api.rs` oder `main.rs`.

## Gate

In `src-tauri/`:

```
cargo test --bin pa
cargo clippy --bin pa --all-targets -- -D warnings
```

Beide muessen fuer `pa` gruen sein. Fehler aus `main.rs`, `diff.rs`, `gh.rs`,
`providers.rs`, `status.rs` sind **nicht deine** - die erledigen andere
parallel. Sollte `--bin pa` wegen dieser Fremdfehler gar nicht erst bauen,
melde das und weise nach, dass **deine** Datei fehlerfrei ist (z. B. per
`cargo check --bin pa --message-format=short` und Sichtung, dass keine
Diagnose auf `bin/pa.rs` zeigt).

Bei `.rmeta`- oder `0xc000012d`-Abstuerzen: mit `CARGO_BUILD_JOBS=2` erneut -
das ist Speicherdruck, kein Code-Problem.

## Fertig

Berichte: neue/geaenderte Kommandos, die Namen deiner neuen Tests, und die
Gate-Ergebnisse.
