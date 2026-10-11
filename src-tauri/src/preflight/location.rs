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
//! An explicit server with an empty name is refused like the automatic path:
//! the run stays on the PC and the reason says no server is available.

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

/// Why no server is used: none was named or the name is empty.
const KEIN_SERVER: &str = "kein Server verfügbar";

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
            let mut grund = format!("{stufe} legt den Ort fest");
            if let Ort::Server { name } = ort {
                if name.trim().is_empty() {
                    // Like the automatic path: an empty name is no server.
                    return Entscheidung {
                        ort: Ort::Pc,
                        grund: format!("{stufe} legt einen Server fest, aber {KEIN_SERVER}"),
                    };
                }
                // This core probes nothing; the connect step does.
                grund.push_str("; ob der Server erreichbar ist, wird beim Verbinden geprüft");
            }
            return Entscheidung {
                ort: ort.clone(),
                grund,
            };
        }
    }
    automatisch(host_facts, server_available)
}

fn automatisch(host_facts: &HostFacts, server_available: Option<&str>) -> Entscheidung {
    automatisch_with_min(MIN_FREE_RAM_BYTES, host_facts, server_available)
}

/// `automatisch` with an explicit RAM threshold, so a test can pick one.
fn automatisch_with_min(
    min_free_ram_bytes: u64,
    host_facts: &HostFacts,
    server_available: Option<&str>,
) -> Entscheidung {
    let pc = |grund: String| Entscheidung {
        ort: Ort::Pc,
        grund,
    };
    let schwelle = gib_text(min_free_ram_bytes);
    match host_facts.free_ram_bytes {
        None => pc("RAM unbekannt, PC als Vorgabe".to_string()),
        Some(frei) if frei < min_free_ram_bytes => {
            // An empty name is no server: there is nothing to connect to.
            match server_available.filter(|name| !name.trim().is_empty()) {
                Some(name) => Entscheidung {
                    ort: Ort::Server {
                        name: name.to_string(),
                    },
                    grund: format!("weniger als {schwelle} GiB frei"),
                },
                None => pc(format!(
                    "weniger als {schwelle} GiB frei, aber {KEIN_SERVER}"
                )),
            }
        }
        Some(_) => pc(format!("mindestens {schwelle} GiB frei, PC reicht")),
    }
}

