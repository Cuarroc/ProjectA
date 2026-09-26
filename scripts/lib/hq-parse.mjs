// scripts/lib/hq-parse.mjs — excerpt; keep helpers in this file
export function applySpecStartable(specs) {
  const seenOwner = new Set();
  return specs.map((s) => {
    let startable = true;
    if (s.serialOwner) {
      startable = !seenOwner.has(s.serialOwner);
      seenOwner.add(s.serialOwner);
    }
    return { ...s, startable };
  });
}

export function parseNextGrip(standText) {
  const zeilen = standText.split(/\r?\n/);
  const start = zeilen.findIndex((z) => /Nächster Griff/i.test(z) && /^#{2,4}\s/.test(z));
  if (start === -1) return [];
  const items = [];
  let cur = null;
  for (const z of zeilen.slice(start + 1)) {
    if (/^#{1,4}\s/.test(z)) {
      if (cur) items.push(cur);
      break;
    }
    const m = z.match(/^(\d+)\.\s+(.*)$/);
    if (m) {
      if (cur) items.push(cur);
      cur = { text: m[2], source: "STAND.md#Nächster Griff" };
      continue;
    }
    if (!cur) continue;
    if (z.trim() === "") {
      items.push(cur);
      cur = null;
      continue;
    }
    if (/^\s/.test(z)) {
      cur.text += " " + z.trim();
      continue;
    }
    items.push(cur);
    cur = null;
    break;
  }
  if (cur) items.push(cur);
  if (items.length) return items;
  return parseProseGrip(zeilen, start);
}

function parseProseGrip(zeilen, start) {
  const items = [];
  let cur = null;
  for (const z of zeilen.slice(start + 1)) {
    if (/^#{1,4}\s/.test(z)) {
      if (cur) items.push(cur);
      break;
    }
    const m = z.match(/^Nächster Griff:\s*(.*)$/i);
    if (m) {
      if (cur) items.push(cur);
      cur = { text: m[1].trim(), source: "STAND.md#Nächster Griff" };
      continue;
    }
    const planGrip = z.match(/^\*{0,2}Nächste Griffe aus §11[^:]*:\s*(.*)$/i);
    if (planGrip) {
      if (cur) items.push(cur);
      cur = { text: planGrip[1].trim(), source: "STAND.md#Nächster Griff" };
      continue;
    }
    if (!cur) continue;
    if (z.trim() === "") {
      items.push(cur);
      cur = null;
      continue;
    }
    cur.text += (cur.text ? " " : "") + z.trim();
  }
  if (cur) items.push(cur);
  return items.filter((i) => i.text);
}

function parseLaneCell(laneCell) {
  const serial = /\bseriell\b/i.test(laneCell);
  const owners = [...laneCell.matchAll(/`([^`]+\.rs)`/g)].map((m) => m[1]);
  return {
    lane: serial ? "serial" : "parallel",
    serialOwner: serial ? (owners[0] ?? null) : null,
  };
}

export function parseSpecTable(standText, executableNames) {
  const allowed = new Set(executableNames);
  const specs = [];
  const zeilen = standText.split(/\r?\n/);
  const start = zeilen.findIndex((z) => /Aktive Specs/i.test(z) && /^#{2,4}\s/.test(z));
  const scope = start === -1 ? zeilen : zeilen.slice(start + 1);
  for (const zeile of scope) {
    if (start !== -1 && /^#{1,4}\s/.test(zeile)) break;
    const m = zeile.match(
      /\|\s*`?\.pa\/(task_[A-Za-z0-9_.-]+\.md)`?\s*\|\s*([^|]+)\|\s*([^|]+)\|/,
    );
    if (!m || !allowed.has(m[1])) continue;
    const { lane, serialOwner } = parseLaneCell(m[3]);
    specs.push({
      file: `.pa/${m[1]}`,
      title: m[2].trim(),
      packet: m[2].trim(),
      lane,
      serialOwner,
      status: "aktiv",
      source: "STAND.md#Aktive Specs",
    });
  }
  return specs;
}

function matchSpecsForGrip(item, specs) {
  const byFile = specs.filter((s) => item.text.includes(s.file));
  if (byFile.length) return byFile;
  const matched = [];
  if (item.text.toLowerCase().includes("single-instance")) {
    const s = specs.find((spec) => spec.file.includes("single_instance"));
    if (s) matched.push(s);
  }
  if (/diagnostic/i.test(item.text)) {
    const s = specs.find((spec) => spec.file.includes("diagnostics"));
    if (s) matched.push(s);
  }
  if (/attention/i.test(item.text)) {
    const s = specs.find(
      (spec) => spec.file.includes("attention") || /attention/i.test(spec.packet),
    );
    if (s && !matched.includes(s)) matched.push(s);
  }
  if (/\bF8\b/i.test(item.text) || /f8-isolated/i.test(item.text) || /golden path/i.test(item.text)) {
    const s = specs.find((spec) => spec.file.includes("task_f8"));
    if (s && !matched.includes(s)) matched.push(s);
  }
  return matched;
}

function packageUnmetDeps(packetHint, packages) {
  if (!packages?.length) return false;
  const id = longestPackageIdIn(packetHint);
  if (!id) return false;
  const pkg = packages.find((p) => p.id === id);
  if (!pkg) return false;
  return pkg.dependsOn.some((dep) => {
    const d = packages.find((p) => p.id === dep);
    return d && d.current === "waiting";
  });
}

export function buildNext(nextGrip, specs, packages = []) {
  const seenOwner = new Set();
  const next = [];
  for (const item of nextGrip) {
    const matched = matchSpecsForGrip(item, specs);
    const entries = matched.length
      ? matched.map((spec) => ({ spec, why: item.text, source: item.source }))
      : [{ spec: null, why: item.text, source: item.source }];
    for (const { spec, why, source } of entries) {
      const serialOwner = spec?.serialOwner ?? null;
      let startable = true;
      if (serialOwner) {
        startable = !seenOwner.has(serialOwner);
        seenOwner.add(serialOwner);
      }
      const packetHint = spec?.packet ?? why;
      if (packageUnmetDeps(packetHint, packages)) startable = false;
      next.push({
        packet: spec?.packet ?? why.slice(0, 48),
        why,
        source,
        lane: spec?.lane ?? (serialOwner ? "serial" : "parallel"),
        serialOwner,
        doneWhen: spec?.file ?? why,
        startable,
      });
    }
  }
  return next;
}

const PACKAGE_EDGES = [
  { id: "F0", dependsOn: [], lane: "serial" },
  { id: "F1", dependsOn: ["F0"], lane: "serial" },
  { id: "F2", dependsOn: ["F0"], lane: "parallel" },
  { id: "F3", dependsOn: ["F1", "F2"], lane: "parallel" },
  { id: "F4", dependsOn: ["F1"], lane: "serial" },
  { id: "F5", dependsOn: ["F4"], lane: "serial" },
  { id: "F6-UI", dependsOn: ["F2"], lane: "parallel" },
  { id: "F6-Attribution", dependsOn: ["F4"], lane: "serial" },
  { id: "F7", dependsOn: [], lane: "incremental" },
  { id: "F8", dependsOn: ["F5", "F6-UI", "F3", "F6-Attribution"], lane: "parallel" },
];

const PACKAGE_IDS_LONGEST_FIRST = [...PACKAGE_EDGES.map((p) => p.id)].sort(
  (a, b) => b.length - a.length,
);

function longestPackageIdIn(packet) {
  const p = packet.trim();
  for (const id of PACKAGE_IDS_LONGEST_FIRST) {
    if (p === id) return id;
    if (p.startsWith(id) && (p.length === id.length || /[:\s-]/.test(p.charAt(id.length)))) {
      return id;
    }
  }
  // Bare F6: / F6  is not a DAG node; pin occupancy on F6-UI (Grok r3 I-F).
  if (/^F6(?!-)/.test(p)) return "F6-UI";
  return null;
}

export function buildPackages(standText, specs) {
  const activePackets = new Set(
    specs.flatMap((s) => {
      const id = longestPackageIdIn(s.packet);
      return id ? [id] : [];
    }),
  );
  return PACKAGE_EDGES.map((p) => {
    let current = "waiting";
    if (p.id === "F0" && /F0 ist abgeschlossen/i.test(standText)) current = "done";
    else if (activePackets.has(p.id) || (p.id.startsWith("F1") && activePackets.has("F1"))) {
      current = "active";
    }
    return { ...p, current, source: "docs/PLAN.md" };
  });
}

const tableCells = (line) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());

// "Stand" cell of a PLAN.md milestone table → done | pr | in_progress | open.
// "✓ #n" = merged; a cell that mixes merged and pending sub-packages
// ("10a ✓ #13, 10c offen") counts as in progress.
function milestoneState(stand) {
  if (/^in Arbeit|^dieses Paket/i.test(stand)) return "in_progress";
  if (/^PR #\d/.test(stand)) return "pr";
  if (!stand.includes("✓")) return "open";
  return /offen|PR #\d|in Arbeit/.test(stand) ? "in_progress" : "done";
}

/// The milestone sections "### M<n> — title" of docs/PLAN.md with their tables
/// (ID | Paket | Gr. | Lane | Stand). Other sections and tables are ignored.
export function parseMilestones(planText) {
  const lines = String(planText).split(/\r?\n/);
  const milestones = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^###\s+(M\d+)\s+[—–-]\s+(.+?)\s*$/);
    if (heading) {
      current = { id: heading[1], title: heading[2], packages: [], done: 0, total: 0 };
      milestones.push(current);
      continue;
    }
    if (/^#{1,3}\s/.test(lines[i])) {
      current = null;
      continue;
    }
    if (!current || !lines[i].startsWith("|") || !/^\|[-|: ]+\|\s*$/.test(lines[i + 1] || "")) continue;
    const head = tableCells(lines[i]);
    const col = (name) => head.indexOf(name);
    if (head[0] !== "ID" || col("Stand") === -1) continue;
    for (let j = i + 2; j < lines.length && lines[j].startsWith("|"); j++) {
      const c = tableCells(lines[j]);
      const stand = c[col("Stand")] ?? "";
      current.packages.push({
        id: c[0],
        title: (c[col("Paket")] ?? "").replace(/`|\*\*/g, ""),
        size: c[col("Gr.")] ?? "",
        lane: c[col("Lane")] ?? "",
        stand,
        state: milestoneState(stand),
        prNumbers: [...stand.matchAll(/#(\d+)/g)].map((m) => Number(m[1])),
      });
    }
  }
  for (const m of milestones) {
    m.total = m.packages.length;
    m.done = m.packages.filter((p) => p.state === "done").length;
  }
  return milestones;
}

