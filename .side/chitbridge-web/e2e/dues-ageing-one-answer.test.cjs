/**
 * dues-ageing-one-answer.test.cjs — W15-94 / W15-95 / W15-96 (l16-ageing, 16 Nov 2026): one ageing on Receivables, Payables and the Day book chip; what is still owed on each bill; the hold and the tax-invoice flag beside Pay.
 * OWNS      the proof, on the real cap-books.js functions (lifted into a vm sandbox): bkFollowWord · bkDuesAge · bkDuesNext · bkBillStanding · bkBillFlags · bkOwedFlags · bkPartyBillsHTML · bkTodoCounts · payHeldBills
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/dues-ageing-one-answer.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');
const FILE = 'public/app/cap-books.js';
const src = fs.readFileSync(path.join(__dirname, '..', FILE), 'utf8');
const varText = (name) => { const a = src.indexOf('var ' + name + ' = '), b = src.indexOf('\n];\n', a); return src.slice(a, b + 3); };

const money = (n, c) => 'M' + n;
const cx = vm.createContext({
  tx: (s) => s, esc: (s) => String(s), bkMoney: money, bkDate: (d) => 'D' + d,
  txf: (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => v[k]),
  bkBillPart: (s) => '<i>' + (s && s.ref) + '</i>', bkBillNo: (no, ref) => no || ref,
  bkQuiet: (n, f, d) => d, bkCur: () => 'AUD', bkPartyKind: (pid) => (BK.dues[pid].side === 'supplier' ? 'supplier' : 'customer'),
  bkMountAttribute: () => '', txn: (one, other, n) => (Number(n) === 1 ? one : other).replace('{count}', n), bkWaitN: () => ({}), bkWaitTodo: () => '', bkChequeNext: () => [], bkChequeStatus: (s) => s, bkOwedRead: () => {}, bkStmtRead: () => {}, bkDuesSide: (p) => (p.side === 'supplier' ? 'pay' : 'rcv'),
  CBList: { nextRow: (cells) => '[' + cells.join(' | ') + ']', get: () => null, nextTable: (o) => '[' + o.cols.map((c) => c.label).join('|') + ']' + o.rows.map((r) => '[' + r.join(' | ') + ']').join(' '), pager: () => '' }, bkMarkControl: () => null, api: async () => ({}), document: { getElementById: () => null },
  payAllocs: () => ALLOCS, PAY: null
});
let ALLOCS = [];
cx.BK = { dues: {}, stmt: {}, owed: {}, mk: null };
const BK = cx.BK;
vm.runInContext(varText('BK_FOLLOW') + '\n' + src.match(/^var BK_STANDING = .*;$/m)[0] + '\n' + varText('BK_PB_TABS') + '\n' + src.match(/^var BK_NEED = \{[\s\S]*?\n\};$/m)[0] + '\n' + src.match(/^var BK_NEED_ORDER = .*;$/m)[0] + '\nvar BK_PB_LIMIT = 25;\n' + liftFns(FILE, ['bkFollowWord', 'bkDuesAge', 'bkDuesNext', 'bkBillStanding', 'bkBillFlags', 'bkOwedFlags', 'bkPartyBillsHTML', 'bkPbStripHTML', 'bkPbTableHTML', 'bkPbPagerHTML', 'bkPbOf', 'bkPbRead', 'bkPbRequest', 'bkPbIngestMarks', 'bkSetTermsLink', 'bkBillStatus', 'bkNeedAction', 'bkTodoCounts', 'payHeldBills']) +
  '\nthis.f = { bkFollowWord, bkDuesAge, bkDuesNext, bkBillStanding, bkBillFlags, bkOwedFlags, bkPartyBillsHTML, bkTodoCounts, payHeldBills, BK_FOLLOW, bkBillStatus };', cx);
const f = cx.f;
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const FU = (o) => Object.assign({ not_due: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, worst: null, no_terms_minor: 0, terms: 'ok' }, o);

/* W15-94 · the five words, one list */
ok(JSON.stringify(f.BK_FOLLOW.map((x) => x[1])) === JSON.stringify(['Current', '1–30 days', '31–60 days', '61–90 days', '90+ days']), 'the five ageing words: Current · 1–30 · 31–60 · 61–90 · 90+');
ok(f.bkFollowWord('lt_1m') === '', 'a pack month bucket is no word of this screen (there is no "Other")');

