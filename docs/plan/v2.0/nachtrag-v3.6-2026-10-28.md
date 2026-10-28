# Nachtrag zu v3.6 (nur Text)

Stand: 28.10.2026, Berlin. Verfasser: Alfred. Abnahme: Root. Eintrag in `docs/PLAN.md`: der Stabschef, per eigenem Doku-PR.

## 0. Bindung und Grenzen

- **Basis, unverändert:** Unterplan v3.6, SHA256 `f4696eb52f57f43bf6021d19f332391b5874b0356b39de1fb4e957fa33e55720`; Root-Auftrag v3.6, SHA256 `18c91341ccf8703f044f764054f01646e4c39d02c6b82bf12e97e0b5c6318366`. Dieser Nachtrag ändert beide Dateien nicht und ist keine v3.7. Die Zeilennummern unten beziehen sich auf die Datei `designsystem-unterplan-v3_6.md` (2750 Zeilen, Box: `/workspace/plan-check/designsystem-unterplan-v3_6.md`).
- **Rechtsgrundlage:** Teil 7.1 Fall 1 (Klarstellung innerhalb des Ergebnisses; Zeile 628) für N2, N3 und N4. N1 (12 px) ist zusätzlich Elias' eigene klare Anweisung, die nach Teil 7.1 sofort gilt.
- **Keine Freigabe:** Alles hier ist Elias' Wunsch bzw. Entscheidung, nur Text. Es ist keine Bau-Freigabe, keine Stufe-3-Freigabe und keine neue geschützte Befugnis. Es startet nichts (kein Schriftumbau, kein Dienst, kein Zeit-Auslöser, kein Gate-Lauf).
- **Eigener Hash:** Ein Hash kann nicht in der Datei stehen, die er prüft. Der SHA256 dieses Nachtrags steht in der Begleitnotiz der Zustellung (Datei `inbox\alfred\…-nachtrag-v3_6.md`) und in Alfreds Meldung. Er gilt für den Text ab der Überschrift „# Nachtrag zu v3.6 (nur Text)“ bis zum Dateiende.
- **Schreibweise:** Dieser Nachtrag nutzt echte Umlaute. Textstellen aus v3.6, die als „alt“ zitiert werden, stehen wörtlich so, wie v3.6 sie hat (ASCII-Umschrift, ae/oe/ue/ss). Wo der Stabschef in `docs/PLAN.md` einträgt, gilt die dort übliche Schreibweise; der Inhalt ändert sich dadurch nicht.

## N1. Mindestschrift 12 px für alle Texte in der App (ersetzt die Zwischenregel B-32)

**Grundlage.** Elias' Kartenantwort vom 28.10.2026, 15:57 Berlin, wörtlich: „Mindestens 12 Pixel“. Die Karte stellte Teil 8 Nr 23 Punkt 4 (Zeile 672) zur Wahl; Alfreds Empfehlung dort war „12 Pixel als Untergrenze für alle Texte“. Alfred hat Wortlaut und Uhrzeit an Root gemeldet; Root hat sie als Elias' Anweisung gewertet (Roots Nachtrag zur Ergänzung 16:15, Regel A2).

**Lesart.** „Mindestens 12 Pixel“ heißt: **12 px ist die Untergrenze für alle Texte in der App.** Die Ausnahme „11 px nur für rein dekorative Beschriftungen“ aus B-32 entfällt. Das ist die Lesart von Root und Alfred. **Elias kann sie jederzeit widerrufen oder enger fassen** (zum Beispiel doch eine kleinere Schrift für Dekoratives erlauben); sein neuerer Satz gilt dann sofort (Teil 7.1).

**Bezugszeilen und Änderung.**

