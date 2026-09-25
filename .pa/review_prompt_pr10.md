# Full Review LIC-01 — license audit gate and third-party notices (PR #10)

You are reviewing a pull request as an external reviewer. Do NOT use any tools,
do NOT read or modify any files — the complete substantive diff is embedded
below. Respond with findings only.

## Context

ProjectA is a public Tauri 2 desktop app (Rust backend + React/Vite frontend,
MIT-licensed). LIC-01 adds a CI license gate so that no third-party dependency
without an approved license can enter the repo:

- `scripts/ci/license-check.sh` — new gate step, wired into `scripts/ci/gates.sh`.
  Runs `cargo deny check licenses` for Rust (pinned cargo-deny 0.20.2, probe
  tolerates a missing tool, post-install re-verify against PATH shadowing) and
  `node scripts/lib/license-check.mjs` for npm (via license-checker JSON).
- `scripts/lib/license-check.mjs` — npm license evaluator against a fixed
  allowlist (ALLOWED_LICENSES). Real SPDX semantics via a recursive-descent
  parser: AND binds tighter than OR, parentheses group, "X WITH Y" re-joined,
  a trailing `*` (license-checker's inferred-from-file marker) is stripped but
  logged, arrays are evaluated element-wise, empty/missing/malformed licenses
  FAIL CLOSED (violation, never silently pass).
- `scripts/lib/license-check.test.mjs` — node:test suite including a drift pin:
  the `[licenses]` allow array in `src-tauri/deny.toml` must exactly mirror
  ALLOWED_LICENSES.
- `src-tauri/deny.toml` — cargo-deny configuration with the mirrored allowlist.
- `docs/THIRD_PARTY_NOTICES.md` — third-party attribution notices.
- `src-tauri/src/skills.rs` — small related change.

The user rule behind the allowlist: only MIT, Apache-2.0, BSD, ISC, MPL-2.0,
Zlib, Unicode, CC0, OFL (and similar permissive) are allowed; GPL/AGPL/LGPL/
SSPL/unknown are NOT allowed without an orchestrator decision. The gate
intentionally stays red on `webpki-root-certs` (CDLA-Permissive-2.0) — that is
an open orchestrator decision item, NOT part of this review.

Not shown in the diff below: ~40 files with mode-only changes (restored exec
bits on shell scripts) and the `.pa/` review artifacts of earlier rounds.
Earlier review rounds (two other models) already fixed: flat SPDX parsing
(parenthesis smuggling), non-fail-closed empty license arrays, unscoped
deny.toml drift regex, and shell robustness of the cargo-deny probe.

## What to check especially

- Can any disallowed license still slip through the SPDX parser or the
  fail-closed paths (precedence, WITH re-join, `*` strip, short-circuit
  evaluation consuming all tokens, arrays, UNKNOWN handling)?
- Does the deny.toml drift pin actually scope to `[licenses]` and would it
  catch real drift both ways (toml-only entry, mjs-only entry)?
- Shell gate: can license-check.sh pass when it should fail (probe logic,
  `fails` accumulation, exit codes, npm side)?
- Are the third-party notices consistent with what the gate enforces?
- Any secrets, personal data, or locally-meaningless paths introduced?

Output format: findings with ID (F1, F2, ...), severity (high/medium/low),
file:line, reasoning. End with an overall verdict (approve / approve with
conditions / reject).

## Diff (base: origin/main)

```diff
diff --git a/docs/THIRD_PARTY_NOTICES.md b/docs/THIRD_PARTY_NOTICES.md
new file mode 100644
index 0000000..0c84a09
--- /dev/null
+++ b/docs/THIRD_PARTY_NOTICES.md
@@ -0,0 +1,99 @@
+# Third-Party Notices
+
+ProjectA bundles or depends on the third-party software listed below. Every
+entry carries a license from the allowlist approved for this public
+repository (`MIT, Apache-2.0 (WITH LLVM-exception), BSD-2/3-Clause, ISC,
+MPL-2.0, Zlib, Unicode-3.0/Unicode-DFS-2016, CC0-1.0, 0BSD, BSL-1.0`, plus
+`OFL-1.1` for fonts). The list is enforced in CI by the `licenses` gate
+(`scripts/ci/license-check.sh`, policy in `src-tauri/deny.toml` and
+`scripts/lib/license-check.mjs`).
+
+Regenerate this file after dependency changes:
+
+```sh
+cd src-tauri && cargo deny list          # Rust section
+npx --yes license-checker-rseidelsohn --production --json   # npm section
+```
+
+## Required notices (Attribution)
+
+- **Inter font** (`public/fonts/Inter-*.otf`): SIL Open Font License 1.1.
+  The license text ships next to the fonts as `public/fonts/INTER-LIZENZ.txt`.
+  Copyright 2016-2023 The Inter Project Authors.
+- **Recursive font** (`docs/dev-hq/fonts/recursive-latin-wght.woff2`): SIL
+  Open Font License 1.1, license text next to it as `docs/dev-hq/fonts/OFL.txt`.
+- **prompt-master** (`src-tauri/resources/prompt-master/`): MIT License,
+  Copyright (c) 2026 Nidhin Joseph Nelson. License text: `LICENSE` in that
+  directory.
+- **taste-skill** (`src-tauri/resources/skills/taste-skill/`): MIT License,
+  Copyright (c) 2026 Leonxlnx. License text: `LICENSE` in that directory.
+- **unlazy** (`src-tauri/resources/skills/unlazy/`): MIT License,
+  Copyright (c) 2026 Leonxlnx. License text: `LICENSE` in that directory.
+- **claude-code-setup** (`src-tauri/resources/skills/claude-code-setup/`):
+  Apache License 2.0. License text: `LICENSE` in that directory (the upstream
+  copyright line is the unmodified Apache template; no NOTICE file ships
+  upstream).
+- **MPL-2.0 crates** (cssparser, cssparser-macros, dtoa-short, option-ext,
+  selectors): used unmodified as compiled dependencies; their source is
+  available on crates.io as required by MPL-2.0 §3.2.
+- **Project-owned artwork**: `assets/banner.svg`, `src-tauri/icons/*` and the
+  diagrams under `docs/dev-hq/concepts/` are original ProjectA artwork, not
+  third-party material.
+
+The placeholder skills under `src-tauri/resources/skills/` (karpathy-guidelines,
+minimalist-skill, planning-with-files, ui-ux-pro-max, web-design-guidelines)
+are intentionally *not* bundled third-party packs: each placeholder documents
+why the pack is absent and ships no third-party content.
+
+## npm production dependencies
+
+| Package | License |
+|---|---|
+| @tauri-apps/api@2.11.1 | Apache-2.0 OR MIT |
+| @tauri-apps/plugin-process@2.3.1 | MIT OR Apache-2.0 |
+| @tauri-apps/plugin-updater@2.11.0 | MIT OR Apache-2.0 |
+| @xterm/addon-canvas@0.7.0 | MIT |
+| @xterm/addon-fit@0.10.0 | MIT |
+| @xterm/addon-search@0.15.0 | MIT |
+| @xterm/addon-webgl@0.18.0 | MIT |
+| @xterm/xterm@5.5.0 | MIT |
+| js-tokens@4.0.0 | MIT |
+| loose-envify@1.4.0 | MIT |
+| react-dom@18.3.1 | MIT |
+| react@18.3.1 | MIT |
+| scheduler@0.23.2 | MIT |
+
+(The root package `projecta` itself is excluded; its own license is a LIC-01
+decision item, see the PR.)
+
+## Rust dependencies
+
+Generated with `cargo deny list` (cargo-deny 0.20.2, see `src-tauri/deny.toml`).
+Each line groups the crates that list the named license; crates under an
+`OR` expression appear under every alternative, but only one needs to be on
+the allowlist for the gate to pass. `LGPL-2.1-or-later` (r-efi), `MIT-0`
+(dunce) and `Unlicense` (aho-corasick and others) below are such
+alternatives of expressions that also offer an allowed license
+(MIT/Apache-2.0/CC0-1.0) — ProjectA relies on the allowed alternative.
+`CDLA-Permissive-2.0` (webpki-root-certs) is **not** on the allowlist and is
+a LIC-01 "Needs decision" finding; the `licenses` gate fails until the
+orchestrator decides.
+
+```text
+0BSD (1): adler2@2.0.1
+Apache-2.0 (366): adler2@2.0.1, allocator-api2@0.2.21, android_log-sys@0.3.2, android_logger@0.15.1, anyhow@1.0.104, arbitrary@1.4.2, async-broadcast@0.7.2, async-channel@2.5.0, async-executor@1.14.0, async-io@2.6.0, async-lock@3.4.2, async-process@2.5.0, async-recursion@1.1.1, async-signal@0.2.14, async-task@4.7.1, async-trait@0.1.92, atomic-waker@1.1.2, autocfg@1.5.1, base64@0.21.7, base64@0.22.1, base64@0.23.1, bit-set@0.8.0, bit-vec@0.8.0, bitflags@1.3.2, bitflags@2.13.2, block-buffer@0.10.4, blocking@1.7.0, bumpalo@3.20.3, bytemuck@1.25.2, camino@1.2.6, cargo-platform@0.1.9, cargo_toml@0.22.3, cc@1.4.6, cesu8@1.1.0, cfg-expr@0.15.8, cfg-if@1.0.4, concurrent-queue@2.5.0, cookie@0.18.2, core-foundation@0.10.1, core-foundation@0.9.4, core-foundation-sys@0.8.7, core-graphics@0.25.0, core-graphics-types@0.2.0, cpufeatures@0.2.17, crc@3.4.0, crc-catalog@2.5.0, crc32fast@1.5.2, crossbeam-channel@0.5.17, crossbeam-queue@0.3.14, crossbeam-utils@0.8.23, crypto-common@0.1.7, ctor@0.8.0, ctor-proc-macro@0.0.7, dbus@0.9.12, deranged@0.5.8, derive_arbitrary@1.4.2, digest@0.10.7, dirs@6.0.0, dirs-sys@0.5.0, dispatch2@0.3.1, displaydoc@0.2.7, downcast-rs@1.2.1, dpi@0.1.2, dtoa@1.0.11, dunce@1.0.5, dyn-clone@1.0.20, either@1.18.0, embed_plist@1.2.2, enumflags2@0.7.12, enumflags2_derive@0.7.12, env_filter@0.1.4, equivalent@1.0.2, erased-serde@0.4.10, errno@0.3.14, event-listener@5.4.2, event-listener-strategy@0.5.4, fastrand@2.5.0, fdeflate@0.3.7, field-offset@0.3.6, filetime@0.2.29, find-msvc-tools@0.1.12, flate2@1.1.10, flume@0.11.1, fnv@1.0.7, foreign-types@0.5.0, foreign-types-macros@0.2.4, foreign-types-shared@0.3.1, form_urlencoded@1.2.2, futures-channel@0.3.34, futures-core@0.3.34, futures-executor@0.3.34, futures-intrusive@0.5.0, futures-io@0.3.34, futures-lite@2.6.1, futures-macro@0.3.34, futures-sink@0.3.34, futures-task@0.3.34, futures-util@0.3.34, getrandom@0.2.17, getrandom@0.3.4, getrandom@0.4.3, glob@0.3.4, hashbrown@0.12.3, hashbrown@0.15.5, hashbrown@0.17.1, hashlink@0.10.0, heck@0.4.1, heck@0.5.0, hermit-abi@0.5.3, hex@0.4.3, html5ever@0.38.0, http@1.5.0, httparse@1.10.1, hyper-rustls@0.27.9, ident_case@1.0.1, idna@1.1.0, idna_adapter@1.2.2, indexmap@1.9.3, indexmap@2.14.2, ipnet@2.12.2, itoa@1.0.18, jni@0.21.1, jni@0.22.4, jni-macros@0.22.4, jni-sys@0.3.1, jni-sys@0.4.1, jni-sys-macros@0.4.1, js-sys@0.3.105, json-patch@3.0.1, jsonptr@0.6.3, keyboard-types@0.7.0, lazy_static@1.5.0, libc@0.2.189, libdbus-sys@0.2.7, linux-raw-sys@0.12.1, lock_api@0.4.14, log@0.4.34, markup5ever@0.38.0, mime@0.3.17, miniz_oxide@0.8.9, miniz_oxide@0.9.1, muda@0.19.3, ndk@0.9.0, ndk-sys@0.6.0+11769913, num-conv@0.2.2, num-traits@0.2.19, num_enum@0.7.6, num_enum_derive@0.7.6, num_threads@0.1.7, objc2-app-kit@0.3.2, objc2-cloud-kit@0.3.2, objc2-core-data@0.3.2, objc2-core-foundation@0.3.2, objc2-core-graphics@0.3.2, objc2-core-image@0.3.2, objc2-core-location@0.3.2, objc2-core-text@0.3.2, objc2-exception-helper@0.1.1, objc2-osa-kit@0.3.2, objc2-quartz-core@0.3.2, objc2-ui-kit@0.3.2, objc2-user-notifications@0.3.2, objc2-web-kit@0.3.2, once_cell@1.21.4, openssl-probe@0.2.1, ordered-stream@0.2.0, osakit@0.3.1, parking@2.2.1, parking_lot@0.12.5, parking_lot_core@0.9.12, percent-encoding@2.3.2, pin-project-lite@0.2.17, piper@0.2.5, pkg-config@0.3.34, png@0.17.16, png@0.18.1, polling@3.11.0, powerfmt@0.2.0, proc-macro-crate@1.3.1, proc-macro-crate@2.0.2, proc-macro-crate@3.5.0, proc-macro-error@1.0.4, proc-macro-error-attr@1.0.4, proc-macro2@1.0.107, quote@1.0.47, r-efi@5.3.0, r-efi@6.0.0, raw-window-handle@0.6.2, regex@1.13.1, regex-automata@0.4.18, regex-syntax@0.8.11, reqwest@0.13.5, ring@0.17.14, rustc-hash@2.1.3, rustc_version@0.4.1, rustix@1.1.4, rustls@0.23.45, rustls-native-certs@0.8.4, rustls-pki-types@1.15.1, rustls-platform-verifier@0.7.0, rustls-platform-verifier-android@0.1.1, rustversion@1.0.23, ryu@1.0.23, scopeguard@1.2.0, security-framework@3.7.0, security-framework-sys@2.17.0, semver@1.0.28, serde@1.0.229, serde-untagged@0.1.9, serde_core@1.0.229, serde_derive@1.0.229, serde_derive_internals@0.29.1, serde_json@1.0.151, serde_repr@0.1.21, serde_spanned@0.6.9, serde_spanned@1.1.1, serde_urlencoded@0.7.1, serde_with@3.23.0, serde_with_macros@3.23.0, serial2@0.2.38, serialize-to-javascript@0.1.2, serialize-to-javascript-impl@0.1.2, servo_arc@0.4.3, sha2@0.10.9, shared_library@0.1.9, shell-words@1.1.1, shlex@2.0.1, signal-hook-registry@1.4.8, simd_cesu8@1.2.0, simdutf8@0.1.5, siphasher@1.0.3, smallvec@1.16.1, socket2@0.6.5, softbuffer@0.4.8, sqlx@0.8.6, sqlx-core@0.8.6, sqlx-macros@0.8.6, sqlx-macros-core@0.8.6, sqlx-sqlite@0.8.6, stable_deref_trait@1.2.1, string_cache@0.9.0, string_cache_codegen@0.6.1, swift-rs@1.0.8, syn@1.0.109, syn@2.0.119, syn@3.0.5, sync_wrapper@1.0.2, system-configuration@0.7.0, system-configuration-sys@0.6.0, system-deps@6.2.2, tao@0.35.3, tao-macros@0.1.4, tar@0.4.46, tauri@2.11.6, tauri-build@2.6.3, tauri-codegen@2.6.3, tauri-macros@2.6.3, tauri-plugin@2.6.3, tauri-plugin-log@2.9.2, tauri-plugin-opener@2.5.5, tauri-plugin-process@2.3.1, tauri-plugin-single-instance@2.4.5, tauri-plugin-updater@2.12.0, tauri-runtime@2.11.3, tauri-runtime-wry@2.11.4, tauri-utils@2.9.3, tempfile@3.27.0, tendril@0.5.1, thiserror@1.0.69, thiserror@2.0.20, thiserror-impl@1.0.69, thiserror-impl@2.0.20, time@0.3.55, time-core@0.1.9, time-macros@0.2.32, tokio-rustls@0.26.5, toml@0.8.2, toml@0.9.12+spec-1.1.0, toml@1.1.6+spec-1.1.0, toml_datetime@0.6.3, toml_datetime@0.7.5+spec-1.1.0, toml_datetime@1.1.1+spec-1.1.0, toml_edit@0.19.15, toml_edit@0.20.2, toml_edit@0.25.15+spec-1.1.0, toml_parser@1.1.3+spec-1.1.0, toml_writer@1.1.2+spec-1.1.0, typeid@1.0.3, typenum@1.20.1, unic-char-property@0.9.0, unic-char-range@0.9.0, unic-common@0.9.0, unic-ucd-ident@0.9.0, unic-ucd-version@0.9.0, unicode-ident@1.0.24, unicode-segmentation@1.13.3, url@2.5.8, utf8_iter@1.0.4, uuid@1.26.1, vcpkg@0.2.15, version_check@0.9.5, wasi@0.11.1+wasi-snapshot-preview1, wasip2@1.0.4+wasi-0.2.12, wasm-bindgen@0.2.128, wasm-bindgen-futures@0.4.78, wasm-bindgen-macro@0.2.128, wasm-bindgen-macro-support@0.2.128, wasm-bindgen-shared@0.2.128, wasm-streams@0.5.0, web-sys@0.3.105, web_atoms@0.2.6, winapi@0.3.9, winapi-i686-pc-windows-gnu@0.4.0, winapi-x86_64-pc-windows-gnu@0.4.0, window-vibrancy@0.6.0, windows@0.61.3, windows-collections@0.2.0, windows-core@0.61.2, windows-future@0.2.1, windows-implement@0.60.2, windows-interface@0.59.3, windows-link@0.1.3, windows-link@0.2.1, windows-numerics@0.2.0, windows-registry@0.6.1, windows-result@0.3.4, windows-result@0.4.1, windows-strings@0.4.2, windows-strings@0.5.1, windows-sys@0.45.0, windows-sys@0.52.0, windows-sys@0.59.0, windows-sys@0.60.2, windows-sys@0.61.2, windows-targets@0.42.2, windows-targets@0.52.6, windows-targets@0.53.5, windows-threading@0.1.0, windows-version@0.1.7, windows_aarch64_gnullvm@0.42.2, windows_aarch64_gnullvm@0.52.6, windows_aarch64_gnullvm@0.53.1, windows_aarch64_msvc@0.42.2, windows_aarch64_msvc@0.52.6, windows_aarch64_msvc@0.53.1, windows_i686_gnu@0.42.2, windows_i686_gnu@0.52.6, windows_i686_gnu@0.53.1, windows_i686_gnullvm@0.52.6, windows_i686_gnullvm@0.53.1, windows_i686_msvc@0.42.2, windows_i686_msvc@0.52.6, windows_i686_msvc@0.53.1, windows_x86_64_gnu@0.42.2, windows_x86_64_gnu@0.52.6, windows_x86_64_gnu@0.53.1, windows_x86_64_gnullvm@0.42.2, windows_x86_64_gnullvm@0.52.6, windows_x86_64_gnullvm@0.53.1, windows_x86_64_msvc@0.42.2, windows_x86_64_msvc@0.52.6, windows_x86_64_msvc@0.53.1, wit-bindgen@0.57.1, wry@0.55.1, xattr@1.6.1, zeroize@1.9.0
+Apache-2.0 WITH LLVM-exception (6): linux-raw-sys@0.12.1, rustix@1.1.4, target-lexicon@0.12.16, wasi@0.11.1+wasi-snapshot-preview1, wasip2@1.0.4+wasi-0.2.12, wit-bindgen@0.57.1
+BSD-2-Clause (1): serial2@0.2.38
+BSD-3-Clause (7): alloc-no-stdlib@2.0.4, alloc-stdlib@0.2.4, brotli@8.0.4, brotli-decompressor@5.0.3, num_enum@0.7.6, num_enum_derive@0.7.6, subtle@2.6.1
+BSL-1.0 (1): ryu@1.0.23
+CC0-1.0 (1): dunce@1.0.5
+CDLA-Permissive-2.0 (1): webpki-root-certs@1.0.9
+ISC (6): hyper-rustls@0.27.9, ring@0.17.14, rustls@0.23.45, rustls-native-certs@0.8.4, rustls-webpki@0.103.15, untrusted@0.9.0
+LGPL-2.1-or-later (2): r-efi@5.3.0, r-efi@6.0.0
+MIT (493): adler2@2.0.1, aho-corasick@1.1.5, allocator-api2@0.2.21, android_log-sys@0.3.2, android_logger@0.15.1, anyhow@1.0.104, arbitrary@1.4.2, async-broadcast@0.7.2, async-channel@2.5.0, async-executor@1.14.0, async-io@2.6.0, async-lock@3.4.2, async-process@2.5.0, async-recursion@1.1.1, async-signal@0.2.14, async-task@4.7.1, async-trait@0.1.92, atk@0.18.2, atk-sys@0.18.2, atoi@2.0.0, atomic-waker@1.1.2, autocfg@1.5.1, base64@0.21.7, base64@0.22.1, base64@0.23.1, bit-set@0.8.0, bit-vec@0.8.0, bitflags@1.3.2, bitflags@2.13.2, block-buffer@0.10.4, block2@0.6.2, blocking@1.7.0, brotli@8.0.4, brotli-decompressor@5.0.3, bumpalo@3.20.3, bytemuck@1.25.2, byteorder@1.5.0, bytes@1.12.1, cairo-rs@0.18.5, cairo-sys-rs@0.18.2, camino@1.2.6, cargo-platform@0.1.9, cargo_metadata@0.19.2, cargo_toml@0.22.3, cc@1.4.6, cesu8@1.1.0, cfb@0.7.3, cfg-expr@0.15.8, cfg-if@1.0.4, cfg_aliases@0.1.1, combine@4.6.8, concurrent-queue@2.5.0, cookie@0.18.2, core-foundation@0.10.1, core-foundation@0.9.4, core-foundation-sys@0.8.7, core-graphics@0.25.0, core-graphics-types@0.2.0, cpufeatures@0.2.17, crc@3.4.0, crc-catalog@2.5.0, crc32fast@1.5.2, crossbeam-channel@0.5.17, crossbeam-queue@0.3.14, crossbeam-utils@0.8.23, crypto-common@0.1.7, ctor@0.8.0, ctor-proc-macro@0.0.7, darling@0.24.1, darling_core@0.24.1, darling_macro@0.24.1, dbus@0.9.12, deranged@0.5.8, derive_arbitrary@1.4.2, derive_more@2.1.1, derive_more-impl@2.1.1, digest@0.10.7, dirs@6.0.0, dirs-sys@0.5.0, dispatch2@0.3.1, displaydoc@0.2.7, dlopen2@0.8.2, dlopen2_derive@0.4.3, dom_query@0.27.0, dotenvy@0.15.7, downcast-rs@1.2.1, dpi@0.1.2, dtoa@1.0.11, dyn-clone@1.0.20, either@1.18.0, embed-resource@3.0.11, embed_plist@1.2.2, endi@1.1.1, enumflags2@0.7.12, enumflags2_derive@0.7.12, env_filter@0.1.4, equivalent@1.0.2, erased-serde@0.4.10, errno@0.3.14, event-listener@5.4.2, event-listener-strategy@0.5.4, fastrand@2.5.0, fdeflate@0.3.7, fern@0.7.1, field-offset@0.3.6, filedescriptor@0.8.3, filetime@0.2.29, find-msvc-tools@0.1.12, flate2@1.1.10, flume@0.11.1, fnv@1.0.7, foreign-types@0.5.0, foreign-types-macros@0.2.4, foreign-types-shared@0.3.1, form_urlencoded@1.2.2, futures-channel@0.3.34, futures-core@0.3.34, futures-executor@0.3.34, futures-intrusive@0.5.0, futures-io@0.3.34, futures-lite@2.6.1, futures-macro@0.3.34, futures-sink@0.3.34, futures-task@0.3.34, futures-util@0.3.34, gdk@0.18.2, gdk-pixbuf@0.18.5, gdk-pixbuf-sys@0.18.0, gdk-sys@0.18.2, gdkwayland-sys@0.18.2, gdkx11@0.18.2, gdkx11-sys@0.18.2, generic-array@0.14.7, getrandom@0.2.17, getrandom@0.3.4, getrandom@0.4.3, gio@0.18.4, gio-sys@0.18.1, glib@0.18.5, glib-macros@0.18.5, glib-sys@0.18.1, glob@0.3.4, gobject-sys@0.18.0, gtk@0.18.2, gtk-sys@0.18.2, gtk3-macros@0.18.2, hashbrown@0.12.3, hashbrown@0.15.5, hashbrown@0.17.1, hashlink@0.10.0, heck@0.4.1, heck@0.5.0, hermit-abi@0.5.3, hex@0.4.3, html5ever@0.38.0, http@1.5.0, http-body@1.1.0, http-body-util@0.1.5, httparse@1.10.1, hyper@1.11.1, hyper-rustls@0.27.9, hyper-util@0.1.20, ico@0.5.0, ident_case@1.0.1, idna@1.1.0, idna_adapter@1.2.2, indexmap@1.9.3, indexmap@2.14.2, infer@0.19.0, ipnet@2.12.2, is-docker@0.2.0, is-wsl@0.4.0, itoa@1.0.18, javascriptcore-rs@1.1.2, javascriptcore-rs-sys@1.1.1, jni@0.21.1, jni@0.22.4, jni-macros@0.22.4, jni-sys@0.3.1, jni-sys@0.4.1, jni-sys-macros@0.4.1, js-sys@0.3.105, json-patch@3.0.1, jsonptr@0.6.3, keyboard-types@0.7.0, lazy_static@1.5.0, libc@0.2.189, libdbus-sys@0.2.7, libredox@0.1.24, libsqlite3-sys@0.30.1, linux-raw-sys@0.12.1, lock_api@0.4.14, log@0.4.34, markup5ever@0.38.0, memchr@2.8.3, memoffset@0.9.1, mime@0.3.17, minisign-verify@0.2.5, miniz_oxide@0.8.9, miniz_oxide@0.9.1, mio@1.2.3, muda@0.19.3, ndk@0.9.0, ndk-sys@0.6.0+11769913, new_debug_unreachable@1.0.6, nix@0.28.0, num-conv@0.2.2, num-traits@0.2.19, num_enum@0.7.6, num_enum_derive@0.7.6, num_threads@0.1.7, objc2@0.6.4, objc2-app-kit@0.3.2, objc2-cloud-kit@0.3.2, objc2-core-data@0.3.2, objc2-core-foundation@0.3.2, objc2-core-graphics@0.3.2, objc2-core-image@0.3.2, objc2-core-location@0.3.2, objc2-core-text@0.3.2, objc2-encode@4.1.0, objc2-exception-helper@0.1.1, objc2-foundation@0.3.2, objc2-osa-kit@0.3.2, objc2-quartz-core@0.3.2, objc2-ui-kit@0.3.2, objc2-user-notifications@0.3.2, objc2-web-kit@0.3.2, once_cell@1.21.4, open@5.4.4, openssl-probe@0.2.1, ordered-stream@0.2.0, osakit@0.3.1, pango@0.18.3, pango-sys@0.18.0, parking@2.2.1, parking_lot@0.12.5, parking_lot_core@0.9.12, percent-encoding@2.3.2, phf@0.13.1, phf_codegen@0.13.1, phf_generator@0.13.1, phf_macros@0.13.1, phf_shared@0.13.1, pin-project-lite@0.2.17, piper@0.2.5, pkg-config@0.3.34, plist@1.10.1, png@0.17.16, png@0.18.1, polling@3.11.0, portable-pty@0.9.0, powerfmt@0.2.0, precomputed-hash@0.1.1, proc-macro-crate@1.3.1, proc-macro-crate@2.0.2, proc-macro-crate@3.5.0, proc-macro-error@1.0.4, proc-macro-error-attr@1.0.4, proc-macro2@1.0.107, quick-xml@0.42.0, quote@1.0.47, r-efi@5.3.0, r-efi@6.0.0, raw-window-handle@0.6.2, redox_syscall@0.5.18, redox_users@0.5.2, regex@1.13.1, regex-automata@0.4.18, regex-syntax@0.8.11, reqwest@0.13.5, rustc-hash@2.1.3, rustc_version@0.4.1, rustix@1.1.4, rustls@0.23.45, rustls-native-certs@0.8.4, rustls-pki-types@1.15.1, rustls-platform-verifier@0.7.0, rustls-platform-verifier-android@0.1.1, rustversion@1.0.23, same-file@1.0.6, schannel@0.1.29, schemars@0.8.22, schemars_derive@0.8.22, scopeguard@1.2.0, security-framework@3.7.0, security-framework-sys@2.17.0, semver@1.0.28, serde@1.0.229, serde-untagged@0.1.9, serde_core@1.0.229, serde_derive@1.0.229, serde_derive_internals@0.29.1, serde_json@1.0.151, serde_repr@0.1.21, serde_spanned@0.6.9, serde_spanned@1.1.1, serde_urlencoded@0.7.1, serde_with@3.23.0, serde_with_macros@3.23.0, serialize-to-javascript@0.1.2, serialize-to-javascript-impl@0.1.2, servo_arc@0.4.3, sha2@0.10.9, shared_library@0.1.9, shell-words@1.1.1, shlex@2.0.1, signal-hook-registry@1.4.8, simd-adler32@0.3.10, simd_cesu8@1.2.0, simdutf8@0.1.5, siphasher@1.0.3, slab@0.4.12, smallvec@1.16.1, socket2@0.6.5, softbuffer@0.4.8, soup3@0.5.0, soup3-sys@0.5.0, spin@0.9.9, sqlx@0.8.6, sqlx-core@0.8.6, sqlx-macros@0.8.6, sqlx-macros-core@0.8.6, sqlx-sqlite@0.8.6, stable_deref_trait@1.2.1, string_cache@0.9.0, string_cache_codegen@0.6.1, strsim@0.11.1, swift-rs@1.0.8, syn@1.0.109, syn@2.0.119, syn@3.0.5, synstructure@0.13.2, system-configuration@0.7.0, system-configuration-sys@0.6.0, system-deps@6.2.2, tao-macros@0.1.4, tar@0.4.46, tauri@2.11.6, tauri-build@2.6.3, tauri-codegen@2.6.3, tauri-macros@2.6.3, tauri-plugin@2.6.3, tauri-plugin-log@2.9.2, tauri-plugin-opener@2.5.5, tauri-plugin-process@2.3.1, tauri-plugin-single-instance@2.4.5, tauri-plugin-updater@2.12.0, tauri-runtime@2.11.3, tauri-runtime-wry@2.11.4, tauri-utils@2.9.3, tauri-winres@0.3.6, tempfile@3.27.0, tendril@0.5.1, thiserror@1.0.69, thiserror@2.0.20, thiserror-impl@1.0.69, thiserror-impl@2.0.20, time@0.3.55, time-core@0.1.9, time-macros@0.2.32, tokio@1.53.1, tokio-macros@2.7.2, tokio-rustls@0.26.5, tokio-stream@0.1.19, tokio-util@0.7.19, toml@0.8.2, toml@0.9.12+spec-1.1.0, toml@1.1.6+spec-1.1.0, toml_datetime@0.6.3, toml_datetime@0.7.5+spec-1.1.0, toml_datetime@1.1.1+spec-1.1.0, toml_edit@0.19.15, toml_edit@0.20.2, toml_edit@0.25.15+spec-1.1.0, toml_parser@1.1.3+spec-1.1.0, toml_writer@1.1.2+spec-1.1.0, tower@0.5.3, tower-http@0.6.11, tower-layer@0.3.3, tower-service@0.3.3, tracing@0.1.44, tracing-attributes@0.1.31, tracing-core@0.1.36, try-lock@0.2.5, typeid@1.0.3, typenum@1.20.1, uds_windows@1.2.1, unic-char-property@0.9.0, unic-char-range@0.9.0, unic-common@0.9.0, unic-ucd-ident@0.9.0, unic-ucd-version@0.9.0, unicode-ident@1.0.24, unicode-segmentation@1.13.3, url@2.5.8, urlpattern@0.3.0, utf8_iter@1.0.4, uuid@1.26.1, vcpkg@0.2.15, version-compare@0.2.1, version_check@0.9.5, vswhom@0.1.0, vswhom-sys@0.1.3, walkdir@2.5.0, want@0.3.1, wasi@0.11.1+wasi-snapshot-preview1, wasip2@1.0.4+wasi-0.2.12, wasm-bindgen@0.2.128, wasm-bindgen-futures@0.4.78, wasm-bindgen-macro@0.2.128, wasm-bindgen-macro-support@0.2.128, wasm-bindgen-shared@0.2.128, wasm-streams@0.5.0, web-sys@0.3.105, web_atoms@0.2.6, webkit2gtk@2.0.2, webkit2gtk-sys@2.0.2, webview2-com@0.38.2, webview2-com-macros@0.8.1, webview2-com-sys@0.38.2, winapi@0.3.9, winapi-i686-pc-windows-gnu@0.4.0, winapi-util@0.1.11, winapi-x86_64-pc-windows-gnu@0.4.0, window-vibrancy@0.6.0, windows@0.61.3, windows-collections@0.2.0, windows-core@0.61.2, windows-future@0.2.1, windows-implement@0.60.2, windows-interface@0.59.3, windows-link@0.1.3, windows-link@0.2.1, windows-numerics@0.2.0, windows-registry@0.6.1, windows-result@0.3.4, windows-result@0.4.1, windows-strings@0.4.2, windows-strings@0.5.1, windows-sys@0.45.0, windows-sys@0.52.0, windows-sys@0.59.0, windows-sys@0.60.2, windows-sys@0.61.2, windows-targets@0.42.2, windows-targets@0.52.6, windows-targets@0.53.5, windows-threading@0.1.0, windows-version@0.1.7, windows_aarch64_gnullvm@0.42.2, windows_aarch64_gnullvm@0.52.6, windows_aarch64_gnullvm@0.53.1, windows_aarch64_msvc@0.42.2, windows_aarch64_msvc@0.52.6, windows_aarch64_msvc@0.53.1, windows_i686_gnu@0.42.2, windows_i686_gnu@0.52.6, windows_i686_gnu@0.53.1, windows_i686_gnullvm@0.52.6, windows_i686_gnullvm@0.53.1, windows_i686_msvc@0.42.2, windows_i686_msvc@0.52.6, windows_i686_msvc@0.53.1, windows_x86_64_gnu@0.42.2, windows_x86_64_gnu@0.52.6, windows_x86_64_gnu@0.53.1, windows_x86_64_gnullvm@0.42.2, windows_x86_64_gnullvm@0.52.6, windows_x86_64_gnullvm@0.53.1, windows_x86_64_msvc@0.42.2, windows_x86_64_msvc@0.52.6, windows_x86_64_msvc@0.53.1, winnow@0.5.40, winnow@0.7.15, winnow@1.0.4, winreg@0.10.1, winreg@0.55.0, wit-bindgen@0.57.1, wry@0.55.1, x11@2.21.0, x11-dl@2.21.0, xattr@1.6.1, zbus@5.19.0, zbus_macros@5.19.0, zbus_names@4.3.4, zcheapstr@1.1.0, zeroize@1.9.0, zip@4.6.1, zmij@1.0.23, zvariant@5.15.0, zvariant_derive@5.15.0, zvariant_utils@4.2.0
+MIT-0 (1): dunce@1.0.5
+MPL-2.0 (5): cssparser@0.36.0, cssparser-macros@0.6.1, dtoa-short@0.3.5, option-ext@0.2.0, selectors@0.36.1
+Unicode-3.0 (19): icu_collections@2.3.0, icu_locale_core@2.3.0, icu_normalizer@2.3.0, icu_normalizer_data@2.3.0, icu_properties@2.3.0, icu_properties_data@2.3.0, icu_provider@2.3.1, litemap@0.8.3, potential_utf@0.1.6, tinystr@0.8.4, unicode-ident@1.0.24, writeable@0.6.4, yoke@0.8.3, yoke-derive@0.8.2, zerofrom@0.1.8, zerofrom-derive@0.1.7, zerotrie@0.2.5, zerovec@0.11.8, zerovec-derive@0.11.6
+Unlicense (6): aho-corasick@1.1.5, byteorder@1.5.0, memchr@2.8.3, same-file@1.0.6, walkdir@2.5.0, winapi-util@0.1.11
+Zlib (21): bytemuck@1.25.2, dispatch2@0.3.1, foldhash@0.1.5, foldhash@0.2.0, miniz_oxide@0.8.9, miniz_oxide@0.9.1, objc2-app-kit@0.3.2, objc2-cloud-kit@0.3.2, objc2-core-data@0.3.2, objc2-core-foundation@0.3.2, objc2-core-graphics@0.3.2, objc2-core-image@0.3.2, objc2-core-location@0.3.2, objc2-core-text@0.3.2, objc2-exception-helper@0.1.1, objc2-osa-kit@0.3.2, objc2-quartz-core@0.3.2, objc2-ui-kit@0.3.2, objc2-user-notifications@0.3.2, objc2-web-kit@0.3.2, raw-window-handle@0.6.2
+```
diff --git a/scripts/ci/gates.sh b/scripts/ci/gates.sh
old mode 100644
new mode 100755
index af906ea..f11872a
--- a/scripts/ci/gates.sh
+++ b/scripts/ci/gates.sh
@@ -102,6 +102,10 @@ GATES=(
   # Browser-Smoke des HQ. Kam am 12.09. auf main dazu.
   "hq-visual|linux,release|.|npm run test:hq:visual"
   "fe-build|linux,release|.|npm run build"
+  # LIC-01: Lizenzen aller Abhaengigkeiten (Rust + npm-Produktion) gegen die
+  # vom Nutzer freigegebene Positivliste. Nur linux: plattformunabhaengig,
+  # und cargo-deny braeuchte auf dem Windows-Job eine eigene Installation.
+  "licenses|linux,release|.|bash scripts/ci/license-check.sh"
   "e2e|linux,release|.|npm run test:e2e"
 
   # --- teuer: der Rust-Kern -----------------------------------------------
diff --git a/scripts/ci/license-check.sh b/scripts/ci/license-check.sh
new file mode 100755
index 0000000..ea5cb2e
--- /dev/null
+++ b/scripts/ci/license-check.sh
@@ -0,0 +1,44 @@
+#!/usr/bin/env bash
+# LIC-01: license gate for the public repository (lane linux,release).
+# Both halves share one allowlist (scripts/lib/license-check.mjs and
+# src-tauri/deny.toml). A license outside the list fails the gate — the fix
+# is an orchestrator decision, not a local exception.
+set -uo pipefail
+ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
+fails=0
+
+# --- Rust: cargo-deny -------------------------------------------------------
+DENY_VERSION="0.20.2"
+# `cargo deny --version` prints "cargo-deny <version>"; the version is the
+# last field. The probe may fail (tool missing) without aborting the script —
+# this file intentionally runs without `set -e` (kimi-k3 delta F2).
+installed="$(cargo deny --version 2>/dev/null | awk '{print $NF}' || true)"
+if [ "$installed" != "$DENY_VERSION" ]; then
+  echo "license-check: cargo-deny $DENY_VERSION noetig (gefunden: ${installed:-nichts}) — installiere (kann Minuten dauern)"
+  cargo install cargo-deny --locked --version "$DENY_VERSION" || {
+    echo "license-check: cargo-deny konnte nicht installiert werden"
+    exit 1
+  }
+  # Re-verify: a shadowing cargo-deny earlier in PATH must not silently win
+  # (kimi-k3 delta F3).
+  installed="$(cargo deny --version 2>/dev/null | awk '{print $NF}' || true)"
+  if [ "$installed" != "$DENY_VERSION" ]; then
+    echo "license-check: nach der Installation meldet cargo deny: ${installed:-nichts} — falsches Binary im PATH?"
+    exit 1
+  fi
+fi
+( cd "$ROOT/src-tauri" && cargo deny check licenses ) || fails=1
+
+# --- npm production dependencies --------------------------------------------
+# Pinned tool version: a compliance gate must not depend on whatever the
+# registry serves as "latest" that day (review lic-01, kimi-k3 F2).
+CHECKER_VERSION="5.0.1"
+report="$(mktemp)"
+trap 'rm -f "$report"' EXIT
+( cd "$ROOT" && npx --yes "license-checker-rseidelsohn@$CHECKER_VERSION" --production --json ) > "$report" || {
+  echo "license-check: license-checker-rseidelsohn fehlgeschlagen"
+  exit 1
+}
+node "$ROOT/scripts/lib/license-check.mjs" "$report" || fails=1
+
+exit "$fails"
diff --git a/scripts/lib/license-check.mjs b/scripts/lib/license-check.mjs
new file mode 100644
index 0000000..10fff49
--- /dev/null
+++ b/scripts/lib/license-check.mjs
@@ -0,0 +1,149 @@
+// scripts/lib/license-check.mjs
+// LIC-01: evaluates a license-checker-rseidelsohn JSON report against the
+// allowlist the user approved for the public repository. Exit 1 and one line
+// per violation when any package carries a license outside the list.
+//
+// Usage: node scripts/lib/license-check.mjs <report.json>
+// The report comes from: npx --yes license-checker-rseidelsohn --production --json
+
+import { readFileSync } from "node:fs";
+import { pathToFileURL } from "node:url";
+
+// The list is fixed by the LIC-01 assignment and mirrored in src-tauri/deny.toml.
+// Anything else (GPL/AGPL/LGPL/SSPL/unknown) is a finding for the
+// orchestrator, never a silent exception.
+export const ALLOWED_LICENSES = [
+  "MIT",
+  "Apache-2.0",
+  "Apache-2.0 WITH LLVM-exception",
+  "BSD-2-Clause",
+  "BSD-3-Clause",
+  "ISC",
+  "MPL-2.0",
+  "Zlib",
+  "Unicode-3.0",
+  "Unicode-DFS-2016",
+  "CC0-1.0",
+  "0BSD",
+  "BSL-1.0",
+  "OFL-1.1",
+];
+
+const ALLOWED = new Set(ALLOWED_LICENSES.map((l) => l.toUpperCase()));
+
+function tokenAllowed(token) {
+  return ALLOWED.has(token.toUpperCase());
+}
+
+// SPDX choice semantics with real precedence (AND binds tighter than OR,
+// parentheses group) — the same rules cargo-deny applies. A recursive-descent
+// parser instead of flat string splitting, because flattening "(MIT OR
+// Apache-2.0) AND GPL-3.0-only" would let the GPL conjunct slip through the
+// MIT alternative (review lic-01 delta, kimi-k3 F1 / glm-5.2 F1). Malformed
+// input fails closed (violation). A trailing `*` is license-checker's
+// "inferred from file" marker, not part of the license id — stripped, but
+// logged (kimi-k3 F8).
+function tokenize(expression) {
+  const spaced = String(expression).replace(/([()])/g, " $1 ").trim();
+  if (!spaced) return [];
+  const words = spaced.split(/\s+/);
+  const tokens = [];
+  for (let i = 0; i < words.length; i += 1) {
+    // "Apache-2.0 WITH LLVM-exception" is one SPDX token; re-join the WITH.
+    if (/^WITH$/i.test(words[i]) && tokens.length > 0 && i + 1 < words.length) {
+      tokens[tokens.length - 1] += ` WITH ${words[i + 1]}`;
+      i += 1;
+    } else {
+      tokens.push(words[i]);
+    }
+  }
+  return tokens;
+}
+
+function licenseAllowed(expression, pkg) {
+  if (/\*/.test(expression)) {
+    console.error(`license-check: ${pkg}: "${expression}" was inferred from a file (* marker), verify by hand`);
+  }
+  const tokens = tokenize(expression);
+  if (tokens.length === 0) return false;
+  let pos = 0;
+  const parsePrimary = () => {
+    const token = tokens[pos];
+    if (token === "(") {
+      pos += 1;
+      const value = parseOr();
+      if (tokens[pos] !== ")") throw new Error("unbalanced parentheses");
+      pos += 1;
+      return value;
+    }
+    if (token === undefined || token === ")" || /^(OR|AND)$/i.test(token)) {
+      throw new Error(`unexpected token: ${token}`);
+    }
+    pos += 1;
+    return tokenAllowed(token.replace(/\*$/, ""));
+  };
+  const parseAnd = () => {
+    let value = parsePrimary();
+    while (/^AND$/i.test(tokens[pos] ?? "")) {
+      pos += 1;
+      value = parsePrimary() && value;
+    }
+    return value;
+  };
+  const parseOr = () => {
+    let value = parseAnd();
+    while (/^OR$/i.test(tokens[pos] ?? "")) {
+      pos += 1;
+      value = parseAnd() || value;
+    }
+    return value;
+  };
+  try {
+    const value = parseOr();
+    return pos === tokens.length && value;
+  } catch {
+    return false;
+  }
+}
+
+// report: license-checker JSON object { "name@version": { licenses: "..." } }.
+// rootName: the project's own package name; its entry is skipped because the
+// repo license decision is tracked separately (LIC-01 "Needs decision").
+export function evaluateLicenses(report, rootName) {
+  const violations = [];
+  for (const [pkg, info] of Object.entries(report)) {
+    if (rootName && pkg.startsWith(`${rootName}@`)) continue;
+    // license-checker may report an array (multiple license files found):
+    // conservatively every entry must be on the list. An empty array is
+    // treated like a missing license (fail-closed, glm-5.2 delta F2).
+    const expressions = Array.isArray(info.licenses)
+      ? (info.licenses.length > 0 ? info.licenses : ["UNKNOWN"])
+      : [info.licenses ?? "UNKNOWN"];
+    for (const expression of expressions) {
+      const text = String(expression);
+      if (!licenseAllowed(text, pkg)) violations.push(`${pkg}: ${text}`);
+    }
+  }
+  return violations;
+}
+
+function main() {
+  const file = process.argv[2];
+  if (!file) {
+    console.error("usage: node scripts/lib/license-check.mjs <report.json>");
+    process.exit(2);
+  }
+  const report = JSON.parse(readFileSync(file, "utf8"));
+  const rootName = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).name;
+  const violations = evaluateLicenses(report, rootName);
+  if (violations.length > 0) {
+    console.error("license-check: licenses outside the allowlist:");
+    for (const v of violations) console.error(`  ${v}`);
+    process.exit(1);
+  }
+  console.log(`license-check: ${Object.keys(report).length} production packages, all on the allowlist`);
+}
+
+if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
+  main();
+}
diff --git a/scripts/lib/license-check.test.mjs b/scripts/lib/license-check.test.mjs
new file mode 100644
index 0000000..e4600a0
--- /dev/null
+++ b/scripts/lib/license-check.test.mjs
@@ -0,0 +1,168 @@
+// scripts/lib/license-check.test.mjs
+import { test } from "node:test";
+import assert from "node:assert/strict";
+import { execFileSync } from "node:child_process";
+import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
+import { tmpdir } from "node:os";
+import { join, dirname } from "node:path";
+import { fileURLToPath } from "node:url";
+import { ALLOWED_LICENSES, evaluateLicenses } from "./license-check.mjs";
+
+const HERE = dirname(fileURLToPath(import.meta.url));
+
+test("lic-01: allowlist matches the user-approved license list", () => {
+  assert.deepEqual([...ALLOWED_LICENSES].sort(), [
+    "0BSD",
+    "Apache-2.0",
+    "Apache-2.0 WITH LLVM-exception",
+    "BSD-2-Clause",
+    "BSD-3-Clause",
+    "BSL-1.0",
+    "CC0-1.0",
+    "ISC",
+    "MIT",
+    "MPL-2.0",
+    "OFL-1.1",
+    "Unicode-3.0",
+    "Unicode-DFS-2016",
+    "Zlib",
+  ]);
+});
+
+test("lic-01: clean report yields no violations", () => {
+  const report = {
+    "react@18.3.1": { licenses: "MIT" },
+    "@tauri-apps/api@2.11.1": { licenses: "Apache-2.0 OR MIT" },
+    "mixed@1.0.0": { licenses: "(BSD-3-Clause OR Apache-2.0)" },
+  };
+  assert.deepEqual(evaluateLicenses(report, "projecta"), []);
+});
+
+// SPDX choice semantics, matching cargo-deny: one allowed OR alternative is
+// enough; an AND conjunct off the list is a violation. (Review lic-01,
+// glm-5.2 F1 / kimi-k3 F6.)
+test("lic-01: OR with one allowed alternative passes while AND requires all", () => {
+  const report = {
+    "choice@1.0.0": { licenses: "MIT OR GPL-3.0-only" },
+    "conjunct@1.0.0": { licenses: "MIT AND GPL-3.0-only" },
+  };
+  assert.deepEqual(evaluateLicenses(report, "projecta"), [
+    "conjunct@1.0.0: MIT AND GPL-3.0-only",
+  ]);
+});
+
+// The mjs allowlist and src-tauri/deny.toml claim to mirror each other; pin
+// that so editing one without the other fails loudly. (Review lic-01,
+// kimi-k3 F3; section scoping: kimi-k3 delta F4.)
+test("lic-01: deny.toml allow list mirrors ALLOWED_LICENSES", () => {
+  const toml = readFileSync(new URL("../../src-tauri/deny.toml", import.meta.url), "utf8");
+  const start = toml.indexOf("[licenses]\n");
+  assert.ok(start !== -1, "deny.toml has a [licenses] section");
+  const rest = toml.slice(start + "[licenses]\n".length);
+  const nextSection = rest.search(/^\[/m);
+  const sectionText = nextSection === -1 ? rest : rest.slice(0, nextSection);
+  const block = sectionText.match(/^allow = \[\n([\s\S]*?)\]/m);
+  assert.ok(block, "deny.toml has an [licenses] allow array");
+  const fromToml = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
+  assert.deepEqual(fromToml, ALLOWED_LICENSES);
+});
+
+// license-checker sometimes reports licenses as an array instead of a
+// string. (Review lic-01, glm-5.2 F3; empty array + GPL element:
+// glm-5.2 delta F2, kimi-k3 delta F5.)
+test("lic-01: array-valued licenses are evaluated element-wise", () => {
+  const report = { "arr@1.0.0": { licenses: ["MIT", "Apache-2.0"] } };
+  assert.deepEqual(evaluateLicenses(report, "projecta"), []);
+  const bad = {
+    "arr-bad@1.0.0": { licenses: ["MIT", "GPL-3.0-only"] },
+    "arr-empty@1.0.0": { licenses: [] },
+  };
+  assert.deepEqual(evaluateLicenses(bad, "projecta"), [
+    "arr-bad@1.0.0: GPL-3.0-only",
+    "arr-empty@1.0.0: UNKNOWN",
+  ]);
+});
+
+// Parenthesized SPDX expressions must keep real precedence: flattening
+// "(MIT OR Apache-2.0) AND GPL-3.0-only" would wrongly pass via "MIT".
+// (Review lic-01 delta, kimi-k3 F1 / glm-5.2 F1.)
+test("lic-01: parentheses preserve SPDX precedence", () => {
+  const report = {
+    "smuggle@1.0.0": { licenses: "(MIT OR Apache-2.0) AND GPL-3.0-only" },
+    "grouped-ok@1.0.0": { licenses: "(MIT OR Apache-2.0) AND Zlib" },
+    "with-exc@1.0.0": { licenses: "Apache-2.0 WITH LLVM-exception" },
+    "grouped-with@1.0.0": { licenses: "(BSD-2-Clause OR Apache-2.0 WITH LLVM-exception) OR MIT" },
+  };
+  assert.deepEqual(evaluateLicenses(report, "projecta"), [
+    "smuggle@1.0.0: (MIT OR Apache-2.0) AND GPL-3.0-only",
+  ]);
+});
+
+// The `*` marker means license-checker inferred the license from a file.
+// It never changes the verdict: "MIT*" is MIT, "GPL-3.0-only*" stays
+// disallowed. (Review lic-01, kimi-k3 F8 / delta F5.)
+test("lic-01: inferred-license marker never changes the verdict", () => {
+  const report = {
+    "inferred-ok@1.0.0": { licenses: "MIT*" },
+    "inferred-bad@1.0.0": { licenses: "GPL-3.0-only*" },
+  };
+  assert.deepEqual(evaluateLicenses(report, "projecta"), [
+    "inferred-bad@1.0.0: GPL-3.0-only*",
+  ]);
+});
+
+test("lic-01: rejects a license outside the allowlist", () => {
+  const report = {
+    "ok@1.0.0": { licenses: "MIT" },
+    "bad@2.0.0": { licenses: "GPL-3.0-only" },
+    "unknown@3.0.0": { licenses: "UNKNOWN" },
+  };
+  const violations = evaluateLicenses(report, "projecta");
+  assert.deepEqual(violations, [
+    "bad@2.0.0: GPL-3.0-only",
+    "unknown@3.0.0: UNKNOWN",
+  ]);
+});
+
+test("lic-01: the project's own unlicensed root package is skipped", () => {
+  const report = { "projecta@1.4.1": { licenses: "UNLICENSED" } };
+  assert.deepEqual(evaluateLicenses(report, "projecta"), []);
+});
+
+test("lic-01: cli exits 1 and names the offending package", () => {
+  const dir = mkdtempSync(join(tmpdir(), "lic-check-"));
+  const file = join(dir, "report.json");
+  writeFileSync(file, JSON.stringify({ "bad@1.0.0": { licenses: "AGPL-3.0-only" } }));
+  let code = 0;
+  let out = "";
+  try {
+    out = execFileSync(process.execPath, [join(HERE, "license-check.mjs"), file], {
+      encoding: "utf8",
+      stdio: ["ignore", "pipe", "pipe"],
+    });
+  } catch (err) {
+    code = err.status;
+    out = `${err.stdout}${err.stderr}`;
+  }
+  assert.equal(code, 1);
+  assert.match(out, /bad@1\.0\.0: AGPL-3\.0-only/);
+});
+
+// Malformed expressions must fail closed, not crash green or pass by
+// accident. (Review lic-01 delta2, kimi-k3 F3.)
+test("lic-01: malformed expressions are violations", () => {
+  for (const [pkg, expression] of [
+    ["trailing-op@1.0.0", "MIT OR"],
+    ["leading-op@1.0.0", "OR MIT"],
+    ["trailing-and@1.0.0", "MIT AND"],
+    ["unbalanced-open@1.0.0", "(MIT"],
+    ["unbalanced-close@1.0.0", "MIT)"],
+    ["empty-group@1.0.0", "()"],
+    ["empty-string@1.0.0", ""],
+    ["double-star@1.0.0", "MIT**"],
+  ]) {
+    assert.deepEqual(evaluateLicenses({ [pkg]: { licenses: expression } }, "projecta"), [
+      `${pkg}: ${expression}`,
+    ]);
+  }
+});
diff --git a/src-tauri/deny.toml b/src-tauri/deny.toml
new file mode 100644
index 0000000..35a639f
--- /dev/null
+++ b/src-tauri/deny.toml
@@ -0,0 +1,29 @@
+# LIC-01: license policy for the public repository.
+# Checked by `cargo deny check licenses` (gate `licenses`, scripts/ci/license-check.sh).
+# Anything not on this list is a finding for the orchestrator, not something a
+# worker may silently add an exception for.
+
+[licenses]
+confidence-threshold = 0.8
+allow = [
+  "MIT",
+  "Apache-2.0",
+  "Apache-2.0 WITH LLVM-exception",
+  "BSD-2-Clause",
+  "BSD-3-Clause",
+  "ISC",
+  "MPL-2.0",
+  "Zlib",
+  "Unicode-3.0",
+  "Unicode-DFS-2016",
+  "CC0-1.0",
+  "0BSD",
+  "BSL-1.0",
+  "OFL-1.1",
+]
+
+# The workspace crate `projecta` itself carries no license field yet — the
+# repo license is a LIC-01 "Needs decision" item. The gate's job here is the
+# third-party tree, so unpublished workspace crates are skipped.
+[licenses.private]
+ignore = true
diff --git a/src-tauri/src/skills.rs b/src-tauri/src/skills.rs
index 59024d0..72cf56e 100644
--- a/src-tauri/src/skills.rs
+++ b/src-tauri/src/skills.rs
@@ -418,7 +418,10 @@ mod tests {
             "ui-ux-pro-max missing from {ids:?}"
         );
         let pack = dev.join("ui-ux-pro-max");
-        assert!(pack.join("SKILL.md").is_file(), "SKILL.md missing from ui-ux-pro-max");
+        assert!(
+            pack.join("SKILL.md").is_file(),
+            "SKILL.md missing from ui-ux-pro-max"
+        );
         let skill = std::fs::read_to_string(pack.join("SKILL.md")).expect("read SKILL.md");
         let (name, description) = parse_front_matter(&skill);
         assert_eq!(name.as_deref(), Some("ui-ux-pro-max"));
```
