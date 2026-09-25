/**
 * A small dependency-free Markdown renderer for the design studio preview.
 * Supported: `# H1`, `## H2`, `### H3`, blank-line-separated paragraphs,
 * `**bold**`, `*italic*`, `- item` lists, `[text](url)` links and line breaks.
 */

import { openExternal } from "./ipc";

/**
 * Click handler for the rendered preview: web links go to the OS browser
 * through the opener plugin (P2-F, 02.09.2026). Attach it once to the
 * container that holds the rendered HTML - the anchors themselves are
 * re-created on every render, a delegated listener is not.
 *
 * `target="_blank"` alone was not enough: WebView2 frequently opens nothing
 * for it, and the click then silently did nothing. Only `http(s)` is taken
 * over; `mailto:` and everything else keep the webview's own behaviour, and
 * unsafe schemes never become anchors in the first place (see `isSafeUrl`).
 */
export function openPreviewLink(event: {
  target: EventTarget | null;
  preventDefault(): void;
}): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest("a[href]");
  const href = anchor?.getAttribute("href")?.trim() ?? "";
  if (!/^https?:\/\//i.test(href)) return;
  event.preventDefault();
  void openExternal(href).catch((err: unknown) => {
    console.warn("preview link could not be opened", err);
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/// Only these URL schemes may become an `href`. Everything else (including
/// `javascript:`, `data:` and `vbscript:`) is treated as plain text.
function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  return (
    trimmed === "" ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("file://")
  );
}

/** Inline markup on a single line; the URL is escaped like any other text. */
function renderInline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  out = out.replace(/\[([^\]]+)\]\(([^()\s]+)\)/g, (_, label: string, url: string) => {
    if (isSafeUrl(url)) {
      // New window, no opener: a preview link must never navigate the app
      // window itself away from the studio.
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
    // Unsafe URL: keep the original Markdown literal so nothing executable
    // reaches the browser.
    return `[${label}](${url})`;
  });
  return out;
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.split(/\r\n|\r|\n/);
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${paragraph.map(renderInline).join("<br />")}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
    list = [];
  };

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const item = /^-\s+(.*)$/.exec(line);
    if (item) {
      flushParagraph();
      list.push(item[1]);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();

  return blocks.join("\n");
}
