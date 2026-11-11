#!/usr/bin/env node
/**
 * sec-140-prototype-keys.test.cjs — SEC-140: bill data that spells an object's own word never reaches Object.prototype, and never breaks the return.
 * @type regression
 * OWNS      the proof that lib/gst-returns.js keeps every map keyed by bill data (place of supply, buyer GSTIN, HSN, series prefix) as keyedMap_() =
 *           Object.create(null): a place of supply '__proto__' / 'constructor' / 'toString' is an ordinary place, with the right totals. With a plain {}
 *           the same bill threw (a plain object answers map['__proto__'] with Object.prototype, then .push is not a function) or wrote onto the prototype.
 * CALLED BY scripts/guards.cjs · CI. No database: frozen invoices from tax-lines.invoiceFor (the engine), rows built by hand. Mutation: keyedMap_ back to {} → red (fixholds SEC-140).
 * FLOW      hand case → tax-lines.invoiceFor → ledger rows → tax-lines.gstr1 (→ gst-returns.gstr1) → the tables, compared
 *
 * THE HAND CASE (October 2026, shop in Tamil Nadu 33, every line 18%, one Pump, HSN 8413, qty 1):
 *   per hostile word W, one inter-state B2C bill to place of supply W, taxable 1,50,000 → IGST 27,000 → value 1,77,000 (over the 1,00,000 limit) → b2cl under pos W.
 *   one B2B bill to a buyer whose GSTIN is W, taxable 1,000 → IGST 180 → value 1,180 → b2b under ctin W.
 *   one bill whose HSN is W, taxable 1,000 → the HSN summary row is W, txval 1,000 · IGST 180.
 * Run: node tests/sec-140-prototype-keys.test.cjs
 */
'use strict';
const path = require('path');
const T = require(path.join(__dirname, '..', 'lib', 'tax-lines'));

let pass = 0,
  fail = 0;
const ok = (name, cond, why) => {
  if (cond) {
    pass++;
    console.log('   ok   ' + name);
  } else {
    fail++;
    console.log('   FAIL ' + name + (why ? '\n          ' + why : ''));
  }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const ME = { Gstin: '33AAAAA0000A1Z5', State: '33', RegType: 'regular', Country: 'IN' };
const WORDS = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', '__defineGetter__', 'valueOf'];
const invoice = (buyer, price, no, hsn) =>
  T.invoiceFor({ lines: [{ name: 'Pump', quantity: 1, price, gst_rate: 18, hsn: hsn || '8413', unit: 'pcs' }], seller: ME, buyer, chit_id: no, at: '2026-10-03' }).invoice;
const row = (no, buyer, price, hsn) => ({ chit_id: no, doc_no: no, direction: 'sent', sells: true, side: 'output', invoice: invoice(buyer, price, no, hsn), provisional: false, seller: { entity_id: 'me' }, buyer: { entity_id: 'b' }, at: '2026-10-03', day: '2026-10-03' });
const protoBefore = Object.getOwnPropertyNames(Object.prototype).sort().join();
const protoClean = () => Object.getOwnPropertyNames(Object.prototype).sort().join() === protoBefore && ({}).txval === undefined && ({}).igst === undefined && ({}).inv === undefined;
const build = (rows) => { try { return T.gstr1({ rows }, ME, '102026'); } catch (e) { return { threw: String(e && e.message) }; } };

(async () => {
  console.log('\n══ SEC-140 · a key that is an object word is an ordinary key in the GSTR-1 maps ══\n');
  for (const word of WORDS) {
    const b2cl = build([row('INV-1', { Pos: word }, 150000)]);
    eq('place of supply "' + word + '": the 1,77,000 bill is one b2cl row under that place, IGST 27,000', b2cl.threw ? b2cl : (b2cl.b2cl || []).map((p) => [p.pos, p.inv.map((x) => [x.inum, x.val, x.itms[0].itm_det.iamt])]), [[word, [['INV-1', 177000, 27000]]]]);
    const b2b = build([row('INV-2', { Gstin: word, Pos: '29' }, 1000)]);
    eq('buyer GSTIN "' + word + '": one b2b group under that ctin, value 1,180, IGST 180', b2b.threw ? b2b : (b2b.b2b || []).map((g) => [g.ctin, g.inv.map((x) => [x.inum, x.val, x.itms[0].itm_det.iamt])]), [[word, [['INV-2', 1180, 180]]]]);
    const hsn = build([row('INV-3', { Pos: '33' }, 1000, word)]);
    eq('HSN "' + word + '": the summary holds one row with taxable 1,000', hsn.threw ? hsn : ((hsn.hsn && hsn.hsn.data) || []).map((h) => [h.hsn_sc, h.txval]), [[word, 1000]]);
    ok('after "' + word + '" Object.prototype is untouched and a fresh {} has no txval / igst / inv', protoClean());
  }
  const both = build(WORDS.map((w, i) => row('INV-' + (10 + i), { Pos: w }, 150000)));
  eq('all seven places in one month: seven b2cl groups, each with its one bill (no group swallowed by another)', both.threw ? both : (both.b2cl || []).map((p) => [p.pos, p.inv.length]).sort(), WORDS.map((w) => [w, 1]).sort());
  ok('and the prototype is still clean', protoClean());

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
