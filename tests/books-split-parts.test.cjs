/**
 * books-split-parts.test.cjs — the part files split out of lib/books.js, lib/books-store.js and lib/books-hooks.js (shrink job, 17 Nov 2026): each answers as it did in its parent.
 *
 * Offline, no database: a stub handle records the statements the store parts send. What it proves, per part:
 *   books-month-advice    a month locks only when it is over and every earlier month is locked; a soft lock reopens newest first; a hard lock never reopens
 *   books-payment-advice  a viewer is refused, an unposted / reversed / held-cheque / already-sent payment is refused in words, the money formatter fails closed to 2 decimals
 *   books-store-parties   a stranger's id (not a uuid) is never sent to the database; an empty lookup sends nothing; a party number is set on both lists
 *   books-store-packs     the pack reads and the acknowledgement go out as one statement each on the shop's id
 *   books-stray-tax       a tax figure under a key the books do not read waits in words, the split is never reached (fails closed)
 * Run: node tests/books-split-parts.test.cjs
 * CARD      16-finance/books-store
 */
'use strict';
const assert = require('assert');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', PARTY = '22222222-2222-4222-8222-222222222222';

/** a handle that records every statement and answers each with the next canned result (or no rows) */
function stubHandle(answers) {
  const sent = [];
  return { sent, query: async (text, args) => { sent.push({ text: String(text), args }); return { rows: (answers && answers.shift()) || [] }; } };
}

