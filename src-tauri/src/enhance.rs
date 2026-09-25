//! Prompt enhancement: turn a rough task description into a sharp prompt -
//! and, when the description is too rough for that, into questions.
//!
//! Writing the prompt is the part of dispatching an agent that people get
//! wrong, so ProjectA does it for them. The rewrite is done by the *bundled
//! prompt-master skill* (`resources/prompt-master`, MIT) running inside a
//! headless Claude.
//!
//! The machinery for that - the throwaway workspace, the child process, the
//! timeout - is not specific to prompts and lives in [`crate::oneshot`]. What
//! is specific to prompts, and stays here, is the instruction: which skill to
//! ask for, how the target agent is named, and what the output must be.
//!
//! ## Two answers, one call (Phase 21 P1)
//!
//! A rewrite of "bau was mit API" is a guess with a nice font. So the enhancer
//! is allowed a second answer: up to [`MAX_QUESTIONS`] `FRAGE:` blocks instead
//! of a prompt. Those become ordinary [`crate::questions`] rows with
//! `scope = "preflight"` and no worker, the person answers them in the Fragen
//! tab, and the answers come back here as [`Ask::Answered`] for a second call
//! that has to produce the prompt.
//!
//! Who may ask is the caller's decision, not the model's - see [`Ask`]. The
//! dispatcher sharpens in the background with nobody in front of it, so it
//! asks with [`Ask::Never`]; a question from that call is a protocol
//! violation, not a dialogue.
//!
//! The parser is deliberately the one [`crate::critic`] uses for its
//! `PATTERN`/`LEARNING` blocks, down to the shared [`crate::critic::strip_bullet`]
//! and [`crate::critic::marker_value`]: two markers, lenient about everything
//! except the markers themselves, and never inventing content.
//!
//! Nothing here is best-effort: unlike the status sources, this runs because
//! the user asked for it, so a missing CLI, a failing run and a run that never
//! finishes each become an error string the frontend can show verbatim.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::critic::{marker_value, strip_bullet};
use crate::oneshot;

/// Name of the bundled skill, used both as its directory and in the prompt.
pub const SKILL_NAME: &str = "prompt-master";

/// How long a rewrite may take before it is killed.
pub const ENHANCE_TIMEOUT: Duration = Duration::from_secs(180);

/// Never come back with more than this many questions, whatever the skill
/// printed.
///
/// The same three as [`crate::questions::MAX_OPEN_PER_WORKER`], and for the
/// same reason: a person who is asked four things before the work starts stops
/// reading at the second.
pub const MAX_QUESTIONS: usize = 3;

/// What a caller is told when the enhancer asked back although nobody could
/// answer - a final round, or the dispatcher's background sharpening.
pub const ERR_STILL_ASKING: &str =
    "the prompt enhancer asked another question instead of writing the prompt";

/// What a caller is told when the run produced no output at all.
pub const ERR_EMPTY: &str = "the prompt enhancer returned nothing";

/// One question the enhancer wants answered before it writes the prompt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhanceQuestion {
    pub question: String,
    /// The offered answers exactly as the skill wrote them - `"A, B, C"` - or
    /// `None`. Raw rather than a list because [`crate::questions::ask`] is the
    /// one place that turns this into the JSON array the tab reads, and a
    /// second parser here would only be a second opinion about it.
    pub options: Option<String>,
}

/// One answered question, on its way into the final round.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub question: String,
    pub answer: String,
}

/// Return value of `enhance_prompt`; serialized as
/// `{ "enhanced": "...", "questions": [] }`.
///
/// Exactly one of the two carries the answer: a run that asked back has no
/// prompt yet, and a run that wrote the prompt has nothing left to ask.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhanceResult {
    /// The final prompt, or `None` when the enhancer asked back instead.
    pub enhanced: Option<String>,
    pub questions: Vec<EnhanceQuestion>,
}

/// Whether this call may answer with questions, and what it already knows.
#[derive(Debug, Clone, Copy)]
pub enum Ask<'a> {
    /// Somebody is in front of the surface that started this. A vague task may
    /// come back as up to [`MAX_QUESTIONS`] questions.
    Allowed,
    /// Nobody can answer - the dispatcher sharpening a queued task. The
    /// enhancer is told to decide for itself and write the prompt.
    Never,
    /// The second round: the questions from the first one, with what the
    /// person said. Asking again is not an option here.
    Answered(&'a [Answer]),
}

