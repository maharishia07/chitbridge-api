'use strict';
/**
 * tests/books-counter-snapshot.test.cjs — WHAT THE COUNTER IS TOLD ABOUT THE LEDGER (critic M5 · F2 · F3 · M8, 2026-09-30).
 *
 * The counter showed "On credit" and "Received" to a shop whose ledger is OFF: the snapshot carried no "ledger on" flag,
 * so the server posted nothing and the debt existed only as words on a chit. GET /api/till/snapshot now carries
 *
 *     books: true          ← top level of the snapshot, PRESENT ONLY when books_setting.enabled (absent = off / unknown)
 *
 * and the dues query (each customer's balance_minor and open_bills) runs only for a shop whose ledger is on. In that query:
 * only the RECEIVABLE side is summed (a party who is also a supplier must not have what the shop owes them added to what
 * they owe), and a bill is disputed only while its LATEST dispute row says so (BOOL_OR never cleared).
 *
 * Run: node tests/books-counter-snapshot.test.cjs   · no DB, no network (a port the OS chooses).
 */
process.env.TZ = 'Asia/Kolkata';            /* ⚠️ east of UTC on purpose: a `date` column read with toISOString() is the day before */
const path = require('path');
const API = path.join(__dirname, '..');
const pgDate = require('pg').types.getTypeParser(1082);

let queries = [];
let ON = false, MISSING = false, BROKEN = false, LOGGED = [];
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
function rowsFor(sql) {
  if (/FROM books_setting/.test(sql)) {
    if (MISSING) throw Object.assign(new Error('relation "books_setting" does not exist'), { code: '42P01' });
    if (BROKEN) throw new Error('timeout exceeded when trying to connect');
    return ON ? [{ entity_id: 'e1', enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' }] : [];
  }
  if (/FROM identities WHERE identity_id/.test(sql)) return [{ display_name: 'Shop', gstn: null, country: 'IN', policy_flags: {}, user_id: 'shop' }];
  if (/FROM entity_profile/.test(sql)) return [{ trade_mode: null, markets: null, sectors: ['grocery'], adopted: null }];
  if (/count\(\*\)::int AS n FROM catalogue_items/.test(sql)) return [{ n: 1 }];
  if (/FROM catalogue_items/.test(sql)) return [{ item_id: 'i1', item_data: { name: 'Rice', price: 60, unit: 'kg' }, is_active: true, updated_at: '2026-09-29T10:00:00.000Z' }];
  if (/FROM customer_list/.test(sql)) return [
    { identity_id: 'c1', display_name: 'Kumar', phone: '9', groups: [], last_txn_at: null, credit_days: '10', credit_limit_minor: '500000', has_party_item: true },
    { identity_id: 'c2', display_name: 'Mala', phone: '8', groups: [], last_txn_at: null, credit_days: null, credit_limit_minor: null, has_party_item: true }];
  if (/FROM party_item/.test(sql)) return [
    { party_id: 'c1', against_ref: 'bill-1', balance_minor: '11800', due_date: pgDate('2026-10-05'), doc_date: pgDate('2026-09-25'), disputed: false },
    { party_id: 'c1', against_ref: 'bill-2', balance_minor: '5000', due_date: pgDate('2026-10-01'), doc_date: pgDate('2026-09-21'), disputed: true }];
  return [];
}
const dbPath = require.resolve(path.join(API, 'db'));
const realDb = require(dbPath);
const withEntity = async (id, fn) => fn({ query: async (s) => { queries.push(norm(s)); return { rows: rowsFor(String(s)) }; } });
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: Object.assign({}, realDb, {
  query: async (sql) => { queries.push(norm(sql)); return { rows: rowsFor(String(sql)) }; },
  withEntity, withTransaction: (fn) => withEntity(null, fn),
  onEntity: async (id, db, fn) => (db && typeof db.query === 'function') ? fn(db) : withEntity(id, fn),
  readBatch: async (id, actor, stmts) => stmts.map((s) => { queries.push(norm(s.text)); return { rows: rowsFor(String(s.text)) }; }),
}) };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: 'e1', identity_type: 'entity' }; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
    requireScope: () => (req, res, next) => next(), userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };
const logger = require(path.join(API, 'lib', 'logger')); const warn0 = logger.warn;
logger.warn = (m, c) => { LOGGED.push(m); };

const express = require('express');
const app = express();
app.use('/api/till', require(path.join(API, 'routes', 'till')));
const hooks = require(path.join(API, 'lib', 'books-hooks'));

let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); } };

