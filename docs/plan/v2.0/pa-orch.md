# V2-O0 — External orchestration inventory

Observed by read-only source inspection on 2026-10-13; repository base
`ec656b3`. Scope: the server's `~/pa-orch/`, its state layout, and the
repository helpers it delegates to. This fulfils the inventory step in
[the v2.0 plan](plan.md), section 3.1; the function names come from
[the inventory](inventory.md). It does not implement or enable a scheduler.

The tables describe code, not a measured successful run. Defaults are not
observations of the running service's configuration, provider availability,
model identity, quota, or capacity. No external script was executed, copied
into Git, modified, installed, or removed. Private values and job contents
are deliberately omitted. External paths below use `~/pa-orch/<file>`;
repository paths are relative to the checkout.

## Source boundaries

- **Server source:** `~/pa-orch/autopilot.sh`, `run-job.sh`,
  `hold-feeder.sh`, `server-common.txt` and `pa-autopilot.service`.
- **Historical PC source:** `~/pa-orch/critique-2026-10-04/autopilot.sh`,
  `pipeline.py` and `run-job-local.sh`. These are review snapshots, not
  evidence of the current PC installation. The pipeline header names a
  three-minute `pipeline.sh` caller; that caller was not present here.
- **Repository source:** `scripts/dev/start-check.mjs` and
  `.pa/review_transport.py` at the base above.
- Top-level `*.before-*.sh` files are earlier autopilot/runner versions,
  not additional functions. `install-tools-20261004.sh`, `sccache-probe.sh`
  and `tmp-sweeper.sh` are auxiliary scripts, listed separately below.
- No standalone server `watchdog.sh` or Chief-of-Staff script was found.
  The watchdog is implemented inside `autopilot.sh`; the PC snapshot has
  an `officer_tick` hook, but its referenced `officer-prompt.md` is absent.
  There is no top-level server `pipeline.py`; only the historical copy.

## Function inventory and destination

Destinations are the existing packages in [the plan](plan.md), sections
3.2, 3.5, 3.9 and 4a. They identify responsibility, not completed migration.
Line numbers refer to the inspected sources; snapshot rows are explicitly
marked. Each source shorthand below is rooted at `~/pa-orch/` unless it is
prefixed with `repo:`.

