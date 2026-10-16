/* Monaco, served from node_modules rather than a CDN, so the UI works offline
   like the rest of the engine. @monaco-editor/react's default loader fetches
   Monaco from a CDN, which would break that, so the workers are wired here and
   the `loader.config({ monaco })` call in Editor.jsx points at this instance. */
/* The specifiers below deliberately omit the `esm/vs/` prefix. monaco-editor's
   exports map is { "./*": "./esm/vs/*.js" }, so writing
   `monaco-editor/esm/vs/editor/editor.worker` resolves to
   `./esm/vs/esm/vs/editor/editor.worker.js` and does not exist. */
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker?worker';
import cssWorker from 'monaco-editor/language/css/css.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new jsonWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

export default monaco;