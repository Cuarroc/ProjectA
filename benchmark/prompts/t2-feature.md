# T2 — Feature

Erweitere `src/calc.js` um eine exportierte Funktion `mul(a, b)`, die das
Produkt der beiden Zahlen zurückgibt. Signatur exakt:

```js
export function mul(a, b)
```

Ergänze in `test/calc.test.js` einen Test, der mindestens `mul(6, 7) === 42`
und `mul(-2, 3) === -6` prüft.

Ändere keine anderen Dateien. Behebe dabei nicht den bekannten Fehler in
`sub` — der ist ein separater Task.

Abnahme: `npm test` läuft durch, und der neu hinzugekommene `mul`-Test ist
grün.
