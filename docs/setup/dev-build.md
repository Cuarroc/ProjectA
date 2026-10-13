# „ProjectA Dev“ — Vorschau-Build von `main`

Stand: 2026-10-13 (DEV-BUILD-1, Entscheidung E5; DEV-BUILD-2: Zeilen 1, 2 und
7 der Isolationstabelle behoben; FU-DEV-BUILD-2b: Zeile 7 präzisiert — erster
existierender Kandidat gewinnt). Kein Release, kein Update-Kanal.

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

Auch mit DEV-BUILD-2 bleiben die Zeilen 5 und 6 der Liste offen; „ProjectA
Dev“ gehört weiter auf eine Maschine, auf der ein Datengriff der stabilen App
nichts kaputt macht. Die Liste (Zeilen 1, 2 und 7 sind seit DEV-BUILD-2
behoben):

| # | Stelle (Datei:Zeile) | Bricht Nebeneinander? | Behebung (DEV-BUILD-2) |
|---|---|---|---|
| 1 | `src-tauri/src/bin/pa.rs` las die Kennung aus einer Konstante, benutzt für den DB-Pfad und den Descriptor-Pfad | **Ja.** `pa.exe` des Dev-Builds las Datenbank und API-Token der normalen App. Gemildert nur, wo `PROJECTA_APP_DATA` / `PROJECTA_API_FILE` gesetzt ist (die App setzt den Descriptor für ihre Agenten, `workers.rs:536`) | **Behoben.** Die Kennung kommt aus dem Build (`option_env!("PROJECTA_IDENTIFIER")`, `src-tauri/src/build_identifier.rs`); `dev-build.yml` setzt sie auf `com.projecta.dev`, `dev-build-shape.sh` wacht darüber |
| 2 | `src-tauri/src/hooks.rs` (`app_data_dir`) hängte `com.projecta.app` hart an; Verwendung im `<Datenverzeichnis>/hooks`, Hook-Einstellungen je Agent | **Ja.** Dev schrieb Hook-Dateien in das Verzeichnis der normalen App; Override `PROJECTA_APP_DATA` existiert | **Behoben.** Das Verzeichnis folgt derselben eingebetteten Kennung (`build_identifier::IDENTIFIER`) |
| 3 | `src-tauri/src/main.rs:3306-3326` `app_data_dir` nimmt `app.path().app_data_dir()` | Nein. Folgt der Kennung aus der Konfiguration, Dev bekommt `com.projecta.dev` (DB, Descriptor, Logs `logging.rs:51`). Aber: App und Punkte 1/2 sind danach uneins über den Ordner | keine eigene; hängt an 1 und 2 |
| 4 | Einzelinstanz: `main.rs:3596` (`tauri_plugin_single_instance`) | Nein. Die Sperre heißt `{Kennung}-sim` (Plugin 2.x, `windows.rs:68`), also getrennt je Kennung. Der Kommentar `main.rs:3305` ist veraltet formuliert | keine |
| 5 | CLI und Capture-Host: `pa.exe` wird neben der App gesucht (`workers.rs:1323`); der Host `pa-capture-host.exe` braucht ein signiertes Manifest (`workers/native_resources.rs:131`) und die eingebettete Commit-ID (`:57`), beides erzeugt `scripts/build-signed-windows.mjs` mit Signier-Schlüssel (`scripts/lib/native-package.mjs:80-83`) | Teilweise. Kein Schreiben nach PATH gefunden (keine Treffer in `src-tauri/src`). Aber der unsignierte Dev-Build hat **kein** Manifest: Capture-Funktionen melden „nicht verfügbar“ | eigener Dev-Signierweg ohne Release-Schlüssel oder Capture im Dev-Build abschalten; Entscheidung des Nutzers (Schlüssel) |
| 6 | Autostart, Deep-Link/URL-Schema, Registry | Nein. Keine Treffer für autostart, deep-link, winreg/HKEY in `src-tauri/src`, `Cargo.toml`, `capabilities/`. Installer-Einträge (Deinstallationsschlüssel, Installationsordner) richten sich nach Produktname/Kennung: **nicht beobachtet**, nur Annahme | nach dem ersten Dev-Build auf einer leeren Maschine prüfen |
| 7 | HQ-Port und Descriptor: `api.rs:201` `projecta-api.json`, Port flüchtig auf `127.0.0.1` (`api.rs:5-10`) | Nein für die Apps (Port je Start frei, Datei je Kennung). Ja für Werkzeuge mit fester Kennung: `scripts/lib/hq-live-lib.mjs`, `scripts/hq-queue-open-points.mjs`, `scripts/dev-setup.mjs` fanden nur die normale App | **Behoben.** Die Suchlisten enthalten je Basis auch `com.projecta.dev` (stabil zuerst, Dev als Fallback). Die Werkzeuge nehmen den **ersten existierenden** Kandidaten: sind beide Apps installiert, erreichen sie die stabile App, solange `PROJECTA_APP_DATA` nicht gesetzt ist |
| 8 | Skripte mit fester Kennung: `scripts/backup-db.sh:4,20`, `scripts/restore-probe.sh:5,21`, `scripts/drills/{singleton,backup,updater,estop,crash}-drill.ps1`, `scripts/f8-isolated-proof.ps1:2` | Nein. Sie zielen nur auf die normale App und stören Dev nicht; sie sichern Dev aber auch nicht | Parameter `-AppDir` bzw. Umgebungsvariable dokumentieren |
| 9 | Updater: `src/screens/einstellungen/VersionUpdates.tsx:24` `check()`, Plugin `main.rs:3629`, Recht `capabilities/default.json:7-8` | Nein. Die Overlay-Datei leert `plugins.updater.endpoints`; das Plugin lehnt die Prüfung dann ab (`tauri-plugin-updater` 2.13.0, `updater.rs:452`, `EmptyEndpoints`). Folge: der Knopf zeigt eine Fehlermeldung. Nicht im Dev-Build ausprobiert | freundlichere Meldung im Dev-Build (optional) |
| 10 | Overlay `src-tauri/tauri.dev-channel.conf.json` wiederholt `app.windows` ganz (JSON-Merge ersetzt Listen) | Nein, aber Wartung: ändert sich das Fenster in `tauri.conf.json`, muss das Overlay folgen | Prüfung in `dev-build-shape.sh` ergänzen |

