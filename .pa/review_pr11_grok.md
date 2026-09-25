The earlier findings are in the diff; I’ll check those fixes against the real dispatch and proof paths, then look for new holes that still false-pass or touch the wrong process.Prior fixes hold: a non-array or short queue answer fails the verdict, retention only deletes run-stamp directories, `-TargetPid` now throws instead of falling back to a title match, and a `[null]` queue element becomes status `malformed` and fails cleanly.

### Medium — a default proof run writes the production WebView profile

`PROJECTA_APP_DATA` only redirects the directory this app uses for the database, the log, and `projecta-api.json` (`src-tauri/src/main.rs`, `resolve_app_data_dir`). The window is created from `src-tauri/tauri.conf.json` with no `dataDirectory`. Tauri then puts WebView2 user data in `%LOCALAPPDATA%\<bundle identifier>` (for a normal build, `%LOCALAPPDATA%\com.projecta.app`). `scripts/runtime-proof.mjs` never changes that: `startApp` only sets `PROJECTA_APP_DATA` and `PROJECTA_QUEUE` (around line 117), and `resolveExe` prefers `src-tauri/target/debug/projecta.exe` and then the release exe, both built as `com.projecta.app` unless `TAURI_CONFIG` overrode the identifier at compile time.

The real UI reads and writes that profile on boot:

- `src/App.tsx` line 170 initializes `activeProjectId` from `localStorage["projecta.activeProjectId"]`.
- The bootstrap `loadProjects` effect (line 457) drops that id when it is not in this database. On a fresh sandbox that is the production id, so the effect at line 461 deletes the key.
- After phase 2 restarts onto the sandbox database, the same effect stores the scratch project’s id in the production profile.

The next production launch does not find that id and falls back to the first project. The user’s last-selected project is gone. This happens on a green run of a `tauri/custom-protocol` (or `tauri build`) binary with the default identifier — the build the script comment says to use so the screenshot shows the real UI. A `com.projecta.proof` binary is unaffected, because its WebView folder is a different identifier. The devUrl error page does not run this JavaScript, but it still opens the same profile.

Both phases then end in `taskkill /PID … /T /F` (`killProjectA`, around line 90). That is an unclean exit of WebView2 against the production profile, not only the one key write.
