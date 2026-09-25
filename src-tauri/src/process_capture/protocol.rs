//! Bounded parent/host control framing. An inherited pipe establishes origin;
//! the capability only correlates one launch, it is not an HTTP credential.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::{Read, Write};

pub const VERSION: u32 = 1;
pub const MAX_FRAME: usize = 262_144;
pub const MAX_INPUT: usize = 1_048_576;
pub const MAX_TIMEOUT_MS: u64 = 5_400_000;
// The parent also covers host startup and final acknowledgement/pipe drain.
pub const HOST_GRACE_MS: u64 = 10_000;
pub const MAX_CHUNK: usize = 16_384;
pub const MAX_CONTROL_BYTES: usize = MAX_FRAME + MAX_INPUT * 5;
pub const READ_CANCELLED: &str = "capture control native read cancelled";
const MAX_MESSAGES: u64 = 258;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub run_id: String,
    pub session_id: String,
    pub process_instance: String,
    pub capability: String,
    pub route_sha256: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Environment {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Launch {
    pub executable: String,
    pub executable_sha256: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub environment: Vec<Environment>,
    pub input_bytes: usize,
    pub input_sha256: String,
    pub output_limit: usize,
    pub timeout_ms: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Control {
    Launch { launch: Launch },
    Input { offset: usize, bytes: Vec<u8> },
    InputEnd,
    Cancel,
    ReceiptObserved { event_sequence: u64 },
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Packet {
    pub schema_version: u32,
    pub sequence: u64,
    pub binding: Binding,
    pub message: Control,
}

pub struct Prepared {
    binding: Binding,
    launch: Launch,
    input: Vec<u8>,
}

impl Prepared {
    pub fn launch(&self) -> &Launch {
        &self.launch
    }

    pub fn binding(&self) -> &Binding {
        &self.binding
    }

    pub fn input_receipt(&self) -> (usize, &str) {
        (self.launch.input_bytes, &self.launch.input_sha256)
    }

    pub fn into_parts(self) -> (Binding, Launch, Vec<u8>) {
        (self.binding, self.launch, self.input)
    }
}

pub enum Accepted {
    Pending,
    Ready(Box<Prepared>),
    Cancelled,
    ReceiptObserved(u64),
}

fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
}

fn text(value: &str) -> bool {
    value.len() <= 32768 && !value.contains('\0')
}

impl Binding {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !identifier(&self.run_id)
            || !identifier(&self.session_id)
            || !identifier(&self.process_instance)
            || !hash(&self.capability)
            || !hash(&self.route_sha256)
        {
            return Err("invalid capture binding");
        }
        Ok(())
    }
}

impl Launch {
    pub fn digest(&self) -> Result<String, &'static str> {
        self.validate()?;
        let bytes = serde_json::to_vec(self).map_err(|_| "launch serialization failed")?;
        Ok(format!("{:x}", Sha256::digest(bytes)))
    }

    pub(super) fn validate(&self) -> Result<(), &'static str> {
        if self.executable.is_empty()
            || self.cwd.is_empty()
            || !text(&self.executable)
            || !text(&self.cwd)
            || !hash(&self.executable_sha256)
            || !hash(&self.input_sha256)
            || self.args.len() > 256
            || !self.args.iter().all(|arg| text(arg))
            || self.environment.len() > 512
            || !valid_environment(&self.environment)
            || self.input_bytes > MAX_INPUT
            || self.output_limit == 0
            || self.output_limit > MAX_INPUT
            || self.timeout_ms == 0
            || self.timeout_ms > MAX_TIMEOUT_MS
        {
            return Err("invalid bounded capture launch");
        }
        Ok(())
    }
}

fn valid_environment(environment: &[Environment]) -> bool {
    let mut keys = HashSet::with_capacity(environment.len());
    environment.iter().all(|entry| {
        !entry.key.is_empty()
            && entry.key.len() <= 256
            && entry.key.bytes().all(|b| b.is_ascii_graphic() && b != b'=')
            && text(&entry.value)
            && keys.insert(entry.key.to_ascii_lowercase())
    })
}

