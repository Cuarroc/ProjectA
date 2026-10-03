# ARCH-10c — Ziel-Routen nach hq_routes

Status: entwurf

Paketgröße: M, höchstens 300 Diff-Zeilen
Dateien: `src-tauri/src/api.rs`, `src-tauri/src/api/hq_routes.rs`, dieser Auftrag

Verschiebt unverändert die drei Arme `GET /api/hq/v1/goals`,
`POST /api/hq/v1/goals` und `POST /api/hq/v1/goals/:goalId/tasks` aus
`api.rs` in `hq_routes::handle()`. Besitztest in `hq_routes::route` nennt
genau diese Methoden und Pfadsegmente, kein Präfix- oder Methoden-Platzhalter.

Keine neue Funktion, kein Bugfix, keine Änderung an Backend, Store, Schema,
Auth oder Konfiguration. Bestehende Ziel-API-Tests in `api.rs` decken
Verhalten und Reihenfolge ab (No-Test, rein mechanisch).
