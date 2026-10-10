//! Proof at the commit: gate results bound to a SHA, pure and storage-free.
//!
//! A green gate proves nothing about a later commit, so evidence only counts at
//! exactly the head SHA (same idea as `candidate_commit` invalidation in
//! `store/development_runs.rs`). Callers pass the `gates.sh --list` text and the
//! recorded results in; nothing here runs a script or touches the database.

use std::collections::BTreeMap;

/// One recorded gate run. `sha` is the commit it ran against.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GateResult {
    pub lane: String,
    pub gate: String,
    pub exit_code: i32,
    pub sha: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProofStatus {
    /// Every required gate of the lane has exit 0 at exactly the head SHA.
    Belegt,
    /// A required gate failed at the head SHA.
    Rot { gate: String },
    /// Evidence exists only for older SHAs; a newer commit invalidated it.
    Veraltet,
    /// No usable evidence.
    Fehlt,
}

/// Required gates per lane, parsed from `gates.sh --list` text.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LanePlan(BTreeMap<String, Vec<String>>);

impl LanePlan {
    /// Each row is `<gate> <lane,lane,...> <command...>`; blank or one-column
    /// rows are skipped. Gate order is kept per lane.
    pub fn from_list(text: &str) -> Self {
        let mut lanes: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for line in text.lines() {
            let mut cols = line.split_whitespace();
            let (Some(gate), Some(csv)) = (cols.next(), cols.next()) else {
                continue;
            };
            for lane in csv.split(',').filter(|l| !l.is_empty()) {
                lanes
                    .entry(lane.to_string())
                    .or_default()
                    .push(gate.to_string());
            }
        }
        Self(lanes)
    }

    pub fn required(&self, lane: &str) -> &[String] {
        self.0.get(lane).map_or(&[], Vec::as_slice)
    }
}

/// Results of one lane against its required gates.
#[derive(Debug, Clone)]
pub struct ProofSet {
    required: Vec<String>,
    results: Vec<GateResult>,
}

impl ProofSet {
    /// `results` are in recording order; for the same gate and SHA the last one
    /// wins (a re-run). Results of other lanes are ignored.
    pub fn new(plan: &LanePlan, lane: &str, results: &[GateResult]) -> Self {
        Self {
            required: plan.required(lane).to_vec(),
            results: results.iter().filter(|r| r.lane == lane).cloned().collect(),
        }
    }

    pub fn status(&self, head_sha: &str) -> ProofStatus {
        if self.required.is_empty() || head_sha.is_empty() {
            return ProofStatus::Fehlt;
        }
        let at_head = |gate: &str| {
            self.results
                .iter()
                .rev()
                .find(|r| r.gate == gate && r.sha == head_sha)
        };
        if let Some(red) = self
            .required
            .iter()
            .find(|g| at_head(g).is_some_and(|r| r.exit_code != 0))
        {
            return ProofStatus::Rot { gate: red.clone() };
        }
        let missing: Vec<&String> = self
            .required
            .iter()
            .filter(|g| at_head(g).is_none())
            .collect();
        if missing.is_empty() {
            return ProofStatus::Belegt;
        }
        let older = missing.iter().any(|g| {
            self.results
                .iter()
                .any(|r| &r.gate == *g && r.sha != head_sha)
        });
        if older {
            ProofStatus::Veraltet
        } else {
            ProofStatus::Fehlt
        }
    }
}

/// The `NICHT ABGEDECKT` block of a PR body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Uncovered {
    /// No such block, or a heading without any line under it. Never read this
    /// as "nothing is uncovered".
    Missing,
    Lines(Vec<String>),
}

fn is_heading(line: &str) -> bool {
    let line = line.trim_start();
    let hashes = line.bytes().take_while(|b| *b == b'#').count();
    (1..=6).contains(&hashes) && line[hashes..].starts_with([' ', '\t'])
}

/// The fence character if `line` opens or closes a fenced code block.
fn fence_char(line: &str) -> Option<char> {
    let line = line.trim_start();
    ['`', '~']
        .into_iter()
        .find(|c| line.starts_with(&c.to_string().repeat(3)))
}

