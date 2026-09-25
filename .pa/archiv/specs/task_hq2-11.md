# HQ2-11 — Studio mit Runtime
Status: historisch

Abgeschlossen: gemergt mit PR #70 (Zeile in `docs/ERLEDIGT.md`); diese Spec ist nur noch Beleg.

Nutzerauftrag 23.09.2026, Draft #70. Code-Chat mit Harness, Plan/Interview,
Skills/Plugins; native Teams, Queue, Lessons, Statistiken und Analyse;
Routingreihenfolge und evidenzbasierter Advisor. Echte bestehende API verwenden.

Ownership: docs/dev-hq/concepts/studio-*, hq2-studio.html, scripts/lib/hq-studio.mjs,
scripts/hq-live.mjs (HQ-Routen), zugehörige Tests und Dokumentation.
Keine Rust-Nahtstelle, keine Aktivierung kontinuierlicher Ausführung.

Abnahme: isolierte HTTP-/DOM-Tests mit Fehler-/Projektwechseltests,
Desktop/Mobil-Screenshots, zwei unabhängige Reviews; echte Runtime getrennt
von Test-Doubles ausweisen. Benchmarkwerte benötigen Quelle und Messzeit.

Design-Nachtrag 23.09.2026: Nutzer beauftragt design-director mit kritischem Review und Umsetzung. Scope auf PC/Desktop begrenzt; bestehende Identität erhalten. Priorität: Composer-Sichtbarkeit, Aktionshierarchie, Navigation, Empty States, Hell/Dunkel. Kein neuer Mobile-Ausbau.
