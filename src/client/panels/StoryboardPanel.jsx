import { useEffect, useRef, useState } from 'react';
import * as api from '../lib/api.js';
import { loadKeys } from '../../shared/byok.js';
import { ASPECT_IDS, estimateDurationMs } from '../../shared/storyboard.js';

/* Plan a short video before a single frame is drawn.
 *
 * The panel has exactly two write paths, and both are deliberate: "plan" asks
 * a model for a storyboard, and "save" writes the storyboard you are looking
 * at into the book. Planning alone writes nothing. A model does not get to put
 * a video plan on disk that nobody has read.
 *
 * The visuals it may ask for are the engine's own drawings — a page from the
 * book, a figure, a diagram, or a title card. No stock footage, no generated
 * image, nothing the book could not print. */
const fmt = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const visualLabel = (v) => {
  if (!v) return 'no visual';
  if (v.kind === 'page') return `page ${v.page}`;
  if (v.kind === 'figure') return `figure · ${v.figure}`;
  if (v.kind === 'diagram') return `diagram · ${v.shape || 'spec'}`;
  return v.kind || 'unknown';
};

export default function StoryboardPanel({ book }) {
  const [providers, setProviders] = useState([]);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [allowPaid, setAllowPaid] = useState(false);

  const [topic, setTopic] = useState('');
  const [source, setSource] = useState('');
  const [scenes, setScenes] = useState('8');
  const [aspect, setAspect] = useState('16:9');

  const [board, setBoard] = useState(null);
  const [validation, setValidation] = useState(null);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState('');
  const [error, setError] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [storedKeys, setStoredKeys] = useState(() => loadKeys());

  const abort = useRef(null);
  const modelTouched = useRef(false);

  /* Providers, and the plan this book already has. Both are reads; a failure
     to load a saved plan is not a failure to use the panel. */
  useEffect(() => {
    if (!book) return;
    let live = true;
    api.getProviders()
      .then(({ providers: list }) => {
        if (!live) return;
        setProviders(list);
        const first = list.find((p) => p.cost === 'local' && p.ready) || list.find((p) => p.ready);
        if (first) { setProvider(first.id); setModel(first.model); }
      })
      .catch((e) => { if (live) setError(e.message); });

    api.getStoryboard(book)
      .then((saved) => {
        if (!live || !saved?.storyboard) return;
        setBoard(saved.storyboard);
        setValidation(saved.validation);
        setMeta({ saved: true, pages: saved.pages, scenes: saved.storyboard.scenes.length });
        setScenes(String(saved.storyboard.scenes.length || 8));
        setAspect(saved.storyboard.aspect || '16:9');
      })
      .catch(() => { /* no saved plan is the normal first state */ });

    return () => { live = false; };
  }, [book]);

  /* Switching tabs unmounts the panel. An in-flight plan must not keep
     streaming into state that no longer exists. */
  useEffect(() => () => { abort.current?.abort(); }, []);

  const pick = (id) => {
    setProvider(id);
    const p = providers.find((x) => x.id === id);
    if (p && !modelTouched.current) setModel(p.model);
    setError('');
  };

  const chosen = providers.find((p) => p.id === provider);
  const available = providers.map((p) => {
    if (!p.needsKey) return p;
    if (p.ready || !storedKeys[p.needsKey]) return p;
    return { ...p, ready: true, reason: p.cost === 'paid' ? 'needs --allow-paid' : null };
  });
  const effectiveChosen = available.find((p) => p.id === provider) || chosen;

  const stop = async () => {
    if (runId) await api.cancelRun(runId).catch(() => {});
    abort.current?.abort();
    setRunId('');
    setBusy(false);
  };

  const go = async () => {
    if (busy || !book) return;
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setError('');
    setSavedNote('');
    setBoard(null);
    setValidation(null);
    setMeta(null);
    setStoredKeys(loadKeys());
    try {
      const out = await api.storyboardPlan(
        {
          book,
          topic,
          source,
          scenes: Number(scenes) || 8,
          aspect,
          provider,
          model: model || undefined,
          allowPaid,
        },
        {
          signal: ac.signal,
          onStart: (d) => { setRunId(d.id); setMeta(d); },
          onLine: (d) => setMeta((m) => ({ ...m, line: d.text })),
        },
      );
      setRunId('');
      setBoard(out.storyboard);
      setValidation(out.validation);
      setMeta((m) => ({ ...m, ...out.meta }));
      if (out.error) setError(out.error);
    } catch (e) {
      setRunId('');
      setError(e.message === 'cancelled' ? '' : e.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!board) return;
    setError('');
    setSavedNote('');
    try {
      await api.saveStoryboard(book, board);
      setSavedNote(`saved to books/${book}/storyboard.json`);
      setMeta((m) => ({ ...(m || {}), saved: true }));
    } catch (e) {
      setError(e.message);
    }
  };

  const seconds = board ? Math.round(estimateDurationMs(board) / 1000) : 0;
  const blocked = !!validation?.errors?.length;

  return (
    <div className="draft storyboard">
      <p className="hint">
        Plan the video before it is filmed. Scenes are words spoken, words shown, and one
        drawing the engine already knows how to make. Nothing is filmed here, and nothing is
        saved until you press save.
      </p>

      <div className="draft-form">
        <label>
          <span>provider</span>
          <select value={provider} onChange={(e) => pick(e.target.value)} disabled={busy}>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.cost === 'paid' ? 'PAID' : p.cost === 'local' ? 'local, free' : 'free tier'}
                {p.reason ? ` (${p.reason})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>model</span>
          <input
            value={model}
            onChange={(e) => { modelTouched.current = true; setModel(e.target.value); }}
            placeholder="the provider's default"
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        <label className="grow">
          <span>what is the video about?</span>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="How a CDN works"
            disabled={busy}
            onKeyDown={(e) => { if (e.key === 'Enter' && (topic.trim() || source.trim())) go(); }}
          />
        </label>

        <label>
          <span>scenes</span>
          <input
            type="number"
            min={1}
            max={40}
            step={1}
            value={scenes}
            onChange={(e) => setScenes(e.target.value)}
            disabled={busy}
            title="A request, not a promise: a shortfall is reported, never padded."
          />
        </label>

        <label>
          <span>aspect</span>
          <select value={aspect} onChange={(e) => setAspect(e.target.value)} disabled={busy}>
            {ASPECT_IDS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>

      <label className="storyboard-source-label">
        <span>source text (optional — the planner will not invent facts)</span>
        <textarea
          className="storyboard-source"
          rows={3}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Paste the material the video must stay true to."
          disabled={busy}
        />
      </label>

      {effectiveChosen?.cost === 'paid' ? (
        <label className="paid-warn" title="Paid providers bill every token">
          <input type="checkbox" checked={allowPaid} onChange={(e) => setAllowPaid(e.target.checked)} disabled={busy} />
          <span>
            <strong>{effectiveChosen.label} bills every token.</strong> Tick to let this plan be
            written with it. Local and free-tier providers do not need this.
          </span>
        </label>
      ) : null}

      {effectiveChosen?.blurb ? <p className="hint">{effectiveChosen.blurb}</p> : null}

      <div className="draft-actions">
        <button
          className="mini primary"
          onClick={go}
          disabled={busy || (!topic.trim() && !source.trim()) || !book}
        >
          {busy ? 'planning…' : 'plan the video'}
        </button>
        <button className="mini" onClick={stop} disabled={!busy}>cancel</button>
        {meta?.label ? <span className="dim">{meta.label}</span> : null}
      </div>

      {error ? <p className="alert" role="alert">{error}</p> : null}
      {savedNote ? <p className="ok">{savedNote}</p> : null}

      {board ? (
        <>
          <div className="draft-report">
            <span className="lbl">CHECKS</span>
            {validation ? (
              <>
                {blocked ? (
                  <p className="bad">
                    {validation.errors.length} problem(s): {validation.errors.join(' ')}
                  </p>
                ) : <p className="ok">every scene names a visual the engine can draw</p>}
                {validation.warnings.map((w) => <p key={w} className="warn">{w}</p>)}
              </>
            ) : <p className="dim">not checked yet</p>}
            <p className="dim">
              {board.scenes.length} scenes · about {fmt(seconds * 1000)} before the voice is timed
              {meta?.pages ? ` · the book has ${meta.pages} pages` : ''}
              {meta?.saved ? ' · loaded from storyboard.json' : ''}
            </p>
          </div>

          <div className="storyboard-scenes">
            {board.scenes.map((s, i) => (
              <div className="storyboard-scene" key={s.id || i}>
                <span className="storyboard-n">{i + 1}</span>
                <div>
                  <div className="storyboard-cap">{s.caption || <span className="dim">(no caption)</span>}</div>
                  <div className="storyboard-nar">{s.narration || <span className="dim">(no narration)</span>}</div>
                  <div className="storyboard-vis">
                    {visualLabel(s.visual)}
                    {s.holdMs != null ? ` · hold ${Math.round(s.holdMs / 100) / 10}s` : ''}
                    {s.transition ? ` · ${s.transition}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <pre className="draft-out">{JSON.stringify(board, null, 2)}</pre>

          <div className="draft-actions">
            <button
              className="mini"
              onClick={() => navigator.clipboard?.writeText(JSON.stringify(board, null, 2))}
            >
              copy
            </button>
            <button
              className="mini primary"
              onClick={save}
              disabled={blocked}
              title={blocked ? 'fix the errors first, or the video tool will refuse the plan' : 'write storyboard.json into this book'}
            >
              save to the book
            </button>
            {blocked ? <span className="dim">save is blocked while the checks fail</span> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
