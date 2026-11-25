/**
 * books-cashflow-open-items.test.cjs — SPEED (batch 1129): GET /cashflow (and /overview's cash, which calls the same read) reads the OPEN documents of the debtors and creditors, not every row since the shop began.
 * Over a five-year history (hundreds of settled bills and their receipts, a few still open, a disputed bill, a bill dated ahead) the answer is IDENTICAL to the old read of every row, on several days and both horizons;
 * the rows read fall from the whole history to the open documents; a PAST day still reads every row (a bill paid since was open then).
 * The choice itself is lib/books-side-items.js (shared with Dues): from today the open documents, a past day every row; it never refuses and never throws of its own, a store failure passes through (fail closed: the read answers an error, never a partial figure).
 * MIN unit-per-rule · MIN refusal-path · MIN fail-closed (lib/books-side-items.js: the choice by day, below; a store failure passes through, never a partial figure)
 * Offline: the in-memory books (tests/support/books-memory.cjs openItems is the twin of lib/books-open-items.rowsSql). Run: node tests/books-cashflow-open-items.test.cjs
 * CARD      16-finance/cash-position-and-cash-flow
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', KUMAR = '44444444-4444-4444-8444-444444444444';
const authFor = (who) => Object.assign((req, res, next) => { req.identity = who; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const ask = (port, method, p) => new Promise((done) => {
  const r = http.request({ host: '127.0.0.1', port, path: '/api/books' + p, method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'oi-enable' } }, (res) => { let raw = ''; res.on('data', (c) => { raw += c; }); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(method === 'POST' ? '{}' : '');
});
const day = (n) => new Date(Date.UTC(2021, 9, 1) + n * 86400000).toISOString().slice(0, 10);

(async () => {
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n\n  ✓ 0 passed · 0 checks\n'); process.exit(1); }
  const X = H.load({ auth: authFor({ identity_id: SHOP, identity_type: 'entity', display_name: 'Shop' }) });
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); CLOCK.set('2026-10-12T06:00:00Z');
  const SIDE = require(path.join(H.API, 'lib', 'books-side-items')); /* the choice itself, unit by unit */
  const express = require('express'), app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port;
  X.T.parties.push({ owner: SHOP, party_id: KUMAR, party_no: 'P-00003', name: 'Kumar Wholesale', supplier: true, customer: true, credit_days: 5 });
  try {
    await ask(port, 'POST', '/enable');
    const chart = await X.store.accounts(X.db, SHOP), debtors = chart.find((a) => a.role === 'debtors'), cred = chart.find((a) => a.role === 'creditors');
    ok('the books have both control accounts', !!debtors && !!cred);
    /* five years: 900 settled bills (bill row + receipt row + allocation pair), then what is still open */
    let id = 0;
    const row = (acct, side, ref, against, kind, amount, date, due, extra) => X.T.items.push(Object.assign({ item_id: 'o' + (++id), entity_id: SHOP, account_id: acct.account_id, party_id: KUMAR, party: KUMAR, side, ref, against_ref: against, ref_kind: kind, kind: 'sale', amount_minor: amount, pending_minor: 0, currency: 'INR', doc_date: date, date, due_date: due || null, created_at: date + 'T06:00:00Z' }, extra || {}));
    for (let n = 0; n < 900; n++) {
      const acct = n % 2 ? cred : debtors, side = n % 2 ? 'payable' : 'receivable', amt = 10000 + (n % 37) * 1300, pay = 'pay:' + n;
      row(acct, side, 'B' + n, 'B' + n, 'bill', amt, day(n * 2), day(n * 2 + 15));
      row(acct, side, pay, pay, 'on_account', -amt, day(n * 2 + 5));
      row(acct, side, pay, 'B' + n, 'allocation', -amt, day(n * 2 + 5)); row(acct, side, pay, pay, 'allocation', amt, day(n * 2 + 5));
    }
    row(debtors, 'receivable', 'OPEN-1', 'OPEN-1', 'bill', 4200000, '2026-10-05', '2026-10-20');
    row(debtors, 'receivable', 'OPEN-AHEAD', 'OPEN-AHEAD', 'bill', 900000, '2026-10-20', '2026-11-05'); /* dated after today: still in the cash view, as before */
    row(debtors, 'receivable', 'OPEN-DISP', 'OPEN-DISP', 'bill', 700000, '2026-09-01', '2026-09-20'); row(debtors, 'receivable', 'OPEN-DISP', 'OPEN-DISP', 'status', 0, '2026-09-02', null, { status: 'disputed' });
    row(cred, 'payable', 'PB-OPEN', 'PB-OPEN', 'bill', 1800000, '2026-10-08', '2026-10-16');
    const all = X.T.items.length;
    const realOpen = X.store.openItems, realItems = X.store.items, read = { items: 0, openItems: 0, rows: 0 };
    const counted = (name, real) => async (...a) => { const r = await real.apply(X.store, a); read[name]++; read.rows += r.length; return r; };
    X.store.items = counted('items', realItems);
    const reset = () => { read.items = 0; read.openItems = 0; read.rows = 0; };
    const newRead = async (p) => { X.store.openItems = counted('openItems', realOpen); return ask(port, 'GET', p); };
    const oldRead = async (p) => { X.store.openItems = async (db, e, account) => X.store.items(db, e, null, account); return ask(port, 'GET', p); }; /* what the route did before: every row */

    for (const today of ['2026-10-12', '2026-10-25', '2027-01-03']) {
      CLOCK.set(today + 'T06:00:00Z');
      for (const days of [7, 30]) {
        const p = '/cashflow?days=' + days;
        reset(); const now = await newRead(p), after = Object.assign({}, read);
        reset(); const before = await oldRead(p), then = Object.assign({}, read);
        ok(today + ' days=' + days + ': 200 and the answer is identical to the read of every row', now.status === 200 && before.status === 200 && JSON.stringify(now.body) === JSON.stringify(before.body), now.status + ' ' + JSON.stringify(now.body).slice(0, 200));
        if (today === '2026-10-12' && days === 30) {
          ok('the answer is not empty: the open bills, the one dated ahead and the disputed one are all in it', now.body.series.length === 30 && now.body.in_minor > 0 && now.body.out_minor > 0 && JSON.stringify(now.body).indexOf('OPEN-') >= 0, JSON.stringify(now.body).slice(0, 300));
          ok('rows read: ' + then.rows + ' before → ' + after.rows + ' after (of ' + all + ' in the books)', then.rows >= 3600 && after.rows <= 12 && after.items === 0 && after.openItems === 2, JSON.stringify([then, after]));
        }
      }
    }
    CLOCK.set('2026-10-12T06:00:00Z');
    reset(); X.store.openItems = counted('openItems', realOpen);
    const past = await ask(port, 'GET', '/cashflow?days=7&asOf=2026-10-01');
    ok('a PAST day still reads every row (a bill paid since was open then)', past.status === 200 && read.items === 2 && read.openItems === 0 && read.rows >= 3600, JSON.stringify(read));
    const asked = [], fake = { openItems: async (...a) => { asked.push(['open', a[3]]); return []; }, items: async () => { asked.push(['all']); return []; } };
    const real = require(path.join(H.API, 'lib', 'books-store')); const keep = [real.openItems, real.items]; real.openItems = fake.openItems; real.items = fake.items;
    try {
      await SIDE.read(null, SHOP, {}, '2026-10-12', 'acc', false); await SIDE.read(null, SHOP, {}, '2026-10-12', 'acc', true); await SIDE.read(null, SHOP, {}, '2026-10-11', 'acc', true);
    } finally { real.openItems = keep[0]; real.items = keep[1]; }
    ok('side items: today unbounded = open documents with no day; today bounded = open documents cut at the day; a past day = every row', JSON.stringify(asked) === JSON.stringify([['open', null], ['open', '2026-10-12'], ['all']]), JSON.stringify(asked));
  } finally { CLOCK.reset(); srv.close(); }
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(e && e.stack || e); process.exit(1); });
