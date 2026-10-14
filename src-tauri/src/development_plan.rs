//! Pure projection of explicitly supported plan tables; no import or runtime effects.
//! UTF-8 source and path are caller supplied. Pipe-bounded tables use the four
//! headers below, optional Eltern/Parent, comma-separated ASCII IDs, and empty,
//! hyphen or em-dash for no references. Escaped pipes are explicitly unsupported.
//! Pipe-containing prose after a plan table requires a blank separator line.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

// Consumer: V2-S04b (Eingang & Plan, tab Ideen). Pure triage logic, unused until then.
#[cfg_attr(not(test), allow(dead_code))]
mod idea_triage;

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
        let required = |name| {
            field(name)
                .ok_or_else(|| error(n, &format!("plan table is missing required column {name}")))
        };
        let Some(title) = header
            .iter()
            .position(|c| c.starts_with("Paket"))
            .map(|i| cells[i])
        else {
            return Err(error(n, "plan table is missing required column Paket"));
        };
        let id = required("ID")?;
        let acceptance = required("Konkretes Ergebnis und Abnahme")?;
        let dependencies = required("Nach")?;
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
            dependency_ids: references(dependencies)?,
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

/// Historical source only: raw status is never evidence of a merged PR.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoricalMilestone {
    pub milestone_id: String,
    pub title: String,
    pub source_line: usize,
    pub packages: Vec<HistoricalMilestonePackage>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoricalMilestonePackage {
    pub package_id: String,
    pub title: String,
    pub size: String,
    pub lane: String,
    pub raw_status: String,
    pub source_line: usize,
}

// Consumer: subsequent V2-H2 slices; no runtime import in V2-H2-1.
/// Five named columns, in any order; cells retain Markdown and trimmed source text.
/// Uses parse_plan's fence/delimiter rules and rejects escaped pipes. A table
/// with at least three milestone column names is a candidate, including damage.
#[cfg_attr(not(test), allow(dead_code))]
pub fn parse_milestones(
    source_path: &str,
    source: &str,
) -> Result<Vec<HistoricalMilestone>, PlanError> {
    let error = |source_line, reason: &str| PlanError {
        source_path: source_path.into(),
        source_line,
        reason: reason.into(),
    };
    let required = ["ID", "Paket", "Gr.", "Lane", "Stand"];
    let mut milestones = Vec::<HistoricalMilestone>::new();
    let mut current = None;
    let mut columns: Option<Vec<&str>> = None;
    let (mut delimiter, mut unrelated) = (false, false);
    let mut fence = None;
    for (offset, line) in source.lines().enumerate() {
        let n = offset + 1;
        let line = line.trim();
        if delimiter && !line.starts_with('|') {
            return Err(error(n, "missing table delimiter"));
        }
        if line.starts_with("```") || line.starts_with("~~~") {
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
            unrelated = false;
            continue;
        }
        if fence.is_some() {
            continue;
        }
        let hashes = line.bytes().take_while(|b| *b == b'#').count();
        if (1..=6).contains(&hashes) && line[hashes..].starts_with(char::is_whitespace) {
            current = None;
            if let Some((id, title)) = milestone_heading(line) {
                current = Some(milestones.len());
                milestones.push(HistoricalMilestone {
                    milestone_id: id.into(),
                    title: title.into(),
                    source_line: n,
                    packages: Vec::new(),
                });
            }
            columns = None;
            unrelated = false;
            continue;
        }
        if !line.starts_with('|') {
            if columns.is_some() && line.contains('|') {
                return Err(error(n, "table rows require a leading pipe; separate pipe-containing prose with a blank line"));
            }
            columns = None;
            unrelated = false;
            continue;
        }
        let Some(index) = current.filter(|_| !unrelated) else {
            continue;
        };
        // Strip exactly one boundary on each side, preserving empty edge cells.
        let body = &line[1..];
        let cells: Vec<_> = body
            .strip_suffix('|')
            .unwrap_or(body)
            .split('|')
            .map(str::trim)
            .collect();
        let Some(header) = columns.as_ref() else {
            if required.iter().filter(|name| cells.contains(name)).count() < 3 {
                unrelated = true;
                continue;
            }
            if cells.len() != 5
                || required
                    .iter()
                    .any(|name| cells.iter().filter(|c| *c == name).count() != 1)
            {
                return Err(error(
                    n,
                    "missing, duplicate or unsupported milestone columns",
                ));
            }
            if !line.ends_with('|') || line.contains("\\|") {
                return Err(error(
                    n,
                    "malformed milestone header or unsupported escaped pipe",
                ));
            }
            columns = Some(cells);
            delimiter = true;
            continue;
        };
        if !line.ends_with('|') || line.contains("\\|") || cells.len() != header.len() {
            return Err(error(
                n,
                "malformed row or delimiter, or unsupported escaped pipe",
            ));
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
        let field = |name| {
            let column = header.iter().position(|c| *c == name);
            column.map(|i| cells[i].to_owned()).ok_or_else(|| {
                error(
                    n,
                    &format!("milestone table is missing required column {name}"),
                )
            })
        };
        milestones[index].packages.push(HistoricalMilestonePackage {
            package_id: field("ID")?,
            title: field("Paket")?,
            size: field("Gr.")?,
            lane: field("Lane")?,
            raw_status: field("Stand")?,
            source_line: n,
        });
    }
    if delimiter {
        return Err(error(source.lines().count(), "missing table delimiter"));
    }
    Ok(milestones)
}

/// Lossless v2 cells (outer table padding trimmed), without dependency resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct V2Package {
    pub package_id: String,
    pub title: String,
    pub lane: String,
    pub seam: String,
    pub tier: String,
    pub size: String,
    pub raw_dependencies: String,
    pub provider: String,
    pub raw_acceptance: String,
    pub source_path: String,
    pub source_line: usize,
}

