# How a book actually gets made

The short version: **you write pages, and the engine turns them into a book.** Everything
else — the cover, the contents, the dividers, the index, the page numbers, the PDF — is
generated, and generated every single time you build.

This is the whole pipeline, in order, with the real numbers from a real book.

---

## The five files, and the one you never touch

A book is one folder: `books/<slug>/`. Inside it:

| File | Who writes it | What it is |
|---|---|---|
| `book.json` | you | The running order, and everything printed on the front and back matter. |
| `<slug>.html` | you | **Your pages.** A pool of them, one concept each. |
| `VOICE.md` | you | How the book sounds. The `/block` skill treats it as law. |
| `blocks.md` | you | The backlog: one entry per page you mean to write. |
| `book.html` | **the engine** | The finished book. Generated. Never hand-edit it. |

That last one is the rule people break first, so it is worth saying twice: `book.html` is
overwritten on every build. Anything you type into it is gone. To change a page, change the
interior and build again.

Books live **exactly two folders deep** (`books/showcase/`, never `books/drafts/showcase/`).
That is not tidiness — your pages load the engine with `../../src/engine/`, so one more level of
nesting and every stylesheet 404s.

---

## Step 1 — you write one page per concept

A page is one `<section class="sheet bb">` with an `<h1 class="title">` whose text is the
page's name:

```html
<section class="sheet bb">
  <h1 class="title">SSRF</h1>
  ...
</section>
```

That `class="bb"` is what tells the engine this is *yours*. The pages it generates for you
are `class="gp"` — "generated page". One flag, and the engine knows the difference.

**The interior is a pool, not a sequence.** You can write twenty pages and ship a book with
three of them. Line order in the interior does not decide what is in the book — that is
`book.json`'s job, in the next step.

The one thing that must match: the text inside `<h1 class="title">` is the page's *name*,
and that exact string is how `book.json` finds it. If you rename a title, you must update
`book.json` too, or the build will tell you it cannot find that page.

---

## Step 2 — `book.json` decides what is in the book

The part that surprises people:

```json
"parts": [
  {
    "name": "Your first part",
    "eyebrow": "Where to start",
    "why": "One line telling the reader why these pages belong together.",
    "blocks": ["SSRF"]
  }
]
```

`blocks` is a list of **titles**. `build-book.mjs` reads your interior, finds the page whose
`<h1 class="title">` says `SSRF`, and puts it in part 1.

Which means:

- **Reordering the book is a JSON edit.** Swap two entries in `blocks`. No HTML surgery.
- **Deleting a page is a JSON edit.** Remove it from `blocks`. The page stays in the
  interior, unused, so you can bring it back.
- **Shipping fewer pages is a JSON edit** (see *Editions*, below).

---

## Step 3 — build

```bash
npm run build -- books/my-life-my-rule
```

This wraps your pages in everything else and writes `book.html`. It is deterministic: same
input, same output, every time.

The generated furniture, in this order:

1. **Cover** — from `title`, `subtitle`, `author`, `cover.kicker`, `cover.note`.
2. **Copyright page** — from `copyright`, with the `year`.
3. **Contents** — every part and every page, **with real page numbers**.
4. **A divider in front of every part** — from the part's `name`, `eyebrow` and `why`.
5. **Your pages**, in the order `blocks` listed them.
6. **An index** — alphabetical, built from the page titles.

So the page count is arithmetic:

```
pages = 1 cover
      + 1 copyright
      + 1 contents
      + one divider per part
      + your blocks
      + 1 index
```

Check it against the real books:

| Book | Parts | Blocks | Arithmetic | Actual |
|---|---|---|---|---|
| `my-life-my-rule` | 1 | 1 | 1+1+1+1+1+1 | **6** |
| `showcase` | 3 | 10 | 1+1+1+3+10+1 | **17** |

The contents and the index are computed **after** the running order is settled, from the
same pass that stamps the page numbers. That is why a page number can never go stale: there
is no stored number to fall out of date. Add a page in the middle and the contents rewrites
itself on the next build.

---

## Step 4 — check

```bash
npm run check -- books/my-life-my-rule/book.html
```

This is the gate. It opens the book in a real browser, waits for the fonts to load, and
measures how far each page runs past the bottom edge of its box. **Every page must read
`0 mm`.** It also catches broken images and a stylesheet that never loaded.

```
pages: 6
overflowing: none ✓
broken images: none ✓

All pages fit.
```

It exits `1` when anything is over, so it drops straight into CI or a pre-publish hook.

> `check.mjs --json` prints the same result as an object (`rows[]` with `page`, `title`,
> `overMm`) for the cockpit's check table. The exit code and the default output are
> unchanged.

If a page is over, **cut words.** Do not shrink the font, and never shrink a diagram's
`viewBox` to make it fit — that clips the drawing instead of fixing the page.

---

## Step 5 — shot, and actually look

```bash
npm run shot -- books/my-life-my-rule/book.html
```

