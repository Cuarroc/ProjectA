| ID | severity | file:line | reasoning |
|----|----------|-----------|-----------|
| 1 | minor | src-tauri/src/profiles.rs:220-223 | GLM variant (`opencode-glm-53-flash`) inherits `ConventionAt` from base `opencode` profile based on assumption ("same binary, `-m` model flag discovers the same way"); explicitly documented as assumption since `--pure` makes no model call. Not a blocker because labeled transparently, but future probe should validate or revert. |
| 2 | minor | scripts/lib/hq-profile-contract.test.mjs:177 | Test uses `new Function()` to evaluate the mode table from source text; works for test but unconventional. No functional issue, just style. |
| 3 | info | docs/setup/opencode.md:94-98 | Documentation states "OpenCode 1.18.32 findet `.agents/skills/` von selbst — geprobt am 25.09. (W1-18b) mit `opencode debug skill --pure` in einem isolierten Canary-Workspace, kein Modellaufruf (Beleg: PR-Text von W1-18b)." Evidence is referenced to PR text (this diff), not an external artifact. Acceptable per rule 12 since probe observation is documented in the change itself. |

**Verdict: freigeben mit Auflagen**  
Auflage: GLM-Varianten-Annahme (Finding 1) bei nächster Gelegenheit nachproben (nach Rate-Limit-Ende oder separater Test) und Profil bei negativem Befund auf `Unsupported` zurücksetzen.
