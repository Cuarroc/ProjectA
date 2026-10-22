# A4 — side-app stop safety evidence

## Claim and bounds

A4 is closed within the bounds recorded in [acceptance §7](../../../PROJECTA_ABNAHME.md#7-external-acceptance-follow-up-2026-10-21): no automatic redispatch of the four observed `dispatched` rows at normal startup/retry, and no matching executable server job in the inspected scope.
This is dated source/state evidence, not a new runtime experiment or a permanent cancellation guarantee. A human may manually respawn the two `exited` workers; installed binary ↔ source SHA remains UNKNOWN. No application, database, recovery, worker or scheduler action was performed for this publication.

## S1–S6: source-level proof

Pinned source: `213d29a3fd913cb668d4c45cc1cad0976f47c1dc` (historical A4 inspection); publication base: `4919341463c9f0b452193c116869fda0e5475ca2`. Paths in this table are repository-relative. Source summaries are interpretations, not verbatim excerpts. The original source-binding record hashes 17 files; each hash was rechecked with `git show <pinned-SHA>:<path>`.

| Proof | Pinned file:line | Bounded finding |
|---|---|---|
| S1 startup | `src-tauri/src/main.rs:3869`, `:3884`; `src-tauri/src/workers.rs:2958` | Reattachment precedes queue start; only ordinary `running` workers enter the reattach plan. These four exited/archived workers do not. |
| S2 dispatch/retry | `src-tauri/src/queue.rs:358`, `:413`, `:483`; `src-tauri/src/store.rs:2715`, `:2732` | Selection/claim requires `ready`; retries release only a still-`dispatching` claim. `dispatched` rows are excluded. |
| S3 interrupted claims | `src-tauri/src/store.rs:2773`, `:2806`, `:2819`; `src-tauri/src/queue.rs:728` | Recovery selects `dispatching`, then attributes a running worker or resets an orphan. The production ready-update caller finishes a newly enqueued entry, not an observed row. |
| S4 explicit respawn | `src-tauri/src/main.rs:1513`, `:1528`; `src-tauri/src/workers.rs:2554`, `:2572`, `:2590`, `:2707`; `src/App.tsx:618`; `src/screens/leitstand/AgentCard.tsx:62` | Archived ordinary workers are refused; exited ordinary workers may pass status checks and spawn after other guards. An explicit UI/command path remains. |
| S5 update recovery | `src-tauri/src/delivery_recovery/startup.rs:24`, `:43`; `src-tauri/src/delivery_recovery/restore.rs:16`, `:28`, `:38` | Missing journal opens normally; an authorized recovery may restore a verified older DB before opening. Current rows alone cannot prove post-restore states. |
| S6 continuous input | `src-tauri/src/workers/scheduler.rs:13`, `:31`, `:41`, `:49`; `src-tauri/src/workers/activation.rs:36`; `src-tauri/src/store/development_launches.rs:443` | Permit-gated continuous tasks are a separate input domain, not these task-queue rows; production activation evidence is locked. Development reconciliation updates development runs. |

Original source command logs are identified in the manifest below. `all-task-queue-references` exited 2 because the guessed `src-tauri/migrations` directory did not exist; the corrected full-source `task-queue-corrected` search exited 0. A failed lookup is not absence evidence.

## PC queue and worker observations

Queue/link/status snapshot: `2026-10-21T18:01:55.076765+00:00`; method (verbatim): `PC com.projecta.dev/projecta.db read-only transaction; no saved native DB connection (db_list total0)`.
Worker kind/status recheck: `2026-10-21T18:25:10.476873+00:00`; method (verbatim): `SQLite URI mode=ro; query_only; single read transaction; no schema/state mutation`.
The later JSON does not contain queue rows: the table joins the earlier queue snapshot to the later worker recheck by worker ID, rather than claiming a simultaneous measurement. Project: `pj-1a15ab00ec1-1`.

| Queue ID | Queue status (18:01Z) | Linked worker | Kind / status (18:25Z) |
|---|---|---|---|
| `tq-1a15ab0d9f1-2` | `dispatched` | `wk-1a15ab14a14-3` | `worker` / `exited` |
| `tq-1a15ac0ff71-1` | `dispatched` | `wk-1a15ac13c7c-2` | `worker` / `archived` |
| `tq-1a15ac7c989-11` | `dispatched` | `wk-1a15ac81b22-12` | `worker` / `exited` |
| `tq-1a15aca6401-21` | `dispatched` | `wk-1a15aca65e8-22` | `worker` / `archived` |

At `2026-10-21T18:25:10.476873+00:00` both `development_launches` and `development_runs` exist: `totalRows=0`, `matchingWorkers=0` each. Database: `%USERPROFILE%\AppData\Roaming\com.projecta.dev\projecta.db`.
Update-recovery path checks from that observation (all `exists=false`; default Dev paths only, no inferred process environment override):

| Inspected PC path | Exists |
|---|---|
| `%USERPROFILE%\AppData\Roaming\com.projecta.dev\update-recovery.json` | `false` |
| `%USERPROFILE%\AppData\Roaming\com.projecta.dev\projecta.update-backup` | `false` |
| `%USERPROFILE%\AppData\Roaming\com.projecta.dev\projecta.db.bak-update` | `false` |
| `%USERPROFILE%\AppData\Local\com.projecta.dev\update-recovery.json` | `false` |
| `%USERPROFILE%\AppData\Local\com.projecta.dev\projecta.update-backup` | `false` |
| `%USERPROFILE%\AppData\Local\com.projecta.dev\projecta.db.bak-update` | `false` |

Two pre-migration backups were present (`projecta.db.pre-migration-1791837446829.bak`, 180224 bytes; `projecta.db.pre-migration-1791897334966.bak`, 598016 bytes). They are distinct from update-recovery backups; no restore was attempted.

## Installed binary is not a source binding

Observation: `2026-10-21T18:25:10.5705301Z`; method (verbatim): `Get-CimInstance Win32_Process, Name contains ProjectA; no launch`; `runningProcesses=[]` within that name-based query.
Installed file: `%USERPROFILE%\AppData\Local\ProjectA Dev\projecta.exe`, 25960448 bytes, file/product version `1.6.6`; SHA-256 `5F85FADDA7F925AFA85FBB900769532454C4CDB4B67EE3085C540D95F326302E`.
Updater metadata records `sha=4ccc4a05ec603daf7d6dff68ef07bde0796ff78d`. Version, file hash and updater metadata do not prove which source commit produced these bytes, nor identify a running process. This residual stays UNKNOWN.

## AgentsRoom ticket and triggers

Read-only MCP observation `2026-10-21T23:33:34Z`: `backlog_get(f5276c87)` and project-scoped `triggers_list`; supplied sanitized coordinator observation, not remeasured here.
Ticket `f5276c87-798c-4abb-889f-15e95c74f86c`: `status=pending`, `agentId=null`, `teamId=null`, `agentUnassigned=true`, `useWorktree=false`, `linkedTasks=0`; updated `2026-10-20T22:00:10.095Z`.
Cancellation intent does not itself establish scheduler semantics. These 14 observed triggers contain no `ship` kind and no board action; future/manual assignment or an external relay is outside this observation.

| Trigger ID | Kind | Enabled | Board action |
|---|---|---|---|
| `2e047c7e` | `schedule` | `false` | `null` |
| `b70dea65` | `schedule` | `false` | `null` |
| `3ca2843a` | `schedule` | `false` | `null` |
| `0e2c5399` | `webhook` | `true` | `null` |
| `2338f2a0` | `schedule` | `false` | `null` |
| `d0494251` | `manual` | `true` | `null` |
| `8f0263cf` | `manual` | `true` | `null` |
| `f49df3db` | `manual` | `true` | `null` |
| `879c3f1d` | `schedule` | `false` | `null` |
| `1ae2c7a3` | `manual` | `true` | `null` |
| `b0edba48` | `schedule` | `false` | `null` |
| `e3aec7c8` | `schedule` | `false` | `null` |
| `93ca00fb` | `schedule` | `true` | `null` |
| `96bb0f99` | `schedule` | `true` | `null` |

## Server inbound paths and corrected recursive search

Inspected, not executed: `~/pa-orch/autopilot.sh:59`–`:61` consumes `queue/*.job` and its `SPEC`; `:79`–`:92` monitors jobs and may enqueue stalled-job retries. `~/pa-orch/hold-feeder.sh:12` feeds `hold/ready/*.job`; `:13`–`:20` may create a planner when its pause marker is absent.
At the saved metadata observation, `hold/ready` and `state/auto-planner.pause` existed; `ref-app` did not. These are existence checks, not an enduring global stop.
Exact recorded recursive commands below (sole edit: server home replacement). Each root was searched separately; no depth/file/match cap, hidden/ignored files included. Symlinks were not followed; the separate recursive inventory found none and no traversal/read errors in these six roots.

```sh
rg --hidden --no-ignore --text --with-filename --line-number --only-matching --ignore-case --regexp 'aufgaben-app|REF[-_ ]APP|Durchstich|pj-1a15ab00ec1-1|tq-1a15ab0d9f1-2|tq-1a15ac0ff71-1|tq-1a15ac7c989-11|tq-1a15aca6401-21|wk-1a15ab14a14-3|wk-1a15ac13c7c-2|wk-1a15ac81b22-12|wk-1a15aca65e8-22|f5276c87' ~/pa-orch/queue
rg --hidden --no-ignore --text --with-filename --line-number --only-matching --ignore-case --regexp 'aufgaben-app|REF[-_ ]APP|Durchstich|pj-1a15ab00ec1-1|tq-1a15ab0d9f1-2|tq-1a15ac0ff71-1|tq-1a15ac7c989-11|tq-1a15aca6401-21|wk-1a15ab14a14-3|wk-1a15ac13c7c-2|wk-1a15ac81b22-12|wk-1a15aca65e8-22|f5276c87' ~/pa-orch/jobs
rg --hidden --no-ignore --text --with-filename --line-number --only-matching --ignore-case --regexp 'aufgaben-app|REF[-_ ]APP|Durchstich|pj-1a15ab00ec1-1|tq-1a15ab0d9f1-2|tq-1a15ac0ff71-1|tq-1a15ac7c989-11|tq-1a15aca6401-21|wk-1a15ab14a14-3|wk-1a15ac13c7c-2|wk-1a15ac81b22-12|wk-1a15aca65e8-22|f5276c87' ~/pa-orch/hold
rg --hidden --no-ignore --text --with-filename --line-number --only-matching --ignore-case --regexp 'aufgaben-app|REF[-_ ]APP|Durchstich|pj-1a15ab00ec1-1|tq-1a15ab0d9f1-2|tq-1a15ac0ff71-1|tq-1a15ac7c989-11|tq-1a15aca6401-21|wk-1a15ab14a14-3|wk-1a15ac13c7c-2|wk-1a15ac81b22-12|wk-1a15aca65e8-22|f5276c87' ~/pa-orch/parked
rg --hidden --no-ignore --text --with-filename --line-number --only-matching --ignore-case --regexp 'aufgaben-app|REF[-_ ]APP|Durchstich|pj-1a15ab00ec1-1|tq-1a15ab0d9f1-2|tq-1a15ac0ff71-1|tq-1a15ac7c989-11|tq-1a15aca6401-21|wk-1a15ab14a14-3|wk-1a15ac13c7c-2|wk-1a15ac81b22-12|wk-1a15aca65e8-22|f5276c87' ~/pa-orch/held
rg --hidden --no-ignore --text --with-filename --line-number --only-matching --ignore-case --regexp 'aufgaben-app|REF[-_ ]APP|Durchstich|pj-1a15ab00ec1-1|tq-1a15ab0d9f1-2|tq-1a15ac0ff71-1|tq-1a15ac7c989-11|tq-1a15aca6401-21|wk-1a15ab14a14-3|wk-1a15ac13c7c-2|wk-1a15ac81b22-12|wk-1a15aca65e8-22|f5276c87' ~/pa-orch/specs
```

UTC on 2026-10-21; counts below are derived from complete saved outputs, not fresh filesystem searches:

| Root under `~/pa-orch` | UTC start | Regular files | Matching output lines | Exit |
|---|---|---:|---:|---:|
| `queue` | `2026-10-21T18:09:26.068574+00:00` | 0 | 0 | 1 |
| `jobs` | `2026-10-21T18:09:26.079469+00:00` | 8 | 0 | 1 |
| `hold` | `2026-10-21T18:09:26.090840+00:00` | 16 | 0 | 1 |
| `parked` | `2026-10-21T18:09:26.106296+00:00` | 2 | 0 | 1 |
| `held` | `2026-10-21T18:09:26.116045+00:00` | 0 | 0 | 1 |
| `specs` | `2026-10-21T18:09:26.126658+00:00` | 2077 | 57 | 0 |

`specs` had 57 matching term occurrences in five files under `specs/external-acceptance-1802/`: `srv-doc-a4-stop-safety.md` (7, current read-only audit brief), `pc-sideapp-observation.json` (31), `pc-sideapp-backups.json` (2), `backlog-sideapp-observation.json` (3), `abnahme-evidence-raw.md` (14). The latter four are supplied evidence, not executable side-app jobs. No job prompt text is reproduced.
All other roots had zero matches (exit 1); all six stderr files were empty. The inventory started `2026-10-21T18:09:26.200917+00:00`, exit 0. Reads were not an atomic snapshot; unrelated aliases and future job creation are outside scope.

Crontab check: `2026-10-21T18:11:00.962097+00:00`, command `crontab -l`, exit 0; wrapper searched `aufgaben-app|REF[-_ ]APP|Durchstich|pj-1a15ab00ec1-1|f5276c87` case-insensitively. Complete recorded output:
```json
{"command": "crontab -l", "exit": 0, "stderr": "", "matches": [], "rawCronLinesRecorded": false}
```
Events check: `2026-10-21T18:11:00.989179+00:00`; exact command:
```sh
rg --text --line-number --only-matching --ignore-case 'aufgaben-app|REF[-_ ]APP|Durchstich|pj-1a15ab00ec1-1|f5276c87' ~/pa-orch/events.log
```
Exit 1; stdout and stderr empty. This is a bounded literal no-match, not a complete service/timer inventory.

## Earlier FAILED search — retained, not silently replaced

Transcript tool call `2026-10-20T21:59:26.886Z`, result `2026-10-20T21:59:28.962Z`; supplied extraction dated `2026-10-22T00:19:38Z`. Transcript lines 593–595 SHA-256: `3bf787e96d59f7271afaf15f3aa48dd7f9652409ca8d36bf970b0d0ae6758d50`.
Command and output copied verbatim from `a4-earlier-failed-search.md` (its supplied extraction already removed an SSH connection line and terminal title escape sequence):

```sh
cd ~/pa-orch && grep -rlE 'aufgaben-app|REF-APP|Durchstich' queue hold parked held jobs 2>/dev/null; echo "rc=$?"; grep -lE 'aufgaben-app|REF-APP' specs/* 2>/dev/null; echo "specs rc=$?"; grep -ciE 'aufgaben-app|REF-APP' events.log; ls ~/wt | grep -i aufgab; ps -eo pid,etime,cmd | grep -E 'codex|claude|kimi|cargo|opencode' | grep -v grep | head -5; echo procs-done
```
```text
rc=1
specs rc=2
0
procs-done
```
`ssh_exec exitCode 0, complete true, timedOut false.` The first recursive grep returned 1 (no match); `specs rc=2` came from `grep -lE specs/*` without `-r`: subfolders were not searched. There is NO original error text: the command itself redirected stderr to `/dev/null`. The enclosing exit 0 does not turn that incomplete search into proof.

## Private originals and SHA-256

All tables/proof text above are labeled summaries. Literal command/output blocks are sanitized copies; their hashes differ from the originals. Original paths below are relative to `~/pa-orch`; `E/` = `reports/srv-doc-a4-stop-safety-evidence/`, `P/` = `specs/doc-evidence/a4-pc/`. PC inputs were copied from `%USERPROFILE%/pa-orch/doku-umbau/reports/`; the supplied AgentsRoom record and transcript extraction are coordinator artifacts. All original bytes stayed unchanged.

| Private original | Original SHA-256 |
|---|---|
| `reports/srv-doc-a4-stop-safety.md` | `a2282a94f8dd4b70e73bacbcdd012eacfe658894bdec43db4514cb257f623b3f` |
| `E/commands.jsonl` | `5c02a334156332513e534d703a645b0f3d2f5b251ea4545bd6ba838756b96b7a` |
| `E/SHA256SUMS` | `8f938bb253fdf5e4cd513596ebd1807bd34049789dbf5d335d74f0709b52eb9c` |
| `E/pc-sideapp-observation.json` | `84c6578ceb1be4900884bdbc79972c7c5f2ab6695b2ef4d2cf5f0197d0900513` |
| `P/a4-pc-residual-20261021.json` | `88aa3cf7e7ffd36ae8df732aaf866aa25fc0b6d25ee9574d18d99853bad6ceb6` |
| `P/a4-pc-binary-20261021.json` | `0b7385e0ec73df0fdf594314cad9e87d41f6ad97b2487c7604313c41ee61f25b` |
| `P/a4-agentsroom-observation.json` | `6d724e6203f09c0d3cab67802eb09d6fd15c1931156dd86770ec49a5bbf0aa2f` |
| `P/a4-earlier-failed-search.md` | `00c6516a2c45031173094bb8e8eb04f7194b8301d08340e8e1059e661029dbe4` |
| `E/git-head.stdout.log` | `f582d4325a1056019083bf2b839113d510507f6f97dd5fa7578aaa62a80c4afb` |
| `E/evidence-source-binding.stdout.log` | `a8d488f05e3742a179488e2dded17869449f73176d92ff242f1ecd75235e7be9` |
| `E/main-queue-startup.stdout.log` | `9dd84ef0129f242c28f0e646f1de1e8c4f743b59181390935a4e2953c6919d80` |
| `E/workers-plan-reattach.stdout.log` | `06c28125e7e736b964877c4b9c0e27e90ae8ba8899494bc444481b5a2e6b8318` |
| `E/queue-dispatch.stdout.log` | `ce23fffea32bcd3582decb063aa1762ee052d1a685886fcae25bfa74fdc826d4` |
| `E/store-queue.stdout.log` | `4124b5ba1b6799aa9d9d355c0bd63289cbfc41e9bf0f638c29df86aa23e51a43` |
| `E/worker-respawn.stdout.log` | `1ff08059d10c6d959c3b60521be42852cf21718d134d3ceb56a594fa5a7a6647` |
| `E/main-respawn-command.stdout.log` | `d848312a45377ec0ed65aef406f0e3ba9fa264966959a64ffc8a03d8b807ac7b` |
| `E/app-respawn-caller.stdout.log` | `2e871d3cc033afe9c9da99fc95cd877065d0ad13534ac5c26a2d6f99d8650b2c` |
| `E/card-respawn-caller.stdout.log` | `909d4b4e5b36082033dc0c1cd23b115417b0b2655f9409b193d8b05bb46f4f04` |
| `E/delivery-startup.stdout.log` | `c244122dd1211a0bce0ffecb4df0bea770d7c07278f772817b6a88d1d5dcf75f` |
| `E/recovery-restore.stdout.log` | `3eec210ff28555efc26dd966f2dea4af7d33025c9514f89ed368d05fb2f852a1` |
| `E/continuous-scheduler.stdout.log` | `ed707d38f33d9851b0199b108999becd11d7b4c9d48bb14f7c69c3fbc0a66bb7` |
| `E/activation.stdout.log` | `59038b9851706c8e2c911f59b64c15d0dfb2a79224b4772b13e4eb0379eedbe6` |
| `E/startup-reconcile-continuous.stdout.log` | `eeeafe2ad8f52a957624c191d138be78a020e427d70b7373efc2b892e9cd815a` |
| `E/directory-inventory.stdout.log` | `42c51b7a507014b4c04eca92548b072bf10ad1dfdb6ec4264daaf4d10c709fee` |
| `E/server-summary.stdout.log` | `25fda8e68fc6c7a08606c95a3e128e29d43017e26d84469bfd5e20963ec2c042` |
| `E/orch-inbound.stdout.log` | `9ce599755e8314d925579bf420be8531e842f8584185e57c2783093744ff58e3` |
| `E/orch-hold-inbound.stdout.log` | `5e26a80e0e4f0a5a0256e535adad1f00fbbd77decddd81bc056b04a6e5099ae8` |
| `E/cron-scope.stdout.log` | `3ce196aa1bbc11d49b4fea7f6b9011ab0dcfdc2fa7c4bd9d935ba057dfdb5deb` |
| `E/event-token-scope.stdout.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `E/task-queue-corrected.stdout.log` | `96e793513d768f8e88b0e150fd184ff3006cb92bc73f5cc4362ec8db5598ac27` |
| `E/all-task-queue-references.stdout.log` | `ed033ab91ac2b06fcca510d13dd9b4393b0c9bf7847dbaeeac370da1f8597066` |
| `E/all-task-queue-references.stderr.log` | `859062bd48d4fd6426d2335c7d2e69bf0e1bc6d978dbb67258a2807b28bf98b4` |
| `E/recursive-queue.stdout.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `E/recursive-jobs.stdout.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `E/recursive-hold.stdout.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `E/recursive-parked.stdout.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `E/recursive-held.stdout.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `E/recursive-specs.stdout.log` | `5cb5f7789f55174499bd6a1e9fb62553b9f54a2c7e0eff30478f2712c5a7cdc7` |

## Sanitization

Only home-path replacements were applied to retained lines: server home → `~`; PC user home → `%USERPROFILE%` (including JSON-escaped spelling). No job prompts, user chat, credentials, personal identifiers, private hostnames or addresses are published. The supplied AgentsRoom input had already removed user ID, webhook URL and assistant targets. No literal output block is shortened here, so no additional omitted-line marker is needed. Derived tables select the stated fields and are not presented as verbatim dumps. The public excerpt cannot independently authenticate private originals; their recorded hashes let authorized holders check the exact sources.
