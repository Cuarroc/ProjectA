# Delta-Review SETUP-A (ProjectA), Kandidat dc1fbe5 (Basis der Runde 1: 7546c8c)

Du bist unabhängiger Reviewer (Autor: Claude). In Runde 1 hast du bzw. ein zweiter
Reviewer Befunde gemeldet; der Diff unten enthält die Fixes und die Disposition
`.pa/review_setup-a_disposition.md` (Tabelle mit angenommen/abgelehnt samt Begründung).

Prüfe:
1. Sind die angenommenen Befunde korrekt und vollständig umgesetzt?
2. Sind die Ablehnungen (K-R1 Version v1.4.1 ist veröffentlicht; K-R11 `kimi provider remove` per --help belegt; G-R1; G-R3) nachvollziehbar?
3. Haben die Fixes neue Fehler eingeführt (Skript, Tests plattformneutral und ohne Netz, Doku-Widersprüche, Berechtigungsvorschlag)?

Regeln wie in Runde 1: keine Secret-Werte in Doku; Prüfskript read-only, Exit != 0 nur bei Pflichtfehlern;
Test ohne Netz/Binaries, Linux-tauglich; AGENTS.md bleibt Quelle; nur Abos.

Ausgabe: Befunde (ID D1.., Schwere, Datei:Zeile, Befund, Vorschlag) oder "keine neuen Befunde"; Urteil freigeben / freigeben mit Auflagen / ablehnen.

## Diff 7546c8c..dc1fbe5 (ohne die Roh-Reviews und den Runde-1-Prompt)

