'use strict';
/**
 * tests/biz-open.realstack.cjs — BUSINESS SCENARIOS MNY-OPEN-* on REAL Postgres (api as cb_app, RLS on). Hand figures in minor units (AUD cents), written before any run; each case ends with its inverse refusal.
 * Source: toolset/sitfull/biz-money-expected.json (branch test/scenarios-money-1118). Doors: POST /api/books/opening · POST /api/books/events (tax_payment) · GET /api/books/trial-balance.
 *   MNY-OPEN-01 balanced opening (bank 2,500.00 + debtors 1,100.00 = creditors 800.00 + equity 2,800.00) · -02 the same opening twice is refused, a dated correction is allowed · -11 a date before the books start is refused · -13 GST owing at year end opens as a liability and the payment is no expense
 * Not covered here: OPEN-03/05/06/07/14 need a party, a closed year or a till sale at a stated clock time (see the scenario verdict).
 * CARD 14-accounting/ledger-accounts-day-book-entries-reverse
 */
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, freshShop, finish } = H;
const { shopDayAt } = require('./lib/shop-day.cjs');
const RUN = 'bo' + (Date.now() % 1e9).toString(36);
const AU = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: true, number: '51824753556', scheme: 'regular' } };
const DAY = shopDayAt(-1);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const say = (r) => JSON.stringify([r.status, r.b]).slice(0, 260);
async function tb(shop) {
  const r = ok(await j('/api/books/trial-balance?asOf=' + DAY + '', { token: shop.token }), 'trial balance').b;
  const out = {};
  (r.rows || []).forEach((row) => { const v = (Number(row.dr_minor) || 0) - (Number(row.cr_minor) || 0); if (v) out[row.code] = v; });
  return out;
}
/** a customer or supplier of the shop, as the relationships door makes one; its identity id is the party a debtors / creditors line must name */
async function party(s, kind, name) {
  const body = kind === 'supplier' ? { name, supply_kind: 'resale' } : { name, phone: '98400' + String(Date.now()).slice(-5) };
  const r = ok(await j('/api/relationships/' + kind + 's', { method: 'POST', token: s.token, body }), kind).b;
  const x = r[kind] || r;
  const id = x[kind + '_identity_id'] || x[kind + '_entity_id'] || x.identity_id || x.party_id || x.id;
  if (!id) throw new Error('the ' + kind + ' door answered no id: ' + JSON.stringify(r).slice(0, 200));
  return id;
}
const opening = (s, rows, ref, date) => j('/api/books/opening', { method: 'POST', token: s.token, body: { date: date || DAY, client_ref: RUN + ref, rows } });
const shop = async (tag) => { const s = await freshShop(RUN + tag, 'Open ' + tag, AU); ok(await j('/api/books/enable', { method: 'POST', token: s.token }), 'books on'); return s; };
const rowsFor = (cust, supp, debtors) => [{ code: '1500', dr_minor: 250000 }, { code: '1300', dr_minor: debtors || 110000, party_id: cust }, { code: '2100', cr_minor: 80000, party_id: supp }, { code: '3000', cr_minor: 280000 }];

