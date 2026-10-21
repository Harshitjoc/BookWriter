import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './lib/api.js';
import SourceEditor from './components/Editor.jsx';
import Preview from './components/Preview.jsx';
import Console from './components/Console.jsx';
import OutTabs from './components/OutTabs.jsx';
import CheckTable from './panels/CheckTable.jsx';
import ShotGallery from './panels/ShotGallery.jsx';
import DraftPanel from './panels/DraftPanel.jsx';
import ImagePanel from './panels/ImagePanel.jsx';
import KeysPanel from './panels/KeysPanel.jsx';
import FromSourcePanel from './panels/FromSourcePanel.jsx';
import DiagramStudio from './panels/DiagramStudio.jsx';
import BoardPanel from './panels/BoardPanel.jsx';
import DashboardPanel from './panels/DashboardPanel.jsx';
import ExportPanel from './panels/ExportPanel.jsx';
import PublishPanel from './panels/PublishPanel.jsx';
import Splitter from './components/Splitter.jsx';
import useLayout, { EDIT_MIN, EDIT_MAX, OUT_MIN, OUT_MAX, PREVIEW_MIN } from './lib/useLayout.js';
import useMediaQuery from './lib/useMediaQuery.js';
import { readSlug, saveSlug } from './lib/savedBook.js';

/* The tracks a splitter and a rail take, in px. They are here rather than in the
 * stylesheet because the drag maths in App has to subtract them by hand. */
const SPLIT_W = 6;
const RAIL_W = 28;
const NUDGE = 24;

/* The width the desktop layout draws, and the one CSS draws for the collapse
 * variants must be the SAME line: 1100px is the widest the mobile rule allows. */
