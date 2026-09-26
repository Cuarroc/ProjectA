# Task omniw2 — OmniRoute-Integration W2: Fehlerklassen, Free-Tier-Zugang, Timeouts

Status: historisch

Du arbeitest im Worktree `~/wt/omniw2` (Branch `omni/w2`, Basis `origin/main`).
Gesamtplan: `docs/superpowers/plans/omniroute-integration.md` (W2, Teilmenge).
Parallel läuft W1a — deshalb gelten **harte Dateigrenzen**.

## Dateigrenzen (strikt)

Erlaubt: `src-tauri/src/status.rs`, `src-tauri/src/queue.rs`,
`src-tauri/src/freetier.rs`, `src-tauri/src/api.rs`, `src-tauri/src/bin/pa.rs`,
`src/types.ts`, `src/lib/ipc.ts`, `src/lib/` (neue kleine Hooks falls nötig).
**Tabu:** `store.rs`, `routing.rs`, `workers.rs`, `omniroute.rs`, `main.rs`,
`providers.rs` und alles Frontend außer den genannten lib-Dateien.

## Aufgaben (rot zuerst; ein Test, der nicht rot war, zählt nicht)

1. **`503 chat_admission_busy` als eigene Fehlerklasse** (`status.rs`):
   OmniRoute antwortet agentische Überlastung mit 503 und dem Fehlercode
   `chat_admission_busy` (= „zu viele schwere Anfragen gleichzeitig", retry
   später). Heute matched das keinen Quota-Substring — gut so, aber es wird
   auch nicht als das erkannt, was es ist. Neu: ein erkannter Zustand
   „admission busy / retry later" (eigene Klasse neben Quota-Block; lies die
   vorhandene Heuristik-Struktur und haenge dich an deren Muster).
   Rot: Test mit echter Beispielausgabe (`{"error":{"code":"chat_admission_busy"...}}`
   bzw. dem Text, den das CLI ins Terminal schreibt — recherchiere die
   tatsächliche Ausgabeform und belege sie im Bericht).
2. **Dispatcher-Umgang damit** (`queue.rs`): tritt admission-busy beim Spawn
   auf, darf **kein** Quota-Block und **kein** Fallback-Hop ausgelöst werden
   (das Problem ist Parallelität, nicht Kontingent) — der Task bleibt ready
   und wird später erneut versucht (Backoff beachten, lies den vorhandenen
   Retry-/Dispatch-Zyklus). Rot: Test, der einen Spawn mit admission-busy
   simuliert und zeigt, dass heute fälschlich fallbackgegangen bzw. geblockt
   wird (wenn dem nicht so ist: dokumentieren und den Test als Verhaltens-
   Beweis umdrehen).
3. **Free-Tier-Timeout** (`freetier.rs:148-167`): der Fetch von
   `/api/free-tier/summary` läuft mit dem 2-s-Probe-Timeout und wird bei
   langsamer Route als „offline" falsch etikettiert. Eigenes Budget (10 s)
   und ehrliche Unterscheidung. Rot: Test mit einem lokalen Listener, der
   3 s braucht (Muster: TcpListener-Tests in omniroute.rs/api.rs).
4. **Free-Tier für API und CLI:** `GET /api/freetier` in `api.rs`
   (bestehenden Tauri-Command-Pfad `get_free_tier_summary` wiederverwenden;
   lies wie andere Routen den App-State bekommen) und `pa freetier` in
   `bin/pa.rs` (Ausgabe kompakt: Pool, Rest, ToS-Status). Rot: Route-Test
   nach dem Muster der vorhandenen api.rs-Tests.
5. **`AUTH_001` erkennen** (`status.rs`): OmniRoutes JSON-Fehler
   `{"error":{"code":"AUTH_001",...}}` am Terminal heißt „Gateway-Token
   fehlt/ungültig" — als eigener, benannter Zustand (nicht Quota).
   Rot: Fixture-Test.

## Verifikation (selbst ausführen, Exit-Codes unmaskiert)

```bash
export PATH="$HOME/.cargo/bin:$HOME/bin:$PATH"; export TMPDIR="$HOME/testtmp"
cd ~/wt/omniw2/src-tauri
cargo test; echo "TEST=$?"
cargo clippy --all-targets -- -D warnings; echo "CLIPPY=$?"
cargo fmt --check; echo "FMT=$?"
```

Frontend-Änderungen (falls types/ipc): im Repo-Root `npm run typecheck`.

## Bericht

`BERICHT.md` im Worktree: gebaute Änderungen, Rot-Nachweise mit echter
Fehlerausgabe, die recherchierte Ausgabeform von admission-busy/AUTH_001,
Gate-Exit-Codes, Plan-Annahmen bestätigt/widerlegt. Commit auf `omni/w2`,
Push `origin omni/w2` (origin = server-lokales bare-Repo; Refs gehören dir
als worker — bei root-owned-Ref-Problemen: nichts forcieren, im Bericht
melden).
