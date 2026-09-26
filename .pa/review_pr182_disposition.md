# Disposition predecessor PR (CI-04: Roter main stoppt die Queue)

- Kandidat: `ef22e1f` (Branch `claude/ci-04-red-main-stops-queue`)
- Autor: kimi (ci-04); Reviewer: claude sonnet (Protokoll
  `.pa/review_pr182_sonnet.md`) und claude opus
  (`.pa/review_pr182_opus.md`), beide `claude -p --permission-mode plan`
  (read-only), Status jeweils ok (exit 0). Prompt:
  `.pa/review_prompt_pr182.md`.
- Beide Reviewer: **Urteil mergebar nein** (sonnet: Befund 1+2; opus:
  Befund 1). Nummerierung unten: S = sonnet, O = opus. Zusammengefasste
  Dubletten sind vermerkt.

## S-6/O-1 — Entfrieren schon bei EINER gelaufenen Bahn (hoch) — ANGENOMMEN

- Befund: `main-red-guard.sh:169` verlangt nur `LINUX_RAN=true` ODER
  `WINDOWS_RAN=true`. Konkretes Szenario (opus): Wochenlauf rot wegen
  windows → Freeze; Push, der nur `package-lock.json` aendert, laesst nach
  lane-plan (ci.yml Kopfkommentar: `package-lock.json` ist Cache-Eingabe
  nur der Linux-Bahn) linux voll und windows leicht laufen → success +
  LINUX_RAN=true → Freeze weg, ohne dass windows je wieder geprueft wurde.
  Testfall 3 (`GREEN_MAIN = success success true false`) nagelt das
  falsche Verhalten sogar fest.
- Pruefung: trifft zu. lane-plan Cache-Eingaben differieren zwischen den
  Bahnen, ein einseitig voller Push ist real moeglich. "Gruen durch
  Abwesenheit" fuer die andere Bahn.
- Umsetzung (red-first): Entfrieren nur bei `LINUX_RAN=true &&
  WINDOWS_RAN=true`. Testfall 3 auf `true true` umgestellt; neuer Fall
  "nur eine Bahn lief" → kein Entfrieren, kein Issue-Close.

## S-1/O-3 — Erholungsweg: nach dem Hotfix-Merge ist der Push leicht (mittel) — ANGENOMMEN

- Befund: der Push nach dem Queue-Merge des Fixes ist nach CI-02-Regeln
  leicht (Code im Queue-Lauf geprueft, keine Cache-Eingabe geaendert) →
  kein Gruen-Beweis → Freeze bleibt bis Wochenlauf oder manuellem
  Eingriff stehen, obwohl main repariert ist. Issue-Text suggeriert
  Automatik.
- Pruefung: trifft zu (Konsequenz der bewussten CI-02-Entscheidung;
  automatisch voll erzwingen wuerde die Kostenentscheidung unterlaufen).
- Umsetzung (red-first): Issue-Text benennt den Handgriff ehrlich
  (`gh workflow run ci.yml` auf main startet einen vollen Lauf, der
  entfriert). Zusaetzlich: erkennt der Guard einen leichten/teilweisen
  Lauf bei offenem ci-red-Freeze/Issue, weist eine `::notice` auf genau
  diesen Handgriff hin. Test: leichtes Gruen mit offenem Freeze →
  Notice mit dispatch-Hinweis.

## S-3 — Issue-Text behauptet den Freeze, bevor er steht (mittel) — ANGENOMMEN

- Befund: `issue_body` sagt "Die Mergify-Queue ist eingefroren", die
  Anlage folgt erst danach; ohne Token oder bei Freeze-Fehler bleibt die
  falsche Behauptung stehen. Beim Dedup-Kommentar fehlt der
  Freeze-Status ganz.
- Pruefung: trifft zu (Zeilen 86, 128-164). "Gruen durch Behauptung"
  gegenueber dem menschlichen Leser.
- Umsetzung (red-first): Reihenfolge umgedreht — erst Freeze-Versuch,
  dann Issue/Kommentar mit dem TATSAECHLICHEN Status (eingefroren /
  schon vorhanden / UEBERSPRUNGEN ohne Token + manuelle Anleitung).
  Tests: ohne Token darf das Issue nicht "eingefroren" behaupten; mit
  Token traegt Issue/Kommentar den Freeze-Status.

## S-5/O-5 — Ueberholter roter Lauf friert falschen Stand ein (niedrig/mittel) — ANGENOMMEN

- Befund: main-Laeufe brechen sich nicht gegenseitig ab (Concurrency mit
  SHA, ohne cancel); ein aelterer roter Lauf, der nach einem neueren
  gruenen endet, setzt den Freeze erneut.
- Pruefung: trifft zu (ci.yml:132-134, windows ist die langsame Bahn).
- Umsetzung (red-first): (a) Job-Concurrency
  `concurrency: { group: main-red-guard, cancel-in-progress: false }`
  serialisiert die Guards; (b) das Skript vergleicht im Rot-Zweig `SHA`
  mit dem aktuellen main-Kopf (`gh api repos/$REPO/commits/main
  --jq .sha`) und kommentiert bei Abweichung nur ("ueberholter Lauf")
  statt einzufrieren. Test: roter Lauf mit altem SHA → Kommentar, kein
  Freeze-POST.

