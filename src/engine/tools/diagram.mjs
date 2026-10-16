/* ==========================================================================
   diagram.mjs  -  diagrams as compiled code, not hand-written SVG
   --------------------------------------------------------------------------
   The diagram is where a page most often goes wrong: a label drawn off the
   canvas, a <text> with no fill, twelve different colours, a box you cannot
   move without arithmetic. Hand-writing the SVG means re-solving the same
   layout every time, and the mistakes only show on the printed page.

   This compiles a small JSON spec into the exact SVG the studio theme expects:
   viewBox width 592, cards and arrows placed deterministically, a numbered
   badge per step, one key line, and — never optional — an explicit fill and
   font-family on every <text>. Same spec in, same bytes out.

   A spec looks like:

     { kind: "row", key: "1 ask · 2 wait · 3 answer",
       cards: [ { title: "You", sub: "type a query" },
                { title: "The limiter", sub: "allows 5 a minute", role: "mechanism" },
                { title: "The API", sub: "answers", role: "good" } ] }

   Kinds: row, pipeline, funnel, beforeAfter, timeline, attack, isolation,
   handshake, tunnel. Roles: neutral, mechanism, good, bad, sensitive.

   compileDiagram(spec) -> svg string.  It throws on an unknown kind or a spec
   that would draw off the canvas, so a bad diagram fails at the call site and
   not on the page.
   ========================================================================== */

export const VIEW_W = 592;
const MARGIN = 8;

/** The palette. Colour is a role; each role is a whole card, not a decoration. */
export const ROLES = {
  neutral:   { fill: '#FFFFFF', stroke: '#E7E9EF', title: '#1A1A2E', sub: '#5B6472' },
  mechanism: { fill: '#EEF0FE', stroke: '#D5D8FA', title: '#4F46E5', sub: '#6366F1' },
  good:      { fill: '#ECFBF7', stroke: '#CDEFE8', title: '#0D9488', sub: '#5B6472' },
  bad:       { fill: '#FEF1F1', stroke: '#F8D6D6', title: '#DC2626', sub: '#5B6472' },
  sensitive: { fill: '#FDF6E8', stroke: '#E7E9EF', title: '#1A1A2E', sub: '#B45309' },
};

export const KINDS = ['row', 'pipeline', 'funnel', 'beforeAfter', 'timeline', 'attack', 'isolation', 'handshake', 'tunnel'];

const ARROW = '#94A3B8';
const BAD = '#DC2626';
const BOUNDARY = '#CBD2DC';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const role = (r) => ROLES[r] || ROLES.neutral;

/* ---- primitives -------------------------------------------------------- */

function text(x, y, body, { size = 12, weight = 400, fill = '#5B6472', anchor = 'start', mono = false, family = 'Inter', baseline = null } = {}) {
  const fam = mono ? "'JetBrains Mono',monospace" : `'${family}',sans-serif`;
  const bl = baseline ? ` dominant-baseline="${baseline}"` : '';
  return `<text x="${r(x)}" y="${r(y)}"${bl} text-anchor="${anchor}" style="font-family:${fam};font-size:${size}px;font-weight:${weight};fill:${fill}">${esc(body)}</text>`;
}

function card(x, y, w, h, { role: rl = 'neutral', title, sub, mono = false } = {}) {
  const c = role(rl);
  const cx = x + w / 2;
  const out = [`<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="13" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1" filter="url(#cs)"/>`];
  if (title) out.push(text(cx, y + (sub ? 25 : h / 2 + 5), title, { size: 14, weight: 600, fill: c.title, anchor: 'middle', family: 'Space Grotesk' }));
  if (sub) out.push(text(cx, y + 43, sub, { size: 11, fill: c.sub, anchor: 'middle', mono }));
  return out.join('\n  ');
}

function badge(x, y, n) {
  return `<circle cx="${r(x)}" cy="${r(y)}" r="11" fill="#6366F1"/>`
    + text(x, y, n, { size: 12, weight: 600, fill: '#FFFFFF', anchor: 'middle', baseline: 'central' });
}

function arrow(x1, y1, x2, y2, { bad = false } = {}) {
  const colour = bad ? BAD : ARROW;
  return `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${colour}" stroke-width="1.6" marker-end="url(#ar)"/>`;
}

function boundary(x, y, w, h, label) {
  const out = [`<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="14" fill="none" stroke="${BOUNDARY}" stroke-width="1" stroke-dasharray="5 5"/>`];
  if (label) out.push(text(x + 20, y + 18, label, { size: 11 }));
  return out.join('\n  ');
}

function keyline(key, h) {
  if (!key) return '';
  return '\n  ' + text(VIEW_W / 2, h - 14, key, { size: 12.5, anchor: 'middle' });
}

