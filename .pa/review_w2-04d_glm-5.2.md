# Review: w2-04d — glm-5.2

- Autor des Artefakts: kimi-k3 (claude/w2-04d)
- Reviewer: glm-5.2 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `glm-5.2:cloud`, bedient `glm-5.2`
- Datum: 2026-09-25 16:54 UTC, Dauer 93 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_w2-04d.md` (20344 Zeichen)

## Roh-Urteil des Reviewers

## Review-Bericht: W2-04d — Dispatch roles mapped to token budget purposes

### Befunde

**ID:** 1  
**Schwere:** niedrig  
**Datei:** `src-tauri/src/store/development_budget.rs` (Zeile ~220-238)  
**Begründung:** Die neue Invariante "ein Run hält höchstens eine nicht-stornierte Reservierung" wird über `SELECT EXISTS(...)` und `run_role()` innerhalb der Transaktion geprüft. Der Kontext gibt an, dass `reserve_development_tokens` über ein Schreibsperren-Update auf der Goal-Zeile serialisiert. Solange dieses `UPDATE` *vor* dem `EXISTS`-Check und dem `run_role`-Aufruf in derselben Transaktion ausgeführt wird, ist der Check rassefest. Da der Diff nur den Ausschnitt zeigt, ist dies im Gesamtkontext mutmaßlich erfüllt, sollte aber bei Wartung im Auge behalten werden.

**ID:** 2  
**Schwere:** niedrig  
**Datei:** `src-tauri/src/store/development_budget.rs` (Tests)  
**Begründung:** Testabdeckung für Stornierung und Neu-Reservierung fehlt. Es wird zwar getestet, dass ein zweiter Reservierungsversuch mit neuem Schlüssel fehlschlägt (`a_run_holds_exactly_one_token_reservation`), aber nicht, dass nach einer Stornierung (`state='cancelled'`) eine neue Reservierung für denselben Run erlaubt ist und von `consume_worker` bzw. `for_run` korrekt (unter Missachtung der alten stornierten Zeile) gezogen wird. Die SQL-Logik (`ORDER BY state='cancelled'` bzw. `WHERE state='reserved'`) deckt diesen Fall zwar korrekt ab, ein Test würde dies aber absichern.

**ID:** 3  
**Schwere:** niedrig  
**Datei:** `src-tauri/src/store/development_budget.rs` (Zeile ~177)  
**Begründung:** Der Idempotenz-Check (Rückgabe der existierenden Zeile bei gleichem `key`) greift, bevor der `run`- und `purpose`-Mismatch-Check ausgeführt wird. Sendet ein Caller fälschlicherweise denselben `key` mit einem *anderen* `purpose` oder `run`, erhält er stillschweigend die alte, abweichende Reservierung. Da Ledger-Writer nur von vertrauenswürdigen Diensten aufgerufen werden (Nahtstelle store/), ist dies akzeptables Idempotenz-Verhalten und kein Sicherheitsrisiko, da der Caller die Reservierung ohnehin selbst initiiert hat.

### Beantwortung der Leitfragen

1. **Ist das Rollen→Zweck-Mapping sinnvoll und fail-closed?**  
   Ja. Das Mapping über `match role` in `for_dispatch_role` ist in Rust exhaustiv. Sollte in Zukunft eine fünfte `DispatchRole` hinzugefügt werden, scheitert die Kompilierung – das ist fail-closed. Die Zuordnung (Coordinator→Planning, Implementer→Implementation, Reviewer→Review, Integrator→Verification) ist plausibel. Integrator zieht aus der geschützten Reserve, was den Integrationstest in die Verifikations-Phase bringt.

2. **Ist der Check rassefest?**  
   Ja, unter der Prämisse des Kontexts, dass der serialisierende Schreib-Lock auf der Goal-Zeile in derselben Transaktion vor den `EXISTS`- bzw. `run_role`-Abfragen aktiviert wird. 

3. **Bleibt die Eindeutigkeit in `consume_worker` und `for_run` gewahrt? Kann ein Worker fremdes Budget verbrauchen?**  
   Ja, die Eindeutigkeit bleibt gewahrt. Ein Worker kann kein fremdes Budget verbrauchen, da beide Queries strikt nach `run_id=?` filtern. Das Entfernen von `purpose='implementation'` ist notwendig und korrekt, da Runs nun auch andere Zwecke binden können. Durch die strenge 1:1-Reservierungs-Logik greifen die Queries verlässlich auf die einzige aktive (nicht-stornierte) Reservierung des Runs zu.

4. **Ist die Reihenfolge bei der Idempotenz korrekt?**  
   Ja. Der Lookup nach dem `key` erfolgt ganz am Anfang der Funktion. Bei einem Replay wird die alte Zeile zurückgegeben, bevor der Ein-Reservierung-pro-Run-Check (`if taken`) zuschlagen kann. Das verhindert fälschliche Fehler bei legitimen Retries.

5. **Fehlt ein kritischer Testfall?**  
   Der Fall der Stornierung und Neu-Reservierung für denselben Run (Befund 2) fehlt. Die Zweck-Mismatch-Tests sind hingegen sehr gut abgedeckt (`run_budget_purpose_must_match_the_dispatch_role` testet Reviewer gegen alle anderen Zwecke und Implementer gegen Review).

### Urteil
**Freigeben.**

Die Implementierung ist sauber, die Sicherheitsgrenzen (fail-closed Match, 1:1-Reservierung) sind korrekt umgesetzt und die Abfragen in `consume_worker` und `for_run` sind robust gegen stornierte Alt-Zeilen. Die fehlenden Tests für den Stornierungs-Fall sind ein "Nice-to-have", aber kein Blocker für die Freigabe, da die Logik im Code korrekt abgebildet ist.
