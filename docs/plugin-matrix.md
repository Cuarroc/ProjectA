# Plugin- und Capability-Matrix

Stand: 24.09.2026 (`log` registriert in W1-22; davor W1-06; Substanz aus P2-F, Phase 2).
Quelle der Wahrheit sind `src-tauri/Cargo.toml`,
`src-tauri/src/main.rs` (`.plugin()`-Aufrufe) und
`src-tauri/capabilities/default.json`; diese Tabelle erklärt **warum**. Wer ein
Plugin hinzufügt, trägt es hier ein — und schreibt einen Config-Test nach dem
Muster von `src/opener-config.test.ts`, der Crate, Registrierung und Permission
zusammenhält (Tauri prüft die `.plugin()`-Registrierung nicht).

## Registriert

| Plugin | Wozu | Permission(s) in `capabilities/default.json` | Begründung / Grenze |
|---|---|---|---|
| `core` | Fenster, Events, IPC | `core:default` | Tauri-Grundbedarf. Nicht weiter eingeschränkt: die App hat ein Fenster (`main`), keine Multi-Window-Isolation. |
| `updater` (2) | Auto-Update über den öffentlichen Mirror `Cuarroc/ProjectA-updates` | `updater:allow-check`, `updater:allow-download`, `updater:allow-install`, `updater:allow-download-and-install` | Endpoint in `tauri.conf.json` (`plugins.updater.endpoints`), Signatur-Pubkey dort. Test: `src/updater-config.test.ts`. Läuft Rust-seitig (reqwest), **nicht** durch die Webview-CSP. |
| `process` (2) | Neustart nach Update | `process:allow-restart` | Nur `restart`; `exit` ist nicht erlaubt (die App beendet sich über das Fenster). |
| `single-instance` (2.4.4) | Eine Flotte, ein Fenster: der Guard verhindert, dass eine zweite Instanz denselben App-Data-Ordner und dieselbe Queue übernimmt | keine (reines Rust-Plugin, keine JS-API und damit keine Permission) | Nachgetragen 17.09.2026 (W1-06) — das Plugin fehlte in dieser Tabelle, obwohl es seit F1 registriert ist. Es muss **das erste** `.plugin()` auf dem Builder sein (`main.rs:3137`), sonst läuft Initialisierung der zweiten Instanz an; der Test `the_single_instance_guard_is_the_first_plugin_on_the_builder` (`main.rs:3936`) hält diese Position fest. Deskriptor-Grenze: `remove_descriptor_if_ours` löscht `projecta-api.json` nur bei eigenem Port und Token (`.pa/report_f1_si1_descriptor.md`). |
| `log` (2.9.2, seit W1-22 24.09.) | Datei-Logging nach `<app data>/logs/projecta.log` (der Pfad, den Diagnostics zeigt), Rotation 1 MiB × 5 Generationen (`projecta_<datum>.log`) | keine — bewusst **kein** `log:default`: die Webview hat keinen Weg in die Datei | Ersetzt das handgerollte P2-C-Logging. Registriert im Setup (`logging::init(&handle, &dir)`), nicht am Builder: die Datei liegt unter dem App-Data-Ordner, der erst dort feststeht — und so hinter dem Single-Instance-Guard. Einziges Ziel ist die Datei (kein Stdout, kein Webview-Ziel). **Redaction:** `logging::format_line` ist der Formatter des Plugins und läuft vor jedem Ziel über jeden Datensatz, auch über die fremder Crates (die nur ab `Warn` durchkommen). Canary: `logging::tests::canary_no_secret_reaches_the_file_through_the_plugin_formatter`; Verdrahtung/Pfad/keine Permission: `the_plugin_writes_the_file_diagnostics_shows_and_the_webview_cannot`. Der Panic-Hook schreibt weiter direkt (am Plugin vorbei, redigiert). Schreiben ist jetzt synchron im aufrufenden Thread (fern), nicht mehr über einen Writer-Thread. Scheitert das Schreiben (volle Platte), gibt fern die schon redigierte Zeile mit „Error performing logging" auf stderr aus (`fern 0.7.1 log_impl.rs::backup_logging`) — wie der alte Writer (Review W1-22, Kimi-4). |
| `opener` (2.5.5, seit P2-J 02.09.) | Links im OS-Browser öffnen (PR-Links, Web-Interface-URL, Empfehlungen, Markdown-Preview) | `opener:allow-open-url` mit Scope `https://*`, `http://*` | Bewusst **nicht** `opener:default` (erlaubt `mailto:`/`tel:` und `reveal-item-in-dir`). Kein GitHub-only-Scope, weil das Web-Interface LAN-URLs (`http://`) öffnet. `ipc.ts::openExternal` weist alles außer http(s) vorher ab. Glob `https://*` matcht Pfade (glob 0.3.4, `require_literal_separator=false`, nachgemessen). Test: `src/opener-config.test.ts`. |

