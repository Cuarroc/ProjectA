import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TerminalView, { contrastRatio, SEARCH_DECORATIONS } from "./TerminalView";

const WebglAddonContexts = () => mocks.webglContexts;

const mocks = vi.hoisted(() => ({
  fit: vi.fn(),
  focus: vi.fn(),
  open: vi.fn(),
  refresh: vi.fn(),
  resizePty: vi.fn(),
  onPtyOutput: vi.fn(),
  webglContexts: [] as Array<{ loss: () => void; disposed: number }>,
  // Captures the handler TerminalView registers with
  // `term.attachCustomKeyEventHandler`, so tests can drive it the same way
  // xterm does: before the keystroke ever reaches the PTY.
  customKeyEventHandler: null as ((event: KeyboardEvent) => boolean) | null,
  // Captures the callback TerminalView passes to `onDidChangeResults`, so a
  // test can simulate the addon reporting a match the same way it does at
  // runtime — asynchronously, after a search.
  searchResultsCallback: null as ((result: { resultIndex: number; resultCount: number }) => void) | null,
  searchResultsSubDispose: vi.fn(),
  // Models xterm 5.5's `Viewport`: `open()` queues
  // `setTimeout(() => this.syncScrollArea())`, and that callback reads the
  // render service's `dimensions`, which `dispose()` has already torn down.
  // Collected instead of thrown so every test sees it, not just the one
  // whose timer happened to fire.
  viewportErrors: [] as string[],
  terminals: [] as Array<{ disposed: number }>,
  // Makes the next `dispose()` of the WebGL renderer / the Terminal throw,
  // for the deferred-dispose containment tests (PR #151 review K1/G1).
  disposeThrows: { renderer: false, terminal: false },
  searchAddon: {
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    clearDecorations: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    element: HTMLElement | undefined;
    private tracker = { disposed: 0 };

    constructor() {
      mocks.terminals.push(this.tracker);
    }
    loadAddon() {}
    open(container: HTMLElement) {
      mocks.open(container);
      this.element = document.createElement("div");
      this.element.className = "xterm";
      container.appendChild(this.element);
      setTimeout(() => {
        if (this.tracker.disposed > 0) {
          mocks.viewportErrors.push("Cannot read properties of undefined (reading 'dimensions')");
        }
      });
    }
    onData() {
      return { dispose: vi.fn() };
    }
    write() {}
    focus() {
      mocks.focus();
    }
    refresh(start: number, end: number) {
      mocks.refresh(start, end);
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      mocks.customKeyEventHandler = handler;
    }
    dispose() {
      this.tracker.disposed += 1;
      if (mocks.disposeThrows.terminal) throw new Error("terminal dispose failed");
      this.element?.remove();
    }
  },
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext(...args: unknown[]) {
      return mocks.searchAddon.findNext(...args);
    }
    findPrevious(...args: unknown[]) {
      return mocks.searchAddon.findPrevious(...args);
    }
    clearDecorations() {
      mocks.searchAddon.clearDecorations();
    }
    onDidChangeResults(callback: (result: { resultIndex: number; resultCount: number }) => void) {
      mocks.searchResultsCallback = callback;
      return { dispose: () => mocks.searchResultsSubDispose() };
    }
    dispose() {
      mocks.searchAddon.dispose();
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {
      mocks.fit();
    }
  },
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    private tracker = { loss: (): void => undefined, disposed: 0 };
    constructor() {
      mocks.webglContexts.push(this.tracker);
    }
    onContextLoss(callback: () => void) {
      this.tracker.loss = callback;
    }
    dispose() {
      this.tracker.disposed += 1;
      if (mocks.disposeThrows.renderer) throw new Error("renderer dispose failed");
    }
  },
}));

vi.mock("@xterm/addon-canvas", () => ({
  CanvasAddon: class {
    dispose() {}
  },
}));

vi.mock("../lib/ipc", () => ({
  describeError: (cause: unknown) => String(cause),
  getScrollback: vi.fn(),
  onPtyOutput: (...args: unknown[]) => mocks.onPtyOutput(...args),
  resizePty: (...args: unknown[]) => mocks.resizePty(...args),
  writePty: vi.fn(),
}));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

