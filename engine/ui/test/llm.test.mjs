/* ==========================================================================
   test/llm.test.mjs  -  the provider layer, with no network at all
   --------------------------------------------------------------------------
   Everything here injects a fake fetch. No key, no provider, no outage, no
   cost, and the suite still passes on a plane. That is the point: if this
   suite ever needs a real provider to be green, it has stopped being a test.
   ========================================================================== */
import { listProviders, resolve, complete, PROVIDERS, PAID } from '../../tools/llm.mjs';
import { ok, group, report } from './harness.mjs';

/* A fake fetch that records the call and returns a canned body per kind. */
function fakeFetch(kind, { status = 200, body } = {}) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, opts, payload: JSON.parse(opts.body) });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      json: async () => body,
    };
  };
  impl.calls = calls;
  return impl;
}

const envWith = (extra = {}) => ({ ...process.env, ...extra });

group('the registry');
ok('every provider is described', Object.keys(PROVIDERS).length >= 10, `${Object.keys(PROVIDERS).length} providers`);
ok('exactly three are paid', PAID.length === 3, PAID.join(', '));
ok('both local providers need no key',
  PROVIDERS.ollama.key === null && PROVIDERS.lmstudio.key === null);
ok('every paid provider is also keyed', PAID.every((id) => PROVIDERS[id].key));
ok('every provider has a default model and a blurb',
  Object.values(PROVIDERS).every((p) => p.model && p.blurb));
ok('every provider has an env var for its model',
  Object.values(PROVIDERS).every((p) => p.modelEnv));

group('availability is reported honestly');
const listed = listProviders(envWith({}));
ok('a provider with no key reports which key is missing',
  listed.find((p) => p.id === 'openai').reason === 'set OPENAI_API_KEY, needs --allow-paid',
  listed.find((p) => p.id === 'openai').reason);
ok('a local provider is ready with no key at all', listed.find((p) => p.id === 'ollama').ready);
ok('a keyed provider becomes ready once the key is set',
  listProviders(envWith({ OPENAI_API_KEY: 'sk-x' })).find((p) => p.id === 'openai').ready);
ok('a free-tier provider is not reported as ready without a key',
  !listProviders(envWith({})).find((p) => p.id === 'gemini').ready);

group('nothing is auto-selected');
try {
  resolve({});
  ok('naming no provider throws', false);
} catch (e) {
  ok('naming no provider throws', true);
  ok('and it lists the free ones', /ollama/.test(e.message) && /gemini/.test(e.message));
  ok('and it says which ones cost money', /--allow-paid/.test(e.message));
}

group('the money gate');
const paidError = (id) => {
  try {
    resolve({ provider: id, allowPaid: false, env: envWith({ [PROVIDERS[id].key]: 'sk-test' }) });
    return null;
  } catch (e) {
    return e.message;
  }
};
for (const id of PAID) {
  const msg = paidError(id);
  ok(`${id} is refused without --allow-paid`, !!msg && /--allow-paid/.test(msg));
  ok(`${id} explains what free costs`, !!msg && /free forever/i.test(msg));
}
ok('a paid provider with no key still complains about the cost first',
  /--allow-paid/.test(
    (() => { try { resolve({ provider: 'xai' }); return ''; } catch (e) { return e.message; } })()
  ));
ok('xai is called out as having no free tier at all',
  /no free tier/.test(PROVIDERS.xai.blurb));
ok('a paid provider is allowed once --allow-paid is passed',
  !!resolve({ provider: 'openai', allowPaid: true, env: envWith({ OPENAI_API_KEY: 'sk-test' }) }));

group('free and local providers need no permission');
ok('ollama resolves with an empty environment',
  !!resolve({ provider: 'ollama', env: {} }));
ok('a free-tier provider only needs its key',
  !!resolve({ provider: 'gemini', env: { GEMINI_API_KEY: 'k' } }));
ok('a missing free-tier key names the variable',
  (() => {
    try { resolve({ provider: 'groq', env: {} }); return false; }
    catch (e) { return /GROQ_API_KEY/.test(e.message); }
  })());

group('base urls and models are overridable');
ok('a local base url can be moved',
  resolve({ provider: 'ollama', env: { OLLAMA_BASE_URL: 'http://box:11434/v1' } }).baseUrl
    === 'http://box:11434/v1');
ok('the model can be overridden per call',
  resolve({ provider: 'ollama', model: 'qwen2.5:7b', env: {} }).model === 'qwen2.5:7b');
ok('the model can be overridden by env',
  resolve({ provider: 'ollama', env: { OLLAMA_MODEL: 'mistral-nemo' } }).model === 'mistral-nemo');

