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
# Liegt kilo im selben Verzeichnis wie git/python (z. B. /usr/local/bin), fehlen
# die mit: dann waere der Test nicht hermetisch, also ueberspringen statt raten.
if ! PATH="$nokilo" command -v git > /dev/null 2>&1 || ! PATH="$nokilo" command -v "$PY" > /dev/null 2>&1; then
  echo "skip kilo fehlt: kilo liegt im selben PATH-Verzeichnis wie git/python"
else
run env PATH="$nokilo" bash "$RUN" --via kilo --models stepfun/step-3.7-flash:free --out-dir "$tmp/k5"
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "kilo" && printf '%s' "$out" | grep -qi "nicht gefunden"; then
  ok "kilo fehlt: Exit 2 mit deutscher Meldung"
else
  bad "kilo fehlt: rc=$rc"; echo "$out"
fi
fi

# 10. Zeitlimit und Diff-Grenze: beides ist ein Fehler, kein stilles Abschneiden.
if command -v timeout > /dev/null 2>&1 || command -v gtimeout > /dev/null 2>&1; then
  mkdir -p "$tmp/bin-slow"
  printf '#!/usr/bin/env bash
exec sleep 30
' > "$tmp/bin-slow/kilo"
  chmod +x "$tmp/bin-slow/kilo"
  run env PATH="$tmp/bin-slow:$PATH" REVIEW_KILO_TIMEOUT_S=1 bash "$RUN" --via kilo --models stepfun/step-3.7-flash:free --out-dir "$tmp/k6"
  if [ "$rc" -ne 0 ] && grep -q "Status: failed" "$tmp/k6/review_${label}_step-3.7-flash.md" 2>/dev/null     && grep -q "no answer within 1 s" "$tmp/k6/review_${label}_step-3.7-flash.md"; then
    ok "kilo ohne Antwort im Zeitlimit: Exit $rc, Protokoll 'failed' mit Grund"
  else
    bad "kilo Zeitlimit: rc=$rc"; echo "$out"
  fi
else
  echo "skip kilo-Zeitlimit: weder timeout noch gtimeout im PATH"
fi
run env REVIEW_MAX_DIFF_CHARS=10 bash "$RUN" --models fake-a:cloud --out-dir "$tmp/o9"
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "Grenze 10" && [ ! -e "$tmp/o9/review_${label}_fake-a.md" ]   && [ ! -e "$tmp/o9/review_prompt_${label}.md" ]; then
  ok "Diff ueber REVIEW_MAX_DIFF_CHARS: Exit 2, kein Prompt, kein Protokoll"
else
  bad "Diff-Grenze: rc=$rc"; echo "$out"
fi

# 11. Review kimi-k3 (r2): Namenskollision, Host mit Port, nur Lockfiles, kein
#     Zeitlimit, kilo ohne Schreibrechte.
run bash "$RUN" --models llama3:8b,llama3:70b --out-dir "$tmp/o10"
if [ "$rc" -eq 0 ] && [ -f "$tmp/o10/review_${label}_llama3-8b.md" ] && [ -f "$tmp/o10/review_${label}_llama3-70b.md" ]; then
  ok "Zwei Tags desselben Modells ueberschreiben sich nicht (llama3-8b, llama3-70b)"
else
  bad "Tags eines Modells: rc=$rc"; echo "$out"; ls "$tmp/o10" 2>&1
fi
run bash "$RUN" --models fake-a:cloud,fake-a:cloud --out-dir "$tmp/o11"
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "doppelt"; then
  ok "Dasselbe Modell zweimal: Exit 2 (kein Dual-Review)"
else
  bad "Doppeltes Modell: rc=$rc"; echo "$out"
fi
run env OLLAMA_HOST=https://ollama.com:443 bash "$RUN" --models fake-a --out-dir "$tmp/o12"
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "OLLAMA_API_KEY"; then
  ok "ollama.com mit Port ohne Key: Hinweis auf OLLAMA_API_KEY statt 'nicht erreichbar'"
else
  bad "ollama.com:443 ohne Key: rc=$rc"; echo "$out"
