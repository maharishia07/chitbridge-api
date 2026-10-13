/**
 * tests/walk-in-buyer.test.cjs — BUY1 (2026-10-12): A WALK-IN BUYER WITH NO COUNTRY IS TAXED AS A SALE INSIDE THE SHOP.
 *
 * Found by AE1 (engines v1.37.0): under a pack whose tax turns on the BORDER (Australia, the UAE) the engine answers a buyer
 * with no country 'unknown' — no GST, no VAT — so an Australian or UAE shop billed every walk-in tax-free. India's STATE pack
 * answers a buyer with no place of supply and no state 'unknown' too. The engine is right to refuse the guess; the caller
 * knows the shop. ONE seam: lib/tax-lines walkIn — the buyer takes the seller's country (and, under a state pack, the seller's
 * state as place of supply) and the invoice SAYS so. invoiceFor (every chit) and services.computeTax (the quote routes) both
 * go through it. The engines are NOT changed.
 *
 * Pure: no DB, no server. Part 3 runs the seam through the REAL country packs — chitbridge-engines v1.37.0 beside this repo
 * (reg-au · reg-ae), which the api has not adopted yet (engines.lock.json pins tax v1.20.0: India only, plus the generic
 * VAT border rule). Without the sibling checkout those cases are skipped and SAID.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const T = require('../lib/tax-lines');
/* services.js reaches the db for shelves and parties; computeTax never does — a stand-in keeps this file pure (the tax-copy.test.cjs pattern) */
require.cache[require.resolve(path.join(__dirname, '..', 'db'))] = { exports: { query: async (sql) => { throw new Error('unstubbed query: ' + sql); }, withEntity: async (_id, fn) => fn({ query: async () => ({ rows: [] }) }) } };
const S = require('../lib/services');

const LINE18 = [{ name: 'Ponni Rice', quantity: 1, price: 100, gst_rate: 18 }];
const notesOf = (inv) => (inv && inv._cb && inv._cb.notes) || [];
const walkInNote = (inv) => notesOf(inv).find((n) => /^Walk-in: taxed as a sale inside /.test(n)) || null;

