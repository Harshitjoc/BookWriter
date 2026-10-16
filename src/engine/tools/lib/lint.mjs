/* ==========================================================================
   lib/lint.mjs  -  the deep pass: what check.mjs cannot see
   --------------------------------------------------------------------------
   check.mjs measures one thing: does the content run past the bottom of the
   box. It says nothing about the ways a page that FITS can still be wrong:

     overlap        two text blocks sitting on top of each other
     contrast       a text colour that fails against its own background, which
                    on paper is the same as invisible text
     safe-zone      a block crossing the page's print margin
     ink-floor      an SVG label below the 11px floor the skill sets
     no-fill        an SVG <text> with no explicit fill, so it can inherit its
                    way to invisible (hard rule 3)
     font           a named family that silently fell back to a system font
     runt           a paragraph whose last line is one or two words
     gap            a page that is far too empty (a 40%-full page is as wrong
                    as one that is 5mm over)

   It is deliberately conservative: a warning is a question, not a verdict, and
   only the error-level findings can fail a build.
   ========================================================================== */

const INK_FLOOR_SVG = 11;   // px; below this an SVG label turns to mush in print
const INK_FLOOR_TEXT = 10;  // px; below this even body text is suspect
const SAFE_TOLERANCE_PX = 2;
const MIN_OVERLAP_FRACTION = 0.35;  // overlap smaller than this is a rounding artefact
const BIG_GAP_FRACTION = 0.30;      // an internal gap this big means the page is starved
const RUNT_FRACTION = 0.14;         // last line narrower than this = one or two words

