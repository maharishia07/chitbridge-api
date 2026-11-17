/**
 * tests/banknew-refund-readers.test.cjs — BANK-new-9/10 (critic 18 Nov 2026, item 4): the api readers keyed on the event type must read the engines' new `side`
 * (payment_received side 'payable' = a refund from a supplier: Dr bank · Cr creditors; payment_made side 'receivable' = a refund to a customer: Dr debtors · Cr bank).
 *   1. lib/books.js BILL_KIND: a + party line from a payment event is a refund document: never a due date from the party's credit days (30 here), never kind 'debit_note'.
 *   2. lib/dues-view.js SALES_EVENTS: a payment_received whose entry holds a creditors line is PURCHASE money: a cost-blind reader gets it with null dr/cr (SEC-119 fail closed); a customer's receipt stays.
 *   3. lib/fx-rates.js SETTLES: a foreign payment whose side is not the one its type settles is refused in words, never settled on the other control.
 *   4. the engine's event passes through composeEntry with `side` kept (the entry says Cr creditors).
 * Hand figures: A$110.00 = 11000 minor. Needs the books engines with the `side` widening (CB_ENGINES_DIR or the sibling). Run: node tests/banknew-refund-readers.test.cjs
 * CARD 14-accounting
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = '44444444-4444-4444-8444-444444444444', DAIRY = '55555555-5555-4555-8555-555555555555', SMITH = '66666666-6666-4666-8666-666666666666';

(async () => {
  const X = H.load();
  if (!X.src.dir) { console.log('SKIP: ' + X.src.why); process.exit(1); }
  const { B, T, db } = X;
  require(path.join(H.API, 'lib', 'shop-clock')).set('2026-11-20T06:00:00Z');
  T.parties.push({ owner: SHOP, party_id: DAIRY, name: 'Dairy Co', supplier: true, credit_days: 30 }, { owner: SHOP, party_id: SMITH, name: 'Smith Pty', customer: true, credit_days: 30 });
  await B.enable(db, SHOP, { by: SHOP, today: '2026-10-01', country: 'AU' });
  const ev = (type, party, extra) => Object.assign({ type, party, mode: 'bank', amount: 110, currency: 'AUD', date: '2026-10-15', source_ref: 'bank:' + type + ':' + party, ref: 'R-' + type + party.slice(0, 2) }, extra);

  /* 4 + 1: the supplier refund */
  const sup = await B.postEntry(db, SHOP, ev('payment_received', DAIRY, { side: 'payable' }));
  ok('4 | the supplier refund posts', sup && sup.ok, JSON.stringify(sup));
  const sl = T.lines.filter((l) => l.entry_id === sup.entry_id);
  eq('4 | Dr bank 11000 · Cr creditors [Dairy] 11000, no debtors line', sl.map((l) => [l.role, l.dr_minor, l.cr_minor, l.party_id || null]).sort(), [['bank', 11000, 0, null], ['creditors', 0, 11000, DAIRY]].sort());
  const sItem = T.items.filter((i) => i.entry_id === sup.entry_id && i.party_id === DAIRY);
  ok('1 | the refund is one document of the supplier, not kind debit_note', sItem.length === 1 && sItem[0].kind !== 'debit_note', JSON.stringify(sItem));
  ok('1 | and it has no due date from the supplier\'s 30 credit days (due = its own day or none)', sItem.every((i) => !i.due_date || String(i.due_date).slice(0, 10) <= '2026-10-15'), JSON.stringify(sItem.map((i) => i.due_date)));

  /* the customer refund */
  const cus = await B.postEntry(db, SHOP, ev('payment_made', SMITH, { side: 'receivable' }));
  ok('4 | the customer refund posts', cus && cus.ok, JSON.stringify(cus));
  const cl = T.lines.filter((l) => l.entry_id === cus.entry_id);
  eq('4 | Dr debtors [Smith] 11000 · Cr bank 11000, no creditors line', cl.map((l) => [l.role, l.dr_minor, l.cr_minor, l.party_id || null]).sort(), [['bank', 0, 11000, null], ['debtors', 11000, 0, SMITH]].sort());
  const cItem = T.items.filter((i) => i.entry_id === cus.entry_id && i.party_id === SMITH);
  ok('1 | the customer refund is not kind debit_note and has no credit-days due date', cItem.length === 1 && cItem[0].kind !== 'debit_note' && (!cItem[0].due_date || String(cItem[0].due_date).slice(0, 10) <= '2026-10-15'), JSON.stringify(cItem));

  /* 2: the cost-blind day book (the cost-blind leak, its own test) */
  const DV = require(path.join(H.API, 'lib', 'dues-view'));
  const DB = require(path.join(H.API, 'lib', 'books-daybook'));
  const rows = (entryId, evt) => T.lines.filter((l) => l.entry_id === entryId).map((l) => ({ entry_id: entryId, entry_no: 1, posting_date: '2026-10-15', doc_date: '2026-10-15', event_type: evt, narration: 'x', line_no: l.line_no, code: l.code, account_name: l.role, account_role: l.role, party_id: l.party_id, dr_minor: l.dr_minor, cr_minor: l.cr_minor, currency: 'AUD' }));
  const day = (entryId, evt) => DV.blindBooks('daybook', { entries: DB.entriesOf(rows(entryId, evt), new Map(), false), totals: null });
  const supDay = day(sup.entry_id, 'payment_received').entries[0];
  ok('2 | the supplier refund (payment_received with a creditors line): amounts null for a cost-blind reader', supDay.lines.every((l) => l.dr_minor === null && l.cr_minor === null), JSON.stringify(supDay.lines));
  const receipt = await B.postEntry(db, SHOP, ev('payment_received', SMITH, { ref: 'R-RCV' }));
  const rcvDay = day(receipt.entry_id, 'payment_received').entries[0];
  ok('2 | a customer\'s receipt (debtors line) stays visible', rcvDay.lines.some((l) => l.dr_minor === 11000) && rcvDay.lines.some((l) => l.cr_minor === 11000), JSON.stringify(rcvDay.lines));
  ok('2 | the day book entry carries the role of each line', rcvDay.lines.every((l) => typeof l.role === 'string'), JSON.stringify(rcvDay.lines));
  ok('2 | a customer refund (payment_made) stays hidden as every payment_made is', day(cus.entry_id, 'payment_made').entries[0].lines.every((l) => l.dr_minor === null), '');

  /* 3: a foreign payment on the other side is refused */
  const FX = require(path.join(H.API, 'lib', 'fx-rates'));
  const chart = { byRole: new Map([['debtors', { account_id: 'D' }], ['creditors', { account_id: 'C' }]]) };
  T.fxRates.push({ rate_id: 1, entity_id: SHOP, from_ccy: 'USD', to_ccy: 'AUD', rate_date: '2026-10-15', rate: '1.5', source: 'manual' });
  let words = null;
  try { await FX.forEvent(db, SHOP, ev('payment_received', DAIRY, { currency: 'USD', side: 'payable' }), 'AUD', '2026-10-15', chart); } catch (e) { words = e.message; }
  ok('3 | a USD supplier refund (payment_received side payable) is refused in words, not settled on debtors', !!words && !/no open USD bill/.test(words) && /refund|side|own entry/i.test(words), String(words));
  words = null;
  try { await FX.forEvent(db, SHOP, ev('payment_made', SMITH, { currency: 'USD', side: 'receivable' }), 'AUD', '2026-10-15', chart); } catch (e) { words = e.message; }
  ok('3 | a USD customer refund (payment_made side receivable) is refused in words, not settled on creditors', !!words && !/no open USD bill/.test(words) && /refund|side|own entry/i.test(words), String(words));
  words = null;
  try { await FX.forEvent(db, SHOP, ev('payment_received', SMITH, { currency: 'USD' }), 'AUD', '2026-10-15', chart); } catch (e) { words = e.message; }
  ok('3 | unchanged: no side = settles the customer\'s USD bill (here: none open, said so)', /no open USD bill/i.test(String(words)), String(words));

  /* 5: the chain, each CONTROL account read from the trial balance (not the party net): bill, payment, credit note, refund -> creditors 0 and debtors 0 for it (a second supplier / customer, own figures: A$110.00) */
  const SUP2 = '77777777-7777-4777-8777-777777777777', CUS2 = '88888888-8888-4888-8888-888888888888';
  T.parties.push({ owner: SHOP, party_id: SUP2, name: 'Chain Supplies', supplier: true, credit_days: 30 }, { owner: SHOP, party_id: CUS2, name: 'Chain Customer', customer: true, credit_days: 30 });
  const rate = [{ rate: 10, taxable: 100 }], at = { date: '2026-10-20', currency: 'AUD' };
  const controls = async () => { const tb = await B.trialBalance(db, SHOP, '2026-11-30'); const roleOf = new Map(T.accounts.map((a) => [String(a.code), a.role])); const out = { debtors: 0, creditors: 0 }; (tb.rows || tb.accounts || []).forEach((r) => { if (r.role in out) out[r.role] += Number(r.debit_minor || 0) - Number(r.credit_minor || 0); }); return out; };
  const before = await controls();
  await B.postEntry(db, SHOP, Object.assign({ type: 'purchase_bill', party: SUP2, by_rate: rate, source_ref: 'chain:pb', ref: 'CH-PB' }, at));
  await B.postEntry(db, SHOP, Object.assign({ type: 'payment_made', party: SUP2, mode: 'bank', amount: 110, source_ref: 'chain:pm', ref: 'CH-PM' }, at));
  await B.postEntry(db, SHOP, Object.assign({ type: 'purchase_return', party: SUP2, by_rate: rate, source_ref: 'chain:pr', ref: 'CH-PR' }, at));
  const mid = await controls();
  ok('5 | after bill, payment, credit note the supplier owes us A$110: creditors Dr 11000 (carried TB read)', mid.creditors - before.creditors === 11000, JSON.stringify([before, mid]));
  await B.postEntry(db, SHOP, Object.assign({ type: 'payment_received', side: 'payable', party: SUP2, mode: 'bank', amount: 110, source_ref: 'chain:rf', ref: 'CH-RF' }, at));
  await B.postEntry(db, SHOP, Object.assign({ type: 'sale_bill', party: CUS2, by_rate: rate, paid: {}, source_ref: 'chain:sb', ref: 'CH-SB', source_chit_id: 'c0000000-0000-4000-8000-0000000000c1' }, at));
  await B.postEntry(db, SHOP, Object.assign({ type: 'payment_received', party: CUS2, mode: 'bank', amount: 110, source_ref: 'chain:rc', ref: 'CH-RC' }, at));
  await B.postEntry(db, SHOP, Object.assign({ type: 'credit_note', party: CUS2, by_rate: rate, source_ref: 'chain:cn', ref: 'CH-CN' }, at));
  await B.postEntry(db, SHOP, Object.assign({ type: 'payment_made', side: 'receivable', party: CUS2, mode: 'bank', amount: 110, source_ref: 'chain:cr', ref: 'CH-CR' }, at));
  const after = await controls();
  eq('5 | after both refunds BOTH control accounts are back to where they were: creditors 0 and debtors 0 change (read from the trial balance)', [after.creditors - before.creditors, after.debtors - before.debtors], [0, 0]);
  console.log('\n  ' + (fail ? '✗' : '✓') + ' ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('THREW', e && e.stack || e); process.exit(1); });
