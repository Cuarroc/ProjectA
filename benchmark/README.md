# F8 Konkurrenz-Benchmark — Benchmark-Ordner (KB-1)

Stand: 09.09.2026. Umsetzung der Scheibe **KB-1** aus
`.pa/report_benchmark_design_2026-09-09.md` (F8-Design). Dieser Ordner enthält
alles Eingefrorene: Scratch-Repo, Basis-SHAs, Prompts, Akzeptanzkriterien,
Protokollschablonen, Preisblatt-Gerüst. Installation der Gegner (Emdash,
kandev) und Trockenläufe sind **KB-2** und hier bewusst nicht enthalten.

## Verzeichnis

| Pfad | Inhalt |
|---|---|
| `build-scratch-repo.sh` | baut `scratch-repo/` deterministisch (Git Bash) |
| `scratch-repo/` | das gebaute Scratch-Repo (eigenes git-Repo, lokale Commits sind Teil des Aufbaus) |
| `prompts/` | die eingefrorenen, wortgleichen Prompt-Dateien T1–T5 |
| `protokolle/` | ausfüllbare Schablonen: Gegner-Lauf (manuell), ProjectA-Lauf (Telemetrie) |
| `preise.yaml` | Preisblatt-Gerüst, vorbefüllt mit offiziellen Preisen vom 09.09.2026 |

## Eingefrorene Werte

Git-Identität (alle Commits): `F8 Benchmark <f8-bench@example.test>`,
Commit-Zeiten fix (`2026-09-09T09:00/09:05Z`, Referenzauflösung 09:10/09:15Z).
Dadurch landet jeder Neuaufbau auf denselben SHAs.

| Name | Wert |
|---|---|
| `B0` (Basis aller Tasks, = `main` nach Aufbau) | `4f7bfeacd1b42c3ca336f05ceaeff7389b1a7c23` |
| `B1` (Base-Move für T3, Branch `base-move`, Tag `B1`) | `ad2eee59e14cc4624bda8c69258db4f0ce98026e` |
| `T3_TREE` (erwarteter Tree-OID nach deterministischer T3-Auflösung) | `7102dc781e99bd1b3e005708a3d274eb476d1ae9` |

Endzustand nach Aufbau: `main` = `B0`, Branch `base-move` = `B1`, Tags `B0`/`B1`.
Das Scratch-Repo ist absichtlich **rot** auf `B0` (T1-Basis: `sub` vertauscht
die Operanden, `npm test` exit 1 — belegt beim Aufbau).

### Prompt-Hashes (SHA256, LF-Zeilenenden)

| Datei | SHA256 |
|---|---|
| `prompts/t1-bugfix.md` | `4703e843e9a926de150b8d2440f036143ec8a3970d2a7966ab401e6058090f82` |
| `prompts/t2-feature.md` | `98abf3fe469d16b156d9e2231d06bec8c8eb5eab560f480b330b1876bd123171` |
| `prompts/t3-konflikt.md` | `91de704b9a67531ed072e418b958be88f0160da6d99e584d3f3d35cdf4a14c6b` |
| `prompts/t4-aenderungsgesuch.md` | `46fd1b745c3c820df39b9db97b57e4364bfaa98f7d06d83eaacaef2419f1f267` |
| `prompts/t4-review-feedback-runde-1.md` | `5a726f753fb269ae86b41476622ffbe413f999d51843c8ea06f5b94853c9f3d1` |
| `prompts/t5-provider-fehler.md` | `90b41119bd377e43e569cf025e7cfc54fc8479b5a4efc5fa12c07a25a418f7b2` |

Nachprüfung: `cd benchmark && sha256sum prompts/*.md`. Achtung: Hashes gelten
für LF-Bytes; bei Checkout mit `core.autocrlf=true` vor dem Hashen die Dateien
als LF lesen.

## Task-Set (Design §2, hier operationalisiert)

Alle Tasks basieren auf `B0`. Nenner-Regel (Design): „akzeptiert" = Merge-Commit
auf main im Scratch-Repo; „verworfen" = beendet/archiviert ohne Merge. n = 3
je Task je Seite.

