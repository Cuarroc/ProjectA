import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  AgentProfile,
  BoardCard,
  Project,
  Provider,
  TerminalSession,
  Worker,
} from "../types";
import type { QuestionsState } from "../lib/useQuestions";
import BoardRail from "./BoardRail";
import FreeTierPanel from "./FreeTierPanel";
import HistoryView from "./HistoryView";
import ProviderDialog from "./ProviderDialog";
import QuestionsView from "./QuestionsView";
import SkillPackDialog from "./SkillPackDialog";
import StatusBar from "./StatusBar";
import WorkerPanel from "./WorkerPanel";

// F-W1-11: these nine shell surfaces had no accessibility regression test at
// all — nothing would fail if a future edit turned one of their buttons back
// into an icon with no name. This file is that saved accessibility-tree
// check: every button, link, textbox and tab across them must carry a
// non-empty accessible name. `InfoLine` and `BootstrapScreen`-style leaf
// components without interactive elements are not listed; there is nothing
// here for the check to walk.

const apiKeyProvider: Provider = {
  id: "openai",
  name: "OpenAI",
  kind: "api_key",
  connected: true,
  detail: null,
  quotaState: "ok",
  blockedUntil: null,
  omniRouteOnline: false,
  usage: null,
  vaultError: null,
};

vi.mock("../lib/ipc", () => ({
  listWorkerMessages: vi.fn(async () => []),
  listAgentProfiles: vi.fn(async () => []),
  describeError: (cause: unknown) => String(cause),
  // W1-24b: ProviderDialog reads the OmniRoute key-sync opt-in on open.
  getOmniRouteKeySync: vi.fn(async () => false),
  setOmniRouteKeySync: vi.fn(async () => {}),
}));

vi.mock("../lib/providers", async () => {
  const actual = await vi.importActual<typeof import("../lib/providers")>("../lib/providers");
  return {
    ...actual,
    // Review round 1 (kimi-k2.7-code, finding 4): an empty provider/pool list
    // hides `ProviderKeyControls` and every `FreeTierRow`. Rendered with one
    // of each here so the check actually walks their buttons and inputs too.
    useProviderOverview: () => ({
      providers: [apiKeyProvider],
      loading: false,
      error: null,
      vaultError: null,
      refresh: vi.fn(),
    }),
    useFreeTierSummary: () => ({
      summary: {
        available: true,
        reason: null,
        pools: [
          {
            provider: "groq",
            label: "Groq",
            remaining: 100,
            limit: 200,
            remainingPercent: 50,
            resetsAt: null,
            tosStatus: null,
            whitelisted: true,
          },
        ],
        whitelist: ["groq"],
        observedAt: 1,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    }),
    useProviderKey: () => ({
      present: false,
      busy: false,
      error: null,
      save: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
    }),
  };
});

vi.mock("../lib/quota", async () => {
  const actual = await vi.importActual<typeof import("../lib/quota")>("../lib/quota");
  return {
    ...actual,
    useQuotaState: () => ({
      byProfile: new Map(),
      blockedCount: 0,
      omniRouteOnline: null,
      loading: false,
    }),
  };
});

vi.mock("../lib/skills", async () => {
  const actual = await vi.importActual<typeof import("../lib/skills")>("../lib/skills");
  return {
    ...actual,
    useProjectSkillPacks: () => ({
      packs: [
        { id: "pack-1", name: "Pack Eins", description: "" },
        { id: "pack-2", name: "Pack Zwei", description: "" },
      ],
      enabled: ["pack-1", "pack-2"],
      loading: false,
      error: null,
      toggle: vi.fn(),
      saving: false,
    }),
  };
});

function worker(id: string): Worker {
  return {
    id,
    projectId: "pj-1",
    task: `Task ${id}`,
    profileId: "codex",
    branch: `nacht/${id}`,
    worktreePath: "/tmp/" + id,
    sessionId: "s1",
    status: "running",
    kind: "worker",
    spawnedBy: null,
    pausedReason: null,
    createdAt: 1,
  };
}

function card(id: string): BoardCard {
  return {
    worker: worker(id),
    column: "working",
    attentionReason: null,
    attentionCode: null,
    attentionGrade: null,
    prUrl: null,
    contextUsage: null,
    controlledBy: null,
    testStatus: null,
    testedAt: null,
  };
}

const project: Project = {
  id: "pj-1",
  name: "ProjectA",
  repoPath: "/tmp/pj-1",
  createdAt: 1,
  githubRemote: false,
  maxWorkers: null,
  testCommand: null,
};

const profile: AgentProfile = {
  id: "codex",
  name: "Codex",
  command: "codex",
  args: [],
  env: {},
  fallback: null,
  enabled: true,
};

const session: TerminalSession = {
  sessionId: "s1",
  profileId: "codex",
  profileName: "Codex",
  workerId: "wk-1",
  projectId: "pj-1",
  kind: "worker",
  title: "wk-1",
  exited: false,
  exitCode: null,
};

const emptyQuestions: QuestionsState = {
  open: [],
  history: [],
  loading: false,
  error: null,
  scope: "project",
  setScope: vi.fn(),
  refresh: vi.fn(),
  answer: vi.fn(async () => undefined),
};

// Review round 1 (kimi-k2.7-code, critical findings 1-4): the first cut of
// this check accepted `textContent` even when it came entirely from an
// `aria-hidden="true"` icon span, and accepted `title` as a name substitute
// — both produce false positives that would let exactly the regression this
// test exists to catch (an icon button losing its `aria-label`) through
// unnoticed. It also missed checkbox/radio inputs and `<select>`, and
// rendered a couple of components in a data-empty state that hides some of
// their interactive elements. Fixed below: `title` no longer counts, text
// is computed with `aria-hidden` descendants stripped first, form controls
// resolve their name through an associated `<label>`, and FreeTierPanel /
// ProviderDialog are additionally rendered with real data.

/** Elements this check walks, one query per interactive shape. */
const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  '[role="tab"]',
  '[role="switch"]',
  '[role="link"]',
].join(", ");

