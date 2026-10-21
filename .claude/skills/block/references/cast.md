# The cast

Some books need a face, not a diagram. A field guide wants a character who points
at the clue. A memoir wants a small recurring drawing that makes a page feel like
part of a set. The engine cannot ship video — a print page holds no clip, and the
page runs no scripts — so the cast is a set of **original drawings, made of plain
SVG shapes, that print**.

The cast lives in `src/engine/tools/cast.mjs`. `node src/engine/tools/cast.mjs`
lists it; `node src/engine/tools/cast.mjs --sheet` writes `cast-sheet.html` so you
can look at the drawings before you use one.

## The rule that is not negotiable

**These characters are original.** They are not, and must never become, copies of
a cartoon that already exists. A recognizable character you do not own is a legal
problem, not a style choice, and a book that ships one is a book you cannot sell.
Draw a new creature with the same job, in the same shapes, and it is yours.

## The interface

```js
import { renderCast, renderCastRow, CAST, CAST_IDS } from './tools/cast.mjs';

renderCast('pip');            // one complete <svg>, ready to paste
renderCastRow(['pip','moss']); // several, evenly spaced, one <svg>
CAST.pip.name;                // 'Pip'
CAST.pip.role;                // 'the guide'
CAST_IDS;                     // ['pip','moss']
```

Paste the returned `<svg>` inside a `<div class="diagram">`, the same band a
diagram uses. The band is 200px tall and the drawing is square, so it centres.

## Current cast

| id   | name | role                | used for                          |
|------|------|---------------------|-----------------------------------|
| pip  | Pip  | the guide           | pointing at the clue to notice    |
| moss | Moss | the one who waits   | patience, the slow correct thing  |

## Drawing rules (for a new character)

- **Plain shapes only.** Circles, ellipses, rounded rectangles, short paths. No
  gradients, no filters, no embedded raster. It has to print and stay crisp.
- **See `pip` for the palette.** Body in the amber role, a scarf or marking in
  indigo, eyes and nose in ink. Keep the same weights so a new character sits
  beside the others without shouting.
- **Carry no text.** A drawing is text-free; every `<text>` in the band is added
  by the page and given an explicit `fill`, or it can inherit its way to
  invisible. The test suite enforces this.
- **Square viewBox** (`0 0 220 220`), so it drops into the band without a stretch.
- **One idea in the face.** Pip is "pointing". Give each new character one plain
  attitude a reader gets at a glance.

## Putting a character on a page

The band replaces the diagram or the photo, not both, and the page still obeys the
seven-part anatomy. A cast page says what the character is for, and the line beside
him is the one thing worth noticing. See `templates/field-guide/field-guide.html`
for a worked page. The caption goes in an explicit `<text fill="…">`, never in the
`aria-label` alone.
