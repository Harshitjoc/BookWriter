/* ==========================================================================
   test/storyboard.test.mjs  —  a video plan, checked before anything is filmed
   --------------------------------------------------------------------------
   The storyboard is the contract between a model and make-video.mjs. These
   tests pin the contract: the shape, the defaults normalize() may fill, the
   errors it may not paper over, and the one HTTP path that saves a plan.
   The model is injected; the server test uses a real socket and a fake local
   provider, exactly like the draft tests.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { group, ok, report, withServer, withScratch, fakeModel, readSSE, ROOT } from './harness.mjs';
import {
  validateStoryboard, normalizeStoryboard, estimateDurationMs,
  estimateSceneMs, countWords, DEFAULT_ASPECT, DEFAULT_FPS, DEFAULT_HOLD_MS,
} from '../src/shared/storyboard.js';
import { planStoryboard, clampScenes } from '../src/engine/tools/plan-storyboard.mjs';

const scene = (over = {}) => ({
  id: 'a',
  narration: 'This is one spoken idea, said in a way a person would say it.',
  caption: 'One idea',
  visual: { kind: 'page', page: 1 },
  holdMs: 600,
  transition: 'cut',
  ...over,
});

const board = (over = {}) => ({
  title: 'A small video',
  aspect: '16:9',
  fps: 30,
  voice: 'auto',
  music: 'none',
  scenes: [scene({ id: 'a' }), scene({ id: 'b' }), scene({ id: 'c' })],
  ...over,
});

group('a storyboard is checked before a frame is drawn');
{
  ok('a well-formed plan passes', validateStoryboard(board()).ok);
  ok('a plan with no title is refused', !validateStoryboard(board({ title: '' })).ok);
  ok('an unknown aspect is refused', !validateStoryboard(board({ aspect: '21:9' })).ok);
  ok('an unknown fps is refused', !validateStoryboard(board({ fps: 60 })).ok);
  ok('a plan with no scenes is refused',
    !validateStoryboard(board({ scenes: [] })).ok);
  ok('a duplicate scene id is refused',
    !validateStoryboard(board({ scenes: [scene({ id: 'a' }), scene({ id: 'a' })] })).ok);
  ok('a scene with no narration is refused',
    !validateStoryboard(board({ scenes: [scene({ narration: '' })] })).ok);
  ok('a scene with no caption is refused',
    !validateStoryboard(board({ scenes: [scene({ caption: '' })] })).ok);
  ok('a caption over the limit is refused',
    !validateStoryboard(board({ scenes: [scene({ caption: 'x'.repeat(101) })] })).ok);
  ok('an unknown visual kind is refused',
    !validateStoryboard(board({ scenes: [scene({ visual: { kind: 'video' } })] })).ok);
  ok('an unknown figure is refused',
    !validateStoryboard(board({ scenes: [scene({ visual: { kind: 'figure', figure: 'dance' } })] })).ok);
  ok('a known figure passes',
    validateStoryboard(board({ scenes: [scene({ visual: { kind: 'figure', figure: 'stickPose' } })] })).ok);
  ok('a diagram without a shape or spec is refused',
    !validateStoryboard(board({ scenes: [scene({ visual: { kind: 'diagram' } })] })).ok);
  ok('a named diagram shape passes',
    validateStoryboard(board({ scenes: [scene({ visual: { kind: 'diagram', shape: 'row' } })] })).ok);
  ok('a diagram spec passes',
    validateStoryboard(board({ scenes: [scene({ visual: { kind: 'diagram', spec: { kind: 'row' } } })] })).ok);
  ok('page 0 is refused',
    !validateStoryboard(board({ scenes: [scene({ visual: { kind: 'page', page: 0 } })] })).ok);
  ok('a page past the end of the book is refused',
    !validateStoryboard(board({ scenes: [scene({ visual: { kind: 'page', page: 9 } })] }), { bookPages: 6 }).ok);
  ok('a page inside the book passes',
    validateStoryboard(board({ scenes: [scene({ visual: { kind: 'page', page: 6 } })] }), { bookPages: 6 }).ok);
  ok('an unknown transition is refused',
    !validateStoryboard(board({ scenes: [scene({ transition: 'wipe' })] })).ok);
  ok('a hold outside the range is refused',
    !validateStoryboard(board({ scenes: [scene({ holdMs: 9000 })] })).ok);
  ok('a long narration is refused',
    !validateStoryboard(board({ scenes: [scene({ narration: 'word '.repeat(130) })] })).ok);
}

group('normalize fills defaults, not words');
{
  const n = normalizeStoryboard({
    scenes: [
      { narration: 'First spoken line that is long enough to film.', caption: 'first', visual: { kind: 'title' } },
      { narration: 'Second spoken line that is long enough to film.', caption: 'second', visual: { kind: 'title' } },
    ],
  });
  ok('a missing title gets the fallback', n.title === 'Untitled video');
  ok('a missing aspect becomes 16:9', n.aspect === DEFAULT_ASPECT);
  ok('a missing fps becomes 30', n.fps === DEFAULT_FPS);
  ok('music is always none for now', n.music === 'none');
  ok('a missing id is assigned, in order', n.scenes[0].id === 's1' && n.scenes[1].id === 's2');
  ok('a missing hold is the default', n.scenes[0].holdMs === DEFAULT_HOLD_MS);
  ok('a missing transition is a cut', n.scenes[0].transition === 'cut');
  ok('normalize never invents a narration',
    normalizeStoryboard({ scenes: [{ caption: 'x', visual: { kind: 'title' } }] }).scenes[0].narration === undefined);
  ok('and validation then refuses it',
    !validateStoryboard(normalizeStoryboard({ title: 'x', scenes: [{ caption: 'x', visual: { kind: 'title' } }] })).ok);
  ok('a duplicate id is made unique instead of dropped',
    normalizeStoryboard({ title: 'x', scenes: [scene({ id: 'a' }), scene({ id: 'a' })] }).scenes.map((s) => s.id).join(',') === 'a,a-2');
  ok('a hold is clamped into range',
    normalizeStoryboard({ title: 'x', scenes: [scene({ holdMs: 99999 })] }).scenes[0].holdMs === 8000);
  ok('a bad aspect falls back to 16:9',
    normalizeStoryboard({ title: 'x', aspect: '99:1', scenes: [scene()] }).aspect === DEFAULT_ASPECT);
  ok('the version is stamped', normalizeStoryboard({ title: 'x', scenes: [scene()] }).version === 1);
}

group('duration is an estimate; the voice is the measurement');
{
  ok('words are counted plainly', countWords('one two  three') === 3);
  ok('an empty narration has no words', countWords('') === 0);
  const ms = estimateSceneMs({ narration: 'word '.repeat(30), holdMs: 600 });
  ok('30 words at 150 wpm plus the hold is 12.6s', ms === 12600, `${ms}ms`);
  ok('a scene never lasts under 1.2s',
    estimateSceneMs({ narration: '', holdMs: 0 }) === 1200);
  ok('the board is the sum of its scenes',
    estimateDurationMs({ scenes: [scene(), scene()] }) === estimateSceneMs(scene()) * 2);
  ok('a missing board is zero, not NaN', estimateDurationMs(null) === 0);
  ok('a scene count is clamped to something filmable',
    clampScenes(0) === 1 && clampScenes(999) === 40 && clampScenes('x') === 8);
}

/** A model that answers the storyboard planner with a valid board of exactly
 *  the requested number of scenes. `answer` overrides the reply verbatim. */
