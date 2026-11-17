/* field-ledger-guard.cjs — NO FIELD LEFT UNTURNED, the web half (Athi, 2026-10-09).
 *
 * The product FIELD LEDGER lives in the API (data/cmdb/CAP-FIELDS-PRODUCT-*.json; guard tests/field-ledger.test.cjs). This repo
 * holds a byte copy of the form inputs that ledger knows (e2e/fixtures/field-ledger-product.json, written by
 * C:/dev/toolset/fields/build.cjs). A NEW product-form input (a ct_… id in app.html) with no row in the ledger fails here, by name.
 *
 * Run: node e2e/field-ledger-guard.cjs    (static: no browser, no server)
 */
'use strict';
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
const known = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'field-ledger-product.json'), 'utf8')).inputs);

/* the SAME scan as chitbridge-api lib/field-ledger.formInputs: a tag with id="ct_…", or a val("ct_…") read of a helper-built input */
function formInputs(src) {
  const ids = new Set();
  const tag = /<(?:input|select|textarea)\b[^>]*>/gi;
  let m;
  while ((m = tag.exec(src))) {
    const id = /\bid=\\?["']?(ct_[a-z0-9_]+)(?![a-z0-9_]*\$)/i.exec(m[0]);
    if (id) ids.add(id[1]);
  }
  const rd = /\bval\(\s*["'](ct_[a-z0-9_]+)["']\s*\)/g;
  while ((m = rd.exec(src))) ids.add(m[1]);
  return [...ids].sort();
}

let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(70) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };
const found = formInputs(html);
say('the scan sees the product form (at least 15 inputs)', found.length >= 15, found.length + ' inputs');
const missing = found.filter((i) => !known.has(i));
say('every product form input has a row in the field ledger', missing.length === 0,
  missing.length ? 'NO ROW FOR: ' + missing.join(', ') + ' — add the field to C:/dev/toolset/fields/rows.cjs, run build.cjs, commit the API seeds + this fixture' : 'none missing');
say('the scan bites: an invented input is named', formInputs(html + '<input id="ct_invented_field">').filter((i) => !known.has(i)).join() === 'ct_invented_field', 'ct_invented_field');
console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
process.exit(bad ? 1 : 0);
