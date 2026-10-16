import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("../../components/TerminalView", () => ({ default: () => null }));

import App from "../../App";
import { de } from "../../i18n/de";
import { writeActiveProjectId } from "../../lib/activeProject";
import LeitstandRoute from "./LeitstandRoute";

const FLAG_KEY = "projecta.settings.featureFlag.d1_neue_oberflaeche";
const NOW = Math.floor(Date.now() / 1000);
const worker = { id: "w1", projectId: "p1", task: "Fix the start block", profileId: "claude", branch: "claude/w1", worktreePath: "wt", sessionId: null, status: "running", createdAt: NOW - 600 };
const question = { id: "q1", projectId: "p1", workerId: "w1", scope: "worker", question: "Cover only this case?", optionsJson: '["Only this case"]', status: "open", answer: null, createdAt: NOW - 240, expiresAt: null };
/** The tab row of the Leitstand itself; the shell frame has its own "Haupt" link. */
const tabs = () => within(screen.getByRole("navigation", { name: "Ansichten" }));
/** The implementation to wrap, captured before it is replaced; a never-answering stub when none is set. */
const currentInvoke = (): ((command: string) => unknown) => mocks.invoke.getMockImplementation() ?? (() => new Promise(() => {}));
const go = (hash: string) => act(() => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent("hashchange")); });