(async () => {
  console.log('\n== MNY-OPEN scenarios · run ' + RUN + ' ==');
  ok(await j('/health'), 'health');

  await kase('MNY-OPEN-01', 'balanced opening: Dr 250000 + 110000 = 360000 = Cr 80000 + 280000; the TB reads exactly these; debtors typed 1,000.00 is refused by the page save (require_balanced: debits 350000, credits 360000, 10000 apart), nothing posted', async () => {
    const s = await shop('a'); const cust = await party(s, 'customer', 'Smith Builders ' + RUN), supp = await party(s, 'supplier', 'Rex Pipes ' + RUN);
    /* the page's save sends require_balanced: true and is REFUSED a difference (lib/books-opening postTyped); the bare door parks the difference in Suspense 2900 and says so (suspense_minor), by design (lib/books postOpening) */
    const bad = await j('/api/books/opening', { method: 'POST', token: s.token, body: { date: DAY, client_ref: RUN + 'bad', require_balanced: true, rows: rowsFor(cust, supp, 100000) } });
    expect(bad.status >= 400 && bad.status < 500, 'an unbalanced opening was accepted by the page save: ' + say(bad));
    expect(same(await tb(s), {}), 'the refused opening moved the books: ' + JSON.stringify(await tb(s)));
    const good = await opening(s, rowsFor(cust, supp), 'good');
    expect(good.status === 200 || good.status === 201, 'balanced opening ' + say(good));
    const t = await tb(s);
    expect(same(t, { 1300: 110000, 1500: 250000, 2100: -80000, 3000: -280000 }), 'TB ' + JSON.stringify(t) + ', hand {1300:110000, 1500:250000, 2100:-80000, 3000:-280000}');
  });

  await kase('MNY-OPEN-02', 'opening entered twice: the second (other ref) is refused 409 BOOKS_CONFLICT and bank is still 250000 once; a correction through the adjust door (a dated manual entry with a reason) is allowed', async () => {
    const s = await shop('b'); const cust = await party(s, 'customer', 'Smith ' + RUN), supp = await party(s, 'supplier', 'Rex ' + RUN);
    ok(await opening(s, rowsFor(cust, supp), 'one'), 'first opening');
    const again = await opening(s, rowsFor(cust, supp), 'two');
    expect(again.status === 409 && again.b.code === 'BOOKS_CONFLICT', 'expected 409 BOOKS_CONFLICT, got ' + say(again));
    expect((await tb(s))[1500] === 250000, 'bank after the refused repeat ' + (await tb(s))[1500] + ', hand 250000');
    const fix = await j('/api/books/entries', { method: 'POST', token: s.token, body: { date: DAY, client_ref: RUN + 'fix', narration: 'Opening correction: bank was 2,510.00', lines: [{ account: '1500', dr_minor: 1000 }, { account: '3000', cr_minor: 1000 }] } });
    expect(fix.status === 200, 'the adjust door refused a dated correction: ' + say(fix));
    expect((await tb(s))[1500] === 251000, 'bank after the correction ' + (await tb(s))[1500] + ', hand 251000');
  });

  await kase('MNY-OPEN-11', 'a date before the books start (a 2025 date on an AU shop whose year began 1 Jul 2025 or later) is refused; nothing posted', async () => {
    const s = await shop('c'); const cust = await party(s, 'customer', 'Smith ' + RUN), supp = await party(s, 'supplier', 'Rex ' + RUN);
    const r = await opening(s, rowsFor(cust, supp), 'old', '2020-06-30');
    expect(r.status >= 400 && r.status < 500, 'an opening dated 30 Jun 2020 was accepted: ' + say(r));
    expect(same(await tb(s), {}), 'the refused opening moved the books');
    ok(await opening(s, rowsFor(cust, supp), 'now'), 'the same opening dated inside the books');
  });

  await kase('MNY-OPEN-13', 'GST owing at year end opens as a liability Cr 450.00 (2200); the payment of 450.00 is Dr 2200 / Cr bank, no expense; 0.00 payable after', async () => {
    const s = await shop('d');
    ok(await opening(s, [{ code: '1500', dr_minor: 45000 }, { code: '2200', cr_minor: 45000 }], 'gst'), 'opening with GST payable');
    const a = await tb(s);
    expect(a[2200] === -45000, 'opening liability ' + a[2200] + ', hand -45000');
    const r = await j('/api/books/events', { method: 'POST', token: s.token, body: { kind: 'tax_payment', amount_minor: 45000, paid_from: 'bank', date: DAY, client_ref: RUN + 'pay', narration: 'ATO BAS PAYMENT' } });
    expect(r.status === 200, 'tax_payment ' + say(r));
    const t = await tb(s);
    expect(!t[2200] && t[1500] === 0 || (!t[2200] && !t[1500]), 'after the payment ' + JSON.stringify(t) + ', hand 2200 = 0, bank 0 (45000 in, 45000 out) and no 6xxx');
    expect(Object.keys(t).every((c) => !/^[4-6]/.test(c)), 'the payment reached the P&L: ' + JSON.stringify(t));
  });
  finish('biz-open');
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
