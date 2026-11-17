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

  /* QA-140 (2026-11-12): the same words through GSTR-3B 3.2 (the sheet's own keyedMap_, lib/gst-returns.js newSheet_().unregistered). The part above goes
     through gstr1; this is the second caller of the same fix. One inter-state B2C bill (taxable 1,50,000, IGST 27,000) per word, place of supply = the word. */
  console.log('\n══ QA-140 · GSTR-3B 3.2 by place of supply, hostile place names ══\n');
  const G = require(path.join(__dirname, '..', 'lib', 'gst-returns'));
  const keysBefore = Object.keys(Object.prototype).join('|');
  const doc = (no, word, price) => ({ kind: 'invoice', ref: no, date: '2026-10-03', inv: invoice({ Pos: word }, price, no) });
  const run3b = (docs) => { try { return G.gstr3b({ gstin: ME.Gstin, month: '2026-10', documents: docs }); } catch (e) { return { threw: String(e && e.message) }; } };
  for (const word of ['__proto__', 'constructor']) {
    const r = run3b([doc('INV-31', word, 150000)]);
    eq('3B place of supply "' + word + '": 3.2 holds one row for that place, taxable 1,50,000 and IGST 27,000', r.threw ? r : r.s3_2.unregistered, [{ pos: word, txval: 150000, igst: 27000 }]);
    ok('3B "' + word + '": ({}).polluted, ({}).txval, ({}).igst are undefined', ({}).polluted === undefined && ({}).txval === undefined && ({}).igst === undefined);
    ok('3B "' + word + '": Object.keys(Object.prototype) is unchanged', Object.keys(Object.prototype).join('|') === keysBefore && protoClean());
  }
  const two = run3b([doc('INV-32', '__proto__', 150000), doc('INV-33', 'constructor', 100000), doc('INV-34', '__proto__', 50000)]);
  eq('3B both words and a repeat in one month: __proto__ sums two bills (2,00,000 / 36,000), constructor one (1,00,000 / 18,000)', two.threw ? two : two.s3_2.unregistered, [{ pos: '__proto__', txval: 200000, igst: 36000 }, { pos: 'constructor', txval: 100000, igst: 18000 }]);
  ok('3B 3.1(a) still carries the whole 3,00,000 taxable, and the prototype is clean', !two.threw && two.s3_1.a.txval === 300000 && protoClean(), JSON.stringify(two.s3_1 && two.s3_1.a));

  /* QA-140 round 2: the other two callers of keyedMap_ in gst-returns.js. `blocked` (blockedLines_: line index -> ITC reason) and `seen` (table 13: serial -> 1).
     Their keys are line indexes and serial numbers and every read is guarded (hasOwnProperty), so keyedMap_ -> {} does NOT turn these red (an equivalent mutant,
     shown in PR 1133). They are pinned here as BEHAVIOUR: a reason or a line named like an object word is carried as plain data, and the series gap is found. */
  console.log('\n══ QA-140 · blocked-ITC reasons and the Table 13 series with object words ══\n');
  const SUP = { Gstin: '29AAAAA0000A1Z5', State: '29', RegType: 'regular', Country: 'IN' };
  const pinv = (no) => T.invoiceFor({ lines: [{ name: 'Pump', quantity: 1, price: 1000, gst_rate: 18, hsn: '8413', unit: 'pcs' }], seller: SUP, buyer: ME, chit_id: no, at: '2026-10-03' }).invoice;
  const blockedRun = (blocked) => { try { return G.gstr3b({ gstin: ME.Gstin, month: '2026-10', documents: [{ kind: 'purchase', ref: 'P-1', date: '2026-10-03', inv: pinv('P-1'), blocked }] }); } catch (e) { return { threw: String(e && e.message) }; } };
  for (const word of ['__proto__', 'constructor']) {
    const r = blockedRun([{ line: 'all', reason: word }]);
    eq('blocked reason "' + word + '": one 3.4 entry with that reason, no section, IGST 180 held back, nothing claimed as ITC', r.threw ? r : [r.s4.ineligible.blocked.map((b) => [b.reason, b.section, b.known, b.igst]), r.s4.available.other.igst], [[[word, null, false, 180]], 0]);
    ok('blocked reason "' + word + '": the prototype is clean', protoClean() && Object.keys(Object.prototype).join('|') === keysBefore);
  }
  const named = blockedRun([{ line: '__proto__', reason: 'x' }, { line: 0, reason: 'constructor' }]);
  eq('a blocked line NAMED "__proto__" does not block line 0 or break the return; the real line 0 reason stands', named.threw ? named : named.s4.ineligible.blocked.map((b) => [b.line, b.reason]), [[0, 'constructor']]);
  const gap = G.gstr1({ gstin: ME.Gstin, month: '2026-10', documents: ['INV-1', 'INV-2', 'INV-4'].map((n) => ({ kind: 'invoice', ref: n, date: '2026-10-03', inv: invoice({ Pos: '29' }, 1000, n) })) });
  eq('Table 13 series INV-1, 2, 4: INV-3 is named as not supplied, 4 counted as issued', gap.ok === false ? gap : gap.json.doc_issue.doc_det[0].docs.map((d) => [d.from, d.to, d.totnum, d.unaccounted]), [['INV-1', 'INV-4', 4, ['INV-3']]]);

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
