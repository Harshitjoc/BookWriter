import { useEffect, useRef } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import monaco from '../monaco.js';

/* Force the bundled Monaco instead of @monaco-editor/react's default CDN
   fetch. See monaco.js for why. */
loader.config({ monaco });

export default function SourceEditor({ value, language, path, readOnly, onChange, onSave }) {
  const ref = useRef(null);

  /* Ctrl/Cmd+S saves, because that is what everyone presses and the engine's
     whole loop is save -> build. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onSave?.();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [onSave]);

  return (
    <div className="editor" ref={ref}>
      <Editor
        value={value}
        language={language}
        path={path}
        theme="vs-dark"
        onChange={(v) => onChange?.(v ?? '')}
        options={{
          fontSize: 13,
          fontFamily: 'var(--mono)',
          lineHeight: 20,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          renderWhitespace: 'selection',
          tabSize: 2,
          wordWrap: language === 'markdown' ? 'on' : 'off',
          automaticLayout: true,
          readOnly,
          padding: { top: 10, bottom: 10 },
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        }}
        loading={<div className="editor-loading">loading the editor…</div>}
      />
    </div>
  );
}