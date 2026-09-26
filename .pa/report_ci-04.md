# Bericht CI-04: Roter main stoppt die Queue

Portiert aus dem internen Vorgänger-Repo (2026-09-25). Die Commit-SHAs weiter
unten gehören zu jenem Vorgänger, nicht zu den Commits dieses Repos. Der
Implementierungs-Commit hier trägt `Test-First: scripts/test-main-red-guard.sh`.
Das Sitzungsjournal `.pa/ACTIVITY.md` existiert in diesem Repo nicht; die drei
Journalzeilen des Vorgängers (interner PR-Verweis, Sitzungszustand) wurden
nicht übernommen. Der Entscheidungseintrag steht am Ende von
`docs/decisions.md`, hinter dem hier bereits vorhandenen W5-28-Eintrag. Der
Trailer `Test-First: scripts/test-ci-shape.sh` aus der Review-Runde des
Vorgängers wurde nicht wiederholt: die Datei ist auf diesem `main` bereits
grün, ein Datei-Trailer wäre kein Rot-Beleg. Die neuen Mutationsfälle liegen
im Implementierungs-Commit und laufen über `scripts/test-ci-shape.sh`.

- Branch des Vorgängers: `claude/ci-04-red-main-stops-queue`, Stand 2026-09-25.
- Quelle: `docs/PLAN.md` Zeile CI-04 (Branch `claude/plan-01-decisions`,
  PLAN-01 noch nicht auf main → alte Berichtsregel, dieser Bericht).
- Entscheidung und Begruendung: `docs/decisions.md` (2026-09-25, CI-04).

## Umsetzung

1. **Job `main-red` in `.github/workflows/ci.yml`**
   (`name: main-red-guard`, `needs: [linux, windows]`,
   `if: always() && event != pull_request && ref == refs/heads/main`,
   ubuntu-latest, 5 min, Rechte nur `contents: read` + `issues: write`).
   Rot → Issue mit Label `ci-red` (Run-ID, Run-URL, SHA, rote Bahnen;
   Kommentar statt Duplikat) plus Queue-Freeze. Gruen → Freeze weg, Issue
   zu. Kein eigener `workflow_run`-Workflow: nur im selben Lauf ist die
   lane-plan-Entscheidung bekannt (s. Punkt 3).
2. **Freeze ueber den Mergify-Mechanismus** (kein neuer Dienst):
   Scheduled-Freeze-API, dieselben Endpunkte wie der offizielle
   mergify-cli (`POST/GET /v1/repos/<repo>/scheduled_freeze`,
   `POST .../<id>/delete`, Bearer `MERGIFY_TOKEN` — das Secret existiert
   seit CI-01). Grund `ci-red: main red, run <ID>`, Scope `base=main`,
   Ausnahme `label=hotfix`, damit der Fix-PR trotz Freeze mergen kann.
3. **Leichtes Gruen zaehlt nicht**: die Jobs `linux`/`windows`
   exportieren jetzt `lane_run` (lane-plan-Output). Nur wenn BEIDE Bahnen
   wirklich liefen, hebt ein gruener Lauf den Freeze auf — ein Push mit
   uebersprungenen Bahnen ist kein Gruen-Beweis, und ein Push, bei dem nur
   eine Bahn voll lief (Cache-Eingaben differieren, z. B.
   `package-lock.json` nur bei linux), auch nicht (Review predecessor PR).
4. **Laut statt still**: ohne `MERGIFY_TOKEN` Issue trotzdem, Freeze mit
   `::warning` uebersprungen (Fallback-Muster wie `MERGIFY_UPLOAD`); ein
   scheiternder API-Aufruf MIT Token ist Exit 1. Cancelled/skipped und
   jeder Ref != main sind No-Op (Skript prueft den Ref zusaetzlich zum
   Job-`if`).
5. **Gepinnt**: Gate `selftest-main-red` in gates.sh; ci-shape.sh Check 5
   (Job vorhanden, needs linux+windows, `always()` + `refs/heads/main` im
   `if`, `lane_run`-Outputs), mit Mutationsfaellen in test-ci-shape.sh.

