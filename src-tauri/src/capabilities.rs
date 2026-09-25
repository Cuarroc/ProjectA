//! Capability descriptors: what a CLI agent can do and how to ask it.
//!
//! Phase 7.x taught ProjectA that "an agent" is not one shape: Claude Code
//! takes a system prompt as an argument, Kimi wants a file; Claude finds
//! skills by convention, Kimi needs a flag; only Claude reports its own
//! lifecycle. These types make that variance data, so no module has to know
//! an agent by name.

use serde::{Deserialize, Serialize};

/// How a system prompt is injected into the CLI at spawn time.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum SystemPrompt {
    /// The CLI has no way to take a system prompt. Orchestrators refuse this.
    #[default]
    Unsupported,
    /// The prompt text is passed directly: `<flag> <text>`.
    Arg { flag: String },
    /// The prompt is written to a per-worker file: `<flag> <path>`.
    File { flag: String, ext: String },
}

/// How the CLI discovers the skill packs installed into a worktree.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum SkillsDiscovery {
    /// The CLI cannot read skills; packs are not even copied.
    #[default]
    Unsupported,
    /// The CLI finds `.claude/skills` on its own.
    Convention,
    /// The CLI is pointed at the directory: `<flag> <path>`.
    Flag { flag: String },
    /// The CLI finds the packs on its own, but under a directory of its own
    /// naming instead of `.claude/skills`. The Codex family reads
    /// `<project>/.agents/skills` for every directory between the project root
    /// and the working directory - `AGENTS_DIR_NAME` / `SKILLS_DIR_NAME` in
    /// openinterpreter's `codex-rs/ext/skills/src/host_roots.rs`.
    ///
    /// `dir` is relative to the worktree, so `.agents/skills` here means the
    /// same place `Convention` would mean if it were spelled out.
    ConventionAt { dir: String },
}

/// How the board learns about this agent's lifecycle.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum Lifecycle {
    /// Output heuristics only; the board guesses.
    #[default]
    Heuristic,
    /// The CLI takes a generated settings file wiring hooks back to us.
    SettingsHooks { flag: String },
}

/// Agent-specific output phrases, extending the generic set, never replacing it.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Dialect {
    /// Lowercase substrings that mark a permission prompt.
    pub permission: Vec<String>,
    /// Lowercase substrings that mark a quota or rate-limit error.
    pub quota: Vec<String>,
    /// Labels in front of the context figure, for example `ctx:`.
    pub context_labels: Vec<String>,
}

/// Everything ProjectA needs to know to drive one CLI agent well.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentCapabilities {
    pub system_prompt: SystemPrompt,
    pub skills: SkillsDiscovery,
    pub lifecycle: Lifecycle,
    pub dialect: Dialect,
    /// The prompt text that proves this CLI's input loop is alive (OpenCode:
    /// "Ask anything"). NT-17: silence alone is not readiness - OpenCode
    /// flushes ConPTY input written before its loop runs, so the submit guard
    /// waits for this marker when it is known. Empty = silence heuristic.
    #[serde(default)]
    pub readiness_marker: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_the_cautious_variant_everywhere() {
        let caps = AgentCapabilities::default();
        assert_eq!(caps.system_prompt, SystemPrompt::Unsupported);
        assert_eq!(caps.skills, SkillsDiscovery::Unsupported);
        assert_eq!(caps.lifecycle, Lifecycle::Heuristic);
        assert!(caps.dialect.permission.is_empty());
        assert!(caps.dialect.quota.is_empty());
        assert!(caps.dialect.context_labels.is_empty());
        // An unconfigured agent has no known prompt marker: the guard keeps
        // its silence heuristic instead of guessing one.
        assert_eq!(caps.readiness_marker, None);
    }

    #[test]
    fn every_mode_round_trips_through_json() {
        let caps = AgentCapabilities {
            system_prompt: SystemPrompt::File {
                flag: "--agent-file".into(),
                ext: "md".into(),
            },
            skills: SkillsDiscovery::Flag {
                flag: "--skills-dir".into(),
            },
            lifecycle: Lifecycle::SettingsHooks {
                flag: "--settings".into(),
            },
            dialect: Dialect {
                permission: vec!["allow".into()],
                quota: vec![],
                context_labels: vec!["ctx:".into()],
            },
            readiness_marker: Some("Ask anything".into()),
        };
        let json = serde_json::to_string(&caps).expect("serialize");
        let back: AgentCapabilities = serde_json::from_str(&json).expect("parse");
        assert_eq!(back, caps);

        // `ConventionAt` carries a field the other skill modes do not, and it
        // is the one written into a hand-edited `agents.json` - the wire shape
        // is part of the contract, not an implementation detail.
        let at = SkillsDiscovery::ConventionAt {
            dir: ".agents/skills".into(),
        };
        let json = serde_json::to_string(&at).expect("serialize");
        assert_eq!(json, r#"{"mode":"conventionAt","dir":".agents/skills"}"#);
        assert_eq!(
            serde_json::from_str::<SkillsDiscovery>(&json).expect("parse"),
            at
        );
        assert_eq!(back, caps);
    }

    #[test]
    fn the_wire_shape_is_camel_case_with_mode_tags() {
        let json = serde_json::json!({
            "systemPrompt": { "mode": "arg", "flag": "--append-system-prompt" },
            "skills":       { "mode": "convention" },
            "lifecycle":    { "mode": "settingsHooks", "flag": "--settings" },
            "dialect":      { "contextLabels": ["ctx:"] }
        });
        let caps: AgentCapabilities =
            serde_json::from_value(json).expect("camelCase wire shape parses");
        assert_eq!(
            caps.system_prompt,
            SystemPrompt::Arg {
                flag: "--append-system-prompt".into()
            }
        );
        assert_eq!(
            caps.lifecycle,
            Lifecycle::SettingsHooks {
                flag: "--settings".into()
            }
        );
        assert_eq!(caps.dialect.context_labels, vec!["ctx:".to_string()]);
        assert!(caps.dialect.permission.is_empty());
    }

    #[test]
    fn a_typo_in_the_mode_tag_is_a_parse_error() {
        let json = r#"{ "systemPrompt": { "mode": "argh", "flag": "-x" } }"#;
        assert!(serde_json::from_str::<AgentCapabilities>(json).is_err());
    }
}
