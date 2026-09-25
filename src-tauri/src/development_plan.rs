//! Pure projection of explicitly supported plan tables; no import or runtime effects.
//! UTF-8 source and path are caller supplied. Pipe-bounded tables use the four
//! headers below, optional Eltern/Parent, comma-separated ASCII IDs, and empty,
//! hyphen or em-dash for no references. Escaped pipes are explicitly unsupported.
//! Pipe-containing prose after a plan table requires a blank separator line.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanProjection {
    pub project_id: String,
    pub plan_id: String,
    pub source_path: String,
    pub source_revision: String,
    pub packages: Vec<PlanPackage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanPackage {
    pub project_id: String,
    pub plan_id: String,
    pub package_id: String,
    pub parent_id: Option<String>,
    pub source_path: String,
    pub source_revision: String,
    pub source_line: usize,
    pub title: String,
    pub dependency_ids: Vec<String>,
    pub acceptance: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanError {
    pub source_path: String,
    pub source_line: usize,
    pub reason: String,
}

pub fn parse_plan(
    project_id: &str,
    plan_id: &str,
    source_path: &str,
    source: &str,
) -> Result<PlanProjection, PlanError> {
    let error = |line, reason: &str| PlanError {
        source_path: source_path.into(),
        source_line: line,
        reason: reason.into(),
    };
    if [project_id, plan_id, source_path]
        .iter()
        .any(|s| s.trim().is_empty())
    {
        return Err(error(1, "project, plan and source identity are required"));
    }
    let revision = format!("sha256:{:x}", Sha256::digest(source.as_bytes()));
    let mut packages = Vec::<PlanPackage>::new();
    let mut ids = BTreeMap::new();
    let mut columns: Option<Vec<&str>> = None;
    let mut delimiter = false;
    let mut fence = None;
    for (offset, line) in source.lines().enumerate() {
        let n = offset + 1;
        let line = line.trim();
        if line.starts_with("```") || line.starts_with("~~~") {
            if delimiter {
                return Err(error(n, "missing table delimiter before fence"));
            }
            let marker = line.as_bytes()[0];
            let count = line.bytes().take_while(|b| *b == marker).count();
            match fence {
                None => fence = Some((marker, count)),
                Some((m, c)) if marker == m && count >= c && line[count..].trim().is_empty() => {
                    fence = None
                }
                _ => (),
            }
            columns = None;
            continue;
        }
        if fence.is_some() {
            continue;
        }
        if !line.starts_with('|') {
            if delimiter {
                return Err(error(n, "missing table delimiter"));
            }
            if columns.is_some() && line.contains('|') {
                return Err(error(n, "table rows require a leading pipe; separate pipe-containing prose with a blank line"));
            }
            columns = None;
            continue;
        }
        let cells: Vec<_> = line.trim_matches('|').split('|').map(str::trim).collect();
        let candidate = columns.is_none()
            && cells.contains(&"ID")
            && cells.iter().any(|c| c.starts_with("Paket"))
            && (cells.contains(&"Nach")
                || cells.iter().any(|c| c.starts_with("Konkretes Ergebnis")));
        if candidate && line.contains("\\|") {
            return Err(error(n, "unsupported escaped pipe in plan header"));
        }
        let supported = candidate
            && cells.contains(&"Nach")
            && cells.contains(&"Konkretes Ergebnis und Abnahme");
        if candidate && !supported {
            return Err(error(
                n,
                "incomplete plan header: required columns are missing",
            ));
        }
        if supported {
            if delimiter || !line.ends_with('|') || line.contains("\\|") {
                return Err(error(n, "malformed header or missing table delimiter"));
            }
            if cells.iter().filter(|c| c.starts_with("Paket")).count() != 1
                || cells.iter().any(|c| {
                    !c.starts_with("Paket")
                        && !matches!(
                            *c,
                            "ID" | "Nach" | "Konkretes Ergebnis und Abnahme" | "Eltern" | "Parent"
                        )
                })
                || cells.iter().copied().collect::<BTreeSet<_>>().len() != cells.len()
                || cells
                    .iter()
                    .filter(|c| matches!(**c, "Eltern" | "Parent"))
                    .count()
                    > 1
            {
                return Err(error(n, "unsupported or ambiguous plan columns"));
            }
            columns = Some(cells);
            delimiter = true;
            continue;
        }
        let Some(header) = columns.as_ref() else {
            continue;
        };
        if !line.ends_with('|') || line.contains("\\|") || cells.len() != header.len() {
            return Err(error(n, "malformed row or unsupported escaped pipe"));
        }
        if delimiter {
            if cells.iter().any(|c| {
                let d = c.trim_matches(':');
                d.len() < 3 || !d.bytes().all(|b| b == b'-')
            }) {
                return Err(error(n, "invalid table delimiter"));
            }
            delimiter = false;
            continue;
        }
        let field = |name| header.iter().position(|c| *c == name).map(|i| cells[i]);
        let id = field("ID").unwrap();
        let title = cells[header.iter().position(|c| c.starts_with("Paket")).unwrap()];
        let acceptance = field("Konkretes Ergebnis und Abnahme").unwrap();
        if !valid_id(id) || title.is_empty() || acceptance.is_empty() {
            return Err(error(n, "stable ID, title and acceptance are required"));
        }
        if let Some(previous) = ids.insert(id.to_owned(), n) {
            return Err(error(
                n,
                &format!("duplicate ID {id}; first at line {previous}"),
            ));
        }
        let references = |text: &str| -> Result<Vec<String>, PlanError> {
            if matches!(text, "" | "—" | "-") {
                return Ok(Vec::new());
            }
            let refs: Vec<_> = text.split(',').map(str::trim).collect();
            if refs.iter().any(|id| !valid_id(id))
                || refs.iter().collect::<BTreeSet<_>>().len() != refs.len()
            {
                return Err(error(n, "invalid or duplicate reference ID"));
            }
            Ok(refs.into_iter().map(str::to_owned).collect())
        };
        let parent = references(field("Eltern").or_else(|| field("Parent")).unwrap_or(""))?;
        if parent.len() > 1 {
            return Err(error(n, "at most one parent is allowed"));
        }
        packages.push(PlanPackage {
            project_id: project_id.into(),
            plan_id: plan_id.into(),
            package_id: id.into(),
            parent_id: parent.into_iter().next(),
            source_path: source_path.into(),
            source_revision: revision.clone(),
            source_line: n,
            title: title.into(),
            dependency_ids: references(field("Nach").unwrap())?,
            acceptance: acceptance.into(),
        });
    }
    if delimiter {
        return Err(error(source.lines().count(), "missing table delimiter"));
    }
    if packages.is_empty() {
        return Err(error(1, "unsupported source: no plan packages"));
    }
    for parents in [false, true] {
        let edges = |p: &PlanPackage| {
            if parents {
                p.parent_id.iter().cloned().collect::<Vec<_>>()
            } else {
                p.dependency_ids.clone()
            }
        };
        for p in &packages {
            if let Some(id) = edges(p).iter().find(|id| !ids.contains_key(*id)) {
                return Err(error(p.source_line, &format!("unknown reference {id}")));
            }
        }
        let mut resolved = BTreeSet::new();
        while resolved.len() < packages.len() {
            let before = resolved.len();
            for p in &packages {
                if edges(p).iter().all(|id| resolved.contains(id)) {
                    resolved.insert(p.package_id.clone());
                }
            }
            if resolved.len() == before {
                let p = packages
                    .iter()
                    .find(|p| !resolved.contains(&p.package_id))
                    .unwrap();
                return Err(error(
                    p.source_line,
                    if parents {
                        "parent cycle or descendant of a cycle"
                    } else {
                        "dependency cycle or dependency on a cycle"
                    },
                ));
            }
        }
    }
    Ok(PlanProjection {
        project_id: project_id.into(),
        plan_id: plan_id.into(),
        source_path: source_path.into(),
        source_revision: revision,
        packages,
    })
}

fn valid_id(id: &str) -> bool {
    id.bytes().next().is_some_and(|b| b.is_ascii_alphanumeric())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

#[cfg(test)]
mod tests {
    use super::*;
    const HEADER: &str = "| ID | Paket / Agent / Scope | Nach | Konkretes Ergebnis und Abnahme | Eltern |\n| --- | --- | --- | --- | --- |\n";
    fn parse(rows: &str) -> Result<PlanProjection, PlanError> {
        parse_plan(
            "project",
            "plan",
            "docs/PLAN.md",
            &format!("{HEADER}{rows}"),
        )
    }
    #[test]
    fn projects_identity_source_and_relations_deterministically() {
        let rows = "| A-1 | Parent | — | Prove it | |\n| A-2 | Child | A-1 | Test it | A-1 |";
        let p = parse(rows).unwrap();
        assert_eq!(p, parse(rows).unwrap());
        assert_ne!(
            p.source_revision,
            parse(&format!("{rows}\n")).unwrap().source_revision
        );
        assert_eq!(p.packages[1].source_line, 4);
        assert_eq!(p.packages[1].parent_id.as_deref(), Some("A-1"));
        assert_eq!(p.packages[1].dependency_ids, ["A-1"]);
        assert_eq!(p.packages[0].acceptance, "Prove it");
        assert_eq!(p.packages[0].project_id, "project");
        assert_eq!(p.packages[0].plan_id, "plan");
        assert!(serde_json::to_value(&p)
            .unwrap()
            .get("sourceRevision")
            .is_some());
    }
    #[test]
    fn rejects_invalid_projection_with_source_location() {
        for rows in [
            "| | Title | — | Test | |",
            "| A-1 | Title | nope? | Test | |",
            "| A-1 | Title | X-1 | Test | |",
            "| A-1 | Title | — | Test | X-1 |",
            "| A-1 | Title | A-1 | Test | |",
            "| A-1 | Title | — | Test | A-1 |",
            "| A-1 | Title | — | Test | |\n| A-1 | Duplicate | — | Test | |",
            "| A-1 | Title | A-2 | Test | |\n| A-2 | Title | A-1 | Test | |",
            "| A-1 | Title | — | Test | A-2 |\n| A-2 | Title | — | Test | A-1 |",
            "| A-1 | Title | — | Test | |\n| A-2 | Title | A-1, A-1 | Test | |",
            "| A-1 | Title | — | a\\|b | |",
            "| A-1 | | — | Test | |",
        ] {
            let error = parse(rows).unwrap_err();
            assert_eq!(error.source_path, "docs/PLAN.md");
            assert!(error.source_line >= 3, "{error:?}");
        }
    }
    #[test]
    fn canonical_plan_has_exactly_38_devflow_packages() {
        let p = parse_plan(
            "p",
            "devflow",
            "docs/PLAN.md",
            include_str!("../../docs/PLAN.md"),
        )
        .unwrap();
        assert_eq!(p.packages.len(), 38);
        assert_eq!(p.packages[0].package_id, "DF-00");
        assert_eq!(p.packages[37].package_id, "DF-37");
        assert!(parse_plan("p", "plan", "x", "# No supported table").is_err());
    }

    #[test]
    fn subset_boundaries_and_identity_are_explicit() {
        let rows = "| A-1 | Title | — | Test | |";
        let source = format!("```md\n{HEADER}{rows}\n```\n{HEADER}{rows}");
        let p = parse_plan("other", "another", "supplied", &source).unwrap();
        assert_eq!(p.packages.len(), 1);
        assert_eq!(p.packages[0].source_line, 8);
        assert_eq!(p.packages[0].project_id, "other");
        assert_eq!(p.packages[0].plan_id, "another");
        assert_eq!(p.packages[0].source_path, "supplied");
        for rows in [
            "A-1 | Title | — | Test | |",
            "| A-1 | Title | — | Test",
            "| A-1 | Title | A-1, | Test | |",
            "| A-1 | Title | — | | |",
        ] {
            assert!(parse(rows).is_err(), "{rows}");
        }
        for source in [
            HEADER.to_owned(),
            HEADER.replace("---", "x"),
            HEADER.replace("Eltern", "ID"),
            format!("```\n{HEADER}{rows}\n```"),
            format!(
                "{}\n```\n```\n{HEADER}{rows}",
                HEADER.lines().next().unwrap()
            ),
        ] {
            assert!(parse_plan("p", "plan", "source", &source).is_err());
        }
        assert!(parse_plan("", "plan", "source", &source).is_err());
    }

    #[test]
    fn header_like_content_remains_data() {
        let rows = "| Nach | prerequisite | — | Test | |\n| ID | Paket | Nach | Konkretes Ergebnis und Abnahme | |";
        let p = parse(rows).unwrap();
        assert_eq!(p.packages[1].package_id, "ID");
        assert_eq!(p.packages[1].dependency_ids, ["Nach"]);
    }
    #[test]
    fn unknown_columns_are_rejected() {
        let header = HEADER
            .replace("Eltern |", "Eltern | Status |")
            .replace("--- |\n", "--- | --- |\n");
        let source = format!("{header}| A | Title | — | Test | | done |");
        assert!(parse_plan("p", "plan", "x", &source).is_err());
    }

    #[test]
    fn parent_alias_and_separated_unrelated_tables() {
        let rows = "| A | Root | — | Test | |\n| B | Child | — | Test | A |";
        let source = format!("{}{rows}", HEADER.replace("Eltern", "Parent"));
        let parse_source = |s: &str| parse_plan("p", "plan", "x", s);
        assert_eq!(
            parse_source(&source).unwrap().packages[1]
                .parent_id
                .as_deref(),
            Some("A")
        );
        assert!(parse_source(&source.replace("Parent |", "Parent | Eltern |")).is_err());
        let unrelated = "| Meaning | Value |\n| --- | --- |\n| example | prose |";
        let mixed = format!("{unrelated}\n\n{source}\n\n{unrelated}");
        assert_eq!(parse_source(&mixed).unwrap().packages.len(), 2);
        assert!(parse_source(&format!("{source}\n{unrelated}")).is_err());
    }

    #[test]
    fn blank_separator_allows_prose_containing_a_pipe() {
        assert!(parse("| A | Title | — | Test | |\n\nExplanation: A | B are choices.").is_ok());
    }
    #[test]
    fn malformed_nonleading_row_cannot_drop_following_packages() {
        let rows = "| A | Title | - | Test | |\nB | Title | - | Test\n| C | Title | - | Test | |";
        let error = parse(rows).unwrap_err();
        assert_eq!(error.source_line, 4);
    }
    #[test]
    fn damaged_candidate_header_is_not_silently_skipped() {
        let damaged = HEADER.replace("und Abnahme", "und \\| Abnahme");
        assert!(parse(&format!(
            "| A | Title | — | Test | |\n\n{damaged}| B | Title | - | Test | |"
        ))
        .is_err());
    }
    #[test]
    fn missing_delimiter_is_reported_at_fence() {
        let source = format!(
            "{}\n```\n```\n{HEADER}| A | Title | - | Test | |",
            HEADER.lines().next().unwrap()
        );
        assert_eq!(
            parse_plan("p", "plan", "x", &source)
                .unwrap_err()
                .source_line,
            2
        );
    }
    #[test]
    fn separated_plan_tables_can_reference_each_other() {
        let source = format!("| A | Title | - | Test | |\n\n{HEADER}| B | Title | A | Test | |");
        let p = parse(&source).unwrap();
        assert_eq!(p.packages.len(), 2);
        assert_eq!(p.packages[1].dependency_ids, ["A"]);
    }
    #[test]
    fn incomplete_candidate_cannot_hide_beside_valid_table() {
        for damaged in [
            HEADER.replace("Konkretes Ergebnis und Abnahme", "Abnahme"),
            HEADER.replace("Nach", "Dependency"),
        ] {
            let source = format!(
                "{damaged}| LOST | Title | - | Test | |\n\n{HEADER}| KEPT | Title | - | Test | |"
            );
            let error = parse_plan("p", "plan", "x", &source).unwrap_err();
            assert_eq!(error.source_line, 1);
        }
    }
    #[test]
    fn source_digest_matches_independent_sha256_vector() {
        let source = "| ID | Paket | Nach | Konkretes Ergebnis und Abnahme |\n| --- | --- | --- | --- |\n| A | Title | - | Test |";
        let p = parse_plan("p", "plan", "x", source).unwrap();
        // Derived independently with Node's crypto.createHash("sha256").
        assert_eq!(
            p.source_revision,
            "sha256:2a8051bf4b400f313164b6e6069b35cdbe01b0796356ad0f5b1332b0bf582f98"
        );
    }
}
