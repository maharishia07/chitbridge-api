/**
 * tests/bill-paper.test.cjs — CTRY-76 (Round 1 E2): A TAX INVOICE OF A$1,000 OR MORE NAMES ITS BUYER; ONE ABN CHECK FOR THE SHOP AND THE BILL.
 *
 * Athi Q1 (30 Oct 2026): a counter sale the pack wants the buyer on, with nobody named, is HELD — the sale stands, the paper is "Bill — not a
 * tax invoice" (business_json.not_invoice 'buyer_identity', the counter's own slot) and the send answer says so (INVOICE_HELD_BUYER + the
 * pack's sentence); only a buyer tax id that fails the pack's check is refused (400 BUYER_TAX_ID_BAD). The rule is the PACK's (reg-au
 * taxInvoice: buyer_identity_from_minor 100000, GST Act s.29-70(1)(c)(ii); the ABN mod-89 check), read through lib/bill-paper with the
 * real adopted packs (lib/country packFor). The check is lib/profile taxIdRefusal — the same call country-setup.js and entities.js run.
 *
 *   AU-04a  A$1,100 incl. GST, Walk-in            → held buyer_identity, the pack's buyer_why and cite
 *   AU-04b  A$1,100, buyer named (no ABN)         → not held
 *   AU-04c  A$1,100, buyer ABN 51 824 753 556      → not held, no refusal (the ABR's own example number)
 *   AU-04d  buyer ABN 51 824 753 557 (mod-89 fails) → refusal BUYER_TAX_ID_BAD, the pack's words, the same words shop setup gets
 *   AU-04e  A$990, Walk-in                        → nothing (under the threshold)
 *   AU-04f  A$1,200 GST-free (tax 0), Walk-in      → nothing (not a tax invoice)
 *   IN control: the pack's own r.46(f) line (Rs 50,000 taxable, unregistered buyer) reads the same way; a bad GSTIN is the same refusal
 *   no country / no pack → nothing; the frozen invoice is never touched; routes/chits.js wires sendPaper AFTER sendIssued, outside its try
 * Pure: no DB, no server. Run: node tests/bill-paper.test.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
/* books-cashflow (toMinor) reaches the db at load — a stand-in keeps this file pure (the walk-in-buyer.test.cjs pattern) */
require.cache[require.resolve(path.join(__dirname, '..', 'db'))] = {
  exports: { query: async (sql) => { throw new Error('unstubbed query: ' + sql); }, withEntity: async (_id, fn) => fn({ query: async (sql) => { throw new Error('unstubbed query: ' + sql); } }) }
};
const BP = require('../lib/bill-paper');
const P = require('../lib/profile');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

/** a counter bill's business_json with its frozen invoice (the shape CBTax.determine freezes: ValDtls + ItemList) */
function bill(o) {
  const taxable = o.taxable, tax = o.tax, total = Math.round((taxable + tax) * 100) / 100;
  const val = o.heads === 'gst-split'
    ? { AssVal: taxable, CgstVal: tax / 2, SgstVal: tax / 2, IgstVal: 0, CesVal: 0, TotInvVal: total }
    : { AssVal: taxable, TaxVal: tax, TotInvVal: total };
  return {
    bill_no: 'C1/26-27/0001', till: { id: 'till-1' }, billed_at: '2026-10-30T03:00:00.000Z',
    customer: o.customer || { name: 'Walk-in' },
    invoice: { ValDtls: val, ItemList: [{ SlNo: '1', PrdDesc: 'Item', GstRt: o.rate, AssAmt: taxable, TotAmt: total }], _cb: { supply: o.supply || 'domestic' } },
    not_invoice: o.not_invoice
  };
}
const AU = (o) => BP.paperOf({ country: 'AU', currency: 'AUD', business_json: bill(Object.assign({ rate: 10 }, o)) });

