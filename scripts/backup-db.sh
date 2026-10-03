#!/usr/bin/env bash
# backup-db.sh — Sicherung der ProjectA-SQLite-DB mit Zeitstempel + Rotation.
#
# Quelle:    %APPDATA%/com.projecta.app/projecta.db
# Ziel:      %APPDATA%/com.projecta.app/backups/projecta-<yyyymmdd-hhmmss>.db
# Rotation:  nur die letzten 10 Sicherungen bleiben liegen.
#
# WAL-Hinweis: die DB läuft im WAL-Modus (projecta.db-wal, oft größer als die
# DB selbst — die zuletzt committeten Daten stecken dort). Zwei Wege:
#   1. sqlite3-CLI vorhanden → ".backup" (Online-Backup, auch bei laufender
#      App konsistent)
#   2. sonst Dateikopie von projecta.db + -wal + -shm als Satz. Dafür ist die
#      App idealerweise GESCHLOSSEN — sonst kann die Kopie einen Schreibvorgang
#      mittendrin erwischen. Läuft die App (projecta-api.json vorhanden),
#      wird gewarnt.
#
# Aufruf: bash scripts/backup-db.sh   (Git Bash auf Windows)
set -euo pipefail

appdir="$(cygpath -u "${APPDATA:?APPDATA ist nicht gesetzt}" 2>/dev/null || printf '%s' "$APPDATA")/com.projecta.app"
db="$appdir/projecta.db"
api_json="$appdir/projecta-api.json"
backup_dir="$appdir/backups"
keep=10

[ -f "$db" ] || { echo "FEHLER: $db nicht gefunden" >&2; exit 1; }

if [ -f "$api_json" ]; then
  echo "WARNUNG: $api_json existiert — die ProjectA-App läuft vermutlich." >&2
  echo "WARNUNG: Ohne sqlite3-CLI ist die Dateikopie bei laufender App nicht schreibfest." >&2
  echo "WARNUNG: Idealerweise App schließen und das Backup erneut ausführen." >&2
fi

mkdir -p "$backup_dir"
ts="$(date +%Y%m%d-%H%M%S)"
target="$backup_dir/projecta-$ts.db"

if command -v sqlite3 >/dev/null 2>&1; then
  # Weg 1: Online-Backup über die SQLite-CLI — auch bei laufender App konsistent.
  sqlite3 "$db" ".backup '$target'"
  echo "Backup (sqlite3 .backup): $target"
else
  # Weg 2: Dateikopie. App idealerweise geschlossen! Die WAL-Seitendateien
  # gehören zwingend zur Sicherung — ohne sie fehlen die zuletzt committeten
  # Daten, die noch nicht in die Hauptdatei zurückgeschrieben wurden.
  cp -p "$db" "$target"
  for side in wal shm; do
    [ -f "$db-$side" ] && cp -p "$db-$side" "$target-$side"
  done
  echo "Backup (Dateikopie inkl. WAL-Satz): $target"
fi

# Rotation: nur die letzten $keep Basis-Backups behalten, Seitendateien wandern mit.
ls -1 "$backup_dir"/projecta-*.db 2>/dev/null | sort | head -n -"$keep" | while read -r old; do
  rm -f "$old" "$old-wal" "$old-shm"
  echo "Rotiert (gelöscht): $old"
done

echo "OK: $(du -h "$target" | cut -f1) — $target"
