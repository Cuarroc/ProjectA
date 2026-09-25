# Review W1-24b — F-SEC-4 OmniRoute Schlüssel sync as opt-in setting

You are an independent code reviewer (cross-vendor). Author: Claude Code. Review
the diff below for correctness and security. Answer in German or English.
List findings as `R-<n> | Schwere (blocker/hoch/mittel/niedrig) | Datei:Zeile |
Befund | Vorschlag`. Say explicitly "keine blockierenden Befunde" if none.

## Background

Repo: ProjectA, Tauri 2 desktop app (Rust core + SQLite store, React/TS UI).
F-SEC-4 (security audit): ProjectA pushed all provider API keys from its
encrypted local vault as plaintext JSON to OmniRoute (a local LLM router on
127.0.0.1:<omniroute-port>). OmniRoute counts as "online" on any 2xx health reply, with no
identity check, so a port squatter would receive every key. W1-24 (PR #62)
turned `sync_keys_to_omniroute` into a no-op. The user decided on 24.09.2026:
**opt-in setting** — the sync stays OFF until the user explicitly enables it;
when enabled it works as originally designed (before W1-24). The other
directions (require `/api/version` identity; send management token as bearer)
were rejected earlier because they either break builds without that route or
hand the squatter one more credential.

## Design

- Setting Schlüssel `omniroute.Schlüssel_sync` in the existing flat `settings` table
  (`Store::get_setting`/`set_setting`). Only the literal `"1"` counts as
  consent. Missing row (fresh install and every install from before this
  change) = OFF. The toggle writes `"1"`/`"0"`.
- `providers::KeySync { Off, OptedIn }` enum passed into
  `sync_keys_to_omniroute(omni, vault, consent)`. Without `OptedIn` the
  function returns before any network or vault access. `KeySync::from_setting`
  reads the setting. With `OptedIn`, the original transport is restored from
  git history: filter the router's own logins (`omniroute-management`,
  `freetier::VAULT_ID = "omniroute"`), one JSON body, try three config routes,
  best effort.
- `main.rs`: `set_provider_key` reads consent from the store and only spawns the
  sync thread with `OptedIn`. New Tauri commands `get_omniroute_Schlüssel_sync` and
  `set_omniroute_Schlüssel_sync(enabled)`; enabling writes the setting, reads it back,
  and pushes the vault once (so keys typed before the opt-in reach the router);
  disabling sends nothing.
- UI: `ProviderDialog` (where keys are entered) gets a checkbox "API-Keys an
  OmniRoute übergeben", unchecked and disabled until the core answered, with a
  German warning that enabling hands all stored provider keys to the local
  OmniRoute process — to any process answering on its port, without identity
  check. A failed write reverts the box and shows the error. Header hint text
  now says where keys stay.
- Tests: Rust — opted-in sync POSTs the provider key and never the router
  logins; logins-only vault pushes nothing; router without config routes is
  stepped over; setting default OFF + round trip + only "1" is consent; the
  W1-24 listener regression test stays green with `KeySync::Off`. Vitest —
  default off with warning, enabling stores opt-in, stored opt-in shown and
  withdrawable, failed write reverts. Placeholder secrets only.

## Questions for the reviewer

1. Can any production path hand keys to OmniRoute without the stored opt-in?
2. Is "missing row = off" guaranteed for existing installs?
3. Is the push-once-on-enable acceptable/safe (race with a concurrent disable)?
4. Any regression to the W1-24 guarantee, the vault, or the UI?
5. Anything leaking secrets into logs/errors?

## Full diff vs origin/main