## Red-first und Belege (Exit-Codes, lokal, Windows/Git-Bash)

- Commit 1 (rot belegt): `bash scripts/test-main-red-guard.sh` →
  **Exit 1** ("main-red-guard.sh fehlt"), Commit fa3b2bf.
- Nach Implementierung (Stand vor dem Review, Zahlen s. unten fuer den Endstand): `bash scripts/test-main-red-guard.sh` →
  **Exit 0** (30/30 ok, acht Faelle inkl. Dedup, leichtes Gruen,
  fehlender Token, API-Fehler laut).
- `bash scripts/ci/ci-shape.sh` → **Exit 0**;
  `bash scripts/test-ci-shape.sh` → **Exit 0** (20/20, vier neue
  Mutationsfaelle schlagen fehl).
- `bash scripts/ci/gates.sh run selftest-main-red ci-shape` → **Exit 0**.
- `bash scripts/ci/gates.sh run no-masked wf-shell wf-pinned
  selftest-gates` → **Exit 0**.
- `actionlint .github/workflows/ci.yml` (1.7.12) → **Exit 0**.
- Pre-commit-Hook (Bahn precommit) lief bei jedem Commit, nie
  `--no-verify`.

## Review-Nachbesserungen (predecessor PR, 2026-09-25)

Zwei Reviewer (claude sonnet, claude opus), Disposition:
`.pa/review_pr182_disposition.md`. Angenommen und umgesetzt (red-first,
`scripts/test-main-red-guard.sh` jetzt 58 Assertions, 15 Faelle;
`scripts/test-ci-shape.sh` 24 Faelle):

- **Entfrieren nur bei BEIDEN gelaufenen Bahnen** (sonnet S-6 / opus O-1,
  hoch): vorher reichte eine — ein Push, der nur `package-lock.json`
  aendert (linux voll, windows leicht), haette einen Windows-Rot-Freeze
  aufgehoben, ohne windows je wieder geprueft zu haben.
- **Erholungsweg ehrlich** (S-1/O-3): der Push nach dem Hotfix-Merge ist
  per CI-02 leicht und entfriert nicht; Issue-Text und eine `::notice`
  bei leichtem/teilweisem Lauf mit offenem Freeze nennen jetzt den
  Handgriff (`gh workflow run ci.yml` auf main).
- **Issue meldet den tatsaechlichen Freeze-Status** (S-3): erst
  Freeze-Versuch, dann Issue/Kommentar — nie mehr "eingefroren"
  behaupten, wenn der Freeze fehlte oder scheiterte. Freeze-Fehler mit
  Token bleibt laut (exit 1), aber das Issue wird vorher noch ehrlich
  geschrieben.
- **Ueberholte Laeufe frieren nicht erneut ein** (S-5/O-5): Job-Concurrency
  `main-red-guard` (kein cancel) plus SHA-Vergleich gegen den main-Kopf
  (`gh api repos/<repo>/commits/main`); ein aelterer roter Lauf
  kommentiert nur.
- **Reihenfolge Gruen-Zweig** (S-7/O-6): erst Freezes loeschen, dann
  Issues schliessen; scheitert ein Delete, bleibt das Issue offen und
  der Job wird rot.
- **Issue-Text korrigiert** (S-8/O-2): Ausnahme ist nur `label=hotfix`,
  der Branch-Name `hotfix/...` reicht nicht — Text sagt das jetzt.
- **Selbsttest-Luecken geschlossen** (S-4/O-9): fremder Freeze bleibt
  stehen, windows-rot, POST-/Delete-Fehler isoliert
  (`MOCK_CURL_FAIL_ON`), gruen ohne Token, nur-eine-Bahn.
- **ci-shape Check 5 geschaerft** (S-9/O-10): exaktes
  `github.ref == 'refs/heads/main'` (Mutation `!=` wird jetzt gefangen),
  `lane_run` verankert, `id: plan` und die Env-Verdrahtung
  `needs.<job>.outputs.lane_run` geprueft, Windows-Mutationsfall,
  Concurrency-Mutationsfall.
