# Review: pr182 — claude opus

- Autor des Artefakts: kimi (ci-04)
- Reviewer: claude -p --model opus --permission-mode plan (read-only), Claude Code 2.1.282
- Datum: 2026-09-25, Status: ok (exit 0)
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt
- Prompt: `.pa/review_prompt_pr182.md`

## Roh-Antwort des Reviewers (unveraendert)

# Review predecessor PR (CI-04): „Roter main stoppt die Queue“

Das Review ist fertig. Ich habe den Diff und die betroffenen Stellen in `ci.yml` und `test-ci-shape.sh` gelesen, aber nichts ausgeführt und nichts geändert.

**Befund 1 — hoch — `scripts/ci/main-red-guard.sh:171` (Freeze-Aufhebung)**
- **Was bricht:** Der Freeze wird schon aufgehoben, wenn *irgendeine* Bahn lief (`LINUX_RAN` oder `WINDOWS_RAN`). Der Beweis muss aber die Bahn abdecken, die rot war. Das ist genau „grün durch Abwesenheit“.
- **Wann:** Der Wochenlauf wird wegen windows rot, also Freeze. Danach kommt ein Push auf main, der nur `package-lock.json` ändert. Laut `ci.yml:68-69` läuft dann nur linux voll, windows bleibt leicht. Ergebnis: success/success mit linux=true. Der Freeze ist weg und das Issue zu, obwohl windows nie wieder geprüft wurde. Testfall 3 (`GREEN_MAIN`: windows ran=false) nagelt genau dieses Verhalten sogar fest.
- **Fix:** Entfrieren nur, wenn `LINUX_RAN=true && WINDOWS_RAN=true`. Test 3 auf `true true` umstellen. Neuer Testfall: linux=true, windows=false → kein Entfrieren.

**Befund 2 — mittel — `main-red-guard.sh`, `issue_body` (Anleitung „hotfix/...“)**
- **Was bricht:** Laut Issue-Text reicht ein Branch `hotfix/...` **oder** das Label `hotfix`. Der Freeze nimmt aber nur `label=hotfix` aus.
- **Wann:** Ein Fix-PR auf einem `hotfix/`-Branch ohne Label hängt im Freeze.
- **Fix:** `head~=^hotfix/` zusätzlich in `exclude_conditions` aufnehmen. Oder den Text auf „Label `hotfix` Pflicht“ korrigieren.

**Befund 3 — mittel — Ablauf nach dem Fix (Issue-Text und Skript)**
- **Was bricht:** Der Hotfix wird im Queue-Branch voll getestet, dort macht der Guard aber nichts. Der folgende Push auf main ist leicht, entfriert also nicht. Die Queue bleibt eingefroren bis zum nächsten Montagslauf.
- **Fix:** Im Issue-Text klar sagen: „Nach dem Merge des Fixes den `ci`-Workflow per `workflow_dispatch` auf main starten.“ Der Guard könnte das zusätzlich per `::notice` sagen, wenn er ein leichtes Grün überspringt, aber noch ein `ci-red`-Freeze offen ist.

**Befund 4 — mittel — `main-red-guard.sh`, Freeze-Payload und Endpunkte (nicht belegt)**
- **Was bricht:** `"start":null,"end":null`, der POST auf `.../<id>/delete` und der Schlüssel `scheduled_freezes` sind nur gegen den Mock geprüft. Der Mock akzeptiert alles.
- **Beleg-Lücke:** Ich habe `api.mergify.com/v1/openapi.json` abgerufen. Darin tauchte `scheduled_freeze` nicht auf, möglicherweise war die Seite abgeschnitten. Dort gibt es aber ein eigenes **Queue-Pause-API** (pause/unpause).
- **Wann:** Beim ersten echten roten main. Ein 422 wegen `start:null` würde den Job zwar laut rot machen (gut), aber die Queue liefe weiter.
- **Fix:** Die Endpunkte vor dem Merge gegen die aktuelle Mergify-Doku oder das Spec festhalten. `start` besser weglassen oder als aktuellen ISO-Zeitstempel senden. Prüfen, ob `/merge-queue/pause` der einfachere, dokumentierte Weg ist. In den Bericht als Risiko aufnehmen.

**Befund 5 — niedrig — `ci.yml:133` und Job `main-red` (Rennen zwischen Läufen)**
- **Was bricht:** Jeder main-Lauf hat seine eigene Concurrency-Gruppe (SHA im Namen), also laufen die Guards parallel. Zwei Fälle:
  - Wochenlauf und Push werden gleichzeitig rot: zwei Issues und zwei Freezes.
  - Ein älterer roter Lauf endet nach einem neueren grünen: der Freeze wird erneut gesetzt.
- **Fix:** Auf Job-Ebene `concurrency: { group: main-red-guard, cancel-in-progress: false }` setzen. Optional nur handeln, wenn `SHA` gleich dem aktuellen main-HEAD ist, sonst `::notice`.

