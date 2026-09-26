# P2-A: Updater-Tab an den Mirror-Kanal anpassen (NT-6, hoch)

Status: historisch

Du arbeitest im Projekt ProjectA (Tauri-2-App). Dein aktuelles Arbeitsverzeichnis
ist der Worktree-Root des Repos — ermittle ihn zu Beginn mit `pwd` und referenziere
alle Dateien als absolute Pfade darunter.

## Befund

Der Update-Check in der App ist funktional tot: der „Check for updates"-Button
wird ohne gespeichertes GitHub-Token gar nicht gerendert, und der Check bricht
ohne Token ab. Das ist veraltet: der Update-Feed ist seit v1.2.1 das
**oeffentliche** Mirror-Repo `Cuarroc/ProjectA-updates` — anonym erreichbar,
mehrfach verifiziert (zuletzt: HTTP 200 auf latest.json ohne Credentials).

## Aufgabe (nur diese zwei Dateien)

1. `src/components/SettingsView.tsx` (im Worktree, absolut referenzieren):
   - Token-Feld, `loadUpdaterToken`/`saveUpdaterToken`, localStorage-Key
     `projecta.settings.updater.github_token` und der Token-State komplett
     entfernen (Nutzer-Entscheidung: der Mirror-Feed braucht nie ein Token).
   - `handleCheckUpdates`: `check()` **ohne** Authorization-Header aufrufen
     (keine `headers`-Option). Der Kommentar ueber das private Repo fliegt raus.
   - „Check for updates"-Button **immer** rendern (nicht nur bei gesetztem Token).
   - Hinweistexte im Updates-Tab (ca. Zeilen 846-881) ersetzen durch ehrliche,
     **englische** Copy (der Tab ist bereits englisch): der Feed ist oeffentlich,
     der Check laeuft anonym. Kein deutschen Text neu schreiben.
2. `src/components/SettingsView.updates.test.tsx` (neu, jsdom/vitest):
   - **Roter Test zuerst** (muss gegen den Ist-Stand fehlschlagen, Fehlerausgabe
     in den Report kopieren): ohne Token wird der „Check for updates"-Button
     gerendert.
   - Beim Klick wird `check` (gemocktes `@tauri-apps/plugin-updater`)
     **ohne** Authorization in den Optionen aufgerufen.
   - Die Token-Eingabe existiert nicht mehr.
   - Orientiere dich am Stil der vorhandenen Tests (z. B. `src/updater-config.test.ts`,
     `src/App.test.tsx`); jsdom-Setup liegt in `src/test/setup.ts`.

## Verboten

- Keine anderen Dateien anfassen (kein `src/lib/ipc.ts`, keine Rust-Dateien,
  keine Config). `git diff --name-only` darf genau diese zwei Dateien zeigen.
- Keine neuen npm-Dependencies.
- Keine Umbenennung/Reformatierung ausserhalb der Aufgabe.

## Gates (muessen laufen, Ausgabe in den Report)

- `npm test` (gruen), `npm run typecheck` (gruen), `npm run lint` (Budget:
  max. 1 Warning, die bekannte in DiffView.tsx), `npm run build` (gruen).
- Screenshot des geaenderten Updates-Tabs aus dem Dev-Build ist NICHT deine
  Aufgabe (macht der Integrator) — aber beschreibe im Report, was sich visuell
  aendert.

## Report

Schreibe am Ende `<repo-root>\.pa\report_p2a.md`:
Befund, roter-Test-Beleg (echte Fehlerausgabe), Aenderungen, Gates-Ausgaben,
`git diff --name-only`-Liste. Dann committen (dein Branch ist vorgegeben) und
mit „worker_done" enden.
