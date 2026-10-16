#!/usr/bin/env node
/**
 * llm.mjs — one place that knows how to reach a language model.
 *
 * Used by draft-block.mjs (write me a page) and by the cockpit's draft button.
 * It has no dependencies and it never imports the UI.
 *
 * Three things this file exists to guarantee:
 *
 *   1. A paid provider can never be used by accident. `paid` is a property of the
 *      registry entry, not a judgement call at the call site, and resolve() throws
 *      unless the caller explicitly passes allowPaid.
 *   2. Nothing is auto-selected. If you do not name a provider you get the list,
 *      not a default that quietly spends money.
 *   3. Only the local providers are free forever. "Free tier" is labelled as
 *      exactly that, because those quotas can change without notice and it would
 *      be a lie to call them free.
 *
 * The registry is data, so adding a provider is one object, not new code paths.
 *
 *   import { listProviders, resolve, complete } from './llm.mjs';
 *   const p = resolve({ provider: 'ollama' });
 *   const text = await complete(p, { system, user });
 *
 * Model ids below are starting points, not truths. Providers rename models
 * constantly. Override with --model or the provider's *_MODEL env var; a 404
 * with a bad-model message will tell you so.
 */

import { requestKey } from './gen-ledger.mjs';

/* ---------------------------------------------------------------- the registry */

export const PROVIDERS = {
  /* ---- local. No key, no network bill, no quota. The only truly free ones. */
  ollama: {
    label: 'Ollama',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    baseUrlEnv: 'OLLAMA_BASE_URL',
    cost: 'local',
    key: null,
    model: 'llama3.1',
    modelEnv: 'OLLAMA_MODEL',
    blurb: 'Local models on this machine. Nothing leaves the building.',
  },
  lmstudio: {
    label: 'LM Studio',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    baseUrlEnv: 'LMSTUDIO_BASE_URL',
    cost: 'local',
    key: null,
    model: 'local-model',
    modelEnv: 'LMSTUDIO_MODEL',
    blurb: 'Local models via LM Studio. Start the server first.',
  },

  /* ---- free tier. A key, no card, but the quota is the provider\'s to change. */
  gemini: {
    label: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    cost: 'free-tier',
    key: 'GEMINI_API_KEY',
    model: 'gemini-2.0-flash',
    modelEnv: 'GEMINI_MODEL',
    blurb: 'Free tier, no card. Quota and model names can change.',
  },
  openrouter: {
    label: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    cost: 'free-tier',
    key: 'OPENROUTER_API_KEY',
    model: 'meta-llama/llama-3.3-70b-instruct',
    modelEnv: 'OPENROUTER_MODEL',
    blurb: 'One key, many models, some free. Some are not — pick free ones.',
  },
  groq: {
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    cost: 'free-tier',
    key: 'GROQ_API_KEY',
    model: 'llama-3.3-70b-versatile',
    modelEnv: 'GROQ_MODEL',
    blurb: 'Very fast, free tier with a daily cap.',
  },
  github: {
    label: 'GitHub Models',
    kind: 'openai',
    baseUrl: 'https://models.github.ai/inference',
    cost: 'free-tier',
    key: 'GITHUB_TOKEN',
    model: 'openai/gpt-4o',
    modelEnv: 'GITHUB_MODEL',
    blurb: 'Free tier with your GitHub token.',
  },
  mistral: {
    label: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    cost: 'free-tier',
    key: 'MISTRAL_API_KEY',
    model: 'mistral-small-latest',
    modelEnv: 'MISTRAL_MODEL',
    blurb: 'Free experimentation tier.',
  },

  /* ---- paid. Refused unless you pass allowPaid. */
  openai: {
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    cost: 'paid',
    key: 'OPENAI_API_KEY',
    model: 'gpt-4o-mini',
    modelEnv: 'OPENAI_MODEL',
    blurb: 'Bills every token. Needs --allow-paid.',
  },
  anthropic: {
    label: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    cost: 'paid',
    key: 'ANTHROPIC_API_KEY',
    model: 'claude-sonnet-4-5',
    modelEnv: 'ANTHROPIC_MODEL',
    blurb: 'Bills every token. Needs --allow-paid.',
  },
  xai: {
    label: 'xAI Grok',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    cost: 'paid',
    key: 'XAI_API_KEY',
    model: 'grok-2-latest',
    modelEnv: 'XAI_MODEL',
    blurb: 'Bills every token, and has no free tier at all. Needs --allow-paid.',
  },
};

