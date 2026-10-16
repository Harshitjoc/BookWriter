import { useState } from 'react';
import * as api from '../api.js';

/* Export files without leaving the editor. Same scripts the command line runs
 * (export.mjs for the PDF, export-epub.mjs, export-web.mjs, export-card.mjs),
 * each writing its file into the book folder so the cockpit can link to it.
 *
 * Nothing here is a gate: if a page overflows, export.mjs still writes a PDF
 * that is wrong, because export is "give me the file" not "ship the book".
 * Shipping is publish.mjs, and that is the publish tab. */
const FORMATS = [
  { id: 'pdf', label: 'pdf', run: 'export', file: 'book.pdf' },
  { id: 'epub', label: 'epub', run: 'epub', file: 'book.epub' },
  { id: 'web', label: 'web (one file)', run: 'web', file: 'book-web.html' },
];

export default function ExportPanel({ book, onDone }) {
  const [formats, setFormats] = useState(['pdf']);
  const [pageNo, setPageNo] = useState('1');
  const [cardFormat, setCardFormat] = useState('html');
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState([]);
  const [error, setError] = useState('');

  const toggle = (id) =>
    setFormats((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  const go = async (tool, payload = {}) => {
    if (!book) return false;
    setBusy(tool);
    setError('');
    setLog([]);
    try {
      const res = await api.run(tool, book, {
        args: payload,
        onLine: (d) => setLog((l) => [...l, d.text]),
      });
      if (res.code !== 0) {
        setError(`${tool} failed with exit ${res.code}. Its own message is above.`);
        return false;
      }
      onDone?.();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy('');
    }
  };

  const exportSelected = async () => {
    for (const f of FORMATS.filter((x) => formats.includes(x.id))) {
      const ok = await go(f.run);
      if (!ok) return;   // a failure stops the batch where it is
    }
  };

  const card = () => go('card', { page: Number(pageNo) || 1, format: cardFormat });

  return (
    <div className="draft export">
      <p className="hint">
        The PDF is the page as designed. An EPUB reflows the book for a reader; the web
        export is one offline HTML file. Each is the built <code>book.html</code>, run
        through the engine&apos;s own exporter.
      </p>

      <div className="export-formats">
        {FORMATS.map((f) => (
          <label key={f.id} className="chip-ck">
            <input type="checkbox" checked={formats.includes(f.id)}
              onChange={() => toggle(f.id)} disabled={!!busy} />
            <span>{f.label}</span>
          </label>
        ))}
        <button className="mini primary" onClick={exportSelected}
          disabled={!!busy || !formats.length}>
          {busy ? 'exporting…' : `export ${formats.length} file${formats.length === 1 ? '' : 's'}`}
        </button>
      </div>

      <div className="draft-form card-form">
        <label>
          <span>one card, page</span>
          <input type="number" min="1" value={pageNo} onChange={(e) => setPageNo(e.target.value)} disabled={!!busy} />
        </label>
        <label>
          <span>format</span>
          <select value={cardFormat} onChange={(e) => setCardFormat(e.target.value)} disabled={!!busy}>
            <option value="html">html</option>
            <option value="png">png</option>
            <option value="md">md</option>
          </select>
        </label>
        <button className="mini" onClick={card} disabled={!!busy}>
          {busy === 'card' ? '…' : 'export card'}
        </button>
      </div>

      {error ? <p className="alert">{error}</p> : null}
      {log.length ? <pre className="draft-out">{log.join('\n')}</pre> : null}

      {formats.length && !busy ? (
        <div className="export-links">
          {FORMATS.filter((f) => formats.includes(f.id)).map((f) => (
            <a key={f.id} className="chip-link"
              href={`/preview/books/${book}/${f.file}`} target="_blank" rel="noreferrer">
              open {f.file} →
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}