```diff
diff --git a/.agents/skills/projecta-workflow/SKILL.md b/.agents/skills/projecta-workflow/SKILL.md
index c350f37..a6123dd 100644
--- a/.agents/skills/projecta-workflow/SKILL.md
+++ b/.agents/skills/projecta-workflow/SKILL.md
@@ -27,8 +27,9 @@ per provider: `docs/setup/README.md`. Check your machine with
   `node_modules` is missing or stale.
 - Every gate run ends with a `NICHT ABGEDECKT` block; put it in the PR text.
 - Worktrees under `.claude/worktrees/` have no `target/`. Point cargo at a
-  build slot: `export CARGO_TARGET_DIR=%USERPROFILE%/cargo-targets/projecta-<a|b|c>`
-  and `CARGO_BUILD_JOBS=1` or `2`. At most 2–3 builds at once; check free RAM
+  build slot: `export CARGO_TARGET_DIR=$HOME/cargo-targets/projecta-<a|b|c>`
+  (on the dev PC: `%USERPROFILE%/cargo-targets/…`; another root via
+  `PROJECTA_BUILD_SLOTS_ROOT`) and `CARGO_BUILD_JOBS=1` or `2`. At most 2–3 builds at once; check free RAM
   first. **Never set `CARGO_PROFILE_*`** — it invalidates the whole cache.
 - Read exit codes unmasked: `| tail` swallows the status.
 
@@ -84,7 +85,9 @@ who asks the user.
    ready (`gh pr ready <n>`) only when all are in. Every push to an open PR
    costs a full Linux + Windows CI run. Verify a push with `git ls-remote`,
    not with the push exit code.
-3. `main` is merged by the **Mergify** merge queue, not by hand. Labels:
+3. `main` is merged by the **Mergify** merge queue, not by hand (config and
+   labels arrive with package CI-01 — check `docs/setup/mergify.md` for the
+   current state). Labels:
    `do-not-merge` keeps a PR out of the queue; `priority` (coordinator only)
    moves it to the front; `conflict` is set by Mergify — rebase, push, it
    clears. Details: `docs/setup/mergify.md`.
diff --git a/.claude/skills/projecta-workflow/SKILL.md b/.claude/skills/projecta-workflow/SKILL.md
index c350f37..a6123dd 100644
--- a/.claude/skills/projecta-workflow/SKILL.md
+++ b/.claude/skills/projecta-workflow/SKILL.md
@@ -27,8 +27,9 @@ per provider: `docs/setup/README.md`. Check your machine with
   `node_modules` is missing or stale.
 - Every gate run ends with a `NICHT ABGEDECKT` block; put it in the PR text.
 - Worktrees under `.claude/worktrees/` have no `target/`. Point cargo at a
-  build slot: `export CARGO_TARGET_DIR=%USERPROFILE%/cargo-targets/projecta-<a|b|c>`
-  and `CARGO_BUILD_JOBS=1` or `2`. At most 2–3 builds at once; check free RAM
+  build slot: `export CARGO_TARGET_DIR=$HOME/cargo-targets/projecta-<a|b|c>`
+  (on the dev PC: `%USERPROFILE%/cargo-targets/…`; another root via
+  `PROJECTA_BUILD_SLOTS_ROOT`) and `CARGO_BUILD_JOBS=1` or `2`. At most 2–3 builds at once; check free RAM
   first. **Never set `CARGO_PROFILE_*`** — it invalidates the whole cache.
 - Read exit codes unmasked: `| tail` swallows the status.
 
@@ -84,7 +85,9 @@ who asks the user.
    ready (`gh pr ready <n>`) only when all are in. Every push to an open PR
    costs a full Linux + Windows CI run. Verify a push with `git ls-remote`,
    not with the push exit code.
-3. `main` is merged by the **Mergify** merge queue, not by hand. Labels:
+3. `main` is merged by the **Mergify** merge queue, not by hand (config and
+   labels arrive with package CI-01 — check `docs/setup/mergify.md` for the
+   current state). Labels:
    `do-not-merge` keeps a PR out of the queue; `priority` (coordinator only)
    moves it to the front; `conflict` is set by Mergify — rebase, push, it
    clears. Details: `docs/setup/mergify.md`.
diff --git a/.github/workflows/review.yml b/.github/workflows/review.yml
index d505095..c121c5b 100644
--- a/.github/workflows/review.yml
+++ b/.github/workflows/review.yml
@@ -2,7 +2,7 @@
 # Ollama-Cloud-Paar kimi-k3 + glm-5.2 (docs/setup/ollama-reviewers.md).
 # Nutzerentscheidung "nur Abos, kein OpenRouter": dieser Workflow braucht
 # OPENROUTER_KEY und wird nicht mehr gestartet. Nicht loeschen, nicht auf
-# Ollama umbauen (der Runner erreicht Ollama Cloud nicht). Gilt ebenso fuer
+# Ollama umbauen (der Runner hat keine bei Ollama Cloud angemeldete Instanz). Gilt ebenso fuer
 # scripts/review/resolve_models.py.
 #
 # Externe Plan-/Diff-Reviews durch Nicht-Anthropic-Modelle (Regel aus docs/PLAN.md §0; historisch SANIERUNGSPLAN §0.3, §4.4).
diff --git a/.pa/review_setup-a_disposition.md b/.pa/review_setup-a_disposition.md
new file mode 100644
index 0000000..1027b96
--- /dev/null
+++ b/.pa/review_setup-a_disposition.md
@@ -0,0 +1,33 @@
+# SETUP-A Review-Dispositionen
+
+Runde 1 (Kandidat `7546c8c`): `.pa/review_setup-a_kimi-k3.md` (freigeben mit
+Auflagen, 15 Befunde), `.pa/review_setup-a_glm-5.2.md` (freigeben, 6 Befunde,
+alle nit/niedrig). Prompt `.pa/review_prompt_setup-a.md` (85 940 Zeichen,
+voller Diff `origin/main...7546c8c`). Fixes im Commit nach `7546c8c`
+(„fix(setup): Review-Befunde SETUP-A"); Delta-Runde siehe unten.
+
+| ID | Quelle | Schwere | Befund | Disposition |
+|----|--------|---------|--------|-------------|
+| K-R1 | kimi-k3 | mittel | README hebt v1.4.0 → v1.4.1 ohne Versionsbump im Diff. | **Abgelehnt.** v1.4.1 ist veröffentlicht: `package.json` `"version": "1.4.1"`, `CHANGELOG.md` „v1.4.1 — 2026-09-22", `docs/PLAN.md` Baseline. Die README war veraltet (Audit §1.5). |
+| K-R2 | kimi-k3 | mittel | Lücken im Berechtigungsvorschlag: `-f`, `branch -d --force`, nackte Befehle, `Write(...)` auf Settings, Syntax `*` vs `:*`. | **Angenommen.** Deny ergänzt um `git worktree remove -f *`, `git branch -d --force *`, `git branch -df *`, nackte `git reset --hard`/`git push --no-verify`, `Write(.claude/settings*.json)`. Die beiden Allows `git worktree remove`/`git branch -d` in einen optionalen Block verschoben (Default: weglassen). Syntax-Absatz: `Bash(befehl *)` ist die Form der bestehenden `.claude/settings.json`. |
+| K-R3 / G-R2 | kimi-k3, glm-5.2 | niedrig | Build-Slot-Pfad mit Benutzername im Skill hart kodiert; `PROJECTA_BUILD_SLOTS_ROOT` undokumentiert. | **Angenommen.** Skill: `$HOME/cargo-targets/projecta-<a\|b\|c>` + Override-Hinweis; `docs/setup/claude-code.md` dokumentiert `PROJECTA_BUILD_SLOTS_ROOT`. CLAUDE.md behält den PC-Pfad (Claude-lokal, dieser PC). |
+| K-R4 | kimi-k3 | niedrig | OpenCode-Rolle „GLM / DeepSeek" widerspricht der dokumentierten DeepSeek-Lücke. | **Angenommen.** Tabelle und `opencode.md`-Rolle: „GLM; DeepSeek als Worker offen, W2-09b". |
+| K-R5 | kimi-k3 | niedrig | W1-18b-Scope: PRODUCT (Codex/OpenCode) vs setup (nur OpenCode offen). | **Angenommen.** `codex.md` und Setup-Tabelle: `.agents/skills` ist Codex-Konvention, in diesem Repo nicht geprobt (W1-18b). Jetzt deckungsgleich mit PRODUCT. |
+| K-R6 | kimi-k3 | niedrig | Skill/README/PRODUCT stellen Mergify als Ist-Zustand dar, Labels fehlen noch. | **Angenommen.** Skill §6.3, README und PRODUCT verweisen auf CI-01 und `docs/setup/mergify.md` (Ist-Stand). |
+| K-R7 | kimi-k3 | nit | „Runner erreicht Ollama Cloud nicht" ungenau. | **Angenommen.** „keine bei Ollama Cloud angemeldete Instanz" (review.yml, ollama-reviewers.md). |
+| K-R8 | kimi-k3 | nit | „nie Werte" vs Spalte „Wert auf diesem PC". | **Angenommen.** README: nie Werte von Zugangsdaten; Einstellungswerte ohne Geheimnis stehen dabei. |
+| K-R9 | kimi-k3 | nit | Testlücken: Crash-Pfad, fehlende Pflicht-Binary, `claudeMd == null`, `ollama list` mit Zeile vor dem Header, CI-Glob. | **Angenommen.** Neue Tests: `ollama list output with a notice before the header keeps every model` (dazu `parseOllamaList` sucht die `NAME`-Kopfzeile statt `slice(1)`), `a missing mandatory binary fails and a missing CLAUDE.md is named`, `a crashing check fails when mandatory and only warns when optional`. CI-Glob: `test:hq` = `node --test scripts/lib/*.test.mjs` (package.json), Gate `hq-test` in Lanes prepush/linux — lokal grün. |
+| K-R10 | kimi-k3 | nit | Doku sagt „erste Zeile", Check akzeptiert jede eigene Zeile. | **Angenommen (Doku).** claude-code.md: „eine eigene Zeile (hier die erste)"; Fix-Text im Skript „by convention the first line". Check bleibt positionsunabhängig — so wirkt der Import in Claude Code. |
+| K-R11 | kimi-k3 | nit | `kimi provider remove` unbelegt. | **Abgelehnt, belegt.** `kimi provider --help` (Kimi Code CLI 2.0 auf diesem PC): „remove <providerId>  Remove a provider and every model alias that referenced it". kimi.md nennt jetzt zusätzlich `kimi provider list` und die IDs auf diesem PC. |
+| K-R12 | kimi-k3 | nit | CLAUDE.md verspricht Skript-Allow als Lösung, Vorschlag sagt „nicht belegt". | **Angenommen.** CLAUDE.md: Übersteuerung durch Allow-Regeln noch nicht belegt (Hinweis 3). |
+| K-R13 | kimi-k3 | nit | Reviewer-Modell-Fix nennt `ollama pull`, auch wenn Ollama fehlt. | **Angenommen.** Fix-Text hängt von `bin-ollama` ab; Test `reviewer fix names the ollama install when ollama itself is missing`. |
+| K-R14 / G-R4 | kimi-k3, glm-5.2 | nit/niedrig | `shell: true` + Join auf Windows nur per Kommentar abgesichert. | **Angenommen.** Tabellen exportiert; Test `every spawned command and argument is a shell-safe literal` erzwingt `^[A-Za-z0-9._-]+$` für alle Programme/Argumente und alle Aufrufe von `collect()`. |
+| K-R15 | kimi-k3 | nit | Neue Verweise im Diff nicht prüfbar. | **Geprüft.** Auf `origin/main` vorhanden: `docs/ci-lokal.md`, `docs/decisions.md`, `docs/plugin-matrix.md`, `docs/agents-json.md`, `scripts/session-end-hook.sh`, KI-21/KI-22 in KNOWN_ISSUES.md. `docs/MASTERPLAN.md`/`docs/ERLEDIGT.md` kommen mit dem parallelen PR `claude/masterplan` (Auftrag: trotzdem verlinken). Bei der Prüfung fiel `docs/plugin-matrix.md` auf: beschreibt Tauri-Plugins — README-Zeile schon vor dem Review korrigiert. |
+| G-R1 | glm-5.2 | nit | Kopf nennt „SETUP-02" statt „SETUP-A". | **Abgelehnt.** SETUP-02 ist die Paket-ID des Prüfskripts im Audit-Plan; SETUP-A bündelt SETUP-01/02/03/06/07/10/13. |
+| G-R3 | glm-5.2 | nit | `ollama` doppelt aufgerufen (`--version`, `list`). | **Abgelehnt.** Zwei verschiedene Aussagen (Binary vorhanden vs. Modelle/Daemon); Kosten vernachlässigbar. |
+| G-R5 | glm-5.2 | nit | `git push origin x --force` fällt nicht unter die Deny-Regel. | **Dokumentiert, keine Änderung** (Hinweis 5: Leitplanke, kein Ersatz für Branch-Schutz). |
+| G-R6 | glm-5.2 | nit | kimi.md nennt nur Feldnamen. | Keine Änderung (bestätigender Befund). |
+
+Zählung: 21 Befunde (15 kimi-k3, 6 glm-5.2; K-R3/G-R2 und K-R14/G-R4 decken
+sich). Angenommen: K-R2–R10, K-R12–R14 (+ G-R2, G-R4). Abgelehnt mit Beleg:
+K-R1, K-R11, G-R1, G-R3. Nur dokumentiert/geprüft: K-R15, G-R5, G-R6.
diff --git a/CLAUDE.md b/CLAUDE.md
index 0b4aae8..8b18251 100644
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -54,8 +54,9 @@ Einrichtung im Detail: [`docs/setup/claude-code.md`](docs/setup/claude-code.md).
   `CARGO_TARGET_DIR` auf einen Slot setzen (`%USERPROFILE%/cargo-targets/projecta-{a,b,c}`,
   höchstens 2–3 Builds gleichzeitig). Nie `CARGO_PROFILE_*` setzen.
 - **Auto-Mode:** Der Klassifikator blockt `git worktree remove` und
-  `git branch -d`. Aufräumen übernimmt der Nutzer (oder ein Skript mit eigener
-  Allow-Regel, siehe Permission-Vorschlag).
+  `git branch -d`. Aufräumen übernimmt der Nutzer. Ob eine Allow-Regel (etwa
+  für ein Prune-Skript) den Klassifikator übersteuert, ist noch nicht belegt
+  (Permission-Vorschlag, Hinweis 3).
 - **Subagenten und Berichte:** Schreibzugriffe von Subagenten auf
   `.pa/report_*.md` können blockiert sein. Dann den Bericht als Text an den
   Koordinator zurückgeben; der Koordinator committet ihn. Nicht umgehen.
diff --git a/PRODUCT.md b/PRODUCT.md
index cec5e85..0ca2a4f 100644
--- a/PRODUCT.md
+++ b/PRODUCT.md
@@ -98,8 +98,8 @@ which is locked behind whom.
   Control API.
 - The surrounding ritual: `STAND.md` is read first every session; gates run
   locally and in CI on pushes to `main` and on pull requests (installer
-  builds only on `v*` tags), exit codes unmasked; `main` is merged by the
-  Mergify merge queue; diffs over 300 lines
+  builds only on `v*` tags), exit codes unmasked; `main` is to be merged by
+  the Mergify merge queue (package CI-01); diffs over 300 lines
   or touching a Nahtstelle need two independent AI reviews with a logged
   disposition; every session appends to `.pa/ACTIVITY.md`.
 - Work happens across many concurrent git worktrees with a shared stash stack.
diff --git a/README.md b/README.md
index e3d05a3..8c2cc87 100644
--- a/README.md
+++ b/README.md
@@ -66,7 +66,7 @@ npm run dev:agent-check          # is this machine ready for an agent? (--json a
 
 The human cockpit is the Dev-HQ website: `npm run hq:live`, then `http://localhost:4173`. One implementation task, one agent, one git worktree — the coordination protocol is [AGENTS.md](AGENTS.md); how each provider (Claude Code, Codex, OpenCode, Kimi Code, the Ollama reviewers) is set up is in [docs/setup/](docs/setup/README.md).
 
-Pull requests: one PR per package, opened at the end and kept as a draft until report, review disposition and the `NICHT ABGEDECKT` block are in. `main` is merged by the Mergify merge queue, not by hand ([docs/setup/mergify.md](docs/setup/mergify.md)).
+Pull requests: one PR per package, opened at the end and kept as a draft until report, review disposition and the `NICHT ABGEDECKT` block are in. `main` is merged by the Mergify merge queue, not by hand; its configuration and labels arrive with package CI-01 ([docs/setup/mergify.md](docs/setup/mergify.md) has the current state).
 
 ## Documentation
 
diff --git a/docs/setup/README.md b/docs/setup/README.md
index eb2dd7d..3d11ae7 100644
--- a/docs/setup/README.md
+++ b/docs/setup/README.md
@@ -2,8 +2,9 @@
 
 Wie die KI-Werkzeuge auf dem Entwicklungsrechner für ProjectA eingerichtet
 sind, was jedes davon liest und wie man prüft, ob alles da ist. Stand
-24.09.2026 (Audit SETUP-A). Diese Seiten nennen **nur Dateinamen und
-Namen von Umgebungsvariablen, nie Werte**.
+24.09.2026 (Audit SETUP-A). Diese Seiten nennen für Zugangsdaten **nur
+Dateinamen und Namen von Umgebungsvariablen, nie Werte**; Einstellungswerte
+ohne Geheimnis (Modellname, Effort) stehen dabei.
 
 Die Arbeitsregeln selbst stehen in [`AGENTS.md`](../../AGENTS.md); diese Seiten
 beschreiben nur die Einrichtung.
@@ -28,7 +29,7 @@ Konfig-Dateien) ist eine Warnung.
 | Claude (Opus / Fable 5.1) | Claude Code | Koordinator, Nahtstellen, Security; Fable 5.1 als Advisor | [claude-code.md](claude-code.md) |
 | OpenAI GPT-6 Astra | Codex CLI | Advisor (Effort `high` je Aufruf), Worker | [codex.md](codex.md) |
 | Kimi K3 | Kimi Code CLI | Frontend/HQ-Worker, Reviews | [kimi.md](kimi.md) |
-| GLM / DeepSeek | OpenCode | Docs, Skripte, Zweitreview | [opencode.md](opencode.md) |
+| GLM (DeepSeek offen, W2-09b) | OpenCode | Docs, Skripte, Zweitreview | [opencode.md](opencode.md) |
 | kimi-k3 + glm-5.2 (Ollama Cloud) | `.pa/review_transport.py` | Alltags-Reviewerpaar | [ollama-reviewers.md](ollama-reviewers.md) |
 | — | Mergify | Merge-Queue für `main` | [mergify.md](mergify.md) |
 
@@ -39,7 +40,7 @@ Nur Abos, kein OpenRouter, keine zusätzlichen bezahlten API-Ausgaben.
 | Harness | `AGENTS.md` | Repo-Skills |
 |---|---|---|
 | Claude Code | über den Import `@AGENTS.md` in der ersten Zeile von `CLAUDE.md` (nicht von selbst) | `.claude/skills/` |
-| Codex CLI | automatisch (Konvention, Projektwurzel) | `.agents/skills/` (Codex-Konvention) |
+| Codex CLI | automatisch (Konvention, Projektwurzel) | `.agents/skills/` laut Codex-Konvention; auf diesem PC nicht geprobt (W1-18b) |
 | OpenCode | automatisch (Projektwurzel) | nicht belegt — Probe W1-18b offen |
 | Kimi Code CLI | automatisch | `--skills-dir <dir>` (so startet die App Kimi-Worker) |
 | Ollama-Reviewer | **nie** — sie sehen nur die Prompt-Datei | — |
diff --git a/docs/setup/claude-code.md b/docs/setup/claude-code.md
index 8785f88..a0e6e35 100644
--- a/docs/setup/claude-code.md
+++ b/docs/setup/claude-code.md
@@ -5,7 +5,7 @@ Zurück zur Übersicht: [README.md](README.md).
 
 ## Pflichtdateien im Repo
 
-- **`CLAUDE.md`** — erste Zeile `@AGENTS.md`. Ohne diesen Import lädt Claude
+- **`CLAUDE.md`** — eine eigene Zeile `@AGENTS.md` (hier die erste). Ohne diesen Import lädt Claude
   Code `AGENTS.md` **nicht**; `npm run dev:agent-check` prüft die Zeile.
 - **`.claude/settings.json`** — Allow-Liste nur für lesende git-, cargo- und
   npm-Befehle; zwei Hooks:
@@ -54,7 +54,9 @@ In `~/.claude/settings.json` (nur Namen):
   ```
 
   Höchstens 2–3 Builds gleichzeitig; vorher freien Arbeitsspeicher prüfen
-  (unter ~2,5 GB warten). **Nie `CARGO_PROFILE_*` setzen** — das entwertet den
+  (unter ~2,5 GB warten). `npm run dev:agent-check` sucht die Slots unter
+  `~/cargo-targets/`; ein anderes Wurzelverzeichnis über
+  `PROJECTA_BUILD_SLOTS_ROOT`. **Nie `CARGO_PROFILE_*` setzen** — das entwertet den
   ganzen Cache.
 - Eine Isolationsschranke für Subagenten lehnt verkettete Shell-Zeilen mit
   `git` ab: einzelne `git -C <worktree> …`-Befehle verwenden.
@@ -79,5 +81,7 @@ GPT-6 Astra über Codex ([codex.md](codex.md)).
 - **`| tail` verschluckt den Exit-Code** — Status ungemaskiert lesen.
 - **Push-Exit-Code ist nicht verlässlich** — Push mit `git ls-remote origin <branch>`
   prüfen.
-- **KI-21:** ein globaler ruflo-Bash-Hook kann Befehle verändern; Status in
-  `KNOWN_ISSUES.md`.
+- **KI-21:** der ruflo-core-Bash-Hook (`PreToolUse`/`PostToolUse Bash`) kann
+  eine per Shell-Umleitung geschriebene Datei mit seiner eigenen Ausgabe
+  überschreiben — Dateien mit dem Write-Werkzeug oder einem Skript schreiben,
+  nicht mit `>`. Status in `KNOWN_ISSUES.md`.
diff --git a/docs/setup/codex.md b/docs/setup/codex.md
index 531d48a..b0e9d78 100644
--- a/docs/setup/codex.md
+++ b/docs/setup/codex.md
@@ -34,6 +34,8 @@ schreiben.
 - `~/.codex/AGENTS.md` ist privat und projektfremd (persönliches
   Verhaltensmodell) — gehört dem Nutzer, nicht dem Repo.
 - Repo-Skills: `.agents/skills/` (Codex-Konvention; hier `projecta-workflow`).
+  Dass Codex den Repo-Skill in diesem Repo wirklich lädt, ist nicht geprobt
+  (W1-18b).
   Globale Skills: `~/.codex/skills`, `~/.agents/skills`. Von der App
   gestartete Codex-Worker bekommen keine Packs (eingebautes Profil: `skills`
   = `unsupported`; `ConventionAt` nur per `agents.json`, PR #57).
diff --git a/docs/setup/kimi.md b/docs/setup/kimi.md
index be71dde..6a723f4 100644
--- a/docs/setup/kimi.md
+++ b/docs/setup/kimi.md
@@ -54,10 +54,11 @@ Werte.
    löschen (sie enthält die Keys).
 2. **Entscheiden, was bleibt.** Nach der Entscheidung „nur Abos, kein
    OpenRouter" ist der OpenRouter-Key tot, der Anthropic-Key laut KI-22
-   ungenutzt. Abschnitte, die nicht mehr gebraucht werden, ganz entfernen —
-   am saubersten mit `kimi provider remove openrouter` bzw.
-   `kimi provider remove anthropic` (entfernt auch die Modell-Aliase, die
-   darauf zeigen).
+   ungenutzt. `kimi provider list` zeigt die Provider-IDs (auf diesem PC
+   `anthropic`, `managed:kimi-code`, `opencode`, `openrouter`). Nicht mehr
+   gebrauchte Provider ganz entfernen — mit `kimi provider remove openrouter`
+   bzw. `kimi provider remove anthropic` (Kimi Code CLI 2.0, `kimi provider
+   --help`: entfernt den Provider und alle Modell-Aliase, die darauf zeigen).
 3. **Für jeden verbleibenden Provider** (voraussichtlich `opencode`) eine
    Benutzer-Umgebungsvariable anlegen, z. B. `KIMI_OPENCODE_API_KEY`:
    Windows → *Systemeigenschaften → Umgebungsvariablen → Benutzervariablen →
diff --git a/docs/setup/ollama-reviewers.md b/docs/setup/ollama-reviewers.md
index ad6671b..975c8cb 100644
--- a/docs/setup/ollama-reviewers.md
+++ b/docs/setup/ollama-reviewers.md
@@ -62,5 +62,5 @@ der Kandidat danach, wird das Delta erneut geprüft.
 Das Ollama-Paar prüft Diffs und Pläne im Alltag. Für harte Entscheidungen und
 Abschlussreviews gilt das Advisor-Paar Fable 5.1 + GPT-6 Astra (siehe
 [README.md](README.md#advisors)). `.github/workflows/review.yml` (OpenRouter)
-ist ruhend — der Runner erreicht Ollama Cloud nicht, OpenRouter wird nicht
-mehr benutzt.
+ist ruhend — der Runner hat keine angemeldete Ollama-Instanz, OpenRouter
+wird nicht mehr benutzt.
diff --git a/docs/setup/opencode.md b/docs/setup/opencode.md
index 48496c5..8ad4eb8 100644
--- a/docs/setup/opencode.md
+++ b/docs/setup/opencode.md
@@ -1,6 +1,6 @@
 # OpenCode
 
-Rolle: Docs, Skripte, Zweitreview (GLM, DeepSeek). Stand: OpenCode 1.18.32.
+Rolle: Docs, Skripte, Zweitreview (GLM; DeepSeek als Worker offen, W2-09b). Stand: OpenCode 1.18.32.
 Zurück zur Übersicht: [README.md](README.md).
 
 ## Konfiguration `~/.config/opencode/opencode.jsonc` (nur Struktur)
diff --git a/docs/setup/permissions-proposal.md b/docs/setup/permissions-proposal.md
index d21aa8b..2c27f18 100644
--- a/docs/setup/permissions-proposal.md
+++ b/docs/setup/permissions-proposal.md
@@ -45,9 +45,6 @@ Regeln erst eintragen, wenn das jeweilige Skript gemergt ist.
       "Bash(git fetch *)", "Bash(git ls-remote *)", "Bash(git rev-parse *)",
       "Bash(git worktree prune)",
       "Bash(git checkout -- docs/dev-hq/data.js docs/dev-hq/data.json)",
-      // nur wenn Aufräumen NICHT ausschließlich über das Skript laufen soll:
-      "Bash(git worktree remove *)",                       // ohne --force verweigert git bei Änderungen
-      "Bash(git branch -d *)",                             // nur gemergte Branches; -D bleibt gesperrt
 
       // gh, lesend + PR-Verwaltung
       "Bash(gh pr view *)", "Bash(gh pr list *)", "Bash(gh pr checks *)", "Bash(gh pr diff *)",
@@ -63,10 +60,12 @@ Regeln erst eintragen, wenn das jeweilige Skript gemergt ist.
     "deny": [
       "Bash(git stash)", "Bash(git stash *)",              // geteilter Stash-Stapel
       "Bash(git push --force *)", "Bash(git push -f *)", "Bash(git push --force-with-lease *)",
-      "Bash(git reset --hard *)",
-      "Bash(git commit --no-verify *)", "Bash(git push --no-verify *)",
-      "Bash(git worktree remove --force *)", "Bash(git branch -D *)",
-      "Edit(.claude/settings.json)", "Edit(.claude/settings.local.json)"
+      "Bash(git reset --hard)", "Bash(git reset --hard *)",
+      "Bash(git commit --no-verify *)", "Bash(git push --no-verify)", "Bash(git push --no-verify *)",
+      "Bash(git worktree remove --force *)", "Bash(git worktree remove -f *)",
+      "Bash(git branch -D *)", "Bash(git branch -d --force *)", "Bash(git branch -df *)",
+      "Edit(.claude/settings.json)", "Edit(.claude/settings.local.json)",
+      "Write(.claude/settings.json)", "Write(.claude/settings.local.json)"
       // optional, siehe Hinweis 2:
       // "Bash(gh pr merge *)"
     ]
@@ -74,6 +73,21 @@ Regeln erst eintragen, wenn das jeweilige Skript gemergt ist.
 }
 ```
 
+**Optional**, nur wenn Aufräumen *nicht* ausschließlich über das Prune-Skript
+laufen soll (sonst weglassen — jede dieser Regeln öffnet Varianten, die die
+Deny-Liste abfangen muss, etwa `-f` statt `--force`):
+
+```jsonc
+"Bash(git worktree remove *)",   // ohne --force/-f verweigert git bei Änderungen
+"Bash(git branch -d *)"          // nur gemergte Branches; -D, -d --force, -df bleiben gesperrt
+```
+
+Syntax: `Bash(befehl *)` ist die Form, die die bestehende
+`.claude/settings.json` schon benutzt (`Bash(cargo test *)`); die ältere Form
+`Bash(befehl:*)` ist gleichbedeutend. Ein Muster mit ` *` trifft den nackten
+Befehl ohne Argumente **nicht** — deshalb stehen `git stash`,
+`git reset --hard` und `git push --no-verify` zusätzlich ohne Stern da.
+
 Für die PowerShell-Werkzeuge gelten dieselben Regeln mit `PowerShell(…)` statt
 `Bash(…)`; die bestehende Datei führt beide Formen.
 
@@ -93,7 +107,7 @@ Für die PowerShell-Werkzeuge gelten dieselben Regeln mit `PowerShell(…)` stat
 3. **Auto-Mode.** Ob explizite Allow-Regeln den Auto-Mode-Klassifikator bei
    `git worktree remove` wirklich übersteuern, ist noch nicht belegt. Nach dem
    Eintragen einmal an einem Wegwerf-Worktree prüfen.
-4. **`Edit(.claude/settings*.json)` in `deny`** schützt vor
+4. **`Edit(…)`/`Write(…)` auf `.claude/settings*.json` in `deny`** schützt vor
    Selbstberechtigung: Neue Rechte kommen nur vom Nutzer.
 5. **Grenzen der Deny-Regeln.** Die Muster greifen auf den Befehlsanfang.
    `git push origin x --force` (Flag hinten) fällt nicht unter
diff --git a/scripts/dev/agent-setup-check.mjs b/scripts/dev/agent-setup-check.mjs
index 289e7dd..06bdeca 100644
--- a/scripts/dev/agent-setup-check.mjs
+++ b/scripts/dev/agent-setup-check.mjs
@@ -30,7 +30,7 @@ const SKILL_CLAUDE = ".claude/skills/projecta-workflow/SKILL.md";
 // Fixed allow list: the only programs collect() may start, each with fixed
 // arguments. `--version` output is local; `gh auth status` and `ollama list`
 // talk to the local keyring / local Ollama daemon.
-const OPTIONAL_BINARIES = {
+export const OPTIONAL_BINARIES = {
   "cargo-nextest": { args: ["nextest", "--version"], cmd: "cargo", why: "rust-suite gate (cargo nextest run --profile ci)", fix: "cargo install cargo-nextest --locked" },
   python: { args: ["--version"], why: ".pa/review_transport.py (Ollama reviews)", fix: "Install Python 3 and make `python` resolve on PATH." },
   claude: { args: ["--version"], why: "Claude Code harness", fix: "See docs/setup/claude-code.md." },
@@ -39,7 +39,7 @@ const OPTIONAL_BINARIES = {
   kimi: { args: ["--version"], why: "Kimi Code CLI harness", fix: "See docs/setup/kimi.md." },
   ollama: { args: ["--version"], why: "reviewer pair via Ollama Cloud", fix: "See docs/setup/ollama-reviewers.md." },
 };
-const REQUIRED_BINARIES = {
+export const REQUIRED_BINARIES = {
   git: { args: ["--version"], fix: "Install git." },
   gh: { args: ["--version"], fix: "Install the GitHub CLI (https://cli.github.com); PRs are opened with gh." },
   cargo: { args: ["--version"], fix: "Install rustup (https://rustup.rs); every gate lane runs cargo." },
@@ -103,7 +103,7 @@ export const CHECKS = [
     run: (p) =>
       hasAgentsImport(p.claudeMd)
         ? ok("@AGENTS.md import line present")
-        : fail(p.claudeMd == null ? "CLAUDE.md missing" : "no `@AGENTS.md` line in CLAUDE.md", "Add a line containing only @AGENTS.md at the top of CLAUDE.md; Claude Code does not read AGENTS.md on its own."),
+        : fail(p.claudeMd == null ? "CLAUDE.md missing" : "no `@AGENTS.md` line in CLAUDE.md", "Add a line containing only @AGENTS.md to CLAUDE.md (by convention the first line); Claude Code does not read AGENTS.md on its own."),
   },
   {
     id: "hooks-path",
@@ -144,7 +144,11 @@ export const CHECKS = [
       const have = new Set(p.ollamaModels || []);
       const missing = REVIEWER_MODELS.filter((m) => !have.has(m));
       if (missing.length === 0) return ok(REVIEWER_MODELS.join(" + "));
-      return warn(`missing: ${missing.join(", ")}`, `ollama signin; ${missing.map((m) => `ollama pull ${m}`).join("; ")}`);
+      const pull = `ollama signin; ${missing.map((m) => `ollama pull ${m}`).join("; ")}`;
+      return warn(
+        `missing: ${missing.join(", ")}`,
+        p.binaries?.ollama ? pull : `Install Ollama first (see bin-ollama, docs/setup/ollama-reviewers.md), then: ${pull}`,
+      );
     },
   },
   {
@@ -199,6 +203,19 @@ export function formatText(result) {
   return lines.join("\n") + "\n";
 }
 
+// `ollama list` prints a header row starting with NAME, then one model per
+// line. Anything before the header (update notices, warnings) is skipped; the
+// header itself is never a model.
+export function parseOllamaList(stdout) {
+  const lines = String(stdout || "").split(/\r?\n/).map((l) => l.trim());
+  const header = lines.findIndex((l) => /^NAME\s/.test(l));
+  if (header === -1) return [];
+  return lines
+    .slice(header + 1)
+    .map((l) => l.split(/\s+/)[0])
+    .filter(Boolean);
+}
+
 function firstLine(text) {
   return String(text || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || null;
 }
@@ -235,14 +252,7 @@ export function collect({
   // Asked directly, not gated on `--version`: a missing binary simply fails.
   const gh = run("gh", ["auth", "status"]);
   const ollama = run("ollama", ["list"]);
-  const ollamaModels =
-    ollama && ollama.status === 0
-      ? String(ollama.stdout || "")
-          .split(/\r?\n/)
-          .slice(1)
-          .map((l) => l.trim().split(/\s+/)[0])
-          .filter(Boolean)
-      : [];
+  const ollamaModels = ollama && ollama.status === 0 ? parseOllamaList(ollama.stdout) : [];
 
   const at = (rel) => join(root, ...rel.split("/"));
   const inHome = (tilde) => join(home, ...tilde.replace(/^~\//, "").split("/").filter(Boolean));
diff --git a/scripts/lib/agent-setup-check.test.mjs b/scripts/lib/agent-setup-check.test.mjs
index a2afea4..c6d785b 100644
--- a/scripts/lib/agent-setup-check.test.mjs
+++ b/scripts/lib/agent-setup-check.test.mjs
@@ -9,6 +9,9 @@ import {
   CHECKS,
   REVIEWER_MODELS,
   BUILD_SLOTS,
+  REQUIRED_BINARIES,
+  OPTIONAL_BINARIES,
+  parseOllamaList,
   evaluate,
   exitCode,
   collect,
@@ -231,6 +234,55 @@ test("main prints json and returns the exit code without touching the machine",
   assert.equal(parsed.checks.find((c) => c.id === "hooks-path").state, "fail");
 });
 
+test("ollama list output with a notice before the header keeps every model", () => {
+  const out = "A new version of Ollama is available\nNAME ID SIZE MODIFIED\nkimi-k3:cloud 630e - 5 weeks ago\nglm-5.2:cloud 7e91 - 5 weeks ago\n";
+  assert.deepEqual(parseOllamaList(out), ["kimi-k3:cloud", "glm-5.2:cloud"]);
+  assert.deepEqual(parseOllamaList("NAME ID SIZE MODIFIED\n"), []);
+  assert.deepEqual(parseOllamaList("Error: could not connect to ollama app\n"), []);
+});
+
+test("a missing mandatory binary fails and a missing CLAUDE.md is named", () => {
+  const result = evaluate({ ...healthy, binaries: { ...healthy.binaries, git: null }, claudeMd: null });
+  assert.equal(byId(result, "bin-git").state, "fail");
+  assert.equal(byId(result, "claude-md-import").detail, "CLAUDE.md missing");
+  assert.equal(exitCode(result), 1);
+});
+
+test("a crashing check fails when mandatory and only warns when optional", () => {
+  const result = evaluate({ ...healthy, binaries: null });
+  assert.equal(byId(result, "bin-git").state, "fail");
+  assert.equal(byId(result, "bin-kimi").state, "warn");
+  const crashing = evaluate(
+    Object.defineProperty({ ...healthy }, "ollamaModels", {
+      get() {
+        throw new Error("boom");
+      },
+    }),
+  );
+  const check = byId(crashing, "reviewer-models");
+  assert.equal(check.state, "warn");
+  assert.match(check.detail, /check crashed: boom/);
+});
+
+test("reviewer fix names the ollama install when ollama itself is missing", () => {
+  const result = evaluate({ ...healthy, binaries: { ...healthy.binaries, ollama: null }, ollamaModels: [] });
+  assert.match(byId(result, "reviewer-models").fix, /Install Ollama first/);
+});
+
+// defaultRun joins cmd and args into one shell line on Windows. That is only
+// safe while every program and argument is a plain literal.
+test("every spawned command and argument is a shell-safe literal", () => {
+  const safe = /^[A-Za-z0-9._-]+$/;
+  for (const [name, spec] of Object.entries({ ...REQUIRED_BINARIES, ...OPTIONAL_BINARIES })) {
+    for (const part of [spec.cmd || name, ...spec.args]) assert.match(part, safe, `${name}: ${part}`);
+  }
+  const machine = fakeMachine();
+  collect(machine.deps);
+  for (const call of machine.calls) {
+    for (const part of call.split(" ")) assert.match(part, safe, call);
+  }
+});
+
 test("text output marks each state and lists fixes", () => {
   const text = formatText(evaluate({ ...healthy, ghAuth: false }));
   assert.match(text, /\[ok\]/);

```
