#!/usr/bin/env node
// Reiht die offenen Punkte aus `.pa/report_devhq_setup_2026-09-15.md` §4a als
// echte Fix-Tasks in die Queue der laufenden App ein — derselbe Weg wie
// "Human Controls → task to queue" im Live-HQ (`POST /api/queue`), nur
// skriptbar und idempotent. AGENTS.md verlangt genau das: ein BUGS.md-Eintrag
// ohne Queue-Task ist eine Beobachtung, kein eingereihter Fix.
//
//   node scripts/hq-queue-open-points.mjs            # Vorschau, schreibt nichts
//   node scripts/hq-queue-open-points.mjs --apply    # reiht ein
//   node scripts/hq-queue-open-points.mjs --project pj-1 --apply
//
// Der Deskriptor der laufenden App wird wie in hq-live.mjs gesucht
// (PROJECTA_API_DESCRIPTOR, PROJECTA_APP_DATA, %APPDATA%/com.projecta.app, …).
// Ohne laufende App bricht das Skript ab; es erfindet keinen Eintrag.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const BUG_LOG = 'docs/dev-hq/BUGS.md';
const REPORT = '.pa/report_devhq_setup_2026-09-15.md';

// Reihenfolge = Dringlichkeit. Priorität ist die ganze Zahl der Queue
// (höher = früher); 0 ist der Queue-Standard.
// Erledigte Punkte fliegen hier raus, sonst startet `--apply` einen Worker auf
// einen Bug, den es nicht mehr gibt. Kimi-Zustellung (NT-17): gelöst in W1-01,
// PR #50, Beleg `.pa/report_kimi_raw_stream_2026-09-16.md`.
export const OPEN_POINT_TASKS = [
  {
    key: 'opencode-delivery-nt17',
    priority: 3,
    text: 'OpenCode-Zustellung (NT-17): drei Writes des Guards landen nicht im Composer, Ausführung nur nach manueller Zustellung (Gratis-Route GLM-5.3-Flash belegt). Composer-Marker und Echo-Pfad für OpenCode erfassen und im Guard verdrahten',
  },
  {
    key: 'response-marker-baustein-b',
    priority: 2,
    text: 'Baustein B Antwort-Marker: seit v1.3.0 gibt es kein "task delivery confirmed" mehr, die Bestätigung über den Antwort-Marker des Profils ist noch nicht verdrahtet. Marker im Profil, Erkennung im Status-Event, Statusübergang im Verlauf',
  },
  {
    key: 'flake-delivery-recovery',
    priority: 2,
    text: 'Flake delivery_recovery::tests::every_interrupted_phase_has_one_deterministic_next_action ist unter Volllast einmal rot (STAND 14.09.). Lastabhängigkeit isolieren und den Test deterministisch machen, kein Skip',
  },
  {
    key: 'windows-pty-argument-test',
    priority: 2,
    text: 'Windows-PTY-Argumenttest in CI 34721209783 scheiterte, Ursache offen (STAND 13.09.). Escaped-Ausgabe auswerten, Ursache benennen, Regression fixen',
  },
  {
    key: 'capture-settlement-transport',
    priority: 1,
    text: 'Capture-Settlement: nativer Transport und der Identity-/Recovery-Vertrag bleiben offen (BUGS.md 11.09., .pa/report_continuous_capture_atomicity.md). Vertrag ausformulieren, Regressionen für Route-Wechsel während Settlement',
  },
  {
    key: 'capacity-resource-pressure',
    priority: 1,
    text: 'Cross-Project-Kapazität: Ressourcendruck-Adaption und operativer Dispatch fehlen (BUGS.md 11.09., .pa/report_continuous_capacity.md). CPU/RAM-Druck in die Claim-Entscheidung einbeziehen, Beleg unter Last',
  },
  {
    key: 'matrix-table-state',
    priority: 0,
    text: 'Abnahmematrix: die 27 Tabellenzeilen tragen noch "Remaining"-Text, der Zustand steht nur in den Prosa-Updates (.pa/continuous_acceptance_matrix.md). Tabelle auf belegt/blockiert/gegatet bringen, Zeile "Windows/Linux gates" mit Tag-Run 34971765964 schließen',
  },
];

