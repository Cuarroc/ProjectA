# Delta-Review-Auftrag: W2-08a Runde 2 — Umsetzung der Befunde aus Runde 1 (Rust-Test/Doku, `src-tauri/src/process_capture/*`)

Du bist unabhängiger Code-Reviewer. Antworte auf Deutsch. Befunde als
`X<n> — <hoch|mittel|niedrig> — <Stelle>` mit Begründung und Fix, danach
"Geprüft und verworfen" und Gesamturteil (mergebar ja/nein). Prüfe nur das Delta:
ob die Befunde korrekt umgesetzt sind und ob das Delta neue Fehler einführt.

## Kontext

Paket W2-08a: jede begrenzte Native-Capture (`process_capture`, Host und Parent)
bricht neben Launch-Deadline und Byte-Limit neu auch bei Stillstand ab: ein
Prozess, der 15 Minuten kein stdout/stderr-Byte liefert, wird mit Grund
("no output for …") beendet; Ausgabe exakt am Byte-Limit wird zugelassen, ein
Byte mehr bricht mit `capture output exceeded byte limit` ab. Die Grenzen
entscheidet das reine Modul `stream_guard`. Runde 1: kimi-k3 "SHIP" mit drei
niedrigen Befunden (F1–F3); glm-5.2 und die kimi-k3-Delta-Runde fielen mit
HTTP 429 (Ollama-Cloud-Sitzungslimit) aus.

## Umgesetzt in diesem Delta (Commit `e2ffb04`, nur Testcode, Doku, Skriptkommentar)

- F1: `docs/development/CONTINUOUS.md` — die Formulierung schrieb dem
  `stream_guard`-Modul fälschlich die Launch-Deadline zu; jetzt: die Deadline
  liegt in der Pipe-Loop, `stream_guard` entscheidet nur Byte-Limit und
  No-Progress-Fenster.
- F2: `windows_capture.rs` — `WAIT_OBJECT_0` im Test-Helfer
  `assert_fixture_retired` war nur implizit verfügbar; jetzt expliziter Import
  neben `CloseHandle`.
- F3: Flood-Test — die Fixture gibt jetzt erst `PA_FLOOD_HEAD` aus (unter dem
  Limit, geflusht, 300 ms Pause), dann den Überlauf. Der Test verlangt, dass
  der zugelassene Kopf beim Observer ankam UND dass die Gesamtausgabe das Limit
  nie überschritt (`stdout.len() <= limit` plus Fenster-Suche nach
  `PA_FLOOD_HEAD`). Vorher wurde nur `<= limit` geprüft, ohne dass etwas
  Zugelassenes nachgewiesen war.
- Kommentar in `scripts/ci/native-tests.sh`: sechs → neun Tests starten die
  Fixture (stall/trickle/flood kamen mit W2-08a dazu).

Nicht im Diff: der Commit `b568432` legt nur die Review-Protokolle und die
Disposition unter `.pa/` ab (Review-Artefakte, kein Code) und ist hier
ausgenommen.

Ergebnis lokal laut Worker: der Flood-Test lief 5-mal hintereinander grün.

## Delta-Diff (Runde-1-Stand `865bdd8` -> jetzt, ohne `.pa/`)

