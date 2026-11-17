#!/usr/bin/env node
/**
 * e2e/walk-returns.cjs - THE SHOP'S OWN RETURN, WALKED (BAS1, 2026-10-12): Accounts › GST for an Australian shop (BAS) and a UAE shop (VAT return).
 * Black box: the real accounts.html, the real cap-period.js / cap-books.js; the API is a stand-in answering inside the page in the shapes chitbridge-api
 * routes/books.js GET /returns sends (checked against e2e/fixtures/web-api.contract.json on the way out). Nothing leaves the machine.
 *   R0  an Indian shop (200 form:null RETURN_FROM_RAIL, TOUR-FIX1) -> the server's sentence above the GST close & pay form
 *   R1  an Australian shop -> the menu and the title say BAS; the quarter that ended is chosen; G1 · 1A · 1B · 9 as rows, the server's figures; To pay; Prepared, not lodged — ATO
 *   R1b (W2-BOOKS) Close and pay under the BAS: Close Q1 -> ONE POST /gst/close {period} -> the set-off, To pay · BAS, the ATO payment reference asked (no challan) -> Pay -> ONE POST /gst/pay {payment_ref}
 *   R2  Full BAS -> ONE GET with simpler=0 -> G2 G3 G10 G11 join the rows
 *   R3  Copy figures -> the clipboard holds the boxes as one block (code · label · amount), plain digits for the portal
 *   R4  a box's ledger chip -> the Ledgers page opens on 2200 GST collected for the quarter (the ledger read carries from=2026-07-01&to=2026-09-30)
 *   R5  a UAE shop -> VAT return; no stagger yet: the server's sentence, no box; pick stagger 1 -> ONE GET with stagger=1 -> Boxes 1–15, Box 14, To pay, FTA / EmaraTax
 *   R5b (W2-BOOKS) the VAT return closes its period (reverse charge beside the set-off); the RCM netting edge -> the server's sentence, no form
 *   R6  390 px (AU) -> the return paints and nothing scrolls sideways
 *   R7  every answer the stand-in served matches the API contract
 *   R8  (CX2) Month lock in the shop's own year: IN Apr–Mar · AU Jul–Jun · AE Jan–Dec ('2026'), at 1366/390 in light and dark — AA, no clip, no sideways scroll, no app.html
 *
 *   NODE_PATH=e2e/node_modules node e2e/walk-returns.cjs         headless, fast
 *   node e2e/walk-returns.cjs --show                              watch it
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const books = require('./lib/books-api.cjs');
const J = C.json;
const SESS = (name, role) => Object.assign(JSON.parse(W.session(name, name)), role ? { role } : {});   /* role 'actor' = a signed-in staff login (the shop's auditor), not the owner */
const DENY = "Only the owner or the shop's auditor may read the returns.";

/* ── the stand-in's answers, in the server's shape (lib/books-period.taxReturn) ── */
const AU_PERIODS = [
  ['2023-Q1', '2023-24 Q1 (Jul–Sep 2023)', '2023-07-01', '2023-09-30', '2023-10-28', 'declared_lodged'], ['2024-Q1', '2024-25 Q1 (Jul–Sep 2024)', '2024-07-01', '2024-09-30', '2024-10-28', 'year_closed'],
  ['2025-Q1', '2025-26 Q1 (Jul–Sep 2025)', '2025-07-01', '2025-09-30', '2025-10-28'], ['2025-Q2', '2025-26 Q2 (Oct–Dec 2025)', '2025-10-01', '2025-12-31', '2026-02-28'],
  ['2026-Q3', '2025-26 Q3 (Jan–Mar 2026)', '2026-01-01', '2026-03-31', '2026-04-28'], ['2026-Q4', '2025-26 Q4 (Apr–Jun 2026)', '2026-04-01', '2026-06-30', '2026-07-28'],
  ['2026-Q1', '2026-27 Q1 (Jul–Sep 2026)', '2026-07-01', '2026-09-30', '2026-10-28'], ['2026-Q2', '2026-27 Q2 (Oct–Dec 2026)', '2026-10-01', '2026-12-31', '2027-02-28'],
  ['2027-Q3', '2026-27 Q3 (Jan–Mar 2027)', '2027-01-01', '2027-03-31', '2027-04-28'], ['2027-Q4', '2026-27 Q4 (Apr–Jun 2027)', '2027-04-01', '2027-06-30', '2027-07-28'],
].map(([period, label, start, end, due, state]) => Object.assign({ period, label, frequency: 'quarterly', start, end, due, ended: end <= '2026-10-12' }, state ? { state, closed: true } : { state: 'open', closed: false }));   /* PAST-YEARS: every year the books hold, each period with its state (the server's words in codes) */
/* ACC-357: each box carries its ledgers' own amounts, largest first (the first ledger holds the box here), the count, and "and n more" past ten; G1 stands in for a shop with twelve sales places */
const box = (code, label, amount, tax, roles, accounts, note) => {
  const many = String(code) === 'G1' ? 12 : accounts.length;
  return { code: String(code), label, amount_minor: amount, tax_minor: tax, roles, accounts: accounts.map((x, i) => Object.assign({}, x, { amount_minor: amount == null ? null : i === 0 ? amount : 0, tax_minor: tax == null ? null : i === 0 ? tax : 0 })), accounts_n: many, accounts_more_n: Math.max(0, many - 10), split_ok: true, note: note || null };
};
const A = { sales: { code: '4000', name: 'Sales' }, ret: { code: '4090', name: 'Sales returns and allowances' }, exp: { code: '4010', name: 'Export sales' }, free: { code: '4020', name: 'GST-free sales' },
  gstc: { code: '2200', name: 'GST collected' }, gstp: { code: '2210', name: 'GST paid' }, pur: { code: '5000', name: 'Purchases' }, rent: { code: '6010', name: 'Rent' }, pc: { code: '1060', name: 'Computers' } };
