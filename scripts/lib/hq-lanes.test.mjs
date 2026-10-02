// scripts/lib/hq-lanes.test.mjs — drawLanes behaviour (review r4 M12 / M14)
// Drives the real hq.js against a minimal DOM stub so the SERIAL lock rule is
// tested on the rendered SVG, not on a regex over the source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const HQ_JS = readFileSync(join("docs", "dev-hq", "hq.js"), "utf8");
const DATA = JSON.parse(readFileSync(join("docs", "dev-hq", "data.json"), "utf8"));

class Node {
  constructor(tag) {
    this.tag = tag;
    this.attrs = {};
    this.children = [];
    this.textContent = "";
    this.innerHTML = "";
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...c) { this.children = c; }
  insertAdjacentHTML() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  *walk() { yield this; for (const c of this.children) yield* c.walk(); }
}

function renderNowLanes(data) {
  const byId = { mount: new Node("div"), lane: new Node("div") };
  const document = {
    getElementById: (id) => byId[id] || null,
    querySelector: () => null,
    createElementNS: (_ns, tag) => new Node(tag),
    createElement: (tag) => new Node(tag),
  };
  const context = {
    document,
    window: { HQ_DATA: data, matchMedia: () => ({ matches: true }) },
    location: { pathname: "/now.html" },
    requestAnimationFrame: (fn) => fn(),
    console,
  };
  vm.runInNewContext(HQ_JS, context);
  const svg = byId.lane.children[0];
  assert.ok(svg, "drawLanes mounted an svg");
  return svg;
}

function lockOwners(svg) {
  return [...svg.walk()].filter((n) => n.attrs.class === "lock-owner").map((n) => n.textContent);
}

test("M12: a SERIAL lock is only drawn between holders of the same owner", () => {
  const specs = [
    { file: ".pa/a.md", packet: "A", lane: "serial", serialOwner: "api.rs", startable: true, source: "STAND.md" },
    { file: ".pa/b.md", packet: "B", lane: "serial", serialOwner: "main.rs", startable: false, source: "STAND.md" },
  ];
  const svg = renderNowLanes({ ...DATA, specs, next: [] });
  assert.deepEqual(lockOwners(svg), [], "api.rs → main.rs is not a lock; nothing owns both");
});

test("M12 live: every lock label names an owner both neighbours hold", () => {
  const svg = renderNowLanes(DATA);
  const serial = DATA.specs.filter((s) => s.lane === "serial");
  const expected = [];
  for (let i = 1; i < serial.length; i++) {
    const prev = serial[i - 1];
    const cur = serial[i];
    if (prev.serialOwner && prev.serialOwner === cur.serialOwner && prev.startable && !cur.startable) {
      expected.push(cur.serialOwner);
    }
  }
  // The expected lock list is derived from the live snapshot itself; an empty
  // list is a valid state (no two serial specs share an owner in STAND.md).
  assert.deepEqual(lockOwners(svg), expected);
});

test("M14: spec.startable wins over the next[] map for the same file", () => {
  const specs = [
    { file: ".pa/a.md", packet: "A", lane: "serial", serialOwner: "main.rs", startable: true, source: "STAND.md" },
    { file: ".pa/b.md", packet: "B", lane: "serial", serialOwner: "main.rs", startable: false, source: "STAND.md" },
  ];
  const next = [{ packet: "B", why: "", doneWhen: ".pa/b.md", source: "STAND.md", startable: true, serialOwner: "main.rs" }];
  const svg = renderNowLanes({ ...DATA, specs, next });
  assert.deepEqual(lockOwners(svg), ["main.rs"], "the spec says locked; a stale next[] row must not unlock it");
});
