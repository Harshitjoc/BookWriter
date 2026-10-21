/* ==========================================================================
   gen-figure.mjs  -  turn a figure spec into the SVG to paste into a page
   --------------------------------------------------------------------------
   Companion to figures.mjs. Reads a JSON spec and prints the compiled SVG, so an
   isometric scene or a stick figure is data you can review, diff and re-generate,
   not markup you retype.

   Usage:
     node src/engine/tools/gen-figure.mjs <spec.json>          # SVG to stdout
     node src/engine/tools/gen-figure.mjs <spec.json> --out x.svg
     node src/engine/tools/gen-figure.mjs --list               # the figure catalog
     node src/engine/tools/gen-figure.mjs --example isoStack    # a starter spec
     node src/engine/tools/gen-figure.mjs --sheet              # write figures-sheet.html

   Exit code 1 on a bad spec, an unknown kind or pose, or a figure that would draw
   off the canvas.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { compileFigure, FIGURE_KINDS, FIGURE_SHAPES, exampleSpec, POSES_LIST } from './figures.mjs';
import { checkDiagram } from './draft-block.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };

if (flag('--list')) {
  for (const s of FIGURE_SHAPES) console.log(`${s.kind.padEnd(13)} ${s.use}`);
  console.log(`\nstick poses: ${POSES_LIST.join(', ')}`);
  process.exit(0);
}

const example = valueOf('--example');
if (example) {
  if (!FIGURE_KINDS.includes(example)) {
    console.error(`unknown kind "${example}". Known: ${FIGURE_KINDS.join(', ')}`);
    process.exit(1);
  }
  console.log(JSON.stringify(exampleSpec(example), null, 2));
  process.exit(0);
}

/* --sheet writes one page showing every figure, so you can LOOK at the kit the
   way you look at a book page before you trust it. */
if (flag('--sheet')) {
  const cards = FIGURE_KINDS.map((kind) => {
    const svg = compileFigure(exampleSpec(kind));
    const use = FIGURE_SHAPES.find((s) => s.kind === kind)?.use || '';
    return `<figure style="margin:0 0 28px"><div style="max-width:592px;border:1px solid #E7E9EF;border-radius:12px;padding:8px">${svg}</div>
      <figcaption style="font:13px Inter,sans-serif;color:#5B6472;max-width:592px"><b style="color:#1A1A2E">${kind}</b> — ${use}</figcaption></figure>`;
  }).join('');
  const html = `<!doctype html><meta charset="utf-8"><title>Figure sheet</title>
<body style="margin:40px;background:#FAFAFC;font-family:Inter,sans-serif">
<h1 style="font:600 20px Inter,sans-serif;color:#1A1A2E">The figure kit</h1>
${cards}</body>`;
  const out = path.resolve('figures-sheet.html');
  fs.writeFileSync(out, html);
  console.log(`wrote ${out}`);
  process.exit(0);
}

const input = argv.find((a) => !a.startsWith('--') && a !== valueOf('--out'));
if (!input) {
  console.error('Usage: node src/engine/tools/gen-figure.mjs <spec.json> [--out figure.svg] [--list|--example <kind>|--sheet]');
  process.exit(1);
}

let spec;
try {
  spec = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
} catch (e) {
  console.error(`could not read the spec: ${e.message}`);
  process.exit(1);
}

let svg;
try {
  svg = compileFigure(spec);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

/* Run the same structural lint the page contract runs, so a figure that would
   fail to reach a book fails here instead. */
const check = checkDiagram(svg);
if (check.errors.length) {
  console.error('the compiled figure is not valid:');
  for (const e of check.errors) console.error(`  - ${e}`);
  process.exit(1);
}
for (const w of check.warnings) console.error(`warning: ${w}`);

const out = valueOf('--out');
if (out) {
  fs.writeFileSync(path.resolve(out), svg + '\n');
  console.log(`wrote ${out}`);
} else {
  console.log(svg);
}