function bas(simpler, period) {
  const P = AU_PERIODS.find((p) => p.period === period) || AU_PERIODS[6];
  const boxes = [box('G1', 'Total sales', 1345000, null, ['sales', 'sales_export', 'sales_gst_free', 'sales_input_taxed', 'sales_returns', 'gst_collected'], [A.sales, A.exp, A.free, A.ret, A.gstc])];
  if (!simpler) boxes.push(box('G2', 'Export sales', 100000, null, ['sales_export'], [A.exp]), box('G3', 'Other GST-free sales', 200000, null, ['sales_gst_free'], [A.free]),
    box('G10', 'Capital purchases', 300000, null, ['ppe_computers'], [A.pc], 'GST-exclusive (the ledgers hold all GST paid in one account)'),
    box('G11', 'Non-capital purchases', 500000, null, ['purchases', 'purchase_returns', 'rent'], [A.pur, A.rent], 'GST-exclusive (the ledgers hold all GST paid in one account)'));
  boxes.push(box('1A', 'GST on sales', 95000, null, ['gst_collected'], [A.gstc]), box('1B', 'GST on purchases', 80000, null, ['gst_paid'], [A.gstp]), box('9', 'Your payment or refund amount', 15000, null, ['gst_collected', 'gst_paid'], [A.gstc, A.gstp]));
  return { currency: 'AUD', pack: 'AU', form: 'BAS', name: 'Business activity statement', short: 'BAS', authority: 'ATO', portal: 'ATO Online services for business', prepared: 'Prepared, not lodged',
    asked: { frequency: 'quarterly', simpler: !!simpler }, periods: AU_PERIODS, period: P, boxes, payable_minor: 15000, refund_minor: 0, net_minor: 15000,
    notes: [simpler ? 'Simpler BAS: G1, 1A and 1B only (GST turnover under A$10 million)' : 'GST-exclusive (the ledgers hold all GST paid in one account)'], cite: 'ato.gov.au › GST labels on your BAS; Simpler BAS (turnover under A$10 million)' };
}
const AE_PERIODS = [['2025-02/2025-04', 'Feb–Apr 2025', '2025-02-01', '2025-04-30', '2025-05-28'], ['2025-05/2025-07', 'May–Jul 2025', '2025-05-01', '2025-07-31', '2025-08-28'], ['2025-08/2025-10', 'Aug–Oct 2025', '2025-08-01', '2025-10-31', '2025-11-28'],
  ['2025-11/2026-01', 'Nov–Jan 2025/2026', '2025-11-01', '2026-01-31', '2026-02-28'], ['2026-02/2026-04', 'Feb–Apr 2026', '2026-02-01', '2026-04-30', '2026-05-28'], ['2026-05/2026-07', 'May–Jul 2026', '2026-05-01', '2026-07-31', '2026-08-28'],
  ['2026-08/2026-10', 'Aug–Oct 2026', '2026-08-01', '2026-10-31', '2026-11-28'], ['2026-11/2027-01', 'Nov–Jan 2026/2027', '2026-11-01', '2027-01-31', '2027-02-28']]
  .map(([period, label, start, end, due]) => ({ period, label, stagger: 1, frequency: 'quarterly', start, end, due, due_rule: 'the 28th day after the end of the Tax Period (ER Art. 64(1))', ended: end <= '2026-10-12' }));
const STAGGERS = { 1: { first_month: 2, tax_year_end: 'January' }, 2: { first_month: 3, tax_year_end: 'February' }, 3: { first_month: 4, tax_year_end: 'March' }, 4: { first_month: 1, tax_year_end: 'December', monthly: true } };
const EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'];
const V = { sales: { code: '4000', name: 'Sales' }, ret: { code: '4090', name: 'Sales returns and allowances' }, out: { code: '2200', name: 'Output VAT' }, inp: { code: '2210', name: 'Input VAT' }, rcm: { code: '2220', name: 'VAT due under reverse charge' },
  pur: { code: '5000', name: 'Purchases' }, rcmp: { code: '5020', name: 'Purchases under reverse charge' }, zero: { code: '4010', name: 'Zero-rated sales' }, exp: { code: '4015', name: 'Export sales' }, exm: { code: '4020', name: 'Exempt sales' } };
const VAT_BASE = { currency: 'AED', pack: 'AE', form: 'VAT201', name: 'VAT return (Form VAT201)', short: 'VAT return', authority: 'FTA', portal: 'EmaraTax', prepared: 'Prepared, not lodged', emirates: EMIRATES, staggers: STAGGERS };
const vatNeeds = () => Object.assign({}, VAT_BASE, { asked: { stagger: null }, needs: 'stagger', why: 'The FTA assigns the Tax Period (ER Art. 62): say which stagger — 1 (Feb–Apr …), 2 (Mar–May …), 3 (Apr–Jun …) or 4 (monthly) — as on the registration; it is never guessed.',
  periods: [], period: null, boxes: [], payable_minor: 0, refund_minor: 0, net_minor: 0, notes: [], cite: null });