export const PAID = Object.entries(PROVIDERS).filter(([, p]) => p.cost === 'paid').map(([id]) => id);

/** The one-sentence version of the money rule, used in every refusal message. */
const MONEY_NOTE =
  'The local providers (ollama, lmstudio) are free forever. The rest have free tiers ' +
  'whose quotas the provider can change. openai, anthropic and xai bill every token.';

/**
 * The registry, annotated with whether it is actually usable right now.
 * The cockpit shows this list so you can see which keys are set.
 */
export function listProviders(env) {
  env = env ?? (typeof process !== 'undefined' ? process.env : {});
  return Object.entries(PROVIDERS).map(([id, p]) => {
    const baseUrl = p.baseUrlEnv && env[p.baseUrlEnv] ? env[p.baseUrlEnv] : p.baseUrl;
    const missing = p.key && !env[p.key];
    return {
      id,
      label: p.label,
      kind: p.kind,
      cost: p.cost,
      blurb: p.blurb,
      baseUrl,
      model: (p.modelEnv && env[p.modelEnv]) || p.model,
      needsKey: p.key || null,
      ready: !missing,
      /* Why it is not ready, in words a person can act on. Both reasons when
         both apply, because a paid provider with no key needs fixing twice. */
      reason: [
        missing ? `set ${p.key}` : null,
        p.cost === 'paid' ? 'needs --allow-paid' : null,
      ].filter(Boolean).join(', ') || null,
    };
  });
}

/* ---------------------------------------------------------------- resolve */

/**
 * Turn a provider id into everything needed to make a request, or throw with a
 * message that says exactly what is missing.
 *
 * Throws on: unknown provider, paid-without-allowPaid, missing key.
 * Never guesses a provider when none was named.
 */
