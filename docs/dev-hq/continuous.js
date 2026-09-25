/* Machine and human views use the same Rust HQ v1 contract. No scheduler here. */
(function () {
  window.createHQContinuous = function ({ container, api, project }) {
    const card = document.createElement('section');
    card.className = 'live-card continuous-card';
    card.innerHTML = `
      <h2>Ziele & kontinuierliche Entwicklung</h2>
      <p data-state role="status" aria-live="polite">Projekt auswählen.</p>
      <p data-runtime role="status" aria-live="polite" class="muted">Runtime-Identität wird geprüft.</p>
      <p data-source class="muted"></p>
      <section data-budget><h2>Budget & Routing</h2></section>
      <p class="muted">Diese Steuerung betrifft die HQ-Planung. Bestehende Worker und der bisherige Dispatcher laufen unabhängig weiter. Automatisches Starten und Ausliefern sind noch nicht freigegeben.</p>
      <div class="continuous-actions">
        <button type="button" data-action="pause">Aufnahme pausieren</button>
        <button type="button" data-action="drain">Arbeit auslaufen lassen</button>
        <button type="button" data-action="resume">Fortsetzen</button>
        <button type="button" data-action="cancel">Kontinuierlichen Lauf beenden</button>
      </div>
      <p data-error role="alert" hidden></p>
      <details><summary>Ziel anlegen</summary>
        <form data-goal-form>
          <label>Ziel<textarea name="objective" required maxlength="8000" rows="2"></textarea></label>
          <label>Abnahmekriterien<textarea name="acceptanceCriteria" required maxlength="8000" rows="2"></textarea></label>
          <button type="submit">Ziel speichern</button>
        </form>
      </details>
      <details><summary>Arbeitspaket zuweisen</summary>
        <form data-task-form>
          <label>Ziel<select name="goalId" required></select></label>
          <label>Auftrag<textarea name="objective" required maxlength="8000" rows="2"></textarea></label>
          <label>Profil-ID<input name="profileId" placeholder="z. B. codex" required></label>
          <label>Dateibereiche (einer je Zeile)<textarea name="ownedPaths" required rows="2" placeholder="src/components/Example.tsx"></textarea></label>
          <label>Abhängige Task-IDs (eine je Zeile)<textarea name="dependencies" rows="2"></textarea></label>
          <button type="submit">Arbeitspaket speichern</button>
        </form>
      </details>
      <div data-goals></div>
      <section data-runs><h2>Runs, Evidenz & Lieferung</h2></section>`;
    container.append(card);
    card.querySelectorAll('button').forEach(button => button.classList.add('hq-button'));
    const state = card.querySelector('[data-state]');
    const runtime = card.querySelector('[data-runtime]');
    const source = card.querySelector('[data-source]');
    const budgetList = card.querySelector('[data-budget]');
    const errorBox = card.querySelector('[data-error]');
    const list = card.querySelector('[data-goals]');
    const runsList = card.querySelector('[data-runs]');
    const select = card.querySelector('[name=goalId]');
    let sequence = 0;
    let loadedProject = null;
    let online = false;
    let busy = false;
    let teams = [];
    function error(value) { errorBox.hidden = !value; errorBox.textContent = value?.message || ''; }
    function enable(available) {
      card.querySelectorAll('button').forEach(button => { button.disabled = !available || busy || button.dataset.locked === 'true'; });
    }
    const text = (parent, tag, value, className) => {
      const element = document.createElement(tag);
      element.textContent = String(value ?? 'unbekannt');
      if (className) element.className = className;
      parent.append(element);
      return element;
    };
    function routingSummary(launch) {
      if (!launch?.routeJson) return 'Routingstatus nicht verfügbar; kein Modell oder Preis wird angenommen.';
      try {
        const receipt = JSON.parse(launch.routeJson);
        const resolved = receipt.selection?.resolved;
        if (!resolved) return 'Routingstatus nicht verfügbar; kein Modell oder Preis wird angenommen.';
        const observation = value => value?.value ?? value?.reason ?? 'unbekannt';
        const reason = receipt.executionObservation?.reason || 'Ausführungsbeleg nicht bestätigt.';
        return `Routing ${resolved.provider || 'unbekannt'} · Profil ${resolved.profileId || 'unbekannt'} · Modell ${observation(resolved.resolvedModel)} · Aufwand ${observation(resolved.effort)} · ${reason}`;
      } catch {
        return 'Routingbeleg unlesbar; kein Modell oder Preis wird angenommen.';
      }
    }
    async function refresh() {
      const current = project();
      const generation = ++sequence;
      online = false; enable(false);
      if (current !== loadedProject) { list.replaceChildren(); select.replaceChildren(); loadedProject = null; }
      if (!current) { state.textContent = 'Projekt auswählen, um Ziele und Arbeitspakete zu sehen.'; source.textContent = ''; enable(false); return; }
      try {
        const [value, runtimeValue, records] = await Promise.all([
          api(`/api/hq/v1/context?projectId=${encodeURIComponent(current)}`),
          api('/api/hq/v1/runtime').catch(() => null),
          api(`/api/hq/v1/runs?projectId=${encodeURIComponent(current)}`).catch(() => null),
        ]);
        if (generation !== sequence || current !== project()) return;
        const manifest = runtimeValue?.manifest || runtimeValue?.provenance?.manifest;
        if (manifest?.state === 'mismatch') runtime.textContent = 'Runtime-Manifest abweichend; Neubau oder Neustart erforderlich. Keine Provider-Fähigkeiten freigegeben.';
        else if (manifest?.state === 'matched') runtime.textContent = 'Runtime-Manifest stimmt mit diesem Checkout überein; Provider-Attestation bleibt separat.';
        else if (runtimeValue?.apiVersion === 1) runtime.textContent = 'Runtime erreichbar; Manifest-Identität nicht bestätigt. Continuous Mode bleibt gesperrt.';
        else runtime.textContent = 'Runtime-Identität nicht verfügbar; angezeigte Fähigkeiten sind nicht bestätigt.';
        const snapshot = value.snapshot || {};
        const goals = snapshot.goals || value.goals || [];
        const tasks = snapshot.tasks || value.tasks || [];
        const control = snapshot.control || value.control || {};
        const effectiveLimits = snapshot.effectiveLimits || value.effectiveLimits || {};
        teams = effectiveLimits.rootPolicies
          ?.flatMap(item => item.policy?.teams || []) || [];
        loadedProject = current;
        online = true;
        state.textContent = `Zustand: ${control.status || 'unbekannt'} · ${goals.length} Ziele · ${tasks.length} Arbeitspakete`;
        source.textContent = `Quelle: Rust/SQLite · ${snapshot.sourceTimestamp || value.observedAt || 'Zeitpunkt unbekannt'} · Cursor ${value.cursor ?? 'unbekannt'}. ${snapshot.commit ? `Commit ${snapshot.commit}` : 'Commit nicht gemessen.'}`;
        error(null);
        const previous = select.value;
        select.replaceChildren();
        list.replaceChildren();
        budgetList.replaceChildren();
        text(budgetList, 'h2', 'Budget & Routing');
        const policies = Array.isArray(effectiveLimits.rootPolicies) ? effectiveLimits.rootPolicies : [];
        if (!policies.length) {
          text(budgetList, 'p', 'Budget- und Routingstatus nicht verfügbar; keine Kosten- oder Modellfähigkeit wird angenommen.', 'muted');
        } else {
          for (const item of policies) {
            const tokens = item.tokens;
            const article = document.createElement('article'); article.className = 'continuous-budget'; budgetList.append(article);
            text(article, 'h3', `Root ${item.rootGoalId || 'unbekannt'}`);
            if (!tokens) {
              text(article, 'p', 'Tokenbudget nicht verfügbar; keine Nutzung wird angenommen.', 'muted');
              continue;
            }
            const allowance = tokens.allowance?.maxPerGoal;
            const limit = Number.isFinite(allowance) ? allowance : 'unbekannt';
            text(article, 'p', `Limit ${limit} · gemessen ${tokens.measuredTokens ?? 'unbekannt'} · reserviert ${tokens.reservedTokens ?? 'unbekannt'}`);
            text(article, 'p', `Verfügbar ${tokens.availableTokens ?? 'unbekannt'} · Prüfungsschutz ${tokens.verificationRemaining ?? 'unbekannt'} · Status ${tokens.usageState || 'unbekannt'}`, 'muted');
          }
        }
        runsList.replaceChildren();
        text(runsList, 'h2', 'Runs, Evidenz & Lieferung');
        for (const goal of goals) {
          const option = document.createElement('option'); option.value = goal.id; option.textContent = goal.objective; select.append(option);
          const section = document.createElement('article'); section.className = 'continuous-goal'; list.append(section);
          text(section, 'h3', goal.objective);
          text(section, 'p', `${goal.status} · ${goal.id}`, 'muted');
          text(section, 'p', goal.acceptanceCriteria || 'Keine Abnahmekriterien gespeichert.');
          const ownTasks = tasks.filter(task => task.goalId === goal.id);
          if (!ownTasks.length) text(section, 'p', 'Noch keine Arbeitspakete.', 'muted');
          for (const task of ownTasks) {
            const details = document.createElement('details'); section.append(details);
            text(details, 'summary', `${task.status} · ${task.objective}`);
            text(details, 'p', `ID ${task.id} · Profil ${task.profileId || 'nicht zugewiesen'} · Versuche ${task.attempts ?? 0}`);
            text(details, 'p', `Bereiche: ${(task.ownedPaths || []).join(', ') || 'keine'} · Abhängigkeiten: ${(task.dependencies || []).join(', ') || 'keine'}`);
            if (task.claim) text(details, 'p', `Besitzer ${task.claim.owner} · Fence ${task.claim.fence}`);
            if (task.assignment) text(details, 'p', `Team ${task.assignment.teamId} · Rolle ${task.assignment.role} · ${task.assignment.assignee} · Revision ${task.assignment.revision}`, 'muted');
            const assignmentForm = document.createElement('form');
            assignmentForm.className = 'continuous-assignment';
            const teamLabel = document.createElement('label'); teamLabel.textContent = 'Team';
            const teamSelect = document.createElement('select'); teamSelect.name = 'teamId'; teamSelect.required = true;
            const roleLabel = document.createElement('label'); roleLabel.textContent = 'Rolle';
            const roleSelect = document.createElement('select'); roleSelect.name = 'role'; roleSelect.required = true;
            const assigneeLabel = document.createElement('label'); assigneeLabel.textContent = 'Agent';
            const assignee = document.createElement('input'); assignee.name = 'assignee'; assignee.required = true; assignee.maxLength = 128; assignee.placeholder = 'z. B. worker-1';
            const assignButton = document.createElement('button'); assignButton.type = 'submit'; assignButton.textContent = task.assignment ? 'Zuweisung aktualisieren' : 'Team zuweisen'; assignButton.className = 'hq-button';
            const allowedTeams = teams.filter(team => Array.isArray(team.roles) && team.roles.length);
            for (const team of allowedTeams) { const option = document.createElement('option'); option.value = team.id; option.textContent = team.id; teamSelect.append(option); }
            const currentTeam = task.assignment?.teamId || allowedTeams[0]?.id;
            if (currentTeam) teamSelect.value = currentTeam;
            const fillRoles = () => {
              roleSelect.replaceChildren();
              const team = allowedTeams.find(item => item.id === teamSelect.value);
              for (const role of team?.roles || []) { const option = document.createElement('option'); option.value = role; option.textContent = role; roleSelect.append(option); }
              if (task.assignment?.role && [...roleSelect.options].some(option => option.value === task.assignment.role)) roleSelect.value = task.assignment.role;
            };
            teamSelect.addEventListener('change', fillRoles); fillRoles();
            if (task.assignment?.assignee) assignee.value = task.assignment.assignee;
            const revision = task.assignment?.revision || 0;
            teamLabel.append(teamSelect); roleLabel.append(roleSelect); assigneeLabel.append(assignee);
            assignmentForm.append(teamLabel, roleLabel, assigneeLabel, assignButton);
            assignmentForm.addEventListener('submit', event => {
              event.preventDefault();
              void mutate(`/api/hq/v1/tasks/${encodeURIComponent(task.id)}/assignment`, {
                teamId: teamSelect.value, role: roleSelect.value, assignee: assignee.value, expectedRevision: revision,
              }, null);
            });
            if (!allowedTeams.length || task.status !== 'open' || task.claim) {
              assignButton.dataset.locked = 'true';
              assignButton.title = !allowedTeams.length ? 'Keine Policy-Rollen verfügbar.' : 'Zuweisungen sind nach Claim oder Abschluss gesperrt.';
            }
            details.append(assignmentForm);
            if (task.detail || task.checkpoint) text(details, 'pre', task.detail || task.checkpoint);
          }
        }
        if ([...select.options].some(option => option.value === previous)) select.value = previous;
        if (!goals.length) text(list, 'p', 'Noch keine Ziele. Ein Ziel beschreibt Ergebnis und überprüfbare Abnahme.', 'muted');
        if (!records) {
          text(runsList, 'p', 'Run- und Lieferstatus nicht verfügbar; keine Evidenz wird angenommen.', 'muted');
        } else if (!Array.isArray(records.runs) || !records.runs.length) {
          text(runsList, 'p', 'Noch keine kontinuierlichen Runs.', 'muted');
        } else {
          for (const record of records.runs) {
            const run = record.run || {};
            const article = document.createElement('article'); article.className = 'continuous-run'; runsList.append(article);
            text(article, 'h3', `${run.status || 'unbekannt'} · ${run.id || 'Run ohne ID'}`);
            text(article, 'p', `Task ${run.taskId || 'unbekannt'} · Besitzer ${run.claimOwner || 'unbekannt'} · Fence ${run.claimFence ?? 'unbekannt'}`);
            const candidate = record.candidate;
            text(article, 'p', candidate ? `Candidate ${candidate.candidateCommit} · Quelle ${candidate.source || 'unbekannt'}` : 'Candidate nicht gebunden.', candidate ? undefined : 'muted');
            text(article, 'p', routingSummary(record.launch), 'muted');
            const evidence = Array.isArray(record.evidence) ? record.evidence : [];
            const reviews = Array.isArray(record.reviews) ? record.reviews : [];
            text(article, 'p', `Evidenz ${evidence.length} · Reviews ${reviews.length} · Ausführung ${records.executionEnabled === true ? 'aktiv' : 'deaktiviert'}`);
            const tokens = record.tokens;
            if (tokens) text(article, 'p', `Budget ${tokens.availableTokens ?? 'unbekannt'} verfügbar · Nutzung ${tokens.usageState || 'unbekannt'}`, 'muted');
            else text(article, 'p', 'Budgetstatus nicht verfügbar; keine Nutzung wird angenommen.', 'muted');
            if (reviews.length) text(article, 'p', reviews.map(review => `${review.disposition || 'unbekannt'} (${review.status || 'unbekannt'})`).join(' · '));
            if (record.approvalAuthority?.state || records.approvalAuthority?.state) text(article, 'p', `Freigabeautorität: ${record.approvalAuthority?.state || records.approvalAuthority.state}`, 'muted');
          }
        }
        enable(true);
      } catch (failure) {
        if (generation !== sequence || current !== project()) return;
        runtime.textContent = 'Runtime-Identität nicht verfügbar; angezeigte Fähigkeiten sind nicht bestätigt.';
        state.textContent = 'HQ-Kern nicht verfügbar. Angezeigte Ziele sind keine aktuellen Laufzeitbelege.';
        error(failure); enable(false);
      }
    }
    async function mutate(path, body, form) {
      if (busy || !online || loadedProject !== project()) return;
      const current = project();
      busy = true; enable(false); error(null);
      try {
        await api(path, { method: 'POST', body: JSON.stringify(body) });
        if (current === project()) form?.reset();
      } catch (failure) { if (current === project()) error(failure); busy = false; enable(online && loadedProject === project()); return; }
      busy = false; await refresh();
    }
    const confirmations = {
      cancel: 'Kontinuierlichen Lauf wirklich beenden? Laufende Arbeit wird nicht mehr fortgesetzt.',
      drain: 'Arbeit wirklich auslaufen lassen? Es werden keine neuen Arbeitspakete mehr aufgenommen.',
    };
    card.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
      const question = confirmations[button.dataset.action];
      if (question && !window.confirm(question)) return;
      void mutate('/api/hq/v1/control', { projectId: project(), action: button.dataset.action });
    }));
    card.querySelector('[data-goal-form]').addEventListener('submit', event => {
      event.preventDefault(); const form = event.currentTarget;
      void mutate('/api/hq/v1/goals', { projectId: project(), objective: form.elements.objective.value, acceptanceCriteria: form.elements.acceptanceCriteria.value }, form);
    });
    card.querySelector('[data-task-form]').addEventListener('submit', event => {
      event.preventDefault(); const form = event.currentTarget;
      const lines = name => form.elements[name].value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      void mutate(`/api/hq/v1/goals/${encodeURIComponent(form.elements.goalId.value)}/tasks`, {
        objective: form.elements.objective.value, profileId: form.elements.profileId.value,
        ownedPaths: lines('ownedPaths'), dependencies: lines('dependencies'),
      }, form);
    });
    enable(false);
    return { refresh, element: card };
  };
}());
