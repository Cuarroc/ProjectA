# Review-Disposition PR #6 (Stufe B)

Kandidat: `docs/readme-refresh` @ `b518cd7` (README-01, nach Stufe A).
Autor: Claude. Reviewer (statt des im Auftrag genannten Kilo/Nemotron; ein früherer Lauf hatte die Review schon mit Grok durchgeführt, andere Modellfamilie als der Autor, kein zweiter Durchgang): xAI Grok (`grok` CLI 1.0.41, ein Durchgang, rein
lesend), Antwort unverändert in `.pa/review_pr6_grok.md`. Grok-Urteil:
**mergebar nein**, ein blocking-Befund.

Jeder Befund wurde gegen den Repo-Stand geprüft.

| # | Befund (Stufe) | Disposition |
|---|---|---|
| 1 | Installer-Satz falsch: Release lädt signierte Setups öffentlich nach Cuarroc/ProjectA-updates (blocking) | **angenommen**: verifiziert in `.github/workflows/release.yml` — Upload des NSIS-Setups ins öffentliche Mirror-Repo (Zeilen ~153–167), Promotion auf den stabilen Tag (~195–229), Build auf `windows-latest` (Zeile 39). „not offered" ist falsch, „built for the maintainer's own machine" ist falsch. Umformuliert: CI baut bei `v*`-Tags signierte Windows-Installer und spiegelt sie öffentlich (Auto-Update-Kanal); Installation für Dritte wird nicht unterstützt, der Weg hier bleibt der Build aus den Quellen. |
| 2 | Team-Rollen gleichzeitig „partial"/„planned"/„geplant"; „partial" undefiniert (medium) | **angenommen**: Tabellenzeile auf „planned — **locked off** (code exists)"-Lesart gebracht: implementiert, aber nur über den gesperrten Continuous Mode erreichbar. „partial" in einem Satz über der Tabelle definiert. Deutscher Absatz trennt jetzt: Rollen implementiert/gesperrt, abgestufte Freigaben fehlen, Dauerbetrieb gesperrt. |
| 3 | Mermaid legt die lokale API außerhalb der App (medium) | **angenommen**: verifiziert — `api.rs:958` bindet `127.0.0.1:0` im selben Prozess. Diagramm korrigiert: API-Knoten in den App-Subgraphen, Pfeile von `pa` und Dev-HQ zur API. |
| 4 | Beleg-Test der `pa`-Brücke zeigt auf falsches Modul (medium) | **angenommen**: verifiziert — `hq_changes_require_auth_project_and_valid_cursor` steht in `src-tauri/src/api.rs:4149`, nicht in `bin/pa.rs`; in `bin/pa.rs` prüft nur `hq_parser_preserves_source_goal_and_refuses_unknown_settings` das Parsen von `hq runtime`/`hq context`, kein Test führt `pa` gegen eine laufende API aus. Zeile ist jetzt „partial“ und nennt beide Tests samt dieser Lücke (Vorschlag des Reviewers, Brücke nicht als „works“ zu führen). |
| 5 | `waitForFunction` ist bei fehlendem Panel sofort wahr (low) | **angenommen**: Wartebedingung wartet jetzt auf den erwarteten Inhalt (`Inspecting queue.rs` und `wk-dispatcher`) und wertet fehlendes/verstecktes Panel als nicht fertig. |
| 6 | Gate-Marker heißt „NICHT ABGEDECKT", nicht „NOT COVERED" (low) | **angenommen**: verifiziert — `scripts/ci/gates.sh:213` druckt `--- NICHT ABGEDECKT von diesem Lauf ---`. README zitiert jetzt wörtlich. |

Keine abgelehnten Befunde. Nach den Fixes: Docs-Commit plus Test-Commit;
kein Delta-Review nötig, da nur Wortlaut/Diagramm und die vom Reviewer
vorgeschlagene Wartebedingung umgesetzt wurden (Umsetzung 1:1 aus dem
Review).
