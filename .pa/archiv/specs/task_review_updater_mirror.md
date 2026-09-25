Status: historisch

Du bist die ZWEITE Review-Instanz (Runde 2) fuer einen Hotfix an ProjectA (Tauri-2-Desktop-App, Windows, privates Repo).

KONTEXT: Der Produktions-Updater meldete "Could not fetch a valid release JSON from the remote". Ursache: Endpoint zeigte auf das private Hauptrepo (anonym 404); eine fruehere Verifikation lief faelschlich MIT Token. Fix: oeffentliches Mirror-Repo Cuarroc/ProjectA-updates; latest.json als Release-Asset unter releases/latest/download/latest.json; Release-CI spiegelt exe+sig+Manifest und verifiziert danach ANONYM. Kanal mit v1.2.0 anonym verifiziert (Manifest 200, Asset-GET 200, Sig 200). Strings-Scan der oeffentlichen exe: sauber (keine Tokens/IP; ASCII-Scan, UTF-16-Grenze bekannt).

RUNDE 1 (kimi-k2.7-code) fand u.a.: fehlende gh-Exit-Code-Pruefungen in pwsh, Verify-Gate per HEAD statt GET, fehlende Schema-/Sig-Checks im Gate, Test deckte URL-Schema nicht ab, vitest lief in der Release-CI NIE, Doku ungenau (v1.1.1 vs v1.2.0). ALLE diese Punkte wurden eingearbeitet — das siehst du im Diff.

DEIN AUFTRAG (kritisch, keine Hoeflichkeiten):
1. Verifiziere, dass die Runde-1-Auflagen KORREKT umgesetzt sind (pwsh-Exit-Checks lueckenlos? GET-Gate richtig? Test-Assertions wasserdicht?).
2. Finde REST-Fehler: YAML/pwsh-Syntax, GitHub-Actions-Semantik, Logikfehler, Sicherheitsaspekte (Mirror oeffentlich, Token-Handling), Doku-Widersprueche.
3. Gibt es etwas, das v1.2.1 (naechstes Release) zum Scheitern bringen wuerde?

FORMAT: Befunde mit Schwere (BLOCKER/HOCH/MITTEL/NIEDRIG) + Datei:Zeile + Fix-Vorschlag. Wenn ein Bereich sauber ist, sag es in einem Satz. Antworte auf Deutsch.

DIFF (git diff main, Stand nach Runde-1-Fixes):
diff --git a/.github/workflows/release.yml b/.github/workflows/release.yml
index daf2df0..b0b5a60 100644
--- a/.github/workflows/release.yml
+++ b/.github/workflows/release.yml
@@ -45,6 +45,11 @@ jobs:
       - name: Gate - typecheck
         run: npm run typecheck
 
+      # Lief in der Release-CI bisher NIE (Review-Befund 31.08.): die Frontend-
+      # Suite enthaelt u.a. den Updater-Endpoint-Regressionstest.
+      - name: Gate - frontend tests (vitest)
+        run: npx vitest run
+
       # `npx tauri build` runs `npm run build` (tsc + vite) through
       # beforeBuildCommand and is the release-profile cargo build -
       # together with the steps above that covers every README gate.
@@ -55,12 +60,10 @@ jobs:
           TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ""
 
       # Der Updater auf Windows nutzt die .exe selbst als Update-Bundle
-      # (kein .nsis.zip in Tauri v2). Das Repo ist privat: das Manifest
-      # liegt kanonisch unter updates/latest.json IM REPO (stabile
-      # raw.githubusercontent-URL mit Token), die exe-URL zeigt auf die
-      # api.github.com-Asset-URL (funktioniert mit Bearer + octet-stream,
-      # beides am 31.08. verifiziert).
-      - name: Attach installers and updater artifacts to the GitHub release
+      # (kein .nsis.zip in Tauri v2). Das Hauptrepo-Release bleibt die
+      # private, vollstaendige Ablage; der oeffentliche Update-Kanal laeuft
+      # ueber das Mirror-Repo (naechster Schritt).
+      - name: Attach installers to the private GitHub release
         uses: softprops/action-gh-release@v2
         with:
           files: |
