/* ==========================================================================
   diagram.test.mjs  -  every shape compiles, and compiles to a legal page
   --------------------------------------------------------------------------
   The whole point of the compiler is that a diagram cannot reach a book broken.
   So each shape is compiled and then put through the SAME checkDiagram() the
   page contract uses, plus the rules the printed page depends on: an explicit
   fill on every <text>, nothing under the ink floor, viewBox width 592.
   ========================================================================== */
import { ok, group, report, cli } from './harness.mjs';
import { compileDiagram, exampleSpec, KINDS, SHAPES, VIEW_W } from '../../tools/diagram.mjs';
import { checkDiagram } from '../../tools/draft-block.mjs';

group('every shape compiles');
for (const kind of KINDS) {
  let svg;
  try { svg = compileDiagram(exampleSpec(kind)); } catch (e) { ok(`${kind} compiles`, false, e.message); continue; }
  ok(`${kind} compiles`, typeof svg === 'string' && svg.startsWith('<svg'), `${svg.length} bytes`);

  const vb = svg.match(/viewBox="([^"]+)"/);
  ok(`${kind} has a 592-wide viewBox`, !!vb && vb[1].startsWith(`0 0 ${VIEW_W} `), vb?.[1]);

  const texts = svg.match(/<text\b[^>]*>/g) || [];
  ok(`${kind} gives every <text> an explicit fill`, texts.length > 0 && texts.every((t) => /fill:/.test(t)),
    `${texts.length} labels`);

  const sizes = [...svg.matchAll(/font-size:([\d.]+)px/g)].map((m) => Number(m[1]));
  ok(`${kind} respects the 11px ink floor`, sizes.every((s) => s >= 11), `min ${Math.min(...sizes)}`);

  const check = checkDiagram(svg);
  ok(`${kind} passes the page's own diagram lint`, check.errors.length === 0, check.errors.join('; '));
}

group('the compiler is deterministic and role-aware');
{
  const a = compileDiagram(exampleSpec('row'));
  const b = compileDiagram(exampleSpec('row'));
  ok('the same spec produces the same bytes', a === b);

  const neutral = compileDiagram({ kind: 'row', cards: [{ title: 'X' }] });
  const bad = compileDiagram({ kind: 'row', cards: [{ title: 'X', role: 'bad' }] });
  ok('a role changes the drawing', neutral !== bad && bad.includes('#FEF1F1'));

  let threw = false;
  try { compileDiagram({ kind: 'nope' }); } catch { threw = true; }
  ok('an unknown kind throws rather than guessing', threw);
}

group('the command line');
{
  const list = cli('gen-diagram.mjs', '--list');
  ok('--list prints the catalog', list.code === 0 && SHAPES.every((s) => list.stdout.includes(s.kind)));

  const ex = cli('gen-diagram.mjs', '--example', 'attack');
  ok('--example prints a spec', ex.code === 0 && JSON.parse(ex.stdout).kind === 'attack');

  const noSpec = cli('gen-diagram.mjs');
  ok('no spec is a usage error', noSpec.code === 1);
}

report('diagram');
