/* ==========================================================================
   src/server/index.mjs  -  the whole engine, from a browser
   --------------------------------------------------------------------------
   One process, one port. It serves three things:

     /api/*       read + write a book's SOURCE files, and run the real tools,
                  streaming their stdout/stderr back as server-sent events
     /preview/*   the built book.html served RAW off disk, byte for byte
     everything   else goes to Vite, which serves the React UI with HMR

   Why /preview is raw and not Vite: Vite injects an HMR client into any .html
   it serves. That would rewrite the very file being previewed, so the preview
   would stop being the artifact and start being a lie. Serving it from our own
   handler keeps it identical to what export.mjs will turn into a PDF. Rooting
   /preview at the repo root also keeps the engine's "books live exactly two
   folders deep" rule intact: /preview/books/showcase/book.html resolves
   ../../src/engine/ to /preview/src/engine/, which is on disk exactly as authored.

   The UI never writes book.html. It is generated, and the UI runs the same
   build-book.mjs the command line does. Nothing here re-implements the engine;
   it only drives it and shows you what it said.
   ========================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
/* The drafting path. engine/tools stays dependency-free and the UI stays out of
   the engine's business: the UI calls the same module the CLI does. */
import { listProviders, resolve as resolveProvider } from '../engine/tools/llm.mjs';
import { draftBlock, resolveArchetype } from '../engine/tools/draft-block.mjs';
import { mergeEnv } from '../shared/byok.js';
import { intake } from '../engine/tools/source-intake.mjs';
import { planFromSource } from '../engine/tools/plan-from-source.mjs';
import { makeBook } from '../engine/tools/make-book.mjs';
import { makePaper } from '../engine/tools/make-paper.mjs';
/* Phase 7: the cockpit can compile a diagram and read a book's ledger without
   leaving the browser. Same modules the CLI uses, imported, not re-implemented. */
import { compileDiagram, exampleSpec, SHAPES, ROLES, KINDS, VIEW_W } from '../engine/tools/diagram.mjs';
import { scanBookDir, findFacts } from '../engine/tools/lib/facts.mjs';
import { splitSheets, readBookHtml } from '../engine/tools/lib/book-html.mjs';
import { normalizeLang, resolveDirection } from '../engine/tools/lib/locale.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '../..');          // the repo root
const BOOKS = path.join(ROOT, 'books');
const TOOLS = path.join(ROOT, 'src', 'engine', 'tools');
const UI_ROOT = ROOT;                               // Vite serves the repo root

/* The one place the server reads the engine's advertised sizes/themes/packs, so
   a language book can only ever name a font pack that actually exists. */
const DEFAULTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'engine', 'defaults.json'), 'utf8'));

const HOST = process.env.UI_HOST || '127.0.0.1';
const PORT = Number(process.env.UI_PORT || 5173);

/* ------------------------------------------------------------------ helpers */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
};
const fail = (res, code, msg) => json(res, code, { error: msg });

/* A book slug has to be a plain folder name, and the folder has to resolve
   inside books/. Anything else is a traversal attempt, not a typo. */
function bookDir(slug) {
  if (typeof slug !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(slug)) return null;
  if (slug === '.' || slug === '..' || slug.includes('..')) return null;
  const dir = path.resolve(BOOKS, slug);
  if (dir !== BOOKS && !dir.startsWith(BOOKS + path.sep)) return null;
  return fs.existsSync(dir) ? dir : null;
}

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

/* The four files a book is made of. The interior's name comes from book.json,
   defaulting to <slug>.html, exactly like build-book.mjs resolves it. */
function bookFiles(slug) {
  const dir = bookDir(slug);
  if (!dir) return null;
  const cfg = readJson(path.join(dir, 'book.json'));
  if (!cfg) return null;
  const interior = cfg.interior || `${slug}.html`;
  return {
    slug,
    dir,
    config: cfg,
    files: [
      { name: 'book.json', label: 'book.json', role: 'order', lang: 'json', hint: 'Title, author, parts, and which pages are in the book. Titles must match a page <h1 class="title"> exactly.' },
      { name: interior, label: interior, role: 'interior', lang: 'html', hint: 'Your pages. One <section class="sheet bb"> per concept. The file build-book.mjs reads.' },
      { name: 'VOICE.md', label: 'VOICE.md', role: 'voice', lang: 'markdown', hint: 'How the book sounds. The /block skill treats this as law.' },
      { name: 'blocks.md', label: 'blocks.md', role: 'blocks', lang: 'markdown', hint: 'The backlog. One entry per page you mean to write.' },
    ],
  };
}

