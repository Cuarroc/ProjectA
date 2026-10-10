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
import json, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

barrier = threading.Barrier(2)
attempts = {}
lock = threading.Lock()
# Slow reviewer blocks until /early-release; fast reviewer answers at once.
early_release = threading.Event()
# Separate latch for the unwritable-protocol race (R958-A4).
write_fail_release = threading.Event()

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
        status = 200
        path = self.path
        if path in ("/early-release", "/write-fail-release"):
            if path == "/early-release":
                early_release.set()
            else:
                write_fail_release.set()
            body = b'{"ok": true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/early-slow":
            if not early_release.wait(timeout=15):
                status = 408
            path = "/gut" if status == 200 else path
        elif path == "/write-fail-slow":
            if not write_fail_release.wait(timeout=15):
                status = 408
            path = "/gut" if status == 200 else path
        elif path == "/early-fast":
            path = "/gut"
        elif path in ("/parallel-a", "/parallel-b"):
            try:
                barrier.wait(timeout=5)
                path = "/gut"
            except threading.BrokenBarrierError:
                status = 408
        # First response is a retryable HTTP error; the second attempt hangs
        # until the client socket timeout fires (R958-A1).
        if path.startswith("/retry-then-hang-"):
            with lock:
                attempts[path] = attempts.get(path, 0) + 1
                attempt = attempts[path]
            if attempt == 1:
                code = int(path.rsplit("-", 1)[1])
                status = code
                body = json.dumps({"attempts": attempt}).encode()
                self.send_response(status)
                self.send_header("Retry-After", "0")
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            time.sleep(60)
            return
        if path.startswith("/retry-") or path.startswith("/always-"):
            with lock:
                attempts[path] = attempts.get(path, 0) + 1
                attempt = attempts[path]
            code = int(path.rsplit("-", 1)[1])
            status = code if attempt == 1 or path.startswith("/always-") else 200
            path = "/gut" if status == 200 else path
        if self.path == "/html":            # JSON erwartet, HTML bekommen
            body = b"<html>502 Bad Gateway</html>"
        else:
            body = json.dumps(ANTWORTEN.get(path, {"attempts": attempts.get(path)})).encode()
        self.send_response(status)
        if status in (429, 502, 503):
            self.send_header("Retry-After", "0")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a):
        pass

s = ThreadingHTTPServer(("127.0.0.1", 0), H)
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

if lauf "two reviewers run concurrently" 0 /parallel-a /parallel-b; then
  for reviewer in r1 r2; do
    datei="$tmp/out-two reviewers run concurrently/review_probe_$reviewer.md"
    grep -q "Status: ok" "$datei" && grep -q "ANNEHMEN: alles gut." "$datei" &&
      ok "$reviewer: concurrent verdict recorded" || bad "$reviewer: concurrent verdict missing"
  done
fi

if lauf "429 then 200 yields a verdict" 0 /retry-429; then
  datei="$tmp/out-429 then 200 yields a verdict/review_probe_r1.md"
  grep -q "Status: ok" "$datei" && grep -q "ANNEHMEN: alles gut." "$datei" &&
    ok "retried verdict recorded" || bad "retried verdict missing"
fi
# R938-A1: a successful retry must be visible in the protocol; a failed retry
# must say so in the failure text. Print `ok <exact name>` only when both
# checks pass — red-first matches that line, not the suite exit code.
retry_name="a retried reviewer records the retry in its protocol"
retry_out="$tmp/out-$retry_name"
mkdir -p "$retry_out"
(
  export REVIEWER_1_NAME=r1 REVIEWER_1_KIND=openai \
         REVIEWER_1_URL="http://127.0.0.1:$port/retry-note-429" REVIEWER_1_MODEL=modell-1
  "$PY" .pa/review_transport.py "$tmp/prompt.md" "$retry_out" probe --author selbsttest
) > "$tmp/$retry_name.log" 2>&1
retry_got=$?
retry_ok_datei="$retry_out/review_probe_r1.md"
fail_out="$tmp/out-$retry_name-fail"
mkdir -p "$fail_out"
(
  export REVIEWER_1_NAME=r1 REVIEWER_1_KIND=openai \
         REVIEWER_1_URL="http://127.0.0.1:$port/always-retrytext-429" REVIEWER_1_MODEL=modell-1
  "$PY" .pa/review_transport.py "$tmp/prompt.md" "$fail_out" probe --author selbsttest
) > "$tmp/$retry_name-fail.log" 2>&1
retry_fail_got=$?
retry_fail_datei="$fail_out/review_probe_r1.md"
if [ "$retry_got" -eq 0 ] && grep -q "retried once after HTTP 429" "$retry_ok_datei" 2>/dev/null &&
   [ "$retry_fail_got" -eq 1 ] && grep -q "after one retry" "$retry_fail_datei" 2>/dev/null; then
  ok "$retry_name"
else
  bad "$retry_name"
  sed 's/^/    /' "$tmp/$retry_name.log" "$tmp/$retry_name-fail.log" 2>/dev/null || true
