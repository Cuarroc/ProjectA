# Review-Disposition PR #9 (W5-22), Stufe B: grok

Kandidat: Branch `claude/w5-22`, geprüft `57017f4`, nach Umsetzung siehe
Commits unten. Autor: kimi (Worker). Reviewer: grok (xAI) über
`grok.exe --prompt-file` im Plan-Modus (read-only) — andere Modellfamilie als
der Autor, Stufe B (ein Reviewer). Ollama und OpenCode waren für diesen Auftrag
gesperrt (Wochenlimit); das bisherige Paar (kimi-k3, glm-5.2, Runden 1 und 2)
steht in der PR-Beschreibung.

## Review

- `.pa/review_pr9_grok.md` (Kandidat `57017f4`, voller Diff
  `origin/main...HEAD`, Prompt: `.pa/review_prompt_pr9.md`): ein Befund hoch
  (G1), drei niedrig (G2–G4). Antwort unverändert gespeichert; die Nummern
  G1–G4 sind die Reihenfolge der Antwort. Die Zeilenangaben stimmen mit dem
  Stand `57017f4` überein.

## Verifikation vor der Disposition

- G1: `Seam::of_path` kannte nur die Datei `store.rs` und Pfade unter
  `store/`; `normalize_scopes` (`store/continuous.rs`) entfernt den
  abschließenden Schrägstrich, ein Scope `src-tauri/src/store/` kommt also als
  `src-tauri/src/store` an — bestätigt. `scopes_conflict` sieht
  `store` gegen `store.rs` nicht als gleichen Scope (`.rs` ist keine
  `/`-Grenze) — bestätigt. Rot-Test: `Seam::of_path("src-tauri/src/store")`
  war `None`.
- G1 (Vorhersage-Hälfte): `dispatch_order` erzeugte Konflikt-Kanten nur über
  `paths_overlap`; zwei Pakete auf verschiedenen Dateien derselben
  Nahtstellen-Lane (`store/continuous.rs` gegen `store/discovery.rs`) bekamen
  keine Kante, obwohl der Guard sie sperrt. Vom Reviewer nur für das
  Verzeichnis-gegen-Datei-Paar genannt, die Ursache ist aber die allgemeinere
  Lücke — bestätigt durch einen diskriminierenden Test (rot vor dem Fix).
- G2: `normalize_path` entfernte nur ein führendes `./`; `store/../api.rs`
  wurde als `st` klassifiziert — bestätigt (Rot-Test). Die Aufnahme
  (`normalize_scopes`) lehnt `.`/`..` ab, der Guard-Store-Pfad sieht sie also
  nicht; die Vorhersage-Eingabe hat dieses Tor nicht.
- G3: `launch_worker` legt die Lane-Warnung nach `mark_development_run_launched`
  ab — bestätigt.
- G4: `checkpoint_continuous_task(.., "retry")` gibt den Claim frei und öffnet
  die Aufgabe; der bisherige Test prüfte nur den gehaltenen Claim nach einem
  fehlgeschlagenen Lauf — bestätigt.

## Dispositionen

| ID | Schwere | Befund | Disposition |
|---|---|---|---|
| G1 | hoch | Verzeichnis-Scope `store` belegt keine Lane und kollidiert nicht mit `store.rs`; Guard und Vorhersage lassen beide Pakete gleichzeitig laufen | angenommen: `Seam::of_path` ordnet `src-tauri/src/store` der Store-Lane zu; `dispatch_order` setzt zusätzlich zur Pfad-Überlappung eine Kante bei gemeinsamer Nahtstellen-Lane (Regel des Guards). Rot `2188f92` (Exit 101, 3 failed), grün `b3448c6` (`cargo test --bin projecta lane_guard`, Exit 0, 17 passed; die Rückrechnung der Welle 2 bleibt grün) |
| G2 | niedrig | Punkt-Segmente werden roh klassifiziert (`./store.rs`, `store/../api.rs`) | angenommen: `normalize_path` faltet `.` und auflösbare `..`; ein `..`, das über den Anfang hinausführt, bleibt stehen. Rot/Grün wie G1 |
| G3 | niedrig | Bei einem Fehler in `mark_development_run_launched` geht die Überlappungs-Warnung verloren | abgelehnt: Doppelfehler-Pfad (Worker gespawnt **und** Übergang scheitert); der Aufrufer bekommt dann den Abgleichsfehler (`worker may be running; reconciliation required`), und der Run steht in `reconciling` — das ist das maßgebliche Signal. Die Warnung ist advisory und aus den Aufgaben-Pfaden jederzeit neu berechenbar. Ein Umstellen der Reihenfolge würde eine Nachricht an einen Worker schreiben, dessen Start noch nicht bestätigt ist; das widerspricht der Rolle des Übergangs als Bestätigung |
| G4 | niedrig | Der Freigabetest deckt den `retry`-Pfad nicht ab | angenommen: neuer Test `a_retry_checkpoint_releases_the_claim_and_with_it_the_lane` legt fest, dass `retry` den Claim und damit die Lane freigibt; das wiederholte Paket wird bei seinem Neustart wieder vom Guard geprüft. Verhaltens-Pin, daher schon im Rot-Commit grün (kein Fehlerbeleg möglich) |

## Folgearbeit

Unverändert aus der PR-Beschreibung: TOCTOU-Härtung in der Reservierungs-
Transaktion (st-Lane, mit W5-25), Claim-Zeitpunkt-Check, Nits N-01/N-02.
