#!/usr/bin/env node
/**
 * The regression gate.  "Did my change alter the books that already exist?"
 *
 * Every book here is built from committed sources, and the bytes of the
 * generated book.html are hashed and compared to src/engine/tools/baseline.json.
 * If a hash moves, the build changed and that must be a deliberate, reviewed
 * decision, never a surprise.
 *
 * The build must be deterministic for this to mean anything, so this script
 * builds twice and refuses to continue if the two runs disagree with each
 * other. A non-deterministic build makes the baseline worthless.
 *
 *   node src/engine/tools/regress.mjs            compare against the baseline
 *   node src/engine/tools/regress.mjs --update   rewrite the baseline (deliberate)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const BASELINE = path.join(HERE, 'baseline.json');

const slugs = fs
  .readdirSync(path.join(ROOT, 'books'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, 'books', d.name, 'book.json')))
  .map((d) => d.name)
  .sort();

if (!slugs.length) {
  console.error('no books found under books/');
  process.exit(1);
}

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const build = (slug) => {
  /* build-book.mjs takes books/<slug>, not a bare slug. */
  const r = spawnSync(process.execPath, [path.join(HERE, 'build-book.mjs'), `books/${slug}`], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(`build failed for ${slug}\n${r.stderr || ''}`);
    process.exit(1);
  }
};

const hashOf = (slug) => sha(path.join(ROOT, 'books', slug, 'book.html'));

const update = process.argv.includes('--update');

console.log(`regression gate over ${slugs.length} book(s)\n`);

/* 1. determinism. Build twice, compare. */
for (const slug of slugs) {
  build(slug);
}
const first = Object.fromEntries(slugs.map((s) => [s, hashOf(s)]));
for (const slug of slugs) {
  build(slug);
}
const second = Object.fromEntries(slugs.map((s) => [s, hashOf(s)]));

for (const slug of slugs) {
  if (first[slug] !== second[slug]) {
    console.error(`  NONDETERMINISTIC  ${slug}`);
    console.error(`    run 1  ${first[slug]}`);
    console.error(`    run 2  ${second[slug]}`);
    console.error('  The baseline cannot be trusted until this is fixed.');
    process.exit(1);
  }
}
console.log('  determinism  ok (two builds agreed on every book)\n');

/* 2. compare with the recorded baseline. */
if (update) {
  const keep = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
  const next = { ...keep, ...second };
  /* A book that was deleted should stop being protected, not linger. */
  for (const k of Object.keys(next)) if (!second[k]) delete next[k];
  fs.writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
  console.log('  baseline updated:');
  for (const [slug, h] of Object.entries(next)) console.log(`    ${slug.padEnd(18)} ${h}`);
  console.log('\n  Review that diff before committing it. It is the whole point.');
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error(`  no baseline at ${path.relative(ROOT, BASELINE)}`);
  console.error('  run:  node src/engine/tools/regress.mjs --update');
  process.exit(1);
}

const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
let drift = 0;

for (const slug of slugs) {
  const b = base[slug];
  if (!b) {
    console.log(`  NEW       ${slug}  (not in the baseline yet)`);
    drift += 1;
    continue;
  }
  if (b === second[slug]) {
    console.log(`  ok        ${slug}  ${second[slug].slice(0, 12)}`);
  } else {
    console.log(`  CHANGED   ${slug}`);
    console.log(`    was     ${b}`);
    console.log(`    now     ${second[slug]}`);
    drift += 1;
  }
}

console.log('');
if (drift) {
  console.log(`  ${drift} book(s) changed or are new.`);
  console.log('  If the change was intended:');
  console.log('    node src/engine/tools/regress.mjs --update');
  console.log('  Otherwise the build has drifted and existing books changed under you.');
  process.exit(1);
}
console.log('  every committed book still builds to the same bytes.');