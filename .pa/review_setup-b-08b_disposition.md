# Disposition: Reviews SETUP-08b (Plan-/Spec-Helfer unter scripts/dev)

- Artefakt: Commits e7b63e8, 273453f (SETUP-08b), PR #153 (Draft)
- Reviews: `.pa/review_setup-b-08b_glm-5.2.md` (G1–G6), `.pa/review_setup-b-08b_kimi-k3.md` (K1–K11); beide unverändert aus `pa-orch/reviews/review_pr153_*.md`. Beide Urteile: keine Blocking-Befunde, mergebar: ja.
- Bearbeitet: 2026-09-25 auf Branch `claude/setup-b2-plan-helpers`
- Vorgehen: jeder Befund gegen den Code geprüft; Angenommenes test-first
  (Commit aab4b33: 15 von 56 Tests in den vier Testdateien rot, Exit 1),
  Fix in bab7e4c (56/56 grün). `npm run test:hq` 358/358, Exit 0.
- Ergebnis: **17 Befunde, 14 angenommen (einer davon in anderer Form), 3 abgelehnt** (K7 ist dasselbe wie G3)

| Befund | Schwere | Inhalt | am Code geprüft | Disposition |
|---|---|---|---|---|
| G1 | mittel | hygiene: Fehler bei `git fetch --prune` wird nur gewarnt, der Bericht läuft auf veralteten Remote-Refs weiter | Bestätigt: `io.err`-Hinweis, danach normaler Lauf | Angenommen: Exit 3 (`RefusedError`) mit Hinweis auf `--no-fetch`; Test prüft Exit 3, leere Ausgabe und dass `--no-fetch` weiter geht |
| G2 | mittel | pr-status: Required-Check-Namen fest verdrahtet, Drift gegen `gates.sh` | Teilweise bestätigt: die Namen stehen nicht in `gates.sh`, sondern in `.mergify.yml` (`check-success`) und als Job-Namen in `ci.yml`; die Duplikation und das Driftrisiko sind real | Angenommen: Liste bleibt (Anzeige), aber ein Test vergleicht sie mit `.mergify.yml` und `ci.yml`. Der Test war sofort grün (Drift-Wächter, kein Fehler); Wirksamkeit belegt: Namen im Quelltext testweise geändert → Test rot, zurückgesetzt |
| G3 / K7 | niedrig | hygiene: Oktal-Escapes bei Nicht-ASCII-Namen ungetrackter Dateien | Bestätigt (`core.quotePath` Standard) | Angenommen: `git -c core.quotePath=false status …`; Test mit `Möbel.md` |
| G4 | niedrig | erledigt-row/spec-close normalisieren gemischte Zeilenenden auf das vorherrschende | Bestätigt als Verhalten; im Repo praktisch nicht erreichbar: `STAND.md`, `ERLEDIGT.md`, `MASTERPLAN.md` sind einheitlich (0 gemischte Zeilen, per Zählung geprüft) | Abgelehnt: die Normalisierung geht in die sichere Richtung und ist im `git diff` sichtbar, nicht still; Zeilen-für-Zeilen-Patching würde alle drei Funktionen umbauen für einen Fall, der nicht vorkommt |
| G5 | niedrig | erledigt-row: `--title ""` fällt still auf den PR-Titel zurück | Bestätigt (`title \|\| …`) | Angenommen in anderer Form: leerer Titel würde eine leere Titelzelle erzeugen, also ist er ein Aufruffehler (Exit 2, Meldung nennt den Ausweg); Test |
| G6 / K11 | niedrig | fehlende Fehlerfall-Tests (Tabelle nicht gefunden, Datei fehlt, gh-Fehler, „nichts zu tun“, STAND fehlt, Multi-ID, Escaping) | Bestätigt | Angenommen: Tests für Tabelle fehlt/Datei fehlt (Exit 3, Datei unverändert), gh-Fehler in erledigt-row und hygiene (Exit 3), spec-close „nichts zu tun“ und STAND fehlt, Multi-ID/Altformat. Windows-Pfade laufen weiter über die Windows-Gate-CI |
| K1 | mittel | erledigt-row: Idempotenz bricht bei Mehrfach-ID-Zeile und anderem Linkformat, Doppelzeile | Bestätigt: exakte URL plus exakte ID-Zelle | Angenommen: PR über `#<nr>`/`pull/<nr>` erkannt (`#15` ≠ `#150`), ID-Zelle an Komma gesplittet, Groß-/Kleinschreibung und `-`/`—` normalisiert; 3 Tests |
| K2 | mittel | hygiene: fehlende oder umformatierte Eingaben werden still „leer“, `--strict` kann leer bestehen | Bestätigt: `readOr` → `""`, Header-Erkennung starr | Angenommen: fehlende Datei = `null`, fehlender Abschnitt/Tabellenkopf wird erkannt; Abschnitt „Nicht geprüft“ im Bericht, zählt für `--strict` als Befund. Bewusst kein Exit 3, damit die übrigen Prüfungen weiter Auskunft geben. Test gegen die echten Dateien (leer) und gegen fehlende/umgebaute (gefüllt) |
| K3 | niedrig | stille cwd-Fallbacks bei `git rev-parse`-Fehler (erledigt-row, spec-close, hygiene) | Bestätigt | Angenommen: alle drei brechen mit Exit 3 und der git-Meldung ab. erledigt-row löst den Pfad dafür erst mit `--apply` auf; der Probelauf zeigt ohne `--file` nur `docs/ERLEDIGT.md`. Tests für spec-close und hygiene |
| K4 | niedrig | Schreibzugriffe nicht atomar, parallele Läufe verlieren Updates | Bestätigt als Eigenschaft | Abgelehnt (Doku statt Code): beide Dateien sind versioniert, jede Änderung steht im `git diff` und ist mit `git checkout` rücknehmbar; ein Absturz zwischen den zwei `spec-close`-Schreibvorgängen ist per Wiederholung heilbar (idempotent). Ein Lock würde das Lost-Update-Rennen nicht vollständig schließen, und der Koordinator führt die Helfer nacheinander aus. README nennt die Grenze jetzt |
| K5 | niedrig | `MACHINE_BRANCH` prefix-matcht zu breit (`maintenance/…`) | Bestätigt | Angenommen: `/^(?:main\|HEAD\|origin)$\|^(?:mergify\|gh-readonly-queue)\//`; Test (Branch und PR) |
| K6 | niedrig | `gh pr list`-Limits schneiden still ab | Bestätigt | Angenommen: hygiene meldet Listen am Limit (200/1000) unter „Nicht geprüft“, pr-status warnt auf stderr; Tests |
| K8 | niedrig | Markdown-Escaping unvollständig (Newlines, Backticks) | Bestätigt, aber nicht erreichbar: GitHub-PR-Titel und Label-Namen sind einzeilig, git-Refs enthalten keine Steuerzeichen, `\|` in Tabellenzellen wird schon maskiert, hygiene rendert Aufzählungen statt Tabellen | Abgelehnt: kein erreichbarer Fehlerfall, rein kosmetisch |
| K9 | niedrig | `gh pr view --json files` liefert höchstens 100 Dateien, Report-Spalte kann fehlen | Bestätigt | Angenommen: Warnung auf stderr bei 100 Dateien ohne `--report`; Test |
| K10 | niedrig | spec-close verwirft den Rest der Status-Zeile | Bestätigt; die 135 echten Specs haben durchweg `Status: aktiv\|historisch\|entwurf` | Angenommen: nur `Status: <ein Wort>` wird akzeptiert, Zusätze führen zu Exit 3 statt zu stillem Verlust; Test |

## Hinweise

- Kein Befund war blocking; die Reviewer empfahlen G1/G2 und K1/K2 als
  zeitnahe Nachzügler — alle vier sind umgesetzt.
- Bewusst nicht geändert: Zeilenende-Normalisierung (G4), Locking der
  Schreiber (K4), Markdown-Escaping (K8). Begründungen in der Tabelle.
- Der Probelauf von erledigt-row zeigt ohne `--file` nicht mehr den
  aufgelösten absoluten Pfad, sondern `docs/ERLEDIGT.md` (Folge von K3).

## Nachweis

- Rot (aab4b33, Stand 273453f): `node --test` über die vier Testdateien:
  56 Tests, 41 grün, **15 rot**, Exit 1.
- Grün (bab7e4c): dieselben vier Dateien 56/56, Exit 0.
- `node --check` auf allen `scripts/dev/*.mjs`: Exit 0.
- Echtlauf `node scripts/dev/hygiene.mjs --no-fetch` gegen dieses Repo: Exit 0,
  „Nicht geprüft (0)“.
