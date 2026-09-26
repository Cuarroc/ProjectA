window.HQ_DATA = {
  "generatedAt": "2026-09-26T14:28:09.087Z",
  "commit": "fd1c8f0",
  "dirty": true,
  "sources": [
    {
      "path": "STAND.md",
      "sha256": "842a7b5c517082e215b761b42dc8c90a41734de3e241c098a21cb760a3616aca"
    },
    {
      "path": "docs/PLAN.md",
      "sha256": "1b8a5749905e926920e6c97b6e6b2398f450ad8d02d3cda41c41c554f40f2650"
    },
    {
      "path": ".pa/task_w1-05.md",
      "sha256": "45ebb9aaee6612a77ad9c5a63d094aa1d62ab19239e231685934bf761060e9b3"
    },
    {
      "path": ".pa/task_f_core3_delivery.md",
      "sha256": "5f8b67e3368c2011872aa4548530a5e503d0ed21cc820e8cd191e9ad176c40f3"
    },
    {
      "path": ".pa/task_w1-20.md",
      "sha256": "f69367fc49f659b82a655830a7647f03e119c3bf51918132b04def25ba2ac46c"
    },
    {
      "path": ".pa/task_w1-17.md",
      "sha256": "82385478c94ddf5bf8f14a399c4a06d027adcd865a04645b533b14965e4750f9"
    }
  ],
  "warnings": [],
  "nextGrip": [
    {
      "text": "M2 nach PLAN.md abarbeiten; die Queue mergt grüne PRs selbst.",
      "source": "STAND.md#Nächster Griff"
    },
    {
      "text": "Die toten Queue-Einträge read-only nachzählen und mit der neuen Cancel-Regel gezielt verwerfen (W1-05b, PR #19).",
      "source": "STAND.md#Nächster Griff"
    },
    {
      "text": "Fragen an den Nutzer gehen in die Entscheidungs-Inbox in PLAN.md.",
      "source": "STAND.md#Nächster Griff"
    }
  ],
  "specs": [
    {
      "file": ".pa/task_w1-05.md",
      "title": "W1-05b: Queue-Abnahmerest, Cancel-Regel für `dispatched`",
      "packet": "W1-05b: Queue-Abnahmerest, Cancel-Regel für `dispatched`",
      "lane": "serial",
      "serialOwner": "store.rs",
      "status": "aktiv",
      "source": "STAND.md#Aktive Specs",
      "startable": true
    },
    {
      "file": ".pa/task_f_core3_delivery.md",
      "title": "W1-03e/f: F-CORE-3 Rest B.3/C",
      "packet": "W1-03e/f: F-CORE-3 Rest B.3/C",
      "lane": "parallel",
      "serialOwner": null,
      "status": "aktiv",
      "source": "STAND.md#Aktive Specs",
      "startable": true
    },
    {
      "file": ".pa/task_w1-20.md",
      "title": "W1-20: Zweites Setup reproduzieren",
      "packet": "W1-20: Zweites Setup reproduzieren",
      "lane": "parallel",
      "serialOwner": null,
      "status": "aktiv",
      "source": "STAND.md#Aktive Specs",
      "startable": true
    },
    {
      "file": ".pa/task_w1-17.md",
      "title": "W1-17: HQ-Parser prüfen",
      "packet": "W1-17: HQ-Parser prüfen",
      "lane": "parallel",
      "serialOwner": null,
      "status": "aktiv",
      "source": "STAND.md#Aktive Specs",
      "startable": true
    }
  ],
  "findings": [
    {
      "id": "KI-24",
      "text": "SQLite-Lastklasse (`database is locked`), beobachten.",
      "klass": "CLAIM",
      "source": "STAND.md",
      "packet": null,
      "serialOwner": null
    },
    {
      "id": "KI-27",
      "text": "`exited_undelivered` gibt Reservierung und Delivery frei (DF-15b, PR #16), beobachten.",
      "klass": "CLAIM",
      "source": "STAND.md",
      "packet": null,
      "serialOwner": null
    },
    {
      "id": "KI-20",
      "text": "doppelte Antwort auf `ESC[6n`, Behebung W1-27 in M3.",
      "klass": "CLAIM",
      "source": "STAND.md",
      "packet": null,
      "serialOwner": null
    }
  ],
  "milestones": [
    {
      "id": "M1",
      "title": "Alles Laufende gelandet, App startbar",
      "packages": [
        {
          "id": "W2-03",
          "title": "Usage-/Billing-Collectors je Adapter",
          "size": "M",
          "lane": "st",
          "stand": "✓ #140",
          "state": "done",
          "prNumbers": [
            140
          ]
        },
        {
          "id": "W2-06",
          "title": "Supervisor: Producer-Audit und Runtime-Notifications",
          "size": "M",
          "lane": "mn + sup",
          "stand": "✓ #152",
          "state": "done",
          "prNumbers": [
            152
          ]
        },
        {
          "id": "W2-08a",
          "title": "Ressourcendruck- und Streaming-Enforcement",
          "size": "M",
          "lane": "fR",
          "stand": "✓ #134",
          "state": "done",
          "prNumbers": [
            134
          ]
        },
        {
          "id": "W2-04f",
          "title": "Planungsendpunkte nur für den Koordinator",
          "size": "S",
          "lane": "api",
          "stand": "✓ #135",
          "state": "done",
          "prNumbers": [
            135
          ]
        },
        {
          "id": "W2-01b",
          "title": "Review-Route nimmt reviewerRunId aus dem Credential",
          "size": "S",
          "lane": "api",
          "stand": "✓ #124",
          "state": "done",
          "prNumbers": [
            124
          ]
        },
        {
          "id": "W2-01c",
          "title": "approvalAuthority in agent_access.rs angleichen",
          "size": "S",
          "lane": "fR",
          "stand": "✓ #150",
          "state": "done",
          "prNumbers": [
            150
          ]
        },
        {
          "id": "W1-15c",
          "title": "Übrige Mutex-Stellen in pty.rs",
          "size": "S",
          "lane": "pty",
          "stand": "✓ #137",
          "state": "done",
          "prNumbers": [
            137
          ]
        },
        {
          "id": "W1-23c",
          "title": "„-0 Tokens“-Anzeige, MSRV gemessen",
          "size": "S",
          "lane": "fR",
          "stand": "✓ #136",
          "state": "done",
          "prNumbers": [
            136
          ]
        },
        {
          "id": "W1-29",
          "title": "Linux-Flake im Prozessgruppen-Test",
          "size": "S",
          "lane": "fR",
          "stand": "✓ #138",
          "state": "done",
          "prNumbers": [
            138
          ]
        },
        {
          "id": "W1-21c",
          "title": "xterm-pageerror beim Mount",
          "size": "S",
          "lane": "fe",
          "stand": "✓ #151",
          "state": "done",
          "prNumbers": [
            151
          ]
        },
        {
          "id": "SETUP-04",
          "title": "AGENTS.md: Mergify, Reviews, Build-Slots",
          "size": "M",
          "lane": "doc",
          "stand": "✓ #132",
          "state": "done",
          "prNumbers": [
            132
          ]
        },
        {
          "id": "HOOK-01",
          "title": "Hook-ROOT-Fix einzeln vor CI-02 (Nutzer 25.09.)",
          "size": "S",
          "lane": "ci",
          "stand": "✓ #156",
          "state": "done",
          "prNumbers": [
            156
          ]
        },
        {
          "id": "W1-05b",
          "title": "Sichere Cancel-Regel für dispatched, Dedup der toten Tasks; erst st-Kind, dann api-Kind; Zahl der toten Einträge read-only nachzählen",
          "size": "M",
          "lane": "st → api",
          "stand": "✓ #19",
          "state": "done",
          "prNumbers": [
            19
          ]
        },
        {
          "id": "W1-03e",
          "title": "MSG_USER erst nach bewiesener Zustellung (F-CORE-3 B.3)",
          "size": "S",
          "lane": "wk",
          "stand": "✓ #171",
          "state": "done",
          "prNumbers": [
            171
          ]
        },
        {
          "id": "W1-20",
          "title": "Zweites Setup reproduzieren (Node 24, npm ci, dev:setup, dev:doctor)",
          "size": "S",
          "lane": "N",
          "stand": "✓ #166",
          "state": "done",
          "prNumbers": [
            166
          ]
        },
        {
          "id": "CI-02",
          "title": "Leichter main-Push, Docs-only, Dependabot im red-first (enthält W1-19b)",
          "size": "S",
          "lane": "ci",
          "stand": "✓ #133",
          "state": "done",
          "prNumbers": [
            133
          ]
        },
        {
          "id": "CI-03",
          "title": "Actions-Kosten senken: CI nur bei „ready“ und in der Queue, Windows nur in Queue und Wochenlauf, Budgetstopp ab 80 %",
          "size": "M",
          "lane": "ci",
          "stand": "✓ #149",
          "state": "done",
          "prNumbers": [
            149
          ]
        },
        {
          "id": "SETUP-08",
          "title": "Git-/PR- und Plan-Helfer unter scripts/dev (08a + 08b)",
          "size": "M",
          "lane": "doc",
          "stand": "✓ #22",
          "state": "done",
          "prNumbers": [
            22
          ]
        },
        {
          "id": "SEC-01",
          "title": "Geheimnis-Scan (gitleaks) als precommit-Gate",
          "size": "S",
          "lane": "ci",
          "stand": "✓ #20",
          "state": "done",
          "prNumbers": [
            20
          ]
        }
      ],
      "done": 19,
      "total": 19
    },
    {
      "id": "M2",
      "title": "Überblick und Setup",
      "packages": [
        {
          "id": "M2-FRAG",
          "title": "Frag-mich-Skill für Einsteiger-Erklärungen",
          "size": "S",
          "lane": "doc",
          "stand": "✓ #161",
          "state": "done",
          "prNumbers": [
            161
          ]
        },
        {
          "id": "PLAN-01",
          "title": "Ein Plan, zehn Regeln, gestufte Reviews, PR-Text ist der Bericht, Archiv",
          "size": "M",
          "lane": "doc",
          "stand": "dieses Paket",
          "state": "in_progress",
          "prNumbers": []
        },
        {
          "id": "OPS-01",
          "title": "Status und Tagesbericht per Skript aus GitHub und git (was läuft, was fertig ist, was du entscheidest)",
          "size": "M",
          "lane": "doc",
          "stand": "PR #164",
          "state": "pr",
          "prNumbers": [
            164
          ]
        },
        {
          "id": "OPS-02",
          "title": "Startcheck vor jedem Worker: Modell beobachtet, Limit, freier RAM, laufende Cargo-Builds; harte Stopps",
          "size": "S",
          "lane": "doc",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "CI-04",
          "title": "Roter main stoppt die Queue: Issue mit Run-ID, Label, Queue-Pause",
          "size": "S",
          "lane": "ci",
          "stand": "✓ #28",
          "state": "done",
          "prNumbers": [
            28
          ]
        },
        {
          "id": "W1-21d",
          "title": "Suchschalter im Scrollback (Groß-/Kleinschreibung, Regex)",
          "size": "S",
          "lane": "fe",
          "stand": "✓ #27",
          "state": "done",
          "prNumbers": [
            27
          ]
        },
        {
          "id": "W1-30",
          "title": "Flake omniroute::…management_failures_keep_their_http_and_network_classes (100-ms-Timeout)",
          "size": "S",
          "lane": "fR",
          "stand": "✓ #32",
          "state": "done",
          "prNumbers": [
            32
          ]
        },
        {
          "id": "CLEAN-01",
          "title": "Toten Code löschen: npm @tauri-apps/plugin-process, drei ungenutzte TS-Funktionen und Exporte (Prüfung B, S6)",
          "size": "S",
          "lane": "fe",
          "stand": "✓ #31",
          "state": "done",
          "prNumbers": [
            31
          ]
        },
        {
          "id": "CLEAN-02",
          "title": "Stillgelegten Queen-Anlegepfad löschen (Trait-Methode in api.rs, Umsetzung in main.rs, drei Funktionen in workers.rs)",
          "size": "S",
          "lane": "api → mn → wk",
          "stand": "✓ #25",
          "state": "done",
          "prNumbers": [
            25
          ]
        },
        {
          "id": "W1-17",
          "title": "HQ-Parser: prüfen, ob OPS-01 oder DF-06a ihn überholt haben; sonst auf die Meilenstein-Tabellen umstellen. Bis dahin zeigt der eingecheckte HQ-Snapshot (docs/dev-hq/data.js/data.json) die alten F-Meilensteine als „waiting“ — bekannter Zwischenstand, kein Datenfehler",
          "size": "S",
          "lane": "hqL",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "SETUP-09",
          "title": "Lokaler Review-Lauf scripts/review/run-local.sh",
          "size": "S",
          "lane": "doc",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "SETUP-12",
          "title": "Rest des Docs-only-Pfadfilters, soweit CI-02/CI-03 ihn nicht abdecken",
          "size": "S",
          "lane": "ci",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "SETUP-14",
          "title": "Nutzer: tote Keys, OpenCode-Modelle, ollama signin, Permission-Regeln",
          "size": "S",
          "lane": "N",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "SETUP-15",
          "title": "Abschlussreview der Setup-Doku, verkleinert",
          "size": "S",
          "lane": "doc",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        }
      ],
      "done": 6,
      "total": 14
    },
    {
      "id": "M3",
      "title": "App im Alltag + Zwischenrelease v1.5.0-beta",
      "packages": [
        {
          "id": "HQ2-02",
          "title": "Abnahme der Konzeptdemo und Studio-Variante; legt die Richtung für „HQ als Hauptbereich der App“ fest",
          "size": "M",
          "lane": "hqS + N",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "HQ2-03",
          "title": "Gemeinsame Design-Tokens hell/dunkel, nach HQ2-02",
          "size": "M",
          "lane": "hqS",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W1-10",
          "title": "HQ-Stylesheet: Kontrast-Gate auf hq.css, Light Mode, prefers-contrast",
          "size": "M",
          "lane": "hqL",
          "stand": "✓ #33",
          "state": "done",
          "prNumbers": [
            33
          ]
        },
        {
          "id": "W2-10",
          "title": "Live-HQ-Views (vor Dispatch teilen: 10a Ziele/Teams, 10b Routing/Budget, 10c Review/Delivery)",
          "size": "M",
          "lane": "hqL",
          "stand": "10a ✓ #13, 10b ✓ #21, 10c offen",
          "state": "in_progress",
          "prNumbers": [
            13,
            21
          ]
        },
        {
          "id": "W5-02b7",
          "title": "HQ-Profilansicht zeigt envPolicy",
          "size": "S",
          "lane": "hqL",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W5-02a",
          "title": "Koordinator ohne Schreibpfad",
          "size": "M",
          "lane": "wk",
          "stand": "✓ #24",
          "state": "done",
          "prNumbers": [
            24
          ]
        },
        {
          "id": "W5-22",
          "title": "Konfliktvorhersage und Lane-Guard",
          "size": "M",
          "lane": "fR",
          "stand": "✓ #9",
          "state": "done",
          "prNumbers": [
            9
          ]
        },
        {
          "id": "W5-28",
          "title": "Automatischer Laufzeitbeleg (Sandbox, Queue aus)",
          "size": "M",
          "lane": "fR",
          "stand": "✓ #11",
          "state": "done",
          "prNumbers": [
            11
          ]
        },
        {
          "id": "W5-00b",
          "title": "Fremden Text in workers.rs-Prompts suchen und einhüllen",
          "size": "S",
          "lane": "wk",
          "stand": "✓ #18",
          "state": "done",
          "prNumbers": [
            18
          ]
        },
        {
          "id": "W2-04e",
          "title": "dispatch.role ins Agenten-Briefing",
          "size": "S",
          "lane": "wk",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W2-01d",
          "title": "CLI-Befehl pa hq agent review",
          "size": "S",
          "lane": "pa",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W1-18b",
          "title": "Probe, ob Codex/OpenCode .agents/skills lesen",
          "size": "S",
          "lane": "wk + N",
          "stand": "OpenCode ✓ #30, Codex offen",
          "state": "in_progress",
          "prNumbers": [
            30
          ]
        },
        {
          "id": "W1-01b",
          "title": "Kimi-Re-Smoke mit PROJECTA_PTY_TRACE_DIR",
          "size": "S",
          "lane": "pty",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W1-27",
          "title": "KI-20, doppelte ESC[6n-Antwort; welche Seite antwortet, entscheidet der Advisor (Nutzer 25.09.)",
          "size": "S",
          "lane": "pty + fe",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W3-08",
          "title": "Paketierter HQ-v1-Beleg",
          "size": "S",
          "lane": "N",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "R-1",
          "title": "Zwischenrelease v1.5.0-beta als Abschluss von M3",
          "size": "S",
          "lane": "N + doc",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        }
      ],
      "done": 5,
      "total": 16
    },
    {
      "id": "M4",
      "title": "Dauerbetrieb abgenommen, v1.5.0",
      "packages": [
        {
          "id": "W5-05",
          "title": "Prüfpfad (append-only, Trigger gegen UPDATE/DELETE)",
          "size": "S",
          "lane": "st",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W5-04a",
          "title": "Not-Aus im Store, global ohne Projektrahmen (Schnitt 25.09., W5-01a bleibt geparkt)",
          "size": "S",
          "lane": "st",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W5-04b",
          "title": "Not-Aus in der App (10 s Frist)",
          "size": "S",
          "lane": "mn",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W5-04c",
          "title": "Not-Aus in pa",
          "size": "S",
          "lane": "pa",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W2-02b",
          "title": "Gleichstand in derselben Sekunde, vertrauenswürdige Testquelle, Merge-Ergebnis als Kandidat",
          "size": "M",
          "lane": "st",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W2-04c",
          "title": "Rollenbewusste Routen und Credentials beim Launch",
          "size": "M",
          "lane": "st",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W2-04d",
          "title": "Rollen auf Budget-Zwecke abbilden",
          "size": "S",
          "lane": "st",
          "stand": "✓ #15",
          "state": "done",
          "prNumbers": [
            15
          ]
        },
        {
          "id": "W2-04g",
          "title": "Optional: Versionsspalte für die Attestierungsregel",
          "size": "S",
          "lane": "st",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "DF-15b",
          "title": "Reservierung und Delivery bei exited_undelivered freigeben (KI-27; Nutzer 25.09.: ja)",
          "size": "S",
          "lane": "st",
          "stand": "✓ #16",
          "state": "done",
          "prNumbers": [
            16
          ]
        },
        {
          "id": "W2-07b",
          "title": "Windows-ACL für projecta-api.json und agent-access/",
          "size": "S",
          "lane": "api",
          "stand": "✓ #12",
          "state": "done",
          "prNumbers": [
            12
          ]
        },
        {
          "id": "W2-08b",
          "title": "Speicher-/CPU-Grenzen je Job (Nutzer 25.09.: ja); Stillstand früh erkennen (Denk- und Fortschrittszeichen prüfen, sonst nach 15 min)",
          "size": "M",
          "lane": "fR",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W2-09b",
          "title": "DeepSeek-V4-Flash-Worker über OpenCode",
          "size": "M",
          "lane": "wk",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "HQ2-05b",
          "title": "Echte Collector-/Billing-Proben je Anbieter; vorher prüfen, ob W2-03 es schon abdeckt",
          "size": "M",
          "lane": "fR + N",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W5-02b3",
          "title": "Env-Stufe als globale Einstellung (st → api → fe)",
          "size": "M",
          "lane": "st → api → fe",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W5-02b4",
          "title": "Push aus dem Worker über den Runner-Host, danach strict als Voreinstellung",
          "size": "M",
          "lane": "pty + wk",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W5-02b5",
          "title": "Test für den http.extraHeader-Reset; GPG unter strict",
          "size": "S",
          "lane": "fR",
          "stand": "✓ #17",
          "state": "done",
          "prNumbers": [
            17
          ]
        },
        {
          "id": "W1-03f",
          "title": "F-CORE-3 Baustein C: Zustell-Queue, pa worker done/blocked (braucht das Z-1-Protokoll am PC)",
          "size": "M",
          "lane": "wk + pa",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W3-01",
          "title": "Globaler DB-Wartungs-/Write-Lock + Drain (st-Kind, dann mn-Kind)",
          "size": "M",
          "lane": "st → mn",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W3-02",
          "title": "Windows-Recovery-Helper",
          "size": "M",
          "lane": "fR + N",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W3-03",
          "title": "Paketierte Drills: Singleton, Crash/Power-Loss, Backup (3 × S)",
          "size": "S",
          "lane": "N",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W3-04",
          "title": "Updater-Zustände in App und HQ",
          "size": "S",
          "lane": "fe + hqL",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W3-07",
          "title": "Produktionsschlüssel-Build + Signed-Updater-Relaunch (Nutzer: später)",
          "size": "S",
          "lane": "N",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W4-01",
          "title": "Benchmark, verkleinert (Vorschlag: 5 Aufgaben statt 20)",
          "size": "M",
          "lane": "fR",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W4-02",
          "title": "Abnahmematrix final (27 Zeilen)",
          "size": "S",
          "lane": "doc",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W4-03",
          "title": "Continuous-Aktivierung, nur nach W4-02 und mit Freigabe des Nutzers",
          "size": "S",
          "lane": "mn",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W4-04",
          "title": "Release v1.5.0",
          "size": "S",
          "lane": "N",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        }
      ],
      "done": 4,
      "total": 26
    }
  ],
  "next": [
    {
      "packet": "M2 nach PLAN.md abarbeiten; die Queue mergt grün",
      "why": "M2 nach PLAN.md abarbeiten; die Queue mergt grüne PRs selbst.",
      "source": "STAND.md#Nächster Griff",
      "lane": "parallel",
      "serialOwner": null,
      "doneWhen": "M2 nach PLAN.md abarbeiten; die Queue mergt grüne PRs selbst.",
      "startable": true
    },
    {
      "packet": "Die toten Queue-Einträge read-only nachzählen un",
      "why": "Die toten Queue-Einträge read-only nachzählen und mit der neuen Cancel-Regel gezielt verwerfen (W1-05b, PR #19).",
      "source": "STAND.md#Nächster Griff",
      "lane": "parallel",
      "serialOwner": null,
      "doneWhen": "Die toten Queue-Einträge read-only nachzählen und mit der neuen Cancel-Regel gezielt verwerfen (W1-05b, PR #19).",
      "startable": true
    },
    {
      "packet": "Fragen an den Nutzer gehen in die Entscheidungs-",
      "why": "Fragen an den Nutzer gehen in die Entscheidungs-Inbox in PLAN.md.",
      "source": "STAND.md#Nächster Griff",
      "lane": "parallel",
      "serialOwner": null,
      "doneWhen": "Fragen an den Nutzer gehen in die Entscheidungs-Inbox in PLAN.md.",
      "startable": true
    }
  ],
  "lessons": [
    {
      "id": "L-dc8be5e2f0",
      "createdAt": "2026-09-08T22:27:22.706Z",
      "lastSeen": "2026-09-08T22:27:22.706Z",
      "hits": 1,
      "symptom": "cargo check fails in pre-commit: Package gdk-3.0 was not found in the pkg-config search path",
      "cause": "Fresh Linux container without the GTK/WebKit development headers Tauri links against",
      "fix": "apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev — then rerun the commit; never bypass the hook with --no-verify",
      "tags": [
        "cargo",
        "linux",
        "pre-commit"
      ],
      "source": ".pa/report_devhq_lanes_m12_m14.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 17,
        "votes": 0
      }
    },
    {
      "id": "L-32124d0483",
      "createdAt": "2026-09-08T22:27:22.758Z",
      "lastSeen": "2026-09-08T22:27:22.758Z",
      "hits": 1,
      "symptom": "browserType.launch: Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-<n>",
      "cause": "The npm @playwright/test version pins a newer Chromium build than the one preinstalled on the runner",
      "fix": "HQ_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:hq:visual (or npx playwright install chromium where downloads are allowed)",
      "tags": [
        "chromium",
        "playwright",
        "tests"
      ],
      "source": "scripts/lib/hq-visual.browser.mjs",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 17,
        "votes": 0
      }
    },
    {
      "id": "L-f2d4c93cfa",
      "createdAt": "2026-09-08T22:27:22.815Z",
      "lastSeen": "2026-09-08T22:27:22.815Z",
      "hits": 1,
      "symptom": "git stash pop fails: Your local changes would be overwritten by merge (docs/dev-hq/data.js)",
      "cause": "Running the HQ tests regenerates data.js/data.json; a stash taken before the run no longer applies cleanly. Worktrees also share one stash stack, so a stash can grab another session's work",
      "fix": "Do not stash in this repo — make a WIP commit instead. If already stashed: git checkout -- docs/dev-hq/data.js docs/dev-hq/data.json && git stash pop",
      "tags": [
        "dev-hq",
        "git",
        "worktree"
      ],
      "source": "CLAUDE.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 17,
        "votes": 0
      }
    },
    {
      "id": "L-6fd4c65aab",
      "createdAt": "2026-09-08T22:27:22.873Z",
      "lastSeen": "2026-09-08T22:27:22.873Z",
      "hits": 1,
      "symptom": "A gate looked green but the failing status was masked",
      "cause": "Piping a command into tail/head/grep replaces its exit code with the pipe's last command",
      "fix": "Read exit codes unmasked: run the gate alone, or use set -o pipefail and check PIPESTATUS",
      "tags": [
        "gates",
        "shell"
      ],
      "source": "CLAUDE.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 17,
        "votes": 0
      }
    },
    {
      "id": "L-c1242ee204",
      "createdAt": "2026-09-08T22:27:22.930Z",
      "lastSeen": "2026-09-08T22:27:22.930Z",
      "hits": 1,
      "symptom": "HQ test 'Now grip is STAND prose' fails after a STAND revision although nothing is broken",
      "cause": "The test matched a fixed phrase from an older STAND §3 instead of the contract (verbatim STAND prose)",
      "fix": "Bind content tests to the source document (read STAND.md and assert containment), not to one wording",
      "tags": [
        "dev-hq",
        "stand",
        "tests"
      ],
      "source": "scripts/lib/hq-pages.test.mjs",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 17,
        "votes": 0
      }
    },
    {
      "id": "L-d211310281",
      "createdAt": "2026-09-08T22:27:22.987Z",
      "lastSeen": "2026-09-08T22:27:22.987Z",
      "hits": 1,
      "symptom": "Worker dies with chat_admission_busy or invalid_api_key and blind retries burn the quota",
      "cause": "An error with its own code is a documented condition, not noise; 'retry shortly' is an instruction",
      "fix": "Investigate the first failure: worker-why <name> names cause and remedy before any retry loop",
      "tags": [
        "omniroute",
        "retries",
        "workers"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 17,
        "votes": 0
      }
    },
    {
      "id": "L-0fc6438deb",
      "createdAt": "2026-09-08T22:27:23.045Z",
      "lastSeen": "2026-09-08T22:27:23.045Z",
      "hits": 1,
      "symptom": "Reachability check passes while the service is dead",
      "cause": "The probe asked 'answer with READY' and grepped READY — the model echoed the prompt",
      "fix": "Ask for something whose answer is not in the question, and make the check fail once on purpose before trusting it (preflight --selftest)",
      "tags": [
        "preflight",
        "verification"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 17,
        "votes": 0
      }
    },
    {
      "id": "L-1fa4cacf90",
      "createdAt": "2026-09-08T22:27:23.102Z",
      "lastSeen": "2026-09-08T22:27:23.102Z",
      "hits": 1,
      "symptom": "Release endpoint check green, but the updater app got 404 (Could not fetch a valid release JSON)",
      "cause": "Verification ran with gh auth token credentials the product does not have",
      "fix": "Probe remote endpoints anonymously with exactly the product's headers; the release workflow's anonymous verify gate does this",
      "tags": [
        "release",
        "updater",
        "verification"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 17,
        "votes": 0
      }
    },
    {
      "id": "L-a2b34ecd04",
      "createdAt": "2026-09-08T22:27:23.161Z",
      "lastSeen": "2026-09-08T22:27:23.161Z",
      "hits": 1,
      "symptom": "cargo build aborts with 0xc000012d / mmap errors under parallel load",
      "cause": "Machine memory pressure, not a code problem",
      "fix": "CARGO_BUILD_JOBS=2 and rebuild. Never set CARGO_PROFILE_* env vars — that invalidates the whole dependency cache",
      "tags": [
        "build",
        "cargo",
        "windows"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 17,
        "votes": 0
      }
    },
    {
      "id": "L-3db6dbc1f6",
      "createdAt": "2026-09-08T22:27:23.220Z",
      "lastSeen": "2026-09-08T22:27:23.220Z",
      "hits": 1,
      "symptom": "Vite answers 504 Outdated Optimize Dep on every module",
      "cause": "Vite's dependency cache is stale after a dependency change",
      "fix": "scripts/dev-fresh.cmd (clears the dep cache and restarts)",
      "tags": [
        "frontend",
        "vite"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 17,
        "votes": 0
      }
    },
    {
      "id": "L-d78036fb38",
      "createdAt": "2026-09-08T22:27:23.279Z",
      "lastSeen": "2026-09-08T22:27:23.279Z",
      "hits": 1,
      "symptom": "cd <worktree> && git ... acts on the wrong repository",
      "cause": "The agent shell resets the working directory between calls",
      "fix": "Always git -C <path> ..., never cd X && git ...",
      "tags": [
        "git",
        "shell",
        "worktree"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 17,
        "votes": 0
      }
    },
    {
      "id": "L-15af4dc17a",
      "createdAt": "2026-09-08T22:27:23.336Z",
      "lastSeen": "2026-09-08T22:27:23.336Z",
      "hits": 1,
      "symptom": "Orchestrator spent 223k tokens mostly on waiting",
      "cause": "Polling every 60s on 20-minute work",
      "fix": "Poll at a fraction of the expected duration or wait on a cheap signal (file exists, process exited)",
      "tags": [
        "orchestrator",
        "polling",
        "tokens"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 17,
        "votes": 0
      }
    },
    {
      "id": "L-b973efab33",
      "createdAt": "2026-09-08T22:27:23.399Z",
      "lastSeen": "2026-09-08T22:27:23.399Z",
      "hits": 1,
      "symptom": "The same bug reappeared right next to the freshly fixed one",
      "cause": "A fix is the moment with the highest chance of repeating the pattern nearby",
      "fix": "After each fix, search the fix's siblings for the same mistake before committing",
      "tags": [
        "process",
        "review"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 17,
        "votes": 0
      }
    },
    {
      "id": "L-9be7ac486f",
      "createdAt": "2026-09-08T22:27:23.456Z",
      "lastSeen": "2026-09-08T22:27:23.456Z",
      "hits": 1,
      "symptom": "Status tool reported five successful workers as dead",
      "cause": "Success was derived from a report file instead of the work left behind (commits on the branches)",
      "fix": "Derive state from artefacts — commits, files, processes — never from a form somebody should have filled",
      "tags": [
        "status",
        "verification",
        "workers"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 17,
        "votes": 0
      }
    },
    {
      "id": "L-5a2226bd8d",
      "createdAt": "2026-09-08T22:27:23.514Z",
      "lastSeen": "2026-09-08T22:27:23.514Z",
      "hits": 1,
      "symptom": "A daemon started by a scheduled task survives Stop-ScheduledTask",
      "cause": "It detaches and keeps running under its old PID",
      "fix": "Kill the process directly, then measure again instead of assuming",
      "tags": [
        "daemon",
        "ops",
        "windows"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 17,
        "votes": 0
      }
    },
    {
      "id": "L-242f649538",
      "createdAt": "2026-09-08T22:37:49.091Z",
      "lastSeen": "2026-09-08T22:37:49.091Z",
      "hits": 1,
      "symptom": "CI red-first: '<file> war an der Merge-Base GRUEN — das ist kein Test-First-Beleg'",
      "cause": "The Test-First: trailer named an existing test file that only gained new cases; red-first runs the whole file at the merge-base and it passed there",
      "fix": "Put new test cases for an existing suite into a new *.test.mjs file (missing at base = red) and name that file in the Test-First: trailer; a trailer already pushed must be amended on your own branch",
      "tags": [
        "ci",
        "git",
        "red-first",
        "test-first"
      ],
      "source": ".pa/report_devhq_v2.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 17,
        "votes": 0
      }
    },
    {
      "id": "L-9c3141fa5f",
      "createdAt": "2026-09-10T15:06:34.316Z",
      "lastSeen": "2026-09-10T15:06:34.316Z",
      "hits": 1,
      "symptom": "HQ profile save drops wrapper metadata or overwrites corrupt JSON",
      "cause": "Profile writes rebuilt the wrapper and non-strict reads hid parse failures",
      "fix": "Use strict reads before edits, preserve unknown wrapper and profile fields, and atomically replace the profile file",
      "tags": [
        "configuration",
        "hq",
        "profiles"
      ],
      "source": ".pa/report_continuous_devhq.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 15,
        "votes": 0
      }
    },
    {
      "id": "L-4786a45bc6",
      "createdAt": "2026-09-10T21:55:23.371Z",
      "lastSeen": "2026-09-10T21:55:23.371Z",
      "hits": 1,
      "symptom": "HQ backend ancestor ownership misses files under the directory",
      "cause": "Normalizing protected paths to a seam sentinel discarded the actual path overlap",
      "fix": "Preserve declared paths, apply seam exclusion during conflict checks, conservatively expand legacy sentinels",
      "tags": [
        "hq",
        "ownership",
        "regression"
      ],
      "source": ".pa/report_continuous_runtime.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 15,
        "votes": 0
      }
    },
    {
      "id": "L-151ce5695b",
      "createdAt": "2026-09-11T10:55:27.921Z",
      "lastSeen": "2026-09-11T10:55:27.921Z",
      "hits": 1,
      "symptom": "HQ advertises test-only built-in profiles and drops runtime capabilities",
      "cause": "Regex scanned all Rust source, including unit fixtures; JavaScript merging did not follow Rust defaults",
      "fix": "Read one shared embedded profile manifest, compare runtime provenance, and test replacement plus longest-prefix inheritance",
      "tags": [
        "configuration",
        "evidence",
        "hq",
        "profiles"
      ],
      "source": ".pa/report_continuous_profiles.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 15,
        "votes": 0
      }
    },
    {
      "id": "L-58319dab4f",
      "createdAt": "2026-09-11T11:42:44.756Z",
      "lastSeen": "2026-09-11T11:42:44.756Z",
      "hits": 1,
      "symptom": "Token exhaustion and legacy backfill granted unintended capacity",
      "cause": "Strict greater-than missed exact exhaustion; migration serialized evolving defaults",
      "fix": "Distinguish measured exhaustion from held reservations and freeze legacy token allowance as unavailable; keep boundary regression tests",
      "tags": [
        "budgets",
        "migration",
        "regression"
      ],
      "source": ".pa/report_continuous_budgets.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 15,
        "votes": 0
      }
    },
    {
      "id": "L-f6b9db1f1d",
      "createdAt": "2026-09-11T14:56:25.201Z",
      "lastSeen": "2026-09-11T14:56:25.201Z",
      "hits": 1,
      "symptom": "Policy supervisor skips deadline checks when its notification observer fails",
      "cause": "A wake-hint transport was used as authority to skip the independent SQLite transaction",
      "fix": "Reconcile the authoritative store on periodic ticks even when notification health fails; preserve degraded observer status separately and test block-once behavior",
      "tags": [
        "notifications",
        "recovery",
        "supervisor"
      ],
      "source": ".pa/report_continuous_policy_supervisor.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 14,
        "votes": 0
      }
    },
    {
      "id": "L-a5669fa974",
      "createdAt": "2026-09-11T16:50:09.345Z",
      "lastSeen": "2026-09-11T16:50:09.345Z",
      "hits": 1,
      "symptom": "Test-First CI rejects successful long Rust logs with Broken pipe",
      "cause": "grep -q exits before printf drains a large log; pipefail reports SIGPIPE as failure, and negative zero-test checks can invert it.",
      "fix": "Drain the entire stream with grep -E redirected to null; test long success and zero-test logs plus nonzero exits.",
      "tags": [
        "bash",
        "ci",
        "pipefail"
      ],
      "source": ".pa/report_continuous_ci.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 14,
        "votes": 0
      }
    },
    {
      "id": "L-1cd96b04c4",
      "createdAt": "2026-09-11T17:16:32.561Z",
      "lastSeen": "2026-09-11T17:16:32.561Z",
      "hits": 1,
      "symptom": "Continuous claims exceed two workers when projects claim concurrently",
      "cause": "Capacity was counted per project although all projects share one execution host.",
      "fix": "Retain project limits and count all running claims inside the existing serialized claim transaction; never free slots on pause or lease expiry.",
      "tags": [
        "capacity",
        "concurrency",
        "continuous"
      ],
      "source": ".pa/report_continuous_capacity.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 14,
        "votes": 0
      }
    },
    {
      "id": "L-f9dd5890f0",
      "createdAt": "2026-09-11T17:47:48.427Z",
      "lastSeen": "2026-09-11T17:50:36.812Z",
      "hits": 1,
      "symptom": "Database restore loses original target on rename failure and consumes an existing temp file",
      "cause": "Restore removed the destination before rename and copied into a predictable unowned temporary pathname.",
      "fix": "Exclusively create an owner-private temporary file, flush the owned handle, then replace via rename without deleting the destination first; preserve unowned collisions.",
      "tags": [
        "filesystem",
        "recovery",
        "restore"
      ],
      "source": ".pa/report_restore_file_safety.md",
      "history": [
        {
          "at": "2026-09-11T17:50:36.812Z",
          "fix": "Exclusively create a private temporary file, preserve backup permissions and flush the owned handle, then replace via rename without deleting the destination first.",
          "note": "Full-suite permission-owner gate rejected direct permission mutation; use the existing secure-create pattern, not broader backup permission bits."
        }
      ],
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 14,
        "votes": 0
      }
    },
    {
      "id": "L-4314196d30",
      "createdAt": "2026-09-11T18:49:42.176Z",
      "lastSeen": "2026-09-11T18:49:42.176Z",
      "hits": 1,
      "symptom": "Run launch journal fails with database is locked under another SQLite writer",
      "cause": "Deferred transaction reads state before acquiring write access; SQLite WAL cannot always upgrade that read snapshot.",
      "fix": "Begin state-changing run transactions with BEGIN IMMEDIATE before authority reads; keep read-only views deferred and test a held competing writer.",
      "tags": [
        "concurrency",
        "runs",
        "sqlite"
      ],
      "source": ".pa/report_continuous_run_contention.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 14,
        "votes": 0
      }
    },
    {
      "id": "L-e6b55e9d19",
      "createdAt": "2026-09-11T19:25:59.671Z",
      "lastSeen": "2026-09-11T19:25:59.671Z",
      "hits": 1,
      "symptom": "Capture settlement accepts a provider route changed while waiting for the ledger writer",
      "cause": "Provider route and exit were checked outside the settlement transaction",
      "fix": "Recheck the exact validated route receipt and exit code under the same writer lock as run/session and ledger settlement, including replay",
      "tags": [
        "identity",
        "sqlite",
        "usage"
      ],
      "source": ".pa/report_continuous_capture_atomicity.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 14,
        "votes": 0
      }
    },
    {
      "id": "L-99b548f2b3",
      "createdAt": "2026-09-11T19:58:38.114Z",
      "lastSeen": "2026-09-11T19:58:38.114Z",
      "hits": 1,
      "symptom": "red-first treats a fully qualified Rust test name as a missing file",
      "cause": "Trailer parsing assumes every :: reference begins with a source file path",
      "fix": "Recognize Rust module identifiers and retain unique real-test discovery and positive test counts; test module-name success and zero-test rejection",
      "tags": [
        "ci",
        "rust",
        "test-first"
      ],
      "source": ".pa/report_continuous_ci.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 14,
        "votes": 0
      }
    },
    {
      "id": "L-fa7ec0b52a",
      "createdAt": "2026-09-11T21:00:07.530Z",
      "lastSeen": "2026-09-11T21:00:07.530Z",
      "hits": 1,
      "symptom": "Concurrent evidence submissions time out acquiring SQLite connections under load",
      "cause": "Synchronous Git probes occupied async runtime threads; a controlled regression demonstrated blocked database progress, without proving Git held a SQL connection",
      "fix": "Offload evidence Git probes behind two shared owned permits; keep the permit through blocking work and retain code/policy checks before evidence writes",
      "tags": [
        "concurrency",
        "evidence",
        "sqlite"
      ],
      "source": ".pa/report_evidence_probe_progress.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 14,
        "votes": 0
      }
    },
    {
      "id": "L-dfd9e7e90e",
      "createdAt": "2026-09-12T09:05:02.691Z",
      "lastSeen": "2026-09-12T09:05:02.691Z",
      "hits": 1,
      "symptom": "Git ownership diff hides out-of-scope submodule commits",
      "cause": "Repository diff.ignoreSubmodules configuration suppresses gitlinks from name-only diffs",
      "fix": "Use --ignore-submodules=none with NUL-delimited, no-renames baseline-to-candidate diffs; verify both rename sides and immutable backend launch baseline",
      "tags": [
        "candidate",
        "evidence",
        "git",
        "ownership"
      ],
      "source": ".pa/report_candidate_ownership.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 14,
        "votes": 0
      }
    },
    {
      "id": "L-229e7163d2",
      "createdAt": "2026-09-12T11:06:18.186Z",
      "lastSeen": "2026-09-12T11:06:18.186Z",
      "hits": 1,
      "symptom": "Update guard reports idle while a session is reserved or native exit is unconfirmed",
      "cause": "Separate starting/live registries and empty defaults hide pending or failed process observations",
      "fix": "Use one atomic reserved-starting-interactive registry; propagate unknown inventory; dispatch exit effects only after confirmed native wait; a snapshot still requires a maintenance lock",
      "tags": [
        "concurrency",
        "evidence",
        "sessions",
        "updater"
      ],
      "source": ".pa/report_session_inventory.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 14,
        "votes": 0
      }
    },
    {
      "id": "L-6627acad8b",
      "createdAt": "2026-09-12T12:13:05.589Z",
      "lastSeen": "2026-09-12T12:13:05.589Z",
      "hits": 1,
      "symptom": "Capture timeout hides unresolved input writer cleanup",
      "cause": "Execution error was returned before distinguishing writer join failure from delivery failure",
      "fix": "Preserve separate retirement and delivery results; propagate unresolved cleanup before execution error, retaining the execution error only after confirmed writer join",
      "tags": [
        "capture",
        "cleanup",
        "windows"
      ],
      "source": ".pa/report_host_timeout_cleanup.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 14,
        "votes": 0
      }
    },
    {
      "id": "L-880d8ec43b",
      "createdAt": "2026-09-12T15:31:07.131Z",
      "lastSeen": "2026-09-12T15:31:07.131Z",
      "hits": 1,
      "symptom": "SQLx row column metadata panics after multiple ALTER TABLE migrations",
      "cause": "Startup connections retained column metadata from an earlier schema generation; schema15 to17 test reproduced len16 index16 twice",
      "fix": "Retire and reopen the startup pool after successful schema changes before publishing Store, preserving connection options; verify populated old-schema rows",
      "tags": [
        "migration",
        "recovery",
        "sqlite"
      ],
      "source": ".pa/report_development_delivery_ledger.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 13,
        "votes": 0
      }
    },
    {
      "id": "L-44b44b8dd6",
      "createdAt": "2026-09-12T16:01:12.219Z",
      "lastSeen": "2026-09-12T16:01:12.219Z",
      "hits": 1,
      "symptom": "Session inventory becomes idle before core exit bookkeeping completes",
      "cause": "Native reaper called a hook that detached asynchronous database and credential work, then removed the session",
      "fix": "Await an explicit core exit result on the dedicated reaper, retain a Retiring entry during owned resource release and on failure, and require separate reader/global-write drain gates",
      "tags": [
        "concurrency",
        "sessions",
        "updater"
      ],
      "source": ".pa/report_exit_bookkeeping_gate.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 13,
        "votes": 0
      }
    },
    {
      "id": "L-7798ae705e",
      "createdAt": "2026-09-12T16:22:00.713Z",
      "lastSeen": "2026-09-12T16:22:00.713Z",
      "hits": 1,
      "symptom": "Session inventory clears before the independent PTY reader retires",
      "cause": "Native exit and core bookkeeping complete independently of the output thread and owned reader handle",
      "fix": "Retain the shared Retiring marker through resource disposal and bounded reader acknowledgement; timeout or panic keeps reconciliation required",
      "tags": [
        "concurrency",
        "sessions",
        "updater"
      ],
      "source": ".pa/report_reader_retirement_gate.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 13,
        "votes": 0
      }
    },
    {
      "id": "L-054b09e8f6",
      "createdAt": "2026-09-12T16:57:36.038Z",
      "lastSeen": "2026-09-12T16:57:36.038Z",
      "hits": 1,
      "symptom": "A prepared worker route is not compared with its durable launch receipt",
      "cause": "Pre-spawn validation checked current profile and policy but the receipt omitted the translated profile and was not compared before consumption",
      "fix": "Hash the prepared profile without publishing secrets and require exact write-once receipt equality before session reservation, credential binding and spawn; keep final native overlays as separate evidence",
      "tags": [
        "identity",
        "routing",
        "workers"
      ],
      "source": ".pa/report_bound_prepared_invocation.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 13,
        "votes": 0
      }
    },
    {
      "id": "L-9a2196f42f",
      "createdAt": "2026-09-12T22:12:47.565Z",
      "lastSeen": "2026-09-12T22:12:47.565Z",
      "hits": 1,
      "symptom": "Native drain blocks after a completion notification although its wait budget is zero",
      "cause": "The notification is sent before thread termination; immediate join waits for unconfirmed retirement",
      "fix": "Retain notified thread handles until is_finished, then join; preserve pending handles across drain timeouts and reproduce with a paused post-notification thread",
      "tags": [
        "concurrency",
        "drain",
        "threads"
      ],
      "source": ".pa/report_native_drain.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 13,
        "votes": 0
      }
    },
    {
      "id": "L-0ae4de6822",
      "createdAt": "2026-09-12T23:11:43.988Z",
      "lastSeen": "2026-09-12T23:11:43.988Z",
      "hits": 1,
      "symptom": "Successful Tauri MSI build omits pa.exe while capture host is present",
      "cause": "Implicit multi-bin discovery produced an incomplete MSI inventory with CLI 2.11.4",
      "fix": "Declare all Cargo binary targets with explicit paths and inspect the actual MSI File table before publication",
      "tags": [
        "msi",
        "packaging",
        "tauri"
      ],
      "source": ".pa/report_msi_inventory.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 13,
        "votes": 0
      }
    },
    {
      "id": "L-021c8e1116",
      "createdAt": "2026-09-16T18:48:22.226Z",
      "lastSeen": "2026-09-16T18:48:22.226Z",
      "hits": 1,
      "symptom": "Kimi-Worker: Submit-Guard schreibt den Auftrag, sieht kein Echo, drei Rewrites, Eskalation needs_you nach 24 s; Composer zeigt den Text erst, wenn jemand die Terminal-Ansicht oeffnet",
      "cause": "Kimi Code 0.43 fragt als allererstes ESC[6n (Cursor-Position) und blockiert seinen gesamten Start bis zur Antwort (Roh-PTY-Capture: 4 Bytes, dann 200 s Stille). ConPTY antwortet nicht, der Reader-Thread der App antwortete nicht; nur ein angehaengtes xterm.js antwortete. Die Stille-Heuristik des Guards las '4 Bytes, dann ruhig' als settled und tippte in einen blockierten Prozess",
      "fix": "pty.rs: Reader-Thread beantwortet ESC[6n selbst mit ESC[1;1R (CursorReportScanner, chunk-uebergreifend); submit_guard.rs: ohne Readiness-Marker gilt nur sichtbarer Inhalt als Startausgabe. Fixture src-tauri/testdata/pty/kimi-0.43.0-composer-2026-09-16.raw; Bericht .pa/report_kimi_raw_stream_2026-09-16.md",
      "tags": [
        "conpty",
        "kimi",
        "nt-17",
        "pty",
        "submit-guard"
      ],
      "source": ".pa/report_kimi_raw_stream_2026-09-16.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 9,
        "votes": 0
      }
    },
    {
      "id": "L-1102db326f",
      "createdAt": "2026-09-22T00:05:10.902Z",
      "lastSeen": "2026-09-22T00:05:10.902Z",
      "hits": 1,
      "symptom": "HQ post-merge skips retained snapshots or overwrites local edits",
      "cause": "Keep-ours driver leaves no output diff; generator wrote directly into possibly dirty outputs and reads lessons from its output directory",
      "fix": "Preserve dirty outputs; regenerate every merge into a temp directory seeded with lessons; validate both artifacts before replacing; ignore only top-level metadata",
      "tags": [
        "git",
        "hq",
        "regression"
      ],
      "source": ".pa/report_pr38_followup_2026-09-22.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 4,
        "votes": 0
      }
    },
    {
      "id": "L-8b092b4358",
      "createdAt": "2026-09-23T16:31:25.019Z",
      "lastSeen": "2026-09-23T16:31:25.019Z",
      "hits": 1,
      "symptom": "New schema migration fails existing old-schema rewind fixtures with table already exists",
      "cause": "Fixtures create latest schema then lower user_version without removing newly introduced schema objects; diagnosis schema constant also lagged",
      "fix": "Drop new child and parent tables only in isolated rewind fixtures, update diagnosis constant, retain strict production migration; rerun all seven failed cases and full prepush",
      "tags": [
        "migration",
        "schema",
        "tests"
      ],
      "source": ".pa/report_df05_fixture_repair.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 2,
        "votes": 0
      }
    }
  ],
  "lessonStats": {
    "count": 40,
    "hits": 40,
    "tags": [
      {
        "tag": "concurrency",
        "count": 7
      },
      {
        "tag": "git",
        "count": 5
      },
      {
        "tag": "evidence",
        "count": 4
      },
      {
        "tag": "hq",
        "count": 4
      },
      {
        "tag": "sqlite",
        "count": 4
      },
      {
        "tag": "updater",
        "count": 4
      },
      {
        "tag": "ci",
        "count": 3
      },
      {
        "tag": "migration",
        "count": 3
      },
      {
        "tag": "recovery",
        "count": 3
      },
      {
        "tag": "regression",
        "count": 3
      },
      {
        "tag": "sessions",
        "count": 3
      },
      {
        "tag": "tests",
        "count": 3
      },
      {
        "tag": "verification",
        "count": 3
      },
      {
        "tag": "windows",
        "count": 3
      },
      {
        "tag": "workers",
        "count": 3
      },
      {
        "tag": "cargo",
        "count": 2
      },
      {
        "tag": "configuration",
        "count": 2
      },
      {
        "tag": "dev-hq",
        "count": 2
      },
      {
        "tag": "identity",
        "count": 2
      },
      {
        "tag": "ownership",
        "count": 2
      },
      {
        "tag": "profiles",
        "count": 2
      },
      {
        "tag": "shell",
        "count": 2
      },
      {
        "tag": "test-first",
        "count": 2
      },
      {
        "tag": "worktree",
        "count": 2
      },
      {
        "tag": "bash",
        "count": 1
      },
      {
        "tag": "budgets",
        "count": 1
      },
      {
        "tag": "build",
        "count": 1
      },
      {
        "tag": "candidate",
        "count": 1
      },
      {
        "tag": "capacity",
        "count": 1
      },
      {
        "tag": "capture",
        "count": 1
      },
      {
        "tag": "chromium",
        "count": 1
      },
      {
        "tag": "cleanup",
        "count": 1
      },
      {
        "tag": "conpty",
        "count": 1
      },
      {
        "tag": "continuous",
        "count": 1
      },
      {
        "tag": "daemon",
        "count": 1
      },
      {
        "tag": "drain",
        "count": 1
      },
      {
        "tag": "filesystem",
        "count": 1
      },
      {
        "tag": "frontend",
        "count": 1
      },
      {
        "tag": "gates",
        "count": 1
      },
      {
        "tag": "kimi",
        "count": 1
      },
      {
        "tag": "linux",
        "count": 1
      },
      {
        "tag": "msi",
        "count": 1
      },
      {
        "tag": "notifications",
        "count": 1
      },
      {
        "tag": "nt-17",
        "count": 1
      },
      {
        "tag": "omniroute",
        "count": 1
      },
      {
        "tag": "ops",
        "count": 1
      },
      {
        "tag": "orchestrator",
        "count": 1
      },
      {
        "tag": "packaging",
        "count": 1
      },
      {
        "tag": "pipefail",
        "count": 1
      },
      {
        "tag": "playwright",
        "count": 1
      },
      {
        "tag": "polling",
        "count": 1
      },
      {
        "tag": "pre-commit",
        "count": 1
      },
      {
        "tag": "preflight",
        "count": 1
      },
      {
        "tag": "process",
        "count": 1
      },
      {
        "tag": "pty",
        "count": 1
      },
      {
        "tag": "red-first",
        "count": 1
      },
      {
        "tag": "release",
        "count": 1
      },
      {
        "tag": "restore",
        "count": 1
      },
      {
        "tag": "retries",
        "count": 1
      },
      {
        "tag": "review",
        "count": 1
      },
      {
        "tag": "routing",
        "count": 1
      },
      {
        "tag": "runs",
        "count": 1
      },
      {
        "tag": "rust",
        "count": 1
      },
      {
        "tag": "schema",
        "count": 1
      },
      {
        "tag": "stand",
        "count": 1
      },
      {
        "tag": "status",
        "count": 1
      },
      {
        "tag": "submit-guard",
        "count": 1
      },
      {
        "tag": "supervisor",
        "count": 1
      },
      {
        "tag": "tauri",
        "count": 1
      },
      {
        "tag": "threads",
        "count": 1
      },
      {
        "tag": "tokens",
        "count": 1
      },
      {
        "tag": "usage",
        "count": 1
      },
      {
        "tag": "vite",
        "count": 1
      }
    ],
    "recent": [
      "L-8b092b4358",
      "L-1102db326f",
      "L-021c8e1116",
      "L-0ae4de6822",
      "L-9a2196f42f"
    ]
  }
};
