/**
 * books-party-netzero.test.cjs — BB-P1-3 GATE (bank to books): does ONE entry that holds BOTH a bill line and a payment line for the SAME supplier leave open party items?
 *
 * The design under test (cb-critic CHANGE, 28 Nov 2026): a bank line "Origin Energy 330 incl. GST" is ONE entry: Dr Electricity 300 · Dr GST paid 30 · Cr Suppliers(party) 330 · Dr Suppliers(party) 330 · Cr Bank 330.
 * Hand figures (AUD, minor units): expense 30000, GST 3000, party Cr 33000 then Dr 33000, bank Cr 33000. Expected: the party nets to 0 and nothing is open.
 * Proves, through the real express routes and the in-memory ledger (the same rowsSql rule): the entry posts · party_item rows exist for both lines · their per-document net is 0 ·
 * openItems(creditors) = none · GET /dues (supplier) shows no open money · the party statement shows both lines, closing 0 · the BAS reads 1B = 30.00 (GST paid) and G11 = 330.00 (GST-inclusive, the AU rule before 1 Oct).
 * Compare (two carried totals, never recomputed): the sum of the party's party_item rows vs the creditors control balance on the trial balance — both 0.
 * Run: node tests/books-party-netzero.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * CARD 14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';
const { rig, counter, SUPP, SHOP } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();
const REGISTERED = { country: 'AU', currency_code: 'AUD', gstn: '51824753556', timezone: 'Australia/Sydney', policy_flags: { gst_registration: 'regular' } };

(async () => {
  console.log('\n══ BB-P1-3 gate · one entry, bill + payment for one supplier, nets to zero? ══\n');
  const R = await rig(REGISTERED);
  if (!R) return;
  const { X, q } = R, T = X.T;
  const D = '2026-10-05';
  const code = (await q('GET', '/accounts')).body.accounts.find((a) => /lectric|Utilit/i.test(a.name) && !a.is_group);
  ok('an electricity / utilities expense account exists in the AU chart', !!code, 'none');
  const exp = code.code;
  const r = await q('POST', '/entries', { narration: 'Origin Energy', date: D, client_ref: 'bb-origin', lines: [
    { code: exp, dr_minor: 30000 }, { code: '2210', dr_minor: 3000 },
    { code: '2100', cr_minor: 33000, party_id: SUPP }, { code: '2100', dr_minor: 33000, party_id: SUPP },
    { code: '1500', cr_minor: 33000 } ] });
  ok('the one entry posts (200)', r.status === 200 && r.body.ok, r.status + ' ' + JSON.stringify(r.body).slice(0, 300));
  const mine = T.items.filter((i) => String(i.party_id) === SUPP);
  console.log('   rows: ' + JSON.stringify(mine.map((i) => [i.ref_kind, i.ref, i.against_ref, i.amount_minor])));
  ok('party_item rows exist for both lines (2 rows)', mine.length === 2, String(mine.length));
  const byDoc = {}; mine.forEach((i) => { byDoc[i.against_ref] = (byDoc[i.against_ref] || 0) + i.amount_minor; });
  eq('every document of the party nets to 0', Object.values(byDoc).filter((n) => n !== 0), []);
  const acct = T.accounts ? null : null;
  const creditors = (await X.store.accounts(X.db, SHOP)).find((a) => a.role === 'creditors');
  const open = await X.store.openItems(X.db, SHOP, creditors.account_id, '2026-10-10');
  eq('openItems(creditors) = none', open.filter((i) => String(i.party_id) === SUPP).length, 0);
  const dues = await q('GET', '/dues?side=supplier&asOf=2026-10-10');
  const row = (dues.body.parties || []).find((p) => p.party_id === SUPP);
  ok('GET /dues (supplier): the party owes nothing — no row, or balance 0 with no open bucket', !row || (row.balance_minor === 0 && !Object.values(row.buckets || {}).some((n) => n)), JSON.stringify(dues.body).slice(0, 300));
  const st = await q('GET', '/party/' + SUPP + '/statement?from=2026-10-01&to=2026-10-31');
  const sl = st.body.lines || [];
  ok('the party statement shows both lines (a credit 330 and a debit 330)', sl.length === 2 && sl.some((l) => l.cr_minor === 33000) && sl.some((l) => l.dr_minor === 33000), st.status + ' ' + JSON.stringify(st.body).slice(0, 400));
  eq('…and closes at 0 (the last running balance)', sl.length ? sl[sl.length - 1].running_minor : null, 0);
  const bills = await q('GET', '/party/' + SUPP + '/bills?side=supplier&state=open&asOf=2026-10-10');
  eq('GET /party/:id/bills state=open: none', (bills.body.bills || []).length, 0);
  const ret = await q('GET', '/returns?period=2026-Q2&simpler=0');
  const box = (c) => (ret.body.boxes || []).find((b) => b.code === c) || {};
  console.log('   BAS: ' + JSON.stringify((ret.body.boxes || []).map((b) => [b.code, b.amount_minor])));
  eq('BAS 1B (GST paid) = 3000', box('1B').amount_minor, 3000);
  eq('BAS G11 (non-capital purchases, GST-inclusive) = 33000', box('G11').amount_minor, 33000);
  const tb = await q('GET', '/trial-balance?asOf=2026-10-10');
  const cr = (tb.body.rows || []).find((x) => x.code === '2100');
  const carried = mine.reduce((t, i) => t + i.amount_minor, 0);
  ok('compare two carried totals: the party items sum (' + carried + ') = the Suppliers control on the trial balance (' + (cr ? (cr.dr_minor || 0) - (cr.cr_minor || 0) : 'no row, i.e. 0') + ')', carried === 0 && (!cr || ((cr.dr_minor || 0) - (cr.cr_minor || 0)) === 0), JSON.stringify(cr));
  R.close(); done();
})();
