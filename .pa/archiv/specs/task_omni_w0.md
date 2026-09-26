# Task omniw0 — OmniRoute-Integration W0: Parser-Fundament + Fehlerklassen

Status: historisch

Du arbeitest im Worktree `~/wt/omniw0` (Branch `omni/w0`). Der Branch enthält
unter `src-tauri/testdata/omniroute/` frische Live-Fixtures der OmniRoute-
Management-API (v3.8.49), aufgenommen gegen die echte lokale Instanz.

Kontext: ProjectA (Tauri-App, Rust-Kern) nutzt OmniRoute (lokaler AI-Gateway-
Daemon, 127.0.0.1:<omniroute-port>) bisher nur über das 7-Felder-Pipe-Format von
`/api/usage/logs`. Die Management-API liefert über `/api/usage/call-logs`
ein reicheres Objektformat (Felder u. a. `id`, `apiKeyName`, `sessionTag`,
`comboName`, `tokens{in,out,cacheRead,...}`, `correlationId`). Der Gesamtplan
liegt im Repo: `docs/superpowers/plans/omniroute-integration.md` — du baust
W0, das Fundament für W1 (Attribution pro Worker).

## Strikte Grenzen

- **Du fasst ausschließlich `src-tauri/src/omniroute.rs` an** (plus inline
  `mod tests` darin). Keine andere Datei. `api.rs`, `main.rs`, `store.rs`,
  `bin/pa.rs` sind Nahtstellen und tabu.
- Keine neuen Dependencies. Der HTTP-Client ist handgerollt und bleibt es.
- Alles fail-soft: ohne OmniRoute oder bei Parser-Bruch verhält sich die App
  wie heute (Pipe-Format-Fallback bleibt funktionsfähig).

## Aufgaben (rot zuerst — ein Test, der nicht rot war, zählt nicht)

1. **Call-Logs-Parser:** Neuer Parser für das Objektformat von
   `/api/usage/call-logs` (Fixture `testdata/omniroute/call-logs.json`).
   Roter Test: das Fixture muss alle Zeilen mit `id`, `apiKeyName`,
   `sessionTag`, `comboName`, Token-Zahlen und Timestamp liefern — heute
   gibt es diese Funktion nicht, also scheitert der Test zuerst am Fehlen.
   `null`-Felder müssen als `None` durchfallen (das Fixture enthält welche).
2. **Fehlerklassen:** `UsageError` (oder die Fetch-Funktion) unterscheidet
   künftig mindestens `Unauthorized` (401/403, Fixture `error-401.json`),
   `Busy/RateLimited` (429/503), `Timeout`, `Offline` (Connection refused)
   statt alles zu `None` zu kollabieren. Rot: Tests mit simulierten
   Antworten (du darfst einen lokalen Test-Listener auf 127.0.0.1 mit
   freiem Port im Test aufmachen — Muster dafür gibt es in api.rs-Tests).
3. **Version in der Probe:** Die Health-Probe liest zusätzlich ein
   Versionsfeld (OmniRoute hat `/api/version`; wenn unauthentifiziert nicht
   erreichbar, nimm das Feld aus einer der bereits geholten Antworten oder
   lasse es optional). Ziel: `UsageReport` (oder die Probe-Struktur) trägt
   `omniroute_version: Option<String>`. Rot: Fixture-Test.
4. **Kommentar-Hygiene:** Der Modulkopf von `omniroute.rs` beschreibt nach
   deiner Änderung die neue Realität (Objektformat neben Pipe-Format,
   Fehlerklassen), nicht den alten Stand.

## Verifikation (alles selbst ausführen)

```bash
export PATH="$HOME/.cargo/bin:$HOME/bin:$PATH"
export TMPDIR="$HOME/testtmp"
cd ~/wt/omniw0/src-tauri
cargo test omniroute        # deine neuen Tests + alle alten grün
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

## Bericht

Schreibe `BERICHT.md` in den Worktree (~/wt/omniw0): was gebaut, welche
Tests rot gesehen wurden (echte Fehlerausgabe zitieren), Gate-Ergebnisse mit
Exit-Codes, was du an Live-Annahmen im Plan bestätigt oder widerlegt hast.
Committe deine Arbeit auf `omni/w0` und pushe (`git push origin omni/w0`;
origin zeigt auf das lokale bare-Repo auf dem Server).