fi
(
  cd "$REPO" || exit 1
  git checkout -q -b claude/only-lock main
  echo '{}' > package-lock.json
  git add package-lock.json && git commit -q -m lock
)
run bash "$RUN" --models fake-a:cloud --out-dir "$tmp/o13"
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -qi "lockfile" && ! printf '%s' "$out" | grep -q "keine Aenderungen"; then
  ok "Nur Lockfiles geaendert: Exit 2 mit ehrlicher Meldung (nicht 'keine Aenderungen')"
else
  bad "Nur Lockfiles: rc=$rc"; echo "$out"
fi
git -C "$REPO" checkout -q claude/demo-branch
: > "$KILO_STUB_LOG"
run env PATH="$tmp/bin-ok:$PATH" REVIEW_KILO_TIMEOUT_S=0 bash "$RUN" --via kilo --models stepfun/step-3.7-flash:free --out-dir "$tmp/k7"
if [ "$rc" -eq 0 ] && grep -q "Status: ok" "$tmp/k7/review_${label}_step-3.7-flash.md" 2>/dev/null   && ! printf '%s' "$out" | grep -qi "unbound"; then
  ok "kilo ohne Zeitlimit (REVIEW_KILO_TIMEOUT_S=0): Exit 0, kein Abbruch durch leeres Array"
else
  bad "kilo ohne Zeitlimit: rc=$rc"; echo "$out"
fi
if grep -q -- "--agent ask" "$KILO_STUB_LOG"; then
  ok "kilo laeuft mit --agent ask (kein Schreiben, keine Auto-Freigaben)"
else
  bad "kilo ohne --agent ask: $(cat "$KILO_STUB_LOG")"
fi

# 12. Standard-Ausgabeverzeichnis: relative Pfade. Protokolle landen im Repo und
#     dort darf kein absoluter Arbeitsbaum-Pfad (Nutzername!) stehen.
run bash "$RUN" --models fake-a:cloud
if [ "$rc" -eq 0 ] && [ -f "$REPO/.pa/review_${label}_fake-a.md" ]   && grep -q "^- Prompt: .pa/review_prompt_${label}.md " "$REPO/.pa/review_${label}_fake-a.md"   && ! grep -rqF "$(basename "$tmp")" "$REPO/.pa" && ! printf '%s' "$out" | grep -qF "$(basename "$tmp")"; then
  ok "Standard-Ausgabe .pa/: relative Pfade in Protokoll und Konsole, kein absoluter Pfad"
else
  bad "Standardverzeichnis: rc=$rc"; echo "$out"; cat "$REPO/.pa/review_${label}_fake-a.md" 2>&1 | head -12
fi

# 13. Protokolldatei je Reviewer. Der Name entsteht aus dem Modell
#     ("llama3:8b" -> llama3-8b, kilo: nur das letzte Pfadelement). Zwei Modelle
#     mit demselben Namen schreiben in dieselbe Datei: das zweite Urteil
#     ueberschreibt das erste, der Lauf meldet trotzdem "beide ok". Das ist
#     eine falsche Zusage ("jeder Reviewer hat geliefert") und wird abgelehnt,
#     bevor etwas gesendet wird.
run bash "$RUN" --models llama3:8b,llama3-8b --out-dir "$tmp/o14"
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "Protokolldatei" \
  && [ ! -e "$tmp/o14/review_${label}_llama3-8b.md" ] && [ ! -e "$tmp/o14/review_prompt_${label}.md" ]; then
  ok "Ollama: llama3:8b und llama3-8b teilen sich den Protokollnamen - Exit 2, kein Prompt, kein Protokoll"
else
  bad "Ollama-Protokollname kollidiert: rc=$rc"; echo "$out"; ls "$tmp/o14" 2>&1
fi
# Der gepruefte Name muss der Dateiname sein, den der Transport schreibt:
# ein Anbieterpraefix wird zum Bindestrich, zwei solche Namen bleiben getrennt.
run bash "$RUN" --models library/llama3:8b,other/llama3:8b --out-dir "$tmp/o15"
if [ "$rc" -eq 0 ] && [ -f "$tmp/o15/review_${label}_library-llama3-8b.md" ]   && [ -f "$tmp/o15/review_${label}_other-llama3-8b.md" ]; then
  ok "Ollama mit Anbieterpraefix: zwei Protokolle (library-llama3-8b, other-llama3-8b)"
