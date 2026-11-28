'use strict';
/**
 * tests/au-pack-pin-1138.test.cjs — a lodged period reads under the version it was closed under; an open one moves with a restamp (pack pinning, batch 1138; every country: AU is only the fixture).
 * Hand figures (AUD minor): sales 1,000,000 + GST collected 100,000; purchases 250,000 + GST paid 25,000 → 1A 100,000 · 1B 25,000 · 9 = 75,000 payable.
 */
const assert = require('assert');
const Engines = require('../lib/books-engines'), Reg = require('../lib/regulation');
const AU0 = Reg.packFor('AU', '1.0.0'); /* 1.0.0 stays resolvable beside any later version */
const AU1 = Object.assign({}, AU0, { version: '1.0.1', marker: 'new' }); /* a later version beside the old one, as engines 1.0.1 registers it */
const realFor = Reg.packFor.bind(Reg), realPacks = Engines.packs();
const pickAU = (v) => (v == null || v === '' ? AU1 : v === '1.0.1' ? AU1 : v === '1.0.0' ? AU0 : null);
Reg.packFor = (c, v) => (String(c).toUpperCase() === 'AU' ? pickAU(v) : realFor(c, v));
Engines.packs = () => Object.assign({}, realPacks, { packFor: (c) => (String(c).toUpperCase() === 'AU' ? AU1 : realPacks.packFor(c)) });
const Pin = require('../lib/books-pack-pin');
const S = require('../lib/books-store'), SP = require('../lib/books-store-pack');
let n = 0;
const ok = async (what, fn) => {
  try { await fn(); n++; console.log('  ok  ' + what); } catch (e) { console.log('  ✗ ' + what + '\n      ' + e.message); process.exitCode = 1; }
};
const refused = async (fn, code) => {
  try { await fn(); } catch (e) { assert.strictEqual(e.code, code, e.message); assert.ok(e.refused); return; }
  assert.fail('expected ' + code);
};
const base = { enabled: true, country: 'AU', fy_start_month: 7, functional_currency: 'AUD' };
const MOVES = [{ role: 'sales', dr_minor: 0, cr_minor: 1000000 }, { role: 'gst_collected', dr_minor: 0, cr_minor: 100000 }, { role: 'purchases', dr_minor: 250000, cr_minor: 0 }, { role: 'gst_paid', dr_minor: 25000, cr_minor: 0 }];
const GR = require('../lib/gst-returns');
const box = (r, c) => (r.boxes.find((x) => x.code === c) || {}).amount_minor;
(async () => {
  await ok('never stamped (NULL) or a legacy chart stamp ("1") reads the latest, as before', async () => {
    assert.strictEqual(Pin.packAt(Object.assign({}, base), '2026-08-01').version, '1.0.1');
    assert.strictEqual(Pin.packAt(Object.assign({}, base, { pack_version: '1' }), '2026-08-01').version, '1.0.1');
  });
  await ok('a stamp is honoured: 1.0.0 reads 1.0.0 on any day', async () => assert.strictEqual(Pin.packAt(Object.assign({}, base, { pack_version: '1.0.0' }), '2026-08-01').version, '1.0.0'));
  await ok('a stamp this build cannot resolve is refused in words, never read as the latest', () => refused(async () => Pin.packAt(Object.assign({}, base, { pack_version: '9.9.9' }), '2026-08-01'), 'BOOKS_PACK_VERSION_UNKNOWN'));
  await ok('enable stamps the latest version of the country', async () => assert.strictEqual(Pin.stampOnEnable('AU'), '1.0.1'));
  let kept = null;
  const logged = [];
  SP.addPackHistory = async (db, e, rows, v) => { kept = { rows, v }; };
  S.logChange = async (db, e, c) => { logged.push(c); };
  require('../lib/schema').hasColumn = async () => true;
  const starts = ['2026-07-01', '2026-10-01', '2027-01-01'];
  const shop0 = Object.assign({}, base, { pack_version: '1.0.0' });
  let shop1;
  await ok('restamp 1.0.0 to 1.0.1 from 2026-10-01: base row + dated row, one audit row, stamp moves', async () => {
    const r = await Pin.restamp({}, 'e1', shop0, { to: '1.0.1', from: '2026-10-01', by: 'owner1', startsOfPeriods: starts });
    assert.deepStrictEqual([r.from, r.version, r.was], ['2026-10-01', '1.0.1', '1.0.0']);
    assert.deepStrictEqual(kept.rows.map((x) => [x.from, x.version]), [['0001-01-01', '1.0.0'], ['2026-10-01', '1.0.1']]);
    assert.strictEqual(kept.v, '1.0.1');
    assert.strictEqual(logged.length, 1);
    assert.deepStrictEqual([logged[0].field, logged[0].old, logged[0].new], ['pack_version', '1.0.0', '1.0.1 from 2026-10-01']);
    shop1 = Object.assign({}, shop0, { pack_version: '1.0.1', pack_history: kept.rows });
  });
  await ok('a BAS lodged under 1.0.0 (period 2026-Q1, Jul-Sep) reads the same after 1.0.1 is adopted and the shop restamped', async () => {
    const p = Pin.packAt(shop1, '2026-07-01');
    assert.strictEqual(p.version, '1.0.0');
    assert.strictEqual(p.marker, undefined); assert.strictEqual(p.fy_start_month, 7); assert.strictEqual(p.returns, AU0.returns);
    const r = GR.returnFor(p, '2026-Q1', MOVES, { simpler: false });
    assert.deepStrictEqual([box(r, '1A'), box(r, '1B'), r.net_minor], [100000, 25000, 75000]);
  });
  await ok('an open period from the restamp day (2026-Q2) reads 1.0.1', async () => assert.strictEqual(Pin.packAt(shop1, '2026-10-01').version, '1.0.1'));
  await ok('the day before the restamp still reads 1.0.0', async () => assert.strictEqual(Pin.packAt(shop1, '2026-09-30').version, '1.0.0'));
  await ok('refused: backward or same version', async () => {
    await refused(() => Pin.restamp({}, 'e1', shop1, { to: '1.0.0', from: '2027-01-01', by: 'o', startsOfPeriods: starts }), 'BOOKS_PACK_BACKWARD');
    await refused(() => Pin.restamp({}, 'e1', shop1, { to: '1.0.1', from: '2027-01-01', by: 'o', startsOfPeriods: starts }), 'BOOKS_PACK_BACKWARD');
  });
  await ok('refused: a day that is not a tax-period start, a version the build lacks, no date', async () => {
    await refused(() => Pin.restamp({}, 'e1', shop0, { to: '1.0.1', from: '2026-10-15', by: 'o', startsOfPeriods: starts }), 'BOOKS_PACK_FROM');
    await refused(() => Pin.restamp({}, 'e1', shop0, { to: '2.0.0', from: '2026-10-01', by: 'o', startsOfPeriods: starts }), 'BOOKS_PACK_VERSION_UNKNOWN');
    await refused(() => Pin.restamp({}, 'e1', shop0, { to: '1.0.1', startsOfPeriods: starts }), 'BOOKS_PACK_FROM');
  });
  await ok('a never-stamped shop is already on the latest: nowhere forward (the b914 backfill stamps AU shops first)', () => refused(() => Pin.restamp({}, 'e1', Object.assign({}, base), { to: '1.0.1', from: '2026-10-01', by: 'o', startsOfPeriods: starts }), 'BOOKS_PACK_BACKWARD'));
  await ok('wiring: the return read and the close take the pack on the period first day; packOf takes a day; enable stamps', () => {
    const fs = require('fs'), per = fs.readFileSync(__dirname + '/../lib/books-period.js', 'utf8'), bk = fs.readFileSync(__dirname + '/../lib/books.js', 'utf8');
    assert.ok(/B\.packOf\(shop, period\.start\)/.test(per) && /B\.packOf\(shop, span\.start\)/.test(per));
    assert.ok(/function packOf\(setting, day\)/.test(bk) && /stampOnEnable\(country\)/.test(bk));
  });
  console.log(n + ' checks');
})();
