//! Explicit Windows execution resources for the trusted native worker lane.
//! Owning this object does not enable routing or establish billing capability.
use super::native_launch::{NativeJob, NativeRunner};
use crate::{api::RunCredentialIssuer, profiles::AgentProfile, pty::PtyManager};
use projecta_capture::{
    protocol::{self, Binding, Environment, Launch, Prepared},
    windows_image::VerifiedImage,
};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread::JoinHandle,
    time::Duration,
};

#[path = "native_supervisor.rs"]
pub mod supervisor;

pub struct Configuration {
    pub provider: PathBuf,
    pub provider_sha256: String,
    pub host: PathBuf,
    pub host_sha256: String,
    pub environment: Vec<(String, String)>,
    pub timeout_ms: u64,
    pub output_limit: usize,
}

struct Resources {
    config: Configuration,
    manager: PtyManager,
    issuer: RunCredentialIssuer,
    runtime: tokio::runtime::Handle,
}

/// At most two owned threads, including finished work awaiting reconciliation.
/// The app/driver retains the runner and consumes completion notifications; no
/// second task database or model polling loop is created here.
pub struct WindowsNativeRunner {
    resources: Arc<Resources>,
    registry: Mutex<Registry>,
    completed: mpsc::SyncSender<String>,
    receiver: Mutex<mpsc::Receiver<String>>,
}

#[derive(Clone)]
pub struct Completion {
    pub session_id: String,
    pub result: Result<(), String>,
}

#[derive(Default)]
struct Registry {
    admission_closed: bool,
    supervisor_owned: bool,
    threads: BTreeMap<String, JoinHandle<Result<(), String>>>,
    notified: BTreeSet<String>,
    unresolved: BTreeSet<String>,
}

/// Covers only this runner's admitted threads. Shared session inventory and
/// durable reconciliation remain separate installation/exit requirements.
#[derive(Clone)]
pub struct Drain {
    pub completions: Vec<Completion>,
    pub running: Vec<String>,
    pub unresolved: Vec<String>,
}

