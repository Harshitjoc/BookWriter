# The engine — a strict B5 canvas

A small system so that a book written with an AI prints and exports **exactly** as it
looks on screen. The canvas is the guarantee: you author inside a fixed frame, you see
the real page, and you export it 1:1.

You can drive it from the command line or from the optional cockpit in `src/client/`
(`npm run ui`). Both are the same engine — the UI runs these same `tools/` commands and
serves the real `book.html`, so it inherits the guarantee below rather than replacing it.
See [`ui/README.md`](ui/README.md).

## The one rule

> Every page is a rigid **176 x 250 mm** box (ISO B5), and the **same CSS drives screen
> and print**. No print-only font swap, no width swap, no image resize. Print just drops
> the on-screen chrome and gives each page its own sheet.

That is why "save as PDF" matches the screen. Adding an `@media print` rule that changes
a size is exactly what makes layout drift, and it is the one thing this engine exists to
prevent.

The second half of the rule: the box **clips**. Content that is too tall does not reflow
onto a second page, shoving everything after it down. It overflows the box, and both the
on-screen badge and `check.mjs` shout about it while you are still writing.

## Files

| File | What it is |
|---|---|
| `sheet.css` | The page frame: the rigid `.sheet` box, the screen "desk", the overflow badge, and the print rules. Shared by every book. Do not edit it to fix one page. |
| `sizes/b5.css` | The B5 trim (`data-size="b5"`). Another size is one more file like this one. |
| `themes/studio.css` | The look: everything under `.sheet.bb`. Copy it and change the tokens to make your own. |
| `fonts/` | Self-hosted woff2 (Space Grotesk, Inter, JetBrains Mono) plus `fonts.css`. The theme imports these instead of a font CDN, so a build is deterministic and works offline. |
| `sheet-tools.js` | Screen-only overflow detector: a red outline and an "N mm over" badge while you edit. `check.mjs` is the authoritative version. |
| `tools/` | The commands. See `tools/README.md`. |
| `tools/diagram.mjs` | Compiles a small JSON spec into a page's inline diagram SVG. Same spec in, same bytes out; every `<text>` gets an explicit fill. See the diagram system in `.claude/skills/block/references/diagram-system.md`. |
| `tools/export-epub.mjs` | The same book, reflowable, as an EPUB3. Store-only zip written by `tools/lib/zip.mjs`, no dependency. One page becomes one chapter. |
| `tools/export-web.mjs` | The whole book as one offline HTML file: stylesheets inlined, photos as data URIs, a reading bar on top. |
| `tools/export-card.mjs` | Lifts one page (`--page N`) out as a standalone HTML, PNG or Markdown card. |
| `tools/facts.mjs` | Lists every open `[FACT NEEDED: ...]` marker, page by page. Exits 1 while any remain. The fact ledger. |
| `tools/publish.mjs` | The gate. No open facts → builds → 0 mm → deep pass → pixels (if approved) → exports. Never edits a book, no override. |

## A page

```html
<html lang="en" data-size="b5">
<head>
  <link rel="stylesheet" href="../../src/engine/sheet.css">
  <link rel="stylesheet" href="../../src/engine/sizes/b5.css">
  <link rel="stylesheet" href="../../src/engine/themes/studio.css">
</head>
<body>
  <main class="deck">
    <section class="sheet bb"> ... one concept ... </section>
    <section class="sheet bb"> ... another ... </section>
  </main>
  <script src="../../src/engine/sheet-tools.js"></script>
</body>
</html>
```

Books live **two folders deep**, at `books/<slug>/`, so `../../src/engine/…` is always
correct. Change the depth and every page loses its stylesheet. That failure looks like
plain unstyled text, and it can still measure zero overflow, which is why `check.mjs`
tests for it separately.

Geometry comes from three tokens, so a new trim is one small file and nothing else
changes:

```css
--page-w    page width
--page-h    page height
--page-pad  the safe margin, which lives INSIDE the box
```

## Two kinds of book

Both are the same engine. The difference is only what `book.json` says.

**The interior is a pool.** `books/<slug>/<slug>.html` holds every page you have written,
as `<section class="sheet bb">` blocks. `book.json` decides which of them are in the book
and in what order, matching them **by each page's `<h1 class="title">`**.

That means reordering a book is a JSON edit, never HTML surgery, and an edition (a free
subset, say) is just another list of titles.

## Preview while you write

Open the interior file in Chrome or Edge. The page on the desk **is** the B5 sheet. If a
page is too tall it gets a red outline and a badge telling you by how much. Trim until
the badge disappears, or run `checkSheets()` in the console to re-check.

## The loop

```bash
node src/engine/tools/build-book.mjs books/<slug>            # -> book.html
node src/engine/tools/check.mjs      books/<slug>/book.html  # every page 0 mm
node src/engine/tools/check.mjs      books/<slug>/book.html --lint   # the deep pass
node src/engine/tools/visual.mjs     books/<slug>/book.html  # pixels match the approved set
node src/engine/tools/shot.mjs       books/<slug>/book.html  # then LOOK
node src/engine/tools/export.mjs     books/<slug>/book.html  # -> book.pdf
```

