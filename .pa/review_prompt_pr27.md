# Review request PR #27 (W1-21d): case-sensitivity and regex toggles in the terminal scrollback search

You are an independent reviewer (not the author; the author is a Claude/Kimi
model). Review the COMPLETE candidate diff below for correctness bugs, gaps
against the requirements, accessibility problems and safety regressions. Be
concrete: cite file and line, say what breaks and when. Rate each finding
high/medium/low. Do not restate the diff. If something is fine, say nothing
about it. Answer in English or German. This is a READ-ONLY review: do not
modify any files and do not run any commands that write.

## Context

Repo: ProjectA, a Tauri 2 "agentic terminal" (React/TypeScript frontend in
src/, xterm.js with @xterm/addon-search 0.15.0). `TerminalView.tsx` renders one
PTY session; Ctrl+Shift+F opens a scrollback search bar. This package adds two
toggle buttons ("Aa" = case sensitive, ".*" = regular expression), keyboard
shortcuts Alt+C / Alt+R inside the search bar, and an inline error hint for an
uncompilable regex (the addon throws inside xterm for such a pattern, so the
bar must refuse the search instead).

Requirements: toggles are mouse-, Tab- and Alt-key-operable, keep their state
when the bar is closed and reopened, re-run the search incrementally when
toggled, never call the addon with an uncompilable pattern, never leave a stale
result counter next to the error hint, do not send control bytes to the PTY,
and the pressed state must be visible with >= 3:1 non-text contrast (WCAG
1.4.11). The UI language is German.

The change ships its own review history: a first review by Claude Sonnet
(`.pa/review_w1-21d_sonnet.md`, disposition `.pa/review_w1-21d_disposition.md`,
findings F-1..F-8 already handled: event.code for Alt keys, regex error-path
tests, contrast ring + gate row, flex-wrap, late-result guard; F-3 regex debounce
deliberately deferred as a follow-up). Verify these fixes, do not just
re-report them; look for NEW problems, especially: stale closures/refs vs.
state, the toggle handlers reading refs that are updated inside the handler,
the async `onDidChangeResults` guard, focus/keyboard handling, ARIA, and the
tests (do they really prove the behaviour, or could they pass vacuously?).

## Diff (production code)