else
  bad "Ollama-Anbieterpraefix: rc=$rc"; echo "$out"; ls "$tmp/o15" 2>&1
fi
# Geschwisterfaelle desselben Codepfads: das Wegfallen von ":cloud" (der im
# Kommentar genannte Normalfall) und der Trockenlauf, der den Fehler ebenfalls
# sehen soll, bevor ein Prompt gebaut wird.
run bash "$RUN" --models kimi-k3:cloud,kimi-k3 --out-dir "$tmp/o16"
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "Protokolldatei" \
  && [ ! -e "$tmp/o16/review_${label}_kimi-k3.md" ] && [ ! -e "$tmp/o16/review_prompt_${label}.md" ]; then
  ok "kimi-k3:cloud und kimi-k3 teilen sich den Protokollnamen (':cloud' faellt weg) - Exit 2"
else
  bad "':cloud'-Kollision: rc=$rc"; echo "$out"; ls "$tmp/o16" 2>&1
fi
run bash "$RUN" --dry-run --models llama3:8b,llama3-8b --out-dir "$tmp/o17"
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "Protokolldatei" && [ ! -e "$tmp/o17/review_prompt_${label}.md" ]; then
  ok "Trockenlauf mit kollidierenden Namen: Exit 2, kein Prompt (der Aufruf waere so nicht sendbar)"
else
  bad "Trockenlauf-Kollision: rc=$rc"; echo "$out"; ls "$tmp/o17" 2>&1
fi
# Fremder Zeichensatz: umschreiben und raten ist hier zwei Definitionen von
# "derselbe Name" (tr byteweise, slug() im Transport zeichenweise) - abgelehnt.
# Der Test nimmt ein Leerzeichen, damit die Datei ASCII bleibt; Umlaute und
# andere Nicht-ASCII-Zeichen laufen in denselben Zweig.
run bash "$RUN" --models "fake-a:cloud,bad name:8b" --out-dir "$tmp/o18"
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "Zeichen" && [ ! -e "$tmp/o18/review_prompt_${label}.md" ]; then
  ok "Modellname mit Leerzeichen: Exit 2 mit deutscher Meldung, kein Prompt"
else
  bad "Modellname mit Leerzeichen: rc=$rc"; echo "$out"; ls "$tmp/o18" 2>&1
fi
# Gross-/Kleinschreibung (Review-Befund Kimi F1 zu 0fe87ff): NTFS und APFS
# unterscheiden "Llama3-8b" und "llama3-8b" nicht - eine Datei, ein Protokoll
# ueberschreibt das andere. Erwartet: Exit 2 vor Prompt und Versand.
sent_before="$(grep -ci '^llama3:8b|' "$tmp/requests.log" 2>/dev/null)"
run bash "$RUN" --models Llama3:8b,llama3:8b --out-dir "$tmp/o19"
sent_after="$(grep -ci '^llama3:8b|' "$tmp/requests.log" 2>/dev/null)"
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "Protokolldatei" \
  && [ "$sent_before" = "$sent_after" ] && [ ! -e "$tmp/o19/review_prompt_${label}.md" ] \
  && ! ls "$tmp/o19/review_${label}_"*lama3-8b.md > /dev/null 2>&1; then
  ok "Llama3:8b und llama3:8b kollidieren auf NTFS/APFS: Exit 2, kein Prompt, kein Versand, kein Protokoll"
else
  bad "Gross-/Kleinschreibungs-Kollision: rc=$rc gesendet $sent_before->$sent_after"; echo "$out"; ls "$tmp/o19" 2>&1
fi
: > "$KILO_STUB_LOG"
run env PATH="$tmp/bin-ok:$PATH" bash "$RUN" --via kilo --models a/step-3.7-flash:free,b/step-3.7-flash:free --out-dir "$tmp/k8"
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q "Protokolldatei" \
  && [ ! -s "$KILO_STUB_LOG" ] && [ ! -e "$tmp/k8/review_${label}_step-3.7-flash.md" ]; then
  ok "kilo: zwei Anbieter, gleicher Modellname - Exit 2, kilo nie aufgerufen, kein Protokoll"
