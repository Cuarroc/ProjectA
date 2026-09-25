/* Structural view of an imported, immutable plan projection. No execution inference. */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.StudioRoadmap = value;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const nonblank = value => typeof value === 'string' && value.trim().length > 0;
  function invalid(message) {
    const error = new Error(message);
    error.code = 'invalid_projection';
    return error;
  }

  function validate(envelope, projectId) {
    if (!envelope || envelope.contractVersion !== 1 || envelope.availability !== 'available' || envelope.projectId !== projectId || !nonblank(envelope.sourceRevision)) {
      throw invalid('Ungültige Plan-Antwort: Version oder Projekt stimmt nicht. Erneut laden.');
    }
    const p = envelope.projection;
    if (!p || p.projectId !== projectId || p.planId !== 'main' || p.sourcePath !== 'docs/PLAN.md' || p.sourceRevision !== envelope.sourceRevision || !Number.isSafeInteger(p.projectionRevision) || p.projectionRevision < 1 || typeof p.source !== 'string' || !Array.isArray(p.packages)) {
      throw invalid('Ungültige Plan-Projektion. Erneut laden.');
    }
    const ids = new Set();
    const sourceLineCount = p.source.split('\n').length;
    for (const item of p.packages) {
      const badIdentity = !item || item.projectId !== projectId || item.planId !== 'main' || item.sourcePath !== 'docs/PLAN.md';
      const badSource = !nonblank(item?.sourceRevision) || !Number.isSafeInteger(item?.sourceLine) || item.sourceLine < 1 || (item.sourceRevision === p.sourceRevision && item.sourceLine > sourceLineCount);
      const badFields = !nonblank(item?.packageId) || !nonblank(item?.title) || typeof item?.acceptance !== 'string' || !Array.isArray(item?.dependencyIds) || item.dependencyIds.some(id => !nonblank(id)) || (item.parentId !== null && !nonblank(item.parentId)) || typeof item.removed !== 'boolean' || typeof item.noNewDispatch !== 'boolean';
      if (badIdentity || badSource || badFields || ids.has(item.packageId)) throw invalid('Ungültiges Plan-Paket. Erneut laden.');
      ids.add(item.packageId);
    }
    const active = new Map(p.packages.filter(item => !item.removed).map(item => [item.packageId, item]));
    for (const item of active.values()) {
      const dependencies = new Set(item.dependencyIds);
      if (dependencies.size !== item.dependencyIds.length || [...dependencies].some(id => !active.has(id) || id === item.packageId)) {
        throw invalid(`Ungültige Abhängigkeiten bei ${item.packageId}: doppelte, entfernte oder fehlende Referenz.`);
      }
      if (item.parentId && (!active.has(item.parentId) || item.parentId === item.packageId)) {
        throw invalid(`Ungültiger Elternbezug bei ${item.packageId}: entferntes oder fehlendes Paket.`);
      }
    }
    try { analyze(p.packages); } catch (error) { throw invalid(`Ungültiger Plan: ${error.message}`); }
    const visiting = new Set(), visited = new Set();
    function checkParent(id) {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw invalid('Ungültiger Plan: Kreis in der Elternhierarchie.');
      visiting.add(id);
      const parent = active.get(id).parentId;
      if (parent) checkParent(parent);
      visiting.delete(id); visited.add(id);
    }
    for (const id of active.keys()) checkParent(id);
    return p;
  }

  function analyze(packages) {
    const active = packages.filter(item => !item.removed);
    const byId = new Map(active.map((item, index) => [item.packageId, { ...item, order: index, level: 0, descendants: 0, dependents: [], children: [] }]));
    for (const node of byId.values()) {
      for (const id of node.dependencyIds) byId.get(id)?.dependents.push(node.packageId);
      if (node.parentId) byId.get(node.parentId)?.children.push(node.packageId);
    }
    const levels = new Map(), visiting = new Set();
    function level(id) {
      if (levels.has(id)) return levels.get(id);
      if (visiting.has(id)) throw new Error('Plan enthält einen Abhängigkeitskreis.');
      visiting.add(id);
      const node = byId.get(id);
      const value = Math.max(0, ...node.dependencyIds.filter(dep => byId.has(dep)).map(dep => level(dep) + 1));
      visiting.delete(id); levels.set(id, value); return value;
    }
    function descendants(id, seen = new Set()) {
      for (const next of byId.get(id).dependents) if (!seen.has(next)) { seen.add(next); descendants(next, seen); }
      return seen;
    }
    for (const node of byId.values()) { node.level = level(node.packageId); node.descendants = descendants(node.packageId).size; }
    const nodes = [...byId.values()];
    return { nodes, byId, removed: packages.filter(item => item.removed), longestChain: Math.max(0, ...nodes.map(node => node.level)) };
  }

  function packageButton(item, selected, cls = '', idOnly = false) {
    return `<button type="button" class="roadmap-package ${cls}"
      data-roadmap-package="${esc(item.packageId)}" aria-pressed="${item.packageId === selected}">
      <strong>${esc(item.packageId)}</strong>${idOnly ? '' : `<span>${esc(item.title)}</span>`}
    </button>`;
  }
  function render(data) {
    const { projectId, status, error, envelope, selected, view, sort, sourceOpen, reason, importing } = data;
    const p = envelope?.projection, graph = p ? analyze(p.packages) : null;
    const chosen = p?.packages.find(item => item.packageId === selected) || graph?.nodes[0];
    const actionable = status === 'available' || status === 'missing';
    const importButton = status === 'unsupported' ? '' : `<button type="button" id="roadmap-import" class="primary" ${actionable ? '' : 'disabled'}>${p ? 'Plan erneut importieren' : 'Plan importieren'}</button>`;
    const statusText = ({
      idle: 'Projekt auswählen.',
      loading: importing ? 'Import läuft …' : 'Plan wird gelesen …',
      missing: 'Dieser Plan wurde noch nicht importiert. Der Import liest docs/PLAN.md aus dem registrierten Projekt.',
      unsupported: 'Diese Runtime unterstützt Plan-Projektionen Version 1 nicht. Runtime aktualisieren.',
      invalid: 'Die Runtime lieferte eine ungültige Plan-Antwort. Erneut laden.',
      stale: 'Gezeigte Projektion ist veraltet. Vor einem weiteren Import explizit neu laden.',
      unknown: 'Import-Ergebnis unbekannt. Vor einem weiteren Import explizit neu laden.',
      unavailable: 'Plan-Projektion derzeit nicht verfügbar. Verbindung prüfen und neu laden.',
      error: 'Plan konnte nicht gelesen werden. Erneut laden.',
      available: '',
    })[status] ?? 'Projekt auswählen.';
    const warning = error ? `<p class="roadmap-alert" role="alert">${esc(statusText)} ${esc(error)}</p>` : statusText ? `<p class="roadmap-alert" role="status">${esc(statusText)}</p>` : '';
    let content = '<p class="empty">Noch keine Projektion geladen.</p>';
    if (graph) {
      const ordered = sort === 'downstream' ? [...graph.nodes].sort((a, b) => b.descendants - a.descendants || a.order - b.order) : graph.nodes;
      const groups = [...new Set(ordered.map(item => item.level))].sort((a, b) => a - b);
      const neighborhood = new Set(chosen && !chosen.removed ? [chosen.packageId, ...chosen.dependencyIds, ...(graph.byId.get(chosen.packageId)?.dependents || [])] : []);
      const cards = groups.map(level => `<section class="roadmap-level">
        <h3>Ebene ${level}</h3>
        <div class="roadmap-level-items">${ordered.filter(item => item.level === level)
          .map(item => packageButton(item, chosen?.packageId, neighborhood.has(item.packageId) ? 'related' : ''))
          .join('')}</div>
      </section>`).join('');
      const tableRows = ordered.map(item => `<tr>
        <th scope="row">${packageButton(item, chosen?.packageId, '', true)}</th>
        <td>${esc(item.title)}</td><td>${esc(item.level)}</td>
        <td>${esc(item.parentId || '—')}</td><td>${esc(item.dependencyIds.join(', ') || '—')}</td>
        <td>${esc(item.descendants)}</td>
        <td>${esc(item.acceptance.length > 90 ? item.acceptance.slice(0, 90) + '…' : item.acceptance)}</td>
      </tr>`).join('');
      const tableCaption = sort === 'downstream'
        ? 'Alle aktuellen Pakete nach einzigartig erreichbaren Nachfolgern sortiert; Gleichstand in Dokumentreihenfolge.'
        : 'Alle aktuellen Pakete in Dokumentreihenfolge; Ebene und Nachfolger sind strukturell berechnet.';
      const graphPanel = view === 'table'
        ? `<div class="table-scroll"><table class="roadmap-table"><caption>${tableCaption}</caption><thead><tr><th scope="col">ID / Auswahl</th><th scope="col">Titel</th><th scope="col">Ebene</th><th scope="col">Übergeordnet</th><th scope="col">Abhängigkeiten</th><th scope="col">Nachfolger</th><th scope="col">Abnahmeauszug</th></tr></thead><tbody>${tableRows}</tbody></table></div>`
        : `<div class="roadmap-graph" aria-label="Abhängigkeitsstufen mit gerichteten Kanten"><svg class="roadmap-edges" aria-hidden="true"></svg>${cards}</div>`;
      const relation = ids => ids.length
        ? ids.map(id => `<button type="button" class="roadmap-link" data-roadmap-package="${esc(id)}">${esc(id)}</button>`).join(' ')
        : '—';
      function parentPath(item) {
        const path = [], seen = new Set();
        let parent = item.parentId;
        while (parent && graph.byId.has(parent) && !seen.has(parent)) {
          path.unshift(parent);
          seen.add(parent);
          parent = graph.byId.get(parent).parentId;
        }
        return path;
      }
      const node = chosen && graph.byId.get(chosen.packageId);
      const provenanceMatches = chosen?.sourceRevision === p.sourceRevision;
      const inspector = chosen ? `<h2 id="roadmap-inspector-title" tabindex="-1">${esc(chosen.packageId)} · ${esc(chosen.title)}</h2>
        ${chosen.removed
          ? '<p class="roadmap-alert">Entferntes Paket · kein neuer Dispatch.</p>'
          : '<p class="micro">Ausführung unbekannt · keine Run-Bindung. Freigabe unbekannt · Gates ausstehend.</p>'}
        <dl>
          <dt>Abnahme</dt><dd>${esc(chosen.acceptance)}</dd>
          <dt>Elternpfad</dt><dd>${esc(parentPath(chosen).join(' → ') || '—')}</dd>
          <dt>Direkte Voraussetzungen</dt><dd>${relation(chosen.dependencyIds.filter(id => graph.byId.has(id)))}</dd>
          <dt>Direkte Nachfolger</dt><dd>${relation(node?.dependents || [])}</dd>
          <dt>Quelle</dt><dd>${esc(chosen.sourcePath)}:${esc(chosen.sourceLine)}<br>
            <span class="micro">Revision ${esc(chosen.sourceRevision)}</span></dd>
        </dl>
        <div class="actions">
          <button type="button" id="roadmap-copy-source">Pfad, Zeile, Revision kopieren</button>
          ${provenanceMatches ? `<button type="button" id="roadmap-open-source">Quellzeile ${esc(chosen.sourceLine)} anzeigen</button>` : ''}
        </div>
        ${provenanceMatches ? '' : '<p class="micro">Historische Quellbytes sind nicht geladen. Die aktuelle Quelle wird für dieses entfernte Paket nicht als Beleg verwendet.</p>'}`
        : '<h2 id="roadmap-inspector-title" tabindex="-1">Paket wählen</h2>';
      const sourceLines = p.source.split('\n').map((line, index) => `<div id="roadmap-line-${index + 1}"
        class="roadmap-source-line ${sourceOpen && provenanceMatches && chosen?.sourceLine === index + 1 ? 'is-target' : ''}">
        <span aria-hidden="true">${index + 1}</span><span>${esc(line) || ' '}</span>
      </div>`).join('');
      function hierarchyBranch(node, ancestors = new Set()) {
        if (ancestors.has(node.packageId)) return '';
        const next = new Set(ancestors);
        next.add(node.packageId);
        return `<li>${packageButton(node, chosen?.packageId)}${node.children.length ? `<ul>${node.children.map(id => hierarchyBranch(graph.byId.get(id), next)).join('')}</ul>` : ''}</li>`;
      }
      const roots = graph.nodes.filter(item => (!item.parentId || !graph.byId.has(item.parentId)) && item.children.length);
      const hierarchy = `<section class="roadmap-hierarchy" aria-label="Elternhierarchie">
        <h3>Elternhierarchie</h3>
        <p class="micro">Enthält-Beziehungen aus dem Plan; die gerichteten Linien oben zeigen ausschließlich Abhängigkeiten.</p>
        ${roots.length ? `<div class="roadmap-hierarchy-scroll" role="region" aria-label="Eltern und Unterpakete" tabindex="0"><ul>${roots.map(item => hierarchyBranch(item)).join('')}</ul></div>` : '<p class="micro">Keine Eltern-Unterpaket-Beziehungen in dieser Projektion.</p>'}
      </section>`;
      content = `<div class="roadmap-summary">
        <span>${graph.nodes.length} aktuelle Pakete · ${graph.removed.length} entfernte</span>
        <span>Längste Abhängigkeitskette: ${graph.longestChain} Kanten · keine Zeitprognose</span>
      </div>
      <div class="roadmap-controls">
        <div role="group" aria-label="Darstellung">
          <button type="button" id="roadmap-view-graph" aria-pressed="${view !== 'table'}">Graph</button>
          <button type="button" id="roadmap-view-table" aria-pressed="${view === 'table'}">Tabelle</button>
        </div>
        <label>Sortierung <select id="roadmap-sort">
          <option value="document" ${sort !== 'downstream' ? 'selected' : ''}>Dokumentreihenfolge</option>
          <option value="downstream" ${sort === 'downstream' ? 'selected' : ''}>Erreichbare Nachfolger</option>
        </select></label>
      </div>
      <p class="micro">Nachfolger werden über alle Pfade einmalig gezählt. Strukturstufen geben keine Startfreigabe.</p>
      <div class="roadmap-layout">
        <section class="panel roadmap-main" aria-label="Planstruktur">
          ${graph.nodes.length ? graphPanel : '<p class="empty">Keine aktuellen Pakete.</p>'}
          ${hierarchy}
          ${graph.removed.length ? `<details id="roadmap-removed" ${data.removedOpen ? 'open' : ''}><summary>${graph.removed.length} entfernte Pakete mit Herkunft</summary><div class="roadmap-removed">${graph.removed.map(item => packageButton(item, chosen?.packageId)).join('')}</div></details>` : ''}
        </section>
        <aside class="panel roadmap-inspector" id="roadmap-inspector" aria-labelledby="roadmap-inspector-title">${inspector}</aside>
      </div>
      <details id="roadmap-source" ${sourceOpen ? 'open' : ''}>
        <summary>Importierte Quelle · ${esc(p.sourcePath)} · Revision ${esc(p.sourceRevision)}</summary>
        <div class="roadmap-source-scroll" role="region" aria-label="Importierte Planquelle" tabindex="0">${sourceLines}</div>
      </details>`;
    }
    return `<div class="roadmap-title">
      <div><h1>Roadmap</h1><p class="lead">Importierte Planstruktur des ausgewählten Runtime-Projekts. Ausführung und Release-Freigabe bleiben ohne Run- und Gate-Belege unbekannt.</p></div>
      <span class="badge">Plan: main</span>
    </div>
    <div class="panel roadmap-header">
      <div><strong>Quelle: docs/PLAN.md</strong><p class="micro">${p ? `Quellrevision ${esc(p.sourceRevision)} · Projektion ${p.projectionRevision}` : 'Noch keine importierte Quellrevision'}</p></div>
      <div class="actions"><button type="button" id="roadmap-reload" ${projectId && !importing ? '' : 'disabled'}>Plan neu laden</button>${importButton}</div>
    </div>
    ${warning}
    <details id="roadmap-advanced" class="roadmap-advanced" ${data.reasonOpen ? 'open' : ''}>
      <summary>Erweiterter Import · Rollback-Grund</summary>
      <label class="field roadmap-reason"><span>Grund nur für ausdrücklich verlangten historischen Reimport</span>
        <input id="roadmap-reason" value="${esc(reason || '')}" autocomplete="off">
      </label>
    </details>
    ${content}`;
  }
  return { analyze, validate, render };
});
