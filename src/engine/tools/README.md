# src/engine/tools

The commands. Every one takes paths relative to the repo root, and every one carries a
full usage block at the top of its own file.

One-time setup:

```bash
npm install
npx playwright install chromium
```

## The loop

| Tool | What it does | Run it |
|---|---|---|
| `build-book.mjs` | Wraps your pages in a cover, a copyright page, a contents with real page numbers, a divider per part and an alphabetical index, then writes `book.html`. Driven entirely by `book.json`. | `node src/engine/tools/build-book.mjs books/<slug>` |
| `check.mjs` | **The gate.** Opens the book in a real browser, waits for the fonts, and measures how far each page runs past the bottom edge. Must read `0 mm`. Also catches broken images and a stylesheet that never loaded. Exits 1 on failure. | `node src/engine/tools/check.mjs books/<slug>/book.html` |
| `shot.mjs` | One PNG per page, at 2x, so 11px labels are readable. | `node src/engine/tools/shot.mjs books/<slug>/book.html [out-dir]` |
| `export.mjs` | Deterministic PDF via headless Chrome. Obeys `@page { size:B5; margin:0 }` and prints backgrounds, so the PDF is a 1:1 capture of the screen. | `node src/engine/tools/export.mjs books/<slug>/book.html [out.pdf]` |
| `export-epub.mjs` | The same book, reflowable, as an EPUB3. Store-only zip written by `lib/zip.mjs` (no dependency); one page becomes one chapter. | `node src/engine/tools/export-epub.mjs books/<slug>/book.html [--out out.epub]` |
| `export-web.mjs` | The whole book as one offline HTML file: stylesheets inlined, photos as data URIs, a reading bar on top. | `node src/engine/tools/export-web.mjs books/<slug>/book.html [--out out.html]` |
| `export-card.mjs` | One page (`--page N`) as a standalone HTML, PNG or Markdown card. `--list` prints the page numbers. | `node src/engine/tools/export-card.mjs books/<slug>/book.html --page 5 --format png` |
| `facts.mjs` | The fact ledger: lists every open `[FACT NEEDED: ...]` marker, page by page. Exits 1 while any remain. | `node src/engine/tools/facts.mjs books/<slug>` |
| `publish.mjs` | **The publish gate.** No open facts → build → 0 mm → deep pass → pixels (if approved) → the exports you name. Stops at the first failure and exports nothing. No override. | `node src/engine/tools/publish.mjs books/<slug> --formats pdf,epub,web` |

The canonical order: **build, check until every page is 0 mm, shot and READ them,
export.**

`check.mjs` proves a page fits. It cannot see overlap, a clipped label, a squashed row, a
photo cropped through its subject, or a diagram that says the wrong thing. Only the PNGs
show those. Always look.

### `--json`

`check.mjs` also takes `--json`, which prints one JSON object instead of the report. The
exit code is unchanged, so it is still a gate.

```bash
node src/engine/tools/check.mjs books/<slug>/book.html --json
```

```json
{
  "input": "books/showcase/book.html",
  "pages": 17,
  "rows": [{ "page": 1, "title": "gp cover", "overMm": 0 }],
  "overflowing": [],
  "broken": [],
  "unstyled": false,
  "ready": true
}
```

`rows` has one entry per sheet. A generated sheet carries a `gp ` prefix in its `title`
(`gp cover`, `gp toc`, `gp divider`, `gp index`); a page you wrote does not. `overflowing`
and `broken` list the failures, so `ready` is just
`!(overflowing.length || broken.length || unstyled)`. `--json` exists for the cockpit in
`src/client/`, which renders `rows` as the check table; it is opt-in and changes nothing
about the default output or the exit code.

## Images

| Tool | What it does | Run it |
|---|---|---|
| `gen-image.mjs` | A text prompt into a photograph, for pages whose subject is physical. Two providers: `agy` (default, the Antigravity CLI on your Google account, no key and no per-image charge) and `gemini` (the metered API, needs `GEMINI_API_KEY`). | `node src/engine/tools/gen-image.mjs "<prompt>" out.jpg --aspect 16:9` |

```bash
node src/engine/tools/gen-image.mjs --check    # is agy installed, signed in, driver model current?
```

**Diagrams are never generated as images.** They are written as inline SVG, so they stay
text: editable one word at a time, sharp at any size, free, and never spelled wrong.

The prompt rules, and the shared style sentence that makes one book's photos look like
one book, are in `.claude/skills/block/references/photo-blocks.md`.

## Video

| Tool | What it does | Run it |
|---|---|---|
| `make-video.mjs` | Reads `books/<slug>/storyboard.json` and makes an mp4: the title card, real book pages, and engine-drawn figures/diagrams; the local Windows voice reads the narration; the caption is burned in and written to `captions.srt`; ffmpeg joins the scenes. Writes only into `books/<slug>/video/` (gitignored) and never edits a page. | `node src/engine/tools/make-video.mjs books/<slug> [--out talk.mp4]` |

`--silent` skips the voice and paces scenes from the word count, which is how the tests run.
`--width 640` renders a quick look. `--no-captions` turns off both the burned line and the
SRT. `--sfx` adds a generated transition sound under the voice (off by default: a book
video should not make noise unless asked). The tool needs `ffmpeg` on `PATH`; the default
voice is Windows SAPI, so use `--silent` elsewhere.

An unlabelled figure or diagram is drawn from its shape alone. When the exact labels
matter, use a `page` scene: the book page already has the right words on it.

The cockpit's **film** tab runs this same tool against the saved plan. It shows the log
scene by scene, serves the finished mp4 from the book's `video/` folder, and can cancel the
render without leaving a browser or an encoder behind.

## Flags worth knowing

```
build-book.mjs  --edition <name>     build a subset listed under "editions" in book.json
                --out <file>         write somewhere other than book.html
                --gutter <mm>        extra margin on the bound edge (mirrored recto/verso)
                --bleed <mm>         print 2x mm larger and bleed the paper colour (default 3mm)
                --start-recto        open every part on a right-hand page (inserts blank versos)

export.mjs      --tagged             an accessible PDF (structure tree)
                --outline            PDF bookmarks from the headings

gen-image.mjs   --check              verify the CLI before you rely on it
                --provider gemini    the metered fallback
                --aspect 16:9        16:9 suits the page's photo band
                --prompt-file p.txt  keep the prompt in a file, next to the image
                --ref style.jpg      up to 3 reference images, to hold a style
```

The three `build-book.mjs` craft flags are additive: with none of them the built book is
byte-for-byte what it always was (`src/engine/tools/regress.mjs` enforces that).

Environment, all optional, in a repo-root `.env`: `AGY_BIN`, `AGY_DRIVER_MODEL`,
`GEMINI_API_KEY`. The engine builds books with none of them.
