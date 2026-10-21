/* ==========================================================================
   figures.mjs  -  isometric scenes and stick figures, compiled from a spec
   --------------------------------------------------------------------------
   diagram.mjs draws the *mechanism*: a flow, a threat, a before and after. Some
   pages are not about a mechanism. They are about a *place* (a stack of layers,
   a slab, a grid of blocks) or a *body* (a figure that walks, waves, or points
   at the thing worth noticing). Those are figures, and this is their compiler.

   It is deliberately the same shape as diagram.mjs: a small JSON spec in, a
   deterministic <svg> out, every <text> given an explicit fill, and a loud
   throw on a spec that would draw off its canvas. Same spec in, same bytes out.
   The output also passes the page's own checkDiagram(), so a figure cannot
   reach a book broken.

   Two families:

     isometric  - real 3D-looking solids on an isometric grid. Use when the idea
                  is a THING with volume and layers: a stack of defences, a slab
                  the work sits on, a grid of cells, a pit you fall into.

     stick      - a jointed figure drawn as lines and a head, in a named pose.
                  Use when the idea is a BODY doing something: noticing, walking
                  the happy path, waving the team in, pointing at the clue, taking
                  the hit.

   Usage:
     import { compileFigure, exampleSpec, KINDS, FIGURE_SHAPES } from './figures.mjs';
     compileFigure({ kind: 'isoStack', layers: [{ label: 'WAF' }, { label: 'App' }] });
     compileFigure({ kind: 'stickPose', pose: 'point', caption: 'notice the clue' });
   ========================================================================== */

export const VIEW_W = 592;

/** Reuse the diagram palette verbatim, so a figure and a diagram on facing
 *  pages read as one book. Colour is a role here too, never decoration. */
export const ROLES = {
  neutral:   { fill: '#FFFFFF', stroke: '#E7E9EF', title: '#1A1A2E', sub: '#5B6472' },
  mechanism: { fill: '#EEF0FE', stroke: '#D5D8FA', title: '#4F46E5', sub: '#6366F1' },
  good:      { fill: '#ECFBF7', stroke: '#CDEFE8', title: '#0D9488', sub: '#5B6472' },
  bad:       { fill: '#FEF1F1', stroke: '#F8D6D6', title: '#DC2626', sub: '#5B6472' },
  sensitive: { fill: '#FDF6E8', stroke: '#E7E9EF', title: '#1A1A2E', sub: '#B45309' },
};

/* The three faces of any isometric solid. A single role names the TOP; the
   compiler shades the left and right faces from it, so a block reads as solid
   without the spec naming three colours. */
const SHADE = {
  neutral:   { side: '#F4F5F8', front: '#E9EBF1', edge: '#D7DAE3' },
  mechanism: { side: '#DDE2FD', front: '#CBD2FB', edge: '#B7BFF6' },
  good:      { side: '#D6F5EE', front: '#BDEDE2', edge: '#A6E3D4' },
  bad:       { side: '#FBDCDC', front: '#F6C9C9', edge: '#EFB4B4' },
  sensitive: { side: '#FBEEDA', front: '#F6E2C2', edge: '#EED3A6' },
};

export const FIGURE_KINDS = ['isoStack', 'isoSlab', 'isoGrid', 'isoPit', 'isoRow',
  'stickPose', 'stickPair', 'stickAction'];

const INK = '#1F2937';       // stick-figure ink; a body is ink, not a role colour
const ARROW = '#94A3B8';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const role = (r) => ROLES[r] || ROLES.neutral;
const shade = (r) => SHADE[r] || SHADE.neutral;

const r = (n) => {
  const v = Math.round(Number(n) * 100) / 100;
  if (!Number.isFinite(v)) throw new Error(`figures.mjs: a coordinate was not a number (${n})`);
  return v;
};

