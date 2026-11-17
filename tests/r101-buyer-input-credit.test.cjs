/**
 * tests/r101-buyer-input-credit.test.cjs — ACC-355 / R1-01 (DEC-267): A BUYER WHO MAY NOT CLAIM THE INPUT TAX, decided at the ONE writer.
 *   The gate is lib/books-buyer-credit.gate, called by lib/books composeEntry, so postEntry AND previewEntry meet it for every door (chit bill, chit expense, bank line tax,
 *   manual bill, recurring entry, card-settlement fee). No door keeps a copy. regular / nothing read → the credit is claimed, as before · unregistered / composition → the engine
 *   (v1.99.0 input_credit:false, on bills, supplier returns AND expenses) folds the tax into the cost · unknown + input tax → the posting WAITS with the question
 *   (TAX_REGISTRATION_UNKNOWN, refused: true, nothing posted); no tax on it → posts. A supplier return follows the ORIGINAL bill (followOriginal), never today's registration.
 *   Hand figures (major units): AU 100.00 + 10.00 GST · AE 1,000 + 50 VAT · IN 1,000 + CGST 90 + SGST 90 · AU expense 100 + 10 GST paid from cash.
 *   Door shapes, one case each, AU/AE/IN × registered / unregistered / unknown. Run: node tests/r101-buyer-input-credit.test.cjs  (CB_ENGINES_DIR = the engines worktree)   CARD 14-accounting (R1-01)
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SUPP = '33333333-3333-4333-8333-333333333333';
const SHOP = { AU: 'aaaaaaaa-1111-4111-8111-111111111111', AE: 'eeeeeeee-1111-4111-8111-111111111111', IN: '11111111-1111-4111-8111-111111111111' };
const CUR = { AU: 'AUD', AE: 'AED', IN: 'INR' };
/** the tax rows by door: the pack's own heads */
const RATE = { AU: { rate: 10, taxable: 100, gst: 10 }, AE: { rate: 5, taxable: 1000, vat: 50 }, IN: { rate: 18, taxable: 1000, cgst: 90, sgst: 90 } };
const INPUT_TAX = { AU: { rate: 10, gst: 10 }, AE: { rate: 5, vat: 5 }, IN: { rate: 18, cgst: 9, sgst: 9 } };
const INPUT_ROLES = { AU: ['gst_paid'], AE: ['input_vat'], IN: ['input_cgst', 'input_sgst'] };

