/**
 * acc-286-credit-note-cap.test.cjs — ACC-286: A COUNTER CREDIT NOTE CANNOT CREDIT MORE THAN ITS BILL, EVEN WHEN TEN ARRIVE AT ONCE.
 *
 *   Before: nothing on the send path added up earlier notes against the bill. Four notes of 1,180.00 on a bill of 3,540.00 all answered 200 and posted (4,720.00 back on
 *   3,540.00 sold); ten fired together refunded 11,800.00. Now lib/credit-cap.holdUnderLock runs inside the send's write transaction, under the lock credit-cap|<bill>:
 *   notes 1-3 are accepted (3 x 1,180.00 = 3,540.00), the 4th is refused 409 CREDIT_NOTE_OVER_BILL in words; ten at once give exactly 3 accepted and 7 refused.
 *   Hand figures: PM/SIT-HUNT-RUN-2026-11-08-c5.md, p2cn.cjs (bill 3 x 1,000.00 + 18% = 3,540.00 = 354000 minor; note 1 x 1,000.00 + 18% = 1,180.00 = 118000 minor).
 *   Offline: a two-client stand-in (the lock is a per-key mutex held until that client's transaction ends; the note's header is "committed" when it ends).
 * Run: node tests/acc-286-credit-note-cap.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cap = require('../lib/credit-cap');
const lock = require('../lib/xact-lock');
const CF = require('../tools/chits-files.cjs'); /* the ONE list of chits files (tools/chits-files.cjs) */

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-286286286286', BILL = 'b0000000-0000-4000-8000-000000000286';
const row = (chit_id, total, bill_no) => ({ chit_id, invoice_total: total, money_total: null, legacy_total: null, refund_total: null, bill_no: bill_no || null, currency_code: 'INR' });

/** the shared "database" and one client per transaction: the lock waits for the holder's commit; the selects answer from the committed notes */
function world(billTotal, bills) {
  const committed = []; const held = new Map();
  const billRows = bills || (billTotal === null ? [] : [Object.assign(row(BILL, billTotal, 'B-1'), { till_id: 'C1' })]);
  async function transaction(fn) {
    const mine = [];
    const client = { query: async (sql, params) => {
      if (sql === lock.LOCK_SQL) {
        const key = params.join('|');
        while (held.has(key) && held.get(key).owner !== client) await held.get(key).done;
        if (!held.has(key)) { let release; const done = new Promise((r) => { release = r; }); held.set(key, { owner: client, done, release }); mine.push(key); }
        return { rows: [] };
      }
      /* the stand-in answers by the SQL's own parameter contract: $2 the bill's id (else $3 its number) */
      if (/ANY\(\$4::text\[\]\)/.test(sql)) return { rows: billRows.filter((item) => (params[1] ? item.chit_id === params[1] : item.bill_no === params[2])) };
      if (/DISTINCT ON/.test(sql)) { await new Promise((r) => setImmediate(r)); return { rows: committed.filter((n) => n.chit_id !== params[3] && (params[4] === null || n.client_ref !== params[4]) && (n.against_chit === params[1] || (params[2] && !n.against_chit && n.till_id === params[5] && n.against_no === params[2]))) }; }
      throw new Error('unexpected sql ' + sql.slice(0, 60));
    } };
    try { return await fn(client); }
    finally { mine.forEach((k) => { const h = held.get(k); if (h && h.owner === client) { held.delete(k); h.release(); } }); }
  }
  let count = 0;
  /** one send of a counter note of `total`: the cap, then (accepted) the header is written in the same transaction */
  async function sendNote(total, extra) {
    const id = 'c0000000-0000-4000-8000-' + String(++count).padStart(12, '0');
    const state = Object.assign({ sender_id: SHOP, chit_id: id, purpose: 'credit_note', currency_code: 'INR', is_draft: false,
      business_json: { till: { id: 'C1' }, against: { bill_no: 'B-1', chit_id: BILL }, refund: { total }, invoice: { ValDtls: { TotInvVal: total } } } }, extra || {});
    const against = state.business_json.against || {}, till = String((state.business_json.till && state.business_json.till.id) || '').toUpperCase();
    return transaction(async (client) => {
      await cap.holdUnderLock(client, state); await new Promise((r) => setImmediate(r));
      committed.push(Object.assign(row(id, total), { against_chit: against.chit_id || null, against_no: against.bill_no || null, till_id: till, client_ref: state.client_ref || null }));
      return id;
    });
  }
  return { sendNote, committed };
}
const tally = (settled) => ({
  accepted: settled.filter((r) => r.status === 'fulfilled').length,
  refused: settled.filter((r) => r.status === 'rejected' && r.reason && r.reason.code === 'CREDIT_NOTE_OVER_BILL' && r.reason.status === 409).length
});
const verdict = (promise) => promise.then(() => 'ok', (e) => e.code);