- **curl-Robustheit** (S-10/O-8): `--max-time 30`, `--fail-with-body`
  (Fehlergrund sichtbar), `--retry 2` nur bei GET/Delete.
- **Datei-Modi** (S-11): 100755 kommt mit diesem Commit (der Diff zeigte
  100644; Windows `core.fileMode=false` hatte die Korrektur verborgen).

Red-Beleg der Nachbesserung: die neuen Selbsttests gegen die alten
Skripte aus `ef22e1f` → `test-main-red-guard.sh` **Exit 1** (11 Fehler),
`test-ci-shape.sh` **Exit 1** (3 Fehler); mit den Fixes beide **Exit 0**.
`gates.sh run selftest-main-red ci-shape no-masked wf-shell wf-pinned
selftest-gates` → **Exit 0**, `actionlint` → **Exit 0**.

Abgelehnt mit Beleg: S-2/O-4 (Freeze-Payload `"start":null` und die
Endpunkte sind exakt das Wire-Format des offiziellen mergify-cli,
verifiziert gegen `crates/mergify-freeze` create.rs/delete.rs/list.rs;
die Queue-Pause-API ist ein anderes Feature) und O-7 (`always()`
statt `!cancelled()`: cancel ist im Skript bereits No-Op, ein Timeout
gilt als failure und SOLL feuern, Kosten vernachlaessigbar).

## NICHT ABGEDECKT von diesem Lauf

- **Live-Wirkung gegen Mergify**: ob `MERGIFY_TOKEN` (fuer CI Insights
  angelegt) den Scope `scheduled_freeze` hat, ist lokal nicht beweisbar
  (Secret write-only). Erster echter Beleg: ein roter oder gruener
  main-Lauf nach dem Merge — oder ein manueller Probe-Freeze im
  Mergify-Dashboard. Faellt der Freeze-POST mit 403, wird der Job laut
  rot und das Issue traegt die Anleitung zum manuellen Einfrieren.
- **Kein echter roter main-Lauf ausgeloest** (wuerde die Queue real
  einfrieren; nur per workflow_dispatch nach Merge testbar).
- **Linux-Haelfte der Gates** (KI-7): hier ohne Rust-Aenderung; die neuen
  Gates laufen in der Bahn linux im CI-Lauf dieses PRs.
- **Live-Wirkung gegen Mergify** bleibt offen (s. oben): Token-Scope erst
  beim ersten echten Lauf beweisbar.
- **Review-Regel**: die zwei Claude-Reviews des Vorgaengers
  (`.pa/review_pr182_*`) zaehlen hier nicht als unabhaengig (Autor ist ein
  Claude-Modell). Stufe B in diesem Repo: Kilo (`nemotron-3-ultra-550b-a55b:free`),
  Rohantwort `.pa/review_pr28_kilo.md`, Disposition
  `.pa/review_pr28_disposition.md` (K4/K5/K6 angenommen, Rest begruendet
  abgelehnt). Ein Reviewer, weil Ollama/OpenCode wegen des Wochenlimits
  ausfielen.

## Review Stufe B (dieses Repo, Kilo)

- Rot: `f29c6a5`, `bash scripts/test-main-red-guard.sh` -> **Exit 1** (3 FEHLER).
- Fix: Schliess-Kommentar ohne `MERGIFY_TOKEN` behauptet keinen aufgehobenen
  Freeze mehr (K4/K5); `summary()` schreibt ein Argument pro Zeile (K6).
- Gruen: `bash scripts/test-main-red-guard.sh` -> **Exit 0** (63 ok),
  `bash scripts/test-ci-shape.sh` -> **Exit 0**, `bash scripts/ci/ci-shape.sh`
  -> **Exit 0**.

## Folgepunkte

- Nutzer: nach dem ersten echten Ereignis pruefen, ob der Freeze im
  Mergify-Dashboard erscheint; falls 403, Application Key mit
  Freeze-Recht als MERGIFY_TOKEN hinterlegen.
- OPS-01/Startcheck koennten offene `ci-red`-Issues als hartes
  Stoppsignal werten (Idee, kein Auftrag).
