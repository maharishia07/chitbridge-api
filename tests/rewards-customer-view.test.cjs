#!/usr/bin/env node
// @type: integration
/**
 * tests/rewards-customer-view.test.cjs — THE SHOP'S VIEW OF WHAT ONE CUSTOMER HOLDS (GET /api/relationships/customers/:id/rewards).
 * UNIT      08 REWARDS & LOYALTY / Customer's rewards view (it had NO test at all: PM/SCORECARD-DATA.md test = 0)
 * OWNS      the proof that the route answers in sentences and a liability, not a bare count: no programme → a plain "does not run one" (not an error, not an
 *           empty box) · a balance is the SUM of the whole ledger, not the newest page · points stay points (never a currency code in the answer) · a table that
 *           is not migrated yet is a friendly answer, not a 500 · a NUL in the holder value is refused 400 before it reaches the database · READING NEVER WRITES.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: tests/support/route-golden.cjs stubs db and auth; the real route + the real lib/reward-store + the real rewards engine run.
 * FLOW      stub ledger rows → GET /customers/:id/rewards → answer → asserted; every statement sent is kept, and none may write
 * CARD      08-rewards-and-loyalty/customer-s-rewards-view
 */
'use strict';
const assert = require('assert');
const path = require('path');
const G = require('./support/route-golden.cjs');

const SHOP = '11111111-1111-4111-8111-111111111111';
const PROG = { definition_id: 'def-1', name: 'Shop points', rules: { earn: { kind: 'per_amount', per: 100, points: 1 }, redeem: [{ kind: 'money', points: 100, amount: 1 }], expires_months: 0 } };
let world = {};
function rows(sql, params, ctx) {
  if (/FROM definition d/.test(sql)) return ctx.prog ? [ctx.prog] : [];
  if (/FROM reward_ledger/.test(sql)) {
    if (ctx.noTable) throw Object.assign(new Error('relation "reward_ledger" does not exist'), { code: '42P01' });
    return ctx.ledger || [];
  }
  return [];
}
const h = G.harness({ rows });
const router = require(path.join(G.API, 'routes', 'relationships.js'));
const app = h.app('/api/relationships', router);
const ask = (id, ctx) => h.run(app, { method: 'GET', url: '/api/relationships/customers/' + encodeURIComponent(id) + '/rewards', identity: { identity_id: SHOP, identity_type: 'entity', display_name: 'Shop A' }, ctx, settle: 5 });
const entry = (points, why, ref) => ({ points, why, ref, note: null, at: '2026-11-01T10:00:00.000Z', total: 0 });
const ledgerOf = (list) => { const total = list.reduce((s, e) => s + e.points, 0); return list.map((e) => Object.assign({}, e, { total })); };
const writes = (res) => res.calls.filter((c) => /\b(INSERT|UPDATE|DELETE)\b/i.test(c.sql || ''));

let checks = 0;
async function it(what, fn) { await fn(); checks++; console.log('  ok  ' + what); }

(async () => {
  await it('a shop with no programme gets a plain sentence, status 200, points 0 (not an error, not an empty box)', async () => {
    const r = await ask('cust-1', { prog: null });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.programme, null);
    assert.strictEqual(r.body.points, 0);
    assert.ok(/does not run a points programme/.test(r.body.says), 'got: ' + r.body.says);
  });

  await it('412 points quoted as points with a worth, a sentence and the next reward — the number alone is never the answer', async () => {
    const r = await ask('cust-2', { prog: PROG, ledger: ledgerOf([entry(300, 'earned', 'B-2'), entry(112, 'earned', 'B-1')]) });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.programme, 'Shop points');
    assert.strictEqual(r.body.points, 412);
    assert.ok(typeof r.body.says === 'string' && r.body.says.length > 8, 'no sentence beside the number');
    assert.ok(r.body.worth != null, 'the liability (what the shop owes) is missing');
    assert.strictEqual(r.body.negative, false);
    assert.strictEqual(r.body.recent.length, 2);
  });

  await it('points are not currency: no currency code and no money symbol rides the points figure', async () => {
    const r = await ask('cust-2', { prog: PROG, ledger: ledgerOf([entry(500, 'earned', 'B-9')]) });
    const raw = JSON.stringify({ points: r.body.points, recent: r.body.recent });
    assert.ok(!/INR|AUD|AED|USD|₹|\$/.test(raw), 'a currency leaked into the points: ' + raw);
    assert.strictEqual(typeof r.body.points, 'number');
  });

  await it('the balance is the SUM of the whole ledger — 600 entries of 1 point show 600, not the newest 50', async () => {
    const many = Array.from({ length: 600 }, (_, i) => entry(1, 'earned', 'R-' + i));
    const total = 600;
    const ledger = many.map((e) => Object.assign({}, e, { total }));
    const r = await ask('cust-3', { prog: PROG, ledger: ledger.slice(0, 50) /* the stub returns the page the SQL would: LIMIT 50 */ });
    assert.strictEqual(r.body.points, 600, 'a truncated window was folded instead of the SUM');
  });

  await it('an overspent holder is flagged negative, said not hidden', async () => {
    const r = await ask('cust-4', { prog: PROG, ledger: ledgerOf([entry(100, 'earned', 'B-1'), entry(-160, 'spent', 'B-2')]) });
    assert.strictEqual(r.body.points, -60);
    assert.strictEqual(r.body.negative, true);
  });

  await it('a table that is not migrated yet answers "not switched on", not a 500', async () => {
    const r = await ask('cust-5', { prog: PROG, noTable: true });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.programme, null);
    assert.ok(/not switched on/.test(r.body.says));
  });

  await it('reading never writes: not one INSERT, UPDATE or DELETE was sent for a view', async () => {
    const r = await ask('cust-6', { prog: PROG, ledger: ledgerOf([entry(50, 'earned', 'B-1')]) });
    assert.strictEqual(writes(r).length, 0, JSON.stringify(writes(r)));
  });

  await it('refusal: a NUL in the holder value is a 400 and nothing reaches the database', async () => {
    const r = await ask('cust\u00001', { prog: PROG, ledger: [] });
    assert.strictEqual(r.status, 400, 'got ' + r.status);
    assert.strictEqual(r.calls.length, 0, 'the database was asked about a NUL value');
  });

  await it('a holder of one shop is read under THAT shop only: the ledger is asked for (entity, scheme, value), never for all holders', async () => {
    const r = await ask('cust-7', { prog: PROG, ledger: ledgerOf([entry(10, 'earned', 'B-1')]) });
    const q = r.calls.find((c) => /FROM reward_ledger/.test(c.sql));
    assert.ok(q && /entity_id = \$1 AND holder_scheme = \$2 AND holder_value = \$3/.test(q.sql), 'the ledger read is not scoped to one holder');
    assert.strictEqual(q.params[1], 'identity');
    assert.strictEqual(q.params[2], 'cust-7');
  });

  console.log('\n  ' + checks + ' checks');
  console.log('  ' + checks + ' passed');
  process.exit(0);
})().catch((e) => { console.log('  FAIL ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n       ') : e)); process.exit(1); });
