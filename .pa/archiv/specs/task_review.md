# Task: Review Worker

Status: historisch

Ziel: TypeScript-Checks, visuelles Review, kleine Fixes nach den anderen Workern.

## 1. TypeScript & Build

- Führe `npm run typecheck` aus. Behebe alle Fehler.
- Führe `npm run build` aus. Behebe alle Fehler.

## 2. Rust-Checks

- Führe `cd src-tauri && cargo test` aus.
- Führe `cd src-tauri && cargo clippy --all-targets -- -D warnings` aus.
- Führe `cd src-tauri && cargo build` aus.
- Behebe alle Fehler, die durch die anderen Worker eingeführt wurden.

## 3. Visuelles Review

- Lies die geänderten Dateien (`src-tauri/src/web_interface.rs`, `src/components/Sidebar.tsx`, `src/components/SettingsView.tsx`, `src/App.tsx`, `src/components/ViewBar.tsx`, `src/styles.css`).
- Prüfe:
  - Ist der Code konsistent mit dem Rest der Codebase?
  - Gibt es offensichtliche UX-Probleme (z. B. fehlende Labels, unerreichbare Buttons)?
  - Werden Fehler sauber behandelt?
  - Sind neue Komponenten sauber getrennt?

## 4. Kleinere Fixes

- Füge fehlende `key`-Props in Listen hinzu.
- Korrigiere Tippfehler in Labels.
- Stelle sicher, dass `localStorage`-Zugriffe in try/catch liegen (kopiere das Muster aus `App.tsx`).
- Stelle sicher, dass neue CSS-Klassen nicht mit bestehenden kollidieren.

## Verifikation

- Alle Gates grün: `cargo test`, `cargo clippy --all-targets -- -D warnings`, `cargo build`, `npm run typecheck`, `npm run build`.

## Hinweise

- Dieser Task darf größere Änderungen nur dann machen, wenn sie nötig sind, um Gates grün zu bekommen.
- Kommuniziere klar, welche Fixes du gemacht hast.
