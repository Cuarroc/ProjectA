# Delta-Review W2-02 (Kandidat 2fd259c)

Du bist unabhaengiger Reviewer. Runde 1 (Kandidat 96dc42c) ergab: glm-5.2 freigeben ohne Befunde; kimi-k3 freigeben mit Auflagen (Befunde unten). Dispositionen des Autors:
- Befund 1 (Gleichstand in derselben Sekunde): abgelehnt als Codeaenderung. Zeitstempel sind Sekunden; innerhalb einer Sekunde ist die Reihenfolge unbestimmbar, <= wuerde schnelle Amends im Worker-Pfad (now_unix_secs) ablehnen. Verhalten jetzt per Test gepinnt und im Kommentar begruendet; Auflage fuer den Integrationspfad im Report.
- Befund 2 (Replay erneuert observed_at nicht): abgelehnt; Replay behaelt bewusst die Provenienz der ersten Beobachtung (bestehender Test candidate_replay_returns_persisted_provenance). Jetzt im Kommentar festgehalten.
- Befund 3 (Testfaelle a-d): angenommen, alle vier im Test.
- Befund 4 (Aufrufervertrag Integrationspfad): angenommen, Doc-Kommentar.

Pruefe nur den Delta-Diff: sind die Dispositionen korrekt umgesetzt, entsteht ein neues Problem? Antworte auf Deutsch: Urteil (freigeben / freigeben mit Auflagen / ablehnen), dann nummerierte Befunde mit Schwere, Datei:Zeile, Begruendung, Vorschlag.

## Runde-1-Review kimi-k3

# Review: w2-02 — kimi-k3

