'use strict';
/**
 * tests/crm-assign.realstack.cjs - the CRM follow-up assign defects on a REAL server and a REAL Postgres (RLS on, as cb_app), a throwaway database only.
 * HAND-COMPUTED (shop S: owner; staff A editor, B editor, V viewer; follow-ups made by the owner on one lead):
 *   1 viewer      handing a follow-up to V (create, hand-over): 400 ASSIGNEE_VIEW_ONLY; to B: 200.
 *   2 done        B closing A's follow-up: 403 NOT_HOLDER_DONE; A, then the owner, may; an unassigned one: B may.
 *   3 leaver      A holds 3 open + 1 done; default assignee = B; switch A off (no task_action: A holds no chit): followups_routed 3, all 3 are B's, the done one stays A's.
 *   4 leaver      C holds 2 open; no default assignee; switch C off with task_action actor -> B: B holds them. D holds 1, default cleared, none chosen: Unassigned (assignee null).
 *   5 unassigned  scope=unassigned lists exactly the open ones nobody holds (the one of D); scope=mine for B does not list it.
 *   6 bell        an open due follow-up still held by a switched-off person (planted directly) rings nobody; B's rings.
 * Run: DATABASE_URL=postgres://cb_app:cbapp@127.0.0.1:55421/cb_x JWT_SECRET=... node tests/crm-assign.realstack.cjs --base http://127.0.0.1:3611
 * CARD 11-crm-and-marketing/follow-ups
 */
const path = require('path');
const jsonWebToken = require('jsonwebtoken');
const API = path.join(__dirname, '..');
const arg = (name) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : null; };
const BASE = arg('--base');
if (!BASE || !process.env.DATABASE_URL || !process.env.JWT_SECRET) { console.error('needs --base, DATABASE_URL (cb_app, throwaway) and JWT_SECRET'); process.exit(3); }
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(process.env.DATABASE_URL);
if (!parts || parts[1] !== 'cb_app' || !/^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/.test(parts[2])) { console.error('REFUSED: cb_app on localhost or a SIT host only'); process.exit(3); }
process.env.NODE_ENV = 'test';
const { query, withEntity } = require(path.join(API, 'db'));
const F = require(path.join(API, 'lib', 'crm-followups'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 500) : '')); } };
const RUN = 'ca' + (Date.now() % 1e9).toString(36).padStart(6, '0');
const tokenFor = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
async function shop() {
  const bridgeId = 'CB' + RUN + 's';
  const { rows: [i] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id`, [bridgeId, 'Assign shop ' + RUN, bridgeId.toLowerCase()]);
  return { id: i.identity_id, bridgeId, token: tokenFor({ identity_id: i.identity_id, identity_type: 'entity', bridge_id: bridgeId, display_name: 'Assign shop' }) };
}
async function person(s, tag, hat, level) {
  const key = (RUN + tag).toLowerCase();
  const { rows: [r] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, true, false, $6) RETURNING identity_id`, [s.bridgeId + tag, 'Person ' + tag, s.id, key, level, hat]);
  return { id: r.identity_id, token: tokenFor({ identity_id: r.identity_id, identity_type: 'actor', bridge_id: s.bridgeId, display_name: 'Person ' + tag, parent_entity_id: s.id }) };
}
async function call(token, method, route, body) {
  const res = await fetch(BASE + route, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, 'Idempotency-Key': require('crypto').randomUUID() }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch (e) { /* no body */ }
  return { status: res.status, body: json };
}

