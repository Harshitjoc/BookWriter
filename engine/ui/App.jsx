import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.js';
import SourceEditor from './components/Editor.jsx';
import Preview from './components/Preview.jsx';
import CheckTable from './components/CheckTable.jsx';
import ShotGallery from './components/ShotGallery.jsx';
import Console from './components/Console.jsx';
import DraftPanel from './components/DraftPanel.jsx';
import ImagePanel from './components/ImagePanel.jsx';
import KeysPanel from './components/KeysPanel.jsx';
import FromSourcePanel from './components/FromSourcePanel.jsx';
import DiagramStudio from './components/DiagramStudio.jsx';
import BoardPanel from './components/BoardPanel.jsx';
import DashboardPanel from './components/DashboardPanel.jsx';
import ExportPanel from './components/ExportPanel.jsx';
import PublishPanel from './components/PublishPanel.jsx';
import OutTabs from './components/OutTabs.jsx';

const STEPS = [
  { id: 'build', label: 'build', title: 'Wrap your pages into book.html', verb: 'building' },
  { id: 'check', label: 'check', title: 'Measure every page. Must read 0 mm', verb: 'checking' },
  { id: 'shot', label: 'shot', title: 'One PNG per page, so you can look at them', verb: 'shooting' },
  { id: 'export', label: 'export', title: 'Write the PDF', verb: 'exporting' },
];

