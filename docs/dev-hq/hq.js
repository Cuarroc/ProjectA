/**
 * ProjectA Dev HQ pages (Tasks 7–9). Missing HQ_DATA → UNPROVEN well.
 */
(function () {
  const mount = document.getElementById("mount");
  if (!mount) return;

  if (typeof window.HQ_DATA === "undefined" || window.HQ_DATA === null) {
    mount.innerHTML =
      '<div class="unproven" role="status">UNPROVEN — Run <code>npm run hq</code>.</div>';
    return;
  }

  function currentPage() {
    const path = (location.pathname || "").replace(/\\/g, "/");
    const base = path.split("/").pop() || "index.html";
    if (!base || base === "index.html") return "now";
    return base.replace(/\.html$/i, "");
  }

  const page = currentPage();

  function escape(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // escape() protects the markup, not the scheme: only http(s) urls may
  // become links, everything else (javascript:, data:, file:, …) renders
  // as plain text without an href.
  function safeUrl(u) {
    const url = String(u || "").trim();
    return /^https?:\/\//i.test(url) ? url : "";
  }

  function basename(path) {
    const parts = String(path).replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || String(path);
  }

  function countWhere(items, predicate) {
    return (items || []).filter(predicate).length;
  }

  function summary(data) {
    const specs = data.specs || [];
    const packages = data.packages || [];
    const findings = data.findings || [];
    return {
      specs: specs.length,
      ready: countWhere(specs, (s) => s.startable !== false),
      locked: countWhere(specs, (s) => s.startable === false),
      active: countWhere(packages, (p) => p.current === "active"),
      facts: countWhere(findings, (f) => f.klass === "FACT"),
      claims: countWhere(findings, (f) => f.klass === "CLAIM"),
      warnings: (data.warnings || []).length,
    };
  }

  function summaryStrip(data) {
    const s = summary(data);
    const items = [
      ["active packages", s.active, "moving now"],
      ["ready specs", s.ready, "can proceed"],
      ["locked specs", s.locked, "serial constraint"],
      ["cited facts", s.facts, "evidence-backed"],
    ];
    return `<div class="summary-strip" aria-label="HQ summary">
      ${items.map(([label, value, note]) => `<div class="summary-item">
        <strong>${value}</strong><span>${label}</span><small>${note}</small>
      </div>`).join("")}
    </div>`;
  }

  function sectionTitle(title, detail) {
    return `<div class="section-title"><h2>${title}</h2><p>${detail}</p></div>`;
  }

  function startableMap(data) {
    const map = new Map();
    for (const n of data.next || []) {
      if (n.doneWhen) map.set(n.doneWhen, n.startable === true);
    }
    return map;
  }

  // The spec row is the authority (it already encodes STAND order and the
  // package DAG). A next[] row for the same file may only confirm it — a
  // stale or looser next[] value must never unlock a locked serial holder
  // (review r4 M14).
  function isStartable(spec, map) {
    if (typeof spec.startable === "boolean") return spec.startable;
    if (map.has(spec.file)) return map.get(spec.file);
    return true;
  }

  // A SERIAL lock is the hand-over between two holders of the *same* seam
  // file: the earlier one is startable, the later one waits for it. Two
  // adjacent specs on different seams (api.rs → main.rs) share nothing and
  // must not be drawn as a lock labeled with the wrong owner (review r4 M12).
  function serialLockBetween(prev, cur, map) {
    return Boolean(
      prev.serialOwner &&
        prev.serialOwner === cur.serialOwner &&
        isStartable(prev, map) &&
        !isStartable(cur, map),
    );
  }

  // "task_f4_merge_candidate.md" → "f4_merge_candidate": the lane boxes are
  // 168px wide and the prefix/suffix carry no information there.
  function laneLabel(file) {
    return basename(file).replace(/^task_/, "").replace(/\.md$/, "");
  }

  function specTable(specs) {
    const rows = specs
      .map(
        (s) => `<tr>
      <td class="path">${escape(s.file)}</td>
      <td>${escape(s.packet)}</td>
      <td>${escape(s.lane)}</td>
      <td>${escape(s.serialOwner || "—")}</td>
      <td><span class="readiness ${s.startable === false ? "locked" : "ready"}">${s.startable === false ? "LOCKED" : "READY"}</span></td>
      <td class="cite">${escape(s.source)}</td>
    </tr>`,
      )
      .join("");
    return `<div class="table-wrap"><table class="spec-table">
      <thead><tr>
        <th scope="col">file</th>
        <th scope="col">packet</th>
        <th scope="col">lane</th>
        <th scope="col">owner</th>
        <th scope="col">state</th>
        <th scope="col">cite</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  function renderChrome(data) {
    const titles = {
      live: ["Live", "Operate the fleet from the same desk your agents use."],
      now: ["Now", "The operator desk for cited development truth."],
      proof: ["Proof", "Separate what is proven from what is only claimed."],
      map: ["Map", "See the package dependencies before choosing a lane."],
      next: ["Next", "Read the ordered work without guessing at the lock."],
      sources: ["Sources", "Audit every generated claim back to its source."],
      lessons: ["Lessons", "What broke before, why, and the fix that worked — the memory every agent reads first."],
    };
    const [title, description] = titles[page] || titles.now;
    const bar = document.querySelector(".hq-bar");
    if (!bar) return;
    bar.innerHTML = `
      <div class="hq-brand">
        <span class="hq-mark" aria-hidden="true">HQ</span>
        <div>
          <p class="hq-kicker">PROJECTA / DEVELOPMENT HQ</p>
          <h1>${title}</h1>
          <p class="hq-description">${description}</p>
        </div>
      </div>
      <div class="hq-snapshot" aria-label="HQ snapshot status">
        <span class="snapshot-dot ${data.dirty ? "dirty" : ""}" aria-hidden="true"></span>
        <span>${data.dirty ? "snapshot from dirty worktree" : "clean snapshot"}</span>
        <span class="snapshot-commit">${escape(data.commit || "no git")}</span>
      </div>
    `;
    const nav = document.querySelector(".hq-nav");
    if (nav && !nav.querySelector('a[href="./live.html"]')) {
      nav.insertAdjacentHTML("afterbegin", '<a href="./live.html">Live</a>');
    }
  }

  function hqSessionToken() {
    return document.querySelector('meta[name="hq-session"]')?.content || "";
  }

  function liveApi(path, options = {}) {
    const headers = {
      "content-type": "application/json",
      "x-hq-session": hqSessionToken(),
      ...(options.headers || {}),
    };
    return fetch(`/__hq${path}`, { ...options, headers })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(body.error || `Control API returned ${response.status}`);
          error.status = response.status;
          throw error;
        }
        return body;
      });
  }

  function shortTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "2-digit" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // Highlight query tokens inside escaped text (mirrors hq-lessons.mjs).
  function highlight(text, query) {
    const escaped = escape(text);
    const terms = String(query || "").toLowerCase().split(/[^a-z0-9äöüß_./:-]+/i).map((t) => t.replace(/^[./:-]+|[./:-]+$/g, "")).filter((t) => t.length > 1);
    if (!terms.length) return escaped;
    const pattern = new RegExp(`(^|[^a-z0-9äöüß_./:-])((?:[a-z0-9äöüß_./:-]*)(?:${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:[a-z0-9äöüß_./:-]*))`, "gi");
    return escaped.replace(pattern, (_m, lead, word) => `${lead}<mark>${word}</mark>`);
  }

  // One lesson card, shared by the Live card and the static Lessons page.
  // `live` adds the feedback/refine/related controls that need the proxy.
  function lessonCard(l, { query = "", live = false } = {}) {
    const b = l.badges || { label: "new", confidence: null };
    const conf = b.confidence === null || b.confidence === undefined ? "" : `<span class="lesson-conf" title="${b.votes || 0} feedback votes"><i style="width:${b.confidence}%"></i><b>${b.confidence}% worked</b></span>`;
    const history = (l.history || []).length
      ? `<details class="lesson-history"><summary>${l.history.length} earlier fix${l.history.length === 1 ? "" : "es"}</summary>${l.history.map((h) => `<p><em>${escape(String(h.at).slice(0, 10))}</em><span><code>${escape(h.fix)}</code>${h.note ? ` — ${escape(h.note)}` : ""}</span></p>`).join("")}</details>`
      : "";
    const controls = live
      ? `<span class="lesson-actions">
          <button class="hq-button subtle" type="button" data-live-action="lessonHit:${escape(l.id)}" title="The symptom showed up again">Seen again</button>
          <button class="hq-button subtle good" type="button" data-live-action="lessonWorked:${escape(l.id)}" title="I applied the fix and it helped">Fix worked</button>
          <button class="hq-button subtle bad" type="button" data-live-action="lessonFailed:${escape(l.id)}" title="I applied the fix and it did not help">Didn't help</button>
          <button class="hq-button subtle" type="button" data-live-action="lessonRefine:${escape(l.id)}">Refine fix</button>
          <button class="hq-button subtle" type="button" data-live-action="lessonRelated:${escape(l.id)}">Related</button>
          <button class="hq-button subtle" type="button" data-live-action="lessonCopy:${escape(l.id)}" title="Copy as markdown for a prompt">Copy</button>
        </span>`
      : "";
    return `<article class="lesson-row badge-${escape(b.label)}" data-lesson-id="${escape(l.id)}">
      <div class="lesson-head"><strong>${highlight(l.symptom, query)}</strong><span class="lesson-meta"><span class="lesson-badge ${escape(b.label)}">${escape(b.label)}</span>${conf} seen ${l.hits || 1}× · ${escape(String(l.lastSeen || "").slice(0, 10))}${l.source ? ` · ${escape(l.source)}` : ""} · <code class="lesson-id">${escape(l.id)}</code></span></div>
      <p><em>cause</em><span>${highlight(l.cause, query)}</span></p>
      <p><em>fix</em><code>${highlight(l.fix, query)}</code></p>
      ${history}
      <div class="lesson-foot"><span class="lesson-taglist">${(l.tags || []).map((t) => `<span>${escape(t)}</span>`).join("")}</span>${controls}</div>
      <div class="lesson-extra" hidden></div>
    </article>`;
  }

  function lessonMarkdown(l) {
    return `### ${l.id}\n- **Symptom:** ${l.symptom}\n- **Cause:** ${l.cause}\n- **Fix:** ${l.fix}${l.source ? `\n- **Source:** ${l.source}` : ""}\n`;
  }

  function liveCard(title, body, className = "") {
    return `<section class="live-card ${className}" lang="en"><div class="live-card-head"><h2>${title}</h2></div>${body}</section>`;
  }

  function liveButton(label, action, className = "") {
    return `<button class="hq-button ${className}" data-live-action="${escape(action)}">${escape(label)}</button>`;
  }

  function renderLive(_snapshot, el) {
    const section = (num, title, lede, body, id = "", extra = "") => `
      <section class="desk-section${extra ? ` ${extra}` : ""}"${id ? ` id="${id}"` : ""} lang="en">
        <header class="desk-head"><span class="desk-num">${num}</span><div><h2>${title}</h2>${lede ? `<p>${lede}</p>` : ""}</div></header>
        ${body}
      </section>`;
    el.innerHTML = `
      <div class="live-toolbar masthead" lang="en">
        <div><p class="meta">LOCAL CONTROL API · same-origin proxy · secrets stay server-side</p><p id="live-status" class="live-status pending" role="status">connecting…</p></div>
        <div class="masthead-tools">
          <label class="live-project">Project <select id="live-project"><option value="">all projects</option></select></label>
          <button class="hq-button subtle" id="live-refresh" title="Refresh (r)">Refresh</button>
          <button class="hq-button subtle" id="live-keys" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">?</button>
        </div>
      </div>
      <div id="live-error" class="live-error" role="alert" hidden></div>
      <div id="live-keys-help" class="keys-help" lang="en" hidden><b>Keys</b> <kbd>/</kbd> search memory · <kbd>f</kbd> filter fleet · <kbd>g</kbd> goals &amp; teams · <kbd>b</kbd> budget &amp; routing · <kbd>r</kbd> refresh · <kbd>?</kbd> this help · <kbd>Esc</kbd> close panels <label class="keys-toggle"><input type="checkbox" id="live-keys-enabled"> single-key shortcuts on</label></div>

      ${section("01", "What matters now", "Ranked from the live fleet, capacity, questions, the lesson memory and the repository.", '<ol id="live-signals" class="signals" tabindex="0" aria-label="What matters now"><li class="muted">Reading the desk…</li></ol>', "live-signals-section", "paper")}

      ${section("02", "Insights", "Whole-project consumption, pace and health — measured, with the basis of every estimate spelled out.", `
        <div id="live-effort" class="effort"><p class="muted">Estimating…</p></div>
        <div id="live-stats" class="live-stats"><p class="muted">Measuring repository statistics…</p></div>
        <div id="live-analysis" class="live-analysis"><p class="muted">Calculating project telemetry…</p></div>
      `)}

      ${section("03", "Desk", "", `
        <div class="desk-grid">
          <div class="desk-main">
            ${liveCard("Fleet", '<input id="live-fleet-filter" class="fleet-filter" placeholder="filter workers… (f)" aria-label="Filter workers"><div id="live-board" class="live-list"><p class="muted">Loading workers…</p></div>')}
            ${liveCard("Queue", '<div id="live-queue" class="live-list"><p class="muted">Loading queue…</p></div>')}
            ${liveCard("Review", '<div id="live-review" class="live-list"><p class="muted">Loading verdicts…</p></div>')}
            ${liveCard("Recommendations", '<div id="live-recommendations" class="live-list"><p class="muted">Loading recommendations…</p></div>')}
          </div>
          <aside class="desk-rail">
            ${liveCard("Attention", '<div id="live-questions" class="live-list"><p class="muted">Loading questions…</p></div>')}
            ${liveCard("Capacity", '<div id="live-capacity" class="live-list"><p class="muted">Loading quota…</p></div>')}
            ${liveCard("Providers", '<div id="live-providers" class="live-list"><p class="muted">Loading providers…</p></div>')}
            ${liveCard("Usage", '<div id="live-usage" class="live-list"><p class="muted">Loading usage…</p></div>')}
            ${liveCard("Activity", '<div id="live-activity" class="live-list"><p class="muted">Loading activity…</p></div>')}
          </aside>
        </div>
      `)}

      ${section("04", "Agents", "Profiles the dispatcher can spawn. Custom ones live in <code>agents.json</code> beside the executable.", `
        ${liveCard("Agent teams", '<div id="live-teams" class="live-list"><p class="muted">Loading profiles…</p></div><button class="hq-button subtle" id="live-new-team" type="button">New agent profile</button>')}
      `)}

      ${section("05", "Memory", "What broke before, why, and the fix that worked. Search before you debug; report back after you fix. Shell: <code>npm run hq:lesson -- search \"&lt;error&gt;\"</code>.", `
        ${liveCard("Lessons — known errors", `
          <div class="lesson-toolbar">
            <div class="lesson-search-row">
              <input id="lesson-query" class="fleet-filter" placeholder="search symptom, cause, fix or tag… (/)" aria-label="Search lessons">
              <select id="lesson-sort" aria-label="Sort lessons"><option value="relevance">relevance</option><option value="hits">most seen</option><option value="recent">most recent</option><option value="confidence">best confidence</option></select>
              <button class="hq-button subtle" id="lesson-brief" type="button" title="Copy the matching lessons as a markdown brief for a worker prompt">Copy brief</button>
            </div>
            <div id="lesson-tags" class="lesson-tags" aria-label="Lesson tags"></div>
            <p id="lesson-summary" class="muted"></p>
          </div>
          <div id="live-lessons" class="live-list"><p class="muted">Loading lessons…</p></div>
          <details class="lesson-add"><summary>Add a lesson</summary>
            <div class="team-form">
              <label>Symptom <input id="lesson-symptom" placeholder="the error text or what you saw"></label>
              <label>Cause <input id="lesson-cause" placeholder="why it happened"></label>
              <label>Fix <input id="lesson-fix" placeholder="the command or change that worked"></label>
              <label>Tags <input id="lesson-tag-input" placeholder="cargo, linux (comma separated)"></label>
              <label>Source <input id="lesson-source" placeholder="report, file or PR (optional)"></label>
            </div>
            <div class="live-action-row">
              <button class="hq-button" id="lesson-save" type="button">Save lesson</button>
              <span id="lesson-status" class="muted" role="status"></span>
            </div>
          </details>`)}
      `)}

      ${section("06", "Machine", "", '<section id="live-setup" class="live-setup"><p class="muted">Checking this machine…</p></section>')}
      <section class="live-actions worker-detail" id="worker-detail" lang="en" hidden>
        <div class="detail-head"><h2 id="detail-title">Worker</h2><button class="hq-button subtle" id="detail-close" type="button">Close</button></div>
        <div id="detail-facts" class="detail-facts"></div>
        <div id="detail-messages" class="detail-messages"></div>
        <div class="live-action-row">
          <input id="detail-message" placeholder="reply to this agent" aria-label="Reply to agent">
          <button class="hq-button" data-live-action="detailSend" type="button">Send</button>
          <span id="detail-status" class="muted" role="status"></span>
        </div>
      </section>
      <section class="live-actions team-editor" id="team-editor" hidden>
        <h2 id="team-editor-title">New agent profile</h2>
        <p class="brief-copy">Saved to <code>agents.json</code> next to the running ProjectA executable. It takes effect on the next dispatcher sweep — no restart needed. Use a <code>&lt;base&gt;-&lt;suffix&gt;</code> id like <code>claude-review</code> to inherit that agent's capabilities.</p>
        <div class="team-form">
          <label>Team <input id="team-team" placeholder="e.g. Review crew"></label>
          <label>Auftrag <input id="team-purpose" maxlength="2000" placeholder="Was soll dieses Team erreichen?"></label>
          <label>Rolle <input id="team-role" maxlength="2000" placeholder="z. B. unabhängige Gegenprüfung"></label>
          <label>Effort im Briefing <select id="team-effort"><option value="">Nicht festgelegt</option><option>Normal</option><option>Hoch</option><option>Maximum</option></select></label>
          <label>Werkzeuge / Prüfmittel <input id="team-tools" maxlength="2000" placeholder="z. B. Diff, Tests, Browser"></label>
          <label>Id <input id="team-id" placeholder="claude-review" pattern="[a-z0-9][a-z0-9-]*"></label>
          <label>Name <input id="team-name" placeholder="Claude Reviewer"></label>
          <label>Command <input id="team-command" placeholder="claude"></label>
          <label>Args <input id="team-args" placeholder="--model, opus (comma separated)"></label>
          <label>Environment <textarea id="team-env" rows="3" placeholder="ANTHROPIC_BASE_URL=http://127.0.0.1:20128"></textarea></label>
          <label>Fallback <select id="team-fallback"><option value="">none — stop at quota/budget blocks</option></select></label>
        </div>
        <p class="muted">Das Briefing dokumentiert Auftrag und Rolle. Modell und tatsächliches Effort werden über die CLI-Argumente festgelegt; Werkzeuge und Skills benötigen die Unterstützung des gewählten Providers.</p>
        <div class="live-action-row">
          <button class="hq-button" id="team-save" type="button">Save profile</button>
          <button class="hq-button subtle" id="team-cancel" type="button">Cancel</button>
          <span id="team-editor-status" class="muted" role="status"></span>
        </div>
      </section>
      <section class="live-actions" id="live-controls" lang="en">
        <header class="desk-head"><span class="desk-num">07</span><div><h2>Controls</h2></div></header>
        <p class="brief-copy">Messages and queue entries act immediately. Merge and verdict actions require the one-time verdict token from the ProjectA window.</p>
        <div class="live-action-row">
          <label class="control-field">Worker id <input id="live-worker-id" placeholder="worker id"></label>
          <label class="control-field">Message <input id="live-message" placeholder="message for an agent"></label>
          ${liveButton("Send", "send")}
        </div>
        <div class="live-action-row">
          <label class="control-field">Task to queue <input id="live-queue-text" placeholder="task to queue"></label>
          <label class="control-field">Agent profile <select id="live-queue-profile"><option value="">dispatcher chooses agent</option></select></label>
          ${liveButton("Queue task", "queue")}
        </div>
        <div class="live-action-row">
          <label class="control-field">Spawn task <input id="live-spawn-task" placeholder="spawn a worker on this task now"></label>
          <label class="control-field">Spawn profile <select id="live-spawn-profile"><option value="">default agent (claude)</option></select></label>
          ${liveButton("Spawn worker", "spawn")}
          <span id="live-spawn-status" class="muted" role="status"></span>
        </div>
        <details class="verdict-details"><summary>Unlock human verdict actions</summary>
          <label>Verdict token <input id="live-verdict-token" type="password" autocomplete="off" placeholder="paste from ProjectA"></label>
          <p class="muted">The token is held only in this tab and forwarded only to the local proxy.</p>
        </details>
      </section>
    `;

    // Scrolling lists are only reachable by keyboard when they can take
    // focus; the card title doubles as their accessible name (HQ-6).
    el.querySelectorAll(".live-card").forEach((card) => {
      const list = card.querySelector(".live-list");
      const title = card.querySelector("h2");
      if (!list || !title) return;
      list.setAttribute("tabindex", "0");
      list.setAttribute("role", "group");
      list.setAttribute("aria-label", title.textContent.trim());
    });
    const workspace = window.createHQWorkspace(el, _snapshot);
    const projectSelect = el.querySelector("#live-project");
    const selectedProject = () => projectSelect.value;
    const continuous = window.createHQContinuous?.({ container: el.querySelector('#panel-teams'), api: liveApi, project: selectedProject });
    const query = (path) => `${path}${path.includes("?") ? "&" : "?"}${selectedProject() ? `projectId=${encodeURIComponent(selectedProject())}` : ""}`;
    const setStatus = (text, state) => {
      const status = el.querySelector("#live-status");
      status.textContent = text;
      status.className = `live-status ${state}`;
    };
    const showError = (error) => {
      const box = el.querySelector("#live-error");
      box.hidden = false;
      const message = `${error.message}${error.status ? ` (${error.status})` : ""}`;
      if (error.status === 503 && message.includes('ProjectA Control API is not running')) {
        box.innerHTML = '<strong>Control-API nicht erreichbar.</strong> Lokale Teams und Repository-Statistiken bleiben verfügbar.<details><summary>Verbindungsdetails</summary><p></p></details>';
        box.querySelector('p').textContent = message;
      } else box.textContent = message;
      setStatus("offline or blocked", "error");
    };
    // Replace a list's markup without dropping the keyboard user: the row
    // that had focus is found again by its action and refocused (HQ-3).
    const paint = (host, html) => {
      const active = document.activeElement;
      // Typing inside the list (the refine editor, a lesson input): leave it
      // alone this tick; the next refresh will catch up.
      if (host.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active?.tagName || "")) return;
      const marker = host.contains(active) ? active.closest("[data-live-action]")?.dataset.liveAction : undefined;
      host.innerHTML = html;
      if (marker === undefined) return;
      host.querySelector(`[data-live-action="${marker.replace(/["\\]/g, "\\$&")}"]`)?.focus();
    };
    const renderItems = (id, items, render, empty) => {
      paint(el.querySelector(id), items.length ? items.map(render).join("") : `<p class="muted">${empty}</p>`);
    };
    async function refreshAnalysis() {
      const analysis = await liveApi("/analysis");
      const metric = (value, label, note = "") => `<div class="analysis-metric"><strong>${escape(value)}</strong><span>${escape(label)}</span>${note ? `<small>${escape(note)}</small>` : ""}</div>`;
      el.querySelector("#live-analysis").innerHTML = `
        <div class="analysis-head"><div><p class="eyebrow">COMMAND CENTER / TELEMETRY</p><h2>Project health at a glance</h2><p class="muted">Measured from tracked files, git history, generated specs and the current Control API.</p></div><time>${escape(new Date(analysis.generatedAt).toLocaleTimeString())}</time></div>
        <div class="analysis-metrics">
          ${metric(analysis.lines.code.toLocaleString(), "lines of code", `${analysis.files.code} source files`)}
          ${metric(analysis.lines.source.toLocaleString(), "source lines", `${analysis.files.source} tracked source assets`)}
          ${metric(`${analysis.progress.percent}%`, "package progress", `${analysis.progress.packagesDone}/${analysis.progress.packagesTotal} packages complete`)}
          ${metric(analysis.estimate.label, "estimated remaining", `${analysis.estimate.hours}h · heuristic`)}
          ${metric(analysis.commitsLast30Days, "commits / 30 days", "repository throughput")}
        </div>
        <div class="analysis-progress"><span style="width:${Math.min(100, Math.max(0, analysis.progress.percent))}%"></span></div>
        <p class="analysis-basis">${escape(analysis.estimate.basis)}</p>
      `;
    }
    const profileSelect = el.querySelector("#live-queue-profile");
    let knownProfiles = [];

    function renderTeams(data) {
      knownProfiles = data.profiles || [];
      const teams = new Map();
      for (const profile of knownProfiles) {
        const team = profile.team || "Custom";
        if (!teams.has(team)) teams.set(team, []);
        teams.get(team).push(profile);
      }
      const selected = profileSelect.value;
      profileSelect.innerHTML = '<option value="">dispatcher chooses agent</option>' +
        knownProfiles.map((p) => `<option value="${escape(p.id)}">${escape(p.name)} (${escape(p.id)})</option>`).join("");
      if (selected && knownProfiles.some((p) => p.id === selected)) profileSelect.value = selected;
      const fallbackSelect = el.querySelector("#team-fallback");
      const fallbackValue = fallbackSelect.value;
      fallbackSelect.innerHTML = '<option value="">none — stop at quota/budget blocks</option>' +
        knownProfiles.map((p) => `<option value="${escape(p.id)}">${escape(p.id)}</option>`).join("");
      if (fallbackValue && knownProfiles.some((p) => p.id === fallbackValue)) fallbackSelect.value = fallbackValue;
      const spawnSelect = el.querySelector("#live-spawn-profile");
      const spawnValue = spawnSelect.value;
      spawnSelect.innerHTML = '<option value="">default agent (claude)</option>' +
        knownProfiles.map((p) => `<option value="${escape(p.id)}">${escape(p.name)} (${escape(p.id)})</option>`).join("");
      if (spawnValue && knownProfiles.some((p) => p.id === spawnValue)) spawnSelect.value = spawnValue;
      const groups = [...teams.entries()].map(([team, profiles]) => `
        <div class="team-group">
          <h3>${escape(team)}</h3>
          ${profiles.map((p) => `<article class="live-row">
            <div>
              <strong>${escape(p.name)}</strong>
              <span>${escape(p.id)} · ${escape(p.command)}${(p.args || []).length ? ` ${escape(p.args.join(" "))}` : ""}${p.fallback ? ` → ${escape(p.fallback)}` : ""}${p.builtin ? "" : " · custom"}</span>
              ${p.briefing ? `<p class="team-briefing"><strong>${escape(p.briefing.role || "Rolle offen")}</strong> ${escape(p.briefing.purpose || "Auftrag offen")}<br>Effort: ${escape(p.briefing.effort || "nicht festgelegt")} · Prüfmittel: ${escape(p.briefing.tools || "nicht festgelegt")}</p>` : ""}
            </div>
            <span>
              <button class="hq-button" data-live-action="assign:${escape(p.id)}">Queue task</button>
              ${p.builtin ? "" : `<button class="hq-button subtle" data-live-action="editTeam:${escape(p.id)}">Edit</button>`}
            </span>
          </article>`).join("")}
        </div>`).join("");
      el.querySelector("#live-teams").innerHTML = groups || '<p class="muted">No profiles found.</p>';
      el.querySelector("#live-teams").insertAdjacentHTML("beforeend",
        `<p class="muted team-note">Overrides live in <code>${escape(data.agentsFile || "agents.json")}</code>. ${escape(data.note || "")}</p>`);
      workspace.teamsChanged();
    }

    function openTeamEditor(profile) {
      const editor = el.querySelector("#team-editor");
      editor.hidden = false;
      el.querySelector("#team-editor-title").textContent = profile ? `Edit ${profile.id}` : "New agent profile";
      el.querySelector("#team-id").value = profile?.id || "";
      el.querySelector("#team-id").disabled = Boolean(profile);
      el.querySelector("#team-team").value = profile ? (profile.team !== "Built-in agents" ? profile.team || "" : "") : workspace.selectedTeam();
      el.querySelector("#team-name").value = profile?.name || "";
      el.querySelector("#team-command").value = profile?.command || "";
      el.querySelector("#team-args").value = (profile?.args || []).join(", ");
      el.querySelector("#team-env").value = Object.entries(profile?.env || {}).map(([k, v]) => `${k}=${v}`).join("\n");
      el.querySelector("#team-fallback").value = profile?.fallback || "";
      el.querySelector("#team-editor-status").textContent = "";
      for (const key of ["purpose", "role", "effort", "tools"]) el.querySelector(`#team-${key}`).value = profile?.briefing?.[key] || "";
      workspace.reveal(editor);
      el.querySelector("#team-name").focus();
    }

    el.querySelector("#live-new-team").addEventListener("click", () => openTeamEditor(null));
    el.querySelector("#team-cancel").addEventListener("click", () => {
      el.querySelector("#team-editor").hidden = true;
    });
    el.querySelector("#team-save").addEventListener("click", async () => {
      const status = el.querySelector("#team-editor-status");
      const env = {};
      for (const line of el.querySelector("#team-env").value.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) { status.textContent = `env line needs KEY=value: ${trimmed}`; return; }
        env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
      }
      const profile = {
        id: el.querySelector("#team-id").value.trim(),
        name: el.querySelector("#team-name").value.trim(),
        command: el.querySelector("#team-command").value.trim(),
        args: el.querySelector("#team-args").value.split(",").map((a) => a.trim()).filter(Boolean),
        env,
        fallback: el.querySelector("#team-fallback").value || null,
        team: el.querySelector("#team-team").value.trim() || undefined,
        briefing: Object.fromEntries(["purpose", "role", "effort", "tools"].map(key => [key, el.querySelector(`#team-${key}`).value.trim()])),
      };
      try {
        const response = await fetch("/__hq/profiles", { method: "POST", headers: { "content-type": "application/json", "x-hq-session": hqSessionToken() }, body: JSON.stringify(profile) });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `Save failed (${response.status})`);
        status.textContent = `Saved — effective on the next dispatcher sweep.`;
        await refresh();
      } catch (error) {
        status.textContent = error.message;
      }
    });

    // /api/board answers WorkerBoardState: {worker, column, attentionReason, …}.
    function boardRow(entry) {
      const w = entry.worker || entry;
      const facts = [];
      if (entry.testStatus) facts.push(`tests: ${entry.testStatus}`);
      if (entry.contextUsage) facts.push(`ctx ${Math.round((entry.contextUsage.used / entry.contextUsage.total) * 100)}%`);
      if (entry.attentionReason) facts.push(entry.attentionReason);
      const detail = facts.length ? ` · ${facts.join(" · ")}` : "";
      const signals = [];
      if (entry.attentionReason) signals.push(String(entry.attentionReason));
      if (entry.testStatus && /fail|error|red/i.test(String(entry.testStatus))) signals.push(`tests ${entry.testStatus}`);
      if (w.lastError) signals.push(String(w.lastError));
      return `<article class="live-row fleet-row" data-live-action="detail:${escape(w.id)}" data-signal="${escape(signals.join("\u0001"))}" tabindex="0" role="button">
        <div><strong>${escape(w.task || w.id)}</strong><span>${escape(w.id)} · ${escape(w.profileId || "?")} · ${escape(w.status || "unknown")}${escape(detail)}</span></div>
        <span class="live-badge ${escape(entry.column || w.status || "unknown")}">${escape(entry.column || w.status || "unknown")}</span>
        ${entry.column === "ready_to_merge" ? liveButton("Merge", `merge:${w.id}`) : ""}
      </article>`;
    }

    let fleetCache = [];
    function applyFleetFilter() {
      const needle = (el.querySelector("#live-fleet-filter").value || "").toLowerCase();
      const visible = needle
        ? fleetCache.filter((e) => {
            const w = e.worker || e;
            return `${w.id} ${w.task} ${w.profileId}`.toLowerCase().includes(needle);
          })
        : fleetCache;
      renderItems("#live-board", visible, boardRow, needle ? "No worker matches the filter." : "No workers in this scope.");
      if (needle) annotateFleet(visible);
    }

    let detailWorkerId = null;
    async function openWorkerDetail(workerId) {
      detailWorkerId = workerId;
      const panel = el.querySelector("#worker-detail");
      panel.hidden = false;
      el.querySelector("#detail-title").textContent = workerId;
      el.querySelector("#detail-facts").innerHTML = '<p class="muted">Loading…</p>';
      el.querySelector("#detail-messages").innerHTML = "";
      workspace.reveal(panel);
      try {
        const [state, messages] = await Promise.all([
          liveApi(`/api/workers/${encodeURIComponent(workerId)}`),
          liveApi(`/api/workers/${encodeURIComponent(workerId)}/messages?limit=50`),
        ]);
        if (detailWorkerId !== workerId) return;
        const w = state.worker || {};
        el.querySelector("#detail-title").textContent = w.task || workerId;
        const pct = state.contextUsage ? Math.round((state.contextUsage.used / state.contextUsage.total) * 100) : null;
        el.querySelector("#detail-facts").innerHTML = [
          ["id", w.id], ["profile", w.profileId], ["branch", w.branch],
          ["column", state.column], ["tests", state.testStatus],
          ["attention", state.attentionReason],
          ["context", pct === null ? null : `${pct}% of window`],
          ["pr", state.prUrl],
        ].filter(([, v]) => v).map(([k, v]) => `<div class="detail-fact"><span>${escape(k)}</span><strong>${escape(v)}</strong></div>`).join("");
        el.querySelector("#detail-messages").innerHTML = (messages || [])
          .map((m) => `<p class="detail-msg ${escape(m.role)}"><span>${escape(m.role)}</span>${escape(m.content)}</p>`)
          .join("") || '<p class="muted">No recorded messages yet.</p>';
      } catch (error) {
        el.querySelector("#detail-facts").innerHTML = `<p class="live-error">${escape(error.message)}</p>`;
      }
    }

    el.querySelector("#live-fleet-filter").addEventListener("input", applyFleetFilter);
    el.querySelector("#detail-close").addEventListener("click", () => {
      detailWorkerId = null;
      el.querySelector("#worker-detail").hidden = true;
    });

    function renderCapacity(quota, budgets) {
      const budgetByProfile = new Map((budgets || []).map((b) => [b.profileId, b]));
      const rows = (quota || []).map((q) => {
        const budget = budgetByProfile.get(q.profileId);
        const budgetText = budget
          ? ` · limits ${budget.fiveHourPct ?? "—"}%/5h ${budget.sevenDayPct ?? "—"}%/7d`
          : "";
        const until = q.blockedUntil ? ` until ${new Date(q.blockedUntil * 1000).toLocaleTimeString()}` : "";
        return `<article class="live-row"><div><strong>${escape(q.profileId)}</strong><span>${escape(q.reason || "")}${escape(until)}${escape(budgetText)}</span></div><span class="live-badge ${q.state === "ok" ? "done" : q.state === "blocked" ? "needs_you" : "in_review"}">${escape(q.state)}</span></article>`;
      }).join("");
      const online = (quota || [])[0]?.omniRouteOnline;
      el.querySelector("#live-capacity").innerHTML =
        (rows || '<p class="muted">No quota tracked yet.</p>') +
        (online !== undefined ? `<p class="muted team-note">OmniRoute router: ${online ? "online" : "offline"}</p>` : "");
    }

    function renderUsage(report) {
      if (!report || !report.today) {
        el.querySelector("#live-usage").innerHTML = '<p class="muted">No usage report.</p>';
        return;
      }
      const fmt = (n) => Number(n || 0).toLocaleString();
      el.querySelector("#live-usage").innerHTML = `
        <div class="usage-grid">
          <div class="detail-fact"><span>today</span><strong>${fmt(report.today.tokensIn + report.today.tokensOut)} tokens</strong></div>
          <div class="detail-fact"><span>requests today</span><strong>${fmt(report.today.requests)}</strong></div>
          <div class="detail-fact"><span>all time</span><strong>${fmt(report.total.tokensIn + report.total.tokensOut)} tokens</strong></div>
          <div class="detail-fact"><span>reported cost</span><strong>${report.reportedCostUsd === null || report.reportedCostUsd === undefined ? "n/a" : `$${Number(report.reportedCostUsd).toFixed(2)}`}</strong></div>
        </div>
        <p class="muted team-note">router ${report.online ? "online" : "offline"} · ledger ${report.authorized ? "authorized" : "frozen"}</p>`;
    }

    function renderProviders(providers) {
      const rows = (providers || []).map((p) => {
        const usage = p.usage ? ` · ${escape(p.usage.used ?? "")} (${escape(p.usage.percent ?? "?")}%, ${escape(p.usage.source || "")})` : "";
        const blocked = p.blockedUntil ? ` · blocked until ${new Date(p.blockedUntil * 1000).toLocaleTimeString()}` : "";
        const quota = p.quotaState && p.quotaState !== "ok" ? ` · quota ${escape(p.quotaState)}` : "";
        return `<article class="live-row"><div><strong>${escape(p.id)}</strong><span>${escape(p.kind || "")}${escape(p.detail ? " · " + p.detail : "")}${escape(quota)}${escape(blocked)}${escape(usage)}</span></div><span class="live-badge ${p.connected ? "done" : "needs_you"}">${p.connected ? "connected" : "not set"}</span></article>`;
      }).join("");
      el.querySelector("#live-providers").innerHTML = rows || '<p class="muted">No provider vault entries yet.</p>';
    }

    function renderRecommendations(recommendations) {
      const pending = (recommendations || []).filter((r) => r.status === "new" || !r.status);
      const rows = pending.map((r) => {
        const url = safeUrl(r.url);
        return `<article class="live-row"><div><strong>${escape(r.title || r.id)}</strong><span>${escape(r.rationale || "")}${r.effort ? ` · effort ${escape(r.effort)}` : ""}${url ? ` · <a href="${escape(url)}" target="_blank" rel="noopener">source</a>` : ""}</span></div><span><button class="hq-button" data-live-action="recAccept:${escape(r.id)}">Accept</button> <button class="hq-button subtle" data-live-action="recDismiss:${escape(r.id)}">Dismiss</button></span></article>`;
      }).join("");
      el.querySelector("#live-recommendations").innerHTML = rows || '<p class="muted">No open recommendations. Agents can file these as they discover follow-up work.</p>';
    }

    const motionOff = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function sparkline(series, key, { width = 420, height = 64 } = {}) {
      const max = Math.max(1, ...series.map((d) => d[key]));
      const slot = width / series.length;
      const bars = series.map((d, i) => {
        const h = Math.round((d[key] / max) * (height - 18));
        return `<rect class="spark-bar${d[key] ? "" : " empty"}" x="${(i * slot + 2).toFixed(1)}" y="${height - 14 - h}" width="${(slot - 4).toFixed(1)}" height="${Math.max(h, 2)}" rx="1"><title>${escape(d.day)} · ${d[key]} commit${d[key] === 1 ? "" : "s"}</title></rect>`;
      }).join("");
      const first = series[0]?.day?.slice(5) || "";
      const last = series.at(-1)?.day?.slice(5) || "";
      // The picture is one carrier, the table the other: role="img" hides the
      // <title> tooltips from assistive technology, so the numbers live in a
      // collapsed table right beside it (HQ-9).
      const table = `<details class="chart-table"><summary>Values as a table</summary><table><caption>Commits per day, last ${series.length} days</caption><thead><tr><th scope="col">Day</th><th scope="col">Commits</th></tr></thead><tbody>${series.map((d) => `<tr><td>${escape(d.day)}</td><td>${d[key]}</td></tr>`).join("")}</tbody></table></details>`;
      return `<svg class="spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="Commits per day, last ${series.length} days">${bars}<text class="spark-axis" x="2" y="${height - 2}">${escape(first)}</text><text class="spark-axis" x="${width - 2}" y="${height - 2}" text-anchor="end">${escape(last)}</text></svg>${table}`;
    }

    function bars(entries, total, className = "") {
      return `<div class="stat-bars ${className}">${entries.map(([label, value]) => `<div class="stat-bar"><span class="stat-bar-label">${escape(label)}</span><span class="stat-bar-track"><span class="stat-bar-fill ${escape(String(label))}" style="width:${total ? Math.round((value / total) * 100) : 0}%"></span></span><span class="stat-bar-value">${escape(String(value))}</span></div>`).join("")}</div>`;
    }

    let lastSetup = null;
    async function refreshSetup() {
      const host = el.querySelector("#live-setup");
      let setup;
      try { setup = await liveApi("/setup"); lastSetup = setup; } catch (error) {
        host.innerHTML = `<p class="muted">Setup check unavailable: ${escape(error.message)}</p>`;
        return;
      }
      const rows = setup.checks.map((c) => `<li class="setup-row ${String(c.state).replace(/[^a-z]/gi, "")}"><span class="setup-state" aria-hidden="true"></span><div><strong>${escape(c.label)} <em class="setup-verdict">${escape(c.state)}</em></strong><span>${escape(c.detail)}</span>${c.fix ? `<code class="setup-fix">${escape(c.fix)}</code>` : ""}</div></li>`).join("");
      const blockerCount = Array.isArray(setup.continuousReadiness?.blockers) ? setup.continuousReadiness.blockers.length : 0;
      host.innerHTML = `
        <details class="setup-details" ${setup.ready && !setup.counts.warn ? "" : "open"}>
          <summary class="setup-summary"><span class="setup-pill ${setup.ready ? (setup.counts.warn ? "warn" : "ok") : "fail"}">${setup.ready ? (setup.counts.warn ? "ready, with notes" : "ready") : "setup needed"}</span><strong>Setup helper</strong><span class="muted">${escape(setup.summary)} · checked ${escape(new Date(setup.generatedAt).toLocaleTimeString())}</span></summary>
          <ul class="setup-list">${rows}</ul>
          ${setup.continuousReadiness ? `<p class="muted setup-readiness">Continuous readiness: <strong>${escape(setup.continuousReadiness.continuousMode)}</strong> · release: <strong>${escape(setup.continuousReadiness.stableRelease)}</strong> · blockers: <strong>${blockerCount}</strong></p>` : ""}
          ${setup.fixScript.length ? `<div class="live-action-row"><button class="hq-button subtle" id="setup-copy" type="button">Copy fix commands</button><span id="setup-copy-status" class="muted" role="status"></span></div><pre class="setup-script">${escape(setup.fixScript.join("\n"))}</pre>` : ""}
        </details>`;
      const copy = host.querySelector("#setup-copy");
      if (copy) copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(setup.fixScript.join("\n")); host.querySelector("#setup-copy-status").textContent = "copied"; }
        catch { host.querySelector("#setup-copy-status").textContent = "select the lines below and copy"; }
      });
    }

    const compact = (n) => {
      const v = Number(n) || 0;
      if (v >= 1e9) return `${(v / 1e9).toFixed(2)} B`;
      if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)} M`;
      if (v >= 1e4) return `${(v / 1e3).toFixed(0)} k`;
      return v.toLocaleString();
    };
    const hoursLabel = (h) => (h >= 48 ? `${(h / 8).toFixed(1)} days` : `${h} h`);

    function heatmapSvg(heat) {
      const cell = 12;
      const gap = 2;
      const w = 24 * (cell + gap) + 30;
      const h = 7 * (cell + gap) + 16;
      const days = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
      let out = `<svg class="heat" viewBox="0 0 ${w} ${h}" role="img" aria-label="Commits by weekday and hour (UTC)">`;
      heat.grid.forEach((row, r) => {
        out += `<text class="heat-axis" x="0" y="${r * (cell + gap) + cell - 2}">${days[r]}</text>`;
        row.forEach((v, c) => {
          const a = heat.max ? v / heat.max : 0;
          out += `<rect x="${30 + c * (cell + gap)}" y="${r * (cell + gap)}" width="${cell}" height="${cell}" rx="1.5" class="heat-cell" style="opacity:${v ? 0.25 + a * 0.75 : 0.08}"><title>${days[r]} ${String(c).padStart(2, "0")}:00 UTC · ${v} commit${v === 1 ? "" : "s"}</title></rect>`;
        });
      });
      for (const hr of [0, 6, 12, 18]) out += `<text class="heat-axis" x="${30 + hr * (cell + gap)}" y="${h - 3}">${String(hr).padStart(2, "0")}</text>`;
      const table = `<details class="chart-table"><summary>Values as a table</summary><table><caption>Commits by weekday and hour (UTC)</caption><thead><tr><th scope="col">Day</th>${Array.from({ length: 24 }, (_, c) => `<th scope="col">${String(c).padStart(2, "0")}</th>`).join("")}</tr></thead><tbody>${heat.grid.map((row, r) => `<tr><th scope="row">${days[r]}</th>${row.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody></table></details>`;
      return out + "</svg>" + table;
    }

    async function refreshInsights(ctx) {
      const host = el.querySelector("#live-effort");
      const signalsHost = el.querySelector("#live-signals");
      let ins;
      try { ins = await liveApi("/insights", { method: "POST", body: JSON.stringify(ctx) }); } catch (error) {
        host.innerHTML = `<p class="muted">Insights unavailable: ${escape(error.message)}</p>`;
        return;
      }
      const e = ins.effort;
      const span = ins.firstCommit && ins.lastCommit ? Math.max(1, Math.round((ins.lastCommit - ins.firstCommit) / 86400)) : null;
      const figure = (value, unit, label, basis, range) => `
        <div class="figure">
          <p class="figure-label">${label}</p>
          <p class="figure-value"><strong>${value}</strong><span>${unit}</span></p>
          ${range ? `<p class="figure-range">${range}</p>` : ""}
          <p class="figure-basis">${escape(basis)}</p>
        </div>`;
      host.innerHTML = `
        <div class="figures">
          ${figure(hoursLabel(e.time.hours), e.time.hours >= 48 ? "of 8-h days" : "hours", "Time invested · estimate", e.time.basis, `range ${hoursLabel(e.time.low)} – ${hoursLabel(e.time.high)} · ${ins.sittings.count} sittings · ${ins.sittings.journalSessions} journal sessions · ${ins.sittings.instances} instances`)}
          ${figure(compact(e.tokens.value), "tokens", `Tokens consumed · ${e.tokens.source === "ledger" ? "measured" : "estimate"}`, e.tokens.basis, e.tokens.low !== e.tokens.high ? `range ${compact(e.tokens.low)} – ${compact(e.tokens.high)}` : "")}
          ${figure(e.costUsd === null || e.costUsd === undefined ? "—" : `$${Number(e.costUsd).toFixed(2)}`, e.costUsd === null || e.costUsd === undefined ? "no ledger" : "USD reported", "Cost · ledger", e.costUsd === null || e.costUsd === undefined ? "the router reports cost only for priced requests; no ledger reachable" : "OmniRoute usage ledger, reported cost, all time", "")}
          ${figure(ins.volume.insertions.toLocaleString(), "lines written", "Change volume", `${ins.volume.deletions.toLocaleString()} lines removed · generated files excluded${span ? ` · ${span} days of history` : ""}`, "")}
        </div>
        <div class="heat-wrap">
          <p class="stat-title">When the work happens <em>UTC</em></p>
          ${heatmapSvg(ins.heat)}
        </div>`;
      const mark = { act: "act", watch: "watch", note: "note" };
      signalsHost.innerHTML = ins.signals.map((sg, i) => `<li class="signal ${mark[sg.level]}"><span class="signal-index">${String(i + 1).padStart(2, "0")}</span><span class="signal-level">${sg.level}</span><div><strong>${escape(sg.title)}</strong><span>${escape(sg.why)}</span></div>${sg.target ? `<button class="hq-button subtle" type="button" data-live-action="goto:${escape(sg.target)}">open</button>` : ""}</li>`).join("");
      el.querySelector("#live-signals-section").dataset.acts = String(ins.signals.filter((x) => x.level === "act").length);
    }

    let statsDays = 14;
    let statsCache = null;
    function drawCommitPeriod() {
      const series = (statsCache?.commitsPerDay30 || statsCache?.commitsPerDay || []).slice(-statsDays);
      const host = el.querySelector('#commit-period-chart');
      if (!host) return;
      host.innerHTML = sparkline(series, 'commits');
      el.querySelector('#commit-period-label').textContent = `Commits · ${series.length} Tage · ${series.reduce((sum, day) => sum + day.commits, 0)} insgesamt`;
      el.querySelectorAll('[data-stats-days]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.statsDays) === statsDays)));
    }
    el.addEventListener('click', event => {
      const button = event.target.closest('[data-stats-days]');
      if (!button) return;
      statsDays = Number(button.dataset.statsDays);
      drawCommitPeriod();
    });
    async function refreshStats(board) {
      const host = el.querySelector("#live-stats");
      let stats;
      try { stats = await liveApi("/stats"); } catch (error) {
        host.innerHTML = `<p class="muted">Statistics unavailable: ${escape(error.message)}</p>`;
        return;
      }
      const fleet = (() => {
        const columns = {};
        let used = 0, total = 0;
        for (const row of board || []) {
          const col = row.column || row.worker?.status || "unknown";
          columns[col] = (columns[col] || 0) + 1;
          if (row.contextUsage?.total) { used += row.contextUsage.used || 0; total += row.contextUsage.total; }
        }
        return { workers: (board || []).length, columns, contextPercent: total ? Math.round((used / total) * 100) : null };
      })();
      const commits14 = stats.commitsPerDay.reduce((a, d) => a + d.commits, 0);
      statsCache = stats;
      const f = stats.snapshot.findings;
      const tile = (value, label, note = "", suffix = "") => `<div class="stat-tile"><strong>${Number(value).toLocaleString()}${escape(suffix)}</strong><span>${escape(label)}</span>${note ? `<small>${escape(note)}</small>` : ""}</div>`;
      host.innerHTML = `
        <div class="analysis-head"><div><p class="eyebrow">STATISTICS / REPOSITORY & FLEET</p><h2>What the numbers say</h2><p class="muted">git history, test surface, evidence classes, fleet distribution and the lesson memory — measured now, on <code>${escape(stats.branch)}</code> @ <code>${escape(stats.head)}</code>${stats.dirtyFiles ? ` · ${stats.dirtyFiles} dirty file${stats.dirtyFiles === 1 ? "" : "s"}` : ""}.</p></div></div>
        <div class="stats-grid">
          <div class="stat-panel stat-wide">
            <div class="workspace-period" role="group" aria-label="Zeitraum für Commits">${[7, 14, 30].map(days => `<button class="hq-button" type="button" data-stats-days="${days}" aria-pressed="${days === statsDays}" ${days === 30 && !stats.commitsPerDay30 ? 'disabled' : ''}>${days} Tage</button>`).join('')}</div>
            <p class="stat-title" id="commit-period-label">Commits · last 14 days <em>${commits14}</em></p>
            <div id="commit-period-chart">${sparkline(stats.commitsPerDay, "commits")}</div>
            <p class="stat-foot">${stats.authors.length ? stats.authors.map((a) => `${escape(a.author)} ${a.commits}`).join(" · ") : "no authors in the last 30 days"}</p>
          </div>
          <div class="stat-panel">
            <p class="stat-title">Test surface</p>
            <div class="stat-tiles">${tile(stats.tests.rustTests, "Rust tests", "#[test] in src-tauri")}${tile(stats.tests.frontendTestFiles, "test files", "vitest, node:test, browser")}${tile(stats.tests.rustFiles, "Rust files")}</div>
          </div>
          <div class="stat-panel">
            <p class="stat-title">Evidence · ${f.total} findings</p>
            ${bars(Object.entries(f).filter(([k]) => k !== "total"), f.total, "klass")}
          </div>
          <div class="stat-panel">
            <p class="stat-title">Specs · ${stats.snapshot.specs.total} active</p>
            ${bars([["startable", stats.snapshot.specs.startable], ["locked", stats.snapshot.specs.locked], ["serial", stats.snapshot.specs.serial], ["parallel", stats.snapshot.specs.parallel]], stats.snapshot.specs.total)}
          </div>
          <div class="stat-panel">
            <p class="stat-title">Fleet · ${board === null ? 'nicht erreichbar' : `${fleet.workers} worker${fleet.workers === 1 ? "" : "s"}`}${fleet.contextPercent === null ? "" : ` · context ${fleet.contextPercent}%`}</p>
            ${board === null ? '<p class="muted">Control-API nicht verfügbar. Keine Aussage über die Anzahl laufender Worker.</p>' : fleet.workers ? bars(Object.entries(fleet.columns), fleet.workers, "column") : '<p class="muted">no workers in this scope</p>'}
          </div>
          <div class="stat-panel stat-wide">
            <p class="stat-title">Lesson memory</p>
            <div class="stat-tiles">${tile(stats.lessons.count, "lessons")}${tile(stats.lessons.hits, "times applied")}${tile(stats.lessons.tags.length, "tags")}</div>
          </div>
        </div>`;
      // Measurements appear at their final value; they must never count up.
      drawCommitPeriod();
    }

    let lessonQuery = "";
    let lessonCache = [];
    async function refreshLessons() {
      const host = el.querySelector("#live-lessons");
      const sort = el.querySelector("#lesson-sort").value;
      let result;
      try { result = await liveApi(`/lessons?q=${encodeURIComponent(lessonQuery)}&sort=${encodeURIComponent(sort)}&limit=12`); } catch (error) {
        host.innerHTML = `<p class="muted">Lessons unavailable: ${escape(error.message)}</p>`;
        return;
      }
      lessonCache = result.lessons;
      el.querySelector("#lesson-tags").innerHTML = result.stats.tags.slice(0, 14).map((t) => `<button type="button" class="lesson-tag${lessonQuery === t.tag ? " active" : ""}" data-lesson-tag="${escape(t.tag)}">${escape(t.tag)} <em>${t.count}</em></button>`).join("");
      const proven = result.lessons.filter((l) => l.badges?.label === "proven").length;
      el.querySelector("#lesson-summary").textContent = `${result.stats.count} lessons · applied ${result.stats.hits}× in total · ${result.lessons.length} shown${proven ? ` · ${proven} proven` : ""}`;
      paint(host, result.lessons.length
        ? result.lessons.map((l) => lessonCard(l, { query: lessonQuery, live: true })).join("")
        : `<p class="muted">${lessonQuery ? `No lesson matches “${escape(lessonQuery)}”. If you solve it, add it below so the next agent finds it.` : "No lessons yet — add the first one below."}</p>`);
    }

    // Live signals → known fixes: every attention reason or failing test on
    // the board is matched against the memory and shown right on the row.
    async function annotateFleet(board) {
      const signals = [...new Set((board || []).flatMap((row) => {
        const out = [];
        if (row.attentionReason) out.push(String(row.attentionReason));
        if (row.testStatus && /fail|error|red/i.test(String(row.testStatus))) out.push(`tests ${row.testStatus}`);
        if (row.worker?.lastError) out.push(String(row.worker.lastError));
        return out;
      }))];
      if (!signals.length) return;
      let matches;
      try { ({ matches } = await liveApi("/lessons/match", { method: "POST", body: JSON.stringify({ signals }) })); } catch { return; }
      for (const m of matches) {
        el.querySelectorAll(`.fleet-row[data-signal]`).forEach((row) => {
          if (!row.dataset.signal.split("\u0001").includes(m.signal)) return;
          if (row.querySelector(".known-fix")) return;
          row.insertAdjacentHTML("beforeend", `<div class="known-fix"><span class="lesson-badge ${escape(m.lesson.badges.label)}">known</span><strong>${escape(m.lesson.symptom)}</strong><code>${escape(m.lesson.fix)}</code><button class="hq-button subtle" type="button" data-live-action="lessonFocus:${escape(m.lesson.id)}">open lesson</button></div>`);
        });
      }
    }
    let lessonTimer = null;
    el.querySelector("#lesson-query").addEventListener("input", (event) => {
      lessonQuery = event.target.value.trim();
      clearTimeout(lessonTimer);
      lessonTimer = setTimeout(refreshLessons, 180);
    });
    el.querySelector("#lesson-sort").addEventListener("change", refreshLessons);
    el.querySelector("#lesson-brief").addEventListener("click", async () => {
      const summary = el.querySelector("#lesson-summary");
      try {
        const response = await fetch(`/__hq/lessons/brief?q=${encodeURIComponent(lessonQuery)}&limit=5`, { headers: { "x-hq-session": hqSessionToken() } });
        const text = await response.text();
        await navigator.clipboard.writeText(text);
        summary.textContent = `Brief copied (${text.split("\n").length} lines of markdown) — paste it into the worker prompt.`;
      } catch (error) {
        summary.textContent = `Brief not copied: ${error.message}`;
      }
    });
    el.querySelector("#lesson-tags").addEventListener("click", (event) => {
      const tag = event.target.closest("[data-lesson-tag]");
      if (!tag) return;
      lessonQuery = lessonQuery === tag.dataset.lessonTag ? "" : tag.dataset.lessonTag;
      el.querySelector("#lesson-query").value = lessonQuery;
      refreshLessons();
    });
    el.querySelector("#lesson-save").addEventListener("click", async () => {
      const status = el.querySelector("#lesson-status");
      const lesson = {
        symptom: el.querySelector("#lesson-symptom").value.trim(),
        cause: el.querySelector("#lesson-cause").value.trim(),
        fix: el.querySelector("#lesson-fix").value.trim(),
        tags: el.querySelector("#lesson-tag-input").value.split(",").map((t) => t.trim()).filter(Boolean),
        source: el.querySelector("#lesson-source").value.trim() || undefined,
      };
      try {
        const saved = await liveApi("/lessons", { method: "POST", body: JSON.stringify(lesson) });
        status.textContent = saved.merged ? `Known already — counted again (${saved.lesson.hits}×).` : `Saved ${saved.lesson.id}.`;
        for (const id of ["#lesson-symptom", "#lesson-cause", "#lesson-fix", "#lesson-tag-input", "#lesson-source"]) el.querySelector(id).value = "";
        await refreshLessons();
      } catch (error) {
        status.textContent = error.message;
      }
    });

    let refreshing = false;
    let refreshPending = false;
    async function refresh() {
      if (refreshing) { refreshPending = true; return; }
      refreshing = true;
      const requestedProject = projectSelect.value;
      setStatus("refreshing…", "pending");
      const local = Promise.allSettled([
        continuous?.refresh(),
        refreshSetup(),
        refreshAnalysis().catch(error => { el.querySelector('#live-analysis').textContent = `Analyse nicht verfügbar: ${error.message}`; }),
        liveApi('/profiles').then(renderTeams).catch(error => { el.querySelector('#live-teams').textContent = `Profile nicht verfügbar: ${error.message}`; }),
        refreshLessons(),
      ]);
      try {
        const [projects, board, queue, questions, learnings, roles, activity, quota, budgets, usage, providers, recommendations] = await Promise.all([
          liveApi("/api/projects"),
          liveApi(query("/api/board")),
          liveApi(query("/api/queue")),
          liveApi(query("/api/questions?status=open")),
          liveApi(query("/api/learnings?status=pending")),
          liveApi(query("/api/roles?status=pending")),
          liveApi(query("/api/activity?limit=12")),
          liveApi("/api/quota").catch(() => []),
          liveApi("/api/budgets").catch(() => []),
          liveApi("/api/usage?limit=20").catch(() => null),
          liveApi("/api/providers").catch(() => []),
          liveApi(query("/api/recommendations")).catch(() => []),
        ]);
        const current = projectSelect.value;
        if (current !== requestedProject) { refreshPending = true; return; }
        if (projectSelect.options.length === 1) {
          projectSelect.insertAdjacentHTML("beforeend", projects.map((p) => `<option value="${escape(p.id)}">${escape(p.name || p.id)}</option>`).join(""));
        }
        if (current && projects.some((p) => p.id === current)) projectSelect.value = current;
        fleetCache = board;
        applyFleetFilter();
        annotateFleet(board);
        renderItems("#live-queue", queue, (entry) => `<article class="live-row"><div><strong>${escape(entry.sharpenedText || entry.rawText || entry.id)}</strong><span>${escape(entry.id)} · ${escape(entry.status || "queued")}</span></div>${entry.status === "queued" ? liveButton("Cancel", `cancel:${entry.id}`) : ""}</article>`, "Queue is clear.");
        renderItems("#live-questions", questions, (question) => `<article class="live-row"><div><strong>${escape(question.question || question.text || question.id)}</strong><span>${escape(question.workerId || "preflight")} · ${escape(question.id)}</span></div><button class="hq-button" data-live-action="answer:${escape(question.id)}">Answer</button></article>`, "No open questions.");
        const reviewItems = [
          ...learnings.map((item) => ({ ...item, kind: "learning", label: item.text || item.title || item.id })),
          ...roles.map((item) => ({ ...item, kind: "role", label: item.name || item.title || item.id })),
        ];
        renderItems("#live-review", reviewItems, (item) => `<article class="live-row"><div><strong>${escape(item.label)}</strong><span>${escape(item.kind)} · ${escape(item.id)}</span></div><span><button class="hq-button" data-live-action="${item.kind}Approve:${escape(item.id)}" data-live-text="${escape(item.label)}">Approve</button> <button class="hq-button" data-live-action="${item.kind}Reject:${escape(item.id)}">Reject</button></span></article>`, "No pending verdicts.");
        renderItems("#live-activity", activity, (item) => `<article class="activity-row"><time title="${escape(item.createdAt || item.timestamp || "")}">${escape(shortTime(item.createdAt || item.timestamp || ""))}</time><span>${escape(item.text || item.message || item.kind || JSON.stringify(item))}</span></article>`, "No recent activity.");
        renderCapacity(quota, budgets);
        renderUsage(usage);
        renderProviders(providers);
        renderRecommendations(recommendations);
        await Promise.all([
          refreshStats(board),
          refreshInsights({ board, quota, budgets, providers, questions, queue, usage, setup: lastSetup }),
        ]);
        el.classList.add("live-ready");
        setStatus(`connected · updated ${new Date().toLocaleTimeString()}`, "ok");
        el.querySelector("#live-error").hidden = true;
      } catch (error) {
        showError(error);
        for (const id of ['live-board', 'live-queue', 'live-questions', 'live-review', 'live-activity', 'live-capacity', 'live-usage', 'live-providers', 'live-recommendations', 'live-signals', 'live-effort']) {
          el.querySelector(`#${id}`).textContent = 'Live-Daten nicht verfügbar. Verbindung zur Control-API prüfen.';
        }
        await refreshStats(null);
      } finally {
        await local;
        refreshing = false;
        if (refreshPending) { refreshPending = false; void refresh(); }
      }
    }
    projectSelect.addEventListener("change", refresh);
    el.querySelector("#live-refresh").addEventListener("click", refresh);
    const keysHelp = el.querySelector("#live-keys-help");
    el.querySelector("#live-keys").addEventListener("click", () => { keysHelp.hidden = !keysHelp.hidden; });
    // HQ-14: single-key shortcuts are a WCAG 2.1.4 hazard unless they can be
    // turned off; the choice is remembered per browser.
    const keysToggle = el.querySelector("#live-keys-enabled");
    const KEYS_PREF = "hq.shortcuts";
    const readKeysPref = () => { try { return localStorage.getItem(KEYS_PREF) !== "off"; } catch { return true; } };
    keysToggle.checked = readKeysPref();
    keysToggle.addEventListener("change", () => {
      try { localStorage.setItem(KEYS_PREF, keysToggle.checked ? "on" : "off"); } catch { /* private mode */ }
    });
    document.addEventListener("keydown", (event) => {
      const active = document.activeElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(active?.tagName || "") || Boolean(active?.isContentEditable);
      if (event.key === "Escape") {
        keysHelp.hidden = true;
        const detail = el.querySelector("#worker-detail");
        if (detail && !detail.hidden) detail.hidden = true;
        const editor = el.querySelector("#team-editor");
        if (editor && !editor.hidden) editor.hidden = true;
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey || !keysToggle.checked) return;
      if (event.key === "/") { event.preventDefault(); workspace.reveal("#lesson-query"); el.querySelector("#lesson-query").focus(); }
      else if (event.key === "f") { event.preventDefault(); workspace.reveal("#live-fleet-filter"); el.querySelector("#live-fleet-filter").focus(); }
      else if (event.key === "g") { event.preventDefault(); const goalsCard = el.querySelector("#hq-goals-live"); if (goalsCard) { workspace.reveal(goalsCard); goalsCard.focus(); } }
      else if (event.key === "b") { event.preventDefault(); const budgetSection = el.querySelector("#hq-budget-live"); if (budgetSection) { workspace.reveal(budgetSection); budgetSection.focus(); } }
      else if (event.key === "r") { event.preventDefault(); refresh(); }
      else if (event.key === "?") { event.preventDefault(); keysHelp.hidden = !keysHelp.hidden; }
    });
    // Rows rendered as role="button" get the keys a real button has (HQ-1).
    el.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target.closest('[data-live-action][role="button"]');
      if (!target || event.target.closest("button, a, input, select, textarea, summary")) return;
      event.preventDefault();
      target.click();
    });
    el.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-live-action]");
      if (!button) return;
      const [action, ...parts] = button.dataset.liveAction.split(":");
      const id = parts.join(":");
      try {
        if (action === "detail") {
          await openWorkerDetail(id);
          return;
        } else if (action === "detailSend") {
          const text = el.querySelector("#detail-message").value;
          const status = el.querySelector("#detail-status");
          if (!detailWorkerId || !text) throw new Error("Open a worker and type a message");
          await liveApi(`/api/workers/${encodeURIComponent(detailWorkerId)}/send`, { method: "POST", body: JSON.stringify({ text }) });
          status.textContent = "sent";
          el.querySelector("#detail-message").value = "";
          await openWorkerDetail(detailWorkerId);
          return;
        } else if (action === "spawn") {
          const task = el.querySelector("#live-spawn-task").value.trim();
          const status = el.querySelector("#live-spawn-status");
          if (!selectedProject() || !task) throw new Error("Select a project and enter a task to spawn");
          if (!window.confirm(`Spawn a worker on "${task}" now? This starts a real agent immediately.`)) return;
          const profileId = el.querySelector("#live-spawn-profile").value;
          const worker = await liveApi("/api/workers", {
            method: "POST",
            body: JSON.stringify({ projectId: selectedProject(), task, ...(profileId ? { profileId } : {}) }),
          });
          status.textContent = `spawned ${worker.id || "worker"}`;
          el.querySelector("#live-spawn-task").value = "";
        } else if (action === "send") {
          const workerId = el.querySelector("#live-worker-id").value.trim();
          const text = el.querySelector("#live-message").value;
          if (!workerId || !text) throw new Error("Worker id and message are required");
          await liveApi(`/api/workers/${encodeURIComponent(workerId)}/send`, { method: "POST", body: JSON.stringify({ text }) });
        } else if (action === "queue") {
          const rawText = el.querySelector("#live-queue-text").value.trim();
          if (!selectedProject() || !rawText) throw new Error("Select a project and enter a task");
          const profileId = el.querySelector("#live-queue-profile").value;
          await liveApi("/api/queue", {
            method: "POST",
            body: JSON.stringify({ projectId: selectedProject(), rawText, ...(profileId ? { profileId } : {}) }),
          });
        } else if (action === "assign") {
          profileSelect.value = id;
          workspace.reveal("#live-queue-text");
          el.querySelector("#live-queue-text").focus();
          return;
        } else if (action === "editTeam") {
          openTeamEditor(knownProfiles.find((p) => p.id === id));
          return;
        } else if (action === "cancel") {
          if (!window.confirm(`Cancel queue entry ${id}?`)) return;
          await liveApi(`/api/queue/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" });
        } else if (action === "answer") {
          // The answer is typed next to the question, not into a browser
          // prompt that hides it (HQ-21). The row is left alone by the
          // refresh while the field has focus.
          const row = button.closest(".live-row");
          if (!row || row.querySelector(".answer-form")) return;
          row.insertAdjacentHTML("beforeend", `<div class="answer-form live-action-row"><label class="control-field">Antwort <input class="answer-text" placeholder="Antwort an den Agenten"></label>${liveButton("Senden", `answerSend:${id}`)}</div>`);
          const field = row.querySelector(".answer-text");
          field.addEventListener("keydown", (keyEvent) => {
            if (keyEvent.key === "Escape") {
              keyEvent.preventDefault();
              // Round 2 (finding A-5): cancel without posting and give the
              // focus back to the trigger — the form is gone from the row.
              row.querySelector(".answer-form")?.remove();
              button.focus();
              return;
            }
            if (keyEvent.key !== "Enter") return;
            keyEvent.preventDefault();
            row.querySelector(`[data-live-action="answerSend:${CSS.escape(id)}"]`)?.click();
          });
          field.focus();
          return;
        } else if (action === "answerSend") {
          const row = button.closest(".live-row");
          const answer = row?.querySelector(".answer-text")?.value ?? "";
          if (!answer.trim()) throw new Error("Antwort darf nicht leer sein");
          await liveApi(`/api/questions/${encodeURIComponent(id)}/answer`, { method: "POST", body: JSON.stringify({ answer }) });
        } else if (action === "merge") {
          const token = el.querySelector("#live-verdict-token").value.trim();
          if (!token) throw new Error("Paste the verdict token before merging");
          if (!window.confirm(`Merge ${id} into its project branch?`)) return;
          await liveApi(`/api/workers/${encodeURIComponent(id)}/merge`, {
            method: "POST",
            headers: { "x-hq-verdict-token": token },
            body: JSON.stringify({ removeWorktree: false }),
          });
        } else if (action === "learningApprove" || action === "learningReject" || action === "roleApprove" || action === "roleReject") {
          const token = el.querySelector("#live-verdict-token").value.trim();
          if (!token) throw new Error("Paste the verdict token before recording a verdict");
          const kind = action.startsWith("learning") ? "learnings" : "roles";
          const verb = action.endsWith("Approve") ? "approve" : "reject";
          if (!window.confirm(`${verb === "approve" ? "Approve" : "Reject"} ${kind.slice(0, -1)} ${id}?`)) return;
          const body = verb === "approve" && kind === "learnings" ? JSON.stringify({ text: button.dataset.liveText || "" }) : "{}";
          await liveApi(`/api/${kind}/${encodeURIComponent(id)}/${verb}`, {
            method: "POST",
            headers: { "x-hq-verdict-token": token },
            body,
          });
        } else if (action === "lessonHit") {
          await liveApi(`/lessons/${encodeURIComponent(id)}/hit`, { method: "POST", body: "{}" });
          await refreshLessons();
          return;
        } else if (action === "lessonWorked" || action === "lessonFailed") {
          // The run id is asked for in the card, not in a browser prompt
          // (HQ-21): the field explains itself and survives the refresh.
          const verb = action === "lessonWorked" ? "worked" : "failed";
          const card = el.querySelector(`.lesson-row[data-lesson-id="${CSS.escape(id)}"]`);
          const extra = card.querySelector(".lesson-extra");
          extra.hidden = false;
          extra.innerHTML = `<div class="team-form"><label>Run-ID <input class="run-id" placeholder="derselbe Lauf zählt nur einmal"></label></div><div class="live-action-row">${liveButton(verb === "worked" ? "Als geholfen eintragen" : "Als nicht geholfen eintragen", `lesson${verb === "worked" ? "Worked" : "Failed"}Send:${id}`)}<span class="muted run-status" role="status"></span></div>`;
          extra.querySelector(".run-id").focus();
          return;
        } else if (action === "lessonWorkedSend" || action === "lessonFailedSend") {
          const verb = action === "lessonWorkedSend" ? "worked" : "failed";
          const card = el.querySelector(`.lesson-row[data-lesson-id="${CSS.escape(id)}"]`);
          const runId = (card.querySelector(".run-id")?.value || "").trim();
          if (!runId) { card.querySelector(".run-status").textContent = "Run-ID fehlt."; return; }
          const { lesson } = await liveApi(`/lessons/${encodeURIComponent(id)}/${verb}`, { method: "POST", body: JSON.stringify({ runId }) });
          await refreshLessons();
          const fresh = el.querySelector(`.lesson-row[data-lesson-id="${CSS.escape(id)}"]`);
          if (fresh && verb === "failed") {
            const extra = fresh.querySelector(".lesson-extra");
            extra.hidden = false;
            extra.innerHTML = `<p class="muted">Recorded. The fix did not help this time (${lesson.badges.confidence}% worked). Know a better one? Refine it so the next agent gets the right fix.</p>`;
          }
          return;
        } else if (action === "lessonRefine") {
          const card = el.querySelector(`.lesson-row[data-lesson-id="${CSS.escape(id)}"]`);
          const current = lessonCache.find((l) => l.id === id);
          const extra = card.querySelector(".lesson-extra");
          extra.hidden = false;
          extra.innerHTML = `<div class="team-form"><label>Better fix <input class="refine-fix" value="${escape(current?.fix || "")}"></label><label>Cause (optional) <input class="refine-cause" value="${escape(current?.cause || "")}"></label><label>Why (note) <input class="refine-note" placeholder="what was wrong with the old fix"></label></div><div class="live-action-row"><button class="hq-button" type="button" data-live-action="lessonRefineSave:${escape(id)}">Save refinement</button><span class="muted refine-status" role="status"></span></div>`;
          return;
        } else if (action === "lessonRefineSave") {
          const card = el.querySelector(`.lesson-row[data-lesson-id="${CSS.escape(id)}"]`);
          const status = card.querySelector(".refine-status");
          try {
            await liveApi(`/lessons/${encodeURIComponent(id)}/refine`, { method: "POST", body: JSON.stringify({ fix: card.querySelector(".refine-fix").value, cause: card.querySelector(".refine-cause").value, note: card.querySelector(".refine-note").value }) });
            await refreshLessons();
          } catch (error) { status.textContent = error.message; }
          return;
        } else if (action === "lessonRelated") {
          const card = el.querySelector(`.lesson-row[data-lesson-id="${CSS.escape(id)}"]`);
          const extra = card.querySelector(".lesson-extra");
          const { related } = await liveApi(`/lessons/${encodeURIComponent(id)}/related`);
          extra.hidden = false;
          extra.innerHTML = related.length
            ? `<p class="stat-title">Related</p>${related.map((r) => `<p class="lesson-related"><span class="lesson-badge ${escape(r.badges.label)}">${escape(r.badges.label)}</span><strong>${escape(r.symptom)}</strong><code>${escape(r.fix)}</code></p>`).join("")}`
            : '<p class="muted">No related lesson shares a tag or symptom word.</p>';
          return;
        } else if (action === "lessonCopy") {
          const current = lessonCache.find((l) => l.id === id);
          if (current) await navigator.clipboard.writeText(lessonMarkdown(current));
          return;
        } else if (action === "goto") {
          const [kind, ref] = (id || "").split(":");
          const targets = { capacity: "#live-capacity", providers: "#live-providers", queue: "#live-queue", lessons: "#live-lessons", setup: "#live-setup", stats: "#live-stats", sources: "#live-analysis", next: "#live-stats" };
          if (kind === "worker") { await openWorkerDetail(ref); return; }
          if (kind === "question") { workspace.reveal("#live-questions"); return; }
          const node = el.querySelector(targets[kind] || "#live-board");
          if (node) workspace.reveal(node);
          return;
        } else if (action === "lessonFocus") {
          lessonQuery = id;
          el.querySelector("#lesson-query").value = id;
          await refreshLessons();
          workspace.reveal("#live-lessons");
          return;
        } else if (action === "recAccept") {
          if (!window.confirm(`Accept recommendation ${id}? This queues it as a real task.`)) return;
          await liveApi(`/api/recommendations/${encodeURIComponent(id)}/accept`, { method: "POST", body: "{}" });
        } else if (action === "recDismiss") {
          await liveApi(`/api/recommendations/${encodeURIComponent(id)}/status`, {
            method: "POST",
            body: JSON.stringify({ status: "dismissed" }),
          });
        }
        await refresh();
      } catch (error) { showError(error); }
    });
    refresh();
    window.setInterval(refresh, 5000);
  }

  function renderNow(data, el) {
    const grip = data.nextGrip && data.nextGrip[0];
    const serial = (data.specs || []).filter((s) => s.lane === "serial");
    const parallel = (data.specs || []).filter((s) => s.lane !== "serial");
    el.innerHTML = `
    <p class="meta">from STAND.md · ${escape(data.generatedAt)} · ${escape(data.commit || "no git")}</p>
    ${data.dirty ? `<p class="chip">worktree dirty at generate time</p>` : ""}
    ${summaryStrip(data)}
    <section class="grip">
      <p class="grip-label">NEXT DECISION</p>
      <p class="grip-text">${escape(grip ? grip.text : "UNPROVEN")}</p>
      <p class="cite">${escape(grip ? grip.source : "STAND.md")}</p>
    </section>
    <section class="now-grid">
      <div class="brief-section">
        ${sectionTitle("What is moving", "The first actionable work in each lane.")}
        <ul class="signal-list">
          ${(serial.slice(0, 3).map((s) => `<li><span class="signal-mark serial"></span><div><strong>${escape(basename(s.file))}</strong><span>${escape(s.packet)}</span></div><em>${s.startable === false ? "locked" : "first"}</em></li>`).join("") || `<li class="muted">No serial work is listed.</li>`)}
          ${(parallel.slice(0, 2).map((s) => `<li><span class="signal-mark parallel"></span><div><strong>${escape(basename(s.file))}</strong><span>${escape(s.packet)}</span></div><em>parallel</em></li>`).join(""))}
        </ul>
      </div>
      <div class="brief-section">
        ${sectionTitle("Read this desk", "A snapshot, not a live dispatcher.")}
        <p class="brief-copy">HQ tells you what the repository currently claims, what is evidenced, and where serial ownership prevents parallel work. Regenerate after a meaningful change with <code>npm run hq</code>.</p>
        <a class="text-link" href="./proof.html">Inspect the evidence →</a>
      </div>
    </section>
    ${sectionTitle("Active specifications", `${(data.specs || []).length} executable specs · serial locks are resolved in STAND order.`)}
    <figure class="lane-figure">
      <figcaption>Lane occupancy · Source: STAND.md#Aktive Specs</figcaption>
      <div id="lane"></div>
    </figure>
    ${
      !data.specs || data.specs.length === 0
        ? `<p class="empty-specs">no executable specs — STAND and Status: aktiv disagree or both empty</p>`
        : specTable(data.specs)
    }
    <a class="mini-dag-link" href="./map.html" aria-label="Open package map"><svg id="mini-dag" role="img" aria-label="Package DAG thumbnail"></svg></a>
  `;
    drawLanes(document.getElementById("lane"), data);
    drawDag(document.getElementById("mini-dag"), data.packages, { mini: true });
  }

  const DAG_POS = {
    F0: [40, 80],
    F1: [180, 80],
    F4: [320, 80],
    F5: [460, 80],
    F8: [600, 140],
    F2: [180, 200],
    "F6-UI": [320, 200],
    F3: [320, 140],
    "F6-Attribution": [460, 200],
    F7: [40, 200],
  };

  function dagClass(p) {
    if (p.current === "done") return "dag-node done";
    if (p.current === "active") {
      return p.lane === "serial" ? "dag-node active serial" : "dag-node active parallel";
    }
    return "dag-node waiting";
  }

  function renderMap(data, el) {
    el.innerHTML = `
      <p class="meta">from docs/PLAN.md · ${escape(data.generatedAt)} · ${escape(data.commit || "no git")}</p>
      ${summaryStrip(data)}
      <figure class="dag-figure">
        <figcaption>Package DAG · Source: docs/PLAN.md</figcaption>
        <svg id="dag"></svg>
      </figure>
      <div class="legend" aria-label="Package state legend">
        <span><i class="legend-dot done"></i>done</span>
        <span><i class="legend-dot active"></i>active</span>
        <span><i class="legend-dot waiting"></i>waiting</span>
        <span class="legend-note">Dependencies and sources are listed in the table below.</span>
      </div>
      <div class="table-wrap package-table-wrap">
        <table class="spec-table package-table">
          <thead><tr><th scope="col">package</th><th scope="col">state</th><th scope="col">lane</th><th scope="col">depends on</th></tr></thead>
          <tbody>${(data.packages || []).map((p) => `<tr><td class="path">${escape(p.id)}</td><td><span class="package-state ${escape(p.current)}">${escape(p.current)}</span></td><td>${escape(p.lane)}</td><td class="cite">${escape((p.dependsOn || []).join(" · ") || "—")}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    `;
    drawDag(document.getElementById("dag"), data.packages, { mini: false });
    strokeMapOnce(document.getElementById("dag"));
  }

  function prefersReducedMotion() {
    return (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function strokeMapOnce(svg) {
    if (!svg || prefersReducedMotion()) return;
    try {
      if (sessionStorage.getItem("hq-dag-drawn")) return;
      sessionStorage.setItem("hq-dag-drawn", "1");
    } catch (_err) {
      return;
    }
    svg.classList.add("dag-stroke");
  }

  function drawDag(svg, packages, opts) {
    if (!svg) return;
    const mini = opts && opts.mini;
    const NS = "http://www.w3.org/2000/svg";
    const r = mini ? 8 : 14;
    svg.setAttribute("viewBox", "0 0 680 260");
    svg.setAttribute("class", mini ? "dag-svg mini" : "dag-svg");
    svg.setAttribute("role", mini ? "img" : "group");
    svg.setAttribute("aria-label", "Package DAG from docs/PLAN.md");
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const defs = document.createElementNS(NS, "defs");
    const marker = document.createElementNS(NS, "marker");
    marker.setAttribute("id", "dag-arrow");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "5");
    marker.setAttribute("markerHeight", "5");
    marker.setAttribute("orient", "auto-start-reverse");
    const arrow = document.createElementNS(NS, "path");
    arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    arrow.setAttribute("fill", "currentColor");
    marker.appendChild(arrow);
    defs.appendChild(marker);
    svg.appendChild(defs);

    for (const p of packages || []) {
      const to = DAG_POS[p.id];
      if (!to) continue;
      for (const dep of p.dependsOn || []) {
        const from = DAG_POS[dep];
        if (!from) continue;
        const line = document.createElementNS(NS, "line");
        line.setAttribute("x1", String(from[0]));
        line.setAttribute("y1", String(from[1]));
        line.setAttribute("x2", String(to[0]));
        line.setAttribute("y2", String(to[1]));
        line.setAttribute("class", "dag-edge");
        svg.appendChild(line);
      }
    }

    for (const p of packages || []) {
      const pos = DAG_POS[p.id];
      if (!pos) continue;
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", dagClass(p));
      if (!mini) {
        g.setAttribute("tabindex", "0");
        g.setAttribute("role", "img");
      }
      g.setAttribute("aria-label", `${p.id} ${p.current} package`);
      const circle = document.createElementNS(NS, "circle");
      circle.setAttribute("cx", String(pos[0]));
      circle.setAttribute("cy", String(pos[1]));
      circle.setAttribute("r", String(r));
      g.appendChild(circle);
      const title = document.createElementNS(NS, "title");
      const deps = (p.dependsOn || []).join(", ");
      title.textContent = deps
        ? `${p.id} · ${p.lane} · ${p.source} · dependsOn ${deps}`
        : `${p.id} · ${p.lane} · ${p.source}`;
      g.appendChild(title);
      const text = document.createElementNS(NS, "text");
      text.setAttribute("x", String(pos[0]));
      text.setAttribute("y", String(pos[1] + (mini ? 18 : 26)));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("class", "dag-label");
      text.textContent = p.id;
      g.appendChild(text);
      svg.appendChild(g);
    }
  }

  const KLASS_ORDER = ["FACT", "CLAIM", "UNPROVEN"];

  function proofColumns(findings) {
    const counts = { FACT: 0, CLAIM: 0, UNPROVEN: 0 };
    for (const f of findings) {
      if (counts[f.klass] !== undefined) counts[f.klass] += 1;
    }
    return KLASS_ORDER.filter((k) => counts[k] > 0);
  }

  function renderProof(data, el) {
    const findings = data.findings || [];
    const columns = proofColumns(findings);
    const s = summary(data);
    const rowIds = [];
    for (const f of findings) {
      const row = f.packet || "unscoped";
      if (!rowIds.includes(row)) rowIds.push(row);
    }

    function count(packet, klass) {
      return findings.filter(
        (f) => (f.packet || "unscoped") === packet && f.klass === klass,
      ).length;
    }

    const head = columns.map((k) => `<th scope="col">${escape(k)}</th>`).join("");
    const body = rowIds
      .map((packet) => {
        const cells = columns
          .map((klass) => {
            const n = count(packet, klass);
            return `<td><button type="button" class="matrix-cell" data-packet="${escape(packet)}" data-klass="${escape(klass)}">${n}</button></td>`;
          })
          .join("");
        return `<tr><th scope="row">${escape(packet)}</th>${cells}</tr>`;
      })
      .join("");

    el.innerHTML = `
      <p class="meta">from STAND.md · ${escape(data.generatedAt)} · ${escape(data.commit || "no git")}</p>
      ${summaryStrip(data)}
      <div class="proof-intro"><strong>${s.facts} facts</strong> are backed by report sources. <strong>${s.claims} claims</strong> still need the reader's attention. Select a cell to filter the findings below.</div>
      <figure class="matrix-figure">
        <figcaption>Finding matrix · Source: STAND.md §4 + .pa/report_f0.md</figcaption>
        <div class="table-wrap">
          <table class="proof-matrix">
            <thead><tr><th scope="col">packet</th>${head}</tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </figure>
      <p id="finding-status" class="meta" role="status" aria-live="polite"></p>
      <ol id="finding-list" class="finding-list"></ol>
    `;

    const list = document.getElementById("finding-list");
    const status = document.getElementById("finding-status");
    let filter = null;

    function paintList() {
      const shown = findings.filter((f) => {
        if (!filter) return true;
        return (f.packet || "unscoped") === filter.packet && f.klass === filter.klass;
      });
      el.querySelectorAll(".matrix-cell").forEach((cell) => {
        const pressed = Boolean(filter) && cell.getAttribute("data-packet") === filter.packet && cell.getAttribute("data-klass") === filter.klass;
        cell.setAttribute("aria-pressed", String(pressed));
      });
      status.textContent = filter
        ? `${shown.length} of ${findings.length} findings · filter ${filter.packet} / ${filter.klass}`
        : `${findings.length} findings, no filter`;
      list.innerHTML = shown
        .map(
          (f) => `<li class="finding ${escape(f.klass.toLowerCase())}">
            <span class="finding-id">${escape(f.id)}</span>
            <span class="finding-klass">${escape(f.klass)}</span>
            <span class="finding-text">${escape(f.text)}</span>
            <span class="cite">${escape(f.source)}</span>
          </li>`,
        )
        .join("");
    }

    el.querySelectorAll(".matrix-cell").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = { packet: btn.getAttribute("data-packet"), klass: btn.getAttribute("data-klass") };
        filter =
          filter && filter.packet === next.packet && filter.klass === next.klass ? null : next;
        paintList();
      });
    });
    paintList();
  }

  function renderNext(data, el) {
    const items = data.next || [];
    const ready = items.filter((n) => n.startable !== false).length;
    const nodes = items
      .map((n, i) => {
        const locked = n.startable === false;
        const mark = locked ? "waits" : "open";
        const edge = locked ? "next-edge ember" : "next-edge";
        return `<li class="next-node ${locked ? "locked" : "ready"}">
          ${i > 0 ? `<div class="${edge}" aria-hidden="true"></div>` : ""}
          <p class="next-mark">${mark}</p>
          <p class="next-packet">${escape(n.packet)}</p>
          <p class="next-why">${escape(n.why)}</p>
          <p class="cite">${escape(n.doneWhen)} · ${escape(n.source)}</p>
        </li>`;
      })
      .join("");
    el.innerHTML = `
      <p class="meta">from STAND.md · ${escape(data.generatedAt)} · ${escape(data.commit || "no git")}</p>
      <div class="next-lead"><strong>${ready}</strong> open path${ready === 1 ? "" : "s"} · ${items.length - ready} waiting on an explicit dependency or owner lock.</div>
      <figure class="next-figure">
        <figcaption>Next timeline · Source: STAND.md#Nächster Griff</figcaption>
        <ol class="next-timeline">${nodes}</ol>
      </figure>
    `;
  }

  // Static Lessons page: the memory as of the snapshot, readable without the
  // app. Search and tag filter run in the browser; feedback needs Live.
  function renderLessonsPage(data, el) {
    const lessons = data.lessons || [];
    const stats = data.lessonStats || { count: lessons.length, hits: 0, tags: [] };
    const byLabel = {};
    for (const l of lessons) byLabel[l.badges?.label || "new"] = (byLabel[l.badges?.label || "new"] || 0) + 1;
    el.innerHTML = `
      <p class="meta">from docs/dev-hq/lessons.json · ${escape(data.generatedAt)} · ${escape(data.commit || "no git")}</p>
      <section class="summary-strip">
        <div class="summary-item"><strong>${stats.count}</strong><span>lessons</span><small>known errors</small></div>
        <div class="summary-item"><strong>${stats.hits}</strong><span>sightings</span><small>times applied or seen again</small></div>
        <div class="summary-item"><strong>${byLabel.proven || 0}</strong><span>proven</span><small>fix confirmed ≥ 2×</small></div>
        <div class="summary-item"><strong>${(byLabel.disputed || 0) + (byLabel.stale || 0)}</strong><span>to review</span><small>disputed or stale</small></div>
      </section>
      <p class="brief-copy">Search before you debug; record after you fix. From the shell: <code>npm run hq:lesson -- search "&lt;error&gt;"</code>, <code>… worked &lt;id&gt;</code> / <code>… failed &lt;id&gt;</code> after applying a fix, <code>… brief "&lt;query&gt;"</code> for a prompt block. Feedback and refinement buttons live on the <a class="text-link" href="./live.html">Live</a> page.</p>
      <div class="lesson-toolbar">
        <div class="lesson-search-row"><input id="lesson-query" class="fleet-filter" placeholder="search symptom, cause, fix or tag…" aria-label="Search lessons"><select id="lesson-sort" aria-label="Sort lessons"><option value="hits">most seen</option><option value="recent">most recent</option><option value="confidence">best confidence</option></select></div>
        <div id="lesson-tags" class="lesson-tags">${stats.tags.slice(0, 20).map((t) => `<button type="button" class="lesson-tag" data-lesson-tag="${escape(t.tag)}">${escape(t.tag)} <em>${t.count}</em></button>`).join("")}</div>
        <p id="lesson-summary" class="muted"></p>
      </div>
      <div id="static-lessons" class="live-list"></div>`;
    const tokens = (text) => String(text || "").toLowerCase().split(/[^a-z0-9äöüß_./:-]+/i).map((t) => t.replace(/^[./:-]+|[./:-]+$/g, "")).filter((t) => t.length > 1);
    let query = "";
    const paint = () => {
      const terms = tokens(query);
      const sort = el.querySelector("#lesson-sort").value;
      let rows = lessons.map((l) => {
        if (!terms.length) return { l, score: 1 };
        const hay = new Set([...tokens(l.symptom), ...tokens(l.cause), ...tokens(l.fix), ...(l.tags || []).map((t) => t.toLowerCase()), l.id.toLowerCase()]);
        let score = 0;
        for (const t of terms) { if (hay.has(t)) score += 2; else if ([...hay].some((h) => h.includes(t))) score += 1; }
        return { l, score };
      }).filter((r) => r.score > 0);
      if (sort === "hits") rows.sort((a, b) => b.score - a.score || (b.l.hits || 0) - (a.l.hits || 0));
      else if (sort === "recent") rows.sort((a, b) => String(b.l.lastSeen).localeCompare(String(a.l.lastSeen)));
      else rows.sort((a, b) => ((b.l.badges?.confidence ?? -1) - (a.l.badges?.confidence ?? -1)) || (b.l.hits || 0) - (a.l.hits || 0));
      el.querySelector("#lesson-summary").textContent = `${rows.length} of ${lessons.length} shown`;
      el.querySelector("#static-lessons").innerHTML = rows.length ? rows.map((r) => lessonCard(r.l, { query })).join("") : `<p class="muted">No lesson matches “${escape(query)}”.</p>`;
      el.querySelectorAll(".lesson-tag").forEach((b) => b.classList.toggle("active", b.dataset.lessonTag === query));
    };
    el.querySelector("#lesson-query").addEventListener("input", (event) => { query = event.target.value.trim(); paint(); });
    el.querySelector("#lesson-sort").addEventListener("change", paint);
    el.querySelector("#lesson-tags").addEventListener("click", (event) => {
      const tag = event.target.closest("[data-lesson-tag]");
      if (!tag) return;
      query = query === tag.dataset.lessonTag ? "" : tag.dataset.lessonTag;
      el.querySelector("#lesson-query").value = query;
      paint();
    });
    paint();
  }

  function renderSources(data, el) {
    const rows = (data.sources || [])
      .map(
        (s) => `<tr>
          <td class="path">${escape(s.path)}</td>
          <td class="cite">${escape(s.sha256)}</td>
        </tr>`,
      )
      .join("");
    el.innerHTML = `
      <p class="meta">generate-time snapshot · ${escape(data.generatedAt)} · ${escape(data.commit || "no git")}</p>
      <div class="source-callout"><strong>${(data.sources || []).length} source files</strong> were hashed into this snapshot. ${data.dirty ? "The source worktree was dirty when it was generated." : "The source worktree was clean when it was generated."}</div>
      <div class="table-wrap">
        <table class="spec-table">
          <thead><tr><th scope="col">path</th><th scope="col">sha256</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="outbound">
        <a href="../../STAND.md">STAND.md</a>
        <a href="../PLAN.md">docs/PLAN.md</a>
        <a href="../ui-variants/index.html">docs/ui-variants</a>
      </p>
    `;
  }

  function drawLanes(host, data) {
    if (!host) return;
    const specs = data.specs || [];
    const serial = specs.filter((s) => s.lane === "serial");
    const parallel = specs.filter((s) => s.lane !== "serial");
    const startable = startableMap(data);

    const NS = "http://www.w3.org/2000/svg";
    const nodeW = 168;
    const nodeH = 34;
    const gap = 16;
    const lockGap = 78;
    const padL = 92;
    const padT = 6;
    const rowH = 58;
    const trackLabelW = 84;

    function trackWidth(nodes, withLocks) {
      if (nodes.length === 0) return trackLabelW;
      let w = padL;
      for (let i = 0; i < nodes.length; i++) {
        if (i > 0) {
          const prev = nodes[i - 1];
          const cur = nodes[i];
          const locked = withLocks && serialLockBetween(prev, cur, startable);
          w += locked ? lockGap : gap;
        }
        w += nodeW;
      }
      return w + 12;
    }

    const width = Math.max(
      640,
      trackWidth(serial, true),
      trackWidth(parallel, false),
    );
    const height = padT + rowH * 2 + 10;

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", String(height));
    svg.setAttribute("class", "lane-svg");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      "Lane occupancy: SERIAL and PARALLEL tracks from STAND.md",
    );

    function addText(parent, x, y, text, className, anchor) {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", String(x));
      t.setAttribute("y", String(y));
      if (className) t.setAttribute("class", className);
      if (anchor) t.setAttribute("text-anchor", anchor);
      t.textContent = text;
      parent.appendChild(t);
      return t;
    }

    function drawTrack(label, nodes, y, withLocks) {
      const track = document.createElementNS(NS, "rect");
      track.setAttribute("x", "0");
      track.setAttribute("y", String(y - 10));
      track.setAttribute("width", String(width - 8));
      track.setAttribute("height", String(nodeH + 20));
      track.setAttribute("rx", "3");
      track.setAttribute("class", "lane-track");
      svg.appendChild(track);
      addText(svg, 8, y + nodeH / 2 + 5, label, "lane-label", "start");

      let x = padL;
      for (let i = 0; i < nodes.length; i++) {
        const spec = nodes[i];
        if (i > 0) {
          const prev = nodes[i - 1];
          const showLock = withLocks && serialLockBetween(prev, spec, startable);
          if (showLock) {
            const mid = x + lockGap / 2;
            const g = document.createElementNS(NS, "g");
            g.setAttribute("class", "lock");
            const line = document.createElementNS(NS, "line");
            line.setAttribute("x1", String(x + 4));
            line.setAttribute("y1", String(y + nodeH / 2));
            line.setAttribute("x2", String(x + lockGap - 4));
            line.setAttribute("y2", String(y + nodeH / 2));
            line.setAttribute("class", "lock-line");
            g.appendChild(line);
            addText(g, mid, y + 12, "lock", "lock-label", "middle");
            addText(
              g,
              mid,
              y + nodeH - 2,
              spec.serialOwner,
              "lock-owner",
              "middle",
            );
            svg.appendChild(g);
            x += lockGap;
          } else {
            const line = document.createElementNS(NS, "line");
            line.setAttribute("x1", String(x));
            line.setAttribute("y1", String(y + nodeH / 2));
            line.setAttribute("x2", String(x + gap));
            line.setAttribute("y2", String(y + nodeH / 2));
            line.setAttribute("class", "lane-edge");
            svg.appendChild(line);
            x += gap;
          }
        }

        const g = document.createElementNS(NS, "g");
        g.setAttribute(
          "class",
          `${spec.lane === "serial" ? "lane-node serial" : "lane-node parallel"}${spec.startable === false ? " locked" : ""}`,
        );
        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", String(x));
        rect.setAttribute("y", String(y));
        rect.setAttribute("width", String(nodeW));
        rect.setAttribute("height", String(nodeH));
        rect.setAttribute("rx", "2");
        g.appendChild(rect);
        const title = document.createElementNS(NS, "title");
        title.textContent = `${spec.file} · ${spec.lane} · ${spec.source}`;
        g.appendChild(title);
        const label = laneLabel(spec.file);
        const text = addText(
          g,
          x + nodeW / 2,
          y + nodeH / 2 + 5,
          label,
          "lane-node-label",
          "middle",
        );
        // Never let a long spec name run past its box: shrink-to-fit is done
        // by the renderer, the full path stays in <title>.
        if (label.length > 22) {
          text.setAttribute("textLength", String(nodeW - 16));
          text.setAttribute("lengthAdjust", "spacingAndGlyphs");
        }
        svg.appendChild(g);
        x += nodeW;
      }
    }

    drawTrack("SERIAL", serial, padT, true);
    drawTrack("PARALLEL", parallel, padT + rowH, false);

    host.replaceChildren(svg);
  }

  renderChrome(window.HQ_DATA);
  if (page === "live") {
    renderLive(window.HQ_DATA, mount);
  } else if (page === "now") {
    renderNow(window.HQ_DATA, mount);
  } else if (page === "map") {
    renderMap(window.HQ_DATA, mount);
  } else if (page === "proof") {
    renderProof(window.HQ_DATA, mount);
  } else if (page === "next") {
    renderNext(window.HQ_DATA, mount);
  } else if (page === "sources") {
    renderSources(window.HQ_DATA, mount);
  } else if (page === "lessons") {
    renderLessonsPage(window.HQ_DATA, mount);
  }
})();
