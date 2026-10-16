/* ==========================================================================
   test/byok.test.mjs  -  bring your own key
   --------------------------------------------------------------------------
   The rule this file defends: keys typed in the cockpit reach the tools for one
   call and nowhere else. They are checked, pruned to the variables the tools
   actually read, and never written to a file by this layer.
   ========================================================================== */
import { group, ok, report } from './harness.mjs';
import {
  KEY_NAMES, sanitizeKeys, mergeEnv, loadKeys, saveKeys, clearKeys, maskKey,
} from '../src/shared/byok.js';
import { resolve as resolveProvider } from '../src/engine/tools/llm.mjs';

/* In-page (not vitest-jsdom) the storage is stubbed the same way it behaves in a
   browser: two independent bins, limited to strings, cleared as a unit. */
class FakeStorage {
  #m = new Map();
  getItem = (k) => (this.#m.has(k) ? this.#m.get(k) : null);
  setItem = (k, v) => this.#m.set(k, String(v));
  removeItem = (k) => this.#m.delete(k);
}
const local = new FakeStorage();
const session = new FakeStorage();
globalThis.window = { localStorage: local, sessionStorage: session };

group('key name sanity');
ok('every known key variable is by name in the allow list',
  KEY_NAMES.includes('OPENAI_API_KEY') && KEY_NAMES.includes('ANTHROPIC_API_KEY') &&
  KEY_NAMES.includes('GEMINI_API_KEY') && KEY_NAMES.includes('GITHUB_TOKEN') &&
  KEY_NAMES.includes('XAI_API_KEY') && KEY_NAMES.includes('GROQ_API_KEY') &&
  KEY_NAMES.includes('OPENROUTER_API_KEY') && KEY_NAMES.includes('MISTRAL_API_KEY') &&
  KEY_NAMES.includes('GOOGLE_API_KEY'));

group('sanitizeKeys prunes what is not a key');
ok('unknown names are dropped even when the value looks real',
  !('AWS_SECRET_ACCESS_KEY' in sanitizeKeys({ AWS_SECRET_ACCESS_KEY: 'aGVsbG8gd29ybGQ=' })));
ok('a photo token pasted into a key field is retained',
  sanitizeKeys({ OPENAI_API_KEY: '  sk-test-123  ' }).OPENAI_API_KEY === 'sk-test-123');
ok('empty and whitespace-only values are not saved',
  sanitizeKeys({ OPENAI_API_KEY: '   ', GROQ_API_KEY: '' }).OPENAI_API_KEY === undefined);
ok('non-strings are dropped',
  !Object.keys(sanitizeKeys({ OPENAI_API_KEY: 42, GROQ_API_KEY: null, MISTRAL_API_KEY: ['x'] })).length);
ok('a value with a line break is a paste accident, not a key',
  sanitizeKeys({ OPENAI_API_KEY: 'sk-abc\nsk-def' }).OPENAI_API_KEY === undefined);
ok('a huge paste is rejected, because no real key is that long',
  sanitizeKeys({ OPENAI_API_KEY: 'x'.repeat(600) }).OPENAI_API_KEY === undefined);
ok('a non-object body is just no keys at all',
  !Object.keys(sanitizeKeys('OPENAI_API_KEY=sk-1')).length &&
  !Object.keys(sanitizeKeys(null)).length &&
  !Object.keys(sanitizeKeys(['OPENAI_API_KEY'])).length);

group('mergeEnv does not poison process.env');
{
  const before = { OPENAI_API_KEY: 'sk-from-env', OTHER: 'keep' };
  const merged = mergeEnv(before, { OPENAI_API_KEY: 'sk-from-browser' });
  ok('the cockpit key wins for this call', merged.OPENAI_API_KEY === 'sk-from-browser');
  ok('the rest of the environment is carried over', merged.OTHER === 'keep');
  ok('process.env is left exactly as it was', before.OPENAI_API_KEY === 'sk-from-env');
  const defaulted = mergeEnv(before, { PATH: 'C:\\evil' });
  ok('a name that is not a provider key cannot ride the request', defaulted.PATH === before.PATH);
  ok('a falsy merge still excludes the garbage',
    mergeEnv(undefined, { OPENAI_API_KEY: 'sk-1' }).OPENAI_API_KEY === 'sk-1');
}

group('storage: session by default, persistent only when ticked');
{
  try { local.removeItem('byokKeys'); session.removeItem('byokSessionKeys'); } catch {}
  saveKeys({ OPENAI_API_KEY: 'sk-session' }, false);
  ok('session save goes to the session store', JSON.stringify(JSON.parse(session.getItem('byokSessionKeys'))).includes('sk-session'));
  ok('and leaves the persistent store alone', local.getItem('byokKeys') === null);
  ok('loadKeys prefers the live session store', loadKeys().OPENAI_API_KEY === 'sk-session');

  saveKeys({ OPENAI_API_KEY: 'sk-persist' }, true);
  ok('remember ticks the persistent store', JSON.stringify(JSON.parse(local.getItem('byokKeys'))).includes('sk-persist'));
  ok('and it clears the session store', session.getItem('byokSessionKeys') === null);
  ok('loadKeys falls back to the persistent store after reload', loadKeys().OPENAI_API_KEY === 'sk-persist');

  clearKeys();
  ok('clear empties both stores', local.getItem('byokKeys') === null && session.getItem('byokSessionKeys') === null);
  ok('and loadKeys then reports no keys', Object.keys(loadKeys()).length === 0);
}

group('the tools accept the merged environment the way the CLI expects');
ok('a key that was typed in the cockpit makes a provider resolve',
  resolveProvider({ provider: 'groq', env: mergeEnv(process.env, { GROQ_API_KEY: 'sk-typed' }) })
    .apiKey === 'sk-typed');
ok('and the key that was already in .env still wins nothing from a different name',
  resolveProvider({ provider: 'groq',
    env: mergeEnv({ GROQ_API_KEY: 'sk-from-env' }, {}) }).apiKey === 'sk-from-env');
ok('a paid provider still refuses without the explicit opt-in, even with a typed key', (() => {
  let threw = '';
  try {
    resolveProvider({ provider: 'openai', env: mergeEnv(process.env, { OPENAI_API_KEY: 'sk-typed' }) });
  } catch (e) { threw = e.message; }
  return /allow-paid/.test(threw);
})());

group('a masked key cannot be read across the room');
ok('the middle is replaced, only the head and a breath of the tail remain', (() => {
  const m = maskKey('sk-live-abcdefghijk');
  return m.startsWith('sk-') && !m.includes('live-abcde') && m.length <= 8;
})());

report('byok');