import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api.js';

/* The diagram studio. A diagram is inline SVG compiled from a JSON spec by
 * engine/tools/diagram.mjs — the SAME compiler a page is built with. Nothing
 * here draws; it edits a spec, asks the server to compile it, and shows the
 * result. What you see is byte-for-byte what the page would get.
 *
 * The output is a <figure> snippet you paste into a page, or copy as raw SVG.
 * It is never written to disk on its own: a diagram belongs inside a page, and
 * placing it is a decision a person makes. */

const pretty = (o) => JSON.stringify(o, null, 2);

export default function DiagramStudio({ book, onInsert }) {
  const [shapes, setShapes] = useState([]);
  const [kind, setKind] = useState('row');
  const [specText, setSpecText] = useState('');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const compiled = useRef(0);

  useEffect(() => {
    api.getDiagramShapes()
      .then((d) => setShapes(d.shapes || []))
      .catch((e) => setError(e.message));
  }, []);

  const loadExample = useCallback(async (k) => {
    setKind(k);
    setError('');
    try {
      const d = await api.getDiagramExample(k);
      setSpecText(pretty(d.spec));
      setSvg(d.svg);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { loadExample('row'); }, [loadExample]);

  /* Compile on edit, debounced so typing JSON does not fire a request a keystroke. */
  useEffect(() => {
    if (!specText.trim()) return;
    const ticket = ++compiled.current;
    const t = setTimeout(async () => {
      let spec;
      try { spec = JSON.parse(specText); }
      catch (e) { setError(`spec is not valid JSON: ${e.message}`); return; }
      try {
        const out = await api.compileDiagram(spec);
        if (ticket === compiled.current) { setSvg(out); setError(''); }
      } catch (e) {
        if (ticket === compiled.current) setError(e.message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [specText]);

  const snippet = svg ? `<figure class="diagram">\n  ${svg}\n</figure>` : '';

  const copy = async (what) => {
    const text = what === 'svg' ? svg : snippet;
    try { await navigator.clipboard.writeText(text); setCopied(what); }
    catch { setError('the browser refused clipboard access'); }
    setTimeout(() => setCopied(''), 1500);
  };

  return (
    <div className="draft studio">
      <p className="hint">
        Shapes are compiled, not drawn. Edit the spec and the SVG updates. Paste the
        <code> &lt;figure&gt;</code> into a page, or copy the raw SVG.
      </p>

      <div className="draft-form">
        <label>
          <span>shape</span>
          <select value={kind} onChange={(e) => loadExample(e.target.value)}>
            {shapes.map((s) => <option key={s.kind} value={s.kind}>{s.kind}</option>)}
          </select>
        </label>
        <span className="dim grow studio-use">
          {shapes.find((s) => s.kind === kind)?.use || ''}
        </span>
      </div>

      <div className="studio-split">
        <label className="studio-spec">
          <span>spec (JSON)</span>
          <textarea
            spellCheck={false}
            value={specText}
            onChange={(e) => setSpecText(e.target.value)}
          />
        </label>
        <div className="studio-preview">
          <span className="studio-label">preview</span>
          {svg
            ? <div className="studio-svg" dangerouslySetInnerHTML={{ __html: svg }} />
            : <p className="dim studio-empty">no diagram yet</p>}
        </div>
      </div>

      {error ? <p className="alert">{error}</p> : null}

      <div className="draft-actions">
        <button className="mini" onClick={() => copy('svg')} disabled={!svg}>
          {copied === 'svg' ? 'copied' : 'copy svg'}
        </button>
        <button className="mini" onClick={() => copy('figure')} disabled={!svg}>
          {copied === 'figure' ? 'copied' : 'copy figure'}
        </button>
        <button className="mini primary" onClick={() => onInsert?.(snippet)} disabled={!snippet}>
          insert into page
        </button>
      </div>
    </div>
  );
}
