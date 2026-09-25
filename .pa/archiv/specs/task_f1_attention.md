# F1-Attention: ein Fehlerkanal, eine Zustandsmaschine

Status: historisch

Repo: `<repo-root>`. **Nicht committen, nicht pushen, nicht
mergen.** Ein Mensch fährt die Gates und committet.

Plan: `docs/SANIERUNGSPLAN.md` Rev 9, F1 (erste zwei Punkte) und §5 „Attention".
Verträge und Belege: `.pa/report_f0.md` §2 und §3.

## Warum

Fehler, Quota-Blocks und Zustellprobleme erreichen den Menschen heute nicht
zuverlässig. Der Reflex wäre, im Dialog eine zweite Fehleranzeige zu bauen — genau
das verbietet der Plan: **P2-D schreibt Fehler des aktiven Agenten als kanonische
Attention-Einträge, nicht in eine zweite UI-Logik.** F3 konsumiert später dieselben
Reason-Codes; eine zweite Zustandsmaschine hier macht F3 unmöglich.

## Vorarbeit im Arbeitsbaum — zuerst lesen

Vorarbeit genau zu diesem Paket liegt als Commit `27c6799` vor (nicht im Diff —
der Baum war beim Start sauber): `useBoard.ts` (`attentionByWorker`-Projektion,
Koordinatoren-Events), `App.tsx` (`activeOrchestratorAttention`),
`ConversationView.tsx` (Banner), plus `openExternalSafely.ts` samt Test. Sie ist
grün, aber unfertig.

**Lies sie zuerst und übernimm oder verwirf sie begründet.** Baue nicht daneben.
Insbesondere: das Banner in `ConversationView` ist heute reiner Frontend-Zustand
mit lokalem Dismiss — das ist die zweite UI-Logik, die dieses Paket abschaffen
soll. Der Attention-Eintrag ist die Wahrheit, das Banner nur seine Anzeige.

**Ein Widerspruch in dieser Spec, den du auflösen musst.** Die Abnahme unten
verlangt „Dismiss ändert keinen Zustand"; die Vorarbeit hat `dismissedAttention`
in `ConversationView.tsx`, und ihr Test in `ConversationView.test.tsx`
**fordert** das lokale Ausblenden. Beides zusammen geht nicht. Entscheide
explizit und begründe im Report: entweder Dismiss streichen und den Test
umdrehen, oder ein Acknowledged-Flag am Eintrag — dann ist es Zustand und gehört
nach F3, also hier raus. Stillschweigend beides behalten ist die Antwort, die
dieses Paket sinnlos macht.

## Deine Dateien (EXKLUSIV)

- `src-tauri/src/status.rs` — Reason-Codes und Attention-Projektion
- `src-tauri/src/gh.rs` — nur die Reason-Strings (`gh.rs:90-108`)
- `src/lib/useBoard.ts`
- `src/components/ConversationView.tsx` (+ Test)
- `src/lib/openExternalSafely.ts` (+ Test)
- `src/components/BoardView.tsx`, `RecommendationsPanel.tsx`,
  `WebInterfacePanel.tsx` — nur die `openExternal`-Aufrufstellen
- `src/App.tsx` — **nur** die Verdrahtung der Attention-Projektion, kein Umbau
- `src/lib/settings.ts` und `src/lib/settings.legacy.test.ts` — nur für die
  Masterprompt-Marker-Sperre (Punkt 4)

**Nicht anfassen:** `main.rs`, `api.rs`, `store.rs`, `bin/pa.rs` (serielle
Nahtstellen-Lane, gehören F1-Diagnostics/F1-SingleInstance), `logging.rs`,
`redact.rs`, `workers.rs`, `testgate.rs`, `preflight.rs` (nur lesen — du borgst
dir sein Vokabular, du änderst es nicht), sowie `digest.rs`, `web_interface.rs`
und `stats.rs`. Die letzten drei lesen `attention_reason`; wenn du den String
wie vorgeschrieben stehen lässt, brauchst du sie nicht. Brauchst du sie doch, ist
dein Zuschnitt falsch — melde es.

## Auftrag

