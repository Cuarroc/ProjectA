#!/usr/bin/env bash
# Selbsttest fuer scripts/ci/gates.sh.
#
# Ein Runner, der die Gates ausfuehrt, aber ein rotes Gate nicht nach aussen
# meldet, ist schlimmer als kein Runner: er macht aus einem Fehlschlag ein
# gruenes Haekchen. "Eine Pruefung, die nicht scheitern kann, prueft nichts"
# (AGENTS.md, Regel 2) — hier scheitert sie mehrfach absichtlich.
#
# Der Kern des Tests laeuft gegen eine KOPIE von gates.sh in einem Wegwerf-Repo,
# in die synthetische Gates eingeschleust werden (true / exit 3). Damit wird die
# echte Ausfuehrungslogik geprueft, ohne dass der Selbsttest 20 Minuten
# Rust-Suite braucht.
set -uo pipefail
HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$HERE" || exit 1
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

ok()   { echo "ok   $*"; }
bad()  { echo "FEHLER $*"; fails=$((fails + 1)); }

# --------------------------------------------------------------------------
# Teil 1: das echte Skript — Struktur der Liste
# --------------------------------------------------------------------------
LANES="precommit prepush branchpush linux windows release audit"

for lane in $LANES; do
  lane_ids="$(bash scripts/ci/gates.sh --list "$lane")"
  n="$(printf '%s\n' "$lane_ids" | grep -c . || true)"
  if [ "$n" -gt 0 ]; then
    ok "Bahn $lane ist nicht leer ($n Gates)"
  else
    bad "Bahn $lane ist LEER — ein Lauf ohne ein einziges Gate waere gruen durch Abwesenheit"
  fi
done

# Jedes Gate muss in mindestens einer Bahn liegen, sonst ist es totes Gewicht,
# das niemand ausfuehrt — dieselbe Klasse wie `npm run test:hq`, das bis zum
# 09.09. in package.json stand und nirgends lief.
alle="$(bash scripts/ci/gates.sh --list | awk '{print $1}' | sort -u)"
verwendet="$(for lane in $LANES; do bash scripts/ci/gates.sh --list "$lane"; done | sort -u)"
verwaist="$(comm -23 <(printf '%s\n' "$alle") <(printf '%s\n' "$verwendet"))"
if [ -z "$verwaist" ]; then
  ok "kein verwaistes Gate (jedes liegt in mindestens einer Bahn)"
else
  bad "verwaiste Gates, in keiner Bahn: $(printf '%s' "$verwaist" | tr '\n' ' ')"
fi

# Die Mindestbesetzung JEDER Bahn, nicht nur einer Auswahl.
#
# Die erste Fassung dieser Liste pruefte `linux` und `release` und dort auch
# nur eine Teilmenge. Der externe Dual-Review vom 21.09. hat das konvergent
# zerlegt (deepseek-v4-pro R-2 und kimi-k2.7-code R-9, beide Schwere hoch):
# solange ein Gate irgendwo verbleibt, meldet der Selbsttest nichts — die
# Bahn `linux` konnte also still ihre Rust-Suite oder ihre Workflow-
# Detektoren verlieren, und `prepush`/`windows` waren ueberhaupt nicht
# abgedeckt. Ein Waechter mit Loechern an den wichtigsten Stellen ist
# schlimmer als keiner: er erzeugt Vertrauen, das er nicht traegt.
#
# Die Liste ist bewusst eine MINDESTbesetzung, kein Soll-Ist-Vergleich:
# ein Gate hinzuzufuegen soll den Selbsttest nicht rot machen, ein Gate zu
# verlieren schon.
#
# ACHTUNG, hier ist der Selbsttest selbst in die Falle getappt, gegen die
# dieser Umbau antritt: `gates.sh --list linux | grep -qx X` liefert unter
# `pipefail` einen Fehlschlag, sobald grep frueh abbricht — gates.sh bekommt
# SIGPIPE (141), und der Status der Pipe ist nicht der von grep. Erst in eine
# Variable, dann pruefen.
pflicht_precommit="fmt cargo-check typecheck"
pflicht_prepush="fmt typecheck lint fe-test hq-test clippy rust-suite"
# CI-02: die leichte Bahn fuer Branch-Pushes (PA_PREPUSH=light) - alles aus
# prepush ausser dem Rust-Kern.
pflicht_branchpush="fmt typecheck lint fe-test hq-test"
pflicht_linux="no-masked wf-shell wf-pinned ci-shape selftest-gates selftest-red-first selftest-review selftest-lane-plan fmt typecheck lint fe-test hq-test hq-visual fe-build e2e clippy rust-suite"
pflicht_windows="fmt clippy rust-suite native-tests"
pflicht_release="no-masked wf-shell wf-pinned ci-shape selftest-gates selftest-red-first selftest-review selftest-lane-plan fmt typecheck lint fe-test hq-test hq-visual fe-build e2e clippy rust-suite"
pflicht_audit="audit-rust audit-npm"

