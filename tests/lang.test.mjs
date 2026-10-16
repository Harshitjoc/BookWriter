/* ==========================================================================
   test/lang.test.mjs  -  language, direction and script font packs
   --------------------------------------------------------------------------
   The rule this file defends, same as format.test.mjs: a book that says nothing
   about its language must build to exactly the bytes it always did. Everything
   the language feature adds is opt-in, and the first two groups are what would
   catch it if that stopped being true.

   Groups:
     1. lib/locale.mjs, as pure functions — no build, no disk.
     2. the fontPacks registry and the pack stylesheets it points at.
     3. a book that names no language is byte-identical to the starter.
     4. lang / dir reach <html>, and an explicit dir always wins.
     5. a named font pack is linked, and only then.
     6. the RTL fixes are injected for rtl and for nothing else.
     7. a bad lang, a bad dir or an unknown pack is refused, not guessed.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { group, ok, report, cli, scratchBook, cleanStale, ROOT } from './harness.mjs';
import { RTL_LANGS, normalizeLang, dirForLang, resolveDirection, hasLocale } from '../src/engine/tools/lib/locale.mjs';

const DEFAULTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'engine', 'defaults.json'), 'utf8'));
cleanStale('langnone', 'langfr', 'langar', 'langzh', 'langdir', 'langmix',
  'langfont1', 'langfont2', 'langbadpack', 'langbadlang', 'langbaddir',
  'langar2', 'langrtl', 'langltr');
const PACK_IDS = Object.keys(DEFAULTS.fontPacks || {}).filter((k) => !k.startsWith('$'));

const build = (slug) => cli('build-book.mjs', `books/${slug}`);
const read = (slug) => fs.readFileSync(path.join(ROOT, 'books', slug, 'book.html'), 'utf8');
const htmlTag = (html) => (html.match(/<html\b[^>]*>/) || [''])[0];
const check = (slug) => {
  const r = cli('check.mjs', path.join('books', slug, 'book.html'), '--json');
  let json = null;
  try { json = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch { /* reported below */ }
  return { ...r, json };
};

/* ------------------------------------------------------------------ 1. locale */
group('locale.mjs resolves a language to a direction, with no surprises');
ok('a missing lang is null', normalizeLang(undefined) === null && normalizeLang(null) === null);
ok('a blank lang is null', normalizeLang('') === null && normalizeLang('   ') === null);
ok('a tag is trimmed and kept', normalizeLang('  fr  ') === 'fr');
ok('a script subtag survives', normalizeLang('zh-Hans') === 'zh-Hans');
ok('a region subtag survives', normalizeLang('ar-EG') === 'ar-EG');
ok('a malformed tag throws, rather than silently doing nothing',
  (() => { try { normalizeLang('english!'); return false; } catch { return true; } })());
ok('a bare number throws', (() => { try { normalizeLang('12'); return false; } catch { return true; } })());

ok('the RTL languages resolve to rtl',
  ['ar', 'he', 'fa', 'ur', 'ps', 'yi'].every((l) => dirForLang(l) === 'rtl'));
ok('an RTL tag with a region resolves on its primary subtag', dirForLang('ar-EG') === 'rtl');
ok('Latin and CJK scripts resolve to ltr',
  ['en', 'fr', 'de', 'es', 'zh-Hans', 'ja', 'ko', 'hi', 'th'].every((l) => dirForLang(l) === 'ltr'));

ok('no lang and no dir means "change nothing"', resolveDirection({}) === null);
ok('a lang alone implies its direction',
  resolveDirection({ lang: 'ar' }) === 'rtl' && resolveDirection({ lang: 'en' }) === 'ltr');
ok('an explicit dir overrides the language',
  resolveDirection({ lang: 'he', dir: 'ltr' }) === 'ltr' &&
  resolveDirection({ lang: 'en', dir: 'rtl' }) === 'rtl');
ok('dir "auto" is passed through', resolveDirection({ dir: 'auto' }) === 'auto');
ok('a bad dir throws', (() => { try { resolveDirection({ dir: 'sideways' }); return false; } catch { return true; } })());
ok('hasLocale is false only when nothing is asked', !hasLocale({}) && hasLocale({ lang: 'en' }) && hasLocale({ dir: 'rtl' }));
ok('the RTL set is the exported one', RTL_LANGS.has('ar') && RTL_LANGS.has('he'));

