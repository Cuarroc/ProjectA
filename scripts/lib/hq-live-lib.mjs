// Shared logic for the live Dev HQ proxy (scripts/hq-live.mjs).
// Kept importable and side-effect free so node:test can drive it.
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";

const PROFILE_ID = /^[a-z0-9][a-z0-9-]*$/;

/// Progress over the milestone packages of docs/PLAN.md (done / all).
export function snapshotProgress(snapshot) {
  const milestones = snapshot?.milestones || [];
  const packagesDone = milestones.reduce((sum, m) => sum + m.done, 0);
  const packagesTotal = milestones.reduce((sum, m) => sum + m.total, 0);
  return { packagesDone, packagesTotal, percent: packagesTotal ? Math.round((packagesDone / packagesTotal) * 100) : 0 };
}

/// Validate one custom profile coming from the HQ UI.
/// Returns an error string, or null when the profile is acceptable.
export function validateProfile(profile) {
  if (!profile || typeof profile !== "object") return "profile must be an object";
  if (typeof profile.id !== "string" || !PROFILE_ID.test(profile.id)) {
    return "id must be lowercase letters, digits and dashes (e.g. claude-review)";
  }
  if (typeof profile.name !== "string" || !profile.name.trim()) return "name is required";
  if (typeof profile.command !== "string" || !profile.command.trim()) return "command is required";
  if (profile.args !== undefined && !Array.isArray(profile.args)) return "args must be an array";
  if (profile.env !== undefined && (typeof profile.env !== "object" || Array.isArray(profile.env))) {
    return "env must be an object of KEY: value pairs";
  }
  if (profile.fallback !== undefined && profile.fallback !== null && typeof profile.fallback !== "string") {
    return "fallback must be a profile id or null";
  }
  if (profile.briefing !== undefined) {
    if (!profile.briefing || typeof profile.briefing !== "object" || Array.isArray(profile.briefing)) return "briefing must be an object";
    for (const key of ["purpose", "role", "effort", "tools"]) {
      if (typeof profile.briefing[key] !== "string" || profile.briefing[key].length > 2000) return `briefing.${key} must be text up to 2000 characters`;
    }
  }
  return null;
}

/// Insert or replace one profile in an `agents.json` document.
/// Unknown fields such as `team` pass through: serde ignores them on read.
export function upsertProfile(doc, profile) {
  const profiles = Array.isArray(doc?.profiles) ? [...doc.profiles] : [];
  const index = profiles.findIndex((existing) => existing.id === profile.id);
  const existing = index >= 0 ? profiles[index] : null;
  const entry = {
    // Preserve fields the HQ form doesn't expose (e.g. `caps`) by starting
    // from the existing entry — otherwise editing any visible field silently
    // dropped everything the form doesn't round-trip.
    ...(existing || {}),
    ...(profile.caps !== undefined ? { caps: structuredClone(profile.caps) } : {}),
    id: profile.id,
    name: profile.name.trim(),
    command: profile.command.trim(),
    args: (profile.args || []).map(String),
    env: Object.fromEntries(
      Object.entries(profile.env || {}).map(([key, value]) => [String(key), String(value)]),
    ),
    fallback: profile.fallback || null,
    ...(profile.team ? { team: String(profile.team) } : {}),
    ...(profile.briefing ? { briefing: Object.fromEntries(["purpose", "role", "effort", "tools"].map(key => [key, profile.briefing[key]])) } : {}),
  };
  if (index >= 0) profiles[index] = entry;
  else profiles.push(entry);
  return { ...doc, profiles };
}

/// Read the override file. A missing or broken file yields an empty list,
/// mirroring `profiles::load_overrides` being non-fatal.
export function readAgentsFile(path, { strict = false } = {}) {
  try {
    if (!existsSync(path)) return { profiles: [] };
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const doc = Array.isArray(parsed) ? { profiles: parsed } : parsed;
    if (Array.isArray(doc?.profiles)) {
      if (strict) doc.profiles.forEach(validateStoredProfile);
      return doc;
    }
    throw new Error("profile file must contain an array or a profiles array");
  } catch (error) {
    if (strict) throw new Error(`Cannot edit profile file: ${error.message}`);
    return { profiles: [] };
  }
}