function extractBehebungPacket(blockText) {
  const packetMatch = blockText.match(/Behebung in (F\d+\S*?)\s*(?:[.,;:]|$)/);
  return packetMatch ? packetMatch[1] : null;
}

const RESTORE_EVIDENCE = /restore-probe|\bpa db restore\b|\bpa restore\b/i;

function f0Klass(id, reportScope, reportF0, reportFiles = []) {
  if (!reportScope) return { klass: "CLAIM", source: "STAND.md" };
  if (id === "7") {
    const hit = reportFiles.find((f) => RESTORE_EVIDENCE.test(f.text));
    const blob = reportF0 || reportFiles.map((f) => f.text).join("\n");
    if (!hit && !RESTORE_EVIDENCE.test(blob)) {
      return { klass: "CLAIM", source: "STAND.md" };
    }
    return { klass: "FACT", source: hit?.path ?? ".pa/report_f0_7.md" };
  }
  return { klass: "FACT", source: ".pa/report_f0.md" };
}

export function parseFindings(standText, opts = {}) {
  const reportF0 = typeof opts === "string" ? opts : (opts.reportF0 ?? "");
  const reportFiles = typeof opts === "object" && Array.isArray(opts.reportFiles) ? opts.reportFiles : [];
  const warnings = typeof opts === "object" && Array.isArray(opts.warnings) ? opts.warnings : [];
  const zeilen = standText.split(/\r?\n/);
  const findings = [];
  let reportScope = false;
  const inSection4 = zeilen.findIndex((z) => /^#{2,4}\s.*Produktbefunde/.test(z));
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (inSection4 !== -1 && i < inSection4) {
      if (/report_f0\.md/.test(z)) continue;
    }
    if (/report_f0\.md/.test(z)) reportScope = true;
    const f0 = z.match(/\*\*F0-(\d+):(.+?)\*\*/);
    if (f0) {
      const text = f0[2].trim();
      const block = [z];
      for (let j = i + 1; j < zeilen.length; j++) {
        const nxt = zeilen[j];
        if (/^-\s+/.test(nxt) || /^#{1,4}\s/.test(nxt)) break;
        block.push(nxt);
      }
      const packet = extractBehebungPacket(block.join("\n"));
      const { klass, source } = f0Klass(f0[1], reportScope, reportF0, reportFiles);
      findings.push({
        id: `F0-${f0[1]}`,
        text,
        klass,
        source,
        packet,
        serialOwner: null,
      });
      continue;
    }
    if (/^\s*-\s+\*\*F0-\d+:/.test(z)) {
      warnings.push(`STAND.md: F0 finding did not parse: ${z.trim()}`);
    }
    const claim = z.match(
      /^-\s+((?:(?:NT|KI|P2)[-A-Z0-9]+)(?:\/(?:NT|KI|P2)[-A-Z0-9]+)*):\s+(.+)$/,
    );
    if (claim) {
      let text = claim[2].trim();
      for (let j = i + 1; j < zeilen.length; j++) {
        const nxt = zeilen[j];
        if (/^-\s+/.test(nxt) || /^#{1,4}\s/.test(nxt) || nxt.trim() === "") break;
        if (!/^\s/.test(nxt)) break;
        text += " " + nxt.trim();
      }
      findings.push({
        id: claim[1],
        text,
        klass: "CLAIM",
        source: "STAND.md",
        packet: null,
        serialOwner: null,
      });
    }
  }
  return findings.map((f) => (f.source ? f : { ...f, klass: "UNPROVEN" }));
}