/* ------------------------------------------------------------- static /preview */
async function serveRaw(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.replace(/^\/preview\/?/, ''));
  if (!rel) { res.writeHead(404).end('not found'); return; }
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) { res.writeHead(403).end('forbidden'); return; }
  /* Stay inside the repo AND inside a small allowlist of things a built book
     actually asks for. Without this, /preview/.env served the environment file
     byte for byte, because it is a file under the root like any other. A dotfile
     (env, git config) or an unknown extension is refused. */
  const base = path.basename(abs);
  if (base.startsWith('.') || !(path.extname(abs).toLowerCase() in MIME)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const st = await fsp.stat(abs);
    if (st.isDirectory()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',      // a rebuild must show up on reload
    });
    fs.createReadStream(abs).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found: ' + rel);
  }
}

/* ------------------------------------------------------------ running the tools
   Every button in the UI ends up here, spawning the same script the command
   line runs. The engine is never forked or re-implemented. */
const running = new Map();   // runId -> {child?, controller?}

function toolFor(name, book, args) {
  const b = bookFiles(book);
  if (!b) return { error: `no such book: ${book}` };
  const dir = b.dir;
  const bookHtml = path.join(dir, 'book.html');
  switch (name) {
    case 'build': {
      const a = ['build-book.mjs', dir];
      if (args?.edition) a.push('--edition', String(args.edition));
      /* The print-craft flags, vetted here so a number that would break the
         build dies as a 400 with a reason, not as a stack trace. Number() of a
         garbage string is NaN, which fails Number.isFinite. */
      if (args?.gutter) {
        const g = Number(args.gutter);
        if (!Number.isFinite(g) || g < 1 || g > 60) return { error: 'gutter must be a number from 1 to 60 mm' };
        a.push('--gutter', String(g));
      }
      if (args?.bleed) {
        const b = Number(args.bleed);
        if (!Number.isFinite(b) || b < 1 || b > 12) return { error: 'bleed must be a number from 1 to 12 mm' };
        a.push('--bleed', String(b));
      }
      if (args?.startRecto) a.push('--start-recto');
      if (args?.out) {
        /* The one caller-supplied path this tool takes. Keep it inside books/,
           so a crafted --out cannot drop a file anywhere on the machine. */
        const out = path.resolve(ROOT, String(args.out));
        if (!(out === BOOKS || out.startsWith(BOOKS + path.sep))) {
          return { error: 'build --out must stay inside books/' };
        }
        a.push('--out', out);
      }
      return { a, cwd: ROOT, label: `build ${book}${args?.edition ? ' --edition ' + args.edition : ''}` + (args?.gutter ? ` --gutter ${args.gutter}` : '') + (args?.bleed ? ` --bleed ${args.bleed}` : '') + (args?.startRecto ? ' --start-recto' : '') };
    }
    /* The same exporters the command line runs. Each writes its own file into
       the book folder (book.epub, book-web.html, card-<n>.<ext>), so the cockpit
       can link to it under /preview. */
    case 'epub': {
      const target = args?.edition ? path.join(dir, `book-${args.edition}.html`) : bookHtml;
      return { a: ['export-epub.mjs', target], cwd: ROOT, label: `epub ${path.relative(ROOT, target)}` };
    }
    case 'web': {
      const target = args?.edition ? path.join(dir, `book-${args.edition}.html`) : bookHtml;
      return { a: ['export-web.mjs', target], cwd: ROOT, label: `web ${path.relative(ROOT, target)}` };
    }
    case 'card': {
      const target = args?.edition ? path.join(dir, `book-${args.edition}.html`) : bookHtml;
      const pageNo = Number(args?.page ?? 1);
      if (!Number.isInteger(pageNo) || pageNo < 1) return { error: 'a card needs a page number of 1 or more' };
      const format = String(args?.format || 'html');
      if (!['html', 'png', 'md'].includes(format)) return { error: 'card format must be html, png or md' };
      return { a: ['export-card.mjs', target, '--page', String(pageNo), '--format', format], cwd: ROOT, label: `card ${path.relative(ROOT, target)} page ${pageNo} (${format})` };
    }
    /* The one command that ships a book. The gate lives in publish.mjs, not
       here: this only vets the format list before handing over. */
    case 'publish': {
      const formats = Array.isArray(args?.formats)
        ? args.formats.map(String)
        : String(args?.formats || 'pdf').split(',').map((s) => s.trim()).filter(Boolean);
      const KNOWN = ['pdf', 'epub', 'web'];
      const unknown = formats.filter((f) => !KNOWN.includes(f));
      if (unknown.length) return { error: `unknown format(s): ${unknown.join(', ')}. Known: pdf, epub, web` };
      const a = ['publish.mjs', dir];
      if (args?.edition) a.push('--edition', String(args.edition));
      a.push('--formats', formats.join(','));
      return { a, cwd: ROOT, label: `publish ${book} (${formats.join(',')})` };
    }
    case 'check': {
      const target = args?.edition ? path.join(dir, `book-${args.edition}.html`) : bookHtml;
      /* The cockpit always takes the deep pass: a page that fits can still have
         text on text. The CLI keeps --lint opt-in; only the UI turns it on. */
      return { a: ['check.mjs', target, '--json', '--lint'], cwd: ROOT, json: true, label: `check ${path.relative(ROOT, target)}` };
    }
    case 'shot': {
      const target = args?.edition ? path.join(dir, `book-${args.edition}.html`) : bookHtml;
      return { a: ['shot.mjs', target], cwd: ROOT, label: `shot ${path.relative(ROOT, target)}` };
    }
    case 'export': {
      const target = args?.edition ? path.join(dir, `book-${args.edition}.html`) : bookHtml;
      return { a: ['export.mjs', target], cwd: ROOT, label: `export ${path.relative(ROOT, target)}` };
    }
    case 'image': {
      /* gen-image.mjs takes the prompt as a positional and the out file second.
         Both come from the user, so both are checked here: the prompt is an
         argument, never shell-interpolated, and the out file is pinned inside
         the book's own folder. */
      const prompt = String(args?.prompt || '').trim();
      if (!prompt) return { error: 'a prompt is required to generate an image' };
      /* basename first, so "../../../escape.jpg" becomes "escape.jpg" rather than a
         file still called "..-..-..-escape.jpg". Then drop anything that is not a
         plain filename character, and refuse to write a dotfile. */
      const raw = path.basename(String(args?.name || 'image.jpg')).replace(/^\.+/, '');
      const name = raw.replace(/[^A-Za-z0-9._-]/g, '-') || 'image.jpg';
      const a = ['gen-image.mjs', prompt, path.join(dir, name)];
      if (args?.aspect) a.push('--aspect', String(args.aspect));
      if (args?.imageProvider) a.push('--provider', String(args.imageProvider));
      return { a, cwd: ROOT, label: `image ${name}` };
    }
    default: return { error: `unknown tool: ${name}` };
  }
}