// Mirror the deserializable fields of Rust ProfileOverride/AgentCapabilities.
// Unknown metadata is retained; malformed known fields cannot poison the file.
function validateStoredProfile(profile) {
  const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
  const invalid = () => { throw new Error('profile entry does not match the runtime schema'); };
  if (!obj(profile) || ['id', 'name', 'command'].some(key => typeof profile[key] !== 'string')) invalid();
  if (profile.args !== undefined && !strings(profile.args)) invalid();
  if (profile.env !== undefined && (!obj(profile.env) || Object.values(profile.env).some(value => typeof value !== 'string'))) invalid();
  if (profile.fallback != null && typeof profile.fallback !== 'string') invalid();
  if (profile.caps != null) {
    const caps = profile.caps;
    if (!obj(caps)) invalid();
    for (const [key, modes] of Object.entries({ systemPrompt: { unsupported: [], arg: ['flag'], file: ['flag', 'ext'] }, skills: { unsupported: [], convention: [], flag: ['flag'], conventionAt: ['dir'] }, lifecycle: { heuristic: [], settingsHooks: ['flag'] } })) {
      if (caps[key] === undefined) continue;
      const value = caps[key];
      if (!obj(value) || !Object.hasOwn(modes, value.mode) || modes[value.mode].some(field => typeof value[field] !== 'string')) invalid();
    }
    if (caps.dialect !== undefined && (!obj(caps.dialect) || ['permission', 'quota', 'contextLabels'].some(key => caps.dialect[key] !== undefined && !strings(caps.dialect[key])))) invalid();
    if (caps.readinessMarker != null && typeof caps.readinessMarker !== 'string') invalid();
  }
}

/// Write the override file, creating the exe directory when needed.
export function writeAgentsFile(path, doc) {
  (doc.profiles || []).forEach(validateStoredProfile);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ ...doc, profiles: doc.profiles || [] }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/// Where the running app looks for overrides: `agents.json` next to the exe.
/// The proxy cannot ask the exe, so it takes the same candidates ProjectA
/// developers actually run: an explicit env override first, then whichever
/// debug/release build was produced most recently (a debug binary lingering
/// from an earlier build must not shadow a freshly built release one, and a
/// Linux/macOS binary has no `.exe` suffix at all).
export function resolveAgentsFile(root, env = process.env, fs = { existsSync, statSync }) {
  if (env.PROJECTA_AGENTS_FILE) return env.PROJECTA_AGENTS_FILE;
  const candidates = ["debug", "release"].flatMap((profile) =>
    ["projecta.exe", "projecta"].map((name) => join(root, "src-tauri", "target", profile, name)),
  );
  let newest = null;
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const mtime = fs.statSync(candidate).mtimeMs;
    if (!newest || mtime > newest.mtime) newest = { candidate, mtime };
  }
  if (newest) return join(dirname(newest.candidate), "agents.json");
  return join(root, "src-tauri", "target", "debug", "agents.json");
}

/// Read the same versioned manifest embedded by Rust. Never scan source/tests.
export function parseBuiltinProfiles(raw) {
  const doc = JSON.parse(raw);
  if (doc?.schemaVersion !== 1 || Object.keys(doc).some(key => !['schemaVersion', 'profiles'].includes(key)) || !Array.isArray(doc.profiles) || doc.profiles.length === 0) throw new Error('Unsupported builtin profile manifest');
  const ids = new Set();
  return doc.profiles.map(profile => {
    validateStoredProfile(profile);
    if (profile.caps === null || (profile.enabled !== undefined && typeof profile.enabled !== 'boolean')) throw new Error('Invalid builtin profile definition');
    if (!PROFILE_ID.test(profile.id) || ids.has(profile.id)) throw new Error('Invalid or duplicate builtin profile id');
    ids.add(profile.id);
    return { ...profile, args: profile.args ?? [], env: profile.env ?? {}, fallback: profile.fallback ?? null, enabled: profile.enabled ?? true, caps: completeCapabilities(profile.caps), builtin: true };
  });
}

// Serde defaults fill missing fields; an explicit capability object replaces,
// rather than deep-merges with, inherited profile capabilities.
function completeCapabilities(caps = {}) {
  return {
    systemPrompt: caps?.systemPrompt ?? { mode: 'unsupported' },
    skills: caps?.skills ?? { mode: 'unsupported' },
    lifecycle: caps?.lifecycle ?? { mode: 'heuristic' },
    dialect: { permission: [], quota: [], contextLabels: [], ...caps?.dialect },
    readinessMarker: caps?.readinessMarker ?? null,
  };
}

/// The merged view the Teams card shows: built-ins first, then custom
/// overrides; same-id entries replace their built-in like the Rust merge does.
export function mergeProfileViews(builtins, overrides) {
  const merged = builtins.map((profile) => ({ ...profile, team: "Built-in agents" }));
  for (const override of overrides.profiles || []) {
    const inherited = merged.filter(profile => override.id === profile.id || override.id.startsWith(`${profile.id}-`))
      .sort((a, b) => b.id.length - a.id.length)[0]?.caps;
    const caps = override.caps == null ? structuredClone(inherited ?? completeCapabilities()) : completeCapabilities(override.caps);
    const entry = { ...override, args: override.args ?? [], env: override.env ?? {}, fallback: override.fallback ?? null,
      caps, enabled: true, builtin: false, team: override.team || "Custom" };
    const index = merged.findIndex((profile) => profile.id === entry.id);
    if (index >= 0) merged[index] = { ...merged[index], ...entry, builtin: false };
    else merged.push(entry);
  }
  return merged;
}
