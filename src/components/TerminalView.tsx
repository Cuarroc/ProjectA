import { useCallback, useEffect, useRef, useState } from "react";
import { CanvasAddon } from "@xterm/addon-canvas";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type ITerminalAddon } from "@xterm/xterm";

import { describeError, getScrollback, onPtyOutput, resizePty, writePty } from "../lib/ipc";
import "@xterm/xterm/css/xterm.css";

const THEME = {
  background: "#1e1e1e",
  foreground: "#cccccc",
  cursor: "#aeafad",
  selectionBackground: "#264f78",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
};

/**
 * Best-effort renderer upgrade: WebGL, falling back to canvas, falling back to
 * xterm's default DOM renderer. Returns the addon so it can be disposed.
 *
 * `onContextLoss` comes from the caller instead of disposing inline: xterm's
 * WebglAddon reads `terminal._core._store` during dispose, which is gone once
 * the Terminal itself was disposed — the renderer may only be disposed while
 * the component is alive, and at most once.
 */
function loadRenderer(term: Terminal, onContextLoss: () => void): ITerminalAddon | null {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(onContextLoss);
    term.loadAddon(webgl);
    return webgl;
  } catch {
    // WebGL2 unavailable — fall through.
  }
  try {
    const canvas = new CanvasAddon();
    term.loadAddon(canvas);
    return canvas;
  } catch {
    return null;
  }
}

interface TerminalViewProps {
  sessionId: string;
  /** Reported to the status bar / error banner when IPC fails. */
  onError: (message: string) => void;
}