(async () => {
  console.log('\n== ACC-355: the buyer who may not claim the tax, at the one writer ==\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const CS = require(path.join(H.API, 'lib', 'country-setup'));
  const BC = require(path.join(H.API, 'lib', 'books-buyer-credit'));
  let REG = 'regular';
  CS.registrationOfShop = async () => REG;
  const net = (rows, roles) => Math.round(100 * rows.filter((l) => roles.includes(l.role)).reduce((s, l) => s + l.dr_minor / 100 - l.cr_minor / 100, 0)) / 100;
  const linesOf = (entryId) => X.T.lines.filter((l) => l.entry_id === entryId);
  const costRoles = { bill: ['purchases'], exp: ['rent'] };

  for (const c of ['AU', 'AE', 'IN']) {
    const shop = SHOP[c];
    await X.store.saveSetting(X.db, shop, { enabled: true, country: c, functional_currency: CUR[c], walkin_grain: 'day' });
    await X.B.enable(X.db, shop, { country: c }).catch(() => null);
    X.T.parties.push({ owner: shop, party_id: SUPP, party_no: 'P-1', name: 'Supplier', supplier: true, credit_days: 30 });
    let n = 0;
    const bill = (extra) => X.B.postEntry(X.db, shop, Object.assign({ type: 'purchase_bill', ref: 'B' + (++n), date: '2026-11-12', currency: CUR[c], party: SUPP, by_rate: [RATE[c]], paid: {}, round_off: 0, source_ref: c + ':b' + n }, extra));
    const expense = (extra) => X.B.postEntry(X.db, shop, Object.assign({ type: 'expense', ref: 'E' + (++n), date: '2026-11-12', currency: CUR[c], class: 'rent', amount: 100, paid_from: 'cash', input_tax: INPUT_TAX[c], source_ref: c + ':e' + n }, extra));
    const cost = c === 'IN' ? 1180 : c === 'AE' ? 1050 : 110;
    const claimedCost = c === 'IN' ? 1000 : c === 'AE' ? 1000 : 100;
    const taxOf = c === 'IN' ? 180 : c === 'AE' ? 50 : 10;

    console.log('\n— ' + c + ' —');
    REG = 'regular';
    let r = await bill();
    ok(c + ' registered: the bill keeps the credit (control)', r.ok && net(linesOf(r.entry_id), INPUT_ROLES[c]) === taxOf && net(linesOf(r.entry_id), costRoles.bill) === claimedCost, JSON.stringify(r));
    REG = 'unregistered';
    r = await bill();
    eq(c + ' unregistered: bill → Dr purchases ' + cost + ', no input tax (golden journal)', [net(linesOf(r.entry_id), costRoles.bill), net(linesOf(r.entry_id), INPUT_ROLES[c])], [cost, 0]);
    r = await expense();
    const expenseNet = c === 'IN' ? 118 : c === 'AE' ? 105 : 110;
    eq(c + ' unregistered: chit / bank / manual / recurring expense door (one event) → Dr rent ' + expenseNet + ', no input tax', [net(linesOf(r.entry_id), costRoles.exp), net(linesOf(r.entry_id), INPUT_ROLES[c])], [expenseNet, 0]);
    REG = 'unknown';
    let refused = null;
    try { await bill(); } catch (e) { refused = e; }
    ok(c + ' unknown + tax: the bill WAITS (refused, code TAX_REGISTRATION_UNKNOWN, with the question)', !!refused && refused.refused === true && refused.code === 'TAX_REGISTRATION_UNKNOWN' && /registered for/.test(refused.message) && /posts then/.test(refused.message), refused && refused.message);
    refused = null;
    try { await expense(); } catch (e) { refused = e; }
    ok(c + ' unknown + typed tax: the expense WAITS too', !!refused && refused.code === 'TAX_REGISTRATION_UNKNOWN');
    r = await expense({ input_tax: undefined });
    ok(c + ' unknown + NO tax: the expense posts (nothing to claim, no flood of the queue)', r.ok === true && net(linesOf(r.entry_id), costRoles.exp) === 100, JSON.stringify(r));
    r = await bill({ by_rate: [{ rate: 0, taxable: 100 }] });
    ok(c + ' unknown + a bill with no tax: posts', r.ok === true);
    REG = 'composition';
    r = await bill();
    eq(c + ' composition: no credit either', [net(linesOf(r.entry_id), costRoles.bill), net(linesOf(r.entry_id), INPUT_ROLES[c])], [cost, 0]);
    REG = 'regular'; /* a shop that answers yes: the waiting bill now posts, once */
    r = await bill({ source_ref: c + ':late' });
    const again = await bill({ source_ref: c + ':late' });
    ok(c + ' a "yes" lets the waiting bill post once (a repeat of its source is the same entry)', r.ok && again.duplicate === true && again.entry_id === r.entry_id);
    REG = 'unregistered';
    const prev = await X.B.previewEntry(X.db, shop, { type: 'purchase_bill', ref: 'PV', date: '2026-11-12', currency: CUR[c], party: SUPP, by_rate: [RATE[c]], paid: {}, round_off: 0 }).catch((e) => ({ err: e }));
    ok(c + ' the preview meets the same gate (the figures the writer would post)', prev && !prev.err, prev && prev.err && prev.err.message);
  }

  console.log('\n— AU: the card-settlement fee tax and the supplier return, by the same flag —');
  REG = 'unregistered';
  const au = SHOP.AU;
  const fee = await X.B.postEntry(X.db, au, { type: 'contra', ref: 'C1', date: '2026-11-12', currency: 'AUD', from: 'card', to: 'bank', amount: 980, fee: 18, fee_input_tax: { rate: 10, gst: 2 }, source_ref: 'au:contra' });
  eq('unregistered: the fee GST folds into bank_charges (20.00), no gst_paid', [net(linesOf(fee.entry_id), ['bank_charges']), net(linesOf(fee.entry_id), ['gst_paid'])], [20, 0]);
  const ret = (extra) => X.B.postEntry(X.db, au, Object.assign({ type: 'purchase_return', ref: 'R', date: '2026-11-13', currency: 'AUD', party: SUPP, by_rate: [{ rate: 10, taxable: 100, gst: 10 }], source_ref: 'au:r' + Math.random() }, extra));
  REG = 'regular';
  let rr = await ret({ input_credit: false });
  eq('a supplier return of a no-credit bill (explicit false, shop registered NOW) reverses no input tax', net(linesOf(rr.entry_id), ['gst_paid']), 0);
  REG = 'unregistered';
  rr = await ret({ input_credit: true });
  eq('a supplier return of a credit-taking bill (explicit true, shop unregistered NOW) still reverses the input tax: -10.00', net(linesOf(rr.entry_id), ['gst_paid']), -10);

  console.log('\n— lib/books-buyer-credit.js, one rule at a time —');
  eq('carriesInputTax: expense with input_tax · bill with a tax head · contra with fee_input_tax → true; none, text, blank → false', [
    BC.carriesInputTax({ type: 'expense', input_tax: { gst: 10 } }, ['gst']), BC.carriesInputTax({ type: 'purchase_bill', by_rate: [{ taxable: 100, gst: 10 }] }, ['gst']), BC.carriesInputTax({ type: 'contra', fee_input_tax: { gst: 2 } }, ['gst']),
    BC.carriesInputTax({ type: 'expense' }, ['gst']), BC.carriesInputTax({ type: 'expense', input_tax: { gst: 'abc', x: '' } }, ['gst']), BC.carriesInputTax({ type: 'sale_bill', by_rate: [{ gst: 10 }] }, ['gst'])
  ], [true, true, true, false, false, false]);
  eq('stance: unknown + tax waits; unknown + no tax posts; nothing read claims; regular claims', [!!BC.stanceOf('unknown', 'AU', 'B-1', true).wait, BC.stanceOf('unknown', 'AU', 'B-1', false), BC.stanceOf(null, 'AU', 'B-1', true), BC.stanceOf('regular', 'AU', 'B-1', true)], [true, {}, {}, {}]);
  const Store = require(path.join(H.API, 'lib', 'books-store'));
  const realBySource = Store.entryBySource, realDebits = Store.entryDebitsByRole;
  const debitsOf = { e1: [{ role: 'purchases' }], e2: [{ role: 'input_cgst' }, { role: 'purchases' }], e3: [{ role: 'gst_paid' }] };
  Store.entryBySource = async (db, e, ref) => (ref === 'chit:a' ? { entry_id: 'e1' } : ref === 'chit:b:use' ? { entry_id: 'e2' } : ref === 'chit:c' ? { entry_id: 'e3' } : null);
  Store.entryDebitsByRole = async (db, e, id) => debitsOf[id];
  try {
    eq('tookNoCredit: no input-tax debit → true · a part that debited input_cgst → false · gst_paid → false · no entry → null', [await BC.tookNoCredit(null, 'me', ['chit:a']), await BC.tookNoCredit(null, 'me', ['chit:a', 'chit:b:use']), await BC.tookNoCredit(null, 'me', ['chit:c']), await BC.tookNoCredit(null, 'me', ['chit:zz'])], [true, false, false, null]);
    const run = (against, event) => BC.followOriginal((e, fn) => fn(null), 'me', { against: { chit_id: against } }, { kind: 'post', event });
    eq('followOriginal: original took no credit → input_credit:false; took credit → true; no entry → verdict untouched; not a purchase_return → untouched', [
      (await run('a', { type: 'purchase_return' })).event.input_credit, (await run('c', { type: 'purchase_return' })).event.input_credit, (await run('zz', { type: 'purchase_return' })).event.input_credit, (await run('a', { type: 'expense' })).event.input_credit
    ], [false, true, undefined, undefined]);
  } finally { Store.entryBySource = realBySource; Store.entryDebitsByRole = realDebits; }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n\n' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
