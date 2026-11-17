'use strict';
/**
 * tests/edge-audit.test.cjs — lib/edge-audit.js, offline (the database is a stub): which edges and steps write a row, what the row carries, and that a refusal or a missing identity never throws.
 * MIN unit-per-rule · refusal-path · fail-closed (an edge that is not an agency edge, an unknown step or a business with no identity row writes nothing and answers false; a refused write answers false and never fails the action)
 * Run: node tests/edge-audit.test.cjs · no network, no DB.   CARD 04-network/connections-and-invitations
 */
const path = require('path');
const assert = require('assert');
const API = path.join(__dirname, '..');
let rows = []; let written = []; let failWrite = false;
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async () => ({ rows }),
  withEntity: async (entityId, fn) => fn({ query: async (sql, params) => { if (failWrite) throw Object.assign(new Error('check violated'), { code: '23514' }); written.push({ entityId, params }); return { rows: [] }; } })
} };
const audit = require(path.join(API, 'lib', 'edge-audit.js'));
const edge = (type) => ({ id: 'e1', parent_id: 'pn', child_id: 'cn', type: type || 'agency', state: 'requested', requested_by: 'pn' });
let n = 0;
const t = async (what, fn) => { try { rows = [{ node_id: 'pn', identity_id: 'firm-id' }, { node_id: 'cn', identity_id: 'client-id' }]; written = []; failWrite = false; await fn(); n++; console.log('  ok   ' + what); } catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };
(async () => {
  await t('each step writes its own action word, in the client\'s trail, naming the firm and the actor', async () => {
    for (const [step, word] of [['ask', 'agency_asked'], ['approve', 'agency_approved'], ['decline', 'agency_declined'], ['end', 'agency_ended']]) {
      written = [];
      assert.strictEqual(await audit.recordEdgeEvent(step, edge(), 'person-1'), true);
      assert.strictEqual(written[0].entityId, 'client-id');
      assert.deepStrictEqual(written[0].params.slice(0, 3), ['client-id', 'firm-id', word]);
      assert.strictEqual(written[0].params[5], 'person-1');
    }
  });
  await t('the ask has no before; the others carry where the edge stood', async () => {
    await audit.recordEdgeEvent('ask', edge(), 'p'); assert.strictEqual(JSON.parse(written[0].params[3]), null);
    await audit.recordEdgeEvent('approve', edge(), 'p'); assert.strictEqual(JSON.parse(written[1].params[3]).state, 'requested');
    await audit.recordEdgeEvent('end', edge(), 'p'); assert.strictEqual(JSON.parse(written[2].params[3]).state, 'connected');
  });
  await t('a governance or commercial edge writes nothing (refused: not an agency edge)', async () => {
    assert.strictEqual(await audit.recordEdgeEvent('ask', edge('governance'), 'p'), false);
    assert.strictEqual(await audit.recordEdgeEvent('ask', edge('commercial'), 'p'), false);
    assert.strictEqual(written.length, 0);
  });
  await t('an unknown step or no edge writes nothing', async () => {
    assert.strictEqual(await audit.recordEdgeEvent('wave', edge(), 'p'), false);
    assert.strictEqual(await audit.recordEdgeEvent('ask', null, 'p'), false);
    assert.strictEqual(written.length, 0);
  });
  await t('fail closed: a node with no identity row writes nothing', async () => {
    rows = [{ node_id: 'pn', identity_id: 'firm-id' }];
    assert.strictEqual(await audit.recordEdgeEvent('ask', edge(), 'p'), false);
    assert.strictEqual(written.length, 0);
  });
  await t('a refused write (the check not yet widened) answers false and never throws', async () => {
    failWrite = true;
    assert.strictEqual(await audit.recordEdgeEvent('ask', edge(), 'p'), false);
  });
  console.log('\n' + n + ' passed');
})();
