# Dual-Review vor dem Merge: PR #39 (CI-Umbau) in ProjectA — Teil B von 3

**Teil B: Die Workflows und die Detektoren, die sie pruefen.**

Der Diff ist auf drei Auftraege aufgeteilt, weil ein Lauf am 09.09. an der
Prompt-Groesse gescheitert sein koennte (unbelegt, siehe unten). Du bekommst
alle drei Teile nacheinander; urteile in JEDEM Teil nur ueber den Diff, der
dir darin gezeigt wird, und sage im Abschnitt "NICHT PRUEFBAR OHNE REPO",
wenn dir fuer einen Befund ein anderer Teil fehlt.

Du bist einer von drei unabhaengigen externen Reviewern (keiner von euch ist ein
Anthropic-Modell). Ihr seht denselben Text, aber ihr arbeitet **nicht** zusammen.

## Worum es geht

ProjectA ist eine Tauri-2-Desktop-App ("agentischer Terminal"): Rust-Kern
(~56.000 Zeilen, 41 Module, **kein `lib.rs`** — alle Tests liegen inline im
`mod tests` ihres Moduls), React/TypeScript-Frontend, Windows-first, Linux als
Zweitplattform. Gebaut wird sie von einer Flotte von KI-Instanzen (Claude,
Codex, Kimi, OpenCode), die parallel am selben Repo arbeiten.

Der folgende Diff soll **nach `main` gemergt werden**. `AGENTS.md`
("Dual-Review-Regel") verlangt fuer Diffs ueber 300 Zeilen ein Review durch zwei
andere KIs vor dem Merge. Das bist du. Der Autor ist Claude Opus 5; ein erster
Advisor (Fable 5.1) hat vorab beraten, seine Befunde stecken bereits im Diff.

**Deine Aufgabe ist nicht, den Diff zu loben. Deine Aufgabe ist, Gruende zu
finden, ihn NICHT zu mergen.**

## Hausregeln, gegen die du pruefen sollst

Diese Regeln stehen in `AGENTS.md` und sind hier Pruefmassstab, nicht Deko:

1. **"Gruen durch Abwesenheit" ist verboten.** Ein Gate, das durchlaeuft, weil es
   nichts findet oder nichts ausfuehrt, ist schlimmer als keins.
2. **"Eine Pruefung, die nicht scheitern kann, prueft nichts."** Jedes Gate
   braucht einen Selbsttest, der es einmal absichtlich scheitern laesst.
3. **Exit-Codes duerfen nie maskiert werden.** GitHub startet `run:` ohne
   `pipefail`; der Status einer Pipe ist der ihres letzten Glieds.
4. **Keine Retries.** "Ein Test, der beim zweiten Versuch gruen wird, ist kaputt
   und nicht gruen."
5. **Bug -> Regel:** jeder Fix prueft, ob die Fehlerklasse per Lint/Gate/Hook
   verhinderbar gewesen waere.

## Was der Autor behauptet

1. **Die Gate-Liste stand fuenffach da und driftete.** In `.githooks/pre-commit`,
   `.githooks/pre-push`, `ci.yml`, `release.yml` und als Prosa in `AGENTS.md`.
   `pre-push` fuhr `cargo test`, CI `cargo nextest run --profile ci` — geteilter
   Prozess statt Prozess pro Test, keine Retry-Sperre, kein slow-timeout. Jetzt
   haelt `scripts/ci/gates.sh` die Liste einmal; alle Aufrufer starten eine
   **Bahn** daraus. Ein Workflow-Schritt je Bahn, also keine Liste mehr im YAML.
2. **Zwei Gates liefen nirgends:** `npm run test:hq` (12 `node:test`-Dateien) und
   die Selbsttests der Workflow-Gates — auf die sich der Kommentar in `ci.yml`
   zur Begruendung berief, ohne sie je auszufuehren.
3. **`release.yml` war die schwaechste Gate-Liste im Repo** — der Workflow, der
   die signierten Installer baut: kein `lint`, kein `test:e2e`, kein
   `no-masked-output`, `cargo test` statt nextest. Faehrt jetzt dieselbe Bahn.
4. **`red-first` haette luegen koennen.** Der Job baut Merge-Base und Kopf als
   getrennte Worktrees. Ein Optimierungsversuch setzte ein GETEILTES
   `CARGO_TARGET_DIR`; beim Wurzelpaket geht der Paketpfad nicht in cargos
   `-C metadata`-Hash ein, also bekamen beide Baeume denselben Artefaktnamen.
   Gemessen: der Kopf-Lauf meldete `Finished in 0.02s` und fuehrte das Binary der
   Merge-Base aus (Backtrace auf `.../base/src-tauri/src/main.rs`) — der Test war
   "am Kopf rot", obwohl der Code gruen ist. `red-first.sh` setzt das Verzeichnis
   jetzt je Baum selbst und **ueberschreibt einen von aussen gesetzten Wert**.
5. **`test:hq` machte den Arbeitsbaum dreckig.** Zwei Tests starten `hq-live.mjs`
   mit dem Repo als cwd; der Server regenerierte beim Start
   `docs/dev-hq/data.{js,json}` im echten Baum. Behoben ueber `HQ_SKIP_SNAPSHOT`,
   dazu ein Waechter in `gates.sh`, der die Bahn rot faerbt, wenn ein Gate eine
   getrackte Datei anfasst.
6. **`defaults: run: shell: bash`** in allen fuenf Workflows (erzwingt pipefail),
   **25 Actions auf Commit-SHA gepinnt** (`dtolnay/rust-toolchain@stable` war ein
   BRANCH, `taiki-e/install-action@nextest` ein wandernder Tag), **`retries: 0`**
   im Browser-Smoke, **`environment: release`**, eine **Composite Action** gegen
   die doppelte Bootstrap-Kopie, und **`red-first.sh --plan`** (erst nachsehen,
   dann Toolchain installieren).

7. **Nach dem Merge von `main` (21.09., 187 Commits):** zwei Semantik-Konflikte,
   die git nicht sehen konnte, sind im Merge-Commit mit behoben.
   (a) `main` legte am 12.09. den Schritt `Gate - native
   Parent-Host-Prozessgrenze` als **PowerShell** in den Windows-Job. Dieser
   Branch zwingt seit dem 09.09. jeden `run:`-Schritt per
   `defaults: run: shell: bash` auf bash — auch auf `windows-latest`. Der
   Schritt traegt jetzt `shell: pwsh`, und `workflow-shell.sh` erkennt die
   Klasse (PowerShell-Marker in einem run-Schritt ohne eigenes `shell:`).
   (b) `npm run test:hq:visual` (ebenfalls neu von `main`) startete hq-live
   ohne `HQ_SKIP_SNAPSHOT` und schrieb `docs/dev-hq/data.{js,json}` im echten
   Baum neu — gefunden vom Arbeitsbaum-Waechter, als das Gate zum ersten Mal
   in einer Bahn lief.
8. **`.pa/review_transport.py`** — das Werkzeug, mit dem DU gerade befragt
   wirst — starb am 09.09. an einer Antwort mit `content: null`
   (`AttributeError`) und schrieb daraufhin fuer KEINEN Reviewer ein
   Protokoll, auch nicht fuer den, der geantwortet hatte. Beim Schreiben des
   Selbsttests kam heraus, dass eine Antwort aus Leerzeichen mit **Exit 0**
   durchlief, also als gueltiges Review galt. Beides behoben, 24 Faelle in
   `scripts/test-review-transport.sh`.

## Worauf du besonders achten sollst

- **`scripts/ci/gates.sh` ist jetzt der Single Point of Failure der gesamten
  Qualitaetssicherung.** Kann er stillschweigend nichts tun? Kann eine Bahn leer
  sein? Wird ein rotes Gate immer nach aussen gemeldet? Was passiert bei einem
  Gate-Befehl mit Sonderzeichen — die Liste wird mit `cut -d'|'` zerlegt und mit
  `eval` ausgefuehrt.
