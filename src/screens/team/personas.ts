import type { AgentProfile } from "../../types";
import { T } from "./texts";

/** Executable name of the profile's command, without folder and extension. */
export const cliKey = (command: string) =>
  (command.split(/[\\/]/).pop() ?? command).replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();

export const cliLabel = (command: string) => {
  const key = cliKey(command);
  return Object.hasOwn(T.cli, key) ? (T.cli[key] ?? key) : key;
};

/** The model a profile pins on its command line, or null when it states none. */
export function modelOf(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const inline = /^--model=(.+)$/.exec(a);
    if (inline) return inline[1];
    const next = args[i + 1];
    // A following flag is not a model: `--model --verbose` pins nothing.
    if ((a === "--model" || a === "-m") && next && !next.startsWith("-")) return next;
  }
  return null;
}

/** One count per CLI, in first-seen order. */
export function providerCounts(profiles: AgentProfile[]): { key: string; label: string; count: number }[] {
  const rows = new Map<string, { key: string; label: string; count: number }>();
  for (const p of profiles) {
    const key = cliKey(p.command);
    const row = rows.get(key) ?? { key, label: cliLabel(p.command), count: 0 };
    row.count += 1;
    rows.set(key, row);
  }
  return [...rows.values()];
}
