import { useEffect, useState } from "react";
import { getIdentifier } from "@tauri-apps/api/app";

/** The native identifier is also the injection boundary for isolated UI fixtures. */
export function useIsDevBuild(readIdentifier = getIdentifier) {
  const [isDevBuild, setIsDevBuild] = useState(false);
  useEffect(() => {
    let live = true;
    async function readChannel() {
      try {
        const identifier = await readIdentifier();
        if (live) setIsDevBuild(identifier === "com.projecta.dev");
      } catch {
        // A browser preview or an unavailable identifier must not expose notes.
      }
    }
    void readChannel();
    return () => { live = false; };
  }, [readIdentifier]);
  return isDevBuild;
}
