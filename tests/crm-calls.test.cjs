/**
 * CB CRM L2 — the call desk. Offline (tests/support/crm-stub.cjs).
 *   GET /calls: ONE queue statement · late/today from the SHOP's day · the outcome buttons from the server · b276 not run → 503
 *   POST /parties/:id/outcome: interaction (call, out, the outcome word) + next follow-up (source 'interaction') + stage move; the table's days
 *   3rd no-answer in a row → +3 days and a Parked suggestion · a customer's stage is not touched · b297 absent → 503 with NOTHING written · a foreign party → 404
 *   the RLS test: the queue and every write carry the shop (owner $1); another shop's rows never appear
 * Run: node tests/crm-calls.test.cjs
 */
'use strict';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
const state = { table: true };
{ const p = require.resolve(path.join(API, 'lib/schema')); require.cache[p] = { id: p, filename: p, loaded: true, exports: { hasTable: async (t) => (t === 'memberships' ? state.table : true), hasColumn: async () => true, forget() {} } }; }
const { make, row } = require('./support/crm-stub.cjs');
const t = make(), D = t.data, F = require('../lib/crm-followups'), H = require('../lib/books-hooks');
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const day = (n) => H.dayOf(new Date(Date.now() + n * 86400000).toISOString(), 'IN');
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };
const cs = (r, via, n) => Object.assign(r, { customer_type: 'entity', added_via: via || 'manual', txn_count: n == null ? 1 : n, segment: 'new' });
D.cust = [cs(row({ party_id: P(1), display_name: 'Lead Lata' }), 'lead', 0), cs(row({ party_id: P(2), display_name: 'Customer Chola' }), 'manual', 5),
  cs(row({ party_id: P(3), display_name: 'Fresh Farid' }), 'lead', 0), Object.assign(cs(row({ party_id: P(9), display_name: 'Other Shop' }), 'lead', 0), { owner: 'E2' })];
D.sup = [];
const MEM = [];
let stmts = [];
D.pre = async (sql, p) => {
  stmts.push(sql);
  if (/^SELECT q\.followup_id/.test(sql)) {
    assert.strictEqual(p[0], 'E1', 'the queue is scoped to the shop ($1)');
    const open = D.followups.filter((f) => f.owner === p[0] && !f.done_at).map((f) => ({ followup_id: f.followup_id, party_id: f.party_id, what: f.what, due_at: f.due_at, assignee_user_id: f.assignee_user_id, src: 'followup' }));
    const touched = new Set(D.followups.concat(D.interactions).filter((x) => x.owner === p[0]).map((x) => x.party_id));
    const fresh = D.cust.filter((c) => c.owner === p[0] && c.added_via === 'lead' && !c.txn_count && !touched.has(c.party_id)).map((c) => ({ followup_id: null, party_id: c.party_id, what: null, due_at: null, assignee_user_id: null, src: 'new' }));
    return { rows: open.concat(fresh).map((x) => Object.assign(x, { party_name: (D.cust.find((c) => c.party_id === x.party_id) || {}).display_name, phone: '+919840011111', last_outcome: null, last_at: null, stage: 'lead' })) };
  }
  if (/^UPDATE party_followup SET done_at = now\(\), done_by = \$3 WHERE owner_entity_id = \$1 AND party_id = \$2/.test(sql)) {
    assert.strictEqual(p[0], 'E1'); D.followups.forEach((f) => { if (f.owner === p[0] && f.party_id === p[1] && !f.done_at) f.done_at = new Date().toISOString(); }); return { rows: [] };
  }
  if (/^SELECT body FROM party_interaction/.test(sql)) return { rows: D.interactions.filter((i) => i.owner === p[0] && i.party_id === p[1] && i.kind === 'call').sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 2).map((i) => ({ body: i.body })) };
  if (/^SELECT txn_count FROM customer_list WHERE owner_entity_id = \$1 AND customer_identity_id = \$2 AND added_via = 'lead'/.test(sql)) { const r = D.cust.find((x) => x.owner === p[0] && x.party_id === p[1] && x.added_via === 'lead'); return { rows: r ? [{ txn_count: r.txn_count }] : [] }; }
  if (/^INSERT INTO memberships/.test(sql)) { assert.ok(state.table); const r = { membership_id: 'm' + (MEM.length + 1), entity_id: p[0], item_id: p[2], kind: p[3], grp: p[4], at: new Date().toISOString() }; MEM.push(r); return { rows: [r] }; }
  if (/^SELECT EXISTS \(SELECT 1 FROM customer_list WHERE owner_entity_id = \$1 AND customer_identity_id = \$2\) OR/.test(sql)) return { rows: [{ ok: D.cust.some((r) => r.owner === p[0] && r.party_id === p[1]) }] };
  return null;
};
const post = (id, body) => t.post('/parties/' + id + '/outcome', body);

