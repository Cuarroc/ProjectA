import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const dir = new URL("./", import.meta.url);

test("root receiver fails closed without injected id", () => {
  for (const name of readdirSync(dir)) {
    assert.doesNotMatch(readFileSync(new URL(name, dir), "utf8"), /agent-\d+-[a-z0-9]+/i, `${name} holds an agent id`);
  }
  const line = readFileSync(new URL("ideas.js", dir), "utf8").split("\n").find((l) => l.startsWith("const rootReceiver = "));
  assert.ok(line, "rootReceiver declaration missing");
  const receiver = (meta) => runInNewContext(`${line}\nrootReceiver`, {
    document: { querySelector: (sel) => (sel === 'meta[name="decision-desk-root-agent-id"]' ? meta : null) },
  });
  assert.equal(receiver(null), null, "no meta tag must yield null");
  assert.equal(receiver({ content: "" }), null, "empty meta content must yield null");
  assert.equal(receiver({ content: "injected" }), "injected", "meta content is the receiver");
});
