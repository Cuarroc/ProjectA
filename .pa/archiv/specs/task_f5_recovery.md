# F5-Recovery: Policy vor Persistenz

Status: historisch

Repo: `<repo-root>`. **Nicht committen.**

Plan: `docs/SANIERUNGSPLAN.md` Rev 9, F5.

## Nahtstellen-Lane

Policy-Entscheidung **bevor** Scrollback/Drafts geschrieben werden. Kein
Schema in `store.rs`, solange Retention/Verschlüsselung nicht in
`docs/decisions.md` stehen.

## Auftrag (diese Spec zuerst nur entscheiden, dann bauen)

Vor jedem Persist-Schritt festlegen:

1. Retention (Dauer, Größe, was nach Archive/Merge weg ist)
2. Verschlüsselung (DPAPI wie Vault, oder Klartext nur Draft?)
3. Export und Löschung (DSAR-Pfad)
4. Session-Restore: expliziter Respawn, keine vorgetäuschte Live-Session

Dann Recovery-Matrix aus dem Plan (App-Absturz, Agententod, Worktree fehlt,
Merge unterbrochen, Provider weg, Flottenstopp) mit je einem ehrlichen
Zustand nach Neustart.

## Report

`.pa/report_f5_policy.md` zuerst; Persistenz erst danach.
