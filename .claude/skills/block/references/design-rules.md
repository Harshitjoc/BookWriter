# Design rules (living)

Design corrections accumulated from real pages, encoded so each new page gets them right by
default. Newest rules win. When one of these disagrees with the general guidance, this file wins.
Read this at Step 3 (build) alongside `diagram-system.md`. Every entry traces to a real correction.

## Diagram cards (spacing + alignment) — from page 01 feedback ("text messy, align + space it better")

- **Card geometry:** width `150`, height `54`, `rx="12"`. Keep every card identical; share x-positions
  across rows so columns line up (e.g. `x=24 / 220 / 416`, centers `99 / 295 / 491`, in a 592 viewBox).
- **Two-line text, optically centered as ONE unit** (not floating high):
  - title — Space Grotesk 14 / 600, baseline at `cardY + 23`
  - subtitle — Inter 11, baseline at `cardY + 38`  (a tight **15px** line gap, not 18)
- **Arrows** centered on card mid-height (`cardY + 27`); neutral slate `#94A3B8`, except the one
  "bad" arrow in red `#DC2626`.
- **Section labels inside a diagram** (e.g. "WITHOUT A PLAN") are small-caps markers, not body text:
  Inter `11.5 / 600`, `letter-spacing:.3px`, `#5B6472`, placed ~10px above their card row.
- **Don't repeat the explainer in a diagram key line.** Drop the bottom key line when row labels +
  the explainer already carry the point. Use a numbered key line only when steps genuinely need 1·2·3.
- Tight vertical rhythm: ~10px label→cards, ~24px between the two rows, ~20px cards→edge. No floaty gaps.

## Page header — no kicker above the diagram (from page 01 feedback)

- **Drop the `<div class="kicker">How it works</div>`.** It read cramped/unprofessional and added nothing
  once the diagram carries its own labels. The diagram follows the header's `<hr class="rule">` directly.
  Keep that rule as the separator. Applies to every page; don't re-add the kicker.

## Explainer: short paragraphs + meaningful color (from page-01 feedback)

- **Never one wall of text.** Break the explainer into 2–3 short paragraphs (problem, then the fix),
  plus the bold closer. A single `<p>` slab is the weakest version; the theme spaces stacked `<p>`s.
- **Color = role, never decoration.** Reuse the diagram's language so the eye learns it once:
  - `<span class="bad">…</span>` red = the problem / the pain
  - `<span class="hl">…</span>` indigo = the fix / the mechanism / the core idea (the block itself)
  - `<span class="good">…</span>` teal = the good outcome
  - `<strong>…</strong>` semibold ink = a key phrase that isn't one of those roles
- A few emphases per page (~one per role) so skimming the highlights tells the story:
  *problem (red) → fix (indigo) → outcome (teal)*. Don't paint every other word.
- For **attack** blocks (no fix shown in the body), use red for the threat and let the Tell-the-AI box
  carry the defense.

## "Tell the AI" box — on EVERY block (from page-01 feedback)

- Every block ends with `<div class="ask"><span class="lbl">TELL THE AI</span><p>…</p></div>`.
  It is the book's thesis made literal ("you just need to know it exists so you can ask the AI").
- The text is the concept's **Action** line from the book's `blocks.md`, lightly cleaned
  into plain voice. One copy-pasteable instruction. Keep it short (≈2 lines).
