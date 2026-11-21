#!/usr/bin/env node
// @type: unit
/**
 * tests/walkax-credit-note-before-bill.test.cjs — AX-F-03 (2026-11-22): a till credit note dated BEFORE the bill it credits is refused in words (409 CREDIT_NOTE_BEFORE_BILL), nothing written.
 * OWNS      lib/credit-cap.js holdUnderLock → judge → refuseBeforeBill (the send's own transaction, before the credit total is compared). The forward-posting rule for a locked month is NOT touched.
 * CALLED BY scripts/guards.cjs
 * CARD      14-accounting/README (ACC-286)
 * Walk figures (AX-C08 K4): the bill was struck 22 Nov 2026, the note 12 Apr 2026 (hard-locked April): the note posted on 1 May. The bill is 118.00; a note of 118.00 is within the cap, so only the date can refuse it.
 * Same-day and later notes pass (days are compared, not minutes: two tills a little apart never refuse a true note); a note with no billed_at is not judged here.
 */
'use strict';
const cap = require('../lib/credit-cap');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const BILL = '11111111-1111-4111-8111-111111111111', SELLER = '33333333-3333-4333-8333-333333333333';
const client = () => ({
  query: async (sql) => {
    if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
    if (/AS withdrawn FROM chit_header h WHERE/.test(sql)) return { rows: [{ withdrawn: false }] };
    if (/ANY\(\$4::text\[\]\)/.test(sql)) return { rows: [{ chit_id: BILL, currency_code: 'INR', till_id: 'C5', withdrawn: false, invoice_total: 118, money_total: null, legacy_total: null, refund_total: null, bill_no: 'C5/26-27/0001', billed_at: '2026-11-22T10:15:00+05:30' }] };
    if (/DISTINCT ON/.test(sql)) return { rows: [] };
    throw new Error('unexpected read: ' + sql.slice(0, 60));
  }
});
const note = (billedAt) => ({ sender_id: SELLER, chit_id: 'c2', purpose: 'credit_note', is_draft: false, currency_code: 'INR',
  business_json: Object.assign({ bill_no: 'C5/26-27/0002', against: { chit_id: BILL }, till: { id: 'C5' }, refund: { total: 118 } }, billedAt ? { billed_at: billedAt } : {}) });
const run = async (state) => { try { await cap.holdUnderLock(client(), state); return null; } catch (e) { return { code: e.code, status: e.status, text: e.message }; } };
(async () => {
  const before = await run(note('2026-04-12T11:00:00+05:30'));
  ok('a note dated 12 Apr on a bill of 22 Nov -> 409 CREDIT_NOTE_BEFORE_BILL', !!before && before.status === 409 && before.code === 'CREDIT_NOTE_BEFORE_BILL', JSON.stringify(before));
  ok('...in words that name both days', !!before && /2026-04-12/.test(before.text) && /2026-11-22/.test(before.text) && /before the bill/.test(before.text), before && before.text);
  ok('a note on the same day as its bill passes (an earlier minute too: tills differ by minutes)', (await run(note('2026-11-22T10:00:00+05:30'))) === null);
  ok('a note a day later passes', (await run(note('2026-11-23T09:00:00+05:30'))) === null);
  ok('a note with no billed_at is not judged by date', (await run(note(null))) === null);
  console.log('\n' + (fail ? '  FAILED ' + fail : '  ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