/** sRGB relative luminance (WCAG), used by {@link contrastRatio}. */
function relativeLuminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two `#RRGGBB` colours (>= 1, <= 21). */
export function contrastRatio(hexA: string, hexB: string): number {
  const [a, b] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/**
 * Match highlight colours for the search addon: plain strings, not CSS
 * custom properties (the addon paints them outside the React tree), so they
 * come from `THEME` above — the one hard-coded, mode-independent palette in
 * this codebase, already exempt from `scripts/contrast-check.mjs`. The
 * search bar's own chrome uses design tokens, see `.terminal-search-bar` in
 * `src/styles.css`.
 *
 * `matchBackground`/`activeMatchBackground` must be opaque `#RRGGBB` (the
 * addon's typings say so — alpha is silently dropped), so unlike the rest of
 * this file's colours they cannot just be a translucent wash over
 * `THEME.yellow`. Both are picked so `THEME.foreground` (`#cccccc`, the
 * terminal's own text colour, painted on top of every match) reads at
 * WCAG AA (>= 4.5:1); see the contrast test in `TerminalView.test.tsx`. The
 * active match uses a different hue (amber vs. olive) so it stays visually
 * distinct from the other matches, not just brighter.
 */
export const SEARCH_DECORATIONS = {
  matchBackground: "#4d4d00", // contrastRatio(THEME.foreground, ·) ≈ 5.50
  matchBorder: THEME.yellow,
  matchOverviewRuler: THEME.yellow,
  activeMatchBackground: "#5a2d00", // contrastRatio(THEME.foreground, ·) ≈ 7.22
  activeMatchBorder: THEME.brightYellow,
  activeMatchColorOverviewRuler: THEME.brightYellow,
};

type SearchDirection = "next" | "previous";

/**
 * Whether the addon accepts `query` under the current options. With the
 * regex toggle on, an uncompilable pattern must never reach
 * `findNext`/`findPrevious` — the addon would throw inside xterm (a
 * pageerror), so the bar refuses the search and flags the input instead.
 */
function queryCompiles(query: string, regex: boolean): boolean {
  if (!regex || query === "") return true;
  try {
    new RegExp(query);
    return true;
  } catch {
    return false;
  }
}

/**
 * Renders one PTY session. The component is mounted only while its tab is
 * active; on every (re)mount it re-attaches by replaying `get_scrollback`
 * before any live output, so switching tabs never loses terminal history.
 */
export default function TerminalView({ sessionId, onError }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Keep the latest callback without re-running the (expensive) mount effect.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Set once by the mount effect below; read by the search bar, which lives
  // outside that effect so it can be plain React state.
  const termRef = useRef<Terminal | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<{ resultIndex: number; resultCount: number } | null>(
    null,
  );
  // Case-sensitivity/regex toggles. They survive close/reopen on purpose,
  // same convention as the kept search term (browser find bars).
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [regexInvalid, setRegexInvalid] = useState(false);

  // Read by `runSearch` and the reopen effect without closing over stale
  // values; the toggle handlers keep them in sync with the state above.
  const caseSensitiveRef = useRef(caseSensitive);
  const useRegexRef = useRef(useRegex);

  const runSearch = useCallback(
    (direction: SearchDirection, query: string = searchQuery, incremental = false) => {
      const addon = searchAddonRef.current;
      if (!addon || query === "") return;
      const regex = useRegexRef.current;
      if (!queryCompiles(query, regex)) return;
      // `incremental` only affects `findNext` (addon-search's own doc
      // comment); passing it to `findPrevious` is a harmless no-op.
      const options = {
        decorations: SEARCH_DECORATIONS,
        incremental,
        caseSensitive: caseSensitiveRef.current,
        regex,
      };
      if (direction === "next") addon.findNext(query, options);
      else addon.findPrevious(query, options);
    },
    [searchQuery],
  );

  // Read by the open effect below without making it re-run per keystroke.
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  // After an option toggle (or an edit): re-run the current term with the
  // current options, or refuse and flag it when it does not compile.
  const reSearch = useCallback(() => {
    const query = searchQueryRef.current;
    if (query === "") {
      setRegexInvalid(false);
      return;
    }
    if (!queryCompiles(query, useRegexRef.current)) {
      setRegexInvalid(true);
      searchAddonRef.current?.clearDecorations();
      setSearchResult(null);
      return;
    }
    setRegexInvalid(false);
    runSearch("next", query, true);
  }, [runSearch]);

  const toggleCaseSensitive = useCallback(() => {
    const next = !caseSensitiveRef.current;
    caseSensitiveRef.current = next;
    setCaseSensitive(next);
    reSearch();
  }, [reSearch]);

  const toggleRegex = useCallback(() => {
    const next = !useRegexRef.current;
    useRegexRef.current = next;
    setUseRegex(next);
    reSearch();
  }, [reSearch]);

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
    // Closing cleared the decorations but kept the term (browser-style
    // prefill): paint its matches again. Incremental, so the active match
    // stays where it was instead of skipping ahead.
    const addon = searchAddonRef.current;
    const query = searchQueryRef.current;
    if (addon && query !== "" && queryCompiles(query, useRegexRef.current))
      addon.findNext(query, {
        decorations: SEARCH_DECORATIONS,
        incremental: true,
        caseSensitive: caseSensitiveRef.current,
        regex: useRegexRef.current,
      });
  }, [searchOpen]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchResult(null);
    searchAddonRef.current?.clearDecorations();
    termRef.current?.focus();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    const reportError = (error: unknown) => {
      if (!disposed) onErrorRef.current(describeError(error));
    };

    const term = new Terminal({
      theme: THEME,
      fontFamily: '"Cascadia Mono", "JetBrains Mono", Consolas, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10_000,
      allowProposedApi: true,
    });
    termRef.current = term;
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;
    const searchResultsSub = searchAddon.onDidChangeResults((result) => {
      // Reports arrive asynchronously — the term may have been cleared or
      // stopped compiling since the search went out. A late report must not
      // resurrect a stale counter next to the error hint.
      const query = searchQueryRef.current;
      if (query === "" || !queryCompiles(query, useRegexRef.current)) return;
      setSearchResult(result);
    });

    // Ctrl+Shift+F opens scrollback search, via xterm's own key handler
    // (fires before the PTY sees anything — a `window` listener is too
    // late to stop the byte). Plain Ctrl+F stays untouched: it is control
    // byte 0x06, bound by readline/less/vim for forward search/paging, and
    // this is an *agent* terminal — TUIs need their keys. Ctrl+Shift+F has
    // no such meaning and matches GNOME Terminal/Konsole/Windows Terminal's
    // find-in-terminal shortcut. `false` swallows the event, `true` (the
    // default) lets xterm process it as usual.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        // If the bar is already open, the `searchOpen` effect below won't
        // re-run (no state change) — pull focus/selection back into the
        // field directly for that case. Harmless when it was closed: the
        // input isn't mounted yet, so the ref is still null.
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return false;
      }
      return true;
    });

    // The session was spawned with a placeholder geometry. 0/0 guarantees the
    // first successful fit counts as a change.
    let lastCols = 0;
    let lastRows = 0;
    const applyFit = () => {
      if (disposed) return;
      try {
        fitAddon.fit();
      } catch {
        return; // container not laid out yet
      }
      const { cols, rows } = term;
      if (cols === lastCols && rows === lastRows) return;
      lastCols = cols;
      lastRows = rows;
      void resizePty(sessionId, cols, rows).catch(reportError);
    };
    const repaint = () => {
      if (!disposed) term.refresh(0, Math.max(0, term.rows - 1));
    };

    term.open(container);
    // One disposal shared by the context-loss callback and the unmount
    // cleanup: a second dispose after `term.dispose()` crashes inside xterm
    // ("reading '_isDisposed'"), and a context loss arriving after unmount
    // must not touch the renderer at all.
    let rendererDisposed = false;
    const disposeRenderer = (target: ITerminalAddon | null) => {
      if (rendererDisposed) return;
      rendererDisposed = true;
      target?.dispose();
    };
    // Declared before the callback so a (hypothetical) synchronous context
    // loss during loadRenderer can never hit the temporal dead zone.
    let renderer: ITerminalAddon | null = null;
    renderer = loadRenderer(term, () => {
      if (!disposed) disposeRenderer(renderer);
    });
    // Do not make the first visible frame wait on an IPC subscription or
    // scrollback replay. Both may legitimately take seconds after a restart.
    applyFit();
    repaint();

    const dataSub = term.onData((data) => {
      void writePty(sessionId, data).catch(reportError);
    });

    const resizeObserver = new ResizeObserver(() => {
      applyFit();
      repaint();
    });
    resizeObserver.observe(container);

    // Subscribe before fetching scrollback so nothing is dropped in between;
    // chunks that arrive during the fetch are buffered and flushed after the
    // replayed history.
    let live = false;
    const buffered: string[] = [];
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const stop = await onPtyOutput(sessionId, (chunk) => {
          if (disposed) return;
          if (live) term.write(chunk);
          else buffered.push(chunk);
        });
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;

        const scrollback = await getScrollback(sessionId);
        if (disposed) return;
        if (scrollback) term.write(scrollback);
      } catch (error) {
        reportError(error);
      } finally {
        if (!disposed) {
          live = true;
          for (const chunk of buffered.splice(0)) term.write(chunk);
          applyFit();
          repaint();
          term.focus();
        }
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
      resizeObserver.disconnect();
      dataSub.dispose();
      searchResultsSub.dispose();
      searchAddon.dispose();
      termRef.current = null;
      searchAddonRef.current = null;
      // xterm 5.5's `open()` queues `setTimeout(() => viewport.syncScrollArea())`
      // and never cancels it; once the Terminal is disposed that callback
      // reads the torn-down renderer's `dimensions` and throws. StrictMode
      // (and any fast tab switch) disposes within the mount's own task, so
      // the Terminal is only detached now and disposed in a later task:
      // timers of equal delay run in queue order, so xterm's runs first.
      // That holds only while `term.open()` stays synchronous in this
      // effect; moving it into an rAF or a promise would invert the order.
      // Detaching keeps a StrictMode remount on the same container from
      // showing two terminals until then.
      term.element?.remove();
      setTimeout(() => {
        // Each step contained on its own: a throw here would otherwise
        // escape this timer as a pageerror, and a renderer failure must
        // not skip the terminal's own dispose. Logged, not swallowed; the
        // view is gone, so there is no banner left to report to.
        try {
          // Before `term.dispose()`: xterm's renderer dispose needs the
          // terminal's store, which the terminal's own disposal clears.
          disposeRenderer(renderer);
        } catch (error) {
          console.error("TerminalView: disposing the renderer failed", error);
        }
        try {
          term.dispose();
        } catch (error) {
          console.error("TerminalView: disposing the terminal failed", error);
        }
      });
    };
  }, [sessionId]);

  // "1"-based for people, "?" once the addon stops indexing past its
  // highlight limit (`resultIndex === -1`, see the addon's own typings).
  // Empty until the addon has reported for the current term: "0/0" would
  // claim "no matches" before the search even answered.
  const counterText =
    searchQuery === "" || !searchResult
      ? ""
      : searchResult.resultCount === 0
        ? "0/0"
        : searchResult.resultIndex === -1
          ? `?/${searchResult.resultCount}`
          : `${searchResult.resultIndex + 1}/${searchResult.resultCount}`;

  return (
    <div className="terminal-view">
      {searchOpen ? (
        <div
          className="terminal-search-bar"
          role="search"
          aria-label="Suche im Terminal-Scrollback"
          onKeyDown={(event) => {
            // Handled here, not just on the input, so Escape also closes
            // the bar while a nav/close button has focus.
            if (event.key === "Escape") {
              event.preventDefault();
              closeSearch();
              return;
            }
            // Alt+C / Alt+R toggle the search options (VS Code's find
            // widget convention). Alt combos produce no PTY control byte,
            // and handling them on the container makes them work from any
            // control in the bar, same as Escape. Match on event.code, not
            // event.key: macOS types "ç"/"®" for Option+C/R and non-Latin
            // layouts move the letters; the physical key is stable.
            if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
              if (event.code === "KeyC") {
                event.preventDefault();
                toggleCaseSensitive();
              } else if (event.code === "KeyR") {
                event.preventDefault();
                toggleRegex();
              }
            }
          }}
        >
          <input
            ref={searchInputRef}
            type="text"
            className="terminal-search-input"
            aria-label="Suche im Terminal-Scrollback"
            aria-invalid={regexInvalid || undefined}
            placeholder="Suchen…"
            value={searchQuery}
            onChange={(event) => {
              const value = event.target.value;
              setSearchQuery(value);
              if (value === "") {
                setRegexInvalid(false);
                searchAddonRef.current?.clearDecorations();
                setSearchResult(null);
              } else if (!queryCompiles(value, useRegexRef.current)) {
                // Refuse instead of letting the addon throw on a pattern
                // that does not compile; the hint below says why.
                setRegexInvalid(true);
                searchAddonRef.current?.clearDecorations();
                setSearchResult(null);
              } else {
                setRegexInvalid(false);
                // Incremental: expands/moves the selection as the user
                // keeps typing a still-matching term, instead of the
                // cursor jumping to a fresh match on every keystroke.
                runSearch("next", value, true);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                runSearch(event.shiftKey ? "previous" : "next");
              }
            }}
          />
          <button
            type="button"
            className="button-ghost terminal-search-btn terminal-search-toggle"
            aria-label="Groß- und Kleinschreibung beachten"
            aria-pressed={caseSensitive}
            title="Groß- und Kleinschreibung beachten (Alt+C)"
            onClick={toggleCaseSensitive}
          >
            Aa
          </button>
          <button
            type="button"
            className="button-ghost terminal-search-btn terminal-search-toggle"
            aria-label="Regulärer Ausdruck"
            aria-pressed={useRegex}
            title="Regulärer Ausdruck (Alt+R)"
            onClick={toggleRegex}
          >
            .*
          </button>
          <span className="terminal-search-count" aria-live="polite">
            {counterText}
          </span>
          {regexInvalid ? (
            <span className="terminal-search-error" role="status">
              Ungültiger regulärer Ausdruck
            </span>
          ) : null}
          <button
            type="button"
            className="button-ghost terminal-search-btn"
            aria-label="Vorheriger Treffer"
            onClick={() => runSearch("previous")}
          >
            ↑
          </button>
          <button
            type="button"
            className="button-ghost terminal-search-btn"
            aria-label="Nächster Treffer"
            onClick={() => runSearch("next")}
          >
            ↓
          </button>
          <button
            type="button"
            className="button-ghost terminal-search-btn"
            aria-label="Suche schließen"
            onClick={closeSearch}
          >
            ✕
          </button>
        </div>
      ) : null}
      <div className="terminal-host" ref={containerRef} />
    </div>
  );
}
