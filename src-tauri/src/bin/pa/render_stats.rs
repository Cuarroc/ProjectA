//! Plain-text rendering of `pa stats`.

use serde_json::Value;

use super::{duration, label_counts, num, text};

/// One project's statistics as a page of plain text.
///
/// Two things it refuses to do, both of them the reason the statistics tab
/// exists at all: it prints "not measured" where the OmniRoute ledger has no
/// rows rather than a row of zeroes, and it prints the completion figure with
/// the word "estimated" and its own arithmetic under it rather than alone.
pub(super) fn render_stats(stats: &Value) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "{}  ({})\nrange      {}\n\n",
        text(stats, "projectName"),
        text(stats, "projectId"),
        text(stats, "range")
    ));

    let overview = stats.get("overview").unwrap_or(&Value::Null);
    out.push_str(&format!(
        "workers    {} active, {} archived, {} total\n",
        num(overview, "workersActive"),
        num(overview, "workersArchived"),
        num(overview, "workersTotal")
    ));
    let columns = label_counts(overview.get("byColumn"));
    if !columns.is_empty() {
        out.push_str(&format!("board      {columns}\n"));
    }
    let queue = label_counts(overview.get("queue"));
    out.push_str(&format!(
        "queue      {}\n",
        if queue.is_empty() {
            "empty".to_string()
        } else {
            queue
        }
    ));
    out.push_str(&format!(
        "attention  {} card(s) waiting on you\nlearnings  {} pending\n",
        num(overview, "needsAttention"),
        num(overview, "learningsPending")
    ));
    out.push_str(&format!(
        "activity   {} message(s), {} status event(s), {} review comment(s) in range\n",
        num(overview, "messages"),
        num(overview, "statusEvents"),
        num(overview, "diffComments")
    ));

    out.push('\n');
    match stats.get("tokens") {
        None | Some(Value::Null) => out.push_str(
            "tokens     not measured - the omniroute ledger has no rows for this window.\n\
             \x20          only agents routed through omniroute are counted at all;\n\
             \x20          a cli talking to its vendor directly spends tokens nothing here sees.\n",
        ),
        Some(tokens) => {
            out.push_str(&format!(
                "tokens     {} request(s), {} in / {} out (fleet-wide, not per project)\n",
                num(tokens, "requests"),
                num(tokens, "tokensIn"),
                num(tokens, "tokensOut")
            ));
            let priced = tokens.get("priced").and_then(Value::as_i64).unwrap_or(0);
            out.push_str(&format!(
                "           {}\n",
                if priced == 0 {
                    "no price on any row - omniroute's request log carries tokens only".to_string()
                } else {
                    format!(
                        "{:.4} USD over {priced} priced row(s)",
                        tokens.get("costUsd").and_then(Value::as_f64).unwrap_or(0.0)
                    )
                }
            ));
            for row in tokens
                .get("byProfile")
                .and_then(Value::as_array)
                .unwrap_or(&Vec::new())
            {
                let mine = row
                    .get("usedByProject")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                out.push_str(&format!(
                    "           {:<16} {:>7} req  {:>10} in  {:>10} out{}\n",
                    row.get("profileId")
                        .and_then(Value::as_str)
                        .unwrap_or("(unattributed)"),
                    num(row, "requests"),
                    num(row, "tokensIn"),
                    num(row, "tokensOut"),
                    if mine {
                        "  <- used by this project"
                    } else {
                        ""
                    }
                ));
            }
        }
    }

    let sessions = stats.get("sessions").unwrap_or(&Value::Null);
    out.push_str(&format!(
        "\nsessions   {} total, {} ended, {} still open\n",
        num(sessions, "total"),
        num(sessions, "ended"),
        num(sessions, "open")
    ));
    if sessions.get("ended").and_then(Value::as_i64).unwrap_or(0) > 0 {
        out.push_str(&format!(
            "           {} in total, median {}\n           {} non-zero exit(s), {} with no code at all\n",
            duration(sessions.get("totalSeconds").and_then(Value::as_i64).unwrap_or(0)),
            sessions
                .get("medianSeconds")
                .and_then(Value::as_i64)
                .map_or_else(|| "—".to_string(), duration),
            num(sessions, "failed"),
            num(sessions, "unknownExit")
        ));
    }

    let completion = stats.get("completion").unwrap_or(&Value::Null);
    match completion.get("percent").and_then(Value::as_f64) {
        None => out
            .push_str("\nestimate   nothing to estimate from - no workers and no queue entries\n"),
        Some(percent) => {
            out.push_str(&format!(
                "\nestimate   {percent:.0} % (estimated, not measured)\n"
            ));
            for part in completion
                .get("components")
                .and_then(Value::as_array)
                .unwrap_or(&Vec::new())
            {
                out.push_str(&format!(
                    "           {:<8} weight {:.2}  score {:.2}  {}\n",
                    text(part, "key"),
                    part.get("weight").and_then(Value::as_f64).unwrap_or(0.0),
                    part.get("score").and_then(Value::as_f64).unwrap_or(0.0),
                    text(part, "detail")
                ));
            }
        }
    }

    let timeline = stats
        .get("timeline")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if !timeline.is_empty() {
        out.push_str("\nday          messages  events\n");
        for day in timeline
            .iter()
            .rev()
            .take(14)
            .collect::<Vec<_>>()
            .iter()
            .rev()
        {
            out.push_str(&format!(
                "{:<12} {:>8}  {:>6}\n",
                text(day, "date"),
                num(day, "messages"),
                num(day, "statusEvents")
            ));
        }
    }
    out
}