for lane in $LANES; do
  eval "soll=\$pflicht_$lane"
  ist="$(bash scripts/ci/gates.sh --list "$lane")"
  fehlend=""
  for pflicht in $soll; do
    printf '%s\n' "$ist" | grep -qx "$pflicht" || fehlend="$fehlend $pflicht"
  done
  if [ -z "$fehlend" ]; then
    ok "Bahn $lane hat ihre Mindestbesetzung ($(printf '%s' "$soll" | wc -w) Gates)"
  else
    bad "Bahn $lane fehlen Pflicht-Gates:$fehlend"
  fi
done

# Jede Bahn, die ein Gate nennt, muss es auch geben. Befund kimi-k2.7-code
# R-11: `LANES` und die lanes-Spalte in `GATES` sind zwei Listen, und ein
# Gate, das eine Bahn nennt, die es in `LANES` nicht gibt, ist unerreichbar —
# eine neue Drift-Form in einem Skript, das mit "Drift ist unmoeglich"
# antritt. Der Test auf verwaiste Gates oben faengt sie nicht: das Gate liegt
# ja in einer Bahn, nur in keiner existierenden.
genannte="$(bash scripts/ci/gates.sh --list | awk '{print $2}' | tr ',' '\n' | sort -u | grep -v '^$')"
unbekannte=""
for bahn in $genannte; do
  case " $LANES " in *" $bahn "*) ;; *) unbekannte="$unbekannte $bahn" ;; esac
done
if [ -z "$unbekannte" ]; then
  ok "jede in GATES genannte Bahn existiert auch in LANES"
else
  bad "GATES nennt Bahnen, die es nicht gibt (unerreichbare Gates):$unbekannte"
fi

# Die Rust-Suite muss ueberall nextest sein. `cargo test` misst etwas anderes
# (geteilter Prozess, keine Retry-Sperre, kein slow-timeout) — genau die Drift
# zwischen pre-push und CI, die dieses Skript beseitigt.
alle_zeilen="$(bash scripts/ci/gates.sh --list)"
if printf '%s\n' "$alle_zeilen" | grep -E '^rust-suite' | grep -q 'cargo nextest run --profile ci'; then
  ok "rust-suite fuehrt nextest mit dem Profil ci"
else
  bad "rust-suite fuehrt nicht 'cargo nextest run --profile ci'"
fi

# --------------------------------------------------------------------------
# Teil 2: Ablehnungen
# --------------------------------------------------------------------------
expect_exit() { # name erwartet befehl...
  local name="$1" want="$2"; shift 2
  "$@" > "$tmp/$name.log" 2>&1
  local got=$?
  if [ "$got" -eq "$want" ]; then
    ok "$name (Exit $got)"
  else
    bad "$name: Exit $got, erwartet $want"; sed 's/^/    /' "$tmp/$name.log"
  fi
}

expect_exit "unbekannte-bahn"  2 bash scripts/ci/gates.sh lane gibtsnicht
expect_exit "unbekanntes-gate" 2 bash scripts/ci/gates.sh run gibtsnicht
expect_exit "ohne-argument"    2 bash scripts/ci/gates.sh
expect_exit "from-unbekannt"   2 bash scripts/ci/gates.sh --from gibtsnicht lane linux
expect_exit "from-falsche-bahn" 2 bash scripts/ci/gates.sh --from cargo-check lane linux

# --------------------------------------------------------------------------
# Teil 3: Ausfuehrung gegen eingeschleuste Gates (das eigentliche Verhalten)
# --------------------------------------------------------------------------
mkdir -p "$tmp/repo/scripts/ci"
cd "$tmp/repo" || exit 1
git init -q -b main
git config user.email "probe@example.test"
git config user.name "gates-Probe"
echo "# probe" > README.md
echo "wert" > getrackt.txt
git add README.md getrackt.txt
git commit -q -m "docs: start"

