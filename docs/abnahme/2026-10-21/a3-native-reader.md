# A3 native reader: final frozen-source evidence (2026-10-21)
Sanitized copy of private evidence; record summaries/tables below are distinguished from the complete verbatim runtime log. No new proof run.
PASS covers the unchanged native Store import → registered original root → guidance reader → DEVFLOW parser → stored projection, in a new isolated test DB.
Parser scope: only the legacy four-column DEVFLOW table. FU-1758-1 and DOC-3 remain in the persisted source, outside the projected IDs; no nine-column Z1–Z4 acceptance, UI, scheduling or dispatch claim.
## Frozen source and method
Commit: `47ddbebcd78801c1fde869000dc385b820caee20`. Full `git archive` copy; only adaptation: append the [exact harness](a3-harness.rs.txt) to the COPY of `store.rs`; verified `copy == original bytes + harness`.
Original/copy verification covered 1,803 tracked blobs; production methods, migrations, parser input and registration logic were unchanged.

| File | Git blob ID |
|---|---|
| `src-tauri/src/store/development_guidance.rs` | `9608656627ed2152a3b5d86e9358c930379fb4aa` |
| `src-tauri/src/store/development_plan.rs` | `7b14af59a691a512b51a9541b2fd4e29e954d486` |
| `src-tauri/src/store/development_runs.rs` | `3ceddfa11d9a73b935b29770a8a6a87959dc3f08` |
| `src-tauri/src/development_plan.rs` | `2914e6d6943079325468e3671c448d23b2c0c76e` |
| `src-tauri/src/store.rs` | `1e6feb50581e6645937eb84daac28d44250f1e7e` |
| `docs/PLAN.md` | `7486fd394dc8b886795065c33e96a06a0ac8fd74` |
## Recorded commands and environment (exit 0 each)
Paths below use the sole sanitization replacement. Commands are shell renderings of recorded argv; metadata preserves exact UTC start/end timestamps.
```sh
cd ~/pa-orch/reports/srv-doc-a3-native-reader-final-evidence/frozen/src-tauri
cargo test --offline --locked --bin projecta --no-run --message-format=json
cd ~/pa-orch/reports/srv-doc-a3-native-reader-final-evidence
~/targets/slot1/debug/deps/projecta-926c9d6b22f4e0a4 --exact store::a3_external_proof::real_frozen_plan_native_reader_projection --nocapture --test-threads=1
python3 ~/pa-orch/reports/srv-doc-a3-native-reader-final-evidence/verify-proof.py
python3 ~/pa-orch/reports/srv-doc-a3-native-reader-final-evidence/compare-proof.py
```
compile: `2026-10-21T22:26:46.082019+00:00` → `2026-10-21T22:27:46.794773+00:00`, exit `0`.
runtime: `2026-10-21T22:27:50.684328+00:00` → `2026-10-21T22:27:51.248732+00:00`, exit `0`.
verify: `2026-10-21T22:29:05.031184+00:00` → `2026-10-21T22:29:05.162792+00:00`, exit `0`.
compare: `2026-10-21T22:29:05.163103+00:00` → `2026-10-21T22:29:05.276363+00:00`, exit `0`.
Compile/runtime environment: Linux x86_64; `CARGO_TARGET_DIR=~/targets/slot1`, `CARGO_BUILD_JOBS=1`; no Cargo profile overrides.
`rustc 1.99.0 (b940084d7 2026-09-28)`; `cargo 1.99.0 (5f94df478 2026-08-27)`; host `x86_64-unknown-linux-gnu`.
Runtime: `A3_EVIDENCE_DIR=~/pa-orch/reports/srv-doc-a3-native-reader-final-evidence`, `A3_FROZEN_ROOT=~/wt/srv-doc-a3-native-reader-final`; fresh `run-data/isolated-projecta.db`, fixture registration through public Store methods; no live DB or application main.
Compiler stderr (complete, sanitized); compiler stdout (all JSON build messages omitted):
```text
   Compiling projecta v1.6.6 (~/pa-orch/reports/srv-doc-a3-native-reader-final-evidence/frozen/src-tauri)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 1m 00s
[… 607 lines omitted …]
```
## Native import result
Complete `runtime.stdout.log` follows; `runtime.stderr.log` was empty. PLAN Git bytes = independent SHA-256 oracle = reader digest = `sourceRevision` digest = persisted full source.
```text

running 1 test
test store::a3_external_proof::real_frozen_plan_native_reader_projection ... A3 reader missing-file: {"error":"missing","state":"error"}
A3 reader missing-child: {"error":"missing","state":"error"}
A3 reader nul-path: {"error":"unreadable","state":"error"}
A3 reader directory: {"error":"not_regular_file","state":"error"}
A3 reader fifo: {"error":"not_regular_file","state":"error"}
A3 reader 262144-byte-inclusive-limit: {"bytes":262144,"sha256":"d509bff642a353f88582e8a846ecae041c333b79c57a7a24ff310fbdb7e914e9","state":"ok"}
A3 reader 262145-byte-rejected: {"error":"oversized","state":"error"}
A3 reader invalid-utf8: {"error":"invalid_utf8","state":"error"}
A3 reader permission-denied: {"error":"unreadable","state":"error"}
A3 reader external-symlink: {"error":"outside_project","state":"error"}
A3 reader parent-escape: {"error":"outside_project","state":"error"}
A3 reader internal-symlink: {"bytes":262144,"sha256":"d509bff642a353f88582e8a846ecae041c333b79c57a7a24ff310fbdb7e914e9","state":"ok"}
A3 reader absolute-outside: {"error":"outside_project","state":"error"}
A3 REAL READ bytes=245849 sha256=5212a28d936e11e60056e3b406d9447389bd96582274619a34f9c6be4e2eddaa; AGENTS bytes=30665 sha256=30bff64a473de642c2ab3b54051b2d781a121a6d21a0a92d10e71359c1a062b5
A3 REAL PARSE packages=38 source_revision=sha256:5212a28d936e11e60056e3b406d9447389bd96582274619a34f9c6be4e2eddaa
A3 RESULT {"allIds":["DF-00","DF-01","DF-02","DF-03","DF-04","DF-05","DF-06","DF-07","DF-08","DF-09","DF-10","DF-11","DF-12","DF-13","DF-14","DF-15","DF-16","DF-17","DF-18","DF-19","DF-20","DF-21","DF-22","DF-23","DF-24","DF-25","DF-26","DF-27","DF-28","DF-29","DF-30","DF-31","DF-32","DF-33","DF-34","DF-35","DF-36","DF-37"],"boundedIds":["DF-00","DF-01","DF-15","DF-36","DF-37"],"fixtureRegistration":true,"packageCount":38,"planId":"a3-frozen-47ddbe","productionMethodsUnchanged":true,"projectionRevision":1,"readerCases":13,"realOriginalPlanBytes":true,"registeredProject":"pj-1a16093f24d-1","reopenedProjectionRevision":1,"result":"PASS","sameSourceReimportRevision":1,"scopeChecks":["project","plan"],"sourcePath":"docs/PLAN.md","sourceRevision":"sha256:5212a28d936e11e60056e3b406d9447389bd96582274619a34f9c6be4e2eddaa","storeErrorCases":10}
ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 2163 filtered out; finished in 0.53s

```
Independent oracle: literal DEVFLOW lines 1473–1510; all 38 IDs, titles, acceptance cells, dependencies, source lines, identities and flags checked against pure/stored projections. First/last rows (summary; full PLAN not dumped):