/* Northside: 135,300 owed; 6,600 not due, the rest 31–60 late (the walk's AU numbers) */
const north = { party_id: 'n', side: 'customer', balance_minor: 13530000, oldest_due: '2026-10-16', disputed_minor: 0, buckets: { not_due: 660000, lt_1m: 12870000 }, follow_up: FU({ not_due: 660000, d31_60: 12870000, worst: 'd31_60' }) };
ok(f.bkDuesAge(north) === '31–60 days', 'the oldest-due cell says "31–60 days", not "Not due" (the AU pack buckets are not read)');
BK.dues = { n: north };
const next = f.bkDuesNext(north, 'AUD', 'dues');
ok(!/data-b="d31_60"/.test(next) && /Reading the bills/.test(next), 'the next level has ONE ageing, the bands of the bills panel (GET /party/:id/bills): no second list of age rows here');
ok(!/Other/.test(next) && !/data-b="other"/.test(next), 'no "Other" row, whatever the pack sends');
ok(f.bkDuesAge({ follow_up: FU({ not_due: 5 }) }) === 'Current' && f.bkDuesAge({ follow_up: FU({}) }) === '' && f.bkDuesAge({}) === '', 'all not yet due = Current; nothing owed or no answer = no word');

/* no due date: the screen says so */
const nodue = Object.assign({}, north, { follow_up: FU({ d61_90: 100000, worst: 'd61_90', no_terms_minor: 100000, terms: 'not_set' }) });
ok(/M100000 has no due date — aged from the bill date/.test(f.bkDuesNext(nodue, 'AUD', 'dues')), 'a bill with no due date: "no due date — aged from the bill date"');

/* Payables: the same five, from the supplier row */
const metro = { party_id: 'm', side: 'supplier', balance_minor: -2125730, oldest_due: '2026-10-01', disputed_minor: 0, follow_up: FU({ d31_60: 2125730, worst: 'd31_60' }) };
BK.dues.m = metro;
ok(/Reading the bills/.test(f.bkDuesNext(metro, 'AUD', 'dues')), 'Payables opens the same bills panel as Receivables');

/* the Day book chip counts the customers the same word calls late */
const counts = f.bkTodoCounts({ parties: [north, metro, { party_id: 'k', side: 'customer', follow_up: FU({ not_due: 800000 }) }, { party_id: 'x', side: 'customer' }] }, { cheques: [] }, {});
ok(counts.overdue === 1, 'the Day book chip: 1 customer overdue = the customers whose follow_up has a late bucket (' + counts.overdue + ')');

