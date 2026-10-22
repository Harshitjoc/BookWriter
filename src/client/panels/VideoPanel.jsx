import { useEffect, useRef, useState } from 'react';
import * as api from '../lib/api.js';
import { estimateDurationMs } from '../../shared/storyboard.js';

/* Film the plan that is already on disk.
 *
 * This panel is the cockpit's side of make-video.mjs: it does not draw a frame
 * itself, and it cannot invent a scene. It reads books/<slug>/storyboard.json,
 * lets a person choose the voice and the size, then runs the same CLI the
 * command line runs. The output is always books/<slug>/video/<slug>.mp4, a
 * gitignored file, so filming never edits the book.
 *
 * A plan that does not validate is shown with its reasons and cannot be
 * filmed. The engine would refuse it anyway; saying so here is kinder than a
 * child process that dies halfway through a render. */

/* An empty width means the aspect's native size: 1920x1080 for 16:9, but
   1080x1920 for a vertical film. Forcing 1920 on a portrait plan would render
   it at twice its intended height for no gain. */
const WIDTHS = [
  { id: '', label: 'full (native)' },
  { id: '1280', label: '1280 wide' },
  { id: '640', label: '640 wide' },
  { id: '320', label: 'draft (320)' },
];

const fmt = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function VideoPanel({ book, onStoryboard }) {
  const [board, setBoard] = useState(null);
  const [validation, setValidation] = useState(null);
  const [pages, setPages] = useState(null);
  const [loadError, setLoadError] = useState('');

  const [voice, setVoice] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [sfx, setSfx] = useState(false);
  const [width, setWidth] = useState('');

  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState('');
  const [log, setLog] = useState([]);
  const [error, setError] = useState('');
  const [out, setOut] = useState(null);

  const abort = useRef(null);

  useEffect(() => {
    if (!book) return;
    let live = true;
    api.getStoryboard(book)
      .then((saved) => {
        if (!live) return;
        setBoard(saved?.storyboard || null);
        setValidation(saved?.validation || null);
        setPages(saved?.pages ?? null);
      })
      .catch((e) => { if (live) setLoadError(e.message); });
    return () => { live = false; };
  }, [book]);

  useEffect(() => () => { abort.current?.abort(); }, []);

  const blocked = !!validation?.errors?.length;
  const seconds = board ? Math.round(estimateDurationMs(board) / 1000) : 0;

  const cancel = async () => {
    if (runId) await api.cancelRun(runId).catch(() => {});
    abort.current?.abort();
    setBusy(false);
  };

  const film = async () => {
    if (busy || !book || !board || blocked) return;
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setError('');
    setLog([]);
    setOut(null);
    try {
      const res = await api.run('video', book, {
        args: {
          silent: !voice,
          captions,
          sfx: voice && sfx,
          width: width ? Number(width) : undefined,
        },
        signal: ac.signal,
        onStart: (d) => setRunId(d.id || ''),
        onLine: (d) => setLog((l) => [...l, d.text]),
      });
      if (res.code !== 0) {
        setError(`the film stopped with exit ${res.code}. Its own message is above.`);
        return;
      }
      setOut({ at: Date.now(), captions });
    } catch (e) {
      if (e.message !== 'cancelled') setError(e.message);
    } finally {
      setBusy(false);
      setRunId('');
    }
  };

  const src = out ? `/preview/books/${book}/video/${book}.mp4?t=${out.at}` : '';
  const srt = out ? `/preview/books/${book}/video/captions.srt?t=${out.at}` : '';

  return (
    <div className="draft video">
      <p className="hint">
        The saved plan becomes an mp4: the title card, the book pages it names, the drawings
        the engine already knows, the narration, and the captions. Nothing here edits the
        book; the film lands in <code>books/{book}/video/</code>.
      </p>

      {loadError ? <p className="alert" role="alert">{loadError}</p> : null}

      {!board && !loadError ? (
        <div className="draft-report">
          <span className="lbl">NO PLAN YET</span>
          <p className="dim">A film needs a storyboard. Plan one, read it, and save it first.</p>
          {onStoryboard ? (
            <div className="draft-actions">
              <button className="mini primary" onClick={onStoryboard}>open storyboard</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {board ? (
        <>
          <div className="draft-report">
            <span className="lbl">THE PLAN</span>
            <p><strong>{board.title}</strong></p>
            <p className="dim">
              {board.scenes.length} scenes, about {fmt(seconds * 1000)} before the voice is timed
              {pages != null ? `, ${pages} book page${pages === 1 ? '' : 's'}` : ''}
              {board.aspect ? `, ${board.aspect}` : ''}
              {board.fps ? ` at ${board.fps}fps` : ''}
            </p>
            {blocked ? (
              <p className="bad">
                {validation.errors.length} problem(s): {validation.errors.join(' ')}
              </p>
            ) : <p className="ok">the saved plan is ready to film</p>}
            {(validation?.warnings || []).map((w) => <p key={w} className="warn">{w}</p>)}
          </div>

          <div className="video-opts">
            <label className="chip-ck">
              <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} disabled={busy} />
              <span>voice</span>
            </label>
            <label className="chip-ck">
              <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} disabled={busy} />
              <span>captions</span>
            </label>
            <label className="chip-ck" title={voice ? 'A soft sound under each fade or wipe' : 'Silent films have no transition sound'}>
              <input type="checkbox" checked={voice && sfx} onChange={(e) => setSfx(e.target.checked)} disabled={busy || !voice} />
              <span>transition sound</span>
            </label>
            <label className="video-width">
              <span>quality</span>
              <select value={width} onChange={(e) => setWidth(e.target.value)} disabled={busy}>
                {WIDTHS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </select>
            </label>
          </div>

          <p className="hint">
            The voice is the local Windows SAPI voice. Uncheck it on another OS, or for a silent
            cut paced by the words. A full render can take a few minutes; the log below fills in
            scene by scene.
          </p>

          <div className="draft-actions">
            <button className="mini primary" onClick={film} disabled={busy || blocked || !book}>
              {busy ? 'filming...' : 'film it'}
            </button>
            {busy ? <button className="mini" onClick={cancel}>cancel</button> : null}
            {blocked ? <span className="dim">fix the plan first; the film tool would refuse it</span> : null}
          </div>
        </>
      ) : null}

      {error ? <p className="alert" role="alert">{error}</p> : null}
      {log.length ? <pre className="draft-out video-log">{log.join('\n')}</pre> : null}

      {out ? (
        <>
          <p className="ok">filmed. The book itself was not touched.</p>
          <video className="video-out" controls preload="metadata" src={src} aria-label={`the film made from ${book}`} />
          <div className="export-links">
            <a className="chip-link" href={src} target="_blank" rel="noreferrer">open the mp4</a>
            {out.captions ? <a className="chip-link" href={srt} target="_blank" rel="noreferrer">captions.srt</a> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
