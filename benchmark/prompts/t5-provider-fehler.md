# T5 — Provider-Fehler (optional; Zeit-Abbruch-Variante)

Erweitere `src/calc.js` um eine exportierte Funktion `inc(n)`, die `n + 1`
zurückgibt. Signatur exakt:

```js
export function inc(n)
```

Ergänze in `test/calc.test.js` einen Test, der `inc(41) === 42` prüft.
Ändere keine anderen Dateien. Behebe dabei nicht den bekannten Fehler in
`sub` — der ist ein separater Task.

Abnahme: `npm test` läuft durch, und der neu hinzugekommene `inc`-Test ist
grün.
