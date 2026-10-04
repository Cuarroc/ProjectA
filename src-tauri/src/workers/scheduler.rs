//! Single-step scheduler core. Production activation requires an unforgeable
//! permit that W4-03 will provide only after the user-approved runtime gates.
use super::{development, development_route::PreparedRoute, AgentControl};
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
}
#[derive(Debug, PartialEq, Eq)]
pub enum DispatchRefusal {
    NoDueTask,
    Snapshot(String),
    Route(String),
    Admission(String),
    Intent(String),
    Launch(String),
}

pub async fn dispatch_once(
    _permit: &SchedulerPermit,
    store: &Store,
    agents: &dyn AgentControl,
    api: RunCredentialIssuer,
    project_id: &str,
    owner: &str,
    route: &PreparedRoute,
) -> Result<DispatchSuccess, DispatchRefusal> {
    let context = store
        .continuous_context(project_id, 0)
        .await
        .map_err(DispatchRefusal::Snapshot)?;
    let now = crate::store::now_unix_secs();
    let task = context
        .tasks
        .into_iter()
        .find(|task| {
            task.status == "open"
                && context.goals.iter().any(|goal| {
                    goal.id == task.goal_id
                        && goal.status == "open"
                        && goal.admitted
                        && goal.deadline_at > now
                })
        })
        .ok_or(DispatchRefusal::NoDueTask)?;
    if task
        .profile_id
        .as_deref()
        .is_some_and(|profile| profile != route.profile().id)
    {
        return Err(DispatchRefusal::Route(format!(
            "task {} requires a different profile",
            task.id
        )));
    }
    let tokens = route
        .estimated_task_tokens()
        .map_err(DispatchRefusal::Route)?;
    let claim = store
        .claim_continuous_task(&task.id, owner, false)
        .await
        .map_err(DispatchRefusal::Admission)?;
    let run = store
        .record_development_run_intent(&task.id, owner, claim.fence)
        .await
        .map_err(DispatchRefusal::Intent)?;
    let purpose = crate::store::development_budget::BudgetPurpose::for_dispatch_role(
        store
            .development_run_role(&run.id)
            .await
            .map_err(DispatchRefusal::Intent)?,
    );
    store
        .reserve_development_tokens(&task.goal_id, &run.id, purpose, tokens, Some(&run.id))
        .await
        .map_err(DispatchRefusal::Admission)?;
    development::launch_worker(store, agents, api, &run.id, owner, claim.fence, route)
        .await
        .map_err(DispatchRefusal::Launch)?;
    Ok(DispatchSuccess {
        task_id: task.id,
        run_id: run.id,
    })
}
