//! Bound event framing for an owned native host pipe. Decoding does not prove
//! provenance, host exit, durable delivery or successful database settlement.
use super::{host_reply, protocol};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

const MAX_MESSAGES: u64 = 8192;
pub const MAX_WIRE_BYTES: usize = protocol::MAX_INPUT * 12;
const MAX_OUTPUT_CHUNK: usize = 32768;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum OutputEvent {
    Bytes {
        stream: OutputStream,
        offset: usize,
        bytes: Vec<u8>,
    },
    Eof {
        stream: OutputStream,
        offset: usize,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Message {
    LaunchAccepted {
        launch_sha256: String,
    },
    Output {
        event: OutputEvent,
    },
    ProcessVerified {
        identity: Box<host_reply::Identity>,
    },
    InputDelivered {
        input_bytes: usize,
        input_sha256: String,
    },
    Completed {
        receipt: Box<host_reply::Reply>,
    },
    /// Terminal alternative to `Completed`: the provider demonstrably exited
    /// before its input was delivered. Never a receipt; no acknowledgement.
    ExitedUndelivered {
        exit: Box<host_reply::UndeliveredExit>,
    },
}

/// Validated terminal outcome of a lifecycle stream. Only `Completed` is a
/// delivery/receipt; callers must treat every other variant as not delivered.
pub enum Settlement {
    Completed(host_reply::Reply),
    ExitedUndelivered(host_reply::UndeliveredExit),
}

pub enum Event {
    LaunchAccepted,
    Output(OutputEvent),
    ProcessVerified(Box<host_reply::Identity>),
    InputDelivered {
        input_bytes: usize,
        input_sha256: String,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Packet {
    pub schema_version: u32,
    pub sequence: u64,
    pub binding: protocol::Binding,
    pub message: Message,
}

pub struct Sender<W> {
    writer: W,
    binding: protocol::Binding,
    next: u64,
    wire_bytes: usize,
    closed: bool,
    failed: bool,
}

impl<W: Write> Sender<W> {
    pub fn next_sequence(&self) -> u64 {
        self.next
    }
    pub fn new(writer: W, binding: protocol::Binding) -> Result<Self, &'static str> {
        binding.validate()?;
        Ok(Self {
            writer,
            binding,
            next: 0,
            wire_bytes: 0,
            closed: false,
            failed: false,
        })
    }

    /// The owner must bound/cancel the underlying write. Failed or partial
    /// delivery permanently closes this sender: resending would duplicate bytes.
    pub fn send(&mut self, message: Message) -> Result<(), &'static str> {
        if self.failed || self.closed || self.next >= MAX_MESSAGES {
            return Err("event sender unavailable");
        }
        self.failed = true;
        self.closed = matches!(
            &message,
            Message::Completed { .. } | Message::ExitedUndelivered { .. }
        );
        let packet = Packet {
            schema_version: protocol::VERSION,
            sequence: self.next,
            binding: self.binding.clone(),
            message,
        };
        let bytes = serde_json::to_vec(&packet).map_err(|_| "event serialization failed")?;
        if bytes.is_empty() || bytes.len() > protocol::MAX_FRAME {
            return Err("event frame limit exceeded");
        }
        self.wire_bytes = self
            .wire_bytes
            .checked_add(4 + bytes.len())
            .filter(|size| *size <= MAX_WIRE_BYTES)
            .ok_or("event wire limit exceeded")?;
        self.writer
            .write_all(&(bytes.len() as u32).to_be_bytes())
            .map_err(|_| "event write failed")?;
        self.writer
            .write_all(&bytes)
            .map_err(|_| "event write failed")?;
        self.writer.flush().map_err(|_| "event flush failed")?;
        self.next += 1;
        self.failed = false;
        Ok(())
    }
}

#[cfg(test)]
pub fn write_packet(writer: &mut impl Write, packet: &Packet) -> Result<(), &'static str> {
    let bytes = serde_json::to_vec(packet).map_err(|_| "event serialization failed")?;
    if bytes.is_empty() || bytes.len() > protocol::MAX_FRAME {
        return Err("event frame limit exceeded");
    }
    writer
        .write_all(&(bytes.len() as u32).to_be_bytes())
        .map_err(|_| "event write failed")?;
    writer.write_all(&bytes).map_err(|_| "event write failed")?;
    writer.flush().map_err(|_| "event flush failed")
}

pub struct Receiver {
    binding: protocol::Binding,
    launch: protocol::Launch,
    next: u64,
    wire_bytes: usize,
    buffers: [Vec<u8>; 2],
    closed: [bool; 2],
    receipt: Option<host_reply::Reply>,
    undelivered: Option<host_reply::UndeliveredExit>,
    failed: bool,
    lifecycle: bool,
    launch_accepted: bool,
    verified: Option<host_reply::Identity>,
    delivered: bool,
}

impl Receiver {
    pub fn new(binding: protocol::Binding, launch: protocol::Launch) -> Result<Self, &'static str> {
        binding.validate()?;
        launch.validate()?;
        Ok(Self {
            binding,
            launch,
            next: 0,
            wire_bytes: 0,
            buffers: [Vec::new(), Vec::new()],
            closed: [false; 2],
            receipt: None,
            undelivered: None,
            failed: false,
            lifecycle: false,
            launch_accepted: false,
            verified: None,
            delivered: false,
        })
    }

    pub fn with_lifecycle(
        binding: protocol::Binding,
        launch: protocol::Launch,
    ) -> Result<Self, &'static str> {
        let mut receiver = Self::new(binding, launch)?;
        receiver.lifecycle = true;
        Ok(receiver)
    }

    /// The owner supplies a deadline/cancelable Read. A partial read or any
    /// invalid frame permanently invalidates capture; never resume a prefix.
    pub fn read(&mut self, reader: &mut impl Read) -> Result<Option<Event>, &'static str> {
        if self.failed {
            return Err("event receiver invalidated");
        }
        let result = self.read_inner(reader);
        if result.is_err() {
            self.failed = true;
            self.buffers.iter_mut().for_each(Vec::clear);
            self.receipt = None;
            self.undelivered = None;
        }
        result
    }

    fn read_inner(&mut self, reader: &mut impl Read) -> Result<Option<Event>, &'static str> {
        if self.receipt.is_some() || self.undelivered.is_some() || self.next >= MAX_MESSAGES {
            return Err("event sequence is closed or exhausted");
        }
        let mut header = [0; 4];
        reader
            .read_exact(&mut header)
            .map_err(|_| "event frame ended before length")?;
        let length = u32::from_be_bytes(header) as usize;
        if length == 0 || length > protocol::MAX_FRAME {
            return Err("event frame limit exceeded");
        }
        self.wire_bytes = self
            .wire_bytes
            .checked_add(4 + length)
            .filter(|size| *size <= MAX_WIRE_BYTES)
            .ok_or("event wire limit exceeded")?;
        let mut bytes = vec![0; length];
        reader
            .read_exact(&mut bytes)
            .map_err(|_| "event frame ended before payload")?;
        let packet: Packet = serde_json::from_slice(&bytes).map_err(|_| "malformed event frame")?;
        if packet.schema_version != protocol::VERSION
            || packet.binding != self.binding
            || packet.sequence != self.next
        {
            return Err("event binding or sequence mismatch");
        }
        self.next += 1;
        match packet.message {
            Message::LaunchAccepted { launch_sha256 } => {
                if !self.lifecycle
                    || self.next != 1
                    || self.launch_accepted
                    || launch_sha256 != self.launch.digest()?
                {
                    return Err("launch acknowledgement mismatch or out of order");
                }
                self.launch_accepted = true;
                Ok(Some(Event::LaunchAccepted))
            }
            Message::ProcessVerified { identity } => {
                if !self.lifecycle
                    || !self.launch_accepted
                    || self.verified.is_some()
                    || self.next != 2
                {
                    return Err("process observation out of order");
                }
                identity.validate(
                    &self.launch,
                    "native_image_verified_suspended_before_execution",
                )?;
                self.verified = Some((*identity).clone());
                Ok(Some(Event::ProcessVerified(identity)))
            }
            Message::InputDelivered {
                input_bytes,
                input_sha256,
            } => {
                if !self.lifecycle
                    || self.verified.is_none()
                    || self.delivered
                    || input_bytes != self.launch.input_bytes
                    || input_sha256 != self.launch.input_sha256
                {
                    return Err("input delivery observation mismatch");
                }
                self.delivered = true;
                Ok(Some(Event::InputDelivered {
                    input_bytes,
                    input_sha256,
                }))
            }
            Message::Output { event } => {
                if self.lifecycle && self.verified.is_none() {
                    return Err("output before native process observation");
                }
                let (stream, offset) = match &event {
                    OutputEvent::Bytes { stream, offset, .. }
                    | OutputEvent::Eof { stream, offset } => (*stream, *offset),
                };
                let index = if stream == OutputStream::Stdout { 0 } else { 1 };
                if self.closed[index] || offset != self.buffers[index].len() {
                    return Err("event stream position mismatch");
                }
                match &event {
                    OutputEvent::Bytes { bytes, .. } => {
                        if bytes.is_empty()
                            || bytes.len() > MAX_OUTPUT_CHUNK
                            || self.buffers[0].len() + self.buffers[1].len() + bytes.len()
                                > self.launch.output_limit
                        {
                            return Err("event output limit exceeded");
                        }
                        self.buffers[index].extend_from_slice(bytes);
                    }
                    OutputEvent::Eof { .. } => self.closed[index] = true,
                }
                Ok(Some(Event::Output(event)))
            }
            Message::Completed { mut receipt } => {
                if self.lifecycle
                    && (!self.delivered
                        || self.verified.as_ref().is_none_or(|identity| {
                            !identity.same_process(&receipt.capture.identity)
                        }))
                {
                    return Err("completion lacks matching native lifecycle evidence");
                }
                if self.closed != [true; 2]
                    || !receipt.capture.stdout.is_empty()
                    || !receipt.capture.stderr.is_empty()
                {
                    return Err("event completion has unfinished or duplicate streams");
                }
                receipt.capture.stdout = std::mem::take(&mut self.buffers[0]);
                receipt.capture.stderr = std::mem::take(&mut self.buffers[1]);
                let bytes = serde_json::to_vec(&receipt)
                    .map_err(|_| "event completion serialization failed")?;
                self.receipt = Some(host_reply::decode(&bytes, &self.binding, &self.launch)?);
                Ok(None)
            }
            Message::ExitedUndelivered { exit } => {
                // Only a lifecycle stream that verified this very process and
                // never observed delivery may end without a receipt.
                if !self.lifecycle
                    || !self.launch_accepted
                    || self.delivered
                    || self
                        .verified
                        .as_ref()
                        .is_none_or(|identity| !identity.same_process(&exit.identity))
                {
                    return Err("undelivered exit lacks matching native lifecycle evidence");
                }
                if self.closed != [true; 2] {
                    return Err("event completion has unfinished or duplicate streams");
                }
                let bytes = serde_json::to_vec(&exit)
                    .map_err(|_| "event completion serialization failed")?;
                self.undelivered = Some(host_reply::decode_undelivered(
                    &bytes,
                    &self.binding,
                    &self.launch,
                )?);
                Ok(None)
            }
        }
    }

    /// The owner must also confirm native host cleanup. This final read requires
    /// transport EOF and rejects even one trailing byte; retain the read deadline.
    pub fn finish(self, reader: &mut impl Read) -> Result<host_reply::Reply, &'static str> {
        match self.finish_settlement(reader)? {
            Settlement::Completed(receipt) => Ok(receipt),
            Settlement::ExitedUndelivered(_) => Err("event completion missing"),
        }
    }

    /// Like [`Self::finish`], but also yields a validated undelivered exit.
    /// Callers must never treat that variant as a delivery or receipt.
    pub fn finish_settlement(self, reader: &mut impl Read) -> Result<Settlement, &'static str> {
        if self.failed {
            return Err("event receiver invalidated");
        }
        let settlement = match (self.receipt, self.undelivered) {
            (Some(receipt), None) => Settlement::Completed(receipt),
            (None, Some(exit)) => Settlement::ExitedUndelivered(exit),
            _ => return Err("event completion missing"),
        };
        let mut extra = [0];
        match reader.read(&mut extra) {
            Ok(0) => Ok(settlement),
            Ok(_) => Err("extra bytes after event completion"),
            Err(_) => Err("event transport EOF unavailable"),
        }
    }
}

