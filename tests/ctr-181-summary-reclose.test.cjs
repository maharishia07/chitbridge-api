/**
 * tests/ctr-181-summary-reclose.test.cjs — CTR-181: A DAY CLOSED, REOPENED AND CLOSED AGAIN IS A NEW VERSION, NOT "DUPLICATE".
 * The real send route over a stand-in db. A counter summary is sent under the fixed reference SUM/D/<till>/<day>; the shop already holds the first close.
 * Same figures → 200 duplicate:true naming the newest chit, nothing stored; new figures → stored as the next version under "<ref>#<n>" (summary.revision,
 * summary.supersedes), the held chit untouched; a late retry of an older close is a replay, never a version. Two carried totals are compared, nothing is
 * recomputed. Hand figures: first close 10 bills / 1180.00; reopened and closed with 15 bills / 1770.00; closed a third time back at 10 bills / 1180.00.
 * OWNS      the verdict of lib/summary-reclose (judge) and its route door (routes/chits sendReplay → summaryReclose).
 * CALLED BY scripts/guards.cjs (the offline gate).
 * FLOW      POST /api/chits/send → sendReplay → lib/summary-reclose judge, real, over a stand-in db
 * CARD      09-counter/day-close
 * MIN unit-per-rule
 * MIN refusal-path
 * MIN fail-closed
 * Run: node tests/ctr-181-summary-reclose.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
let pass = 0,
  fail = 0;
const ok = (name, cond, why) => {
  if (cond) {
    pass++;
    console.log('   ok   ' + name);
  } else {
    fail++;
    console.log('   FAIL ' + name + (why ? '\n          ' + String(why).slice(0, 300) : ''));
  }
};
const J = (x) => JSON.stringify(x);
const SHOP = '11111111-1111-4111-8111-111111111111';
const shopRow = { status: 'active', identity_type: 'entity', identity_id: SHOP, bridge_id: 'CB-SHOP', display_name: 'Test Shop', country: 'IN', gstn: '33AABCK1234F1Z6', policy_flags: { price_includes_tax: 'no' } };
const REF = 'SUM/D/C1/2026-11-12';
let HELD = []; /* what the shop already holds: [{ ref, chit_id, summary }] oldest first */
let LOOKUP_FAILS = false;
function rowsFor(sql, params) {
  const s = String(sql);
  if (/to_regprocedure\('chit_deliver/.test(s)) return [{ ok: true }];
  if (/LIKE \$3/.test(s)) {
    if (LOOKUP_FAILS) throw new Error('the versions read failed');
    return HELD.filter((h) => h.ref === params[1] || h.ref.indexOf(params[1] + '#') === 0).map((h) => ({ chit_id: h.chit_id, summary: h.summary }));
  }
  if (/business_json->>'client_ref' = \$2/.test(s)) return HELD.filter((h) => h.ref === params[1]).slice(0, 1).map((h) => ({ chit_id: h.chit_id, till_id: 'C1', billed_at: null }));
  if (/SELECT self_copy_pref/.test(s)) return [{ self_copy_pref: null }];
  if (/FROM identities/.test(s) && /identity_id = ANY/.test(s)) return (params[0] || []).map((id) => (id === SHOP ? shopRow : null)).filter(Boolean);
  if (/FROM identities/.test(s) && /identity_id = \$1/.test(s)) return params && params[0] === SHOP ? [shopRow] : [];
  return [];
}
const bound = require('./support/bound-db.cjs').boundDb(rowsFor);
const dbPath = require.resolve(path.join(API, 'db'));
const tx = { query: async (s, p) => ({ rows: rowsFor(s, p) }) };
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (s, p) => ({ rows: rowsFor(s, p) }),
    queryAs: bound.queryAs, queryFor: bound.queryFor, /* SEC-75: a bound read; blank id or another shop's predicate sees no row */
    withEntity: async (id, fn) => fn(tx),
    withTransaction: async (fn) => fn(tx),
    trySavepoint: async (db, fn, fb) => {
      try {
        return await fn(db);
      } catch (_) {
        return fb;
      }
    },
    onEntity: async (id, db, fn) => fn(tx)
  }
};
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: Object.assign(
    (req, res, next) => {
      const holder = require(path.join(API, 'lib', 'holder')).holderOf;
      req.identity = { identity_id: SHOP, identity_type: 'entity', bridge_id: 'CB-X', display_name: 'Caller' };
      req.api_key = { scopes: ['till'] };
      req.till = holder({ kind: 'api_key', jti: 'k1', scopes: ['till'] }, { till: { id: 'C1' } });
      next();
    },
    { entityOf: (req) => req.identity.identity_id, requireScope: () => (q, s, n) => n(), userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }
  )
};
const mint = require(path.join(API, 'lib', 'mint'));
let COPIES = null;
let ON_DELIVER = null; /* a hook that runs as the write is reached: it may throw the unique-reference refusal a lost race meets */
mint.deliver = async (sender, chit_id, copies) => {
  if (ON_DELIVER) ON_DELIVER(copies);
  COPIES = copies;
  return { ok: true };
};
const LOST_RACE = () => Object.assign(new Error('duplicate key value violates unique constraint "b263_client_ref"'), { code: '23505', constraint: 'b263_client_ref' });
try {
  require(path.join(API, 'lib', 'books-hooks')).afterChit = () => Promise.resolve({});
  require(path.join(API, 'lib', 'meter')).meter = async () => {};
  require(path.join(API, 'lib', 'stock-from-chit')).postFor = async () => ({ failed: [], skipped: [] });
} catch (_) {
  /* a hook that is not loaded in this harness needs no stub */
}
require(path.join(API, 'lib', 'tax-shelf')).readShelf = async () => null;
require(path.join(API, 'lib', 'notify')).sendSupportAlert = async () => ({ ok: true });
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));
let PORT = 0;
async function send(body) {
  COPIES = null;
  const res = await fetch('http://127.0.0.1:' + PORT + '/api/chits/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: J(body) });
  return { status: res.status, answer: await res.json().catch(() => ({})), copies: COPIES };
}
/** the chit the till queues for a day (rollup.chitOf's shape): a general chit carrying business_json.summary */
const close = (bills, total, at) => {
  const summary = { period: 'day', key: '2026-11-12', till: { id: 'C1', name: 'Counter 1' }, totals: { bills, total, tax: 0, refunds: 0 }, summarised_at: at, synced_at: null };
  return { client_ref: REF, purpose: 'general', subject: 'Day summary — 2026-11-12 — Counter 1', recipients: [{ self: true, name: 'self' }], line_items: [], business_json: { summary, till: summary.till } };
};
const storedOf = (copies) => copies && (copies.find((c) => c.direction === 'sent') || copies[0]);
const refOfStored = (copies) => {
  const row = storedOf(copies);
  return row && row.business_json && row.business_json.client_ref;
};

(async () => {
  const server = app.listen(0);
  PORT = server.address().port;
  try {
    HELD = [];
    const first = await send(close(10, 1180, '2026-11-12T18:00:00Z'));
    ok('the first close is stored under the day reference: 200, not a duplicate, no version stamped', first.status === 200 && !first.answer.duplicate && refOfStored(first.copies) === REF && !storedOf(first.copies).business_json.summary.revision, J([first.status, first.answer, refOfStored(first.copies)]));
    HELD = [{ ref: REF, chit_id: 'held-1', summary: storedOf(first.copies).business_json.summary }];

    const same = await send(close(10, 1180, '2026-11-12T18:00:00Z'));
    ok('the identical close again (a retry) → 200 duplicate:true with the held chit, nothing stored', same.status === 200 && same.answer.duplicate === true && same.answer.chit_id === 'held-1' && same.copies === null, J([same.status, same.answer]));
    const retryLater = await send(close(10, 1180, '2026-11-12T18:30:00Z'));
    ok('the same figures re-folded at another moment → still a replay (the figures decide, not the clock)', retryLater.status === 200 && retryLater.answer.duplicate === true && retryLater.copies === null, J([retryLater.status, retryLater.answer]));

    const second = await send(close(15, 1770, '2026-11-12T21:00:00Z'));
    const stored2 = storedOf(second.copies);
    ok('the day reopened and closed with 15 bills / 1770 → 200, STORED (not duplicate), under SUM/D/C1/2026-11-12#2', second.status === 200 && !second.answer.duplicate && refOfStored(second.copies) === REF + '#2', J([second.status, second.answer, refOfStored(second.copies)]));
    ok('the stored summary carries the new figures, revision 2, and names the chit it supersedes', stored2 && stored2.business_json.summary.totals.bills === 15 && stored2.business_json.summary.totals.total === 1770 && stored2.business_json.summary.revision === 2 && stored2.business_json.summary.supersedes === 'held-1', J(stored2 && stored2.business_json.summary));
    ok('it is still a general chit with no lines (a summary posts nothing: the books read the bills)', stored2 && stored2.purpose === 'general' && (stored2.line_items || []).length === 0, J(stored2 && [stored2.purpose, stored2.line_items]));
    HELD.push({ ref: REF + '#2', chit_id: 'held-2', summary: stored2.business_json.summary });

    const retry2 = await send(close(15, 1770, '2026-11-12T21:00:00Z'));
    ok('a retry of that second close → 200 duplicate:true naming the NEWEST chit (held-2), revision 2, nothing stored', retry2.status === 200 && retry2.answer.duplicate === true && retry2.answer.chit_id === 'held-2' && retry2.answer.revision === 2 && retry2.copies === null, J([retry2.status, retry2.answer]));
    const late = await send(close(10, 1180, '2026-11-12T18:00:00Z'));
    ok('a LATE retry of the first close (same moment, older figures) → a replay of the first chit, never a version', late.status === 200 && late.answer.duplicate === true && late.answer.chit_id === 'held-1' && late.copies === null, J([late.status, late.answer]));
    const back = await send(close(10, 1180, '2026-11-12T22:00:00Z'));
    ok('the day closed again back at the FIRST figures but a new moment → compared with the newest (1770), so a third version', back.status === 200 && refOfStored(back.copies) === REF + '#3' && storedOf(back.copies).business_json.summary.supersedes === 'held-2', J([back.status, back.answer, refOfStored(back.copies)]));
    HELD.push({ ref: REF + '#3', chit_id: 'held-3', summary: storedOf(back.copies).business_json.summary });

    const reordered = close(10, 1180, '2026-11-12T23:00:00Z');
    reordered.business_json.summary.totals = { refunds: 0, tax: 0, total: 1180, bills: 10 };
    const sameInOtherOrder = await send(reordered);
    ok('the same totals written with the keys in another order → the same figures: replay of the newest', sameInOtherOrder.status === 200 && sameInOtherOrder.answer.duplicate === true && sameInOtherOrder.answer.chit_id === 'held-3', J([sameInOtherOrder.status, sameInOtherOrder.answer]));

    /* a held number that is not a summary is not touched: the branch only judges summaries */
    HELD = [{ ref: 'C1/26-27/0041', chit_id: 'bill-1', summary: null }];
    const notSummary = await send({ client_ref: 'C1/26-27/0041', purpose: 'order', subject: 'Bill', recipients: [{ self: true, name: 'self' }], line_items: [], business_json: { bill_no: 'C1/26-27/0041', till: { id: 'C1' } } });
    ok('a held NUMBER that is not a summary keeps the ordinary replay answer (200 duplicate:true)', notSummary.status === 200 && notSummary.answer.duplicate === true && notSummary.answer.chit_id === 'bill-1', J([notSummary.status, notSummary.answer]));

    /* the versions read throws: the old answer (a replay), and the fall-back is SAID */
    HELD = [{ ref: REF, chit_id: 'held-1', summary: close(10, 1180, 'x').business_json.summary }];
    const logger = require(path.join(API, 'lib', 'logger'));
    const realWarn = logger.warn;
    const SAID = [];
    logger.warn = (words) => {
      SAID.push(String(words));
    };
    LOOKUP_FAILS = true;
    const broken = await send(close(15, 1770, '2026-11-12T21:00:00Z'));
    LOOKUP_FAILS = false;
    logger.warn = realWarn;
    ok('the versions read throws → answered as before (200 duplicate:true), never a blocked close', broken.status === 200 && broken.answer.duplicate === true, J([broken.status, broken.answer]));
    ok('and the fall-back was said', SAID.some((words) => /summary re-close lookup failed/.test(words)), J(SAID));
    /* ── TWO RE-CLOSES, ONE VERSION NUMBER: the loser's write meets the unique reference; it is judged again, never called the winner duplicate ── */
    const winner = (bills, total, at) => ({ ref: REF + '#2', chit_id: 'won-2', summary: close(bills, total, at).business_json.summary });
    HELD = [{ ref: REF, chit_id: 'held-1', summary: close(10, 1180, '2026-11-12T18:00:00Z').business_json.summary }];
    let writes = 0;
    ON_DELIVER = () => {
      writes++;
      if (writes === 1) {
        HELD.push(winner(20, 2360, '2026-11-12T21:00:00Z')); /* the other request stored #2 first */
        throw LOST_RACE();
      }
    };
    const lost = await send(close(15, 1770, '2026-11-12T21:00:05Z'));
    ON_DELIVER = null;
    ok('a lost race with DIFFERENT totals → judged again: stored as #3 (not the winner duplicate), superseding the winner', lost.status === 200 && !lost.answer.duplicate && refOfStored(lost.copies) === REF + '#3' && storedOf(lost.copies).business_json.summary.supersedes === 'won-2' && storedOf(lost.copies).business_json.summary.totals.bills === 15, J([lost.status, lost.answer, refOfStored(lost.copies)]));
    HELD = [{ ref: REF, chit_id: 'held-1', summary: close(10, 1180, '2026-11-12T18:00:00Z').business_json.summary }];
    writes = 0;
    ON_DELIVER = () => {
      writes++;
      if (writes === 1) {
        HELD.push(winner(15, 1770, '2026-11-12T21:00:00Z'));
        throw LOST_RACE();
      }
    };
    const sameLost = await send(close(15, 1770, '2026-11-12T21:00:05Z'));
    ON_DELIVER = null;
    ok('a lost race with the SAME totals as the winner → 200 duplicate:true naming the winner, nothing stored', sameLost.status === 200 && sameLost.answer.duplicate === true && sameLost.answer.chit_id === 'won-2' && sameLost.copies === null, J([sameLost.status, sameLost.answer]));
    /* a second loss is not a rerun again: the race answer asks about the VERSION's reference (req.body.client_ref = "<ref>#n"), not the day's — so it is not the first close duplicate */
    HELD = [{ ref: REF, chit_id: 'held-1', summary: close(10, 1180, '2026-11-12T18:00:00Z').business_json.summary }];
    writes = 0;
    ON_DELIVER = () => {
      writes++;
      if (writes === 1) HELD.push(winner(20, 2360, '2026-11-12T21:00:00Z'));
      throw LOST_RACE();
    };
    const twice = await send(close(15, 1770, '2026-11-12T21:00:05Z'));
    ON_DELIVER = null;
    ok('losing twice is not answered as the first close duplicate (the version reference is what the race answer asks about)', !(twice.status === 200 && twice.answer.duplicate === true), J([twice.status, twice.answer]));

    /* ── the module itself, one check per rule (not only through the door) ── */
    const reclose = require(path.join(API, 'lib', 'summary-reclose'));
    const dbOf = (rows) => ({ query: async () => ({ rows }) });
    const heldRow = (id, bills, rev) => ({ chit_id: id, summary: { totals: { bills }, summarised_at: 't' + bills, revision: rev } });
    const incoming = (bills, at) => ({ purpose: 'general', business_json: { summary: { totals: { bills }, summarised_at: at } } });
    ok('judge: a body that is not a summary gives no verdict (null)', (await reclose.judge(dbOf([heldRow('a', 1)]), SHOP, REF, { purpose: 'order', business_json: {} })) === null);
    ok('judge: nothing held under the reference gives no verdict (null)', (await reclose.judge(dbOf([]), SHOP, REF, incoming(1, 'x'))) === null);
    ok('judge: the same figures as the newest → replay of that chit', J(await reclose.judge(dbOf([heldRow('a', 1), heldRow('b', 2, 2)]), SHOP, REF, incoming(2, 'z'))) === J({ replay: 'b', revision: 2 }));
    ok('judge: other figures → the next version after the highest held, naming the newest', J(await reclose.judge(dbOf([heldRow('a', 1), heldRow('b', 2, 2)]), SHOP, REF, incoming(3, 'z'))) === J({ version: 3, ref: REF + '#3', supersedes: 'b' }));
    ok('judge: a till id with LIKE characters is escaped in the pattern (never a wildcard)', await (async () => { let seen; await reclose.judge({ query: async (sql, params) => { seen = params; return { rows: [] }; } }, SHOP, 'SUM/D/C_1%/d', incoming(1, 'x')); return seen[2] === 'SUM/D/C!_1!%/d#%'; })());
    ok('judge: gapped revisions (1, 3) → the next is 4, the highest held plus one, never the count plus one', J(await reclose.judge(dbOf([heldRow('a', 1), heldRow('c', 3, 3)]), SHOP, REF, incoming(9, 'z'))) === J({ version: 4, ref: REF + '#4', supersedes: 'c' }));
    ok('judge: the versions read asks only for general chits of this shop and this reference (purpose filter, entity, LIKE ... ESCAPE)', await (async () => { let text = ''; await reclose.judge({ query: async (sql) => { text = String(sql); return { rows: [] }; } }, SHOP, REF, incoming(1, 'x')); return /purpose = 'general'/.test(text) && /entity_id = [$]1/.test(text) && /LIKE [$]3 ESCAPE/.test(text); })());
    ok('baseRef strips only the version suffix', reclose.baseRef(REF + '#12') === REF && reclose.baseRef(REF) === REF);
    let refusedClosed = null;
    try {
      await reclose.judge({ query: async () => { throw new Error('the database is down'); } }, SHOP, REF, incoming(1, 'x'));
    } catch (e) {
      refusedClosed = e.message;
    }
    ok('judge: a database that is down is thrown, never an invented verdict (the route answers as before)', refusedClosed === 'the database is down', refusedClosed);
  } finally {
    server.close();
  }
  console.log(String.fromCharCode(10) + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
