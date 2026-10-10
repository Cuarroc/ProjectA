//! Bug state machine core: no fix without a compiling red test with exit code.
//!
//! `Gemeldet -> Reproduziert -> In Arbeit -> Fix belegt -> Erledigt`, plus
//! `Nutzer entscheidet` after three failed fix attempts. Every transition takes
//! evidence values; nothing here runs a test, reads git or persists anything.
//! A rejection carries one German sentence for the user.
//!
//! Shas are opaque and unordered here: the core only demands that a green fix
//! run is at a commit other than the red proof (and other than any failing
//! attempt). That the commit is actually newer on the branch is the caller's
//! job (follow-up: V2-B14b).
#![allow(dead_code)] // pure core; the first caller arrives with the Eingang/Bugs wiring

/// Failed or rejected fix attempts before the user has to decide.
pub const MAX_FIX_ATTEMPTS: u8 = 3;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum BugState {
    #[default]
    Gemeldet,
    Reproduziert,
    InArbeit,
    FixBelegt,
    Erledigt,
    NutzerEntscheidet,
}

impl BugState {
    pub fn label(self) -> &'static str {
        match self {
            BugState::Gemeldet => "Gemeldet",
            BugState::Reproduziert => "Reproduziert",
            BugState::InArbeit => "In Arbeit",
            BugState::FixBelegt => "Fix belegt",
            BugState::Erledigt => "Erledigt",
            BugState::NutzerEntscheidet => "Nutzer entscheidet",
        }
    }
}

/// One observed run of one test: where it lives, its name, the exit code and
/// the commit it ran at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TestRun {
    pub path: String,
    pub name: String,
    pub exit_code: i32,
    pub sha: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserDecision {
    /// Try again: back to `In Arbeit` with a fresh attempt counter.
    KeepTrying,
    /// Stop here: the bug is closed by the user's call, not by a proven fix.
    Close,
}

/// The German reason a transition was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rejection(pub String);

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Bug {
    state: BugState,
    red: Option<TestRun>,
    /// Sha of the latest complete run of the red test (`red.sha` stays the
    /// permanent anchor); a green fix run must be at neither.
    last_sha: String,
    attempts: u8,
}

impl Bug {
    pub fn state(&self) -> BugState {
        self.state
    }

    pub fn attempts(&self) -> u8 {
        self.attempts
    }

    /// `Gemeldet -> Reproduziert`: needs a red run (non-zero exit code).
    pub fn reproduce(&mut self, run: TestRun) -> Result<BugState, Rejection> {
        if self.state != BugState::Gemeldet {
            return Err(self.wrong_state());
        }
        check_complete(&run)?;
        if run.exit_code == 0 {
            return Err(reject("Der Test ist grün (Exit-Code 0)."));
        }
        self.last_sha = run.sha.clone();
        self.red = Some(run);
        self.state = BugState::Reproduziert;
        Ok(self.state)
    }

    /// `Reproduziert -> In Arbeit`.
    pub fn start_work(&mut self) -> Result<BugState, Rejection> {
        self.advance(BugState::Reproduziert, BugState::InArbeit)
    }

    /// `In Arbeit -> Fix belegt`: the SAME test, exit code 0, at a sha other
    /// than the red proof's and the latest failing run's.
    /// Incomplete runs and runs of another test are refused without any state
    /// change or attempt. Every other rejected or failing run counts an
    /// attempt; the third moves the bug to `Nutzer entscheidet`.
    pub fn submit_fix(&mut self, run: TestRun) -> Result<BugState, Rejection> {
        if self.state != BugState::InArbeit {
            return Err(self.wrong_state());
        }
        let red = self.red.as_ref().expect("In Arbeit implies a red test");
        check_complete(&run)?;
        if (&run.path, &run.name) != (&red.path, &red.name) {
            return Err(Rejection(format!(
                "Ein anderer Test als „{}“ belegt den Fix nicht.",
                red.name
            )));
        }
        let reason = if run.exit_code != 0 {
            format!("Der Test ist weiterhin rot (Exit-Code {}).", run.exit_code)
        } else if run.sha == red.sha || run.sha == self.last_sha {
            "Der grüne Lauf stammt nicht von einem anderen Stand als der rote Beweis.".into()
        } else {
            self.last_sha = run.sha;
            self.state = BugState::FixBelegt;
            return Ok(self.state);
        };
        if run.exit_code != 0 {
            self.last_sha = run.sha;
        }
        self.attempts += 1;
        let tail = if self.attempts < MAX_FIX_ATTEMPTS {
            format!("Versuch {} von {MAX_FIX_ATTEMPTS}.", self.attempts)
        } else {
            self.state = BugState::NutzerEntscheidet;
            format!("Nach {MAX_FIX_ATTEMPTS} Fehlversuchen entscheidet der Nutzer.")
        };
        Err(Rejection(format!("{reason} {tail}")))
    }

