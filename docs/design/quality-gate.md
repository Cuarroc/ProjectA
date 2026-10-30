# Design quality gate (mandatory, Elias 18.10.2026)

Elias, verbatim: "Designer agenten sollen mehr gezwungen werden diese tools einzusetzen und wirklich gute qualität zu bringen. Bewerte und verbessere sie streng." And: "Außerdem sieht das ganze aktuelle design viel zu generisch und nach AI aus. Warum gibt es riesige tabs wenn nur zwei dinge darin stehen, der rest leer ist aber es trotzdem so viel platz auf der seite braucht."

Background: the probe hall (DS-H-07) was rejected. It had an offset layout, the factory crammed on the left, too many tabs, a clumsy Not-Aus and avatars that were weak in dark mode. Elias calls the whole current app generic and AI-looking, with huge, near-empty panels. The cause was not missing skills; it was skills not used and no strict check.

This gate applies together with `design-taste`, `ui-ux-pro-max` and `fabrik-design`. A design that skips a step below is **FAIL**, whatever it looks like.

## 0. Hard bans (any one = FAIL)
- **Space not earned by content.** No panel, tab, card or column larger than its content needs. Two items get a compact row, a popover or an inline list, never a full-height panel or a half-empty page. Empty space must be deliberate breathing room around the focal point, not leftover area in a container. Size containers to content (fit-content, auto rows); collapse what is empty or show a one-line empty state.
- The generic AI look: equal card grids, everything boxed, big rounded panels with a soft shadow, indigo/purple gradients, glow, an eyebrow over every section, a default dashboard skeleton (sidebar + header + card grid) used without a reason.
- More visible top-level tabs or sidebars than the task needs. The default is one canvas plus collapsed panels.
- Unmeasured contrast; a dark mode that is just inverted.

## 1. Mandatory tools (log each one with evidence)
| # | Tool | Required use | Evidence in the log |
|---|---|---|---|
| T1 | Skills `design-taste` + `ui-ux-pro-max` (+ `fabrik-design` for hall/factory) | Read before the brief. Name the rules you applied. | Skill names + 3 applied rules |
| T2 | Reference research: WebSearch/WebFetch, the user's Chrome (read-only), public screenshots and open-source repos | At least 5 real references from the same register (operate/control-room/agent office), each with URL, date, licence and "what we take / reject" | Reference table |
| T3 | Claude design systems "ProjectA Glass" / "ProjectA Fabrik" (Artifact read) and `src/design/tokens.css` | Every value comes from tokens. A new token must be named and justified. | Token list used |
| T4 | Render: a real browser (Claude-in-Chrome, AgentsRoom browser or `node scripts/dev/shot.mjs`) | Screenshots at 1440×900 and 1920×1080, light AND dark, plus the narrowest supported window | PNG paths |
| T5 | Look at every PNG yourself (Read the image) | Describe what you checked. A defect you see gets fixed before you continue. | Per-PNG notes |
| T6 | Independent critic: a fresh subagent that did not build the design (`UI Finish-Gate Reviewer`, `impeccable:impeccable-finish-reviewer`, `design-director` in critique mode or `Accessibility Auditor`), given only the PNGs + brief + rubric | Scores per §3 | Critic output verbatim |
| T7 | Measured contrast (script, or a computed-style check in the browser) | Text ≥4.5:1, UI/focus ≥3:1, both themes, numbers reported | Numbers |
| T8 | Workflow tool (≤10 agents, Elias 15.10.) when there are ≥3 variants or mockups | Parallel variants → judge panel → merge the best | Run ID or "not needed: <reason>" |

Paid or unusable tools: Mobbin needs a paid plan, so it is not usable. Figma (starter, View seat) is read-only at best. Magic Patterns and Canva AI may cost credits. Use them only after Elias says yes, and log "not used: <reason>". Never decompile or copy closed-source apps or art.

## 2. Process (no skipping)
1. **Brief:**
   - the job of the screen;
   - the register;
   - the concept from the subject's world;
   - the signature detail;
   - 3 rejected defaults;
   - a checklist of every user point verbatim, each mapped to how it is solved.
