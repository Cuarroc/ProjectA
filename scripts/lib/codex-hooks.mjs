// Project Codex hooks (`.codex/hooks.json`, gitignored, one per checkout).
//
// Until HOOK-WIN (2026-10-07) the file was hand-copied from
// docs/setup/codex.md and called bare `bash`. On Windows Codex runs hooks in
// its environment's shell, where `bash` resolves to the WindowsApps WSL
// launcher; without a WSL distribution it exits 1, so every Codex session
// reported "hook exited with code 1". This module generates the file per
// checkout (npm run dev:setup -- --apply) and lets the doctor flag stale
// copies.
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const codexHooksRelativePath = '.codex/hooks.json';

const template = join(dirname(fileURLToPath(import.meta.url)), 'codex-git-bash-hook.ps1');

// The template with the script path bound, as -EncodedCommand: the same
// string works whether Codex runs it in PowerShell 5, PowerShell 7 or CMD,
// and it needs no file of the target checkout besides the hook script.
export function windowsCommand(script) {
  const body = readFileSync(template, 'utf8').split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#')).join('\n');
  const source = `$Script = '${script.replace(/'/g, "''")}'\n${body}\n`;
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(source, 'utf16le').toString('base64')}`;
}

// Absolute paths on purpose: `.codex/` is per checkout and the hook must run
// the scripts of the checkout it was generated for (docs/setup/codex.md).
export function codexHooksConfig(root) {
  const unix = root.replace(/\\/g, '/');
  const redFirst = posix.join(unix, '.claude/hooks/red-first.sh');
  const installHooks = posix.join(unix, 'scripts/install-hooks.sh');
  // POSIX single quotes: an embedded ' becomes '\'' (close, escaped quote, reopen).
  const hook = script => ({ type: 'command', command: `bash '${script.replace(/'/g, "'\\''")}'`, commandWindows: windowsCommand(script) });
  return {
    hooks: {
      PostToolUse: [{ matcher: 'Write|Edit', hooks: [hook(redFirst)] }],
      SessionStart: [{ hooks: [hook(installHooks)] }],
    },
  };
}

// Every hook whose Windows command would reach the bare `bash` on PATH: a
// `command` starting with `bash` and no `commandWindows`, or a
// `commandWindows` that itself starts with bare `bash`.
export function findBareBashHooks(config) {
  const found = [];
  const bare = text => typeof text === 'string' && /^\s*bash(\.exe)?(\s|$)/i.test(text);
  for (const [event, groups] of Object.entries(config?.hooks ?? {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const entry of Array.isArray(group?.hooks) ? group.hooks : []) {
        const windows = entry?.commandWindows;
        if (windows === undefined ? bare(entry?.command) : bare(windows)) found.push({ event, command: windows ?? entry.command });
      }
    }
  }
  return found;
}

export function inspectCodexHooks(root) {
  const path = join(root, ...codexHooksRelativePath.split('/'));
  if (!existsSync(path)) return { id: 'codex-hooks', state: 'ok', detail: 'No project Codex hooks in this checkout.' };
  let config;
  try { config = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { return { id: 'codex-hooks', state: 'fail', detail: `Unreadable ${codexHooksRelativePath}: ${error.message}` }; }
  const bare = findBareBashHooks(config);
  if (bare.length === 0) return { id: 'codex-hooks', state: 'ok', detail: 'Project Codex hooks reach Git Bash explicitly on Windows.' };
  return { id: 'codex-hooks', state: 'fail', detail: `${bare.length} Codex hook(s) call bare bash, which is the WSL launcher on Windows (${bare.map(b => b.event).join(', ')}); run npm run dev:setup -- --apply.` };
}

// Writes the generated file. An existing different file is kept next to it
// as `hooks.json.<sha12>.bak` first, so the step can be undone by hand.
export function writeCodexHooks(root) {
  const path = join(root, ...codexHooksRelativePath.split('/'));
  const text = `${JSON.stringify(codexHooksConfig(root), null, 2)}\n`;
  if (existsSync(path)) {
    const current = readFileSync(path);
    if (current.toString('utf8') === text) return { changed: false, backup: null };
    const backup = `${path}.${createHash('sha256').update(current).digest('hex').slice(0, 12)}.bak`;
    if (!existsSync(backup)) copyFileSync(path, backup);
    writeFileSync(path, text);
    return { changed: true, backup };
  }
  mkdirSync(join(root, '.codex'), { recursive: true });
  writeFileSync(path, text);
  return { changed: true, backup: null };
}
