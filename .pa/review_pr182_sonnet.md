# Review: pr182 — claude sonnet

- Autor des Artefakts: kimi (ci-04)
- Reviewer: claude -p --model sonnet --permission-mode plan (read-only), Claude Code 2.1.282
- Datum: 2026-09-25, Status: ok (exit 0)
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt
- Prompt: `.pa/review_prompt_pr182.md`

## Roh-Antwort des Reviewers (unveraendert)

# Review predecessor PR (CI-04)

Ich habe den Diff gelesen und `ci.yml` und `lane-plan.sh` gegengeprüft: Die Step-ID `plan` gibt es in beiden Jobs (Zeilen 216 und 418), und `lane-plan.sh` gibt immer `run=true|false` aus (Zeile 158). Die Mergify-Endpunkte und -Felder konnte ich nicht gegen die Doku prüfen.

## Befunde

**1. mittel — Der reguläre Erholungsweg hebt den Freeze nicht auf**
- Datei: `scripts/ci/main-red-guard.sh:167-170` (Grün-Zweig), `ci.yml` main-red.
- Was bricht:
  - Der Hotfix-PR wird durch die Queue getestet und gemergt.
  - Der folgende main-Push besteht laut AGENTS.md aus genau einem Merge-Commit von `mergify[bot]` und ist damit „leicht“ (`run=false`).
  - Der Guard meldet „kein Grün-Beweis“ und lässt den Freeze stehen.
  - Der Freeze fällt erst beim Wochenlauf, bei einer Cache-Key-Änderung oder bei einem manuellen `workflow_dispatch`.
  - Bis dahin sind alle PRs ohne `hotfix`-Label blockiert, obwohl main repariert ist.
- Fix (eines davon):
  - Im lane-plan „voll“ erzwingen, solange ein offenes `ci-red`-Issue existiert (ein `gh issue list`).
  - Oder den Handgriff ins Issue schreiben: `gh workflow run ci.yml --ref main`.
- Der Bericht und `decisions.md` sollten das benennen. Der Issue-Text (Schritt 2) suggeriert Automatik.

**2. mittel — Freeze-Payload: `"start":null` ist ungeprüft**
- Datei: `main-red-guard.sh:150`.
- Was bricht:
  - Ich habe die Mergify-Doku nicht gegengeprüft. Aus dem Gedächtnis sendet mergify-cli `start` mit dem aktuellen Zeitpunkt.
  - Lehnt die API `null` ab, ist die Freeze-Anlage im Ernstfall dauerhaft 4xx/422. Der Job wird dann rot, aber es gibt keinen Freeze.
  - Ohne `--fail-with-body` sieht man den Grund nicht.
  - Der Selbsttest fängt das nicht ab, weil `curl` gemockt ist.
- Fix:
  - `start` mit `date -u +%Y-%m-%dT%H:%M:%S` setzen und `end` weglassen oder `null` lassen.
  - `curl -sS --fail-with-body --max-time 30` statt `-sf`. Ohne `--fail-with-body` verwirft `-f` den Fehler-Body.
  - Der Bericht sagt es ehrlich („lokal nicht beweisbar“). Ein Probe-Freeze per Hand vor dem Merge würde das schließen.

**3. mittel — Issue-Text behauptet „Queue ist eingefroren“, bevor das feststeht**
- Datei: `main-red-guard.sh:76` (`issue_body`), Anlage in Zeile 128, Freeze erst ab Zeile 138.
- Was bricht:
  - Ohne Token (Zeile 142) oder bei einem Freeze-Fehler (Zeile 153) bleibt ein Issue mit „Die Mergify-Queue ist eingefroren“ stehen.
  - Beim Dedup-Kommentar (Zeile 133) kommt der Freeze-Status gar nicht vor.
  - Das ist Grün durch Behauptung: Ein Mensch verlässt sich auf das Issue.
- Fix:
  - Den Text neutral formulieren („Freeze wird gesetzt“).
  - Oder das Ergebnis des Freeze-Versuchs als Kommentar nachreichen (`gh issue comment`: „Freeze ÜBERSPRUNGEN/FEHLGESCHLAGEN, bitte manuell“).

