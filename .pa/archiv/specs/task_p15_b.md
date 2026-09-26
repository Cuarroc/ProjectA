# Phase 15 / Worker B — Spawnbarkeit der Varianten, Tauri-Verdrahtung

Status: historisch

Repo: `<repo-root>`, Branch `main`, im Repo-Root (kein Worktree).
**Nicht committen, nicht pushen, nicht mergen.**

## Deine Dateien (EXKLUSIV)

- `src-tauri/src/workers.rs`
- `src-tauri/src/profiles.rs`
- `src-tauri/src/queue.rs`
- `src-tauri/src/main.rs`
- `src-tauri/tauri.conf.json`

**Nicht anfassen:** `store.rs`, `roles.rs`, `learnings.rs`, `api.rs`, `bin/pa.rs`,
`resources/role-distiller/` — die gehoeren Worker A, der parallel arbeitet.
Kein Frontend.

## Abhaengigkeit auf Worker A

`roles.rs` und die `role_variants`-Methoden auf `Store` entstehen parallel. Du
schreibst gegen die unten fixierten Signaturen. Solange A nicht fertig ist, schlagen
Builds mit "unresolved import" fehl — erwartet, nicht deine Baustelle, und du legst
**keine** eigenen Stubs in fremden Dateien an.

Arbeitsreihenfolge: erst `workers.rs` (das Spawn-Verhalten inklusive Tests mit
Mock-Profilen), dann `queue.rs`/`profiles.rs` falls ueberhaupt noetig, zuletzt
`main.rs`.

### Von Worker A garantiert

    // store.rs
    pub struct RoleVariant {
        pub id: String, pub project_id: String, pub name: String,
        pub base_profile_id: String, pub pattern_label: String,
        pub system_prompt_addition: String, pub version: i64,
        pub status: String, pub created_at: i64,
    }
    pub const ROLE_PENDING: &str = "pending";
    pub const ROLE_APPROVED: &str = "approved";
    pub const ROLE_REJECTED: &str = "rejected";

    store.get_role_variant(id) -> Result<Option<RoleVariant>, String>
    store.list_role_variants(project_id: Option<&str>, status: Option<&str>) -> Result<Vec<RoleVariant>, String>

    // roles.rs
    pub fn set_app(app: AppHandle)
    pub async fn approve_variant(store: &Store, id: &str) -> Result<(), String>
    pub async fn reject_variant(store: &Store, id: &str) -> Result<(), String>
    pub fn display_name(base_profile_name: &str, variant: &RoleVariant) -> String

## Konventionen

Kommentare/Doc-Comments **Englisch**, UI-Strings Deutsch, **keine neuen
Dependencies**, Rust-Tests inline. Kein `npm run tauri dev`.

---

## 1. `workers.rs` — Varianten spawnen, OHNE Signaturbruch

**Wichtig, das ist eine harte Vorgabe:** `create_worker` und `create_queen` behalten
ihre heutige Signatur **exakt**. Sie haben zusammen rund 15 Aufrufstellen in
`api.rs`, `main.rs`, `queue.rs` und den Tests; eine Signaturaenderung wuerde quer
durch fremde Dateien schlagen. Genau daran hat Phase 14 Zeit verloren.

Stattdessen zwei neue Funktionen, die alte werden duenne Wrapper:

    pub async fn create_worker(store, agents, project_id, task, profile_id, spawned_by)
        -> Result<Worker, String>
    {
        create_worker_as_role(store, agents, project_id, task, profile_id, spawned_by, None).await
    }

    /// `role_variant_id` selects an approved variant of `profile_id`; `None`
    /// spawns the plain profile exactly as before.
    pub async fn create_worker_as_role(
        store: &Store,
        agents: &dyn AgentControl,
        project_id: &str,
        task: &str,
        profile_id: &str,
        spawned_by: Option<&str>,
        role_variant_id: Option<&str>,
    ) -> Result<Worker, String>

Analog `create_queen_as_role(...)` mit demselben zusaetzlichen Parameter am Ende.

### Verhalten bei gesetzter Variante

1. Variante laden. Unbekannte id -> `Err("unknown role variant: {id}")`.
2. Status != `approved` -> `Err("role variant '{name}' is not approved")`. Eine
   pending Variante ist ein Vorschlag, kein Werkzeug.
3. `variant.base_profile_id != profile_id` -> `Err`, mit beiden Ids im Text.
4. `variant.system_prompt_addition` ueber die `caps.system_prompt`-Mechanik des
   **Basis-Profils** injizieren:
   - `SystemPrompt::Arg { flag }` -> zusaetzliches `flag` + Text an `args`.
   - `SystemPrompt::File { flag, ext }` -> ueber
     `crate::hooks::write_worker_file(worker_id, "role", ext, &addition)` in eine
     eigene Datei und `flag` + Pfad an `args`. Nutze einen **anderen** Dateinamen
     als `"agent"`, damit eine Queen-Variante ihren Rollen-Zusatz nicht ueber ihren
     eigenen System-Prompt schreibt.
   - `SystemPrompt::Unsupported` -> `Err("Variante nicht spawnbar (kein Prompt-Kanal)")`.
     Ehrlich scheitern statt still ohne den Zusatz zu laufen — genau das ist der
     Punkt der Anforderung.
