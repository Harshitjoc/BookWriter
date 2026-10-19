import { useBoard } from '../lib/useBoard.js';

/* The board: a map of the book read from its interior SOURCE. One row per page
 * with its part, and whether it carries a diagram, a photograph, or an open
 * [FACT NEEDED] marker. It is live while you edit — it does not wait for a build
 * — so it answers "what is this book made of, and what is still unknown?".
 *
 * A page that is authored but not listed in book.json is flagged: it exists in
 * the file but will not appear in the book. That is the most common quiet
 * mistake, so the board makes it loud. */
export default function BoardPanel({ book, onPickPage }) {
  const { board, error, loading, reload } = useBoard(book);

  if (!book) return <p className="hint">Pick a book to see its board.</p>;

  if (error) {
    /* A panel that can only ever show its own failure, with no way back, is a
       dead end. The retry is the point. */
    return (
      <div className="board">
        <p className="alert" role="alert">{error}</p>
        <div className="draft-actions">
          <button className="mini primary" onClick={reload}>try again</button>
        </div>
      </div>
    );
  }

  if (!board) return <p className="hint">{loading ? 'reading the book…' : 'no board yet'}</p>;

  const t = board.totals;

  return (
    <div className="board">
      <div className="board-stats">
        <span className="board-stat"><b>{t.pages}</b> pages</span>
        <span className={'board-stat' + (t.listed < t.pages ? ' warn' : '')}>
          <b>{t.listed}</b> listed
        </span>
        <span className="board-stat"><b>{t.diagrams}</b> diagrams</span>
        <span className="board-stat"><b>{t.photos}</b> photos</span>
        <span className={'board-stat' + (t.facts ? ' bad' : ' ok')}>
          <b>{t.facts}</b> facts needed
        </span>
        <button className="mini" onClick={reload} disabled={loading}>{loading ? '…' : 'refresh'}</button>
      </div>

      <table className="board-table">
        <caption className="dim">one row per page in the interior file</caption>
        <thead>
          <tr><th>#</th><th>title</th><th>part</th><th>mark</th></tr>
        </thead>
        <tbody>
          {board.pages.map((p) => (
            <tr
              key={p.n}
              className={p.listed ? '' : 'unlisted'}
              onClick={() => onPickPage?.(p.n)}
              /* A row you can only reach with a mouse is a row half the people
                 at the keyboard will never find. */
              tabIndex={0}
              aria-label={`page ${p.n}: ${p.title || 'untitled'}${p.listed ? '' : ', not listed in book.json'}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickPage?.(p.n); }
              }}
              title={p.listed ? 'in book.json' : 'not listed in book.json — it will not print'}
            >
              <td className="num">{p.n}</td>
              <td>{p.title || <span className="dim">untitled</span>}</td>
              <td className="dim">{p.part || '—'}</td>
              <td className="marks">
                {p.diagram ? <span className="mark-d" title="has a diagram">svg</span> : null}
                {p.photo ? <span className="mark-p" title="has a photo">img</span> : null}
                {p.facts ? <span className="mark-f" title={p.factTexts.join('; ')}>{p.facts} fact</span> : null}
                {!p.listed ? <span className="mark-u" title="not in book.json">unlisted</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
