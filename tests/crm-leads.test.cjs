/**
 * CB CRM L1 — leads as parties; the memberships table (b297) and its one writer. Offline (tests/support/crm-stub.cjs).
 *   POST /leads: one local party (added_via 'lead') + its first stage, in ONE transaction · GET /parties?view=leads · leads OUT of the default list
 *   POST /parties/:id/stage: a NEW row, history kept · refused for another shop's party · b297 not run → 503 LEADS_NOT_MIGRATED, nothing created
 *   the migration file: RLS on entity_id, append-only, kind dictionary (the RLS test of the new table)
 * Run: node tests/crm-leads.test.cjs
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const state = { table: true };
{ const p = require.resolve(path.join(API, 'lib/schema')); require.cache[p] = { id: p, filename: p, loaded: true, exports: { hasTable: async (t) => (t === 'memberships' ? state.table : true), hasColumn: async () => true, hasColumns: async () => ({}), _reset() {} } }; }
const { make, row } = require('./support/crm-stub.cjs');
const t = make(), D = t.data;
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };
const cs = (r, via, n) => Object.assign(r, { customer_type: 'entity', added_via: via || 'manual', txn_count: n == null ? 1 : n, segment: 'new' });

/* the memberships table, as the database would keep it */
const M = []; let tx = 0, clInserts = 0; const ids = [{ identity_id: 'E1', user_id: 'acme', bridge_id: 'B1' }];
D.cust = [cs(row({ party_id: P(1), display_name: 'Regular Raj', user_id: 'rr' })),
  cs(row({ party_id: P(2), display_name: 'Lead Lata', user_id: '~acme.cus-0001' }), 'lead', 0),
  cs(row({ party_id: P(3), display_name: 'Lead Traded', user_id: '~acme.cus-0002' }), 'lead', 4),
  cs(row({ party_id: P(4), display_name: 'Demo Dev', user_id: '~acme.cus-0003' }), 'lead', 0),
  Object.assign(cs(row({ party_id: P(9), display_name: 'Other Shop Lead', user_id: '~zz.cus-0001' }), 'lead', 0), { owner: 'E2' })];
D.sup = [];
M.push({ membership_id: 'm1', entity_id: 'E1', item_id: P(2), kind: 'lead_stage', grp: 'lead', at: '2026-10-01T10:00:00.000Z' });
M.push({ membership_id: 'm2', entity_id: 'E1', item_id: P(4), kind: 'lead_stage', grp: 'lead', at: '2026-10-02T10:00:00.000Z' });
M.push({ membership_id: 'm3', entity_id: 'E1', item_id: P(4), kind: 'lead_stage', grp: 'demo', at: '2026-10-03T10:00:00.000Z' });
D.extra = async (sql, p) => {
  if (/FROM memberships/.test(sql) && /^SELECT DISTINCT ON/.test(sql)) {
    if (!state.table) throw new Error('memberships absent: the code must not ask');
    const latest = new Map(); M.filter((m) => m.entity_id === p[0] && m.kind === p[1] && p[2].indexOf(m.item_id) >= 0).sort((a, b) => (a.at < b.at ? -1 : 1)).forEach((m) => latest.set(m.item_id, m));
    return { rows: Array.from(latest.values()).map((m) => ({ item_id: m.item_id, grp: m.grp, at: m.at })) };
  }
  if (/^INSERT INTO memberships/.test(sql)) { const r = { membership_id: 'mm' + (++tx), entity_id: p[0], item_type: p[1], item_id: p[2], kind: p[3], grp: p[4], by: p[5], at: new Date(Date.UTC(2026, 9, 10, 9, tx)).toISOString() }; M.push(r); return { rows: [r] }; }
  if (/^SELECT EXISTS \(SELECT 1 FROM customer_list WHERE owner_entity_id = \$1 AND customer_identity_id = \$2\) OR/.test(sql)) return { rows: [{ ok: D.cust.some((r) => r.owner === p[0] && r.party_id === p[1]) }] };
  if (/^SELECT txn_count FROM customer_list WHERE owner_entity_id = \$1 AND customer_identity_id = \$2 AND added_via = 'lead'/.test(sql)) { const r = D.cust.find((x) => x.owner === p[0] && x.party_id === p[1] && x.added_via === 'lead'); return { rows: r ? [{ txn_count: r.txn_count }] : [] }; }
  if (/^SELECT user_id, bridge_id FROM identities WHERE identity_id/.test(sql)) return { rows: ids.filter((i) => i.identity_id === p[0]) };
  if (/FROM identities WHERE parent_entity_id = \$1 AND user_id LIKE/.test(sql)) return { rows: ids.filter((i) => i.parent_entity_id === p[0] && i.user_id.startsWith(p[1].replace('%', '')) && i.display_name.toLowerCase() === p[2]) };
  if (/^SELECT user_id FROM identities WHERE user_id LIKE/.test(sql)) return { rows: ids.filter((i) => i.user_id.startsWith(p[0].replace('%', ''))).slice(-1) };
  if (/^INSERT INTO identities/.test(sql)) { const r = { identity_id: 'N' + ids.length, bridge_id: p[0], display_name: p[1], user_id: p[2], parent_entity_id: p[3] }; ids.push(r); return { rows: [r] }; }
  if (/^UPDATE identities SET otp_contact/.test(sql)) { ids.find((i) => i.identity_id === p[0]).otp_contact = p[1]; return { rows: [] }; }
  if (/^INSERT INTO customer_list/.test(sql)) { clInserts++; assert.ok(/'lead'/.test(sql), 'added_via is lead'); D.cust.push(cs(row({ party_id: p[1], display_name: 'new', user_id: 'n' }), 'lead', 0)); return { rows: [{ customer_list_id: 'CL' + clInserts }] }; }
  return null;
};