function text(x, y, body, { size = 12, weight = 500, fill = '#5B6472', anchor = 'middle', mono = false, family = 'Inter' } = {}) {
  const fam = mono ? "'JetBrains Mono',monospace" : `'${family}',sans-serif`;
  return `<text x="${r(x)}" y="${r(y)}" text-anchor="${anchor}" style="font-family:${fam};font-size:${size}px;font-weight:${weight};fill:${fill}">${esc(body)}</text>`;
}

function keyline(key, h) {
  return key ? '\n  ' + text(VIEW_W / 2, h - 12, key, { size: 12.5, fill: '#5B6472' }) : '';
}

/* ---- isometric geometry -------------------------------------------------
   One projection, used by every solid, so the perspective is consistent to the
   pixel. A point on the grid (u across, v deep) plus a height z becomes a point
   on screen. This is the whole trick: place things on a grid, not by eye. */
const ISO = { ax: 0.866, ay: 0.5 };     // 30-degree axes

function isoPoint(u, v, z, o) {
  return {
    x: o.x + (u - v) * ISO.ax * o.unit,
    y: o.y + (u + v) * ISO.ay * o.unit - z * o.unit,
  };
}

/** A solid box on the grid, drawn as three shaded faces. `u,v,z` is its origin
 *  corner; `du,dv,dz` its size along each grid axis (in cells). */
function isoBox(u, v, z, du, dv, dz, rl, o) {
  const s = shade(rl);
  const p = (a, b, c) => isoPoint(a, b, c, o);
  const top = [p(u + du, v, z + dz), p(u + du, v + dv, z + dz), p(u, v + dv, z + dz), p(u, v, z + dz)];
  const left = [p(u, v + dv, z + dz), p(u, v + dv, z), p(u, v, z), p(u, v, z + dz)];
  const right = [p(u + du, v, z + dz), p(u + du, v, z), p(u + du, v + dv, z), p(u + du, v + dv, z + dz)];
  const poly = (pts, fill) => `<polygon points="${pts.map((q) => `${r(q.x)},${r(q.y)}`).join(' ')}" fill="${fill}" stroke="${s.edge}" stroke-width="1" stroke-linejoin="round"/>`;
  /* left and right first, then the top last so it sits on top with no seam */
  return [poly(left, s.front), poly(right, s.side), poly(top, role(rl).fill)].join('\n  ');
}

/* label a face: the centre of the top face, or a side face for a stack label */
function isoLabelTop(u, v, z, du, dv, body, rl, o, extra = {}) {
  const c = isoPoint(u + du / 2, v + dv / 2, z, o);
  return text(c.x, c.y + 4, body, { size: extra.size || 11.5, weight: extra.weight || 600, fill: role(rl).title, ...extra });
}

/* ---- isometric kinds ---------------------------------------------------- */

/** A stack of layers, bottom first. The good way to show defence in depth: what
 *  sits under what, and how many walls an attacker must cross. */
function isoStack(spec) {
  const layers = spec.layers || [];
  if (!layers.length) throw new Error('isoStack needs at least one layer');
  const o = { x: VIEW_W / 2, y: 150, unit: spec.unit || 30 };
  const nd = spec.depth || 3;          // depth in cells (v)
  const nw = spec.width || 3;          // width in cells (u)
  const th = spec.thickness || 0.9;    // each layer's height in cells
  const out = [];
  layers.forEach((layer, i) => {
    const z = i * th;
    out.push(isoBox(-nw / 2, -nd / 2, z, nw, nd, th, layer.role || 'neutral', o));
  });
  /* labels ride on each layer's top face, from the bottom up so none is hidden */
  const labels = spec.labels !== false;
  if (labels) {
    layers.forEach((layer, i) => {
      const z = (i + 1) * th;
      out.push(isoLabelTop(-nw / 2, -nd / 2, z, nw, nd, layer.label || '', layer.role || 'neutral', o));
    });
  }
  const h = spec.height || 300;
  return { body: out.join('\n  '), h, key: spec.key };
}

/** One slab (a platform) with an optional object standing on it. The slab is the
 *  protected ground; the object is what is being protected. */