**4. mittel — Der Selbsttest deckt die zentralen Risiken nicht ab**
- Datei: `scripts/test-main-red-guard.sh`.
- Fehlende Fälle:
  - **Fremder Freeze:** Ein Freeze mit anderem Grund darf im Grün-Zweig nicht gelöscht werden. Das ist die Frage „kann Delete einen fremden Freeze erwischen“. Der Code filtert korrekt über `startsWith("ci-red:")`, aber nichts pinnt es. Ein Regressionsfall in `freezes.json` reicht.
  - **Nur eine Bahn lief:** `LINUX_RAN=true`, `WINDOWS_RAN=false` und umgekehrt.
  - **Windows rot:** `WINDOWS_RESULT=failure`.
  - **Grün ohne Token:** mit offenem Issue und vorhandenem Freeze.
  - **POST-Fehler isoliert:** Fall 7 lässt jeden `curl` scheitern, also scheitert schon das GET in `freeze_ids`. Der POST-Fehlerpfad (Zeile 153) läuft nie. Der Mock sollte nur bei `POST` fehlschlagen.
  - **Delete-Fehler** (Zeile 197).
- Schwache Assertions:
  - Fall 6 `out_has 'warning|MERGIFY_TOKEN'` und Fall 4 `'light|leicht|…|skipped'` treffen fast jede Ausgabe.
  - Besser die feste Meldung prüfen, etwa `title=main-red-guard` plus „Freeze bleibt“.

**5. niedrig/mittel — Veralteter roter Lauf kann einen falschen Freeze setzen**
- Datei: `main-red-guard.sh:104-110`; `ci.yml:132-134` (main-Läufe brechen sich nicht gegenseitig ab).
- Was bricht:
  - Lauf A (älterer Commit, Windows langsam) wird rot, nachdem Lauf B (neuerer Commit, voll grün) schon durch ist.
  - A friert dann eine Queue ein, obwohl der aktuelle main-Kopf grün ist. Das Grün von B hat nichts zu entfrieren gefunden.
  - Das Freeze/Unfreeze-Ergebnis hängt von der Beendigungsreihenfolge ab, nicht von der Commit-Reihenfolge.
- Fix:
  - Im Rot-Zweig `gh api repos/$REPO/commits/main --jq .sha` mit `$SHA` vergleichen.
  - Bei Abweichung nur das Issue kommentieren („älterer Commit, main ist weiter“) und nicht einfrieren.

**6. niedrig — Ein Lauf mit nur einer echten Bahn hebt den Freeze auf**
- Datei: `main-red-guard.sh:167`.
- Was bricht: Die Bedingung lautet `LINUX_RAN != true && WINDOWS_RAN != true`. Lief nur die Linux-Bahn und war grün, wird entfroren, obwohl das Rot von Windows kam.
- Auf main-Pushes sind aktuell beide Bahnen gleich (beide voll oder beide leicht), daher heute nicht ausgelöst.
- Fix: `LINUX_RAN = true && WINDOWS_RAN = true` verlangen. Alternativ dokumentieren, dass das bewusst so ist.

**7. niedrig — Reihenfolge im Grün-Zweig**
- Datei: `main-red-guard.sh:172-190`.
- Was bricht:
  - Die Issues werden vor dem Freeze-Delete geschlossen.
  - Scheitert das Delete (exit 1), ist das Issue zu, der Freeze aber noch da.
  - Der nächste Grün-Lauf räumt zwar über `freeze_ids` auf, aber solange bleibt das Signal irreführend.
- Fix: erst Freeze löschen, dann Issues schließen.

**8. niedrig — `hotfix/`-Branch stimmt nicht mit der Ausnahme überein**
- Datei: `main-red-guard.sh:79-80` (Issue-Text), Zeile 150 (Ausnahme).
- Was bricht:
  - Der Text sagt „Fix-Branch als `hotfix/...` oder mit Label `hotfix`“, die Ausnahme ist aber nur `label=hotfix`.
  - Ein `hotfix/`-Branch ohne Label bleibt eingefroren.
  - `.mergify.yml` kennt `hotfix/` nur für die Priorität.
- Fix: Text auf „Label `hotfix` setzen“ kürzen, oder die Ausnahme um eine Kopf-Branch-Bedingung ergänzen. Die Syntax für mehrere Ausnahmen (ODER/UND) müsste ich in der Mergify-Doku nachsehen.

**9. niedrig — `ci-shape` Check 5 ist an drei Stellen schwächer als behauptet**
- Datei: `scripts/ci/ci-shape.sh:143-162`.
- Lücken:
  - **Kommentar statt Output:** `has "$linux" "$lane_out"` sucht den Text im ganzen Job-Block. Ein Kommentar mit `lane_run: ${{ steps.plan.outputs.run }}` würde den Check bestehen, obwohl das `outputs:` fehlt.
  - **Windows nicht mutiert:** Es gibt nur einen Mutationsfall für linux (`/^  linux:/,/^  windows:/`). Ein Verlust des Windows-Outputs wäre nicht abgesichert.
  - **Env-Verdrahtung ungeprüft:** Wird `LINUX_RAN`/`WINDOWS_RAN` im Step falsch verdrahtet oder entfernt, greift der Default `:=`. Der Guard entfriert dann nie, still. Nicht geprüft werden auch `LINUX_RESULT`/`WINDOWS_RESULT`.
