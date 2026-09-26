# Phase 15 / Worker A — role_variants, roles.rs, Distiller-Skill, API, CLI

Status: historisch

Repo: `<repo-root>`, Branch `main`, im Repo-Root (kein Worktree).
**Nicht committen, nicht pushen, nicht mergen.**

## Deine Dateien (EXKLUSIV)

- `src-tauri/src/store.rs`
- `src-tauri/src/roles.rs` (NEU)
- `src-tauri/src/learnings.rs` — **nur** der Approve-Hook, sonst nichts
- `src-tauri/resources/role-distiller/SKILL.md` (NEU)
- `src-tauri/src/api.rs`
- `src-tauri/src/bin/pa.rs`

**Nicht anfassen:** `workers.rs`, `profiles.rs`, `queue.rs`, `main.rs`,
`tauri.conf.json` — die gehoeren Worker B, der parallel arbeitet. Kein Frontend.

`mod roles;` traegt **Worker B** in `main.rs` ein. Bis das passiert, wird `roles.rs`
nicht mitkompiliert. Melde dich per `orca orchestration send --type escalation` bei
mir, sobald `roles.rs` steht — **nicht** per blockierendem `ask`, das kommt bei mir
nicht an.

## Konventionen

Kommentare/Doc-Comments **Englisch**, UI-Strings Deutsch, **keine neuen
Dependencies**, Rust-Tests inline. Vorbild: die `learnings`-Arbeit aus Phase 14 in
denselben Dateien. Kein `npm run tauri dev`.

---

## 1. `store.rs`

Neues Statement im `STATEMENTS`-Block. **Achtung:** die Laengenangabe von
`const STATEMENTS: [&str; N]` muss mitwachsen — genau daran ist Phase 14 gescheitert.

    CREATE TABLE IF NOT EXISTS role_variants (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        base_profile_id TEXT NOT NULL,
        pattern_label TEXT NOT NULL,
        system_prompt_addition TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL
    )

    CREATE INDEX IF NOT EXISTS role_variants_project_id
        ON role_variants (project_id, created_at, id)

Struct exakt wie der fixierte camelCase-Vertrag:

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
    #[serde(rename_all = "camelCase")]
    pub struct RoleVariant {
        pub id: String,
        pub project_id: String,
        pub name: String,
        pub base_profile_id: String,
        pub pattern_label: String,
        pub system_prompt_addition: String,
        pub version: i64,
        pub status: String,
        pub created_at: i64,
    }

    pub const ROLE_PENDING: &str = "pending";
    pub const ROLE_APPROVED: &str = "approved";
    pub const ROLE_REJECTED: &str = "rejected";

Methoden auf `Store` (Ids via `new_id("rv")`, Zeit via `now_unix_secs()`):

- `insert_role_variant(&self, variant: &RoleVariant) -> Result<(), String>`
- `list_role_variants(&self, project_id: Option<&str>, status: Option<&str>) -> Result<Vec<RoleVariant>, String>`
  — `ORDER BY created_at, rowid`
- `get_role_variant(&self, id: &str) -> Result<Option<RoleVariant>, String>`
- `set_role_variant_status(&self, id: &str, status: &str) -> Result<(), String>`
  — unbekannte id => `Err("unknown role variant: {id}")`
- `count_approved_learnings(&self, project_id: &str, pattern_label: &str, profile_id: &str) -> Result<i64, String>`
  — zaehlt `learnings` mit `status='approved'` und passendem Tripel
- `approved_variant_for(&self, project_id: &str, pattern_label: &str, profile_id: &str) -> Result<Option<RoleVariant>, String>`
  — die **hoechste** approved Version zum Schluessel (`ORDER BY version DESC LIMIT 1`)
- `latest_variant_for(&self, project_id: &str, pattern_label: &str, profile_id: &str) -> Result<Option<RoleVariant>, String>`
  — hoechste Version **egal welcher Status**; brauchst du fuer die Dublettensperre
    und die Versionsvergabe

Tests: Round-Trip, Projekt-Scoping, Status-Filter, `count_approved_learnings` zaehlt
nur approved und nur das passende Tripel, `approved_variant_for` liefert die hoechste
Version.

## 2. `resources/role-distiller/SKILL.md` (NEU)

Skill-Name `role-distiller`, **Englisch**, Frontmatter im Format von
`resources/learning-critic/SKILL.md` (lies die als Vorlage — sie ist gut).

Input: die approved Learnings eines `(pattern_label, base_profile)`-Schluessels plus
Pattern-Label und Basis-Profilname.

