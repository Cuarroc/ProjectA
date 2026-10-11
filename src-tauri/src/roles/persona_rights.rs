//! Persona rights (V2-B17a, core only, not wired yet): a persona never exceeds
//! its department, and an agent never widens its own rights.
//!
//! [`check_change`] is the one gate for changing a persona's [`Rechte`].
//! Adding rights passes only for a user and only inside the department
//! ceiling. For an agent persona the user path has one more rule: the result
//! must not hold [`Recht::Mergen`], because merging goes through the Mergify
//! queue alone. So a user change that leaves Mergen on an agent persona is
//! refused until it drops Mergen, whether it widens the set or narrows it
//! (`{Lesen, Mergen}` to `{Mergen}` is refused too); only an unchanged set
//! passes. An agent never widens: it asks for more rights and is refused
//! whoever the persona is, because the check cannot tell a lie about "own"
//! from the truth and a refusal costs nothing. An agent may always narrow,
//! even keeping Mergen; a narrowing never grants it, so the Mergen rule is
//! not applied to agent-driven changes.
//!
//! **Trusted user path.** [`Anfrager`] has no public variants: a user request is
//! built only by [`Anfrager::nutzer_aus_oberflaeche`], which needs an
//! [`OberflaechenBeleg`]. That proof can only be minted inside this module
//! (`aus_klick` is private), so the future click-handler wiring must live in or
//! behind this module. The proof carries no click binding yet: data an agent
//! supplied (a tool call, a CLI argument, a request body) must never reach the
//! code that mints it; at wiring time that call site is the one to review.

use std::collections::BTreeSet;
use std::fmt;

/// One right a persona can hold. The set can grow; new variants go last.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Recht {
    Lesen,
    Schreiben,
    Pushen,
    PrOeffnen,
    Mergen,
    Netz,
    Server,
    Geheimnisse,
}

impl Recht {
    fn name(self) -> &'static str {
        match self {
            Recht::Lesen => "Lesen",
            Recht::Schreiben => "Schreiben",
            Recht::Pushen => "Pushen",
            Recht::PrOeffnen => "PR öffnen",
            Recht::Mergen => "Mergen",
            Recht::Netz => "Netz",
            Recht::Server => "Server",
            Recht::Geheimnisse => "Geheimnisse",
        }
    }
}

/// A set of rights; the empty set is a persona that may do nothing.
pub type Rechte = BTreeSet<Recht>;

/// A department and the most its personas may ever hold.
pub struct Abteilung {
    pub name: String,
    pub obergrenze: Rechte,
}

/// The persona whose rights change, with what it holds now.
pub struct Persona {
    pub id: String,
    pub ist_agent: bool,
    pub rechte: Rechte,
}

/// Zero-sized proof that a request came from a UI click. It carries no click
/// binding yet; the private field and private mint stop construction outside
/// this module.
#[derive(Debug)]
pub struct OberflaechenBeleg(());

impl OberflaechenBeleg {
    /// The one place a proof is minted, private to this module. Call it only
    /// from the handler of a real UI click, never from agent-supplied data.
    fn aus_klick() -> Self {
        Self(())
    }
}

/// Who asks for the change; built only through the constructors below.
pub struct Anfrager(Quelle);

enum Quelle {
    Nutzer,
    Agent { persona_id: String },
}

impl Anfrager {
    /// The user, proven by a UI click.
    pub fn nutzer_aus_oberflaeche(_beleg: OberflaechenBeleg) -> Self {
        Self(Quelle::Nutzer)
    }

    /// An agent acting for the persona `persona_id`; it can never widen.
    pub fn agent(persona_id: impl Into<String>) -> Self {
        Self(Quelle::Agent {
            persona_id: persona_id.into(),
        })
    }
}

/// Why a change was refused.
#[derive(Debug, PartialEq, Eq)]
pub enum Ablehnung {
    UeberAbteilung { recht: Recht, abteilung: String },
    AgentErweitertSichSelbst,
    AgentVergibtRechte,
    MergenNurUeberMergify,
    AgentPersonaHaeltMergen,
}

impl fmt::Display for Ablehnung {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Ablehnung::UeberAbteilung { recht, abteilung } => {
                write!(
                    f,
                    "Recht {} liegt über der Abteilung {abteilung}",
                    recht.name()
                )
            }
            Ablehnung::AgentErweitertSichSelbst => {
                f.write_str("Ein Agent erweitert seine eigenen Rechte nie.")
            }
            Ablehnung::AgentVergibtRechte => f.write_str("Ein Agent vergibt keine Rechte."),
            Ablehnung::MergenNurUeberMergify => f.write_str(
                "Mergen wird einer Agent-Persona nie gewährt; gemergt wird nur über Mergify.",
            ),
            Ablehnung::AgentPersonaHaeltMergen => {
                f.write_str("Agent-Persona hält noch Mergen – zuerst entfernen")
            }
        }
    }
}

