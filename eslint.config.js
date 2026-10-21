import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/* The browser globals the cockpit actually uses. Hand-listed rather than pulling
   in the `globals` package: it is a short list, and an unknown name showing up
   as `no-undef` is a useful signal, not noise. */
const BROWSER = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly',
  fetch: 'readonly', console: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', queueMicrotask: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly',
  AbortController: 'readonly', AbortSignal: 'readonly',
  TextDecoder: 'readonly', TextEncoder: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', crypto: 'readonly',
  btoa: 'readonly', atob: 'readonly',
  Blob: 'readonly', File: 'readonly', FileReader: 'readonly', FormData: 'readonly',
  Event: 'readonly', CustomEvent: 'readonly', HTMLElement: 'readonly', Element: 'readonly',
  ResizeObserver: 'readonly', MutationObserver: 'readonly', IntersectionObserver: 'readonly',
  performance: 'readonly', structuredClone: 'readonly',
  getComputedStyle: 'readonly', self: 'readonly', matchMedia: 'readonly',
};

/* The engine, the server and the tests are node, and they run whatever the
   build machine has. */
const NODE = {
  process: 'readonly', console: 'readonly', Buffer: 'readonly',
  __dirname: 'readonly', __filename: 'readonly', global: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  setImmediate: 'readonly', queueMicrotask: 'readonly', structuredClone: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly',
  TextDecoder: 'readonly', TextEncoder: 'readonly',
  fetch: 'readonly', AbortController: 'readonly', crypto: 'readonly',
};

export default [
  {
    /* Generated, vendored, or a build output. None of it is ours to lint. */
    ignores: ['dist/**', 'node_modules/**', 'books/**', 'cockpit-shots/**', 'public/**'],
  },

  js.configs.recommended,

  {
    files: ['src/client/**/*.js', 'src/client/**/*.jsx', 'src/shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: BROWSER,
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      'react-refresh/only-export-components': 'warn',
      /* Loading data on mount means flipping a loading flag, which is a setState
         in an effect. The rule is about avoiding cascading renders; a panel that
         fetches on mount has to do this, and it is not a mistake worth failing a
         build over. Kept as a warning so a genuinely pointless one still shows. */
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  {
    files: ['src/engine/**/*.js', 'src/engine/**/*.mjs', 'src/server/**/*.mjs', 'tests/**/*.mjs', 'vite.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: NODE },
  },

  {
    /* These files drive a real browser. The engine measures pages inside
       page.evaluate(), and the UI test does the same, so a block of each file
       runs in the page and legitimately touches document/window/getComputedStyle.
       It is node file, browser payload — both sets of globals are true here. */
    files: [
      'src/engine/**/*.js',
      'src/engine/tools/**/*.mjs',
      'tests/ui.test.mjs',
      'tests/motion.test.mjs',
    ],
    languageOptions: { globals: { ...NODE, ...BROWSER } },
  },
];
