#!/usr/bin/env node
/**
 * e2e/walk-statements.cjs - THE STATEMENTS BESIDE LAST YEAR, WALKED (ACC-357, W15-103/103b/118/119): the P&L, the Balance sheet, the Trial balance and the BAS box of an Australian shop.
 * Black box: the real accounts.html and cap-books.js; the API is a stand-in answering inside the page in the shapes routes/books.js sends (checked against the contract on the way out).
 *   S1  P&L: the Profit leads (with its share of income and last year), one heading, a subtotal per head, Last year · Change · % of income, the period picker and the stepper
 *   S2  a P&L ledger line opens its entries BELOW (one read of ten, for the same period); "Open all" goes to the Ledgers page; Back returns to the P&L
 *   S3  Balance sheet: Net assets first, "as at", this date · a month ago · a year ago, the pack's heads with subtotals, the GST note on the same line; a line opens below
 *   S4  Trial balance: a line opens its entries below
 *   S5  390 px: P&L and Balance sheet fit, nothing scrolls sideways; the shots of 1366 and 390 are saved as e2e/shots/l16-bas-*.png
 *   node e2e/walk-statements.cjs         headless
 */
'use strict';
const path = require('path');
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const books = require('./lib/books-api.cjs');
const J = C.json;
const SHOTS = path.join(__dirname, 'shots');
const SESS = (name) => JSON.parse(W.session(name, name));
const acct = (code, name, nature, role, parent) => ({ account_id: '00000000-0000-4000-8000-' + String(code).padStart(12, '0'), code, name, is_group: false, tally_group: name, nature, role, parent_code: parent, active: true });
const CHART = { accounts: [acct('1400', 'Cash on hand', 'asset', 'cash', 'G1'), acct('4000', 'Sales', 'income', 'sales', 'G4'), acct('6010', 'Rent', 'expense', 'rent', 'G6')] };
const L = (code, name, m, prior, ch, share) => ({ code, name, role: 'x', amount_minor: m, prior_minor: prior, change_bp: ch, share_bp: share, prior_share_bp: null });
const PL = {
  currency: 'AUD', from: '2026-07-01', to: '2026-11-16', income: [], expense: [],
  total_income_minor: 19500000, total_expense_minor: 11571502, profit_minor: 7928498, profit_share_bp: 4066, total_income_share_bp: 10000, total_expense_share_bp: 5934,
  period: { preset: 'ytd', step: 0, can_next: false, from: '2026-07-01', to: '2026-11-16' },
  presets: [{ id: 'ytd', label: 'This year to date' }, { id: 'month', label: 'Last month' }, { id: 'quarter', label: 'Quarter' }, { id: 'year', label: 'Last year' }],
  compare: { how: 'year', from: '2025-07-01', to: '2025-11-16', total_income_minor: 15600000, total_expense_minor: 9000000, profit_minor: 6600000, income_change_bp: 2500, expense_change_bp: 2857, profit_change_bp: 2013 },
  by_line: {
    income: [{ line: 'revenue', label: 'Revenue', side: 'income', amount_minor: 19500000, prior_minor: 15600000, change_bp: 2500, share_bp: 10000, accounts: [L('4000', 'Sales', 19500000, 15600000, 2500, 10000)] }],
    expense: [
      { line: 'employee', label: 'Employee benefits expense', side: 'expense', amount_minor: 4348060, prior_minor: 4000000, change_bp: 870, share_bp: 2230, accounts: [L('5100', 'Wages', 4348060, 4000000, 870, 2230)] },
      { line: 'other', label: 'Other expenses', side: 'expense', amount_minor: 7217582, prior_minor: 5000000, change_bp: 4435, share_bp: 3701, accounts: [L('6010', 'Rent', 1423163, 1000000, 4232, 730), L('6190', 'Sundry expenses', 64000, 0, null, 33)] }
    ]
  }
};
const I = (code, name, m, pm, py, group, gname) => ({ code, name, role: 'x', amount_minor: m, prior_month_minor: pm, prior_year_minor: py, group: { code: group, name: gname } });
const BS = {
  currency: 'AUD', asOf: '2026-11-16', fy_from: '2026-07-01', as_at: { kind: 'today', step: 0, as_at: '2026-11-16', can_next: false },
  assets: [I('1400', 'Cash on hand', 14061005, 13000000, 9000000, 'G1', 'Current Assets')], total_assets_minor: 14061005,
  liabilities: [Object.assign(I('2200', 'GST payable to the ATO', 1400972, 1000000, 800000, 'G2', 'Current Liabilities'), { net_of: [{ code: '2200', name: 'GST collected' }, { code: '2210', name: 'GST paid' }] })],
  equity: [I('3000', 'Owners capital', 2605805, 2605805, 2605805, 'G3', 'Equity')],
  total_liabilities_minor: 1400972, total_equity_minor: 12660033, total_liab_equity_minor: 14061005, profit_to_date_minor: 0, net_assets_minor: 12660033, net_assets_ok: true, groups_ok: true, balanced: true,
  groups: { assets: [{ code: 'G1', name: 'Current Assets', amount_minor: 14061005, prior_month_minor: 13000000, prior_year_minor: 9000000 }], liabilities: [{ code: 'G2', name: 'Current Liabilities', amount_minor: 1400972, prior_month_minor: 1000000, prior_year_minor: 800000 }], equity: [{ code: 'G3', name: 'Equity', amount_minor: 2605805, prior_month_minor: 2605805, prior_year_minor: 2605805 }] },
  compare: { month: { as_at: '2026-10-16', total_assets_minor: 13000000, total_liabilities_minor: 1000000, total_equity_minor: 12000000, net_assets_minor: 12000000 }, year: { as_at: '2025-11-16', total_assets_minor: 9000000, total_liabilities_minor: 800000, total_equity_minor: 8200000, net_assets_minor: 8200000 } },
  by_line: { assets: [], liabilities: [] }
};
const TB = { currency: 'AUD', asOf: '2026-11-16', fy_from: '2026-07-01', rows: [{ code: '1400', name: 'Cash on hand', group: 'Cash', dr_minor: 14061005, cr_minor: 0 }, { code: '4000', name: 'Sales', group: 'Revenue', dr_minor: 0, cr_minor: 14061005 }], total_dr_minor: 14061005, total_cr_minor: 14061005, balanced: true };
const entries = (n) => Array.from({ length: n }, (_, i) => ({ date: '2026-10-' + String(20 - i).padStart(2, '0'), what: 'Walk-in day', ref: 'SV/2026-27/00000' + (i + 1), dr_minor: 0, cr_minor: 100000 + i }));