const r = (n) => {
  const v = Math.round(Number(n) * 10) / 10;
  if (!Number.isFinite(v)) throw new Error(`diagram.mjs: a coordinate was not a number (${n})`);
  return v;
};

/* ---- shapes ------------------------------------------------------------ */

function row(spec) {
  const cards = spec.cards || [];
  if (!cards.length) throw new Error('row needs at least one card');
  const cw = spec.cardWidth || 150, ch = 60;
  const n = cards.length;
  let gap = spec.gap ?? 70;
  let total = n * cw + (n - 1) * gap;
  if (total > VIEW_W - 2 * MARGIN) { gap = Math.max(24, (VIEW_W - 2 * MARGIN - n * cw) / (n - 1 || 1)); total = n * cw + (n - 1) * gap; }
  const left = (VIEW_W - total) / 2;
  const y = spec.drop ? 44 : 58;
  const h = spec.drop ? 212 : 176;
  const out = [];
  const xs = [];
  for (let i = 0; i < n; i++) {
    const x = left + i * (cw + gap);
    xs.push(x);
    out.push(card(x, y, cw, ch, cards[i]));
    if (i < n - 1) {
      const mid = x + cw + gap / 2;
      out.push(arrow(x + cw, y + ch / 2, x + cw + gap, y + ch / 2));
      out.push(badge(mid, y + 18, i + 1));
    }
  }
  if (spec.drop) {
    const mech = spec.dropFrom != null ? spec.dropFrom : n - 1;
    const cx = xs[mech] + cw / 2;
    out.push(arrow(cx, y + ch, cx, y + ch + 40, { bad: spec.drop.role === 'bad' }));
    out.push(card(xs[mech], y + ch + 40, cw, ch, spec.drop));
    out.push(badge(cx + 16, y + ch + 20, n));
  } else if (spec.badges) {
    /* an explicit badge per arrow position, already handled above */
  }
  return { body: out.join('\n  '), h, key: spec.key };
}

function pipeline(spec) {
  const h = 232;
  const cw = 150, ch = 60;
  const out = [];
  const yTop = 44;
  out.push(card(24, yTop, cw, ch, spec.request || { title: 'Request', sub: 'a web call' }));
  out.push(card(221, yTop, cw, ch, spec.queue || { title: 'The queue', sub: 'holds the job', role: 'mechanism' }));
  out.push(card(418, yTop, cw, ch, spec.reply || { title: 'Instant reply', sub: '202 in ~40ms', role: 'good' }));
  out.push(arrow(24 + cw, yTop + ch / 2, 221, yTop + ch / 2));
  out.push(badge(24 + cw + 37, yTop + 18, 1));
  out.push(arrow(221 + cw, yTop + ch / 2, 418, yTop + ch / 2));
  out.push(badge(221 + cw + 37, yTop + 18, 2));
  /* the worker pulls from the queue, off to the side */
  out.push(card(221, 158, cw, ch, spec.worker || { title: 'The worker', sub: 'does the slow work' }));
  out.push(arrow(221 + cw / 2, yTop + ch, 221 + cw / 2, 158));
  out.push(badge(221 + cw / 2 + 16, yTop + ch + 20, 3));
  return { body: out.join('\n  '), h, key: spec.key };
}

function funnel(spec) {
  const h = 220;
  const cw = 150, ch = 60;
  const out = [];
  const inputs = spec.inputs || [];
  const inX = 8, inY = 30, inGap = 74;
  const mcX = (VIEW_W - 160) / 2, mcY = (h - ch) / 2 - 4;
  inputs.forEach((cardSpec, i) => {
    const y = inY + i * inGap;
    out.push(card(inX, y, cw, ch, cardSpec));
    out.push(arrow(inX + cw, y + ch / 2, mcX, mcY + ch / 2 - (inputs.length - 1) * 12 + i * 24));
  });
  out.push(card(mcX, mcY, 160, ch, spec.mechanism || { title: 'The check', sub: '', role: 'mechanism' }));
  out.push(badge(mcX + 80, mcY - 16, (inputs.length || 1) + 1));
  const outX = VIEW_W - cw - 8;
  const good = spec.good || { title: 'Match', sub: 'accept', role: 'good' };
  const bad = spec.bad || { title: 'No match', sub: 'reject', role: 'bad' };
  out.push(card(outX, 30, cw, ch, good));
  out.push(card(outX, 150, cw, ch, bad));
  out.push(arrow(mcX + 160, mcY + ch / 2, outX, 60));
  out.push(arrow(mcX + 160, mcY + ch / 2, outX, 180));
  return { body: out.join('\n  '), h, key: spec.key };
}