Die Version des Dev-Builds ist dieselbe wie die der normalen App (`tauri.conf.json:4`);
weil Produktname und Kennung abweichen, sind das zwei getrennte Installationen.

## Automatische Aktualisierung vorbereiten (DEV-AUTO-2)

`node scripts/dev/dev-autoupdate.mjs` erledigt genau einen Durchlauf unter Windows.
Root richtet nach Merge und Windows-Abnahme die Aufgabe alle fünf Minuten ein;
die oben genannten offenen Isolationspunkte bleiben Voraussetzung für den Einsatz.
Benötigt werden Node 24, angemeldetes `gh`, PowerShell und das vorhandene Gitleaks
mit der Repo-Konfiguration. Das Skript installiert keine Werkzeuge.
Installer-Vertrauen beruht ausschließlich auf dem GitHub-Artefakt eines `main`-Laufs; eine zusätzliche Signatur wird nicht geprüft.
Es lädt nur den neuesten erfolgreichen `dev-build.yml`-Lauf auf `main` und dessen
Dev-NSIS-Artefakt. Dev-Prozesse mit Kindern und eine offene stabile App verschieben
das Update; unbekannte Prozesspfade führen zum Aufschub. Ein geschlossenes, zuvor
ruhendes Dev-Fenster wird nach dem Installationsversuch wieder gestartet.
Die Prozessprüfung ist eine Momentaufnahme, keine Sperre gegen neue App-Starts.
Zustand und einzeilige Laufprotokolle liegen unter `%LOCALAPPDATA%/projecta-dev-autoupdate`.
Ein verbliebener `running.lock` nach einem Absturz erfordert manuelle Prüfung.
Downloads und Fingerabdrücke bleiben erhalten; es gibt keine automatische Bereinigung.
Neue Fehler aus `%APPDATA%/com.projecta.dev` werden lokal nach bereinigter Meldung
gruppiert. Gitleaks-Fundzeilen, Pfade und Benutzerkennung werden entfernt;
je Signatur bleiben höchstens 40 Fehlerzeilen. `PA_CRASH_INBOX` überschreibt
`%USERPROFILE%/pa-orch/crash-inbox`. Es gibt keinen Upload und keine automatische Reparatur.
Exit 0 bedeutet erledigt/aufgeschoben, Exit 2 einen fehlgeschlagenen Schritt.
Stoppen: `schtasks /Delete /TN ProjectA-Dev-Autoupdate`.