function model({ answer = null } = {}) {
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const system = (body.messages || []).map((m) => m.content).join('\n');
    const user = (body.messages || []).map((m) => m.content).join('\n');
    let text = answer;
    if (text == null) {
      const m = user.match(/NUMBER OF SCENES: exactly (\d+)/);
      const n = m ? Number(m[1]) : 4;
      text = JSON.stringify({
        title: 'A stub video',
        aspect: '16:9',
        scenes: Array.from({ length: n }, (_, i) => ({
          id: `s${i + 1}`,
          narration: `This is scene number ${i + 1}, and it says exactly one thing.`,
          caption: `Scene ${i + 1}`,
          visual: { kind: 'page', page: 1 },
          holdMs: 500,
          transition: 'cut',
        })),
      });
    }
    const isPlan = /storyboard editor/.test(system);
    return { ok: true, json: async () => ({ choices: [{ message: { content: isPlan ? text : 'x' } }] }) };
  };
}

group('the planner returns a validated storyboard, or nothing');
{
  const got = await planStoryboard({
    topic: 'How a CDN works', provider: 'ollama', fetchImpl: model(),
    scenes: 5, pages: 6,
  });
  ok('the planner returns the requested number of scenes', got.storyboard.scenes.length === 5);
  ok('the returned plan passes validation', got.validation.ok);
  ok('the plan is normalized, not raw', got.storyboard.version === 1 && got.storyboard.music === 'none');

  let refused = false;
  try {
    await planStoryboard({ topic: 'x', provider: 'ollama', fetchImpl: model({ answer: 'not json at all' }) });
  } catch (e) { refused = /did not return a storyboard as JSON/.test(e.message); }
  ok('prose instead of JSON is refused, with a reason', refused);

  refused = false;
  try {
    await planStoryboard({
      topic: 'x', provider: 'ollama',
      fetchImpl: model({
        answer: JSON.stringify({ title: 'x', scenes: [scene({ visual: { kind: 'hologram' } })] }),
      }),
    });
  } catch (e) { refused = /did not validate/.test(e.message); }
  ok('a plan that fails the checks is never returned', refused);

  const short = await planStoryboard({
    topic: 'x', provider: 'ollama', scenes: 4,
    fetchImpl: model({
      answer: JSON.stringify({ title: 'A shorter plan', scenes: [scene({ id: 'a' }), scene({ id: 'b' })] }),
    }),
  });
  ok('a shortfall is warned about, never padded',
    short.storyboard.scenes.length === 2 && short.validation.warnings.some((w) => /asked for 4/.test(w)));

  let badAspect = false;
  try {
    await planStoryboard({ topic: 'x', provider: 'ollama', aspect: '21:9', fetchImpl: model() });
  } catch (e) { badAspect = /unknown aspect/.test(e.message); }
  ok('an aspect the video tool cannot render is refused up front', badAspect);

  let noInput = false;
  try { await planStoryboard({ provider: 'ollama', fetchImpl: model() }); }
  catch (e) { noInput = /topic or a source/.test(e.message); }
  ok('planning needs a topic or a source', noInput);
}