const V2_COLUMNS: [&str; 9] = [
    "ID",
    "Ziel",
    "Lane",
    "Naht",
    "Stufe",
    "Größe",
    "Hängt ab von",
    "Anbieter",
    "Abnahme",
];

// Consumer: V2-H2-3/EX-1; no import or runtime status in this projection.
#[cfg_attr(not(test), allow(dead_code))]
pub fn parse_v2_packages(source_path: &str, source: &str) -> Result<Vec<V2Package>, PlanError> {
    let error = |source_line, reason: &str| PlanError {
        source_path: source_path.into(),
        source_line,
        reason: reason.into(),
    };
    let mut packages = Vec::new();
    let mut ids = BTreeMap::new();
    let mut columns: Option<Vec<&str>> = None;
    let (mut delimiter, mut unrelated, mut fence) = (false, false, None);
    for (n, line) in (1..).zip(source.lines()) {
        let line = line.trim();
        if delimiter && !line.starts_with('|') {
            return Err(error(n, "missing table delimiter"));
        }
        if line.starts_with("```") || line.starts_with("~~~") {
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
            unrelated = false;
            continue;
        }
        if fence.is_some() {
            continue;
        }
        if !line.starts_with('|') {
            if columns.is_some() && line.contains('|') {
                return Err(error(n, "table rows require a leading pipe"));
            }
            columns = None;
            unrelated = false;
            continue;
        }
        if unrelated {
            continue;
        }
        let cells: Vec<_> = line[1..].split_terminator('|').map(str::trim).collect();
        let Some(header) = columns.as_ref() else {
            let header: Vec<_> = cells
                .iter()
                .map(|c| match *c {
                    "Bildschirm (Boards)" => "Ziel",
                    "Abnahme (zusätzlich zu R)" | "Daten und zusätzliche Abnahme" => "Abnahme",
                    c => c,
                })
                .collect();
            // Five known columns identify a candidate, even with a damaged header.
            if V2_COLUMNS
                .iter()
                .filter(|name| header.contains(name))
                .count()
                < 5
            {
                unrelated = true;
                continue;
            }
            if !line.ends_with('|') || line.contains("\\|") {
                return Err(error(n, "malformed header or unsupported escaped pipe"));
            }
            if header.len() != 9 || V2_COLUMNS.iter().any(|name| !header.contains(name)) {
                return Err(error(n, "missing, duplicate or unsupported v2 columns"));
            }
            columns = Some(header);
            delimiter = true;
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
        let field = |name| {
            let column = header.iter().position(|c| *c == name);
            column
                .map(|i| cells[i])
                .ok_or_else(|| error(n, &format!("v2 table is missing required column {name}")))
        };
        let id = field("ID")?;
        if !valid_id(id) {
            return Err(error(n, "stable ID is required"));
        }
        if let Some(previous) = ids.insert(id, n) {
            let reason = format!("duplicate ID {id}; first line {previous}");
            return Err(error(n, &reason));
        }
        packages.push(V2Package {
            package_id: id.into(),
            title: field("Ziel")?.into(),
            lane: field("Lane")?.into(),
            seam: field("Naht")?.into(),
            tier: field("Stufe")?.into(),
            size: field("Größe")?.into(),
            raw_dependencies: field("Hängt ab von")?.into(),
            provider: field("Anbieter")?.into(),
            raw_acceptance: field("Abnahme")?.into(),
            source_path: source_path.into(),
            source_line: n,
        });
    }
    if delimiter {
        return Err(error(source.lines().count(), "missing table delimiter"));
    }
    Ok(packages)
}

/// Name resolution only, never readiness: nonempty unresolved fragments remain blockers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct V2Dependencies {
    pub package_id: String,
    pub source_path: String,
    pub source_line: usize,
    pub raw_dependencies: String,
    pub dependency_ids: Vec<String>,
    pub unresolved_fragments: Vec<String>,
}

