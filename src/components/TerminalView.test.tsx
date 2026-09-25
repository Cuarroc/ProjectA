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
