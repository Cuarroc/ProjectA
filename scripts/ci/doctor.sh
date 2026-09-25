#!/usr/bin/env bash
# doctor.sh — was kann DIESE Maschine belegen, und was nicht?
#
# Die Frage ist nicht rhetorisch. Seit der Linux-Server am 09.09. geloescht
# wurde (STAND.md §5), gibt es fuer die #[cfg(unix)]-Rot-Laeufe lokal keinen
# Ort mehr ausser WSL2. CI laeuft (die Behauptung, das Actions-Kontingent sei
# erschoepft, stand seit dem 08.09. ungeprueft in STAND.md und war falsch), aber
# sie laeuft erst NACH dem Push und kostet Minuten. Wer nicht weiss, welche
# Haelfte seine Maschine abdeckt, haelt einen halben Beleg fuer einen ganzen.
#
# Das Skript aendert nichts. Es sagt, was da ist, was fehlt, und mit welchem
# Befehl man die Luecke schliesst.
#
# Aufruf: bash scripts/ci/doctor.sh
set -uo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

luecken=0
warnungen=0

os_kind() {
  case "$(uname -s 2>/dev/null || echo unbekannt)" in
    Linux) echo linux ;;
    Darwin) echo macos ;;
    MINGW* | MSYS* | CYGWIN*) echo windows ;;
    *) echo unbekannt ;;
  esac
}

OS="$(os_kind)"
IN_WSL=0
if [ "$OS" = linux ] && grep -qi microsoft /proc/version 2>/dev/null; then
  IN_WSL=1
fi

zeile() { printf ' %-12s %-14s %s\n' "$1" "$2" "${3:-}"; }

# pflicht <name> <befehl> <version-args...> — fehlt es, ist eine Bahn nicht
# lauffaehig. hinweis() liefert danach den Installationsbefehl.
pruefe() { # art name befehl [version-args...]
  local art="$1" name="$2" cmd="$3"
  shift 3
  local out
  if ! command -v "$cmd" > /dev/null 2>&1; then
    zeile "$name" "FEHLT" ""
    [ "$art" = pflicht ] && luecken=$((luecken + 1)) || warnungen=$((warnungen + 1))
    return 1
  fi
  if [ $# -gt 0 ]; then
    out="$("$cmd" "$@" 2>&1)" || {
      zeile "$name" "FEHLT" "(Unterkommando nicht vorhanden)"
      [ "$art" = pflicht ] && luecken=$((luecken + 1)) || warnungen=$((warnungen + 1))
      return 1
    }
    zeile "$name" "da" "$(printf '%s' "$out" | head -1)"
  else
    zeile "$name" "da" "$(command -v "$cmd")"
  fi
  return 0
}

echo "=============================================================="
echo " doctor.sh — was diese Maschine belegen kann"
echo "=============================================================="
echo
echo "Plattform: $(uname -s -r 2>/dev/null || echo unbekannt) -> $OS$([ "$IN_WSL" -eq 1 ] && echo ' (WSL)')"
echo

echo "--- Werkzeuge fuer die Gates ---"
pruefe pflicht "git" git --version
node_ok=0
if pruefe pflicht "node" node --version; then node_ok=1; fi
pruefe pflicht "npm" npm --version
pruefe pflicht "cargo" cargo --version
pruefe pflicht "rustc" rustc --version
nextest_ok=0
if pruefe pflicht "nextest" cargo nextest --version; then nextest_ok=1; fi
gitleaks_ok=0
if pruefe pflicht "gitleaks" gitleaks version; then gitleaks_ok=1; fi
audit_ok=0
if pruefe kann "cargo-audit" cargo audit --version; then audit_ok=1; fi

# package.json verlangt Node 24. Eine aeltere Major-Version laeuft oft, misst
# aber nicht dasselbe wie der Runner — das gehoert gesagt, nicht verschwiegen.
if [ "$node_ok" -eq 1 ]; then
  major="$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
  soll="$(sed -n 's/.*"node": ">=\([0-9]*\)".*/\1/p' package.json | head -1)"
  if [ -n "$major" ] && [ -n "$soll" ] && [ "$major" -lt "$soll" ]; then
    echo
    echo " ACHTUNG: node $major, package.json verlangt >=$soll. Die Gates laufen"
    echo "          vermutlich, messen aber nicht dasselbe wie der Runner."
    warnungen=$((warnungen + 1))
  fi
fi

echo
echo "--- Zustand des Clones ---"
if [ -d node_modules ]; then
  zeile "node_modules" "da" ""
else
  zeile "node_modules" "FEHLT" "npm ci"
  luecken=$((luecken + 1))
fi

hooks="$(git config --get core.hooksPath 2>/dev/null || true)"
if [ "$hooks" = ".githooks" ]; then
  zeile "Git-Hooks" "aktiv" "core.hooksPath=$hooks"
else
  zeile "Git-Hooks" "INAKTIV" "bash scripts/install-hooks.sh"
  luecken=$((luecken + 1))
fi

# Der Browser-Smoke faellt sonst erst nach allen billigen Gates auf.
if [ -d "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" ] ||
  [ -d "$HOME/AppData/Local/ms-playwright" ]; then
  zeile "Chromium" "da" ""
else
  zeile "Chromium" "fehlt?" "npx playwright install chromium$([ "$OS" = linux ] && echo ' --with-deps')"
  warnungen=$((warnungen + 1))
fi

echo
echo "--- Welche Bahn laeuft hier? ---"
for lane in precommit prepush linux windows release audit; do
  ids="$(bash scripts/ci/gates.sh --list "$lane" 2>/dev/null)"
  n="$(printf '%s\n' "$ids" | grep -c . || true)"
  urteil="lauffaehig"
  case "$lane" in
    windows) [ "$OS" = windows ] || urteil="laeuft, belegt aber nur was auf $OS gilt" ;;
    # macOS ist unix: die cfg(unix)-Arme kompilieren und laufen dort. Was
    # fehlt, ist die Zielplattform. Befund des externen Dual-Reviews vom
    # 21.09. (deepseek-v4-pro R-5) — die alte Zeile sagte fuer macOS das
    # Gegenteil dessen, was gilt.
    linux | release)
      case "$OS" in
        linux) ;;
        macos) urteil="laeuft inkl. der cfg(unix)-Tests, ist aber nicht die Zielplattform" ;;
        *) urteil="laeuft, aber ohne die cfg(unix)-Tests" ;;
      esac
      ;;
  esac
  # Ein fehlendes Werkzeug macht die Bahn nicht "lauffaehig" - sie waere
  # sofort rot. Das gehoert hier gesagt, nicht erst nach 20 Minuten.
  ids_csv=",$(printf '%s' "$ids" | tr '\n' ','),"
  case "$ids_csv" in *,rust-suite,*) [ "$nextest_ok" -eq 1 ] || urteil="BLOCKIERT (nextest fehlt: cargo install cargo-nextest --locked)" ;; esac
  case "$ids_csv" in *,audit-rust,*) [ "$audit_ok" -eq 1 ] || urteil="BLOCKIERT (cargo-audit fehlt: cargo install cargo-audit)" ;; esac
  case "$ids_csv" in *,secrets,* | *,selftest-secrets,*) [ "$gitleaks_ok" -eq 1 ] || urteil="BLOCKIERT (gitleaks fehlt: winget install Gitleaks.Gitleaks)" ;; esac
  printf ' %-10s %2d Gates  %s\n' "$lane" "$n" "$urteil"
