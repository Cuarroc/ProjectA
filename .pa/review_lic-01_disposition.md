# Review-Disposition LIC-01

Kandidat: Branch `claude/lic-01-license-audit`, finaler Kopf `ee38066`.
Reviewer: kimi-k3:cloud + glm-5.2:cloud (Ollama Cloud, `.pa/review_transport.py`).
Runden: R1 (e27fe3e), Delta-R2 (7bc68ef..860be7e), Delta-R3 (860be7e..ee38066).
Urteile: R1 beide "approve with conditions", R2 beide "approve with
conditions" (Parser-Bug), R3 beide "approve".

## Runde 1 (review_lic-01_kimi-k3.md / _glm-5.2.md)

| ID | Quelle | Schwere | Befund | Disposition |
|---|---|---|---|---|
| R1-F1 | kimi-k3 F1 | medium | CDLA-Permissive-2.0 hält das Gate absichtlich rot; Merge erst nach Orchestrator-Entscheidung | angenommen — genau so im PR unter "Needs decision" (kein Code-Eingriff erlaubt) |
| R1-F2 | kimi-k3 F2 | medium | npx holt license-checker ungepinnt | angenommen — gepinnt auf 5.0.1 (860be7e) |
| R1-F3 | kimi-k3 F3 | low | Positivliste in zwei Dateien ohne Drift-Schutz | angenommen — Drift-Test deny.toml ↔ ALLOWED_LICENSES (7bc68ef) |
| R1-F4 | kimi-k3 F4 | low | THIRD_PARTY_NOTICES-Frische nicht CI-erzwungen | Folgearbeit — Regenerationsanleitung steht im Dokument; CI-Diff-Check als Folgepaket |
| R1-F5 | kimi-k3 F5 | low | Vendored Assets (Fonts/Skills) außerhalb der Gate-Abdeckung; OFL-1.1 in den Listen ist toter Code für Crates | angenommen als dokumentierte Scope-Entscheidung — in THIRD_PARTY_NOTICES festgehalten; Manifest/Integrity-Check als Folgepaket |
| R1-F6 | kimi-k3 F6 | low | npm-Seite verlangte alle OR-Alternativen, Rust-Seite eine | angenommen — SPDX-Choice-Semantik (860be7e) |
| R1-F7 | kimi-k3 F7 | low | cargo-deny-Versionsprobe nur Anwesenheit | angenommen — Reinstall bei Versionsabweichung (860be7e) |
| R1-F8 | kimi-k3 F8 | low | `*`-Inferenzmarker still gestrippt | angenommen — wird auf stderr geloggt (860be7e) |
| R1-F9 | kimi-k3 F9 | low | CI-Verdrahtung des Unit-Tests nicht gezeigt | abgelehnt — `npm run test:hq` = `node --test scripts/lib/*.test.mjs` (package.json) erfasst die Datei; hq-test lief grün in der prepush-Bahn inkl. der lic-01-Tests |
| R1-G1 | glm-5.2 F1 | high | OR/AND-Logik falsch für disjunktive Ausdrücke | angenommen — wie R1-F6 (860be7e), Test `OR with one allowed alternative passes while AND requires all` |
| R1-G2 | glm-5.2 F2 | medium | Test und Implementierung angeblich in einem Commit | abgelehnt — falsch gelesen: Test-Commit 5f1fb5d liegt vor der Implementierung e27fe3e; Rot-Lauf (Exit 1, Modul fehlt) protokolliert |
| R1-G3 | glm-5.2 F3 | low | Array-förmige `licenses` werden zu "MIT,Apache-2.0" stringifiziert | angenommen — elementweise Auswertung (860be7e) |

## Runde 2, Delta (review_lic-01-delta_*.md)

| ID | Quelle | Schwere | Befund | Disposition |
|---|---|---|---|---|
| R2-F1 | kimi-k3 F1 + glm-5.2 F1 | medium | Klammer-Flattening: `(MIT OR Apache-2.0) AND GPL-3.0-only` rutscht über MIT durch — neuer Umgehungspfad | angenommen — echter SPDX-Präzedenzparser (55f89db), Test `parentheses preserve SPDX precedence` |
| R2-F2 | kimi-k3 F2 | medium | Versionsprobe könnte unter set-e/pipefail vor der Installation abbrechen | angenommen — Skript läuft ohne `set -e`, Probe zusätzlich mit `\|\| true` abgesichert (d522d66) |
| R2-F3 | kimi-k3 F3 | low | Keine Re-Verifikation nach cargo-install | angenommen — Probe nach Installation, Exit 1 bei Abweichung (d522d66) |
| R2-F4 | kimi-k3 F4 | low | Drift-Test-Regex nicht auf `[licenses]` eingegrenzt | angenommen — Section-Slicing statt globaler Regex (3e2bec0) |
| R2-F5 | kimi-k3 F5 | low | Testlücken: Array-mit-GPL, `*`-Marker, Klammern | angenommen — Tests ergänzt (3e2bec0) |
| R2-F6 | kimi-k3 F6 | info | Inferierte Lizenzen passieren mit Log-Zeile | Policy-Entscheidung — bleibt "loggen, nicht blockieren"; eskaliert als möglicher Follow-up |
| R2-F7 | kimi-k3 F7 | low | Import von ALLOWED_LICENSES im Drift-Test prüfen | abgelehnt — Import vorhanden (Zeile 8 der Testdatei), Suite grün |
| R2-G2 | glm-5.2 F2 | low | Leeres `licenses: []` passiert still | angenommen — leeres Array = UNKNOWN, Violation (55f89db) |
| R2-G3 | glm-5.2 F3 | info | awk-$NF-Annahme zum Versionsformat | angenommen — Kommentar pinnt die Annahme (d522d66) |

## Runde 3, Delta 2 (review_lic-01-delta2_*.md) — Urteil beide: approve

| ID | Quelle | Schwere | Befund | Disposition |
|---|---|---|---|---|
| R3-F1 | kimi-k3 F1 | low | WITH-Exception-ID nicht validiert; Abweichung von cargo-deny nur bei ungültigem SPDX | Folgearbeit — Kommentar-Präzisierung/Exception-Validierung als Folgepaket; kein Pfad akzeptiert eine zwingende nicht-erlaubte Lizenz |
| R3-F2 | kimi-k3 F2 | low | indexOf auf "[licenses]\n" ist CRLF-/Kommentar-empfindlich, aber fail-loud | abgelehnt — Scheitern ist laut und sicher (Test rot); Verschärfung optional |
| R3-F3 | kimi-k3 F3 | nit | Malformed-Input-Vertrag nur per Trace, nicht per Test | angenommen — tabellengetriebener Test ergänzt (ee38066) |
| R3-F4 | kimi-k3 F4 | nit | Roher Ausdruck im stderr-Log könnte Zeilen fälschen | notiert — lokales Werkzeug, geringe Wirkung; keine Änderung |

## Folgearbeit (aus den Reviews, nicht blockierend)

1. CI-Diff-Check, der THIRD_PARTY_NOTICES.md gegen den generierten Stand prüft (R1-F4).
2. Manifest/Integrity-Check für vendored Assets, sobald Fonts/Skills erneuert werden (R1-F5).
3. WITH-Exception-Validierung bzw. Kommentar-Präzisierung im Parser (R3-F1).
4. Entscheidung, ob inferierte Lizenzen (`*`) blockieren statt nur loggen (R2-F6).
