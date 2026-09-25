window.HQ_DATA = {
  "generatedAt": "2026-09-24T21:57:52.543Z",
  "commit": "5032d8a",
  "dirty": true,
  "sources": [
    {
      "path": "STAND.md",
      "sha256": "084fe007caf652eea3570da77e030ca241274b1e73c301ccb9f43c169168bb54"
    },
    {
      "path": "docs/PLAN.md",
      "sha256": "eab5a76a32240f3b48540e5847039492bba40aae58bd050501f2d23fe7dedb62"
    },
    {
      "path": ".pa/task_f_core3_delivery.md",
      "sha256": "5f8b67e3368c2011872aa4548530a5e503d0ed21cc820e8cd191e9ad176c40f3"
    },
    {
      "path": ".pa/task_w1-05.md",
      "sha256": "45ebb9aaee6612a77ad9c5a63d094aa1d62ab19239e231685934bf761060e9b3"
    },
    {
      "path": ".pa/task_w1-10.md",
      "sha256": "330e1b89c7b490cec769cc3f559730d36fa5b5205c02000370a3e91aadf4a758"
    },
    {
      "path": ".pa/task_w1-12.md",
      "sha256": "85ccea99e558d04153bb05964ba0c1712c974da020ca251e708a8ca5366c1fe2"
    },
    {
      "path": ".pa/task_w1-17.md",
      "sha256": "82385478c94ddf5bf8f14a399c4a06d027adcd865a04645b533b14965e4750f9"
    },
    {
      "path": ".pa/task_w1-20.md",
      "sha256": "f69367fc49f659b82a655830a7647f03e119c3bf51918132b04def25ba2ac46c"
    },
    {
      "path": ".pa/task_ollama_worker_adapter.md",
      "sha256": "9f29d94ba3884c5eed7fc72af9b43bb6da657e4eb43ce9e14e2d76da143a3287"
    },
    {
      "path": ".pa/task_hq2-02.md",
      "sha256": "5eac3339f7e21f87d1547c800d7e2e672a36837d31d542368c86fda4abc20b35"
    }
  ],
  "warnings": [],
  "nextGrip": [
    {
      "text": "Die laufenden Pakete abschließen (Tabelle oben); die Queue mergt fertige PRs selbst. Danach die Reihenfolge je Lane aus `docs/MASTERPLAN.md` („Worker-Struktur\") ziehen; DF-07d (visueller PASS) braucht keinen Build-Slot.",
      "source": "STAND.md#Nächster Griff"
    },
    {
      "text": "W1-05b: sichere Cancel-Regel für `dispatched` implementieren und testen, Prozessende verifizieren, doppelte Neueinreihung verhindern; die produktive Queue bis dahin nicht durch einen App-Start dispatchen.",
      "source": "STAND.md#Nächster Griff"
    },
    {
      "text": "Nutzerentscheidungen einholen, die Pakete blockieren: Schnitt W4-03a (Journal-Teil ohne Aktivierung, Voraussetzung für W5-03), Grenzwerte für W2-08b, Secrets aus der Repo-Ebene in geschützte Environments, Release-Frage für die Arbeit nach v1.4.1 (Liste in `docs/PLAN.md` §5).",
      "source": "STAND.md#Nächster Griff"
    }
  ],
  "specs": [
    {
      "file": ".pa/task_f_core3_delivery.md",
      "title": "W1-03e/f: F-CORE-3 Rest B.3/C (C-3 selbst erledigt, PR #72)",
      "packet": "W1-03e/f: F-CORE-3 Rest B.3/C (C-3 selbst erledigt, PR #72)",
      "lane": "parallel",
      "serialOwner": null,
      "status": "aktiv",
      "source": "STAND.md#Aktive Specs",
      "startable": true
    },
    {
      "file": ".pa/task_w1-05.md",
      "title": "W1-05b: Queue-Abnahmerest, Cancel-Regel für `dispatched`",
      "packet": "W1-05b: Queue-Abnahmerest, Cancel-Regel für `dispatched`",
      "lane": "parallel",
      "serialOwner": null,
      "status": "aktiv",
      "source": "STAND.md#Aktive Specs",
      "startable": true
    },
    {
      "file": ".pa/task_w1-10.md",
      "title": "W1-10: HQ-Stylesheet",
      "packet": "W1-10: HQ-Stylesheet",
      "lane": "parallel",
      "serialOwner": null,
      "status": "aktiv",
      "source": "STAND.md#Aktive Specs",
      "startable": true
    },
    {
      "file": ".pa/task_w1-12.md",
      "title": "W1-12: Design-Reste",
      "packet": "W1-12: Design-Reste",
      "lane": "parallel",
      "serialOwner": null,
      "status": "aktiv",
      "source": "STAND.md#Aktive Specs",
      "startable": true
    },
    {
      "file": ".pa/task_w1-17.md",
      "title": "W1-17: HQ-Parser auf diesen Plan umstellen",
      "packet": "W1-17: HQ-Parser auf diesen Plan umstellen",
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
      "file": ".pa/task_ollama_worker_adapter.md",
      "title": "W2-09b: DeepSeek V4 Flash Cloud ueber OpenCode; CLI-Probe belegt, TUI/Worker offen",
      "packet": "W2-09b: DeepSeek V4 Flash Cloud ueber OpenCode; CLI-Probe belegt, TUI/Worker offen",
      "lane": "serial",
      "serialOwner": null,
      "status": "aktiv",
      "source": "STAND.md#Aktive Specs",
      "startable": true
    },
    {
      "file": ".pa/task_hq2-02.md",
      "title": "HQ2-02: Konzeptdemo, Inhalt über #70 auf main; Nutzer- und visuelle Abnahme offen",
      "packet": "HQ2-02: Konzeptdemo, Inhalt über #70 auf main; Nutzer- und visuelle Abnahme offen",
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
      "text": "SQLite-Lastklasse (`database is locked` / `pool timed out`), mit #77/#85 bearbeitet, beobachten.",
      "klass": "CLAIM",
      "source": "STAND.md",
      "packet": null,
      "serialOwner": null
    },
    {
      "id": "KI-25",
      "text": "Linux-Prozessgruppen-Test in `testgate.rs`, einmal rot, Ursache offen (W1-29).",
      "klass": "CLAIM",
      "source": "STAND.md",
      "packet": null,
      "serialOwner": null
    },
    {
      "id": "KI-26",
      "text": "Windows-PTY-Argumenttest, Kaltstart-Fix seit PR #104, beobachten.",
      "klass": "CLAIM",
      "source": "STAND.md",
      "packet": null,
      "serialOwner": null
    },
    {
      "id": "KI-27",
      "text": "`exited_undelivered` lässt Token-Reservierung und Delivery `started` (DF-15b, Produktfrage).",
      "klass": "CLAIM",
      "source": "STAND.md",
      "packet": null,
      "serialOwner": null
    },
    {
      "id": "KI-28",
      "text": "Capture-Host bleibt Windows-only (Entscheidung 16.09.).",
      "klass": "CLAIM",
      "source": "STAND.md",
      "packet": null,
      "serialOwner": null
    },
    {
      "id": "KI-29",
      "text": "F-SEC-4-Restrisiko des OmniRoute-Key-Syncs bei eingeschaltetem Opt-in.",
      "klass": "CLAIM",
      "source": "STAND.md",
      "packet": null,
      "serialOwner": null
    },
    {
      "id": "KI-20",
      "text": "doppelte Antwort auf `ESC[6n`, braucht eine Entscheidung (W1-27).",
      "klass": "CLAIM",
      "source": "STAND.md",
      "packet": null,
      "serialOwner": null
    }
  ],
  "packages": [
    {
      "id": "F0",
      "dependsOn": [],
      "lane": "serial",
      "current": "done",
      "source": "docs/PLAN.md"
    },
    {
      "id": "F1",
      "dependsOn": [
        "F0"
      ],
      "lane": "serial",
      "current": "waiting",
      "source": "docs/PLAN.md"
    },
    {
      "id": "F2",
      "dependsOn": [
        "F0"
      ],
      "lane": "parallel",
      "current": "waiting",
      "source": "docs/PLAN.md"
    },
    {
      "id": "F3",
      "dependsOn": [
        "F1",
        "F2"
      ],
      "lane": "parallel",
      "current": "waiting",
      "source": "docs/PLAN.md"
    },
    {
      "id": "F4",
      "dependsOn": [
        "F1"
      ],
      "lane": "serial",
      "current": "waiting",
      "source": "docs/PLAN.md"
    },
    {
      "id": "F5",
      "dependsOn": [
        "F4"
      ],
      "lane": "serial",
      "current": "waiting",
      "source": "docs/PLAN.md"
    },
    {
      "id": "F6-UI",
      "dependsOn": [
        "F2"
      ],
      "lane": "parallel",
      "current": "waiting",
      "source": "docs/PLAN.md"
    },
    {
      "id": "F6-Attribution",
      "dependsOn": [
        "F4"
      ],
      "lane": "serial",
      "current": "waiting",
      "source": "docs/PLAN.md"
    },
    {
      "id": "F7",
      "dependsOn": [],
      "lane": "incremental",
      "current": "waiting",
      "source": "docs/PLAN.md"
    },
    {
      "id": "F8",
      "dependsOn": [
        "F5",
        "F6-UI",
        "F3",
        "F6-Attribution"
      ],
      "lane": "parallel",
      "current": "waiting",
      "source": "docs/PLAN.md"
    }
  ],
  "next": [
    {
      "packet": "Die laufenden Pakete abschließen (Tabelle oben);",
      "why": "Die laufenden Pakete abschließen (Tabelle oben); die Queue mergt fertige PRs selbst. Danach die Reihenfolge je Lane aus `docs/MASTERPLAN.md` („Worker-Struktur\") ziehen; DF-07d (visueller PASS) braucht keinen Build-Slot.",
      "source": "STAND.md#Nächster Griff",
      "lane": "parallel",
      "serialOwner": null,
      "doneWhen": "Die laufenden Pakete abschließen (Tabelle oben); die Queue mergt fertige PRs selbst. Danach die Reihenfolge je Lane aus `docs/MASTERPLAN.md` („Worker-Struktur\") ziehen; DF-07d (visueller PASS) braucht keinen Build-Slot.",
      "startable": true
    },
    {
      "packet": "W1-05b: sichere Cancel-Regel für `dispatched` im",
      "why": "W1-05b: sichere Cancel-Regel für `dispatched` implementieren und testen, Prozessende verifizieren, doppelte Neueinreihung verhindern; die produktive Queue bis dahin nicht durch einen App-Start dispatchen.",
      "source": "STAND.md#Nächster Griff",
      "lane": "parallel",
      "serialOwner": null,
      "doneWhen": "W1-05b: sichere Cancel-Regel für `dispatched` implementieren und testen, Prozessende verifizieren, doppelte Neueinreihung verhindern; die produktive Queue bis dahin nicht durch einen App-Start dispatchen.",
      "startable": true
    },
    {
      "packet": "Nutzerentscheidungen einholen, die Pakete blocki",
      "why": "Nutzerentscheidungen einholen, die Pakete blockieren: Schnitt W4-03a (Journal-Teil ohne Aktivierung, Voraussetzung für W5-03), Grenzwerte für W2-08b, Secrets aus der Repo-Ebene in geschützte Environments, Release-Frage für die Arbeit nach v1.4.1 (Liste in `docs/PLAN.md` §5).",
      "source": "STAND.md#Nächster Griff",
      "lane": "parallel",
      "serialOwner": null,
      "doneWhen": "Nutzerentscheidungen einholen, die Pakete blockieren: Schnitt W4-03a (Journal-Teil ohne Aktivierung, Voraussetzung für W5-03), Grenzwerte für W2-08b, Secrets aus der Repo-Ebene in geschützte Environments, Release-Frage für die Arbeit nach v1.4.1 (Liste in `docs/PLAN.md` §5).",
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
        "ageDays": 15,
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
        "ageDays": 15,
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
        "ageDays": 15,
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
        "ageDays": 15,
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
        "ageDays": 15,
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
        "ageDays": 15,
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
        "ageDays": 15,
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
        "ageDays": 15,
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
        "ageDays": 15,
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
        "ageDays": 15,
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
        "ageDays": 15,
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
        "ageDays": 15,
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
        "ageDays": 15,
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
        "ageDays": 15,
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
        "ageDays": 15,
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
        "ageDays": 15,
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
        "ageDays": 14,
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
        "ageDays": 14,
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
        "ageDays": 13,
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
        "ageDays": 13,
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
        "ageDays": 13,
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
        "ageDays": 13,
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
        "ageDays": 13,
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
        "ageDays": 13,
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
        "ageDays": 13,
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
        "ageDays": 13,
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
        "ageDays": 13,
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
        "ageDays": 13,
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
        "ageDays": 12,
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
        "ageDays": 12,
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
        "ageDays": 12,
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
        "ageDays": 12,
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
        "ageDays": 12,
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
        "ageDays": 12,
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
        "ageDays": 12,
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
        "ageDays": 11,
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
        "ageDays": 11,
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
        "ageDays": 8,
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
        "ageDays": 2,
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
        "ageDays": 1,
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