done

echo
echo "--- Die andere Plattformhaelfte ---"
case "$OS" in
  windows)
    echo " Diese Maschine ist die Zielplattform. Es fehlen die"
    echo " #[cfg(unix)]-Tests (Dateirechte, Prozessgruppen-Kill) und die"
    echo " Linux-Arme von clippy — sie kompilieren unter Windows nicht."
    if command -v wsl.exe > /dev/null 2>&1; then
      zeile "WSL" "da" "Clone auf ext4 anlegen, dort: bash scripts/ci/gates.sh lane linux"
    else
      zeile "WSL" "FEHLT" "wsl --install    (danach Clone auf ext4, NICHT unter /mnt/c)"
      warnungen=$((warnungen + 1))
    fi
    ;;
  linux)
    if [ "$IN_WSL" -eq 1 ]; then
      echo " WSL: das ist der Linux-Belegpfad seit der Server-Loeschung (STAND.md §5)."
      case "$ROOT" in
        /mnt/*)
          echo
          echo " ACHTUNG: der Clone liegt unter $ROOT, also auf dem Windows-Dateisystem."
          echo "          cargo ist dort um Faktoren langsamer und das x-Bit geht"
          echo "          verloren — genau die Hook-Falle vom 31.08.-07.09."
          echo "          Clone nach ~/ (ext4) legen."
          warnungen=$((warnungen + 1))
          ;;
      esac
    else
      echo " Diese Maschine ist Linux. Es fehlen die #[cfg(windows)]-Tests"
      echo " (run_in_pty, npm_shim, ConPTY, DPAPI) und die Windows-Arme von"
      echo " clippy. Die deckt nur der Windows-PC ab: dort in Git-Bash"
      echo "   bash scripts/ci/gates.sh lane windows"
    fi
    ;;
  *)
    echo " '$OS' ist weder Zielplattform noch Linux-Belegpfad — ein Lauf hier"
    echo " belegt fuer das Produkt wenig."
    ;;
esac

echo
echo "--- act (Workflow-Emulation, optional) ---"
# act ist KEIN Belegpfad, und das ist eine bewusste Entscheidung, kein
# Versaeumnis: es kann keine windows-latest-Jobs, ignoriert `environment:`
# (die Secret-Haertung von review.yml waere lokal ausgehebelt) und hat kein
# GitHub-OIDC. Es beweist Workflow-SYNTAX, nicht Gate-Aequivalenz.
if command -v act > /dev/null 2>&1; then
  zeile "act" "da" "$(act --version 2>&1 | head -1)"
else
  zeile "act" "fehlt" "optional — siehe docs/ci-lokal.md"
fi
if command -v docker > /dev/null 2>&1 && docker info > /dev/null 2>&1; then
  zeile "docker" "laeuft" ""
elif command -v docker > /dev/null 2>&1; then
  zeile "docker" "da, aus" "Daemon starten (act braucht ihn)"
else
  zeile "docker" "fehlt" "optional — act braucht ihn"
fi
echo " act ist die Kuer, nicht die Pflicht. Was es NICHT kann und warum:"
echo " docs/ci-lokal.md"

echo
echo "=============================================================="
if [ "$luecken" -gt 0 ]; then
  echo " $luecken Luecke(n), $warnungen Hinweis(e) — oben steht je der Befehl."
  exit 1
fi
echo " Keine Luecke, $warnungen Hinweis(e). Naechster Schritt:"
case "$OS" in
  windows) echo "   bash scripts/ci/gates.sh lane prepush" ;;
  *) echo "   bash scripts/ci/gates.sh lane linux" ;;
esac