group('the server plans, saves, and refuses a broken plan');
{
  await withScratch(async () => {
    const fake = await fakeModel({
      content: (body) => {
        const user = (body?.messages || []).map((m) => m.content).join('\n');
        const hit = user.match(/NUMBER OF SCENES: exactly (\d+)/);
        const n = hit ? Number(hit[1]) : 3;
        return JSON.stringify({
          title: 'Planned on the server',
          aspect: '16:9',
          scenes: Array.from({ length: n }, (_, i) => ({
            id: `s${i + 1}`,
            narration: `This is scene number ${i + 1}, and it says exactly one thing.`,
            caption: `Scene ${i + 1}`,
            visual: { kind: 'page', page: 1 },
            holdMs: 500,
            transition: 'cut',
          })),
        });
      },
    });

    try {
      await withServer(async (base) => {
        const empty = await (await fetch(`${base}/api/storyboard?book=uitest`)).json();
        ok('a book with no plan says so instead of 404ing', empty.storyboard === null);
        ok('the server reports how many pages the book has', empty.pages > 0, `${empty.pages}`);

        const { status, events } = await readSSE(base, '/api/storyboard/plan', {
          book: 'uitest', topic: 'How a CDN works', provider: 'ollama', scenes: 3,
        });
        ok('planning opens a stream', status === 200);
        const done = events.find((e) => e.event === 'done');
        ok('the stream ends with a result', !!done);
        ok('the result carries a storyboard', done?.data?.storyboard?.scenes?.length === 3);
        ok('the server tells the planner how long the book is',
          done?.data?.meta?.pages > 0, `${done?.data?.meta?.pages}`);
        ok('the result carries the checks', done?.data?.validation?.ok === true);
        ok('the server does not write the plan just because it was planned',
          !fs.existsSync(path.join(ROOT, 'books', 'uitest', 'storyboard.json')));

        const saved = {
          title: 'Saved video',
          aspect: '16:9',
          fps: 30,
          voice: 'auto',
          music: 'none',
          scenes: [
            {
              id: 'a',
              narration: 'This is the first spoken line, and it is long enough to film.',
              caption: 'First',
              visual: { kind: 'page', page: 1 },
              holdMs: 500,
              transition: 'cut',
            },
          ],
        };
        const put = await fetch(`${base}/api/storyboard`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ book: 'uitest', storyboard: saved }),
        });
        ok('a valid plan is accepted for saving', put.status === 200, `${put.status}`);
        ok('the plan really reached the book folder',
          fs.existsSync(path.join(ROOT, 'books', 'uitest', 'storyboard.json')));

        const again = await (await fetch(`${base}/api/storyboard?book=uitest`)).json();
        ok('the saved plan comes back intact', again.storyboard?.title === 'Saved video');
        ok('the saved plan is validated on read', again.validation?.ok === true);

        const bad = await fetch(`${base}/api/storyboard`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ book: 'uitest', storyboard: { title: '', scenes: [] } }),
        });
        const badBody = await bad.json().catch(() => ({}));
        ok('a broken plan is a 400, not a file on disk', bad.status === 400);
        ok('and the refusal names what is wrong', /did not validate/.test(badBody.error || ''), badBody.error);

        const paid = await readSSE(base, '/api/storyboard/plan', {
          book: 'uitest', topic: 'x', provider: 'openai',
        });
        ok('a paid provider without permission is a plain HTTP refusal', paid.status === 400, `${paid.status}`);
      }, { OLLAMA_BASE_URL: fake.baseUrl, OLLAMA_MODEL: 'fake-model' });
    } finally {
      await fake.close();
    }
  });
}

report('STORYBOARD');
