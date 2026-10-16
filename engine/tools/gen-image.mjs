/* ==========================================================================
   gen-image.mjs  -  a text prompt into a picture, for the pages that need one
   --------------------------------------------------------------------------
   Most pages want a DIAGRAM, and a diagram is code: your agent writes it as
   inline SVG, so it is text, it prints sharp at any size, it costs nothing,
   and the labels are never spelled wrong. Never generate a diagram as a
   picture.

   Some pages want a PHOTOGRAPH, because the thing being taught is physical: a
   dish resting, a plant next to its companion, a posture, a finished print.
   That is what this is for.

   TWO PROVIDERS
     agy     (default) The Antigravity CLI, signed into your Google account.
             No API key and no per-image charge, because it runs on the plan
             you already pay for. ~20s an image. Up to 3 reference images.
     gemini  The Gemini image API. Needs GEMINI_API_KEY and is metered. Use it
             when agy is not installed, or when agy's daily quota is spent.

   USE
     node engine/tools/gen-image.mjs --check
     node engine/tools/gen-image.mjs "<prompt>" out.jpg [--aspect 3:2]
     node engine/tools/gen-image.mjs --prompt-file p.txt out.jpg --ref style.jpg
     node engine/tools/gen-image.mjs "<prompt>" out.png --provider gemini

   PROMPT RULES (they matter more than the model)
     - NO TEXT IN THE IMAGE. Image models garble words. Your words live in the
       HTML, in real type, where they stay sharp and editable.
     - Say the light, the angle, and the background. "soft daylight from the
       left, straight-on, plain warm background" beats a pile of adjectives.
     - Give every image in one book the SAME style sentence, so the book looks
       like a book instead of a mood board.
     - No real people, no logos, no brands.

   SETUP for agy: install the Antigravity CLI, run `agy` once to sign in, then
   run this with --check. Nothing else. See the README.
   ========================================================================== */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '../..');

/* ------------------------------------------------------------- .env (optional) */
function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m || process.env[m[1]]) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  } catch { /* no .env, which is fine: agy needs none */ }
}
loadEnv(path.resolve(process.cwd(), '.env'));
loadEnv(path.join(ROOT, '.env'));

/* ------------------------------------------------------------------ arguments */
const argv = process.argv.slice(2);
const positional = [];
const opts = { provider: process.env.IMAGE_PROVIDER || 'agy', aspect: '3:2', refs: [], model: null, key: null };
let wantCheck = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--check') wantCheck = true;
  else if (a === '--provider') opts.provider = argv[++i];
  else if (a === '--aspect') opts.aspect = argv[++i];
  else if (a === '--model') opts.model = argv[++i];
  else if (a === '--key') opts.key = argv[++i];
  else if (a === '--ref') opts.refs.push(argv[++i]);
  else if (a === '--prompt-file') positional.unshift(fs.readFileSync(argv[++i], 'utf8').trim());
  else if (a.startsWith('--')) { console.error(`Unknown option ${a}`); process.exit(1); }
  else positional.push(a);
}

const AGY_ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'];
const AGY_NEAREST = { '4:5': '3:4', '5:4': '4:3', '21:9': '16:9' };
const AGY_MAX_REFS = 3;
const AGY_DRIVER_MODEL = process.env.AGY_DRIVER_MODEL || 'gemini-3.8-flash-medium';
const AGY_BRAIN = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');

/* Find the agy binary: an explicit override, then PATH, then the default
   Windows install location. */
function findAgy() {
  if (process.env.AGY_BIN && fs.existsSync(process.env.AGY_BIN)) return process.env.AGY_BIN;
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, 'agy' + ext);
      try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch { /* skip */ }
    }
  }
  if (process.env.LOCALAPPDATA) {
    const p = path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/* The subprocess must never see a metered API key, so the CLI can only use the
   account you signed in with and can never silently bill an API instead. */
function cleanEnv() {
  const env = { ...process.env };
  for (const k of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) delete env[k];
  return env;
}

function run(bin, args, { timeout = 600000, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env: cleanEnv(), cwd, windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); resolve({ code: -1, stdout, stderr, timedOut: true }); }, timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e), spawnError: true }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
const walkFresh = (root, since) => {
  const hits = [];
  const visit = (d, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 3) visit(p, depth + 1); continue; }
      if (!IMAGE_EXTS.includes(path.extname(e.name).toLowerCase())) continue;
      try { if (fs.statSync(p).mtimeMs >= since - 5000) hits.push(p); } catch { /* skip */ }
    }
  };
  visit(root, 0);
  return hits;
};

