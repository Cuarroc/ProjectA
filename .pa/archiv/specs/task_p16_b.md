# Phase 16 / Batch B — API-Härtung (`api.rs`)

Status: historisch

Repo: `<repo-root>`, Branch `main`, im Repo-Root, kein Worktree.
**Nicht committen, nicht pushen, nicht mergen.** Ein Mensch fährt die Gates und committet.

## Deine Dateien (EXKLUSIV)

- `src-tauri/src/api.rs`
- `src-tauri/Cargo.toml` und `Cargo.lock` — **nur** falls Befund 5 eine Abhängigkeit braucht.

**Nicht anfassen:** `hooks.rs`, `testgate.rs`, `oneshot.rs`, `main.rs` (gehören parallel
Batch C), `store.rs`, `queue.rs` (gerade fertig geworden), `pa.rs`, alles unter `src/`.

## Kontext

Quelle ist `.pa/triage_p16.md`, Abschnitte P0 und P4. **Vorsicht mit Zeilennummern:** die
Triage prüfte gegen `b2d48a3`, seither hat der Activity-Feed-Merge `api.rs` erweitert.
Am Symbolnamen suchen, nicht an der Zeile.

Nicht in diesem Batch: das zweite Verdict-Token für die Approve-Routen. Das ist eine
eigene, batchübergreifende Änderung (api.rs + pa.rs + learnings.rs + roles.rs) und kommt
später. Fass die vier Verdict-Routen hier nicht an.

## Befunde

### 1. `percent_decode` paniced auf einem Mehrbyte-Zeichen nach `%` — vor der Auth (P0-2, Blocker)

`&raw[i + 1..i + 3]` schneidet einen `&str` nach Byte-Index ohne Char-Boundary-Prüfung.
`i` liegt immer auf einer Grenze (`0x25` ist nie ein Continuation-Byte), `i + 3` nicht:
folgt auf `%` ein 3- oder 4-Byte-Zeichen, liegt `i + 3` mittendrin und der Slice paniced.
Reproduktion: `GET /api/health?a=%€ HTTP/1.1` — Bytes `25 E2 82 AC`, die Bedingung
`i + 2 < len` greift, `raw[1..3]` zerschneidet das `€`. Weil der Head aus
`String::from_utf8_lossy` kommt, erzeugt auch jedes ungültige Byte ein 3-Byte `U+FFFD`
und damit denselben Panic.

Erreichbar **vor** der Token-Prüfung: `serve` ruft `parse_request` (und damit
`percent_decode` über die Query), bevor `handle` das Token ansieht. Schaden ist begrenzt
— ein Thread pro Verbindung, `panic = "abort"` ist nicht gesetzt, es stirbt nur diese
Verbindung — aber ein unauthentifizierter Panic-Auslöser bleibt einer.

Fix: die beiden Hex-Ziffern als Bytes aus dem Byte-Slice lesen und prüfen, statt einen
`&str` zu slicen. Ungültige Escapes wie bisher wörtlich durchreichen.

Tests: die vorhandenen `percent_escapes_survive_the_path`-Tests decken nur ASCII ab.
Ergänze mindestens: Mehrbyte-Zeichen direkt nach `%`, ein `%` am Ende der Eingabe, ein
`%` mit nur einer folgenden Ziffer, und ein `U+FFFD` aus `from_utf8_lossy`.

### 2. Aufrufer-Fehler kommen als 500 zurück (P4)

`into_response` mappt jedes `Err(_)` auf 500. Damit antwortet
`POST /api/workers/<id>/send` auf eine unbekannte Worker-Id mit **500** und dem Text
`worker wk-x has no running agent` — ein 404/409-Fall. `POST /api/workers/<id>/merge`
liefert für jede Gate-Verweigerung ebenfalls 500.

Direkt daneben machen es Routen richtig: `GET /api/workers/<id>` gibt 404,
`POST /api/queue/<id>/cancel` gibt 400, learnings/roles/github-link geben 400, und die
Landing-Page unterscheidet sogar per `err.starts_with("unknown project")` auf 404.

Fix konservativ: 500 bleibt der Default. Gib den Routen, die klar Aufrufer-Fehler
melden können, einen expliziten Status — Vorbild ist der Landing-Page-Pfad im selben
File. Erfinde keine neuen Fehlertexte und ändere keine Erfolgsantwort. Wenn du für eine
Route nicht sicher entscheiden kannst, ob ein Fehler vom Aufrufer oder vom Server kommt,
lass sie auf 500 und schreib das in den Bericht.

