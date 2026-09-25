# Die Gates lokal fahren

Kurzfassung für Eilige:

```sh
bash scripts/ci/doctor.sh          # was kann diese Maschine belegen?
bash scripts/ci/gates.sh lane prepush   # Windows-PC: die volle lokale Bahn
bash scripts/ci/gates.sh lane linux     # in WSL2: die Linux-Hälfte
```

Mehr braucht es nicht. Der Rest dieser Datei erklärt, **warum** das der
Belegpfad ist und `act` nicht — und wo „lokal == CI" aufhört zu gelten.

---

## Warum das überhaupt gebaut wurde

Zwei Dinge fielen am 09.09. zusammen:

- **Die Rückmeldung kam zu spät.** Ein Fehler, den ein Gate findet, fiel erst
  nach dem Push auf — und kostete dann Runner-Minuten, Windows doppelt.
  *(Ursprünglich stand hier „das Actions-Kontingent ist erschöpft". Diese
  Behauptung stand seit dem 08.09. ungeprüft in `STAND.md` und ist falsch —
  Korrektur auf `main` vom 09.09.: es liefen die ganze Zeit Workflows durch,
  niemand hatte `gh run list` aufgerufen. Der Grund für lokale Gates ist
  schlichter und hält auch ohne Notlage: schneller und billiger.)*
- **Der Linux-Server ist gelöscht** (`STAND.md` §5). Damit ist der Ort weg, an
  dem die `#[cfg(unix)]`-Tests je liefen.

Dazu kam ein Befund: die Gate-Liste stand **fünffach** da — in beiden Hooks, in
`ci.yml`, in `release.yml` und als Prosa in `AGENTS.md` — und sie driftete.
`pre-push` fuhr `cargo test`, CI `cargo nextest run --profile ci`. Was lokal
grün war, war nicht das, was CI misst. „Lokal ausführen" war deshalb kein
Werkzeugproblem, sondern ein Quellenproblem.

## Die eine Quelle: `scripts/ci/gates.sh`

Die Liste liegt einmal im Skript. `ci.yml`, `release.yml`, `audit.yml` und beide
Git-Hooks rufen sie als **Bahn** auf — ein Workflow-Schritt je Bahn, keine
Gate-Liste mehr im YAML. Drift ist damit nicht *geprüft*, sondern *unmöglich*.

```sh
bash scripts/ci/gates.sh --list            # alle Gates mit Bahnen und Befehl
bash scripts/ci/gates.sh --list linux      # nur die Bahn
bash scripts/ci/gates.sh lane prepush      # ausführen
bash scripts/ci/gates.sh run lint e2e      # einzelne Gates
bash scripts/ci/gates.sh --from clippy lane linux   # nach einem Fehlschlag weiter
```

| Bahn | wer ruft sie | wofür |
|---|---|---|
| `precommit` | `.githooks/pre-commit` | fmt, cargo check, typecheck — Sekunden |
| `prepush` | `.githooks/pre-push` | die volle lokale Schleife inkl. Rust-Suite |
| `linux` | `ci.yml`, Job `gates (linux)` | alles Plattformneutrale |
| `windows` | `ci.yml`, Job `gates (windows)` | was nur Windows beantworten kann, inkl. Gate `native-tests` (baut `pa-capture-host`, führt die sieben `real_native_*`-Tests mit `--ignored` aus) |
| `release` | `release.yml` | wie `linux`, vor dem Bundle-Build |
| `audit` | `audit.yml` | `cargo audit`, `npm audit` |

Jeder Lauf beginnt mit einem Umgebungskopf (OS, node, rustc, nextest, HEAD,
dirty) und endet mit einer Tabelle plus dem Block **NICHT ABGEDECKT**. Dieser
Block gehört in den PR-Text bzw. `.pa/ACTIVITY.md`: „Vollgates grün" ohne ihn
ist nach dem Beweismaßstab (`AGENTS.md`) eine Behauptung.

## Wo „lokal == CI" aufhört

Gleich sind: **die Befehle und ihre Reihenfolge**. Das ist per Konstruktion so,
nicht per Absprache.

Nicht gleich sind:

- **Die Umgebung.** Node-Version (`package.json` verlangt ≥24), Rust-Stand,
  glibc, Chromium-Build, Last auf der Maschine. `doctor.sh` sagt es an.
- **Die Isolation.** CI startet auf einem frischen Runner; lokal liegen
  `node_modules`, `target/`, `.env` und fremde Worktrees herum. `vitest.config.ts`
  schließt die Worktrees deshalb ausdrücklich aus.
