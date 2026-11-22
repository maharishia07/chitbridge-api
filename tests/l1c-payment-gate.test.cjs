#!/usr/bin/env node
// @type: unit
/**
 * tests/l1c-payment-gate.test.cjs — LV sec-money-01 M2 (fix/l1c-1129): POST /payments carries lib/books-approval.paymentGate. No database: the real gate, the setting swapped.
 * OWNS      setting ON + Bookkeeper seat = 403 OWNER_ONLY, nothing reaches the payment writer · setting OFF / owner = straight on · an unreadable setting refuses · the route wires the gate before the handler
 * CALLED BY scripts/guards.cjs · CI
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.DATABASE_URL = '';
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const HERE = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const seat = () => ({ identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor', display_name: 'Ravi Books', access_level: 'editor', whole_entity: true, can_see_costs: true, hat: 'manager' });
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop' };
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 400)); } };
const world = { flag: 'off', readFails: false, reads: 0 };
require(path.join(HERE, 'lib', 'policy')).get = async () => { world.reads++; if (world.readFails) throw new Error('unreadable'); return { books_owner_approves: world.flag }; };
const approval = require(path.join(HERE, 'lib', 'books-approval'));
async function through(identity) {
  const req = { identity, body: { party_id: 'p', amount_minor: 100 }, books: { enabled: true }, headers: {}, get: () => null };
  const out = { nexted: false, status: null, body: null };
  const res = { status(c) { out.status = c; return res; }, json(p) { out.body = p; return res; }, setHeader() {}, type() { return res; }, send(p) { out.body = p; return res; } };
  await approval.paymentGate(req, res, () => { out.nexted = true; });
  return out;
}
(async () => {
  console.log('\nPOST /payments gate (L1c)');
  await t('ON + Bookkeeper seat: 403 OWNER_ONLY, the payment writer is never reached', async () => {
    world.flag = 'on'; world.readFails = false;
    const out = await through(seat());
    assert.strictEqual(out.nexted, false);
    assert.strictEqual(out.status, 403);
    assert.strictEqual(out.body.code, 'OWNER_ONLY');
  });
  await t('OFF: the Bookkeeper goes straight on', async () => {
    world.flag = 'off';
    assert.strictEqual((await through(seat())).nexted, true);
  });
  await t('ON: the owner goes on and the setting is not read', async () => {
    world.flag = 'on'; world.reads = 0;
    const out = await through(OWNER);
    assert.strictEqual(out.nexted, true);
    assert.strictEqual(world.reads, 0);
  });
  await t('an unreadable setting never lets a Bookkeeper payment through', async () => {
    world.readFails = true;
    const out = await through(seat());
    assert.strictEqual(out.nexted, false);
    assert.ok(out.status >= 400);
  });
  await t('the route wires paymentGate on POST /payments, after the contract check', async () => {
    const src = fs.readFileSync(path.join(HERE, 'routes', 'books.js'), 'utf8');
    assert.ok(/router\.post\('\/payments'[^\n]*checked\('POST \/payments'\), require\('\.\.\/lib\/books-approval'\)\.paymentGate,/.test(src));
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
