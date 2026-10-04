//! Durable terminal reports from one already authenticated worker run.

use crate::store::{development_runs::DevelopmentRun, Store};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkerDelivery {
    Done,
    Blocked { reason: String },
}

pub async fn record_worker_delivery(
    store: &Store,
    run_id: &str,
    _owner: &str,
    _fence: i64,
    delivery: WorkerDelivery,
) -> Result<DevelopmentRun, String> {
    let run = store
        .get_development_run(run_id)
        .await?
        .ok_or_else(|| format!("unknown development run: {run_id}"))?;
    match delivery {
        WorkerDelivery::Done => {
            store
                .complete_development_run(run_id, &run.claim_owner, run.claim_fence, None)
                .await
        }
        WorkerDelivery::Blocked { reason } => {
            store
                .fail_development_run(run_id, &run.claim_owner, run.claim_fence, &reason)
                .await
        }
    }
}