- Fix:
  - Die Output-Zeile mit `grep -E '^      lane_run:'` prüfen.
  - Einen Windows-Mutationsfall ergänzen.
  - `needs.linux.outputs.lane_run` und `needs.windows.outputs.lane_run` im main-red-Block prüfen.
  - Beim `if` zusätzlich `github.ref == 'refs/heads/main'` als Ganzes prüfen. `has ... refs/heads/main` würde auch `!= 'refs/heads/main'` durchlassen.

**10. niedrig — Robustheit von `curl`**
- Datei: `main-red-guard.sh:53`.
- Was fehlt: Es gibt weder `--max-time` noch `--retry`. Ein hängender Aufruf frisst die 5 Minuten. Ein 5xx bei Mergify lässt den Job im Ernstfall rot, ohne Freeze.
- Fix: `--max-time 30`. `--retry 2` beim GET und beim Delete. Beim POST ist ein Retry riskant, aber das Dedup über das GET beim nächsten Rot fängt Duplikate ab.

**11. niedrig — Datei-Modi**
- Die Skripte stehen im Diff als `100644`. Der SessionStart-Hook hat den Index lokal auf `100755` korrigiert, das muss noch committet werden. Der Job ruft `bash scripts/ci/main-red-guard.sh` und ist davon nicht betroffen, aber die Gates rufen wohl auch andere Skripte per Pfad auf.

## Geprüft und korrekt

- **Stilles Grün bei rotem main:** Der Job kann nicht still bleiben.
  - `always()` plus `needs` liefert die Ergebnisse auch bei rotem `linux`/`windows`.
  - Jeder Fehlerpfad mit Token ist `exit 1` (`gh`, GET, POST, Delete).
  - Ohne Token bleibt das Ergebnis Grün mit `::warning`. Das ist dokumentiert und gewollt, aber die Warnung steht nur im Log, siehe Befund 3.
- **Fälschliches Feuern bei grünem main:** Der Job feuert nicht bei Grün.
  - Rot heißt nur `failure`. `cancelled`/`skipped` sind ein No-Op (Zeile 110).
  - `pull_request` und Refs ungleich main sind doppelt abgesichert.
  - `schedule` und `workflow_dispatch` auf main laufen korrekt mit.
- **Leichtes Grün:** Die `lane_run`-Logik ist dicht.
  - Der Output hängt an `steps.plan.outputs.run`, und `lane-plan.sh` gibt `run` in jedem Pfad aus. Es gibt keinen Default „true“, `:=` ergibt leer.
  - Schlägt der Plan-Schritt fehl, ist der Job rot, also rot statt Beweis.
- **Freeze und Issues:** Fremde Freezes und Issues sind geschützt.
  - Löschen betrifft nur `ci-red:`-Freezes (das Präfix-Matching ist exakt).
  - Die Dedup-Kommentare sind korrekt.
  - Beim Schließen werden alle offenen `ci-red`-Issues erwischt.
- **Issue-Dedup:** Ein Rennen mit Doppelanlage ist theoretisch möglich, da main-Läufe nicht abbrechen. Es ist harmlos, und der Grün-Zweig schließt alle offenen Issues.
- **Shell:** Der Token wird nicht geloggt (nur im `curl`-Argument, nirgends `echo`; das Actions-Secret-Masking greift zusätzlich).
  - `set -uo pipefail` ohne `-e` ist hier richtig, die Fehler werden explizit behandelt.
  - Pipelines mit `pipefail` in `freeze_ids` geben curl-Fehler korrekt weiter.
  - `node` ist auf ubuntu-latest vorhanden. Das Skript braucht dafür kein `jq`.
  - Das Quoting im `printf`-Payload ist unkritisch, weil `RUN_ID` numerisch ist.
- **Job-Konfiguration:** Sparse-Checkout `scripts/ci` (cone-Modus) reicht, die Rechte sind minimal, der Job läuft auf Ubuntu ohne Windows-Minuten, und er ist kein Required Check.
- **gates.sh-Einbindung:** `selftest-main-red` läuft in `linux,release` und berührt die bestehenden Gates nicht.

Urteil: mergebar nein (wegen Befund 1 und 2). Sie ließen sich beide mit kleinem Aufwand lösen. Befund 3 und 4 sollten in derselben Runde mit.