/** Runs inside the browser. Returns { pages:[{page,title,findings}] }. */
function lintInPage(cfg) {
  const sheetSel = '.sheet';
  /* Families the document actually defines. document.fonts.check() returns true
     for a family with no @font-face at all (it reads as an unknown system font),
     so it cannot tell "loaded" from "never shipped". The FontFaceSet can. */
  const loadedFamilies = new Set([...document.fonts].map((f) => f.family.replace(/["']/g, '')));

  const parseColor = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const srgb = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * srgb(c.r) + 0.7152 * srgb(c.g) + 0.0722 * srgb(c.b);
  const contrast = (a, b) => {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const over = (top, bottom) => {   // composite `top` (src-over) onto opaque `bottom`
    const a = top.a;
    return {
      r: top.r * a + bottom.r * (1 - a),
      g: top.g * a + bottom.g * (1 - a),
      b: top.b * a + bottom.b * (1 - a),
      a: 1,
    };
  };

  const sheetBg = (sheet) => {
    const c = parseColor(getComputedStyle(sheet).backgroundColor);
    return c && c.a > 0 ? { r: c.r, g: c.g, b: c.b, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
  };

  /* Effective background of an element: composite every ancestor background from
     the sheet down, then the element's own. */
  const effBg = (el, sheet) => {
    let bg = sheetBg(sheet);
    const chain = [];
    for (let n = el; n && n !== sheet.parentElement; n = n.parentElement) chain.push(n);
    for (const n of chain.reverse()) {
      const c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) bg = over(c, bg);
    }
    return bg;
  };

  const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const isVisible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  const isSvgText = (el) => el.ownerSVGElement != null && el.tagName.toLowerCase() === 'text';
  const skip = (el) => el.closest('.sr, .of-badge');

  /* Elements that carry a run of text a reader reads as a block. Inline spans
     (role emphasis) are excluded: they share a line box with their paragraph and
     are colour, not layout. */
  const textBlocks = (sheet) => {
    const sel = 'h1,h2,h3,h4,p,li,figcaption,caption,td,th,.eyebrow,.pill,.sub,.title,.ask .lbl,.cue';
    return [...sheet.querySelectorAll(sel)].filter((el) => !skip(el) && isVisible(el) && textOf(el));
  };

  /* A paragraph's last line is a runt when it holds one short word. Inline spans
     split a line into several rects, so rects are grouped into line boxes by
     their top edge first; otherwise a trailing span fragment reads as a whole
     line one word wide. */
  const findRunt = (el) => {
    /* A runt is a wrapped-paragraph property. A flex/grid row (a TOC line with
       its number in a separate column) is not a paragraph, so it is skipped. */
    const own = getComputedStyle(el).display;
    if (own === 'flex' || own === 'grid') return null;
    if ([...el.children].some((c) => /flex|grid/.test(getComputedStyle(c).display))) return null;
    const rects = [...(function () {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getClientRects();
    })()].filter((r) => r.width > 1 && r.height > 1);
    if (rects.length < 2) return null;
    const lines = new Map();
    for (const r of rects) {
      const key = Math.round(r.top);
      const cur = lines.get(key) || { left: Infinity, right: -Infinity };
      cur.left = Math.min(cur.left, r.left);
      cur.right = Math.max(cur.right, r.right);
      lines.set(key, cur);
    }
    const ordered = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    if (ordered.length < 3) return null;
    const widthOf = (l) => l.right - l.left;
    const widest = Math.max(...ordered.map(widthOf));
    const lastW = widthOf(ordered[ordered.length - 1]);
    if (lastW < widest * cfg.runtFraction) return Math.round(lastW);
    return null;
  };

  const findGap = (sheet) => {
    const content = getComputedStyle(sheet);
    const box = sheet.getBoundingClientRect();
    const top = box.top + parseFloat(content.paddingTop) + parseFloat(content.borderTopWidth);
    const bottom = box.bottom - parseFloat(content.paddingBottom) - parseFloat(content.borderBottomWidth);
    const kids = [...sheet.children]
      .filter((k) => !skip(k) && isVisible(k))
      .map((k) => k.getBoundingClientRect())
      .sort((a, b) => a.top - b.top);
    if (kids.length < 2) return null;
    let maxGap = 0;
    let at = null;
    for (let i = 0; i < kids.length - 1; i++) {
      const g = kids[i + 1].top - kids[i].bottom;
      if (g > maxGap) { maxGap = g; at = kids[i].bottom; }
    }
    const height = bottom - top;
    if (height > 0 && maxGap / height > cfg.bigGapFraction) {
      return { px: Math.round(maxGap), pct: Math.round((maxGap / height) * 100) };
    }
    return null;
  };

  const pages = [];
  [...document.querySelectorAll(sheetSel)].forEach((sheet, i) => {
    const findings = [];
    const add = (level, rule, msg) => findings.push({ level, rule, msg });
    const sRect = sheet.getBoundingClientRect();
    const cs = getComputedStyle(sheet);
    const safe = {
      left: sRect.left + parseFloat(cs.paddingLeft),
      right: sRect.right - parseFloat(cs.paddingRight),
      top: sRect.top + parseFloat(cs.paddingTop),
      bottom: sRect.bottom - parseFloat(cs.paddingBottom),
    };

    const blocks = textBlocks(sheet);

    /* overlap between text blocks (never an ancestor/descendant pair) */
    for (let a = 0; a < blocks.length; a++) {
      for (let b = a + 1; b < blocks.length; b++) {
        const ea = blocks[a], eb = blocks[b];
        if (ea.contains(eb) || eb.contains(ea)) continue;
        const ra = ea.getBoundingClientRect(), rb = eb.getBoundingClientRect();
        const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ix <= 1 || iy <= 1) continue;
        const inter = ix * iy;
        const smaller = Math.min(ra.width * ra.height, rb.width * rb.height);
        if (smaller > 0 && inter / smaller >= cfg.minOverlapFraction) {
          add('error', 'overlap',
            `"${textOf(ea).slice(0, 24)}" overlaps "${textOf(eb).slice(0, 24)}" by ${Math.round(inter / smaller * 100)}%`);
        }
      }
    }

    /* text vs its own rendered background: contrast, and safe zone */
    for (const el of blocks) {
      const r = el.getBoundingClientRect();
      if (r.left < safe.left - cfg.safeTolerance || r.right > safe.right + cfg.safeTolerance
          || r.top < safe.top - cfg.safeTolerance || r.bottom > safe.bottom + cfg.safeTolerance) {
        add('error', 'safe-zone', `"${textOf(el).slice(0, 24)}" crosses the page margin`);
      }
      const color = parseColor(getComputedStyle(el).color);
      if (color) {
        const ratio = contrast(color, effBg(el, sheet));
        const size = parseFloat(getComputedStyle(el).fontSize);
        const bold = parseInt(getComputedStyle(el).fontWeight, 10) >= 700;
        const large = size >= 24 || (size >= 18.66 && bold);
        const need = large ? 3 : 4.5;
        if (ratio < need) {
          /* A hair under the line (a chosen hex that rounds to 4.3) is a real
             miss worth reporting but not worth failing a shipped book over. */
          const level = ratio < need - cfg.contrastGrace ? 'error' : 'warn';
          add(level, 'contrast',
            `"${textOf(el).slice(0, 24)}" is ${ratio.toFixed(1)}:1 (needs ${need}:1) — likely invisible in print`);
        }
      }
      const firstFamily = (getComputedStyle(el).fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
      if (cfg.brandFonts.includes(firstFamily) && !loadedFamilies.has(firstFamily)) {
        add('error', 'font', `"${firstFamily}" is referenced but the book never loaded it — the page fell back to a system font`);
      }
      if (parseFloat(getComputedStyle(el).fontSize) < cfg.inkFloorText) {
        add('warn', 'ink-floor', `"${textOf(el).slice(0, 24)}" is ${getComputedStyle(el).fontSize}, under the ${cfg.inkFloorText}px floor`);
      }
      const runt = findRunt(el);
      if (runt != null) add('warn', 'runt', `"${textOf(el).slice(0, 24)}" ends in a runt line (${runt}px wide)`);
    }

    /* SVG labels: explicit fill, ink floor. */
    for (const t of sheet.querySelectorAll('svg text')) {
      if (skip(t) || !isVisible(t)) continue;
      const attrFill = t.getAttribute('fill');
      const styleFill = (t.getAttribute('style') || '').includes('fill');
      if (!attrFill && !styleFill) {
        add('error', 'no-fill', `SVG label "${textOf(t).slice(0, 24)}" has no explicit fill — it can inherit to invisible`);
      }
      const svgSize = getComputedStyle(t).fontSize;
      if (parseFloat(svgSize) < cfg.inkFloorSvg) {
        add('warn', 'ink-floor', `SVG label "${textOf(t).slice(0, 24)}" is ${svgSize}, under the ${cfg.inkFloorSvg}px floor`);
      }
    }

    const gap = findGap(sheet);
    if (gap) add('warn', 'gap', `a ${gap.pct}% empty band (${gap.px}px) — the page looks starved`);

    pages.push({ page: i + 1, title: (sheet.querySelector('.title')?.textContent || sheet.className.replace('sheet', '').trim() || '—').slice(0, 34), findings });
  });

  return { pages };
}

/**
 * Lint a book that is already open in a page. Returns
 * `{ pages:[{page,title,findings:[{level,rule,msg}]}] }`.
 */
export async function lintBook(page, overrides = {}) {
  const cfg = {
    inkFloorSvg: INK_FLOOR_SVG,
    inkFloorText: INK_FLOOR_TEXT,
    safeTolerance: SAFE_TOLERANCE_PX,
    minOverlapFraction: MIN_OVERLAP_FRACTION,
    bigGapFraction: BIG_GAP_FRACTION,
    runtFraction: RUNT_FRACTION,
    contrastGrace: 0.5,
    brandFonts: ['Space Grotesk', 'Inter', 'JetBrains Mono'],
    ...overrides,
  };
  return page.evaluate(lintInPage, cfg);
}

/** Count findings by level across a lint result. */
export function tally(lint) {
  let errors = 0, warnings = 0;
  for (const p of lint.pages) for (const f of p.findings) (f.level === 'error' ? errors++ : warnings++);
  return { errors, warnings };
}
