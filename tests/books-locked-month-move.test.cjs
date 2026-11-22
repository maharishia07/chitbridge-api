/**
 * books-locked-month-move.test.cjs — W15-85: a bank line dated in a LOCKED month posts in the next open month when the owner says so (body.if_locked 'next_open'), its own date kept as doc_date.
 * Proves: without the key a locked month still refuses (409 PERIOD_LOCKED) · with it the entry posts on the first day of the next open month, doc_date = the line's own day, moved: true ·
 * the same client_ref again answers the first entry (duplicate, nothing new) · a second locked month in a row is skipped (first OPEN month) · a payment moves the same way · the key means nothing to a date in an open month.
 * Run: node tests/books-locked-month-move.test.cjs   (BOOKS_ENGINES_SRC=<lib/ or chitbridge-engines/src>)
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
'use strict';
const { rig, counter, SUPP } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();

(async () => {
  console.log('\n══ a bank line in a locked month, posted in the next open month ══\n');
  const R = await rig(null, '2026-12-10'); if (!R) return;
  const { X, q } = R, T = X.T;
  const entryOf = (ref) => T.entries.find((e) => e.source_ref === ref);
  const day = (value) => String(value).slice(0, 10);
  await q('POST', '/periods/2026-27/7/lock', { reason: 'BAS filed' });
  const fee = { kind: 'expense', class: 'bank_charges', amount: 15, paid_from: 'bank', date: '2026-10-06', narration: 'MONTHLY ACCOUNT FEE — October locked', client_ref: 'bank:abc-1' };
  const strict = await q('POST', '/events', { event: fee });
  ok('without the key a locked month still refuses (409 PERIOD_LOCKED)', strict.status === 409 && strict.body.code === 'PERIOD_LOCKED', JSON.stringify(strict.body));
  const moved = await q('POST', '/events', { event: Object.assign({}, fee, { if_locked: 'next_open' }) });
  const e = entryOf('ev:expense:bank:abc-1');
  ok('with if_locked: next_open it posts (200)', moved.status === 200 && moved.body.ok && e, JSON.stringify(moved.body));
  eq('…on the first day of the next open month, moved', [day(moved.body.posting_date), moved.body.moved], ['2026-11-01', true]);
  eq('…the statement line\'s own day is the entry\'s doc_date', day(moved.body.doc_date), '2026-10-06');
  ok('…and the narration the page wrote is kept', e && /October locked/.test(e.narration), e && e.narration);
  const n0 = T.entries.length;
  const again = await q('POST', '/events', { event: Object.assign({}, fee, { if_locked: 'next_open' }) });
  ok('the same line again answers the first entry (duplicate) and writes nothing', again.body.duplicate === true && again.body.entry_no === moved.body.entry_no && T.entries.length === n0, JSON.stringify(again.body));
  await q('POST', '/periods/2026-27/8/lock', { reason: 'test' });
  const skip = await q('POST', '/events', { event: Object.assign({}, fee, { client_ref: 'bank:abc-2', if_locked: 'next_open' }) });
  eq('November locked too: the first OPEN month is December', day(skip.body.posting_date), '2026-12-01');
  const open = await q('POST', '/events', { event: Object.assign({}, fee, { client_ref: 'bank:abc-3', date: '2026-12-03', if_locked: 'next_open' }) });
  eq('a date in an open month posts on its own day, not moved', [day(open.body.posting_date), !!open.body.moved], ['2026-12-03', false]);
  const pay = await q('POST', '/payments', { party_id: SUPP, direction: 'out', amount_minor: 5000, mode: 'bank', received_at: '2026-10-07', client_ref: 'bank:abc-4', allocate: 'none', if_locked: 'next_open' });
  ok('a payment to a party moves the same way (200)', pay.status === 200 && pay.body.ok !== false, JSON.stringify(pay.body).slice(0, 300));
  const pe = T.entries.find((x) => x.source_ref === 'pay:' + (pay.body.payment && pay.body.payment.payment_id));
  ok('W15-85a: …its narration carries the same note as an event ("October locked"), from the one helper', pe && /October locked$/.test(pe.narration), pe && pe.narration);
  eq('…its own day is the doc_date, its entry posts on the first open month, 1 December (a re-read shows "posted 1 Dec (October locked)")', [pe && day(pe.doc_date), pe && day(pe.posting_date)], ["2026-10-07", "2026-12-01"]);
  const payOpen = await q('POST', '/payments', { party_id: SUPP, direction: 'out', amount_minor: 100, mode: 'bank', received_at: '2026-12-04', client_ref: 'bank:abc-6', allocate: 'none', if_locked: 'next_open' });
  const po = T.entries.find((x) => x.source_ref === 'pay:' + (payOpen.body.payment && payOpen.body.payment.payment_id));
  ok('…a payment in an open month carries no note', po && !/locked/.test(po.narration || ''), po && po.narration);
  const payStrict = await q('POST', '/payments', { party_id: SUPP, direction: 'out', amount_minor: 5000, mode: 'bank', received_at: '2026-10-08', client_ref: 'bank:abc-5', allocate: 'none' });
  ok('…and without the key a locked month refuses the payment', payStrict.status >= 400, payStrict.status + ' ' + JSON.stringify(payStrict.body).slice(0, 200));
  R.close();
  done();
})().catch((e) => { console.log('   FAIL ' + (e && e.stack || e)); process.exit(1); });
