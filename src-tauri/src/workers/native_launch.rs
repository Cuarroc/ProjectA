//! Owned native handoff in the ordinary development worker lane.
use super::*;
use crate::process_capture::protocol::{Binding, Prepared};
use crate::store::development_capture::CaptureOwner;

/// Supplied only by a trusted in-process adapter. This is not a provider
/// capability flag or an agent-accessible constructor.
pub trait NativeRunner: Send + Sync {
    fn prepare(
        &self,
        profile: &AgentProfile,
        cwd: &Path,
        env: &[(String, String)],
        binding: Binding,
        input: &[u8],
    ) -> Result<Prepared, String>;

    /// Accept ownership on a dedicated blocking lane. Failure must not launch
    /// another process or remove an unresolved session from native inventory.
    fn start(&self, job: NativeJob) -> Result<(), String>;
}

/// No Clone/Deserialize: only the launch lane can create this handoff.
pub struct NativeJob {
    store: Store,
    owner: CaptureOwner,
    prepared: Prepared,
}
impl NativeJob {
    #[cfg(all(test, windows))]
    pub(crate) fn fixture(store: Store, owner: CaptureOwner, prepared: Prepared) -> Self {
        Self {
            store,
            owner,
            prepared,
        }
    }
    pub fn session_id(&self) -> &str {
        &self.prepared.binding().session_id
    }

    #[cfg(windows)]
    pub(super) fn run_id(&self) -> &str {
        &self.prepared.binding().run_id
    }

    #[cfg(windows)]
    pub(super) fn matches_provider(&self, path: &Path, sha256: &str) -> bool {
        Path::new(&self.prepared.launch().executable) == path
            && self
                .prepared
                .launch()
                .executable_sha256
                .eq_ignore_ascii_case(sha256)
    }

