//! Private parent/owner handoff. Channel acknowledgement is not independently
//! trusted persistence evidence; the owner must commit before acknowledging.
//! The native pipe loop only uses try_send/try_recv and retains its deadline.
use super::protocol::Binding;
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    Launch,
    Process,
    Input,
    Receipt,
}

pub struct Request {
    pub binding: Binding,
    pub stage: Stage,
    pub payload: Value,
    response: SyncSender<Result<(), String>>,
}

impl Request {
    /// Consuming a request prevents acknowledgement replay. A dropped request
    /// disconnects its specific response lane; another run cannot complete it.
    pub fn acknowledge(self, result: Result<(), String>) -> Result<(), String> {
        self.response
            .try_send(result)
            .map_err(|_| "checkpoint owner no longer waiting".into())
    }
}

pub struct Gate {
    binding: Binding,
    sink: Option<SyncSender<Request>>,
    submitted: usize,
    pending: VecDeque<(Stage, Receiver<Result<(), String>>)>,
    failed: bool,
}

impl Gate {
    /// None is used only by the unpersisted diagnostic wrapper. Operational
    /// integration must supply its owned durable checkpoint consumer.
    pub fn new(binding: Binding, sink: Option<SyncSender<Request>>) -> Self {
        Self {
            binding,
            sink,
            submitted: 0,
            pending: VecDeque::new(),
            failed: false,
        }
    }

    pub fn submit(&mut self, stage: Stage, payload: Value) -> Result<(), String> {
        let expected = [Stage::Launch, Stage::Process, Stage::Input, Stage::Receipt];
        if self.failed || expected.get(self.submitted) != Some(&stage) {
            self.failed = true;
            return Err("checkpoint sequence unavailable".into());
        }
        self.failed = true;
        let (response, received) = mpsc::sync_channel(1);
        let request = Request {
            binding: self.binding.clone(),
            stage,
            payload,
            response,
        };
        if let Some(sink) = &self.sink {
            sink.try_send(request)
                .map_err(|_| "checkpoint consumer unavailable")?;
        } else {
            request.acknowledge(Ok(()))?;
        }
        self.pending.push_back((stage, received));
        self.submitted += 1;
        self.failed = false;
        Ok(())
    }

    pub fn poll(&mut self) -> Result<Option<Stage>, String> {
        if self.failed {
            return Err("checkpoint gate invalidated".into());
        }
        let Some((stage, response)) = self.pending.front() else {
            return Ok(None);
        };
        let stage = *stage;
        match response.try_recv() {
            Ok(Ok(())) => {
                self.pending.pop_front();
                Ok(Some(stage))
            }
            Ok(Err(_)) | Err(TryRecvError::Disconnected) => {
                self.failed = true;
                Err("checkpoint persistence unconfirmed".into())
            }
            Err(TryRecvError::Empty) => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn binding() -> Binding {
        Binding {
            run_id: "run".into(),
            session_id: "session".into(),
            process_instance: "attempt".into(),
            capability: "a".repeat(64),
            route_sha256: "b".repeat(64),
        }
    }
    #[test]
    fn checkpoints_wait_for_their_own_acknowledgements_in_order() {
        let (tx, rx) = mpsc::sync_channel(4);
        let mut gate = Gate::new(binding(), Some(tx));
        gate.submit(Stage::Launch, Value::Null).unwrap();
        gate.submit(Stage::Process, Value::Null).unwrap();
        let launch = rx.recv().unwrap();
        let process = rx.recv().unwrap();
        assert_eq!(launch.binding, binding());
        assert_eq!(launch.stage, Stage::Launch);
        assert_eq!(launch.payload, Value::Null);
        process.acknowledge(Ok(())).unwrap();
        assert_eq!(gate.poll().unwrap(), None);
        launch.acknowledge(Ok(())).unwrap();
        assert_eq!(gate.poll().unwrap(), Some(Stage::Launch));
        assert_eq!(gate.poll().unwrap(), Some(Stage::Process));
        assert_eq!(gate.poll().unwrap(), None);
    }
    #[test]
    fn failed_or_lost_checkpoint_cannot_be_replaced_by_later_success() {
        for failed in [false, true] {
            let (tx, rx) = mpsc::sync_channel(4);
            let mut gate = Gate::new(binding(), Some(tx));
            gate.submit(Stage::Launch, Value::Null).unwrap();
            let request = rx.recv().unwrap();
            if failed {
                request
                    .acknowledge(Err("database unavailable".into()))
                    .unwrap();
            } else {
                drop(request);
            }
            assert!(gate.poll().is_err());
            assert!(gate.submit(Stage::Process, Value::Null).is_err());
            assert!(gate.poll().is_err());
        }
    }
    #[test]
    fn checkpoint_capacity_and_duplicates_fail_without_blocking() {
        let (tx, _rx) = mpsc::sync_channel(0);
        let mut gate = Gate::new(binding(), Some(tx));
        assert!(gate.submit(Stage::Launch, Value::Null).is_err());
        assert!(gate.poll().is_err());
        let mut gate = Gate::new(binding(), None);
        gate.submit(Stage::Launch, Value::Null).unwrap();
        assert!(gate.submit(Stage::Launch, Value::Null).is_err());
        assert!(gate.poll().is_err());
    }
}
