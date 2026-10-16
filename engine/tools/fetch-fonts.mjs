#!/usr/bin/env node
/* ==========================================================================
   fetch-fonts.mjs  -  download the woff2 for one or more script packs
   --------------------------------------------------------------------------
   The engine ships the pack STYLESHEETS (engine/fonts/packs/<id>/pack.css) but
   not the font files, because CJK and Arabic fonts are many megabytes and the
   repo should not carry them until a book actually needs one.

   This fetches the real woff2 from Google Fonts and rewrites pack.css so its
   @font-face rules carry the SAME family names the themes use ("Inter" for body,
   "Space Grotesk" for headings) with each subset's own unicode-range. That is
   the whole trick: the script font rides under the family the theme already
   asks for, so no theme changes and Latin text is untouched.

   Usage:
     node engine/tools/fetch-fonts.mjs cjk-sc
     node engine/tools/fetch-fonts.mjs arabic hebrew
     node engine/tools/fetch-fonts.mjs --list
     node engine/tools/fetch-fonts.mjs --all

   The pack.css a fresh checkout has lists two placeholder faces per weight so a
   build never breaks; running this replaces it with the full, correct set.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULTS = JSON.parse(fs.readFileSync(path.join(ENGINE, 'defaults.json'), 'utf8'));
const PACKS = Object.fromEntries(
  Object.entries(DEFAULTS.fontPacks || {}).filter(([id]) => !id.startsWith('$')));

/* The Google Fonts family behind each pack, and the weights we pull. Kept here,
   not in defaults.json, because it is an implementation detail of THIS tool:
   the engine only ever cares about the pack id and its stylesheet. */
const GOOGLE = {
  'cjk-sc': { family: 'Noto Sans SC', weights: [400, 700] },
  'cjk-tc': { family: 'Noto Sans TC', weights: [400, 700] },
  'cjk-jp': { family: 'Noto Sans JP', weights: [400, 700] },
  'cjk-kr': { family: 'Noto Sans KR', weights: [400, 700] },
  arabic: { family: 'Noto Naskh Arabic', weights: [400, 700] },
  hebrew: { family: 'Noto Sans Hebrew', weights: [400, 700] },
  devanagari: { family: 'Noto Sans Devanagari', weights: [400, 700] },
  thai: { family: 'Noto Sans Thai', weights: [400, 700] },
  cyrillic: { family: 'Noto Sans', weights: [400, 700] },
};

/* Google only serves woff2 to a client that claims to support it. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const argv = process.argv.slice(2);
if (argv.includes('--list') || argv.includes('--help') || (!argv.length && !argv.includes('--all'))) {
  console.log('Script font packs:');
  for (const [id, p] of Object.entries(PACKS)) console.log(`  ${id.padEnd(12)} ${p.label.padEnd(22)} ${p.note}`);
  console.log('\nUsage: node engine/tools/fetch-fonts.mjs <pack> [<pack> ...]   (or --all)');
  process.exit(argv.length ? 0 : 1);
}

const ids = argv.includes('--all') ? Object.keys(PACKS) : argv.filter((a) => !a.startsWith('--'));
for (const id of ids) {
  if (!PACKS[id]) {
    console.error(`unknown font pack "${id}". Known: ${Object.keys(PACKS).join(', ')}`);
    process.exit(1);
  }
  if (!GOOGLE[id]) {
    console.error(`no Google Fonts mapping for "${id}" in fetch-fonts.mjs.`);
    process.exit(1);
  }
}

/** Pull every @font-face block out of a Google Fonts CSS response. */
function parseFaces(css) {
  const faces = [];
  const re = /@font-face\s*\{([\s\S]*?)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const body = m[1];
    const weight = (body.match(/font-weight:\s*(\d+)/) || [])[1] || '400';
    const style = (body.match(/font-style:\s*(\w+)/) || [])[1] || 'normal';
    const url = (body.match(/src:\s*url\(([^)]+\.woff2)\)/) || [])[1];
    const range = (body.match(/unicode-range:\s*([^;]+);/) || [])[1];
    if (url) faces.push({ weight, style, url: url.replace(/['"]/g, '').trim(), range: range ? range.trim() : null });
  }
  return faces;
}

async function fetchPack(id) {
  const { family, weights } = GOOGLE[id];
  const fam = family.replace(/ /g, '+');
  const cssUrl = `https://fonts.googleapis.com/css2?family=${fam}:wght@${weights.join(';')}&display=swap`;
  process.stdout.write(`  ${id}: asking Google Fonts for ${family}... `);
  const res = await fetch(cssUrl, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`CSS request returned ${res.status}`);
  const css = await res.text();
  const faces = parseFaces(css);
  if (!faces.length) throw new Error('no woff2 faces in the response (Google changed its format?)');

  const dir = path.join(ENGINE, 'fonts', 'packs', id);
  fs.mkdirSync(dir, { recursive: true });

  const out = [];
  let n = 0;
  for (const f of faces) {
    n += 1;
    const name = `${id}-${f.weight}-${String(n).padStart(2, '0')}.woff2`;
    const buf = Buffer.from(await (await fetch(f.url, { headers: { 'User-Agent': UA } })).arrayBuffer());
    fs.writeFileSync(path.join(dir, name), buf);
    /* One fetched face becomes faces for BOTH theme families, so the script is
       used wherever the theme asks for Inter or Space Grotesk. */
    for (const themeFamily of ['Inter', 'Space Grotesk']) {
      out.push(
        `@font-face{\n  font-family:'${themeFamily}';\n  font-style:${f.style};\n  font-weight:${f.weight};\n` +
        `  font-display:swap;\n  src:url('${name}') format('woff2');` +
        (f.range ? `\n  unicode-range:${f.range};` : '') + '\n}');
    }
  }

  const header = `/* ${PACKS[id].label} — ${PACKS[id].note}.\n\n   Fetched by engine/tools/fetch-fonts.mjs. ${faces.length} subset face(s), each\n   duplicated under the two family names the themes use, with its own\n   unicode-range, so a theme needs no change and Latin text is untouched. */\n\n`;
  fs.writeFileSync(path.join(dir, 'pack.css'), header + out.join('\n\n') + '\n');
  console.log(`ok (${faces.length} file(s))`);
}

console.log(`fetching ${ids.length} pack(s)\n`);
let failed = 0;
for (const id of ids) {
  try { await fetchPack(id); }
  catch (e) { failed += 1; console.error(`FAILED: ${e.message}`); }
}
console.log('');
if (failed) {
  console.error(`${failed} pack(s) could not be fetched. Check your network. Nothing else changed.`);
  process.exit(1);
}
console.log('Done. The engine will now find these fonts when a book names the pack.');
