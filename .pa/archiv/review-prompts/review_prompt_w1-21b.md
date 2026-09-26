# Review-Auftrag W1-21b (ProjectA, Tauri 2 + React, reines Frontend)

Du bist unabhängiger Code-Reviewer. Prüfe den Diff unten streng auf Korrektheit. Antworte auf Deutsch.
Gib für jeden Befund: ID (R1, R2, …), Schwere (hoch/mittel/niedrig/nit), Datei:Zeile, Befund, konkreter Fix-Vorschlag.
Wenn du nichts Substanzielles findest, sag das ausdrücklich. Erfinde keine Befunde; begründe jeden mit dem Code.

## Kontext
- `TerminalView.tsx` hat eine Scrollback-Suche (Ctrl+Shift+F) mit `@xterm/addon-search@0.15.0` gegen `@xterm/xterm@5.5.0`.
- Befund (a): Nach Schließen (Esc/✕: `clearDecorations()`, `searchResult=null`, Begriff bleibt) und Wiederöffnen stand der alte Begriff markiert im Feld, aber ohne Treffer-Dekorationen, und der Zähler zeigte "0/0". Außerdem meldet das Addon "kein Treffer" als `{resultIndex:-1,resultCount:0}` — der Zähler zeigte dann "?/0".
- Fix (a): Beim Öffnen (Effekt auf `searchOpen`) mit nicht-leerem Begriff einmal `findNext(query,{decorations, incremental:true})`; Zähler leer bis das Addon antwortet; `resultCount===0` → "0/0".
- Befund (b): `@xterm/addon-fit@0.11.0` ist das xterm-6-Begleit-Addon (keine peerDependencies) und zieht in `proposeDimensions()` fest `overviewRuler.width || 14` ab statt xterms 5.x gemessener `_core.viewport.scrollBarWidth`. `0.10.0` hat `peerDependencies: {"@xterm/xterm":"^5.0.0"}` und nutzt den gemessenen Wert. Fix: `~0.10.0`, Lockfile per `npm install`.
- Relevanter Addon-Code (0.15.0): `findNext` ruft `_highlightAllMatches` nur, wenn `_cachedSearchTerm` undefined/anders oder Optionen geändert; `clearDecorations()` ohne Argument setzt `_cachedSearchTerm = undefined`; `_fireResults` feuert `onDidChangeResults` synchron nach jeder Suche mit Dekorationen.
- Frage an dich zusätzlich: Ist die Zähler-Logik jetzt in allen Fällen richtig (leer / 0/0 / ?/n / i/n)? Kann der Öffnen-Effekt doppelt suchen (React StrictMode, erneutes Ctrl+Shift+F bei offener Leiste)? Ist `~0.10.0` die richtige Range?

## Diff (gegen origin/main)
```diff
diff --git a/docs/decisions.md b/docs/decisions.md
index 82b0ec5..f26fc87 100644
--- a/docs/decisions.md
+++ b/docs/decisions.md
@@ -996,3 +996,18 @@ snapshot set proves noisier than the point assertions it complements.
   `@xterm/addon-*`-Pakete im Gleichschritt, inklusive `addon-fit` und der
   API-Anpassungen, die `@xterm/addon-search@0.16.0`s `#RRGGBB`-only-Vorgabe
   fuer Decoration-Farben ohnehin schon zeigt.
+
+## 2026-09-23 - addon-fit zurueck auf die xterm-5-Linie (W1-21b)
+
+- `@xterm/addon-fit` von `^0.11.0` auf `~0.10.0`. Der W1-21-Nebenbefund
+  oben ist jetzt belegt, nicht nur vermutet: `0.11.0` fuehrt keine
+  `peerDependencies` mehr, `0.10.0` deklariert `{"@xterm/xterm": "^5.0.0"}`.
+  Der Quelltextvergleich zeigt die konkrete Unvertraeglichkeit: `0.11.0`
+  zieht in `proposeDimensions()` fest `overviewRuler.width || 14` ab — die
+  Breite der eigenen Scrollbar von xterm 6 —, `0.10.0` dagegen die von
+  xterm 5.5 gemessene native Breite `_core.viewport.scrollBarWidth`
+  (Windows klassisch 17px, Fallback 15px). Mit `0.11.0` gegen 5.5 bekommt
+  das Terminal bei breiter nativer Scrollbar eine Spalte zu viel, die unter
+  der Scrollbar liegt. Beleg: `src/components/xtermFitCompat.test.ts`
+  (echtes Paket, rot mit 0.11, gruen mit 0.10). Lockfile per `npm install`.
+  Zuruecknehmen: beim geschlossenen Sprung auf `@xterm/xterm` 6.x, wie oben.
diff --git a/package.json b/package.json
index e8938c8..bc0b291 100644
--- a/package.json
+++ b/package.json
@@ -35,7 +35,7 @@
     "@tauri-apps/plugin-process": "^2.3.1",
     "@tauri-apps/plugin-updater": "^2.10.1",
     "@xterm/addon-canvas": "^0.7.0",
