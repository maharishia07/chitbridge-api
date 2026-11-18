'use strict';
/**
 * tests/people-tasks-route-truth.realstack.cjs — PEOPLE per-person tasks and routing on a REAL Postgres, the api running as cb_app (RLS on).
 *
 * OWNS     the result of GET /api/actors/:id/tasks (the person's own list, their load and cap, the pager's total/page/limit) and of
 *          PUT /api/actors/:id/tasks/route (the owner takes a job off a person: back to the pool, or on to a colleague who is on),
 *          the card's named gap ("No test asserts the per-person task list or routing (pool/actor) result").
 * FLOW     fresh shop S with people A and B; another shop X sends S an order (it lands in S's pool); the owner pushes it to A
 *          (PUT /assign, the existing writer) and then routes it: A to B, B to the pool, to a person on leave (refused), bad input (refused),
 *          another shop's token asking for S's person (404). Every door is a route; the database is read with SELECT only.
 * CARD     17-people-employees-hr-and-payroll/per-person-tasks-and-routing
 *
 *   T-1  after the push, GET /:A/tasks lists the chit (total 1, page/limit present) and A's count reads 1; B's list is empty
 *   T-2  route push A to B: 200, the chit moves lists (A 0, B 1), the row names B (id and display name), counts follow (A 0, B 1)
 *   T-3  route pool: 200, the chit has no holder (assigned_to_actor_id null), B's list is empty again and B's count 0
 *   T-4  route push to a person on leave: 400, the chit stays where it was
 *   T-5  refusals: no chit or no action 400; an unknown chit 404; an unknown action 400; another shop's token asking for S's person 404
 * CI: picked up by the T2 loop over tests/*-truth.realstack.cjs.
 */
const H = require('./lib/truth-harness.cjs');
const { Client } = require('pg');
const { j, ok, kase, expect, freshShop, finish, DB } = H;
const RUN = 'tk' + (Date.now() % 1e9).toString(36).padStart(6, '0');
const asOwner = async (sql, args) => { const c = new Client({ connectionString: DB }); await c.connect(); try { return (await c.query(sql, args)).rows; } finally { await c.end(); } };
const holder = async (shop, chit) => (await asOwner('SELECT assigned_to_actor_id AS a, assigned_to_actor_display_name AS n FROM chit_status WHERE entity_id = $1 AND chit_id = $2', [shop.entity, chit]))[0];
let S, X, A, B, CHIT;
async function person(shop, label) {
  const key = (label + RUN).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  const r = ok(await j('/api/actors', { method: 'POST', token: shop.token, body: { display_name: 'Person ' + label + ' ' + RUN, actor_key: key, email: key + '@' + H.TARGET.emailDomain, hat: 'act', max_tasks: 5 } }), 'create ' + label);
  return { id: r.b.actor.identity_id, name: 'Person ' + label + ' ' + RUN };
}
const tasks = async (who, token) => (await j('/api/actors/' + who.id + '/tasks', { token: token || S.token }));
const route = (who, body, token) => j('/api/actors/' + who.id + '/tasks/route', { method: 'PUT', token: token || S.token, body });

