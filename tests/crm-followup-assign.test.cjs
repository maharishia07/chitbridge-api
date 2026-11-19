/**
 * CARD  11-crm-and-marketing/follow-ups
 * CRM assign defects (ASSIGN-CRM-MARKETING-2026-11-18): a leaver's open follow-ups move (to the chosen colleague, else the default assignee, else Unassigned) · the bell never rings a switched-off person
 * · a view-only person cannot hold a follow-up (ASSIGNEE_VIEW_ONLY, by the one rule lib/assign-chit) · done is the holder's or the owner's (NOT_HOLDER_DONE), an unassigned one anyone's · scope=unassigned.
 * Offline (tests/support/crm-stub.cjs). Run: node tests/crm-followup-assign.test.cjs
 */
'use strict';
const assert = require('assert');
const { make, row } = require('./support/crm-stub.cjs');
const t = make(), D = t.data, F = require('../lib/crm-followups'), H = require('../lib/books-hooks');
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ANNA = 'a1000000-0000-4000-8000-000000000001', BEN = 'a2000000-0000-4000-8000-000000000002', VIC = 'a3000000-0000-4000-8000-000000000003';
D.team.push(VIC);
D.actors = { [ANNA]: { hat: 'cashier', access_level: 'editor' }, [BEN]: { hat: 'cashier', access_level: 'editor' }, [VIC]: { hat: 'cashier', access_level: 'viewer' } };
D.cust = [Object.assign(row({ party_id: P(2), display_name: 'Chola' }), { customer_type: 'entity', added_via: 'manual', txn_count: 1, segment: 'new' })];
D.country = 'IN';
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };
const day = (n) => H.dayOf(new Date(Date.now() + n * 86400000).toISOString(), 'IN');
const as = (id) => (id === 'E1' ? t.as('E1') : t.as('E1', { identity: { identity_id: id, parent_entity_id: 'E1' } }));
const mk = async (who) => (await t.post('/followups', { party_id: P(2), what: 'Call', due_at: day(0), assignee_user_id: who })).body.followup;
const words = (r) => r.body.message || r.body.error || r.body.detail || '';

(async () => {
  as('E1');
  await ita('3 - a view-only person cannot be given a follow-up (create and hand-over): 400 ASSIGNEE_VIEW_ONLY with its sentence; an editor can', async () => {
    let r = await t.post('/followups', { party_id: P(2), what: 'x', due_at: day(0), assignee_user_id: VIC });
    assert.strictEqual(r.status, 400, JSON.stringify(r.body)); assert.strictEqual(r.body.code, "ASSIGNEE_VIEW_ONLY"); assert.match(words(r), /view-only/);
    const f = await mk(BEN); assert.strictEqual(f.assignee_user_id, BEN);
    r = await t.patch('/followups/' + f.followup_id, { assignee_user_id: VIC }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'ASSIGNEE_VIEW_ONLY');
    r = await t.patch('/followups/' + f.followup_id, { assignee_user_id: ANNA }); assert.strictEqual(r.status, 200);
  });
  await ita('3 - a switched-off person is not on the team any more: BAD_ASSIGNEE', async () => {
    D.actors[BEN].break_status = 'deactivated';
    const r = await t.post('/followups', { party_id: P(2), what: 'x', due_at: day(0), assignee_user_id: BEN });
    assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'BAD_ASSIGNEE'); delete D.actors[BEN].break_status;
  });
  await ita('5 - done and reopen: the holder and the owner may; another editor is refused 403 NOT_HOLDER_DONE; an unassigned follow-up is anyones', async () => {
    as('E1'); const f = await mk(ANNA);
    as(BEN); let r = await t.patch('/followups/' + f.followup_id, { done: true }); assert.strictEqual(r.status, 403, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'NOT_HOLDER_DONE');
    as(ANNA); r = await t.patch('/followups/' + f.followup_id, { done: true }); assert.strictEqual(r.status, 200);
    as(BEN); r = await t.patch('/followups/' + f.followup_id, { done: false }); assert.strictEqual(r.status, 403);
    as('E1'); r = await t.patch('/followups/' + f.followup_id, { done: false }); assert.strictEqual(r.status, 200);
    r = await t.patch('/followups/' + f.followup_id, { assignee_user_id: null }); assert.strictEqual(r.status, 200);
    as(BEN); r = await t.patch('/followups/' + f.followup_id, { done: true }); assert.strictEqual(r.status, 200, 'unassigned: any editor may close it'); as('E1');
  });
  await ita('6 - scope=unassigned lists only the follow-ups nobody holds', async () => {
    D.followups.length = 0; await mk(ANNA); const u = await mk(ANNA);
    await t.patch('/followups/' + u.followup_id, { assignee_user_id: null });
    const r = await t.get('/followups?scope=unassigned'); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.followups.length, 1); assert.strictEqual(r.body.followups[0].assignee_user_id, null);
  });
  await ita('1 - a leavers open follow-ups move to the chosen colleague; done ones stay; others untouched', async () => {
    D.followups.length = 0; const a1 = await mk(ANNA), a2 = await mk(ANNA), b1 = await mk(BEN);
    as(ANNA); await t.patch('/followups/' + a2.followup_id, { done: true }); as('E1');
    const n = await F.rerouteFollowups(t.handle, 'E1', ANNA, BEN);
    assert.strictEqual(n, 1); const by = (id) => D.followups.find((x) => x.followup_id === id);
    assert.strictEqual(by(a1.followup_id).assignee_user_id, BEN); assert.strictEqual(by(a2.followup_id).assignee_user_id, ANNA, 'a done one keeps its history'); assert.strictEqual(by(b1.followup_id).assignee_user_id, BEN);
  });
  await ita('1 - no colleague chosen: the default assignee when fit, else the Unassigned bucket (never the leaver, never a viewer)', async () => {
    const h = { query: async (sql, p) => (/default_assignee_actor_id FROM entity_actor_settings/.test(sql) ? { rows: [{ default_assignee_actor_id: D.defaultAssignee }] } : t.query(sql, p)) };
    D.defaultAssignee = BEN; assert.strictEqual(await F.heirOf(h, 'E1', ANNA, null), BEN);
    D.defaultAssignee = ANNA; assert.strictEqual(await F.heirOf(h, 'E1', ANNA, null), null, 'the default is the leaver');
    D.defaultAssignee = VIC; assert.strictEqual(await F.heirOf(h, 'E1', ANNA, null), null, 'a viewer cannot hold');
    D.defaultAssignee = null; assert.strictEqual(await F.heirOf(h, 'E1', ANNA, null), null);
    assert.strictEqual(await F.heirOf(h, 'E1', ANNA, { identity_id: BEN }), BEN);
  });
  await ita('2 - the bell does not ring a switched-off assignee (and still rings the others)', async () => {
    D.followups.length = 0; const fu = (who) => ({ followup_id: t.uid(), owner: 'E1', party_id: P(2), what: 'x', due_at: H.dayBounds(day(0), 'IN').from, assignee_user_id: who, done_at: null, bell_day: null, source: 'manual' });
    D.followups.push(fu(ANNA), fu(BEN)); D.actors[ANNA].break_status = 'deactivated';
    const ev = []; await F.sweep({ emit: (ids, e) => ev.push(e) });
    assert.deepStrictEqual(ev.map((e) => e.for), [BEN]); delete D.actors[ANNA].break_status;
  });
  console.log(pass + ' passed'); t.close();
})();
