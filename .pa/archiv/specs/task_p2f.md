# P2-F: CSP + Plugin-/Capability-Matrix + Markdown-Links ueber den Opener (Phase 2)

Status: historisch

Du arbeitest im Projekt ProjectA (Tauri-2-App, Windows primaer). Dein aktuelles
Arbeitsverzeichnis ist der Worktree-Root des Repos — ermittle ihn zu Beginn mit
`pwd` und referenziere alle Dateien als absolute Pfade darunter. Basis: `main`
(Stand 02.09.2026, nach P2-C und P2-J).

## Kontext

- `src-tauri/tauri.conf.json`: `app.security.csp` ist `null`. Plugins:
  updater, process, **opener (seit P2-J registriert)**.
- `src-tauri/capabilities/default.json`: enthaelt seit P2-J
  `opener:allow-open-url` mit Scope `https://*` + `http://*`. **Nicht anfassen.**
- `src/lib/ipc.ts` `openExternal(url)` ruft `invoke("plugin:opener|open_url")`
  und faellt nur noch bei Fehler auf `window.open` zurueck. **`src/lib/ipc.ts`
  ist TABU fuer dich** (Integrations-Lane).
- `src/lib/markdown.ts` (Zeile ~36) rendert `<a href target="_blank">` — Klicks
  darauf laufen derzeit am Plugin vorbei und oeffnen unter WebView2 unzuverlaessig.
- Muster fuer Config-Assert-Tests: `src/updater-config.test.ts` und
  `src/opener-config.test.ts` (node-Environment, liest die Dateien).

## Vor-Schritt (Pflicht, zuerst, Ergebnis in den Report)

Enumeriere alle webview-seitigen Verbindungen: suche in `src/` nach `fetch(`,
`WebSocket`, `EventSource`, `window.open`, `new Image(`, `<img src=` mit
externen URLs, `@import`/`url(` in `src/styles.css`. Erwartung: keine ausser
Tauri-IPC und lokalen Assets. Liste **jeden** Fund mit Datei:Zeile im Report.
Die CSP muss exakt das decken — nicht mehr.

## Aufgabe (nur diese Dateien)

1. `docs/plugin-matrix.md` (neu): Tabelle Plugin × benoetigt × Permission ×
   Begruendung — updater, process, opener (mit dem P2-J-Scope), core:default;
   **nicht hinzugefuegt:** dialog, log, notification, window-state — je mit
   Grund und Verweis auf die Phase, in der sie kommen (SANIERUNGSPLAN Phase 3.6
   Notification, Phase 8 B2/B3 window-state/dialog; log kommt nie: P2-C ist
   handgerollt).
2. `src-tauri/tauri.conf.json`: CSP unter `app.security.csp` restriktiv:
   `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline';
   font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost
   http://localhost:*` — plus **genau** das, was dein Vor-Schritt findet.
   **Gleiche CSP in Dev und Prod** — kein Config-Split. Pruefe vor dem
   Festschreiben im Dev-Build (`npm run tauri dev` ist NICHT deine Aufgabe —
   aber lies `vite.config.ts`, ob der Dev-Server auf einem anderen Port als
   `localhost:*` liegt, und decke ihn).
3. `src/lib/markdown.ts`: Link-Klicks laufen ueber das opener-Plugin statt
   ueber nacktes `target=_blank` — **ohne** `src/lib/ipc.ts` anzufassen:
   definiere in markdown.ts einen Klick-Handler (Delegation auf den gerenderten
   Container oder `data-`-Attribut + Handler-Export), der
   `invoke("plugin:opener|open_url", { url })` aus `@tauri-apps/api/core`
   aufruft, nur fuer `http(s)`-URLs, alles andere wird ignoriert. Der
   Integrator fuehrt das spaeter mit `openExternal` zusammen.
4. Tests:
   - **Rot zuerst** (Fehlerausgabe in den Report): `src/csp-config.test.ts`
     (Muster `src/updater-config.test.ts`), schlaegt fehl, solange
     `app.security.csp` null ist; prueft danach, dass `default-src 'self'` gesetzt
     ist und **kein** `unsafe-eval` und kein `*`-Host vorkommt.
   - vitest fuer markdown.ts: ein Klick auf einen gerenderten Link ruft den
     gemockten `invoke` mit `plugin:opener|open_url` und der URL; ein
     `javascript:`-Link ruft nichts.

## Verboten

- Keine Aenderungen an `src/lib/ipc.ts`, `src-tauri/Cargo.toml`,
  `src-tauri/Cargo.lock`, `src-tauri/src/main.rs`,
  `src-tauri/capabilities/default.json`, `api.rs`, `store.rs`, `bin/pa.rs`,
  `src/components/*`. Diese Dateien gehoeren P2-J bzw. der Integrations-Lane.
- Keine neuen Dependencies (weder npm noch cargo).
- `git diff --name-only` darf nur zeigen: `docs/plugin-matrix.md`,
  `src-tauri/tauri.conf.json`, `src/lib/markdown.ts`, `src/csp-config.test.ts`,
  `src/lib/markdown.test.ts` (oder der bestehende markdown-Test).

## Gates (muessen laufen, Ausgabe in den Report)

`npm test`, `npm run typecheck`, `npm run lint` (Budget: max. 1 Warning, die
bekannte in `DiffView.tsx:53`), `npm run build`. Rust-Gates sind nicht noetig,
du aenderst kein Rust — schreibe das so in den Report.

## Report

Schreibe am Ende `.pa/report_p2f.md` im Root deines Worktrees: Vor-Schritt-
Ergebnis (jeder Fund), gewaehlte CSP mit Begruendung je Direktive, roter-Test-
Beleg (echte Fehlerausgabe), Gates-Ausgaben, `git diff --name-only`-Liste.
Dann committen (dein Branch ist vorgegeben) und mit „worker_done" enden.