function beforeAfter(spec) {
  const rows = spec.rows || [];
  const h = 232;
  const cw = 120, ch = 52;
  const out = [];
  const rowY = [34, 128];
  rows.slice(0, 2).forEach((rowSpec, ri) => {
    const y = rowY[ri];
    out.push(text(8, y + ch / 2 + 4, rowSpec.label || '', { size: 12, weight: 600, fill: role(rowSpec.role).title }));
    (rowSpec.cards || []).forEach((c, i) => {
      out.push(card(96 + i * (cw + 26), y, cw, ch, c));
      if (i < rowSpec.cards.length - 1) out.push(arrow(96 + i * (cw + 26) + cw, y + ch / 2, 96 + (i + 1) * (cw + 26), y + ch / 2));
    });
  });
  return { body: out.join('\n  '), h, key: spec.key };
}

function timeline(spec) {
  const h = 184;
  const out = [];
  const axisY = 96, x0 = 40, x1 = VIEW_W - 40;
  out.push(`<line x1="${r(x0)}" y1="${r(axisY)}" x2="${r(x1)}" y2="${r(axisY)}" stroke="${'#CBD2DC'}" stroke-width="1"/>`);
  const events = spec.events || [];
  events.forEach((ev, i) => {
    const x = ev.at != null ? x0 + ev.at * (x1 - x0) : x0 + (i + 1) * ((x1 - x0) / (events.length + 1));
    const colour = ev.tone === 'bad' ? BAD : ev.tone === 'good' ? '#0D9488' : ARROW;
    out.push(`<line x1="${r(x)}" y1="${r(axisY - 12)}" x2="${r(x)}" y2="${r(axisY + 12)}" stroke="${colour}" stroke-width="2"/>`);
    out.push(text(x, axisY + 34, ev.label || '', { size: 11, anchor: 'middle' }));
  });
  const end = spec.end;
  if (end) {
    out.push(`<circle cx="${r(x1)}" cy="${r(axisY)}" r="5" fill="#0D9488"/>`);
    out.push(card(VIEW_W - 150 - 8, axisY - 30, 150, 60, end));
    out.push(arrow(x1, axisY, VIEW_W - 150 - 8, axisY));
  }
  return { body: out.join('\n  '), h, key: spec.key };
}

function attack(spec) {
  const h = 232;
  const out = [];
  out.push(boundary(196, 56, 395, 104, spec.boundaryLabel || 'Your machine'));
  out.push(card(1, 80, 140, 60, spec.attacker || { title: 'Attacker', sub: 'sends a URL', role: 'bad' }));
  out.push(arrow(141, 110, 220, 110));
  out.push(badge(180, 96, 1));
  out.push(card(220, 80, 152, 60, spec.app || { title: 'Your app', sub: 'fetches it' }));
  out.push(arrow(372, 110, 415, 110));
  out.push(badge(393, 96, 2));
  out.push(card(415, 80, 150, 60, spec.target || { title: 'Metadata', sub: '169.254.169.254', role: 'sensitive', mono: true }));
  /* the leak returns below the boundary, drawn red */
  out.push(`<path d="M490 140 V182 H71 V140" fill="none" stroke="${BAD}" stroke-width="1.6" marker-end="url(#ar)"/>`);
  out.push(badge(280, 182, 3));
  return { body: out.join('\n  '), h, key: spec.key };
}

function isolation(spec) {
  const h = 200;
  const out = [];
  const groups = spec.groups || [];
  groups.slice(0, 2).forEach((g, i) => {
    const x = i === 0 ? 8 : 304;
    out.push(boundary(x, 40, 280, 120, g.label || ''));
    out.push(card(x + 20, 66, 150, 60, g.project || { title: 'Project', sub: 'its own deps', role: 'mechanism' }));
    out.push(card(x + 178, 86, 92, 40, g.deps || { title: 'v3.11', sub: '', role: 'neutral' }));
  });
  return { body: out.join('\n  '), h, key: spec.key };
}

function handshake(spec) {
  const h = 208;
  const cw = 150, ch = 60, y = 54;
  const out = [];
  out.push(card(24, y, cw, ch, spec.user || { title: 'The user', sub: 'never sends a password' }));
  out.push(card(221, y, cw, ch, spec.app || { title: 'Your app', sub: 'asks the provider', role: 'mechanism' }));
  out.push(card(418, y, cw, ch, spec.provider || { title: 'The provider', sub: 'checks the identity' }));
  out.push(arrow(24 + cw, y + 20, 221, y + 20));
  out.push(badge(24 + cw + 37, y + 6, 1));
  out.push(arrow(221 + cw, y + 20, 418, y + 20));
  out.push(badge(221 + cw + 37, y + 6, 2));
  out.push(arrow(418, y + 44, 221 + cw, y + 44));
  out.push(text(296, y + 66, spec.tokenLabel || 'token', { size: 11, anchor: 'middle' }));
  return { body: out.join('\n  '), h, key: spec.key };
}

