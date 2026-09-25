# Report W5-02b5: extraHeader-Reset-Test mit lokalem HTTP-Server; GPG unter strict

Branch `claude/w5-02b5`, Lane fR (Tests, keine Nahtstelle). Autor: Kimi (Kimi
Code CLI). Quelle: MASTERPLAN-Zeile W5-02b5, Folgepaket aus Report W5-02b
(PR #93, Review-Auflagen K-B2/G-2 und K6).

## Was

Alle Änderungen in `src-tauri/src/pty/agent_env.rs` (Tests + Kommentare), dazu
eine fremde fmt-Normalisierung (eigener Commit, Begründung unten).

1. **`HeaderServer`** (nur `std`): aufzeichnender HTTP-Server auf
   `127.0.0.1:0` — nonblocking accept + Stopp-Flag, `Drop` join’t den Thread,
   5-s-Lese-Timeout, Antwort leeres 200. Keine neue Abhängigkeit.
2. **Test `strict_agent_env_resets_a_generic_http_extra_header`**: ein
   generisches `http.extraHeader` (Repo-Config, `Authorization: Bearer
   <Marke>`) erreicht den Server unter `inherit`, unter `strict` nicht —
   der Reset aus `STRICT_GIT_CONFIG` ist jetzt testbelegt (war Auflage
   K-B2/G-2 aus W5-02b Runde 2).
3. **Test `strict_agent_env_url_scoped_extra_header_is_a_known_leak`**
   (gepinnte Grenze): sobald die Config eine **matchende**
   `http.<url>.extraHeader`-Sektion trägt, gehen unter `strict` BEIDE Header
   (scoped und generisch) raus. Mechanismus (git 2.55 Quelltext,
   `urlmatch.c` `urlmatch_config_entry`): pro Key wird nur der beste
   URL-Match behalten (`string_list_insert` + `cmp_matches`); der generische
   Kommandozeilen-Reset gilt als „schlechterer Match" und wird verworfen,
   bevor `http.c` ihn sieht. Env-seitig gibt es keinen Fix — die URL steckt
   im Key-Namen; harte Grenze bleibt der eigene OS-Benutzer (W5-02e). Der
   Test pinnt das Ist-Verhalten und wird rot, wenn git das ändert.
4. **Test `strict_agent_env_keeps_the_users_signing_mandate`** (GPG-Teil,
   Nutzerentscheidung K6 aus W5-02b: strict erzwingt kein
   `commit.gpgsign=false`): `STRICT_GIT_CONFIG` nennt keinen Signatur-Key,
   und ein Repo mit `commit.gpgsign=true` + `gpg.program=git` (git als
   Stellvertreter-Signierer lehnt die gpg-Argumente sofort ab — kein
   pinentry, kein Hängen, plattformfest) scheitert unter `strict` laut am
   Commit; nichts landet unsigned.
5. **Modul-Doc + `STRICT_GIT_CONFIG`-Kommentar** auf den Belegstand gebracht
   (Reset testbelegt, scoped-Grenze gepinnt, Signatur-Entscheidung).
6. **`skills.rs` fmt-Normalisierung** (`cb8eae4`): vorbestehender
   rustfmt-Drift aus dem Public-Release-Squash ließ das precommit-fmt-Gate
   für jeden Commit rot werden. Kein Produktcode.

## Red → Grün

Die drei Testnamen existieren an der Merge-Base (`c60f267`) nicht → dort
„rot/fehlend" (red-first zählt das als rot), am Kopf grün. Trailer je Commit:
zweimal `Test-First:` (Header-Tests), einmal `Test-First:` (GPG), zweimal
`No-Test:` (fmt-Normalisierung, Doku).

## Befundlage (neu, durch dieses Paket bewiesen)

Die W5-02b-Annahme „`http.extraHeader=` leert die Headerliste" gilt **nicht
mehr**, sobald ein Checkout eine auf die Remote-URL matchende
`http.<url>.extraHeader`-Sektion trägt: dann geht auch ein generisch
konfigurierter `Authorization`-Header unter `strict` mit. Reproduziert mit
git 2.55.0.windows.3 (Test + unabhängige Probe außerhalb des Tests);
Mechanismus im git-Quelltext nachgewiesen. Vorschlag als Folgepaket/W5-02e-
Kontext aufnehmen; betrifft auch W5-02b4 (strict als Voreinstellung).

## Tests und Gates (Exit-Codes)

Lokal, Windows 11, Build-Slot `projecta-c`, `CARGO_BUILD_JOBS=1`:

- `cargo test --bin projecta pty::agent_env::tests::strict_agent_env_resets_a_generic_http_extra_header -- --exact --nocapture` → **exit=0**
- `cargo test --bin projecta pty::agent_env::tests::strict_agent_env_url_scoped_extra_header_is_a_known_leak -- --exact --nocapture` → **exit=0**
- `cargo test --bin projecta pty::agent_env::tests::strict_agent_env_keeps_the_users_signing_mandate -- --exact --nocapture` → **exit=0**
- `bash scripts/ci/gates.sh lane prepush` → **exit=0**: fmt, typecheck,
  lint, fe-test, hq-test, clippy, rust-suite (1606 passed, 17 skipped),
  gesamt 527 s.

NICHT ABGEDECKT von diesem Lauf: die `#[cfg(unix)]`-Tests (Dateirechte,
Prozessgruppen-Kill) — kompilieren unter Windows nicht (KNOWN_ISSUES KI-7) —
und die Linux-Arme von clippy; dieser Lauf belegt die Windows-Hälfte, die
Linux-Hälfte kommt aus der CI-Linux-Bahn (WSL2/CI). prepush ist die schnelle
Schleife: Browser-Smoke, Frontend-Build und die Workflow-Gates laufen erst in
der Bahn `linux`. Externe Dienste (Updater-Endpoint, OmniRoute, Mirror) prüft
kein Gate.

## Reviews

Pflicht wegen 316 Diff-Zeilen: zwei anbieterfremde Reviews.

- **glm-5.2** (`glm-5.2:cloud`, Ollama): Urteil „ablehnen" wegen F1
  (angeblich fehlender `Write`-Import). Disposition in
  `.pa/review_w5-02b5_disposition.md`: F1 Fehlalarm mit Gate-Beleg
  (Modul-Import vorhanden, Kandidat kompiliert, Suite grün), F2/F3 mit
  Grund abgelehnt bzw. bereits erfüllt, F4 Bestätigung. Kein offener Befund.
- **kimi-k3** entfällt (Autorenfamilie). **Fable 5.1**: Pool ohne Guthaben
  (402). **GPT-6 Astra**: Kontingent bis 30.09. erschöpft. Zweites Review
  extern blockiert — siehe Offene Punkte.

## Offene Punkte

- **Zweites anbieterfremdes Review nachholen** (extern blockiert, kein
  Guthaben/Kontingent am 25.09.) — vor dem Merge durch den Koordinator.
- Folgeaufnahme des scoped-extraHeader-Befunds (W5-02e-Kontext; relevant für
  W5-02b4 „strict als Voreinstellung").
- W5-02b4 bleibt offen: Push in den Runner-Host, danach `strict` als
  Voreinstellung.
- Repo-weit (außerhalb dieses Pakets): Hook-/Skript-Dateimodi stehen im
  Public-Release-Squash auf 100644 (`scripts/install-hooks.sh` meldet das);
  die fmt-Drift-Stelle in `skills.rs` ist mit `cb8eae4` behoben, weitere
  Drift-Stellen sind nicht geprüft.