- **Der `--plan`-Kurzschluss in `red-first.sh`.** Er entscheidet, ob das Bootstrap
  laeuft. Gibt es einen Weg, bei dem `count=0` herauskommt, obwohl es etwas zu
  pruefen gaebe? Der Autor behauptet, `fail_source_without_trailer` laufe vorher
  mit — stimmt das fuer JEDEN Pfad?
- **Die getrennten Build-Verzeichnisse.** Ist die Trennung wirklich vollstaendig?
  Gibt es cargo-Aufrufe in `red-first.sh`, die das Verzeichnis NICHT gesetzt
  bekommen?
- **Der Arbeitsbaum-Waechter.** Er vergleicht Mengen vor/nach dem Lauf. Kann er
  falsch-positiv werden (und damit weggeschaltet)? Kann er etwas uebersehen?
- **`workflow-shell.sh` und `actions-pinned.sh`** sind Detektoren, die ihre
  eigene Definition nicht finden duerfen. Halten die Muster?
- **Windows/MSYS.** `gates.sh` und die Hooks laufen unter Git-Bash. Pfade,
  `cygpath`, CRLF, das x-Bit im Index.
- **Sicherheit.** `release.yml` haelt Signing-Key und einen PAT, `review.yml` den
  `OPENROUTER_KEY`. Verschlechtert dieser Diff dort irgendetwas? Ist das
  SHA-Pinning vollstaendig, auch in der neuen Composite Action?
- **Der neue pwsh-Detektor in `workflow-shell.sh`.** Er arbeitet mit Markern
  (`$LASTEXITCODE`, `Write-Host`, `$env:`, ...) und einer Zustandsmaschine in
  awk, die Schritte abgrenzt. Der erste Entwurf schlug an seinem eigenen
  Kommentar an. Welche Falsch-positiven und Falsch-negativen bleiben? Ordnet
  er einen Marker dem richtigen Schritt zu?
- **`review_transport.py`.** Gibt es noch eine Antwortform, bei der ein
  Reviewer stillschweigend als "hat geantwortet" zaehlt? Ist die
  `except`-Liste zu breit (verschluckt sie einen Programmierfehler als
  "Reviewer ausgefallen")?
- **Die Pflichtliste in `scripts/test-gates.sh`.** Sie soll verhindern, dass
  ein Gate bei einer Umstrukturierung still verschwindet. Ist sie vollstaendig?
  Was schuetzt sie NICHT?
- **Was der Autor NICHT geprueft hat:** der Windows-Pfad von `release.yml` (die
  Bahn `release` laeuft dort neu in Git-Bash, mit nextest-Installation,
  Playwright und Browser-Smoke) ist nie gelaufen — Releases haengen an `v*`-Tags.
  Ebenso die Bahn `windows` und der pwsh-Schritt: die Cloud-Sitzung ist Linux.
  `e2e` und `hq-visual` sind dort auf Chromium-Build 1194 belegt, waehrend
  Playwright 1243 verlangt (Download gesperrt).

## Format deiner Antwort

Nummerierte Befunde, jeder mit genau diesen fuenf Zeilen:

```
### R-1 — <Kurztitel>
- Schwere: hoch | mittel | niedrig
- Datei: <pfad:zeile>
- Behauptung: <was ist falsch>
- Beleg: <woertliches Zitat aus dem Diff>
- Vorschlag: <konkrete Aenderung>
```

Danach zwei Abschnitte:

- **MERGE-URTEIL:** genau eine Zeile — `mergen`, `mergen nach Fix von R-x, R-y`
  oder `nicht mergen`, mit einem Satz Begruendung.
- **NICHT PRUEFBAR OHNE REPO:** was du nur mit dem vollstaendigen Repo
  entscheiden koenntest. Rate nicht.

Erfinde nichts. Ein Befund, den du nicht am Diff belegen kannst, ist keiner.

---

## Der Diff

Gegen die Merge-Base auf `main`. `.pa/`-Protokolle und Journal-Dateien sind
weggelassen — sie sind Artefakte, kein Prozesscode.



## Fokus dieses Teils

`workflow-shell.sh` und `actions-pinned.sh` sind Detektoren, die ihre eigene Definition nicht finden duerfen. Der neue pwsh-Teil arbeitet mit Markern und einer awk-Zustandsmaschine; der erste Entwurf schlug an seinem eigenen Kommentar an. Welche Falsch-positiven und Falsch-negativen bleiben? Dazu die Sicherheitsfrage: `release.yml` haelt Signing-Key und PAT, `review.yml` den `OPENROUTER_KEY` — verschlechtert dieser Diff dort irgendetwas? Ist das SHA-Pinning vollstaendig, auch in der neuen Composite Action?