## Bewusst nicht registriert

| Plugin | Warum nicht (jetzt) | Wann |
|---|---|---|
| `dialog` | Ordner-Picker für Projekte; heute Texteingabe. Edge-Cases (Off-Screen, AppUserModelID) sind der eigentliche Aufwand. | Wenn ein Paket es braucht — `docs/PLAN.md` §3 („bewusst zurückgestellt"). Die alte Marke „Phase 8 B3" existiert seit Sanierungsplan Rev 9 nicht mehr. |
| `notification` | Attention-Meldungen (5 Worker → 1 Meldung, Coalescing), Taskleisten-Badge. Dev-Build ist ohne AppUserModelID stumm — braucht eigenes Verify. | Wenn ein Paket es braucht — `docs/PLAN.md` §3. Die alten Marken „Phase 3.6 / Phase 8 B1" existieren seit Rev 9 nicht mehr; die Attention-Arbeit selbst ist mit F1/F3 abgenommen. |
| `window-state` | Fenstergröße/-position merken; Off-Screen-Restore muss getestet werden. | Wenn ein Paket es braucht — `docs/PLAN.md` §3. Die alte Marke „Phase 8 B2" existiert seit Rev 9 nicht mehr. |
| `shell` | Kein Bedarf: Prozesse startet der Rust-Kern selbst (PTY, oneshot, Job-Objects). Ein `shell:allow-execute` aus der Webview wäre ein Agenten-Ausbruchspfad. | Nie. |
| `fs` | Kein Bedarf: alle Dateizugriffe laufen über eigene IPC-Commands mit Pfadprüfung im Kern. | Nie. |

## Content Security Policy

Ein Wert, zwei Träger — und zwar mit Grund, live belegt am 02.09. (Dev-Build
mit CDP-Anbindung, `.pa/report_p2f.md`):

- **Dev (`tauri dev`, Webview lädt `http://localhost:1420` direkt von Vite):**
  Tauri injiziert **nichts**. Es gilt ausschließlich die Meta in `index.html`.
  Vites React-Refresh-Preamble (Inline-Skript) steht **vor** der Meta im
  `<head>` und ist damit nicht von ihr erfasst — React-Refresh läuft
  (`$RefreshReg$` vorhanden), HMR verbunden, IPC ok.
- **Prod (Tauri serviert `dist/` über sein Protokoll):** Tauri **hängt** seine
  Config-CSP als zweites Meta an (`tauri-utils 2.9.3`, `html.rs::inject_csp`:
  `head.append(...)` — kein Ersetzen), ergänzt um Nonces/Hashes für
  Inline-Inhalte und seine IPC-Quellen. Browser wenden die Schnittmenge an.
  Das ist unschädlich, weil `dist/index.html` keine Inline-Skripte/-Styles
  enthält (ein externes Modul-Skript, externe Stylesheets) und die statische
  Meta `ipc:` + `http://ipc.localhost` bereits selbst erlaubt. **Deshalb
  dürfen diese IPC-Quellen nicht aus der Meta entfernt werden** — sonst
  blockiert die statische Policy im Release die Tauri-IPC.

`src/csp-config.test.ts` erzwingt Gleichheit der beiden Träger (geparst, nicht
als String) und die Grenzen. Gleiche CSP in Dev und Prod — kein Config-Split.
Prod-Messung steht weiter aus — nachgeführt 17.09.2026 (W1-06): die Marke war
an v1.2.4 gebunden, aktuell ausgeliefert ist v1.4.0. Zu messen am
installierten Build: App rendert, IPC ok, keine „Refused to …"-Meldung im Log.
Bis dahin gilt die Prod-CSP als konfiguriert, nicht als gemessen.

| Direktive | Wert | Warum genau das |
|---|---|---|
| `default-src` | `'self'` | Alles, was nicht unten steht, kommt nur aus dem eigenen Ursprung. |
| `script-src` | `'self'` | Kein Inline-JS, kein `eval`. Vites Dev-Preamble (Inline) steht vor der Meta im `<head>` und ist von ihr nicht erfasst (live gemessen); `dist/index.html` hat kein Inline-Skript. |
| `style-src` | `'self' 'unsafe-inline'` | React setzt `style=`-Attribute (xterm, Layout-Maße). Hash-basiert wäre bei dynamischen Werten nicht machbar. |
| `img-src` | `'self' data:` | Icons/Avatare als data-URIs; **kein `blob:`** mehr (Phase-1-Rest, im Inventar keine Verwendung). |
| `font-src` | `'self'` | Inter liegt unter `/fonts/*.otf`; kein `data:`, kein CDN. |
| `connect-src` | `'self' ipc: http://ipc.localhost ws://localhost:1420 ws://localhost:1421` | Tauri-IPC (Linux/macOS `ipc:`, Windows `http://ipc.localhost`); Vite-HMR im Dev (1420, mit `TAURI_DEV_HOST` 1421). Kein `fetch` in `src/` — der Updater und alle HTTP-Zugriffe laufen im Rust-Kern. |
| `worker-src` | `'self'` | Explizit, obwohl es aus `script-src` fiele: xterm.js 5.5 + addon-webgl 0.18.0 (hart gepinnt, PR #43) brauchen keine Worker. Braucht ein künftiges Addon `blob:`-Worker, ist das eine bewusste CSP-Änderung, kein stilles Scheitern (Review P2-F, GLM-B8). |
| `object-src` | `'none'` | Keine Plugins/Embeds. |
| `base-uri` | `'self'` | Kein Umbiegen relativer URLs durch injiziertes Markup. |

Was **nicht** drin ist und warum: `frame-ancestors` (per CSP-Spezifikation in
einer Meta-Policy wirkungslos; WebView2 loggt bei jedem Start einen Fehler —
live gemessen 02.09., Review P2-F GLM-B1; kommt zurück, sobald Tauri die CSP
als Header liefert), `form-action` (fällt per CSP3 bewusst **nicht** auf
`default-src` zurück, ist also formal offen — ohne Wirkung: die App hat keine
HTML-Form-Submissions, alle Aktionen laufen über IPC-Commands; Review P2-F
GLM-B2 der aktuellen Runde), `http://localhost:*` (der Dev-Ursprung ist
`'self'`), `unsafe-eval` (nichts braucht es), `blob:` (unbenutzt), externe
Hosts (es gibt keine Webview-seitigen Netzwerkzugriffe), `asset:` /
`http://asset.localhost` (kein `convertFileSrc` im Code — wer es einführt,
ergänzt `img-src`/`media-src` um beide Formen, Review P2-F GLM-B5).

**Wirkungslos, aber unschädlich — Tauris Nonces im Release:** Tauri 2.9.3
ergänzt in **seiner** angehängten Config-CSP Nonce-Token für Skripte/Styles
und setzt die Nonce-Attribute in `dist/index.html` (`html.rs:131-158`).
Unter der Schnittmenge beider Metas sind diese Nonces wirkungslos: die
statische Meta erlaubt generell keine Inline-Skripte. Das ist gewollt —
Inline-Skripte sollen nicht nutzbar sein (Review P2-F GLM-B3 der aktuellen
Runde; Gemini-1-These „Tauris IPC-Bootstrap/Nonce-Skripte werden im Release
von der statischen Meta geblockt" ist damit **widerlegt**: sämtliche Skripte,
die Tauri zur Codegen-Zeit berührt, sind extern (`script[src^='http']`) oder
bereits nonce-fähig gestempelt; ein Inline-Skript, das die statische Meta
blocken würde, existiert im Bundle nicht — Beleg `dist/index.html` +
`html.rs:153`).

**Updater und CSP:** `@tauri-apps/plugin-updater` ruft Rust-Commands; Download
und Signaturprüfung laufen per `reqwest` im Rust-Prozess. Die Webview-CSP
(`connect-src`) betrifft nur `fetch`/`WebSocket`/`EventSource` aus der Webview
und damit den Updater nicht (Review P2-F, GLM-B9; GLM-4 aus dem Phase-2-Plan).

**Dev-only-Quellen in der Prod-CSP** (`ws://localhost:1420/1421`): bewusst
drin, weil Dev und Prod dieselbe Policy tragen sollen (kein Config-Split, der
im Dev anders scheitert als beim Nutzer). Im Release lauscht dort nichts; ein
Angreifer, der die Direktive ausnutzen könnte, hätte bereits Code in der
Webview (Review P2-F, Gemini-3, abgelehnt).
