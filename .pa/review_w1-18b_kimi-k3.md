# Review w1-18b - kimi-k3

- Status: ok
- Reviewer: kimi-k3 (kind ollama)
- Model requested: kimi-k3:cloud
- Model reported: kimi-k3
- Author of the candidate: Claude Sonnet 5
- Prompt: .pa/review_prompt_w1-18b.md (16590 chars, sha256 818d1d467b2915d9)
- Time: 2026-09-25T23:56:59Z

---

## Review: W1-18b (de57a41)

| ID | Severity | file:line | Reasoning |
|---|---|---|---|
| P-1 | minor | src-tauri/src/profiles.rs:~517 (comment on the new W1-18b test) | The comment states as fact: "The model flag does not change discovery, so the glm variant is covered by the same probe." Observed was only the bare `opencode debug skill --pure` invocation; the `opencode -m opencode-go/glm-5.3-flash` command line was never run. Since `--pure` makes no model call, the `-m` path was not exercised at all — so the capability declaration for `opencode-glm-53-flash` rests on a transparently disclosed inference, not an observation. The inference is plausible (same binary, discovery is model-independent) and no doc overclaims for glm, but it collides with the repo's own rule "no claim about a behaviour that was not observed." Two cheap fixes: (a) re-probe once with the exact arg list (`opencode -m opencode-go/glm-5.3-flash debug skill --pure` — no model call, so not blocked by the rate limit) and record the result, or (b) mark the sentence explicitly as an assumption. |
| P-2 | minor | scripts/lib/hq-profile-contract.test.mjs:75–100 (mirror test) | The drift gate parses `capabilities.rs` by regex/brace-walking: it requires the literal `pub enum <Name> {` on one line, counts braces without skipping comments, and matches variants via `^\s*(\w+)(?:\s*\{([^}]*)\})?,`. Multi-line struct variants happen to work (`[^}]` spans newlines), but a rustfmt restyle of the enum header, `{`/`}` inside an enum-body doc comment, or a future non-`String` field type will break the parse. All of these fail *loudly* (and the injected-drift self-check proves the comparison trips), so the gate can never silently pass — acceptable as an alarm, but expect spurious CI failures after reformatting `capabilities.rs`. Advisory, no rework required. |
| P-3 | info | scripts/lib/hq-profile-contract.test.mjs:75 | `import.meta.dirname` requires Node ≥ 20.11. The engines pin is not visible in the diff; if `scripts/lib` already uses it or the repo requires Node ≥ 20.11 (likely for the Tauri 2 toolchain), this is a non-issue. Flagged only because it cannot be verified from the diff. |
| P-4 | info | docs/setup/README.md:56 | "(Codex-Konvention; liest OpenCode seit der W1-18b-Probe ebenfalls)" is the loosest claim in the package: what was observed is `debug skill --pure` *listing* a canary, i.e. discovery. The table row above and opencode.md stay precise ("findet `.agents/skills/` von selbst", "kein Modellaufruf"), so no model-use claim remains anywhere; consider "findet/erkennt … ebenfalls" for symmetry. Advisory. |

Explicitly checked, no findings: seams (api.rs, main.rs, store.rs, bin/pa.rs) untouched; no secrets/personal data/absolute user paths (`~/.config/opencode/` is generic and pre-existing); the validator change is additive (no previously valid profile regresses) and the sibling bug (validator rejected the documented `conventionAt` mode) carries a compiling regression test that fails red on the merge base together with the two other new tests — the reported measured red (cargo 3 failed / node 2 failed) matches exactly the tests in this diff; the mirror test's failure direction is always loud, and the Rust wire format (`"dir": ".agents/skills"` ↔ `ConventionAt { dir }`) is pinned by the Rust test itself; counts in PRODUCT.md/README (3-of-5 vs 2 undelivered) are internally consistent; Codex stays `unsupported` with a pinning test and a stated deferral reason.

Verdict: **freigeben mit Auflagen** — einzige Auflage ist P-1 (die glm-Aussage entweder durch einmaliges Re-Proben der exakten Kommandozeile belegen oder im Kommentar ausdrücklich als Annahme kennzeichnen); P-2 bis P-4 sind Hinweise ohne Auflagen-Charakter.
