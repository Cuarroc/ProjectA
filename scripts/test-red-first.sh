#!/usr/bin/env bash
# Probe fuer T-1 in einem frischen Temp-Repo (nicht im Produktiv-Checkout).
# Zeigt: Ablehnung ohne Trailer, Annahme mit Trailer — und dass das
# scheitern *kann* (Regel 2).
set -euo pipefail

HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
PROBE="${PROBE_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/red-first-probe.XXXXXX")}"
cleanup() {
  if [ -z "${KEEP_PROBE:-}" ]; then
    rm -rf "$PROBE"
  fi
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "OK: $*"; }

mkdir -p "$PROBE/repo/.githooks" "$PROBE/repo/scripts/lib" "$PROBE/repo/scripts/ci"
cp "$HERE/.githooks/commit-msg" "$PROBE/repo/.githooks/commit-msg"
cp "$HERE/scripts/lib/test-first.sh" "$PROBE/repo/scripts/lib/test-first.sh"
cp "$HERE/scripts/ci/red-first.sh" "$PROBE/repo/scripts/ci/red-first.sh"
chmod +x "$PROBE/repo/.githooks/commit-msg"

cd "$PROBE/repo"
git init -q -b main
git config user.email "probe@example.test"
git config user.name "T-1 Probe"
git config core.hooksPath .githooks

echo "# probe" > README.md
git add README.md
git commit -q -m "docs: start"

# --- Ablehnung: Quelldatei ohne Trailer -----------------------------------
mkdir -p src
echo "export const x = 1;" > src/example.ts
git add src/example.ts
if git commit -q -m "feat: ohne trailer" >"$PROBE/commit.err" 2>&1; then
  fail "Commit ohne Trailer wurde angenommen"
fi
grep -q "Test-First:" "$PROBE/commit.err" || fail "Ablehnung erwaehnt Test-First nicht"
pass "Quell-Commit ohne Trailer wird abgelehnt"

# --- Ablehnung: Playwright-Konfiguration ist Quellkonfiguration ------------
git reset -q HEAD
git checkout -q -- src/example.ts 2>/dev/null || git clean -q -fd src
echo "export default {};" > playwright.config.ts
git add playwright.config.ts
if git commit -q -m "test: Playwright-Mocks abschalten" >"$PROBE/commit.err" 2>&1; then
  fail "playwright.config.ts wurde nicht als Quellkonfiguration erkannt"
fi
git reset -q HEAD
rm -f playwright.config.ts
pass "Playwright-Konfiguration verlangt einen Trailer"

# --- Annahme: Test-First ---------------------------------------------------
mkdir -p src
echo "export const x = 1;" > src/example.ts
git add src/example.ts
git commit -q -m "$(cat <<'EOF'
feat: mit beleg

Test-First: src/example.ts
EOF
)"
pass "Quell-Commit mit Test-First: wird angenommen"

# --- Annahme: nur Doku, kein Trailer ---------------------------------------
echo "note" >> README.md
git add README.md
git commit -q -m "docs: ohne trailer erlaubt"
pass "Doku-Commit ohne Trailer wird angenommen"

# --- Annahme: No-Test ------------------------------------------------------
echo "export const y = 2;" > src/example.ts
git add src/example.ts
git commit -q -m "$(cat <<'EOF'
chore: config

No-Test: Lint-Config
EOF
)"
pass "Quell-Commit mit No-Test: wird angenommen"

# --- Ablehnung: leerer Trailer ---------------------------------------------
echo "export const z = 3;" > src/example.ts
git add src/example.ts
if git commit -q -m "$(cat <<'EOF'
feat: leer

Test-First:
EOF
)" >"$PROBE/commit.err" 2>&1; then
  fail "leerer Test-First-Trailer wurde angenommen"
fi
pass "leerer Trailer wird abgelehnt"
git reset -q HEAD
git checkout -q -- src/example.ts 2>/dev/null || true
git clean -q -fd src >/dev/null 2>&1 || true

