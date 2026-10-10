//! Usage ledger core: a per-model report card and a per-run quota share.
//!
//! Pure arithmetic over a slice of usage events; no store, no clock, no UI
//! (V2-B21a, not wired yet). [`LedgerEvent`] mirrors the `usage_events` fields
//! the report needs and adds the run id, the run time and the quota-percent
//! delta the poller observed, if any.
//!
//! Two honesty rules, as in [`super`]:
//!
//! * **Subscriptions only.** There is no currency field anywhere in this
//!   module; the only price a run has is the share of the quota window it used.
//! * **An estimate stays an estimate.** Every figure derived from at least one
//!   estimated event carries `geschaetzt = true`. A run's share is a quotient
//!   of the window total, so it is also flagged when any estimated event
//!   contributed quota points to that total.
//!
//! A model id is never normalised: an unknown model keeps its raw id.

#![allow(dead_code)] // V2-B21b wires this up; until then only the tests call it

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

/// One usage event, reduced to what the ledger needs.
#[derive(Debug, Clone, PartialEq)]
pub struct LedgerEvent {
    pub run_id: String,
    pub provider: String,
    pub model: String,
    pub tokens_in: i64,
    pub tokens_out: i64,
    /// Wall-clock time the event covers, in seconds.
    pub duration_secs: i64,
    /// Observed change of the quota window, in percent points; `None` when
    /// the poller saw no quota reading for this event.
    pub quota_delta_pct: Option<f64>,
    pub estimated: bool,
}

/// The report card of one model.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ModelStats {
    pub model: String,
    /// Distinct runs that used the model.
    pub runs: usize,
    pub tokens: i64,
    pub total_secs: i64,
    pub quota_points: f64,
    pub estimated_entries: usize,
    pub geschaetzt: bool,
}

/// The quota a single run used.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RunShare {
    pub run_id: String,
    pub quota_points: f64,
    /// Percent of all quota points used in the window; 0 when none were used.
    pub share_pct: f64,
    pub geschaetzt: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LedgerReport {
    pub models: Vec<ModelStats>,
    pub runs: Vec<RunShare>,
    pub window_quota_points: f64,
    pub geschaetzt: bool,
}

/// A quota delta that cannot be a consumption (negative after a window reset,
/// NaN, infinite) counts as zero rather than corrupting the sums.
fn points(e: &LedgerEvent) -> f64 {
    match e.quota_delta_pct {
        Some(p) if p.is_finite() && p > 0.0 => p,
        _ => 0.0,
    }
}

