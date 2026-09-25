#!/usr/bin/env bash
# Selbsttest fuer .pa/review_transport.py.
#
# Anlass: Lauf 34388829328 (09.09.). Reviewer 1 lieferte
# `choices[0].message.content = null`; `text.strip()` warf einen
# AttributeError, das Skript starb mitten in der Schleife und schrieb fuer
# KEINEN Reviewer ein Protokoll — auch nicht fuer den, der geantwortet hatte.
# Die Kopfzeile des Skripts verspricht aber: "Exit 0 nur, wenn JEDER
# konfigurierte Reviewer geantwortet hat". Ein Ausfall ist ein Befund und
# gehoert ins Protokoll, nicht in einen Traceback.
#
# Geprueft wird gegen einen lokalen HTTP-Server, der genau die Antwortformen
# liefert, an denen das Skript gestorben ist. Kein Netz, kein Secret, keine
# Modellminute.
set -uo pipefail
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
tmp="$(mktemp -d)"
srv_pid=""
trap 'if [ -n "$srv_pid" ]; then kill "$srv_pid" 2>/dev/null; fi; rm -rf "$tmp"' EXIT
fails=0

# Den Interpreter suchen, nicht annehmen. Die Bahn `release` laeuft auf
# windows-latest in Git-Bash, und dort ist `python3` im schlechtesten Fall der
# Microsoft-Store-Stub: er startet den Store und endet mit 9009, ohne je Code
# auszufuehren. Ein Gate, das daran scheitert, sagt nichts ueber den
# Review-Transport — und eines, das daran vorbeilaeuft, waere gruen durch
# Abwesenheit. Also: erst suchen, und wenn nichts da ist, LAUT scheitern.
PY=""
for kandidat in python3 python py; do
  command -v "$kandidat" > /dev/null 2>&1 || continue
  # Der Store-Stub liegt unter WindowsApps und beantwortet -c nicht.
  if "$kandidat" -c "import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)" > /dev/null 2>&1; then
    PY="$kandidat"
    break
  fi
done
if [ -z "$PY" ]; then
  echo "FEHLER: kein lauffaehiges Python 3 gefunden (python3 / python / py geprueft)." >&2
  echo "        .pa/review_transport.py ist ein Python-Skript; ohne Interpreter" >&2
  echo "        ist dieser Selbsttest nicht 'gruen', sondern ungelaufen." >&2
  exit 2
fi
echo "# Interpreter: $PY ($("$PY" --version 2>&1))"

ok()  { echo "ok   $*"; }
bad() { echo "FEHLER $*"; fails=$((fails + 1)); }

# Ein Server, ein Pfad je Krankheitsbild.
cat > "$tmp/server.py" <<'PYEOF'
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

ANTWORTEN = {
    "/null":   {"choices": [{"message": {"content": None}}], "model": "m-null"},
    "/leer":   {"choices": [{"message": {"content": "   "}}], "model": "m-leer"},
    "/zahl":   {"choices": [{"message": {"content": 42}}], "model": "m-zahl"},
    "/keine":  {"choices": [], "model": "m-keine"},
    "/fehler": {"error": {"message": "context length exceeded"}},
    # choices als Objekt statt Liste: out["choices"][0] wirft einen TypeError,
    # also genau die Klasse, in die auch ein Programmierfehler faellt.
    "/kaputt": {"choices": {"nicht": "eine Liste"}, "model": "m-kaputt"},
    "/gut":    {"choices": [{"message": {"content": "ANNEHMEN: alles gut."}}], "model": "m-gut"},
}

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.path == "/html":            # JSON erwartet, HTML bekommen
            body = b"<html>502 Bad Gateway</html>"
        else:
            body = json.dumps(ANTWORTEN.get(self.path, {})).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a):
        pass

s = HTTPServer(("127.0.0.1", 0), H)
print(s.server_port, flush=True)
s.serve_forever()
PYEOF

"$PY" "$tmp/server.py" > "$tmp/port" 2>"$tmp/server.err" &
srv_pid=$!
port=""
for _ in $(seq 1 50); do
  port="$(cat "$tmp/port" 2>/dev/null)"
  [ -n "$port" ] && break
  sleep 0.1
done
if [ -z "$port" ]; then
  echo "FEHLER: Testserver kam nicht hoch"; sed 's/^/    /' "$tmp/server.err"; exit 1
fi
echo "# Testserver auf 127.0.0.1:$port"

echo "Ein Prompt." > "$tmp/prompt.md"

