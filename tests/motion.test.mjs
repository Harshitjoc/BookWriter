/* ==========================================================================
   test/motion.test.mjs  -  motion is opt-in, moves nothing, and freezes
   --------------------------------------------------------------------------
   The two things this file must prove, in this order:

   1. A book that names no motion pack builds to exactly the bytes it always
      did. Motion is additive or it is a bug.

   2. A book that does name a pack still reads 0 mm, because every animation it
      ships moves only transform and opacity, and because check.mjs measures the
      still pose that paper will get.

   It also proves the pack list is real (an unknown id is refused) and that the
   runtime exposes the freeze/play/seek hooks the video pipeline will drive.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { group, ok, report, cli, scratchBook, ROOT } from './harness.mjs';
import { normalizePacks, listMotion, PACK_IDS, MOTION_CSS, MOTION_JS } from '../src/engine/tools/motion.mjs';
import { launch, open, hasMotion } from '../src/engine/tools/lib/render.mjs';

const MOTION_DIR = path.join(ROOT, 'src', 'engine', 'motion');
const build = (b) => cli('build-book.mjs', `books/${b.slug}`);
const check = (b) => {
  const r = cli('check.mjs', path.join('books', b.slug, 'book.html'), '--json');
  let json = null;
  try { json = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch { /* reported below */ }
  return { ...r, json };
};

group('the pack list is real and an unknown id is refused');
{
  ok('the registry has packs', PACK_IDS.length >= 4, PACK_IDS.join(', '));
  ok('every pack has a label and a note',
    listMotion().every((p) => p.label && p.note));
  ok('a null value means no motion', normalizePacks(null).length === 0);
  ok('a single id string works', JSON.stringify(normalizePacks('fade')) === '["fade"]');
  ok('a comma list works', JSON.stringify(normalizePacks('fade, draw')) === '["fade","draw"]');
  ok('an array works, de-duped', JSON.stringify(normalizePacks(['stick', 'fade', 'fade'])) === '["stick","fade"]');
  let threw = '';
  try { normalizePacks('zoomies'); } catch (e) { threw = e.message; }
  ok('a made-up pack is refused by name', /unknown motion pack "zoomies"/.test(threw), threw);
}

