'use strict';
/**
 * tests/review-mark.realstack.cjs — MARK & QUERY (CAP-25) on a REAL Postgres, as the role the api runs as (cb_app, RLS on), through routes/marks.js, routes/books.js and the real grant front (middleware/books-grant.js).
 * Only the sign-in is a stand-in (a header names who calls; an actor's row is read from identities on every request, as the real auth does). Migrations b863-b869 are built by the fresh-db step.
 * HAND-COMPUTED  firm P with an auditor person U (commenter, whole entity, sees costs) and an adviser person A (editor, whole entity); stores M1 (the books; ledger on, India, INR) and M3 (a stranger store). M1 gives P an AUDITOR grant and an ADVISER grant.
 *   M1's owner posts three manual journals E1, E2, E3 (Dr cash 10000 / Cr sales 10000 minor each).
 *   1 U sets Checked on E1 (201, class clear); the owner reads it back, and the day book carries it as `mark` on E1 and null on E2.   2 an identical press is 200 unchanged and writes no row.
 *   3 (critic a) the OWNER posting a class: 403 MARK_NOT_ALLOWED, no row; the ADVISER posting a class: 403, no row.   4 (critic b) a raw INSERT as cb_app is refused by the database.
 *   5 U sets a Query on E2 without words: 422, no row; with words: 201 open; the owner's open list: total_open 1, checked 1 of 3 (E1 only), age 0.   6 the owner, the adviser and U each reply: 201; the thread holds 3 replies with `mine` right; the class is still open.
 *   7 nothing leaves the installation: the replies are chit_messages rows with subject_type mark, no chit, in M1's scope only; no chit_message_deliver copy (one row per reply).
 *   8 U sets On hold on E3 then Checked on E2: the thread of E2 is closed (a reply is 409 MARK_THREAD_CLOSED), the open list holds E3 only.   9 a removed mark reads null and keeps the age of the open run when marked again.
 *   10 the owner reverses E1: E1's mark reads altered with altered_by = the reversing entry; the reversal entry carries no mark; E3 (On hold) reversed stays on the open list, altered.
 *   11 (critic) one transaction: a log row that cannot be written answers 503 and NO mark row exists; the log row of a successful write says outcome written, route POST /api/marks.   12 the stranger M3: its marks read empty, M1's thread is 404, M1's entry ids answer not found.
 *   13 (critic c) the DB function refuses a revoked grant: after the owner revokes the auditor grant, U's press is 403 BOOKS_GRANT_ENDED and a direct call of review_mark_set with via grant is refused; the function also refuses a claimed writer that is not the session's entity.
 * Run: DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 node tests/review-mark.realstack.cjs   (a SIT box: a scratch database built by tools/fresh-db-check.cjs)
 * CARD      capability/MARK-AND-QUERY-CAPABILITY
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.CB_TRIPS = '1'; /* the round trips of each marks route are measured here (X-DB-Trips) for round-trips.budget.json */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'review_mark_test_secret_at_least_32_chars_padding';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const API = path.join(__dirname, '..');

