//! Where does a run happen: on this PC, on the server, or (later) in the cloud?
//!
//! Pure resolution core of V2-B5a. No SSH, no network, no persistence: the
//! caller reads the host facts and whether a server is reachable, this module
//! only decides and says why, in German, because the reason is shown to the
//! user as is.
//!
//! The order is **Start > Persona > Projekt > automatisch**: the first
//! explicit value wins. "Automatisch" looks at free RAM and never picks the
//! cloud; [`Ort::Cloud`] exists as a value an explicit choice may carry.

// V2-B5a: no runtime caller until the seam bundle wires it.
#![allow(dead_code)]

use super::{HostFacts, MIN_FREE_RAM_BYTES};

/// A place a run can happen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ort {
    Pc,
    Server { name: String },
    Cloud { anbieter: String },
}

/// What one level (start, persona, project) asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Vorgabe {
    Explizit(Ort),
    Automatisch,
}

/// The verdict and the sentence that explains it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entscheidung {
    pub ort: Ort,
    pub grund: String,
}

/// Resolve the location. `server_available` is the name of a reachable
/// server, `None` when there is none.
pub fn resolve(
    start: &Vorgabe,
    persona: &Vorgabe,
    projekt: &Vorgabe,
    host_facts: &HostFacts,
    server_available: Option<&str>,
) -> Entscheidung {
    let levels = [("Start", start), ("Persona", persona), ("Projekt", projekt)];
    for (stufe, vorgabe) in levels {
        if let Vorgabe::Explizit(ort) = vorgabe {
            return Entscheidung {
                ort: ort.clone(),
                grund: format!("{stufe} legt den Ort fest"),
            };
        }
    }
    automatisch(host_facts, server_available)
}

fn automatisch(host_facts: &HostFacts, server_available: Option<&str>) -> Entscheidung {
    let pc = |grund: &str| Entscheidung {
        ort: Ort::Pc,
        grund: grund.to_string(),
    };
    match host_facts.free_ram_bytes {
        None => pc("RAM unbekannt, PC als Vorgabe"),
        Some(frei) if frei < MIN_FREE_RAM_BYTES => match server_available {
            Some(name) => Entscheidung {
                ort: Ort::Server {
                    name: name.to_string(),
                },
                grund: "weniger als 1,5 GiB frei".to_string(),
            },
            None => pc("weniger als 1,5 GiB frei, aber kein Server verfügbar"),
        },
        Some(_) => pc("mindestens 1,5 GiB frei, PC reicht"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GIB: u64 = 1024 * 1024 * 1024;

    fn host(frei: Option<u64>) -> HostFacts {
        HostFacts {
            free_ram_bytes: frei,
            ..HostFacts::default()
        }
    }

    fn server(name: &str) -> Ort {
        Ort::Server { name: name.into() }
    }

    fn explizit(ort: Ort) -> Vorgabe {
        Vorgabe::Explizit(ort)
    }

    #[test]
    fn start_beats_persona_and_projekt() {
        let e = resolve(
            &explizit(Ort::Pc),
            &explizit(server("a")),
            &explizit(Ort::Cloud {
                anbieter: "x".into(),
            }),
            &host(Some(GIB)),
            Some("a"),
        );
        assert_eq!(e.ort, Ort::Pc);
        assert_eq!(e.grund, "Start legt den Ort fest");
    }

    #[test]
    fn persona_beats_projekt_when_start_is_automatic() {
        let e = resolve(
            &Vorgabe::Automatisch,
            &explizit(server("a")),
            &explizit(Ort::Pc),
            &host(Some(8 * GIB)),
            None,
        );
        assert_eq!(e.ort, server("a"));
        assert_eq!(e.grund, "Persona legt den Ort fest");
    }

    #[test]
    fn projekt_beats_automatic() {
        let e = resolve(
            &Vorgabe::Automatisch,
            &Vorgabe::Automatisch,
            &explizit(server("b")),
            &host(Some(8 * GIB)),
            None,
        );
        assert_eq!(e.ort, server("b"));
        assert_eq!(e.grund, "Projekt legt den Ort fest");
    }

    fn auto(frei: Option<u64>, server_name: Option<&str>) -> Entscheidung {
        let a = Vorgabe::Automatisch;
        resolve(&a, &a, &a, &host(frei), server_name)
    }

    #[test]
    fn automatic_low_ram_with_server_picks_server() {
        let e = auto(Some(GIB * 14 / 10), Some("srv"));
        assert_eq!(e.ort, server("srv"));
        assert_eq!(e.grund, "weniger als 1,5 GiB frei");
    }

    #[test]
    fn automatic_low_ram_without_server_stays_on_pc_with_reason() {
        let e = auto(Some(GIB * 14 / 10), None);
        assert_eq!(e.ort, Ort::Pc);
        assert!(e.grund.contains("weniger als 1,5 GiB frei"), "{}", e.grund);
        assert!(e.grund.contains("kein Server"), "{}", e.grund);
    }

    #[test]
    fn automatic_unknown_ram_stays_on_pc_even_with_server() {
        let e = auto(None, Some("srv"));
        assert_eq!(e.ort, Ort::Pc);
        assert_eq!(e.grund, "RAM unbekannt, PC als Vorgabe");
    }

    #[test]
    fn automatic_exactly_threshold_is_pc() {
        let e = auto(Some(MIN_FREE_RAM_BYTES), Some("srv"));
        assert_eq!(e.ort, Ort::Pc);
        let e = auto(Some(MIN_FREE_RAM_BYTES - 1), Some("srv"));
        assert_eq!(e.ort, server("srv"));
    }

    #[test]
    fn automatic_never_resolves_to_cloud() {
        for frei in [None, Some(0), Some(GIB), Some(64 * GIB)] {
            for srv in [None, Some("srv")] {
                assert!(!matches!(auto(frei, srv).ort, Ort::Cloud { .. }));
            }
        }
    }
}
