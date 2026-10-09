//! Single-flight ownership and download cancellation, independent of the updater.
use std::{
    future::{ready, Future},
    sync::{Arc, Mutex, MutexGuard},
};
use tokio::sync::{watch, Notify};

/// Wire result of `cancel_update_download` (serde camelCase).
/// `Cancelled` = thaw-before-ack; `TooLate` = no thaw; `NotRunning` = no flight
/// or `finish_unstarted` before download (pending cancel gets `NotRunning`).
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
    released: bool,
    /// Set when `finish` starts awaiting thaw; Drop must not clear the slot.
    finishing: bool,
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
            released: false,
            finishing: false,
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
            .clone()
            .ok_or_else(|| "update cancellation state unavailable".to_string())?;
        result
    }
}

/// After `begin`, run maintenance entry; on failure release as `NotRunning`.
pub async fn enter_or_abort<'a>(
    install: Install<'a>,
    enter: impl Future<Output = Result<(), String>>,
) -> Result<Install<'a>, String> {
    if let Err(error) = enter.await {
        install.finish_unstarted()?;
        return Err(error);
    }
    Ok(install)
}

/// Failed body + not started: thaw before cancel ack. Else fixed `Err` keeps the slot.
pub async fn finish_flight(
    install: Install<'_>,
    body: Result<(), String>,
    installer_started: bool,
    thaw: impl Future<Output = Result<(), String>>,
) -> Result<(), String> {
    if body.is_err() && !installer_started {
        return match (body, install.finish(thaw).await) {
            (Err(error), Err(thaw)) => {
                Err(format!("{error} (leaving maintenance also failed: {thaw})"))
            }
            (result, _) => result,
        };
    }
    let _ = install
        .finish(ready(Err(
            "installer may have started; restart before retrying".into(),
        )))
        .await;
    body
}

impl Drop for Install<'_> {
    fn drop(&mut self) {
        if self.released {
            return;
        }
        self.released = true;
        // Fail-closed by phase: Installing or an interrupted thaw keeps the
        // slot (installer may run / app still frozen). Only a drop before or
        // during download may clear it.
        let keep_slot = self.finishing
            || self
                .flight
                .phase
                .lock()
                .map(|phase| *phase == Phase::Installing)
                .unwrap_or(true);
        if !keep_slot {
            if let Ok(mut slot) = self.owner.0.lock() {
                *slot = None;
            }
        }
        let _ = self.done.send(Some(Err(
            "update interrupted; restart before retrying".into()
        )));
    }
}

