# W2-09b: DeepSeek V4 Flash Cloud als OpenCode-Worker

Status: aktiv

Revision 6, 22.09.2026. Nutzerauftrag: deepseek-v4-flash:cloud fuer Ollama-
Worker pruefen. Ersetzt die Qwen-Richtung aus Revision5; historische Fassung
in .pa/report_ollama_spec_rev5_historical.md. Einziger Arbeitsplan docs/PLAN.md.

## Ziel und beobachteter Ausgangspunkt

Neues Profil `opencode-ollama-deepseek-v4-flash` verwendet den bestehenden
OpenCode-Harness mit `-m ollama/deepseek-v4-flash:cloud` und dem lokalen
Ollama-Endpunkt `http://127.0.0.1:11434/v1`. Das Ollama-Helperprofil bleibt.
Kein neuer Scheduler, kein direkter kostenpflichtiger API-Weg.

Am 22.09. belegt: Ollama registriert deepseek-v4-flash:cloud; OpenCode 1.18.31
kann es mit einer isolierten OPENCODE_CONFIG im CLI-run-Pfad nutzen. Ein
realer Read- und Write-Toolaufruf erzeugte eine bytegleiche Datei. Beleg:
.pa/report_deepseek_worker_probe_2026-09-22.md (in diesem Branch uebernommen). Beobachtet war cost=0 aus
OpenCode; unabhaengige Upstream-Abrechnung wurde nicht gemessen. Die Probe
mit `run --pure --agent build` ist KEIN Beleg fuer den interaktiven PTY-Pfad.

## Stufen und Vorbedingungen

1. PR50 vor PR49 integrieren: CursorReportScanner/RawTrace/AwaitingEnter
   aus50 behalten, Claude-Dialog- und Marker-Aenderungen aus49 ergaenzen.
2. Modellregistrierung, OpenCode-/Ollama-Version und Prozess-Konfiguration
   vor einem neuen Lauf erneut lesen. Kein erneutes Qwen-Pull noetig.
3. Vor Profilaktivierung einen isolierten interaktiven OpenCode-Capture
   mit genau der vorgesehenen Konfiguration fahren: Modellroute, Bootmarker
   und echte Tools beobachten. CLI-run-Erfolg ersetzt diese TUI-Probe nicht.
4. W1-02 muss die automatische OpenCode-Zustellung belegen, bevor das Profil
   als autonomer ProjectA-Worker freigegeben wird. Assistierte Laeufe sind
   Diagnose, kein Abschluss dieser Worker-Abnahme.
5. Wird Claude als Implementierer genutzt: ruflo-Hook-Zustand pruefen; keine
   globale Hook-Aenderung aus dieser Spec ableiten. Diese Voraussetzung
   betrifft den Implementierer, nicht die DeepSeek-Modellroute.
6. Keine neue bezahlte API-Nutzung. Laufende Produktiv-App/Queue nicht zur
   Sichtpruefung starten oder veraendern. Scratch-App nur bei bestaetigt
   beendeter Produktivinstanz, eigener PROJECTA_APP_DATA und eigenem Repo.

## Implementierung und Fehlervertrag

1. Kompilierende rote Verhaltenstests vor dem Fix. Fehlende Symbole,
   Compile-Fehler, null Tests oder eine nicht gebaute Datei sind kein
   Regressionsbeleg. Bei neuen Datenfeldern minimalen kompilierenden
   Vertrag bereitstellen und den fehlenden Effekt am bestehenden Spawn-
   bzw. Serialisierungspfad testen; roten und gruenen Lauf festhalten.
2. Optionaler `providerConfig`-Vertrag in capabilities.rs; bestehende
   Profile ohne diese Angabe behalten ihr Verhalten. Zunaechst nur der
   benoetigte Modus fuer eine pro Worker erzeugte OpenCode-JSON-Datei.
3. hooks.rs erzeugt atomar `<appdata>/hooks/<worker>.opencode.json` und
   setzt im zurueckgegebenen Profil OPENCODE_CONFIG auf den absoluten Pfad.
   Provider ollama: @ai-sdk/openai-compatible, Loopback-Endpunkt11434/v1,
   explizites DeepSeek-Modell. Tag aus genau dem einen `-m ollama/<tag>`-
   Argument ableiten; fehlende/mehrdeutige/falsche Routen ablehnen.
4. **Fail closed:** providerConfig vor dem bisherigen heuristic-/port0-
   Fruehreturn auswerten. Schreib-, Pfad-, JSON- oder Validierungsfehler
   verhindern den Spawn. Keine Rueckgabe des unveraenderten Profils mit
   Home-/alter Modellkonfiguration. Kein stiller Backend-Fallback.
   Die bestehende best-effort Hook-Semantik darf nur fuer Profile ohne
   verbindliche providerConfig erhalten bleiben.
