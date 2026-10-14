import "../../design/controls/controls.css";
import "../../design/glass.css";
import "../../design/inputs/inputs.css";
import { Button } from "../../design/controls/Button";
import { Chip } from "../../design/controls/Chip";
import { HonestState } from "../../design/data/HonestState";
import { DevNote } from "../../design/data/DevNote";
import { Avatar } from "../../design/inputs/Avatar";
import { Lamp, type LampState } from "../../design/inputs/Lamp";
import { Meter } from "../../design/inputs/Meter";
import { PROVIDER_POLL_MS, formatProviderResetsAt, providerKindLabel, useProviderOverview } from "../../lib/providers";
import { QUOTA_POLL_MS, useQuotaState } from "../../lib/quota";
import type { Provider, QuotaState } from "../../types";
import { toneFor } from "../leitstand/leitstand";
import { blockedNote, isMeasured, providerInitials, windowRows, type WindowRow } from "./kontingente";
import { T } from "./texts";
import "./kontingente.css";

const LAMP: Record<Provider["quotaState"], LampState> = { ok: "ok", blocked: "bad", unknown: "off" };

function Bar({ row }: { row: WindowRow }) {
  if (!isMeasured(row)) return null;
  const reset = formatProviderResetsAt(row.resetsAt);
  return (
    <div className="kt-bar">
      <span className="kt-k" title={row.label}>{row.label}</span>
      <Meter value={row.percent} tone={row.percent >= 95 ? "hot" : "neutral"} aria-label={T.meterLabel(row.label, row.percent)} />
      <span className="kt-pct">{T.percent(row.percent)}</span>
      <span className="kt-reset" title={reset ?? undefined}>{reset}</span>
    </div>
  );
}

export function QuotaWindows({ rows }: { rows: WindowRow[] }) {
  const missing = rows.filter((row) => !isMeasured(row));
  return (
    <div className="kt-bars">
      {rows.filter(isMeasured).map((row) => <Bar key={row.key} row={row} />)}
      {missing.length > 0 && (
        <div className="kt-bar kt-unknown" role="note" aria-label={T.unknownWindows}>
          <span className="kt-k">
            {missing.map((row, index) => {
              const reset = formatProviderResetsAt(row.resetsAt);
              return <span key={row.key}>{index > 0 && T.windowSeparator}<span>{row.label}</span>{reset && T.windowReset(reset)}</span>;
            })}
          </span>
          <HonestState kind="offline" title={missing.some((row) => row.key === "other") ? T.noPercent : T.notConnected} />
        </div>
      )}
    </div>
  );
}

function ProviderCard({ provider, quota, quotaUnread, avatar, onProbe }: { provider: Provider; quota: QuotaState | undefined; quotaUnread: boolean; avatar: string; onProbe: () => void }) {
  const blocked = provider.quotaState === "blocked" || quota?.state === "blocked";
  const note = blockedNote(provider, quota);
  const state = blocked ? "blocked" : quotaUnread ? "unknown" : provider.quotaState;
  return (
    <article className="g-glass kt-card" aria-label={provider.name}>
      <div className="kt-head">
        <Avatar initials={avatar} tone={toneFor(provider.id)} />
        <div className="kt-who">
          <h3 title={provider.name}>{provider.name}</h3>
          <p>{providerKindLabel(provider.kind)}</p>
        </div>
        <Chip><Lamp state={LAMP[state]} />{T.providerLamp[state]}</Chip>
      </div>
      {note && <p className="kt-note">{note}</p>}
      <QuotaWindows rows={windowRows(provider)} />
      {blocked && (
        <div className="kt-probe">
          <span>{T.probeHint}</span>
          <Button size="sm" onClick={onProbe}>{T.probe}</Button>
        </div>
      )}
    </article>
  );
}

function Placeholder({ id, title, follow }: { id: string; title: string; follow: string }) {
  return (
    <section className="g-glass kt-pane" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <HonestState kind="offline" title={T.notConnected} />
      <DevNote className="kt-note">{follow}</DevNote>
    </section>
  );
}

/** Steuerung › Kontingente: one Glass card per provider. Not mounted yet (V2-S05a-1). */
export function KontingenteScreen() {
  const { providers, loading, error, refresh } = useProviderOverview(PROVIDER_POLL_MS);
  const { byProfile, loading: quotaLoading, error: quotaError } = useQuotaState(QUOTA_POLL_MS);
  const avatars = providerInitials(providers);
  return (
    <div className="kt-screen">
      <header className="kt-top">
        <h1>{T.title}</h1>
        <p>{T.lead}</p>
      </header>
      {error !== null && <HonestState kind="offline" title={error} />}
      {(quotaLoading || quotaError !== null) && (
        <div role="status">
          <HonestState kind="offline" title={quotaError !== null ? T.quotaUnread : T.quotaLoading}
            hint={quotaError !== null && byProfile.size > 0 ? T.quotaStale : undefined} />
        </div>
      )}
      {providers.length > 0 ? (
        <div className="kt-provs">
          {providers.map((p) => <ProviderCard key={p.id} provider={p} quota={byProfile.get(p.id)} quotaUnread={quotaLoading || quotaError !== null} avatar={avatars.get(p.id) ?? "?"} onProbe={refresh} />)}
        </div>
      ) : loading ? (
        <p className="kt-note" role="status">{T.loading}</p>
      ) : error === null ? (
        <HonestState kind="empty" title={T.noProviderTitle} hint={T.noProviderHint} />
      ) : null}
      <div className="kt-lower">
        <Placeholder id="kt-rules" title={T.rules} follow={T.rulesFollow} />
        <Placeholder id="kt-log" title={T.log} follow={T.logFollow} />
      </div>
    </div>
  );
}
