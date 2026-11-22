#!/usr/bin/env node
// @type: unit
/**
 * tests/l16-audbank.test.cjs - W15-71 and W15-97: THE AUDITOR READS THE BANK, NEVER WRITES IT; A MONTH OPENS NEWEST FIRST.
 *
 *   1 GET /bank/log is on the auditor's allow-list (the marks and who matched, the signed months, the lines posted); GET /bank/rail stays held back (party and bank details)
 *   2 EVERY write route of the books router (each one read from the router, not typed here) is refused to the auditor seat with GRANT_READ_ONLY 403 in words,
 *     through the real front (middleware/books-grant) and the real verdict (lib/books-grant.verdictOf); the bank's own doors are named so none can drop out of the list
 *   3 a month opens only when no later month is locked (W15-97); the page's reopen.may says the same, with the month it waits for
 * The database half (RLS, the log row) is tests/acc-176-books-grant.realstack.cjs. Run: node tests/l16-audbank.test.cjs
 * OWNS      the offline checks of the auditor's bank door and the reopen order.   CALLED BY scripts/guards.cjs   CARD  16-finance/bank-reconciliation-and-bank-rail
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'l16_audbank_test_secret_at_least_32_chars_pad';
const path = require('path');
const assert = require('assert');
const API = path.join(__dirname, '..');
let pass = 0;
let fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (e) {
    fail++;
    console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 400));
  }
};

/* the grant store with its ONE look replaced by the real verdict over a live auditor row: nothing about the decision is faked */
const storePath = require.resolve(path.join(API, 'lib', 'books-grant.js'));
const real = require(storePath);
const MEMBER = '33333333-3333-4333-8333-333333333333';
const liveRow = (preset) => ({ grant_id: '44444444-4444-4444-8444-444444444444', grantor_entity: MEMBER, preset, unexpired: true, edge_live: true, can_see_costs: true });
let seat = 'auditor';
const looked = [];
const stub = Object.assign({}, real, {
  look: async (grantee, member, request) => {
    looked.push(request);
    const row = liveRow(seat);
    return real.answerOf(real.verdictOf(row, request), row);
  }
});
require.cache[storePath].exports = stub;
const A = require(path.join(API, 'middleware', 'books-grant.js'));
const books = require(path.join(API, 'routes', 'books.js'));
const reqctx = require(path.join(API, 'lib', 'reqctx.js'));

const caller = { identity_id: '22222222-2222-4222-8222-222222222222', identity_type: 'actor', parent_entity_id: '11111111-1111-4111-8111-111111111111', access_level: 'commenter', whole_entity: true, can_see_costs: true };
function drive(method, routePath, body) {
  const base = Object.assign((req, res, next) => { req.identity = Object.assign({}, caller); next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id });
  const gate = A.frontOf(base);
  const req = { headers: { 'x-books-for': MEMBER, 'x-books-role': seat }, method, path: routePath, baseUrl: '/api/books', query: {}, body: body || {}, id: 'r1' };
  const out = { nexted: false };
  const res = { status(code) { out.status = code; return this; }, set() { return this; }, setHeader() {}, type() { return this; }, json(b) { out.body = b; return this; }, send(b) { out.body = b; return this; }, end() { return this; }, req, locals: {} };
  return new Promise((resolve) => {
    gate(req, res, () => { out.nexted = true; out.readOnlyInside = reqctx.isReadOnly(); resolve(out); });
    setTimeout(() => resolve(out), 150);
  });
}

/** every non-GET route of the books router: [{ method, path }] */
const writes = books.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods).filter((m) => m !== 'get' && l.route.methods[m]).map((m) => ({ method: m.toUpperCase(), path: l.route.path })));
const sample = (p) => p.replace(/:fy/g, '2026-27').replace(/:p\b/g, '7').replace(/:act/g, 'unlock').replace(/:[a-z_]+/g, '3f2c9e1a-1111-4222-8333-444455556666');

