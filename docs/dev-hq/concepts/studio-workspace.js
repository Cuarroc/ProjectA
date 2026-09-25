/* Human client of the existing HQ proxy. No browser scheduler or fake runtime. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = { view: 'overview', project: '', generation: 0, cache: {}, errors: {}, profiles: [], session: {}, sessionProfiles: {}, drafts: {}, context: {}, refreshEpoch: 0, skills: new Set(), plugins: new Set(), selectedProfile: '', mode: 'plan', range: 'week', pending: false, timer: null, roadmap: { projectId: '', epoch: 0, status: 'idle', envelope: null, error: '', selected: '', view: 'graph', sort: 'document', sourceOpen: false, removedOpen: false, reason: '', reasonRequired: false, reasonOpen: false, importing: false } };
  state.chatAppearance = 'deepseek';
  const token = $('meta[name="hq-session"]')?.content;
  const api = (path, method = 'GET', body, headers) => request('/__hq/api' + path, method, body, headers);
  async function request(path, method = 'GET', body, extraHeaders = {}) {
    if (!token) throw new Error('HQ-Host fehlt. Studio über npm run hq:live öffnen; eine portable Datei hat keinen Runtime-Zugang.');
    const response = await fetch(path, { method, headers: { ...extraHeaders, 'x-hq-session': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    if (!response.ok) { const error = new Error(`${response.status}: ${data.error || 'Anfrage fehlgeschlagen'}`); error.status = response.status; error.detail = data.error; throw error; }
    return data;
  }
  function notice(text, error = false) { $('#notice').hidden = !text; $('#notice').textContent = text; $('#notice').classList.toggle('error', error); }
  function on(id, fn, event = 'click') { const node = $('#' + id); if (node) node.addEventListener(event, fn); }
  function action(id, fn, event = 'click') { on(id, async e => { e.preventDefault(); const node = e.currentTarget; node.disabled = true; try { await fn(e); } catch (error) { notice(error.message, true); } finally { if (node.isConnected) node.disabled = false; } }, event); }
  const source = text => `<p class="source">${esc(text)}</p>`;
  const panel = (title, content) => `<section class="panel"><h2>${esc(title)}</h2>${content}</section>`;
  const field = (label, id, value = '', type = 'text') => `<label class="field"><span>${esc(label)}</span><input id="${id}" type="${type}" value="${esc(value)}"></label>`;
  const select = (label, id, options, value) => `<label class="field"><span>${esc(label)}</span><select id="${id}">${options.map(([id, text]) => `<option value="${esc(id)}" ${id === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  const textArea = (label, id, value = '') => `<label class="field"><span>${esc(label)}</span><textarea id="${id}">${esc(value)}</textarea></label>`;
  const empty = text => `<p class="empty">${esc(text)}</p>`;
  const badge = (text, cls = '') => `<span class="badge ${cls}">${esc(text)}</span>`;
  const json = x => `<pre>${esc(JSON.stringify(x, null, 2))}</pre>`;
  const details = (label, value) => `<details><summary>${esc(label)}</summary>${json(value)}</details>`;
  const rows = (items, fn) => items.length ? items.map(fn).join('') : empty('Keine Einträge vorhanden.');
  function status(key) { return state.errors[key] ? `<p class="error">${esc(state.errors[key])}</p>` : ''; }
  const num = n => typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('de-DE') : 'Nicht gemessen';
  const measures = entries => `<div class="measurements">${entries.map(([label, value]) => `<div class="measurement"><strong class="${typeof value === 'number' ? '' : 'unmeasured'}">${esc(num(value))}</strong><span>${esc(label)}</span></div>`).join('')}</div>`;
  function table(headers, values, caption = '') { return `<div class="table-scroll"><table>${caption ? `<caption>${esc(caption)}</caption>` : ''}<thead><tr>${headers.map(x => `<th scope="col">${esc(x)}</th>`).join('')}</tr></thead><tbody>${values.map(row => `<tr>${row.map(x => `<td>${esc(x ?? 'Nicht gemessen')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
  function profileOptions() { return state.profiles.filter(p => p.enabled !== false).map(p => [p.id, `${p.name} · ${p.id}`]); }
  function currentProject() { return (state.cache.projects || []).find(p => p.id === state.project); }
  function rememberDraft() {
    if (!$('#message')) return;
    const pid = state.renderedProject ?? state.project;
    state.drafts[pid] = $('#message').value;
    state.context[pid] = Object.fromEntries(['files', 'proof', 'goal', 'constraints'].map(k => [k, $('#chat-' + k)?.value || '']));
  }
  function show(view) {
    rememberDraft(); clearTimeout(state.timer); state.view = view;
    document.querySelectorAll('nav [data-view]').forEach(b => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
    render();
    $('#main').focus({ preventScroll: true });
    $('#main').scrollIntoView?.({ block: 'start', behavior: 'instant' });
  }
  async function load(key, promise, generation = state.generation) {
    try { const result = await promise; if ((generation === null || generation === state.generation)) { state.cache[key] = result; delete state.errors[key]; } }
    catch (error) { if ((generation === null || generation === state.generation)) { delete state.cache[key]; state.errors[key] = error.message; } }
  }
  async function loadProject() {
    const generation = ++state.generation;
    for (const key of ['workers', 'tree', 'queue', 'questions', 'projectStats']) { delete state.cache[key]; delete state.errors[key]; }
    if (!state.project) { resetRoadmap(''); return; }
    const id = encodeURIComponent(state.project), query = '?projectId=' + id;
    await Promise.all([load('workers', api('/workers' + query), generation), load('tree', api(`/projects/${id}/tree`), generation), load('queue', api('/queue' + query), generation), load('questions', api('/questions' + query + '&status=open'), generation), load('projectStats', api(`/projects/${id}/stats?range=${state.range}`), generation), loadRoadmap()]);
  }
  function resetRoadmap(projectId) {
    const old = state.roadmap;
    state.roadmap = { projectId, epoch: old.epoch + 1, status: projectId ? 'loading' : 'idle', envelope: null, error: '', selected: '', view: old.view, sort: old.sort, sourceOpen: false, removedOpen: false, reason: '', reasonRequired: false, reasonOpen: false, importing: false };
  }
  async function loadRoadmap() {
    const pid = state.project;
    if (state.roadmap.projectId !== pid) resetRoadmap(pid);
    const roadmap = state.roadmap;
    if (roadmap.importing) return;
    const epoch = ++roadmap.epoch;
    roadmap.status = 'loading'; roadmap.error = '';
    if (state.view === 'roadmap') render();
    try {
      const runtime = await api('/hq/v1/runtime');
      if (state.project !== pid || state.roadmap !== roadmap || epoch !== roadmap.epoch) return;
      if (runtime?.capabilities?.planProjection?.supported !== true || runtime.capabilities.planProjection.contractVersion !== 1) {
        roadmap.status = 'unsupported'; roadmap.error = ''; return;
      }
      const result = await api(`/hq/v1/plan?projectId=${encodeURIComponent(pid)}&planId=main`);
      if (state.project !== pid || state.roadmap !== roadmap || epoch !== roadmap.epoch) return;
      const projection = StudioRoadmap.validate(result, pid);
      roadmap.envelope = result; roadmap.status = 'available';
      if (!projection.packages.some(item => item.packageId === roadmap.selected)) roadmap.selected = projection.packages.find(item => !item.removed)?.packageId || projection.packages[0]?.packageId || '';
    } catch (error) {
      if (state.project !== pid || state.roadmap !== roadmap || epoch !== roadmap.epoch) return;
      const confirmedMissing = error.status === 404 && error.detail === 'unknown project or plan' && (state.cache.projects || []).some(project => project.id === pid);
      roadmap.status = confirmedMissing ? 'missing' : error.code === 'invalid_projection' ? 'invalid' : roadmap.envelope ? 'stale' : error.status === 503 ? 'unavailable' : 'error';
      roadmap.error = confirmedMissing ? '' : error.message;
    } finally { if (state.project === pid && state.roadmap === roadmap && epoch === roadmap.epoch && state.view === 'roadmap') render(); }
  }
  async function importRoadmap() {
    const roadmap = state.roadmap, pid = state.project;
    if (!pid || roadmap.projectId !== pid || !['available', 'missing'].includes(roadmap.status)) return;
    const expectedProjectionRevision = roadmap.status === 'missing' ? 0 : roadmap.envelope.projection.projectionRevision;
    const reason = $('#roadmap-reason')?.value.trim() || '';
    roadmap.reason = reason;
    const epoch = ++roadmap.epoch;
    roadmap.importing = true; roadmap.status = 'loading'; roadmap.error = ''; render();
    try {
      const result = await api('/hq/v1/plan/import', 'POST', { projectId: pid, planId: 'main', expectedProjectionRevision, ...(reason ? { rollbackReason: reason } : {}) });
      if (state.project !== pid || state.roadmap !== roadmap || epoch !== roadmap.epoch) return;
      StudioRoadmap.validate(result, pid);
      roadmap.envelope = result; roadmap.status = 'available'; roadmap.error = ''; roadmap.reason = ''; roadmap.reasonRequired = false; roadmap.reasonOpen = false;
      if (!result.projection.packages.some(item => item.packageId === roadmap.selected)) roadmap.selected = result.projection.packages.find(item => !item.removed)?.packageId || result.projection.packages[0]?.packageId || '';
    } catch (error) {
      if (state.project !== pid || state.roadmap !== roadmap || epoch !== roadmap.epoch) return;
      const reasonRequired = error.status === 409 && /nonempty rollback reason/.test(error.detail || '') && !!roadmap.envelope;
      roadmap.reasonRequired = reasonRequired;
      if (reasonRequired) roadmap.reasonOpen = true;
      roadmap.status = reasonRequired ? 'available' : error.code === 'invalid_projection' || error.status === 422 ? 'invalid' : error.status === 409 && roadmap.envelope ? 'stale' : 'unknown';
      roadmap.error = error.message + (reasonRequired ? ' Grund eingeben und ausdrücklich erneut auslösen.' : ' Vor erneutem Import neu laden.');
    } finally {
      if (state.project === pid && state.roadmap === roadmap && epoch === roadmap.epoch) {
        roadmap.importing = false;
        if (state.view === 'roadmap') render();
      }
    }
  }
  async function refresh() {
    rememberDraft(); $('#refresh').disabled = true; $('#connection').textContent = 'Verbindung wird geprüft …';
    const epoch = ++state.refreshEpoch;
    const globalLoad = (key, promise) => load(key, promise, null);
    await Promise.all([
      globalLoad('projects', api('/projects')), globalLoad('profileDoc', request('/__hq/profiles')), globalLoad('quota', api('/quota')),
      globalLoad('providers', api('/providers')), globalLoad('budgets', api('/budgets')), globalLoad('usage', api('/usage?limit=100')),
      globalLoad('stats', request('/__hq/stats')), globalLoad('analysis', request('/__hq/analysis')), globalLoad('insights', request('/__hq/insights')),
      globalLoad('routing', request('/__hq/studio/routing')), globalLoad('catalog', request('/__hq/studio/catalog')), globalLoad('lessons', request('/__hq/lessons?limit=100')),
    ]);
    if (epoch !== state.refreshEpoch) return;
    rememberDraft();
    state.profiles = state.cache.profileDoc?.profiles || [];
    if (!state.profiles.some(p => p.id === state.selectedProfile)) state.selectedProfile = profileOptions()[0]?.[0] || '';
    const projects = state.cache.projects || [];
    state.project = projects.some(p => p.id === state.project) ? state.project : projects[0]?.id || '';
    $('#project').innerHTML = projects.length ? projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('') : '<option value="">Keine Runtime-Projekte verfügbar</option>';
    $('#project').value = state.project;
    await loadProject();
    $('#connection').dataset.state = state.errors.projects ? 'offline' : 'connected';
    $('#connection').textContent = state.errors.projects ? 'Runtime nicht erreichbar · lokale HQ-Daten verfügbar, sofern geladen' : 'Runtime verbunden · ' + projects.length + ' Projekte';
    $('#last-read').textContent = 'Abfrage: ' + new Date().toLocaleTimeString('de-DE');
    $('#refresh').disabled = false; rememberDraft(); render();
  }
  async function confirm(title, value) {
    const dialog = $('#confirm'); $('#confirm-title').textContent = title; $('#confirm-detail').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }); dialog.returnValue = ''; dialog.showModal(); });
  }
  function requireProject() { if (!state.project) throw new Error('Zuerst ein verbundenes Runtime-Projekt auswählen.'); return state.project; }
  function overview() {
    const workers = state.cache.workers || [], queue = state.cache.queue || [], questions = state.cache.questions || [];
    if (!state.project && !state.errors.projects) return `<h1>Übersicht</h1><p class="lead">Aufträge, Zuständigkeiten und die nächste Entscheidung an einem Ort.</p><section class="panel project-empty"><div><h2>Ein Repository verbinden</h2><p class="muted">${state.cache.projects ? 'Die Runtime ist verbunden. Registriere ein Projekt, um Sitzungen, Aufträge und Rückfragen hier zu steuern.' : 'Die Runtime wird geprüft. Repository-Daten erscheinen nach der Abfrage.'}</p></div><button class="primary" data-open="settings">Projekt verbinden</button></section><div class="two">${panel('Ausführung vorbereiten', '<p class="muted">Profile und Routing stehen auch ohne ausgewähltes Projekt bereit.</p><div class="actions"><button data-open="settings">Harness prüfen</button><button data-open="capacity">Kapazität & Routing</button></div>')}${panel('Repository-Wissen', '<p class="muted">Lessons und Analyse beziehen sich auf das Repository des HQ-Hosts.</p><div class="actions"><button data-open="lessons">Lessons öffnen</button><button data-open="analysis">Projektanalyse</button></div>')}</div>`;
    return `<h1>Arbeit mit Überblick.</h1><p class="lead">${esc(currentProject()?.name || 'Dein Studio')} · Aufträge, Zuständigkeiten und die nächste Entscheidung an einem Ort.</p>${status('projects')}${status('workers')}${measures([['Worker im Projekt', state.cache.workers ? workers.length : null], ['Queue-Einträge', state.cache.queue ? queue.length : null], ['Offene Rückfragen', state.cache.questions ? questions.length : null]])}<div class="layout"><div>${panel('Nächste Schritte', rows(questions.slice(0, 4), q => `<div class="row"><div><h3>${esc(q.question)}</h3>${badge('Antwort benötigt', 'warn')}</div><button data-open="queue">Beantworten</button></div>`) + '<div class="actions"><button class="primary" data-open="chat">Code-Sitzung öffnen</button><button data-open="capacity">Route prüfen</button></div>')}${panel('Aktuelle Arbeit', workerRows(workers.slice(0, 5)))}</div><aside>${panel('Projektkontext', currentProject() ? `<h3>${esc(currentProject().name)}</h3><p class="micro">${esc(currentProject().repoPath)}</p><p>Neue Sitzungen laufen über die bestehende Worker-Admission. Plan und Interview werden als explizite Arbeitsanweisung übergeben.</p>${source('/api/projects · /api/workers · /api/questions')}` : empty(state.errors.projects ? 'Runtime-Projekte konnten noch nicht geladen werden.' : 'Noch kein Repository registriert.') + '<button data-open="settings">Projekt verbinden</button>')}${panel('Wissen wiederverwenden', '<p>Lessons durchsuchen, passende Skills auswählen und das Harness vor dem nächsten Auftrag prüfen.</p><div class="actions"><button data-open="lessons">Lessons</button><button data-open="extensions">Skills & Plugins</button></div>')}</aside></div>`;
  }
  function workerRows(workers) { return rows(workers, w => `<div class="row"><div><h3>${esc(w.task)}</h3><p class="micro">${esc(w.profileId)} · ${esc(w.branch)} · ${esc(w.id)}</p>${badge(w.status)} ${w.testStatus ? badge('Test: ' + w.testStatus) : ''}</div><button class="small" data-session="${esc(w.id)}">Sitzung öffnen</button></div>`); }
  function chatAppearanceControls() {
    const options = [['codex', 'Codex · Protokoll'], ['claude', 'Claude · Lesespalte'], ['deepseek', 'DeepSeek · Dialog']];
    return `<fieldset id="chat-appearance" class="chat-appearance" aria-describedby="chat-appearance-help"><legend>Chat-Darstellung</legend><div class="appearance-options">${options.map(([id, label]) => `<label class="appearance-option"><input type="radio" name="chat-appearance" value="${id}" ${state.chatAppearance === id ? 'checked' : ''}><span class="appearance-sketch ${id}" aria-hidden="true"><i></i><i></i><i></i></span><span>${label}</span></label>`).join('')}</div><p id="chat-appearance-help" class="micro">Nur die lokale Ansicht. Modell, Harness und Berechtigungen bleiben unverändert.</p></fieldset>`;
  }
  function chat() {
    const session = state.session[state.project];
    const context = state.context[state.project] || {};
    const activeProfile = state.sessionProfiles[state.project] || (state.cache.workers || []).find(w => w.id === session)?.profileId;
    const chatProfile = session ? (activeProfile || '') : state.selectedProfile;
    return `<div class="code-title"><h1>Code-Chat</h1>${badge(session ? 'Worker ' + session : 'Neue Sitzung')}</div><p class="lead">Vom Klären zum Plan. Vom Plan zum überprüfbaren Auftrag.</p><div class="layout chat-layout"><section class="panel chat-workspace"><div class="two">${select('Harness / CLI-Profil', 'chat-profile', profileOptions(), chatProfile)}${select('Arbeitsmodus', 'chat-mode', [['plan', 'Plan erstellen'], ['interview', 'Interview & Rückfragen'], ['build', 'Implementieren']], state.mode)}</div><p class="micro">Plan und Interview sind Agentenanweisungen, keine technische Schreibsperre. Rechte und native Plan-Flags werden im Harness konfiguriert.</p>${chatAppearanceControls()}<div class="actions session-actions"><button class="small quiet" id="new-session" ${!session ? 'disabled hidden' : ''}>Neue getrennte Sitzung</button><button class="small quiet" id="read-messages" ${!session ? 'disabled hidden' : ''}>Nachrichten abrufen</button><button class="small quiet" data-open="teams">Bestehende Sitzung wählen</button></div><div id="chat-log" class="chat-log ${session ? '' : 'is-empty'}" role="log" aria-label="Nachrichten der gewählten Sitzung">${session ? empty('Nachrichten werden geladen …') : `<div class="chat-welcome"><h2>${state.project ? 'Was soll sich im Projekt ändern?' : 'Projekt für die Sitzung auswählen'}</h2><p>${state.project ? 'Formuliere Ziel und Abnahme. Vor dem Start prüfst du Auftrag und Harness.' : 'Verbinde zuerst ein Runtime-Projekt. Danach kannst du den Auftrag und die Abnahme für diese Sitzung formulieren.'}</p>${state.project ? '' : '<button class="small" data-open="settings">Projekt verbinden</button>'}</div>`}</div><form id="chat-form" class="composer">${textArea('Nachricht', 'message', state.drafts[state.project] || '')}<div class="actions end"><span class="micro" id="send-state"></span><button class="primary" ${!state.project || state.pending ? 'disabled' : ''}>${session ? 'Nachricht senden' : 'Sitzung starten'}</button></div></form>${source('Nachrichten: /api/workers/<id>/messages · keine erfundenen Modellantworten')}</section><aside>${panel('Auftrag schärfen', field('Dateiumfang', 'chat-files', context.files || '') + field('Abnahmekriterium', 'chat-proof', context.proof || '') + textArea('Projektziel', 'chat-goal', context.goal || '') + textArea('Randbedingungen', 'chat-constraints', context.constraints || '') + '<button id="interview-seed">Interview vorbereiten</button>')}${panel('Sitzungskontext', `<p>${state.skills.size} Skill-Quellen · ${state.plugins.size} Plugins ausgewählt.</p><div class="actions"><button data-open="extensions">Skills auswählen</button><button data-open="settings">Harness bearbeiten</button></div><p class="micro">Ein Harness-Wechsel erzeugt eine neue Sitzung. Bestehende PTYs werden nicht umkonfiguriert.</p>`)}</aside></div>`;
  }
  async function readMessages() {
    clearTimeout(state.timer);
    const pid = state.project, id = state.session[pid], generation = state.generation;
    if (!id || state.view !== 'chat') return;
    try {
      const messages = await api(`/workers/${encodeURIComponent(id)}/messages?limit=100`);
      if (pid !== state.project || generation !== state.generation || state.view !== 'chat' || id !== state.session[pid]) return;
      const log = $('#chat-log'), nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 70;
      const content = rows(messages, m => `<article class="message ${m.role === 'user' ? 'user' : ''}"><small>${esc(m.role)} · ${esc(new Date(m.createdAt * 1000).toLocaleTimeString('de-DE'))}</small>${esc(m.content)}</article>`);
      if (log.innerHTML !== content) { log.innerHTML = content; if (nearBottom) log.scrollTop = log.scrollHeight; }
    } catch (error) { if (pid === state.project && state.view === 'chat') $('#send-state').textContent = 'Abruf fehlgeschlagen: ' + error.message; }
    if (state.view === 'chat' && pid === state.project && id === state.session[pid]) state.timer = setTimeout(readMessages, 5000);
  }
  async function sendChat() {
    if (state.pending) return;
    const pid = requireProject(), text = $('#message').value.trim(); if (!text) return;
    const id = state.session[pid], profileId = state.selectedProfile;
    const prompt = StudioModel.taskPrompt({ mode: state.mode, text, files: $('#chat-files').value, proof: $('#chat-proof').value, goal: $('#chat-goal').value, constraints: $('#chat-constraints').value, skills: [...state.skills], plugins: [...state.plugins] });
    rememberDraft();
    const submittedText = $('#message').value;
    state.pending = true;
    try {
      if (!id && !await confirm('Neue Code-Sitzung starten', { projectId: pid, profileId, task: prompt })) return;
      if (pid !== state.project) throw new Error('Projekt wurde gewechselt. Nicht gesendet.');
      if (id) await api(`/workers/${encodeURIComponent(id)}/send`, 'POST', { text: prompt });
      else { const worker = await api('/workers', 'POST', { projectId: pid, profileId, task: prompt }); state.session[pid] = worker.id; state.sessionProfiles[pid] = profileId; }
      rememberDraft();
      if (state.drafts[pid] === submittedText) state.drafts[pid] = '';
      if (pid === state.project && state.view === 'chat') { $('#message').value = state.drafts[pid] || ''; render(); }
      notice('An die Runtime übergeben. Antworten erscheinen, sobald der Harness sie meldet.');
    } catch (error) { throw new Error(error.message + ' Zustellung bei Verbindungsabbruch unklar: vor erneutem Senden die Worker und Nachrichten prüfen.'); }
    finally { state.pending = false; if (state.view === 'chat') $('#chat-form button').disabled = !state.project; }
  }
  function teams() {
    const groups = new Map(); for (const p of state.profiles) { const name = p.team || 'Ohne Team'; if (!groups.has(name)) groups.set(name, []); groups.get(name).push(p); }
    const tree = node => `<div class="tree"><h3>${esc(node.task)}</h3><p class="micro">${esc(node.profileId)} · ${esc(node.kind)} · ${esc(node.status)}</p>${(node.children || []).map(tree).join('')}</div>`;
    return `<h1>Agententeams</h1><p class="lead">Profile, Rollen und laufende Zusammenarbeit direkt im Studio.</p><div class="layout"><div>${panel('Worker & Sitzungen', status('workers') + workerRows(state.cache.workers || []))}${panel('Laufende Hierarchie', status('tree') + rows([...(state.cache.tree?.coordinators || []), ...(state.cache.tree?.workers || [])], tree))}</div><aside>${panel('Harness-Teams', status('profileDoc') + rows([...groups], ([name, profiles]) => `<div class="row"><div><h3>${esc(name)}</h3>${profiles.map(p => `<p>${esc(p.name)} ${badge(p.enabled === false ? 'Deaktiviert' : 'Konfiguriert')}</p>`).join('')}</div></div>`) + '<button data-open="settings">Team und Rollen bearbeiten</button>' + source('/__hq/profiles · Team-Metadaten; keine automatische Teamausführung'))}</aside></div>`;
  }
  function questionOptions(q) {
    try { const options = q.options ?? JSON.parse(q.optionsJson || '[]'); return Array.isArray(options) ? options.filter(x => typeof x === 'string') : []; } catch { return []; }
  }
  function queueView() {
    return `<h1>Aufträge & Rückfragen</h1><p class="lead">Unklarheiten auflösen und den nächsten Auftrag bewusst freigeben.</p><div class="layout"><div>${panel('Offene Rückfragen', status('questions') + rows(state.cache.questions || [], q => `<form class="question row" data-id="${esc(q.id)}"><div><h3>${esc(q.question)}</h3><p class="micro">${esc(q.workerId || 'Projekt')}</p>${questionOptions(q).length ? `<p class="micro">Optionen: ${esc(questionOptions(q).join(' · '))}</p>` : ''}<label class="field"><span>Antwort</span><textarea name="answer" required></textarea></label><button class="primary">Antwort übermitteln</button></div></form>`))}${panel('Queue', status('queue') + rows(state.cache.queue || [], q => `<div class="row"><div><h3>${esc(q.rawText)}</h3><p class="micro">${esc(q.profileId || 'Runtime-Auswahl')} · Priorität ${esc(q.priority)}</p>${badge(q.status)}</div><button class="small" data-cancel="${esc(q.id)}" ${['pending', 'queued', 'ready'].includes(q.status) ? '' : 'disabled'}>Verwerfen</button></div>`))}</div><aside>${panel('Auftrag einreihen', `<form id="queue-form">${textArea('Auftrag mit Ziel und Abnahme', 'queue-text')}${select('Profil', 'queue-profile', profileOptions(), state.selectedProfile)}${field('Priorität', 'queue-priority', '0', 'number')}<button class="primary" ${state.project ? '' : 'disabled'}>Einreihen prüfen</button></form><p class="source">Die bestehende Queue kann diesen Auftrag automatisch verteilen.</p>`)}</aside></div>`;
  }
  function lessonsView() {
    const doc = state.cache.lessons;
    return `<h1>Lessons</h1><p class="lead">Erfahrung finden, anwenden und mit einem echten Run zurückmelden. Repository des HQ-Hosts.</p><div class="layout"><div>${panel('Erfahrungswissen', `<form id="lesson-search" class="actions"><input id="lesson-query" aria-label="Lessons durchsuchen" placeholder="Symptom, Ursache oder Technik"><button>Suchen</button></form>${status('lessons')}<div id="lesson-results">${rows(doc?.lessons || [], l => `<article class="row"><div><h3>${esc(l.symptom)}</h3><p><strong>Ursache:</strong> ${esc(l.cause)}</p><p><strong>Fix:</strong> ${esc(l.fix)}</p>${source(l.source || l.id)}${badge(l.id)} ${badge('Treffer: ' + (l.hits ?? 0))}<form data-feedback="${esc(l.id)}" class="actions"><input name="runId" aria-label="Echte Run-ID für ${esc(l.id)}" placeholder="Run-ID" required><button name="outcome" value="worked" class="small">Hat geholfen</button><button name="outcome" value="failed" class="small">Hat nicht geholfen</button></form></div></article>`)}</div>`)}</div><aside>${panel('Neue Lesson', `<form id="lesson-create">${textArea('Symptom', 'lesson-symptom')}${textArea('Ursache', 'lesson-cause')}${textArea('Fix', 'lesson-fix')}${field('Beleg / Quelle', 'lesson-source')}<button class="primary">Lesson speichern</button></form>`)}${panel('Auswertung', doc?.stats ? details('Lesson-Statistik mit Herkunft', doc.stats) : empty('Noch keine Statistik geladen.'))}</aside></div>`;
  }
  function capacity() {
    const cfg = state.cache.routing;
    if (!cfg) return '<h1>Kapazität & Routing</h1>' + status('routing') + empty('Routing-Konfiguration noch nicht verfügbar.');
    const ordered = [...state.profiles].sort((a, b) => { const rank = p => cfg.order.includes(p.id) ? cfg.order.indexOf(p.id) : 999; return rank(a) - rank(b); });
    return `<h1>Die passende Route.</h1><p class="lead">Kapazität, Aufgabenqualität und Erfahrung getrennt bewerten. Studio-Präferenzen ändern nicht die globale Runtime-Policy.</p><div class="layout"><div>${panel('Profilreihenfolge', status('quota') + '<p class="micro">Reihenfolge entscheidet bei gleich bewerteten Kandidaten. Änderungen werden erst mit „Regeln speichern“ dauerhaft.</p>' + rows(ordered, (p) => { const q = (state.cache.quota || []).find(x => x.profileId === p.id); const index = ordered.indexOf(p); return `<div class="row"><span class="rank">${index + 1}</span><div><h3>${esc(p.name)}</h3><p class="micro">${esc(p.id)} · ${esc(q?.reason || 'Kein Quotenbeleg')}</p>${badge(q?.state || 'unknown', q?.state === 'ok' ? 'good' : 'warn')}${source(q?.updatedAt ? new Date(q.updatedAt * 1000).toLocaleString('de-DE') + ' · /api/quota' : 'Messzeit unbekannt')}</div><div class="actions"><button class="small" data-order="${esc(p.id)}" data-direction="-1" aria-label="${esc(p.name)} nach oben" ${index === 0 ? 'disabled' : ''}>Hoch</button><button class="small" data-order="${esc(p.id)}" data-direction="1" aria-label="${esc(p.name)} nach unten" ${index === ordered.length - 1 ? 'disabled' : ''}>Runter</button></div></div>`; }))}${panel('Aufgaben-Advisor', select('Aufgabenart', 'advisor-task', [['code', 'Code'], ['review', 'Review'], ['research', 'Recherche'], ['design', 'Gestaltung']], 'code') + '<button id="advise" class="primary">Modelle & Effort bewerten</button><div id="advisor-result"></div><p class="source">Nur eigene, quellgebundene Benchmark- und Erfahrungswerte. Angaben sind dokumentierte Beobachtungen, kein unabhängiges Attestat. Modell/Effort werden aus dem gemessenen Profil übernommen.</p>')}${panel('Provider & Budgetquellen', status('providers') + details('Provider-Zustand', state.cache.providers) + status('budgets') + details('Budgets je Profil', state.cache.budgets))}</div><aside>${panel('Routing-Regeln', `<form id="routing-form"><label class="check"><input id="require-evidence" type="checkbox" ${cfg.rules.requireEvidence ? 'checked' : ''}> Nur mit Aufgabenbelegen empfehlen</label>${field('Maximales Belegalter in Tagen (1–365)', 'evidence-age', cfg.rules.maxAgeDays, 'number')}${field('Mindestens so viele Proben (1–1000)', 'evidence-samples', cfg.rules.minimumSamples, 'number')}${field('Qualitätsgewicht in % (Rest: Geschwindigkeit)', 'quality-weight', cfg.rules.qualityWeight, 'number')}<button class="primary">Regeln speichern</button></form><p class="micro">Gesperrte, unbekannte oder mehr als eine Stunde alte Kapazität schließt eine Empfehlung aus. Keine zusätzliche bezahlte API-Route.</p>`)}${panel('Messung erfassen', `<form id="evidence-form">${select('Gemessenes Profil', 'evidence-profile', profileOptions(), state.selectedProfile)}${select('Aufgabe', 'evidence-task', [['code', 'Code'], ['review', 'Review'], ['research', 'Recherche'], ['design', 'Gestaltung']], 'code')}${select('Quelle der Erfahrung', 'evidence-kind', [['benchmark', 'Benchmark'], ['experience', 'Projektlauf']], 'benchmark')}${field('Beobachtetes Modell', 'evidence-model')}${field('Beobachteter Effort', 'evidence-effort')}${field('Anzahl Proben', 'evidence-count', '1', 'number')}${field('Bestandene Abnahmen', 'evidence-passed', '1', 'number')}${field('Mittlere Dauer (Sekunden)', 'evidence-seconds', '', 'number')}${field('Messzeitpunkt', 'evidence-date', '', 'datetime-local')}${field('Belegpfad / Run / Benchmark-URL', 'evidence-source')}<button>Messung speichern</button></form>`)}${panel('Belege', rows(cfg.evidence, e => `<div class="row"><div><h3>${esc(e.model)} · ${esc(e.effort)}</h3><p class="micro">${esc(e.profileId)} · ${esc(e.task)} · ${e.passed}/${e.samples} bestanden</p>${source(e.source)}<button class="small" data-remove-evidence="${esc(e.id)}">Beleg entfernen</button></div></div>`))}</aside></div>`;
  }
  function chart(series) {
    if (!series?.length) return empty('Keine Zeitreihe gemessen.');
    const max = Math.max(1, ...series.map(x => x.commits));
    return `<figure style="margin:0"><figcaption class="micro">Commits pro Tag · Skala 0–${max}</figcaption><div class="chart" role="img" aria-label="${esc(series.map(x => `${x.day}: ${x.commits} Commits`).join(', '))}">${series.map(x => `<div class="column"><span class="bar" style="height:${x.commits / max * 140}px" title="${esc(x.day)}: ${x.commits}"></span><small>${x.commits}</small></div>`).join('')}</div><div class="chart-key"><span>${esc(series[0].day)}</span><span>${esc(series.at(-1).day)}</span></div></figure>`;
  }
  function activityChart(series) {
    if (!Array.isArray(series) || !series.length) return empty('Keine Projektaktivität im Zeitraum.');
    const visible = series.slice(-30), max = Math.max(1, ...visible.map(x => x.messages));
    return '<h3>Nachrichten pro Tag · letzte bis zu 30 Tage</h3><div class="chart" role="img" aria-label="' + esc(visible.map(x => x.date + ': ' + x.messages).join(', ')) + '">' + visible.map(x => '<div class="column"><span class="bar" style="height:' + (x.messages / max * 140) + 'px" title="' + esc(x.date) + ': ' + x.messages + '"></span><small>' + x.messages + '</small></div>').join('') + '</div><p class="micro">Skala 0–' + max + ' · UTC · Nachrichten sind keine Qualitätsmessung.</p>' + details('Aktivität: Datentabelle', series);
  }
  function statsView() {
    const s = state.cache.stats, p = state.cache.projectStats, usage = state.cache.usage;
    return `<h1>Statistiken mit Herkunft.</h1><p class="lead">Projektlaufzeit, Git-Aktivität und anbieterweite Nutzung behalten ihre eigene Messbasis.</p>${select('Runtime-Zeitraum', 'stats-range', [['today', 'Heute'], ['week', '7 Tage'], ['month', '30 Tage'], ['all', 'Gesamt']], state.range)}<div class="two">${panel('Projektlaufzeit · ' + (currentProject()?.name || 'Kein Projekt'), status('projectStats') + (p ? measures([['Aktive Worker', p.overview?.workersActive], ['Brauchen dich', p.overview?.needsAttention], ['Nachrichten im Zeitraum', p.overview?.messages], ['Sitzungen im Zeitraum', p.sessions?.total], ['Median-Sitzung / Sekunden', p.sessions?.medianSeconds], ['Fehlerhafte Sitzungen', p.sessions?.failed]]) + table(['Board-Spalte', 'Worker'], (p.overview?.byColumn || []).map(x => [x.key, x.count])) + details('Überblick mit Zeitraumzuordnung', p.overview) + details('Sitzungen mit Exitstatus', p.sessions) + details('Tokenmessung', p.tokens) + activityChart(p.timeline) + details('Fertigstellungsheuristik, keine Abnahme', p.completion) + source(`/api/projects/${state.project}/stats · ${new Date(p.generatedAt * 1000).toLocaleString('de-DE')}`) : empty('Keine Projektstatistik verfügbar.')))}${panel('Nutzung aller Projekte', status('usage') + measures([['Eingabe-Tokens', usage?.total?.tokensIn], ['Ausgabe-Tokens', usage?.total?.tokensOut], ['Gemeldete USD gesamt', usage?.reportedCostUsd]]) + `<p class="micro">${usage?.online && usage?.authorized ? 'Router erreichbar und autorisiert.' : 'Router offline oder nicht autorisiert; gespeicherte Werte können veraltet sein.'} Keine Aufteilung auf das gewählte Projekt verfügbar.</p>` + details('Nutzungsereignisse', usage?.events))}</div>${panel('Git-Aktivität · HQ-Repository', status('stats') + chart(s?.commitsPerDay) + source('Repository: ' + (state.cache.analysis?.repository || 'Unbekannt') + ' · ' + (s?.generatedAt || 'Zeitpunkt unbekannt')) + (s ? table(['Autor', 'Commits / 30 Tage'], (s.authors || []).map(a => [a.author, a.commits])) : ''))}<div class="two">${panel('Testoberfläche · HQ-Repository', measures([['Frontend-Testdateien', s?.tests?.frontendTestFiles], ['Rust-Tests im Quelltext', s?.tests?.rustTests], ['Geänderte Dateien', s?.dirtyFiles]]) + '<p class="micro">Zählung im Quelltext, kein bestandener Testlauf und keine Coverage.</p>')}${panel('Arbeitsmuster · HQ-Repository', status('insights') + details('Sitzungen, Volumen und Schätzgrundlage', state.cache.insights))}</div>`;
  }
  function analysisView() {
    const a = state.cache.analysis, s = state.cache.stats;
    const counts = a?.files ? [['Code', a.files.code], ['Andere Quellen', a.files.source - a.files.code], ['Weitere Dateien', a.files.tracked - a.files.source]] : [];
    return `<h1>Projektanalyse</h1><p class="lead">Struktur, Arbeitsstand und Engpässe zusammen lesen. Der Repository-Scan bezieht sich ausdrücklich auf den HQ-Host, nicht automatisch auf das gewählte Runtime-Projekt.</p>${status('analysis')}<div class="layout"><div>${panel('Repository-Struktur', `<p class="micro">${esc(a?.repository || 'Noch nicht geladen')}</p>${measures([['Versionierte Dateien', a?.files?.tracked], ['Codezeilen', a?.lines?.code], ['Commits / 30 Tage', a?.commitsLast30Days]])}<div class="chart-horizontal">${counts.map(([label, n]) => `<div><span>${label} · ${num(n)}</span><div class="track"><div class="fill" style="width:${a.files.tracked ? n / a.files.tracked * 100 : 0}%"></div></div></div>`).join('')}</div>${source('/__hq/analysis · ' + (a?.generatedAt || 'Keine Messzeit'))}`)}${panel('Plan & Engpässe', s ? table(['Signal', 'Anzahl'], Object.entries(s.snapshot?.specs || {}).map(([k, v]) => [k, v])) + details('Pakete und Findings aus dem Snapshot', s.snapshot) + details('Aktive Specs und Aufwandsschätzung', a?.estimate ? { progress: a.progress, estimate: a.estimate } : null) + '<p class="micro">Snapshot-Zustände und heuristische Stunden sind keine Fertigstellungszusage.</p>' : status('stats'))}${panel('Analyse in Arbeit überführen', '<p>Formuliere eine prüfbare Frage aus einem Engpass. Der Interviewmodus hilft, Ziel, Scope und Abnahme vor einer Implementierung zu klären.</p><button id="analysis-interview" class="primary">Analyse im Interview klären</button>')}</div><aside>${panel('Ausgewähltes Runtime-Projekt', currentProject() ? details('Projektkonfiguration', currentProject()) + '<button data-open="stats">Projektstatistiken öffnen</button>' : empty('Kein Projekt verbunden.'))}${panel('Darstellung', '<label class="check"><input id="motion" type="checkbox" checked> Dezente Bewegung</label><p class="micro">Die Darstellung wird nur in diesem Browser gespeichert.</p>')}</aside></div>`;
  }
  function extensions() {
    const c = state.cache.catalog;
    return `<h1>Skills & Plugins</h1><p class="lead">Kontext gezielt auswählen. Herkunft und tatsächliche Aktivierung auseinanderhalten.</p>${status('catalog')}<div class="two">${panel('Skill-Quellen', `<input id="skill-filter" type="search" aria-label="Skills filtern" placeholder="Skill oder Pfad suchen"><div class="list-select" id="skill-list">${rows(c?.skills || [], skill => `<label class="check" data-skill-row="${esc(skill.path.toLowerCase())}"><input type="checkbox" data-skill="${esc(skill.path)}" ${state.skills.has(skill.path) ? 'checked' : ''}><span>${esc(skill.name)}<small class="source" style="display:block">${esc(skill.path)}</small></span></label>`)}</div><p class="micro">Ausgewählte Quellen werden im Code-Chat als Leseauftrag übergeben. Die CLI-eigene Skill-Discovery bleibt beim Harness.</p><button data-open="chat">Zum Code-Chat</button>`)}${panel('Repository-Plugins', rows(c?.plugins || [], p => `<div class="row"><div><label class="check"><input type="checkbox" data-plugin="${esc(p.name)}" ${state.plugins.has(p.name) ? 'checked' : ''} ${p.enabled ? '' : 'disabled'}><span>${esc(p.name)}</span></label>${badge(p.enabled ? 'Konfiguration: aktiviert' : 'Konfiguration: deaktiviert')}${source(p.source)}</div></div>`) + '<p class="micro">Gewählte Plugins werden als Arbeitsanweisung an den Harness übergeben; Installation und Aktivierung bleiben bei der CLI. Benutzerweite und laufende CLI-Installationen sind nicht durch dieses Inventar belegt.</p>')}</div>${source(c?.note || 'Inventar nicht verfügbar')}${source(c?.repository || '')}`;
  }
  function projectForm() {
    return panel('Projekt verbinden', '<form id="project-form"><div class="two">' + field('Projektname', 'project-name') + field('Absoluter Git-Repository-Pfad', 'project-path') + '</div>' + field('Einmaliges menschliches Verdict-Token aus ProjectA', 'project-verdict', '', 'password') + '<p class="micro">Das Token wird nur für diese Anfrage verwendet und weder gespeichert noch in einer URL übertragen. Die Registrierung startet selbst keinen Worker.</p><button class="primary">Projekt registrieren</button></form>');
  }
  function settings() {
    const p = state.profiles.find(p => p.id === state.selectedProfile), doc = state.cache.profileDoc;
    return `<h1>Harness & Einstellungen</h1><p class="lead">Ausführbares Profil, Argumente, Rolle und Team vor dem nächsten Spawn konfigurieren.</p>${status('profileDoc')}<div class="layout"><div>${panel('Profil bearbeiten', select('Profil', 'settings-profile', profileOptions(), state.selectedProfile) + (p ? `<form id="profile-form"><div class="two">${field('Profil-ID (neue ID erstellt ein Profil)', 'profile-id', p.id)}${field('Anzeigename', 'profile-name', p.name)}</div>${field('CLI-Kommando', 'profile-command', p.command)}${textArea('Argumente als JSON-Array · native Modell-/Effort-/Plan-Flags', 'profile-args', JSON.stringify(p.args || []))}${field('Team', 'profile-team', p.team || '')}${field('Fallback-Profil-ID (optional)', 'profile-fallback', p.fallback || '')}${textArea('Zweck', 'profile-purpose', p.briefing?.purpose || '')}${textArea('Rolle', 'profile-role', p.briefing?.role || '')}${field('Effort-Beschreibung (Metadatum)', 'profile-effort', p.briefing?.effort || '')}${textArea('Werkzeugbeschreibung (Metadatum)', 'profile-tools', p.briefing?.tools || '')}<button class="primary" ${doc?.writable ? '' : 'disabled'}>Harness speichern</button></form>` : empty('Kein Profil verfügbar.')))}</div><aside>${panel('Quelle & Wirksamkeit', `<p>${esc(doc?.note || 'Profilquelle fehlt.')}</p>${source(doc?.agentsFile || '')}<p class="micro">Argumente wirken beim nächsten Spawn. Beschreibende Rollenfelder konfigurieren keine Sandbox. Bestehende Sitzungen behalten ihre Konfiguration.</p>${p ? details('Konfigurierte Fähigkeiten · kein Attestat', p.caps) : ''}`)}${panel('System', '<button id="setup-check">Setup read-only prüfen</button><div id="setup-result"></div>')}</aside></div>`;
  }
  function render() {
    clearTimeout(state.timer);
    state.renderedProject = state.project;
    const views = { overview, roadmap: () => StudioRoadmap.render(state.roadmap), chat, teams, queue: queueView, lessons: lessonsView, capacity, stats: statsView, analysis: analysisView, extensions, settings };
    $('#page').dataset.view = state.view;
    $('#page').innerHTML = (views[state.view] || overview)();
    if (state.view === 'settings') $('#page').insertAdjacentHTML('beforeend', projectForm());
    document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => show(b.dataset.open));
    document.querySelectorAll('[data-session]').forEach(b => b.onclick = () => { const w = (state.cache.workers || []).find(w => w.id === b.dataset.session); if (!w) return; state.session[state.project] = w.id; state.sessionProfiles[state.project] = w.profileId; state.selectedProfile = w.profileId; show('chat'); });
    bind();
    if (state.view === 'roadmap') drawRoadmapEdges();
  }
  function drawRoadmapEdges() {
    const graph = $('.roadmap-graph'), svg = graph?.querySelector('svg');
    const packages = state.roadmap.envelope?.projection.packages;
    if (!svg || !packages) return;
    svg.replaceChildren();
    const boxes = new Map([...graph.querySelectorAll('.roadmap-level .roadmap-package')].map(button => [button.dataset.roadmapPackage, button]));
    const origin = graph.getBoundingClientRect();
    svg.setAttribute('width', graph.scrollWidth);
    svg.setAttribute('height', graph.scrollHeight);
    svg.setAttribute('viewBox', `0 0 ${graph.scrollWidth} ${graph.scrollHeight}`);
    const ns = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(ns, 'defs');
    for (const [id, cls] of [['roadmap-arrow', ''], ['roadmap-arrow-related', 'related']]) {
      const marker = document.createElementNS(ns, 'marker');
      marker.setAttribute('id', id);
      marker.setAttribute('markerWidth', '7');
      marker.setAttribute('markerHeight', '7');
      marker.setAttribute('refX', '6');
      marker.setAttribute('refY', '3');
      marker.setAttribute('orient', 'auto');
      const tip = document.createElementNS(ns, 'polygon');
      tip.setAttribute('points', '0,0 6,3 0,6');
      tip.setAttribute('class', cls);
      marker.append(tip);
      defs.append(marker);
    }
    svg.append(defs);
    for (const item of packages.filter(packageItem => !packageItem.removed)) {
      const target = boxes.get(item.packageId)?.getBoundingClientRect();
      if (!target) continue;
      for (const dependencyId of item.dependencyIds) {
        const prerequisite = boxes.get(dependencyId)?.getBoundingClientRect();
        if (!prerequisite) continue;
        const x1 = prerequisite.right - origin.left, y1 = prerequisite.top + prerequisite.height / 2 - origin.top;
        const x2 = target.left - origin.left - 6, y2 = target.top + target.height / 2 - origin.top;
        const middle = Math.max(8, (x2 - x1) / 2);
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${x1 + middle} ${y1}, ${x2 - middle} ${y2}, ${x2} ${y2}`);
        const related = item.packageId === state.roadmap.selected || dependencyId === state.roadmap.selected;
        path.setAttribute('class', related ? 'related' : '');
        path.setAttribute('marker-end', `url(#${related ? 'roadmap-arrow-related' : 'roadmap-arrow'})`);
        svg.append(path);
      }
    }
  }
  function bind() {
    if (state.view === 'roadmap') {
      on('roadmap-reload', loadRoadmap);
      on('roadmap-import', importRoadmap);
      on('roadmap-view-graph', () => { state.roadmap.view = 'graph'; render(); $('#roadmap-view-graph')?.focus(); });
      on('roadmap-view-table', () => { state.roadmap.view = 'table'; render(); $('#roadmap-view-table')?.focus(); });
      on('roadmap-sort', e => { state.roadmap.sort = e.target.value; render(); $('#roadmap-sort')?.focus(); }, 'change');
      on('roadmap-reason', e => { state.roadmap.reason = e.target.value; }, 'input');
      on('roadmap-advanced', e => { if (e.currentTarget.isConnected) state.roadmap.reasonOpen = e.currentTarget.open; }, 'toggle');
      on('roadmap-source', e => { if (e.currentTarget.isConnected) state.roadmap.sourceOpen = e.currentTarget.open; }, 'toggle');
      on('roadmap-removed', e => { if (e.currentTarget.isConnected) state.roadmap.removedOpen = e.currentTarget.open; }, 'toggle');
      on('roadmap-open-source', () => { state.roadmap.sourceOpen = true; render(); const line = $('#roadmap-line-' + state.roadmap.envelope.projection.packages.find(item => item.packageId === state.roadmap.selected)?.sourceLine); line?.scrollIntoView?.({ block: 'center' }); $('#roadmap-source .roadmap-source-scroll')?.focus(); });
      on('roadmap-copy-source', async () => { const item = state.roadmap.envelope?.projection.packages.find(packageItem => packageItem.packageId === state.roadmap.selected); if (!item) return; try { await navigator.clipboard.writeText(`${item.sourcePath}:${item.sourceLine} · ${item.sourceRevision}`); notice('Quellenangabe kopiert.'); } catch { notice('Kopieren fehlgeschlagen. Quellenangabe steht im Inspektor.', true); } });
      document.querySelectorAll('[data-roadmap-package]').forEach(button => button.onclick = () => {
        const id = button.dataset.roadmapPackage;
        const regions = ['.roadmap-graph', '.roadmap-table', '.roadmap-hierarchy', '.roadmap-removed', '.roadmap-inspector'];
        const region = regions.find(selector => button.closest(selector));
        state.roadmap.selected = id;
        render();
        const local = region && [...document.querySelectorAll(`${region} [data-roadmap-package]`)].find(item => item.dataset.roadmapPackage === id);
        (local || $('#roadmap-inspector-title'))?.focus();
      });
    }
    if (state.view === 'chat') {
      on('chat-appearance', e => {
        if (e.target.matches('input[name="chat-appearance"]')) applyChatAppearance(e.target.value, true);
      }, 'change');
      on('chat-profile', e => { if (state.session[state.project]) { e.target.value = state.sessionProfiles[state.project] || (state.cache.workers || []).find(w => w.id === state.session[state.project])?.profileId || ''; notice('Vor einem Harness-Wechsel eine neue getrennte Sitzung öffnen.'); } else state.selectedProfile = e.target.value; }, 'change');
      on('chat-mode', e => { state.mode = e.target.value; }, 'change');
      on('new-session', () => { delete state.session[state.project]; delete state.sessionProfiles[state.project]; rememberDraft(); render(); });
      on('read-messages', readMessages); action('chat-form', sendChat, 'submit');
      on('interview-seed', () => { state.mode = 'interview'; $('#chat-mode').value = 'interview'; $('#message').value = 'Hilf mir, das Projekt zu konkretisieren. Frage zuerst nach dem Ziel und dem wichtigsten Nutzerablauf. Kläre danach Randbedingungen und messbare Abnahme.'; $('#message').focus(); });
      readMessages();
    }
    if (state.view === 'queue') {
      document.querySelectorAll('.question').forEach(form => form.onsubmit = async e => { e.preventDefault(); const button = form.querySelector('button'); button.disabled = true; try { await api(`/questions/${encodeURIComponent(form.dataset.id)}/answer`, 'POST', { answer: new FormData(form).get('answer') }); await loadProject(); render(); notice('Antwort gespeichert.'); } catch (error) { notice(error.message, true); button.disabled = false; } });
      document.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => { if (!await confirm('Queue-Eintrag verwerfen', b.dataset.cancel)) return; b.disabled = true; try { await api(`/queue/${encodeURIComponent(b.dataset.cancel)}/cancel`, 'POST', {}); await loadProject(); render(); } catch (error) { notice(error.message, true); b.disabled = false; } });
      action('queue-form', async () => { const projectId = requireProject(), rawText = $('#queue-text').value.trim(); if (!rawText) throw new Error('Auftrag fehlt.'); const value = { projectId, rawText, profileId: $('#queue-profile').value, priority: Number($('#queue-priority').value) }; if (!await confirm('Auftrag in die echte Queue stellen', value)) return; await api('/queue', 'POST', value); await loadProject(); render(); notice('Auftrag eingereiht.'); }, 'submit');
    }
    if (state.view === 'lessons') {
      action('lesson-search', async () => { await load('lessons', request('/__hq/lessons?limit=100&q=' + encodeURIComponent($('#lesson-query').value))); render(); }, 'submit');
      action('lesson-create', async () => { const value = Object.fromEntries(['symptom', 'cause', 'fix', 'source'].map(k => [k, $('#lesson-' + k).value.trim()])); if (Object.values(value).some(x => !x)) throw new Error('Symptom, Ursache, Fix und Quelle ausfüllen.'); await request('/__hq/lessons', 'POST', value); await load('lessons', request('/__hq/lessons?limit=100')); render(); notice('Lesson gespeichert.'); }, 'submit');
      document.querySelectorAll('[data-feedback]').forEach(form => form.onsubmit = async e => { e.preventDefault(); const runId = new FormData(form).get('runId')?.trim(); if (!runId || !e.submitter) return; e.submitter.disabled = true; try { await request(`/__hq/lessons/${encodeURIComponent(form.dataset.feedback)}/${e.submitter.value}`, 'POST', { runId }); notice('Feedback mit Run-ID gespeichert.'); } catch (error) { notice(error.message, true); } finally { if (e.submitter) e.submitter.disabled = false; } });
    }
    if (state.view === 'capacity') bindRouting();
    if (state.view === 'stats') action('stats-range', async e => { state.range = e.target.value; await load('projectStats', api(`/projects/${encodeURIComponent(requireProject())}/stats?range=${state.range}`)); render(); }, 'change');
    if (state.view === 'analysis') {
      on('analysis-interview', () => { state.mode = 'interview'; state.drafts[state.project] = 'Analysiere die Engpässe dieses Projekts. Trenne gemessene Daten, Snapshot-Angaben und Hypothesen. Kläre mit mir die wichtigste offene Abnahme.'; show('chat'); });
      on('motion', e => { document.documentElement.dataset.motion = e.target.checked ? 'on' : 'off'; }, 'change');
    }
    if (state.view === 'extensions') {
      on('skill-filter', e => document.querySelectorAll('[data-skill-row]').forEach(row => { row.hidden = !row.dataset.skillRow.includes(e.target.value.toLowerCase()); }), 'input');
      document.querySelectorAll('[data-skill]').forEach(input => input.onchange = () => input.checked ? state.skills.add(input.dataset.skill) : state.skills.delete(input.dataset.skill));
      document.querySelectorAll('[data-plugin]').forEach(input => input.onchange = () => input.checked ? state.plugins.add(input.dataset.plugin) : state.plugins.delete(input.dataset.plugin));
    }
    if (state.view === 'settings') {
      action('project-form', async () => {
        const value = { name: $('#project-name').value.trim(), repoPath: $('#project-path').value.trim() };
        const verdict = $('#project-verdict').value.trim(); $('#project-verdict').value = '';
        if (!value.name || !value.repoPath || !verdict) throw new Error('Name, Repository-Pfad und einmaliges Verdict-Token aus ProjectA sind erforderlich.');
        if (!await confirm('Repository in ProjectA registrieren', value)) return;
        const created = await api('/projects', 'POST', value, { 'x-hq-verdict-token': verdict });
        state.project = created.id; await refresh(); notice('Projekt registriert und ausgewählt.');
      }, 'submit');
      on('settings-profile', e => { state.selectedProfile = e.target.value; render(); }, 'change');
      action('profile-form', async () => {
        const original = state.profiles.find(p => p.id === state.selectedProfile), args = JSON.parse($('#profile-args').value);
        if (!Array.isArray(args) || args.some(x => typeof x !== 'string')) throw new Error('Argumente müssen ein JSON-Array aus Strings sein.');
        const value = { ...original, id: $('#profile-id').value.trim(), name: $('#profile-name').value.trim(), command: $('#profile-command').value.trim(), args, team: $('#profile-team').value.trim(), fallback: $('#profile-fallback').value.trim() || null, briefing: Object.fromEntries(['purpose', 'role', 'effort', 'tools'].map(k => [k, $('#profile-' + k).value])) };
        // Never put environment secrets in a confirmation transcript.
        const preview = { id: value.id, name: value.name, command: value.command, args, team: value.team, fallback: value.fallback, briefing: value.briefing };
        if (!await confirm('Harness für zukünftige Starts speichern', preview)) return;
        await request('/__hq/profiles', 'POST', value); state.selectedProfile = value.id; await refresh(); notice('Profil gespeichert. Gilt für zukünftige Starts.');
      }, 'submit');
      action('setup-check', async () => { const result = await request('/__hq/setup'); $('#setup-result').innerHTML = details('Setup-Ergebnis', result); });
    }
  }
  function readRuleFields() {
    for (const [id, min, max] of [['evidence-age', 1, 365], ['evidence-samples', 1, 1000], ['quality-weight', 0, 100]]) { const value = Number($('#' + id).value); if (!Number.isInteger(value) || value < min || value > max) throw new Error('Routing-Regel außerhalb des angegebenen Bereichs: ' + id); }
    return { requireEvidence: $('#require-evidence').checked, maxAgeDays: Number($('#evidence-age').value), minimumSamples: Number($('#evidence-samples').value), qualityWeight: Number($('#quality-weight').value) };
  }
  async function saveRouting(next) { const result = await request('/__hq/studio/routing', 'PUT', next); state.cache.routing = result; render(); notice('Routing-Präferenzen gespeichert.'); }
  function bindRouting() {
    const cfg = state.cache.routing; if (!cfg) return;
    document.querySelectorAll('[data-order]').forEach(b => b.onclick = () => {
      cfg.rules = readRuleFields();
      const order = [...document.querySelectorAll('[data-order][data-direction="-1"]')].map(x => x.dataset.order);
      const i = order.indexOf(b.dataset.order), j = i + Number(b.dataset.direction); [order[i], order[j]] = [order[j], order[i]]; cfg.order = order; render(); notice('Reihenfolge geändert · noch nicht gespeichert.');
    });
    action('routing-form', () => saveRouting({ ...cfg, rules: readRuleFields() }), 'submit');
    action('evidence-form', async () => {
      const p = state.profiles.find(p => p.id === $('#evidence-profile').value);
      const date = new Date($('#evidence-date').value); if (!Number.isFinite(date.getTime())) throw new Error('Messzeitpunkt fehlt.');
      const value = { id: crypto.randomUUID(), profileId: p.id, profileSignature: StudioModel.signature(p), task: $('#evidence-task').value, kind: $('#evidence-kind').value, model: $('#evidence-model').value.trim(), effort: $('#evidence-effort').value.trim(), samples: Number($('#evidence-count').value), passed: Number($('#evidence-passed').value), seconds: Number($('#evidence-seconds').value), source: $('#evidence-source').value.trim(), observedAt: date.toISOString() };
      await saveRouting({ ...cfg, rules: readRuleFields(), evidence: [...cfg.evidence, value] });
    }, 'submit');
    document.querySelectorAll('[data-remove-evidence]').forEach(b => b.onclick = async () => { try { await saveRouting({ ...cfg, evidence: cfg.evidence.filter(e => e.id !== b.dataset.removeEvidence) }); } catch (error) { notice(error.message, true); } });
    action('advise', () => {
      const candidates = StudioModel.advise({ ...cfg, rules: readRuleFields() }, state.profiles, state.cache.quota || [], $('#advisor-task').value);
      $('#advisor-result').innerHTML = rows(candidates, c => `<div class="row"><div><h3>${esc(c.profile.name)} ${c.score === null ? '' : badge(c.score.toFixed(1) + ' / 100')}</h3><p>${esc(c.measured ? c.measured.model + ' · ' + c.measured.effort + ' · ' + c.measured.samples + ' Proben' : 'Kein gemessenes Modell/Effort-Paar')}</p><p class="micro">${esc(c.reasons.join(' · ') || (c.measured ? 'Geeignet nach den gewählten Regeln; vor Start aktuelle Kernprüfung.' : 'Nur Reihenfolge; keine Modell- oder Effortempfehlung.'))}</p>${c.measured ? source(c.measured.sources.map(s => `${s.kind}: ${s.source} (${s.observedAt})`).join(' · ')) : ''}</div><button class="small" data-recommend="${esc(c.profile.id)}" ${c.reasons.length ? 'disabled' : ''}>Im Chat wählen</button></div>`);
      document.querySelectorAll('[data-recommend]').forEach(b => b.onclick = () => { state.selectedProfile = b.dataset.recommend; delete state.session[state.project]; show('chat'); notice('Profil für eine neue Sitzung gewählt. Noch kein Worker gestartet.'); });
    });
  }
  document.querySelectorAll('nav [data-view]').forEach(b => b.onclick = () => show(b.dataset.view));
  $('.brand')?.addEventListener('click', e => { e.preventDefault(); show('overview'); });
  on('project', async e => { rememberDraft(); clearTimeout(state.timer); state.project = e.target.value; state.skills.clear(); state.plugins.clear(); notice(''); const pid = state.project; const loading = loadProject(); render(); await loading; if (pid === state.project) { rememberDraft(); render(); } }, 'change');
  on('refresh', refresh);
  on('theme', () => { const dark = document.documentElement.dataset.theme !== 'dark'; document.documentElement.dataset.theme = dark ? 'dark' : 'light'; $('#theme').textContent = dark ? 'Hell' : 'Dunkel'; $('#theme').setAttribute('aria-label', dark ? 'Helles Farbschema einschalten' : 'Dunkles Farbschema einschalten'); try { localStorage.setItem('studio-theme', dark ? 'dark' : 'light'); } catch { /* Optional preference. */ } });
  function applyChatAppearance(value, save = false) {
    const next = ['codex', 'claude', 'deepseek'].includes(value) ? value : 'deepseek';
    const log = $('#chat-log');
    const nearBottom = log && log.scrollHeight - log.scrollTop - log.clientHeight < 70;
    const top = log?.getBoundingClientRect().top;
    const anchor = log && !nearBottom ? [...log.querySelectorAll('.message')].find(node => node.getBoundingClientRect().bottom > top) : null;
    const oldTop = anchor?.getBoundingClientRect().top;
    state.chatAppearance = next;
    document.documentElement.dataset.chatAppearance = next;
    if (log) {
      if (nearBottom) log.scrollTop = log.scrollHeight;
      else if (anchor) log.scrollTop += anchor.getBoundingClientRect().top - oldTop;
    }
    if (save) { try { localStorage.setItem('studio-chat-appearance', next); } catch { /* Optional preference. */ } }
  }
  function applyDensity(value) {
    const density = value === 'compact' ? 'compact' : 'calm';
    document.body.classList.toggle('compact', density === 'compact');
    $('#density').value = density;
  }
  on('density', e => { applyDensity(e.target.value); if (state.view === 'roadmap') drawRoadmapEdges(); try { localStorage.setItem('studio-density', e.target.value); } catch { /* Optional preference. */ } }, 'change');
  try { applyDensity(localStorage.getItem('studio-density')); } catch { applyDensity('calm'); }
  try { applyChatAppearance(localStorage.getItem('studio-chat-appearance')); } catch { applyChatAppearance('deepseek'); }
  try { if (localStorage.getItem('studio-theme') === 'dark') $('#theme').click(); } catch { /* Storage may be disabled. */ }
  window.addEventListener('pagehide', () => clearTimeout(state.timer));
  window.addEventListener('resize', () => { if (state.view === 'roadmap') drawRoadmapEdges(); });
  window.Studio = { state, show, refresh, ready: refresh() };
})();
