#!/usr/bin/env node
/**
 * One command for every check:  npm test
 *
 * Runs, in order:
 *   llm.test.mjs     the provider layer, with an injected fake fetch and no network
 *   format.test.mjs  trims and themes from the command line, and the bytes that
 *                    must never move when a book says nothing about either
 *   lang.test.mjs    language, direction and script font packs, and the bytes
 *                    that must never move when a book says nothing about those
 *   draft.test.mjs   the page contract and the drafter, against a fake local model
 *   api.test.mjs     the HTTP surface, run against a real server on a free port
 *   templates.test.mjs  the scaffold catalog: every template copies, builds and
 *                    reads 0 mm through the same path the picker uses
 *   studio.test.mjs  the diagram studio and the board endpoints
 *   ship.test.mjs    the publish gate, exporters and print-craft flags
 *   ui.test.mjs      the cockpit in a real browser, against a real built book
 *   regress.mjs      rebuild every committed book and compare book.html hashes
 *
 * The regression step is last on purpose. It is the one that tells you whether
 * the changes just made altered the books that already exist, which is the
 * question that matters most and the one nothing else answers.
 *
 * Exit code is 0 only if every suite passes.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const SUITES = [
  /* No server, no ports, no network. Run it first: it is instant, and if the
     provider layer is broken nothing after it matters. */
  { name: 'llm', file: path.join(HERE, 'llm.test.mjs') },
  { name: 'format', file: path.join(HERE, 'format.test.mjs') },
  { name: 'lang', file: path.join(HERE, 'lang.test.mjs') },
  { name: 'byok', file: path.join(HERE, 'byok.test.mjs') },
  { name: 'from-source', file: path.join(HERE, 'from-source.test.mjs') },
  { name: 'pages', file: path.join(HERE, 'pages.test.mjs') },
  { name: 'draft', file: path.join(HERE, 'draft.test.mjs') },
  { name: 'motion', file: path.join(HERE, 'motion.test.mjs') },
  { name: 'figures', file: path.join(HERE, 'figures.test.mjs') },
  { name: 'lint', file: path.join(HERE, 'lint.test.mjs') },
  { name: 'visual', file: path.join(HERE, 'visual.test.mjs') },
  { name: 'diagram', file: path.join(HERE, 'diagram.test.mjs') },
  { name: 'replay', file: path.join(HERE, 'replay.test.mjs') },
  { name: 'export-formats', file: path.join(HERE, 'export-formats.test.mjs') },
  { name: 'publish', file: path.join(HERE, 'publish.test.mjs') },
  { name: 'print', file: path.join(HERE, 'print.test.mjs') },
  { name: 'api', file: path.join(HERE, 'api.test.mjs') },
  { name: 'templates', file: path.join(HERE, 'templates.test.mjs') },
  { name: 'studio', file: path.join(HERE, 'studio.test.mjs') },
  { name: 'ship', file: path.join(HERE, 'ship.test.mjs') },
  { name: 'ui', file: path.join(HERE, 'ui.test.mjs') },
  { name: 'regress', file: path.join(ROOT, 'src', 'engine', 'tools', 'regress.mjs') },
];

const run = (file) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { cwd: ROOT, stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
  });

const results = [];
for (const s of SUITES) {
  console.log(`\n${'='.repeat(60)}\n  ${s.name}\n${'='.repeat(60)}`);
  const code = await run(s.file);
  results.push({ name: s.name, code });
}

console.log(`\n${'='.repeat(60)}\n  summary\n${'='.repeat(60)}`);
for (const r of results) {
  console.log(`  ${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.name}`);
}
const failed = results.filter((r) => r.code !== 0);
console.log('');
process.exit(failed.length ? 1 : 0);