/** `element.textContent`, but with every `aria-hidden="true"` subtree removed
 * first — an icon glyph hidden from assistive tech must never count as the
 * element's name. */
function visibleTextContent(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return clone.textContent ?? "";
}

/** The text of the `<label>` that names a form control: an ancestor label
 * wrapping the control, or one pointed at it by `for`/`id`. Only the
 * control's own value text is stripped from a wrapping label — a checkbox
 * has none, so nothing is stripped there. */
function associatedLabelText(element: HTMLElement, doc: Document): string {
  const wrapping = element.closest("label");
  if (wrapping !== null) return wrapping.textContent ?? "";
  const id = element.getAttribute("id");
  if (id === null || id === "") return "";
  const forLabel = doc.querySelector(`label[for="${id}"]`);
  return forLabel?.textContent ?? "";
}

function accessibleName(element: HTMLElement, doc: Document): string {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel !== null && ariaLabel.trim() !== "") return ariaLabel;

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy !== null && labelledBy.trim() !== "") {
    const text = labelledBy
      .split(/\s+/)
      .map((refId) => doc.getElementById(refId)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text !== "") return text;
  }

  const tag = element.tagName.toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") {
    const label = associatedLabelText(element, doc);
    if (label.trim() !== "") return label;
    return "";
  }

  return visibleTextContent(element);
}

function assertEveryInteractiveElementIsNamed(container: HTMLElement, label: string) {
  const doc = container.ownerDocument;
  const elements = Array.from(container.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR));
  for (const element of elements) {
    const name = accessibleName(element, doc);
    expect(
      name.trim() !== "",
      `${label}: "${element.outerHTML.slice(0, 160)}" has no accessible name`,
    ).toBe(true);
  }
}

describe("shell accessibility tree — untested surfaces", () => {
  it("BoardRail names every interactive element", () => {
    const { container } = render(
      <BoardRail
        cards={[card("wk-1"), card("wk-2")]}
        activeWorkerId={null}
        hasProject
        loading={false}
        error={null}
        onOpen={vi.fn()}
        onOpenBoard={vi.fn()}
        openQuestions={2}
        questionsFleetWide={false}
        onOpenQuestions={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );
    assertEveryInteractiveElementIsNamed(container, "BoardRail");
  });

  it("FreeTierPanel names every interactive element", () => {
    const { container } = render(<FreeTierPanel />);
    assertEveryInteractiveElementIsNamed(container, "FreeTierPanel");
  });

  it("HistoryView names every interactive element", () => {
    const { container } = render(<HistoryView workerId="wk-1" />);
    assertEveryInteractiveElementIsNamed(container, "HistoryView");
  });

  it("ProviderDialog names every interactive element", () => {
    const { container } = render(<ProviderDialog onClose={vi.fn()} />);
    assertEveryInteractiveElementIsNamed(container, "ProviderDialog");
  });

  it("QuestionsView names every interactive element", () => {
    const { container } = render(
      <QuestionsView
        questions={emptyQuestions}
        projects={[project]}
        activeProjectId="pj-1"
        workers={[worker("wk-1")]}
        onOpenWorker={vi.fn()}
      />,
    );
    assertEveryInteractiveElementIsNamed(container, "QuestionsView");
  });

  it("SkillPackDialog names every interactive element", () => {
    const { container } = render(<SkillPackDialog project={project} onClose={vi.fn()} />);
    assertEveryInteractiveElementIsNamed(container, "SkillPackDialog");
  });

  it("StatusBar names every interactive element", () => {
    const { container } = render(
      <StatusBar
        session={session}
        sessionCount={1}
        error="Fehler"
        attentionCount={1}
        onOpenBoard={vi.fn()}
        onDismissError={vi.fn()}
        onOpenProviders={vi.fn()}
      />,
    );
    assertEveryInteractiveElementIsNamed(container, "StatusBar");
  });

  it("WorkerPanel names every interactive element", () => {
    const { container } = render(
      <WorkerPanel
        workers={[worker("wk-1")]}
        profiles={[profile]}
        activeWorkerId={null}
        hasProject
        loading={false}
        error={null}
        busyWorkerId={null}
        onNew={vi.fn()}
        onOpen={vi.fn()}
        onRespawn={vi.fn()}
        onArchive={vi.fn()}
      />,
    );
    assertEveryInteractiveElementIsNamed(container, "WorkerPanel");
  });
});
