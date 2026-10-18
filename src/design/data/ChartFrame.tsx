import { useId } from "react";
import { de } from "../../i18n/de";
import { BarList } from "./BarList";
import { Sparkline } from "./Sparkline";
import "./data.css";
import { chartColour, chartEmpty, chartValue, type ChartProps } from "./charts";
import "./charts.css";

export interface ChartFrameProps {
  title: string;
  caption: string;
  kind: "sparkline" | "bars";
  data: ChartProps["data"];
}

/** One dataset drives both the graphic and its mandatory table twin. */
export function ChartFrame({ title, caption, kind, data }: ChartFrameProps) {
  const id = useId();
  const legend = kind === "sparkline" ? [title] : (data ?? []).map(row => row.label);
  return <figure className="g-chart" aria-labelledby={id}>
    <figcaption><h3 id={id}>{title}</h3><p>{caption}</p></figcaption>
    <ul className="g-chart__legend" aria-label={de["chart.legend"]}>
      {legend.map((label, i) => <li key={i}><i aria-hidden="true" style={{ background: chartColour(i) }} />{label}</li>)}
    </ul>
    {kind === "sparkline" ? <Sparkline label={title} data={data} /> : <BarList label={title} data={data} />}
    <details>
      <summary>{de["chart.table"]}</summary>
      {data?.length ? <div className="g-tw" role="region" aria-label={title} tabIndex={0}>
        <table className="g-tbl" aria-label={title}>
          <thead><tr><th scope="col">{de["chart.label"]}</th><th scope="col" className="g-tbl__n">{de["chart.value"]}</th></tr></thead>
          <tbody>{data.map((row, i) => <tr key={i}><th scope="row">{row.label}</th><td className="g-tbl__n">{chartValue(row.value)}</td></tr>)}</tbody>
        </table>
      </div> : <p>{chartEmpty(data)}</p>}
    </details>
  </figure>;
}