| Function | Script / source | Inputs | Outputs / effects described by source | Execution location | Plan destination |
|---|---|---|---|---|---|
| Orchestrator: dispatch / autopilot | `autopilot.sh:48–69,93–98` | Sorted `queue/*.job`; spec; provider block markers; memory, disk and occupied slots | Moves queue record to `done/started-*`; writes `jobs/<label>.job` and `.pgid`; starts runner; updates `status.txt` and `events.log` | Linux server; service file invokes the loop | V2-RUN-2 with V2-B3/B4/B5; job state becomes V2-RUN-1 |
| Chief of Staff: attention / handover | Historical `critique-2026-10-04/autopilot.sh:118,148–166`; `pipeline.py:241–276` | Idle counters, orchestration activity, alarms; completed read-only job events/specs/logs | Idle alarm and officer invocation; fetches read-only results into `research/<label>.result.md`. Officer decisions/filtering are unverified without its prompt | PC according to snapshot; current deployment unverified | V2-CORE-AT; observation and result collection integrate with V2-RUN-2 |
| Wachhund: completion and stall detection | `autopilot.sh:20–47,74–89` | Final log line, log/file/commit timestamps, processes whose working directory is the worktree, start time, remote branch and PR existence | Records completion/alarm; on stall sends TERM then KILL to process group, archives job, creates continuation spec/job; stops requeueing at the `-r-r` suffix | Linux server, inside autopilot | V2-B22 for detection/reporting; V2-RUN-1/2 for outcomes and controlled continuation |
| Pipeline: PR progression | Historical `critique-2026-10-04/pipeline.py:112–207,337–362` | GitHub PR head, files, checks, labels, draft state, report/disposition text; queued/running job names | Chooses CI-fix, conflict or review job, waits, or calls queue request; stamps work per PR/step/head | PC according to snapshot; no current server implementation observed | V2-RUN-1 state/evidence, V2-RUN-3 review and proposals, V2-RUN-4 delivery |
| Pipeline: review classification and dispatch | Historical `critique-2026-10-04/pipeline.py:21–25,65–89,168–204` | Changed paths, branch-derived author family, textual disposition and open-high checks | Tier A/B/C; reviewer job/spec; escalation when a high finding remains open | PC snapshot; sends work to PC/server lanes | V2-B9 classification/evidence, V2-B10 family rule, V2-RUN-3 disposition |
| Pipeline: queue delivery | Historical `critique-2026-10-04/pipeline.py:219–230` | Eligible PR, head stamp, downstream dependency check | GitHub queue comment, optional priority label, local stamp | PC snapshot calling GitHub | V2-MQ1 and V2-RUN-4; no direct-merge replacement |
| Startprüfung | `autopilot.sh:10–19,91–96`; `server-common.txt:9`; `repo:scripts/dev/start-check.mjs` | Server memory/disk/job counts; helper reads RAM, cargo process tree, optional usage JSON/log age and dependency state | Admission or waiting; helper prints checks and exits 0/1/2/3. Worker brief requires bounded waiting on server resource contention | Admission on server; helper in worker checkout (also supports PC) | V2-B3 feeds V2-RUN-2; observed usage informs V2-CAP-1 |
| Server-Ort and slots | `pa-autopilot.service:6–15`; `autopilot.sh:17–19,62–66`; `run-job.sh:25–44` | Branch, label, selected slot/provider; worktree registry; environment overrides | Reuses/creates worktree; per-slot Cargo target, one Cargo build job; process group; `WT` recorded in job | Linux server; source default is four server slots plus three cloud slots, not a live capacity measurement | V2-LOC-0, V2-B5, V2-B6a/B6b and V2-DOC-SRV; capacity evidence V2-CAP-1 |
| Hold-feeder / ready reserve | `hold-feeder.sh:4–11` | `hold/ready/*.job` sorted by name, running + queued counts, `FEEDER_MAX` (default 8) | Under `hold-feeder.lock`, moves ready records into queue and logs each move. Dependencies are cleared by the coordinator before promotion | Linux server; caller/schedule not verified | V2-B4 readiness, V2-EX-4 reserve, V2-RUN-2 offers the next task |
| Run-job: worker execution and result | `run-job.sh:6–9,25–59,91–114`; `server-common.txt` | Label/spec/branch/slot/model/provider arguments; optional effort suffix; common worker brief | Worktree setup under Git lock, missing Node dependencies from lockfile, provider CLI invocation, `logs/<label>.log` ending in `JOB-EXIT=<code>` | Server worktree; provider branches include Codex, Claude, OpenCode, Cursor and a separately configured Claude API path | V2-RUN-2 runner and V2-B6b; provider scope/authorization stays with V2-CLI-0 and the user |
| Run-job: cloud handoff | `run-job.sh:11–24,60–90` | Expected base SHA, remote branch SHA, prior cloud task ID, task status/diff, local capacity | Submits or resumes a cloud task; records `CLOUD_TASK`; acquires local permit and `PHASE=local` before applying diff and local completion | Provider cloud, then Linux server; source capability only | V2-LOC-0 and V2-B6c; V2-RUN-1 evidence and V2-RUN-2 execution |
| Provider block / rerouting | `autopilot.sh:48–59`; `run-job.sh:91–103` | `blocked/<provider>`; provider log limit indication | Reroutes blocked implementation jobs where allowed; does not reroute review jobs; OpenCode watcher writes `state/opencode-blocked` and returns 75 | Linux server; consumption of the separate state marker not established | V2-B1/B2a/B2b plus V2-RUN-2; preserve review-family constraints in V2-B10 |
| Review transport | `repo:.pa/review_transport.py:58–74,231–330`; historical pipeline review brief | Prompt file, output directory, label, optional author; numbered reviewer environment configuration | Up to two concurrent requests; one Markdown protocol per reviewer with prompt hash, time, requested/reported model and outcome; exit 0 all answered, 1 missing verdict, 2 usage/configuration error | Where caller runs it; historical tier-A caller targets PC, repository helper is also present on server | V2-RUN-3 transports verdicts; V2-B9/B10 bind candidate and independence |
| PC/server bridge and dependency maintenance | Historical `critique-2026-10-04/autopilot.sh:41–66`; `pipeline.py:232–239,281–335` | PC queue/dependency fields, server status/events, replacement-PR map, prepared reserve | Copies specs/jobs to server, retrieves status/events, rewrites replacement/self-dependency records, feeds reserve | PC snapshot over SSH to server; no connection attempted | V2-B4/B6a/B6b, V2-EX-4 and V2-RUN-2 |

## State and handoff layout

The directory inspection found the following server layout. File formats
come from their readers/writers above; private record values were not used.
`state/` is not the entire runtime store: jobs and locks also live beside it.

| Path under `~/pa-orch/` | Role / ownership |
|---|---|
| `queue/*.job` | Pending shell assignments: `LABEL`, `SPEC`, `BRANCH`, optional `MODEL`, `PROVIDER`, `BASE_SHA`. Autopilot sources them; they are executable input, not a typed data format. |
| `jobs/*.job`, `jobs/*.pgid` | Active job fields add `SLOT`, `STARTED`, `WT`, and optionally `CLOUD_TASK`, `PHASE`; process-group reference is separate. Presence is not proof of process liveness. |
| `done/` | Started/completed/stalled/bad/not-rerouted records; `run-job.sh` consults predecessor stalled records to resume cloud tasks. |
| `hold/`, `hold/ready/` | Coordinator-held work and explicitly promoted ready jobs; the feeder does not resolve dependencies itself. |
| `blocked/` | Autopilot provider markers; separate from `state/opencode-blocked`. |
| `specs/`, `logs/`, `reports/`, `research/`, `review-evidence/` | Task text, execution output and collected evidence; no payloads are copied into this inventory. |
| `status.txt`, `events.log`, `disk.alarm` | Pollable status snapshot, append-only events and disk-alarm marker. Status is replaced through a temporary file. |
| `git.lock`, `permit.lock`, `hold-feeder.lock` | Serialize Git operations, local slot admission and feeder execution respectively. |
| `state/` | Observed six files, no subdirectories: one provider-block marker, one coordinator override text, three cleanup scripts and one release-tag script. |

