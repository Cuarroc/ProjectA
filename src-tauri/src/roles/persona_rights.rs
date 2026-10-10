//! Persona rights (V2-B17a, core only, not wired yet): a persona never exceeds
//! its department, and an agent never widens its own rights.
//!
//! [`check_change`] is the one gate for changing a persona's [`Rechte`].
//! Removing rights always passes. Adding rights passes only for a user, only
//! inside the department ceiling, and never for [`Recht::Mergen`] on an agent
//! persona: merging goes through the Mergify queue alone. An agent that asks
//! for more rights is refused whoever the persona is, because the check cannot
//! tell a lie about "own" from the truth and a refusal costs nothing.

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

/// Who asks for the change.
pub enum Anfrager {
    Nutzer,
    Agent { persona_id: String },
}

/// Why a change was refused.
#[derive(Debug, PartialEq, Eq)]
pub enum Ablehnung {
    UeberAbteilung { recht: Recht, abteilung: String },
    AgentErweitertSichSelbst,
    AgentVergibtRechte,
    MergenNurUeberMergify,
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
        }
    }
}

/// May `anfrager` set `persona` to `neue_rechte` inside `abteilung`?
///
/// Order matters: a pure removal passes before anything else is looked at, so
/// a persona that is already too wide can always be narrowed. For a widening
/// the actor comes first, then the Mergen rule, then the ceiling (checked
/// against the whole new set, so the result is valid, not just the delta).
pub fn check_change(
    anfrager: &Anfrager,
    persona: &Persona,
    neue_rechte: &Rechte,
    abteilung: &Abteilung,
) -> Result<(), Ablehnung> {
    if neue_rechte.is_subset(&persona.rechte) {
        return Ok(());
    }
    if let Anfrager::Agent { persona_id } = anfrager {
        return Err(if *persona_id == persona.id {
            Ablehnung::AgentErweitertSichSelbst
        } else {
            Ablehnung::AgentVergibtRechte
        });
    }
    if persona.ist_agent && neue_rechte.contains(&Recht::Mergen) {
        return Err(Ablehnung::MergenNurUeberMergify);
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
        Anfrager::Agent {
            persona_id: id.into(),
        }
    }

    #[test]
    fn persona_above_department_is_rejected_naming_the_right() {
        let err = check_change(
            &Anfrager::Nutzer,
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
            &Anfrager::Nutzer,
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
        for who in [Anfrager::Nutzer, agent("p1"), agent("p2")] {
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
            &Anfrager::Nutzer,
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
        let who = Anfrager::Nutzer;
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
        assert_eq!(
            check_change(&Anfrager::Nutzer, &p, &p.rechte, &abteilung()),
            Ok(())
        );
    }
}