pub fn write_packet(writer: &mut impl Write, packet: &Packet) -> Result<(), &'static str> {
    let bytes = serde_json::to_vec(packet).map_err(|_| "capture frame serialization failed")?;
    if bytes.is_empty() || bytes.len() > MAX_FRAME {
        return Err("capture frame length exceeded");
    }
    writer
        .write_all(&(bytes.len() as u32).to_be_bytes())
        .map_err(|_| "capture frame write failed")?;
    writer
        .write_all(&bytes)
        .map_err(|_| "capture frame write failed")?;
    writer.flush().map_err(|_| "capture frame flush failed")
}

/// Streams the already-frozen input once. A write error is ambiguous delivery,
/// never permission to resend. The operational parent must journal before use.
pub fn write_launch(
    writer: &mut impl Write,
    binding: Binding,
    launch: Launch,
    input: &[u8],
) -> Result<(), &'static str> {
    let (header, input) = launch_parts(binding, launch, input)?;
    writer
        .write_all(&header)
        .map_err(|_| "capture frame write failed")?;
    writer
        .write_all(&input)
        .map_err(|_| "capture frame write failed")?;
    writer.flush().map_err(|_| "capture frame flush failed")
}

/// Separate frozen launch and input frames so the parent can wait for the
/// matching launch acknowledgement before transferring any provider input.
pub fn launch_parts(
    binding: Binding,
    launch: Launch,
    input: &[u8],
) -> Result<(Vec<u8>, Vec<u8>), &'static str> {
    binding.validate()?;
    launch.validate()?;
    if input.len() != launch.input_bytes
        || format!("{:x}", Sha256::digest(input)) != launch.input_sha256
    {
        return Err("capture input receipt mismatch");
    }
    let mut header = Vec::new();
    write_packet(
        &mut header,
        &Packet {
            schema_version: VERSION,
            sequence: 0,
            binding: binding.clone(),
            message: Control::Launch { launch },
        },
    )?;
    let mut input_frames = Vec::new();
    let mut sequence = 1;
    for (index, bytes) in input.chunks(MAX_CHUNK).enumerate() {
        write_packet(
            &mut input_frames,
            &Packet {
                schema_version: VERSION,
                sequence,
                binding: binding.clone(),
                message: Control::Input {
                    offset: index * MAX_CHUNK,
                    bytes: bytes.to_vec(),
                },
            },
        )?;
        sequence += 1;
    }
    write_packet(
        &mut input_frames,
        &Packet {
            schema_version: VERSION,
            sequence,
            binding,
            message: Control::InputEnd,
        },
    )?;
    Ok((header, input_frames))
}

fn read_failure(error: std::io::Error, fallback: &'static str) -> &'static str {
    // ERROR_OPERATION_ABORTED comes from the owned Windows thread cancellation.
    // EOF, malformed input and validation errors must never share this marker.
    #[cfg(windows)]
    if error.raw_os_error() == Some(995) {
        return READ_CANCELLED;
    }
    let _ = error;
    fallback
}

fn read_packet(reader: &mut impl Read, wire_bytes: &mut usize) -> Result<Packet, &'static str> {
    let mut prefix = [0u8; 4];
    reader
        .read_exact(&mut prefix)
        .map_err(|error| read_failure(error, "capture frame ended before length"))?;
    let count = u32::from_be_bytes(prefix) as usize;
    if count == 0 || count > MAX_FRAME {
        return Err("capture frame length exceeded");
    }
    *wire_bytes = wire_bytes
        .checked_add(4 + count)
        .filter(|total| *total <= MAX_CONTROL_BYTES)
        .ok_or("capture control byte limit exceeded")?;
    let mut bytes = vec![0; count];
    reader
        .read_exact(&mut bytes)
        .map_err(|error| read_failure(error, "capture frame ended before payload"))?;
    // Never echo raw input or serde's unexpected values: frames can contain
    // credentials in the launch environment and the correlation capability.
    serde_json::from_slice(&bytes).map_err(|_| "malformed capture frame")
}

/// Preloaded control batch, used by the native diagnostic. This is not a
/// recovery/spool authenticator. Duplex hosts must keep Receiver alive for
/// subsequent cancellation/control and enforce their own channel deadline.
pub fn prepare_buffer(bytes: &[u8]) -> Result<Prepared, &'static str> {
    if bytes.len() > MAX_CONTROL_BYTES {
        return Err("capture control batch exceeded limit");
    }
    let mut reader = std::io::Cursor::new(bytes);
    let mut receiver = Receiver::default();
    loop {
        match receiver.read(&mut reader)? {
            Accepted::Pending => {}
            Accepted::Cancelled => return Err("capture launch cancelled"),
            Accepted::ReceiptObserved(_) => return Err("receipt outside live capture"),
            Accepted::Ready(prepared) => {
                if reader.position() as usize != bytes.len() {
                    return Err("extra capture frames after input end");
                }
                return Ok(*prepared);
            }
        }
    }
}

