import { CommandPalette } from "./CommandPalette";
import { Bell, QuotaBar } from "./QuotaBell";

export { Bell, QuotaBar } from "./QuotaBell";
export { CommandPalette } from "./CommandPalette";
export { StopBand } from "./StopBand";

/** The header tools between the project picker and the appearance toggle (V2-F8b). */
export function HeaderTools() {
  return (
    <div className="g-hdr-tools">
      <CommandPalette />
      <QuotaBar />
      <Bell />
    </div>
  );
}