async function stub(ctx, S) {
  await ctx.route('**/api/**', (r) => {
    const u = new URL(r.request().url()), p = u.pathname; S.calls.push(r.request().method() + ' ' + p + u.search);
    if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Bondi Grocer', currency_code: 'AUD' } });
    if (p === '/api/books/health') return J(r, 200, books.health({ currency: 'AUD', year: { fiscal_year: '2026-27', from: '2026-07-01', start_month: 7 }, country: books.csStatus('AU', 'Australia') }));
    if (p === '/api/books/todo') return J(r, 200, []);
    if (p === '/api/books/periods') return J(r, 200, books.periods([Object.assign(books.periodRow('2026-27', 1, 'open'), { entries: 0, sales_minor: 0, lock: { may: true, why: null }, reopen: { may: false, why: null } })]));
    if (p === '/api/books/accounts') return J(r, 200, CHART);
    if (p === '/api/books/dues') return J(r, 200, books.dues([]));
    if (p === '/api/books/pl') return J(r, 200, u.searchParams.get('compare') === 'none' ? Object.assign({}, PL, { compare: null }) : PL);
    if (p === '/api/books/bs') return J(r, 200, BS);
    if (p === '/api/books/trial-balance') return J(r, 200, TB);
    if (/^\/api\/books\/ledger\//.test(p)) {
      const lines = entries(u.searchParams.get('limit') ? 10 : 25);
      return J(r, 200, Object.assign(books.ledger(p.split('/').pop(), 'Rent', lines, { currency: 'AUD', from: u.searchParams.get('from'), to: u.searchParams.get('to') }), { total: 25 }));
    }
    return J(r, 404, { error: 'not found' });
  });
}
async function open(w, hash, vp) {
  const ctx = await w.browser.newContext({ viewport: vp, locale: 'en', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const S = { calls: [] };
  await stub(ctx, S);
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', JSON.stringify(s)); } catch (_) {} }, SESS('Bondi Grocer'));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  await page.goto(w.base + '/accounts.html#' + hash);
  return { ctx, page, S, errs };
}
const text = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.textContent.trim() : ''; }, sel);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, 'l16-bas-' + name + '.png') }).catch(() => {});
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

