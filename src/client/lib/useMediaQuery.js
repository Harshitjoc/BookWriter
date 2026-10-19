import { useEffect, useState } from 'react';

/* Does the viewport match? The cockpit uses this to tell "all three columns fit"
 * — desktop, where the side panels can be collapsed and dragged — from "one pane
 * at a time" — narrow, where the pane switcher takes over. A CSS media query
 * already draws that line for the stylesheet; this is the same line for the
 * JavaScript that decides which columns and handles to render at all. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  ));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const m = window.matchMedia(query);
    const on = () => setMatches(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);

  return matches;
}

export default useMediaQuery;