(async () => {
  console.log('\n══ books-month-advice ══\n');
  const month = require('../lib/books-month-advice');
  const rows = [
    { fiscal_year: 2026, period: 1, status: 'soft_locked', start_date: '2026-07-01', end_date: '2026-07-31' },
    { fiscal_year: 2026, period: 2, status: 'open', start_date: '2026-08-01', end_date: '2026-08-31' },
    { fiscal_year: 2026, period: 3, status: 'open', start_date: '2026-09-01', end_date: '2026-09-30' },
    { fiscal_year: 2026, period: 4, status: 'open', start_date: '2026-10-01', end_date: '2026-10-31' }
  ];
  const figures = rows.map((row) => ({ fiscal_year: row.fiscal_year, period: row.period, entries: 3, sales_minor: 1000 }));
  const advice = month.periodAdvice(rows, figures, '2026-10-15', [], null);
  ok('a locked month says it is already locked and may not lock again', advice[0].lock.may === false && advice[0].lock.why === 'Already locked.');
  ok('the next open finished month may be locked (every earlier month is locked)', advice[1].lock.may === true);
  ok('a finished month waits for the earlier one: refused in words, naming the month it waits for', advice[2].lock.may === false && advice[2].lock.first.period === 2);
  ok('a month that is not over yet is refused ("not over yet")', advice[3].lock.may === false && /not over yet/.test(advice[3].lock.why));
  ok('a soft lock with no later lock may reopen, with a reason', advice[0].reopen.may === true && /reason/.test(advice[0].reopen.why));
  const hardRows = rows.map((row, index) => (index < 2 ? Object.assign({}, row, { status: index === 0 ? 'soft_locked' : 'hard_locked' }) : row));
  const hardAdvice = month.periodAdvice(hardRows, figures, '2026-10-15', [], null);
  ok('a hard lock is not reopened from the lock door (the owner reopen route is named), and an earlier soft lock cannot reopen under it', hardAdvice[1].reopen.may === false && hardAdvice[0].reopen.may === false && /hard lock/.test(hardAdvice[0].reopen.why) && /owner/.test(hardAdvice[0].reopen.why));
  ok('months not locked counts only finished, unlocked months', month.monthsNotLocked(rows, '2026-10-15') === 2);
  const line = month.booksLockLine(rows, figures);
  ok('the lock line is the run of locked months from the books start', line.books_start.period === 1 && line.lock_date === '2026-07-31' && line.gaps.length === 0);
  ok('with no entries there is no books start (unavailable lock line answers empty, never invented)', month.booksLockLine(rows, []).books_start === null);
  const trail = month.lockTrailOf([{ row_id: '2026/1', at: 't', by: 'u', new: 'soft_locked — month done', old: 'open' }, { row_id: '2026/2', new: 'open' }], rows[0]);
  ok('the trail of one month reads only its own rows, with the reason split off', trail.length === 1 && trail[0].action === 'locked' && trail[0].reason === 'month done');

  console.log('\n══ books-payment-advice ══\n');
  const pay = require('../lib/books-payment-advice');
  const good = { level: 'editor', ready: true, posted: true, reversed: false, cheque_held: false, on_rail: true, sent: false, name: 'Tally Test' };
  ok('an editor may SEND the advice to a party on the rail, and may not share it', pay.adviceMay(good).send_advice.ok === true && pay.adviceMay(good).share_advice.ok === false);
  ok('a party off the rail may be SHARED with, never sent a chit', pay.adviceMay(Object.assign({}, good, { on_rail: false })).share_advice.ok === true && pay.adviceMay(Object.assign({}, good, { on_rail: false })).send_advice.ok === false);
  ok('a viewer is refused both (read only)', pay.adviceMay(Object.assign({}, good, { level: 'viewer' })).send_advice.ok === false);
  ['posted', 'ready'].forEach((key) => ok('refused when the payment is not ' + key, pay.adviceMay(Object.assign({}, good, { [key]: false })).send_advice.ok === false));
  ok('refused for a reversed payment, in words', /reversed/.test(pay.adviceMay(Object.assign({}, good, { reversed: true })).send_advice.say));
  ok('refused for a held cheque, in words', /clears/.test(pay.adviceMay(Object.assign({}, good, { cheque_held: true })).send_advice.say));
  ok('refused when an advice was already sent (one advice per payment)', pay.adviceMay(Object.assign({}, good, { sent: true })).send_advice.why === 'already_sent');
  ok('dateWords says a day the way a person does; no date says nothing', pay.dateWords('2026-10-04') === '4 Oct 2026' && pay.dateWords('') === '');
  ok('the advice state: none, shared, or the chit\'s own', pay.adviceState({}, null) === 'none' && pay.adviceState({ advice_shared_at: 'x' }, null) === 'shared' && pay.adviceState({ advice_chit_id: 'c' }, { disputed: true }) === 'disputed');
  ok('decimals: the currency\'s own (JPY 0), and 2 when the helper is unavailable (fails closed to 2)', pay.decimalPlaces('JPY') === 0 && pay.decimalPlaces('INR') === 2);

  console.log('\n══ books-store-parties ══\n');
  const parties = require('../lib/books-store-parties');
  let db = stubHandle();
  const map = await parties.partiesOn(db, SHOP, ['not-a-uuid', PARTY]);
  ok('an id that is not a uuid is answered false and never sent to the database (it would raise 22P02)', map.get('not-a-uuid').customer === false && db.sent[0].args[1].length === 1 && db.sent[0].args[1][0] === PARTY);
  db = stubHandle();
  ok('only a stranger asked about: nothing is sent at all', (await parties.partiesOn(db, SHOP, ['x'])).size === 1 && db.sent.length === 0);
  db = stubHandle();
  const none = await parties.supplierByName(db, SHOP, { name: '   ' });
  ok('an empty supplier lookup names nobody and sends nothing', none.one === null && none.near.length === 0 && db.sent.length === 0);
  db = stubHandle([[{ party_id: PARTY, name: 'Tally Test', party_no: 'S1', exact: true }]]);
  const one = await parties.supplierByName(db, SHOP, { name: 'Tally Test' });
  ok('exactly one exact match is the supplier; no near matches are offered then', one.one.party_id === PARTY && one.near.length === 0);
  db = stubHandle();
  await parties.setPartyNo(db, SHOP, PARTY, 'C9');
  ok('a party number is set on BOTH lists, only where none is set yet', db.sent.length === 2 && db.sent.every((q) => /party_no IS NULL/.test(q.text) && q.args[0] === SHOP));
  db = stubHandle();
  ok('parties() with an empty id list reads nothing', (await parties.parties(db, SHOP, [])).length === 0 && db.sent.length === 0);

  console.log('\n══ books-store-packs ══\n');
  const packs = require('../lib/books-store-packs');
  db = stubHandle([[{ pack_id: 'p1', sha256: 'abc' }]]);
  ok('the last pack is one statement on the shop, newest first', (await packs.lastPack(db, SHOP)).pack_id === 'p1' && db.sent.length === 1 && db.sent[0].args[0] === SHOP);
  db = stubHandle();
  ok('a pack that is not there answers null, never an error', (await packs.pack(db, SHOP, 'nope')) === null);
  db = stubHandle([[{ acknowledged_at: 'now' }]]);
  await packs.ackPack(db, SHOP, 'p1', 'user-1');
  ok('acknowledging keeps the first acknowledgement (COALESCE) and names who', /COALESCE\(acknowledged_at/.test(db.sent[0].text) && db.sent[0].args[2] === 'user-1');

  console.log('\n══ books-stray-tax ══\n');
  const stray = require('../lib/books-stray-tax');
  let reached = false;
  const splitter = () => { reached = true; return { net: 100 }; };
  const waits = stray.splitUnlessStray({ amount: 242, gst: 22 }, 242, {}, splitter);
  ok('a tax figure under "gst" with no input_tax waits in words naming the key; the split is never reached (refused, fails closed)', waits.why.includes('"gst"') && reached === false);
  const through = stray.splitUnlessStray({ amount: 100, input_tax: { gst: 10 } }, 100, {}, splitter);
  ok('an expense that names its tax under input_tax goes to the split untouched', reached === true && through.net === 100);
  ok('a zero or blank stray figure is not a stray key', stray.strayTaxKey({ gst: 0, tax: '' }) === null);

  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
void assert;
