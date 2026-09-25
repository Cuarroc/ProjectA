/* B/C workspace: move the existing live surfaces, keeping their API bindings. */
(function () {
  window.createHQWorkspace = function (root, snapshot) {
    document.body.classList.add('hq-workspace');
    const sections = [...root.querySelectorAll(':scope > .desk-section')];
    const nav = document.querySelector('.hq-nav');
    const sourceLinks = nav.cloneNode(true);
    sourceLinks.removeAttribute('class');
    sourceLinks.className = 'workspace-sources';
    sourceLinks.setAttribute('aria-label', 'Repository documents');
    nav.replaceChildren();
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Arbeitsbereiche');
    const definitions = [
      ['overview', 'Übersicht', 'Arbeit & Entscheidungen'],
      ['teams', 'Agenten-Teams', 'Organisation & Besetzung'],
      ['stats', 'Statistiken', 'Verbrauch & Projektentwicklung'],
      ['evidence', 'Belege', 'Review, Quellen & Erfahrung'],
      ['system', 'System', 'Verbindungen & Einrichtung'],
    ];
    const stage = document.createElement('div');
    stage.className = 'workspace-stage';
    root.append(stage);
    const panels = new Map();
    for (const [id, label, title] of definitions) {
      const button = document.createElement('button');
      button.id = `tab-${id}`;
      button.type = 'button';
      button.textContent = label;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', `panel-${id}`);
      nav.append(button);
      const panel = document.createElement('section');
      panel.id = `panel-${id}`;
      panel.className = 'workspace-panel';
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', button.id);
      panel.tabIndex = 0;
      const heading = document.createElement('h2');
      heading.className = 'workspace-title';
      heading.textContent = title;
      panel.append(heading);
      stage.append(panel);
      panels.set(id, panel);
      button.addEventListener('click', () => activate(id));
    }
    const put = (id, node) => { if (node) panels.get(id).append(node); };
    const card = (selector) => root.querySelector(selector)?.closest('.live-card');
    put('overview', sections[0]);
    put('stats', sections[1]);
    put('overview', sections[2]);
    put('teams', sections[3]);
    put('evidence', sections[4]);
    put('system', sections[5]);
    put('stats', card('#live-usage'));
    put('system', card('#live-providers'));
    put('evidence', card('#live-review'));
    put('evidence', card('#live-recommendations'));
    put('evidence', card('#live-activity'));
    panels.get('evidence').prepend(sourceLinks);
    const controls = root.querySelector('#live-controls');
    const controlsDetails = document.createElement('details');
    controlsDetails.className = 'workspace-controls';
    const summary = document.createElement('summary');
    summary.textContent = 'Auftrag erteilen · Nachricht senden · Worker starten';
    controlsDetails.append(summary, controls);
    put('overview', controlsDetails);
    put('overview', root.querySelector('#worker-detail'));
    put('teams', root.querySelector('#team-editor'));
    const meta = document.createElement('p');
    meta.className = 'workspace-reference';
    meta.textContent = `Repository-Snapshot: ${snapshot.commit || 'unbekannt'} · ${snapshot.generatedAt || 'Zeitpunkt unbekannt'}. Live-Daten: siehe Verbindungsstatus.`;
    put('evidence', meta);
    const toolbarMeta = root.querySelector('.live-toolbar .meta');
    if (toolbarMeta) toolbarMeta.textContent = 'LIVE · PROJECTA';
    const title = document.querySelector('.hq-bar h1');
    if (title) title.textContent = 'DEV-HQ / ProjectA';
    const description = document.querySelector('.hq-description');
    if (description) description.textContent = 'Werkbank & Instrument';

    function activate(id, focus = false, updateHash = true) {
      if (!panels.has(id)) id = 'overview';
      for (const [key, panel] of panels) {
        const selected = key === id;
        panel.hidden = !selected;
        const tab = document.getElementById(`tab-${key}`);
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (selected && focus) tab.focus();
      }
      if (updateHash) history.replaceState(null, '', `#${id}`);
    }
    nav.addEventListener('keydown', (event) => {
      const buttons = [...nav.querySelectorAll('[role=tab]')];
      const index = buttons.indexOf(event.target);
      if (index < 0) return;
      const next = { ArrowRight: (index + 1) % buttons.length, ArrowLeft: (index + buttons.length - 1) % buttons.length, Home: 0, End: buttons.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      activate(definitions[next][0], true);
    });
    const fromHash = () => {
      const id = location.hash.slice(1);
      if (panels.has(id)) activate(id, false, false);
      else {
        activate('overview', false, false);
        const target = document.getElementById(id);
        if (target && root.contains(target)) reveal(target);
      }
    };
    window.addEventListener('hashchange', fromHash);
    function reveal(target) {
      const node = typeof target === 'string' ? root.querySelector(target) : target;
      if (!node) return;
      const panel = node.closest('.workspace-panel');
      if (panel) activate(panel.id.replace('panel-', ''));
      for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) {
        if (parent.tagName === 'DETAILS') parent.open = true;
      }
      node.scrollIntoView?.({ block: 'nearest' });
    }
    let selectedTeam = null;
    const teamHost = root.querySelector('#live-teams');
    const teamLayout = document.createElement('div');
    teamLayout.className = 'workspace-team-layout';
    const teamNav = document.createElement('div');
    teamNav.className = 'workspace-team-nav';
    teamNav.setAttribute('role', 'radiogroup');
    teamNav.setAttribute('aria-label', 'Team auswählen');
    teamHost.before(teamLayout);
    teamLayout.append(teamNav, teamHost);
    const teamNames = ['Review', 'Debug', 'Coding', 'Testing', 'UI / UX', 'Orchestrator', 'Advisor'];
    function teamsChanged() {
      const groups = [...teamHost.querySelectorAll('.team-group')];
      const names = [...new Set([...groups.map(g => g.querySelector('h3').textContent), ...teamNames])];
      if (!names.includes(selectedTeam)) selectedTeam = names[0];
      const priorFocus = teamNav.contains(document.activeElement) ? document.activeElement.dataset.team : null;
      teamNav.replaceChildren();
      let empty = teamHost.querySelector('.workspace-team-empty');
      if (!empty) {
        empty = document.createElement('p');
        empty.className = 'workspace-team-empty';
        empty.textContent = 'Noch keine Profile in diesem Team. Mit „New agent profile“ ein Profil erstellen; das Team wird vorausgefüllt.';
        teamHost.append(empty);
      }
      function select(name) {
        selectedTeam = name;
        groups.forEach(g => { g.hidden = g.querySelector('h3').textContent !== name; });
        empty.hidden = groups.some(g => !g.hidden);
        [...teamNav.children].forEach(b => {
          const on = b.dataset.team === name;
          b.setAttribute('aria-checked', String(on));
          b.tabIndex = on ? 0 : -1;
        });
      }
      for (const name of names) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'radio');
        button.dataset.team = name;
        const count = groups.find(g => g.querySelector('h3').textContent === name)?.querySelectorAll('.live-row').length || 0;
        button.textContent = `${name} · ${count}`;
        button.addEventListener('click', () => select(name));
        teamNav.append(button);
        if (button.dataset.team === priorFocus) button.focus();
      }
      select(selectedTeam);
    }
    // Same keys as the main tabs: one tab stop, arrows walk, Home/End jump.
    teamNav.addEventListener('keydown', event => {
      const radios = [...teamNav.children];
      const at = radios.indexOf(document.activeElement);
      if (at < 0 || radios.length === 0) return;
      let next = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (at + 1) % radios.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (at - 1 + radios.length) % radios.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = radios.length - 1;
      if (next === null) return;
      event.preventDefault();
      radios[next].click();
      radios[next].focus();
    });
    fromHash();
    return { activate, reveal, teamsChanged, selectedTeam: () => selectedTeam === 'Built-in agents' ? '' : selectedTeam || '' };
  };
})();
