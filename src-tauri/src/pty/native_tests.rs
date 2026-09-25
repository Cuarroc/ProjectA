use super::*;

#[test]
fn owned_manager_handle_shares_identifiers_inventory_and_installation_latch() {
    let original = PtyManager::default();
    let owned = original.clone();
    let first = original.reserve_session().unwrap();
    let second = owned.reserve_session().unwrap();
    assert_ne!(first, second);
    assert_eq!(original.live_session_ids().unwrap().len(), 2);
    assert_eq!(owned.live_session_ids().unwrap().len(), 2);
    assert!(owned
        .install_when_idle(|| panic!("sessions still reserved"))
        .is_err());
    original.cancel_reservation(&second);
    owned.cancel_reservation(&first);
    owned.install_when_idle(|| Ok(())).unwrap();
    assert!(original.reserve_session().is_err());
    assert!(owned.reserve_session().is_err());
}

#[test]
fn queued_native_cancellation_prevents_later_execution() {
    for all in [false, true] {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        if all {
            manager.kill_all();
        } else {
            let _ = manager.kill(&id);
        }
        let executed = AtomicBool::new(false);
        let result = manager.run_native_session(&id, |_| {
            executed.store(true, Ordering::SeqCst);
            Ok(())
        });
        assert!(
            !executed.load(Ordering::SeqCst),
            "queued native operation started after cancellation"
        );
        assert!(result.is_err());
        assert_eq!(manager.live_session_ids().unwrap(), vec![id.clone()]);
        manager.cancel_reservation(&id);
        assert!(manager.live_session_ids().unwrap().is_empty());
    }
}

#[test]
fn native_session_blocks_installation_and_interactive_operations_until_retirement() {
    let manager = PtyManager::default();
    let id = manager.reserve_session().unwrap();
    manager
        .run_native_session(&id, |_| {
            assert_eq!(manager.live_session_ids().unwrap(), vec![id.clone()]);
            assert!(manager
                .install_when_idle(|| panic!("native session is active"))
                .is_err());
            assert!(manager.write(&id, "unexpected input").is_err());
            assert!(manager.resize(&id, 80, 24).is_err());
            manager.cancel_reservation(&id);
            assert_eq!(manager.live_session_ids().unwrap(), vec![id.clone()]);
            Ok(())
        })
        .unwrap();
    assert!(manager.live_session_ids().unwrap().is_empty());
}

#[test]
fn native_cancel_requests_do_not_remove_live_inventory() {
    for all in [false, true] {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        manager
            .run_native_session(&id, |cancelled| {
                assert!(!cancelled.load(Ordering::Acquire));
                if all {
                    manager.kill_all();
                } else {
                    manager.kill(&id).unwrap();
                }
                assert!(cancelled.load(Ordering::Acquire));
                assert_eq!(manager.live_session_ids().unwrap(), vec![id.clone()]);
                Ok(())
            })
            .unwrap();
        assert!(manager.live_session_ids().unwrap().is_empty());
    }
}

#[test]
fn native_failure_and_panic_keep_reconciliation_inventory() {
    for panic in [false, true] {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            manager.run_native_session(&id, |_| {
                if panic {
                    panic!("actor panic fixture");
                }
                Err("durable final handling failed".into())
            })
        }));
        assert!(outcome.is_err() || outcome.unwrap().is_err());
        assert_eq!(manager.live_session_ids().unwrap(), vec![id.clone()]);
        assert!(manager.install_when_idle(|| Ok(())).is_err());
        assert!(manager.run_native_session(&id, |_| Ok(())).is_err());
        manager.kill(&id).unwrap();
        assert_eq!(manager.live_session_ids().unwrap(), vec![id]);
    }
}

#[test]
fn racing_native_operations_consume_one_shared_reservation() {
    let manager = PtyManager::default();
    let id = manager.reserve_session().unwrap();
    let barrier = std::sync::Barrier::new(2);
    let count = std::sync::atomic::AtomicUsize::new(0);
    let operation = || {
        barrier.wait();
        manager.run_native_session(&id, |_| {
            count.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
    };
    std::thread::scope(|scope| {
        let a = scope.spawn(operation);
        let b = scope.spawn(operation);
        assert_eq!(
            usize::from(a.join().unwrap().is_ok()) + usize::from(b.join().unwrap().is_ok()),
            1
        );
    });
    assert_eq!(count.load(Ordering::SeqCst), 1);
}