export function resolve({ provider, model, allowPaid = false, env } = {}) {
  env = env ?? (typeof process !== 'undefined' ? process.env : {});
  if (!provider) {
    const cheap = listProviders(env).filter((p) => p.cost !== 'paid').map((p) => p.id);
    throw new Error(
      'No provider named. Pass --provider <id>.\n' +
        `Free or free-tier: ${cheap.join(', ')}\n` +
        `Paid (needs --allow-paid): ${PAID.join(', ')}`
    );
  }

  const p = PROVIDERS[provider];
  if (!p) {
    throw new Error(
      `Unknown provider "${provider}". Known: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }

  /* The money gate. Before the key check, so a paid provider with no key still
     tells you it is paid rather than sending you off to sign up. */
  if (p.cost === 'paid' && !allowPaid) {
    throw new Error(
      `${p.label} bills every token, so this tool will not call it without permission.\n` +
        'Pass --allow-paid if you mean it, or use a free or local provider:\n' +
        `  free:  ${Object.entries(PROVIDERS).filter(([, q]) => q.cost !== 'paid').map(([i]) => i).join(', ')}\n` +
        `  ${MONEY_NOTE}`
    );
  }

  if (p.key && !env[p.key]) {
    throw new Error(
      `${p.label} needs an API key.\n` +
        `  set ${p.key} in your shell or in a .env file at the repo root.\n` +
        '  (Copy .env.example; it lists every provider.)'
    );
  }

  return {
    id: provider,
    label: p.label,
    kind: p.kind,
    cost: p.cost,
    baseUrl: (p.baseUrlEnv && env[p.baseUrlEnv]) || p.baseUrl,
    model: model || (p.modelEnv && env[p.modelEnv]) || p.model,
    apiKey: p.key ? env[p.key] : null,
  };
}

/* ---------------------------------------------------------------- request */

/** Pull the human-usable sentence out of a provider's error body. */
function explain(status, body) {
  const b = (body || '').slice(0, 400);
  if (status === 401 || status === 403) return 'the key was rejected. Check the key and that it is still active.';
  if (status === 429) return 'rate limited or out of quota. Free tiers are the usual cause; wait, or use another provider.';
  if (status === 404) return 'endpoint or model id not found. Model names change — override it with --model or the provider\'s *_MODEL env var.';
  if (status === 400) return `the provider rejected the request.\n${b}`;
  return `HTTP ${status}\n${b}`;
}

/**
 * One non-streaming completion. Returns the text.
 *
 * `fetchImpl` is injectable so the tests can exercise every code path above
 * without a network, a key, or a provider having an outage on a Tuesday.
 */
export async function complete(
  r,
  { system, user, temperature = 0.4, maxTokens = 4000, seed = null, signal, fetchImpl = fetch, cache = null }
) {
  if (!r?.baseUrl) throw new Error('complete() needs a resolved provider from resolve()');

  let url;
  let headers = { 'Content-Type': 'application/json' };
  let body;

  if (r.kind === 'openai') {
    url = `${r.baseUrl.replace(/\/$/, '')}/chat/completions`;
    headers.Authorization = `Bearer ${r.apiKey || 'local'}`;
    body = {
      model: r.model,
      messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
      temperature,
      max_tokens: maxTokens,
      stream: false,
      /* A seed a provider honours makes a page repeatable even off the cache.
         Only the OpenAI-shaped providers accept it; the others ignore it. */
      ...(seed != null ? { seed } : {}),
    };
  } else if (r.kind === 'gemini') {
    url = `${r.baseUrl.replace(/\/$/, '')}/models/${r.model}:generateContent`;
    headers['x-goog-api-key'] = r.apiKey;
    body = {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    };
  } else if (r.kind === 'anthropic') {
    url = `${r.baseUrl.replace(/\/$/, '')}/messages`;
    headers['x-api-key'] = r.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model: r.model,
      max_tokens: maxTokens,
      ...(system ? { system: system } : {}),
      messages: [{ role: 'user', content: user }],
      temperature,
    };
  } else {
    throw new Error(`unknown provider kind "${r.kind}"`);
  }

  /* The cache is keyed off the whole request, built here so it cannot drift from
     what is actually sent. A hit is returned without touching the network, which
     is what makes --replay work offline. In replay mode a miss throws from get. */
  const key = cache ? requestKey({ kind: r.kind, url, body }) : null;
  if (cache && key) {
    const hit = cache.get(key);
    if (hit != null) return hit;
  }

  const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${r.label} refused the request: ${explain(res.status, text)}`);
  }

  const json = await res.json();

  const text =
    r.kind === 'openai' ? json?.choices?.[0]?.message?.content
    : r.kind === 'gemini' ? json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('')
    : json?.content?.map((b) => b.text).join('');

  if (!text) {
    /* A refusal or a safety block comes back 200 with no text. Saying so beats
       writing an empty page into the book. */
    throw new Error(
      `${r.label} returned no text. It may have refused the request, or the response ` +
        'shape changed. Try a different provider or model.'
    );
  }
  if (cache && key) {
    cache.put(key, text, { provider: r.id, label: r.label, model: r.model, seed, temperature, maxTokens });
  }
  return text;
}

/* ---------------------------------------------------------------- cli */

const USAGE = `Usage: node engine/tools/llm.mjs [--provider <id>] [--model <id>] [--allow-paid]

  --provider <id>   ${Object.keys(PROVIDERS).join(' | ')}
  --model <id>      override the provider's default model
  --allow-paid      required before any paid provider will be called
  --list            print the registry and exit
`;

if (typeof process !== 'undefined' && process.argv?.[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const argv = process.argv.slice(2);
  const flag = (n) => {
    const i = argv.indexOf('--' + n);
    return i === -1 ? null : argv[i + 1];
  };
  if (argv.includes('--help') || argv.length === 0) {
    console.log(USAGE);
  } else if (argv.includes('--list')) {
    console.log(MONEY_NOTE + '\n');
    for (const p of listProviders()) {
      const mark = p.ready ? (p.cost === 'paid' ? 'paid' : 'ready') : p.reason;
      console.log(`  ${p.id.padEnd(11)} ${p.label.padEnd(16)} ${p.cost.padEnd(11)} ${mark}`);
      console.log(`  ${''.padEnd(11)} ${p.blurb}`);
    }
  } else {
    try {
      const r = resolve({
        provider: flag('provider'),
        model: flag('model'),
        allowPaid: argv.includes('--allow-paid'),
      });
      console.log(`would call ${r.label} — ${r.model} at ${r.baseUrl}`);
    } catch (e) {
      console.error('\n' + e.message + '\n');
      process.exit(1);
    }
  }
}