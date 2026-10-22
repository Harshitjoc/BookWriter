/* ==========================================================================
   storyboard.js  -  the shape of a video, before a frame is drawn
   --------------------------------------------------------------------------
   A storyboard is what a video is made of: a title, a handful of scenes, and
   for each scene the words that are spoken, the words that are shown, and the
   thing that is drawn. It is deliberately small and strict, because the video
   tool that consumes it (make-video.mjs) must never have to guess:

     - caption   is shown on screen. It is not the narration.
     - narration is spoken by TTS. It is never invented from the caption.
     - visual    names something the engine already knows how to draw: a book
                 page, an engine figure (figures.mjs), an engine diagram
                 (diagram.mjs), or the title card. No generated images, no
                 stock footage, no model-authored SVG.
     - holdMs    is the quiet time after the spoken line, not the duration.
                 Duration is measured from the TTS audio, not guessed here.

   The same module runs in the cockpit (to show a plan) and on the server (to
   validate a plan before it is saved). Validation never repairs a storyboard;
   normalize() fills in defaults and ids, then validate() reports what is still
   wrong. A plan that fails validation is never written.
   ========================================================================== */
import { FIGURE_KINDS } from '../engine/tools/figures.mjs';
import { KINDS as DIAGRAM_KINDS } from '../engine/tools/diagram.mjs';

export const STORYBOARD_VERSION = 1;

/* The aspect is a promise about pixels, not a CSS class. */
export const ASPECTS = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};
export const ASPECT_IDS = Object.keys(ASPECTS);

export const FPS_VALUES = [24, 25, 30];
export const TRANSITIONS = ['cut', 'fade', 'draw'];
export const VISUAL_KINDS = ['title', 'page', 'figure', 'diagram'];

export const DEFAULT_ASPECT = '16:9';
export const DEFAULT_FPS = 30;
export const DEFAULT_HOLD_MS = 600;
export const MIN_HOLD_MS = 0;
export const MAX_HOLD_MS = 8000;

export const MIN_SCENES = 1;
export const MAX_SCENES = 40;
export const MAX_NARRATION = 600;
export const MAX_CAPTION = 100;

/* An estimate, not a measurement: the video tool times the real audio. 150
 * words a minute is a calm explainer pace, and a scene never lasts under 1.2s. */
export const WORDS_PER_MINUTE = 150;
export const MIN_SCENE_MS = 1200;

const isStr = (v) => typeof v === 'string';
const filled = (v) => isStr(v) && v.trim().length > 0;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function estimateSceneMs(scene, { wpm = WORDS_PER_MINUTE } = {}) {
  const spoken = Math.round((countWords(scene?.narration) / wpm) * 60000);
  const hold = Number.isFinite(scene?.holdMs) ? scene.holdMs : DEFAULT_HOLD_MS;
  return Math.max(MIN_SCENE_MS, spoken + hold);
}

export function estimateDurationMs(storyboard) {
  return (storyboard?.scenes || []).reduce((sum, s) => sum + estimateSceneMs(s), 0);
}

