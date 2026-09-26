# F1-SingleInstance: eine Flotte, ein Fenster

Status: historisch

Repo: `<repo-root>`. **Nicht committen, nicht pushen, nicht
mergen.** Ein Mensch fährt die Gates und committet.

Plan: `docs/SANIERUNGSPLAN.md` Rev 9, F1 (letzter Punkt) und §4.

## Nahtstellen-Lane

Dieses Paket besitzt `main.rs` und geht **vor** `.pa/task_f1_diagnostics.md`,
weil das Plugin als erstes am Builder registriert werden muss. Beide dürfen nicht
gleichzeitig laufen. Prüfe vor dem ersten Schreibzugriff
`git status --short --branch`.

## Warum

Rev 8 wollte ausdrücklich Multi-Instanz mit einem Deskriptor; Rev 9 hat das
umgedreht. Der Grund ist konkret: es gibt **eine** geteilte `projecta.db` und
einen 30-Sekunden-Dispatcher. Zwei Prozesse ergeben damit zwei Dispatcher auf
demselben Bestand — nicht zwei Fenster.

## Der alte Patch ist eine Fundstelle, kein Startpunkt

`.pa/patches/single-instance-2026-08-30.diff` existiert und hat laut Review die
**falsche Plugin-Reihenfolge**. Lies ihn, wende ihn **nicht** an. Das ist eine
ausdrückliche Planvorgabe („den alten Patch nur als Fundstelle lesen, nicht
anwenden"), kein Stilhinweis.

Schlimmer als die Reihenfolge: **sein Test behauptet die falsche Invariante.**
Er assertiert sinngemäß `guard > setup` („registered outside the setup closure")
und **schlägt damit bei der korrekten Implementierung fehl**. Nicht abschreiben.
Der richtige Quelltest prüft, dass `single_instance::init` **vor**
`tauri_plugin_process::init()` und vor `.setup(` steht.

## Der Guard darf nichts auf die Platte schreiben

Kein Lockfile, keine PID-Datei, keine Marker-Datei — **nur das Kernel-Mutex des
Plugins.**

Der Grund ist der Updater. Auf Windows ruft `tauri-plugin-updater`
`ShellExecuteW(nsis /P … /UPDATE)` und danach `std::process::exit(0)`;
`downloadAndInstall` kehrt nie zurück, und der Neustart kommt vom NSIS-Installer,
der die exe erst ersetzen kann, wenn der alte Prozess tot ist. `exit(0)` läuft
**weder `RunEvent::Exit` noch irgendein `Drop`**. Ein Kernel-Mutex stirbt
trotzdem mit dem Prozess — eine Datei nicht. Ein dateibasierter Guard hinterließe
also nach jedem Update eine Sperre für einen Prozess, den es nicht mehr gibt.

Umgekehrt heißt das: der Plugin-Guard **kann** den Windows-Updater-Relaunch
nicht brechen. Diese Spec hat das in einer früheren Fassung andersherum
behauptet; die Korrektur stammt aus einer Prüfung im Plugin- und Updater-
Quelltext (04.09.).

## Deine Dateien (EXKLUSIV)

- `src-tauri/src/main.rs` — **nur** die Builder-Registrierung und der
  Second-Instance-Handler
- `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`

**Nicht anfassen:** `api.rs`, `store.rs`, `bin/pa.rs`, `logging.rs`, alles unter
`src/`. Insbesondere **nicht**: API-Deskriptor, Dispatcher, Ingest, Reattach-Flotte.
Wenn dein Diff eine dieser Stellen berührt, ist der Zuschnitt falsch — melde es.

**Achtung Bauumgebung:** Setze **kein** `CARGO_PROFILE_*` in der Umgebung. Das
invalidiert die Abhängigkeiten dieses Rechners (~400 Crates) und der Rebuild ist
hier nicht zumutbar.

## Auftrag

1. `tauri-plugin-single-instance` **als erstes Plugin am Builder** registrieren —
   konkret vor `main.rs:2307` (`tauri_plugin_process::init()`) und damit vor
   `.setup(`. Die Reihenfolge ist der ganze Punkt: ein später registriertes
   Plugin lässt den zweiten Prozess erst Arbeit aufnehmen, bevor er merkt, dass
   er überflüssig ist. Bei korrekter Stelle endet der zweite Prozess schon in der
   Plugin-Initialisierung — also vor `app_data_dir` (2321), `logging::init`
   (2328), `init_store` (2346), `api::start` (2389), `queue::start` (2400) und
   Reattach (2448). Genau daraus folgt der Deskriptor-Beleg: `write_descriptor`
   (`api.rs:716-729`) läuft nie.
2. Der Second-Instance-Handler **fokussiert und restauriert** das bestehende
   Fenster (auch aus minimiert/hinter anderen Fenstern) und beendet sich dann.
3. Er verändert **weder** API-Deskriptor **noch** Dispatcher-, Ingest- oder
   Reattach-Flotte. Der zweite Prozess darf nichts anfassen, was der erste besitzt.

## Ein Befund zum Melden, nicht zum Bauen

Im `request_restart`-Pfad (nicht der Windows-Updater, sondern manuelles
`plugin:process|restart`) gibt das Plugin bei `RunEvent::Exit` sein Mutex und das
Hidden-Window frei, **bevor** der App-Exit-Callback `kill_all_and_wait`, die
Hook-Wartezeit und `remove_file(descriptor)` durchläuft (`main.rs:2678-2690`). In
diesem Fenster kann ein neuer Start Primärinstanz werden und seinen Deskriptor
schreiben — und `main.rs:2689` löscht danach den **neuen**, weil nach Pfad statt
nach Inhalt gelöscht wird.

Der Fix säße in `api.rs` (nur löschen, wenn Port und Token die eigenen sind) und
liegt außerhalb deiner Dateigrenze. **Melden, nicht bauen.**

## Abnahme

- Zwei paketierte Windows-Prozesse **nacheinander** ergeben **genau eine Flotte**
  und **ein** fokussiertes/restauriertes Fenster. Beleg aus dem paketierten
  Build, nicht aus `cargo run`.
- Zwei Prozesse **gleichzeitig** gestartet ergeben dasselbe. Das ist ein eigener
  Fall: zwischen `CreateMutexW` und `CreateWindowExW` liegt ein
  Mikrosekunden-Fenster, in dem der Guard still durchfällt
  (`ERROR_ALREADY_EXISTS` bei `FindWindowW == null`) — und danach für die ganze
  Prozesslebensdauer aus ist.
- Der Beleg zählt nur bei nachweislich **keinem laufenden Dev-Prozess**: Dev und
  paketierter Build teilen die Bundle-ID `com.projecta.app`
  (`tauri.conf.json:5`) und damit den Mutex-Namen. Ein vergessenes `cargo run`
  macht den Zwei-Prozess-Beleg aus dem falschen Grund grün.
- Der zweite Start schreibt den API-Deskriptor **nicht** neu — vorher/nachher
  vergleichen (Inhalt und mtime).
- **Updater-Relaunch bleibt grün.** Nach der Korrektur oben ist das kein
  Risiko mehr, sondern eine Bestätigung: das Kernel-Mutex stirbt mit
  `exit(0)`. Trotzdem einmal fahren — er ist der einzige Pfad, der die App im
  Feld ohne Nutzerklick neu startet.
- Normaler Erststart bleibt grün.

## Gates

```text
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cargo build
npm run build
```

Plus der manuelle Zwei-Prozess- und Updater-Relaunch-Beleg. Exit-Codes
ungemaskiert lesen.

## Report

`.pa/report_f1_single_instance.md`: die Registrierungsreihenfolge mit Begründung,
der Zwei-Prozess-Beleg, der Deskriptor-Vergleich und der Updater-Relaunch-Beleg.
Dazu, was am alten Patch falsch war — damit er nicht wieder auftaucht.
