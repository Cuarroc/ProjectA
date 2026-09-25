# Review request PR #20 (port/sec-01): gitleaks secret scan as mandatory precommit gate

You are an independent reviewer (not the author; the author is a Claude model).
Review the COMPLETE candidate below for correctness bugs, gaps against the
requirements, and safety regressions. Be concrete: cite file and line, say what
breaks and when. Rate each finding high/medium/low. Do not restate the diff. If
something is fine, say nothing about it. Answer in English or German. This is a
READ-ONLY review: do not modify any files.

## Context

Repo: ProjectA, a Tauri 2 "agentic terminal", public GitHub repo. Quality gates
live only in `scripts/ci/gates.sh` (lanes: precommit, prepush, linux, windows,
release, audit); `.githooks/pre-commit` runs the `precommit` lane.

## Package requirement

A user rule: a secret scan runs before every commit. The new gate `secrets`
(lane `precommit`) runs `gitleaks git --staged --config .gitleaks.toml --redact`
over the staged files only. `.gitleaks.toml` extends the default rules with a
narrow allowlist of known test canaries. Without gitleaks the gate must fail
loudly (exit 2 with an install hint), never fall back silently. A self-test
(`scripts/test-secret-scan.sh`, gate `selftest-secrets` in lane `prepush`)
proves: a planted secret is blocked (exit 1), all ten allowlist canaries pass,
an empty index is green, a missing gitleaks gives exit 2. `doctor.sh` reports
gitleaks and marks lanes with the secrets gates BLOCKED when it is missing.
CI does not run the `precommit` lane (a full-history scan in CI is a separate
package).

## Review history

This branch was ported from a private predecessor repo. There it had two
independent reviews (glm-5.2, deepseek-v4-flash); their findings (allowlist
coverage in the self-test, `AKIACANARY` length, PATH filtering with several
gitleaks installs, `set -e`) are already in the diff. Delta since then: merge
conflict resolution in `scripts/ci/gates.sh` and `docs/decisions.md` against
the newer `main`, and removal of references to the predecessor repo. Focus on
the delta and hunt for NEW problems: allowlist regexes that are too broad and
would let a real secret through, a path where a commit passes without a scan,
exit codes swallowed, gate/lane wiring errors (lane membership, `--list`
output, hints), a self-test that would stay green if the gate were broken,
Windows/Git-Bash portability, and text in docs that contradicts the code.

## Diff (git diff origin/main...HEAD -- . ':!.pa', candidate 6e5c127)