/* ----------------------------------------------------------------- agy --check */
async function checkAgy() {
  const agy = findAgy();
  if (!agy) {
    console.log('agy: NOT FOUND ✗');
    console.log('  Install the Antigravity CLI and sign in with `agy`, or set AGY_BIN in .env.');
    console.log('  No CLI? Use --provider gemini with a GEMINI_API_KEY instead.');
    return false;
  }
  console.log('agy: ' + agy);
  const r = await run(agy, ['models'], { timeout: 90000 });
  const listed = (r.stdout + r.stderr);
  if (r.code !== 0 && !listed.trim()) {
    console.log('  could not run `agy models` ✗ — are you signed in? Run `agy` once.');
    return false;
  }
  const ok = listed.includes(AGY_DRIVER_MODEL);
  console.log(`  driver model ${AGY_DRIVER_MODEL}: ${ok ? 'listed ✓' : 'NOT LISTED ✗'}`);
  if (!ok) {
    console.log('  The CLI retires driver models. Pick one it lists and put it in .env:');
    console.log('    AGY_DRIVER_MODEL=<one of the models above>');
    console.log(listed.split(/\r?\n/).filter(Boolean).slice(0, 14).map((l) => '    ' + l).join('\n'));
  }
  return ok;
}

/* ------------------------------------------------------------------ agy render
   The CLI is an agent, so it is driven with a prompt that names the ONE tool
   call to make and forbids everything else. It then writes the image into its
   own conversation folder, and we copy it out. */
async function generateAgy(prompt, out) {
  const agy = findAgy();
  if (!agy) {
    console.error('agy CLI not found. Install the Antigravity CLI and sign in, set AGY_BIN,');
    console.error('or render this one with --provider gemini (needs GEMINI_API_KEY).');
    process.exit(1);
  }

  let aspect = opts.aspect;
  if (!AGY_ASPECTS.includes(aspect)) {
    const near = AGY_NEAREST[aspect] || '1:1';
    console.log(`note: agy has no ${aspect}; rendering ${near} (nearest it supports)`);
    aspect = near;
  }
  let refs = opts.refs.map((r) => path.resolve(r)).filter((r) => fs.existsSync(r));
  if (refs.length > AGY_MAX_REFS) {
    console.log(`note: agy takes at most ${AGY_MAX_REFS} reference images; dropping the rest`);
    refs = refs.slice(0, AGY_MAX_REFS);
  }

  const imageName = 'pe_' + path.basename(out, path.extname(out)).replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
  const instructions =
    'Call your generate_image tool exactly ONCE with EXACTLY these parameters, then finish:\n' +
    `- ImageName: ${imageName}\n` +
    `- AspectRatio: ${aspect}\n` +
    `- ImagePaths: ${JSON.stringify(refs)}\n` +
    '- Prompt: use VERBATIM the full text between the <<<PROMPT and PROMPT>>> markers below ' +
    '(all of it, unchanged, markers excluded).\n\n' +
    '<<<PROMPT\n' + prompt.trim() + '\nPROMPT>>>\n\n' +
    'Do not use any other tools. Do not view files, list directories, or run commands. ' +
    'Do not rewrite or shorten the prompt. After the generate_image call completes, reply ' +
    'with only the word DONE.';

  const model = opts.model || AGY_DRIVER_MODEL;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    process.stdout.write(`  rendering with agy (attempt ${attempt})... `);
    const r = await run(agy, ['-p', instructions, '--output-format', 'json',
                              '--print-timeout', '9m', '--model', model],
                        { timeout: 600000, cwd: path.dirname(path.resolve(out)) });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    let payload = {};
    try { payload = JSON.parse((r.stdout || '').trim() || '{}'); } catch { /* not json */ }
    const convId = payload.conversation_id || '';

    // Harvest: the conversation folder first, then anything fresh in the brain dir.
    let found = null;
    const convDir = convId ? path.join(AGY_BRAIN, convId) : null;
    if (convDir && fs.existsSync(convDir)) {
      const hits = fs.readdirSync(convDir)
        .filter((f) => f.startsWith(imageName + '_') && IMAGE_EXTS.includes(path.extname(f).toLowerCase()))
        .map((f) => path.join(convDir, f));
      if (hits.length) found = hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    }
    if (!found && fs.existsSync(AGY_BRAIN)) {
      const fresh = walkFresh(AGY_BRAIN, t0);
      if (fresh.length) found = fresh.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    }

    if (found) {
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.copyFileSync(found, out);
      console.log(`ok (${secs}s)`);
      return true;
    }

    console.log('no image');
    // The driver happily says DONE even when the image call failed. The real
    // reason (usually a quota reset time) is only in the step log.
    let stepErr = '';
    if (convId) {
      const steps = path.join(AGY_BRAIN, convId, '.system_generated', 'steps');
      if (fs.existsSync(steps)) {
        for (const d of fs.readdirSync(steps)) {
          const f = path.join(steps, d, 'output.txt');
          if (!fs.existsSync(f)) continue;
          const txt = fs.readFileSync(f, 'utf8');
          if (txt.toLowerCase().includes('error')) {
            const m = txt.match(/"message":\s*"([^"]+)"/);
            stepErr = m ? m[1] : txt.trim().slice(0, 300);
            break;
          }
        }
      }
    }
    const blob = [payload.response, r.stderr, stepErr].filter(Boolean).join('\n');
    if (blob.trim()) console.log('  ' + blob.trim().split(/\r?\n/).slice(-6).join('\n  '));
    if (/QUOTA_EXHAUSTED|429/.test(blob)) {
      console.error('\nagy\'s image quota is spent, so retrying will not help. It resets in a few hours.');
      console.error('Render this one with --provider gemini, or come back later.');
      return false;
    }
    if (r.timedOut) console.log('  (timed out)');
  }
  return false;
}