// -- the bundled skill -----------------------------------------------------

/// Locate the bundled skill: the installed copy first, the checkout second.
pub fn bundled_skill_dir(app: &AppHandle) -> Result<PathBuf, String> {
    oneshot::bundled_skill_dir(app, SKILL_NAME)
}

// -- the instruction -------------------------------------------------------

/// How the target agent is named in the instruction.
///
/// The embedded profiles already carry human names, so `claude` becomes
/// "Claude Code" rather than a bare id. An unknown id is still better than
/// nothing - the user may have added it through `agents.json` - and no target
/// at all falls back to generic wording.
fn target_phrase(target_profile: Option<&str>) -> String {
    match target_profile {
        None => "a CLI coding agent".to_string(),
        Some(id) => {
            let name = crate::profiles::find_profile(id).map_or_else(|| id.to_string(), |p| p.name);
            format!("the CLI coding agent '{name}'")
        }
    }
}

/// The half of the instruction that says what the output must be.
///
/// Only [`Ask::Allowed`] describes the question format at all. Telling a model
/// about an escape hatch it is then forbidden to use is how the hatch gets
/// used, so the other two rounds simply never hear about it.
fn output_rules(ask: Ask<'_>) -> String {
    match ask {
        Ask::Allowed => format!(
            "Answer in exactly one of two ways.\n\n\
             1. The task is clear enough to write a prompt for: output ONLY the final \
             prompt text, no commentary.\n\n\
             2. The task is too vague to write a good prompt for and guessing would \
             send the agent the wrong way: do NOT guess. Output ONLY up to \
             {MAX_QUESTIONS} clarifying questions, one block each, nothing before the \
             first and nothing after the last:\n\n\
             FRAGE: <one question, in the language of the task>\n\
             OPTIONEN: <2-4 short answers, comma separated>\n\n\
             The OPTIONEN line is optional; leave it out where a free answer is the \
             only sensible one. Never output both a prompt and questions. Ask only \
             what would change the prompt, and ask in the language the task is \
             written in."
        ),
        Ask::Never | Ask::Answered(_) => {
            "Output ONLY the final prompt text, no commentary, and do not ask any \
             questions - nobody is there to answer them."
                .to_string()
        }
    }
}

/// The questions and answers of the first round, as the second one reads them.
fn answered_section(answers: &[Answer]) -> String {
    let mut out = String::from("\n\n=== RUECKFRAGEN UND ANTWORTEN ===\n");
    for answer in answers {
        out.push_str("FRAGE: ");
        out.push_str(answer.question.trim());
        out.push_str("\nANTWORT: ");
        out.push_str(answer.answer.trim());
        out.push('\n');
    }
    out.push_str(
        "\nEvery answer above is the user's own decision. Build them into the prompt \
         rather than restating them, and do not contradict one.",
    );
    out
}

/// The text piped into `claude -p`.
pub fn build_instruction(draft: &str, target_profile: Option<&str>, ask: Ask<'_>) -> String {
    let answered = match ask {
        Ask::Answered(answers) if !answers.is_empty() => answered_section(answers),
        _ => String::new(),
    };
    format!(
        "Use the {SKILL_NAME} skill to rewrite the following rough task description \
         into a sharp, complete prompt for {}.\n\n{}\n\n=== AUFGABE ===\n{}{}",
        target_phrase(target_profile),
        output_rules(ask),
        draft.trim(),
        answered,
    )
}

// -- the answer ------------------------------------------------------------

