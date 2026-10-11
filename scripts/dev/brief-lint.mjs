import { isMain, runCli, withExitCodes } from "../lib/dev-tools.mjs";

export const APPROVAL_WORDS = [];
export function lint() { return { exit: 1, reasons: [], approvals: [] }; }
export const main = withExitCodes(async () => 1);
if (isMain(import.meta.url)) runCli(main);
