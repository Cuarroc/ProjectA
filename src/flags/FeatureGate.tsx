import type { ReactNode } from "react";

import type { FeatureFlagId } from "./featureFlags";
import { useFeatureFlag } from "./useFeatureFlag";

/**
 * Renders children only when the named feature flag is on.
 * Off: no children (and no effects inside them), so gated invokes never run.
 */
export function FeatureGate({ id, children }: { id: FeatureFlagId; children: ReactNode }) {
  const [enabled] = useFeatureFlag(id);
  if (!enabled) return null;
  return <>{children}</>;
}
