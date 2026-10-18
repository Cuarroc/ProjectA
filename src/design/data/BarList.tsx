import { chartColour, chartEmpty, chartValue, known, type ChartProps } from "./charts";
import "./charts.css";

export function BarList({ label, data }: ChartProps) {
  if (!data?.length) return <p>{chartEmpty(data)}</p>;
  const max = Math.max(...data.map(row => known(row.value) ? Math.abs(row.value) : 0)) || 1;
  return <ul className="g-bars" aria-label={label}>
    {data.map((row, i) => {
      const width = known(row.value) ? row.value / max * 48 : null;
      return <li key={i}>
        <span>{row.label}</span><span className="g-bars__value">{chartValue(row.value)}</span>
        <svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
          {width !== null && <rect x={50 + Math.min(0, width)} y="1" width={Math.abs(width)} height="6" fill={chartColour(i)} />}
        </svg>
      </li>;
    })}
  </ul>;
}
