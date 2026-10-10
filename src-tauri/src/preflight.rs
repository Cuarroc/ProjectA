//! Preflight: can this profile start an agent right now, and if not, why?
//!
//! Every spawn path in this app already refuses for good reasons - a profile
//! that is switched off, a quota block, a profile that is not in the registry
//! at all - but each refusal is discovered at a different depth and worded by
//! whoever noticed it. The dispatcher's version of that is the worst of the
//! three: it either skips silently or spawns and lets the failure land on a
//! queue entry as a raw error string.
//!
//! This module answers the question once, before the spawn, as a list of
//! blockers. Each blocker says three things: what is wrong, what to do about
//! it, and whether waiting would fix it:
//!
//! * a **transient** blocker resolves on its own - a quota window rolls over,
//!   a budget block expires. The entry stays queued and the next sweep tries
//!   again.
//! * a **permanent** blocker will not - a profile that does not exist, a
//!   project that was removed. The entry is failed now, with the repair hint
//!   in its error, instead of being retried every thirty seconds forever.
//!
//! The report is bound to a fingerprint of the facts it was computed from and
//! carries a short time to live, so a cached answer can never outlive the
//! situation it described: change a setting, and the fingerprint changes with
//! it. That pairing - fingerprint plus TTL - is the part worth having; it is
//! why the dispatcher may reuse a verdict at all.

use std::collections::BTreeSet;
use std::time::Duration;

use crate::budget::BudgetLimits;
use crate::workers::lane_guard::Seam;

/// How long a report may be reused when nothing it depends on has changed.
///
/// Short: the facts behind it are settings and quota rows that a background
/// thread rewrites every minute. The fingerprint already catches every change
/// this process made, so the TTL is only there for the ones it cannot see -
/// a settings row written by another instance, a clock nobody told us about.
pub const TTL: Duration = Duration::from_secs(30);

/// Why an agent may not start, and what to do about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Blocker {
    /// Stable machine-readable tag. The wording below may be reworded; this
    /// may not.
    pub code: &'static str,
    /// What is wrong, for a person.
    pub message: String,
    /// What that person can do about it.
    pub repair: String,
    /// Whether waiting is a repair of its own.
    pub transient: bool,
}

impl Blocker {
    /// The single line a queue entry's `error` column carries.
    pub fn line(&self) -> String {
        format!("{} - {}", self.message, self.repair)
    }
}

pub const CODE_UNKNOWN_PROFILE: &str = "unknown_profile";
pub const CODE_PROFILE_DISABLED: &str = "profile_disabled";
pub const CODE_QUOTA_BLOCKED: &str = "quota_blocked";
pub const CODE_BUDGET_REACHED: &str = "budget_reached";
#[allow(dead_code)] // V2-B3: no runtime caller until the seam bundle wires it
pub const CODE_LOW_RAM: &str = "low_ram";
#[allow(dead_code)] // V2-B3: no runtime caller until the seam bundle wires it
pub const CODE_BUILDS_BUSY: &str = "builds_busy";
#[allow(dead_code)] // V2-B3: no runtime caller until the seam bundle wires it
pub const CODE_SEAM_OCCUPIED: &str = "seam_occupied";

/// Below this much free RAM no new agent starts (1.5 GiB, as `dev:start-check`).
#[allow(dead_code)] // V2-B3: no runtime caller until the seam bundle wires it
pub const MIN_FREE_RAM_BYTES: u64 = 3 * 1024 * 1024 * 1024 / 2;
/// At this many running cargo builds no new agent starts (as `dev:start-check`).
#[allow(dead_code)] // V2-B3: no runtime caller until the seam bundle wires it
pub const MAX_RUNNING_BUILDS: u32 = 2;

/// Everything the verdict is computed from, read once by the caller.
///
/// A plain struct of already-gathered facts rather than a set of handles: it
/// makes [`evaluate`] pure, and it makes the fingerprint below meaningful -
/// two identical `Facts` are the same situation by construction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Facts {
    pub profile_id: String,
    /// Whether the profile exists in the registry at all.
    pub known: bool,
    /// The settings switch from [`crate::learnings`].
    pub enabled: bool,
    /// The quota row's state: `ok`, `blocked` or `unknown`.
    pub quota_state: String,
    /// The reason on that row, when it is blocked.
    pub quota_reason: Option<String>,
    /// When the block lifts, when the row says.
    pub blocked_until: Option<i64>,
    /// The profile's budget ceilings, for the repair hint.
    pub budget: Option<BudgetLimits>,
}

