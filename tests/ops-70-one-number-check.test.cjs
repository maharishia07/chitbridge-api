#!/usr/bin/env node
// @type: contract
/**
 * ops-70-one-number-check.test.cjs — OPS-70 (decided 2026-11-06): POST /api/supplies/purchase reads a quantity and a cost with ONE number check, and says "at no cost".
 *
 * OWNS      the proof that on every line (expensed or counted) a quantity of true / "abc" and a cost of true / "abc" / -5 is refused in words (failed[]) and moves nothing,
 *           that a numeric string is read as its number, and that a line recorded with no cost (absent, "" or 0) is said "at no cost" in the answer's words.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/supplies.js and lib/supply-store.js over a stand-in db and a stand-in lib/stock-store.
 * FLOW      stand-in db + stock + auth → real router on an express app → request over http → recorded · failed · says · what the ledger was asked to post
 * CARD      16-finance/supply-store
 * CARD  12-suppliers-and-procurement/supplies-things-i-buy-to-use
 * MIN contract — each bad number is a failed[] line with its words and 0 postings; each good line posts qty and rate exactly; "at no cost" appears only where a line cost nothing.
 * ENV       OPS70_STORE / OPS70_ROUTE point at a broken copy (tests/ops-70-one-number-check-mutation.test.cjs proves this test goes red on it).
 * TRACE     lib/supply-store.js numbersOf ← this test
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const ROOT = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const posted = [];
const stamped = [];
const stampedCosts = [];

const stub = (rel, exports) => {
  const p = require.resolve(path.join(ROOT, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};
stub('lib/stock-store', {
  post: async (entity, move) => (posted.push(move), { ok: true }),
  movesOfRef: async () => []
});
/* the stand-in db: a supply named "kept ..." is counted, any other is expensed; the stamp statement records which supplies it was asked to stamp */
const idOf = (key) => '00000000-0000-4000-8000-' + String(key.length).padStart(12, '0');
const db = {
  query: async (sql, params) => {
    if (/^\s*UPDATE supply_item/.test(sql)) {
      stamped.push(...params[1]);
      stampedCosts.push(...params[3]);
      return { rows: [] };
    }
    if (/^\s*SELECT supply_item_id/.test(sql)) {
      return { rows: params[1].map((k) => ({ supply_item_id: idOf(k), name: k, unit: null, sku: null, keep_stock: /^kept/.test(k), k })) };
    }
    return { rows: [] };
  }
};
stub('db', { query: db.query, withEntity: async (id, fn) => fn(db), pool: {} });
const stubAuth = (req, res, next) => {
  req.identity = { identity_id: SHOP, identity_type: 'entity', role: 'owner', level: 'manager' };
  next();
};
stubAuth.entityOf = () => SHOP;
stub('middleware/auth', stubAuth);
if (process.env.OPS70_STORE) stub('lib/supply-store', require(path.join(ROOT, process.env.OPS70_STORE)));

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.id = 'req-test';
  next();
});
app.use('/api/supplies', require(path.join(ROOT, process.env.OPS70_ROUTE || 'routes/supplies.js')));

let failed = 0;
let total = 0;
const check = (ok, label) => {
  total++;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
};
let seq = 0;
const buy = (server, line) =>
  new Promise((resolve) => {
    const data = JSON.stringify({ ref: 'B-' + ++seq, lines: [line] });
    posted.length = 0;
    stamped.length = 0;
    stampedCosts.length = 0;
    const req = http.request({ port: server.address().port, method: 'POST', path: '/api/supplies/purchase', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'idempotency-key': 'ops70-' + seq } /* OPS-114: a purchase requires its own key per attempt */ }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.end(data);
  });

/* a line refused: one failed[] entry for line 0 with these words, nothing recorded, nothing posted, nothing stamped */
async function refused(server, label, line, words) {
  const a = await buy(server, line);
  const f = (a.body.failed || [])[0] || {};
  check(a.status === 200 && (a.body.failed || []).length === 1 && f.line === 0 && words.test(f.why || ''), label + ' → failed[0] says "' + (f.why || '') + '" (status ' + a.status + ')');
  check(!(a.body.recorded || []).length && !posted.length && !stamped.length, label + ' → nothing recorded, posted or stamped');
}