fi
# R958-A1: a timeout after a retryable first response must still show the
# retry Note and "after one retry" (not only the HTTP-error-on-second-attempt path).
timeout_retry_name="a retry followed by a timeout still records the retry"
timeout_retry_out="$tmp/out-$timeout_retry_name"
mkdir -p "$timeout_retry_out"
(
  export REVIEWER_TIMEOUT_S=1 \
         REVIEWER_1_NAME=r1 REVIEWER_1_KIND=openai \
         REVIEWER_1_URL="http://127.0.0.1:$port/retry-then-hang-429" REVIEWER_1_MODEL=modell-1
  "$PY" .pa/review_transport.py "$tmp/prompt.md" "$timeout_retry_out" probe --author selbsttest
) > "$tmp/$timeout_retry_name.log" 2>&1
timeout_retry_got=$?
timeout_retry_datei="$timeout_retry_out/review_probe_r1.md"
if [ "$timeout_retry_got" -eq 1 ] &&
   grep -q "retried once after HTTP 429" "$timeout_retry_datei" 2>/dev/null &&
   grep -q "after one retry" "$timeout_retry_datei" 2>/dev/null; then
  ok "$timeout_retry_name"
else
  bad "$timeout_retry_name (exit=$timeout_retry_got)"
  sed 's/^/    /' "$tmp/$timeout_retry_name.log" 2>/dev/null || true
  [ -f "$timeout_retry_datei" ] && sed 's/^/    /' "$timeout_retry_datei" || true
fi
for code in 502 503; do
  lauf "retry-$code" 0 "/retry-$code"
done
for code in 429 502 503 401; do
  if lauf "always-$code" 1 "/always-$code" /gut; then
    attempts=2
    [ "$code" -eq 401 ] && attempts=1
    datei="$tmp/out-always-$code/review_probe_r1.md"
    grep -q "HTTP $code:.*\"attempts\": $attempts" "$datei" &&
      ok "$code: bounded attempts" || bad "$code: wrong attempt count"
    grep -q "Status: ok" "$tmp/out-always-$code/review_probe_r2.md" &&
      ok "$code: second reviewer succeeded" || bad "$code: second reviewer lost"
  fi
done

# Check Retry-After without actually waiting up to the 30-second cap.
if "$PY" - <<'PYEOF'
import datetime, importlib.util, io, time, urllib.error
from email.utils import format_datetime
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location("transport", ".pa/review_transport.py")
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
now = 1800000000
# Real HTTP-date form ends in "GMT" (RFC 7231), not "+0000".
future = format_datetime(
    datetime.datetime.fromtimestamp(now + 12, datetime.timezone.utc), usegmt=True
)
assert future.endswith(" GMT"), future
for header, expected in [("2", 2), ("120", 30), (future, 12), ("bad", 1), (None, 1), ("-1", 0)]:
    error = urllib.error.HTTPError("http://localhost", 429, "busy",
                                   {"Retry-After": header}, io.BytesIO(b"busy"))
    response = MagicMock()
    response.__enter__.return_value.read.return_value = b'{"response": "verdict"}'
    with patch.object(transport.urllib.request, "urlopen", side_effect=[error, response]) as send, \
            patch.object(time, "sleep") as sleep, patch.object(time, "time", return_value=now):
        body, retried = transport.post_json("http://localhost", {}, "", 10)
        assert body == {"response": "verdict"}
        assert retried == 429
        assert send.call_count == 2
        sleep.assert_called_once_with(expected)
print("ok   Retry-After seconds, HTTP date, fallback and cap")
PYEOF
then
  ok "Retry-After handling"
else
  bad "Retry-After handling"
fi

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

# R938-A3: a finished reviewer's protocol must exist while a slower peer is
# still blocked — otherwise a kill of the slow peer loses the finished verdict.
early_name="a finished reviewer protocol exists before the slow reviewer finishes"
early_out="$tmp/out-$early_name"
mkdir -p "$early_out"
(
  export REVIEWER_1_NAME=r1 REVIEWER_1_KIND=openai \
         REVIEWER_1_URL="http://127.0.0.1:$port/early-slow" REVIEWER_1_MODEL=modell-1 \
         REVIEWER_2_NAME=r2 REVIEWER_2_KIND=openai \
         REVIEWER_2_URL="http://127.0.0.1:$port/early-fast" REVIEWER_2_MODEL=modell-2
  "$PY" .pa/review_transport.py "$tmp/prompt.md" "$early_out" probe --author selbsttest
) > "$tmp/$early_name.log" 2>&1 &
early_pid=$!
fast_proto="$early_out/review_probe_r2.md"
saw_fast=0
for _ in $(seq 1 50); do
  if [ -f "$fast_proto" ]; then
    saw_fast=1
    break
  fi
  # Still waiting: do not release the slow reviewer yet.
  if ! kill -0 "$early_pid" 2>/dev/null; then
    break
  fi
  sleep 0.1
