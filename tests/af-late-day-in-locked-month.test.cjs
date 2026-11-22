/**
 * af-late-day-in-locked-month.test.cjs — AF-F-02 (walk AF, 1129): a till day summary that arrives after its month is HARD locked follows the ledger's standing rule
 * (engines period.js: an AUTOMATIC entry moves to the first open month, doc_date keeps its own day) — but never silently: the entry's narration says "September locked",
 * as a typed entry moved by the owner's press does. A typed entry on the same date is still refused PERIOD_LOCKED. An open-month day carries no note.
 * Hand case: 15 Sep day, cash 22.00 = sales 20.00 + GST 2.00, Sep locked → posts 1 Oct, doc_date 15 Oct, narration ends "September locked".
 * Run: node tests/af-late-day-in-locked-month.test.cjs
 */
'use strict';
const { rig, counter } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();
(async () => {
  const R = await rig(); if (!R) return;
  const { X, q, SHOP } = R;
  const day = (v) => String(v).slice(0, 10);
  await q('POST', '/periods/2026-27/6/lock', { reason: 'BAS filed', hard: true });
  const typed = await q('POST', '/events', { event: { kind: 'expense', class: 'bank_charges', amount: 15, paid_from: 'bank', date: '2026-09-15', client_ref: 'af-typed' } });
  ok('a typed entry on the locked day is refused PERIOD_LOCKED', typed.status === 409 && typed.body.code === 'PERIOD_LOCKED', JSON.stringify(typed.body));
  const ev = (ref, date) => ({ type: 'walkin_day', ref, date, currency: 'INR', modes: { cash: 2200 }, by_rate: [{ rate: 10, taxable: 2000, cgst: 100, sgst: 100 }], source_ref: 'walkin:C1:' + date });
  const late = await X.B.postEntry(X.db, SHOP, ev('D-late', '2026-09-15'));
  const e = X.T.entries.find((x) => x.source_ref === 'walkin:C1:2026-09-15');
  ok('the late day posts (the standing rule)', late && late.ok && e, JSON.stringify(late));
  eq('…on 1 Oct, its own day kept as doc_date', [day(late.posting_date), day(late.doc_date), late.moved], ['2026-10-01', '2026-09-15', true]);
  ok('…and the entry SAYS it moved: narration ends "September locked"', e && /September locked$/.test(e.narration || ''), e && e.narration);
  const open = await X.B.postEntry(X.db, SHOP, ev('D-open', '2026-10-03'));
  const o = X.T.entries.find((x) => x.source_ref === 'walkin:C1:2026-10-03');
  ok('a day in an open month carries no note', open.ok && o && !/locked/.test(o.narration || ''), o && o.narration);
  R.close(); done();
})().catch((e) => { console.log('   FAIL ' + (e && e.stack || e)); process.exit(1); });
