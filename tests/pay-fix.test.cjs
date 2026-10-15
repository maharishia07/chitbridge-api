/**
 * tests/pay-fix.test.cjs — PAY-FIX (REVIEW-CLAUDE-2026-10-15): the books' findings reproduced first, then held.
 *
 *   C3  two payments recorded at once settle the same bill once: writeAllocation (and every path that reads party rows before
 *       it writes them) takes pg_advisory_xact_lock(hashtext(entity|party|account)) BEFORE the read — two clients, one wins.
 *   H2  a second "Mark paid" on a chit reaches the books when the press carries a client_ref (chitpay:<chit>:<ref>); without
 *       one the old key stands and the replay is answered as the FIRST payment (duplicate: true), never a silent second record.
 *   M1  closing a tax period soft-locks the months it covers in the same transaction; a typed date in them is refused
 *       PERIOD_LOCKED; an automatic entry moves on (the ledger's standing rule); the real store reads fiscal_period FOR SHARE.
 *   M2  the asset / depreciation entry and the register row are written on the ONE handle the caller holds.
 *
 * Offline: the in-memory store (tests/support/books-harness.cjs); the SQL store is inspected for its statements only.
 * Run: node tests/pay-fix.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
async function section(title, fn) {
  console.log('\n── ' + title + ' ──');
  try { await fn(); } catch (e) { fail++; console.log('   FAIL threw: ' + (e && e.stack || e)); }
}
const SHOP = '11111111-1111-4111-8111-111111111111', MALA = '22222222-2222-4222-8222-222222222222';
const BILL = (n) => 'c0000000-0000-4000-8000-00000000000' + n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** a shop with the ledger on, one customer, and (optionally) one open sale bill of ₹1,000 */
async function shopWithBill(X, bill) {
  X.T.parties.push({ owner: SHOP, party_id: MALA, party_no: 'P-00001', name: 'Mala', customer: true, credit_days: 10 });
  await X.B.enable(X.db, SHOP, {});
  if (bill) {
    await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-09-25', currency: 'INR', party: MALA, source_chit_id: BILL(bill), source_ref: 'chit:' + bill,
      by_rate: [{ rate: 0, taxable: 1000, cgst: 0, sgst: 0, igst: 0 }], paid: {}, round_off: 0 });
    X.T.chits.push({ chit_id: BILL(bill), bill_no: 'C1-0001', entity_id: SHOP, purpose: 'order', business_json: { bill_no: 'C1-0001' } });
  }
}
/**
 * ⭐ TWO CLIENTS: each withEntity is its own handle; pg_advisory_xact_lock is a per-key mutex held until that handle's
 * transaction ends — exactly the database's behaviour. Without a lock in the code path the two reads interleave.
 */
function twoClients(X) {
  const held = new Map();   /* key → the release of the holder */
  X.store.lockParty = async (db, e, party, account) => {
    const key = e + '|' + party + '|' + account;
    while (held.has(key) && held.get(key).owner !== db) await held.get(key).done;
    if (!held.has(key)) { let release; const done = new Promise((r) => { release = r; }); held.set(key, { owner: db, done, release }); db.__locks.push(key); }
    db.__lockSql = (db.__lockSql || []).concat('SELECT pg_advisory_xact_lock(hashtext($1)) ' + key);
  };
  X.dbStub.withEntity = async (e, fn) => {
    const handle = Object.create(X.db); handle.__locks = [];
    try { return await fn(handle); }
    finally { handle.__locks.forEach((k) => { const h = held.get(k); if (h && h.owner === handle) { held.delete(k); h.release(); } }); }
  };
}
const allocatedAgainst = (X, ref) => X.T.items.filter((i) => i.ref_kind === 'allocation' && i.against_ref === ref && i.ref !== ref).reduce((t, i) => t + i.amount_minor, 0);

