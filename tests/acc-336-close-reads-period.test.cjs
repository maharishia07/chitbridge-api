/**
 * tests/acc-336-close-reads-period.test.cjs — ACC-336 / ACC-336b: THE CLOSE SETS OFF AGAINST WHAT THE PERIOD REALLY OWES. RED ON MAIN BY DESIGN
 * (the plan is docs/critique/ACC-336-PLAN.md; no lib code changes in this PR).
 *
 * Offline: the in-memory ledger (tests/support/books-harness.cjs) and the real engines. Pattern: tests/pay-fix.test.cjs (BP.gstPay / BP.gstClose on a handle).
 * Hand figures, IN, October 2026 (period 7), minor units: output CGST 10000, input CGST 4000. Credit first: utilised 4000, payable 6000.
 *   K1  pay 10000 dated 9 Nov naming October, close October: utilised 4000 · payable 6000 · paid 10000 · still_to_pay 0 · excess 4000;
 *       ledger after: output CGST 0 (credit 10000 - pay 10000 - set-off 4000 + surplus 4000), input 0, tax_advance_cgst 4000 (a cash surplus, never input credit)
 *   K2  the SAME gross payment dated 20 Oct (inside the period, ACC-336b): the figures and the ledger are IDENTICAL to K1 — the date of a challan never changes the set-off
 *   K3  partial: pay 6000 dated 9 Nov: utilised 4000 · payable 6000 · paid 6000 · still_to_pay 0 · excess 0; ledger: output 0, no advance entry
 *   K3b the same 6000 dated 20 Oct: identical to K3 (today the set-off sees output 4000 and answers payable 0)
 *   K4  no payment: utilised 4000 · payable 6000 · paid {} · still_to_pay 6000 · excess 0; ledger: output credit 6000 (still owed), no advance entry
 *   K5  replay of K2's close (a payment posted between the calls): the same utilised / payable, duplicate:true, same entry_no — payable is read from what the close stored
 * Run: CB_ENGINES_DIR=<engines checkout> node tests/acc-336-close-reads-period.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
async function section(title, fn) { console.log('\n── ' + title + ' ──'); try { await fn(); } catch (e) { fail++; console.log('   FAIL threw: ' + (e && e.stack || e)); } }

const SHOP = '11111111-1111-4111-8111-111111111111';
const FY = '2026-27', OCTOBER = 7; /* April is 1 */

/** a fresh IN shop with output CGST 10000 (and input CGST 4000 when asked) journalled in October */
async function world(withInput, mo) {
  const M = mo || { period: OCTOBER, day: '2026-10-10' }; /* the month under test: October by default; September for the next-period cases (November has not ended on the clock) */
  const X = H.load();
  await X.B.enable(X.db, SHOP, {});
  const code = {};
  X.T.accounts.filter((a) => a.entity_id === SHOP).forEach((a) => { code[a.role] = a.code; });
  const journal = (lines, ref) => X.B.postEntry(X.db, SHOP, { type: 'manual', owner: true, date: M.day, currency: 'INR', narration: 'GST ' + ref, source_ref: 'k:' + ref, lines });
  const o = await journal([{ account: code.cash, dr: 100 }, { account: code.output_cgst, cr: 100 }], 'out');
  if (!o || o.ok === false) throw new Error('output journal refused: ' + JSON.stringify(o));
  if (withInput) await journal([{ account: code.input_cgst, dr: 40 }, { account: code.cash, cr: 40 }], 'in');
  const BP = require(path.join(H.API, 'lib', 'books-period'));
  const setting = await X.store.setting(X.db, SHOP);
  const pay = (challan, cgst, date, more) => BP.gstPay(SHOP, setting, Object.assign({ fy: FY, period: M.period, amounts: { cgst_minor: cgst }, bank: 'bank', challan_no: challan, date }, more || {}), SHOP);
  const close = () => BP.gstClose(SHOP, setting, { fy: FY, period: M.period }, SHOP);
  const journalMore = (lines, ref, day) => X.B.postEntry(X.db, SHOP, { type: 'manual', owner: true, date: day, currency: 'INR', narration: 'GST ' + ref, source_ref: 'k:' + ref, lines });
  /** a role's net, debit positive, from the stored lines (read only) */
  const net = (role) => { const acc = X.T.accounts.find((a) => a.entity_id === SHOP && a.role === role); return acc ? X.T.lines.filter((l) => l.entity_id === SHOP && l.account_id === acc.account_id).reduce((t, l) => t + (l.dr_minor || 0) - (l.cr_minor || 0), 0) : null; };
  return { X, pay, close, net, code, BP, setting, journalMore, M };
}
const figures = (c) => ({ utilised: (c.utilised || []).reduce((t, u) => t + u.amount_minor, 0), payable: (c.payable_minor || {}).cgst_minor });
const keys = (c) => ({ paid: (c.paid_before_close_minor || {}).cgst_minor, still: (c.still_to_pay_minor || {}).cgst_minor, excess: (c.excess_paid_minor || {}).cgst_minor });

