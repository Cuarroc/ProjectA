import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
      <button {...props} type="button" className="g-btn g-btn--primary" aria-busy={busy || undefined} onClick={() => {
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
