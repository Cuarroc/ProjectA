# Spec-First-Review: Multi-Harness-Konfiguration (`.pa/task_multi_harness.md`)

## Kontext

Du befindest dich im Repo von **ProjectA** (Tauri 2: Rust-Kern `src-tauri/src/`,
React-Frontend `src/`). Repo-Regel seit 08.09. (`docs/decisions.md`):
Nahtstellen-/Trust-Specs bekommen **vor** der Implementierung ein
Multi-Anbieter-Spec-Review. Du bist einer von drei unabhängigen Reviewern;
du hattest keinen Anteil an der Spec (M2).

Review-Objekt: **`.pa/task_multi_harness.md`** (`Status: entwurf`) —
nutzerdefinierte Harnesses (Claude Code, Codex, DeepSeek …) als Daten statt
Rust-Enum, aufbauend auf der Vermessung
`.pa/report_harness_vermessung_2026-09-09.md`.

Deine Aufgabe ist nicht, die Spec zu loben. Deine Aufgabe ist, Gründe zu
finden, sie NICHT so auszuführen — mit Belegen aus diesem Repo.

## Pflichtlektüre (mit Datei:Zeile zitieren)

1. `.pa/task_multi_harness.md` — das Review-Objekt
2. `.pa/report_harness_vermessung_2026-09-09.md` — die Vermessung
3. `src-tauri/src/profiles.rs`, `src-tauri/src/capabilities.rs` — Ist-Zustand
4. Die sechs genannten Rest-Stellen: `submit_guard.rs` (Trust-Dialoge),
   `workers.rs` / `scout.rs` / `api.rs` (Rollenbindung — `api.rs` wird gerade
   von einer anderen Instanz bearbeitet, Zeilen können driften),
   `oneshot.rs`, `routing.rs`, `hooks.rs`, `providers.rs`
5. `docs/decisions.md` 09.09. (Multi-Harness) und 08.09. (Spec-First)
6. `STAND.md` §3 (Lanes)

## Mindestens zu prüfen

1. **Nachweis-Fälschbarkeit** (vom Autor selbst als größtes Risiko benannt):
   die Pflicht-Prüfung beruht auf Fixture + Test im Repo. Wer beides fälscht
   oder die Fixture nach einem Harness-Update nicht nachzieht, trägt NT-17
   als getarnt geprüft weiter. Reicht die Spec-Antwort (eingeschränkter Modus
   + Badge)? Was fehlt (Fixture-Aktualität, Harness-Versionsbindung)?
2. **Schema-Härte:** „unbekannte Felder = Lade-Fehler" — verträgt sich das mit
   bestehenden `agents.json`-Beständen und der Vererbung? Prüfe den Lader in
   `profiles.rs`.
3. **Rote Tests rot-fähig?** Stichproben gegen den heutigen Code — besonders
   der `proven`-Gate-Test (existiert heute nicht) und der Trust-Dialog-Test.
4. **Lanes:** sind die Fenster-Zuordnungen korrekt (STAND.md §3:
   `workers.rs` → f4_guard, `api.rs` → f4_authority, main.rs-Serie,
   SettingsView durch die andere Instanz belegt)?
5. **Vollständigkeit gegen die Vermessung:** alle sechs Reste adressiert?
   Wurde etwas fallengelassen oder still hinzugefügt?
6. **Verhältnis zu F-CORE-3:** die Spec setzt den Zustellnachweis aus
   `.pa/task_f_core3_delivery.md` (Rev 3) voraus — ist die Abhängigkeit
   korrekt beschrieben (Baustein A dort ist selbst noch nicht aktiviert)?

## Regeln

- Befund nur mit Beleg (Datei:Zeile/Zitat), Schaden, konkretem Vorschlag.
- Maximal 12 Befunde, nach Schwere. Tragfähiges knapp unter „Was trägt".
- Deutsch. Nur lesen, nichts verändern.

## Ausgabeformat (exakt einhalten)

URTEIL: <ausführbar | überarbeiten | ablehnen>
BEGRÜNDUNG: <3–6 Sätze>

BEFUNDE (nach Schwere sortiert, maximal 12):

### H-NN — <Titel>
- Schwere: <hoch|mittel|niedrig>
- Behauptung: <Zitat>
- Beleg: <Datei:Zeile>
- Vorschlag: <konkret>

## Was trägt
<max. 5 Aufzählungspunkte>