| ID | Line | Title | Dependencies | Acceptance |
|---|---|---|---|---|
| DF-00 | 1473 | Bestandsabgleich · Architekt · DOC · S | none | Erledigt (PR #70). Live-Git, PR, offene HQ2/W-Gates, vorhandene Implementierungen und Fähigkeiten abgleichen; Pfad-Allowlist und Überlappungsmatrix für alle Pakete, keine doppelte Implementierung. |
| DF-37 | 1510 | Abschluss und Releaseentscheidung · Integrator/Reviewer · DOC · S | DF-36 | **Gestrichen (25.09.)** ersetzt durch die Abnahme je Meilenstein. Ursprünglich: Zwei unabhängige Reviews für große/Shared-Seam-Änderungen, Dispositionen, aktuelle Gates und NICHT ABGEDECKT; Readinessbericht. Merge/Release/Continuous nur mit geltender menschlicher Freigabe. |

Public current/historical reads and close/reopen equal the first payload; reimport at expected 1 stays revision 1, stale expected 0 is rejected. Second project has no current projection before import; second project and second plan each independently start at 1.
All first-import packages: `parentId=null`, `removed=false`, `noNewDispatch=false`; retained historical acceptance prose grants no authority.
## Counter-check results (summaries)

| Reader input/case | Actual result |
|---|---|
| `missing-file` | `missing` |
| `missing-child` | `missing` |
| `nul-path` | `unreadable` |
| `directory` | `not_regular_file` |
| `fifo` | `not_regular_file` |
| `262144-byte-inclusive-limit` | `ok; 262144 bytes; SHA-256 d509bff642a353f88582e8a846ecae041c333b79c57a7a24ff310fbdb7e914e9` |
| `262145-byte-rejected` | `oversized` |
| `invalid-utf8` | `invalid_utf8` |
| `permission-denied` | `unreadable` |
| `external-symlink` | `outside_project` |
| `parent-escape` | `outside_project` |
| `internal-symlink` | `ok; 262144 bytes; SHA-256 d509bff642a353f88582e8a846ecae041c333b79c57a7a24ff310fbdb7e914e9` |
| `absolute-outside` | `outside_project` |

| Store case | Actual error |
|---|---|
| `stale-cas` | `plan projection revision conflict: expected 0, current 1` |
| `unknown-project` | `plan source docs/PLAN.md: unknown project` |
| `empty-root` | `plan source docs/PLAN.md: project_root_unavailable: registered path is empty` |
| `relative-root` | `plan source docs/PLAN.md: project_root_unavailable: registered path must be absolute` |
| `missing-root` | `plan source docs/PLAN.md: project_root_unavailable: No such file or directory (os error 2)` |
| `file-root` | `plan source docs/PLAN.md: project_root_unavailable: registered path is not a directory` |
| `missing-plan` | `plan source docs/PLAN.md: missing` |
| `oversized-plan` | `plan source docs/PLAN.md: oversized` |
| `invalid-utf8-plan` | `plan source docs/PLAN.md: invalid_utf8` |
| `malformed-plan` | `invalid plan source docs/PLAN.md:1: unsupported source: no plan packages` |

Rejected invalid fixture imports leave no current projection. Verification PASS: original/copy hashes, exact source, 38-row independent oracle and clean frozen HEAD; comparison PASS: 56 provisional artifacts rehashed, exact same harness, 13 reader/10 Store results and revision behavior.
Provisional `213d29a3` → final `47ddbebc`: PLAN 241,440 → 245,849 bytes (+4,409); SHA-256 `bcc86cf6d9fbcf795ade83d294393f51571b32c31d5f824c69639d504e3708ef` → `5212a28d936e11e60056e3b406d9447389bd96582274619a34f9c6be4e2eddaa`; DF source lines +7, package cells/flags unchanged.
Four reader/parser/import files plus store.rs byte-identical across proofs; seven files elsewhere differ across complete trees. Comparison: 347 changed / 947 equal JSON leaves; source identity, fixture IDs/times, binary/build paths and filtered tests differ as expected.
## Session separation and limits
Final `01a16091-0f25-7321-b5ba-326733d14c39` (2026-10-21T22:24:43.763Z); provisional `01a15fa5-67cf-7640-aba6-832685074563` (2026-10-21T18:07:19.676Z); each observed `gpt-6.1-sol`, effort `high`. Different execution sessions, no cross-family review.
NICHT ABGEDECKT: Windows code/tests, live app/DB/CLI/UI/context/scheduler/workers, existing-schema upgrade, full parser matrix, concurrent replacement/CAS faults, changed-source rollback, full regression suite. Windows lane belongs to the merge queue; Root/external acceptance remains separate.
## Original artifact identities
Private original directory: `~/pa-orch/reports/srv-doc-a3-native-reader-final-evidence/`; names below are relative to it. SHA-256 hashes identify ORIGINAL files; sanitized copies/excerpts may differ. Full sources/projections stay private.
```text
1061e2871c85791a0071232044940b7cae0ec89a515029795127bf740f279ec9  harness.rs
407e4a4a83d8d268cb65d60b8d66308c5929c102fd408cc28b5186a725ca1fbb  compile.command.json
74f0851ef85df6c607c0ee7c6dfe2d9c2c621af7d688fb1fdef864228a681a5e  compile.stdout.log
b2e53925af6665387ee9a4c70b8e1a77dc855e4349621d2c18cd8bf19618493a  compile.stderr.log
8bfa04f6f4c3d0e7c92e0f3c99c8c6dfe44b3e5a2a5bcffff2233f5450a8fd11  runtime.command.json
6aae415bc08b9db37f9e0cbd1536ec1b9fa53c46ef3192ab0a27f17126d1f60c  runtime.stdout.log
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  runtime.stderr.log
9f71ca6377b25ebb9914d4aa93fe60e88aa2dd737316f673fc2a6ad515a59154  verify.command.json
3121f2851463e1f289eafd501a174e22a1efc5d86c83848b802bf065ae2bc31a  verify.stdout.log
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  verify.stderr.log
f32fdc5c6c1f0d0bd7a8daf8b8dcf391401568b2f154449ece5d69b9325192f9  compare.command.json
99d51b1c9e1ce147c62604d586200a41e30953708ab6649c05b753e69c25f079  compare.stdout.log
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  compare.stderr.log
e2438d0174c94cfbbc6a022e9d2667df71e72c665a2de0e2f14626d0924405b1  source-manifest.json
9f86161a40584cbae6ce89f49aecbe2407c584483bbbaaa0cafd18454ad710d1  real-read.json
94e66b73e08194077baad9de30d1a47399139b6c51dbb1e15288cc3ed86e93da  pure-projection.json
5ead5885c8e85b92e575bae4c9bc2b1b9e2abf5f93bfc5276861f59a2b481355  stored-projection.json
ed3466ff87ad6d45b84c088e4ef0c4f739425965aca62cb9088d44f2aa8f43b6  expected.json
8733802d7c71ab0613f2605b8be076ce2946dbf102851152bd22bd9d8a863f73  summary.json
abcf6d4fedd4151558bc1e7291e7ede1d68f6dd93eb2fd9be56bbff8e068af3b  reader-cases.json
530892437ff18641c29450cf83db1147dd05e756b3932b363f59f5bcc8f8a395  store-error-cases.json
d86933612349f564eb1e5cac80ea02ee4f565487099a9678beb5e6dc0bf92a57  comparison-verification.json
b02de44f3cb60002c03ce9da83e6111471f270268daa36db6a46022ad6770b86  session-separation.json
c8c904953477b88b0c4a894da1e01d61e928b36bb853401a10b12a6d0defa104  runtime-environment.json
b569b0c98ea3133c7252b4b8ea6b39b7b353813df0dd5f5c412c355691424112  compiler-version.stdout.log
1f88eaf7fe1aaec83184752cf4c944cd22f00184136ff36a3e4c318cc60ef566  cargo-version.stdout.log
4d23aa4c3ee9177778776d5439d1964340ec6d6ffbd251307e4ad323351ebe05  artifact-hashes.sha256
4a2fce040d75df879f6fe27abf2687f201a71e750c20f9db5b2db272dc1c01e4  ../srv-doc-a3-native-reader-final.md
4d37dab122eb227b875fc4e5ed6ac04fb891eef91ff2edc0f429d7c61583f26f  ../srv-doc-a3-native-reader.md
```
## Sanitization
Only replacement kind: server home prefix → `~`, preserving remaining paths. Harness has no replacements and is byte-identical to original. No runtime log cuts; the entire omitted compiler stdout has its exact line count above. Other sections summarize records rather than quote cut text; no full PLAN source, private user data or environment dump is published.
