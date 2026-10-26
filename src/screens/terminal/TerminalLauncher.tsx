import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../../design/controls/Button";
import { Popover } from "../../design/layout/Popover";
import { de } from "../../i18n/de";
import { describeError, listAgentProfiles } from "../../lib/ipc";
import { useSessions } from "../../sessions/SessionProvider";
import type { AgentProfile } from "../../types";

// Route remounts must share the guard until the provider request settles.
let pending = false;
// Keep the request outcome until deliberate acknowledgement, independently of the guard.
let requestError: string | null = null;
const listeners = new Set<() => void>();
const subscribePending = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const getPending = () => pending;
const getError = () => requestError;
const setError = (value: string | null) => {
  requestError = value;
  for (const listener of listeners) listener();
};
const setPending = (value: boolean) => {
  pending = value;
  for (const listener of listeners) listener();
};

/** Eligible empty and live routes share this chooser; the provider owns sessions. */
export default function TerminalLauncher({ onLaunch }: { onLaunch: () => () => void }) {
  const { openAdHoc } = useSessions();
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<AgentProfile[] | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const button = anchor.current;
    const strip = button?.closest<HTMLElement>(".g-terminal-actions");
    const root = button?.parentElement;
    const panel = root?.querySelector<HTMLElement>(".g-terminal-chooser");
    if (!open || !button || !strip || !root || !panel) return;
    const place = () => {
      const bounds = strip.getBoundingClientRect();
      const below = Math.max(0, window.innerHeight - bounds.bottom - 16);
      const above = Math.max(0, bounds.top - 16);
      const desired = Math.min(280, window.innerHeight * 0.6);
      const down = below >= desired || below >= above;
      const height = Math.min(desired, down ? below : above);
      const left = Math.max(8, Math.min(button.getBoundingClientRect().right - panel.offsetWidth,
        window.innerWidth - panel.offsetWidth - 8));
      root.style.setProperty("--terminal-chooser-left", `${left}px`);
      root.style.setProperty("--terminal-chooser-top", `${down ? bounds.bottom + 8 : bounds.top - height - 8}px`);
      root.style.setProperty("--terminal-chooser-height", `${height}px`);
    };
    // Reserve the whole wrapped strip, including controls above the trigger.
    place();
    const observer = new ResizeObserver(place);
    observer.observe(strip);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const error = useSyncExternalStore(subscribePending, getError);
  const busy = useSyncExternalStore(subscribePending, getPending);
  useEffect(() => {
    if (!open) return;
    let current = true;
    void listAgentProfiles().then((result) => {
      if (current) setProfiles(result.filter((profile) => profile.enabled));
    }).catch(() => { if (current) setFetchError(true); });
    return () => { current = false; };
  }, [open]);
  const launch = async (profile: AgentProfile) => {
    if (pending) return;
    const settled = onLaunch();
    setPending(true); setError(null);
    try {
      await openAdHoc(profile);
      if (mounted.current) setOpen(false);
    }
    catch (cause) {
      // The provider may already have inserted a session before a subscription rejects.
      setError(`${de["terminal.launchFailed"]} ${describeError(cause)}`);
    } finally {
      settled();
      setPending(false);
    }
  };
  return <>
    <Popover open={open} onOpenChange={setOpen} panelClassName="g-terminal-chooser" trigger={(props) => (
      <button {...props} type="button" className="g-btn g-btn--primary" aria-busy={busy || undefined} onClick={(event) => {
        anchor.current = event.currentTarget;
        if (pending) return;
        if (!open) { setError(null); setProfiles(null); setFetchError(false); }
        setOpen(!open);
      }}>{de["terminal.newSession"]}</button>
    )}>
      <h2>{de["terminal.chooseProfile"]}</h2>
      {open && error ? <p role="alert">{error}</p> : null}
      {fetchError ? <p role="alert">{de["terminal.profilesFailed"]}</p>
        : profiles === null ? <p role="status">{de["terminal.profilesLoading"]}</p>
        : profiles.length === 0 ? <p role="status">{de["terminal.noEnabledProfiles"]}</p>
        : <ul>{profiles.map((profile) => <li key={profile.id}>
          <Button loading={busy} onClick={() => { void launch(profile); }}>{profile.name}</Button>
        </li>)}</ul>}
      <Button size="sm" onClick={() => setOpen(false)}>{de["confirm.cancel"]}</Button>
    </Popover>
    {!open && error ? <p role="alert">{error}</p> : null}
  </>;
}