Output **streng**, nichts davor oder danach:

    NAME: <kurzer Rollenname, 2-4 Woerter, ohne Profilpraefix>
    SYSTEM_PROMPT:
    <5-15 Zeilen umsetzbarer Zusatz>

Regeln im SKILL.md:

- The name says what this variant is *for*, not that it is special. Prefer
  `Test-Fixer` over `Enhanced Claude`.
- The prompt is an **addition** to an existing role, never a replacement: it must
  read correctly when appended under another system prompt.
- Only durable instructions the learnings actually support. Never invent policy.
- Imperative, concrete, second person. No preamble, no praise, no restating the
  learnings verbatim as a list.
- Never output anything but the two fields.

## 3. `roles.rs` (NEU)

Modul-Doc: warum Varianten nur **vorgeschlagen** und nie automatisch aktiviert werden
(Drift-Risiko), und dass der Vorschlag ein Nebenprodukt des Approves ist und ihn
niemals scheitern lassen darf.

### AppHandle ohne Signaturbruch

`approve_learning` bekommt **keinen** neuen Parameter — das wuerde in `api.rs`,
`main.rs` und den Fake-Backend-Tests durchschlagen. Stattdessen wie
`StatusEngine::set_app` aus Phase 14:

    /// Installed once at startup by `main.rs`; without it the distiller falls
    /// back to the source checkout, which is correct in development and simply
    /// yields the plain proposal in a packaged build.
    pub fn set_app(app: AppHandle)

    /// The bundled skill, via the stored handle when there is one.
    fn skill_dir() -> Option<PathBuf>

Nutze `std::sync::OnceLock<AppHandle>`. `skill_dir()` ruft
`oneshot::bundled_skill_dir(app, SKILL_NAME)`, sonst `oneshot::dev_skill_dir(SKILL_NAME)`
falls dieses Verzeichnis existiert, sonst `None`.

    pub const SKILL_NAME: &str = "role-distiller";
    pub const DISTILL_TIMEOUT: Duration = Duration::from_secs(180);
    /// How many approved learnings on one key justify proposing a variant.
    pub const PROPOSE_THRESHOLD: i64 = 3;

### Der Vorschlag

    /// Propose a specialised variant when one pattern has earned it.
    /// `Ok(None)` is the normal answer.
    pub async fn maybe_propose_role(
        store: &Store,
        learning: &Learning,
    ) -> Result<Option<RoleVariant>, String>

Ablauf:

1. `learning.pattern_label` fehlt oder ist leer -> `Ok(None)`.
2. `count_approved_learnings(project_id, pattern_label, profile_id) < PROPOSE_THRESHOLD`
   -> `Ok(None)`.
3. `latest_variant_for(...)`:
   - eine Variante mit Status `pending` existiert -> `Ok(None)` (der Mensch hat den
     Vorschlag noch nicht angesehen; ihn zu verdoppeln waere Laerm).
   - eine `rejected` Variante als hoechste Version -> `Ok(None)`. Ein Nein ist ein
     Nein; erst eine spaetere approved Version macht ein neues Angebot sinnvoll.
   - eine `approved` Variante -> neuer Vorschlag mit `version = alt.version + 1`.
   - keine -> `version = 1`.
4. Die approved Learnings des Tripels laden (dafuer reicht `list_learnings` plus
   Filter im Code) und den Vorschlagstext bauen.
5. `insert_role_variant` mit Status `pending`, Ergebnis zurueckgeben.

### Destillation und Fallback

    /// The distilled proposal, or the plain one when the CLI cannot be used.
    /// Never returns an error: a failed distillation must not fail an approve.
    fn proposal_text(learnings: &[Learning], pattern_label: &str, base_profile: &str) -> (String, String)

Erst `skill_dir()` + `oneshot::run(...)` mit `DISTILL_TIMEOUT` versuchen und das
Ergebnis durch den Parser schicken. Bei jedem Fehler (kein Skill, kein CLI, Timeout,
Parse leer) den Fallback nehmen:

- Name: aus dem Pattern-Label, Bindestriche zu Leerzeichen, Woerter kapitalisiert.
- Prompt: eine kurze Einleitungszeile plus die Learnings als Bullets.

Der Parser ist **rein und getestet**:

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct Distilled { pub name: String, pub system_prompt: String }

    /// Parse the distiller's strict output. `None` when it is unusable.
    pub fn parse_distilled(raw: &str) -> Option<Distilled>

