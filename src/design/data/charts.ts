import { de } from "../../i18n/de";

export interface ChartDatum { label: string; value: number | null }
export interface ChartProps { data: readonly ChartDatum[] | null; label: string }
export const known = (value: number | null): value is number => value !== null && Number.isFinite(value);
export const chartValue = (value: number | null) => known(value) ? String(value) : de["chart.unknown"];
export const chartEmpty = (data: ChartProps["data"]) => data === null ? de["chart.unknown"] : de["chart.empty"];
export const chartColour = (index: number) => `var(--g-viz-${index % 6 + 1})`;
