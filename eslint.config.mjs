import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * Base: next/core-web-vitals (already bundles react, jsx-a11y baseline).
 * Extra jsx-a11y rules keep the dashboard usable by screen-reader users +
 * keyboard-only nav. Most small-business customers are on iPhones —
 * keyboard a11y rules also catch common touch-target bugs.
 */
const config = [
  ...compat.extends('next/core-web-vitals'),
  ...compat.extends('plugin:jsx-a11y/recommended'),
  {
    rules: {
      'jsx-a11y/anchor-is-valid': 'warn',
      'jsx-a11y/label-has-associated-control': 'warn',
      'jsx-a11y/no-autofocus': 'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
    },
  },
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'public/**',
      '**/*.d.ts',
    ],
  },
];

export default config;