else
  bad "kilo-Protokollname kollidiert: rc=$rc"; echo "$out"; ls "$tmp/k8" 2>&1
fi

# 14. Parallel PR fetches must not share FETCH_HEAD. A git wrapper overwrites
#     FETCH_HEAD after a bare `pull/N/head` fetch (the old pattern); a private
#     destination ref must keep each prompt on its own PR head.
(
  cd "$REPO" || exit 1
  git checkout -q -b pr8-branch main
  echo "MARKER_PR8_ONLY" > pr8.txt
  git add pr8.txt && git commit -q -m pr8
  git push -q origin HEAD:refs/pull/8/head
  git checkout -q claude/demo-branch
)
sha7="$(git -C "$REPO" ls-remote origin refs/pull/7/head | awk '{print $1}')"
sha8="$(git -C "$REPO" ls-remote origin refs/pull/8/head | awk '{print $1}')"
REAL_GIT="$(command -v git)"
mkdir -p "$tmp/bin-race"
cat > "$tmp/bin-race/git" <<EOF
#!/usr/bin/env bash
REAL_GIT=$(printf '%q' "$REAL_GIT")
joined="\$*"
if [[ "\$joined" == *fetch* && "\$joined" =~ pull/([0-9]+)/head ]] \\
  && [[ ! "\$joined" =~ pull/[0-9]+/head: ]]; then
  "\$REAL_GIT" "\$@" || exit \$?
  n="\${BASH_REMATCH[1]}"
  other=8
  [ "\$n" = 8 ] && other=7
  if [ "\$1" = "-C" ]; then
    "\$REAL_GIT" -C "\$2" fetch --quiet origin "pull/\$other/head"
  else
    "\$REAL_GIT" fetch --quiet origin "pull/\$other/head"
  fi
  exit \$?
fi
exec "\$REAL_GIT" "\$@"
EOF
chmod +x "$tmp/bin-race/git"
run env PATH="$tmp/bin-race:$PATH" bash "$RUN" 7 --dry-run --models fake-a:cloud --out-dir "$tmp/race7"
rc7=$rc; out7=$out
run env PATH="$tmp/bin-race:$PATH" bash "$RUN" 8 --dry-run --models fake-a:cloud --out-dir "$tmp/race8"
rc8=$rc; out8=$out
if [ "$rc7" -eq 0 ] && [ "$rc8" -eq 0 ] \
  && grep -q "MARKER_LINE two" "$tmp/race7/review_prompt_pr7.md" 2>/dev/null \
  && ! grep -q "MARKER_PR8_ONLY" "$tmp/race7/review_prompt_pr7.md" 2>/dev/null \
  && grep -q "MARKER_PR8_ONLY" "$tmp/race8/review_prompt_pr8.md" 2>/dev/null \
  && ! grep -q "MARKER_LINE" "$tmp/race8/review_prompt_pr8.md" 2>/dev/null \
  && grep -q "^Head: $sha7\$" "$tmp/race7/review_prompt_pr7.md" 2>/dev/null \
  && grep -q "^Head: $sha8\$" "$tmp/race8/review_prompt_pr8.md" 2>/dev/null; then
  ok "parallel PR fetches keep distinct diffs (no shared FETCH_HEAD)"
else
  bad "parallel PR FETCH_HEAD race: rc7=$rc7 rc8=$rc8"; echo "$out7"; echo "$out8"
  ls "$tmp/race7" "$tmp/race8" 2>&1
  head -n 8 "$tmp/race7/review_prompt_pr7.md" 2>&1
  head -n 8 "$tmp/race8/review_prompt_pr8.md" 2>&1
fi

# 15. Private refs/pa-review/pr-<N> must not linger after the run ends
#     (success or failure). Unique refs during the run stay (see 14).
run bash "$RUN" 7 --dry-run --models fake-a:cloud --out-dir "$tmp/prune-ok"
leftover="$(git -C "$REPO" for-each-ref --format='%(refname)' 'refs/pa-review/pr-*')"
if [ "$rc" -eq 0 ] && [ -z "$leftover" ]; then
  ok "after PR run no refs/pa-review/pr-* remain"