/// Parse the `FRAGE:`/`OPTIONEN:` blocks out of the enhancer's output.
///
/// The mirror image of [`crate::critic::parse_candidates`], and lenient in the
/// same places: a preamble the skill was told not to write, a stray bullet, a
/// lowercase label and a question wrapped over three lines all still produce
/// the question the person is meant to answer. An empty vector means the
/// output was not a question round - which is the normal case, and leaves the
/// whole output to be read as the prompt.
///
/// Two rules of its own:
///
/// * `OPTIONEN` belongs to the `FRAGE` above it. One with no question in front
///   of it is dropped rather than guessed at, and it closes its question to
///   further wrapping - prose after the options is the model talking, not more
///   of the question.
/// * Nothing is ever invented: a `FRAGE` with no text is dropped, and so is an
///   empty `OPTIONEN`.
pub fn parse_questions(raw: &str) -> Vec<EnhanceQuestion> {
    let mut out: Vec<EnhanceQuestion> = Vec::new();
    let mut current: Option<Pending> = None;

    for line in raw.lines() {
        let line = strip_bullet(line);

        if let Some(value) = marker_value(line, "frage") {
            flush(&mut current, &mut out);
            current = Some(Pending {
                question: EnhanceQuestion {
                    question: value.to_string(),
                    options: None,
                },
                closed: false,
            });
            continue;
        }
        if let Some(value) = marker_value(line, "optionen") {
            // A stray one - options before any question - is noise between
            // blocks and is dropped with the rest of it.
            if let Some(pending) = current.as_mut() {
                pending.question.options = (!value.is_empty()).then(|| value.to_string());
                pending.closed = true;
            }
            continue;
        }
        if line.trim().is_empty() {
            // A blank line ends a block, so a wrapped question cannot swallow
            // whatever the model printed after it.
            flush(&mut current, &mut out);
            continue;
        }
        if let Some(pending) = current.as_mut() {
            if !pending.closed {
                if !pending.question.question.is_empty() {
                    pending.question.question.push(' ');
                }
                pending.question.question.push_str(line.trim());
            }
        }
        // Anything else is noise between blocks, and is dropped.
    }
    flush(&mut current, &mut out);

    out.truncate(MAX_QUESTIONS);
    out
}

/// The question being read, and whether its `OPTIONEN:` line has already ended
/// it. Empty options close the block just as filled ones do - what ends the
/// question text is the line, not what was on it.
struct Pending {
    question: EnhanceQuestion,
    closed: bool,
}

/// Move the question being read into the result, if it has any text.
fn flush(current: &mut Option<Pending>, out: &mut Vec<EnhanceQuestion>) {
    let Some(pending) = current.take() else {
        return;
    };
    let mut question = pending.question;
    question.question = question.question.trim().to_string();
    if question.question.is_empty() {
        return;
    }
    out.push(question);
}

/// Read one run's output as either a prompt or a round of questions.
///
/// A single `FRAGE:` block decides it: the enhancer either asks or writes, and
/// a document that does both is a document whose prompt was written without
/// the answers. Questions win, because dispatching a guessed prompt is the
/// expensive mistake and asking again is the cheap one.
pub fn parse_output(raw: &str) -> Result<EnhanceResult, String> {
    let questions = parse_questions(raw);
    if !questions.is_empty() {
        return Ok(EnhanceResult {
            enhanced: None,
            questions,
        });
    }
    let prompt = raw.trim();
    if prompt.is_empty() {
        return Err(ERR_EMPTY.to_string());
    }
    Ok(EnhanceResult {
        enhanced: Some(prompt.to_string()),
        questions: Vec::new(),
    })
}

// -- the whole job ---------------------------------------------------------

