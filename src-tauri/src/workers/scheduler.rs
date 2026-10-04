//! Single-step scheduler core. Production activation requires an unforgeable
//! permit that W4-03 will provide only after the user-approved runtime gates.

use super::{development_route::PreparedRoute, AgentControl};
use crate::{api::RunCredentialIssuer, store::Store};

pub struct SchedulerPermit(());

#[cfg(test)]
pub(super) fn test_permit() -> SchedulerPermit {
    SchedulerPermit(())
}

#[derive(Debug, PartialEq, Eq)]
pub struct DispatchSuccess {
    pub task_id: String,
    pub run_id: String,
    pub worker_id: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DispatchRefusal {
    NoDueTask,
}

pub async fn dispatch_once(
    _permit: &SchedulerPermit,
    _store: &Store,
    _agents: &dyn AgentControl,
    _api: RunCredentialIssuer,
    _project_id: &str,
    _owner: &str,
    _route: &PreparedRoute,
) -> Result<DispatchSuccess, DispatchRefusal> {
    Err(DispatchRefusal::NoDueTask)
}