## S-4/O-9 — Selbsttest-Luecken (mittel) — ANGENOMMEN

- Befund: kein Fall fuer fremden Freeze (darf nicht geloescht werden),
  nur-eine-Bahn, windows-rot, POST-isoliert-Fehler (Fall 7 laesst schon
  das GET scheitern), Delete-Fehler, gruen ohne Token.
- Pruefung: trifft zu. Der Marker-Filter `startsWith("ci-red:")` ist
  korrekt, aber nichts pinnt ihn.
- Umsetzung (red-first): Mock-Schalter `MOCK_CURL_FAIL_ON=POST|delete`;
  neue Faelle: fremder Freeze bleibt, windows-rot, POST-Fehler laut,
  Delete-Fehler laut, nur-eine-Bahn (s. S-6/O-1), gruen ohne Token.

## S-7/O-6 — Reihenfolge im Gruen-Zweig (niedrig) — ANGENOMMEN

- Befund: Issues werden geschlossen, BEVOR die Freezes geloescht sind;
  scheitert das Loeschen, ist das Issue zu und der Freeze ohne Signal
  aktiv.
- Pruefung: trifft zu (Zeilen 174-196).
- Umsetzung: erst Freezes loeschen, dann Issues schliessen. (Im Zuge von
  S-3 ohnehin umgebaut.)

## S-8/O-2 — `hotfix/`-Branch-Text vs. Ausnahme nur `label=hotfix` (niedrig/mittel) — ANGENOMMEN

- Befund: Issue-Text nennt "Fix-Branch als `hotfix/...` ODER Label
  `hotfix`", die exclude_conditions kennen nur `label=hotfix`.
- Pruefung: trifft zu (Zeilen 95-96, 159). Eine zusaetzliche
  Kopf-Branch-Bedingung waere ungepruefte Mergify-Syntax — kein
  ungetestetes API-Verhalten hinzufuegen.
- Umsetzung: Text auf "Label `hotfix` setzen" korrigiert (Verhalten
  unveraendert).

## S-9/O-10 — ci-shape Check 5 zu schwach (niedrig) — ANGENOMMEN

- Befund: (a) `has "$mainred_if" "refs/heads/main"` liesse auch
  `!= 'refs/heads/main'` durch; (b) die `lane_run`-Zeile kann ein
  Kommentar faelschen; (c) kein Mutationsfall fuer den Windows-Output;
  (d) Env-Verdrahtung `needs.<job>.outputs.lane_run` und `id: plan`
  ungeprueft.
- Pruefung: trifft zu (ci-shape.sh:156-167).
- Umsetzung (red-first): exakter Match auf `github.ref ==
  'refs/heads/main'` (+ Mutationsfall `==`→`!=`), `lane_run`-Zeile
  verankert (`^  lane_run:`), `needs.linux.outputs.lane_run` /
  `needs.windows.outputs.lane_run` und `id: plan` in beiden Jobs
  geprueft, Windows-Mutationsfall ergaenzt. Mutationen zuerst in
  test-ci-shape.sh (rot: unentdeckt), dann ci-shape.sh geschaerft.

## S-10/O-8 — curl ohne Timeout/Retry, Fehler-Body verworfen (niedrig) — ANGENOMMEN

- Befund: kein `--max-time`, kein `--retry`; `-f` verwirft den
  Fehler-Body; ein haengender Aufruf frisst die 5 Job-Minuten.
- Pruefung: trifft zu (Zeile 61).
- Umsetzung: `--max-time 30` und `--fail-with-body` (Fehlergrund
  sichtbar); `--retry 2 --retry-all-errors` nur bei GET und delete
  (idempotent), nicht beim Anlegen (Dedup faengt Doppeltes ohnehin ab).

## S-11 — Datei-Modi 100644 (niedrig) — ANGENOMMEN

- Befund: die neuen Skripte stehen im Diff als 100644; der
  SessionStart-Hook hat den Index lokal auf 100755 korrigiert
  (core.fileMode=false unter Windows verbirgt das in `git status`).
- Pruefung: trifft zu (`git diff origin/main...HEAD` zeigt
  `new file mode 100644`, `git ls-files -s` zeigt 100755).
- Umsetzung: der naechste Commit nimmt 100755 mit. Funktional ohne
  Belang (Aufruf via `bash <pfad>`).

## S-2/O-4 — Freeze-Payload / Endpunkte unbelegt, ggf. Pause-API (mittel) — ABGELEHNT (mit Beleg)

- Befund: `"start":null,"end":null`, POST .../<id>/delete und der
  Schluessel `scheduled_freezes` seien nur gegen den Mock geprueft;
  opus fand in der OpenAPI-Spec stattdessen eine Queue-Pause-API.
