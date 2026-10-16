/* ==========================================================================
   visual.mjs  -  golden-image regression: did this page change appearance?
   --------------------------------------------------------------------------
   check.mjs says a page FITS. shot.mjs makes PNGs so you can look. Neither can
   tell you that a stylesheet tweak silently moved the headline on page 7. This
   keeps a hash of every page's rendered pixels in the book's .snapshots folder
   and shouts when one moves.

   Usage:
     node src/engine/tools/visual.mjs <book.html>            compare against snapshots
     node src/engine/tools/visual.mjs <book.html> --update   accept the current pixels
     node src/engine/tools/visual.mjs <book.html> --json      machine output

   Snapshots live in books/<slug>/.snapshots/ (a dotdir, so /preview will never
   serve them). On a change the fresh PNG is also written to .snapshots/diff/ so
   the difference can be looked at, not guessed at.

   Exit code is 1 when any page changed, is new, or is gone — that is the gate.

   What it CANNOT see: whether the new pixels are correct. It only tells you the
   pixels are not the ones you approved. A change you meant still needs --update
   and a human eye.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { launch, open } from './lib/render.mjs';
import { emit, wantsJson } from './lib/json-out.mjs';

const input = process.argv[2];
if (!input || input.startsWith('--')) {
  console.error('Usage: node src/engine/tools/visual.mjs <book.html> [--update] [--json]');
  process.exit(1);
}
const asJson = wantsJson();
const update = process.argv.includes('--update');
const abs = path.resolve(input);
const dir = path.dirname(abs);
const snapDir = path.join(dir, '.snapshots');
const manifestPath = path.join(snapDir, 'manifest.json');
const diffDir = path.join(snapDir, 'diff');

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
const readManifest = () => {
  try { return JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return null; }
};

const browser = await launch();
try {
  const page = await open(browser, abs, { deviceScaleFactor: 2 });
  const box = await page.evaluate(() => {
    const s = document.querySelector('.sheet');
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { width: Math.ceil(r.width) + 40, height: Math.ceil(r.height) + 40 };
  });
  if (!box) {
    console.error(`No .sheet found in ${input}`);
    process.exit(1);
  }
  await page.setViewportSize(box);

  const sheets = await page.$$('.sheet');
  const shots = [];
  for (let i = 0; i < sheets.length; i++) {
    shots.push({ page: i + 1, buf: await sheets[i].screenshot() });
  }

  if (update) {
    fs.rmSync(snapDir, { recursive: true, force: true });
    fs.mkdirSync(snapDir, { recursive: true });
    const pages = {};
    for (const s of shots) {
      fs.writeFileSync(path.join(snapDir, `page${s.page}.png`), s.buf);
      pages[s.page] = hash(s.buf);
    }
    fs.writeFileSync(manifestPath, JSON.stringify({ book: path.basename(dir), pages }, null, 2) + '\n');
    const result = { input, pages: shots.length, updated: true, ready: true };
    emit({
      json: result, asJson,
      text: `snapshotted ${shots.length} pages into ${path.relative(process.cwd(), snapDir)}`,
    });
  } else {
    const manifest = readManifest();
    if (!manifest) {
      const result = { input, pages: shots.length, error: 'no snapshots yet', ready: false };
      emit({
        json: result, asJson,
        text: `no snapshots for ${input}. Run with --update once to approve the current pixels.`,
      });
      process.exitCode = 1;
    } else {
      const now = {};
      const changed = [], added = [];
      for (const s of shots) {
        const h = hash(s.buf);
        now[s.page] = h;
        if (!(s.page in manifest.pages)) added.push(s.page);
        else if (manifest.pages[s.page] !== h) changed.push(s.page);
      }
      const removed = Object.keys(manifest.pages).map(Number).filter((p) => !(p in now));

      const moving = new Set([...changed, ...added]);
      if (moving.size) {
        fs.rmSync(diffDir, { recursive: true, force: true });
        fs.mkdirSync(diffDir, { recursive: true });
        for (const s of shots) if (moving.has(s.page)) fs.writeFileSync(path.join(diffDir, `page${s.page}.png`), s.buf);
      }

      const ready = !(changed.length || added.length || removed.length);
      const result = { input, pages: shots.length, changed, added, removed, ready };
      emit({
        json: result, asJson,
        text: ready
          ? `${shots.length} pages match their snapshots.`
          : [
              'the rendered pages changed:',
              changed.length ? `  changed: ${changed.join(', ')}` : '',
              added.length ? `  new:     ${added.join(', ')}` : '',
              removed.length ? `  gone:    ${removed.join(', ')}` : '',
              `  the fresh pixels are in ${path.relative(process.cwd(), diffDir)} — LOOK at them`,
              '  if the change is correct: re-run with --update to approve it',
            ].filter(Boolean).join('\n'),
      });
      if (!ready) process.exitCode = 1;
    }
  }
} finally {
  await browser.close();
}
