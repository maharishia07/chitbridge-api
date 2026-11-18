'use strict';
/**
 * tests/biz-rep.realstack.cjs — BUSINESS SCENARIOS MNY-REP-* (reports read what the books hold) on REAL Postgres (api as cb_app, RLS on). Hand figures in minor units (AUD cents), written before any run; each case ends with its inverse refusal.
 * Source: toolset/sitfull/biz-money-expected.json (branch test/scenarios-money-1118). Fixture E1-E5 as the scenarios define it, posted through POST /api/books/entries (manual journals, the one writer):
 *   E1 capital in 5,000.00 · E2 cash sale 1,100.00 (1,000.00 + 100.00 GST) · E3 purchase bill 550.00 (500.00 + 50.00 GST) on credit · E4 the bill paid 550.00 · E5 rent 2,200.00 (2,000.00 + 200.00 GST) from the bank.
 * HAND: bank 335000 Dr · 5000 purchases 50000 · 6010 rent 200000 · GST net Dr 15000 (2210 paid 25000, 2200 collected 10000 Cr) · sales 100000 Cr · capital 500000 Cr · creditors 0 · total Dr 600000 = Cr 600000.
 *   REP-01 trial balance · -02 P&L (income 100000, net loss 150000) · -03 balance sheet balances · -04 reverse E5 (bank 555000, GST net Cr 5000, profit 50000) and a second reverse is 409 · -05 the day book keeps the reversed pair (6 entries) · -09 a closed month refuses a late entry · -10 reopen, post 100.00 late cost, profit falls by exactly 10000
 * Doors: POST /entries · /entries/:id/reverse · /periods/:fy/:p/lock|unlock · GET /trial-balance · /pl · /bs · /daybook.   CARD 14-accounting/ledger-accounts-day-book-entries-reverse
 */
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, freshShop, finish } = H;
const { shopDayAt } = require('./lib/shop-day.cjs');
const RUN = 'br' + (Date.now() % 1e9).toString(36).padStart(6, '0');
const AU = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: true, number: '51824753556', scheme: 'regular' } };
const DAY = shopDayAt(-1);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const say = (r) => JSON.stringify([r.status, r.b]).slice(0, 300);
async function tb(shop) {
  const r = ok(await j('/api/books/trial-balance?asOf=' + DAY + '', { token: shop.token }), 'trial balance').b;
  const out = {};
  (r.rows || []).forEach((row) => { const v = (Number(row.dr_minor) || 0) - (Number(row.cr_minor) || 0); if (v) out[row.code] = v; });
  return { map: out, rows: r.rows || [], raw: r };
}
const SUP = {};
/** a customer or supplier of the shop, as the relationships door makes one; its identity id is the party a debtors / creditors line must name */
async function party(s, kind, name) {
  const body = kind === 'supplier' ? { name, supply_kind: 'resale' } : { name, phone: '98400' + String(Date.now()).slice(-5) };
  const r = ok(await j('/api/relationships/' + kind + 's', { method: 'POST', token: s.token, body }), kind).b;
  const x = r[kind] || r;
  const id = x[kind + '_identity_id'] || x[kind + '_entity_id'] || x.identity_id || x.party_id || x.id;
  if (!id) throw new Error('the ' + kind + ' door answered no id: ' + JSON.stringify(r).slice(0, 200));
  return id;
}
const entry = (s, tag, narration, lines) => j('/api/books/entries', { method: 'POST', token: s.token, body: { date: DAY, client_ref: RUN + tag, narration, lines } });
async function fixture(tag) {
  const s = await freshShop(RUN + tag, 'Rep ' + tag, AU);
  ok(await j('/api/books/enable', { method: 'POST', token: s.token }), 'books on');
  const ids = {}; const supp = await party(s, 'supplier', 'Rex Pipes ' + RUN + tag);
  const post = async (k, narration, lines) => { const r = await entry(s, tag + k, narration, lines); if (r.status !== 200) throw new Error('fixture ' + k + ' refused: ' + say(r)); ids[k] = r.b.entry_id; };
  await post('E1', 'Capital in', [{ account: '1500', dr_minor: 500000 }, { account: '3000', cr_minor: 500000 }]);
  await post('E2', 'Cash sale', [{ account: '1500', dr_minor: 110000 }, { account: '4000', cr_minor: 100000 }, { account: '2200', cr_minor: 10000 }]);
  await post('E3', 'Purchase bill on credit', [{ account: '5000', dr_minor: 50000 }, { account: '2210', dr_minor: 5000 }, { account: '2100', cr_minor: 55000, party_id: supp }]);
  await post('E4', 'Bill paid', [{ account: '2100', dr_minor: 55000, party_id: supp }, { account: '1500', cr_minor: 55000 }]);
  await post('E5', 'Rent', [{ account: '6010', dr_minor: 200000 }, { account: '2210', dr_minor: 20000 }, { account: '1500', cr_minor: 220000 }]);
  return { s, ids };
}
const FIXED = { 1500: 335000, 2200: -10000, 2210: 25000, 3000: -500000, 4000: -100000, 5000: 50000, 6010: 200000 };

