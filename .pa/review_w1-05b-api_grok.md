Ich lese den Review-Auftrag und führe ihn nur lesend aus.Der Auftrag nennt sechs Prüfpunkte. Ich gleiche den Diff mit der Store-Regel, der HTTP-Route und `main.rs` ab.## Befunde

Keine.

## Geprüft und verworfen

**1. Assertions.** Der Test koppelt drei voneinander unabhängige Beobachtungen: den HTTP-Status aus `core_status`, den Fehlertext, den `Response::error` unverändert in `body["error"]` legt, und die Queue-Zeile über `list_queue` auf demselben `Store`-Clone (Pool und Session-Map sind `Arc`). Ein Fake, der wie im Rot-Stand pauschal `Ok(())` liefert, antwortet 200 und verfehlt die 409-Asserts. Eine Verweigerung, die die Zeile löscht, verfehlt `Some("dispatched")`. Ein umgeschriebener Body verfehlt `starts_with("refused: ")` oder `contains`. Die drei Gründe sind die jeweils erste zutreffende Kante in `proven_process_end`; eine andere Kante erzeugt einen anderen Satz.

- `tq-live`: `bound_in_memory` steht vor `STATUS_RUNNING`. Teilte der Clone die Session-Map nicht, bliebe der Worker `running` und der Satz wäre `is still running`. Der erwartete Text `worker wk-live still has a live session` belegt, dass die Bindung im Server-Store sichtbar ist.
- `tq-crashed`: `take_session` plus `STATUS_EXITED` plus `ended_at IS NULL`. Bliebe die Bindung, käme `still has a live session`. Bliebe `running`, käme `is still running`. Nur die offene Session trifft `1 session(s) of worker wk-crashed never reported an exit`.
- `tq-bare`: keine Session-Zeile, nicht gebunden, Status `exited`. Das trifft `has no recorded session`, erst nach den beiden vorherigen Prüfungen.
- `tq-proven`: `mark_session_exited` setzt `ended_at`, löst die Bindung und setzt den Worker auf `exited`. Daraus folgen 200, `{ok: true}` und eine verschwundene Zeile. Der zweite Cancel läuft über den `unknown `-Pfad und muss mit `unknown queued task: tq-proven` öffnen.

`contains` ist ein Teilstring. Die drei Sätze stammen aus der Store-Regel und schließen sich gegenseitig aus. Nach dem erfolgreichen Cancel wird nur `tq-live` erneut gelesen. Das Delete ist auf `id`, `status = dispatched` und `worker_id` gepinnt (`queue_cancel.rs`), eine andere Id geht damit nicht mit. Dass die Geschwisterzeile bleibt, prüft der Store-Test bereits.

**2. Die vier Zustände.** Alle vier laufen `QUEUE_READY` → `claim_queue_entry` (`dispatching`) → `mark_queue_dispatched(..., 4)`. Die Kapazitätszählung sieht dabei 0, 1, 2, 3 laufende Dispatches, die Schranke ist `< 4`, alle vier `unwrap`s setzen also `dispatched`. Die Status- und Session-Änderungen liegen danach.

| Id | Danach im Store | Erste Regelkante | Erwartung im Test |
|---|---|---|---|
| `tq-proven` | eine Session mit `ended_at`, Bindung gelöst, Worker `exited` | `Ok` | 200, Zeile weg |
| `tq-live` | `bind_session`, Worker bleibt `running` | live session | 409, Zeile `dispatched` |
| `tq-crashed` | Session ohne `ended_at`, `take_session`, Worker `exited` | open session | 409, Zeile `dispatched` |
| `tq-bare` | keine Session, Worker `exited` | `sessions == 0` | 409, Zeile `dispatched` |

Das deckt sich mit den Store-Tests derselben Formen (`a_running_worker_keeps_its_dispatched_task`, `a_session_that_never_reported_an_exit_is_not_proof`, `a_worker_without_any_recorded_session_is_not_proof`, `a_dispatched_task_whose_process_exit_was_observed_can_be_cancelled`).

**3. Determinismus.** Der Test ist ein synchrones `#[test]`. `tauri::async_runtime::block_on` hängt an einer prozessweiten Tokio-Runtime (`OnceLock`); Setup, Handler-Thread und `queue_status` teilen sie sich. `call` kehrt erst zurück, wenn der Handler `cancel_queue_entry` fertig committed hat, danach liest `list_queue`. Die beiden Blockaden überlappen sich nicht. Der Port kommt von `bind(0)`. `TempDir` trägt Pid und `new_id`. Felder fallen in Deklarationsreihenfolge, `_dir` steht zuletzt, Server und Store-Feld fallen vor dem Verzeichnis. `TempDir::drop` ignoriert einen fehlgeschlagenen `remove_dir_all`. `ApiServer::drop` joint den Accept-Thread nicht; der hält weiter ein `Arc` auf das Backend und damit einen Store-Clone. Dieselbe Leack-Form hat jedes `boot()`. Der Thread blockiert danach in `incoming()` und fasst die Datenbank nicht mehr an.

**4. Doku.** Der neue Modulkopf beschreibt `core_response`: bewiesenes Ende wird `{ok: true}` mit 200, `refused: ` wird 409, der Rest des Satzes geht in den Body, ein zweiter Cancel einer gelöschten Zeile ist 404, `failed to` bleibt 500. Die drei zitierten Fragmente sind die Store-Sätze für live session, offene Session und fehlende Session. Der `core_status`-Test pinnt den `still running`-Satz und `failed to cancel dispatched task tq-1: the pinned delete matched 0 rows` wortgleich zu `proven_process_end` und `cancel_dispatched_in`. Der Trait-Kommentar wiederholt die drei Öffnungen aus `Store::cancel_queue_entry` (`unknown `, `refused: `, sonst Store-Fehler). Der ältere Absatz („nicht mehr queued oder ready“) steht unmittelbar vor dem Absatz, der die Ausnahme für ein bewiesenes Prozessende nennt.

**5. Weitere Randfälle.** `running` ohne Bindung, `Unnamed`, `Missing` und das Pinned-Delete laufen an der Route nur über die Öffnung. `still running` und das Pinned-Delete stehen als ganze Sätze in `core_status_reads_the_opening_and_nothing_else`. Die Store-Tests `a_running_worker_keeps_its_dispatched_task`, `a_dispatched_task_without_its_worker_row_is_refused` und `a_pinned_delete_that_matches_nothing_is_a_store_failure` erzeugen dieselben Sätze. Ein zusätzlicher HTTP-Fall pro Kante würde die Präfix-Abbildung wiederholen. Die vier Zustände im neuen Test sind die, deren Body an der Naht auseinanderlaufen könnte, und die gehen durch den echten Server.

**6. Fake und `main.rs`.** `ControlBackend::cancel_queued_task` in `main.rs` ist `block_on(self.store.cancel_queue_entry(id))`. Der Fake macht bei gesetztem `queue_store` denselben Aufruf. Der Tauri-Befehl `await`et dieselbe Store-Funktion; die HTTP-Route geht über das Trait. Ohne `queue_store` bleiben die bisherigen Dosen-Antworten (`tq-nope`, `tq-busy`, `tq-boom`) stehen.

Die Panic-Meldung „must stay queued“ bei erwartetem Status `dispatched` ist nur der Assert-Text. Der erwartete Wert ist der Dispatch-Status.

## Gesamturteil

Mergebar: ja.