group('the motion assets exist and move only transform and opacity');
{
  ok('motion.css exists', fs.existsSync(path.join(MOTION_DIR, MOTION_CSS)));
  ok('motion.js exists', fs.existsSync(path.join(MOTION_DIR, MOTION_JS)));

  const css = fs.readFileSync(path.join(MOTION_DIR, MOTION_CSS), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');          // comments describe, they do not do
  /* The whole reason a moving page can still read 0 mm: nothing here animates a
     property that changes the measured box. */
  const animatedProps = [...css.matchAll(/@keyframes[^{]*\{([\s\S]*?)\}\s*\}/g)]
    .map((m) => m[1]).join('\n');
  ok('no keyframe animates a size or spacing property',
    !/\b(width|height|margin|padding|font-size|top|left|right|bottom)\s*:/.test(animatedProps),
    (animatedProps.match(/\b(width|height|margin|padding)\s*:/) || [''])[0]);
  ok('print freezes the motion at rest',
    /@media print\{?[\s\S]*animation:\s*none\s*!important/.test(css) ||
    /@media print \{[\s\S]*animation: none !important/.test(css));
  ok('reduced-motion freezes the motion at rest',
    /prefers-reduced-motion[\s\S]*animation:\s*none\s*!important/.test(css));
  /* Every rule that could match a book page must be gated on [data-motion], so
     a book that did not ask for motion can never be reached by this file. We
     check the SELECTORS, not the declarations: split on rule bodies and look at
     what each selector starts with. */
  const beforePrint = css.split('@media print')[0].split('@media (prefers-reduced-motion')[0];
  /* Drop @keyframes blocks first: their from/to steps are not selectors. */
  const noKeyframes = beforePrint.replace(/@keyframes[^{]*\{[\s\S]*?\n\}/g, '');
  const selectors = [...noKeyframes.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => !s.startsWith('@') && !s.startsWith('/*'));
  const leaks = selectors.filter((s) =>
    s.split(',').some((one) => !/\[data-motion/.test(one.trim())));
  ok('every rule is gated on [data-motion]', leaks.length === 0, leaks.slice(0, 3).join(' | '));
}

group('a book with no motion builds to exactly the bytes it always did');
{
  const b = scratchBook('motnone');
  try {
    const r = build(b);
    ok('it builds', r.code === 0, r.stderr.split('\n')[0]);
    const html = fs.readFileSync(path.join(b.dir, 'book.html'), 'utf8');
    ok('it names no motion', !/data-motion=/.test(html));
    ok('it links no motion stylesheet', !/motion\/motion\.css/.test(html));
    ok('it links no motion script', !/motion\/motion\.js/.test(html));
    ok('it is byte-identical to the committed starter',
      html === fs.readFileSync(path.join(ROOT, 'books', 'starter', 'book.html'), 'utf8'));
    ok('hasMotion() agrees it has none', hasMotion(path.join(b.dir, 'book.html')) === false);
  } finally { b.drop(); }
}

group('a book that asks for motion gets it, and still reads 0 mm');
{
  const b = scratchBook('moton', { motion: ['fade', 'draw', 'isometric'] });
  try {
    const r = build(b);
    ok('it builds', r.code === 0, r.stderr.split('\n')[0]);
    const p = path.join(b.dir, 'book.html');
    const html = fs.readFileSync(p, 'utf8');
    ok('the pack ids ride on data-motion on <html>', /<html[^>]*data-motion="fade draw isometric"/.test(html));
    ok('motion.css is linked', /motion\/motion\.css/.test(html));
    ok('motion.js is linked', /motion\/motion\.js/.test(html));
    ok('the runtime loads after sheet-tools.js',
      html.indexOf('sheet-tools.js') < html.indexOf('motion/motion.js'));
    ok('hasMotion() agrees it has motion', hasMotion(p) === true);

    const c = check(b);
    ok('the moving book still measures', !!c.json, c.stderr.split('\n')[0]);
    ok('it is still 0 mm', c.json?.ready === true && (c.json?.overflowing?.length || 0) === 0,
      (c.json?.overflowing || []).map((o) => `+${o.overMm}mm`).join(',') || c.stderr.split('\n')[0]);
    ok('it is still B5', c.json?.trim?.size === 'b5');
  } finally { b.drop(); }
}

group('the runtime freezes on demand, for check.mjs and the video pipeline');
{
  const b = scratchBook('mothooks', { motion: ['stick', 'scroll'] });
  try {
    build(b);
    const p = path.join(b.dir, 'book.html');
    const browser = await launch();
    try {
      /* Playwright can't be asked "was freeze called", so open unfrozen and
         drive the hooks the way make-video.mjs will. */
      const page = await open(browser, p, {});
      const hooks = await page.evaluate(() => ({
        freeze: typeof window.__proofpressFreeze,
        play: typeof window.__proofpressPlay,
        seek: typeof window.__proofpressSeek,
        packs: (window.__proofpressMotion || {}).packs || [],
      }));
      ok('freeze is exposed', hooks.freeze === 'function');
      ok('play is exposed', hooks.play === 'function');
      ok('seek is exposed for frame capture', hooks.seek === 'function');
      ok('the runtime knows its own packs',
        hooks.packs.join(',') === 'stick,scroll', hooks.packs.join(','));

      /* Freezing must leave the page measurable, and every animated element at
         its rest frame (no leftover transform). */
      await page.evaluate(() => window.__proofpressFreeze());
      const after = await page.evaluate(() => {
        const els = [...document.querySelectorAll('.m-anim, .m-iso, .m-draw')];
        const moved = els.filter((el) => {
          const t = getComputedStyle(el).transform;
          return t && t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)';
        });
        return { n: els.length, moved: moved.length, frozenAttr: document.documentElement.getAttribute('data-motion-frozen') };
      });
      ok('freezing marks the document', after.frozenAttr === '1');
      ok('after freezing nothing is left transformed', after.moved === 0,
        `${after.moved} of ${after.n} still moved`);
    } finally { await browser.close(); }
  } finally { b.drop(); }
}

report('motion');
