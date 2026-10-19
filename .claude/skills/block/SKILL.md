---
name: block
description: Write and lay out one finished page (a "block") for a book built on Proofpress, on the strict B5 canvas. One concept per page, in the book's own voice, with an inline SVG diagram or a generated photograph, an explainer, and an action box. Use this WHENEVER someone asks for a book page, a block, a new page for the book, a printable explainer, or says "make a block on X", "lay out X as a page", "write the page about X", or hands over a topic for a book in books/. It outputs one <section class="sheet bb"> written into the book's interior file, then verifies it with check.mjs and shot.mjs. It does NOT write blog posts, social posts, or flowing prose chapters.
---

# Block

## What this builds

One **page**. Not a chapter, not an article. A single B5 page that explains a single
concept to somebody who does not already understand it, and then tells them one thing to
go and do.

The page is one `<section class="sheet bb">` inside the book's interior file at
`books/<slug>/<slug>.html`. The look comes from `src/engine/themes/studio.css`. You write the
content, and nothing else: no layout CSS, no inline `<style>`, no `@media print`.

Every page has the same seven parts, in this order:

| Part | Markup | What it is |
|---|---|---|
| accent tab | `<div class="tab">` | a bar of the book's colour |
| eyebrow + pill | `<div class="top">` | the series label and the category |
| title + subtitle | `<h1 class="title">`, `<div class="sub">` | the concept, and what it means in plain words |
| band | `<div class="diagram">` or `<figure class="photo">` | ONE picture of the idea |
| explainer | `<div class="explain">` | two or three short paragraphs plus a closer |
| action box | `<div class="ask">` | the one thing to go and do |
| footer | `<div class="foot">` | brand, page number, part name |

`references/example-page.html` is a complete, working page. Copy it.

## Which page is this?

The seven parts never change. What changes is the **shape** of the explainer, and the
book says which shape it wants in `book.json` under `archetype`. Default `standard`.

| `archetype` | The explainer is |
|---|---|
| `standard` | plain prose. two or three `<p>`, then the closer. **no lists** |
| `procedure` | a numbered `<ol>` of steps, the last one being how you know it worked |
| `recipe` | a `<ul>` of what goes in, then an `<ol>` of how it is made |
| `exercise` | a `<p class="hl">` goal, then an `<ol>` of the task, then the check |
| `reference` | the answer in the first sentence, then a `<table class="ref">` |

Read `books/<slug>/book.json`. If it names an archetype, that is the page to write, and
its rules override the defaults below. Add `data-archetype="<id>"` to the `<section>`
when it is not `standard`, so the theme can dress the page:

```html
<section class="sheet bb" data-archetype="procedure">
```

A `<ul>`, `<ol>` or `<table>` on a `standard` page is a mistake, not a style choice:
`check` will not catch it, but `draft-block.mjs --archetype` validation will, and a
book that mixes the two shapes stops reading as one book.

## Before you write anything

**Step 0 — ask if they have their own thought to put in.** One question, every time:
do they have a take, a rough draft, a story, or specific wording they want in this page?

- If they give you something, that is the **primary material**. Build the page around
  their point and keep their wording verbatim. Fix real typos only. Never upgrade their
  phrasing.
- If they say no or "just go", write it yourself from `blocks.md`.
- If they already volunteered it in the request, skip the question.

Never skip this. It is their one chance to lead the page before you fill in the rest.

**Then read three files, in this order:**

1. `books/<slug>/blocks.md` — what this page is about. **Never invent the topic.**
2. `books/<slug>/VOICE.md` — how this book sounds. This is law.
3. `books/<slug>/book.json` — the chrome (series label, brand, whether pages are
   numbered) and which part the page belongs to.

## Step 1 — diagram or photo?

The band is one picture. Decide which kind before you write, because it changes the copy.

**A diagram**, when the thing being taught is a **mechanism**: a flow, a threat, a
before and after, a decision, a timeline. Write it as inline SVG. Never generate a
diagram as a picture: an image model garbles the labels, and you cannot edit the result.

Pick the shape from the type of idea. Full catalogue and copy-paste parts in
`references/diagram-system.md`.

