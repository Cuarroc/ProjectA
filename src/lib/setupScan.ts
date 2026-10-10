import { invoke } from "@tauri-apps/api/core";

/** What the read-only repository scan (V2-B28) found; absent means "not found". */
export interface SetupScan {
  mainBranch: string | null;
  hasGatesSh: boolean;
  hasMergify: boolean;
  hasAgentsMd: boolean;
  /** Backticked paths of the serial-seam paragraph in `AGENTS.md`. */
  seamFiles: string[];
  freeRamBytes: number | null;
}

/** Scan the repository folder at `path`; rejects with a plain message. */
export function scanSetupRepo(path: string): Promise<SetupScan> {
  return invoke<SetupScan>("scan_setup_repo", { path });
}
