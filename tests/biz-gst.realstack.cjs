'use strict';
/**
 * tests/biz-gst.realstack.cjs — BUSINESS SCENARIOS MNY-GST-* (bank-fed purchases and the GST paid ledger 2210) on REAL Postgres (api as cb_app, RLS on). Hand figures in minor units (AUD cents), written before any run; each case ends with its inverse refusal.
 * Source: toolset/sitfull/biz-money-expected.json (branch test/scenarios-money-1118). Doors: POST /api/books/events (expense with the bank line's own GST) · GET /api/books/trial-balance.
 *   MNY-GST-15 a month of mixed bank lines gives one 1B of 9.00 (the kinds decide, never gross / 11) · -18 an invoice above the threshold that is not held claims no credit; the claim waits for the invoice
 * Not covered here: GST-01..-13/-16/-23/-25/-26 need a sale chit through the till (the lifecycle runner) or the BAS reader with a stated return period; they are listed in the scenario verdict as not written.
 * CARD 14-accounting/gst
 */
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, freshShop, finish } = H;
const { shopDayAt } = require('./lib/shop-day.cjs');
const RUN = 'bg' + (Date.now() % 1e9).toString(36);
const AU = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: true, number: '51824753556', scheme: 'regular' } };
const DAY = shopDayAt(-1);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const say = (r) => JSON.stringify([r.status, r.b]).slice(0, 260);
let n = 0;
async function tb(shop) {
  const r = ok(await j('/api/books/trial-balance?asOf=' + DAY + '', { token: shop.token }), 'trial balance').b;
  const out = {};
  (r.rows || []).forEach((row) => { const v = (Number(row.dr_minor) || 0) - (Number(row.cr_minor) || 0); if (v) out[row.code] = v; });
  return out;
}
const post = (s, b) => j('/api/books/events', { method: 'POST', token: s.token, body: Object.assign({ kind: 'expense', date: DAY, paid_from: 'bank', client_ref: RUN + '-' + (++n) }, b) });
const shop = async (tag) => { const s = await freshShop(RUN + tag, 'Gst ' + tag, AU); ok(await j('/api/books/enable', { method: 'POST', token: s.token }), 'books on'); return s; };

(async () => {
  console.log('\n== MNY-GST scenarios · run ' + RUN + ' ==');
  ok(await j('/health'), 'health');

  await kase('MNY-GST-15', 'a month of four bank lines: rental 33.00 (taxable) 3.00 + fee 15.00 (input-taxed) 0.00 + Bunnings 66.00 (taxable) 6.00 + wages 4,250.00 (none): 2210 = 900; not 396.73 (4,364.00 / 11)', async () => {
    const s = await shop('a');
    ok(await post(s, { class: 'rent', amount_minor: 3000, input_tax_minor: 300, narration: 'EFTPOS TERMINAL RENTAL' }), 'rental');
    ok(await post(s, { class: 'bank_charges', amount_minor: 1500, narration: 'ACCOUNT SERVICE FEE' }), 'fee');
    ok(await post(s, { class: 'sundry_expense', amount_minor: 6000, input_tax_minor: 600, narration: 'BUNNINGS' }), 'Bunnings (66.00 is under the tax-invoice threshold)');
    ok(await post(s, { class: 'wages', amount_minor: 425000, narration: 'WAGES' }), 'wages');
    const t = await tb(s);
    expect(t[2210] === 900, '1B / GST paid 2210 = ' + t[2210] + ', hand 900 (300 + 600)');
    expect(t[2210] !== 39673, '1B read all 4,364.00 / 11');
    expect(same(t, { 1500: -436400, 2210: 900, 5100: 425000, 6010: 3000, 6090: 1500, 6190: 6000 }), 'books ' + JSON.stringify(t) + ', hand {1500:-436400, 2210:900, 5100:425000, 6010:3000, 6090:1500, 6190:6000}');
  });

  /* the inverse at the DOOR, apart: the proposal side is proved above (MNY-BANK-03 suggests no tax); this asks whether the api itself refuses a typed claim on the bank-charges class. A rule question, not a defect: the class 6090 holds merchant fees (taxable) beside account fees (input-taxed), so the door takes the person's tax answer. Known-red until Athi says where the rule lives. */
  await kase('MNY-GST-15b', 'a GST claim of 1.36 typed on an input-taxed account fee is refused by the door', async () => {
    const s = await shop('c');
    const gross = await post(s, { class: 'bank_charges', amount_minor: 1364, input_tax_minor: 136, narration: 'ACCOUNT SERVICE FEE with a typed claim' });
    expect(gross.status >= 400 && gross.status < 500, 'a GST claim of 1.36 on an account fee was accepted: ' + say(gross));
  }, 'rule question: the bank-charges class mixes taxable merchant fees and input-taxed account fees; the supply kind is the person's answer (lib/books-bank-tax.js withBankTax)');

  await kase('MNY-GST-18', 'payment 550.00 on 28 Oct, no tax invoice: GST credit 0.00, cost 550.00; claiming the 50.00 without the invoice is refused 422, October unchanged', async () => {
    const s = await shop('b');
    const claim = await post(s, { class: 'repairs', amount_minor: 50000, input_tax_minor: 5000, tax_invoice: 'none', narration: 'PLUMBING SUPPLIER' });
    expect(claim.status === 422 && /tax invoice/i.test(JSON.stringify(claim.b)), 'a claim without the invoice expected 422 naming the tax invoice, got ' + say(claim));
    expect(same(await tb(s), {}), 'the refused claim wrote to the books');
    ok(await post(s, { class: 'repairs', amount_minor: 55000, narration: 'PLUMBING SUPPLIER, invoice not yet held' }), 'whole 550.00 as cost');
    const t = await tb(s);
    expect(same(t, { 1500: -55000, 6060: 55000 }) && !t[2210], 'books ' + JSON.stringify(t) + ', hand {1500:-55000, 6060:55000}, 2210 = 0');
  });
  finish('biz-gst');
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
