/* eslint.config.cjs — ESLint 9 flat config, DEV-ONLY and WARN-ONLY (MNT-1). Every rule is a warning; nothing here fails a build.
 * OWNS      which rules the lint ratchet counts (tools/lint-ratchet.cjs). CALLED BY that tool and editors. CARD qa/lint-ratchet
 * The packages come from $CB_LINT_TOOL / C:/dev/toolset/lint-tool, not from this repo's package.json (yet).
 * Rules = eslint:recommended as warnings, plus no empty catch and no shadowing. no-redeclare ignores built-in globals: every Node file is a module, so `const crypto = require('crypto')` shadows nothing (43 false alarms, 21 Oct). no-undef is OFF: the pages are classic scripts that share globals across files
 * (19,049 false alarms on 18 Oct); unused-vars counts function-local names only for the same reason. The globals manifest (iteration 1, MNT-4) is eslint.globals.json; no-undef is opt-in via CB_LINT_NOUNDEF=1.*/
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
    rules: { ...asWarnings, 'no-empty': ['warn', { allowEmptyCatch: false }], 'no-shadow': 'warn', 'no-redeclare': ['warn', { builtinGlobals: false }], 'no-var': 'off', 'no-undef': 'off', 'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }] }
  },
  { files: ['**/*.mjs'], languageOptions: { sourceType: 'module' } },
  // tools/sim-load.cjs returns at its top level when it is required (valid in a Node CommonJS wrapper)
  { files: ['tools/sim-load.cjs'], languageOptions: { sourceType: 'commonjs' } },
  // opt-in: CB_LINT_NOUNDEF=1 turns no-undef on with the globals each page really shares (regenerate: node C:/dev/toolset/iter1/globals-manifest.cjs api --write)
  ...(process.env.CB_LINT_NOUNDEF ? require('./eslint.noundef.cjs') : [])
];
