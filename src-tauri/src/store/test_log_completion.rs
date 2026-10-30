//! Test-build bookkeeping for `workers::log_message`: the writer task reports
//! its real insert result, so a test can wait for the write before it closes
//! the pool. Release builds compile none of this.

use super::Store;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

type Receipt = oneshot::Receiver<Result<(), String>>;

/// Receipts of the log writes started through one store and its clones.
#[derive(Clone, Default)]
pub(super) struct LogWrites(Arc<Mutex<Vec<Receipt>>>);

impl Store {
    pub(crate) fn test_pool_is_closed(&self) -> bool {
        self.pool.is_closed()
    }

    /// Register a log write before its task is spawned; the task sends the
    /// actual insert result once it has dropped its own store clone.
    pub(crate) fn register_test_log_write(&self) -> oneshot::Sender<Result<(), String>> {
        let (done, receipt) = oneshot::channel();
        self.log_writes.0.lock().unwrap().push(receipt);
        done
    }

    /// Wait for every registered log write, then close the pool. A failed or
    /// cancelled write fails the test, but only after the pool is closed.
    pub(crate) async fn close_test_pool(&self) {
        let receipts = std::mem::take(&mut *self.log_writes.0.lock().unwrap());
        let mut failures = Vec::new();
        for receipt in receipts {
            match receipt.await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => failures.push(error),
                Err(_) => failures.push("log write ended without a result".to_string()),
            }
        }
        self.pool.close().await;
        assert!(
            failures.is_empty() || std::thread::panicking(),
            "log writes failed: {failures:?}"
        );
    }
}
