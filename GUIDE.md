# The guide

From an empty folder to a printable book, in one sitting.

You do not need to read this in order. If you just want to see the thing work, do
[Setup](#setup) and [Your first build](#your-first-build) and stop there, about five
minutes. The rest is for when you start writing your own.

- [What you are making](#what-you-are-making)
- [Setup](#setup)
- [Your first build](#your-first-build)
- [Start your own book](#start-your-own-book)
- [`book.json`, field by field](#bookjson-field-by-field)
- [`VOICE.md`, the file that decides how it reads](#voicemd-the-file-that-decides-how-it-reads)
- [`blocks.md`, planning the pages](#blocksmd-planning-the-pages)
- [Writing a page](#writing-a-page)
- [The markup of a page](#the-markup-of-a-page)
- [Diagrams](#diagrams)
- [Photographs](#photographs)
- [Check, then look](#check-then-look)
- [Editions: one file, more than one book](#editions-one-file-more-than-one-book)
- [Making it a real book](#making-it-a-real-book)
- [Changing the look](#changing-the-look)
- [When something goes wrong](#when-something-goes-wrong)

---

## What you are making

A book where **one page explains one thing**, completely, and then tells the reader one
thing to go and do.

That constraint is the whole idea. You never sit down to write a book, which is
paralysing. You sit down to write **one page**, which is an afternoon. Do it two hundred
times and you have a book, and you can stop at any number and still have something worth
reading.

![One finished page: an accent tab, an eyebrow and category pill, a title and subtitle, a diagram band, the explainer, the action box, and the running footer.](docs/images/page-anatomy.png)

Every page has the same seven parts, always in this order:

| Part | What it is |
|---|---|
| accent tab | a short bar in your book's colour |
| eyebrow + pill | your series name, and the category of this page |
| title + subtitle | the thing being taught, and what it means in plain words |
| **band** | ONE picture of the idea: a diagram, or a photograph |
| explainer | two or three short paragraphs, ending on a line that sticks |
| action box | the one thing to go and do |
| footer | your site, the page number, the part name |

Because every page is the same shape, the reader learns the shape once and then reads
faster for the rest of the book. That is worth more than variety.

The page is a **rigid box, 176 by 250 millimetres**, which is B5, a normal trade
paperback size. The same CSS draws it on screen and on paper, so what you see is what
prints. Nothing reflows, nothing shifts when you export.

---

## Setup

You need [Node](https://nodejs.org) 18 or newer. Nothing else, and no account anywhere.

```bash
git clone https://github.com/hassancs91/paper-engine
cd paper-engine
npm install
npx playwright install chromium
```

That second install is a headless copy of Chrome. It is what measures your pages and
turns them into a PDF, which is why the PDF matches the screen exactly: the same browser
draws both.

## Your first build

Before you write anything, build the book that ships with the repo. If this works, your
setup is fine.

```bash
npm run build  -- books/showcase              # -> books/showcase/book.html
npm run check  -- books/showcase/book.html    # every page must say 0 mm
npm run shot   -- books/showcase/book.html    # one PNG per page
npm run export -- books/showcase/book.html    # -> books/showcase/book.pdf
```

Open `books/showcase/book.html` in a browser. The pages sit on a dark desk, and each one
is the real B5 sheet at real size. Open `book.pdf` next to it. They are the same.

Ten pages, ten unrelated subjects, on purpose: cooking, coffee, gardening, travel,
photography, fitness, language, chess, money, code. The engine does not care what your
book is about.

---

## Start your own book

```bash
cp -r books/starter books/my-book
mv books/my-book/starter.html books/my-book/my-book.html
```

A book is a folder with four files that matter:

```
books/my-book/
  book.json      what gets printed, and the running order
  my-book.html   YOUR PAGES. this is the file you write in.
  VOICE.md       how your book sounds
  blocks.md      the list of pages you mean to write
  book.html      GENERATED. never edit this.
```

The folder must sit **exactly two levels deep**, at `books/<name>/`, because every page
links out to `../../engine/`. Move it deeper or shallower and the pages lose their
styling.

Rename the interior file to match the folder (`my-book/my-book.html`), or say what it is
called with `"interior"` in `book.json`.

Now build it, so you have something working before you change anything:

```bash
npm run build -- books/my-book
```

## `book.json`, field by field

This one file decides everything printed around your pages, and the order they come in.

```json
{
  "title": "My First Book",
  "subtitle": "One idea per page, and every page is the same shape.",
  "author": "Your Name",

  "series": "My first book",
  "brand": "yoursite.com",
  "editionLabel": "Edition 1.0",
  "unit": "blocks",

  "numbered": true,
  "contents": true,
  "index": true,

  "cover":     { "kicker": "A paper-engine book", "note": "Written one block at a time." },
  "copyright": { "year": 2026, "rights": "© 2026 Your Name. All rights reserved.",
                 "lines": ["Set in Space Grotesk, Inter and JetBrains Mono."] },

  "parts": [
    { "name": "Your first part",
      "eyebrow": "Where to start",
      "why": "One line telling the reader why these pages belong together.",
      "blocks": ["SSRF"] }
  ],

  "editions": { "free": ["SSRF"] }
}
```

| Field | What it does |
|---|---|
| `title`, `subtitle`, `author` | printed on the cover and the copyright page |
| `series` | the bold words in every page's eyebrow |
| `brand` | the left side of every page's footer. Your site, usually |
| `editionLabel` | printed on the generated pages, so you can tell two printings apart |
| `unit` | what you call a page in print. "blocks", "pages", "cards", "recipes" |
| `numbered` | `true` prints `No. 01` in the eyebrow, running through the whole book |
| `contents`, `index` | set either to `false` to leave it out |
| `cover.kicker`, `cover.note` | small lines above and below the title |
| `copyright.lines` | any extra lines you want on the copyright page |
| `parts[]` | the running order. See below |
| `editions` | named subsets. See [Editions](#editions-one-file-more-than-one-book) |
| `accent`, `accentStrong` | optional hex colours, if you want a different accent |
| `size` | the trim. Default `b5`. See [Formats](#formats-trims-and-themes) |
| `theme` | the look. Default `studio`. See [Formats](#formats-trims-and-themes) |
| `archetype` | the default page shape. Default `standard`. See [Page shapes](#page-shapes) |

The last three are optional. A book that says nothing about them gets `b5`, `studio` and
`standard`, which is what the three books in `books/` were laid out for.

**`parts` is the important one.** Each part has a `name`, an optional `eyebrow` and
`why` for its divider page, and a list of page **titles**:

```json
{ "name": "Things you make",
  "eyebrow": "Hands, heat, soil",
  "why": "Four pages where the thing being taught is physical.",
  "blocks": ["Resting meat", "The bloom", "Companion planting", "Packing cubes"] }
```

Those strings are matched against the `<h1 class="title">` of each page in your interior
file. That has three consequences worth understanding:

1. **Your interior file is a pool, not an order.** Write pages in any order you like.
   `book.json` decides which are in the book and where.
2. **Reordering the book is a JSON edit.** Never HTML surgery.
3. **A page not listed in a part is not in the book.** The builder says so, by name, so
   you cannot lose one by accident.

Titles have to be unique within a book, since they are how pages are addressed.

### What the builder generates for you

![The four generated pages: a cover, a contents with real page numbers, a part divider, and an alphabetical index.](docs/images/generated-pages.png)

A cover, a copyright page, a contents with **real page numbers**, a divider in front of
every part, and an alphabetical index. One page counter runs through all of it, so the
number printed on page 40 is genuinely page 40 of the PDF.

The contents and the index paginate themselves as the book grows. You never maintain a
page number by hand, and it can never be stale, because it is recomputed on every build.

## `VOICE.md`, the file that decides how it reads

**Rewrite this one.** It is the difference between a book that sounds like you and a
book that sounds like a machine, and it costs twenty minutes.

The version that ships describes a specific voice: no em dashes, contractions everywhere,
simple words, uneven rhythm, one concrete detail per page, and an opening that starts
`"Let's say…"` with a situation the reader is actually in. That voice is not the point.
**Having written one down is the point.** An agent will follow whatever is in this file
with real discipline, so vague instructions produce vague pages.

Say what you would never write. That is usually more useful than saying what you would.

## `blocks.md`, planning the pages

The backlog. One entry per page you mean to write, in any order. Nothing here is
printed, it is the raw material a page gets written from.

```markdown
#### Resting meat
Cooking · photo
- **What:** heat drives the juices to the middle, so cutting straight away spills them.
- **Use when:** any roasted or seared meat. **Skip when:** thin cuts cooked in seconds.
- **Action:** five minutes for a steak, fifteen for a roast, loosely covered.
- **Band:** photo (steak resting on a board, juices gathering)
```

The four lines map onto the page: **What** becomes the explainer, **Use when** tells you
whether the page is worth writing at all, **Action** becomes the box at the bottom, and
**Band** decides diagram or photograph.

Filling this in for twenty pages before writing any of them is the single best way to
find out whether you actually have a book. Most people find three of the twenty are the
same page.

## Writing a page

### With an agent

Open the repo in Claude Code (or any agent that reads `.claude/skills/`) and say:

> make a block on **resting meat**

The `block` skill takes over. It will:

1. **Ask if you have your own take on it first.** A story, a rough draft, a specific
   phrase. If you give it something, that becomes the material and your wording is kept
   verbatim. This is the step that keeps the book yours, so do not wave it away.
2. Read `blocks.md`, `VOICE.md` and `book.json`.
3. Decide diagram or photograph.
4. **Draft the words and stop**, so you can edit them before any HTML exists.
5. Build the page, draw the diagram as SVG, check that it fits, and render it for you to
   look at.

Then add the title to a part in `book.json` and rebuild.

### By hand

Nothing here needs an AI. Copy a `<section class="sheet bb">` out of
`books/showcase/showcase.html` or
`.claude/skills/block/references/example-page.html`, paste it into your interior file,
and replace the words. It is ordinary HTML.

## The markup of a page

```html
<section class="sheet bb">
  <h2 class="sr">A plain sentence describing the page, for screen readers.</h2>
  <div class="tab"></div>
  <div class="top">
    <div class="eyebrow"><b>My first book</b></div>
    <span class="pill">Cooking</span>
  </div>
  <h1 class="title">Resting meat</h1>
  <div class="sub">Why you wait before you cut</div>
  <hr class="rule">

  <figure class="photo">
    <img src="images/resting-meat.jpg" alt="A steak resting on a board.">
  </figure>
  <!-- or: <div class="diagram"> …inline SVG… </div> -->

  <hr class="rule">
  <div class="explain">
    <p>Let's say you pull a steak off the pan and cut it right away. The juice runs out
       over the board, and <span class="bad">what's left on your plate is dry</span>.</p>
    <p>Heat pushes the juice toward the middle. Give it a few minutes off the heat and
       <span class="hl">it settles back through the whole piece</span>.</p>
    <p class="close">The waiting is part of the cooking.</p>
  </div>
  <div class="ask">
    <span class="lbl">TRY THIS TONIGHT</span>
    <p>Take it off the heat, cover it loosely, wait five minutes. Then cut.</p>
  </div>
  <div class="foot">
    <span class="brand">yoursite.com</span><span class="pg"></span><span class="series">My first book</span>
  </div>
</section>
```

Four emphasis spans, and they always mean the same thing:

| Span | Colour | Means |
|---|---|---|
| `.bad` | red | the pain, the mistake, the thing that goes wrong |
| `.hl` | indigo | the idea being taught |
| `.good` | teal | the good outcome |
| `<strong>` | ink | a key phrase, no colour meaning |

`<p class="close">` is the closing line. `.pg` fills itself in with the page number. The
eyebrow and the footer are **stamped at build time** from `book.json`, so whatever you
type there is a placeholder, and a page can move between parts without being rewritten.

Do not write layout CSS in a page, and never add an `@media print` rule. The theme owns
layout, and print-only rules are exactly what makes a PDF stop matching the screen.

## Diagrams

Every diagram in this repo is **inline SVG**: the drawing is written into the page as
text, usually by the agent.

That matters for four practical reasons. You can change one word without regenerating
anything. It prints sharp at any size, because it is vector, not pixels. It costs
nothing. And the labels are never spelled wrong, which is the single most obvious sign
of a book nobody checked.

**Never generate a diagram as a picture.** Image models garble text, and you cannot edit
what comes back.

The vocabulary is deliberately small: cards, arrows, numbered badges, a key line under
the drawing, a dashed boundary. The **shape changes with the idea**, and picking the
right shape is most of the work:

| The idea is | Shape |
|---|---|
| an attack | there and back across a boundary, with a red leak arrow |
| a failure you survive | the happy path, plus a drop to a fallback |
| slow versus fast | before and after |
| something only moves if you change the ask | a rising series against a flat line |
| when matters more than how much | a timeline with changing gaps |
| a buffer absorbs a shock | the hit, the buffer, the outcome |

The full catalogue, with copy-paste SVG parts and exact geometry, is in
[`.claude/skills/block/references/diagram-system.md`](.claude/skills/block/references/diagram-system.md).
Colour is a **role**, never decoration: indigo the mechanism, teal the good outcome, red
the threat, amber the thing worth protecting, neutral the reader. Same meaning on every
page, so forty pages in your reader understands the picture before the paragraph.

## Photographs

Some things are physical. A dish resting, a plant beside its companion, a grip, what
neatly packed actually looks like. A diagram of those is worse than nothing.

```bash
node engine/tools/gen-image.mjs --check
node engine/tools/gen-image.mjs --prompt-file books/my-book/images/thing.txt \
      books/my-book/images/thing.jpg --aspect 16:9
```

The default provider is **agy**, the Antigravity CLI signed into your Google account. No
API key, and no charge per image, because it runs on a plan you already pay for. Install
the CLI, run `agy` once to sign in, then `--check`. If it says the driver model was
retired, it prints the current ones and you put one in `.env` as `AGY_DRIVER_MODEL`.

No CLI? `--provider gemini` uses the Gemini image API with a `GEMINI_API_KEY` in `.env`.
Same prompts, but metered.

Four prompt rules, in order of how much they matter:

1. **No text in the image.** End every prompt with "absolutely no text, letters, numbers
   or labels anywhere in the image". Your words live in the HTML, in real type.
2. **Say the light, the angle, and the background.** These three do more than a pile of
   adjectives.
3. **Give every photo in one book the same style sentence.** That is what makes ten
   photos look like one book instead of a mood board.
4. **Nothing branded, nobody real.** If a logo sneaks onto a product, say so explicitly
   and render it again.

Use `--aspect 16:9`, since the band is wide and short and crops from the centre. Save the
prompt beside the image as `<name>.txt`. All five showcase prompts are in
`books/showcase/images/`, next to the photos they produced.

## Check, then look

```
write  ->  build  ->  check  ->  LOOK  ->  export
```

```bash
npm run build -- books/my-book
npm run check -- books/my-book/book.html
npm run shot  -- books/my-book/book.html
```

**`check` proves a page fits.** Every page must read `0 mm`. It also catches broken
images and a stylesheet that failed to load, and it exits with an error code, so you can
put it in a script.

**`shot` is the step people skip, and it is the one that matters.** The check cannot see
two things overlapping, a clipped label, a photo cropped through its subject, or a
diagram that confidently says the wrong thing. Open the PNGs and look at them.

**And only you can check the voice.** Whether this sounds like you, whether the diagram
says what you meant, whether this is the page you actually wanted. No tool has an opinion
about that. Read every page before you publish it. That is the job now.

**If a page overflows, cut words.** Never shrink a diagram's `viewBox` to make room: that
clips the bottom of the drawing and hides the problem instead of solving it. A page a few
millimetres over usually loses one sentence and reads better for it.

## Editions: one file, more than one book

Name a subset of your pages in `book.json`:

```json
"editions": {
  "free":   ["Resting meat", "The bloom", "Progressive overload"],
  "sample": ["Resting meat"]
}
```

```bash
npm run build -- books/my-book --edition free    # -> book-free.html
```

Same pages, a shorter book, nothing duplicated and nothing to keep in sync. Fix a typo
once and every edition has it fixed.

This is what makes the whole thing sustainable: **write the page once and let it be three
things.** The page you sell, the post you publish the day you write it, and the page in
the free edition you give away. You are not writing a product and then a content plan and
then a lead magnet. You are writing pages.

## Making it a real book

`npm run export` gives you a PDF that is a 1:1 capture of the screen, at true B5, with
backgrounds printed. That file is your book.

- **Selling it as a PDF:** you are done. Send that file.
- **Print on demand:** B5 is 176 by 250 mm. Most printers want the interior with no
  cover, which is what you have, and a separate cover file. Check whether yours wants
  bleed; if it does, that is a change to `sizes/b5.css` rather than to any page.
- **Printing it at home to read:** print at 100% scale with no margins. Reading your own
  book on paper is the fastest way to find the pages that are not good enough. It is
  worth the paper.

Add `"editionLabel": "Edition 1.1"` and rebuild when you reprint, so you can tell two
printings apart later.

## Formats, trims and themes

Three independent decisions, all set in `book.json`, all with a default you can ignore.

```json
{ "size": "a5", "theme": "cookbook", "archetype": "recipe" }
```

### Trims

| `size` | Trim | For |
|---|---|---|
| `b5` | 176 × 250 mm | the default. ISO B5 |
| `b5-landscape` | 250 × 176 mm | wide diagrams and timelines |
| `a5` | 148 × 210 mm | paperbacks and notebooks |
| `a4` | 210 × 297 mm | workbooks that live on a desk |
| `six-by-nine` | 152.4 × 228.6 mm | the trade paperback |

A size file only ever sets the trim. It never touches a font or a colour, because the same
page has to read the same on paper and on screen.

**The page does not reflow when you change trim.** A page written for B5 will not
magically fit A5: `check` will tell you by how much it is over, usually 40 to 60 mm. That
is the honest answer. Write the page for the trim you are printing, and if you want the
same book in two sizes, expect to cut some words from the smaller one. Nothing here will
shrink your type to make it fit.

### Themes

| `theme` | Reads as |
|---|---|
| `studio` | the default. neutral, technical, one idea per page |
| `cookbook` | warm and appetite-led. terracotta, serif titles |
| `manual` | plain and procedural. mono eyebrows, blue |
| `reference` | dense and calm. serif body, teal. For looking things up |

A theme changes tokens, never geometry. It cannot restate the page box, add an
`@page` rule, or change a size, and there is a test that fails the build if one tries.
`studio.css` is also the anatomy every other theme reuses, so a book moves between looks
without any page being re-laid-out.

### Page shapes

The archetype is the **shape** of a page, not its look. The theme decides how it looks,
the size decides how much fits, the archetype decides what is on it and in what order.

| `archetype` | A page is |
|---|---|
| `standard` | the default. one concept, one diagram, one action. prose only |
| `procedure` | numbered steps in order, ending with how you know it worked |
| `recipe` | what goes in, then how it is made, then the note that matters |
| `exercise` | a stated goal, the task, then the check you leave the page with |
| `reference` | the answer first, then a table or list, kept dense on purpose |

A shape may widen what is allowed inside `.explain`: only `reference` may hold a
`<table>`, and only a shape that asks for one may hold a `<ul>` or `<ol>`. A model that
ignores this and drops a list onto a `standard` page gets a validation error, not a
book that looks slightly wrong.

When you draft, name the shape and it comes back correctly shaped:

```bash
node engine/tools/draft-block.mjs books/my-book --topic "Miso soup" --archetype recipe
```

In the cockpit it is the `archetype` dropdown next to the provider.

### See all of them at once

`books/shapes/` is a seven-page book built entirely to show this: procedure pages,
a reference page with a table, and exercise pages with a stated goal and a check, in
the cookbook theme. Build it and read it:

```bash
npm run build -- books/shapes
npm run check -- books/shapes/book.html
```

It is also the best test of your own setup: if a list or a table overflows on a page
there, the problem is your words, not your CSS. Every one of those pages was over by
16 to 46 mm before it was cut down.

## Changing the look

Copy `engine/themes/studio.css`, point your interior file at your copy, and change the
tokens at the top of `.sheet.bb`:

```css
--accent:#6366F1;   --accent-strong:#4F46E5;   /* the tab, the eyebrow, the badges */
--signal:#0D9488;   /* teal, the good outcome */
--danger:#DC2626;   /* red, the threat */
--warn:#B45309;     /* amber, the protected thing */
--ink:#1A1A2E;      --muted:#5B6472;   --line:#E7E9EF;
```

Keep the class names and everything keeps working, including every diagram, because the
diagrams reference the same roles.

Fonts live in `engine/fonts/`, self-hosted, so a build is deterministic and works
offline. To swap them: drop your woff2 files in, rewrite the `@font-face` blocks in
`fonts.css`, and change the family names in your theme. Do not switch to a font CDN, or
your PDF starts depending on somebody else's uptime.

To change the page size, copy `engine/sizes/b5.css`, change the three tokens and the
`@page size`, and point your book at it. Nothing else needs to know. Every size, theme and
shape the engine offers is listed in `engine/defaults.json`, which is the single place
they are defined: the builder, the drafter and the validator all read it, so a name that
works in `book.json` works everywhere or nowhere.

## When something goes wrong

| What you see | What it is |
|---|---|
| `book.json lists pages that are not in <file>` | A title in `parts` does not match any `<h1 class="title">`. Usually a typo or a renamed page. |
| `Nothing to build: every part came out empty` | An edition name that matches no pages, or empty `blocks` arrays. |
| `Two pages are both titled "X"` | Titles address pages, so they have to be unique. Rename one. |
| `A page has no <h1 class="title">` | Every page needs one. It is how `book.json` finds it. |
| `STYLESHEET: not applied` | The `../../engine/…` links are wrong, almost always because the book folder is not exactly two levels deep. |
| `overflowing: 6 (+3mm)` | Page 6 is 3 mm too tall. Cut a sentence. Do not shrink the diagram. |
| `broken images` | A wrong `src`. Paths are relative to the book folder, so `images/thing.jpg`. |
| The page renders as plain unstyled text | Same as `STYLESHEET: not applied`. Check the folder depth. |
| An SVG label is invisible | A `<text>` with no `fill`. Set the colour explicitly on every one. |
| `agy: NOT FOUND` | The Antigravity CLI is not installed or not on your PATH. Set `AGY_BIN` in `.env`, or use `--provider gemini`. |
| `agy` renders nothing, mentions quota | The image quota is spent for a few hours. Use `--provider gemini`, or come back later. |
| The PDF does not match the screen | Something added an `@media print` rule that changes a size, a font, or an image. That is the one rule the engine exists to protect. |

---

## The part no tool does

The engine makes the pages look right. It has no opinion about whether they are any
good.

So the work moved, it did not disappear. What it moved to is reading every page and
asking three questions: does this sound like me, does the diagram say the thing I meant,
and is this what I actually wanted. Nothing on this page can answer those, and they are
the whole difference between your book and a cheap one.

If your first page comes out ugly, that is normal. Write the second one.
