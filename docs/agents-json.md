# `agents.json` — einen Agenten hinzufügen, ohne den Kern anzufassen

Stand: 09.09.2026. Quelle der Wahrheit sind `src-tauri/src/profiles.rs`
(`ProfileOverride`, `load_overrides`) und `src-tauri/src/capabilities.rs`
(`AgentCapabilities`); diese Datei erklärt **wozu** und zeigt ein
durchgerechnetes Beispiel. Der JSON-Block unten wird von
`profiles.rs::the_documented_openinterpreter_profile_parses` geparst — Doku und
Code können nicht auseinanderdriften, ohne dass ein Test rot wird.

## Wo die Datei liegt

Neben der ausführbaren Datei (`profiles.rs::override_path`). In einem Checkout
also `src-tauri/target/debug/agents.json` bzw. `.../release/agents.json`; das
Live-Dev-HQ löst denselben Pfad auf und schreibt dorthin, wenn man ein
Team-Profil über die UI anlegt (`scripts/lib/hq-live-lib.mjs`,
`resolveAgentsFile`). `PROJECTA_AGENTS_FILE` überschreibt die Auflösung für das
HQ.

Ein kaputtes oder fehlendes `agents.json` ist **nie** fatal: `load_overrides`
verwirft es mit einer Zeile auf stderr und startet mit den Built-ins.

**Achtung beim Downgrade** (Befund A-3 im Dual-Review): verworfen wird immer die
**ganze Datei**, nicht der einzelne kaputte Eintrag. Eine Datei, die
`"mode": "conventionAt"` benutzt, ist für eine ProjectA-Version vor diesem
Stand ein unbekannter Tag — sie verliert damit auch die `env`- und
`fallback`-Einstellungen aller anderen Profile in derselben Datei. Und weil
`ProfilesFile` `#[serde(untagged)]` ist, sagt die stderr-Zeile nur „data did
not match any variant of untagged enum ProfilesFile"; der eigentliche Schuldige
wird nicht genannt. Wer zwischen Versionen wechselt, hält zwei Dateien vor.

## Was ein Eintrag kann

`id`, `name`, `command` sind Pflicht; `args`, `caps`, `env`, `fallback` und
`envPolicy` (siehe unten) sind optional. Gleiche `id` wie ein Built-in **ersetzt** es, eine neue `id` wird
angehängt. Fehlende Capabilities erben vom gleichnamigen Built-in, sonst von
der `<basis>-<variante>`-Verwandtschaft, sonst von den vorsichtigen Defaults —
und die sind bewusst vorsichtig: `AgentCapabilities::default()` heißt
`SkillsDiscovery::Unsupported`, also **keine Skill-Packs**.

`env` ist der Hebel, mit dem ein Profil auf einen Router oder ein eigenes
Home gezeigt wird (`ANTHROPIC_BASE_URL`, `CODEX_HOME`), ohne dass ein Modul den
Agenten beim Namen kennen muss. `fallback` nennt das Profil, das übernimmt,
wenn dieses durch Quota oder Budget blockiert ist — bei jedem Built-in leer,
damit ein nie konfiguriertes ProjectA niemanden still auf eine fremde Rechnung
umleitet.

## `envPolicy` — welche Umgebung der Agent erbt

Stand: 24.09.2026 (W5-02b, W5-02b2, W5-02b6). Quelle der Wahrheit sind
`profiles.rs` (`EnvPolicy`, `EnvIsolation`) und `pty/agent_env.rs` (`ALLOWED`,
`ALLOWED_PREFIXES`, `looks_secret`).

```json
{ "id": "kimi", "name": "Kimi CLI", "command": "kimi", "args": ["--auto"],
  "envPolicy": { "isolation": "allowlist",
                 "passthrough": ["USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA"] } }
```