W.run('statements', async (w) => {
  const A = await open(w, 'pl', { width: 1366, height: 768 });
  await w.step('S1', 'P&L: the Profit leads, one heading, a subtotal per head, Last year · Change · % of income, the period picker and the stepper', async () => {
    await A.page.waitForSelector('[data-testid="pl-table"]', { timeout: 15000 });
    const profit = await text(A.page, '[data-testid="pl-profit"]'), html = await A.page.content();
    const heads = await A.page.locator('[data-testid="pl-table"] thead').count(), subs = await A.page.locator('[data-testid="pl-table"] tr.bk-sub').count();
    const nextOff = await A.page.locator('[data-testid="pl-next"]').isDisabled();
    await shot(A.page, 'pl-1366');
    return { ok: /^Profit A\$79,284\.98/.test(profit) && /40\.7% of income/.test(profit) && heads === 1 && subs === 3 && /\+25\.0%/.test(html) && nextOff && (await A.page.locator('#pl_pick').count()) === 1 && (await A.page.locator('#pl_from').count()) === 0 && A.errs.length === 0, saw: profit + ' · heading x' + heads + ' · subtotals ' + subs };
  });
  await w.step('S2', 'a P&L ledger line opens its entries below; Open all goes to the Ledgers page for the same period; Back returns to the P&L', async () => {
    await A.page.click('[data-testid="pl-open-6010"]');
    await A.page.waitForSelector('[data-testid="drill-6010"]', { timeout: 8000 });
    const q = A.S.calls.filter((c) => /ledger\/6010/.test(c)).pop() || '', rows = await A.page.locator('[data-testid="drill-6010"] > div').count();
    await shot(A.page, 'pl-drill-1366');
    await A.page.click('[data-testid="drill-all-6010"]');
    await A.page.waitForFunction(() => /#ledgers/.test(location.hash), null, { timeout: 8000 });
    await A.page.waitForSelector('[data-testid="lt-backto"]', { timeout: 10000 });
    const back = await text(A.page, '[data-testid="lt-backto"]');
    await A.page.click('[data-testid="lt-backto"]');
    await A.page.waitForSelector('[data-testid="pl-table"]', { timeout: 10000 });
    return { ok: /limit=10/.test(q) && /from=2026-07-01/.test(q) && /to=2026-11-16/.test(q) && rows >= 10 && /Back to P&L/.test(back) && (await A.page.evaluate(() => location.hash)) === '#pl', saw: q + ' · ' + rows + ' lines + the button · ' + back };
  });
  await A.page.evaluate(() => { location.hash = 'bs'; });
  await w.step('S3', 'Balance sheet: Net assets first, as at, this date · a month ago · a year ago, the packs heads with subtotals, the GST note on the same line, a line opens below', async () => {
    await A.page.waitForSelector('[data-testid="bs-table"]', { timeout: 15000 });
    const net = await text(A.page, '[data-testid="bs-net"]'), html = await A.page.content();
    const noteRow = await A.page.evaluate(() => { const n = document.querySelector('[data-testid="st-netof"]'); const tr = n && n.closest('tr'); return !!(tr && /GST payable/.test(tr.textContent)); });
    await A.page.click('[data-testid="bs-open-1400"]');
    await A.page.waitForSelector('[data-testid="drill-1400"]', { timeout: 8000 });
    const q = A.S.calls.filter((c) => /ledger\/1400/.test(c)).pop() || '';
    await shot(A.page, 'bs-1366');
    return { ok: /^Net assets A\$126,600\.33/.test(net) && /a month ago A\$120,000\.00/.test(net) && /Total Current Assets/.test(html) && noteRow && /from=2026-07-01/.test(q) && /to=2026-11-16/.test(q) && A.errs.length === 0, saw: net + ' · GST note on its own ledger line: ' + noteRow };
  });
  await A.page.evaluate(() => { location.hash = 'tb'; });
  await w.step('S4', 'Trial balance: a line opens its entries below', async () => {
    await A.page.waitForSelector('[data-testid="tb-open-1400"]', { timeout: 15000 });
    await A.page.click('[data-testid="tb-open-1400"]');
    await A.page.waitForSelector('[data-testid="drill-1400"]', { timeout: 8000 });
    return { ok: true, saw: 'opened below' };
  });
  await A.ctx.close();
  const B = await open(w, 'pl', { width: 390, height: 844 });
  await w.step('S5', '390 px: the P&L and the Balance sheet fit, nothing scrolls sideways', async () => {
    await B.page.waitForSelector('[data-testid="pl-table"]', { timeout: 15000 });
    const plFit = await fits(B.page); await shot(B.page, 'pl-390');
    await B.page.evaluate(() => { location.hash = 'bs'; });
    await B.page.waitForSelector('[data-testid="bs-table"]', { timeout: 15000 });
    const bsFit = await fits(B.page); await shot(B.page, 'bs-390');
    const yr = await B.page.locator('[data-testid="bs-table"] th', { hasText: 'A year ago' }).isVisible();
    await B.page.evaluate(() => { location.hash = 'tb'; });
    await B.page.waitForSelector('[data-testid="tb-open-1400"]', { timeout: 15000 });
    const tbFit = await fits(B.page); await shot(B.page, 'tb-390');
    return { ok: plFit && bsFit && tbFit && yr && B.errs.length === 0, saw: 'P&L fits ' + plFit + ' · Balance sheet fits ' + bsFit + ' (a year ago shown: ' + yr + ') · Trial balance fits ' + tbFit };
  });
  await B.ctx.close();
});