    /// `Fix belegt -> Erledigt`.
    pub fn finish(&mut self) -> Result<BugState, Rejection> {
        self.advance(BugState::FixBelegt, BugState::Erledigt)
    }

    /// `Nutzer entscheidet -> In Arbeit | Erledigt`; the only way out.
    pub fn decide(&mut self, decision: UserDecision) -> Result<BugState, Rejection> {
        if self.state != BugState::NutzerEntscheidet {
            return Err(reject(
                "Nur im Zustand „Nutzer entscheidet“ gibt es eine Entscheidung.",
            ));
        }
        self.attempts = 0;
        self.state = match decision {
            UserDecision::KeepTrying => BugState::InArbeit,
            UserDecision::Close => BugState::Erledigt,
        };
        Ok(self.state)
    }

    fn advance(&mut self, from: BugState, to: BugState) -> Result<BugState, Rejection> {
        if self.state != from {
            return Err(self.wrong_state());
        }
        self.state = to;
        Ok(to)
    }

    fn wrong_state(&self) -> Rejection {
        use BugState::*;
        Rejection(match self.state {
            NutzerEntscheidet => "Der Nutzer entscheidet; vorher geht nichts weiter.".into(),
            Erledigt => "Der Fehler ist erledigt; kein weiterer Schritt.".into(),
            Gemeldet => "Ohne roten Test (Exit-Code ungleich 0) keine Arbeit.".into(),
            s => format!("Im Zustand „{}“ ist das nicht möglich.", s.label()),
        })
    }
}

fn reject(reason: &str) -> Rejection {
    Rejection(reason.into())
}