(async () => {
  console.log('\n== MNY-REP scenarios · run ' + RUN + ' ==');
  ok(await j('/health'), 'health');
  const A = await fixture('a');

  await kase('MNY-REP-01', 'trial balance after E1-E5: bank Dr 335000, purchases 50000, rent 200000, GST paid 25000 / collected 10000, sales Cr 100000, capital Cr 500000, creditors 0; Dr total 610000 = Cr total 610000 (the scenario 6,000.00 nets the two GST ledgers); an unbalanced entry is refused and the totals still agree', async () => {
    const t = await tb(A.s);
    expect(same(t.map, FIXED), 'TB ' + JSON.stringify(t.map) + ', hand ' + JSON.stringify(FIXED));
    const dr = t.rows.reduce((a, r) => a + (Number(r.dr_minor) || 0), 0), cr = t.rows.reduce((a, r) => a + (Number(r.cr_minor) || 0), 0);
    expect(dr === 610000 && cr === 610000, 'total Dr ' + dr + ' / Cr ' + cr + ', hand 610000 each (335000+25000+50000+200000 = 10000+500000+100000)');
    const bad = await entry(A.s, 'bad', 'one cent out', [{ account: '1500', dr_minor: 1 }, { account: '3000', cr_minor: 2 }]);
    expect(bad.status >= 400 && bad.status < 500, 'an unbalanced entry was accepted: ' + say(bad));
    expect(same((await tb(A.s)).map, FIXED), 'the refused entry moved the books');
  });

  await kase('MNY-REP-02', 'profit and loss: income 100000 (net of GST, not 110000), expenses rent 200000 + purchases 50000, net loss 150000', async () => {
    const r = ok(await j('/api/books/pl?from=' + DAY + '&to=' + DAY, { token: A.s.token }), 'pl').b;
    expect(r.total_income_minor === 100000, 'income ' + r.total_income_minor + ', hand 100000 (GST is not income)');
    expect(r.profit_minor === -150000, 'profit ' + r.profit_minor + ', hand -150000 (net loss 1,500.00)');
  });

  await kase('MNY-REP-03', 'balance sheet balances: assets = liabilities + equity; equity = capital 500000 - loss 150000 = 350000', async () => {
    const r = ok(await j('/api/books/bs?asOf=' + DAY, { token: A.s.token }), 'bs').b;
    expect(r.balanced === true && r.total_assets_minor === r.total_liab_equity_minor, 'balanced ' + r.balanced + ' assets ' + r.total_assets_minor + ' vs ' + r.total_liab_equity_minor);
    expect(r.total_assets_minor === 350000, 'total assets ' + r.total_assets_minor + ', hand 350000 (bank 335000 + GST receivable net 15000; GST paid 25000 set against collected 10000)');
  });

  await kase('MNY-REP-05', 'the day book holds E1..E5 (5 entries) before the reversal; each entry balances', async () => {
    const r = ok(await j('/api/books/daybook?from=' + DAY + '&to=' + DAY, { token: A.s.token }), 'daybook').b;
    expect((r.entries || []).length === 5, 'entries ' + (r.entries || []).length + ', hand 5');
    (r.entries || []).forEach((e) => { const d = e.lines.reduce((a, l) => a + (Number(l.dr_minor) || 0), 0), c = e.lines.reduce((a, l) => a + (Number(l.cr_minor) || 0), 0); expect(d === c, 'entry ' + e.entry_no + ' Dr ' + d + ' Cr ' + c); });
  });

  await kase('MNY-REP-04', 'reverse E5: bank 555000, rent 0, GST net Cr 5000, profit 50000; a second reverse is 409 ALREADY_REVERSED; the day book then holds 6 entries and the reversal names E5', async () => {
    const r = await j('/api/books/entries/' + A.ids.E5 + '/reverse', { method: 'POST', token: A.s.token, body: { reason: 'rent was paid by the landlord' } });
    expect(r.status === 200 && r.b.ok, 'reverse ' + say(r));
    const t = await tb(A.s);
    expect(same(t.map, { 1500: 555000, 2200: -10000, 2210: 5000, 3000: -500000, 4000: -100000, 5000: 50000 }), 'TB ' + JSON.stringify(t.map) + ', hand {1500:555000, 2200:-10000, 2210:5000, 3000:-500000, 4000:-100000, 5000:50000}');
    const pl = ok(await j('/api/books/pl?from=' + DAY + '&to=' + DAY, { token: A.s.token }), 'pl').b;
    expect(pl.profit_minor === 50000, 'profit ' + pl.profit_minor + ', hand 50000');
    const again = await j('/api/books/entries/' + A.ids.E5 + '/reverse', { method: 'POST', token: A.s.token, body: { reason: 'again' } });
    expect(again.status === 409 && again.b.code === 'ALREADY_REVERSED', 'second reverse expected 409 ALREADY_REVERSED, got ' + say(again));
    const day = ok(await j('/api/books/daybook?from=' + DAY + '&to=' + DAY, { token: A.s.token }), 'daybook').b;
    expect((day.entries || []).length === 6, 'day book ' + (day.entries || []).length + ' entries, hand 6 (nothing deleted)');
    expect(same((await tb(A.s)).map, t.map), 'the second reverse moved the books');
  });

  await kase('MNY-REP-09', 'a posting into a closed month is refused (409, the lock in words), nothing posted; MNY-REP-10 reopen (status open), post a late cost 100.00 with no GST, profit falls by exactly 10000', async () => {
    const s = (await fixture('b')).s;
    const periods = ok(await j('/api/books/periods', { token: s.token }), 'periods').b;
    const rows = Array.isArray(periods.periods || periods.rows || periods) ? (periods.periods || periods.rows || periods) : [];
    const row = rows.find((p) => String(p.start_date).slice(0, 10) <= DAY && String(p.end_date).slice(0, 10) >= DAY);
    expect(row, 'no period row covers ' + DAY + ': ' + JSON.stringify(periods).slice(0, 200));
    const fy = row.fiscal_year || periods.fiscal_year, pno = Number(row.period);
    const before = (await tb(s)).map;
    const lk = await j('/api/books/periods/' + fy + '/' + pno + '/lock', { method: 'POST', token: s.token, body: {} });
    expect(lk.status === 200, 'lock ' + say(lk));
    const late = await entry(s, 'late', 'Bank charge 15.00', [{ account: '6090', dr_minor: 1500 }, { account: '1500', cr_minor: 1500 }]);
    expect(late.status === 409 && /lock|closed/i.test(JSON.stringify(late.b)), 'late entry expected 409 naming the closed month, got ' + say(late));
    expect(same((await tb(s)).map, before), 'the refused entry moved the books');
    const plBefore = ok(await j('/api/books/pl?from=' + DAY + '&to=' + DAY, { token: s.token }), 'pl').b.profit_minor;
    const un = await j('/api/books/periods/' + fy + '/' + pno + '/unlock', { method: 'POST', token: s.token, body: { reason: 'late cost' } });
    expect(un.status === 200 && un.b.period.status === 'open', 'reopen ' + say(un));
    ok(await entry(s, 'late2', 'Late cost 100.00 no GST', [{ account: '6190', dr_minor: 10000 }, { account: '1500', cr_minor: 10000 }]), 'late cost after the reopen');
    const plAfter = ok(await j('/api/books/pl?from=' + DAY + '&to=' + DAY, { token: s.token }), 'pl').b.profit_minor;
    expect(plBefore - plAfter === 10000, 'profit moved by ' + (plBefore - plAfter) + ', hand exactly 10000');
  });
  finish('biz-rep');
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
