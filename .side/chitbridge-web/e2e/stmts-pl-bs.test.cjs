/**
 * stmts-pl-bs.test.cjs — W15-92 / W15-93 / W15-118 / W15-119 (ACC-357): the P&L and the Balance sheet by the pack's heads, the profit and the net assets FIRST, a subtotal for every head,
 * the Last-year column with its change and % of income, the Balance sheet's month and year ago; every figure, change and share is the SERVER's carried one (basis points), the page adds nothing.
 * OWNS      the proof on the real cap-books.js statement functions (lifted into a vm sandbox) with the shape the api answers (docs/contracts/web-api.json)
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/stmts-pl-bs.test.cjs
 */
'use strict';
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');

let reply = null;
const cx = vm.createContext({
  tx: (s) => s,
  esc: (s) => String(s),
  bkMoney: (n) => 'M' + n,
  bkDate: (d) => String(d),
  txn: (one, many, n) => (n === 1 ? one : many).replace('{count}', n),
  bkFyFrom: () => '2026-07-01',
  bkErr: (e) => 'ERR ' + e,
  bkToday: () => '2026-11-16',
  bkMountAttribute: () => '',
  window: {},
  document: { getElementById: () => null },
  api: async () => reply
});
vm.runInContext(liftFns('public/app/cap-books.js', ['bkPct', 'bkSpan', 'bkFig', 'bkDrillLink', 'bkPeriodBar', 'bkStmtCss', 'bkStRow', 'bkPlGroups', 'bkPL', 'bkPlQuery', 'bkPlLeadHTML', 'bkPlHeadHTML', 'bkPlCompareHTML', 'bkPlTotalRow', 'bkPlSectionTotal', 'bkBsSide', 'bkBS', 'bkBsLeadHTML', 'bkBsRange', 'bkBsBalancedChip', 'bkBsHasChange', 'bkBsWas', 'bkChange', 'bkOverNote', 'bkDrCr', 'bkTable', 'bkTB', 'bkTbRowHTML', 'bkTbBarHTML', 'bkTbTotalRowHTML']) +
  '\nthis.bkPL=bkPL;this.bkBS=bkBS;this.bkTB=bkTB;this.BK={tbDay:""};this.BK_PL={preset:"ytd",step:0,from:"",to:"",compare:"year"};this.BK_BS={kind:"today",step:0,asOf:""};', cx);

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const body = () => ({ innerHTML: '' });
const at = (h, a, b) => h.indexOf(a) >= 0 && h.indexOf(b) >= 0 && h.indexOf(a) < h.indexOf(b);

