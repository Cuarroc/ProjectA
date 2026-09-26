# Review Runde 4 SETUP-A (Korrektur nach Koordinator-Befund)

Rolle: unabhängiger Reviewer (andere Modellfamilie als der Autor Claude). Prüfe den
Diff unten auf sachliche Richtigkeit, innere Widersprüche und Widersprüche zu den
Referenzfakten. Keine Geheimnisse nennen. Ausgabe auf Deutsch:
Befunde als `ID | Schwere (hoch/mittel/niedrig/nit) | Datei:Zeile`, Befund, Vorschlag;
dann ein Urteil (freigeben / freigeben mit Auflagen / Nachbesserung erforderlich).

## Referenzfakten (vom Koordinator im Binary `~/.kimi-code/bin/kimi.EXE` geprüft, bzw. Nutzerentscheidung)

1. Kimi Code CLI 2.0 kennt als Provider-Credentials nur `api_key` (Literal) oder `oauth`; ein Feld `api_key_env` existiert nicht. Env-Fallback nur je Provider-Typ aus der `env`-Tabelle des Providers in der config (`resolveProviderEndpoint(provider.type, provider.env ?? {})`, apiKeyEnv `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`KIMI_API_KEY`), nicht aus der Prozessumgebung.
2. Umgesetzt (mit Nutzerfreigabe): Keys von `providers.anthropic` und `providers.openrouter` geleert, Backup daneben; `providers.opencode` behält Literal-Key, weil ein globales `OPENAI_API_KEY` Codex auf API-Abrechnung umstellen würde (Regel: nur Abos); Kimi selbst über OAuth (`managed:kimi-code`, Default `kimi-code/k3`).
3. Nutzeraufgaben: alte `config.toml.bak*` enthalten noch Keys und sollen gelöscht werden; Rotation empfohlen; Prüfbefehl `kimi provider list`.
4. Nutzerentscheidung 24.09.: Die Merge-Erlaubnis des Koordinators gilt weiter als Notfall-Ausnahme, wenn die Queue hängt oder Mergify ausfällt; sonst läuft alles über die Mergify-Queue. AGENTS.md wird separat (SETUP-04) nachgezogen. Der Permission-Vorschlag bleibt inhaltlich (Regeln) unverändert.

## Diff

```diff
diff --git a/.agents/skills/projecta-workflow/SKILL.md b/.agents/skills/projecta-workflow/SKILL.md
index 961496f..edea8f3 100644
--- a/.agents/skills/projecta-workflow/SKILL.md
+++ b/.agents/skills/projecta-workflow/SKILL.md
@@ -88,11 +88,15 @@ who asks the user.
    not with the push exit code. Package branches
    (`<vendor>/w<N>-…`, `df<N>`, `ki-<N>`, `hq2-`) must add or change a `.pa/report_*.md`
    or Mergify's merge protection stays red.
-3. `main` is merged only by the **Mergify** merge queue (`.mergify.yml`,
+3. `main` is merged by the **Mergify** merge queue (`.mergify.yml`,
    `AGENTS.md` "Merging"). Do not merge `main` into your branch just to
    refresh it; only to resolve a real conflict — merge, never rebase or
    force-push. Labels: `do-not-merge` keeps a PR out of the queue; `priority`
    (coordinator only) moves it to the front; `conflict` is set and cleared by
-   Mergify. Details: `docs/setup/mergify.md`.
+   Mergify. Workers never merge by hand; only the coordinator may, as an
+   emergency exception when the queue hangs or Mergify is down.
+   Details: `docs/setup/mergify.md`.
+   emergency exception when the queue hangs or Mergify is down.
+   Details: `docs/setup/mergify.md`.
 4. After a merge in your worktree, restore generated snapshots:
    `git checkout -- docs/dev-hq/data.js docs/dev-hq/data.json`.
diff --git a/.claude/skills/projecta-workflow/SKILL.md b/.claude/skills/projecta-workflow/SKILL.md
index 961496f..edea8f3 100644
--- a/.claude/skills/projecta-workflow/SKILL.md
+++ b/.claude/skills/projecta-workflow/SKILL.md
@@ -88,11 +88,15 @@ who asks the user.
    not with the push exit code. Package branches
    (`<vendor>/w<N>-…`, `df<N>`, `ki-<N>`, `hq2-`) must add or change a `.pa/report_*.md`
    or Mergify's merge protection stays red.
-3. `main` is merged only by the **Mergify** merge queue (`.mergify.yml`,
+3. `main` is merged by the **Mergify** merge queue (`.mergify.yml`,
    `AGENTS.md` "Merging"). Do not merge `main` into your branch just to
    refresh it; only to resolve a real conflict — merge, never rebase or
    force-push. Labels: `do-not-merge` keeps a PR out of the queue; `priority`
    (coordinator only) moves it to the front; `conflict` is set and cleared by
-   Mergify. Details: `docs/setup/mergify.md`.
+   Mergify. Workers never merge by hand; only the coordinator may, as an
+   emergency exception when the queue hangs or Mergify is down.
+   Details: `docs/setup/mergify.md`.
+   emergency exception when the queue hangs or Mergify is down.
+   Details: `docs/setup/mergify.md`.
 4. After a merge in your worktree, restore generated snapshots:
    `git checkout -- docs/dev-hq/data.js docs/dev-hq/data.json`.
diff --git a/README.md b/README.md
index 123d7fb..4fafb46 100644
--- a/README.md
+++ b/README.md
@@ -66,7 +66,7 @@ npm run dev:agent-check          # is this machine ready for an agent? (--json a
 
 The human cockpit is the Dev-HQ website: `npm run hq:live`, then `http://localhost:4173`. One implementation task, one agent, one git worktree — the coordination protocol is [AGENTS.md](AGENTS.md); how each provider (Claude Code, Codex, OpenCode, Kimi Code, the Ollama reviewers) is set up is in [docs/setup/](docs/setup/README.md).
 
-Pull requests: one PR per package, opened at the end and kept as a draft until report, review disposition and the `NICHT ABGEDECKT` block are in. `main` is merged only through the Mergify merge queue (`.mergify.yml`, [docs/setup/mergify.md](docs/setup/mergify.md)).
+Pull requests: one PR per package, opened at the end and kept as a draft until report, review disposition and the `NICHT ABGEDECKT` block are in. `main` is merged through the Mergify merge queue (`.mergify.yml`, [docs/setup/mergify.md](docs/setup/mergify.md)); only the coordinator may merge by hand, as an emergency exception when the queue hangs or Mergify is down.
 
 ## Documentation
 
diff --git a/docs/setup/kimi.md b/docs/setup/kimi.md
index 6a723f4..83cd752 100644
--- a/docs/setup/kimi.md
+++ b/docs/setup/kimi.md
@@ -22,7 +22,7 @@ Relevante Felder in `config.toml` (nur Namen): `default_model`,
   `kimi login` (Device-Code-Ablauf).
 - `MOONSHOT_API_KEY` wird von dieser Konfiguration **nirgends** benutzt. Die
   Annahme in `src-tauri/src/profiles.rs` („`MOONSHOT_API_KEY` for a Kimi …")
-  gilt für diese Harness nicht (Eingabe für W5-02b6).
+  gilt für diese Harness nicht; das behandelt W5-02b6.
 - Folge für eine Umgebungs-Allowlist (W5-02b6): Kimi braucht `USERPROFILE`,
   `HOME`, `APPDATA`, `LOCALAPPDATA` (Zugriff auf `~/.kimi-code/credentials/`),
   nicht `MOONSHOT_API_KEY`. Abnahme: `kimi -p "sieben mal sechs"` unter der
@@ -37,50 +37,41 @@ Relevante Felder in `config.toml` (nur Namen): `default_model`,
   eine globale, private Datei des Nutzers.
 - MCP: `codebase-memory-mcp` (`~/.kimi-code/mcp.json`).
 
-## Nutzeraufgabe: literale Keys aus `config.toml` entfernen
+## Provider-Keys: Stand und Nutzeraufgabe
 
-`config.toml` enthält für drei Provider **literale API-Keys** im Klartext
-(`[providers.opencode]`, `[providers.anthropic]`, `[providers.openrouter]`, je
-Feld `api_key`). Das ist ein Sicherheitsbefund. Kimi Code kennt dafür das Feld
-**`api_key_env`**: es nennt den *Namen* einer Umgebungsvariable, aus der der
-Key gelesen wird. `api_key` und `api_key_env` schließen sich aus — pro Provider
-genau eines (Kimi-Code-Doku, *Configuration → Providers*).
+**Keine Env-Referenzen möglich.** Kimi Code CLI 2.0 kennt als
+Provider-Zugangsdaten nur ein literales `api_key` oder `oauth`. Ein Feld
+`api_key_env` gibt es nicht (geprüft im Binary `~/.kimi-code/bin/kimi.EXE`).
+Der einzige Env-Fallback hängt am Provider-Typ und liest ausschließlich aus der
+`env`-Tabelle des Providers in `config.toml` (`OPENAI_API_KEY`,
+`ANTHROPIC_API_KEY`, `KIMI_API_KEY`), **nicht** aus der Prozessumgebung — ein
+Key stünde also trotzdem im Klartext in der Datei.
 
-Diese Schritte macht **der Nutzer selbst**; kein Agent liest oder zeigt die
-Werte.
+**Stand 24.09.2026** (vom Koordinator mit Nutzerfreigabe umgesetzt):
 
-1. **Sichern:** `config.toml` nach `config.toml.setup-a.bak` kopieren (der Name
-   `config.toml.bak` ist schon belegt) und die Sicherung nach Schritt 6
-   löschen (sie enthält die Keys).
-2. **Entscheiden, was bleibt.** Nach der Entscheidung „nur Abos, kein
-   OpenRouter" ist der OpenRouter-Key tot, der Anthropic-Key laut KI-22
-   ungenutzt. `kimi provider list` zeigt die Provider-IDs (auf diesem PC
-   `anthropic`, `managed:kimi-code`, `opencode`, `openrouter`). Nicht mehr
-   gebrauchte Provider ganz entfernen — mit `kimi provider remove openrouter`
-   bzw. `kimi provider remove anthropic` (Kimi Code CLI 2.0, `kimi provider
-   --help`: entfernt den Provider und alle Modell-Aliase, die darauf zeigen).
-3. **Für jeden verbleibenden Provider** (voraussichtlich `opencode`) eine
-   Benutzer-Umgebungsvariable anlegen, z. B. `KIMI_OPENCODE_API_KEY`:
-   Windows → *Systemeigenschaften → Umgebungsvariablen → Benutzervariablen →
-   Neu*. Den Wert dort einfügen, nicht in eine Shell-Zeile (landet sonst in der
-   History).
-4. **In `config.toml`** im Abschnitt `[providers.opencode]` die Zeile
-   `api_key = "…"` löschen und stattdessen schreiben:
+| Provider | Zugang | Stand |
+|---|---|---|
+| `managed:kimi-code` | OAuth | aktiv, Standardmodell `kimi-code/k3` |
+| `anthropic` | — | Key geleert (nach „nur Abos" ungenutzt) |
+| `openrouter` | — | Key geleert (kein OpenRouter) |
+| `opencode` | literaler `api_key` | bleibt bewusst: ein globales `OPENAI_API_KEY` würde Codex auf API-Abrechnung umstellen (Regel „nur Abos") |
 
-   ```toml
-   api_key_env = "KIMI_OPENCODE_API_KEY"
-   ```
+Die Sicherung vor dem Leeren liegt neben `config.toml`.
 
-   Mit einem Editor, der UTF-8 erhält (nicht PowerShell `Set-Content`).
-5. **Prüfen:** neues Terminal öffnen (damit die Variable geladen ist), dann
-   `kimi doctor` und `kimi -p "sieben mal sechs"` mit einem Modell dieses
-   Providers (`-m <alias>`). Erwartet: `42`.
-6. **Aufräumen:** `config.toml.setup-a.bak` löschen. Im selben Ordner liegen
-   ältere Sicherungen (`config.toml.bak`, `config.toml.bak-sessionhook`,
-   `config.toml.20260823-040800.bak`); sie enthalten sehr wahrscheinlich
-   dieselben Klartext-Keys — prüfen, ob noch gebraucht, sonst ebenfalls
-   löschen. Keys, die im Klartext gelegen haben, beim Anbieter **rotieren**
-   (neu erzeugen, alten widerrufen) — die Dateien lagen unverschlüsselt auf
-   der Platte.
+**Was der Nutzer selbst macht** (kein Agent liest oder zeigt die Werte):
 
-Der Provider `managed:kimi-code` bleibt unverändert (OAuth, leeres `api_key`).
+1. **Alte Sicherungen löschen.** Im Ordner `~/.kimi-code/` enthalten die
+   Sicherungen `config.toml.bak*` (u. a. `config.toml.bak`,
+   `config.toml.bak-sessionhook`) und `config.toml.20260823-040800.bak` sowie
+   die Sicherung vom Leeren noch die Klartext-Keys. Wenn nicht mehr gebraucht,
+   löschen.
+2. **Rotieren.** Die Keys, die im Klartext auf der Platte lagen (Anthropic,
+   OpenRouter, OpenCode), beim jeweiligen Anbieter neu erzeugen und den alten
+   widerrufen. Den neuen OpenCode-Key wieder als `api_key` in
+   `[providers.opencode]` eintragen — mit einem Editor, der UTF-8 erhält (nicht
+   PowerShell `Set-Content`), und nicht über eine Shell-Zeile (History).
+3. **Prüfen:** `kimi provider list` zeigt die Provider-IDs (hier
+   `anthropic`, `managed:kimi-code`, `opencode`, `openrouter`); `kimi doctor`
+   prüft die Konfiguration. Nicht mehr gebrauchte Provider lassen sich mit
+   `kimi provider remove <providerId>` ganz entfernen (entfernt auch die
+   Modell-Aliase, die darauf zeigen).
diff --git a/docs/setup/mergify.md b/docs/setup/mergify.md
index 84e7a27..d1035a2 100644
--- a/docs/setup/mergify.md
+++ b/docs/setup/mergify.md
@@ -81,12 +81,13 @@ generierten Snapshots zurück:
 
 ## Hand-Merge
 
-Es gilt `AGENTS.md`: `main` wird **nur** über die Queue gemergt. Der
-Koordinator hatte vor CI-01 eine stehende Merge-Erlaubnis des Nutzers für
-fertige PRs; ob sie als Notfall-Ausnahme (Queue hängt) weiter gilt, ist offen
-und Nutzerentscheidung — bis dahin ruht sie. Ob `gh pr merge` zusätzlich per
-Deny-Regel gesperrt wird, ebenfalls: siehe
-[permissions-proposal.md](permissions-proposal.md).
+Regelfall: `main` wird über die Queue gemergt. **Notfall-Ausnahme**
+(Nutzerentscheidung 24.09.2026): Hängt die Queue oder fällt Mergify aus, darf
+der Koordinator fertige PRs weiter von Hand mergen (`gh pr merge --merge`,
+Merge-Commit wie die Queue). Sonst mergt niemand von Hand. Die Ausnahme
+kommt mit SETUP-04 auch in `AGENTS.md` („Merging"). Ob `gh pr merge` für alle
+übrigen Claude-Sitzungen per Deny-Regel gesperrt wird, entscheidet der Nutzer:
+siehe [permissions-proposal.md](permissions-proposal.md).
 
 ## Warum steht mein PR nicht in der Queue?
 
diff --git a/docs/setup/permissions-proposal.md b/docs/setup/permissions-proposal.md
index 930313d..c559f53 100644
--- a/docs/setup/permissions-proposal.md
+++ b/docs/setup/permissions-proposal.md
@@ -105,11 +105,11 @@ Für die PowerShell-Werkzeuge gelten dieselben Regeln mit `PowerShell(…)` stat
 2. **`gh pr merge` sperren — Nutzerentscheidung.** Seit CI-01 (PR #108) sagt
    `AGENTS.md`: `main` wird nur über die Mergify-Queue gemergt. Die Regel
    `Bash(gh pr merge *)` in `deny` setzt das für Claude technisch durch. Der
-   Koordinator hatte vor CI-01 eine stehende Merge-Erlaubnis des Nutzers für
-   fertige PRs; seit CI-01 ruht sie, bis der Nutzer entscheidet. Mit der
-   Deny-Regel macht Hand-Merges nur noch der Nutzer. Soll der Koordinator im
-   Notfall (Queue hängt) von Hand mergen dürfen, die Regel weglassen und die
-   Ausnahme in `AGENTS.md` („Merging") nachtragen.
+   Koordinator darf als Notfall-Ausnahme (Queue hängt, Mergify fällt aus)
+   weiter von Hand mergen (Nutzerentscheidung 24.09., siehe
+   [mergify.md](mergify.md#hand-merge)). Eine Deny-Regel in der Repo-Datei
+   gälte auch für den Koordinator; wer sie einträgt, braucht für den Notfall
+   den Nutzer oder eine Ausnahme in der lokalen Einstellung des Koordinators.
 3. **Auto-Mode.** Ob explizite Allow-Regeln den Auto-Mode-Klassifikator bei
    `git worktree remove` wirklich übersteuern, ist noch nicht belegt. Nach dem
    Eintragen einmal an einem Wegwerf-Worktree prüfen.
```
