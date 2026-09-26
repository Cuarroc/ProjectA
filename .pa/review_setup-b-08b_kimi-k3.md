# Review: pr153 — kimi-k3

- Autor des Artefakts: Claude (PR #153, nur SETUP-08b)
- Reviewer: kimi-k3 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `kimi-k3:cloud`, bedient `kimi-k3`
- Datum: 2026-09-25 01:50 UTC, Dauer 581 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_pr153.md` (57521 Zeichen)

## Roh-Urteil des Reviewers

# Review SETUP-08b (`a82a029..273453f`)

Geprüft: die vier Helfer, Selbsttests, README, package.json-Verdrahtung; Fokus auf Fail-closed-Verhalten, Schreibpfade, Injection-Flächen und Testaussagekraft.

## Befunde

**1. erledigt-row: Idempotenz bricht bei Multi-ID-Zeilen und abweichendem Link-Format → Doppeleinträge** — *medium*
Beleg: `scripts/dev/erledigt-row.mjs:70`; Format-Gegenbeleg `scripts/dev/hygiene.mjs:103` (`erledigtRows` splittet die ID-Zelle an Kommas — das Format komma-getrennter IDs ist im Projekt also Realität).
Was falsch ist: Der `already`-Check verlangt (a) exaktes Vorkommen der vollen URL `(https://github.com/Cuarroc/ProjectA/pull/<nr>)` und (b) strikte Gleichheit der kompletten ID-Zelle. Eine Zeile `| … | W1-05, W1-06 | … | [#150](…) |` oder eine ältere/handgeschriebene Zeile mit anderem Link-Ziel erfüllt beides nicht.
Szenario: PR #150 deckt zwei Pakete ab und wurde als eine Zeile mit `W1-05, W1-06` eingetragen. Der Koordinator führt erneut `npm run dev:erledigt-row -- 150 W1-05 --apply` aus → zweite Zeile für PR #150 wird eingefügt, obwohl der Helfer „idempotent" verspricht und README das behauptet.
Fix: PR-Spalte per `#<nr>`-Regex statt exakter URL matchen; die ID-Zelle mit demselben `cells()`-Helper parsen und an `/\s*,\s*/` splitten, Treffer wenn `id` in der Menge ist (inkl. Normalisierung `—`/`-`).

**2. hygiene: fehlende/formatgeänderte Eingabedateien werden still als „leer" behandelt → falsch sauberer Bericht, `--strict` kann vakuo passieren** — *medium*
Beleg: `scripts/dev/hygiene.mjs:158-160` (`readOr` → `""`), Verwendung ca. `:193-195`; zusätzlich `:64-65` (verlangt exakt `head[0]==="ID"` und Spalte `"Status"`, case-sensitiv) und `:21/:78` (exakte Überschrift „Aktive Specs").
Was falsch ist: Fehlen `STAND.md`, `docs/MASTERPLAN.md` oder `docs/ERLEDIGT.md` (oder weicht deren Format minimal ab), liefern die Checks 3 und 4 schweigend null Befunde. Der Bericht sagt „Befunde: 0", Exit 0 auch mit `--strict`, obwohl faktisch nicht geprüft wurde.
Szenario: `--root` zeigt durch Tippfehler in ein Verzeichnis ohne `STAND.md` (oder die Datei heißt nach Umbau anders): `npm run dev:hygiene -- --strict` → „keine Befunde", Exit 0 — ein darauf aufsetzender Workflow hält das Repo für sauber.
Fix: fehlende Dateien sammeln und im Bericht als eigene Sektion „Nicht geprüft (Datei fehlt)" ausweisen plus `io.err`-Warnung; bei Kern-Dateien (`STAND.md`) mit Exit 3 ablehnen. Mindestens muss `--strict` bei fehlenden Inputs nicht „sauber" sein.

**3. Stille Fallbacks bei `git rev-parse`-Fehlern verschleiern Ursachen** — *low*
Beleg: `erledigt-row.mjs:110-111`, `spec-close.mjs:89-91`, `hygiene.mjs:164-165`.
Was falsch ist: Bei `top.code !== 0` wird ohne Hinweis `process.cwd()` verwendet; stderr geht verloren.
Szenario: defektes `.git` oder Aufruf außerhalb eines Repos → Folgefehler „STAND.md fehlt"/„docs/ERLEDIGT.md fehlt" statt der echten Ursache; bei `erledigt-row --apply` wird dann relativ zum falschen cwd aufgelöst.
Fix: bei `code !== 0` mit stderr als `RefusedError` abbrechen; cwd-Fallback höchstens hinter einer expliziten Option.

**4. Schreibzugriffe nicht atomar; parallele Läufe verlieren Updates** — *low*
Beleg: `erledigt-row.mjs:124` (read→modify→write ohne Lock/tmp+rename), `spec-close.mjs:114-115` (zwei Dateien sequenziell).
Szenario: zwei Agenten lassen gleichzeitig `erledigt-row --apply` für verschiedene PRs laufen → der zweite `writeFileSync` überschreibt die Zeile des ersten; Crash zwischen den zwei Writes in `spec-close` hinterlässt Spec `historisch`, STAND-Zeile aber noch gelistet (durch Idempotenz reparierbar, fällt aber nur im git diff auf).
Fix: tmp-Datei + `renameSync`; in `spec-close` beide Writes vorbereiten, dann schreiben; beim `--hq`-Fehler auf Re-Run-Fähigkeit hinweisen.

**5. `MACHINE_BRANCH` präfix-matcht zu breit** — *low*
Beleg: `hygiene.mjs:22` (Wirkung in `:108`, `:115`).
Was falsch ist: `/^(main|HEAD|origin|…)/` schließt auch Branches wie `maintenance/…` oder `origin-x/…` still von Stale- und Branch-Checks aus.
Szenario: Branch `maintenance/w3-docs` erscheint nie in Check 2, auch nie als stale PR.
Fix: `/^(main|HEAD|origin)$|^(mergify|gh-readonly-queue)\//`.

**6. `gh pr list`-Limits schneiden schweigend ab** — *low*
Beleg: `pr-status.mjs:98` (`--limit 200`), `hygiene.mjs:176-177` (`200` open, `1000` all).
Szenario: Repo mit >1000 PRs: Check 3 findet ältere gemergte PRs nicht mehr (unterdrückte Befunde), Check 2 meldet deren Branches fälschlich als „ohne PR".
Fix: beim Erreichen des Limits Warnung im Bericht („Liste ggf. unvollständig") oder paginieren.

**7. Untracked-Dateinamen: C-Quoting wird nicht aufgelöst** — *low*
Beleg: `hygiene.mjs:179-183`.
Was falsch ist: `git status --porcelain` quotet Nicht-ASCII-Pfade (`?? "d\303\244t.txt"`); der Code streift nur die Anführungszeichen, Oktal-Escapes bleiben.
Fix: `git -c core.quotePath=false status …` (Args-Array, kein Shell-Risiko) oder echtes Unescaping.

**8. Markdown-Renderings escapen Repo-/GitHub-Daten unvollständig** — *low*
Beleg: `hygiene.mjs:148` (`p.title` roh), `pr-status.mjs` `cell()` (nur `|`, keine Newlines), Backticks in Branch-Namen (git erlaubt sie).
Szenario: PR-Titel mit `|` oder Newline zerbricht Bericht/Tabelle — rein kosmetisch, keine Ausführung, aber unsauber für ein Auswertungswerkzeug.
Fix: `\r?\n`→Leerzeichen, `|`→`\|`, Backticks maskieren (Titel, Branches, Labels).

**9. erledigt-row: `gh pr view --json files` liefert maximal 100 Dateien** — *low*
Beleg: `erledigt-row.mjs:53`.
Szenario: PR mit >100 Dateien, Report-Datei hinter dem Cutoff → Report-Spalte fälschlich „—".
Fix: bei `files.length === 100` warnen oder per `gh api .../pulls/<n>/files --paginate` nachladen; Limitation in HELPTEXT/README nennen (`--report` bleibt Workaround).

**10. spec-close verwirft den Rest der Status-Zeile** — *low*
Beleg: `spec-close.mjs:50`.
Szenario: Spec mit `Status: aktiv ( gebunden an PR #150 )` → wird zu `Status: historisch`, Suffix still gelöscht.
Fix: entweder Zeile nur akzeptieren, wenn sie exakt `Status: <Wert>` ist, oder nur den Wert ersetzen und Suffix erhalten.

**11. Testlücken** — *low*
Beleg: `scripts/lib/dev-erledigt-row.test.mjs`, `dev-hygiene.test.mjs`, `dev-spec-close.test.mjs`.
Was fehlt: gh-Fehlerpfad (Exit 3) für erledigt-row und hygiene (nur pr-status testet das); fehlende Eingabedateien (würde Befund 2 sichtbar machen); Multi-ID-/Altformat-Idempotenz (Befund 1); spec-close „nichts zu tun"-Pfad (schon historisch + nicht gelistet); Escaping-Fälle; Windows-Pfade nur indirekt über die Windows-Gate-CI. Positiv: Rot-Commit ist glaubwürdig (fehlende Module + Wiring-Test schlagen fehl), Fakes sind hermetisch, und der Read-only-Assertions-Test in hygiene ist gut.
Fix: genannte Fälle mit den vorhandenen Fake-Runnern ergänzen.

## Ausdrücklich geprüft und ohne Befund

- **Nichts Blocking gefunden.** Alle vier Helfer sind auf den Kernpfaden fail-closed (UsageError→2, RefusedError→3, `insertRow`/`closeSpec`/`removeFromStand` verweigern bei Formatabweichung statt zu schreiben), `spec-close` verifiziert nach dem Austragen gegen `listedInStand`, Tests und README decken die Exit-Codes ab.
- **Injection:** sämtliche `git`/`gh`-Aufrufe gehen als Args-Array durch den Runner; PR-Nummern sind `\d+`-validiert, `specName` lässt keine Pfadtrenner/Zeichenclasses zu (`../`-Test vorhanden), Regex-Bau aus IDs/Userdaten ist überall escaped. Keine Shell-Strings.
- **Credentials:** keine Token/Env-Ausgaben; gh-stderr nur in Fehlermeldungen.
- **AGENTS.md:** kein Commit/Push, kein `--no-verify`-Äquivalent, keine Gate-Duplikate oder Rechte-Erweiterung; hygiene führt höchstens `git fetch --prune` aus und deklariert das ehrlich in README/HELP. Dry-run-Default bei beiden schreibenden Helfern ist korrekt verdrahtet und getestet.
- **Rot→grün-Nachweis** und Real-Datei-Kontrakttests (ERLEDIGT-Spaltenzahl, MASTERPLAN-Parsing, CLI-Wiring) sind sinnvoll.

## Gesamturteil

**mergebar: ja.** Keine Blocking-Befunde. Empfohlen wird, die zwei Mediums (1: Idempotenz bei Multi-ID-Zeilen; 2: stille Leer-Behandlung fehlender Inputs in hygiene) als kleine Follow-ups zeitnah nachzuziehen — beide sind mit wenigen Zeilen plus je einem Test adressierbar und betreffen genau die Stellen, an denen die Helfer sonst „etwas Falsches schreiben" bzw. „still Erfolg melden" könnten.
