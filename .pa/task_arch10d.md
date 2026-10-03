# ARCH-10d — Task- und Control-Routen nach hq_routes

Status: entwurf

Paketgröße: M, höchstens 300 Diff-Zeilen
Dateien: `src-tauri/src/api.rs`, `src-tauri/src/api/hq_routes.rs`, dieser Auftrag

Verschiebt unverändert die fünf Arme `GET|POST /api/hq/v1/tasks/:id/assignment`,
`POST /api/hq/v1/tasks/:id/claim`, `POST /api/hq/v1/tasks/:id/checkpoint` und
`POST /api/hq/v1/control` aus `api.rs` in `hq_routes::handle()`. Der Besitztest
in `hq_routes::route` nennt genau diese Methoden und Pfadsegmente, kein Präfix-
oder Methoden-Platzhalter. Damit ist ARCH-10 abgeschlossen.

Keine neue Funktion, kein Bugfix, keine Änderung an Backend, Store, Schema,
Auth oder Konfiguration. Bestehende API-Tests in `api.rs` decken Verhalten und
Reihenfolge ab (No-Test, rein mechanisch).
