# „ProjectA Dev“ — Vorschau-Build von `main`

Stand: 2026-10-11 (DEV-BUILD-1, Entscheidung E5). Kein Release, kein Update-Kanal.

## Was das ist

Ein Installer der aktuellen `main`-Fassung, der sich „ProjectA Dev“ nennt und
die eigene Kennung `com.projecta.dev` trägt. Er soll später neben der normalen
App laufen, mit eigenem Profil und eigener Datenbank. Er ist **nicht
signiert** und aktualisiert sich **nie selbst**: die Update-Adressliste ist in
dieser Fassung leer, die Update-Dateien werden nicht erzeugt.

## Auslösen und abholen

```sh
gh workflow run dev-build.yml            # baut den Stand von main
gh workflow run dev-build.yml --ref <branch>
gh run watch                             # warten; ein Windows-Build dauert lange
```

Das Ergebnis ist ein Artefakt `projecta-dev-<kurze Commit-ID>` am Lauf (Reiter
„Actions“, ganz unten), mit dem NSIS-Installer (`.exe`) und dem MSI. Es wird
14 Tage aufbewahrt. Der Job hat nur Lese-Rechte, keine Secrets, keine
Freigabe-Umgebung; Schutz: `bash scripts/ci/dev-build-shape.sh`. Der Lauf
braucht die Workflow-Datei auf `main`, vorher kann man ihn nicht starten.

## Noch NICHT neben der normalen App installieren

Solange DEV-BUILD-2 nicht gemergt ist, greift „ProjectA Dev“ an mehreren Stellen
auf die Daten der normalen App zu. Die Liste (Prüfung, nichts repariert):

| # | Stelle (Datei:Zeile) | Bricht Nebeneinander? | Behebung (DEV-BUILD-2) |
|---|---|---|---|
| 1 | `src-tauri/src/bin/pa.rs:133` `IDENTIFIER = "com.projecta.app"`, benutzt für den DB-Pfad `:1041` und den Descriptor-Pfad `:2761` | **Ja.** `pa.exe` des Dev-Builds liest Datenbank und API-Token der normalen App. Gemildert nur, wo `PROJECTA_APP_DATA` / `PROJECTA_API_FILE` gesetzt ist (`:1038`, `:2755`; die App setzt den Descriptor für ihre Agenten, `workers.rs:536`) | Kennung beim Bauen einbetten (`option_env!`) statt Konstante; Seam-Datei, nur seriell |
| 2 | `src-tauri/src/hooks.rs:503` (`app_data_dir`, ab `:485`) hängt `com.projecta.app` an; Verwendung `:549` (`<Datenverzeichnis>/hooks`, Hook-Einstellungen je Agent) | **Ja.** Dev schreibt Hook-Dateien in das Verzeichnis der normalen App; Override `PROJECTA_APP_DATA` (`:486`) existiert | Verzeichnis aus der Tauri-Kennung ableiten oder die Kennung aus Punkt 1 teilen |
| 3 | `src-tauri/src/main.rs:3306-3326` `app_data_dir` nimmt `app.path().app_data_dir()` | Nein. Folgt der Kennung aus der Konfiguration, Dev bekommt `com.projecta.dev` (DB, Descriptor, Logs `logging.rs:51`). Aber: App und Punkte 1/2 sind danach uneins über den Ordner | keine eigene; hängt an 1 und 2 |
| 4 | Einzelinstanz: `main.rs:3596` (`tauri_plugin_single_instance`) | Nein. Die Sperre heißt `{Kennung}-sim` (Plugin 2.x, `windows.rs:68`), also getrennt je Kennung. Der Kommentar `main.rs:3305` ist veraltet formuliert | keine |
| 5 | CLI und Capture-Host: `pa.exe` wird neben der App gesucht (`workers.rs:1323`); der Host `pa-capture-host.exe` braucht ein signiertes Manifest (`workers/native_resources.rs:131`) und die eingebettete Commit-ID (`:57`), beides erzeugt `scripts/build-signed-windows.mjs` mit Signier-Schlüssel (`scripts/lib/native-package.mjs:80-83`) | Teilweise. Kein Schreiben nach PATH gefunden (keine Treffer in `src-tauri/src`). Aber der unsignierte Dev-Build hat **kein** Manifest: Capture-Funktionen melden „nicht verfügbar“ | eigener Dev-Signierweg ohne Release-Schlüssel oder Capture im Dev-Build abschalten; Entscheidung des Nutzers (Schlüssel) |
| 6 | Autostart, Deep-Link/URL-Schema, Registry | Nein. Keine Treffer für autostart, deep-link, winreg/HKEY in `src-tauri/src`, `Cargo.toml`, `capabilities/`. Installer-Einträge (Deinstallationsschlüssel, Installationsordner) richten sich nach Produktname/Kennung: **nicht beobachtet**, nur Annahme | nach dem ersten Dev-Build auf einer leeren Maschine prüfen |
| 7 | HQ-Port und Descriptor: `api.rs:201` `projecta-api.json`, Port flüchtig auf `127.0.0.1` (`api.rs:5-10`) | Nein für die Apps (Port je Start frei, Datei je Kennung). Ja für Werkzeuge mit fester Kennung: `scripts/lib/hq-live-lib.mjs:18-23`, `scripts/hq-queue-open-points.mjs:92-95`, `scripts/dev-setup.mjs:94-96` finden nur die normale App | Suchliste um `com.projecta.dev` erweitern oder `PROJECTA_APP_DATA` auswerten |
| 8 | Skripte mit fester Kennung: `scripts/backup-db.sh:4,20`, `scripts/restore-probe.sh:5,21`, `scripts/drills/{singleton,backup,updater,estop,crash}-drill.ps1`, `scripts/f8-isolated-proof.ps1:2` | Nein. Sie zielen nur auf die normale App und stören Dev nicht; sie sichern Dev aber auch nicht | Parameter `-AppDir` bzw. Umgebungsvariable dokumentieren |
| 9 | Updater: `src/screens/einstellungen/VersionUpdates.tsx:24` `check()`, Plugin `main.rs:3629`, Recht `capabilities/default.json:7-8` | Nein. Die Overlay-Datei leert `plugins.updater.endpoints`; das Plugin lehnt die Prüfung dann ab (`tauri-plugin-updater` 2.13.0, `updater.rs:452`, `EmptyEndpoints`). Folge: der Knopf zeigt eine Fehlermeldung. Nicht im Dev-Build ausprobiert | freundlichere Meldung im Dev-Build (optional) |
| 10 | Overlay `src-tauri/tauri.dev-channel.conf.json` wiederholt `app.windows` ganz (JSON-Merge ersetzt Listen) | Nein, aber Wartung: ändert sich das Fenster in `tauri.conf.json`, muss das Overlay folgen | Prüfung in `dev-build-shape.sh` ergänzen |

Die Version des Dev-Builds ist dieselbe wie die der normalen App (`tauri.conf.json:4`);
weil Produktname und Kennung abweichen, sind das zwei getrennte Installationen.