1. **Reason-Codes vereinheitlichen.** Panic-, Status- und Guard-Gründe sind heute
   freier Text und teils englisch. Die Produktionsstrings stehen in
   `status.rs:339-354, 687, 1148-1151, 1206-1214` und `gh.rs:90-108` — `gh.rs`
   ist dir hiermit freigegeben, es gehört keinem anderen Paket.
   Führe eine geschlossene Menge von Reason-Codes ein, aus der sich der sichtbare
   Text ableitet — nicht umgekehrt. F3 sortiert später nach Blockadegrad; ein
   Code ohne Blockadegrad ist unbrauchbar.

   **Der String `attention_reason` bleibt; der Code kommt daneben.** Er wird
   außerhalb deiner Grenze gelesen — `digest.rs:189/295/462`,
   `web_interface.rs:88/235/654/730/745`, `stats.rs:200`. Diese Dateien gehören
   keinem Paket; wer den String *ersetzt* statt ihn zu *ergänzen*, zieht vier
   fremde Dateien mit und bricht den Schnitt. Auf die Wire kommen
   `attentionCode` und `attentionGrade` **neben** `attentionReason`.

   **Nimm das Vokabular aus `preflight.rs:55-63`, erfinde keins.** Dort steht
   bereits `Blocker { code, message, repair, transient }` mit `quota_blocked`,
   `budget_reached`, `profile_disabled`, `unknown_profile` — genau „Code,
   Ursache, nächster Schritt, Grad" (`report_f0.md` §2.4 nennt es das
   Strukturvorbild). Ein eigenes Vokabular in `status.rs` wäre die **dritte**
   Zustandsmaschine: Quota käme einmal als `quota_blocked` und einmal unter
   anderem Namen vor, und F3 könnte beide nicht gleich sortieren.

   **Zuschnitt, der F3 und F4 überlebt:** Codes **nach Ursache**, nicht nach
   Spalte und nicht nach Slot; jeder mit festem `grade()` (Blocking / Attention /
   Info). Slots speichern `Signal { code, detail }` statt `Verdict`. Neben
   `derive()` ein `signals() -> Vec<Signal>`, das **unabhängig von
   `override_column` und `archived`** ist — Attention ist das Signal mit dem
   höchsten Grad, nicht das spaltengewinnende. F4 nimmt später
   `signals.filter(Blocking)` als `blockers[]`, ohne dass etwas weggeworfen wird.
   Codes mit Spalte oder Quelle im Namen (`NeedsYouHook`, `GhApproved`) sind
   genau der Zuschnitt, den F4 wieder wegwerfen müsste.

   **Ausnahme zur Regel „Text aus Code":** Fragewortlaut (`status.rs:1162`),
   Notification-/PermissionRequest-Text (`status.rs:1206-1214`) und die
   Stuck-Minuten sind agentengeschrieben und nicht ableitbar. Sie gehören in ein
   optionales `detail` am Signal. Ohne diese Ausnahme verschwindet der Fragetext
   von der Karte.
2. **Fehler des aktiven Agenten werden Attention-Einträge.** Quota-Block,
   Zustellfehler und Prozessabbruch erzeugen einen Eintrag mit Code, Ursache und
   nächstem Schritt. Der Dialog **rendert** ihn, er erfindet ihn nicht.
3. **`openExternal`-Ablehnungen sichtbar behandeln.** Eine abgelehnte URL darf
   nicht folgenlos verpuffen. Das ist die Vorarbeit `openExternalSafely.ts` —
   prüfe sie und ziehe sie über alle vier Aufrufstellen durch.
4. **Masterprompt-Marker sperren (C-6).** `FORBIDDEN_MARKERS`
   (`learnings.rs:112`) verbietet `--- TASK ---` und `--- PROJEKT-PLAYBOOK ---`
   auf dem Approve-Pfad. Der Masterprompt aus `localStorage` umgeht diese Grenze
   (`settings.ts:84-88` → `workers.task`) und kann die Playbook-Grenze im fertigen
   Prompt fälschen. Sperre denselben Marker-Satz auf diesem Pfad.
   Der belegende Test existiert bereits und behauptet heute die Lücke:
   `src/lib/settings.legacy.test.ts`, Fall „reicht die Playbook-Marker … durch".
   **Dreh ihn um, statt ihn zu löschen.**
5. **Sichtbare DE/EN-Mischung beseitigen** in allem, was du anfasst. Code und
   interne Doku dürfen deutsch bleiben.

## Abnahme

- Fehler-, Quota- und Guard-Szenario erzeugen **je einen** verständlichen
  Attention-Eintrag mit Code und nächstem Schritt.
- Es gibt genau eine Zustandsmaschine: der Dialog hat keine eigene Fehlerwahrheit
  mehr, und ein Dismiss ändert keinen Zustand (F3-Vorgriff: Dismiss löscht nie
  einen Blocker).
- Eine abgelehnte `openExternal`-URL erzeugt eine sichtbare Meldung an allen vier
  Aufrufstellen.
- Ein Masterprompt mit `--- TASK ---` erreicht `workers.task` nicht mehr
  unverändert; `settings.legacy.test.ts` belegt die neue Grenze.
- Rote Regressionstests zuerst, dann grün.

## Gates

```text
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt --check
npm run typecheck
npm test
npm run build
npm run lint
```

Exit-Codes ungemaskiert lesen.

## Report

`.pa/report_f1_attention.md`: die Reason-Code-Menge mit Blockadegrad, die
Entscheidung über die Vorarbeit (übernommen/verworfen, mit Begründung), und die
drei Szenarien mit Beleg.