export function buildQueueRequests(tasks, projectId, existing) {
  const live = new Set(
    (existing || [])
      .filter(entry => (entry.projectId ?? entry.project_id) === projectId)
      .filter(entry => !['cancelled', 'canceled', 'failed', 'done', 'completed'].includes(String(entry.status || '').toLowerCase()))
      .map(entry => entry.rawText ?? entry.raw_text),
  );
  return tasks
    .map(task => ({ projectId, rawText: `HQ-Bug: ${task.text}, siehe ${BUG_LOG} und ${REPORT}`, priority: task.priority }))
    .filter(request => !live.has(request.rawText));
}

export function chooseProject(projects, wanted) {
  if (wanted) {
    const match = projects.find(project => project.id === wanted);
    if (!match) throw new Error(`Projekt ${wanted} ist in der laufenden App nicht registriert (${projects.map(p => p.id).join(', ') || 'keins'})`);
    return match;
  }
  if (projects.length === 1) return projects[0];
  throw new Error(`Mehrere Projekte registriert, bitte --project <id> angeben: ${projects.map(p => `${p.id} (${p.name ?? '?'})`).join(', ') || 'keins'}`);
}

function descriptorCandidates(env = process.env) {
  if (env.PROJECTA_API_DESCRIPTOR) return [env.PROJECTA_API_DESCRIPTOR];
  if (env.PROJECTA_APP_DATA) return [join(env.PROJECTA_APP_DATA, 'projecta-api.json')];
  const candidates = [];
  if (env.APPDATA) candidates.push(join(env.APPDATA, 'com.projecta.app', 'projecta-api.json'));
  const xdg = env.XDG_DATA_HOME || (env.HOME ? join(env.HOME, '.local', 'share') : null);
  if (xdg) candidates.push(join(xdg, 'com.projecta.app', 'projecta-api.json'));
  candidates.push(join(env.HOME || homedir(), 'Library', 'Application Support', 'com.projecta.app', 'projecta-api.json'));
  return candidates;
}

function readDescriptor() {
  const path = descriptorCandidates().find(candidate => existsSync(candidate));
  if (!path) throw new Error('Kein projecta-api.json gefunden: ProjectA läuft nicht (oder PROJECTA_API_DESCRIPTOR setzen)');
  const descriptor = JSON.parse(readFileSync(path, 'utf8'));
  if (!Number.isInteger(descriptor.port) || typeof descriptor.token !== 'string' || !descriptor.token) throw new Error(`Deskriptor ${path} ist ungültig`);
  return descriptor;
}

async function api(descriptor, method, path, body) {
  const response = await fetch(`http://127.0.0.1:${descriptor.port}${path}`, {
    method,
    headers: { 'x-projecta-token': descriptor.token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → HTTP ${response.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

export async function main(argv = process.argv.slice(2)) {
  let apply = false;
  let wanted = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') apply = true;
    else if (argv[i] === '--project') wanted = argv[++i] || null;
    else throw new Error('Usage: hq-queue-open-points.mjs [--project <id>] [--apply]');
  }
  const descriptor = readDescriptor();
  const projects = await api(descriptor, 'GET', '/api/projects');
  const project = chooseProject(Array.isArray(projects) ? projects : [], wanted);
  const existing = await api(descriptor, 'GET', '/api/queue');
  const requests = buildQueueRequests(OPEN_POINT_TASKS, project.id, Array.isArray(existing) ? existing : []);
  console.log(`Projekt ${project.id} (${project.name ?? '?'}): ${requests.length} von ${OPEN_POINT_TASKS.length} Punkten noch nicht in der Queue.`);
  for (const request of requests) console.log(`  [p${request.priority}] ${request.rawText.slice(0, 110)}…`);
  if (!apply) {
    console.log('Vorschau. Mit --apply einreihen.');
    return 0;
  }
  const created = [];
  for (const request of requests) {
    const entry = await api(descriptor, 'POST', '/api/queue', request);
    created.push(entry?.id ?? '?');
    console.log(`  eingereiht: ${entry?.id ?? '?'}`);
  }
  console.log(`Fertig: ${created.length} Queue-Einträge angelegt. Bitte die IDs in ${BUG_LOG} unter "Queue:" nachtragen.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