```diff
diff --git a/.gitleaks.toml b/.gitleaks.toml
new file mode 100644
index 0000000..1e271ad
--- /dev/null
+++ b/.gitleaks.toml
@@ -0,0 +1,36 @@
+title = "ProjectA gitleaks"
+
+[extend]
+useDefault = true
+
+# Allowlist: nur die bekannten Test-Kanarienvoegel aus Pruefung E (Veroeffentlichungs-Pruefung vom 25.09.2026) und ausdrueckliche
+# Platzhalter. Bewusst eng gefasst: ein echter neuer Fund soll feuern, nicht
+# versehentlich von einer grosszuegigen Regel erlaubt werden. Jeder Eintrag
+# nennt seine Quelle; die Werte stehen dort als Testmaterial, hier nur als
+# Muster. Wer einen neuen Testwert einfuehrt, traegt ihn hier mit Quelle nach.
+[allowlist]
+description = "Test-Kanarienvoegel (Pruefung E) und Platzhalter"
+regexes = [
+  # Redact-/Token-Tests: fester 32-Hex-Testwert (src-tauri/src/redact.rs,
+  # bin/pa.rs, hooks.rs — und .pa-Reviews, die daraus zitieren)
+  '''0123456789abcdef0123456789abcdef''',
+  # diagnosis.rs: Testwert derselben Klasse
+  '''deadbeefcafebabe0123456789abcdef''',
+  # Queue-Aufgaben-Schluessel (scripts/hq-queue-open-points.mjs und der Test
+  # dazu) — kein Token; feuert die generic-Regel ueber das Wort "key"
+  '''(kimi|opencode)-delivery-nt17''',
+  # digest.rs: Canary-Werte fuer die Bereinigung des Boards
+  '''AKIAC{16}''',
+  '''sk-ant-api03-A{16,}''',
+  '''ghp_B{16,}''',
+  # logging.rs und .pa-Reviews w1-22: der AWS-Kanarienvogel "CANARY", in den
+  # realen Varianten mit 10 und 12 Ziffern (logging.rs nutzt die 10-stellige —
+  # {12} allein deckte sie nicht, Beleg .pa/review_sec-gitleaks_disposition.md)
+  '''AKIACANARY[0-9A-Z]{10,12}''',
+  # routing.rs: Canary, der nie in einem argv landen darf
+  '''sk-ant-canary-must-not-land-in-argv''',
+  # src/lib/attentionInbox.test.ts: OpenAI-Form zum Testen der Redaktion
+  '''sk-abcdefghijklmnopqrst''',
+  # .pa/review_prompt_w1-24b.md: ausdrueckliche Platzhalter
+  '''sk-(or|test)-test-placeholder''',
+]
diff --git a/docs/decisions.md b/docs/decisions.md
index 6be5287..becffc8 100644
--- a/docs/decisions.md
+++ b/docs/decisions.md
@@ -1369,3 +1369,22 @@ minutes are billed twice on private repos, so Windows alone was ~2850 of
   manuell und damit nicht wiederholbar — Zurücknehmen: nie das Verdikt als
   Funktion; der Treiber darf durch einen `pa`-Unterbefehl ersetzt werden,
   sobald der Daemon (W5-31b) die Sandboxes selbst verwaltet.
+
+## 2026-09-25 - gitleaks als Pflicht-Gate vor jedem Commit
+
+Nutzer-Regel (freigegeben 25.09.), Umsetzung aus JOB sec-gitleaks.
+
+- **Geheimnis-Scan vor jedem Commit:** das Gate `secrets` in der Bahn
+  `precommit` (scripts/ci/secret-scan.sh) fuehrt `gitleaks git --staged` aus -
+  nur der Index, unter einer Sekunde. Die Allowlist in `.gitleaks.toml`
+  deckt genau die Test-Kanarienvoegel aus Pruefung E (Veroeffentlichungs-Pruefung vom 25.09.2026), jeder Eintrag mit Quelle.
+  Ohne gitleaks endet das Gate laut (Exit 2, Installationshinweis) - bewusst
+  kein stiller Rueckfall, denn ein Scanner, der bei Abwesenheit gruen wird,
+  schuetzt nicht. Der Selbsttest `scripts/test-secret-scan.sh` (Gate
+  `selftest-secrets`, Bahn `prepush`) belegt, dass der Scan scheitern kann -
+  Warum: Pruefung E fand 36 gitleaks-Treffer, alle Testwerte; damit neue
+  Commits diese Klasse sauber halten statt sie nachtraeglich auditieren zu
+  muessen. gitleaks ist ein reines Lokal-Werkzeug (CI faehrt kein
+  `precommit`) - Zuruecknehmen: nur wenn der Nutzer die Regel aufhebt; ein
+  Vollscan der Historie in CI waere ein eigener Auftrag, keine
+  Aufweichung dieses Gates.
diff --git a/scripts/ci/doctor.sh b/scripts/ci/doctor.sh
index 83bb138..8228522 100755
--- a/scripts/ci/doctor.sh
+++ b/scripts/ci/doctor.sh
@@ -77,6 +77,8 @@ pruefe pflicht "cargo" cargo --version
 pruefe pflicht "rustc" rustc --version
 nextest_ok=0
 if pruefe pflicht "nextest" cargo nextest --version; then nextest_ok=1; fi
+gitleaks_ok=0
+if pruefe pflicht "gitleaks" gitleaks version; then gitleaks_ok=1; fi
 audit_ok=0
 if pruefe kann "cargo-audit" cargo audit --version; then audit_ok=1; fi
 
@@ -144,6 +146,7 @@ for lane in precommit prepush linux windows release audit; do
   ids_csv=",$(printf '%s' "$ids" | tr '\n' ','),"
   case "$ids_csv" in *,rust-suite,*) [ "$nextest_ok" -eq 1 ] || urteil="BLOCKIERT (nextest fehlt: cargo install cargo-nextest --locked)" ;; esac
   case "$ids_csv" in *,audit-rust,*) [ "$audit_ok" -eq 1 ] || urteil="BLOCKIERT (cargo-audit fehlt: cargo install cargo-audit)" ;; esac
+  case "$ids_csv" in *,secrets,* | *,selftest-secrets,*) [ "$gitleaks_ok" -eq 1 ] || urteil="BLOCKIERT (gitleaks fehlt: winget install Gitleaks.Gitleaks)" ;; esac
   printf ' %-10s %2d Gates  %s\n' "$lane" "$n" "$urteil"
 done
 
diff --git a/scripts/ci/gates.sh b/scripts/ci/gates.sh
index af906ea..1c9209a 100755
--- a/scripts/ci/gates.sh
+++ b/scripts/ci/gates.sh
@@ -87,6 +87,19 @@ GATES=(
   # beide Richtungen (Rust-Aenderung -> voll, gelesene Doku -> voll, freie
   # Doku -> aus, Queue/Wochenlauf -> voll, main-Push nur bei Cache-Eingaben).
   "selftest-lane-plan|linux,release|.|bash scripts/test-lane-plan.sh"
+  # Nutzer-Regel (freigegeben 25.09.2026): Geheimnis-Scan vor jedem Commit.
+  # gitleaks ueber den Index (nur das, was der Commit einfuehren wuerde,
+  # unter einer Sekunde). Die Allowlist fuer die Test-Kanarienvoegel aus
+  # Pruefung E steht in .gitleaks.toml. Kein stiller Rueckfall:
+  # ohne gitleaks endet das Gate laut mit Installationshinweis. Nur die
+  # lokale Bahn: CI faehrt kein `precommit`, ein Vollscan der Historie waere
+  # ein eigener Auftrag (Pruefung E macht ihn bereits punktuell).
+  "secrets|precommit|.|bash scripts/ci/secret-scan.sh"
+  # Der Selbsttest des Scans belegt, dass er scheitern KANN: Test-Geheimnis
+  # rot, Kanarienvoegel gruen, fehlendes gitleaks laut. Er liegt in der
+  # lokalen prepush-Bahn statt bei den CI-Selbsttests (linux/release), weil
+  # gitleaks ein reines Lokal-Werkzeug ist und die CI-Runner es nicht haben.
+  "selftest-secrets|prepush|.|bash scripts/test-secret-scan.sh"
 
   # --- schnell: Form und Typen --------------------------------------------
   "fmt|precommit,prepush,branchpush,linux,windows,release|src-tauri|cargo fmt --check"
@@ -199,6 +212,7 @@ print_header() { # bahn
   printf ' %-14s %s\n' "npm" "$(version_of npm --version)"
   printf ' %-14s %s\n' "rustc" "$(version_of rustc --version)"
   printf ' %-14s %s\n' "nextest" "$(version_of cargo nextest --version)"
+  printf ' %-14s %s\n' "gitleaks" "$(version_of gitleaks version)"
   printf ' %-14s %s\n' "HEAD" "$(git rev-parse --short HEAD 2>/dev/null || echo '-')$([ -n "$dirty" ] && echo ' (uncommitted Aenderungen im Baum)')"
   echo
 }
@@ -310,6 +324,15 @@ run_gate() { # id
 # frischen Maschine ist ein fehlendes Werkzeug, nicht ein echter Fehlschlag.
 hint_for() {
   case "$1" in
+    secrets)
+      command -v gitleaks > /dev/null 2>&1 || {
+        echo "    Hinweis: gitleaks fehlt. Installation (Windows):"
+        echo "      winget install Gitleaks.Gitleaks   (oder: choco install gitleaks)"
+        echo "    macOS: brew install gitleaks — Linux: https://github.com/gitleaks/gitleaks#installing"
+        echo "    Kein Rueckfall auf 'ungeprueft committen': der Scan ist Pflicht"
+        echo "    (Nutzer-Regel vom 25.09.2026). Frisch installiert? Shell neu starten."
+      }
+      ;;
     rust-suite)
       command -v cargo-nextest > /dev/null 2>&1 || cargo nextest --version > /dev/null 2>&1 || {
         echo "    Hinweis: cargo-nextest fehlt. Installation:"
diff --git a/scripts/ci/secret-scan.sh b/scripts/ci/secret-scan.sh
new file mode 100644
index 0000000..3261b08
--- /dev/null
+++ b/scripts/ci/secret-scan.sh
@@ -0,0 +1,29 @@
+#!/usr/bin/env bash
+# secret-scan.sh — das Gate `secrets`: gitleaks ueber die gestagten Aenderungen.
+#
+# Nutzer-Regel (freigegeben 25.09.2026): Geheimnis-Scan vor jedem Commit.
+# Der Scan laeuft in der Bahn `precommit` von scripts/ci/gates.sh, also ueber
+# .githooks/pre-commit vor jedem Commit. Er sieht nur den Index — schnell
+# (unter einer Sekunde), und genau der Inhalt, den der Commit einfuehren
+# wuerde. Die Allowlist fuer die bekannten Test-Kanarienvoegel (Pruefung E) steht in .gitleaks.toml.
+#
+# Kein stiller Rueckfall: ohne gitleaks endet das Gate laut mit Exit 2 und
+# einem Installationshinweis, statt den Commit ungeprueft durchzulassen.
+# Selbsttest: scripts/test-secret-scan.sh
+set -euo pipefail
+
+ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
+cd "$ROOT" || exit 1
+
+if ! command -v gitleaks > /dev/null 2>&1; then
+  echo "::error::gitleaks fehlt — der Geheimnis-Scan vor jedem Commit ist Pflicht (kein stiller Rueckfall)." >&2
+  echo "    Installation (Windows):  winget install Gitleaks.Gitleaks" >&2
+  echo "                      oder:  choco install gitleaks" >&2
+  echo "    (macOS): brew install gitleaks  ·  (Linux): https://github.com/gitleaks/gitleaks#installing" >&2
+  echo "    Gerade erst installiert? Die Shell einmal neu starten, damit der PATH greift." >&2
+  exit 2
+fi
+
+# --redact: ein Fund landet nicht im Klartext im Log. Der Exit-Code von
+# gitleaks (0 = sauber, 1 = Fund) geht unveraendert an gates.sh.
+exec gitleaks git --staged --config .gitleaks.toml --redact .
diff --git a/scripts/test-secret-scan.sh b/scripts/test-secret-scan.sh
new file mode 100644
index 0000000..404d22d
--- /dev/null
+++ b/scripts/test-secret-scan.sh
@@ -0,0 +1,149 @@
+#!/usr/bin/env bash
+# Selbsttest fuer scripts/ci/secret-scan.sh (das Gate `secrets`).
+#
+# Ein Geheimnis-Scanner, der nicht scheitern kann, schuetzt nichts — dieselbe
+# Regel, die scripts/test-gates.sh fuer den Runner einfordert ("eine Pruefung,
+# die nicht scheitern kann, prueft nichts", AGENTS.md). Hier scheitert der
+# Scan deshalb mehrfach absichtlich: an einem Test-Geheimnis, und er muss
+# ausserdem beweisen, dass die Kanarienvoegel aus Pruefung E ihn
+# NICHT ausloesen und dass ein fehlendes gitleaks laut statt still scheitert.
+#
+# Der Kern laeuft gegen ein Wegwerf-Repo, in das die ECHTE secret-scan.sh und
+# die ECHTE .gitleaks.toml kopiert werden — geprueft wird also die
+# ausgelieferte Konfiguration, nicht eine Kopie, die abweichen koennte.
+set -uo pipefail
+HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
+SCAN="$HERE/scripts/ci/secret-scan.sh"
+CONFIG="$HERE/.gitleaks.toml"
+tmp="$(mktemp -d)"
+trap 'rm -rf "$tmp"' EXIT
+fails=0
+
+ok()  { echo "ok   $*"; }
+bad() { echo "FEHLER $*"; fails=$((fails + 1)); }
+
+# Ohne gitleaks beweist dieser Test nichts — dann rot mit Hinweis, nicht
+# gruen durch Abwesenheit.
+if ! command -v gitleaks > /dev/null 2>&1; then
+  bad "gitleaks fehlt — der Selbsttest kann nicht laufen."
+  echo "    Installation (Windows):  winget install Gitleaks.Gitleaks"
+  echo "                      oder:  choco install gitleaks"
+  echo "    (macOS): brew install gitleaks — (Linux): https://github.com/gitleaks/gitleaks#installing"
+  echo "1 Fall/Faelle rot"
+  exit 1
+fi
+
+# --------------------------------------------------------------------------
+# Wegwerf-Repo mit den echten Dateien des Scans
+# --------------------------------------------------------------------------
+mkdir -p "$tmp/repo/scripts/ci"
+cd "$tmp/repo" || exit 1
+git init -q -b main
+git config user.email "probe@example.test"
+git config user.name "secret-scan-Probe"
+cp "$SCAN" scripts/ci/secret-scan.sh || { bad "scripts/ci/secret-scan.sh existiert nicht"; echo "$fails Fall/Faelle rot"; exit 1; }
+cp "$CONFIG" .gitleaks.toml || { bad ".gitleaks.toml existiert nicht"; echo "$fails Fall/Faelle rot"; exit 1; }
+echo "# probe" > README.md
+git add README.md
+git commit -q -m "docs: start"
+
+# --------------------------------------------------------------------------
+# Fall 1: ein Test-Geheimnis MUSS gefunden werden.
+#
+# Das Secret wird aus Teilstuecken zusammengebaut, damit es nicht als Literal
+# in diesem Skript steht — sonst wuerde das eigene Gate den Commit dieses
+# Tests sperren (der Scan laeuft ueber die gestagten Dateien, also auch ueber
+# diese Datei).
+# --------------------------------------------------------------------------
+fake="ghp_""x7Kq9Mz2""Lp4Wb8Vn""3Rt6Yc1J""s5Hg0DaE""2FuP"
+printf 'token = "%s"\n' "$fake" > app.config
+git add app.config
+bash scripts/ci/secret-scan.sh > "$tmp/leak.log" 2>&1
+rc=$?
+if [ "$rc" -ne 0 ]; then
+  ok "Test-Geheimnis wird gefunden (Exit $rc)"
+else
+  bad "Test-Geheimnis blieb unentdeckt (Exit $rc)"; sed 's/^/    /' "$tmp/leak.log"
+fi
+git reset -q
+rm -f app.config
+
+# --------------------------------------------------------------------------
+# Fall 2: die Kanarienvoegel aus Pruefung E muessen passieren.
+# Jeder Allowlist-Eintrag aus .gitleaks.toml steht hier als Wert — Literale
+# sind erlaubt, weil die Allowlist sie deckt; gerade DAS wird hier geprueft.
+# Jeder Wert bekommt den Keyword-Kontext (token/key/aws_key/api_key), der die
+# Default-Regel auch wirklich ausloesen wuerde: ohne Kontext feuern die
+# meisten Werte gar nicht, und der Eintrag waere vakuum gruen, nie ausgeuebt
+# (Befund A-1/K-02, .pa/review_sec-gitleaks_disposition.md).
+# --------------------------------------------------------------------------
+cat > kanarien.txt <<'EOF'
+token = "0123456789abcdef0123456789abcdef"
+token = "deadbeefcafebabe0123456789abcdef"
+key = "kimi-delivery-nt17"
+key = "opencode-delivery-nt17"
+aws_key = "AKIACCCCCCCCCCCCCCCC"
+api_key = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAA"
+token = "ghp_BBBBBBBBBBBBBBBBBBBB"
+aws_key = "AKIACANARY1234567890"
+aws_key = "AKIACANARY123456789012"
+api_key = "sk-ant-canary-must-not-land-in-argv"
+api_key = "sk-abcdefghijklmnopqrst"
+key = "sk-or-test-placeholder"
+key = "sk-test-test-placeholder"
+EOF
+git add kanarien.txt
+bash scripts/ci/secret-scan.sh > "$tmp/kanarien.log" 2>&1
+rc=$?
+if [ "$rc" -eq 0 ]; then
+  ok "alle Allowlist-Kanarienvoegel loesen den Scan nicht aus (Exit 0)"
+else
+  bad "Kanarienvoegel feuern trotz Allowlist (Exit $rc)"; sed 's/^/    /' "$tmp/kanarien.log"
+fi
+git reset -q
+rm -f kanarien.txt
+
+# --------------------------------------------------------------------------
+# Fall 3: nichts gestaged — der manuelle Lauf ausserhalb eines Commits darf
+# nicht rot werden (gates.sh run secrets ohne Commit-Kontext).
+# --------------------------------------------------------------------------
+bash scripts/ci/secret-scan.sh > "$tmp/leer.log" 2>&1
+rc=$?
+if [ "$rc" -eq 0 ]; then
+  ok "leerer Index ist gruen (Exit 0)"
+else
+  bad "leerer Index faerbt den Lauf rot (Exit $rc)"; sed 's/^/    /' "$tmp/leer.log"
+fi
+
+# --------------------------------------------------------------------------
+# Fall 4: fehlt gitleaks, muss der Scan LAUT scheitern (Exit 2) und einen
+# Installationshinweis drucken — kein stiller Rueckfall auf "gruen".
+# ALLE PATH-Verzeichnisse mit einer gitleaks-Binaerdatei werden gefiltert —
+# nicht nur das erste (command -v liefert nur den ersten Treffer; bei einer
+# zweiten Installation bliebe gitleaks sonst auffindbar und der Fall waere
+# vakuum gruen, Befund A-3, .pa/review_sec-gitleaks_disposition.md).
+# --------------------------------------------------------------------------
+PATH_OHNE_GL="$(printf '%s' "$PATH" | tr ':' '\n' | while IFS= read -r d; do
+  [ ! -e "$d/gitleaks" ] && [ ! -e "$d/gitleaks.exe" ] && printf '%s\n' "$d"
+done | paste -sd: -)"
+# Positivkontrolle der Filterung: danach darf kein gitleaks mehr auffindbar
+# sein — sonst prueft der Fall nichts und wird hier rot statt vakuum gruen.
+if PATH="$PATH_OHNE_GL" command -v gitleaks > /dev/null 2>&1; then
+  bad "gitleaks trotz PATH-Filterung auffindbar — Fall 4 wuerde nichts pruefen"
+else
+  ok "PATH-Filterung entfernt gitleaks nachweislich"
+fi
+PATH="$PATH_OHNE_GL" bash scripts/ci/secret-scan.sh > "$tmp/fehlt.log" 2>&1
+rc=$?
+if [ "$rc" -eq 2 ]; then
+  ok "fehlendes gitleaks scheitert laut (Exit 2)"
+else
+  bad "fehlendes gitleaks: Exit $rc statt 2"; sed 's/^/    /' "$tmp/fehlt.log"
+fi
+grep -q "winget install Gitleaks.Gitleaks" "$tmp/fehlt.log" &&
+  ok "die Fehlermeldung nennt die Installation" ||
+  { bad "kein Installationshinweis in der Fehlermeldung"; sed 's/^/    /' "$tmp/fehlt.log"; }
+
+echo
+[ "$fails" -eq 0 ] && echo "alle Faelle grün" || echo "$fails Fall/Faelle rot"
+[ "$fails" -eq 0 ]
```
