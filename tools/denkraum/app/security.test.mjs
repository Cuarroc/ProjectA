import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const dir = new URL('./', import.meta.url);
const questionsSource = readFileSync(new URL('questions.js', dir), 'utf8');
const ideasSource = readFileSync(new URL('ideas.js', dir), 'utf8');
const META = 'meta[name="decision-desk-root-agent-id"]';
const XSS = '<img src=x onerror=alert(1)><script>document.cookie</script>';
const BAD_PREVIEWS = [
  'https://evil.test/x.png', 'http://evil.test/x.png', '//evil.test/x.png',
  'data:image/png;base64,abc', '/previews/../secret.png',
  '/previews/nested/path.png', 'javascript:alert(1)',
];
const GOOD_PREVIEW = '/previews/local-ok.webp';
const IDS = [
  'idea', 'idea-status', 'thinking', 'thinking-title', 'idea-boundary', 'global-error',
  'filter', 'search', 'count', 'questions', 'connection', 'refresh', 'detail', 'planned',
  'area-now', 'area-think', 'area-plan', 'save-status', 'idea-cards', 'idea-form',
  'idea-title', 'idea-text', 'idea-submit', 'idea-feedback', 'idea-confirm',
  'wb-cards', 'wb-form', 'wb-title', 'wb-text', 'wb-submit', 'wb-feedback', 'wb-confirm',
  'planned-title', 'now',
];