/* W15-95 / W15-107 · the bills, a page the server sends: Date · Bill · Due date · Days overdue · Status · Amount · Still owed · Reviewed */
BK.dues = { n: north };
const ans = { bills: [
  { ref: 'c2', bill_no: 'S042-02', chit_id: 'c2', entry_id: 'e2', date: '2026-08-20', due_date: '2026-09-19', days_overdue: 58, band: 'd31_60', status: 'part', amount_minor: 6000000, owed_minor: 5080000, mark: null, evidence_flag: null, reasons: ['overdue'], why: 'overdue', action: 'pay' },
  { ref: 'c3', bill_no: 'S042-03', chit_id: 'c3', entry_id: 'e3', date: '2026-10-01', due_date: '2026-10-31', days_overdue: null, band: 'not_due', status: 'unpaid', amount_minor: 5000000, owed_minor: 5000000, mark: null, evidence_flag: null, reasons: [] },
  { ref: 'c5', bill_no: 'S042-05', chit_id: 'c5', entry_id: 'e5', date: '2026-09-01', due_date: null, days_overdue: 40, band: 'd31_60', status: 'unpaid', amount_minor: 100000, owed_minor: 100000, no_terms: true, mark: null, evidence_flag: null, reasons: ['no_terms', 'overdue'], why: 'no_terms', action: 'terms' },
  { ref: 'c6', bill_no: 'S042-06', chit_id: 'c6', entry_id: 'e6', date: '2026-08-03', due_date: '2026-09-02', days_overdue: 75, band: 'd61_90', status: 'unpaid', amount_minor: 900000, owed_minor: 900000, mark: { class: 'hold', kind: 'on_hold', by_name: 'Pat Auditor', at: '2026-11-15' }, evidence_flag: 'no_tax_invoice', reasons: ['no_tax_invoice', 'overdue'], why: 'no_tax_invoice', action: 'attach' }],
  total: 4, page: 1, limit: 25, counts: { needs: 3, open: 4, paid: 1, all: 5, in_order: 1 }, bands: { d0_30: 9570000, d31_60: 3960000, not_due: 5000000 }, on_account_minor: 7920000, checks: true };
