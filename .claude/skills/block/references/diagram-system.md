# Diagram System

The diagram is one inline `<svg>` between the title block and the explainer. It uses the studio palette, a small fixed vocabulary (cards, arrows, numbered badges, a one-line key), and a shape chosen by block type.

## Table of contents
1. Scaffold and reusable defs
2. Color roles
3. Building blocks (card, badge, key line, trust boundary)
4. Text rules
5. Shape catalog by block type (with worked examples)
6. Layout checklist

## 1. Scaffold and reusable defs

```
<svg width="100%" viewBox="0 0 592 {{H}}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="{{plain description}}">
<defs>
<marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>
<filter id="cs" x="-20%" y="-25%" width="140%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#1A1A2E" flood-opacity="0.07"/></filter>
</defs>
... content ...
</svg>
```

- viewBox width is **592** (the page content area at 44px padding). Keep it 592 so the diagram renders 1:1 on the page.
- Height varies by shape: a single row is about 176, a branch or funnel about 200, an attack with a return loop about 232.
- The arrow marker uses `context-stroke`, so an arrow's head matches its line color. Make a line red and its head is red for free.
- One soft shadow filter (`cs`) for all cards.

## 2. Color roles

Two or three accents max, plus neutrals. Every color carries meaning. Don't decorate.

| Role | Use for | Fill | Stroke | Title text | Subtitle text |
|---|---|---|---|---|---|
| Neutral | your app/server, structural boxes | `#FFFFFF` | `#E7E9EF` | `#1A1A2E` | `#5B6472` |
| Mechanism (indigo) | the thing being taught (the limiter, HMAC, the tunnel) | `#EEF0FE` | `#D5D8FA` | `#4F46E5` | `#6366F1` |
| Good (teal) | the desired outcome (authentic, passes, success) | `#ECFBF7` | `#CDEFE8` | `#0D9488` | `#5B6472` |
| Threat / bad (red) | the attacker, the rejected or failed outcome | `#FEF1F1` | `#F8D6D6` | `#DC2626` | `#5B6472` |
| Sensitive (amber) | the valuable thing being protected (secrets, money) | `#FFFFFF` or `#FDF6E8` | `#E7E9EF` | `#1A1A2E` | `#B45309` (often mono) |

- **Badges** (step numbers): fill `#6366F1`, white number.
- **Arrows**: neutral slate `#94A3B8`. Make only the **bad** arrow (a leak, a rejection) red `#DC2626`, so a normal-looking flow turns dangerous only at the end.
- **Trust boundary** (a perimeter the attacker is outside of): dashed `#CBD2DC`.

## 3. Building blocks

**Card** (two lines, centered). `x`/`y` is the top-left; `cx` is the horizontal center.
```
<rect x="{{x}}" y="{{y}}" width="150" height="60" rx="13" fill="#FFFFFF" stroke="#E7E9EF" stroke-width="1" filter="url(#cs)"/>
<text x="{{cx}}" y="{{y+25}}" text-anchor="middle" style="font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:600;fill:#1A1A2E">{{Title}}</text>
<text x="{{cx}}" y="{{y+43}}" text-anchor="middle" style="font-family:'Inter',sans-serif;font-size:11px;fill:#5B6472">{{subtitle}}</text>
```
Swap fill, stroke, and text colors per role. Use JetBrains Mono for addresses, status codes, and commands (`169.254.169.254`, `200 OK`, `ssh user@host`).

**Numbered badge:**
```
<circle cx="{{x}}" cy="{{y}}" r="11" fill="#6366F1"/>
<text x="{{x}}" y="{{y}}" text-anchor="middle" dominant-baseline="central" style="font-family:'Inter',sans-serif;font-size:12px;font-weight:600;fill:#FFFFFF">1</text>
```
Place badges on the arrows (or just above them), one per step. They map to the key line.

**The key line** (one line under the diagram, the steps in words):
```
<text x="296" y="{{H-16}}" text-anchor="middle" style="font-family:'Inter',sans-serif;font-size:12.5px;fill:#5B6472">1 ... · 2 ... · 3 ...</text>
```
Keep it under about 72 characters so it fits 592 wide. Use ` · ` as the separator and `→` sparingly.

**Trust boundary** (perimeter):
```
<rect x="{{x}}" y="{{y}}" width="{{w}}" height="{{h}}" rx="14" fill="none" stroke="#CBD2DC" stroke-width="1" stroke-dasharray="5 5"/>
<text x="{{x+20}}" y="{{y+18}}" style="font-family:'Inter',sans-serif;font-size:11px;fill:#5B6472">Your machine</text>
```

## 4. Text rules

