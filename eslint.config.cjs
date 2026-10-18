/* eslint.config.cjs — ESLint 9 flat config, DEV-ONLY and WARN-ONLY (MNT-1). Every rule is a warning; nothing here fails a build.
 * OWNS      which rules the lint ratchet counts (tools/lint-ratchet.cjs). CALLED BY that tool and editors. CARD qa/lint-ratchet
 * The packages come from $CB_LINT_TOOL / C:/dev/toolset/lint-tool, not from this repo's package.json (yet).
 * Rules = eslint:recommended as warnings, plus no empty catch and no shadowing. no-undef is OFF: the pages are classic scripts that share globals across files
 * (19,049 false alarms on 18 Oct); unused-vars counts function-local names only for the same reason. A globals manifest is iteration-1 work (MNT-4).*/
'use strict';
const path = require('path');
const { createRequire } = require('module');

const places = [process.env.CB_LINT_TOOL, 'C:/dev/toolset/lint-tool', __dirname].filter(Boolean);
function load(name) {
  for (const dir of places) { try { return createRequire(path.join(dir, 'x.js'))(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; } }
  throw new Error('eslint.config.cjs: cannot find ' + name);
}
const js = load('@eslint/js');
const globals = load('globals');

const asWarnings = Object.fromEntries(Object.keys(js.configs.recommended.rules).map((rule) => [rule, 'warn']));

module.exports = [
  { ignores: ['**/node_modules/**', '**/vendor/**', '**/dist/**', '**/tally-connector/**', 'public/till.html', 'public/promo.html', 'migrations/**', '**/*.min.js'] },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      // browser pages (web) and Node tools both live here; the page globals are the ones the apps share
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 }
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: { ...asWarnings, 'no-empty': ['warn', { allowEmptyCatch: false }], 'no-shadow': 'warn', 'no-var': 'off', 'no-undef': 'off', 'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }] }
  },
  { files: ['**/*.mjs'], languageOptions: { sourceType: 'module' } }
];
