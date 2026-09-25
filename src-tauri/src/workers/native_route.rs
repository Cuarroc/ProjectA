//! The first native adapter has a deliberately explicit invocation grammar.
//! Unrecognized interactive/custom settings are reported, never discarded.
//! One recognized exception: the interactive readiness marker is inert
//! metadata for `exec --json` (no TUI), so it is preserved, not rejected.
use super::*;

pub(super) fn translate(
    mut profile: AgentProfile,
    candidate: &ModelCandidate,
) -> Result<AgentProfile, String> {
    use crate::capabilities::{Lifecycle, SkillsDiscovery, SystemPrompt};
    if candidate.provider != Provider::Codex {
        return Err("native JSON transport requires Codex".into());
    }
    // The readiness marker is deliberately absent from this list: it steers
    // the interactive submit guard only, and `codex exec --json` starts no
    // TUI, so the marker is inert here. It stays on the profile (preserved,
    // not discarded); settings that would change the invocation still refuse.
    if profile.fallback.is_some()
        || !matches!(profile.caps.system_prompt, SystemPrompt::Unsupported)
        || !matches!(profile.caps.lifecycle, Lifecycle::Heuristic)
        || matches!(profile.caps.skills, SkillsDiscovery::Flag { .. })
    {
        return Err("native Codex transport cannot use fallback, custom prompt/lifecycle or injected CLI flags".into());
    }
    if profile.env.keys().any(|key| {
        matches!(
            key.to_ascii_uppercase().as_str(),
            "OPENAI_API_KEY" | "OPENAI_BASE_URL" | "CODEX_API_KEY" | "ANTHROPIC_API_KEY"
        )
    }) {
        return Err("native subscription adapter rejects profile API billing overrides".into());
    }
    let mut owned = Vec::new();
    let mut sandbox_seen = false;
    let mut windows_seen = false;
    let mut effort_seen = false;
    let mut index = 0;
    while index < profile.args.len() {
        let flag = &profile.args[index];
        let value = profile
            .args
            .get(index + 1)
            .ok_or_else(|| format!("unsupported native Codex argument: {flag}"))?;
        match flag.as_str() {
            "--model" => {
                owned.extend([flag.clone(), value.clone()]);
            }
            "--sandbox" if value == "workspace-write" && !sandbox_seen => {
                sandbox_seen = true;
            }
            "-c" if value == "model_reasoning_effort=\"low\"" && !effort_seen => {
                effort_seen = true;
                owned.extend([flag.clone(), value.clone()]);
            }
            "-c" if value == "windows.sandbox=\"elevated\"" && !windows_seen => {
                windows_seen = true;
                owned.extend([flag.clone(), value.clone()]);
            }
            _ => return Err(format!("unsupported native Codex argument: {flag}")),
        }
        index += 2;
    }
    profile.args = [
        "exec",
        "--json",
        "--ephemeral",
        "--ignore-user-config",
        "--sandbox",
        "workspace-write",
    ]
    .into_iter()
    .map(String::from)
    .chain(owned)
    .chain(["-".into()])
    .collect();
    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn route(
        profile: AgentProfile,
        candidate: ModelCandidate,
        request: RouteRequest,
    ) -> Result<PreparedRoute, String> {
        PreparedRoute::select_native_codex(
            &DevelopmentPolicy::defaults(),
            request,
            &[candidate],
            &[profile],
        )
    }
    #[test]
    fn native_route_binds_explicit_transport_and_single_stdin_prompt() {
        let (mut profile, mut candidate, mut request) =
            super::super::tests::fixture(Provider::Codex);
        candidate.efforts.insert("low".into());
        request.effort = Some("low".into());
        profile.args = vec![
            "--sandbox".into(),
            "workspace-write".into(),
            "-c".into(),
            "windows.sandbox=\"elevated\"".into(),
        ];
        let original = PreparedRoute::select(
            &DevelopmentPolicy::defaults(),
            request.clone(),
            &[candidate.clone()],
            &[profile.clone()],
        )
        .unwrap();
        let native = route(profile, candidate, request).unwrap();
        assert_eq!(native.transport(), Transport::NativeCodexJson);
        assert!(native.require_interactive_transport().is_err());
        original.require_interactive_transport().unwrap();
        assert_eq!(
            native.profile().args,
            vec![
                "exec",
                "--json",
                "--ephemeral",
                "--ignore-user-config",
                "--sandbox",
                "workspace-write",
                "-c",
                "windows.sandbox=\"elevated\"",
                "--model",
                "provider/model",
                "-c",
                "model_reasoning_effort=\"low\"",
                "-"
            ]
        );
        assert_eq!(
            native.receipt()["preparedInvocation"]["transport"],
            "native_codex_exec_json"
        );
        assert!(native.validate_bound_receipt(&original.receipt()).is_err());
        assert!(original.validate_bound_receipt(&native.receipt()).is_err());
        assert_eq!(
            native.receipt()["executionObservation"]["state"],
            "unavailable"
        );
    }
    #[test]
    fn native_route_skips_cheaper_untranslatable_candidate_before_selection() {
        let (good_profile, good_candidate, request) = super::super::tests::fixture(Provider::Codex);
        let mut bad_profile = good_profile.clone();
        bad_profile.id = "codex-cheaper".into();
        bad_profile.args = vec!["resume".into(), "--last".into()];
        let mut bad_candidate = good_candidate.clone();
        bad_candidate.profile_id = bad_profile.id.clone();
        bad_candidate.evidence_id = "cheaper-evidence".into();
        bad_candidate.estimated_task_tokens = Some(1);
        let selected = PreparedRoute::select_native_codex(
            &DevelopmentPolicy::defaults(),
            request,
            &[bad_candidate, good_candidate],
            &[bad_profile, good_profile],
        )
        .unwrap();
        assert_eq!(selected.profile().id, "codex");
    }

    #[test]
    fn native_route_rejects_custom_commands_and_authority_overrides() {
        for args in [
            vec!["resume", "--last"],
            vec!["--dangerously-bypass-approvals-and-sandbox"],
            vec!["--profile", "custom"],
            vec!["--config", "model_provider=other"],
            vec!["--cd", "elsewhere"],
            vec!["--json"],
            vec!["--sandbox", "read-only"],
            vec!["-c", "features.anything=true"],
            vec!["--", "prompt"],
        ] {
            let (mut profile, candidate, request) = super::super::tests::fixture(Provider::Codex);
            profile.args = args.into_iter().map(String::from).collect();
            assert!(route(profile, candidate, request).is_err());
        }
        for provider in [
            Provider::Claude,
            Provider::Kimi,
            Provider::Opencode,
            Provider::Ollama,
        ] {
            let (profile, candidate, request) = super::super::tests::fixture(provider);
            assert!(route(profile, candidate, request).is_err());
        }
    }
    #[test]
    fn native_route_rejects_profile_api_keys_and_injected_skill_flags() {
        for mutation in 0..2 {
            let (mut profile, candidate, request) = super::super::tests::fixture(Provider::Codex);
            match mutation {
                0 => profile
                    .env
                    .insert("OpenAI_API_Key".into(), "fixture".into())
                    .map(|_| ())
                    .unwrap_or(()),
                _ => {
                    profile.caps.skills = crate::capabilities::SkillsDiscovery::Flag {
                        flag: "--skills".into(),
                    }
                }
            };
            assert!(route(profile, candidate, request).is_err());
        }
    }
    #[test]
    fn native_route_preserves_the_inert_interactive_readiness_marker() {
        // The marker steers the interactive submit guard only. `codex exec
        // --json` starts no TUI, so the marker cannot influence the native
        // invocation; rejecting it would make every TUI-annotated codex
        // profile untranslatable for no runtime reason. It is preserved
        // untouched, not discarded.
        let (mut profile, candidate, request) = super::super::tests::fixture(Provider::Codex);
        profile.caps.readiness_marker = Some("ready".into());
        let routed = route(profile, candidate, request).expect("marker is inert for exec");
        assert_eq!(
            routed.profile().caps.readiness_marker.as_deref(),
            Some("ready")
        );
    }
}
