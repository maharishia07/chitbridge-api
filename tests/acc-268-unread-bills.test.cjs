/**
 * tests/acc-268-unread-bills.test.cjs — ACC-268: A RETURN NEVER GOES OUT WITH A BILL SILENTLY MISSING.
 *
 * OWNS      the proof that lib/tax-copy.js ledgerFor NAMES (dropped + dropped_why, in words) a bill of the month that the ledger left out
 *           (SIT injection 1: a counter bill that lost its till mark reads as a supply to the shop itself) or counted as 0 while its own
 *           summary_json.money.total is not 0 (SIT injection 2), and that GET /api/tax/gstr then refuses with 422, for GSTR-1 and GSTR-3B.
 *           A healthy month and a genuinely free bill (money.total 0) are NOT named.
 *           AU BAS / AE VAT201 do not read this reader (they are posted-books reads: lib/books*), so they are not in this file.
 * CALLED BY the test library (api T1). Run: node tests/acc-268-unread-bills.test.cjs
 * CARD      15-tax-and-country-packs/tax-compute-rate-invoice-tax
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const IDENTITY = { identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Traders', country: 'IN', timezone: 'Asia/Kolkata', policy_flags: { price_includes_tax: 'no' } };
const AT = new Date().toISOString();
const id = (n) => 'a0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const invoice = (taxable, tax) => ({ currency: 'INR', DocDtls: { Typ: 'INV' }, ItemList: [{ GstRt: 18, AssAmt: taxable, CgstAmt: tax / 2, SgstAmt: tax / 2, IgstAmt: 0, CesAmt: 0 }], ValDtls: { AssVal: taxable, CgstVal: tax / 2, SgstVal: tax / 2, IgstVal: 0, CesVal: 0, TotInvVal: taxable + tax } });
const party = { role: 'sender', entity_id: SHOP, display_name: 'Mayur Traders' };
/** a counter bill copy: business_json as the till writes it, money block beside it */
const header = (n, purpose, bj, money) => ({ chit_id: id(n), sender_entity_id: SHOP, purpose, all_recipients: [party, Object.assign({}, party, { role: 'receiver' })], business_json: bj, summary_json: { money: { total: money } }, sent_at: AT, created_at: AT, line_items: [{ line_id: 'l', particulars: 'x', quantity: 1, price: 500, total: 590, gst_rate: 18 }], currency_code: 'INR' });
const counterBj = (no, inv) => ({ customer: { name: 'Walk-in' }, till: { id: 'C1' }, bill_no: no, billed_at: AT, invoice: inv });
const healthy = (n) => header(n, 'order', counterBj('T' + n, invoice(500, 90)), 590);

/** the real tax-copy on a fresh load, its db stubbed to hand back `rows` */
function loadWith(rows) {
  const dbPath = require.resolve(path.join(API, 'db')), tcPath = require.resolve(path.join(API, 'lib', 'tax-copy'));
  require.cache[dbPath] = { exports: { query: async (sql) => ({ rows: /identities/.test(sql) ? [IDENTITY] : [] }), withEntity: async (e, fn) => fn({ query: async () => ({ rows }) }) } };
  delete require.cache[tcPath];
  return require(tcPath);
}
/** ACC-268 as SIT part 6 made it live (k46-acc268r): a stored bill whose business_json was overwritten with {invoice:'x', bill_no} (no till mark) and whose header carries NO money block, only total_value (or nothing) */
const liveLost = (n, totalValue) => Object.assign(header(n, 'order', { invoice: 'x', bill_no: 'T' + n }, 0), { summary_json: totalValue === undefined ? {} : { total_value: totalValue } });
const month = AT.slice(0, 7);