export default function App() {
  const [books, setBooks] = useState([]);
  const [slug, setSlug] = useState('');
  const [health, setHealth] = useState(null);
  const [edition, setEdition] = useState('');

  const [active, setActive] = useState(0);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [dirty, setDirty] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);
  const [checkResult, setCheckResult] = useState(null);
  const [shots, setShots] = useState([]);
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState('');
  const [autoRun, setAutoRun] = useState(true);
  const [tab, setTab] = useState('check');
  const [jump, setJump] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [notice, setNotice] = useState(null);

  /* Print-craft switches for build. They feed --gutter/--bleed/--start-recto to
     build-book.mjs, the same flags the command line takes. */
  const [craft, setCraft] = useState({ gutter: false, bleed: false, recto: false });
  const [gutterMm, setGutterMm] = useState('8');
  const [bleedMm, setBleedMm] = useState('3');

  const book = useMemo(() => books.find((b) => b.slug === slug), [books, slug]);
  const runIdRef = useRef(null);

  /* ------------------------------------------------------------------ boot */
  const reloadBooks = useCallback(async (pick) => {
    const { books: list } = await api.getBooks();
    setBooks(list);
    setSlug((cur) => pick || cur || list[0]?.slug || '');
    return list;
  }, []);

  useEffect(() => {
    reloadBooks().catch((e) => setNotice({ kind: 'bad', text: e.message }));
    api.getHealth().then(setHealth).catch(() => {});
  }, [reloadBooks]);

  const refreshShots = useCallback(async (s) => {
    const target = s || slug;
    if (!target) return;
    try {
      const { shots: list } = await api.getShots(target);
      setShots(list.map((x) => ({ ...x, book: target })));
    } catch { /* none yet */ }
  }, [slug]);

  /* ------------------------------------------------------- the active file
     `files` is DERIVED, never stored. reloadBooks() after every build hands back
     a fresh array, so a stored book/files pair gets a new identity on each build
     and an effect keyed on it would reset the editor out from under you. Derived
     data has no identity problem. */
  const files = useMemo(() => {
    if (!book) return [];
    return [
      { name: 'book.json', label: 'book.json', lang: 'json', hint: 'Title, author, parts, and which pages are in the book. Titles must match a page <h1 class="title"> exactly.' },
      { name: book.interior, label: book.interior, lang: 'html', hint: 'Your pages. One <section class="sheet bb"> per concept.' },
      { name: 'VOICE.md', label: 'VOICE.md', lang: 'markdown', hint: 'How the book sounds. Treated as law.' },
      { name: 'blocks.md', label: 'blocks.md', lang: 'markdown', hint: 'The backlog. One entry per page you mean to write.' },
    ];
  }, [book]);

  /* Only an actual change of book resets the view. Keyed on slug alone. */
  const firstBook = useRef('');
  useEffect(() => {
    if (!slug) return;
    if (firstBook.current !== slug) {
      firstBook.current = slug;
      setActive(0);
      setEdition('');
      setCheckResult(null);
      setLines([]);
      refreshShots(slug);
    }
  }, [slug, refreshShots]);

  const file = files[active];

  useEffect(() => {
    if (!file || !slug) return;
    let live = true;
    api.getFile(slug, file.name)
      .then((t) => { if (live) { setText(t); setDirty(false); setSaved(''); } })
      .catch((e) => { if (live) { setText(''); setNotice({ kind: 'bad', text: `${file.name}: ${e.message}` }); } });
    return () => { live = false; };
  }, [slug, file?.name]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------------------------- save */
  const doSave = useCallback(async () => {
    if (!file || !slug || !dirty) return;
    try {
      await api.saveFile(slug, file.name, text);
      setDirty(false);
      setSaved(`${file.name} saved`);
      setNotice(null);
      if (autoRun) await doStep('build', { quiet: true });
      else setRefreshKey((k) => k + 1);
    } catch (e) {
      setNotice({ kind: 'bad', text: e.message });
    }
  }, [file, slug, dirty, text, autoRun]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* -------------------------------------------------------------- run a step */
  const craftArgs = () => {
    const a = {};
    if (craft.gutter) a.gutter = Number(gutterMm) || 8;
    if (craft.bleed) a.bleed = Number(bleedMm) || 3;
    if (craft.recto) a.startRecto = true;
    return a;
  };

  const doStep = useCallback(async (tool, { quiet } = {}) => {
    if (!slug || busy) return;
    setBusy(tool);
    setNotice(null);
    if (tool === 'check') setTab('check');
    if (tool === 'shot') setTab('shots');
    if (!quiet) setLines([]);

    try {
      const res = await api.run(tool, slug, {
        edition,
        args: tool === 'build' ? craftArgs() : undefined,
        onStart: (d) => setLines((l) => [...l, { kind: 'sys', tool: tool, text: `$ ${d.label}` }]),
        onLine: (d) => setLines((l) => [...l, { kind: d.kind, tool: tool, text: d.text }]),
      });

      if (tool === 'build') {
        setRefreshKey((k) => k + 1);
        await reloadBooks(slug);
        setLines((l) => [...l, { kind: 'sys', tool, text: 'preview reloaded from disk' }]);
      }
      if (tool === 'check') {
        setCheckResult(res.result);
        if (!res.result) {
          setNotice({ kind: 'bad', text: 'the check produced no JSON. Is book.html built yet?' });
        }
      }
      if (tool === 'shot') { await refreshShots(); }
      if (tool === 'export') {
        setLines((l) => [...l, { kind: 'sys', tool, text: `pdf: /preview/books/${slug}/${edition ? `book-${edition}.pdf` : 'book.pdf'}` }]);
      }
    } catch (e) {
      setNotice({ kind: 'bad', text: e.message });
      setLines((l) => [...l, { kind: 'err', tool, text: String(e.message) }]);
    } finally {
      setBusy('');
    }
  }, [slug, busy, edition, reloadBooks, refreshShots, craft, gutterMm, bleedMm]);

  /* keep the gallery live while a shot run is in flight */
  useEffect(() => {
    if (busy !== 'shot') return;
    const t = setInterval(() => refreshShots(), 700);
    return () => clearInterval(t);
  }, [busy, refreshShots]);

  /* ------------------------------------------------------------ create a book */
  const createBook = async () => {
    const s = newSlug.trim();
    if (!s) return;
    try {
      await api.newBook(s);
      setShowNew(false);
      setNewSlug('');
      await reloadBooks(s);
      setNotice({ kind: 'ok', text: `created books/${s}. Open its interior and start writing.` });
    } catch (e) {
      setNotice({ kind: 'bad', text: e.message });
    }
  };

  const pdfHref = `/preview/books/${slug}/${edition ? `book-${edition}` : 'book'}.pdf`;

  /* Add an approved draft to the interior file.
   *
   * This is the only path from a draft into the book, and it is a button a
   * person presses. It appends to the interior — never to book.html, which is
   * generated — and then rebuilds. It deliberately does NOT touch book.json: the
   * page has to be placed in a part by hand, and a tool that quietly guessed
   * which part is how a book ends up with a table of contents nobody chose. */
  const insertDraft = async (section) => {
    if (!book) return;
    try {
      const cur = await api.getFile(slug, book.interior);
      const at = cur.lastIndexOf('</main>');
      if (at === -1) {
        setNotice({ kind: 'bad', text: `no </main> in ${book.interior}, so the page was not added` });
        return;
      }
      const next = `${cur.slice(0, at)}\n\n    ${section}\n\n  ${cur.slice(at)}`;
      await api.saveFile(slug, book.interior, next);
      setNotice({
        kind: 'ok',
        text: `page added to ${book.interior}. Now add its <h1 class="title"> to a part in book.json.`,
      });
      await reloadBooks();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setNotice({ kind: 'bad', text: e.message });
    }
  };

  /* A compiled diagram goes into the page you are editing, not onto disk by
   * itself: a figure belongs inside one sheet, and where is a decision. If the
   * interior file is not the open tab, say so rather than dropping it somewhere
   * surprising. The insertion is unsaved until you save, like any other edit. */
  const insertDiagram = (snippet) => {
    if (!snippet || !book) return;
    const interiorIdx = files.findIndex((f) => f.name === book.interior);
    if (active !== interiorIdx) {
      setNotice({ kind: 'bad', text: `Open ${book.interior} first — a diagram goes inside a page.` });
      return;
    }
    setText((t) => `${t}\n\n    ${snippet}\n\n`);
    setDirty(true);
    setNotice({ kind: 'ok', text: 'figure added to the editor. Move it into the page it belongs to, then save.' });
  };

  /* Scroll the preview to a sheet, shared by the check table and the board. */
  const goToSheet = (n) => {
    const doc = document.querySelector('.col-preview iframe')?.contentDocument;
    doc?.querySelectorAll('.sheet')[n - 1]?.scrollIntoView({ block: 'start' });
  };

  /* Export, wait, then open. Opening first and exporting after is the race that
     showed a stale or half-written PDF. The window is opened only once the file
     on disk is the one we just wrote. */
  const openPdf = async () => {
    if (busy || !slug) return;
    const res = await api.run('export', slug, { edition, onLine: (d) => setLines((l) => [...l, { kind: d.kind, tool: 'export', text: d.text }]) });
    if (res.code !== 0) {
      setNotice({ kind: 'bad', text: 'export failed, so the PDF was not opened' });
      return;
    }
    window.open(`${pdfHref}?t=${Date.now()}`, '_blank', 'noopener');
  };

  /* An edition is a different file on disk (book-<edition>.html), so "is it
     built" is a different question for an edition than for the main book.
     Getting this wrong points the preview iframe at a 404. */
  const isBuilt = edition
    ? (book?.builtEditions || []).includes(edition)
    : !!book?.hasBookHtml;

  return (
    <div className="app">
      {/* ------------------------------------------------------------ header */}
      <header className="top">
        <div className="brand">
          <span className="mark" />
          <div>
            <strong>paper engine</strong>
            <span className="dim"> one concept per page · B5</span>
          </div>
        </div>

        <div className="top-mid">
          <label className="field">
            <span>book</span>
            <select value={slug} onChange={(e) => setSlug(e.target.value)}>
              {books.map((b) => (
                <option key={b.slug} value={b.slug}>
                  {b.title} ({b.slug})
                </option>
              ))}
            </select>
          </label>

          {book?.editions?.length ? (
            <label className="field">
              <span>edition</span>
              <select value={edition} onChange={(e) => setEdition(e.target.value)}>
                <option value="">full book</option>
                {book.editions.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </label>
          ) : null}

          <button className="mini" onClick={() => setShowNew((s) => !s)}>new book</button>
        </div>

        <div className="top-right">
          {health ? (
            <span className={'pill-status ' + (health.playwright === 'ok' ? 'ok' : 'bad')} title={health.playwright}>
              browser {health.playwright === 'ok' ? 'ready' : 'missing'}
            </span>
          ) : null}
          <span className="dim node">{health?.node}</span>
        </div>
      </header>

      {showNew ? (
        <div className="newbook">
          <span>Scaffold <code>books/starter</code> into a new book:</span>
          <input
            autoFocus
            placeholder="my-book"
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createBook()}
          />
          <button className="mini primary" onClick={createBook}>create</button>
          <button className="mini" onClick={() => setShowNew(false)}>cancel</button>
        </div>
      ) : null}

      {/* ----------------------------------------------------------- toolbar */}
      <div className="toolbar">
        {STEPS.map((s) => (
          <button
            key={s.id}
            className={'step' + (busy === s.id ? ' busy' : '')}
            onClick={() => doStep(s.id)}
            disabled={!!busy}
            title={s.title}
          >
            {busy === s.id ? `${s.verb}…` : s.label}
          </button>
        ))}

        <span className="sep" />

        <label className="toggle" title="After every save, rebuild and refresh the preview">
          <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
          <span>auto build on save</span>
        </label>

        <span className="sep" />

        {/* Print-craft switches. Off by default: a plain build is byte-for-byte
            the same as without the cockpit. */}
        <label className="toggle craft-ck" title="Extra margin on the bound edge">
          <input type="checkbox" checked={craft.gutter}
            onChange={(e) => setCraft((c) => ({ ...c, gutter: e.target.checked }))} />
          <span>gutter</span>
        </label>
        {craft.gutter ? (
          <input className="mm" value={gutterMm} title="gutter in mm"
            onChange={(e) => setGutterMm(e.target.value)} />
        ) : null}
        <label className="toggle craft-ck" title="Paper colour runs into the trim (this is the one deliberate size change)">
          <input type="checkbox" checked={craft.bleed}
            onChange={(e) => setCraft((c) => ({ ...c, bleed: e.target.checked }))} />
          <span>bleed</span>
        </label>
        {craft.bleed ? (
          <input className="mm" value={bleedMm} title="bleed in mm"
            onChange={(e) => setBleedMm(e.target.value)} />
        ) : null}
        <label className="toggle craft-ck" title="Every part opens on a right-hand (odd) page">
          <input type="checkbox" checked={craft.recto}
            onChange={(e) => setCraft((c) => ({ ...c, recto: e.target.checked }))} />
          <span>recto</span>
        </label>

        <span className="sep" />

        {/* Not an <a href>. An anchor starts fetching the PDF the instant it is
            clicked, which is before export.mjs has written it — so the tab that
            opened showed the previous run's PDF, or a half-written file. Export
            first, then open. */}
        <button
          className="step link"
          onClick={openPdf}
          disabled={!!busy || !slug}
          title="Run export.mjs, wait for it to finish, then open the PDF"
        >
          open pdf
        </button>

        {book ? (
          <span className="dim facts">
            {book.listed} pages · {book.parts.length} parts
            {book.images ? ` · ${book.images} images` : ''}
            {!book.hasBookHtml ? ' · not built yet' : ''}
          </span>
        ) : null}
      </div>

      {notice ? (
        <div className={'notice ' + notice.kind} onClick={() => setNotice(null)}>{notice.text}</div>
      ) : null}

      {/* -------------------------------------------------------------- main */}
      <main className="grid">
        <section className="col col-edit">
          <div className="col-head">
            <div className="tabs">
              {files.map((f, i) => (
                <button
                  key={f.name}
                  className={'tab' + (i === active ? ' on' : '')}
                  onClick={() => setActive(i)}
                  title={f.hint}
                >
                  {f.label}
                  {dirty && i === active ? <span className="dot" title="unsaved" /> : null}
                </button>
              ))}
            </div>
            <button className="mini primary" onClick={doSave} disabled={!dirty}>
              {dirty ? 'save' : 'saved'}
            </button>
          </div>
          <p className="hint">{file?.hint}</p>
          <div className="editor-wrap">
            <SourceEditor
              value={text}
              language={file?.lang || 'plaintext'}
              path={file ? `${slug}/${file.name}` : 'x'}
              onChange={(t) => { setText(t); setDirty(true); }}
              onSave={doSave}
            />
          </div>
          {saved ? <p className="saved">{saved} · Ctrl+S</p> : null}
        </section>

        <section className="col col-preview">
          <Preview book={slug} edition={edition} refreshKey={refreshKey} built={isBuilt} />
          <div className="jump">
            <input
              type="number"
              min="1"
              placeholder="sheet #"
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                const doc = document.querySelector('.col-preview iframe')?.contentDocument;
                const sheet = doc?.querySelectorAll('.sheet')[Math.max(1, Number(jump) || 1) - 1];
                if (!sheet) return;
                /* offsetTop on the sheet itself: scrollIntoView is unreliable
                   here because the desk, not the sheet, is the scroll box. */
                const top = sheet.getBoundingClientRect().top - doc.body.getBoundingClientRect().top
                  + (doc.documentElement.scrollTop || doc.body.scrollTop || 0);
                (doc.scrollingElement || doc.documentElement).scrollTop = top;
              }}
            />
          </div>
        </section>

        <section className="col col-out">
          <div className="col-head">
            <OutTabs tab={tab} onPick={setTab} shots={shots} lines={lines} checkResult={checkResult} />
          </div>
          <div className="out-body">
            {tab === 'check' ? (
              <CheckTable result={checkResult} onPickPage={goToSheet} />
            ) : null}
            {tab === 'shots' ? <ShotGallery shots={shots} /> : null}
            {tab === 'console' ? (
              <Console lines={lines} onClear={() => setLines([])} />
            ) : null}
            {tab === 'draft' ? (
              <DraftPanel book={slug} onInsert={insertDraft} />
            ) : null}
            {tab === 'assets' ? (
              <ImagePanel book={slug} onDone={() => reloadBooks()} />
            ) : null}
            {tab === 'keys' ? <KeysPanel /> : null}
            {tab === 'source' ? <FromSourcePanel onDone={() => reloadBooks()} /> : null}
            {tab === 'diagram' ? <DiagramStudio book={slug} onInsert={insertDiagram} /> : null}
            {tab === 'board' ? <BoardPanel book={slug} onPickPage={goToSheet} /> : null}
            {tab === 'dashboard' ? <DashboardPanel book={slug} onPickPage={goToSheet} /> : null}
            {tab === 'export' ? <ExportPanel book={slug} onDone={reloadBooks} /> : null}
            {tab === 'publish' ? (
              <PublishPanel book={slug} editions={book?.editions || []} onDone={reloadBooks} />
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}