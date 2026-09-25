# Code-Review: Branch fix/f-sec-7-8 (F-SEC-7 + F-SEC-8 + F-SEC-1)

## Kontext

Du reviewst den Branch `fix/f-sec-7-8` im Repo <repo-root> —
ein Sicherheitspaket, drei Befunde aus dem Audit 03.09. Die Arbeitskopie liegt
im Worktree `.worktrees/f-sec-7-8/` (lies die geänderten Dateien dort). Du bist
einer von zwei unabhängigen Reviewern (Dual-Review-Regel: Sicherheit + >300
Zeilen); du hattest keinen Anteil (M2).

Commits auf dem Branch (über main hinaus): F-SEC-7 (learnings.rs), F-SEC-8
(hooks.rs settings_dir), F-SEC-1 (hooks.rs read_request Gesamt-Deadline).

## Pflichtlektüre

1. Die Befunde: `docs/audits/2026-09-03-analyse-claude-web/befunde/http-security.md`
   (F-SEC-7 ab Z. 133, F-SEC-8 ab Z. 149, F-SEC-1 ab Z. 5)
2. Die Analyse: `.pa/report_f_sec1_analyse.md`
3. Die geänderten Dateien im Worktree: `.worktrees/f-sec-7-8/src-tauri/src/learnings.rs`,
   `…/hooks.rs` — jeweils die neuen/geänderten Stellen (git diff main...fix/f-sec-7-8
   zur Orientierung, falls dir Bash zur Verfügung steht)
4. Die Commit-Botschaften auf dem Branch (Rot/Grün-Belege) und die Tests.

## Prüfen

1. **Korrektheit der Fixes gegen die Befunde** — deckt der Code die Failure-
   Szenarien (Symlink-Überschreibung, fremdes Hooks-Verzeichnis mit TOCTOU,
   Drip-Slot ~111 h)?
2. **Test-Qualität:** sind die neuen Tests scharf (Positivkontrolle, kein
   vakuum-grün)? Hinweis: zwei Tests sind `#[cfg(unix)]` und liefen nie
   (Linux-Server gelöscht, CI-Kontingent erschöpft) — bewerte, ob die
   Ersatzbelege (Hardlink-Geschwistertest, Cross-Compile-Check) tragen.
3. **Nebenwirkungen:** Verhaltensänderung F-SEC-8 (Pfad-Umzug temp→app-data,
   keine Migration) — tragbar? Die 30-s-Deadline — kann ein legitimer Client
   (großer Hook-Post, langsames LAN) sie treffen?
4. **Regressionen:** bestehende hooks-/learnings-Tests unverändert grün?
   Signatur von `read_request` unverändert (Aufrufer in api.rs unberührt)?

## Ausgabeformat

URTEIL: <annehmen | annehmen mit Auflagen | überarbeiten | ablehnen>
BEGRÜNDUNG: <3–6 Sätze>
BEFUNDE: ### S-NN — Titel / Schwere / Behauptung / Beleg (Datei:Zeile) / Vorschlag
## Was trägt (max. 5)

Deutsch. Nur lesen, nichts verändern.
