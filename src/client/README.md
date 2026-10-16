# src/client — the cockpit

An optional browser front end for the whole engine. It lets you edit a book's source
files, run `build`, `check`, `shot` and `export` without leaving the page, and it shows
you each step's real output as it is produced. The right column's tools sit behind four
dropdown menus, one per band — **measure** (check, board, dashboard, shots), **make**
(diagram, draft, photo, from source), **ship** (export, publish) and **system** (console,
keys). Open a group and pick a tool; the group holding the active tool shows its name,
and the shots/console counts and the check-failure dot ride along.

```bash
npm install
npm run ui          # http://127.0.0.1:5173
```

`UI_PORT` and `UI_HOST` override the defaults.

## Tests

```bash
npm test
```

The full suite, in order:

| Suite | What it proves |
|---|---|
| `tests/llm.test.mjs` | the provider layer, with an injected fake fetch and no network |
| `tests/format.test.mjs` | the size and theme plumbing, and the bytes that must not move |
| `tests/draft.test.mjs` | the page contract, extraction and the drafter |
| `tests/byok.test.mjs` | that a key from the browser reaches the tools unforged, and goes no further |
| `tests/api.test.mjs` | the HTTP surface against a real server on a free port |
| `tests/studio.test.mjs` | the diagram studio and the `/api/board` / `/api/facts` endpoints |
| `tests/ship.test.mjs` | the print-craft flags, the epub/web/card exporters, and the publish gate, all through `/api/run` |
| `tests/ui.test.mjs` | the cockpit in a real browser, against a real built book |
| `src/engine/tools/regress.mjs` | every committed book still builds to the same bytes |

`regress.mjs` is the important one. It builds each book **twice**, fails if the two runs
disagree (a non-deterministic build makes a hash baseline worthless), then compares
`sha256(book.html)` against `src/engine/tools/baseline.json`. If a hash moves, existing books
changed under you and that must be deliberate:

```bash
node src/engine/tools/regress.mjs --update
```

**The tests never touch your books.** Every suite builds a scratch copy of `starter` under a
slug like `uitest`, and deletes it in a `finally` — including on failure, and including
startup, so an interrupted run leaves nothing behind. That is also why the UI suite picks
the scratch book from the dropdown before it does anything else.

**The UI is a cockpit, not a dependency.** Everything it does, it does by running the same
scripts `npm run build` / `check` / `shot` / `export` run. Delete `src/client/` and the
engine still builds books. Nothing in `src/engine/tools/` imports anything from here.

## What it gives you

- **Edit the four source files** — `book.json`, the interior `<slug>.html`, `VOICE.md`,
  `blocks.md` — in Monaco, with the right language for each.
- **A live preview of the real built book**, in an iframe, at true B5.
- **Run any step** and watch stdout/stderr stream in.
- **The check table**, from `check.mjs --json`, with the real millimetre over per sheet.
- **The shot gallery**, with a lightbox, so you can actually look at the pages.
- **New book** scaffolding from `books/starter`, and the **edition** selector.
- **Print-craft switches** in the toolbar — `gutter`, `bleed`, `recto` — off by default, so a
  plain build is byte-for-byte the same with or without the cockpit. They feed the same
  `--gutter` / `--bleed` / `--start-recto` flags `build-book.mjs` takes on the command line,
  vetted server-side so a bad number is a 400 with a reason, not a stack trace.
- **Board tab** — a page-by-page map of the book read from the interior *source*, live while
  you edit: part, title, and whether each page has a diagram, a photo, or an open fact.
- **Dashboard tab** — the same read summed up: open facts, pages missing from `book.json`,
  diagram/photo counts, the parts table, and which artifacts already exist.
- **Diagram tab** — a live front end to `diagram.mjs`: pick a shape, edit the JSON spec, and
  the SVG recompiles as you type. Copy it or insert the `<figure>` into the page you are editing.
- **Draft tab** — ask a model for one page, streamed, checked, and inserted only on a click.
  Every draft is recorded in the book's `.gen` ledger with its seed and request key, so an
  identical re-draft replays byte for byte.
- **Photo tab** — generate a photograph with `gen-image.mjs`.
- **Export tab** — write the PDF, EPUB, single-file web export, or one page as an HTML/PNG/MD
  card. Each lands in the book folder and is linked under `/preview`. This is not a gate.
- **Publish tab** — the gate (`src/engine/tools/publish.mjs`), the only way to ship from the cockpit:
  no open facts → build → 0 mm → deep pass → pixels (if approved) → the formats you name,
  stopping at the first failure and exporting nothing. No override.
- **Keys tab** — your own provider keys, see below.

### Keys tab

The keys tab holds one password field per provider API key. A key you enter wins over
`.env` for the one request that uses it, and is kept in sessionStorage unless you tick
"remember", which moves it to localStorage. Nothing is logged, echoed in full, or written
to disk by the server; the CLI reads `.env` directly and is not affected either way.

## Three things it deliberately does not do

1. **It never writes `book.html`.** That file is generated; you edit the interior and
   `book.json`, and the UI runs `build-book.mjs` like everything else. The API refuses to
   write any file outside the four above.
2. **It does not re-render your pages.** The preview is an iframe of the actual
   `book.html`, served **raw** off disk by this server rather than by Vite. Vite injects
   an HMR client into any HTML it serves, which would rewrite the file being previewed and
   turn the preview into a fiction. Verified byte-identical to disk.
3. **It writes no layout CSS and no `@media print` rules.** The theme owns layout. That
   invariant is the one thing keeping a PDF equal to the screen, and the UI does not get
   to break it.

## How it is wired

`src/server/index.mjs` is a single `node:http` server with Vite in middleware mode. One
process, one port, three kinds of request:

| Path | Served by | Why |
|---|---|---|
| `/api/*` | the server | read/write the four files, run the tools, stream results |
| `/preview/*` | the server, raw | the real book, byte for byte, with `../../src/engine/` resolving |
| everything else | Vite | the React app, with hot reload while you edit the UI itself |

Rooting `/preview` at the repo root is what keeps the engine's "books live exactly two
folders deep" rule intact: `/preview/books/showcase/book.html` resolves `../../src/engine/` to
`/preview/src/engine/`, which is on disk exactly as authored.

`/api/run` is a POST returning `text/event-stream`. Events are `start`, `line` and `done`;
`done` carries the exit code and, for `check`, the parsed `--json` result. It drives every
tool the cockpit runs: `build` (with the craft flags), `check`, `shot`, `export`, `epub`,
`web`, `card` and `publish`.

The read side is plain JSON: `/api/books`, `/api/file`, `/api/providers`, `/api/health`,
plus the cockpit's `/api/board` (the page map + dashboard totals + artifact flags),
`/api/facts` (the open-fact ledger), `/api/diagram` and `/api/diagram/example` (the studio).

## Safety

It binds `127.0.0.1`, not `0.0.0.0`. Book slugs must match `^[A-Za-z0-9][A-Za-z0-9._-]*$`
and resolve inside `books/`. Only the four source files are writable, and a `book.json`
that will not parse is refused with the parser's own message rather than written and left
to break the next build.

## Adding a file to the UI's reach

The four editable filenames are computed in `bookFiles()` in `src/server/index.mjs`, and the tab
strip is derived from the same list in `App.jsx`. To let it edit, say, `images/*.txt`
prompts, add them in both places — and make the `name` match the request, since the API
refuses anything not on the allowlist.