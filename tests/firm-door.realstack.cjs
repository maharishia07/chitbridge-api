'use strict';
/**
 * tests/firm-door.realstack.cjs — THE FIRM-PARENT DOOR on a REAL Postgres as cb_app (FIRM-PARENT-DOOR-DESIGN-2026-11-18 sections 3.5, 3.6, 4.3).
 *
 * OWNS      the proof, through the REAL routes (src/routes/network.js with its real owner gate, limiter and audit) that: the firm owner asks and the client owner approves; the client asks and the firm approves;
 *           the asker cannot approve its own ask; firm staff and a key are refused the ask (403 OWNER_ONLY); approval alone gives the firm no look; a grant opens it; a disconnect closes it on the next request;
 *           a client never sees another client through the firm (positive control: a governance member still sees siblings); access_events rows for ask, approve and end carry the actor and the states;
 *           with b882 absent the ask still succeeds; a stranger gets the same 404 as a missing edge; an unknown handle and a non-party ask answer the SAME 404; the open-ask cap; the named ask limiter;
 *           150 clients on one firm. The owner gate and the audit write each go red under tests/firm-door-mutation.realstack.cjs.
 * HAND-COMPUTED  firm F, clients A B C.  F asks A (agency, requested) → A approves → active. B asks F → F approves → active. Rows in A's trail: agency_asked (changed_by F), agency_approved (changed_by A), agency_ended (changed_by A).
 *           150 clients: 150 asks, 150 approvals, 150 grants → practice total 150. Cap 5 and limit 200 are set below, so: 5 open asks then the 6th = 409 AGENCY_ASKS_WAITING; after the 150 case the 200 asks of the window run out.
 * CALLED BY CI integration job / a throwaway postgres on sit-root. Run (database name must start fd_):
 *           DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/fd_x FIRMDOOR_ADMIN_URL=postgres://postgres:pw@localhost:5432/fd_x node tests/firm-door.realstack.cjs
 *           FIRMDOOR_ROUTES=src/routes/_mutant-network.js points it at a broken copy (tests/firm-door-mutation.realstack.cjs).
 * CARD      04-network/connections-and-invitations
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|[a-z0-9-]+)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)(?::\d+)?\/(\w+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2]) || !/^fd_/.test(parts[3])) { console.error('REFUSED: needs DATABASE_URL as cb_app on a THROWAWAY database whose name starts fd_'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'firm_door_test_secret_at_least_32_chars_pad';
process.env.FIRM_OPEN_ASK_CAP = '5';
process.env.NETWORK_ASK_RATE_LIMIT_MAX = '400';
const path = require('path');
const fs = require('fs');
const express = require('express');
const API = path.join(__dirname, '..');

const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const fakeAuth = (req, res, next) => {
  try { req.identity = JSON.parse(String(req.headers['x-test-as'] || '')); } catch (_) { return res.status(401).json({ error: 'no test identity' }); }
  if (req.headers['x-test-key']) req.api_key = { id: 'k' };
  return next();
};
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
fakeAuth.forgetKey = () => {};
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const net = require(path.join(API, 'src', 'services', 'network'));
const { query } = require(path.join(API, 'db'));
const grants = require(path.join(API, 'lib', 'books-grant.js'));
const accessEvents = require(path.join(API, 'lib', 'access-events.js'));
const practiceOf = require(path.join(API, 'lib', 'books-practice.js')).practice;
const ROUTES = process.env.FIRMDOOR_ROUTES ? path.join(API, process.env.FIRMDOOR_ROUTES) : path.join(API, 'src', 'routes', 'network.js');
const B882 = fs.readFileSync(path.join(API, 'migrations', 'b882_agency_edge_audit.sql'), 'utf8');
const B866_CHECK = `ALTER TABLE access_events DROP CONSTRAINT IF EXISTS access_events_action_check; ALTER TABLE access_events ADD CONSTRAINT access_events_action_check CHECK (action IN ('created', 'hat_changed', 'costs_changed', 'break_changed', 'removed', 'reactivated', 'reach_changed', 'code_issued', 'books_grant_given', 'books_grant_changed', 'books_grant_revoked', 'books_delegated_first', 'books_delegated_unlock', 'books_delegated_year_close'));`;

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 400) : '')); } };
const RUN = 'fd' + (Date.now() % 1e10).toString(36);
let serial = 0;

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag + (serial++);
  const { rows: [identity] } = await query(
    `INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id, catalogue_visibility) VALUES ($1, $2, 'entity', 'AU', 'AUD', $3, 'network') RETURNING identity_id`,
    [bridgeId, 'FIRMDOOR ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  return { tag, bridgeId, id: identity.identity_id, handle: bridgeId.toLowerCase(), node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
const asOwner = (biz) => ({ identity_id: biz.id, bridge_id: biz.bridgeId, identity_type: 'entity', parent_entity_id: null, display_name: biz.tag });
const asStaff = (biz) => ({ identity_id: biz.id.replace(/^./, '9'), bridge_id: biz.bridgeId, identity_type: 'actor', parent_entity_id: biz.id, display_name: 'staff of ' + biz.tag });

async function main() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.id = 'req-test'; next(); });
  app.use('/api/network', require(ROUTES));
  app.use('/api/network-design', require(path.join(API, 'routes', 'network-design.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (method, route, who, body, extra) => {
    const res = await fetch(base + route, { method, headers: Object.assign({ 'content-type': 'application/json', 'x-test-as': JSON.stringify(who) }, extra || {}), body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (_) { /* not json */ }
    return { status: res.status, body: json || {}, text };
  };
  const ask = (who, body, extra) => call('POST', '/api/network/connections', who, body, extra);
  const approve = (who, id) => call('POST', '/api/network/connections/' + id + '/approve', who, {});
  const events = async (entityId) => (await query(`SELECT action, changed_by, subject_identity_id, before_value, after_value FROM access_events WHERE entity_id = $1 AND action LIKE 'agency\\_%' ORDER BY at, event_id`, [entityId])).rows;
  const eventsBound = async (entityId) => require(path.join(API, 'db')).withEntity(entityId, (c) => c.query(`SELECT action, changed_by, subject_identity_id, before_value, after_value FROM access_events WHERE entity_id = $1 AND action LIKE 'agency\\_%' ORDER BY at, event_id`, [entityId]).then((r) => r.rows));
  const lookAs = (firm, client) => grants.look(firm.id, client.id, { actor: firm.id, pattern: 'GET /trial-balance', method: 'GET', listed: true }).catch((e) => e);

  try {
    const F = await business('f'), A = await business('a'), B = await business('b'), C = await business('c');
    const lostBefore = accessEvents.lostCount();

    // (a) the firm owner asks, the client owner approves
    const a1 = await ask(asOwner(F), { childHandle: A.handle, type: 'agency' });
    ok('a1 the firm owner asks client A: 201/200 with a requested agency edge', a1.status < 300 && a1.body.state === 'requested' && a1.body.type === 'agency', a1.text);
    const a2 = await approve(asOwner(A), a1.body.id);
    ok('a2 the client owner approves: the edge is active', a2.status === 200 && a2.body.state === 'active', a2.text);

    // (b) the client asks, the firm approves
    const b1 = await ask(asOwner(B), { parentHandle: F.handle, type: 'agency' });
    ok('b1 client B asks the firm: requested', b1.status < 300 && b1.body.state === 'requested', b1.text);
    const b2 = await approve(asOwner(F), b1.body.id);
    ok('b2 the firm approves B\'s ask: active', b2.status === 200 && b2.body.state === 'active', b2.text);

    // (c) the asker cannot approve its own ask
    const c0 = await ask(asOwner(F), { childHandle: C.handle, type: 'agency' });
    const c1 = await approve(asOwner(F), c0.body.id);
    ok('c1 the firm cannot approve its own ask (403 NOT_ALLOWED)', c1.status === 403 && c1.body.code === 'NOT_ALLOWED', c1.text);

    // (d) firm staff and a key are refused the ask
    const d1 = await ask(asStaff(F), { childHandle: B.handle, type: 'agency' });
    ok('d1 a firm assistant cannot ask (403 OWNER_ONLY, may false, a sentence)', d1.status === 403 && d1.body.code === 'OWNER_ONLY' && d1.body.may === false && /owner can ask/.test(d1.body.why || d1.body.detail || ''), d1.text);
    const d2 = await ask(asOwner(F), { childHandle: B.handle, type: 'agency' }, { 'x-test-key': '1' });
    ok('d2 an API key cannot ask (403 OWNER_ONLY)', d2.status === 403 && d2.body.code === 'OWNER_ONLY', d2.text);
    const d3 = await ask(asStaff(F), { childHandle: B.handle, type: 'commercial' });
    ok('d3 the gate holds for every type, not only agency (commercial by staff: 403)', d3.status === 403, d3.text);
    const open = (await query(`SELECT count(*)::int AS n FROM cb_edge WHERE parent_id = $1 AND child_id = $2 AND state = 'requested'`, [F.node.id, B.node.id])).rows[0].n;
    ok('d4 the refused asks wrote no edge', open === 0, String(open));

    // (e) approval alone gives no look; (f) a grant opens it
    const e1 = await lookAs(F, A);
    ok('e1 approval alone: the firm has no look (no_grant)', e1 && e1.allowed === false && e1.outcome === 'no_grant', JSON.stringify(e1).slice(0, 200));
    const given = await grants.give(A.id, A.id, { grantee: F.id, purpose: 'audit of the books', consent: true }).catch((e) => e);
    const f1 = await lookAs(F, A);
    ok('f1 after the owner\'s grant the look is allowed', given && given.grant_id && f1 && f1.allowed === true, JSON.stringify(f1).slice(0, 200));

    // (g) the client disconnects: the next look is edge_off
    const g1 = await call('POST', '/api/network/connections/' + a1.body.id + '/disconnect', asOwner(A), {});
    ok('g1 the client owner removes the firm: disconnected', g1.status === 200 && g1.body.state === 'disconnected', g1.text);
    const g2 = await lookAs(F, A);
    ok('g2 the next look reads edge_off (nothing cached)', g2 && g2.allowed === false && g2.outcome === 'edge_off', JSON.stringify(g2).slice(0, 200));

    // (h) client B never sees client C or A through the firm; a governance member still sees siblings
    await grants.give(B.id, B.id, { grantee: F.id, purpose: 'audit of the books', consent: true }).catch(() => null);
    const stores = async (who) => (((await call('GET', '/api/network-design/stores', asOwner(who))).body.stores) || []).map((s) => s.entity_id);
    const sb = await stores(B);
    ok('h1 client B lists no other client of the firm', !sb.includes(A.id) && !sb.includes(C.id) && !sb.includes(F.id) || sb.length === 0, sb.join(','));
    const N = await business('n'), X = await business('x'), Y = await business('y');
    for (const m of [X, Y]) { const r = await ask(asOwner(N), { childHandle: m.handle, type: 'governance' }); await approve(asOwner(m), r.body.id); }
    const sx = await stores(X);
    ok('h2 positive control: a governance member still sees its sibling', sx.includes(Y.id) && sx.includes(N.id), sx.join(','));

    // (i) the audit rows
    const ea = await eventsBound(A.id);
    const acts = ea.map((r) => r.action);
    ok('i1 A\'s trail: asked, approved, ended in order', JSON.stringify(acts) === JSON.stringify(['agency_asked', 'agency_approved', 'agency_ended']), JSON.stringify(acts));
    ok('i2 the ask row names the actor (the firm), the firm as subject and an empty before', ea[0] && ea[0].changed_by === F.id && ea[0].subject_identity_id === F.id && ea[0].before_value === null && ea[0].after_value.state === 'requested', JSON.stringify(ea[0]));
    ok('i3 the approve and end rows name the client as the actor and carry before and after', ea[1] && ea[1].changed_by === A.id && ea[1].before_value.state === 'requested' && ea[1].after_value.state === 'active' && ea[2].changed_by === A.id && ea[2].before_value.state === 'connected' && ea[2].after_value.state === 'disconnected', JSON.stringify(ea));
    const eb = await eventsBound(B.id);
    ok('i4 B asked the firm: asked (changed_by B), approved (changed_by F)', eb.length === 2 && eb[0].changed_by === B.id && eb[1].changed_by === F.id, JSON.stringify(eb));
    const none = await eventsBound(X.id);
    ok('i5 a governance edge writes no agency row', none.length === 0, JSON.stringify(none));
    ok('i6 no audit row was lost on the way', accessEvents.lostCount() === lostBefore, accessEvents.lostCount() + ' vs ' + lostBefore);

    // (i) with b882 absent the ask still succeeds
    if (process.env.FIRMDOOR_ADMIN_URL) {
      const { Client } = require(path.join(API, 'node_modules', 'pg'));
      const admin = new Client({ connectionString: process.env.FIRMDOOR_ADMIN_URL }); await admin.connect();
      await admin.query("DELETE FROM access_events WHERE action LIKE 'agency\_%'"); /* the old check refuses them: as the roll-back says, delete first */
      await admin.query(B866_CHECK);
      const D = await business('d');
      const lost0 = accessEvents.lostCount();
      const r = await ask(asOwner(F), { childHandle: D.handle, type: 'agency' });
      ok('i7 with b882 absent the ask still succeeds', r.status < 300 && r.body.state === 'requested', r.text);
      ok('i8 and the lost row is counted, not silent', accessEvents.lostCount() === lost0 + 1, accessEvents.lostCount() + ' vs ' + lost0);
      ok('i9 and no row was written', (await eventsBound(D.id)).length === 0);
      await admin.query(B882.replace(/^[\s\S]*?\nBEGIN;/, 'BEGIN;'));
      await admin.end();
      const r2 = await call('POST', '/api/network/connections/' + r.body.id + '/decline', asOwner(D), {});
      ok('i10 after b882 runs the next step is recorded (decline)', r2.status === 200 && (await eventsBound(D.id)).map((x) => x.action).join() === 'agency_declined', JSON.stringify(await eventsBound(D.id)));
    } else console.log('  note  FIRMDOOR_ADMIN_URL not set: the b882-absent case (i7-i10) is skipped');

    // (j) a stranger gets the same 404 on another party's edge as on a missing one
    const stranger = await business('s');
    const j1 = await approve(asOwner(stranger), b1.body.id);
    const j2 = await approve(asOwner(stranger), '00000000-0000-4000-8000-000000000000');
    ok('j1 a stranger on an existing edge and on a missing id get the same 404', j1.status === 404 && j2.status === 404 && j1.body.code === j2.body.code && j1.body.detail === j2.body.detail, j1.text + ' | ' + j2.text);

    // enumeration: unknown handle, and a non-party ask, answer alike
    const k1 = await ask(asOwner(F), { childHandle: 'nobody-' + RUN, type: 'agency' });
    const k2 = await ask(asOwner(stranger), { parentHandle: A.handle, childHandle: B.handle, type: 'agency' });
    const k3 = await ask(asOwner(stranger), { parentHandle: 'nobody-' + RUN, childHandle: 'nobody2-' + RUN, type: 'agency' });
    ok('k1 an unknown handle answers 404 CHILD_NOT_FOUND', k1.status === 404 && k1.body.code === 'CHILD_NOT_FOUND', k1.text);
    ok('k2 a non-party ask over two real businesses answers the same 404 CHILD_NOT_FOUND (not 403)', k2.status === 404 && k2.body.code === 'CHILD_NOT_FOUND' && k2.body.detail === k1.body.detail, k2.text);
    ok('k3 two unknown handles also answer 404 (no word tells a real business from an unknown one)', k3.status === 404 && /NOT_FOUND/.test(k3.body.code || ''), k3.text);
    const refused = (await query(`SELECT count(*)::int AS n FROM cb_edge WHERE requested_by = $1`, [stranger.node.id])).rows[0].n;
    ok('k4 the refused asks wrote no edge', refused === 0, String(refused));

    // the open-ask cap (5): the sixth open ask is refused in words
    const G = await business('g'); const fresh = [];
    for (let i = 0; i < 6; i++) fresh.push(await business('p'));
    const out = [];
    for (const f of fresh) out.push(await ask(asOwner(G), { childHandle: f.handle, type: 'agency' }));
    ok('l1 five asks wait, the sixth is 409 AGENCY_ASKS_WAITING', out.slice(0, 5).every((r) => r.status < 300) && out[5].status === 409 && out[5].body.code === 'AGENCY_ASKS_WAITING', out.map((r) => r.status).join());
    const l2 = await call('POST', '/api/network/connections/' + out[0].body.id + '/decline', asOwner(fresh[0]), {});
    const l3 = await ask(asOwner(G), { childHandle: fresh[5].handle, type: 'agency' });
    ok('l2 one answered ask frees one place: the sixth goes through', l2.status === 200 && l3.status < 300, l3.text);

    // (k) 150 clients on one firm, each asked, approved and given
    const P = await business('p150'); const t0 = Date.now(); let asked = 0, approved = 0, given150 = 0;
    for (let i = 0; i < 150; i++) {
      const client = await business('k');
      const r = await ask(asOwner(P), { childHandle: client.handle, type: 'agency' });
      if (r.status < 300) asked++;
      const ap = await approve(asOwner(client), r.body.id);
      if (ap.status === 200) approved++;
      const gr = await grants.give(client.id, client.id, { grantee: P.id, purpose: 'audit of the books', consent: true }).catch((e) => e);
      if (gr && gr.grant_id) given150++;
    }
    ok('m1 150 asks, 150 approvals, 150 grants (open asks never pile up under the cap of 5)', asked === 150 && approved === 150 && given150 === 150, asked + '/' + approved + '/' + given150);
    const practice = await practiceOf(P.id, { roles: [grants.AUDITOR], actor: P.id, query: {} });
    ok('m2 the firm\'s practice lists 150 clients', practice.total === 150, 'total ' + practice.total);
    console.log('  note  150-client onboarding took ' + Math.round((Date.now() - t0) / 1000) + ' s');

    // the named limiter: the window holds 400 asks per caller bucket; spend the rest, the next is 429 RATE_LIMITED
    let limited = null;
    for (let i = 0; i < 400 && !limited; i++) { const r = await ask(asOwner(stranger), { childHandle: 'nobody-' + RUN, type: 'agency' }); if (r.status === 429) limited = r; }
    ok('n1 the ask limiter answers 429 RATE_LIMITED with the wait in seconds once the window is spent', limited && limited.body.code === 'RATE_LIMITED' && limited.body.params && limited.body.params.retry_after_seconds >= 1, limited && limited.text);
  } finally { server.close(); }
}

(async () => {
  console.log('\n── firm-parent door, real Postgres · run ' + RUN + (process.env.FIRMDOOR_ROUTES ? ' · ROUTES ' + process.env.FIRMDOOR_ROUTES : '') + ' ──');
  try { await main(); } catch (e) { ok('the run reached its end', false, e && e.stack); }
  console.log('\n' + pass + ' ok, ' + fail + ' failed  (throwaway database: the rows are left for the box to drop)');
  process.exit(fail ? 1 : 0);
})();
