# Third-Party Notices

ProjectA bundles or depends on the third-party software listed below. The
allowlist approved for this public repository (`MIT, Apache-2.0 (WITH
LLVM-exception), BSD-2/3-Clause, ISC, MPL-2.0, Zlib,
Unicode-3.0/Unicode-DFS-2016, CC0-1.0, 0BSD, BSL-1.0`, plus `OFL-1.1` for
fonts) is enforced in CI by the `licenses` gate
(`scripts/ci/license-check.sh`, policy in `src-tauri/deny.toml` and
`scripts/lib/license-check.mjs`) over the two dependency trees it scans:
the Rust crate graph and the npm production tree. The bundled assets under
"Required notices" (fonts, skill packs) are attribution entries: their
licenses are documented here, but they are data files, not packages in
those trees, so the gate does not see them.

Regenerate the two dependency sections after dependency changes, with the
same tool versions the gate pins (`scripts/ci/license-check.sh`):

```sh
cd src-tauri && cargo deny list          # cargo-deny 0.20.2 — Rust section
npx --yes license-checker-rseidelsohn@5.0.1 --production --json   # npm section
```

## Required notices (Attribution)

- **Inter font** (`public/fonts/Inter-*.otf`): SIL Open Font License 1.1.
  The license text ships next to the fonts as `public/fonts/INTER-LIZENZ.txt`.
  Copyright 2016-2023 The Inter Project Authors.
- **Recursive font** (`docs/dev-hq/fonts/recursive-latin-wght.woff2`): SIL
  Open Font License 1.1, license text next to it as `docs/dev-hq/fonts/OFL.txt`.
- **prompt-master** (`src-tauri/resources/prompt-master/`): MIT License,
  Copyright (c) 2026 Nidhin Joseph Nelson. License text: `LICENSE` in that
  directory.
- **taste-skill** (`src-tauri/resources/skills/taste-skill/`): MIT License,
  Copyright (c) 2026 Leonxlnx. License text: `LICENSE` in that directory.
- **unlazy** (`src-tauri/resources/skills/unlazy/`): MIT License,
  Copyright (c) 2026 Leonxlnx. License text: `LICENSE` in that directory.
- **claude-code-setup** (`src-tauri/resources/skills/claude-code-setup/`):
  Apache License 2.0. License text: `LICENSE` in that directory (the upstream
  copyright line is the unmodified Apache template; no NOTICE file ships
  upstream).
- **MPL-2.0 crates** (cssparser, cssparser-macros, dtoa-short, option-ext,
  selectors): used unmodified as compiled dependencies; their source is
  available on crates.io as required by MPL-2.0 §3.2.
- **webpki-root-certs** (crate `webpki-root-certs@1.0.9`, Mozilla root
  certificate data, via rustls-platform-verifier ← reqwest ← tauri):
  Community Data License Agreement – Permissive – Version 2.0
  (CDLA-Permissive-2.0). §2.1 requires making the license text available
  with the shared data; the full text is in the "License texts" appendix
  below. Allowed by a narrow `[[licenses.exceptions]]` entry in
  `src-tauri/deny.toml` (orchestrator decision 2026-09-25), not by the
  global allowlist.
- **Project-owned artwork**: `assets/banner.svg`, `src-tauri/icons/*` and the
  diagrams under `docs/dev-hq/concepts/` are original ProjectA artwork, not
  third-party material.

The placeholder skills under `src-tauri/resources/skills/` (karpathy-guidelines,
minimalist-skill, planning-with-files, ui-ux-pro-max, web-design-guidelines)
are intentionally *not* bundled third-party packs: each placeholder documents
why the pack is absent and ships no third-party content.

## npm production dependencies

| Package | License |
|---|---|
| @tauri-apps/api@2.11.1 | Apache-2.0 OR MIT |
| @tauri-apps/plugin-process@2.3.1 | MIT OR Apache-2.0 |
| @tauri-apps/plugin-updater@2.11.0 | MIT OR Apache-2.0 |
| @xterm/addon-canvas@0.7.0 | MIT |
| @xterm/addon-fit@0.10.0 | MIT |
| @xterm/addon-search@0.15.0 | MIT |
| @xterm/addon-webgl@0.18.0 | MIT |
| @xterm/xterm@5.5.0 | MIT |
| js-tokens@4.0.0 | MIT |
| loose-envify@1.4.0 | MIT |
| react-dom@18.3.1 | MIT |
| react@18.3.1 | MIT |
| scheduler@0.23.2 | MIT |

(The root package `projecta` itself is excluded; its own license is a LIC-01
decision item, see the PR.)

## Rust dependencies

