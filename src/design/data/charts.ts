import { de } from "../../i18n/de";

export interface ChartDatum { label: string; value: number | null }
export interface ChartProps { data: readonly ChartDatum[] | null; label: string }
const numberFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 });
export const known = (value: number | null): value is number => value !== null && Number.isFinite(value);
export const chartValue = (value: number | null) => known(value) ? numberFormat.format(value) : de["state.unknown"];
export const chartEmpty = (data: ChartProps["data"]) => data === null ? de["state.unknown"] : de["chart.empty"];
export const chartColour = (index: number) => `var(--g-viz-${index % 6 + 1})`;