| Type of idea | The point is | Shape |
|---|---|---|
| Attack | someone reaches something they should not | there and back across a boundary, red leak arrow |
| Resilience | it breaks under load or when something else dies | happy path plus a drop to a fallback |
| Performance | slow or expensive at scale | before and after, or a timeline |
| Correctness | a wrong result slips through | recompute and compare |
| Habit / practice | it only moves if you change the ask | a rising series against a flat line |
| Timing | when matters more than how much | a timeline with changing gaps |
| Protection | a buffer absorbs a shock | a hit, the buffer, the outcome |
| Two systems | something is handed over | a call and a response |

**A photograph**, when the thing being taught is **physical**: a dish, a plant, a
posture, a finished print, a tool held the right way. Something the reader has to
recognise by sight. See `references/photo-blocks.md`.

## Step 2 — draft the words, then stop

Write, as plain text, and **present it before building anything**:

- **title** — the concept, short. An acronym stays uppercase.
- **subtitle** — one line saying what it means, or expanding the acronym.
- **explainer** — the "Let's say…" opening, the real cost, the mechanism, the closer.
- **action** — the one thing to go and do, and the label for its box.
- **band plan** — one line: which shape, which boxes, or which photo.

Then **stop and wait.** Their edits are law: use their wording verbatim, fix only real
typos, never improve their phrasing. If they say skip the check and build it, build it.

## Step 3 — build the page

Read `references/design-rules.md` first. It is the accumulated list of things that have
gone wrong on real pages, and it wins over the general guidance when they disagree.

1. Copy one `.bb` section from `references/example-page.html` into
   `books/<slug>/<slug>.html`, in the right place.
2. Write the band. Diagram: `viewBox="0 0 592 <H>"`, H around 200. Photo: generate it
   with `src/engine/tools/gen-image.mjs`, save it to `books/<slug>/images/`, and save the
   prompt beside it as `<name>.txt`.
3. Write the explainer with the role colours as emphasis spans: `.bad` red for the pain,
   `.hl` indigo for the idea, `.good` teal for the outcome, `strong` for a key phrase.
   End with `<p class="close">`.
4. Write the action box from the block's Action line.
5. Add the page's title to its part in `books/<slug>/book.json`, or it will not be in
   the book. The builder tells you if you forget.

## Step 4 — verify, and actually look

```bash
node src/engine/tools/build-book.mjs books/<slug>     # assemble
node src/engine/tools/check.mjs books/<slug>/book.html  # MUST be 0 mm on every page
node src/engine/tools/shot.mjs  books/<slug>/book.html  # then READ the PNGs
```

`check.mjs` proves the page fits. It cannot see overlap, a clipped label, a squashed
row, a photo cropped through the subject, or a diagram that confidently says the wrong
thing. **Open the PNG and look at it.** A page is not done until you have.

If it overflows, **cut words**. Do not shrink the viewBox to make it fit: that clips the
bottom of the drawing instead of fixing anything.

## Hard rules

- **Never invent the topic.** It comes from `blocks.md`.
- **Never fabricate** a number, a study, a quote, or a personal story.
- **No em dashes.** Commas or full stops.
- **Write for someone who does not know the term.** The only unfamiliar word allowed is
  the name of the block.
- **Colour is a role, not decoration.** Indigo is the mechanism, teal the good outcome,
  red the threat or the mistake, amber the thing worth protecting, neutral you or your
  app. Same meaning on every page of the book.
- **Set every colour explicitly**, including a `fill` on every SVG `<text>`. Inherited
  colours get overridden and go invisible.
- **The theme owns layout.** One block is one `.sheet bb`. Never let it overflow.

## References

- `references/voice.md` — the default voice, and why each rule is there. The book's own
  `VOICE.md` overrides it.
- `references/diagram-system.md` — the SVG vocabulary, the colour roles, copy-paste
  parts, and the shape catalogue.
- `references/design-rules.md` — accumulated corrections. Newest wins.
- `references/photo-blocks.md` — when a photo beats a diagram, and how to prompt for one.
- `references/page-template.md` — the design tokens and the page anatomy.
- `references/example-page.html` — a complete working page. Copy this.
