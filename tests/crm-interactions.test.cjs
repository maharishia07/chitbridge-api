/**
 * CB CRM, Phase 4 — POST /api/crm/parties/:id/interactions, with party_interaction STUBBED (migration b276 is a draft Athi runs),
 * and the 503 every writer answers before it exists. Offline (tests/support/crm-stub.cjs). Run: node tests/crm-interactions.test.cjs
 */
'use strict';
const assert = require('assert');
const { make, row } = require('./support/crm-stub.cjs');
const t = make(), D = t.data, F = require('../lib/crm-followups');
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };
D.cust = [Object.assign(row({ party_id: P(2), display_name: 'Chola' }), { customer_type: 'entity', added_via: 'manual', txn_count: 1, segment: 'new' })];
D.sup = [Object.assign(row({ party_id: P(3), display_name: 'Ravi', user_id: '~shop.sup-0001', on_rail: false }), { category: null })];
const url = (id) => '/parties/' + id + '/interactions';

(async () => {
  await ita('before b276: 503 "not migrated yet", code CRM_NOT_MIGRATED — never a 500, and nothing written', async () => {
    D.migrated = false; F.forget();
    const r = await t.post(url(P(2)), { kind: 'call', direction: 'out', body: 'rang' });
    assert.strictEqual(r.status, 503); assert.strictEqual(r.body.code, 'CRM_NOT_MIGRATED'); assert.strictEqual(D.interactions.length, 0);
    D.migrated = true; F.forget();
  });
  await ita('log a call → 201, stored for this shop and this party, by whoever logged it', async () => {
    t.as('E1', { identity: { identity_id: 'A1', parent_entity_id: 'E1' } });
    const r = await t.post(url(P(2)), { kind: 'call', direction: 'in', body: '  Asked   for a   quote ' }); t.as('E1');
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const x = D.interactions[0]; assert.strictEqual(x.owner, 'E1'); assert.strictEqual(x.party_id, P(2)); assert.strictEqual(x.kind, 'call'); assert.strictEqual(x.direction, 'in');
    assert.strictEqual(x.body, 'Asked for a quote'); assert.strictEqual(x.by_user_id, 'A1'); assert.strictEqual(r.body.interaction.interaction_id, x.interaction_id);
  });
  await ita('a note has no direction (whatever is sent); a supplier-only party can be logged too; "when" can be earlier', async () => {
    const r = await t.post(url(P(3)), { kind: 'note', direction: 'out', body: 'Prefers morning calls', at: '2026-09-01T10:00:00Z' });
    assert.strictEqual(r.status, 201); const x = D.interactions.find((i) => i.party_id === P(3)); assert.strictEqual(x.direction, null); assert.strictEqual(x.at, '2026-09-01T10:00:00.000Z');
  });
  await ita('refused in words with a code: unknown kind, mail (phase 5), no direction on a call, empty body, a time in the future', async () => {
    const n = D.interactions.length;
    for (const [b, why] of [[{ kind: 'sms', direction: 'in', body: 'x' }, 'kind'], [{ kind: 'mail', direction: 'out', body: 'x' }, 'mail'], [{ kind: 'call', body: 'x' }, 'direction'], [{ kind: 'visit', direction: 'in', body: '   ' }, 'body'],
                            [{ kind: 'call', direction: 'in', body: 'x', at: '2099-01-01T00:00:00Z' }, 'future'], [{ kind: 'call', direction: 'in', body: 'x', at: 'soon' }, 'when']]) {
      const r = await t.post(url(P(2)), b); assert.strictEqual(r.status, 400, why + ' → ' + JSON.stringify(r.body)); assert.ok(r.body.error, why);
    }
    assert.strictEqual(D.interactions.length, n);
  });
  await ita('a party that is not mine → 404; a junk id → 400; another shop cannot log on mine', async () => {
    assert.strictEqual((await t.post(url(P(9)), { kind: 'note', body: 'x' })).status, 404);
    assert.strictEqual((await t.post(url('nope'), { kind: 'note', body: 'x' })).status, 400);
    t.as('E2'); assert.strictEqual((await t.post(url(P(2)), { kind: 'note', body: 'x' })).status, 404); t.as('E1');
  });
  await ita('an API key cannot log (403)', async () => { t.as('E1', { key: true }); assert.strictEqual((await t.post(url(P(2)), { kind: 'note', body: 'x' })).status, 403); t.as('E1'); });
  await ita('the logged line reaches the timeline, newest first', async () => {
    const r = await t.get('/parties/' + P(2) + '/timeline'); const i = r.body.entries.filter((e) => e.kind === 'interaction');
    assert.strictEqual(i.length, 1); assert.strictEqual(i[0].interaction_kind, 'call'); assert.strictEqual(i[0].body, 'Asked for a quote');
  });
  t.close(); console.log('  ' + pass + ' checks');
})();
