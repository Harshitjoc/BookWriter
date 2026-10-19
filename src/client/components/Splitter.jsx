import { useEffect, useRef, useState } from 'react';

/* The drag handle between two columns.
 *
 * It is a real `separator` for assistive tech: focusable, announced as a
 * vertical divider with the current width, and nudged with the arrow keys. A
 * pointer drag uses pointer capture, so a fast drag that leaves the handle —
 * even leaving the window — still tracks and still ends cleanly.
 *
 * It reports where the pointer IS, never a width. Only the cockpit knows what
 * the other columns cost and how little the middle may be left, so all the
 * clamping lives there, in one place. */
export default function Splitter({ label, value, min, max, onDrag, onNudge }) {
  const dragging = useRef(false);
  const [active, setActive] = useState(false);

  /* A pointerup can land anywhere, so the end of a drag is watched on the
     window rather than trusted to arrive on the handle. */
  useEffect(() => {
    if (!active) return undefined;
    const stop = () => {
      dragging.current = false;
      setActive(false);
      document.body.classList.remove('col-resizing');
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.classList.remove('col-resizing');
    };
  }, [active]);

  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging.current = true;
    setActive(true);
    document.body.classList.add('col-resizing');
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => { if (dragging.current) onDrag(e.clientX); };
  const up = (e) => {
    if (!dragging.current) return;
    dragging.current = false;
    setActive(false);
    document.body.classList.remove('col-resizing');
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const key = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); onNudge(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); onNudge(-1); }
  };

  return (
    <div
      className={'splitter' + (active ? ' active' : '')}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onKeyDown={key}
    >
      <span className="splitter-grip" aria-hidden="true" />
    </div>
  );
}