(async () => {
  console.log('\nl16 audbank · the auditor reads the bank (offline)');

  await t('1 GET /bank/log is open to the auditor and in no held-back list; the bank rail stays held back', () => {
    assert.ok(A.GRANT_READS.has('/bank/log'));
    assert.ok(!('/bank/log' in A.GRANT_HELD_BACK));
    assert.ok(!A.GRANT_READS.has('/bank/rail') && '/bank/rail' in A.GRANT_HELD_BACK);
    assert.deepStrictEqual(A.unclassifiedGets(books), []);
    assert.ok(A.listedFor('auditor', { method: 'GET', baseUrl: '/api/books', path: '/bank/log' }));
  });

  await t('1b the auditor seat reads the bank log through the front: allowed, and the rest of the request runs READ ONLY', async () => {
    seat = 'auditor';
    const out = await drive('GET', '/bank/log');
    assert.strictEqual(out.nexted, true, 'status ' + out.status);
    assert.strictEqual(out.readOnlyInside, true);
  });

  await t('2 the books router lists the bank doors that write (none can drop out of this guard unseen)', () => {
    const names = writes.map((w) => w.method + ' ' + w.path);
    for (const door of ['POST /bank/marks', 'POST /bank/statements', 'POST /bank/statement-files', 'POST /events', 'POST /payments', 'POST /periods/:fy/:p/:act', 'POST /year/:fy/close']) assert.ok(names.includes(door), door + ' is not a books route');
    assert.ok(writes.length >= 20, 'only ' + writes.length + ' write routes read from the router');
  });

  for (const w of writes) {
    await t('2 the auditor seat is refused ' + w.method + ' ' + w.path + ' (403 GRANT_READ_ONLY, in words, nothing runs)', async () => {
      seat = 'auditor';
      const out = await drive(w.method, sample(w.path), { client_ref: 'bank:abc-1', kind: 'expense' });
      assert.strictEqual(out.nexted, false, 'the request ran');
      assert.strictEqual(out.status, 403);
      assert.ok(out.body && out.body.code === 'GRANT_READ_ONLY', JSON.stringify(out.body).slice(0, 200));
      assert.strictEqual(out.body.detail, 'An auditor can read these books, never change them.');
    });
  }

  await t('3 reopen newest first: the page rows say which month waits, and a lock is told which earlier month it waits for', () => {
    const B = require(path.join(API, 'lib', 'books.js'));
    const month = (period, status) => ({ fiscal_year: '2026-27', period, status, start_date: '2026-' + String(period + 3).padStart(2, '0') + '-01', end_date: '2026-' + String(period + 3).padStart(2, '0') + '-28' });
    const rows = B.periodAdvice([month(4, 'open'), month(5, 'soft_locked'), month(6, 'soft_locked'), month(7, 'open')], [], '2026-12-01', [], []);
    assert.strictEqual(rows[0].open_below_locked, true, 'July open under two locked months is flagged');
    assert.strictEqual(rows[1].reopen.may, false);
    assert.strictEqual(rows[1].reopen.why, 'Open the later months first.');
    assert.strictEqual(rows[1].reopen.first.period, 6, 'the newest locked month is the one to open first');
    assert.strictEqual(rows[2].reopen.may, true, 'the newest locked month opens');
    assert.strictEqual(rows[0].lock.may, true, 'July itself may lock (nothing earlier)');
    assert.strictEqual(rows[3].open_below_locked, undefined);
    assert.strictEqual(rows[3].lock.first.period, 4, 'Oct waits for the first open month');
  });

  await t('3b the server holds it: opening a month under a locked one is refused in words; newest first works', async () => {
    const B = require(path.join(API, 'lib', 'books.js'));
    const S = require(path.join(API, 'lib', 'books-store.js'));
    const table = [
      { fiscal_year: '2026-27', period: 4, status: 'soft_locked' }, { fiscal_year: '2026-27', period: 5, status: 'soft_locked' }, { fiscal_year: '2026-27', period: 6, status: 'hard_locked' }
    ];
    const Lock = require(path.join(API, 'lib', 'books-period-lock.js'));
    const saved = { periods: S.periods, setPeriodStatus: S.setPeriodStatus, logChange: S.logChange };
    const closedWas = Lock.closedPeriodOf;
    Lock.closedPeriodOf = async () => null; /* F4 (1128): this shop has no tax close; the stand-in handle has no country to read it with */
    const done = [];
    S.periods = async () => table.map((x) => Object.assign({}, x));
    S.setPeriodStatus = async (h, e, fy, p, status) => { done.push([p, status]); table.find((x) => x.period === p).status = status; };
    S.logChange = async () => {};
    try {
      const handle = { query: async () => ({ rows: [] }) };
      const open = (p) => B.setPeriod(handle, MEMBER, '2026-27', p, 'open', 'u', 'fix');
      await assert.rejects(() => open(4), /closed \(hard lock\)|Open the later months first/);
      await assert.rejects(() => open(5), /closed \(hard lock\)/);
      table[2].status = 'soft_locked';
      await assert.rejects(() => open(4), /Open the later months first\./);
      await open(6);
      await open(5);
      await open(4);
      assert.deepStrictEqual(done.map((x) => x[0]), [6, 5, 4]);
    } finally {
      Object.assign(S, saved);
      Lock.closedPeriodOf = closedWas;
    }
  });

  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed');
  process.exit(fail ? 1 : 0);
})();