done
# Release the slow reviewer so the transport can exit cleanly.
"$PY" -c "import urllib.request; urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:$port/early-release', data=b'{}', method='POST'), timeout=5)" \
  > /dev/null 2>&1 || true
wait "$early_pid"
early_got=$?
slow_proto="$early_out/review_probe_r1.md"
# R958-A5: stdout summary stays in configuration order; slow peer's protocol
# must also exist once the run finishes.
r1_line="$(grep -n '^r1: ' "$tmp/$early_name.log" 2>/dev/null | head -n1 | cut -d: -f1)"
r2_line="$(grep -n '^r2: ' "$tmp/$early_name.log" 2>/dev/null | head -n1 | cut -d: -f1)"
order_ok=0
if [ -n "$r1_line" ] && [ -n "$r2_line" ] && [ "$r1_line" -lt "$r2_line" ]; then
  order_ok=1
fi
if [ "$saw_fast" -eq 1 ] && grep -q "Status: ok" "$fast_proto" 2>/dev/null &&
   [ "$early_got" -eq 0 ] && [ "$order_ok" -eq 1 ] &&
   [ -f "$slow_proto" ] && grep -q "Status: ok" "$slow_proto" 2>/dev/null; then
  ok "$early_name"
else
  bad "$early_name (saw_fast=$saw_fast exit=$early_got order_ok=$order_ok)"
  sed 's/^/    /' "$tmp/$early_name.log" 2>/dev/null || true
fi

# R958-A3: duplicate slugs must be refused before any protocol is written.
dup_name="duplicate reviewer slugs are refused with exit 2"
dup_out="$tmp/out-$dup_name"
mkdir -p "$dup_out"
(
  export REVIEWER_1_NAME=r1 REVIEWER_1_KIND=openai \
         REVIEWER_1_URL="http://127.0.0.1:$port/gut" REVIEWER_1_MODEL=modell-1 \
         REVIEWER_2_NAME=r1 REVIEWER_2_KIND=openai \
         REVIEWER_2_URL="http://127.0.0.1:$port/gut" REVIEWER_2_MODEL=modell-2
  "$PY" .pa/review_transport.py "$tmp/prompt.md" "$dup_out" probe --author selbsttest
) > "$tmp/$dup_name.log" 2>&1
dup_got=$?
if [ "$dup_got" -eq 2 ] &&
   grep -qi "duplicate" "$tmp/$dup_name.log" 2>/dev/null &&
   [ ! -f "$dup_out/review_probe_r1.md" ]; then
  ok "$dup_name"
else
  bad "$dup_name (exit=$dup_got)"
  sed 's/^/    /' "$tmp/$dup_name.log" 2>/dev/null || true
fi

# R958-A4: a write OSError for one reviewer must not drop the other's protocol.
# r1 finishes first on an unwritable path; r2 stays blocked until release so a
# missing write-guard aborts before r2's protocol is written.
unwritable_name="an unwritable protocol does not lose the other verdict"
unwritable_out="$tmp/out-$unwritable_name"
mkdir -p "$unwritable_out"
# Make r1's protocol path a directory so open-for-write fails with EISDIR.
mkdir "$unwritable_out/review_probe_r1.md"
(
  export REVIEWER_1_NAME=r1 REVIEWER_1_KIND=openai \
         REVIEWER_1_URL="http://127.0.0.1:$port/gut" REVIEWER_1_MODEL=modell-1 \
         REVIEWER_2_NAME=r2 REVIEWER_2_KIND=openai \
         REVIEWER_2_URL="http://127.0.0.1:$port/write-fail-slow" REVIEWER_2_MODEL=modell-2
  "$PY" .pa/review_transport.py "$tmp/prompt.md" "$unwritable_out" probe --author selbsttest
) > "$tmp/$unwritable_name.log" 2>&1 &
unwritable_pid=$!
# Let r1 hit the write failure (or abort) before releasing r2.
for _ in $(seq 1 30); do
  if ! kill -0 "$unwritable_pid" 2>/dev/null; then
    break
  fi
  # With the write guard the process stays alive waiting for r2.
  if grep -q 'r1: failed' "$tmp/$unwritable_name.log" 2>/dev/null; then
    break
  fi
  sleep 0.1
done
"$PY" -c "import urllib.request; urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:$port/write-fail-release', data=b'{}', method='POST'), timeout=5)" \
  > /dev/null 2>&1 || true
wait "$unwritable_pid"
unwritable_got=$?
unwritable_r2="$unwritable_out/review_probe_r2.md"
if [ "$unwritable_got" -eq 1 ] &&
   [ -f "$unwritable_r2" ] && grep -q "Status: ok" "$unwritable_r2" 2>/dev/null &&
   grep -q "ANNEHMEN: alles gut." "$unwritable_r2" 2>/dev/null &&
   ! grep -q "Traceback" "$tmp/$unwritable_name.log" 2>/dev/null; then
  ok "$unwritable_name"
else
  bad "$unwritable_name (exit=$unwritable_got)"
  sed 's/^/    /' "$tmp/$unwritable_name.log" 2>/dev/null || true
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
