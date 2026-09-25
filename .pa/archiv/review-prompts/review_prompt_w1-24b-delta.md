# Delta review W1-24b — F-SEC-4 OmniRoute Schlüssel sync opt-in

You reviewed W1-24b before (ProjectA, Tauri 2: the OmniRoute Schlüssel sync became
an opt-in setting `omniroute.Schlüssel_sync`, off unless the literal "1" is stored;
`sync_Schlüssels_to_omniroute(omni, vault, SchlüsselSync)` returns before network/vault
access without `KeySync::OptedIn`). Both reviewers found no blockers. This is
the DELTA after the review: the author's disposition (included in the diff as
`.pa/review_w1-24b_disposition.md`) and the code changes.

Check only: (a) are the accepted findings fixed correctly, (b) does the delta
introduce any new bug or a path that sends keys without consent, (c) are the
rejections/deviations in the disposition reasonable.

Format: `R-<n> | Schwere (blocker/hoch/mittel/niedrig) | Datei:Zeile | Befund |
Vorschlag`, and say explicitly "keine blockierenden Befunde" if none.

Note: `tauri::async_runtime::block_on` is called inside a
`tauri::async_runtime::spawn_blocking` closure (a blocking-pool thread, not an
async worker); the same pattern already exists in `web_interface.rs`.
`Store` is `#[derive(Clone)]` around an sqlx pool.

## Delta diff (dbf3544..HEAD)

```diff
diff --git a/.pa/review_w1-24b_disposition.md b/.pa/review_w1-24b_disposition.md
new file mode 100644
index 0000000..ca5ad65
--- /dev/null
+++ b/.pa/review_w1-24b_disposition.md
@@ -0,0 +1,32 @@
+# Review-Disposition W1-24b — F-SEC-4 Key-Sync als Opt-in
+
+Autor: Claude Code. Nahtstelle `main.rs` berührt → zwei herstellerfremde
+Reviews über `.pa/review_transport.py` (Ollama Cloud), Prompt
+`.pa/review_prompt_w1-24b.md` (Auftrag, Design, voller Diff gegen
+`origin/main` bis `dbf3544`).
+
+| Reviewer | Modell | Protokoll | Urteil |
+|---|---|---|---|
+| kimi-k3 | `kimi-k3:cloud` | `.pa/review_w1-24b_kimi-k3.md` | keine blockierenden Befunde, 4× niedrig |
+| deepseek-v4-flash | `deepseek-v4-flash:cloud` | `.pa/review_w1-24b_deepseek-v4-flash.md` | keine blockierenden Befunde, 1× mittel, 2× niedrig |
+
+Beide beantworten die Kernfragen gleich: kein Produktionspfad übergibt Keys
+ohne gespeichertes Opt-in; fehlender Settings-Eintrag = aus ist für
+Bestandsinstallationen garantiert; keine Secrets in Logs/Fehlern; keine
+Regression des W1-24-Tests.
+
+## Befunde
+
+| Befund | Schwere | Entscheidung | Umsetzung |
+|---|---|---|---|
+| deepseek R-1 / kimi R-2 — Zustimmung als Schnappschuss vor `spawn_blocking`; ein sofortiges Ausschalten kann vom schon gestarteten Push überholt werden | mittel / niedrig | **angenommen** | `spawn_consented_Schlüssel_sync` in `main.rs` liest `SchlüsselSync::from_setting` im Worker-Thread direkt vor dem Push erneut. Beide Aufrufer (`set_provider_Schlüssel`, `set_omniroute_Schlüssel_sync`) laufen darüber. Restfenster: zwischen diesem Lesen und dem POST (Millisekunden, lokal); ein bereits gesendeter Schlüssel lässt sich ohnehin nicht zurückholen. |
+| deepseek R-2 / kimi R-4 — `KeyVault::all` war `#[cfg(test)]`, jetzt produktiv `pub` | niedrig | **angenommen** (Sichtbarkeit), **abgelehnt** (`Zeroizing`) | `pub(crate)` plus Doku „nie loggen, nie über IPC/HTTP herausgeben". `Zeroizing` würde eine neue Abhängigkeit für eine Kopie einführen, die der Vault-Lesepfad (`read_soft`) ohnehin schon im Klartext hält — kein Gewinn in diesem Paket. |
+| deepseek R-3 / kimi R-3 — scheitert das erste Lesen, bleibt der Schalter für immer gesperrt; parallele Toggles nicht serialisiert | niedrig | **angenommen, mit Abweichung** | Rot zuerst: `a failed read keeps the box disabled until a refresh answers` (Exit 1 gegen den alten Dialog). Der Schalter bleibt nach einem Lesefehler gesperrt und ungehakt — bewusst **nicht** `setLoaded(true)` wie von kimi vorgeschlagen, weil ein freigegebener, ungehakter Schalter bei unbekanntem Zustand „aus" behaupten würde. Stattdessen fragt „Aktualisieren" erneut. Während eines Schreibzugriffs ist der Schalter gesperrt (`pending`), damit der Revert kein überholtes `previous` nimmt. |
+| kimi R-1 — Einmal-Push beim Einschalten hängt am letzten Online-Probe; war der Router zuletzt offline, wird nichts gesendet | niedrig | **angenommen als Doku-Präzisierung** | Doc-Kommentar von `set_omniroute_Schlüssel_sync` sagt jetzt, dass der Push am letzten Probe hängt und die Schlüssel sonst mit dem nächsten gespeicherten Schlüssel gehen. Kein frischer Probe im Einschaltpfad: der Probe-Thread läuft ohnehin, und das Paket soll das ursprüngliche Sync-Verhalten wiederherstellen, nicht erweitern. Der UI-Text verspricht keinen sofortigen Push. |
+
+## Delta-Runde
+
+Die Änderungen nach dem Review sind klein und rein defensiv (erneutes Lesen
+der Zustimmung, Sichtbarkeit, Schalter-Sperre, Doku). Ein Delta-Review mit
+beiden Reviewern auf den Delta-Diff ist unter
+`.pa/review_w1-24b-delta_*.md` abgelegt, sobald gelaufen.
diff --git a/src-tauri/src/main.rs b/src-tauri/src/main.rs
index fcd3282..e8e4b5b 100644
--- a/src-tauri/src/main.rs
+++ b/src-tauri/src/main.rs
@@ -1714,8 +1714,9 @@ async fn get_omniroute_Schlüssel_sync(store: State<'_, Store>) -> Result<bool, String>
 }
 
 /// Record the key-sync choice. Switching it on pushes the keys already in the
