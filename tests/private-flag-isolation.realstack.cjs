'use strict';
const { shopToday, shopDayAt } = require('./lib/shop-day.cjs'); /* the shop's own day, never the UTC day (tzsweep) */
/**
 * tests/private-flag-isolation.realstack.cjs — PRIVATE BOOKMARKS AND NOTES (b876) on a REAL Postgres, as the role the api runs as (cb_app, RLS on), through routes/flags.js. THE ISOLATION PROOF (slice A3).
 * Only the sign-in is a stand-in (a header names who calls; an actor's row is read from identities on every request, as the real auth does). Migrations up to b876 are built by the fresh-db step.
 * Fixture   business B (the books; ledger on, India, INR) and its owner · B's cashier (no books access) · accountant firm F1 (adviser grant on B; person A1) · auditor firm F2 (auditor grant on B; person 1 = U1, person 2 = U2, the firm owner, and a shop-staff login with no seat)
 *           · firm F3 with NO grant (person X) · Y = a person of F1 and F2 with two logins (two identities).
 * HAND-COMPUTED  U1 bookmarks 30 postings in ONE act ("My firm") and writes ONE note ("My firm") = 31 flags, then one "Only me" note = 32 rows.
 *   P1  U2 and the F2 owner read 31 org flags (the "Only me" one is U1's alone: 32 rows, U1 reads 32).   P2  B, F1, F3 read 0, count 0; the differential (day book, marks, the grant reads as F2 and F1) is byte-identical before and after the 31 flags.
 *   P3  at the DATABASE: scoped to B or F1 = 0 rows, F2 = 31 (blank actor) / 32 (U1).   P4 a request carrying X-Books-For: B lands in F2, never in B.   P6 "Only me": U2 and the F2 owner never get it from list, query, counts, an id.
 *   P8  clear-30 + resolve + remove: 30 + 1 + 1 rows are state removed with who and when, note NULL, and B's look log has no new row.   P10 B revokes F2's grant: F2 still lists its notes with their labels; a new flag or a query on that client is 404; B reads 0.
 *   Hostile (each its own line below, written before the rule): F3 flags B's entry id -> 404 = an unknown client's answer · X-Books-For does not move the row · F2's owner reads U1's Only-me row at the DB -> 0 · blank current_actor -> 0 Only-me rows · an API key -> 403 · a cashier -> 404 ·
 *   201 ids -> 422 · the same 30 twice -> 30 rows · a removed flag changed again -> refused (route and trigger) · a 5,000-character label and a label with markup -> 422 · no flag reply anywhere in chit_messages · Y in F1 and F2 -> two spaces.
 * Run: DATABASE_URL=postgres://cb_app:cbapp@127.0.0.1:55471/flags_t node tests/private-flag-isolation.realstack.cjs   (a scratch database built by tools/fresh-db-check.cjs; never a shared or production database)
 * CARD      PM/REQ-PRIVATE-NOTES-BOOKMARKS-2026-11-17.md
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'private_flag_test_secret_at_least_32_chars_padding';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const API = path.join(__dirname, '..');

const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const { query, withEntity } = require(path.join(API, 'db'));
const reqctx = require(path.join(API, 'lib', 'reqctx.js'));
const fakeAuth = async (req, res, next) => {
  if (req.identity) return next();
  let who;
  try { who = JSON.parse(String(req.headers['x-test-as'] || '')); } catch (_) { return res.status(401).json({ error: 'no test identity' }); }
  if (who.api_key) { req.api_key = { key_id: 'test-key' }; }
  if (who.identity_type === 'actor' && /^[0-9a-f-]{36}$/i.test(String(who.identity_id))) {
    const row = (await query('SELECT break_status, access_level, whole_entity, can_see_costs FROM identities WHERE identity_id = $1', [who.identity_id])).rows[0];
    if (!row || ['removed', 'deactivated'].includes(row.break_status)) return res.status(401).json({ code: 'ACCESS_REVOKED' });
    Object.assign(who, { access_level: row.access_level, whole_entity: row.whole_entity === true, can_see_costs: row.can_see_costs === true });
  }
  req.identity = who;
  /* as the real auth does: the request runs with the REAL person as the actor, so every transaction opened under it sets app.current_actor */
  return reqctx.runWithActor(who.identity_id, () => next());
};
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const net = require(path.join(API, 'src', 'services', 'network'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 700) : '')); } };
const RUN = 'pf' + (Date.now() % 1e10).toString(36);
const code = (r) => r.body && r.body.code;
const uuid = () => crypto.randomUUID();

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'Flag ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  return { tag, bridgeId, id: identity.identity_id, name: identity.display_name, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
async function join(parent, member) {
  const asked = await net.requestConnect({ parentId: parent.node.id, childId: member.node.id }, parent.node);
  await net.approve({ edgeId: asked.id }, member.node);
}
const ownerOf = (biz) => ({ identity_id: biz.id, bridge_id: biz.bridgeId, identity_type: 'entity', parent_entity_id: null, display_name: biz.name });
/** a login of a business: `seat` true = whole entity, sees costs (the auditor / books-reading shape); false = shop staff with neither */
async function person(biz, tag, level, seat) {
  const { rows: [row] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, $6, $6, 'act') RETURNING identity_id, display_name`, [biz.bridgeId + tag, 'Person ' + tag + ' ' + RUN, biz.id, (biz.bridgeId + tag).toLowerCase(), level, seat]);
  return { identity_id: row.identity_id, identity_type: 'actor', parent_entity_id: biz.id, bridge_id: biz.bridgeId, display_name: row.display_name };
}
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
/** a statement in `entity`'s session as the real person `actor` (null = no actor at all: a job, a script), as cb_app with row security on */
const sqlAs = (entity, actor, text, params) => (actor ? reqctx.runWithActor(actor, () => withEntity(entity, (h) => h.query(text, params))) : withEntity(entity, (h) => h.query(text, params)));
const countAs = async (entity, actor, where, params) => Number((await sqlAs(entity, actor, 'SELECT count(*)::int AS n FROM private_flag WHERE ' + (where || 'true'), params || [])).rows[0].n);
const day = shopToday();
/** the masking of a recorded read: clocks and request ids differ between two runs, nothing else may */
const masked = (value) => JSON.stringify(value).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, 'T').replace(/"(request_id|instance|trace_id)":"[^"]*"/g, '"$1":"-"');

async function main() {
  const B = await business('b'), F1 = await business('1'), F2 = await business('2'), F3 = await business('3');
  await join(F1, B); await join(F2, F1); await join(F3, await business('z')); /* tree-only: F2 is F1's parent, so it is B's ancestor: a grant of B to F2 is live, as the second firm of review-mark.realstack */
  const U1 = await person(F2, 'u1', 'commenter', true), U2 = await person(F2, 'u2', 'commenter', true), STAFF2 = await person(F2, 's2', 'editor', false);
  const A1 = await person(F1, 'a1', 'editor', true), X = await person(F3, 'x', 'commenter', true), CASH = await person(B, 'c', 'editor', false);
  const Y1 = await person(F1, 'y', 'editor', true), Y2 = await person(F2, 'y', 'commenter', true); /* one human, two firms: two logins, two identities */
  const ownerB = ownerOf(B), ownerF1 = ownerOf(F1), ownerF2 = ownerOf(F2), ownerF3 = ownerOf(F3);
  const app = express();
  app.use(express.json());
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  app.use('/api/marks', require(path.join(API, 'routes', 'marks.js')));
  app.use('/api/flags', require(path.join(API, 'routes', 'flags.js')));
  app.use((err, req, res, next) => res.status(500).json({ code: 'TEST_500', message: String(err && err.message) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    await withEntity(B.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, B.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, B.id));
    const on = await call(ownerB, 'POST', '/api/books/enable', { body: {} });
    ok('0 the ledger of B is on through the real gates', on.status === 200, JSON.stringify(on));
    const gA = await call(ownerB, 'POST', '/api/books-grants', { body: { grantee: F2.id, purpose: 'audit of the books', consent: true } });
    const gV = await call(ownerB, 'POST', '/api/books-grants', { body: { grantee: F1.id, purpose: 'adviser of the books', consent: true, preset: 'adviser', posting: 'owner_approves' } });
    ok('0 B gives F2 the auditor grant and F1 the adviser grant; F3 has none', gA.status === 201 && gV.status === 201, JSON.stringify([gA, gV]));
    const accounts = (await call(ownerB, 'GET', '/api/books/accounts')).body;
    const list = accounts.accounts || accounts.rows || accounts || [];
    const cash = (list.find((a) => /cash/i.test(a.name || '')) || {}).code || '1000';
    const sales = (list.find((a) => /^sales/i.test(a.name || '')) || {}).code || '4000';
    const post = async (tag) => (await call(ownerB, 'POST', '/api/books/entries', { body: { narration: 'flag ' + RUN + tag, date: day, client_ref: RUN + tag, lines: [{ code: cash, dr_minor: 10000 }, { code: sales, cr_minor: 10000 }] } })).body;
    const E1 = await post('e1'), E2 = await post('e2'), E3 = await post('e3');
    ok('0 three journals posted by the owner of B', E1 && E1.entry_id && E2.entry_id && E3.entry_id, JSON.stringify([E1, E2, E3]));
    const flagsOf = (who, route, extra) => call(who, 'GET', route || '/api/flags', extra);
    const postFlag = (who, body, extra) => call(who, 'POST', '/api/flags', Object.assign({ body }, extra || {}));
    const lab = (n) => 'Entry ' + n + ' ' + day;
    const thirty = [E1.entry_id, E2.entry_id, E3.entry_id].concat(Array.from({ length: 27 }, uuid));
    const items30 = thirty.map((id, n) => ({ id, label: lab(n + 1) }));
    const bookmark30 = { kind: 'bookmark', subject_kind: 'posting', subject_entity: B.id, items: items30 };

    /* the differential, BEFORE any flag: every read that returns the posting, as B, F1, F2's person and F3 */
    const reads = async () => ({
      ownerDay: (await call(ownerB, 'GET', '/api/books/daybook?from=' + day + '&to=' + day)).body,
      ownerMarks: (await call(ownerB, 'GET', '/api/marks?adopter=acc.audit&open=1')).body,
      ownerMarksIds: (await call(ownerB, 'GET', '/api/marks?adopter=acc.audit&ids=' + E1.entry_id)).body,
      auditorDay: await call(U2, 'GET', '/api/books/daybook?from=' + day + '&to=' + day, { member: B.id, role: 'auditor' }),
      auditorMarks: await call(U2, 'GET', '/api/marks?adopter=acc.audit&open=1', { member: B.id, role: 'auditor' }),
      adviserDay: await call(A1, 'GET', '/api/books/daybook?from=' + day + '&to=' + day, { member: B.id, role: 'adviser' }),
      strangerDay: await call(X, 'GET', '/api/books/daybook?from=' + day + '&to=' + day, { member: B.id, role: 'auditor' })
    });
    const zero = masked(await reads());
    const looksBefore = Number((await withEntity(B.id, (h) => h.query('SELECT count(*)::int AS n FROM books_access_log WHERE grantor_entity = $1', [B.id]))).rows[0].n);

    /* H1 · F3 with no grant flags B's entry id: 404, the SAME answer as an unknown client */
    const h1 = await postFlag(X, { kind: 'bookmark', subject_kind: 'posting', subject_entity: B.id, items: [{ id: E1.entry_id, label: lab(1) }] });
    const h1u = await postFlag(X, { kind: 'bookmark', subject_kind: 'posting', subject_entity: uuid(), items: [{ id: E1.entry_id, label: lab(1) }] });
    ok('H1 F3 with no grant flags B\'s entry id: 404, the same status and code as an unknown client (no existence oracle)', h1.status === 404 && h1u.status === 404 && code(h1) === code(h1u) && h1.body.detail === h1u.body.detail, JSON.stringify([h1, h1u]));
    ok('H1b ... and nothing was written anywhere', (await countAs(F3.id, X.identity_id, 'true')) === 0 && (await countAs(B.id, ownerB.identity_id, 'true')) === 0);

    /* H5 · an API key; H6 · a cashier; the firm's shop staff with no seat */
    const h5 = await postFlag(Object.assign({ api_key: true }, U1), bookmark30);
    ok('H5 an API key is refused: 403 SIGN_IN_FOR_FLAGS, no row', h5.status === 403 && code(h5) === 'SIGN_IN_FOR_FLAGS' && (await countAs(F2.id, U1.identity_id, 'true')) === 0, JSON.stringify(h5));
    const h6 = await postFlag(CASH, { kind: 'bookmark', subject_kind: 'posting', subject_entity: B.id, items: [{ id: E1.entry_id, label: lab(1) }] });
    const h6s = await postFlag(STAFF2, bookmark30);
    ok('H6 a business cashier with no books access: 404; a firm\'s shop staff with no seat: 404', h6.status === 404 && h6s.status === 404 && (await flagsOf(CASH)).status === 404 && (await flagsOf(STAFF2, '/api/flags/counts')).status === 404, JSON.stringify([h6, h6s]));

    /* H7 · 201 ids */
    const tooMany = await postFlag(U1, { kind: 'bookmark', subject_kind: 'posting', subject_entity: B.id, items: Array.from({ length: 201 }, (_, n) => ({ id: uuid(), label: 'x' + n })) });
    ok('H7 201 ids: 422 FLAG_IDS_TOO_MANY, no row', tooMany.status === 422 && code(tooMany) === 'FLAG_IDS_TOO_MANY' && (await countAs(F2.id, U1.identity_id, 'true')) === 0, JSON.stringify(tooMany));
    const ok200 = await call(U1, 'POST', '/api/flags/query', { body: { subject_kind: 'posting', subject_entity: B.id, ids: Array.from({ length: 200 }, uuid) } });
    const bad201 = await call(U1, 'POST', '/api/flags/query', { body: { subject_kind: 'posting', subject_entity: B.id, ids: Array.from({ length: 201 }, uuid) } });
    ok('H7b the read takes 200 ids and refuses 201 (the one cap of lib/review-mark)', ok200.status === 200 && bad201.status === 422, JSON.stringify([ok200.status, bad201.status]));

    /* H10 · labels */
    const longLabel = await postFlag(U1, { kind: 'bookmark', subject_kind: 'posting', subject_entity: B.id, items: [{ id: E1.entry_id, label: 'x'.repeat(5000) }] });
    const markup = await postFlag(U1, { kind: 'bookmark', subject_kind: 'posting', subject_entity: B.id, items: [{ id: E1.entry_id, label: '<img src=x onerror=alert(1)>' }] });
    ok('H10 a 5,000-character label and a label with markup: 422 FLAG_LABEL_INVALID, no row', longLabel.status === 422 && markup.status === 422 && code(longLabel) === 'FLAG_LABEL_INVALID' && code(markup) === 'FLAG_LABEL_INVALID' && (await countAs(F2.id, U1.identity_id, 'true')) === 0, JSON.stringify([longLabel, markup]));

    /* P1 · U1 bookmarks 30 in one act, writes ONE note for the firm, and one "Only me" note */
    const made = await postFlag(U1, bookmark30);
    ok('P1a U1 bookmarks 30 postings in ONE act: 201, created 30, seat auditor, by U1', made.status === 201 && made.body.created === 30 && made.body.already === 0 && made.body.flags.every((f) => f.seat === 'auditor' && f.visibility === 'org' && f.mine === true && f.by_name === U1.display_name), JSON.stringify(made).slice(0, 400));
    const note = await postFlag(U1, { kind: 'note', subject_kind: 'posting', subject_entity: B.id, items: [{ id: E2.entry_id, label: lab(2) }], note: 'Ask about the cash round figure' });
    const mine = await postFlag(U1, { kind: 'note', visibility: 'me', subject_kind: 'posting', subject_entity: B.id, items: [{ id: E3.entry_id, label: lab(3) }], note: 'my private doubt about E3' });
    ok('P1b the firm note and the Only-me note are 201', note.status === 201 && mine.status === 201 && note.body.flags[0].kind === 'note' && mine.body.flags[0].visibility === 'me', JSON.stringify([note, mine]).slice(0, 300));
    const org31 = 31, noteId = note.body.flags[0].flag_id, mineId = mine.body.flags[0].flag_id;
    const u2List = await flagsOf(U2), ownerF2List = await flagsOf(ownerF2), u1List = await flagsOf(U1);
    ok('P1c U2 and the F2 owner each read the 31 shared flags, never the Only-me one; U1 reads 32', u2List.body.total === org31 && ownerF2List.body.total === org31 && u1List.body.total === org31 + 1 && !u2List.body.flags.some((f) => f.note === 'my private doubt about E3') && !ownerF2List.body.flags.some((f) => f.visibility === 'me'), JSON.stringify([u2List.body.total, ownerF2List.body.total, u1List.body.total]));
    const u2q = await call(U2, 'POST', '/api/flags/query', { body: { subject_kind: 'posting', subject_entity: B.id, ids: thirty.slice(0, 3) } });
    ok('P1d U2 reads the bookmark on E1, the note on E2, and NOTHING on E3 (the Only-me note) through the page read; the labels are plain text', u2q.status === 200 && u2q.body.flags[E1.entry_id].length === 1 && u2q.body.flags[E2.entry_id].some((f) => f.kind === 'note' && f.note === 'Ask about the cash round figure') && u2q.body.flags[E3.entry_id].length === 1 && u2q.body.flags[E3.entry_id][0].kind === 'bookmark', JSON.stringify(u2q.body).slice(0, 500));
    ok('P1e every flag was written in F2\'s organisation (entity_id = F2), none in B', (await countAs(F2.id, U1.identity_id, 'entity_id = $1', [F2.id])) === 32 && (await countAs(B.id, ownerB.identity_id, 'true')) === 0);

    /* P2 · B, F1, F3 see nothing; the differential */
    const seeNothing = [];
    for (const [name, who] of [['B owner', ownerB], ['F1 owner', ownerF1], ['F1 person', A1], ['F3 person', X], ['F3 owner', ownerF3]]) {
      const l = await flagsOf(who), c = await flagsOf(who, '/api/flags/counts');
      seeNothing.push(name + ' ' + l.status + '/' + (l.body && l.body.total) + ' ' + c.status + '/' + (c.body && c.body.open));
    }
    ok('P2a B, F1 and F3 read 0 flags and a count of 0 (each reads its own, empty, space)', seeNothing.every((line) => / 200\/0 200\/0$/.test(line)), seeNothing.join(' | '));
    const q = await call(A1, 'POST', '/api/flags/query', { body: { subject_kind: 'posting', subject_entity: B.id, ids: thirty.slice(0, 3) } });
    ok('P2b F1 (a live adviser grant on B) asks for the SAME records: every list empty, nothing of F2\'s', q.status === 200 && Object.keys(q.body.flags).length === 0, JSON.stringify(q));
    const after = masked(await reads());
    ok('P2c THE DIFFERENTIAL: the day book, the marks list and the grant reads as B, F2\'s person, F1 and F3 are byte-identical before and after the 31 flags (clocks and request ids masked)', after === zero, after === zero ? '' : 'first difference near char ' + [...after].findIndex((c, i) => c !== zero[i]));
    const markKeys = JSON.stringify(await reads());
    ok('P2d no private key, not even an empty one, in any of those answers', !/private|flag_id|"flags"|bookmark/i.test(markKeys.replace(/bookmark_?mark/gi, '')), (markKeys.match(/.{40}(private|flag_id|"flags"|bookmark).{40}/i) || [''])[0]);

    /* P3 · the DATABASE */
    ok('P3 at the database: scoped to B = 0, to F1 = 0, to F3 = 0; scoped to F2 as U1 = 32; as U2 = 31', (await countAs(B.id, ownerB.identity_id)) === 0 && (await countAs(F1.id, A1.identity_id)) === 0 && (await countAs(F3.id, X.identity_id)) === 0 && (await countAs(F2.id, U1.identity_id)) === 32 && (await countAs(F2.id, U2.identity_id)) === 31);

    /* H3 · F2's owner reads U1's Only-me row at the DATABASE; H4 · blank actor */
    ok('H3 F2\'s owner, in F2\'s own session at the DATABASE, reads U1\'s Only-me row: 0 rows (the policy, not the api)', (await countAs(F2.id, ownerF2.identity_id, "visibility = 'me'")) === 0 && (await countAs(F2.id, ownerF2.identity_id)) === 31);
    ok('H4 a blank app.current_actor (a job, a script) sees 0 Only-me rows (and the 31 shared ones)', (await countAs(F2.id, null, "visibility = 'me'")) === 0 && (await countAs(F2.id, null)) === 31);
    let blankWrite = null;
    try { await sqlAs(F2.id, null, `INSERT INTO private_flag (entity_id, kind, visibility, subject_kind, subject_entity, subject_id, label, author_identity_id, seat) VALUES ($1, 'bookmark', 'org', 'posting', $2, 'x', 'x', $3, 'auditor')`, [F2.id, B.id, U1.identity_id]); } catch (e) { blankWrite = e; }
    ok('H4b a blank actor cannot WRITE either (row security, 42501)', !!blankWrite && blankWrite.code === '42501', blankWrite && blankWrite.message);
    let nameForge = null;
    try { await sqlAs(F2.id, U2.identity_id, `INSERT INTO private_flag (entity_id, kind, visibility, subject_kind, subject_entity, subject_id, label, author_identity_id, seat) VALUES ($1, 'bookmark', 'org', 'posting', $2, 'x', 'x', $3, 'auditor')`, [F2.id, B.id, U1.identity_id]); } catch (e) { nameForge = e; }
    let wrongOrg = null;
    try { await sqlAs(F2.id, U1.identity_id, `INSERT INTO private_flag (entity_id, kind, visibility, subject_kind, subject_entity, subject_id, label, author_identity_id, seat) VALUES ($1, 'bookmark', 'org', 'posting', $2, 'x', 'x', $3, 'auditor')`, [B.id, B.id, U1.identity_id]); } catch (e) { wrongOrg = e; }
    ok('H4c a row cannot be written in a colleague\'s name, nor into another organisation (42501 both)', !!nameForge && nameForge.code === '42501' && !!wrongOrg && wrongOrg.code === '42501', [nameForge && nameForge.message, wrongOrg && wrongOrg.message].join(' | '));

    /* H2 · a flag request carrying X-Books-For: B */
    const viaHeader = await postFlag(U2, { kind: 'bookmark', subject_kind: 'posting', subject_entity: B.id, items: [{ id: uuid(), label: lab(99) }] }, { member: B.id, role: 'auditor' });
    ok('H2 a flag request carrying X-Books-For: B and the auditor role: the row\'s entity_id is still F2, B holds 0 rows', viaHeader.status === 201 && (await countAs(F2.id, U2.identity_id, 'entity_id = $1 AND flag_id = $2::bigint', [F2.id, viaHeader.body.flags[0].flag_id])) === 1 && (await countAs(B.id, ownerB.identity_id)) === 0, JSON.stringify(viaHeader).slice(0, 300));
    const headerOnly = await flagsOf(ownerB, '/api/flags', { member: B.id });
    ok('H2b the header alone does not move a read either: B\'s owner naming B reads B\'s own space, 0 flags', headerOnly.status === 200 && headerOnly.body.total === 0, JSON.stringify(headerOnly));

    /* H8 · the same 30 again (a stale tab) */
    const twice = await postFlag(U1, bookmark30);
    ok('H8 the same 30 bookmarks sent twice: created 0, already 30, and 30 open shared bookmarks (never 60)', twice.status === 201 && twice.body.created === 0 && twice.body.already === 30 && (await countAs(F2.id, U1.identity_id, "kind = 'bookmark' AND visibility = 'org' AND state = 'open' AND subject_entity = $1 AND subject_id = ANY($2::text[])", [B.id, thirty])) === 30);
    const byU2 = await postFlag(U2, bookmark30);
    ok('H8b a colleague bookmarking the same 30 for the firm adds none either (one shared bookmark per record)', byU2.status === 201 && byU2.body.created === 0 && byU2.body.already === 30);

    /* P6 · Only me */
    const mineAsU2 = [await call(U2, 'POST', `/api/flags/${mineId}/resolve`), await call(U2, 'POST', `/api/flags/${mineId}/remove`), await call(U2, 'POST', `/api/flags/${mineId}/share`), await call(ownerF2, 'POST', `/api/flags/${mineId}/remove`)];
    ok('P6a U2 and the F2 owner cannot resolve, remove or share U1\'s Only-me note by its id: 404 (the same word as an id that does not exist)', mineAsU2.every((r) => r.status === 404 && code(r) === 'FLAG_NOT_FOUND'), JSON.stringify(mineAsU2.map((r) => r.status)));
    const countsU2 = await flagsOf(U2, '/api/flags/counts'), countsU1 = await flagsOf(U1, '/api/flags/counts');
    ok('P6b counts: U2 reads 32 (31 bookmarks incl. the header one + 1 note), U1 reads 33', countsU2.body.open === 32 && countsU2.body.notes === 1 && countsU1.body.open === 33 && countsU1.body.notes === 2, JSON.stringify([countsU2.body, countsU1.body]));
    const shareByU1 = await call(U1, 'POST', `/api/flags/${mineId}/share`);
    ok('P6c its author may share it: now visible to U2 (33 for both); it cannot be taken back (the table refuses org -> me)', shareByU1.status === 200 && (await flagsOf(U2, '/api/flags/counts')).body.open === 33, JSON.stringify(shareByU1));
    let takeBack = null;
    try { await sqlAs(F2.id, U1.identity_id, `UPDATE private_flag SET visibility = 'me' WHERE flag_id = $1::bigint`, [mineId]); } catch (e) { takeBack = e; }
    ok('P6d a shared flag cannot go back to Only me (trigger, P0001)', !!takeBack && takeBack.code === 'P0001', takeBack && takeBack.message);

    /* H12 · one human, two firms */
    const y1 = await postFlag(Y1, { kind: 'note', subject_kind: 'posting', subject_entity: B.id, items: [{ id: E1.entry_id, label: lab(1) }], note: 'Y in F1 only' });
    const y2 = await postFlag(Y2, { kind: 'note', subject_kind: 'posting', subject_entity: B.id, items: [{ id: E1.entry_id, label: lab(1) }], note: 'Y in F2 only' });
    const y1list = await flagsOf(Y1), y2list = await flagsOf(Y2);
    ok('H12 a person in both F1 and F2 has two logins and two spaces: F1\'s note is F1\'s, F2\'s note is F2\'s, neither reads the other\'s', y1.status === 201 && y2.status === 201 && y1list.body.total === 1 && y1list.body.flags[0].note === 'Y in F1 only' && !y2list.body.flags.some((f) => f.note === 'Y in F1 only') && !y1list.body.flags.some((f) => f.note === 'Y in F2 only'), JSON.stringify([y1list.body.total, y2list.body.total]));

    /* P5 · B and F1 as writers: the others see nothing */
    const bNote = await postFlag(ownerB, { kind: 'note', subject_kind: 'posting', subject_entity: B.id, items: [{ id: E1.entry_id, label: lab(1) }], note: 'B owner private note' });
    ok('P5a B\'s owner writes a note on its own posting (seat business); F1, F2 and F3 read none of it', bNote.status === 201 && bNote.body.flags[0].seat === 'business' && (await flagsOf(A1)).body.total === 1 && !(await flagsOf(U2)).body.flags.some((f) => f.note === 'B owner private note') && (await flagsOf(X)).body.total === 0, JSON.stringify(bNote).slice(0, 300));
    const bList = await flagsOf(ownerB);
    ok('P5b B reads only its own note, none of F2\'s 32 or F1\'s', bList.body.total === 1 && bList.body.flags[0].note === 'B owner private note');
    const f1Note = await postFlag(A1, { kind: 'note', subject_kind: 'client', subject_entity: B.id, items: [{ id: B.id, label: 'Client ' + B.name }], note: 'F1 note about the client as a whole' });
    ok('P5c F1 (adviser seat) writes a note on the client as a whole (seat adviser); B and F2 read none of it; a client note on itself is 404', f1Note.status === 201 && f1Note.body.flags[0].seat === 'adviser' && !(await flagsOf(ownerB)).body.flags.some((f) => f.subject_kind === 'client') && !(await flagsOf(U2)).body.flags.some((f) => f.subject_kind === 'client') && (await postFlag(ownerB, { kind: 'note', subject_kind: 'client', subject_entity: B.id, items: [{ id: B.id, label: 'me' }], note: 'x' })).status === 404, JSON.stringify(f1Note).slice(0, 300));

    /* P8 · removal */
    const setDay = new Date().toISOString().slice(0, 10); /* utc-ok: lib/private-flag.js clearBookmarks cuts flag.created_at as a UTC date (session zone), so the clear range is the UTC day the flags were SET on, not the shop's posting day (finding for the flags owner) */
    const looksMid = Number((await withEntity(B.id, (h) => h.query('SELECT count(*)::int AS n FROM books_access_log WHERE grantor_entity = $1', [B.id]))).rows[0].n);
    const cleared = await call(U2, 'POST', '/api/flags/clear', { body: { subject_entity: B.id, from: setDay, to: setDay } });
    const resolved = await call(U2, 'POST', `/api/flags/${noteId}/resolve`), notMine = resolved.status;
    ok('P8a clear all bookmarks of the client for the day: cleared 30; U2 (not the author, not the owner) may not resolve U1\'s note: 403 FLAG_NOT_YOURS', cleared.status === 200 && cleared.body.cleared >= 30 && notMine === 403 && code(resolved) === 'FLAG_NOT_YOURS', JSON.stringify([cleared, resolved]));
    const resolvedByOwner = await call(U1, 'POST', `/api/flags/${noteId}/resolve`);
    const removedNote = await call(U1, 'POST', `/api/flags/${mineId}/remove`);
    ok('P8b the author resolves the firm note (it stays, with who and when) and removes the other note', resolvedByOwner.status === 200 && resolvedByOwner.body.flag.state === 'resolved' && resolvedByOwner.body.flag.resolved_by === U1.display_name && removedNote.status === 200 && removedNote.body.flag.state === 'removed' && removedNote.body.flag.note === null, JSON.stringify([resolvedByOwner, removedNote]).slice(0, 400));
    const removedRows = (await sqlAs(F2.id, U1.identity_id, `SELECT flag_id, state, note, removed_by, removed_name, removed_at FROM private_flag WHERE state = 'removed' AND subject_entity = $1`, [B.id])).rows;
    ok('P8c the removed rows ARE the record: state removed, who (id and name) and when set, the words NULL; at least 31 of them', removedRows.length >= 31 && removedRows.every((r) => r.note === null && r.removed_by && r.removed_name && r.removed_at), JSON.stringify(removedRows[0]));
    ok('P8d no log was written anywhere else: B\'s look log has no new row from any flag call (the grant reads of the differential wrote theirs before)', Number((await withEntity(B.id, (h) => h.query('SELECT count(*)::int AS n FROM books_access_log WHERE grantor_entity = $1', [B.id]))).rows[0].n) === looksMid && looksMid >= looksBefore);
    const removedAgain = await call(U1, 'POST', `/api/flags/${mineId}/remove`), resolveRemoved = await call(U1, 'POST', `/api/flags/${mineId}/resolve`);
    let removedDirect = null;
    try { await sqlAs(F2.id, U1.identity_id, `UPDATE private_flag SET label = 'changed' WHERE flag_id = $1::bigint`, [mineId]); } catch (e) { removedDirect = e; }
    ok('H9 a removed flag changed again is refused: the route says 409 FLAG_REMOVED, and the DATABASE refuses a direct UPDATE (trigger, P0001)', removedAgain.status === 409 && code(removedAgain) === 'FLAG_REMOVED' && resolveRemoved.status === 409 && !!removedDirect && removedDirect.code === 'P0001', JSON.stringify([removedAgain, removedDirect && removedDirect.message]));
    let del = null, truncate = null, immutable = null;
    try { await sqlAs(F2.id, U1.identity_id, 'DELETE FROM private_flag WHERE flag_id = $1::bigint', [noteId]); } catch (e) { del = e; }
    try { await sqlAs(F2.id, U1.identity_id, 'TRUNCATE private_flag'); } catch (e) { truncate = e; }
    try { await sqlAs(F2.id, U1.identity_id, `UPDATE private_flag SET subject_id = 'other' WHERE flag_id = $1::bigint`, [noteId]); } catch (e) { immutable = e; }
    ok('H9b cb_app cannot DELETE or TRUNCATE (no grant, 42501) and cannot move a flag to another record (trigger 42501)', !!del && del.code === '42501' && !!truncate && truncate.code === '42501' && !!immutable && immutable.code === '42501', [del, truncate, immutable].map((e) => e && e.message).join(' | '));
    const kept = await withEntity(F2.id, async (h) => { await h.query("SELECT set_config('app.current_actor', $1, true)", [U1.identity_id]); return Number((await h.query('SELECT count(*)::int AS n FROM private_flag')).rows[0].n); });
    ok('H9c nothing was lost by the refused statements', kept >= 33, kept);

    /* H11 · A4 (replies) is not built: no flag thread leaks into the chit message reads */
    const thread = (await sqlAs(F2.id, U1.identity_id, 'SELECT thread_id::text AS t FROM private_flag WHERE flag_id = $1::bigint', [noteId])).rows[0].t;
    const viaMarks = await call(ownerB, 'POST', '/api/marks/query', { body: { adopter: 'acc.audit', ids: [thread] } });
    const msgs = Number((await withEntity(F2.id, (h) => h.query('SELECT count(*)::int AS n FROM chit_messages WHERE subject_id = $1 OR subject_type = $2', [thread, 'flag']))).rows[0].n);
    ok('H11 the flag\'s thread id read through /api/marks/query reads no mark, and chit_messages holds no flag row (replies are slice A4, not built here)', viaMarks.status === 200 && Object.values(viaMarks.body.marks || {}).every((m) => m === null) && msgs === 0, JSON.stringify(viaMarks).slice(0, 300));

    /* P10 · B revokes F2's grant */
    const liveGrant = gA.body.grant_id || (gA.body.grant && gA.body.grant.grant_id);
    const rv = await call(ownerB, 'POST', '/api/books-grants/' + liveGrant + '/revoke', { body: {} });
    const listAfter = await flagsOf(U2);
    const newAfter = await postFlag(U2, { kind: 'bookmark', subject_kind: 'posting', subject_entity: B.id, items: [{ id: uuid(), label: lab(77) }] });
    const queryAfter = await call(U2, 'POST', '/api/flags/query', { body: { subject_kind: 'posting', subject_entity: B.id, ids: thirty.slice(0, 3) } });
    ok('P10a B revokes F2\'s grant: F2 still lists its open flags WITH their labels; a new flag and a page read on that client are 404 (the record can no longer be opened)', rv.status === 200 && listAfter.status === 200 && listAfter.body.flags.some((f) => /^Entry \d+ /.test(f.label)) && newAfter.status === 404 && queryAfter.status === 404, JSON.stringify([rv.status, listAfter.body.total, newAfter.status, queryAfter.status]));
    const clearAfter = await call(U2, 'POST', '/api/flags/clear', { body: { subject_entity: B.id } });
    ok('P10b F2 may still tidy its own bookmarks after the grant ended; B still reads only its own note', clearAfter.status === 200 && (await flagsOf(ownerB)).body.total === 1);

    /* the structure: one api file names the table; the router never mounts the grant front */
    const strip = (text) => text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const files = [];
    for (const dir of ['lib', 'routes', 'middleware', 'src', 'db']) {
      const walk = (d) => fs.readdirSync(path.join(API, d), { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(js|cjs)$/.test(e.name) && files.push(path.join(d, e.name))));
      walk(dir);
    }
    files.push('server.js');
    const naming = files.filter((f) => /private_flag|subject_type\s*=\s*'flag'/.test(strip(fs.readFileSync(path.join(API, f), 'utf8')))).map((f) => f.replace(/\\/g, '/'));
    ok('G1 GUARD: private_flag (and subject_type = flag) is named in lib/private-flag.js and, for a reply on a note, in lib/message-post.js (the ONE writer of a message, b877) and nowhere else', naming.length === 2 && naming.includes('lib/private-flag.js') && naming.includes('lib/message-post.js'), naming.join(', '));
    const flagsSrc = strip(fs.readFileSync(path.join(API, 'routes', 'flags.js'), 'utf8')) + strip(fs.readFileSync(path.join(API, 'lib', 'private-flag.js'), 'utf8'));
    const grantFront = require(path.join(API, 'middleware', 'books-grant.js'));
    const router = require(path.join(API, 'routes', 'flags.js'));
    const layers = router.stack || [];
    const mounted = layers.some((l) => !l.route) || layers.some((l) => (l.route ? l.route.stack : []).some((s) => s.handle === grantFront));
    ok('G2 GUARD: routes/flags.js mounts no middleware of its own (no router.use) and never the books-grant front; nothing in it or the lib reads X-Books-For or acting_for_grant', !mounted && !/books-grant/.test(strip(fs.readFileSync(path.join(API, 'routes', 'flags.js'), 'utf8'))) && !/middleware\/books-grant/.test(strip(fs.readFileSync(path.join(API, 'lib', 'private-flag.js'), 'utf8')).replace(/require\('\.\.\/middleware\/books-grant'\)\.mayUseGrant/g, '')) && !/x-books-for|acting_for_grant|req\.mark_door/i.test(flagsSrc), JSON.stringify({ mounted, layers: layers.length }));
    ok('G3 every route of the router is declared in lib/flags-contract (no route without its schema)', layers.filter((l) => l.route).length === Object.keys(require(path.join(API, 'lib', 'flags-contract.js')).ROUTES).length);
  } finally {
    server.close();
  }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('CRASH', e); process.exit(1); });
