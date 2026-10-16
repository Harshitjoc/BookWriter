/* ==========================================================================
   gen-diagram.mjs  -  turn a diagram spec into the SVG to paste into a page
   --------------------------------------------------------------------------
   Companion to diagram.mjs. Reads a JSON spec and prints the compiled SVG, so a
   diagram is data you can review, diff and re-generate, not markup you retype.

   Usage:
     node engine/tools/gen-diagram.mjs <spec.json>          # SVG to stdout
     node engine/tools/gen-diagram.mjs <spec.json> --out x.svg
     node engine/tools/gen-diagram.mjs --list               # the shape catalog
     node engine/tools/gen-diagram.mjs --example row        # a starter spec

   Exit code 1 on a bad spec, an unknown shape, or a coordinate that would draw
   off the canvas.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { compileDiagram, KINDS, SHAPES, exampleSpec } from './diagram.mjs';
import { checkDiagram } from './draft-block.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };

if (flag('--list')) {
  for (const s of SHAPES) console.log(`${s.kind.padEnd(13)} ${s.use}`);
  process.exit(0);
}

const example = valueOf('--example');
if (example) {
  if (!KINDS.includes(example)) {
    console.error(`unknown shape "${example}". Known: ${KINDS.join(', ')}`);
    process.exit(1);
  }
  console.log(JSON.stringify(exampleSpec(example), null, 2));
  process.exit(0);
}

const input = argv.find((a) => !a.startsWith('--') && a !== valueOf('--out'));
if (!input) {
  console.error('Usage: node engine/tools/gen-diagram.mjs <spec.json> [--out diagram.svg] [--list|--example <kind>]');
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
  svg = compileDiagram(spec);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

/* Run the same structural lint the page contract runs, so a diagram that would
   fail to reach a book fails here instead. */
const check = checkDiagram(svg);
if (check.errors.length) {
  console.error('the compiled diagram is not valid:');
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
