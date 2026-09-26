# Task-Spec: T-3 Frontend-Schwellen + IPC-Mock-Smoke

Status: historisch

Reaktiviert: 2026-09-06 · Branch: `cursor/t1-t3-clean-fea3`
Ursprung: SANIERUNGSPLAN Rev 9.1 S1 T-3; Nutzerentscheid nach Schließen von
PR #19, frisch auf Rev-9-`main`.

## Akzeptanz

- Vitest misst alle Produktionsdateien unter `src/` und erzwingt den Istwert.
- Schwellen sind dokumentierte Ratschen und dürfen nicht sinken.
- Der bestehende Boot-Smoke wird bei einem unbekannten IPC-Command rot.
- Playwright öffnet die App mit `@tauri-apps/api/mocks`, sieht App und Board
  und meldet weder unbekannte Boot-Commands noch Page-Errors.
- `npm test`, `npm run test:e2e`, typecheck, build und lint sind grün.