-    "@xterm/addon-fit": "^0.11.0",
+    "@xterm/addon-fit": "~0.10.0",
     "@xterm/addon-search": "~0.15.0",
     "@xterm/addon-webgl": "0.18.0",
     "@xterm/xterm": "^5.5.0",
diff --git a/src/components/TerminalView.test.tsx b/src/components/TerminalView.test.tsx
index 8fed6da..ba5499b 100644
--- a/src/components/TerminalView.test.tsx
+++ b/src/components/TerminalView.test.tsx
@@ -301,6 +301,69 @@ describe("TerminalView", () => {
     expect(document.querySelector(".terminal-search-count")).toHaveTextContent("?/1200");
   });
 
+  it("kein Treffer zeigt 0 von 0 statt eines Fragezeichens", () => {
+    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
+    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
+    fireEvent.change(screen.getByRole("textbox", { name: /suche/i }), { target: { value: "gibtsnicht" } });
+
+    // addon-search reports "no match" as resultIndex -1 with resultCount 0 —
+    // the same -1 it uses past the highlight limit.
+    act(() => {
+      mocks.searchResultsCallback!({ resultIndex: -1, resultCount: 0 });
+    });
+
+    expect(document.querySelector(".terminal-search-count")).toHaveTextContent("0/0");
+  });
+
+  it("Wiederöffnen belegt den letzten Suchbegriff vor und markiert seine Treffer erneut", () => {
+    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
+    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
+    fireEvent.change(screen.getByRole("textbox", { name: /suche/i }), { target: { value: "fehler" } });
+    act(() => {
+      mocks.searchResultsCallback!({ resultIndex: 0, resultCount: 3 });
+    });
+    fireEvent.keyDown(screen.getByRole("textbox", { name: /suche/i }), { key: "Escape" });
+    mocks.searchAddon.findNext.mockClear();
+
+    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
+
+    // Closing cleared the decorations; reopening with the kept term must
+    // paint them again (incremental: the cursor stays on the same match),
+    // otherwise the bar shows a term with no highlights next to it.
+    expect(screen.getByRole("textbox", { name: /suche/i })).toHaveValue("fehler");
+    expect(mocks.searchAddon.findNext).toHaveBeenCalledWith(
+      "fehler",
+      expect.objectContaining({ incremental: true }),
+    );
+  });
+
+  it("Wiederöffnen zeigt keinen falschen Zähler 0 von 0 solange die Suche läuft", () => {
+    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
+    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
+    fireEvent.change(screen.getByRole("textbox", { name: /suche/i }), { target: { value: "fehler" } });
+    act(() => {
+      mocks.searchResultsCallback!({ resultIndex: 0, resultCount: 3 });
+    });
+    fireEvent.keyDown(screen.getByRole("textbox", { name: /suche/i }), { key: "Escape" });
+
+    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
+
+    // The addon reports asynchronously; until it does, "0/0" would claim
+    // "no matches" for a term that had three a moment ago.
+    expect(document.querySelector(".terminal-search-count")).not.toHaveTextContent("0/0");
+  });
+
+  it("leerer Suchbegriff beim Wiederöffnen löst keine Suche aus", () => {
+    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
+    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
+    fireEvent.keyDown(screen.getByRole("textbox", { name: /suche/i }), { key: "Escape" });
+
+    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
+
+    expect(mocks.searchAddon.findNext).not.toHaveBeenCalled();
+    expect(document.querySelector(".terminal-search-count")).toHaveTextContent("");
+  });
+
   it("Schließen der Ansicht entsorgt das Search-Addon und sein Ergebnis-Abo", () => {
     const { unmount } = render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
 
diff --git a/src/components/TerminalView.tsx b/src/components/TerminalView.tsx
index 561ac53..00305ed 100644
--- a/src/components/TerminalView.tsx
+++ b/src/components/TerminalView.tsx
@@ -134,13 +134,6 @@ export default function TerminalView({ sessionId, onError }: TerminalViewProps)
     null,
   );
 
-  useEffect(() => {
-    if (searchOpen) {
-      searchInputRef.current?.focus();
-      searchInputRef.current?.select();
-    }
-  }, [searchOpen]);
-
   const runSearch = useCallback(
     (direction: SearchDirection, query: string = searchQuery, incremental = false) => {
       const addon = searchAddonRef.current;
@@ -154,6 +147,22 @@ export default function TerminalView({ sessionId, onError }: TerminalViewProps)
     [searchQuery],
   );
 
+  // Read by the open effect below without making it re-run per keystroke.
+  const searchQueryRef = useRef(searchQuery);
+  searchQueryRef.current = searchQuery;
+
+  useEffect(() => {
+    if (!searchOpen) return;
+    searchInputRef.current?.focus();
+    searchInputRef.current?.select();
+    // Closing cleared the decorations but kept the term (browser-style
+    // prefill): paint its matches again. Incremental, so the active match
+    // stays where it was instead of skipping ahead.
+    const addon = searchAddonRef.current;
+    const query = searchQueryRef.current;
+    if (addon && query !== "") addon.findNext(query, { decorations: SEARCH_DECORATIONS, incremental: true });
+  }, [searchOpen]);
+
   const closeSearch = useCallback(() => {
     setSearchOpen(false);
     setSearchResult(null);
@@ -319,10 +328,12 @@ export default function TerminalView({ sessionId, onError }: TerminalViewProps)
 
   // "1"-based for people, "?" once the addon stops indexing past its
   // highlight limit (`resultIndex === -1`, see the addon's own typings).
+  // Empty until the addon has reported for the current term: "0/0" would
+  // claim "no matches" before the search even answered.
   const counterText =
-    searchQuery === ""
+    searchQuery === "" || !searchResult
       ? ""
-      : !searchResult
+      : searchResult.resultCount === 0
         ? "0/0"
         : searchResult.resultIndex === -1
           ? `?/${searchResult.resultCount}`
diff --git a/src/components/xtermFitCompat.test.ts b/src/components/xtermFitCompat.test.ts
new file mode 100644
index 0000000..f88744e
--- /dev/null
+++ b/src/components/xtermFitCompat.test.ts
@@ -0,0 +1,47 @@
+import { FitAddon } from "@xterm/addon-fit";
+import type { Terminal } from "@xterm/xterm";
+import { describe, expect, it } from "vitest";
+
+/**
+ * Runs the *installed* `@xterm/addon-fit` (no mock) against a stand-in for
+ * `@xterm/xterm@5.5`'s private surface. xterm 5.x draws a native scrollbar
+ * and measures its real width into `_core.viewport.scrollBarWidth`
+ * (e.g. 17px for classic Windows scrollbars, 15px fallback for overlay
+ * ones). addon-fit 0.11 belongs to xterm 6, whose own scrollbar is a fixed
+ * 14px, and ignores that measurement — the last column then lands under
+ * the scrollbar.
+ */
+function proposeCols(scrollBarWidth: number, parentWidth: number): number | undefined {
+  const parent = document.createElement("div");
+  parent.style.width = `${parentWidth}px`;
+  parent.style.height = "240px";
+  const element = document.createElement("div");
+  element.style.padding = "0px";
+  parent.appendChild(element);
+  document.body.appendChild(parent);
+
+  const fake = {
+    element,
+    options: { scrollback: 10_000 },
+    rows: 24,
+    cols: 80,
+    _core: {
+      viewport: { scrollBarWidth },
+      _renderService: { dimensions: { css: { cell: { width: 7, height: 10 } } } },
+    },
+  };
+  const addon = new FitAddon();
+  addon.activate(fake as unknown as Terminal);
+  const cols = addon.proposeDimensions()?.cols;
+  parent.remove();
+  return cols;
+}
+
+describe("addon-fit gegen xterm 5", () => {
+  it("zieht die von xterm 5 gemessene Scrollbarbreite ab", () => {
+    // 714px - 17px Scrollbar = 697px Platz = 99 volle Zellen à 7px.
+    // Mit xterm 6s fixen 14px wären es 700px = 100 Spalten, die letzte
+    // davon unter der Scrollbar.
+    expect(proposeCols(17, 714)).toBe(99);
+  });
+});
```
