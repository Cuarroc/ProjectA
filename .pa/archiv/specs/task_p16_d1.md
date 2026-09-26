# Phase 16 / D1 — Adversariales Testen: brich die neuen Features

Status: historisch

Repo: `<repo-root>`, Branch `main`. Im Repo-Root.
**Nicht committen, nicht pushen, nicht mergen.**

## Deine Rolle

Du bist kein Reviewer, der liest — du bist der, der es kaputt macht. Du schreibst
**neue Rust-Tests**, die die in den Phasen 9–15 gebauten Features gezielt brechen
sollen. Was haelt, bleibt als Regressionsschutz im Repo. Was bricht, ist ein Befund
fuer mich.

## Was du anfassen darfst — und was nicht

**Erlaubt:** ausschliesslich `#[cfg(test)] mod tests`-Bloecke in bestehenden Rust-
Dateien. Du ergaenzt Testfunktionen und, wenn noetig, Test-Hilfsfunktionen **innerhalb**
dieser Bloecke.

**Verboten:** jede Aenderung an Produktivcode. Keine Signaturaenderung, kein neues
`pub`, kein `#[allow]`, keine „kleine Anpassung, damit der Test durchgeht". Wenn ein
Test nur gruen wird, indem du Produktivcode aenderst, dann ist genau das dein Befund —
schreib ihn auf und lass den Test **auskommentiert oder mit `#[ignore]`** stehen, mit
einem Kommentar, der sagt warum.

Das ist die wichtigste Regel dieser Rolle: **ein roter Test ist ein Ergebnis, kein
Problem, das du wegzuraeumen hast.**

## Wo du angreifst

1. **`spawned_by`-Zyklen** (`api.rs::build_tree`): Selbstbezug, Zweier- und
   Dreierzyklus, Zyklus plus intakter Rest. Erscheint jeder Worker genau einmal?
   Terminiert es? *(Hinweis: hier arbeitet gerade ein Fix-Worker. Schreib die Tests
   trotzdem — sie sind der Beweis, dass sein Fix wirkt.)*
2. **`pattern_label`-Sonderzeichen** (`roles.rs`, `learnings.rs`): Label mit
   Markdown-Ueberschrift `## `, mit den Markern `--- PROJEKT-PLAYBOOK ---` /
   `--- TASK ---`, mit Zeilenumbruechen, mit Unicode, leer, sehr lang. Was macht
   `name_from_pattern`? Was macht der Playbook-Append damit?
3. **Playbook-Kappung an Grenzfaellen** (`learnings.rs::excerpt_from`): `max_chars`
   exakt auf der Grenze, ein einzelner Bullet laenger als das Budget, ein Abschnitt
   ohne Bullets, beide Abschnitte leer, Bullets mit Mehrbyte-Zeichen (kappt es
   mitten in einem UTF-8-Zeichen und panikt?).
4. **Merge-Guards** (`workers.rs::merge_worker`): falsche Board-Spalte, roter
   Test-Gate-Status, noch laufende Agent-Session, fehlender Branch. Jede Kombination
   muss ehrlich scheitern, keine darf durchrutschen.
5. **Testgate** (`testgate.rs`): `gate_result` mit Exit 0, Exit ungleich 0, `None`
   (Signal), und Timeout-Flag gesetzt. Die Debounce: kann ein zweiter Lauf starten,
   waehrend einer laeuft oder schon bestanden hat?
6. **Critic-Parser gegen kaputtes Skill-Output** (`critic.rs::parse_candidates`):
   gar kein Block, mehr als drei Bloecke, `LEARNING` ohne `PATTERN`, `PATTERN` ohne
   `LEARNING`, vertauschte Reihenfolge, Bullet-Praefixe, Grossschreibung, Muell
   davor und danach, ein `LEARNING`, das ueber viele Zeilen laeuft, leerer String.
7. **Rollen-Spawn mit `Unsupported`-Profil** (`workers.rs`): ein Basis-Profil ohne
   Prompt-Kanal muss mit der exakten Meldung
   `Variante nicht spawnbar (kein Prompt-Kanal)` scheitern. Ausserdem: nicht
   approved, fremdes Basis-Profil, unbekannte Id.
8. **Freie Jagd**: wenn dir unterwegs etwas auffaellt, das keiner der Punkte
   abdeckt — nimm es mit.

## Konventionen

Kommentare **Englisch**, Testnamen beschreibend im Stil der vorhandenen
(`the_verdict_follows_the_exit_code_and_recognises_a_timeout`), keine neuen
Dependencies. Nutze die vorhandenen Test-Fixtures und `crate::testutil::TempDir`
statt eigene Infrastruktur zu bauen.

## Gates

    cd src-tauri && CARGO_BUILD_JOBS=2 cargo test
    cd src-tauri && CARGO_BUILD_JOBS=2 cargo clippy --all-targets -- -D warnings

**Immer** `CARGO_BUILD_JOBS=2`, **niemals `CARGO_PROFILE_*`**. **Frag mich vor jedem
cargo-Lauf per `orca orchestration send --type escalation` um das GO** — es baut nur
ein Worker gleichzeitig. Kein blockierendes `ask`, kein Pollen von
`orca orchestration check`; ich erreiche dich ueber dein Terminal.

Am Ende muss die Suite **gruen** sein: bestandene neue Tests bleiben aktiv,
fehlschlagende bekommen `#[ignore]` plus Kommentar und wandern in deinen Bericht.

## Abgabe

1. Bericht `.pa/review_p16_d1.md`: pro gebrochenem Fall Datei:Zeile, Schweregrad
   (kritisch/schwer/mittel/niedrig), der Test der es zeigt, und was du fuer die
   Ursache haeltst. Dazu eine Liste der Tests, die gehalten haben — das ist die
   Aussage „hier ist es nachweislich in Ordnung".
2. `worker_done` in 3 Saetzen: wie viele Tests neu, wie viele Befunde, Gate-Stand.

Kein Commit, kein Push.