(async () => {
  const S = await shop();
  const A = await person(S, 'a', 'act', 'editor'), B = await person(S, 'b', 'act', 'editor'), C = await person(S, 'c', 'act', 'editor'), D = await person(S, 'd', 'act', 'editor'), V = await person(S, 'v', 'view_only', 'viewer');
  const lead = await call(S.token, 'POST', '/api/crm/leads', { name: 'Lead ' + RUN, phone: '04123' + String(Date.now()).slice(-5) });
  const party = lead.body && lead.body.party && lead.body.party.party_id; ok('a lead to hang follow-ups on', lead.status === 201 && party, JSON.stringify(lead.body));
  const due = require('./lib/shop-day.cjs').shopDayAt(1); /* tomorrow on the shop's own clock (tests/lib/shop-day.cjs), never the runner's UTC day */
  const fu = async (token, who) => { const r = await call(token, 'POST', '/api/crm/followups', { party_id: party, what: 'Call', due_at: due, assignee_user_id: who }); return r.body && r.body.followup; };
  const heldBy = (id) => withEntity(S.id, async (db) => (await db.query(`SELECT assignee_user_id FROM party_followup WHERE followup_id = $1`, [id])).rows[0].assignee_user_id);
  const setDefault = (who) => withEntity(S.id, (db) => db.query(`INSERT INTO entity_actor_settings (entity_id, assignment_model, auto_assign_mode, default_assignee_actor_id, default_max_tasks) VALUES ($1, 'both', 'off', $2, 100) ON CONFLICT (entity_id) DO UPDATE SET default_assignee_actor_id = $2`, [S.id, who]));

  console.log('1 viewer');
  let r = await call(S.token, 'POST', '/api/crm/followups', { party_id: party, what: 'x', due_at: due, assignee_user_id: V.id });
  ok('create for a viewer: 400 ASSIGNEE_VIEW_ONLY', r.status === 400 && r.body.code === 'ASSIGNEE_VIEW_ONLY', JSON.stringify(r.body));
  const f1 = await fu(S.token, B.id); r = await call(S.token, 'PATCH', '/api/crm/followups/' + f1.followup_id, { assignee_user_id: V.id });
  ok('hand-over to a viewer: 400 ASSIGNEE_VIEW_ONLY', r.status === 400 && r.body.code === 'ASSIGNEE_VIEW_ONLY', JSON.stringify(r.body));
  r = await call(S.token, 'PATCH', '/api/crm/followups/' + f1.followup_id, { assignee_user_id: A.id }); ok('hand-over to an editor: 200', r.status === 200, JSON.stringify(r.body));

  console.log('2 done');
  r = await call(B.token, 'PATCH', '/api/crm/followups/' + f1.followup_id, { done: true }); ok('B closes A\'s: 403 NOT_HOLDER_DONE', r.status === 403 && r.body.code === 'NOT_HOLDER_DONE', JSON.stringify(r.body));
  r = await call(A.token, 'PATCH', '/api/crm/followups/' + f1.followup_id, { done: true }); ok('A (holder) closes: 200', r.status === 200, JSON.stringify(r.body));
  r = await call(S.token, 'PATCH', '/api/crm/followups/' + f1.followup_id, { done: false }); ok('owner reopens: 200', r.status === 200, JSON.stringify(r.body));
  await call(S.token, 'PATCH', '/api/crm/followups/' + f1.followup_id, { assignee_user_id: null });
  r = await call(B.token, 'PATCH', '/api/crm/followups/' + f1.followup_id, { done: true }); ok('an unassigned one: B may close', r.status === 200, JSON.stringify(r.body));

  console.log('3 leaver, default assignee B');
  await setDefault(B.id);
  const a1 = await fu(S.token, A.id), a2 = await fu(S.token, A.id), a3 = await fu(S.token, A.id), a4 = await fu(S.token, A.id);
  await call(A.token, 'PATCH', '/api/crm/followups/' + a4.followup_id, { done: true });
  r = await call(S.token, 'PUT', '/api/actors/' + A.id + '/status', { action: 'deactivate' });
  ok('A switched off: 200, followups_routed 3', r.status === 200 && r.body.followups_routed === 3, JSON.stringify(r.body));
  const heirs = await Promise.all([a1, a2, a3].map((x) => heldBy(x.followup_id)));
  ok('the three open ones are B\'s', heirs.every((x) => x === B.id), heirs.join());
  ok('the done one stays A\'s', (await heldBy(a4.followup_id)) === A.id);

  console.log('4 leaver, a chosen colleague; and no default');
  const c1 = await fu(S.token, C.id), c2 = await fu(S.token, C.id);
  r = await call(S.token, 'PUT', '/api/actors/' + C.id + '/status', { action: 'deactivate', task_action: 'actor', target_actor_id: B.id });
  ok('C switched off to B: followups_routed 2', r.status === 200 && r.body.followups_routed === 2, JSON.stringify(r.body));
  ok('both are B\'s', (await heldBy(c1.followup_id)) === B.id && (await heldBy(c2.followup_id)) === B.id);
  await setDefault(null);
  const d1 = await fu(S.token, D.id);
  r = await call(S.token, 'PUT', '/api/actors/' + D.id + '/status', { action: 'deactivate' });
  ok('D switched off, no default: followups_routed 1', r.status === 200 && r.body.followups_routed === 1, JSON.stringify(r.body));
  ok('D\'s one is unassigned', (await heldBy(d1.followup_id)) === null);

  console.log('5 unassigned filter');
  r = await call(S.token, 'GET', '/api/crm/followups?scope=unassigned&done=0');
  ok('scope=unassigned lists exactly D\'s one', r.status === 200 && r.body.followups.length === 1 && r.body.followups[0].followup_id === d1.followup_id, JSON.stringify(r.body).slice(0, 300));
  r = await call(B.token, 'GET', '/api/crm/followups?scope=mine&done=0'); ok('B mine does not list it', r.status === 200 && !r.body.followups.some((x) => x.followup_id === d1.followup_id));

  console.log('6 bell');
  const ghost = await fu(S.token, B.id);
  await withEntity(S.id, (db) => db.query(`UPDATE party_followup SET assignee_user_id = $2, bell_day = NULL WHERE followup_id = $1`, [ghost.followup_id, A.id])); /* A is switched off: a row from before the fix */
  await withEntity(S.id, (db) => db.query(`UPDATE party_followup SET bell_day = NULL WHERE owner_entity_id = $1`, [S.id]));
  const rung = []; await F.sweep({ now: new Date(Date.now() + 2 * 864e5).toISOString(), emit: (ids, e) => { if (ids[0] === S.id) rung.push(e.for); } });
  ok('the sweep rings B and never the switched-off A', rung.includes(B.id) && !rung.includes(A.id), JSON.stringify(rung));

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e.stack); process.exit(1); });
