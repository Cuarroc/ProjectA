/**
 * Parser for the repository's CHANGELOG.md. It returns plain data only: every
 * string is text with the markdown markers removed, never HTML, so a view
 * renders it as text nodes and nothing in the file can inject markup.
 */

export type ChangelogTag = "new" | "improved" | "fix" | "security" | "internal";

export interface ChangelogItem {
  /** The bullet's leading bold title, if any. */
  title: string | null;
  text: string;
  prs: number[];
  tag: ChangelogTag;
}

export interface ChangelogGroup {
  title: string | null;
  items: ChangelogItem[];
}

export interface Release {
  version: string;
  beta: boolean;
  /** ISO date (`2026-10-10`), whichever form the heading used. */
  date: string;
  /** Release-level prose (update hint, schema note, ...), one string per paragraph. */
  notes: string[];
  groups: ChangelogGroup[];
}

const RELEASE_HEADING =
  /^##\s+v?(\d+\.\d+\.\d+)(?:\s*\((beta)\))?\s*[—–-]\s*(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})\s*$/i;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const BOLD_GROUP = /^\*\*([^*]+?):\*\*\s*$/;
const PR_ONLY_PARENS = /\s*\((?:PRs?\s*)?#\d+(?:\s*(?:,|und|\/)\s*#?\d+)*\)/g;
const LEADING_META = /^\s*\((?:PRs?\s*#|`[0-9a-f]{7,}`)[^)]*\)\s*:?\s*/;
const TRAILING_PR_LIST = /:\s*#\d+(?:\s*,\s*#\d+)*\.?\s*$/;

// First match wins, so a security fix is "security"; the group title is the fallback.
const TAG_RULES: Array<[ChangelogTag, RegExp]> = [
  ["security", /sicherheit/i],
  ["fix", /behoben|gefixt|fehler|bug|absturz|abstürz|stürzt|(^|[^a-zäöüß])fix/i],
  ["new", /(^|[^a-zäöüß])neu/i],
  ["internal", /intern|hygiene|werkzeug|(^|[^a-zäöüß])ci([^a-zäöüß]|$)|anleitung/i],
];

function classify(...labels: Array<string | null>): ChangelogTag {
  for (const label of labels) {
    if (!label) continue;
    const rule = TAG_RULES.find(([, re]) => re.test(label));
    if (rule) return rule[0];
  }
  return "improved";
}

/** Strips emphasis, code spans and links down to their text. */
function plain(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(?<![*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Removes the PR-only parentheses (the refs are shown as chips) and tidies punctuation. */
function tidy(text: string): string {
  return text
    .replace(PR_ONLY_PARENS, "")
    .replace(TRAILING_PR_LIST, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/^[\s:.,;–—-]+/, "")
    .trim();
}

function prRefs(raw: string): number[] {
  const seen = new Set<number>();
  for (const m of raw.matchAll(/#(\d+)/g)) seen.add(Number(m[1]));
  return [...seen];
}

function toIso(date: string): string {
  const german = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
  return german ? `${german[3]}-${german[2]}-${german[1]}` : date;
}

function makeItem(raw: string, groupTitle: string | null): ChangelogItem {
  const bold = /^\*\*(.+?)\*\*/.exec(raw);
  const rest = bold ? raw.slice(bold[0].length) : raw;
  const title = bold ? plain(tidy(bold[1])).replace(/:$/, "") : null;
  const text = plain(tidy(rest.replace(LEADING_META, "")));
  return {
    title: title || null,
    text,
    prs: prRefs(raw),
    tag: classify(title, title ? null : text.slice(0, 60), groupTitle),
  };
}

/** A one-line "Title:" / "**Title** (...):" paragraph that introduces a bullet list. */
function groupTitleOf(paragraph: string): string | null {
  if (!paragraph.endsWith(":")) return null;
  const bold = /^\*\*([^*]+)\*\*/.exec(paragraph);
  const title = plain(bold ? bold[1] : paragraph).replace(/:$/, "");
  return title.length <= 80 && (bold || !/[.!?]/.test(title)) ? title : null;
}

export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  const seen = new Set<string>();
  let release: Release | null = null;
  let group: ChangelogGroup | null = null;
  let itemRaw: string[] = [];
  let skipping = false;
  let para: string[] = [];
  let paraClosed = false;

  const openGroup = (title: string | null) => {
    group = { title, items: [] };
    release?.groups.push(group);
  };
  const finishItem = () => {
    if (itemRaw.length > 0 && group) group.items.push(makeItem(itemRaw.join(" "), group.title));
    itemRaw = [];
  };
  const settlePara = (nextIsBullet: boolean) => {
    const raw = para.join(" ").trim();
    para = [];
    if (!raw || !release) return;
    const title = nextIsBullet ? groupTitleOf(raw) : null;
    if (title) openGroup(title);
    else if (/^Intern/.test(raw)) {
      // "Intern (...): #1, #2" lines list pull requests; each line is one internal entry.
      openGroup("Intern");
      for (const line of raw.split(/\s(?=Intern)/)) group!.items.push(makeItem(line, "Intern"));
    } else if (plain(raw) && !raw.endsWith(":")) {
      release.notes.push(plain(raw));
    }
  };

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (heading) {
      settlePara(false);
      finishItem();
      if (heading[1] === "##") {
        const m = RELEASE_HEADING.exec(line.trim());
        skipping = false;
        release = null;
        group = null;
        if (m && !seen.has(m[1])) {
          seen.add(m[1]);
          release = { version: m[1], beta: !!m[2], date: toIso(m[3]), notes: [], groups: [] };
          releases.push(release);
        } else skipping = !!m; // duplicate heading: the first one wins
      } else if (/^Noch nicht auf/i.test(heading[2])) {
        skipping = true;
      } else {
        skipping = false;
        if (release) openGroup(plain(heading[2]));
      }
      continue;
    }
    if (!release || skipping) continue;

    if (line.trim() === "") {
      finishItem();
      if (para.length > 0) paraClosed = true;
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      settlePara(true);
      finishItem();
      if (!group) openGroup(null);
      itemRaw = [bullet[2]];
      continue;
    }
    const bold = BOLD_GROUP.exec(line.trim());
    if (bold) {
      settlePara(false);
      finishItem();
      openGroup(plain(bold[1]));
      continue;
    }
    if (itemRaw.length > 0) {
      itemRaw.push(line.trim()); // continuation line of the open bullet
      continue;
    }
    if (paraClosed) settlePara(false);
    paraClosed = false;
    para.push(line.replace(/^\s*>\s?/, "").trim());
  }
  settlePara(false);
  finishItem();

  for (const r of releases) r.groups = r.groups.filter((g) => g.items.length > 0);
  return releases;
}