/// Build a workspace around `skill_src`, run the skill over `draft`, clean up.
///
/// Blocking, and for up to [`ENHANCE_TIMEOUT`]: the Tauri command hands this to
/// a blocking thread rather than running it on the main one.
///
/// A question that comes back where [`Ask`] did not allow one is an error, not
/// a result: the caller has nobody to put it in front of, and the alternative -
/// handing the question on as the prompt - would dispatch an agent to answer it
/// by writing code.
pub fn enhance(
    skill_src: &Path,
    draft: &str,
    target_profile: Option<&str>,
    ask: Ask<'_>,
) -> Result<EnhanceResult, String> {
    if draft.trim().is_empty() {
        return Err("there is nothing to enhance yet".to_string());
    }

    let instruction = build_instruction(draft, target_profile, ask);
    let raw = oneshot::run(skill_src, SKILL_NAME, &instruction, ENHANCE_TIMEOUT)?;
    let result = parse_output(&raw)?;
    if result.enhanced.is_none() && !matches!(ask, Ask::Allowed) {
        return Err(ERR_STILL_ASKING.to_string());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    /// Write a stand-in skill so the tests never depend on the real one.
    fn fake_skill(root: &Path) -> PathBuf {
        let src = root.join("bundled");
        std::fs::create_dir_all(src.join("references")).expect("mkdir");
        std::fs::write(src.join("SKILL.md"), "---\nname: prompt-master\n---\n").expect("write");
        std::fs::write(src.join("references").join("patterns.md"), "patterns").expect("write");
        src
    }

    fn one(question: &str, options: Option<&str>) -> EnhanceQuestion {
        EnhanceQuestion {
            question: question.to_string(),
            options: options.map(str::to_string),
        }
    }

    #[test]
    fn the_instruction_names_the_target_agent_and_carries_the_draft() {
        let named = build_instruction("  add retries to the fetch  ", Some("claude"), Ask::Allowed);
        assert!(named.contains("the prompt-master skill"), "{named}");
        // The profile's human name, not the raw id.
        assert!(
            named.contains("the CLI coding agent 'Claude Code'"),
            "{named}"
        );
        assert!(
            named.ends_with("=== AUFGABE ===\nadd retries to the fetch"),
            "{named}"
        );

        // An unknown id is still a target; no id at all is generic.
        assert!(build_instruction("x", Some("nonesuch"), Ask::Allowed).contains("'nonesuch'"));
        let generic = build_instruction("x", None, Ask::Allowed);
        assert!(generic.contains("for a CLI coding agent."), "{generic}");
    }

    #[test]
    fn only_a_round_that_may_ask_is_told_how_to() {
        let asking = build_instruction("x", None, Ask::Allowed);
        assert!(asking.contains("FRAGE: "), "{asking}");
        assert!(asking.contains("OPTIONEN: "), "{asking}");
        assert!(asking.contains("up to 3 clarifying questions"), "{asking}");

        // The dispatcher has nobody in front of it, so the escape hatch is not
        // described to it at all - not even to forbid it.
        for silent in [
            build_instruction("x", None, Ask::Never),
            build_instruction("x", None, Ask::Answered(&[])),
        ] {
            assert!(!silent.contains("FRAGE:"), "{silent}");
            assert!(
                silent.contains("Output ONLY the final prompt text"),
                "{silent}"
            );
        }
    }

    #[test]
    fn the_second_round_carries_every_answer() {
        let answers = [
            Answer {
                question: "Welche API?".to_string(),
                answer: "Stripe".to_string(),
            },
            Answer {
                question: " Sprache? ".to_string(),
                answer: " TypeScript ".to_string(),
            },
        ];
        let second = build_instruction("bau was mit API", None, Ask::Answered(&answers));
        assert!(
            second.contains("FRAGE: Welche API?\nANTWORT: Stripe"),
            "{second}"
        );
        assert!(
            second.contains("FRAGE: Sprache?\nANTWORT: TypeScript"),
            "{second}"
        );
        // The draft is still in it: the answers add to the task, they do not
        // replace it.
        assert!(second.contains("bau was mit API"), "{second}");
        assert!(second.contains("do not ask any questions"), "{second}");
    }

    #[test]
    fn the_clean_format_parses_into_questions() {
        let raw = "FRAGE: Welche API soll angebunden werden?\n\
                   OPTIONEN: Stripe, GitHub, eigene\n\
                   \n\
                   FRAGE: Reicht ein Prototyp?\n";
        assert_eq!(
            parse_questions(raw),
            vec![
                one(
                    "Welche API soll angebunden werden?",
                    Some("Stripe, GitHub, eigene")
                ),
                one("Reicht ein Prototyp?", None),
            ]
        );
    }

    #[test]
    fn a_prompt_is_not_a_question_round() {
        assert!(parse_questions("").is_empty());
        assert!(parse_questions("   \n\n  \n").is_empty());
        assert!(parse_questions(
            "You are a senior Rust engineer.\nAdd retries to the fetch helper.\n"
        )
        .is_empty());
    }

    #[test]
    fn no_round_may_ask_more_than_three_questions() {
        let raw = (1..=6)
            .map(|n| format!("FRAGE: f{n}\nOPTIONEN: a{n}, b{n}\n"))
            .collect::<Vec<_>>()
            .join("\n");
        let parsed = parse_questions(&raw);
        assert_eq!(parsed.len(), MAX_QUESTIONS);
        // The first three, not an arbitrary three.
        assert_eq!(parsed[0], one("f1", Some("a1, b1")));
        assert_eq!(parsed[2], one("f3", Some("a3, b3")));
    }

    #[test]
    fn bullets_and_case_do_not_hide_a_question() {
        let raw = "- frage: Welche API?\n\
                   - optionen : Stripe, GitHub\n\
                   \n\
                   1. FRAGE: Welche Sprache?\n\
                   2) Optionen: Rust, TypeScript\n";
        assert_eq!(
            parse_questions(raw),
            vec![
                one("Welche API?", Some("Stripe, GitHub")),
                one("Welche Sprache?", Some("Rust, TypeScript")),
            ]
        );
    }

    #[test]
    fn a_wrapped_question_is_joined_and_the_options_close_it() {
        let raw = "FRAGE: Soll der Endpunkt authentifiziert sein,\n\
                   und wenn ja, mit welchem Verfahren?\n\
                   OPTIONEN: JWT, API-Key, gar nicht\n\
                   Das ist alles, was ich brauche.\n";
        assert_eq!(
            parse_questions(raw),
            vec![one(
                "Soll der Endpunkt authentifiziert sein, und wenn ja, mit welchem Verfahren?",
                Some("JWT, API-Key, gar nicht")
            )]
        );
    }

    #[test]
    fn an_empty_question_is_dropped_and_takes_its_options_with_it() {
        let raw = "FRAGE:   \nOPTIONEN: a, b\n\nFRAGE: Echte Frage?\n";
        assert_eq!(parse_questions(raw), vec![one("Echte Frage?", None)]);
    }

    #[test]
    fn options_without_a_question_are_dropped_and_empty_options_are_none() {
        assert!(parse_questions("OPTIONEN: a, b\n").is_empty());
        assert_eq!(
            parse_questions("FRAGE: Was denn?\nOPTIONEN:   \n"),
            vec![one("Was denn?", None)]
        );
    }

    #[test]
    fn noise_around_the_blocks_is_skipped_not_fatal() {
        let raw = "Klar! Dazu brauche ich noch zwei Angaben:\n\
                   \n\
                   FRAGE: Welche API?\n\
                   \n\
                   Sag Bescheid, wenn du mehr brauchst.\n";
        assert_eq!(parse_questions(raw), vec![one("Welche API?", None)]);
    }

    #[test]
    fn one_shot_and_dialogue_are_told_apart_by_the_output() {
        let prompt = parse_output("  You are a senior Rust engineer. Do the thing.  ")
            .expect("a prompt is a valid answer");
        assert_eq!(
            prompt.enhanced.as_deref(),
            Some("You are a senior Rust engineer. Do the thing.")
        );
        assert!(prompt.questions.is_empty());

        let asked = parse_output("FRAGE: Welche API?\n").expect("questions are a valid answer");
        assert_eq!(asked.enhanced, None);
        assert_eq!(asked.questions, vec![one("Welche API?", None)]);

        // A document that does both was written without the answers, so the
        // questions are what survives it.
        let mixed = parse_output("Hier ist dein Prompt:\n\nFRAGE: Welche API?\n").expect("mixed");
        assert_eq!(mixed.enhanced, None);
        assert_eq!(mixed.questions.len(), 1);
    }

    #[test]
    fn an_empty_run_is_an_error_not_an_empty_prompt() {
        let err = parse_output("  \n \n").expect_err("nothing is not a prompt");
        assert_eq!(err, ERR_EMPTY);
    }

    #[test]
    fn an_empty_draft_never_reaches_the_cli() {
        let dir = TempDir::new("enhance-empty");
        let src = fake_skill(dir.path());
        let err =
            enhance(&src, "   \n ", Some("claude"), Ask::Allowed).expect_err("empty draft fails");
        assert!(err.contains("nothing to enhance"), "{err}");
    }
}
