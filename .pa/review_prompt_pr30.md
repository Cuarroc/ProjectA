# Review request: package W1-18b (port), candidate ebd96f2 (review stage B, one reviewer; stage A Kimi K3 and GLM 5.2 already ran, their findings are in the last commit)

You review a small change for the ProjectA repository (Tauri 2 agentic terminal, Rust + Node). Read only this prompt. Report findings against the diff below.

## What the change does
- The built-in agent profiles `opencode` and `opencode-glm-53-flash` (src-tauri/resources/agent-defaults.json) change `skills` from `unsupported` to `conventionAt` with dir `.agents/skills`. Basis: an observation on 2026-09-25 - the installed OpenCode 1.18.32 lists a canary skill placed in a workspace's `.agents/skills` when run as `opencode debug skill --pure` in an isolated workspace (exit 0, no model call). Codex was NOT probed (rate limit until 2026-09-30) and stays `unsupported`; a test pins that.
- The HQ profile validator (scripts/lib/hq-live-lib.mjs) mirrors the Rust capability schema but did not know `conventionAt`, so it rejected the manifest. It now accepts `conventionAt` with a string `dir`. A new test compares the validator's mode table against the Rust enums in capabilities.rs so the mirror cannot drift silently.
- Docs (docs/setup/*, PRODUCT.md) state the measured state.
- Test-first: commit 1 adds the tests only (measured red on the merge base: cargo test --bin projecta profiles:: exit 101, 3 failed; node --test scripts/lib/hq-profile-contract.test.mjs exit 1, 2 failed); commit 2 is the fix; commit 3 docs. Only discovery is claimed, not that a model uses a skill.

## Rules to check against
- A claim needs evidence; capability configuration is not capability evidence. No claim about a provider/model/behaviour that was not observed.
- Seams api.rs, main.rs, store.rs, bin/pa.rs must not be touched (they are not in this diff).
- No secrets, no personal data, no absolute user paths in tracked files.
- Bug claims need a compiling failing regression test; check sibling cases.

## Output format
A table of findings with columns: ID, severity (blocker/major/minor/info), file:line, reasoning. Then one verdict line: freigeben / freigeben mit Auflagen / ablehnen. Be concrete; do not invent findings; say "keine Befunde" if there are none.

- Stage B: report only NEW findings you can substantiate from the diff; the docs/tests were already reviewed once. Note the glm variant claim in profiles.rs is now marked as an assumption (--pure makes no model call).

## Diff (merge base...ebd96f2, without .pa/ review files)
```diff
diff --git a/PRODUCT.md b/PRODUCT.md
index cec5e85..c037e98 100644
--- a/PRODUCT.md
+++ b/PRODUCT.md
@@ -123,13 +123,15 @@ groups profiles visually while the Rust core ignores it.
 
 **Known constraints on that ambition:**
 
-- The app delivers skill packs only to 2 of 5 built-in providers
+- The app delivers skill packs only to 3 of 5 built-in providers
   (`src-tauri/resources/agent-defaults.json`: `claude` → Convention, `kimi` →
-  Flag `--skills-dir`; `codex`, `opencode`, `ollama` → `unsupported`). The
-  `ConventionAt` mode (PR #57, e.g. `.agents/skills`) exists but is only set
-  through an `agents.json` override; whether Codex/OpenCode pick up
-  `.agents/skills` on their own is the open probe W1-18b. A team template
-  promising "skills" cannot yet deliver them on three providers.
+  Flag `--skills-dir`, `opencode` → ConventionAt `.agents/skills` (probe
+  W1-18b, 2026-09-25: `opencode debug skill --pure` lists a canary from
+  `.agents/skills`, evidence in the W1-18b PR text);
+  `codex`, `ollama` → `unsupported`. Whether Codex picks up `.agents/skills`
+  on its own stays open: its re-probe is deferred until the CLI rate limit
+  ends (after 2026-09-30). A team template promising "skills" cannot yet
+  deliver them on two providers.
 - Harness properties are a Rust enum, not data. Making them configurable is
   already an accepted roadmap item (`docs/decisions.md`, 2026-09-09,
   Multi-Harness) with a spec at `.pa/task_multi_harness.md` (status
diff --git a/docs/setup/README.md b/docs/setup/README.md
index 4daf442..1ef116d 100644
--- a/docs/setup/README.md
+++ b/docs/setup/README.md
@@ -43,19 +43,20 @@ Nur Abos, kein OpenRouter, keine zusätzlichen bezahlten API-Ausgaben.
 | Harness | `AGENTS.md` | Repo-Skills |
 |---|---|---|
 | Claude Code | über den Import `@AGENTS.md` in der ersten Zeile von `CLAUDE.md` (nicht von selbst) | `.claude/skills/` |
-| Codex CLI | automatisch (Konvention, Projektwurzel) | `.agents/skills/` laut Codex-Konvention; auf diesem PC nicht geprobt (W1-18b) |
-| OpenCode | automatisch (Projektwurzel) | nicht belegt — Probe W1-18b offen |
+| Codex CLI | automatisch (Konvention, Projektwurzel) | `.agents/skills/` laut Codex-Konvention; auf diesem PC nicht geprobt (W1-18b, Codex-Probe nach dem Rate-Limit am 30.09.) |
+| OpenCode | automatisch (Projektwurzel) | `.agents/skills/`, geprobt 25.09. mit OpenCode 1.18.32 (W1-18b, Beleg im PR-Text) |
 | Kimi Code CLI | automatisch | `--skills-dir <dir>` (so startet die App Kimi-Worker) |
 | Ollama-Reviewer | **nie** — sie sehen nur die Prompt-Datei | — |
 
-Die App stellt Skill-Packs heute nur Claude (Konvention) und Kimi (`--skills-dir`)
-bereit; für Codex und OpenCode stehen die eingebauten Profile auf
-`unsupported` (`src-tauri/resources/agent-defaults.json`). Der Modus
-`ConventionAt` (PR #57) existiert, wird aber nur per `agents.json` gesetzt.
+Die App stellt Skill-Packs für Claude (Konvention), Kimi (`--skills-dir`) und
+OpenCode (`conventionAt` `.agents/skills`, eingebautes Profil seit W1-18b)
+bereit; für Codex steht das eingebaute Profil weiter auf `unsupported`
+(`src-tauri/resources/agent-defaults.json`), bis die Probe nachgeholt ist. Der
+Modus `ConventionAt` (PR #57) lässt sich zusätzlich per `agents.json` setzen.
 
 Der Repo-Skill `projecta-workflow` ist die Kurzfassung der Arbeitsweise als
 Checkliste. Er liegt zweimal im Repo, byte-gleich bis auf Zeilenenden:
-`.agents/skills/projecta-workflow/SKILL.md` (Codex; weitere Harnesses nach W1-18b) und
+`.agents/skills/projecta-workflow/SKILL.md` (Codex-Konvention; findet OpenCode seit der W1-18b-Probe ebenfalls) und
 `.claude/skills/projecta-workflow/SKILL.md` (Claude Code). Geändert wird die
 `.agents`-Fassung, dann kopiert; `dev:agent-check` schlägt bei Abweichung an.
 
diff --git a/docs/setup/opencode.md b/docs/setup/opencode.md
index 8ad4eb8..a42bd33 100644
--- a/docs/setup/opencode.md
+++ b/docs/setup/opencode.md
@@ -27,10 +27,11 @@ Zurück zur Übersicht: [README.md](README.md).
 
 - `AGENTS.md` liest OpenCode selbst aus der Projektwurzel. Ein Repo-`.opencode/`
   ist nicht nötig.
-- Repo-Skills: ob OpenCode `.agents/skills/` von selbst findet, ist nicht
-  belegt (Probe W1-18b offen). Die App stellt OpenCode-Workern keine Packs
-  bereit (eingebautes Profil: `skills` = `unsupported`); per `agents.json`
-  ließe sich `ConventionAt` setzen (PR #57). Globale Skills unter
+- Repo-Skills: OpenCode 1.18.32 findet `.agents/skills/` von selbst — geprobt
+  am 25.09. (W1-18b) mit `opencode debug skill --pure` in einem isolierten
+  Canary-Workspace, kein Modellaufruf (Beleg: PR-Text von W1-18b).
+  Das eingebaute Profil steht seitdem auf `conventionAt` `.agents/skills`,
+  die App stellt OpenCode-Workern also Packs bereit. Globale Skills unter
   `~/.config/opencode/`.
 
 ## Belegte Eigenschaften
diff --git a/scripts/lib/hq-live-lib.mjs b/scripts/lib/hq-live-lib.mjs
index 6bfc389..e79f82b 100644
--- a/scripts/lib/hq-live-lib.mjs
+++ b/scripts/lib/hq-live-lib.mjs
@@ -90,7 +90,7 @@ function validateStoredProfile(profile) {
   if (profile.caps != null) {
     const caps = profile.caps;
     if (!obj(caps)) invalid();
-    for (const [key, modes] of Object.entries({ systemPrompt: { unsupported: [], arg: ['flag'], file: ['flag', 'ext'] }, skills: { unsupported: [], convention: [], flag: ['flag'] }, lifecycle: { heuristic: [], settingsHooks: ['flag'] } })) {
+    for (const [key, modes] of Object.entries({ systemPrompt: { unsupported: [], arg: ['flag'], file: ['flag', 'ext'] }, skills: { unsupported: [], convention: [], flag: ['flag'], conventionAt: ['dir'] }, lifecycle: { heuristic: [], settingsHooks: ['flag'] } })) {
       if (caps[key] === undefined) continue;
       const value = caps[key];
       if (!obj(value) || !Object.hasOwn(modes, value.mode) || modes[value.mode].some(field => typeof value[field] !== 'string')) invalid();
diff --git a/scripts/lib/hq-profile-contract.test.mjs b/scripts/lib/hq-profile-contract.test.mjs
index 91ea43b..f3614b4 100644
--- a/scripts/lib/hq-profile-contract.test.mjs
+++ b/scripts/lib/hq-profile-contract.test.mjs
@@ -41,3 +41,66 @@ test('profile writes retain wrapper metadata and support legacy array reads', ()
     assert.equal(JSON.parse(readFileSync(path, 'utf8')).schemaVersion, 1);
   } finally { rmSync(dir, { recursive: true, force: true }); }
 });
+
+// W1-18b: `conventionAt` is a documented (docs/agents-json.md) and shipped
+// (PR #57) skills mode and the built-in opencode profiles use it - the HQ
+// validator must not reject it as malformed.
+test('the validator accepts skills conventionAt with a string dir and rejects a malformed one', () => {
+  const dir = mkdtempSync(join(tmpdir(), 'hq-profile-contract-'));
+  try {
+    const path = join(dir, 'agents.json');
+    const valid = JSON.stringify({ profiles: [{ id: 'opencode', name: 'OC', command: 'opencode', caps: { skills: { mode: 'conventionAt', dir: '.agents/skills' } } }] });
+    writeFileSync(path, valid);
+    assert.equal(readAgentsFile(path, { strict: true }).profiles[0].caps.skills.mode, 'conventionAt');
+    assert.equal(readFileSync(path, 'utf8'), valid);
+    for (const caps of [{ skills: { mode: 'conventionAt' } }, { skills: { mode: 'conventionAt', dir: 5 } }]) {
+      const invalid = JSON.stringify({ profiles: [{ id: 'a', name: 'A', command: 'a', caps }] });
+      writeFileSync(path, invalid);
+      assert.throws(() => readAgentsFile(path, { strict: true }), /runtime schema/);
+      assert.equal(readFileSync(path, 'utf8'), invalid);
+    }
+  } finally { rmSync(dir, { recursive: true, force: true }); }
+});
+
+// W1-18b, second review: the validator's mode table is a JS mirror
+// of the Rust capability enums in src-tauri/src/capabilities.rs. The W1-18b
+// sibling bug (validator rejected the documented conventionAt mode) happened
+// because the two drifted apart - this gate fails when one side gains,
+// renames or re-shapes a mode without the other.
+test('the validator mode table mirrors the Rust capability enums', () => {
+  const rust = readFileSync(join(import.meta.dirname, '../../src-tauri/src/capabilities.rs'), 'utf8');
+  const parseEnum = (name) => {
+    const start = rust.indexOf(`pub enum ${name} {`);
+    assert.notEqual(start, -1, `enum ${name} not found in capabilities.rs`);
+    const bodyStart = rust.indexOf('{', start);
+    let depth = 0, bodyEnd = -1;
+    for (let i = bodyStart; i < rust.length; i++) {
+      if (rust[i] === '{') depth++;
+      if (rust[i] === '}' && --depth === 0) { bodyEnd = i; break; }
+    }
+    const modes = {};
+    for (const match of rust.slice(bodyStart + 1, bodyEnd).matchAll(/^\s*(\w+)(?:\s*\{([^}]*)\})?,/gm)) {
+      const mode = match[1][0].toLowerCase() + match[1].slice(1);
+      modes[mode] = match[2] ? [...match[2].matchAll(/(\w+):\s*String/g)].map(field => field[1]).sort() : [];
+    }
+    return modes;
+  };
+  const lib = readFileSync(join(import.meta.dirname, 'hq-live-lib.mjs'), 'utf8');
+  const marker = 'Object.entries({';
+  const open = lib.indexOf(marker);
+  assert.notEqual(open, -1, 'mode table not found in hq-live-lib.mjs');
+  let depth = 1, close = -1;
+  for (let i = open + marker.length; i < lib.length; i++) {
+    if (lib[i] === '{') depth++;
+    if (lib[i] === '}' && --depth === 0) { close = i; break; }
+    assert.ok(i < lib.length - 1, 'unbalanced mode table');
+  }
+  const table = new Function(`return ${lib.slice(open + marker.length - 1, close + 1)}`)();
+  for (const modeMap of Object.values(table)) for (const fields of Object.values(modeMap)) fields.sort();
+  const rustSide = { systemPrompt: parseEnum('SystemPrompt'), skills: parseEnum('SkillsDiscovery'), lifecycle: parseEnum('Lifecycle') };
+  assert.deepEqual(table, rustSide);
+  // self-check, so the gate cannot silently degrade: injected drift must trip it
+  const drifted = structuredClone(rustSide);
+  drifted.skills.conventionAt = [];
+  assert.throws(() => assert.deepEqual(table, drifted));
+});
diff --git a/src-tauri/resources/agent-defaults.json b/src-tauri/resources/agent-defaults.json
index 37a8891..2832868 100644
--- a/src-tauri/resources/agent-defaults.json
+++ b/src-tauri/resources/agent-defaults.json
@@ -45,7 +45,7 @@
     {
       "id": "opencode", "name": "OpenCode", "command": "opencode", "args": [],
       "caps": {
-        "systemPrompt": { "mode": "unsupported" }, "skills": { "mode": "unsupported" },
+        "systemPrompt": { "mode": "unsupported" }, "skills": { "mode": "conventionAt", "dir": ".agents/skills" },
         "lifecycle": { "mode": "heuristic" },
         "dialect": { "permission": [], "quota": [], "contextLabels": [] }, "readinessMarker": "Ask anything"
       },
@@ -55,7 +55,7 @@
     {
       "id": "opencode-glm-53-flash", "name": "OpenCode GLM 5.3 Flash", "command": "opencode", "args": ["-m", "opencode-go/glm-5.3-flash"],
       "caps": {
-        "systemPrompt": { "mode": "unsupported" }, "skills": { "mode": "unsupported" },
+        "systemPrompt": { "mode": "unsupported" }, "skills": { "mode": "conventionAt", "dir": ".agents/skills" },
         "lifecycle": { "mode": "heuristic" },
         "dialect": { "permission": [], "quota": [], "contextLabels": [] }, "readinessMarker": "Ask anything"
       },
diff --git a/src-tauri/src/profiles.rs b/src-tauri/src/profiles.rs
index 1ad44a5..3a2df7a 100644
--- a/src-tauri/src/profiles.rs
+++ b/src-tauri/src/profiles.rs
@@ -511,6 +511,41 @@ mod tests {
         }
     }
 
+    /// W1-18b (probe 2026-09-25): the
+    /// installed OpenCode 1.18.32 lists a canary living in the probe
+    /// workspace's `.agents/skills` from `debug skill --pure` - an
+    /// observation, not a configuration guess - so both opencode profiles
+    /// declare `ConventionAt`. Only the bare `opencode` invocation was probed;
+    /// that the glm variant (same binary, `-m` model flag) discovers the same
+    /// way is an assumption: `--pure` makes no model call. Codex stays
+    /// `Unsupported`: its re-probe waits out the rate limit (2026-09-30),
+    /// and this assert keeps anyone from lifting it along by accident.
+    #[test]
+    fn opencode_profiles_read_repo_skills_at_agents_skills() {
+        for id in ["opencode", "opencode-glm-53-flash"] {
+            let profile = default_profiles()
+                .into_iter()
+                .find(|profile| profile.id == id)
+                .expect(id);
+            assert_eq!(
+                profile.caps.skills,
+                SkillsDiscovery::ConventionAt {
+                    dir: ".agents/skills".into()
+                },
+                "{id}"
+            );
+        }
+        let codex = default_profiles()
+            .into_iter()
+            .find(|profile| profile.id == "codex")
+            .expect("codex");
+        assert_eq!(
+            codex.caps.skills,
+            SkillsDiscovery::Unsupported,
+            "codex is not re-probed yet (W1-18b, rate limit until 2026-09-30)"
+        );
+    }
+
     /// The codex composer prompt "Ask Codex to do anything" and its echo of
     /// typed input were captured on a real TUI on 2026-09-14; its startup
     /// dialog chain (trust, hooks review) swallows blind writes, so the
@@ -593,10 +628,14 @@ mod tests {
             .expect("opencode-glm-53-flash profile exists");
         assert_eq!(profile.command, "opencode");
         assert_eq!(profile.args, vec!["-m", "opencode-go/glm-5.3-flash"]);
-        // Cautious defaults except the readiness marker (NT-17).
+        // Cautious defaults except the readiness marker (NT-17) and the
+        // probed skill discovery (W1-18b, same binary as `opencode`).
         assert_eq!(
             profile.caps,
             AgentCapabilities {
+                skills: SkillsDiscovery::ConventionAt {
+                    dir: ".agents/skills".into()
+                },
                 readiness_marker: Some("Ask anything".into()),
                 ..AgentCapabilities::default()
             }
@@ -943,10 +982,13 @@ mod tests {
         assert_eq!(
             glm.caps,
             AgentCapabilities {
+                skills: SkillsDiscovery::ConventionAt {
+                    dir: ".agents/skills".into()
+                },
                 readiness_marker: Some("Ask anything".into()),
                 ..AgentCapabilities::default()
             },
-            "an opencode-* variant inherits the base's readiness marker"
+            "an opencode-* variant inherits the base's readiness marker and its probed skill discovery"
         );
     }
 
```
