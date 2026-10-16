import { useEffect, useRef } from 'react';

/* The tool's own words, streamed in as they are produced. Nothing is
   summarised or prettied: this is stdout and stderr, so what you read here is
   exactly what you would have seen in the terminal. */
export default function Console({ lines, onClear }) {
  const end = useRef(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  return (
    <div className="console">
      <div className="console-bar">
        <span className="dim">stdout and stderr, live</span>
        <button className="mini" onClick={onClear}>clear</button>
      </div>
      <div className="console-body">
        {lines.length === 0 ? (
          <p className="dim console-empty">Nothing yet. Run a step above.</p>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={'cline ' + l.kind}>
              {l.tool ? <span className="cline-tool">{l.tool}</span> : null}
              {l.text}
            </div>
          ))
        )}
        <div ref={end} />
      </div>
    </div>
  );
}