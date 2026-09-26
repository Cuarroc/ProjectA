#!/usr/bin/env bash
# Selbsttest fuer scripts/review/run-local.sh (SETUP-09).
#
# run-local.sh baut den Review-Prompt fuer einen PR oder den aktuellen Branch
# und schickt ihn ueber .pa/review_transport.py (Ollama) oder die kilo-CLI an
# kostenlose Reviewer. Hier laeuft alles ohne Netz, ohne Key und ohne
# Modellminute:
#   - Ollama: ein lokaler HTTP-Server (Fake-Reviewer) auf 127.0.0.1,
#   - kilo:   ein Stub-Skript "kilo" vorn im PATH,
#   - git:    ein Wegwerf-Repo mit einem lokalen Bare-Repo als origin.
# Geprueft wird vor allem, dass ein leerer oder fehlerhafter Reviewer den Lauf
# rot macht (wie der gehaertete Transport) und dass fehlende Voraussetzungen
# eine klare deutsche Meldung liefern statt eines Tracebacks.
set -uo pipefail
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
RUN="$ROOT/scripts/review/run-local.sh"
tmp="$(mktemp -d)"
srv_pid=""
trap 'if [ -n "$srv_pid" ]; then kill "$srv_pid" 2>/dev/null; fi; rm -rf "$tmp"' EXIT
fails=0

ok()  { echo "ok   $*"; }
bad() { echo "FEHLER $*"; fails=$((fails + 1)); }

# Interpreter suchen wie in test-review-transport.sh (Store-Stub unter Windows).
PY=""
for kandidat in python3 python py; do
  command -v "$kandidat" > /dev/null 2>&1 || continue
  if "$kandidat" -c "import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)" > /dev/null 2>&1; then
    PY="$kandidat"
    break
  fi
done
if [ -z "$PY" ]; then
  echo "FEHLER: kein lauffaehiges Python 3 gefunden - der Selbsttest waere ungelaufen, nicht gruen." >&2
  exit 2
fi

if [ ! -f "$RUN" ]; then
  bad "scripts/review/run-local.sh fehlt"
  echo "$fails Fehler."
  exit 1
fi

# --- Fake-Ollama: /api/tags (Erreichbarkeit) und /api/generate -------------
cat > "$tmp/server.py" <<'PYEOF'
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

class H(BaseHTTPRequestHandler):
    def _send(self, obj):
        raw = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
    def do_GET(self):
        self._send({"models": []})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        req = json.loads(self.rfile.read(n) or b"{}")
        model = req.get("model", "")
        # Modelle mit "leer" antworten ohne Text: kein Urteil.
        text = "" if "leer" in model else "Urteil: freigeben (fake %s). Prompt %d Zeichen." % (model, len(req.get("prompt", "")))
        auth = self.headers.get("Authorization") or ""
        # "auth" nur fuer einen echten Bearer-Kopf mit Wert, nicht fuer irgendeinen.
        bearer = auth.startswith("Bearer ") and len(auth) > len("Bearer ")
        with open(sys.argv[2], "a") as log:
            log.write("%s|%s|%s\n" % (model, "auth" if bearer else "noauth", req.get("prompt", "").count("MARKER_LINE")))
        self._send({"model": model, "response": text})
    def log_message(self, *a):
        pass

srv = HTTPServer(("127.0.0.1", 0), H)
open(sys.argv[1], "w").write(str(srv.server_address[1]))
srv.serve_forever()
PYEOF
"$PY" "$tmp/server.py" "$tmp/port" "$tmp/requests.log" &
srv_pid=$!
for _ in $(seq 1 50); do [ -s "$tmp/port" ] && break; sleep 0.1; done
PORT="$(cat "$tmp/port" 2>/dev/null || true)"
if [ -z "$PORT" ]; then
  echo "FEHLER: Fake-Server startete nicht." >&2
  exit 2
fi
FAKE="http://127.0.0.1:$PORT"

# --- Wegwerf-Repo: origin (bare) mit main, Branch mit Aenderung, pull/7/head -
git init -q --bare "$tmp/origin.git"
git init -q -b main "$tmp/repo"
(
  cd "$tmp/repo" || exit 1
  git config user.email t@example.invalid
  git config user.name test
  git config commit.gpgsign false
  git remote add origin "$tmp/origin.git"
  echo "base" > a.txt
  git add a.txt && git commit -q -m base
  git push -q origin main
  git checkout -q -b claude/demo-branch
  echo "MARKER_LINE one" > b.txt
  echo "MARKER_LINE two" >> b.txt
  git add b.txt && git commit -q -m change
  git push -q origin HEAD:refs/pull/7/head
)
REPO="$tmp/repo"