| # | Task | Prompt-Datei | Akzeptanzkriterium (maschinell prüfbar) |
|---|---|---|---|
| T1 | Bugfix: roten Test grün machen | `prompts/t1-bugfix.md` | `npm test` exit 0 **und** `git diff --name-only B0` enthält nur `src/calc.js` |
| T2 | Feature: `mul` + Test | `prompts/t2-feature.md` | `npm test` läuft (der vorhandene `sub`-Test bleibt absichtlich rot → Kriterium: der neue `mul`-Test grün, kein anderer Test verändert) **und** `node --input-type=module -e "import {mul} from './src/calc.js'; if (mul(6,7)!==42 \|\| mul(-2,3)!==-6) process.exit(1)"` exit 0 **und** Diff berührt nur `src/calc.js` + `test/calc.test.js` |
| T3 | Konflikt nach Base-Move | `prompts/t3-konflikt.md` | Konflikt sichtbar (`git merge-tree --write-tree main <worker-branch>` meldet CONFLICT auf `BENCH.txt`), aufgelöst, finaler `git rev-parse main^{tree}` == `T3_TREE` |
| T4 | Änderungsgesuch, 2 Runden | `prompts/t4-aenderungsgesuch.md` + `prompts/t4-review-feedback-runde-1.md` | zwei Evidence-Sets (Ablehnung Runde 1 mit festem Feedback-Text, Freigabe Runde 2); Merge-Commit erst nach der zweiten Freigabe; `npm test` grün mit den vier Grenzfall-Tests |
| T5 (optional) | simulierter Provider-Fehler | `prompts/t5-provider-fehler.md` | Task endet gemergt ODER sauber verworfen; Klassifikation + Abbruch-/Retry-Zeitpunkte protokolliert; bei Merge: `npm test` grün mit `inc`-Test |

### T3-Harness-Ablauf (nicht Teil des Agenten-Prompts)

1. Agent spawnen auf Basis `B0`, Prompt `t3-konflikt.md`.
2. Sofort nach Spawn main bewegen: `git -C benchmark/scratch-repo checkout main && git merge --ff-only B1`.
3. Agent liefert (Worker-Branch trägt die eine neue Zeile).
4. Konflikt nachweisen: `git merge-tree --write-tree main <worker-branch>` → CONFLICT (add/add) auf `BENCH.txt`.
5. Auflösung nach fester Regel: `BENCH.txt` enthält am Ende **zuerst** die
   Zeile `base-move: main advanced here`, **danach** `task3: worker line`
   (Referenz-Dateiinhalt steht in `build-scratch-repo.sh`). Merge, dann
   `git rev-parse 'main^{tree}'` muss `T3_TREE` ergeben.

### T5-Harness-Ablauf (Zeit-Abbruch, §8-Entscheidung)

90 Sekunden nach Spawn wird der Agenten-Prozess hart beendet (simulierter
Provider-Fehler), Klassifikation „verworfen / provider-fehler simuliert"
ins Protokoll. Danach genau **ein** Neustart desselben Tasks mit demselben
Prompt; beide Teilläufe zählen in die Token-/Kostenrechnung des Tasks.

## §8-Entscheidungen (vor KB-1 gefällt, begründet)

1. **Agenten-CLI: Claude Code als Vorgabe, Codex CLI als Reserve.**
   Begründung: das Design nennt Claude Code als Vorschlag, weil ProjectA,
   Emdash und kandev ihn unterstützen; eine andere Wahl kann KB-1 nicht
   vorab beweisen, weil der Trockenlauf (KB-2) dafür vorgesehen ist.
   Festgeschrieben wird die finale Wahl vor Lauf 1 im KB-2-Trockenlauf T1;
   bei Scheitern von Claude Code auf einer der drei Seiten gilt Codex CLI.
   Das Preisblatt führt daher beide Provider (Anthropic + OpenAI-Codex).
2. **T5 bleibt im Set als optionale Zeit-Abbruch-Variante** (harter Kill nach
   90 s, ein Retry, Klassifikationspflicht). Begründung: ein echter
   Provider-Fehler ist auf der Gegenseite nicht deterministisch
   herstellbar (Design §2 nennt genau diesen Fallback); Streichen würde die
   Verwurf-/Retry-Kostenmessung verlieren, die §4.5 explizit verlangt.