/* ------------------------------------------------------- 2. the pack registry */
group('every advertised font pack has a real stylesheet that rides the themes');
ok('there are packs to advertise', PACK_IDS.length >= 9, PACK_IDS.join(','));
ok('every pack has a label, a file, scripts and a note',
  PACK_IDS.every((id) => {
    const p = DEFAULTS.fontPacks[id];
    return p && typeof p.label === 'string' && typeof p.file === 'string' &&
      Array.isArray(p.scripts) && p.scripts.length && typeof p.note === 'string';
  }));
ok('every pack stylesheet exists',
  PACK_IDS.every((id) => fs.existsSync(path.join(ROOT, 'src', 'engine', 'fonts', DEFAULTS.fontPacks[id].file))),
  PACK_IDS.filter((id) => !fs.existsSync(path.join(ROOT, 'src', 'engine', 'fonts', DEFAULTS.fontPacks[id].file))).join(','));
ok('every pack is under src/engine/fonts/packs/',
  PACK_IDS.every((id) => DEFAULTS.fontPacks[id].file.startsWith('packs/')));
ok('every pack stylesheet rides under the two theme family names',
  PACK_IDS.every((id) => {
    const css = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'fonts', DEFAULTS.fontPacks[id].file), 'utf8');
    return /font-family:\s*'Inter'/.test(css) && /font-family:\s*'Space Grotesk'/.test(css);
  }));
ok('every pack stylesheet carries a unicode-range, so Latin is untouched',
  PACK_IDS.every((id) =>
    /unicode-range:/.test(fs.readFileSync(path.join(ROOT, 'src', 'engine', 'fonts', DEFAULTS.fontPacks[id].file), 'utf8'))));
ok('no pack stylesheet names a Google family directly (it serves the theme families)',
  PACK_IDS.every((id) => !/font-family:\s*'Noto/.test(
    fs.readFileSync(path.join(ROOT, 'src', 'engine', 'fonts', DEFAULTS.fontPacks[id].file), 'utf8'))));