else
  bad "after PR dry-run leftover=[$leftover] rc=$rc"; echo "$out"
fi
run bash "$RUN" 7 --models fake-a:cloud,fake-leer:cloud --out-dir "$tmp/prune-fail"
leftover="$(git -C "$REPO" for-each-ref --format='%(refname)' 'refs/pa-review/pr-*')"
if [ "$rc" -ne 0 ] && [ -z "$leftover" ]; then
  ok "after failed PR run no refs/pa-review/pr-* remain"
else
  bad "after failed PR leftover=[$leftover] rc=$rc"; echo "$out"
fi

# 16. R877-K4: SIGTERM must run EXIT cleanup (exit 143, no leftover refs).
#     Fake kilo writes $$; kill by that pid (R887-r2-K3), not pkill -f.
mkdir -p "$tmp/bin-sleep"
printf '#!/usr/bin/env bash\necho $$ > %q\nsleep 60\n' "$tmp/kilo.pid" > "$tmp/bin-sleep/kilo"
chmod +x "$tmp/bin-sleep/kilo"; rm -f "$tmp/kilo.pid"
( cd "$REPO" || exit 1
  export PATH="$tmp/bin-sleep:$PATH" REVIEW_KILO_TIMEOUT_S=0
  exec bash "$RUN" 7 --via kilo --models stepfun/step-3.7-flash:free --out-dir "$tmp/term-out"
) >"$tmp/term.log" 2>&1 &
term_pid=$!
leftover=""
for _ in $(seq 1 100); do
  leftover="$(git -C "$REPO" for-each-ref --format='%(refname)' 'refs/pa-review/pr-*')"
  [ -n "$leftover" ] && break; sleep 0.1
done
if [ -z "$leftover" ]; then
  bad "SIGTERM setup: refs/pa-review/pr-* never appeared"; kill "$term_pid" 2>/dev/null; wait "$term_pid" 2>/dev/null || true
else
  for _ in $(seq 1 50); do [ -f "$tmp/kilo.pid" ] && break; sleep 0.1; done
  kilo_pid="$(cat "$tmp/kilo.pid" 2>/dev/null || true)"
  kill -TERM "$term_pid" 2>/dev/null
  [ -n "$kilo_pid" ] && kill -TERM "$kilo_pid" 2>/dev/null || true
  wait "$term_pid"; term_rc=$?
  leftover="$(git -C "$REPO" for-each-ref --format='%(refname)' 'refs/pa-review/pr-*')"
  if [ "$term_rc" -eq 143 ] && [ -z "$leftover" ]; then
    ok "SIGTERM during PR run: exit 143 and no refs/pa-review/pr-* remain"
  else
    bad "SIGTERM cleanup: rc=$term_rc leftover=[$leftover]"
  fi
fi
while read -r r; do [ -n "$r" ] && git -C "$REPO" update-ref -d "$r" 2>/dev/null || true
done < <(git -C "$REPO" for-each-ref --format='%(refname)' 'refs/pa-review/pr-*')

# 17. R877-K2: concurrent same-PR dry-runs must not share one ref.
REAL_GIT="$(command -v git)"
mkdir -p "$tmp/bin-hold" "$tmp/hold-fetched" "$tmp/hold-go"
cat > "$tmp/bin-hold/git" <<EOF
#!/usr/bin/env bash
REAL_GIT=$(printf '%q' "$REAL_GIT"); FD=$(printf '%q' "$tmp/hold-fetched"); GD=$(printf '%q' "$tmp/hold-go")
if [[ "\$*" == *fetch* && "\$*" == *refs/pa-review/pr-* ]]; then
  "\$REAL_GIT" "\$@" || exit \$?; id=\$\$; touch "\$FD/\$id"
  for _ in \$(seq 1 200); do [ -f "\$GD/\$id" ] && exit 0; sleep 0.05; done
  exit 1