5. Bei einer Queen ist der Rollen-Zusatz zusaetzlich zu ihrem Queen-System-Prompt und
   dem Playbook-Block anzuhaengen, nicht statt dessen. Reihenfolge: Rollen-Prompt,
   dann Playbook — die kuratierte Rolle steht ueber dem rohen Playbook.
6. **Kenntlichmachung:** Task-Text und Branch tragen den Varianten-Namen.
   - Der Board-Task bekommt den Namen vorangestellt, z. B. `[Test-Fixer] <task>`.
     Nutze `roles::display_name` **nicht** dafuer — dort steckt der Basis-Profilname
     drin, der auf der Karte schon steht. Nur `variant.name`.
   - Der Branch bekommt einen aus dem Namen abgeleiteten Slug. Halte dich an die
     bestehende `worktree::branch_for`-Konvention und fuege nur einen
     kleingeschriebenen, auf `[a-z0-9-]` reduzierten Zusatz ein. Reine
     String-Logik separat und **getestet** — ein Variantenname mit Umlauten,
     Leerzeichen oder Slashes darf keinen kaputten Branch erzeugen.

### Tests (Pflicht)

Mit einem Mock-Profil je Pfad, nach dem Vorbild der vorhandenen Tests um
`workers.rs:1654` und `:1668` (dort stehen schon `SystemPrompt::Arg`- und
`File`-Fixtures):

- Arg-Pfad: `args` enthaelt Flag und Zusatz.
- File-Pfad: eine Datei entsteht, `args` zeigt darauf, Inhalt stimmt.
- `Unsupported` -> die exakte Fehlermeldung.
- Nicht-approved Variante -> Fehler.
- Fremdes Basis-Profil -> Fehler.
- Branch-Slug: Umlaute/Leerzeichen/Slashes werden sauber reduziert.
- `create_worker` ohne Variante verhaelt sich **unveraendert** (bestehende Tests
  muessen ohne Anpassung gruen bleiben).

## 2. `profiles.rs` und `queue.rs`

Sehr wahrscheinlich **keine Aenderung noetig** — `list_agent_profiles` bleibt laut
Spec unveraendert, und `queue.rs` ruft den unveraenderten `create_worker`-Wrapper.
Sie gehoeren dir nur, damit niemand sonst hineinschreibt. Fass sie nur an, wenn der
Compiler dich dazu zwingt, und sag mir dann warum.

## 3. `main.rs`

- `mod roles;` in den mod-Block (alphabetisch). **Das brauchst du frueh** — ohne die
  Zeile wird Worker As `roles.rs` gar nicht kompiliert und er kann nicht testen.
  Trag sie ein, sobald die Datei existiert, und sag mir Bescheid.
- Beim Startup `roles::set_app(app.handle().clone())` aufrufen, an derselben Stelle
  an der die anderen Startup-Installationen stehen (`engine.set_store(...)` und was
  Phase 14 dort ergaenzt hat).
- Neue Tauri-Commands, **exakt diese Namen**, Argumente camelCase:

      #[tauri::command] async fn list_role_variants(store, project_id: String) -> Result<Vec<RoleVariant>, String>
      #[tauri::command] async fn approve_role_variant(store, id: String) -> Result<(), String>
      #[tauri::command] async fn reject_role_variant(store, id: String) -> Result<(), String>

  `list_role_variants` liefert **nur** `pending` und `approved`, nicht `rejected`
  (zwei Aufrufe an `store.list_role_variants` oder ein Filter im Code — deine Wahl).
- `create_worker`-Command bekommt ein **optionales** Argument:

      #[tauri::command]
      async fn create_worker(
          ..., project_id: String, task: String, profile_id: String,
          role_variant_id: Option<String>,
      ) -> Result<Worker, String>

  und ruft `workers::create_worker_as_role(..., role_variant_id.as_deref())`.
  `Option<String>` ist wichtig: ein Aufruf ohne das Feld muss weiter funktionieren.
- Alle drei neuen Commands in `generate_handler!` eintragen.
- `ApiBackend`: nur was der Compiler verlangt. Worker A erweitert das
  `ControlBackend`-Trait um `list_role_variants`, `approve_role_variant`,
  `reject_role_variant` — **du** implementierst sie in `impl ControlBackend for
  ApiBackend` (main.rs:1113), analog zu den `learnings`-Methoden aus Phase 14. Das
  war letzte Phase der Blocker fuer Worker A, also zieh es vor, sobald As Trait steht.

## 4. `tauri.conf.json`

`resources/role-distiller/**/*` neben den bestehenden Skill-Ressourcen eintragen.
Der Ordner kommt von Worker A; der Eintrag ist deiner.

## Gates

    cd src-tauri && CARGO_BUILD_JOBS=2 cargo test
    cd src-tauri && CARGO_BUILD_JOBS=2 cargo clippy --all-targets -- -D warnings

**Immer** `CARGO_BUILD_JOBS=2`, auch beim ersten Versuch. **Niemals `CARGO_PROFILE_*`**
setzen. **Frag mich vor jedem cargo-Lauf per `orca orchestration send --type
escalation` um das GO** — es baut immer nur ein Rust-Worker gleichzeitig. Nutze
**kein** blockierendes `ask`, das kommt bei mir nicht an. Fehler aus Worker As Dateien
schickst du mir wortgetreu, statt sie selbst zu reparieren.

## Abschluss

Kein Commit. `worker_done` mit 3 Saetzen: was gebaut, wie die Gates stehen, was offen.
