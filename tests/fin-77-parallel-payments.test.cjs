/**
 * fin-77-parallel-payments.test.cjs — FIN-77: TWO FULL-DUE PAYMENTS RECORDED AT THE SAME MOMENT SETTLE THE BILL ONCE.
 *
 *   Before: POST /api/books/payments asked "is this the same money twice / more than is owed?" (recordPayment with p.warn: proposeFor + duplicateWarnings)
 *   BEFORE it took the party's lock, so two requests at once both read "3,540.00 due", both passed, both posted, and the due went to -3,540.00 (an
 *   advance nobody confirmed). One after the other the second was refused 409 ALREADY_PAID. Now the question is asked UNDER the party's lock
 *   (S.lockParty, the key lockedItems takes), so the second request reads the first one's rows and is refused the same way.
 *   Hand figures from PM/SIT-HUNT-RUN-2026-11-08-c5.md: IN bill 3,540.00 (354000 minor), AU bill A$330.00 (33000 minor). Runs on the in-memory twin.
 * Run: node tests/fin-77-parallel-payments.test.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
const H = require('./support/books-harness.cjs');
let CLOCK = null;

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-777777777777', BUYER = '22222222-2222-4222-8222-777777777777', BILL = 'c0000000-0000-4000-8000-000000000077';

/** two clients: each withEntity is its own handle; the lock is a per-key mutex held until that handle's transaction ends (the database's behaviour) */
function twoClients(X) {
  const held = new Map();
  X.store.lockParty = async (db, e, party, account) => {
    const key = e + '|' + party + '|' + account;
    while (held.has(key) && held.get(key).owner !== db) await held.get(key).done;
    if (!held.has(key)) { let release; const done = new Promise((r) => { release = r; }); held.set(key, { owner: db, done, release }); db.__locks.push(key); }
  };
  X.dbStub.withEntity = async (e, fn) => {
    const handle = Object.create(X.db); handle.__locks = [];
    try { return await fn(handle); }
    finally { handle.__locks.forEach((k) => { const h = held.get(k); if (h && h.owner === handle) { held.delete(k); h.release(); } }); }
  };
}
const SETTING = { IN: { cur: 'INR', due: 354000, country: 'IN' }, AU: { cur: 'AUD', due: 33000, country: 'AU' } };

/** an IN or AU shop with the ledger on and ONE open bill of the hand figure */
async function shopWithDue(country) {
  const { cur, due } = SETTING[country];
  const X = H.load(); twoClients(X);
  CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); CLOCK.set('2026-09-29T10:01:00Z'); /* the twin stamps rows from its own clock; the 24 h window must look at it */
  X.T.parties.push({ owner: SHOP, party_id: BUYER, party_no: 'P-00001', name: 'Buyer', customer: true, credit_days: 10 });
  X.T.identities.push({ identity_id: SHOP, display_name: 'Shop', country, currency_code: cur, timezone: country === 'AU' ? 'Australia/Sydney' : 'Asia/Kolkata', policy_flags: {} });
  await X.store.saveSetting(X.db, SHOP, { enabled: true, walkin_grain: 'day', country, functional_currency: cur });
  await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-09-20' });
  await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-09-25', currency: cur, party: BUYER, source_chit_id: BILL, source_ref: 'chit:' + BILL,
    by_rate: [{ rate: 0, taxable: due / 100, cgst: 0, sgst: 0, igst: 0 }], paid: {}, round_off: 0 });
  return X;
}
/** the route's call: warn asks the duplicate / excess question, no allocate (the body's default), no acknowledgement */
const payOf = (X, country, ref) => X.dbStub.withEntity(SHOP, (db) => X.B.recordPayment(db, SHOP, { party_id: BUYER, direction: 'in', amount_minor: SETTING[country].due, currency: SETTING[country].cur, mode: 'cash',
  received_at: '2026-10-05', client_ref: ref, by: SHOP, strict_date: false, warn: { acknowledge: [], country, name: 'Buyer' } }));

async function scenario(country) {
  const { due } = SETTING[country];
  const X = await shopWithDue(country);
  const pay = (ref) => payOf(X, country, ref);
  const settled = await Promise.allSettled([pay('race-1'), pay('race-2'), pay('race-3')]);
  const won = settled.filter((r) => r.status === 'fulfilled'), lost = settled.filter((r) => r.status === 'rejected');
  ok(country + ' · three full-due payments at once: exactly ONE posts, the others are refused 409 ALREADY_PAID (never a second posting)',
    won.length === 1 && lost.length === 2 && lost.every((r) => r.reason && r.reason.code === 'ALREADY_PAID' && r.reason.status === 409),
    JSON.stringify(settled.map((r) => r.status === 'fulfilled' ? 'posted' : String(r.reason && (r.reason.code || r.reason.message)))));
  const items = await X.B.partyItems(X.db, SHOP, BUYER, null);
  const outstanding = X.E.receivables().outstanding(items);
  const party = Number(outstanding.by_party[BUYER] || 0);
  ok(country + ' · what the buyer owes after the race is 0, never -' + due + ' (an advance nobody confirmed)', party === 0, 'by_party ' + party);
  const payments = X.T.payments ? X.T.payments.length : null;
  ok(country + ' · one payment row', payments === null || payments === 1, String(payments));
}

(async () => {
  console.log('\n== FIN-77 · parallel full-due payments ==\n');
  if (!H.enginesSrc().dir) { console.log('   SKIP: ' + H.enginesSrc().why + '\n\n0 checks'); process.exit(1); }
  await scenario('IN');
  await scenario('AU');
  /* the sequential control: the second one after the first is refused too (it always was) */
  const X = await shopWithDue('IN');
  await payOf(X, 'IN', 'seq-1');
  const second = await payOf(X, 'IN', 'seq-2').then(() => null, (e) => e);
  ok('control · one after the other, the second is refused 409 ALREADY_PAID', !!second && second.code === 'ALREADY_PAID' && second.status === 409, String(second && (second.code || second.message)));
  /* the same client_ref twice at once (a retry): one posts, the other is the REPLAY of it (duplicate: true), never refused */
  const R = await shopWithDue('IN');
  const twin = await Promise.allSettled([payOf(R, 'IN', 'same-ref'), payOf(R, 'IN', 'same-ref')]);
  const dups = twin.filter((r) => r.status === 'fulfilled' && r.value.payment.duplicate === true).length;
  ok('same client_ref twice at once: both answer, exactly one is the replay (duplicate: true), none refused', twin.every((r) => r.status === 'fulfilled') && dups === 1, JSON.stringify(twin.map((r) => r.status === 'fulfilled' ? r.value.payment : String(r.reason && r.reason.code))));
  ok('…and one payment row, the buyer owes 0', R.T.payments.length === 1 && Number((R.E.receivables().outstanding(await R.B.partyItems(R.db, SHOP, BUYER, null)).by_party[BUYER]) || 0) === 0, String(R.T.payments.length));
  const src = fs.readFileSync(path.join(H.API, 'lib', 'books.js'), 'utf8');
  const at = src.indexOf('async function askDuplicateRule'), lockAt = src.indexOf('S.lockParty', at), askAt = src.indexOf('proposeFor(handle, entity, { party: payment.party_id', at);
  ok('source pin · askDuplicateRule (the payment question) takes S.lockParty BEFORE the duplicate question reads the party (proposeFor)', at > 0 && lockAt > at && askAt > lockAt, [at, lockAt, askAt].join(' '));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n\n' + (pass + fail) + ' checks');
  CLOCK.reset();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