impl WindowsNativeRunner {
    /// Paths and expected hashes must come from a trusted resource decision.
    /// These checks compare bytes; they are not a signature/provenance verdict.
    pub fn new(
        config: Configuration,
        manager: PtyManager,
        issuer: RunCredentialIssuer,
        runtime: tokio::runtime::Handle,
    ) -> Result<Self, String> {
        if config.timeout_ms == 0
            || config.timeout_ms > protocol::MAX_TIMEOUT_MS
            || config.output_limit == 0
            || config.output_limit > protocol::MAX_INPUT
            || !config
                .provider
                .file_name()
                .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("codex.exe"))
        {
            return Err("invalid native Codex resource limits or executable name".into());
        }
        VerifiedImage::open(&config.provider, &config.provider_sha256)?;
        VerifiedImage::open(&config.host, &config.host_sha256)?;
        merge_environment(&[&config.environment])?;
        let (completed, receiver) = mpsc::sync_channel(2);
        Ok(Self {
            resources: Arc::new(Resources {
                config,
                manager,
                issuer,
                runtime,
            }),
            registry: Mutex::new(Registry::default()),
            completed,
            receiver: Mutex::new(receiver),
        })
    }

    /// Consume one event and join its already-finished native operation. Call
    /// from a background/CLI lane, not the UI. None means no new observation.
    pub fn wait_completion(&self, timeout: Duration) -> Result<Option<Completion>, String> {
        if timeout > Duration::from_secs(60) {
            return Err("native completion wait exceeds limit".into());
        }
        let registry = self
            .registry
            .lock()
            .map_err(|_| "native registry unavailable")?;
        if registry.supervisor_owned {
            return Err("native completions owned by supervisor".into());
        }
        let receiver = self
            .receiver
            .try_lock()
            .map_err(|_| "native completion receiver busy or unavailable")?;
        drop(registry);
        self.consume_completion(&receiver, timeout)
    }

    fn consume_completion(
        &self,
        receiver: &mpsc::Receiver<String>,
        timeout: Duration,
    ) -> Result<Option<Completion>, String> {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            let mut registry = self
                .registry
                .lock()
                .map_err(|_| "native thread registry unavailable")?;
            let ready = registry
                .notified
                .iter()
                .find(|id| {
                    registry
                        .threads
                        .get(*id)
                        .is_some_and(JoinHandle::is_finished)
                })
                .cloned();
            if let Some(session_id) = ready {
                let handle = registry
                    .threads
                    .remove(&session_id)
                    .ok_or("native completion has no owned thread")?;
                registry.notified.remove(&session_id);
                // is_finished includes thread-local destruction. This join no
                // longer waits on arbitrary work after the notification.
                let result = handle
                    .join()
                    .unwrap_or_else(|_| Err("native dispatch thread panicked; reconcile".into()));
                if result.is_err() {
                    registry.unresolved.insert(session_id.clone());
                }
                return Ok(Some(Completion { session_id, result }));
            }
            let retiring = !registry.notified.is_empty();
            drop(registry);
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            // Thread retirement has no second channel signal. Check only while
            // a notified thread is retiring, within the caller's deadline.
            let wait = if retiring {
                remaining.min(Duration::from_millis(5))
            } else {
                remaining
            };
            match receiver.recv_timeout(wait) {
                Ok(id) => {
                    let mut registry = self
                        .registry
                        .lock()
                        .map_err(|_| "native thread registry unavailable")?;
                    if !registry.threads.contains_key(&id) || !registry.notified.insert(id) {
                        return Err("native completion has missing or duplicate ownership".into());
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if std::time::Instant::now() >= deadline {
                        return Ok(None);
                    }
                }
                Err(_) => return Err("native completion channel disconnected".into()),
            }
        }
    }

    /// Monotonic shutdown barrier, serialized with registration. Does not cancel
    /// work, mutate durable policy, or grant installation authority.
    pub fn close_admission(&self) -> Result<(), String> {
        self.registry
            .lock()
            .map_err(|_| "native thread registry unavailable")?
            .admission_closed = true;
        Ok(())
    }

    /// A timeout retains handles for a later call. Failed completions remain
    /// unresolved even after another observer consumed their event.
    pub fn drain(&self, timeout: Duration) -> Result<Drain, String> {
        if timeout > Duration::from_secs(60) {
            return Err("native drain wait exceeds limit".into());
        }
        self.close_admission()?;
        let registry = self
            .registry
            .lock()
            .map_err(|_| "native registry unavailable")?;
        if registry.supervisor_owned {
            return Err("native completions owned by supervisor".into());
        }
        let receiver = self
            .receiver
            .try_lock()
            .map_err(|_| "native completion receiver busy or unavailable")?;
        drop(registry);
        self.drain_owned(&receiver, timeout)
    }

    fn drain_owned(
        &self,
        receiver: &mpsc::Receiver<String>,
        timeout: Duration,
    ) -> Result<Drain, String> {
        let deadline = std::time::Instant::now() + timeout;
        let mut completions = Vec::new();
        loop {
            let registry = self
                .registry
                .lock()
                .map_err(|_| "native thread registry unavailable")?;
            let running: Vec<_> = registry.threads.keys().cloned().collect();
            let unresolved: Vec<_> = registry.unresolved.iter().cloned().collect();
            drop(registry);
            if running.is_empty() {
                return Ok(Drain {
                    completions,
                    running,
                    unresolved,
                });
            }
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            match self.consume_completion(receiver, remaining)? {
                Some(completion) => completions.push(completion),
                None => {
                    return Ok(Drain {
                        completions,
                        running,
                        unresolved,
                    })
                }
            }
        }
    }
}

impl NativeRunner for WindowsNativeRunner {
    fn prepare(
        &self,
        profile: &AgentProfile,
        cwd: &Path,
        env: &[(String, String)],
        binding: Binding,
        input: &[u8],
    ) -> Result<Prepared, String> {
        let config = &self.resources.config;
        let command = Path::new(&profile.command);
        if !cwd.is_absolute()
            || !cwd.is_dir()
            || (command.is_absolute()
                && command.canonicalize().map_err(|e| e.to_string())?
                    != config.provider.canonicalize().map_err(|e| e.to_string())?)
            || (!command.is_absolute()
                && !matches!(
                    profile.command.to_ascii_lowercase().as_str(),
                    "codex" | "codex.exe"
                ))
        {
            return Err("native resources cannot replace this profile command or cwd".into());
        }
        // Recheck after construction; execution independently holds/verifies the
        // image again. Never resolve a shell/npm wrapper or use inherited env.
        VerifiedImage::open(&config.provider, &config.provider_sha256)?;
        VerifiedImage::open(&config.host, &config.host_sha256)?;
        let profile_env: Vec<_> = profile
            .env
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        let environment = merge_environment(&[&config.environment, &profile_env, env])?;
        let launch = Launch {
            executable: config
                .provider
                .to_str()
                .ok_or("native executable path encoding")?
                .into(),
            executable_sha256: config.provider_sha256.to_ascii_lowercase(),
            args: profile.args.clone(),
            cwd: cwd.to_str().ok_or("native cwd encoding")?.into(),
            environment,
            input_bytes: input.len(),
            input_sha256: format!("{:x}", Sha256::digest(input)),
            output_limit: config.output_limit,
            timeout_ms: config.timeout_ms,
        };
        let mut wire = Vec::new();
        protocol::write_launch(&mut wire, binding, launch, input)?;
        protocol::prepare_buffer(&wire).map_err(String::from)
    }

