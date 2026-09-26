# Dual-Review vor dem Merge: PR #39 (CI-Umbau) in ProjectA — Teil A von 3

**Teil A: Der Bahn-Runner, sein Selbsttest und die Hooks.**

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

Hier liegt der Single Point of Failure: `gates.sh`. Kann eine Bahn leer sein? Wird ein rotes Gate immer nach aussen gemeldet? Die Liste wird mit `cut -d'|'` zerlegt und mit `eval` ausgefuehrt. Der Arbeitsbaum-Waechter vergleicht Mengen vor/nach dem Lauf — kann er falsch-positiv werden? Die Pflichtliste in `test-gates.sh` soll verhindern, dass ein Gate still verschwindet: ist sie vollstaendig, und was schuetzt sie NICHT?


```diff
diff --git a/.githooks/pre-commit b/.githooks/pre-commit
index e8c1b00..ab82f0c 100755
--- a/.githooks/pre-commit
+++ b/.githooks/pre-commit
@@ -1,24 +1,15 @@
 #!/usr/bin/env bash
-# .githooks/pre-commit — schnelle Gates vor jedem Commit.
-# Laueft unter Git Bash (Windows) und Linux. Aktivierung: git config core.hooksPath .githooks
+# .githooks/pre-commit — die schnelle Bahn vor jedem Commit.
+#
+# Der Hook fuehrt keine eigene Gate-Liste mehr. Bis zum 09.09. tat er es, und
+# sie wich von allen anderen ab: hier `cargo check`, in pre-push `cargo test`,
+# in CI `cargo nextest run --profile ci`, in AGENTS.md wieder etwas anderes.
+# Die Liste steht jetzt einmal in scripts/ci/gates.sh; was hier laeuft, ist
+# genau die Bahn `precommit` daraus.
+#
+# Nachsehen, was das ist:  bash scripts/ci/gates.sh --list precommit
+# Aktivierung: git config core.hooksPath .githooks (scripts/install-hooks.sh)
 set -e
 
-echo "[pre-commit] cargo fmt --check (src-tauri) ..."
-( cd src-tauri && cargo fmt --check ) || {
-  echo "[pre-commit] FEHLER: cargo fmt --check fehlgeschlagen. Fix: cd src-tauri && cargo fmt" >&2
-  exit 1
-}
-
-echo "[pre-commit] cargo check (src-tauri) ..."
-( cd src-tauri && cargo check ) || {
-  echo "[pre-commit] FEHLER: cargo check fehlgeschlagen. Details oben." >&2
-  exit 1
-}
-
-echo "[pre-commit] npm run typecheck ..."
-npm run typecheck || {
-  echo "[pre-commit] FEHLER: npm run typecheck fehlgeschlagen. Details oben." >&2
-  exit 1
-}
-
-echo "[pre-commit] OK — alle Gates gruen."
+ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
+exec bash "$ROOT/scripts/ci/gates.sh" lane precommit
diff --git a/.githooks/pre-push b/.githooks/pre-push
index 1b9453c..e7a8572 100755
--- a/.githooks/pre-push
+++ b/.githooks/pre-push
@@ -1,35 +1,25 @@
 #!/usr/bin/env bash
-# .githooks/pre-push — volle Gates vor jedem Push.
-# Laueft unter Git Bash (Windows) und Linux. Aktivierung: git config core.hooksPath .githooks
+# .githooks/pre-push — die volle lokale Bahn vor jedem Push.
+#
+# Wie pre-commit: keine eigene Liste mehr, sondern die Bahn `prepush` aus
+# scripts/ci/gates.sh. Zwei Aenderungen gegenueber der alten Fassung, beide
+# beabsichtigt:
+#
+#   - `cargo test` wird zu `cargo nextest run --profile ci`. Das ist, was CI
+#     misst: eigener Prozess je Test, keine Retries, harter slow-timeout.
+#     Vorher belegte ein gruener Push etwas anderes als ein gruener CI-Lauf.
+#     Fehlt nextest: `cargo install cargo-nextest --locked` (gates.sh sagt es
+#     im Fehlerfall selbst). KEIN stiller Rueckfall auf `cargo test` — das
+#     waere genau die Drift zurueck.
+#   - `npm run test:hq` kommt dazu (12 node:test-Dateien unter scripts/lib/),
+#     das lief bis zum 09.09. in keinem Hook und in keinem Workflow.
+#
+# Das Unset von GIT_DIR & Co. steht jetzt in gates.sh, nicht mehr hier: von
+# dort aus starten die Tests, und der naechste Aufrufer soll nicht erneut
+# darueber stolpern (AGENTS.md, Regel 5).
+#
+# Nachsehen, was das ist:  bash scripts/ci/gates.sh --list prepush
 set -e
 
-# Git exports GIT_DIR into hook subprocesses. cargo test then spawns
-# `git -C <temp> init`, which would lock this repository's config instead of
-# the throwaway repo. Drop the hook identity for child git.
-unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
-
-echo "[pre-push] cargo clippy --all-targets -- -D warnings (src-tauri) ..."
-( cd src-tauri && cargo clippy --all-targets -- -D warnings ) || {
-  echo "[pre-push] FEHLER: cargo clippy fehlgeschlagen (-D warnings). Details oben." >&2
-  exit 1
-}
-
-echo "[pre-push] cargo test (src-tauri) ..."
-( cd src-tauri && cargo test ) || {
-  echo "[pre-push] FEHLER: cargo test fehlgeschlagen. Details oben." >&2
-  exit 1
-}
-
-echo "[pre-push] npm run lint ..."
-npm run lint || {
-  echo "[pre-push] FEHLER: npm run lint fehlgeschlagen. Details oben." >&2
-  exit 1
-}
-
-echo "[pre-push] npm test ..."
-npm test || {
-  echo "[pre-push] FEHLER: npm test fehlgeschlagen. Details oben." >&2
-  exit 1
-}
-
-echo "[pre-push] OK — alle Gates gruen."
+ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
+exec bash "$ROOT/scripts/ci/gates.sh" lane prepush
diff --git a/scripts/ci/doctor.sh b/scripts/ci/doctor.sh
new file mode 100755
index 0000000..9240172
--- /dev/null
+++ b/scripts/ci/doctor.sh
@@ -0,0 +1,211 @@
+#!/usr/bin/env bash
+# doctor.sh — was kann DIESE Maschine belegen, und was nicht?
+#
+# Die Frage ist nicht rhetorisch. Seit der Linux-Server am 09.09. geloescht
+# wurde (STAND.md §5), gibt es fuer die #[cfg(unix)]-Rot-Laeufe lokal keinen
+# Ort mehr ausser WSL2. CI laeuft (die Behauptung, das Actions-Kontingent sei
+# erschoepft, stand seit dem 08.09. ungeprueft in STAND.md und war falsch), aber
+# sie laeuft erst NACH dem Push und kostet Minuten. Wer nicht weiss, welche
+# Haelfte seine Maschine abdeckt, haelt einen halben Beleg fuer einen ganzen.
+#
+# Das Skript aendert nichts. Es sagt, was da ist, was fehlt, und mit welchem
+# Befehl man die Luecke schliesst.
+#
+# Aufruf: bash scripts/ci/doctor.sh
+set -uo pipefail
+
+ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
+cd "$ROOT" || exit 1
+
+luecken=0
+warnungen=0
+
+os_kind() {
+  case "$(uname -s 2>/dev/null || echo unbekannt)" in
+    Linux) echo linux ;;
+    Darwin) echo macos ;;
+    MINGW* | MSYS* | CYGWIN*) echo windows ;;
+    *) echo unbekannt ;;
+  esac
+}
+
+OS="$(os_kind)"
+IN_WSL=0
+if [ "$OS" = linux ] && grep -qi microsoft /proc/version 2>/dev/null; then
+  IN_WSL=1
+fi
+
+zeile() { printf ' %-12s %-14s %s\n' "$1" "$2" "${3:-}"; }
+
+# pflicht <name> <befehl> <version-args...> — fehlt es, ist eine Bahn nicht
+# lauffaehig. hinweis() liefert danach den Installationsbefehl.
+pruefe() { # art name befehl [version-args...]
+  local art="$1" name="$2" cmd="$3"
+  shift 3
+  local out
+  if ! command -v "$cmd" > /dev/null 2>&1; then
+    zeile "$name" "FEHLT" ""
+    [ "$art" = pflicht ] && luecken=$((luecken + 1)) || warnungen=$((warnungen + 1))
+    return 1
+  fi
+  if [ $# -gt 0 ]; then
+    out="$("$cmd" "$@" 2>&1)" || {
+      zeile "$name" "FEHLT" "(Unterkommando nicht vorhanden)"
+      [ "$art" = pflicht ] && luecken=$((luecken + 1)) || warnungen=$((warnungen + 1))
+      return 1
+    }
+    zeile "$name" "da" "$(printf '%s' "$out" | head -1)"
+  else
+    zeile "$name" "da" "$(command -v "$cmd")"
+  fi
+  return 0
+}
+
+echo "=============================================================="
+echo " doctor.sh — was diese Maschine belegen kann"
+echo "=============================================================="
+echo
+echo "Plattform: $(uname -s -r 2>/dev/null || echo unbekannt) -> $OS$([ "$IN_WSL" -eq 1 ] && echo ' (WSL)')"
+echo
+
+echo "--- Werkzeuge fuer die Gates ---"
+pruefe pflicht "git" git --version
+node_ok=0
+if pruefe pflicht "node" node --version; then node_ok=1; fi
+pruefe pflicht "npm" npm --version
+pruefe pflicht "cargo" cargo --version
+pruefe pflicht "rustc" rustc --version
+nextest_ok=0
+if pruefe pflicht "nextest" cargo nextest --version; then nextest_ok=1; fi
+audit_ok=0
+if pruefe kann "cargo-audit" cargo audit --version; then audit_ok=1; fi
+
+# package.json verlangt Node 24. Eine aeltere Major-Version laeuft oft, misst
+# aber nicht dasselbe wie der Runner — das gehoert gesagt, nicht verschwiegen.
+if [ "$node_ok" -eq 1 ]; then
+  major="$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
+  soll="$(sed -n 's/.*"node": ">=\([0-9]*\)".*/\1/p' package.json | head -1)"
+  if [ -n "$major" ] && [ -n "$soll" ] && [ "$major" -lt "$soll" ]; then
+    echo
+    echo " ACHTUNG: node $major, package.json verlangt >=$soll. Die Gates laufen"
+    echo "          vermutlich, messen aber nicht dasselbe wie der Runner."
+    warnungen=$((warnungen + 1))
+  fi
+fi
+
+echo
+echo "--- Zustand des Clones ---"
+if [ -d node_modules ]; then
+  zeile "node_modules" "da" ""
+else
+  zeile "node_modules" "FEHLT" "npm ci"
+  luecken=$((luecken + 1))
+fi
+
+hooks="$(git config --get core.hooksPath 2>/dev/null || true)"
+if [ "$hooks" = ".githooks" ]; then
+  zeile "Git-Hooks" "aktiv" "core.hooksPath=$hooks"
+else
+  zeile "Git-Hooks" "INAKTIV" "bash scripts/install-hooks.sh"
+  luecken=$((luecken + 1))
+fi
+
+# Der Browser-Smoke faellt sonst erst nach allen billigen Gates auf.
+if [ -d "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" ] ||
+  [ -d "$HOME/AppData/Local/ms-playwright" ]; then
+  zeile "Chromium" "da" ""
+else
+  zeile "Chromium" "fehlt?" "npx playwright install chromium$([ "$OS" = linux ] && echo ' --with-deps')"
+  warnungen=$((warnungen + 1))
+fi
+
+echo
+echo "--- Welche Bahn laeuft hier? ---"
+for lane in precommit prepush linux windows release audit; do
+  ids="$(bash scripts/ci/gates.sh --list "$lane" 2>/dev/null)"
+  n="$(printf '%s\n' "$ids" | grep -c . || true)"
+  urteil="lauffaehig"
+  case "$lane" in
+    windows) [ "$OS" = windows ] || urteil="laeuft, belegt aber nur was auf $OS gilt" ;;
+    linux | release) [ "$OS" = linux ] || urteil="laeuft, aber ohne die cfg(unix)-Tests" ;;
+  esac
+  # Ein fehlendes Werkzeug macht die Bahn nicht "lauffaehig" - sie waere
+  # sofort rot. Das gehoert hier gesagt, nicht erst nach 20 Minuten.
+  ids_csv=",$(printf '%s' "$ids" | tr '\n' ','),"
+  case "$ids_csv" in *,rust-suite,*) [ "$nextest_ok" -eq 1 ] || urteil="BLOCKIERT (nextest fehlt: cargo install cargo-nextest --locked)" ;; esac
+  case "$ids_csv" in *,audit-rust,*) [ "$audit_ok" -eq 1 ] || urteil="BLOCKIERT (cargo-audit fehlt: cargo install cargo-audit)" ;; esac
+  printf ' %-10s %2d Gates  %s\n' "$lane" "$n" "$urteil"
+done
+
+echo
+echo "--- Die andere Plattformhaelfte ---"
+case "$OS" in
+  windows)
+    echo " Diese Maschine ist die Zielplattform. Es fehlen die"
+    echo " #[cfg(unix)]-Tests (Dateirechte, Prozessgruppen-Kill) und die"
+    echo " Linux-Arme von clippy — sie kompilieren unter Windows nicht."
+    if command -v wsl.exe > /dev/null 2>&1; then
+      zeile "WSL" "da" "Clone auf ext4 anlegen, dort: bash scripts/ci/gates.sh lane linux"
+    else
+      zeile "WSL" "FEHLT" "wsl --install    (danach Clone auf ext4, NICHT unter /mnt/c)"
+      warnungen=$((warnungen + 1))
+    fi
+    ;;
+  linux)
+    if [ "$IN_WSL" -eq 1 ]; then
+      echo " WSL: das ist der Linux-Belegpfad seit der Server-Loeschung (STAND.md §5)."
+      case "$ROOT" in
+        /mnt/*)
+          echo
+          echo " ACHTUNG: der Clone liegt unter $ROOT, also auf dem Windows-Dateisystem."
+          echo "          cargo ist dort um Faktoren langsamer und das x-Bit geht"
+          echo "          verloren — genau die Hook-Falle vom 31.08.-07.09."
+          echo "          Clone nach ~/ (ext4) legen."
+          warnungen=$((warnungen + 1))
+          ;;
+      esac
+    else
+      echo " Diese Maschine ist Linux. Es fehlen die #[cfg(windows)]-Tests"
+      echo " (run_in_pty, npm_shim, ConPTY, DPAPI) und die Windows-Arme von"
+      echo " clippy. Die deckt nur der Windows-PC ab: dort in Git-Bash"
+      echo "   bash scripts/ci/gates.sh lane windows"
+    fi
+    ;;
+  *)
+    echo " '$OS' ist weder Zielplattform noch Linux-Belegpfad — ein Lauf hier"
+    echo " belegt fuer das Produkt wenig."
+    ;;
+esac
+
+echo
+echo "--- act (Workflow-Emulation, optional) ---"
+# act ist KEIN Belegpfad, und das ist eine bewusste Entscheidung, kein
+# Versaeumnis: es kann keine windows-latest-Jobs, ignoriert `environment:`
+# (die Secret-Haertung von review.yml waere lokal ausgehebelt) und hat kein
+# GitHub-OIDC. Es beweist Workflow-SYNTAX, nicht Gate-Aequivalenz.
+if command -v act > /dev/null 2>&1; then
+  zeile "act" "da" "$(act --version 2>&1 | head -1)"
+else
+  zeile "act" "fehlt" "optional — siehe docs/ci-lokal.md"
+fi
+if command -v docker > /dev/null 2>&1 && docker info > /dev/null 2>&1; then
+  zeile "docker" "laeuft" ""
+elif command -v docker > /dev/null 2>&1; then
+  zeile "docker" "da, aus" "Daemon starten (act braucht ihn)"
+else
+  zeile "docker" "fehlt" "optional — act braucht ihn"
+fi
+echo " act ist die Kuer, nicht die Pflicht. Was es NICHT kann und warum:"
+echo " docs/ci-lokal.md"
+
+echo
+echo "=============================================================="
+if [ "$luecken" -gt 0 ]; then
+  echo " $luecken Luecke(n), $warnungen Hinweis(e) — oben steht je der Befehl."
+  exit 1
+fi
+echo " Keine Luecke, $warnungen Hinweis(e). Naechster Schritt:"
+case "$OS" in
+  windows) echo "   bash scripts/ci/gates.sh lane prepush" ;;
+  *) echo "   bash scripts/ci/gates.sh lane linux" ;;
+esac
diff --git a/scripts/ci/gates.sh b/scripts/ci/gates.sh
new file mode 100755
index 0000000..69b3b6e
--- /dev/null
+++ b/scripts/ci/gates.sh
@@ -0,0 +1,440 @@
+#!/usr/bin/env bash
+# gates.sh — die EINZIGE Quelle der Gate-Liste.
+#
+# Warum es dieses Skript gibt: die Liste stand bis zum 09.09. fuenffach da —
+# in .githooks/pre-commit, .githooks/pre-push, ci.yml, release.yml und als
+# Prosa in AGENTS.md — und sie driftete nachweislich. pre-push fuhr
+# `cargo test`, CI `cargo nextest run --profile ci` (geteilter Prozess statt
+# Prozess pro Test, kein slow-timeout); release.yml fuhr weder `lint` noch
+# `test:e2e` noch `no-masked-output` und war damit schwaecher gegatet als ein
+# PR; `npm run test:hq` (12 node:test-Dateien unter scripts/lib/) lief
+# ueberhaupt nirgends.
+#
+# Was lokal vor dem Push gruen war, war also nicht das, was CI misst. Deshalb
+# ruft ci.yml jetzt eine ganze BAHN auf statt einzelner Schritte:
+#
+#     - name: Gates (linux)
+#       run: bash scripts/ci/gates.sh lane linux
+#
+# Es gibt damit keine Gate-Liste mehr im YAML, die abweichen KOENNTE. Drift ist
+# nicht geprueft, sondern unmoeglich — das ist der Unterschied zu einem
+# Drift-Waechter, der selbst falsch sein kann.
+#
+# Aufrufe:
+#   gates.sh lane <bahn>          alle Gates der Bahn, billig -> teuer
+#   gates.sh run <id> [<id>...]   einzelne Gates
+#   gates.sh --list [bahn]        nur auflisten, nichts ausfuehren
+#   gates.sh --from <id> lane <b> ab diesem Gate weiter (nach einem Fehlschlag)
+#
+# Selbsttest: scripts/test-gates.sh
+set -uo pipefail
+
+# Git exportiert GIT_DIR & Co. in Hook-Unterprozesse. `cargo test` startet
+# darunter ein `git -C <temp> init`, das sonst die Konfiguration DIESES Repos
+# sperrt statt der des Wegwerf-Repos. Das Unset stand bisher nur in
+# .githooks/pre-push — hier ist es richtig, denn jetzt laufen die Tests von
+# hier aus (AGENTS.md, Regel 5: nach einem Fix nach Geschwistern suchen).
+unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
+
+ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
+cd "$ROOT" || exit 1
+
+# --------------------------------------------------------------------------
+# Die Liste. Format: id | bahnen (komma) | arbeitsverzeichnis | befehl
+#
+# Reihenfolge = Ausfuehrungsreihenfolge, billig -> teuer (docs/decisions.md):
+# ein kaputtes Frontend soll nicht erst nach clippy und der ganzen Rust-Suite
+# sichtbar werden, und eine gesparte Minute ist eine gesparte Minute.
+#
+# Der urspruengliche Kommentar begruendete das mit "seit das Actions-Kontingent
+# aufgebraucht ist". Das war falsch (Korrektur auf main, 09.09.: das Kontingent
+# war nie erschoepft, es hatte nur niemand `gh run list` aufgerufen). Die
+# Reihenfolge bleibt trotzdem richtig - sie steht hier fuer die schnelle
+# Rueckmeldung, nicht fuer eine Notlage.
+#
+# Sie liegt als Array IN diesem Skript, nicht als eigene Datei: `.gitattributes`
+# erzwingt LF nur fuer `*.sh`, ein Manifest mit anderer Endung kaeme vom
+# Windows-Editor mit CRLF zurueck und `read -r` haette ein \r am Zeilenende.
+# --------------------------------------------------------------------------
+GATES=(
+  # --- Sekunden: die Workflow-Gates und ihre eigenen Selbsttests -----------
+  "no-masked|linux,release|.|bash scripts/ci/no-masked-output.sh"
+  "wf-shell|linux,release|.|bash scripts/ci/workflow-shell.sh"
+  "wf-pinned|linux,release|.|bash scripts/ci/actions-pinned.sh"
+  # Die Selbsttests belegen, dass die drei Gates ueberhaupt scheitern KOENNEN
+  # (AGENTS.md, Regel 2). ci.yml berief sich auf sie als Begruendung, warum
+  # man dem Detektor trauen darf — ausgefuehrt wurden sie nie.
+  "selftest-gates|linux,release|.|bash scripts/test-no-masked-output.sh && bash scripts/test-workflow-shell.sh && bash scripts/test-actions-pinned.sh"
+  # Selbsttest des Test-First-Gates: red-first.sh wertet lange Logs aus, und
+  # genau dort war die Auswertung schon einmal falsch. Stand auf main als
+  # eigener ci.yml-Schritt und waere beim Umbau auf Bahnen verloren gegangen.
+  "selftest-red-first|linux,release|.|bash scripts/test-red-first-output.sh"
+  # Der Review-Transport ist der Weg, auf dem die Dual-Review-Pflicht
+  # (AGENTS.md) ueberhaupt eingeloest wird. Am 09.09. starb er an einer
+  # Antwort ohne Inhalt und schrieb fuer KEINEN Reviewer ein Protokoll.
+  # Laeuft gegen einen lokalen Server: kein Netz, kein Secret, keine
+  # Modellminute.
+  "selftest-review|linux,release|.|bash scripts/test-review-transport.sh"
+
+  # --- schnell: Form und Typen --------------------------------------------
+  "fmt|precommit,prepush,linux,windows,release|src-tauri|cargo fmt --check"
+  "cargo-check|precommit|src-tauri|cargo check"
+  "typecheck|precommit,prepush,linux,release|.|npm run typecheck"
+  "lint|prepush,linux,release|.|npm run lint"
+
+  # --- mittel: die Test-Suiten des Frontends ------------------------------
+  "fe-test|prepush,linux,release|.|npm test"
+  # 12 node:test-Dateien unter scripts/lib/. Standen seit jeher in
+  # package.json und liefen in keinem Workflow und keinem Hook.
+  "hq-test|prepush,linux,release|.|npm run test:hq"
+  # Browser-Smoke des HQ. Kam am 12.09. auf main dazu.
+  "hq-visual|linux,release|.|npm run test:hq:visual"
+  "fe-build|linux,release|.|npm run build"
+  "e2e|linux,release|.|npm run test:e2e"
+
+  # --- teuer: der Rust-Kern -----------------------------------------------
+  "clippy|prepush,linux,windows,release|src-tauri|cargo clippy --all-targets -- -D warnings"
+  # nextest statt cargo test: eigener Prozess je Test (kein geteilter Zustand),
+  # keine Retries im Profil `ci`, harter slow-timeout. pre-push fuhr bis zum
+  # 09.09. `cargo test` und mass damit etwas anderes als CI.
+  "rust-suite|prepush,linux,windows,release|src-tauri|cargo nextest run --profile ci"
+
+  # --- eigene Bahn: das woechentliche Audit -------------------------------
+  "audit-rust|audit|src-tauri|cargo audit"
+  "audit-npm|audit|.|npm audit --audit-level=moderate"
+)
+
+LANES="precommit prepush linux windows release audit"
+
+gate_field() { # zeile feldnummer
+  printf '%s' "$1" | cut -d'|' -f"$2"
+}
+
+lane_exists() {
+  case " $LANES " in *" $1 "*) return 0 ;; esac
+  return 1
+}
+
+gate_ids_for_lane() { # bahn
+  local g id lanes
+  for g in "${GATES[@]}"; do
+    id="$(gate_field "$g" 1)"
+    lanes="$(gate_field "$g" 2)"
+    case ",$lanes," in *",$1,"*) echo "$id" ;; esac
+  done
+}
+
+gate_line_by_id() { # id
+  local g
+  for g in "${GATES[@]}"; do
+    [ "$(gate_field "$g" 1)" = "$1" ] && { printf '%s' "$g"; return 0; }
+  done
+  return 1
+}
+
+# --------------------------------------------------------------------------
+# Umgebung: was diese Maschine ist. Ohne diesen Kopf ist "Gates gruen" eine
+# Behauptung ueber eine unbekannte Umgebung (AGENTS.md, Beweismassstab).
+# --------------------------------------------------------------------------
+os_kind() {
+  case "$(uname -s 2>/dev/null || echo unbekannt)" in
+    Linux) echo linux ;;
+    Darwin) echo macos ;;
+    MINGW* | MSYS* | CYGWIN*) echo windows ;;
+    *) echo unbekannt ;;
+  esac
+}
+
+version_of() { # befehl args...
+  local out
+  if ! command -v "$1" > /dev/null 2>&1; then
+    echo "FEHLT"
+    return
+  fi
+  # `cargo nextest --version` scheitert, wenn das Unterkommando fehlt - der
+  # haeufigste Fall auf einer frischen Maschine. "FEHLER" waere dafuer die
+  # falsche Auskunft.
+  out="$("$@" 2>&1)" || { echo "nicht verfuegbar"; return; }
+  printf '%s' "$out" | head -1
+}
+
+print_header() { # bahn
+  local dirty
+  dirty="$(git status --porcelain 2>/dev/null | head -1)"
+  echo "=============================================================="
+  echo " gates.sh — Bahn: $1"
+  echo "=============================================================="
+  printf ' %-14s %s\n' "Plattform" "$(uname -s -r 2>/dev/null || echo unbekannt) ($(os_kind))"
+  printf ' %-14s %s\n' "node" "$(version_of node --version)"
+  printf ' %-14s %s\n' "npm" "$(version_of npm --version)"
+  printf ' %-14s %s\n' "rustc" "$(version_of rustc --version)"
+  printf ' %-14s %s\n' "nextest" "$(version_of cargo nextest --version)"
+  printf ' %-14s %s\n' "HEAD" "$(git rev-parse --short HEAD 2>/dev/null || echo '-')$([ -n "$dirty" ] && echo ' (uncommitted Aenderungen im Baum)')"
+  echo
+}
+
+# Was dieser Lauf NICHT belegt. Der Block ist der Kern der Ehrlichkeit dieses
+# Werkzeugs: kein einzelner Rechner deckt beide Plattformhaelften ab, und
+# "Vollgates gruen" ohne diese Einschraenkung ist eine Behauptung.
+print_uncovered() { # bahn
+  local os
+  os="$(os_kind)"
+  echo
+  echo "--- NICHT ABGEDECKT von diesem Lauf ---"
+  case "$os" in
+    windows)
+      echo "  Plattform Windows:"
+      echo "    - die #[cfg(unix)]-Tests (Dateirechte, Prozessgruppen-Kill) —"
+      echo "      sie kompilieren unter Windows nicht (KNOWN_ISSUES KI-7)"
+      echo "    - die Linux-Arme von clippy"
+      echo "  Dieser Lauf belegt die Windows-Haelfte, nicht die Linux-Haelfte."
+      echo "  Linux-Haelfte: derselbe Befehl in WSL2 (Clone auf ext4), siehe docs/ci-lokal.md"
+      ;;
+    linux)
+      echo "  Plattform Linux:"
+      echo "    - die #[cfg(windows)]-Tests (run_in_pty, npm_shim, ConPTY, DPAPI)"
+      echo "    - die Windows-Arme von clippy"
+      echo "  Dieser Lauf belegt die Linux-Haelfte, nicht die Windows-Haelfte."
+      echo "  Windows-Haelfte: derselbe Befehl in Git-Bash auf dem Zielrechner."
+      ;;
+    *)
+      echo "  Plattform '$os' ist weder die Zielplattform (Windows) noch der"
+      echo "  Linux-Belegpfad. Dieser Lauf belegt fuer das Produkt wenig."
+      ;;
+  esac
+  case "$1" in
+    precommit | prepush)
+      echo "  Bahn '$1' ist die schnelle Schleife: Browser-Smoke, Frontend-Build"
+      echo "  und die Workflow-Gates laufen erst in der Bahn 'linux'."
+      ;;
+  esac
+  echo "  Der Zustand externer Dienste (Updater-Endpoint, OmniRoute, Mirror)"
+  echo "  wird von keinem Gate geprueft — dafuer ist das Release-Verify da."
+  echo "---------------------------------------"
+}
+
+# --------------------------------------------------------------------------
+# Ausfuehrung
+# --------------------------------------------------------------------------
+in_actions() { [ "${GITHUB_ACTIONS:-}" = "true" ]; }
+
+RESULT_IDS=()
+RESULT_STATES=()
+RESULT_SECONDS=()
+
+run_gate() { # id
+  local line workdir cmd start dur rc
+  if ! line="$(gate_line_by_id "$1")"; then
+    local known
+    known="$(for g in "${GATES[@]}"; do gate_field "$g" 1; done | tr '\n' ' ')"
+    echo "::error::Unbekanntes Gate: $1 (bekannt: $known)" >&2
+    return 2
+  fi
+  workdir="$(gate_field "$line" 3)"
+  cmd="$(gate_field "$line" 4)"
+
+  in_actions && echo "::group::Gate $1 — $cmd"
+  echo ">>> Gate $1: (cd $workdir && $cmd)"
+  start="$(date +%s)"
+  # Kein `| tee`, keine Pipe: der Exit-Code muss unmaskiert ankommen. Das ist
+  # dieselbe Regel, die scripts/ci/no-masked-output.sh fuer die Workflows
+  # erzwingt — sie gilt fuer den Runner selbst genauso.
+  (
+    cd "$ROOT/$workdir" || exit 1
+    eval "$cmd"
+  )
+  rc=$?
+  dur=$(( $(date +%s) - start ))
+  in_actions && echo "::endgroup::"
+
+  RESULT_IDS+=("$1")
+  RESULT_SECONDS+=("$dur")
+  if [ "$rc" -eq 0 ]; then
+    RESULT_STATES+=("gruen")
+    echo "<<< Gate $1: gruen (${dur}s)"
+  else
+    RESULT_STATES+=("ROT($rc)")
+    echo "<<< Gate $1: ROT — Exit $rc (${dur}s)"
+    hint_for "$1"
+  fi
+  return $rc
+}
+
+# Ein rotes Gate soll sagen, was zu tun ist. Der haeufigste Fall auf einer
+# frischen Maschine ist ein fehlendes Werkzeug, nicht ein echter Fehlschlag.
+hint_for() {
+  case "$1" in
+    rust-suite)
+      command -v cargo-nextest > /dev/null 2>&1 || cargo nextest --version > /dev/null 2>&1 || {
+        echo "    Hinweis: cargo-nextest fehlt. Installation:"
+        echo "      cargo install cargo-nextest --locked"
+        echo "    Kein Rueckfall auf 'cargo test': das misst etwas anderes"
+        echo "    (geteilter Prozess, kein slow-timeout) und waere genau die"
+        echo "    Drift, die dieses Skript beseitigt."
+      }
+      ;;
+    e2e)
+      echo "    Hinweis: der Browser-Smoke braucht Chromium — einmalig pro Clone:"
+      echo "      npx playwright install chromium        (Linux: --with-deps)"
+      ;;
+    audit-rust)
+      command -v cargo-audit > /dev/null 2>&1 || echo "    Hinweis: cargo install cargo-audit"
+      ;;
+  esac
+}
+
+# Ein Gate darf den Arbeitsbaum nicht veraendern. Das klingt selbstverstaendlich
+# und war es nicht: `npm run test:hq` startete ueber zwei Tests den hq-live-
+# Server, der beim Start docs/dev-hq/data.json und data.js im ECHTEN Baum
+# neu erzeugte. Solange das Gate nirgends lief, sah es niemand; ab dem
+# Einhaengen war der Baum nach jedem `prepush` dreckig — und eine Warnung, die
+# immer erscheint, wird nicht mehr gelesen.
+#
+# Verglichen werden Mengen VOR und NACH dem Lauf, nicht "Baum sauber":
+# uncommittete eigene Arbeit ist normal und darf den Lauf nicht rot faerben.
+tree_snapshot() {
+  git status --porcelain 2>/dev/null | sort
+}
+
+check_tree_untouched() { # schnappschuss_vorher
+  local nachher neu
+  nachher="$(tree_snapshot)"
+  neu="$(comm -13 <(printf '%s\n' "$1") <(printf '%s\n' "$nachher"))"
+  [ -n "$neu" ] || return 0
+  echo
+  echo "::error::Ein Gate hat den Arbeitsbaum veraendert. Gates duerfen lesen und in ignorierte Verzeichnisse schreiben, aber keine getrackten Dateien anfassen - sonst haengt das Ergebnis davon ab, wie oft man sie laufen laesst."
+  printf '%s\n' "$neu" | sed 's/^/    /'
+  return 1
+}
+
+print_summary() { # bahn geplante_anzahl
+  local i state total=0
+  echo
+  echo "--- Zusammenfassung (Bahn $1) ---"
+  for i in "${!RESULT_IDS[@]}"; do
+    printf ' %-16s %-10s %4ss\n' "${RESULT_IDS[$i]}" "${RESULT_STATES[$i]}" "${RESULT_SECONDS[$i]}"
+    total=$(( total + RESULT_SECONDS[i] ))
+  done
+  printf ' %-16s %-10s %4ss\n' "(gesamt)" "" "$total"
+  if [ "${#RESULT_IDS[@]}" -lt "$2" ]; then
+    echo " $(( $2 - ${#RESULT_IDS[@]} )) Gate(s) nach dem Fehlschlag NICHT mehr gelaufen."
+  fi
+
+  # Dieselbe Tabelle im Actions-UI. Erst in eine Datei, dann anhaengen — eine
+  # Pipe nach $GITHUB_STEP_SUMMARY verschluckte den Exit-Code links davon.
+  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
+    {
+      echo "### Gates — Bahn \`$1\`"
+      echo
+      echo "| Gate | Ergebnis | Dauer |"
+      echo "|---|---|---|"
+      for i in "${!RESULT_IDS[@]}"; do
+        state="${RESULT_STATES[$i]}"
+        [ "$state" = "gruen" ] && state="✅ gruen" || state="❌ $state"
+        echo "| \`${RESULT_IDS[$i]}\` | $state | ${RESULT_SECONDS[$i]}s |"
+      done
+    } >> "$GITHUB_STEP_SUMMARY"
+  fi
+}
+
+usage() {
+  cat <<'USAGE'
+gates.sh — die eine Gate-Quelle fuer CI, Release, Hooks und den lokalen Lauf.
+
+  gates.sh lane <bahn>          alle Gates der Bahn, billig -> teuer
+  gates.sh run <id> [<id>...]   einzelne Gates
+  gates.sh --list [bahn]        auflisten, nichts ausfuehren
+  gates.sh --from <id> lane <b> ab diesem Gate weiter
+
+Bahnen: precommit prepush linux windows release audit
+USAGE
+}
+
+# --------------------------------------------------------------------------
+FROM=""
+while [ $# -gt 0 ]; do
+  case "$1" in
+    --from)
+      FROM="${2:-}"
+      [ -n "$FROM" ] || { echo "--from braucht ein Gate" >&2; exit 2; }
+      shift 2
+      ;;
+    --list)
+      shift
+      if [ $# -gt 0 ]; then
+        lane_exists "$1" || { echo "Unbekannte Bahn: $1 (bekannt: $LANES)" >&2; exit 2; }
+        gate_ids_for_lane "$1"
+      else
+        for g in "${GATES[@]}"; do
+          printf '%-16s %-42s (cd %s && %s)\n' "$(gate_field "$g" 1)" "$(gate_field "$g" 2)" "$(gate_field "$g" 3)" "$(gate_field "$g" 4)"
+        done
+      fi
+      exit 0
+      ;;
+    -h | --help)
+      usage
+      exit 0
+      ;;
+    lane)
+      lane="${2:-}"
+      lane_exists "$lane" || { echo "Unbekannte Bahn: '${lane:-}' (bekannt: $LANES)" >&2; exit 2; }
+      ids=()
+      while IFS= read -r id; do [ -n "$id" ] && ids+=("$id"); done < <(gate_ids_for_lane "$lane")
+      # Eine leere Bahn waere ein gruener Lauf ohne ein einziges Gate — genau
+      # das Muster "gruen durch Abwesenheit" (AGENTS.md, Regel 2).
+      [ "${#ids[@]}" -gt 0 ] || { echo "::error::Bahn '$lane' enthaelt kein Gate."; exit 2; }
+      if [ -n "$FROM" ]; then
+        gate_line_by_id "$FROM" > /dev/null || { echo "--from: unbekanntes Gate '$FROM'" >&2; exit 2; }
+        rest=()
+        seen=0
+        for id in "${ids[@]}"; do
+          [ "$id" = "$FROM" ] && seen=1
+          [ "$seen" -eq 1 ] && rest+=("$id")
+        done
+        [ "${#rest[@]}" -gt 0 ] || { echo "--from: '$FROM' liegt nicht in der Bahn '$lane'" >&2; exit 2; }
+        ids=("${rest[@]}")
+      fi
+      print_header "$lane"
+      tree_before="$(tree_snapshot)"
+      status=0
+      for id in "${ids[@]}"; do
+        if ! run_gate "$id"; then status=1; break; fi
+      done
+      print_summary "$lane" "${#ids[@]}"
+      check_tree_untouched "$tree_before" || status=1
+      print_uncovered "$lane"
+      exit "$status"
+      ;;
+    run)
+      shift
+      [ $# -gt 0 ] || { echo "run braucht mindestens ein Gate" >&2; exit 2; }
+      # Unbekannte Gates sind ein Aufruffehler und werden VOR dem ersten Lauf
+      # abgelehnt — sonst faende man den Tippfehler erst nach 20 Minuten
+      # Rust-Suite, und der Exit-Code saehe aus wie ein fachlicher Fehlschlag.
+      for id in "$@"; do
+        gate_line_by_id "$id" > /dev/null || {
+          known="$(for g in "${GATES[@]}"; do gate_field "$g" 1; done | tr '\n' ' ')"
+          echo "Unbekanntes Gate: $id (bekannt: $known)" >&2
+          exit 2
+        }
+      done
+      print_header "run"
+      status=0
+      count=$#
+      for id in "$@"; do
+        if ! run_gate "$id"; then status=1; break; fi
+      done
+      print_summary "run" "$count"
+      print_uncovered "run"
+      exit "$status"
+      ;;
+    *)
+      echo "Unbekanntes Argument: $1" >&2
+      usage >&2
+      exit 2
+      ;;
+  esac
+done
+
+usage >&2
+exit 2
diff --git a/scripts/install-hooks.sh b/scripts/install-hooks.sh
index df7ee80..40eb517 100755
--- a/scripts/install-hooks.sh
+++ b/scripts/install-hooks.sh
@@ -8,20 +8,36 @@ echo "core.hooksPath=$(git -C "$ROOT" config --get core.hooksPath)"
 # Härte-Check (Regel-Review 09.09.): hooksPath allein genügt nicht — die Hooks
 # müssen im Index 100755 UND lokal ausführbar sein. Beides fehlte vom 31.08.
 # bis 07.09. (62214c8): hooksPath war gesetzt, die Hooks liefen bei niemandem.
+# Geprüft werden nicht nur die Hooks selbst: seit 09.09. rufen sie
+# scripts/ci/gates.sh auf, und die Proben unter scripts/ werden direkt
+# gestartet. Vom Windows-PC committet Git bei core.fileMode=false sonst
+# 100644, und `./scripts/ci/gates.sh` läuft dann bei niemandem —
+# derselbe Fehler wie bei den Hooks vom 31.08. bis 07.09., nur eine Ebene
+# weiter (AGENTS.md, Regel 5: nach einem Fix nach Geschwistern suchen).
 problem=0
-for hook in "$ROOT"/.githooks/*; do
-  name="$(basename "$hook")"
-  mode="$(git -C "$ROOT" ls-files -s -- ".githooks/$name" | cut -d' ' -f1)"
+check_mode() { # repo-relativer Pfad
+  local rel="$1" abs="$ROOT/$1" mode
+  [ -e "$abs" ] || return 0
+  mode="$(git -C "$ROOT" ls-files -s -- "$rel" | cut -d' ' -f1)"
+  [ -n "$mode" ] || return 0   # nicht im Index: nichts zu korrigieren
   if [ "$mode" != "100755" ]; then
-    echo "WARNUNG: .githooks/$name hat Index-Modus ${mode:-fehlt} statt 100755 — der Hook würde nicht laufen."
-    git -C "$ROOT" update-index --chmod=+x ".githooks/$name"
+    echo "WARNUNG: $rel hat Index-Modus $mode statt 100755 — es würde bei niemandem laufen."
+    git -C "$ROOT" update-index --chmod=+x "$rel"
     echo "  Index korrigiert (update-index --chmod=+x) — bitte committen."
     problem=1
   fi
-  if [ ! -x "$hook" ]; then
-    chmod +x "$hook"
-    echo "  lokales x-Bit für $name gesetzt."
+  if [ ! -x "$abs" ]; then
+    chmod +x "$abs"
+    echo "  lokales x-Bit für $rel gesetzt."
   fi
+}
+
+for hook in "$ROOT"/.githooks/*; do
+  check_mode ".githooks/$(basename "$hook")"
+done
+for script in "$ROOT"/scripts/ci/*.sh "$ROOT"/scripts/test-*.sh; do
+  [ -e "$script" ] || continue
+  check_mode "scripts/${script#"$ROOT/scripts/"}"
 done
 if [ "$problem" -eq 0 ]; then
   echo "Hook-Modi: OK (100755 im Index)."
diff --git a/scripts/lib/hq-visual.browser.mjs b/scripts/lib/hq-visual.browser.mjs
index eff5f35..acb6186 100644
--- a/scripts/lib/hq-visual.browser.mjs
+++ b/scripts/lib/hq-visual.browser.mjs
@@ -141,6 +141,13 @@ function startHq() {
       env: {
         ...process.env,
         HQ_PORT: "0",
+        // Ohne das schreibt hq-live beim Start docs/dev-hq/data.{js,json} im
+        // ECHTEN Baum neu — der Test macht den Arbeitsbaum dreckig, und das
+        // Ergebnis haengt davon ab, wie oft man ihn laufen laesst. Dieselbe
+        // Stelle wie in hq-routes.test.mjs und hq-security.test.mjs; hier
+        // fehlte sie, und der Waechter in scripts/ci/gates.sh hat sie am
+        // 21.09. gefunden, als das Gate zum ersten Mal in einer Bahn lief.
+        HQ_SKIP_SNAPSHOT: "1",
         PROJECTA_API_DESCRIPTOR: join(agentsDir, "descriptor.json"),
         PROJECTA_AGENTS_FILE: join(agentsDir, "agents.json"),
         HQ_LESSONS_FILE: join(agentsDir, "lessons.json"),
diff --git a/scripts/test-gates.sh b/scripts/test-gates.sh
new file mode 100755
index 0000000..c57802f
--- /dev/null
+++ b/scripts/test-gates.sh
@@ -0,0 +1,196 @@
+#!/usr/bin/env bash
+# Selbsttest fuer scripts/ci/gates.sh.
+#
+# Ein Runner, der die Gates ausfuehrt, aber ein rotes Gate nicht nach aussen
+# meldet, ist schlimmer als kein Runner: er macht aus einem Fehlschlag ein
+# gruenes Haekchen. "Eine Pruefung, die nicht scheitern kann, prueft nichts"
+# (AGENTS.md, Regel 2) — hier scheitert sie mehrfach absichtlich.
+#
+# Der Kern des Tests laeuft gegen eine KOPIE von gates.sh in einem Wegwerf-Repo,
+# in die synthetische Gates eingeschleust werden (true / exit 3). Damit wird die
+# echte Ausfuehrungslogik geprueft, ohne dass der Selbsttest 20 Minuten
+# Rust-Suite braucht.
+set -uo pipefail
+HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
+cd "$HERE" || exit 1
+tmp="$(mktemp -d)"
+trap 'rm -rf "$tmp"' EXIT
+fails=0
+
+ok()   { echo "ok   $*"; }
+bad()  { echo "FEHLER $*"; fails=$((fails + 1)); }
+
+# --------------------------------------------------------------------------
+# Teil 1: das echte Skript — Struktur der Liste
+# --------------------------------------------------------------------------
+LANES="precommit prepush linux windows release audit"
+
+for lane in $LANES; do
+  lane_ids="$(bash scripts/ci/gates.sh --list "$lane")"
+  n="$(printf '%s\n' "$lane_ids" | grep -c . || true)"
+  if [ "$n" -gt 0 ]; then
+    ok "Bahn $lane ist nicht leer ($n Gates)"
+  else
+    bad "Bahn $lane ist LEER — ein Lauf ohne ein einziges Gate waere gruen durch Abwesenheit"
+  fi
+done
+
+# Jedes Gate muss in mindestens einer Bahn liegen, sonst ist es totes Gewicht,
+# das niemand ausfuehrt — dieselbe Klasse wie `npm run test:hq`, das bis zum
+# 09.09. in package.json stand und nirgends lief.
+alle="$(bash scripts/ci/gates.sh --list | awk '{print $1}' | sort -u)"
+verwendet="$(for lane in $LANES; do bash scripts/ci/gates.sh --list "$lane"; done | sort -u)"
+verwaist="$(comm -23 <(printf '%s\n' "$alle") <(printf '%s\n' "$verwendet"))"
+if [ -z "$verwaist" ]; then
+  ok "kein verwaistes Gate (jedes liegt in mindestens einer Bahn)"
+else
+  bad "verwaiste Gates, in keiner Bahn: $(printf '%s' "$verwaist" | tr '\n' ' ')"
+fi
+
+# Die Gates, deren Fehlen der Anlass fuer dieses Skript war — plus die
+# beiden, die `main` zwischen dem 09.09. und dem 21.09. als eigene ci.yml-
+# Schritte dazubekam (`test-red-first-output.sh`, `test:hq:visual`). Beim Merge
+# des Umbaus auf Bahnen waeren genau die zwei still verschwunden: die
+# Konfliktaufloesung behaelt den Bahn-Aufruf und wirft die Schrittliste weg.
+# Genau dafuer steht diese Liste hier. Wenn sie
+# jemand wieder herausnimmt, faellt das hier auf und nicht erst im Betrieb.
+# ACHTUNG, hier ist der Selbsttest selbst in die Falle getappt, gegen die
+# dieser Umbau antritt: `gates.sh --list linux | grep -qx X` liefert unter
+# `pipefail` einen Fehlschlag, sobald grep frueh abbricht — gates.sh bekommt
+# SIGPIPE (141), und der Status der Pipe ist nicht der von grep. Erst in eine
+# Variable, dann pruefen.
+linux_ids="$(bash scripts/ci/gates.sh --list linux)"
+release_ids="$(bash scripts/ci/gates.sh --list release)"
+for pflicht in hq-test hq-visual selftest-gates selftest-red-first selftest-review lint e2e; do
+  if printf '%s\n' "$linux_ids" | grep -qx "$pflicht"; then
+    ok "Bahn linux enthaelt $pflicht"
+  else
+    bad "Bahn linux enthaelt $pflicht NICHT"
+  fi
+done
+for pflicht in lint e2e no-masked rust-suite hq-visual selftest-red-first selftest-review; do
+  if printf '%s\n' "$release_ids" | grep -qx "$pflicht"; then
+    ok "Bahn release enthaelt $pflicht"
+  else
+    bad "Bahn release enthaelt $pflicht NICHT (release.yml war schwaecher gegatet als ein PR)"
+  fi
+done
+
+# Die Rust-Suite muss ueberall nextest sein. `cargo test` misst etwas anderes
+# (geteilter Prozess, keine Retry-Sperre, kein slow-timeout) — genau die Drift
+# zwischen pre-push und CI, die dieses Skript beseitigt.
+alle_zeilen="$(bash scripts/ci/gates.sh --list)"
+if printf '%s\n' "$alle_zeilen" | grep -E '^rust-suite' | grep -q 'cargo nextest run --profile ci'; then
+  ok "rust-suite fuehrt nextest mit dem Profil ci"
+else
+  bad "rust-suite fuehrt nicht 'cargo nextest run --profile ci'"
+fi
+
+# --------------------------------------------------------------------------
+# Teil 2: Ablehnungen
+# --------------------------------------------------------------------------
+expect_exit() { # name erwartet befehl...
+  local name="$1" want="$2"; shift 2
+  "$@" > "$tmp/$name.log" 2>&1
+  local got=$?
+  if [ "$got" -eq "$want" ]; then
+    ok "$name (Exit $got)"
+  else
+    bad "$name: Exit $got, erwartet $want"; sed 's/^/    /' "$tmp/$name.log"
+  fi
+}
+
+expect_exit "unbekannte-bahn"  2 bash scripts/ci/gates.sh lane gibtsnicht
+expect_exit "unbekanntes-gate" 2 bash scripts/ci/gates.sh run gibtsnicht
+expect_exit "ohne-argument"    2 bash scripts/ci/gates.sh
+expect_exit "from-unbekannt"   2 bash scripts/ci/gates.sh --from gibtsnicht lane linux
+expect_exit "from-falsche-bahn" 2 bash scripts/ci/gates.sh --from cargo-check lane linux
+
+# --------------------------------------------------------------------------
+# Teil 3: Ausfuehrung gegen eingeschleuste Gates (das eigentliche Verhalten)
+# --------------------------------------------------------------------------
+mkdir -p "$tmp/repo/scripts/ci"
+cd "$tmp/repo" || exit 1
+git init -q -b main
+git config user.email "probe@example.test"
+git config user.name "gates-Probe"
+echo "# probe" > README.md
+echo "wert" > getrackt.txt
+git add README.md getrackt.txt
+git commit -q -m "docs: start"
+
+# Kopie mit synthetischen Gates in einer eigenen Bahn `probe`.
+awk '
+  /^GATES=\(/ {
+    print
+    print "  \"p-ok|probe,probe-rot,probe-from,probe-dreckig|.|true\""
+    print "  \"p-rot|probe-rot|.|exit 3\""
+    print "  \"p-danach|probe-rot,probe-from|.|true\""
+    print "  \"p-schreibt|probe-schreibt|.|echo geaendert > getrackt.txt\""
+    next
+  }
+  /^LANES=/ { print "LANES=\"precommit prepush linux windows release audit probe probe-rot probe-from probe-schreibt probe-dreckig\""; next }
+  { print }
+' "$HERE/scripts/ci/gates.sh" > scripts/ci/gates.sh
+chmod +x scripts/ci/gates.sh
+
+cd "$HERE" || exit 1
+G="$tmp/repo/scripts/ci/gates.sh"
+
+bash "$G" lane probe > "$tmp/probe.log" 2>&1
+got=$?
+[ "$got" -eq 0 ] && ok "gruene Bahn endet mit Exit 0" || { bad "gruene Bahn: Exit $got"; sed 's/^/    /' "$tmp/probe.log"; }
+grep -q "p-ok" "$tmp/probe.log" && ok "Zusammenfassung nennt das gelaufene Gate" || bad "Zusammenfassung nennt p-ok nicht"
+grep -q "NICHT ABGEDECKT" "$tmp/probe.log" && ok "Grenze der Aequivalenz wird gedruckt" || bad "Block 'NICHT ABGEDECKT' fehlt"
+grep -qE "^ +Plattform" "$tmp/probe.log" && ok "Umgebungskopf wird gedruckt" || bad "Umgebungskopf fehlt"
+
+# Der wichtigste Fall: ein rotes Gate faerbt den ganzen Lauf rot, nennt es in
+# der Zusammenfassung, und die teuren Gates dahinter laufen nicht mehr.
+bash "$G" lane probe-rot > "$tmp/rot.log" 2>&1
+got=$?
+[ "$got" -ne 0 ] && ok "rotes Gate faerbt den Lauf rot (Exit $got)" || { bad "rotes Gate blieb gruen (Exit $got)"; sed 's/^/    /' "$tmp/rot.log"; }
+grep -q "ROT(3)" "$tmp/rot.log" && ok "Zusammenfassung nennt den echten Exit-Code (3)" || { bad "Exit-Code 3 fehlt in der Zusammenfassung"; sed 's/^/    /' "$tmp/rot.log"; }
+grep -q "NICHT mehr gelaufen" "$tmp/rot.log" && ok "uebersprungene Gates werden benannt" || bad "uebersprungene Gates werden verschwiegen"
+if grep -q "Gate p-danach:" "$tmp/rot.log"; then
+  bad "Gate nach dem Fehlschlag lief trotzdem — kein Fail-Fast"
+else
+  ok "nach dem Fehlschlag laeuft kein weiteres Gate"
+fi
+
+# --from setzt hinter dem Fehlschlag wieder auf.
+bash "$G" --from p-danach lane probe-from > "$tmp/from.log" 2>&1
+got=$?
+[ "$got" -eq 0 ] && ok "--from laeuft (Exit 0)" || { bad "--from: Exit $got"; sed 's/^/    /' "$tmp/from.log"; }
+if grep -q "Gate p-ok:" "$tmp/from.log"; then
+  bad "--from hat das vorherige Gate trotzdem ausgefuehrt"
+else
+  ok "--from ueberspringt die Gates davor"
+fi
+
+# Der Waechter gegen Seiteneffekte. Anlass: `npm run test:hq` startete ueber
+# zwei Tests den hq-live-Server, der beim Start docs/dev-hq/data.json und
+# data.js im ECHTEN Baum neu erzeugte — unsichtbar, solange das Gate nirgends
+# lief, und ab dem Einhaengen war der Baum nach jedem prepush dreckig.
+bash "$G" lane probe-schreibt > "$tmp/schreibt.log" 2>&1
+got=$?
+[ "$got" -ne 0 ] && ok "ein Gate, das eine getrackte Datei anfasst, faerbt den Lauf rot (Exit $got)" ||
+  { bad "ein schreibendes Gate blieb gruen"; sed 's/^/    /' "$tmp/schreibt.log"; }
+grep -q "Arbeitsbaum veraendert" "$tmp/schreibt.log" &&
+  ok "der Waechter benennt die Ursache" || bad "keine Meldung zum veraenderten Arbeitsbaum"
+grep -q "getrackt.txt" "$tmp/schreibt.log" &&
+  ok "der Waechter nennt die betroffene Datei" || bad "die betroffene Datei wird nicht genannt"
+
+# Gegenprobe: uncommittete eigene Arbeit ist normal und darf den Lauf NICHT
+# rot faerben. Verglichen werden Mengen vor und nach dem Lauf, nicht
+# "Baum sauber" — sonst waere der Waechter lokal unbrauchbar und wuerde
+# weggeschaltet.
+( cd "$tmp/repo" && echo "eigene Arbeit" > getrackt.txt )
+bash "$G" lane probe-dreckig > "$tmp/dreckig.log" 2>&1
+got=$?
+[ "$got" -eq 0 ] && ok "vorhandene eigene Aenderungen faerben den Lauf nicht rot" ||
+  { bad "der Waechter schlaegt bei uncommitteter eigener Arbeit an (Exit $got)"; sed 's/^/    /' "$tmp/dreckig.log"; }
+( cd "$tmp/repo" && git checkout -q -- getrackt.txt )
+
+echo
+[ "$fails" -eq 0 ] && echo "alle Faelle grün" || echo "$fails Fall/Faelle rot"
+[ "$fails" -eq 0 ]
```
