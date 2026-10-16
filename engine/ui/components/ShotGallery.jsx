import { useEffect, useState } from 'react';

/* The step check cannot do: your eyes. One PNG per sheet, written by
   shot.mjs at 2x so 11px labels are readable. Click any page to open it big. */
export default function ShotGallery({ shots, onOpen }) {
  const [open, setOpen] = useState(null);

  useEffect(() => {
    const on = (e) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  if (!shots.length) {
    return (
      <div className="empty">
        <p>No screenshots yet.</p>
        <p className="dim">
          Press <b>shot</b>. It writes one PNG per page into the book folder.
        </p>
      </div>
    );
  }

  return (
    <div className="gallery">
      <p className="dim gallery-note">
        {shots.length} page{shots.length === 1 ? '' : 's'}. Look at these. The
        check cannot see overlap, a clipped label, or a photo cropped through its
        subject.
      </p>
      <div className="thumbs">
        {shots.map((s) => (
          <button
            key={s.page}
            className="thumb"
            onClick={() => { setOpen(s); onOpen?.(s.page); }}
            title={`page${s.page}.png · ${Math.round(s.bytes / 1024)} KB`}
          >
            <img src={`/preview/books/${s.book}/${s.file}?v=${s.mtime}`} alt={`Sheet ${s.page}`} loading="lazy" />
            <span>{s.page}</span>
          </button>
        ))}
      </div>

      {open ? (
        <div className="lightbox" onClick={() => setOpen(null)}>
          <img
            src={`/preview/books/${open.book}/${open.file}`}
            alt={`Sheet ${open.page}`}
            onClick={(e) => e.stopPropagation()}
          />
          <button className="mini close">close</button>
        </div>
      ) : null}
    </div>
  );
}