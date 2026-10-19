import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api.js';

/* One book's board, with the two hard things every caller was getting wrong by
 * hand.
 *
 * The board is derived from the interior SOURCE file, so the numbers are live
 * while you edit — no build required. Two panels show it, the board table and
 * the dashboard, and both used to carry their own copy of the same load, the
 * same race guard and the same unmount cleanup. Copies drift; this is the one
 * place a stale answer can be dropped. */
export function useBoard(book) {
  /* The board, its error and its loading flag all belong to ONE book. Tagging
     them with the book they came from means a board you have already left is
     simply not current: no reset effect, and never a moment where the old
     numbers answer the new question. */
  const [state, setState] = useState({ book: null, board: null, error: '', loading: false });
  /* Two loads in flight must not race: the slower one used to win and leave a
     board from a book you had already left. */
  const ticket = useRef(0);

  const reload = useCallback(async () => {
    if (!book) return;
    const mine = ++ticket.current;
    setState({ book, board: null, error: '', loading: true });
    try {
      const board = await api.getBoard(book);
      if (mine !== ticket.current) return;
      setState({ book, board, error: '', loading: false });
    } catch (e) {
      if (mine !== ticket.current) return;
      setState({ book, board: null, error: e.message, loading: false });
    }
  }, [book]);

  useEffect(() => { reload(); }, [reload]);

  /* Unmounting must not let a late answer write into it. */
  useEffect(() => () => { ticket.current++; }, []);

  const live = state.book === book
    ? state
    : { board: null, error: '', loading: Boolean(book) };
  return { board: live.board, error: live.error, loading: live.loading, reload };
}

export default useBoard;