/* ── 1 · the rule itself ───────────────────────────────────────────────────────────────────────────────────────── */
test('walkIn: a buyer with no country takes the SELLER\'s country, and the note says so', () => {
  const w = T.walkIn({ Country: 'AU', LglNm: 'Shop' }, { LglNm: 'Walk-in' });
  assert.equal(w.buyer.Country, 'AU');
  assert.equal(w.note, 'Walk-in: taxed as a sale inside AU.');
});
test('walkIn: under a state pack a buyer with no place of supply and no state takes the seller\'s state — intra-state', () => {
  const w = T.walkIn({ Country: 'IN', State: '33' }, {});
  assert.equal(w.buyer.Country, 'IN'); assert.equal(w.buyer.Pos, '33');
  assert.match(w.note, /inside IN \(place of supply 33, the seller's state\)\.$/);
});
test('walkIn: a buyer with a country of their own keeps it — a foreign buyer is never made domestic; no note', () => {
  const w = T.walkIn({ Country: 'AE' }, { Country: 'GB', LglNm: 'Visitor Ltd' });
  assert.equal(w.buyer.Country, 'GB'); assert.equal(w.note, null);
});
test('walkIn: a buyer with a place of supply or a state of their own keeps it (a registered buyer\'s GSTIN state decides)', () => {
  assert.equal(T.walkIn({ Country: 'IN', State: '33' }, { Gstin: '29B', State: '29' }).buyer.Pos, undefined);
  assert.equal(T.walkIn({ Country: 'IN', State: '33' }, { Pos: '27' }).buyer.Pos, '27');
  const w = T.walkIn({ Country: 'IN', State: '33' }, { Country: 'IN', State: '29' });
  assert.equal(w.note, null, 'nothing was taken, nothing is said');
});
test('walkIn: pure — the caller\'s buyer is not mutated; a seller with nothing on record gives nothing', () => {
  const b = {}; T.walkIn({ Country: 'AU' }, b); assert.deepEqual(b, {});
  const w = T.walkIn({}, {}); assert.deepEqual(w.buyer, {}); assert.equal(w.note, null);
});

/* ── 2 · through the api's own engine (tax v1.20.0: India, and the generic VAT border rule) ────────────────────── */
test('IN walk-in through invoiceFor: intra-state — CGST + SGST, the full 18% — and the invoice notes why', () => {
  const r = T.invoiceFor({ lines: LINE18, seller: { Gstin: '33AAAAA0000A1Z5', State: '33', Country: 'IN' }, buyer: { LglNm: 'Walk-in', RegType: 'unregistered' } });
  const v = r.invoice.ValDtls;
  assert.equal(r.invoice._cb.supply, 'intra');
  assert.equal(v.CgstVal, 9); assert.equal(v.SgstVal, 9); assert.equal(v.IgstVal, 0); assert.equal(v.TotInvVal, 118);
  assert.equal(r.invoice.TranDtls.SupTyp, 'B2C');
  assert.match(walkInNote(r.invoice) || '', /inside IN \(place of supply 33/);
  assert.ok(!notesOf(r.invoice).some((n) => /cannot be decided/.test(n)), 'the engine no longer had to refuse');
});
test('AE walk-in through invoiceFor (VAT, border rule): domestic — 5% VAT on one head — and the invoice notes why', () => {
  const r = T.invoiceFor({ lines: [{ name: 'Dates', quantity: 1, price: 100, gst_rate: 5, tax_scheme: 'VAT' }], seller: { LglNm: 'Souq', Country: 'AE' }, buyer: { LglNm: 'Walk-in' }, currency: 'AED' });
  assert.equal(r.invoice._cb.supply, 'domestic');
  assert.equal(r.invoice.ValDtls.TaxVal, 5); assert.equal(r.invoice.ValDtls.TotInvVal, 105);
  assert.equal(T.heads(r.invoice).vat, 5);
  assert.equal(walkInNote(r.invoice), 'Walk-in: taxed as a sale inside AE.');
});
test('a REAL foreign buyer through invoiceFor stays cross-border: zero-rated, the rate stated, no walk-in note', () => {
  const r = T.invoiceFor({ lines: [{ name: 'Dates', quantity: 1, price: 100, gst_rate: 5, tax_scheme: 'VAT' }], seller: { Country: 'AE' }, buyer: { LglNm: 'Visitor Ltd', Country: 'GB' } });
  assert.equal(r.invoice._cb.supply, 'cross');
  assert.equal(r.invoice.ValDtls.TaxVal, 0); assert.equal(r.invoice.ValDtls.TotInvVal, 100); assert.equal(r.invoice.ItemList[0].GstRt, 5);
  assert.equal(walkInNote(r.invoice), null);
  assert.ok(notesOf(r.invoice).some((n) => /Cross-border/.test(n)));
});
test('services.computeTax (the /api/tax/compute and /api/invoice/build seam) applies the same rule, once', () => {
  const lines = [{ key: 'l1', name: 'Ponni Rice', qty: 1, unit_price: 100, gst_rate: 18 }];
  const inn = S.computeTax({ seller: { State: '33', Country: 'IN' }, buyer: {}, lines });
  assert.equal(inn._cb.supply, 'intra'); assert.equal(inn.ValDtls.CgstVal, 9); assert.equal(inn.ValDtls.SgstVal, 9);
  assert.equal(notesOf(inn).filter((n) => /^Walk-in/.test(n)).length, 1, 'one note, even when the route already applied walkIn to the echo');
  const ae = S.computeTax({ seller: { Country: 'AE' }, buyer: {}, lines: [{ key: 'l1', name: 'Dates', qty: 1, unit_price: 100, gst_rate: 5 }], scheme: 'VAT' });
  assert.equal(ae._cb.supply, 'domestic'); assert.equal(ae.ValDtls.TaxVal, 5);
  const gb = S.computeTax({ seller: { Country: 'AE' }, buyer: { Country: 'GB' }, lines: [{ key: 'l1', name: 'Dates', qty: 1, unit_price: 100, gst_rate: 5 }], scheme: 'VAT' });
  assert.equal(gb._cb.supply, 'cross'); assert.equal(gb.ValDtls.TaxVal, 0);
});

/* ── 3 · the seam through the REAL packs — chitbridge-engines v1.37.0 (reg-au · reg-ae), beside this repo ────────── */
const ENGINE = path.join(__dirname, '..', '..', 'chitbridge-engines', 'src', 'tax.js');
const haveEngines = fs.existsSync(ENGINE);
const E = haveEngines ? require(ENGINE) : null;
const viaPacks = (seller, buyer, line) => {
  const w = T.walkIn(seller, buyer);
  const inv = E.determine({ seller, buyer: w.buyer, lines: [line] });
  if (w.note) inv._cb.notes = inv._cb.notes.concat(w.note);
  return inv;
};
test('AU walk-in with the Australia pack: 10% GST on one head (A$100 → A$110), and the invoice notes why', { skip: !haveEngines && 'chitbridge-engines is not beside this repo' }, () => {
  const inv = viaPacks({ LglNm: 'Milk Bar', Country: 'AU' }, { LglNm: 'Walk-in' }, { name: 'Flat white', qty: 1, unit_price: 100, rate: 10 });
  assert.equal(inv._cb.scheme, 'GST'); assert.equal(inv._cb.supply, 'domestic');
  assert.equal(inv.ValDtls.TaxVal, 10); assert.equal(inv.ValDtls.TotInvVal, 110);
  assert.equal(inv.ValDtls.CgstVal + inv.ValDtls.SgstVal + inv.ValDtls.IgstVal, 0, 'Australia does not split by state');
  assert.equal(walkInNote(inv), 'Walk-in: taxed as a sale inside AU.');
});
test('AE walk-in with the UAE pack: 5% VAT (AED 100 → AED 105), and the invoice notes why', { skip: !haveEngines && 'chitbridge-engines is not beside this repo' }, () => {
  const inv = viaPacks({ LglNm: 'Souq', Country: 'AE' }, { LglNm: 'Walk-in' }, { name: 'Dates', qty: 1, unit_price: 100, rate: 5 });
  assert.equal(inv._cb.scheme, 'VAT'); assert.equal(inv._cb.supply, 'domestic');
  assert.equal(inv.ValDtls.TaxVal, 5); assert.equal(inv.ValDtls.TotInvVal, 105);
  assert.equal(walkInNote(inv), 'Walk-in: taxed as a sale inside AE.');
});
test('IN walk-in with the India pack: intra-state CGST + SGST — and a real foreign buyer of an AU shop is still an export', { skip: !haveEngines && 'chitbridge-engines is not beside this repo' }, () => {
  const inn = viaPacks({ Gstin: '33AAAAA0000A1Z5', State: '33', Country: 'IN' }, {}, { name: 'Rice', qty: 1, unit_price: 100, rate: 18 });
  assert.equal(inn._cb.supply, 'intra'); assert.equal(inn.ValDtls.CgstVal, 9); assert.equal(inn.ValDtls.SgstVal, 9);
  const out = viaPacks({ Country: 'AU' }, { Country: 'NZ', LglNm: 'Kiwi Ltd' }, { name: 'Wool', qty: 1, unit_price: 100, rate: 10 });
  assert.equal(out._cb.supply, 'cross'); assert.equal(out.ValDtls.TaxVal, 0); assert.equal(out.ValDtls.TotInvVal, 100);
  assert.equal(walkInNote(out), null);
});
test('the engines were not changed: with NO walk-in rule the packs still refuse the guess (the seam is the caller\'s)', { skip: !haveEngines && 'chitbridge-engines is not beside this repo' }, () => {
  const raw = E.determine({ seller: { Country: 'AU' }, buyer: {}, lines: [{ name: 'x', qty: 1, unit_price: 100, rate: 10 }] });
  assert.equal(raw._cb.supply, 'unknown'); assert.equal(raw.ValDtls.TaxVal, 0);
});

/* the gate (scripts/guards.cjs) reads "<n> checks" */
require('node:test').after(() => {
  const declared = (fs.readFileSync(__filename, 'utf8').match(/^test\('/gm) || []).length;
  console.log('  ' + declared + ' checks');
});