Generated with `cargo deny list` (cargo-deny 0.20.2, see `src-tauri/deny.toml`).
Each line groups the crates that list the named license; crates under an
`OR` expression appear under every alternative, but only one needs to be on
the allowlist for the gate to pass. `LGPL-2.1-or-later` (r-efi), `MIT-0`
(dunce) and `Unlicense` (aho-corasick and others) below are such
alternatives of expressions that also offer an allowed license
(MIT/Apache-2.0/CC0-1.0) — ProjectA relies on the allowed alternative.
`CDLA-Permissive-2.0` (webpki-root-certs, the Mozilla root certificate data
pulled in via rustls-platform-verifier ← reqwest ← tauri) is not on the
allowlist; the orchestrator decided on 2026-09-25 to allow it as a narrow
`[[licenses.exceptions]]` entry for exactly this crate in
`src-tauri/deny.toml`. The full license text ships in the
"License texts" appendix below (CDLA-Permissive-2.0 §2.1 requires making
the text available with the data).

```text
0BSD (1): adler2@2.0.1
Apache-2.0 (366): adler2@2.0.1, allocator-api2@0.2.21, android_log-sys@0.3.2, android_logger@0.15.1, anyhow@1.0.104, arbitrary@1.4.2, async-broadcast@0.7.2, async-channel@2.5.0, async-executor@1.14.0, async-io@2.6.0, async-lock@3.4.2, async-process@2.5.0, async-recursion@1.1.1, async-signal@0.2.14, async-task@4.7.1, async-trait@0.1.92, atomic-waker@1.1.2, autocfg@1.5.1, base64@0.21.7, base64@0.22.1, base64@0.23.1, bit-set@0.8.0, bit-vec@0.8.0, bitflags@1.3.2, bitflags@2.13.2, block-buffer@0.10.4, blocking@1.7.0, bumpalo@3.20.3, bytemuck@1.25.2, camino@1.2.6, cargo-platform@0.1.9, cargo_toml@0.22.3, cc@1.4.6, cesu8@1.1.0, cfg-expr@0.15.8, cfg-if@1.0.4, concurrent-queue@2.5.0, cookie@0.18.2, core-foundation@0.10.1, core-foundation@0.9.4, core-foundation-sys@0.8.7, core-graphics@0.25.0, core-graphics-types@0.2.0, cpufeatures@0.2.17, crc@3.4.0, crc-catalog@2.5.0, crc32fast@1.5.2, crossbeam-channel@0.5.17, crossbeam-queue@0.3.14, crossbeam-utils@0.8.23, crypto-common@0.1.7, ctor@0.8.0, ctor-proc-macro@0.0.7, dbus@0.9.12, deranged@0.5.8, derive_arbitrary@1.4.2, digest@0.10.7, dirs@6.0.0, dirs-sys@0.5.0, dispatch2@0.3.1, displaydoc@0.2.7, downcast-rs@1.2.1, dpi@0.1.2, dtoa@1.0.11, dunce@1.0.5, dyn-clone@1.0.20, either@1.18.0, embed_plist@1.2.2, enumflags2@0.7.12, enumflags2_derive@0.7.12, env_filter@0.1.4, equivalent@1.0.2, erased-serde@0.4.10, errno@0.3.14, event-listener@5.4.2, event-listener-strategy@0.5.4, fastrand@2.5.0, fdeflate@0.3.7, field-offset@0.3.6, filetime@0.2.29, find-msvc-tools@0.1.12, flate2@1.1.10, flume@0.11.1, fnv@1.0.7, foreign-types@0.5.0, foreign-types-macros@0.2.4, foreign-types-shared@0.3.1, form_urlencoded@1.2.2, futures-channel@0.3.34, futures-core@0.3.34, futures-executor@0.3.34, futures-intrusive@0.5.0, futures-io@0.3.34, futures-lite@2.6.1, futures-macro@0.3.34, futures-sink@0.3.34, futures-task@0.3.34, futures-util@0.3.34, getrandom@0.2.17, getrandom@0.3.4, getrandom@0.4.3, glob@0.3.4, hashbrown@0.12.3, hashbrown@0.15.5, hashbrown@0.17.1, hashlink@0.10.0, heck@0.4.1, heck@0.5.0, hermit-abi@0.5.3, hex@0.4.3, html5ever@0.38.0, http@1.5.0, httparse@1.10.1, hyper-rustls@0.27.9, ident_case@1.0.1, idna@1.1.0, idna_adapter@1.2.2, indexmap@1.9.3, indexmap@2.14.2, ipnet@2.12.2, itoa@1.0.18, jni@0.21.1, jni@0.22.4, jni-macros@0.22.4, jni-sys@0.3.1, jni-sys@0.4.1, jni-sys-macros@0.4.1, js-sys@0.3.105, json-patch@3.0.1, jsonptr@0.6.3, keyboard-types@0.7.0, lazy_static@1.5.0, libc@0.2.189, libdbus-sys@0.2.7, linux-raw-sys@0.12.1, lock_api@0.4.14, log@0.4.34, markup5ever@0.38.0, mime@0.3.17, miniz_oxide@0.8.9, miniz_oxide@0.9.1, muda@0.19.3, ndk@0.9.0, ndk-sys@0.6.0+11769913, num-conv@0.2.2, num-traits@0.2.19, num_enum@0.7.6, num_enum_derive@0.7.6, num_threads@0.1.7, objc2-app-kit@0.3.2, objc2-cloud-kit@0.3.2, objc2-core-data@0.3.2, objc2-core-foundation@0.3.2, objc2-core-graphics@0.3.2, objc2-core-image@0.3.2, objc2-core-location@0.3.2, objc2-core-text@0.3.2, objc2-exception-helper@0.1.1, objc2-osa-kit@0.3.2, objc2-quartz-core@0.3.2, objc2-ui-kit@0.3.2, objc2-user-notifications@0.3.2, objc2-web-kit@0.3.2, once_cell@1.21.4, openssl-probe@0.2.1, ordered-stream@0.2.0, osakit@0.3.1, parking@2.2.1, parking_lot@0.12.5, parking_lot_core@0.9.12, percent-encoding@2.3.2, pin-project-lite@0.2.17, piper@0.2.5, pkg-config@0.3.34, png@0.17.16, png@0.18.1, polling@3.11.0, powerfmt@0.2.0, proc-macro-crate@1.3.1, proc-macro-crate@2.0.2, proc-macro-crate@3.5.0, proc-macro-error@1.0.4, proc-macro-error-attr@1.0.4, proc-macro2@1.0.107, quote@1.0.47, r-efi@5.3.0, r-efi@6.0.0, raw-window-handle@0.6.2, regex@1.13.1, regex-automata@0.4.18, regex-syntax@0.8.11, reqwest@0.13.5, ring@0.17.14, rustc-hash@2.1.3, rustc_version@0.4.1, rustix@1.1.4, rustls@0.23.45, rustls-native-certs@0.8.4, rustls-pki-types@1.15.1, rustls-platform-verifier@0.7.0, rustls-platform-verifier-android@0.1.1, rustversion@1.0.23, ryu@1.0.23, scopeguard@1.2.0, security-framework@3.7.0, security-framework-sys@2.17.0, semver@1.0.28, serde@1.0.229, serde-untagged@0.1.9, serde_core@1.0.229, serde_derive@1.0.229, serde_derive_internals@0.29.1, serde_json@1.0.151, serde_repr@0.1.21, serde_spanned@0.6.9, serde_spanned@1.1.1, serde_urlencoded@0.7.1, serde_with@3.23.0, serde_with_macros@3.23.0, serial2@0.2.38, serialize-to-javascript@0.1.2, serialize-to-javascript-impl@0.1.2, servo_arc@0.4.3, sha2@0.10.9, shared_library@0.1.9, shell-words@1.1.1, shlex@2.0.1, signal-hook-registry@1.4.8, simd_cesu8@1.2.0, simdutf8@0.1.5, siphasher@1.0.3, smallvec@1.16.1, socket2@0.6.5, softbuffer@0.4.8, sqlx@0.8.6, sqlx-core@0.8.6, sqlx-macros@0.8.6, sqlx-macros-core@0.8.6, sqlx-sqlite@0.8.6, stable_deref_trait@1.2.1, string_cache@0.9.0, string_cache_codegen@0.6.1, swift-rs@1.0.8, syn@1.0.109, syn@2.0.119, syn@3.0.5, sync_wrapper@1.0.2, system-configuration@0.7.0, system-configuration-sys@0.6.0, system-deps@6.2.2, tao@0.35.3, tao-macros@0.1.4, tar@0.4.46, tauri@2.11.6, tauri-build@2.6.3, tauri-codegen@2.6.3, tauri-macros@2.6.3, tauri-plugin@2.6.3, tauri-plugin-log@2.9.2, tauri-plugin-opener@2.5.5, tauri-plugin-process@2.3.1, tauri-plugin-single-instance@2.4.5, tauri-plugin-updater@2.12.0, tauri-runtime@2.11.3, tauri-runtime-wry@2.11.4, tauri-utils@2.9.3, tempfile@3.27.0, tendril@0.5.1, thiserror@1.0.69, thiserror@2.0.20, thiserror-impl@1.0.69, thiserror-impl@2.0.20, time@0.3.55, time-core@0.1.9, time-macros@0.2.32, tokio-rustls@0.26.5, toml@0.8.2, toml@0.9.12+spec-1.1.0, toml@1.1.6+spec-1.1.0, toml_datetime@0.6.3, toml_datetime@0.7.5+spec-1.1.0, toml_datetime@1.1.1+spec-1.1.0, toml_edit@0.19.15, toml_edit@0.20.2, toml_edit@0.25.15+spec-1.1.0, toml_parser@1.1.3+spec-1.1.0, toml_writer@1.1.2+spec-1.1.0, typeid@1.0.3, typenum@1.20.1, unic-char-property@0.9.0, unic-char-range@0.9.0, unic-common@0.9.0, unic-ucd-ident@0.9.0, unic-ucd-version@0.9.0, unicode-ident@1.0.24, unicode-segmentation@1.13.3, url@2.5.8, utf8_iter@1.0.4, uuid@1.26.1, vcpkg@0.2.15, version_check@0.9.5, wasi@0.11.1+wasi-snapshot-preview1, wasip2@1.0.4+wasi-0.2.12, wasm-bindgen@0.2.128, wasm-bindgen-futures@0.4.78, wasm-bindgen-macro@0.2.128, wasm-bindgen-macro-support@0.2.128, wasm-bindgen-shared@0.2.128, wasm-streams@0.5.0, web-sys@0.3.105, web_atoms@0.2.6, winapi@0.3.9, winapi-i686-pc-windows-gnu@0.4.0, winapi-x86_64-pc-windows-gnu@0.4.0, window-vibrancy@0.6.0, windows@0.61.3, windows-collections@0.2.0, windows-core@0.61.2, windows-future@0.2.1, windows-implement@0.60.2, windows-interface@0.59.3, windows-link@0.1.3, windows-link@0.2.1, windows-numerics@0.2.0, windows-registry@0.6.1, windows-result@0.3.4, windows-result@0.4.1, windows-strings@0.4.2, windows-strings@0.5.1, windows-sys@0.45.0, windows-sys@0.52.0, windows-sys@0.59.0, windows-sys@0.60.2, windows-sys@0.61.2, windows-targets@0.42.2, windows-targets@0.52.6, windows-targets@0.53.5, windows-threading@0.1.0, windows-version@0.1.7, windows_aarch64_gnullvm@0.42.2, windows_aarch64_gnullvm@0.52.6, windows_aarch64_gnullvm@0.53.1, windows_aarch64_msvc@0.42.2, windows_aarch64_msvc@0.52.6, windows_aarch64_msvc@0.53.1, windows_i686_gnu@0.42.2, windows_i686_gnu@0.52.6, windows_i686_gnu@0.53.1, windows_i686_gnullvm@0.52.6, windows_i686_gnullvm@0.53.1, windows_i686_msvc@0.42.2, windows_i686_msvc@0.52.6, windows_i686_msvc@0.53.1, windows_x86_64_gnu@0.42.2, windows_x86_64_gnu@0.52.6, windows_x86_64_gnu@0.53.1, windows_x86_64_gnullvm@0.42.2, windows_x86_64_gnullvm@0.52.6, windows_x86_64_gnullvm@0.53.1, windows_x86_64_msvc@0.42.2, windows_x86_64_msvc@0.52.6, windows_x86_64_msvc@0.53.1, wit-bindgen@0.57.1, wry@0.55.1, xattr@1.6.1, zeroize@1.9.0
Apache-2.0 WITH LLVM-exception (6): linux-raw-sys@0.12.1, rustix@1.1.4, target-lexicon@0.12.16, wasi@0.11.1+wasi-snapshot-preview1, wasip2@1.0.4+wasi-0.2.12, wit-bindgen@0.57.1
BSD-2-Clause (1): serial2@0.2.38
BSD-3-Clause (7): alloc-no-stdlib@2.0.4, alloc-stdlib@0.2.4, brotli@8.0.4, brotli-decompressor@5.0.3, num_enum@0.7.6, num_enum_derive@0.7.6, subtle@2.6.1
BSL-1.0 (1): ryu@1.0.23
CC0-1.0 (1): dunce@1.0.5
CDLA-Permissive-2.0 (1): webpki-root-certs@1.0.9
ISC (6): hyper-rustls@0.27.9, ring@0.17.14, rustls@0.23.45, rustls-native-certs@0.8.4, rustls-webpki@0.103.15, untrusted@0.9.0
LGPL-2.1-or-later (2): r-efi@5.3.0, r-efi@6.0.0
MIT (493): adler2@2.0.1, aho-corasick@1.1.5, allocator-api2@0.2.21, android_log-sys@0.3.2, android_logger@0.15.1, anyhow@1.0.104, arbitrary@1.4.2, async-broadcast@0.7.2, async-channel@2.5.0, async-executor@1.14.0, async-io@2.6.0, async-lock@3.4.2, async-process@2.5.0, async-recursion@1.1.1, async-signal@0.2.14, async-task@4.7.1, async-trait@0.1.92, atk@0.18.2, atk-sys@0.18.2, atoi@2.0.0, atomic-waker@1.1.2, autocfg@1.5.1, base64@0.21.7, base64@0.22.1, base64@0.23.1, bit-set@0.8.0, bit-vec@0.8.0, bitflags@1.3.2, bitflags@2.13.2, block-buffer@0.10.4, block2@0.6.2, blocking@1.7.0, brotli@8.0.4, brotli-decompressor@5.0.3, bumpalo@3.20.3, bytemuck@1.25.2, byteorder@1.5.0, bytes@1.12.1, cairo-rs@0.18.5, cairo-sys-rs@0.18.2, camino@1.2.6, cargo-platform@0.1.9, cargo_metadata@0.19.2, cargo_toml@0.22.3, cc@1.4.6, cesu8@1.1.0, cfb@0.7.3, cfg-expr@0.15.8, cfg-if@1.0.4, cfg_aliases@0.1.1, combine@4.6.8, concurrent-queue@2.5.0, cookie@0.18.2, core-foundation@0.10.1, core-foundation@0.9.4, core-foundation-sys@0.8.7, core-graphics@0.25.0, core-graphics-types@0.2.0, cpufeatures@0.2.17, crc@3.4.0, crc-catalog@2.5.0, crc32fast@1.5.2, crossbeam-channel@0.5.17, crossbeam-queue@0.3.14, crossbeam-utils@0.8.23, crypto-common@0.1.7, ctor@0.8.0, ctor-proc-macro@0.0.7, darling@0.24.1, darling_core@0.24.1, darling_macro@0.24.1, dbus@0.9.12, deranged@0.5.8, derive_arbitrary@1.4.2, derive_more@2.1.1, derive_more-impl@2.1.1, digest@0.10.7, dirs@6.0.0, dirs-sys@0.5.0, dispatch2@0.3.1, displaydoc@0.2.7, dlopen2@0.8.2, dlopen2_derive@0.4.3, dom_query@0.27.0, dotenvy@0.15.7, downcast-rs@1.2.1, dpi@0.1.2, dtoa@1.0.11, dyn-clone@1.0.20, either@1.18.0, embed-resource@3.0.11, embed_plist@1.2.2, endi@1.1.1, enumflags2@0.7.12, enumflags2_derive@0.7.12, env_filter@0.1.4, equivalent@1.0.2, erased-serde@0.4.10, errno@0.3.14, event-listener@5.4.2, event-listener-strategy@0.5.4, fastrand@2.5.0, fdeflate@0.3.7, fern@0.7.1, field-offset@0.3.6, filedescriptor@0.8.3, filetime@0.2.29, find-msvc-tools@0.1.12, flate2@1.1.10, flume@0.11.1, fnv@1.0.7, foreign-types@0.5.0, foreign-types-macros@0.2.4, foreign-types-shared@0.3.1, form_urlencoded@1.2.2, futures-channel@0.3.34, futures-core@0.3.34, futures-executor@0.3.34, futures-intrusive@0.5.0, futures-io@0.3.34, futures-lite@2.6.1, futures-macro@0.3.34, futures-sink@0.3.34, futures-task@0.3.34, futures-util@0.3.34, gdk@0.18.2, gdk-pixbuf@0.18.5, gdk-pixbuf-sys@0.18.0, gdk-sys@0.18.2, gdkwayland-sys@0.18.2, gdkx11@0.18.2, gdkx11-sys@0.18.2, generic-array@0.14.7, getrandom@0.2.17, getrandom@0.3.4, getrandom@0.4.3, gio@0.18.4, gio-sys@0.18.1, glib@0.18.5, glib-macros@0.18.5, glib-sys@0.18.1, glob@0.3.4, gobject-sys@0.18.0, gtk@0.18.2, gtk-sys@0.18.2, gtk3-macros@0.18.2, hashbrown@0.12.3, hashbrown@0.15.5, hashbrown@0.17.1, hashlink@0.10.0, heck@0.4.1, heck@0.5.0, hermit-abi@0.5.3, hex@0.4.3, html5ever@0.38.0, http@1.5.0, http-body@1.1.0, http-body-util@0.1.5, httparse@1.10.1, hyper@1.11.1, hyper-rustls@0.27.9, hyper-util@0.1.20, ico@0.5.0, ident_case@1.0.1, idna@1.1.0, idna_adapter@1.2.2, indexmap@1.9.3, indexmap@2.14.2, infer@0.19.0, ipnet@2.12.2, is-docker@0.2.0, is-wsl@0.4.0, itoa@1.0.18, javascriptcore-rs@1.1.2, javascriptcore-rs-sys@1.1.1, jni@0.21.1, jni@0.22.4, jni-macros@0.22.4, jni-sys@0.3.1, jni-sys@0.4.1, jni-sys-macros@0.4.1, js-sys@0.3.105, json-patch@3.0.1, jsonptr@0.6.3, keyboard-types@0.7.0, lazy_static@1.5.0, libc@0.2.189, libdbus-sys@0.2.7, libredox@0.1.24, libsqlite3-sys@0.30.1, linux-raw-sys@0.12.1, lock_api@0.4.14, log@0.4.34, markup5ever@0.38.0, memchr@2.8.3, memoffset@0.9.1, mime@0.3.17, minisign-verify@0.2.5, miniz_oxide@0.8.9, miniz_oxide@0.9.1, mio@1.2.3, muda@0.19.3, ndk@0.9.0, ndk-sys@0.6.0+11769913, new_debug_unreachable@1.0.6, nix@0.28.0, num-conv@0.2.2, num-traits@0.2.19, num_enum@0.7.6, num_enum_derive@0.7.6, num_threads@0.1.7, objc2@0.6.4, objc2-app-kit@0.3.2, objc2-cloud-kit@0.3.2, objc2-core-data@0.3.2, objc2-core-foundation@0.3.2, objc2-core-graphics@0.3.2, objc2-core-image@0.3.2, objc2-core-location@0.3.2, objc2-core-text@0.3.2, objc2-encode@4.1.0, objc2-exception-helper@0.1.1, objc2-foundation@0.3.2, objc2-osa-kit@0.3.2, objc2-quartz-core@0.3.2, objc2-ui-kit@0.3.2, objc2-user-notifications@0.3.2, objc2-web-kit@0.3.2, once_cell@1.21.4, open@5.4.4, openssl-probe@0.2.1, ordered-stream@0.2.0, osakit@0.3.1, pango@0.18.3, pango-sys@0.18.0, parking@2.2.1, parking_lot@0.12.5, parking_lot_core@0.9.12, percent-encoding@2.3.2, phf@0.13.1, phf_codegen@0.13.1, phf_generator@0.13.1, phf_macros@0.13.1, phf_shared@0.13.1, pin-project-lite@0.2.17, piper@0.2.5, pkg-config@0.3.34, plist@1.10.1, png@0.17.16, png@0.18.1, polling@3.11.0, portable-pty@0.9.0, powerfmt@0.2.0, precomputed-hash@0.1.1, proc-macro-crate@1.3.1, proc-macro-crate@2.0.2, proc-macro-crate@3.5.0, proc-macro-error@1.0.4, proc-macro-error-attr@1.0.4, proc-macro2@1.0.107, quick-xml@0.42.0, quote@1.0.47, r-efi@5.3.0, r-efi@6.0.0, raw-window-handle@0.6.2, redox_syscall@0.5.18, redox_users@0.5.2, regex@1.13.1, regex-automata@0.4.18, regex-syntax@0.8.11, reqwest@0.13.5, rustc-hash@2.1.3, rustc_version@0.4.1, rustix@1.1.4, rustls@0.23.45, rustls-native-certs@0.8.4, rustls-pki-types@1.15.1, rustls-platform-verifier@0.7.0, rustls-platform-verifier-android@0.1.1, rustversion@1.0.23, same-file@1.0.6, schannel@0.1.29, schemars@0.8.22, schemars_derive@0.8.22, scopeguard@1.2.0, security-framework@3.7.0, security-framework-sys@2.17.0, semver@1.0.28, serde@1.0.229, serde-untagged@0.1.9, serde_core@1.0.229, serde_derive@1.0.229, serde_derive_internals@0.29.1, serde_json@1.0.151, serde_repr@0.1.21, serde_spanned@0.6.9, serde_spanned@1.1.1, serde_urlencoded@0.7.1, serde_with@3.23.0, serde_with_macros@3.23.0, serialize-to-javascript@0.1.2, serialize-to-javascript-impl@0.1.2, servo_arc@0.4.3, sha2@0.10.9, shared_library@0.1.9, shell-words@1.1.1, shlex@2.0.1, signal-hook-registry@1.4.8, simd-adler32@0.3.10, simd_cesu8@1.2.0, simdutf8@0.1.5, siphasher@1.0.3, slab@0.4.12, smallvec@1.16.1, socket2@0.6.5, softbuffer@0.4.8, soup3@0.5.0, soup3-sys@0.5.0, spin@0.9.9, sqlx@0.8.6, sqlx-core@0.8.6, sqlx-macros@0.8.6, sqlx-macros-core@0.8.6, sqlx-sqlite@0.8.6, stable_deref_trait@1.2.1, string_cache@0.9.0, string_cache_codegen@0.6.1, strsim@0.11.1, swift-rs@1.0.8, syn@1.0.109, syn@2.0.119, syn@3.0.5, synstructure@0.13.2, system-configuration@0.7.0, system-configuration-sys@0.6.0, system-deps@6.2.2, tao-macros@0.1.4, tar@0.4.46, tauri@2.11.6, tauri-build@2.6.3, tauri-codegen@2.6.3, tauri-macros@2.6.3, tauri-plugin@2.6.3, tauri-plugin-log@2.9.2, tauri-plugin-opener@2.5.5, tauri-plugin-process@2.3.1, tauri-plugin-single-instance@2.4.5, tauri-plugin-updater@2.12.0, tauri-runtime@2.11.3, tauri-runtime-wry@2.11.4, tauri-utils@2.9.3, tauri-winres@0.3.6, tempfile@3.27.0, tendril@0.5.1, thiserror@1.0.69, thiserror@2.0.20, thiserror-impl@1.0.69, thiserror-impl@2.0.20, time@0.3.55, time-core@0.1.9, time-macros@0.2.32, tokio@1.53.1, tokio-macros@2.7.2, tokio-rustls@0.26.5, tokio-stream@0.1.19, tokio-util@0.7.19, toml@0.8.2, toml@0.9.12+spec-1.1.0, toml@1.1.6+spec-1.1.0, toml_datetime@0.6.3, toml_datetime@0.7.5+spec-1.1.0, toml_datetime@1.1.1+spec-1.1.0, toml_edit@0.19.15, toml_edit@0.20.2, toml_edit@0.25.15+spec-1.1.0, toml_parser@1.1.3+spec-1.1.0, toml_writer@1.1.2+spec-1.1.0, tower@0.5.3, tower-http@0.6.11, tower-layer@0.3.3, tower-service@0.3.3, tracing@0.1.44, tracing-attributes@0.1.31, tracing-core@0.1.36, try-lock@0.2.5, typeid@1.0.3, typenum@1.20.1, uds_windows@1.2.1, unic-char-property@0.9.0, unic-char-range@0.9.0, unic-common@0.9.0, unic-ucd-ident@0.9.0, unic-ucd-version@0.9.0, unicode-ident@1.0.24, unicode-segmentation@1.13.3, url@2.5.8, urlpattern@0.3.0, utf8_iter@1.0.4, uuid@1.26.1, vcpkg@0.2.15, version-compare@0.2.1, version_check@0.9.5, vswhom@0.1.0, vswhom-sys@0.1.3, walkdir@2.5.0, want@0.3.1, wasi@0.11.1+wasi-snapshot-preview1, wasip2@1.0.4+wasi-0.2.12, wasm-bindgen@0.2.128, wasm-bindgen-futures@0.4.78, wasm-bindgen-macro@0.2.128, wasm-bindgen-macro-support@0.2.128, wasm-bindgen-shared@0.2.128, wasm-streams@0.5.0, web-sys@0.3.105, web_atoms@0.2.6, webkit2gtk@2.0.2, webkit2gtk-sys@2.0.2, webview2-com@0.38.2, webview2-com-macros@0.8.1, webview2-com-sys@0.38.2, winapi@0.3.9, winapi-i686-pc-windows-gnu@0.4.0, winapi-util@0.1.11, winapi-x86_64-pc-windows-gnu@0.4.0, window-vibrancy@0.6.0, windows@0.61.3, windows-collections@0.2.0, windows-core@0.61.2, windows-future@0.2.1, windows-implement@0.60.2, windows-interface@0.59.3, windows-link@0.1.3, windows-link@0.2.1, windows-numerics@0.2.0, windows-registry@0.6.1, windows-result@0.3.4, windows-result@0.4.1, windows-strings@0.4.2, windows-strings@0.5.1, windows-sys@0.45.0, windows-sys@0.52.0, windows-sys@0.59.0, windows-sys@0.60.2, windows-sys@0.61.2, windows-targets@0.42.2, windows-targets@0.52.6, windows-targets@0.53.5, windows-threading@0.1.0, windows-version@0.1.7, windows_aarch64_gnullvm@0.42.2, windows_aarch64_gnullvm@0.52.6, windows_aarch64_gnullvm@0.53.1, windows_aarch64_msvc@0.42.2, windows_aarch64_msvc@0.52.6, windows_aarch64_msvc@0.53.1, windows_i686_gnu@0.42.2, windows_i686_gnu@0.52.6, windows_i686_gnu@0.53.1, windows_i686_gnullvm@0.52.6, windows_i686_gnullvm@0.53.1, windows_i686_msvc@0.42.2, windows_i686_msvc@0.52.6, windows_i686_msvc@0.53.1, windows_x86_64_gnu@0.42.2, windows_x86_64_gnu@0.52.6, windows_x86_64_gnu@0.53.1, windows_x86_64_gnullvm@0.42.2, windows_x86_64_gnullvm@0.52.6, windows_x86_64_gnullvm@0.53.1, windows_x86_64_msvc@0.42.2, windows_x86_64_msvc@0.52.6, windows_x86_64_msvc@0.53.1, winnow@0.5.40, winnow@0.7.15, winnow@1.0.4, winreg@0.10.1, winreg@0.55.0, wit-bindgen@0.57.1, wry@0.55.1, x11@2.21.0, x11-dl@2.21.0, xattr@1.6.1, zbus@5.19.0, zbus_macros@5.19.0, zbus_names@4.3.4, zcheapstr@1.1.0, zeroize@1.9.0, zip@4.6.1, zmij@1.0.23, zvariant@5.15.0, zvariant_derive@5.15.0, zvariant_utils@4.2.0
MIT-0 (1): dunce@1.0.5
MPL-2.0 (5): cssparser@0.36.0, cssparser-macros@0.6.1, dtoa-short@0.3.5, option-ext@0.2.0, selectors@0.36.1
Unicode-3.0 (19): icu_collections@2.3.0, icu_locale_core@2.3.0, icu_normalizer@2.3.0, icu_normalizer_data@2.3.0, icu_properties@2.3.0, icu_properties_data@2.3.0, icu_provider@2.3.1, litemap@0.8.3, potential_utf@0.1.6, tinystr@0.8.4, unicode-ident@1.0.24, writeable@0.6.4, yoke@0.8.3, yoke-derive@0.8.2, zerofrom@0.1.8, zerofrom-derive@0.1.7, zerotrie@0.2.5, zerovec@0.11.8, zerovec-derive@0.11.6
Unlicense (6): aho-corasick@1.1.5, byteorder@1.5.0, memchr@2.8.3, same-file@1.0.6, walkdir@2.5.0, winapi-util@0.1.11
Zlib (21): bytemuck@1.25.2, dispatch2@0.3.1, foldhash@0.1.5, foldhash@0.2.0, miniz_oxide@0.8.9, miniz_oxide@0.9.1, objc2-app-kit@0.3.2, objc2-cloud-kit@0.3.2, objc2-core-data@0.3.2, objc2-core-foundation@0.3.2, objc2-core-graphics@0.3.2, objc2-core-image@0.3.2, objc2-core-location@0.3.2, objc2-core-text@0.3.2, objc2-exception-helper@0.1.1, objc2-osa-kit@0.3.2, objc2-quartz-core@0.3.2, objc2-ui-kit@0.3.2, objc2-user-notifications@0.3.2, objc2-web-kit@0.3.2, raw-window-handle@0.6.2
```

