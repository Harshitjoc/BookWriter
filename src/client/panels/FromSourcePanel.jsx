import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { loadKeys } from '../../shared/byok.js';

/* From a source to a book (or a paper) in one run.
 *
 * This is the big door: topic, YouTube link, web page, PDF, docx, text/markdown, a
 * saved .html page, or a .csv spreadsheet goes in, and the engine intakes it, plans a
 * book or a paper, then drafts every page through the same drafting path it always
 * uses. Nothing is auto-inserted — each
 * page arrives in books/<slug>/ for a human to read, and you open the book or the PDF
 * yourself after it finishes. */
export default function FromSourcePanel({ onDone }) {
  const [slug, setSlug] = useState('');
  const [mode, setMode] = useState('book');
  const [sourceType, setSourceType] = useState('topic');
  const [source, setSource] = useState('');
  const [file, setFile] = useState(null);
  const [topic, setTopic] = useState('');
  const [theme, setTheme] = useState('studio');
  const [size, setSize] = useState('b5');
  const [lang, setLang] = useState('');
  const [dir, setDir] = useState('');
  const [fonts, setFonts] = useState([]);
  const [fontPacks, setFontPacks] = useState([]);
  const [providers, setProviders] = useState([]);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [allowPaid, setAllowPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [plan, setPlan] = useState(null);
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getProviders()
      .then(({ providers: list }) => {
        setProviders(list);
        const first = list.find((p) => p.cost === 'local' && p.ready) || list.find((p) => p.ready);
        if (first) { setProvider(first.id); setModel(first.model); }
      })
      .catch((e) => setError(e.message));
    api.getFontPacks().then(({ packs }) => setFontPacks(packs)).catch(() => {});
  }, []);

  const FILE_TYPES = ['pdf', 'docx', 'txt', 'md', 'html', 'csv'];
  const ACCEPT = { pdf: '.pdf', docx: '.docx,.doc', txt: '.txt', md: '.md,.markdown', html: '.html,.htm', csv: '.csv,.tsv' };
  const needsFile = FILE_TYPES.includes(sourceType);

  const go = async () => {
    if (busy || !slug.trim()) return;
    if (sourceType === 'topic' && !topic.trim()) return;
    if (sourceType !== 'topic' && !needsFile && !source.trim()) return;
    if (needsFile && !file) return;
    setBusy(true);
    setLog([]);
    setPlan(null);
    setDone(null);
    setError('');
    let fileBase64;
    let fileName;
    if (needsFile && file) {
      fileName = file.name;
      const buf = await file.arrayBuffer();
      /* btoa needs a binary string. The chunked conversion keeps a large PDF
         from blowing the call stack. */
      const bytes = new Uint8Array(buf);
      let bin = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      fileBase64 = btoa(bin);
    }
    try {
      const out = await api.fromSource(
        {
          slug: slug.trim(),
          mode,
          sourceType,
          source: sourceType === 'topic' ? topic : source,
          fileBase64,
          fileName,
          topic,
          theme,
          size,
          lang: lang.trim() || undefined,
          dir: dir.trim() || undefined,
          fonts: fonts.length ? fonts : undefined,
          provider,
          model: model || undefined,
          allowPaid,
        },
        {
          onLine: (d) => setLog((l) => [...l, d.text]),
          onPlan: (d) => setPlan(d.plan),
        }
      );
      setDone(out);
      onDone?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const available = providers.map((p) => {
    if (!p.needsKey) return p;
    if (p.ready || !loadKeys()[p.needsKey]) return p;
    return { ...p, ready: true, reason: p.cost === 'paid' ? 'needs --allow-paid' : null };
  });
  const effectiveChosen = available.find((p) => p.id === provider);
  const isPaid = effectiveChosen?.cost === 'paid';

  return (
    <div className="draft">
      <p className="hint">
        One run from source to print. Book or paper, real planner first. The model reads
        the whole source you give it — never invented numbers, no placeholders accepted.
      </p>

      <div className="draft-form">
        <label>
          <span>output</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)} disabled={busy}>
            <option value="book">book — pages in engine format</option>
            <option value="paper">research paper — long-form HTML → PDF</option>
          </select>
        </label>
        <label>
          <span>new book slug</span>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-book" disabled={busy} />
        </label>
        <label>
          <span>source</span>
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} disabled={busy}>
            <option value="topic">a topic, in my own words</option>
            <option value="youtube">a YouTube link</option>
            <option value="url">a web page</option>
            <option value="pdf">a PDF file</option>
            <option value="docx">a .docx</option>
            <option value="txt">a .txt</option>
            <option value="md">a markdown file</option>
            <option value="html">a saved web page (.html)</option>
            <option value="csv">a spreadsheet (.csv)</option>
          </select>
        </label>
        {needsFile ? (
          <label className="grow">
            <span>the file</span>
            <input
              type="file"
              disabled={busy}
              accept={ACCEPT[sourceType]}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
        ) : (
          <label className="grow">
            <span>{sourceType === 'topic' ? 'what is it about?' : sourceType === 'youtube' ? 'youtube url' : sourceType === 'url' ? 'page url' : 'source'}</span>
            <input
              value={sourceType === 'topic' ? topic : source}
              onChange={(e) => (sourceType === 'topic' ? setTopic(e.target.value) : setSource(e.target.value))}
              placeholder={sourceType === 'youtube' ? 'https://www.youtube.com/watch?v=…' : sourceType === 'url' ? 'https://…' : sourceType === 'topic' ? 'resting meat' : ''}
              disabled={busy}
            />
          </label>
        )}
        <label>
          <span>provider</span>
          <select
            value={provider}
            onChange={(e) => { setProvider(e.target.value); const p = providers.find((x) => x.id === e.target.value); if (p) setModel(p.model); }}
            disabled={busy}
          >
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
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="default" disabled={busy} />
        </label>
        {mode === 'book' ? (
          <label>
            <span>theme</span>
            <select value={theme} onChange={(e) => setTheme(e.target.value)} disabled={busy}>
              {['studio', 'cookbook', 'manual', 'reference'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        ) : null}
        {mode === 'book' ? (
          <label>
            <span>size</span>
            <select value={size} onChange={(e) => setSize(e.target.value)} disabled={busy}>
              {['b5', 'b5-landscape', 'a5', 'a4', 'six-by-nine'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        ) : null}
        {mode === 'book' ? (
          <label>
            <span>lang (BCP-47)</span>
            <input value={lang} onChange={(e) => setLang(e.target.value)} placeholder="fr, ar, zh-Hans, ja" disabled={busy} />
          </label>
        ) : null}
        {mode === 'book' && fontPacks.length ? (
          <label>
            <span>font packs</span>
            <select
              multiple
              value={fonts}
              onChange={(e) => setFonts(Array.from(e.target.selectedOptions).map((o) => o.value))}
              disabled={busy}
              style={{ minHeight: 64 }}
            >
              {fontPacks.map((p) => (
                <option key={p.id} value={p.id}>{p.label} — {p.scripts?.join(', ')}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {isPaid ? (
        <label className="paid-warn">
          <input type="checkbox" checked={allowPaid} onChange={(e) => setAllowPaid(e.target.checked)} disabled={busy} />
          <span><strong>{effectiveChosen.label} bills every token.</strong> Tick to let this flow call it.</span>
        </label>
      ) : null}

      <div className="draft-actions">
        <button className="mini primary" onClick={go} disabled={busy || !slug.trim() || (sourceType === 'topic' ? !topic.trim() : needsFile ? !file : !source.trim())}>
          {busy ? 'making…' : `make ${mode}`}
        </button>
      </div>

      {error ? <p className="alert">{error}</p> : null}

      {log.length ? <pre className="draft-out">{log.join('\n')}</pre> : null}

      {plan ? (
        <div className="draft-report">
          <span className="lbl">PLAN</span>
          <p><strong>{plan.title}</strong> — {plan.subtitle}</p>
          {plan.parts.map((p) => (
            <p key={p.name} className="dim" style={{ marginTop: 6 }}>
              <strong>{p.name}</strong>: {p.blocks.map((b) => `${b.title} [${b.archetype}]`).join(' · ')}
            </p>
          ))}
        </div>
      ) : null}

      {done ? (
        <div className="draft-report">
          <span className="lbl">RESULT</span>
          <p className="ok">
            {done.result?.mode === 'book'
              ? `book at books/${slug}/ — ${done.result.pages} pages, ${done.result.failed} skipped.`
              : `paper at books/${slug}/paper/paper.pdf.`}
          </p>
        </div>
      ) : null}
    </div>
  );
}