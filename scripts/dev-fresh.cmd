@echo off
rem dev-fresh.cmd — Vite-Dev-Server mit frischem Dep-Optimizer-Cache starten.
rem
rem Existiert, weil ein veralteter Cache jeden Modul-Request mit
rem "504 Outdated Optimize Dep" beantwortet und die Seite dann gar nicht
rem rendert - das hat eine Sichtpruefung komplett verhindert, und der
rem Fehler sieht nach allem Moeglichen aus, nur nicht nach einem Cache.
cd /d "%~dp0.."
if exist node_modules\.vite (
  echo Entferne node_modules\.vite ...
  rmdir /s /q node_modules\.vite
)
npm run dev
