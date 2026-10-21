#!/usr/bin/env node
/**
 * voice.mjs — the anti-slop pass. Advisory, never a gate.
 *
 * A page can fit, pass contrast, and still read like a machine wrote it. The
 * tells are boring and specific: an em dash, a stripped contraction, "delve",
 * three sentences of exactly the same length. This module names them.
 *
 * It is a WARNING generator on purpose. Prose is a judgement call, and a linter
 * that failed a build over the word "robust" would be switched off within a day.
 * Every finding this returns is level "warn", so check.mjs --lint prints it and
 * exits 0 anyway. The human decides.
 *
 * Usage:
 *   node src/engine/tools/voice.mjs "some prose to scan"
 *   node src/engine/tools/voice.mjs --file pages.txt
 *
 * The same scanVoice() is called from lib/lint.mjs, so the cockpit shows these
 * next to the layout warnings.
 */

/* Each entry: a rule id, a RegExp, and a short human message. Matching is
   case-insensitive and word-bounded where a bare substring would false-positive. */
const CLICHES = [
  [/\bdelve(s|d|ing)?\b/i, 'delve — say "look at" or "start with"'],
  [/\bleverag(e|es|ed|ing)\b/i, 'leverage — say "use"'],
  [/\butilis(e|es|ed|ing)\b/i, 'utilise — say "use"'],
  [/\butiliz(e|es|ed|ing)\b/i, 'utilize — say "use"'],
  [/\bseamless(ly)?\b/i, 'seamless — say what actually happens'],
  [/\brobust\b/i, 'robust — say what it survives'],
  [/\bgame[- ]?changer\b/i, 'game-changer — say what changed'],
  [/\bunlock(s|ed|ing)?\b/i, 'unlock — say what you can now do'],
  [/\bjourney\b/i, 'journey — name the actual road'],
  [/\btapestry\b/i, 'tapestry — say what it is made of'],
  [/\bin today'?s world\b/i, '"in today\'s world" — cut it, start with the thing'],
  [/\bin the world of\b/i, '"in the world of" — cut it'],
  [/\bit'?s worth noting\b/i, '"it\'s worth noting" — just note it'],
  [/\bin conclusion\b/i, '"in conclusion" — end on the point instead'],
  [/\bat the end of the day\b/i, '"at the end of the day" — cut it'],
  [/\bnot only\b[^.]*\bbut also\b/i, '"not only … but also" — split the sentence'],
  [/\b(?:may|might|could)\s+(?:perhaps|possibly|potentially)\b/i, 'hedge stack — pick one hedge or none'],
  [/\bit could be argued\b/i, '"it could be argued" — say who argues it, or say it'],
];

const words = (text) => (text.match(/[\p{L}\p{N}']+/gu) || []);
const sentences = (text) =>
  (text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+/g) || []).map((s) => s.trim()).filter(Boolean);

/**
 * Scan one run of prose. Returns findings, each `{ rule, msg }`. All are
 * advisory; the caller attaches the level.
 */
export function scanVoice(text) {
  const src = String(text || '');
  const findings = [];
  const add = (rule, msg) => findings.push({ rule, msg });

  /* Em dash: the single loudest tell. (An en dash in a range like 9–5 is fine;
     the AND the em dash is what reads as machine-composed.) */
  const em = (src.match(/—/g) || []).length;
  if (em) add('voice-em-dash', `${em} em dash${em > 1 ? 'es' : ''} — use a comma or a full stop`);

  /* Banned, hollow words. */
  for (const [re, msg] of CLICHES) if (re.test(src)) add('voice-cliche', msg);

  /* Hastily-stripped verbs: a book written by a machine forgets contractions. */
  const stripped = src.match(/\b(it is|you are|do not|does not|is not|cannot|will not|we are|they are)\b/gi) || [];
  if (stripped.length >= 3) {
    add('voice-no-contractions', `${stripped.length} uncontracted verbs — "it is"/"do not" read as machine text (use it's/don't)`);
  }

  /* Exclamation marks: a builder does not shout. */
  const bangs = (src.match(/!/g) || []).length;
  if (bangs) add('voice-exclaim', `${bangs} exclamation mark${bangs > 1 ? 's' : ''} — dial it down`);

  const sents = sentences(src);
  if (sents.length >= 5) {
    /* Uniform length: five flat sentences in a row is a machine rhythm. */
    const lens = sents.map((s) => words(s).length).filter((n) => n > 0);
    if (lens.length >= 5) {
      const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
      const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
      if (sd < 2.5) add('voice-flat-rhythm', `sentences all run about ${Math.round(mean)} words — vary the length (odd sentence counts read human)`);
    }
    /* Repeated opener: two sentences starting the same way. */
    for (let i = 1; i < sents.length; i++) {
      const a = words(sents[i])[0]?.toLowerCase();
      const b = words(sents[i - 1])[0]?.toLowerCase();
      if (a && a === b) { add('voice-repeat-opener', `two sentences in a row start with "${a}"`); break; }
    }
  }

  return findings;
}

/* --------------------------------------------------------------- CLI */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const fs = await import('node:fs');
  const fileFlag = process.argv.indexOf('--file');
  const text = fileFlag !== -1
    ? fs.readFileSync(process.argv[fileFlag + 1], 'utf8')
    : process.argv.slice(2).filter((a) => !a.startsWith('--') && process.argv[process.argv.indexOf(a) - 1] !== '--file').join(' ');
  const found = scanVoice(text);
  if (!found.length) console.log('clean — nothing machine-sounding found');
  else for (const f of found) console.log(`  ! ${f.rule}: ${f.msg}`);
}