# --- Ablehnung: Komma-Liste ------------------------------------------------
echo "export const z = 3;" > src/example.ts
git add src/example.ts
if git commit -q -m "$(cat <<'EOF'
feat: liste

Test-First: a.ts,b.ts
EOF
)" >"$PROBE/commit.err" 2>&1; then
  fail "Listen-Trailer wurde angenommen"
fi
pass "Listen-Trailer wird abgelehnt"
git reset -q HEAD
git checkout -q -- src/example.ts 2>/dev/null || git clean -q -fd

# --- Schicht c: Merge-Base rot, Kopf gruen -------------------------------
mkdir -p "$PROBE/ci-repo/scripts/ci" "$PROBE/ci-repo/scripts/lib" \
  "$PROBE/ci-repo/src" "$PROBE/ci-repo/src-tauri/src"
cp "$HERE/scripts/ci/red-first.sh" "$PROBE/ci-repo/scripts/ci/red-first.sh"
cp "$HERE/scripts/lib/test-first.sh" "$PROBE/ci-repo/scripts/lib/test-first.sh"
(
  cd "$PROBE/ci-repo"
  git init -q -b main
  git config user.email "probe@example.test"
  git config user.name "T-1 Probe"
  echo "export const behavior = 'old';" > src/behavior.ts
  printf '#!/usr/bin/env bash\nexit 1\n' > scripts/test-behavior.sh
  # Ein zusaetzlicher, von Anfang an gruener Test OHNE Test-First-Trailer in
  # der Historie: der "falscher Beleg"-Fall unten muss eine Spec nennen, die
  # main NICHT bereits bewiesen hat — sonst greift die already-proven-on-main
  # Ausnahme (35f93b7) und der Fall prueft nichts mehr.
  printf '#!/usr/bin/env bash\nexit 0\n' > scripts/test-always-green.sh
  cat > src-tauri/Cargo.toml <<'EOF'
[package]
name = "red-first-probe"
version = "0.1.0"
edition = "2021"
EOF
  cat > src-tauri/src/main.rs <<'EOF'
fn behavior() -> &'static str { "old" }
fn main() {}

#[cfg(test)]
mod tests {
    #[test]
    fn behavior_is_new() {
        assert_eq!(super::behavior(), "new");
    }
}
EOF
  chmod +x scripts/test-behavior.sh scripts/test-always-green.sh scripts/ci/red-first.sh
  git add .
  git commit -q -m "test: rote Ausgangslage"
  base="$(git rev-parse HEAD)"

  echo "export const behavior = 'new';" > src/behavior.ts
  printf '#!/usr/bin/env bash\necho "ok   behavior_is_new"\n' > scripts/test-behavior.sh
  perl -0pi -e 's/\{ "old" \}/\{ "new" \}/' src-tauri/src/main.rs
  git add .
  git commit -q -m "feat: Verhalten repariert" \
    -m "Test-First: scripts/test-behavior.sh::behavior_is_new" \
    -m "Test-First: src-tauri/src/main.rs::behavior_is_new" \
    -m "Test-First: tests::behavior_is_new"
  head="$(git rev-parse HEAD)"

  BASE_SHA="$base" HEAD_SHA="$head" PR_BODY="" bash scripts/ci/red-first.sh \
    >"$PROBE/red-first.out" 2>&1

  # --- Regression 09.09.: geteiltes CARGO_TARGET_DIR darf das Gate nicht
  # --- beluegen ------------------------------------------------------------
  # Base- und Head-Baum enthalten dasselbe Paket in derselben Version. Zeigen
  # beide auf DASSELBE target/, vergibt cargo denselben Artefaktnamen (der
  # Paketpfad geht beim Wurzelpaket nicht in den -C metadata-Hash ein), und
  # der Kopf-Lauf fuehrt das Binary der Merge-Base aus: "Finished in 0.02s",
  # Backtrace zeigt auf .../base/src-tauri/src/main.rs. Gemessen genau so, als
  # ein Optimierungsversuch CARGO_TARGET_DIR global setzte.
  #
  # Der Fall ist heimtueckisch, weil er wie ein fachliches Ergebnis aussieht:
  # der Test ist "am Kopf rot", obwohl der Code am Kopf gruen ist. red-first
  # setzt das Verzeichnis deshalb je Baum SELBST und ueberschreibt einen von
  # aussen gesetzten Wert.
  if ! CARGO_TARGET_DIR="$PROBE/feindliches-target" \
    BASE_SHA="$base" HEAD_SHA="$head" PR_BODY="" bash scripts/ci/red-first.sh \
    >"$PROBE/hostile-target.out" 2>&1; then
    echo "--- Ausgabe ---" >&2
    sed 's/^/    /' "$PROBE/hostile-target.out" >&2
    fail "ein von aussen gesetztes CARGO_TARGET_DIR haebelt den Beweis aus (Kopf faelschlich rot)"
  fi
  pass "geteiltes CARGO_TARGET_DIR haebelt den Beweis nicht aus"

  # --- --plan: OB es etwas zu tun gibt, ohne einen einzigen Build ----------
  # Der Plan-Modus steuert in ci.yml, ob ~4 min Toolchain installiert werden.
  # Er darf deshalb nie "nichts zu tun" sagen, wenn doch etwas zu tun ist —
  # und vor allem darf ein Commit ohne Trailer nicht als count=0 durchgehen.
  if ! BASE_SHA="$base" HEAD_SHA="$head" PR_BODY="" \
    bash scripts/ci/red-first.sh --plan >"$PROBE/plan.out" 2>&1; then
    sed 's/^/    /' "$PROBE/plan.out" >&2
    fail "--plan schlug fehl, obwohl Belege vorliegen"
  fi
  if ! grep -qE '^count=[1-9]' "$PROBE/plan.out"; then
    sed 's/^/    /' "$PROBE/plan.out" >&2
    fail "--plan meldet keine Belege, obwohl zwei Test-First-Trailer vorliegen"
  fi
  pass "--plan zaehlt vorhandene Belege"

  # Doku-only: nichts zu tun, und das darf der Job glauben.
  echo "# nur Doku" > NOTIZ.md
  git add NOTIZ.md
  git commit -q -m "docs: nur Doku"
  doc_head="$(git rev-parse HEAD)"
  if ! BASE_SHA="$head" HEAD_SHA="$doc_head" PR_BODY="" \
    bash scripts/ci/red-first.sh --plan >"$PROBE/plan-doku.out" 2>&1; then
    sed 's/^/    /' "$PROBE/plan-doku.out" >&2
    fail "--plan schlug bei einem Doku-only-Bereich fehl"
  fi
  grep -qx 'count=0' "$PROBE/plan-doku.out" ||
    fail "--plan meldet bei Doku-only nicht count=0"
  pass "--plan meldet count=0 fuer Doku-only"

  # Der gefaehrliche Fall: Quellcode ohne Trailer. Waere das count=0, wuerde
  # ci.yml die Installation ueberspringen UND der Job gruen enden — ein
  # Persilschein fuer genau den Commit, den das Gate fangen soll.
  echo "export const smuggled = 1;" > src/smuggled.ts
  git add src/smuggled.ts
  git -c core.hooksPath=/dev/null commit -q -m "feat: ohne Trailer eingeschmuggelt"
  smuggled_head="$(git rev-parse HEAD)"
  if BASE_SHA="$doc_head" HEAD_SHA="$smuggled_head" PR_BODY="" \
    bash scripts/ci/red-first.sh --plan >"$PROBE/plan-ohne-trailer.out" 2>&1; then
    sed 's/^/    /' "$PROBE/plan-ohne-trailer.out" >&2
    fail "--plan laesst Quellcode ohne Trailer als count=0 durch"
  fi
  pass "--plan lehnt Quellcode ohne Trailer ab (kein stilles count=0)"
  git reset -q --hard "$head"

  echo "export const behavior = 'still-new';" > src/behavior.ts
  git add src/behavior.ts
  git commit -q -m "feat: falscher Test-First-Beleg" -m "Test-First: scripts/test-always-green.sh"
  bad_head="$(git rev-parse HEAD)"
  if BASE_SHA="$head" HEAD_SHA="$bad_head" PR_BODY="" bash scripts/ci/red-first.sh \
    >"$PROBE/red-first.err" 2>&1; then
    sed 's/^/    /' "$PROBE/red-first.err" >&2
    fail "red-first akzeptiert einen bereits gruenen Test an der Merge-Base"
  fi

  mkdir -p evidence
  echo "kein ausfuehrbarer Test" > evidence/proof.txt
  echo "export const behavior = 'bypassed';" > src/behavior.ts
  git add src/behavior.ts evidence/proof.txt
  git commit -q -m "feat: ungueltiger Belegtyp" -m "Test-First: evidence/proof.txt"
  unsupported_head="$(git rev-parse HEAD)"
  if BASE_SHA="$bad_head" HEAD_SHA="$unsupported_head" PR_BODY="" \
    bash scripts/ci/red-first.sh >"$PROBE/unsupported.err" 2>&1; then
    fail "red-first akzeptiert einen Test-First-Pfad ohne Test-Runner"
  fi

  echo "export const behavior = 'missing-test';" > src/behavior.ts
  git add src/behavior.ts
  git commit -q -m "feat: fehlender Rust-Test" \
    -m "Test-First: src-tauri/src/main.rs::does_not_exist"
  missing_head="$(git rev-parse HEAD)"
  if BASE_SHA="$unsupported_head" HEAD_SHA="$missing_head" PR_BODY="" \
    bash scripts/ci/red-first.sh >"$PROBE/missing-rust.err" 2>&1; then
    fail "red-first akzeptiert einen Rust-Filter mit null Treffern"
  fi

  echo "export const behavior = 'bad-regression';" > src/behavior.ts
  git add src/behavior.ts
  git commit -q -m "fix: fremder Regression-SHA" -m "Regression-For: deadbeef"
  bad_regression_head="$(git rev-parse HEAD)"
  if BASE_SHA="$missing_head" HEAD_SHA="$bad_regression_head" PR_BODY="" \
    bash scripts/ci/red-first.sh >"$PROBE/bad-regression.err" 2>&1; then
    fail "red-first akzeptiert einen unerreichbaren Regression-SHA"
  fi

  echo "export const behavior = 'valid-regression';" > src/behavior.ts
  git add src/behavior.ts
  git commit -q -m "fix: erreichbarer Regression-SHA" \
    -m "Regression-For: $missing_head"
  valid_regression_head="$(git rev-parse HEAD)"
  BASE_SHA="$bad_regression_head" HEAD_SHA="$valid_regression_head" PR_BODY="" \
    bash scripts/ci/red-first.sh >"$PROBE/valid-regression.out" 2>&1

  # --- .mjs Test-First support (Regression fuer red-first.sh selbst) -------
  # Diese Datei fehlt an der Merge-Base (rot/fehlend, wie erwartet) und ist
  # am Kopf ein echter, gruener node --test-Lauf. Ohne den *.mjs-Zweig in
  # run_spec/classify_run schlaegt das mit "Nicht unterstuetzter Test-First-
  # Dateityp" fehl, obwohl die Datei existiert und gruen ist.
  mkdir -p scripts/lib
  cat > scripts/lib/mjs-probe.test.mjs <<'MJSEOF'
import { test } from "node:test";
import assert from "node:assert/strict";

test("mjs Test-First-Belege werden unterstuetzt", () => {
  assert.equal(1 + 1, 2);
});
MJSEOF
  git add scripts/lib/mjs-probe.test.mjs
  git commit -q -m "feat: mjs Test-First Beleg" \
    -m "Test-First: scripts/lib/mjs-probe.test.mjs"
  mjs_head="$(git rev-parse HEAD)"
  BASE_SHA="$valid_regression_head" HEAD_SHA="$mjs_head" PR_BODY="" \
    bash scripts/ci/red-first.sh >"$PROBE/mjs-support.out" 2>&1
  # CommonJS smoke scripts must follow the same node --test contract.
  mkdir -p docs/concepts
  cat > docs/concepts/probe.smoke.cjs <<'CJSEOF'
const assert = require('node:assert/strict');
assert.equal(2 + 2, 4);
CJSEOF
  git add docs/concepts/probe.smoke.cjs
  git commit -q -m "test: CommonJS smoke evidence" \
    -m "Test-First: docs/concepts/probe.smoke.cjs"
  cjs_head="$(git rev-parse HEAD)"
  BASE_SHA="$mjs_head" HEAD_SHA="$cjs_head" PR_BODY="" \
    bash scripts/ci/red-first.sh >"$PROBE/cjs-support.out" 2>&1

  # Exercise the public gate with completed Node tests and a leftover handle.
  cat > scripts/lib/open-handle.test.mjs <<'NODEEOF'
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
const record = (stage) => {
  const stat = readFileSync('/proc/self/stat', 'utf8').split(') ')[1].split(' ');
  appendFileSync(process.env.RF_PROBE_RECORD,
    JSON.stringify({ pid: process.pid, start: stat[19], group: Number(stat[2]), stage }) + '\n');
};
record('started');
setInterval(() => {}, 1000);
test('exact named pass', () => { assert.equal(2 + 2, 4); record('passed'); });
test('exact named failure', () => { assert.equal(2 + 2, 5); });
after(() => record('completed'));
NODEEOF
  cat > scripts/lib/bare-pass.test.mjs <<'NODEEOF'
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
const record = (stage) => {
  const stat = readFileSync('/proc/self/stat', 'utf8').split(') ')[1].split(' ');
  appendFileSync(process.env.RF_PROBE_RECORD,
    JSON.stringify({ pid: process.pid, start: stat[19], group: Number(stat[2]), stage }) + '\n');
};
setInterval(() => {}, 1000);
test('bare-path assertion', () => { assert.equal(2 + 2, 4); record('passed'); });
after(() => record('completed'));
NODEEOF
  sed 's/assert.equal(2 + 2, 4)/assert.equal(2 + 2, 5)/' \
    scripts/lib/bare-pass.test.mjs > scripts/lib/bare-fail.test.mjs
  git add scripts/lib/open-handle.test.mjs scripts/lib/bare-*.test.mjs
  git commit -q -m "test: completed named Node runs with open handles"
  named_head="$(git rev-parse HEAD)"
  # This foreground supervisor always joins the gate and checks PID/starttime/
  # process-group ownership. Its deadline fails the selftest, never proves RED.
  python3 - "$PROBE" "$cjs_head" "$named_head" <<'PYEOF'
import json, os, signal, subprocess, sys, time
from pathlib import Path

probe, base, head = sys.argv[1:]
def identity(pid):
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(') ', 1)[1].split()
        return fields[19], int(fields[2]), fields[0]
    except FileNotFoundError:
        return None

cases = [(name, 'scripts/lib/open-handle.test.mjs::' + name, code) for name, code in
         [('exact named pass', 0), ('missing name', 1), ('exact named failure', 1)]]
cases += [('bare pass', 'scripts/lib/bare-pass.test.mjs', 0),
          ('bare failure', 'scripts/lib/bare-fail.test.mjs', 1)]
for name, spec, expected in cases:
    record = Path(probe, name + '.jsonl')
    output = Path(probe, name + '.log')
    env = dict(os.environ, BASE_SHA=base, HEAD_SHA=head,
               PR_BODY='Test-First: ' + spec, RF_PROBE_RECORD=str(record))
    owned, expired, leaked = {}, False, False
    with output.open('w') as log:
        child = subprocess.Popen(['bash', 'scripts/ci/red-first.sh'], env=env,
                                 stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        deadline = time.monotonic() + 15
        try:
            while child.poll() is None:
                for path in Path('/proc').iterdir():
                    if path.name.isdigit():
                        current = identity(int(path.name))
                        if current and current[1] == child.pid:
                            owned[int(path.name)] = current[:2]
                if time.monotonic() >= deadline:
                    expired = True
                    break
                time.sleep(0.02)
        finally:
            leaked = not expired and any(
                (current := identity(pid)) and current[:2] == original and current[2] != 'Z'
                for pid, original in owned.items())
            # Signal only processes observed in this probe's newly owned group.
            for sig in (signal.SIGTERM, signal.SIGKILL):
                for pid, original in owned.items():
                    current = identity(pid)
                    if current and current[:2] == original and current[2] != 'Z':
                        try:
                            if sig == signal.SIGTERM and Path(f'/proc/{pid}/comm').read_text().strip() != 'node':
                                continue
                            os.kill(pid, sig)
                        except (ProcessLookupError, FileNotFoundError):
                            pass
                try:
                    child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    continue
                time.sleep(0.05)
            child.wait(timeout=2)
    records = [json.loads(line) for line in record.read_text().splitlines()]
    for item in records:
        assert item['group'] == child.pid, 'fixture escaped its owned process group'
        owned[item['pid']] = (item['start'], item['group'])
    for pid, original in owned.items():
        current = identity(pid)
        assert not current or current[:2] != original or current[2] == 'Z', 'owned child leaked'
    assert any(item['stage'] == 'completed' for item in records), 'fixture did not complete'
    if expected == 0:
        assert any(item['stage'] == 'passed' for item in records), 'named assertion did not pass'
    print(f'owned process cleanup verified: {name}', flush=True)
    assert not leaked, f'{name}: gate exited with a live owned child'
    assert not expired, f'{name}: tests completed but Node did not exit; deadline is not RED evidence'
    text = output.read_text()
    assert child.returncode == expected, (name, child.returncode, text)
    assert f'{spec} ist an der Merge-Base rot/fehlend (erwartet).' in text, text
    if expected == 0:
        passed = 'bare-path assertion' if name == 'bare pass' else 'exact named pass'
        assert f'✔ {passed} (' in text and f'{spec} ist am Kopf gruen.' in text, text
    else:
        assert f'{spec} ist am Kopf nicht gruen.' in text, text
        assert f'{spec} ist am Kopf gruen.' not in text, text
        if name == 'missing name':
            assert '✔ scripts/lib/open-handle.test.mjs (' in text, text
        else:
            assert 'AssertionError' in text, text
    print(f'classification verified: {name}', flush=True)
PYEOF
  printf '%s\n' 'ok   completed named Node runs exit with strict classification'
  printf '%s\n' 'ok   completed bare-path Node runs exit with strict classification'

)
pass "CI-Beweis verlangt Base rot, Kopf gruen, echte Rust-Treffer und erreichbare SHAs"

# --- Selbsttest muss auch scheitern koennen: Hook entfernen ----------------
rm .githooks/commit-msg
echo "export const sneak = 1;" > src/sneak.ts
git add src/sneak.ts
if ! git commit -q -m "feat: sneak ohne hook"; then
  fail "ohne Hook muss ein Commit durchgehen (sonst prueft die Probe den Hook nicht)"
fi
pass "Kontrolle: ohne Hook waere der schlechte Commit durchgegangen"

echo
echo "scripts/test-red-first.sh: alle Proben gruen"
