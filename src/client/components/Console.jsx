import { useEffect, useRef } from 'react';

/* The tool's own words, streamed in as they are produced. Nothing is
   summarised or prettied: this is stdout and stderr, so what you read here is
   exactly what you would have seen in the terminal. */
export default function Console({ lines, onClear }) {
  const end = useRef(null);

  useEffect(() => {
    /* block:'nearest' so a new line scrolls the console without yanking the
       whole cockpit to it. */
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [lines]);

  return (
    <div className="console">
      <div className="console-bar">
        <span className="dim">stdout and stderr, live</span>
        <button className="mini" onClick={onClear}>clear</button>
      </div>
      {/* role="log" is the right shape for a console: appended lines, read in
          order, announced politely rather than interrupting. */}
      <div className="console-body" role="log" aria-label="tool output" aria-live="polite">
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