## License texts

### Community Data License Agreement – Permissive – Version 2.0

Full text of the license covering the `webpki-root-certs` data (see "Required
notices" above). Source: https://cdla.dev/permissive-2-0/ — shipped here
because §2.1 requires making the text available with the shared Data.

```text
Community Data License Agreement – Permissive – Version 2.0

This is the Community Data License Agreement – Permissive, Version 2.0 (the
"agreement"). Data Provider(s) and Data Recipient(s) agree as follows:

1. Provision of the Data

1.1. A Data Recipient may use, modify, and share the Data made available by
Data Provider(s) under this agreement if that Data Recipient follows the
terms of this agreement.

1.2. This agreement does not impose any restriction on a Data Recipient's
use, modification, or sharing of any portions of the Data that are in the
public domain or that may be used, modified, or shared under any other
legal exception or limitation.

2. Conditions for Sharing Data

2.1. A Data Recipient may share Data, with or without modifications, so
long as the Data Recipient makes available the text of this agreement with
the shared Data.

3. No Restrictions on Results

3.1. This agreement does not impose any restriction or obligations with
respect to the use, modification, or sharing of Results.

4. No Warranty; Limitation of Liability

4.1. All Data Recipients receive the Data subject to the following terms:

THE DATA IS PROVIDED ON AN "AS IS" BASIS, WITHOUT REPRESENTATIONS,
WARRANTIES OR CONDITIONS OF ANY KIND, EITHER EXPRESS OR IMPLIED INCLUDING,
WITHOUT LIMITATION, ANY WARRANTIES OR CONDITIONS OF TITLE, NON-INFRINGEMENT,
MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.

NO DATA PROVIDER SHALL HAVE ANY LIABILITY FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING WITHOUT
LIMITATION LOST PROFITS), HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
OTHERWISE) ARISING IN ANY WAY OUT OF THE DATA OR RESULTS, EVEN IF ADVISED
OF THE POSSIBILITY OF SUCH DAMAGES.

5. Definitions

5.1. "Data" means the material received by a Data Recipient under this
agreement.

5.2. "Data Provider" means any person who is the source of Data provided
under this agreement and in reliance on a Data Recipient's agreement to its
terms.

5.3. "Data Recipient" means any person who receives Data directly or
indirectly from a Data Provider and agrees to the terms of this agreement.

5.4. "Results" means any outcome obtained by computational analysis of
Data, including for example machine learning models and models' insights.
```
