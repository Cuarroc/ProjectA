import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../../design/controls/Button";
import { Popover } from "../../design/layout/Popover";
import { de } from "../../i18n/de";
import { describeError, listAgentProfiles } from "../../lib/ipc";
import { useSessions } from "../../sessions/SessionProvider";
import type { AgentProfile } from "../../types";

// Route remounts must share the guard until the provider request settles.
let pending = false;
const listeners = new Set<() => void>();
const subscribePending = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const getPending = () => pending;
const setPending = (value: boolean) => {
  pending = value;
  for (const listener of listeners) listener();
};

/** Only the empty route mounts this chooser; the provider owns the resulting session. */
export default function TerminalLauncher() {
  const { openAdHoc } = useSessions();
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<AgentProfile[] | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useSyncExternalStore(subscribePending, getPending);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
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
    setPending(true); setError(null);
    try { await openAdHoc(profile); }
    catch (cause) {
      // The provider may already have inserted a session before a subscription rejects.
      if (mounted.current) setError(`${de["terminal.launchFailed"]} ${describeError(cause)}`);
    } finally {
      setPending(false);
    }
  };
  return <>
    <Popover open={open} onOpenChange={setOpen} panelClassName="g-terminal-chooser" trigger={(props) => (
      <button {...props} type="button" className="g-btn g-btn--primary" aria-busy={busy || undefined} onClick={() => {
        if (pending) return;
        if (!open) { setProfiles(null); setFetchError(false); }
        setOpen(!open);
      }}>{de["terminal.newSession"]}</button>
    )}>
      <h2>{de["terminal.chooseProfile"]}</h2>
      {fetchError ? <p role="alert">{de["terminal.profilesFailed"]}</p>
        : profiles === null ? <p role="status">{de["terminal.profilesLoading"]}</p>
        : profiles.length === 0 ? <p role="status">{de["terminal.noEnabledProfiles"]}</p>
        : <ul>{profiles.map((profile) => <li key={profile.id}>
          <Button loading={busy} onClick={() => { void launch(profile); }}>{profile.name}</Button>
        </li>)}</ul>}
      <Button size="sm" onClick={() => setOpen(false)}>{de["confirm.cancel"]}</Button>
    </Popover>
    {error ? <p role="alert">{error}</p> : null}
  </>;
}