(async () => {
  /* ── P&L: the live walk's figures, in the pack's line order, beside the same days last year ── */
  const L = (code, name, m, prior, ch, share) => ({ code, name, amount_minor: m, prior_minor: prior, change_bp: ch, share_bp: share });
  reply = {
    currency: 'AUD', from: '2026-07-01', to: '2026-11-16',
    income: [], expense: [],
    total_income_minor: 19500000, total_expense_minor: 11571502, profit_minor: 7928498, profit_share_bp: 4066,
    total_income_share_bp: 10000, total_expense_share_bp: 5934,
    period: { preset: 'ytd', step: 0, can_next: false, from: '2026-07-01', to: '2026-11-16' },
    presets: [{ id: 'ytd', label: 'This year to date' }, { id: 'year', label: 'Last year' }],
    compare: { how: 'year', from: '2025-07-01', to: '2025-11-16', total_income_minor: 15600000, total_expense_minor: 9000000, profit_minor: 6600000, income_change_bp: 2500, expense_change_bp: 2857, profit_change_bp: 2013 },
    by_line: {
      income: [{ line: 'revenue', label: 'Revenue', amount_minor: 19500000, prior_minor: 15600000, change_bp: 2500, share_bp: 10000, accounts: [L('4000', 'Sales', 19500000, 15600000, 2500, 10000)] }],
      expense: [
        { line: 'employee', label: 'Employee benefits expense', amount_minor: 4348060, prior_minor: 4000000, change_bp: 870, share_bp: 2230, accounts: [L('5100', 'Wages', 4348060, 4000000, 870, 2230)] },
        { line: 'finance', label: 'Finance costs', amount_minor: 5860, prior_minor: 0, change_bp: null, share_bp: 3, accounts: [L('6090', 'Bank and merchant fees', 5860, 0, null, 3)] },
        { line: 'other', label: 'Other expenses', amount_minor: 7217582, prior_minor: 5000000, change_bp: 4435, share_bp: 3701, accounts: [L('6010', 'Rent', 1423163, 1000000, 4232, 730), L('6060', 'Repairs and maintenance', 5730419, 4000000, 4326, 2939), L('6190', 'Sundry expenses', 64000, 0, null, 33)] }
      ]
    }
  };
  let b = body(); await cx.bkPL(b); let h = b.innerHTML;
  ok(at(h, 'data-testid="pl-profit"', 'data-testid="pl-table"') && /Profit M7928498/.test(h) && /40\.7% of income/.test(h), 'the Profit leads, above the table, with its share of income (the server 4066 bp = 40.7%)');
  ok(/was M6600000 \(\+20\.1%\)/.test(h), 'the profit says what it was last year and the change (carried)');
  ok(at(h, 'Employee benefits expense', 'Finance costs') && at(h, 'Finance costs', 'Other expenses'), 'expense heads show, in the pack order');
  ok(at(h, 'Other expenses', '6010') && at(h, '6010', '6190') && at(h, '6190', 'Total Other expenses'), 'a head lists its ledgers, then its subtotal');
  ok(h.includes('Total Finance costs') && h.includes('Total Employee benefits expense') && h.includes('Total Revenue'), 'EVERY head has a subtotal, a one-ledger head too (W15-118)');
  ok(h.includes('M7217582') && h.includes('M5000000'), 'the head subtotal and its last-year figure are the servers (72,175.82 and 50,000.00), not a page sum');
  ok((h.match(/<th[ >]/g) || []).length === 6 && (h.match(/<thead>/g) || []).length === 1, 'the Ledger / This period / Last year / Change / % / % of income heading shows ONCE (change amount + change %, 68fa5c8e ASA 520)');
  ok(h.includes('+25.0%') && h.includes('+44.4%') && h.includes('>—<') && !h.includes('>NaN'), 'the change is carried (+25.0%), and a ledger new since last year says a dash, not a made-up percent');
  ok(h.includes('data-testid="pl-total-income"') && h.includes('M19500000') && h.includes('data-testid="pl-total-expense"') && h.includes('M11571502'), 'Total income 195,000.00 and Total expenses 115,715.02 are the carried ones');
  ok(h.includes('data-testid="pl-open-6010"') && h.includes('aria-expanded="false"') && h.includes("'2026-07-01','2026-11-16'"), 'a ledger line is a button that opens its entries below, for THIS period');
  ok(h.includes('data-testid="pl_pick"') && h.includes('This year to date') && h.includes('Custom dates') && h.includes('data-testid="pl-prev"') && /data-testid="pl-next"[^>]*disabled/.test(h), 'the period picker (the packs presets) and the stepper replace the two dates and Show; the later arrow is greyed at the running period');
  ok(!h.includes('id="pl_from"'), 'no typed dates until Custom dates is picked');
  reply = Object.assign({}, reply, { compare: null });
  b = body(); await cx.bkPL(b);
  ok((b.innerHTML.match(/<th[ >]/g) || []).length === 3 && !b.innerHTML.includes('>Last year</th>'), 'comparison off: no Last year and Change columns (nothing empty)');
  reply = Object.assign({}, reply, { total_income_minor: undefined, total_expense_minor: undefined });
  b = body(); await cx.bkPL(b);
  ok(/data-testid="pl-total-income"[^>]*><span[^>]*>—/.test(b.innerHTML) && !b.innerHTML.includes('data-testid="pl-total-income">M'), 'a total the server did not carry reads a dash (the page never sums)');

  /* ── Balance sheet: net assets first, as at a day, this date · a month ago · a year ago ── */
  const G = (name, m, pm, py) => ({ code: name, name, amount_minor: m, prior_month_minor: pm, prior_year_minor: py });
  const I = (code, name, m, pm, py, group, extra) => Object.assign({ code, name, amount_minor: m, prior_month_minor: pm, prior_year_minor: py, group: { code: group, name: group } }, extra || {});
  reply = {
    currency: 'AUD', asOf: '2026-11-16', fy_from: '2026-07-01', as_at: { kind: 'today', step: 0, as_at: '2026-11-16', can_next: false },
    assets: [I('1000', 'Bank', 14061005, 13000000, 9000000, 'Current Assets')], total_assets_minor: 14061005,
    liabilities: [I('2100', 'Suppliers', 2125730, 2000000, 1500000, 'Current Liabilities'), I('2200', 'GST payable to the ATO', 1400972, 1000000, 800000, 'Current Liabilities', { net_of: [{ code: '2200', name: 'GST collected' }, { code: '2210', name: 'GST paid' }] })],
    equity: [I('3000', 'Owners capital', 2605805, 2605805, 2605805, 'Equity'), { code: null, name: 'Net profit', amount_minor: 7928498, prior_month_minor: 7000000, prior_year_minor: 4000000, group: null }],
    total_liabilities_minor: 3526702, total_equity_minor: 10534303, total_liab_equity_minor: 14061005, net_assets_minor: 10534303, net_assets_ok: true,
    groups: { assets: [G('Current Assets', 14061005, 13000000, 9000000)], liabilities: [G('Current Liabilities', 3526702, 3000000, 2300000)], equity: [G('Equity', 2605805, 2605805, 2605805), { code: null, name: null, amount_minor: 7928498, prior_month_minor: 7000000, prior_year_minor: 4000000 }] },
    compare: { month: { as_at: '2026-10-16', total_assets_minor: 13000000, total_liabilities_minor: 3000000, total_equity_minor: 10000000, net_assets_minor: 10000000 }, year: { as_at: '2025-11-16', total_assets_minor: 9000000, total_liabilities_minor: 2300000, total_equity_minor: 6700000, net_assets_minor: 6700000 } }
  };
  b = body(); await cx.bkBS(b); h = b.innerHTML;
  ok(at(h, 'data-testid="bs-net"', 'data-testid="bs-table"') && /Net assets M10534303/.test(h) && /a month ago M10000000/.test(h) && /a year ago M6700000/.test(h), 'Net assets lead, above the table, with a month ago and a year ago (carried)');
  ok(/as at 2026-11-16/.test(h) && h.includes('data-testid="bs_pick"') && h.includes('data-testid="bs-prev"'), 'the date says "as at", with the picker and the stepper');
  ok(h.includes('Total Current Assets') && h.includes('Total Current Liabilities'), 'the packs own chart heads group the lines, each with its carried subtotal (no word of ours)');
  ok(h.includes('data-testid="bs-total-assets"') && h.includes('M14061005') && h.includes('data-testid="bs-total-liabilities"') && h.includes('M3526702') && h.includes('data-testid="bs-total-equity"') && h.includes('M10534303'), 'Total assets, liabilities and equity are the carried totals');
  ok(h.includes('data-testid="bs-total-le"') && /Total liabilities and equity/.test(h), 'Total liabilities and equity still closes the sheet');
  ok(h.includes('M13000000') && h.includes('M9000000') && /A month ago/.test(h) && /A year ago/.test(h), 'each line carries a month ago and a year ago, side by side in the one view');
  ok(/data-testid="st-netof"[^>]*>net of GST collected less GST paid</.test(h) && !/<td>\s*Net of/.test(h), 'the GST explanation sits on the SAME line as its ledger (small text, the full words on hover), never its own row');
  ok(!h.includes('Total Equity') && (h.match(/>Equity</g) || []).length === 1, 'a pack group named like its section (Equity under Equity) is said once, with no second total');
  ok((h.match(/as at/g) || []).length === 1, 'as at is said once (the bar), not again in the Net assets line');
  ok(/<th class="num">A year ago/.test(h) && /<th class="num bk-wide">A month ago/.test(h), 'the narrow screen keeps a year ago and drops a month ago');
  ok(h.includes('.bk-dl{background:none!important;border:0!important;padding:6px 0!important'), 'a ledger line is plain link text with a padded hit area, not a pill (it wins over the global button look)');
  ok(/data-testid="bs-balanced"[^>]*>✓ balances/.test(h), 'the chip compares the two carried totals: balances');
  reply = Object.assign({}, reply, { total_liab_equity_minor: 14061000 });
  b = body(); await cx.bkBS(b);
  ok(/⚠ does not balance/.test(b.innerHTML), 'two carried totals that differ: does not balance');
  /* ── leader-compare #2: the Balance sheet's Change and % (the server read last year), hand figures, AUD minor units ──
        Bank 14061005 vs 9000000 → +5061005, +5623 bp, over · Suppliers 2125730 vs 1500000 → +625730, +4171 bp, not over (the server decides; the page paints) */
  const withChange = (row, change, bp, over) => Object.assign({}, row, { change_minor: change, change_bp: bp, change_over: over });
  reply = Object.assign({}, reply, { total_liab_equity_minor: 14061005, over_rule: { pct_bp: 1000, min_major: 1000, min_minor: 100000 },
    assets: [withChange(reply.assets[0], 5061005, 5623, true)], liabilities: [withChange(reply.liabilities[0], 625730, 4171, false), withChange(reply.liabilities[1], 400972, 5011, false)], equity: reply.equity.map((x) => withChange(x, 0, null, false)) });
  b = body(); await cx.bkBS(b); h = b.innerHTML;
  ok((h.match(/<th[ >]/g) || []).length === 6 && h.includes('<th class="num">Change</th><th class="num">%</th>'), 'the balance sheet gains Change and % after A year ago when the server read last year (6 headings)');
  ok(h.includes('+M5061005') && h.includes('+25.0%') === false && h.includes('+56.2%') && h.includes('+41.7%'), 'Bank +M5061005 and +56.2%, Suppliers +41.7%: the servers amount and basis points, nothing computed here');
  ok((h.match(/data-cbsid="BKS006-P01"/g) || []).length === 1 && (h.match(/class="bk-over"/g) || []).length === 1, 'exactly one line is highlighted (the dot BKS006-P01 and the tint): the one the server flagged');
  ok(at(h, '</table>', 'data-testid="bs-over-note"') && /Highlighted: change of 10% and M100000 or more|Highlighted: change of 10% and M1000/.test(h) && h.includes('data-cbsid="BKS006-P02"'), 'the note states the rule UNDER the table (BKS006-P02), so the first data row does not move');
  reply = Object.assign({}, reply, { assets: reply.assets.map((x) => { const y = Object.assign({}, x); delete y.change_minor; delete y.change_bp; delete y.change_over; return y; }), liabilities: reply.liabilities.map((x) => { const y = Object.assign({}, x); delete y.change_minor; delete y.change_bp; delete y.change_over; return y; }), equity: reply.equity.map((x) => { const y = Object.assign({}, x); delete y.change_minor; delete y.change_bp; delete y.change_over; return y; }) });
  b = body(); await cx.bkBS(b); h = b.innerHTML;
  ok((h.match(/<th[ >]/g) || []).length === 4 && !h.includes('bs-over-note') && !h.includes('BKS006-P01'), 'a year before the books began (no change on any line): no Change column, no note, nothing empty');

  /* ── the Trial balance: Last year (Dr / Cr), Change, % and the flag, hand figures ──
        Cash   Dr 500000 · net +500000 vs +400000 → +100000, +2500 bp, over   (prior reads "M400000 Dr")
        Sales  Cr  90000 · net  -90000 vs  -80000 →  -10000, -1250 bp, not over (prior reads "M80000 Cr") */
  reply = { currency: 'AUD', asOf: '2026-11-16', fy_from: '2026-07-01', total_dr_minor: 500000, total_cr_minor: 500000, balanced: true,
    over_rule: { pct_bp: 1000, min_major: 1000, min_minor: 100000 }, compare: { how: 'year', as_at: '2025-11-16' },
    rows: [{ code: '1000', name: 'Cash', dr_minor: 500000, cr_minor: 0, net_minor: 500000, prior_net_minor: 400000, change_minor: 100000, change_bp: 2500, change_over: true },
      { code: '4000', name: 'Sales', dr_minor: 0, cr_minor: 90000, net_minor: -90000, prior_net_minor: -80000, change_minor: -10000, change_bp: -1250, change_over: false }] };
  b = body(); await cx.bkTB(b); h = b.innerHTML;
  ok((h.match(/<th[ >]/g) || []).length === 7 && h.includes('>Last year</th>') && h.includes('>Change</th>'), 'the trial balance gains Last year, Change and % (7 headings)');
  ok(h.includes('M400000 Dr') && h.includes('M80000 Cr'), 'last year is the NET in words: Dr for a debit, Cr for a credit, never a minus');
  ok(h.includes('+M100000') && h.includes('+25.0%') && h.includes('M-10000') && h.includes('-12.5%'), 'the change and its percent are the servers (+100000 +2500 bp; -10000 -1250 bp)');
  ok((h.match(/data-cbsid="BKS004-P02"/g) || []).length === 1 && (h.match(/<tr class="bk-over">/g) || []).length === 1, 'only the flagged account is marked: one dot (BKS004-P02) and one tinted row');
  ok(at(h, '</table>', 'data-testid="tb-over-note"') && h.includes('data-cbsid="BKS004-P03"'), 'the rule note sits UNDER the table (BKS004-P03)');
  ok(h.includes('data-testid="tb-dr"') && h.includes('data-testid="tb-cr"'), 'the Total row keeps its Debit and Credit (the engines own, equal)');
  reply = Object.assign({}, reply, { compare: null, rows: reply.rows.map((x) => ({ code: x.code, name: x.name, dr_minor: x.dr_minor, cr_minor: x.cr_minor, net_minor: x.net_minor })) });
  b = body(); await cx.bkTB(b); h = b.innerHTML;
  ok((h.match(/<th[ >]/g) || []).length === 4 && !h.includes('tb-over-note') && !h.includes('BKS004-P02'), 'the first year (compare null): the four columns it had, no note, no dots');
  process.exitCode = bad ? 1 : 0;
})();