(async () => {
  console.log('\n== ACC-268: a bill the return would silently miss is named ==\n');
  const lost = header(3, 'order', { invoice: 'x', bill_no: 'T3' }, 590); /* SIT injection 1: the till mark is gone, so the copy reads as a supply to the shop itself */
  const zero = header(4, 'order', counterBj('T4', invoice(0, 0)), 590); /* SIT injection 2: the invoice reads as nothing while the bill's own money.total is 590 */
  const free = header(5, 'order', counterBj('T5', invoice(0, 0)), 0); /* fully discounted: a genuine zero */
  
  const base = await loadWith([healthy(1), healthy(2)]).ledgerFor(SHOP, month);
  ok('healthy month: both bills count, nothing named, figures as ever', base.ledger.count === 2 && base.ledger.output.taxable === 1000 && base.ledger.output.cgst === 90 && base.dropped.length === 0 && base.dropped_why.length === 0, JSON.stringify([base.ledger.count, base.ledger.output, base.dropped]));

  const a = await loadWith([healthy(1), lost]).ledgerFor(SHOP, month);
  ok('(a) a skipped bill is named in dropped, the other bill still counts', a.ledger.count === 1 && a.ledger.output.taxable === 500 && a.dropped.length === 1 && a.dropped[0] === id(3), JSON.stringify([a.ledger.count, a.dropped]));
  ok('(a) with the reason in words (bill number, left out, its own total)', /Bill T3: .*left it out.*590/.test((a.dropped_why[0] || {}).why || ''), JSON.stringify(a.dropped_why));

  const b = await loadWith([healthy(1), zero]).ledgerFor(SHOP, month);
  ok('(b) a bill that reads 0 beside a non-zero money.total is named', b.ledger.count === 2 && b.dropped.length === 1 && b.dropped[0] === id(4), JSON.stringify([b.ledger.count, b.dropped]));
  ok('(b) with the reason in words', /Bill T4: it reads as 0 but the bill itself says it is for 590/.test((b.dropped_why[0] || {}).why || ''), JSON.stringify(b.dropped_why));

  const live = await loadWith([healthy(1), liveLost(7, 300)]).ledgerFor(SHOP, month);
  ok('(live shape) a bill with no money block, only total_value 300, that the ledger skips is NAMED in dropped, with its total', live.ledger.count === 1 && live.dropped.length === 1 && live.dropped[0] === id(7) && /Bill T7: .*left it out.*300/.test((live.dropped_why[0] || {}).why || ''), JSON.stringify([live.ledger.count, live.dropped, live.dropped_why]));
  const none = await loadWith([healthy(1), liveLost(8)]).ledgerFor(SHOP, month);
  ok('(live shape) a skipped bill that states no total at all is still NAMED (we cannot say it is free), without an amount', none.dropped.length === 1 && none.dropped[0] === id(8) && /Bill T8: .*left it out.*states no total/.test((none.dropped_why[0] || {}).why || ''), JSON.stringify([none.dropped, none.dropped_why]));
  const freeLive = await loadWith([healthy(1), liveLost(9, 0)]).ledgerFor(SHOP, month);
  ok('(live shape) a skipped bill whose stored total is 0 is a free bill: not named', freeLive.dropped.length === 0, JSON.stringify(freeLive.dropped));

  const g = await loadWith([healthy(1), free]).ledgerFor(SHOP, month);
  ok('a genuinely free bill is not named', g.dropped.length === 0 && g.ledger.count === 2 && g.ledger.rows.some((row) => row.chit_id === id(5)), JSON.stringify([g.dropped, g.ledger.count]));

  /* the route: 422 for GSTR-1 and GSTR-3B on a corrupt month, 200 for a healthy one */
  const authPath = require.resolve(path.join(API, 'middleware', 'auth')), taxPath = require.resolve(path.join(API, 'routes', 'tax'));
  const passAuth = new Proxy((req, res, next) => next(), { get: (fn, key) => (key === 'entityOf' ? () => SHOP : typeof fn[key] === 'undefined' ? () => (req, res, next) => next() : fn[key]) });
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: passAuth };
  const express = require('express'), http = require('http');
  const serve = async (rows) => {
    loadWith(rows); delete require.cache[taxPath];
    const app = express(); app.use('/api/tax', require(taxPath));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const get = (p) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: server.address().port, path: p }, (res) => { let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve({ status: res.statusCode, text: t })); }).on('error', reject));
    return { get, close: () => server.close() };
  };
  for (const form of ['gstr1', 'gstr3b']) {
    let s = await serve([healthy(1), lost]);
    let r = await s.get('/api/tax/gstr?month=' + month + '&form=' + form); s.close();
    ok(form + ' (a) skipped bill: 422 GSTR_REFUSED, the bill and its reason in the words', r.status === 422 && /GSTR_REFUSED/.test(r.text) && /Bill T3/.test(r.text) && /left it out/.test(r.text), r.status + ' ' + r.text.slice(0, 300));
    s = await serve([healthy(1), zero]);
    r = await s.get('/api/tax/gstr?month=' + month + '&form=' + form); s.close();
    ok(form + ' (b) zero-read bill: 422 GSTR_REFUSED', r.status === 422 && /GSTR_REFUSED/.test(r.text) && /Bill T4/.test(r.text), r.status + ' ' + r.text.slice(0, 300));
    s = await serve([healthy(1), liveLost(7, 300)]);
    r = await s.get('/api/tax/gstr?month=' + month + '&form=' + form); s.close();
    ok(form + ' (live shape) the skipped bill with no money block: 422 GSTR_REFUSED naming it', r.status === 422 && /GSTR_REFUSED/.test(r.text) && /Bill T7/.test(r.text), r.status + ' ' + r.text.slice(0, 300));
    s = await serve([healthy(1), healthy(2), free]);
    r = await s.get('/api/tax/gstr?month=' + month + '&form=' + form); s.close();
    ok(form + ' healthy month (with a free bill): 200 with the file', r.status === 200 && (form === 'gstr3b' ? JSON.parse(r.text).sup_details.osup_det.txval === 1000 : !!JSON.parse(r.text).gstin), r.status + ' ' + r.text.slice(0, 200));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
