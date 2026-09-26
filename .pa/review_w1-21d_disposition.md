# Disposition W1-21d (toggles for case sensitivity and regex in scrollback search)

- Kandidat: Stand vor dem Review (im internen Vorgänger-Repo), Review-Delta als
  Folge-Commit auf demselben Branch.
- Autor: kimi (w1-21d); Reviewer: claude sonnet (`claude -p --model sonnet
  --permission-mode plan`, nur lesend), Protokoll `.pa/review_w1-21d_sonnet.md`,
  Prompt: not ported.
- Urteil des Reviewers: **mergebar ja**, nichts Blocking; Empfehlung, F-1 vor
  dem Merge zu beheben und F-2 mit Tests abzudecken.

## F-1 — Alt+C / Alt+R prüfen `event.key`, nicht `event.code` (medium) — ANGENOMMEN

- Befund: auf macOS liefert Alt+C `ç` und Alt+R `®`, bei nicht-lateinischen
  Layouts trifft der Vergleich ebenfalls nie (`TerminalView.tsx`,
  `onKeyDown` des `role="search"`-Containers).
- Prüfung: trifft zu. Der Handler las `event.key.toLowerCase()`; Tauri 2 ist
  plattformübergreifend und das Tooltip „(Alt+C)" verspricht das Kürzel.
- Umsetzung (red-first): neuer Test „Alt C und Alt R wirken layoutunabhängig
  über event.code" mit `{ key: "ç", code: "KeyC", altKey: true }` — rot gegen
  den Kandidaten (1 failed | 33 skipped), grün nach dem Fix auf
  `event.code === "KeyC" / "KeyR"`. Bestandstest „Alt C und Alt R …" trägt
  jetzt ebenfalls `code`. Zusätzlich im echten Chromium belegt (Playwright,
  `__PROJECTA_E2E_RICH__`): `Alt+C` per Tastatur setzt `aria-pressed="true"`.

## F-2 — Regex-Fehlerpfade nur teilweise getestet (low) — ANGENOMMEN

- Befund: ungetestet waren Regex-aus bei ungültigem Muster (Fehler muss
  verschwinden), Enter/⌃/Pfeil-Buttons bei ungültigem Regex (kein Addon-Aufruf)
  sowie `clearDecorations` + geleerter Zähler.
- Prüfung: trifft zu; das Verhalten war implementiert, aber unbelegt — reine
  Testabdeckung, daher nicht red-first-fähig (wie bei einem früheren Review).
- Umsetzung: drei Tests ergänzt („Regex abschalten bei ungültigem Muster
  nimmt den Fehler und sucht literal", „Enter und Pfeil-Buttons suchen bei
  ungültigem Regex nicht", „ungültiger Regex leert Dekorationen und Zähler").
  Beim visuellen Beleg dieser Pfade fiel F-8 auf (siehe unten).

## F-3 — Regex-Suche läuft synchron bei jedem Tastendruck (low) — ABGELEHNT (Follow-up)

- Befund: katastrophales Muster (`(a+)+$`) kann die App beim Tippen
  einfrieren; selbstverschuldet, kein Sicherheitsproblem.
- Prüfung: plausibel; der Reviewer selbst sagt „nicht in diesem PR nötig,
  als Follow-up notieren". Die inkrementelle Suche lief schon vor diesem PR
  synchron pro Tastendruck; ein Debounce ändert das Tippgefühl der Suche und
  gehört in ein eigenes Paket mit Messung (vorher/nachher), nicht in eine
  Review-Nachbesserung.
- Grund der Ablehnung: Paketgrenze; hiermit als Follow-up notiert
  (Regex-Suche debouncen, Einfrier-Risiko mit `(a+)+$` gegen langen
  Scrollback messen).

## F-4 — Leere Treffer (`a*`, `^`, `\b`) unbelegt (low) — ABGELEHNT

