#!/usr/bin/env node
// @type: unit
/**
 * tests/books-replay-locked-month.test.cjs — AV-F-03 (2026-11-22): the body is compared BEFORE any lock answer.
 * OWNS      books-event-guard.onSeen: a replay (same client_ref) whose journal differs is EVENT_REF_REUSED (409) in an OPEN month and now also in a
 *           HARD-LOCKED one. Before, the guard's preview threw the locked-month refusal, the guard read that as "nothing to compare" and the route
 *           answered 200 duplicate:true with the old entry — an offline till that had edited the amount was told it was recorded.
 * CALLED BY scripts/guards.cjs
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * Run: node tests/books-replay-locked-month.test.cjs   (no database, no network: the writer's preview and the store read are stubbed)
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = ''; process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const books = require('../lib/books'), store = require('../lib/books-store'), guard = require('../lib/books-event-guard');
const lines = (amount) => [{ account_id: 'cash', dr_minor: amount, cr_minor: 0, party_id: null }, { account_id: 'sales', dr_minor: 0, cr_minor: amount }];
const stored = { entry_no: 'MJ/26-27/1', doc_date: '2026-04-10', lines: lines(25000) };
let pass = 0;
const t = async (n, f) => { await f(); pass++; console.log('  ok   ' + n); };
/** a month that is hard-locked: the preview refuses UNLESS it is only asked for the journal (opts.ignoreLock) */
function lockedPreview(amount) {
  return async (handle, entity, event, opts) => {
    if (!(opts && opts.ignoreLock)) throw Object.assign(new Error('April is locked'), { refused: true, code: 'PERIOD_LOCKED' });
    return { ok: true, lines: lines(amount), docDate: '2026-04-10' };
  };
}
(async () => {
  const keep = [books.previewEntry, store.entry];
  store.entry = async () => stored;
  try {
    await t('hard-locked month, same ref, CHANGED amount -> EVENT_REF_REUSED naming the first entry (not a silent duplicate)', async () => {
      books.previewEntry = lockedPreview(26000);
      let err = null;
      try { await guard.onSeen({}, 'e1', { source_ref: 'ev:expense:r1' }, { entry_id: 'x' }); } catch (e) { err = e; }
      assert.ok(err && err.code === 'EVENT_REF_REUSED' && err.refused === true && err.entry_no === 'MJ/26-27/1', 'got ' + (err && err.code));
    });
    await t('hard-locked month, same ref, SAME body -> a replay (nothing thrown, the route answers duplicate)', async () => {
      books.previewEntry = lockedPreview(25000);
      await guard.onSeen({}, 'e1', { source_ref: 'ev:expense:r1' }, { entry_id: 'x' });
    });
    await t('open month: the same compare, the same answer (the order does not depend on the lock)', async () => {
      books.previewEntry = async () => ({ ok: true, lines: lines(26000), docDate: '2026-04-10' });
      let err = null;
      try { await guard.onSeen({}, 'e1', { source_ref: 'ev:expense:r1' }, { entry_id: 'x' }); } catch (e) { err = e; }
      assert.ok(err && err.code === 'EVENT_REF_REUSED');
    });
    await t('the writer honours the flag: composeEntry reads the lock refusal as "no landing month" only when ignoreLock is set, read-only', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'books.js'), 'utf8');
      assert.ok(/opt && opt\.ignoreLock && docDate \? await placed\(\)\.catch/.test(src), 'composeEntry must catch the lock refusal under ignoreLock');
      assert.ok(/readOnly: true, ignoreLock: !!\(opts && opts\.ignoreLock\)/.test(src), 'previewEntry must pass ignoreLock to a read-only compose');
    });
  } finally { [books.previewEntry, store.entry] = keep; }
  console.log(pass + ' passed');
})().catch((e) => { console.error(e); process.exit(1); });
