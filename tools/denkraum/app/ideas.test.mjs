import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";

const dir = new URL("./", import.meta.url);
const questionsSource = readFileSync(new URL("questions.js", dir), "utf8");
const ideasSource = readFileSync(new URL("ideas.js", dir), "utf8");
const META = 'meta[name="decision-desk-root-agent-id"]';

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
  get selectedOptions() { return []; }
  get firstChild() { return this.children[0] || null; }
}

function load(meta, stateData, questionsScript = questionsSource) {
  const registry = new Map();
  const el = (tag) => new El(registry, tag);
  for (const id of ["idea", "idea-status", "thinking", "thinking-title", "idea-boundary", "global-error", "filter", "search", "count", "questions", "connection", "refresh", "detail", "planned", "area-now", "area-think", "area-plan", "save-status", "idea-cards", "idea-form", "idea-title", "idea-text", "idea-submit", "idea-feedback", "idea-confirm", "wb-cards", "wb-form", "wb-title", "wb-text", "wb-submit", "wb-feedback", "wb-confirm", "planned-title"]) {
    registry.set(id, el("div"));
  }
  
  const sandbox = {
    document: { 
      querySelector: (sel) => {
        if (sel === META) return meta;
        if (sel === '.question-tools > summary') return el("summary");
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel === '.event-status') return [];
        return [];
      },
      createElement: el,
      getElementById: (id) => registry.get(id) || el("div")
    },
    window: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async (url) => {
      if (url === '/api/state') {
        if (stateData === "network-error") throw new Error("Network Error");
        return { ok: true, json: async () => stateData };
      }
      return { ok: true, json: async () => ({}) };
    },
    AbortSignal: { timeout: () => ({}) },
    crypto: { randomUUID: () => "uuid" },
    setInterval: () => {},
    setTimeout: () => {},
    clearTimeout: () => {},
    clearInterval: () => {},
    console: console,
  };
  
  const ctx = createContext(sandbox);
  runInContext(questionsScript, ctx);
  runInContext('let initialLoadPromise = null; const originalLoad = load; load = function() { initialLoadPromise = originalLoad(); return initialLoadPromise; };', ctx);
  runInContext(ideasSource, ctx);
  
  return {
    registry,
    ctx,
    load: () => runInContext('initialLoadPromise', ctx),
    get rootReceiver() { return runInContext('rootReceiver', ctx); },
    strongReceipt: (ref) => runInContext(`strongReceipt(${JSON.stringify(ref)})`, ctx),
    patchFor: (ref) => runInContext(`patchFor(${JSON.stringify(ref)})`, ctx),
    renderIdeaState: () => runInContext('renderIdeaState()', ctx),
    validIdeaState: (s) => runInContext(`validIdeaState(${JSON.stringify(s)})`, ctx),
    get dataInvalid() { return runInContext('dataInvalid', ctx); },
    get state() { return runInContext('state', ctx); }
  };
}

const ref = { kind: "idea", eventId: "ev1", ideaId: "i1", ideaRevision: 1 };
const stateWith = (rootAgentId, extra = {}) => ({
  schemaVersion: 2, revision: 1, answers: [], questions: [],
  ideas: [{ id: "i1", revisions: [{ revision: 1, eventId: "ev1", requestId: "r1", title: "Titel", text: "Text", createdAt: "2026-01-01T00:00:00Z" }] }],
  receipts: [{ eventRef: ref, rootAgentId, rootAcknowledgedAt: "2026-01-02T00:00:00Z", observedProof: "proof-text", ...extra }],
  progress: [{ eventId: "ev1", currentStatus: "planned", history: [{ to: "planned", patchRef: { id: "p1", revision: 1 } }] }],
  patches: [{ id: "p1", revision: 1, label: "l", windowText: "w", reason: "r", sourceRefs: [ref], authorityMode: "configured-verifier-attestation", authorityEvidenceRefs: ["evidence"] }],
});
const receiptText = (ctx) => (ctx.renderIdeaState(), ctx.registry.get("idea-cards").find("idea-receipt")?.textContent);