/// Label line without heading hashes or bold/italic marks.
fn label(line: &str) -> &str {
    line.trim_matches(|c: char| matches!(c, '#' | '*' | '_' | ' ' | '\t'))
}

/// Content line without one leading list marker.
fn item(line: &str) -> &str {
    let line = line.trim();
    ["- ", "* ", "+ "]
        .iter()
        .find_map(|m| line.strip_prefix(m))
        .unwrap_or(line)
        .trim()
}

const MARKER: &str = "NICHT ABGEDECKT";

/// Text from the heading/label line `NICHT ABGEDECKT` (any `#` level, bold or
/// plain, optional `:`) up to the next heading, one entry per non-empty line
/// with list markers removed. Text on the label line itself counts as a line.
/// The marker must not run into a longer word, and fenced code blocks (``` or
/// ~~~) never hold a marker or a heading.
pub fn parse_uncovered(body: &str) -> Uncovered {
    let mut lines = Vec::new();
    let mut inside = false;
    let mut fence: Option<char> = None;
    for raw in body.lines() {
        if let Some(c) = fence_char(raw) {
            match fence {
                None => fence = Some(c),
                Some(open) if open == c => fence = None,
                Some(_) => {}
            }
            continue;
        }
        if fence.is_some() {
            if inside && !item(raw).is_empty() {
                lines.push(item(raw).to_string());
            }
            continue;
        }
        if inside {
            if is_heading(raw) {
                break;
            }
            if !item(raw).is_empty() {
                lines.push(item(raw).to_string());
            }
            continue;
        }
        let label = label(raw);
        let Some(head) = label
            .get(..MARKER.len())
            .filter(|h| h.eq_ignore_ascii_case(MARKER))
        else {
            continue;
        };
        let rest = &label[head.len()..];
        if rest.chars().next().is_some_and(char::is_alphanumeric) {
            continue;
        }
        inside = true;
        let rest = rest.trim_start_matches([':', '*', '_', ' ']);
        if !rest.is_empty() {
            lines.push(rest.to_string());
        }
    }
    if lines.is_empty() {
        Uncovered::Missing
    } else {
        Uncovered::Lines(lines)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str =
        "fmt              precommit,prepush,windows  (cd src-tauri && cargo fmt --check)\n\
clippy           prepush,windows   (cd src-tauri && cargo clippy)\n\
secrets          precommit         (cd . && bash scripts/ci/secret-scan.sh)\n\
\n\
stray\n";

    fn r(gate: &str, exit_code: i32, sha: &str) -> GateResult {
        GateResult {
            lane: "prepush".into(),
            gate: gate.into(),
            exit_code,
            sha: sha.into(),
        }
    }

    fn set(results: &[GateResult]) -> ProofSet {
        ProofSet::new(&LanePlan::from_list(LIST), "prepush", results)
    }

    #[test]
    fn gate_list_is_parsed_into_lanes_in_order() {
        let plan = LanePlan::from_list(LIST);
        assert_eq!(plan.required("prepush"), ["fmt", "clippy"]);
        assert_eq!(plan.required("precommit"), ["fmt", "secrets"]);
        assert_eq!(plan.required("windows"), ["fmt", "clippy"]);
        assert!(plan.required("nope").is_empty());
    }

    #[test]
    fn all_green_at_head_is_belegt() {
        assert_eq!(
            set(&[r("fmt", 0, "b"), r("clippy", 0, "b")]).status("b"),
            ProofStatus::Belegt
        );
    }

    #[test]
    fn green_at_old_sha_is_veraltet_after_new_commit() {
        let proof = set(&[r("fmt", 0, "a"), r("clippy", 0, "a")]);
        assert_eq!(proof.status("a"), ProofStatus::Belegt);
        assert_eq!(proof.status("b"), ProofStatus::Veraltet);
    }

    #[test]
    fn red_gate_at_head_is_rot_and_names_it() {
        let proof = set(&[r("fmt", 0, "b"), r("clippy", 101, "b")]);
        assert_eq!(
            proof.status("b"),
            ProofStatus::Rot {
                gate: "clippy".into()
            }
        );
    }

    #[test]
    fn rerun_green_replaces_red_and_other_lanes_are_ignored() {
        let mut other = r("clippy", 1, "b");
        other.lane = "linux".into();
        let proof = set(&[
            r("fmt", 0, "b"),
            r("clippy", 1, "b"),
            r("clippy", 0, "b"),
            other,
        ]);
        assert_eq!(proof.status("b"), ProofStatus::Belegt);
    }

    #[test]
    fn missing_or_empty_evidence_is_fehlt() {
        assert_eq!(set(&[]).status("b"), ProofStatus::Fehlt);
        assert_eq!(set(&[r("fmt", 0, "b")]).status("b"), ProofStatus::Fehlt);
        assert_eq!(set(&[r("fmt", 0, "")]).status(""), ProofStatus::Fehlt);
        assert_eq!(
            ProofSet::new(&LanePlan::default(), "prepush", &[]).status("b"),
            ProofStatus::Fehlt
        );
    }

    #[test]
    fn missing_nicht_abgedeckt_block_is_reported_missing() {
        assert_eq!(
            parse_uncovered("Drei Saetze.\n\n## Report\nalles gruen\n"),
            Uncovered::Missing
        );
        assert_eq!(
            parse_uncovered("## NICHT ABGEDECKT\n\n## Review\nausstehend\n"),
            Uncovered::Missing
        );
    }

    #[test]
    fn nicht_abgedeckt_block_stops_at_next_heading() {
        let body = "## Report\n**NICHT ABGEDECKT:**\n- Windows-Haelfte\r\n* `cfg(unix)` Tests\n\n## Review\nausstehend\n";
        assert_eq!(
            parse_uncovered(body),
            Uncovered::Lines(vec!["Windows-Haelfte".into(), "`cfg(unix)` Tests".into()])
        );
        assert_eq!(
            parse_uncovered("NICHT ABGEDECKT: Windows\n#12 bleibt offen\n### Rest\nx"),
            Uncovered::Lines(vec!["Windows".into(), "#12 bleibt offen".into()])
        );
    }

    #[test]
    fn marker_must_end_at_a_word_boundary() {
        assert_eq!(
            parse_uncovered("## Nicht abgedeckte Fälle\n- x\n"),
            Uncovered::Missing
        );
        assert_eq!(
            parse_uncovered("NICHT ABGEDECKTES Problem\n- x\n"),
            Uncovered::Missing
        );
        assert_eq!(
            parse_uncovered("**NICHT ABGEDECKT:** a"),
            Uncovered::Lines(vec!["a".into()])
        );
        assert_eq!(
            parse_uncovered("## NICHT ABGEDECKT\n- a"),
            Uncovered::Lines(vec!["a".into()])
        );
    }

    #[test]
    fn marker_inside_a_fenced_code_block_is_ignored() {
        assert_eq!(
            parse_uncovered("## Template\n```md\n## NICHT ABGEDECKT\n- x\n```\n"),
            Uncovered::Missing
        );
        assert_eq!(
            parse_uncovered("~~~\nNICHT ABGEDECKT: x\n~~~\n"),
            Uncovered::Missing
        );
        assert_eq!(
            parse_uncovered("```\ncode\n```\n## NICHT ABGEDECKT\n- real\n"),
            Uncovered::Lines(vec!["real".into()])
        );
    }

    #[test]
    fn heading_inside_a_fence_does_not_end_the_block() {
        assert_eq!(
            parse_uncovered(
                "## NICHT ABGEDECKT\n- a\n```\n## not a heading\n```\n- b\n## Review\nx"
            ),
            Uncovered::Lines(vec!["a".into(), "## not a heading".into(), "b".into()])
        );
    }

    #[test]
    fn heading_with_tab_after_hashes_ends_the_block() {
        assert_eq!(
            parse_uncovered("## NICHT ABGEDECKT\n- a\n##\tReview\nnope"),
            Uncovered::Lines(vec!["a".into()])
        );
    }

    #[test]
    fn green_then_red_rerun_at_head_is_rot() {
        let proof = set(&[r("fmt", 0, "b"), r("clippy", 0, "b"), r("clippy", 1, "b")]);
        assert_eq!(
            proof.status("b"),
            ProofStatus::Rot {
                gate: "clippy".into()
            }
        );
    }
}