# lauf <name> <erwarteter-exit> <pfad-reviewer-1> [pfad-reviewer-2]
lauf() {
  local name="$1" want="$2" p1="$3" p2="${4:-}"
  local out="$tmp/out-$name"
  mkdir -p "$out"
  (
    export REVIEWER_1_NAME=r1 REVIEWER_1_KIND=openai \
           REVIEWER_1_URL="http://127.0.0.1:$port$p1" REVIEWER_1_MODEL=modell-1
    if [ -n "$p2" ]; then
      export REVIEWER_2_NAME=r2 REVIEWER_2_KIND=openai \
             REVIEWER_2_URL="http://127.0.0.1:$port$p2" REVIEWER_2_MODEL=modell-2
    fi
    "$PY" .pa/review_transport.py "$tmp/prompt.md" "$out" probe --author selbsttest
  ) > "$tmp/$name.log" 2>&1
  local got=$?
  if [ "$got" -ne "$want" ]; then
    bad "$name: Exit $got, erwartet $want"; sed 's/^/    /' "$tmp/$name.log"
    return 1
  fi
  ok "$name (Exit $got)"
  if grep -q "Traceback" "$tmp/$name.log"; then
    bad "$name: Traceback statt Befund"; sed 's/^/    /' "$tmp/$name.log"
  fi
  return 0
}

# Jede Art, NICHT zu antworten, ist ein Fehlschlag mit Protokoll — kein Absturz.
for fall in null:content-null leer:leere-antwort zahl:kein-text keine:leere-choices \
            fehler:error-objekt html:html-statt-json; do
  pfad="/${fall%%:*}"
  name="${fall#*:}"
  if lauf "$name" 1 "$pfad"; then
    datei="$tmp/out-$name/review_probe_r1.md"
    if [ -f "$datei" ]; then
      ok "$name: Protokoll geschrieben"
    else
      bad "$name: kein Protokoll — der Ausfall ist unsichtbar"
    fi
    grep -q "Status: failed" "$datei" 2>/dev/null &&
      ok "$name: Status failed im Protokoll" || bad "$name: Protokoll nennt den Ausfall nicht"
  fi
done

# Der Kern des Anlasses: faellt Reviewer 1 aus, muss Reviewer 2 TROTZDEM
# laufen und sein Protokoll bekommen. Genau das ging am 09.09. verloren.
if lauf "ausfall-stoppt-den-zweiten-nicht" 1 /null /gut; then
  [ -f "$tmp/out-ausfall-stoppt-den-zweiten-nicht/review_probe_r2.md" ] &&
    ok "Reviewer 2 hat trotz Ausfall von Reviewer 1 ein Protokoll" ||
    bad "Reviewer 2 blieb ohne Protokoll — der Absturz kostet fremde Arbeit"
fi

# Gegenprobe: eine echte Antwort ist gruen. Ohne diesen Fall wuerde ein Skript,
# das IMMER scheitert, den Selbsttest bestehen.
if lauf "gute-antwort" 0 /gut; then
  grep -q "ANNEHMEN: alles gut." "$tmp/out-gute-antwort/review_probe_r1.md" 2>/dev/null &&
    ok "das Urteil steht im Protokoll" || bad "das Urteil fehlt im Protokoll"
  grep -q "Status: ok" "$tmp/out-gute-antwort/review_probe_r1.md" 2>/dev/null &&
    ok "Status ok im Protokoll" || bad "Status ok fehlt"
fi

# Ein Reviewer-Ausfall und ein Fehler IN DIESEM SKRIPT duerfen im Protokoll
# nicht gleich aussehen. Befund kimi-k2.7-code R-1 (21.09.): sonst tarnt die
# breite except-Liste den eigenen Bug als ausgefallenen Anbieter.
if lauf "ausfall-liest-sich-anders-als-eigener-bug" 1 /null; then
  datei="$tmp/out-ausfall-liest-sich-anders-als-eigener-bug/review_probe_r1.md"
  if grep -q "Traceback" "$datei" 2>/dev/null; then
    bad "ein sauberer Reviewer-Ausfall traegt einen Traceback — nicht unterscheidbar"
  else
    ok "ein Reviewer-Ausfall steht ohne Traceback im Protokoll"
  fi
fi
if lauf "unerwarteter-fehler-traegt-traceback" 1 /kaputt; then
  datei="$tmp/out-unerwarteter-fehler-traegt-traceback/review_probe_r1.md"
  grep -q "moeglicherweise KEIN Reviewer-Ausfall" "$datei" 2>/dev/null &&
    ok "ein unerwarteter Fehler sagt, dass er es sein koennte" ||
    bad "ein unerwarteter Fehler liest sich wie ein Reviewer-Ausfall"
  grep -q "Traceback" "$datei" 2>/dev/null &&
    ok "und traegt den Traceback zum Nachsehen" || bad "kein Traceback im Protokoll"
fi

# Ohne Reviewer ist der Lauf kein Review: Exit 2, nicht 0.
(
  env -u REVIEWER_1_NAME "$PY" .pa/review_transport.py "$tmp/prompt.md" "$tmp" probe
) > "$tmp/ohne.log" 2>&1
got=$?
[ "$got" -eq 2 ] && ok "ohne konfigurierten Reviewer: Exit 2" ||
  bad "ohne Reviewer: Exit $got, erwartet 2"

echo
[ "$fails" -eq 0 ] && echo "alle Faelle gruen" || echo "$fails Fall/Faelle rot"
[ "$fails" -eq 0 ]