2. **References (T2)**, then critique the brief against them. Replace every line that would fit any SaaS template.
3. **Variants:** at least 2 clearly different layouts for the main screen (T8 if 3 or more). The critic picks one. Do not polish one idea alone.
4. **Build and render (T3–T5).** Render with realistic content amounts: 0, 2 and 12 items. A container must look right at 2 items, not only at 12.
5. **Critic (T6):** strict scoring, see §3.
6. **Fix and re-render.** At most 3 rounds. After round 3 without a pass, report FAIL honestly with the gaps. Never soften the score.

## 3. Strict rubric (the critic scores 1–5 per line; 5 = a senior designer at Linear/Apple would ship it unchanged)
1. Layout and grid: aligned edges, no offset, the canvas uses the full screen where intended.
2. Hierarchy: one focal point, one primary action (squint test).
3. Typography: the token scale, line length and German long strings.
4. Spacing and proximity: inside a group < between groups.
5. Colour and dark mode: tuned separately, contrast measured (T7), state never by colour alone.
6. Density and overview: who works / rests / needs you, understood in 3 s.
7. Control: Not-Aus and critical actions are reachable, discreet and confirmable, and never cover content.
8. Panels: collapsible, resizable, collapsed state designed, few top-level tabs.
9. States: empty, loading, error, unknown ("unbekannt"), waiting-for-you, focus-visible.
10. Identity and craft: specific to ProjectA (pixel factory, "Grün heißt bewiesen"), no slop pattern, real details. Would someone recognise it as ProjectA without the logo?
11. Honesty: only observed data; placeholders marked; no fake metrics.
12. User points: every verbatim user point visibly solved (any unsolved point caps the total at FAIL).
13. Space economy: each container sized to its content at 0/2/12 items; no large empty tab, card or panel.

**PASS only if** every line is ≥4, the average is ≥4.3, line 12 is 5, and no §0 ban is hit. Otherwise iterate. The author never scores their own work. A critic from the author's session or context does not count.

## 4. Delivery
- Report (English): brief, reference table, tool log T1–T8, variant choice, rubric per round (critic verbatim), contrast numbers, open questions.
- Only a PASS goes to Elias as "fertig zum Ansehen". A FAIL goes to Root with the gaps.
- To Elias: German, ≤6 lines, with the paths of the PNGs.

## 5. Canonical execution contract (DG-01, Root 2026-10-30)
This versioned file is the one normative design rulebook; sections 0–4 retain the original skill text and thirteen criteria verbatim.
Skill/library and private pa-orch copies are historical source or pointers, not competing current policy. Preserve old evidence, prompts, scores, logs and PNGs.
The stable critic template below is normative specification; instantiated per-run review prompts stay outside Git under AGENTS rule 7.

### Independence and limits
Root commissions an existing independent critic in a separate fresh context; actual critic family differs from the author's. Author/self/same-family scores do not count.
For an important decision, Root binds a second critic from another non-author family, for example the existing Kimi subscription route.
Root records importance and reviewer identities before review; ambiguous classification goes to Root, not author self-exemption.
This rulebook authorizes no automatic QA/new agent/team/service, paid tool or quota-cap change. T8 reuses an admitted workflow under current ownership/resource/spawn limits.
At most three scored design rounds cover the named track; author prechecks are separate and do not consume critic rounds.
After round3 without PASS report NOT PASS and stop for Root; a renamed attempt or merge never resets the counter. Source review separately remains max2 rounds under AGENTS5.
Private-variant PASS is not actual-source acceptance. Root binds final source confirmation within the remaining track budget before source implementation.

