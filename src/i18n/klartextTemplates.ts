export const klartextTemplates = {
  work: "{Agent} baut gerade {Paket}; {n} von {m} Schritten sind fertig.",
  decision: "{Agent} wartet bei {Paket} auf deine Entscheidung.",
  problem: "{Agent} meldet ein Problem bei {Paket}.",
  result: "{Agent} hat {Paket} mit Beleg abgeschlossen.",
  unknown: "Der Stand ist unbekannt.",
  countUnknown: "Der Fortschritt ist unbekannt.",
  proofMissing: "Das Ergebnis ist unbelegt.",
  overflow: "Der Stand ist unbekannt; der Satz überschreitet die Wortgrenze.",
} as const;