Regeln: `NAME:` und `SYSTEM_PROMPT:` case-insensitive am Zeilenanfang, fuehrende
Bullets tolerieren, der Prompt laeuft bis Dokumentende, beide Felder getrimmt, leerer
Name oder leerer Prompt -> `None`, Name auf 60 Zeichen begrenzen.

Ausserdem rein und getestet:

    /// "tests-fixen" -> "Tests Fixen"
    pub fn name_from_pattern(pattern_label: &str) -> String

    /// The display name a variant carries: "<Basis> · <Name> v<version>".
    pub fn display_name(base_profile_name: &str, variant: &RoleVariant) -> String

`display_name` nutzt das Mittelpunkt-Zeichen `·` und haengt `v<version>` nur ab
Version 2 an.

### Review-Aktionen

    pub async fn approve_variant(store: &Store, id: &str) -> Result<(), String>
    pub async fn reject_variant(store: &Store, id: &str) -> Result<(), String>

Nur Statuswechsel. `approve_variant` setzt zusaetzlich alle **aelteren approved**
Varianten desselben Schluessels auf `rejected`, damit immer genau eine aktiv ist —
kommentiere das, es ist die eigentliche Versionsmechanik.

Tests: Schwelle greift erst ab 3, Pattern fehlt -> None, pending blockiert,
rejected blockiert, approved erzeugt v2, `approve_variant` setzt die Vorgaengerin
zurueck, Parser-Faelle, `name_from_pattern`, `display_name` mit v1 und v2.
Fuer die Tests brauchst du **keinen** laufenden Claude — der Fallback-Pfad ist der
Testpfad.

## 4. `learnings.rs` — nur der Hook

In `approve_learning`, **nach** dem erfolgreichen `playbook_append`:

    // A learning that completes a pattern may earn a specialised variant. The
    // proposal is a by-product of the approve and must never fail it.
    if let Err(err) = crate::roles::maybe_propose_role(store, &learning).await {
        eprintln!("projecta: role proposal for {learning_id}: {err}");
    }

Sonst aendert sich in `learnings.rs` **nichts**. Signatur bleibt exakt wie sie ist.

Beachte: `approve_learning` gibt heute `playbook_append(...)` direkt zurueck. Bau das
so um, dass der Playbook-Fehler weiterhin das Ergebnis bestimmt und der Hook nur bei
Erfolg laeuft.

## 5. `api.rs`

| Methode | Pfad | Body | Antwort |
|---|---|---|---|
| GET | `/api/projects/<id>/roles` | `?status=` optional | `[RoleVariant]` |
| GET | `/api/roles` | `?projectId=`, `?status=` | `[RoleVariant]` |
| POST | `/api/roles/<id>/approve` | — | `{"ok": true}` |
| POST | `/api/roles/<id>/reject` | — | `{"ok": true}` |

Drei neue `ControlBackend`-Methoden, Doc-Tabelle im Modulkopf mitpflegen,
Fake-Backend + Router-Tests wie bei `learnings`. **`create_worker` und `create_queen`
im Trait bleiben unveraendert** — ueber die API wird keine Variante gespawnt.

## 6. `bin/pa.rs`

    pa roles list [--project <projectId>] [--status <pending|approved|rejected>]
    pa roles approve <roleVariantId>
    pa roles reject <roleVariantId>

Renderer analog `render_recommendation_list`: id, Status, Version, Name,
Pattern-Label, Basis-Profil. Usage im Modulkopf und im `--help` ergaenzen.
Im Orchestrator-/Queen-Prompt (falls du dort die `pa`-Liste findest) hoechstens
`pa roles list` ergaenzen — **kein** approve/reject, das Review ist menschlich.

## Gates

    cd src-tauri && CARGO_BUILD_JOBS=2 cargo test
    cd src-tauri && CARGO_BUILD_JOBS=2 cargo clippy --all-targets -- -D warnings

**Immer** `CARGO_BUILD_JOBS=2`, auch beim ersten Versuch — die Maschine hat wenig
RAM. **Niemals `CARGO_PROFILE_*`** setzen, das invalidiert ~400 Dependencies.
**Frag mich vor jedem cargo-Lauf per escalation um das GO** — es baut immer nur ein
Rust-Worker gleichzeitig. Fehler aus Worker Bs Dateien schickst du mir wortgetreu,
statt sie selbst zu reparieren.

## Abschluss

Kein Commit. `worker_done` mit 3 Saetzen: was gebaut, wie die Gates stehen, was offen.
