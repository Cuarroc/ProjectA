# Review-Disposition PR #11 (W5-28), Stufe B: grok

Kandidat: Branch `claude/w5-28`, geprüft `cae91c0`, nach Umsetzung `71ea7f9`.
Autor: kimi-k3 (Worker). Reviewer: grok (xAI) über `grok.exe --prompt-file`
(v1.0.41, read-only/plan mode) — andere Modellfamilie als der Autor, Stufe B
(ein Reviewer). Ollama und OpenCode waren für diesen Auftrag gesperrt
(Wochenlimit); das bisherige Review-Paar (glm-5.2 R1/R2, qwen2.5-coder)
steht in `.pa/review_w5-28_disposition.md`.

## Review

- `.pa/review_pr11_grok.md` (Kandidat `cae91c0`, voller Diff
  `origin/main...HEAD`, Prompt: `.pa/review_prompt_pr11.md`): bestätigt die
  Fixes F1–F4 und R2-1 als tragfähig, meldet genau einen neuen Befund (G1,
  mittel). Groks Zeilenangaben zu `src/App.tsx` (170/457/461) weichen vom
  aktuellen Stand ab (dort 83/119/145); der Mechanismus ist derselbe und
  wurde am Code verifiziert.

## Verifikation von G1 vor der Disposition

- `src-tauri/src/main.rs` (`resolve_app_data_dir`): `PROJECTA_APP_DATA`
  lenkt nur Datenbank, Log und API-Deskriptor um — bestätigt.
- `src-tauri/tauri.conf.json`: kein `dataDirectory`; wry 0.55.1
  (`webview2/mod.rs`, `create_environment`) übergibt dann einen leeren
  user-data-folder, das Profil hängt allein an der Bundle-ID — bestätigt.
  Auf dieser Maschine: `%LOCALAPPDATA%\com.projecta.app\EBWebView`
  (Produktiv) vs. `com.projecta.proof` (Proof-Build).
- `scripts/runtime-proof.mjs` (`startApp`, vor dem Fix Zeile ~117): nur
  `PROJECTA_APP_DATA` + `PROJECTA_QUEUE` — bestätigt.
- `src/App.tsx` (83/119/145): `projecta.activeProjectId` wird aus
  localStorage gelesen und bei Projektwechsel/nicht gefundenem Eintrag
  überschrieben — bestätigt. Ein Proof mit Default-Identifier-Binary bei
  geschlossener Produktiv-App (genau dann lässt die Mutex-Schutzschiene
  den Start zu) hätte das Produktiv-Profil beschrieben und per
  `taskkill /F` unsauber beendet.

## Dispositionen

| ID | Quelle | Schwere | Befund | Disposition |
|---|---|---|---|---|
| G1 | grok | mittel | Proof mit Default-Identifier-Binary schreibt das Produktiv-WebView2-Profil (localStorage-Verlust des zuletzt gewählten Projekts, unsauberer Kill) | angenommen: `proofEnv()` setzt `WEBVIEW2_USER_DATA_FOLDER` ins Run-Verzeichnis (WebView2 honoriert die Variable genau dann, wenn kein Ordner übergeben wird — dieser Fall liegt vor). Rot `1507870` (Exit 1, Export fehlte) → Fix `71ea7f9` (`node --test scripts/lib/runtime-proof-lib.test.mjs`, Exit 0, 10/10) |

## Laufzeit-Beleg nach dem Fix

Proof-Re-Lauf 2026-09-25T18-06-42Z mit dem dokumentierten
`com.projecta.proof`-Release-Build (custom-protocol), Produktiv-App lief
unangetastet daneben (`--parallel-ok`): Exit 0, Verdikt PASS (2 Einträge
`ready`, `workers: []`, Disabled-Logzeile). Beleg der neuen Schutzschicht:
`webview-profile\EBWebView` liegt im Run-Verzeichnis, die mtimes von
`%LOCALAPPDATA%\com.projecta.proof\EBWebView` (16:22, vor dem Lauf um
20:06) und `com.projecta.app\EBWebView` blieben unberührt; Screenshot
inspiziert (echte App-UI, „0 workers").

Nach `71ea7f9` liegt kein offener Befund aus diesem Review vor.