-/// vault once, so that the keys typed before the opt-in reach the router
-/// without being typed again; switching it off sends nothing.
+/// vault once - if the router counts as online by its last probe - so that the
+/// keys typed before the opt-in reach the router without being typed again;
+/// otherwise they go with the next saved key. Switching it off sends nothing.
 #[tauri::command]
 async fn set_omniroute_Schlüssel_sync(
     store: State<'_, Store>,
@@ -1724,19 +1725,30 @@ async fn set_omniroute_Schlüssel_sync(
     enabled: bool,
 ) -> Result<(), String> {
     providers::set_key_sync_enabled(&store, enabled).await?;
-    // Read back rather than trusting `enabled`: the consent handed to the sync
-    // is always the one the settings table holds.
-    let consent = providers::KeySync::from_setting(&store).await;
-    if consent == providers::KeySync::OptedIn {
-        let vault = Arc::clone(&vault);
-        let omni = Arc::clone(quota.omni_route());
-        tauri::async_runtime::spawn_blocking(move || {
-            providers::sync_keys_to_omniroute(&omni, &vault, consent);
-        });
+    if enabled {
+        spawn_consented_key_sync(&store, &vault, &quota);
     }
     Ok(())
 }
 
+/// Push the vault to OmniRoute off the UI thread - if, at the moment the
+/// worker thread runs, the settings table still holds the user's opt-in.
+///
+/// The consent is read *inside* the thread, right before the push, and not
+/// by the caller: a disable that lands between a save (or an enable) and the
+/// thread actually running is then honoured instead of racing it (dual review
+/// W1-24b, R-1). Without consent nothing is read from the vault and nothing
+/// is sent.
+fn spawn_consented_key_sync(store: &Store, vault: &Arc<KeyVault>, quota: &Arc<QuotaTracker>) {
+    let store = store.clone();
+    let vault = Arc::clone(vault);
+    let omni = Arc::clone(quota.omni_route());
+    tauri::async_runtime::spawn_blocking(move || {
+        let consent = tauri::async_runtime::block_on(providers::KeySync::from_setting(&store));
+        providers::sync_keys_to_omniroute(&omni, &vault, consent);
+    });
+}
+
 /// Store an API key for a provider.
 ///
 /// The key goes into `provider-keys.json` in the app data directory. Only if
@@ -1759,17 +1771,13 @@ async fn set_provider_key(
         quota.omni_route().set_token(Some(&key));
     }
 
-    // Only with the user's consent (F-SEC-4): without it nothing is sent and
-    // no thread is spawned. With it, best effort and off the UI thread:
+    // Only with the user's consent (F-SEC-4): without it no thread is spawned
+    // and nothing is sent. With it, best effort and off the UI thread:
     // OmniRoute not taking the Schlüssel costs the router a route, not the user
-    // their key.
-    let consent = providers::KeySync::from_setting(&store).await;
-    if consent == providers::KeySync::OptedIn {
-        let vault = Arc::clone(&vault);
-        let omni = Arc::clone(quota.omni_route());
-        tauri::async_runtime::spawn_blocking(move || {
-            providers::sync_keys_to_omniroute(&omni, &vault, consent);
-        });
+    // their key. The helper checks the consent once more right before the
+    // push.
+    if providers::key_sync_enabled(&store).await {
+        spawn_consented_key_sync(&store, &vault, &quota);
     }
     Ok(())
 }
diff --git a/src-tauri/src/providers.rs b/src-tauri/src/providers.rs
index 4c54aa8..b848392 100644
--- a/src-tauri/src/providers.rs
+++ b/src-tauri/src/providers.rs
@@ -672,8 +672,11 @@ impl KeyVault {
     }
 
     /// Every stored key, for the one caller that needs them all: the OmniRoute
-    /// key sync, and only once the user has opted in to it.
-    pub fn all(&self) -> BTreeMap<String, String> {
+    /// key sync, and only once the user has opted in to it. Crate-private on
+    /// purpose (dual review W1-24b, R-2): nothing else has a reason to hold
+    /// every key at once. Never log the result and never hand it to an IPC or
+    /// HTTP caller.
+    pub(crate) fn all(&self) -> BTreeMap<String, String> {
         self.read_soft().keys
     }
 
diff --git a/src/components/ProviderDialog.keysync.test.tsx b/src/components/ProviderDialog.keysync.test.tsx
index 1c7177d..1412801 100644
--- a/src/components/ProviderDialog.keysync.test.tsx
+++ b/src/components/ProviderDialog.keysync.test.tsx
@@ -67,6 +67,24 @@ describe("ProviderDialog OmniRoute Schlüssel sync", () => {
     expect(box).not.toBeChecked();
   });
 
+  it("a failed read keeps the box disabled until a refresh answers", async () => {
+    getOmniRouteSchlüsselSync.mockRejectedValueOnce("store busy").mockResolvedValue(true);
+    render(<ProviderDialog onClose={() => {}} />);
+
+    const box = await screen.findByRole("checkbox", { name: LABEL });
+    await waitFor(() => expect(screen.getByText("store busy")).toBeInTheDocument());
+    expect(box).toBeDisabled();
+    expect(box).not.toBeChecked();
+
+    const refresh = screen.getByRole("button", { name: "Aktualisieren" });
+    await waitFor(() => expect(refresh).not.toBeDisabled());
+    fireEvent.click(refresh);
+
+    await waitFor(() => expect(box).toBeChecked());
+    expect(box).not.toBeDisabled();
+    expect(screen.queryByText("store busy")).not.toBeInTheDocument();
+  });
+
   it("a failed write takes the box back", async () => {
     getOmniRouteSchlüsselSync.mockResolvedValue(false);
     setOmniRouteSchlüsselSync.mockRejectedValue("store locked");
diff --git a/src/components/ProviderDialog.tsx b/src/components/ProviderDialog.tsx
index a010687..4b674e4 100644
--- a/src/components/ProviderDialog.tsx
+++ b/src/components/ProviderDialog.tsx
@@ -1,4 +1,4 @@
-import { useEffect, useRef, useState } from "react";
+import { useCallback, useEffect, useRef, useState } from "react";
 
 import FreeTierPanel from "./FreeTierPanel";
 import {
@@ -123,7 +123,7 @@ export default function ProviderDialog({ onClose }: ProviderDialogProps) {
             <input
               type="checkbox"
               checked={keySync.enabled}
-              disabled={!keySync.loaded}
+              disabled={!keySync.usable}
               onChange={(event) => keySync.toggle(event.target.checked)}
             />
             <span>API-Keys an OmniRoute übergeben</span>
@@ -170,7 +170,10 @@ export default function ProviderDialog({ onClose }: ProviderDialogProps) {
           <button
             type="button"
             className="button-subtle provider-refresh"
-            onClick={refresh}
+            onClick={() => {
+              refresh();
+              keySync.reload();
+            }}
             disabled={loading}
           >
             Aktualisieren
@@ -190,41 +193,57 @@ export default function ProviderDialog({ onClose }: ProviderDialogProps) {
  * The F-SEC-4 opt-in: whether ProjectA hands the vault's provider keys to the
  * local OmniRoute process. The switch lives in the core's settings table, and
  * the box starts unchecked and disabled until the core has answered, so a slow
- * read never shows "on" for a sync that is off. A failed write takes the box
- * back, like the other switches.
+ * read never shows "on" for a sync that is off. A read that failed stays
+ * disabled rather than guessing; "Aktualisieren" asks again. The box is locked
+ * while a write is in flight, and a failed write takes it back, like the other
+ * switches.
  */
 function useOmniRouteSchlüsselSync() {
   const [enabled, setEnabled] = useState(false);
   const [loaded, setLoaded] = useState(false);
+  const [pending, setPending] = useState(false);
   const [error, setError] = useState<string | null>(null);
+  const aliveRef = useRef(true);
 
-  useEffect(() => {
-    let alive = true;
+  const reload = useCallback(() => {
     void getOmniRouteSchlüsselSync()
       .then((next) => {
-        if (!alive) return;
+        if (!aliveRef.current) return;
         setEnabled(next);
         setLoaded(true);
+        setError(null);
       })
       .catch((cause: unknown) => {
-        if (alive) setError(describeError(cause));
+        if (aliveRef.current) setError(describeError(cause));
       });
+  }, []);
+
+  useEffect(() => {
+    aliveRef.current = true;
+    reload();
     return () => {
-      alive = false;
+      aliveRef.current = false;
     };
-  }, []);
+  }, [reload]);
 
   const toggle = (next: boolean) => {
+    if (pending) return;
     const previous = enabled;
     setEnabled(next);
+    setPending(true);
     setError(null);
-    void setOmniRouteSchlüsselSync(next).catch((cause: unknown) => {
-      setEnabled(previous);
-      setError(describeError(cause));
-    });
+    void setOmniRouteSchlüsselSync(next)
+      .catch((cause: unknown) => {
+        if (!aliveRef.current) return;
+        setEnabled(previous);
+        setError(describeError(cause));
+      })
+      .finally(() => {
+        if (aliveRef.current) setPending(false);
+      });
   };
 
-  return { enabled, loaded, error, toggle };
+  return { enabled, usable: loaded && !pending, error, toggle, reload };
 }
 
 function ProviderRow({ provider, routed }: { provider: Provider; routed: AgentProfile[] }) {
```