- **When the author shares their own method for a concept (Step 0), the box becomes THAT method, not a
  generic prompt.** E.g. for planning, his actual flow: a dedicated planning chat ("let's discuss and
  plan the [feature]"), go back and forth till it's exactly right, run `/grill-me` to surface blind
  spots, then save the plan as a step-by-step `.md` and implement it in a fresh session. A rich
  multi-step box like this can **replace the closer** (drop `p.close` to make room).

## "You'll know you need it when…" cue — situational blocks only

- Optional `<div class="cue">…</div>` from the concept's **`Use when:`** line, for **situational**
  (`◦`) concepts. **Skip it on always-on (`⭐`)** blocks (Git, error handling) where the answer is just
  "always". **Debuted on venv (#5)**; also used on Agent memory (#9) and Skills (#10).

## B5 layout budget (from page-01 — the page over-filled and the diagram got crushed)

- A page holds: header + a **modest diagram band** + explainer (2–3 short paras + closer) + the
  Tell-the-AI box + footer. That is FULL for B5 — there is no room for a hero-sized diagram too.
- The diagram is a fixed band (`.diagram{ flex:0 0 auto }`, `svg{ max-height:200px }` since the tighter
  9mm margins freed room — a full-width two-row diagram lands ~185px; the venv isolation diagram ~196px),
  centered, not a giant;
  the footer pins to the bottom (`.foot{ margin-top:auto }`). Keep the explainer ≈6 lines.
  If a page overflows, **trim the explainer first**.
- **`check.mjs` only catches scroll-overflow, NOT overlap.** An over-full flex page can overlap
  silently and still report `overMm: 0`. ALWAYS run `shot.mjs` and Read the PNG before a page is done.
- **To reclaim B5 height, COMPACT the diagram content — never just shrink the viewBox number.** Cropping the
  `viewBox` height to make a page fit silently **clips** cards/shadows past the new bottom edge and lets a bottom
  caption **collide** into content; `check.mjs` still reads `overMm:0` either way (page 22 hit exactly this — a
  request card clipped + caption overlapping). The fix is to shorten cards, tighten gaps, and move the caption
  into genuine empty space so the content truly fits the smaller canvas. Trim the explainer first; shrink the
  diagram by compacting it, not by cropping it.

## Diagram shape per concept kind

- **Process / discipline blocks** (plan-first, MVP, file-size ceiling…): **before/after two-row contrast**
  — problem path on top (ends red), fixed path below (ends teal), the taught thing in indigo. This is the
  default for the kinds not covered by the threat-shape catalog in `diagram-system.md`.
- **Tooling / env blocks** (venv, uv…): **isolation box** (debuts on page 05, venv). Two projects side by
  side, **each in its own dashed indigo box** (faint `#F6F7FE` fill, `#C3C8F5` dashed stroke, a small
  indigo `VENV`/tool label top-left), each holding a neutral project card **plus its own pinned dependency
  in a small bordered mono chip** below the card, in **amber** (`#FDF6E8` fill, `#EFDCB6` stroke, `#B45309`
  mono text, rx 11) so the pinned package reads as its own concrete value, distinct from the indigo venv
  box and the white project card. Use the **same package name at different versions** (e.g. `django 4.2`
  vs `django 5.1`) so the
  whole point — sealed off, no clash — is carried by the picture. A small-caps setup label on top
  (`SAME PACKAGE, DIFFERENT VERSIONS`) and a teal payoff caption below (`Sealed off, so they never clash.`).

## Vary the diagram shape across the book

- **Don't default everything to the before/after two-row.** Pick the leak-gate fork for
  Secrets "for variety," and reacts well to a fresh shape that fits the concept. Avoid 3+ two-rows in a row.
- Shapes invented so far (reuse / remix freely): two-row before/after; timeline + revert (Git); isolation
  box (venv); leak-gate fork (Secrets); sessions-over-a-shared-file (memory); command→file→steps (Skills);
  monolith→modules split (Modularity); tangled→layers (Separation); annotated code card + mapped UI (JSON);
  query→result table (SQL); entity-relationship with a "1 → many" link (Data modeling); ordered steps→DB
  cylinder (Migrations); wrapped-steps→commit/rollback fork (Transactions); scan-vs-jump rows (Indexing);
  count-blowup N vs 2 (N+1); rigid-table-vs-flexible-documents side-by-side (NoSQL #20 — a fixed-column grid
  next to document cards whose *differing* keys are highlighted, so the picture itself shows "each record its
  own shape"); encrypt-in-transit tunnel with a wiretap (TLS #21 — readable value at both ends, scrambled in
  the indigo tunnel, a red dashed tap to an eavesdropper who "only sees gibberish"); request→schema-gate→
  orthogonal pass/reject fork, a bouncer-at-the-door (Input validation #22); attack there-and-back loop reused
  for an injection (XSS #23 — attacker → your page → a visitor's browser → red return arrow exfiltrates the
  session); cross-site forged request with the **session cookie riding the arrow** as an amber chip (CSRF #24);
  two-row allowed-vs-blocked under an allowlist banner, shared origin colored to its outcome (CORS #25); one-way
  transform with a crossed-out reverse arrow (Hashing #27); login/token handshake, two cards with the request going
  up and the token coming back in teal (Authentication #28); a capability checklist, a role → drawn ✓/✗ rows colored
  green/red (Authorization #29); a failed-attempt counter tripping a lockout, red ✗ ticks tallying to the threshold
  (Brute force #30); a **widening-gap retry timeline** (tries with "wait 1s · 2s · 4s" and visibly growing gaps to
  show backoff, Retry #32); an **open-switch breaker** (a lifted-lever switch glyph + a red dashed/✗ blocked link,
  Circuit breaker #33); a **two-lane interleave** (two actors both reading the same shared value before either
  writes, converging on a wrong result, Race conditions #35). Pick what makes the concept *obvious*, not what's
  novel for its own sake. Later additions: a **queue hub / producer-queue-worker** split (instant reply off the
  top, the worker pulling the slow job below, Background jobs #36); a **funnel to one place** (several error sources
  each throwing a red ✗ converging on one tracker → an alert, Error tracking #40); a **plain-vs-structured
  side-by-side** (a flat gray log block next to a JSON record with the context fields highlighted, Structured logs
  #41); a **test-gate fork** (a change → tests → ships / caught, Testing #42); a **linear pipeline** under an
  "automatic" banner (push → build → test → deploy → live, CI/CD #43); a **name→IP resolution** (a domain on one
  card, the numeric address on the other, DNS translating between, Domain & DNS #44); a **failover fork** (app →
  one unified interface → primary provider down / failover provider takes over, the interface staying constant,
  Unified interface #45); a **scripted browser walkthrough** (a real browser driven step by step, ending in a teal
  verify, Playwright #46); a **tool hub** (one agent → a bridge → fanning out to many service tools, MCP #47).
- **Mapping two representations of the same data** (JSON ↔ UI, query ↔ result rows, request ↔ response):
  color the **shared values identically in both** (e.g. the data values teal in the JSON *and* in the UI),
  so the eye maps which-becomes-which by color without connector lines. Keys/labels stay a different role
  color (indigo). Debuted on JSON #13.

## Diagram spacing: don't let framing text hug the boxes (from page 05 feedback)

- The **top setup label and the bottom payoff caption need ~18px of air** above/below the box row. Cramming
  them right against the cards (8–14px) reads as crowded. Budget the diagram top-to-bottom: ~18–22px gap
  under the top label, ~22px gap above the caption. At the current **200px diagram cap** the venv boxes sit
  ~136px tall, and the pinned-package chip needs its own air: **~16px above it (from the card) and ~12px
  below it (to the box edge)** — a chip jammed against the box bottom reads as cramped. Keep this generous;
  don't shrink the gaps to save height.
- **Content-bearing cards (a code/JSON snippet, a mock UI) need even inner padding** — ~16px on all sides,
  vertically centered. Text or braces hugging the card edge (esp. a closing `}` near the bottom) looks
  cheap; grow the card height rather than cram. (From page 13 feedback — the JSON card.)
- **Condition labels on a fork** (e.g. "all succeed" / "one fails" on a commit-vs-rollback fork): keep them
  **≥11px, italic, parallel wording**. A horizontal label over a **diagonal** line never looks aligned, no
  matter where you nudge it. **Route the fork orthogonally** instead: a short stem from the box → a vertical
  bus → two **horizontal** arrows to the outcome cards. Then each label sits squarely above its horizontal
  arrow and reads as professionally aligned. Color the branches to their outcomes (teal = good path, slate =
  neutral). Watch the 11px floor: dense diagrams kept slipping to 10.5. (Pages 17 feedback, two rounds.)

## Page geometry: tighter bottom margin + page numbers (from page 05 feedback — "better for all pages")

These live in `engine/themes/studio.css`, so they apply to **every** book page automatically.

- **Vertical margins are 9mm (top AND bottom); the sides stay 14mm** (`.sheet.bb{ padding:9mm var(--page-pad) }`).
  Pages are vertically constrained, not horizontally, so tighten top/bottom and keep the side/binding margin
  generous. This frees ~10mm of vertical budget and drops the footer closer to the edge. (Spare budget shows
  up as breathing room above the footer, since the footer pins to the bottom.)
- **Page numbers** auto-number via a CSS counter: `.deck{ counter-reset:bbpage }`, each
  `.sheet.bb{ counter-increment:bbpage }`, printed by `.foot .pg::before{ content:counter(bbpage) }`. They
  survive reordering and new pages, so never hardcode a page number.
- **Footer is three parts now:** `<span class="brand">` (left), `<span class="pg">` (the centered page
  number), `<span class="series">` (right). `.brand`/`.series` are `flex:1` so `.pg` sits dead-center
  regardless of the side text widths. **What goes in `brand`/`series` is per book** (see SKILL.md
  the footer's brand and series text come from `book.json` and are stamped in at build time;
  the **Complete Edition** prints the book title on the left and its build injects the block's **part
  name** on the right — and its eyebrow carries **no `No. NN`**.
- **Inline links** (a real product or resource named in the copy): wrap in a
  plain `<a href>` and let `.bb a` style it — **ink text with an accent underline**, NOT a colored word, so
  it doesn't read as a role-emphasis (`.hl`) span. Link in body copy, not inside SVG/diagram figure labels.
