# Code-Review: Branch port/sec-01 (portiert aus dem internen Vorgaenger-Repo) (Stufe A, Sicherheit)

## Kontext

Du reviewst den Branch `sec-gitleaks-precommit` im Repo
dem Repo-Wurzelverzeichnis — er fuehrt gitleaks als Pflicht-Gate `secrets`
in der lokalen Bahn `precommit` ein (scripts/ci/gates.sh, aufgerufen ueber
.githooks/pre-commit vor jedem Commit). Der Scan laeuft als
`gitleaks git --staged --config .gitleaks.toml --redact .` ueber den Index.
Die Arbeitskopie liegt im Worktree `.claude/worktrees/sec-gitleaks/`.
Du bist einer von zwei unabhängigen Reviewern (Dual-Review-Regel Sicherheit);
du hattest keinen Anteil am Code.

Ein Commit auf dem Branch ueber origin/main hinaus: `c75d4f7` —
6 Dateien, +237 Zeilen: `.gitleaks.toml` (neu), `docs/decisions.md`,
`scripts/ci/doctor.sh`, `scripts/ci/gates.sh`, `scripts/ci/secret-scan.sh` (neu),
`scripts/test-secret-scan.sh` (neu, Selbsttest, Gate `selftest-secrets` in Bahn
`prepush`).

## Pflichtlektüre

1. Der vollstaendige Diff `git diff origin/main...HEAD` — unten eingebettet.
2. Die geaenderten Dateien im Worktree im Volltext, falls du Kontext um die
   Diff-Hunks brauchst (z. B. den Rest von `scripts/ci/gates.sh`).

## Prüfen (Leitfragen)

1. **Erkennungsleistung:** Werden echte Geheimnisse sicher erkannt? Reicht
   `[extend] useDefault = true` plus die Allowlist — oder schwächen die
   Allowlist-Regexes die Default-Regeln unbeabsichtigt (z. B. zu weit gefasste
   Muster wie `AKIAC{16}`, `sk-ant-api03-A{16,}`, `ghp_B{16,}`)?
2. **Fehlalarme:** Lösen die Test-Kanarienvoegel aus Prüfung E den
   Scan wirklich nicht aus? Deckt die Allowlist jeden im Selbsttest
   (scripts/test-secret-scan.sh, Fall 2) verwendeten Wert exakt — und fehlt
   umgekehrt ein Kanarienvogel, der im Repo vorkommt, aber nicht in der
   Allowlist steht?
3. **Fail-closed:** Ist der Scan ohne installiertes gitleaks wirklich laut
   statt still (scripts/ci/secret-scan.sh Exit 2, doctor.sh, hint_for in
   gates.sh)? Gibt es einen Pfad, auf dem ein Commit ohne Scan durchgeht
   (z. B. Fehler in der PATH-Filterung des Selbsttests, Exit-Code-Verschlucken,
   `set -uo pipefail` ohne `-e`)?
4. **Umgehung:** Sitzt das Gate unumgehbar in der precommit-Bahn? Was ist mit
   `git commit --no-verify` (projektweit verboten, aber technisch möglich —
   ist das hier akzeptables Restrisiko?), mit direktem Aufruf von gates.sh
   ausserhalb eines Commits, mit leerem Index (Fall 3)?
5. **Nebenwirkungen/Regressionen:** Dauert der Scan pro Commit spürbar?
   Bricht das neue Pflicht-Werkzeug gitleaks bestehende Lanes oder CI
   (CI faehrt laut Kommentar kein `precommit`)? Sind die neuen Gates in
   doctor.sh korrekt verdrahtet?
6. **Test-Qualität:** Ist der Selbsttest scharf (Positiv- und Negativkontrolle,
   Wegwerf-Repo mit den echten Dateien)? Testet Fall 4 die PATH-Filterung
   korrekt (was, wenn gitleaks mehrfach im PATH liegt oder gl_dir leer ist)?

## Der vollständige Diff (git diff origin/main...HEAD)