/* ── 1 · Australia: the pack's buyer line ──────────────────────────────────────────────────────────────────────────── */
{
  const r = AU({ taxable: 1000, tax: 100 });
  ok('AU-04a: A$1,100 to a Walk-in is HELD', r.held && r.held.reason === 'buyer_identity' && !r.refusal);
  /* reg-au states buyer_why from v1.73.0 ("From A$1,000 a tax invoice shows the buyer's identity or ABN (GST Act s.29-70(1)(c)(ii))."); the api's
     adopted release decides — the words a person reads are the register's INVOICE_HELD_BUYER row, so `why` is the pack's sentence or null, never typed here */
  eq('AU-04a: the why is the pack\'s own sentence, or null until the adopted reg-au states one (never a typed sentence)', r.held && r.held.why, (r.rule && r.rule.buyer_why) || null);
  ok('AU-04a: the cite is the pack\'s (s.29-70)', /s\.29-70/.test(String(r.held && r.held.cite)));
  ok('AU-04a: the rule carries the pack\'s own threshold (A$1,000 or more; the Act\'s "at least $1,000")', r.rule && r.rule.buyer_identity === true && r.rule.required === true);
  ok('AU-04a: the reason is the counter\'s own value of not_invoice', BP.REASON_BUYER === 'buyer_identity');
}
{
  const r = AU({ taxable: 1000, tax: 100, customer: { name: 'Acme Pty Ltd', phone: '' } });
  ok('AU-04b: a named buyer (no ABN) is not held, not refused', !r.held && !r.refusal && r.rule && r.rule.buyer_identity === true);
}
{
  const r = AU({ taxable: 1000, tax: 100, customer: { name: 'Walk-in', gstin: '51 824 753 556' } });
  ok('AU-04c: a buyer ABN that checks out names the buyer — not held, not refused', !r.held && !r.refusal);
}
{
  const r = AU({ taxable: 1000, tax: 100, customer: { name: 'Acme Pty Ltd', gstin: '51 824 753 557' } });
  ok('AU-04d: a buyer ABN failing mod-89 is REFUSED', r.refusal && r.refusal.code === 'BUYER_TAX_ID_BAD' && !r.held);
  eq('AU-04d: the field named', r.refusal && r.refusal.field, 'business_json.customer.gstin');
  eq('AU-04d: ONE check — the same words shop setup gets (profile.taxIdRefusal)', r.refusal && r.refusal.why, P.taxIdRefusal('AU', '51824753557').why);
  ok('AU-04d: the words are the pack\'s (mod-89), not a length rule', /check digits/.test(String(r.refusal && r.refusal.why)));
  const under = AU({ taxable: 500, tax: 50, customer: { name: 'Acme', gstin: '51 824 753 557' } });
  ok('AU-04d: a bad ABN is refused under the threshold too (a defective tax invoice at any total)', under.refusal && under.refusal.code === 'BUYER_TAX_ID_BAD');
}
{
  const r = AU({ taxable: 900, tax: 90 });
  ok('AU-04e: A$990 to a Walk-in — nothing (under A$1,000)', !r.held && !r.refusal && r.rule && r.rule.buyer_identity === false);
  const edge = AU({ taxable: 909.09, tax: 90.91 });
  ok('AU-04e: exactly A$1,000.00 is "A$1,000 or more" — held', edge.held && edge.held.reason === 'buyer_identity');
}
{
  const r = AU({ taxable: 1200, tax: 0, rate: 0 });
  ok('AU-04f: a GST-free A$1,200 sale carries no tax — not a tax invoice, nothing to hold', !r.held && !r.refusal && r.rule === null);
  const bad = AU({ taxable: 1200, tax: 0, rate: 0, customer: { name: 'X', gstin: '51 824 753 557' } });
  ok('AU-04f: no tax levied → the buyer id is not checked (an export or GST-free sale; a foreign buyer has no ABN)', !bad.refusal);
}
{
  const r = AU({ taxable: 1000, tax: 100, not_invoice: 'shop_details' });
  ok('a reason the counter already wrote (shop_details) is not the server\'s to replace: held still answered, the caller keeps the first reason', r.held && r.held.reason === 'buyer_identity');
}

/* ── 2 · the frozen invoice is read, never touched ───────────────────────────────────────────────────────────────── */
{
  const bj = bill({ taxable: 1000, tax: 100, rate: 10 });
  const before = JSON.stringify(bj);
  BP.paperOf({ country: 'AU', currency: 'AUD', business_json: bj });
  eq('paperOf never writes on business_json or its invoice', JSON.stringify(bj), before);
}

