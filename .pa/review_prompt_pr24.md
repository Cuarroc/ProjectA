# Review request PR #24 (W5-02a): coordinators run without a write path

You are an independent reviewer (not the author; the author is a Claude model).
Review the COMPLETE candidate below for correctness bugs, gaps against the
requirements, and safety regressions. Be concrete: cite file and line, say what
breaks and when. Rate each finding high/medium/low. Do not restate the diff. If
something is fine, say nothing about it. Answer in English or German. This is a
READ-ONLY review: do not modify any files.

## Context

Repo: ProjectA, a Tauri 2 "agentic terminal" (Rust backend in src-tauri/, public
GitHub repo). Workers are agent CLI processes, each in its own git worktree.
Two worker kinds are "coordinators": the orchestrator and the queen. They plan
and dispatch work through the `pa` CLI; by invariant I3 a coordinator delegates
and never commits. Until now a coordinator ran with the project's repository as
its working directory, so it had a write path into the tree (and the
orchestrator prompt even told it to append to MEMORY.md in the repo root).

## Package requirement

W5-02a: coordinators run without a write path.
1. Orchestrator and queen start under the `strict` environment isolation (no
   token, no credential helper, no ssh) - applied to the ROUTED profile, so a
   routing failover cannot swap in a weaker profile - on create and on respawn.
2. Their working directory is an empty private directory outside the project's
   repository and outside every git checkout
   (`<app data>/hooks-cwd/<worker id>`), on create and on respawn.
3. A continuous run dispatched in the coordinator role is refused before a
   worktree exists.
4. The orchestrator prompt no longer instructs appending to MEMORY.md; both
   coordinator prompts state the repository path and the missing write path.
Known, documented limit: same OS user, so a deliberate `git -C <repo> commit`
still works locally (it cannot be pushed); the hard boundary is a later package
(W5-02e). Scouts are out of scope.

