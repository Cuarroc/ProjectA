import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ICON_NAMES as CLASSIC_NAMES } from "../../components/Icon";
import { ROUTES } from "../../shell/routes";
import { Icon } from "./Icon";
import { CLASSIC_GLYPH, GLYPHS, ROUTE_GLYPH, type IconName } from "./glyphs";

const names = Object.keys(GLYPHS) as IconName[];

describe("Icon", () => {
  it("every registered icon renders a 20 px svg and is hidden unless labelled", () => {
    expect(names.length).toBeGreaterThanOrEqual(24);
    for (const name of names) {
      const hidden = render(<Icon name={name} />).container.querySelector("svg")!;
      expect(hidden.getAttribute("width"), name).toBe("20");
      expect(hidden.getAttribute("height"), name).toBe("20");
      expect(hidden.getAttribute("stroke"), name).toBe("currentColor");
      expect(hidden.getAttribute("aria-hidden"), name).toBe("true");
      expect(hidden.hasAttribute("role"), name).toBe(false);
      expect(hidden.querySelectorAll("path").length, name).toBeGreaterThan(0);

      const named = render(<Icon name={name} label="Hinweis" />).container.querySelector("svg")!;
      expect(named.getAttribute("role"), name).toBe("img");
      expect(named.getAttribute("aria-label"), name).toBe("Hinweis");
      expect(named.hasAttribute("aria-hidden"), name).toBe(false);
    }
  });

  it("an empty label stays hidden", () => {
    const svg = render(<Icon name="check" label="" />).container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.hasAttribute("role")).toBe(false);
  });

  it("has an equivalent for every classic glyph and every route glyph", () => {
    for (const name of CLASSIC_NAMES) expect(GLYPHS[CLASSIC_GLYPH[name]], name).toBeDefined();
    const withIcon = ROUTES.filter((route) => route.icon !== null).map((route) => route.id);
    expect(withIcon.length).toBe(Object.keys(ROUTE_GLYPH).length);
    for (const id of withIcon) expect(GLYPHS[ROUTE_GLYPH[id]], id).toBeDefined();
  });
});
