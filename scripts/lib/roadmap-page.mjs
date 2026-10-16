import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Pure renderer: buildRoadmap output (plus optional releases/findings/changes) in, one standalone HTML string out.
// It shows what it is given and recomputes nothing (no forecast, no state, no version, no date).
const UNKNOWN = "Unbekannt", STALE_MS = 12 * 3600000, LIMIT = { haengt: 3, cards: 7, releases: 5, findings: 3, changes: 5 };
const designCss = (file) => readFileSync(new URL(`../../src/design/${file}`, import.meta.url), "utf8");
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const t = (s) => esc(s == null || s === "" ? UNKNOWN : s);
const arr = (x) => (Array.isArray(x) ? x : []);
// Same six words and forms as src/i18n/de.ts and state.css; any other word is drawn as Unbekannt.
const FORM = new Map([["Läuft", "run"], ["Braucht dich", "need"], ["In Prüfung", "rev"], ["Bereit zum Mergen", "ok"], ["Erledigt", "done"], ["Fehler", "bad"]]);
const chip = (word) => `<span class="g-st g-st--${FORM.get(word) ?? "unknown"}">${t(word)}</span>`;
const KIND = new Map(Object.entries({ "duplicate-id": "ID doppelt", "pr-without-plan-row": "Offener PR ohne Planzeile", "status-contradicts-github": "Status widerspricht GitHub", "unknown-dependency": "Unbekannte Abhängigkeit", "dependency-cycle": "Abhängigkeits-Zyklus", "running-job-without-row": "Laufender Job ohne Planzeile", "decision-without-plan-row": "Entscheidung ohne Planzeile", "plan-stale": "Plan veraltet" }));