/* -------------------------------------------------------------- gemini render */
async function generateGemini(prompt, out) {
  const apiKey = opts.key || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error('No API key. Put GEMINI_API_KEY in .env (get one at aistudio.google.com/apikey),');
    console.error('or use the default provider, agy, which needs no key at all.');
    process.exit(1);
  }
  const model = opts.model || 'gemini-2.5-flash-image';
  const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
  const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
  const refParts = opts.refs.map((p) => {
    const abs = path.resolve(p);
    const mime = MIME[path.extname(abs).toLowerCase()];
    if (!mime || !fs.existsSync(abs)) { console.error(`--ref ${p}: missing or not a png/jpg/webp`); process.exit(1); }
    return { inlineData: { mimeType: mime, data: fs.readFileSync(abs).toString('base64') } };
  });

  const post = (url, body) => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  let b64;
  try {
    if (model.startsWith('imagen')) {
      const res = await post(`${BASE}/${model}:predict?key=${apiKey}`,
        { instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: opts.aspect } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}\n${await res.text()}`);
      b64 = (await res.json())?.predictions?.[0]?.bytesBase64Encoded;
    } else {
      const parts = [...refParts, { text: prompt }];
      let res = await post(`${BASE}/${model}:generateContent?key=${apiKey}`, {
        contents: [{ parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: opts.aspect } },
      });
      if (res.status === 400) res = await post(`${BASE}/${model}:generateContent?key=${apiKey}`, { contents: [{ parts }] });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}\n${await res.text()}`);
      const json = await res.json();
      b64 = (json?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data)?.inlineData?.data;
    }
  } catch (e) {
    console.error('Request failed:', e.message);
    return false;
  }
  if (!b64) { console.error('No image came back. Check the key, the quota, or try --model imagen-4.0-generate-001.'); return false; }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  return true;
}

/* ------------------------------------------------------------------- dispatch */
if (wantCheck) {
  const ok = await checkAgy();
  process.exit(ok ? 0 : 1);
}

const [prompt, out] = positional;
if (!prompt || !out) {
  console.error('Usage: node engine/tools/gen-image.mjs "<prompt>" <out.jpg> [--aspect 3:2] [--ref img.jpg]');
  console.error('       node engine/tools/gen-image.mjs --check');
  process.exit(1);
}
if (!['agy', 'gemini'].includes(opts.provider)) {
  console.error(`Unknown provider "${opts.provider}". Use agy (default) or gemini.`);
  process.exit(1);
}

const ok = opts.provider === 'agy' ? await generateAgy(prompt, out) : await generateGemini(prompt, out);
if (!ok) process.exit(1);

const size = fs.statSync(out).size;
console.log(`wrote ${out} (${Math.round(size / 1024)} KB)`);
console.log('Now LOOK at it before you put it in a page. A wrong picture passes every check there is.');
