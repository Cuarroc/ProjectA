# Task: Commit-Übergabe an Instanz session_c3e40803-8c14-4195-a928-0f400e8aa172

Status: historisch

**Von:** Kimi-Session (vixen-blade/terra-rogue) · **Datum:** 2026-08-27
**Zweck:** Diese Dateien aus der Kimi-Session sollen committed werden, damit sie nicht
zwischen den parallelen Ständen verloren gehen. Bitte beim nächsten Commit-Lauf
mitnehmen — als eigener `chore:`-Commit, nicht in Feature-Commits mischen.

## Von Kimi stammend, zu committen

- `src-tauri/src/omniroute.rs` — **`/healthz`-Probe-Fix** (Produktiv-OmniRoute:
  `/health`→404, `/`→307; ohne Fix zeigt die App den Router offline).
  Verifiziert: `cargo test omniroute` 11/11 grün.
- `src-tauri/resources/skills/karpathy-guidelines/` — Skill-Pack 7 (Neu).
- `STATUS.md` — Einträge „OmniRoute Produktivbetrieb" + „Skill-Pack 7" (oberste zwei).
- `HANDOVER.md` — Betriebsnotiz OmniRoute (Daemon, Autostart-Task, Probe-Pfad).
- `docs/superpowers/plans/2026-08-27-omniroute-optimale-nutzung.md` — mein T0-Abschnitt
  (nur dieser Diff; Rest der Datei war schon committed).
- `docs/superpowers/plans/2026-08-27-ux-und-entscheidungs-tab.md` — neuer Plan
  (UI-Varianten + Entscheidungs-Tab + dialogische Prompt-Schärfung).
- `docs/superpowers/plans/2026-08-27-statistik-tab.md` — neuer Plan (Statistik-Tab;
  **nur Plan, Nutzer will ihn nicht sofort umgesetzt**).
- `docs/superpowers/plans/2026-08-27-budget-stuck-digest.md` — genehmigter Plan
  (Budget-Stop + Stuck-Diagnose + Daily Digest), aus der Kimi-Session ins Repo kopiert.
- `README.md` — **gemischt:** unsere Ergänzung ist der neue Abschnitt `## Roadmap`
  (Phasen 16–20 mit Plan-Referenzen) direkt nach der Status-Tabelle; andere README-
  Änderungen im selben Diff stammen nicht von Kimi.

Commit-Vorschlag: `chore: omniroute /healthz probe, karpathy skill pack, roadmap + plans`.

## NICHT committen (Laufzeit-/Junk-Artefakte)

- `fmt.txt`, `fmterr.txt`, `parsecheck.rs` im Repo-Root — Laufzeit-Artefakte;
  nach AGENTS.md gehören sie nicht ins Repo (löschen oder gitignoren).
- `.pa-scout.jsonl` — Scout-Laufzeitdatei.
- `scripts/` ist aktuell **untracked**, obwohl AGENTS.md `scripts/sync.sh` pflicht
  referenziert — gehört eigentlich eingecheckt (eure Entscheidung, ggf. separater Commit).

## Fremde Änderungen (nicht von Kimi — eure eigenen, bitte selbst beurteilen)

`.gitignore`, `AGENTS.md`, `README.md`, `src-tauri/src/{api.rs,main.rs,store.rs,workers.rs}`,
`src/components/SettingsView.tsx`, `src/lib/{ipc.ts,types.ts}` — zum Zeitpunkt dieser
Notiz im Arbeitsbaum geändert, stammen nicht aus der Kimi-Session.

## Hinweise

- OmniRoute läuft seit heute als **Produktiv-Daemon** (npm global 3.8.49, Port <omniroute-port>,
  Windows-Aufgabe „OmniRoute" für Autostart). Details: HANDOVER.md.
- Der OmniRoute-Plan enthält **T0 = genau diese Commit-Übergabe**; wer den Plan
  umsetzt, kann T0 als erledigt abhaken, sobald obige Dateien committed sind.