run() { # arg... ; setzt $out und $rc, laeuft im Wegwerf-Repo
  out="$(cd "$REPO" && "$@" 2>&1)"
  rc=$?
}

# Der Fake-Ollama darf nichts ausser sich selbst ansprechen.
export OLLAMA_HOST="$FAKE"
unset OLLAMA_API_KEY REVIEW_OLLAMA_MODELS REVIEW_KILO_MODELS

# 1. Standardmodelle stammen aus der Repo-Konfiguration (agent-setup-check.mjs).
run bash "$RUN" --dry-run --out-dir "$tmp/o0"
want="$(grep -o 'REVIEWER_MODELS = \[[^]]*\]' "$ROOT/scripts/dev/agent-setup-check.mjs" | grep -o '"[^"]*"' | tr -d '"' | tr '\n' ' ')"
got="$(printf '%s\n' "$out" | sed -n 's/^Modelle: //p' | tr ',' ' ' | tr -s ' ')"
if [ "$rc" -eq 0 ] && [ -n "$want" ] && [ "$(echo $want)" = "$(echo $got)" ]; then
  ok "Standardmodelle = REVIEWER_MODELS aus agent-setup-check.mjs ($(echo $want))"
else
  bad "Standardmodelle: rc=$rc erwartet [$want] bekommen [$got]"; echo "$out"
fi

# 2. Zwei Ollama-Reviewer, Branch-Modus: Exit 0, Protokolle, Prompt mit Diff.
: > "$tmp/requests.log"
run bash "$RUN" --models fake-a:cloud,fake-b:cloud --out-dir "$tmp/o1"
label="claude-demo-branch"
if [ "$rc" -eq 0 ] \
  && grep -q "Status: ok" "$tmp/o1/review_${label}_fake-a.md" 2>/dev/null \
  && grep -q "Status: ok" "$tmp/o1/review_${label}_fake-b.md" 2>/dev/null; then
  ok "Branch-Modus, zwei Reviewer: Exit 0 und zwei Protokolle review_${label}_<modell>.md"
else
  bad "Branch-Modus: rc=$rc"; echo "$out"; ls "$tmp/o1" 2>&1
fi
if grep -q "MARKER_LINE one" "$tmp/o1/review_prompt_${label}.md" 2>/dev/null \
  && grep -q "b.txt" "$tmp/o1/review_prompt_${label}.md" 2>/dev/null \
  && ! grep -q "^+base" "$tmp/o1/review_prompt_${label}.md" 2>/dev/null; then
  ok "Prompt enthaelt den Diff gegen origin/main (und nicht die Basis-Datei)"
else
  bad "Prompt-Datei review_prompt_${label}.md fehlt oder hat den falschen Diff"
fi
# Spalten: modell|auth-oder-noauth|Zahl der MARKER_LINE-Zeilen im Prompt (je 2).
if [ "$(awk -F'|' '$3 == 2 && $2 == "noauth"' "$tmp/requests.log" | wc -l | tr -d ' ')" = "2" ] \
  && [ "$(wc -l < "$tmp/requests.log" | tr -d ' ')" = "2" ]; then
  ok "Genau zwei Anfragen, ohne Authorization-Kopf (lokaler Ollama braucht keinen Key)"
else
  bad "Anfragen: $(cat "$tmp/requests.log")"
fi

# 3. Ein leerer Reviewer macht den Lauf rot; der andere laeuft trotzdem.
run bash "$RUN" --models fake-a:cloud,fake-leer:cloud --out-dir "$tmp/o2"
if [ "$rc" -ne 0 ] \
  && grep -q "Status: ok" "$tmp/o2/review_${label}_fake-a.md" 2>/dev/null \
  && grep -q "Status: failed" "$tmp/o2/review_${label}_fake-leer.md" 2>/dev/null; then
  ok "Leerer Reviewer: Exit $rc, Protokoll 'failed', der andere Reviewer lief durch"
else
  bad "Leerer Reviewer: rc=$rc"; echo "$out"
fi

# 4. PR-Modus: Nummer -> pull/7/head von origin; Label pr7.
run bash "$RUN" 7 --models fake-a:cloud --out-dir "$tmp/o3"
if [ "$rc" -eq 0 ] && grep -q "Status: ok" "$tmp/o3/review_pr7_fake-a.md" 2>/dev/null \
  && grep -q "MARKER_LINE two" "$tmp/o3/review_prompt_pr7.md" 2>/dev/null; then
  ok "PR-Modus: review_pr7_fake-a.md aus origin pull/7/head"
else
  bad "PR-Modus: rc=$rc"; echo "$out"
fi
run bash "$RUN" 99 --models fake-a:cloud --out-dir "$tmp/o3b"
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -qi "PR 99" && [ ! -e "$tmp/o3b/review_pr99_fake-a.md" ]; then
  ok "Unbekannter PR: Exit $rc mit deutscher Meldung, kein Protokoll"
else
  bad "Unbekannter PR: rc=$rc"; echo "$out"
fi

# 5. Ollama nicht erreichbar / ollama.com ohne Key: klare deutsche Meldung.
run env OLLAMA_HOST=http://127.0.0.1:9 bash "$RUN" --models fake-a:cloud --out-dir "$tmp/o4"
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "nicht erreichbar" && ! printf '%s' "$out" | grep -q "Traceback"; then
  ok "Ollama nicht erreichbar: Exit $rc, 'nicht erreichbar', kein Traceback"
else
  bad "Ollama nicht erreichbar: rc=$rc"; echo "$out"
fi
run env OLLAMA_HOST=https://ollama.com bash "$RUN" --models fake-a --out-dir "$tmp/o5"
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "OLLAMA_API_KEY"; then
  ok "ollama.com ohne OLLAMA_API_KEY: Exit $rc und Hinweis auf OLLAMA_API_KEY"
else
  bad "ollama.com ohne Key: rc=$rc"; echo "$out"
fi

# 6. Der Key gelangt als Bearer-Kopf zum Server, aber in keine Datei.
: > "$tmp/requests.log"
# Der Wert wird zur Laufzeit zusammengesetzt: ein Literal KEY=... im Quelltext
# meldet der Geheimnis-Scan (gitleaks generic-api-key) zu Recht.
canary="canary-$(date +%s)-$$"
run env "OLLAMA_API_KEY=$canary" bash "$RUN" --models fake-a:cloud --out-dir "$tmp/o6"
if [ "$rc" -eq 0 ] && grep -q "|auth|" "$tmp/requests.log" && ! grep -rq "$canary" "$tmp/o6" \
  && ! printf '%s' "$out" | grep -q "$canary"; then
  ok "OLLAMA_API_KEY wird gesendet, steht aber weder im Protokoll noch im Prompt noch in der Ausgabe"
else
  bad "Key-Behandlung: rc=$rc"; echo "$out"
fi

# 7. Keine Aenderung gegen die Basis: kein Review (Exit 2).
run bash "$RUN" --base HEAD --models fake-a:cloud --out-dir "$tmp/o7"
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "keine Aenderungen"; then
  ok "Leerer Diff: Exit 2, 'keine Aenderungen'"
else
  bad "Leerer Diff: rc=$rc"; echo "$out"
fi

# 8. Ungueltige Aufrufe: mehr als zwei Modelle, unbekannter Weg.
run bash "$RUN" --models a,b,c --out-dir "$tmp/o8"
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "hoechstens zwei"; then
  ok "Mehr als zwei Modelle: Exit 2"
else
  bad "Drei Modelle: rc=$rc"; echo "$out"
fi
run bash "$RUN" --via gpt --out-dir "$tmp/o8"
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "ollama | kilo"; then
  ok "Unbekannter Weg --via gpt: Exit 2"
else
  bad "--via gpt: rc=$rc"; echo "$out"
fi

# 9. kilo: Stub im PATH. Nur :free-Modelle; leer/Fehler -> rot; fehlende CLI -> Meldung.
mkdir -p "$tmp/bin-ok" "$tmp/bin-leer" "$tmp/bin-fail" "$tmp/bin-none"
cat > "$tmp/bin-ok/kilo" <<'EOF'
#!/usr/bin/env bash
# Stub: haelt die Aufrufform fest, damit Aenderungen an run-local.sh auffallen.
echo "$@" >> "$KILO_STUB_LOG"
[ "$1" = "run" ] || { echo "stub: erwartet 'run'" >&2; exit 64; }
echo "Urteil: freigeben (kilo stub)"
EOF
cat > "$tmp/bin-leer/kilo" <<'EOF'
#!/usr/bin/env bash
echo "> code - stub" >&2
exit 0
EOF
cat > "$tmp/bin-fail/kilo" <<'EOF'
#!/usr/bin/env bash
echo "Error: quota exhausted" >&2
exit 1
EOF
chmod +x "$tmp/bin-ok/kilo" "$tmp/bin-leer/kilo" "$tmp/bin-fail/kilo"
export KILO_STUB_LOG="$tmp/kilo.log"
: > "$KILO_STUB_LOG"

run env PATH="$tmp/bin-ok:$PATH" bash "$RUN" --via kilo --models stepfun/step-3.7-flash:free,nvidia/nemotron-3-super-120b-a12b:free --out-dir "$tmp/k1"
if [ "$rc" -eq 0 ] \
  && grep -q "Status: ok" "$tmp/k1/review_${label}_step-3.7-flash.md" 2>/dev/null \
  && grep -q "Status: ok" "$tmp/k1/review_${label}_nemotron-3-super-120b-a12b.md" 2>/dev/null \
  && grep -q "kilo stub" "$tmp/k1/review_${label}_step-3.7-flash.md"; then
  ok "kilo: zwei :free-Modelle, Exit 0, Protokolle im Transport-Format"
else
  bad "kilo ok: rc=$rc"; echo "$out"; ls "$tmp/k1" 2>&1
fi
if grep -q -- "-m kilo/stepfun/step-3.7-flash:free" "$KILO_STUB_LOG" && grep -q "^run " "$KILO_STUB_LOG"; then
  ok "kilo-Aufruf: kilo run -m kilo/<modell>:free"
else
  bad "kilo-Aufrufform: $(cat "$KILO_STUB_LOG")"
fi

run env PATH="$tmp/bin-ok:$PATH" bash "$RUN" --via kilo --models qwen/qwen3.8-27b --out-dir "$tmp/k2"
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q ":free" && [ ! -e "$tmp/k2/review_${label}_qwen3.8-27b.md" ]; then
  ok "kilo: Modell ohne :free wird abgelehnt (Exit 2), es fliesst kein Geld"
else
  bad "kilo ohne :free: rc=$rc"; echo "$out"
fi

run env PATH="$tmp/bin-leer:$PATH" bash "$RUN" --via kilo --models stepfun/step-3.7-flash:free --out-dir "$tmp/k3"
if [ "$rc" -ne 0 ] && grep -q "Status: failed" "$tmp/k3/review_${label}_step-3.7-flash.md" 2>/dev/null; then
  ok "kilo leer: Exit $rc, Protokoll 'failed'"
else
  bad "kilo leer: rc=$rc"; echo "$out"
fi
run env PATH="$tmp/bin-fail:$PATH" bash "$RUN" --via kilo --models stepfun/step-3.7-flash:free --out-dir "$tmp/k4"
if [ "$rc" -ne 0 ] && grep -q "Status: failed" "$tmp/k4/review_${label}_step-3.7-flash.md" 2>/dev/null \
  && grep -q "quota exhausted" "$tmp/k4/review_${label}_step-3.7-flash.md"; then
  ok "kilo Fehler: Exit $rc, Protokoll nennt den Grund"
else
  bad "kilo Fehler: rc=$rc"; echo "$out"
fi

# PATH so bauen, dass kilo sicher fehlt, git/python/bash aber da sind.
nokilo=""
IFS=':' read -ra parts <<< "$PATH"
for p in "${parts[@]}"; do
  [ -x "$p/kilo" ] || [ -x "$p/kilo.cmd" ] || nokilo="${nokilo:+$nokilo:}$p"
done
run env PATH="$nokilo" bash "$RUN" --via kilo --models stepfun/step-3.7-flash:free --out-dir "$tmp/k5"
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "kilo" && printf '%s' "$out" | grep -qi "nicht gefunden"; then
  ok "kilo fehlt: Exit 2 mit deutscher Meldung"
else
  bad "kilo fehlt: rc=$rc"; echo "$out"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "test-review-local: alles gruen."
  exit 0
fi
echo "test-review-local: $fails Fehler."
exit 1