```diff
diff --git a/.github/actions/setup-linux/action.yml b/.github/actions/setup-linux/action.yml
new file mode 100644
index 0000000..d03bea8
--- /dev/null
+++ b/.github/actions/setup-linux/action.yml
@@ -0,0 +1,69 @@
+name: setup-linux
+description: >
+  Linux-Bootstrap fuer die Gates: Tauri-Systembibliotheken, Node, Rust,
+  Cache, nextest, npm ci und optional Chromium.
+
+# Warum diese Datei existiert: dieselben sieben Schritte standen bis zum 09.09.
+# zweimal woertlich in ci.yml — einmal im Job `linux` (Zeilen 55-85) und einmal
+# im Job `red-first` (169-194). Zwei Kopien heisst: eine wird irgendwann
+# angefasst und die andere nicht. Genau so hatte `red-first` als einziger Job
+# KEINEN rust-cache, obwohl er am meisten kompiliert.
+#
+# Der `shared-key` bindet beide Jobs an denselben Cache-Eintrag. Ohne ihn
+# schluesselt rust-cache nach Job-Namen; es entstuenden zwei Caches, und die
+# 10-GB-Eviction fraesse irgendwann den Windows-Cache.
+#
+# Job-Namen (`gates (linux)`, `gates (windows)`) bleiben unveraendert: an
+# ihnen haengen die Cache-Schluessel, eine Umbenennung hat schon einmal
+# 17 Minuten gekostet (docs/decisions.md).
+
+inputs:
+  playwright:
+    description: "Chromium fuer den Browser-Smoke mitinstallieren"
+    required: false
+    default: "true"
+
+runs:
+  using: composite
+  steps:
+    # Tauri 2 braucht WebKitGTK und Freunde, sonst scheitert schon
+    # `cargo clippy` am fehlenden gdk-3.0/webkit2gtk-4.1 (am 03.09. im
+    # Web-Container genau so gemessen, am 09.09. erneut bestaetigt).
+    - name: Tauri-Systemabhaengigkeiten
+      shell: bash
+      run: |
+        sudo apt-get update
+        sudo apt-get install -y --no-install-recommends \
+          libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
+          libjavascriptcoregtk-4.1-dev librsvg2-dev patchelf
+
+    - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
+      with:
+        node-version: 24
+        cache: npm
+
+    - uses: dtolnay/rust-toolchain@d1031067263f94b142dd6c0ce24c5eb9d02d52a0 # master
+      with:
+        toolchain: stable
+
+    - uses: Swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6 # v2.9.2
+      with:
+        workspaces: src-tauri
+        shared-key: linux-gates
+        # red-first baut den Merge-Base-Baum in ein eigenes, stabiles
+        # Verzeichnis (scripts/ci/red-first.sh: ein GETEILTES target/ liesse
+        # den Kopf-Lauf das Binary der Merge-Base ausfuehren). Ohne diese
+        # Zeile faengt es bei jedem Lauf bei null an.
+        cache-directories: src-tauri/target-red-first-base
+
+    - uses: taiki-e/install-action@c3ec0de9ae7f1019cea21aa96aa0a895b9552063 # v2.87.9
+      with:
+        tool: nextest
+
+    - shell: bash
+      run: npm ci
+
+    # Der Browser-Smoke braucht Chromium; auf Linux mit Systembibliotheken.
+    - if: inputs.playwright == 'true'
+      shell: bash
+      run: npx playwright install --with-deps chromium
diff --git a/.github/workflows/anthropic-wif-test.yml b/.github/workflows/anthropic-wif-test.yml
index c477b4a..45f09c6 100644
--- a/.github/workflows/anthropic-wif-test.yml
+++ b/.github/workflows/anthropic-wif-test.yml
@@ -21,12 +21,35 @@ permissions:
   id-token: write
   contents: read
 
+# `run:`-Schritte laufen ohne diese Zeilen als `bash -e {0}` — OHNE `pipefail`.
+# Der Status einer Pipe ist dann der ihres LETZTEN Glieds, und ein
+# `cargo clippy 2>&1 | tail` meldet Erfolg, waehrend clippy scheitert. Genau so
+# ging am 05.09. in review.yml der Exit 1 des Modell-Resolvers verloren und am
+# 04.09. lokal der Status von clippy.
+#
+# Mit explizitem `shell: bash` startet GitHub den Schritt als
+# `bash --noprofile --norc -eo pipefail {0}` — die Fehlerklasse ist damit
+# strukturell dicht, nicht nur an den Stellen, die jemand einzeln gehaertet hat.
+# scripts/ci/no-masked-output.sh bleibt trotzdem: es faengt die Schreibvorgaenge
+# nach $GITHUB_OUTPUT/$GITHUB_ENV, die auch mit pipefail noch falsch waeren,
+# weil dort der Exit-Code gar nicht erst geprueft wird.
+#
+# Gilt auch auf windows-latest: dort ist `bash` die mitgelieferte Git-Bash.
+# Schritte mit eigenem `shell:` (pwsh in release.yml) sind unberuehrt.
+# Alle `uses:` sind auf einen Commit-SHA gepinnt, nicht auf einen Tag oder
+# Branch. Begruendung: docs/decisions.md (09.09.). Dependabot hebt sie ueber
+# den Versionskommentar an; der Kommentar ist die lesbare Fassung des SHA,
+# nicht die autorisierende.
+defaults:
+  run:
+    shell: bash
+
 jobs:
   call-claude:
     runs-on: ubuntu-latest
     steps:
       - name: Fetch GitHub OIDC token
-        uses: actions/github-script@v9
+        uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0
         with:
           script: |
             const token = await core.getIDToken('https://api.anthropic.com');
diff --git a/.github/workflows/audit.yml b/.github/workflows/audit.yml
index 12c3c23..1965663 100644
--- a/.github/workflows/audit.yml
+++ b/.github/workflows/audit.yml
@@ -14,26 +14,52 @@ on:
 permissions:
   contents: read
 
+# `run:`-Schritte laufen ohne diese Zeilen als `bash -e {0}` — OHNE `pipefail`.
+# Der Status einer Pipe ist dann der ihres LETZTEN Glieds, und ein
+# `cargo clippy 2>&1 | tail` meldet Erfolg, waehrend clippy scheitert. Genau so
+# ging am 05.09. in review.yml der Exit 1 des Modell-Resolvers verloren und am
+# 04.09. lokal der Status von clippy.
+#
+# Mit explizitem `shell: bash` startet GitHub den Schritt als
+# `bash --noprofile --norc -eo pipefail {0}` — die Fehlerklasse ist damit
+# strukturell dicht, nicht nur an den Stellen, die jemand einzeln gehaertet hat.
+# scripts/ci/no-masked-output.sh bleibt trotzdem: es faengt die Schreibvorgaenge
+# nach $GITHUB_OUTPUT/$GITHUB_ENV, die auch mit pipefail noch falsch waeren,
+# weil dort der Exit-Code gar nicht erst geprueft wird.
+#
+# Gilt auch auf windows-latest: dort ist `bash` die mitgelieferte Git-Bash.
+# Schritte mit eigenem `shell:` (pwsh in release.yml) sind unberuehrt.
+# Alle `uses:` sind auf einen Commit-SHA gepinnt, nicht auf einen Tag oder
+# Branch. Begruendung: docs/decisions.md (09.09.). Dependabot hebt sie ueber
+# den Versionskommentar an; der Kommentar ist die lesbare Fassung des SHA,
+# nicht die autorisierende.
+defaults:
+  run:
+    shell: bash
+
 jobs:
   audit:
     runs-on: ubuntu-latest
     steps:
-      - uses: actions/checkout@v7
+      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
 
-      - uses: dtolnay/rust-toolchain@stable
+      # `@stable` war ein BRANCH, kein Tag - er aenderte sich ohne Commit im
+      # Repo. Gepinnt auf master; die Toolchain steht jetzt sichtbar hier.
+      - uses: dtolnay/rust-toolchain@d1031067263f94b142dd6c0ce24c5eb9d02d52a0 # master
+        with:
+          toolchain: stable
 
       - name: cargo-audit installieren
-        uses: taiki-e/install-action@v2
+        uses: taiki-e/install-action@c3ec0de9ae7f1019cea21aa96aa0a895b9552063 # v2.87.9
         with:
           tool: cargo-audit
 
-      - name: Audit - Rust-Abhaengigkeiten
-        working-directory: src-tauri
-        run: cargo audit
-
-      - uses: actions/setup-node@v7
+      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
         with:
           node-version: 24
 
-      - name: Audit - npm-Abhaengigkeiten
-        run: npm audit --audit-level=moderate
+      # Beide Audits ueber dieselbe Quelle wie alle anderen Gates
+      # (scripts/ci/gates.sh) — lokal identisch aufrufbar:
+      #   bash scripts/ci/gates.sh lane audit
+      - name: Audits
+        run: bash scripts/ci/gates.sh lane audit
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index e8eedc9..024e270 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -50,128 +50,107 @@ concurrency:
   group: ci-${{ github.ref }}
   cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
 
+# `run:`-Schritte laufen ohne diese Zeilen als `bash -e {0}` — OHNE `pipefail`.
+# Der Status einer Pipe ist dann der ihres LETZTEN Glieds, und ein
+# `cargo clippy 2>&1 | tail` meldet Erfolg, waehrend clippy scheitert. Genau so
+# ging am 05.09. in review.yml der Exit 1 des Modell-Resolvers verloren und am
+# 04.09. lokal der Status von clippy.
+#
+# Mit explizitem `shell: bash` startet GitHub den Schritt als
+# `bash --noprofile --norc -eo pipefail {0}` — die Fehlerklasse ist damit
+# strukturell dicht, nicht nur an den Stellen, die jemand einzeln gehaertet hat.
+# scripts/ci/no-masked-output.sh bleibt trotzdem: es faengt die Schreibvorgaenge
+# nach $GITHUB_OUTPUT/$GITHUB_ENV, die auch mit pipefail noch falsch waeren,
+# weil dort der Exit-Code gar nicht erst geprueft wird.
+#
+# Gilt auch auf windows-latest: dort ist `bash` die mitgelieferte Git-Bash.
+# Schritte mit eigenem `shell:` (pwsh in release.yml) sind unberuehrt.
+# Alle `uses:` sind auf einen Commit-SHA gepinnt, nicht auf einen Tag oder
+# Branch. Begruendung: docs/decisions.md (09.09.). Dependabot hebt sie ueber
+# den Versionskommentar an; der Kommentar ist die lesbare Fassung des SHA,
+# nicht die autorisierende.
+defaults:
+  run:
+    shell: bash
+
 jobs:
   linux:
     name: gates (linux)
     runs-on: ubuntu-latest
     steps:
-      - uses: actions/checkout@v7
-
-      # Tauri 2 braucht WebKitGTK und Freunde, sonst scheitert schon
-      # `cargo clippy` am fehlenden gdk-3.0/webkit2gtk-4.1 (am 03.09. im
-      # Web-Container genau so gemessen).
-      - name: Tauri-Systemabhaengigkeiten
-        run: |
-          sudo apt-get update
-          sudo apt-get install -y --no-install-recommends \
-            libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
-            libjavascriptcoregtk-4.1-dev librsvg2-dev patchelf
-
-      - uses: actions/setup-node@v7
-        with:
-          node-version: 24
-          cache: npm
-
-      - uses: dtolnay/rust-toolchain@stable
-
-      - uses: Swatinem/rust-cache@v2
-        with:
-          workspaces: src-tauri
+      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
 
-      - uses: taiki-e/install-action@nextest
+      # Sieben Bootstrap-Schritte standen bis zum 09.09. woertlich zweimal in
+      # dieser Datei — hier und im Job `red-first`. Zwei Kopien heisst: eine
+      # wird angefasst und die andere nicht, und genau so hatte red-first als
+      # einziger Job keinen rust-cache. Jetzt eine Stelle:
+      # .github/actions/setup-linux/action.yml
+      - uses: ./.github/actions/setup-linux
 
-      - run: npm ci
-
-      # Aus #31: der Browser-Smoke braucht Chromium. Auf Linux mit
-      # Systembibliotheken, wie es der red-first-Job dort auch tut.
-      - name: Playwright Chromium installieren
-        run: npx playwright install --with-deps chromium
-
-      # Bug -> Regel (AGENTS.md): am 05.09. verschluckte `| tee -a
-      # "$GITHUB_OUTPUT"` in review.yml den Exit 1 des Modell-Resolvers, und am
-      # 04.09. verschluckte `| tail -1` lokal den Status von clippy. GitHub
-      # startet `run:` als `bash -e {0}` OHNE `pipefail`.
+      # Die Gate-Liste steht nicht mehr hier, sondern in scripts/ci/gates.sh.
       #