/* ----------------------------------------------------------------- drafting */

/** POST /api/draft  — one page, streamed. Same events as /api/run.
 *
 *  This deliberately does NOT write to the book. A draft goes back to the
 *  browser, where a person reads it, fixes it, and pastes it in. An LLM writing
 *  straight into an interior file is how a hallucinated number ends up in a
 *  printed book with nobody having read it. */
function handleDraft(req, res) {
  let body = '';
  req.on('data', (d) => {
    body += d;
    if (body.length > 1e6) req.destroy();
  });
  req.on('end', async () => {
    let args = {};
    try { args = JSON.parse(body || '{}'); } catch { /* treat as none */ }

    const slug = args.book;
    const b = bookFiles(slug);
    if (!b) return fail(res, 404, `no such book: ${slug}`);

    /* Resolve the provider BEFORE opening the stream, so a refusal (a paid
       provider without permission, or a missing key) arrives as a plain HTTP
       error the UI can show in full, not as one SSE line inside a 200.

       The browser may hand us keys for this one request. They lose to
       nothing and win over .env, never the other way round, and they are
       never persisted anywhere: process.env is left untouched. */
    const serverEnv = mergeEnv(process.env, args.keys);

    let resolved;
    try {
      resolved = resolveProvider({
        provider: args.provider,
        model: args.model,
        allowPaid: !!args.allowPaid,
        env: serverEnv,
      });
    } catch (e) {
      return fail(res, 400, e.message);
    }

    /* Same reasoning for the page shape: an unknown archetype is the reader's
       typo, and a wrong-shaped page is worse than no page. Refuse it up front,
       with the list of shapes that exist. */
    let arch;
    try {
      arch = resolveArchetype(args.archetype || undefined);
    } catch (e) {
      return fail(res, 400, e.message);
    }

    const controller = new AbortController();
    const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    running.set(id, { controller, slug, tool: 'draft' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event, data) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('start', {
      id,
      tool: 'draft',
      book: slug,
      label: `draft via ${resolved.label} (${resolved.model})`,
      provider: resolved.id,
      model: resolved.model,
      cost: resolved.cost,
      archetype: arch.id,
      archetypeLabel: arch.label,
    });

    try {
      const out = await draftBlock({
        bookDir: b.dir,
        topic: String(args.topic || ''),
        part: args.part || null,
        archetype: arch.id,
        provider: resolved.id,
        model: resolved.model,
        allowPaid: !!args.allowPaid,
        signal: controller.signal,
        env: serverEnv,
        /* A draft asked for from the cockpit is a deliberate, recorded act: log
           it in the book's .gen ledger (Phase 3) so it is reproducible. That is
           the difference between "a model said so" and "we can show you exactly
           what was asked and what came back". seed stays optional — the person
           pins a page by entering one. */
        ledger: true,
        seed: args.seed != null && args.seed !== '' ? Number(args.seed) : null,
      });

      /* One line per line of the page, so the UI can fill in as it arrives. */
      for (const line of out.section.split('\n')) {
        send('line', { kind: 'out', text: line });
      }
      send('done', { code: 0, meta: out.meta, validation: out.validation, section: out.section });
    } catch (e) {
      const cancelled = e.name === 'AbortError';
      send('done', {
        code: cancelled ? 130 : 1,
        cancelled,
        error: cancelled ? 'cancelled' : String(e.message || e),
      });
    } finally {
      running.delete(id);
      if (!res.writableEnded) res.end();
    }
  });
}

/* POST /api/from-source  — the "create from topic/url/pdf" flow as an SSE stream.
 * Intake the source, plan with the chosen provider, then either draft every
 * planned page into a real book, or write one paper HTML and print its PDF.
 * Writes begin only after the planner has validated, and every file written
 * stays under books/<slug>/. */
function handleFromSource(req, res) {
  let body = '';
  req.on('data', (d) => {
    body += d;
    if (body.length > 60e6) req.destroy();   // a base64-encoded PDF can be several MB
  });
  req.on('end', async () => {
    let args;
    try { args = JSON.parse(body || '{}'); } catch { args = {}; }

    const slug = String(args.slug || '').trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(slug)) {
      return fail(res, 400, 'bad slug. Use lowercase letters, digits, dashes, dots and underscores.');
    }
    if (fs.existsSync(path.join(BOOKS, slug))) return fail(res, 409, `${slug} already exists`);

    const mode = args.mode === 'paper' ? 'paper' : 'book';
    const sourceType = String(args.sourceType || 'topic');
    const topic = String(args.topic || '').trim();
    const keys = args.keys;

    if (args.sourceType && !['topic', 'youtube', 'url', 'pdf', 'docx', 'txt', 'md', 'html', 'csv'].includes(sourceType)) {
      return fail(res, 400, `sourceType must be topic, youtube, url, pdf, docx, txt, md, html or csv`);
    }
    if (sourceType !== 'topic' && !args.source && !args.fileBase64) {
      return fail(res, 400, 'a source (or an uploaded file) is required');
    }

    /* Language is opt-in and validated here, before any work is spawned, so a
       typo is a plain 400 rather than a half-written book. */
    let lang, direction;
    try {
      lang = normalizeLang(args.lang);
      direction = args.dir == null || String(args.dir).trim() === '' ? null : resolveDirection({ dir: args.dir });
    } catch (e) { return fail(res, 400, e.message); }
    const fonts = args.fonts == null ? [] : (Array.isArray(args.fonts) ? args.fonts : [args.fonts]);
    const PACKS = DEFAULTS.fontPacks || {};
    for (const id of fonts) {
      if (!PACKS[id]) {
        return fail(res, 400, `unknown font pack "${id}". Known: ${Object.keys(PACKS).filter((k) => !k.startsWith('$')).join(', ')}`);
      }
    }

    /* Resolve provider BEFORE spawning work so a refusal is a plain 400. */
    const serverEnv = mergeEnv(process.env, keys);
    let resolved;
    try {
      resolved = resolveProvider({ provider: args.provider, model: args.model, allowPaid: !!args.allowPaid, env: serverEnv });
    } catch (e) { return fail(res, 400, e.message); }

    let sourcePath = String(args.source || '');
    if (args.fileBase64) {
      const ext = path.extname(String(args.fileName || 'source.pdf')) || '.bin';
      const tmp = path.join(os.tmpdir(), `proofpress-src-${Date.now()}${ext}`);
      fs.writeFileSync(tmp, Buffer.from(String(args.fileBase64), 'base64'));
      sourcePath = tmp;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event, data) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const controller = new AbortController();
    const id = `from-source-${Date.now()}`;
    running.set(id, { controller, slug, tool: 'from-source' });
    send('start', { id, tool: 'from-source', book: slug, label: `from ${sourceType} via ${resolved.label}` });

    try {
      send('line', { kind: 'sys', text: `reading source (${sourceType})...` });
      const src = await intake({ type: sourceType, value: sourcePath });
      send('line', { kind: 'sys', text: `intake: ${src.note}, ${src.text.length} chars${src.truncated ? ' (truncated)' : ''}` });

      if (mode === 'paper') {
        send('line', { kind: 'sys', text: 'writing the paper...' });
        const paper = await makePaper({
          slug, source: src.text, topic, provider: resolved.id, model: resolved.model,
          allowPaid: !!args.allowPaid, signal: controller.signal, env: serverEnv,
        });
        send('line', { kind: 'sys', text: `paper exit ${paper.code}: ${paper.pdfPath}` });
        send('done', { code: paper.code, result: { mode: 'paper', dir: paper.dir, htmlPath: paper.htmlPath, pdfPath: paper.pdfPath } });
        return;
      }

      send('line', { kind: 'sys', text: 'planning with the provider...' });
      const { plan, validation } = await planFromSource({
        source: src.text, topic, provider: resolved.id, model: resolved.model,
        allowPaid: !!args.allowPaid, signal: controller.signal, env: serverEnv,
        lang, dir: direction,
      });
      send('line', { kind: 'sys', text: `plan: "${plan.title}", ${plan.parts.length} part(s)` });
      send('plan', { plan, validation });

      const res2 = await makeBook({
        slug, plan, theme: args.theme || 'studio', size: args.size || 'b5',
        lang, direction, fonts,
        provider: resolved.id, model: resolved.model, allowPaid: !!args.allowPaid,
        signal: controller.signal, env: serverEnv,
        onPage: (p) => send('line', {
          kind: p.ok ? 'ok' : 'err',
          text: `page ${p.index}/${p.total}: ${p.title}${p.ok ? '' : ` — ${p.reason || p.error || 'failed'}`}`,
        }),
      });
      send('line', { kind: 'sys', text: `build exit ${res2.buildCode}. Skipped/failed pages: ${res2.pages.filter((p) => !p.ok).map((p) => p.title).join(', ') || 'none'}` });
      send('done', {
        code: res2.buildCode,
        result: { mode: 'book', dir: res2.dir, pages: res2.pages.length, failed: res2.pages.filter((p) => !p.ok).length },
      });
    } catch (e) {
      send('line', { kind: 'err', text: String(e.message || e) });
      send('done', { code: 1, error: String(e.message || e) });
    } finally {
      running.delete(id);
      if (!res.writableEnded) res.end();
    }
  });
}

