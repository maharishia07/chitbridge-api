/**
 * tax-vendor.test.js — THE TILL'S TAX ENGINE IS THE SAME ENGINE (2026-09-07).
 *
 * A till prices a bill with the internet unplugged, so tax had to leave the server. It left the way the offer engine did: one master,
 * a copy on the other side, and a test that fails the day they drift. Here the copy is GENERATED (scripts/vendor-tax.cjs) from
 * lib/tax.js + lib/tax-slab.js, so this file checks two things:
 *   1 · the generated file on disk is current — nobody edited lib/tax.js and forgot to regenerate, and nobody hand-edited the copy;
 *   2 · the copy ANSWERS the same as the server for the cases that decide money — interstate, intra-state, a discount, a zero rate,
 *       and a price that already includes the tax, which is how every Indian shelf price works.
 *
 * Run: node tests/tax-vendor.test.js   · no DB, no browser, no network.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { execFileSync } = require('child_process');

const server = require('../lib/tax.js');
const serverSlab = require('../lib/tax-slab.js');
/* ⭐ 2026-09-28: the counter's copy is the ADOPTED bundle (tax-slab + tax from chitbridge-engines), not a generated file */
const COPY = path.join(__dirname, '..', '..', 'chitbridge-web', 'public', 'engine', 'tax.js');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

console.log('— the tax engine, on both sides —');

it('the copy on disk is exactly the release both sides pin (nobody edited one side only)', () => {
  /* moved 2026-09-28 from "vendor-tax.cjs --check": the copy is now adopted, so the check is the adopt tool's */
  const ADOPT = path.join(__dirname, '..', '..', 'chitbridge-engines', 'tools', 'adopt.cjs');
  for (const repo of ['chitbridge-api', 'chitbridge-web']) {
    try { execFileSync(process.execPath, [ADOPT, path.join(__dirname, '..', '..', repo), '--check'], { encoding: 'utf8' }); }
    catch (e) { throw new Error(repo + ': ' + ((e.stdout || '').trim() || 'adopt --check failed')); }
  }
});

/* ⭐ CL1 (2026-10-12): the sandbox's window IS its global, as a browser's is (till-vendor's load() does the same) — the bundle now carries the regulation packs
   ahead of tax-packs, and regulation finds a pack by its GLOBAL (CBRegIN …) while each pack sets window.CBRegIN; a window that is a separate object hides them. */
const page = () => { const sandbox = {}; sandbox.window = sandbox; vm.createContext(sandbox); vm.runInContext(fs.readFileSync(COPY, 'utf8'), sandbox); return sandbox.window; };
const W = page();
const T = W.CBTax;

it('it exposes the same names the server exports', () => {
  assert.deepStrictEqual(Object.keys(T.slab).sort(), Object.keys(serverSlab).sort());
  for (const k of ['determine', 'supplyType', 'systemProvider', 'r2']) assert.strictEqual(typeof T[k], typeof server[k], k);
});

const both = (input) => {
  const a = server.determine(JSON.parse(JSON.stringify(input)));
  const b = T.determine(JSON.parse(JSON.stringify(input)));
  assert.strictEqual(JSON.stringify(b), JSON.stringify(a), 'the two engines answered differently');
  return a;
};
const TN = { Gstin: '33AABCK1234F1Z6', State: '33', RegType: 'regular' };
const KA = { Gstin: '29ABCDE1234F1Z5', State: '29', RegType: 'regular' };
const TN2 = { Gstin: '33XYZAB1234F1Z9', State: '33', RegType: 'regular' };

it('a supply that leaves the state is IGST, and both sides agree to the paisa', () => {
  const r = both({ seller: TN, buyer: KA, lines: [{ name: 'Oil', qty: 2, unit_price: 250, rate: 5 }] });
  assert.ok(r.ValDtls.IgstVal > 0, 'interstate should carry IGST');
  assert.strictEqual(r.ValDtls.CgstVal, 0);
});

it('a supply inside the state splits CGST and SGST, and both sides agree', () => {
  const r = both({ seller: TN, buyer: TN2, lines: [{ name: 'Oil', qty: 1, unit_price: 250, rate: 5 }] });
  assert.strictEqual(r.ValDtls.IgstVal, 0);
  assert.strictEqual(r.ValDtls.CgstVal, r.ValDtls.SgstVal, 'the two halves are equal');
});

it('a line discount and a zero-rated line, together', () => {
  const r = both({ seller: TN, buyer: TN2, lines: [
    { name: 'Soap', qty: 3, unit_price: 30, rate: 18, discount: 10 },
    { name: 'Grapes', qty: 2, unit_price: 200, rate: 0 },
  ] });
  assert.ok(r.ValDtls.AssVal > 0);
});

it('a shelf price that already includes the tax — the counter case', () => {
  const r = both({ seller: TN, buyer: TN2, priceIncludesTax: true, lines: [{ name: 'Biscuit', qty: 1, unit_price: 118, rate: 18 }] });
  assert.strictEqual(r.ValDtls.TotInvVal, 118, 'the customer pays the shelf price, whatever the split says');
});

it('the rate a product carries is resolved the same on both sides', () => {
  const shelf = { face: {}, slabs: [{ slab_id: 's5', name: 'GST 5', rate: 5 }], categories: [] };
  const item = { item_data: { name: 'Oil', tax_slab: 's5' }, face: shelf.face, slabs: shelf.slabs, categories: shelf.categories };
  const a = serverSlab.resolve(item), b = T.slab.resolve(item);
  assert.strictEqual(JSON.stringify(b), JSON.stringify(a));
});

/* ⭐ T1-TAX (14 Oct): THE PACKS, NOT ONLY determine(). The web's bundle sat at reg-* v1.42 while the server booked on v1.45 — every
   determine() above still agreed, and Country Lab drew a chart without 4260 fx_gain_loss. So the packs themselves are compared:
   every registered country, every member (a function by its source), and the tax packs. */
const regulation = require('../lib/regulation.js'), taxPacks = require('../lib/tax-packs.js');
const canon = (o) => JSON.stringify(o, (k, v) => (typeof v === 'function' ? 'fn:' + String(v) : v));

it('the web registers the same country packs as the server, each member equal (the chart, its ledgers, pack.fx …)', () => {
  const web = W.CBRegulation;
  assert.ok(web && typeof web.packFor === 'function', 'the web bundle carries no CBRegulation');
  const ids = (reg) => reg.list().map((p) => p.id).sort().join(',');
  assert.strictEqual(ids(web), ids(regulation), 'the two registries hold different countries');
  for (const p of regulation.list()) {
    const a = regulation.packFor(p.id), b = web.packFor(p.id);
    const differ = Object.keys(Object.assign({}, a, b)).filter((k) => canon(a[k]) !== canon(b[k]));
    assert.deepStrictEqual(differ, [], p.id + ': the web pack differs from the server\'s in ' + differ.join(', ') + ' — the two pin different reg-* releases (engines.lock.json)');
  }
});

it('the tax packs are the same, country by country', () => {
  assert.ok(W.CBTaxPacks && W.CBTaxPacks.PACKS, 'the web bundle carries no CBTaxPacks');
  assert.strictEqual(canon(W.CBTaxPacks.PACKS), canon(taxPacks.PACKS), 'the web\'s tax packs differ from the server\'s');
});

console.log(pass + ' checks');
