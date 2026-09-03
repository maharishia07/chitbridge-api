#!/usr/bin/env node
/**
 * mirror-pure-libs.cjs — copy a TIER A pure lib into the web repo as a classic script.
 *
 * Athi, 2026-09-03: *"each tab in the catalogue is going to attach those and it has to showcase the outcome …
 * so it can be verified then and there."* The product's Pricing & tax pane has to show the INVOICE OUTCOME of an
 * attached slab, which means the browser needs `tax.js`'s determination — the real one.
 *
 * ── ⚠️⚠️ WHY A GENERATOR AND NOT A HAND COPY ────────────────────────────────────────────────────────────────────
 * The two repos deploy separately, so there is no `require` across them and the browser cannot reach
 * `chitbridge-api/lib`. Something has to cross. The one thing that must NOT cross is a RETYPED copy: an invoice
 * split that is nearly the same in two places is the worst possible defect — it agrees on every example anyone
 * tries and diverges on the one that matters. So the body is copied BYTE FOR BYTE, and the only edit is the
 * export line, which is the only line that differs between Node and a classic script.
 *
 * ⚠️ THE API FILE IS AUTHORITATIVE, ALWAYS. Run this after changing either lib; never edit the generated file.
 * `node scripts/mirror-pure-libs.cjs --check` exits 1 if the web copy is stale, so a commit can be gated on it.
 *
 * ⚠️ THE BODY IS NOT RE-INDENTED. JavaScript does not care, and re-indentation would make every future diff
 * against the source unreadable — which is precisely how a mirror stops being checked.
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* Each entry: the pure lib, the global it takes in a browser, and the web file it becomes. */
const MIRRORS = [
  { lib: 'tax.js',      global: 'CBTax',     out: 'tax.js' },
  { lib: 'tax-slab.js', global: 'CBTaxSlab', out: 'tax-slab.js' },
];

const API_LIB = path.join(__dirname, '..', 'lib');
/* The sibling checkout. ⚠️ Resolved from THIS file, so it works from a worktree as well as from main. */
const WEB_APP = process.env.CB_WEB_APP
  || path.join(__dirname, '..', '..', 'chitbridge-web', 'public', 'app');

/**
 * ⚠️ LINE ENDINGS ARE NORMALISED TO LF BEFORE ANYTHING ELSE. On Windows two checkouts of the same repo can
 * differ in nothing but CRLF — my first `--check` reported the mirror STALE against a byte-identical source,
 * which is the worst kind of guard: it cries wolf until somebody stops listening to it.
 */
const lf = (s) => String(s).replace(/\r\n/g, '\n');

/** The `module.exports = { … };` tail, turned into a browser global. Nothing else in the body is touched. */
function wrap(srcRaw, name, globalName) {
  const src = lf(srcRaw);
  const m = src.match(/\nmodule\.exports\s*=\s*(\{[\s\S]*?\});\s*$/);
  if (!m) throw new Error(name + ': no trailing `module.exports = { … };` to convert');
  const body = src.slice(0, m.index);
  return '/* ⚠️⚠️ GENERATED — DO NOT EDIT. A byte-for-byte mirror of chitbridge-api/lib/' + name + ',\n'
    + ' * produced by chitbridge-api/scripts/mirror-pure-libs.cjs. That file is AUTHORITATIVE; edit it there and\n'
    + ' * re-run the generator. A retyped copy of an invoice split is the worst defect available: it agrees on\n'
    + ' * every example anyone tries and diverges on the one that matters.\n'
    + ' *\n'
    + ' * Wrapped in an IIFE so the pure module\'s own names (r2 · num · pick · determine) never become globals —\n'
    + ' * e2e/dup-functions.cjs is right to forbid that, and `pick` would collide with app/pick.js today.\n'
    + ' */\n'
    + '(function (root) {\n'
    + body
    + '\nroot.' + globalName + ' = ' + m[1] + ';\n'
    + '})(typeof globalThis !== \'undefined\' ? globalThis : this);\n';
}

const check = process.argv.includes('--check');
let stale = 0;
for (const spec of MIRRORS) {
  const src = fs.readFileSync(path.join(API_LIB, spec.lib), 'utf8');
  const want = wrap(src, spec.lib, spec.global);
  const dest = path.join(WEB_APP, spec.out);
  const have = fs.existsSync(dest) ? lf(fs.readFileSync(dest, 'utf8')) : null;
  if (have === want) { console.log('ok      ' + spec.out); continue; }
  if (check) { console.log('STALE   ' + spec.out + '  (run: node scripts/mirror-pure-libs.cjs)'); stale++; continue; }
  fs.writeFileSync(dest, want);
  console.log('written ' + spec.out + '  ← lib/' + spec.lib);
}
if (check && stale) process.exit(1);