describe("TerminalView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    WebglAddonContexts().length = 0;
    mocks.customKeyEventHandler = null;
    mocks.searchResultsCallback = null;
    mocks.viewportErrors.length = 0;
    mocks.terminals.length = 0;
    mocks.disposeThrows.renderer = false;
    mocks.disposeThrows.terminal = false;
    mocks.onPtyOutput.mockReturnValue(new Promise(() => undefined));
    mocks.resizePty.mockResolvedValue(undefined);
  });

  /** Fires the handler TerminalView gave `attachCustomKeyEventHandler`. */
  function pressCustomKey(init: Partial<KeyboardEventInit> & { key: string }): boolean {
    expect(mocks.customKeyEventHandler).toBeTypeOf("function");
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    let consumed = true;
    act(() => {
      consumed = mocks.customKeyEventHandler!(event);
    });
    return consumed;
  }

  it("fits and repaints immediately instead of waiting for scrollback", () => {
    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);

    expect(mocks.open).toHaveBeenCalledOnce();
    expect(mocks.fit).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledWith(0, 23);
  });

  it("disposes the WebGL renderer exactly once when context loss precedes unmount", () => {
    // Dev-build crash "reading '_isDisposed'": xterm's WebglAddon reads
    // `terminal._core._store._isDisposed` during dispose; once the Terminal
    // is gone that store is undefined, so a second dispose throws. The
    // context-loss handler and the unmount cleanup must share one disposal.
    const { unmount } = render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
    const webgl = WebglAddonContexts().at(-1);
    expect(webgl).toBeDefined();

    webgl!.loss(); // GPU context lost while the view is alive
    expect(webgl!.disposed).toBe(1);

    unmount();
    expect(webgl!.disposed).toBe(1);
  });

  it("StrictMode-Mount entsorgt das Terminal erst nach xterms eigenem Viewport-Timer", () => {
    // W1-21c: StrictMode mounts, cleans up and remounts in one task. The
    // first Terminal was disposed before the `syncScrollArea` timer its
    // `open()` had queued, and that timer threw the `pageerror`
    // "reading 'dimensions'" (measured in Chromium, see
    // e2e/terminal-view.mount.spec.ts).
    vi.useFakeTimers();
    try {
      const { container, unmount } = render(
        <StrictMode>
          <TerminalView sessionId="session-a" onError={vi.fn()} />
        </StrictMode>,
      );
      // The cleaned-up Terminal waits for its dispose detached, so the
      // remount on the same host never shows two terminals meanwhile.
      expect(container.querySelectorAll(".terminal-host .xterm")).toHaveLength(1);
      unmount();
      act(() => {
        vi.runAllTimers();
      });

      expect(mocks.viewportErrors).toEqual([]);
      // Deferred, not skipped: every Terminal is still disposed exactly once.
      expect(mocks.terminals.length).toBe(2);
      expect(mocks.terminals.map((terminal) => terminal.disposed)).toEqual([1, 1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ein werfender Renderer-Dispose im verzögerten Abbau entsorgt das Terminal trotzdem", () => {
    // PR #151 review (kimi-k3 #1, glm-5.2 #1): the deferred dispose runs in
    // a bare timer callback. A throw there must neither skip `term.dispose()`
    // (leaking the detached Terminal) nor escape as the very pageerror this
    // package removes. It stays visible on the console.
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      mocks.disposeThrows.renderer = true;
      const { unmount } = render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
      unmount();

      expect(() =>
        act(() => {
          vi.runAllTimers();
        }),
      ).not.toThrow();
      expect(mocks.terminals.map((terminal) => terminal.disposed)).toEqual([1]);
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), expect.any(Error));
    } finally {
      consoleError.mockRestore();
      vi.useRealTimers();
    }
  });

  it("ein werfender Terminal-Dispose im verzögerten Abbau entkommt nicht als Seitenfehler", () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      mocks.disposeThrows.terminal = true;
      const { unmount } = render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
      unmount();

      expect(() =>
        act(() => {
          vi.runAllTimers();
        }),
      ).not.toThrow();
      expect(WebglAddonContexts().at(-1)?.disposed).toBe(1);
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), expect.any(Error));
    } finally {
      consoleError.mockRestore();
      vi.useRealTimers();
    }
  });

  it("ignores a context loss that arrives after unmount", () => {
    // Same crash class from the other side: the GPU callback firing after
    // the Terminal was disposed must not touch the renderer at all.
    const { unmount } = render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
    const webgl = WebglAddonContexts().at(-1);
    expect(webgl).toBeDefined();

    unmount();
    const before = webgl!.disposed;
    expect(() => webgl!.loss()).not.toThrow();
    expect(webgl!.disposed).toBe(before);
  });

  it("Ctrl Shift F öffnet die Suche und zieht Fokus rein", () => {
    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);

    const consumed = pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });

    expect(consumed).toBe(false); // xterm darf das Byte nicht an die PTY weiterreichen
    expect(screen.getByRole("search", { name: /suche/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /suche/i })).toBeInTheDocument();
  });

  it("lässt Ctrl F unangetastet an die TUI durch", () => {
    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);

    const consumed = pressCustomKey({ key: "f", code: "KeyF", ctrlKey: true, shiftKey: false });

    expect(consumed).toBe(true); // von xterm normal weiterverarbeiten lassen
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
  });

  it("Escape schließt die Suche und gibt den Fokus zurück ans Terminal", () => {
    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
    const input = screen.getByRole("textbox", { name: /suche/i });

    mocks.focus.mockClear();
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(mocks.searchAddon.clearDecorations).toHaveBeenCalled();
    expect(mocks.focus).toHaveBeenCalled();
  });

  it("Escape schließt die Suche auch wenn ein Button fokussiert ist", () => {
    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
    const closeButton = screen.getByRole("button", { name: /schließen/i });

    // Escape bubbles from whichever control has focus to the role="search"
    // container, not only from the text input.
    fireEvent.keyDown(closeButton, { key: "Escape" });

    expect(screen.queryByRole("search")).not.toBeInTheDocument();
  });

  it("Enter sucht den nächsten Treffer", () => {
    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
    const input = screen.getByRole("textbox", { name: /suche/i });

    fireEvent.change(input, { target: { value: "fehler" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.searchAddon.findNext).toHaveBeenCalledWith("fehler", expect.anything());
  });

  it("Shift Enter sucht den vorherigen Treffer", () => {
    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
    const input = screen.getByRole("textbox", { name: /suche/i });

    fireEvent.change(input, { target: { value: "fehler" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(mocks.searchAddon.findPrevious).toHaveBeenCalledWith("fehler", expect.anything());
  });

  it("Tippen sucht inkrementell statt bei jedem Zeichen neu zu springen", () => {
    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
    const input = screen.getByRole("textbox", { name: /suche/i });

    fireEvent.change(input, { target: { value: "fehler" } });

    expect(mocks.searchAddon.findNext).toHaveBeenCalledWith(
      "fehler",
      expect.objectContaining({ incremental: true }),
    );
  });

  it("Ctrl Shift F holt bei bereits offener Suche Fokus und Auswahl zurück ins Feld", () => {
    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
    const input = screen.getByRole("textbox", { name: /suche/i }) as HTMLInputElement;
    const select = vi.spyOn(input, "select");
    input.blur();

    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });

    expect(document.activeElement).toBe(input);
    expect(select).toHaveBeenCalled();
  });

  it("ein Treffer aktualisiert den Zähler per aria-live", () => {
    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
    const input = screen.getByRole("textbox", { name: /suche/i });
    fireEvent.change(input, { target: { value: "fehler" } });

    expect(mocks.searchResultsCallback).toBeTypeOf("function");
    act(() => {
      mocks.searchResultsCallback!({ resultIndex: 0, resultCount: 3 });
    });

    const counter = document.querySelector(".terminal-search-count[aria-live='polite']");
    expect(counter).not.toBeNull();
    expect(counter).toHaveTextContent("1/3");
  });

  it("über dem Anzeige-Limit zeigt der Zähler ein Fragezeichen statt eines falschen Index", () => {
    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
    const input = screen.getByRole("textbox", { name: /suche/i });
    fireEvent.change(input, { target: { value: "fehler" } });

    // addon-search reports resultIndex -1 once the highlight limit is
    // exceeded — it is not "no match", so the counter must not read "0/n".
    act(() => {
      mocks.searchResultsCallback!({ resultIndex: -1, resultCount: 1200 });
    });

    expect(document.querySelector(".terminal-search-count")).toHaveTextContent("?/1200");
  });

  it("kein Treffer zeigt 0 von 0 statt eines Fragezeichens", () => {
    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
    fireEvent.change(screen.getByRole("textbox", { name: /suche/i }), { target: { value: "gibtsnicht" } });

    // addon-search reports "no match" as resultIndex -1 with resultCount 0 —
    // the same -1 it uses past the highlight limit.
    act(() => {
      mocks.searchResultsCallback!({ resultIndex: -1, resultCount: 0 });
    });

    expect(document.querySelector(".terminal-search-count")).toHaveTextContent("0/0");
  });

  it("Wiederöffnen belegt den letzten Suchbegriff vor und markiert seine Treffer erneut", () => {
    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
    fireEvent.change(screen.getByRole("textbox", { name: /suche/i }), { target: { value: "fehler" } });
    act(() => {
      mocks.searchResultsCallback!({ resultIndex: 0, resultCount: 3 });
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: /suche/i }), { key: "Escape" });
    mocks.searchAddon.findNext.mockClear();

    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });

    // Closing cleared the decorations; reopening with the kept term must
    // paint them again (incremental: the cursor stays on the same match),
    // otherwise the bar shows a term with no highlights next to it.
    expect(screen.getByRole("textbox", { name: /suche/i })).toHaveValue("fehler");
    // Without `decorations` the addon selects a match but paints none.
    expect(mocks.searchAddon.findNext).toHaveBeenCalledWith("fehler", {
      decorations: SEARCH_DECORATIONS,
      incremental: true,
      caseSensitive: false,
      regex: false,
    });
  });

  it("Wiederöffnen zeigt keinen falschen Zähler 0 von 0 solange die Suche läuft", () => {
    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
    fireEvent.change(screen.getByRole("textbox", { name: /suche/i }), { target: { value: "fehler" } });
    act(() => {
      mocks.searchResultsCallback!({ resultIndex: 0, resultCount: 3 });
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: /suche/i }), { key: "Escape" });

    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });

    // Closing reset the result; until the reopened search has reported
    // (synchronously, but only from the effect after this render), "0/0"
    // would claim "no matches" for a term that had three a moment ago.
    expect(document.querySelector(".terminal-search-count")).not.toHaveTextContent("0/0");
  });

  it("leerer Suchbegriff beim Wiederöffnen löst keine Suche aus", () => {
    render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(screen.getByRole("textbox", { name: /suche/i }), { key: "Escape" });

    pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });

    expect(mocks.searchAddon.findNext).not.toHaveBeenCalled();
    expect(document.querySelector(".terminal-search-count")).toHaveTextContent("");
  });

  it("Schließen der Ansicht entsorgt das Search-Addon und sein Ergebnis-Abo", () => {
    const { unmount } = render(<TerminalView sessionId="session-a" onError={vi.fn()} />);

    unmount();

    expect(mocks.searchAddon.dispose).toHaveBeenCalledOnce();
    expect(mocks.searchResultsSubDispose).toHaveBeenCalledOnce();
  });

  describe("Schalter für die Suchoptionen", () => {
    /** Mounts the view and opens the search bar; returns the search input. */
    function openSearch() {
      render(<TerminalView sessionId="session-a" onError={vi.fn()} />);
      pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
      return screen.getByRole("textbox", { name: /suche/i });
    }

    it("der Schalter für Groß- und Kleinschreibung reicht caseSensitive an die Suche durch", () => {
      const input = openSearch();
      fireEvent.change(input, { target: { value: "Fehler" } });
      mocks.searchAddon.findNext.mockClear();

      fireEvent.click(screen.getByRole("button", { name: /groß- und kleinschreibung/i }));

      expect(mocks.searchAddon.findNext).toHaveBeenCalledWith(
        "Fehler",
        expect.objectContaining({ caseSensitive: true }),
      );
    });

    it("der Regex-Schalter reicht die Regex-Option an die Suche durch", () => {
      const input = openSearch();
      fireEvent.change(input, { target: { value: "feh+er" } });
      mocks.searchAddon.findNext.mockClear();

      fireEvent.click(screen.getByRole("button", { name: /regulärer ausdruck/i }));

      expect(mocks.searchAddon.findNext).toHaveBeenCalledWith(
        "feh+er",
        expect.objectContaining({ regex: true }),
      );
    });

    it("umschalten bei vorhandenem Begriff sucht inkrementell erneut", () => {
      const input = openSearch();
      fireEvent.change(input, { target: { value: "fehler" } });
      mocks.searchAddon.findNext.mockClear();

      fireEvent.click(screen.getByRole("button", { name: /groß- und kleinschreibung/i }));

      // Incremental like typing: the active match must not skip ahead just
      // because an option changed.
      expect(mocks.searchAddon.findNext).toHaveBeenCalledWith(
        "fehler",
        expect.objectContaining({ incremental: true }),
      );
    });

    it("die Schalter behalten ihren Zustand beim Wiederöffnen", () => {
      const input = openSearch();
      fireEvent.click(screen.getByRole("button", { name: /groß- und kleinschreibung/i }));
      fireEvent.change(input, { target: { value: "Fehler" } });
      fireEvent.keyDown(input, { key: "Escape" });
      mocks.searchAddon.findNext.mockClear();

      pressCustomKey({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });

      // Same convention as the kept search term (browser find bars): the
      // toggles survive close/reopen, and the repaint search uses them.
      expect(mocks.searchAddon.findNext).toHaveBeenCalledWith(
        "Fehler",
        expect.objectContaining({ caseSensitive: true, regex: false }),
      );
    });

    it("ein ungültiger Regex löst keine Suche aus und meldet den Fehler", () => {
      const input = openSearch();
      fireEvent.click(screen.getByRole("button", { name: /regulärer ausdruck/i }));
      mocks.searchAddon.findNext.mockClear();

      // "[" never compiles; handing it to the addon would throw inside
      // xterm. The bar must refuse the search and say why instead.
      fireEvent.change(input, { target: { value: "[" } });

      expect(mocks.searchAddon.findNext).not.toHaveBeenCalled();
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("status")).toHaveTextContent(/ungültig/i);

      fireEvent.change(input, { target: { value: "[a]" } });

      expect(mocks.searchAddon.findNext).toHaveBeenCalledWith(
        "[a]",
        expect.objectContaining({ regex: true }),
      );
      expect(input).not.toHaveAttribute("aria-invalid", "true");
    });

    it("Alt C und Alt R schalten die Suchoptionen per Tastatur um", () => {
      const input = openSearch();
      const caseToggle = screen.getByRole("button", { name: /groß- und kleinschreibung/i });
      const regexToggle = screen.getByRole("button", { name: /regulärer ausdruck/i });

      fireEvent.keyDown(input, { key: "c", code: "KeyC", altKey: true });
      expect(caseToggle).toHaveAttribute("aria-pressed", "true");
      expect(regexToggle).toHaveAttribute("aria-pressed", "false");

      // Works from a button's focus too, not only from the input — handled
      // on the role="search" container, same as Escape.
      fireEvent.keyDown(caseToggle, { key: "r", code: "KeyR", altKey: true });
      expect(regexToggle).toHaveAttribute("aria-pressed", "true");

      fireEvent.keyDown(input, { key: "c", code: "KeyC", altKey: true });
      expect(caseToggle).toHaveAttribute("aria-pressed", "false");
    });

    it("Alt C und Alt R wirken layoutunabhängig über event.code", () => {
      const input = openSearch();
      const caseToggle = screen.getByRole("button", { name: /groß- und kleinschreibung/i });
      const regexToggle = screen.getByRole("button", { name: /regulärer ausdruck/i });

      // macOS types "ç" for Option+C and "®" for Option+R; non-Latin
      // layouts map the letters elsewhere too. Only event.code names the
      // physical key on every platform the app ships to.
      fireEvent.keyDown(input, { key: "ç", code: "KeyC", altKey: true });
      expect(caseToggle).toHaveAttribute("aria-pressed", "true");

      fireEvent.keyDown(input, { key: "®", code: "KeyR", altKey: true });
      expect(regexToggle).toHaveAttribute("aria-pressed", "true");
    });

    it("Regex abschalten bei ungültigem Muster nimmt den Fehler und sucht literal", () => {
      const input = openSearch();
      fireEvent.click(screen.getByRole("button", { name: /regulärer ausdruck/i }));
      fireEvent.change(input, { target: { value: "[" } });
      expect(input).toHaveAttribute("aria-invalid", "true");
      mocks.searchAddon.findNext.mockClear();

      fireEvent.click(screen.getByRole("button", { name: /regulärer ausdruck/i }));

      // "[" is a fine literal term: the hint goes and the kept term
      // re-searches with regex off.
      expect(input).not.toHaveAttribute("aria-invalid", "true");
      expect(document.querySelector(".terminal-search-error")).toBeNull();
      expect(mocks.searchAddon.findNext).toHaveBeenCalledWith(
        "[",
        expect.objectContaining({ regex: false }),
      );
    });

    it("Enter und Pfeil-Buttons suchen bei ungültigem Regex nicht", () => {
      const input = openSearch();
      fireEvent.click(screen.getByRole("button", { name: /regulärer ausdruck/i }));
      fireEvent.change(input, { target: { value: "[" } });
      mocks.searchAddon.findNext.mockClear();
      mocks.searchAddon.findPrevious.mockClear();

      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.click(screen.getByRole("button", { name: /nächster treffer/i }));
      fireEvent.click(screen.getByRole("button", { name: /vorheriger treffer/i }));

      // Every path into the addon must refuse the pattern — the addon would
      // throw inside xterm — and the hint stays up to say why nothing moves.
      expect(mocks.searchAddon.findNext).not.toHaveBeenCalled();
      expect(mocks.searchAddon.findPrevious).not.toHaveBeenCalled();
      expect(document.querySelector(".terminal-search-error")).not.toBeNull();
    });

    it("ungültiger Regex leert Dekorationen und Zähler", () => {
      const input = openSearch();
      fireEvent.click(screen.getByRole("button", { name: /regulärer ausdruck/i }));
      fireEvent.change(input, { target: { value: "fehler" } });
      act(() => {
        mocks.searchResultsCallback!({ resultIndex: 0, resultCount: 2 });
      });
      expect(document.querySelector(".terminal-search-count")).toHaveTextContent("1/2");
      mocks.searchAddon.clearDecorations.mockClear();

      fireEvent.change(input, { target: { value: "[" } });

      // Stale highlights next to an error hint would claim matches the
      // current term never produced.
      expect(mocks.searchAddon.clearDecorations).toHaveBeenCalled();
      expect(document.querySelector(".terminal-search-count")).toHaveTextContent("");
    });

    it("verspätetes Ergebnis bei ungültigem Regex stellt den Zähler nicht wieder her", () => {
      const input = openSearch();
      fireEvent.click(screen.getByRole("button", { name: /regulärer ausdruck/i }));
      fireEvent.change(input, { target: { value: "[" } });
      expect(document.querySelector(".terminal-search-count")).toHaveTextContent("");

      // The addon reports asynchronously; a result for a search issued
      // while the pattern still compiled must not resurrect a counter next
      // to the error hint (observed in a real browser: stale "0/0").
      act(() => {
        mocks.searchResultsCallback!({ resultIndex: -1, resultCount: 0 });
      });

      expect(document.querySelector(".terminal-search-count")).toHaveTextContent("");
    });

    it("verspätetes Ergebnis bei geleertem Begriff stellt den Zähler nicht wieder her", () => {
      const input = openSearch();
      fireEvent.change(input, { target: { value: "fehler" } });
      fireEvent.change(input, { target: { value: "" } });
      expect(document.querySelector(".terminal-search-count")).toHaveTextContent("");

      act(() => {
        mocks.searchResultsCallback!({ resultIndex: 0, resultCount: 3 });
      });

      expect(document.querySelector(".terminal-search-count")).toHaveTextContent("");
    });

    it("Enter nach dem Umschalten nutzt die neuen Optionen", () => {
      const input = openSearch();
      fireEvent.change(input, { target: { value: "Fehler" } });
      fireEvent.click(screen.getByRole("button", { name: /groß- und kleinschreibung/i }));
      mocks.searchAddon.findNext.mockClear();

      fireEvent.keyDown(input, { key: "Enter" });

      expect(mocks.searchAddon.findNext).toHaveBeenCalledWith(
        "Fehler",
        expect.objectContaining({ caseSensitive: true, regex: false }),
      );
    });
  });

  describe("Kontrast der Treffer-Hervorhebung", () => {
    // #RRGGBB, weil addon-search laut Typings nur dieses Format akzeptiert
    // (Alpha wird stillschweigend verworfen) — eine transluzente Farbe wäre
    // ein stiller Kontrastverlust, den kein Gate sieht, weil
    // scripts/contrast-check.mjs nur src/styles.css prüft, nicht diese
    // Datei. THEME.foreground ist die Textfarbe, die der Terminal-Renderer
    // über jeden Treffer malt.
    const FOREGROUND = "#cccccc";

    it("matchBackground hält WCAG AA gegen den Terminal-Vordergrund", () => {
      expect(contrastRatio(FOREGROUND, SEARCH_DECORATIONS.matchBackground)).toBeGreaterThanOrEqual(4.5);
    });

    it("activeMatchBackground hält WCAG AA gegen den Terminal-Vordergrund", () => {
      expect(contrastRatio(FOREGROUND, SEARCH_DECORATIONS.activeMatchBackground)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