/// GiB as German text with at most two decimals and no trailing zeros
/// (1,5 / 2 / 0,25), rounded to the nearest hundredth.
fn gib_text(bytes: u64) -> String {
    const GIB: u128 = 1024 * 1024 * 1024;
    let hundredths = (u128::from(bytes) * 100 + GIB / 2) / GIB;
    let (whole, frac) = (hundredths / 100, hundredths % 100);
    match frac {
        0 => whole.to_string(),
        f if f % 10 == 0 => format!("{whole},{}", f / 10),
        f => format!("{whole},{f:02}"),
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

    /// What an explicit server's reason adds: nothing was probed here.
    const CHECK_LATER: &str = "; ob der Server erreichbar ist, wird beim Verbinden geprüft";

    fn server(name: &str) -> Ort {
        Ort::Server { name: name.into() }
    }

    fn explizit(ort: Ort) -> Vorgabe {
        Vorgabe::Explizit(ort)
    }

    fn cloud(anbieter: &str) -> Ort {
        Ort::Cloud {
            anbieter: anbieter.into(),
        }
    }

    #[test]
    fn cloud_wins_as_start_value() {
        let e = resolve(
            &explizit(cloud("x")),
            &explizit(Ort::Pc),
            &explizit(server("a")),
            &host(Some(64 * GIB)),
            Some("a"),
        );
        assert_eq!(e.ort, cloud("x"));
        assert_eq!(e.grund, "Start legt den Ort fest");
    }

    #[test]
    fn only_an_explicit_server_mentions_the_reachability_check() {
        let a = Vorgabe::Automatisch;
        for ort in [Ort::Pc, cloud("x")] {
            let e = resolve(&a, &explizit(ort), &a, &host(None), None);
            assert!(!e.grund.contains("erreichbar"), "{}", e.grund);
        }
        let e = resolve(&a, &explizit(server("s")), &a, &host(None), None);
        assert!(e.grund.contains("beim Verbinden geprüft"), "{}", e.grund);
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
        assert_eq!(e.grund, format!("Persona legt den Ort fest{CHECK_LATER}"));
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
        assert_eq!(e.grund, format!("Projekt legt den Ort fest{CHECK_LATER}"));
    }

    #[test]
    fn explicit_server_with_blank_name_is_refused_like_the_automatic_path() {
        let a = Vorgabe::Automatisch;
        for name in ["", " ", " \t\n"] {
            // On every level, with a reachable server on offer: still no server.
            let blank = explizit(server(name));
            let levels = [
                ("Start", [&blank, &a, &a]),
                ("Persona", [&a, &blank, &a]),
                ("Projekt", [&a, &a, &blank]),
            ];
            for (stufe, [s, p, j]) in levels {
                let e = resolve(s, p, j, &host(Some(64 * GIB)), Some("srv"));
                assert_eq!(e.ort, Ort::Pc, "{stufe} {name:?}");
                assert!(e.grund.contains("kein Server verfügbar"), "{}", e.grund);
                assert!(e.grund.starts_with(stufe), "{}", e.grund);
                assert!(!e.grund.contains("beim Verbinden"), "{}", e.grund);
            }
        }
    }

    #[test]
    fn explicit_server_with_a_name_keeps_the_check_later_note() {
        let e = resolve(
            &explizit(server(" srv ")),
            &Vorgabe::Automatisch,
            &Vorgabe::Automatisch,
            &host(None),
            None,
        );
        assert_eq!(e.ort, server(" srv "));
        assert_eq!(e.grund, format!("Start legt den Ort fest{CHECK_LATER}"));
    }

    fn auto(frei: Option<u64>, server_name: Option<&str>) -> Entscheidung {
        let a = Vorgabe::Automatisch;
        resolve(&a, &a, &a, &host(frei), server_name)
    }

    #[test]
    fn automatic_low_ram_with_server_picks_server() {
        let e = auto(Some(MIN_FREE_RAM_BYTES - 1), Some("srv"));
        assert_eq!(e.ort, server("srv"));
        assert!(e.grund.starts_with("weniger als "), "{}", e.grund);
        assert!(e.grund.ends_with(" GiB frei"), "{}", e.grund);
    }

    #[test]
    fn automatic_low_ram_without_server_stays_on_pc_with_reason() {
        let e = auto(Some(MIN_FREE_RAM_BYTES - 1), None);
        assert_eq!(e.ort, Ort::Pc);
        assert!(e.grund.starts_with("weniger als "), "{}", e.grund);
        assert!(e.grund.contains("kein Server verfügbar"), "{}", e.grund);
    }

    #[test]
    fn automatic_empty_server_name_counts_as_no_server() {
        for name in ["", "  "] {
            let e = auto(Some(MIN_FREE_RAM_BYTES - 1), Some(name));
            assert_eq!(e.ort, Ort::Pc, "name {name:?}");
            assert!(e.grund.contains("kein Server verfügbar"), "{}", e.grund);
        }
    }

    /// The threshold in the reasons comes from the number passed in, not from
    /// a literal: these cases stay green whatever `MIN_FREE_RAM_BYTES` is.
    #[test]
    fn reason_text_follows_the_threshold() {
        let cases = [
            (GIB / 2, "0,5"),
            (GIB, "1"),
            (GIB * 5 / 4, "1,25"),
            (3 * GIB, "3"),
        ];
        for (min, text) in cases {
            let frei = host(Some(min - 1));
            let e = automatisch_with_min(min, &frei, Some("srv"));
            assert_eq!(e.ort, server("srv"), "{text}");
            assert_eq!(e.grund, format!("weniger als {text} GiB frei"));
            let e = automatisch_with_min(min, &frei, None);
            assert_eq!(
                e.grund,
                format!("weniger als {text} GiB frei, aber kein Server verfügbar")
            );
            let e = automatisch_with_min(min, &host(Some(min)), Some("srv"));
            assert_eq!(e.ort, Ort::Pc, "{text}");
            assert_eq!(e.grund, format!("mindestens {text} GiB frei, PC reicht"));
        }
    }

    #[test]
    fn automatic_uses_the_shared_threshold() {
        for frei in [
            None,
            Some(0),
            Some(MIN_FREE_RAM_BYTES - 1),
            Some(MIN_FREE_RAM_BYTES),
        ] {
            for srv in [None, Some("srv")] {
                assert_eq!(
                    auto(frei, srv),
                    automatisch_with_min(MIN_FREE_RAM_BYTES, &host(frei), srv)
                );
            }
        }
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