```diff
diff --git a/scripts/contrast-check.mjs b/scripts/contrast-check.mjs
index 02266b0..386136b 100644
--- a/scripts/contrast-check.mjs
+++ b/scripts/contrast-check.mjs
@@ -101,6 +101,10 @@ for (const [mode, vars] of [["hell  ", light], ["dunkel", dark]]) {
     over(c("color-accent-tint"), surfaces.Inhalt),
   );
   check(mode, "focus-ring / Fenster (Nicht-Text)", c("color-focus-ring"), surfaces.Fenster, 3);
+  // Zustands-Ring der gedrückten Such-Schalter (.terminal-search-toggle):
+  // WCAG 1.4.11 verlangt 3:1 für die Zustandsanzeige — der accent-tint
+  // komponiert über der Karte nur auf ~1,2:1, der Ring trägt den Zustand.
+  check(mode, "accent-text / Karte (Nicht-Text, Such-Schalter)", c("color-accent-text"), surfaces.Karte, 3);
 
   for (const st of ["working", "needs", "review", "merge", "done", "paused", "danger"]) {
     const fg = c(`state-${st}-fg`);
diff --git a/src/components/TerminalView.tsx b/src/components/TerminalView.tsx
index 39513b5..81ef825 100644
--- a/src/components/TerminalView.tsx
+++ b/src/components/TerminalView.tsx
@@ -111,6 +111,22 @@ export const SEARCH_DECORATIONS = {
 
 type SearchDirection = "next" | "previous";
 
+/**
+ * Whether the addon accepts `query` under the current options. With the
+ * regex toggle on, an uncompilable pattern must never reach
+ * `findNext`/`findPrevious` — the addon would throw inside xterm (a
+ * pageerror), so the bar refuses the search and flags the input instead.
+ */
+function queryCompiles(query: string, regex: boolean): boolean {
+  if (!regex || query === "") return true;
+  try {
+    new RegExp(query);
+    return true;
+  } catch {
+    return false;
+  }
+}
+
 /**
  * Renders one PTY session. The component is mounted only while its tab is
  * active; on every (re)mount it re-attaches by replaying `get_scrollback`
@@ -133,14 +149,31 @@ export default function TerminalView({ sessionId, onError }: TerminalViewProps)
   const [searchResult, setSearchResult] = useState<{ resultIndex: number; resultCount: number } | null>(
     null,
   );
+  // Case-sensitivity/regex toggles. They survive close/reopen on purpose,
+  // same convention as the kept search term (browser find bars).
+  const [caseSensitive, setCaseSensitive] = useState(false);
+  const [useRegex, setUseRegex] = useState(false);
+  const [regexInvalid, setRegexInvalid] = useState(false);
+
+  // Read by `runSearch` and the reopen effect without closing over stale
+  // values; the toggle handlers keep them in sync with the state above.
+  const caseSensitiveRef = useRef(caseSensitive);
+  const useRegexRef = useRef(useRegex);
 
   const runSearch = useCallback(
     (direction: SearchDirection, query: string = searchQuery, incremental = false) => {
       const addon = searchAddonRef.current;
       if (!addon || query === "") return;
+      const regex = useRegexRef.current;
+      if (!queryCompiles(query, regex)) return;
       // `incremental` only affects `findNext` (addon-search's own doc
       // comment); passing it to `findPrevious` is a harmless no-op.
-      const options = { decorations: SEARCH_DECORATIONS, incremental };
+      const options = {
+        decorations: SEARCH_DECORATIONS,
+        incremental,
+        caseSensitive: caseSensitiveRef.current,
+        regex,
+      };
       if (direction === "next") addon.findNext(query, options);
       else addon.findPrevious(query, options);
     },
@@ -151,6 +184,38 @@ export default function TerminalView({ sessionId, onError }: TerminalViewProps)
   const searchQueryRef = useRef(searchQuery);
   searchQueryRef.current = searchQuery;
 
+  // After an option toggle (or an edit): re-run the current term with the
+  // current options, or refuse and flag it when it does not compile.
+  const reSearch = useCallback(() => {
+    const query = searchQueryRef.current;
+    if (query === "") {
+      setRegexInvalid(false);
+      return;
+    }
+    if (!queryCompiles(query, useRegexRef.current)) {
+      setRegexInvalid(true);
+      searchAddonRef.current?.clearDecorations();
+      setSearchResult(null);
+      return;
+    }
+    setRegexInvalid(false);
+    runSearch("next", query, true);
+  }, [runSearch]);
+
+  const toggleCaseSensitive = useCallback(() => {
+    const next = !caseSensitiveRef.current;
+    caseSensitiveRef.current = next;
+    setCaseSensitive(next);
+    reSearch();
+  }, [reSearch]);
+
+  const toggleRegex = useCallback(() => {
+    const next = !useRegexRef.current;
+    useRegexRef.current = next;
+    setUseRegex(next);
+    reSearch();
+  }, [reSearch]);
+
   useEffect(() => {
     if (!searchOpen) return;
     searchInputRef.current?.focus();
@@ -160,7 +225,13 @@ export default function TerminalView({ sessionId, onError }: TerminalViewProps)
     // stays where it was instead of skipping ahead.
     const addon = searchAddonRef.current;
     const query = searchQueryRef.current;
-    if (addon && query !== "") addon.findNext(query, { decorations: SEARCH_DECORATIONS, incremental: true });
+    if (addon && query !== "" && queryCompiles(query, useRegexRef.current))
+      addon.findNext(query, {
+        decorations: SEARCH_DECORATIONS,
+        incremental: true,
+        caseSensitive: caseSensitiveRef.current,
+        regex: useRegexRef.current,
+      });
   }, [searchOpen]);
 
   const closeSearch = useCallback(() => {
@@ -195,7 +266,14 @@ export default function TerminalView({ sessionId, onError }: TerminalViewProps)
     const searchAddon = new SearchAddon();
     term.loadAddon(searchAddon);
     searchAddonRef.current = searchAddon;
-    const searchResultsSub = searchAddon.onDidChangeResults((result) => setSearchResult(result));
+    const searchResultsSub = searchAddon.onDidChangeResults((result) => {
+      // Reports arrive asynchronously — the term may have been cleared or
+      // stopped compiling since the search went out. A late report must not
+      // resurrect a stale counter next to the error hint.
+      const query = searchQueryRef.current;
+      if (query === "" || !queryCompiles(query, useRegexRef.current)) return;
+      setSearchResult(result);
+    });
 
     // Ctrl+Shift+F opens scrollback search, via xterm's own key handler
     // (fires before the PTY sees anything — a `window` listener is too
@@ -377,6 +455,22 @@ export default function TerminalView({ sessionId, onError }: TerminalViewProps)
             if (event.key === "Escape") {
               event.preventDefault();
               closeSearch();
+              return;
+            }
+            // Alt+C / Alt+R toggle the search options (VS Code's find
+            // widget convention). Alt combos produce no PTY control byte,
+            // and handling them on the container makes them work from any
+            // control in the bar, same as Escape. Match on event.code, not
+            // event.key: macOS types "ç"/"®" for Option+C/R and non-Latin
+            // layouts move the letters; the physical key is stable.
+            if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
+              if (event.code === "KeyC") {
+                event.preventDefault();
+                toggleCaseSensitive();
+              } else if (event.code === "KeyR") {
+                event.preventDefault();
+                toggleRegex();
+              }
             }
           }}
         >
@@ -385,15 +479,24 @@ export default function TerminalView({ sessionId, onError }: TerminalViewProps)
             type="text"
             className="terminal-search-input"
             aria-label="Suche im Terminal-Scrollback"
+            aria-invalid={regexInvalid || undefined}
             placeholder="Suchen…"
             value={searchQuery}
             onChange={(event) => {
               const value = event.target.value;
               setSearchQuery(value);
               if (value === "") {
+                setRegexInvalid(false);
+                searchAddonRef.current?.clearDecorations();
+                setSearchResult(null);
+              } else if (!queryCompiles(value, useRegexRef.current)) {
+                // Refuse instead of letting the addon throw on a pattern
+                // that does not compile; the hint below says why.
+                setRegexInvalid(true);
                 searchAddonRef.current?.clearDecorations();
                 setSearchResult(null);
               } else {
+                setRegexInvalid(false);
                 // Incremental: expands/moves the selection as the user
                 // keeps typing a still-matching term, instead of the
                 // cursor jumping to a fresh match on every keystroke.
@@ -407,9 +510,34 @@ export default function TerminalView({ sessionId, onError }: TerminalViewProps)
               }
             }}
           />
+          <button
+            type="button"
+            className="button-ghost terminal-search-btn terminal-search-toggle"
+            aria-label="Groß- und Kleinschreibung beachten"
+            aria-pressed={caseSensitive}
+            title="Groß- und Kleinschreibung beachten (Alt+C)"
+            onClick={toggleCaseSensitive}
+          >
+            Aa
+          </button>
+          <button
+            type="button"
+            className="button-ghost terminal-search-btn terminal-search-toggle"
+            aria-label="Regulärer Ausdruck"
+            aria-pressed={useRegex}
+            title="Regulärer Ausdruck (Alt+R)"
+            onClick={toggleRegex}
+          >
+            .*
+          </button>
           <span className="terminal-search-count" aria-live="polite">
             {counterText}
           </span>
+          {regexInvalid ? (
+            <span className="terminal-search-error" role="status">
+              Ungültiger regulärer Ausdruck
+            </span>
+          ) : null}
           <button
             type="button"
             className="button-ghost terminal-search-btn"
diff --git a/src/styles.css b/src/styles.css
index a84e313..a9bb2fd 100644
--- a/src/styles.css
+++ b/src/styles.css
@@ -2837,6 +2837,9 @@ a {
   align-self: flex-end;
   display: flex;
   align-items: center;
+  /* The bar grew (two toggles + error hint); without wrap it overflows the
+     right edge of narrow terminal panels. */
+  flex-wrap: wrap;
   gap: var(--space-3);
   margin: var(--space-6) var(--space-7) 0 0;
   padding: var(--space-4) var(--space-5);
@@ -2867,6 +2870,24 @@ a {
   padding: 3px var(--space-4);
 }
 
+/* "Pressed" look for the case/regex toggles: the same accent-tint /
+accent-text pairing .convo-msg-user already uses, so the contrast gate
+covers the text. The tint alone composes over --color-elevated to only
+~1.2:1 — below the 3:1 WCAG 1.4.11 asks of a state indicator — so the
+inset ring carries the pressed state; its pairing is gated in
+scripts/contrast-check.mjs. */
+.terminal-search-toggle.button-ghost[aria-pressed="true"] {
+  background: var(--color-accent-tint);
+  color: var(--color-accent-text);
+  box-shadow: inset 0 0 0 1px var(--color-accent-text);
+}
+
+.terminal-search-error {
+  color: var(--state-danger-fg);
+  font-size: var(--text-sm);
+  white-space: nowrap;
+}
+
 .empty-state {
   display: flex;
   flex-direction: column;
```

