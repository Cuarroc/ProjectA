# Review W1-21d (W1-21d)

Ich habe den Diff gelesen und zwei Stellen im echten Code geprüft (`counterText`, `closeSearch`). Ich habe **nichts ausgeführt**, keine Tests und kein Build.

**Nichts Blocking gefunden.**

Was ich geprüft habe und in Ordnung ist:
- **Refs und State:** Die Toggle-Handler setzen zuerst den Ref, dann den State, danach `reSearch`. Damit lesen `runSearch` und der Wiederöffnen-Effekt keine veralteten Werte. Der Ref-Flip liegt nicht in einem State-Updater, StrictMode löst ihn also nicht doppelt aus.
- **`queryCompiles` gegen das Addon:** Das Addon kompiliert mit `g` oder `gi`, der Diff prüft ohne Flags. Ohne `u`-Flag akzeptieren beide dieselbe Menge an Mustern, die Vorprüfung ist also deckungsgleich.
- **Zähler bei ungültigem Regex:** `counterText` ist bei `searchResult === null` leer. Neben dem Fehlerhinweis erscheint also kein irreführendes „0/0".
- **Enter, ⌃/⌥ und AltGr:** Enter und Pfeil-Buttons machen bei ungültigem Regex über `runSearch` still nichts, der Hinweis bleibt sichtbar. AltGr (Ctrl+Alt) ist über `!ctrlKey` ausgeschlossen.

## Befunde

**1. medium — Alt+C / Alt+R prüfen `event.key`, nicht `event.code`**
- **Beleg:** `TerminalView.tsx`, `onKeyDown` des `role="search"`-Containers: `const key = event.key.toLowerCase(); if (key === "c") … "r"`.
- **Problem:** Auf macOS liefert Alt+C den Wert `"ç"` und Alt+R den Wert `"®"`. Bei nicht-lateinischen Layouts (z. B. Russisch: `"с"`, `"к"`) trifft der Vergleich ebenfalls nie. Tauri 2 ist plattformübergreifend, und das Tooltip „(Alt+C)" verspricht das Kürzel.
- **Szenario:** Ein Mac-Nutzer drückt Alt+C in der Suchleiste. Es passiert nichts, oder `ç` landet im Eingabefeld.
- **Fix:** `event.code === "KeyC"` bzw. `"KeyR"` verwenden. Das ist layoutunabhängig, die `!ctrl/!meta/!shift`-Bedingung bleibt. Ein Test mit `{ code: "KeyC", key: "ç", altKey: true }` deckt es ab.

**2. low — Regex-Fehlerpfade nur teilweise getestet**
- **Beleg:** Test „ein ungültiger Regex löst keine Suche aus…" prüft nur `findNext` per Eingabe und `aria-invalid`.
- **Fehlt:**
  - Umschalten des Regex-Schalters *aus* bei ungültigem Muster (Fehler muss verschwinden, `reSearch` läuft dann über den Kompilier-Pfad).
  - Enter oder ⌃-Pfeil bei ungültigem Regex: `findNext` und `findPrevious` dürfen nicht aufgerufen werden.
  - `clearDecorations` und der geleerte Zähler (Paketziel „Dekorationen und Zähler werden geleert").
- **Szenario:** Wenn jemand `runSearch` später die Vorprüfung nimmt, bleibt die Suite grün, und xterm wirft wieder beim Enter.
- **Fix:** 2–3 kurze Tests ergänzen.

**3. low — Regex-Suche läuft synchron auf dem UI-Thread, bei jedem Tastendruck**
- **Beleg:** `onChange` ruft bei aktivem Regex `runSearch(..., incremental=true)`.
- **Szenario:** Ein Muster wie `(a+)+$` gegen lange Scrollback-Zeilen mit vielen `a` friert die App beim Tippen ein. Das ist selbstverschuldet und kein Sicherheitsproblem, aber die Vorprüfung schützt nur vor Syntaxfehlern.
- **Fix:** Nicht in diesem PR nötig, als Follow-up notieren. Optional bei Regex mit Debounce suchen.

**4. low — Leere Treffer (`a*`, `^`, `\b`) sind unbelegt**
- **Beleg:** Der Report nennt das selbst unter „NICHT ABGEDECKT". Ich habe es auch nicht geprüft.
- **Risiko:** Ob `@xterm/addon-search` leere Treffer sauber behandelt, hängt von der installierten Version ab. Die Vorprüfung deckt das nicht ab, weil solche Muster kompilieren.
- **Fix:** Einmal mit `.*` und `^` im echten Addon prüfen (ein Smoke-Test genügt). Wenn es hängt oder wirft, den Guard erweitern.

**5. low — Zustands-Hervorhebung nur per Farbe, Nicht-Text-Kontrast nicht belegt**
- **Beleg:** `styles.css`, `.terminal-search-toggle.button-ghost[aria-pressed="true"]` ändert nur `background`/`color`.
- **Problem:** `npm run contrast` prüft laut Report Text-Paarungen. Ob `--color-accent-tint` gegen `--color-elevated` 3:1 als Zustandsindikator erreicht (WCAG 1.4.11), zeigt die Aussage „100/100" nicht. `aria-pressed` deckt Screenreader ab, aber nicht Sehende mit geringem Kontrast.
- **Fix:** Zusätzlich einen Rand oder `font-weight` bei gedrücktem Zustand setzen, oder das Paar prüfen. Nebenbei: Sichtbarer Text „Aa" und „.*" steckt nicht im Accessible Name (Label-in-Name). Bei Symbolen vertretbar.

**6. low — Fehlerhinweis könnte die Leiste bei schmalen Panels sprengen**
- **Beleg:** `.terminal-search-bar` hat `display:flex` ohne Umbruch, der Input ist fix 180px breit. Neu hinzu kommen zwei Buttons und ein `nowrap`-Hinweis „Ungültiger regulärer Ausdruck".
- **Szenario:** Die Leiste läuft bei schmalem Terminal-Panel über den rechten Rand. Der Screenshot ist nur bei 900 px belegt.
- **Fix:** Bei einem kleineren Viewport ansehen. Gegebenenfalls den Hinweis kürzen oder `flex-wrap` setzen.

**7. low (Doku) — Widerspruch beim Rot-Beleg**
- Der Reviewauftrag nennt „4 neue Tests schlugen fehl", der Report nennt 7 einzeln rote Tests plus einen angepassten Bestandstest. Für die red-first-Prüfung sollten Zahl und Namen im Report und im PR-Text übereinstimmen.
- Der Pfad der Screenshots weicht ebenfalls ab: `docs/audits/assets/2026-09-25-w1-21d-suche/` im Diff gegenüber `docs/audits/2026-09-25-…` im Auftrag.

## Gesamturteil

**mergebar: ja.** Es gibt keinen blockierenden Befund. Ich würde vor dem Merge **Befund 1** beheben (kleine Änderung, echter Plattformfehler) und **Befund 2** mit ein paar Tests abdecken. Die übrigen Punkte können als Follow-up oder Notiz in die Disposition.

Zwei Einschränkungen: Ich habe weder Tests noch Build noch Screenshots geprüft. Die Bewertung von Befund 4 und 6 ist deshalb nur aus dem Diff geschlossen.

Ich habe bewusst nichts in `.pa/review_w1-21d_sonnet.md` geschrieben, weil Plan-Modus aktiv ist und Dateiänderungen sperrt. Soll ich die Befunde dort ablegen?