-      # Der Detektor liegt als Skript unter scripts/ci/, nicht als grep hier:
-      # er darf seine eigene Definition nicht finden, und er hat einen
-      # Selbsttest (scripts/test-no-masked-output.sh), der auch den
-      # Falsch-Positiv-Fall festnagelt, den der externe Review benannt hat
-      # (`echo "x=$(a | b)" >> "$GITHUB_OUTPUT"` ist korrekt und muss durch).
-      # Reihenfolge billig -> teuer (Befund des externen Dual-Reviews, Sonnet
-      # Nr. 6): ein kaputtes Frontend soll nicht erst nach clippy und der ganzen
-      # Rust-Suite sichtbar werden. Seit das Actions-Kontingent aufgebraucht ist,
-      # zaehlt jede gesparte Minute doppelt.
-      - name: Gate - kein maskierter Exit-Code in Workflows
-        run: bash scripts/ci/no-masked-output.sh
-
-      - name: Gate - Test-First-Auswertung bei langen Logs
-        run: bash scripts/test-red-first-output.sh
-
-      - name: Gate - cargo fmt
-        working-directory: src-tauri
-        run: cargo fmt --check
-
-      - name: Gate - typecheck
-        run: npm run typecheck
-
-      - name: Gate - lint
-        run: npm run lint
-
-      - name: Gate - Frontend-Tests
-        run: npm test
-
-      - name: Gate - DevHQ-Tests
-        run: npm run test:hq
-
-      - name: Gate - DevHQ-Browser-Smoke
-        run: npm run test:hq:visual
-
-      # Aus #31 uebernommen. Dort lief er im Windows-Job; er beweist auf
-      # Windows nichts, was er auf Linux nicht auch beweist, und Windows-Minuten
-      # kosten doppelt.
-      - name: Gate - Frontend-Build
-        run: npm run build
-
-      - name: Gate - Browser-Smoke
-        run: npm run test:e2e
-
-      - name: Gate - clippy
-        working-directory: src-tauri
-        run: cargo clippy --all-targets -- -D warnings
-
-      # nextest statt cargo test: eigener Prozess je Test (kein geteilter
-      # Zustand), keine Retries im Profil `ci`, harter slow-timeout.
-      - name: Gate - Rust-Suite (nextest)
-        working-directory: src-tauri
-        run: cargo nextest run --profile ci
+      # Sie stand bis zum 09.09. fuenffach da (hier, im Windows-Job, in
+      # release.yml, in beiden Git-Hooks) und driftete: pre-push fuhr
+      # `cargo test`, dieser Job `cargo nextest run --profile ci` — geteilter
+      # Prozess statt Prozess pro Test, kein slow-timeout. Was lokal vor dem
+      # Push gruen war, war also nicht das, was hier gemessen wurde. Zwei
+      # Gates liefen ueberhaupt nirgends: `npm run test:hq` (12
+      # node:test-Dateien) und die Selbsttests der Gates, auf die sich der
+      # Kommentar dieses Jobs zur Begruendung berief.
+      #
+      # Ein Schritt je BAHN statt je Gate ist Absicht: so gibt es keine Liste
+      # im YAML mehr, die von der lokalen abweichen KOENNTE. Drift ist nicht
+      # geprueft, sondern unmoeglich. Die Aufschluesselung je Gate steht im
+      # Log (::group::) und als Tabelle in der Job-Summary; die Reihenfolge
+      # billig -> teuer ist in gates.sh dieselbe wie vorher hier.
+      #
+      # Derselbe Befehl laeuft auf dem Entwickler-PC: bash scripts/ci/gates.sh lane linux
+      - name: Gates (linux)
+        run: bash scripts/ci/gates.sh lane linux
 
   windows:
     name: gates (windows)
     runs-on: windows-latest
     steps:
-      - uses: actions/checkout@v7
+      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
 
-      - uses: dtolnay/rust-toolchain@stable
+      # `@stable` war ein BRANCH, kein Tag - er aenderte sich ohne Commit im
+      # Repo. Gepinnt auf master; die Toolchain steht jetzt sichtbar hier.
+      - uses: dtolnay/rust-toolchain@d1031067263f94b142dd6c0ce24c5eb9d02d52a0 # master
+        with:
+          toolchain: stable
 
-      - uses: Swatinem/rust-cache@v2
+      - uses: Swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6 # v2.9.2
         with:
           workspaces: src-tauri
+          shared-key: windows-gates
 
-      - uses: taiki-e/install-action@nextest
+      # `@nextest` war ein wandernder Tag. Gepinnt auf v2 mit `tool:` -
+      # dieselbe Schreibweise wie in audit.yml, statt zweier Muster.
+      - uses: taiki-e/install-action@c3ec0de9ae7f1019cea21aa96aa0a895b9552063 # v2.87.9
+        with:
+          tool: nextest
 
       # Uebersteuert bewusst Spec-Entscheidung 4 aus release.yml (nur Tags):
       # die cfg(windows)-Arme kompilieren sonst erst am Release-Tag
       # (Sanierungsplan Phase A.4).
-      - name: Gate - clippy (cfg(windows)-Arme)
-        working-directory: src-tauri
-        run: cargo clippy --all-targets -- -D warnings
-
-      - name: Gate - Rust-Suite auf der Zielplattform (nextest)
-        working-directory: src-tauri
-        run: cargo nextest run --profile ci
-
+      #
+      # Bahn `windows` = fmt, clippy, Rust-Suite. Die Frontend-Gates fehlen
+      # hier weiterhin bewusst: sie beweisen auf Windows nichts, was sie auf
+      # Linux nicht auch beweisen, und Windows-Minuten kosten doppelt. Die
+      # Suite selbst bleibt UNGEFILTERT (Kopfkommentar dieser Datei).
+      - name: Gates (windows)
+        run: bash scripts/ci/gates.sh lane windows
+
+      # PowerShell, und das muss hier stehen: seit dem 09.09. traegt diese
+      # Datei `defaults: run: shell: bash`, sonst laeuft `run:` als
+      # `bash -e {0}` ohne pipefail. Der Default haette diesen Schritt aber
+      # von pwsh auf Git-Bash umgestellt — `$LASTEXITCODE`, `&` und `throw`
+      # sind dort kein PowerShell mehr, sondern Unsinn. Der Schritt ist am
+      # 12.09. auf main entstanden, als der Default noch nicht existierte.
       - name: Gate - native Parent-Host-Prozessgrenze
         working-directory: src-tauri
+        shell: pwsh
         run: |
           cargo build --bin pa-capture-host
           if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
@@ -203,7 +182,7 @@ jobs:
     if: github.event_name == 'pull_request'
     runs-on: ubuntu-latest
     steps:
-      - uses: actions/checkout@v7
+      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
         with:
           fetch-depth: 0
           ref: ${{ github.event.pull_request.head.sha }}
