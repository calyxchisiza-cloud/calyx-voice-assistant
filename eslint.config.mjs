import { FlatCompat } from '@eslint/eslintrc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'dist-desktop/**'],
  },
  {
    // These files run in Node, outside the Next.js/React build, and must use
    // CommonJS: Electron does not load an ESM main process, and electron-builder
    // requires a CommonJS config module. The app's ESM-only rule does not apply.
    files: ['desktop/**/*.js', '*.cjs', 'scripts/**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];

export default eslintConfig;