- Every `<text>` carries its own `fill` and `font-family` in an inline `style`. SVG text doesn't inherit the page fonts or colors reliably.
- Card title: Space Grotesk 14 to 15px weight 600. Subtitle: Inter or JetBrains Mono 11px.
- No font below 11px.
- Center two-line card text with the title about 25px below the card top and the subtitle about 43px below.

## 5. Shape catalog by block type

Each shape is a starting point, not a cage. Flex it to the concept.

### Attack → there-and-back across a trust boundary (worked example: SSRF)
- Attacker (red) **outside** a dashed boundary. Inside the boundary sit your app (neutral) and the sensitive target (neutral with an amber mono address).
- Arrow 1 attacker to app (slate), arrow 2 app to target (slate), arrow 3 target back to attacker as a return loop routed **below** the boundary, drawn **red** (the leak).
- Key: `1 attacker sends a URL · 2 your app fetches it · 3 secret keys leak back out`. Height about 232.

### Resilience → happy path plus a drop to the fallback (worked example: rate limiting)
- Linear top row: source (neutral) to mechanism (indigo) to good outcome (teal).
- A vertical drop from the mechanism to the bad or limited outcome (red), e.g. a 429.
- Badges on the three arrows. Height about 200.

### Performance → timeline or before/after (worked example: debouncing)
- A horizontal time axis. Cluster the rapid events as short red ticks, mark a quiet gap with a small amber bracket, fire a single teal dot, arrow into a teal "1 call" card.
- Or two stacked timelines: "without" (many calls) versus "with" (one).
- Height about 176.

### Correctness → recompute-and-compare funnel (worked example: HMAC)
- Two inputs on the left (e.g. message, secret key) funnel into the mechanism (indigo) in the middle, which branches to two outcomes on the right: good (teal) and bad (red).
- Four short diagonal arrows. Badges: inputs, mechanism, the match outcome. Height about 200.

### Auth → handshake / token flow (OAuth, magic links)
- User (neutral) to your app (neutral) to provider (indigo mechanism) and back with a token. Show the redirect or round trip. The secret (the password) never travels. Show what does.

### Async & jobs → producer to queue to worker (Celery, Django-Q2)
- A web request (neutral) drops a job into a queue (indigo) and returns immediately (teal "instant response"). A worker (neutral) pulls from the queue and does the slow work off to the side.

### Tooling & env → isolation box (venv, uv)
- A project (neutral) inside its own dashed box holding its own pinned dependencies, separate from the system. Contrast with a second project that has different versions and doesn't clash.

### Integration → call and callback (webhooks, API, MCP)
- For a webhook: their system (neutral) POSTs an event to your app's URL (indigo arrow), your app verifies and acts. Show the direction is **inbound** to you, which is the thing beginners get wrong.

## 6. Layout checklist (run before presenting)

- viewBox width is 592; nothing is clipped past 0 or 592.
- Cards about 150px wide; gaps leave room for badges (about 70px).
- Every text has explicit fill and font-family; nothing below 11px.
- Two or three accent colors total, each meaningful.
- The key line is under about 72 chars and centered at x=296.
- Arrows neutral slate, except the one "bad" arrow in red.
- Soft shadow on cards via the `cs` filter; no harsh borders.

## 7. Diagrams as code (preferred for agents)

Hand-writing the SVG above re-solves the same layout every time and is where the
invisible-text and off-canvas bugs come from. `engine/tools/diagram.mjs` compiles
a small JSON spec into exactly that SVG: 592-wide viewBox, placed cards, arrows,
badges, key line, and an explicit `fill` on every `<text>`. Same spec in, same
bytes out.

```js
import { compileDiagram } from '../../engine/tools/diagram.mjs';

compileDiagram({
  kind: 'row',
  key: '1 ask · 2 wait · 3 answer',
  cards: [
    { title: 'You', sub: 'ask quickly' },
    { title: 'The limiter', sub: 'five a minute', role: 'mechanism' },
    { title: 'The API', sub: 'answers', role: 'good' },
  ],
});
```

Roles: `neutral` (default), `mechanism` (indigo), `good` (teal), `bad` (red),
`sensitive` (amber). Shapes (`kind`): `row`, `pipeline`, `funnel`, `beforeAfter`,
`timeline`, `attack`, `isolation`, `handshake`, `tunnel`. The shapes map to the
block types in section 5 — pick the one that matches the concept.

From the command line:

```bash
node engine/tools/gen-diagram.mjs --list               # the shapes and their use
node engine/tools/gen-diagram.mjs --example attack     # a starter spec
node engine/tools/gen-diagram.mjs spec.json --out diagram.svg
```

`gen-diagram.mjs` runs the page's own `checkDiagram()` on the result and refuses
a diagram that would draw off the canvas, so a bad spec fails before it reaches a
book. Paste the printed `<svg>` into the page's `<div class="diagram">`, or build
the page with a `diagram` spec where the draft tooling supports it.
