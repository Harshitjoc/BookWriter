# CLAUDE.md

This repo builds **books**: one concept per page, on a strict B5 canvas (176 x 250 mm),
where the same CSS drives screen and print. Read `engine/AUTHORING.md` for how the canvas
works and `engine/tools/README.md` for the commands.

When asked to write or lay out a page, use the **`block` skill** in
`.claude/skills/block/`. It owns the voice, the diagram system, and the design rules.

## Hard invariants

- **`book.html` is GENERATED. Never hand-edit it.** The source is the interior file,
  `books/<slug>/<slug>.html`, plus `books/<slug>/book.json`. Every build overwrites
  `book.html`.
- **Books live exactly 2 folders deep**: `books/<slug>/`, because every page links
  `../../engine/…`. A wrong depth renders an unstyled page that can still pass a naive
  check, which is why `check.mjs` tests for it.
- **The same CSS drives screen and print.** Never add an `@media print` rule that changes
  a size, a font, or an image. That single thing is what makes an exported PDF stop
  matching the screen.
- **One concept per page.** One `<section class="sheet bb">`. If it needs two pages, it
  is two concepts.
- **Never let a page overflow.** `check.mjs` must read `0 mm` on every page. If it does
  not, cut words. Do NOT shrink a diagram's `viewBox` to make it fit: that silently clips
  the bottom of the drawing and hides the problem instead of solving it.
- **Colour is a role, not decoration**, and the roles are the same on every page of every
  book: indigo is the mechanism being taught, teal the good outcome, red the threat or
  mistake, amber the thing worth protecting, neutral the reader's own app or self.
- **Diagrams are inline SVG, never generated images.** An image model garbles labels and
  the result cannot be edited. Photographs are for physical subjects only.
- **Never invent a fact, a number, a study, or a personal story** for a page. If the
  author did not say it, do not write it.

## The loop, after every edit

```bash
node engine/tools/build-book.mjs books/<slug>            # assemble book.html
node engine/tools/check.mjs      books/<slug>/book.html  # MUST be 0 mm, no broken images
node engine/tools/shot.mjs       books/<slug>/book.html  # then READ the PNGs
```

`check.mjs` only proves a page FITS. It cannot see overlap, a clipped SVG label, a photo
cropped through its subject, or a diagram that says the wrong thing. **Always run
`shot.mjs` and actually look at the images.** A page is not done until you have.

## Adding a page

1. Write it into `books/<slug>/<slug>.html` as one `<section class="sheet bb">`. Copy
   `.claude/skills/block/references/example-page.html`.
2. Add its title to the right part in `books/<slug>/book.json`. A page that is not listed
   there is not in the book. The builder will tell you if you forget.
3. Run the loop above.

The builder matches pages to `book.json` **by their `<h1 class="title">`**, so titles
have to be unique within a book, and reordering the book is a JSON edit rather than HTML
surgery.

## Images

`engine/tools/gen-image.mjs` defaults to the **agy** provider (Antigravity CLI, signed
into a Google account, no API key, no per-image charge). `--provider gemini` is the
metered fallback and needs `GEMINI_API_KEY` in `.env`.

Prompts must forbid text in the image, name the light and angle and background, and
repeat the book's shared style sentence. Save every prompt next to its image as
`<name>.txt`. See `.claude/skills/block/references/photo-blocks.md`.

## Notes

- Fonts are self-hosted in `engine/fonts/`, so builds and PDF exports are deterministic
  and work offline. Do not switch to a font CDN.
- `*.pdf` and `page*.png` are gitignored and regenerable.
- `.env` is optional. The engine builds books with no keys at all.
