import { useEffect, useState } from "react";
import "../../../design/glass.css";
import { HonestState } from "../../../design/data/HonestState";
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

/** Tresor and MCP servers, read-only: shows whether a key is on file, never the key, and changes nothing. Not mounted yet. */
export function TresorPanel() {
  const { providers, loading, error, vaultError } = useProviderOverview();
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

  return (
    <div className="tr-panel">
      <section className="g-glass tr-card" aria-label={T.vault}>
        <h2 className="tr-h">{T.vault}</h2>
        {loading ? <p className="tr-note">{T.loading}</p> : error !== null ? (
          <HonestState kind="offline" title={T.offline} hint={T.offlineHint} />
        ) : (
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
        )}
      </section>
      <section className="g-glass tr-card" aria-label={T.mcp}>
        <h2 className="tr-h">{T.mcp}</h2>
        <HonestState kind="offline" title={T.mcpOffline} hint={T.mcpHint} />
        <p className="tr-note">{T.mcpPackage}</p>
      </section>
    </div>
  );
}
