import { useState } from 'react';
import * as api from '../lib/api.js';

/* Generate a photograph with gen-image.mjs, the same script `npm run image` runs.
 *
 * The rule this panel exists to respect: a diagram is inline SVG, never a
 * generated image. Only reach for this when the subject is a physical thing you
 * could put a camera on. The hint says so every time the panel is open. */
export default function ImagePanel({ book, onDone }) {
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');
  const [aspect, setAspect] = useState('3:2');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [error, setError] = useState('');

  const go = async () => {
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setError('');
    setLog([]);
    try {
      const res = await api.run(
        'image',
        book,
        {
          args: { prompt, name: name || undefined, aspect },
          onLine: (d) => setLog((l) => [...l, d.text]),
        }
      );
      if (res.code !== 0) {
        setError('the generator did not produce an image. Its own message is above.');
      } else {
        onDone?.();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="draft">
      <p className="hint">
        Photographs only, for things you could point a camera at. A diagram is inline SVG
        written by hand — never a generated image.
      </p>
      <p className="hint">
        The default is the <code>agy</code> CLI on this machine, which signs in with your
        Google account and needs no key. For the Gemini image API instead, put your
        <code> GEMINI_API_KEY</code> in the keys tab.
      </p>

      <div className="draft-form">
        <label className="grow">
          <span>what should the camera see?</span>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="a coiled fibre bundle on a white desk, top down"
            disabled={busy}
            onKeyDown={(e) => { if (e.key === 'Enter' && prompt.trim()) go(); }}
          />
        </label>
        <label>
          <span>filename</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="photo.jpg" disabled={busy} />
        </label>
        <label>
          <span>aspect</span>
          <select value={aspect} onChange={(e) => setAspect(e.target.value)} disabled={busy}>
            {['3:2', '4:3', '1:1', '16:9', '2:3'].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>

      <div className="draft-actions">
        <button className="mini primary" onClick={go} disabled={busy || !prompt.trim()}>
          {busy ? 'generating…' : 'generate'}
        </button>
      </div>

      {error ? <p className="alert">{error}</p> : null}
      {log.length ? <pre className="draft-out">{log.join('\n')}</pre> : null}
    </div>
  );
}