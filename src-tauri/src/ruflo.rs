//! ruflo (claude-flow) integration: one shared memory store per project.
//!
//! ProjectA isolates every worker in its own git worktree. ruflo's memory,
//! left to itself, lives cwd-relative (`.swarm/memory.db`) - so each worker
//! would learn alone and forget on archive. Pointing `CLAUDE_FLOW_MEMORY_PATH`
//! at `<repo>/.pa/memory` instead makes every worker, scout and orchestrator
//! of a project read and write the same AgentDB store: what one worker
//! learned, the next one retrieves. `.pa/` is gitignored, so the store never
//! pollutes a diff.
//!
//! The variables are inert when no ruflo MCP server is configured for the
//! agent's CLI; setting them costs nothing and fails closed.

use std::path::{Path, PathBuf};

/// Env var the ruflo MCP server reads its memory directory from.
pub const MEMORY_PATH_ENV: &str = "CLAUDE_FLOW_MEMORY_PATH";

/// Env var tying ruflo telemetry to the ProjectA worker that caused it.
pub const SESSION_ENV: &str = "CLAUDE_FLOW_SESSION_ID";

/// The shared memory directory of a project: `<repo>/.pa/memory`.
pub fn project_memory_dir(repo_path: &Path) -> PathBuf {
    repo_path.join(".pa").join("memory")
}

/// Environment for one agent spawn: the project's shared memory plus the
/// worker id as the ruflo session. An orchestrator spawns in the repo root,
/// a worker in its worktree - both land in the same store.
///
/// Fails closed: if the directory cannot be created, no variables are set and
/// ruflo falls back to its cwd-local default. Memory is an accelerator, never
/// a reason for a spawn to fail.
pub fn agent_env(repo_path: &Path, worker_id: &str) -> Vec<(String, String)> {
    let dir = project_memory_dir(repo_path);
    if std::fs::create_dir_all(&dir).is_err() {
        return Vec::new();
    }
    vec![
        (
            MEMORY_PATH_ENV.to_string(),
            dir.to_string_lossy().into_owned(),
        ),
        (SESSION_ENV.to_string(), worker_id.to_string()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_dir_lives_under_the_gitignored_pa_dir() {
        let dir = project_memory_dir(Path::new("C:\\repo"));
        assert_eq!(dir, Path::new("C:\\repo").join(".pa").join("memory"));
    }

    #[test]
    fn agent_env_points_every_worker_at_the_same_store() {
        let tmp = std::env::temp_dir().join(format!("projecta-ruflo-test-{}", std::process::id()));
        let a = agent_env(&tmp, "wk-a");
        let b = agent_env(&tmp, "wk-b");
        let _ = std::fs::remove_dir_all(&tmp);

        let memory_of = |env: &[(String, String)]| {
            env.iter()
                .find(|(k, _)| k == MEMORY_PATH_ENV)
                .map(|(_, v)| v.clone())
        };
        assert_eq!(memory_of(&a), memory_of(&b));
        assert!(memory_of(&a).expect("memory path").ends_with("memory"));
        assert!(a.iter().any(|(k, v)| k == SESSION_ENV && v == "wk-a"));
        assert!(b.iter().any(|(k, v)| k == SESSION_ENV && v == "wk-b"));
    }

    #[test]
    fn an_uncreatable_dir_degrades_to_no_env() {
        // A file where a directory must be created makes create_dir_all fail.
        let tmp = std::env::temp_dir().join(format!("projecta-ruflo-block-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).expect("tmpdir");
        let blocker = tmp.join(".pa");
        std::fs::write(&blocker, "not a dir").expect("blocker file");
        let env = agent_env(&tmp, "wk-x");
        let _ = std::fs::remove_dir_all(&tmp);
        assert!(env.is_empty());
    }
}
