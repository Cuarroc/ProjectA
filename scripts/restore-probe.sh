#!/usr/bin/env bash
# restore-probe.sh — Restore-Probe: beweist, dass das neueste DB-Backup restaurierbar ist.
#
# Ein Backup, das nie restauriert wurde, beweist nichts (Phase A.1). Ablauf:
# neuestes Backup aus %APPDATA%/com.projecta.app/backups/ in ein Temp-Verzeichnis
# kopieren (inkl. WAL-Seitendateien), dann mit Python/sqlite3 öffnen und prüfen:
#   - PRAGMA integrity_check == ok (kein "database disk image is malformed")
#   - Tabellenliste nicht leer
#   - counts > 0 bei workers / projects / messages (nur scheduled backups/)
#
# F0-7: prüft zusätzlich projecta.db.pre-migration-*.bak — Kopie ins Temp,
# nie Store::open auf dem Bak selbst (das würde es migrieren). WAL-Sidecars
# des Baks werden nicht mitkopiert. Worker-Zähler sind dort nicht Pflicht
# (älteres Schema).
#
# Exit 0 = Probe grün, Exit 1 = Backup nicht restaurierbar.
#
# Aufruf: bash scripts/restore-probe.sh   (Git Bash auf Windows)
set -euo pipefail

appdir="$(cygpath -u "${APPDATA:?APPDATA ist nicht gesetzt}" 2>/dev/null || printf '%s' "$APPDATA")/com.projecta.app"
backup_dir="$appdir/backups"

latest="$(ls -1 "$backup_dir"/projecta-*.db 2>/dev/null | sort | tail -n 1 || true)"
pre_mig="$(ls -1 "$appdir"/projecta.db.pre-migration-*.bak 2>/dev/null | sort | tail -n 1 || true)"
if [ -z "$latest" ] && [ -z "$pre_mig" ]; then
  echo "FEHLER: weder backups/projecta-*.db noch projecta.db.pre-migration-*.bak — zuerst backup-db.sh oder eine Migration" >&2
  exit 1
fi
if [ -n "$latest" ]; then
  echo "Probe-Backup: $latest"
fi
if [ -n "$pre_mig" ]; then
  echo "Probe-pre-migration: $pre_mig"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

PY=python
command -v python >/dev/null 2>&1 || PY=python3

probe_one() {
  local src="$1"
  local mode="$2"
  local dest="$tmp/probe-$mode.db"
  cp -p "$src" "$dest"
  if [ "$mode" = "scheduled" ]; then
    for side in wal shm; do
      [ -f "$src-$side" ] && cp -p "$src-$side" "$dest-$side"
    done
  fi
  # mktemp liefert einen MSYS-Pfad (/tmp/...), den das native Windows-Python nicht
  # auflösen kann — deshalb Übergabe als Windows-Pfad (C:/...).
  "$PY" - "$(cygpath -m "$dest")" "$mode" <<'EOF'
import sqlite3, sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

db = sys.argv[1]
mode = sys.argv[2]
try:
    con = sqlite3.connect(db)
    con.execute("SELECT 1 FROM sqlite_master LIMIT 1")
except sqlite3.DatabaseError as e:
    print(f"FEHLER: Backup nicht lesbar ({e}) — vermutlich kein intaktes SQLite-Image", file=sys.stderr)
    sys.exit(1)
bad = False

integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
print(f"integrity_check: {integrity}")
if integrity != "ok" or "malformed" in integrity.lower():
    print("FEHLER: database disk image is malformed", file=sys.stderr)
    bad = True

tables = [r[0] for r in con.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
print(f"Tabellen ({len(tables)}): {', '.join(tables)}")
if not tables:
    print("FEHLER: keine Tabellen gefunden", file=sys.stderr)
    bad = True

if mode == "scheduled":
    for t in ("workers", "projects", "messages"):
        n = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"count({t}) = {n}")
        if n <= 0:
            print(f"FEHLER: count({t}) ist 0 — Backup unvollständig?", file=sys.stderr)
            bad = True
else:
    present = set(tables)
    for t in ("workers", "projects", "messages"):
        if t not in present:
            print(f"skip count({t}): Tabelle fehlt im pre-migration-Bak")
            continue
        n = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"count({t}) = {n}")

con.close()
sys.exit(1 if bad else 0)
EOF
}

if [ -n "$latest" ]; then
  probe_one "$latest" scheduled
fi
if [ -n "$pre_mig" ]; then
  probe_one "$pre_mig" premig
fi

echo "OK: Restore-Probe grün — Backup ist restaurierbar."