(async () => {
  console.log('\n── PEOPLE per-person tasks on ' + H.API + ' · run ' + RUN + ' ──');
  const au = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: false } };
  S = await freshShop(RUN + 's', 'Shop', au);
  X = await freshShop(RUN + 'x', 'Buyer', au);
  A = await person(S, 'aa'); B = await person(S, 'bb');
  const sent = ok(await j('/api/chits/send', { method: 'POST', token: X.token, body: H.order('T' + RUN, [[{ name: 'Tea', unit: 'pcs', price: 100 }, 2]], { to: { bridge: S.bridge, name: S.name } }) }), 'the order did not send');
  CHIT = sent.b.chit_id || (sent.b.chit && sent.b.chit.chit_id);
  expect(CHIT, 'no chit id in the send reply');
  const pushed = await j('/api/actors/assign/' + CHIT, { method: 'PUT', token: S.token, body: { action: 'push', target_actor_id: A.id } });
  expect(pushed.status === 200, 'the owner could not push the order to A: HTTP ' + pushed.status + ' ' + JSON.stringify(pushed.b).slice(0, 200));

  await kase('T-1', "A's list holds the chit with total/page/limit and A's count 1; B's list is empty", async () => {
    const a = await tasks(A), b = await tasks(B);
    expect(a.status === 200, 'HTTP ' + a.status + ' ' + JSON.stringify(a.b).slice(0, 200));
    expect(a.b.total === 1 && a.b.tasks.length === 1 && a.b.tasks[0].chit_id === CHIT, "A's list: " + JSON.stringify(a.b).slice(0, 300));
    expect(a.b.page >= 1 && a.b.limit >= 1, 'the pager fields total/page/limit are missing');
    expect(Number(a.b.actor.current_task_count) === 1 && Number(a.b.actor.max_tasks) === 5, "A's load/cap: " + JSON.stringify(a.b.actor));
    expect(b.status === 200 && b.b.total === 0 && b.b.tasks.length === 0 && Number(b.b.actor.current_task_count) === 0, "B's list: " + JSON.stringify(b.b).slice(0, 300));
  });
  await kase('T-2', 'route push A to B: the chit moves lists, the row names B, the counts follow', async () => {
    const r = await route(A, { chit_id: CHIT, action: 'push', to_actor_id: B.id });
    expect(r.status === 200, 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    const h = await holder(S, CHIT);
    expect(h.a === B.id && h.n === B.name, 'the row holder: ' + JSON.stringify(h));
    const a = await tasks(A), b = await tasks(B);
    expect(a.b.total === 0 && Number(a.b.actor.current_task_count) === 0, "A after: " + JSON.stringify(a.b).slice(0, 300));
    expect(b.b.total === 1 && b.b.tasks[0].chit_id === CHIT && Number(b.b.actor.current_task_count) === 1, "B after: " + JSON.stringify(b.b).slice(0, 300));
  });
  await kase('T-3', 'route pool: the chit has no holder and B is back to 0', async () => {
    const r = await route(B, { chit_id: CHIT, action: 'pool' });
    expect(r.status === 200, 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    const h = await holder(S, CHIT);
    expect(h.a === null, 'the chit still has a holder: ' + JSON.stringify(h));
    const b = await tasks(B);
    expect(b.b.total === 0 && Number(b.b.actor.current_task_count) === 0, "B after: " + JSON.stringify(b.b).slice(0, 300));
  });
  await kase('T-4', 'route push to a person on leave is refused 400 and the chit stays', async () => {
    ok(await j('/api/actors/assign/' + CHIT, { method: 'PUT', token: S.token, body: { action: 'push', target_actor_id: A.id } }), 'push to A');
    ok(await j('/api/actors/break', { method: 'PUT', token: S.token, body: { break_type: 'leave', actor_id: B.id } }), 'B on leave');
    const r = await route(A, { chit_id: CHIT, action: 'push', to_actor_id: B.id });
    expect(r.status === 400, 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    expect((await holder(S, CHIT)).a === A.id, 'the chit moved although the target was away');
  });
  await kase('T-5', 'refusals: missing input 400, unknown chit 404, unknown action 400, another shop 404', async () => {
    const miss = await route(A, { action: 'pool' });
    expect(miss.status === 400, 'no chit: HTTP ' + miss.status);
    const none = await route(A, { chit_id: '99999999-9999-4999-8999-999999999999', action: 'pool' });
    expect(none.status === 404, 'unknown chit: HTTP ' + none.status);
    const bad = await route(A, { chit_id: CHIT, action: 'teleport' });
    expect(bad.status === 400, 'unknown action: HTTP ' + bad.status);
    const other = await tasks(A, X.token);
    expect(other.status === 404, "another shop's token reading S's person: HTTP " + other.status);
    const otherRoute = await route(A, { chit_id: CHIT, action: 'pool' }, X.token);
    expect(otherRoute.status === 404, "another shop routing S's person: HTTP " + otherRoute.status);
    expect((await holder(S, CHIT)).a === A.id, 'a refusal moved the chit');
  });
  finish('people-tasks-route', process.env.TRUTH_JSON);
})().catch((e) => { console.error(e); process.exit(1); });