## Diff (tests)

```diff
diff --git a/src/components/TerminalView.test.tsx b/src/components/TerminalView.test.tsx
index 2ff75d5..2d80ebe 100644
--- a/src/components/TerminalView.test.tsx
+++ b/src/components/TerminalView.test.tsx
@@ -444,6 +444,8 @@ describe("TerminalView", () => {
     expect(mocks.searchAddon.findNext).toHaveBeenCalledWith("fehler", {
       decorations: SEARCH_DECORATIONS,
       incremental: true,
+      caseSensitive: false,
+      regex: false,
     });
   });
 
@@ -484,6 +486,226 @@ describe("TerminalView", () => {
     expect(mocks.searchResultsSubDispose).toHaveBeenCalledOnce();
   });
 
+  describe("Schalter für die Suchoptionen", () => {
+    /** Mounts the view and opens the search bar; returns the search input. */
+    function openSearch() {
+      render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
+      pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
+      return screen.getByRole("textbox", { name: /suche/i });
+    }
+
+    it("der Schalter für Groß- und Kleinschreibung reicht caseSensitive an die Suche durch", () => {
+      const input = openSearch();
+      fireEvent.change(input, { target: { value: "Fehler" } });
+      mocks.searchAddon.findNext.mockClear();
+
+      fireEvent.click(screen.getByRole("button", { name: /groß- und kleinschreibung/i }));
+
+      expect(mocks.searchAddon.findNext).toHaveBeenCalledWith(
+        "Fehler",
+        expect.objectContaining({ caseSensitive: true }),
+      );
+    });
+
+    it("der Regex-Schalter reicht die Regex-Option an die Suche durch", () => {
+      const input = openSearch();
+      fireEvent.change(input, { target: { value: "feh+er" } });
+      mocks.searchAddon.findNext.mockClear();
+
+      fireEvent.click(screen.getByRole("button", { name: /regulärer ausdruck/i }));
+
+      expect(mocks.searchAddon.findNext).toHaveBeenCalledWith(
+        "feh+er",
+        expect.objectContaining({ regex: true }),
+      );
+    });
+
+    it("umschalten bei vorhandenem Begriff sucht inkrementell erneut", () => {
+      const input = openSearch();
+      fireEvent.change(input, { target: { value: "fehler" } });
+      mocks.searchAddon.findNext.mockClear();
+
+      fireEvent.click(screen.getByRole("button", { name: /groß- und kleinschreibung/i }));
+
+      // Incremental like typing: the active match must not skip ahead just
+      // because an option changed.
+      expect(mocks.searchAddon.findNext).toHaveBeenCalledWith(
+        "fehler",
+        expect.objectContaining({ incremental: true }),
+      );
+    });
+
+    it("die Schalter behalten ihren Zustand beim Wiederöffnen", () => {
+      const input = openSearch();
+      fireEvent.click(screen.getByRole("button", { name: /groß- und kleinschreibung/i }));
+      fireEvent.change(input, { target: { value: "Fehler" } });
+      fireEvent.keyDown(input, { key: "Escape" });
+      mocks.searchAddon.findNext.mockClear();
+
+      pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
+
+      // Same convention as the kept search term (browser find bars): the
+      // toggles survive close/reopen, and the repaint search uses them.
+      expect(mocks.searchAddon.findNext).toHaveBeenCalledWith(
+        "Fehler",
+        expect.objectContaining({ caseSensitive: true, regex: false }),
+      );
+    });
+
+    it("ein ungültiger Regex löst keine Suche aus und meldet den Fehler", () => {
+      const input = openSearch();
+      fireEvent.click(screen.getByRole("button", { name: /regulärer ausdruck/i }));
+      mocks.searchAddon.findNext.mockClear();
+
+      // "[" never compiles; handing it to the addon would throw inside
+      // xterm. The bar must refuse the search and say why instead.
+      fireEvent.change(input, { target: { value: "[" } });
+
+      expect(mocks.searchAddon.findNext).not.toHaveBeenCalled();
+      expect(input).toHaveAttribute("aria-invalid", "true");
+      expect(screen.getByRole("status")).toHaveTextContent(/ungültig/i);
+
+      fireEvent.change(input, { target: { value: "[a]" } });
+
+      expect(mocks.searchAddon.findNext).toHaveBeenCalledWith(
+        "[a]",
+        expect.objectContaining({ regex: true }),
+      );
+      expect(input).not.toHaveAttribute("aria-invalid", "true");
+    });
+
+    it("Alt C und Alt R schalten die Suchoptionen per Tastatur um", () => {
+      const input = openSearch();
+      const caseToggle = screen.getByRole("button", { name: /groß- und kleinschreibung/i });
+      const regexToggle = screen.getByRole("button", { name: /regulärer ausdruck/i });
+
+      fireEvent.keyDown(input, { key: "c", code: "KeyC", altKey: true });
+      expect(caseToggle).toHaveAttribute("aria-pressed", "true");
+      expect(regexToggle).toHaveAttribute("aria-pressed", "false");
+
+      // Works from a button's focus too, not only from the input — handled
+      // on the role="search" container, same as Escape.
+      fireEvent.keyDown(caseToggle, { key: "r", code: "KeyR", altKey: true });
+      expect(regexToggle).toHaveAttribute("aria-pressed", "true");
+
+      fireEvent.keyDown(input, { key: "c", code: "KeyC", altKey: true });
+      expect(caseToggle).toHaveAttribute("aria-pressed", "false");
+    });
+
+    it("Alt C und Alt R wirken layoutunabhängig über event.code", () => {
+      const input = openSearch();
+      const caseToggle = screen.getByRole("button", { name: /groß- und kleinschreibung/i });
+      const regexToggle = screen.getByRole("button", { name: /regulärer ausdruck/i });
+
+      // macOS types "ç" for Option+C and "®" for Option+R; non-Latin
+      // layouts map the letters elsewhere too. Only event.code names the
+      // physical key on every platform the app ships to.
+      fireEvent.keyDown(input, { key: "ç", code: "KeyC", altKey: true });
+      expect(caseToggle).toHaveAttribute("aria-pressed", "true");
+
+      fireEvent.keyDown(input, { key: "®", code: "KeyR", altKey: true });
+      expect(regexToggle).toHaveAttribute("aria-pressed", "true");
+    });
+
+    it("Regex abschalten bei ungültigem Muster nimmt den Fehler und sucht literal", () => {
+      const input = openSearch();
+      fireEvent.click(screen.getByRole("button", { name: /regulärer ausdruck/i }));
+      fireEvent.change(input, { target: { value: "[" } });
+      expect(input).toHaveAttribute("aria-invalid", "true");
+      mocks.searchAddon.findNext.mockClear();
+
+      fireEvent.click(screen.getByRole("button", { name: /regulärer ausdruck/i }));
+
+      // "[" is a fine literal term: the hint goes and the kept term
+      // re-searches with regex off.
+      expect(input).not.toHaveAttribute("aria-invalid", "true");
+      expect(document.querySelector(".terminal-search-error")).toBeNull();
+      expect(mocks.searchAddon.findNext).toHaveBeenCalledWith(
+        "[",
+        expect.objectContaining({ regex: false }),
+      );
+    });
+
+    it("Enter und Pfeil-Buttons suchen bei ungültigem Regex nicht", () => {
+      const input = openSearch();
+      fireEvent.click(screen.getByRole("button", { name: /regulärer ausdruck/i }));
+      fireEvent.change(input, { target: { value: "[" } });
+      mocks.searchAddon.findNext.mockClear();
+      mocks.searchAddon.findPrevious.mockClear();
+
+      fireEvent.keyDown(input, { key: "Enter" });
+      fireEvent.click(screen.getByRole("button", { name: /nächster treffer/i }));
+      fireEvent.click(screen.getByRole("button", { name: /vorheriger treffer/i }));
+
+      // Every path into the addon must refuse the pattern — the addon would
+      // throw inside xterm — and the hint stays up to say why nothing moves.
+      expect(mocks.searchAddon.findNext).not.toHaveBeenCalled();
+      expect(mocks.searchAddon.findPrevious).not.toHaveBeenCalled();
+      expect(document.querySelector(".terminal-search-error")).not.toBeNull();
+    });
+
+    it("ungültiger Regex leert Dekorationen und Zähler", () => {
+      const input = openSearch();
+      fireEvent.click(screen.getByRole("button", { name: /regulärer ausdruck/i }));
+      fireEvent.change(input, { target: { value: "fehler" } });
+      act(() => {
+        mocks.searchResultsCallback!({ resultIndex: 0, resultCount: 2 });
+      });
+      expect(document.querySelector(".terminal-search-count")).toHaveTextContent("1/2");
+      mocks.searchAddon.clearDecorations.mockClear();
+
+      fireEvent.change(input, { target: { value: "[" } });
+
+      // Stale highlights next to an error hint would claim matches the
+      // current term never produced.
+      expect(mocks.searchAddon.clearDecorations).toHaveBeenCalled();
+      expect(document.querySelector(".terminal-search-count")).toHaveTextContent("");
+    });
+
+    it("verspätetes Ergebnis bei ungültigem Regex stellt den Zähler nicht wieder her", () => {
+      const input = openSearch();
+      fireEvent.click(screen.getByRole("button", { name: /regulärer ausdruck/i }));
+      fireEvent.change(input, { target: { value: "[" } });
+      expect(document.querySelector(".terminal-search-count")).toHaveTextContent("");
+
+      // The addon reports asynchronously; a result for a search issued
+      // while the pattern still compiled must not resurrect a counter next
+      // to the error hint (observed in a real browser: stale "0/0").
+      act(() => {
+        mocks.searchResultsCallback!({ resultIndex: -1, resultCount: 0 });
+      });
+
+      expect(document.querySelector(".terminal-search-count")).toHaveTextContent("");
+    });
+
+    it("verspätetes Ergebnis bei geleertem Begriff stellt den Zähler nicht wieder her", () => {
+      const input = openSearch();
+      fireEvent.change(input, { target: { value: "fehler" } });
+      fireEvent.change(input, { target: { value: "" } });
+      expect(document.querySelector(".terminal-search-count")).toHaveTextContent("");
+
+      act(() => {
+        mocks.searchResultsCallback!({ resultIndex: 0, resultCount: 3 });
+      });
+
+      expect(document.querySelector(".terminal-search-count")).toHaveTextContent("");
+    });
+
+    it("Enter nach dem Umschalten nutzt die neuen Optionen", () => {
+      const input = openSearch();
+      fireEvent.change(input, { target: { value: "Fehler" } });
+      fireEvent.click(screen.getByRole("button", { name: /groß- und kleinschreibung/i }));
+      mocks.searchAddon.findNext.mockClear();
+
+      fireEvent.keyDown(input, { key: "Enter" });
+
+      expect(mocks.searchAddon.findNext).toHaveBeenCalledWith(
+        "Fehler",
+        expect.objectContaining({ caseSensitive: true, regex: false }),
+      );
+    });
+  });
+
   describe("Kontrast der Treffer-Hervorhebung", () => {
     // #RRGGBB, weil addon-search laut Typings nur dieses Format akzeptiert
     // (Alpha wird stillschweigend verworfen) — eine transluzente Farbe wäre
```
