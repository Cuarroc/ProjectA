//! Trigger core (V2-B15a): cron evaluation, the 6-per-hour rate limit and the
//! test run that consumes nothing. Pure and unwired: no clock, network or
//! storage in here - the caller passes `now` as Unix seconds.
#![allow(dead_code)] // V2-B15a is not wired into the dispatcher yet

use std::collections::VecDeque;

/// At most this many runs in any rolling hour, per trigger.
pub const MAX_RUNS_PER_HOUR: usize = 6;
const WINDOW_SECS: u64 = 3600;
/// `next_after` gives up after this horizon (`0 0 31 2 *` never fires).
const HORIZON_SECS: i64 = 9 * 366 * 86_400;

/// A parsed 5-field cron expression. Everything is UTC: time-zone and DST
/// handling is the caller's job (convert the instant, not the schedule).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Schedule {
    minutes: u64,
    hours: u64,
    days: u64,
    months: u64,
    weekdays: u64,
    days_star: bool,
    weekdays_star: bool,
}

impl Schedule {
    /// Fields: minute hour day-of-month month day-of-week. Each accepts `*`,
    /// numbers, `a-b`, `*/n`, `a-b/n` and comma lists; day-of-week is 0-7
    /// with 0 and 7 = Sunday. As in Vixie cron, when both day fields are
    /// restricted a day matches if either does.
    pub fn parse(expr: &str) -> Result<Schedule, String> {
        let f: Vec<&str> = expr.split_whitespace().collect();
        if f.len() != 5 {
            return Err(format!(
                "Ein Cron-Ausdruck braucht 5 Felder, gefunden: {}",
                f.len()
            ));
        }
        let mut weekdays = field(f[4], "Wochentag", 0, 7)?;
        if weekdays & (1 << 7) != 0 {
            weekdays = (weekdays | 1) & !(1 << 7);
        }
        Ok(Schedule {
            minutes: field(f[0], "Minute", 0, 59)?,
            hours: field(f[1], "Stunde", 0, 23)?,
            days: field(f[2], "Tag", 1, 31)?,
            months: field(f[3], "Monat", 1, 12)?,
            weekdays,
            days_star: f[2].starts_with('*'),
            weekdays_star: f[4].starts_with('*'),
        })
    }

    fn day_matches(&self, day: u32, weekday: u32) -> bool {
        let (d, w) = (self.days >> day & 1 == 1, self.weekdays >> weekday & 1 == 1);
        match (self.days_star, self.weekdays_star) {
            (false, false) => d || w,
            (false, true) => d,
            (true, false) => w,
            (true, true) => true,
        }
    }

    /// The first matching minute strictly after `after` (Unix seconds), or
    /// `None` when nothing fires within nine years.
    pub fn next_after(&self, after: u64) -> Option<u64> {
        let start = (after / 60 + 1) as i64 * 60;
        let mut t = start;
        while t - start <= HORIZON_SECS {
            let days = t.div_euclid(86_400);
            let (_, month, day) = civil(days);
            let (hour, minute) = (
                (t.rem_euclid(86_400) / 3600) as u32,
                (t.rem_euclid(3600) / 60) as u32,
            );
            let weekday = (days + 4).rem_euclid(7) as u32;
            if self.months >> month & 1 == 0 || !self.day_matches(day, weekday) {
                t = (days + 1) * 86_400;
            } else if self.hours >> hour & 1 == 0 {
                t = t - i64::from(minute) * 60 + 3600;
            } else if self.minutes >> minute & 1 == 0 {
                t += 60;
            } else {
                return u64::try_from(t).ok();
            }
        }
        None
    }
}

/// One field as a bit mask over `lo..=hi`.
fn field(text: &str, name: &str, lo: u32, hi: u32) -> Result<u64, String> {
    let err = |m: String| format!("Feld {name}: {m}");
    let num = |s: &str| -> Result<u32, String> {
        let n: u32 = s
            .parse()
            .map_err(|_| err(format!("„{s}“ ist keine Zahl")))?;
        if n < lo || n > hi {
            return Err(err(format!("{n} liegt außerhalb {lo}–{hi}")));
        }
        Ok(n)
    };
    let mut mask = 0u64;
    for part in text.split(',') {
        let (range, step) = match part.split_once('/') {
            Some((r, s)) => match s.parse::<u32>() {
                Ok(n) if n > 0 => (r, n),
                _ => return Err(err(format!("Schritt „{s}“ ist ungültig"))),
            },
            None => (part, 1),
        };
        let (a, b) = match range.split_once('-') {
            _ if range == "*" => (lo, hi),
            Some((a, b)) => (num(a)?, num(b)?),
            None if !part.contains('/') => (num(range)?, num(range)?),
            None => {
                return Err(err(format!(
                    "„{part}“ braucht * oder einen Bereich vor dem Schritt"
                )))
            }
        };
        if a > b {
            return Err(err(format!("Bereich {a}-{b} läuft rückwärts")));
        }
        mask |= (a..=b).step_by(step as usize).fold(0, |m, v| m | 1 << v);
    }
    Ok(mask)
}

