// German words of the worker-diff size chip. Moves into the dictionary (src/i18n)
// once a component mounts it.
export const T = {
  noDiff: "noch kein Diff",
  within: (lines: number) => `${lines} Zeilen`,
  over: (lines: number, limit: number) => `${lines} Zeilen, über ${limit}`,
} as const;
