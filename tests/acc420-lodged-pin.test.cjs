'use strict';
/**
 * tests/acc420-lodged-pin.test.cjs — a lodged period recomputed under a newer pack version gives a LOUD mismatch receipt, never a silent re-read (ACC-420 (2); every country, AU is the fixture).
 * Expected values written first: closed under 1.0.0, read under 1.0.1 -> receipt {closed_under '1.0.0', reads_under '1.0.1'}; same version, no carried version, malformed or legacy '1' -> null.
 */
const assert = require('assert'), fs = require('fs');
const Reg = require('../lib/regulation');
const AU0 = Reg.packFor('AU', '1.0.0');
const AU1 = Object.assign({}, AU0, { version: '1.0.1', marker: 'new' });
const realFor = Reg.packFor.bind(Reg);
Reg.packFor = (c, v) => (String(c).toUpperCase() === 'AU' ? (v == null || v === '' || v === '1.0.1' ? AU1 : v === '1.0.0' ? AU0 : null) : realFor(c, v));
const Pin = require('../lib/books-pack-pin');
const src = (f) => fs.readFileSync(__dirname + '/../lib/' + f, 'utf8');
let n = 0;
const ok = (what, fn) => { try { fn(); n++; console.log('  ok  ' + what); } catch (e) { console.log('  ✗ ' + what + '\n      ' + e.message); process.exitCode = 1; } };
ok('closed under 1.0.0, read under 1.0.1: a loud receipt naming both versions and the period', () => {
  const r = Pin.lodgedCheck('1.0.0', '1.0.1', '2026-Q1');
  assert.deepStrictEqual([r.code, r.closed_under, r.reads_under, r.period], ['BOOKS_PACK_VERSION_MISMATCH', '1.0.0', '1.0.1', '2026-Q1']);
  assert.ok(/not recalculated/.test(r.words));
});
ok('same version: no receipt', () => assert.strictEqual(Pin.lodgedCheck('1.0.1', '1.0.1', 'x'), null));
ok('carried version absent, legacy "1", malformed: nothing invented', () => {
  [undefined, null, '', '1', 'abc', '1.0'].forEach((v) => assert.strictEqual(Pin.lodgedCheck(v, '1.0.1', 'x'), null, String(v)));
  assert.strictEqual(Pin.lodgedCheck('1.0.0', undefined, 'x'), null);
});
ok('a closed period replays under the version it was closed under; a version this build lacks falls back without throwing', () => {
  assert.strictEqual(Pin.packClosedUnder('AU', '1.0.0', AU1).version, '1.0.0');
  assert.strictEqual(Pin.packClosedUnder('AU', '9.9.9', AU1), AU1);
  assert.strictEqual(Pin.packClosedUnder('AU', undefined, AU1), AU1);
});
ok('restampFor date regex has its backslashes (every route restamp was refused before)', () => assert.ok(src('books-pack-pin.js').split(String.fromCharCode(92) + 'd{4}-' + String.fromCharCode(92) + 'd{2}-' + String.fromCharCode(92) + 'd{2}$/.test(from)').length === 3));
ok('wiring (the mutation targets): the close carries pack_version; the replay and the lodged list both call lodgedCheck', () => {
  const per = src('books-period.js');
  assert.ok(/pack_version: pack\.version/.test(per), 'close carries the version');
  assert.ok(/Pin\.lodgedCheck\(stored\.pack_version, pack\.version/.test(per), 'carriedClose checks');
  assert.ok(/pack_mismatch: receipt/.test(per.slice(per.indexOf('async function carriedClose'), per.indexOf('const named0'))), 'carriedClose attaches');
  assert.ok(/lodgedCheck\(row\.tax_close\.pack_version/.test(per.slice(per.indexOf('async function lodgedPeriods'))), 'lodgedPeriods checks');
});
console.log(n + ' checks');
