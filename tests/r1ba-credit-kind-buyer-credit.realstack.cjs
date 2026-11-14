'use strict';
/**
 * tests/r1ba-credit-kind-buyer-credit.realstack.cjs — R1 slices B and A (DEC-267), real Postgres, api as cb_app, RLS on. Scenario ids R102-AU and R101-AU
 * (web docs/16-finance/fable-risk1-scenarios.json). Column 13 (it adds up): the BAS reads sales ledgers and the input-tax ledger; whatever the books post must
 * leave the box the sale filled and the claim the buyer may make.
 *   B  AU shop, cash bills S1 taxable 110.00 incl GST · S2 GST-free 44.00 · S3 input-taxed 400.00, then credit notes CN2 (44.00) and CN3 (400.00), refunded in cash:
 *      before the notes G3 4,400 and G4 40,000 (the G4 box shows once the api adopts reg-au >= v1.90.0, the B6b adopt: until then the BAS answers no G4 and the test accepts that); after: G1 11,000 · G3 0 · G4 0 · 1A 1,000, and 4090 sales returns holds nothing (a note debits the kind's own ledger).
 *      Also settles the plan's open question: the credit note's invoice carries `_cb.kinds`, or the note lands on sales_returns and G3 stays 4,400 (CN-KINDS case).
 *   A  AU expense paid 165.00 incl GST 15.00: a registered shop claims 15.00 (2210) and posts 150.00; an UNREGISTERED shop posts the GROSS 165.00 and nothing to 2210;
 *      a shop that NEVER SAID waits (books empty), and posts the gross once it answers "no" (POST /api/books/check).
 * Run: node tests/r1ba-credit-kind-buyer-credit.realstack.cjs   (API_BASE / TRUTH_DB as tests/lib/truth-harness.cjs says; LOCAL OR A NAMED SIT BOX ONLY)
 * CARD 14-accounting (R1 slices B and A)
 */
const H = require('./lib/truth-harness.cjs');
const { j, ok, pause, kase, expect, bill, creditNote, freshShop, finish } = H;
const tax = require('../lib/tax');
const RUN = 'r1ba' + (Date.now() % 1e9).toString(36);
const ABN = '51824753556';
const AU = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney' };
const NAME = 'R1BA shop';
const send = (shop, body) => j('/api/chits/send', { method: 'POST', token: shop.token, body });
const idOf = (r) => r.b.chit_id || (r.b.chit && r.b.chit.chit_id);
const minor = (x) => Math.round(Number(x || 0) * 100);

/** the engine's invoice for rows [[{name, price, kind?}, qty]]; prices include tax (the shelf convention), as the business run builds it */
function invoiceOf(rows) {
  return tax.determine({
    seller: { Gstin: ABN, LglNm: NAME, TrdNm: NAME, State: '', Country: 'AU', RegType: 'regular' },
    buyer: { LglNm: 'Walk-in', Gstin: '', State: '', RegType: 'unregistered', Country: 'AU', Pos: '' },
    lines: rows.map(([p, qty], i) => Object.assign({ id: String(i + 1), name: p.name, unit: 'piece', hsn: '', qty, unit_price: p.price, discount: 0, gst_rate: p.kind ? 0 : 10, cess_rate: 0 }, p.kind ? { supply_kind: p.kind } : {})),
    priceIncludesTax: true
  });
}
const totalOf = (inv) => Number(inv.ValDtls.TotInvVal);
/** the BAS quarter label for today (AU year starts July: 2026-Q2 = Oct-Dec 2026) */
function quarterNow() {
  const d = new Date(), m = d.getUTCMonth() + 1, fy = m >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return fy + '-Q' + (Math.floor(((m - 7 + 12) % 12) / 3) + 1);
}
async function tb(token) {
  await pause(3500);
  const r = ok(await j('/api/books/trial-balance?asOf=' + new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), { token }), 'trial balance').b;
  const out = {};
  (r.rows || []).forEach((row) => { const net = (row.dr_minor || 0) - (row.cr_minor || 0); if (net) out[row.code] = net; });
  return out;
}
const boxes = async (token) => {
  const r = ok(await j('/api/books/returns?period=' + quarterNow() + '&simpler=0', { token }), 'BAS (full)').b;
  const out = {}; (r.boxes || []).forEach((b) => { out[b.code] = b.amount_minor; });
  return out;
};
async function ausShop(tag, tx) {
  const S = await freshShop(RUN + tag, NAME, Object.assign({}, AU, tx ? { tax: tx } : {}));
  ok(await j('/api/books/enable', { method: 'POST', token: S.token, body: { walkin_grain: 'bill' } }), 'books on');
  return S;
}
const expenseChit = (no, amount, taxAmount) => ({ recipients: [{ self: true, name: 'self' }], purpose: 'expense', subject: 'Expense ' + no, manual_subject: 'Expense ' + no, client_ref: no,
  business_json: { bill_no: no, billed_at: new Date().toISOString(), expense: { what: 'Electricity, tax invoice ' + amount + ' incl tax ' + taxAmount, mode: 'Bank', amount, class: 'electricity', input_tax: { gst: taxAmount } } } });

