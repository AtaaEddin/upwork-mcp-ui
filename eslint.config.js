// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'data/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.cjs'],
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Node dev-time scripts (e.g. web/scripts/browser-verify.mjs): declare the
    // globals they reference — no `globals` package dependency for this.
    // (`location` appears inside page-evaluation callbacks that run in the
    // browser context.)
    files: ['web/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        location: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        document: 'readonly',
      },
    },
  },
);
