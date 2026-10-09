//! Single-flight ownership and download cancellation, independent of the updater.
use std::{
    future::Future,
    sync::{Arc, Mutex, MutexGuard},
};
use tokio::sync::{watch, Notify};

#[derive(Debug, PartialEq, Eq, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CancelResult {
    Cancelled,
    TooLate,
    NotRunning,
}
#[derive(PartialEq)]
enum Phase {
    Downloading,
    CancelRequested,
    Installing,
}
struct Flight {
    phase: Mutex<Phase>,
    cancel: Notify,
    done: watch::Receiver<Option<Result<CancelResult, String>>>,
}
#[derive(Default)]
pub struct UpdateCancel(Mutex<Option<Arc<Flight>>>);
pub struct Install<'a> {
    owner: &'a UpdateCancel,
    flight: Arc<Flight>,
    done: watch::Sender<Option<Result<CancelResult, String>>>,
}
fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, String> {
    mutex
        .lock()
        .map_err(|_| "update cancellation state unavailable".into())
}
impl UpdateCancel {
    pub fn begin(&self) -> Result<Install<'_>, String> {
        let mut slot = lock(&self.0)?;
        if slot.is_some() {
            return Err(format!(
                "{}update install already running",
                crate::errors::ERR_REFUSED
            ));
        }
        let (done, receiver) = watch::channel(None);
        let flight = Arc::new(Flight {
            phase: Mutex::new(Phase::Downloading),
            cancel: Notify::new(),
            done: receiver,
        });
        *slot = Some(flight.clone());
        Ok(Install {
            owner: self,
            flight,
            done,
        })
    }
    pub async fn cancel(&self) -> Result<CancelResult, String> {
        let mut done = {
            let slot = lock(&self.0)?;
            let Some(flight) = slot.as_ref() else {
                return Ok(CancelResult::NotRunning);
            };
            let mut phase = lock(&flight.phase)?;
            if *phase == Phase::Installing {
                return Ok(CancelResult::TooLate);
            }
            *phase = Phase::CancelRequested;
            flight.cancel.notify_one();
            flight.done.clone()
        };
        let result = done
            .wait_for(|result| result.is_some())
            .await
            .map_err(|_| "update interrupted; restart before retrying".to_string())?
            .as_ref()
            .unwrap()
            .clone();
        result
    }
}
impl Install<'_> {
    pub fn finish_unstarted(self) -> Result<(), String> {
        *lock(&self.owner.0)? = None;
        self.done.send_replace(Some(Ok(CancelResult::NotRunning)));
        Ok(())
    }
    pub async fn download<T>(
        &self,
        future: impl Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        let mut future = std::pin::pin!(future);
        let mut cancel = std::pin::pin!(self.flight.cancel.notified());
        let result = std::future::poll_fn(|cx| {
            if cancel.as_mut().poll(cx).is_ready() {
                return std::task::Poll::Ready(Err("Update download cancelled".into()));
            }
            future.as_mut().poll(cx)
        })
        .await;
        // Serialize cancellation with the boundary BEFORE any journal is produced.
        let mut phase = lock(&self.flight.phase)?;
        if *phase == Phase::CancelRequested {
            return Err("Update download cancelled".into());
        }
        if result.is_ok() {
            *phase = Phase::Installing;
        }
        result
    }
    pub async fn finish(
        self,
        thaw: impl Future<Output = Result<(), String>>,
    ) -> Result<(), String> {
        let result = thaw.await;
        let mut slot = lock(&self.owner.0)?;
        // Failed thaw or an interrupted task keeps the slot occupied, fail-closed.
        if result.is_ok() {
            *slot = None;
        }
        self.done
            .send_replace(Some(result.clone().map(|()| CancelResult::Cancelled)));
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::Cell,
        future::{pending, poll_fn, ready},
        pin::Pin,
        task::Poll,
    };
    use tokio::sync::oneshot;

    async fn is_pending<F: Future>(future: Pin<&mut F>) -> bool {
        let mut future = future;
        poll_fn(|cx| Poll::Ready(future.as_mut().poll(cx).is_pending())).await
    }

    #[tokio::test]
    async fn cancel_during_download_aborts_and_thaws_before_ack() {
        struct Dropped<'a>(&'a Cell<bool>);
        impl Drop for Dropped<'_> {
            fn drop(&mut self) {
                self.0.set(true);
            }
        }
        let state = UpdateCancel::default();
        let install = state.begin().unwrap();
        let dropped = Cell::new(false);
        let probe = Dropped(&dropped);
        let mut download = Box::pin(install.download(async move {
            let _probe = probe;
            pending::<Result<(), String>>().await
        }));
        assert!(is_pending(download.as_mut()).await);
        let mut cancel = Box::pin(state.cancel());
        assert!(is_pending(cancel.as_mut()).await, "ack must wait for thaw");
        assert_eq!(download.await.unwrap_err(), "Update download cancelled");
        assert!(dropped.get(), "the download future must be dropped");
        let (thaw, thawed) = oneshot::channel();
        let mut finish = Box::pin(install.finish(async {
            thawed.await.unwrap();
            Ok(())
        }));
        assert!(is_pending(finish.as_mut()).await);
        assert!(is_pending(cancel.as_mut()).await);
        thaw.send(()).unwrap();
        finish.await.unwrap();
        assert_eq!(cancel.await.unwrap(), CancelResult::Cancelled);
        assert!(state.begin().is_ok());
    }

    #[tokio::test]
    async fn cancel_after_installer_started_is_too_late_and_keeps_freeze() {
        let state = UpdateCancel::default();
        let install = state.begin().unwrap();
        install.download(ready(Ok(()))).await.unwrap();
        let frozen = Cell::new(true);
        assert_eq!(state.cancel().await.unwrap(), CancelResult::TooLate);
        assert!(frozen.get());
        assert!(state.begin().is_err());
        // No thaw is scheduled once the install boundary has been crossed.
        install.finish(ready(Ok(()))).await.unwrap();
        assert!(frozen.replace(false));
    }

    #[tokio::test]
    async fn cancel_without_running_install_reports_not_running() {
        let state = UpdateCancel::default();
        assert_eq!(state.cancel().await.unwrap(), CancelResult::NotRunning);
        state.begin().unwrap().finish_unstarted().unwrap();
        assert_eq!(state.cancel().await.unwrap(), CancelResult::NotRunning);
    }

    #[tokio::test]
    async fn second_install_is_refused_until_thaw_completed() {
        let state = UpdateCancel::default();
        let install = state.begin().unwrap();
        assert!(state
            .begin()
            .err()
            .unwrap()
            .starts_with(crate::errors::ERR_REFUSED));
        let mut cancel = Box::pin(state.cancel());
        assert!(is_pending(cancel.as_mut()).await);
        let (thaw, thawed) = oneshot::channel();
        let mut finish = Box::pin(install.finish(async {
            thawed.await.unwrap();
            Ok(())
        }));
        assert!(is_pending(finish.as_mut()).await);
        assert!(state.begin().is_err());
        thaw.send(()).unwrap();
        finish.await.unwrap();
        assert_eq!(cancel.await.unwrap(), CancelResult::Cancelled);
        let retry = state.begin().unwrap();
        let mut cancel = Box::pin(state.cancel());
        assert!(is_pending(cancel.as_mut()).await);
        assert!(retry
            .finish(ready(Err("thaw failed".into())))
            .await
            .is_err());
        assert_eq!(cancel.await.unwrap_err(), "thaw failed");
        assert!(state.begin().is_err());
    }
}
