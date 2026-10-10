import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Shared "was this module started as the program?" check for tools/denkraum.
// Call as `isEntry(import.meta.url, import.meta)`; the name and signature are
// stable so other entry points (server.mjs) can adopt it.
// A plain `import.meta.url === pathToFileURL(process.argv[1])` is false when the
// program is started through a junction or symlink: Node resolves the module URL
// to the real path but leaves argv[1] as typed, so the program exits silently.
export function isEntry(importMetaUrl, importMeta = {}) {
  if (importMeta.main !== undefined) return importMeta.main;
  // Node 24.0/24.1 lack import.meta.main; compare real paths (as config.mjs does).
  if (!process.argv[1] || process.execArgv.some((arg) => /^(?:--(?:eval|print)(?:=|$)|-[ep])/u.test(arg))) return false;
  try {
    return createRequire(importMetaUrl).resolve(process.argv[1]) === fileURLToPath(importMetaUrl);
  } catch {
    return false;
  }
}