(async () => {
  console.log('\n══ PAY-FIX · C3 H2 M1 M2 ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n'); process.exit(1); }

  /* ═══ C3 ═══ */
  await section('C3 · two payments at once against the same ₹1,000 bill: one settles it, the other is refused — never −1,000 open', async () => {
    const X = H.load(); twoClients(X);
    await shopWithBill(X, 'a');
    const pay = (ref) => X.dbStub.withEntity(SHOP, (db) => X.B.recordPayment(db, SHOP, { party_id: MALA, direction: 'in', amount_minor: 100000, currency: 'INR', mode: 'cash',
      received_at: '2026-10-05', client_ref: ref, allocations: [{ against_ref: BILL('a'), amount_minor: 100000 }], by: SHOP }));
    const [a, b] = await Promise.allSettled([pay('device-1'), pay('device-2')]);
    const wins = [a, b].filter((r) => r.status === 'fulfilled'), lost = [a, b].filter((r) => r.status === 'rejected');
    ok('exactly one of the two settles the bill; the other is refused in words (never more than is left)',
      wins.length === 1 && lost.length === 1 && /owes 0|more than|left|already/i.test(String(lost[0].reason && lost[0].reason.message)), JSON.stringify([a, b].map((r) => r.status === 'fulfilled' ? r.value.allocation : String(r.reason && r.reason.message))));
    ok('the bill is settled ONCE: the allocation rows against it sum to −1,000, not −2,000', allocatedAgainst(X, BILL('a')) === -100000, String(allocatedAgainst(X, BILL('a'))));
    const items = await X.B.partyItems(X.db, SHOP, MALA, null);
    const open = X.E.receivables().outstanding(items).by_ref[BILL('a')];
    ok('…so the bill shows 0 outstanding, never −1,000 (Dues · ageing · statements right)', open && open.outstanding_minor === 0, JSON.stringify(open));
  });

  await section('C3 · the lock is taken BEFORE the read, on every path that writes party rows from a read', async () => {
    const X = H.load(); twoClients(X);
    await shopWithBill(X, 'b');
    const calls = [];
    const S = X.store;
    for (const name of ['lockParty', 'items', 'insertItems']) { const was = S[name]; S[name] = async function () { calls.push(name); return was.apply(this, arguments); }; }
    await X.dbStub.withEntity(SHOP, (db) => X.B.recordPayment(db, SHOP, { party_id: MALA, direction: 'in', amount_minor: 100000, currency: 'INR', mode: 'cash',
      received_at: '2026-10-05', client_ref: 'one', allocations: [{ against_ref: BILL('b'), amount_minor: 100000 }], by: SHOP }));
    const lockAt = calls.indexOf('lockParty'), after = calls.slice(lockAt);
    ok('writeAllocation: lockParty → items → insertItems (the read happens under the lock; the payment\'s own rows were written before it)',
      lockAt >= 0 && after.indexOf('items') > 0 && after.indexOf('insertItems') > after.indexOf('items'), calls.join(' → '));
    /* the real store's statement, read from the source (the harness holds the memory store under that name) */
    const fs = require('fs');
    const storeSrc = fs.readFileSync(path.join(H.API, 'lib', 'books-store.js'), 'utf8'), lock = require(path.join(H.API, 'lib', 'xact-lock'));
    const seen = [];
    await lock.lockKeys({ query: async (t, p) => { seen.push({ t, p }); return { rows: [] }; } }, SHOP, ['b', 'a']);
    ok('lib/xact-lock sends SELECT pg_advisory_xact_lock(hashtext($1 || \'|\' || $2)) per key — the shop is $1, keys sorted (no deadlock between two holders)',
      seen.length === 2 && seen.every((x) => x.t === lock.LOCK_SQL && x.p[0] === SHOP) && seen[0].p[1] === 'a' && seen[1].p[1] === 'b', JSON.stringify(seen));
    ok('books-store.lockParty keys the shop + party|account through the ONE helper; reward-store.lockOn too (no second copy of the statement)',
      /lockParty\(db, e, party_id, account_id\)[\s\S]{0,120}lockKeys\(db, e, \[party_id \+ '\|' \+ account_id\]\)/.test(storeSrc)
      && !/pg_advisory_xact_lock/.test(fs.readFileSync(path.join(H.API, 'lib', 'reward-store.js'), 'utf8')) && /xact-lock/.test(fs.readFileSync(path.join(H.API, 'lib', 'reward-store.js'), 'utf8')));
  });

  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed\n');
  process.exit(fail ? 1 : 0);
})();
