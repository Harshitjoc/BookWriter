/**
 * plan-storyboard.mjs — one LLM call that turns a topic (or a book) into a
 * validated storyboard for make-video.mjs.
 *
 *   const { storyboard, validation } = await planStoryboard({
 *     topic: 'How a CDN works', scenes: 8, aspect: '16:9',
 *     provider: 'ollama', pages: 6,
 *   });
 *
 * This module only plans. It does not draw, speak, or encode anything, and it
 * never writes to a book. The planner is allowed to name only the visuals the
 * engine already knows how to draw: a page from the book, a figure
 * (figures.mjs), a diagram (diagram.mjs), or the title card. Nothing it returns
 * is trusted until validateStoryboard() has read it.
 */
import { resolve as resolveProvider, complete } from './llm.mjs';
import { extractJson } from './plan-from-source.mjs';
import { FIGURE_KINDS } from './figures.mjs';
import { KINDS as DIAGRAM_KINDS } from './diagram.mjs';
import {
  ASPECT_IDS, DEFAULT_ASPECT, MIN_SCENES, MAX_SCENES,
  normalizeStoryboard, validateStoryboard,
} from '../../shared/storyboard.js';

export const STORYBOARD_SYSTEM = `You are the storyboard editor of a small-press book studio.

You turn one idea into a short explainer video. The video is built from scenes.
Each scene has words that are spoken, words that are shown, and one drawing.
The drawing is made by the engine from a name you choose — never by you.

Output ONE valid JSON object. Nothing before it. Nothing after it. No fences.

JSON shape:
{
  "title": "a short title for the video",
  "aspect": "16:9",
  "scenes": [
    {
      "id": "open",
      "narration": "what the narrator says, in one or two spoken sentences",
      "caption": "the short line shown on screen",
      "visual": { "kind": "title" },
      "holdMs": 800,
      "transition": "fade"
    }
  ]
}

Visual kinds, and what each one needs:
  - "title"     the opening card. No extra fields.
  - "page"      a real page from the book. "page": a page number.
  - "figure"    an engine-drawn figure. "figure": one of ${FIGURE_KINDS.join(', ')}.
  - "diagram"   an engine-drawn mechanism. "shape": one of ${DIAGRAM_KINDS.join(', ')}.

A figure or diagram is drawn from its shape alone: the video does not put invented
labels on it. When the exact words matter, use a "page" scene instead.

Rules:
- Open on a "title" scene. Close on the action or the point, not on a summary.
- One idea per scene. Four to twelve scenes is a good video.
- The narration is spoken. Write it the way a person talks: plain, second
  person, short sentences. Do not read the caption aloud word for word.
- The caption is shown on screen. Keep it under 80 characters. It can be
  shorter and sharper than the narration.
- holdMs is the quiet beat after the line, from 0 to 8000. It is not the
  duration of the scene; the voice decides that.
- transition is "cut", "fade" or "draw".
- Never invent a fact, a number, a date, a version, a quote, or an anecdote.
  If the source does not support it, do not say it. Prefer fewer, truer scenes.
- Output JSON only.`.trim();

export function clampScenes(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 8;
  return Math.min(MAX_SCENES, Math.max(MIN_SCENES, v));
}

/**
 * One provider call → a normalized, validated storyboard.
 *  env/signal/fetchImpl are injectable so tests never touch a network.
 */
export async function planStoryboard({
  topic = '', source = '', title = '', voice = 'auto', scenes = 8,
  aspect = DEFAULT_ASPECT, pages = null, provider, model, allowPaid = false,
  signal, fetchImpl, env = process.env, lang = null, dir = null, extraBrief = '',
}) {
  if (!String(topic).trim() && !String(source).trim()) {
    throw new Error('a topic or a source is required');
  }
  if (aspect != null && !ASPECT_IDS.includes(aspect)) {
    throw new Error(`unknown aspect "${aspect}". Known: ${ASPECT_IDS.join(', ')}`);
  }

  const r = resolveProvider({ provider, model, allowPaid, env });
  const target = clampScenes(scenes);
  const bookPages = Number.isInteger(pages) && pages > 0 ? pages : null;

  const user = [
    `VIDEO TITLE: ${title || topic || 'infer it from the source'}`,
    `NUMBER OF SCENES: exactly ${target}`,
    `ASPECT: ${aspect || DEFAULT_ASPECT}`,
    `NARRATOR: ${voice || 'auto'}`,
    bookPages
      ? `THE BOOK HAS ${bookPages} PAGES. Every "page" visual must be between 1 and ${bookPages}.`
      : 'There is no book: use "figure", "diagram" and "title" visuals, not "page".',
    '',
    `TOPIC OR DIRECTION: ${topic || 'infer the best focus from the source'}`,
    '',
    lang ? `LANGUAGE: write the title, every narration and every caption in ${lang}${dir ? ` (${dir})` : ''}. Keep proper nouns, versions and numbers exactly as the source has them.` : '',
    extraBrief || '',
    '',
    String(source).trim()
      ? 'SOURCE MATERIAL FOLLOWS. Do not invent anything that is not supported by it.\n---\n' + source
      : 'There is no source material. Plan only what the topic itself supports, and make the open fact explicit instead of guessing it.',
  ].join('\n');

  const text = await complete(r, { system: STORYBOARD_SYSTEM, user, signal, fetchImpl });
  const raw = extractJson(text);
  if (!raw) throw new Error('the model did not return a storyboard as JSON');

  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('the storyboard planner returned broken JSON'); }

  const storyboard = normalizeStoryboard(parsed, {
    fallbackTitle: title || topic || 'Untitled video',
    voice: voice || 'auto',
  });
  const check = validateStoryboard(storyboard, { bookPages });

  if (!check.ok) {
    throw new Error(`the storyboard did not validate: ${check.errors.join('; ')}`);
  }
  if (storyboard.scenes.length !== target) {
    check.warnings.push(
      `asked for ${target} scene(s), planned ${storyboard.scenes.length}. Nothing was invented to make up the difference.`,
    );
  }

  return { storyboard, validation: check };
}