function isoSlab(spec) {
  const o = { x: VIEW_W / 2, y: 190, unit: spec.unit || 34 };
  const out = [];
  const w = spec.width || 4, d = spec.depth || 4;
  out.push(isoBox(-w / 2, -d / 2, 0, w, d, 0.8, spec.groundRole || 'neutral', o));
  if (spec.object) {
    out.push(isoBox(-0.7, -0.7, 0.8, 1.4, 1.4, 1.6, spec.object.role || 'sensitive', o));
    if (spec.object.label) {
      const c = isoPoint(0, 0, 2.6, o);
      out.push(text(c.x, c.y, spec.object.label, { size: 12, weight: 600, fill: role(spec.object.role || 'sensitive').title }));
    }
  }
  const h = spec.height || 300;
  return { body: out.join('\n  '), h, key: spec.key };
}

/** A grid of flat cells on the ground, each labelled and coloured. Use for a
 *  matrix, a playing board, a set of slots to fill. */
function isoGrid(spec) {
  const o = { x: VIEW_W / 2, y: 120, unit: spec.unit || 34 };
  const cols = spec.cols || 3, rows = spec.rows || 3;
  const cells = spec.cells || [];
  const out = [];
  for (let v = 0; v < rows; v++) {
    for (let u = 0; u < cols; u++) {
      const cell = cells[v * cols + u] || {};
      out.push(isoBox(u - cols / 2, v - rows / 2, 0, 0.94, 0.94, 0.5, cell.role || 'neutral', o));
      if (cell.label) {
        out.push(isoLabelTop(u - cols / 2, v - rows / 2, 0.5, 0.94, 0.94, cell.label, cell.role || 'neutral', o, { size: 10.5 }));
      }
    }
  }
  const h = spec.height || 320;
  return { body: out.join('\n  '), h, key: spec.key };
}

/** A pit you fall into: a sunken hole with a figure of scale beside it. The
 *  strong shape for "this is a trap", "the missing layer", "the gap". */
function isoPit(spec) {
  const o = { x: VIEW_W / 2, y: 130, unit: spec.unit || 34 };
  const out = [];
  const w = spec.width || 3, d = spec.depth || 3, depth = spec.drop || 2;
  /* the rim, drawn as a wide flat ring, then the dark hole sunk into it */
  out.push(isoBox(-w / 2 - 1, -d / 2 - 1, 0, w + 2, d + 2, 0.5, spec.rimRole || 'neutral', o));
  const s = shade(spec.holeRole || 'bad');
  const p = (a, b, z) => isoPoint(a, b, z, o);
  const wall = [p(-w / 2, -d / 2, 0), p(-w / 2, -d / 2, -depth), p(w / 2, -d / 2, -depth), p(w / 2, -d / 2, 0)];
  const wall2 = [p(-w / 2, -d / 2, -depth), p(-w / 2, d / 2, -depth), p(-w / 2, d / 2, 0), p(-w / 2, -d / 2, 0)];
  const poly = (pts, fill) => `<polygon points="${pts.map((q) => `${r(q.x)},${r(q.y)}`).join(' ')}" fill="${fill}" stroke="${s.edge}" stroke-width="1" stroke-linejoin="round"/>`;
  out.push(poly(wall, s.front));
  out.push(poly(wall2, s.side));
  if (spec.label) {
    const c = isoPoint(0, 0, -depth + 0.3, o);
    out.push(text(c.x, c.y + 4, spec.label, { size: 12, weight: 600, fill: role(spec.holeRole || 'bad').title }));
  }
  const h = spec.height || 300;
  return { body: out.join('\n  '), h, key: spec.key };
}

/** A row of solids along the u axis, evenly spaced. Use for a series with volume
 *  (v1, v2, v3; small, medium, large). */
