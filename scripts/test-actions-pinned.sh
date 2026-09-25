#!/usr/bin/env bash
# Selbsttest fuer scripts/ci/actions-pinned.sh. Die beiden wichtigen Faelle
# sind die letzten: eine Kommentarzeile, die selbst `uses:` enthaelt (der
# Detektor darf seine eigene Erklaerung nicht finden), und ein SHA mit 39
# statt 40 Zeichen (ein Praefix ist kein Pin).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0
SHA40="3d3c42e5aac5ba805825da76410c181273ba90b1"

check() { # name erwarteter_exit inhalt
  local name="$1" want="$2" body="$3"
  local d="$tmp/$name"
  mkdir -p "$d"
  printf '%s\n' "$body" > "$d/w.yml"
  bash scripts/ci/actions-pinned.sh "$d" > "$tmp/$name.log" 2>&1
  local got=$?
  if [ "$got" -ne "$want" ]; then
    echo "FEHLER $name: Exit $got, erwartet $want"; sed 's/^/    /' "$tmp/$name.log"; fails=$((fails + 1))
  else
    echo "ok   $name (Exit $got)"
  fi
}

check "gepinnt"          0 "      - uses: actions/checkout@$SHA40 # v7.0.1"
check "gepinnt-ohne-kommentar" 0 "      - uses: actions/checkout@$SHA40"
check "tag"              1 "      - uses: actions/checkout@v7"
check "branch"           1 "      - uses: dtolnay/rust-toolchain@stable"
check "wandernder-tag"   1 "      - uses: taiki-e/install-action@nextest"
check "repo-lokal"       0 "      - uses: ./.github/actions/setup-linux"
check "uses-als-wert"    0 "      - name: erklaert uses: irgendwas@v1
        run: echo hallo"
# Der Detektor darf seine eigene Erklaerung nicht finden.
check "kommentarzeile"   0 "      # gepinnt statt uses: actions/checkout@v7
      - uses: actions/checkout@$SHA40 # v7.0.1"
# 39 Zeichen: ein abgeschnittener SHA ist kein Pin.
check "sha-zu-kurz"      1 "      - uses: actions/checkout@${SHA40:0:39}"

# Eine Composite Action liegt NICHT unter workflows/ und wurde von der
# ersten Fassung dieses Gates gar nicht gesehen — der blinde Fleck, den der
# Umbau auf .github/actions/setup-linux geschaffen haette.
mkdir -p "$tmp/verschachtelt/workflows" "$tmp/verschachtelt/actions/setup"
printf '      - uses: actions/checkout@%s # v7.0.1\n' "$SHA40" > "$tmp/verschachtelt/workflows/w.yml"
printf '      - uses: actions/setup-node@v7\n' > "$tmp/verschachtelt/actions/setup/action.yml"
bash scripts/ci/actions-pinned.sh "$tmp/verschachtelt" > "$tmp/verschachtelt.log" 2>&1
got=$?
if [ "$got" -ne 1 ]; then
  echo "FEHLER composite-action: Exit $got, erwartet 1"; sed 's/^/    /' "$tmp/verschachtelt.log"; fails=$((fails + 1))
else
  echo "ok   composite-action wird mitgeprueft (Exit $got)"
fi

mkdir -p "$tmp/leer"
bash scripts/ci/actions-pinned.sh "$tmp/leer" > "$tmp/leer.log" 2>&1
got=$?
if [ "$got" -ne 2 ]; then
  echo "FEHLER leeres-verzeichnis: Exit $got, erwartet 2"; fails=$((fails + 1))
else
  echo "ok   leeres-verzeichnis (Exit $got)"
fi

[ "$fails" -eq 0 ] && echo "alle Faelle grün" || echo "$fails Fall/Faelle rot"
[ "$fails" -eq 0 ]
