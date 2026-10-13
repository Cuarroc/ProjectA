import { useEffect, useState } from "react";
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
function VaultRead({ onLoading }: { onLoading: (loading: boolean) => void }) {
  const { providers, loading, error, vaultError } = useProviderOverview();
  useEffect(() => { onLoading(loading); }, [loading, onLoading]);
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
  const [loading, setLoading] = useState(true);
  function reread() {
    if (loading) return;
    setLoading(true);
    setRead((value) => value + 1);
  }
  return (
    <div className="tr-panel">
      <section className="g-glass tr-card" aria-label={T.vault}>
        <h2 className="tr-h">{T.vault}</h2>
        <div><Button size="sm" disabled={loading} onClick={reread}>{T.reread}</Button></div>
        <VaultRead key={read} onLoading={setLoading} />
      </section>
      <section className="g-glass tr-card" aria-label={T.mcp}>
        <h2 className="tr-h">{T.mcp}</h2>
        <HonestState kind="offline" title={T.mcpOffline} hint={T.mcpHint} />
        <DevNote className="tr-note">{T.mcpPackage}</DevNote>
      </section>
    </div>
  );
}
