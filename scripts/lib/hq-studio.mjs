// Studio preferences are human routing inputs, never a second scheduler.
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';

const empty = () => ({ version: 1, revision: 0, order: [], rules: { requireEvidence: true, maxAgeDays: 30, minimumSamples: 3, qualityWeight: 80 }, evidence: [] });
export function readRouting(root) {
  const file = join(root, '.pa', 'studio-routing.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : empty();
}
export function validateRouting(value) {
  if (!value || value.version !== 1 || !Number.isInteger(value.revision) || value.revision < 0) throw new Error('Ungültige Routing-Version.');
  if (!Array.isArray(value.order) || value.order.length > 100 || new Set(value.order).size !== value.order.length || value.order.some(x => typeof x !== 'string' || !/^[a-z0-9-]{1,100}$/.test(x))) throw new Error('Ungültige Profilreihenfolge.');
  const r = value.rules;
  if (!r || typeof r.requireEvidence !== 'boolean' || !Number.isInteger(r.maxAgeDays) || r.maxAgeDays < 1 || r.maxAgeDays > 365 || !Number.isInteger(r.minimumSamples) || r.minimumSamples < 1 || r.minimumSamples > 1000 || !Number.isInteger(r.qualityWeight) || r.qualityWeight < 0 || r.qualityWeight > 100) throw new Error('Ungültige Routing-Regeln.');
  if (!Array.isArray(value.evidence) || value.evidence.length > 200) throw new Error('Maximal 200 Belege.');
  const ids = new Set();
  for (const e of value.evidence) {
    if (!e || ['id', 'profileId', 'task', 'model', 'effort', 'source'].some(k => typeof e[k] !== 'string' || !e[k].trim() || e[k].length > 500) || typeof e.profileSignature !== 'string' || e.profileSignature.length > 16000) throw new Error('Beleg benötigt ID, Profilkonfiguration, Aufgabe, Modell, Effort und Quelle.');
    if (ids.has(e.id)) throw new Error('Doppelte Beleg-ID.');
    ids.add(e.id);
    if (!['code', 'review', 'research', 'design'].includes(e.task) || !['benchmark', 'experience'].includes(e.kind)) throw new Error('Ungültige Belegkategorie.');
    if (!Number.isInteger(e.samples) || e.samples < 1 || e.samples > 100000 || !Number.isInteger(e.passed) || e.passed < 0 || e.passed > e.samples || !Number.isFinite(e.seconds) || e.seconds <= 0 || !Number.isFinite(Date.parse(e.observedAt)) || Date.parse(e.observedAt) > Date.now()) throw new Error('Ungültige Messwerte oder Messzeit.');
  }
  return value;
}
export function saveRouting(root, value) {
  validateRouting(value);
  const previous = readRouting(root);
  if (previous.revision !== value.revision) throw Object.assign(new Error('Routing wurde inzwischen geändert. Neu laden und erneut bearbeiten.'), { status: 409 });
  const next = { version: 1, revision: previous.revision + 1, order: value.order, rules: value.rules, evidence: value.evidence };
  const dir = join(root, '.pa'); mkdirSync(dir, { recursive: true });
  const file = join(dir, 'studio-routing.json'); const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  renameSync(temp, file);
  return next;
}

// Inventory only bounded repository locations. Never read credentials or execute plugins.
export function studioCatalog(root) {
  const skills = [];
  for (const base of ['.agents/skills', '.claude/skills', '.codex/skills', 'src-tauri/resources/skills']) {
    const visit = (dir, depth) => {
      if (depth > 3 || skills.length >= 250 || !existsSync(dir) || lstatSync(dir).isSymbolicLink()) return;
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, ent.name);
        if (ent.isDirectory()) visit(file, depth + 1);
        if (ent.isFile() && ent.name === 'SKILL.md' && skills.length < 250) {
          const path = relative(root, file).replaceAll('\\', '/');
          skills.push({ path, name: path.split('/').at(-2), source: base });
        }
      }
    };
    visit(join(root, base), 0);
  }
  let plugins = [];
  const settings = join(root, '.claude', 'settings.json');
  if (existsSync(settings) && !lstatSync(settings).isSymbolicLink()) {
    const doc = JSON.parse(readFileSync(settings, 'utf8'));
    plugins = Object.entries(doc.enabledPlugins || {}).map(([name, enabled]) => ({ name, enabled: enabled === true, source: '.claude/settings.json' }));
  }
  return { repository: root, generatedAt: new Date().toISOString(), skills, plugins, note: 'Repository-Inventar. Benutzerweite Installationen und tatsächlich vom Harness geladene Erweiterungen sind hier nicht attestiert.' };
}

export async function studioRoute(req, res, root, sendJson) {
  const path = req.url.split('?')[0];
  if (path !== '/__hq/studio/routing' && path !== '/__hq/studio/catalog') return false;
  try {
    if (req.method === 'GET') sendJson(res, 200, path.endsWith('routing') ? readRouting(root) : studioCatalog(root));
    else if (req.method === 'PUT' && path.endsWith('routing')) {
      let body = ''; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 200000) throw Object.assign(new Error('Anfrage zu groß.'), { status: 413 }); body += chunk; }
      sendJson(res, 200, saveRouting(root, JSON.parse(body)));
    } else sendJson(res, 405, { error: 'method not allowed' });
  } catch (error) { sendJson(res, error.status || 400, { error: error.message }); }
  return true;
}
