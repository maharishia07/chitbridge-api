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
async function world(withInput) {
  const X = H.load();
  await X.B.enable(X.db, SHOP, {});
  const code = {};
  X.T.accounts.filter((a) => a.entity_id === SHOP).forEach((a) => { code[a.role] = a.code; });
  const journal = (lines, ref) => X.B.postEntry(X.db, SHOP, { type: 'manual', owner: true, date: '2026-10-10', currency: 'INR', narration: 'GST ' + ref, source_ref: 'k:' + ref, lines });
  const o = await journal([{ account: code.cash, dr: 100 }, { account: code.output_cgst, cr: 100 }], 'out');
  if (!o || o.ok === false) throw new Error('output journal refused: ' + JSON.stringify(o));
  if (withInput) await journal([{ account: code.input_cgst, dr: 40 }, { account: code.cash, cr: 40 }], 'in');
  const BP = require(path.join(H.API, 'lib', 'books-period'));
  const setting = await X.store.setting(X.db, SHOP);
  const pay = (challan, cgst, date) => BP.gstPay(SHOP, setting, { fy: FY, period: OCTOBER, amounts: { cgst_minor: cgst }, bank: 'bank', challan_no: challan, date }, SHOP);
  const close = () => BP.gstClose(SHOP, setting, { fy: FY, period: OCTOBER }, SHOP);
  /** a role's net, debit positive, from the stored lines (read only) */
  const net = (role) => { const acc = X.T.accounts.find((a) => a.entity_id === SHOP && a.role === role); return acc ? X.T.lines.filter((l) => l.entity_id === SHOP && l.account_id === acc.account_id).reduce((t, l) => t + (l.dr_minor || 0) - (l.cr_minor || 0), 0) : null; };
  return { X, pay, close, net, code };
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

  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed\n');
  process.exit(fail ? 1 : 0);
})();