(async () => {
  console.log('\n== ACC-286 · the credit note cap ==\n');
  const seq = world(3540); const answers = [];
  for (let i = 0; i < 4; i++) answers.push(await verdict(seq.sendNote(1180)));
  ok('CN1 · four notes of 1,180.00 on 3,540.00, one after the other: 3 accepted, the 4th refused CREDIT_NOTE_OVER_BILL', answers.join(',') === 'ok,ok,ok,CREDIT_NOTE_OVER_BILL', answers.join(','));
  const refusal = await seq.sendNote(1180).then(() => null, (e) => e);
  ok('CN1 · the refusal is a thrown refusal (409, registered code, title) with the figures in plain words',
    refusal && refusal.refused === true && refusal.status === 409 && refusal.title === 'Credit note too large' && /3,540/.test(refusal.message) && /nothing is left to credit/.test(refusal.message) && /1,180/.test(refusal.message), refusal && refusal.message);

  const par = world(3540);
  const settled = await Promise.allSettled(Array.from({ length: 10 }, () => par.sendNote(1180)));
  const found = tally(settled);
  ok('CN2 · ten notes of 1,180.00 at once on 3,540.00: exactly 3 accepted, 7 refused', found.accepted === 3 && found.refused === 7, JSON.stringify(found));
  ok('CN2 · never more than 3,540.00 credited in all (354000 minor)', par.committed.reduce((sum, item) => sum + Math.round(item.invoice_total * 100), 0) <= 354000, String(par.committed.length));

  const part = world(3540); const mixed = [];
  for (const amount of [2360, 1180, 1]) mixed.push(await verdict(part.sendNote(amount)));
  ok('partial notes of different sizes: 2,360.00 + 1,180.00 fill the bill; one more rupee is refused', mixed.join(',') === 'ok,ok,CREDIT_NOTE_OVER_BILL', mixed.join(','));

  const au = world(330); const auAnswers = [];
  for (const amount of [165, 165, 0.05]) auAnswers.push(await verdict(au.sendNote(amount, { currency_code: 'AUD' })));
  ok('AU · A$330.00 bill: two notes of A$165.00 fill it, A$0.05 more is refused', auAnswers.join(',') === 'ok,ok,CREDIT_NOTE_OVER_BILL', auAnswers.join(','));

  ok('CTR-234 · a bill that cannot be found is REFUSED (409 BILL_NOT_RECORDED), never a refund with no bill behind it', (await verdict(world(null).sendNote(1180))) === 'BILL_NOT_RECORDED');
  const free = world(3540);
  const noTill = await verdict(free.sendNote(9999, { business_json: { against: { bill_no: 'B-1', chit_id: BILL }, invoice: { ValDtls: { TotInvVal: 9999 } } } }));
  const draft = await verdict(free.sendNote(9999, { is_draft: true }));
  const other = await verdict(free.sendNote(9999, { purpose: 'order' }));
  ok('not a counter credit note (no till) · a draft · another purpose: untouched', [noTill, draft, other].join() === 'ok,ok,ok', [noTill, draft, other].join());
  ok('against read three ways: an object with chit_id, an object with only bill_no, a bill number as text; a bad id is no id',
    cap.againstOf({ against: { chit_id: BILL } }).chit_id === BILL && cap.againstOf({ against: { bill_no: 'B-1' } }).bill_no === 'B-1' && cap.againstOf({ against: 'B-1' }).bill_no === 'B-1' && cap.againstOf({ against: { chit_id: 'not-an-id' } }).chit_id === null);

  /* the same client_ref twice at once, the first filling the bill: the second must NOT count the first (the send route's raced-duplicate answer covers it), so the cap says nothing */
  const dupe = world(1180);
  const twice = await Promise.allSettled([dupe.sendNote(1180, { client_ref: 'cn-same' }), dupe.sendNote(1180, { client_ref: 'cn-same' })]);
  ok('same client_ref twice at once on a bill the first fills: neither is refused by the cap', twice.every((item) => item.status === 'fulfilled'), JSON.stringify(twice.map((item) => item.status === 'fulfilled' ? 'ok' : item.reason.code)));
  const others = world(1180);
  const different = await Promise.allSettled([others.sendNote(1180, { client_ref: 'cn-a' }), others.sendNote(1180, { client_ref: 'cn-b' })]);
  ok('control · two DIFFERENT refs at once on that bill: one accepted, one refused', tally(different).accepted === 1 && tally(different).refused === 1, JSON.stringify(tally(different)));

  /* two bills sharing one number (two tills, both B-1): a note naming only the number is judged on the bill of ITS till */
  const twoBills = [Object.assign(row('b0000000-0000-4000-8000-0000000000c1', 3540, 'B-1'), { till_id: 'C1' }), Object.assign(row('b0000000-0000-4000-8000-0000000000c2', 1180, 'B-1'), { till_id: 'C2' })];
  const noteBy = (shop, till, total, bill) => shop.sendNote(total, { business_json: { till: { id: till }, against: bill, refund: { total }, invoice: { ValDtls: { TotInvVal: total } } } });
  const shared = world(null, twoBills);
  const sharedAnswers = [await verdict(noteBy(shared, 'C2', 1180, { bill_no: 'B-1' })), await verdict(noteBy(shared, 'C2', 1180, { bill_no: 'B-1' })), await verdict(noteBy(shared, 'C1', 1180, { bill_no: 'B-1' }))];
  ok('two bills share B-1 (C1 3,540 and C2 1,180): a C2 note fills C2, a second C2 note is refused, a C1 note is judged on C1 and passes', sharedAnswers.join(',') === 'ok,CREDIT_NOTE_OVER_BILL,ok', sharedAnswers.join(','));
  const sameTill = world(null, twoBills.map((item) => Object.assign({}, item, { till_id: 'C1' })));
  ok('two bills share B-1 on the SAME till: ambiguous, not judged (logged), the note goes through', (await verdict(noteBy(sameTill, 'C1', 9999, { bill_no: 'B-1' }))) === 'ok');
  const byId = world(null, twoBills);
  ok('a note that carries the bill\'s own id is judged on that bill whatever the number says', (await verdict(noteBy(byId, 'C1', 2000, { bill_no: 'B-1', chit_id: 'b0000000-0000-4000-8000-0000000000c2' }))) === 'CREDIT_NOTE_OVER_BILL');

  /* the SQL text never runs offline (no database here, no Docker on this laptop): only its parameter use is checked, one type per parameter (ACC-281); the SIT replay proves the rows */
  const code = fs.readFileSync(path.join(__dirname, '..', 'lib', 'credit-cap.js'), 'utf8');
  const statements = code.match(/`SELECT[^`]*`/g) || [];
  const typed = statements.map((text) => {
    const types = {};
    (text.match(/\$\d(::\w+(\[\])?)?/g) || []).forEach((use) => { (types[use.slice(0, 2)] = types[use.slice(0, 2)] || new Set()).add(use.slice(2)); });
    return Object.values(types).every((set) => set.size === 1 || (set.size === 2 && set.has('')));
  });
  ok('SQL shape · three statements (the bill, the earlier notes, and the own-bill read of ACC-265 for the cancel guard), every parameter used with one cast (a bare use beside a cast is fine)', statements.length === 3 && typed.every(Boolean), JSON.stringify(typed));

  /* a note that is NOT judged says so on the answer (sendState.creditCap → credit_cap), and a failed read is a refusal in words, never a bare 500 */
  const stateOf = (extra) => Object.assign({ sender_id: SHOP, chit_id: 'c0000000-0000-4000-8000-0000000000aa', purpose: 'credit_note', currency_code: 'INR', is_draft: false, business_json: { till: { id: 'C1' }, against: { bill_no: 'B-9' }, refund: { total: 10 }, invoice: { ValDtls: { TotInvVal: 10 } } } }, extra || {});
  const unjudged = stateOf();
  await cap.holdUnderLock({ query: async (sql) => ({ rows: /ANY/.test(sql) ? [Object.assign(row(BILL, null, 'B-9'), { till_id: 'C1' })] : [] }) }, unjudged);
  ok('a note whose bill carries no total carries the warning credit_cap { code CREDIT_NOTE_NOT_JUDGED, why }', unjudged.creditCap && unjudged.creditCap.code === 'CREDIT_NOTE_NOT_JUDGED' && /not checked/.test(unjudged.creditCap.why), JSON.stringify(unjudged.creditCap));
  const judgedState = stateOf({ business_json: { till: { id: 'C1' }, against: { bill_no: 'B-1', chit_id: BILL }, refund: { total: 10 }, invoice: { ValDtls: { TotInvVal: 10 } } } });
  await world(3540).sendNote(10, { business_json: judgedState.business_json });
  ok('a judged note carries no warning', judgedState.creditCap === undefined);
  const broken = await cap.holdUnderLock({ query: async () => { throw Object.assign(new Error('column h.x does not exist'), { code: '42703' }); } }, stateOf()).then(() => null, (e) => e);
  ok('a failed read is a refusal in words with a registered code (503 CREDIT_NOTE_NOT_CHECKED), not an internal error', broken && broken.refused === true && broken.status === 503 && broken.code === 'CREDIT_NOTE_NOT_CHECKED' && /could not be checked/.test(broken.message) && !/column/.test(broken.message), broken && broken.message);
  const sendSrc = CF.read(path.join(__dirname, '..'));
  ok('the send answer carries credit_cap from sendState.creditCap', /credit_cap: sendState.creditCap/.test(sendSrc));
  ok('chit_detail holds the currency (as books-store reads it): the bill query joins it, never h.currency_code', /d.currency_code/.test(code) && !/h.currency_code/.test(code));

  const src = CF.read(path.join(__dirname, '..'));
  const write = src.indexOf('async function sendWrite'), legacy = src.indexOf('async function sendLegacyWrite');
  const inWrite = src.indexOf('creditCap.holdUnderLock(entityClient, sendState)', write), inLegacy = src.indexOf('creditCap.holdUnderLock(client, sendState)', legacy);
  ok('wiring · sendWrite asks the cap inside withEntity, before mint.deliver', write > 0 && inWrite > write && inWrite < src.indexOf('mint.deliver(sender_id', write), [write, inWrite].join(' '));
  ok('wiring · sendLegacyWrite asks it too, first in its transaction', legacy > 0 && inLegacy > legacy && inLegacy < src.indexOf('sendLegacySenderRows(client', legacy), [legacy, inLegacy].join(' '));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n\n' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
