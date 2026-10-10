//! Notification core: how loud an event is delivered.
//!
//! Pure decision logic for the board "Benachrichtigungen & Handy": six event
//! kinds, three levels (loud / quiet / mute), a quiet-hours window and two
//! kinds that are always loud. No persistence, no UI, no OS notification:
//! later packages wire it up.
//!
//! Rules, in order:
//! 1. A mandatory kind is `Loud`, whatever the user set and whatever the time.
//! 2. `Mute` stays `Mute`, also in quiet hours.
//! 3. In quiet hours a `Loud` kind is delivered `Quiet` instead.
//! 4. Otherwise the user's level applies; a kind missing from the stored
//!    settings falls back to the board default.

// Consumed by V2-F8b (bell) and V2-S10c (Benachrichtigungen settings tab);
// whichever of them wires this up first removes the allow below.
#![cfg_attr(not(test), allow(dead_code))]

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Minutes in a day; quiet-hours bounds are minutes of the local day.
const MINUTES_PER_DAY: u16 = 24 * 60;

/// The event kinds of the board ("Was dich anpingt").
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    /// "Entscheidungen für dich" - mandatory loud.
    DecisionsForYou,
    /// "main ist rot" - mandatory loud.
    MainRed,
    /// "Agent hängt über 20 min".
    AgentStuck,
    /// "Kontingent über 90 %".
    QuotaHigh,
    /// "PR gemergt".
    PrMerged,
    /// "Trigger ist gelaufen".
    TriggerRan,
}

impl EventKind {
    pub const ALL: [EventKind; 6] = [
        EventKind::DecisionsForYou,
        EventKind::MainRed,
        EventKind::AgentStuck,
        EventKind::QuotaHigh,
        EventKind::PrMerged,
        EventKind::TriggerRan,
    ];

    /// The board locks these two to "Laut".
    pub fn is_mandatory(self) -> bool {
        matches!(self, EventKind::DecisionsForYou | EventKind::MainRed)
    }

    /// The board's initial choice for the kind.
    pub fn default_level(self) -> Level {
        match self {
            EventKind::DecisionsForYou | EventKind::MainRed => Level::Loud,
            EventKind::AgentStuck | EventKind::QuotaHigh => Level::Quiet,
            EventKind::PrMerged | EventKind::TriggerRan => Level::Mute,
        }
    }
}

/// How an event is delivered: with sound, silently in the bell, or not at all
/// (activity log only).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    Loud,
    Quiet,
    Mute,
}

/// User choices. Both fields may be absent in stored data.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct NotifySettings {
    pub per_kind: BTreeMap<EventKind, Level>,
    /// Quiet window as (start, end) minute of the local day, start inclusive,
    /// end exclusive. It wraps midnight when start > end; start == end is an
    /// empty window.
    pub quiet_hours: Option<(u16, u16)>,
}

impl NotifySettings {
    fn level_for(&self, kind: EventKind) -> Level {
        self.per_kind
            .get(&kind)
            .copied()
            .unwrap_or_else(|| kind.default_level())
    }

    fn in_quiet_hours(&self, minute_of_day: u16) -> bool {
        let Some((start, end)) = self.quiet_hours else {
            return false;
        };
        let minute = minute_of_day % MINUTES_PER_DAY;
        let (start, end) = (start % MINUTES_PER_DAY, end % MINUTES_PER_DAY);
        match start.cmp(&end) {
            std::cmp::Ordering::Less => (start..end).contains(&minute),
            std::cmp::Ordering::Greater => minute >= start || minute < end,
            std::cmp::Ordering::Equal => false,
        }
    }
}