fi
exec "\$REAL_GIT" "\$@"
EOF
chmod +x "$tmp/bin-hold/git"
rm -f "$tmp/hold-fetched/"* "$tmp/hold-go/"* "$tmp/parA.rc" "$tmp/parB.rc"
(cd "$REPO" && PATH="$tmp/bin-hold:$PATH" bash "$RUN" 7 --dry-run --models fake-a:cloud --out-dir "$tmp/parA" >"$tmp/parA.out" 2>&1; echo $? >"$tmp/parA.rc") &
parA_pid=$!
(cd "$REPO" && PATH="$tmp/bin-hold:$PATH" bash "$RUN" 7 --dry-run --models fake-a:cloud --out-dir "$tmp/parB" >"$tmp/parB.out" 2>&1; echo $? >"$tmp/parB.rc") &
parB_pid=$!
for _ in $(seq 1 200); do
  [ "$(find "$tmp/hold-fetched" -type f 2>/dev/null | wc -l | tr -d ' ')" -ge 2 ] && break; sleep 0.05
done
mapfile -t hold_ids < <(find "$tmp/hold-fetched" -type f -printf '%f\n' 2>/dev/null)
if [ "${#hold_ids[@]}" -lt 2 ]; then
  bad "concurrent same-PR setup: fetched gates missing"
  touch "$tmp/hold-go/x"; wait "$parA_pid" "$parB_pid" 2>/dev/null || true
else
  touch "$tmp/hold-go/${hold_ids[0]}"
  for _ in $(seq 1 200); do
    c=0; [ -f "$tmp/parA.rc" ] && c=$((c + 1)); [ -f "$tmp/parB.rc" ] && c=$((c + 1))
    [ "$c" -ge 1 ] && break; sleep 0.05
  done
  touch "$tmp/hold-go/${hold_ids[1]}"
  wait "$parA_pid" "$parB_pid" 2>/dev/null || true
  rcA="$(cat "$tmp/parA.rc" 2>/dev/null || echo x)"; rcB="$(cat "$tmp/parB.rc" 2>/dev/null || echo x)"
  leftover="$(git -C "$REPO" for-each-ref --format='%(refname)' 'refs/pa-review/pr-*')"
  if [ "$rcA" = 0 ] && [ "$rcB" = 0 ] && [ -z "$leftover" ]; then
    ok "concurrent same-PR dry-runs both succeed"
  else
    bad "concurrent same-PR: rcA=$rcA rcB=$rcB leftover=[$leftover]"
  fi
fi

# 18. R877-K3: failed update-ref -d prints one diagnostic; exit status unchanged.
mkdir -p "$tmp/bin-delfail"
cat > "$tmp/bin-delfail/git" <<EOF
#!/usr/bin/env bash
REAL_GIT=$(printf '%q' "$REAL_GIT")
[[ "\$*" == *update-ref* && "\$*" == *" -d "* ]] && { echo "simulated refuse" >&2; exit 1; }
exec "\$REAL_GIT" "\$@"
EOF
chmod +x "$tmp/bin-delfail/git"
run env PATH="$tmp/bin-delfail:$PATH" bash "$RUN" 7 --dry-run --models fake-a:cloud --out-dir "$tmp/delfail"
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "konnte Ref .* nicht loeschen"; then
  ok "failed update-ref -d prints diagnostic and keeps exit 0"
else
  bad "update-ref diagnostic: rc=$rc"; echo "$out"
fi
# R887-K6: shimmed PATH left the PR ref behind; sweep with the real git.
while read -r r; do [ -n "$r" ] && git -C "$REPO" update-ref -d "$r" 2>/dev/null || true
done < <(git -C "$REPO" for-each-ref --format='%(refname)' 'refs/pa-review/pr-*')

# 19. R887-K1: startup janitor drops dead-pid and legacy refs; keeps live-pid.
sleep 0.01 &
dead_pid=$!
wait "$dead_pid" 2>/dev/null || true
plant_sha="$(git -C "$REPO" rev-parse HEAD)"
live_ref="refs/pa-review/pr-9001-$$"
dead_ref="refs/pa-review/pr-9002-$dead_pid"
legacy_ref="refs/pa-review/pr-9003"
git -C "$REPO" update-ref "$live_ref" "$plant_sha"
git -C "$REPO" update-ref "$dead_ref" "$plant_sha"
git -C "$REPO" update-ref "$legacy_ref" "$plant_sha"
run bash "$RUN" --dry-run --models fake-a:cloud --out-dir "$tmp/janitor"
have_live="$(git -C "$REPO" for-each-ref --format='%(refname)' "$live_ref")"
have_dead="$(git -C "$REPO" for-each-ref --format='%(refname)' "$dead_ref")"
have_legacy="$(git -C "$REPO" for-each-ref --format='%(refname)' "$legacy_ref")"
if [ "$rc" -eq 0 ] && [ "$have_live" = "$live_ref" ] && [ -z "$have_dead" ] && [ -z "$have_legacy" ]; then
  ok "startup janitor reclaims dead-pid refs and keeps live-pid refs"
