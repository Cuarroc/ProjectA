# T1 — Bugfix

Im Repository ist der Testlauf rot: `npm test` schlägt fehl, weil der Test
`sub subtracts the second number from the first` in `test/calc.test.js`
fehlschlägt.

Behebe den Fehler ausschließlich in `src/calc.js`. Ändere keine andere Datei
— insbesondere nicht den Test und nicht `package.json`.

Abnahme: `npm test` ist grün, und der Diff gegen den Basis-Commit berührt nur
`src/calc.js`.