One PNG per page, at 2x, written into the book's folder as `page1.png`, `page2.png`, …

This is the step people skip, and it is the one the tools cannot do for you. `check` proves
a page *fits*. It cannot see text overlapping a diagram, a label clipped at the edge, a
photo cropped through its subject, or a diagram that confidently illustrates the wrong
mechanism. Only your eyes catch those. Open the PNGs.

---

## Step 6 — export

```bash
npm run export -- books/my-life-my-rule/book.html
```

Headless Chrome prints the page to PDF. Two settings do the work:

- `preferCSSPageSize: true` — obeys the engine's `@page { size:B5; margin:0 }` instead of
  inventing its own paper size.
- `printBackground: true` — keeps the fills and the coloured rules.

So the PDF is a 1:1 capture of the screen. Verified on the showcase book: 17 page objects,
`MediaBox [0 0 498.96 708.96]` points — which is 176 × 250 mm, exactly B5.

That is the whole promise of the engine, and it holds because of one rule: **the same CSS
drives screen and print.** There is no print-only font swap, no width swap, no image resize.
Never add an `@media print` rule that changes a size.

---

## Worked example: your book, traced end to end

`books/my-life-my-rule/` as it stands:

```bash
npm run build  -- books/my-life-my-rule    # 1 block in 1 part -> 6 pages
npm run check  -- books/my-life-my-rule/book.html   # all 6 read 0 mm
npm run shot   -- books/my-life-my-rule/book.html   # 6 PNGs
npm run export -- books/my-life-my-rule/book.html   # 1 PDF, 6 B5 pages
```

Which produces, in this exact order:

```
 1. gp cover          (generated)
 2. gp colophon       (generated)
 3. gp toc            (generated)   prints: "Part 1 · Your first part   4    SSRF   5"
 4. gp divider        (generated)
 5. bb   SSRF         (yours)
 6. gp index          (generated)
```

The divider is on page 4 and SSRF is on page 5, in the contents and in the PDF, because the
page numbers were assigned after the order was settled — not typed in by you.

**Adding a second page.** Three edits, no HTML surgery:

1. Add the entry to `blocks.md` (the backlog, for whoever writes it later).
2. Write the page in the interior: `<section class="sheet bb"><h1 class="title">CSRF</h1>…`.
3. Add `"CSRF"` to `parts[0].blocks` in `book.json`.

Then build, check, look, export. You now have 7 pages, and the contents and index have
already rewritten themselves.

Or just ask an agent: `make a block on **<your topic>**` and the `/block` skill does steps
1–3 in your voice and runs `check` for you.

---

## Editions: one pool of pages, two books

`book.json` can declare subsets:

```json
"editions": {
  "free": ["SSRF"]
}
```

```bash
npm run build -- books/showcase --edition free
```

The pages not listed are simply not in that edition. The showcase's full book is 17 pages;
its free edition is 11. **You did not maintain two books.** You wrote each page once and
decided which list it belongs to — and because the edition gets its own `book.html`, it gets
its own cover, contents and index with its own page numbers, all correct for that edition.

---

## The loop, one more time

```
write a page  ->  build  ->  check  ->  LOOK  ->  export
```

Do not skip to `export`. `check` is cheap and tells you the truth about fitting. The PNGs
are cheap and tell you the truth about looking right. Only then is the PDF worth making.

---

## The cockpit

`npm run ui` gives you the same five steps as buttons, plus the four source files in an
editor, a live preview of the real built book, the check table, and the shot gallery.

It is not a second engine. Every button runs the `npm run` script above, the preview is the
actual `book.html` served off disk, and `book.html` is still generated-only — the UI refuses
to write it. If you delete `src/client/`, you lose the window, not the book. See
[`src/client/`](../src/client/).

---

## When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| `check` says a page is over | Content is taller than 176 × 250 mm | Cut words. Never shrink the font or the `viewBox`. |
| `check` says broken images | A path in the interior does not resolve | Links are relative to the interior file, and `../../src/engine/` reaches the engine. |
| `check` says unstyled | `sheet.css` never loaded | Almost always a book nested more than two folders deep. |
| `Name it <slug>.html, or set "interior"` | The interior is not named after its folder | Rename it to `books/<slug>/<slug>.html`, or set `"interior"` in `book.json`. |
| Build cannot find a page | A title in `blocks` matches no `<h1 class="title">` | The two strings must be identical. |
| Your edit vanished | You edited `book.html` | It is generated. Edit the interior and rebuild. |
| Everything is one giant page | `@media print` changed a size | Remove it. The canvas is the guarantee. |

---

Further reading: [`GUIDE.md`](GUIDE.md) for authoring (the markup of a page, diagrams,
photographs, `VOICE.md`), [`src/engine/tools/README.md`](../src/engine/tools/README.md) for each
command, and [`src/engine/AUTHORING.md`](../src/engine/AUTHORING.md) for the invariants.