// Consumer: later V2-H2 import slices; the caller also supplies foundation IDs.
#[cfg_attr(not(test), allow(dead_code))]
pub fn resolve_v2_dependencies(
    packages: &[V2Package],
    known_ids: &BTreeSet<String>,
) -> Vec<V2Dependencies> {
    packages
        .iter()
        .map(|p| {
            let mut row = V2Dependencies {
                package_id: p.package_id.clone(),
                source_path: p.source_path.clone(),
                source_line: p.source_line,
                raw_dependencies: p.raw_dependencies.clone(),
                dependency_ids: Vec::new(),
                unresolved_fragments: Vec::new(),
            };
            if matches!(p.raw_dependencies.trim(), "" | "–" | "—") {
                return row;
            }
            for fragment in v2_dependency_fragments(&p.raw_dependencies) {
                let token = fragment.trim();
                let gate = token
                    .strip_prefix('G')
                    .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()));
                let alias = (!token.starts_with("V2-"))
                    .then(|| format!("V2-{token}"))
                    .and_then(|id| known_ids.get(&id));
                let resolved = match (known_ids.get(token), alias) {
                    (Some(id), None) | (None, Some(id))
                        if valid_id(token) && !gate && id != &p.package_id =>
                    {
                        Some(id)
                    }
                    _ => None,
                };
                if let Some(id) = resolved {
                    if !row.dependency_ids.contains(id) {
                        row.dependency_ids.push(id.clone());
                    }
                } else if !row.unresolved_fragments.iter().any(|s| s == fragment) {
                    row.unresolved_fragments.push(fragment.to_owned());
                }
            }
            row
        })
        .collect()
}

fn v2_dependency_fragments(raw: &str) -> Vec<&str> {
    let (mut depth, mut start) = (0usize, 0);
    let mut fragments = Vec::new();
    for (i, c) in raw.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => match depth.checked_sub(1) {
                Some(d) => depth = d,
                None => return vec![raw],
            },
            ',' if depth == 0 => {
                fragments.push(&raw[start..i]);
                start = i + 1;
            }
            _ => (),
        }
    }
    // Unbalanced conditions cannot establish independent simple references.
    if depth != 0 {
        return vec![raw];
    }
    fragments.push(&raw[start..]);
    fragments
}