    /// Invoke on the adapter's owned blocking lane. Final bookkeeping includes
    /// scoped credential revocation and the ordinary worker/session exit state.
    #[cfg(windows)]
    pub fn execute(
        self,
        manager: &crate::pty::PtyManager,
        host: (&Path, &str),
        runtime: &tokio::runtime::Handle,
        issuer: &crate::api::RunCredentialIssuer,
    ) -> Result<(), String> {
        let (run, claim_owner, fence) = self.owner.claim_identity();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            crate::process_capture::managed::run(
                manager,
                &self.store,
                &self.owner,
                host,
                self.prepared,
                runtime,
                |_| {
                    issuer.revoke_run_credentials(run)?;
                    runtime.block_on(self.store.finish_native_session(&self.owner))
                },
            )
        }))
        .unwrap_or_else(|_| Err("native execution panicked; reconciliation required".into()));
        // Also covers preparation/registry refusal, cancellation, capture or
        // finalization failure and unwind. Never infer exit from an error.
        runtime.block_on(super::development::with_launch_reconciliation(
            &self.store,
            run,
            claim_owner,
            fence,
            &|| issuer.revoke_run_credentials(run),
            async { result },
        ))
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn handoff(
    store: &Store,
    runner: &dyn NativeRunner,
    context: &development::LaunchContext<'_>,
    profile: &AgentProfile,
    cwd: &Path,
    env: &[(String, String)],
    delivery: &store::development_delivery::DevelopmentDelivery,
    input: &[u8],
) -> Result<(), String> {
    let mut capability = [0u8; 32];
    getrandom::fill(&mut capability).map_err(|_| "native launch capability unavailable")?;
    let binding = Binding {
        run_id: delivery.run_id.clone(),
        session_id: delivery.session_id.clone(),
        process_instance: delivery.process_instance.clone(),
        route_sha256: delivery.route_sha256.clone(),
        capability: capability.iter().map(|b| format!("{b:02x}")).collect(),
    };
    let prepared = runner.prepare(profile, cwd, env, binding.clone(), input)?;
    let executable = Path::new(&prepared.launch().executable);
    let name = executable
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if !executable.is_absolute()
        || !matches!(name.to_ascii_lowercase().as_str(), "codex" | "codex.exe")
    {
        return Err("native Codex adapter must resolve an absolute native Codex executable".into());
    }
    if Path::new(&profile.command).is_absolute()
        && Path::new(&profile.command)
            .canonicalize()
            .map_err(|e| e.to_string())?
            != executable.canonicalize().map_err(|e| e.to_string())?
    {
        return Err("native adapter changed the explicit profile executable".into());
    }
    if prepared.binding() != &binding
        || prepared.launch().args != profile.args
        || prepared.input_receipt() != (input.len(), delivery.input_sha256.as_str())
        || Path::new(&prepared.launch().cwd)
            .canonicalize()
            .map_err(|e| e.to_string())?
            != cwd.canonicalize().map_err(|e| e.to_string())?
    {
        return Err("native adapter changed bound invocation or task input".into());
    }
    // The descriptor overlay must survive adapter preparation unchanged.
    for (key, value) in env {
        if !prepared
            .launch()
            .environment
            .iter()
            .any(|item| item.key == *key && item.value == *value)
        {
            return Err("native adapter omitted a required worker environment overlay".into());
        }
    }
    for (key, value) in &profile.env {
        let expected = env
            .iter()
            .rev()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v)
            .unwrap_or(value);
        if !prepared
            .launch()
            .environment
            .iter()
            .any(|item| item.key == *key && item.value == *expected)
        {
            return Err("native adapter changed profile environment".into());
        }
    }
    if prepared.launch().environment.iter().any(|item| {
        matches!(
            item.key.to_ascii_uppercase().as_str(),
            "OPENAI_API_KEY" | "OPENAI_BASE_URL" | "CODEX_API_KEY" | "ANTHROPIC_API_KEY"
        )
    }) {
        return Err("native subscription adapter supplied API billing overrides".into());
    }
    let owner = store
        .reserve_native_capture_owner(
            binding,
            prepared.launch().clone(),
            context.owner,
            context.fence,
        )
        .await?;
    // Dispatch bookkeeping precedes start, so immediate completion cannot be
    // overwritten by a late launched transition. This is not process evidence.
    store
        .mark_development_run_launched(
            context.run_id,
            context.owner,
            context.fence,
            Some(context.worker_id),
            None,
        )
        .await?;
    runner.start(NativeJob {
        store: store.clone(),
        owner,
        prepared,
    })
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use crate::process_capture::protocol::{self, Environment, Launch};
    use sha2::{Digest, Sha256};
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    };
    #[derive(Default)]
    pub(crate) struct RecordingRunner {
        pub mutation: usize,
        pub fail_start: bool,
        pub job: Mutex<Option<NativeJob>>,
        pub starts: AtomicUsize,
    }
    impl NativeRunner for RecordingRunner {
        fn prepare(
            &self,
            profile: &AgentProfile,
            cwd: &Path,
            env: &[(String, String)],
            mut binding: Binding,
            input: &[u8],
        ) -> Result<Prepared, String> {
            let mut supplied = input.to_vec();
            if self.mutation == 4 {
                supplied.push(b'x');
            }
            let input = supplied.as_slice();
            let mut environment = profile.env.clone();
            environment.extend(env.iter().cloned());
            let mut launch = Launch {
                executable: cwd.join("codex.exe").to_string_lossy().into_owned(),
                executable_sha256: "a".repeat(64),
                args: profile.args.clone(),
                cwd: cwd.to_string_lossy().into_owned(),
                environment: environment
                    .into_iter()
                    .map(|(key, value)| Environment { key, value })
                    .collect(),
                input_bytes: input.len(),
                input_sha256: format!("{:x}", Sha256::digest(input)),
                output_limit: 1000,
                timeout_ms: 1000,
            };
            match self.mutation {
                1 => launch.args.push("--unexpected".into()),
                2 => binding.capability = "b".repeat(64),
                3 => launch.environment.clear(),
                5 => launch.executable = cwd.join("other.exe").to_string_lossy().into_owned(),
                6 => launch.cwd = cwd.parent().unwrap().to_string_lossy().into_owned(),
                7 => launch.environment.push(Environment {
                    key: "OPENAI_API_KEY".into(),
                    value: "fixture".into(),
                }),
                _ => {}
            }
            let (mut header, tail) = protocol::launch_parts(binding, launch, input)?;
            header.extend(tail);
            Ok(protocol::prepare_buffer(&header)?)
        }
        fn start(&self, job: NativeJob) -> Result<(), String> {
            self.starts.fetch_add(1, Ordering::SeqCst);
            if self.fail_start {
                return Err("injected native dispatch failure".into());
            }
            *self.job.lock().unwrap() = Some(job);
            Ok(())
        }
    }
}
