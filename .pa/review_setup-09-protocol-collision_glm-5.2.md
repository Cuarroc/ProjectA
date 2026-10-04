# Review setup-09-protocol-collision - glm-5.2

- Status: ok
- Reviewer: glm-5.2 (kind ollama)
- Model requested: glm-5.2:cloud
- Model reported: glm-5.2
- Author of the candidate: -
- Prompt: .pa/review_prompt_setup-09-protocol-collision.md (13841 chars, sha256 a5a39347740db601)
- Time: 2026-10-04T07:12:30Z

---

## Findings

**F1 — low — scripts/review/run-local.sh:157 (`proto_name`, `tr -c`)**
The `tr -c 'A-Za-z0-9._-' '-'` preserves case, so `Llama3:8b` and `llama3:8b` produce distinct proto-names (`Llama3-8b` vs `llama3-8b`) and pass the collision check. On a case-insensitive filesystem (macOS APFS default) both would write to the same file. The collision check would not catch this. Low because model names are conventionally lowercase and the transport's `slug()` likely has the same limitation.

**F2 — low — scripts/review/run-local.sh:148-160 (`proto_name` vs transport `slug()`)**
The comment asserts `proto_name` produces "dieselbe Form, die `slug()` im Transport anwendet." The transport code is not in this diff, so the equivalence cannot be verified here. If the transport's `slug()` applies any additional transformation (e.g., lowercasing, collapsing repeated `-`, trimming), the collision check could pass while files still collide on disk, or vice versa. The tests are consistent with the current `proto_name` output, so this is informational, not a confirmed bug.

---

The red-test-first workflow is followed (commit `ae5a66b` adds the failing test, `1cbe02b` applies the fix). The test covers both ollama and kilo collision paths, verifies that kilo is never invoked on collision, and confirms the non-colliding prefix case produces two distinct files. The collision check is correctly placed before prompt building and before any reviewer invocation, so no side effects occur on rejection. The loop refactor from `for m in "${models[@]}"` to indexed `for i in "${!models[@]}"` is consistent in both the ollama and kilo sections.

Verdict: **approve**