- Befund: ob das Addon leere Treffer sauber behandelt, hänge von der
  installierten Version ab; die Vorprüfung decke das nicht.
- Prüfung: die installierte, per Lockfile gepinnte Version
  `@xterm/addon-search@0.15.0` wurde direkt gelesen
  (`node_modules/@xterm/addon-search/lib/addon-search.js`): vorwärts wird ein
  Treffer nur bei `i[0].length > 0` angenommen (leere Treffer explizit
  verworfen — kein Ergebnis, kein Wurf), rückwärts schreitet `lastIndex` bei
  leeren Treffern garantiert voran (`exec` mit `g` rückt bei leerem Match per
  Spec weiter, das Addon korrigiert zusätzlich) — kein Hängen möglich.
  `.*`, `^`, `\b` kompilieren und werfen weder vorwärts noch rückwärts;
  schlimmstenfalls entsteht rückwärts ein Null-Längen-„Treffer" (kosmetisch).
- Grund der Ablehnung: das befürchtete Verhalten (hängt/wirft) ist in der
  gepinnten Version ausgeschlossen; ein erweiterter Guard hätte nichts zu
  fangen. Der kosmetische Rest rechtfertigt keinen eigenen Fix.

## F-5 — Zustands-Hervorhebung nur per Farbe, Nicht-Text-Kontrast unbelegt (low) — ANGENOMMEN

- Befund: `aria-pressed="true"` ändert nur `background`/`color`; ob der
  Tint als Zustandsindikator 3:1 (WCAG 1.4.11) erreicht, zeigt „100/100"
  der Textpaarungen nicht.
- Prüfung: trifft zu. Mit der Repo-eigenen Rechenweise
  (`scripts/contrast-check.mjs`, Alpha komponiert über Grundfläche):
  `--color-accent-tint` (rgba(64,156,255,.13)) über `--color-elevated`
  #2a2a2d komponiert zu ≈ #2d3948 → **≈ 1,2:1** — weit unter 3:1. Das Paar
  `accent-tint`/`accent-text` war nur als *Text*-Paarung gegate't.