```diff
diff --git a/docs/audits/2026-09-03-analyse-claude-web/befunde/http-security.md b/docs/audits/2026-09-03-analyse-claude-web/befunde/http-security.md
index 43a0303..1c73a74 100644
--- a/docs/audits/2026-09-03-analyse-claude-web/befunde/http-security.md
+++ b/docs/audits/2026-09-03-analyse-claude-web/befunde/http-security.md
@@ -67,6 +67,17 @@ Stand: 2026-09-03, nur Lesen, keine Repo-Änderung. Bereits bekannte Befunde (40
 - Fix-Hinweis: In `approve_learning` (und in `roles.rs`, sofern dort gleiche Prüfung) `let final_text = one_line(final_text);` **vor** `forbidden_marker` und den Marker-Vergleich ebenfalls auf whitespace-gefalteter Form ausführen (`one_line(marker)`), oder `forbidden_marker` selbst über `one_line(text)` prüfen.
 
 ### F-SEC-4: Alle Vault-Keys werden unauthentifiziert an „wer auch immer auf 127.0.0.1:<omniroute-port> antwortet" gepostet
+> **Behoben mit W1-24 (PR #62, 22.09.2026) und W1-24b (24.09.2026)** nach
+> Nutzerentscheidung für die Richtung „Opt-in-Setting": Der Key-Sync ist aus,
+> bis der Nutzer im Provider-Dialog „API-Keys an OmniRoute übergeben"
+> einschaltet (Setting `omniroute.Schlüssel_sync`, nur `"1"` zählt; ohne Eintrag —
+> also auch in jeder Bestandsinstallation — aus). Ohne Opt-in kehrt
+> `sync_keys_to_omniroute` vor Netz- und Vault-Zugriff zurück; der rote Test
+> `keys_are_not_pushed_to_an_unidentified_listener` steht. Mit Opt-in läuft der
+> ursprüngliche Push, und das hier beschriebene Restrisiko (keine
+> Identitätsprüfung der Gegenseite) nimmt der Nutzer bewusst in Kauf — der
+> Schalter sagt es ihm im Klartext. Code und Belege: `providers.rs`
+> (`KeySync`, `key_sync_enabled`), `.pa/report_w1-24.md`, `.pa/report_w1-24b.md`.
 - Datei:Zeile: src-tauri/src/providers.rs:1225-1258 (`sync_credentials_to_omniroute`), :1262-1291 (`post` ohne Authorization), src-tauri/src/omniroute.rs:169-173 (`probe_once`: online = irgendein 2xx auf `/health`, `/healthz` oder `/`), :49, :111-118 (fester Default 127.0.0.1:<omniroute-port>), src-tauri/src/main.rs:1264-1270 (Aufruf bei jedem `set_provider_Schlüssel`)
 - Schwere: medium
 - Kategorie: Secret-Leak / fehlende Gegenseiten-Authentisierung
diff --git a/src-tauri/src/main.rs b/src-tauri/src/main.rs
index 946e3e7..fcd3282 100644
--- a/src-tauri/src/main.rs
+++ b/src-tauri/src/main.rs
@@ -1706,13 +1706,45 @@ async fn get_provider_overview(
     .map_err(|e| format!("the provider probe did not finish: {e}"))
 }
 
+/// Whether the user has opted in to handing the vault's provider keys to
+/// OmniRoute (F-SEC-4, W1-24b). Off unless switched on.
+#[tauri::command]
+async fn get_omniroute_Schlüssel_sync(store: State<'_, Store>) -> Result<bool, String> {
+    Ok(providers::key_sync_enabled(&store).await)
+}
+
+/// Record the key-sync choice. Switching it on pushes the keys already in the
+/// vault once, so that the keys typed before the opt-in reach the router
+/// without being typed again; switching it off sends nothing.
+#[tauri::command]
+async fn set_omniroute_Schlüssel_sync(
+    store: State<'_, Store>,
+    vault: State<'_, Arc<KeyVault>>,
+    quota: State<'_, Arc<QuotaTracker>>,
+    enabled: bool,
+) -> Result<(), String> {
+    providers::set_key_sync_enabled(&store, enabled).await?;
+    // Read back rather than trusting `enabled`: the consent handed to the sync
+    // is always the one the settings table holds.
+    let consent = providers::KeySync::from_setting(&store).await;
+    if consent == providers::KeySync::OptedIn {
+        let vault = Arc::clone(&vault);
+        let omni = Arc::clone(quota.omni_route());
+        tauri::async_runtime::spawn_blocking(move || {
+            providers::sync_keys_to_omniroute(&omni, &vault, consent);
+        });
+    }
+    Ok(())
+}
+
 /// Store an API key for a provider.
 ///
-/// The key goes into `provider-keys.json` in the app data directory, and - if
-/// the local router is up - is handed to OmniRoute as well, so that a Schlüssel typed
-/// once is a key both halves of the machine can use.
+/// The key goes into `provider-keys.json` in the app data directory. Only if
+/// the user opted in to the key sync (F-SEC-4, off by default) and the local
+/// router is up is it handed to OmniRoute as well.
 #[tauri::command]
 async fn set_provider_key(
+    store: State<'_, Store>,
     vault: State<'_, Arc<KeyVault>>,
     quota: State<'_, Arc<QuotaTracker>>,
     provider_id: String,
@@ -1727,13 +1759,18 @@ async fn set_provider_key(
         quota.omni_route().set_token(Some(&key));
     }
 
-    // Best effort, and off the UI thread: OmniRoute not taking the Schlüssel costs
-    // the router a route, not the user their key.
-    let vault = Arc::clone(&vault);
-    let omni = Arc::clone(quota.omni_route());
-    tauri::async_runtime::spawn_blocking(move || {
-        providers::sync_keys_to_omniroute(&omni, &vault);
-    });
+    // Only with the user's consent (F-SEC-4): without it nothing is sent and
+    // no thread is spawned. With it, best effort and off the UI thread:
+    // OmniRoute not taking the Schlüssel costs the router a route, not the user
+    // their key.
+    let consent = providers::KeySync::from_setting(&store).await;
+    if consent == providers::KeySync::OptedIn {
+        let vault = Arc::clone(&vault);
+        let omni = Arc::clone(quota.omni_route());
+        tauri::async_runtime::spawn_blocking(move || {
+            providers::sync_keys_to_omniroute(&omni, &vault, consent);
+        });
+    }
     Ok(())
 }
 
@@ -3563,6 +3600,8 @@ fn main() {
             get_provider_overview,
             set_provider_key,
             delete_provider_key,
+            get_omniroute_Schlüssel_sync,
+            set_omniroute_Schlüssel_sync,
             has_provider_key,
             get_free_tier_summary,
             enhance_prompt,
diff --git a/src-tauri/src/providers.rs b/src-tauri/src/providers.rs
index c21e986..4c54aa8 100644
--- a/src-tauri/src/providers.rs
+++ b/src-tauri/src/providers.rs
@@ -32,15 +32,15 @@
 
 use std::collections::BTreeMap;
 use std::ffi::OsString;
-use std::io::Write;
-use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
+use std::io::{Read, Write};
+use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpStream};
 use std::path::{Path, PathBuf};
 use std::process::Stdio;
 use std::sync::Mutex;
 use std::time::{Duration, Instant};
 
 use serde::{Deserialize, Serialize};
-use serde_json::Value;
+use serde_json::{json, Value};
 
 // The vault's DPAPI blob is base64 on disk; `Engine` provides encode/decode.
 use base64::Engine as _;
@@ -48,7 +48,7 @@ use base64::Engine as _;
 use crate::omniroute::{self, OmniRoute};
 use crate::quota::QuotaTracker;
 use crate::status::StatusEngine;
-use crate::store::{now_unix_secs, QUOTA_UNKNOWN};
+use crate::store::{now_unix_secs, Store, QUOTA_UNKNOWN};
 
 /// The provider is paid for as a plan; there is no key to hold.
 pub const KIND_SUBSCRIPTION: &str = "subscription";
@@ -92,6 +92,18 @@ const OLLAMA_PORT: u16 = 11434;
 /// ledger simply stays where it is.
 pub const OMNIROUTE_MANAGEMENT: &str = "omniroute-management";
 
+/// Refuse an OmniRoute reply larger than this, matching [`crate::omniroute`].
+const MAX_RESPONSE: usize = 64 * 1024;
+
+/// OmniRoute endpoints tried when pushing credentials, in order. None of these is
+/// promised by any particular build, which is why there are three of them and
+/// why failing all three is not an error.
+const OMNIROUTE_CONFIG_PATHS: [&str; 3] = [
+    "/api/v1/providers",
+    "/api/providers",
+    "/api/v1/config/providers",
+];
+
 /// How a provider is looked for.
 #[derive(Debug, Clone, Copy, PartialEq, Eq)]
 pub enum Probe {
@@ -659,8 +671,8 @@ impl KeyVault {
         self.read_soft().keys.remove(provider_id.trim())
     }
 
-    /// Test-only inspection of encrypted-vault round trips.
-    #[cfg(test)]
+    /// Every stored key, for the one caller that needs them all: the OmniRoute
+    /// key sync, and only once the user has opted in to it.
     pub fn all(&self) -> BTreeMap<String, String> {
         self.read_soft().keys
     }
@@ -1233,19 +1245,144 @@ static OPENROUTER_CACHE: std::sync::OnceLock<Mutex<Option<(String, Instant, Prov
 /// How long an OpenRouter response is reused before it is refreshed.
 const OPENROUTER_CACHE_TTL: Duration = Duration::from_secs(60);
 
-// -- OmniRoute Schlüssel synchronization is disabled ----------------------------
+// -- pushing the keys into OmniRoute (opt-in, F-SEC-4) ---------------------
+//
+// F-SEC-4: the push goes to whatever answers on OmniRoute's loopback port. A
+// `200` health reply does not authenticate the listener, so a port squatter
+// would be handed every provider key. There is no identity check that neither
+// breaks legitimate builds nor hands the squatter something else (see
+// `.pa/report_w1-08.md` §3), so the user decides: the sync is off until they
+// switch it on (decision of 24.09.2026, W1-24b). Off is the absence of the
+// setting, which makes every install from before the switch existed off too.
+
+/// Settings key for the user's opt-in to handing vault keys to OmniRoute.
+/// Only the literal `"1"` is consent; a missing row or any other value is off.
+pub const SETTING_OMNIROUTE_Schlüssel_SYNC: &str = "omniroute.Schlüssel_sync";
+
+/// Whether the user has opted in to the key sync. Off unless switched on - the
+/// opposite of the digest and learning switches, on purpose: this one hands
+/// credentials to another process.
+pub async fn key_sync_enabled(store: &Store) -> bool {
+    matches!(
+        store.get_setting(SETTING_OMNIROUTE_Schlüssel_SYNC).await,
+        Ok(Some(value)) if value == "1"
+    )
+}
+
+/// Record the user's key-sync choice.
+pub async fn set_key_sync_enabled(store: &Store, enabled: bool) -> Result<(), String> {
+    store
+        .set_setting(SETTING_OMNIROUTE_Schlüssel_SYNC, if enabled { "1" } else { "0" })
+        .await
+}
+
+/// The user's consent to the key sync, as the sync itself takes it. A type and
+/// not a `bool` so that no call site can hand over the keys by accident: it
+/// has to name [`KeySync::OptedIn`], which only [`KeySync::from_setting`]
+/// produces in production code.
+#[derive(Debug, Clone, Copy, PartialEq, Eq)]
+pub enum KeySync {
+    /// No consent: nothing leaves the vault.
+    Off,
+    /// The user switched the sync on in the provider dialog.
+    OptedIn,
+}
+
+impl KeySync {
+    /// The consent as the settings table records it right now.
+    pub async fn from_setting(store: &Store) -> Self {
+        if key_sync_enabled(store).await {
+            KeySync::OptedIn
+        } else {
+            KeySync::Off
+        }
+    }
+}
+
+/// Hand OmniRoute the credentials we hold, if the user opted in and the router is up
+/// and will take them.
+///
+/// Without consent this returns before touching the network or the vault.
+/// With it, it is entirely best effort, and deliberately so: OmniRoute's
+/// configuration API is not pinned down, different builds expose different
+/// routes, and ProjectA does not depend on the router at all. Every outcome
+/// short of success is printed once and stepped over. Returns whether an
+/// endpoint accepted the push, which is what the tests assert on.
+pub fn sync_credentials_to_omniroute(omni: &OmniRoute, vault: &SchlüsselVault, consent: SchlüsselSync) -> bool {
+    if consent != KeySync::OptedIn {
+        return false;
+    }
+    if !omni.is_online() {
+        return false;
+    }
+    // The router's own logins are not provider credentials, and handing them
+    // back to OmniRoute as such would be both meaningless and a place for
+    // them to end up in a config file nobody meant to write them to. There
+    // are two: the management token (T3) and the legacy registry entry the
+    // free-tier probe reads (T5, `freetier::VAULT_ID`).
+    let keys: BTreeMap<String, String> = vault
+        .all()
+        .into_iter()
+        .filter(|(id, _)| id != OMNIROUTE_MANAGEMENT && id != crate::freetier::VAULT_ID)
+        .collect();
+    if keys.is_empty() {
+        return false;
+    }
 
-/// Provider keys stay in the local vault. A successful loopback health probe
-/// does not authenticate the listener or authorize credential disclosure.
-/// Kept as a no-op for existing callers; never opens a connection or reads keys.
-pub fn sync_credentials_to_omniroute(_omni: &OmniRoute, _vault: &SchlüsselVault) -> bool {
+    let providers: serde_json::Map<String, Value> = keys
+        .into_iter()
+        .map(|(id, key)| (id, json!({ "api_key": key })))
+        .collect();
+    let body = json!({ "providers": providers }).to_string();
+
+    for path in OMNIROUTE_CONFIG_PATHS {
+        // A 404 is the ordinary answer from a build without this route, so a
+        // rejected path is simply the next one's turn.
+        if matches!(post(omni.addr(), path, &body), Some(status) if (200..300).contains(&status)) {
+            return true;
+        }
+    }
+    eprintln!("projecta: omniroute took none of the provider config routes; credentials were not pushed");
     false
 }
+
+/// One `POST`, returning the status code. The same shape as [`omniroute::get`]:
+/// a `TcpStream` and a `format!`, because that is all a loopback call needs.
+fn post(addr: SocketAddr, path: &str, body: &str) -> Option<u16> {
+    let mut stream = TcpStream::connect_timeout(&addr, omniroute::PROBE_TIMEOUT).ok()?;
+    stream
+        .set_read_timeout(Some(omniroute::PROBE_TIMEOUT))
+        .ok()?;
+    stream
+        .set_write_timeout(Some(omniroute::PROBE_TIMEOUT))
+        .ok()?;
+
+    let request = format!(
+        "POST {path} HTTP/1.1\r\nHost: {addr}\r\nContent-Type: application/json\r\n\
+         Content-Length: {}\r\nUser-Agent: ProjectA\r\nConnection: close\r\n\r\n{body}",
+        body.len()
+    );
+    stream.write_all(request.as_bytes()).ok()?;
+    stream.flush().ok()?;
+
+    let mut raw: Vec<u8> = Vec::with_capacity(1024);
+    let mut chunk = [0u8; 4096];
+    loop {
+        match stream.read(&mut chunk) {
+            Ok(0) | Err(_) => break,
+            Ok(n) => raw.extend_from_slice(&chunk[..n]),
+        }
+        if raw.len() >= MAX_RESPONSE {
+            break;
+        }
+    }
+    omniroute::parse_response(&raw).map(|(status, _)| status)
+}
+
 #[cfg(test)]
 mod tests {
     use super::*;
     use std::collections::HashMap;
-    use std::io::Read;
     use std::net::TcpListener;
     use std::sync::mpsc::{channel, Receiver, Sender};
 
@@ -1988,7 +2125,7 @@ mod tests {
         vault
             .set(OMNIROUTE_MANAGEMENT, "management-canary")
             .expect("set");
-        assert!(!sync_keys_to_omniroute(&omni, &vault));
+        assert!(!sync_credentials_to_omniroute(&omni, &vault, SchlüsselSync::Off));
         assert!(requests
             .try_iter()
             .all(|request| !request.starts_with("POST")));
@@ -1998,6 +2135,141 @@ mod tests {
         );
     }
 
+    /// F-SEC-4 opt-in (W1-24b): with the user's consent the sync does what it
+    /// did before W1-24 - one POST carrying every provider key, and never the
+    /// router's own logins.
+    #[test]
+    fn an_opted_in_sync_hands_an_online_router_the_stored_keys() {
+        let (addr, requests) = serve(200, "{\"ok\":true}");
+        let omni = OmniRoute::new(addr);
+        assert!(omni.probe_once(), "the fake router answers /health");
+
+        let dir = TempDir::new("omni-optin-push");
+        let vault = vault(&dir);
+        vault
+            .set("openrouter", "sk-or-test-placeholder")
+            .expect("set");
+        vault
+            .set(OMNIROUTE_MANAGEMENT, "management-placeholder")
+            .expect("set");
+        vault
+            .set(crate::freetier::VAULT_ID, "freetier-placeholder")
+            .expect("set");
+
+        assert!(sync_credentials_to_omniroute(&omni, &vault, SchlüsselSync::OptedIn));
+        let posted = requests
+            .try_iter()
+            .find(|request| request.starts_with("POST"))
+            .expect("a POST reached the router");
+        assert!(posted.contains("/api/v1/providers"), "first config route");
+        assert!(posted.contains("openrouter"), "provider id in the body");
+        assert!(
+            posted.contains("sk-or-test-placeholder"),
+            "provider key in the body"
+        );
+        assert!(
+            !posted.contains("management-placeholder"),
+            "the management token is not a provider key"
+        );
+        assert!(
+            !posted.contains("freetier-placeholder"),
+            "the router's own login is not a provider key"
+        );
+    }
+
+    #[test]
+    fn an_opted_in_sync_with_only_router_logins_pushes_nothing() {
+        let (addr, requests) = serve(200, "{\"ok\":true}");
+        let omni = OmniRoute::new(addr);
+        assert!(omni.probe_once());
+
+        let dir = TempDir::new("omni-optin-logins-only");
+        let vault = vault(&dir);
+        vault
+            .set(OMNIROUTE_MANAGEMENT, "management-placeholder")
+            .expect("set");
+        vault
+            .set(crate::freetier::VAULT_ID, "freetier-placeholder")
+            .expect("set");
+
+        assert!(!sync_credentials_to_omniroute(&omni, &vault, SchlüsselSync::OptedIn));
+        // `try_iter` and not `iter`: the sender lives in the server thread and
+        // never hangs up.
+        assert!(
+            !requests
+                .try_iter()
+                .any(|request| request.starts_with("POST")),
+            "nothing was left to push, so nothing should have been sent"
+        );
+    }
+
+    #[test]
+    fn an_opted_in_sync_steps_over_a_router_without_config_routes() {
+        // Health answers, the config routes do not - which is what a build
+        // without them looks like from here.
+        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind");
+        let addr = listener.local_addr().expect("addr");
+        std::thread::spawn(move || {
+            for stream in listener.incoming() {
+                let Ok(mut stream) = stream else { continue };
+                let mut buf = [0u8; 8192];
+                let n = stream.read(&mut buf).unwrap_or(0);
+                let head = String::from_utf8_lossy(&buf[..n]).into_owned();
+                let response = if head.starts_with("GET") {
+                    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"
+                } else {
+                    "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
+                };
+                let _ = stream.write_all(response.as_bytes());
+                let _ = stream.flush();
+            }
+        });
+
+        let omni = OmniRoute::new(addr);
+        assert!(omni.probe_once());
+
+        let dir = TempDir::new("omni-optin-404");
+        let vault = vault(&dir);
+        vault.set("openrouter", "sk-test-placeholder").expect("set");
+        assert!(
+            !sync_credentials_to_omniroute(&omni, &vault, SchlüsselSync::OptedIn),
+            "no route took it"
+        );
+    }
+
+    /// The consent lives in the settings table. A fresh install - and every
+    /// install from before the setting existed - has no row, which is off;
+    /// only an explicit `"1"` written by the toggle is consent.
+    #[tokio::test]
+    async fn the_key_sync_setting_defaults_to_off_and_survives_a_round_trip() {
+        let dir = TempDir::new("omni-key-sync-setting");
+        let store = Store::open(&dir.path().join("projecta.db"))
+            .await
+            .expect("open store");
+
+        assert!(
+            !key_sync_enabled(&store).await,
+            "no row must mean no key sync"
+        );
+
+        set_key_sync_enabled(&store, true).await.expect("enable");
+        assert!(key_sync_enabled(&store).await, "the opt-in sticks");
+
+        set_key_sync_enabled(&store, false).await.expect("disable");
+        assert!(!key_sync_enabled(&store).await, "the opt-out sticks");
+
+        for value in ["", "0", "true", "yes", " 1", "on"] {
+            store
+                .set_setting(SETTING_OMNIROUTE_Schlüssel_SYNC, value)
+                .await
+                .expect("write raw");
+            assert!(
+                !key_sync_enabled(&store).await,
+                "only an explicit \"1\" is consent, not {value:?}"
+            );
+        }
+    }
+
     #[test]
     fn nothing_is_pushed_to_a_router_that_is_not_there() {
         let dir = TempDir::new("omni-offline");
@@ -2006,7 +2278,7 @@ mod tests {
 
         let offline = OmniRoute::default();
         assert!(!offline.is_online());
-        assert!(!sync_keys_to_omniroute(&offline, &vault));
+        assert!(!sync_credentials_to_omniroute(&offline, &vault, SchlüsselSync::OptedIn));
     }
 
     #[test]
@@ -2017,7 +2289,7 @@ mod tests {
 
         let dir = TempDir::new("omni-empty");
         let vault = vault(&dir);
-        assert!(!sync_keys_to_omniroute(&omni, &vault));
+        assert!(!sync_credentials_to_omniroute(&omni, &vault, SchlüsselSync::OptedIn));
         assert!(
             !requests
                 .try_iter()
diff --git a/src/components/ProviderDialog.keysync.test.tsx b/src/components/ProviderDialog.keysync.test.tsx
new file mode 100644
index 0000000..1c7177d
--- /dev/null
+++ b/src/components/ProviderDialog.keysync.test.tsx
@@ -0,0 +1,82 @@
+import { fireEvent, render, screen, waitFor } from "@testing-library/react";
+import { beforeEach, describe, expect, it, vi } from "vitest";
+
+import ProviderDialog from "./ProviderDialog";
+
+// F-SEC-4 opt-in (W1-24b): the switch that lets ProjectA hand the vault's
+// provider keys to the local OmniRoute process. Off until the user turns it on.
+
+const getOmniRouteSchlüsselSync = vi.fn<() => Promise<boolean>>();
+const setOmniRouteSchlüsselSync = vi.fn<(enabled: boolean) => Promise<void>>();
+
+vi.mock("../lib/ipc", () => ({
+  describeError: (cause: unknown) => String(cause),
+  deleteProviderKey: vi.fn(async () => {}),
+  getFreeTierSummary: vi.fn(() => new Promise(() => {})),
+  getOmniRouteSchlüsselSync: () => getOmniRouteSchlüsselSync(),
+  getProviderOverview: vi.fn(async () => []),
+  hasProviderKey: vi.fn(async () => false),
+  listAgentProfiles: vi.fn(async () => []),
+  setOmniRouteSchlüsselSync: (enabled: boolean) => setOmniRouteSchlüsselSync(enabled),
+  setProviderKey: vi.fn(async () => {}),
+}));
+
+vi.mock("./FreeTierPanel", () => ({ default: () => null }));
+
+const LABEL = /API-Keys an OmniRoute übergeben/;
+
+describe("ProviderDialog OmniRoute Schlüssel sync", () => {
+  beforeEach(() => {
+    getOmniRouteSchlüsselSync.mockReset();
+    setOmniRouteSchlüsselSync.mockReset();
+    setOmniRouteSchlüsselSync.mockResolvedValue(undefined);
+  });
+
+  it("key sync is off by default and warns about the local OmniRoute process", async () => {
+    getOmniRouteSchlüsselSync.mockResolvedValue(false);
+    render(<ProviderDialog onClose={() => {}} />);
+
+    const box = await screen.findByRole("checkbox", { name: LABEL });
+    await waitFor(() => expect(getOmniRouteSchlüsselSync).toHaveBeenCalled());
+    expect(box).not.toBeChecked();
+    expect(screen.getByText(/lokalen OmniRoute-Prozess/)).toBeInTheDocument();
+    expect(setOmniRouteSchlüsselSync).not.toHaveBeenCalled();
+  });
+
+  it("enabling key sync stores the opt-in", async () => {
+    getOmniRouteSchlüsselSync.mockResolvedValue(false);
+    render(<ProviderDialog onClose={() => {}} />);
+
+    const box = await screen.findByRole("checkbox", { name: LABEL });
+    await waitFor(() => expect(getOmniRouteSchlüsselSync).toHaveBeenCalled());
+    fireEvent.click(box);
+
+    await waitFor(() => expect(setOmniRouteSchlüsselSync).toHaveBeenCalledWith(true));
+    expect(box).toBeChecked();
+  });
+
+  it("a stored opt-in is shown and can be withdrawn", async () => {
+    getOmniRouteSchlüsselSync.mockResolvedValue(true);
+    render(<ProviderDialog onClose={() => {}} />);
+
+    const box = await screen.findByRole("checkbox", { name: LABEL });
+    await waitFor(() => expect(box).toBeChecked());
+    fireEvent.click(box);
+
+    await waitFor(() => expect(setOmniRouteSchlüsselSync).toHaveBeenCalledWith(false));
+    expect(box).not.toBeChecked();
+  });
+
+  it("a failed write takes the box back", async () => {
+    getOmniRouteSchlüsselSync.mockResolvedValue(false);
+    setOmniRouteSchlüsselSync.mockRejectedValue("store locked");
+    render(<ProviderDialog onClose={() => {}} />);
+
+    const box = await screen.findByRole("checkbox", { name: LABEL });
+    await waitFor(() => expect(getOmniRouteSchlüsselSync).toHaveBeenCalled());
+    fireEvent.click(box);
+
+    await waitFor(() => expect(screen.getByText("store locked")).toBeInTheDocument());
+    expect(box).not.toBeChecked();
+  });
+});
diff --git a/src/components/ProviderDialog.tsx b/src/components/ProviderDialog.tsx
index 34152c4..a010687 100644
--- a/src/components/ProviderDialog.tsx
+++ b/src/components/ProviderDialog.tsx
@@ -1,7 +1,12 @@
 import { useEffect, useRef, useState } from "react";
 
 import FreeTierPanel from "./FreeTierPanel";
-import { listAgentProfiles } from "../lib/ipc";
+import {
+  describeError,
+  getOmniRouteSchlüsselSync,
+  listAgentProfiles,
+  setOmniRouteSchlüsselSync,
+} from "../lib/ipc";
 import {
   PROVIDER_POLL_MS,
   formatProviderObservedAt,
@@ -70,6 +75,8 @@ export default function ProviderDialog({ onClose }: ProviderDialogProps) {
   const dialogRef = useRef<HTMLDivElement | null>(null);
   useFocusTrap(dialogRef);
 
+  const SchlüsselSync = useOmniRouteSchlüsselSync();
+
   // Three states, not two. `some()` over the empty list of a first load is
   // `false`, which used to make this header assert "offline" for the couple of
   // seconds the probe takes - while the status bar, reading the same fact from
@@ -106,10 +113,33 @@ export default function ProviderDialog({ onClose }: ProviderDialogProps) {
               {omniRouteLabel}
             </span>
             <span className="provider-header-hint">
-              Gespeicherte API-Keys speisen das OmniRoute-Routing.
+              {keySync.enabled
+                ? "Gespeicherte API-Keys speisen das OmniRoute-Routing."
+                : "Gespeicherte API-Keys bleiben im lokalen Vault."}
             </span>
           </div>
 
+          <label className="settings-check">
+            <input
+              type="checkbox"
+              checked={keySync.enabled}
+              disabled={!keySync.loaded}
+              onChange={(event) => keySync.toggle(event.target.checked)}
+            />
+            <span>API-Keys an OmniRoute übergeben</span>
+          </label>
+          <p className="settings-hint">
+            Aus: Keys verlassen den lokalen Vault nicht. An: ProjectA übergibt alle
+            gespeicherten Provider-Keys an den lokalen OmniRoute-Prozess — an jeden
+            Prozess, der auf dessen Port antwortet, ohne Identitätsprüfung. Nur
+            einschalten, wenn du diesem Rechner und dem OmniRoute darauf vertraust.
+          </p>
+          {keySync.error ? (
+            <div className="modal-note modal-error" role="alert">
+              {keySync.error}
+            </div>
+          ) : null}
+
           {loading ? <div className="modal-note">Lade Provider…</div> : null}
           {!loading && providers.length === 0 && error === null ? (
             <div className="modal-note">Keine Provider konfiguriert.</div>
@@ -156,6 +186,47 @@ export default function ProviderDialog({ onClose }: ProviderDialogProps) {
   );
 }
 
+/**
+ * The F-SEC-4 opt-in: whether ProjectA hands the vault's provider keys to the
+ * local OmniRoute process. The switch lives in the core's settings table, and
+ * the box starts unchecked and disabled until the core has answered, so a slow
+ * read never shows "on" for a sync that is off. A failed write takes the box
+ * back, like the other switches.
+ */
+function useOmniRouteSchlüsselSync() {
+  const [enabled, setEnabled] = useState(false);
+  const [loaded, setLoaded] = useState(false);
+  const [error, setError] = useState<string | null>(null);
+
+  useEffect(() => {
+    let alive = true;
+    void getOmniRouteSchlüsselSync()
+      .then((next) => {
+        if (!alive) return;
+        setEnabled(next);
+        setLoaded(true);
+      })
+      .catch((cause: unknown) => {
+        if (alive) setError(describeError(cause));
+      });
+    return () => {
+      alive = false;
+    };
+  }, []);
+
+  const toggle = (next: boolean) => {
+    const previous = enabled;
+    setEnabled(next);
+    setError(null);
+    void setOmniRouteSchlüsselSync(next).catch((cause: unknown) => {
+      setEnabled(previous);
+      setError(describeError(cause));
+    });
+  };
+
+  return { enabled, loaded, error, toggle };
+}
+
 function ProviderRow({ provider, routed }: { provider: Provider; routed: AgentProfile[] }) {
   return (
     <li className="provider-row">
diff --git a/src/lib/ipc.ts b/src/lib/ipc.ts
index e58e379..b79dabe 100644
--- a/src/lib/ipc.ts
+++ b/src/lib/ipc.ts
@@ -1338,6 +1338,19 @@ export function deleteProviderKey(providerId: string): Promise<void> {
   return invoke<void>("delete_provider_key", { providerId });
 }
 
+/**
+ * Whether the user opted in to handing stored provider keys to the local
+ * OmniRoute process (F-SEC-4). Off unless switched on.
+ */
+export async function getOmniRouteSchlüsselSync(): Promise<boolean> {
+  return (await invoke<boolean>("get_omniroute_Schlüssel_sync")) === true;
+}
+
+/** Records the key-sync opt-in; switching it on pushes the stored keys once. */
+export function setOmniRouteSchlüsselSync(enabled: boolean): Promise<void> {
+  return invoke<void>("set_omniroute_Schlüssel_sync", { enabled });
+}
+
 /** Whether the core has a key on file for the named provider. */
 export function hasProviderKey(providerId: string): Promise<boolean> {
   return invoke<boolean>("has_provider_key", { providerId });
```
