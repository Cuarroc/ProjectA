# Mergify — die Merge-Queue für `main`

Seit 24.09.2026 (PR #108, Paket CI-01) wird `main` nur noch über die
Mergify-Merge-Queue gemergt. Quelle der Wahrheit ist `.mergify.yml`; die
Kurzfassung steht in `AGENTS.md` („Merging"). Diese Seite ist die Langfassung
für den Alltag. Zurück zur Übersicht: [README.md](README.md).

## Wie die Queue arbeitet

- **Branch-Schutz:** Pflicht-Checks `gates (linux)`, `gates (windows)`,
  `red-first`; „strict up-to-date" ist **aus**.
- **Aufnahmefähig** ist jeder PR auf `main`, der kein Draft ist, keinen
  Konflikt hat, kein `do-not-merge` trägt, das Label `review-ok` trägt und
  dessen drei Checks grün sind.
- **`review-ok` ist Pflicht** (CI-HARDEN-02, fail-closed): Das Label setzt die
  Orchestrator-Pipeline erst, wenn die Review-Entscheidung vollständig ist und
  kein High-Befund offen steht. Reviewer reihen nie selbst ein. Wer das Label
  entfernt (oder `do-not-merge` setzt), nimmt den PR aus der Queue. Keine
  Ausnahme für Paket-, Doku-/Infra- oder Dependabot-Branches. In
  `.mergify.yml` steht es in `queue_conditions` und
  `auto_merge_conditions` (`ci-shape` prüft beides).
- **Einreihen ist ein eigener Schritt** (beobachtet 04.10.2026): Aufnahmefähige
  PRs kamen nicht von selbst in die Queue. Die letzten 14 gemergten PRs
  (#240–#266) und die offenen #274/#275 tragen je einen Kommentar
  `@Mergifyio queue` (bzw. `requeue`) vom Koordinator. Ablauf:
  `gh pr checks <n>` prüfen; sind alle Pflicht-Checks grün, kommentiert der
  Koordinator `@Mergifyio queue` auf dem PR
  (`gh pr comment <n> --body "@Mergifyio queue"`). Warum die automatische
  Aufnahme nicht greift, ist **ungeklärt** — es gibt nur Hypothesen, keinen
  Beleg. Der Queue-Lauf auf `main` wird weiterhin von Mergify geprüft.
- Die Queue (`mode: serial`, Bündel bis zu vier PRs) testet die
  Kandidaten gegen den aktuellen `main` und merged mit Merge-Commit — die
  Test-First-Commits bleiben in der Historie sichtbar.
- **`main` nicht hineinmergen, nur um aufzufrischen** (das waren 39 % aller
  CI-Läufe). `main` nur hineinmergen, um einen echten Konflikt zu lösen —
  **mergen, nicht rebasen, kein Force-Push**.
- **`gates (windows)`** fährt seine Lane auf einem normalen PR nie (CI-03):
  Der Job meldet dort nach ~1 Linux-Minute Erfolg und nennt im Log die
  geänderten Windows-Eingaben (`scripts/ci/lane-plan.sh`). Voll läuft Windows
  in der Queue, im Wochenlauf und per Handstart (`workflow_dispatch`, auch
  auf dem eigenen Branch). Ein Windows-Fehler fällt also erst in der Queue
  auf und wirft den PR dort hinaus.
- **`red-first`** läuft als Schritte im Job `gates (linux)`; der Job
  `red-first` meldet nur deren Ergebnis (Details im Linux-Job).
- **Bündel:** Die Queue testet bis zu zwei Bündel gleichzeitig
  (`max_parallel_checks: 2`, seit CI-QUEUE-02); warten mehr PRs, laufen sie
  gemeinsam (bis zu vier je Bündel).

## Arbeitsweise im Paket

- **Ein PR je Paket, erst am Ende.** Im eigenen Worktree arbeiten,
  `bash scripts/ci/gates.sh lane prepush` lokal fahren, dann einmal pushen und
  den PR öffnen. Jeder Push auf einen offenen, fertigen PR kostet einen CI-Lauf
  (Linux; die Windows-Lane läuft erst in der Queue).
- **Draft = nicht fertig.** Draft-PRs bekommen keine CI und kommen nicht in die
  Queue. Als Draft öffnen, solange Bericht, Review-Disposition oder der
  `NICHT ABGEDECKT`-Block fehlen; dann `gh pr ready <n>`.

- **Früher Windows-Befund vor `review-ok`.** Berührt der Branch Windows-Code
  (`#[cfg(windows)]`), eine der vier Nahtstellen, PTY-/Process-Capture-Code oder
  Windows-Skripte, fährt `bash scripts/ci/win-signal.sh <branch>` (Branch ist
  gepusht) den `ci`-Workflow per Handstart auf dem Branch, wartet und druckt
  Run-ID und Ergebnis (Exit 0 nur bei `success`). `--dry-run` zeigt nur die
  Entscheidung. So fällt ein Windows-Fehler vor der Queue auf, nicht in ihr.

## Labels

| Label | Wer setzt es | Wirkung |
|---|---|---|
| `do-not-merge` | jeder | hält einen grünen PR aus der Queue („Nutzer soll erst draufsehen") |
| `priority` | nur der Koordinator | reiht vorn ein (ebenso ein Branch `hotfix/…`) |
| `conflict` | Mergify (setzt und entfernt es selbst) | PR merged nicht sauber mit `main` — `main` hineinmergen, Konflikt lösen, pushen |
| `review-ok` | nur die Orchestrator-Pipeline | Voraussetzung fürs Einreihen (siehe oben) |
| `queued` | Mergify | PR steht in der Queue |

Setzen/Entfernen: `gh pr edit <n> --add-label do-not-merge`,
`gh pr edit <n> --remove-label do-not-merge`.

> **Stand 24.09.2026:** Die Labels `do-not-merge` und `priority` sind im Repo
> noch **nicht angelegt** (`gh label list`); `gh pr edit --add-label`
> scheitert dann. Einmalig anlegen (Nutzer oder Koordinator):
> `gh label create do-not-merge` und `gh label create priority`.

## Berichtsschutz

Die Merge-Protection „Paket-PR bringt seinen Bericht mit" greift auf
**Paket-Branches**: Name passt auf
`^(claude|codex|kimi|opencode|glm)/(w<N>-|df<N>|ki-<N>|hq2-)` (ohne
Groß-/Kleinschreibung), z. B. `claude/w2-07-credential-acl`. Ein solcher PR
muss im PR-Text einen Abschnitt tragen, der mit `## Report` beginnt
(Vorlage: `.github/pull_request_template.md`), sonst bleibt der Check
`Mergify Merge Protections` rot. Eine Berichtsdatei in `.pa/` ist seit
25.09.2026 nicht mehr Pflicht: der PR-Text ist der Bericht. Einen Übergang
gibt es nicht: eine `.pa/report_*.md` erfüllt die Regel nicht mehr, ein offener
Paket-PR muss den Abschnitt im PR-Text tragen.
Doku-/Infra-Branches (`claude/masterplan`,
`claude/ci-01-…`, `claude/setup-a-…`) sind keine Pakete. Die
Review-Disposition prüft Mergify **nicht** — sie gehört nach `AGENTS.md`
(Regel 5, Stufen A/B) in denselben PR-Text.

## Freeze, Retry

- **Freeze** nur manuell, nur für ein Release, nur durch den Nutzer
  (Mergify-Dashboard). `.mergify.yml` konfiguriert keinen Freeze.
- **Automatische Wiederholung** flakiger Jobs ist in `.mergify.yml` nicht
  konfiguriert. Ein roter Lauf bleibt rot: erst untersuchen (bekannte Flakes:
  `STAND.md`, `KNOWN_ISSUES.md`), dann neu anstoßen.

## Nach dem Merge

Der Branch wird automatisch gelöscht — das ist die GitHub-Repo-Einstellung
„Automatically delete head branches" (`delete_branch_on_merge: true` laut
`gh api repos/Cuarroc/ProjectA`), nicht `.mergify.yml`. Der
Koordinator trägt das Paket in `docs/ERLEDIGT.md` ein, entfernt den Worktree
und setzt die Spec auf `historisch`. Einen gemergten Branchnamen nicht
wiederverwenden. Wer `main` in seinen Worktree gemergt hat, setzt die
generierten Snapshots zurück:
`git checkout -- docs/dev-hq/data.js docs/dev-hq/data.json`.

## Hand-Merge

Regelfall: `main` wird über die Queue gemergt. **Notfall-Ausnahme**
(Nutzerentscheidung 24.09.2026): Hängt die Queue oder fällt Mergify aus, darf
der Koordinator fertige PRs weiter von Hand mergen (`gh pr merge --merge`,
Merge-Commit wie die Queue). Sonst mergt niemand von Hand. Die Ausnahme
kommt mit SETUP-04 auch in `AGENTS.md` („Merging"). Ob `gh pr merge` für alle
übrigen Claude-Sitzungen per Deny-Regel gesperrt wird, entscheidet der Nutzer:
siehe [permissions-proposal.md](permissions-proposal.md).

## Warum steht mein PR nicht in der Queue?

1. Er ist ein Draft → `gh pr ready <n>`.
2. Er trägt `do-not-merge`.
3. Ein Pflicht-Check ist rot oder fehlt (`gh pr checks <n>`).
4. Paket-Branch ohne `## Report` im PR-Text → `Mergify Merge Protections` rot
   (PR-Text ergänzen genügt, kein neuer Push nötig).
5. Er trägt `conflict` → `main` hineinmergen, Konflikt lösen, pushen.
6. Die Queue ist eingefroren (Release) — warten.
7. Niemand hat `@Mergifyio queue` kommentiert — siehe „Einreihen ist ein
   eigener Schritt" oben.
