# Delta-Review W5-02b, Runde 2

Du hast Runde 1 dieses Pakets (Allowlist-Umgebung fuer Agenten-PTYs, ProjectA) reviewt. Unten stehen die Dispositionen des Autors und der Delta-Diff 3187ec6..HEAD. Pruefe: (1) Sind die als behoben markierten Befunde wirklich behoben? (2) Fuehrt der Delta-Diff neue Fehler ein (z. B. GIT_CONFIG_PARAMETERS-Quoting, Option-Signatur, Suffix-Regeln)? (3) Sind die Ablehnungen (K3, K6, K7/G2, teilweise K4) sachlich tragfaehig? Befunde mit Schwere, Datei/Zeile, Fix; sage, was du nicht pruefen konntest. Gesamturteil: freigeben / freigeben mit Auflagen / nicht freigeben.

## Dispositionen

# W5-02b — Dispositionen zu Review-Runde 1

Reviewer (anbieterfremd, Ollama Cloud): `kimi-k2.7-code` (K) und `glm-5.2` (G),
Protokolle `.pa/review_w5-02b_kimi-k2.7-code.md`, `.pa/review_w5-02b_glm-5.2.md`.
Kandidat: `3187ec6`. Beide Urteile: **freigeben mit Auflagen**. Beide halten die
Voreinstellung `inherit` für ehrlich begründet.

| # | Befund | Schwere | Disposition | Beleg |
|---|---|---|---|---|
| K1 | `gh_config_dir` fällt auf geteiltes `%TEMP%/projecta` zurück (unter Unix `/tmp`, Symlink/TOCTOU) | hoch | **behoben.** Kein Fallback mehr; ohne `app_local_data_dir` verweigert `strict` den Start. | `gh_config_dir(app, session_id) -> Option`, `apply(.., None)` → Err; Test `review_round_1_secret_names_and_missing_gh_dir_are_refused` |
| K8, G5 | alle Agenten teilen `agent-gh-config`; Race beim Löschen, fremde Anmeldung sichtbar | niedrig | **behoben.** Ein Verzeichnis je Sitzung (`agent-gh-config/<session_id>`, Id enthält Millisekunden, also über Neustarts eindeutig); das Löschen einer `hosts.yml` bleibt als Absicherung. | `pty.rs` Spawn |
| K2, G4 | Namen ohne Marker unter erlaubten Präfixen (`*_PAT`, `*_AUTH`, `*_BEARER`) | mittel/niedrig | **behoben.** Marker `BEARER`, Suffixe `_PAT`, `_AUTH` (nicht als Teilstring: `PATHEXT`, `GIT_AUTHOR_NAME` bleiben, per Test belegt). `GITHUB_PAT`/`GH_PAT` stehen ohnehin auf keiner Allowlist. | derselbe Test: rot mit neutralisierten Markern (`Allowlist: OPENAI_BEARER reached the agent`), grün mit Fix |
| G1 | `GIT_CONFIG_COUNT` erst ab git 2.31 | mittel | **behoben.** Dieselbe Sperre steht zusätzlich in `GIT_CONFIG_PARAMETERS` (`'key=value'`-Form, die auch ältere git lesen). Mindestversion im Doc-Kommentar. | Test prüft den exakten Wert; git-Test und echter Push-Probe weiter rot/grün wie erwartet |
| G3 | `GIT_PROXY_COMMAND`, `GIT_SSL_NO_VERIFY` überleben aus Profil-`env` | niedrig | **behoben.** In `STRICT_REMOVED`. | Code |
| K4 | `GIT_CONFIG_GLOBAL/SYSTEM` auf leere Datei zeigen lassen | mittel | **teilweise.** Eine leere globale Konfiguration nähme dem Worker `user.name`/`user.email` und damit lokale Commits (Auftrag: müssen weiter gehen). Stattdessen sind die genannten Wege einzeln gesperrt: Helper (auch URL-spezifisch) geleert, `GIT_ASKPASS=` leer (überspringt `core.askPass`/`SSH_ASKPASS`), `protocol.ssh.allow=never` (deckt `insteadOf`→ssh). **Neu ergänzt:** `http.extraHeader=` leer, damit ein `AUTHORIZATION`-Header aus einer Konfigurationsdatei nicht mitgeht — diese Stelle stützt sich auf gits dokumentierte Semantik („an empty value resets the extra headers“), ist aber **nicht per Test belegt** (bräuchte einen HTTP-Server). | Doc-Kommentar |
| K3 | leerer `credential.helper` löscht URL-spezifische Helper nicht sicher | mittel | **abgelehnt mit Beleg.** Der git-Test legt einen `credential.https://example.invalid.helper` an; unter `strict` antwortet er nicht (git 2.55). Git-Doku: „If credential.helper is configured to the empty string, this resets the helper list to empty“ — die Liste enthält URL-spezifische Einträge. Andere git-Versionen sind nicht gemessen (CI-Linux-git läuft denselben Test). | `strict_agent_env_stops_git_credentials_but_not_local_commits` |
| K5 | Geheimnisse in Werten (Proxy-URL) | niedrig | **dokumentiert** als Grenze (Modul-Doc, PR-Text). | — |
| K6 | `strict` schaltet GPG-Signierung nicht ab | niedrig | **abgelehnt (Scope).** Ein Signaturschlüssel ist kein Push-/Schreibrecht auf GitHub; `commit.gpgsign=false` zu erzwingen hebelte eine Signaturpflicht des Nutzers aus. Unter `inherit` besteht dasselbe Verhalten heute. Als Folgearbeit notiert. | — |
| K7, G2 | Nicht-UTF-8-Namen: nur aus Doku abgeleitet / werden verlustbehaftet konvertiert | niedrig | **abgelehnt mit Beleg (Quelltext).** `portable-pty 0.9.0` `cmdbuilder.rs:378-390`: `iter_full_env_as_str` macht `preferred_key.to_str()?` und `value.to_str()?` in `filter_map` — nicht-UTF-8 wird übersprungen, nicht konvertiert; danach `env_clear()`. Das `to_string()` im Code läuft auf `&str`. Kommentar im Code präzisiert. Kein eigener Test (Windows-Umgebungsnamen sind UTF-16; ein Unix-Test wäre KI-7-Plattformteil). | Quelltext |