const WIDE = '(min-width: 1101px)';

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
  const [templates, setTemplates] = useState([]);
  const [tplId, setTplId] = useState('');
  const [notice, setNotice] = useState(null);
  const [pane, setPane] = useState('edit');
  const [craftOpen, setCraftOpen] = useState(false);

  /* The two side panels: open or closed, and how wide. `wide` is the same
     breakpoint the stylesheet uses — only on desktop do the collapse handles,
     the drag handles and the edge rails exist at all. */
  const { layout, setEditOpen, setOutOpen, setEditW, setOutW } = useLayout();
  const wide = useMediaQuery(WIDE);
  const gridRef = useRef(null);

  const [showDelete, setShowDelete] = useState(false);
  const [deleteWord, setDeleteWord] = useState('');

  /* Print-craft switches for build. They feed --gutter/--bleed/--start-recto to
     build-book.mjs, the same flags the command line takes. */
  const [craft, setCraft] = useState({ gutter: false, bleed: false, recto: false });
  const [gutterMm, setGutterMm] = useState('8');
  const [bleedMm, setBleedMm] = useState('3');

  const book = useMemo(() => books.find((b) => b.slug === slug), [books, slug]);
  /* The scaffold the new-book bar will copy. Looked up here so both the create
     call and the hint under the bar read the same record. */
  const chosenTpl = templates.find((t) => t.id === tplId);
  /* The run in flight, so leaving the cockpit stops listening to it. The child
     keeps going server-side; the UI just stops caring about a thing unmounted. */
  const abortRun = useRef(null);

  useEffect(() => () => { abortRun.current?.abort(); }, []);

  /* ------------------------------------------------------------------ boot */
  const reloadBooks = useCallback(async (pick) => {
    const { books: list } = await api.getBooks();
    setBooks(list);
    /* Prefer an explicit pick (a book just made), then the project we were
       already on, then the remembered one — but never a slug the server no
       longer has. A deleted or renamed book must not leave the cockpit pointed
       at nothing, so every candidate is checked against the list first. */
    setSlug((cur) => {
      const exists = (s) => !!s && list.some((b) => b.slug === s);
      if (exists(pick)) return pick;
      if (exists(cur)) return cur;
      const saved = readSlug();
      if (exists(saved)) return saved;
      return list[0]?.slug || '';
    });
    return list;
  }, []);

  useEffect(() => {
    reloadBooks().catch((e) => setNotice({ kind: 'bad', text: e.message }));
    api.getHealth().then(setHealth).catch(() => {});
    /* The scaffolds the picker offers. If this fails the bar still works: an
       empty list falls back to the server's own default template. */
    api.getTemplates()
      .then(({ default: def, templates: list }) => {
        setTemplates(list || []);
        setTplId((cur) => cur || def || list?.[0]?.id || '');
      })
      .catch(() => {});
  }, [reloadBooks]);

  /* Remember which project you are on, so a refresh lands back here. */
  useEffect(() => {
    if (slug) saveSlug(slug);
  }, [slug]);

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
  const craftArgs = useCallback(() => {
    const a = {};
    if (craft.gutter) a.gutter = Number(gutterMm) || 8;
    if (craft.bleed) a.bleed = Number(bleedMm) || 3;
    if (craft.recto) a.startRecto = true;
    return a;
  }, [craft, gutterMm, bleedMm]);

  const doStep = useCallback(async (tool, { quiet } = {}) => {
    if (!slug || busy) return;
    const ac = new AbortController();
    abortRun.current = ac;
    setBusy(tool);
    setNotice(null);
    if (tool === 'check') setTab('check');
    if (tool === 'shot') setTab('shots');
    if (tool === 'check' || tool === 'shot' || tool === 'export') setPane('out');
    if (!quiet) setLines([]);

    try {
      const res = await api.run(tool, slug, {
        edition,
        args: tool === 'build' ? craftArgs() : undefined,
        signal: ac.signal,
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
      /* A cancelled run is a choice, not a failure. */
      if (e.message !== 'cancelled') {
        setNotice({ kind: 'bad', text: e.message });
        setLines((l) => [...l, { kind: 'err', tool, text: String(e.message) }]);
      }
    } finally {
      setBusy('');
    }
  }, [slug, busy, edition, reloadBooks, refreshShots, craftArgs]);

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
      await api.newBook(s, tplId || undefined);
      setShowNew(false);
      setNewSlug('');
      await reloadBooks(s);
      setNotice({
        kind: 'ok',
        text: `created books/${s} from the ${chosenTpl?.name || 'starter'} template. Open its interior and start writing.`,
      });
    } catch (e) {
      setNotice({ kind: 'bad', text: e.message });
    }
  };

  /* ------------------------------------------------- resize the side panels
     A splitter reports the pointer's clientX; this turns it into a width for
     one side, clamped so the middle never drops below what a page needs. The
     left panel grows from the grid's left edge, the right from its right edge,
     and the space the middle must keep is the same sum written twice. */
  const dragEdit = (clientX) => {
    const el = gridRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const reserved = (layout.outOpen ? layout.outW + SPLIT_W : RAIL_W) + SPLIT_W + PREVIEW_MIN;
    const cap = Math.min(EDIT_MAX, r.width - reserved);
    setEditW(Math.max(EDIT_MIN, Math.min(cap, clientX - r.left)));
  };
  const dragOut = (clientX) => {
    const el = gridRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const reserved = (layout.editOpen ? layout.editW + SPLIT_W : RAIL_W) + SPLIT_W + PREVIEW_MIN;
    const cap = Math.min(OUT_MAX, r.width - reserved);
    setOutW(Math.max(OUT_MIN, Math.min(cap, r.right - clientX)));
  };

  /* ------------------------------------------------------- delete a project
     The whole folder goes: the four source files and everything the engine
     generated from them. The dialog makes you type the slug, because there is
     no undo and no trash. */
  const canDelete = !!slug && slug !== 'starter';
  const deleteBook = async () => {
    if (!canDelete || busy) return;
    const s = slug;
    try {
      const { removed } = await api.deleteBook(s, deleteWord.trim());
      setShowDelete(false);
      setDeleteWord('');
      await reloadBooks();
      setNotice({ kind: 'ok', text: `deleted books/${s} — ${removed} file(s), pages and PDFs included.` });
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

  /* One way to reach a sheet, used by the check table, the board, the dashboard
     and the jump box. Manual scrollTop rather than scrollIntoView: the desk
     inside the iframe is the scroll box, so scrollIntoView lands on the wrong
     edge here. */
  const scrollToSheet = useCallback((n) => {
    const doc = document.querySelector('.col-preview iframe')?.contentDocument;
    if (!doc) return false;
    const i = Math.max(1, Number(n) || 1) - 1;
    const sheet = doc.querySelectorAll('.sheet')[i];
    if (!sheet) return false;
    const top = sheet.getBoundingClientRect().top - doc.body.getBoundingClientRect().top
      + (doc.documentElement.scrollTop || doc.body.scrollTop || 0);
    (doc.scrollingElement || doc.documentElement).scrollTop = top;
    return true;
  }, []);

  const goToSheet = (n) => { scrollToSheet(n); };

  /* Export, wait, then open. Opening first and exporting after is the race that
     showed a stale or half-written PDF. The window is opened only once the file
     on disk is the one we just wrote. */
  const openPdf = async () => {
    if (busy || !slug) return;
    const ac = new AbortController();
    abortRun.current = ac;
    setBusy('export');
    setNotice(null);
    try {
      const res = await api.run('export', slug, {
        edition,
        signal: ac.signal,
        onLine: (d) => setLines((l) => [...l, { kind: d.kind, tool: 'export', text: d.text }]),
      });
      if (res.code !== 0) {
        setNotice({ kind: 'bad', text: 'export failed, so the PDF was not opened' });
        return;
      }
      window.open(`${pdfHref}?t=${Date.now()}`, '_blank', 'noopener');
    } catch (e) {
      setNotice({ kind: 'bad', text: e.message === 'cancelled' ? 'export cancelled' : `export failed: ${e.message}` });
    } finally {
      setBusy('');
    }
  };

  /* An edition is a different file on disk (book-<edition>.html), so "is it
     built" is a different question for an edition than for the main book.
     Getting this wrong points the preview iframe at a 404. */
  const isBuilt = edition
    ? (book?.builtEditions || []).includes(edition)
    : !!book?.hasBookHtml;

  return (
    <div
      className="app"
      data-pane={pane}
      data-hide-edit={wide && !layout.editOpen ? '1' : undefined}
      data-hide-out={wide && !layout.outOpen ? '1' : undefined}
      style={{ '--edit-w': `${layout.editW}px`, '--out-w': `${layout.outW}px` }}
    >
      {/* ------------------------------------------------------------ header */}
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <rect x="4.25" y="3.25" width="15.5" height="17.5" rx="2" stroke="currentColor" strokeWidth="1.6" />
              <path d="M7.5 8h9M7.5 11.5h9M7.5 15h5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".45" />
              <circle cx="17" cy="17.5" r="3" stroke="currentColor" strokeWidth="1.6" />
              <path d="M17 14.6v5.8M14.1 17.5h5.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <span className="brand-name">Proofpress</span>
            <span className="brand-tag">One concept per page · B5</span>
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
          <button
            className="mini danger"
            onClick={() => { setDeleteWord(''); setShowDelete(true); }}
            disabled={!canDelete || !!busy}
            title={slug === 'starter'
              ? 'books/starter is the template every new book is scaffolded from, so it is not deletable here'
              : `Delete books/${slug} for good`}
          >
            delete book
          </button>
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
          <span>Start a new book:</span>
          <input
            autoFocus
            placeholder="my-book"
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createBook()}
          />
          <select
            className="tpl-pick"
            value={tplId}
            onChange={(e) => setTplId(e.target.value)}
            title="Which scaffold to copy. The theme, the page size and the voice come with it."
          >
            {templates.length === 0 ? <option value="">starter</option> : null}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.theme}/{t.size}
              </option>
            ))}
          </select>
          <button className="mini primary" onClick={createBook}>create</button>
          <button className="mini" onClick={() => setShowNew(false)}>cancel</button>
          {chosenTpl ? <p className="tpl-note">{chosenTpl.blurb}</p> : null}
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

        <div className={'toolbar-group craft' + (craftOpen ? ' open' : '')}>
          <span className="sep" />

          {/* Print-craft switches. Off by default: a plain build is byte-for-byte
              the same as without the cockpit. */}
          <label className="toggle craft-ck" title="Extra margin on the bound edge">
            <input type="checkbox" checked={craft.gutter}
              onChange={(e) => setCraft((c) => ({ ...c, gutter: e.target.checked }))} />
            <span>gutter</span>
          </label>
          {craft.gutter ? (
            <input className="mm" type="number" min="0" max="40" value={gutterMm}
              title="gutter in mm"
              onChange={(e) => setGutterMm(e.target.value)} />
          ) : null}
          <label className="toggle craft-ck" title="Paper colour runs into the trim (this is the one deliberate size change)">
            <input type="checkbox" checked={craft.bleed}
              onChange={(e) => setCraft((c) => ({ ...c, bleed: e.target.checked }))} />
            <span>bleed</span>
          </label>
          {craft.bleed ? (
            <input className="mm" type="number" min="0" max="20" value={bleedMm}
              title="bleed in mm"
              onChange={(e) => setBleedMm(e.target.value)} />
          ) : null}
          <label className="toggle craft-ck" title="Every part opens on a right-hand (odd) page">
            <input type="checkbox" checked={craft.recto}
              onChange={(e) => setCraft((c) => ({ ...c, recto: e.target.checked }))} />
            <span>recto</span>
          </label>
        </div>

        <button
          className="mini toolbar-more"
          type="button"
          aria-expanded={craftOpen}
          aria-label="Print-craft switches"
          onClick={() => setCraftOpen((o) => !o)}
        >
          {craftOpen ? 'done' : 'craft'}
        </button>

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
        <div className={'notice ' + notice.kind} role="status" onClick={() => setNotice(null)}>
          {notice.text}
        </div>
      ) : null}

      {/* One pane at a time below 1100px, where the three columns cannot all
          fit. Desktop ignores this entirely: all three stay visible. */}
      <div className="paneswitch" role="group" aria-label="Show pane">
        {[
          ['edit', 'source'],
          ['preview', 'preview'],
          ['out', 'tools'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={pane === id}
            onClick={() => setPane(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* -------------------------------------------------------------- main */}
      <main className="grid" ref={gridRef}>
        {wide && !layout.editOpen ? (
          <button
            className="rail rail-left"
            onClick={() => setEditOpen(true)}
            title="Show the source panel"
            aria-label="Show the source panel"
          >
            <span className="rail-label">source</span>
          </button>
        ) : null}

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
            {wide ? (
              <button
                className="iconbtn"
                onClick={() => setEditOpen(false)}
                title="Hide the source panel"
                aria-label="Hide the source panel"
              >
                <span aria-hidden="true">«</span>
              </button>
            ) : null}
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

        {wide && layout.editOpen ? (
          <Splitter
            label="Resize the source panel"
            value={layout.editW}
            min={EDIT_MIN}
            max={EDIT_MAX}
            onDrag={dragEdit}
            onNudge={(dir) => setEditW(layout.editW + dir * NUDGE)}
          />
        ) : null}

        <section className="col col-preview">
          <Preview book={slug} edition={edition} refreshKey={refreshKey} built={isBuilt} />
          <div className="jump">
            <label htmlFor="jump-sheet">sheet</label>
            <input
              id="jump-sheet"
              type="number"
              min="1"
              placeholder="1"
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                const n = Math.max(1, Number(jump) || 1);
                if (!scrollToSheet(n)) {
                  setNotice({
                    kind: 'bad',
                    text: `this book has no sheet ${n}. Enter a number between 1 and the page count.`,
                  });
                }
              }}
            />
          </div>
        </section>

        {wide && layout.outOpen ? (
          <Splitter
            label="Resize the tools panel"
            value={layout.outW}
            min={OUT_MIN}
            max={OUT_MAX}
            onDrag={dragOut}
            onNudge={(dir) => setOutW(layout.outW - dir * NUDGE)}
          />
        ) : null}

        <section className="col col-out">
          <div className="col-head">
            <OutTabs tab={tab} onPick={setTab} shots={shots} lines={lines} checkResult={checkResult} />
            {wide ? (
              <button
                className="iconbtn"
                onClick={() => setOutOpen(false)}
                title="Hide the tools panel"
                aria-label="Hide the tools panel"
              >
                <span aria-hidden="true">»</span>
              </button>
            ) : null}
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

        {wide && !layout.outOpen ? (
          <button
            className="rail rail-right"
            onClick={() => setOutOpen(true)}
            title="Show the tools panel"
            aria-label="Show the tools panel"
          >
            <span className="rail-label">tools</span>
          </button>
        ) : null}
      </main>

      {/* Deleting a project takes the whole folder with it, so it asks for the
          slug itself rather than a yes/no: a click cannot be a slip. */}
      {showDelete ? (
        <div
          className="modal-scrim"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowDelete(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setShowDelete(false); }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="del-title">
            <h2 id="del-title" className="modal-title">Delete books/{slug}?</h2>
            <p className="modal-body">
              This removes the whole folder: the interior, <code>book.json</code>, VOICE.md and
              blocks.md, plus everything the engine generated — <code>book.html</code>, every page
              PNG, the PDFs and the images. <strong>There is no undo and no trash.</strong>
            </p>
            <label className="modal-field">
              <span>Type <code>{slug}</code> to confirm</span>
              <input
                autoFocus
                value={deleteWord}
                placeholder={slug}
                onChange={(e) => setDeleteWord(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && deleteWord.trim() === slug) deleteBook();
                  if (e.key === 'Escape') setShowDelete(false);
                }}
              />
            </label>
            <div className="modal-actions">
              <button className="mini" onClick={() => setShowDelete(false)}>cancel</button>
              <button className="mini danger" onClick={deleteBook} disabled={deleteWord.trim() !== slug}>
                delete forever
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}