The six observed state names are `opencode-blocked`,
`root-common-overrides.txt`, `root-cleanup-targets.sh`, `root-cleanup-tmp.sh`,
`root-cleanup-wt.sh`, and `root-tag-v163.sh`. These maintenance artifacts
are not a typed workflow database. In particular, the historical pipeline's
`state/pipeline/`, `state/reserve/`, `state/server-jobs.txt` and
`state/pr-replaced.tsv` were not present in this server state directory.
V2-RUN-1 owns the replacement state model, with persistence/routing in the
plan's ST-C1/API-C/MN-C packages; V2-O0 changes none of those contracts.

## Auxiliary operations, not workflow steps

| Function | Source | Inputs → outputs | Location | Existing package boundary |
|---|---|---|---|---|
| Tool provisioning | `~/pa-orch/install-tools-20261004.sh` | Package/release downloads → installed tools and version output | Server setup script | V2-DOC-SRV documents setup; installation is not part of V2-RUN and was not run |
| Build-cache experiment | `~/pa-orch/sccache-probe.sh` | Isolated worktree/targets → cold/warm comparison output and cache cleanup | Server experiment | V2-CAP-1 may consume measured evidence; no result claimed here |
| Temporary-file cleanup | `~/pa-orch/tmp-sweeper.sh`, `state/root-cleanup-tmp.sh` | Age/ownership/prefix filters or age/ownership → deletion and inode/event output | Server maintenance | V2-HYG-1 reports hygiene; deletion remains separately authorized |
| Worktree/build-cache cleanup | `~/pa-orch/state/root-cleanup-targets.sh`, `root-cleanup-wt.sh` | Job/worktree registry, Git cleanliness and remote containment → cache deletion or worktree report/removal | Server maintenance | V2-HYG-1 reporting only; not automatic V2-RUN delivery |
| Release tagging | `~/pa-orch/state/root-tag-v163.sh` | Fixed release candidate → tag push and remote verification | Server maintenance | V2-REL retains user release approval; no release performed |

## Migration constraints and remaining evidence

1. Current scripts can autonomously start/restart jobs and request queueing.
   V2-RUN-2 requires a user click; V2-RUN-3 makes CI/conflict/requeue work a
   confirmed proposal. Inventorying existing behavior does not authorize it
   in the app. Continuous mode remains disabled under the plan.
2. The historical pipeline infers evidence from PR text/labels and stamps a
   shortened head SHA. It is not proof of the V2-B9/RUN-1 typed evidence
   contract. The transport's successful text response is also not proof of
   review independence, complete disposition, or candidate acceptance.
3. Autopilot watchdog defaults are 15 minutes idle and 150 minutes total,
   with 90 extra minutes for cloud jobs. Its file/process activity heuristic
   and TERM/KILL calls do not prove that a stopped worker has exited. B22 and
   RUN-2 need tested liveness, bounded continuation and one notification.
4. Autopilot memory/disk/slot admission does not invoke the repository start
   checker. The common brief tells workers to use it. The helper cannot
   observe the actual model and skips quota/log checks without inputs.
5. Root must supply the current PC pipeline and officer prompt to close the
   Chief-of-Staff and pipeline gaps. Snapshot imports `ki30` and `failover`
   were not present alongside the snapshot; their behavior is not verified.
   This inventory alone does not clear the dependent packages for dispatch.
6. No SSH trust configuration, service deployment/overrides, feeder schedule,
   provider execution, restart, quota routing or successful delivery was
   tested. No performance or capacity claim follows from source defaults.
   V2-DOG-1 still requires per-rule tests, a week of comparison and approval
   before replacing external orchestration; the rollback path stays intact.

## Recheck anchors

Use read-only file listing and numbered source reads, then `sha256sum` on
the relevant external file. Do not source a `.job` file or execute a script
to inspect it. Selected SHA-256 digests observed on 2026-10-13:

| Source under `~/pa-orch/` | SHA-256 |
|---|---|
| `autopilot.sh` | `c90669d9cc62bfd55dee2e8d93037dc2ec0139348eafc779acfa0c35f8c72dc3` |
| `run-job.sh` | `c3e79d0786467fc4a0e9673e3ec014c5c75b38b113f65ddf2f88bbbb3de32595` |
| `hold-feeder.sh` | `2b3f6572fdf985cd6d8a72491a252d61ef9c800c4b6095c90d3eb2af3c023cca` |
| `critique-2026-10-04/pipeline.py` | `1f9520fdf4fd42c18ff0b9d1ebbbe9bbe9cbf42d443edd2d1824da5fc1caa6d7` |
| `critique-2026-10-04/autopilot.sh` | `9492ad2493ced1536ed8a1ee3b08ff04385819e3ec9b49d2d3a50bbf8e02585b` |

No source or dependency was imported, so this documentation adds no
third-party runtime or license obligation.