```diff
diff --git a/docs/development/CONTINUOUS.md b/docs/development/CONTINUOUS.md
index 9aa2ca4..acc5e44 100644
--- a/docs/development/CONTINUOUS.md
+++ b/docs/development/CONTINUOUS.md
@@ -511,8 +511,9 @@ open; all claimed task roles count conservatively toward this ceiling.
 ## Native capture streaming limits
 
 Every bounded native capture (`process_capture`, host and parent) enforces
-three limits in its pipe loop, decided by the pure `stream_guard` module: the
-launch deadline, the output byte limit and, since W2-08a, a no-progress window.
+three limits in its pipe loop: the launch deadline and two limits decided by
+the pure `stream_guard` module, the output byte limit and, since W2-08a, a
+no-progress window.
 Output exactly at the byte limit is admitted; one byte more aborts with
 `capture output exceeded byte limit`, and an overflowing total counts as over
 the limit. A live process that emits no stdout/stderr byte for 15 minutes
diff --git a/scripts/ci/native-tests.sh b/scripts/ci/native-tests.sh
index bca134a..30ef6d5 100755
--- a/scripts/ci/native-tests.sh
+++ b/scripts/ci/native-tests.sh
@@ -17,12 +17,13 @@
 #   - 3 in src-tauri/src/workers.rs                     (real_native_*)
 #   - 1 in src-tauri/src/process_capture/windows_capture.rs:
 #       native_argument_fixture. Das ist kein eigenstaendiger Test, sondern
-#       ein isolierter Kind-Prozess-Fixture: sechs ANDERE, NICHT ignorierte
-#       Tests derselben Datei starten ihn selbst per current_exe()+--exact
+#       ein isolierter Kind-Prozess-Fixture: neun ANDERE, NICHT ignorierte
+#       Tests derselben Datei (seit W2-08a auch stall/trickle/flood)
+#       starten ihn selbst per current_exe()+--exact
 #       mit PA_CAPTURE_FIXTURE_MODE gesetzt. Ohne diese Variable direkt
 #       gestartet, panict er bewusst ("fixture must only run with explicit
 #       isolated mode") - das ist sein Vertrag, kein stumm ausgeklammerter
-#       Test. Er laeuft ohnehin schon jedes Mal, wenn diese sechs Tests im
+#       Test. Er laeuft ohnehin schon jedes Mal, wenn diese neun Tests im
 #       Gate rust-suite laufen (sie liegen in der projecta_capture-Bibliothek,
 #       AGENTS.md: "the shared native capture tests run once in the
 #       projecta_capture library" - dort auch fuer die anderen zwei
diff --git a/src-tauri/src/process_capture/windows_capture.rs b/src-tauri/src/process_capture/windows_capture.rs
index 1713b9e..66ff265 100644
--- a/src-tauri/src/process_capture/windows_capture.rs
+++ b/src-tauri/src/process_capture/windows_capture.rs
@@ -2508,7 +2508,7 @@ mod tests {
     /// The fixture recorded its PID; after the capture returned, that process
     /// must be gone (or at least signaled exited), never a live zombie.
     fn assert_fixture_retired(marker: &Path) {
-        use windows_sys::Win32::Foundation::CloseHandle;
+        use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
         use windows_sys::Win32::System::Threading::{
             OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
             PROCESS_SYNCHRONIZE,
@@ -2630,8 +2630,17 @@ mod tests {
             "after {elapsed:?}"
         );
         assert!(elapsed < Duration::from_secs(10), "{elapsed:?}");
-        // Whatever was admitted before the abort stays within the limit.
-        assert!(stdout_of(&events).len() <= limit);
+        // The head admitted before the overrun stays delivered to the
+        // observer, and nothing beyond the limit was ever handed out.
+        let stdout = stdout_of(&events);
+        assert!(stdout.len() <= limit, "{}", stdout.len());
+        assert!(
+            stdout
+                .windows(b"PA_FLOOD_HEAD".len())
+                .any(|bytes| bytes == b"PA_FLOOD_HEAD"),
+            "{}",
+            String::from_utf8_lossy(&stdout)
+        );
         // The fixture writes its PID before its first output byte.
         assert_fixture_retired(&marker);
     }
@@ -2732,6 +2741,10 @@ mod tests {
             // W2-08a: far more output than the capture's byte limit, then held.
             Ok("flood") => {
                 write_fixture_pid();
+                // An admitted head below the limit, then the overrun.
+                println!("PA_FLOOD_HEAD");
+                std::io::stdout().flush().unwrap();
+                std::thread::sleep(Duration::from_millis(300));
                 let line = "x".repeat(1023);
                 for _ in 0..256 {
                     println!("{line}");
```
