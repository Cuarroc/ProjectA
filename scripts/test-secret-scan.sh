#!/usr/bin/env bash
# Selbsttest fuer scripts/ci/secret-scan.sh (das Gate `secrets`).
#
# Ein Geheimnis-Scanner, der nicht scheitern kann, schuetzt nichts — dieselbe
# Regel, die scripts/test-gates.sh fuer den Runner einfordert ("eine Pruefung,
# die nicht scheitern kann, prueft nichts", AGENTS.md). Hier scheitert der
# Scan deshalb mehrfach absichtlich: an einem Test-Geheimnis, und er muss
# ausserdem beweisen, dass die Kanarienvoegel aus Pruefung E ihn
# NICHT ausloesen und dass ein fehlendes gitleaks laut statt still scheitert.
#
# Der Kern laeuft gegen ein Wegwerf-Repo, in das die ECHTE secret-scan.sh und
# die ECHTE .gitleaks.toml kopiert werden — geprueft wird also die
# ausgelieferte Konfiguration, nicht eine Kopie, die abweichen koennte.
set -uo pipefail
HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
SCAN="$HERE/scripts/ci/secret-scan.sh"
CONFIG="$HERE/.gitleaks.toml"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

ok()  { echo "ok   $*"; }
bad() { echo "FEHLER $*"; fails=$((fails + 1)); }

# Ohne gitleaks beweist dieser Test nichts — dann rot mit Hinweis, nicht
# gruen durch Abwesenheit.
if ! command -v gitleaks > /dev/null 2>&1; then
  bad "gitleaks fehlt — der Selbsttest kann nicht laufen."
  echo "    Installation (Windows):  winget install Gitleaks.Gitleaks"
  echo "                      oder:  choco install gitleaks"
  echo "    (macOS): brew install gitleaks — (Linux): https://github.com/gitleaks/gitleaks#installing"
  echo "1 Fall/Faelle rot"
  exit 1
fi

# --------------------------------------------------------------------------
# Wegwerf-Repo mit den echten Dateien des Scans
# --------------------------------------------------------------------------
mkdir -p "$tmp/repo/scripts/ci"
cd "$tmp/repo" || exit 1
git init -q -b main
git config user.email "probe@example.test"
git config user.name "secret-scan-Probe"
cp "$SCAN" scripts/ci/secret-scan.sh || { bad "scripts/ci/secret-scan.sh existiert nicht"; echo "$fails Fall/Faelle rot"; exit 1; }
cp "$CONFIG" .gitleaks.toml || { bad ".gitleaks.toml existiert nicht"; echo "$fails Fall/Faelle rot"; exit 1; }
echo "# probe" > README.md
git add README.md
git commit -q -m "docs: start"

# --------------------------------------------------------------------------
# Fall 1: ein Test-Geheimnis MUSS gefunden werden.
#
# Das Secret wird aus Teilstuecken zusammengebaut, damit es nicht als Literal
# in diesem Skript steht — sonst wuerde das eigene Gate den Commit dieses
# Tests sperren (der Scan laeuft ueber die gestagten Dateien, also auch ueber
# diese Datei).
# --------------------------------------------------------------------------
fake="ghp_""x7Kq9Mz2""Lp4Wb8Vn""3Rt6Yc1J""s5Hg0DaE""2FuP"
printf 'token = "%s"\n' "$fake" > app.config
git add app.config
bash scripts/ci/secret-scan.sh > "$tmp/leak.log" 2>&1
rc=$?
# Exit 1 heisst "Fund"; jeder andere Wert (etwa 2 = gitleaks-Fehler oder
# fehlendes Werkzeug) ist kein Fund und darf hier nicht als solcher zaehlen
# (Befund N-4, .pa/review_pr20_disposition.md).
if [ "$rc" -eq 1 ]; then
  ok "Test-Geheimnis wird gefunden (Exit $rc)"
else
  bad "Test-Geheimnis blieb unentdeckt oder der Scan scheiterte anders (Exit $rc, erwartet 1)"; sed 's/^/    /' "$tmp/leak.log"
fi
git reset -q
rm -f app.config

# --------------------------------------------------------------------------
# Fall 1b: ein AWS-Schluessel, der nur das Wort CANARY enthaelt, aber kein
# Kanarienvogel aus dem Repo ist (Buchstaben statt Ziffern), MUSS gefunden
# werden. Die Allowlist fuer AKIACANARY darf nur die Ziffern-Varianten
# decken (Befund N-1, .pa/review_pr20_disposition.md). Zusammengebaut, damit
# das Literal nicht in diesem Skript steht.
# --------------------------------------------------------------------------
fake_aws="AKIA""CANARY""ABCDEFGHIJ"
printf 'aws_key = "%s"\n' "$fake_aws" > app.config
git add app.config
bash scripts/ci/secret-scan.sh > "$tmp/canary-letters.log" 2>&1
rc=$?
if [ "$rc" -eq 1 ]; then
  ok "AKIACANARY mit Buchstaben-Suffix wird gefunden (Exit $rc)"
