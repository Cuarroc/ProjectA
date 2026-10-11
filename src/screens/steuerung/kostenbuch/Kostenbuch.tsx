import { useCallback, useEffect, useRef, useState } from "react";
import "../../../design/glass.css";
import { Button } from "../../../design/controls/Button";
import { HonestState } from "../../../design/data/HonestState";
import { KeyValue } from "../../../design/data/KeyValue";
import { Table, type Column } from "../../../design/data/Table";
import { getOmniRouteUsage } from "../../../lib/ipc";
import type { UsageEvent, UsageReport, UsageTotals } from "../../../types";
import { T } from "./texts";
import "./kostenbuch.css";

interface Row {
  key: string;
  provider: string;
  model: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  sum?: boolean;
}

const num = (n: number) => n.toLocaleString("de-DE");

/** One row per provider + model, folded from the events; an empty model is named, never dropped. */
function fold(events: readonly UsageEvent[]): Row[] {
  const byKey = new Map<string, Row>();
  for (const e of events) {
    const key = `${e.provider}\u0000${e.model}`;
    const row = byKey.get(key) ?? {
      key, provider: e.provider || T.unknownProvider, model: e.model || T.unknownModel, requests: 0, tokensIn: 0, tokensOut: 0,
    };
    row.requests += 1;
    row.tokensIn += e.tokensIn;
    row.tokensOut += e.tokensOut;
    byKey.set(key, row);
  }
  const rows = [...byKey.values()].sort((a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
  const sum: Row = { key: "\u0000sum", provider: T.sum, model: "", requests: events.length, sum: true,
    tokensIn: events.reduce((s, e) => s + e.tokensIn, 0), tokensOut: events.reduce((s, e) => s + e.tokensOut, 0) };
  return [...rows, sum];
}

const bold = (row: Row, text: string) => (row.sum ? <strong>{text}</strong> : text);
const COLUMNS: readonly Column<Row>[] = [
  { key: "provider", header: T.provider, cell: (r) => bold(r, r.provider) },
  { key: "model", header: T.model, cell: (r) => r.model },
  { key: "requests", header: T.requests, numeric: true, cell: (r) => bold(r, num(r.requests)) },
  { key: "in", header: T.tokensIn, numeric: true, cell: (r) => bold(r, num(r.tokensIn)) },
  { key: "out", header: T.tokensOut, numeric: true, cell: (r) => bold(r, num(r.tokensOut)) },
];

const period = (label: string, t: UsageTotals) => ({
  label,
  value: T.periodLine(num(t.requests), num(t.tokensIn), num(t.tokensOut)),
});

/** Kostenbuch: usage in requests and tokens, never money. Read-only, not mounted yet. */
export function Kostenbuch() {
  // `undefined` = not read yet, `null` = the read failed: neither may show a zero.
  const [report, setReport] = useState<UsageReport | null | undefined>(undefined);
  const gen = useRef(0);

  const read = useCallback(() => {
    const mine = ++gen.current;
    getOmniRouteUsage().then((r) => mine === gen.current && setReport(r), () => mine === gen.current && setReport(null));
  }, []);
  useEffect(() => {
    read();
    return () => {
      gen.current += 1;
    };
  }, [read]);

  const frozen = report && (!report.online ? T.frozenOffline : !report.authorized ? T.frozenUnauthorized : null);

  return (
    <div className="kb-panel">
      <div className="kb-bar">
        <Button size="sm" onClick={read}>{T.reread}</Button>
      </div>
      {report === undefined ? <p className="kb-note">{T.loading}</p> : report === null ? (
        <HonestState kind="offline" title={T.unreadable} hint={T.unreadableHint} />
      ) : (
        <>
          {frozen && <p className="kb-frozen" role="status">{frozen}</p>}
          <section className="g-glass kb-card" aria-label={T.period}>
            <h2 className="kb-h">{T.period}</h2>
            <KeyValue box items={[period(T.today, report.today), period(T.total, report.total)]} />
          </section>
          <section className="g-glass kb-card" aria-label={T.perModel}>
            <h2 className="kb-h">{T.perModel}</h2>
            {report.events.length === 0 ? (
              <HonestState kind="empty" title={T.empty} hint={T.emptyHint} />
            ) : (
              <>
                <p className="kb-note">{T.caption(num(report.events.length))}</p>
                <Table label={T.perModel} columns={COLUMNS} rows={fold(report.events)} rowKey={(r) => r.key} />
              </>
            )}
          </section>
        </>
      )}
      <section className="g-glass kb-card" aria-label={T.reports}>
        <h2 className="kb-h">{T.reports}</h2>
        <HonestState kind="offline" title={T.reportsOffline} />
        <p className="kb-note">{T.reportsNote}</p>
      </section>
    </div>
  );
}