/** A stable id from a scene's own id, or s1, s2... when it has none. */
function sceneId(raw, index, used) {
  const base = filled(raw) && /^[a-z0-9][a-z0-9._-]*$/i.test(raw.trim())
    ? raw.trim().toLowerCase()
    : `s${index + 1}`;
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

/**
 * Fill in the defaults a storyboard may omit, without writing words it was not
 * given. Missing narration or caption stays missing: that is a validation
 * error, not something a helper should paper over.
 */
export function normalizeStoryboard(input, { fallbackTitle = 'Untitled video', voice = 'auto' } = {}) {
  if (!isObj(input)) throw new Error('a storyboard must be an object');
  const used = new Set();
  const scenes = (Array.isArray(input.scenes) ? input.scenes : []).map((raw, i) => {
    const s = isObj(raw) ? raw : {};
    const hold = Number(s.holdMs);
    const scene = {
      id: sceneId(s.id, i, used),
      narration: isStr(s.narration) ? s.narration.trim() : s.narration,
      caption: isStr(s.caption) ? s.caption.trim() : s.caption,
      visual: isObj(s.visual) ? { ...s.visual } : s.visual,
      holdMs: Number.isFinite(hold)
        ? Math.min(MAX_HOLD_MS, Math.max(MIN_HOLD_MS, Math.round(hold)))
        : DEFAULT_HOLD_MS,
      transition: TRANSITIONS.includes(s.transition) ? s.transition : 'cut',
    };
    return scene;
  });

  return {
    version: STORYBOARD_VERSION,
    title: filled(input.title) ? input.title.trim() : fallbackTitle,
    aspect: ASPECT_IDS.includes(input.aspect) ? input.aspect : DEFAULT_ASPECT,
    fps: FPS_VALUES.includes(Number(input.fps)) ? Number(input.fps) : DEFAULT_FPS,
    voice: filled(input.voice) ? input.voice.trim() : voice,
    music: 'none',
    scenes,
  };
}

/**
 * Report every reason a storyboard cannot be filmed. `bookPages` turns a page
 * visual that points past the end of a book into an error, because a scene
 * that cannot find its page is a black frame with a voice over it.
 */
export function validateStoryboard(input, { bookPages = null } = {}) {
  const errors = [];
  const warnings = [];

  if (!isObj(input)) return { ok: false, errors: ['storyboard is not an object'], warnings };
  if (!filled(input.title)) errors.push('missing title');
  if (input.aspect != null && !ASPECT_IDS.includes(input.aspect)) {
    errors.push(`unknown aspect "${input.aspect}". Known: ${ASPECT_IDS.join(', ')}`);
  }
  if (input.fps != null && !FPS_VALUES.includes(Number(input.fps))) {
    errors.push(`fps must be one of ${FPS_VALUES.join(', ')}`);
  }
  if (input.voice != null && !filled(input.voice)) errors.push('voice must be a name, or "auto"');
  if (input.music != null && input.music !== 'none') {
    errors.push('only music "none" is supported right now');
  }

  if (!Array.isArray(input.scenes) || !input.scenes.length) {
    errors.push('no scenes');
    return { ok: false, errors, warnings };
  }
  if (input.scenes.length > MAX_SCENES) {
    errors.push(`too many scenes (${input.scenes.length}); the limit is ${MAX_SCENES}`);
  }
  if (input.scenes.length < 3) warnings.push('a very short video. Three scenes or more gives an idea room.');
  if (input.scenes.length > 20) warnings.push('a lot of scenes. Consider cutting the least useful ones.');

  const ids = new Set();
  let pageScenes = 0;

  input.scenes.forEach((s, i) => {
    const at = `scene ${i + 1}`;
    if (!isObj(s)) { errors.push(`${at} is not an object`); return; }

    if (s.id != null) {
      if (!filled(s.id)) errors.push(`${at} has an empty id`);
      else if (ids.has(s.id)) errors.push(`duplicate scene id "${s.id}"`);
      else ids.add(s.id);
    }

    if (!filled(s.narration)) errors.push(`${at} has no narration`);
    else if (s.narration.length > MAX_NARRATION) {
      errors.push(`${at} narration is ${s.narration.length} characters; the limit is ${MAX_NARRATION}`);
    } else if (s.narration.trim().length < 12) {
      warnings.push(`${at} narration is very short; it may not say enough to film.`);
    } else if (s.narration.length > 260) {
      warnings.push(`${at} narration is long. One idea per scene reads better.`);
    }

    if (!filled(s.caption)) errors.push(`${at} has no caption`);
    else if (s.caption.length > MAX_CAPTION) {
      errors.push(`${at} caption is ${s.caption.length} characters; the limit is ${MAX_CAPTION}`);
    } else if (s.caption.length > 80) {
      warnings.push(`${at} caption is close to the limit and may wrap.`);
    }

    const v = s.visual;
    if (!isObj(v)) {
      errors.push(`${at} has no visual`);
    } else if (!VISUAL_KINDS.includes(v.kind)) {
      errors.push(`${at} has unknown visual kind "${v.kind}". Known: ${VISUAL_KINDS.join(', ')}`);
    } else if (v.kind === 'page') {
      pageScenes++;
      const n = Number(v.page);
      if (!Number.isInteger(n) || n < 1) errors.push(`${at} page must be a whole number of 1 or more`);
      else if (bookPages != null && n > bookPages) {
        errors.push(`${at} points at page ${n}, but the book has ${bookPages}`);
      }
    } else if (v.kind === 'figure') {
      if (!FIGURE_KINDS.includes(v.figure)) {
        errors.push(`${at} figure must be one of ${FIGURE_KINDS.join(', ')}`);
      }
    } else if (v.kind === 'diagram') {
      if (v.spec != null && !isObj(v.spec)) errors.push(`${at} diagram spec must be an object`);
      else if (v.spec == null && !DIAGRAM_KINDS.includes(v.shape)) {
        errors.push(`${at} diagram needs a shape (${DIAGRAM_KINDS.join(', ')}) or a spec`);
      }
    }

    if (s.holdMs != null) {
      const h = Number(s.holdMs);
      if (!Number.isFinite(h)) errors.push(`${at} holdMs is not a number`);
      else if (h < MIN_HOLD_MS || h > MAX_HOLD_MS) {
        errors.push(`${at} holdMs must be between ${MIN_HOLD_MS} and ${MAX_HOLD_MS}`);
      }
    }

    if (s.transition != null && !TRANSITIONS.includes(s.transition)) {
      errors.push(`${at} transition must be one of ${TRANSITIONS.join(', ')}`);
    }
  });

  if (bookPages != null && pageScenes === 0) {
    warnings.push('no scene shows a page from the book. This will be a video about the idea, not the book.');
  }

  return { ok: errors.length === 0, errors, warnings };
}
