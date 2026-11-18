'use strict';
const { shopToday, shopDayAt } = require('./lib/shop-day.cjs'); /* the shop's own day, never the UTC day (tzsweep) */
/**
 * tests/acc-176b-adviser-realauth.realstack.cjs — ACC-176b on a REAL Postgres through the REAL sign-in: middleware/auth is NOT replaced here (the other realstack file stands in for it). Every call carries a signed token
 * (HS256, the api's own secret); the real auth re-reads the person's row on every request, re-enters on the identity the grant front swapped in, and runs the hat gate over it.
 *   1 the owner (entity token) switches the ledger on and gives the firm an ADVISER grant.   2 A (an actor of the firm) prepares through the real auth: 201.   3 A reviewing own entry: 403.   4 B reviews: 200, stamped B.
 *   5 the firm's token on the owner's accept: 403 (no grant reaches it).   6 the owner accepts through his own token: posted once, created_by A.   7 a person removed from the firm: 401 at once (the real revocation check).
 *   8 a token of a stranger business naming the store: refused.   9 no token: 401.
 * Run: DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 node tests/acc-176b-adviser-realauth.realstack.cjs   (CI: the integration job)
 * CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'acc176b_realauth_secret_at_least_32_chars_padding';
const path = require('path');
const express = require('express');
const jsonWebToken = require('jsonwebtoken');
const API = path.join(__dirname, '..');
const net = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 500) : '')); } };
const RUN = 'a176r' + (Date.now() % 1e10).toString(36).padStart(6, '0');
const madeIdentities = [];
const code = (r) => r.body && r.body.code;

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(
    `INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`,
    [bridgeId, 'ACC176r ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  madeIdentities.push(identity.identity_id);
  return { tag, bridgeId, id: identity.identity_id, name: identity.display_name, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
async function join(parent, member) {
  const asked = await net.requestConnect({ parentId: parent.node.id, childId: member.node.id }, parent.node);
  await net.approve({ edgeId: asked.id }, member.node);
}
const tokenFor = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const ownerToken = (biz) => tokenFor({ identity_id: biz.id, identity_type: 'entity', bridge_id: biz.bridgeId, display_name: biz.name });
async function person(biz, tag) {
  const { rows: [row] } = await query(
    `INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, 'editor', true, true, 'act') RETURNING identity_id, display_name`,
    [biz.bridgeId + tag, 'Person ' + tag + ' ' + RUN, biz.id, (biz.bridgeId + tag).toLowerCase()]);
  madeIdentities.push(row.identity_id);
  return { id: row.identity_id, name: row.display_name, token: tokenFor({ identity_id: row.identity_id, identity_type: 'actor', bridge_id: biz.bridgeId, display_name: row.display_name, parent_entity_id: biz.id }) };
}

let base = '';
async function call(token, method, route, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (o.member) headers['x-books-for'] = o.member;
  if (o.role) headers['x-books-role'] = o.role;
  if (/\/accept$/.test(route)) headers['idempotency-key'] = 'acc176b-' + Math.random().toString(36).slice(2) + Date.now(); /* S36: each accept is its own attempt */
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}

