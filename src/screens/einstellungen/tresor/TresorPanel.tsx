import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "../../../design/glass.css";
import { Button } from "../../../design/controls/Button";
import "../../../design/controls/controls.css";
import { HonestState } from "../../../design/data/HonestState";
import { DevNote } from "../../../design/data/DevNote";
import { Table, type Column } from "../../../design/data/Table";
import { hasProviderKey } from "../../../lib/ipc";
import { providerKindLabel, useProviderOverview, vaultErrorText } from "../../../lib/providers";
import type { Provider } from "../../../types";
import { T } from "./texts";
import "./tresor.css";

/** `undefined` = still asking, `null` = the check failed or answered nothing usable. */
type Presence = boolean | null | undefined;

/** Presence of one stored key, read as a yes/no. The core never hands the key itself to this screen. */
function KeyAccess({ providerId, vaultBroken }: { providerId: string; vaultBroken: boolean }) {
  const [present, setPresent] = useState<Presence>(undefined);
  useEffect(() => {
    let live = true;
    setPresent(undefined);
    // Only a real boolean counts; anything else is dropped unread, so a stray value is never shown.
    hasProviderKey(providerId).then((v) => live && setPresent(typeof v === "boolean" ? v : null), () => live && setPresent(null));
    return () => {
      live = false;
    };
  }, [providerId]);
  // A broken store must not read as "no keys".
  const text = present === undefined ? T.checking : present === true ? T.present : present === false && !vaultBroken ? T.absent : T.unknown;
  return <span className={present === undefined || text === T.unknown ? "tr-access tr-access--quiet" : "tr-access"}>{text}</span>;
}

/** One read generation owns both the overview and its key-presence checks. */
function VaultRead({
  generation,
  onLoading,
}: {
  generation: number;
  onLoading: (generation: number, loading: boolean) => void;
}) {
  const { providers, loading, error, vaultError } = useProviderOverview();
  const onLoadingRef = useRef(onLoading);
  onLoadingRef.current = onLoading;
  useEffect(() => {
    onLoadingRef.current(generation, loading);
    return () => {
      // Idle on unmount. The panel drops the report when a newer read is
      // already current, so this cleanup cannot clear that read.
      onLoadingRef.current(generation, false);
    };
  }, [generation, loading]);
  // Idle must land in the commit that shows the settled read: a passive effect
  // trails it by a scheduler task, and a slow frame yields in that gap.
  useLayoutEffect(() => {
    if (!loading) onLoadingRef.current(generation, false);
  }, [generation, loading]);
  const columns: Column<Provider>[] = [
    { key: "name", header: T.colProvider, cell: (p) => p.name },
    { key: "kind", header: T.colKind, cell: (p) => providerKindLabel(p.kind) },
    {
      key: "access",
      header: T.colAccess,
      cell: (p) =>
        p.kind === "api_key" ? <KeyAccess providerId={p.id} vaultBroken={vaultError !== null} />
          : <span className="tr-access">{p.kind === "subscription" ? T.subscription : T.local}</span>,
    },
  ];

  if (loading) return <p className="tr-note">{T.loading}</p>;
  if (error !== null) return <HonestState kind="offline" title={T.offline} hint={T.offlineHint} />;
  return (
    <>
      {vaultError !== null ? <p className="tr-alert" role="alert">{vaultErrorText(vaultError)}</p> : null}
      <Table
        label={T.vaultTable}
        columns={columns}
        rows={providers}
        rowKey={(p) => p.id}
        empty={<HonestState kind="empty" title={T.empty} hint={T.emptyHint} />}
      />
    </>
  );
}

/** Tresor and MCP servers, read-only: shows whether a key is on file, never the key, and changes nothing. Not mounted yet. */
export function TresorPanel() {
  const [read, setRead] = useState(0);
  // Idle until this generation's reader reports a request. A ref, not only
  // state, blocks a second click before the next paint.
  const [loading, setLoading] = useState(false);
  const readRef = useRef(0);
  const loadingRef = useRef(false);
  const onLoading = useCallback((generation: number, next: boolean) => {
    if (generation !== readRef.current) return;
    loadingRef.current = next;
    setLoading(next);
  }, []);
  function reread() {
    if (loadingRef.current) return;
    const nextRead = readRef.current + 1;
    readRef.current = nextRead;
    loadingRef.current = true;
    setLoading(true);
    setRead(nextRead);
  }
  return (
    <div className="tr-panel">
      <section className="g-glass tr-card" aria-label={T.vault}>
        <h2 className="tr-h">{T.vault}</h2>
        <Button size="sm" className="tr-reread" aria-busy={loading} onClick={reread}>{T.reread}</Button>
        <VaultRead key={read} generation={read} onLoading={onLoading} />
      </section>
      <section className="g-glass tr-card" aria-label={T.mcp}>
        <h2 className="tr-h">{T.mcp}</h2>
        <HonestState kind="offline" title={T.mcpOffline} hint={T.mcpHint} />
        <DevNote className="tr-note">{T.mcpPackage}</DevNote>
      </section>
    </div>
  );
}