### Matrix, images and coverage
Freeze brief/user points, matrix case IDs, input hash and source commit before capture.
Include1440×900,1920×1080,both themes,narrowest supported window,0/2/12items and packet-specific interaction/zoom/motion/accessibility cases.
The author retains T5 inspection of EVERY generated original PNG, per-image notes and measured contrast.
The critic opens every matrix PNG OR a logged random sample; an author's convenient selected subset is invalid.
Sampling records complete frozen manifest hash,total N,seed/random method,selected IDs/PNG hashes,exclusions and inspected n BEFORE scoring.
Required user-point/theme/viewport/adverse-state strata must be represented; unassessed requirements mean incomplete/NOT PASS, never default4.
Report n/N and limits. Sampling waives neither full captures,author inspection,numeric checks nor an explicit packet-level full-critic requirement.
Each PNG binds bytes/hash,case/input/sourceSHA and original path. Source verdict/images match the EXACT current PR headSHA.
Private variants bind inspected source base+variant/input hashes; they never claim a future PR-head PASS.
Relevant source/head changes invalidate affected images/verdicts; preserve historical evidence and rerender/review the new candidate.
Critics receive brief,rubric,matrix/evidence and original PNGs without author scores or proposed PASS. Existing DOM heuristics are measurements,not independent visual verdicts.
A primary action appears only for real action need in the bound brief; passive/inactive states never get invented actions.
PASS requires all13 assessed rows>=4,exact mean>=4.3,row12=5,no hard ban; missing evidence or rounded means cannot pass.

### Exact normative critic prompt
Use the following indented block verbatim, replacing only bracketed fields. It is a NEW normative template derived from the preserved rubric,not a claimed historical verbatim prompt.

    You are the independent ProjectA design critic. Do not build,modify,dispatch or grant authority beyond the bound design verdict.
    AUTHOR: [actual model/family]. CRITIC: [actual model/family/fresh context]. ROUND: [track and k/3].
    IMPORTANCE/SECOND CRITIC: [Root decision and independent identities,or ordinary].
    BRIEF/VERBATIM USER POINTS: [frozen reference/hash].
    RULEBOOK: [this file at commit/hash]. MATRIX/INPUT: [complete manifest/hash and input hash].
    SOURCE: [exact PR head for source delivery; private source base+variant hashes for private design].
    IMAGES: [complete original PNG manifest,hashes,case/source bindings].
    INSPECTION: [all N,or logged random method/seed/selected IDs/exclusions; inspected n/N].
    MEASUREMENTS: [contrast/theme/font/targets and required interaction/zoom/motion evidence].
    Open the original images yourself. Verify coverage,source/head bindings,limits and independence before scoring.
    Score ALL13 numbered section3 criteria in original order,1–5,with observed image/case reasons for EACH row.
    Unknown or unassessed evidence is NOT a passing score. Check every verbatim user point and every section0 hard ban.
    Return actual identity/context; source/head/rulebook/input hashes; opened imageIDs/hashes and n/N;13scores/reasons; exact unrounded mean; row12; hard bans; uncovered limits; concrete fixes; PASS or NOT PASS.
    PASS requires every score>=4,mean>=4.3,row12=5,no hard ban and all required evidence. Otherwise report NOT PASS without weakening thresholds.
    Do not inherit a private PASS,stale-head verdict,author score,prior merge or self-issued exception label.
    Stop after the track's third scored round without PASS; Root alone disposes subsequent work. No fourth round is authorized.

### Delivery and follow-on enforcement
PRs declare UI-relevant yes/no with a one-sentence reason; no does not permit hiding UI-affecting work.
DG01 documents this contract; no automated queue/verdict/font/bundler enforcement is claimed built.
DG02 binds actual-head checker/Mergify; DG03 independently binds all-design-CSS12px/contrast afterDG01; DG04 followsDG02 for actual bundler/source-head refusal and n/N.
A NOT PASS exception requires Elias's concrete authorization bound to actual head/scope; an exception label alone is not authorization.
Root/Stabs retain source admission,PLAN,review-ok/Mergify. Existing inactive/locked deliveries remain locked until their actual required PASS/new-image/source evidence is accepted.

After DG-04 actually merges, the critic procedure MUST run node scripts/dev/design-bundle.mjs --head <current-PR-head> --png-dir <PNGdir> --manifest <manifest.json> --out <fresh-bundleIndex.json> and retain its exact-head/hash/complete-matrix index with separately labelled bundled and recorded-author/critic coverage; this future caller is not claimed implemented by DG-01.