function vat201(emirate, period) {
  const P = AE_PERIODS.find((p) => p.period === period) || AE_PERIODS[4], fta = 'not read from the ledgers';
  const boxes = [box(1, 'Standard rated supplies', 9500000, 475000, ['sales', 'sales_returns', 'output_vat'], [V.sales, V.ret, V.out], emirate ? 'Emirate: ' + emirate : null),
    box(2, 'Tax Refunds provided to Tourists under the Tax Refunds for Tourists Scheme', null, null, [], [], 'pre-populated by the FTA from the Tax Refunds for Tourists Scheme; ' + fta),
    box(3, 'Supplies subject to the reverse charge provisions', 800000, 40000, ['purchases_reverse_charge', 'rcm_vat'], [V.rcmp, V.rcm]), box(4, 'Zero-rated supplies', 3000000, 0, ['sales_zero_rated', 'sales_export'], [V.zero, V.exp]),
    box(5, 'Exempt supplies', 3000000, 0, ['sales_exempt'], [V.exm]), box(6, 'Goods imported into the UAE', null, null, [], [], 'auto-populated by the FTA from customs declarations linked to the TRN; ' + fta),
    box(7, 'Adjustments to goods imported into the UAE', null, null, [], [], 'a manual correction of Box 6; ' + fta), box(8, 'Totals', 16300000, 515000, ['sales', 'sales_returns', 'purchases_reverse_charge', 'sales_zero_rated', 'sales_export', 'sales_exempt', 'output_vat', 'rcm_vat'], [V.sales, V.ret, V.rcmp, V.zero, V.exp, V.exm, V.out, V.rcm]),
    box(9, 'Standard rated expenses', 4800000, 280000, ['purchases', 'purchase_returns', 'input_vat'], [V.pur, V.inp]), box(10, 'Supplies subject to the reverse charge provisions', 0, 0, [], []), box(11, 'Totals', 4800000, 280000, ['purchases', 'purchase_returns', 'input_vat'], [V.pur, V.inp]),
    box(12, 'Total value of due tax for the period', null, 515000, ['output_vat', 'rcm_vat'], [V.out, V.rcm]), box(13, 'Total value of recoverable tax for the period', null, 280000, ['input_vat'], [V.inp]),
    box(14, 'Payable tax for the period', null, 235000, ['output_vat', 'rcm_vat', 'input_vat'], [V.out, V.rcm, V.inp]), box(15, 'Do you wish to request a refund for the above amount of excess recoverable tax', null, null, [], [], 'the shop\'s choice: a refund by Form VAT311, or carried forward; ' + fta)];
  return Object.assign({}, VAT_BASE, { asked: { stagger: 1, emirate: emirate || null }, periods: AE_PERIODS, period: P, boxes, payable_minor: 235000, refund_minor: 0, net_minor: 235000,
    notes: ['the whole of Box 1 is reported under ' + (emirate || 'the Emirate of the fixed establishment (none was handed in)') + ' — the ledgers carry no Emirate (ER Art. 72(2))', 'VAT-exclusive, and including zero-rated and exempt purchases (the ledgers hold them under the same accounts); the VAT column is what was posted to Input VAT'],
    cite: 'RET (FTA VAT Returns guide, Aug 2021) §3.2 and Boxes 1–15; RET-UM (EmaraTax VAT201 user manual, Oct 2022); ER Art. 64(5), Art. 72' });
}
const IN_RAIL = { form: null, pack: 'IN', code: 'RETURN_FROM_RAIL', why: 'Your GSTR-1 and GSTR-3B are made from your bills, not from these books. Close and pay the month\'s GST here.', rail: '/api/tax/gstr' };
const acct = (code, name, nature, role, parent) => ({ account_id: '00000000-0000-4000-8000-0000000' + code + '0', code, name, is_group: false, tally_group: '', nature, role, parent_code: parent, active: true });
const CHART = { accounts: [acct('1400', 'Cash on hand', 'asset', 'cash', 'G1400'), acct('2200', 'GST collected', 'liability', 'gst_collected', 'G2200'), acct('2210', 'GST paid', 'liability', 'gst_paid', 'G2200'), acct('4000', 'Sales', 'income', 'sales', 'G4000')] };

const RCM_WHY = 'Reverse-charge tax is owed this period and the recoverable tax is more than the due tax. The return nets them on the form; this close cannot post that netting yet — lodge from the return and record the payment by hand.';
/* the server's close names the period WITHOUT `ended` (that flag is the list's, GET /returns) */
const RP = (P) => { const o = Object.assign({}, P); delete o.ended; delete o.state; delete o.closed; return o; };
/* the months a close locks, as lib/books-period lockCovered answers them: [{ fiscal_year, period }] — AU's year starts in July, the Emirates' in January */
const LOCKED_BY = (P, yearStartMonth) => {
  const out = [];
  for (let at = new Date(P.start + 'T00:00:00Z'); at.toISOString().slice(0, 10) <= P.end; at.setUTCMonth(at.getUTCMonth() + 1)) {
    const month = at.getUTCMonth() + 1, year = at.getUTCFullYear(), startYear = month >= yearStartMonth ? year : year - 1;
    out.push({ fiscal_year: yearStartMonth === 1 ? String(year) : startYear + '-' + String(startYear + 1).slice(2), period: (month - yearStartMonth + 12) % 12 + 1 });
  }
  return out;
};
const CLOSE_AU = (period) => { const P = AU_PERIODS.find((x) => x.period === period) || AU_PERIODS[6]; return { period: P.period, date: P.end, utilised: [{ from: 'gst', against: 'gst', amount_minor: 80000 }], payable_minor: { gst_minor: 15000 }, carried_minor: { gst_minor: 0 }, pay_total_minor: 15000, owed_before_payments_minor: { gst_minor: 15000 }, owed_before_payments_total_minor: 15000, paid_before_close_minor: {}, still_to_pay_minor: { gst_minor: 15000 }, still_to_pay_total_minor: 15000, excess_paid_minor: { gst_minor: 0 },
  form: 'BAS', heads: ['gst'], return_period: RP(P), ref_label: 'Payment reference number', ref_hint: 'The payment reference number on the BAS', carried_word: 'GST refund due from the ATO', ok: true, entry_id: '00000000-0000-4000-8000-000000000130', entry_no: 'MJ/2026-27/000011', posting_date: P.end, doc_date: P.end, moved: false, lines: 2, items: 0, note: null, locked: LOCKED_BY(P, 7) }; };