else
  bad "AKIACANARY mit Buchstaben-Suffix wurde von der Allowlist verschluckt (Exit $rc, erwartet 1)"; sed 's/^/    /' "$tmp/canary-letters.log"
fi
git reset -q
rm -f app.config

# --------------------------------------------------------------------------
# Fall 2: die Kanarienvoegel aus Pruefung E muessen passieren.
# Jeder Allowlist-Eintrag aus .gitleaks.toml steht hier als Wert — Literale
# sind erlaubt, weil die Allowlist sie deckt; gerade DAS wird hier geprueft.
# Jeder Wert bekommt den Keyword-Kontext (token/key/aws_key/api_key), der die
# Default-Regel auch wirklich ausloesen wuerde: ohne Kontext feuern die
# meisten Werte gar nicht, und der Eintrag waere vakuum gruen, nie ausgeuebt
# (Befund A-1/K-02, .pa/review_sec-gitleaks_disposition.md).
# --------------------------------------------------------------------------
cat > kanarien.txt <<'EOF'
token = "0123456789abcdef0123456789abcdef"
token = "deadbeefcafebabe0123456789abcdef"
key = "kimi-delivery-nt17"
key = "opencode-delivery-nt17"
aws_key = "AKIACCCCCCCCCCCCCCCC"
api_key = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAA"
token = "ghp_BBBBBBBBBBBBBBBBBBBB"
aws_key = "AKIACANARY1234567890"
aws_key = "AKIACANARY123456789012"
api_key = "sk-ant-canary-must-not-land-in-argv"
api_key = "sk-abcdefghijklmnopqrst"
key = "sk-or-test-placeholder"
key = "sk-test-test-placeholder"
EOF
git add kanarien.txt
bash scripts/ci/secret-scan.sh > "$tmp/kanarien.log" 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then
  ok "alle Allowlist-Kanarienvoegel loesen den Scan nicht aus (Exit 0)"
else
  bad "Kanarienvoegel feuern trotz Allowlist (Exit $rc)"; sed 's/^/    /' "$tmp/kanarien.log"
fi
git reset -q
rm -f kanarien.txt

# --------------------------------------------------------------------------
# Fall 3: nichts gestaged — der manuelle Lauf ausserhalb eines Commits darf
# nicht rot werden (gates.sh run secrets ohne Commit-Kontext).
# --------------------------------------------------------------------------
bash scripts/ci/secret-scan.sh > "$tmp/leer.log" 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then
  ok "leerer Index ist gruen (Exit 0)"
else
  bad "leerer Index faerbt den Lauf rot (Exit $rc)"; sed 's/^/    /' "$tmp/leer.log"
fi

# --------------------------------------------------------------------------
# Fall 4: fehlt gitleaks, muss der Scan LAUT scheitern (Exit 2) und einen
# Installationshinweis drucken — kein stiller Rueckfall auf "gruen".
# ALLE PATH-Verzeichnisse mit einer gitleaks-Binaerdatei werden gefiltert —
# nicht nur das erste (command -v liefert nur den ersten Treffer; bei einer
# zweiten Installation bliebe gitleaks sonst auffindbar und der Fall waere
# vakuum gruen, Befund A-3, .pa/review_sec-gitleaks_disposition.md).
# --------------------------------------------------------------------------
PATH_OHNE_GL="$(printf '%s' "$PATH" | tr ':' '\n' | while IFS= read -r d; do
  [ ! -e "$d/gitleaks" ] && [ ! -e "$d/gitleaks.exe" ] && printf '%s\n' "$d"
done | paste -sd: -)"
# Positivkontrolle der Filterung: danach darf kein gitleaks mehr auffindbar
# sein — sonst prueft der Fall nichts und wird hier rot statt vakuum gruen.
if PATH="$PATH_OHNE_GL" command -v gitleaks > /dev/null 2>&1; then
  bad "gitleaks trotz PATH-Filterung auffindbar — Fall 4 wuerde nichts pruefen"
else
  ok "PATH-Filterung entfernt gitleaks nachweislich"
fi
PATH="$PATH_OHNE_GL" bash scripts/ci/secret-scan.sh > "$tmp/fehlt.log" 2>&1
rc=$?
if [ "$rc" -eq 2 ]; then
  ok "fehlendes gitleaks scheitert laut (Exit 2)"
else
  bad "fehlendes gitleaks: Exit $rc statt 2"; sed 's/^/    /' "$tmp/fehlt.log"
fi
grep -q "winget install Gitleaks.Gitleaks" "$tmp/fehlt.log" &&
  ok "die Fehlermeldung nennt die Installation" ||
  { bad "kein Installationshinweis in der Fehlermeldung"; sed 's/^/    /' "$tmp/fehlt.log"; }

echo
[ "$fails" -eq 0 ] && echo "alle Faelle grün" || echo "$fails Fall/Faelle rot"
[ "$fails" -eq 0 ]
