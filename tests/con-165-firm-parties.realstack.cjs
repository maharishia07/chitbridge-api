'use strict';
/**
 * tests/con-165-firm-parties.realstack.cjs — CON-165 (Athi 27 Nov) on a REAL Postgres as cb_app, RLS on: a firm seat with a live books grant READS the client's parties through the REAL grant look
 * (lib/books-grant.look) and the REAL routes/crm.js + routes/relationships.js, and gets 403 on every write.
 * Only the sign-in is a stand-in (a header names who calls), as in acc-176-books-grant.realstack.cjs.
 * HAND-COMPUTED  parent P (the firm) approved under member M1; M1 holds 2 local customers (Alpha Stores phone +61400111222, Beta Traders no phone); M2 holds 1 (Gamma); M1 gives P the grant.
 *   1 no grant: 403 BOOKS_GRANT_NONE.   2 granted accountant seat: list = 2 parties, no phone anywhere in the answer, walk_ins [].   3 ?q=alpha finds 1; ?q=61400111222 finds 0 (no phone oracle); ?q=zzz finds 0.
 *   4 one record: 200 cut; Gamma's id under M1's grant is 404; 5 the relationships list of customers: 2 rows, no phone, no e-mail.
 *   6 writes (POST interactions, DELETE party, POST leads, POST relationships/customers, PATCH relationships/customers/:id, POST segments send): all 403, M1 still holds 2 customers and no interaction.
 *   7 a reports-only seat 403; an unlisted GET (timeline, marketing) 403 BOOKS_FOR_NOT_HERE; 8 the look left one log row per allowed read.
 * Run: DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 node tests/con-165-firm-parties.realstack.cjs   (CI: the integration job)
 * CARD      11-crm-and-marketing/crm-parties
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'con165_test_secret_at_least_32_chars_padding';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const API = path.join(__dirname, '..');

const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const fakeAuth = (req, res, next) => {
  if (req.identity) return next();
  try { req.identity = JSON.parse(String(req.headers['x-test-as'] || '')); } catch (_) { return res.status(401).json({ error: 'no test identity' }); }
  return next();
};
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const net = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));
const grants = require(path.join(API, 'lib', 'books-grant.js'));
const booksGrant = require(path.join(API, 'middleware', 'books-grant.js'));
const ident = require(path.join(API, 'lib', 'local-identity.js'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 400) : '')); } };
const RUN = 'c165' + (Date.now() % 1e10).toString(36).padStart(6, '0');
const madeIdentities = [];
const ownedBy = [];

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(
    `INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'AU', 'AUD', $3) RETURNING identity_id`,
    [bridgeId, 'CON165 ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  madeIdentities.push(identity.identity_id);
  return { tag, bridgeId, id: identity.identity_id, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
async function join(parent, member) {
  const asked = await net.requestConnect({ parentId: parent.node.id, childId: member.node.id }, parent.node);
  await net.approve({ edgeId: asked.id }, member.node);
}
const ownerOf = (biz) => ({ identity_id: biz.id, bridge_id: biz.bridgeId, identity_type: 'entity', parent_entity_id: null, display_name: biz.tag });
const staffOf = (biz, extra) => Object.assign({ identity_id: crypto.randomUUID(), identity_type: 'actor', parent_entity_id: biz.id, bridge_id: biz.bridgeId, access_level: 'editor', whole_entity: true, can_see_costs: true }, extra || {});
const REPORTS = { access_level: 'commenter', whole_entity: true, can_see_costs: false };
async function addCustomer(M, name, phone) {
  const added = await withEntity(M.id, (h) => ident.addCustomer(h, M.id, { name, phone: phone || '', gstin: '', via: 'manual' }));
  if (!added || added.refused || !added.local) throw new Error('seed customer refused: ' + JSON.stringify(added));
  ownedBy.push(M.id);
  return added.local.identity_id;
}
const customerCount = (M) => withEntity(M.id, (h) => h.query('SELECT count(*)::int AS n FROM customer_list WHERE owner_entity_id = $1', [M.id])).then((r) => r.rows[0].n);
const interactionCount = (M) => withEntity(M.id, (h) => h.query('SELECT count(*)::int AS n FROM party_interaction WHERE owner_entity_id = $1', [M.id])).then((r) => r.rows[0].n).catch(() => 0);

let base = '';
async function call(who, method, route, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json', 'x-test-as': JSON.stringify(who) };
  if (o.member) headers['x-books-for'] = o.member;
  if (o.role) headers['x-books-role'] = o.role;
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}
const code = (r) => r.body && r.body.code;
const text = (r) => JSON.stringify(r.body || {});

async function main() {
  const P = await business('p'), M1 = await business('1'), M2 = await business('2');
  await join(P, M1); await join(P, M2);
  const alpha = await addCustomer(M1, 'Alpha Stores ' + RUN, '+61400111222');
  await addCustomer(M1, 'Beta Traders ' + RUN, '');
  const gamma = await addCustomer(M2, 'Gamma Imports ' + RUN, '+61400999888');

  const app = express();
  app.use(express.json());
  app.use(booksGrant.refuseElsewhere);
  app.use('/api/crm', require(path.join(API, 'routes', 'crm.js')));
  app.use('/api/relationships', require(path.join(API, 'routes', 'relationships.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  const accountant = staffOf(P);
  const via = (who, method, route, opts) => call(who, method, route, Object.assign({ member: M1.id }, opts));
  try {
    let r = await via(accountant, 'GET', '/api/crm/parties');
    ok('1 no grant: 403 BOOKS_GRANT_NONE and no rows', r.status === 403 && code(r) === 'BOOKS_GRANT_NONE' && !(r.body && r.body.parties), text(r));

    const made = await call(ownerOf(M1), 'POST', '/api/books-grants', { body: { grantee: P.id, purpose: 'audit of the books', consent: true } });
    ok('grant given by M1 (201)', made.status === 201, text(made));

    r = await via(accountant, 'GET', '/api/crm/parties');
    const names = ((r.body && r.body.parties) || []).map((p) => p.display_name);
    ok('2 the accountant seat reads M1 parties: 2 rows, both M1', r.status === 200 && names.length === 2 && names.every((n) => /^(Alpha|Beta)/.test(n)), text(r));
    ok('2 no phone, no e-mail key and no Gamma anywhere in the answer; walk_ins is []', !/61400|"phone"|"email"|Gamma/.test(text(r)) && Array.isArray(r.body.walk_ins) && r.body.walk_ins.length === 0, text(r));
    ok('2 the answer says it is paged: total 2, limit 500, next null', r.body.total === 2 && r.body.limit === 500 && r.body.next === null, text(r));
    ok('2 may says write is refused with a sentence', r.body.may && r.body.may.write && r.body.may.write.may === false && !!r.body.may.write.why, text(r.body.may));

    r = await via(accountant, 'GET', '/api/crm/parties?q=alpha');
    ok('3 ?q=alpha finds exactly Alpha', r.status === 200 && r.body.total === 1 && /^Alpha/.test(r.body.parties[0].display_name), text(r));
    r = await via(accountant, 'GET', '/api/crm/parties?q=61400111222');
    ok('3 ?q by phone finds NOTHING under a grant (no oracle)', r.status === 200 && r.body.total === 0, text(r));
    r = await via(accountant, 'GET', '/api/crm/parties?with=consent&view=leads');
    ok('3 with=consent and view=leads are ignored under a grant', r.status === 200 && r.body.total === 2 && !('consent_migrated' in r.body), text(r));

    r = await via(accountant, 'GET', '/api/crm/parties/' + alpha);
    ok('4 one record: 200, the cut row, no contact', r.status === 200 && r.body.party_id === alpha && !/61400|"phone"|"email"|followups|points/.test(text(r)), text(r));
    r = await via(accountant, 'GET', '/api/crm/parties/' + gamma);
    ok("4 another shop's party id under M1's grant is 404, no body of it", r.status === 404 && !/Gamma|61400999888/.test(text(r)), text(r));

    r = await via(accountant, 'GET', '/api/relationships/customers');
    const rel = (r.body && (r.body.customers || r.body.rows)) || [];
    ok('5 the relationships customer list: 2 rows of M1, no phone, no e-mail', r.status === 200 && rel.length === 2 && !/61400|"phone"|"email"|"otp_contact"|Gamma/.test(text(r)), text(r));

    const customersBefore = await customerCount(M1), interactionsBefore = await interactionCount(M1);
    const writes = [
      ['POST', '/api/crm/parties/' + alpha + '/interactions', { kind: 'note', body: 'x' }], ['DELETE', '/api/crm/parties/' + alpha], ['POST', '/api/crm/leads', { name: 'Lead Z' }],
      ['POST', '/api/relationships/customers', { name: 'Planted Customer' }], ['PATCH', '/api/relationships/customers/' + alpha, { nickname: 'x' }], ['POST', '/api/crm/segments/all/send', { text: 'hi' }], ['POST', '/api/crm/followups', { party_id: alpha, what: 'x' }]
    ];
    const answers = [];
    for (const [method, route, body] of writes) answers.push([route, (await via(accountant, method, route, body === undefined ? undefined : { body }))]);
    ok('6 every write answers 403', answers.every(([, x]) => x.status === 403), JSON.stringify(answers.map(([rt, x]) => [rt, x.status, code(x)])));
    ok('6 M1 holds the same customers and interactions after the sweep', (await customerCount(M1)) === customersBefore && (await interactionCount(M1)) === interactionsBefore && customersBefore === 2);

    r = await via(accountant, 'GET', '/api/crm/parties/' + alpha + '/timeline');
    ok('7 the timeline is not open: 403 BOOKS_FOR_NOT_HERE', r.status === 403 && code(r) === 'BOOKS_FOR_NOT_HERE', text(r));
    r = await via(accountant, 'GET', '/api/marketing/came-back');
    ok('7 Marketing stays closed: 403', r.status === 403, text(r));
    r = await via(staffOf(P, REPORTS), 'GET', '/api/crm/parties');
    ok('7 a reports-only seat is refused 403', r.status === 403, text(r));
    r = await via(accountant, 'GET', '/api/crm/parties', { role: 'adviser' });
    ok('7 the adviser role reads the same cut list (no grant for it: refused in words, not 500)', r.status === 200 || r.status === 403, text(r));

    const looks = await grants.looks(M1.id, { limit: 200 });
    ok('8 the look left a log row for the allowed reads (at least 6)', (looks.rows || looks).length >= 6, JSON.stringify(looks).slice(0, 200));
  } finally { server.close(); }
}

async function cleanup() {
  const owners = [...new Set(ownedBy)];
  await query(`DELETE FROM customer_list WHERE owner_entity_id = ANY($1::uuid[])`, [owners]).catch(() => {});
  await query(`DELETE FROM identities WHERE parent_entity_id = ANY($1::uuid[])`, [owners]).catch(() => {});
  const nodes = (await query(`SELECT e.id FROM cb_entity e JOIN identities i ON upper(i.bridge_id) = upper(e.bridge_id) WHERE i.identity_id = ANY($1::uuid[])`, [madeIdentities])).rows.map((x) => x.id);
  await query(`DELETE FROM cb_edge WHERE parent_id = ANY($1::uuid[]) OR child_id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM cb_entity WHERE id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM identities WHERE identity_id = ANY($1::uuid[])`, [madeIdentities]);
}
(async () => {
  console.log('\n── CON-165 firm reads client parties on real Postgres (cb_app, RLS on) · run ' + RUN + ' ──');
  try { await main(); } catch (e) { ok('the run reached its end', false, e && e.stack); } finally { await cleanup().catch((e) => console.log('  note  cleanup: ' + e.message)); }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