(async () => {
  await ita('GET /parties (default): leads are OUT — only the trader is listed; a lead who has traded stays', async () => {
    const r = await t.get('/parties'); assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.parties.map((p) => p.party_id).sort(), [P(1), P(3)].sort());
    assert.strictEqual(r.body.parties.find((p) => p.party_id === P(3)).lead.stage, 'customer', 'first trade = a customer, not a stored stage');
  });
  await ita('GET /parties?view=leads: only this shop\'s leads with no trade, each with its LATEST stage; one stage statement for all', async () => {
    D.queries.length = 0;
    const r = await t.get('/parties?view=leads'); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.parties.map((p) => p.party_id).sort(), [P(2), P(4)].sort()); assert.strictEqual(r.body.leads_migrated, true);
    assert.strictEqual(r.body.parties.find((p) => p.party_id === P(4)).lead.stage, 'demo'); assert.strictEqual(r.body.parties.find((p) => p.party_id === P(2)).lead.stage, 'lead');
    assert.strictEqual(D.queries.filter((q) => /FROM memberships/.test(q)).length, 1, 'no per-row stage query');
    assert.deepStrictEqual(r.body.walk_ins, []);
  });
  await ita('POST /leads: one local party + first stage, ONE transaction, phone kept; then it is in the Leads view and not in Customers', async () => {
    const before = M.length, r = await t.post('/leads', { name: 'Ravi Jewellers', phone: '+91 98400 12321', stage: 'demo' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body)); assert.strictEqual(r.body.party.kind, 'local'); assert.strictEqual(r.body.party.lead.stage, 'demo'); assert.strictEqual(r.body.party.party_no, 'P-00099');
    assert.strictEqual(ids[1].otp_contact, '+919840012321'); assert.strictEqual(M.length, before + 1); assert.strictEqual(M[M.length - 1].item_id, ids[1].identity_id); assert.strictEqual(M[M.length - 1].entity_id, 'E1');
    const lv = (await t.get('/parties?view=leads')).body; assert.ok(lv.parties.some((p) => p.party_id === ids[1].identity_id));
    assert.ok(!(await t.get('/parties')).body.parties.some((p) => p.party_id === ids[1].identity_id));
  });
  await ita('POST /leads: no name → 400; a bad phone → 400; a bad stage → 400; an api key → 403', async () => {
    assert.strictEqual((await t.post('/leads', {})).body.code, 'BAD_NAME'); assert.strictEqual((await t.post('/leads', { name: 'X', phone: 'abc' })).body.code, 'BAD_PHONE');
    assert.strictEqual((await t.post('/leads', { name: 'X', stage: 'customer' })).body.code, 'BAD_GROUP');
    t.as('E1', { key: true }); assert.strictEqual((await t.post('/leads', { name: 'X' })).status, 403); t.as('E1');
  });
  await ita('POST /parties/:id/stage: a NEW row (history kept), latest wins, the old rows stay', async () => {
    const n = M.filter((m) => m.item_id === P(2)).length, r = await t.post('/parties/' + P(2) + '/stage', { stage: 'trial' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.lead.stage, 'trial'); assert.strictEqual(M.filter((m) => m.item_id === P(2)).length, n + 1); assert.strictEqual(M.find((m) => m.membership_id === 'm1').grp, 'lead');
    assert.strictEqual((await t.get('/parties?view=leads')).body.parties.find((p) => p.party_id === P(2)).lead.stage, 'trial');
  });
  await ita('stage: another shop\'s party → 404 and nothing written; a trader → 409; a non-lead → 404; a bad stage → 400', async () => {
    const n = M.length;
    assert.strictEqual((await t.post('/parties/' + P(9) + '/stage', { stage: 'demo' })).status, 404);
    assert.strictEqual((await t.post('/parties/' + P(3) + '/stage', { stage: 'demo' })).body.code, 'IS_CUSTOMER');
    assert.strictEqual((await t.post('/parties/' + P(1) + '/stage', { stage: 'demo' })).status, 404);
    assert.strictEqual((await t.post('/parties/' + P(2) + '/stage', { stage: 'customer' })).body.code, 'BAD_GROUP');
    assert.strictEqual(M.length, n);
  });
  await ita('the ONE writer refuses an item that is not this shop\'s (the entity check), even when called directly', async () => {
    const MM = require(path.join(API, 'lib/memberships')); const n = M.length;
    await assert.rejects(() => MM.add({ query: (s, p) => D.extra(s.replace(/\s+/g, ' ').trim(), p) }, 'E1', { kind: 'lead_stage', item_id: P(9), group: 'demo' }), (e) => e.code === 'NOT_FOUND');
    await assert.rejects(() => MM.add({ query: async () => ({ rows: [] }) }, 'E1', { kind: 'nope', item_id: P(2), group: 'demo' }), (e) => e.code === 'BAD_KIND');
    assert.strictEqual(M.length, n);
  });
  await ita('the record: a lead carries its stage, the moves, and may:ok', async () => {
    const r = await t.get('/parties/' + P(4)); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.lead.stage, 'demo'); assert.deepStrictEqual(r.body.lead.moves, ['lead', 'trial', 'parked', 'lost']); assert.deepStrictEqual(r.body.lead.may, { ok: true });
    assert.strictEqual((await t.get('/parties/' + P(1))).body.lead, null);
  });
  await ita('BEFORE b297: writes → 503 LEADS_NOT_MIGRATED in shopkeeper words, nothing created; the Leads list says leads_migrated:false; the record greys Move with the sentence', async () => {
    state.table = false; const nIds = ids.length, nCust = D.cust.length;
    const w = await t.post('/leads', { name: 'Nobody' }); assert.strictEqual(w.status, 503); assert.strictEqual(w.body.code, 'LEADS_NOT_MIGRATED'); assert.strictEqual(w.body.message, 'Lead stages arrive after the next update.');
    const s = await t.post('/parties/' + P(2) + '/stage', { stage: 'demo' }); assert.strictEqual(s.status, 503); assert.strictEqual(s.body.code, 'LEADS_NOT_MIGRATED');
    assert.strictEqual(ids.length, nIds); assert.strictEqual(D.cust.length, nCust);
    const l = await t.get('/parties?view=leads'); assert.strictEqual(l.status, 200); assert.strictEqual(l.body.leads_migrated, false);
    const r = await t.get('/parties/' + P(2)); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.lead.stage, 'lead'); assert.deepStrictEqual(r.body.lead.may, { ok: false, why: 'Lead stages arrive after the next update.' });
    assert.strictEqual((await t.get('/parties')).status, 200); state.table = true;
  });
  await ita('b297 (the RLS test of the new table): RLS ON and FORCED, policy on entity_id NULLIF-guarded, append-only, kinds a dictionary', async () => {
    const sql = fs.readFileSync(path.join(API, 'migrations', 'b297_memberships.sql'), 'utf8').replace(/--[^\n]*/g, '');
    assert.ok(/ALTER TABLE memberships ENABLE ROW LEVEL SECURITY/.test(sql) && /ALTER TABLE memberships FORCE\s+ROW LEVEL SECURITY/.test(sql));
    assert.ok(/CREATE POLICY rls_entity ON memberships\s+USING\s+\(entity_id = NULLIF\(current_setting\('app\.current_entity', true\), ''\)::uuid\)\s+WITH CHECK \(entity_id = NULLIF\(current_setting\('app\.current_entity', true\), ''\)::uuid\)/.test(sql));
    assert.ok(/REVOKE UPDATE, DELETE ON memberships FROM cb_app/.test(sql) && /GRANT SELECT, INSERT ON memberships TO cb_app/.test(sql));
    assert.ok(/INSERT INTO membership_kind[\s\S]*'lead_stage'/.test(sql));
    assert.deepStrictEqual(require(path.join(API, 'lib/memberships')).KINDS.lead_stage.groups, ['lead', 'demo', 'trial', 'parked', 'lost']);
    assert.ok(/'lead', 'demo', 'trial', 'parked', 'lost'/.test(sql), 'code and dictionary list the same stages');
  });
  console.log('\n' + pass + ' passed'); t.close();
})();
