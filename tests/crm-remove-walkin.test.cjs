/**
 * CB CRM, Phase 4 — "Remove from my parties" (Q10, provisional) and walk-in → party. Offline (tests/support/crm-stub.cjs).
 *   remove: owner only · refused with open dues · hides the row, deletes nothing · a merged id is not removable · 503 before b276
 *   walk-in: a phone that holds points becomes a LOCAL customer through the one mint (kind 'cus'), and the points move by rewards.claim (two entries)
 * Run: node tests/crm-remove-walkin.test.cjs
 */
'use strict';
const assert = require('assert');
const { make, row } = require('./support/crm-stub.cjs');
const t = make(), D = t.data;
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };
const cs = (r) => Object.assign(r, { customer_type: 'entity', added_via: 'manual', txn_count: 1, segment: 'new' });
D.cust = [cs(row({ party_id: P(1), display_name: 'Square Dealer', user_id: 'sq' })), cs(row({ party_id: P(2), display_name: 'Owes Money', user_id: 'om' })), cs(row({ party_id: P(8), display_name: 'Folded', user_id: 'fo', merged_into: P(1) }))];
D.sup = [cs(row({ party_id: P(1), display_name: 'Square Dealer', user_id: 'sq' }))];
D.stored.customer[P(1)] = { balance_minor: 5000 }; D.stored.supplier[P(1)] = { balance_minor: -5000 };   /* nets to 0 */
D.stored.customer[P(2)] = { balance_minor: 25000 };

(async () => {
  await ita('refused with open dues → 409 HAS_DUES, and nothing hidden', async () => {
    const r = await t.del('/parties/' + P(2)); assert.strictEqual(r.status, 409); assert.strictEqual(r.body.code, 'HAS_DUES'); assert.strictEqual(D.cust.find((x) => x.party_id === P(2)).hidden_at, null);
  });
  await ita('a co-assist may not remove (403 OWNER_ONLY)', async () => {
    t.as('E1', { identity: { identity_id: 'A1', parent_entity_id: 'E1' } }); const r = await t.del('/parties/' + P(1)); t.as('E1'); assert.strictEqual(r.status, 403); assert.strictEqual(r.body.code, 'OWNER_ONLY');
  });
  await ita('before b276 (no hidden_at column) → 503 CRM_NOT_MIGRATED, not a 500', async () => {
    D.hiddenColumn = false; const r = await t.del('/parties/' + P(1)); assert.strictEqual(r.status, 503); assert.strictEqual(r.body.code, 'CRM_NOT_MIGRATED'); D.hiddenColumn = true;
  });
  await ita('no open dues (a both-sides party that nets to 0): hidden on BOTH lists, gone from the list, history untouched', async () => {
    const before = JSON.stringify({ q: D.interactions.length, f: D.followups.length, c: D.chits.length });
    const r = await t.del('/parties/' + P(1)); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(D.cust.find((x) => x.party_id === P(1)).hidden_at && D.sup.find((x) => x.party_id === P(1)).hidden_at);
    const l = (await t.get('/parties')).body; assert.strictEqual(l.parties.filter((p) => p.party_id === P(1)).length, 0);
    assert.strictEqual(JSON.stringify({ q: D.interactions.length, f: D.followups.length, c: D.chits.length }), before, 'no history deleted'); assert.strictEqual(D.cust.length, 3, 'no row deleted');
  });
  await ita('a merged id is not removable (it is not a party any more) → 404; an unknown id → 404', async () => {
    assert.strictEqual((await t.del('/parties/' + P(8))).status, 404); assert.strictEqual((await t.del('/parties/' + P(99))).status, 404);
  });

  /* walk-in → party */
  const ids = [{ identity_id: 'E1', user_id: 'acme', bridge_id: 'B1' }]; let custInserts = 0;
  D.extra = async (sql, p) => {
    if (/^SELECT user_id, bridge_id FROM identities WHERE identity_id/.test(sql)) return { rows: ids.filter((i) => i.identity_id === p[0]) };
    if (/FROM identities WHERE parent_entity_id = \$1 AND user_id LIKE/.test(sql)) return { rows: ids.filter((i) => i.parent_entity_id === p[0] && i.user_id.startsWith(p[1].replace('%', '')) && i.display_name.toLowerCase() === p[2]) };
    if (/^SELECT user_id FROM identities WHERE user_id LIKE/.test(sql)) return { rows: ids.filter((i) => i.user_id.startsWith(p[0].replace('%', ''))).slice(-1) };
    if (/^INSERT INTO identities/.test(sql)) { const r = { identity_id: 'N' + ids.length, bridge_id: p[0], display_name: p[1], user_id: p[2], parent_entity_id: p[3] }; ids.push(r); return { rows: [r] }; }
    if (/^UPDATE identities SET otp_contact/.test(sql)) { ids.find((i) => i.identity_id === p[0]).otp_contact = p[1]; return { rows: [] }; }
    if (/^INSERT INTO customer_list/.test(sql)) { custInserts++; return { rows: [{ customer_list_id: 'CL' + custInserts }] }; }
    return null;
  };
  D.points = { programme: { name: 'Club', definition_id: 'DEF1' }, points: 120, worth: 60, entries: [] };
  await ita('walk-in → a local customer: the one mint (~owner.cus-0001), phone kept, party number, points moved by the engine\'s claim', async () => {
    const r = await t.post('/walk-ins/add', { phone: '+91 98400 12321', name: 'Ravi from the corner' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body)); assert.strictEqual(r.body.party.user_id, '~acme.cus-0001'); assert.strictEqual(r.body.party.kind, 'local'); assert.strictEqual(r.body.party.on_chitbridge, false);
    assert.strictEqual(r.body.party.party_no, 'P-00099'); assert.strictEqual(r.body.points_claimed, 120);
    assert.strictEqual(ids[1].otp_contact, '+919840012321');
    assert.strictEqual(D.appended.length, 2, 'a claim is TWO entries, never an update');
    const [out, inn] = D.appended; assert.deepStrictEqual(out.holder, { scheme: 'phone', value: '+919840012321' }); assert.strictEqual(out.entry.points, -120); assert.strictEqual(out.entry.why, 'claimed');
    assert.deepStrictEqual(inn.holder, { scheme: 'identity', value: 'N1' }); assert.strictEqual(inn.entry.points, 120); assert.strictEqual(inn.def, 'DEF1'); assert.strictEqual(out.entry.ref, inn.entry.ref);
  });
  await ita('no name given → "Customer 2321"; no programme / no points → still added, nothing claimed', async () => {
    D.points = null; D.appended.length = 0;
    const r = await t.post('/walk-ins/add', { phone: '98400 55555' }); assert.strictEqual(r.status, 201, JSON.stringify(r.body)); assert.strictEqual(r.body.party.display_name, 'Customer 5555'); assert.strictEqual(r.body.points_claimed, 0); assert.strictEqual(D.appended.length, 0);
  });
  await ita('a phone that is not a phone → 400 BAD_PHONE; an API key → 403', async () => {
    const r = await t.post('/walk-ins/add', { phone: '12' }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'BAD_PHONE');
    t.as('E1', { key: true }); assert.strictEqual((await t.post('/walk-ins/add', { phone: '98400 12321' })).status, 403); t.as('E1');
  });
  t.close(); console.log('  ' + pass + ' checks');
})();
