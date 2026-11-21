#!/usr/bin/env node
// @type: unit
/**
 * tests/books-staff-advance-handle.test.cjs — AX-F-01 (2026-11-22): POST /events staff_advance and advance_recovered answered 500 for every body once a staff ledger existed.
 * OWNS      lib/books-manual.js staffLedger reads the chart ON A HANDLE. The real store reads db.query, so a null handle is "Cannot read properties of null (reading 'query')"
 *           (sit-root log, request ids a145b4a6…, 19acb85e…, 95ca6903…, 8a5c0e2d…). The in-memory store ignored its db, so every earlier test passed. Here the store is made strict like Postgres.
 * CALLED BY scripts/guards.cjs
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * Hand figures: advance 4,000.00 = 400,000 paise: Dr the staff ledger · Cr cash; recovered 1,500.00 = 150,000: Dr cash · Cr the staff ledger.
 */
'use strict';
const { rig, addStaffLedger, counter } = require('./support/books-manual-rig.cjs');
const { ok, done } = counter();
(async () => {
  const R = await rig(); if (!R) return;
  const { X, q } = R, T = X.T;
  const staff = await addStaffLedger(R, 'Advance — Ravi');
  const real = X.store ? X.store : require('../lib/books-store');
  const accounts = real.accounts;
  real.accounts = async (db, e) => { if (!db || typeof db.query !== 'function') throw new TypeError("Cannot read properties of null (reading 'query')"); return accounts(db, e); };
  const adv = await q('POST', '/events', { event: { kind: 'staff_advance', ledger: staff.code, from: 'cash', amount: 4000, date: '2026-10-05', client_ref: 'ax1-adv' } });
  ok('staff advance with a staff ledger -> 200 and an entry (not 500)', adv.status === 200 && adv.body.ok, adv.status + ' ' + JSON.stringify(adv.body).slice(0, 200));
  const rec = await q('POST', '/events', { event: { kind: 'advance_recovered', ledger: staff.code, into: 'cash', amount: 1500, date: '2026-10-06', client_ref: 'ax1-rec' } });
  ok('advance recovered with a staff ledger -> 200 and an entry (not 500)', rec.status === 200 && rec.body.ok, rec.status + ' ' + JSON.stringify(rec.body).slice(0, 200));
  const bad = await q('POST', '/events', { event: { kind: 'staff_advance', ledger: staff.code, from: 'cash', amount: 'abc', date: '2026-10-05', client_ref: 'ax1-bad' } });
  ok('a bad amount is a question in words (400/422), not 500', bad.status >= 400 && bad.status < 500, bad.status + ' ' + JSON.stringify(bad.body).slice(0, 200));
  const gone = await q('POST', '/events', { event: { kind: 'staff_advance', ledger: '9999', from: 'cash', amount: 10, date: '2026-10-05', client_ref: 'ax1-gone' } });
  ok('a ledger that does not exist is a question in words, not 500', gone.status >= 400 && gone.status < 500, gone.status + ' ' + JSON.stringify(gone.body).slice(0, 200));
  real.accounts = accounts;
  void T;
  done();
})();
