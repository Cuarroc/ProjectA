// German words of the flow graph. Moves into the dictionary (src/i18n) once
// the route mounts it.
export const T = {
  label: "Ablauf der Agenten",
  empty: "Noch keine Agenten im Ablauf",
  edge: "{parent} startete {child}",
} as const;

/** Not a word, but kept here so the component holds no string literal with spaces. */
export const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
