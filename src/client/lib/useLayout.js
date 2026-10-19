import { useCallback, useEffect, useState } from 'react';

/* The cockpit's side panels: whether each is open, and how wide the middle is
 * allowed to leave them. A layout you set once should survive a reload, so it
 * lives in localStorage — this is a preference, not session state.
 *
 * Everything read back is clamped. A stored value can be anything at all (an
 * older build, a hand-edit, a different window size), and a panel wider than
 * the window has no way back. */

export const LAYOUT_KEY = 'proofpress.layout';

export const EDIT_MIN = 240;
export const EDIT_MAX = 560;
export const OUT_MIN = 260;
export const OUT_MAX = 600;

/* The middle column never goes below this, whatever the sides ask for. */
export const PREVIEW_MIN = 340;

const DEFAULTS = { editOpen: true, editW: 320, outOpen: true, outW: 330 };

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(n)));

function read() {
  if (typeof localStorage === 'undefined') return DEFAULTS;
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return DEFAULTS;
    return {
      editOpen: raw.editOpen !== false,
      outOpen: raw.outOpen !== false,
      editW: clamp(Number(raw.editW) || DEFAULTS.editW, EDIT_MIN, EDIT_MAX),
      outW: clamp(Number(raw.outW) || DEFAULTS.outW, OUT_MIN, OUT_MAX),
    };
  } catch {
    /* Corrupt JSON is not worth a message: defaults are always a safe answer. */
    return DEFAULTS;
  }
}

export function useLayout() {
  const [layout, setLayout] = useState(read);

  useEffect(() => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); }
    catch { /* private mode, or a full store: the layout still works for this session */ }
  }, [layout]);

  const setEditOpen = useCallback((open) => setLayout((l) => ({ ...l, editOpen: !!open })), []);
  const setOutOpen = useCallback((open) => setLayout((l) => ({ ...l, outOpen: !!open })), []);
  const setEditW = useCallback((w) => setLayout((l) => ({ ...l, editW: clamp(w, EDIT_MIN, EDIT_MAX) })), []);
  const setOutW = useCallback((w) => setLayout((l) => ({ ...l, outW: clamp(w, OUT_MIN, OUT_MAX) })), []);
  const toggleEdit = useCallback(() => setLayout((l) => ({ ...l, editOpen: !l.editOpen })), []);
  const toggleOut = useCallback(() => setLayout((l) => ({ ...l, outOpen: !l.outOpen })), []);

  return { layout, setEditOpen, setOutOpen, setEditW, setOutW, toggleEdit, toggleOut };
}

export default useLayout;
