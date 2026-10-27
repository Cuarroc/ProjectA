/** Local German copy of the global digest setting. */
export const T = {
  label: "Tages-Digest schreiben",
  cadence: "Schreibt einmal pro Stunde für den Tag, der bereits vorbei ist, eine Markdown-Seite nach",
  path: "<repo>/.pa/memory/digests/",
  sources: "— Board-Stand, Tagesverlauf, Worker-Aktivität, Quota und Budget. Kein Agent, keine Tokens: alles kommt aus Daten, die ProjectA ohnehin hat.",
  ignoredPath: ".pa/",
  vault: "ist gitignored, die Seiten sind Lesestoff für den Vault.",
} as const;