@@ -211,24 +190,38 @@ jobs:
       - name: Base-Commit holen
         run: git fetch --no-tags origin ${{ github.event.pull_request.base.sha }}
 
-      - uses: actions/setup-node@v7
-        with:
-          node-version: 24
-          cache: npm
-
-      - uses: dtolnay/rust-toolchain@stable
-
-      - name: Tauri-Systemabhaengigkeiten
+      # Erst nachsehen, DANN installieren. Bis zum 09.09. richtete dieser Job
+      # ~4 min Toolchain ein (apt, npm ci, Playwright, Rust), bevor das Skript
+      # ueberhaupt nachsah — und bei den meisten PRs (No-Test:, Doku, reine
+      # Tests) endet es sofort mit "keine Belege". Die Auskunft steht in
+      # `git log` und kostet Millisekunden.
+      #
+      # Das ist KEIN paths-ignore-Verwandter: die Entscheidung trifft das Gate
+      # selbst nach Auswertung seiner Eingaben und protokolliert sie, statt an
+      # einer Dateiendungs-Heuristik zu haengen. Und `--plan` fuehrt den
+      # Trailer-Formcheck mit aus: ein Commit, der Quellcode ohne Trailer
+      # aendert, ist auch hier rot und nicht stillschweigend "count=0".
+      # Festgenagelt in scripts/test-red-first.sh.
+      - name: Plan - gibt es ueberhaupt Belege zu pruefen?
+        id: plan
+        env:
+          BASE_SHA: ${{ github.event.pull_request.base.sha }}
+          HEAD_SHA: ${{ github.event.pull_request.head.sha }}
+          PR_BODY: ${{ github.event.pull_request.body }}
         run: |
-          sudo apt-get update
-          sudo apt-get install -y --no-install-recommends \
-            libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
-            libjavascriptcoregtk-4.1-dev librsvg2-dev patchelf
-
-      - run: npm ci
-
-      - name: Playwright Chromium mit Systembibliotheken installieren
-        run: npx playwright install --with-deps chromium
+          # Erst in eine Datei, dann anhaengen - eine Pipe nach $GITHUB_OUTPUT
+          # verschluckt den Exit-Code links davon (scripts/ci/no-masked-output.sh).
+          bash scripts/ci/red-first.sh --plan > "$RUNNER_TEMP/plan.out"
+          cat "$RUNNER_TEMP/plan.out"
+          cat "$RUNNER_TEMP/plan.out" >> "$GITHUB_OUTPUT"
+
+      # Dieselbe Action wie im Job `linux`. Sie bringt den rust-cache mit, den
+      # dieser Job als einziger nicht hatte — obwohl er am meisten
+      # kompiliert (Merge-Base UND Kopf). `shared-key` bindet beide Jobs an
+      # denselben Eintrag; `cache-directories` nimmt zusaetzlich das stabile
+      # Merge-Base-Verzeichnis aus scripts/ci/red-first.sh auf.
+      - uses: ./.github/actions/setup-linux
+        if: steps.plan.outputs.count != '0'
 
       - name: red-first gegen Merge-Base
         env:
diff --git a/.github/workflows/release.yml b/.github/workflows/release.yml
index 3f90765..da0fed2 100644
--- a/.github/workflows/release.yml
+++ b/.github/workflows/release.yml
@@ -11,44 +11,88 @@ on:
 permissions:
   contents: write
 
+# `run:`-Schritte laufen ohne diese Zeilen als `bash -e {0}` — OHNE `pipefail`.
+# Der Status einer Pipe ist dann der ihres LETZTEN Glieds, und ein
+# `cargo clippy 2>&1 | tail` meldet Erfolg, waehrend clippy scheitert. Genau so
+# ging am 05.09. in review.yml der Exit 1 des Modell-Resolvers verloren und am
+# 04.09. lokal der Status von clippy.
+#
+# Mit explizitem `shell: bash` startet GitHub den Schritt als
+# `bash --noprofile --norc -eo pipefail {0}` — die Fehlerklasse ist damit
+# strukturell dicht, nicht nur an den Stellen, die jemand einzeln gehaertet hat.
+# scripts/ci/no-masked-output.sh bleibt trotzdem: es faengt die Schreibvorgaenge
+# nach $GITHUB_OUTPUT/$GITHUB_ENV, die auch mit pipefail noch falsch waeren,
+# weil dort der Exit-Code gar nicht erst geprueft wird.
+#
+# Gilt auch auf windows-latest: dort ist `bash` die mitgelieferte Git-Bash.
+# Schritte mit eigenem `shell:` (pwsh in release.yml) sind unberuehrt.
+# Alle `uses:` sind auf einen Commit-SHA gepinnt, nicht auf einen Tag oder
+# Branch. Begruendung: docs/decisions.md (09.09.). Dependabot hebt sie ueber
+# den Versionskommentar an; der Kommentar ist die lesbare Fassung des SHA,
+# nicht die autorisierende.
+defaults:
+  run:
+    shell: bash
+
 jobs:
   windows-installer:
     runs-on: windows-latest
+    # Dieser Job haelt den Tauri-Signing-Key UND den Mirror-PAT, und er wird
+    # von einem Tag-Push ausgeloest — den jeder mit Push-Recht machen kann.
+    # Dieselbe Klasse wie der review.yml-Befund vom 06.09.
+    #
+    # Wirksam wird der Eintrag erst, wenn jemand in
+    # `Settings > Environments > release` Required Reviewers eintraegt; dann
+    # haengt jeder Zugriff auf diese Secrets an einer menschlichen Freigabe.
+    # Ohne diese Einstellung schuetzt er nichts — er ist die Stelle, an der
+    # die Haertung angeschraubt wird, und steht deshalb hier.
+    environment: release
     steps:
-      - uses: actions/checkout@v7
+      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
 
-      - uses: actions/setup-node@v7
+      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
         with:
           node-version: 24
           cache: npm
 
-      - uses: dtolnay/rust-toolchain@stable
+      # `@stable` war ein BRANCH, kein Tag - er aenderte sich ohne Commit im
+      # Repo. Gepinnt auf master; die Toolchain steht jetzt sichtbar hier.
+      - uses: dtolnay/rust-toolchain@d1031067263f94b142dd6c0ce24c5eb9d02d52a0 # master
+        with:
+          toolchain: stable
 
-      - uses: Swatinem/rust-cache@v2
+      - uses: Swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6 # v2.9.2
         with:
           workspaces: src-tauri
+          shared-key: windows-gates
 
-      - run: npm ci
-
-      - name: Gate - cargo fmt
-        working-directory: src-tauri
-        run: cargo fmt --check
-
-      - name: Gate - cargo test
-        working-directory: src-tauri
-        run: cargo test
+      # Die Bahn `release` faehrt die Rust-Suite ueber nextest (wie ci.yml).
+      # Vorher stand hier `cargo test`, deshalb brauchte dieser Job das
+      # Werkzeug nie — ohne diesen Schritt waere der Tag-Build sofort rot.
+      - uses: taiki-e/install-action@c3ec0de9ae7f1019cea21aa96aa0a895b9552063 # v2.87.9
+        with:
+          tool: nextest
 
-      - name: Gate - clippy
-        working-directory: src-tauri
-        run: cargo clippy --all-targets -- -D warnings
+      - run: npm ci
 
-      - name: Gate - typecheck
-        run: npm run typecheck
+      # Der Browser-Smoke gehoert zur Bahn `release` und braucht Chromium.
+      - name: Playwright Chromium installieren
+        run: npx playwright install chromium
 