/* ------------------------------------------------- 3. says nothing = untouched */
group('a book that says nothing about language is byte-identical to the starter');
{
  const b = scratchBook('langnone');
  try {
    const r = build(b.slug);
    ok('it builds', r.code === 0, r.stderr.split('\n')[0]);
    const html = read(b.slug);
    ok('its <html> tag is the one it shipped with', htmlTag(html) === '<html lang="en" data-size="b5">', htmlTag(html));
    ok('it carries no dir attribute', !/<html\b[^>]*\bdir=/.test(html));
    ok('it links no font pack', !/fonts\/packs\//.test(html));
    ok('it injects no RTL rules', !/html\[dir="rtl"\]/.test(html));
    ok('the built bytes match books/starter exactly',
      html === fs.readFileSync(path.join(ROOT, 'books', 'starter', 'book.html'), 'utf8'));
  } finally { b.drop(); }
}

/* -------------------------------------------------------- 4. lang/dir reach <html> */
group('lang and dir reach <html>, and an explicit dir always wins');
for (const [slug, patch, tag, must] of [
  ['langfr', { lang: 'fr' }, '<html dir="ltr" lang="fr" data-size="b5">', true],
  ['langar', { lang: 'ar' }, '<html dir="rtl" lang="ar" data-size="b5">', true],
  ['langzh', { lang: 'zh-Hans' }, '<html dir="ltr" lang="zh-Hans" data-size="b5">', true],
  ['langdir', { dir: 'rtl' }, '<html dir="rtl" lang="en" data-size="b5">', true],
  ['langmix', { lang: 'he', dir: 'ltr' }, '<html dir="ltr" lang="he" data-size="b5">', true],
]) {
  const b = scratchBook(slug, patch);
  try {
    const r = build(slug);
    ok(`${slug}: builds`, r.code === 0, r.stderr.split('\n')[0]);
    const html = read(slug);
    ok(`${slug}: <html> reads ${tag}`, htmlTag(html) === tag, htmlTag(html));
    /* The attribute is added to the existing tag, never a second one. */
    ok(`${slug}: there is still exactly one <html> tag`, (html.match(/<html\b/g) || []).length === 1);
    ok(`${slug}: the tag carries at most one dir attribute`, (htmlTag(html).match(/\bdir=/g) || []).length <= 1);
    ok(`${slug}: the head is otherwise intact`, /themes\/studio\.css/.test(html) && /<title>/.test(html));
  } finally { b.drop(); }
}
{
  /* A language book still measures its own trim: the direction does not change
     whether the page fits. */
  const b = scratchBook('langar2', { lang: 'ar' });
  try {
    build('langar2');
    const c = check('langar2');
    ok('an RTL book still fits B5', c.json?.ready === true,
      c.json?.overflowing?.map((o) => `+${o.overMm}mm`).join(',') || c.stderr.split('\n')[0]);
  } finally { b.drop(); }
}

/* ------------------------------------------------------- 5. font packs get linked */
group('a named font pack is linked, and only the packs that are named');
for (const [slug, fonts] of [
  ['langfont1', ['arabic']],
  ['langfont2', ['cjk-sc', 'hebrew', 'cyrillic']],
]) {
  const b = scratchBook(slug, { lang: fonts[0] === 'arabic' ? 'ar' : 'zh-Hans', fonts });
  try {
    const r = build(slug);
    ok(`${slug}: builds`, r.code === 0, r.stderr.split('\n')[0]);
    const html = read(slug);
    for (const id of fonts) {
      ok(`${slug}: links fonts/packs/${id}/pack.css`,
        html.includes(`src/engine/fonts/${DEFAULTS.fontPacks[id].file}`), DEFAULTS.fontPacks[id].file);
    }
    const linked = (html.match(/fonts\/packs\/([a-z-]+)\/pack\.css/g) || []);
    ok(`${slug}: links exactly the packs named`, linked.length === fonts.length, linked.join(' '));
    /* The link sits inside <head>, before the inline generated-pages <style>. */
    ok(`${slug}: the pack link is in the head`,
      html.indexOf('fonts/packs/') < html.indexOf('<style>'));
  } finally { b.drop(); }
}

/* ------------------------------------------------- 6. RTL fixes only when rtl */
group('the RTL fixes are injected for rtl and for nothing else');
{
  const ar = scratchBook('langrtl', { lang: 'ar' });
  const fr = scratchBook('langltr', { lang: 'fr' });
  try {
    build('langrtl'); build('langltr');
    ok('an RTL book carries the dir="rtl" fixes', /html\[dir="rtl"\]/.test(read('langrtl')));
    ok('an LTR language book carries none', !/html\[dir="rtl"\]/.test(read('langltr')));
  } finally { ar.drop(); fr.drop(); }
}

/* ------------------------------------------------------------- 7. refused, not guessed */
group('a bad lang, a bad dir or an unknown pack is refused, not guessed');
{
  const bad = scratchBook('langbadlang', { lang: 'english!' });
  try {
    const r = build('langbadlang');
    ok('a malformed lang stops the build', r.code === 1);
    ok('and it asks for a BCP-47 tag', /BCP-47/.test(r.stderr), r.stderr.replace(/\s+/g, ' ').slice(0, 90));
    ok('and nothing was written', !fs.existsSync(path.join(bad.dir, 'book.html')));
  } finally { bad.drop(); }
}
{
  const bad = scratchBook('langbaddir', { dir: 'sideways' });
  try {
    const r = build('langbaddir');
    ok('a bad dir stops the build', r.code === 1);
    ok('and it names the three it understands', /"ltr"/.test(r.stderr) && /"rtl"/.test(r.stderr) && /"auto"/.test(r.stderr));
  } finally { bad.drop(); }
}
{
  const bad = scratchBook('langbadpack', { lang: 'ar', fonts: ['klingon'] });
  try {
    const r = build('langbadpack');
    ok('an unknown font pack stops the build', r.code === 1);
    ok('and it lists the packs that exist', /Known:/.test(r.stderr) && /arabic/.test(r.stderr));
    ok('and nothing was written', !fs.existsSync(path.join(bad.dir, 'book.html')));
  } finally { bad.drop(); }
}

report('lang');
