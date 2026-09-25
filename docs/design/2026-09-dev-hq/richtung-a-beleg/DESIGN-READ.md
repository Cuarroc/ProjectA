# Richtung A — DER BELEG

A critical edition of the project's state. The page is not a dashboard reporting
on a system; it is the **record** of that system, set the way a scholarly
apparatus is set — with a citation gutter running the whole length, hanging
indents, reference marks tying every assertion to its source, and a running head
carrying the folio. The apparatus is composed with as much care as the text,
because in this product the apparatus *is* the product: a number without a
reachable basis is not information here, it is decoration.

---

## The thesis

**No assertion stands alone on this sheet.** Every figure, every gate, every
lock carries a bracketed siglum — `[a]`, `[b]`, `[f]` — and every siglum has a
note in the left gutter, level with the line it serves. Hover or focus a mark
and its note reverses out; the tie is physical, not implied. That is the whole
argument of the design, and it is why the gutter is a *persistent structural
spine* rather than a sidebar that could be collapsed.

The second argument is that **a claim must be unable to impersonate a fact.**
The two are set as different kinds of object, not two colours of the same
object:

| | FACT | CLAIM |
|---|---|---|
| label | reversed solid — ink ground, plane letters | outlined, hairline, italic |
| weight | 900 | 300 |
| posture | upright | slanted |
| position | flush to the column | indented into a hanging apparatus band |
| siglum | filled square | hollow diamond |
| colour | never the signal colour | the signal colour, always |

Strip the colour and the distinction is entirely intact — reversal, weight,
slant, indent and mark all survive greyscale. Colour is the *fifth* redundant
cue, not the first.

## The system, and what it refuses

**One type size. 14px. Everywhere.** No headline size, no caption size, no
superscript. Rank is carried by weight (300–900 off the repo's own Recursive
variable face, referenced by relative path — `../../../dev-hq/fonts/`), by case,
by letterspacing, by reversal, and by rule. The reference marks are set at full
size as bracketed sigla rather than shrunk into superscripts, which is what a
1920s apparatus actually did. The consequence the constraint forces: the loudest
thing available for the release banner is **reversal** — a white band on the
dark sheet — which is exactly what a redaction stamp or a highlighter is. The
constraint produced the signature element rather than fighting it.

**A locked palette of five members.** `--ground` (the dark room), `--plane` (the
lit sheet), `--ink`, `--rule`, and `--signal`. Every other tone in the file is a
literal `color-mix(in oklab, <member> N%, <member>)` — the discipline is not
claimed in a comment, it is *provable by reading the stylesheet*. There are no
hex values outside the five. `--signal` (sulphur, the colour of a proofreader's
flag) appears in exactly one place: an unresolved CLAIM. It is not used for
errors, not for warnings, not for the failed state — that is the point of
reserving it.

**A single lit plane, no cards.** The topology is one continuous column of
record with its gutter. Sections divide by rule and space. There is no panel,
no tile, no nested container, no shadow. The "lamp" is a 6%-delta radial
luminance across the top of the sheet and a single lifted hairline at its top
edge — the sheet catching the light, nothing more.

**Refused:** the cream-and-serif rut; any second type size; the hero-metric
template (structurally impossible at one size — `19 · 13 · 6` sit inside the
heading sentence where they belong); kickers; section numbers; monospace worn as
a costume; gradient text; blur; progress rings; motion on any number, time or
log line.

## The one authored moment

The rules of the apparatus draw themselves, once. Every hairline in the sheet is
an absolutely-positioned 1px pseudo-element with `transform-origin: 0 50%`; on
load they run `scaleX(0) → 1`, 560ms, `cubic-bezier(.23,1,.32,1)`, staggered
40ms down the page. **No box that carries text is transformed** — an early draft
scaled the containers and squashed the type, which is precisely the AI-slop
failure this brief warns about. Nothing else moves, ever. There are no
transitions on the interactive states: the gutter note reverses instantly,
because a state change is not a journey.

Under `prefers-reduced-motion: reduce` the animation block simply never applies.
The default rendering *is* the finished sheet — nothing starts at zero opacity
or zero scale, so a reduced-motion reader gets the drawn page, not an invisible
one.

## Three states, without spending the signal colour

Not-queried, queried-and-empty, and failed are drawn as three conditions of the
same field: a dashed frame with dimmed label; a solid frame with a value slot;
and a frame filled with a hairline diagonal hatch. Failure could not borrow the
signal colour (reserved for claims), so it had to earn a non-chromatic device —
and the hatch, which is what an archivist strikes across a void, is better than
red would have been.

## What it would cost to build for real

- **Design system: ~2 days.** Five tokens, nine named mixes, one face, one size.
  This is the cheapest system in the four directions to specify and the
  cheapest to keep honest — there is no scale to drift and no palette to
  expand.
- **The apparatus binding: ~4–6 days.** The gutter must stay level with its
  referent as content reflows, which in a real app means every assertion is a
  record carrying `{ value, sourceRef, basis }` and the renderer emits the note
  beside it. That is a data-model change in the desk's backend, not a CSS job —
  and it is the change that makes the product true. It is also the only
  expensive part.
- **Sigla set: ~0.5 day.** Eleven drawn symbols, one stroke weight, one sprite.
- **The rest: ~2 days.** States, focus, keyboard order, live data binding.

Roughly **8–10 working days** to a real, non-mocked desk — with the honest note
that the middle line is a backend commitment, not a frontend estimate, and
that is exactly the kind of range this design would insist on displaying.

## The honest risk

1. **One type size is a real constraint, not a stylistic flourish.** It works
   here because the content is dense, uniform and read carefully by one expert.
   The moment someone needs to *scan* this page from three metres away, or the
   moment a section arrives that genuinely has a headline, the system will
   strain. The escape hatch — a second size — would dissolve the direction, so
   the honest answer is that this direction says no to that content rather than
   growing to fit it.

2. **The gutter costs about 250px of horizontal room, permanently.** At 1024
   that is a quarter of the viewport spent on apparatus. If the operator later
   wants side-by-side worker detail or a diff view, this topology has nowhere to
   put it. The gutter cannot collapse without the design losing its argument.

3. **Reversal is loud exactly once.** The release band works because it is the
   only reversed block above the fold. Two more stakeholders asking for "the
   same treatment" for their section would flatten the hierarchy completely, and
   there is no second-loudest device to give them.

4. **The lamp gradient is the one element I cannot fully defend on the evidence
   standard.** It makes the plane read as a lit sheet rather than a dark box,
   which is atmosphere, not information. It is held to a 6% luminance delta for
   that reason. If the contract is enforced literally, it is the first thing to
   cut — and the page survives the cut.

5. **The German strings sit inside English labels.** That is deliberate — the
   grip, the task titles and the spec names are quoted verbatim because
   paraphrasing a decision the desk did not make would be exactly the failure
   this direction exists to prevent. It does read as a seam. I consider the seam
   more honest than a translation.
