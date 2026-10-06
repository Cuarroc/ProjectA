//! Milestone, inbox, parked and later tables from a ProjectA plan.
//! Caller-supplied UTF-8. No import and no app change. Single-line rows only;
//! a short row is skipped. Escaped pipes are unsupported.

#[rustfmt::skip]
macro_rules! row {
    ($name:ident { $($field:ident),* $(,)? }) => {
        #[derive(Debug, Clone, PartialEq, Eq)]
        pub struct $name { $(pub $field: String,)* }
    };
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct MilestonePlan {
    pub milestones: Vec<Milestone>,
    pub decisions: Vec<Decision>,
    pub parked: Vec<ParkedItem>,
    pub later: Vec<LaterItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Milestone {
    pub id: String,
    pub title: String,
    pub packages: Vec<Package>,
}

#[rustfmt::skip] row!(Package { id, title, size, lane, stand });
#[rustfmt::skip] row!(Decision { id, question, recommendation, decider, status });
#[rustfmt::skip] row!(ParkedItem { what, reason, until });
#[rustfmt::skip] row!(LaterItem { topic, until });

#[rustfmt::skip]
#[derive(Clone, Copy, PartialEq, Eq)]
enum Section { None, Milestone, Decisions, Parked, Later }

#[rustfmt::skip]
pub fn parse_milestone_plan(source: &str) -> MilestonePlan {
    let lines: Vec<&str> = source.lines().collect();
    let mut plan = MilestonePlan::default();
    let mut section = Section::None;
    let mut index = 0;
    while index < lines.len() {
        let raw = lines[index].trim();
        if let Some((level, text)) = heading(raw) {
            if let Some((id, title)) = (level == 3).then_some(text).and_then(milestone_heading) {
                plan.milestones.push(Milestone { id: id.to_owned(), title: title.to_owned(), packages: Vec::new() });
                section = Section::Milestone;
            } else {
                section = section_for(level, text);
            }
            index += 1;
            continue;
        }
        if let Some(end) = table_end(&lines, index) {
            let header = cells(raw);
            if accepts(section, &header) {
                for raw_row in lines.iter().take(end).skip(index + 2) {
                    let parsed = cells(raw_row.trim());
                    if parsed.len() == header.len() {
                        record(&mut plan, section, &header, &parsed);
                    }
                }
            }
            index = end;
            continue;
        }
        index += 1;
    }
    plan
}

fn heading(line: &str) -> Option<(usize, &str)> {
    let level = line.bytes().take_while(|byte| *byte == b'#').count();
    if !(1..=6).contains(&level) {
        return None;
    }
    let text = line[level..].strip_prefix(' ')?.trim();
    (!text.is_empty()).then_some((level, text))
}

fn milestone_heading(text: &str) -> Option<(&str, &str)> {
    let (id, rest) = text.split_once(char::is_whitespace)?;
    if id.len() < 2 || !id.starts_with('M') || !id[1..].bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let rest = rest.trim_start();
    let rest = ["—", "–", "-"]
        .iter()
        .find_map(|dash| rest.strip_prefix(dash))?;
    let title = rest.trim();
    (!title.is_empty()).then_some((id, title))
}

fn section_for(level: usize, text: &str) -> Section {
    if level == 2 && text.starts_with("Entscheidungs-Inbox") {
        Section::Decisions
    } else if level == 3 && (text == "Geparkt" || text.starts_with("Geparkt ")) {
        Section::Parked
    } else if level == 3 && (text.starts_with("Später") || text.starts_with("Spaeter")) {
        Section::Later
    } else {
        Section::None
    }
}

fn table_end(lines: &[&str], index: usize) -> Option<usize> {
    if !lines[index].trim().starts_with('|') || !is_separator(lines.get(index + 1)?.trim()) {
        return None;
    }
    let mut end = index + 2;
    while end < lines.len() && lines[end].trim().starts_with('|') {
        end += 1;
    }
    Some(end)
}

#[rustfmt::skip]
fn is_separator(line: &str) -> bool {
    let parsed = cells(line);
    !parsed.is_empty() && parsed.iter().all(|cell| {
        let dashes = cell.trim_matches(':');
        dashes.len() >= 3 && dashes.bytes().all(|byte| byte == b'-')
    })
}

#[rustfmt::skip]
fn cells(line: &str) -> Vec<&str> {
    line.trim().trim_start_matches('|').trim_end_matches('|').split('|').map(str::trim).collect()
}

#[rustfmt::skip]
fn accepts(section: Section, header: &[&str]) -> bool {
    let has = |name: &str| header.contains(&name);
    match section {
        Section::Milestone => has("ID") && has("Paket") && has("Gr.") && has("Lane") && has("Stand"),
        Section::Decisions => has("#") && has("Frage") && has("Empfehlung") && has("Wer entscheidet?") && has("Status"),
        Section::Parked => has("Was") && has("Grund") && has("Wann wieder"),
        Section::Later => has("Thema") && has("Wann wieder"),
        Section::None => false,
    }
}

#[rustfmt::skip]
fn cell(header: &[&str], row: &[&str], name: &str) -> String {
    header.iter().position(|column| *column == name).and_then(|i| row.get(i).copied()).unwrap_or("").to_owned()
}

#[rustfmt::skip]
fn record(plan: &mut MilestonePlan, section: Section, header: &[&str], row: &[&str]) {
    match section {
        Section::Milestone => {
            let id = cell(header, row, "ID");
            if id.is_empty() { return; }
            if let Some(milestone) = plan.milestones.last_mut() {
                milestone.packages.push(Package {
                    id,
                    title: cell(header, row, "Paket"),
                    size: cell(header, row, "Gr."),
                    lane: cell(header, row, "Lane"),
                    stand: cell(header, row, "Stand"),
                });
            }
        }
        Section::Decisions => {
            let id = cell(header, row, "#");
            if id.is_empty() { return; }
            plan.decisions.push(Decision {
                id,
                question: cell(header, row, "Frage"),
                recommendation: cell(header, row, "Empfehlung"),
                decider: cell(header, row, "Wer entscheidet?"),
                status: cell(header, row, "Status"),
            });
        }
        Section::Parked => {
            let what = cell(header, row, "Was");
            if what.is_empty() { return; }
            plan.parked.push(ParkedItem { what, reason: cell(header, row, "Grund"), until: cell(header, row, "Wann wieder") });
        }
        Section::Later => {
            let topic = cell(header, row, "Thema");
            if topic.is_empty() { return; }
            plan.later.push(LaterItem { topic, until: cell(header, row, "Wann wieder") });
        }
        Section::None => {}
    }
}

#[cfg(test)]
#[rustfmt::skip]
mod tests {
    use super::*;

    #[test]
    fn plan_excerpt_reads_columns_inbox_parked_and_later() {
        let plan = parse_milestone_plan(include_str!("../testdata/plan_milestone_excerpt.md"));
        let m1 = &plan.milestones[0];
        assert_eq!(m1.id, "M1");
        assert!(m1.title.starts_with("Alles Laufende gelandet"));
        let pkg = &m1.packages[0];
        assert_eq!(pkg.id, "W2-03");
        assert_eq!(pkg.title, "Usage-/Billing-Collectors je Adapter");
        assert_eq!(pkg.size, "M");
        assert_eq!(pkg.lane, "st");
        assert_eq!(pkg.stand, "✓ alt-#140");
        assert_eq!(m1.packages[1].id, "W2-06");
        assert_eq!(m1.packages[1].lane, "mn + sup");
        let setup = &plan.milestones[1].packages[0];
        assert_eq!(setup.id, "SETUP-14");
        assert_eq!(setup.size, "S");
        assert_eq!(setup.lane, "N");
        assert!(setup.stand.starts_with("teilweise:"));
        let decision = &plan.decisions[0];
        assert_eq!(decision.id, "E3");
        assert!(decision.question.starts_with("Secrets aus der Repo-Ebene"));
        assert_eq!(decision.recommendation, "ja; einmal im Browser klicken");
        assert_eq!(decision.decider, "Nutzer");
        assert_eq!(decision.status, "offen (Nutzer)");
        assert!(plan.parked[0].what.contains("W1-09c"));
        assert_eq!(plan.parked[0].reason, "Komfort, niedriger Nutzen");
        assert_eq!(plan.parked[0].until, "nach M4");
        assert_eq!(plan.later[0].topic, "Vorzeige-README für die Bewerbung");
        assert_eq!(plan.later[0].until, "später");
        let short = parse_milestone_plan("### M9 - Probe\n| ID | Paket | Gr. | Lane | Stand |\n|---|---|---|---|---|\n| OK | Name | S | fR | offen |\n| BAD | x |\n");
        assert_eq!(short.milestones[0].packages.len(), 1);
        assert_eq!(short.milestones[0].packages[0].id, "OK");
    }

    #[test]
    fn plan_live_document_reads_m1_through_m4() {
        let plan = parse_milestone_plan(include_str!("../../docs/PLAN.md"));
        assert_eq!(plan.milestones[0].id, "M1");
        assert_eq!(plan.milestones[1].id, "M2");
        assert_eq!(plan.milestones[2].id, "M3");
        assert_eq!(plan.milestones[3].id, "M4");
        assert_eq!(plan.milestones[4].id, "M5");
        assert!(plan.milestones.iter().take(4).all(|item| item.packages.len() > 5));
        let mut saw_df15 = false;
        let mut saw_df00 = false;
        for milestone in &plan.milestones {
            for package in &milestone.packages {
                assert!(!package.id.is_empty() && !package.title.is_empty(), "{}", package.id);
                assert!(!package.size.is_empty() && !package.lane.is_empty() && !package.stand.is_empty(), "{}", package.id);
                saw_df15 |= package.id == "DF-15b";
                saw_df00 |= package.id == "DF-00";
            }
        }
        assert!(saw_df15 && !saw_df00);
        let mut saw_e3 = false;
        for decision in &plan.decisions {
            if decision.id == "E3" {
                assert_eq!(decision.status, "offen (Nutzer)");
                saw_e3 = true;
            }
        }
        assert!(saw_e3);
        assert!(plan.parked.iter().any(|item| item.what.contains("W1-09c") && item.until == "nach M4"));
        assert!(plan.parked.iter().all(|item| !item.what.contains("Pflicht-Berichtsdatei")));
        assert!(plan.later.iter().any(|item| item.topic.starts_with("Vorzeige-README") && item.until == "später"));
        assert!(plan.later.iter().all(|item| !item.topic.contains("INV-SEC-VAULT")));
    }
}
