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

  /* ═══ H2 ═══ */
  await section('H2 · "Mark paid" twice: a press with its own client_ref reaches the books as a second payment; a press without one is the replay of the first', async () => {
    const X = H.load(); twoClients(X);
    await shopWithBill(X, 'f');
    const K = require(path.join(H.API, 'lib', 'books-hooks'));
    const TCp = require(path.join(H.API, 'lib', 'tax-copy')); const wasEntryFor = TCp.entryFor;
    TCp.entryFor = async () => ({ sells: true, buyer: { entity_id: MALA }, seller: { entity_id: SHOP }, me: { entity_id: SHOP } });
    const AT = '2026-10-05T06:00:00Z';
    const copyOf = (pay) => ({ chit_id: BILL('f'), purpose: 'order', sender_entity_id: MALA, created_at: AT, currency_code: 'INR', summary_json: { total_value: 1000 },
      business_json: { payment: Object.assign({ method: 'upi', ref: null, amount: null, note: null, at: AT, by: SHOP }, pay || {}) } });
    const door = (pay) => X.dbStub.withEntity(SHOP, (db) => K.chitPaid(db, SHOP, copyOf(pay), { by: SHOP, acknowledge: ['same_again', 'just_settled', 'excess', 'nothing_owed'], name: 'Mala' }));
    try {
      const r1 = await door({ amount: 500, client_ref: 'press-1' });
      const row1 = X.T.payments.find((p) => p.payment_id === r1.payment.payment_id);
      ok('the first press (₹500 now, client_ref press-1) records under chitpay:<chit>:press-1 and settles ₹500 of the bill',
        r1.payment && r1.payment.duplicate === false && row1 && row1.client_ref === 'chitpay:' + BILL('f') + ':press-1' && allocatedAgainst(X, BILL('f')) === -50000, JSON.stringify([r1, row1 && row1.client_ref]));
      const r2 = await door({ amount: 500, client_ref: 'press-2' });
      ok('the second press (₹500 later, client_ref press-2) REACHES THE BOOKS: a second payment, the bill now settled in full',
        r2.payment && r2.payment.duplicate === false && r2.payment.payment_id !== r1.payment.payment_id && X.T.payments.length === 2 && allocatedAgainst(X, BILL('f')) === -100000, JSON.stringify(r2));
      const r2again = await door({ amount: 500, client_ref: 'press-2' });
      ok('the same press again (a retry, a double tap) → the FIRST answer, duplicate: true, nothing recorded twice', r2again.payment.duplicate === true && r2again.payment.payment_id === r2.payment.payment_id && X.T.payments.length === 2, JSON.stringify(r2again));
      const r3 = await door({ amount: 200 });
      const r3again = await door({ amount: 200 });
      ok('a press with NO client_ref (an older web) keeps the old key chitpay:<chit>: it records once, and again is the replay (duplicate: true) — never a silent second record',
        r3.payment.duplicate === false && r3again.payment.duplicate === true && r3again.payment.payment_id === r3.payment.payment_id && X.T.payments.length === 3
        && X.T.payments.some((p) => p.client_ref === 'chitpay:' + BILL('f')), JSON.stringify([r3, r3again]));
      const mine = await X.store.paymentsOfChit(X.db, SHOP, BILL('f'));
      ok('paymentsOfChit names every payment the chit carries (the three keys), oldest first — the DELETE door names them all', mine.length === 3 && mine[0].payment_id === r1.payment.payment_id, JSON.stringify(mine));
    } finally { TCp.entryFor = wasEntryFor; }
    const fs = require('fs');
    const route = fs.readFileSync(path.join(H.API, 'routes', 'chits.js'), 'utf8');
    const doorSrc = route.slice(route.indexOf("router.post('/:chit_id/payment'"), route.indexOf("router.post('/:chit_id/books-request'"));
    ok('POST /chits/:id/payment takes body.client_ref (≤ 80) into business_json.payment.client_ref, and answers "Already recorded" for a replay, "Payment recorded" otherwise',
      /body\('client_ref'\)\.optional\(\)[^\n]*isLength\(\{ max: 80 \}\)/.test(doorSrc) && /client_ref/.test(doorSrc.slice(0, doorSrc.indexOf('hooks.chitPaid'))) && /'Already recorded'/.test(doorSrc) && /'Payment recorded'/.test(doorSrc));
    ok('DELETE /chits/:id/payment reads paymentsOfChit (every key of the chit), not the one old key', /paymentsOfChit\(db, entity_id, req\.params\.chit_id\)/.test(doorSrc) && !/paymentByRef\(db, entity_id, 'chitpay:'/.test(doorSrc));
  });

  /* ═══ M1 ═══ */
  await section('M1 · a closed tax period locks its months: a typed date is refused, an automatic entry moves on and is set off next time, the posting read holds the months FOR SHARE', async () => {
    const X = H.load(); twoClients(X);
    await shopWithBill(X);
    await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-09-05', currency: 'INR', party: MALA, source_chit_id: BILL('m'), source_ref: 'chit:m',
      by_rate: [{ rate: 18, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }], paid: {}, round_off: 0 });
    const BP = require(path.join(H.API, 'lib', 'books-period'));
    const s = await X.store.setting(X.db, SHOP);
    const close = await BP.gstClose(SHOP, s, { fy: '2026-27', period: 6 }, SHOP);
    const sept = () => X.T.periods.find((x) => x.entity_id === SHOP && x.fiscal_year === '2026-27' && Number(x.period) === 6);
    ok('POST /gst/close for September → the set-off posts AND September is soft-locked in the same transaction, named on the answer (locked: [...])',
      close.ok === true && !close.duplicate && sept().status === 'soft_locked' && JSON.stringify(close.locked) === JSON.stringify([{ fiscal_year: '2026-27', period: 6 }]), JSON.stringify([close.locked, sept()]));
    let refused = null;
    try { await X.B.postEntry(X.db, SHOP, { type: 'contra', from: 'cash', to: 'bank', amount: 1, date: '2026-09-20', currency: 'INR', strict_date: true, owner: true }); } catch (e) { refused = e; }
    ok('a date a person types in September is refused PERIOD_LOCKED', refused && refused.code === 'PERIOD_LOCKED', refused && (refused.code + ' ' + refused.message));
    const late = await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-09-28', currency: 'INR', party: MALA, source_chit_id: BILL('n'), source_ref: 'chit:n',
      by_rate: [{ rate: 18, taxable: 100, cgst: 9, sgst: 9, igst: 0 }], paid: {}, round_off: 0 });
    ok('a late offline counter bill dated September MOVES to 1 October, said (moved: true) — the ledger\'s standing rule, never a silent post into a filed month', late.ok && late.moved === true && late.posting_date === '2026-10-01', JSON.stringify(late));
    const again = await BP.gstClose(SHOP, s, { fy: '2026-27', period: 6 }, SHOP);
    ok('closing September again answers the SAME close (duplicate), not a lock refusal', again.ok && again.duplicate === true, JSON.stringify(again));
    const fs = require('fs');
    const storeSrc = fs.readFileSync(path.join(H.API, 'lib', 'books-store.js'), 'utf8'), booksSrc = fs.readFileSync(path.join(H.API, 'lib', 'books.js'), 'utf8');
    ok('the real store reads fiscal_period FOR SHARE when a posting asks (periods(db, e, fy, lock)); postingDateFor asks it for every non-preview read',
      /async function periods\(db, e, fy, lock\)[\s\S]{0,400}\(lock \? ' FOR SHARE' : ''\)/.test(storeSrc) && /S\.periods\(db, entity, fy, !readOnly\)/.test(booksSrc) && /S\.periods\(db, entity, y, !readOnly\)/.test(booksSrc));
  });

  /* ═══ M2 ═══ */
  await section('M2 · the asset entry and its register row are written on the ONE handle the caller holds', async () => {
    const X = H.load();
    let serial = 0;
    X.dbStub.withEntity = async (e, fn) => { const handle = Object.create(X.db); handle.__id = ++serial; return fn(handle); };
    await shopWithBill(X);
    const Assets = require(path.join(H.API, 'lib', 'books-assets')), seen = { entry: null, register: null, depreciation: null };
    Assets.use({ exists: async () => true, list: async () => [], get: async () => null, bySourceEntry: async () => null,
      insert: async (h, e, a) => { seen.register = h.__id; return { asset_id: 'x', name: a.name, cost_minor: a.cost_minor, accumulated_minor: 0 }; },
      addDepreciation: async (h) => { seen.depreciation = h.__id; }, markDisposed: async () => {} });
    const wasInsert = X.store.insertEntry;
    X.store.insertEntry = async (db, e, hdr) => { seen.entry = db.__id; return wasInsert(db, e, hdr); };
    try {
      const BP = require(path.join(H.API, 'lib', 'books-period'));
      const s = await X.store.setting(X.db, SHOP);
      const r = await BP.addAsset(SHOP, s, { name: 'Laptop', class: 'computers', cost_minor: 4200000, date: '2026-09-10', how: 'bank' }, SHOP);
      ok('POST /assets: the purchase entry and the register row are written on the SAME handle (one transaction — a failure after the entry takes the entry back too)',
        r.ok === true && seen.entry != null && seen.entry === seen.register, JSON.stringify([r.ok, seen]));
      const srcPeriod = require('fs').readFileSync(path.join(H.API, 'lib', 'books-period.js'), 'utf8');
      ok('postOwn(h, …) hands the caller\'s handle to postEntry; every in-transaction caller passes h (assets · dispose · depreciation · closing stock · tax close · tax pay · instalment · accrual reversal)',
        /function postOwn\(h, entity, ev, by, system\) \{\s*return B\.postEntry\(h, entity/.test(srcPeriod) && (srcPeriod.match(/postOwn\(h, entity/g) || []).length >= 8 && !/postOwn\(entity,/.test(srcPeriod));
    } finally { Assets.use(null); X.store.insertEntry = wasInsert; }
  });

  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed\n');
  process.exit(fail ? 1 : 0);
})();