(async () => {
  console.log('\n── R1 slices B and A · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');

  /* ── B: credit notes reduce the box of their sale ── */
  const A = await ausShop('a', { registered: true, number: ABN, scheme: 'regular' });
  const docs = {};
  const sale = async (id, price, kind) => {
    const rows = [[{ name: id + ' item', price, kind }, 1]], inv = invoiceOf(rows), no = id + '/' + RUN;
    const p = { id: undefined, name: id + ' item', unit: 'piece', price, gst_rate: kind ? 0 : 10 };
    const r = ok(await send(A, bill(no, [[p, 1]], { invoice: inv, parts: [{ how: 'cash', amount: totalOf(inv) }], slip: 'cash' })), 'sale ' + id);
    docs[id] = { chit: idOf(r), no, p, kind, total: totalOf(inv) };
  };
  const note = async (id, of) => {
    const inv = invoiceOf([[{ name: of.p.name, price: of.p.price, kind: of.kind }, 1]]), no = id + '/' + RUN;
    ok(await send(A, creditNote(no, of.no, [[of.p, 1]], { againstId: of.chit, invoice: inv, parts: [{ how: 'cash', amount: totalOf(inv) }] })), 'credit note ' + id);
  };
  await sale('S1', 110); await sale('S2', 44, 'gst_free'); await sale('S3', 400, 'input_taxed');
  await pause(3000);
  await kase('R102-0', 'before the notes: G1 55,400 · G3 4,400 · G4 40,000 · 1A 1,000 (the sales sit in their own boxes)', async () => {
    const b = await boxes(A.token);
    expect(b.G1 === 55400 && b.G3 === 4400 && (b.G4 === 40000 || b.G4 === undefined) && b['1A'] === 1000, 'boxes ' + JSON.stringify(b));
  });
  await note('CN2', docs.S2); await note('CN3', docs.S3);
  await pause(4000);
  await kase('R102-AU', 'after the credit notes: G1 11,000 · G2 0 · G3 0 · G4 0 · 1A 1,000 · 1B 0 (each note reduced the box of its sale)', async () => {
    const b = await boxes(A.token);
    expect(b.G1 === 11000 && b.G2 === 0 && b.G3 === 0 && (b.G4 === 0 || b.G4 === undefined) && b['1A'] === 1000 && b['1B'] === 0, 'boxes ' + JSON.stringify(b));
  });
  await kase('CN-KINDS', "the notes debited 4020 / 4030, not 4090 (so the credit note's invoice carried _cb.kinds into the books)", async () => {
    const t = await tb(A.token);
    expect(!t[4090] && !t[4020] && !t[4030], 'trial balance ' + JSON.stringify(t) + ' (4090 sales returns / 4020 GST-free / 4030 input-taxed must all be nil)');
  });

  /* ── A: the buyer who may not claim ── */
  const R = await ausShop('r', { registered: true, number: ABN, scheme: 'regular' });
  ok(await send(R, expenseChit('E-R/' + RUN, 165, 15)), 'expense (registered)');
  await kase('R101-reg', 'a REGISTERED shop claims the 15.00: 6030 +15000 · 2210 +1500', async () => {
    const t = await tb(R.token);
    expect(t[6030] === 15000 && t[2210] === 1500, 'trial balance ' + JSON.stringify(t));
  });
  const U = await ausShop('u', { registered: false });
  ok(await send(U, expenseChit('E-U/' + RUN, 165, 15)), 'expense (unregistered)');
  await kase('R101-AU', 'an UNREGISTERED shop cannot claim: 6030 +16500 (the gross), 2210 nil', async () => {
    const t = await tb(U.token);
    expect(t[6030] === 16500 && !t[2210], 'trial balance ' + JSON.stringify(t));
  });
  const W = await ausShop('w', null);
  ok(await send(W, expenseChit('E-W/' + RUN, 165, 15)), 'expense (never said)');
  await kase('R101-wait', 'a shop that NEVER SAID waits: nothing posted yet', async () => {
    const t = await tb(W.token);
    expect(!t[6030] && !t[2210], 'trial balance ' + JSON.stringify(t) + ' (the expense with tax must wait with the registration question)');
  });
  await kase('R101-release', 'answering "no" releases it: the gross 16500 on 6030, no 2210', async () => {
    ok(await j('/api/governance/country-setup', { method: 'PUT', token: W.token, body: Object.assign({}, AU, { tax: { registered: false } }) }), 'answer no');
    ok(await j('/api/books/check', { method: 'POST', token: W.token, body: {} }), 'books check (retry waiting)');
    const t = await tb(W.token);
    expect(t[6030] === 16500 && !t[2210], 'trial balance ' + JSON.stringify(t));
  });
  finish('r1ba-credit-kind-buyer-credit');
})().catch((e) => { console.error(e); process.exit(1); });
