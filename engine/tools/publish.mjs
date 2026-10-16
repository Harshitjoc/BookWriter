/* ==========================================================================
   publish.mjs  -  the one command that refuses to ship a half-finished book
   --------------------------------------------------------------------------
   Publishing is not "make a PDF". It is everything that has to be true before
   anyone else sees the book, in order, stopping at the first thing that is not:

       1. no open facts        (no [FACT NEEDED: ...] left in a page)
       2. it builds
       3. every page is 0 mm   (check.mjs)
       4. the deep pass is clean (check.mjs --lint)
       5. the pixels did not move (visual.mjs, only if snapshots were approved)
       6. then the exports you asked for

   It never edits a book and never has an override: the fact gate is the whole
   point. Resolve the markers, then run it again.

   Usage:
       node engine/tools/publish.mjs books/<slug>
       node engine/tools/publish.mjs books/<slug> --edition free
       node engine/tools/publish.mjs books/<slug> --formats pdf,epub,web
       node engine/tools/publish.mjs books/<slug> --out-dir dist
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanBookDir } from './lib/facts.mjs';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const bookDir = argv.find((a) => !a.startsWith('--'));
if (!bookDir) {
  console.error('Usage: node engine/tools/publish.mjs books/<slug> [--edition <name>] [--formats pdf,epub,web] [--out-dir <dir>]');
  process.exit(1);
}
const flag = (name) => { const i = argv.indexOf('--' + name); return i === -1 ? null : argv[i + 1]; };
const edition = flag('edition');
const formats = (flag('formats') || 'pdf').split(',').map((s) => s.trim()).filter(Boolean);
const outDir = path.resolve(flag('out-dir') || bookDir);

const KNOWN = ['pdf', 'epub', 'web'];
const unknown = formats.filter((f) => !KNOWN.includes(f));
if (unknown.length) {
  console.error(`unknown format(s): ${unknown.join(', ')}. Known: ${KNOWN.join(', ')}`);
  process.exit(1);
}

const dir = path.resolve(bookDir);
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`No such book folder: ${bookDir}`);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const run = (script, args) => {
  const r = spawnSync(process.execPath, [path.join(TOOLS, script), ...args], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};

const fail = (stage, detail) => {
  console.error(`\n  ✗  ${stage}\n`);
  if (detail) console.error(detail.split('\n').map((l) => '     ' + l).join('\n'));
  console.error('\n  publish stopped. Nothing was exported.\n');
  process.exit(1);
};

/* 1 ── the fact gate ------------------------------------------------------- */
{
  const facts = scanBookDir(dir);
  if (facts.count) {
    const lines = facts.facts.map((f) =>
      `page ${String(f.page).padStart(2)}  ${f.title}${f.text ? `  — ${f.text}` : ''}`);
    fail(`the book still has ${facts.count} open fact${facts.count > 1 ? 's' : ''}`,
      lines.join('\n') + '\n\nFix each [FACT NEEDED: ...] marker, then publish again.');
  }
}
console.log('  ✓  no open facts');

/* 2 ── build --------------------------------------------------------------- */
{
  const buildArgs = [bookDir];
  if (edition) buildArgs.push('--edition', edition);
  const r = run('build-book.mjs', buildArgs);
  if (r.code !== 0) fail('the book did not build', r.err || r.out);
  console.log('  ✓  built ' + r.out.split('\n')[0]);
}

const bookHtml = path.join(dir, edition ? `book-${edition}.html` : 'book.html');

/* 3 ── fits (0 mm) --------------------------------------------------------- */
{
  const r = run('check.mjs', [bookHtml]);
  if (r.code !== 0) fail('a page overflows the trim', r.out + (r.err ? '\n' + r.err : ''));
  console.log('  ✓  every page is 0 mm');
}

/* 4 ── the deep pass ------------------------------------------------------- */
{
  const r = run('check.mjs', [bookHtml, '--lint']);
  if (r.code !== 0) fail('the deep pass found errors', r.out + (r.err ? '\n' + r.err : ''));
  console.log('  ✓  the deep pass is clean');
}

/* 5 ── pixels, only if they were ever approved ----------------------------- */
{
  const manifest = path.join(dir, '.snapshots', 'manifest.json');
  if (fs.existsSync(manifest)) {
    const r = run('visual.mjs', [bookHtml]);
    if (r.code !== 0) fail('the rendered pixels moved', r.out + (r.err ? '\n' + r.err : ''));
    console.log('  ✓  the pixels match the approved set');
  } else {
    console.log('  ·  no approved snapshots; skipping the pixel check');
  }
}

/* 6 ── export -------------------------------------------------------------- */
const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, '/');
let wrote = 0;
for (const fmt of formats) {
  if (fmt === 'pdf') {
    const out = path.join(outDir, 'book.pdf');
    const r = run('export.mjs', [bookHtml, out]);
    if (r.code !== 0) fail('PDF export failed', r.err || r.out);
    console.log('  ✓  ' + rel(out));
    wrote++;
  } else if (fmt === 'epub') {
    const out = path.join(outDir, 'book.epub');
    const r = run('export-epub.mjs', [bookHtml, '--out', out]);
    if (r.code !== 0) fail('EPUB export failed', r.err || r.out);
    console.log('  ✓  ' + rel(out));
    wrote++;
  } else if (fmt === 'web') {
    const out = path.join(outDir, 'book-web.html');
    const r = run('export-web.mjs', [bookHtml, '--out', out]);
    if (r.code !== 0) fail('web export failed', r.err || r.out);
    console.log('  ✓  ' + rel(out));
    wrote++;
  }
}

console.log(`\n  published: ${wrote} file${wrote === 1 ? '' : 's'} in ${rel(outDir)}\n`);