| Stelle in v3.6 | Neuer Wortlaut |
|---|---|
| Zeile 895 (Teil B7, Nr 2). Alt: „Nichts unter 12 px als Lesetext. **Zwischenregel (B-32):** Statuswoerter und Beleg-Chips sind mindestens 12 px; 11 px nur fuer rein dekorative Beschriftungen mit gesichertem Kontrast. Die endgueltige Untergrenze entscheidet Elias (Teil 8 Nr 23).“ | „Nichts unter 12 px, bei keinem Text in der App (Lesetext, Statuswörter, Beleg-Chips, Beschriftungen). **ENTSCHIEDEN (Elias, 28.10.2026, 15:57 Berlin, „Mindestens 12 Pixel“; Lesart Root und Alfred, Elias kann widerrufen):** Die Zwischenregel B-32 mit der 11-px-Ausnahme entfällt.“ |
| Zeile 672 (Teil 8 Nr 23, Punkt 4 „Kleinste Schriftgröße (B-32)“) | Punkt 4 gilt als **entschieden**: 12 px als Untergrenze für alle Texte. Er wandert aus der Liste „Offen für Elias“. Punkt 1 ist bereits durch Elias’ Planfreigabe samt Satz 2 erledigt. Offen bleiben 2, 3 und 5 im jeweils benannten Zeitpunkt. Die Empfehlung (4) bleibt als Begründung stehen. |
| Zeile 1963 (Teil F, Schriftgrößen, „nicht kleiner als 12 px normal und 14 px halbfett“) | Zeile 1963 bleibt unverändert als Quellenempfehlung (Fluent). Dieser Nachtrag bestätigt die 12-px-Untergrenze; er beschließt keinen zusätzlichen 14-px-Mindestwert für halbfette Schrift. |

**Wirkung auf die Arbeit.**

- Jedes Paket, das Text in der App anfasst, zeigt in seinem Abschluss die kleinste verwendete Schriftgröße (Token- oder Testbeleg, nach Prüfanleitung) und darf nicht unter 12 px liegen.
- Bestehende Ansichten mit kleinerer Schrift werden **nicht jetzt und nicht still** umgebaut, sondern in dem Paket, das die Ansicht ohnehin anfasst (Teil 5.2, MS-1). Dieser Nachtrag startet keinen Schriftumbau.

## N2. Feinschliff Zeile 628 (Teil 7.1, Fall 1)

- **Alt (Zeile 628, Ende):** „Root laesst weiterbauen, schreibt die Klarstellung in `docs/` und nennt sie in der naechsten Statusmeldung.“
- **Neu:** „Root lässt weiterbauen, lässt die Klarstellung über einen normalen Doku-PR in `docs/` eintragen (den Eintrag in `docs/PLAN.md` macht der Stabschef) und nennt sie in der nächsten Statusmeldung.“
- **Grund:** Die Rollenverteilung in v3.6 (Teil 5.3 und Teil 0.4 Nr 7; Zeile 519: `docs/PLAN.md` hat einen einzigen Pflegeweg über normale PRs) lässt den Stabschef den Plan pflegen. Root entscheidet und nimmt ab, schreibt aber nicht selbst. Der Fall selbst (Lücke füllen, Ergebnis nicht ändern) bleibt gleich.

## N3. B-29 (F2): Begriffe für die Begriffsliste, vorformulierter Wortlaut

**Stelle:** Teil F, F2, Begriffsliste (Zeile 1508 bis 1541). Die sieben Zeilen kommen **am Ende der Tabelle**, hinter Zeile 1540 („unbekannt“) und vor Zeile 1541 („Massgeblich ist diese Liste …“). Sie sind kurze Bedeutungen mit Verweis, **keine zweite Definition**; maßgeblich bleibt der genannte Teil. In der Spalte „Nicht benutzen“ steht nur, was der Plan selbst sagt; sonst „—“ (Elias oder Root können dort später ergänzen).

| Begriff | Bedeutung | Nicht benutzen |
|---|---|---|
| Wartet auf dich | Name des Eingangs und eines der sechs Zustände: etwas wartet auf Elias’ Entscheidung oder Freigabe (Teil 0.4 Nr 14, Teil 9.3, 9.4); ersetzt „Braucht dich“ | Braucht dich (nur noch in der Historie) |
| Postfach | der eine Eingang „Wartet auf dich“ im Bereich Haupt, die einzige Sammelstelle für Entscheidungen (Teil 9.4) | — |
| Freigabe vorbereiten | Die Karte legt eine Freigabe fertig hin und zeigt die Wirkung; sie **erteilt** sie nicht, das tut nur Elias mit eigenem Satz (Teil 9.4; Zeile 2630) | — |
| Zustandswörter | die sechs Zustände in fester Schreibweise: Läuft, Wartet auf dich, Fertig mit Beleg, Problem, Ruhig, Unbelegt; immer Wort, Form und Farbe zusammen (Teil 9.3) | — |
| Lieferstufe | eine der fünf Stufen von „Quelllieferung“ bis zur Abnahme (Teil 6.1); nicht zu verwechseln mit den sechs Zuständen | — |
| Klartext-Karte | die Karte mit den fünf festen Zeilen: Satz, Zustand, Beleg, Nächstes und Von dir, Details (Teil 9.2) | — |
| Bildfreigabe | Elias’ eigener Satz zu einem Vorschau-Bild; ohne sein wörtliches Zitat ungültig (Teil 9.9, MS-1a) | — |

