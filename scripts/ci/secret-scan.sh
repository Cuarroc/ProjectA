#!/usr/bin/env bash
# secret-scan.sh — das Gate `secrets`: gitleaks ueber die gestagten Aenderungen.
#
# Nutzer-Regel (freigegeben 25.09.2026): Geheimnis-Scan vor jedem Commit.
# Der Scan laeuft in der Bahn `precommit` von scripts/ci/gates.sh, also ueber
# .githooks/pre-commit vor jedem Commit. Er sieht nur den Index — schnell
# (unter einer Sekunde), und genau der Inhalt, den der Commit einfuehren
# wuerde. Die Allowlist fuer die bekannten Test-Kanarienvoegel (Pruefung E) steht in .gitleaks.toml.
#
# Kein stiller Rueckfall: ohne gitleaks endet das Gate laut mit Exit 2 und
# einem Installationshinweis, statt den Commit ungeprueft durchzulassen.
# Selbsttest: scripts/test-secret-scan.sh
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

if ! command -v gitleaks > /dev/null 2>&1; then
  echo "::error::gitleaks fehlt — der Geheimnis-Scan vor jedem Commit ist Pflicht (kein stiller Rueckfall)." >&2
  echo "    Installation (Windows):  winget install Gitleaks.Gitleaks" >&2
  echo "                      oder:  choco install gitleaks" >&2
  echo "    (macOS): brew install gitleaks  ·  (Linux): https://github.com/gitleaks/gitleaks#installing" >&2
  echo "    Gerade erst installiert? Die Shell einmal neu starten, damit der PATH greift." >&2
  exit 2
fi

# --redact: ein Fund landet nicht im Klartext im Log. Der Exit-Code von
# gitleaks (0 = sauber, 1 = Fund) geht unveraendert an gates.sh.
exec gitleaks git --staged --config .gitleaks.toml --redact .
