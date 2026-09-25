import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Phase A (Sanierungsplan, Paket 3): ESLint 9 Flat Config.
// Bewusst ohne Massen-Fixes an src/ — die Baseline wird über
// --max-warnings=<N> im "lint"-Script eingefroren (siehe package.json).
// N entspricht der beim Einrichten (2026-08-31) gemessenen Warnungszahl
// und darf nur sinken, nie steigen.
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'src-tauri/**', 'docs/**', 'scripts/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
