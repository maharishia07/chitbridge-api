'use strict';
/**
 * tests/live-trips-network.test.cjs - the driven network scenario of the live-trips harness (SPD-39 / SPD-42): its counting helpers, and the whole run against a FAKE client.
 * Run: node tests/live-trips-network.test.cjs - offline: nothing is sent anywhere; the fake client records every call it is asked for.
 */
const assert = require('assert');
const network = require('../tools/live-trips-network.cjs');
let pass = 0;
const check = async (name, fn) => { await fn(); pass += 1; console.log('  ok   ' + name); };

/** a fake client: answers by route, counts every call, trips = 3 for a 2xx */
function fakeApi(options) {
  const seen = [];
  const settings = { lookup: { entity: { id: 'node-load' } }, ...options };
  return {
    seen,
    unique: () => 'u1',
    tokenFor: async () => 'other-token',
    call: async (method, url) => {
      seen.push(method + ' ' + url);
      if (url === '/api/entities/me') return { status: 200, body: { bridge_id: 'b-1' }, trips: 1 };
      if (url.startsWith('/api/network/entities/lookup')) return settings.lookup ? { status: 200, body: settings.lookup, trips: 1 } : { status: 404, body: {}, trips: 1 };
      if (method === 'POST') return { status: 201, body: { id: 'id-' + seen.length }, trips: 3 };
      return { status: 200, body: {}, trips: 1 };
    }
  };
}

(async () => {
  await check('best() is the highest trips among the 2xx answers; a 4xx or a missing header never counts', async () => {
    const row = network.best([{ status: 201, trips: 3 }, { status: 201, trips: 5 }, { status: 409, trips: 9 }, { status: 200, trips: null }]);
    assert.strictEqual(row.state, 'measured');
    assert.strictEqual(row.trips, 5);
    assert.strictEqual(network.best([{ status: 409, trips: 4 }]), null);
  });
  await check('said() prefers the code, then detail, error, text; keep() carries status and trips only', async () => {
    assert.strictEqual(network.said({ body: { code: 'C1', detail: 'd' }, text: 't' }), 'C1');
    assert.strictEqual(network.said({ body: {}, text: 't' }), 't');
    assert.deepStrictEqual(network.keep({ status: 200, trips: 2, body: { x: 1 } }), { status: 200, trips: 2 });
  });
  await check('unreached() names its group, reason and calls', async () => {
    assert.deepStrictEqual(network.unreached('fixture', 'why', []), { state: 'unreached', group: 'fixture', reason: 'why', calls: [] });
  });
  await check('with no network node for the load shop all eight routes are unreached (fixture) and nothing is written', async () => {
    const api = fakeApi({ lookup: null });
    const out = await network.run(api);
    assert.strictEqual(Object.keys(out).length, 8);
    Object.values(out).forEach((row) => assert.strictEqual(row.group, 'fixture'));
    assert.ok(api.seen.every((line) => line.startsWith('GET ')), 'only reads were made');
  });
  await check('with a node the scenario measures the create, ask and lifecycle routes and the claim', async () => {
    const api = fakeApi();
    const out = await network.run(api);
    assert.strictEqual(out['POST /api/network/entities'].trips, 3);
    assert.strictEqual(out['POST /api/network/connections'].trips, 3);
    ['approve', 'suspend', 'resume', 'disconnect', 'decline'].forEach((action) => assert.strictEqual(out['POST /api/network/connections/:id/' + action].state, 'measured', action));
    assert.strictEqual(out['POST /api/network/entities/:id/claim'].state, 'measured');
  });
  console.log(pass + ' checks · 0 failed');
})().catch((error) => { console.error('FAILED: ' + error.message); process.exit(1); });