const srv = app.listen(0, '127.0.0.1', async () => {
  const snap = async () => { queries = []; LOGGED = []; hooks.forget('e1'); const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/till/snapshot`); return { status: r.status, body: await r.json().catch(() => ({})), queries: queries.slice(), logged: LOGGED.slice() }; };
  try {
    /* ── the ledger OFF (the table is there; this shop has no row, or is not enabled) ── */
    ON = false;
    const off = await snap();
    t('ledger OFF: the snapshot answers 200 and carries NO `books` key', off.status === 200 && !('books' in off.body), JSON.stringify(off.body.books));
    t('…the dues query does not run at all (it ran for every shop once b273 existed)', !off.queries.some((q) => /FROM party_item/.test(q)), off.queries.filter((q) => /party_item/.test(q)).join(' | ').slice(0, 200));
    t('…and no customer is stamped with a balance (it said balance_minor: 0 — "owes nothing" — for a shop with no ledger)',
      Array.isArray(off.body.customers) && off.body.customers.length === 2 && off.body.customers.every((c) => !('balance_minor' in c) && !('open_bills' in c)), JSON.stringify(off.body.customers));
    t('…the customer\'s own terms still travel (they are the list\'s, not the ledger\'s)', off.body.customers[0].credit_days === 10 && off.body.customers[0].credit_limit_minor === 500000);

    /* ── the ledger ON ── */
    ON = true;
    const on = await snap();
    t('ledger ON: the snapshot carries `books: true` at its top level (what the counter requires: S.books === true)', on.status === 200 && on.body.books === true, JSON.stringify(on.body.books));
    const dq = on.queries.filter((q) => /FROM party_item/.test(q));
    t('…the dues query runs, once', dq.length === 1, String(dq.length));
    t('…over the RECEIVABLE side only (what the shop owes a party is not what the party owes)', dq.length === 1 && /WHERE entity_id = \$1 AND side = 'receivable'/.test(dq[0]), dq[0]);
    t('…a bill is disputed only while its LATEST dispute row says so — never BOOL_OR, which no "undisputed" row could clear',
      dq.length === 1 && !/BOOL_OR/i.test(dq[0]) && /array_agg\(status ORDER BY item_id DESC\) FILTER \(WHERE status IN \('disputed', 'undisputed'\)\)\)\[1\] = 'disputed'/.test(dq[0]), dq[0]);
    t('…in a stated order before the limit (a LIMIT with no ORDER BY cuts arbitrarily)', dq.length === 1 && /ORDER BY .* LIMIT 20000/.test(dq[0]), dq[0]);
    const k = on.body.customers.find((c) => c.identity_id === 'c1'), m = on.body.customers.find((c) => c.identity_id === 'c2');
    t('…Kumar owes ₹168.00 over two open bills, oldest due first', k && k.balance_minor === 16800 && k.open_bills.length === 2 && k.open_bills[0].ref === 'bill-2' && k.open_bills[0].disputed === true, JSON.stringify(k));
    t('…the dates are the dates (due 1 Oct, billed 21 Sep) — not the day before, on a server east of UTC',
      k && k.open_bills[0].due_date === '2026-10-01' && k.open_bills[0].date === '2026-09-21' && k.open_bills[1].due_date === '2026-10-05', JSON.stringify(k && k.open_bills));
    t('…a customer with nothing open owes 0 — known, because the ledger is on', m && m.balance_minor === 0 && Array.isArray(m.open_bills) && m.open_bills.length === 0, JSON.stringify(m));

    /* ── before b272 (the table is not there): the counter still opens, and is told nothing about a ledger ── */
    ON = false; MISSING = true;
    const miss = await snap();
    t('before b272 (no books_setting): still 200, the items and customers arrive, no `books`', miss.status === 200 && !('books' in miss.body) && miss.body.items.length === 1 && miss.body.customers.length === 2,
      miss.status + ' ' + JSON.stringify([miss.body.books, miss.body.items && miss.body.items.length, miss.body.customers && miss.body.customers.length]));
    MISSING = false;

    /* ── the switch cannot be read (a timeout): unknown is NOT "on" — no credit is offered on a guess — and it is said ── */
    ON = true; BROKEN = true;
    const br = await snap();
    t('the switch unreadable: still 200, no `books` (never "on" by guess), and the failure is logged', br.status === 200 && !('books' in br.body) && br.logged.indexOf('books.switch-unread') >= 0,
      br.status + ' ' + JSON.stringify([br.body.books, br.logged]));
    BROKEN = false;
  } catch (e) { fail++; console.log('  FAIL the test ran   ' + (e && e.stack)); }
  logger.warn = warn0;
  console.log(`\n  ${fail ? '✗ ' + fail + ' failed' : '✓ ' + pass + ' passed'} · ${pass + fail} checks\n`);
  process.exitCode = fail ? 1 : 0;
  srv.close();
});
