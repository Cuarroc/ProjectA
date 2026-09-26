/* Machine and human views use the same Rust HQ v1 contract. No scheduler here. */
(function () {
  window.createHQContinuous = function ({ container, api, project }) {
    const card = document.createElement('section');
    card.className = 'live-card continuous-card';
    card.id = 'hq-goals-live';
    card.tabIndex = -1;
    card.innerHTML = `
      <h2>Ziele & kontinuierliche Entwicklung</h2>
      <p data-state role="status" aria-live="polite">Projekt auswählen.</p>
      <p data-runtime role="status" aria-live="polite" class="muted">Runtime-Identität wird geprüft.</p>
      <p data-source class="muted"></p>
      <div data-ownership class="continuous-ownership" aria-label="Besetzung laufender Ziele"></div>
      <section data-budget id="hq-budget-live" tabindex="-1" aria-label="Budget und Routing"></section>
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
    const ownership = card.querySelector('[data-ownership]');
    const runsList = card.querySelector('[data-runs]');
    const select = card.querySelector('[name=goalId]');
    let sequence = 0;
    let loadedProject = null;
    let online = false;
    let busy = false;
    let teams = [];
    let lastSignature = null;
    let lastBudgetSignature = null;
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
        // The HQ v1 API serializes Observation<T> externally tagged:
        // {measured|configured|requested|estimated: {value}} or
        // {unavailable: {reason}} (src-tauri/src/development_policy.rs).
        const observation = value => value?.measured?.value ?? value?.configured?.value ?? value?.requested?.value ?? value?.estimated?.value ?? value?.unavailable?.reason ?? 'unbekannt';
        const reason = receipt.executionObservation?.reason || 'Ausführungsbeleg nicht bestätigt.';
        return `Routing ${resolved.provider || 'unbekannt'} · Profil ${resolved.profileId || 'unbekannt'} · Modell ${observation(resolved.resolvedModel)} · Aufwand ${observation(resolved.effort)} · ${reason}`;
      } catch {
        return 'Routingbeleg unlesbar; kein Modell oder Preis wird angenommen.';
      }
    }
    const USAGE_STATE_LABELS = {
      measured: 'gemessen',
      partial: 'teilweise belegt',
      no_receipts: 'keine Belege erfasst',
      no_allowance: 'kein Budget eingeräumt',
    };
    function renderBudget(policies, records) {
      budgetList.replaceChildren();
      text(budgetList, 'h2', 'Budget & Routing');
      if (!policies.length) {
        text(budgetList, 'p', 'Budget- und Routingstatus nicht verfügbar; keine Kosten- oder Modellfähigkeit wird angenommen.', 'muted');
        return;
      }
      for (const item of policies) {
        const tokens = item.tokens;
        const article = document.createElement('article'); article.className = 'continuous-budget'; budgetList.append(article);
        text(article, 'h3', `Root ${item.rootGoalId || 'unbekannt'}`);
        if (!tokens) {
          text(article, 'p', 'Tokenbudget nicht verfügbar; keine Nutzung wird angenommen.', 'muted');
        } else {
          const allowance = tokens.allowance?.maxPerGoal;
          const limit = Number.isFinite(allowance) ? allowance : 'unbekannt';
          text(article, 'p', `Limit ${limit} · gemessen ${tokens.measuredTokens ?? 'unbekannt'} · reserviert ${tokens.reservedTokens ?? 'unbekannt'}`);
          const alarm = tokens.exceeded === true || tokens.exhausted === true;
          const flags = `${tokens.exceeded === true ? ' · Überschritten' : ''}${tokens.exhausted === true ? ' · erschöpft' : ''}`;
          text(article, 'p', `Verfügbar ${tokens.availableTokens ?? 'unbekannt'} · Umsetzung ${tokens.implementationAvailable ?? 'unbekannt'} · Prüfungsschutz ${tokens.verificationRemaining ?? 'unbekannt'} · Status ${USAGE_STATE_LABELS[tokens.usageState] || tokens.usageState || 'unbekannt'}${flags}`, alarm ? undefined : 'muted');
          if (tokens.unresolvedOperations > 0) text(article, 'p', `${tokens.unresolvedOperations} ${tokens.unresolvedOperations === 1 ? 'offener Vorgang' : 'offene Vorgänge'} ohne Beleg; die Reservierung bleibt vollständig bestehen.`, 'muted');
        }
      }
      const routingRegion = document.createElement('div');
      routingRegion.dataset.routing = '';
      budgetList.append(routingRegion);
      text(routingRegion, 'h3', 'Routing- & Kostenbelege');
      for (const item of policies) {
        const routing = item.policy?.routing;
        if (!routing) continue;
        const billing = Array.isArray(routing.billing) && routing.billing.length ? routing.billing.join(', ') : 'keine';
        text(routingRegion, 'p', `Root ${item.rootGoalId || 'unbekannt'} erlaubt: ${billing} · Quota-Reserve ${routing.quotaReservePercent ?? 'unbekannt'} % · Zusätzliche kostenpflichtige API: ${routing.additionalPaidApi ? 'ja' : 'nein'}`, 'muted');
      }
      const runs = Array.isArray(records?.runs) ? records.runs : null;
      if (!runs) {
        text(routingRegion, 'p', 'Run- und Kostenbelege nicht verfügbar; kein Modell oder Preis wird angenommen.', 'muted');
        return;
      }
      if (!runs.length) {
        text(routingRegion, 'p', 'Keine Routing-Belege vorhanden; kein Modell oder Preis wird angenommen.', 'muted');
        return;
      }
      for (const record of runs) {
        const runId = record.run?.id || 'unbekannt';
        text(routingRegion, 'p', `${runId}: ${routingSummary(record.launch)}`);
        const usage = record.usage;
        if (usage?.state === 'measured') {
          text(routingRegion, 'p', `${runId}: Kostenbeleg ${usage.tokens ?? 'unbekannt'} Token · ${usage.provenance?.collector || 'Collector unbekannt'} (${usage.provenance?.measurement || 'Messung unbekannt'})`, 'muted');
        } else if (usage) {
          // Only these states still hold the reservation (development_usage_receipt.rs);
          // not_reserved, cancelled and unclassified must not claim it remains.
          const retained = ['pending', 'rejected', 'not_reported'].includes(usage.state);
          text(routingRegion, 'p', `${runId}: kein Kostenbeleg (${usage.state || 'unbekannt'})${usage.reason ? ` — ${usage.reason}` : ''}${retained ? '; die Reservierung bleibt bestehen' : ''}`, 'muted');
        }
      }
    }
    function renderOwnership(goals, tasks) {
      ownership.replaceChildren();
      const closed = new Set(['closed', 'completed', 'done', 'cancelled']);
      const running = goals.filter(goal => !closed.has(String(goal.status || '').toLowerCase()));
      if (!running.length) { text(ownership, 'p', 'Keine laufenden Ziele.', 'muted'); return; }
      for (const goal of running) {
        const ownTasks = tasks.filter(task => task.goalId === goal.id);
        const owners = [...new Set(ownTasks.map(task => task.claim?.owner || task.assignment?.assignee).filter(Boolean))];
        const seats = [...new Set(ownTasks.map(task => task.assignment ? `${task.assignment.teamId}/${task.assignment.role}` : null).filter(Boolean))];
        const paths = [...new Set(ownTasks.flatMap(task => task.ownedPaths || []))];
        const line = document.createElement('p');
        line.className = 'continuous-ownership-line';
        line.textContent = `${goal.status || 'unbekannt'} · ${goal.objective} · ${ownTasks.length} Arbeitspakete`
          + ` · ${owners.length ? `Besetzt: ${owners.join(', ')}` : 'unbesetzt'}`
          + `${seats.length ? ` · ${seats.join(', ')}` : ''}`
          + `${paths.length ? ` · Bereiche: ${paths.join(', ')}` : ''}`;
        ownership.append(line);
      }
    }
    // The 5 s tick must not throw the operator out of the card: capture the
    // interactive state before a rebuild, hand it back afterwards. Focus is
    // separate on purpose: enable(false) blurs a focused button in real
    // browsers, so focus must be captured before the network wait starts.
    function captureFocus() {
      const active = document.activeElement;
      if (!active || !card.contains(active)) return null;
      const host = active.closest('details[data-task-id]');
      const part = active.name || (active.tagName === 'BUTTON' ? 'submit' : active.tagName.toLowerCase());
      return { taskId: host?.dataset.taskId || null, part, element: active };
    }
    function restoreFocus(savedFocus) {
      if (!savedFocus) return;
      // Only take focus back when the tick itself took it (blur to body);
      // if the operator moved focus somewhere else, leave it alone.
      const active = document.activeElement;
      if (active && active !== document.body) return;
      let target = null;
      if (savedFocus.taskId) {
        const host = list.querySelector(`details[data-task-id="${savedFocus.taskId}"]`);
        target = host?.querySelector(`[name="${savedFocus.part}"]`)
          || (savedFocus.part === 'summary' ? host?.querySelector('summary') : null)
          || (savedFocus.part === 'submit' ? host?.querySelector('button[type="submit"]') : null);
      }
      // Buttons outside the task list survive a rebuild; use the node itself.
      if (!target && savedFocus.element?.isConnected) target = savedFocus.element;
      target?.focus();
    }
    function captureListState() {
      const openTasks = new Set([...list.querySelectorAll('details[data-task-id][open]')].map(node => node.dataset.taskId));
      const drafts = new Map();
      for (const form of list.querySelectorAll('form.continuous-assignment')) {
        const draft = {};
        const assignee = form.elements.assignee;
        if (assignee && assignee.value !== assignee.defaultValue) draft.assignee = assignee.value;
        for (const name of ['teamId', 'role']) {
          const field = form.elements[name];
          if (field && [...field.options].some(option => option.selected !== option.defaultSelected)) draft[name] = field.value;
        }
        if (Object.keys(draft).length) drafts.set(form.dataset.taskId, draft);
      }
      return { openTasks, drafts };
    }
    function restoreListState(saved) {
      for (const node of list.querySelectorAll('details[data-task-id]')) {
        if (saved.openTasks.has(node.dataset.taskId)) node.open = true;
      }
      for (const form of list.querySelectorAll('form.continuous-assignment')) {
        const draft = saved.drafts.get(form.dataset.taskId);
        if (!draft) continue;
        for (const [name, value] of Object.entries(draft)) {
          const field = form.elements[name];
          if (!field) continue;
          field.value = value;
          // A restored team draft must refill the role list for that team;
          // setting .value alone fires no change event.
          if (name === 'teamId') field.dispatchEvent(new Event('change'));
        }
      }
    }
    async function refresh() {
      const current = project();
      const generation = ++sequence;
      const savedFocus = captureFocus();
      online = false; enable(false);
      if (current !== loadedProject) { list.replaceChildren(); select.replaceChildren(); ownership.replaceChildren(); budgetList.replaceChildren(); runsList.replaceChildren(); loadedProject = null; lastSignature = null; lastBudgetSignature = null; }
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
        const signature = JSON.stringify({ goals, tasks, teams, controlStatus: control.status || null });
        const rebuildGoals = signature !== lastSignature;
        const saved = rebuildGoals ? captureListState() : null;
        const previous = select.value;
        if (rebuildGoals) {
          select.replaceChildren();
          list.replaceChildren();
          renderOwnership(goals, tasks);
        }
        const policies = Array.isArray(effectiveLimits.rootPolicies) ? effectiveLimits.rootPolicies : [];
        // null (fetch failed) and [] (no runs) render differently, so they
        // must not collapse into the same signature.
        const runReceipts = Array.isArray(records?.runs) ? records.runs : null;
        const budgetSignature = JSON.stringify({
          policies,
          receipts: runReceipts?.map(record => ({
            id: record.run?.id, route: record.launch?.routeJson || null, usage: record.usage || null,
          })) ?? null,
        });
        if (budgetSignature !== lastBudgetSignature) {
          renderBudget(policies, records);
          lastBudgetSignature = budgetSignature;
        }
        runsList.replaceChildren();
        text(runsList, 'h2', 'Runs, Evidenz & Lieferung');
        if (rebuildGoals) for (const goal of goals) {
          const option = document.createElement('option'); option.value = goal.id; option.textContent = goal.objective; select.append(option);
          const section = document.createElement('article'); section.className = 'continuous-goal'; list.append(section);
          text(section, 'h3', goal.objective);
          text(section, 'p', `${goal.status} · ${goal.id}`, 'muted');
          text(section, 'p', goal.acceptanceCriteria || 'Keine Abnahmekriterien gespeichert.');
          const ownTasks = tasks.filter(task => task.goalId === goal.id);
          if (!ownTasks.length) text(section, 'p', 'Noch keine Arbeitspakete.', 'muted');
          for (const task of ownTasks) {
            const details = document.createElement('details'); section.append(details);
            details.dataset.taskId = task.id;
            text(details, 'summary', `${task.status} · ${task.objective}`);
            text(details, 'p', `ID ${task.id} · Profil ${task.profileId || 'nicht zugewiesen'} · Versuche ${task.attempts ?? 0}`);
            text(details, 'p', `Bereiche: ${(task.ownedPaths || []).join(', ') || 'keine'} · Abhängigkeiten: ${(task.dependencies || []).join(', ') || 'keine'}`);
            if (task.claim) text(details, 'p', `Besitzer ${task.claim.owner} · Fence ${task.claim.fence}`);
            if (task.assignment) text(details, 'p', `Team ${task.assignment.teamId} · Rolle ${task.assignment.role} · ${task.assignment.assignee} · Revision ${task.assignment.revision}`, 'muted');
            const assignmentForm = document.createElement('form');
            assignmentForm.className = 'continuous-assignment';
            assignmentForm.dataset.taskId = task.id;
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
            // Draft detection compares against the defaults, so the defaults
            // must be the server values, not the initial markup state.
            for (const option of teamSelect.options) option.defaultSelected = option.selected;
            const fillRoles = (syncDefaults = false) => {
              roleSelect.replaceChildren();
              const team = allowedTeams.find(item => item.id === teamSelect.value);
              for (const role of team?.roles || []) { const option = document.createElement('option'); option.value = role; option.textContent = role; roleSelect.append(option); }
              if (task.assignment?.role && [...roleSelect.options].some(option => option.value === task.assignment.role)) roleSelect.value = task.assignment.role;
              if (syncDefaults) for (const option of roleSelect.options) option.defaultSelected = option.selected;
            };
            teamSelect.addEventListener('change', () => fillRoles()); fillRoles(true);
            if (task.assignment?.assignee) assignee.value = assignee.defaultValue = task.assignment.assignee;
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
        if (rebuildGoals) {
          if ([...select.options].some(option => option.value === previous)) select.value = previous;
          if (!goals.length) text(list, 'p', 'Noch keine Ziele. Ein Ziel beschreibt Ergebnis und überprüfbare Abnahme.', 'muted');
          restoreListState(saved);
          lastSignature = signature;
        }
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
        restoreFocus(savedFocus);
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
      const savedFocus = captureFocus();
      busy = true; enable(false); error(null);
      try {
        await api(path, { method: 'POST', body: JSON.stringify(body) });
        if (current === project()) form?.reset();
      } catch (failure) { if (current === project()) error(failure); busy = false; enable(online && loadedProject === project()); restoreFocus(savedFocus); return; }
      busy = false; await refresh();
      restoreFocus(savedFocus);
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
