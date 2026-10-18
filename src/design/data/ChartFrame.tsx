export interface ChartDatum { label: string; value: number | null }
export interface ChartProps { data: readonly ChartDatum[] | null; label: string }
export function ChartFrame(_props: { title: string; caption: string; kind: "sparkline" | "bars"; data: readonly ChartDatum[] | null }) { return null; }