fn check_complete(run: &TestRun) -> Result<(), Rejection> {
    let parts = [&run.path, &run.name, &run.sha];
    if parts.iter().any(|v| v.trim().is_empty()) {
        return Err(reject("Der Beleg ist unvollständig: Pfad, Testname, Sha."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(name: &str, exit_code: i32, sha: &str) -> TestRun {
        TestRun {
            path: "a.rs".into(),
            name: name.into(),
            exit_code,
            sha: sha.into(),
        }
    }

    fn working() -> Bug {
        let mut bug = Bug::default();
        bug.reproduce(run("t", 101, "aaa")).unwrap();
        bug.start_work().unwrap();
        bug
    }

    fn reason(r: Result<BugState, Rejection>) -> String {
        r.expect_err("must be rejected").0
    }

    fn user_decides() -> Bug {
        let mut bug = working();
        for sha in ["b", "c", "d"] {
            bug.submit_fix(run("t", 1, sha)).unwrap_err();
        }
        bug
    }

    #[test]
    fn happy_path_runs_through_all_states() {
        let mut bug = Bug::default();
        assert_eq!(
            bug.reproduce(run("t", 1, "aaa")),
            Ok(BugState::Reproduziert)
        );
        assert_eq!(bug.start_work(), Ok(BugState::InArbeit));
        assert_eq!(bug.submit_fix(run("t", 0, "bbb")), Ok(BugState::FixBelegt));
        assert_eq!(bug.finish(), Ok(BugState::Erledigt));
        assert!(bug.start_work().is_err() && bug.submit_fix(run("t", 0, "c")).is_err());
        assert_eq!(bug.state(), BugState::Erledigt);
    }

    #[test]
    fn fix_without_red_test_is_rejected() {
        let mut bug = Bug::default();
        assert!(reason(bug.start_work()).contains("roten Test"));
        assert!(reason(bug.submit_fix(run("t", 0, "bbb"))).contains("roten Test"));
        assert_eq!((bug.state(), bug.attempts()), (BugState::Gemeldet, 0));
    }

    #[test]
    fn red_test_with_exit_zero_does_not_reproduce() {
        let mut bug = Bug::default();
        assert!(reason(bug.reproduce(run("t", 0, "aaa"))).contains("Exit-Code 0"));
        assert!(reason(bug.reproduce(run("t", 1, " "))).contains("unvollständig"));
        assert_eq!(bug.state(), BugState::Gemeldet);
    }

    #[test]
    fn green_run_of_a_different_test_does_not_prove_the_fix() {
        let mut bug = working();
        assert!(reason(bug.submit_fix(run("other", 0, "bbb"))).contains("anderer Test"));
        assert_eq!((bug.state(), bug.attempts()), (BugState::InArbeit, 0));
        let message = reason(bug.submit_fix(run("t", 0, "aaa")));
        assert!(
            message.contains("anderen Stand als der rote Beweis"),
            "{message}"
        );
        assert!(!message.contains("neuer"), "{message}");
        assert_eq!(bug.attempts(), 1);
    }

    #[test]
    fn failing_fix_counts_an_attempt_and_keeps_working() {
        let mut bug = working();
        assert!(reason(bug.submit_fix(run("t", 101, "bbb"))).contains("Versuch 1 von 3"));
        assert_eq!((bug.state(), bug.attempts()), (BugState::InArbeit, 1));
        assert_eq!(bug.submit_fix(run("t", 0, "ccc")), Ok(BugState::FixBelegt));
    }

    #[test]
    fn three_failed_fixes_hand_over_to_the_user() {
        let mut bug = working();
        bug.submit_fix(run("t", 1, "b")).unwrap_err();
        bug.submit_fix(run("t", 0, "aaa")).unwrap_err();
        assert!(reason(bug.submit_fix(run("t", 1, "d"))).contains("entscheidet der Nutzer"));
        assert_eq!(
            (bug.state(), bug.attempts()),
            (BugState::NutzerEntscheidet, 3)
        );
    }

    #[test]
    fn only_a_user_decision_leaves_user_decides() {
        let mut bug = user_decides();
        assert!(reason(bug.start_work()).contains("Nutzer"));
        assert!(reason(bug.submit_fix(run("t", 0, "e"))).contains("Nutzer"));
        assert!(reason(bug.finish()).contains("Nutzer"));
        assert_eq!(bug.state(), BugState::NutzerEntscheidet);
        assert_eq!(bug.decide(UserDecision::KeepTrying), Ok(BugState::InArbeit));
        assert_eq!(bug.attempts(), 0);
        assert_eq!(bug.submit_fix(run("t", 0, "g")), Ok(BugState::FixBelegt));
        assert_eq!(
            user_decides().decide(UserDecision::Close),
            Ok(BugState::Erledigt)
        );
    }

    #[test]
    fn decision_and_done_need_their_state() {
        let mut bug = working();
        assert!(reason(bug.decide(UserDecision::Close)).contains("Nutzer"));
        assert!(reason(bug.finish()).contains("In Arbeit"));
        assert_eq!(bug.state(), BugState::InArbeit);
    }

    fn run_at(path: &str, name: &str, exit_code: i32, sha: &str) -> TestRun {
        TestRun {
            path: path.into(),
            name: name.into(),
            exit_code,
            sha: sha.into(),
        }
    }

    #[test]
    fn green_at_the_red_sha_is_rejected_after_a_failing_attempt() {
        let mut bug = working();
        bug.submit_fix(run("t", 101, "bbb")).unwrap_err();
        assert!(reason(bug.submit_fix(run("t", 0, "aaa"))).contains("Versuch 2 von 3"));
        assert_eq!((bug.state(), bug.attempts()), (BugState::InArbeit, 2));
        assert_eq!(bug.submit_fix(run("t", 0, "ccc")), Ok(BugState::FixBelegt));
    }

    #[test]
    fn green_at_the_sha_of_a_failing_attempt_is_rejected() {
        let mut bug = working();
        bug.submit_fix(run("t", 101, "bbb")).unwrap_err();
        bug.submit_fix(run("t", 0, "bbb")).unwrap_err();
        assert_eq!((bug.state(), bug.attempts()), (BugState::InArbeit, 2));
    }

    #[test]
    fn run_of_a_different_test_does_not_move_the_anchor() {
        let mut bug = working();
        bug.submit_fix(run("other", 1, "bbb")).unwrap_err();
        assert_eq!(bug.submit_fix(run("t", 0, "bbb")), Ok(BugState::FixBelegt));
    }

    #[test]
    fn incomplete_run_does_not_move_the_anchor() {
        let mut bug = working();
        bug.submit_fix(run_at("", "t", 1, "bbb")).unwrap_err();
        bug.submit_fix(run_at("a.rs", " ", 1, "bbb")).unwrap_err();
        assert_eq!(bug.submit_fix(run("t", 0, "bbb")), Ok(BugState::FixBelegt));
    }

    #[test]
    fn malformed_or_unrelated_runs_cost_no_attempt() {
        let mut bug = working();
        let before = bug.clone();
        for bad in [
            run_at("", "t", 0, "bbb"),
            run_at("a.rs", "t", 0, ""),
            run("other", 0, "bbb"),
        ] {
            let message = reason(bug.submit_fix(bad));
            assert!(!message.contains("Versuch"), "{message}");
            assert_eq!(bug, before);
        }
        assert_eq!(bug.attempts(), 0);
    }
}