group('the request shapes are right, and nothing is sent');
{
  const r = resolve({ provider: 'ollama', env: {} });
  const f = fakeFetch('openai', { body: { choices: [{ message: { content: 'a page' } }] } });
  const text = await complete(r, { system: 'voice', user: 'write it', fetchImpl: f });
  ok('an OpenAI-compatible call returns the text', text === 'a page');
  ok('it posts to /chat/completions', f.calls[0].url === 'http://127.0.0.1:11434/v1/chat/completions', f.calls[0].url);
  ok('it does not stream', f.calls[0].payload.stream === false);
  ok('the system prompt is a system message', f.calls[0].payload.messages[0].role === 'system');
  ok('local providers still get an auth header rather than none',
    f.calls[0].opts.headers.Authorization === 'Bearer local');
}
{
  const f = fakeFetch('gemini', { body: { candidates: [{ content: { parts: [{ text: 'gemini page' }] } }] } });
  const text = await complete(resolve({ provider: 'gemini', env: { GEMINI_API_KEY: 'k' } }),
    { system: 'voice', user: 'write it', fetchImpl: f });
  ok('a Gemini call returns the text', text === 'gemini page');
  ok('it posts to the model endpoint',
    f.calls[0].url === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    f.calls[0].url);
  ok('it sends the key as a header, not in the url', f.calls[0].opts.headers['x-goog-api-key'] === 'k');
  ok('it sends the system prompt as systemInstruction',
    f.calls[0].payload.systemInstruction.parts[0].text === 'voice');
}
{
  const f = fakeFetch('anthropic', { body: { content: [{ text: 'claude page' }] } });
  const text = await complete(resolve({ provider: 'anthropic', allowPaid: true, env: { ANTHROPIC_API_KEY: 'k' } }),
    { system: 'voice', user: 'write it', fetchImpl: f });
  ok('an Anthropic call returns the text', text === 'claude page');
  ok('it posts to /messages', f.calls[0].url === 'https://api.anthropic.com/v1/messages');
  ok('it pins an api version', f.calls[0].opts.headers['anthropic-version'] === '2023-06-01');
  ok('it sets a max_tokens, which Anthropic requires',
    typeof f.calls[0].payload.max_tokens === 'number' && f.calls[0].payload.max_tokens > 0);
  ok('the system prompt goes in its own field', f.calls[0].payload.system === 'voice');
}

group('errors are explained, not dumped');
{
  const f = fakeFetch('openai', { status: 401, body: { error: 'invalid api key' } });
  let msg = '';
  try {
    await complete(resolve({ provider: 'ollama', env: {} }), { user: 'x', fetchImpl: f });
  } catch (e) { msg = e.message; }
  ok('a rejected key says so', /key was rejected/i.test(msg), msg.split('\n')[0]);
}
{
  const f = fakeFetch('openai', { status: 429, body: 'rate limited' });
  let msg = '';
  try {
    await complete(resolve({ provider: 'ollama', env: {} }), { user: 'x', fetchImpl: f });
  } catch (e) { msg = e.message; }
  ok('a rate limit mentions quota and a way out', /quota/i.test(msg) && /wait|another provider/i.test(msg));
}
{
  const f = fakeFetch('openai', { status: 404, body: 'no such model' });
  let msg = '';
  try {
    await complete(resolve({ provider: 'ollama', env: {} }), { user: 'x', fetchImpl: f });
  } catch (e) { msg = e.message; }
  ok('a bad model id tells you how to override it', /--model/.test(msg), msg.split('\n')[0]);
}
{
  /* A refusal comes back 200 with no text. Writing that into a page would be
     an empty page, so it has to be an error. */
  const f = fakeFetch('openai', { body: { choices: [{ message: { content: '' } }] } });
  let msg = '';
  try {
    await complete(resolve({ provider: 'ollama', env: {} }), { user: 'x', fetchImpl: f });
  } catch (e) { msg = e.message; }
  ok('an empty completion is an error, not an empty page', /returned no text/i.test(msg));
}

group('guards');
try {
  await complete({}, { user: 'x', fetchImpl: fakeFetch('openai', {}) });
  ok('complete() refuses an unresolved provider', false);
} catch (e) {
  ok('complete() refuses an unresolved provider', /resolved provider/.test(e.message));
}
ok('complete() refuses before it makes a request',
  await (async () => {
    const f = fakeFetch('openai', {});
    await complete({}, { user: 'x', fetchImpl: f }).catch(() => {});
    return f.calls.length === 0;
  })());

report('llm');