(async () => {
  await ita('before b276: both routes answer 503 CRM_NOT_MIGRATED, nothing written', async () => {
    D.migrated = false; F.forget();
    const g = await t.get('/calls'); assert.strictEqual(g.status, 503); assert.strictEqual(g.body.code, 'CRM_NOT_MIGRATED');
    const p = await post(P(1), { outcome: 'interested' }); assert.strictEqual(p.status, 503);
    D.migrated = true; F.forget(); assert.strictEqual(D.interactions.length, 0);
  });
  await ita('GET /calls: one statement; an untouched lead and a late follow-up; the outcome buttons come from the server (no days in them)', async () => {
    D.followups.push({ owner: 'E1', party_id: P(2), followup_id: 'f1', what: 'Ring', due_at: new Date(Date.now() - 2 * 86400000).toISOString(), created_at: new Date().toISOString(), assignee_user_id: 'E1', source: 'manual' });
    D.followups.push({ owner: 'E2', party_id: P(9), followup_id: 'f9', what: 'Theirs', due_at: new Date(Date.now() - 86400000).toISOString(), created_at: new Date().toISOString(), assignee_user_id: 'E2', source: 'manual' });
    stmts = []; const r = await t.get('/calls?scope=all'); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(stmts.filter((s) => /^SELECT q\./.test(s)).length, 1, 'ONE queue statement');
    assert.deepStrictEqual(r.body.calls.map((c) => c.party_id).sort(), [P(1), P(2), P(3)].sort(), 'the other shop never appears');
    const f = r.body.calls.find((c) => c.party_id === P(2)); assert.strictEqual(f.late, true); assert.strictEqual(f.phone, '+919840011111');
    assert.strictEqual(r.body.calls.find((c) => c.party_id === P(1)).new, true); assert.strictEqual(r.body.late, 1); assert.strictEqual(r.body.count, 3);
    assert.deepStrictEqual(r.body.outcomes.map((o) => o.key), ['no_answer', 'call_back', 'interested', 'demo_booked', 'not_now', 'wrong_number']);
    assert.ok(r.body.outcomes.every((o) => !('days' in o)), 'the web holds no days'); assert.deepStrictEqual(r.body.may, { ok: true });
  });
  await ita('interested: call logged (call · out · the word), the open follow-up closed, the next is +2 days, source interaction', async () => {
    const r = await post(P(2), { outcome: 'interested' }); assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.interaction.body, 'Interested'); assert.strictEqual(r.body.interaction.kind, 'call'); assert.strictEqual(r.body.interaction.direction, 'out');
    assert.strictEqual(r.body.followup.due_day, day(2)); assert.strictEqual(r.body.followup.source, 'interaction'); assert.strictEqual(r.body.stage, null);
    assert.ok(D.followups.find((f) => f.followup_id === 'f1').done_at, 'the old follow-up is closed'); assert.strictEqual(D.followups.filter((f) => f.party_id === P(2) && !f.done_at).length, 1);
    assert.ok(D.followups.find((f) => f.followup_id === 'f9' && !f.done_at), "another shop's follow-up is untouched");
  });
  await ita('demo booked: needs a day (400, nothing written); with a date it moves the lead to Demo', async () => {
    const n0 = D.interactions.length;
    let r = await post(P(1), { outcome: 'demo_booked' }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'NEED_DAY'); assert.strictEqual(D.interactions.length, n0);
    r = await post(P(1), { outcome: 'demo_booked', due_at: day(-1) }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'BAD_DUE');
    r = await post(P(1), { outcome: 'demo_booked', due_at: day(4) }); assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.stage.stage, 'demo'); assert.strictEqual(r.body.followup.due_day, day(4)); assert.strictEqual(MEM.length, 1); assert.strictEqual(MEM[0].entity_id, 'E1');
  });
  await ita('call back: the presets (today · tomorrow · 3 days); an unknown pick is refused', async () => {
    let r = await post(P(3), { outcome: 'call_back', after: '3days' }); assert.strictEqual(r.body.followup.due_day, day(3));
    r = await post(P(3), { outcome: 'call_back', after: 'today' }); assert.strictEqual(r.body.followup.due_day, day(0));
    r = await post(P(3), { outcome: 'call_back', after: 'never' }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'BAD_AFTER');
  });
  await ita('not now → +30 days and Parked; wrong number → no follow-up and Lost; a customer\'s stage is not touched', async () => {
    let r = await post(P(3), { outcome: 'not_now' }); assert.strictEqual(r.body.followup.due_day, day(30)); assert.strictEqual(r.body.stage.stage, 'parked');
    r = await post(P(3), { outcome: 'wrong_number' }); assert.strictEqual(r.body.followup, null); assert.strictEqual(r.body.stage.stage, 'lost');
    assert.strictEqual(D.followups.filter((f) => f.party_id === P(3) && !f.done_at).length, 0, 'wrong number leaves no follow-up');
    const m = MEM.length; r = await post(P(2), { outcome: 'not_now' }); assert.strictEqual(r.status, 201); assert.strictEqual(r.body.stage, null); assert.strictEqual(MEM.length, m);
  });
  await ita('no answer: +1 day; the 3rd in a row → +3 days and a Parked suggestion', async () => {
    D.interactions.length = 0;
    const spread = () => D.interactions.forEach((i, k) => { i.at = new Date(Date.now() - (10 - k) * 60000).toISOString(); });
    let r = await post(P(2), { outcome: 'no_answer' }); assert.strictEqual(r.body.followup.due_day, day(1)); assert.strictEqual(r.body.suggest, null);
    spread(); r = await post(P(2), { outcome: 'no_answer' }); assert.strictEqual(r.body.followup.due_day, day(1));
    spread(); r = await post(P(2), { outcome: 'no_answer' }); assert.strictEqual(r.body.followup.due_day, day(3)); assert.deepStrictEqual(r.body.suggest, { stage: 'parked' });
  });
  await ita('b297 absent: a stage-moving outcome → 503 LEADS_NOT_MIGRATED, NOTHING written; one with no stage still works; the queue says may:false', async () => {
    state.table = false; const n = D.interactions.length, f = D.followups.length;
    let r = await post(P(1), { outcome: 'not_now' }); assert.strictEqual(r.status, 503); assert.strictEqual(r.body.code, 'LEADS_NOT_MIGRATED'); assert.strictEqual(D.interactions.length, n); assert.strictEqual(D.followups.length, f);
    r = await post(P(1), { outcome: 'interested' }); assert.strictEqual(r.status, 201);
    const q = await t.get('/calls'); assert.strictEqual(q.body.may.ok, false); state.table = true;
  });
  await ita('another shop\'s party → 404; a bad outcome → 400; a bad id → 400', async () => {
    let r = await post(P(9), { outcome: 'interested' }); assert.strictEqual(r.status, 404);
    r = await post(P(1), { outcome: 'nope' }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'BAD_OUTCOME');
    r = await post('not-an-id', { outcome: 'interested' }); assert.strictEqual(r.status, 400);
  });
  console.log(pass + ' checks'); process.exit(process.exitCode || 0);
})();
