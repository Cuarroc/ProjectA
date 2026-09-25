# F0-7: Restore-Pfad für pre-migration.bak

Status: historisch

Repo: `<repo-root>`.

Plan: `docs/SANIERUNGSPLAN.md` Rev 9, F0-Abnahme / Recovery.

## Warum

`Store::open` auf einer `.pre-migration-*.bak` im selben Verzeichnis migriert
die Datei und schreibt weitere Baks. `restore-probe.sh` sah nur
`backups/projecta-*.db`. Es gab keinen CLI-Rückweg.

## Auftrag

1. Filesystem-Restore, nie `Store::open` auf dem Bak.
2. `pa db restore` offline vor `Api::load`, `--yes` Pflicht, verweigert bei
   lebendem Deskriptor.
3. Probe kopiert Bak ins Temp und prüft Integrity.

## Report

`.pa/report_f0_7.md`
