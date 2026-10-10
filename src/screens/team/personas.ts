import type { AgentProfile } from "../../types";
import { T } from "./texts";

/** Executable name of the profile's command, without folder and extension. */
export const cliKey = (command: string) =>
  (command.split(/[\\/]/).pop() ?? command).replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();

export const cliLabel = (command: string) => T.cli[cliKey(command)] ?? cliKey(command);

/** The model a profile pins on its command line, or null when it states none. */
export function modelOf(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const inline = /^--model=(.+)$/.exec(a);
    if (inline) return inline[1];
    if ((a === "--model" || a === "-m") && args[i + 1]) return args[i + 1];
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
