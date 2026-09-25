/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import { markdownToHtml, openPreviewLink } from "./markdown";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

// P2-F (02.09.2026): Links aus dem Markdown-Preview trugen nur
// `target="_blank"`. Unter WebView2 oeffnet das haeufig gar nichts - der
// Klick lief am Opener-Plugin vorbei, das seit P2-J verdrahtet ist. Der
// Handler haengt per Delegation am Preview-Container und schickt http(s)-Links
// durch `openExternal`; alles andere laesst er unangetastet.
function renderInto(markdown: string): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = markdownToHtml(markdown);
  container.addEventListener("click", openPreviewLink);
  document.body.appendChild(container);
  return container;
}

function click(target: Element): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("markdown preview links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("hands a clicked web link to the opener plugin instead of the webview", () => {
    const container = renderInto("[PR](https://github.com/Cuarroc/ProjectA/pull/1)");
    const link = container.querySelector("a");
    expect(link).not.toBeNull();

    const event = click(link!);

    expect(event.defaultPrevented).toBe(true);
    expect(invoke).toHaveBeenCalledWith("plugin:opener|open_url", {
      url: "https://github.com/Cuarroc/ProjectA/pull/1",
    });
  });

  it("also routes plain http links (LAN web interface) through the plugin", () => {
    const container = renderInto("[Board](http://192.168.1.5:7788/board)");

    click(container.querySelector("a")!);

    expect(invoke).toHaveBeenCalledWith("plugin:opener|open_url", {
      url: "http://192.168.1.5:7788/board",
    });
  });

  it("never renders a javascript: URL as a link, so there is nothing to open", () => {
    const container = renderInto("[x](javascript:alert(1))");

    expect(container.querySelector("a")).toBeNull();
    click(container.querySelector("p")!);

    expect(invoke).not.toHaveBeenCalled();
  });

  it("still renders target=_blank with rel hardening (F-4 regression)", () => {
    // Review P2-F GLM Runde 2: das Attribut ist der dokumentierte Fallback,
    // falls der Opener-Aufruf scheitert (ipc.ts faellt auf window.open
    // zurueck - das braucht target=_blank am Anchor).
    const container = renderInto("[x](https://example.com)");

    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("leaves non-web schemes and plain text alone", () => {
    const container = renderInto("[mail](mailto:a@b.c)\n\nnur Text");

    const mail = click(container.querySelector("a")!);
    const text = click(container.querySelectorAll("p")[1]);

    expect(invoke).not.toHaveBeenCalled();
    expect(mail.defaultPrevented).toBe(false);
    expect(text.defaultPrevented).toBe(false);
  });
});