/// A report, and the situation it describes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    pub blockers: Vec<Blocker>,
    /// Hash of the facts this was computed from.
    pub fingerprint: String,
    /// Unix seconds at which it was computed.
    pub checked_at: i64,
}

impl Report {
    pub fn is_clear(&self) -> bool {
        self.blockers.is_empty()
    }

    /// Any blocker that waiting will not fix.
    pub fn permanent(&self) -> Vec<&Blocker> {
        self.blockers.iter().filter(|b| !b.transient).collect()
    }

    /// Everything that is wrong, as one line per blocker.
    pub fn summary(&self) -> String {
        self.blockers
            .iter()
            .map(Blocker::line)
            .collect::<Vec<_>>()
            .join("; ")
    }

    /// Is this report still a fair description of `facts` at `now`?
    ///
    /// Both halves are needed and neither is enough. The fingerprint catches
    /// every change this process can see; the age catches the ones it cannot.
    pub fn is_valid_for(&self, facts: &Facts, now: i64) -> bool {
        self.fingerprint == fingerprint(facts)
            && now >= self.checked_at
            && (now - self.checked_at) < TTL.as_secs() as i64
    }
}

/// Hash the facts. FNV-1a over their canonical rendering: not cryptographic,
/// and it does not need to be - the only question asked of it is whether the
/// situation is the same one as a moment ago.
pub fn fingerprint(facts: &Facts) -> String {
    let pct = |value: Option<u8>| value.map_or_else(|| "-".to_string(), |v| v.to_string());
    let rendered = format!(
        "{}|{}|{}|{}|{}|{}|{}|{}",
        facts.profile_id,
        facts.known,
        facts.enabled,
        facts.quota_state,
        facts.quota_reason.as_deref().unwrap_or(""),
        facts.blocked_until.unwrap_or(0),
        pct(facts.budget.as_ref().and_then(|b| b.five_hour_pct)),
        pct(facts.budget.as_ref().and_then(|b| b.seven_day_pct)),
    );
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in rendered.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// The whole decision, pure.
pub fn evaluate(facts: &Facts, now: i64) -> Report {
    let mut blockers = Vec::new();

    if !facts.known {
        blockers.push(Blocker {
            code: CODE_UNKNOWN_PROFILE,
            message: format!("Agent-Profil '{}' gibt es nicht", facts.profile_id),
            repair:
                "Profil in agents.json anlegen oder den Task auf ein vorhandenes Profil umstellen"
                    .to_string(),
            // Nothing that happens on its own brings a profile into the
            // registry, so retrying this forever is retrying nothing.
            transient: false,
        });
        // Everything below is about a profile that exists. Saying more about
        // one that does not would be guessing.
        return report(blockers, facts, now);
    }

    if !facts.enabled {
        blockers.push(Blocker {
            code: CODE_PROFILE_DISABLED,
            message: format!(
                "Agent-Profil '{}' ist in den Einstellungen aus",
                facts.profile_id
            ),
            repair: "In Einstellungen > Agent-Kategorien > Profile wieder aktivieren".to_string(),
            // A switch the user flipped is a switch the user can flip back,
            // and the queued task is what they will want when they do.
            transient: true,
        });
    }

    if facts.quota_state == crate::store::QUOTA_BLOCKED {
        let by_budget = facts
            .quota_reason
            .as_deref()
            .is_some_and(|reason| reason.starts_with(crate::budget::REASON_PREFIX));
        let until = facts
            .blocked_until
            .filter(|until| *until > now)
            .map(|until| format!(" (noch {} min)", ((until - now) / 60).max(1)))
            .unwrap_or_default();
        blockers.push(if by_budget {
            Blocker {
                code: CODE_BUDGET_REACHED,
                message: format!(
                    "Budget-Schwelle fuer '{}' erreicht{until}",
                    facts.profile_id
                ),
                repair: format!(
                    "Warten bis das Fenster zurueckgesetzt ist, oder die Schwelle anheben: pa budget set --profile {} --five-hour <n>",
                    facts.profile_id
                ),
                transient: true,
            }
        } else {
            Blocker {
                code: CODE_QUOTA_BLOCKED,
                message: format!(
                    "Anbieter blockiert '{}'{until}: {}",
                    facts.profile_id,
                    facts.quota_reason.as_deref().unwrap_or("kein Grund gemeldet")
                ),
                repair: "Warten, oder den Task auf ein anderes Profil umstellen".to_string(),
                transient: true,
            }
        });
    }

    report(blockers, facts, now)
}

/// A seam lane that another open package already holds.
#[allow(dead_code)] // V2-B3: no runtime caller until the seam bundle wires it
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeamHold {
    pub seam: Seam,
    /// The task that holds it, for the message.
    pub holder: String,
}

/// What the machine and the seams look like right now, read once by the caller.
///
/// Kept apart from [`Facts`] on purpose: these values move every second, so
/// they must not enter the cached report's fingerprint. Evaluate them fresh at
/// every start. `None` means "could not be read" and never blocks: a start
/// is refused only on something observed.
#[allow(dead_code)] // V2-B3: no runtime caller until the seam bundle wires it
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HostFacts {
    pub free_ram_bytes: Option<u64>,
    pub running_builds: Option<u32>,
    /// Seam lanes held by open packages.
    pub occupied_seams: Vec<SeamHold>,
    /// Seam lanes the package to start would write.
    pub wanted_seams: BTreeSet<Seam>,
}

/// The start check for the host, pure. Every blocker is transient: RAM frees
/// up, builds end, a package releases its seam.
#[allow(dead_code)] // V2-B3: no runtime caller until the seam bundle wires it
pub fn evaluate_host(host: &HostFacts) -> Vec<Blocker> {
    const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
    let mut blockers = Vec::new();
    if let Some(free) = host
        .free_ram_bytes
        .filter(|free| *free < MIN_FREE_RAM_BYTES)
    {
        blockers.push(Blocker {
            code: CODE_LOW_RAM,
            message: format!(
                "Nur {:.1} GiB RAM frei (Schwelle {:.1} GiB)",
                free as f64 / GIB,
                MIN_FREE_RAM_BYTES as f64 / GIB
            ),
            repair: "Warten oder andere Programme beenden; der Start wird danach neu geprueft"
                .to_string(),
            transient: true,
        });
    }
    if let Some(builds) = host.running_builds.filter(|n| *n >= MAX_RUNNING_BUILDS) {
        blockers.push(Blocker {
            code: CODE_BUILDS_BUSY,
            message: format!("{builds} cargo-Builds laufen (hoechstens {MAX_RUNNING_BUILDS})"),
            repair: "Warten, bis ein Build fertig ist".to_string(),
            transient: true,
        });
    }
    for hold in host
        .occupied_seams
        .iter()
        .filter(|hold| host.wanted_seams.contains(&hold.seam))
    {
        blockers.push(Blocker {
            code: CODE_SEAM_OCCUPIED,
            message: format!(
                "Naht '{}' ist belegt durch {}",
                hold.seam.lane(),
                hold.holder
            ),
            repair: "Warten, bis dieses Paket fertig ist; Naehte laufen nur nacheinander"
                .to_string(),
            transient: true,
        });
    }
    blockers
}

/// `MemAvailable` from `/proc/meminfo` text, in bytes.
#[allow(dead_code)] // V2-B3: no runtime caller until the seam bundle wires it
pub fn parse_mem_available(meminfo: &str) -> Option<u64> {
    let rest = meminfo
        .lines()
        .find_map(|line| line.strip_prefix("MemAvailable:"))?;
    let kb: u64 = rest.split_whitespace().next()?.parse().ok()?;
    Some(kb.saturating_mul(1024))
}

/// How many of these process names are `cargo` itself.
#[allow(dead_code)] // V2-B3: no runtime caller until the seam bundle wires it
pub fn count_cargo<'a>(names: impl IntoIterator<Item = &'a str>) -> u32 {
    names
        .into_iter()
        .filter(|name| name.trim().trim_end_matches(".exe") == "cargo")
        .count() as u32
}