/** one gross-or-partial case: pay `amount` on `date`, close October, assert the answer AND the ledger */
async function paidCase(label, amount, date, want) {
  const W = await world(true);
  const p = await W.pay('CH-' + label, amount, date);
  ok(label + ' · the payment posts (dated ' + date + ')', p.ok === true, JSON.stringify(p));
  const c = await W.close();
  ok(label + ' · the close posts', c.ok === true, JSON.stringify(c));
  eq(label + ' · set-off: credit first (utilised, payable)', figures(c), { utilised: 4000, payable: want.payable });
  eq(label + ' · what was paid for the period (paid · still_to_pay · excess)', keys(c), { paid: amount, still: want.still, excess: want.excess });
  eq(label + ' · ledger: output CGST net · input net · advance asset', [W.net('output_cgst'), W.net('input_cgst'), W.net('tax_advance_cgst')], [0, 0, want.advance]);
  return { W, c };
}

(async () => {
  console.log('\n══ ACC-336 / 336b · the close sets off against what the period really owes ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n'); process.exit(1); }

  await section('K1 · a payment dated AFTER the period (10000 on 9 Nov): utilised 4000, payable 6000, paid 10000, excess 4000 held as an advance — never a debit left on the output head',
    () => paidCase('K1', 10000, '2026-11-09', { payable: 6000, still: 0, excess: 4000, advance: 4000 }));

  await section('K2 · ACC-336b: the SAME gross payment dated INSIDE the period (10000 on 20 Oct) gives the same set-off and the same ledger as K1',
    () => paidCase('K2', 10000, '2026-10-20', { payable: 6000, still: 0, excess: 4000, advance: 4000 }));

  await section('K3 · a partial payment (6000 on 9 Nov): utilised 4000, payable 6000, paid 6000, nothing excess, no advance',
    () => paidCase('K3', 6000, '2026-11-09', { payable: 6000, still: 0, excess: 0, advance: 0 }));

  await section('K3b · the same partial payment dated INSIDE the period (6000 on 20 Oct) reads the same as K3 (main: output 4000 at span.end, payable 0)',
    () => paidCase('K3b', 6000, '2026-10-20', { payable: 6000, still: 0, excess: 0, advance: 0 }));

  await section('K4 · no payment: utilised 4000, payable 6000, paid nothing, still_to_pay 6000, no advance; 6000 stays owed on the output head', async () => {
    const W = await world(true), c = await W.close();
    eq('K4 · set-off', figures(c), { utilised: 4000, payable: 6000 });
    eq('K4 · paid · still_to_pay · excess', keys(c), { paid: undefined, still: 6000, excess: 0 });
    ok('K4 · the paid key is present and empty, not missing: paid_before_close_minor {}', !!c.paid_before_close_minor && Object.keys(c.paid_before_close_minor).length === 0, JSON.stringify(c.paid_before_close_minor));
    eq('K4 · ledger: output credit 6000 (still owed), input 0, advance 0', [W.net('output_cgst'), W.net('input_cgst'), W.net('tax_advance_cgst')], [-6000, 0, 0]);
  });

  await section('K5 · replay of the K2 close: the same utilised and payable (read from what the close stored), duplicate, same entry_no', async () => {
    const W = await world(true);
    await W.pay('CH-K5', 10000, '2026-10-20');
    const first = await W.close();
    const again = await W.close();
    ok('K5 · the first close posts the figures K2 expects', first.ok === true && JSON.stringify(figures(first)) === JSON.stringify({ utilised: 4000, payable: 6000 }), JSON.stringify(figures(first)));
    ok('K5 · the replay is the same entry', again.ok === true && again.duplicate === true && again.entry_no === first.entry_no, JSON.stringify([again.duplicate, again.entry_no, first.entry_no]));
    eq('K5 · the replay answers the same set-off (a recompute from span.end would answer payable 0)', figures(again), { utilised: 4000, payable: 6000 });
  });

  /* ═══ MUST cases the critic asked for (docs/critique/ACC-336-PLAN.md section 7): red on main ═══ */
  const entriesOf = (W) => W.X.T.entries.filter((e) => e.entity_id === SHOP);
  const poolOf = (W, ref) => entriesOf(W).find((e) => e.source_ref === ref);

  await section('T5 · a challan REVERSED before the close is not counted: paid {} · still_to_pay 6000 (the 6000 is owed again)', async () => {
    const W = await world(true);
    const p = await W.pay('CH-T5', 6000, '2026-11-09');
    const r = await W.X.B.reverseEntry(W.X.db, SHOP, p.entry_id, { owner: true, reason: 'paid in error' });
    ok('T5 · the reversal posts', r && r.ok !== false, JSON.stringify(r));
    const c = await W.close();
    eq('T5 · set-off', figures(c), { utilised: 4000, payable: 6000 });
    eq('T5 · paid · still_to_pay · excess (the reversed challan does not count)', keys(c), { paid: undefined, still: 6000, excess: 0 });
    ok('T5 · the paid key is present and empty', !!c.paid_before_close_minor && Object.keys(c.paid_before_close_minor).length === 0, JSON.stringify(c.paid_before_close_minor));
  });

  await section('T5b · a challan reversed AFTER the close: the close and its stored answer stand; the replay carries the same paid and excess, never re-solved', async () => {
    const W = await world(true);
    const p = await W.pay('CH-T5b', 10000, '2026-11-09');
    const first = await W.close();
    await W.X.B.reverseEntry(W.X.db, SHOP, p.entry_id, { owner: true, reason: 'bank bounced' });
    const again = await W.close();
    ok('T5b · the replay is the same entry', again.ok === true && again.duplicate === true && again.entry_no === first.entry_no, JSON.stringify([again.duplicate, again.entry_no, first.entry_no]));
    eq('T5b · the replay answers the STORED paid · excess', [(again.paid_before_close_minor || {}).cgst_minor, (again.excess_paid_minor || {}).cgst_minor], [10000, 4000]);
    ok('T5b · the replay says the live payments no longer match the close (a mismatch note, not a silent re-solve)', typeof again.paid_note === 'string' && again.paid_note.length > 0, JSON.stringify(again.paid_note));
  });

  await section('T8 · a payment line in ANOTHER currency: the close still posts, the paid keys are omitted and paid_note says why (never a cross-currency sum)', async () => {
    const W = await world(true);
    await W.pay('CH-T8', 10000, '2026-11-09');
    W.X.T.lines.filter((l) => l.entry_id === poolOf(W, 'gstpay:CH-T8').entry_id).forEach((l) => { l.currency = 'USD'; l.txn_currency = 'USD'; });
    const c = await W.close();
    ok('T8 · the close posts', c.ok === true, JSON.stringify(c));
    ok('T8 · the three paid keys are omitted', c.paid_before_close_minor === undefined && c.still_to_pay_minor === undefined && c.excess_paid_minor === undefined, JSON.stringify(keys(c)));
    ok('T8 · paid_note says why, in words', typeof c.paid_note === 'string' && /currency/i.test(c.paid_note), JSON.stringify(c.paid_note));
    eq('T8 · no surplus is posted on a payment that could not be read', W.net('tax_advance_cgst'), 0);
  });

  await section('T8b · a LEGACY payment with no carried period (dated 5 Oct, September unclosed: two candidate periods): not counted, paid_note says so, the close posts, no surplus', async () => {
    const W = await world(true);
    const legacy = await W.X.B.postEntry(W.X.db, SHOP, { type: 'tax_payment', mode: 'bank', heads: { cgst: 60 }, date: '2026-10-05', currency: 'INR', ref: 'LEG-1', narration: 'Tax payment LEG-1', source_ref: 'gstpay:LEG-1' });
    ok('T8b · the legacy payment posts (no tax_period)', legacy && legacy.ok !== false, JSON.stringify(legacy));
    const c = await W.close();
    ok('T8b · the close posts', c.ok === true, JSON.stringify(c));
    ok('T8b · the paid keys are omitted and paid_note names the reason (an old payment with no period)', c.paid_before_close_minor === undefined && typeof c.paid_note === 'string' && c.paid_note.length > 0, JSON.stringify([keys(c), c.paid_note]));
    eq('T8b · no advance posted', W.net('tax_advance_cgst'), 0);
  });

  await section('T9 · a reverse-charge head: output 10000 · input 4000 · RCM owed 2000; one payment of CGST 6000 + RCM 2000 dated 20 Oct: utilised 4000 · payable 6000 · rcm 2000 · paid 6000 · still 0 · excess 0, every role back to 0', async () => {
    const W = await world(true);
    await W.journalMore([{ account: W.code.cash, dr: 20 }, { account: W.code.rcm_cgst, cr: 20 }], 'rcm', '2026-10-11');
    const p = await W.pay('CH-T9', 6000, '2026-10-20', { rcm: { cgst_minor: 2000 } });
    ok('T9 · the payment posts', p.ok === true, JSON.stringify(p));
    const c = await W.close();
    eq('T9 · set-off', figures(c), { utilised: 4000, payable: 6000 });
    eq('T9 · rcm owed stays 2000 in the answer', (c.rcm_minor || {}).cgst, 2000);
    eq('T9 · paid · still_to_pay · excess (forward charge)', keys(c), { paid: 6000, still: 0, excess: 0 });
    eq('T9 · ledger: output · input · rcm · advance', [W.net('output_cgst'), W.net('input_cgst'), W.net('rcm_cgst'), W.net('tax_advance_cgst')], [0, 0, 0, 0]);
  });

  await section('T10 · cross-head (Rule 88A order): IGST input 4000 against CGST output 10000; CGST 6000 paid dated 20 Oct: utilised IGST>CGST 4000 · payable 6000 · paid 6000 · still 0; output CGST 0 · input IGST 0', async () => {
    const W = await world(false);
    await W.journalMore([{ account: W.code.input_igst, dr: 40 }, { account: W.code.cash, cr: 40 }], 'igst', '2026-10-10');
    await W.pay('CH-T10', 6000, '2026-10-20');
    const c = await W.close();
    eq('T10 · set-off', figures(c), { utilised: 4000, payable: 6000 });
    eq('T10 · utilised is IGST against CGST', (c.utilised || []).map((u) => [u.from, u.against, u.amount_minor]), [['igst', 'cgst', 4000]]);
    eq('T10 · paid · still_to_pay · excess', keys(c), { paid: 6000, still: 0, excess: 0 });
    eq('T10 · ledger: output CGST · input IGST', [W.net('output_cgst'), W.net('input_igst')], [0, 0]);
  });

  await section('T11 · a payment ABOVE the period output, dated after it (12000 on 9 Nov, because November output 2000 is on the books): the add-back is signed: paid 12000 · excess 6000 · advance 6000; the November output survives (net credit 2000)', async () => {
    const W = await world(true);
    await W.journalMore([{ account: W.code.cash, dr: 20 }, { account: W.code.output_cgst, cr: 20 }], 'nov', '2026-11-05');
    const p = await W.pay('CH-T11', 12000, '2026-11-09');
    ok('T11 · the 12000 payment posts (today owes 12000)', p.ok === true, JSON.stringify(p));
    const c = await W.close();
    eq('T11 · set-off (November output is not in October)', figures(c), { utilised: 4000, payable: 6000 });
    eq('T11 · paid · still_to_pay · excess', keys(c), { paid: 12000, still: 0, excess: 6000 });
    eq('T11 · ledger: output · input · advance', [W.net('output_cgst'), W.net('input_cgst'), W.net('tax_advance_cgst')], [-2000, 0, 6000]);
  });

  await section('T12 · a LATER period\'s output is not eaten: close September with 10000 out / 4000 in / 10000 paid on 9 Oct, October output 2000 already posted: utilised 4000 · excess 4000 · output net credit 2000 · advance 4000', async () => {
    const W = await world(true, { period: 6, day: '2026-09-10' });
    await W.journalMore([{ account: W.code.cash, dr: 20 }, { account: W.code.output_cgst, cr: 20 }], 'oct', '2026-10-05');
    await W.pay('CH-T12', 10000, '2026-10-09');
    const c = await W.close();
    eq('T12 · set-off', figures(c), { utilised: 4000, payable: 6000 });
    eq('T12 · paid · still_to_pay · excess', keys(c), { paid: 10000, still: 0, excess: 4000 });
    eq('T12 · ledger: output · advance', [W.net('output_cgst'), W.net('tax_advance_cgst')], [-2000, 4000]);
  });

  await section('T16 · the NEXT period: after the September close of T12 (advance 4000), October output 5000 and input 3000 are closed: utilised 3000 · payable 2000 · advance stays 4000 (never input credit, never eaten)', async () => {
    const W = await world(true, { period: 6, day: '2026-09-10' });
    await W.pay('CH-T16', 10000, '2026-10-09');
    const sept = await W.close();
    eq('T16 · September: advance 4000', [sept.ok, W.net('tax_advance_cgst')], [true, 4000]);
    await W.journalMore([{ account: W.code.cash, dr: 50 }, { account: W.code.output_cgst, cr: 50 }], 'o-out', '2026-10-12');
    await W.journalMore([{ account: W.code.input_cgst, dr: 30 }, { account: W.code.cash, cr: 30 }], 'o-in', '2026-10-12');
    const oct = await W.BP.gstClose(SHOP, W.setting, { fy: FY, period: OCTOBER }, SHOP);
    eq('T16 · October set-off', figures(oct), { utilised: 3000, payable: 2000 });
    eq('T16 · ledger after: output (2000 owed) · input · advance (untouched)', [W.net('output_cgst'), W.net('input_cgst'), W.net('tax_advance_cgst')], [-2000, 0, 4000]);
  });

  await section('T19 · a period closed BEFORE this change is never backfilled: a legacy set-off entry stands, a payment naming it later posts NO surplus, the replay answers duplicate with a note, nothing new is written', async () => {
    const W = await world(true);
    const legacy = await W.X.B.postEntry(W.X.db, SHOP, { type: 'tax_setoff', date: '2026-10-31', currency: 'INR', ref: 'GSTSO-2026-27-P07', period: undefined, output: { cgst: 100 }, input: { cgst: 40 }, narration: 'Tax set-off', source_ref: 'gstclose:2026-27:7' });
    ok('T19 · the legacy close posts', legacy && legacy.ok !== false, JSON.stringify(legacy));
    await W.pay('CH-T19', 6000, '2026-11-09');
    const before = entriesOf(W).length;
    const again = await W.close();
    ok('T19 · the close answers as a duplicate', again.ok === true && again.duplicate === true, JSON.stringify(again));
    eq('T19 · nothing new is written (no surplus, no backfill)', entriesOf(W).length, before);
    eq('T19 · no advance posted', W.net('tax_advance_cgst'), 0);
    ok('T19 · the answer says this period was closed before payments were tracked (paid_note), no paid keys invented', typeof again.paid_note === 'string' && again.paid_note.length > 0 && again.paid_before_close_minor === undefined, JSON.stringify([again.paid_note, keys(again)]));
  });

  await section('T13 · concurrent pay + close under the head lock, BOTH orders: pay first then close = K3 (paid 6000, still 0); close first then pay = paid {} · still 6000 and the pay is 200; both end output 0 · advance 0, never below zero', async () => {
    for (const order of ['pay-first', 'close-first']) {
      const W = await world(true);
      const held = new Map();
      W.X.store.lockTaxHeads = async (db, e, heads) => {
        const key = e + '|gst';
        while (held.has(key) && held.get(key).owner !== db) await held.get(key).done;
        if (!held.has(key)) { let release; const done = new Promise((r) => { release = r; }); held.set(key, { owner: db, done, release }); db.__locks.push(key); }
      };
      W.X.dbStub.withEntity = async (e, fn) => {
        const handle = Object.create(W.X.db); handle.__locks = [];
        try { return await fn(handle); } finally { handle.__locks.forEach((k) => { const h = held.get(k); if (h && h.owner === handle) { held.delete(k); h.release(); } }); }
      };
      const doPay = () => W.pay('CH-T13-' + order, 6000, '2026-11-09'), doClose = () => W.close();
      const [a, b] = order === 'pay-first' ? [doPay(), doClose()] : [doClose(), doPay()];
      const [first, second] = await Promise.all([a, b]);
      const paid = order === 'pay-first' ? first : second, closed = order === 'pay-first' ? second : first;
      ok(order + ' · both answer 200/ok', paid.ok === true && closed.ok === true, JSON.stringify([paid, closed]));
      eq(order + ' · the close paid · still_to_pay', [(closed.paid_before_close_minor || {}).cgst_minor, (closed.still_to_pay_minor || {}).cgst_minor], order === 'pay-first' ? [6000, 0] : [undefined, 6000]);
      eq(order + ' · ledger: output · input · advance', [W.net('output_cgst'), W.net('input_cgst'), W.net('tax_advance_cgst')], [0, 0, 0]);
    }
  });

  await section('NAMES · the close answer separates two meanings: owed_before_payments_minor (+ total) = the period\'s own set-off; still_to_pay_minor (+ still_to_pay_total_minor) = after the payments named for it; payable_minor/pay_total_minor stay as the before-payments aliases', async () => {
    const W = await world(true);
    await W.pay('CH-N', 10000, '2026-10-20');
    const c = await W.close();
    eq('NAMES · owed_before_payments_minor.cgst_minor · total', [(c.owed_before_payments_minor || {}).cgst_minor, c.owed_before_payments_total_minor], [6000, 6000]);
    eq('NAMES · still_to_pay_total_minor (what a pay form may ask for)', c.still_to_pay_total_minor, 0);
    eq('NAMES · the old keys equal the before-payments meaning', [(c.payable_minor || {}).cgst_minor, c.pay_total_minor], [6000, 6000]);
  });

  /* ═══ the second critic's MUSTs (plan section 4.7) and the dated-surplus SHOULD ═══ */
  const TODO = require(path.join(H.API, 'lib', 'books-todo'));
  const gstRow = async (W) => (await TODO.todo(SHOP, W.setting, '2026-11-12')).find((row) => row.kind === 'gst_due') || null;

  await section('R1 · a CLOSED month answers stored still_to_pay less the payments named for it since (paid_since_close): close (still 6000), then pay 6000 → the replay and the Todo owe 0', async () => {
    const W = await world(true);
    const first = await W.close();
    eq('R1 · close: still_to_pay_total_minor 6000', first.still_to_pay_total_minor, 6000);
    const row = await gstRow(W);
    eq('R1 · the Todo before paying names October with 6000 owed', row && row.items[0].owed_minor, 6000);
    const p = await W.pay('CH-R1', 6000, '2026-11-09');
    ok('R1 · the 6000 payment posts', p.ok === true, JSON.stringify(p));
    const again = await W.close();
    ok('R1 · the replay is the same entry', again.duplicate === true && again.entry_no === first.entry_no, JSON.stringify([again.duplicate, again.entry_no, first.entry_no]));
    eq('R1 · the replay: still_to_pay_total 0 · paid_since_close 6000 · the stored paid stays {}', [again.still_to_pay_total_minor, (again.paid_since_close_minor || {}).cgst_minor, Object.keys(again.paid_before_close_minor || { x: 1 }).length], [0, 6000, 0]);
    eq('R1 · the Todo after paying has no GST row (it never re-asks for money)', await gstRow(W), null);
  });

  await section('R2 · an UNCLOSED month reads the payments it NAMES, not their dates: a challan dated 9 Nov (after October ended) for October is counted by the Todo before the close: owes 0 (output 10000 − credit 4000 − paid 6000)', async () => {
    const W = await world(true);
    await W.pay('CH-R2', 6000, '2026-11-09');
    eq('R2 · the Todo has no GST row', await gstRow(W), null);
    const W2 = await world(true);
    eq('R2b · with nothing paid the Todo owes 6000, the set-off already applied (credit first), not the gross 10000', (await gstRow(W2) || { items: [{}] }).items[0].owed_minor, 6000);
  });

  await section('R3 · K2 ledger AS AT 31 Oct: the surplus is dated the later of span.end and the last named payment (20 Oct → 31 Oct), so on 31 Oct output CGST is 0 and the advance holds 4000; K1 (paid 9 Nov) is dated 9 Nov', async () => {
    const asAt = (W, role, day) => {
      const acc = W.X.T.accounts.find((a) => a.entity_id === SHOP && a.role === role);
      return W.X.T.lines.filter((l) => l.account_id === acc.account_id && String(W.X.T.entries.find((h) => h.entry_id === l.entry_id).posting_date).slice(0, 10) <= day).reduce((t, l) => t + (l.dr_minor || 0) - (l.cr_minor || 0), 0);
    };
    const W = await world(true);
    await W.pay('CH-R3', 10000, '2026-10-20');
    await W.close();
    eq('R3 · K2 as at 31 Oct: output · input · advance', [asAt(W, 'output_cgst', '2026-10-31'), asAt(W, 'input_cgst', '2026-10-31'), asAt(W, 'tax_advance_cgst', '2026-10-31')], [0, 0, 4000]);
    const V = await world(true);
    await V.pay('CH-R3b', 10000, '2026-11-09');
    await V.close();
    eq('R3 · K1 as at 31 Oct: output credit 6000 (the payment is not yet made), advance 0', [asAt(V, 'output_cgst', '2026-10-31'), asAt(V, 'tax_advance_cgst', '2026-10-31')], [-6000, 0]);
    eq('R3 · K1 as at 9 Nov: output 0, advance 4000', [asAt(V, 'output_cgst', '2026-11-09'), asAt(V, 'tax_advance_cgst', '2026-11-09')], [0, 4000]);
  });

  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed\n');
  process.exit(fail ? 1 : 0);
})();