Hunt for: paths where a coordinator still gets the repo (or a worktree) as cwd
or a non-strict environment; respawn ordering bugs (state destroyed before a
refusal, leaked session/worker rows/files on the error paths); the
`ensure_outside_checkouts` guard being bypassable or wrongly refusing (symlinks,
UNC/`\?\` paths on Windows after canonicalize, `.git` detection); the
coordinator-role refusal missing a launch path; tests that pass for the wrong
reason or would not fail without the fix; prompt text contradicting behaviour.

## Diff (git diff origin/main...HEAD, single commit 639a1d7)

```diff
diff --git a/docs/decisions.md b/docs/decisions.md
index 6be5287..c4abeef 100644
--- a/docs/decisions.md
+++ b/docs/decisions.md
@@ -1369,3 +1369,21 @@ minutes are billed twice on private repos, so Windows alone was ~2850 of
   manuell und damit nicht wiederholbar — Zurücknehmen: nie das Verdikt als
   Funktion; der Treiber darf durch einen `pa`-Unterbefehl ersetzt werden,
   sobald der Daemon (W5-31b) die Sandboxes selbst verwaltet.
+
+## 2026-09-25 - W5-02a: coordinators run without a write path
+
+- **Coordinator without a write path (W5-02a):** orchestrator and
+  queen start under the `strict` environment (applied to the *routed*
+  profile, so a failover cannot weaken it) in an empty directory
+  `<app data>/hooks-cwd/<worker id>` outside the repository and every
+  checkout, on create and on respawn; a continuous run dispatched in the
+  coordinator role is refused before a worktree exists. The orchestrator
+  prompt no longer tells it to append to `MEMORY.md` in the repository root -
+  that was a write path into the tree; reading stays. Why: I3 (the
+  coordinator delegates, it never commits). Limit: same OS user, so a
+  deliberate `git -C <repo> commit` still works locally (it cannot be pushed:
+  no token, no credential helper) - the hard boundary is W5-02e. Scouts are
+  not covered: their result channel is a file in the repository root
+  (`SCOUT_FILE`), so they need a store channel first. Reverse when: a
+  coordinator needs a repository-side memory again - then via a worker task,
+  not a coordinator write.
diff --git a/src-tauri/src/hooks.rs b/src-tauri/src/hooks.rs
index e989451..4919da6 100644
--- a/src-tauri/src/hooks.rs
+++ b/src-tauri/src/hooks.rs
@@ -703,6 +703,25 @@ pub fn write_worker_file(
     Ok(path)
 }
 
+/// The working directory of one coordinator (W5-02a): an empty, private
+/// directory `<app data>/hooks-cwd/<worker_id>`, next to the hooks directory
+/// but not in it - that one holds every worker's hook secret. It is outside
+/// the project's repository and every worktree by construction; the caller
+/// still checks that before the agent starts. The same id gets the same
+/// directory back on a respawn.
+pub fn coordinator_dir(worker_id: &str) -> Result<PathBuf, String> {
+    let hooks = settings_dir();
+    let name = hooks
+        .file_name()
+        .map(|name| name.to_string_lossy().into_owned())
+        .unwrap_or_else(|| "hooks".to_string());
+    let root = hooks.with_file_name(format!("{name}-cwd"));
+    ensure_private_dir(&root)?;
+    let dir = root.join(worker_id);
+    ensure_private_dir(&dir)?;
+    Ok(dir)
+}
+
 /// Delete every generated file of one worker. Best effort - leftovers are
 /// harmless, but a respawn must never inherit a previous generation's files,
 /// so this runs on archive AND before each respawn.
diff --git a/src-tauri/src/profiles.rs b/src-tauri/src/profiles.rs
index 1ad44a5..32d00ea 100644
--- a/src-tauri/src/profiles.rs
+++ b/src-tauri/src/profiles.rs
@@ -53,6 +53,19 @@ pub struct AgentProfile {
     pub env_policy: EnvPolicy,
 }
 
+impl AgentProfile {
+    /// This profile as a coordinator runs it (W5-02a): whatever isolation the
+    /// profile or `agents.json` asked for, the coordinator gets `strict` - no
+    /// token, no credential helper, no ssh. It plans and dispatches through
+    /// `pa`; a `git push` or `gh` call from it must fail instead of asking.
+    /// Applied after routing, because a failover may swap the profile.
+    pub fn for_coordinator(&self) -> AgentProfile {
+        let mut profile = self.clone();
+        profile.env_policy.isolation = EnvIsolation::Strict;
+        profile
+    }
+}
+
 /// How much of the app's environment reaches an agent process (W5-02b).
 #[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
 pub struct EnvPolicy {
@@ -680,6 +693,25 @@ mod tests {
         assert_eq!(stored.env_policy.isolation, EnvIsolation::Allowlist);
     }
 
+    /// W5-02a: a coordinator is strict whatever its profile asked for - even
+    /// a profile the user put back to `inherit` - and only the level changes.
+    #[test]
+    fn a_coordinator_profile_is_strict_whatever_it_asked_for() {
+        let mut profile = default_profiles()
+            .into_iter()
+            .find(|p| p.id == "claude")
+            .expect("claude");
+        profile.env_policy = EnvPolicy {
+            isolation: EnvIsolation::Inherit,
+            passthrough: vec!["MOONSHOT_API_KEY".into()],
+        };
+        let coordinator = profile.for_coordinator();
+        assert_eq!(coordinator.env_policy.isolation, EnvIsolation::Strict);
+        assert_eq!(coordinator.env_policy.passthrough, ["MOONSHOT_API_KEY"]);
+        assert_eq!(coordinator.command, profile.command);
+        assert_eq!(profile.env_policy.isolation, EnvIsolation::Inherit);
+    }
+
     /// W5-02b6: `envPolicy` is how an entry goes back to `inherit` now that
     /// the default is `allowlist`, so the diagnostics must not call it an
     /// ignored field. A really unknown key still warns.
diff --git a/src-tauri/src/workers.rs b/src-tauri/src/workers.rs
index 870916d..da9ce43 100644
--- a/src-tauri/src/workers.rs
+++ b/src-tauri/src/workers.rs
@@ -349,6 +349,17 @@ async fn create_worker_impl(
     if launch.is_none() {
         crate::routing::ensure_spawnable(store).await?;
     }
+    // W5-02a: the worktree is a coordinator's write path, so a run dispatched
+    // in the coordinator role gets none. Refused before anything is created,
+    // and not settled by a role check later: the checkout would already exist.
+    if let Some(context) = launch {
+        let role = store.development_run_role(context.run_id).await?;
+        if role == crate::store::development_launches::DispatchRole::Coordinator {
+            return Err(format!(
+                "{ERR_REFUSED}a coordinator run gets no checkout: the coordinator has no write path"
+            ));
+        }
+    }
     let variant = resolve_role_variant(store, profile_id, role_variant_id).await?;
     let variant_name = variant.as_ref().map(|variant| variant.name.as_str());
 
@@ -747,19 +758,25 @@ pub async fn create_orchestrator(
         &worker_id,
     )
     .await?;
-    let profile = routed.profile;
+    // W5-02a: strict environment, applied to the *routed* profile (a failover
+    // may have swapped it), and a working directory outside every checkout.
+    let profile = routed.profile.for_coordinator();
     let env = routed.env;
-    crate::routing::prepare_codex_home(&profile, Path::new(&project.repo_path));
+    let cwd = match coordinator_cwd(&worker_id, &project) {
+        Ok(cwd) => cwd,
+        Err(err) => {
+            let _ = store.delete_worker(&worker_id).await;
+            crate::hooks::remove_worker_files(&worker_id);
+            return Err(err);
+        }
+    };
+    crate::routing::prepare_codex_home(&profile, &cwd);
     log_message(store, &worker_id, MSG_SYSTEM, &routed.attribution);
     // Bound before the child starts, like every spawn path: an agent that
     // exits at once must still be found by the exit hook.
-    let session_id = match agents.spawn_bound(
-        &worker_id,
-        &profile,
-        Path::new(&project.repo_path),
-        &env,
-        &|session_id| store.bind_session_in_memory(&worker_id, session_id),
-    ) {
+    let session_id = match agents.spawn_bound(&worker_id, &profile, &cwd, &env, &|session_id| {
+        store.bind_session_in_memory(&worker_id, session_id)
+    }) {
         Ok(session_id) => session_id,
         Err(err) => {
             let _ = store.take_session(&worker_id);
@@ -980,19 +997,25 @@ pub async fn create_queen_as_role(
         &worker_id,
     )
     .await?;
-    let profile = routed.profile;
+    // W5-02a, as for the orchestrator: strict environment on the routed
+    // profile, working directory outside every checkout.
+    let profile = routed.profile.for_coordinator();
     let env = routed.env;
-    crate::routing::prepare_codex_home(&profile, Path::new(&project.repo_path));
+    let cwd = match coordinator_cwd(&worker_id, &project) {
+        Ok(cwd) => cwd,
+        Err(err) => {
+            let _ = store.delete_worker(&worker_id).await;
+            crate::hooks::remove_worker_files(&worker_id);
+            return Err(err);
+        }
+    };
+    crate::routing::prepare_codex_home(&profile, &cwd);
     log_message(store, &worker_id, MSG_SYSTEM, &routed.attribution);
     // Bound before the child starts, like every spawn path: an agent that
     // exits at once must still be found by the exit hook.
-    let session_id = match agents.spawn_bound(
-        &worker_id,
-        &profile,
-        Path::new(&project.repo_path),
-        &env,
-        &|session_id| store.bind_session_in_memory(&worker_id, session_id),
-    ) {
+    let session_id = match agents.spawn_bound(&worker_id, &profile, &cwd, &env, &|session_id| {
+        store.bind_session_in_memory(&worker_id, session_id)
+    }) {
         Ok(session_id) => session_id,
         Err(err) => {
             let _ = store.take_session(&worker_id);
@@ -1227,8 +1250,9 @@ fn orchestrator_profile(
         profile,
         worker_id,
         format!(
-            "{}\n\n{}",
+            "{}\n\n{}\n\n{}",
             orchestrator_system_prompt(&project.name, &project.id),
+            coordinator_scope_block(project),
             ask_guidance(&project.id, worker_id)
         ),
     )
@@ -1251,14 +1275,74 @@ fn queen_profile(
     playbook: Option<&str>,
 ) -> Result<AgentProfile, String> {
     let mut prompt = queen_system_prompt(&project.name, &project.id, domain, worker_id);
+    let scope = coordinator_scope_block(project);
     let ask = ask_guidance(&project.id, worker_id);
-    for block in [Some(ask.as_str()), role, playbook].into_iter().flatten() {
+    for block in [Some(scope.as_str()), Some(ask.as_str()), role, playbook]
+        .into_iter()
+        .flatten()
+    {
         prompt.push_str("\n\n");
         prompt.push_str(block);
     }
     with_system_prompt(profile, worker_id, prompt)
 }
 
+/// Refuse `dir` unless it provably lies outside `repo` and outside every git
+/// checkout: no ancestor may hold a `.git` (a directory or, in a linked
+/// worktree, a file). A directory that cannot be resolved is refused too - a
+/// coordinator's working directory is only ever one this vouches for.
+fn ensure_outside_checkouts(dir: &Path, repo: &Path) -> Result<(), String> {
+    let resolved = std::fs::canonicalize(dir).map_err(|e| {
+        format!(
+            "{ERR_REFUSED}coordinator directory {} cannot be resolved: {e}",
+            dir.display()
+        )
+    })?;
+    if let Ok(repo) = std::fs::canonicalize(repo) {
+        if resolved.starts_with(&repo) {
+            return Err(format!(
+                "{ERR_REFUSED}coordinator directory {} lies inside the repository",
+                resolved.display()
+            ));
+        }
+    }
+    if let Some(checkout) = resolved
+        .ancestors()
+        .find(|ancestor| ancestor.join(".git").exists())
+    {
+        return Err(format!(
+            "{ERR_REFUSED}coordinator directory {} lies inside the checkout {}",
+            resolved.display(),
+            checkout.display()
+        ));
+    }
+    Ok(())
+}
+
+/// Where a coordinator of `project` runs (W5-02a, I3): an empty directory
+/// outside the repository and outside every worktree, so nothing it types
+/// lands in a tree by default, and - with [`AgentProfile::for_coordinator`]
+/// applied to the routed profile - nothing it commits can be pushed.
+fn coordinator_cwd(worker_id: &str, project: &Project) -> Result<PathBuf, String> {
+    let dir = crate::hooks::coordinator_dir(worker_id)?;
+    ensure_outside_checkouts(&dir, Path::new(&project.repo_path))?;
+    Ok(dir)
+}
+
+/// What a coordinator is told about the directory it now runs in and about
+/// the write path it does not have. The repository path is given because it
+/// is no longer the working directory, and reading it is still the job.
+fn coordinator_scope_block(project: &Project) -> String {
+    format!(
+        "ARBEITSVERZEICHNIS UND SCHREIBRECHTE\n\
+         - Das Repository liegt unter {}. Dein Arbeitsverzeichnis liegt bewusst\n\
+         \x20 AUSSERHALB davon; das Repository darfst du nur lesen (absoluter Pfad).\n\
+         - Du hast KEIN Schreibpfad: kein commit, kein push, kein `gh`, keine Datei im\n\
+         \x20 Repository. Was sich aendern soll, uebernimmt ein Worker.",
+        project.repo_path
+    )
+}
+
 /// `profile`, plus `prompt` delivered the way its CLI takes a system prompt.
 ///
 /// How the prompt travels depends on the profile's capability: as a direct
@@ -1355,8 +1439,6 @@ pub fn orchestrator_system_prompt(project_name: &str, project_id: &str) -> Strin
          - Lesen darfst du: Repository durchsehen, um gute Aufgaben zu schneiden.\n\
          - Du antwortest kurz und auf Deutsch.\n\
          - Lies zu Beginn einer Sitzung im Projektwurzelverzeichnis `MEMORY.md`, falls die Datei existiert.\n\
-         - Haenge am Ende jeder abgeschlossenen Arbeitseinheit dauerhafte Entscheidungen, Learnings und\n\
-         \x20 Konventionen kurz und auf Deutsch an `MEMORY.md` im Projektwurzelverzeichnis an.\n\
          \n\
          PROJEKT-GEDAECHTNIS (ruflo)\n\
          - Du und alle Worker teilen ein gemeinsames Gedaechtnis (ruflo-MCP, Namespace\n\
@@ -2596,6 +2678,23 @@ pub async fn respawn_worker(
         return Err(format!("worktree is missing: {}", worker.worktree_path));
     }
 
+    // One read for the three things that need it below: the coordinator
+    // prompts, the playbook, and the shared ruflo environment.
+    let project = store.get_project(&worker.project_id).await?;
+    // W5-02a: an orchestrator or queen comes back the way it was made - not in
+    // the repository its row still names, but in a directory outside every
+    // checkout. Resolved before anything is taken apart, so a coordinator whose
+    // project is gone or whose directory cannot be vouched for is a no-op
+    // refusal, never a killed session and a half-started agent.
+    let coordinator_dir = if matches!(worker.kind.as_str(), KIND_ORCHESTRATOR | KIND_QUEEN) {
+        let project = project.as_ref().ok_or_else(|| {
+            format!("{ERR_REFUSED}coordinator {worker_id} has no project to run under")
+        })?;
+        Some(coordinator_cwd(worker_id, project)?)
+    } else {
+        None
+    };
+
     // A stale session would keep writing into a terminal nobody reads.
     if let Some(stale) = store.take_session(worker_id) {
         agents.kill(&stale);
@@ -2607,9 +2706,6 @@ pub async fn respawn_worker(
     // the spawn arguments point at.
     crate::hooks::remove_worker_files(worker_id);
 
-    // One read for the three things that need it below: the coordinator
-    // prompts, the playbook, and the shared ruflo environment.
-    let project = store.get_project(&worker.project_id).await?;
     let variant = revive_role_variant(
         store,
         worker_id,
@@ -2676,16 +2772,20 @@ pub async fn respawn_worker(
         worker_id,
     )
     .await?;
-    let profile = routed.profile;
+    // Strict environment on the *routed* profile: a failover may have swapped it.
+    let (profile, cwd) = match coordinator_dir {
+        Some(dir) => (routed.profile.for_coordinator(), dir),
+        None => (routed.profile, path.to_path_buf()),
+    };
     let env = routed.env;
-    crate::routing::prepare_codex_home(&profile, path);
+    crate::routing::prepare_codex_home(&profile, &cwd);
     log_message(store, worker_id, MSG_SYSTEM, &routed.attribution);
     // Bound before the child starts, like every spawn path: an agent that
     // exits at once must still be found by the exit hook.
     let session_id = match agents.spawn_bound(
         worker_id,
-        &with_skills_flag(&profile, path),
-        path,
+        &with_skills_flag(&profile, &cwd),
+        &cwd,
         &env,
         &|session_id| store.bind_session_in_memory(worker_id, session_id),
     ) {
@@ -3057,6 +3157,8 @@ mod tests {
         args: Mutex<Vec<Vec<String>>>,
         /// The per-worker environment of every spawn (shared ruflo memory).
         envs: Mutex<Vec<Vec<(String, String)>>>,
+        /// The environment isolation level of every spawned profile (W5-02a).
+        isolations: Mutex<Vec<crate::profiles::EnvIsolation>>,
         killed: Mutex<Vec<String>>,
         task_deliveries: Mutex<Vec<(String, String, String)>>,
         /// `(sessionId, text)` of every write, keystrokes included.
@@ -3122,6 +3224,10 @@ mod tests {
             }
             self.args.lock().unwrap().push(profile.args.clone());
             self.envs.lock().unwrap().push(env.to_vec());
+            self.isolations
+                .lock()
+                .unwrap()
+                .push(profile.env_policy.isolation);
             let mut spawned = self.spawned.lock().unwrap();
             spawned.push((profile.id.clone(), cwd.to_string_lossy().into_owned()));
             Ok(format!("pty-fake-{}", spawned.len()))
@@ -5667,10 +5773,11 @@ mod tests {
         assert_eq!(worker.status, STATUS_RUNNING);
         assert_eq!(worker.session_id.as_deref(), Some("pty-fake-1"));
 
-        // No branch, and no checkout: the agent runs in the repository itself.
+        // No branch, and no checkout: the row keeps naming the project's
+        // repository, but since W5-02a the agent does not run in it.
         assert!(worker.branch.is_empty(), "{}", worker.branch);
         assert_eq!(worker.worktree_path, fx.repo);
-        assert_eq!(agents.spawned.lock().unwrap()[0].1, fx.repo);
+        assert_ne!(agents.spawned.lock().unwrap()[0].1, fx.repo);
         let worktrees = fx._dir.path().join(worktree::WORKTREES_DIR);
         assert!(
             !worktrees.exists(),
@@ -5684,6 +5791,181 @@ mod tests {
         assert_eq!(stored.kind, KIND_ORCHESTRATOR);
     }
 
+    /// Whether `dir` or any ancestor of it is a git checkout - a worktree in
+    /// the sense of "somewhere a commit can be made".
+    fn inside_a_checkout(dir: &Path) -> bool {
+        dir.ancestors().any(|dir| dir.join(".git").exists())
+    }
+
+    /// W5-02a, I3: a coordinator never runs where it could commit. Orchestrator
+    /// and queen both start outside the project's repository and outside every
+    /// checkout, under the strict environment (no token, no credential helper),
+    /// on the first spawn and on a respawn from the archive alike.
+    #[tokio::test]
+    async fn a_coordinator_starts_outside_every_checkout_without_credentials() {
+        use crate::profiles::EnvIsolation;
+        let fx = fixture("coordinator-no-write").await;
+        let agents = FakeAgents::default();
+
+        let orchestrator = create_orchestrator(&fx.store, &agents, &fx.project_id, None)
+            .await
+            .unwrap();
+        let queen = create_queen(&fx.store, &agents, &fx.project_id, "Backend", None, None)
+            .await
+            .unwrap();
+        archive_worker(&fx.store, &agents, &orchestrator.id)
+            .await
+            .unwrap();
+        respawn_worker(&fx.store, &agents, &orchestrator.id)
+            .await
+            .unwrap();
+        archive_worker(&fx.store, &agents, &queen.id).await.unwrap();
+        respawn_worker(&fx.store, &agents, &queen.id).await.unwrap();
+
+        let spawned = agents.spawned.lock().unwrap().clone();
+        assert_eq!(spawned.len(), 4);
+        for (_, cwd) in &spawned {
+            let cwd = Path::new(cwd);
+            assert!(cwd.is_dir(), "{} does not exist", cwd.display());
+            assert!(
+                !cwd.starts_with(&fx.repo),
+                "{} is in the repo",
+                cwd.display()
+            );
+            assert!(
+                !inside_a_checkout(cwd),
+                "{} is in a checkout",
+                cwd.display()
+            );
+        }
+        assert_eq!(
+            *agents.isolations.lock().unwrap(),
+            vec![EnvIsolation::Strict; 4],
+            "a coordinator must not inherit a token or a credential helper"
+        );
+        // The row keeps naming the project, so the board and the archive path
+        // behave as before; only the process moved.
+        let stored = fx
+            .store
+            .get_worker(&orchestrator.id)
+            .await
+            .unwrap()
+            .unwrap();
+        assert_eq!(stored.worktree_path, fx.repo);
+    }
+
+    /// An ordinary worker is not a coordinator: it keeps its worktree and the
+    /// environment its profile names.
+    #[tokio::test]
+    async fn an_ordinary_worker_keeps_its_checkout_and_environment() {
+        use crate::profiles::EnvIsolation;
+        let fx = fixture("worker-unchanged").await;
+        let agents = FakeAgents::default();
+
+        let worker = create_worker(&fx.store, &agents, &fx.project_id, "task", "claude", None)
+            .await
+            .unwrap();
+
+        let cwd = agents.spawned.lock().unwrap()[0].1.clone();
+        assert_eq!(cwd, worker.worktree_path);
+        assert_ne!(
+            agents.isolations.lock().unwrap()[0],
+            EnvIsolation::Strict,
+            "strict would break a worker's own push"
+        );
+    }
+
+    #[test]
+    fn a_coordinator_directory_inside_a_checkout_is_refused() {
+        let dir = TempDir::new("coordinator-dir-guard");
+        let repo = init_repo(&dir.path().join("repo"));
+        let nested = repo.join("sub");
+        std::fs::create_dir_all(&nested).unwrap();
+        let outside = dir.path().join("elsewhere");
+        std::fs::create_dir_all(&outside).unwrap();
+
+        assert!(ensure_outside_checkouts(&repo, &repo).is_err());
+        assert!(ensure_outside_checkouts(&nested, &repo).is_err());
+        assert!(ensure_outside_checkouts(&outside, &repo).is_ok());
+        assert!(
+            ensure_outside_checkouts(&dir.path().join("missing"), &repo).is_err(),
+            "a directory that does not exist cannot be vouched for"
+        );
+    }
+
+    /// The prompt must not promise a write path the process no longer has, and
+    /// must say where the repository is now that the working directory is not it.
+    #[test]
+    fn the_coordinator_prompts_hand_out_no_write_path_into_the_repository() {
+        let orchestrator = orchestrator_system_prompt("ProjectA", "pj-1");
+        assert!(
+            !orchestrator.contains("an `MEMORY.md`"),
+            "the orchestrator is still told to append to MEMORY.md: {orchestrator}"
+        );
+        assert!(
+            !orchestrator.contains("am Ende jeder abgeschlossenen Arbeitseinheit"),
+            "{orchestrator}"
+        );
+        let project = Project {
+            id: "pj-1".into(),
+            name: "ProjectA".into(),
+            repo_path: "C:/repos/projecta".into(),
+            landing_page_markdown: None,
+            max_workers: None,
+            test_command: None,
+            created_at: 0,
+        };
+        let scope = coordinator_scope_block(&project);
+        assert!(scope.contains("C:/repos/projecta"), "{scope}");
+        assert!(scope.contains("KEIN Schreibpfad"), "{scope}");
+    }
+
+    /// W5-02a on the continuous path: a run dispatched in the coordinator role
+    /// gets no checkout at all - the worktree is the write path.
+    #[tokio::test]
+    async fn a_coordinator_role_run_is_refused_before_a_worktree_exists() {
+        let fx = fixture("coordinator-run-refused").await;
+        let launch = reserved_launch(&fx).await;
+        let route = development_route::test_route(profiles::find_profile("claude").unwrap());
+        let descriptor = fx._dir.path().join("descriptor.json");
+        let context = development::LaunchContext {
+            run_id: &launch.run_id,
+            owner: "owner",
+            fence: 1,
+            worker_id: &launch.worker_id,
+            descriptor: &descriptor,
+            bind_credentials: &|_| Ok(()),
+            route: &route,
+        };
+        let pool = sqlx::SqlitePool::connect(&format!(
+            "sqlite:{}",
+            fx._dir.path().join("projecta.db").display()
+        ))
+        .await
+        .unwrap();
+        sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES('task','development','coordinator','owner',1,1,1)")
+            .execute(&pool).await.unwrap();
+        pool.close().await;
+        let agents = FakeAgents::default();
+
+        let err = create_worker_impl(
+            &fx.store,
+            &agents,
+            &fx.project_id,
+            "plan",
+            "claude",
+            None,
+            None,
+            Some(&context),
+        )
+        .await
+        .unwrap_err();
+
+        assert!(err.contains("coordinator"), "{err}");
+        assert_eq!(agents.spawn_count(), 0);
+        assert!(!fx._dir.path().join(worktree::WORKTREES_DIR).exists());
+    }
+
     /// [`log_message`] writes on Tauri's runtime, so the row lands a moment
     /// after the call returns. Poll for it rather than guess at a sleep.
     async fn wait_for_user_message(store: &Store, worker_id: &str) -> String {
@@ -6145,10 +6427,11 @@ mod tests {
         assert_eq!(worker.session_id.as_deref(), Some("pty-fake-1"));
         assert_eq!(worker.spawned_by.as_deref(), Some("wk-orch"));
 
-        // Like the orchestrator: no branch, no checkout, the repository itself.
+        // Like the orchestrator: no branch, no checkout, and not run in the
+        // repository (W5-02a).
         assert!(worker.branch.is_empty(), "{}", worker.branch);
         assert_eq!(worker.worktree_path, fx.repo);
-        assert_eq!(agents.spawned.lock().unwrap()[0].1, fx.repo);
+        assert_ne!(agents.spawned.lock().unwrap()[0].1, fx.repo);
         let worktrees = fx._dir.path().join(worktree::WORKTREES_DIR);
         assert!(
             !worktrees.exists(),
@@ -6441,10 +6724,6 @@ mod tests {
         assert!(prompt.contains("ProjectA"), "{prompt}");
         assert!(prompt.contains("Lies zu Beginn einer Sitzung"), "{prompt}");
         assert!(prompt.contains("`MEMORY.md`"), "{prompt}");
-        assert!(
-            prompt.contains("am Ende jeder abgeschlossenen Arbeitseinheit"),
-            "{prompt}"
-        );
         assert_eq!(orchestrator_task("ProjectA"), "Orchestrator for ProjectA");
     }
 
```