/// Aggregate `events` (one quota window) into the report. Models and runs come
/// out sorted by id, so the report is deterministic.
pub fn build_report(events: &[LedgerEvent]) -> LedgerReport {
    struct Acc {
        runs: BTreeSet<String>,
        tokens: i64,
        secs: i64,
        points: f64,
        estimated: usize,
    }
    let mut models: BTreeMap<&str, Acc> = BTreeMap::new();
    let mut runs: BTreeMap<&str, (f64, bool)> = BTreeMap::new();
    let mut window = 0.0;
    let mut window_estimated = false;
    for e in events {
        let p = points(e);
        window += p;
        window_estimated |= e.estimated && p > 0.0;
        let m = models.entry(&e.model).or_insert_with(|| Acc {
            runs: BTreeSet::new(),
            tokens: 0,
            secs: 0,
            points: 0.0,
            estimated: 0,
        });
        m.runs.insert(e.run_id.clone());
        m.tokens = m
            .tokens
            .saturating_add(e.tokens_in)
            .saturating_add(e.tokens_out);
        m.secs = m.secs.saturating_add(e.duration_secs);
        m.points += p;
        m.estimated += usize::from(e.estimated);
        let r = runs.entry(&e.run_id).or_insert((0.0, false));
        r.0 += p;
        r.1 |= e.estimated;
    }
    LedgerReport {
        models: models
            .into_iter()
            .map(|(model, a)| ModelStats {
                model: model.to_string(),
                runs: a.runs.len(),
                tokens: a.tokens,
                total_secs: a.secs,
                quota_points: a.points,
                estimated_entries: a.estimated,
                geschaetzt: a.estimated > 0,
            })
            .collect(),
        runs: runs
            .into_iter()
            .map(|(run_id, (pts, est))| RunShare {
                run_id: run_id.to_string(),
                quota_points: pts,
                share_pct: if window > 0.0 {
                    pts / window * 100.0
                } else {
                    0.0
                },
                geschaetzt: est || window_estimated,
            })
            .collect(),
        window_quota_points: window,
        geschaetzt: events.iter().any(|e| e.estimated),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(run: &str, model: &str, secs: i64, pct: Option<f64>, estimated: bool) -> LedgerEvent {
        LedgerEvent {
            run_id: run.into(),
            provider: "prov".into(),
            model: model.into(),
            tokens_in: 100,
            tokens_out: 50,
            duration_secs: secs,
            quota_delta_pct: pct,
            estimated,
        }
    }

    /// Twelve events, three runs, three models, nothing estimated.
    fn fixture() -> Vec<LedgerEvent> {
        let mut v = Vec::new();
        for i in 0..12 {
            let run = ["r1", "r2", "r3"][i % 3];
            let model = ["alpha", "beta", "alpha"][i % 3];
            v.push(ev(
                run,
                model,
                10 + i as i64,
                Some(0.5 * (i + 1) as f64),
                false,
            ));
        }
        v
    }

    #[test]
    fn totals_equal_the_sum_of_the_events() {
        let events = fixture();
        let report = build_report(&events);
        let secs: i64 = events.iter().map(|e| e.duration_secs).sum();
        let pts: f64 = events.iter().filter_map(|e| e.quota_delta_pct).sum();
        assert_eq!(
            report.models.iter().map(|m| m.total_secs).sum::<i64>(),
            secs
        );
        assert_eq!(
            report.models.iter().map(|m| m.tokens).sum::<i64>(),
            12 * 150
        );
        assert!((report.models.iter().map(|m| m.quota_points).sum::<f64>() - pts).abs() < 1e-9);
        assert!((report.window_quota_points - pts).abs() < 1e-9);
        assert!((report.runs.iter().map(|r| r.share_pct).sum::<f64>() - 100.0).abs() < 1e-9);
        let alpha = report.models.iter().find(|m| m.model == "alpha").unwrap();
        assert_eq!(alpha.runs, 2);
        assert!(!report.geschaetzt && report.models.iter().all(|m| !m.geschaetzt));
        assert!(report.runs.iter().all(|r| !r.geschaetzt));
    }

    #[test]
    fn one_estimated_event_flags_its_model_and_its_run() {
        let mut events = fixture();
        events.push(ev("r9", "gamma", 5, None, true));
        let report = build_report(&events);
        let gamma = report.models.iter().find(|m| m.model == "gamma").unwrap();
        assert!(gamma.geschaetzt);
        assert_eq!(gamma.estimated_entries, 1);
        assert!(
            report
                .runs
                .iter()
                .find(|r| r.run_id == "r9")
                .unwrap()
                .geschaetzt
        );
        // It added no quota points, so the other runs' shares stay measured.
        assert!(
            !report
                .runs
                .iter()
                .find(|r| r.run_id == "r1")
                .unwrap()
                .geschaetzt
        );
        assert!(
            !report
                .models
                .iter()
                .find(|m| m.model == "alpha")
                .unwrap()
                .geschaetzt
        );
        assert!(report.geschaetzt);
    }

    #[test]
    fn an_estimated_quota_reading_flags_every_share_of_the_window() {
        let report = build_report(&[
            ev("a", "m", 1, Some(2.0), true),
            ev("b", "m", 1, Some(2.0), false),
        ]);
        assert!(report.runs.iter().all(|r| r.geschaetzt));
        assert!(!report.models.is_empty() && report.models[0].estimated_entries == 1);
    }

    #[test]
    fn no_events_give_an_empty_report_without_dividing_by_zero() {
        let report = build_report(&[]);
        assert!(report.models.is_empty() && report.runs.is_empty());
        assert_eq!(report.window_quota_points, 0.0);
        assert!(!report.geschaetzt);
        // Events without any quota reading: shares are 0, never NaN.
        let report = build_report(&[ev("a", "m", 3, None, false)]);
        assert_eq!(report.runs[0].share_pct, 0.0);
        assert_eq!(report.models[0].total_secs, 3);
    }

    #[test]
    fn an_unknown_model_keeps_its_raw_id() {
        let report = build_report(&[ev("a", "Vendor/Weird-Model:7b@x", 1, Some(1.0), false)]);
        assert_eq!(report.models[0].model, "Vendor/Weird-Model:7b@x");
    }

    #[test]
    fn a_negative_or_non_finite_delta_counts_as_zero() {
        let report = build_report(&[
            ev("a", "m", 1, Some(-30.0), false),
            ev("a", "m", 1, Some(f64::NAN), false),
            ev("a", "m", 1, Some(4.0), false),
        ]);
        assert_eq!(report.window_quota_points, 4.0);
        assert_eq!(report.runs[0].share_pct, 100.0);
    }
}