function isoRow(spec) {
  const items = spec.items || [];
  if (!items.length) throw new Error('isoRow needs at least one item');
  const o = { x: VIEW_W / 2, y: 170, unit: spec.unit || 30 };
  const out = [];
  const step = spec.step || 3.2;
  const left = -(items.length - 1) * step / 2;
  items.forEach((it, i) => {
    const u = left + i * step - 0.9;
    const z = 0, dz = it.height || 1.6;
    out.push(isoBox(u, -0.9, z, 1.8, 1.8, dz, it.role || 'neutral', o));
    if (it.label) {
      const c = isoPoint(u + 0.9, 0, dz + 0.55, o);
      out.push(text(c.x, c.y, it.label, { size: 11.5, weight: 600, fill: role(it.role || 'neutral').title }));
    }
  });
  const h = spec.height || 300;
  return { body: out.join('\n  '), h, key: spec.key };
}

/* ---- stick figures ------------------------------------------------------
   A figure is a skeleton of joints, drawn as round-capped lines, plus a head.
   The joints are authored per pose. Lines carry `.m-arm` / `.m-leg` / `.m-body`
   so the motion runtime can buckle them, and every figure is text-free: a
   caption is added by the page, with its own explicit fill. */

const STICK = { head: 11, joint: 3.5, stroke: 3.2 };

/** A pose is expressed as joint positions in a 100-tall local space, origin at
 *  the hip. Each entry: head centre, spine top, and the four limb segments. */
const POSES = {
  idle:  { head: [0, -78], neck: [0, -66], hip: [0, -30], shoulder: [0, -60], arms: [[0, 0], [0, 0]], legs: [[0, 0], [0, 0]] },
  walk:  { head: [2, -78], neck: [1, -66], hip: [0, -30], shoulder: [0, -60], arms: [[14, 14], [-12, 16]], legs: [[16, 30], [-16, 30]] },
  run:   { head: [5, -80], neck: [3, -68], hip: [0, -30], shoulder: [1, -60], arms: [[20, 4], [-18, 8]], legs: [[22, 24], [-20, 28]] },
  wave:  { head: [0, -78], neck: [0, -66], hip: [0, -30], shoulder: [0, -60], arms: [[22, -30], [-10, 16]], legs: [[8, 30], [-8, 30]] },
  point: { head: [0, -78], neck: [0, -66], hip: [0, -30], shoulder: [0, -60], arms: [[30, -14], [-8, 16]], legs: [[10, 30], [-10, 30]] },
  reach: { head: [0, -78], neck: [0, -66], hip: [0, -30], shoulder: [0, -60], arms: [[24, -34], [24, -30]], legs: [[10, 30], [-10, 30]] },
  fall:  { head: [22, -66], neck: [18, -56], hip: [0, -30], shoulder: [16, -52], arms: [[28, -20], [24, -8]], legs: [[26, 20], [10, 26]] },
  sit:   { head: [0, -70], neck: [0, -58], hip: [0, -30], shoulder: [0, -54], arms: [[14, 12], [-14, 12]], legs: [[26, 6], [-26, 6]] },
};

export const POSES_LIST = Object.keys(POSES);

function figure(pose, x, y, scale, { role: rl = 'neutral', ink = INK } = {}) {
  const p = POSES[pose] || POSES.idle;
  const s = scale;
  const P = (jx, jy) => ({ x: x + jx * s, y: y + jy * s });
  const seg = (a, b, cls) => `<line class="${cls}" x1="${r(a.x)}" y1="${r(a.y)}" x2="${r(b.x)}" y2="${r(b.y)}" stroke="${ink}" stroke-width="${r(STICK.stroke * s / 1.5)}" stroke-linecap="round"/>`;
  const hip = P(...p.hip), neck = P(...p.neck), head = P(...p.head), sh = P(...p.shoulder);
  const out = [];
  /* spine */
  out.push(`<line class="m-body" x1="${r(hip.x)}" y1="${r(hip.y)}" x2="${r(neck.x)}" y2="${r(neck.y)}" stroke="${ink}" stroke-width="${r(STICK.stroke * s / 1.5)}" stroke-linecap="round"/>`);
  /* arms from the shoulder */
  p.arms.forEach((a) => out.push(seg(sh, P(a[0], a[1]), 'm-arm')));
  /* legs from the hip */
  p.legs.forEach((l) => out.push(seg(hip, P(l[0], l[1]), 'm-leg')));
  /* head */
  out.push(`<circle class="m-body" cx="${r(head.x)}" cy="${r(head.y)}" r="${r(STICK.head * s / 1.5)}" fill="${role(rl).fill}" stroke="${ink}" stroke-width="${r(STICK.stroke * s / 1.5)}"/>`);
  return out.join('\n  ');
}

