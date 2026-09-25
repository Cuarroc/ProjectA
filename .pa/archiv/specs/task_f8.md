# F8: paketierte Kreuzmatrix (isoliert)

Status: historisch

Repo: `<repo-root>`.

Plan: `docs/SANIERUNGSPLAN.md` Rev 9, F8 und §8.

## Warum

Der Golden Path und die F1-SI-/Panic-Belege dürfen die Produktions-DB nicht
öffnen. Eine gefüllte Queue würde echte Worker spawnen; Dev- und Produkt-Exe
teilen den Mutex `com.projecta.app`.

## Auftrag

1. `PROJECTA_APP_DATA` als opt-in App-Datenverzeichnis (DB, Log, Deskriptor).
   Der Single-Instance-Mutex bleibt an der Bundle-ID.
2. Isolierter Zwei-Prozess-Beleg gegen `src-tauri/target/release/projecta.exe`
   (`scripts/f8-isolated-proof.ps1`): ein PID, Deskriptor unverändert, Logzeile
   `second instance turned away`, Panic-Marker rotiert.
3. Kein Start, solange ein `projecta`-Prozess läuft.
4. Gleichzeitiger Doppelstart und Kill+Relaunch (Updater-Proxy ohne Signatur).
5. Golden-Path-Subset (`scripts/f8-golden-path.ps1`): Scratch-Repo, Fake-CLIs
   neben einer Exe-Kopie, `pa project create`, `pa tree` nicht leer, direkter
   `succeed`-Spawn ohne Orchestrator. Attention/Review/Merge bleiben UI.
6. Signed-Updater-Kanal (`scripts/f8-signed-updater.ps1`): anonymes `latest.json`
   plus Signaturfeld. Ein signed Relaunch braucht `TAURI_SIGNING_PRIVATE_KEY`
   und darf nicht über Produktions-AppData installieren.

## Report

`.pa/report_f8.md`, `.pa/report_f8_remainder.md`, `.pa/report_f8_golden.md`,
`.pa/report_f8_signed_updater.md`