-      # Lief in der Release-CI bisher NIE (Review-Befund 31.08.): die Frontend-
-      # Suite enthaelt u.a. den Updater-Endpoint-Regressionstest.
-      - name: Gate - frontend tests (vitest)
-        run: npm test
+      # Bis zum 09.09. stand hier eine eigene Gate-Liste — und sie war die
+      # SCHWAECHSTE im Repo: kein `lint`, kein `test:e2e`, kein
+      # `no-masked-output`, und `cargo test` statt `cargo nextest run
+      # --profile ci`, also MIT Retries und OHNE slow-timeout. Der Tag-Build,
+      # der die signierten Installer erzeugt, war damit schlechter gegatet als
+      # ein beliebiger PR.
+      #
+      # Jetzt dieselbe Quelle wie ueberall: scripts/ci/gates.sh. Die Bahn
+      # `release` enthaelt die Linux-Liste; was hier zusaetzlich laeuft, ist
+      # der Bundle-Build darunter.
+      #
+      # Lokal identisch: bash scripts/ci/gates.sh lane release
+      - name: Gates (release)
+        run: bash scripts/ci/gates.sh lane release
 
       # `npx tauri build` runs `npm run build` (tsc + vite) through
       # beforeBuildCommand and is the release-profile cargo build -
@@ -73,7 +117,7 @@ jobs:
       # private, vollstaendige Ablage; der oeffentliche Update-Kanal laeuft
       # ueber das Mirror-Repo (naechster Schritt).
       - name: Attach installers to the private GitHub release