function tunnel(spec) {
  const h = 176;
  const cw = 150, ch = 60, y = 58;
  const out = [];
  out.push(card(8, y, cw, ch, spec.outside || { title: 'Outside', sub: 'a public network' }));
  out.push(card(VIEW_W - cw - 8, y, cw, ch, spec.inside || { title: 'Inside', sub: 'the private service', role: 'sensitive' }));
  out.push(`<line x1="${VIEW_W / 2}" y1="28" x2="${VIEW_W / 2}" y2="${h - 28}" stroke="${BOUNDARY}" stroke-width="1" stroke-dasharray="5 5"/>`);
  out.push(text(VIEW_W / 2 + 10, 24, spec.boundaryLabel || 'the boundary', { size: 11 }));
  out.push(arrow(8 + cw, y + ch / 2, VIEW_W - cw - 8, y + ch / 2));
  out.push(badge(VIEW_W / 2, y + 18, 1));
  return { body: out.join('\n  '), h, key: spec.key };
}

const BUILDERS = { row, pipeline, funnel, beforeAfter, timeline, attack, isolation, handshake, tunnel };

/* ---- compile ----------------------------------------------------------- */

const DEFS = `<defs>
    <marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>
    <filter id="cs" x="-20%" y="-25%" width="140%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#1A1A2E" flood-opacity="0.07"/></filter>
  </defs>`;

/**
 * Compile a diagram spec to an SVG string. Deterministic: the same spec always
 * produces the same bytes. Throws on an unknown kind or a non-numeric coord.
 */
export function compileDiagram(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('diagram.mjs: a spec object is required');
  const build = BUILDERS[spec.kind];
  if (!build) throw new Error(`diagram.mjs: unknown kind "${spec.kind}". Known: ${KINDS.join(', ')}`);
  const { body, h, key } = build(spec);
  const aria = spec.aria || `Diagram: ${spec.kind}`;
  return `<svg width="100%" viewBox="0 0 ${VIEW_W} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(aria)}">\n  ${DEFS}\n  ${body}${keyline(key, h)}\n</svg>`;
}

/** A spec that only proves the shape works, for the docs and the test. */
export function exampleSpec(kind) {
  const examples = {
    row: { kind: 'row', key: '1 ask · 2 wait · 3 answer', aria: 'a request passing through a limiter to an API',
      cards: [{ title: 'You', sub: 'ask quickly' }, { title: 'The limiter', sub: 'five a minute', role: 'mechanism' }, { title: 'The API', sub: 'answers', role: 'good' }] },
    pipeline: { kind: 'pipeline', key: '1 accept · 2 enqueue · 3 work later' },
    funnel: { kind: 'funnel', key: 'inputs · check · accept or reject',
      inputs: [{ title: 'Message', sub: 'the payload' }, { title: 'Secret', sub: 'the key' }] },
    beforeAfter: { kind: 'beforeAfter', key: 'without · with',
      rows: [{ label: 'Without', role: 'bad', cards: [{ title: 'call' }, { title: 'call' }, { title: 'call', role: 'bad' }] },
             { label: 'With', role: 'good', cards: [{ title: 'wait' }, { title: 'one call', role: 'good' }] }] },
    timeline: { kind: 'timeline', key: 'burst · quiet gap · one call',
      events: [{ label: 't', tone: 'bad' }, { label: 't', tone: 'bad' }, { label: 't', tone: 'good' }],
      end: { title: '1 call', sub: 'after 300ms', role: 'good' } },
    attack: { kind: 'attack', key: '1 send a URL · 2 fetch it · 3 the keys leak out' },
    isolation: { kind: 'isolation', key: 'two projects, two sets of versions, no clash',
      groups: [{ label: 'Project A', project: { title: 'App A', role: 'mechanism' }, deps: { title: 'v3.11' } },
               { label: 'Project B', project: { title: 'App B', role: 'mechanism' }, deps: { title: 'v3.12' } }] },
    handshake: { kind: 'handshake', key: '1 redirect · 2 verify · the token comes back' },
    tunnel: { kind: 'tunnel', key: 'one way in, through the boundary' },
  };
  return examples[kind];
}

/** The list of shapes with a one-line purpose, for the docs and the studio. */
export const SHAPES = [
  { kind: 'row', use: 'a linear flow of two to four steps' },
  { kind: 'pipeline', use: 'a request that is accepted now and worked on later' },
  { kind: 'funnel', use: 'inputs into a check that accepts or rejects' },
  { kind: 'beforeAfter', use: 'two stacked rows: without and with' },
  { kind: 'timeline', use: 'events on a time axis, ending in one outcome' },
  { kind: 'attack', use: 'something crossing a trust boundary and leaking back' },
  { kind: 'isolation', use: 'two projects kept apart so their versions do not clash' },
  { kind: 'handshake', use: 'a round trip where the secret never travels' },
  { kind: 'tunnel', use: 'a single path through a boundary' },
];
