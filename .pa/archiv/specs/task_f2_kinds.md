# F2-Kinds: Queen-Sperre und F0-5 verdrahten

Status: historisch

Repo: `<repo-root>`.

Plan: Rev 9 F2 Agentenarten + F0-5. Bestehende Queens bleiben lesbar.

## Nahtstellen-Lane

Seriell: zuerst `api.rs` (`POST /api/queens` → 410), dann `bin/pa.rs`
(`pa queen spawn` lehnt ab ohne POST), dann `main.rs` `create_queen`.
`workers::create_queen` bleibt für Tests und historische Zeilen; der
öffentliche Weg geht nicht mehr darüber.

Frontend parallel (keine Naht): `webPort`, `defaultProfileId`, `active`.

## Auftrag

1. `POST /api/queens` antwortet **410 Gone** mit expliziter Begründung,
   ohne den Backend-Spawn. `Response::reason` kennt 410.
2. `pa queen spawn` lehnt mit derselben Begründung ab; Parse bleibt für
   die Usage-Fehler (`--project` fehlt).
3. `ApiBackend::create_queen` gibt `Err` zurück, auch wenn jemand den
   Trait direkt ruft.
4. Settings `projecta.settings.webPort` ist der Startport des
   Web-Interface-Panels.
5. Worker-Kategorie `defaultProfileId` / `active` gelten im
   New-Worker-Dialog. Scout-`active` gilt für „Scout starten“ / Triage.
   Employee verschwindet aus der Settings-Liste. Queen-Zeile ist
   historisch (kein Aktiv-Schalter, der Neuanlage verspräche).

## Abnahme

- API-Test: POST `/api/queens` → 410, `queened` bleibt leer.
- `pa`-Test: QueenSpawn-Lauf gibt retired-Fehler, kein HTTP.
- Vitest: WebInterfacePanel liest `webPort`; Dialog nimmt Default-Profil;
  inaktive Worker-Kategorie verhindert Spawn-Default.

## Report

`.pa/report_f2_kinds.md`.
