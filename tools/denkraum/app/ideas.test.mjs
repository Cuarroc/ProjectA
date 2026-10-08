import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";

const dir = new URL("./", import.meta.url);
const source = readFileSync(new URL("ideas.js", dir), "utf8");
const META = 'meta[name="decision-desk-root-agent-id"]';

// Minimal DOM: just enough surface for ideas.js to run its startup and render cards.
class El {
  constructor(registry, tag) {
    Object.assign(this, { tag, registry, children: [], dataset: {}, textContent: "", value: "", hidden: false, disabled: false, className: "", classList: { add() {} } });
  }
  set id(value) { this._id = value; this.registry.set(value, this); }
  get id() { return this._id; }
  append(...kids) { this.children.push(...kids); }
  before() {}
  replaceChildren(...kids) { this.children = kids; }
  addEventListener() {}
  setAttribute() {}
  getAttribute() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
  remove() {}
  find(cls) { return this.className === cls ? this : this.children.map((c) => c.find?.(cls)).find(Boolean); }
}

function load(meta, state) {
  const registry = new Map(), calls = [];
  const el = (tag) => new El(registry, tag);
  for (const id of ["idea", "idea-status", "thinking", "thinking-title", "idea-boundary", "global-error"]) registry.set(id, el("div"));
  const sandbox = {
    document: { querySelector: (sel) => (sel === META ? meta : null), createElement: el },
    window: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    $: (id) => registry.get(id),
    record: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
    strings: (v) => Array.isArray(v) && v.every((s) => typeof s === "string"),
    node: (tag, content, cls) => { const n = el(tag); if (content !== undefined) n.textContent = content; if (cls) n.className = cls; return n; },
    button: (text, fn, cls) => { const b = el("button"); b.textContent = text; b.className = cls || ""; return b; },
    facts: () => el("dl"),
    date: (v) => `at ${v}`,
    load: () => calls.push("load"),
    setInterval() {},
    state, view: null, storageKey: "k", loading: false, posting: false, ideaPosting: false, dataInvalid: false,
    latest: () => undefined, answerCurrent: () => true, renderWB() {},
  };
  const api = runInContext(`${source}\n;({ rootReceiver, strongReceipt, patchFor, renderIdeaState, validIdeaState })`, createContext(sandbox));
  return { ...api, registry, calls };
}

const ref = { kind: "idea", eventId: "ev1", ideaId: "i1", ideaRevision: 1 };
const stateWith = (rootAgentId, extra = {}) => ({
  schemaVersion: 2, answers: [], questions: [],
  ideas: [{ id: "i1", revisions: [{ revision: 1, eventId: "ev1", requestId: "r1", title: "Titel", text: "Text", createdAt: "2026-01-01T00:00:00Z" }] }],
  receipts: [{ eventRef: ref, rootAgentId, rootAcknowledgedAt: "2026-01-02T00:00:00Z", observedProof: "proof-text", ...extra }],
  progress: [{ eventId: "ev1", currentStatus: "planned", history: [{ to: "planned", patchRef: { id: "p1", revision: 1 } }] }],
  patches: [{ id: "p1", revision: 1, label: "l", windowText: "w", reason: "r", sourceRefs: [ref], authorityMode: "configured-verifier-attestation", authorityEvidenceRefs: ["evidence"] }],
});
const receiptText = (ctx) => (ctx.renderIdeaState(), ctx.registry.get("idea-cards").find("idea-receipt")?.textContent);

test("root receiver fails closed without injected id", () => {
  for (const name of readdirSync(dir)) {
    assert.doesNotMatch(readFileSync(new URL(name, dir), "utf8"), /agent-\d+-[a-z0-9]+/i, `${name} holds an agent id`);
  }
  const ctx = load(null, stateWith("injected"));
  assert.equal(ctx.registry.get("thinking-title").textContent, "Ideen entwickeln");
  assert.deepEqual(ctx.calls, ["load"]);
  assert.equal(ctx.rootReceiver, null, "no meta tag must yield null");
  assert.equal(load({ content: "" }, null).rootReceiver, null, "empty meta content must yield null");
  assert.equal(load({ content: "injected" }, null).rootReceiver, "injected");
});

test("strongReceipt and patchFor and rendering reject absent or empty or mismatched root id", () => {
  const cases = [["absent", null, "injected"], ["empty", { content: "" }, ""], ["mismatched", { content: "other-root" }, "injected"]];
  for (const [name, meta, rootAgentId] of cases) {
    const ctx = load(meta, stateWith(rootAgentId));
    assert.equal(ctx.strongReceipt(ref), undefined, `${name}: receipt must be rejected`);
    assert.equal(ctx.patchFor(ref), null, `${name}: patch must be rejected`);
    assert.match(receiptText(ctx), /Rootempfang offen/, `${name}: rendering must show receipt open`);
  }
});

test("strongReceipt and patchFor accept the matching injected root id", () => {
  const ctx = load({ content: "injected" }, stateWith("injected"));
  assert.equal(ctx.strongReceipt(ref).rootAgentId, "injected");
  assert.equal(ctx.patchFor(ref).id, "p1");
  assert.match(receiptText(ctx), /Root empfangen at 2026-01-02T00:00:00Z · proof-text · Für Patch geplant/);
});

test("strongReceipt still requires proof and valid time and matching event and schema v2", () => {
  const meta = { content: "injected" };
  assert.equal(load(meta, stateWith("injected", { observedProof: " " })).strongReceipt(ref), undefined);
  assert.equal(load(meta, stateWith("injected", { rootAcknowledgedAt: "not a date" })).strongReceipt(ref), undefined);
  assert.equal(load(meta, stateWith("injected")).strongReceipt({ ...ref, eventId: "ev2" }), undefined);
  assert.equal(load(meta, { ...stateWith("injected"), schemaVersion: 1 }).strongReceipt(ref), null);
});

test("validIdeaState rejects a receipt without a string root id", () => {
  const ctx = load({ content: "injected" }, null);
  assert.equal(ctx.validIdeaState(stateWith("injected")), true);
  assert.equal(ctx.validIdeaState(stateWith(null)), false, "a null root id would otherwise equal an absent receiver");
});
