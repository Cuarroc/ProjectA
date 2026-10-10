import { useCallback, useSyncExternalStore } from "react";

import {
  isFeatureFlagEnabled,
  setFeatureFlagEnabled,
  subscribeFeatureFlags,
  type FeatureFlagId,
} from "./featureFlags";

/**
 * Read/write one feature flag. Default is always off until the user enables it.
 * Not wired into App yet (V2-F9 consumes D1). Shares updates across hook instances.
 */
export function useFeatureFlag(id: FeatureFlagId): [boolean, (next: boolean) => void] {
  const enabled = useSyncExternalStore(
    subscribeFeatureFlags,
    () => isFeatureFlagEnabled(id),
    () => false,
  );

  const set = useCallback(
    (next: boolean) => {
      setFeatureFlagEnabled(id, next);
    },
    [id],
  );

  return [enabled, set];
}