```diff
diff --git a/.gitleaks.toml b/.gitleaks.toml
new file mode 100644
index 0000000..63c717a
--- /dev/null
+++ b/.gitleaks.toml
@@ -0,0 +1,35 @@
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
+  # logging.rs und .pa-Reviews w1-22: der AWS-Kanarienvogel "CANARY"
+  '''AKIACANARY[0-9A-Z]{12}''',
+  # routing.rs: Canary, der nie in einem argv landen darf
+  '''sk-ant-canary-must-not-land-in-argv''',
+  # src/lib/attentionInbox.test.ts: OpenAI-Form zum Testen der Redaktion
+  '''sk-abcdefghijklmnopqrst''',
+  # .pa/review_prompt_w1-24b.md: ausdrueckliche Platzhalter
+  '''sk-(or|test)-test-placeholder''',
+]
diff --git a/docs/decisions.md b/docs/decisions.md
index 1a74eba..8433216 100644
--- a/docs/decisions.md
+++ b/docs/decisions.md
@@ -1161,3 +1161,23 @@ Einzeln aus CI-02 (PR #133) vorgezogen, Nutzer-Freigabe 25.09.
   Worktree die Gates des Hauptcheckouts (Koordinator-Befund 24.09.).
   Selbsttest `scripts/test-hook-root.sh` (Gate `selftest-gates`) -
   Zuruecknehmen: nie; eine Bahn muss den Baum pruefen, der gepusht wird.
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
index 238263a..b73cdd8 100755
--- a/scripts/ci/gates.sh
+++ b/scripts/ci/gates.sh
@@ -80,6 +80,19 @@ GATES=(
   # gruen durch Abwesenheit ist - deshalb belegt der Selbsttest beide
   # Richtungen (Rust-Aenderung -> voll, Doku -> aus, Queue/Push -> voll).
   "selftest-windows-plan|linux,release|.|bash scripts/test-windows-plan.sh"
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
   "fmt|precommit,prepush,linux,windows,release|src-tauri|cargo fmt --check"
@@ -192,6 +205,7 @@ print_header() { # bahn
   printf ' %-14s %s\n' "npm" "$(version_of npm --version)"
   printf ' %-14s %s\n' "rustc" "$(version_of rustc --version)"
   printf ' %-14s %s\n' "nextest" "$(version_of cargo nextest --version)"
+  printf ' %-14s %s\n' "gitleaks" "$(version_of gitleaks version)"
   printf ' %-14s %s\n' "HEAD" "$(git rev-parse --short HEAD 2>/dev/null || echo '-')$([ -n "$dirty" ] && echo ' (uncommitted Aenderungen im Baum)')"
   echo
 }
@@ -299,6 +313,15 @@ run_gate() { # id
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
index 0000000..244f9ed
--- /dev/null
+++ b/scripts/ci/secret-scan.sh
@@ -0,0 +1,30 @@
+#!/usr/bin/env bash
+# secret-scan.sh — das Gate `secrets`: gitleaks ueber die gestagten Aenderungen.
+#
+# Nutzer-Regel (freigegeben 25.09.2026): Geheimnis-Scan vor jedem Commit.
+# Der Scan laeuft in der Bahn `precommit` von scripts/ci/gates.sh, also ueber
+# .githooks/pre-commit vor jedem Commit. Er sieht nur den Index — schnell
+# (unter einer Sekunde), und genau der Inhalt, den der Commit einfuehren
+# wuerde. Die Allowlist fuer die bekannten Test-Kanarienvoegel (Pruefung E)
+# steht in .gitleaks.toml.
+#
+# Kein stiller Rueckfall: ohne gitleaks endet das Gate laut mit Exit 2 und
+# einem Installationshinweis, statt den Commit ungeprueft durchzulassen.
+# Selbsttest: scripts/test-secret-scan.sh
+set -uo pipefail
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
index 0000000..dce1eb7
--- /dev/null
+++ b/scripts/test-secret-scan.sh
@@ -0,0 +1,126 @@
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
+# Es sind absichtlich die echten Testwerte aus dem Repo (digest.rs,
+# routing.rs, pa.rs) — Literale hier sind erlaubt, weil die Allowlist sie
+# deckt; gerade DAS wird hier geprueft.
+# --------------------------------------------------------------------------
+cat > kanarien.rs <<'EOF'
+let a = "sk-ant-canary-must-not-land-in-argv";
+let b = "AKIACCCCCCCCCCCCCCCC";
+let c = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAA";
+let d = "0123456789abcdef0123456789abcdef";
+EOF
+git add kanarien.rs
+bash scripts/ci/secret-scan.sh > "$tmp/kanarien.log" 2>&1
+rc=$?
+if [ "$rc" -eq 0 ]; then
+  ok "Kanarienvoegel aus Pruefung E loesen den Scan nicht aus (Exit 0)"
+else
+  bad "Kanarienvoegel feuern trotz Allowlist (Exit $rc)"; sed 's/^/    /' "$tmp/kanarien.log"
+fi
+git reset -q
+rm -f kanarien.rs
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
+# Das gitleaks-Verzeichnis wird aus PATH gefiltert, der Rest bleibt nutzbar.
+# --------------------------------------------------------------------------
+gl_dir="$(dirname "$(command -v gitleaks)")"
+PATH_OHNE_GL="$(printf '%s' "$PATH" | tr ':' '\n' | grep -vxF "$gl_dir" | paste -sd: -)"
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

## Ausgabeformat

URTEIL: <annehmen | annehmen mit Auflagen | überarbeiten | ablehnen>
BEGRÜNDUNG: <3–6 Sätze>
BEFUNDE: ### S-NN — Titel / Schwere / Behauptung / Beleg (Datei:Zeile) / Vorschlag
## Was trägt (max. 5)

Deutsch. Nur lesen, nichts verändern.
