# The design kit

Two things a page about a *mechanism* does not need, and a page about a *place* or a
*body* does:

- an **isometric** scene: real 3D-looking solids on a grid, for a thing with volume and
  layers;
- a **stick figure**: a jointed body in a named pose, for an idea that is somebody
  noticing, walking, waving, or pointing.

Both compile from a small JSON spec, exactly like `diagram.mjs`. Same spec in, same
bytes out, every `<text>` given an explicit `fill`, and the result passes the page's own
`checkDiagram()`. A figure cannot reach a book broken.

```js
import { compileFigure, exampleSpec } from '../../src/engine/tools/figures.mjs';

compileFigure({ kind: 'isoStack', layers: [
  { label: 'WAF', role: 'bad' },
  { label: 'App', role: 'mechanism' },
  { label: 'Database', role: 'sensitive' },
]});
```

From the command line:

```bash
node src/engine/tools/gen-figure.mjs --list                  # the catalog and the poses
node src/engine/tools/gen-figure.mjs --example isoStack       # a starter spec
node src/engine/tools/gen-figure.mjs spec.json --out figure.svg
node src/engine/tools/gen-figure.mjs --sheet                  # write figures-sheet.html, then LOOK
```

Paste the printed `<svg>` inside the page's `<div class="diagram">`, the same band a
diagram uses. Never hand-write the geometry: the projection is computed, and the bugs in
hand-drawn isometric art (a face that does not meet its edge, a label off the canvas) come
from re-solving it by eye.

## Colour is a role, here too

The palette is `diagram.mjs`'s, verbatim, so a figure and a diagram on facing pages read
as one book:

| role | meaning | used for the |
|---|---|---|
| `neutral` | you, your app, structure | ground, platform, plain blocks |
| `mechanism` | the thing being taught | the layer that does the work |
| `good` | the outcome you want | what passes, what survives |
| `bad` | the threat or the mistake | the attacker's layer, the missing layer, the fall |
| `sensitive` | the valuable thing | what is being protected |

An isometric solid needs three faces; you name **one** role and the compiler shades the
front and side faces from it, so a block reads as solid without you choosing three
colours. Stick figures are ink (`#1F2937`), not a role colour, because a body is a body,
not an outcome.

## Isometric: when the idea is a thing with volume

| kind | the shape | reaches for it when |
|---|---|---|
| `isoStack` | layers stacked up, bottom first | defence in depth, what sits under what, how many walls an attacker crosses |
| `isoSlab` | one platform with the protected object standing on it | the ground you keep safe; the thing on top of it |
| `isoGrid` | a grid of labelled cells | a matrix, a board, a set of slots to fill |
| `isoPit` | a sunken hole in a rim | the missing layer, the trap, the gap you fall through |
| `isoRow` | a row of solids that can grow | a series with volume: v1, v2, v3; small, medium, large |

An `isoStack` puts a label on the top face of every layer. Read bottom-up, it is a
sentence: *first this, then this, then this.*

## Stick: when the idea is a body doing something

A figure is a skeleton of joints drawn as round-capped lines plus a head. The limbs carry
`.m-arm` / `.m-leg` / `.m-body`, so on a motion book the runtime can buckle them; on paper
they are simply a drawing and the page never moves.

| pose | the body is | reaches for it when |
|---|---|---|
| `idle` | standing | the reader, waiting |
| `walk` | mid-stride | the happy path, one step at a time |
| `run` | leaning, fast | speed, the race, the burst |
| `wave` | arm up, greeting | the guide waving you in |
| `point` | arm out to the side | notice *this* |
| `reach` | both arms up | reach for the thing that is yours |
| `fall` | off balance | the drop into the pit, the mistake |
| `sit` | seated | patience, waiting it out |

Three kinds put a figure on the page:

- `stickPose` — one figure and a caption. The plainest gesture.
- `stickPair` — two figures with an optional arrow and label between them. A guide and a
  reader; a sender and a receiver.
- `stickAction` — one figure acting on a labelled block. The block is a plain card in a
  role colour; the figure points at it. This is the shape for "here is the clue" and
  "here is the rule".

## Rules that are not negotiable

- **The theme owns layout, and the band is 200px tall.** Keep the figure's height near
  200 to 320 so it sits in the band without crowding the explainer.
- **A figure carries its own text only through the spec.** The stick drawings are
  text-free; every label the reader sees is a `<text>` the compiler gives a `fill`. Never
  rely on an inherited colour.
- **Do not draw off the canvas.** The compiler and `checkDiagram()` both refuse it, so a
  figure that would clip fails before it reaches a page.
- **A figure is one picture in the band**, the same slot a diagram or a photo uses. It
  does not stack with them.
- **These drawings are original.** A stick figure built from lines is nobody's property;
  keep it that way, and never trace a character that already exists.
