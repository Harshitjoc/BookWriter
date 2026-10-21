/* ==========================================================================
   figures.test.mjs  -  every figure compiles, and compiles to a legal page
   --------------------------------------------------------------------------
   Same contract the diagram suite enforces, for the isometric and stick kit:
   a figure cannot reach a book broken or nondeterministic. Each example spec is
   compiled, checked against the page's own checkDiagram(), and compiled twice to
   prove it is byte-stable. A bad spec must fail loudly at the call site.
   ========================================================================== */
import { ok, group, report, cli } from './harness.mjs';
import { compileFigure, exampleSpec, FIGURE_KINDS, FIGURE_SHAPES, VIEW_W, ROLES, POSES_LIST } from '../src/engine/tools/figures.mjs';
import { checkDiagram } from '../src/engine/tools/draft-block.mjs';

group('every figure compiles and is legal on a page');
for (const kind of FIGURE_KINDS) {
  let svg;
  try { svg = compileFigure(exampleSpec(kind)); } catch (e) { ok(`${kind} compiles`, false, e.message); continue; }
  ok(`${kind} compiles`, typeof svg === 'string' && svg.startsWith('<svg'));
  ok(`${kind} uses the 592 column`, svg.includes(`viewBox="0 0 ${VIEW_W} `));
  const check = checkDiagram(svg);
  ok(`${kind} passes the page's own diagram lint`, check.errors.length === 0, check.errors.join('; '));
  ok(`${kind} draws a shape, not only text`, /<(polygon|circle|rect|line|path)\b/.test(svg));
}

group('the compiler is deterministic and refuses bad specs');
{
  const a = compileFigure(exampleSpec('isoStack'));
  const b = compileFigure(exampleSpec('isoStack'));
  ok('same spec compiles to the same bytes', a === b);

  let threw = '';
  try { compileFigure({ kind: 'isoBlob' }); } catch (e) { threw = e.message; }
  ok('an unknown kind is refused, naming the known ones',
    /unknown kind "isoBlob"/.test(threw) && /isoStack/.test(threw), threw);

  threw = '';
  try { compileFigure({ kind: 'stickPose', pose: 'levitate' }); } catch (e) { threw = e.message; }
  ok('an unknown pose is refused, naming the known ones',
    /unknown pose "levitate"/.test(threw) && /idle/.test(threw), threw);

  threw = '';
  try { compileFigure(null); } catch (e) { threw = e.message; }
  ok('a non-spec is refused', /spec object is required/.test(threw), threw);

  /* A spec whose data is empty must throw, not draw an empty band. */
  threw = '';
  try { compileFigure({ kind: 'isoStack', layers: [] }); } catch (e) { threw = e.message; }
  ok('an empty isoStack is refused', /needs at least one layer/.test(threw), threw);
}

group('colour is a role, and every text carries its own fill');
{
  /* Reuse the diagram palette, so a figure and a diagram read as one book. */
  const svg = compileFigure({ kind: 'isoRow', items: [{ label: 'A', role: 'bad' }, { label: 'B', role: 'good' }] });
  ok('the bad role is the red title', svg.includes(ROLES.bad.title));
  ok('the good role is the teal title', svg.includes(ROLES.good.title));

  /* The invisible-text bug this whole kit exists to prevent: svg <text> with no
     fill inherits its way to nothing. Every <text> here must name a fill. */
  const texts = svg.match(/<text\b[^>]*>/g) || [];
  ok('there is text to check', texts.length > 0, `${texts.length}`);
  ok('every <text> has an explicit fill',
    texts.every((t) => /style="[^"]*fill:#[0-9A-Fa-f]{3,6}/.test(t)),
    texts.find((t) => !/fill:#/.test(t)) || '');
  ok('every <text> has an explicit font-family',
    texts.every((t) => /font-family:/.test(t)));
}

group('every stick pose compiles and reaches the canvas');
for (const pose of POSES_LIST) {
  const svg = compileFigure({ kind: 'stickPose', pose });
  const check = checkDiagram(svg);
  ok(`pose "${pose}" compiles clean`, check.errors.length === 0, check.errors.join('; '));
}
{
  /* The motion runtime drives stick limbs by class; a figure that lost them would
     silently stop animating on a motion book. */
  const svg = compileFigure({ kind: 'stickPose', pose: 'walk' });
  ok('limbs carry the motion classes the runtime tags',
    svg.includes('class="m-arm"') && svg.includes('class="m-leg"') && svg.includes('class="m-body"'));
}

group('the CLI lists the kit, prints an example, and refuses a bad spec');
{
  const list = cli('gen-figure.mjs', '--list');
  ok('--list prints the catalog', list.code === 0 && FIGURE_SHAPES.every((s) => list.stdout.includes(s.kind)));
  ok('--list prints the poses', POSES_LIST.every((p) => list.stdout.includes(p)));

  const ex = cli('gen-figure.mjs', '--example', 'isoStack');
  ok('--example prints a spec you can save', ex.code === 0 && /"kind": "isoStack"/.test(ex.stdout));

  const noSpec = cli('gen-figure.mjs');
  ok('no arguments prints usage and exits 1', noSpec.code === 1 && /Usage:/.test(noSpec.stderr));

  const badKind = cli('gen-figure.mjs', '--example', 'nope');
  ok('an unknown --example exits 1', badKind.code === 1 && /unknown kind/.test(badKind.stderr));
}

report('figures');
