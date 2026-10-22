#!/usr/bin/env node
/* ==========================================================================
   make-video.mjs  -  turn a storyboard into a finished video
   --------------------------------------------------------------------------
   A storyboard names scenes. This lays each one out on a real frame: the
   title card, a page from the built book, or a figure/diagram the engine
   already knows how to draw. It speaks each narration with the local Windows
   voice, burns the caption in, and hands the frames to ffmpeg.

   It is deliberately a ONE-WAY tool: it reads the storyboard, writes into
   books/<slug>/video/, and never edits a book page. A video cannot leak back
   into paper.

   Usage:
     node src/engine/tools/make-video.mjs books/<slug>
     node src/engine/tools/make-video.mjs books/<slug>/storyboard.json
     node src/engine/tools/make-video.mjs books/<slug> --out talk.mp4

   Options:
     --out <file>      where the mp4 goes (default books/<slug>/video/<slug>.mp4)
     --silent          no voice; pacing comes from the word count instead
     --no-captions     no burned caption and no captions.srt
     --sfx             a soft transition sound under the voice (off by default)
     --voice <name>    a Windows SAPI voice, or "auto" (the default)
     --width <px>      render at a smaller width (tests, quick looks)
     --fps <n>         override the storyboard's frame rate
     --json            print one JSON summary instead of progress lines

   The voice is the measurement, not the estimate: each scene lasts as long as
   its real audio plus the storyboard's hold, never shorter than MIN_SCENE_MS.

   A figure/diagram scene that carries a "spec" is drawn exactly as specified.
   Without a spec the engine draws the shape unlabelled: an honest metaphor,
   with the words left to the narration and caption rather than invented.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { compileFigure, exampleSpec as figureExample } from './figures.mjs';
import { compileDiagram, exampleSpec as diagramExample } from './diagram.mjs';
import { open, hasMotion } from './lib/render.mjs';
import { splitSheets, readBookHtml } from './lib/book-html.mjs';
import {
  ASPECTS, DEFAULT_ASPECT, DEFAULT_HOLD_MS,
  MIN_SCENE_MS, normalizeStoryboard, validateStoryboard, estimateSceneMs,
} from '../../shared/storyboard.js';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(TOOLS, '..');
const ROOT = path.resolve(ENGINE, '..', '..');
const FILM_CSS = path.join(ENGINE, 'film.css');

export const LEAD_MS = 400;
export const FADE_OUT_MS = 500;
const SAMPLE_RATE = 48000;

const DEFAULT_LOOK = {
  paper: '#FAFAFC',
  ink: '#1A1A2E',
  muted: '#5B6472',
  accent: '#6366F1',
  signal: '#0D9488',
  bodyFont: 'Inter, system-ui, sans-serif',
  titleFont: '"Space Grotesk", Inter, system-ui, sans-serif',
  titleWeight: '600',
};

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const sec = (ms) => (Math.max(0, Math.round(ms)) / 1000).toFixed(3);

/** Aspect decides pixels. A width override keeps the aspect exactly. */
export function videoSize(aspect, width = null) {
  const base = ASPECTS[aspect] || ASPECTS[DEFAULT_ASPECT];
  let w = base.width;
  let h = base.height;
  if (width != null && Number.isFinite(Number(width)) && Number(width) > 0) {
    w = Math.max(160, Math.round(Number(width)));
    h = Math.round(w * base.height / base.width);
  }
  return { width: w - (w % 2), height: h - (h % 2) };
}

/** Example drawings are placeholders for a named kind. Their words are not
 *  the video's words, so they are removed; the shapes stay. */
export function withoutLabels(svg) {
  return String(svg)
    .replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, '')
    .replace(/<tspan\b[^>]*>[\s\S]*?<\/tspan>/g, '');
}

export function titleSize(title, size) {
  const n = String(title || '').length;
  const factor = n > 80 ? 0.045 : n > 52 ? 0.052 : n > 28 ? 0.068 : 0.09;
  return Math.round(Math.min(size.width, size.height) * factor);
}

/**
 * How long a scene runs. With a voice, the real audio plus the hold. Without
 * one, the storyboard's own estimate, so a silent cut still breathes.
 */