impl Install<'_> {
    pub fn finish_unstarted(mut self) -> Result<(), String> {
        // Set `released` only after the lock succeeds so Drop still signals
        // when the mutex is poisoned (same ordering as `finish`).
        *lock(&self.owner.0)? = None;
        self.released = true;
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
        mut self,
        thaw: impl Future<Output = Result<(), String>>,
    ) -> Result<(), String> {
        self.finishing = true;
        let result = thaw.await;
        let mut slot = lock(&self.owner.0)?;
        // Failed thaw or an interrupted task keeps the slot occupied, fail-closed.
        if result.is_ok() {
            *slot = None;
        }
        self.released = true;
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

    async fn is_pending<F: Future>(mut future: Pin<&mut F>) -> bool {
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
        // "Freeze" here = single-flight slot occupied (store/PTY freeze lives in main).
        let state = UpdateCancel::default();
        let install = state.begin().unwrap();
        install.download(ready(Ok(()))).await.unwrap();
        assert_eq!(state.cancel().await.unwrap(), CancelResult::TooLate);
        assert!(
            state.begin().is_err(),
            "slot must stay occupied after TooLate until finish"
        );
        install.finish(ready(Ok(()))).await.unwrap();
        assert!(state.begin().is_ok());
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

    #[tokio::test]
    async fn drop_clears_slot_and_signals_fixed_error() {
        let state = UpdateCancel::default();
        let install = state.begin().unwrap();
        let mut cancel = Box::pin(state.cancel());
        assert!(is_pending(cancel.as_mut()).await);
        drop(install);
        assert_eq!(
            cancel.await.unwrap_err(),
            "update interrupted; restart before retrying"
        );
        assert!(state.begin().is_ok());
    }

    #[tokio::test]
    async fn glue_entry_fail_abort_thaw_ack_and_keep_slot() {
        let state = UpdateCancel::default();
        // begin guard + finish_unstarted → NotRunning for pending cancel
        let install = state.begin().unwrap();
        let mut cancel = Box::pin(state.cancel());
        assert!(is_pending(cancel.as_mut()).await);
        match enter_or_abort(install, ready(Err("drain failed".into()))).await {
            Err(error) => assert_eq!(error, "drain failed"),
            Ok(_) => panic!("entry failure must abort"),
        }
        assert_eq!(cancel.await.unwrap(), CancelResult::NotRunning);
        assert!(state.begin().is_ok());

        // cancel during entry drain, then download honors Notify; thaw before ack
        let install = state.begin().unwrap();
        let mut cancel = Box::pin(state.cancel());
        assert!(is_pending(cancel.as_mut()).await);
        let install = enter_or_abort(install, ready(Ok(()))).await.unwrap();
        assert_eq!(
            install
                .download(pending::<Result<(), String>>())
                .await
                .unwrap_err(),
            "Update download cancelled"
        );
        let (thaw, thawed) = oneshot::channel();
        let mut finish = Box::pin(finish_flight(
            install,
            Err("Update download cancelled".into()),
            false,
            async {
                thawed.await.unwrap();
                Ok(())
            },
        ));
        assert!(is_pending(finish.as_mut()).await);
        assert!(is_pending(cancel.as_mut()).await, "ack waits for thaw");
        thaw.send(()).unwrap();
        assert_eq!(finish.await.unwrap_err(), "Update download cancelled");
        assert_eq!(cancel.await.unwrap(), CancelResult::Cancelled);

        // installer started → synthetic Err keeps slot
        let install = state.begin().unwrap();
        install.download(ready(Ok(()))).await.unwrap();
        finish_flight(install, Ok(()), true, ready(Ok(())))
            .await
            .unwrap();
        assert!(state.begin().is_err());
        assert_eq!(state.cancel().await.unwrap(), CancelResult::TooLate);
    }

    #[tokio::test]
    async fn drop_while_installing_keeps_slot_and_signals_fixed_error() {
        let state = UpdateCancel::default();
        let install = state.begin().unwrap();
        install.download(ready(Ok(()))).await.unwrap();
        drop(install);
        assert_eq!(
            state.cancel().await.unwrap(),
            CancelResult::TooLate,
            "Installing drop must keep TooLate, not clear to NotRunning"
        );
        assert!(
            state.begin().is_err(),
            "slot must stay occupied after drop in Installing"
        );
    }

    #[tokio::test]
    async fn drop_while_thaw_pending_keeps_slot_and_signals_fixed_error() {
        let state = UpdateCancel::default();
        let install = state.begin().unwrap();
        let mut cancel = Box::pin(state.cancel());
        assert!(is_pending(cancel.as_mut()).await);
        let (_thaw_tx, thaw_rx) = oneshot::channel::<()>();
        let mut finish = Box::pin(install.finish(async {
            thaw_rx.await.unwrap();
            Ok(())
        }));
        assert!(is_pending(finish.as_mut()).await);
        drop(finish);
        assert_eq!(
            cancel.await.unwrap_err(),
            "update interrupted; restart before retrying"
        );
        assert!(
            state.begin().is_err(),
            "slot must stay occupied when thaw did not complete"
        );
    }

    #[tokio::test]
    async fn drop_during_download_still_clears_slot() {
        let state = UpdateCancel::default();
        let install = state.begin().unwrap();
        let mut cancel = Box::pin(state.cancel());
        assert!(is_pending(cancel.as_mut()).await);
        // Still Downloading (no successful download boundary crossed).
        drop(install);
        assert_eq!(
            cancel.await.unwrap_err(),
            "update interrupted; restart before retrying"
        );
        assert!(
            state.begin().is_ok(),
            "download-phase drop may clear the slot"
        );
    }
}
