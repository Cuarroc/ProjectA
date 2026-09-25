/* Local concept data. No repository scan, provider call, or worker dispatch. */
(() => {
  const modules = {
    projecta: [
      ['Oberfläche', 'src/', 'React · TypeScript', 'Terminal, Arbeitsansichten und Bedienung.', 'Tauri IPC → Runtime', 'UI-Implementierung + unabhängiges Review', 'Interaktionsprüfung und Screenshots'],
      ['Runtime', 'src-tauri/src/', 'Rust · SQLite', 'Ausführung, Zustellung und dauerhafter Zustand.', 'PTY · Worker · Datenbank', 'Eine serielle Implementierungslane', 'Zustellung und Recovery im echten Lauf'],
      ['Dev-HQ', 'docs/dev-hq/', 'HTML · JavaScript', 'Lokales Cockpit mit Teams, Queue, Kontext und Belegen.', 'HQ-Host → vorhandene Runtime', 'Frontend + Integration getrennt', 'Teams und Queue über vorhandenen Host prüfen'],
      ['Qualität', 'scripts/ci/gates.sh', 'Gemeinsame Gates', 'Prüfungen für Entwicklung und Auslieferung.', 'Windows + Linux', 'Unabhängiger Reviewer', 'Passender Gate-Lauf am Kandidaten']
    ],
    devhq: [
      ['Studio', 'docs/dev-hq/concepts/', 'Interaktive HTML-Demo', 'Neue Navigation und Arbeitsabläufe gemeinsam gestalten.', 'Quellen + Demo-Modell', 'Design + unabhängiges Review', 'Desktop- und mobile Screenshot-Abnahme'],
      ['Live-Cockpit', 'docs/dev-hq/live.html', 'Vorhandenes HQ', 'Teams, Queue, Worker, Lessons und Belege bedienen.', 'HQ-Host → Runtime', 'HQ-Integration', 'Jeden bestehenden Arbeitsablauf im Host prüfen'],
      ['Vertrag', 'docs/development/HQ2_CONTRACT.md', 'Versionierter Vertrag', 'App und HQ teilen dieselbe Laufzeitautorität.', 'Rust · Sessions · Kapazität', 'API + Review', 'Adapter gegen den Vertrag prüfen']
    ]
  };
  const gates = [
    ['Bedienung', 'Offen', 'Screenshot-Abnahme in einer anderen Instanz.', 'docs/dev-hq/concepts/**'],
    ['Zustellung', 'Ungeprüft', 'Aktuellen Laufzeitbeleg für CLI-Zustellung zuordnen.', 'src-tauri/src/'],
    ['Recovery', 'Ungeprüft', 'Unterbrechung und Wiederaufnahme am Kandidaten nachweisen.', 'src-tauri/src/'],
    ['Kapazität', 'Offen', 'Quelle, Messzeitpunkt und Abrechnung je Anbieter belegen.', 'Provider-Collector'],
    ['HQ-Parität', 'Offen', 'Teams, Queue, Lessons und Worker im Live-HQ bedienen.', 'docs/dev-hq/**']
  ];
  let selectedModule = 0;
  const knownProject = () => Object.hasOwn(modules, project);
  const analysisSources = () => knownProject() ? [
    {title: 'Paketkonfiguration', path: 'package.json', link: '../../../package.json'},
    {title: 'HQ2-Vertrag', path: 'docs/development/HQ2_CONTRACT.md', link: '../../development/HQ2_CONTRACT.md'},
    {title: 'Arbeitsplan', path: 'docs/PLAN.md', link: '../../PLAN.md'}
  ] : [];
  const analysis = make('section', 'section');
  analysis.id = 'analysis'; analysis.hidden = true;
  analysis.innerHTML = `<div class="eyebrow">Projektanalyse / Vom Verständnis zur Arbeit</div>
    <div class="heading"><div><h1>Verstehe das Ganze.</h1><p class="lead">Struktur, offene Abnahmen und nächste Schritte – mit nachvollziehbarer Herkunft.</p></div><span class="status neutral">Kuratiertes Konzept · kein Live-Scan</span></div>
    <div class="analysis-subnav segmented" role="group" aria-label="Analyseansicht">
      <button data-analysis="summary" aria-pressed="true">Überblick</button><button data-analysis="structure" aria-pressed="false">Struktur</button><button data-analysis="gates" aria-pressed="false">Abnahme</button><button data-analysis="compare" aria-pressed="false">Ähnliche Apps</button>
    </div>
    <div data-analysis-panel="summary"><div class="card analysis-summary"><div class="eyebrow">App-Steckbrief</div><h2 id="analysis-name"></h2><p id="analysis-kind"></p><div class="two"><div><h3>Für wen?</h3><p class="micro">Für dich und deine Agenten: Projekte verstehen, Arbeit aufteilen und Ergebnisse prüfen.</p></div><div><h3>Was zählt als fertig?</h3><p class="micro">Ein vereinbartes Ziel mit bestandenem Nachweis. Code-Menge allein zeigt keine Fertigstellung.</p></div></div><p class="micro" id="analysis-provenance">Stand 23.09.2026 · kuratiert aus Paketkonfiguration und HQ2-Vertrag. Keine automatische Repository-Analyse.</p><button class="btn" id="analysis-source">Quellen und Unsicherheit</button></div><div class="card"><h2>Nächste Entscheidung</h2><p>Welche Abnahme fehlt, bevor der nächste Auftrag sinnvoll beginnen kann?</p><div id="analysis-next"></div></div></div>
    <div data-analysis-panel="structure" hidden><p class="micro">Wähle ein Modul. Die Verbindungen sind eine kuratierte Architekturübersicht.</p><div class="analysis-layout"><div class="analysis-map" id="analysis-map" aria-label="Projektmodule"></div><article class="card analysis-detail" id="analysis-detail" aria-live="polite"></article></div></div>
    <div data-analysis-panel="gates" hidden><div class="card"><h2>Fertigstellung braucht Belege.</h2><p class="micro">Diese Liste ist ein Demo-Abnahmeplan. Kein Kriterium wird ohne aktuellen Nachweis als bestanden gezählt.</p><div class="analysis-gates" id="analysis-gates"></div></div></div>
    <div data-analysis-panel="compare" hidden><div class="card"><h2>Gute Referenzen. Klare Prüfaufträge.</h2><p class="micro">Öffentliche Produktdokumentation · gelesen am 23.09.2026. Kein eigener Leistungsvergleich.</p><div class="list"><div class="row"><div><h3>Cursor Projects</h3><p>Koordinator mit parallelen Agenten und gemeinsamem Projektkontext.</p><a href="https://cursor.com/docs/agent/projects" target="_blank" rel="noopener">Offizielle Dokumentation ↗</a></div><span class="status neutral">Dokumentiert</span></div><div class="row"><div><h3>Orca</h3><p>Arbeitsumgebung für parallele Coding-Agenten und eigene Abonnements.</p><a href="https://github.com/stablyai/orca" target="_blank" rel="noopener">Offizielles Repository ↗</a></div><span class="status neutral">Dokumentiert</span></div></div><div class="callout" style="margin-top:20px"><strong>Unser Vergleichsmaßstab</strong><p>Zeit bis zum ersten belegten Auftrag · verständliche Zuständigkeit · Kontextqualität · Aufwand für Recovery. Für Dev-HQ fehlen noch vergleichbare Messläufe.</p></div><button class="btn" id="analysis-benchmark" style="margin-top:16px">Vergleich als Auftrag entwerfen</button></div></div>`;
  $('#main').append(analysis);
  const art = make('img', 'analysis-art'); art.src = 'dev-hq-architecture-v1.png'; art.alt = ''; art.width = 1536; art.height = 1024; art.loading = 'lazy';
  $('.analysis-summary').prepend(art);
  const nav = make('button', '', 'Projektanalyse'); nav.dataset.view = 'analysis';
  nav.onclick = () => { renderAnalysis(); showView('analysis'); };
  $('.nav [data-view="knowledge"]').before(nav);

  function draft(title, owner, proof) {
    $('#task-name').value = title; $('#task-owner').value = owner;
    $('#task-proof').value = proof + (knownProject() ? ' · Quelle: docs/PLAN.md / HQ2_CONTRACT.md' : ' · Quellenzuordnung offen');
    $('#task-dialog').showModal();
  }
  function moduleText(m) {
    return `${data().name} / ${m[0]}\nPfad: ${m[1]}\nZweck: ${m[3]}\nAbhängigkeiten: ${m[4]}\nTeamvorschlag: ${m[5]}\nAbnahme: ${m[6]}\nQuelle: docs/PLAN.md / docs/development/HQ2_CONTRACT.md\nUnsicherheit: kuratierte Übersicht, kein Live-Scan; Eigentum und Laufzeit neu prüfen.`;
  }
  function renderModule() {
    const m = (modules[project] || [])[selectedModule]; const panel = $('#analysis-detail'); panel.replaceChildren();
    if (!m) { panel.append(make('p', '', 'Für dieses neue Projekt fehlt noch eine Strukturanalyse.')); return; }
    panel.append(make('div', 'eyebrow', m[2]), make('h2', '', m[0]), make('p', 'mono', m[1]), make('p', '', m[3]));
    for (const [label, value] of [['Abhängigkeiten', m[4]], ['Teamvorschlag', m[5]], ['Nächster Nachweis', m[6]], ['Änderungsrisiko', 'Angrenzende Module und passende Gates vor einer Zuteilung prüfen.']]) {
      const row = make('div', 'source'); row.append(make('h3', '', label), make('p', 'micro', value)); panel.append(row);
    }
    const copy = make('button', 'btn', 'Kontextpaket ansehen'); copy.id = 'analysis-context';
    copy.onclick = () => {
      $('#context-dialog-title').textContent = m[0] + ' · Kontextpaket'; $('#context-dialog-body').textContent = moduleText(m);
      const sources = $('#context-dialog-sources'); sources.replaceChildren();
      for(const s of analysisSources()) { const a = make('a', 'source', s.title + ' ↗'); a.href = s.link; a.target = '_blank'; a.rel = 'noopener'; sources.append(a); }
      const copyText = make('button', 'btn', 'Kontextpaket kopieren');
      copyText.onclick = async () => { try { await navigator.clipboard.writeText(moduleText(m)); toast('Kontextpaket kopiert'); } catch { toast('Bitte den sichtbaren Kontexttext markieren und kopieren.'); } };
      sources.append(copyText); $('#context-dialog').showModal();
    };
    const action = make('button', 'btn primary', 'Auftrag entwerfen'); action.id = 'analysis-draft';
    action.onclick = () => draft(m[0] + ': ' + m[6], m[1], m[6]);
    const actions = make('div', 'actions'); actions.append(copy, action); panel.append(actions);
    $$('#analysis-map button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === selectedModule)));
  }
  function renderAnalysis() {
    $('#analysis-provenance').textContent = knownProject() ? 'Stand 23.09.2026 · kuratiert aus Paketkonfiguration und HQ2-Vertrag. Keine automatische Repository-Analyse.' : 'Noch keine Analysequellen zugeordnet. Projektstruktur und Abnahme zuerst erfassen.';
    $('#analysis-name').textContent = data().name;
    $('#analysis-kind').textContent = project === 'projecta' ? 'Desktop-App · Tauri 2 / Rust / React · agentisches Terminal' : project === 'devhq' ? 'Lokale Weboberfläche · Projektkoordination und Agenten-Cockpit' : 'Neues Projekt · App-Typ und Architektur noch nicht erfasst';
    const map = $('#analysis-map'); map.replaceChildren();
    (modules[project] || []).forEach((m, i) => { const b = make('button', 'analysis-node'); b.append(make('span', 'micro', String(i + 1).padStart(2, '0')), make('strong', '', m[0]), make('small', 'mono', m[1])); b.onclick = () => { selectedModule = i; renderModule(); }; map.append(b); });
    selectedModule = 0; renderModule();
    const list = $('#analysis-gates'); list.replaceChildren();
    const projectGates = project === 'projecta' ? gates : project === 'devhq' ? gates.filter(g => ['Bedienung', 'Kapazität', 'HQ-Parität'].includes(g[0])) : [];
    for (const g of projectGates) { const row = make('div', 'row'), body = make('div'); body.append(make('h3', '', g[0]), make('p', '', g[2])); const actions = make('div', 'row-actions'); const b = make('button', 'btn small', 'Auftrag entwerfen'); b.onclick = () => draft(g[0] + ' nachweisen', g[3], g[2]); actions.append(make('span', 'status warn', g[1]), b); row.append(body, actions); list.append(row); }
    if (!projectGates.length) list.append(make('p', '', 'Lege zuerst Projektziel, Module und Abnahmekriterien fest.'));
    const next = $('#analysis-next'); next.replaceChildren(make('p', 'micro', projectGates[0]?.[2] || 'Für dieses Projekt fehlen noch Abnahmekriterien.'));
    const action = make('button', 'btn primary', projectGates.length ? 'Abnahmen prüfen' : 'Ersten Auftrag entwerfen'); action.onclick = () => { if(projectGates.length) { setPanel('gates'); $('[data-analysis="gates"]').focus(); } else draft('Projektziel und Abnahme definieren', data().path, 'Ziel und prüfbare Kriterien dokumentiert'); }; next.append(action);
  }
  function setPanel(name) { $$('[data-analysis-panel]').forEach(e => e.hidden = e.dataset.analysisPanel !== name); $$('[data-analysis]').forEach(e => e.setAttribute('aria-pressed', String(e.dataset.analysis === name))); }
  $$('[data-analysis]').forEach(b => b.onclick = () => setPanel(b.dataset.analysis));
  $('#project').addEventListener('change', renderAnalysis);
  $('#analysis-source').onclick = () => inspect('Analysequellen', knownProject() ? 'Kuratiertes Strukturmodell. Änderungen seit dem Dokumentstand sind nicht automatisch erfasst; Runtime, Tests und Dateieigentum sind vor Ausführung neu zu prüfen.' : 'Für dieses neue Projekt sind noch keine Analysequellen zugeordnet.', analysisSources(), true);
  $('#analysis-benchmark').onclick = () => draft('Koordination und Kontextqualität vergleichbar messen', knownProject() ? 'docs/dev-hq/**' : data().path, 'Gleicher Auftrag, dokumentierte Versionen, Dauer und Belege je Produkt');
  renderAnalysis();

  // Reuse original HQ destinations, keeping live actions in their existing host.
  const destinations = [['Agententeams', 'teams', 'Profile zusammenstellen, Rollen bearbeiten und Arbeit zuweisen.'], ['Queue', 'live-queue', 'Anstehende Arbeit und ihren Zustand verwalten.'], ['Worker & Fleet', 'live-board', 'Vorhandene Worker und Sitzungen überblicken.'], ['Steuerung', 'live-controls', 'Aufträge, Nachrichten und Worker über das vorhandene HQ bedienen.'], ['Lessons', 'live-lessons', 'Erfahrungen suchen und dokumentieren.'], ['Statistiken', 'stats', 'Vorhandene Projekt- und Laufstatistiken lesen.'], ['System & Provider', 'system', 'Setup und Anbieterzustand prüfen.'], ['Belege', 'evidence', 'Die vorhandenen Nachweise öffnen.']];
  const legacy = make('section', 'section'); legacy.id = 'live-hq'; legacy.hidden = true;
  legacy.innerHTML = `<div class="eyebrow">Dein vorhandenes Dev-HQ</div><h1>Alles bleibt erreichbar.</h1><p class="lead">Öffne die bestehenden Arbeitsbereiche im Live-HQ. Dort gelten die vorhandenen Verbindungen und Freigaben. Diese Demo startet keine Worker.</p><div class="card"><div class="field"><label for="live-base">Adresse deines laufenden lokalen HQ · optional im Repository, nötig im portablen Artefakt</label><input id="live-base" placeholder="http://127.0.0.1:PORT/live.html" autocomplete="off"></div><p class="micro" id="live-link-status">Verfügbarkeit nicht geprüft. Lokal starten mit npm run hq:live.</p><button class="btn" id="live-apply">Adresse übernehmen</button></div><div class="legacy-grid" id="legacy-links"></div>`;
  $('#main').append(legacy);
  const liveNav = make('button', '', 'Live-HQ & Teams ↗'); liveNav.dataset.view = 'live-hq'; liveNav.onclick = () => showView('live-hq'); $('.nav [data-view="settings"]').before(liveNav);
  let liveBase = document.documentElement.dataset.portable === 'true' ? null : new URL('../live.html', location.href);
  function renderLinks() {
    $('#legacy-links').replaceChildren(...destinations.map(([name, hash, description]) => { const box = make('article', 'card'); box.append(make('h2', '', name), make('p', 'micro', description)); if (liveBase) { const a = make('a', 'btn', 'Im Live-HQ öffnen ↗'); const url = new URL(liveBase); url.hash = hash; a.href = url.href; a.target = '_blank'; a.rel = 'noopener'; box.append(a); } else box.append(make('p', 'micro', 'Trage oben die lokale HQ-Adresse ein.')); return box; }));
  }
  $('#live-apply').onclick = () => {
    try { const url = new URL($('#live-base').value); if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search) throw new Error(); url.hash = ''; liveBase = url; renderLinks(); $('#live-link-status').textContent = 'Lokale Adresse übernommen. Erreichbarkeit und App-Verbindung noch nicht geprüft.'; }
    catch { $('#live-link-status').textContent = 'Bitte eine lokale HTTP(S)-Adresse ohne Zugangsdaten oder Query-Token eingeben.'; }
  };
  const teams = make('button', 'btn', 'Bestehende Agententeams öffnen ↗'); teams.id = 'open-live-teams'; teams.onclick = () => { showView('live-hq'); $('#live-base').focus(); }; $('#fleet').append(teams);
  renderLinks();
})();
