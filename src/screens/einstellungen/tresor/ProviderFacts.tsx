import { KeyValue, type KeyValueItem } from "../../../design/data/KeyValue";
import { formatProviderObservedAt, formatProviderResetsAt, isUsageStale, providerDetailText } from "../../../lib/providers";
import type { Provider } from "../../../types";
import { T } from "./facts/texts";

/** Presentation of the existing read snapshot; connection and key presence stay separate. */
export function ProviderFacts({ provider }: { readonly provider: Readonly<Provider> }) {
  const detail = providerDetailText(provider);
  const { usage } = provider;
  // KeyValue truncates plain strings; recorded facts must remain readable in the name cell.
  const fact = (rowKey: string, label: string, value: string): KeyValueItem => ({
    rowKey, label,
    value: <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{value}</span>,
  });
  const items = [
    fact("usage", T.usage, usage?.percent != null ? `${usage.percent}${T.percentSuffix}` : T.unmeasured),
    fact("used", T.used, usage?.used ?? T.unmeasured),
    fact("limit", T.limit, usage?.limit ?? T.unmeasured),
    fact("source", T.source, usage?.source ?? T.unknown),
    fact("window", T.window, usage?.windowLabel ?? T.unknown),
    fact("observed", T.observed, usage
      ? `${formatProviderObservedAt(usage.observedAt)}${isUsageStale(usage) ? `${T.staleSeparator}${T.stale}` : ""}` : T.unknown),
    fact("reset", T.reset, formatProviderResetsAt(usage?.resetsAt ?? null) ?? T.unknown),
  ];
  return (
    <div>
      {detail !== null ? <p className="tr-note">{detail}</p> : null}
      <KeyValue items={items} />
    </div>
  );
}
