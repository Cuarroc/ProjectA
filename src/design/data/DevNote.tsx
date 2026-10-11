import { useEffect, useState } from "react";
import { getIdentifier } from "@tauri-apps/api/app";

/** Internal planning notes belong only to the ProjectA Dev channel. */
export function DevNote({ children, className }: { children: string; className?: string }) {
  const [isDevBuild, setIsDevBuild] = useState(false);
  useEffect(() => {
    let live = true;
    async function readChannel() {
      try {
        const identifier = await getIdentifier();
        if (live) setIsDevBuild(identifier === "com.projecta.dev");
      } catch {
        // A browser preview or an unavailable identifier must not expose notes.
      }
    }
    void readChannel();
    return () => { live = false; };
  }, []);
  return isDevBuild ? <p className={className}>{children}</p> : null;
}
