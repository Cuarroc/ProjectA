import { useCallback, useEffect, useState } from "react";

import {
  isFeatureFlagEnabled,
  setFeatureFlagEnabled,
  type FeatureFlagId,
} from "./featureFlags";

/**
 * Read/write one feature flag. Default is always off until the user enables it.
 * Not wired into App yet (V2-F9 consumes D1).
 */
export function useFeatureFlag(id: FeatureFlagId): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(() => isFeatureFlagEnabled(id));

  useEffect(() => {
    setEnabled(isFeatureFlagEnabled(id));
  }, [id]);

  const set = useCallback(
    (next: boolean) => {
      setFeatureFlagEnabled(id, next);
      setEnabled(next);
    },
    [id],
  );

  return [enabled, set];
}