- Pruefung: Endpunkte und Wire-Format am 2026-09-25 gegen die Quelle
  des offiziellen mergify-cli verifiziert
  (github.com/Mergifyio/mergify-cli, crates/mergify-freeze):
  - `create.rs`: `POST /v1/repos/<repo>/scheduled_freeze`, Felder
    `reason`, `start`, `end`, `timezone` IMMER, mit `null` fuer den
    offenen Notfall-Freeze (Kommentar: "the API expects `null` for
    missing values", Python-Paritaet); `matching_conditions` /
    `exclude_conditions` als Listen, genau unser Payload.
  - `delete.rs`: `POST .../scheduled_freeze/<id>/delete` mit
    `{"delete_reason": "<text>"}` — genau unser Aufruf.
  - `list.rs`: Antwortschluessel `scheduled_freezes` — genau unser
    Parsing.
  `"start":null` ist also kein Risiko, sondern das dokumentierte
  Notfall-Freeze-Format; ein ISO-`start` waere falsch (der Freeze
  soll sofort gelten). Die Pause-API ist ein anderes Feature
  (Queue-Pause statt Scheduled Freeze) und nicht der CLI-Weg.
- Grund der Ablehnung: Befund widerlegt; die Restforderung
  (Fehler-Body, Timeout) ist in S-10 aufgegangen. Im Bericht bleibt
  ehrlich, dass der TOKEN-SCOPE (`scheduled_freeze`) erst live
  beweisbar ist.

## O-7 — `always()` vs. `!cancelled()` (niedrig) — ABGELEHNT

- Befund: `always()` startet den Guard auch in abgebrochenen Laeufen
  (Minuten); offen, ob ein Job-Timeout als failure oder cancelled
  gemeldet wird.
- Pruefung: ein manuell abgebrochener Lauf ist im Skript bereits ein
  No-Op (`cancelled`/`skipped` → weder rot noch gruen → exit 0); die
  zusaetzlichen Kosten sind ein Sparse-Checkout plus Sekunden auf
  ubuntu (keine Windows-Minuten). Ein Job-Timeout gilt bei GitHub als
  failure — genau dann SOLL der Guard feuern (eine haengende Bahn ist
  rot). `!cancelled()` wuerde zudem das in ci-shape gepinnte
  `always()` brechen, ohne den No-Op-Fall zu verbessern.
- Grund der Ablehnung: kein Korrektheitsgewinn, vernachlaessigbare
  Kosten, bricht eine gepinnte Struktur.

## Nicht uebernommene Nebenbemerkungen

- S-4 "schwache Assertions" (Pattern zu grosszuegig): nicht als
  eigener Befund umgesetzt; die neuen Faelle assertieren gezielter,
  die alten bleiben (sie pruefen Vorhandensein, nicht Wortlaut eines
  Vertrags).
- O-4 Teil "Probe-Freeze vor dem Merge": bleibt Nutzer-Handgriff
  (steht bereits im Bericht unter NICHT ABGEDECKT); kein Codebefund.

## Ergebnis

- Angenommen: S-6/O-1, S-1/O-3, S-3, S-5/O-5, S-4/O-9, S-7/O-6,
  S-8/O-2, S-9/O-10, S-10/O-8, S-11.
- Abgelehnt (begruendet): S-2/O-4 (gegen mergify-cli-Quelle belegt),
  O-7.
- Umsetzung: red-first in `scripts/test-main-red-guard.sh` und
  `scripts/test-ci-shape.sh`, dann Fixes in
  `scripts/ci/main-red-guard.sh`, `scripts/ci/ci-shape.sh`,
  `.github/workflows/ci.yml`; Commit-Hashes und Exit-Codes im
  Abschluss dieses Dokuments bzw. im PR.

## Belege der Umsetzung (2026-09-25)

- Red: die neuen Selbsttests gegen die alten Skripte aus `ef22e1f`
  (`MAIN_RED_GUARD_SCRIPT` / `CI_SHAPE_SCRIPT` auf den Alt-Stand):
  `bash scripts/test-main-red-guard.sh` → **Exit 1** (11 Fehler),
  `bash scripts/test-ci-shape.sh` → **Exit 1** (3 Fehler).
- Gruen mit den Fixes: `bash scripts/test-main-red-guard.sh` → **Exit 0**
  (58 Assertions, 15 Faelle), `bash scripts/test-ci-shape.sh` → **Exit 0**
  (24 Faelle), `bash scripts/ci/ci-shape.sh` → **Exit 0**,
  `bash scripts/ci/gates.sh run selftest-main-red ci-shape no-masked
  wf-shell wf-pinned selftest-gates` → **Exit 0**,
  `actionlint .github/workflows/ci.yml` → **Exit 0**.
- Nachtrag zu S-5/O-5: der Kommentar an der Job-Concurrency nannte
  "a waiting guard must still report"; GitHub verwirft aber einen
  aelteren WARTENDEN Lauf zugunsten eines neueren. Harmlos (der neuere
  beurteilt den neueren main-Kopf); Kommentar korrigiert, Verhalten
  unveraendert.
- Commit: siehe `git log` des Branches (ein Fixup-Commit auf `ef22e1f`).
