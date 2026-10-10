import { describe, expect, it } from "vitest";

import changelogSource from "../../CHANGELOG.md?raw";
import { parseChangelog } from "./changelog";

describe("parseChangelog", () => {
  it("parses the v1.6.0 release heading with Beta flag and German date", () => {
    const [release] = parseChangelog("# Changelog\n\n## v1.6.0 (Beta) — 10.10.2026\n\n- Etwas.\n");
    expect(release.version).toBe("1.6.0");
    expect(release.beta).toBe(true);
    expect(release.date).toBe("2026-10-10");
  });

  it("parses ISO dates and hyphen separators", () => {
    const releases = parseChangelog(
      "## v1.5.0 (Beta) — 2026-10-05\n\n- a\n\n## v1.2.1 - 2026-08-31\n\n- b\n\n## v1.2.1 — 2026-08-31\n\n- c\n",
    );
    expect(releases.map((r) => [r.version, r.beta, r.date])).toEqual([
      ["1.5.0", true, "2026-10-05"],
      ["1.2.1", false, "2026-08-31"],
    ]);
    expect(releases[1].groups[0].items[0].text).toBe("b"); // duplicate heading: first wins
  });

  it("collects bullet continuation lines into one item", () => {
    const [release] = parseChangelog(
      [
        "## v1.0.0 — 2026-08-28",
        "**Zuverlässigkeit:**",
        "- **Start bleibt gesperrt** (PR #832): Scheitert die Prüfung,",
        "  öffnet die App die `Datenbank` nicht",
        "  und zeigt *eine* Anleitung.",
        "- Zweiter Punkt",
      ].join("\n"),
    );
    const [group] = release.groups;
    expect(group.title).toBe("Zuverlässigkeit");
    expect(group.items).toHaveLength(2);
    expect(group.items[0].title).toBe("Start bleibt gesperrt");
    expect(group.items[0].text).toBe(
      "Scheitert die Prüfung, öffnet die App die Datenbank nicht und zeigt eine Anleitung.",
    );
  });

  it("extracts PR refs and classifies tags", () => {
    const [release] = parseChangelog(
      [
        "## v1.0.0 — 2026-08-28",
        "**Sicherheit:**",
        "- Gehärtet (PR #1, #2) und noch einmal (#2)",
        "### Behoben",
        "- Absturz beim Start",
        "**Oberfläche:**",
        "- **Neue Ansicht** (PR #7): Sie ist da.",
        "- **Hell-Modus folgt dem System** (PR #524).",
        "**Hygiene:**",
        "- Aufgeräumt",
        "",
        "Intern (seit abc): #843 (Test), #741 (Rest).",
      ].join("\n"),
    );
    const tags = release.groups.map((g) => g.items.map((i) => i.tag));
    expect(tags).toEqual([["security"], ["fix"], ["new", "improved"], ["internal"], ["internal"]]);
    expect(release.groups[0].items[0].prs).toEqual([1, 2]);
    expect(release.groups[0].items[0].text).toBe("Gehärtet und noch einmal");
    expect(release.groups[2].items[1].text).toBe("");
  });

  it("skips the not-yet-on-main section", () => {
    const releases = parseChangelog(
      [
        "## v1.4.1 — 2026-09-22",
        "- shipped",
        "### Noch nicht auf `main` (offene PRs)",
        "- not shipped",
        "## v1.4.0 — 2026-09-15",
        "> **Updater-Hinweis:** Kein manueller Schritt.",
        "",
        "Fließtext der Version.",
        "- also shipped",
      ].join("\n"),
    );
    expect(releases[0].groups.flatMap((g) => g.items.map((i) => i.text))).toEqual(["shipped"]);
    expect(releases[1].notes).toEqual(["Updater-Hinweis: Kein manueller Schritt.", "Fließtext der Version."]);
  });

  it("parses the real CHANGELOG.md without empty releases", () => {
    const releases = parseChangelog(changelogSource);
    expect(releases[0].version).toBe("1.6.0");
    expect(releases[0].beta).toBe(true);
    expect(new Set(releases.map((r) => r.version)).size).toBe(releases.length);
    for (const r of releases) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.groups.flatMap((g) => g.items).length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(releases)).not.toMatch(/\*\*|`/);
    expect(releases.flatMap((r) => r.groups.map((g) => g.title))).not.toContain("Noch nicht auf main (offene PRs)");
  });
});