else
  bad "janitor: rc=$rc live=[$have_live] dead=[$have_dead] legacy=[$have_legacy]"; echo "$out"
fi
git -C "$REPO" update-ref -d "$live_ref" 2>/dev/null || true
while read -r r; do [ -n "$r" ] && git -C "$REPO" update-ref -d "$r" 2>/dev/null || true
done < <(git -C "$REPO" for-each-ref --format='%(refname)' 'refs/pa-review/pr-*')

# 20. R887-r2-K1: locale-independent reclaim (de_DE runtime if ESRCH translated;
#     else LC_ALL=C in reclaim — English strerror would hide the bug at base).
k1_msg="$(LC_ALL=de_DE.UTF-8 LANG=de_DE.UTF-8 bash -c 'kill -0 2147483646' 2>&1 || true)"
if locale -a 2>/dev/null | grep -qi de_DE && ! grep -qF 'No such process' <<<"$k1_msg"; then
  sleep 0.01 &
  k1_dead=$!; wait "$k1_dead" 2>/dev/null || true
  k1_ref="refs/pa-review/pr-9010-$k1_dead"
  git -C "$REPO" update-ref "$k1_ref" "$(git -C "$REPO" rev-parse HEAD)"
  run env LC_ALL=de_DE.UTF-8 LANG=de_DE.UTF-8 bash "$RUN" --dry-run --models fake-a:cloud --out-dir "$tmp/janitor-de"
  k1_have="$(git -C "$REPO" for-each-ref --format='%(refname)' "$k1_ref")"
  git -C "$REPO" update-ref -d "$k1_ref" 2>/dev/null || true
  if [ "$rc" -eq 0 ] && [ -z "$k1_have" ]; then ok "startup janitor reclaims dead-pid refs under de_DE locale"
  else bad "janitor de_DE: rc=$rc dead=[$k1_have]"; echo "$out"; fi
elif awk '/_reclaim_stale_pa_review_refs\(\)/,/^}/' "$RUN" | grep -q 'LC_ALL=C'; then
  locale -a 2>/dev/null | grep -qi de_DE \
    && echo "skip locale janitor runtime: de_DE present but kill ESRCH still English" \
    || echo "skip locale janitor runtime: de_DE not installed (locale -a)"
  ok "startup janitor reclaims dead-pid refs under de_DE locale"
else bad "janitor kill -0 missing LC_ALL=C (locale-independent ESRCH)"; fi

# 21. R887-r2-K2: janitor update-ref -d failure notes the dead-pid ref (reuse shim).
sleep 0.01 &
k2_dead=$!; wait "$k2_dead" 2>/dev/null || true
k2_ref="refs/pa-review/pr-9011-$k2_dead"
git -C "$REPO" update-ref "$k2_ref" "$(git -C "$REPO" rev-parse HEAD)"
run env PATH="$tmp/bin-delfail:$PATH" bash "$RUN" --dry-run --models fake-a:cloud --out-dir "$tmp/janitor-delfail"
if printf '%s' "$out" | grep -q "konnte Ref $k2_ref nicht loeschen"; then
  ok "janitor failed update-ref -d prints diagnostic for dead-pid ref"
else bad "janitor update-ref diagnostic missing for $k2_ref"; echo "$out"; fi
while read -r r; do [ -n "$r" ] && git -C "$REPO" update-ref -d "$r" 2>/dev/null || true
done < <(git -C "$REPO" for-each-ref --format='%(refname)' 'refs/pa-review/pr-*')

echo
if [ "$fails" -eq 0 ]; then
  echo "test-review-local: alles gruen."
  exit 0
fi
echo "test-review-local: $fails Fehler."
exit 1
