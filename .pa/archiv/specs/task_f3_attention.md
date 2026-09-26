# F3-Attention: eine Inbox, keine zweite Zustandsmaschine

Status: historisch

Repo: `<repo-root>`. **Nicht committen, nicht pushen, nicht
mergen.**

Plan: `docs/SANIERUNGSPLAN.md` Rev 9, F3 und §5 „Attention".
F1-Reason-Codes: `.pa/report_f1_attention.md`. F2-IA: `docs/ia/index.html`
(statisch; **kein** `App.tsx`-Gut).

## Nahtstellen-Lane

Dateidisjunkt zu F4-Rust (`readiness.rs`, `store.rs` Merge-Evidence).
**Nicht anfassen:** `main.rs`, `store.rs`, `bin/pa.rs`, `readiness.rs`.

`status.rs`: nur `attention_code` / `attention_grade` auf `WorkerBoardState`
legen — dieselben Felder wie `StatusPayload`, aus `WorkerState::attention()`.
Keine neuen Reason-Codes. `api.rs`: nur der Test-Helper `board_state`, der
sonst nicht kompiliert.

## Warum

Fragen, Fehler, Empfehlungen und Merge-Blocker gehören in **eine** Inbox.
F1 liefert Codes und Grade. Eine zweite Maschine macht F1 wertlos.

## Auftrag

1. Attention-Inbox konsumiert `attentionCode` / `attentionGrade` / F4-Blocker
   als Einträge derselben Liste — nicht als parallele Banner-Logik.
2. Sortierung: Blockadegrad, dann Alter. Coalescing gleichartiger Ereignisse
   pro Task.
3. Desktop-Notification mit Coalescing, Ruhezeiten, redigierter Nutzlast.
   Taskleisten-Badge nur Fallback; Paket-Build ist der Beleg.
4. Dismiss ohne Zustandsänderung löscht keinen Blocker.
5. Klick öffnet dieselbe Task in Work/Agents/Review (Deep Link laut F2-IA).

## Abnahme

Fünf gleichartige Worker-Ereignisse → eine verständliche Meldung; Klick führt
zur Task; Dismiss ohne Zustandsänderung lässt den Blocker stehen.

## Report

`.pa/report_f3_attention.md`.