/// Decide the delivery level of one event at `local_minute_of_day`.
pub fn decide(kind: EventKind, settings: &NotifySettings, local_minute_of_day: u16) -> Level {
    if kind.is_mandatory() {
        return Level::Loud;
    }
    match settings.level_for(kind) {
        Level::Loud if settings.in_quiet_hours(local_minute_of_day) => Level::Quiet,
        level => level,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(h: u16, m: u16) -> u16 {
        h * 60 + m
    }

    fn overnight() -> NotifySettings {
        NotifySettings {
            per_kind: BTreeMap::new(),
            quiet_hours: Some((at(22, 0), at(7, 0))),
        }
    }

    #[test]
    fn mandatory_kind_is_loud_in_quiet_hours_even_when_muted() {
        let mut settings = overnight();
        for kind in [EventKind::DecisionsForYou, EventKind::MainRed] {
            settings.per_kind.insert(kind, Level::Mute);
            assert_eq!(decide(kind, &settings, at(23, 30)), Level::Loud);
            settings.per_kind.insert(kind, Level::Quiet);
            assert_eq!(decide(kind, &settings, at(12, 0)), Level::Loud);
        }
    }

    #[test]
    fn exactly_two_kinds_are_mandatory() {
        let mandatory: Vec<_> = EventKind::ALL
            .into_iter()
            .filter(|k| k.is_mandatory())
            .collect();
        assert_eq!(mandatory, [EventKind::DecisionsForYou, EventKind::MainRed]);
    }

    #[test]
    fn loud_becomes_quiet_in_quiet_hours_and_mute_stays_mute() {
        let mut settings = overnight();
        settings.per_kind.insert(EventKind::AgentStuck, Level::Loud);
        settings.per_kind.insert(EventKind::PrMerged, Level::Mute);
        assert_eq!(
            decide(EventKind::AgentStuck, &settings, at(23, 0)),
            Level::Quiet
        );
        assert_eq!(
            decide(EventKind::AgentStuck, &settings, at(12, 0)),
            Level::Loud
        );
        assert_eq!(
            decide(EventKind::PrMerged, &settings, at(23, 0)),
            Level::Mute
        );
        assert_eq!(
            decide(EventKind::QuotaHigh, &settings, at(23, 0)),
            Level::Quiet
        );
    }

    #[test]
    fn user_quiet_level_stays_quiet_inside_and_outside_quiet_hours() {
        let mut settings = overnight();
        settings
            .per_kind
            .insert(EventKind::AgentStuck, Level::Quiet);
        settings.per_kind.insert(EventKind::PrMerged, Level::Quiet);
        for kind in [EventKind::AgentStuck, EventKind::PrMerged] {
            assert_eq!(decide(kind, &settings, at(23, 0)), Level::Quiet);
            assert_eq!(decide(kind, &settings, at(12, 0)), Level::Quiet);
        }
    }

    #[test]
    fn quiet_window_wraps_midnight_with_exclusive_end() {
        let mut settings = overnight();
        settings.per_kind.insert(EventKind::TriggerRan, Level::Loud);
        let level = |minute| decide(EventKind::TriggerRan, &settings, minute);
        assert_eq!(level(at(21, 59)), Level::Loud);
        assert_eq!(level(at(22, 0)), Level::Quiet);
        assert_eq!(level(at(23, 30)), Level::Quiet);
        assert_eq!(level(at(0, 0)), Level::Quiet);
        assert_eq!(level(at(6, 59)), Level::Quiet);
        assert_eq!(level(at(7, 0)), Level::Loud);
    }

    #[test]
    fn same_day_window_and_empty_window() {
        let mut settings = NotifySettings {
            quiet_hours: Some((at(13, 0), at(14, 0))),
            ..NotifySettings::default()
        };
        settings.per_kind.insert(EventKind::AgentStuck, Level::Loud);
        assert_eq!(
            decide(EventKind::AgentStuck, &settings, at(13, 30)),
            Level::Quiet
        );
        assert_eq!(
            decide(EventKind::AgentStuck, &settings, at(14, 0)),
            Level::Loud
        );
        settings.quiet_hours = Some((at(9, 0), at(9, 0)));
        assert_eq!(
            decide(EventKind::AgentStuck, &settings, at(9, 0)),
            Level::Loud
        );
        settings.quiet_hours = None;
        assert_eq!(
            decide(EventKind::AgentStuck, &settings, at(13, 30)),
            Level::Loud
        );
    }

    #[test]
    fn missing_kind_in_stored_settings_uses_the_board_default() {
        let settings: NotifySettings =
            serde_json::from_str(r#"{"per_kind":{"agent_stuck":"loud"}}"#).unwrap();
        assert_eq!(settings.quiet_hours, None);
        assert_eq!(decide(EventKind::AgentStuck, &settings, 0), Level::Loud);
        assert_eq!(decide(EventKind::QuotaHigh, &settings, 0), Level::Quiet);
        assert_eq!(decide(EventKind::PrMerged, &settings, 0), Level::Mute);
        assert_eq!(decide(EventKind::TriggerRan, &settings, 0), Level::Mute);
        let empty: NotifySettings = serde_json::from_str("{}").unwrap();
        assert_eq!(empty, NotifySettings::default());
    }

    #[test]
    fn settings_round_trip_through_json() {
        let mut settings = overnight();
        settings.per_kind.insert(EventKind::QuotaHigh, Level::Loud);
        let json = serde_json::to_string(&settings).unwrap();
        assert_eq!(
            serde_json::from_str::<NotifySettings>(&json).unwrap(),
            settings
        );
    }
}