#[derive(Default)]
pub struct Receiver {
    binding: Option<Binding>,
    launch: Option<Launch>,
    input: Vec<u8>,
    next: u64,
    wire_bytes: usize,
    sealed: bool,
    failed: bool,
    observed: bool,
}

impl Receiver {
    /// Available only immediately after validating the first launch frame.
    pub fn launch_header(&self) -> Option<(&Binding, &Launch)> {
        if self.failed || self.next != 1 {
            return None;
        }
        self.binding.as_ref().zip(self.launch.as_ref())
    }

    /// After the one terminal acknowledgement, require actual control EOF.
    /// A caller-owned deadline/cancellation must still bound this read.
    pub fn finish(&mut self, reader: &mut impl Read) -> Result<(), &'static str> {
        if self.failed || !self.observed {
            return Err("capture terminal acknowledgement missing");
        }
        let mut extra = [0];
        self.failed = true;
        match reader.read(&mut extra) {
            Ok(0) => Ok(()),
            Ok(_) => Err("extra control after terminal acknowledgement"),
            Err(error) => Err(read_failure(error, "capture terminal EOF unavailable")),
        }
    }
    /// The caller supplies a deadline/cancelable transport; Read itself has no
    /// timeout. Any framing/state error permanently invalidates this receiver.
    pub fn read(&mut self, reader: &mut impl Read) -> Result<Accepted, &'static str> {
        if self.failed {
            return Err("capture receiver is invalidated");
        }
        let result =
            read_packet(reader, &mut self.wire_bytes).and_then(|packet| self.accept(packet));
        if result.is_err() {
            self.failed = true;
            self.input.clear();
            self.launch = None;
        }
        result
    }

    fn accept(&mut self, packet: Packet) -> Result<Accepted, &'static str> {
        if packet.schema_version != VERSION
            || self.observed
            || packet.sequence != self.next
            || self.next >= MAX_MESSAGES
        {
            return Err("capture version or sequence mismatch");
        }
        packet.binding.validate()?;
        if let Some(binding) = &self.binding {
            if binding != &packet.binding {
                return Err("capture binding mismatch");
            }
        } else if !matches!(packet.message, Control::Launch { .. }) {
            return Err("capture launch must be first");
        }
        self.next += 1;
        match packet.message {
            Control::ReceiptObserved { event_sequence } => {
                if !self.sealed || self.launch.is_some() {
                    return Err("receipt outside prepared capture");
                }
                self.observed = true;
                Ok(Accepted::ReceiptObserved(event_sequence))
            }
            Control::Launch { launch } => {
                if self.binding.is_some() || self.sealed {
                    return Err("duplicate capture launch");
                }
                launch.validate()?;
                self.binding = Some(packet.binding);
                self.launch = Some(launch);
                Ok(Accepted::Pending)
            }
            Control::Input { offset, bytes } => {
                let launch = self
                    .launch
                    .as_ref()
                    .ok_or("input outside capture delivery")?;
                if self.sealed
                    || bytes.is_empty()
                    || bytes.len() > MAX_CHUNK
                    || offset != self.input.len()
                    || bytes.len() > launch.input_bytes.saturating_sub(self.input.len())
                {
                    return Err("capture input offset or length mismatch");
                }
                self.input.extend(bytes);
                Ok(Accepted::Pending)
            }
            Control::InputEnd => {
                let launch = self
                    .launch
                    .as_ref()
                    .ok_or("input end outside capture delivery")?;
                if self.sealed
                    || self.input.len() != launch.input_bytes
                    || format!("{:x}", Sha256::digest(&self.input)) != launch.input_sha256
                {
                    return Err("capture input receipt mismatch");
                }
                self.sealed = true;
                Ok(Accepted::Ready(Box::new(Prepared {
                    binding: self.binding.clone().ok_or("capture binding absent")?,
                    launch: self.launch.take().ok_or("capture launch absent")?,
                    input: std::mem::take(&mut self.input),
                })))
            }
            Control::Cancel => {
                self.sealed = true;
                self.failed = true;
                self.input.clear();
                self.launch = None;
                Ok(Accepted::Cancelled)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn binding() -> Binding {
        Binding {
            run_id: "run-1".into(),
            session_id: "session-1".into(),
            process_instance: "instance-1".into(),
            capability: "a".repeat(64),
            route_sha256: "b".repeat(64),
        }
    }
    fn launch(input: &[u8]) -> Launch {
        Launch {
            executable: "/native/executable".into(),
            executable_sha256: "c".repeat(64),
            args: vec![],
            cwd: "/worktree".into(),
            environment: vec![],
            input_bytes: input.len(),
            input_sha256: format!("{:x}", Sha256::digest(input)),
            output_limit: MAX_INPUT,
            timeout_ms: 1000,
        }
    }
    fn packet(sequence: u64, message: Control) -> Packet {
        Packet {
            schema_version: VERSION,
            sequence,
            binding: binding(),
            message,
        }
    }
    fn feed(receiver: &mut Receiver, packet: Packet) -> Result<Accepted, &'static str> {
        let mut bytes = Vec::new();
        write_packet(&mut bytes, &packet).unwrap();
        receiver.read(&mut bytes.as_slice())
    }
    #[test]
    fn launch_header_is_observable_before_input_and_binds_every_launch_field() {
        let input = b"frozen";
        let launch = launch(input);
        let (header, frames) = launch_parts(binding(), launch.clone(), input).unwrap();
        let mut receiver = Receiver::default();
        assert!(receiver.launch_header().is_none());
        assert!(matches!(
            receiver.read(&mut header.as_slice()),
            Ok(Accepted::Pending)
        ));
        let (observed_binding, observed_launch) = receiver.launch_header().unwrap();
        assert_eq!(observed_binding, &binding());
        assert_eq!(observed_launch.digest().unwrap(), launch.digest().unwrap());
        assert!(receiver.input.is_empty());
        let mut frames = frames.as_slice();
        assert!(matches!(receiver.read(&mut frames), Ok(Accepted::Pending)));
        assert!(receiver.launch_header().is_none());
        assert!(matches!(receiver.read(&mut frames), Ok(Accepted::Ready(_))));
        let value = serde_json::to_value(&launch).unwrap();
        for key in value.as_object().unwrap().keys() {
            let mut changed = value.clone();
            let entry = changed.get_mut(key).unwrap();
            match key.as_str() {
                "executableSha256" | "inputSha256" => *entry = "f".repeat(64).into(),
                "args" => *entry = serde_json::json!(["different"]),
                "environment" => *entry = serde_json::json!([{"key":"CHECK","value":"different"}]),
                "outputLimit" => *entry = (entry.as_u64().unwrap() - 1).into(),
                "inputBytes" | "timeoutMs" => *entry = (entry.as_u64().unwrap() + 1).into(),
                _ => *entry = format!("{}different", entry.as_str().unwrap()).into(),
            }
            let changed: Launch = serde_json::from_value(changed).unwrap();
            assert_ne!(launch.digest().unwrap(), changed.digest().unwrap(), "{key}");
        }
    }

    #[test]
    fn complete_input_is_the_only_path_to_a_prepared_launch() {
        let input = "split 雪 bytes".as_bytes();
        let mut receiver = Receiver::default();
        assert!(matches!(
            feed(
                &mut receiver,
                packet(
                    0,
                    Control::Launch {
                        launch: launch(input)
                    }
                )
            ),
            Ok(Accepted::Pending)
        ));
        assert!(matches!(
            feed(
                &mut receiver,
                packet(
                    1,
                    Control::Input {
                        offset: 0,
                        bytes: input[..7].to_vec()
                    }
                )
            ),
            Ok(Accepted::Pending)
        ));
        assert!(matches!(
            feed(
                &mut receiver,
                packet(
                    2,
                    Control::Input {
                        offset: 7,
                        bytes: input[7..].to_vec()
                    }
                )
            ),
            Ok(Accepted::Pending)
        ));
        let Ok(Accepted::Ready(prepared)) = feed(&mut receiver, packet(3, Control::InputEnd))
        else {
            panic!("complete input must prepare");
        };
        assert_eq!(prepared.input, input);
        assert!(prepared.binding == binding());
        assert_eq!(prepared.launch.executable_sha256, "c".repeat(64));
        assert!(feed(&mut receiver, packet(4, Control::InputEnd)).is_err());
        assert!(feed(&mut receiver, packet(4, Control::Cancel)).is_err());
    }

    #[test]
    fn live_control_reader_enforces_cumulative_wire_budget() {
        let input = vec![b'x'; 24];
        let mut receiver = Receiver::default();
        feed(
            &mut receiver,
            packet(
                0,
                Control::Launch {
                    launch: launch(&input),
                },
            ),
        )
        .unwrap();
        let mut rejected = false;
        for index in 0..24 {
            let mut bytes = serde_json::to_vec(&packet(
                index + 1,
                Control::Input {
                    offset: index as usize,
                    bytes: vec![b'x'],
                },
            ))
            .unwrap();
            bytes.resize(MAX_FRAME, b' ');
            let framed = [
                (bytes.len() as u32).to_be_bytes().as_slice(),
                bytes.as_slice(),
            ]
            .concat();
            if receiver.read(&mut framed.as_slice()).is_err() {
                rejected = true;
                break;
            }
        }
        assert!(
            rejected,
            "individual frames must not evade total wire budget"
        );
        assert!(feed(&mut receiver, packet(25, Control::InputEnd)).is_err());
    }

    #[test]
    fn terminal_receipt_requires_prepared_input_and_rejects_replays() {
        let mut receiver = Receiver::default();
        feed(
            &mut receiver,
            packet(
                0,
                Control::Launch {
                    launch: launch(&[]),
                },
            ),
        )
        .unwrap();
        assert!(feed(
            &mut receiver,
            packet(1, Control::ReceiptObserved { event_sequence: 2 })
        )
        .is_err());
        let mut receiver = Receiver::default();
        feed(
            &mut receiver,
            packet(
                0,
                Control::Launch {
                    launch: launch(&[]),
                },
            ),
        )
        .unwrap();
        feed(&mut receiver, packet(1, Control::InputEnd)).unwrap();
        assert!(matches!(
            feed(
                &mut receiver,
                packet(2, Control::ReceiptObserved { event_sequence: 2 })
            ),
            Ok(Accepted::ReceiptObserved(2))
        ));
        assert!(feed(
            &mut receiver,
            packet(3, Control::ReceiptObserved { event_sequence: 2 })
        )
        .is_err());
    }

    #[test]
    fn terminal_receipt_requires_real_control_eof() {
        for suffix in [vec![], vec![0], vec![0, 0, 0, 1, b'x']] {
            let mut receiver = Receiver::default();
            feed(
                &mut receiver,
                packet(
                    0,
                    Control::Launch {
                        launch: launch(&[]),
                    },
                ),
            )
            .unwrap();
            feed(&mut receiver, packet(1, Control::InputEnd)).unwrap();
            feed(
                &mut receiver,
                packet(2, Control::ReceiptObserved { event_sequence: 2 }),
            )
            .unwrap();
            assert_eq!(
                receiver.finish(&mut suffix.as_slice()).is_ok(),
                suffix.is_empty()
            );
            assert!(receiver.finish(&mut &[][..]).is_err());
        }
    }
    #[test]
    fn corrupted_truncated_reordered_or_rebound_input_never_prepares() {
        for variant in 0..7 {
            let mut receiver = Receiver::default();
            feed(
                &mut receiver,
                packet(
                    0,
                    Control::Launch {
                        launch: launch(b"abc"),
                    },
                ),
            )
            .unwrap();
            let mut next = packet(
                1,
                Control::Input {
                    offset: 0,
                    bytes: b"abc".to_vec(),
                },
            );
            match variant {
                0 => next.sequence = 2,
                1 => next.binding.capability = "d".repeat(64),
                2 => next.binding.run_id = "different-run".into(),
                3 => {
                    next.message = Control::Input {
                        offset: 1,
                        bytes: b"abc".to_vec(),
                    }
                }
                4 => {
                    next.message = Control::Input {
                        offset: 0,
                        bytes: b"abcd".to_vec(),
                    }
                }
                5 => {
                    next.message = Control::Input {
                        offset: 0,
                        bytes: b"ab".to_vec(),
                    }
                }
                _ => {
                    next.message = Control::Input {
                        offset: 0,
                        bytes: b"abd".to_vec(),
                    }
                }
            }
            let result = feed(&mut receiver, next);
            if variant < 5 {
                assert!(result.is_err());
            } else {
                assert!(matches!(result, Ok(Accepted::Pending)));
            }
            assert!(feed(&mut receiver, packet(2, Control::InputEnd)).is_err());
        }
    }
    #[test]
    fn frame_bounds_unknown_fields_eof_and_cancel_fail_closed() {
        for bytes in [
            vec![0, 0, 0, 0],
            ((MAX_FRAME + 1) as u32).to_be_bytes().to_vec(),
            vec![0, 0, 0, 9, b'{'],
            vec![],
        ] {
            let mut receiver = Receiver::default();
            assert!(receiver.read(&mut bytes.as_slice()).is_err());
            assert!(feed(
                &mut receiver,
                packet(
                    0,
                    Control::Launch {
                        launch: launch(b"")
                    }
                )
            )
            .is_err());
        }
        let mut json = serde_json::to_value(packet(
            0,
            Control::Launch {
                launch: launch(b""),
            },
        ))
        .unwrap();
        json["unexpected"] = "secret-must-not-echo".into();
        let payload = serde_json::to_vec(&json).unwrap();
        let mut bytes = (payload.len() as u32).to_be_bytes().to_vec();
        bytes.extend(payload);
        assert_eq!(
            Receiver::default().read(&mut bytes.as_slice()).err(),
            Some("malformed capture frame")
        );
        let mut receiver = Receiver::default();
        feed(
            &mut receiver,
            packet(
                0,
                Control::Launch {
                    launch: launch(b"abc"),
                },
            ),
        )
        .unwrap();
        assert!(matches!(
            feed(&mut receiver, packet(1, Control::Cancel)),
            Ok(Accepted::Cancelled)
        ));
        assert!(feed(&mut receiver, packet(2, Control::InputEnd)).is_err());
    }

    #[test]
    fn launch_writer_rejects_receipt_and_environment_ambiguity() {
        let mut duplicate = launch(b"payload");
        duplicate.environment = vec![
            Environment {
                key: "Path".into(),
                value: "one".into(),
            },
            Environment {
                key: "pAtH".into(),
                value: "two".into(),
            },
        ];
        let mut bytes = Vec::new();
        assert_eq!(
            write_launch(&mut bytes, binding(), duplicate, b"payload").err(),
            Some("invalid bounded capture launch")
        );

        let mut wrong_hash = launch(b"payload");
        wrong_hash.input_sha256 = "d".repeat(64);
        assert_eq!(
            write_launch(&mut bytes, binding(), wrong_hash, b"payload").err(),
            Some("capture input receipt mismatch")
        );
    }

    #[test]
    fn launch_writer_round_trips_bounded_chunks() {
        let input = vec![b'x'; MAX_CHUNK * 2 + 3];
        let mut bytes = Vec::new();
        write_launch(&mut bytes, binding(), launch(&input), &input).unwrap();
        let prepared = prepare_buffer(&bytes).expect("valid chunked launch");
        let (received_binding, received_launch, received_input) = prepared.into_parts();
        assert_eq!(received_binding, binding());
        assert_eq!(received_launch.input_bytes, input.len());
        assert_eq!(received_input, input);
    }

    #[test]
    fn prepared_timeout_preserves_operational_ceiling_without_allowing_overflow() {
        for timeout_ms in [1, 40_000, MAX_TIMEOUT_MS] {
            let mut candidate = launch(b"");
            candidate.timeout_ms = timeout_ms;
            let mut bytes = Vec::new();
            write_launch(&mut bytes, binding(), candidate, b"").unwrap();
            assert_eq!(
                prepare_buffer(&bytes).unwrap().launch().timeout_ms,
                timeout_ms
            );
        }
        for timeout_ms in [0, MAX_TIMEOUT_MS + 1, u64::MAX] {
            let mut candidate = launch(b"");
            candidate.timeout_ms = timeout_ms;
            let mut bytes = Vec::new();
            assert!(write_launch(&mut bytes, binding(), candidate, b"").is_err());
            assert!(bytes.is_empty());
        }
    }
}
