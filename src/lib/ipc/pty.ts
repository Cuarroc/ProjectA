import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { PtyExitPayload, SpawnPtyResult } from "../../types";

export async function spawnPty(args: {
  profileId: string;
  cwd?: string;
  cols: number;
  rows: number;
}): Promise<string> {
  const result = await invoke<SpawnPtyResult>("spawn_pty", {
    profileId: args.profileId,
    cwd: args.cwd,
    cols: args.cols,
    rows: args.rows,
  });
  return result.sessionId;
}

export function writePty(sessionId: string, data: string): Promise<void> {
  return invoke<void>("write_pty", { sessionId, data });
}

export function resizePty(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke<void>("resize_pty", { sessionId, cols, rows });
}

export function killPty(sessionId: string): Promise<void> {
  return invoke<void>("kill_pty", { sessionId });
}

export function getScrollback(sessionId: string): Promise<string> {
  return invoke<string>("get_scrollback", { sessionId });
}

export function onPtyOutput(
  sessionId: string,
  handler: (chunk: string) => void,
): Promise<UnlistenFn> {
  return listen<string>(`pty:output:${sessionId}`, (event) => handler(event.payload));
}

export function onPtyExit(
  sessionId: string,
  handler: (payload: PtyExitPayload) => void,
): Promise<UnlistenFn> {
  return listen<PtyExitPayload>(`pty:exit:${sessionId}`, (event) => handler(event.payload));
}
