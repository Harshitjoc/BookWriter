import { useMemo, useState } from 'react';
import { KEY_NAMES, loadKeys, saveKeys, clearKeys, maskKey } from '../../shared/byok.js';

/* The keys tab. Every paid or quota-bound provider the engine knows about gets
 * one row, and the user pastes the key next to it. The defaults are the
 * defensible ones: keys live for this tab only, never on disk. Opting into
 * localStorage is the way to keep them between sessions.
 *
 * The panel shows only masked values back, so a machine it shares cannot be
 * read from across the room. It never sends anything anywhere except the
 * "save" click's storage write: key values only leave the browser inside a
 * draft or image request, and that goes to this repo's own server. */

const PROVIDER_OF = {
  GEMINI_API_KEY: 'Google Gemini',
  OPENROUTER_API_KEY: 'OpenRouter',
  GROQ_API_KEY: 'Groq',
  GITHUB_TOKEN: 'GitHub Models',
  MISTRAL_API_KEY: 'Mistral',
  OPENAI_API_KEY: 'OpenAI (paid)',
  ANTHROPIC_API_KEY: 'Anthropic (paid)',
  XAI_API_KEY: 'xAI Grok (paid)',
  GOOGLE_API_KEY: 'Gemini image fallback',
};

export default function KeysPanel() {
  const stored = useMemo(() => loadKeys(), []);
  const [values, setValues] = useState(() => {
    const seed = {};
    for (const name of KEY_NAMES) seed[name] = stored[name] || '';
    return seed;
  });
  const [remember, setRemember] = useState(() => {
    try { return !window.localStorage.getItem('byokKeys') ? false : true; } catch { return false; }
  });
  const [savedAt, setSavedAt] = useState(null);

  const persist = (nextValues, nextRemember) => {
    const ready = {};
    for (const [k, v] of Object.entries(nextValues)) if (v && v.trim()) ready[k] = v.trim();
    saveKeys(ready, nextRemember);
    setSavedAt(new Date());
  };

  return (
    <div className="draft">
      <p className="hint">
        Bring your own key. Anything you enter here overrides <code>.env</code> for the next
        draft or image request and nothing else. Keys are not written anywhere by this
        page unless you tick the box below, and they are never shown back once set.
      </p>

      <div className="draft-form" style={{ flexDirection: 'column' }}>
        {KEY_NAMES.map((name) => (
          <label key={name}>
            <span title={PROVIDER_OF[name] || name}>
              {PROVIDER_OF[name] || name}
              {stored[name] && values[name] === stored[name] ? (
                <em className="dim" style={{ fontStyle: 'normal' }}> · saved ({maskKey(stored[name])})</em>
              ) : null}
            </span>
            <input
              type="password"
              autoComplete="off"
              spellCheck="false"
              placeholder={`set ${name}`}
              value={values[name]}
              onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
              onBlur={(e) => persist({ ...values, [name]: e.target.value }, remember)}
            />
          </label>
        ))}
      </div>

      <label className="paid-warn" style={{ borderColor: 'var(--line)', background: 'transparent' }}>
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => { setRemember(e.target.checked); persist(values, e.target.checked); }}
        />
        <span>
          <strong>Remember these on this machine.</strong> Off means the keys last for this tab,
          and nothing is written to disk.
        </span>
      </label>

      <div className="draft-actions">
        <button className="mini" onClick={() => persist(values, remember)}>save keys</button>
        <button
          className="mini"
          onClick={() => {
            clearKeys();
            const blank = {};
            for (const name of KEY_NAMES) blank[name] = '';
            setValues(blank);
            setSavedAt(new Date());
          }}
        >
          clear everything
        </button>
        {savedAt ? <span className="dim">saved</span> : null}
      </div>

      <p className="hint">
        The default providers need no key at all: Ollama and LM Studio run locally on your
        machine, and the image tool's default is the Antigravity CLI, which signs in with
        your Google account. Keys are only ever needed for the cloud providers.
      </p>
    </div>
  );
}