import type { ReactNode } from "react";

import type { FeatureFlagId } from "./featureFlags";

/**
 * Temporary ungated stub for the red-first commit (R1018-A2).
 * Always renders children so the FeatureGate test fails until the real gate lands.
 */
export function FeatureGate({ children }: { id: FeatureFlagId; children: ReactNode }) {
  return <>{children}</>;
}