### 3. Die 405-Liste deckt nur die Hälfte der bekannten Routen ab (P4)

Der Kommentar über der Liste sagt, eine bekannte Collection mit falschem Verb sei es
wert, benannt zu werden. Die Liste enthält `["api","workers",_,"messages"]` und
`["api","workers",_,"merge"]`, aber ausgerechnet **nicht** `["api","workers",_,"send"]`.
`GET /api/workers/wk-1/send` fällt damit auf 404 „no such route" statt 405.

Ebenfalls fehlen: `["api","workers",_]`, `["api","queue",_,"cancel"]`,
`["api","scout","triage"]`, `["api","recommendations",_,"accept"]`,
`["api","recommendations",_,"status"]`, `["api","learnings",_,"approve"|"reject"]`,
`["api","roles",_,"approve"|"reject"]`, `["api","health"]`.

Der einzige Test dazu prüft nur `DELETE /api/board`. Deck die neuen Muster ab.

### 4. `/messages` antwortet für eine unbekannte Worker-Id mit 200 und leerer Liste (P4)

`GET /api/workers/wk-tippfehler` gibt korrekt 404. `GET /api/workers/wk-tippfehler/messages`
schlägt ohne Existenzprüfung auf `store.list_messages` durch, das für eine unbekannte Id
eine leere Menge liefert — also 200 `[]`. Ein Tippfehler liest sich wie ein leeres
Ergebnis. Fix: vor dem Listen die Existenz prüfen und bei `None` 404 antworten, wie die
Nachbarroute.

### 5. Der API-Token stammt nicht aus einem CSPRNG (P4)

`new_token` baut 32 Hex-Zeichen aus zwei SipHash-Runden über `(nanos, pid, round)`.
Alle Eingaben sind nicht geheim; die ganze Entropie steckt im OS-Seed von `RandomState`,
und die beiden Runden benutzen davon abgeleitete, nicht unabhängige Keys. Das ist im
Kommentar ehrlich als Abwägung benannt („the entropy std hands out without a dependency")
— aber es ist der Schlüssel zu einer API, die Prozesse startet und Repos anlegt.

Vorgehen: prüfe mit `cargo tree -i getrandom`, ob `getrandom` ohnehin schon transitiv im
Baum liegt (über tauri/sqlx sehr wahrscheinlich). Wenn ja, nimm es in der dort bereits
gebauten Major-Version als direkte Abhängigkeit auf und zieh 16 Bytes daraus. Wenn nein
oder wenn es Versionskonflikte gibt: **nichts ändern**, sondern den Kommentar auf eine
ehrliche Formulierung bringen („kein CSPRNG; akzeptiert, weil …") und es im Bericht
begründen. Zieh keine schwere Abhängigkeit für 16 Bytes.

### 6. Routentabelle im Modulkopf ist unvollständig (P4)

Es fehlen `GET /api/workers/<id>/messages`, `POST /api/queue`, `GET /api/queue`,
`POST /api/queue/<id>/cancel`. Die Projekt-Routen, die die Triage zunächst vermutete,
sind dagegen vorhanden — nur die vier nachtragen. Prüfe die Tabelle einmal komplett
gegen `route`, es können durch den Activity-Feed-Merge weitere dazugekommen sein.

## Arbeitsweise

- Der Cargo-Lock ist mit Batch C geteilt. Setz `CARGO_BUILD_JOBS=2` und lass **nicht**
  die ganze Suite laufen — `cargo test api::` reicht dir, die Gesamt-Abnahme macht ein
  Mensch danach.
- Halte dich an den Stil der Datei: Doc-Kommentare erklären das Warum, nicht das Was.
  Wo du einen Kommentar vorfindest, der nach deiner Änderung nicht mehr stimmt, zieh ihn
  nach — mehrere Befunde hier sind genau solche verfallenen Zusagen.
- Jeder Befund bekommt mindestens einen Test, der ohne den Fix fehlschlägt.

## Bericht

Schreib nach `.pa/report_p16_b.md`: pro Befund was du geändert hast, welcher Test ihn
abdeckt, und ausdrücklich was du **nicht** gemacht hast und warum. Nenn am Ende die
Dateien, die du angefasst hast, und das Ergebnis deines `cargo test api::`-Laufs.