/// Free RAM now, or `None` where this platform cannot say.
#[allow(dead_code)] // V2-B3: no runtime caller until the seam bundle wires it
#[cfg(target_os = "linux")]
pub fn free_ram_bytes() -> Option<u64> {
    parse_mem_available(&std::fs::read_to_string("/proc/meminfo").ok()?)
}

#[allow(dead_code)] // V2-B3: no runtime caller until the seam bundle wires it
#[cfg(windows)]
pub fn free_ram_bytes() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    // SAFETY: `status` is a fully initialised MEMORYSTATUSEX with its length set.
    unsafe {
        let mut status: MEMORYSTATUSEX = std::mem::zeroed();
        status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        (GlobalMemoryStatusEx(&mut status) != 0).then_some(status.ullAvailPhys)
    }
}

#[allow(dead_code)] // V2-B3: no runtime caller until the seam bundle wires it
#[cfg(not(any(target_os = "linux", windows)))]
pub fn free_ram_bytes() -> Option<u64> {
    None
}

/// Running cargo builds now, or `None` where this platform cannot say.
#[allow(dead_code)] // V2-B3: no runtime caller until the seam bundle wires it
#[cfg(target_os = "linux")]
pub fn running_cargo_builds() -> Option<u32> {
    let names: Vec<String> = std::fs::read_dir("/proc")
        .ok()?
        .filter_map(|entry| std::fs::read_to_string(entry.ok()?.path().join("comm")).ok())
        .collect();
    Some(count_cargo(names.iter().map(String::as_str)))
}

