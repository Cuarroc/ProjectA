(function (root) {
  'use strict';
  const signature = p => JSON.stringify([p.command, p.args || []]);
  function advise(config, profiles, quota, task, now = Date.now()) {
    const rows = profiles.map(p => {
      const q = quota.find(x => x.profileId === p.id);
      const reasons = [];
      if (p.enabled === false) reasons.push('Profil deaktiviert');
      if (!q || q.state !== 'ok' || !q.updatedAt || q.updatedAt * 1000 > now || now - q.updatedAt * 1000 > 3600000) reasons.push('Kapazität unbekannt, gesperrt oder älter als 1 Stunde');
      const evidence = config.evidence.filter(e => e.profileId === p.id && e.task === task && e.profileSignature === signature(p) && Number.isFinite(Date.parse(e.observedAt)) && now >= Date.parse(e.observedAt) && now - Date.parse(e.observedAt) <= config.rules.maxAgeDays * 86400000);
      // Do not pool different model/effort settings into a fictitious measured model.
      const groups = new Map();
      for (const e of evidence) { const key = JSON.stringify([e.model, e.effort]); const g = groups.get(key) || []; g.push(e); groups.set(key, g); }
      const measured = [...groups.values()].map(group => {
        const samples = group.reduce((n, e) => n + e.samples, 0);
        return { model: group[0].model, effort: group[0].effort, samples, quality: group.reduce((n, e) => n + e.passed, 0) / samples, seconds: group.reduce((n, e) => n + e.seconds * e.samples, 0) / samples, sources: group.map(e => ({ source: e.source, kind: e.kind, observedAt: e.observedAt })) };
      }).filter(g => g.samples >= config.rules.minimumSamples).sort((a, b) => b.quality - a.quality || a.seconds - b.seconds);
      const best = measured[0];
      if (!best && config.rules.requireEvidence) reasons.push('Zu wenige aktuelle Belege für Aufgabe und Profilkonfiguration');
      return { profile: p, reasons, groups: measured, measured: best || null, rank: config.order.indexOf(p.id) < 0 ? 999 : config.order.indexOf(p.id) };
    });
    const fastest = Math.min(...rows.filter(r => !r.reasons.length).flatMap(r => r.groups.map(g => g.seconds)));
    const score = g => config.rules.qualityWeight * g.quality + (100 - config.rules.qualityWeight) * (Number.isFinite(fastest) ? Math.min(1, fastest / g.seconds) : 0);
    for (const r of rows) {
      r.groups.sort((a, b) => score(b) - score(a) || a.seconds - b.seconds);
      r.measured = r.groups[0] || null;
      r.score = r.measured ? score(r.measured) : null;
      delete r.groups;
    }
    return rows.sort((a, b) => Number(Boolean(a.reasons.length)) - Number(Boolean(b.reasons.length)) || (b.score ?? -1) - (a.score ?? -1) || a.rank - b.rank || a.profile.name.localeCompare(b.profile.name));
  }
  function taskPrompt({ mode, text, files, proof, skills, plugins, goal, constraints }) {
    const modes = { plan: 'Planmodus: nur analysieren und einen überprüfbaren Plan vorschlagen. Keine Dateien ändern oder Implementierung starten. Bei Unklarheit Rückfragen stellen.', interview: 'Interviewmodus: Projektziel, Nutzerablauf, Randbedingungen und Abnahme klären. Zuerst die wichtigste konkrete Rückfrage stellen; keine Implementierung.', build: 'Implementierung: ausschließlich den vereinbarten Umfang bearbeiten und Abnahme belegen.' };
    return [modes[mode] || modes.plan, `Auftrag: ${text}`, files && `Dateiumfang: ${files}`, proof && `Abnahme: ${proof}`, goal && `Projektziel: ${goal}`, constraints && `Randbedingungen: ${constraints}`, skills?.length && `Explizit gewählte Skill-Quellen (vor Anwendung lesen):\n${skills.join('\n')}`, plugins?.length && `Gewählte Plugins: ${plugins.join(', ')}. Nur verwenden, wenn sie in diesem Harness tatsächlich verfügbar sind; andernfalls die fehlende Fähigkeit melden.`].filter(Boolean).join('\n\n');
  }
  const api = { advise, signature, taskPrompt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StudioModel = api;
})(globalThis);
