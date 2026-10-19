import { useBoard } from '../lib/useBoard.js';

/* The dashboard: one glance at what the book is and what it is missing.
 *
 * It reads /api/board, which derives everything from the interior SOURCE file,
 * so the numbers are live while you edit — no build required. Facts are the
 * open questions; unlisted pages are pages that will not print. */
export default function DashboardPanel({ book, onPickPage }) {
  const { board, error, loading, reload } = useBoard(book);

  if (!book) return <p className="hint">Pick a book to open its dashboard.</p>;

  if (error) {
    return (
      <div className="dash">
        <p className="alert" role="alert">{error}</p>
        <div className="draft-actions">
          <button className="mini primary" onClick={reload}>try again</button>
        </div>
      </div>
    );
  }

  if (!board) return <p className="hint">{loading ? 'reading the book…' : 'no dashboard yet'}</p>;

  const t = board.totals;
  const unlisted = t.pages - t.listed;
  const missing = board.pages.filter((p) => !p.diagram && !p.photo).length;

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h2>{board.title}</h2>
          <p className="dim">{board.author ? `${board.author} · ` : ''}{board.theme} · {board.size} trim{board.editions.length ? ` · editions: ${board.editions.join(', ')}` : ''}</p>
        </div>
        <button className="mini" onClick={reload} disabled={loading}>{loading ? '…' : 'refresh'}</button>
      </div>

      <div className="dash-cards">
        <div className={'dash-card' + (t.facts ? ' bad' : ' ok')}>
          <b>{t.facts}</b><span>open facts</span>
          {t.facts ? <button className="mini" onClick={() => onPickPage?.(board.pages.find((p) => p.facts)?.n)}>find them</button> : null}
        </div>
        <div className={'dash-card' + (unlisted ? ' warn' : ' ok')}>
          <b>{unlisted}</b><span>pages not in book.json</span>
        </div>
        <div className="dash-card">
          <b>{t.diagrams}</b><span>diagrams</span>
        </div>
        <div className="dash-card">
          <b>{t.photos}</b><span>photos</span>
        </div>
        <div className={'dash-card' + (missing ? ' warn' : ' ok')}>
          <b>{missing}</b><span>pages with no picture</span>
        </div>
        <div className="dash-card">
          <b>{t.listed} / {t.pages}</b><span>pages in the book</span>
        </div>
      </div>

      <div className="dash-artifacts">
        <span className="dash-label">already shipped</span>
        {board.artifacts?.pdf ? <span className="chip">book.pdf</span> : null}
        {board.artifacts?.epub ? <span className="chip">book.epub</span> : null}
        {board.artifacts?.web ? <span className="chip">book-web.html</span> : null}
        {!board.artifacts?.pdf && !board.artifacts?.epub && !board.artifacts?.web
          ? <span className="dim">nothing yet — use the publish tab</span> : null}
      </div>

      <table className="dash-parts">
        <thead>
          <tr><th>part</th><th>pages</th><th>blocks</th></tr>
        </thead>
        <tbody>
          {board.parts.map((p) => (
            <tr key={p.name}>
              <td>{p.name}</td>
              <td className="num">{p.pages}</td>
              <td className="num">{p.blocks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}