- **`isolation`**: `allowlist` (Voreinstellung), `inherit` oder `strict`.
  - `allowlist`: Der Agent bekommt nur die Namen aus `ALLOWED` und die Familien
    aus `ALLOWED_PREFIXES`. Davon fällt alles weg, was nach Geheimnis aussieht
    (`TOKEN`, `SECRET`, `KEY`, `PASSWORD`, … im Namen, `_PAT`/`_AUTH` am Ende).
    `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `MOONSHOT_API_KEY` und `GH_TOKEN`
    erreichen den Agenten also nicht. Git und `gh` finden die gespeicherte
    Anmeldung des Nutzers weiterhin, ein Worker kann also weiter pushen.
  - `inherit`: die volle App-Umgebung wie vor W5-02b. Gilt nur noch, wenn sie
    ausdrücklich gesetzt ist.
  - `strict`: `allowlist` plus gesperrte git- und `gh`-Anmeldung. Lokale
    Commits gehen, Push und `gh` nicht. Nicht Voreinstellung, solange Worker
    selbst pushen.
- **`passthrough`**: geerbte Namen, die das Profil trotz Allowlist oder
  Geheimnisfilter braucht. Der Wert kommt immer aus der App-Umgebung.

Zur Basis-Allowlist gehören unter anderem `PATH`, `SYSTEMROOT`, `TEMP`/`TMP`
und die Home-Variablen `HOME`, `USERPROFILE`, `HOMEDRIVE`/`HOMEPATH`, `APPDATA`
und `LOCALAPPDATA`. Über die Home-Variablen findet jede CLI ihre eigene
Anmeldedatei (`~/.claude`, `~/.codex`, `~/.kimi-code`, das Datenverzeichnis von
opencode). Dazu kommen die Präfixe der Anbieter- und Build-Werkzeuge
(`ANTHROPIC_`, `KIMI_`, `MOONSHOT_`, `CARGO_`, `NODE_`, …), jeweils ohne
Geheimnis-Namen.

**Eingebaute Profile:** Alle stehen auf `allowlist`. `claude` reicht
`CLAUDE_CODE_MAX_CONTEXT_TOKENS` durch, eine nicht geheime Einstellung, die
der Filter wegen `TOKEN` sonst verwerfen würde. `kimi` (Kimi Code v2, Anmeldung
per OAuth-Datei unter `~/.kimi-code`, **nicht** über `MOONSHOT_API_KEY`) nennt
die vier Home-Variablen `USERPROFILE`, `HOME`, `APPDATA` und `LOCALAPPDATA`
ausdrücklich. Heute stehen sie ohnehin auf der Basis-Allowlist. Der Eintrag
im Profil sorgt dafür, dass Kimi seine Login-Datei auch dann findet, wenn
diese Liste einmal schrumpft.

**Verhaltensänderung (W5-02b6):** Ein Eintrag ohne `envPolicy` oder ohne
`isolation` läuft jetzt unter `allowlist`, vorher war es `inherit`. Das gilt
für neue ids und für den Ersatz eines Built-ins, also auch für die Profile aus
`src-tauri/resources/agents-omniroute.json`. Die tragen ihre Router-Variablen
selbst in `env`, und explizite Werte gehen immer durch. Wer ein Profil hat,
das von einem geerbten Schlüssel lebt (etwa `OPENROUTER_API_KEY` für ein
opencode-Profil), nennt ihn unter `passthrough`, oder, als Notausgang, setzt
`"envPolicy": { "isolation": "inherit" }`.

**Kimi von Hand prüfen:** Die Unit-Tests belegen die gebaute Umgebung
(`agent_env.rs::builtin_kimi_env_keeps_its_home_and_drops_foreign_secrets`).
Ob Kimi damit startet und seine Konfiguration findet, prüft auf einer Maschine
mit installiertem Kimi eine lokale Probe ohne Modellaufruf:
`cargo test --bin projecta -- --ignored manual_kimi_starts_under_allowlist -- --nocapture`.
Sie vergleicht `kimi provider list` unter gefilterter und voller Umgebung.
Die Anmeldung selbst lässt sich nur mit einem echten Prompt prüfen. Der
kostet ein Modellkontingent und bleibt deshalb ein manueller Schritt:
In ProjectA einen Kimi-Worker starten oder im Terminal
`kimi -p "ping"` aufrufen. Für den zweiten Weg müssen vorher die geheimen
Variablen aus der Sitzung entfernt werden, z. B. in PowerShell
`Remove-Item Env:MOONSHOT_API_KEY`. Antwortet Kimi, trägt die Datei-Anmeldung.

## Beispiel: Open Interpreter

```json
{
  "profiles": [
    {
      "id": "interpreter",
      "name": "Open Interpreter",
      "command": "interpreter",
      "args": [],
      "caps": {
        "skills": { "mode": "conventionAt", "dir": ".agents/skills" }
      }
    }
  ]
}
```

### Was daran belegt ist

Aus dem Quelltext von `openinterpreter/openinterpreter` (Codex-Fork, Rust):

- **`command` ist `interpreter`.** `OPEN_INTERPRETER_COMMAND_NAME = "interpreter"`
  (`codex-rs/product-info/src/lib.rs:3`), ausgewählt über
  `Product::command_name()` (ebd. Zeile 94). Das Crate heißt intern weiter
  `codex` und `default-run = "codex"` — das ist der Fork-Name, nicht der
  Befehl, den ein Nutzer tippt (`FORK_BRANDING.md`: „Do not globally replace
  `codex`"). `i` ist ein Alias.
- **Skills liegen unter `.agents/skills`.** `AGENTS_DIR_NAME = ".agents"` und
  `SKILLS_DIR_NAME = "skills"`
  (`codex-rs/ext/skills/src/host_roots.rs:23-24`); `repo_agents_skill_roots`
  probiert `<verzeichnis>/.agents/skills` für jedes Verzeichnis zwischen
  Projektwurzel und Arbeitsverzeichnis (ebd. 146-152) und nimmt es als
  `SkillScope::Repo` auf. **Nicht** `.claude/skills` — deshalb gibt es
  `SkillsDiscovery::ConventionAt` überhaupt.
- **Es gibt einen nicht-interaktiven Pfad:** `Subcommand::Exec`, „Run the agent
  non-interactively", sichtbarer Alias `e` (`codex-rs/cli/src/main.rs:133-136`).

### Was bewusst leer bleibt

Alles außer `skills` steht auf `AgentCapabilities::default()` — dieselbe
Ausgangslage, die das Built-in `codex` hat. Das ist kein Versehen:

- **`dialect`** (Permission- und Quota-Phrasen) und **`readinessMarker`** sind
  Strings, die im **Terminalstrom** vorkommen müssen. Sie aus Quelltext zu
  raten ist genau der Selbstbetrug, den `AGENTS.md` beschreibt: was die API-
  Crates an Fehlertexten führen, ist nicht zwingend das, was die TUI rendert.
  Diese Felder gehören gemessen, nicht abgeschrieben — siehe unten.
- **`lifecycle`** bleibt `heuristic`: der Fork bringt keine Hooks-Datei mit,
  die auf ProjectA zurückzeigt. Das Board rät bei diesem Agenten also, wie es
  bei Codex und OpenCode auch rät.
- **`systemPrompt`** bleibt `unsupported`, bis der passende Schalter gemessen
  ist. Orchestratoren verweigern ein Profil ohne System-Prompt — das ist die
  gewollte Bremse, nicht ein Mangel.
- **`env`** bleibt leer. `INTERPRETER_HOME` (Standard `~/.openinterpreter`,
  Codex-Alias `CODEX_HOME`) würde jedem Worker ein eigenes Home geben —
  verlockend für Isolation, aber dort liegen auch die Anmeldedaten. Ein
  gesetztes Home ohne vorherigen Login macht jeden Worker anonym. Erst
  einloggen, dann isolieren.
- **`fallback`** bleibt leer. Wer `interpreter` als Ausweichpfad *bei
  Kontingent-Block* will, setzt ihn beim blockierten Profil, nicht hier:
  `{ "id": "claude", "name": "Claude Code", "command": "claude",
  "fallback": "interpreter" }`. Das ist eine Kostenentscheidung und gehört
  bewusst getroffen.

### Der Beleg, der noch fehlt

Dieses Profil ist am Quelltext hergeleitet, **nicht an einem Lauf gemessen**.
Der Installer (`https://www.openinterpreter.com/install`) ist aus der
Web-Umgebung nicht erreichbar, in der die Datei entstand. Was auf einer
Maschine mit installiertem `interpreter` nachzuholen ist:

1. **Dialekt aufnehmen.** Einen Worker starten, eine Schreiboperation
   auslösen, den Permission-Prompt aus dem Scrollback wörtlich nach
   `caps.dialect.permission` übernehmen; dasselbe für die Quota-Meldung, wenn
   sie das erste Mal auftritt. Vorher steht in beiden Listen nichts, und die
   generischen Phrasen aus `status.rs` müssen tragen.
2. **Readiness prüfen.** Zeigt sich NT-17 (Eingabe vor dem Input-Loop wird
   verschluckt), gehört der Prompt-Text als `readinessMarker` hinein.
3. **Skills belegen.** Ein Pack in `<worktree>/.agents/skills/<name>/SKILL.md`
   legen und nach etwas fragen, das **nur dort** steht (Arbeitsregel 2: eine
   Frage, deren Antwort im Prompt vorkommt, prüft nichts). Antwortet der Agent
   damit, ist `conventionAt` belegt statt hergeleitet.
4. **Nutzen belegen.** Denselben Task einmal über das bisherige Profil und
   einmal über `interpreter`, dann zwei Dinge nebeneinander: ein **Commit auf
   dem Worker-Branch** und die **Kostenzeile in Insights**. Kein Commit = kein
   Beleg.

Erst danach bekommt Open Interpreter eine eigene Zeile in der Anbietertabelle
von `AGENTS.md` — „billig" ist keine belegte Werkzeugeigenschaft.