3. **Attribution per Zeitkorrelation akzeptiert, KB-3 wartet nicht auf
   F6.** Begründung: das Design erlaubt diesen Pfad ausdrücklich
   („akzeptiert mit Unsicherheits-Vermerk"); die Unsicherheit wird in
   `protokolle/protokoll-projecta-lauf.md` als Pflichtfeld geführt
   (Unsicherheit ± mit Begründung), statt sie wegzurechnen.

## Fairness (Kurzfassung, verbindlich ist Design §5)

- Eine Maschine, keine Parallel-Benchmarks, gleiche Netz-Anbindung.
- Prompts wörtlich aus den eingefrorenen Dateien (Hashes oben).
- Dieselbe Agenten-CLI und Modellversion auf beiden Seiten; Modell-Update
  mitten im Benchmark = kompletter Neustart des Task-Sets.
- Abbruchkriterien §5.4, Review-Strenge §5.5, Ungültigkeits-Regeln §5.6,
  kein Cherry-Picking §5.7.

## Reproduzierbarkeits-Beleg (KB-1-Abnahme)

Zwei Läufe von `bash benchmark/build-scratch-repo.sh` am 09.09.2026,
Ausgaben wörtlich:

Lauf 1 und Lauf 2 jeweils:

```
B0=4f7bfeacd1b42c3ca336f05ceaeff7389b1a7c23
B1=ad2eee59e14cc4624bda8c69258db4f0ce98026e
T3_TREE=7102dc781e99bd1b3e005708a3d274eb476d1ae9
--- git log --all --oneline ---
ad2eee5 B1: base-move (main advances, collides with task3)
4f7bfea B0: benchmark base (T1 red test planted)
--- refs ---
ad2eee59e14cc4624bda8c69258db4f0ce98026e refs/heads/base-move
4f7bfeacd1b42c3ca336f05ceaeff7389b1a7c23 refs/heads/main
4f7bfeacd1b42c3ca336f05ceaeff7389b1a7c23 refs/tags/B0
ad2eee59e14cc4624bda8c69258db4f0ce98026e refs/tags/B1
```

Identisch in beiden Läufen. Zusatzbelege am aufgebauten Repo: `npm test` auf
`B0` exit 1 (T1-Basis rot, `sub`-Test: actual `-6`, expected `6`);
`git merge-tree --write-tree <t3-simuliert> B1` meldet CONFLICT auf
`BENCH.txt` (T3-Mechanik real).

## Hinweise

- `scratch-repo/` ist ein eigenes git-Repo innerhalb des ProjectA-Repos und
  taucht im Haupt-`git status` als untracked auf. Das ist gewollt; im
  Haupt-Repo wird nichts committet (KB-1-Regel).
- Aufnahme in die Haupt-`.gitignore` ist dem Menschen überlassen (KB-1 durfte
  keine bestehenden Projektdateien anfassen).

## KB-2-Verfügbarkeits-Vorprüfung (09.09.2026, recherchiert ohne Installation)

- **Emdash** (primärer Gegner): bestätigt aktuell und klassengenau — v1 stable
  seit 2026-04-24 für macOS/**Windows**/Linux ([emdash.sh/blog/emdash-v1-stable](https://www.emdash.sh/blog/emdash-v1-stable)),
  Open Source (Apache-2.0), Electron, 23+ CLI-Provider inkl. Claude Code/Codex/
  OpenCode, Diff-Review + PR-Erstellung ([github.com/generalaction/emdash](https://github.com/generalaction/emdash)).
  Windows-Installer über die Release-Seite beim KB-2-Setup beziehen.
- **kandev** (sekundär): bestätigt — Tauri-Desktop-ADE, parallele CLI-Agenten in
  isolierten Worktrees, anpassbare Agent-Profile/Runtimes/Prompts
  ([github.com/kdlbs/kandev](https://github.com/kdlbs/kandev), [kandev.ai/docs](https://kandev.ai/docs/use-kandev)).
  Einzige Tauri-Stack-Verwandtschaft im Feld, wie das Design annahm.
- Beide damit für KB-2 installierbar; die eigentliche Installation und der
  Trockenlauf T1 bleiben KB-2 (Mensch/PC, keine Installation ohne Freigabe).
