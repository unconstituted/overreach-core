import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'reference/', 'coverage/', 'public/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tools/**/*.mjs', 'tools/**/*.ts'],
    // window and document appear inside page.evaluate callbacks, which run in the browser.
    languageOptions: { globals: { process: 'readonly', console: 'readonly', window: 'readonly', document: 'readonly' } },
  },
  {
    // The core must stay portable: no DOM, no Three.js, no browser APIs.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['three', 'three/*', '**/web/*', '**/devices/*'] }],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'localStorage', 'fetch',
        'requestAnimationFrame', 'performance', 'AudioContext', 'HTMLElement', 'setTimeout', 'setInterval'],
    },
  },
);