/* ── 3 · nothing without a pack rule; never India as a fallback ─────────────────────────────────────────────────── */
{
  eq('no country → nothing', BP.paperOf({ country: null, currency: 'AUD', business_json: bill({ taxable: 1000, tax: 100, rate: 10 }) }), { held: null, refusal: null, rule: null });
  eq('unknown country → nothing (packFor null, never India)', BP.paperOf({ country: 'ZZ', currency: 'AUD', business_json: bill({ taxable: 1000, tax: 100, rate: 10 }) }), { held: null, refusal: null, rule: null });
  eq('not a counter bill with its frozen invoice → nothing', BP.paperOf({ country: 'AU', currency: 'AUD', business_json: { customer: { name: 'Walk-in' } } }), { held: null, refusal: null, rule: null });
  eq('a frozen invoice without ValDtls → nothing', BP.paperOf({ country: 'AU', currency: 'AUD', business_json: { invoice: { ItemList: [] } } }), { held: null, refusal: null, rule: null });
}

/* ── 4 · India control: the pack's own line, the same reading, the same one check ───────────────────────────────── */
{
  const IN = (o) => BP.paperOf({ country: 'IN', currency: 'INR', business_json: bill(Object.assign({ rate: 18, heads: 'gst-split', supply: 'intra' }, o)) });
  const small = IN({ taxable: 10000, tax: 1800 });
  ok('IN: Rs 10,000 to a Walk-in — nothing (reg-in r.46(f) starts at Rs 50,000 of taxable value)', !small.held && !small.refusal);
  const big = IN({ taxable: 60000, tax: 10800 });
  ok('IN: Rs 60,000 taxable to a Walk-in — the pack holds it (r.46(f)), as the counter already does', big.held && big.held.reason === 'buyer_identity' && /r\.46\(f\)/.test(String(big.held.why)));
  const named = IN({ taxable: 60000, tax: 10800, customer: { name: 'Mayur Traders' } });
  ok('IN: a named buyer reads as named (the counter\'s reading today; address + State are the front door\'s, said in the PR)', !named.held && !named.refusal);
  const badG = IN({ taxable: 1000, tax: 180, customer: { name: 'Mayur Traders', gstin: '33AAAAA0000A1Z4' } });
  ok('IN: a GSTIN failing its checksum is the same refusal', badG.refusal && badG.refusal.code === 'BUYER_TAX_ID_BAD');
  eq('IN: the same words shop setup gets', badG.refusal && badG.refusal.why, P.taxIdRefusal('IN', '33AAAAA0000A1Z4').why);
  const goodG = IN({ taxable: 60000, tax: 10800, customer: { name: 'Mayur Traders', gstin: '27AAPFU0939F1ZV' } });
  ok('IN: a registered buyer with a GSTIN that checks out — not held, not refused', !goodG.held && !goodG.refusal);
}

/* ── 5 · buyerNamed: the till's reading ─────────────────────────────────────────────────────────────────────────── */
ok('buyerNamed: Walk-in names nobody', !BP.buyerNamed({ name: 'Walk-in' }) && !BP.buyerNamed({ name: '  ' }) && !BP.buyerNamed(null));
ok('buyerNamed: a name or a tax id names the buyer', BP.buyerNamed({ name: 'Acme' }) && BP.buyerNamed({ name: 'Walk-in', gstin: '51824753556' }));

/* ── 6 · the wire in routes/chits.js: its own step after sendIssued, outside the fail-open try; the answer carries it ── */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chits.js'), 'utf8');
  const steps = src.slice(src.indexOf('const SEND_STEPS = ['), src.indexOf('];', src.indexOf('const SEND_STEPS = [')));
  ok('SEND_STEPS runs sendPaper right after sendIssued', /sendIssued,\s*sendPaper,/.test(steps));
  const fn = src.slice(src.indexOf('async function sendPaper('), src.indexOf('async function sendCopyPolicy('));
  ok('sendPaper has no try/catch — a refusal reaches the counter, never swallowed', fn.length > 0 && !/\btry\s*\{/.test(fn));
  ok('sendPaper refuses with BUYER_TAX_ID_BAD (400) and holds under the counter\'s not_invoice slot', /status: 400/.test(fn) && /business_json\.not_invoice = paper\.held\.reason/.test(fn) && /INVOICE_HELD_BUYER/.test(fn));
  ok('sendPaper never writes over a reason the counter wrote', /if \(!business_json\.not_invoice\)/.test(fn));
  const answer = src.slice(src.indexOf('async function sendAnswer('), src.indexOf('async function sendAnswer(') + 1600);
  ok('the send answer carries not_invoice only when held (absent = silence, like number_check)', /not_invoice: st\.paper \|\| undefined/.test(answer));
}

console.log('\n  ' + (fail ? '✗ ' : '✓ ') + pass + ' passed' + (fail ? ', ' + fail + ' failed' : '') + ' · ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