/// Days since 1970-01-01 -> (year, month, day), proleptic Gregorian.
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let (era, doe) = (z.div_euclid(146_097), z.rem_euclid(146_097));
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (
        yoe + era * 400 + i64::from(m <= 2),
        m as u32,
        (doy - (153 * mp + 2) / 5 + 1) as u32,
    )
}

/// What a firing request gets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Erlaubt,
    /// Rate limit hit; the earliest instant (Unix seconds) a run is free again.
    Gedrosselt {
        frei_ab: u64,
    },
}

/// Rolling-hour limiter: a run at `t` occupies its slot until `t + 3600`.
#[derive(Debug, Default, Clone)]
pub struct RateLimiter {
    runs: VecDeque<u64>,
}

impl RateLimiter {
    /// Test run: the decision `fire` would make, but `&self` - it cannot
    /// record a run, so it consumes nothing.
    pub fn test_run(&self, now: u64) -> Decision {
        let live: Vec<u64> = self
            .runs
            .iter()
            .copied()
            .filter(|r| r.saturating_add(WINDOW_SECS) > now)
            .collect();
        match live.len().checked_sub(MAX_RUNS_PER_HOUR) {
            Some(i) => Decision::Gedrosselt {
                frei_ab: live[i].saturating_add(WINDOW_SECS),
            },
            None => Decision::Erlaubt,
        }
    }

