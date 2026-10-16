import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { loadKeys } from '../byok.js';

/* Draft one page with a language model, then make you read it.
 *
 * The panel deliberately has no "insert into the book" that happens on its own.
 * A draft arrives, you read it, you decide. The only way it reaches the interior
 * file is the button at the bottom, pressed by a person. A model writing straight
 * into a book file is how a made-up number gets printed with nobody having read
 * it. */
export default function DraftPanel({ book, onInsert }) {
  const [providers, setProviders] = useState([]);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [topic, setTopic] = useState('');
  const [archetype, setArchetype] = useState('');
  const [seed, setSeed] = useState('');
  const [allowPaid, setAllowPaid] = useState(false);

  const [section, setSection] = useState('');
  const [validation, setValidation] = useState(null);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState('');
  const [error, setError] = useState('');
  const [storedKeys] = useState(() => loadKeys());

  useEffect(() => {
    api.getProviders()
      .then(({ providers: list }) => {
        setProviders(list);
        /* Default to the first LOCAL provider, because that is the one that is
           free, needs no key, and cannot surprise anyone with a bill. A paid
           provider is never selected for you. */
        const first = list.find((p) => p.cost === 'local' && p.ready) || list.find((p) => p.ready);
        if (first) { setProvider(first.id); setModel(first.model); }
      })
      .catch((e) => setError(e.message));
  }, []);

  /* Changing provider suggests that provider's model, unless you have typed
     your own. Typed-in models are not stomped on. */
  const pick = (id) => {
    setProvider(id);
    const p = providers.find((x) => x.id === id);
    if (p) setModel(p.model);
    setError('');
  };

  const chosen = providers.find((p) => p.id === provider);

  /* A key typed into the keys tab makes a provider ready even when .env
     doesn't have it. The UI shows that before the server does. */
  const available = providers.map((p) => {
    if (!p.needsKey) return p;
    if (p.ready || !storedKeys[p.needsKey]) return p;
    return { ...p, ready: true, reason: p.cost === 'paid' ? 'needs --allow-paid' : null };
  });
  const effectiveChosen = available.find((p) => p.id === provider) || chosen;

  const stop = async () => {
    if (runId) await api.cancelRun(runId).catch(() => {});
    setBusy(false);
  };

  const go = async () => {
    if (busy || !book) return;
    setBusy(true);
    setError('');
    setSection('');
    setValidation(null);
    setMeta(null);
    try {
      const out = await api.draft(
        book,
        {
          topic,
          provider,
          model: model || undefined,
          archetype: archetype || undefined,
          seed: seed !== '' ? Number(seed) : undefined,
          allowPaid,
        },
        {
          onStart: (d) => { setRunId(d.id); setMeta(d); },
          onLine: (d) => setSection((s) => (s ? `${s}\n${d.text}` : d.text)),
        }
      );
      setRunId('');
      if (out.section) setSection(out.section);
      setValidation(out.validation);
      setMeta((m) => (out.meta ? { ...m, ...out.meta } : m));
      if (out.error && !out.cancelled) setError(out.error);
      if (out.cancelled) setError('cancelled');
    } catch (e) {
      setRunId('');
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="draft">
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
            onChange={(e) => setModel(e.target.value)}
            placeholder="the provider's default"
            disabled={busy}
          />
        </label>

        <label className="grow">
          <span>one concept for this page</span>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="How a CDN works"
            disabled={busy}
            onKeyDown={(e) => { if (e.key === 'Enter' && topic.trim()) go(); }}
          />
        </label>

        <label>
          <span>archetype</span>
          <select value={archetype} onChange={(e) => setArchetype(e.target.value)} disabled={busy}>
            <option value="">the book&apos;s own</option>
            {['standard', 'procedure', 'recipe', 'exercise', 'reference'].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>

        <label>
          <span>seed (fixes the page)</span>
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="optional"
            title="Same topic, model and seed always redraft the same page. Leave empty for a fresh one."
            disabled={busy}
          />
        </label>
      </div>

      {effectiveChosen?.cost === 'paid' ? (
        <label className="paid-warn" title="Paid providers bill every token">
          <input type="checkbox" checked={allowPaid} onChange={(e) => setAllowPaid(e.target.checked)} disabled={busy} />
          <span>
            <strong>{effectiveChosen.label} bills every token.</strong> Tick to let this page be written
            with it. Local and free-tier providers do not need this.
          </span>
        </label>
      ) : null}

      {effectiveChosen?.blurb ? <p className="hint">{effectiveChosen.blurb}</p> : null}

      <div className="draft-actions">
        <button className="mini primary" onClick={go} disabled={busy || !topic.trim() || !book}>
          {busy ? 'drafting…' : 'draft a page'}
        </button>
        <button className="mini" onClick={stop} disabled={!busy}>cancel</button>
        {meta?.cost ? <span className="dim">{meta.label}</span> : null}
      </div>

      {error ? <p className="alert">{error}</p> : null}

      {/* The report is shown whenever there IS a verdict, even with no page.
          A model that returns prose instead of a page produces an empty draft;
          showing nothing at all there is how you end up clicking draft again
          and again without learning why it never works. */}
      {section || validation ? (
        <>
          <div className="draft-report">
            <span className="lbl">CHECKS</span>
            {validation ? (
              <>
                {validation.errors.length ? (
                  <p className="bad">
                    {validation.errors.length} problem(s): {validation.errors.join(' ')}
                  </p>
                ) : <p className="ok">the page matches the engine&apos;s rules</p>}
                {validation.warnings.map((w) => <p key={w} className="warn">{w}</p>)}
                {validation.gaps.length ? (
                  <p className="warn">
                    you must fill in {validation.gaps.length} fact(s) yourself:{' '}
                    {validation.gaps.map((g, i) => `[FACT NEEDED: ${g}]`).join(' ')}
                  </p>
                ) : null}
              </>
            ) : <p className="dim">still writing…</p>}
          </div>

          {meta?.ledger ? (
            <div className="draft-meta">
              {meta.replayed
                ? <span className="ok">replayed from the ledger — byte-for-byte identical</span>
                : <span>recorded in the <code>.gen</code> ledger</span>}
              {meta.seed != null ? <span>seed <b>{meta.seed}</b> fixes this page</span> : <span>no seed — each run differs</span>}
              {meta.requestKey ? <span className="key">key {meta.requestKey.slice(0, 8)}…</span> : null}
            </div>
          ) : null}

          {!section ? (
            <p className="alert">
              the model did not return a page. Anything it said has been discarded — this tool
              will not write a half page into your book.
            </p>
          ) : (
            <pre className="draft-out">{section}</pre>
          )}

          <div className="draft-actions">
            <button className="mini" disabled={!section}
              onClick={() => navigator.clipboard?.writeText(section)}>
              copy
            </button>
            <button
              className="mini primary"
              onClick={() => section && onInsert(section)}
              disabled={!section || validation?.errors?.length > 0}
              title={validation?.errors?.length
                ? 'fix the errors first, or the page will break the build'
                : 'append this page to the interior file, then rebuild'}
            >
              add to the book
            </button>
            {validation?.errors?.length ? (
              <span className="dim">add is blocked while the checks fail</span>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}