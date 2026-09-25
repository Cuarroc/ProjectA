//! Strict decoding for the inherited native host pipe. This validates the wire
//! contract, not provenance: callers must own a verified, contained host and
//! its stdout handle. Files, PTY output and recovered spools are not eligible.
use super::protocol::{Binding, Launch, MAX_FRAME, MAX_INPUT};
use serde::{Deserialize, Serialize};

pub const MAX_REPLY_BYTES: usize = MAX_INPUT * 4 + MAX_FRAME;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reply {
    schema_version: u32,
    state: String,
    binding: Binding,
    input_bytes: usize,
    input_sha256: String,
    pub capture: Capture,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Capture {
    pub identity: Identity,
    pub exit_code: u32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    schema_version: u32,
    process_id: u32,
    created_filetime: String,
    volume_serial: u32,
    file_index: String,
    image_size: u64,
    image_sha256: String,
    state: String,
}

impl Identity {
    pub fn validate(&self, launch: &Launch, state: &str) -> Result<(), &'static str> {
        let canonical_u64 = |value: &str| {
            value
                .parse::<u64>()
                .ok()
                .filter(|number| number.to_string() == value)
        };
        if self.schema_version != 1
            || self.process_id == 0
            || canonical_u64(&self.created_filetime).is_none_or(|value| value == 0)
            || canonical_u64(&self.file_index).is_none()
            || self.image_size == 0
            || self.image_size > 512 * 1024 * 1024
            || self.image_sha256 != launch.executable_sha256
            || self.state != state
        {
            return Err("invalid native process observation");
        }
        Ok(())
    }

    pub fn same_process(&self, other: &Self) -> bool {
        self.schema_version == other.schema_version
            && self.process_id == other.process_id
            && self.created_filetime == other.created_filetime
            && self.volume_serial == other.volume_serial
            && self.file_index == other.file_index
            && self.image_size == other.image_size
            && self.image_sha256 == other.image_sha256
    }
}

/// Terminal wire state of a provider that demonstrably exited before its task
/// input was delivered. It is never a delivery or task receipt: it carries no
/// provider output and cannot be decoded as a [`Reply`].
pub const UNDELIVERED_EXIT_STATE: &str = "native_provider_exited_before_input_delivery";
/// Host observation state: the verified process was signaled, its exit code
/// read and its pipes drained, while its input write failed on a closed pipe.
pub const UNDELIVERED_IDENTITY_STATE: &str = "native_image_verified_exited_before_input_delivery";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UndeliveredReason {
    ProviderExitedBeforeInputDelivery,
}

impl UndeliveredReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ProviderExitedBeforeInputDelivery => "provider_exited_before_input_delivery",
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UndeliveredExit {
    schema_version: u32,
    state: String,
    binding: Binding,
    input_bytes: usize,
    input_sha256: String,
    pub identity: Identity,
    pub exit_code: u32,
    pub reason: UndeliveredReason,
}

/// Strict decoding of the versioned undelivered-exit variant. Like [`decode`]
/// this validates the wire contract only; the owner must still confirm native
/// host cleanup and its own checkpoint ledger before recording anything.
pub fn decode_undelivered(
    bytes: &[u8],
    binding: &Binding,
    launch: &Launch,
) -> Result<UndeliveredExit, &'static str> {
    const INVALID: &str = "invalid native undelivered exit";
    if bytes.is_empty() || bytes.len() > MAX_FRAME {
        return Err(INVALID);
    }
    let exit: UndeliveredExit = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
    exit.identity.validate(launch, UNDELIVERED_IDENTITY_STATE)?;
    if exit.schema_version != 1
        || exit.state != UNDELIVERED_EXIT_STATE
        || &exit.binding != binding
        || exit.input_bytes != launch.input_bytes
        || exit.input_sha256 != launch.input_sha256
    {
        return Err(INVALID);
    }
    Ok(exit)
}