    /// Decide and, only when allowed, record the run.
    pub fn fire(&mut self, now: u64) -> Decision {
        let d = self.test_run(now);
        if d == Decision::Erlaubt {
            self.runs.retain(|r| r.saturating_add(WINDOW_SECS) > now);
            self.runs.push_back(now);
        }
        d
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FRI_1750: u64 = 1_791_568_200; // 2026-10-09 17:50 UTC
    const MON_0900: u64 = 1_791_795_600; // 2026-10-12

    fn next(expr: &str, after: u64) -> Option<u64> {
        Schedule::parse(expr).unwrap().next_after(after)
    }

    #[test]
    fn seventh_run_within_an_hour_is_throttled_with_frei_ab() {
        let mut l = RateLimiter::default();
        for i in 0..6 {
            assert_eq!(l.fire(1000 + i * 60), Decision::Erlaubt);
        }
        assert_eq!(
            l.fire(1600),
            Decision::Gedrosselt {
                frei_ab: 1000 + 3600
            }
        );
        assert_eq!(l.runs.len(), 6);
    }

    #[test]
    fn run_61_minutes_after_the_first_frees_a_slot() {
        let mut l = RateLimiter::default();
        for _ in 0..6 {
            l.fire(1000);
        }
        assert_eq!(
            l.test_run(1000 + 3599),
            Decision::Gedrosselt { frei_ab: 4600 }
        );
        assert_eq!(l.fire(1000 + 61 * 60), Decision::Erlaubt);
    }

    #[test]
    fn test_run_twice_leaves_the_counter_unchanged() {
        let mut l = RateLimiter::default();
        for i in 0..5 {
            l.fire(1000 + i);
        }
        let (a, b) = (l.test_run(1100), l.test_run(1100));
        assert_eq!((a, l.runs.len()), (b, 5));
        assert_eq!(a, Decision::Erlaubt);
        assert_eq!(l.fire(1100), Decision::Erlaubt);
        assert_eq!(l.test_run(1100), Decision::Gedrosselt { frei_ab: 4600 });
        assert_eq!(l.runs.len(), 6);
    }

    #[test]
    fn weekday_office_hours_fire_across_a_day_and_a_weekend() {
        let e = "*/15 9-17 * * 1-5";
        assert_eq!(next(e, MON_0900), Some(1_791_796_500)); // strictly after: 09:15
        assert_eq!(next(e, 1_791_827_100 - 60), Some(1_791_827_100)); // Mon 17:45
        assert_eq!(next(e, 1_791_827_100), Some(1_791_882_000)); // -> Tue 09:00
        assert_eq!(next(e, FRI_1750), Some(MON_0900)); // over the weekend
    }

    #[test]
    fn feb_29_finds_the_next_leap_day() {
        assert_eq!(next("0 0 29 2 *", 1_791_633_600), Some(1_835_395_200)); // 2028
        assert_eq!(next("0 0 29 2 *", 1_835_395_200), Some(1_961_625_600)); // 2032
        assert_eq!(next("0 0 31 2 *", 1_791_633_600), None);
    }

    #[test]
    fn lists_and_sunday_as_zero_or_seven() {
        assert_eq!(next("7,30 9 * * *", 1_791_795_600), Some(1_791_796_020)); // 09:07
        let sunday = 1_791_676_800; // 2026-10-11 00:00, a Sunday
        assert_eq!(next("0 0 * * 0", sunday - 1), Some(sunday));
        assert_eq!(next("0 0 * * 7", sunday - 1), Some(sunday));
        assert_eq!(Schedule::parse("0 0 * * 0"), Schedule::parse("0 0 * * 7"));
        assert_eq!(next("0 0 * * 0,7", sunday), Some(sunday + 7 * 86_400));
    }

    #[test]
    fn invalid_fields_give_a_german_error_naming_the_field() {
        let err = |e: &str| Schedule::parse(e).unwrap_err();
        assert_eq!(err("0 25 * * *"), "Feld Stunde: 25 liegt außerhalb 0–23");
        assert_eq!(err("60 * * * *"), "Feld Minute: 60 liegt außerhalb 0–59");
        assert_eq!(err("0 0 0 * *"), "Feld Tag: 0 liegt außerhalb 1–31");
        assert_eq!(err("0 0 * 13 *"), "Feld Monat: 13 liegt außerhalb 1–12");
        assert_eq!(err("0 0 * * 8"), "Feld Wochentag: 8 liegt außerhalb 0–7");
        assert_eq!(
            err("0 0 * *"),
            "Ein Cron-Ausdruck braucht 5 Felder, gefunden: 4"
        );
        assert!(err("*/0 * * * *").starts_with("Feld Minute: Schritt"));
        assert!(err("x * * * *").starts_with("Feld Minute: „x“ ist keine Zahl"));
        assert_eq!(
            err("0 9-5 * * *"),
            "Feld Stunde: Bereich 9-5 läuft rückwärts"
        );
        assert!(err("5/10 * * * *").starts_with("Feld Minute:"));
    }

    const OCT_1: u64 = 1_790_812_800; // 2026-10-01 00:00 UTC, a Thursday
    const DAY: u64 = 86_400;

    /// The next `n` firings after `after`, each fed back in as the new `after`.
    fn firings(expr: &str, after: u64, n: usize) -> Vec<u64> {
        let s = Schedule::parse(expr).unwrap();
        let mut at = after;
        (0..n)
            .map(|_| {
                at = s.next_after(at).unwrap();
                at
            })
            .collect()
    }

    #[test]
    fn stepped_star_in_day_of_month_skips_even_days() {
        let days: Vec<u32> = firings("0 0 */2 * *", OCT_1, 5)
            .into_iter()
            .map(|t| civil((t / DAY) as i64).2)
            .collect();
        assert_eq!(days, [3, 5, 7, 9, 11]);
    }

    #[test]
    fn stepped_star_day_of_month_is_anded_with_the_weekday() {
        // Mondays in Oct/Nov 2026: 5, 12, 19, 26, Nov 2, Nov 9 - only odd days count.
        assert_eq!(
            firings("0 0 */2 * 1", OCT_1, 3),
            [OCT_1 + 4 * DAY, OCT_1 + 18 * DAY, OCT_1 + 39 * DAY] // Oct 5, Oct 19, Nov 9
        );
    }

    #[test]
    fn plain_star_day_fields_keep_their_single_restriction() {
        assert_eq!(
            firings("0 0 * * 1", OCT_1, 2),
            [OCT_1 + 4 * DAY, OCT_1 + 11 * DAY]
        );
        assert_eq!(
            firings("0 0 1 * *", OCT_1, 2),
            [OCT_1 + 31 * DAY, OCT_1 + 61 * DAY] // Nov 1, Dec 1
        );
    }

    #[test]
    fn two_restricted_day_fields_fire_on_either() {
        assert_eq!(
            firings("0 0 1 * 1", OCT_1, 6),
            [4, 11, 18, 25, 31, 32].map(|d| OCT_1 + d * DAY) // Oct 5/12/19/26, Nov 1, Nov 2
        );
    }

    #[test]
    fn range_with_step_picks_every_nth_inside_the_range() {
        assert_eq!(
            firings("0-30/15 * * * *", MON_0900, 4),
            [900, 1800, 3600, 4500].map(|s| MON_0900 + s) // 09:15, 09:30, 10:00, 10:15
        );
    }

    #[test]
    fn frei_ab_is_the_oldest_run_even_when_recorded_out_of_order() {
        let mut l = RateLimiter::default();
        for _ in 0..5 {
            assert_eq!(l.fire(2000), Decision::Erlaubt);
        }
        // A late-arriving earlier timestamp: 1000 is now the oldest run.
        assert_eq!(l.fire(1000), Decision::Erlaubt);
        assert_eq!(
            l.test_run(2500),
            Decision::Gedrosselt {
                frei_ab: 1000 + 3600
            }
        );
    }
}