5. Dafuer die fallible Schnittstelle und alle Spawn-Aufrufer explizit
   verfolgen. Wenn `with_hook_settings` Result zurueckgeben muss, main.rs
   seriell reservieren und beide Reviewer an dieser Nahtstelle einsetzen.
   Fehler muss vor Prozessstart an CLI/HQ sichtbar werden. Vorhandene
   Konfigurationswerte nicht versehentlich uebernehmen; Prozess-Env und
   Modellroute mit einem Fake-Child nachweisen.
6. remove_worker_files entfernt die eigene Config bei Ende/Abbruch.
   Fehlerpfade raeumen partielle Dateien auf. Keine Nutzer-Home-Config
   lesen/umschreiben und keine Datei im Worker-Repo erzeugen. Kein
   Credential in Config, Logs oder Snapshots. Gleiche Worker-IDs duerfen
   keine lebende Konfiguration anderer Worker ersetzen.
7. Neues Profil mit den aktuellen OpenCode-Caps, expliziter Modellroute
   und providerConfig; erst nach den passenden Stufengates aktivieren.
   ReadinessMarker `Ask anything` muss am TUI-Capture bestaetigt werden.
   Die Modellauswahl allein ist kein beobachteter Faehigkeitsbeleg.

## Tests und Dateigrenzen

Verbindliche Verhaltenstests:
- profiles: richtige Modellargumente/Caps und unveraenderter Helper.
- capabilities: JSON-Roundtrip und alte Profile ohne providerConfig.
- hooks: Inhalt/Pfad/Env aus Profilroute; auch bei heuristic und port0;
  fehlender/mehrdeutiger Modelltag; Schreib-/Validierungsfehler blockieren
  Prozessstart statt auf alte Konfiguration zurueckzufallen.
- Fake-Spawn: tatsaechlich uebergebene Env/Argumente, kein Spawn bei Fehler;
  getrennte Workerdateien und Cleanup bei normalem Ende/Abbruch.
- HQ: Profil erscheint mit ehrlichen Faehigkeiten; kein automatisch
  angenommener Tool-/Billing-/Zustellungsstatus.

Primaere Dateien: agent-defaults.json, capabilities.rs, hooks.rs,
profiles.rs, scripts/lib/hq-builtin-profiles.test.mjs, Capture in testutil.rs.
main.rs nur soweit fallible Spawn-Integration es erfordert, exklusiv und
mit zwei Reviews. pty.rs/submit_guard.rs bleiben W1-02/W1-03-Lane; dortige
Capture-Befunde separat aufnehmen. api.rs/store.rs/bin/pa.rs nicht anfassen.
Profilhash/Doctor/Snapshots nach den bestehenden Regeln synchronisieren.

## Reale Abnahme

A. Konfiguration/CLI-Probe: vorhandene Read/Write-Evidenz uebernehmen,
   Grenzen klar nennen. Das ist bereits belegt, aber noch kein PTY-Worker.
B. TUI-Profil: isolierter Roh-Capture mit aktuellem Modell/Bootmarker,
   echten Toolereignissen und Datei `probe-ollama.txt` mit exakt
   `PA_OLLAMA_OK` (12 Bytes, kein Newline), SHA256
   `435f9648249dc383244ed863d74d96a18c5f183840f856ae692720e39e16f909`.
   Pfad/Groesse/Version/Exitcode/Assists im Report dokumentieren.
C. Worker: dieselbe Datei im durch ProjectA erzeugten Worker-Worktree,
   Guard-Timeline und Datei-Hash, ohne manuelles Enter oder Send-Assist.
   Nach bestandenem W1-02; alle noch offenen Dialog-/DSR-Grenzen benennen.
D. Billing: beobachteten Modellnamen und OpenCode-Kostenwert protokollieren.
   cost=0 ist ein OpenCode-Anzeigebeleg, keine unabhaengige Abrechnung.
   Fehlender Betrag bleibt unbeobachtet und erfuellt keinen Nullkosten-
   Nachweis. Betrag>0 oder unerwartete Route stoppt die Probe und sperrt
   das Profil. Keine Credentials oder bezahlte Ersatzroute ausprobieren.

Vollabschluss W2-09b erst nach C und dem vereinbarten Billing-Nachweis;
A/B duerfen als Teilbelege erfasst werden. Keine allgemeine Matrix-Zeile
auf passed setzen, solange andere Provider oder Worker-Gates fehlen.

## Abschluss und Stop-Regeln

Report .pa/report_provider_adapter_smoke_ollama.md, Review-Disposition,
Spec/PLAN/STAND konsistent; Matrix behaelt pro Stufe die echte Grenze.
Frontend/Rust/HQ-Gates plus Linux/Windows/red-first am Integrationskandidaten.
Stop bei Konfigurationsfehler, unbekannter Abrechnung, anderer Modellroute,
unerwarteter Queue-Aktivitaet oder fehlender PTY-Zustellung. Kein globaler
Fallback und kein Wechsel auf ein anderes Modell ohne Nutzerentscheidung.
