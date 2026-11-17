'use strict';
/**
 * tests/d3-dispute-route.realstack.cjs — D3: the dispute handler is ONE entity_work_routing row, kind 'dispute' (critic PM/critic/D3-DISPUTES-ASSIGN-CRITIC-2026-11-18.md T1–T5).
 * Real Postgres as cb_app (RLS on), through the routes; the database is only READ as the owner. LOCAL / throwaway SIT box only. Run: node tests/d3-dispute-route.realstack.cjs
 *   T1 bell      a dispute on a POOLED chit: the route's person has dispute_for_me, another person does not; no route: nobody
 *   T2 held      the chit is held by Y, route X: Y has assigned_to_me, X does NOT get dispute_for_me (a dispute follows the holder)
 *   T3 refused   a read-only seat, another shop's person and a stranger id are refused (PUT /routing and PATCH /profile); a folder or team on kind dispute is refused
 *   T4 leaver    removing the routed person clears the routing row AND the legacy column
 *   T5 dual      PATCH /profile writes the column and the routing row; PUT /routing clear empties both
 * The backfill file run twice is tests/d3-dispute-route-backfill.realstack.cjs; a routeFor fault failing open is tests/api-problem-bell.test.cjs.
 * CARD 01-rail-core-the-chit/README · 03-disputes-service-and-register/README
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'd3' + (Date.now() % 1e8).toString(36).padStart(6, '0');
const pg = new Client({ connectionString: H.DB });
const rows = async (sql, args) => (await pg.query(sql, args)).rows;

async function person(shop, tag, level) {
  const key = ('p' + tag + RUN).slice(0, 12), username = key + '@' + shop.name.split(' ').pop();
  const a = ok(await j('/api/actors', { method: 'POST', token: shop.token, body: { display_name: 'Person ' + tag + RUN, actor_key: key, email: key + '@local.test', access_level: level || 'editor', hat: level === 'viewer' ? 'view' : 'act' } }), 'add ' + tag).b.actor;
  ok(await j('/api/actors/check-login?username=' + encodeURIComponent(username)), 'code ' + tag);
  const token = ok(await j('/api/actors/login', { method: 'POST', body: { username, otp: H.ENTITY_OTP } }), 'sign in ' + tag).b.token;
  return { id: a.identity_id || a.actor_id, token };
}
const feedRow = async (who, chit) => (ok(await j('/api/notifications', { token: who.token }), 'feed').b.notifications || []).filter((n) => n.chit_id === chit && n.action === 'dispute_raised')[0] || null;
const routeRow = async (shop) => (await rows(`SELECT assignee_actor_id AS a FROM entity_work_routing WHERE entity_id = $1 AND kind = 'dispute'`, [shop.entity]))[0];
const columnOf = async (shop) => (await rows('SELECT dispute_handler_actor_id AS h FROM identities WHERE identity_id = $1', [shop.entity]))[0].h;
const putRoute = (shop, body) => j('/api/entities/routing', { method: 'PUT', token: shop.token, body: Object.assign({ kind: 'dispute', folder_id: null, route_to_entity_id: null }, body) });

(async () => {
  await pg.connect();
  console.log('\n── D3 dispute route on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const A = await freshShop('a' + RUN, 'Sender'), B = await freshShop('b' + RUN, 'Holder');
  const X = await person(B, 'x'), Y = await person(B, 'y'), V = await person(B, 'v', 'viewer');
  const Z = await person(A, 'z'); /* another shop's person */
  const send = async (tag) => ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: { recipients: [{ display_name: B.name, bridge_id: B.bridge, kind: 'to' }], purpose: 'general', subject: 'D3 ' + tag + RUN, manual_subject: 'D3 ' + tag + RUN, client_ref: RUN + tag, line_items: [] } }), 'send ' + tag).b.chit_id;
  const dispute = async (chit) => ok(await j('/api/chits/' + chit + '/disputes', { method: 'POST', token: A.token, body: { category: 'other', reason: 'D3 ' + RUN, target_entity_id: B.entity } }), 'raise').b;
  const pooled = await send('p'); await dispute(pooled);
  const held = await send('h'); await dispute(held);

  await kase('T1a', 'no route: nobody on a pooled chit gets dispute_for_me (today)', async () => {
    const r = [await feedRow(X, pooled), await feedRow(Y, pooled)];
    expect(r.every((n) => n && n.dispute_for_me === false), 'rows ' + JSON.stringify(r.map((n) => n && n.dispute_for_me)));
  });
  await kase('T5', 'PATCH profile writes the column AND the routing row', async () => {
    ok(await j('/api/entities/profile', { method: 'PATCH', token: B.token, body: { dispute_handler_actor_id: X.id } }), 'set');
    expect((await columnOf(B)) === X.id && ((await routeRow(B)) || {}).a === X.id, 'column ' + (await columnOf(B)) + ' route ' + JSON.stringify(await routeRow(B)));
  });
  await kase('T1b', 'route = X: X has dispute_for_me on the pooled chit, Y does not', async () => {
    const x = await feedRow(X, pooled), y = await feedRow(Y, pooled);
    expect(x && x.dispute_for_me === true && y && y.dispute_for_me === false, 'X ' + (x && x.dispute_for_me) + ' · Y ' + (y && y.dispute_for_me));
  });
  await kase('T2', 'held by Y, route X: Y has assigned_to_me, X does not get dispute_for_me', async () => {
    ok(await j('/api/actors/assign/' + held, { method: 'PUT', token: B.token, body: { action: 'push', target_actor_id: Y.id } }), 'push to Y');
    const x = await feedRow(X, held), y = await feedRow(Y, held);
    expect(y && y.assigned_to_me === true && x && x.dispute_for_me === false, 'Y mine ' + (y && y.assigned_to_me) + ' · X for_me ' + (x && x.dispute_for_me));
  });
  await kase('T3', 'a read-only seat, another shop person and a stranger id are refused; a folder or a team on kind dispute is refused', async () => {
    const seat = await putRoute(B, { assignee_actor_id: V.id }), other = await putRoute(B, { assignee_actor_id: Z.id }), junk = await putRoute(B, { assignee_actor_id: 'not-an-id' });
    const team = await putRoute(B, { assignee_actor_id: X.id, route_to_entity_id: A.entity });
    const patch = await j('/api/entities/profile', { method: 'PATCH', token: B.token, body: { dispute_handler_actor_id: V.id } });
    expect(seat.status === 400 && other.status === 404 && junk.status === 404 && team.status === 400 && patch.status === 400, `seat ${seat.status} other ${other.status} junk ${junk.status} team ${team.status} patch ${patch.status}`);
    expect(((await routeRow(B)) || {}).a === X.id, 'the route stayed X after the refusals');
  });
  await kase('T5b', 'PUT /routing kind dispute with no person clears the route AND the column; PUT with Y sets both', async () => {
    ok(await putRoute(B, { assignee_actor_id: null }), 'clear');
    const cleared = !(await routeRow(B)) && (await columnOf(B)) === null;
    ok(await putRoute(B, { assignee_actor_id: Y.id }), 'set Y');
    expect(cleared && ((await routeRow(B)) || {}).a === Y.id && (await columnOf(B)) === Y.id, 'cleared ' + cleared);
  });
  await kase('T4', 'removing the routed person clears the routing row and the column', async () => {
    const gone = ok(await j('/api/actors/' + Y.id + '/status', { method: 'PUT', token: B.token, body: { action: 'remove', confirm: 'REMOVE' } }), 'remove').b;
    expect(!(await routeRow(B)) && (await columnOf(B)) === null && gone.disputes_cleared === 1, 'route ' + JSON.stringify(await routeRow(B)) + ' column ' + (await columnOf(B)) + ' cleared ' + gone.disputes_cleared);
  });

  await pg.end();
  finish('d3-dispute-route');
})().catch((e) => { console.error(e); process.exit(1); });