const dl = (rows) => `<dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
const sec = (id, title, body) => `<section class="panel" id="${id}" aria-labelledby="${id}-h"><h2 id="${id}-h">${title}</h2>${body}</section>`;
const todo = (what) => `<p class="note">noch nicht verbunden: ${what} wurde nicht übergeben. Das heißt nicht, dass alles in Ordnung ist.</p>`;
// First `max` items inline, the rest behind a native details element: nothing is dropped.
const more = (items, max, html) => items.slice(0, max).map(html).join("") + (items.length > max ? `<li><details class="more"><summary>weitere ${items.length - max} anzeigen</summary><ul>${items.slice(max).map(html).join("")}</ul></details></li>` : "");
const list = (items, max, html, empty) => (items.length ? `<ul>${more(items, max, html)}</ul>` : `<p class="note">${empty}</p>`);
const src = (s) => (s?.line == null ? `${t(s?.file)} (Zeile unbekannt)` : `${t(s.file)}:${t(s.line)}`);
const hasForecast = (f) => f && typeof f === "object" && Number.isFinite(f.fromDays) && Number.isFinite(f.toDays);
const forecast = (f) => (hasForecast(f) ? `${t(f.label ?? "Prognose, keine Zusage")}: ${f.fromDays}–${f.toDays} Tage${Number.isFinite(f.merged) ? ` (Basis: ${f.merged} Merges in 7 Tagen)` : ""}` : "Prognose: zu wenig Daten");

const SCRIPT = `const root = document.documentElement, ask = (id) => document.getElementById(id);
document.querySelectorAll("[data-js]").forEach((el) => { el.hidden = false; });
ask("theme").onchange = (e) => (e.target.value ? (root.dataset.theme = e.target.value) : delete root.dataset.theme);
ask("dir").onchange = (e) => {
  document.querySelectorAll("[data-dir]").forEach((el) => { el.hidden = Boolean(e.target.value) && el.dataset.dir !== e.target.value; });
  if (e.target.value) document.querySelectorAll(".rest").forEach((el) => { el.open = true; });
  document.querySelectorAll(".more").forEach((el) => {
    if (!el.querySelector("[data-dir]")) return;
    const hits = el.querySelectorAll(":scope > ul > li:not([hidden])").length;
    el.parentElement.hidden = !hits;
    el.open = Boolean(e.target.value) && hits > 0;
    el.firstElementChild.textContent = "weitere " + hits + " anzeigen";
  });
};`;
const CSS = `
*{box-sizing:border-box}
body{margin:0;background:var(--g-ground);color:var(--g-ink);font:15px/1.5 var(--g-font-sans);overflow-wrap:anywhere;background-image:radial-gradient(48rem 24rem at 8% -6%,var(--g-amb1),transparent),radial-gradient(40rem 22rem at 100% 0,var(--g-amb2),transparent)}
main{max-width:76rem;margin:0 auto;padding:var(--g-pad)}
h1{font-size:1.75rem;margin:.25rem 0}h2{font-size:1.15rem;margin:0 0 .6rem}h3{display:inline;font-size:1rem;margin:0}
h4{margin:.2rem 0 .4rem;color:var(--g-muted);font-size:.78rem;letter-spacing:.05em;text-transform:uppercase}
p{margin:.4rem 0}ul,ol{list-style:none;margin:0;padding:0}li{margin:.35rem 0}code,time{font-family:var(--g-font-mono)}a{color:var(--g-accent)}
.panel{background:var(--g-content-bg);-webkit-backdrop-filter:var(--g-content-blur);backdrop-filter:var(--g-content-blur);border:1px solid var(--g-line);border-radius:var(--g-r-panel);box-shadow:var(--g-spec),var(--g-shadow);padding:var(--g-pad);margin:1rem 0}
.note,.muted,dt{color:var(--g-muted)}
.banner{background:var(--g-tint-hi);border:1px solid var(--g-line);border-radius:var(--g-r-ctl);padding:.5rem .75rem;font-weight:600}
nav ul{display:flex;flex-wrap:wrap;gap:.25rem .75rem}nav a,select{min-height:24px;display:inline-flex;align-items:center}
select{font:inherit;color:inherit;background:var(--g-tint-hi);border:1px solid var(--g-line);border-radius:var(--g-r-ctl);padding:0 .5rem}
.nums{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem;margin:.75rem 0}
.nums div{background:var(--g-tint);border:1px solid var(--g-hair);border-radius:var(--g-r-card);padding:.5rem .75rem}
.nums dt{font-size:.8rem}.nums dd{margin:0;font-size:1.4rem;font-weight:600}
.card{border:1px solid var(--g-hair);border-radius:var(--g-r-card);background:var(--g-tint)}
summary{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;min-height:24px;padding:.35rem .6rem;cursor:pointer;list-style:none}
summary::-webkit-details-marker{display:none}summary::before{content:"▸";color:var(--g-faint)}details[open]>summary::before{content:"▾"}
.goal{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{border:1px solid var(--g-line);border-radius:999px;padding:0 .5rem;font-size:.75rem;color:var(--g-muted)}
.facts{display:grid;grid-template-columns:minmax(0,max-content) minmax(0,1fr);gap:.2rem .75rem;margin:0;padding:.25rem .75rem .6rem}.facts dd{margin:0}
.belt{border-left:2px solid var(--g-line);margin-left:.4rem}.belt>li{position:relative;margin:0;padding:.3rem 0 .3rem 1rem}
.belt>li::before{content:"";position:absolute;left:-7px;top:.8rem;width:12px;height:12px;border-radius:50%;background:var(--g-ground);border:2px solid var(--g-faint)}
.belt>.next{border:1px dashed var(--g-line);border-left:0;border-radius:0 var(--g-r-ctl) var(--g-r-ctl) 0}
.cols,.levels{display:grid;gap:.75rem;grid-template-columns:minmax(0,1fr)}.cols>*,.levels>*{min-width:0}
.levels>section{border-top:2px solid var(--g-line);padding-top:.4rem}.dir{border-top:1px solid var(--g-line);margin-top:.5rem}
:focus-visible{outline:2px solid var(--g-accent);outline-offset:2px}
[hidden]{display:none!important}
@media(min-width:40rem){.nums{grid-template-columns:repeat(4,minmax(0,1fr))}.levels{grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))}}
@media(min-width:56rem){.cols{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(pointer:coarse){summary,nav a,select{min-height:44px}}
@media(prefers-reduced-motion:no-preference){summary{transition:background-color .15s}summary:hover{background:var(--g-tint-hi)}}`;
const SECTIONS = [["haengt", "Hängt"], ["zeitleiste", "Zeitleiste"], ["richtungen", "Richtungen"], ["abhaengigkeiten", "Abhängigkeiten"], ["plan-maengel", "Plan-Mängel"], ["plan-aenderungen", "Plan-Änderungen"]];
const styleSafe = (css) => String(css).replace(/<\/(style)/gi, "<\\/$1");

/** data = buildRoadmap output; options = { tokensCss, stateCss, releases, findings, changes, now }. */
export function renderRoadmap(data, options = {}) {
  if (!data || typeof data !== "object") throw new TypeError("renderRoadmap needs the buildRoadmap result");
  const { tokensCss = designCss("tokens.css"), stateCss = designCss("state/state.css"), releases, findings, changes, now } = options;
  const stand = data.stand ?? {}, head = data.head ?? {}, packages = arr(data.packages), directions = arr(data.directions);
  const byId = new Map(packages.map((p) => [p.id, p]));

  // A missing or unparsable options.now falls back to the real clock: the staleness warning must never switch itself off.
  const given = new Date(now ?? Date.now()).getTime(), clock = Number.isFinite(given) ? given : Date.now();
  const known = Number.isFinite(Date.parse(stand.generatedAt)), trusted = known && packages.length > 0;
  const banner = !packages.length ? "Der Plan kam leer oder nicht lesbar an. Die Zahlen sind kein Beleg."
    : !known ? "Der Zeitpunkt des Stands ist unbekannt. Die Zahlen können überholt sein."
    : clock - Date.parse(stand.generatedAt) > STALE_MS ? "Stand veraltet: älter als 12 Stunden. Die Zahlen können überholt sein." : "";
  const version = trusted && head.nextVersion && head.nextVersion !== UNKNOWN;
  const sentence = !packages.length ? "Ohne lesbaren Plan gibt es keine Aussage zur Roadmap."
    : `${version ? `Die nächste Version ist ${t(head.nextVersion)}` : "Die nächste Version ist noch unbekannt"}. ${directions.some((d) => hasForecast(d.forecast)) ? "Prognosen stehen je Richtung weiter unten, sie sind keine Zusage." : "Ein Datum gibt es noch nicht: zu wenig Daten für eine Prognose."}`;
  const nums = [["Nächste Version", head.nextVersion], ["Offene Paket-PRs", head.open], ["Schritte von dir", head.yourSteps], ["Blocker", head.blockers]]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${trusted ? t(v) : UNKNOWN}</dd></div>`).join("");

  const stateChip = (p) => (p.state ? chip(p.state) : /In Arbeit|In Prüfung/.test(p.planStatus) ? chip(null) : "");
  const card = (p, deps = false) => `<li data-dir="${esc(p.direction ?? "")}"><details class="card"><summary>${stateChip(p)}<b>${t(p.id)}</b><span class="goal">${t(p.title)}</span>${p.parked ? '<span class="tag">Verschoben</span>' : ""}${deps && arr(p.deps).length ? `<span class="muted">← ${p.deps.map((id) => t(id)).join(", ")}</span>` : ""}</summary>${dl([
    ["Ziel", t(p.title)], ["Zustand", p.state ? t(p.state) : p.planStatus ? `${UNKNOWN} (${t(p.planStatus)})` : UNKNOWN], ["Wer", t(p.owner)],
    ["Richtung", t(p.direction) + (p.provisional ? " (vorläufig, aus der ID)" : "")], ["Version", t(p.version)], ["Ebene", p.level == null ? "Zyklus oder unbekannt" : t(p.level)],
    ["Hängt ab von", arr(p.deps).length ? p.deps.map((id) => (byId.has(id) ? t(id) : `${t(id)} (nicht im Plan)`)).join(", ") : "nichts angegeben"],
    ["Quelle", `<code>${src(p.source)}</code>`], ["PR", p.pr == null ? "keiner bekannt" : `#${t(p.pr)}`]])}</details></li>`;
  const row = (h) => `<li><details class="card"><summary>${h.blocker ? '<span class="tag">Blocker</span>' : ""}<b>${t(h.id)}</b><span class="goal">${t(h.what)}</span><span class="muted">${t(h.who)}</span></summary>${dl([
    ["Was hängt", t(h.what)], ["Wer", t(h.who)], ["Was muss sich ändern", t(h.change)], ["Wann", t(h.when)], ["Wo", t(h.where)]])}</details></li>`;
  const lane = (d) => {
    const [now_, next, later] = [d.now, d.next, d.later].map(arr), own = packages.filter((p) => p.direction === d.name), done = own.filter((p) => p.finished);
    const col = (title, ids) => `<section><h4>${title}</h4>${list(ids, LIMIT.cards, (id) => card(byId.get(id) ?? { id, direction: d.name }), "Gerade nichts")}</section>`;
    return `<section class="dir" data-dir="${esc(d.name)}"><details${now_.length ? " open" : ""}><summary><h3>${t(d.name)}</h3><span class="muted">noch ${now_.length + next.length + later.length} Pakete · ${forecast(d.forecast)}${own.some((p) => p.provisional) ? " · vorläufig" : ""}</span></summary>
<div class="cols">${col("Jetzt", now_)}${col("Als Nächstes", next)}${col("Später", later)}</div>${done.length ? `<details><summary>${done.length} erledigt</summary><ul>${done.map((p) => card(p)).join("")}</ul></details>` : ""}</details></section>`;
  };

  const active = directions.filter((d) => arr(d.now).length), resting = directions.filter((d) => !arr(d.now).length);
  const open = packages.filter((p) => !p.finished), levels = [...new Set(open.map((p) => p.level ?? null))].sort((a, b) => (a ?? 1e9) - (b ?? 1e9));
  const published = arr(releases).filter((r) => !r.isDraft).sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
  const unversioned = open.filter((p) => !p.version || p.version === UNKNOWN).length;
  const defect = (f) => `<li><b>${t(KIND.get(f.kind) ?? f.kind)}</b> ${t(f.id)} · ${t(f.detail)} · <code>${src(f)}</code>${f.pr == null ? "" : ` · PR #${t(f.pr)}`}</li>`;

  const body = [
    sec("haengt", "Hängt", list(arr(data.haengt), LIMIT.haengt, row, "Gerade nichts gemeldet.")),
    sec("zeitleiste", "Zeitleiste", `<ol class="belt"><li class="next"><b>Nächste Version: ${t(head.nextVersion)}</b> · Datum: ${UNKNOWN} (zu wenig Daten)</li>
${unversioned ? `<li>Version offen: ${unversioned} offene Pakete ohne Version</li>` : ""}${more(published, LIMIT.releases, (r) => `<li>${t(r.tagName)} · ${t(r.publishedAt)}${r.isPrerelease ? " · Vorabversion" : ""}</li>`)}</ol>
${releases == null ? todo("die Release-Liste") : published.length ? "" : '<p class="note">Keine veröffentlichten Releases in den gelieferten Daten.</p>'}`),
    sec("richtungen", "Richtungen", `<p data-js hidden><label>Richtung <select id="dir"><option value="">Alle</option>${directions.map((d) => `<option>${t(d.name)}</option>`).join("")}</select></label> <span class="note">gilt für Richtungen und Abhängigkeiten, nicht für die Zahlen oben</span></p>
${directions.length ? active.map(lane).join("") + (resting.length ? `<details class="rest"><summary>${resting.length} ${resting.length === 1 ? "Richtung ruht" : "Richtungen ruhen"} (nichts in „Jetzt“)</summary>${resting.map(lane).join("")}</details>` : "") : '<p class="note">Keine Richtungen in den Daten.</p>'}`),
    sec("abhaengigkeiten", "Abhängigkeiten", open.length ? `<p class="note">Erledigte Pakete stehen in ihrer Richtung unter „erledigt“.</p><div class="levels">${levels.map((lv) => `<section><h3>${lv == null ? "Zyklus oder ohne Ebene" : `Ebene ${t(lv)}`}</h3>${list(open.filter((p) => (p.level ?? null) === lv), LIMIT.cards, (p) => card(p, true), "")}</section>`).join("")}</div>` : '<p class="note">Gerade nichts</p>'),
    sec("plan-maengel", "Plan-Mängel", findings == null ? todo("das Ergebnis der Plan-Prüfung") : `${arr(findings).length ? `<p><b>${arr(findings).length}</b> Befunde</p>` : ""}${list(arr(findings), LIMIT.findings, defect, "Keine Mängel gefunden.")}`),
    sec("plan-aenderungen", "Plan-Änderungen", changes == null ? todo("die Änderungsliste des Plans") : list(arr(changes), LIMIT.changes, (c) => `<li><time>${t(c.date)}</time> ${t(c.text ?? c.subject)}</li>`, "Keine Änderungen geliefert.")),
  ].join("\n");

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${createHash("sha256").update(SCRIPT).digest("base64")}'">
<title>Roadmap</title><style>${[tokensCss, stateCss, CSS].map(styleSafe).join("\n")}</style></head>
<body><main><header class="panel"><h1>Roadmap</h1><p>${sentence}</p>${banner ? `<p class="banner" role="status">${banner}</p>` : ""}
<dl class="nums">${nums}</dl>
<p class="muted">Stand <time${known ? ` datetime="${esc(stand.generatedAt)}"` : ""}>${t(stand.generatedAt)}</time> · main <code>${t(stand.mainSha)}</code></p>
<p data-js hidden><label>Darstellung <select id="theme"><option value="">System</option><option value="light">Hell</option><option value="dark">Dunkel</option></select></label></p>
<nav aria-label="Abschnitte"><ul>${SECTIONS.map(([id, title]) => `<li><a href="#${id}">${title}</a></li>`).join("")}</ul></nav></header>
${body}</main><script>${SCRIPT}</script></body></html>
`;
}
