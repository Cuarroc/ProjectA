# Disposition — Review PR #13 (W2-10a), Stufe B

Reviewer: grok (xAI), ein Reviewer, nicht die Autorenfamilie (Autor: Kimi).
Protokoll: `.pa/review_pr13_grok.md` (unveränderte Antwort).
Kandidat: Merge-Kopf `b4222f4` (Branch `claude/w2-10a` + origin/main).
Befunde gegen den Code in `docs/dev-hq/continuous.js` zeilenweise geprüft.

## F1 (high): Fokussierte Buttons verlieren bei jedem Tick den Fokus — ANGENOMMEN

Verifiziert: `refresh()` ruft `enable(false)` vor dem Netzwerk-Await auf
(deaktiviert alle Card-Buttons); `captureListState()` lief erst nach dem
Await — im echten Browser ist `document.activeElement` dann `body`
(jsdom blur’t bei `disabled` nicht, darum sah der Unit-Test es nicht).
Bei unveränderter Signatur wird nichts wiederhergestellt. Kernanforderung
des Pakets (Submit-Focus überlebt den Tick) war im Browser gebrochen.

Umsetzung: Fokus wird jetzt VOR `enable(false)` erfasst (`captureFocus`)
und nach `enable(true)` wiederhergestellt (`restoreFocus`), in `refresh()`
und in `mutate()`; Auflösung per Task-ID/Part nach einem Rebuild, per
Knotenreferenz für die Card-Buttons außerhalb der Liste. Restore nur, wenn
der Tick den Fokus genommen hat (activeElement === body) — ein bewusst
umgesetzter Fokus bleibt unangetastet.

Beleg: Browser-Test `an unchanged refresh tick keeps focus on the submit
button` (echtes Chromium) — rot gegen den alten Stand (`null !== 'task-2'`,
Exit 1), grün nach dem Fix (Exit 0, 13/13); Fokus-Screenshot
`goals-teams-focus-tick.png` erzeugt und angesehen (Fokus-Ring auf
„Zuweisung aktualisieren" nach einem unveränderten Tick).

## F2 (medium): Phantom-Entwürfe / gelöschter Agent geht verloren — ANGENOMMEN

Verifiziert: die Formulare wurden per `.value` befüllt; `defaultValue`/
`defaultSelected` blieben auf den Markup-Startwerten. Folgen wie beschrieben:
unberührte Felder wurden immer als Entwurf erfasst und über neuere
Serverdaten gemalt; ein geleertes `assignee` (`"" === defaultValue`) ging
verloren.

Umsetzung: Defaults werden beim Bau auf die Serverwerte synchronisiert
(`defaultSelected` für Team- und Rollen-Optionen nach dem initialen
Befüllen, `assignee.defaultValue` beim Vorbefüllen). Der `change`-Pfad
synchronisiert absichtlich nicht — eine Operator-Änderung ist ein Entwurf.

Beleg: Unit-Tests `rebuild after a server-side seat change shows the new
seat, not a phantom draft` und `a deliberately cleared assignee survives a
rebuild as a draft` — rot gegen den alten Stand (Exit 1), grün nach dem
Fix (Exit 0, 7/7).

## F3 (medium): Wiederhergestelltes Team behält die alte Rollenliste — ANGENOMMEN

Verifiziert: `fillRoles` lief nur auf `change`; das Wiederherstellen setzte
`.value` ohne Event — Rollenliste und Team-Entwurf liefen auseinander,
Submit hätte neue Team-ID mit alter Rolle gesendet.

Umsetzung: `restoreListState` dispatcht nach dem Setzen eines
`teamId`-Entwurfs ein `change`-Event, bevor der Rollen-Entwurf angewendet
wird (Einfügereihenfolge des Entwurfs garantiert die Reihenfolge).

Beleg: Unit-Test `a drafted team switch keeps the matching role list across
a rebuild` — rot gegen den alten Stand (Rollenliste blieb
`['implementer','reviewer']` statt `['planner']`, Exit 1), grün nach dem
Fix (Exit 0, 7/7).

## Umsetzungs-Commits

- `191d61c` — rote Belege für F1–F3 (Regression-For: `ea6ecf9`)
- `9899641` — Fix für F1–F3, beide Suites grün

Delta-Review des Fixes durch grok: **blockiert** — der Lauf brach mit
`402 Payment Required: Grok Build usage balance exhausted` ab (stderr,
2026-09-25); `.pa/review_pr13_grok-delta.md` enthält nur den unveränderten
Anfangs-Satz, kein Urteil. Kein Ersatz-Reviewer zulässig (Auftrag: nur
grok; Ollama/OpenCode gesperrt; kein Geld ausgeben). Der Fix ist klein
(45+/21− in `docs/dev-hq/continuous.js` plus Tests) und durch rote→grüne
Tests in jsdom und echtem Chromium belegt; das Delta-Review ist als
offener Punkt an den Koordinator zu geben, sobald das grok-Kontingent
wieder steht.