(async () => {
  const server = app.listen(0);
  const QTY = /quantity.*not a number/i;
  const COST = /cost.*number.*0 or more/i;
  for (const kind of ['Tape', 'kept Rice']) {
    const keep = kind.startsWith('kept') ? ' (counted)' : ' (expensed)';
    await refused(server, 'qty true' + keep, { name: kind, qty: true, cost: 10 }, QTY);
    await refused(server, 'qty "abc"' + keep, { name: kind, qty: 'abc', cost: 10 }, QTY);
    await refused(server, 'cost -5' + keep, { name: kind, qty: 2, cost: -5 }, COST);
    await refused(server, 'cost "abc"' + keep, { name: kind, qty: 2, cost: 'abc' }, COST);
    await refused(server, 'cost true' + keep, { name: kind, qty: 2, cost: true }, COST);
    await refused(server, 'cost "   " (spaces only)' + keep, { name: kind, qty: 2, cost: '   ' }, COST);
  }

  /* hand-computed: 3 × 20 counted → the ledger is asked for qty 3 at rate 20, and the answer has no "no cost" */
  let a = await buy(server, { name: 'kept Rice', qty: '3', cost: '20' });
  check(posted.length === 1 && posted[0].qty === 3 && posted[0].rate === 20, 'numeric strings "3" and "20" post qty 3 at rate 20 (got ' + JSON.stringify(posted.map((p) => [p.qty, p.rate])) + ')');
  check(a.body.says === '1 line recorded · 1 counted' && a.body.recorded[0].cost === 20, 'a costed counted line says "1 line recorded · 1 counted" (got "' + a.body.says + '")');

  /* hand-computed: counted, no cost → rate 0 posted, said */
  a = await buy(server, { name: 'kept Rice', qty: 4 });
  check(posted.length === 1 && posted[0].qty === 4 && posted[0].rate === 0 && a.body.recorded[0].cost === null, 'a counted line with no cost posts rate 0 and records cost null');
  check(a.body.says === '1 line recorded · 1 counted · 1 at no cost', 'it says "1 line recorded · 1 counted · 1 at no cost" (got "' + a.body.says + '")');

  a = await buy(server, { name: 'kept Rice', qty: 4, cost: '' });
  check(a.body.says === '1 line recorded · 1 counted · 1 at no cost', 'a cost of "" is no cost: said "at no cost" (got "' + a.body.says + '")');
  check(stamped.length === 1 && stampedCosts.length === 1 && stampedCosts[0] === null, 'a cost of "" stamps null, so the UPDATE (COALESCE) keeps last_cost instead of writing 0 (got ' + JSON.stringify(stampedCosts) + ')');
  a = await buy(server, { name: 'kept Rice', qty: 4, cost: 0 });
  check(a.body.says === '1 line recorded · 1 counted · 1 at no cost', 'a cost of 0 typed is at no cost: said (got "' + a.body.says + '")');

  /* expensed: a number cost is kept as the number; no cost is said the same way */
  a = await buy(server, { name: 'Tape', qty: 2, cost: '12.5' });
  check(!posted.length && a.body.recorded[0].cost === 12.5 && a.body.says === '1 line recorded · 1 expensed — not in your books yet', 'an expensed line costing "12.5" records 12.5 and is not said at no cost (got "' + a.body.says + '")');
  a = await buy(server, { name: 'Tape', qty: 2 });
  check(a.body.says === '1 line recorded · 1 expensed — not in your books yet · 1 at no cost', 'an expensed line with no cost says "1 at no cost" (got "' + a.body.says + '")');

  /* the old words stay: a quantity of nothing is still "a purchase of nothing" */
  a = await buy(server, { name: 'Tape', qty: 0, cost: 5 });
  check(/purchase of nothing/.test(((a.body.failed || [])[0] || {}).why || ''), 'a quantity of 0 keeps its words: a purchase of nothing records nothing');
  server.close();
  console.log(total + ' checks' + (failed ? ', ' + failed + ' FAILED' : ''));
  process.exit(failed ? 1 : 0);
})();
