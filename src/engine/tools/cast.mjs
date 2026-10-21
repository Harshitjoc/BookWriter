#!/usr/bin/env node
/**
 * cast.mjs — the original cartoon cast, drawn as inline SVG.
 *
 * The engine has no video and no scripts, and a printed B5 page cannot hold a
 * clip. What it CAN hold is a character: a small, original drawing that recurs
 * across a book, carries a caption, and prints. This module is the cast for the
 * field-guide and memoir templates: a few hand-drawn creatures, built from plain
 * shapes, in the same colour roles the diagrams use.
 *
 * These are ORIGINAL characters. They are not, and must not become, copies of any
 * cartoon that already exists. A book that sells or ships a recognizable
 * character it does not own is a legal problem, not a style choice.
 *
 * Usage:
 *   node src/engine/tools/cast.mjs            list the cast
 *   node src/engine/tools/cast.mjs --sheet    write cast-sheet.html (look at it)
 *
 * renderCast('pip') returns a complete <svg> string, ready to paste inside a
 * <div class="diagram">. That is the whole interface; a page never needs the
 * draw functions directly.
 */

/* A character is a name, a one-line role, and a draw() that returns the INSIDE of
   an <svg>. Shapes are kept to circles, ellipses and short paths so the drawing
   stays clean at small sizes and prints without a raster. */
export const CAST = {
  pip: {
    name: 'Pip',
    role: 'the guide',
    blurb: 'A small fox who is always the one pointing at the thing worth looking at.',
    viewBox: '0 0 220 220',
    draw: () => `
      <path d="M62 156 C18 150 18 104 52 100 C74 97 84 122 74 144 Z" fill="#FCD34D" stroke="#B45309" stroke-width="2.5" stroke-linejoin="round"/>
      <ellipse cx="120" cy="152" rx="58" ry="46" fill="#FBBF24" stroke="#B45309" stroke-width="2.5"/>
      <ellipse cx="120" cy="162" rx="33" ry="26" fill="#FEF3C7"/>
      <path d="M126 116 L164 116 L145 150 Z" fill="#6366F1" stroke="#4F46E5" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="150" cy="90" r="40" fill="#FBBF24" stroke="#B45309" stroke-width="2.5"/>
      <path d="M124 64 L118 32 L150 58 Z" fill="#FBBF24" stroke="#B45309" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M176 64 L186 34 L156 56 Z" fill="#FBBF24" stroke="#B45309" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M150 100 q24 4 38 12 q-16 14 -38 8 Z" fill="#FEF3C7" stroke="#B45309" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="140" cy="86" r="4.5" fill="#1F2937"/>
      <circle cx="166" cy="86" r="4.5" fill="#1F2937"/>
      <circle cx="188" cy="112" r="5.5" fill="#1F2937"/>`,
  },

  moss: {
    name: 'Moss',
    role: 'the one who waits',
    blurb: 'A tortoise who is never in a hurry and is usually right not to be.',
    viewBox: '0 0 220 220',
    draw: () => `
      <ellipse cx="110" cy="128" rx="72" ry="52" fill="#0D9488" stroke="#0F766E" stroke-width="2.5"/>
      <ellipse cx="110" cy="128" rx="52" ry="36" fill="#14B8A6" stroke="#0F766E" stroke-width="2" stroke-dasharray="6 6"/>
      <path d="M102 92 l8 -16 l8 16 Z" fill="#14B8A6" stroke="#0F766E" stroke-width="2.5" stroke-linejoin="round"/>
      <ellipse cx="110" cy="176" rx="44" ry="20" fill="#0D9488" stroke="#0F766E" stroke-width="2.5"/>
      <path d="M170 120 q26 -4 34 12 q-10 14 -34 8 Z" fill="#5EEAD4" stroke="#0F766E" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="188" cy="116" r="4" fill="#0F172A"/>
      <circle cx="60" cy="170" r="9" fill="#5EEAD4" stroke="#0F766E" stroke-width="2.5"/>
      <circle cx="160" cy="184" r="9" fill="#5EEAD4" stroke="#0F766E" stroke-width="2.5"/>`,
  },
};

export const CAST_IDS = Object.keys(CAST);

/** A complete <svg> for one character, ready to drop inside <div class="diagram">.
 *  Every <text> is given an explicit fill by the caller; these drawings carry no
 *  text at all, so there is nothing to inherit its way to invisible. */
export function renderCast(id, { label, width = '100%' } = {}) {
  const c = CAST[id];
  if (!c) throw new Error(`unknown cast member "${id}". Known: ${CAST_IDS.join(', ')}`);
  const aria = label || `Cartoon drawing of ${c.name}, ${c.role}.`;
  return `<svg width="${width}" viewBox="${c.viewBox}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${aria}">${c.draw()}</svg>`;
}

/** Several characters in one band, evenly spaced, for a cast page. */
export function renderCastRow(ids, { label } = {}) {
  const cols = ids.length || 1;
  const w = 200, h = 200;
  const inner = ids.map((id, i) => {
    const c = CAST[id];
    if (!c) throw new Error(`unknown cast member "${id}". Known: ${CAST_IDS.join(', ')}`);
    return `<g transform="translate(${i * w},0)">${c.draw()}</g>`;
  }).join('');
  const aria = label || `Cartoon cast: ${ids.map((id) => CAST[id].name).join(', ')}.`;
  return `<svg width="100%" viewBox="0 0 ${cols * w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${aria}">${inner}</svg>`;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  if (process.argv.includes('--sheet')) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const rows = CAST_IDS.map((id) => {
      const c = CAST[id];
      return `<figure style="margin:0"><div style="width:200px">${renderCast(id)}</div>
        <figcaption style="font:14px Inter,sans-serif;color:#5B6472"><b style="color:#1A1A2E">${c.name}</b>, ${c.role}. ${c.blurb}</figcaption></figure>`;
    }).join('');
    const html = `<!doctype html><meta charset="utf-8"><title>Cast sheet</title>
<body style="margin:40px;background:#FAFAFC;font-family:Inter,sans-serif">
<div style="display:flex;gap:36px;flex-wrap:wrap">${rows}</div></body>`;
    const out = path.resolve('cast-sheet.html');
    fs.writeFileSync(out, html);
    console.log(`wrote ${out}`);
  } else {
    for (const id of CAST_IDS) console.log(`${id.padEnd(8)} ${CAST[id].name.padEnd(8)} ${CAST[id].role}`);
  }
}
