'use strict';
const { shopToday } = require('./lib/shop-day.cjs'); /* the shop's own day, never the UTC day (tzsweep) */
/**
 * tests/grant-seat.realstack.cjs — GRANT-SEAT (Athi 20 Nov, live walk): the client's GRANT is the ceiling, the staff member's SEAT narrows within it (lib/delegation.js mayDo; middleware/books-grant). REAL Postgres, REAL sign-in (signed tokens).
 *   adviser grant (firm F1, "Accountant"):  accountant seat reads + prepares + reviews · reviewer seat reads + reviews, prepare and bank are COMMENT_ONLY · reports seat reads the TB, P&L and BS only · view-only and counter seats: no books
 *   auditor grant (firm F2, "Auditor"):     accountant and reviewer seats read, nobody writes, the reviewer and the accountant may set a mark (review note) · reports seat reads the three reports only
 *   books only: a firm token naming the client (X-Books-For) on catalogue, price, people, settings, till, orders and parties is refused because those paths are not an area the grant reaches; nothing was written for the client
 * No X-Books-Role header is sent: the role is the client's live grant (lib/books-grant liveRoleOf). Run: DATABASE_URL=postgres://cb_app:...@<sit host>:5432/... node tests/grant-seat.realstack.cjs   (SIT only)
 * CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'grantseat_realauth_secret_at_least_32_chars_padding';
const path = require('path');
const express = require('express');
const jsonWebToken = require('jsonwebtoken');
const API = path.join(__dirname, '..');
const net = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 500) : '')); } };
const RUN = 'gs' + (Date.now() % 1e10).toString(36).padStart(6, '0');
const code = (r) => r.body && r.body.code;
const brief = (r) => r.status + ' ' + (code(r) || '');

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'GrantSeat ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  return { tag, bridgeId, id: identity.identity_id, name: identity.display_name, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
async function join(parent, member) {
  const asked = await net.requestConnect({ parentId: parent.node.id, childId: member.node.id }, parent.node);
  await net.approve({ edgeId: asked.id }, member.node);
}
const tokenFor = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const ownerToken = (biz) => tokenFor({ identity_id: biz.id, identity_type: 'entity', bridge_id: biz.bridgeId, display_name: biz.name });
/** a firm person with the seat's three facts (level, reach, cost sight): the same facts lib/access PRACTICE_PRESETS / PRESETS name */
async function person(biz, tag, level, whole, costs) {
  const { rows: [row] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, $6, $7, 'act') RETURNING identity_id, display_name`, [biz.bridgeId + tag, 'Person ' + tag + ' ' + RUN, biz.id, (biz.bridgeId + tag).toLowerCase(), level, whole, costs]);
  return { id: row.identity_id, name: row.display_name, token: tokenFor({ identity_id: row.identity_id, identity_type: 'actor', bridge_id: biz.bridgeId, display_name: row.display_name, parent_entity_id: biz.id }) };
}
let base = '';
async function call(token, method, route, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (o.member) headers['x-books-for'] = o.member;
  if (o.role) headers['x-books-role'] = o.role;
  if (/\/accept$/.test(route)) headers['idempotency-key'] = 'gs-' + Math.random().toString(36).slice(2) + Date.now();
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}

async function main() {
  const F1 = await business('f1'); const F2 = await business('f2'); const M = await business('m1'); const M2 = await business('m2'); /* a store has ONE parent in the tree: F1's client and F2's client */
  await join(F1, M); await join(F2, M2);
  const seats = async (biz, tag) => ({
    acc: await person(biz, tag + 'a', 'editor', true, true), rev: await person(biz, tag + 'r', 'commenter', true, true), rep: await person(biz, tag + 'p', 'commenter', true, false),
    reg: await person(biz, tag + 'g', 'editor', true, true) /* Regional manager: the same three facts as the accountant */, view: await person(biz, tag + 'v', 'viewer', false, false), ctr: await person(biz, tag + 'c', 'editor', false, false)
  });
  const S1 = await seats(F1, '1'); const S2 = await seats(F2, '2');
  Object.values(S1).forEach((p) => { p.client = M.id; }); Object.values(S2).forEach((p) => { p.client = M2.id; });
  const app = express();
  app.use(express.json());
  app.use(require(path.join(API, 'middleware', 'books-grant')).refuseElsewhere);
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  app.use('/api/books-actions', require(path.join(API, 'routes', 'books-actions.js')));
  app.use('/api/marks', require(path.join(API, 'routes', 'marks.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    const owner = ownerToken(M); const owner2 = ownerToken(M2);
    for (const client of [M, M2]) await withEntity(client.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, client.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, client.id));
    const enabled = await call(owner, 'POST', '/api/books/enable', { body: {} });
    const enabled2 = await call(owner2, 'POST', '/api/books/enable', { body: {} });
    const adv = await call(owner, 'POST', '/api/books-grants', { body: { grantee: F1.id, preset: 'adviser', posting: 'owner_approves', purpose: 'accountant of the books', consent: true } });
    const aud = await call(owner2, 'POST', '/api/books-grants', { body: { grantee: F2.id, preset: 'auditor', purpose: 'auditor of the books', consent: true } });
    ok('0 the owner switches the ledger on and gives F1 an Accountant (adviser) grant and F2 an Auditor grant', enabled.status === 200 && enabled2.status === 200 && adv.status === 201 && aud.status === 201, JSON.stringify([enabled.status, adv, aud]));
    const accounts = (await call(owner, 'GET', '/api/books/accounts')).body;
    const list = accounts.accounts || accounts.rows || accounts || [];
    const cash = (list.find((a) => /cash/i.test(a.name || '')) || {}).code || '1000';
    const sales = (list.find((a) => /^sales/i.test(a.name || '')) || {}).code || '4000';
    const day = shopToday();
    const prepare = (ref) => ({ store_id: M.id, kind: 'journal', client_ref: RUN + ref, body: { narration: 'grant seat ' + RUN + ref, date: day, lines: [{ code: cash, dr_minor: 10000 }, { code: sales, cr_minor: 10000 }] } });
    const as = (who, method, route, body) => call(who.token, method, route, { member: who.client || M.id, body });
    const TB = '/api/books/trial-balance?from=2026-04-01&to=2027-03-31';
    const reads = async (who) => ({ tb: await as(who, 'GET', TB), pl: await as(who, 'GET', '/api/books/pl?from=2026-04-01&to=2027-03-31'), bs: await as(who, 'GET', '/api/books/bs?as_of=2027-03-31'), day: await as(who, 'GET', '/api/books/daybook'), open: await as(who, 'GET', '/api/books/accounts') });
    const allRead = (r) => [r.tb, r.pl, r.bs, r.day, r.open].every((x) => x.status === 200);
    const shown = (r) => JSON.stringify(Object.entries(r).map(([k, v]) => k + ':' + brief(v)));

    /* ---- ADVISER GRANT (F1) ---- */
    for (const [name, who] of [['accountant', S1.acc], ['regional (same facts as the accountant)', S1.reg], ['reviewer', S1.rev]]) {
      const r = await reads(who);
      ok('A1 adviser grant · ' + name + ' seat reads the books and the TB, P&L, BS (no role header)', allRead(r), shown(r));
    }
    const prepared = await as(S1.acc, 'POST', '/api/books-actions', prepare('j1'));
    ok('A2 adviser grant · accountant seat prepares a post: 201', prepared.status === 201, JSON.stringify(prepared));
    const regPrep = await as(S1.reg, 'POST', '/api/books-actions', prepare('j1reg'));
    ok('A2b adviser grant · regional seat (accountant facts) prepares: 201', regPrep.status === 201, JSON.stringify(regPrep));
    const revPrep = await as(S1.rev, 'POST', '/api/books-actions', prepare('j1rev'));
    ok('A3 adviser grant · reviewer seat cannot prepare a post: 403 COMMENT_ONLY', revPrep.status === 403 && code(revPrep) === 'COMMENT_ONLY', brief(revPrep));
    const revBank = await as(S1.rev, 'POST', '/api/books/bank/marks', { marks: [] });
    ok('A4 adviser grant · reviewer seat cannot write at the bank: 403 COMMENT_ONLY', revBank.status === 403 && code(revBank) === 'COMMENT_ONLY', brief(revBank));
    const revRev = await as(S1.rev, 'POST', '/api/books-actions/' + prepared.body.action_id + '/review', { store_id: M.id, body_hash: prepared.body.body_hash });
    ok('A5 adviser grant · reviewer seat reviews the accountant prepared post: 200 (review note)', revRev.status === 200, JSON.stringify(revRev));
    const repOwn = await reads(S1.rep);
    ok('A6 adviser grant · reports seat reads TB, P&L, BS', [repOwn.tb, repOwn.pl, repOwn.bs].every((x) => x.status === 200), shown(repOwn));
    ok('A7 adviser grant · reports seat does not read the day book or the accounts: 403 BOOKS_GRANT_NOT_FOR_YOU', [repOwn.day, repOwn.open].every((x) => x.status === 403 && code(x) === 'BOOKS_GRANT_NOT_FOR_YOU'), shown(repOwn));
    const repPrep = await as(S1.rep, 'POST', '/api/books-actions', prepare('j1rep'));
    const repQueue = await as(S1.rep, 'GET', '/api/books-actions');
    ok('A8 adviser grant · reports seat: no prepare, no review queue: 403', repPrep.status === 403 && repQueue.status === 403, JSON.stringify([brief(repPrep), brief(repQueue)]));
    for (const [name, who] of [['view-only', S1.view], ['counter', S1.ctr]]) {
      const r = await as(who, 'GET', TB);
      ok('A9 adviser grant · ' + name + ' seat: no books, 403 BOOKS_GRANT_NOT_FOR_YOU', r.status === 403 && code(r) === 'BOOKS_GRANT_NOT_FOR_YOU', brief(r));
    }
    const accepted = await call(owner, 'POST', '/api/books-actions/' + prepared.body.action_id + '/accept', { body: { store_id: M.id, body_hash: prepared.body.body_hash, total_minor: 10000, currency: 'INR' } });
    ok('A10 the owner accepts the prepared post (nothing else is left open)', accepted.status === 200, JSON.stringify(accepted));

    /* ---- AUDITOR GRANT (F2) ---- */
    for (const [name, who] of [['accountant', S2.acc], ['regional', S2.reg], ['reviewer', S2.rev]]) {
      const r = await reads(who);
      ok('B1 auditor grant · ' + name + ' seat reads the books and reports (no role header: the live grant is the auditor one)', allRead(r), shown(r));
    }
    for (const [name, who] of [['accountant', S2.acc], ['reviewer', S2.rev]]) {
      const w = await as(who, 'POST', '/api/books-actions', Object.assign(prepare('b2' + name), { store_id: M2.id }));
      const bank = await as(who, 'POST', '/api/books/bank/marks', { marks: [] });
      ok('B2 auditor grant · ' + name + ' seat writes nothing (post, bank): 403', w.status === 403 && bank.status === 403, JSON.stringify([brief(w), brief(bank)]));
    }
    const entry2 = (await call(owner2, 'POST', '/api/books/entries', { body: { narration: 'grant seat ' + RUN, date: day, client_ref: RUN + 'e2', lines: [{ code: cash, dr_minor: 10000 }, { code: sales, cr_minor: 10000 }] } })).body;
    const entryId2 = entry2 && (entry2.entry_id || (entry2.entry && entry2.entry.entry_id));
    ok('B2b the auditor client owner posts one entry (the entry the notes below are set on)', !!entryId2, JSON.stringify(entry2));
    for (const [name, who] of [['reviewer', S2.rev], ['accountant', S2.acc]]) {
      const note = await as(who, 'POST', '/api/marks', { adopter: 'acc.audit', subject_id: entryId2, kind: 'query', note: 'Which bank took this cash? ' + name });
      ok('B3 auditor grant · ' + name + ' seat sets a review note (a mark): 201', note.status === 201, JSON.stringify(note));
    }
    const repA = await reads(S2.rep);
    ok('B4 auditor grant · reports seat reads TB, P&L, BS only', [repA.tb, repA.pl, repA.bs].every((x) => x.status === 200) && [repA.day, repA.open].every((x) => x.status === 403), shown(repA));
    const repNoteA = await as(S2.rep, 'POST', '/api/marks', { adopter: 'acc.audit', subject_id: entryId2, kind: 'query', note: 'reports seat must not' });
    ok('B5 auditor grant · reports seat sets no review note: 403 BOOKS_GRANT_NOT_FOR_YOU', repNoteA.status === 403 && code(repNoteA) === 'BOOKS_GRANT_NOT_FOR_YOU', brief(repNoteA));
    const noSeatA = await as(S2.ctr, 'GET', TB);
    ok('B6 auditor grant · counter seat: no books', noSeatA.status === 403 && code(noSeatA) === 'BOOKS_GRANT_NOT_FOR_YOU', brief(noSeatA));

    /* ---- UNCHANGED: a firm with no grant on the client ---- */
    const stranger = await business('s'); const Z = await person(stranger, 'z', 'editor', true, true);
    const none = await as(Z, 'GET', TB);
    ok('C1 a firm with no grant on the client: 403 BOOKS_GRANT_NONE (unchanged)', none.status === 403 && code(none) === 'BOOKS_GRANT_NONE', brief(none));

    /* ---- BOOKS ONLY: the areas of a firm grant are ['books'] (lib/delegation GRANT_CEILING); any other path is refused, nothing done ---- */
    const before = (await query('SELECT count(*)::int AS n FROM identities WHERE parent_entity_id = $1', [M.id])).rows[0].n;
    const probes = [
      ['POST', '/api/catalogue/items', { name: 'x' }], ['PUT', '/api/catalogue/items/price', { price: 1 }], ['POST', '/api/actors', { name: 'x', access_level: 'editor' }],
      ['PUT', '/api/entities/me/policy', { policy: {} }], ['POST', '/api/till/sale', {}], ['POST', '/api/orders', {}], ['POST', '/api/parties', { name: 'x' }]
    ];
    for (const who of [S1.acc, S2.acc, S1.rev]) {
      const refused = [];
      for (const [method, route, body] of probes) { const r = await as(who, method, route, body); refused.push(r.status === 403 && code(r) === 'BOOKS_FOR_NOT_HERE'); }
      ok('D1 books only · a firm token naming the client is refused on catalogue write, price, people add, settings/policy, till/sale, orders, parties', refused.every(Boolean), JSON.stringify(refused));
    }
    const after = (await query('SELECT count(*)::int AS n FROM identities WHERE parent_entity_id = $1', [M.id])).rows[0].n;
    ok('D2 books only · nothing was added to the client (people count unchanged)', before === after, before + ' -> ' + after);
  } finally {
    server.close();
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((err) => { console.error(err); process.exit(1); });