    fn start(&self, job: NativeJob) -> Result<(), String> {
        if !job.matches_provider(
            &self.resources.config.provider,
            &self.resources.config.provider_sha256,
        ) {
            return Err("native job belongs to different provider resources".into());
        }
        let session = job.session_id().to_string();
        let run = job.run_id().to_string();
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "native thread registry unavailable")?;
        if registry.admission_closed {
            return Err("native dispatch admission is closed".into());
        }
        if registry.threads.len() >= 2 || registry.threads.contains_key(&session) {
            return Err("native dispatch capacity or session already owned".into());
        }
        let resources = Arc::clone(&self.resources);
        let completed = self.completed.clone();
        let id = session.clone();
        let handle = std::thread::Builder::new()
            .name("projecta-native-worker".into())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    job.execute(
                        &resources.manager,
                        (&resources.config.host, &resources.config.host_sha256),
                        &resources.runtime,
                        &resources.issuer,
                    )
                }))
                .unwrap_or_else(|_| {
                    let revoked = resources.issuer.revoke_run_credentials(&run);
                    Err(match revoked {
                        Ok(()) => {
                            "native dispatch panicked; durable reconciliation unconfirmed".into()
                        }
                        Err(error) => format!(
                            "native dispatch panicked; credential revocation failed: {error}"
                        ),
                    })
                });
                // At most two jobs exist, so their two completion slots cannot fill
                // before this notification. Sending never releases session state.
                let _ = completed.send(id);
                result
            })
            .map_err(|_| "native execution thread could not start")?;
        registry.threads.insert(session, handle);
        Ok(())
    }
}

/// Owned native control for the ordinary reserved development launch service.
/// It cannot silently fall back to PTY spawning or typed prompt delivery.
impl super::AgentControl for Arc<WindowsNativeRunner> {
    fn native_runner(&self) -> Result<Arc<dyn NativeRunner>, String> {
        Ok(self.clone())
    }

    fn reserve_launch_session(&self) -> Result<String, String> {
        self.resources.manager.reserve_session()
    }

    fn cancel_launch_session(&self, session_id: &str) {
        self.resources.manager.cancel_reservation(session_id);
    }

    fn spawn(
        &self,
        _worker_id: &str,
        _profile: &AgentProfile,
        _cwd: &Path,
        _env: &[(String, String)],
    ) -> Result<String, String> {
        Err("native control requires the reserved development launch service".into())
    }

    fn kill(&self, session_id: &str) {
        // Failure does not retire inventory or establish process exit.
        let _ = self.resources.manager.kill(session_id);
    }
}