function stickPose(spec) {
  const h = spec.height || 220;
  const out = [figure(spec.pose || 'idle', VIEW_W / 2, 132, spec.scale || 1.5, { role: spec.role || 'neutral' })];
  if (spec.caption) out.push(text(VIEW_W / 2, h - 30, spec.caption, { size: 12.5, fill: '#5B6472' }));
  return { body: out.join('\n  '), h, key: spec.key, bare: true };
}

function stickPair(spec) {
  const h = spec.height || 220;
  const out = [];
  const a = spec.left || { pose: 'wave' };
  const b = spec.right || { pose: 'idle' };
  out.push(figure(a.pose || 'idle', 180, 138, spec.scale || 1.4, { role: a.role || 'neutral' }));
  out.push(figure(b.pose || 'idle', 412, 138, spec.scale || 1.4, { role: b.role || 'neutral' }));
  if (a.label) out.push(text(180, h - 34, a.label, { size: 12, weight: 600, fill: role(a.role || 'neutral').title }));
  if (b.label) out.push(text(412, h - 34, b.label, { size: 12, weight: 600, fill: role(b.role || 'neutral').title }));
  const between = spec.between;
  if (between) {
    out.push(`<line x1="230" y1="100" x2="362" y2="100" stroke="${between.role === 'bad' ? '#DC2626' : ARROW}" stroke-width="1.6" marker-end="url(#ar)"/>`);
    out.push(text(296, 90, between.label || '', { size: 11, fill: between.role === 'bad' ? '#DC2626' : '#5B6472' }));
  }
  return { body: out.join('\n  '), h, key: spec.key, bare: true };
}

function stickAction(spec) {
  const h = spec.height || 220;
  const out = [];
  const fig = spec.figure || { pose: 'point' };
  /* The prop is a plain labelled block the figure is acting on. */
  const px = spec.propRight ? 430 : 150;
  const fx = spec.propRight ? 200 : 430;
  if (spec.prop) {
    const c = role(spec.prop.role || 'sensitive');
    out.push(`<rect x="${px - 60}" y="86" width="120" height="66" rx="12" fill="${c.fill}" stroke="${shade(spec.prop.role || 'sensitive').edge}" stroke-width="1.5"/>`);
    out.push(text(px, 116, spec.prop.title || '', { size: 13, weight: 600, fill: c.title }));
    if (spec.prop.sub) out.push(text(px, 134, spec.prop.sub, { size: 10.5, fill: c.sub, mono: true }));
  }
  out.push(figure(fig.pose || 'point', fx, 140, spec.scale || 1.5, { role: fig.role || 'neutral' }));
  if (spec.caption) out.push(text(fx, h - 30, spec.caption, { size: 12.5, fill: '#5B6472' }));
  return { body: out.join('\n  '), h, key: spec.key, bare: true };
}

const BUILDERS = { isoStack, isoSlab, isoGrid, isoPit, isoRow, stickPose, stickPair, stickAction };

/* ---- compile ----------------------------------------------------------- */

const DEFS = `<defs>
    <marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>
  </defs>`;

/**
 * Compile a figure spec to an SVG string. Deterministic. Throws on an unknown
 * kind or pose so a bad figure fails at the call site, not on the page. The
 * result satisfies checkDiagram(): real viewBox, shapes present, nothing drawn
 * outside the canvas, and a fill on every <text>.
 */
