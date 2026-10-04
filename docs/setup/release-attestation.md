# Release-Bestätigung für v1.5.0

Die App-Freigabe v1.5.0 gilt nur, wenn **du selbst** deine Abnahme bestätigst
(Entscheidung E20). Kein Agent legt die Datei `.pa/release_attestation_v1.5.0.json`
an oder ändert sie, und DevHQ bestätigt nie etwas.

1. Prüfe alle 26 Zeilen der Abnahme und entscheide selbst.
2. Lege die Datei mit genau diesen Feldern an: `release` (`"v1.5.0"`), `commit`
   (Ausgabe von `git rev-parse HEAD`), `rows` (`[1,2,…,26]`), `decidedAt`
   (ISO 8601, z. B. `2026-10-05T10:00:00Z`), `decidedBy` (dein Kürzel) und
   `continuousEnabled` (`false`). Weitere oder fehlende Felder lehnt die Prüfung ab.
3. Committe nur diese Datei; der Arbeitsbaum muss sonst sauber sein.
4. Prüfe mit `npm run dev:continuous-audit -- --attestation .pa/release_attestation_v1.5.0.json`.
   Exit 0 heißt: freigabefähig. Jede spätere Code-Änderung macht die Bestätigung ungültig.