fn merge_environment(layers: &[&[(String, String)]]) -> Result<Vec<Environment>, String> {
    let mut values = BTreeMap::<String, (String, String)>::new();
    for layer in layers {
        let mut seen = std::collections::HashSet::new();
        for (key, value) in *layer {
            let folded = key.to_ascii_uppercase();
            if !seen.insert(folded.clone()) {
                return Err("ambiguous native environment layer".into());
            }
            if matches!(
                folded.as_str(),
                "OPENAI_API_KEY" | "OPENAI_BASE_URL" | "CODEX_API_KEY" | "ANTHROPIC_API_KEY"
            ) {
                return Err("native subscription resources reject API billing overrides".into());
            }
            if let Some((prior_key, _)) = values.get(&folded) {
                if prior_key != key {
                    return Err("native environment casing conflicts across layers".into());
                }
            }
            values.insert(folded, (key.clone(), value.clone()));
        }
    }
    Ok(values
        .into_values()
        .map(|(key, value)| Environment { key, value })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_environment_is_explicit_and_rejects_ambiguous_or_paid_overrides() {
        let base = vec![("PATH".into(), "base".into())];
        let profile = vec![("PATH".into(), "profile".into())];
        let overlay = vec![("PROJECTA_API_FILE".into(), "scoped-descriptor".into())];
        let merged = merge_environment(&[&base, &profile, &overlay]).unwrap();
        assert_eq!(merged.len(), 2);
        assert!(merged
            .iter()
            .any(|e| e.key == "PATH" && e.value == "profile"));
        assert!(merged
            .iter()
            .any(|e| e.key == "PROJECTA_API_FILE" && e.value == "scoped-descriptor"));
        assert!(merge_environment(&[&base, &[("Path".into(), "conflict".into())]]).is_err());
        assert!(merge_environment(&[&[
            ("PATH".into(), "one".into()),
            ("Path".into(), "two".into())
        ]])
        .is_err());
        for key in [
            "OPENAI_API_KEY",
            "openai_base_url",
            "CODEX_API_KEY",
            "ANTHROPIC_API_KEY",
        ] {
            assert!(merge_environment(&[&[(key.into(), "not-a-real-secret".into())]]).is_err());
        }
    }

    #[tokio::test]
    async fn resource_preparation_pins_images_and_preserves_the_frozen_invocation() {
        let dir = crate::testutil::TempDir::new("native-resources");
        let source =
            PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32/sort.exe");
        let provider = dir.path().join("codex.exe");
        std::fs::copy(&source, &provider).unwrap();
        let provider_sha256 = format!("{:x}", Sha256::digest(std::fs::read(&provider).unwrap()));
        let host = std::env::current_exe().unwrap(); // preparation fixture only; not a protocol host
        let host_sha256 = format!("{:x}", Sha256::digest(std::fs::read(&host).unwrap()));
        let server = crate::api::tests::native_server(&dir.path().join("api"), "run", "owner", 1);
        let manager = PtyManager::default();
        let runner = WindowsNativeRunner::new(
            Configuration {
                provider: provider.clone(),
                provider_sha256,
                host,
                host_sha256,
                environment: vec![("PATH".into(), "base".into())],
                timeout_ms: 40_000,
                output_limit: 1000,
            },
            manager.clone(),
            server.run_credential_issuer(),
            tokio::runtime::Handle::current(),
        )
        .unwrap();
        let mut profile = crate::profiles::find_profile("codex").unwrap();
        profile.args = vec!["exec".into(), "--json".into(), "-".into()];
        profile.env.insert("PATH".into(), "profile".into());
        let binding = Binding {
            run_id: "run".into(),
            session_id: "session".into(),
            process_instance: "process".into(),
            capability: "a".repeat(64),
            route_sha256: "b".repeat(64),
        };
        let overlay = vec![("PROJECTA_API_FILE".into(), "scoped-descriptor".into())];
        let prepared = runner
            .prepare(&profile, dir.path(), &overlay, binding.clone(), b"task")
            .unwrap();
        assert_eq!(prepared.binding(), &binding);
        assert_eq!(prepared.launch().args, profile.args);
        assert_eq!(prepared.launch().timeout_ms, 40_000);
        assert_eq!(
            prepared.input_receipt(),
            (4, format!("{:x}", Sha256::digest(b"task")).as_str())
        );
        assert_eq!(prepared.launch().environment.len(), 2);
        assert!(runner.wait_completion(Duration::ZERO).unwrap().is_none());
        assert!(runner.wait_completion(Duration::from_secs(61)).is_err());
        profile.command = "codex.cmd".into();
        assert!(runner
            .prepare(&profile, dir.path(), &overlay, binding.clone(), b"task")
            .is_err());
        profile.command = "codex".into();
        std::fs::write(&provider, b"changed fixture bytes").unwrap();
        assert!(runner
            .prepare(&profile, dir.path(), &overlay, binding, b"task")
            .is_err());
        assert!(manager.live_session_ids().unwrap().is_empty());
        // An existing completion observer must not make a zero-time drain wait
        // behind its receive timeout. Admission nevertheless stays closed.
        let receiver = runner.receiver.lock().unwrap();
        assert!(runner.drain(Duration::ZERO).is_err());
        assert!(runner.wait_completion(Duration::ZERO).is_err());
        drop(receiver);
        assert!(runner.registry.lock().unwrap().admission_closed);
        let drained = runner.drain(Duration::ZERO).unwrap();
        assert!(drained.running.is_empty());
        assert!(drained.unresolved.is_empty());
        assert!(runner.drain(Duration::from_secs(61)).is_err());
        // A completion notification precedes thread retirement. Keep the native
        // handle until retirement, even when a zero-time drain already saw it.
        let (release, released) = mpsc::channel();
        let handle = std::thread::spawn(move || {
            let _ = released.recv_timeout(Duration::from_secs(2));
            Ok(())
        });
        runner
            .registry
            .lock()
            .unwrap()
            .threads
            .insert("retiring".into(), handle);
        runner.completed.send("retiring".into()).unwrap();
        let pending = runner.drain(Duration::ZERO).unwrap();
        let _ = release.send(());
        assert_eq!(pending.running, vec!["retiring".to_string()]);
        assert!(pending.completions.is_empty());
        let finished = runner.drain(Duration::from_secs(2)).unwrap();
        assert!(finished.running.is_empty());
        assert_eq!(finished.completions.len(), 1);
        assert!(finished.completions[0].result.is_ok());
    }
}