test("root receiver fails closed without injected id", async () => {
  for (const name of readdirSync(dir)) {
    assert.doesNotMatch(readFileSync(new URL(name, dir), "utf8"), /agent-\d+-[a-z0-9]+/i, `${name} holds an agent id`);
  }
  const ctx = load(null, stateWith("injected"));
  await ctx.load();
  assert.equal(ctx.registry.get("thinking-title").textContent, "Ideen entwickeln");
  assert.equal(ctx.rootReceiver, null, "no meta tag must yield null");
  
  const ctx2 = load({ content: "" }, null); await ctx2.load();
  assert.equal(ctx2.rootReceiver, null, "empty meta content must yield null");
  
  const ctx3 = load({ content: "injected" }, null); await ctx3.load();
  assert.equal(ctx3.rootReceiver, "injected");
});

test("strongReceipt and patchFor and rendering reject absent or empty or mismatched root id", async () => {
  const cases = [["absent", null, "injected"], ["empty", { content: "" }, ""], ["mismatched", { content: "other-root" }, "injected"]];
  for (const [name, meta, rootAgentId] of cases) {
    const ctx = load(meta, stateWith(rootAgentId));
    await ctx.load();
    assert.equal(ctx.strongReceipt(ref), undefined, `${name}: receipt must be rejected`);
    assert.equal(ctx.patchFor(ref), null, `${name}: patch must be rejected`);
    assert.match(receiptText(ctx), /Rootempfang offen/, `${name}: rendering must show receipt open`);
  }
});

test("strongReceipt and patchFor accept the matching injected root id", async () => {
  const ctx = load({ content: "injected" }, stateWith("injected"));
  await ctx.load();
  assert.equal(ctx.strongReceipt(ref).rootAgentId, "injected");
  assert.equal(ctx.patchFor(ref).id, "p1");
  assert.match(receiptText(ctx), /Root empfangen .* · proof-text · Für Patch geplant/);
});

test("strongReceipt still requires proof and valid time and matching event and schema v2", async () => {
  const meta = { content: "injected" };
  const ctx1 = load(meta, stateWith("injected", { observedProof: " " })); await ctx1.load();
  assert.equal(ctx1.strongReceipt(ref), undefined);
  
  const ctx2 = load(meta, stateWith("injected", { rootAcknowledgedAt: "not a date" })); await ctx2.load();
  assert.equal(ctx2.strongReceipt(ref), undefined);
  
  const ctx3 = load(meta, stateWith("injected")); await ctx3.load();
  assert.equal(ctx3.strongReceipt({ ...ref, eventId: "ev2" }), undefined);
  
  const ctx4 = load(meta, { ...stateWith("injected"), schemaVersion: 1 }); await ctx4.load();
  assert.equal(ctx4.strongReceipt(ref), null);
});

test("validIdeaState rejects a receipt without a string root id", async () => {
  const ctx = load({ content: "injected" }, null);
  await ctx.load();
  assert.equal(ctx.validIdeaState(stateWith("injected")), true);
  assert.equal(ctx.validIdeaState(stateWith(null)), false, "a null root id would otherwise equal an absent receiver");
});

test("valid startup renders", async () => {
  const ctx = load({ content: "injected" }, stateWith("injected"));
  await ctx.load();
  assert.equal(ctx.dataInvalid, false);
  assert.match(ctx.registry.get("connection").textContent, /Aktualisiert/);
  assert.equal(ctx.registry.get("planned-title").textContent, "Was als Nächstes ansteht");
});

test("invalid state is rejected", async () => {
  const ctx = load({ content: "injected" }, { ...stateWith("injected"), schemaVersion: 3 });
  await ctx.load();
  assert.equal(ctx.dataInvalid, true);
  assert.match(ctx.registry.get("global-error").textContent, /Unbekanntes oder unvollständiges Datenformat/);
});

test("broken questions.js makes the test red", async () => {
  assert.throws(() => load({ content: "injected" }, stateWith("injected"), "throw new Error('split script startup broken')"), /split script startup broken/);
});