- Umsetzung: zusätzlicher inset-Ring `box-shadow: inset 0 0 0 1px
  var(--color-accent-text)` am gedrückten Schalter (kein Layout-Shift), plus
  neue Gate-Zeile in `scripts/contrast-check.mjs` (Nicht-Text ≥ 3:1):
  dunkel 5,05:1, hell 7,20:1 — Lauf: 102 Paarungen bestanden. Screenshot
  `3-schalter-ring-schmal.png` (inspiziert): Ring am gedrückten „Aa" klar
  sichtbar. Label-in-Name: bewusst belassen — „Aa"/„.*" sind Symbole, der
  `aria-label` benennt die Funktion (Reviewer: „bei Symbolen vertretbar").

## F-6 — Fehlerhinweis könnte die Leiste bei schmalen Panels sprengen (low) — ANGENOMMEN

- Befund: `.terminal-search-bar` ist `display:flex` ohne Umbruch; Input fix
  180px, dazu zwei Schalter und ein `nowrap`-Hinweis; Beleg nur bei 900px.
- Prüfung: trifft zu. Mindestinhalt der Leiste ≈ 450px; bei schmalerem
  Panel läuft sie über den Rand (bei einem 560px-*Fenster* kollabieren
  ohnehin die App-Rails über das Terminal — eigenes Layout-Thema, nicht
  diese Leiste).
- Umsetzung: `flex-wrap: wrap` an `.terminal-search-bar` (`gap` wirkt
  bereits für beide Achsen). Beleg mit auf 340px begrenzter Terminal-Ansicht
  (Element-Screenshots, inspiziert): `3-schalter-ring-schmal.png` — Leiste
  bricht auf zwei Zeilen innerhalb des Panels;
  `4-regex-fehler-schmal.png` — Fehlerhinweis auf der zweiten Zeile, beide
  Ringe sichtbar.

## F-7 — Widerspruch beim Rot-Beleg und Screenshot-Pfad (low, Doku) — ABGELEHNT

- Befund: Reviewauftrag nennt „4 neue Tests" und
  `docs/audits/2026-09-25-…`; der Report nennt 7 Tests und
  `docs/audits/assets/2026-09-25-…`.
- Prüfung: der PR ist in sich konsistent — der Report (the PR description (## Report))
  nennt durchgehend sieben einzeln rot gelaufene Tests mit Namen, und die
  Screenshots liegen exakt dort, wo der Report sie angibt
  (`docs/audits/assets/2026-09-25-w1-21d-suche/`, im Diff verifiziert).
  Beide Abweichungen standen nur im Review-Prompt dieser Sitzung
  (Paraphrasierungsfehler beim Verfassen), nicht im PR.
- Grund der Ablehnung: kein PR-Mangel; hiermit korrigiert protokolliert.

## F-8 — Verspätetes Suchergebnis stellt Zähler neben dem Fehler wieder her (neu, medium-low) — ANGENOMMEN

- Eigener Befund aus der Screenshot-Prüfung zu F-2/F-6 (kein Reviewer-Punkt):
  im echten Chromium stand nach dem Umschalten auf ungültigen Regex ein
  veraltetes „0/0" neben dem Fehlerhinweis (`onDidChangeResults` feuert
  asynchron; ein Ergebnis der noch gültigen Suche traf nach dem Leeren des
  Zählers ein).
- Umsetzung (red-first): Test „verspätetes Ergebnis bei ungültigem Regex
  stellt den Zähler nicht wieder her" rot gegen den Zwischenstand, grün nach
  Guard in `onDidChangeResults`: Berichte für geleerten oder nicht mehr
  kompilierenden Begriff werden verworfen. Geschwisterfall „geleerter
  Begriff" rendert konstruktionsbedingt `""` (`counterText` bei leerem
  `searchQuery`) und ist als Abdeckung mit Test belegt. Nachweis im Browser:
  Zähler-Timeline 20×50ms durchgehend leer; Screenshot
  `4-regex-fehler-schmal.png` zeigt keinen Zähler neben dem Hinweis.

## Ergebnis

4 Reviewer-Befunde angenommen (F-1, F-2, F-5, F-6), 1 eigener Befund aus der
Belegarbeit angenommen (F-8), 3 begründet abgelehnt (F-3 als Follow-up, F-4,
F-7). Das Review-Urteil „mergebar ja" galt für `8eaf70f`; das Delta ist oben
aufgeführt, Produktcode-Delta: `event.code`-Fix, Ergebnis-Guard, Ring,
`flex-wrap`, Gate-Zeile.

Belege (Exit-Codes, Windows 11, Node 24.19.0):

```
npx vitest run src/components/TerminalView.test.tsx -t "layoutunabhängig"   rot (1 failed | 33 skipped) — F-1
npx vitest run src/components/TerminalView.test.tsx -t "verspätetes"        rot (1 failed | 1 passed | 34 skipped) — F-8
npx vitest run src/components/TerminalView.test.tsx                         exit=0 — 36/36
npx vitest run                                                              exit=0 — 66 Dateien, 340 Tests
npm run typecheck                                                           exit=0
npm run lint                                                                exit=0
npm run contrast                                                            exit=0 — 102 Paarungen (inkl. neuer Nicht-Text-Gate)
npx playwright test e2e/tmp-w1-21d-review.spec.ts                            exit=0 (temporäre Spec, danach gelöscht)
```

NICHT ABGEDECKT: echtes Tauri/WebView (Belege im Chromium/Vite-Mock-Pfad);
Linux-Hälfte der Rust-Suite (KI-7 — dieses Paket ändert weiterhin kein Rust);
Alt+C/Alt+R-Kollision mit TUIs nur argumentativ (Kürzel gelten nur bei
geöffneter, fokussierter Leiste); Follow-up F-3 (Regex-Debounce).