/// Incremental framing for a nonblocking native pipe owner. Progress is not a
/// receipt: the owner must still observe transport EOF and native cleanup.
pub struct IncrementalReceiver {
    receiver: Receiver,
    pending: Vec<u8>,
    completed: bool,
    failed: bool,
}

impl IncrementalReceiver {
    pub fn with_lifecycle(
        binding: protocol::Binding,
        launch: protocol::Launch,
    ) -> Result<Self, &'static str> {
        let mut receiver = Self::new(binding, launch)?;
        receiver.receiver.lifecycle = true;
        Ok(receiver)
    }
    /// Sequence of a completed delivery receipt only; an undelivered exit has
    /// no receipt to checkpoint or acknowledge.
    pub fn completion_sequence(&self) -> Option<u64> {
        if self.completed && !self.failed && self.receiver.receipt.is_some() {
            self.receiver.next.checked_sub(1)
        } else {
            None
        }
    }
    /// Provisional receipt for owner checkpointing, not final settlement: real
    /// wire EOF and native host cleanup must still be confirmed by the owner.
    pub fn pending_receipt(&self) -> Option<&host_reply::Reply> {
        self.completion_sequence()
            .and(self.receiver.receipt.as_ref())
    }
    pub fn new(binding: protocol::Binding, launch: protocol::Launch) -> Result<Self, &'static str> {
        Ok(Self {
            receiver: Receiver::new(binding, launch)?,
            pending: Vec::new(),
            completed: false,
            failed: false,
        })
    }

    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Event>, &'static str> {
        if self.failed {
            return Err("incremental receiver invalidated");
        }
        let result = self.push_inner(bytes);
        if result.is_err() {
            self.failed = true;
            self.pending.clear();
        }
        result
    }

    fn push_inner(&mut self, mut bytes: &[u8]) -> Result<Vec<Event>, &'static str> {
        let mut events = Vec::new();
        while !bytes.is_empty() {
            if self.completed {
                return Err("extra bytes after event completion");
            }
            let target = if self.pending.len() < 4 {
                4
            } else {
                let length = u32::from_be_bytes(self.pending[..4].try_into().unwrap()) as usize;
                if length == 0 || length > protocol::MAX_FRAME {
                    return Err("event frame limit exceeded");
                }
                4 + length
            };
            let count = (target - self.pending.len()).min(bytes.len());
            self.pending.extend_from_slice(&bytes[..count]);
            bytes = &bytes[count..];
            if self.pending.len() == 4 {
                let length = u32::from_be_bytes(self.pending[..4].try_into().unwrap()) as usize;
                if length == 0 || length > protocol::MAX_FRAME {
                    return Err("event frame limit exceeded");
                }
            }
            if self.pending.len() == target && target > 4 {
                match self
                    .receiver
                    .read(&mut std::io::Cursor::new(&self.pending))?
                {
                    Some(event) => events.push(event),
                    None => self.completed = true,
                }
                self.pending.clear();
            }
        }
        Ok(events)
    }

    /// Call only after the native owner has observed real pipe EOF. An empty
    /// push is not EOF and does not authorize completion.
    pub fn finish(self) -> Result<host_reply::Reply, &'static str> {
        match self.finish_settlement()? {
            Settlement::Completed(receipt) => Ok(receipt),
            Settlement::ExitedUndelivered(_) => Err("incremental settlement unavailable"),
        }
    }

    /// True once a validated undelivered exit terminated this stream.
    pub fn exited_undelivered(&self) -> bool {
        self.completed && !self.failed && self.receiver.undelivered.is_some()
    }

    /// Same preconditions as [`Self::finish`]; may yield an undelivered exit.
    pub fn finish_settlement(self) -> Result<Settlement, &'static str> {
        if self.failed || !self.pending.is_empty() || !self.completed {
            return Err("incremental settlement unavailable");
        }
        self.receiver.finish_settlement(&mut std::io::empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incremental_decoder_emits_complete_event_without_waiting_for_exit() {
        let (binding, launch) = fixture();
        let mut wire = Vec::new();
        let mut sender = Sender::new(&mut wire, binding.clone()).unwrap();
        sender
            .send(Message::Output {
                event: OutputEvent::Bytes {
                    stream: OutputStream::Stdout,
                    offset: 0,
                    bytes: b"ready".to_vec(),
                },
            })
            .unwrap();
        let mut receiver = IncrementalReceiver::new(binding, launch).unwrap();
        let mut seen = Vec::new();
        for byte in wire {
            seen.extend(receiver.push(&[byte]).unwrap());
        }
        assert_eq!(
            seen.len(),
            1,
            "complete progress must be available before completion"
        );
        assert!(
            receiver.finish().is_err(),
            "progress cannot settle a capture"
        );
    }

    #[test]
    fn incremental_decoder_handles_fragmentation_and_rejects_every_truncated_prefix() {
        let (binding, launch) = fixture();
        let mut wire = frame(
            &binding,
            0,
            OutputEvent::Eof {
                stream: OutputStream::Stdout,
                offset: 0,
            },
        );
        wire.extend(frame(
            &binding,
            1,
            OutputEvent::Eof {
                stream: OutputStream::Stderr,
                offset: 0,
            },
        ));
        let mut end = completion(&binding, &launch);
        end["sequence"] = 2.into();
        wire.extend(raw_frame(&serde_json::to_vec(&end).unwrap()));
        for size in [1, 2, 3, 4, 7, 32768] {
            let mut receiver = IncrementalReceiver::new(binding.clone(), launch.clone()).unwrap();
            let mut count = 0;
            for chunk in wire.chunks(size) {
                count += receiver.push(chunk).unwrap().len();
            }
            assert_eq!(count, 2);
            assert!(receiver.pending_receipt().is_some());
            let reply = receiver.finish().unwrap();
            assert_eq!(reply.capture.exit_code, u32::MAX);
        }
        for length in 0..wire.len() {
            let mut receiver = IncrementalReceiver::new(binding.clone(), launch.clone()).unwrap();
            receiver.push(&wire[..length]).unwrap();
            assert!(receiver.pending_receipt().is_none());
            assert!(receiver.finish().is_err(), "truncated at {length}");
        }
        let mut receiver = IncrementalReceiver::new(binding.clone(), launch.clone()).unwrap();
        receiver.push(&wire).unwrap();
        assert!(receiver.push(&[0]).is_err());
        assert!(receiver.pending_receipt().is_none());
        assert!(receiver.push(&[]).is_err());
        assert!(receiver.finish().is_err());
        for length in [0u32, protocol::MAX_FRAME as u32 + 1, u32::MAX] {
            let mut receiver = IncrementalReceiver::new(binding.clone(), launch.clone()).unwrap();
            assert!(receiver.push(&length.to_be_bytes()).is_err());
            assert!(receiver.push(&wire).is_err());
            assert!(receiver.finish().is_err());
        }
    }
    fn fixture() -> (protocol::Binding, protocol::Launch) {
        (
            protocol::Binding {
                run_id: "run".into(),
                session_id: "session".into(),
                process_instance: "instance".into(),
                capability: "a".repeat(64),
                route_sha256: "b".repeat(64),
            },
            protocol::Launch {
                executable: "/native".into(),
                executable_sha256: "c".repeat(64),
                args: vec![],
                cwd: "/work".into(),
                environment: vec![],
                input_bytes: 0,
                input_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                    .into(),
                output_limit: 16,
                timeout_ms: 1000,
            },
        )
    }
    fn frame(binding: &protocol::Binding, sequence: u64, event: OutputEvent) -> Vec<u8> {
        let mut bytes = Vec::new();
        write_packet(
            &mut bytes,
            &Packet {
                schema_version: 1,
                sequence,
                binding: binding.clone(),
                message: Message::Output { event },
            },
        )
        .unwrap();
        bytes
    }
    #[test]
    fn reordered_event_sequence_is_rejected_permanently() {
        let (binding, launch) = fixture();
        let bad = frame(
            &binding,
            1,
            OutputEvent::Eof {
                stream: OutputStream::Stdout,
                offset: 0,
            },
        );
        let mut receiver = Receiver::new(binding.clone(), launch).unwrap();
        assert!(receiver.read(&mut &bad[..]).is_err());
        let good = frame(
            &binding,
            0,
            OutputEvent::Eof {
                stream: OutputStream::Stderr,
                offset: 0,
            },
        );
        assert!(receiver.read(&mut &good[..]).is_err());
        assert!(receiver.finish(&mut &[][..]).is_err());
    }

    #[test]
    fn suspended_process_requires_prior_launch_acceptance() {
        let (binding, launch) = fixture();
        let mut identity =
            completion(&binding, &launch)["message"]["receipt"]["capture"]["identity"].clone();
        identity["state"] = "native_image_verified_suspended_before_execution".into();
        let packet = serde_json::json!({"schemaVersion":1,"sequence":0,"binding":binding,
            "message":{"type":"process_verified","identity":identity}});
        let wire = raw_frame(&serde_json::to_vec(&packet).unwrap());
        let mut receiver = Receiver::with_lifecycle(binding, launch).unwrap();
        assert!(receiver.read(&mut wire.as_slice()).is_err());
    }

    #[test]
    fn lifecycle_capture_rejects_completion_without_process_and_delivery_proof() {
        let (mut receiver, end) = ready_receiver();
        receiver.lifecycle = true;
        let bytes = raw_frame(&serde_json::to_vec(&end).unwrap());
        assert!(
            receiver.read(&mut bytes.as_slice()).is_err(),
            "missing native lifecycle evidence"
        );
    }

    #[test]
    fn lifecycle_observations_bind_delivery_order_and_exact_native_process() {
        use serde_json::json;
        let (binding, launch) = fixture();
        let end = completion(&binding, &launch);
        let mut identity = end["message"]["receipt"]["capture"]["identity"].clone();
        identity["state"] = "native_image_verified_suspended_before_execution".into();
        let messages = vec![
            json!({"type":"launch_accepted","launch_sha256":launch.digest().unwrap()}),
            json!({"type":"process_verified","identity":identity}),
            json!({"type":"input_delivered","input_bytes":launch.input_bytes,"input_sha256":launch.input_sha256}),
            json!({"type":"output","event":{"type":"eof","stream":"stdout","offset":0}}),
            json!({"type":"output","event":{"type":"eof","stream":"stderr","offset":0}}),
            end["message"].clone(),
        ];
        let decode = |messages: &[serde_json::Value]| -> Result<host_reply::Reply, &'static str> {
            let mut receiver = Receiver::with_lifecycle(binding.clone(), launch.clone())?;
            for (sequence, message) in messages.iter().enumerate() {
                let packet = json!({"schemaVersion":1,"sequence":sequence,"binding":binding,"message":message});
                let wire = raw_frame(&serde_json::to_vec(&packet).unwrap());
                receiver.read(&mut wire.as_slice())?;
            }
            receiver.finish(&mut std::io::empty())
        };
        assert!(decode(&messages).is_ok());
        for index in [0, 1, 2] {
            let mut missing = messages.clone();
            missing.remove(index);
            assert!(decode(&missing).is_err());
            let mut duplicate = messages.clone();
            duplicate.insert(index, messages[index].clone());
            assert!(decode(&duplicate).is_err());
        }
        for (index, pointer, value) in [
            (
                1,
                "/identity/state",
                json!("native_image_verified_execution_exited_and_pipes_drained"),
            ),
            (0, "/launch_sha256", json!("0".repeat(64))),
            (1, "/identity/createdFiletime", json!("01")),
            (1, "/identity/imageSha256", json!("0".repeat(64))),
            (2, "/input_bytes", json!(1)),
            (2, "/input_sha256", json!("0".repeat(64))),
            (5, "/receipt/capture/identity/processId", json!(43)),
            (5, "/receipt/capture/identity/createdFiletime", json!("2")),
            (5, "/receipt/capture/identity/volumeSerial", json!(2)),
            (5, "/receipt/capture/identity/fileIndex", json!("2")),
            (5, "/receipt/capture/identity/imageSize", json!(4097)),
        ] {
            let mut changed = messages.clone();
            *changed[index].pointer_mut(pointer).unwrap() = value;
            assert!(decode(&changed).is_err(), "{pointer}");
        }
    }

    #[test]
    fn undelivered_exit_requires_verified_process_and_absent_delivery_and_is_no_receipt() {
        use serde_json::json;
        let (binding, launch) = fixture();
        let end = completion(&binding, &launch);
        let mut suspended = end["message"]["receipt"]["capture"]["identity"].clone();
        suspended["state"] = "native_image_verified_suspended_before_execution".into();
        let mut exited = suspended.clone();
        exited["state"] = host_reply::UNDELIVERED_IDENTITY_STATE.into();
        let terminal = json!({"type":"exited_undelivered","exit":{"schemaVersion":1,
            "state":host_reply::UNDELIVERED_EXIT_STATE,"binding":binding,
            "inputBytes":launch.input_bytes,"inputSha256":launch.input_sha256,
            "identity":exited,"exitCode":2,"reason":"provider_exited_before_input_delivery"}});
        let messages = vec![
            json!({"type":"launch_accepted","launch_sha256":launch.digest().unwrap()}),
            json!({"type":"process_verified","identity":suspended}),
            json!({"type":"output","event":{"type":"bytes","stream":"stderr","offset":0,"bytes":[10]}}),
            json!({"type":"output","event":{"type":"eof","stream":"stdout","offset":0}}),
            json!({"type":"output","event":{"type":"eof","stream":"stderr","offset":1}}),
            terminal,
        ];
        let wire = |messages: &[serde_json::Value]| -> Vec<u8> {
            messages
                .iter()
                .enumerate()
                .flat_map(|(sequence, message)| {
                    raw_frame(
                        &serde_json::to_vec(&json!({"schemaVersion":1,
                        "sequence":sequence,"binding":binding,"message":message}))
                        .unwrap(),
                    )
                })
                .collect()
        };
        let decode = |messages: &[serde_json::Value]| -> Result<Settlement, &'static str> {
            let mut receiver =
                IncrementalReceiver::with_lifecycle(binding.clone(), launch.clone())?;
            receiver.push(&wire(messages))?;
            // An undelivered exit never yields a receipt to checkpoint or ack.
            assert!(receiver.completion_sequence().is_none());
            assert!(receiver.pending_receipt().is_none());
            receiver.finish_settlement()
        };
        match decode(&messages).unwrap() {
            Settlement::ExitedUndelivered(exit) => assert_eq!(exit.exit_code, 2),
            Settlement::Completed(_) => panic!("undelivered exit decoded as a receipt"),
        }
        let mut receiver =
            IncrementalReceiver::with_lifecycle(binding.clone(), launch.clone()).unwrap();
        receiver.push(&wire(&messages)).unwrap();
        assert!(receiver.exited_undelivered());
        assert!(
            receiver.finish().is_err(),
            "a receipt-only caller must not accept an undelivered exit"
        );
        // Without launch acceptance, process verification or drained streams,
        // and after an input delivery observation, it is rejected.
        for index in [0, 1, 3, 4] {
            let mut missing = messages.clone();
            missing.remove(index);
            assert!(decode(&missing).is_err(), "missing {index}");
        }
        let mut delivered = messages.clone();
        delivered.insert(
            2,
            json!({"type":"input_delivered","input_bytes":launch.input_bytes,"input_sha256":launch.input_sha256}),
        );
        assert!(decode(&delivered).is_err());
        for (pointer, value) in [
            ("/exit/identity/processId", json!(43)),
            (
                "/exit/identity/state",
                json!("native_image_verified_execution_exited_and_pipes_drained"),
            ),
            ("/exit/inputSha256", json!("0".repeat(64))),
            ("/exit/state", json!("native_protocol_capture_completed")),
        ] {
            let mut changed = messages.clone();
            *changed[5].pointer_mut(pointer).unwrap() = value;
            assert!(decode(&changed).is_err(), "{pointer}");
        }
        let mut trailing = messages.clone();
        trailing.push(json!({"type":"output","event":{"type":"eof","stream":"stdout","offset":0}}));
        assert!(decode(&trailing).is_err());
        // A non-lifecycle stream has no process evidence for this variant.
        let mut plain = IncrementalReceiver::new(binding.clone(), launch.clone()).unwrap();
        assert!(plain.push(&wire(&messages[2..])).is_err());
    }

    fn completion(binding: &protocol::Binding, launch: &protocol::Launch) -> serde_json::Value {
        serde_json::json!({"schemaVersion":1,"sequence":4,"binding":binding,
            "message":{"type":"completed","receipt":{"schemaVersion":1,
                "state":"native_protocol_capture_completed","binding":binding,
                "inputBytes":launch.input_bytes,"inputSha256":launch.input_sha256,
                "capture":{"identity":{"schemaVersion":1,"processId":42,
                    "createdFiletime":"18446744073709551615","volumeSerial":1,
                    "fileIndex":"0","imageSize":4096,"imageSha256":launch.executable_sha256,
                    "state":"native_image_verified_execution_exited_and_pipes_drained"},
                    "exitCode":4294967295u32,"stdout":[],"stderr":[]}}}})
    }

    fn raw_frame(bytes: &[u8]) -> Vec<u8> {
        [(bytes.len() as u32).to_be_bytes().to_vec(), bytes.to_vec()].concat()
    }

    fn ready_receiver() -> (Receiver, serde_json::Value) {
        let (binding, launch) = fixture();
        let end = completion(&binding, &launch);
        let mut receiver = Receiver::new(binding.clone(), launch).unwrap();
        for (sequence, event) in [
            OutputEvent::Bytes {
                stream: OutputStream::Stdout,
                offset: 0,
                bytes: vec![255, 0, 128],
            },
            OutputEvent::Bytes {
                stream: OutputStream::Stderr,
                offset: 0,
                bytes: vec![10],
            },
            OutputEvent::Eof {
                stream: OutputStream::Stderr,
                offset: 1,
            },
            OutputEvent::Eof {
                stream: OutputStream::Stdout,
                offset: 3,
            },
        ]
        .into_iter()
        .enumerate()
        {
            assert!(receiver
                .read(&mut &frame(&binding, sequence as u64, event)[..])
                .unwrap()
                .is_some());
        }
        (receiver, end)
    }

    #[test]
    fn framed_completion_preserves_raw_streams_and_requires_transport_eof() {
        let (mut receiver, end) = ready_receiver();
        let bytes = raw_frame(&serde_json::to_vec(&end).unwrap());
        // Single-byte reads exercise all header and payload fragmentation.
        struct Fragmented<'a>(&'a [u8]);
        impl Read for Fragmented<'_> {
            fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
                let count = out.len().min(self.0.len()).min(1);
                out[..count].copy_from_slice(&self.0[..count]);
                self.0 = &self.0[count..];
                Ok(count)
            }
        }
        assert!(receiver.read(&mut Fragmented(&bytes)).unwrap().is_none());
        let reply = receiver.finish(&mut &[][..]).unwrap();
        assert_eq!(reply.capture.stdout, [255, 0, 128]);
        assert_eq!(reply.capture.stderr, [10]);
        assert_eq!(reply.capture.exit_code, u32::MAX);
        let (mut receiver, _) = ready_receiver();
        receiver.read(&mut &bytes[..]).unwrap();
        assert!(receiver.finish(&mut &[0][..]).is_err());
        let (receiver, _) = ready_receiver();
        assert!(
            receiver.finish(&mut &[][..]).is_err(),
            "EOF is not completion"
        );
    }

    #[test]
    fn completion_rejects_rebinding_duplicate_payload_and_bad_identity() {
        for (pointer, value) in [
            ("/binding/runId", serde_json::json!("other")),
            ("/binding/sessionId", serde_json::json!("other")),
            ("/binding/processInstance", serde_json::json!("other")),
            ("/binding/capability", serde_json::json!("d".repeat(64))),
            ("/binding/routeSha256", serde_json::json!("d".repeat(64))),
            ("/schemaVersion", serde_json::json!(2)),
            ("/message/receipt/binding/runId", serde_json::json!("other")),
            ("/message/receipt/inputBytes", serde_json::json!(1)),
            (
                "/message/receipt/capture/stdout",
                serde_json::json!([255, 0, 128]),
            ),
            (
                "/message/receipt/capture/identity/imageSha256",
                serde_json::json!("d".repeat(64)),
            ),
            (
                "/message/receipt/capture/identity/createdFiletime",
                serde_json::json!("01"),
            ),
        ] {
            let (mut receiver, mut end) = ready_receiver();
            *end.pointer_mut(pointer).unwrap() = value;
            let bytes = raw_frame(&serde_json::to_vec(&end).unwrap());
            assert!(receiver.read(&mut &bytes[..]).is_err(), "{pointer}");
            assert!(receiver.finish(&mut &[][..]).is_err());
        }
    }

    #[test]
    fn malformed_or_partial_frames_cannot_be_resumed() {
        let (binding, launch) = fixture();
        let valid = frame(
            &binding,
            0,
            OutputEvent::Eof {
                stream: OutputStream::Stdout,
                offset: 0,
            },
        );
        let json = String::from_utf8(valid[4..].to_vec()).unwrap();
        for malformed in [
            vec![],
            vec![0, 0, 0],
            vec![0; 4],
            ((protocol::MAX_FRAME + 1) as u32).to_be_bytes().to_vec(),
            valid[..valid.len() - 1].to_vec(),
            raw_frame(
                json.replacen("\"sequence\":0", "\"sequence\":0,\"sequence\":0", 1)
                    .as_bytes(),
            ),
            raw_frame(
                json.replacen(
                    "\"type\":\"eof\"",
                    "\"type\":\"eof\",\"unexpected\":true",
                    1,
                )
                .as_bytes(),
            ),
        ] {
            let mut receiver = Receiver::new(binding.clone(), launch.clone()).unwrap();
            assert!(receiver.read(&mut &malformed[..]).is_err());
            assert!(receiver.read(&mut &valid[..]).is_err());
        }
    }

    #[test]
    fn output_offsets_bounds_eof_and_completion_order_are_enforced() {
        let (binding, launch) = fixture();
        for event in [
            OutputEvent::Bytes {
                stream: OutputStream::Stdout,
                offset: 1,
                bytes: vec![1],
            },
            OutputEvent::Bytes {
                stream: OutputStream::Stdout,
                offset: 0,
                bytes: vec![],
            },
            OutputEvent::Bytes {
                stream: OutputStream::Stderr,
                offset: 0,
                bytes: vec![0; 17],
            },
            OutputEvent::Eof {
                stream: OutputStream::Stderr,
                offset: 1,
            },
        ] {
            let mut receiver = Receiver::new(binding.clone(), launch.clone()).unwrap();
            assert!(receiver.read(&mut &frame(&binding, 0, event)[..]).is_err());
        }
        for event in [
            OutputEvent::Eof {
                stream: OutputStream::Stdout,
                offset: 0,
            },
            OutputEvent::Bytes {
                stream: OutputStream::Stdout,
                offset: 0,
                bytes: vec![1],
            },
        ] {
            let mut receiver = Receiver::new(binding.clone(), launch.clone()).unwrap();
            receiver
                .read(
                    &mut &frame(
                        &binding,
                        0,
                        OutputEvent::Eof {
                            stream: OutputStream::Stdout,
                            offset: 0,
                        },
                    )[..],
                )
                .unwrap();
            assert!(receiver.read(&mut &frame(&binding, 1, event)[..]).is_err());
        }
        let mut receiver = Receiver::new(binding.clone(), launch.clone()).unwrap();
        let mut end = completion(&binding, &launch);
        end["sequence"] = serde_json::json!(0);
        assert!(receiver
            .read(&mut &raw_frame(&serde_json::to_vec(&end).unwrap())[..])
            .is_err());
        let mut receiver = Receiver::new(binding.clone(), launch).unwrap();
        receiver
            .read(
                &mut &frame(
                    &binding,
                    0,
                    OutputEvent::Bytes {
                        stream: OutputStream::Stdout,
                        offset: 0,
                        bytes: vec![0; 8],
                    },
                )[..],
            )
            .unwrap();
        assert!(receiver
            .read(
                &mut &frame(
                    &binding,
                    1,
                    OutputEvent::Bytes {
                        stream: OutputStream::Stderr,
                        offset: 0,
                        bytes: vec![0; 9]
                    }
                )[..]
            )
            .is_err());
    }

    #[test]
    fn whitespace_padding_cannot_evade_total_wire_budget() {
        let (binding, mut launch) = fixture();
        launch.output_limit = protocol::MAX_INPUT;
        let mut receiver = Receiver::new(binding.clone(), launch).unwrap();
        for sequence in 0..(MAX_WIRE_BYTES / protocol::MAX_FRAME) {
            let encoded = frame(
                &binding,
                sequence as u64,
                OutputEvent::Bytes {
                    stream: OutputStream::Stdout,
                    offset: sequence,
                    bytes: vec![1],
                },
            );
            let mut payload = encoded[4..].to_vec();
            payload.resize(protocol::MAX_FRAME, b' ');
            let result = receiver.read(&mut &raw_frame(&payload)[..]);
            if sequence == MAX_WIRE_BYTES / protocol::MAX_FRAME - 1 {
                assert!(result.is_err());
            } else {
                assert!(result.is_ok());
            }
        }
        assert!(receiver.finish(&mut &[][..]).is_err());
    }

    #[test]
    fn partial_frame_writes_cannot_be_retried() {
        struct PartialWriter {
            calls: usize,
        }
        impl Write for PartialWriter {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.calls += 1;
                if self.calls == 1 {
                    Ok(bytes.len().min(1))
                } else {
                    Err(std::io::Error::other("private underlying error"))
                }
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let (binding, _) = fixture();
        let mut sender = Sender::new(PartialWriter { calls: 0 }, binding).unwrap();
        let message = || Message::Output {
            event: OutputEvent::Eof {
                stream: OutputStream::Stdout,
                offset: 0,
            },
        };
        assert_eq!(sender.send(message()), Err("event write failed"));
        let calls = sender.writer.calls;
        assert_eq!(sender.send(message()), Err("event sender unavailable"));
        assert_eq!(sender.writer.calls, calls);
    }

    #[test]
    fn sender_sequence_budget_cannot_be_extended() {
        let (binding, _) = fixture();
        let mut sender = Sender::new(Vec::new(), binding).unwrap();
        for sequence in 0..MAX_MESSAGES {
            sender
                .send(Message::Output {
                    event: OutputEvent::Bytes {
                        stream: OutputStream::Stdout,
                        offset: sequence as usize,
                        bytes: vec![1],
                    },
                })
                .unwrap();
        }
        let length = sender.writer.len();
        assert!(sender
            .send(Message::Output {
                event: OutputEvent::Eof {
                    stream: OutputStream::Stdout,
                    offset: MAX_MESSAGES as usize
                }
            })
            .is_err());
        assert_eq!(sender.writer.len(), length);
    }
}