function handleRun(req, res, url) {
  let body = '';
  req.on('data', (d) => {
    body += d;
    if (body.length > 1e6) req.destroy();          // a run request is tiny
  });
  req.on('end', async () => {
    let args = {};
    try { args = JSON.parse(body || '{}'); } catch { /* treat as none */ }
    const slug = args.book || url.searchParams.get('book');
    if (!bookDir(slug)) return fail(res, 404, `no such book: ${slug}`);

    const spec = toolFor(args.tool, slug, args);
    if (spec.error) return fail(res, 400, spec.error);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('start', { label: spec.label, tool: args.tool, book: slug });

    const child = spawn(process.execPath, [path.join(TOOLS, spec.a[0]), ...spec.a.slice(1)], {
      cwd: spec.cwd,
      /* A key typed in the browser reaches gen-image this way and no other:
         process.env itself is not mutated, so two tabs cannot poison each
         other or the rest of the process. */
      env: mergeEnv(process.env, args.keys),
      windowsHide: true,
    });
    const id = String(child.pid);
    running.set(id, { child, slug, tool: args.tool });

    let out = '';
    const pump = (stream, kind) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (d) => {
        buf += d;
        if (kind === 'out') out += d;                 // kept so --json can be parsed
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        /* A --json tool's stdout is machine data. It is parsed into the result
           and rendered as the verdict table, so echoing it into the console
           just buries the useful lines under one long JSON blob. stderr still
           streams: real errors must never be swallowed. */
        if (spec.json && kind === 'out') return;
        for (const line of lines) if (line.trim()) send('line', { kind, text: line });
      });
      stream.on('end', () => {
        if (spec.json && kind === 'out') return;
        if (buf.trim()) send('line', { kind, text: buf });
      });
    };
    pump(child.stdout, 'out');
    pump(child.stderr, 'err');

    child.on('error', (e) => send('line', { kind: 'err', text: String(e) }));

    child.on('close', async (code) => {
      running.delete(id);
      /* check.mjs --json prints one machine-readable object on stdout. We already
         captured it while streaming, so parse that instead of running the check
         a second time. */
      let result = null;
      if (spec.json) {
        const start = out.indexOf('{');
        if (start !== -1) { try { result = JSON.parse(out.slice(start)); } catch { /* fall back to text */ } }
      }
      send('done', { code, result });
      res.end();
    });
  });
}

