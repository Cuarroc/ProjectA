# Phase 16 / R1 — Review Rust-Kern (read-only)

Status: historisch

Repo: `<repo-root>`, Branch `main`. Im Repo-Root.

## Du aenderst NICHTS

Kein Produktivcode, keine Tests, keine Formatierung, kein Commit. Deine einzige
Schreiboperation ist dein Bericht unter `.pa/review_p16_r1.md`. Wenn du einen Bug
findest, den du in zwei Zeilen fixen koenntest: **fix ihn nicht**, beschreib ihn.
Ich triagiere und dispatche.

Du darfst lesen, greppen, und `cargo test`/`cargo check` **nicht** starten — es baut
in dieser Phase nur ein Worker gleichzeitig, und der bist du nicht. Wenn dein Befund
einen Compilerlauf braucht, um sicher zu sein, schreib das als Unsicherheit dazu.

## Dein Scope

`store.rs`, `learnings.rs`, `critic.rs`, `roles.rs`, `workers.rs`, `queue.rs`, plus
die Timeout- und Kill-Pfade in `testgate.rs` und `oneshot.rs`.

Worauf du besonders achtest:

- **Invarianten**: Was verspricht ein Doc-Kommentar, das der Code nicht haelt?
  Phase 16 hat dafuer schon zwei Praezedenzfaelle (`build_tree` verspricht
  "every worker exactly once" und verliert bei Zyklen Knoten; `respawn_worker`
  stellt Playbook und Rolle nicht wieder her). Such nach mehr davon.
- **Migrationen**: `init_schema` legt Tabellen an und ergaenzt Spalten per
  `add_missing_column`. Stimmen `CREATE TABLE` und die Nachruest-Spalten ueberein,
  sodass eine frische und eine gewachsene Datenbank dieselbe Form haben? Gibt es
  eine `[&str; N]`-Laengenangabe, die aus dem Tritt geraten kann? Was passiert bei
  einer Datenbank aus einer aelteren Phase?
- **SQL-Korrektheit**: Bindungszahl gegen Platzhalter, Spaltenreihenfolge in
  `SELECT` gegen die `FromRow`-Struct, `ORDER BY` stabil genug fuer die Tests, die
  darauf bauen. Alles gebunden, nirgends formatiert.
- **Races**: der Dispatcher-Thread in `queue.rs`, `StatusEngine::update` und seine
  fire-and-forget-Spawns (Testgate, Critic), `OnceLock`-Installationen beim Startup.
  Kann ein Doppel-Trigger passieren? Kann ein Spawn eine Sperre halten, waehrend er
  auf ein Kind wartet?
- **Still verschluckte Fehler**: `let _ =`, `.ok()`, `unwrap_or_default()` an
  Stellen, wo der Fehler den Benutzer haette erreichen muessen. Umgekehrt auch:
  best-effort-Pfade, die faelschlich hart scheitern.
- **Timeout und Kill**: `testgate.rs` und `oneshot.rs` starten Kindprozesse mit
  Deadline. Wird das Kind wirklich getoetet? Bleiben Enkelprozesse zurueck? Wird ein
  Timeout ehrlich als Fehlschlag gewertet? Was passiert bei einem Kind, das stdout
  nie schliesst?

## Befund-Format (verbindlich)

Pro Befund:

- **Datei:Zeile**
- **Schweregrad**: kritisch / schwer / mittel / niedrig
- **Beweis**: Code-Ausschnitt oder ein reproduzierbarer Ablauf. Keine Vermutung ohne
  Beleg — schreib „unsicher, weil ..." dazu, wenn du es nicht belegen kannst.
- **Vorschlag**: was du aendern wuerdest.

**Keine Vorschlaege ohne Befund.** Eine Liste allgemeiner Verbesserungsideen ohne
konkreten Fundort ist fuer diese Phase wertlos. Lieber fuenf belegte Befunde als
zwanzig Vermutungen.

Sortiere nach Schweregrad, kritisch zuerst. Wenn du nichts Kritisches findest, sag
das deutlich — ein sauberer Befund ist ein Ergebnis, kein Versagen.

## Abgabe

1. Datei `.pa/review_p16_r1.md` schreiben.
2. Zusaetzlich als Prosa in `worker_done` melden: die wichtigsten Befunde in
   3 Saetzen, plus die Anzahl je Schweregrad.

Kein Commit, kein Push. Kein blockierendes `ask`, kein Pollen von
`orca orchestration check` — die Delivery haengt; ich erreiche dich ueber dein
Terminal. Fuer Rueckfragen `orca orchestration send --type escalation`.
