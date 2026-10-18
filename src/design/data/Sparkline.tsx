import { de } from "../../i18n/de";
import { chartEmpty, known, type ChartProps } from "./charts";
import "./charts.css";

export function Sparkline({ label, data }: ChartProps) {
  const values = (data ?? []).map(row => row.value).filter(known);
  if (!values.length) return <p>{data?.length ? de["state.unknown"] : chartEmpty(data)}</p>;
  // Normalize first so even opposite finite extremes cannot overflow the range.
  const scale = Math.max(...values.map(Math.abs)) || 1;
  const min = Math.min(...values) / scale, max = Math.max(...values) / scale;
  const points = data!.map((row, i) => known(row.value)
    ? [data!.length === 1 ? 60 : 2 + i * 116 / (data!.length - 1), max === min ? 16 : 30 - (row.value / scale - min) / (max - min) * 28]
    : null);
  const path = points.map((p, i) => p ? `${i && points[i - 1] ? "L" : "M"}${p.join(",")}` : "").filter(Boolean).join(" ");
  return <span className="g-spark">
    <svg viewBox="0 0 120 32" role="img" aria-label={label}>
      <path d={path} />
      {points.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r="1.5" />)}
    </svg>
    {values.length < data!.length && <span>{de["state.unknown"]}</span>}
  </span>;
}
