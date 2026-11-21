/**
 * tests/money01-1129.test.cjs — VERIFY-MONEY-01 rows A1 A2 A4 A6 A7 A9 A10 A12 A18 A19 A22 A24 A25 (batch 1129, lane fixMoney01). Pure: no database, no browser.
 * Hand figures, minor units. A1: IN, 18 Nov 2026, October GST owed 5,000,000 paise (50,000.00), November so far 0: the return that falls due is October's (20 Nov), inside the 30-day window:
 *   the cash series carries 5,000,000 out on 20 Nov (it was dropped: the old code dated the owed tax from the month that holds today, 20 Dec).
 * A10: a line 1,180.00 at 18% EXCLUSIVE (flag "false"): tax 21,240 paise, total 139,240; read inclusive it would be total 118,000 (tax 18,000): 21,240 - 18,000 = 3,240 paise under-booked.
 * Run: node tests/money01-1129.test.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const throws = (name, fn, re) => { try { fn(); ok(name, false, 'did not throw'); } catch (e) { ok(name, re.test(String((e && e.code) || '') + ' ' + String(e && e.message)), String(e && e.message)); } };
const L = (f) => require(path.join(H.API, 'lib', f));
const src = (...p) => fs.readFileSync(path.join(H.API, ...p), 'utf8').replace(/\r\n/g, '\n');

(async () => {
  console.log('\n== MONEY-01 · batch 1129 ==\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why + '\n\n0 checks'); return; }
  const CF = L('books-cashflow'), RET = L('books-cashflow-return'), REG = L('regulation');

  /* A1 */
  const next = RET.nextReturnDue(REG.packFor('IN'), '2026-11-18');
  eq('A1 IN on 18 Nov: October falls due on 20 Nov (not 20 Dec)', [next.due_date, next.period_start], ['2026-11-20', '2026-10-01']);
  const late = RET.nextReturnDue(REG.packFor('IN'), '2026-11-25');
  eq('A1 IN on 25 Nov: October is past due, the month that holds the day is offered (20 Dec)', [late.due_date, late.period_start], ['2026-12-20', '2026-11-01']);
  const base = { asOf: '2026-11-18', days: 30, currency: 'INR', opening: [{ role: 'bank', code: '1500', name: 'Bank', balance_minor: 9000000 }], receivable_items: [], payable_items: [], cheques: [], promises: [], names: new Map() };
  const r = CF.project(Object.assign({}, base, { gst: { payable_minor: 5000000, period_minor: 5000000, period_start: '2026-10-01', form: 'GSTR-3B', short: 'GST', due_date: next.due_date, why: null } }));
  eq('A1 hand: 5,000,000 paise goes out on 20 Nov, counted', [r.out_minor, r.gst.payable_minor, r.gst.counted, r.series.find((d) => d.date === '2026-11-20').out_minor], [5000000, 5000000, true, 5000000]);
  const est = CF.project(Object.assign({}, base, { gst: { payable_minor: 5000000, form: 'GSTR-3B', short: 'GST', due_date: '2026-11-20', why: null } }));
  ok('A1 no period figure: the ledger lump stands NAMED as an estimate', est.gst.estimated === true && /estimate/.test(est.gst.why), JSON.stringify(est.gst));

  /* A2 */
  const csv = L('csv');
  eq('A2 the one guard: =HYPERLINK quoted AND defused; tab and + too; plain -50 stays a number', [csv.cell('=HYPERLINK("x","y")'), csv.cell('\t=1+1'), csv.cell('+1+1'), csv.cell(-50)], ['"\'=HYPERLINK(""x"",""y"")"', "'\t=1+1", "'+1+1", '-50']);
  ok('A2 books-pack uses lib/csv.cell, no local copy', /require\('\.\/csv'\)\.cell/.test(src('lib', 'books-pack.js')) && !/\[",\\r\\n\]\/\.test\(text\)/.test(src('lib', 'books-pack.js')));

  /* A6 / A7 */
  const G = require(path.join(H.API, 'middleware', 'books-grant')), GC = L('books-grants-contract');
  const words = GC.consentWords(true, 'auditor');
  ok('A6 file downloads are not in the allow-list; the words say so (one source)', !G.GRANT_READS.has('/evidence/:id') && !G.GRANT_READS.has('/bank/statement-files/:id/file') && G.FILE_READS.size === 2 && words.can_read.length === G.GRANT_READS.size
    && words.cannot.some((w) => /download your bank statement files or the evidence/.test(w)) && !words.can_read.some((w) => /each bank statement|evidence kept/.test(w)), JSON.stringify(words));
  const routes = src('routes', 'books.js');
  ok('A7 the four reports ask costBlindStops first', ['/cashflow', '/trial-balance', '/pl', '/bs'].every((p) => routes.indexOf("router.get('" + p + "', auth, moneyReader, on, ...checked('GET " + p + "'), async (req, res) => {\n  try {\n    if (await costBlindStops(req, res, ctx(req), REPORT_COST_BLIND_SAY)) return;") >= 0));

  /* A10 */
  const IN = L('books-input');
  eq('A10 flagOf: "false" false, "TRUE" true, absent undefined, false false', [IN.flagOf('false', 'f'), IN.flagOf('TRUE', 'f'), IN.flagOf(undefined, 'f'), IN.flagOf(false, 'f')], [false, true, undefined, false]);
  throws('A10 flagOf: "maybe" is refused in words', () => IN.flagOf('maybe', 'price_includes_tax'), /must be true or false/);
  const BT = L('books-manual-bill-tax'), x = { s: { country: 'IN' }, entity: 'e' };
  const bill = (flag) => BT.taxedInvoice(x, { supplier_gstin: '33AAAAA0000A1Z9', my_gstin: '27AAAAA0000A1Z2', supplier_name: 'S', date: '2026-11-05', price_includes_tax: flag, lines: [{ name: 'Pen', qty: 1, unit_price: 1180, gst_rate: 18 }] }, 'INR', { taxed: true, what: 'the bill', taxWhy: 'forward', purpose: 'purchase_bill' });
  eq('A10 hand: "false" = exclusive, total 139,240 paise; true = inclusive, total 118,000', [Math.round(bill('false').ValDtls.TotInvVal * 100), Math.round(bill(true).ValDtls.TotInvVal * 100)], [139240, 118000]);

  /* A12 · A18 · A24 */
  throws('A12 a journal line with a typo party is refused, not booked as "no party"', () => L('books-manual').givenLines([{ account: '1100', dr_minor: 500000, party: 'typo-party' }], 'INR'), /not recognised/);
  const kept = '22222222-2222-4222-8222-222222222222';
  eq('A12 a real party id is kept; none stays none', L('books-manual').givenLines([{ account: '1100', dr_minor: 500000, party: kept }, { account: '4000', cr_minor: 500000 }], 'INR').map((l) => l.party), [kept, undefined]);
  throws('A24 minorOnly refuses 100.7', () => IN.minorOnly(100.7, 'amount_minor'), /whole number/);
  throws('A18 a client_ref of 81 characters is refused, never cut', () => IN.clientRef('x'.repeat(81)), /most is 80/);
  eq('A18 80 characters pass whole', IN.clientRef('y'.repeat(80)).length, 80);

  /* A19 */
  const MO = L('books-money-ops');
  eq('A19 blanks read 0, bigint text reads itself: [null, "", undefined, "300", 5] = 305', MO.sumMinor([null, '', undefined, '300', 5], 'INR'), 305);
  throws('A19 "12x" refuses (MONEY_AMOUNT_INVALID), never 0', () => MO.sumMinor(['12x', 100], 'INR'), /MONEY_AMOUNT_INVALID/);
  throws('A19 NaN refuses', () => MO.addMinor(NaN, 1, 'INR'), /MONEY_AMOUNT_INVALID/);

  /* A9 */
  let refused = null;
  try { await L('books-debit-check').holds('e', { supplier: 's', against_ref: 'B1', total_minor: NaN, currency: 'INR' }); } catch (e) { refused = e; }
  ok('A9 a debit note with no total is refused, not passed', !!refused && refused.code === 'DEBIT_NOTE_NO_TOTAL', String(refused));

  /* A4 · A25 */
  const Q = L('books-action-queue');
  const a = Q.queueAsked({ state: 'returned', closed_since: '2026-11-22' }, {}), b = Q.queueAsked({ state: 'constructor', since: '2026-01-01garbage' }, {});
  eq('A4 the returned filter dates the LAST step; A25 own-property state, whole date', [a.closed_since, a.states, b.states, b.since], ['2026-11-22', ['returned'], ['prepared', 'reviewed'], null]);
  ok('A4 the SQL filters on the latest step', /ORDER BY t\.step_id DESC LIMIT 1\) >= \$7/.test(src('lib', 'books-action-queue.js')));

  console.log('\n' + (fail ? '  FAILED ' + fail : '  passed ' + pass) + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });
