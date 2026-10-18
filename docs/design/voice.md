# Voice rules (German UI text)

The words in the app are German and live in `src/i18n/de.ts` ([BUILDING.md](BUILDING.md) rule 3). These eight
rules say how they sound. Check a new string against all eight before it goes into the dictionary.

1. **Du, present tense, short sentences.** No „bitte", no exclamation marks.
   „Starte den Agenten neu." not „Bitte starten Sie den Agenten neu!"
2. **Titles are nouns, buttons are verbs of at most two words.**
   Titles: Warteschlange, Wachhund. Buttons: Einreihen, Öffnen, Projekt wählen.
3. **An empty state says what is empty and what to do next.** Title of at most four words, one hint sentence,
   an optional action. Never a number (the digit guard in `HonestState` stays).
   „Keine Aufträge" / „Reihe einen Auftrag ein, damit hier etwas läuft."
4. **Unknown stays unknown, and is said once per surface,** not once per field.
   „Beweis: noch nicht verbunden" on the strip, not on every card line.
5. **Status words come only from `de.ts` (`state.*`).** A new status word needs a dictionary entry and a gallery
   page. See `src/design/state/states.ts`.
6. **A control and its section heading never share a label.** Heading „Darstellung" above a button
   „Darstellung" is wrong; name the action („Darstellung ändern") or the heading differently.
7. **Safety controls state the consequence in full, never truncated.** Not-Aus and Löschen show the whole
   sentence on a visible line, or in a tooltip that also opens on keyboard focus.
8. **Times and units are short and the same everywhere:** „vor 4 Min.", „seit 3 Std.", „seit 2 Tg." Use the one
   helper `ageText` (`src/screens/leitstand/leitstand.ts`) for all of them; do not write `T` for days.

Also: a rule or promise is not an item. „Geld ausgeben braucht deine Freigabe." belongs in a quiet note, not in
a list that reads as open tasks.