`check.mjs` catches vertical overflow, broken images, and a missing stylesheet. `--lint`
adds the page-that-fits-but-is-still-wrong pass: text on text, a colour that fails on
paper, an SVG label with no fill or under the ink floor, a starved or invisible page. It
is opt-in on the command line and on by default in the cockpit.

`visual.mjs` keeps a hash of every page's rendered pixels in `books/<slug>/.snapshots/`
and shouts when one moves, so a stylesheet tweak cannot silently re-lay-out page 7. Run
it with `--update` once to approve the current pages, then keep it in the loop.

Only the PNGs catch clipped SVG labels, squashed rows, a photo cropped through its
subject, and a diagram that says the wrong thing. Do both, every time.

## Export by hand

The CSS already makes the browser dialog correct, if you prefer it:
`Ctrl/Cmd + P` then **Save as PDF**, with margins **None**, scale **100**, and background
graphics **on**. `export.mjs` is the version of that which cannot be got wrong.

## Other formats

The PDF is the page as designed. The same built `book.html` also becomes:

```bash
node src/engine/tools/export-epub.mjs books/<slug>/book.html   # -> book.epub (EPUB3)
node src/engine/tools/export-web.mjs  books/<slug>/book.html   # -> book-web.html (one file)
node src/engine/tools/export-card.mjs books/<slug>/book.html --page 5 --format png
```

`export-epub.mjs` reflows the book for a reader: one page, one chapter, with the fixed
B5 box set aside. The archive is written by hand in `tools/lib/zip.mjs` — store-only,
`mimetype` first and uncompressed, exactly as EPUB requires — so there is no dependency.
`export-web.mjs` inlines every stylesheet and photo into a single offline HTML file.
`export-card.mjs` pulls one sheet out as a standalone HTML, PNG or Markdown card
(`--list` prints the page numbers and titles).

When a page needs a fact you do not have, write `[FACT NEEDED: what you need]` instead of
guessing. `facts.mjs` lists what is still open. `publish.mjs` is the one command that ships
a book, and it refuses while any fact remains:

```bash
node src/engine/tools/facts.mjs   books/<slug>                 # what is still missing
node src/engine/tools/publish.mjs books/<slug> --formats pdf,epub,web
```

## Print craft

For a book that goes to a real printer, three opt-in flags on `build-book.mjs` and two on
`export.mjs`. None of them change a plain build:

```bash
node src/engine/tools/build-book.mjs books/<slug> --gutter 8          # 8mm on the bound edge
node src/engine/tools/build-book.mjs books/<slug> --bleed 3           # 3mm bleed, larger print page
node src/engine/tools/build-book.mjs books/<slug> --start-recto       # parts open on a right-hand page
node src/engine/tools/export.mjs books/<slug>/book.html --tagged --outline
```

`--gutter` adds the margin to the inner (spine) edge, mirrored so recto and verso both keep
their outer margin. `--bleed` prints the page 2x the bleed larger and runs the paper colour
into that margin, so a guillotine cut cannot shave a white sliver — the one intentional
exception to "print never changes a size". `--start-recto` inserts blank versos so every
part divider lands on a right-hand (odd) page. `--tagged` writes an accessible PDF with a
structure tree; `--outline` builds the bookmarks from the headings.

## The cockpit

The cockpit (`npm run ui`, default `http://127.0.0.1:5173`) is a front end to the same
tools. The right column's tools sit behind four dropdown menus, one per band, so twelve
tools read as four short buttons instead of a wall of tabs: **measure** (check, board,
dashboard, shots), **make** (diagram, draft, photo, from source), **ship** (export,
publish) and **system** (console, keys). Open a group and pick a tool; the group holding
the active tool shows its name, and the shots/console counts and the check-failure dot
ride along. It never re-implements the engine — every button runs the same script the
command line runs.

The **diagram** tab is a live front end to `tools/diagram.mjs`. Pick a shape, edit its JSON
spec, and the SVG recompiles as you type — compiled by the same module a page is built with,
so the preview is the bytes the page would get. Copy the SVG, or insert the `<figure>` into
the page you are editing (it lands in the editor unsaved, where you place it).

The **board** tab is a map of the book read from its interior *source*, live while you edit.
One row per page with its part, and whether it carries a diagram, a photo, or an open
`[FACT NEEDED]` marker. A page that is written but not listed in `book.json` is flagged: it
exists in the file but will not print, which is the quietest mistake a book can make.

The **dashboard** tab is the same read, summed up: open facts, pages missing from
`book.json`, diagram and photo counts, the parts table, and which artifacts already exist in
the book folder. It is what to look at before hitting publish.

The **export** tab writes the files by hand: the PDF, the EPUB, the single-file web export,
or one page (`--page N`) as an HTML, PNG or Markdown card. Each lands in the book folder and
is linked under `/preview`. Nothing here is a gate — `export` is "give me the file".

The **publish** tab is the gate, and it is the only way to ship from the cockpit. It runs
`tools/publish.mjs`: no open facts → build → 0 mm → deep pass → pixels (if approved) → the
formats you name, stopping at the first failure and exporting nothing. There is no override.

The **draft** tab records every page it writes in the book's `.gen` ledger, so the same
topic, model and seed redraft to the same bytes; a replayed run says so. The build toolbar
carries the print-craft switches (`gutter`, `bleed`, `recto`) — off by default, so a plain
build is byte-for-byte the same with or without the cockpit.



