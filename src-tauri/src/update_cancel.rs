//! Single-flight ownership and download cancellation, independent of the updater.
use std::future::Future;

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CancelResult {
    Cancelled,
    TooLate,
    NotRunning,
}

#[derive(Default)]
pub struct UpdateCancel;
pub struct Install;
impl UpdateCancel {
    pub fn begin(&self) -> Result<Install, String> {
        Ok(Install)
    }
    pub async fn cancel(&self) -> Result<CancelResult, String> {
        Ok(CancelResult::Cancelled)
    }
}
impl Install {
    pub async fn download<T>(
        &self,
        future: impl Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        future.await
    }
    pub async fn finish(self, thaw: impl Future<Output = Result<(), String>>) {
        let _ = thaw.await;
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
        finish.await;
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
        install.finish(ready(Ok(()))).await;
        assert!(frozen.replace(false));
    }

    #[tokio::test]
    async fn cancel_without_running_install_reports_not_running() {
        let state = UpdateCancel::default();
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
        finish.await;
        assert_eq!(cancel.await.unwrap(), CancelResult::Cancelled);
        assert!(state.begin().is_ok());
    }
}