const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const { query, withEntity } = require(path.join(API, 'db'));
const fakeAuth = async (req, res, next) => {
  if (req.identity) return next();
  let who;
  try { who = JSON.parse(String(req.headers['x-test-as'] || '')); } catch (_) { return res.status(401).json({ error: 'no test identity' }); }
  if (who.identity_type === 'actor' && /^[0-9a-f-]{36}$/i.test(String(who.identity_id))) {
    const row = (await query('SELECT break_status, access_level, whole_entity, can_see_costs FROM identities WHERE identity_id = $1', [who.identity_id])).rows[0];
    if (!row || ['removed', 'deactivated'].includes(row.break_status)) return res.status(401).json({ code: 'ACCESS_REVOKED' });
    Object.assign(who, { access_level: row.access_level, whole_entity: row.whole_entity === true, can_see_costs: row.can_see_costs === true });
  }
  req.identity = who;
  return next();
};
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const net = require(path.join(API, 'src', 'services', 'network'));
const grants = require(path.join(API, 'lib', 'books-grant.js'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 600) : '')); } };
const RUN = 'mk' + (Date.now() % 1e10).toString(36);
const code = (r) => r.body && r.body.code;

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'Mark ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  return { tag, bridgeId, id: identity.identity_id, name: identity.display_name, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
async function join(parent, member) {
  const asked = await net.requestConnect({ parentId: parent.node.id, childId: member.node.id }, parent.node);
  await net.approve({ edgeId: asked.id }, member.node);
}
const ownerOf = (biz) => ({ identity_id: biz.id, bridge_id: biz.bridgeId, identity_type: 'entity', parent_entity_id: null, display_name: biz.name });
async function person(biz, tag, level) {
  const { rows: [row] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, true, true, 'act') RETURNING identity_id, display_name`, [biz.bridgeId + tag, 'Person ' + tag + ' ' + RUN, biz.id, (biz.bridgeId + tag).toLowerCase(), level]);
  return { identity_id: row.identity_id, identity_type: 'actor', parent_entity_id: biz.id, bridge_id: biz.bridgeId, display_name: row.display_name };
}

const TRIPS = {}; /* the dearest successful call of each route: X-DB-Trips */
const RECORDED = {}; /* MARK_CAPTURE_OUT: every answer, keyed 'METHOD /pattern|n', for tools/api-allowlist.cjs (the derived output shapes) */
const patternOf = (route) => route.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':thread_id');
let base = '';
async function call(who, method, route, opts) {
  const route0 = route;
  const o = opts || {};
  const headers = { 'content-type': 'application/json', 'x-test-as': JSON.stringify(who) };
  if (o.member) headers['x-books-for'] = o.member;
  if (o.role) headers['x-books-role'] = o.role;
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  const key = method + ' ' + patternOf(route0);
  if (res.status < 300 && res.headers.get('x-db-trips')) TRIPS[key] = Math.max(TRIPS[key] || 0, Number(res.headers.get('x-db-trips')));
  RECORDED[key + '|' + Object.keys(RECORDED).length] = { route: key, status: res.status, request: { url: route0, body: o.body }, body };
  return { status: res.status, body };
}
const count = (M, sql, params) => withEntity(M.id, (h) => h.query(sql, params)).then((r) => Number(r.rows[0].n));
const marksOf = (M) => count(M, 'SELECT count(*)::int AS n FROM review_mark WHERE entity_id = $1', [M.id]);
const day = new Date().toISOString().slice(0, 10);

async function main() {
  const P = await business('p'); const M1 = await business('1'); const M3 = await business('3');
  await join(P, M1); await join(P, M3);
  const U = await person(P, 'u', 'commenter'); const A = await person(P, 'a', 'editor');
  const app = express();
  app.use(require(path.join(API, 'lib', 'trips')).middleware());
  app.use(express.json());
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  app.use('/api/marks', require(path.join(API, 'routes', 'marks.js')));
  app.use((err, req, res, next) => res.status(500).json({ code: 'TEST_500', message: String(err && err.message) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  const owner = ownerOf(M1), stranger = ownerOf(M3);
  try {
    await withEntity(M1.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, M1.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, M1.id));
    const on = await call(owner, 'POST', '/api/books/enable', { body: {} });
    ok('0 the ledger of M1 is on through the real gates', on.status === 200, JSON.stringify(on));
    const gA = await call(owner, 'POST', '/api/books-grants', { body: { grantee: P.id, purpose: 'audit of the books', consent: true } });
    const gV = await call(owner, 'POST', '/api/books-grants', { body: { grantee: P.id, purpose: 'adviser of the books', consent: true, preset: 'adviser', posting: 'owner_approves' } });
    ok('0 M1 gives P the auditor grant and the adviser grant', gA.status === 201 && gV.status === 201, JSON.stringify([gA, gV]));
    const accounts = (await call(owner, 'GET', '/api/books/accounts')).body;
    const list = accounts.accounts || accounts.rows || accounts || [];
    const cash = (list.find((a) => /cash/i.test(a.name || '')) || {}).code || '1000';
    const sales = (list.find((a) => /^sales/i.test(a.name || '')) || {}).code || '4000';
    const post = async (tag) => (await call(owner, 'POST', '/api/books/entries', { body: { narration: 'mark ' + RUN + tag, date: day, client_ref: RUN + tag, lines: [{ code: cash, dr_minor: 10000 }, { code: sales, cr_minor: 10000 }] } })).body;
    const E1 = await post('e1'), E2 = await post('e2'), E3 = await post('e3');
    ok('0 three journals posted by the owner', E1 && E1.entry_id && E2.entry_id && E3.entry_id, JSON.stringify([E1, E2, E3]));
    const asAud = (method, route, body) => call(U, method, route, { member: M1.id, role: 'auditor', body });
    const asAdv = (method, route, body) => call(A, method, route, { member: M1.id, role: 'adviser', body });
    const mk = (id, kind, note) => ({ adopter: 'acc.audit', subject_id: id, kind, note });
    const readMark = async (who, id, extra) => ((await call(who, 'GET', '/api/marks?adopter=acc.audit&ids=' + id, extra)).body || {}).marks;

    /* 1 */
    const before = await marksOf(M1);
    const c1 = await asAud('POST', '/api/marks', mk(E1.entry_id, 'checked'));
    ok('1a U sets Checked on E1: 201, class clear, by U, by_firm the firm', c1.status === 201 && c1.body.mark.class === 'clear' && c1.body.mark.label === 'Checked' && c1.body.mark.by_name === U.display_name && c1.body.mark.by_firm === P.name, JSON.stringify(c1));
    ok('1b the row exists once', (await marksOf(M1)) === before + 1);
    const seen = (await readMark(owner, E1.entry_id))[E1.entry_id];
    ok('1c the owner reads it back at once (visible_to_readers at_once); the owner may reply on a closed thread: no, reply.ok false', seen && seen.class === 'clear' && seen.actions.set.ok === false && seen.actions.reply.ok === false, JSON.stringify(seen));
    const day1 = await call(owner, 'GET', '/api/books/daybook?from=' + day + '&to=' + day);
    const e1row = (day1.body.entries || []).find((e) => e.entry_id === E1.entry_id), e2row = (day1.body.entries || []).find((e) => e.entry_id === E2.entry_id);
    ok('1d the day book embeds the mark on E1 and null on E2, with the actions and the words', e1row && e1row.mark && e1row.mark.class === 'clear' && e2row && e2row.mark === null && day1.body.mark_actions && Array.isArray(day1.body.mark_vocabulary), JSON.stringify(day1.body).slice(0, 400));
    const byBody = await call(owner, 'POST', '/api/marks/query', { body: { adopter: 'acc.audit', ids: [E1.entry_id, E2.entry_id] } });
    ok('1e POST /query (ids in a body, a READ) answers as the list does; a stranger\'s ids read null', byBody.status === 200 && byBody.body.marks[E1.entry_id].class === 'clear' && byBody.body.marks[E2.entry_id] === null && Array.isArray(byBody.body.not_found), JSON.stringify(byBody));
    const again = await asAud('POST', '/api/marks', mk(E1.entry_id, 'checked'));
    delete RECORDED[Object.keys(RECORDED).pop()]; /* the 200 of a repeat is not the route's success shape (its 201 is): the derived shape reads the 201s */
    ok('2 an identical press is 200 unchanged and writes no row', again.status === 200 && again.body.unchanged === true && (await marksOf(M1)) === before + 1, JSON.stringify(again));

    /* 3 critic a */
    const n3 = await marksOf(M1);
    const ownerSets = await call(owner, 'POST', '/api/marks', { body: mk(E2.entry_id, 'checked') });
    const adviserSets = await asAdv('POST', '/api/marks', mk(E2.entry_id, 'query', 'why'));
    ok('3a (critic a) the OWNER posting a class: 403 MARK_NOT_ALLOWED and no row', ownerSets.status === 403 && code(ownerSets) === 'MARK_NOT_ALLOWED' && (await marksOf(M1)) === n3, JSON.stringify(ownerSets));
    ok('3b the ADVISER posting a class: 403 MARK_NOT_ALLOWED and no row', adviserSets.status === 403 && code(adviserSets) === 'MARK_NOT_ALLOWED' && (await marksOf(M1)) === n3, JSON.stringify(adviserSets));
    /* 4 critic b */
    let rawErr = null;
    try { await withEntity(M1.id, (h) => h.query(`INSERT INTO review_mark (entity_id, adopter, subject_id, thread_id, kind, class, seal_how, by_identity_id, by_entity_id, by_policy, via_kind) VALUES ($1, 'acc.audit', 'x', gen_random_uuid(), 'checked', 'clear', 'successor', $1, $1, 'grant:auditor', 'grant')`, [M1.id])); } catch (e) { rawErr = e; }
    ok('4a (critic b) a raw INSERT as cb_app is refused by the database (42501)', !!rawErr && rawErr.code === '42501', rawErr && rawErr.message);
    let updErr = null;
    try { await withEntity(M1.id, (h) => h.query(`UPDATE review_mark SET note = 'changed' WHERE entity_id = $1`, [M1.id])); } catch (e) { updErr = e; }
    ok('4b an UPDATE as cb_app is refused too (no privilege)', !!updErr && updErr.code === '42501', updErr && updErr.message);

    /* 5 */
    const n5 = await marksOf(M1);
    const noWords = await asAud('POST', '/api/marks', mk(E2.entry_id, 'query', '   '));
    ok('5a a Query without words: 422 MARK_WORDS_REQUIRED and no row', noWords.status === 422 && code(noWords) === 'MARK_WORDS_REQUIRED' && (await marksOf(M1)) === n5, JSON.stringify(noWords));
    const q = await asAud('POST', '/api/marks', mk(E2.entry_id, 'query', 'Why was this posted to sales?'));
    ok('5b a Query with words: 201, open, the question is the note', q.status === 201 && q.body.mark.class === 'open' && q.body.mark.note === 'Why was this posted to sales?' && q.body.mark.open === true, JSON.stringify(q));
    const thread = q.body.mark.thread_id;
    const open1 = await call(owner, 'GET', '/api/marks?adopter=acc.audit&open=1&from=' + day + '&to=' + day);
    ok('5c the owner open list: total_open 1, the entry named, age 0, checked 1 of 3', open1.status === 200 && open1.body.total_open === 1 && open1.body.open[0].subject_id === E2.entry_id && open1.body.open[0].age_days === 0 && open1.body.checked === 1 && open1.body.of === 3, JSON.stringify(open1.body).slice(0, 500));
    ok('5d the owner may answer (reply.ok), not set', open1.body.open[0].actions.reply.ok === true && open1.body.open[0].actions.set.ok === false);

    /* 6 */
    const r1 = await call(owner, 'POST', '/api/marks/' + thread + '/messages', { body: { message_text: 'It was a cash sale for the day.' } });
    const r2 = await asAdv('POST', '/api/marks/' + thread + '/messages', { message_text: 'Receipt attached in the file.' });
    const r3 = await asAud('POST', '/api/marks/' + thread + '/messages', { message_text: 'Thank you, checking.', msg_type: 'info' });
    ok('6a the owner, the adviser and the auditor each reply: 201', r1.status === 201 && r2.status === 201 && r3.status === 201, JSON.stringify([r1, r2, r3]));
    const th = await call(owner, 'GET', '/api/marks/' + thread + '/messages');
    ok('6b the thread: the question at the head (mark.note), 3 replies oldest first, mine right, class still open', th.status === 200 && th.body.mark.class === 'open' && th.body.mark.note === 'Why was this posted to sales?' && th.body.messages.length === 3 && th.body.messages[0].mine === true && th.body.messages[1].mine === false && th.body.history.length === 1, JSON.stringify(th.body).slice(0, 600));
    const thAud = await asAud('GET', '/api/marks/' + thread + '/messages');
    ok('6c the auditor reads the same thread under the grant (READ ONLY)', thAud.status === 200 && thAud.body.messages.length === 3 && thAud.body.messages[2].mine === true, JSON.stringify(thAud));
    /* 7 */
    const rows7 = await withEntity(M1.id, (h) => h.query(`SELECT chit_id, subject_type, entity_id, thread_type, sender_entity_id FROM chit_messages WHERE subject_type = 'mark' AND subject_id = $1`, [thread]));
    ok('7 three reply rows, one copy each, no chit, M1 scope, external, the sender is the real person\'s own entity', rows7.rows.length === 3 && rows7.rows.every((r) => r.chit_id === null && r.entity_id === M1.id && r.thread_type === 'external') && rows7.rows.some((r) => r.sender_entity_id === P.id), JSON.stringify(rows7.rows));

    /* 8 */
    const hold = await asAud('POST', '/api/marks', mk(E3.entry_id, 'on_hold', 'waiting for the bank letter'));
    const clear2 = await asAud('POST', '/api/marks', mk(E2.entry_id, 'checked'));
    ok('8a On hold with a reason, then Checked on E2: 201 each', hold.status === 201 && hold.body.mark.class === 'hold' && clear2.status === 201 && clear2.body.mark.class === 'clear' && clear2.body.mark.thread_id === thread, JSON.stringify([hold, clear2]));
    const late = await call(owner, 'POST', '/api/marks/' + thread + '/messages', { body: { message_text: 'one more' } });
    ok('8b a reply on the closed thread: 409 MARK_THREAD_CLOSED', late.status === 409 && code(late) === 'MARK_THREAD_CLOSED', JSON.stringify(late));
    const open2 = await call(owner, 'GET', '/api/marks?adopter=acc.audit&open=1&from=' + day + '&to=' + day);
    ok('8c the open list holds E3 only; checked 2 of 3', open2.body.total_open === 1 && open2.body.open[0].subject_id === E3.entry_id && open2.body.checked === 2, JSON.stringify(open2.body).slice(0, 400));
    /* 9 removed keeps the run */
    const rem = await asAud('POST', '/api/marks', mk(E3.entry_id, 'removed', 'taken off by mistake'));
    const afterRem = (await readMark(owner, E3.entry_id))[E3.entry_id];
    ok('9a a removed mark reads null and leaves the open list', rem.status === 201 && afterRem === null && (await call(owner, 'GET', '/api/marks?adopter=acc.audit&open=1')).body.total_open === 0, JSON.stringify(rem));
    await asAud('POST', '/api/marks', mk(E3.entry_id, 'on_hold', 'waiting for the bank letter again'));
    const run = (await readMark(owner, E3.entry_id))[E3.entry_id];
    const firstOpenAt = (await withEntity(M1.id, (h) => h.query(`SELECT min(at) AS at FROM review_mark WHERE entity_id = $1 AND subject_id = $2 AND class IN ('open', 'hold')`, [M1.id, E3.entry_id]))).rows[0].at;
    ok('9b marked again after a removal: the open run still starts at its first row (removed never resets the age)', run && run.open === true && new Date(run.open_since).getTime() === new Date(firstOpenAt).getTime(), JSON.stringify(run));

    /* 10 altered */
    const rev1 = await call(owner, 'POST', '/api/books/entries/' + E1.entry_id + '/reverse', { body: { reason: 'wrong account' } });
    const rev3 = await call(owner, 'POST', '/api/books/entries/' + E3.entry_id + '/reverse', { body: { reason: 'wrong account' } });
    ok('10a the owner reverses E1 and E3', rev1.status === 200 && rev3.status === 200 && rev1.body.entry_id && rev3.body.entry_id, JSON.stringify([rev1, rev3]));
    const m1 = (await readMark(owner, E1.entry_id))[E1.entry_id];
    ok('10b E1 Checked then reversed reads altered, altered_by = the reversing entry', m1 && m1.altered === true && m1.altered_by && m1.altered_by.entry_id === rev1.body.entry_id, JSON.stringify(m1));
    const revMark = (await readMark(owner, rev1.body.entry_id))[rev1.body.entry_id];
    ok('10c the reversal entry carries no mark (a new record)', revMark === null);
    const open3 = await call(owner, 'GET', '/api/marks?adopter=acc.audit&open=1');
    ok('10d E3 (On hold) reversed stays on the open list, altered', open3.body.total_open === 1 && open3.body.open[0].subject_id === E3.entry_id && open3.body.open[0].altered === true, JSON.stringify(open3.body).slice(0, 400));
    const led = await call(owner, 'GET', '/api/books/ledger/' + sales + '?from=' + day + '&to=' + day);
    const l1 = (led.body.lines || []).find((l) => l.entry_id === E1.entry_id);
    ok('10e the ledger carries the mark on its lines too', l1 && l1.mark && l1.mark.altered === true && led.body.mark_actions, JSON.stringify(led.body).slice(0, 300));

    /* 11 one transaction */
    const n11 = await marksOf(M1);
    const realWrite = grants.writeLogRow;
    grants.writeLogRow = async () => { throw new Error('the log cannot be written'); };
    const noLog = await asAud('POST', '/api/marks', mk(E2.entry_id, 'query', 'a question that must not be saved'));
    grants.writeLogRow = realWrite;
    ok('11a (critic) a log row that cannot be written: 503 and NO mark row', noLog.status === 503 && code(noLog) === 'BOOKS_GRANT_LOG_UNAVAILABLE' && (await marksOf(M1)) === n11, JSON.stringify(noLog));
    const logRows = await query(`SELECT route_pattern, outcome, status FROM books_access_log WHERE grantor_entity = $1 AND outcome = 'written'`, [M1.id]).catch(() => ({ rows: [] }));
    const mine = await withEntity(P.id, (h) => h.query(`SELECT route_pattern, outcome, status FROM books_access_log WHERE grantor_entity = $1 AND outcome = 'written' ORDER BY log_id`, [M1.id]));
    ok('11b every successful write of the grant door has its log row: outcome written, POST /api/marks or the reply route', mine.rows.length >= 8 && mine.rows.every((r) => /^POST \/api\/marks/.test(r.route_pattern)), JSON.stringify(mine.rows.slice(0, 3)));

    /* 12 stranger */
    const sMarks = await readMark(stranger, E1.entry_id);
    const sThread = await call(stranger, 'GET', '/api/marks/' + thread + '/messages');
    const sSet = await call(stranger, 'POST', '/api/marks', { body: mk(E1.entry_id, 'checked') });
    const sReply = await call(stranger, 'POST', '/api/marks/' + thread + '/messages', { body: { message_text: 'hello' } });
    ok('12 the stranger store: marks null, M1\'s thread 404 (same as unknown), cannot set (403), cannot reply (404)', sMarks && sMarks[E1.entry_id] === null && sThread.status === 404 && code(sThread) === 'MARK_THREAD_NOT_FOUND' && sSet.status === 403 && sReply.status === 404, JSON.stringify([sMarks, sThread.status, sSet.status, sReply.status]));
    const unknownThread = await call(owner, 'GET', '/api/marks/' + crypto.randomUUID() + '/messages');
    ok('12b an unknown thread reads the same 404 as M1\'s thread read by a stranger', unknownThread.status === 404 && code(unknownThread) === code(sThread));
    const foreignSet = await asAud('POST', '/api/marks', mk(crypto.randomUUID(), 'checked'));
    ok('12c a record id that is not these books\': 404 MARK_SUBJECT_NOT_FOUND, no row', foreignSet.status === 404 && code(foreignSet) === 'MARK_SUBJECT_NOT_FOUND', JSON.stringify(foreignSet));
    const noGrantHeader = await call(U, 'POST', '/api/marks', { member: M3.id, role: 'auditor', body: mk(E1.entry_id, 'checked') });
    ok('12d the auditor firm has no grant from M3: 403 and no row', noGrantHeader.status === 403 && (await marksOf(M3)) === 0, JSON.stringify(noGrantHeader));

    /* 13 critic c */
    const calls = (sql, params, who) => withEntity(who, (h) => h.query(sql, params));
    const fnSql = `SELECT * FROM review_mark_set($1::uuid, 'acc.audit', $2, 'checked', 'clear', NULL, '{"v":1,"fields":["successor_id"],"hash":"x"}'::jsonb, 'successor', $3::uuid, 'U', $4::uuid, 'P', 'grant:auditor', 'grant', $5, NULL)`;
    const liveGrant = gA.body.grant_id;
    let liveOk = null;
    try { liveOk = await calls(fnSql, [M1.id, E2.entry_id, U.identity_id, P.id, liveGrant], P.id); } catch (e) { liveOk = e; }
    ok('13a the function takes a LIVE grant (a direct call as the firm\'s own session)', liveOk && liveOk.rows && liveOk.rows.length === 1, liveOk && liveOk.message);
    let forged = null;
    try { await calls(fnSql, [M1.id, E2.entry_id, U.identity_id, P.id, liveGrant], M3.id); } catch (e) { forged = e; }
    ok('13b a claimed writer that is not the session\'s entity is refused (42501)', !!forged && forged.code === '42501', forged && forged.message);
    let ownerForge = null;
    try { await calls(fnSql.replace("'grant', $5", "'self', $5"), [M1.id, E2.entry_id, U.identity_id, M1.id, null], M1.id); } catch (e) { ownerForge = e; }
    ok('13c the owner cannot forge the auditor\'s mark through the function (via self with a grant policy: 42501)', !!ownerForge && ownerForge.code === '42501', ownerForge && ownerForge.message);
    const rv = await call(owner, 'POST', '/api/books-grants/' + liveGrant + '/revoke', { body: {} });
    const n13 = await marksOf(M1);
    const afterRevoke = await asAud('POST', '/api/marks', mk(E2.entry_id, 'query', 'after the revoke'));
    ok('13d the grant revoked: the auditor\'s press is 403 BOOKS_GRANT_ENDED and writes no row', rv.status === 200 && afterRevoke.status === 403 && code(afterRevoke) === 'BOOKS_GRANT_ENDED' && (await marksOf(M1)) === n13, JSON.stringify([rv.status, afterRevoke]));
    let revokedFn = null;
    try { await calls(fnSql, [M1.id, E2.entry_id, U.identity_id, P.id, liveGrant], P.id); } catch (e) { revokedFn = e; }
    ok('13e the DATABASE FUNCTION refuses the revoked grant too, not only the route (42501)', !!revokedFn && revokedFn.code === '42501' && (await marksOf(M1)) === n13, revokedFn && revokedFn.message);
    const readAfter = await asAud('GET', '/api/marks?adopter=acc.audit&ids=' + E2.entry_id);
    ok('13f and the auditor can no longer read either (the same look)', readAfter.status === 403, JSON.stringify(readAfter));
  } finally {
    server.close();
    console.log('TRIPS ' + JSON.stringify(TRIPS));
    if (process.env.MARK_CAPTURE_OUT) require('fs').writeFileSync(process.env.MARK_CAPTURE_OUT, JSON.stringify(RECORDED));
  }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('CRASH', e); process.exit(1); });
