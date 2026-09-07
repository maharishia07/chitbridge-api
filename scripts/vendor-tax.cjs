/**
 * vendor-tax.cjs — THE TAX ENGINE, MADE PORTABLE (the till, 2026-09-07).
 *
 * A till has to price a bill with the internet unplugged, and tax is the last engine that only ran on the server.
 * The offer engine solved this years-of-bugs problem the boring way: ONE source file, copied byte-for-byte to the other side, with a
 * test that fails the day they drift. Same trick here — but generated rather than hand-copied, because two files (lib/tax.js and
 * lib/tax-slab.js) have to become one browser script.
 *
 * ⚠️ THE SERVER FILES ARE THE MASTER. Nothing here edits them, and nobody should ever edit public/app/tax-engine.js by hand: it says so
 * in its own first line, and tests/tax-vendor.test.js regenerates it and fails if what is on disk differs.
 *
 * Run: node scripts/vendor-tax.cjs        (writes the file)
 *      node scripts/vendor-tax.cjs --check (exit 1 if the file on disk is stale — what the test uses)
 */
'use strict';
const fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
/* two homes, one generator: the app loads it from the web bundle, and /api/till/engine/tax serves the copy that ships with THIS repo
   (Railway deploys the API alone, so a path into the web repo would be a file that does not exist in production). */
const OUTS = [ path.join(API, '..', 'chitbridge-web', 'public', 'app', 'tax-engine.js'), path.join(API, 'lib', 'tax-engine.browser.js') ];

/** strip the module wrapper a browser cannot use: 'use strict' (the IIFE supplies it) and the module.exports line. */
/** the names a file exports, read from its own module.exports — so the wrapper below returns exactly what the server does. */
function exportsOf(file) {
  const raw = fs.readFileSync(path.join(API, 'lib', file), 'utf8');
  const m = /module\.exports\s*=\s*\{([\s\S]*?)\}\s*;/.exec(raw);
  if (!m) throw new Error('no module.exports in ' + file);
  return m[1].split(',').map((x) => x.split(':')[0].trim()).filter(Boolean);
}

/**
 * ⚠️ EACH FILE KEEPS ITS OWN SCOPE. Both engines declare a top-level `num`, so pasting them one after the other does not parse
 * (caught the first time this ran). Each body goes inside its own closure and hands back exactly the names it exported.
 */
function wrap(file) {
  const names = exportsOf(file);
  return ['(function () {', body(file), '  return { ' + names.map((n) => n + ': ' + n).join(', ') + ' };', '})()'].join('\n');
}

function body(file) {
  const raw = fs.readFileSync(path.join(API, 'lib', file), 'utf8').replace(/\r\n/g, '\n');
  /* ⚠️ CUT THE EXPORT FIRST, AND TO THE END OF THE FILE. tax-slab's module.exports spans four lines; dropping only the line that
     starts it left its tail behind and the generated file did not parse (caught the first time this ran). */
  return raw
    .replace(/\n\s*module\.exports[\s\S]*$/, '\n')
    .split('\n')
    .filter((l) => !/^\s*'use strict';\s*$/.test(l))
    .join('\n')
    .trimEnd();
}

function generate() {
  const stamp = 'GENERATED FILE — DO NOT EDIT. Written by chitbridge-api/scripts/vendor-tax.cjs from lib/tax.js + lib/tax-slab.js.';
  return [
    '/* ' + stamp,
    ' *',
    ' * THE TAX ENGINE, IN THE BROWSER AND ON THE TILL. The server files are the master; this copy exists so a till can price a bill',
    ' * with the internet unplugged, and so the screen shows the same figure the chit will carry. tests/tax-vendor.test.js regenerates',
    ' * this file and fails if it differs — the same discipline that keeps app/offers.js and lib/offers-engine.js identical.',
    ' *',
    ' * Exposes  window.CBTax = { determine, supplyType, r2, systemProvider, slab: { resolve, slabOf, indexSlabs, applyToLine, ... } }',
    ' */',
    '(function (root) {',
    '  \'use strict\';',
    '',
    '/* ── from lib/tax-slab.js — what rate a product carries ─────────────────────────────────────────────────── */',
    'var __slab = ' + wrap('tax-slab.js') + ';',
    '',
    '/* ── from lib/tax.js — what that rate becomes between two addresses ─────────────────────────────────────── */',
    'var __tax = ' + wrap('tax.js') + ';',
    '',
    '  root.CBTax = { determine: __tax.determine, supplyType: __tax.supplyType, systemProvider: __tax.systemProvider, r2: __tax.r2, slab: __slab };',
    '  if (typeof module !== \'undefined\' && module.exports) module.exports = root.CBTax;   /* the till loads it as a module too */',
    '})(typeof window !== \'undefined\' ? window : this);',
    '',
  ].join('\n');
}

const text = generate();
if (process.argv.includes('--check')) {
  for (const OUT of OUTS) {
    const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (have !== text) { console.log('STALE: ' + OUT + ' differs from lib/tax.js + lib/tax-slab.js — run node scripts/vendor-tax.cjs'); process.exit(1); }
  }
  console.log('both tax-engine copies are current'); process.exit(0);
}
for (const OUT of OUTS) { fs.writeFileSync(OUT, text); console.log('wrote ' + OUT + ' (' + text.length + ' bytes)'); }