pub fn decode(bytes: &[u8], binding: &Binding, launch: &Launch) -> Result<Reply, &'static str> {
    const INVALID: &str = "invalid native host reply";
    if bytes.is_empty() || bytes.len() > MAX_REPLY_BYTES {
        return Err(INVALID);
    }
    let reply: Reply = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
    let identity = &reply.capture.identity;
    identity.validate(
        launch,
        "native_image_verified_execution_exited_and_pipes_drained",
    )?;
    if reply.schema_version != 1
        || reply.state != "native_protocol_capture_completed"
        || &reply.binding != binding
        || reply.input_bytes != launch.input_bytes
        || reply.input_sha256 != launch.input_sha256
        || launch.output_limit == 0
        || launch.output_limit > MAX_INPUT
        || reply.capture.stdout.len() + reply.capture.stderr.len() > launch.output_limit
    {
        return Err(INVALID);
    }
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn fixture() -> (Binding, Launch, Value) {
        let binding = Binding {
            run_id: "run".into(),
            session_id: "session".into(),
            process_instance: "instance".into(),
            capability: "a".repeat(64),
            route_sha256: "b".repeat(64),
        };
        let launch = Launch {
            executable: "/native".into(),
            executable_sha256: "c".repeat(64),
            args: vec![],
            cwd: "/work".into(),
            environment: vec![],
            input_bytes: 0,
            input_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".into(),
            output_limit: 16,
            timeout_ms: 1000,
        };
        let reply = json!({"schemaVersion":1,"state":"native_protocol_capture_completed",
            "binding":binding,"inputBytes":launch.input_bytes,"inputSha256":launch.input_sha256,
            "capture":{"identity":{"schemaVersion":1,"processId":123,
                "createdFiletime":"18446744073709551615","volumeSerial":0,
                "fileIndex":"0","imageSize":4096,"imageSha256":launch.executable_sha256,
                "state":"native_image_verified_execution_exited_and_pipes_drained"},
                "exitCode":0,"stdout":[255,0,128],"stderr":[10]}});
        (binding, launch, reply)
    }

    #[test]
    fn host_reply_rejects_rebinding_partial_outcomes_and_wrong_image() {
        let (binding, launch, reply) = fixture();
        let mutations = [
            ("/schemaVersion", json!(2)),
            ("/state", json!("partial")),
            ("/binding/runId", json!("other")),
            ("/binding/sessionId", json!("other")),
            ("/binding/processInstance", json!("other")),
            ("/binding/capability", json!("d".repeat(64))),
            ("/binding/routeSha256", json!("d".repeat(64))),
            ("/inputBytes", json!(1)),
            ("/inputSha256", json!("d".repeat(64))),
            ("/capture/identity/schemaVersion", json!(2)),
            ("/capture/identity/processId", json!(0)),
            ("/capture/identity/createdFiletime", json!("0")),
            (
                "/capture/identity/createdFiletime",
                json!("18446744073709551616"),
            ),
            ("/capture/identity/fileIndex", json!("01")),
            ("/capture/identity/imageSize", json!(0)),
            ("/capture/identity/imageSha256", json!("d".repeat(64))),
            (
                "/capture/identity/state",
                json!("suspended_image_verified_terminated_without_execution"),
            ),
            ("/capture/stdout", json!(vec![0; 16])),
        ];
        for (pointer, value) in mutations {
            let mut changed = reply.clone();
            *changed.pointer_mut(pointer).unwrap() = value;
            assert!(
                decode(&serde_json::to_vec(&changed).unwrap(), &binding, &launch).is_err(),
                "{pointer}"
            );
        }
    }

    fn undelivered(binding: &Binding, launch: &Launch) -> Value {
        json!({"schemaVersion":1,"state":UNDELIVERED_EXIT_STATE,"binding":binding,
            "inputBytes":launch.input_bytes,"inputSha256":launch.input_sha256,
            "identity":{"schemaVersion":1,"processId":123,"createdFiletime":"5","volumeSerial":0,
                "fileIndex":"0","imageSize":4096,"imageSha256":launch.executable_sha256,
                "state":UNDELIVERED_IDENTITY_STATE},
            "exitCode":2,"reason":"provider_exited_before_input_delivery"})
    }

    #[test]
    fn undelivered_exit_is_strict_and_never_decodes_as_a_delivery_reply() {
        let (binding, launch, reply) = fixture();
        let exit = undelivered(&binding, &launch);
        let observed =
            decode_undelivered(&serde_json::to_vec(&exit).unwrap(), &binding, &launch).unwrap();
        assert_eq!(observed.exit_code, 2);
        assert_eq!(
            observed.reason.as_str(),
            "provider_exited_before_input_delivery"
        );
        // Neither form can stand in for the other.
        assert!(decode(&serde_json::to_vec(&exit).unwrap(), &binding, &launch).is_err());
        assert!(
            decode_undelivered(&serde_json::to_vec(&reply).unwrap(), &binding, &launch).is_err()
        );
        let mutations = [
            ("/schemaVersion", json!(2)),
            ("/state", json!("native_protocol_capture_completed")),
            ("/binding/runId", json!("other")),
            ("/inputBytes", json!(1)),
            ("/inputSha256", json!("d".repeat(64))),
            ("/identity/imageSha256", json!("d".repeat(64))),
            (
                "/identity/state",
                json!("native_image_verified_execution_exited_and_pipes_drained"),
            ),
            ("/reason", json!("provider_crashed")),
            ("/exitCode", json!(-1)),
        ];
        for (pointer, value) in mutations {
            let mut changed = exit.clone();
            *changed.pointer_mut(pointer).unwrap() = value;
            assert!(
                decode_undelivered(&serde_json::to_vec(&changed).unwrap(), &binding, &launch)
                    .is_err(),
                "{pointer}"
            );
        }
        let mut extra = exit.clone();
        extra["stdout"] = json!([1]);
        assert!(
            decode_undelivered(&serde_json::to_vec(&extra).unwrap(), &binding, &launch).is_err()
        );
    }

    #[test]
    fn host_reply_preserves_native_width_raw_streams_and_nonzero_provider_exit() {
        let (binding, launch, mut reply) = fixture();
        reply["capture"]["exitCode"] = json!(u32::MAX);
        let observed = decode(&serde_json::to_vec(&reply).unwrap(), &binding, &launch).unwrap();
        assert_eq!(observed.capture.exit_code, u32::MAX);
        assert_eq!(observed.capture.stdout, [255, 0, 128]);
        assert_eq!(observed.capture.stderr, [10]);
        assert_eq!(
            observed.capture.identity.created_filetime,
            u64::MAX.to_string()
        );
    }

    #[test]
    fn host_reply_rejects_ambiguous_json_and_oversized_envelopes() {
        let (binding, launch, reply) = fixture();
        let encoded = serde_json::to_vec(&reply).unwrap();
        let mut padded = encoded.clone();
        padded.resize(MAX_REPLY_BYTES + 1, b' ');
        for bytes in [
            [encoded.clone(), encoded.clone()].concat(),
            encoded[..encoded.len() - 1].to_vec(),
            vec![b' '; MAX_REPLY_BYTES + 1],
            padded,
            String::from_utf8(encoded.clone())
                .unwrap()
                .replacen(
                    "\"schemaVersion\":1",
                    "\"schemaVersion\":1,\"schemaVersion\":1",
                    1,
                )
                .into_bytes(),
        ] {
            assert!(decode(&bytes, &binding, &launch).is_err());
        }
        for pointer in ["", "/binding", "/capture", "/capture/identity"] {
            let mut changed = reply.clone();
            changed
                .pointer_mut(pointer)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert("unknown".into(), json!("secret-value"));
            let error = decode(&serde_json::to_vec(&changed).unwrap(), &binding, &launch)
                .err()
                .unwrap();
            assert!(!error.contains("secret-value"));
        }
    }
}