@@ -69,33 +72,86 @@ jobs:
             src-tauri/target/release/bundle/msi/*.msi
           body: "Details: CHANGELOG.md und KNOWN_ISSUES.md im Repo."
 
-      - name: Publish updates/latest.json into the repo
+      # Das Hauptrepo ist PRIVAT — rohe URLs und api-Asset-URLs liefern
+      # anonym 404 (Befund 31.08.: Updater-Fehler "Could not fetch a valid
+      # release JSON"). Deshalb: Manifest + Installer ins OEFFENTLICHE
+      # Mirror-Repo Cuarroc/ProjectA-updates spiegeln. latest.json liegt als
+      # Release-Asset unter der stabilen URL
+      # releases/latest/download/latest.json (Tauri-Standard; kein
+      # raw-CDN-Cache-Problem, kein Git-Push in ein Fremdrepo noetig).
+      - name: Publish installer + updater manifest to the public ProjectA-updates mirror
         shell: pwsh
         env:
-          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
+          MIRROR_TOKEN: ${{ secrets.UPDATES_MIRROR_TOKEN }}
         run: |
+          $ErrorActionPreference = 'Stop'
+          $ProgressPreference = 'SilentlyContinue'
           $version = ${env:GITHUB_REF_NAME} -replace '^v',''
-          $sig = (Get-Content "src-tauri/target/release/bundle/nsis/ProjectA_${version}_x64-setup.exe.sig" -Raw).Trim()
-          # Kein jq in pwsh: PS zersplittert den jq-String in zwei Argumente
-          # (Release v1.2.0 daran gescheitert). JSON in PowerShell filtern.
-          $rel = gh api "repos/Cuarroc/ProjectA/releases/tags/v$version" | ConvertFrom-Json
-          $assetId = ($rel.assets | Where-Object { $_.name -eq "ProjectA_${version}_x64-setup.exe" }).id
-          if (-not $assetId) { Write-Error "exe asset id nicht gefunden"; exit 1 }
+          if (-not $env:MIRROR_TOKEN) {
+            Write-Error "Secret UPDATES_MIRROR_TOKEN fehlt: fine-grained PAT auf Cuarroc/ProjectA-updates (contents: read+write) anlegen und als Repo-Secret setzen."
+            exit 1
+          }
+          $exe = "src-tauri/target/release/bundle/nsis/ProjectA_${version}_x64-setup.exe"
+          $sig = (Get-Content "$exe.sig" -Raw).Trim()
+          $env:GH_TOKEN = $env:MIRROR_TOKEN
+          # Native gh-Aufrufe stoppen pwsh NICHT bei Fehlern — jeder Exit-Code
+          # wird explizit geprueft (Review-Befund 31.08.).
+          gh release view "v$version" --repo Cuarroc/ProjectA-updates 2>$null | Out-Null
+          if ($LASTEXITCODE -ne 0) {
+            gh release create "v$version" --repo Cuarroc/ProjectA-updates --title "ProjectA v$version" --notes "Auto-Update-Kanal (Spiegel). Quellcode: github.com/Cuarroc/ProjectA (privat)."
+            if ($LASTEXITCODE -ne 0) { throw "gh release create fehlgeschlagen (exit $LASTEXITCODE)" }
+          }
+          gh release upload "v$version" $exe "$exe.sig" --repo Cuarroc/ProjectA-updates --clobber
+          if ($LASTEXITCODE -ne 0) { throw "gh release upload installer fehlgeschlagen (exit $LASTEXITCODE)" }
+          $assetUrl = "https://github.com/Cuarroc/ProjectA-updates/releases/download/v$version/ProjectA_${version}_x64-setup.exe"
+          # Kein jq in pwsh (v1.2.0 daran gescheitert): JSON nativ bauen.
           $manifest = @{
             version = $version
-            notes = "Details: CHANGELOG.md im Repo."
+            notes = "Details: CHANGELOG.md im Hauptrepo."
             pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
             platforms = @{
               "windows-x86_64" = @{
                 signature = $sig
-                url = "https://api.github.com/repos/Cuarroc/ProjectA/releases/assets/$assetId"
+                url = $assetUrl
               }
             }
-          } | ConvertTo-Json -Depth 4
-          New-Item -ItemType Directory -Force updates | Out-Null
-          Set-Content "updates/latest.json" $manifest -NoNewline
-          git config user.name "projecta-release-bot"
-          git config user.email "release-bot@localhost"
-          git add updates/latest.json
-          git commit -m "chore(release): updater manifest v$version [skip ci]"
-          git push origin main
+          } | ConvertTo-Json -Depth 4 -Compress
+          New-Item -ItemType Directory -Force mirror-tmp | Out-Null
+          Set-Content "mirror-tmp/latest.json" $manifest -NoNewline -Encoding utf8NoBOM
+          gh release upload "v$version" mirror-tmp/latest.json --repo Cuarroc/ProjectA-updates --clobber
+          if ($LASTEXITCODE -ne 0) { throw "gh release upload latest.json fehlgeschlagen (exit $LASTEXITCODE)" }
+
+      # Anonymes Verify-Gate: exakt die Requests, die die App stellt — OHNE
+      # jeden Auth-Header. Repo-Regel: Endpoint-Verifikation nie mit
+      # Credentials, die das Produkt nicht hat. Faengt den 31.08.-Befund.
+      - name: Verify updater channel anonymously (app-identical requests)
+        shell: pwsh
+        run: |
+          $ErrorActionPreference = 'Stop'
+          $ProgressPreference = 'SilentlyContinue'
+          $version = ${env:GITHUB_REF_NAME} -replace '^v',''
+          $manifestUrl = "https://github.com/Cuarroc/ProjectA-updates/releases/latest/download/latest.json"
+          $m = $null
+          foreach ($i in 1..6) {
+            try { $m = Invoke-RestMethod -Uri $manifestUrl -UseBasicParsing; break }
+            catch { Write-Host "Manifest-Versuch $i fehlgeschlagen: $($_.Exception.Message)"; Start-Sleep -Seconds 20 }
+          }
+          if (-not $m) { Write-Error "latest.json anonym nicht erreichbar"; exit 1 }
+          if ($m.version -ne $version) { Write-Error "latest.json version=$($m.version), erwartet $version"; exit 1 }
+          $assetUrl = $m.platforms.'windows-x86_64'.url
+          # Schema-Check: nie wieder api.github.com/raw-URLs (anonym 404).
+          if ($assetUrl -notmatch '^https://github\.com/Cuarroc/ProjectA-updates/releases/download/v') {
+            Write-Error "Asset-URL ist kein oeffentlicher GitHub-Download: $assetUrl"; exit 1
+          }
+          # App-identisch heisst: echter GET-Download (der Updater laedt das
+          # Bundle herunter), KEIN HEAD — Release-Downloads leiten auf S3-
+          # Presigned-URLs um, die sich bei HEAD anders verhalten koennen.
+          $tmpExe = Join-Path $env:RUNNER_TEMP "pa-verify-$version.exe"
+          Invoke-WebRequest -Uri $assetUrl -OutFile $tmpExe -UseBasicParsing
+          if ((Get-Item $tmpExe).Length -lt 1MB) { Write-Error "Asset-Download leer/zu klein"; exit 1 }
+          Remove-Item $tmpExe -Force
+          # Auch die Signatur-Datei gehoert zur oeffentlichen Ablage.
+          $sigUrl = "https://github.com/Cuarroc/ProjectA-updates/releases/download/v$version/ProjectA_${version}_x64-setup.exe.sig"
+          $sigContent = Invoke-RestMethod -Uri $sigUrl -UseBasicParsing
+          if (-not $sigContent -or "$sigContent".Length -lt 100) { Write-Error "Signatur-Datei anonym nicht erreichbar/zu kurz"; exit 1 }
+          Write-Host "OK: Manifest + Asset (GET) + Signatur anonym erreichbar, version=$version"
diff --git a/AGENTS.md b/AGENTS.md
index 712b80b..a91c6c4 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -80,6 +80,14 @@ totem Dienst. Frag nach etwas, dessen Antwort **nicht in der Frage steht**, und
 lass die Prüfung einmal absichtlich scheitern, bevor du ihr traust.
 → Werkzeug: `preflight --selftest`.
 
+**2a. Verifikation mit Credentials, die das Produkt nicht hat, ist keine
+Verifikation.**
+Die v1.2.0-Endpoint-Prüfung lief mit `gh auth token` — „grün", während die
+Updater-App anonym 404 bekam („Could not fetch a valid release JSON"). Prüfe
+Remote-Endpunkte immer **ohne** Credentials und mit exakt den Headern/dem
+Verhalten des Produkts. Deshalb steht im Release-Workflow ein anonymes
+Verify-Gate (app-identische Requests).
+
 **3. „Fertig" wird aus Belegen bestimmt, nicht aus einem Formular.**
 Ein Statuswerkzeug meldete fünf erfolgreiche Worker als tot, weil es Erfolg nur
 an einer Berichtsdatei erkannte — die Commits auf ihren Branches lagen die ganze
@@ -283,6 +291,11 @@ Werkzeugaufrufen, obwohl es einfache Fragen beantwortet.
 - **Ein Daemon, den eine geplante Aufgabe gestartet hat, überlebt
   `Stop-ScheduledTask`.** Er koppelt sich ab und läuft mit alter PID weiter. Den
   Prozess direkt beenden — und danach nachmessen, nicht annehmen.
+- **Updater-Kanal läuft über das öffentliche Mirror-Repo `Cuarroc/ProjectA-updates`**
+  (nur `latest.json` + Installer; der Code bleibt privat). Die Release-CI spiegelt
+  dorthin und braucht das Secret `UPDATES_MIRROR_TOKEN` (fine-grained PAT, nur
+  dieses Repo, contents: rw). `updates/latest.json` im Hauptrepo ist entfallen —
+  wer es wieder anlegt, pflegt eine Leiche.
 - Weitere Workarounds: `HANDOVER.md` → „Wichtige Betriebs-Workarounds".
 
 ---
diff --git a/STAND.md b/STAND.md
index 8aaf4b4..79e4615 100644
--- a/STAND.md
+++ b/STAND.md
@@ -8,9 +8,10 @@ Nutzer entschieden und vielfach extern reviewed (Rev 2 + Rev 4 je zweifach;
 Rev-4-Urteil „Needs Work" ist in Rev 5 eingearbeitet: Migrations-Vertrag,
 PTY-sicheres Update, serielle Release-Lane, ehrliche Parallelität 2–2,5 Stränge).
 Er konsolidiert: Sanierung, UI/UX, Designschuld, OmniRoute-Integration (Strang O),
-Continuous Delivery und das Parallelisierungsmodell. Wer hier anfängt, arbeitet an
-Phase A (Sicherheitsnetz: Backup-Probe, Migrations-Vertrag, TRIAGE-Re-Verifikation,
-CI, ESLint, Prozess-Setup).
+Continuous Delivery und das Parallelisierungsmodell. **Phase A, 0 und 1 sind
+abgeschlossen (31.08.).** Wer hier anfängt: erst den Updater-Fix
+(`fix/updater-mirror`, §2 oben) zu Ende bringen — danach Phase 2
+(Betriebsblindheit), aber nur auf ausdrückliches Nutzer-Kommando.
 
 ---
 
@@ -33,10 +34,17 @@ Antwortet der Router nicht: `powershell -Command "Start-ScheduledTask -TaskName
 
 ## 2. Wo `main` steht
 
-`main` = `3379ab4`, **identisch auf GitHub und Server** (31.08., verifiziert 0/0).
-
-- **v1.0.1 ist gebaut und installiert** (30.08.; Tag/Release auf GitHub offen für
-  den Nutzer — Installer lokal unter `src-tauri/target/release/bundle/nsis/`).
+`main` = `c9618be` (Release v1.2.0 + Phase-1-Abschluss, 31.08.), GitHub + Server
+synchron.
+
+- **Updater-Produktionsbefund (31.08. abends):** „Could not fetch a valid
+  release JSON" — Endpoint zeigte aufs private Repo (anonym 404; Phase-0-
+  Verifikation lief fälschlich mit Token, AGENTS.md Regel 2a). Fix auf
+  `fix/updater-mirror`: öffentliches Mirror-Repo `Cuarroc/ProjectA-updates`
+  (bereits anonym verifiziert), CI-Verify-Gate. **Nach Merge: v1.2.1 releasen
+  und EINMAL manuell installieren** (Endpoint einkompiliert — v1.1.1 UND v1.2.0
+  können sich nicht selbst retten); danach gehen Auto-Updates. CI braucht Secret
+  `UPDATES_MIRROR_TOKEN` (fine-grained PAT, Mirror-Repo, contents rw).
 - **OmniRoute-Integration:** W0 ✅ (`d0c6975`), W4-Eval ✅ (`3379ab4`, Ergebnis:
   nur `lite` spart bei Coding-Payloads → W4 wird kleine gezielte Aktivierung).
 - **w1a und w2 sind abgestürzt, ungeliefert:** Branches zeigen auf `1234b5b` ohne
diff --git a/STATUS.md b/STATUS.md
index 39b53cb..8423164 100644
--- a/STATUS.md
+++ b/STATUS.md
@@ -2,6 +2,25 @@
 
 Laufende Doku des autonomen Aufbaus. Neueste Einträge oben. Details: Git-History + Plan unter `.kimi` Session-Plan.
 
+## 2026-08-31 (Abend) — Updater-Kanal repariert: öffentliches Mirror-Repo statt „signierter URLs"
+
+Produktionsbefund: Updater meldete „Could not fetch a valid release JSON from
+the remote". Ursache zweifach: (1) die §8.19-Annahme „signierte URLs" existiert
+für GitHub-Release-Assets nicht; (2) die Phase-0-Endpoint-Verifikation lief mit
+`gh auth token` — die App sendet keinen, anonym **404** (neue AGENTS.md-Regel 2a:
+Verifikation nur anonym/app-identisch). Fix: öffentliches Mirror-Repo
+`Cuarroc/ProjectA-updates` (nur `latest.json` als Release-Asset + Installer; der
+Code bleibt privat), Endpoint in `tauri.conf.json` auf
+`releases/latest/download/latest.json`, Release-CI spiegelt exe+sig+Manifest ins
+Mirror und verifiziert anschließend **anonym** (Verify-Gate mit Retry-Loop).
+Regressionstest `src/updater-config.test.ts` (rot→grün belegt). Kanal mit v1.2.0
+anonym verifiziert: Manifest 200, Asset 200, Sig 200. `updates/latest.json` im
+Hauptrepo entfernt (ungepflegte Leiche). Entscheidung §8.23 (revidiert 8.19).
+**v1.1.1 und v1.2.0 (beide mit privatem
+Endpoint einkompiliert) können sich nicht selbst retten: v1.2.1 einmal manuell
+installieren.** CI braucht neues Secret `UPDATES_MIRROR_TOKEN`
+(fine-grained PAT auf das Mirror-Repo, contents rw).
+
 ## 2026-08-31 — Phase 1 abgeschlossen: alle 55 roten Beweise gefixt, Sicherheitsgrenzen halten
 
 Die Triage-Fix-Welle in drei Wellen (Worktree-Isolation, Grün-Regel: Test+Fix
diff --git a/docs/SANIERUNGSPLAN.md b/docs/SANIERUNGSPLAN.md
index e60763e..e5d79e1 100644
--- a/docs/SANIERUNGSPLAN.md
+++ b/docs/SANIERUNGSPLAN.md
@@ -6,6 +6,9 @@ Nutzer-Entscheidungen. Rev 4: Continuous Delivery, Strang O, Parallelisierung.
 solide, Operations-Schicht brüchig") vollständig eingearbeitet — Protokolle
 `.pa/review_rev4_{codex,opencode}.md`, Annahme/Ablehnung in §7. Kern der Rev 5:
 **Migrations-/Rollback-Vertrag, serielle Release-Lane, ehrliche Parallelität.**
+**Rev 5.2 (31.08.):** Dual-Review-Besetzung konkretisiert — Ollama-Cloud ist die
+kontingentfreie zweite Review-Instanz (§0.3); Codex/Claude von Pflicht- zu
+Reserve-Reviewern (§2.3, L4).
 
 **Zielbild:** Eigenes Power-Tool, Windows first/only. Schmerzen: Stabilität, UX.
 Nicht-Ziele: Öffentlicher Vertrieb, Code-Signing, Cross-Platform.
@@ -20,6 +23,18 @@ Nicht-Ziele: Öffentlicher Vertrieb, Code-Signing, Cross-Platform.
 3. **Dual-Review-Regel:** Pläne und große Diffs (>300 Z. oder Nahtstelle) werden von
    zwei anderen KIs reviewt; Annahme/Ablehnung protokolliert. Reviews sind ein
    eigener Kostenposten (§6), kein Nebenbei.
+   **Standard-Besetzung (Rev 5.2, am 31.08. bewiesen):**
+   - **Review 1:** OpenCode über OmniRoute (`:reliable`) — agentisch, liest selbst im Repo.
+   - **Review 2:** Ollama-Cloud über die lokale HTTP-API (`localhost:11434/api/generate`,
+     `stream:false` — **nicht** `ollama run`: Steuerzeichen/Thinking-Output).
+     `kimi-k2.7-code:cloud` (1,04T, 262k Kontext) für Code-Diffs, `glm-5.2:cloud`
+     (1M Kontext) für Pläne/große Ausschnitte, `deepseek-v4-flash:cloud` für schnelle
+     Zweitmeinungen. Kontingentfrei (Pro-Key) — daher **vor** Codex/Claude.
+   - Beweis: Probe-Review mit zwei eingebauten Rust-Bugs — beide mit Zeile und
+     korrektem Fix gefunden. Grenzen: nicht agentisch (reviewt nur mitgeliefertes
+     Material; Diff + Dateien gehören in den Prompt). Lokale Modelle (`qwen3.8`,
+     `qwen2.5-coder`) nur Offline-Fallback (RAM).
+   - Codex/Claude: dritte Meinung/Bildbefunde, wenn Kontingent da — keine Pflicht mehr.
 4. **Release-Regel (Rev-5-Schärfung):** Releases sind **nutzerseitig kohärente
    Schnitte** — in der Regel 1–3 Arbeitspakete, nie ein interner Halbzustand. Jedes
    Release: Patch-Tag `v1.x.y` über die Release-Lane (§2.1), Auslieferung per
@@ -89,12 +104,20 @@ dieser Datei und `.pa/review_*.md`). Neue, rev-5-relevante Belege:
 4. **Schlüsselbetrieb:** privater Signierschlüssel als GitHub-Secret **plus**
    verschlüsseltes Offline-Backup + Wiederherstellungsprobe (Schlüsselverlust =
    Update-Kanal tot); Rotationsnotiz.
-5. **Updater-Endpoint (ENTSCIEDEN 31.08., §8.19): Signierte URLs.** Das Repo
-   bleibt privat; der Updater holt Manifest + Assets authentifiziert aus GitHub
-   Releases (Tauri-Updater mit Auth-Header / signierten Asset-URLs — konkrete
-   Verdrahtung in Phase 0, Endpoint-Verifikation dort mit erstem echten Download).
-6. **Bootstrap-Schritt:** v1.1.0 (erster Build mit Updater) wird **einmal manuell**
-   installiert; End-to-End-Update-Test = v1.1.0 → v1.1.1.
+5. **Updater-Endpoint (§8.19, REVIDIERT 31.08. abends → §8.23): Öffentliches
+   Mirror-Repo.** „Signierte URLs" existieren für GitHub-Release-Assets nicht;
+   die Phase-0-Verifikation lief mit Token (den die App nicht hat) — produktiv
+   404, „Could not fetch a valid release JSON". Kanal ab v1.2.1: öffentliches
+   Mirror-Repo `Cuarroc/ProjectA-updates`, `latest.json` als Release-Asset
+   (`releases/latest/download/latest.json`), CI spiegelt exe+sig+Manifest,
+   anonymes Verify-Gate im Release-Workflow (app-identische Requests ohne
+   Credentials). Einmal manuell auf v1.2.1 installieren (Endpoint ist
+   einkompiliert; v1.1.1 kann sich nicht selbst retten).
+6. **Bootstrap-Schritt:** v1.1.0 (erster Build mit Updater) wurde **einmal manuell**
+   installiert; End-to-End-Update-Test = v1.1.0 → v1.1.1 (erledigt). **Zweiter
+   manueller Schritt (§8.23):** v1.2.1 einmal manuell installieren — v1.1.1 und
+   v1.2.0 haben den privaten Endpoint einkompiliert und können sich nicht selbst
+   retten; E2E-Beweis danach = v1.2.1 → nächstes Release über den Mirror-Kanal.
 7. **PTY-/Worker-Sicherheit beim Update:** Update installiert **nicht**, solange
    Worker/Sessions aktiv sind — stattdessen „Update beim nächsten Start" (pending);
    `on_before_exit` flusht Scrollback/Drafts; Neustart wird nachgemessen (Dispatcher-
@@ -125,7 +148,7 @@ Kostenpolitik: Free-Tier (OmniRoute) zuerst, Codex/Claude-Kontingente als Reserv
 | **L1** | Server-Worker via OmniRoute: dateidisjunkte Fix-/Feature-Pakete | ≤5 Plätze |
 | **L2** | Orca-Steuerung: Task-DAG, `worker_done`-Waits (kein Polling) | — |
 | **L3** | Orca-lokale Flotte: UI-/Doku-Pakete ohne Server-Bedarf | 2–3 |
-| **L4** | Codex/Claude lokal: Dual-Reviews, Bildbefunde (Codex), **keine** Sicherheitsfunde an Codex | Reserve, stehende Review-Kosten |
+| **L4** | Dual-Reviews: Standard = OpenCode/OmniRoute + **Ollama-Cloud** (§0.3, kontingentfrei); Codex/Claude nur Reserve + Bildbefunde (Codex), **keine** Sicherheitsfunde an Codex | Review-Kosten entfallen größtenteils |
 | **L5** | Release-Lane (§2.1.2) | 1 |
 
 **Globales Heavy-Budget (Rev 5):** Der lokale OmniRoute-Daemon (Limit 8) wird von
@@ -388,7 +411,8 @@ alle Annahme/Ablehnungen in §7.
 **Rev 5.1 (31.08., letzte offene Entscheidungen):**
 | # | Entscheidung | Konsequenz |
 |---|---|---|
-| 8.19 | **Updater-Endpoint: Signierte URLs** (Repo bleibt privat) | §2.1.5; Verdrahtung in Phase 0 |
+| 8.19 | **Updater-Endpoint: Signierte URLs** (Repo bleibt privat) — **31.08. abends revidiert → 8.23** | §2.1.5 |
 | 8.20 | **Release-Takt: kohärente Schnitte** bestätigt (Rev-5-Schärfung gilt) | §0.4 unverändert |
 | 8.21 | **Retention-Fristen: Events 90 Tage, messages 180 Tage** | Phase 1.5 |
 | 8.22 | **Triage-Modus: Vorschläge abnicken** (pro Befund mit Begründung) | Phase 1.1 |
+| 8.23 | **Updater-Endpoint revidiert: öffentliches Mirror-Repo** `Cuarroc/ProjectA-updates` — „signierte URLs" existieren für Release-Assets nicht; Phase-0-Verifikation lief fälschlich mit Token. Binaries öffentlich, Code privat; CI spiegelt + anonymes Verify-Gate; v1.2.1 einmal manuell installieren (Endpoint einkompiliert) | §2.1.5 |
diff --git a/src-tauri/tauri.conf.json b/src-tauri/tauri.conf.json
index a033196..8f2fc0f 100644
--- a/src-tauri/tauri.conf.json
+++ b/src-tauri/tauri.conf.json
@@ -51,7 +51,7 @@
     "updater": {
       "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEMzNzk5MUJCQ0IyRDM2MDIKUldRQ05pM0x1NUY1dzBQc0M1NlR3bFRPZDkySk01blMrMW4yWS8vYWxSSTJzQVg1RFpJNDNrd1UK",
       "endpoints": [
-        "https://raw.githubusercontent.com/Cuarroc/ProjectA/main/updates/latest.json"
+        "https://github.com/Cuarroc/ProjectA-updates/releases/latest/download/latest.json"
       ],
       "windows": {
         "installMode": "passive"
diff --git a/src/updater-config.test.ts b/src/updater-config.test.ts
new file mode 100644
index 0000000..b2408cd
--- /dev/null
+++ b/src/updater-config.test.ts
@@ -0,0 +1,46 @@
+/**
+ * @vitest-environment node
+ */
+import { readFileSync } from "node:fs";
+import { dirname, resolve } from "node:path";
+import { fileURLToPath } from "node:url";
+import { describe, expect, it } from "vitest";
+
+// Regression: 2026-08-31 — der Updater-Endpoint zeigte auf das *private*
+// Hauptrepo (raw.githubusercontent.com/Cuarroc/ProjectA/...). Die App sendet
+// keinen Auth-Header, GitHub antwortet anonym mit 404 und der Updater meldet
+// "Could not fetch a valid release JSON from the remote". Kanonischer Ort ist
+// seitdem das oeffentliche Mirror-Repo Cuarroc/ProjectA-updates, latest.json
+// als Release-Asset unter releases/latest/download/ (Tauri-Standard).
+// Hinweis: node-Environment statt jsdom, damit import.meta.url eine
+// file:-URL ist (unter jsdom scheitert fileURLToPath).
+const here = dirname(fileURLToPath(import.meta.url));
+const confPath = resolve(here, "..", "src-tauri", "tauri.conf.json");
+const conf = JSON.parse(readFileSync(confPath, "utf8")) as {
+  plugins?: { updater?: { endpoints?: string[] } };
+};
+const endpoints = conf.plugins?.updater?.endpoints ?? [];
+
+const MIRROR_ENDPOINT =
+  "https://github.com/Cuarroc/ProjectA-updates/releases/latest/download/latest.json";
+
+describe("updater endpoints (tauri.conf.json)", () => {
+  it("definiert mindestens einen Endpoint", () => {
+    expect(endpoints.length).toBeGreaterThan(0);
+  });
+
+  it("ist exakt der oeffentliche Mirror-Kanal (latest/download-Asset)", () => {
+    for (const endpoint of endpoints) {
+      expect(endpoint).toBe(MIRROR_ENDPOINT);
+    }
+  });
+
+  it("enthaelt keine URL-Form, die fuer die anonyme App scheitert", () => {
+    for (const endpoint of endpoints) {
+      expect(endpoint).not.toContain("api.github.com");
+      expect(endpoint).not.toContain("raw.githubusercontent.com");
+      // "Cuarroc/ProjectA/..." ohne das "-updates"-Suffix ist das private Repo.
+      expect(endpoint).not.toMatch(/Cuarroc\/ProjectA(?!-updates)\//);
+    }
+  });
+});
diff --git a/updates/latest.json b/updates/latest.json
deleted file mode 100644
index 41ffa26..0000000
--- a/updates/latest.json
+++ /dev/null
@@ -1,11 +0,0 @@
-{
-  "version": "1.2.0",
-  "notes": "Details: CHANGELOG.md im Repo.",
-  "pub_date": "2026-08-31T18:33:00Z",
-  "platforms": {
-    "windows-x86_64": {
-      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRQ05pM0x1NUY1d3czZnpnQXBHOTY3WW40MjBhUHYwWk9wUGM2UVVoTHA4MWxYbTcrUjlVUHJhZFRpWEtpekpKeTdta3lGY21SUTc3cTE2b3Z6aGJkWWZVV3dPT0VScEFFPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg4MjAxMTk3CWZpbGU6UHJvamVjdEFfMS4yLjBfeDY0LXNldHVwLmV4ZQo3VElqZnVxMjJTREhVdS93NjJOcU5SRFpVNlJQR29Rd0M1N05hbVd4TmwwTVRicDN1dUVSRnFmem9SNkp2VGVTS2NBUFZ3VER2akcvbE85SG1FUzRCUT09Cg==",
-      "url": "https://api.github.com/repos/Cuarroc/ProjectA/releases/assets/538375582"
-    }
-  }
-}
