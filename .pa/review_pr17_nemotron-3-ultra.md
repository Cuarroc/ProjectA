# Review: pr17 — kilo/nvidia/nemotron-3-ultra-550b-a55b:free

- Autor des Artefakts: kimi (Kimi Code CLI)
- Reviewer: Nemotron 3 Ultra 550B (Nvidia, Gratis-Modell) über Kilo CLI 7.5.9 (`kilo run -m kilo/nvidia/nemotron-3-ultra-550b-a55b:free --agent plan`), einmaliger Aufruf im Vordergrund, Dauer 1 min 45 s, Exit 0
- Kandidat: `60f0f6a5cfa230216d3d67224138d7a119e7da0b` (Branch claude/w5-02b5, Diff `origin/main...HEAD`, nur src-tauri/)
- Prompt: `review_prompt_pr17.md` (Prompt-Datei angehängt, Diff mit 40 Zeilen Kontext)
- Antwort unverändert (inklusive der ANSI-Reste der Kilo-Ausgabe) ab der Trennlinie.

---

[0m
> plan · nvidia/nemotron-3-ultra-550b-a55b:free
[0m
## Findings

| ID | Severity | File:Line | Explanation |
|----|----------|-----------|-------------|
| F1 | high | agent_env.rs:294-398 | `HeaderServer` is a well-designed std-only loopback HTTP helper. Correctly handles non-blocking listener on Windows (re-sets accepted sockets to blocking), captures request headers before responding, and cleans up the thread in `Drop`. No external deps, fully portable. |
| F2 | high | agent_env.rs:430-464 | `strict_agent_env_resets_a_generic_http_extra_header`: deterministic test proving the empty `http.extraHeader` in `STRICT_GIT_CONFIG` actually resets a generic header from repo config. Uses fake token, local server, tests both inherit (passes) and strict (blocked). |
| F3 | high | agent_env.rs:466-526 | `strict_agent_env_url_scoped_extra_header_is_a_known_leak`: pins the known git boundary where `http.<url>.extraHeader` defeats the generic reset via urlmatch best-match logic. Test will turn red if git changes this behavior; comments and module doc make this unmistakable. |
| F4 | high | agent_env.rs:528-582 | `strict_agent_env_keeps_the_users_signing_mandate`: implements the W5-02b review K6 decision. Verifies `STRICT_GIT_CONFIG` names no signing keys; a mandated `commit.gpgsign=true` with `gpg.program=git` fails loudly (no hang, no unsigned commit). Clever portable stand-in signer. |
| F5 | medium | agent_env.rs:95-105, 117-121, 204-211 | Module docs updated to reflect: test-backed reset, pinned URL-scoped leak boundary, and deliberate signing non-interference. Clear, accurate, and bound to the tests. |
| F6 | low | agent_env.rs:402-409 | `without_proxy` strips only uppercase proxy vars. On Linux, lowercase variants (`http_proxy`) could theoretically leak, but loopback with `NO_PROXY` mitigates; acceptable for test scope. |
| F7 | low | (not in diff) | Prompt mentions "unrelated formatting normalization in skills.rs" but diff only shows `agent_env.rs`. If that change is in the candidate commit, it was not provided for review. |

## Verdict

**freigeben** — All three tests are deterministic, portable, secret-free, and prove the intended behavior; the known leak is explicitly pinned and documented; the GPG decision is correctly implemented per user direction; no new dependencies; module docs are accurate and test-backed.
