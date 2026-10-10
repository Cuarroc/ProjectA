@echo off
rem release.cmd — retired (REL-3, 10.10.2026). Kept so old muscle memory still
rem lands on current guidance instead of a silent missing file.
rem
rem Do not bump or tag from this script. Releases go through a bump PR.

echo.
echo FEHLER: scripts\release.cmd ist abgeschaltet (REL-3).
echo.
echo Releases laufen ueber einen Bump-PR ^(Vorlage: PR #922^), nicht direkt auf main.
echo Version anheben in:
echo   package.json
echo   package-lock.json
echo   src-tauri\Cargo.toml
echo   src-tauri\Cargo.lock
echo   src-tauri\tauri.conf.json
echo   scripts\lib\license-check.test.mjs
echo   README.md
echo   CHANGELOG.md
echo.
echo Den Tag setzt Root erst nach dem Mergify-Merge — dieses Skript taggt nicht.
echo.
exit /b 1