const CLOSE_AE = (period) => { const P = AE_PERIODS.find((x) => x.period === period) || AE_PERIODS[4]; return { period: P.period, date: P.end, utilised: [{ from: 'vat', against: 'vat', amount_minor: 280000 }], payable_minor: { vat_minor: 195000 }, carried_minor: { vat_minor: 0 }, pay_total_minor: 235000, owed_before_payments_minor: { vat_minor: 195000 }, owed_before_payments_total_minor: 235000, paid_before_close_minor: {}, still_to_pay_minor: { vat_minor: 195000 }, still_to_pay_total_minor: 235000, excess_paid_minor: { vat_minor: 0 }, rcm_minor: { vat: 40000 }, cash_minor: { vat: 235000 },
  form: 'VAT201', heads: ['vat'], return_period: RP(P), ref_label: 'Payment reference', ref_hint: 'The EmaraTax payment reference', carried_word: 'VAT recoverable from the FTA', ok: true, entry_id: '00000000-0000-4000-8000-000000000130', entry_no: 'MJ/2026/000011', posting_date: P.end, doc_date: P.end, moved: false, lines: 2, items: 0, note: null, locked: LOCKED_BY(P, 1) }; };
/** the stand-in for one shop: `kind` is 'IN' | 'AU' | 'AE'; every /api/books answer is checked against the contract (C.json) */
async function stub(ctx, kind, S) {
  await ctx.route('**/api/**', (r) => {
    const u = new URL(r.request().url()), p = u.pathname, m = r.request().method(); S.calls.push(m + ' ' + p + u.search);
    if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: S.name, currency_code: kind === 'AU' ? 'AUD' : kind === 'AE' ? 'AED' : 'INR' } });
    if (p === '/api/books/health') return J(r, 200, books.health({ currency: kind === 'AU' ? 'AUD' : kind === 'AE' ? 'AED' : 'INR', year: kind === 'AU' ? { fiscal_year: '2026-27', from: '2026-07-01', start_month: 7 } : kind === 'AE' ? { fiscal_year: '2026', from: '2026-01-01', start_month: 1 } : { fiscal_year: '2026-27', from: '2026-04-01', start_month: 4 },
      country: books.csStatus(kind, kind === 'AU' ? 'Australia' : kind === 'AE' ? 'United Arab Emirates' : 'India') }));   /* CX2: the ledger's year + the CS1 status, as routes/books.js /health sends them (one shape: year { fiscal_year, from, start_month }, INT5b) */
    if (p === '/api/books/todo') return J(r, 200, []);
    if (p === '/api/books/periods') return J(r, 200, books.periods([Object.assign(books.periodRow('2026-27', 1, 'open'), { entries: 0, sales_minor: 0, lock: { may: true, why: null }, reopen: { may: false, why: null } })]));   /* the row as the API sends it today (books-api.periodRow predates entries · sales_minor · lock · reopen) */
    if (p === '/api/books/accounts') return J(r, 200, CHART);
    if (p === '/api/books/dues') return J(r, 200, books.dues([]));
    if (/^\/api\/books\/ledger\//.test(p)) return J(r, 200, books.ledger('2200', 'GST collected', [{ date: '2026-07-01', what: 'Walk-in day', ref: 'SV/2026-27/000001', dr_minor: 0, cr_minor: 1000 }], { currency: 'AUD', from: u.searchParams.get('from') || '2026-07-01', to: u.searchParams.get('to') || '2026-09-30', closing_minor: 1000 }));
    /* W2-BOOKS: the close & pay of a RETURN period, as lib/books-period gstClose / gstPay answer a pack with a return (heads · words from the pack) */
    if (p === '/api/books/gst/close' && kind !== 'IN') {
      const b = r.request().postDataJSON() || {};
      if (kind === 'AE' && b.period === '2026-05/2026-07') return J(r, 422, { code: 'RCM_NETTING_NOT_BUILT', error: RCM_WHY, message: RCM_WHY });
      return J(r, 200, kind === 'AU' ? CLOSE_AU(b.period) : CLOSE_AE(b.period));
    }
    if (p === '/api/books/gst/pay' && kind !== 'IN') {
      const b = r.request().postDataJSON() || {};
      if (!b.payment_ref) return J(r, 400, { error: 'Which payment? Give the reference.', message: 'Which payment? Give the reference.' });
      return J(r, 200, { payment_ref: b.payment_ref, paid_minor: b.amounts && b.amounts.gst_minor ? { gst: b.amounts.gst_minor } : { vat: (b.amounts || {}).vat_minor || 0 }, ok: true, entry_id: '00000000-0000-4000-8000-000000000131', entry_no: kind === 'AU' ? 'MJ/2026-27/000012' : 'MJ/2026/000012', posting_date: '2026-10-15', doc_date: '2026-10-15', moved: false, lines: 2, items: 0, note: null });
    }
    if (p === '/api/books/returns') {
      if (S.deny) return J(r, 403, { code: 'BOOKS_RETURN_READ_NOT_ALLOWED', error: DENY, message: DENY });   /* ACC-229: any other login, refused in words */
      if (kind === 'IN') return J(r, 200, IN_RAIL);   /* TOUR-FIX1: the API answers (200 form:null) — the 422 the page swallowed is gone */
      if (kind === 'AU') return J(r, 200, bas(u.searchParams.get('simpler') !== '0', u.searchParams.get('period')));
      return J(r, 200, u.searchParams.get('stagger') ? vat201(u.searchParams.get('emirate'), u.searchParams.get('period')) : vatNeeds());
    }
    return J(r, 404, { error: 'not found' });
  });
}
async function open(w, kind, name, tz, vp, hash, theme, role, deny) {
  const ctx = await w.browser.newContext({ viewport: vp || { width: 1280, height: 860 }, locale: 'en', timezoneId: tz, serviceWorkers: 'block' });
  if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('cb_theme', t); } catch (_) {} }, theme);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: w.base }); } catch (_) {}
  const S = { calls: [], name, deny: !!deny };
  await stub(ctx, kind, S);
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', JSON.stringify(s)); } catch (_) {} }, SESS(name, role));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  await page.goto(w.base + '/accounts.html#' + (hash || 'gstclose'));
  return { ctx, page, S, errs };
}
const text = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.textContent.trim() : ''; }, sel);
const count = (page, sel) => page.locator(sel).count();
const navWord = (page) => page.evaluate(() => { const b = document.querySelector('[data-testid="acc-nav-gstclose"] .label'); return b ? b.textContent.trim() : ''; });