fn milestone_heading(line: &str) -> Option<(&str, &str)> {
    let rest = line.strip_prefix("###")?;
    if !rest.starts_with(char::is_whitespace) {
        return None;
    }
    let (id, rest) = rest.trim_start().split_once(char::is_whitespace)?;
    let digits = id.strip_prefix('M')?;
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let title = rest.trim_start().strip_prefix(['—', '–', '-'])?;
    if !title.starts_with(char::is_whitespace) || title.trim().is_empty() {
        return None;
    }
    Some((id, title.trim()))
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

    const V2_HEADER: &str =
        "| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Abnahme |\n";
    const V2_DELIMITER: &str = "| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n";
    const V2_ROW: &str = "| V2-X | **Title** `code` | fR | – | B | M | | sol | R; test |\n";

    fn v2_cells(p: &V2Package) -> [&str; 9] {
        [
            &p.package_id,
            &p.title,
            &p.lane,
            &p.seam,
            &p.tier,
            &p.size,
            &p.raw_dependencies,
            &p.provider,
            &p.raw_acceptance,
        ]
    }

    fn dependency_fixture(rows: &[(&str, &str)]) -> Vec<V2Package> {
        let mut source = format!("{V2_HEADER}{V2_DELIMITER}");
        for (id, dependencies) in rows {
            source.push_str(&format!(
                "| {id} | **Title** | fR | – | B | M | {dependencies} | sol | R |\n"
            ));
        }
        parse_v2_packages("dependencies.md", &source).unwrap()
    }

    #[test]
    fn v2_dependency_resolution_expands_only_known_unambiguous_ids() {
        let packages = dependency_fixture(&[
            ("V2-X", "F9, V2-S01a, MN-A, V2-F9, S01a, MN-A, V2-NOPE"),
            ("V2-Y", "F9, S01a, MN-A"),
        ]);
        let known = ["V2-F9", "V2-S01a", "V2-MN-A"].map(String::from).into();
        let resolved = resolve_v2_dependencies(&packages, &known);
        assert_eq!(resolved[0].dependency_ids, ["V2-F9", "V2-S01a", "V2-MN-A"]);
        assert_eq!(resolved[0].unresolved_fragments, [" V2-NOPE"]);
        assert_eq!(resolved[1].dependency_ids, resolved[0].dependency_ids);
        assert!(resolved[1].unresolved_fragments.is_empty());
        assert_eq!(resolved, resolve_v2_dependencies(&packages, &known));

        let ambiguous = ["F9", "V2-F9", "V2-S01a-extra", "V2-MN-A-extra"]
            .map(String::from)
            .into();
        let resolved = resolve_v2_dependencies(&packages[1..], &ambiguous);
        assert!(resolved[0].dependency_ids.is_empty());
        assert_eq!(resolved[0].unresolved_fragments, ["F9", " S01a", " MN-A"]);
        let exact = dependency_fixture(&[("V2-X", "V2-F9")]);
        assert_eq!(
            resolve_v2_dependencies(&exact, &ambiguous)[0].dependency_ids,
            ["V2-F9"]
        );
    }

    #[test]
    fn v2_dependency_resolution_preserves_gates_ranges_and_conditions() {
        let packages = dependency_fixture(&[
            ("V2-ST-B1", "V2-B9, V2-B10"),
            ("V2-CORE-3", "V2-CORE-1, V2-CORE-2"),
            ("V2-X", "G0, V2-CORE-1 bis 3, V2-B9 und V2-B10, V2-B9 (nur wenn bereit, sonst offen), V2-NOPE"),
            ("V2-Y", "V2-B9 (Kern; (bedingt), offen), V2-B10"),
            ("V2-Z", "V2-B9 (offen, V2-B10"),
            ("V2-W", "V2-B9), V2-B10"),
        ]);
        let known = ["V2-B9", "V2-B10", "V2-CORE-1", "V2-CORE-2", "G0", "V2-G0"]
            .map(String::from)
            .into();
        let resolved = resolve_v2_dependencies(&packages, &known);
        assert_eq!(resolved[0].dependency_ids, ["V2-B9", "V2-B10"]);
        assert_eq!(resolved[1].dependency_ids, ["V2-CORE-1", "V2-CORE-2"]);
        assert!(resolved[0].unresolved_fragments.is_empty());
        assert!(resolved[1].unresolved_fragments.is_empty());
        assert!(resolved[2].dependency_ids.is_empty());
        assert_eq!(
            resolved[2].unresolved_fragments,
            [
                "G0",
                " V2-CORE-1 bis 3",
                " V2-B9 und V2-B10",
                " V2-B9 (nur wenn bereit, sonst offen)",
                " V2-NOPE",
            ]
        );
        assert_eq!(resolved[3].dependency_ids, ["V2-B10"]);
        assert_eq!(
            resolved[3].unresolved_fragments,
            ["V2-B9 (Kern; (bedingt), offen)"]
        );
        for i in [4, 5] {
            assert!(resolved[i].dependency_ids.is_empty());
            assert_eq!(
                resolved[i].unresolved_fragments,
                [packages[i].raw_dependencies.clone()]
            );
        }
    }

    #[test]
    fn v2_dependency_resolution_keeps_source_and_rejects_self_references() {
        let packages = dependency_fixture(&[
            ("V2-X", "V2-X, X, F9, V2-NOPE, V2-NOPE"),
            ("V2-Y", ""),
            ("V2-Z", "–"),
            ("V2-W", "—"),
            ("V2-U", "V2-NOPE"),
            ("V2-V", ","),
        ]);
        let before = packages.clone();
        let known = ["V2-X", "V2-F9"].map(String::from).into();
        let resolved = resolve_v2_dependencies(&packages, &known);
        assert_eq!(resolved.len(), 6);
        assert_eq!(resolved[0].dependency_ids, ["V2-F9"]);
        assert_eq!(resolved[0].unresolved_fragments, ["V2-X", " X", " V2-NOPE"]);
        for row in &resolved[1..4] {
            assert!(row.dependency_ids.is_empty());
            assert!(row.unresolved_fragments.is_empty());
        }
        assert!(resolved[4].dependency_ids.is_empty());
        assert_eq!(resolved[4].unresolved_fragments, ["V2-NOPE"]);
        assert!(resolved[5].dependency_ids.is_empty());
        assert!(!resolved[5].unresolved_fragments.is_empty());
        for (i, (row, original)) in resolved.iter().zip(&packages).enumerate() {
            assert_eq!(row.package_id, original.package_id);
            assert_eq!(row.source_path, "dependencies.md");
            assert_eq!(row.source_line, i + 3);
            assert_eq!(row.raw_dependencies, original.raw_dependencies);
        }
        assert_eq!(packages, before);
        assert!(resolve_v2_dependencies(&[], &known).is_empty());
    }

    #[test]
    fn v2_package_tables_preserve_all_nine_columns_and_source_lines() {
        let source = format!("{V2_HEADER}{V2_DELIMITER}{V2_ROW}");
        let parsed = parse_v2_packages("fixture.md", &source).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(
            v2_cells(&parsed[0]),
            [
                "V2-X",
                "**Title** `code`",
                "fR",
                "–",
                "B",
                "M",
                "",
                "sol",
                "R; test"
            ]
        );
        assert_eq!(
            (&*parsed[0].source_path, parsed[0].source_line),
            ("fixture.md", 3)
        );
        let source = include_str!("../../docs/plan/v2.0/plan.md");
        let parsed = parse_v2_packages("docs/plan/v2.0/plan.md", source).unwrap();
        let expected = [
            (261, ["V2-H2", "Ein Plan-Parser (Rust) statt zwei; `hq-parse.mjs` entfällt später", "fR", "–", "B", "M", "G0", "sol", "R; Fixture mit allen Meilenstein-Spalten"]),
            (147, ["V2-B22", "Wachhund in der App: fertige und stehengebliebene Läufe erkennen und melden (heute `stuck.rs:117`, Skript `pa-orch/watchdog.sh` nicht prüfbar)", "fR", "–", "B", "M", "V2-O0", "sol", "Test: ein stehengebliebener Lauf erzeugt genau eine Meldung"]),
            (170, ["V2-ST-B1", "Tabellen: Beweise (Gate-Läufe, Reviews, Entwertung) – prüfen, was `store/development_runs.rs` schon abdeckt, bevor neu gebaut wird. **Erstes Paket der store-Spur** (Beweis-Schicht zuerst, 1a)", "st", "store", "A", "M", "V2-B9, V2-B10", "astra", "wie A1"]),
            (219, ["V2-S01a", "**Leitstand** (Main): Karten, Filter, „Braucht dich“ mit Antwort im Stream, Beweis je Karte; ersetzt `BoardView`/`WorkerPanel`-Optik, restylt `QuestionsView`", "fe", "–", "B", "3×M", "F9, V2-B9 (Beweis-Chip nur mit Daten, sonst `HonestState`)", "terra", "`get_board_state` (`main.rs:1720`), `answer_question`; Antwort erreicht das Terminal (Test)"]),
        ];
        for (line, cells) in expected {
            let p = parsed.iter().find(|p| p.package_id == cells[0]).unwrap();
            assert_eq!(v2_cells(p), cells);
            assert_eq!(p.source_line, line);
            assert_eq!(p.source_path, "docs/plan/v2.0/plan.md");
        }
    }

    #[test]
    fn v2_package_tables_reject_ambiguous_headers_and_broken_rows() {
        let valid = format!("{V2_HEADER}{V2_DELIMITER}{V2_ROW}");
        let mut cases = vec![
            (format!("{valid}{V2_ROW}"), 4, "duplicate ID"),
            (format!("{valid}\n{valid}"), 7, "duplicate ID"),
            (V2_HEADER.to_owned(), 1, "missing table delimiter"),
            (format!("{V2_HEADER}{V2_ROW}"), 2, "invalid table delimiter"),
            (format!("{V2_HEADER}\n"), 2, "missing table delimiter"),
            (format!("{V2_HEADER}```\n"), 2, "missing table delimiter"),
            (valid.replace("| V2-X", "V2-X"), 3, "leading pipe"),
            (valid.replace("R; test |", "R; test"), 3, "malformed"),
            (valid.replace("R; test", r"R\|test"), 3, "escaped pipe"),
            (valid.replace("| sol |", "| sol | extra |"), 3, "malformed"),
            (valid.replace("| sol |", "|"), 3, "malformed"),
            (valid.replace("V2-X", ""), 3, "stable ID"),
            (
                valid.replace("| --- |", "| -- |"),
                2,
                "invalid table delimiter",
            ),
            (valid.replace("Abnahme |", "Abnahme"), 1, "malformed"),
            (valid.replace("Ziel", r"Ziel\|extra"), 1, "escaped pipe"),
            (valid.replace("Ziel", "Ziel erweitert"), 1, "columns"),
            (valid.replace("Abnahme", "Abnahme erweitert"), 1, "columns"),
            (valid.replace("| Lane |", "| Ziel |"), 1, "columns"),
            (
                valid.replace("| Lane |", "| Bildschirm (Boards) |"),
                1,
                "columns",
            ),
            (
                valid.replace("| Lane |", "| Abnahme (zusätzlich zu R) |"),
                1,
                "columns",
            ),
            (valid.replace("| Lane |", "| extra | Lane |"), 1, "columns"),
        ];
        for name in V2_COLUMNS {
            cases.push((valid.replace(&format!("| {name} "), ""), 1, "columns"));
            cases.push((
                valid.replace(&format!("| {name} |"), &format!("| {name} | {name} |")),
                1,
                "columns",
            ));
        }
        for (source, line, reason) in cases {
            let err = parse_v2_packages("broken.md", &source).unwrap_err();
            assert_eq!(
                (&*err.source_path, err.source_line),
                ("broken.md", line),
                "{source}"
            );
            assert!(err.reason.contains(reason), "{err:?}: {source}");
        }
    }

    #[test]
    fn v2_package_tables_ignore_fences_and_keep_dependency_prose_unresolved() {
        let fenced = format!("{V2_HEADER}{V2_DELIMITER}{V2_ROW}");
        let unrelated = "| Key | Value |\n| --- | --- |\n| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Abnahme |\n\n";
        let source =
            format!("````md\n{fenced}```\n~~~\n{fenced}````\n~~~md\n{fenced}~~~\n{unrelated}");
        assert!(parse_v2_packages("fences.md", &source).unwrap().is_empty());
        for title in ["Ziel", "Bildschirm (Boards)"] {
            for acceptance in [
                "Abnahme",
                "Abnahme (zusätzlich zu R)",
                "Daten und zusätzliche Abnahme",
            ] {
                for deps in [
                    "",
                    "—",
                    "V2-ST-B1 (Kern; ...), V2-ST-B3 und V2-API-A (Rest)",
                    "G0, F9, S01a bis S01d und Frage 10 (nur wenn freigegeben)",
                ] {
                    let header = format!("| {acceptance} | Anbieter | Hängt ab von | Größe | Stufe | Naht | Lane | {title} | ID |\n");
                    let row = format!(
                        "| **R** | terra | {deps} | 3×M | B | – | fe | `Screen` | V2-S |\n"
                    );
                    let parsed = parse_v2_packages(
                        "screen.md",
                        &format!("{source}{header}{V2_DELIMITER}{row}"),
                    )
                    .unwrap();
                    assert_eq!(parsed.len(), 1);
                    assert_eq!(
                        v2_cells(&parsed[0]),
                        ["V2-S", "`Screen`", "fe", "–", "B", "3×M", deps, "terra", "**R**"]
                    );
                    assert_eq!(parsed[0].source_line, source.lines().count() + 3);
                }
            }
        }
    }

    const MILESTONE_HEADER: &str =
        "| ID | Paket | Gr. | Lane | Stand |\n| --- | --- | --- | --- | --- |\n";

    #[test]
    fn milestone_projection_preserves_all_five_columns() {
        let source = concat!(
            "### M1 — First milestone\n",
            "| ID | Paket | Gr. | Lane | Stand |\n| --- | --- | --- | --- | --- |\n",
            "| W1-01 | **Original** `title` | M | st → api | ✓ #42, PR #43 offen |\n\n",
            "### M2 - Second milestone\n",
            "| Stand | Lane | Paket | ID | Gr. |\n| :--- | ---: | --- | --- | --- |\n",
            "| in Arbeit | fR | Second package | W2-01 | S |\n",
            "| | fe → mn | Third package | W2-02 | |\n"
        );
        let parsed = parse_milestones("history.md", source).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(
            parsed
                .iter()
                .map(|m| (m.milestone_id.as_str(), m.title.as_str(), m.source_line))
                .collect::<Vec<_>>(),
            [("M1", "First milestone", 1), ("M2", "Second milestone", 6)]
        );
        let packages: Vec<_> = parsed
            .iter()
            .flat_map(|m| &m.packages)
            .map(|p| {
                (
                    p.package_id.as_str(),
                    p.title.as_str(),
                    p.size.as_str(),
                    p.lane.as_str(),
                    p.raw_status.as_str(),
                    p.source_line,
                )
            })
            .collect();
        assert_eq!(
            packages,
            [
                (
                    "W1-01",
                    "**Original** `title`",
                    "M",
                    "st → api",
                    "✓ #42, PR #43 offen",
                    4
                ),
                ("W2-01", "Second package", "S", "fR", "in Arbeit", 9),
                ("W2-02", "Third package", "", "fe → mn", "", 10),
            ]
        );
    }

    #[test]
    fn milestone_projection_ignores_fences_and_other_sections() {
        let table = format!("{MILESTONE_HEADER}| A | Kept | M | fR | PR #7 |\n");
        for heading in [
            "# End",
            "## End",
            "### Other",
            "#### End",
            "##### End",
            "###### End",
        ] {
            let source = format!(
                "{table}````md\n### M9 — Example\n{table}```\n~~~\n{table}````\n\
                 ### M1 – Real\n~~~md\n{table}~~~\n\
                 | Name | Value |\n| --- | --- |\n| Example | Text |\n\n\
                 {table}\n{table}{heading}\n{table}### M3 — Empty\n"
            );
            let parsed = parse_milestones("history.md", &source).unwrap();
            assert_eq!(parsed.len(), 2, "{heading}");
            assert_eq!(parsed[0].milestone_id, "M1");
            assert_eq!(parsed[0].title, "Real");
            assert_eq!(parsed[0].packages.len(), 2);
            assert_eq!(parsed[0].packages[0].package_id, "A");
            assert_eq!(parsed[1].milestone_id, "M3");
            assert!(parsed[1].packages.is_empty());
        }
        assert!(parse_milestones("history.md", &table).unwrap().is_empty());
    }

    #[test]
    fn milestone_projection_reports_malformed_table_lines() {
        for name in ["ID", "Paket", "Gr.", "Lane", "Stand"] {
            for header in [
                MILESTONE_HEADER.replacen(&format!("{name} |"), "", 1),
                MILESTONE_HEADER.replacen(name, &format!("{name} | {name}"), 1),
            ] {
                let error = parse_milestones("history.md", &format!("### M1 — Test\n{header}"))
                    .unwrap_err();
                assert_eq!(
                    (error.source_path.as_str(), error.source_line),
                    ("history.md", 2)
                );
                assert!(error.reason.contains("columns"), "{error:?}");
            }
        }
        for row in [
            "| A | Title | M | fR |",
            "| A | Title | M | fR | open | extra |",
            "| A | a\\|b | M | fR | open |",
            "A | Title | M | fR | open |",
            "| A | Title | M | fR | open",
        ] {
            let error = parse_milestones(
                "history.md",
                &format!("### M1 — Test\n{MILESTONE_HEADER}{row}"),
            )
            .unwrap_err();
            assert_eq!(error.source_line, 4, "{row}");
            assert!(error.reason.contains("row"), "{error:?}");
        }
        for tail in [
            "",
            "\n### M2 — Next",
            "\n```",
            "\n| --- | --- | --- | --- | x |",
        ] {
            let source = format!("### M1 — Test\n| ID | Paket | Gr. | Lane | Stand |{tail}");
            let error = parse_milestones("history.md", &source).unwrap_err();
            assert_eq!(error.source_line, if tail.is_empty() { 2 } else { 3 });
            assert!(error.reason.contains("delimiter"), "{error:?}");
        }
    }

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

    /// Every subset (and each subset with a duplicated cell) of `names` as a
    /// table header followed by delimiter and one data row.
    fn header_variants(names: &[&str]) -> Vec<(Vec<String>, String)> {
        let mut out = Vec::new();
        for mask in 0..(1u32 << names.len()) {
            let picked: Vec<_> = (0..names.len())
                .filter(|i| mask >> i & 1 == 1)
                .map(|i| names[i].to_owned())
                .collect();
            let mut shapes = vec![picked.clone()];
            if let Some(first) = picked.first() {
                shapes.push([picked.clone(), vec![first.clone()]].concat());
            }
            for cells in shapes {
                let row = |fill: &str| format!("| {} |\n", vec![fill; cells.len()].join(" | "));
                let source = format!("| {} |\n{}{}", cells.join(" | "), row("---"), row("A"));
                out.push((cells, source));
            }
        }
        out
    }

    #[test]
    fn plan_table_without_required_columns_is_rejected_not_a_panic() {
        let required = ["ID", "Paket", "Nach", "Konkretes Ergebnis und Abnahme"];
        let names = [required.as_slice(), &["Eltern", "Parent", "Extra"]].concat();
        for (cells, source) in header_variants(&names) {
            let parsed = std::panic::catch_unwind(|| parse_plan("p", "plan", "x", &source));
            let parsed = parsed.unwrap_or_else(|_| panic!("parse_plan panicked on {cells:?}"));
            if required.iter().any(|name| !cells.iter().any(|c| c == name)) {
                assert!(parsed.is_err(), "accepted incomplete header {cells:?}");
            }
        }
    }

    #[test]
    fn milestone_table_without_required_columns_is_rejected_not_a_panic() {
        let required = ["ID", "Paket", "Gr.", "Lane", "Stand"];
        for (cells, table) in header_variants(&[required.as_slice(), &["Extra"]].concat()) {
            let source = format!("### M1 \u{2014} First\n{table}");
            let parsed = std::panic::catch_unwind(|| parse_milestones("x", &source));
            let parsed =
                parsed.unwrap_or_else(|_| panic!("parse_milestones panicked on {cells:?}"));
            let known = required
                .iter()
                .filter(|n| cells.iter().any(|c| c == *n))
                .count();
            if known >= 3 && required.iter().any(|n| !cells.iter().any(|c| c == n)) {
                assert!(parsed.is_err(), "accepted incomplete header {cells:?}");
            }
        }
    }

    #[test]
    fn v2_table_without_required_columns_is_rejected_not_a_panic() {
        for (cells, source) in header_variants(&[V2_COLUMNS.as_slice(), &["Extra"]].concat()) {
            let parsed = std::panic::catch_unwind(|| parse_v2_packages("x", &source));
            let parsed =
                parsed.unwrap_or_else(|_| panic!("parse_v2_packages panicked on {cells:?}"));
            let known = V2_COLUMNS
                .iter()
                .filter(|n| cells.iter().any(|c| c == *n))
                .count();
            if known >= 5 && V2_COLUMNS.iter().any(|n| !cells.iter().any(|c| c == n)) {
                assert!(parsed.is_err(), "accepted incomplete header {cells:?}");
            }
        }
    }
}
