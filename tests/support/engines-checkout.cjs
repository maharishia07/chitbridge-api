/**
 * tests/support/engines-checkout.cjs - until an engines tag is adopted (tools/adopt.cjs), the api's lib/ holds the released copies. A test that proves a change which reads a NEWER engine
 * preloads this file (node -r ./tests/support/engines-checkout.cjs tests/<test>.cjs, or requires it first): with CB_ENGINES_DIR set, the four engines the tax path reads
 * (gst-returns, tax, tax-packs, regulation) are the CHECKOUT's. No CB_ENGINES_DIR: nothing changes. Never loaded by the server.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const dir = process.env.CB_ENGINES_DIR ? path.join(path.resolve(process.env.CB_ENGINES_DIR), 'src') : null;
if (dir && fs.existsSync(path.join(dir, 'gst-returns.js'))) {
  for (const name of ['gst-returns', 'tax', 'tax-packs', 'regulation']) {
    const file = require.resolve(path.join(__dirname, '..', '..', 'lib', name));
    require.cache[file] = { id: file, filename: file, loaded: true, exports: require(path.join(dir, name)), children: [], paths: [] };
  }
}
