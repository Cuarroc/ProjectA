@echo off
rem release.cmd <version> — einzige Stelle, die Versions-Bump + Tag macht (L5,
rem Sanierungsplan 2.1.1: nur die Integrations-Lane taggt). Atomar: tauri.conf.json,
rem Cargo.toml, package.json + CHANGELOG-Zeile + git tag, dann Assertion
rem "Tag == App-Version". CI (release.yml) baut Installer + Updater-Artefakte.
rem
rem   scripts\release.cmd 1.1.0 "Kurzbeschreibung des Releases"
rem
rem Voraussetzung: sauberer Arbeitsbaum auf main, Gates vorher lokal gelaufen
rem (der pre-push Hook laeuft ohnehin nochmal).

setlocal enabledelayedexpansion
set "V=%~1"
set "NOTES=%~2"
if "%V%"=="" (echo usage: release.cmd ^<version^> ["notes"] & exit /b 2)
powershell -NoProfile -Command "if ('%V%' -notmatch '^\d+\.\d+\.\d+$') { exit 1 }" || (echo Version muss x.y.z sein & exit /b 2)

git diff --quiet && git diff --cached --quiet || (echo Arbeitsbaum nicht sauber & exit /b 2)
for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set "BR=%%b"
if not "%BR%"=="main" (echo Nur auf main taggen & exit /b 2)

rem --- tauri.conf.json ---
powershell -NoProfile -Command "(Get-Content src-tauri/tauri.conf.json -Raw) -replace '\"version\": \"[0-9]+\.[0-9]+\.[0-9]+\"', '\"version\": \"%V%\"' | Set-Content src-tauri/tauri.conf.json -NoNewline"
rem --- Cargo.toml ---
powershell -NoProfile -Command "(Get-Content src-tauri/Cargo.toml -Raw) -replace '(?m)^version = \"[0-9]+\.[0-9]+\.[0-9]+\"', 'version = \"%V%\"' | Set-Content src-tauri/Cargo.toml -NoNewline"
rem --- package.json ---
powershell -NoProfile -Command "(Get-Content package.json -Raw) -replace '\"version\": \"[0-9]+\.[0-9]+\.[0-9]+\"', '\"version\": \"%V%\"' | Set-Content package.json -NoNewline"

rem --- CHANGELOG-Zeile ---
if not "%NOTES%"=="" (
  powershell -NoProfile -Command "$c = Get-Content CHANGELOG.md -Raw; $d = Get-Date -Format yyyy-MM-dd; $c = $c -replace '(?m)^# Changelog', (\"# Changelog`r`n`r`n## v%V% - $d`r`n`r`n- %NOTES%\"); Set-Content CHANGELOG.md $c -NoNewline"
)

git add src-tauri/tauri.conf.json src-tauri/Cargo.toml package.json CHANGELOG.md
git commit -m "chore(release): v%V%" || exit /b 1

rem --- Lockfile nachziehen (Version steht auch dort) ---
cd src-tauri && cargo check --quiet && cd ..

rem --- Assertion: Tag == App-Version ---
powershell -NoProfile -Command "$j = Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json; if ($j.version -ne '%V%') { exit 1 }" || (echo ASSERTION fehlgeschlagen: tauri.conf.json != %V% & exit /b 1)

git tag -a "v%V%" -m "v%V%"
echo.
echo OK: v%V% committed + getaggt. Auslieferung:
echo   git push origin main --follow-tags
echo Danach baut die Release-CI Installer + latest.json; der Updater findet
echo das Release unter der Endpoint-URL aus tauri.conf.json.