export function compileFigure(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('figures.mjs: a spec object is required');
  const build = BUILDERS[spec.kind];
  if (!build) throw new Error(`figures.mjs: unknown kind "${spec.kind}". Known: ${FIGURE_KINDS.join(', ')}`);
  if (spec.kind.startsWith('stick') ) {
    const poses = [spec.pose, spec.left?.pose, spec.right?.pose, spec.figure?.pose].filter(Boolean);
    for (const pose of poses) {
      if (!POSES[pose]) throw new Error(`figures.mjs: unknown pose "${pose}". Known: ${POSES_LIST.join(', ')}`);
    }
  }
  const { body, h, key } = build(spec);
  const aria = spec.aria || `Figure: ${spec.kind}`;
  return `<svg width="100%" viewBox="0 0 ${VIEW_W} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(aria)}">\n  ${DEFS}\n  ${body}${keyline(key, h)}\n</svg>`;
}

/** A working spec for each kind, for the docs and the test. */
export function exampleSpec(kind) {
  const examples = {
    isoStack: { kind: 'isoStack', key: 'each layer is a wall an attacker must cross', aria: 'a stack of defence layers',
      layers: [{ label: 'WAF', role: 'bad' }, { label: 'App', role: 'mechanism' }, { label: 'Database', role: 'sensitive' }] },
    isoSlab: { kind: 'isoSlab', key: 'the work sits on the platform you keep safe', aria: 'an object on a slab',
      object: { label: 'the data', role: 'sensitive' } },
    isoGrid: { kind: 'isoGrid', key: 'one cell per decision', aria: 'a grid of cells',
      cols: 3, rows: 2, cells: [{ label: 'a', role: 'mechanism' }, { label: 'b' }, { label: 'c', role: 'good' },
        { label: 'd' }, { label: 'e', role: 'bad' }, { label: 'f' }] },
    isoPit: { kind: 'isoPit', key: 'the missing layer is the hole you fall through', aria: 'a pit in the ground',
      label: 'no validation' },
    isoRow: { kind: 'isoRow', key: 'small · medium · large', aria: 'a row of boxes',
      items: [{ label: 'v1' }, { label: 'v2', role: 'mechanism' }, { label: 'v3', role: 'good' }] },
    stickPose: { kind: 'stickPose', pose: 'point', caption: 'notice the clue', key: 'one figure, one gesture', aria: 'a stick figure pointing' },
    stickPair: { kind: 'stickPair', key: 'they wave you in', aria: 'two stick figures',
      left: { pose: 'wave', label: 'guide' }, right: { pose: 'idle', label: 'you' },
      between: { label: 'this way' } },
    stickAction: { kind: 'stickAction', pose: 'point', key: 'point at the thing, not the rule', aria: 'a figure acting on a block',
      figure: { pose: 'point' }, prop: { title: 'the clue', sub: '169.254.169.254', role: 'sensitive' } },
  };
  return examples[kind];
}

/** The catalog, with a one-line purpose, for the docs and the studio. */
export const FIGURE_SHAPES = [
  { kind: 'isoStack', use: 'layers stacked up: defence in depth, what sits under what' },
  { kind: 'isoSlab', use: 'one platform with the protected thing standing on it' },
  { kind: 'isoGrid', use: 'a grid of labelled cells: a matrix, a board, a set of slots' },
  { kind: 'isoPit', use: 'a sunken hole: the missing layer, the trap, the gap' },
  { kind: 'isoRow', use: 'a row of solids of growing size: v1, v2, v3' },
  { kind: 'stickPose', use: 'one figure in a gesture: notice, wait, reach' },
  { kind: 'stickPair', use: 'two figures with a signal between them: guide and reader' },
  { kind: 'stickAction', use: 'a figure acting on a labelled block: point at the clue' },
];