#[allow(dead_code)] // V2-B3: no runtime caller until the seam bundle wires it
#[cfg(not(target_os = "linux"))]
pub fn running_cargo_builds() -> Option<u32> {
    None
}

fn report(blockers: Vec<Blocker>, facts: &Facts, now: i64) -> Report {
    Report {
        blockers,
        fingerprint: fingerprint(facts),
        checked_at: now,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{QUOTA_BLOCKED, QUOTA_OK};

    fn facts() -> Facts {
        Facts {
            profile_id: "claude".to_string(),
            known: true,
            enabled: true,
            quota_state: QUOTA_OK.to_string(),
            quota_reason: None,
            blocked_until: None,
            budget: None,
        }
    }

    #[test]
    fn a_healthy_profile_has_nothing_to_say() {
        let report = evaluate(&facts(), 1_000);
        assert!(report.is_clear());
        assert!(report.permanent().is_empty());
        assert_eq!(report.summary(), "");
    }

    #[test]
    fn an_unknown_profile_is_permanent_and_stops_the_rest() {
        let mut facts = facts();
        facts.known = false;
        facts.enabled = false;
        facts.quota_state = QUOTA_BLOCKED.to_string();

        let report = evaluate(&facts, 1_000);
        // One blocker, not three: a profile that does not exist cannot also be
        // switched off or out of quota, and saying so would be guessing.
        assert_eq!(report.blockers.len(), 1);
        assert_eq!(report.blockers[0].code, CODE_UNKNOWN_PROFILE);
        assert_eq!(report.permanent().len(), 1);
        assert!(
            report.summary().contains("agents.json"),
            "{}",
            report.summary()
        );
    }

    #[test]
    fn a_disabled_profile_is_transient_and_names_the_switch() {
        let mut facts = facts();
        facts.enabled = false;
        let report = evaluate(&facts, 1_000);
        assert_eq!(report.blockers[0].code, CODE_PROFILE_DISABLED);
        assert!(report.blockers[0].transient);
        assert!(
            report.permanent().is_empty(),
            "waiting is not the repair, but failing is worse"
        );
        assert!(report.blockers[0].repair.contains("Einstellungen"));
    }

    #[test]
    fn a_budget_block_is_told_apart_from_a_providers_own() {
        let mut facts = facts();
        facts.quota_state = QUOTA_BLOCKED.to_string();
        facts.quota_reason = Some("Budget: 5-Stunden-Fenster bei 93 % (Limit 90 %)".to_string());
        facts.blocked_until = Some(1_000 + 45 * 60);

        let report = evaluate(&facts, 1_000);
        assert_eq!(report.blockers[0].code, CODE_BUDGET_REACHED);
        assert!(report.blockers[0].transient);
        assert!(
            report.blockers[0].message.contains("noch 45 min"),
            "{:?}",
            report.blockers[0]
        );
        // The repair is the command that changes it, not a shrug.
        assert!(report.blockers[0]
            .repair
            .contains("pa budget set --profile claude"));

        facts.quota_reason = Some("Claude usage limit reached".to_string());
        let report = evaluate(&facts, 1_000);
        assert_eq!(report.blockers[0].code, CODE_QUOTA_BLOCKED);
        assert!(report.blockers[0]
            .message
            .contains("Claude usage limit reached"));

        // A reset time already past is not counted down to.
        facts.blocked_until = Some(500);
        let report = evaluate(&facts, 1_000);
        assert!(
            !report.blockers[0].message.contains("noch"),
            "{:?}",
            report.blockers[0]
        );
    }

    #[test]
    fn a_report_expires_when_the_facts_change_or_time_passes() {
        let facts = facts();
        let report = evaluate(&facts, 1_000);
        assert!(report.is_valid_for(&facts, 1_000));
        assert!(report.is_valid_for(&facts, 1_000 + TTL.as_secs() as i64 - 1));
        // Old enough is old enough, even with nothing changed.
        assert!(!report.is_valid_for(&facts, 1_000 + TTL.as_secs() as i64));
        // A clock that went backwards is not a fresh report either.
        assert!(!report.is_valid_for(&facts, 999));

        // Every fact is part of the fingerprint, so every one of them expires it.
        let mut disabled = facts.clone();
        disabled.enabled = false;
        assert!(!report.is_valid_for(&disabled, 1_000));

        let mut blocked = facts.clone();
        blocked.quota_state = QUOTA_BLOCKED.to_string();
        assert!(!report.is_valid_for(&blocked, 1_000));

        let mut budgeted = facts.clone();
        budgeted.budget = Some(BudgetLimits {
            profile_id: "claude".to_string(),
            five_hour_pct: Some(90),
            seven_day_pct: None,
        });
        assert!(!report.is_valid_for(&budgeted, 1_000));
    }

    const GIB: u64 = 1024 * 1024 * 1024;

    #[test]
    fn under_one_and_a_half_gib_free_the_start_is_refused_with_the_reason() {
        let host = HostFacts {
            free_ram_bytes: Some(GIB),
            ..HostFacts::default()
        };
        let blockers = evaluate_host(&host);
        assert_eq!(blockers.len(), 1);
        assert_eq!(blockers[0].code, CODE_LOW_RAM);
        assert!(blockers[0].transient);
        assert!(blockers[0].message.contains("1.0 GiB"), "{:?}", blockers[0]);

        // The threshold itself is enough; unreadable values never block.
        for free_ram_bytes in [Some(MIN_FREE_RAM_BYTES), None] {
            let host = HostFacts {
                free_ram_bytes,
                ..HostFacts::default()
            };
            assert!(evaluate_host(&host).is_empty());
        }
    }

    #[test]
    fn two_running_builds_refuse_the_start() {
        let busy = |n| HostFacts {
            running_builds: Some(n),
            ..HostFacts::default()
        };
        assert!(evaluate_host(&busy(1)).is_empty());
        let blockers = evaluate_host(&busy(2));
        assert_eq!(blockers[0].code, CODE_BUILDS_BUSY);
        assert!(blockers[0].message.contains("2 cargo-Builds"));
        assert!(evaluate_host(&HostFacts::default()).is_empty());
    }

    #[test]
    fn only_a_seam_the_package_wants_and_another_holds_blocks() {
        let host = HostFacts {
            occupied_seams: vec![
                SeamHold {
                    seam: Seam::Api,
                    holder: "task-a".to_string(),
                },
                SeamHold {
                    seam: Seam::Store,
                    holder: "task-b".to_string(),
                },
            ],
            wanted_seams: BTreeSet::from([Seam::Api, Seam::Main]),
            ..HostFacts::default()
        };
        let blockers = evaluate_host(&host);
        assert_eq!(blockers.len(), 1);
        assert_eq!(blockers[0].code, CODE_SEAM_OCCUPIED);
        assert!(blockers[0].message.contains("'api'"), "{:?}", blockers[0]);
        assert!(blockers[0].message.contains("task-a"));
        assert!(blockers[0].transient);
    }

    #[test]
    fn the_readers_parse_meminfo_and_count_cargo_processes() {
        let meminfo = "MemTotal:       16000000 kB\nMemAvailable:    1572864 kB\n";
        assert_eq!(parse_mem_available(meminfo), Some(1536 * 1024 * 1024));
        assert_eq!(parse_mem_available("MemTotal: 1 kB\n"), None);
        assert_eq!(parse_mem_available("MemAvailable: lots kB\n"), None);
        assert_eq!(
            count_cargo(["cargo\n", "rustc", "cargo.exe", "cargo-nextest"]),
            2
        );
    }
}