export function sceneTiming(scene, { narrationMs = null, silent = false, leadMs = LEAD_MS } = {}) {
  const lead = scene.transition === 'cut' ? 0 : Math.max(0, Math.round(leadMs));
  const hold = Number.isFinite(scene.holdMs) ? scene.holdMs : DEFAULT_HOLD_MS;
  const estimated = estimateSceneMs(scene);
  const sceneMs = (silent || narrationMs == null)
    ? Math.max(MIN_SCENE_MS, lead + estimated)
    : Math.max(MIN_SCENE_MS, lead + Math.round(narrationMs) + hold);
  const spoken = (silent || narrationMs == null)
    ? Math.max(0, estimated - hold)
    : Math.round(narrationMs);
  return { leadMs: lead, holdMs: hold, narrationMs: spoken, sceneMs };
}

const pad2 = (n) => String(n).padStart(2, '0');
export function srtTime(ms) {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${String(total % 1000).padStart(3, '0')}`;
}

export function buildSrt(cues) {
  return cues.map((c, i) => {
    const text = String(c.text || '').replace(/\s*\n+\s*/g, ' ').trim();
    return `${i + 1}\n${srtTime(c.startMs)} --> ${srtTime(c.endMs)}\n${text}\n`;
  }).join('\n');
}

/** The visual half of a scene, as HTML for one frame. */
export function visualMarkup(scene, { bookTitle = '', index = 0 } = {}) {
  const v = scene.visual || {};
  if (v.kind === 'title') {
    const kicker = bookTitle && bookTitle !== scene.filmTitle ? bookTitle : '';
    return `<div class="visual title-visual">
      <div class="film-rule"></div>
      <h1 class="film-title" style="font-size:var(--title-size)">${esc(scene.filmTitle || '')}</h1>
      ${kicker ? `<p class="film-book">${esc(kicker)}</p>` : ''}
    </div>`;
  }
  if (v.kind === 'page') {
    const n = Number(v.page);
    return `<div class="visual page-visual"><img src="frames/page-${n}.png" alt=""></div>`;
  }
  if (v.kind === 'figure') {
    try {
      const spec = v.spec && typeof v.spec === 'object' ? v.spec : figureExample(v.figure);
      if (!spec) throw new Error(`unknown figure "${v.figure}"`);
      const svg = compileFigure({ ...spec, kind: spec.kind || v.figure });
      return `<div class="visual art-visual">${v.spec ? svg : withoutLabels(svg)}</div>`;
    } catch (e) {
      throw new Error(`scene ${index + 1} figure could not be drawn: ${e.message}`, { cause: e });
    }
  }
  if (v.kind === 'diagram') {
    try {
      const spec = v.spec && typeof v.spec === 'object' ? v.spec : diagramExample(v.shape);
      if (!spec) throw new Error(`unknown diagram "${v.shape}"`);
      const svg = compileDiagram({ ...spec, kind: spec.kind || v.shape });
      return `<div class="visual art-visual">${v.spec ? svg : withoutLabels(svg)}</div>`;
    } catch (e) {
      throw new Error(`scene ${index + 1} diagram could not be drawn: ${e.message}`, { cause: e });
    }
  }
  throw new Error(`scene ${index + 1} has an unknown visual kind "${v.kind}"`);
}

export function buildFilmHtml({ board, look, size, visuals, captions = true, cssHref }) {
  const capSize = Math.min(56, Math.max(30, Math.round(Math.min(size.width, size.height) * 0.042)));
  const padX = Math.round(size.width * 0.07);
  const padY = Math.round(size.height * 0.07);
  const titlePx = titleSize(board.title, size);
  const tokens = [
    `--paper:${look.paper}`, `--ink:${look.ink}`, `--muted:${look.muted}`,
    `--accent:${look.accent}`, `--signal:${look.signal}`,
    `--frame-w:${size.width}px`, `--frame-h:${size.height}px`,
    `--pad-x:${padX}px`, `--pad-y:${padY}px`, `--cap-size:${capSize}px`,
    `--title-size:${titlePx}px`,
    `--body-font:${look.bodyFont}`, `--title-font:${look.titleFont}`,
    `--title-weight:${look.titleWeight}`,
  ].join(';');

  const frames = board.scenes.map((s, i) => {
    const caption = captions
      ? `<div class="film-caption"><span>${esc(s.caption)}</span></div>`
      : '';
    return `<section class="frame" data-scene="${esc(s.id)}">${visuals[i]}${caption}</section>`;
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(board.title)}</title>
<link rel="stylesheet" href="${esc(cssHref)}">
<style>:root{${tokens};}</style>
</head>
<body><main class="reel">
${frames.join('\n')}
</main></body>
</html>
`;
}

