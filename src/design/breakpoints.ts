// Media queries cannot read custom properties, so these are the only widths CSS
// may use in @media (min-width / max-width); tokens-scale.test.ts enforces it.
export const BREAKPOINTS = { sm: 640, md: 900, lg: 1280 } as const;