**Befund 6 — niedrig — `main-red-guard.sh:175-190` (Reihenfolge im grünen Zweig)**
- **Was bricht:** Die Issues werden geschlossen, *bevor* die Freezes gelöscht sind. Scheitert das Löschen, ist der Job rot, aber der Freeze bleibt ohne offenes Issue bestehen. Beim nächsten bewiesenen Grün heilt sich das zwar selbst, der Zustand ist bis dahin aber schwer zu erkennen.
- **Fix:** Erst die Freezes löschen, dann die Issues schließen.

**Befund 7 — niedrig — `ci.yml:580` (`always()`)**
- **Was bricht:** `always()` lässt den Guard auch in abgebrochenen Läufen starten. Er ist dann zwar No-Op, kostet aber Minuten.
- **Wann, und die offene Frage:** Wie GitHub `needs.<job>.result` bei einem Job-Timeout meldet (failure oder cancelled), habe ich nicht belegt. Bei „cancelled“ bliebe ein hängender main-Lauf still, ohne Issue.
- **Fix:** `!cancelled()` statt `always()`, und den Check in `ci-shape.sh` entsprechend anpassen. Das Timeout-Verhalten einmal belegen oder bewusst als Lücke in den Bericht aufnehmen.

**Befund 8 — niedrig — `main-red-guard.sh`, `mg_api` (kein Timeout)**
- **Was bricht:** `curl` hat weder `--max-time` noch `--retry`. Hängt die API, bricht erst das 5-Minuten-Limit des Jobs ab. Eine kurze 5xx-Störung führt sofort zu Exit 1.
- **Fix:** `--max-time 30 --retry 2 --retry-all-errors` ergänzen.

**Befund 9 — niedrig — `scripts/test-main-red-guard.sh`, Fall 7 (Testlücke)**
- **Was bricht:** `MOCK_CURL_FAIL=1` lässt schon das GET scheitern. Der eigentlich behauptete Fall „Freeze-POST scheitert“ wird nie erreicht.
- **Ebenfalls ungetestet:** Das Löschen im grünen Zweig scheitert. `gh issue list` scheitert. Beide Bahnen sind rot.
- **Fix:** Einen Schalter `MOCK_CURL_FAIL_ON=POST|GET|delete` einbauen und je einen Fall ergänzen.

**Befund 10 — niedrig — `scripts/ci/ci-shape.sh`, Check 5 (zu schwache Prüfung)**
- **Was bricht:**
  - `has "$mainred_if" "refs/heads/main"` ist auch bei `github.ref != 'refs/heads/main'` erfüllt.
  - Die `lane_run`-Zeile wird geprüft, aber nicht, dass es den Step `id: plan` gibt. Fehlt er, wird `lane_run` leer: kein falsches Grün, aber der Freeze bliebe für immer bestehen.
- **Fix:** Auf `github.ref == 'refs/heads/main'` exakt matchen und dafür einen Mutationsfall `==` → `!=` ergänzen. Zusätzlich prüfen, dass `id: plan` in beiden Jobs steht.

## Korrekt befunden

- **Outputs:** Übersprungene oder abgebrochene Jobs liefern leere Outputs. `"" != "true"` führt nicht zum Entfrieren, fail-safe.
- **Rot-Erkennung:** `failure` gewinnt immer, auch in Kombination mit cancelled. Ein gescheiterter Plan-Schritt macht den Job rot, `lane_run` kann nicht still leer bleiben.
- **Refs:** Die Ref-Prüfung wirkt doppelt. `schedule` und `workflow_dispatch` auf main werden erkannt, Queue-Branches sind ausgeschlossen.
- **Fehlerbehandlung:** `curl -f` mit `pipefail` in `freeze_ids`, und `|| fail` fängt Fehler ab.
- **Token:** Wird nicht geloggt (kein `-v`, GitHub maskiert Secrets zusätzlich).
- **Runner-Tools:** node und gh sind auf ubuntu-latest vorhanden.
- **Rechte und Checkout:** `issues: write` reicht für label/issue. `sparse-checkout: scripts/ci` genügt.
- **Fremde Freezes:** Der Marker-Filter `ci-red:` verhindert, dass ein fremder Freeze gelöscht wird.
- **Mutationstests:** `test-ci-shape.sh` nutzt `sed -E` (`\{`/`\(` sind dort literal), und `cmp` erkennt Mutationen, die nichts ändern.
- **gates.sh:** `selftest-main-red` läuft in `linux,release`, wie `selftest-lane-plan`.

**Urteil: mergebar nein (wegen Befund 1)**

Die Befunde 2–4 sollten vor dem Merge ebenfalls behoben oder im Bericht festgehalten werden. Befund und Umgang damit kommen nach AGENTS.md in `.pa/review_ci-04_disposition.md`.
