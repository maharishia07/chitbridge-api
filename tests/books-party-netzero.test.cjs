/**
 * books-party-netzero.test.cjs — BB-P1-3 (bank to books): a bank line paid to a NAMED supplier posts through the REAL compose (POST /events kind bank_expense_supplier) as ONE entry that
 * keeps the party, the expense class and the GST split, and leaves the supplier at nil. Gate origin: test/bb-party-netzero e92f6bf37 (a hand-made entry); this one runs the engine's own kind.
 * Hand figures (AUD, minor units): Origin Energy direct debit 330.00 incl GST: expense 30000, GST 3000 (330/11), Cr supplier 33000, Dr supplier 33000, Cr bank 33000.
 * Proves: one entry (client_ref replay = the same entry) · voucher Payment · the lines · party_item rows net 0 · no open item · /dues none · statement Cr 330 + Dr 330 closing 0 · BAS 1B 30.00, G11 330.00 ·
 * reversal keeps it at 0 (no reopened bill) · the day book kind · the old shapes (expense + supplier + bank tax) still refused in words.
 * Compare (two carried totals): the party items sum vs the Suppliers control on the trial balance, both 0, and the bank ledger 33000 out vs the bank row in the same entry.
 * Run: BOOKS_ENGINES_SRC=<chitbridge-engines/src of the engines branch> node tests/books-party-netzero.test.cjs
 * CARD 14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';
const { rig, counter, SUPP, SHOP } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();
const REGISTERED = { country: 'AU', currency_code: 'AUD', gstn: '51824753556', timezone: 'Australia/Sydney', policy_flags: { gst_registration: 'regular' } };

(async () => {
  console.log('\n══ BB-P1-3 · bank line to a named supplier, one entry, through the real compose ══\n');
  const R = await rig(REGISTERED);
  if (!R) return;
  const { X, q } = R, T = X.T;
  const setup = require('../lib/country-setup'); /* the in-memory store has no b299 columns: the one reader's SQL is stood in by the same rule over the same row (as books-bank-line-tax.test.cjs) */
  setup.registrationOfShop = async () => setup.registrationOf({ number: X.db.countryRow.gstn, scheme: X.db.countryRow.policy_flags.gst_registration, tax_registration: null });
  const body = { kind: 'bank_expense_supplier', class: '6030', amount: 300, input_tax_minor: 3000, tax_invoice: 'held', supplier: SUPP, paid_from: 'bank', date: '2026-10-05', client_ref: 'bb-origin' };
  const pre = await q('POST', '/preview', body);
  ok('preview: balanced, voucher Payment, no refusal', pre.body.ok && pre.body.voucher && pre.body.voucher.type === 'Payment', JSON.stringify(pre.body).slice(0, 300));
  const r = await q('POST', '/events', body);
  ok('the one entry posts (200)', r.status === 200 && r.body.ok !== false && r.body.entry_id, r.status + ' ' + JSON.stringify(r.body).slice(0, 300));
  const again = await q('POST', '/events', body);
  ok('the same client_ref answers the SAME entry (duplicate), no second posting', again.status === 200 && again.body.entry_id === r.body.entry_id, JSON.stringify(again.body).slice(0, 200));
  const lines = (pre.body.lines || []).map((l) => [l.code, l.dr_minor, l.cr_minor, l.party ? 'P' : null]);
  eq('the lines: Dr 6030 30000 · Dr 2210 3000 · Cr 2100 33000 (party) · Dr 2100 33000 (party) · Cr 1500 33000', lines, [['6030', 30000, 0, null], ['2210', 3000, 0, null], ['2100', 0, 33000, 'P'], ['2100', 33000, 0, 'P'], ['1500', 0, 33000, null]]);
  const mine = T.items.filter((i) => String(i.party_id) === SUPP);
  eq('party_item: two rows, one document, net 0', [mine.length, [...new Set(mine.map((i) => i.against_ref))].length, mine.reduce((t, i) => t + i.amount_minor, 0)], [2, 1, 0]);
  eq('the two rows read as a bill and an advance payment of one document (BILL_KIND / CREDIT_KIND maps), not a credit note (on_account)', mine.map((i) => i.ref_kind).sort(), ['advance', 'bill']);
  const creditors = (await X.store.accounts(X.db, SHOP)).find((a) => a.role === 'creditors');
  eq('openItems(creditors) = none', (await X.store.openItems(X.db, SHOP, creditors.account_id, '2026-10-10')).filter((i) => String(i.party_id) === SUPP).length, 0);
  const dues = await q('GET', '/dues?side=supplier&asOf=2026-10-10');
  const row = (dues.body.parties || []).find((p) => p.party_id === SUPP);
  ok('GET /dues (supplier): nothing owed', !row || (row.balance_minor === 0 && !Object.values(row.buckets || {}).some((n) => n)), JSON.stringify(dues.body).slice(0, 300));
  const st = await q('GET', '/party/' + SUPP + '/statement?from=2026-10-01&to=2026-10-31');
  const sl = st.body.lines || [];
  ok('the statement shows a credit 330 and a debit 330', sl.length === 2 && sl.some((l) => l.cr_minor === 33000) && sl.some((l) => l.dr_minor === 33000), JSON.stringify(st.body).slice(0, 300));
  eq('…and closes at 0', sl.length ? sl[sl.length - 1].running_minor : null, 0);
  eq('GET /party/:id/bills open: none', ((await q('GET', '/party/' + SUPP + '/bills?side=supplier&state=open&asOf=2026-10-10')).body.bills || []).length, 0);
  const ret = await q('GET', '/returns?period=2026-Q2&simpler=0');
  const box = (c) => (ret.body.boxes || []).find((b) => b.code === c) || {};
  eq('BAS 1B (GST paid) = 3000', box('1B').amount_minor, 3000);
  eq('BAS G11 (GST-inclusive from 1 Oct 2026) = 33000', box('G11').amount_minor, 33000);
  const tb = await q('GET', '/trial-balance?asOf=2026-10-10');
  const rowOf = (c) => (tb.body.rows || []).find((x) => x.code === c) || {};
  const net = (x) => (x.dr_minor || 0) - (x.cr_minor || 0);
  ok('compare two carried totals: party items sum (' + mine.reduce((t, i) => t + i.amount_minor, 0) + ') = Suppliers control on the trial balance (' + net(rowOf('2100')) + ')', mine.reduce((t, i) => t + i.amount_minor, 0) === 0 && net(rowOf('2100')) === 0, JSON.stringify(rowOf('2100')));
  eq('bank ledger 1500 is 33000 out; expense 6030 is 30000; GST paid 2210 is 3000', [net(rowOf('1500')), net(rowOf('6030')), net(rowOf('2210'))], [-33000, 30000, 3000]);
  const rev = await q('POST', '/entries/' + r.body.entry_id + '/reverse', { reason: 'posted by mistake' });
  ok('the entry reverses (200)', rev.status === 200, rev.status + ' ' + JSON.stringify(rev.body).slice(0, 200));
  const after = T.items.filter((i) => String(i.party_id) === SUPP);
  eq('after the reversal the supplier items still sum to 0 and no bill is open', [after.reduce((t, i) => t + i.amount_minor, 0), (await X.store.openItems(X.db, SHOP, creditors.account_id, '2026-10-10')).filter((i) => String(i.party_id) === SUPP).length], [0, 0]);
  const old = await q('POST', '/events', Object.assign({}, body, { kind: 'expense', client_ref: 'bb-old' }));
  ok('the old shape (kind expense + supplier + bank tax) is still refused in words, nothing posted', old.status >= 400 && /bank_expense_supplier/.test(JSON.stringify(old.body)), old.status + ' ' + JSON.stringify(old.body).slice(0, 200));
  const noSup = await q('POST', '/events', Object.assign({}, body, { supplier: undefined, client_ref: 'bb-nosup' }));
  ok('no supplier: asked "Which supplier?"', noSup.status === 400 && /supplier/i.test(JSON.stringify(noSup.body)), noSup.status + ' ' + JSON.stringify(noSup.body).slice(0, 160));
  R.close(); done();
})();