- **Zeile 2095 (Teil Q4, Nr 11), Satz „Noch zu ergaenzen (Textauftrag B-29 …)“:** Nach dem Eintrag wird der Hinweis auf „noch zu ergänzen“ gestrichen und ersetzt durch „ergänzt durch den Nachtrag zu v3.6, N3 (B-29)“. Der **bereits abgelöste Teilsatz** („Root“ und „der Orchestrator“ nie als Synonyme, abgelöst von Elias, 05:19) bleibt **wörtlich unverändert** in der Zeile stehen; er wird nicht umgeschrieben.
- **Bestehende Zeilen bleiben:** „Root (AgentsRoom)“, „Root der App“, „Freigabe“ und „Beleg“ (Zeilen 1516, 1517, 1531, 1532) ändern sich nicht. „Bildfreigabe“ ist ein eigener Begriff neben „Freigabe“, kein Ersatz.

## N4. Abendbericht: Satz für Teil 7.2 (Statusmeldung)

**Stelle:** Teil 7.2, Zeile 633 bis 641. Dort steht in Zeile 634: „Nur bei **Zustandswechsel** oder **auf Wunsch**, nie im Takt.“ Der Abendbericht ist Elias’ Wunsch (Alfred, 28.10.2026); Root hat ihn als gewünschte Statusmeldung übernommen und schreibt ihn täglich gegen 20:00 Uhr Berlin.

**Neuer Satz, einzufügen hinter Zeile 641 („Keine Befehle, keine Hash-Listen …“):**

„**Abendbericht (auf Wunsch von Elias):** Root schreibt täglich gegen 20:00 Uhr Berlin eine Statusmeldung nach 7.2, **höchstens 6 Zeilen**: was fertig ist (PR und CI-Beleg), was als Nächstes kommt, und wie ausgelastet Server und PC waren (Leerlauf). Das ist die Meldung ‚auf Wunsch‘, kein neuer Dienst und kein neuer Auslöser. Zahlen nur mit Quelle, Zeiten in Berlin. Was erst „integriert“ ist (Lieferstufe 3), heißt nicht ‚fertig‘; geforderte Stufen 4 und 5 bleiben sichtbar offen. Entscheidungen, Fragen zur Rechtestufe 3, Stopps und Elias’ Nachfragen gehen weiterhin sofort und warten nicht auf den Abendbericht.“

Zeile 634 bleibt unverändert; der neue Satz ist die Ausführung ihres Teils „auf Wunsch“.

## N5. Punkte 1, 4 und e aus Alfreds Ergänzung 16:15

Root führt sie **nicht mehr als offen**: Er hat sie in seinem Nachtrag zur Ergänzung (16:20 Berlin) übernommen (Punkt 1 und e) bzw. als gewünschte Statusmeldung eingeordnet (Punkt 4, hier N4). Sie sind Betriebsregeln für Root und Stabschef, **kein Plantext**, und stehen deshalb nicht in diesem Nachtrag. Einzige Ausnahme ist der Abendberichts-Satz in N4. PK-05 ist durch Root bestätigt: Nach zwei Fehlversuchen stoppt die betroffene Spur; Root entscheidet vor Wiederaufnahme, danach disponiert der Stabschef. Die Betriebsregel bleibt außerhalb der Plantextänderung.

## N6. Zusammenfassung für Root und Stabschef

1. N1: 12 px für alle Texte; B-32 und die 11-px-Ausnahme entfallen (Zeilen 895, 672; Zeile 1963 unverändert).
2. N2: Zeile 628, der Stabschef trägt die Klarstellung in `docs/` ein bzw. lässt sie eintragen.
3. N3: sieben Begriffe am Ende der Begriffsliste (hinter Zeile 1540); Zeile 2095 verweist auf den Nachtrag; abgelöster Teilsatz bleibt.
4. N4: Abendbericht-Satz in Teil 7.2 (hinter Zeile 641).
5. Der Nachtrag ändert kein Recht und startet nichts. v3.6 und der Root-Auftrag bleiben bytegleich (Hashes oben).