class El {
  constructor(registry, tag, sinks, images) {
    Object.assign(this, {
      tag, registry, sinks, images, children: [], dataset: {},
      value: '', hidden: false, disabled: false, className: '', classList: { add() {} },
      _text: '', _src: undefined,
    });
  }
  set id(value) { this._id = value; this.registry.set(value, this); }
  get id() { return this._id; }
  get textContent() { return this._text || this.children.map(c => c.textContent ?? '').join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get innerHTML() { return this._text; }
  set innerHTML(value) { this.sinks.push(`innerHTML:${value}`); throw new Error('dangerous sink: innerHTML'); }
  set outerHTML(value) { this.sinks.push(`outerHTML:${value}`); throw new Error('dangerous sink: outerHTML'); }
  get src() { return this._src; }
  set src(value) { this.images.push(String(value)); this._src = String(value); }
  append(...kids) { this.children.push(...kids); }
  before() {}
  replaceChildren(...kids) { this.children = kids; this._text = ''; }
  addEventListener() {}
  setAttribute(name, value) {
    if (/^on/i.test(name)) { this.sinks.push(`setAttribute:${name}`); throw new Error(`dangerous sink: setAttribute(${name})`); }
    if (name === 'src') this.src = value;
  }
  getAttribute() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
  remove() {}
  walk(visit) { visit(this); for (const child of this.children) child.walk?.(visit); }
  get selectedOptions() { return []; }
  get firstChild() { return this.children[0] || null; }
}

function load(stateData) {
  const registry = new Map(), sinks = [], images = [];
  const el = tag => new El(registry, tag, sinks, images);
  for (const id of IDS) registry.set(id, el('div'));
  registry.get('filter').value = 'all';
  registry.get('search').value = '';
  registry.get('idea').value = '';
  const sandbox = {
    document: {
      querySelector: sel => sel === META ? { content: 'injected' } : sel === '.question-tools > summary' ? el('summary') : null,
      querySelectorAll: () => [],
      createElement: el,
      getElementById: id => registry.get(id) || el('div'),
      write(...args) { sinks.push(`document.write:${args.join('')}`); throw new Error('dangerous sink: document.write'); },
    },
    window: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async url => {
      if (url === '/api/state') return { ok: true, json: async () => stateData };
      if (url.includes('/api/inbox')) return { status: 404, ok: false, json: async () => ({}) };
      return { ok: true, json: async () => ({}) };
    },
    AbortSignal: { timeout: () => ({}) },
    crypto: { randomUUID: () => 'uuid' },
    setInterval() {}, setTimeout() {}, clearTimeout() {}, clearInterval() {}, console,
  };
  const ctx = createContext(sandbox);
  runInContext(questionsSource, ctx);
  runInContext('let initialLoadPromise = null; const originalLoad = load; load = function() { initialLoadPromise = originalLoad(); return initialLoadPromise; };', ctx);
  runInContext(ideasSource, ctx);
  return { registry, sinks, images, load: () => runInContext('initialLoadPromise', ctx) };
}

function collectText(root) {
  const parts = [];
  root.walk(node => { if (node._text) parts.push(node._text); });
  return parts.join('\n');
}

function executableTags(root) {
  const tags = [];
  root.walk(node => { if (/^(script|iframe|object|embed)$/i.test(node.tag)) tags.push(node.tag); });
  return tags;
}

test('DRSEC: hostile ledger text stays text and previews stay local', async () => {
  const ref = { kind: 'idea', eventId: 'ev1', ideaId: 'i1', ideaRevision: 1 };
  const options = BAD_PREVIEWS.map((image, i) => ({
    id: `bad-${i}`, label: `${XSS}-label-${i}`, rationale: `${XSS}-rationale`,
    impact: XSS, tradeoff: XSS, effort: XSS, reversible: XSS,
    preview: { text: `${XSS}-preview-text`, image },
  }));
  options.push({
    id: 'good', label: 'safe-label', rationale: 'r', impact: 'i', tradeoff: 't',
    effort: 'e', reversible: 'ja', preview: { text: 'local preview', image: GOOD_PREVIEW },
  });
  const state = {
    schemaVersion: 2, revision: 1, answers: [],
    questions: [{
      id: 'Q-xss', title: `${XSS}-title`, context: `${XSS}-context`,
      owner: `${XSS}-owner`, category: `${XSS}-cat`, scope: `${XSS}-scope`,
      source: `${XSS}-source`, uncertainty: `${XSS}-uncertainty`, revision: 1, mode: 'single',
      options, recommendation: { optionIds: ['good'], rationale: `${XSS}-rec" onmouseover="alert(1)"` },
    }],
    ideas: [{ id: 'i1', revisions: [{
      revision: 1, eventId: 'ev1', requestId: 'r1', title: `${XSS}-idea-title`,
      text: `${XSS}-idea-text`, createdAt: '2026-01-01T00:00:00Z', source: `${XSS}-idea-source`,
    }] }],
    receipts: [{ eventRef: ref, rootAgentId: 'injected', rootAcknowledgedAt: '2026-01-02T00:00:00Z', observedProof: `${XSS}-proof` }],
    progress: [{ eventId: 'ev1', currentStatus: 'planned', history: [{ to: 'planned', patchRef: { id: 'p1', revision: 1 } }] }],
    patches: [{
      id: 'p1', revision: 1, label: `${XSS}-patch`, windowText: `${XSS}-window`, reason: `${XSS}-reason`,
      sourceRefs: [ref], authorityMode: 'configured-verifier-attestation', authorityEvidenceRefs: [`${XSS}-evidence`],
    }],
  };

  const harness = load(state);
  await harness.load();

  assert.equal(harness.sinks.length, 0, `dangerous sinks used: ${harness.sinks.join('; ')}`);
  for (const id of ['detail', 'idea-cards', 'questions']) {
    assert.deepEqual(executableTags(harness.registry.get(id)), []);
  }
  const rendered = ['detail', 'idea-cards', 'questions'].map(id => collectText(harness.registry.get(id))).join('\n');
  for (const sample of [
    `${XSS}-title`, `${XSS}-context`, `${XSS}-rec`, `${XSS}-preview-text`,
    `${XSS}-label-0`, `${XSS}-idea-title`, `${XSS}-idea-text`, `${XSS}-proof`,
  ]) {
    assert.match(rendered, new RegExp(sample.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const bad of BAD_PREVIEWS) {
    assert.equal(harness.images.includes(bad), false, `preview must not request ${bad}`);
  }
  assert.deepEqual([...new Set(harness.images)], [GOOD_PREVIEW]);
});