/* ------------------------------------------------------------------- the API */
async function handleApi(req, res, url) {
  const p = url.pathname;

  if (p === '/api/books') {
    let slugs = [];
    try { slugs = fs.readdirSync(BOOKS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* none */ }
    const books = [];
    for (const slug of slugs.sort()) {
      const b = bookFiles(slug);
      if (!b) continue;
      const cfg = b.config;
      const titles = (cfg.parts || []).flatMap((part) => part.blocks || []);
      books.push({
        slug,
        title: cfg.title || slug,
        author: cfg.author || '',
        parts: (cfg.parts || []).map((part) => ({ name: part.name, count: (part.blocks || []).length })),
        listed: titles.length,
        editions: Object.keys(cfg.editions || {}),
        /* The interior's name comes from bookFiles(), the SAME list the editor
           tabs are built from. It used to be read from `cfg.files`, a key that
           does not exist in book.json, so any book setting "interior" was shown
           a filename that 404'd on read and on write. Looked up by role rather
           than index so reordering the list cannot break it either. */
        interior: b.files.find((f) => f.role === 'interior')?.name || `${slug}.html`,
        hasBookHtml: fs.existsSync(path.join(b.dir, 'book.html')),
        /* An edition has its own book-<edition>.html. Reporting which ones are
           built lets the cockpit say "not built yet" instead of pointing an
           iframe at a file that 404s. */
        builtEditions: Object.keys(cfg.editions || {}).filter((e) =>
          fs.existsSync(path.join(b.dir, `book-${e}.html`))),
        images: (() => {
          try { return fs.readdirSync(path.join(b.dir, 'images')).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).length; } catch { return 0; }
        })(),
      });
    }
    return json(res, 200, { books });
  }

  /* the four source files, read and written */
  if (p === '/api/file') {
    const slug = url.searchParams.get('book');
    const name = url.searchParams.get('name');
    const b = bookFiles(slug);
    if (!b) return fail(res, 404, `no such book: ${slug}`);
    if (!b.files.some((f) => f.name === name)) return fail(res, 403, `"${name}" is not an editable file of ${slug}`);

    const abs = path.join(b.dir, name);
    if (req.method === 'GET') {
      try { return json(res, 200, { name, text: await fsp.readFile(abs, 'utf8') }); }
      catch (e) { return fail(res, 404, `${name} does not exist yet (${e.code})`); }
    }
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 8e6) req.destroy(); });
      req.on('end', async () => {
        let text = body;
        try { text = JSON.parse(body).text; } catch { /* the body was the text itself */ }
        if (typeof text !== 'string') return fail(res, 400, 'expected { text }');
        /* Refuse to save JSON that will not parse: the builder would die with a
           stack trace, and a bad edit is much easier to fix here. */
        if (name === 'book.json') {
          try { JSON.parse(text); }
          catch (e) { return fail(res, 400, `book.json is not valid JSON: ${e.message}`); }
        }
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, text, 'utf8');
        json(res, 200, { ok: true, name, bytes: Buffer.byteLength(text) });
      });
      return;
    }
    return fail(res, 405, 'GET or PUT only');
  }

  if (p === '/api/run' && req.method === 'POST') return handleRun(req, res, url);

  /* Which providers exist, which are ready, and what each one costs. The UI
     shows this so you never have to guess which key is missing, and never sees
     a paid option without also seeing that it is paid. */
  if (p === '/api/providers') {
    return json(res, 200, { providers: listProviders() });
  }

  /* The script font packs the engine advertises, so the "from source" panel can
     offer exactly these and nothing else. */
  if (p === '/api/font-packs') {
    const packs = Object.entries(DEFAULTS.fontPacks || {})
      .filter(([id]) => !id.startsWith('$'))
      .map(([id, p2]) => ({ id, label: p2.label, scripts: p2.scripts, note: p2.note }));
    return json(res, 200, { packs });
  }

  /* Ask a model for one page. Same SSE shape as /api/run so the UI can show it
     arriving, and it streams one text line at a time as the model writes. */
  if (p === '/api/draft' && req.method === 'POST') return handleDraft(req, res);
  if (p === '/api/from-source' && req.method === 'POST') return handleFromSource(req, res);

  if (p === '/api/cancel') {
    const id = url.searchParams.get('id');
    /* A draft is cancelled by aborting its fetch, not by killing a process,
       because there is no process: the request is made in this one. */
    const r = running.get(id);
    if (!r) return json(res, 200, { ok: false });
    r.controller?.abort();
    if (r.child) r.child.kill();
    running.delete(id);
    return json(res, 200, { ok: true });
  }

  /* the PNGs shot.mjs has written, for the gallery */
  if (p === '/api/shots') {
    const slug = url.searchParams.get('book');
    const b = bookFiles(slug);
    if (!b) return fail(res, 404, `no such book: ${slug}`);
    const files = [];
    try {
      for (const f of fs.readdirSync(b.dir)) {
        const m = /^page(\d+)\.png$/.exec(f);
        if (!m) continue;
        const st = fs.statSync(path.join(b.dir, f));
        files.push({ page: Number(m[1]), file: f, bytes: st.size, mtime: st.mtimeMs });
      }
    } catch { /* none yet */ }
    files.sort((a, b2) => a.page - b2.page);
    return json(res, 200, { shots: files });
  }

  /* scaffold a new book from books/starter */
  if (p === '/api/new-book' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      let o = {};
      try { o = JSON.parse(body || '{}'); } catch { /* defaults */ }
      const slug = String(o.slug || '').trim();
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) return fail(res, 400, 'slug must be lowercase letters, digits and dashes');
      const dir = path.join(BOOKS, slug);
      if (fs.existsSync(dir)) return fail(res, 409, `${slug} already exists`);
      const src = path.join(BOOKS, 'starter');
      if (!fs.existsSync(src)) return fail(res, 500, 'books/starter is missing');
      await fsp.cp(src, dir, { recursive: true });
      /* starter ships starter.html; the book is called <slug>.html. Either rename
         it or name it in book.json. Renaming keeps the default lookup working. */
      const old = path.join(dir, 'starter.html');
      if (fs.existsSync(old)) await fsp.rename(old, path.join(dir, `${slug}.html`));
      await fsp.rm(path.join(dir, 'book.html'), { force: true });   // generated; stale copy
      json(res, 200, { ok: true, slug });
    });
    return;
  }

  /* Delete a whole book, generated output and all. This is the one endpoint that
     removes rather than writes, so it is deliberately fussy: it must be a real
     book, the caller must type the slug back, no run may be in flight, and the
     starter template every scaffold copies from is never deletable from here. */
  if (p === '/api/delete-book' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 1e5) req.destroy(); });
    req.on('end', async () => {
      let o = {};
      try { o = JSON.parse(body || '{}'); } catch { /* treated as an absent confirm */ }
      const slug = typeof o.slug === 'string' ? o.slug : '';
      const dir = bookDir(slug);
      if (!dir || !bookFiles(slug)) return fail(res, 404, `no such book: ${slug}`);
      if (slug === 'starter') {
        return fail(res, 403, 'books/starter is the template every new book is scaffolded from; it is not deletable here.');
      }
      if (String(o.confirm || '').trim() !== slug) {
        return fail(res, 400, 'type the book slug exactly to confirm the delete');
      }
      if ([...running.values()].some((r) => r.slug === slug)) {
        return fail(res, 409, `a run is still in flight for ${slug}; wait for it to finish before deleting.`);
      }
      /* Counted before removal so the cockpit can say what actually went. */
      let removed = 0;
      const tally = (d) => {
        let items;
        try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of items) {
          if (e.isDirectory()) tally(path.join(d, e.name));
          else removed++;
        }
      };
      tally(dir);
      await fsp.rm(dir, { recursive: true, force: true });
      json(res, 200, { ok: true, slug, removed });
    });
    return;
  }

  /* ---- Phase 7: diagram studio -----------------------------------------
     The cockpit's DiagramStudio edits a spec and sees the compiled SVG live.
     Compilation happens HERE, in the same module the builder uses, so what the
     studio shows is exactly what a page would get. Nothing is written to disk:
     a diagram is inserted through the editor, by a person. */
  if (p === '/api/diagram') {
    if (req.method === 'GET') {
      /* The picker: every shape with its one-line purpose, plus the palette the
         compiler knows, so the UI never hard-codes a kind that does not exist. */
      return json(res, 200, { shapes: SHAPES, roles: Object.keys(ROLES), kinds: KINDS, viewW: VIEW_W });
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 2e6) req.destroy(); });
      req.on('end', () => {
        let spec;
        try { spec = JSON.parse(body || '{}'); } catch (e) { return fail(res, 400, `spec is not valid JSON: ${e.message}`); }
        spec = spec && spec.spec ? spec.spec : spec;   // accept { spec } or a bare spec
        try {
          const svg = compileDiagram(spec);
          return json(res, 200, { ok: true, svg, viewW: VIEW_W });
        } catch (e) {
          return fail(res, 400, String(e.message || e));
        }
      });
      return;
    }
    return fail(res, 405, 'GET or POST only');
  }

  /* GET /api/diagram/example?kind=row — the starter spec for a shape. */
  if (p === '/api/diagram/example') {
    const kind = url.searchParams.get('kind') || 'row';
    const spec = exampleSpec(kind);
    if (!spec) return fail(res, 404, `no example for kind "${kind}". Known: ${KINDS.join(', ')}`);
    let svg;
    try { svg = compileDiagram(spec); } catch (e) { return fail(res, 500, String(e.message || e)); }
    return json(res, 200, { kind, spec, svg });
  }

  /* GET /api/facts?book=slug — the ledger, attributed to pages. */
  if (p === '/api/facts') {
    const slug = url.searchParams.get('book');
    const b = bookFiles(slug);
    if (!b) return fail(res, 404, `no such book: ${slug}`);
    try {
      const scan = scanBookDir(b.dir);
      return json(res, 200, { book: slug, count: scan.count, facts: scan.facts });
    } catch (e) {
      return fail(res, 500, `could not read ${slug}: ${e.message}`);
    }
  }

  /* GET /api/board?book=slug — the cockpit's map of the book: one row per page
     with its part, title, and whether it carries a diagram, a photo, or an open
     fact. Derived from the interior SOURCE (not the built book), so it is live
     while you edit and correct even before a build. */
  if (p === '/api/board') {
    const slug = url.searchParams.get('book');
    const b = bookFiles(slug);
    if (!b) return fail(res, 404, `no such book: ${slug}`);
    const interior = b.files.find((f) => f.role === 'interior')?.name;
    let html;
    try { html = readBookHtml(path.join(b.dir, interior)); }
    catch (e) { return fail(res, 500, `could not read ${slug}/${interior}: ${e.message}`); }

    /* title -> part name, so each page row can show where it sits. */
    const partOf = new Map();
    for (const part of b.config.parts || []) {
      for (const t of part.blocks || []) partOf.set(t, part.name);
    }

    const sheets = splitSheets(html);
    const pages = sheets.map((s, i) => {
      const facts = findFacts(s.html);
      return {
        n: i + 1,
        title: s.title || '',
        kind: s.cls || '',
        part: partOf.get(s.title) || null,
        listed: partOf.has(s.title),
        diagram: /<svg[\s>]/i.test(s.html),
        photo: /<img[\s>]/i.test(s.html),
        facts: facts.length,
        factTexts: facts.map((f) => f.text),
      };
    });

    const parts = (b.config.parts || []).map((part) => ({
      name: part.name,
      blocks: (part.blocks || []).length,
      pages: pages.filter((p) => p.part === part.name).length,
    }));

    return json(res, 200, {
      book: slug,
      title: b.config.title || slug,
      author: b.config.author || '',
      size: b.config.size || 'b5',
      theme: b.config.theme || 'studio',
      editions: Object.keys(b.config.editions || {}),
      parts,
      pages,
      totals: {
        pages: pages.length,
        listed: pages.filter((x) => x.listed).length,
        diagrams: pages.filter((x) => x.diagram).length,
        photos: pages.filter((x) => x.photo).length,
        facts: pages.reduce((a, x) => a + x.facts, 0),
      },
      /* What a previous publish/export already dropped in the book folder, so
         the dashboard can say "ship it again" instead of "run it from scratch". */
      artifacts: {
        pdf: fs.existsSync(path.join(b.dir, 'book.pdf')),
        epub: fs.existsSync(path.join(b.dir, 'book.epub')),
        web: fs.existsSync(path.join(b.dir, 'book-web.html')),
      },
    });
  }

  /* things the UI cannot fix on its own, but should shout about */
  if (p === '/api/health') {
    let playwright;
    try {
      const pw = await import('playwright');
      const b = await pw.chromium.launch();
      await b.close();
      playwright = 'ok';
    } catch (e) {
      playwright = /Executable doesn't exist|playwright install/i.test(String(e))
        ? 'browser missing: run `npx playwright install chromium`'
        : 'unavailable: ' + String(e.message || e).split('\n')[0];
    }
    return json(res, 200, { root: ROOT, playwright, node: process.version });
  }

  return fail(res, 404, 'no such endpoint');
}

