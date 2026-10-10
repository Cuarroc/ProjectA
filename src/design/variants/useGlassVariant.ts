import { useState } from "react";

import { readString, writeString } from "../../lib/settings";

// V2-TH-VAR-2: the glass style is only `data-glass-variant` on <html>; absent = Glas.
// Same early-apply contract as the shell theme (`data-theme`): see applyStoredGlassVariant.

export type GlassVariant = "glas" | "klar" | "nebel" | "abend";

export const GLASS_VARIANTS: readonly GlassVariant[] = ["glas", "klar", "nebel", "abend"];

export const GLASS_VARIANT_KEY = "projecta.settings.glassVariant";

/** Unknown or missing stored values fall back to Glas. */
export function loadGlassVariant(): GlassVariant {
  const raw = readString(GLASS_VARIANT_KEY);
  return GLASS_VARIANTS.find((v) => v === raw) ?? "glas";
}

export function applyGlassVariant(variant: GlassVariant): void {
  if (variant === "glas") delete document.documentElement.dataset.glassVariant;
  else document.documentElement.dataset.glassVariant = variant;
}

export function saveGlassVariant(variant: GlassVariant): void {
  writeString(GLASS_VARIANT_KEY, variant === "glas" ? null : variant);
  applyGlassVariant(variant);
}

/** Call before the first paint (the shell does it in a layout effect) so Glas never flashes. */
export function applyStoredGlassVariant(): void {
  applyGlassVariant(loadGlassVariant());
}

export function useGlassVariant(): [GlassVariant, (next: GlassVariant) => void] {
  const [variant, setVariant] = useState<GlassVariant>(loadGlassVariant);
  const change = (next: GlassVariant) => { setVariant(next); saveGlassVariant(next); };
  return [variant, change];
}