/// May `anfrager` set `persona` to `neue_rechte` inside `abteilung`?
///
/// An unchanged set passes. An agent may only narrow (any pure removal
/// passes), everything else it asks is refused. For the user the Mergen rule
/// comes first: an agent persona never ends up holding Mergen, so a newly
/// granted one and a retained one are refused, each with its own reason. Then
/// a pure removal passes, so a persona that is already too wide can always be
/// narrowed; a widening is checked against the ceiling as a whole new set, so
/// the result is valid, not just the delta.
pub fn check_change(
    anfrager: &Anfrager,
    persona: &Persona,
    neue_rechte: &Rechte,
    abteilung: &Abteilung,
) -> Result<(), Ablehnung> {
    if *neue_rechte == persona.rechte {
        return Ok(());
    }
    let nur_entfernt = neue_rechte.is_subset(&persona.rechte);
    if let Quelle::Agent { persona_id } = &anfrager.0 {
        return if nur_entfernt {
            Ok(())
        } else if *persona_id == persona.id {
            Err(Ablehnung::AgentErweitertSichSelbst)
        } else {
            Err(Ablehnung::AgentVergibtRechte)
        };
    }
    if persona.ist_agent && neue_rechte.contains(&Recht::Mergen) {
        return Err(if persona.rechte.contains(&Recht::Mergen) {
            Ablehnung::AgentPersonaHaeltMergen
        } else {
            Ablehnung::MergenNurUeberMergify
        });
    }
    if nur_entfernt {
        return Ok(());
    }
    match neue_rechte.difference(&abteilung.obergrenze).next() {
        Some(&recht) => Err(Ablehnung::UeberAbteilung {
            recht,
            abteilung: abteilung.name.clone(),
        }),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rechte(r: &[Recht]) -> Rechte {
        r.iter().copied().collect()
    }

    fn abteilung() -> Abteilung {
        Abteilung {
            name: "Entwicklung".into(),
            obergrenze: rechte(&[Recht::Lesen, Recht::Schreiben, Recht::Pushen, Recht::Mergen]),
        }
    }

    fn persona(ist_agent: bool, r: &[Recht]) -> Persona {
        Persona {
            id: "p1".into(),
            ist_agent,
            rechte: rechte(r),
        }
    }

    fn agent(id: &str) -> Anfrager {
        Anfrager::agent(id)
    }

    fn nutzer() -> Anfrager {
        Anfrager::nutzer_aus_oberflaeche(OberflaechenBeleg::aus_klick())
    }

    #[test]
    fn persona_above_department_is_rejected_naming_the_right() {
        let err = check_change(
            &nutzer(),
            &persona(false, &[Recht::Lesen]),
            &rechte(&[Recht::Lesen, Recht::Server]),
            &abteilung(),
        )
        .unwrap_err();
        assert_eq!(
            err,
            Ablehnung::UeberAbteilung {
                recht: Recht::Server,
                abteilung: "Entwicklung".into()
            }
        );
        assert_eq!(
            err.to_string(),
            "Recht Server liegt über der Abteilung Entwicklung"
        );
    }

    #[test]
    fn agent_widening_its_own_persona_is_rejected_even_inside_the_ceiling() {
        let err = check_change(
            &agent("p1"),
            &persona(true, &[Recht::Lesen]),
            &rechte(&[Recht::Lesen, Recht::Schreiben]),
            &abteilung(),
        )
        .unwrap_err();
        assert_eq!(err, Ablehnung::AgentErweitertSichSelbst);
        assert_eq!(
            err.to_string(),
            "Ein Agent erweitert seine eigenen Rechte nie."
        );
    }

    #[test]
    fn agent_widening_another_persona_is_rejected_too() {
        let err = check_change(
            &agent("p2"),
            &persona(true, &[Recht::Lesen]),
            &rechte(&[Recht::Lesen, Recht::Schreiben]),
            &abteilung(),
        )
        .unwrap_err();
        assert_eq!(err, Ablehnung::AgentVergibtRechte);
    }

    #[test]
    fn user_widening_within_the_ceiling_is_ok() {
        let ok = check_change(
            &nutzer(),
            &persona(true, &[Recht::Lesen]),
            &rechte(&[Recht::Lesen, Recht::Schreiben, Recht::Pushen]),
            &abteilung(),
        );
        assert_eq!(ok, Ok(()));
    }

    #[test]
    fn removal_is_always_ok() {
        let wide = persona(true, &[Recht::Lesen, Recht::Server, Recht::Mergen]);
        let narrower = rechte(&[Recht::Lesen, Recht::Server]);
        for who in [nutzer(), agent("p1"), agent("p2")] {
            assert_eq!(check_change(&who, &wide, &narrower, &abteilung()), Ok(()));
            assert_eq!(
                check_change(&who, &wide, &Rechte::new(), &abteilung()),
                Ok(())
            );
        }
    }

    #[test]
    fn merge_on_an_agent_persona_is_rejected_with_its_own_reason() {
        let err = check_change(
            &nutzer(),
            &persona(true, &[Recht::Lesen]),
            &rechte(&[Recht::Lesen, Recht::Mergen]),
            &abteilung(),
        )
        .unwrap_err();
        assert_eq!(err, Ablehnung::MergenNurUeberMergify);
        assert!(err.to_string().contains("Mergify"));
    }

    #[test]
    fn merge_on_a_non_agent_persona_follows_the_ceiling() {
        let who = nutzer();
        let p = persona(false, &[Recht::Lesen]);
        let new = rechte(&[Recht::Lesen, Recht::Mergen]);
        assert_eq!(check_change(&who, &p, &new, &abteilung()), Ok(()));
        let eng = Abteilung {
            name: "Support".into(),
            obergrenze: rechte(&[Recht::Lesen]),
        };
        assert!(matches!(
            check_change(&who, &p, &new, &eng),
            Err(Ablehnung::UeberAbteilung {
                recht: Recht::Mergen,
                ..
            })
        ));
    }

    #[test]
    fn unchanged_rights_pass_even_when_the_persona_is_already_too_wide() {
        let p = persona(false, &[Recht::Lesen, Recht::Server]);
        assert_eq!(check_change(&nutzer(), &p, &p.rechte, &abteilung()), Ok(()));
    }

    #[test]
    fn swap_by_an_agent_is_rejected_as_a_widening() {
        let p = persona(true, &[Recht::Lesen, Recht::Schreiben]);
        let swapped = rechte(&[Recht::Lesen, Recht::Pushen]);
        assert_eq!(
            check_change(&agent("p1"), &p, &swapped, &abteilung()),
            Err(Ablehnung::AgentErweitertSichSelbst)
        );
        assert_eq!(
            check_change(&agent("p2"), &p, &swapped, &abteilung()),
            Err(Ablehnung::AgentVergibtRechte)
        );
    }

    #[test]
    fn swap_by_the_user_to_an_over_ceiling_right_is_rejected() {
        let err = check_change(
            &nutzer(),
            &persona(false, &[Recht::Lesen, Recht::Schreiben]),
            &rechte(&[Recht::Lesen, Recht::Server]),
            &abteilung(),
        )
        .unwrap_err();
        assert_eq!(
            err,
            Ablehnung::UeberAbteilung {
                recht: Recht::Server,
                abteilung: "Entwicklung".into()
            }
        );
    }

    #[test]
    fn narrowing_an_agent_persona_that_keeps_merge_names_the_retained_merge() {
        let p = persona(true, &[Recht::Lesen, Recht::Schreiben, Recht::Mergen]);
        let err = check_change(
            &nutzer(),
            &p,
            &rechte(&[Recht::Lesen, Recht::Mergen]),
            &abteilung(),
        )
        .unwrap_err();
        assert_eq!(err, Ablehnung::AgentPersonaHaeltMergen);
        assert_eq!(
            err.to_string(),
            "Agent-Persona hält noch Mergen – zuerst entfernen"
        );
        // Adding another right while Mergen stays is the same cause, not "newly granted".
        let wider = rechte(&[Recht::Lesen, Recht::Schreiben, Recht::Pushen, Recht::Mergen]);
        assert_eq!(
            check_change(&nutzer(), &p, &wider, &abteilung()),
            Err(Ablehnung::AgentPersonaHaeltMergen)
        );
        // Dropping Mergen (with or without other changes) passes.
        let dropped = rechte(&[Recht::Lesen]);
        assert_eq!(check_change(&nutzer(), &p, &dropped, &abteilung()), Ok(()));
    }

    #[test]
    fn user_widening_that_keeps_mergen_on_an_agent_persona_is_refused() {
        // Mergen is inside the ceiling and the new right too: only the Mergen rule refuses.
        let p = persona(true, &[Recht::Lesen, Recht::Mergen]);
        let wider = rechte(&[Recht::Lesen, Recht::Schreiben, Recht::Mergen]);
        assert_eq!(
            check_change(&nutzer(), &p, &wider, &abteilung()),
            Err(Ablehnung::AgentPersonaHaeltMergen)
        );
    }

    #[test]
    fn user_narrowing_that_keeps_mergen_on_an_agent_persona_is_refused() {
        // A pure removal is refused as long as Mergen stays; the user must drop it.
        let p = persona(true, &[Recht::Lesen, Recht::Mergen]);
        let only_merge = rechte(&[Recht::Mergen]);
        assert_eq!(
            check_change(&nutzer(), &p, &only_merge, &abteilung()),
            Err(Ablehnung::AgentPersonaHaeltMergen)
        );
        // Same narrowing on a non-agent persona is an ordinary removal.
        let human = persona(false, &[Recht::Lesen, Recht::Mergen]);
        assert_eq!(
            check_change(&nutzer(), &human, &only_merge, &abteilung()),
            Ok(())
        );
    }

    #[test]
    fn an_agent_may_always_narrow_its_persona_even_keeping_merge() {
        let p = persona(true, &[Recht::Lesen, Recht::Schreiben, Recht::Mergen]);
        let narrower = rechte(&[Recht::Lesen, Recht::Mergen]);
        assert_eq!(
            check_change(&agent("p1"), &p, &narrower, &abteilung()),
            Ok(())
        );
    }

    #[test]
    fn an_unchanged_set_keeping_merge_on_an_agent_persona_passes() {
        let p = persona(true, &[Recht::Lesen, Recht::Mergen]);
        for who in [nutzer(), agent("p1"), agent("p2")] {
            assert_eq!(check_change(&who, &p, &p.rechte, &abteilung()), Ok(()));
        }
    }

    #[test]
    fn user_unchanged_rights_on_an_agent_persona_holding_mergen_pass() {
        let p = persona(true, &[Recht::Lesen, Recht::Mergen]);
        assert_eq!(
            check_change(&nutzer(), &p, &p.rechte.clone(), &abteilung()),
            Ok(())
        );
    }

    #[test]
    fn user_dropping_merge_while_widening_within_the_ceiling_is_ok() {
        let p = persona(true, &[Recht::Lesen, Recht::Mergen]);
        let new = rechte(&[Recht::Lesen, Recht::Schreiben, Recht::Pushen]);
        assert_eq!(check_change(&nutzer(), &p, &new, &abteilung()), Ok(()));
    }

    #[test]
    fn every_right_has_a_name_and_a_ceiling_check() {
        // The exhaustive match breaks the build when a variant is added: extend ALLE then.
        fn name(r: Recht) -> &'static str {
            match r {
                Recht::Lesen => "Lesen",
                Recht::Schreiben => "Schreiben",
                Recht::Pushen => "Pushen",
                Recht::PrOeffnen => "PR öffnen",
                Recht::Mergen => "Mergen",
                Recht::Netz => "Netz",
                Recht::Server => "Server",
                Recht::Geheimnisse => "Geheimnisse",
            }
        }
        const ALLE: [Recht; 8] = [
            Recht::Lesen,
            Recht::Schreiben,
            Recht::Pushen,
            Recht::PrOeffnen,
            Recht::Mergen,
            Recht::Netz,
            Recht::Server,
            Recht::Geheimnisse,
        ];
        assert_eq!(ALLE.iter().copied().collect::<Rechte>().len(), ALLE.len());
        let leer = Abteilung {
            name: "Leer".into(),
            obergrenze: Rechte::new(),
        };
        for r in ALLE {
            assert_eq!(r.name(), name(r));
            let neu = rechte(&[r]);
            let voll = Abteilung {
                name: "Voll".into(),
                obergrenze: neu.clone(),
            };
            let err = check_change(&nutzer(), &persona(false, &[]), &neu, &leer);
            assert_eq!(
                err,
                Err(Ablehnung::UeberAbteilung {
                    recht: r,
                    abteilung: "Leer".into()
                })
            );
            assert!(err.unwrap_err().to_string().contains(name(r)));
            let human = check_change(&nutzer(), &persona(false, &[]), &neu, &voll);
            assert_eq!(human, Ok(()));
            let agent_p = check_change(&nutzer(), &persona(true, &[]), &neu, &voll);
            let want = if r == Recht::Mergen {
                Err(Ablehnung::MergenNurUeberMergify)
            } else {
                Ok(())
            };
            assert_eq!(agent_p, want);
        }
    }
}