// App loads the shell through React.lazy. Its first import transforms the whole shell module graph,
// which under CPU load outran the 1 s findBy default of whichever test rendered first. Pay that
// once here (hookTimeout), so every test measures only the IPC round trips.
beforeAll(async () => { await import("../../shell/mount/ShellMount"); });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("projecta.activeProjectId", "p1");
  window.location.hash = "";
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "list_workers") return Promise.resolve([]);
    // The old app forgets a stored project that is not in the list, so p1 has to exist.
    if (command === "list_projects") return Promise.resolve([{ id: "p1", name: "Demo", path: "demo", createdAt: NOW }]);
    if (command === "list_agent_profiles") return Promise.resolve([{ id: "claude", name: "Claude Code" }]);
    if (command === "list_questions") return Promise.resolve([question]);
    if (command === "get_board_state") {
      return Promise.resolve({ cards: [{ worker, column: "needs_you", attention_reason: "Fragt", attention_code: "agent_reported", attention_grade: "blocking", pr_url: null }], coordinators: [] });
    }
    if (command === "list_queue") return Promise.resolve([]);
    if (command === "get_resource_snapshot") return Promise.resolve({ observedAt: 1, cpuPermille: null, ramProcessBytes: null, ramTotalBytes: null, diskAppBytes: null, diskFreeBytes: null, tokensIn: 0, tokensOut: 0 });
    if (command === "get_panic_notice") return Promise.resolve({ current: null, previous: null });
    if (command === "get_reason_catalog") return Promise.resolve([]);
    return new Promise(() => {});
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Leitstand route behind D1", () => {
  it("shows the cards and the Braucht dich list from the real board and question data at /leitstand", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    const { container } = render(<App />);
    const agents = await screen.findByRole("region", { name: "Agenten" });
    expect(await within(agents).findByRole("heading", { name: "Claude Code" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Braucht dich/ })).toHaveTextContent("1"));
    const needs = await screen.findByRole("complementary", { name: "Braucht dich" });
    expect(await within(needs).findByText("Cover only this case?")).toBeInTheDocument();
    expect(container.querySelector(".g-mount-legacy")).toHaveAttribute("hidden");
  });

  it("says so when the agent profiles cannot be loaded and keeps the cards usable", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    const base = currentInvoke();
    mocks.invoke.mockImplementation((command: string) =>
      command === "list_agent_profiles" ? Promise.reject(new Error("backend down")) : base(command));
    render(<App />);
    const agents = await screen.findByRole("region", { name: "Agenten" });
    expect(await screen.findByText("Agenten konnten nicht geladen werden")).toBeInTheDocument();
    // Without profiles the card falls back to the profile id as its name.
    expect(await within(agents).findByRole("heading", { name: "claude" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Braucht dich/ })).toHaveTextContent("1"));
  });

  // DS-T-01: only a read board may say "no agents".
  it("main view says nothing is empty while the board is loading", async () => {
    const base = currentInvoke();
    mocks.invoke.mockImplementation((command: string) =>
      command === "get_board_state" ? new Promise(() => {}) : base(command));
    render(<LeitstandRoute />);
    expect(await screen.findByText("Agenten werden gelesen …")).toBeInTheDocument();
    expect(screen.queryByText(de["leitstand.emptyTitle"])).toBeNull();
  });

  it("main view offers a retry when the board cannot be read", async () => {
    const base = currentInvoke();
    let down = true;
    mocks.invoke.mockImplementation((command: string) =>
      command === "get_board_state" && down ? Promise.reject(new Error("backend down")) : base(command));
    render(<LeitstandRoute />);
    const retry = await screen.findByRole("button", { name: "Erneut lesen" });
    expect(screen.getByText(de["honest.offline"])).toBeInTheDocument();
    expect(screen.queryByText(de["leitstand.emptyTitle"])).toBeNull();
    down = false;
    fireEvent.click(retry);
    const agents = await screen.findByRole("region", { name: "Agenten" });
    expect(await within(agents).findByRole("heading", { name: "Claude Code" })).toBeInTheDocument();
  });

  it("main view without a project asks for a project", async () => {
    localStorage.removeItem("projecta.activeProjectId");
    render(<LeitstandRoute />);
    const note = within(await screen.findByRole("status"));
    expect(note.getByText("Kein Projekt gewählt")).toBeInTheDocument();
    expect(screen.queryByText(de["leitstand.emptyTitle"])).toBeNull();
    expect(screen.queryByText(de["needs.none"])).toBeNull();
    await act(async () => { writeActiveProjectId("p1"); });
    expect(await screen.findByRole("region", { name: "Agenten" })).toBeInTheDocument();
  });

  // DS-T-05: the empty main view names the first step and only navigates; it starts nothing.
  it("an empty board offers Auftrag einreihen and opens the Betrieb tab", async () => {
    const base = currentInvoke();
    mocks.invoke.mockImplementation((command: string) =>
      command === "get_board_state" ? Promise.resolve({ cards: [], coordinators: [] }) : base(command));
    render(<LeitstandRoute />);
    const step = await screen.findByRole("button", { name: "Auftrag einreihen" });
    expect(screen.getByText(de["leitstand.emptyTitle"])).toBeInTheDocument();
    fireEvent.click(step);
    expect(window.location.hash).toBe("#/leitstand/betrieb");
  });

  it("without a project the main view offers Projekt anlegen", async () => {
    localStorage.removeItem("projecta.activeProjectId");
    render(<LeitstandRoute />);
    const step = within(await screen.findByRole("status")).getByRole("button", { name: "Projekt anlegen" });
    fireEvent.click(step);
    // The old sidebar with "Projekt hinzufügen" is only shown on the Werkzeuge tab.
    expect(window.location.hash).toBe("#/leitstand/werkzeuge");
  });

  it("main view keeps the cards and says so when a refresh fails", async () => {
    vi.useFakeTimers();
    const base = currentInvoke();
    let down = false;
    mocks.invoke.mockImplementation((command: string) =>
      command === "get_board_state" && down ? Promise.reject(new Error("backend down")) : base(command));
    render(<LeitstandRoute />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("heading", { name: "Claude Code" })).toBeInTheDocument();
    down = true;
    await act(() => vi.advanceTimersByTimeAsync(5000)); // the board's poll
    expect(screen.getByText("Aktualisierung fehlgeschlagen")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Agenten" })).getByRole("heading", { name: "Claude Code" })).toBeInTheDocument();
  });

  it("picks up the project the old app chooses after this route has mounted", async () => {
    localStorage.removeItem("projecta.activeProjectId");
    localStorage.setItem(FLAG_KEY, "1");
    render(<App />);
    expect(await screen.findByRole("region", { name: "Agenten" })).toBeInTheDocument();
  });

  it("follows the active-project event without a single polling timer", async () => {
    localStorage.removeItem("projecta.activeProjectId");
    vi.useFakeTimers();
    render(<LeitstandRoute />);
    await act(async () => {});
    expect(mocks.invoke).not.toHaveBeenCalledWith("list_questions", expect.anything());
    expect(vi.getTimerCount()).toBe(1); // only the age tick; no project poll
    await act(async () => { writeActiveProjectId("p1"); });
    expect(mocks.invoke).toHaveBeenCalledWith("list_questions", expect.objectContaining({ projectId: "p1" }));
  });

  it("keeps the old Work view reachable as the tab Klassisch", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    const { container } = render(<App />);
    await screen.findByRole("region", { name: "Agenten" });
    fireEvent.click(screen.getByRole("link", { name: "Klassisch" }));
    await waitFor(() => expect(window.location.hash).toBe("#/leitstand/klassisch"));
    await waitFor(() => expect(container.querySelector(".g-mount-legacy:not([hidden]) > .app")).not.toBeNull());
    expect(screen.queryByRole("region", { name: "Agenten" })).toBeNull();
    expect(screen.getByRole("link", { name: "Klassisch" })).toHaveAttribute("aria-current", "page");
  });

  it("opens the old Work view directly at /leitstand/klassisch", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    window.location.hash = "#/leitstand/klassisch";
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".g-mount-legacy:not([hidden]) > .app")).not.toBeNull());
    expect(screen.queryByRole("region", { name: "Agenten" })).toBeNull();
    await go("#/leitstand");
    expect(await screen.findByRole("region", { name: "Agenten" })).toBeInTheDocument();
  });

  it("renders the Betrieb panel at /leitstand/betrieb and marks its tab as the current one", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    window.location.hash = "#/leitstand/betrieb";
    const { container } = render(<App />);
    expect(await screen.findByRole("region", { name: "Warteschlange" })).toBeInTheDocument();
    expect(tabs().getByRole("link", { name: "Betrieb" })).toHaveAttribute("aria-current", "page");
    expect(tabs().getByRole("link", { name: "Haupt" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("region", { name: "Agenten" })).toBeNull();
    expect(container.querySelector(".g-mount-legacy")).toHaveAttribute("hidden");
  });

  it("betrieb without a project shows an empty state", async () => {
    localStorage.removeItem("projecta.activeProjectId");
    render(<LeitstandRoute path="/leitstand/betrieb" />);
    const note = within(await screen.findByRole("status"));
    expect(note.getByText("Kein Projekt gewählt")).toBeInTheDocument();
    expect(note.getByText("Wähle oben ein Projekt, dann erscheint hier der Betrieb.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Warteschlange" })).toBeNull();
    // Choosing a project replaces the note by the panel.
    await act(async () => { writeActiveProjectId("p1"); });
    expect(await screen.findByRole("region", { name: "Warteschlange" })).toBeInTheDocument();
    expect(screen.queryByText("Kein Projekt gewählt")).toBeNull();
  });

  it("reaches Betrieb from Haupt by its tab link and goes back", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    render(<App />);
    await screen.findByRole("region", { name: "Agenten" });
    expect(tabs().getByRole("link", { name: "Haupt" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(tabs().getByRole("link", { name: "Betrieb" }));
    await waitFor(() => expect(window.location.hash).toBe("#/leitstand/betrieb"));
    expect(await screen.findByRole("region", { name: "Warteschlange" })).toBeInTheDocument();
    fireEvent.click(tabs().getByRole("link", { name: "Haupt" }));
    expect(await screen.findByRole("region", { name: "Agenten" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Warteschlange" })).toBeNull();
  });

  it("renders the flow graph at /leitstand/fabrik and marks its tab as the current one", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    window.location.hash = "#/leitstand/fabrik";
    const { container } = render(<App />);
    const flow = await screen.findByRole("region", { name: "Ablauf der Agenten" });
    expect(await within(flow).findByRole("group", { name: "Fix the start block" })).toBeInTheDocument();
    expect(tabs().getByRole("link", { name: "Linie" })).toHaveAttribute("aria-current", "page");
    expect(tabs().getByRole("link", { name: "Haupt" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("region", { name: "Agenten" })).toBeNull();
    expect(container.querySelector(".g-mount-legacy")).toHaveAttribute("hidden");
  });

  it("names the flow tab Linie inside the Fabrik area", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    window.location.hash = "#/leitstand/fabrik";
    render(<App />);
    await screen.findByRole("region", { name: "Ablauf der Agenten" });
    expect(tabs().getByRole("link", { name: "Linie" })).toHaveAttribute("aria-current", "page");
    const sidebar = within(screen.getByRole("navigation", { name: "Hauptnavigation" }));
    expect(sidebar.getByRole("link", { name: "Fabrik" })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("link", { name: "Fabrik" })).toHaveLength(1);
  });

  it("shows the empty hint at /leitstand/fabrik while no agent runs", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    window.location.hash = "#/leitstand/fabrik";
    const base = currentInvoke();
    mocks.invoke.mockImplementation((command: string) =>
      command === "get_board_state" ? Promise.resolve({ cards: [], coordinators: [] }) : base(command));
    const { container } = render(<App />);
    expect(await screen.findByText("Noch keine Agenten im Ablauf")).toBeInTheDocument();
    expect(container.querySelector(".fl-node")).toBeNull();
  });

  it("does not claim an empty flow when the board cannot be read at /leitstand/fabrik", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    window.location.hash = "#/leitstand/fabrik";
    const base = currentInvoke();
    mocks.invoke.mockImplementation((command: string) =>
      command === "get_board_state" ? Promise.reject(new Error("backend down")) : base(command));
    render(<App />);
    expect(await screen.findByText(de["honest.offline"])).toBeInTheDocument();
    expect(screen.queryByText("Noch keine Agenten im Ablauf")).toBeNull();
  });

  it("reaches Fabrik from Haupt by its tab link", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    render(<App />);
    await screen.findByRole("region", { name: "Agenten" });
    expect(tabs().getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Haupt", "Linie", "Betrieb", "Werkzeuge", "Klassisch",
    ]);
    expect(tabs().getByRole("link", { name: "Linie" })).toHaveAttribute("href", "#/leitstand/fabrik");
    fireEvent.click(tabs().getByRole("link", { name: "Linie" }));
    await waitFor(() => expect(window.location.hash).toBe("#/leitstand/fabrik"));
    expect(await screen.findByRole("region", { name: "Ablauf der Agenten" })).toBeInTheDocument();
  });

  it("renders old flow paths as Fabrik immediately without requesting Haupt questions", async () => {
    for (const path of ["/leitstand/fluss", "/leitstand/fluss/"]) {
      mocks.invoke.mockClear();
      const view = render(<LeitstandRoute path={path} />);
      expect.soft(tabs().getByRole("link", { name: "Linie" })).toHaveAttribute("aria-current", "page");
      expect.soft(screen.queryByRole("region", { name: "Agenten" })).toBeNull();
      expect.soft(screen.queryByRole("complementary", { name: "Braucht dich" })).toBeNull();
      await act(async () => {});
      expect.soft(mocks.invoke).not.toHaveBeenCalledWith("list_questions", expect.anything());
      expect.soft(screen.queryByRole("region", { name: "Ablauf der Agenten" })).toBeInTheDocument();
      view.unmount();
    }
  });

  it("redirects old flow bookmarks and later hash navigation to Fabrik", async () => {
    window.location.hash = "#/leitstand/fluss";
    const { container } = render(<App />);
    const expectFabrik = async () => {
      await waitFor(() => expect(window.location.hash).toBe("#/leitstand/fabrik"));
      const flow = await screen.findByRole("region", { name: "Ablauf der Agenten" });
      expect(await within(flow).findByRole("group", { name: "Fix the start block" })).toBeInTheDocument();
      expect(tabs().getByRole("link", { name: "Linie" })).toHaveAttribute("aria-current", "page");
      expect(container.querySelector(".g-mount-legacy")).toHaveAttribute("hidden");
    };
    await expectFabrik();
    await go("#/leitstand/betrieb");
    await screen.findByRole("region", { name: "Warteschlange" });
    await go("#/leitstand/fluss/");
    await expectFabrik();
  });

  // COMP-1-3: the node wears the card's lamp, still without proof.
  const flowBoard = (...cards: Array<{ w: typeof worker; column: string }>) => {
    const base = currentInvoke();
    mocks.invoke.mockImplementation((command: string) =>
      command === "get_board_state"
        ? Promise.resolve({ cards: cards.map(({ w, column }) => ({ worker: w, column, attention_reason: null, attention_code: null, attention_grade: null, pr_url: null, test_status: null })), coordinators: [] })
        : base(command));
  };

  it("shows the unproven lamp on a done node", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    window.location.hash = "#/leitstand/fabrik";
    flowBoard({ w: worker, column: "done" });
    render(<App />);
    const node = await screen.findByRole("group", { name: "Fix the start block" });
    expect(within(node).getByRole("img", { name: "ohne Beweis" })).toHaveClass("g-lamp--bad");
    expect(within(node).getByText("Fix the start block")).toBeInTheDocument();
    expect(within(node).getByText("claude/w1")).toBeInTheDocument();
  });

  it("gives each lamp kind its atom on a node", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    window.location.hash = "#/leitstand/fabrik";
    flowBoard(
      { w: { ...worker, id: "w1", task: "Runs now" }, column: "working" },
      { w: { ...worker, id: "w2", task: "Waits for you" }, column: "needs_you" },
      { w: { ...worker, id: "w3", task: "Has stopped", status: "exited" }, column: "working" },
    );
    render(<App />);
    const lamp = async (task: string, name: string) => within(await screen.findByRole("group", { name: task })).getByRole("img", { name });
    expect(await lamp("Runs now", "Läuft")).toHaveClass("g-lamp--busy");
    expect(await lamp("Waits for you", "Blockiert")).toHaveClass("g-lamp--bad");
    expect(await lamp("Has stopped", "Untätig")).toHaveClass("g-lamp--off");
  });

  // The shell trims the hash before it reaches the route, but the route also takes `path` as a prop.
  it("marks the Betrieb tab as the current one for a trailing-slash path", async () => {
    render(<LeitstandRoute path="/leitstand/betrieb/" />);
    expect(await screen.findByRole("region", { name: "Warteschlange" })).toBeInTheDocument();
    expect(tabs().getByRole("link", { name: "Betrieb" })).toHaveAttribute("aria-current", "page");
  });

  it("shows the Fabrik tab as active for a trailing-slash path", async () => {
    render(<LeitstandRoute path="/leitstand/fabrik/" />);
    expect(await screen.findByRole("region", { name: "Ablauf der Agenten" })).toBeInTheDocument();
    expect(tabs().getByRole("link", { name: "Linie" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("region", { name: "Agenten" })).toBeNull();
  });

  it("keeps /leitstand/fabrik off when D1 is explicitly disabled", async () => {
    localStorage.setItem(FLAG_KEY, "0");
    window.location.hash = "#/leitstand/fabrik";
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".app")).not.toBeNull());
    expect(container.querySelector(".g-mount")).toBeNull();
    expect(screen.queryByRole("region", { name: "Ablauf der Agenten" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Linie" })).toBeNull();
  });

  it("offers no Betrieb route while the switch is off", async () => {
    localStorage.setItem(FLAG_KEY, "0");
    window.location.hash = "#/leitstand/betrieb";
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".app")).not.toBeNull());
    expect(container.querySelector(".g-mount")).toBeNull();
    expect(screen.queryByRole("region", { name: "Warteschlange" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Betrieb" })).toBeNull();
  });

  it("renders no new Leitstand while the switch is off", async () => {
    localStorage.setItem(FLAG_KEY, "0");
    window.location.hash = "#/leitstand";
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".app")).not.toBeNull());
    expect(container.querySelector(".g-mount")).toBeNull();
    expect(screen.queryByRole("region", { name: "Agenten" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Braucht dich" })).toBeNull();
  });
});