W.run('returns', async (w) => {
  /* R0 · India: the GST close & pay, as before */
  const IN = await open(w, 'IN', 'Mayur Bhavan', 'Asia/Kolkata');
  await w.step('R0', 'An Indian shop -> Accounts > GST close & pay: the close form, as before (its GSTR comes from the rail)', async () => {
    await IN.page.waitForSelector('[data-testid="pg-form"]', { timeout: 15000 });
    const asked = IN.S.calls.filter((c) => /GET \/api\/books\/returns/.test(c)).length, word = await navWord(IN.page);
    const why = await IN.page.locator('[data-testid="pg-rail-why"]').innerText().catch(() => '');
    return { ok: asked === 1 && word === 'GST close & pay' && /made from your bills/.test(why) && (await count(IN.page, '[data-testid="pr-card"]')) === 0 && IN.errs.length === 0, saw: 'asked once, got 200 form:null -> "' + why + '" above the close form; menu says "' + word + '"' + (IN.errs.length ? ' · page error ' + IN.errs[0] : '') };
  });
  await IN.ctx.close();

  /* R1–R4 · Australia */
  const AU = await open(w, 'AU', 'Bondi Grocer', 'Australia/Sydney');
  await w.step('R1', 'An Australian shop -> the menu and the title say BAS; the quarter that ended is chosen; G1 1A 1B 9 as rows; To pay; Prepared, not lodged — ATO', async () => {
    await AU.page.waitForSelector('[data-testid="pr-box-1A"]', { timeout: 15000 });
    const word = await navWord(AU.page), title = await text(AU.page, '#title'), period = await AU.page.inputValue('#pr_p');
    const rows = await AU.page.$$eval('[data-testid^="pr-box-"]', (x) => x.map((e) => e.getAttribute('data-testid').slice(7)));
    const a1 = await text(AU.page, '[data-testid="pr-amt-1A"]'), tot = await text(AU.page, '[data-testid="pr-total"]'), prep = await text(AU.page, '[data-testid="pr-prepared"]');
    const ok = word === 'BAS' && title === 'BAS' && period === '2026-Q1' && rows.join() === 'G1,1A,1B,9' && /950\.00/.test(a1) && /To pay/.test(tot) && /150\.00/.test(tot) && /Prepared, not lodged/.test(prep) && /ATO/.test(prep) && AU.errs.length === 0;
    return { ok, saw: 'menu "' + word + '" · title "' + title + '" · period ' + period + ' · rows ' + rows.join(' ') + ' · 1A ' + a1 + ' · ' + tot + ' · ' + prep + (AU.errs.length ? ' · page error ' + AU.errs[0] : '') };
  });
  await w.step('R1b', 'W2-BOOKS: Close and pay under the BAS -> Close 2026-27 Q1 -> ONE POST /gst/close with the period id -> GST -> GST 800.00 used, To pay · BAS 150.00; the pay form asks the ATO payment reference number (no challan); Pay -> ONE POST /gst/pay with payment_ref -> Paid', async () => {
    await AU.page.waitForSelector('[data-testid="pr-close"]', { timeout: 15000 });
    const label = await text(AU.page, '[data-testid="pr-close"]');
    await AU.page.click('[data-testid="pr-close"]');
    await AU.page.waitForSelector('[data-testid="pg-pay-form"]', { timeout: 15000 });
    const closes = AU.S.calls.filter((c) => /POST \/api\/books\/gst\/close/.test(c)).length, used = await text(AU.page, '[data-testid="pg-used-0"]'), toPay = await AU.page.locator('[data-testid="pg-setoff"] .pe-sub').nth(1).innerText();
    const total = await text(AU.page, '[data-testid="pg-total"]'), refLabel = await AU.page.locator('[data-testid="pg-pay-form"] label.pe-f span').nth(1).innerText(), page = await AU.page.locator('#pr_host').innerText();
    await AU.page.fill('#pgp_ch', '551234567');
    await AU.page.click('[data-testid="pg-pay"]');
    await AU.page.waitForSelector('[data-testid="pe-ok"]', { timeout: 15000 });
    const pays = AU.S.calls.filter((c) => /POST \/api\/books\/gst\/pay/.test(c)).length, paid = await text(AU.page, '[data-testid="pe-ok"]');
    return { ok: /Close 2026-27 Q1/.test(label) && closes === 1 && /GST → GST/.test(used) && /800\.00/.test(used) && /to pay · bas/i.test(toPay) && /150\.00/.test(total) && refLabel === 'Payment reference number' && !/challan|CPIN/i.test(page) && pays === 1 && /Paid · MJ\/2026-27\/000012/.test(paid) && AU.errs.length === 0,
      saw: label + ' -> ' + closes + ' close · ' + used + ' · ' + toPay + ' ' + total + ' · ref: ' + refLabel + ' · ' + pays + ' pay -> ' + paid + (AU.errs.length ? ' · ERRORS ' + AU.errs.join(' | ') : '') };
  });
  await w.step('R2', 'Full BAS -> ONE GET with simpler=0 -> G2 G3 G10 G11 join the rows (G11 5,000.00, its basis beside it)', async () => {
    const before = AU.S.calls.length;
    await AU.page.selectOption('#pr_s', '0');
    await AU.page.waitForSelector('[data-testid="pr-box-G11"]', { timeout: 8000 });
    const gets = AU.S.calls.slice(before).filter((c) => /GET \/api\/books\/returns/.test(c));
    const rows = await AU.page.$$eval('[data-testid^="pr-box-"]', (x) => x.map((e) => e.getAttribute('data-testid').slice(7)));
    const g11 = await text(AU.page, '[data-testid="pr-amt-G11"]'), lbl = await text(AU.page, '[data-testid="pr-box-G11"]');
    return { ok: gets.length === 1 && /simpler=0/.test(gets[0]) && rows.join() === 'G1,G2,G3,G10,G11,1A,1B,9' && /5,000\.00/.test(g11) && /GST-exclusive/.test(lbl), saw: gets.join(' ') + ' · rows ' + rows.join(' ') + ' · G11 ' + g11 };
  });
  await w.step('R2b', 'PAST YEARS: older years are listed with each period state in words; an old period reads and is read only (no Close button, one sentence)', async () => {
    const opts = await AU.page.$$eval('#pr_p option', (x) => x.map((e) => e.textContent));
    await AU.page.selectOption('#pr_p', '2024-Q1');
    await AU.page.waitForSelector('[data-testid="pr-readonly"]', { timeout: 8000 });
    const note = await text(AU.page, '[data-testid="pr-readonly"]'), btn = await count(AU.page, '[data-testid="pr-close"]');
    await AU.page.selectOption('#pr_p', '2026-Q1');
    await AU.page.waitForSelector('[data-testid="pr-close"]', { timeout: 8000 });
    return { ok: opts.some((o) => /2023-24 Q1.*lodged, as you said/.test(o)) && opts.some((o) => /2024-25 Q1.*closed with the year/.test(o)) && /read it; nothing here can change it/.test(note) && btn === 0, saw: opts.slice(-3).join(' | ') + ' · ' + note + ' · close buttons ' + btn };
  });
  await w.step('R3', 'Copy figures -> the clipboard holds the boxes as one block (code · label · amount, plain digits) for the portal', async () => {
    await AU.page.click('[data-testid="pr-copy"]');
    await AU.page.waitForSelector('#pr_out [data-testid="pe-ok"]', { timeout: 8000 });
    let clip = ''; try { clip = await AU.page.evaluate(() => navigator.clipboard.readText()); } catch (_) {}
    if (!clip) clip = await AU.page.evaluate(() => (window.PE_RET && PE_RET.block) || '');
    const lines = clip.split('\n');
    const ok = /^Business activity statement · 2026-27 Q1/.test(lines[0]) && lines.indexOf('1A\tGST on sales\t950.00') >= 0 && lines.indexOf('G11\tNon-capital purchases\t5000.00') >= 0 && /^To pay\t150\.00$/.test(lines[lines.length - 2]) && /Prepared, not lodged/.test(lines[lines.length - 1]);
    return { ok, saw: (await text(AU.page, '#pr_out')) + ' · ' + lines.length + ' lines: ' + lines[0] + ' | ' + lines[5] };
  });
  await w.step('R4a', 'ACC-357: the Ledgers column is a count ("1 ledger ▸"; G1 "12 ledgers ▸"), the row opens below with its own header row, the ledgers and "and 2 more" past ten; the money at risk sits on the To pay line; the due date shows whole', async () => {
    const n1a = await text(AU.page, '[data-testid="pr-count-1A"]'), n1 = await text(AU.page, '[data-testid="pr-count-G1"]');
    await AU.page.click('[data-testid="pr-box-G1"]');
    await AU.page.waitForSelector('[data-testid="pr-more-G1"]', { timeout: 8000 });
    const more = await text(AU.page, '[data-testid="pr-more-G1"]'), panel = await text(AU.page, '[data-testid="pr-ledgers-G1"]');
    const opt = await AU.page.$eval('#pr_p', (e) => e.options[e.selectedIndex].textContent);
    await AU.page.screenshot({ path: require('path').join(__dirname, 'shots', 'l16-bas-bas-open-1366.png') }).catch(() => {});
    const ok = /^1 ledger/.test(n1a) && /^12 ledgers/.test(n1) && /and 2 more/.test(more) && /^Ledger/.test(panel) && /due .*2026/.test(opt) && !/…/.test(opt);
    return { ok, saw: n1a + ' · ' + n1 + ' · ' + more + ' · ' + opt };
  });
  await w.step('R4', 'A box\'s ledger chip (1A -> 2200 GST collected) -> the Ledgers page opens on that ledger, for the quarter', async () => {
    await AU.page.click('[data-testid="pr-box-1A"]'); /* ACC-357: the row opens BELOW with its ledgers; the ledger line then opens the entries */
    await AU.page.waitForSelector('[data-testid="pr-ledgers-1A"] [data-testid="pr-open-1A-2200"]', { timeout: 8000 });
    await AU.page.click('[data-testid="pr-open-1A-2200"]');
    await AU.page.waitForFunction(() => /#ledgers/.test(location.hash), null, { timeout: 8000 });
    await AU.page.waitForFunction(() => (document.querySelector('#lg_out') || {}).textContent && /GST collected/.test(document.querySelector('#lt_pane').textContent), null, { timeout: 10000 }).catch(() => {});
    /* the pane can say 'GST collected' (the ledger list) before the ledger read is sent: wait for the READ itself, not for the words */
    for (let waited = 0; waited < 10000 && !AU.S.calls.some((c) => /GET \/api\/books\/ledger\/2200/.test(c)); waited += 100) await AU.page.waitForTimeout(100);
    const led = AU.S.calls.filter((c) => /GET \/api\/books\/ledger\/2200/.test(c));
    const pane = await text(AU.page, '#lt_pane');
    const ok = led.length >= 1 && /from=2026-07-01/.test(led[led.length - 1]) && /to=2026-09-30/.test(led[led.length - 1]) && /GST collected/.test(pane) && AU.errs.length === 0;
    return { ok, saw: 'hash ' + (await AU.page.evaluate(() => location.hash)) + ' · ' + (led[led.length - 1] || 'no ledger read') + ' · pane says ' + (/GST collected/.test(pane) ? 'GST collected' : pane.slice(0, 60)) + (AU.errs.length ? ' · page error ' + AU.errs[0] : '') };
  });
  await AU.ctx.close();

  /* R5 · the UAE */
  const AE = await open(w, 'AE', 'Deira Stores', 'Asia/Dubai');
  await w.step('R5', 'A UAE shop -> VAT return; no stagger yet: the server\'s sentence and no box; stagger 1 -> ONE GET with stagger=1 -> Boxes 1–15, Box 14 2,350.00, To pay, FTA / EmaraTax', async () => {
    await AE.page.waitForSelector('[data-testid="pr-needs"]', { timeout: 15000 });
    const word = await navWord(AE.page), needs = await text(AE.page, '[data-testid="pr-needs"]'), none = (await count(AE.page, '[data-testid^="pr-box-"]')) === 0;
    const before = AE.S.calls.length;
    await AE.page.selectOption('#pr_st', '1');
    await AE.page.waitForSelector('[data-testid="pr-box-14"]', { timeout: 8000 });
    const gets = AE.S.calls.slice(before).filter((c) => /GET \/api\/books\/returns/.test(c));
    const rows = await AE.page.$$eval('[data-testid^="pr-box-"]', (x) => x.length), b14 = await text(AE.page, '[data-testid="pr-tax-14"]'), b1 = await text(AE.page, '[data-testid="pr-amt-1"]');
    const tot = await text(AE.page, '[data-testid="pr-total"]'), prep = await text(AE.page, '[data-testid="pr-prepared"]'), period = await AE.page.inputValue('#pr_p');
    const ok = word === 'VAT return' && /FTA assigns the Tax Period/.test(needs) && none && gets.length === 1 && /stagger=1/.test(gets[0]) && rows === 15 && /2,350\.00/.test(b14) && /95,000\.00/.test(b1) && /To pay/.test(tot) && /FTA/.test(prep) && /EmaraTax/.test(prep) && period === '2026-02/2026-04' && AE.errs.length === 0;
    return { ok, saw: 'menu "' + word + '" · first: ' + needs.slice(0, 40) + '… · then ' + gets.join(' ') + ' · ' + rows + ' boxes · Box 1 ' + b1 + ' · Box 14 ' + b14 + ' · ' + tot + ' · ' + period + (AE.errs.length ? ' · page error ' + AE.errs[0] : '') };
  });
  await w.step('R5b', 'W2-BOOKS: the VAT return closes its period too (Feb–Apr: Input VAT 2,800.00 against Output VAT; reverse charge 400.00 beside it; To pay · VAT201 2,350.00; the EmaraTax reference asked); May–Jul (reverse charge owed, recoverable > due) -> the server\'s RCM_NETTING_NOT_BUILT sentence, no form', async () => {
    await AE.page.waitForSelector('[data-testid="pr-close"]', { timeout: 15000 });
    await AE.page.click('[data-testid="pr-close"]');
    await AE.page.waitForSelector('[data-testid="pg-pay-form"]', { timeout: 15000 });
    const used = await text(AE.page, '[data-testid="pg-used-0"]'), rcm = await text(AE.page, '[data-testid="pg-rcm-vat"]'), total = await text(AE.page, '[data-testid="pg-total"]');
    const refLabel = await AE.page.locator('[data-testid="pg-pay-form"] label.pe-f span').nth(1).innerText();
    await AE.page.selectOption('#pr_p', '2026-05/2026-07');
    await AE.page.waitForSelector('[data-testid="pr-close"]', { timeout: 15000 });
    await AE.page.click('[data-testid="pr-close"]');
    await AE.page.waitForSelector('#pr_close_out .pe-bad, #pr_close_out [data-testid="pe-bad"]', { timeout: 15000 });
    const why = await AE.page.locator('#pr_close_out').innerText(), forms = await count(AE.page, '[data-testid="pg-pay-form"]');
    return { ok: /VAT → VAT/.test(used) && /2,800\.00/.test(used) && /400\.00/.test(rcm) && /2,350\.00/.test(total) && refLabel === 'Payment reference' && /nets them on the form/.test(why) && forms === 0 && AE.errs.length === 0,
      saw: used + ' · rcm ' + rcm + ' · ' + total + ' · ref: ' + refLabel + ' · May–Jul -> "' + why.slice(0, 80) + '…" forms=' + forms + (AE.errs.length ? ' · ERRORS ' + AE.errs.join(' | ') : '') };
  });
  await AE.ctx.close();

  /* R9 · ACC-229: the shop's auditor (a staff login, not the owner) READS the BAS; Close is not offered, the sentence is. Any other login is refused in the server's words. */
  const AUD = await open(w, 'AU', 'Bondi Grocer', 'Australia/Sydney', null, 'gstclose', null, 'actor');
  await w.step('R9', 'ACC-229: the auditor opens Tax close -> sees the BAS boxes (G1 1A 1B 9) and the To pay line, and NO Close button (the owner-only sentence instead); (the owner Close is R1b)', async () => {
    await AUD.page.waitForSelector('[data-testid="pr-box-1A"]', { timeout: 15000 });
    const a1 = await text(AUD.page, '[data-testid="pr-amt-1A"]'), close = await count(AUD.page, '[data-testid="pr-close"]'), card = await count(AUD.page, '[data-testid="pr-close-card"]');
    const why = await text(AUD.page, '[data-testid="pe-readonly"]');
    return { ok: /950[.]00/.test(a1) && close === 0 && card === 0 && /Only the owner closes and pays GST/.test(why) && AUD.errs.length === 0, saw: '1A ' + a1 + ' · close buttons ' + close + ' · close card ' + card + ' · sentence "' + why + '"' };
  });
  await AUD.ctx.close();
  const DN = await open(w, 'AU', 'Bondi Grocer', 'Australia/Sydney', null, 'gstclose', null, 'actor', true);
  await w.step('R9b', 'ACC-229: a login the server refuses (403 BOOKS_RETURN_READ_NOT_ALLOWED) sees the sentence the server gives, no boxes, no Close', async () => {
    await DN.page.waitForSelector('.pe-bad', { timeout: 15000 });
    const bad = await text(DN.page, '.pe-bad');
    return { ok: /may read the returns/.test(bad) && (await count(DN.page, '[data-testid^="pr-box-"]')) === 0 && (await count(DN.page, '[data-testid="pr-close"]')) === 0 && DN.errs.length === 0, saw: '"' + bad + '"' };
  });
  await DN.ctx.close();

  /* R6 · a phone */
  const P = await open(w, 'AU', 'Bondi Grocer', 'Australia/Sydney', { width: 390, height: 844 });
  await w.step('R6', '390 px: the BAS paints and nothing scrolls sideways', async () => {
    await P.page.waitForSelector('[data-testid="pr-box-1A"]', { timeout: 15000 });
    await P.page.waitForTimeout(300);
    await P.page.click('[data-testid="pr-box-1A"]'); /* ACC-357: the row open below, at 390 */
    await P.page.waitForSelector('[data-testid="pr-ledgers-1A"]', { timeout: 8000 });
    await P.page.screenshot({ path: require('path').join(__dirname, 'shots', 'l16-bas-bas-390.png') }).catch(() => {});
    const m = await P.page.evaluate(() => ({ d: document.documentElement.scrollWidth, main: document.querySelector('.main') ? document.querySelector('.main').scrollWidth <= document.querySelector('.main').clientWidth : true }));
    return { ok: m.d <= 390 && m.main && P.errs.length === 0, saw: 'document ' + m.d + ' px wide · main fits: ' + m.main };
  });
  await P.ctx.close();

  /* R8 · CX2: the shop's own YEAR on Month lock — IN April, AU July, AE January (and AE's year is '2026'), at 1366 and 390, light and dark (rule 13) */
  const { ratio } = require('./lib/contrast.cjs');
  const YEAR = { IN: ['Mayur Bhavan', 'Asia/Kolkata', 'Apr', 'Mar', '2026-27'], AU: ['Bondi Grocer', 'Australia/Sydney', 'Jul', 'Jun', '2026-27'], AE: ['Deira Stores', 'Asia/Dubai', 'Jan', 'Dec', '2026'] };
  for (const kind of ['IN', 'AU', 'AE']) {
    const [name, tz, first, last, fy] = YEAR[kind];
    await w.step('R8-' + kind, kind + ' shop -> Month lock lists ' + first + ' … ' + last + ', the year reads ' + fy + '; at 1366 / 390 in light and dark: AA contrast, nothing clipped or scrolling sideways, no link to app.html', async () => {
      const seen = [];
      let ok = true;
      for (const vp of [{ width: 1366, height: 860 }, { width: 390, height: 844 }]) for (const theme of ['cream', 'dark']) {
        const X = await open(w, kind, name, tz, vp, 'lock', theme);
        await X.page.waitForSelector('[data-testid="lk-row-12"]', { timeout: 15000 });
        await X.page.waitForTimeout(200);
        const m = await X.page.evaluate(() => {
          const rgb = (c) => { const v = (String(c).match(/[\d.]+/g) || []).map(Number); return v.length >= 3 ? { hex: '#' + v.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join(''), a: v.length > 3 ? v[3] : 1 } : null; };
          const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const b = rgb(getComputedStyle(e).backgroundColor); if (b && b.a > 0.5) return b.hex; } return '#ffffff'; };
/* Month lock is one table since dc25019a: the month name is the row header (th), no longer a b */
          const els = Array.from(document.querySelectorAll('[data-testid^="lk-row-"] th, [data-testid^="lk-state-"], [data-testid="lk_fy"]'));
          const pairs = els.map((e) => ({ t: e.textContent.trim().slice(0, 20), fg: rgb(getComputedStyle(e).color).hex, bg: bgOf(e) }));
          const clipped = els.filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').map((e) => e.textContent.trim().slice(0, 20));
          const rows = Array.from(document.querySelectorAll('[data-testid^="lk-row-"] th')).map((b) => b.textContent.trim());
          const main = document.querySelector('.main');
          return { rows, fy: (document.querySelector('[data-testid="lk_fy"]') || {}).value, pairs, clipped, doc: document.documentElement.scrollWidth, iw: innerWidth,
            mainFits: main ? main.scrollWidth <= main.clientWidth + 1 : true, appLinks: document.querySelectorAll('a[href*="app.html"]').length, theme: document.documentElement.getAttribute('data-theme') };
        });
        const worst = m.pairs.map((x) => ({ t: x.t, r: ratio(x.fg, x.bg) })).sort((a, b) => a.r - b.r)[0] || { r: 99 };
        const good = m.rows[0] === first && m.rows[11] === last && m.rows.length === 12 && m.fy === fy && worst.r >= 4.5 && !m.clipped.length && m.doc <= m.iw && m.mainFits && m.appLinks === 0 && X.errs.length === 0;
        ok = ok && good;
        seen.push(vp.width + ' ' + theme + ': ' + m.rows[0] + '…' + m.rows[11] + ' · ' + m.fy + ' · AA ' + worst.r.toFixed(2) + (good ? '' : ' ✗ (' + JSON.stringify({ clipped: m.clipped, doc: m.doc, main: m.mainFits, app: m.appLinks, worst: worst.t, err: X.errs[0] }) + ')'));
        await X.ctx.close();
      }
      return { ok, saw: seen.join(' | ') };
    });
  }

  await w.step('R7', 'Every answer the stand-in served for a contract route has the API\'s keys, nesting and types', async () => { const [ok, msg] = C.finish(); return { ok, saw: msg }; });
});
