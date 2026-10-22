/* ==========================================================================
   video.test.mjs  -  a storyboard becomes a video without touching the book
   --------------------------------------------------------------------------
   The unit half pins the arithmetic: timing, SRT, escaping, and the rule that
   an unlabelled drawing carries no invented words. The last half runs the real
   tool on a scratch book, silent, at 320px, and reads the finished mp4 with
   ffprobe. No network, no SAPI, no real book.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ok, group, report, withScratch, ROOT, SCRATCH } from './harness.mjs';
import {
  videoSize, titleSize, withoutLabels, sceneTiming, srtTime, buildSrt,
  visualMarkup, buildFilmHtml, writeWhooshWav, readWavDurationMs,
  makeVideo, LEAD_MS,
} from '../src/engine/tools/make-video.mjs';
import { compileFigure, exampleSpec as figureExample, FIGURE_KINDS } from '../src/engine/tools/figures.mjs';
import { compileDiagram, exampleSpec as diagramExample, KINDS as DIAGRAM_KINDS } from '../src/engine/tools/diagram.mjs';

const LOOK = {
  paper: '#FAFAFC', ink: '#1A1A2E', muted: '#5B6472', accent: '#6366F1',
  signal: '#0D9488', bodyFont: 'Inter, system-ui, sans-serif',
  titleFont: '"Space Grotesk", Inter, system-ui, sans-serif', titleWeight: '600',
};

const scene = (over = {}) => ({
  id: 's1',
  narration: 'A line that is long enough to film.',
  caption: 'A short caption.',
  visual: { kind: 'title' },
  holdMs: 600,
  transition: 'cut',
  ...over,
});

group('an aspect is a promise about pixels');
const landscape = videoSize('16:9');
const portrait = videoSize('9:16');
const small = videoSize('16:9', 320);
ok('16:9 is 1920 by 1080', landscape.width === 1920 && landscape.height === 1080);
ok('9:16 is 1080 by 1920', portrait.width === 1080 && portrait.height === 1920);
ok('a width override keeps the ratio', small.width === 320 && small.height === 180, `${small.width}x${small.height}`);
ok('an unknown aspect falls back to 16:9', videoSize('7:3').width === 1920);

group('a title is sized to the frame it sits in');
ok('a short title is larger than a long one',
  titleSize('Short', landscape) > titleSize('A title that keeps going and going and going and going', landscape));
ok('a long title stays inside the frame', titleSize('x'.repeat(120), portrait) < portrait.width * 0.06);

group('an example drawing loses its words, never its shape');
for (const kind of FIGURE_KINDS) {
  const plain = withoutLabels(compileFigure(figureExample(kind)));
  ok(`figure ${kind} strips its example words`, !/<text\b/.test(plain) && /<svg/.test(plain));
}
for (const kind of DIAGRAM_KINDS) {
  const plain = withoutLabels(compileDiagram(diagramExample(kind)));
  ok(`diagram ${kind} strips its example words`, !/<text\b/.test(plain) && /<svg/.test(plain));
}
ok('the drawing itself survives', /<svg/.test(withoutLabels('<svg><rect/></svg><text>x</text>')));

group('the voice is the measurement, the words are the estimate');
const cut = sceneTiming(scene(), { narrationMs: 3000 });
ok('a cut starts instantly', cut.leadMs === 0);
ok('a cut is narration plus hold', cut.sceneMs === 3600, String(cut.sceneMs));
const fade = sceneTiming(scene({ transition: 'fade' }), { narrationMs: 3000 });
ok('a fade adds its lead in', fade.leadMs === LEAD_MS && fade.sceneMs === 4000, String(fade.sceneMs));
const tiny = sceneTiming(scene({ transition: 'fade' }), { narrationMs: 200 });
ok('no scene is shorter than the minimum', tiny.sceneMs >= 1200, String(tiny.sceneMs));
const silent = sceneTiming(scene({ transition: 'fade', narration: 'one two three four five six seven eight nine ten' }), { silent: true });
ok('silent pacing comes from the word count', silent.sceneMs === 400 + 600 + 4000, String(silent.sceneMs));
ok('a missing hold gets the default', sceneTiming(scene({ holdMs: undefined }), { narrationMs: 1000 }).holdMs === 600);

group('captions are timecode, not prose');
ok('zero is a legal timecode', srtTime(0) === '00:00:00,000', srtTime(0));
ok('hours, minutes, seconds and millis', srtTime(3723456) === '01:02:03,456', srtTime(3723456));
const srt = buildSrt([
  { startMs: 0, endMs: 1200, text: 'first line' },
  { startMs: 1200, endMs: 3400, text: 'second\nline' },
]);
ok('one numbered cue per scene', /^1\n/.test(srt) && /\n2\n/.test(srt));
ok('the arrow is SRT, not ASCII', srt.includes(' --> '));
ok('a newline in a caption is flattened', srt.includes('second line'));

group('a frame draws only what the storyboard named');
const title = visualMarkup({ ...scene(), filmTitle: 'A <script> title' }, { bookTitle: 'The Book' });
ok('the title is escaped', title.includes('A &lt;script&gt; title') && !title.includes('<script>'));
ok('the book is named when it differs', title.includes('The Book'));
const page = visualMarkup(scene({ visual: { kind: 'page', page: 3 } }));
ok('a page points at its own screenshot', page.includes('frames/page-3.png'));
const figBare = visualMarkup(scene({ visual: { kind: 'figure', figure: 'isoStack' } }));
ok('a bare figure is unlabelled', !/<text\b/.test(figBare) && /<svg/.test(figBare));
const figSpec = visualMarkup(scene({ visual: { kind: 'figure', figure: 'isoStack', spec: figureExample('isoStack') } }));
ok('a specified figure keeps its labels', /<text\b/.test(figSpec));
const diaBare = visualMarkup(scene({ visual: { kind: 'diagram', shape: 'pipeline' } }));
ok('a bare diagram is unlabelled', !/<text\b/.test(diaBare) && /<svg/.test(diaBare));
const diaSpec = visualMarkup(scene({ visual: { kind: 'diagram', shape: 'pipeline', spec: diagramExample('pipeline') } }));
ok('a specified diagram keeps its labels', /<text\b/.test(diaSpec));

group('the film is one html document with one frame per scene');
const board = {
  title: 'A test video', aspect: '16:9', fps: 30, voice: 'auto', music: 'none',
  scenes: [
    scene({ id: 'open' }),
    scene({ id: 'page', visual: { kind: 'page', page: 2 } }),
  ],
};
const visuals = board.scenes.map((s, i) => visualMarkup(s, { bookTitle: 'The Book', index: i }));
const film = buildFilmHtml({
  board, look: LOOK, size: small, visuals, captions: true, cssHref: '../../../src/engine/film.css',
});
ok('the frame is the size it promised', film.includes('--frame-w:320px') && film.includes('--frame-h:180px'));
ok('both scenes are present, in order', film.indexOf('data-scene="open"') < film.indexOf('data-scene="page"'));
ok('the caption is burned in', (film.match(/class="film-caption"/g) || []).length === 2);
ok('the engine stylesheet is linked', /film\.css/.test(film));
ok('a film is not a program', !/<script\b/i.test(film));
const bare = buildFilmHtml({ board, look: LOOK, size: small, visuals, captions: false, cssHref: 'x.css' });
ok('captions can be left out', !/film-caption/.test(bare));

group('the transition sound is generated, not sampled');
const tmp = path.join(ROOT, '.scratch');
fs.mkdirSync(tmp, { recursive: true });
const sfx = path.join(tmp, 'whoosh-test.wav');
writeWhooshWav(sfx);
const sfxMs = readWavDurationMs(sfx);
ok('a whoosh is a real wav', fs.readFileSync(sfx).toString('ascii', 0, 4) === 'RIFF');
ok('and lasts about a third of a second', sfxMs >= 300 && sfxMs <= 340, `${sfxMs}ms`);
fs.rmSync(sfx, { force: true });

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;
const hasFfprobe = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' }).status === 0;

group('a silent storyboard films end to end');
ok('ffmpeg is installed', hasFfmpeg);
ok('ffprobe is installed', hasFfprobe);

if (hasFfmpeg && hasFfprobe) {
  await withScratch(async () => {
    const bookDir = path.join(ROOT, 'books', SCRATCH);
    const plan = {
      title: 'A test video',
      aspect: '16:9',
      fps: 24,
      voice: 'auto',
      scenes: [
        {
          id: 'open', narration: 'This is how a short book video opens.',
          caption: 'A short book video.', visual: { kind: 'title' }, holdMs: 300, transition: 'cut',
        },
        {
          id: 'page', narration: 'Here is a page from the book, exactly as it prints.',
          caption: 'A real page.', visual: { kind: 'page', page: 5 }, holdMs: 400, transition: 'fade',
        },
        {
          id: 'figure', narration: 'The drawing carries the shape, the voice carries the words.',
          caption: 'Shape without invented labels.', visual: { kind: 'figure', figure: 'isoStack' },
          holdMs: 300, transition: 'draw',
        },
      ],
    };
    fs.writeFileSync(path.join(bookDir, 'storyboard.json'), JSON.stringify(plan, null, 2));

    let result;
    try {
      result = await makeVideo({ bookDir, silent: true, width: 320, captions: true });
    } catch (e) {
      ok('the video was made', false, e.message);
      return;
    }
    ok('the video was made', fs.existsSync(result.out), path.relative(ROOT, result.out));
    const head = fs.readFileSync(result.out).subarray(4, 8).toString('ascii');
    ok('it is an mp4', head === 'ftyp', head);
    ok('it has weight', fs.statSync(result.out).size > 20_000, `${fs.statSync(result.out).size} bytes`);
    ok('one clip per scene', result.scenes.length === 3);
    ok('the duration is the sum of the scenes',
      result.durationMs === result.scenes.reduce((sum, s) => sum + s.ms, 0));
    const srtText = fs.readFileSync(result.srt, 'utf8');
    ok('the captions are on disk', /A short book video\./.test(srtText) && /A real page\./.test(srtText));
    ok('every scene has a still',
      [1, 2, 3].every((n) => fs.existsSync(path.join(result.workDir, 'frames', `f${String(n).padStart(2, '0')}.png`))));
    ok('the book page was photographed',
      fs.existsSync(path.join(result.workDir, 'frames', 'page-5.png')));
    ok('the film document stays for inspection',
      /data-scene="figure"/.test(fs.readFileSync(result.filmHtml, 'utf8')));
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1', result.out], { encoding: 'utf8' });
    const real = Number(probe.stdout.trim());
    ok('the mp4 really lasts that long',
      Math.abs(real * 1000 - result.durationMs) < 400, `${real}s vs ${result.durationMs / 1000}s`);

    const bad = {
      ...plan,
      scenes: [plan.scenes[0], { ...plan.scenes[1], visual: { kind: 'page', page: 99 } }],
    };
    const badPath = path.join(bookDir, 'bad-storyboard.json');
    fs.writeFileSync(badPath, JSON.stringify(bad, null, 2));
    let refused = '';
    try { await makeVideo({ bookDir, storyboardPath: badPath, silent: true, width: 320 }); }
    catch (e) { refused = e.message; }
    ok('a page past the end is refused before a frame', /did not validate/.test(refused) && /page 99/.test(refused), refused);
  });
}

report('VIDEO');