/* ---- a local voice ------------------------------------------------------ */

const TTS_SCRIPT = `param([string]$TextFile, [string]$OutFile, [string]$Voice)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$names = @($s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name })
if ($names.Count -eq 0) { [Console]::Error.WriteLine('no installed SAPI voices'); exit 3 }
if ($Voice -and $Voice -ne 'auto') {
  $pick = $names | Where-Object { $_ -like "*$Voice*" } | Select-Object -First 1
  if (-not $pick) { [Console]::Error.WriteLine("no voice matching '" + $Voice + "'. Installed: " + ($names -join ', ')); exit 2 }
  $s.SelectVoice($pick)
} else {
  $pick = $names | Where-Object { $_ -like '*Zira*' } | Select-Object -First 1
  if (-not $pick) { $pick = $names | Select-Object -First 1 }
  $s.SelectVoice($pick)
}
$s.Rate = 0
$s.SetOutputToWaveFile($OutFile)
$s.Speak([IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8))
$s.Dispose()
`;

export function readWavDurationMs(file) {
  const b = fs.readFileSync(file);
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path.basename(file)} is not a WAV file`);
  }
  let byteRate = 0;
  for (let i = 12; i + 8 <= b.length;) {
    const id = b.toString('ascii', i, i + 4);
    const size = b.readUInt32LE(i + 4);
    if (id === 'fmt ') byteRate = b.readUInt32LE(i + 16);
    if (id === 'data' && byteRate > 0) return Math.round((size / byteRate) * 1000);
    i += 8 + size + (size % 2);
  }
  throw new Error(`no audio data in ${path.basename(file)}`);
}

function writeWav(file, samples, sampleRate = SAMPLE_RATE) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

/** A short, low, soft transition sound. Generated, not sampled, so the repo
 *  carries no audio assets and the same bytes come out every time. */
export function writeWhooshWav(file, { ms = 320, sampleRate = SAMPLE_RATE } = {}) {
  const n = Math.round((sampleRate * ms) / 1000);
  const out = new Float32Array(n);
  let seed = 0x2f6e2b1;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = (seed / 4294967296) * 2 - 1;
    lp = lp * 0.93 + noise * 0.07;
    const t = i / n;
    const env = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.6)), 1.6) * (1 - t * 0.25);
    out[i] = Math.max(-1, Math.min(1, lp * env * 1.6));
  }
  writeWav(file, out, sampleRate);
}

function speak({ text, outFile, voice, script, cwd }) {
  if (process.platform !== 'win32') {
    throw new Error('the local voice is Windows SAPI. Use --silent on this machine.');
  }
  const textFile = outFile.replace(/\.wav$/i, '.txt');
  fs.writeFileSync(textFile, text, 'utf8');
  const r = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-TextFile', textFile, '-OutFile', outFile, '-Voice', voice || 'auto',
  ], { cwd, encoding: 'utf8' });
  if (r.error) throw new Error(`could not start the local voice: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`the local voice failed: ${(r.stderr || r.stdout || '').trim() || `exit ${r.status}`}`);
  }
  return readWavDurationMs(outFile);
}

/* ---- ffmpeg ------------------------------------------------------------- */

