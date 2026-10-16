// DS-X-14: the one catalogue of design components. `registry.coverage.test.ts`
// keeps it in step with the `export function` components under src/design.

export type ComponentFamily = "controls" | "data" | "fabrik" | "hall" | "inputs" | "layout" | "state";

export interface ComponentEntry {
  /** The exported function name. */
  name: string;
  /** The directory under src/design that holds the file. */
  family: ComponentFamily;
  /** Props that change the look, with their values. */
  variants: readonly string[];
  /** Conditions the component draws differently, including missing data. */
  states: readonly string[];
  /** What keyboard and screen reader users get, or must supply. */
  a11y: string;
  /** Where the words on screen come from. */
  text: string;
}

export const COMPONENT_REGISTRY: readonly ComponentEntry[] = [];