BK.pb = { n: { q: { tab: 'all', paid: false, why: '', band: '', sort: 'date', dir: 'desc', page: 1 }, ans, busy: false, list: 'dues' } };
const bills = f.bkPartyBillsHTML('n', 'dues', 'AUD');
ok(bills.includes('[Date|Bill|Status|Due date|Days overdue|Amount|Still owed|Reviewed| ]'), 'All: the columns, in order: Date · Bill · Status · Due date · Days overdue · Amount · Still owed · Reviewed · the one action');
ok(/data-b="band-d0_30"[^>]*>1–30<span class="bk-bw"> days<\/span> <b>M9570000<\/b>/.test(bills) && /data-b="band-d31_60"/.test(bills) && /data-b="band-not_due"/.test(bills) && !/band-d61_90|band-d90_plus/.test(bills), 'every non-zero band is a chip (1–30 days too: the line the walk missed); the zero ones are not shown; the word "days" drops on a phone');
ok(/data-b="tab-needs"[^>]*aria-pressed="false"[^>]*>Needs you <b>3<\/b>/.test(bills) && /data-b="tab-open"[^>]*>Open <b>4<\/b>/.test(bills) && /data-b="tab-all"[^>]*aria-pressed="true"[^>]*>All <b>5<\/b>/.test(bills), 'Needs you · Open · All, with the server counts; the tab asked for is pressed');
ok(/data-b="paid-filter"[^>]*>Paid 1/.test(bills) && !/data-b="state-/.test(bills), 'Paid is a filter inside All (no Open / Paid / All chips any more)');
ok(/<i>S042-02<\/i>[^\n]*M6000000 \| <b data-b="owed">M5080000/.test(bills), 'S042-02: amount 60,000 · still owed 50,800');
ok(/data-b="standing-part"[^>]*>Part paid</.test(bills) && /data-b="standing-unpaid"[^>]*>Unpaid</.test(bills), 'Part paid and Unpaid are said once, in the Status cell');
ok(!/Unpaid/.test(f.bkBillStatus(ans.bills[3], 'all')) && /Unpaid/.test(f.bkBillStatus(ans.bills[1], 'all')), 'a bill with a why does not also say "Unpaid" (every open bill is); one with none does');
ok(bills.includes('| 58 |') && bills.includes('| not due |'), 'days overdue: the number, or "not due"');
ok(/data-b="set-terms"[^>]*>Set terms</.test(bills), 'a bill with no due date says "Set terms" in the Due date cell (the one terms editor)');
ok(/‖ On hold · no tax invoice<\/button>/.test(bills) && !/data-b="no-tax-invoice"/.test(bills), 'a held bill with no tax invoice: ONE chip "‖ On hold · no tax invoice", no second chip');
ok(/title="Pat Auditor · D2026-11-15"/.test(bills), 'who and when sit on the chip, on hover');
ok(/M7920000 on account, counted against the oldest bills/.test(bills), 'money on account is said as the books hold it');
ok(!/owed-mismatch/.test(bills), 'the old mismatch line is gone: the totals are the server\'s, one ageing');
BK.pb.n.q.tab = 'needs';
const needsTab = f.bkPartyBillsHTML('n', 'dues', 'AUD');
ok(needsTab.includes('[Date|Bill|Why|Due date|Days overdue|Still owed|Reviewed| ]'), 'Needs you: Why instead of Status, and no Amount (it says nothing more than Still owed)');
ok(/data-b="tab-needs"[^>]*aria-pressed="true"/.test(needsTab) && /bills-in-order[^>]*>✓ 1 bill in order/.test(needsTab), 'Needs you is pressed, and the clean bills fold into one line: "✓ 1 bill in order"');
ok(/data-b="need-act-attach"[^>]*>Attach</.test(needsTab) && /data-b="need-act-pay"[^>]*>Receive</.test(needsTab), 'each bill with a why gets ONE action: Attach (no tax invoice), Receive (late, a customer; a supplier says Pay)');
ok(!/data-b="band-(d|not)/.test(needsTab), 'no age-band chips on Needs you (the order is the urgency)');
ok(/Overdue</.test(needsTab) && /No terms</.test(needsTab), 'Needs you says the why in a chip, overdue and no terms included');
BK.pb.n.ans = null;
ok(/Reading the bills…/.test(f.bkPartyBillsHTML('n', 'dues', 'AUD')), 'before the read lands: "Reading the bills…"');

/* W15-96 · the hold and the tax-invoice flag beside Pay */
const held = { against_ref: 'S042-19', bill_no: 'S042-19', due_date: '2026-10-01', mark: { class: 'hold', kind: 'on_hold', by_name: 'Pat Auditor', note: 'wait for the invoice' }, evidence_flag: 'no_tax_invoice' };
const flags = f.bkBillFlags(held);
ok(/data-b="mark-hold"[^>]*>‖ On hold/.test(flags) && /data-b="no-tax-invoice"[^>]*>⚠ No tax invoice/.test(flags), 'a held bill shows "On hold" and "No tax invoice" together');
ok(f.bkBillFlags({ mark: { class: 'clear' }, evidence_flag: null }) === '' && f.bkBillFlags(null) === '', 'a checked bill with its invoice shows nothing extra');
BK.dues.m = metro;
BK.owed.m = { checks: true, proposal: [held] };
const beside = f.bkOwedFlags('m');
ok(/On hold/.test(beside) && /No tax invoice/.test(beside), 'beside the party\'s Pay: both flags once its bills have been read');
cx.PAY = { preview: { proposal: [held, { against_ref: 'S042-20', bill_no: 'S042-20', mark: null }] } };
ALLOCS = [{ against_ref: 'S042-19', amount_minor: 2125730 }, { against_ref: 'S042-20', amount_minor: 100 }];
const heldList = f.payHeldBills();
ok(heldList.length === 1 && heldList[0].no === 'S042-19' && heldList[0].by === 'Pat Auditor' && heldList[0].note === 'wait for the invoice', 'Pay asks: the held bill is named with who and why');
ALLOCS = [{ against_ref: 'S042-19', amount_minor: 0 }, { against_ref: 'S042-20', amount_minor: 100 }];
ok(f.payHeldBills().length === 0, 'paying only the other bill asks nothing extra (the hold is on a bill that takes nothing)');

console.log(bad ? '\n' + bad + ' FAILED' : '\nall ok');
process.exit(bad ? 1 : 0);
