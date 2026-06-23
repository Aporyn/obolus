// @ts-check
// ESLint v9 flat config for Obolus — a TypeScript ESM project (Node + vitest).
// Type checking is left to `tsc` (strict, see tsconfig.json); ESLint here is a
// fast, complementary lint pass. Keep it aligned with the repo conventions in
// CLAUDE.md: TypeScript, no `any`, Prettier owns formatting.
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Build output and generated artifacts. (node_modules / .git are ignored by
  // ESLint's defaults.)
  {
    ignores: ['dist/**', 'coverage/**'],
  },

  // Baseline JS recommended rules for every linted file.
  eslint.configs.recommended,

  // TypeScript recommended rules, scoped to .ts files. This preset also turns
  // off core rules the TypeScript compiler already covers (e.g. no-undef), so
  // they don't double-report on typed code. Project rule tweaks live here too,
  // where the @typescript-eslint plugin is registered.
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended],
    rules: {
      // Allow intentionally-unused identifiers when prefixed with `_`
      // (e.g. unused function args, caught errors, destructured siblings).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // Shared language options: ES2022 modules running on Node.
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
);
