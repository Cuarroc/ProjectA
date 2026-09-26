# F2-Nav: sechs Hauptziele, kein App.tsx-Big-Bang

Status: historisch

Repo: `<repo-root>`. **Nicht committen, nicht pushen, nicht
mergen.**

Plan: `docs/SANIERUNGSPLAN.md` Rev 9, F2. Entwurf: `docs/ia/index.html`.
Der Nutzer hat am 04.09. „Mach weiter im Plan" gesagt — das hebt die
IA-Warte in `STAND.md` für dieses Paket auf.

## Nahtstellen-Lane

**Frontend.** Nicht anfassen: `api.rs`, `main.rs`, `store.rs`, `bin/pa.rs`.
Queen-Sperre in API/CLI und `set_landing_page`-Ablehnung im Kern sind ein
eigenes Naht-Paket.

## Warum

Neun Hauptansichten (Dialog, Board, Fragen, Workers, Design, Usage,
Statistik, Aktivität, Diagnose, Settings) sind zu viele Wahrheiten. Rev 9
verdichtet auf Work, Attention, Agents, Review, Insights, Settings.

## Auftrag

1. ViewBar zeigt genau diese sechs Ziele. Kein Nav-Eintrag Design, Diagnose,
   Usage, Statistik, Aktivität, Dialog, Board, Fragen, Workers.
2. Work: Orchestrator-Dialog als Default; volles Board bleibt erreichbar
   (Rail/Statusbar), ist aber kein eigenes Hauptziel. Queue bleibt Backlog
   in der Sidebar, keine eigene Produktwelt.
3. Attention: bestehende Inbox. Deep Link Work/Agents/Review hält Projekt
   und Task.
4. Agents: Terminals. Review: Diff derselben Task (`detailView`).
5. Insights: Usage, Statistik und Activity auf einer Fläche; Scope bleibt
   sichtbar in den bestehenden Views.
6. Settings: App-Einstellungen plus Diagnose plus Landing-Page **read-only**.
   Der Design-Studio-Editor und Speichern verschwinden. Export kopiert
   Markdown, nicht die HTML-Projektion (F0-6). `setLandingPage` wird aus
   der UI nicht aufgerufen.
7. Panic-Notice öffnet Settings (Diagnose), nicht ein siebtes Hauptziel.
8. F7 auf der ViewBar: zugängliche Namen, Wrap bei 1280 px.

## Nicht in diesem Paket

- Queen-Neuanlage über API/CLI (Naht).
- `set_landing_page` im Rust-Kern ablehnen.
- F0-5 (`webPort` / `defaultProfileId` verdrahten) — Settings-Verhalten,
  nicht Navigation.
- Sechs-Ziele-Gut der Sidebar-IA; Board-Rail bleibt.

## Abnahme

- ViewBar: sechs Tabs, keine der gestrichenen Labels.
- Attention → Task → Terminal/Review erhält die Auswahl.
- Landing: kein Speichern, kein Editor, `setLandingPage` ungerufen.
- Diagnose erreichbar unter Settings.
- `npm run specs` grün.

## Report

`.pa/report_f2_nav.md`.