async function main() {
  const P = await business('p'); const M1 = await business('1'); const S = await business('s');
  await join(P, M1);
  const A = await person(P, 'a'); const B = await person(P, 'b'); const Z = await person(S, 'z');
  const app = express();
  app.use(express.json());
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  app.use('/api/books-actions', require(path.join(API, 'routes', 'books-actions.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    const owner = ownerToken(M1);
    await withEntity(M1.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, M1.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, M1.id));
    const enabled = await call(owner, 'POST', '/api/books/enable', { body: {} });
    const given = await call(owner, 'POST', '/api/books-grants', { body: { grantee: P.id, preset: 'adviser', posting: 'owner_approves', purpose: 'adviser of the books', consent: true } });
    ok('1 the owner (a real token) switches the ledger on and gives the firm an ADVISER grant', enabled.status === 200 && given.status === 201 && given.body.preset === 'adviser', JSON.stringify([enabled.status, given]));
    const accounts = (await call(owner, 'GET', '/api/books/accounts')).body;
    const list = accounts.accounts || accounts.rows || accounts || [];
    const cash = (list.find((a) => /cash/i.test(a.name || '')) || {}).code || '1000';
    const sales = (list.find((a) => /^sales/i.test(a.name || '')) || {}).code || '4000';
    const day = shopToday();
    const prepare = { store_id: M1.id, kind: 'journal', client_ref: RUN + 'j1', body: { narration: 'acc176b real auth ' + RUN, date: day, lines: [{ code: cash, dr_minor: 10000 }, { code: sales, cr_minor: 10000 }] } };
    const asFirm = (who, method, route, body) => call(who.token, method, '/api/books-actions' + route, { member: M1.id, role: 'adviser', body });

    const nobody = await call(null, 'GET', '/api/books-actions', { member: M1.id, role: 'adviser' });
    ok('9 no token: 401 from the real sign-in', nobody.status === 401, JSON.stringify(nobody));
    const prepared = await asFirm(A, 'POST', '', prepare);
    ok('2 A prepares through the real auth and the real hat gate: 201, stamped with A and the firm', prepared.status === 201 && prepared.body.prepared.identity_id === A.id && prepared.body.prepared.firm === P.name && prepared.body.total_minor === 10000, JSON.stringify(prepared));
    const id = prepared.body.action_id; const hash = prepared.body.body_hash;
    const self = await asFirm(A, 'POST', '/' + id + '/review', { store_id: M1.id, body_hash: hash });
    ok('3 A reviewing own entry: 403 ACTION_SELF_REVIEW', self.status === 403 && code(self) === 'ACTION_SELF_REVIEW', JSON.stringify(self));
    const reviewed = await asFirm(B, 'POST', '/' + id + '/review', { store_id: M1.id, body_hash: hash });
    ok('4 B reviews: 200, stamped with B, the firm and the checker role', reviewed.status === 200 && reviewed.body.reviewed.identity_id === B.id && reviewed.body.reviewed.role === 'checker', JSON.stringify(reviewed));
    const firmAccept = await call(A.token, 'POST', '/api/books-actions/' + id + '/accept', { member: M1.id, role: 'adviser', body: { store_id: M1.id, body_hash: hash, total_minor: 10000, currency: 'INR' } });
    const bareAccept = await call(B.token, 'POST', '/api/books-actions/' + id + '/accept', { body: { store_id: M1.id, body_hash: hash, total_minor: 10000, currency: 'INR' } });
    ok('5 a firm token cannot accept: 403 with the header (no door), 403 without it (it is not the store\'s owner)', firmAccept.status === 403 && bareAccept.status === 403, JSON.stringify([firmAccept.status, code(firmAccept), bareAccept.status, code(bareAccept)]));
    const accepted = await call(owner, 'POST', '/api/books-actions/' + id + '/accept', { body: { store_id: M1.id, body_hash: hash, total_minor: 10000, currency: 'INR' } });
    const entry = (await withEntity(M1.id, (h) => h.query('SELECT created_by, source_ref FROM journal_entry WHERE entity_id = $1 AND entry_id = $2', [M1.id, accepted.body.entry && accepted.body.entry.entry_id]))).rows[0] || {};
    ok('6 the owner accepts through his own token: posted once, created_by A, linked by source_ref', accepted.status === 200 && entry.created_by === A.id && entry.source_ref === 'action:' + id, JSON.stringify([accepted.status, entry]));
    const stranger = await call(Z.token, 'GET', '/api/books-actions', { member: M1.id, role: 'adviser' });
    ok('8 a person of a stranger business naming the store: refused (no grant of his business)', stranger.status === 403 && code(stranger) === 'BOOKS_GRANT_NONE', JSON.stringify(stranger));
    await query("UPDATE identities SET break_status = 'removed' WHERE identity_id = $1", [B.id]);
    const gone = await asFirm(B, 'GET', '');
    ok('7 a person removed from the firm is refused at once by the real revocation check (401)', gone.status === 401, JSON.stringify(gone));
  } finally {
    server.close();
  }
}

async function cleanup() {
  const nodes = (await query(`SELECT e.id FROM cb_entity e JOIN identities i ON upper(i.bridge_id) = upper(e.bridge_id) WHERE i.identity_id = ANY($1::uuid[])`, [madeIdentities])).rows.map((x) => x.id);
  await query(`DELETE FROM cb_edge WHERE parent_id = ANY($1::uuid[]) OR child_id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM cb_entity WHERE id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM identities WHERE identity_id = ANY($1::uuid[])`, [madeIdentities]);
}
(async () => {
  console.log('\n── ACC-176b adviser maker-checker through the REAL sign-in (cb_app, RLS on) · run ' + RUN + ' ──');
  try { await main(); } catch (e) { ok('the run reached its end', false, e && e.stack); } finally { await cleanup().catch((e) => console.log('  note  the throwaway businesses stay (insert-only rows keep them): ' + (e && e.code))); }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