# Kopie mit synthetischen Gates in einer eigenen Bahn `probe`.
awk '
  /^GATES=\(/ {
    print
    print "  \"p-ok|probe,probe-rot,probe-from,probe-dreckig|.|true\""
    print "  \"p-rot|probe-rot|.|exit 3\""
    print "  \"p-danach|probe-rot,probe-from|.|true\""
    print "  \"p-schreibt|probe-schreibt,probe-run|.|echo geaendert > getrackt.txt\""
    print "  \"p-verwirft|probe-verwirft|.|git restore -- getrackt.txt\""
    print "  \"p-pipe|probe-pipe|.|echo hallo | tr a-z A-Z > ../pipe-beweis.txt\""
    next
  }
  /^LANES=/ { print "LANES=\"precommit prepush branchpush linux windows release audit probe probe-rot probe-from probe-schreibt probe-dreckig probe-pipe probe-run probe-verwirft\""; next }
  { print }
' "$HERE/scripts/ci/gates.sh" > scripts/ci/gates.sh
chmod +x scripts/ci/gates.sh

cd "$HERE" || exit 1
G="$tmp/repo/scripts/ci/gates.sh"

bash "$G" lane probe > "$tmp/probe.log" 2>&1
got=$?
[ "$got" -eq 0 ] && ok "gruene Bahn endet mit Exit 0" || { bad "gruene Bahn: Exit $got"; sed 's/^/    /' "$tmp/probe.log"; }
grep -q "p-ok" "$tmp/probe.log" && ok "Zusammenfassung nennt das gelaufene Gate" || bad "Zusammenfassung nennt p-ok nicht"
grep -q "NICHT ABGEDECKT" "$tmp/probe.log" && ok "Grenze der Aequivalenz wird gedruckt" || bad "Block 'NICHT ABGEDECKT' fehlt"
grep -qE "^ +Plattform" "$tmp/probe.log" && ok "Umgebungskopf wird gedruckt" || bad "Umgebungskopf fehlt"

# Der wichtigste Fall: ein rotes Gate faerbt den ganzen Lauf rot, nennt es in
# der Zusammenfassung, und die teuren Gates dahinter laufen nicht mehr.
bash "$G" lane probe-rot > "$tmp/rot.log" 2>&1
got=$?
[ "$got" -ne 0 ] && ok "rotes Gate faerbt den Lauf rot (Exit $got)" || { bad "rotes Gate blieb gruen (Exit $got)"; sed 's/^/    /' "$tmp/rot.log"; }
grep -q "ROT(3)" "$tmp/rot.log" && ok "Zusammenfassung nennt den echten Exit-Code (3)" || { bad "Exit-Code 3 fehlt in der Zusammenfassung"; sed 's/^/    /' "$tmp/rot.log"; }
grep -q "NICHT mehr gelaufen" "$tmp/rot.log" && ok "uebersprungene Gates werden benannt" || bad "uebersprungene Gates werden verschwiegen"
if grep -q "Gate p-danach:" "$tmp/rot.log"; then
  bad "Gate nach dem Fehlschlag lief trotzdem — kein Fail-Fast"
else
  ok "nach dem Fehlschlag laeuft kein weiteres Gate"
fi

# --from setzt hinter dem Fehlschlag wieder auf.
bash "$G" --from p-danach lane probe-from > "$tmp/from.log" 2>&1
got=$?
[ "$got" -eq 0 ] && ok "--from laeuft (Exit 0)" || { bad "--from: Exit $got"; sed 's/^/    /' "$tmp/from.log"; }
if grep -q "Gate p-ok:" "$tmp/from.log"; then
  bad "--from hat das vorherige Gate trotzdem ausgefuehrt"
else
  ok "--from ueberspringt die Gates davor"
fi

# Der Waechter gegen Seiteneffekte. Anlass: `npm run test:hq` startete ueber
# zwei Tests den hq-live-Server, der beim Start docs/dev-hq/data.json und
# data.js im ECHTEN Baum neu erzeugte — unsichtbar, solange das Gate nirgends
# lief, und ab dem Einhaengen war der Baum nach jedem prepush dreckig.
bash "$G" lane probe-schreibt > "$tmp/schreibt.log" 2>&1
got=$?
[ "$got" -ne 0 ] && ok "ein Gate, das eine getrackte Datei anfasst, faerbt den Lauf rot (Exit $got)" ||
  { bad "ein schreibendes Gate blieb gruen"; sed 's/^/    /' "$tmp/schreibt.log"; }
grep -q "Arbeitsbaum veraendert" "$tmp/schreibt.log" &&
  ok "der Waechter benennt die Ursache" || bad "keine Meldung zum veraenderten Arbeitsbaum"
grep -q "getrackt.txt" "$tmp/schreibt.log" &&
  ok "der Waechter nennt die betroffene Datei" || bad "die betroffene Datei wird nicht genannt"

# Ein Gate-Befehl MIT Pipe muss vollstaendig ausgefuehrt werden. Befund des
# externen Dual-Reviews vom 21.09. (deepseek R-3 / kimi R-1, konvergent):
# `cut -d'|' -f4` schnitt den Befehl am ersten `|` ab, `eval` fuehrte still
# nur `echo hallo` aus. Kein Gate hatte bisher eine Pipe — der Fehler war
# schlafend und waere beim ersten solchen Gate als fachlicher Fehlschlag
# erschienen, nicht als Parserfehler.
bash "$G" lane probe-pipe > "$tmp/pipe.log" 2>&1
got=$?
[ "$got" -eq 0 ] && ok "Gate mit Pipe im Befehl laeuft (Exit 0)" ||
  { bad "Gate mit Pipe: Exit $got"; sed 's/^/    /' "$tmp/pipe.log"; }
# Der Beweis landet AUSSERHALB des Probe-Repos: schriebe das Gate in den
# Baum, schluege der Arbeitsbaum-Waechter zu Recht an, und dieser Fall wuerde
# aus dem falschen Grund rot. (Genau das ist beim ersten Entwurf passiert —
# ein schoener Beleg nebenbei, dass der Waechter auch untrackte Dateien sieht.)
if [ "$(cat "$tmp/pipe-beweis.txt" 2>/dev/null)" = "HALLO" ]; then
  ok "der Teil HINTER der Pipe lief auch (HALLO)"
else
  bad "hinter der Pipe wurde nichts ausgefuehrt: '$(cat "$tmp/pipe-beweis.txt" 2>/dev/null)'"
fi
rm -f "$tmp/pipe-beweis.txt"

# Der Waechter muss auch dann anschlagen, wenn die Datei SCHON vorher
# geaendert war. Befund deepseek-v4-pro R-1 (Schwere hoch): mit nur den
# Statuszeilen blieb ` M getrackt.txt` vor und nach dem Lauf identisch, und
# `comm` meldete nichts — blind ausgerechnet im haeufigsten lokalen Fall.
( cd "$tmp/repo" && echo "schon vorher geaendert" > getrackt.txt )
bash "$G" lane probe-schreibt > "$tmp/schon-dreckig.log" 2>&1
got=$?
[ "$got" -ne 0 ] &&
  ok "ein Gate, das eine BEREITS geaenderte Datei neu schreibt, faerbt rot (Exit $got)" ||
  { bad "der Waechter ist blind, wenn die Datei schon vorher dreckig war"; sed 's/^/    /' "$tmp/schon-dreckig.log"; }
( cd "$tmp/repo" && git checkout -q -- getrackt.txt )

# Derselbe Waechter in der Einzel-Gate-API. Befund deepseek-v4-pro R-4: der
# `run`-Zweig hatte gar keinen.
bash "$G" run p-schreibt > "$tmp/run-schreibt.log" 2>&1
got=$?
[ "$got" -ne 0 ] && ok "auch 'run' meldet ein schreibendes Gate (Exit $got)" ||
  { bad "'run' laesst Seiteneffekte auf getrackte Dateien durch"; sed 's/^/    /' "$tmp/run-schreibt.log"; }
( cd "$tmp/repo" && git checkout -q -- getrackt.txt )

# Gegenprobe: uncommittete eigene Arbeit ist normal und darf den Lauf NICHT
# rot faerben. Verglichen werden Mengen vor und nach dem Lauf, nicht
# "Baum sauber" — sonst waere der Waechter lokal unbrauchbar und wuerde
# weggeschaltet.
( cd "$tmp/repo" && echo "eigene Arbeit" > getrackt.txt )
bash "$G" lane probe-dreckig > "$tmp/dreckig.log" 2>&1
got=$?
[ "$got" -eq 0 ] && ok "vorhandene eigene Aenderungen faerben den Lauf nicht rot" ||
  { bad "der Waechter schlaegt bei uncommitteter eigener Arbeit an (Exit $got)"; sed 's/^/    /' "$tmp/dreckig.log"; }
( cd "$tmp/repo" && git checkout -q -- getrackt.txt )

# Auch das Verschwinden einer Statuszeile ist eine Aenderung: ein Gate darf
# vorhandene Benutzerarbeit nicht unbemerkt auf HEAD zuruecksetzen.
( cd "$tmp/repo" && echo "eigene Arbeit darf nicht verschwinden" > getrackt.txt )
bash "$G" lane probe-verwirft > "$tmp/verwirft.log" 2>&1
got=$?
[ "$got" -ne 0 ] && ok "das Verwerfen bestehender Arbeit faerbt den Lauf rot" ||
  { bad "dirty -> clean blieb unbemerkt"; sed 's/^/    /' "$tmp/verwirft.log"; }
grep -q "getrackt.txt" "$tmp/verwirft.log" &&
  ok "der Waechter nennt auch die zurueckgesetzte Datei" || bad "zurueckgesetzte Datei fehlt"

echo
[ "$fails" -eq 0 ] && echo "alle Faelle grün" || echo "$fails Fall/Faelle rot"
[ "$fails" -eq 0 ]