- **Die Plattformhälfte.** Auf Windows fehlen die `#[cfg(unix)]`-Tests
  (`KNOWN_ISSUES` KI-7), auf Linux die `#[cfg(windows)]`-Tests. **Kein einzelner
  Rechner deckt beides ab.** Genau das druckt der NICHT-ABGEDECKT-Block.

## Die Linux-Hälfte: WSL2, nicht Docker

Seit der Server weg ist, ist WSL2 der Linux-Belegpfad.

```powershell
wsl --install          # einmalig
```

```sh
# IN WSL, und der Clone gehört auf ext4 (~/), NICHT unter /mnt/c:
git clone <repo> ~/ProjectA && cd ~/ProjectA
bash scripts/install-hooks.sh
npm ci
npx playwright install --with-deps chromium
bash scripts/ci/gates.sh lane linux
```

**Warum nicht `/mnt/c`:** cargo ist über den Windows-Dateisystem-Durchgriff um
Faktoren langsamer, und das x-Bit geht verloren — genau die Hook-Falle, die vom
31.08. bis 07.09. dafür sorgte, dass die Git-Hooks bei niemandem liefen.
`doctor.sh` warnt, wenn der Clone dort liegt.

## `act` — was es kann und was nicht

`act` (nektos/act) fährt Workflows lokal in Docker. Es ist hier die **Kür, kein
Belegpfad**, und das ist eine Entscheidung, kein Versäumnis.

**Wofür es taugt:** die Struktur einer Workflow-Änderung prüfen, ohne eine
Actions-Minute zu verbrauchen.

```sh
act --list                     # welche Jobs sieht act?
act -n                         # Trockenlauf: parst Workflows + Composite Action
```

**Was es nicht kann — die Liste ist der Grund, warum es nicht der Belegpfad ist:**

| | |
|---|---|
| `windows-latest` | **gar nicht.** Es gibt keine Windows-Container. Die Jobs `gates (windows)` und der ganze `release`-Workflow sind für act unerreichbar. |
| `environment:` | wird ignoriert. Die Härtung von `review.yml` (und seit 09.09. `release.yml`) hinge lokal an einer Klartextdatei `.secrets` auf dem PC — **die Secret-Härtung wäre lokal ausgehebelt.** `review.yml` deshalb nie unter act fahren; `.pa/review_transport.py` ist direkt aufrufbar. |
| OIDC / WIF | `ACTIONS_ID_TOKEN_REQUEST_URL` existiert nicht. `anthropic-wif-test.yml` ist prinzipiell nicht lokal lauffähig. |
| `concurrency`, `permissions`, `timeout-minutes` | werden ignoriert — ihre Wirkung ist lokal nicht belegbar. |
| `github.event.pull_request.*` | nur mit handgeschriebener `-e event.json`. `red-first.sh` nimmt `BASE_SHA`/`HEAD_SHA` per Env; direkt aufrufen ist einfacher. |
| Tauri-Systemdeps | das `act-latest`-Image bringt kein `libwebkit2gtk-4.1-dev` mit; die Composite Action installiert sie bei **jedem** Lauf neu (~1–2 min), außer mit `--reuse`. |

Es gibt bewusst **keine `.actrc` im Repo**: sie würde suggerieren, act sei der
Belegpfad. Und `--bind` bitte nicht — es schreibt mit Container-UID in das echte
`target/`.

## Was gar nicht lokal gehört

- **`release.yml`** hält den Tauri-Signing-Key und den Mirror-PAT.
- **`review.yml`** hält den `OPENROUTER_KEY`.
- **`anthropic-wif-test.yml`** braucht ein echtes GitHub-OIDC-Token.

Der Release-*Build* selbst ist lokal machbar (`npx tauri build`,
`scripts/release.cmd`). Das anonyme Verify-Gate steht noch inline in
`release.yml`; es nach `scripts/` auszulagern ist ein offener Punkt (in dieser
Umgebung stand kein pwsh zur Verfügung, um die Auslagerung zu belegen).

## Wenn ein Gate rot ist

`gates.sh` bricht wie ein CI-Schritt beim ersten roten Gate ab, nennt den
echten Exit-Code und sagt bei den häufigen Fällen, was fehlt:

```
<<< Gate rust-suite: ROT — Exit 101 (12s)
    Hinweis: cargo-nextest fehlt. Installation:
      cargo install cargo-nextest --locked
```

Nach dem Fix nicht alles neu fahren:

```sh
bash scripts/ci/gates.sh --from rust-suite lane linux
```

**Kein Rückfall auf `cargo test`, wenn nextest fehlt.** Das misst etwas anderes
(geteilter Prozess, keine Retry-Sperre, kein slow-timeout) und wäre genau die
Drift, die dieser Umbau beseitigt hat.
