import { useState } from 'react';
import * as api from '../lib/api.js';

/* Publish is the one command that ships a book, and it is a GATE, not a
 * convenience. The engine (publish.mjs) runs: no open facts -> build -> every
 * page 0 mm -> the deep pass -> pixels (if approved) -> the exports you name.
 * It stops at the first failure and exports nothing. There is no override, and
 * this panel does not add one. */
const FORMATS = ['pdf', 'epub', 'web'];

export default function PublishPanel({ book, editions, onDone }) {
  const [formats, setFormats] = useState(['pdf', 'epub', 'web']);
  const [edition, setEdition] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [error, setError] = useState('');

  const toggle = (id) =>
    setFormats((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  const go = async () => {
    if (busy || !book) return;
    setBusy(true);
    setError('');
    setLog([]);
    try {
      const res = await api.run('publish', book, {
        edition: edition || undefined,
        args: { formats },
        onLine: (d) => setLog((l) => [...l, d.text]),
      });
      if (res.code !== 0) {
        setError(`publish stopped. Nothing was exported. The gate's own message is above.`);
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
    <div className="draft publish">
      <p className="hint">
        One command, hard gate, no override: facts → build → 0 mm → deep pass → pixels
        (if approved) → the exports you name. <b>Nothing is written until every check
        passes</b>, so publish is safe to click as often as you like.
      </p>

      {editions.length ? (
        <label className="pub-edition">
          <span>edition</span>
          <select value={edition} onChange={(e) => setEdition(e.target.value)} disabled={busy}>
            <option value="">full book</option>
            {editions.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>
      ) : null}

      <div className="export-formats">
        {FORMATS.map((f) => (
          <label key={f} className="chip-ck">
            <input type="checkbox" checked={formats.includes(f)}
              onChange={() => toggle(f)} disabled={busy} />
            <span>{f}</span>
          </label>
        ))}
        <button className="mini primary" onClick={go} disabled={busy || !formats.length}>
          {busy ? 'publishing…' : 'publish'}
        </button>
      </div>

      {error ? <p className="alert">{error}</p> : null}
      {log.length ? <pre className="draft-out">{log.join('\n')}</pre> : null}
    </div>
  );
}