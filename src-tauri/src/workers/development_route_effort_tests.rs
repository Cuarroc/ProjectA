use super::*;

#[test]
fn codex_low_effort_uses_observed_cli_translation() {
    let (mut profile, mut candidate, mut request) = tests::fixture(Provider::Codex);
    profile.args = vec![
        "--sandbox".into(),
        "workspace-write".into(),
        "-c".into(),
        "windows.sandbox=\"elevated\"".into(),
    ];
    candidate.efforts.insert("low".into());
    request.effort = Some("low".into());
    let route = PreparedRoute::select(
        &DevelopmentPolicy::defaults(),
        request,
        &[candidate],
        &[profile],
    )
    .unwrap();
    assert_eq!(
        route.profile().args,
        vec![
            "--sandbox",
            "workspace-write",
            "-c",
            "windows.sandbox=\"elevated\"",
            "--model",
            "provider/model",
            "-c",
            "model_reasoning_effort=\"low\"",
        ]
    );
    assert_eq!(
        route.receipt()["executionObservation"]["state"],
        "unavailable"
    );
}

#[test]
fn codex_low_effort_still_requires_candidate_attestation() {
    let (profile, candidate, mut request) = tests::fixture(Provider::Codex);
    request.effort = Some("low".into());
    assert!(PreparedRoute::select(
        &DevelopmentPolicy::defaults(),
        request,
        &[candidate],
        &[profile],
    )
    .is_err());
}

#[test]
fn codex_effort_refuses_config_overlays_instead_of_guessing_precedence() {
    for args in [
        vec!["-c", "model_reasoning_effort=\"high\""],
        vec!["--config=model_reasoning_effort='high'"],
        vec!["-cmodel_reasoning_effort='high'"],
        vec!["--profile", "custom"],
        vec!["-pcustom"],
        vec!["--config", "'model_reasoning_effort' = 'high'"],
        vec!["--config", "malformed"],
    ] {
        let (mut profile, mut candidate, mut request) = tests::fixture(Provider::Codex);
        profile.args = args.into_iter().map(String::from).collect();
        candidate.efforts.insert("low".into());
        request.effort = Some("low".into());
        assert!(PreparedRoute::select(
            &DevelopmentPolicy::defaults(),
            request,
            &[candidate],
            &[profile],
        )
        .is_err());
    }
}