-        uses: softprops/action-gh-release@v3
+        uses: softprops/action-gh-release@efb35369e0ad2afab669f228072c1b0d510eae64 # v3.0.3
         with:
           files: |
             src-tauri/target/release/bundle/nsis/*.exe
diff --git a/.github/workflows/review.yml b/.github/workflows/review.yml
index f005f88..7aae82b 100644
--- a/.github/workflows/review.yml
+++ b/.github/workflows/review.yml
@@ -68,15 +68,38 @@ concurrency:
   group: review-${{ github.ref }}
   cancel-in-progress: false
 
+# `run:`-Schritte laufen ohne diese Zeilen als `bash -e {0}` — OHNE `pipefail`.
+# Der Status einer Pipe ist dann der ihres LETZTEN Glieds, und ein
+# `cargo clippy 2>&1 | tail` meldet Erfolg, waehrend clippy scheitert. Genau so
+# ging am 05.09. in review.yml der Exit 1 des Modell-Resolvers verloren und am
+# 04.09. lokal der Status von clippy.
+#
+# Mit explizitem `shell: bash` startet GitHub den Schritt als
+# `bash --noprofile --norc -eo pipefail {0}` — die Fehlerklasse ist damit
+# strukturell dicht, nicht nur an den Stellen, die jemand einzeln gehaertet hat.
+# scripts/ci/no-masked-output.sh bleibt trotzdem: es faengt die Schreibvorgaenge
+# nach $GITHUB_OUTPUT/$GITHUB_ENV, die auch mit pipefail noch falsch waeren,
+# weil dort der Exit-Code gar nicht erst geprueft wird.
+#
+# Gilt auch auf windows-latest: dort ist `bash` die mitgelieferte Git-Bash.
+# Schritte mit eigenem `shell:` (pwsh in release.yml) sind unberuehrt.
+# Alle `uses:` sind auf einen Commit-SHA gepinnt, nicht auf einen Tag oder
+# Branch. Begruendung: docs/decisions.md (09.09.). Dependabot hebt sie ueber
+# den Versionskommentar an; der Kommentar ist die lesbare Fassung des SHA,
+# nicht die autorisierende.
+defaults:
+  run:
+    shell: bash
+
 jobs:
   review:
     runs-on: ubuntu-latest
     timeout-minutes: 90
     environment: review
     steps:
-      - uses: actions/checkout@v7
+      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
 
-      - uses: actions/setup-python@v5
+      - uses: actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065 # v5.6.0
         with:
           python-version: "3.12"
 
@@ -189,7 +212,7 @@ jobs:
             echo "===== $f"; cat "$f"; echo
           done
 
-      - uses: actions/upload-artifact@v4
+      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
         if: always()
         with:
           name: reviews-${{ steps.req.outputs.label }}
diff --git a/scripts/ci/actions-pinned.sh b/scripts/ci/actions-pinned.sh
new file mode 100755
index 0000000..f2310bf
--- /dev/null
+++ b/scripts/ci/actions-pinned.sh
@@ -0,0 +1,59 @@
+#!/usr/bin/env bash
+# Verlangt, dass jedes `uses:` in einem Workflow auf einen 40-stelligen
+# Commit-SHA zeigt - nicht auf einen Tag und nicht auf einen Branch.
+#
+# Warum: ein Tag ist ein beweglicher Zeiger. `dtolnay/rust-toolchain@stable`
+# und `taiki-e/install-action@nextest` waren BRANCHES bzw. wandernde Tags: ihr
+# Inhalt aenderte sich ohne einen einzigen Commit in diesem Repo. Wer den Tag
+# umhaengt, fuehrt Code in einem Job aus, in dem der Tauri-Signing-Key und der
+# Mirror-PAT liegen (release.yml) bzw. der OPENROUTER_KEY (review.yml). Das ist
+# kein Versionsthema, sondern die wertvollste Supply-Chain-Stelle im Repo.
+#
+# Der Versionskommentar hinter dem SHA ist die lesbare Fassung, nicht die
+# autorisierende; Dependabot hebt beides gemeinsam an.
+#
+# Erlaubt bleiben repo-lokale Actions (`uses: ./.github/actions/...`): sie
+# liegen im selben Commit und koennen sich nicht unter der Hand aendern.
+#
+# Gesucht wird REKURSIV unter .github, nicht nur in workflows/: eine
+# Composite Action unter .github/actions/ bringt eigene `uses:` mit, laeuft
+# im selben Job wie die Secrets und waere sonst der blinde Fleck genau
+# dieses Gates.
+#
+# Selbsttest: scripts/test-actions-pinned.sh
+# Aufruf: scripts/ci/actions-pinned.sh [verzeichnis]  (Standard: .github)
+set -uo pipefail
+dir="${1:-.github}"
+
+bad=0
+found=0
+while IFS= read -r f; do
+  [ -f "$f" ] || continue
+  found=$((found + 1))
+  # Nur echte Schluessel, keine Kommentarzeilen: die Erklaerung oben enthaelt
+  # selbst das Wort `uses:` und darf den Detektor nicht ausloesen.
+  while IFS=: read -r lineno rest; do
+    ref="$(printf '%s' "$rest" | sed -E 's/[[:space:]]*#.*$//; s/[[:space:]]+$//')"
+    case "$ref" in
+      ./*) continue ;;                                   # repo-lokal
+      *@[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f])
+        continue ;;                                      # genau 40 Hex-Zeichen
+    esac
+    echo "  $f:$lineno  $ref"
+    bad=$((bad + 1))
+  done < <(grep -nE '^[[:space:]]*-?[[:space:]]*uses:[[:space:]]*[^[:space:]#]' "$f" |
+             sed -E 's/^([0-9]+):[[:space:]]*-?[[:space:]]*uses:[[:space:]]*/\1:/')
+done < <(find "$dir" -type f \( -name '*.yml' -o -name '*.yaml' \) | sort)
+
+# Ein Gate, das ueber einem leeren Verzeichnis gruen wird, prueft nichts
+# (AGENTS.md, Regel 2).
+if [ "$found" -eq 0 ]; then
+  echo "::error::Keine Workflow-/Action-Datei unter $dir gefunden - falscher Pfad?"
+  exit 2
+fi
+
+if [ "$bad" -gt 0 ]; then
+  echo "::error::$bad 'uses:' ohne 40-stelligen Commit-SHA. Ein Tag oder Branch ist ein beweglicher Zeiger - aufloesen mit: git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag> 'refs/tags/<tag>^{}'"
+  exit 1
+fi
+echo "alle 'uses:' in $found Workflow-/Action-Datei(en) unter $dir sind auf einen Commit-SHA gepinnt"
diff --git a/scripts/ci/workflow-shell.sh b/scripts/ci/workflow-shell.sh
new file mode 100755
index 0000000..5a58e78
--- /dev/null
+++ b/scripts/ci/workflow-shell.sh
@@ -0,0 +1,103 @@
+#!/usr/bin/env bash
+# Verlangt, dass jeder Workflow `defaults: run: shell: bash` deklariert.
+#
+# Warum: ohne diese Angabe startet GitHub jeden `run:`-Schritt als
+# `bash -e {0}` — OHNE `pipefail`. Der Status einer Pipe ist dann der ihres
+# LETZTEN Glieds; `cargo clippy 2>&1 | tail` meldet Erfolg, waehrend clippy
+# scheitert. Mit explizitem `shell: bash` startet GitHub
+# `bash --noprofile --norc -eo pipefail {0}`.
+#
+# Das ist der Regel-Teil der Bug-Regel-Pipeline (AGENTS.md): am 05.09. ging in
+# review.yml der Exit 1 des Modell-Resolvers so verloren, am 04.09. lokal der
+# Status von clippy. no-masked-output.sh faengt nur die Schreibvorgaenge nach
+# $GITHUB_OUTPUT/$GITHUB_ENV — dieses Gate faengt die Klasse.
+#
+# Ein neuer Workflow ohne den Block ist damit rot, statt still ungehaertet zu
+# sein. Selbsttest: scripts/test-workflow-shell.sh
+#
+# Aufruf: scripts/ci/workflow-shell.sh [verzeichnis]  (Standard: .github/workflows)
+set -uo pipefail
+dir="${1:-.github/workflows}"
+
+missing=0
+found=0
+for f in "$dir"/*.yml "$dir"/*.yaml; do
+  [ -f "$f" ] || continue
+  found=$((found + 1))
+  # Der Block muss auf Workflow-Ebene stehen (Spalte 0), nicht in einem Job:
+  # ein `defaults:` unter `jobs:` haertet nur diesen einen Job.
+  if ! awk '
+      /^defaults:[[:space:]]*$/ { in_defaults = 1; next }
+      in_defaults && /^[^[:space:]#]/ { in_defaults = 0 }
+      in_defaults && /^[[:space:]]+run:[[:space:]]*$/ { in_run = 1; next }
+      in_run && /^[[:space:]]{0,2}[^[:space:]#]/ { in_run = 0 }
+      in_run && /^[[:space:]]+shell:[[:space:]]*bash[[:space:]]*$/ { found = 1 }
+      END { exit(found ? 0 : 1) }
+    ' "$f"; then
+    echo "  $f"
+    missing=$((missing + 1))
+  fi
+done
+
+# Ein Gate, das ueber einem leeren Verzeichnis gruen wird, prueft nichts
+# (AGENTS.md, Regel 2). Ein falscher Pfad ist ein Fehler, kein Erfolg.
+if [ "$found" -eq 0 ]; then
+  echo "::error::Keine Workflow-Datei in $dir gefunden - falscher Pfad?"
+  exit 2
+fi
+
+if [ "$missing" -gt 0 ]; then
+  echo "::error::$missing Workflow(s) ohne 'defaults: run: shell: bash' - ihre run-Schritte laufen ohne pipefail, ein Exit-Code links einer Pipe geht verloren."
+  exit 1
+fi
+echo "alle $found Workflow(s) in $dir deklarieren shell: bash (pipefail)"
+
+# ---------------------------------------------------------------------------
+# Die Geschwisterstelle (AGENTS.md, Bug->Regel): der Block oben zwingt JEDEN
+# `run:`-Schritt der Datei auf bash — auch auf windows-latest, wo GitHub sonst
+# `pwsh` nimmt. Ein Schritt, der PowerShell enthaelt und kein eigenes `shell:`
+# traegt, lief vor dem Block richtig und danach unter Git-Bash: `$LASTEXITCODE`
+# ist dort leer, `throw` und `foreach` sind keine Schluesselwoerter. Gemessen
+# am 21.09. beim Merge von main: `Gate - native Parent-Host-Prozessgrenze` in
+# ci.yml war genau dieser Fall.
+#
+# Erkannt wird an Markern, die in bash nicht vorkommen. Ein Schritt mit
+# eigenem `shell:` ist ausgenommen — er hat die Frage ja beantwortet.
+ps_ohne_shell=0
+for f in "$dir"/*.yml "$dir"/*.yaml; do
+  [ -f "$f" ] || continue
+  treffer="$(awk -v datei="$f" '
+    function pruefe() {
+      if (schritt != "" && hat_ps && !hat_shell)
+        printf "  %s:%d  %s\n", datei, start, (name == "" ? "(unbenannter Schritt)" : name)
+    }
+    # Kommentarzeilen gehoeren zu keinem Schritt. Ohne diese Zeile schlug das
+    # Gate an seinem eigenen Anlass-Kommentar an, der $LASTEXITCODE erklaert —
+    # ein Detektor, der Prosa ueber sich selbst fuer Code haelt, ist unbrauchbar.
+    /^[[:space:]]*#/ { next }
+    # Ein Listenelement auf Schritt-Ebene beginnt einen neuen Schritt.
+    /^[[:space:]]*-[[:space:]]/ {
+      pruefe()
+      schritt = $0; hat_ps = 0; hat_shell = 0; name = ""; start = NR
+      if ($0 ~ /shell:[[:space:]]*[a-z]/) hat_shell = 1
+      if (match($0, /name:[[:space:]]*.*/)) { name = substr($0, RSTART + 5); sub(/^[[:space:]]*/, "", name) }
+    }
+    schritt != "" && /^[[:space:]]+shell:[[:space:]]*[a-z]/ { hat_shell = 1 }
+    schritt != "" && /^[[:space:]]+name:[[:space:]]*[^[:space:]]/ {
+      name = $0; sub(/^[[:space:]]*name:[[:space:]]*/, "", name)
+    }
+    # Marker, die es in einem bash-Schritt nicht gibt.
+    schritt != "" && /\$LASTEXITCODE|\$env:|Write-Host|Write-Output|New-Item|Get-Content|Set-Content|-ErrorAction|^[[:space:]]*throw[[:space:]]+"/ { hat_ps = 1 }
+    END { pruefe() }
+  ' "$f")"
+  if [ -n "$treffer" ]; then
+    printf '%s\n' "$treffer"
+    ps_ohne_shell=$((ps_ohne_shell + 1))
+  fi
+done
+
+if [ "$ps_ohne_shell" -gt 0 ]; then
+  echo "::error::PowerShell in einem run-Schritt ohne eigenes 'shell:' - der Workflow-Default 'shell: bash' fuehrt ihn unter Git-Bash aus, wo \$LASTEXITCODE leer ist und throw/foreach keine Schluesselwoerter sind. 'shell: pwsh' an den Schritt."
+  exit 1
+fi
+echo "kein PowerShell-Schritt ohne eigenes shell:"
diff --git a/scripts/test-actions-pinned.sh b/scripts/test-actions-pinned.sh
new file mode 100755
index 0000000..0474f9b
--- /dev/null
+++ b/scripts/test-actions-pinned.sh
@@ -0,0 +1,65 @@
+#!/usr/bin/env bash
+# Selbsttest fuer scripts/ci/actions-pinned.sh. Die beiden wichtigen Faelle
+# sind die letzten: eine Kommentarzeile, die selbst `uses:` enthaelt (der
+# Detektor darf seine eigene Erklaerung nicht finden), und ein SHA mit 39
+# statt 40 Zeichen (ein Praefix ist kein Pin).
+set -uo pipefail
+cd "$(dirname "$0")/.." || exit 1
+tmp="$(mktemp -d)"
+trap 'rm -rf "$tmp"' EXIT
+fails=0
+SHA40="3d3c42e5aac5ba805825da76410c181273ba90b1"
+
+check() { # name erwarteter_exit inhalt
+  local name="$1" want="$2" body="$3"
+  local d="$tmp/$name"
+  mkdir -p "$d"
+  printf '%s\n' "$body" > "$d/w.yml"
+  bash scripts/ci/actions-pinned.sh "$d" > "$tmp/$name.log" 2>&1
+  local got=$?
+  if [ "$got" -ne "$want" ]; then
+    echo "FEHLER $name: Exit $got, erwartet $want"; sed 's/^/    /' "$tmp/$name.log"; fails=$((fails + 1))
+  else
+    echo "ok   $name (Exit $got)"
+  fi
+}
+
+check "gepinnt"          0 "      - uses: actions/checkout@$SHA40 # v7.0.1"
+check "gepinnt-ohne-kommentar" 0 "      - uses: actions/checkout@$SHA40"
+check "tag"              1 "      - uses: actions/checkout@v7"
+check "branch"           1 "      - uses: dtolnay/rust-toolchain@stable"
+check "wandernder-tag"   1 "      - uses: taiki-e/install-action@nextest"
+check "repo-lokal"       0 "      - uses: ./.github/actions/setup-linux"
+check "uses-als-wert"    0 "      - name: erklaert uses: irgendwas@v1
+        run: echo hallo"
+# Der Detektor darf seine eigene Erklaerung nicht finden.
+check "kommentarzeile"   0 "      # gepinnt statt uses: actions/checkout@v7
+      - uses: actions/checkout@$SHA40 # v7.0.1"
+# 39 Zeichen: ein abgeschnittener SHA ist kein Pin.
+check "sha-zu-kurz"      1 "      - uses: actions/checkout@${SHA40:0:39}"
+
+# Eine Composite Action liegt NICHT unter workflows/ und wurde von der
+# ersten Fassung dieses Gates gar nicht gesehen — der blinde Fleck, den der
+# Umbau auf .github/actions/setup-linux geschaffen haette.
+mkdir -p "$tmp/verschachtelt/workflows" "$tmp/verschachtelt/actions/setup"
+printf '      - uses: actions/checkout@%s # v7.0.1\n' "$SHA40" > "$tmp/verschachtelt/workflows/w.yml"
+printf '      - uses: actions/setup-node@v7\n' > "$tmp/verschachtelt/actions/setup/action.yml"
+bash scripts/ci/actions-pinned.sh "$tmp/verschachtelt" > "$tmp/verschachtelt.log" 2>&1
+got=$?
+if [ "$got" -ne 1 ]; then
+  echo "FEHLER composite-action: Exit $got, erwartet 1"; sed 's/^/    /' "$tmp/verschachtelt.log"; fails=$((fails + 1))
+else
+  echo "ok   composite-action wird mitgeprueft (Exit $got)"
+fi
+
+mkdir -p "$tmp/leer"
+bash scripts/ci/actions-pinned.sh "$tmp/leer" > "$tmp/leer.log" 2>&1
+got=$?
+if [ "$got" -ne 2 ]; then
+  echo "FEHLER leeres-verzeichnis: Exit $got, erwartet 2"; fails=$((fails + 1))
+else
+  echo "ok   leeres-verzeichnis (Exit $got)"
+fi
+
+[ "$fails" -eq 0 ] && echo "alle Faelle grün" || echo "$fails Fall/Faelle rot"
+[ "$fails" -eq 0 ]
diff --git a/scripts/test-workflow-shell.sh b/scripts/test-workflow-shell.sh
new file mode 100755
index 0000000..38ff8e1
--- /dev/null
+++ b/scripts/test-workflow-shell.sh
@@ -0,0 +1,152 @@
+#!/usr/bin/env bash
+# Selbsttest fuer scripts/ci/workflow-shell.sh. Ein Gate, das nicht scheitern
+# kann, prueft nichts (AGENTS.md, Regel 2) - hier scheitert es einmal
+# absichtlich, und der wichtigste Fall ist der letzte: ein `defaults:`-Block
+# INNERHALB eines Jobs haertet nur diesen Job und darf nicht durchgehen.
+set -uo pipefail
+cd "$(dirname "$0")/.." || exit 1
+tmp="$(mktemp -d)"
+trap 'rm -rf "$tmp"' EXIT
+fails=0
+
+check() { # name erwarteter_exit inhalt
+  local name="$1" want="$2" body="$3"
+  local d="$tmp/$name"
+  mkdir -p "$d"
+  printf '%s\n' "$body" > "$d/w.yml"
+  bash scripts/ci/workflow-shell.sh "$d" > "$tmp/$name.log" 2>&1
+  local got=$?
+  if [ "$got" -ne "$want" ]; then
+    echo "FEHLER $name: Exit $got, erwartet $want"; sed 's/^/    /' "$tmp/$name.log"; fails=$((fails + 1))
+  else
+    echo "ok   $name (Exit $got)"
+  fi
+}
+
+check "gehaertet" 0 'name: x
+defaults:
+  run:
+    shell: bash
+
+jobs:
+  a:
+    runs-on: ubuntu-latest'
+
+check "fehlt-ganz" 1 'name: x
+
+jobs:
+  a:
+    runs-on: ubuntu-latest'
+
+check "defaults-ohne-shell" 1 'name: x
+defaults:
+  run:
+    working-directory: src-tauri
+
+jobs:
+  a:
+    runs-on: ubuntu-latest'
+
+check "andere-shell" 1 'name: x
+defaults:
+  run:
+    shell: pwsh
+
+jobs:
+  a:
+    runs-on: ubuntu-latest'
+
+# Der Fall, der die Regex-Variante schlagen wuerde: auf Job-Ebene sieht der
+# Block identisch aus, haertet aber nur diesen einen Job.
+check "nur-job-ebene" 1 'name: x
+
+jobs:
+  a:
+    runs-on: ubuntu-latest
+    defaults:
+      run:
+        shell: bash'
+
+# --------------------------------------------------------------------------
+# Die Geschwisterstelle: `defaults: run: shell: bash` zwingt AUCH auf
+# windows-latest jeden run-Schritt auf Git-Bash. Ein pwsh-Schritt ohne eigenes
+# `shell:` lief davor richtig und danach unter bash — gemessen am 21.09. beim
+# Merge von main (`Gate - native Parent-Host-Prozessgrenze` in ci.yml).
+# --------------------------------------------------------------------------
+check "pwsh-ohne-shell" 1 'name: x
+defaults:
+  run:
+    shell: bash
+
+jobs:
+  a:
+    runs-on: windows-latest
+    steps:
+      - name: nativ
+        run: |
+          cargo build --bin pa-capture-host
+          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'
+
+check "pwsh-mit-shell" 0 'name: x
+defaults:
+  run:
+    shell: bash
+
+jobs:
+  a:
+    runs-on: windows-latest
+    steps:
+      - name: nativ
+        shell: pwsh
+        run: |
+          cargo build --bin pa-capture-host
+          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'
+
+# Falsch-positiv-Gegenprobe: ein KOMMENTAR, der $LASTEXITCODE nur erklaert,
+# ist kein PowerShell-Schritt. Genau daran schlug der Detektor beim ersten
+# Entwurf an — an der Prosa, die ihn begruendet.
+check "kommentar-ueber-lastexitcode" 0 'name: x
+defaults:
+  run:
+    shell: bash
+
+jobs:
+  a:
+    runs-on: ubuntu-latest
+    steps:
+      - name: harmlos
+        run: echo hallo
+      # Hinweis: $LASTEXITCODE gibt es in bash nicht.
+      - name: auch harmlos
+        run: echo tschuess'
+
+# Und die Zuordnung muss stimmen: der Marker im ZWEITEN Schritt darf nicht dem
+# ersten angelastet werden, der sein `shell:` ordentlich traegt.
+check "marker-trifft-den-richtigen-schritt" 1 'name: x
+defaults:
+  run:
+    shell: bash
+
+jobs:
+  a:
+    runs-on: windows-latest
+    steps:
+      - name: erster
+        shell: pwsh
+        run: Write-Host eins
+      - name: zweiter
+        run: Write-Host zwei'
+
+# Leeres Verzeichnis: Exit 2, nicht 0. Sonst waere ein Tippfehler im Pfad ein
+# gruenes Gate.
+mkdir -p "$tmp/leer"
+bash scripts/ci/workflow-shell.sh "$tmp/leer" > "$tmp/leer.log" 2>&1
+got=$?
+if [ "$got" -ne 2 ]; then
+  echo "FEHLER leeres-verzeichnis: Exit $got, erwartet 2"; fails=$((fails + 1))
+else
+  echo "ok   leeres-verzeichnis (Exit $got)"
+fi
+
+[ "$fails" -eq 0 ] && echo "alle Faelle grün" || echo "$fails Fall/Faelle rot"
+[ "$fails" -eq 0 ]
```