function runFfmpeg(args, { ffmpeg = 'ffmpeg' } = {}) {
  const r = spawnSync(ffmpeg, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw new Error(`ffmpeg could not run: ${r.error.message}`);
  if (r.status !== 0) {
    const tail = String(r.stderr || '').trim().split('\n').slice(-8).join('\n');
    throw new Error(`ffmpeg failed (${r.status})\n${tail}`);
  }
  return r;
}

function encodeScene({
  frame, out, size, fps, timing, transition, paper, audio, sfx, fadeOut, ffmpeg,
}) {
  const w = size.width;
  const h = size.height;
  const hex = paper.replace('#', '');
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  let index = 0;
  const addInput = (a) => { args.push(...a); return index++; };

  const still = addInput(['-loop', '1', '-framerate', String(fps), '-t', sec(timing.sceneMs), '-i', frame]);
  const base = transition === 'draw'
    ? addInput(['-f', 'lavfi', '-t', sec(timing.leadMs), '-i', `color=c=0x${hex}:s=${w}x${h}:r=${fps}`])
    : null;
  const nar = audio ? addInput(['-i', audio]) : null;
  const fx = sfx ? addInput(['-i', sfx]) : null;

  const graph = [];
  graph.push(`[${still}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x${hex},setsar=1,format=yuv420p,fps=${fps}[stillv]`);

  let v = '[stillv]';
  if (transition === 'draw') {
    graph.push(`[${base}:v]scale=${w}:${h},setsar=1,format=yuv420p[basev]`);
    graph.push(`[basev]${v}xfade=transition=wipeleft:duration=${sec(timing.leadMs)}:offset=0[xfade]`);
    v = '[xfade]';
  }

  const post = [];
  if (transition === 'fade' && timing.leadMs > 0) {
    post.push(`fade=t=in:st=0:d=${sec(timing.leadMs)}:color=0x${hex}`);
  }
  if (fadeOut > 0 && timing.sceneMs > fadeOut + 80) {
    post.push(`fade=t=out:st=${sec(timing.sceneMs - fadeOut)}:d=${sec(fadeOut)}:color=0x${hex}`);
  }
  if (post.length) graph.push(`${v}${post.join(',')}[vout]`);
  else graph.push(`${v}null[vout]`);

  let a = null;
  if (nar != null) {
    const dur = sec(timing.sceneMs);
    graph.push(`[${nar}:a]aresample=${SAMPLE_RATE},aformat=channel_layouts=mono,` +
      `adelay=${timing.leadMs}:all=1,apad,atrim=0:${dur},asetpts=N/SR/TB[nar]`);
    if (fx != null) {
      graph.push(`[${fx}:a]aresample=${SAMPLE_RATE},aformat=channel_layouts=mono,volume=0.14[fx]`);
      graph.push('[nar][fx]amix=inputs=2:duration=first:normalize=0[aout]');
    } else {
      graph.push('[nar]anull[aout]');
    }
    a = '[aout]';
  }

  args.push('-filter_complex', graph.join(';'), '-map', '[vout]');
  if (a) args.push('-map', a);
  args.push('-t', sec(timing.sceneMs), '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
  if (a) args.push('-c:a', 'aac', '-b:a', '128k', '-ar', String(SAMPLE_RATE), '-ac', '1');
  else args.push('-an');
  args.push('-movflags', '+faststart', out);
  return runFfmpeg(args, { ffmpeg });
}

/* ---- the book ----------------------------------------------------------- */

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function countSheets(file) {
  try { return splitSheets(readBookHtml(file)).length; } catch { return null; }
}

/** Build book.html when the source is newer, so page scenes photograph the
 *  book as it is now. The build is the same tool the author runs. */
export function ensureBookBuilt(bookDir, { build = true } = {}) {
  const built = path.join(bookDir, 'book.html');
  const cfgPath = path.join(bookDir, 'book.json');
  const cfg = readJson(cfgPath);
  if (!cfg) throw new Error(`${bookDir} has no book.json`);
  const interior = path.join(bookDir, cfg.interior || `${path.basename(bookDir)}.html`);
  const sources = [cfgPath, interior].filter((p) => fs.existsSync(p));
  const fresh = fs.existsSync(built) &&
    sources.every((p) => fs.statSync(p).mtimeMs <= fs.statSync(built).mtimeMs + 1);
  if (fresh || !build) return built;
  const r = spawnSync(process.execPath, [path.join(TOOLS, 'build-book.mjs'), bookDir], {
    cwd: ROOT, encoding: 'utf8',
  });
  if (r.status !== 0) {
    const tail = String(r.stderr || r.stdout || '').trim().split('\n').slice(-6).join('\n');
    throw new Error(`could not build ${path.basename(bookDir)}:\n${tail}`);
  }
  return built;
}

const cssToHex = (color) => {
  const s = String(color || '').trim();
  const m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (!m) return s.startsWith('#') ? s : '#' + s.replace(/^0x/i, '');
  const [r, g, b] = m[1].split(',').map((x) => parseFloat(x));
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
};

async function lookAndPages(browser, built, pages, framesDir) {
  const page = await open(browser, built, { deviceScaleFactor: 2, frozen: hasMotion(built) });
  try {
    const box = await page.evaluate(() => {
      const s = document.querySelector('.sheet');
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return { width: Math.ceil(r.width) + 40, height: Math.ceil(r.height) + 40 };
    });
    if (box) await page.setViewportSize(box);

    const look = await page.evaluate(() => {
      const sheet = document.querySelector('.sheet.bb') || document.querySelector('.sheet') || document.body;
      const cs = getComputedStyle(sheet);
      const title = document.querySelector('.sheet .title');
      const tcs = title ? getComputedStyle(title) : cs;
      const value = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
      return {
        paper: cs.backgroundColor,
        ink: value('--ink', '#1A1A2E'),
        muted: value('--muted', '#5B6472'),
        accent: value('--accent', '#6366F1'),
        signal: value('--signal', '#0D9488'),
        bodyFont: cs.fontFamily || 'system-ui, sans-serif',
        titleFont: tcs.fontFamily || cs.fontFamily || 'system-ui, sans-serif',
        titleWeight: tcs.fontWeight || '600',
      };
    });
    look.paper = cssToHex(look.paper);
    look.ink = cssToHex(look.ink);
    look.muted = cssToHex(look.muted);
    look.accent = cssToHex(look.accent);
    look.signal = cssToHex(look.signal);

    const sheets = page.locator('.sheet');
    const have = await sheets.count();
    for (const n of pages) {
      if (n < 1 || n > have) throw new Error(`page ${n} is not in ${path.basename(built)} (${have} sheets)`);
      await sheets.nth(n - 1).screenshot({ path: path.join(framesDir, `page-${n}.png`) });
    }
    return look;
  } finally {
    await page.close();
  }
}

/* ---- the film ----------------------------------------------------------- */

/**
 * Make the video.
 *
 * bookDir       a book folder, or null for a standalone storyboard
 * storyboardPath explicit storyboard.json (defaults inside bookDir)
 * silent        skip SAPI; timing uses the word count
 * captions      burn the caption and write captions.srt
 * sfx           add the transition sound under the voice
 */
export async function makeVideo({
  bookDir = null, storyboardPath = null, out = null, voice = null,
  silent = false, captions = true, sfx = false, width = null, fps = null,
  ffmpeg = 'ffmpeg', log = () => {},
} = {}) {
  const boardPath = storyboardPath || (bookDir ? path.join(bookDir, 'storyboard.json') : null);
  if (!boardPath || !fs.existsSync(boardPath)) {
    throw new Error(`no storyboard at ${boardPath || '(none)'}. Plan one first.`);
  }
  const raw = readJson(boardPath);
  if (!raw) throw new Error(`${boardPath} is not valid JSON`);

  const baseDir = bookDir || path.dirname(boardPath);
  let built = null;
  let bookTitle = '';
  if (bookDir) {
    built = ensureBookBuilt(bookDir);
    const cfg = readJson(path.join(bookDir, 'book.json')) || {};
    bookTitle = cfg.title || '';
  }

  const storyboard = normalizeStoryboard(raw, {
    fallbackTitle: bookTitle || 'Untitled video',
    voice: voice || 'auto',
  });
  if (voice) storyboard.voice = voice;

  const hasPage = storyboard.scenes.some((s) => s.visual?.kind === 'page');
  if (hasPage && !built) {
    throw new Error('a page scene needs a book. Put the storyboard inside books/<slug>/ or drop the page visuals.');
  }
  const pages = built ? countSheets(built) : null;
  if (hasPage && pages == null) {
    throw new Error(`could not read ${path.basename(built || 'book.html')}; build the book first.`);
  }

  const check = validateStoryboard(storyboard, { bookPages: pages });
  for (const w of check.warnings) log(`warning: ${w}`);
  if (!check.ok) throw new Error(`the storyboard did not validate: ${check.errors.join('; ')}`);

  if (fps != null) {
    const n = Number(fps);
    if (!Number.isFinite(n) || n < 1 || n > 60) throw new Error('fps must be between 1 and 60');
    storyboard.fps = Math.round(n);
  }

  const size = videoSize(storyboard.aspect, width);
  const workDir = path.join(baseDir, 'video');
  const framesDir = path.join(workDir, 'frames');
  const clipsDir = path.join(workDir, 'clips');
  const audioDir = path.join(workDir, 'audio');
  for (const d of [framesDir, clipsDir, audioDir]) fs.rmSync(d, { recursive: true, force: true });
  for (const d of [framesDir, clipsDir, audioDir]) fs.mkdirSync(d, { recursive: true });
  const filmHtml = path.join(workDir, 'film.html');

  const slug = bookDir ? path.basename(bookDir) : path.basename(path.dirname(boardPath));
  const outFile = path.resolve(out || path.join(workDir, `${slug}.mp4`));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  log(`${storyboard.scenes.length} scenes, ${storyboard.aspect} ${size.width}x${size.height} @ ${storyboard.fps}fps`);

  const pageNumbers = [...new Set(storyboard.scenes
    .filter((s) => s.visual?.kind === 'page')
    .map((s) => Number(s.visual.page)))].sort((a, b) => a - b);

  let look = DEFAULT_LOOK;
  const browser = await chromium.launch();
  try {
    if (built) {
      look = await lookAndPages(browser, built, pageNumbers, framesDir);
      if (pageNumbers.length) log(`photographed ${pageNumbers.length} book page${pageNumbers.length === 1 ? '' : 's'}`);
    }

    const decorated = storyboard.scenes.map((s) => ({ ...s, filmTitle: storyboard.title }));
    const visuals = decorated.map((s, i) => visualMarkup(s, { bookTitle, index: i }));
    const relCss = path.relative(workDir, FILM_CSS).split(path.sep).join('/')
      .split('/').map((p) => p === '..' ? '..' : encodeURIComponent(p)).join('/');
    fs.writeFileSync(filmHtml, buildFilmHtml({
      board: storyboard, look, size, visuals, captions, cssHref: relCss,
    }));

    const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(filmHtml).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const frames = await page.$$('.frame');
    if (frames.length !== storyboard.scenes.length) {
      throw new Error(`the film has ${frames.length} frames for ${storyboard.scenes.length} scenes`);
    }
    for (let i = 0; i < frames.length; i++) {
      await frames[i].screenshot({ path: path.join(framesDir, `f${String(i + 1).padStart(2, '0')}.png`) });
    }
    await page.close();
  } finally {
    await browser.close();
  }
  log('frames drawn');

  const timings = [];
  if (!silent) {
    const script = path.join(workDir, 'tts.ps1');
    fs.writeFileSync(script, TTS_SCRIPT, 'ascii');
    for (let i = 0; i < storyboard.scenes.length; i++) {
      const s = storyboard.scenes[i];
      const wav = path.join(audioDir, `s${String(i + 1).padStart(2, '0')}.wav`);
      const ms = speak({ text: s.narration, outFile: wav, voice: storyboard.voice, script, cwd: workDir });
      timings.push(sceneTiming(s, { narrationMs: ms }));
      log(`scene ${i + 1}: ${(ms / 1000).toFixed(1)}s spoken`);
    }
  } else {
    for (const s of storyboard.scenes) timings.push(sceneTiming(s, { silent: true }));
    log('silent: timing from the words');
  }

  let sfxFile = null;
  if (sfx && !silent) {
    sfxFile = path.join(audioDir, 'whoosh.wav');
    writeWhooshWav(sfxFile);
  }

  const clips = [];
  for (let i = 0; i < storyboard.scenes.length; i++) {
    const s = storyboard.scenes[i];
    const clip = path.join(clipsDir, `s${String(i + 1).padStart(2, '0')}.mp4`);
    const audio = silent ? null : path.join(audioDir, `s${String(i + 1).padStart(2, '0')}.wav`);
    encodeScene({
      frame: path.join(framesDir, `f${String(i + 1).padStart(2, '0')}.png`),
      out: clip,
      size,
      fps: storyboard.fps,
      timing: timings[i],
      transition: s.transition,
      paper: look.paper,
      audio,
      sfx: s.transition !== 'cut' ? sfxFile : null,
      fadeOut: i === storyboard.scenes.length - 1 ? FADE_OUT_MS : 0,
      ffmpeg,
    });
    clips.push(clip);
    log(`scene ${i + 1}: ${(timings[i].sceneMs / 1000).toFixed(2)}s`);
  }

  const list = path.join(clipsDir, 'list.txt');
  fs.writeFileSync(list, clips.map((c) => `file '${c.split(path.sep).join('/')}'`).join('\n') + '\n', 'utf8');
  const joinArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
  try {
    runFfmpeg([...joinArgs, '-c', 'copy', '-movflags', '+faststart', outFile], { ffmpeg });
  } catch {
    log('stream copy would not join; re-encoding the seam');
    const re = [...joinArgs, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
    if (!silent) re.push('-c:a', 'aac', '-b:a', '128k', '-ar', String(SAMPLE_RATE), '-ac', '1');
    runFfmpeg([...re, '-movflags', '+faststart', outFile], { ffmpeg });
  }

  let srt = null;
  let cursor = 0;
  if (captions) {
    const cues = storyboard.scenes.map((s, i) => {
      const start = cursor;
      cursor += timings[i].sceneMs;
      return { startMs: start, endMs: cursor, text: s.caption };
    });
    srt = path.join(workDir, 'captions.srt');
    fs.writeFileSync(srt, buildSrt(cues), 'utf8');
  }

  const durationMs = timings.reduce((sum, t) => sum + t.sceneMs, 0);
  const bytes = fs.statSync(outFile).size;
  return {
    out: outFile,
    workDir,
    filmHtml,
    srt,
    bytes,
    durationMs,
    size,
    fps: storyboard.fps,
    scenes: storyboard.scenes.map((s, i) => ({
      id: s.id, ms: timings[i].sceneMs, leadMs: timings[i].leadMs,
      narrationMs: timings[i].narrationMs, holdMs: timings[i].holdMs,
    })),
    warnings: check.warnings,
    validation: check,
    look,
  };
}

/* ---- command line ------------------------------------------------------- */

function usage() {
  console.log(`Usage: node src/engine/tools/make-video.mjs <book-folder | storyboard.json> [options]

  --out <file>      where the mp4 goes
  --silent          no voice; pacing comes from the word count
  --no-captions     no burned caption and no captions.srt
  --sfx             a soft transition sound under the voice
  --voice <name>    a Windows SAPI voice, or "auto"
  --width <px>      render at a smaller width
  --fps <n>         override the storyboard's frame rate
  --json            print one JSON summary
  --help            this text`);
}

function parseArgs(argv) {
  const opts = { silent: false, captions: true, sfx: false, json: false };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--silent') opts.silent = true;
    else if (a === '--no-captions') opts.captions = false;
    else if (a === '--sfx') opts.sfx = true;
    else if (a === '--no-sfx') opts.sfx = false;
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--voice') opts.voice = argv[++i];
    else if (a === '--width') opts.width = Number(argv[++i]);
    else if (a === '--fps') opts.fps = Number(argv[++i]);
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else pos.push(a);
  }
  return { opts, pos };
}

async function main() {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(e.message); usage(); process.exit(1); }
  const { opts, pos } = parsed;
  if (opts.help) { usage(); return; }
  if (!pos.length) { usage(); process.exit(1); }

  const input = pos[0];
  try {
    let bookDir = null;
    let storyboardPath = null;
    if (/\.json$/i.test(input)) {
      storyboardPath = path.resolve(input);
      const dir = path.dirname(storyboardPath);
      if (fs.existsSync(path.join(dir, 'book.json'))) bookDir = dir;
    } else {
      const booksSlug = path.join(ROOT, 'books', input);
      const dir = fs.existsSync(booksSlug) ? booksSlug : path.resolve(input);
      if (!fs.existsSync(path.join(dir, 'book.json'))) {
        throw new Error(`${input} is not a book (no book.json). Pass a storyboard.json instead.`);
      }
      bookDir = dir;
      storyboardPath = path.join(dir, 'storyboard.json');
    }

    const result = await makeVideo({
      bookDir,
      storyboardPath,
      out: opts.out,
      voice: opts.voice,
      silent: opts.silent,
      captions: opts.captions,
      sfx: opts.sfx,
      width: opts.width,
      fps: opts.fps,
      log: opts.json ? () => {} : (line) => console.log(line),
    });
    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`\nvideo: ${path.relative(process.cwd(), result.out)}`);
      console.log(`${(result.bytes / 1048576).toFixed(1)} MB, ${(result.durationMs / 1000).toFixed(1)}s, ${result.size.width}x${result.size.height}`);
      if (result.srt) console.log(`captions: ${path.relative(process.cwd(), result.srt)}`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