/* ---------------------------------------------------------------- the server */
const { createServer: createViteServer } = await import('vite');

/* The React plugin lives in vite.config.js. The runtime bits (middleware mode,
   per-instance HMR port) are merged over it here. */
const vite = await createViteServer({
  configFile: path.join(ROOT, 'vite.config.js'),
  root: UI_ROOT,
  appType: 'spa',
  server: {
    middlewareMode: true,
    /* Vite's default HMR socket is 24678, hard-coded and shared. Run the cockpit
       twice (once on 5173, once on UI_PORT for a test) and the second instance
       shouts "WebSocket server error" even though everything else is fine. Deriving
       the socket from the HTTP port gives each instance its own. */
    hmr: { port: PORT + 1 },
    /* Vite watches its root, and the root is now the repo. books/ lives inside
       it, so every build/shot/export would fire a full-page reload and blow away
       the cockpit's state. It never was watched when the cockpit was its own
       root; keep it that way. The preview reads books/ from disk directly. */
    watch: { ignored: ['**/books/**', '**/.scratch/**', '**/.git/**'] },
  },
  logLevel: 'warn',
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname.startsWith('/preview')) return await serveRaw(req, res, url.pathname);
    return await vite.middlewares(req, res, () => {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    });
  } catch (e) {
    if (!res.headersSent) fail(res, 500, String(e && e.stack ? e.stack : e));
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  const books = (() => { try { return fs.readdirSync(BOOKS, { withFileTypes: true }).filter((e) => e.isDirectory()).length; } catch { return 0; } })();
  console.log('');
  console.log('  Proofpress UI');
  console.log(`  http://${HOST}:${PORT}`);
  console.log('');
  console.log(`  root    ${ROOT}`);
  console.log(`  books   ${books} found`);
  console.log('');
  console.log('  The engine still builds books on its own. This is a cockpit, not a dependency.');
  console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    for (const { child } of running.values()) child.kill();
    await vite.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
}