Delta-Runde: Die Fixes sind klein, lokal und durch Tests abgedeckt; die
Architektur und die Voreinstellung sind unverändert. Eine zweite Runde auf dem
neuen Kopf wurde trotzdem gefahren — Ergebnis unten.


## Delta-Diff
```diff
diff --git a/src-tauri/src/pty.rs b/src-tauri/src/pty.rs
index 2dec6d0..7ad69a4 100644
--- a/src-tauri/src/pty.rs
+++ b/src-tauri/src/pty.rs
@@ -813,7 +813,8 @@ impl PtyManager {
                 cmd.cwd(dir);
             }
         }
-        agent_env::apply(&mut cmd, profile, env, &agent_env::gh_config_dir(app))?;
+        let gh_config_dir = agent_env::gh_config_dir(app, session_id);
+        agent_env::apply(&mut cmd, profile, env, gh_config_dir.as_deref())?;
 
         let mut child = pair
             .slave
@@ -3689,7 +3690,7 @@ mod tests {
                 ..base
             };
             let mut cmd = build_command(&profile);
-            agent_env::apply(&mut cmd, &profile, &[], gh.path()).expect("apply");
+            agent_env::apply(&mut cmd, &profile, &[], Some(gh.path())).expect("apply");
             let out = crate::status::strip_ansi(&run_command_in_pty(cmd, None));
             let version = out
                 .lines()
@@ -3723,7 +3724,7 @@ mod tests {
                 ..crate::profiles::default_profiles().remove(0)
             };
             let mut cmd = build_command(&profile);
-            agent_env::apply(&mut cmd, &profile, &[], gh.path()).expect("apply");
+            agent_env::apply(&mut cmd, &profile, &[], Some(gh.path())).expect("apply");
             let env: Vec<(String, String)> = cmd
                 .iter_full_env_as_str()
                 .map(|(k, v)| (k.to_string(), v.to_string()))
@@ -3779,7 +3780,7 @@ mod tests {
             cmd.env(name, SENTINEL);
         }
         let gh = crate::testutil::TempDir::new("w5-02b-pty");
-        agent_env::apply(&mut cmd, &profile, &[], gh.path()).expect("apply");
+        agent_env::apply(&mut cmd, &profile, &[], Some(gh.path())).expect("apply");
         let out = run_command_in_pty(cmd, None).to_ascii_uppercase();
         assert!(out.contains("PATH="), "the child printed no PATH");
         assert!(out.contains("SYSTEMROOT="), "the child lost SystemRoot");
diff --git a/src-tauri/src/pty/agent_env.rs b/src-tauri/src/pty/agent_env.rs
index 7fdf908..e0cd0f2 100644
--- a/src-tauri/src/pty/agent_env.rs
+++ b/src-tauri/src/pty/agent_env.rs
@@ -166,28 +166,39 @@ const STRICT_REMOVED: &[&str] = &[
     "GIT_CONFIG_PARAMETERS",
     "GIT_CONFIG_GLOBAL",
     "GIT_CONFIG_SYSTEM",
+    "GIT_PROXY_COMMAND",
+    "GIT_SSL_NO_VERIFY",
 ];
 
-/// Git configuration that wins over every file (`GIT_CONFIG_COUNT`, git ≥ 2.31).
-/// An empty `credential.helper` empties the helper list, URL-scoped helpers
-/// included, so the Git Credential Manager is never asked.
-const STRICT_GIT_CONFIG: &[(&str, &str)] =
-    &[("credential.helper", ""), ("protocol.ssh.allow", "never")];
+/// Git configuration that wins over every file. An empty `credential.helper`
+/// empties the helper list, URL-scoped `credential.<url>.helper` included, so
+/// the Git Credential Manager is never asked; an empty `http.extraHeader`
+/// likewise drops an `AUTHORIZATION` header a checkout left in a config file.
+/// Set twice: `GIT_CONFIG_COUNT` (git >= 2.31) and `GIT_CONFIG_PARAMETERS`,
+/// which older git reads too.
+const STRICT_GIT_CONFIG: &[(&str, &str)] = &[
+    ("credential.helper", ""),
+    ("http.extraHeader", ""),
+    ("protocol.ssh.allow", "never"),
+];
 
 /// Give `cmd` the environment `profile` is allowed to see: what it inherits
 /// from ProjectA under its isolation level, `TERM`, and `explicit` - the
 /// app's and the profile's own variables, which always win over inherited
-/// ones. `gh_config_dir` is only touched under `strict`.
+/// ones. `gh_config_dir` is only used under `strict`, which refuses to start
+/// without one.
 pub(crate) fn apply(
     cmd: &mut CommandBuilder,
     profile: &AgentProfile,
     explicit: &[(String, String)],
-    gh_config_dir: &Path,
+    gh_config_dir: Option<&Path>,
 ) -> Result<(), String> {
     let policy = &profile.env_policy;
     if policy.isolation != EnvIsolation::Inherit {
         // `CommandBuilder` starts from the app's environment (on Windows plus
         // the registry's), so it is emptied and refilled from what it held.
+        // `iter_full_env_as_str` skips every name or value that is not
+        // UTF-8, so such a variable is dropped, never guessed at.
         let inherited: Vec<(String, String)> = cmd
             .iter_full_env_as_str()
             .map(|(key, value)| (key.to_string(), value.to_string()))
@@ -209,7 +220,9 @@ pub(crate) fn apply(
         cmd.env(key, value);
     }
     if policy.isolation == EnvIsolation::Strict {
-        lock_credentials(cmd, gh_config_dir)?;
+        let dir = gh_config_dir
+            .ok_or("refusing to start the agent: no app-owned directory for its gh config")?;
+        lock_credentials(cmd, dir)?;
     }
     Ok(())
 }
@@ -231,9 +244,13 @@ fn looks_secret(upper: &str) -> bool {
         "KEY",
         "COOKIE",
         "PRIVATE",
+        "BEARER",
     ]
     .iter()
     .any(|marker| upper.contains(marker))
+        // `PAT` and `AUTH` only as a suffix: PATHEXT and GIT_AUTHOR_NAME stay.
+        || upper.ends_with("_PAT")
+        || upper.ends_with("_AUTH")
 }
 
 /// The `strict` part: no route from the agent to the user's GitHub or git
@@ -242,9 +259,9 @@ fn lock_credentials(cmd: &mut CommandBuilder, gh_config_dir: &Path) -> Result<()
     for name in STRICT_REMOVED {
         cmd.env_remove(name);
     }
-    // An earlier agent may have logged in there; the next one starts out
-    // logged out. The directory itself need not exist - gh reads a missing
-    // one as empty.
+    // Each session has its own directory, so no agent sees another one's
+    // login; clearing a leftover is belt and braces. The directory itself
+    // need not exist - gh reads a missing one as empty.
     let hosts = gh_config_dir.join("hosts.yml");
     match std::fs::remove_file(&hosts) {
         Ok(()) => {}
@@ -264,19 +281,22 @@ fn lock_credentials(cmd: &mut CommandBuilder, gh_config_dir: &Path) -> Result<()
     cmd.env("GIT_ASKPASS", "");
     cmd.env("GCM_INTERACTIVE", "never");
     cmd.env("GIT_CONFIG_COUNT", STRICT_GIT_CONFIG.len().to_string());
+    let mut parameters = Vec::new();
     for (index, (key, value)) in STRICT_GIT_CONFIG.iter().enumerate() {
         cmd.env(format!("GIT_CONFIG_KEY_{index}"), key);
         cmd.env(format!("GIT_CONFIG_VALUE_{index}"), value);
+        parameters.push(format!("'{key}={value}'"));
     }
+    cmd.env("GIT_CONFIG_PARAMETERS", parameters.join(" "));
     Ok(())
 }
 
-/// The app-owned directory `gh` is pointed at under `strict`.
-pub(crate) fn gh_config_dir(app: &AppHandle) -> PathBuf {
-    app.path()
-        .app_local_data_dir()
-        .unwrap_or_else(|_| std::env::temp_dir().join("projecta"))
-        .join("agent-gh-config")
+/// The app-owned directory `gh` is pointed at under `strict`: one per
+/// session, below the app's local data directory. No fallback to a shared
+/// temp directory - without the app's own directory a `strict` spawn fails.
+pub(crate) fn gh_config_dir(app: &AppHandle, session_id: &str) -> Option<PathBuf> {
+    let base = app.path().app_local_data_dir().ok()?;
+    Some(base.join("agent-gh-config").join(session_id))
 }
 
 #[cfg(test)]
@@ -309,6 +329,11 @@ mod tests {
         "W5_02B_NOT_ON_THE_ALLOWLIST",
     ];
 
+    /// Review round 1: credential names under an allowed prefix that carry
+    /// none of the first markers.
+    const PLANTED_UNDER_ALLOWED_PREFIXES: &[&str] =
+        &["OPENAI_BEARER", "ANTHROPIC_PAT", "CODEX_AUTH"];
+
     fn profile(isolation: EnvIsolation, passthrough: &[&str]) -> AgentProfile {
         AgentProfile {
             id: "w5-02b".into(),
@@ -348,7 +373,7 @@ mod tests {
         for name in planted {
             cmd.env(name, SENTINEL);
         }
-        apply(&mut cmd, profile, &explicit(), gh).expect("apply");
+        apply(&mut cmd, profile, &explicit(), Some(gh)).expect("apply");
         cmd.iter_full_env_as_str()
             .map(|(key, value)| (key.to_ascii_uppercase(), value.to_string()))
             .collect()
@@ -443,6 +468,46 @@ mod tests {
         assert_eq!(env.get("TERM").map(String::as_str), Some("xterm-256color"));
     }
 
+    #[test]
+    fn review_round_1_secret_names_and_missing_gh_dir_are_refused() {
+        let gh = TempDir::new("w5-02b-gh");
+        for isolation in [EnvIsolation::Allowlist, EnvIsolation::Strict] {
+            let env = environment_with(
+                &profile(isolation, &[]),
+                gh.path(),
+                PLANTED_UNDER_ALLOWED_PREFIXES,
+            );
+            for name in PLANTED_UNDER_ALLOWED_PREFIXES {
+                assert!(
+                    !env.contains_key(*name),
+                    "{isolation:?}: {name} reached the agent"
+                );
+            }
+            // The suffix rules must not cost the commit identity or PATHEXT.
+            let mut cmd = CommandBuilder::new("git");
+            cmd.env("GIT_AUTHOR_NAME", "w5");
+            cmd.env("PATHEXT", ".EXE");
+            apply(&mut cmd, &profile(isolation, &[]), &[], Some(gh.path())).expect("apply");
+            assert!(cmd.get_env("GIT_AUTHOR_NAME").is_some());
+            assert!(cmd.get_env("PATHEXT").is_some());
+        }
+        // Without an app-owned directory, strict does not start at all -
+        // no shared temp directory stands in for it.
+        let mut cmd = CommandBuilder::new("git");
+        let refused = apply(&mut cmd, &profile(EnvIsolation::Strict, &[]), &[], None);
+        assert!(
+            refused.is_err(),
+            "strict started without its own gh directory"
+        );
+        // Older git reads GIT_CONFIG_PARAMETERS only; it carries the same lock.
+        let env = environment(&profile(EnvIsolation::Strict, &[]), gh.path());
+        let parameters = env.get("GIT_CONFIG_PARAMETERS").map(String::as_str);
+        assert_eq!(
+            parameters,
+            Some("'credential.helper=' 'http.extraHeader=' 'protocol.ssh.allow=never'")
+        );
+    }
+
     #[test]
     fn strict_agent_env_points_gh_at_an_empty_config() {
         let gh = TempDir::new("w5-02b-gh");
```
