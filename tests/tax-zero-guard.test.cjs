/**
 * tests/tax-zero-guard.test.cjs — TAX-EXPLICIT (1129): the tax files may not default a tax figure to zero or swallow a failure without a reviewed reason.
 * OWNS      a NEW `<rate|cess|tax|gst|vat|slab|pct|percent> || 0` / `?? 0`, or a catch that neither rethrows, logs nor answers, in the tax-touching api files, fails here until it is fixed or
 *           added to tests/support/tax-zero-allow.json WITH its reason; an allow entry that no longer matches a site fails too (the list stays honest).
 * CALLED BY CI (scripts/guards.cjs) / node --test tests/tax-zero-guard.test.cjs · no DB, no network.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scan, scanFile } = require('./support/tax-zero-scan.cjs');
const allow = require('./support/tax-zero-allow.json').allow;

const key = (hit) => hit.file + '|' + hit.kind + '|' + hit.text.slice(0, 70);

test('every tax-zero or swallowing-catch site in the tax files is on the allow-list with a reason', () => {
  const allowed = new Set(allow.map((entry) => key(entry)));
  const loose = scan(path.join(__dirname, '..')).filter((hit) => !allowed.has(key(hit)));
  assert.deepEqual(loose.map((hit) => hit.file + ' [' + hit.kind + '] ' + hit.text.slice(0, 100)), [], 'a tax figure defaulted to 0 or a swallowed failure: fix it, or add it to tests/support/tax-zero-allow.json with its reason');
});

test('every allow entry still matches a site and carries a reason (a stale entry is deleted)', () => {
  const found = new Set(scan(path.join(__dirname, '..')).map(key));
  const stale = allow.filter((entry) => !found.has(key(entry))).map(key);
  assert.deepEqual(stale, []);
  assert.deepEqual(allow.filter((entry) => !entry.reason || String(entry.reason).length < 20).map(key), []);
});

test('the scan itself sees a new `taxRate || 0`, a `?? 0` on a cess and a catch that swallows (and passes a catch that logs or rethrows)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tzg-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(
    path.join(dir, 'lib', 'x-tax.js'),
    ['const a = item.taxRate || 0;', 'const b = line.cess_rate ?? 0;', 'try { f(); } catch (e) { return null; }', 'try { f(); } catch (e) { log.fellBack("x", e); return null; }', 'try { f(); } catch (e) { throw e; }', 'const c = qty || 0;'].join('\n')
  );
  const hits = scanFile(dir, 'lib/x-tax.js');
  assert.equal(hits.filter((hit) => hit.kind === 'zero').length, 2);
  assert.equal(hits.filter((hit) => hit.kind === 'catch').length, 1);
});