- Autor des Artefakts: Claude Code
- Reviewer: kimi-k3 (ollama @ http://127.0.0.1:11434/api/generate), angefragtes Modell `kimi-k3:cloud`, bedient `kimi-k3`
- Datum: 2026-09-24 12:11 UTC, Dauer 206 s, Status: ok
- Unabhaengigkeit: Reviewer hatte keinen Anteil am Artefakt (M2)
- Prompt: `review_prompt_w2-02.md` (29116 Zeichen)

## Roh-Urteil des Reviewers

# Review-Urteil W2-02

**freigeben mit Auflagen**

Die Änderung ist klein, zielt exakt auf die beiden benannten Lücken, sitzt am richtigen Choke-Point (`bind_candidate` für beide Einstiegspunkte), bricht keine Idempotenz- oder Sticky-Semantik und ist durch den Rot/Grün-Nachweis plausibel abgesichert. Kein Befund mit Schwere hoch. Auflagen betreffen Tests, Dokumentation des Aufrufervertrags und eine bewusst gewählte Restlücke, die vor Liveschaltung des Integrationspfads adressiert werden muss.

## Befunde

**1. mittel — `src-tauri/src/store/development_runs.rs:993` (Match-Arm `Some((_, bound_at)) if observed_at < bound_at`) — Gleichstand lässt Rücksprung auf ersetzten Kandidaten zu**

Begründung: Der Monotonie-Schutz greift nur bei *strikt* kleinerem `observed_at`. Bei Sekunden-Granularität (`now_unix_secs()`) kann eine verzögert zugestellte, inhaltlich veraltete Beobachtung eines anderen Commits mit identischem Sekundenwert die Bindung auf einen bereits ersetzten Kandidaten zurückdrehen (Update-Arm). Danach akzeptiert `require_bound_candidate` neue Evidence und Reviews exakt für diesen überholten Commit — Lücke (2) aus der Ausgangslage bleibt im 1-Sekunden-Fenster bestehen, I3 ist in diesem Fenster umkehrbar verletzt. Entschärft ist das heute dadurch, dass der einzige Produktionsschreiber der sequentielle Worker-Pfad ist, der vorher Git prüft (Replays nennen denselben Commit und landen im idempotenten Arm). Das wird real, sobald der Integrationspfad als zweiter, Git nicht prüfender Schreiber live geht.

Vorschlag: Nicht zwingend in diesem PR lösen, aber als Auflage vermerken (PLAN.md/Ticket des Integrationspfads): vor dessen Aktivierung entweder (a) `observed_at` auf ms-Auflösung umstellen, oder (b) Gleichstand ablehnen (`<=`) und den Worker bei schnellem Amend mit frischer Zeit wiederholen lassen. Unabhängig davon jetzt: Regressionstest, der das gewählte Gleichstandsverhalten festzurrt (siehe Befund 3), damit die Entscheidung nicht versehentlich kippt.

**2. niedrig — `development_runs.rs:991` (`Some((bound, _)) if bound == candidate_commit => Ok(0)`) — Replay erneuert `observed_at` nicht**

Begründung: Sequenz: Bind A@6, Replay A@8 (bestätigt A faktisch zum Zeitpunkt 8), danach B@7 → erlaubt (7 ≥ 6), obwohl die letzte bekannte Beobachtung neuer ist. Das Rücksprung-Fenster reicht bis zur *ersten* statt zur *letzten* Beobachtung des gebundenen Commits. "Provenienz unverändert" ist für `source`/Commit richtig, aber `observed_at` ist keine Provenienz im engeren Sinn. Ein `observed_at = MAX(observed_at, ?)` bei gleichem Commit ließe die Idempotenz für echte Replays (gleiche Parameter → keine Änderung) intakt und würde das Fenster schließen. Szenario ist heute unwahrscheinlich (Replay mit neuerem Zeitstempel kommt im Worker-Pfad praktisch nicht vor), daher nur niedrig.

Vorschlag: Entweder MAX-Härtung einbauen, oder explizit als bewusste Eigenschaft im `bind_candidate`-Kommentar festhalten, damit niemand später fälschlich annimmt, die Monotonie-Basis sei "last seen".

**3. niedrig — `development_runs.rs:2175` (Test `dispositions_bind_to_the_exact_current_candidate`) und `:1022` (`require_full_commit_id`) — fehlende Testfälle**

Begründung: Vier Verhalten sind spezifiziert oder sicherheitsrelevant, aber nicht abgesichert:
- (a) 64-stellige SHA-256-IDs werden nie positiv getestet; ein Tippfehler in `matches!(commit.len(), 40 | 64)` bliebe unsichtbar.
- (b) Replay desselben Commits mit *älterem* `observed_at` muss `Ok(0)` bleiben — das sichert die Arm-Reihenfolge (Idempotenz vor Stale-Check). Vertauscht sie jemand später, schlägt kein vorhandener Test fehl, obwohl das Design das Verhalten explizit verspricht.
- (c) Gleichstands-Rebind (`observed_at == bound_at`, anderer Commit) ist bewusst erlaubt, aber nicht gepinnt (vgl. Befund 1).
- (d) Nach dem Rückkehr-Rebind (A@10) wird nur geprüft, dass *alte* Reviews/Evidence invalidiert bleiben; dass *neue* Evidence auf COMMIT_A wieder möglich ist, fehlt — der Rückkehr-Pfad ist also nicht Ende-zu-Ende belegt.

Vorschlag: Die vier Fälle als kleine Ergänzungen in den neuen Test bzw. `bind_candidate`-nahe Unit-Tests aufnehmen.

**4. niedrig — `development_runs.rs` (`invalidate_development_run_evidence_for_candidate`, nicht im Diff-Hunk) — Aufrufervertrag des zweiten Einstiegspunkts nicht dokumentiert**

Begründung: Der neue harte Fehler "stale candidate observation" ist für den künftigen Integrationspfad eine Falle: Ein Integrator, der nach Neustart ältere Events nachholt oder Nachrichten wiederholt, bekommt jetzt Fehler, die er als *benignes Skip* werten muss — behandelt er sie als fatal, blockiert die Nachverarbeitung dauerhaft. Zusätzlich ist nirgends festgelegt, dass `observed_at` die *eigene Beobachtungs-Wanduhr* des Aufrufers sein muss (wie der Worker `now_unix_secs()`). Nutzt der Integrator stattdessen Event-/Commit-Zeiten, werden echte Änderungen als stale abgelehnt und die Bindung "klemmt" fail-closed, bis jemand mit neuerem Zeitstempel bindet. Die Doc-Erweiterung an `bind_development_run_candidate` (`:612`) geht nur halb so weit.

Vorschlag: Doc-Kommentar am zweiten Einstiegspunkt um zwei Sätze ergänzen: volle Commit-ID + Monotonie gelten auch hier; "stale" bedeutet "Befund bereits überholt" und ist als Skip zu werten; `observed_at` ist der Zeitpunkt der eigenen Beobachtung, nicht die Zeit der Ursprungs-Nachricht.

## Als korrekt geprüft (keine Befunde)

- Arm-Reihenfolge in `bind_candidate`: Idempotenz vor Stale-Check entspricht dem Design; Sticky-Invalidierung bei Rückkehr (A→B→A) bleibt erhalten und ist belegt (`invalidatedByCommit == COMMIT_B`, Review auf alter Evidence scheitert).
- `require_full_commit_id`: `len()`-Byte-Prüfung ist durch die anschließende ASCII-Prüfung äquivalent zur Zeichenzahl; Ablehnung von Großschreibung statt Normalisierung ist richtig (kein zweites Schreibweisen-Universum neben dem Worker-Pfad); Validierung läuft vor jedem DB-Zugriff, auch im Insert-Arm — Lücke (1) für beide Einstiegspunkte geschlossen.
- Keine Schema-/Migrationsprobleme; SELECT des zusätzlichen `observed_at` nutzt den vorhandenen PK-Pfad; Legacy-Zeilen (nur Testdaten) werden wie beschrieben beim nächsten Rebind ersetzt (Achtung nur: Rebind mit kleinerem Zeitstempel scheitert jetzt — fail-closed, akzeptabel).
- Fehlerpfad erzeugt keinen Transaktions-Müll (Validierung/Lektuere vor Schreiben); Queries bleiben parametrisiert; der stale-Fehlertext ist maschinell unterscheidbar (`contains("stale")`) und leakt keine sensiblen Daten.
- Test-Hilfskonstrukte (`pub(super) const COMMIT_A/B`, `&COMMIT_A.to_uppercase()` im Array) sind kompilier- und lebenszeitkorrekt; Red/Grün-Nachweis (`f632f11`/`96dc42c`) ist mit dem Diff konsistent.

Die vier Auflagen sind klein und blockieren den Merge nicht — mit Ausnahme der Dokumentation von Befund 1 als offene Bedingung für das spätere Integrator-Ticket.


## Delta-Diff

```diff
diff --git a/src-tauri/src/store/development_runs.rs b/src-tauri/src/store/development_runs.rs
index 2fe5be5..c0e96a8 100644
--- a/src-tauri/src/store/development_runs.rs
+++ b/src-tauri/src/store/development_runs.rs
@@ -777,6 +777,11 @@ impl Store {
     /// Invalidate all candidate-bound evidence and review dispositions that
     /// belong to an older candidate. The caller supplies the newly observed
     /// candidate commit; this method does not claim to observe Git itself.
+    /// The same rules as for binding apply: a full commit ID, and `observed_at`
+    /// is the caller's own observation time (not the time of an upstream
+    /// event). A "stale candidate observation" error means a newer candidate
+    /// is already bound; a caller catching up on old events treats it as
+    /// superseded, not as a failure to retry.
     pub async fn invalidate_development_run_evidence_for_candidate(
         &self,
         run_id: &str,
@@ -990,9 +995,13 @@ async fn bind_candidate(
                 .bind(run_id).bind(candidate_commit).bind(source).bind(observed_at).execute(&mut **tx).await.map_err(db("write candidate binding"))?;
             Ok(0)
         }
+        // A replay keeps the first observation's provenance, including its
+        // time; the staleness bound below is that first observation.
         Some((bound, _)) if bound == candidate_commit => Ok(0),
         // An older observation of another commit must not move the binding
-        // back to a candidate that was already replaced.
+        // back to a candidate that was already replaced. Times are seconds:
+        // within the same second the order is unknown and the later writer
+        // wins, so a fast amend is not refused.
         Some((_, bound_at)) if observed_at < bound_at => Err(format!(
             "stale candidate observation: observedAt {observed_at} is older than the bound candidate ({bound_at})"
         )),
@@ -2259,12 +2268,41 @@ mod tests {
         let reviews = store.list_development_reviews(&run).await.unwrap();
         assert_eq!(reviews[0].status, INVALIDATED_REVIEW);
         assert_eq!(reviews[0].invalidated_by_commit.as_deref(), Some(COMMIT_B));
-        let evidence = store.list_development_evidence(&run).await.unwrap();
-        assert_eq!(evidence[0].invalidated_by_commit.as_deref(), Some(COMMIT_B));
+        let tests = store.list_development_evidence(&run).await.unwrap();
+        assert_eq!(tests[0].invalidated_by_commit.as_deref(), Some(COMMIT_B));
         assert!(store
             .record_development_review(&reviewer, "worker-r", 3, review_input("revived", &test.id))
             .await
             .unwrap_err()
             .contains("not valid"));
+        // New evidence for the returned candidate is accepted.
+        let mut fresh = evidence(COMMIT_A);
+        fresh.idempotency_key = "fresh".into();
+        fresh.observed_at = 10;
+        let fresh = store
+            .record_development_evidence(&run, "worker-a", 7, fresh)
+            .await
+            .unwrap();
+        assert_eq!(fresh.invalidated_at, None);
+        // A replay of the bound commit stays idempotent even when older.
+        let replay = store
+            .bind_development_run_candidate(&run, "worker-a", 7, COMMIT_A, "git", 5)
+            .await
+            .unwrap();
+        assert_eq!((replay.observed_at, replay.invalidated_records), (10, 0));
+        // Within the same second the later writer wins (a fast amend).
+        assert_eq!(
+            store
+                .bind_development_run_candidate(&run, "worker-a", 7, COMMIT_B, "git", 10)
+                .await
+                .unwrap()
+                .invalidated_records,
+            1
+        );
+        // SHA-256 repositories name commits with 64 digits.
+        store
+            .bind_development_run_candidate(&run, "worker-a", 7, &"c".repeat(64), "git", 11)
+            .await
+            .unwrap();
     }
 }
```
