# scripts/dev — Werkzeuge für Agenten und Koordinator

Kleine Node-Helfer für wiederkehrende Git-, PR- und Plan-Handgriffe. Sie gelten
für jeden Anbieter (Claude, Codex, Kimi, OpenCode) gleich: Node 24, kein Shell-
String, externe Programme (`git`, `gh`, `powershell`) nur als Argumentliste.
Jedes Werkzeug hat `--help` und ist als `npm run dev:<name>` erreichbar;
Argumente nach `--` weitergeben, z. B. `npm run dev:ci-watch -- 123`.

Die Logik steht in `scripts/dev/<name>.mjs`, gemeinsame Bausteine in
`scripts/lib/dev-tools.mjs`. Die Selbsttests (`scripts/lib/dev-*.test.mjs`)
laufen in `npm run test:hq` ohne Netz und ohne echtes `gh`: Wegwerf-Repos in
tmp und injizierte Runner. `agent-setup-check` und `status-report` ändern
nichts am Repo oder auf GitHub; bei den SETUP-08-Werkzeugen steht in der
Tabelle, welche etwas ändern.

## Maschinencheck und Tagesbericht

| Script | Command | What it answers |
|---|---|---|
| `agent-setup-check.mjs` | `npm run dev:agent-check [-- --json]` | Is this machine ready for an agent to work on ProjectA? (`docs/setup/README.md`) |
| `status-report.mjs` | `npm run dev:status [-- --out <file>]` | What is done today, what is running, what does the user decide? |

### status-report.mjs

Reads GitHub through `gh` (open PRs with checks, PRs merged today, the latest
CI runs on `main`) and prints a short German markdown overview with three
sections and at most 25 lines:

- **Fertig** — PRs merged today (local day, `Europe/Berlin` on the user's machine).
- **Läuft** — drafts (one tally line), PRs with running checks, green PRs waiting for or sitting in the merge queue.
- **Du entscheidest** — a red `main` first, then PRs with red checks, a conflict,
  the `do-not-merge` / `dequeued` label, and one line for Dependabot PRs. A
  failed `gh` call shows up here too, never silently.

Mergify's own `mergify/merge-queue/*` PRs are plumbing and are not listed.
Longer lists are cut with "… und N weitere"; titles are shortened, the reason a
PR is listed is not.

```sh
npm run dev:status                          # to stdout
npm run dev:status -- --out .pa/STATUS.md   # to a file (parent folders are created)
```

Exit code: `0` report written, `1` `gh` could not be read completely (the report
is still written and names what is missing) or the report file could not be
written (a clean error on stderr, no crash), `2` bad arguments.

It needs `gh` on `PATH` and logged in (`gh auth status`); it makes three read
calls (`gh pr list` twice, `gh run list` once) and spends no money. The test is
`scripts/lib/dev-status-report.test.mjs`, part of `npm run test:hq`.

## Exit-Codes der SETUP-08-Werkzeuge

| Code | Bedeutung |
|---|---|
| 0 | erledigt bzw. alles grün |
| 1 | Ergebnis negativ (Push nicht belegt, CI rot, Entfernen gescheitert) oder unerwarteter Fehler |
| 2 | Aufruffehler (fehlende/unzulässige Argumente) |
| 3 | Vorbedingung nicht erfüllt, nichts geändert (schmutziger Baum, kein Slot frei, gh-Fehler bei ci-watch — Ausnahme: `prune-worktrees` fährt bei gh-Fehler nur eingeschränkt fort und endet mit 0) |
| 4 | Zeitlimit erreicht |

## Git- und PR-Helfer (SETUP-08a)

| npm-Skript | Zweck | ändert etwas? |
|---|---|---|
| `dev:report-commit` | `.pa/report_<id>.md` aus einer Datei übernehmen und allein committen (`No-Test:` + `Co-Authored-By:`); setzt vorher `docs/dev-hq/data.*` zurück, wenn nur ein Merge sie verändert hat (die verworfene Fassung wird vorher in ein Tmp-Verzeichnis gesichert und der Pfad ausgegeben); optional `--merge <ref>` davor und `--push` danach | ja (Commit); `--dry-run` nicht |
| `dev:push-verified` | `HEAD` pushen und per `git ls-remote` gegen den lokalen `HEAD` belegen, begrenzter Retry, kein Retry nach `[rejected]`; einzelne Aufrufe haben ein Zeitlimit (Push 15 min wegen der Hooks, ls-remote 2 min), ein abgelaufenes Zeitlimit zählt als gescheiterter Versuch (Exit 124 des Aufrufs) | ja (Push) |
| `dev:prune-worktrees` | fertige Worktrees unter `.claude/worktrees/` und Codex-Worktrees finden (in `origin/main` enthalten oder PR MERGED/CLOSED); entfernt nur mit `--apply` | nur mit `--apply` |
| `dev:build-slot` | freie Cargo-Slots (`~/cargo-targets/projecta-{a,b,c}`, Haupt-`target/`), freier RAM, Empfehlung für `CARGO_TARGET_DIR` | nein |
| `dev:ci-watch` | Required Checks eines PRs bis zum Abschluss verfolgen; ein PR ohne Checks gilt erst nach einer zeitbasierten Karenz (3 min) als „bekommt keine CI", weil GitHub Required Checks bei Rulesets verzögert registriert | nein |

### Sicherheitsregeln, die die Werkzeuge selbst einhalten

- **Kein `--no-verify`, kein `--force`.** Commits und Pushes laufen durch die
  normalen Hooks (pre-commit, pre-push). Ein Bericht-Commit dauert deshalb so
  lange wie die precommit-Bahn.
- **Push-Beleg ist `ls-remote`, nicht der Exit-Code von `git push`.** Alle
  Helfer laufen mit `GIT_TERMINAL_PROMPT=0` und `GCM_INTERACTIVE=never` — kein
  Credential-Helper und kein Terminal-Prompt kann einen Lauf blockieren.
- **`report-commit --merge` verlangt einen komplett sauberen Baum** (auch
  keine ungetrackten Dateien) und lehnt VOR dem Merge ab — „abgelehnt =
  nichts geändert" gilt ausnahmslos.
- **`report-commit` setzt HQ-Daten nur zurück, wenn der Merge die einzige
  Ursache sein kann:** `data.*` geändert, aber nicht gestaged, keine andere
  Datei geändert, und die letzte HEAD-Bewegung war ein Merge (oder
  `--merge` lief eben auf einem sauberen Baum). Sonst: Abbruch mit Exit 3.
- **`prune-worktrees` fasst nie an:** Worktrees mit uncommitteten Änderungen,
  mit Commits auf keinem Remote-Branch, mit ignorierten Dateien außerhalb der
  Build-Artefakt-Allowlist (`node_modules`, `target`, `dist` — eine `.env`
  oder lokale Notiz hält den Worktree am Leben), gesperrte
  (`git worktree lock`, so markiert Claude Code laufende Agenten), das
  aktuelle Verzeichnis und alles, was jünger als `--min-idle` (Standard 12 h)
  aktiv war. Entfernt wird mit `git worktree remove` ohne `--force`; Branches
  löscht es nicht.
- **`build-slot` setzt nie `CARGO_PROFILE_*`.** „Belegt" heißt: ein
  cargo/rustc-Prozess (auch `cargo-clippy`, `build-script-build`; unter Linux
  auch der auf 15 Zeichen gekürzte `comm`-Name) nennt den Slot in seiner
  Kommandozeile. Zusätzlich gilt die Frische von `.cargo-lock`/`deps`/
  `.fingerprint` (jünger als 2 min, Profile `debug` und `release`) immer als
  zweites Signal — auch wenn eine Prozessliste vorliegt, denn zwischen zwei
  rustc-Aufrufen (Dep-Auflösung, Linken) nennt kein Prozess den Slot.
  cargo-Prozesse ohne Slot in der Kommandozeile zählen konservativ in die
  Höchstzahl paralleler Builds ein. Der RAM kommt aus `os.freemem()`, es wird
  also keine lokalisierte Zahl („3,25") geparst. `PA_BUILD_SLOTS="pfad;pfad"`
  ersetzt die Slotliste.

## Plan- und Spec-Helfer (SETUP-08b)

| npm-Skript | Zweck | ändert etwas? |
|---|---|---|
| `dev:pr-status` | offene PRs als Kompakttabelle: Draft, Queue-Zustand (in Queue / bereit / wartet auf CI / rot / Konflikt / gesperrt / Draft), Labels, die drei Required Checks | nein |
| `dev:erledigt-row` | aus PR-Nummer und Paket-ID die `docs/ERLEDIGT.md`-Zeile bauen (Datum = `mergedAt` UTC, 7-stelliger Merge-SHA, vom PR berührte `.pa/report_*.md`) und oben einfügen; idempotent, nur für gemergte PRs | nur mit `--apply` |
| `dev:spec-close` | `.pa/task_<id>.md` auf `Status: historisch` setzen und die Zeile unter „Aktive Specs“ in `STAND.md` entfernen; danach `npm run hq` (oder `--hq`) | nur mit `--apply` |
| `dev:hygiene` | read-only Bericht als Markdown: offene PRs > 24 h ohne Aktivität, Remote-Branches ohne PR, aktive Specs zu gemergten PRs, Pakete „in Arbeit“ (Spalte „Stand“ = `PR #n` in den Meilenstein-Tabellen von `docs/PLAN.md`) ohne offenen PR, ungetrackte Dateien im Hauptcheckout; `--strict` → Exit 1 bei Befunden | nein (nur `git fetch --prune`, abschaltbar mit `--no-fetch`) |

`docs/PLAN.md`, `STAND.md` und `ERLEDIGT.md` schreibt nur der
Koordinator; `erledigt-row` und `spec-close` sind seine Werkzeuge dafür.
Die Paket-Zuordnung in `hygiene` vergleicht IDs mit Branch-Namen
(`…/w1-22-…`) und PR-Titeln als ganzes Wort (W1-22 trifft nie W1-22b) —
Befunde sind Hinweise zum Prüfen, keine Urteile.

Verhalten an den Rändern (Review SETUP-08b):

- `erledigt-row` erkennt „schon vorhanden“ an der PR-Nummer in jeder Linkform
  und an der ID auch in Mehrfach-Zellen (`W1-05, W1-06`); `--title ""` ist ein
  Aufruffehler; liefert `gh` genau 100 Dateien, warnt der Helfer, dass die
  Report-Spalte unvollständig sein kann (`--report` setzen). Den Pfad der
  Zieldatei löst er erst mit `--apply` auf; ein scheiterndes
  `git rev-parse --show-toplevel` ist Exit 3, kein stiller Fallback aufs cwd.
- `spec-close` akzeptiert nur `Status: <ein Wort>` und verweigert eine Zeile
  mit Zusatz, statt ihn zu verwerfen. Beide Schreiber lesen, ändern und
  schreiben ohne Sperre: parallele Läufe gegen dieselbe Datei sind nicht
  vorgesehen (der Koordinator führt sie nacheinander aus; jede Änderung
  steht im `git diff`).
- `hygiene` bricht mit Exit 3 ab, wenn `git fetch --prune origin` scheitert
  (`--no-fetch` wertet dann bewusst nur den lokalen Stand aus). Fehlende oder
  nicht mehr lesbare Eingaben (`STAND.md`, `docs/PLAN.md`,
  `docs/ERLEDIGT.md`) und `gh`-Listen am Limit stehen unter „Nicht geprüft“
  und zählen für `--strict` als Befund — ein leerer Bericht heißt „geprüft und
  sauber“, nie „nicht geprüft“.
- `pr-status.mjs` führt die drei Required Checks als Liste; ein Test vergleicht
  sie mit `.mergify.yml` (`check-success`) und den Job-Namen in `ci.yml`.

### Beispiele

```sh
npm run dev:pr-status
npm run dev:erledigt-row -- 106 W2-07          # Probelauf, zeigt die Zeile
npm run dev:spec-close -- w1-22 --apply --hq
npm run dev:hygiene -- --strict
npm run dev:build-slot
npm run dev:report-commit -- --id w2-07 --from /tmp/report.md --co-author "Claude Opus 5.5 <noreply@anthropic.com>" --dry-run
npm run dev:push-verified -- --branch claude/w2-07-credential-acl
npm run dev:ci-watch -- 123 --timeout 45m
npm run dev:prune-worktrees            # Probelauf
npm run dev:prune-worktrees -- --apply
```
