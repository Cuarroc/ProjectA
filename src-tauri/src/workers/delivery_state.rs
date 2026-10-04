//! Durable terminal reports from one already authenticated worker run.

use crate::store::{
    development_runs::{DevelopmentRun, RUN_COMPLETED, RUN_FAILED},
    Store,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkerDelivery {
    Done,
    Blocked { reason: String },
}

pub async fn record_worker_delivery(
    store: &Store,
    run_id: &str,
    owner: &str,
    fence: i64,
    delivery: WorkerDelivery,
) -> Result<DevelopmentRun, String> {
    let (result, terminal, detail) = match delivery {
        WorkerDelivery::Done => (
            store
                .complete_development_run(run_id, owner, fence, None)
                .await,
            RUN_COMPLETED,
            None,
        ),
        WorkerDelivery::Blocked { reason } => {
            let reason = reason.trim().to_string();
            (
                store
                    .fail_development_run(run_id, owner, fence, &reason)
                    .await,
                RUN_FAILED,
                Some(reason),
            )
        }
    };
    let error = match result {
        Ok(run) => return Ok(run),
        Err(error) => error,
    };

    // `transition_run` checks the live task owner/fence under BEGIN IMMEDIATE
    // before producing this exact terminal-to-terminal error. Only that error
    // can be an authorized replay; stale credentials and another run retain
    // their original refusal instead of being mistaken for idempotency.
    if error != format!("development run cannot transition from {terminal} to {terminal}") {
        return Err(error);
    }
    let run = store
        .get_development_run(run_id)
        .await?
        .ok_or_else(|| format!("unknown development run: {run_id}"))?;
    if run.claim_owner != owner
        || run.claim_fence != fence
        || run.status != terminal
        || detail
            .as_deref()
            .is_some_and(|value| run.terminal_detail.as_deref() != Some(value))
    {
        return Err(error);
    }
    Ok(run)
}
