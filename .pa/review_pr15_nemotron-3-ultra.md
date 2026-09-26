# Review: W2-04d — Dispatch Roles Mapped to Token Budget Purposes

---

## Befunde

### 1. ID: B-01 | Schwere: niedrig | Datei: `src-tauri/src/store/development_budget.rs:84-91`
**Begründung:** Das Mapping `coordinator→planning`, `implementer→implementation`, `reviewer→review`, `integrator→verification` ist fachlich sinnvoll: Planungs-/Koordinationsarbeit nutzt den ungeschützten Pool, Review/Integration ziehen aus der geschützten Verification-Reserve (40k von 200k). Die Enforcement-Logik in `reserve_development_tokens` (Zeilen 122-131) prüft `purpose == required` und lehnt abweichende Zwecke fail-closed ab. Kein Bypass möglich.

### 2. ID: B-02 | Schwere: mittel | Datei: `src-tauri/src/store/development_budget.rs:132-136`
**Begründung:** Der Check `SELECT EXISTS(...) WHERE run_id=? AND state != 'cancelled'` läuft **innerhalb derselben Transaktion**, die bereits die Schreibsperre auf der Goal-Zeile hält (Serialisierung über `reserve_development_tokens`). Damit ist der Ein-Reservierung-pro-Run-Check rassefest — zwei parallele Calls können nicht beide `taken=false` sehen.

### 3. ID: B-03 | Schwere: mittel | Datei: `src-tauri/src/store/development_budget.rs:153-160` & `development_usage_receipt.rs:235`
**Begründung:** `consume_worker` und `for_run` filtern nicht mehr auf `purpose='implementation'`. Die Eindeutigkeit wird durch die Invariante „höchstens eine nicht-stornierte Reservierung pro Run“ gewahrt, die **zur Reservierungszeit** erzwungen wird. Da `run_role` nach Claim unveränderlich ist, kann ein Run nie zwei Reservierungen mit unterschiedlichen Zwecken haben. Ein Worker kann **kein** fremdes Budget verbrauchen — die Reservation ist run-gebunden, der Zweck durch die Rolle fixiert.  
**Hinweis:** `consume_worker` nutzt `fetch_optional` ohne `ORDER BY`. Bei Verletzung der Invariante (z. B. manueller DB-Eingriff) wäre das Ergebnis undefiniert. Defensiv wäre `ORDER BY state='cancelled', created_at DESC, id DESC LIMIT 1` wie in `for_run`.

### 4. ID: B-04 | Schwere: niedrig | Datei: `src-tauri/src/store/development_budget.rs:161-137` (Logik-Reihenfolge)
**Begründung:** Idempotenz-Prüfung (gleicher Key → existierende Zeile zurückgeben) erfolgt **vor** dem Ein-Reservierung-pro-Run-Check. Der Test `a_run_holds_exactly_one_token_reservation` bestätigt: Replay mit gleichem Key liefert die alte Zeile; neuer Key für denselben Run schlägt fehl. Reihenfolge korrekt.

### 5. ID: B-05 | Schwere: mittel | Datei: `src-tauri/src/store/development_budget.rs:257-302` (Test `run_budget_purpose_must_match_the_dispatch_role`)
**Begründung:** Test deckt Reviewer mit allen 5 falschen Zwecken ab und Implementer mit `Review` (falsch) vs. `Implementation` (richtig). **Fehlt:** explizite Mismatch-Tests für `coordinator` (soll nur `Planning` zulassen) und `integrator` (soll nur `Verification` zulassen). Die Logik ist generisch, aber explizite Tests schließen Regressionslücken bei Rollen-Erweiterungen.

### 6. ID: B-06 | Schwere: niedrig | Datei: `src-tauri/src/store/development_budget.rs:78-80` & Kommentar Zeile 82-83
**Begründung:** Kommentar: „Review and integration draw from the protected verification reserve“. Tatsächlich teilen sich `Review` **und** `Verification` die 40k-Reserve (beide `protected()==true`). Begriff „Verification-Reserve“ ist irreführend — es ist ein **gemeinsamer Protected-Pool** für Review + Verification. Kein funktionaler Bug, aber Dokumentation/Kommentar sollten präzisieren: „protected reserve (review & verification)“.

### 7. ID: B-07 | Schwere: niedrig | Datei: `src-tauri/src/store/development_usage_receipt.rs:235`
**Begründung:** `for_run` nutzt `ORDER BY state='cancelled', created_at DESC, id DESC LIMIT 1`. In SQLite ist `state='cancelled'` boolean (0/1) → nicht-storniert (0) kommt vor storniert (1). Neueste nicht-stornierte Reservation gewinnt. Korrekt und deterministisch.

---

## Urteil

**Freigabe mit Auflagen**

### Auflagen (vor Merge zu beheben):
1. **Test-Ergänzung:** Explizite Purpose-Mismatch-Tests für `coordinator` und `integrator` in `run_budget_purpose_must_match_the_dispatch_role` hinzufügen (analog zu Reviewer/Implementer).
2. **Defensive Query:** `consume_worker` um `ORDER BY state='cancelled', created_at DESC, id DESC LIMIT 1` erweitern (Konsistenz mit `for_run`, Schutz vor manuellen DB-Anomalien).
3. **Kommentar-Korrektur:** Zeile 82-83 in `development_budget.rs` — „verification reserve“ → „protected reserve (review & verification)“.

### Keine Blocker:
- Mapping ist fachlich vertretbar und fail-closed erzwungen.
- Rassesicherheit durch Goal-Zeilen-Serialisierung gegeben.
- Idempotenz-Reihenfolge korrekt.
- Keine Migration nötig (CHECK-Constraint deckt alle Zwecke ab).
- Bestehende Tests + neue Tests decken Kernszenarien ab (inkl. Stornierung/Neu-Reservierung).
