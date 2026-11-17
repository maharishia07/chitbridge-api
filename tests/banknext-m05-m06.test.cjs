/**
 * banknext-m05-m06.test.cjs: the api goldens of the critic PM/critic/BANK-NEXT-M05-M06-M08-CRITIC-2026-11-18.md (real express, the in-memory store, the adopted engines posting v1.100.0).
 *   G-M05b  POST /events kind drawings and the ENGINE's `drawings` event give IDENTICAL journals (lines, voucher type, series, source_ref form): posted history reads the same after the re-point.
 *   G-M05c  the guard stays: POST /events kind expense with class drawings is refused (422), nothing posted.
 *   G-M06b  POST /loans L1 50,000.00 then /loans/L1/emi principal 1,250.00 + interest 250.00 (the lender's split, typed): the loan owes 48,750.00, interest paid 250.00, the bank down 1,500.00.
 *   Hostile: a replayed instalment (same client_ref) posts once; interest typed above the whole instalment is the owner's own figure (it is the SPLIT that is typed, the sum is checked by principal <= outstanding).
 * Hand figures (INR here, the rule is country-neutral): drawings 3,000.00 = Dr 3100 300000 / Cr 1400 300000. Loan 5,000,000 minor; emi 125000 + 25000 = 150000; owed 5,000,000 - 125000 = 4,875,000.
 * Run: node tests/banknext-m05-m06.test.cjs   (BOOKS_ENGINES_SRC=<lib/>)
 */
'use strict';
const path = require('path');
const { rig, counter } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();

(async () => {
  console.log('\n══ banknext M-05 drawings · M-06 loan principal + interest ══\n');
  const R = await rig(); if (!R) return;
  const { X, q } = R, T = X.T;
  const entryOf = (ref) => T.entries.find((e) => e.source_ref === ref);
  const linesOf = (e) => T.lines.filter((l) => l.entry_id === e.entry_id).sort((a, b) => a.line_no - b.line_no).map((l) => [l.code, l.dr_minor, l.cr_minor]);
  const posting = require(path.join(X.src.dir, 'posting.js'));
  const D = '2026-10-05';

  /* G-M05b */
  const r = await q('POST', '/events', { event: { kind: 'drawings', from: 'cash', amount: 3000, date: D, client_ref: 'd1' } });
  const e = entryOf('ev:drawings:d1');
  ok('G-M05b: POST /events drawings posts one entry', r.status === 200 && r.body.ok && e, JSON.stringify(r.body));
  const engine = posting.post({ type: 'drawings', owner: true, source: 'manual', from: 'cash', amount: 3000, date: D, currency: 'INR', narration: 'Drawings' }, { country: 'IN' });
  ok('…the engine composes the same event', engine.ok, engine.why);
  eq('…identical lines: the stored entry equals the engine drawings event', e && linesOf(e), engine.lines.map((l) => [l.code, l.dr_minor, l.cr_minor]));
  eq('…and the hand-worked journal: Dr 3100 Drawings 300000 · Cr 1400 Cash 300000', e && linesOf(e), [['3100', 300000, 0], ['1400', 0, 300000]]);
  ok('…voucher Payment, a person\'s own entry (series MJ), as before the re-point', e && e.voucher_type === 'Payment' && /^MJ\//.test(String(e.entry_no || e.number || '')) , JSON.stringify([e && e.voucher_type, e && e.entry_no]));
  eq('…the voucher the engine gives the event is the same', [engine.voucher.type, engine.voucher.series], [e.voucher_type, 'MJ']);
  ok('…a double tap posts once', (await q('POST', '/events', { event: { kind: 'drawings', from: 'cash', amount: 3000, date: D, client_ref: 'd1' } })).body.duplicate === true && T.entries.filter((x) => x.source_ref === 'ev:drawings:d1').length === 1);
  const goods = await q('POST', '/preview', { event: { kind: 'drawings', what: 'goods', amount: 100, from: 'cash', date: D } });
  ok('…drawings of goods stays refused in words', goods.body.ok === false, JSON.stringify(goods.body));

  /* G-M05c */
  const n = T.entries.length;
  const bad = await q('POST', '/events', { event: { kind: 'expense', class: 'drawings', paid_from: 'cash', amount: 3000, date: D, client_ref: 'bad1' } });
  ok('G-M05c: an expense of class drawings is still refused (422), nothing posted', bad.status === 422 && T.entries.length === n, JSON.stringify([bad.status, bad.body]));

  /* G-M06b */
  const ln = await q('POST', '/loans', { ref: 'L1', lender: 'Lender', amount_minor: 5000000, into: 'bank', rate: 6, kind: 'secured', date: '2026-10-01' });
  ok('G-M06b: POST /loans L1 50,000.00', ln.status === 200 && ln.body.ok, JSON.stringify(ln.body));
  const bankBefore = T.lines.filter((l) => l.code === '1500').reduce((t, l) => t + l.dr_minor - l.cr_minor, 0);
  const emiBody = { principal_minor: 125000, interest_minor: 25000, from: 'bank', date: '2026-10-08', client_ref: 'oct' };
  const em = await q('POST', '/loans/L1/emi', emiBody);
  const ee = entryOf('emi:L1:oct');
  ok('…POST /loans/L1/emi 1,250.00 + 250.00 posts one entry', em.status === 200 && em.body.ok && ee, JSON.stringify(em.body));
  eq('…Dr 2000 Loan 125000 · Dr 6150 Interest paid 25000 · Cr 1500 Bank 150000', ee && linesOf(ee), [['2000', 125000, 0], ['6150', 25000, 0], ['1500', 0, 150000]]);
  const sumBy = (code) => T.lines.filter((l) => l.code === code).reduce((t, l) => t + l.dr_minor - l.cr_minor, 0);
  eq('…the loan owes 48,750.00 (4,875,000 minor)', -sumBy('2000'), 4875000);
  eq('…interest paid 250.00', sumBy('6150'), 25000);
  eq('…the bank is down 1,500.00', sumBy('1500') - bankBefore, -150000);
  ok('…a replayed line (same client_ref) posts once', (await q('POST', '/loans/L1/emi', emiBody)).body.duplicate === true && T.entries.filter((x) => x.source_ref === 'emi:L1:oct').length === 1);
  const over = await q('POST', '/loans/L1/emi', { principal_minor: 9000000, interest_minor: 0, from: 'bank', date: '2026-10-09', client_ref: 'big' });
  ok('…a principal above what the loan owes is refused (FIN-92), nothing posted', over.status === 422 && !entryOf('emi:L1:big'), JSON.stringify(over.body));
  R.close();
  done();
})().catch((err) => { console.error(err); process.exit(1); });
