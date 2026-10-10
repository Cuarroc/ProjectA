import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { AppGoal } from "../../lib/goals";
import { Shell } from "../Shell";
import { pathFromHash } from "../routes";
import { hasLegacyPanel, hashForGoal } from "./routing";
import "./mount.css";

export interface LegacyRouteProps {
  routePath: string;
  onGoalRoute: (goal: AppGoal) => void;
}

/**
 * V2-F9: the Glass shell around the old views. The old app is rendered once and stays mounted
 * (PTY sessions, drafts) in the shell's content slot; routes without an old view keep the
 * shell placeholder, and the old view is only hidden there, never unmounted. Switching D1 off
 * unmounts this component and mounts the old app again from scratch (the toggle reloads the UI anyway).
 */
export default function ShellMount({ children }: { children: (props: LegacyRouteProps) => ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [path, setPath] = useState(() => pathFromHash(window.location.hash));
  useLayoutEffect(() => {
    const find = () => frame.current?.querySelector<HTMLElement>(".g-shell-content") ?? null;
    const found = find();
    if (found) return setHost(found);
    // The shell may render its content slot after this first layout pass: wait for it.
    const watch = new MutationObserver(() => {
      const late = find();
      if (late) { setHost(late); watch.disconnect(); }
    });
    watch.observe(frame.current!, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, []);
  useEffect(() => {
    const onHash = () => setPath(pathFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // Shell sets `data-theme` on <html>; the old UI never had it, so leaving the preview removes it.
  useEffect(() => () => void delete document.documentElement.dataset.theme, []);
  const pathRef = useRef(path);
  useEffect(() => { pathRef.current = path; }, [path]);
  const onGoalRoute = useCallback((goal: AppGoal) => {
    const hash = hashForGoal(goal, pathRef.current);
    if (hash !== null) window.location.hash = hash;
  }, []);

  const legacy = hasLegacyPanel(path);
  return (
    <div className="g-mount" ref={frame} data-legacy={legacy ? "on" : "off"}>
      <Shell />
      {host
        ? createPortal(
            <div className="g-mount-legacy" hidden={!legacy}>{children({ routePath: path, onGoalRoute })}</div>,
            host,
          )
        : null}
    </div>
  );
}
