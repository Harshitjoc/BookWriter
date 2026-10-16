# Page Template

> **Do not emit this standalone document per page.** In a book the look is linked from
> `../../engine/themes/studio.css`, and each page is one `<section class="sheet bb">…</section>`
> written into the book's interior file. Copy `references/example-page.html` instead.
>
> The standalone template below is kept as the **design-token reference**: the palette, the
> anatomy, and the colour notes. Read those, ignore the wrapper.

The page is a standalone HTML document in the Modern AI Studio theme. Copy the whole template below, swap the `{{...}}` placeholders, and save as `.html` to `/mnt/user-data/outputs/`.

## Tokens (Modern AI Studio)

Indigo is the accent; the rest are neutrals plus three semantic accents. Change them at the top
of `.sheet.bb` in `engine/themes/studio.css` and every page in every book follows.

- `--surface` `#FAFAFC` page paper, `--card` `#FFFFFF` cards
- `--ink` `#1A1A2E` primary text, `--muted` `#5B6472` secondary, `--line` `#E7E9EF` borders
- `--accent` `#6366F1` indigo brand, `--accent-strong` `#4F46E5`
- `--signal` `#0D9488` teal (good / success), `--danger` `#DC2626` red (threat / bad), `--warn` `#B45309` amber (sensitive / valuable)
- Fonts: Space Grotesk (display/title), Inter (body), JetBrains Mono (code, addresses, status codes)

## The template

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{TITLE}} — {{SERIES}}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--surface:#FAFAFC;--card:#FFFFFF;--ink:#1A1A2E;--muted:#5B6472;--line:#E7E9EF;--accent:#6366F1;--accent-strong:#4F46E5;--signal:#0D9488;--danger:#DC2626;--warn:#B45309;--radius:16px;}
*{box-sizing:border-box;}
body{margin:0;background:#EEEFF3;font-family:"Inter",system-ui,sans-serif;display:flex;justify-content:center;padding:32px 16px;}
.page{background:var(--surface);color:var(--ink);width:100%;max-width:680px;border:1px solid var(--line);border-radius:var(--radius);box-shadow:0 1px 2px rgba(26,26,46,.05),0 14px 36px rgba(26,26,46,.06);padding:38px 44px 30px;line-height:1.6;}
.tab{width:56px;height:7px;border-radius:99px;background:var(--accent);}
.top{display:flex;justify-content:space-between;align-items:center;margin-top:15px;}
.eyebrow{font-size:13px;color:var(--muted);}
.eyebrow b{color:var(--accent);font-weight:600;}
.pill{font-size:12px;font-weight:500;color:#4B5563;background:#F1F2F6;border:1px solid var(--line);padding:5px 13px;border-radius:99px;white-space:nowrap;}
h1.title{font-family:"Space Grotesk",sans-serif;font-size:42px;font-weight:600;letter-spacing:-.02em;color:var(--ink);margin:12px 0 0;}
.sub{font-size:18px;color:var(--muted);margin-top:3px;}
.rule{height:1px;background:var(--line);border:0;margin:20px 0;}
.kicker{font-size:13px;color:var(--muted);margin-bottom:8px;}
.explain{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 24px;font-size:16px;color:var(--ink);box-shadow:0 1px 2px rgba(26,26,46,.04);}
.explain p{margin:0;color:var(--ink);}
.explain p.close{margin-top:12px;font-weight:500;}
.foot{display:flex;justify-content:space-between;font-size:12.5px;color:var(--muted);margin-top:16px;padding-top:14px;border-top:1px solid var(--line);}
.foot span{color:var(--muted);}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);}
</style>
</head>
<body>
<main class="page">
<h2 class="sr">{{SR_SUMMARY}}</h2>
<div class="tab"></div>
<div class="top">
<div class="eyebrow"><b>{{SERIES}}</b> · No. {{NUMBER}}</div>
<span class="pill">{{CATEGORY}}</span>
</div>
<h1 class="title">{{TITLE}}</h1>
<div class="sub">{{SUBTITLE}}</div>
<hr class="rule">
<div class="kicker">How it works</div>
{{DIAGRAM_SVG}}
<hr class="rule">
<div class="explain">
{{EXPLAINER_PARAGRAPHS}}
</div>
<div class="foot"><span>{{FOOTER_LEFT}}</span><span>{{FOOTER_RIGHT}}</span></div>
</main>
</body>
</html>
```

## Placeholder guide

- `{{SERIES}}` — the book's series label (the bold indigo words in the eyebrow), from `book.json`
- `{{NUMBER}}` — the number only, e.g. `04` (numbered books only; the **Complete Edition** eyebrow has no
  number at all — drop the ` · No. {{NUMBER}}` part, see SKILL.md *Per-book chrome*)
- `{{CATEGORY}}` — the pill (Security, Reliability, Performance, Auth, Tooling, Integration)
- `{{TITLE}}` — the concept; an acronym stays uppercase (SSRF, HMAC, OAuth)
- `{{SUBTITLE}}` — the acronym expansion in sentence case ("Server-side request forgery") or a one-line plain descriptor
- `{{DIAGRAM_SVG}}` — the inline `<svg>` (see `diagram-system.md`)
- `{{EXPLAINER_PARAGRAPHS}}` — the prose; wrap the body in `<p>...</p>` and put the short closing line in `<p class="close">...</p>`
- `{{FOOTER_LEFT}}` — the book's `brand` from `book.json`, stamped in at build time
- `{{FOOTER_RIGHT}}` — a placeholder; the build injects the page's part name
- `{{SR_SUMMARY}}` — a one-sentence plain-text summary of the page for screen readers

## Anatomy (top to bottom)

1. accent tab (indigo bar)
2. eyebrow row: series and `No. NN` on the left, category pill on the right
3. title (big, Space Grotesk) and subtitle (muted)
4. divider
5. "How it works" kicker
6. the diagram (inline SVG)
7. divider
8. the explainer card (the prose plus the short closer line)
9. footer: brand left, series right

## Why text colors are set explicitly

Every heading, paragraph, and footer span sets its own `color`. If you rely on inheritance, a host stylesheet or a dark-mode default that targets `h1` or `p` directly wins, because an inherited color is the weakest of all, and the text renders white and invisible on the light page. This already bit us once on a title. Same reason every SVG `<text>` carries its own `fill`.

## Fixed light, on purpose

Modern AI Studio is a light system, and these pages are previews of a light printed book. Do not add a `prefers-color-scheme: dark` block. The page should look the same in light and dark surroundings, like a sheet of paper.

## Adapting to print trim (when the book size is locked)

The template above is a screen-sized card. The printed page is B5, 176 x 250 mm:

- Set the `.page` to the trim size at 300 DPI (8.5 x 11 in becomes 2550 x 3300 px), or use real units with `@page { size: 8.5in 11in; margin: 0 }`.
- Add **bleed**: extend any edge-touching color 0.125 in past the trim (page becomes 2625 x 3375 px with bleed).
- Add a wider **inner / binding margin** (gutter) so text doesn't fall into the spine, roughly 0.75 to 0.875 in inside, 0.5 in outside, top, and bottom.
- Scale type up for print (title around 56 to 64 px at 300 DPI) and re-check the diagram width against the new content area.

Keep the ebook export as the screen template (one fixed-layout page per block), and treat the print build as a separate output of the same content.
