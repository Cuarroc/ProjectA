# Spec-First-Review: F-CORE-3 „Zustellung an Agenten vereinheitlichen"

## Kontext

Du befindest dich im Repo von **ProjectA** (Tauri 2: Rust-Kern `src-tauri/src/`,
React-Frontend `src/`). Gestern wurde per Dreizeiler in `docs/decisions.md`
(08.09.) beschlossen: **Nahtstellen-/Trust-Specs bekommen vor der
Implementierung ein Multi-Anbieter-Spec-Review.** Du bist einer von drei
unabhängigen Reviewern in genau diesem Verfahren — der erste Anwendungsfall.
Du hattest keinen Anteil an der Spec (M2-Unabhängigkeit).

Review-Objekt: **`.pa/task_f_core3_delivery.md`** — ein Spec-ENTWURF
(`Status: entwurf`, noch nicht ausführbar). Er spezifiziert F-CORE-3, die
Vereinheitlichung der Zustellung an Agenten (Submit-Guard vs. blinder
Write-Pfad), als offenen Rest des NT-17-Pakets.

Deine Aufgabe ist nicht, die Spec zu loben. Deine Aufgabe ist, Gründe zu
finden, sie NICHT so auszuführen — mit Belegen aus diesem Repo. Ein Spec-
Review vor der Implementierung ist der billigste Moment dafür.

## Pflichtlektüre — lies die Dateien wirklich, zitiere mit Datei:Zeile

1. `.pa/task_f_core3_delivery.md` — das Review-Objekt
2. `docs/audits/2026-09-03-analyse-claude-web/befunde/kern-nebenlaeufigkeit.md`
   Zeilen 58–81 — der Ausgangs-Befund F-CORE-3 (drei Löcher, rote Testskizzen,
   Fix-Hinweise)
3. `docs/SANIERUNGSPLAN.md` §1 Lücke 1 (ca. Zeilen 99–111) — die Zuordnung
   „kein Paket"
4. `docs/decisions.md` — der 03.09.-Eintrag zum NT-17-Nachlauf (Zustell-Queue,
   `pa worker done|blocked`, Zurücknahmebedingung Z-1) und der 08.09.-Eintrag
   (Spec-First-Review)
5. `src-tauri/src/submit_guard.rs` — der Ist-Zustand des Guards
   (`echo_seen`, `Delivered`, `gave_up_waiting`, Zustandsautomat)
6. `src-tauri/src/pty.rs` — `GUARD_TAIL_BYTES` und der Observation-Bau
7. `STAND.md` §3 — aktive Specs/Lanes (die Spec muss sich dazu verhalten)

Ein Review ohne geöffnete Quellen gilt als nicht erbracht.

## Mindestens zu prüfen (nicht erschöpfend)

1. **Deckt die Spec den Befund vollständig?** Alle drei Löcher aus F-CORE-3
   müssen je einen roten Test und eine Fix-Richtung haben. Fehlt eines?
2. **Sind die roten Tests wirklich rot-fähig?** Prüfe gegen den Ist-Zustand in
   `submit_guard.rs`: würde `an_echo_that_was_already_in_the_tail…` gegen den
   heutigen Code fehlschlagen? Ist die Assertion scharf genug, um nicht
   vakuum-grün zu werden?
3. **Fix-Richtung realistisch?** Write-Baseline/Byte-Offset im Ring:
   verträgt sich das mit dem Ringpuffer in `pty.rs` (Wrap-around, partielle
   UTF-8, `tail_lossy`)? „Zustellung über Inhalt beweisen" (Antwort-Marker
   „⏺", OpenCode-Block, UserPromptSubmit-Hook): sind das belastbare Signale
   für alle drei Anbieter, oder klafft hier eine neue Prompt-Spiegel-Falle
   (AGENTS.md: „Ein Agent, der einen Prompt zurückspiegelt, taugt nicht als
   Prüfobjekt")?
4. **Marker-Fallback → Escalate**: was passiert mit Tasks, wenn der Marker
   nie kommt (heute: 30-s-Fallback schreibt blind)? Ist die Eskalation in der
   Spec ausreichend spezifiziert (wer wird benachrichtigt, was ist der
   nächste sichere Schritt)?
5. **Z-1-Kopplung**: die Queue-Größe hängt an Z-1. Ist das in der Spec so
   formuliert, dass eine ausführende Instanz nicht doch die volle Queue baut?
6. **Dateigrenzen/Lane**: `submit_guard.rs`+`pty.rs` sofort, `pa.rs`+
   `workers.rs` erst nach dem F4-Commit. Ist das mit `STAND.md` §3
   verträglich? Fehlt eine Abhängigkeit (z. B. Attention-Einträge bei
   Escalate — welche Spec besitzt die)?

## Regeln

- Jeder Befund: Behauptung (Zitat aus der Spec), Beleg (Datei:Zeile),
  Schaden, konkreter Vorschlag.
- Keine Befunde ohne Beleg. Maximal 12, nach Schwere sortiert.
- Tragfähiges knapp unter „Was trägt" — sonst nichts.
- Antworte auf Deutsch. Nur lesen, nichts verändern.

## Ausgabeformat (exakt einhalten)

URTEIL: <ausführbar | überarbeiten | ablehnen>
BEGRÜNDUNG: <3–6 Sätze>

BEFUNDE (nach Schwere sortiert, maximal 12):

### S-NN — <Titel>
- Schwere: <hoch|mittel|niedrig>
- Behauptung: <Zitat>
- Beleg: <Datei:Zeile>
- Vorschlag: <konkret>

## Was trägt
<max. 5 Aufzählungspunkte>
