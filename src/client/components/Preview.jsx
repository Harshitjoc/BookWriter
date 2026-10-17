import { useEffect, useRef, useState } from 'react';

/* The real built book.html, in an iframe, served raw off disk by /preview.
   Nothing here re-renders or re-implements a page: if it looks right here it is
   right, because it is the same bytes export.mjs will turn into the PDF.

   Zoom lives HERE, not in App: it is a property of this viewport and nothing
   else reads it. (It used to be a prop with no setter passed down, which meant
   dragging the slider threw. If you find yourself wanting to lift something to
   App, check it is actually read by App.) */
export default function Preview({ book, edition, refreshKey, built }) {
  const [nonce, setNonce] = useState(0);
  /* Default at 100% for full view; slider still allows zooming (min 0.3, step 0.05). */
  const [zoom, setZoom] = useState(1.0);
  const [trim, setTrim] = useState(null);
  const frame = useRef(null);

  const target = edition
    ? `/preview/books/${book}/book-${edition}.html?v=${refreshKey}.${nonce}`
    : `/preview/books/${book}/book.html?v=${refreshKey}.${nonce}`;

  /* Read the trim off the rendered book instead of hardcoding "176 x 250 mm".
     A book on A5 or 6x9 must not be described here as B5, so ask the page. */
  const onLoad = () => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    const cs = getComputedStyle(doc.documentElement);
    const w = cs.getPropertyValue('--page-w').trim();
    const h = cs.getPropertyValue('--page-h').trim();
    setTrim(w && h ? `${w} × ${h}` : null);
  };

  useEffect(() => {
    const on = (e) => {
      if (e.key === 'r' && (e.ctrlKey || e.metaKey) === false && e.target === document.body) {
        setNonce((x) => x + 1);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  return (
    <div className="preview">
      <div className="preview-bar">
        <span className="preview-label">
          {edition ? `book-${edition}.html` : 'book.html'}
        </span>
        <span className="preview-note">
          served raw · {trim || 'measuring…'} · same bytes as the PDF
        </span>
        <div className="preview-tools">
          <input
            className="zoom"
            type="range"
            min="0.3"
            max="1.6"
            step="0.05"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            title="Preview scale"
          />
          <span className="zoom-val">{Math.round(zoom * 100)}%</span>
          <button className="mini" onClick={() => setNonce((x) => x + 1)} title="Reload the preview from disk">
            reload
          </button>
        </div>
      </div>

      <div className="preview-frame">
        {/* Three states, because each one used to be a silent failure:
            no book chosen  -> book is '' for one tick while the list loads
            chosen, unbuilt -> book.html does not exist yet. Pointing an iframe
                               at it 404s, logs a console error and shows a
                               blank frame. Say so, and say what to do.
            built           -> the real thing. */}
        {!book ? (
          <p className="dim preview-wait">choose a book</p>
        ) : !built ? (
          <div className="preview-wait">
            <p><strong>not built yet.</strong></p>
            <p className="dim">
              this book has no <code>book.html</code> on disk. run <strong>build</strong> and it
              will appear here.
            </p>
          </div>
        ) : (
          <iframe
            ref={frame}
            title="Book preview"
            src={target}
            onLoad={onLoad}
            style={{ width: `${zoom * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}