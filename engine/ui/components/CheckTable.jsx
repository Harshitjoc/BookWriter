/* The real numbers from check.mjs --json. Not scraped text: the tool measures
   every sheet in a browser and this renders exactly what it measured. A page
   is only done when its overMm reads 0.
 *
 * The cockpit asks for the deep pass too, so this also renders the lint
 * findings: text on text, an SVG label with no fill, a colour that fails on
 * paper. A page can fit and still be wrong, and those are the two columns. */
export default function CheckTable({ result, onPickPage }) {
  if (!result) {
    return (
      <div className="empty">
        <p>No check has run yet.</p>
        <p className="dim">
          Press <b>check</b>. It opens the book in a real browser, waits for the
          fonts, measures how far each page runs past the bottom edge, and reads
          each page for the mistakes that still fit.
        </p>
      </div>
    );
  }

  const { rows = [], overflowing = [], broken = [], unstyled, ready, lint } = result;
  const maxOver = Math.max(0, ...rows.map((r) => r.overMm));
  const fits = !unstyled && broken.length === 0 && overflowing.length === 0;

  const findings = lint?.pages?.flatMap((p) => p.findings.map((f) => ({ ...f, page: p.page, title: p.title }))) || [];
  const lintErrors = findings.filter((f) => f.level === 'error');
  const lintWarnings = findings.filter((f) => f.level === 'warn');

  return (
    <div className="check">
      <div className={'verdict ' + (fits ? 'ok' : 'bad')}>
        <span className="mark">{fits ? '✓' : '✗'}</span>
        <div>
          <strong>{fits ? 'All pages fit' : 'Not ready'}</strong>
          <p className="dim">
            {rows.length} sheets, max {maxOver} mm over
            {broken.length ? ` · ${broken.length} broken image(s)` : ''}
            {unstyled ? ' · stylesheet did not load' : ''}
          </p>
        </div>
      </div>

      {unstyled ? (
        <p className="alert">
          The stylesheet was not applied, which almost always means the book
          folder is not exactly two levels deep. Every page links ../../engine/…
        </p>
      ) : null}

      {broken.length ? (
        <p className="alert">
          Broken images: {broken.map((b) => <code key={b}>{b}</code>)}
        </p>
      ) : null}

      {overflowing.length ? (
        <p className="alert">
          {overflowing.length} page(s) overflow. Cut words. Do not shrink the
          diagram viewBox, which clips the drawing instead of fixing it.
        </p>
      ) : null}

      <table className="rows">
        <thead>
          <tr>
            <th className="n">page</th>
            <th>sheet</th>
            <th className="num">over</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.page}
              className={r.overMm > 0 ? 'bad' : ''}
              onClick={() => onPickPage?.(r.page)}
              title="Show this sheet in the preview"
            >
              <td className="n">{r.page}</td>
              <td className="title">{r.title}</td>
              <td className="num">
                {r.overMm > 0 ? <span className="over">+{r.overMm}mm</span> : <span className="zero">0</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {lint ? (
        <div className="lint">
          <div className={'lint-head ' + (lintErrors.length ? 'bad' : 'ok')}>
            {lintErrors.length === 0 && lintWarnings.length === 0
              ? 'deep pass: clean'
              : `deep pass: ${lintErrors.length} error(s), ${lintWarnings.length} warning(s)`}
          </div>
          {lintErrors.length === 0 && lintWarnings.length === 0 ? (
            <p className="dim">No overlapping text, no missing fills, nothing starved or invisible.</p>
          ) : null}
          <ul className="findings">
            {[...lintErrors, ...lintWarnings].map((f, i) => (
              <li
                key={i}
                className={f.level === 'error' ? 'bad' : 'warn'}
                onClick={() => onPickPage?.(f.page)}
                title="Show this sheet in the preview"
              >
                <span className="mark">{f.level === 'error' ? '✗' : '!'}</span>
                <span className="where">p{f.page}</span>
                <span className="what">{f.msg}</span>
              </li>
            ))}
          </ul>
          {lintErrors.length || lintWarnings.length ? (
            <p className="dim">
              A warning is a question, not a verdict. An error means it will look
              wrong in print.
            </p>
          ) : null}
        </div>
      ) : null}

      {!ready && fits ? <p className="alert">Deep-pass errors above. The pages fit; they do not pass.</p> : null}
    </div>
  );
}
