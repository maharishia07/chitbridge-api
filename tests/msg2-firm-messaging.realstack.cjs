'use strict';
const { shopToday, shopDayAt } = require('./lib/shop-day.cjs'); /* the shop's own day, never the UTC day (tzsweep) */
/**
 * tests/msg2-firm-messaging.realstack.cjs — FIRM MESSAGING slices D (colleague bell) and A (the firm's own thread on a note) on a REAL Postgres through the REAL sign-in (middleware/auth is NOT replaced; every call carries a signed token).
 * Needs b868, b870, b876 and b877 applied (tools/fresh-db-check.cjs builds all of them).
 * HAND-COMPUTED (REQ-FIRM-MESSAGING eb21449b section 7 + critic 5a0a9b37 tests 21 to 28). Firm P has: aud1 (auditor seat), acct1 (adviser seat), a "late" colleague who never opens the bell, a seatless login, and the partner (the owner login).
 *   Client C (books on, grants the auditor and the adviser of P), client K and firm F2 (no grant), C's cashier.
 *   A  1 aud1 writes a My-firm note on entry E1, acct1 replies, aud1 replies: P holds 1 flag and 2 flag messages; the thread reads in order.
 *      2 C, K, F2: 0 flag messages and 0 private_flag rows BY THE DATABASE in their own session, the thread is a 404 at the api, no flag row in C's bell or inbox.
 *      5 an Only-me note takes no reply (the writer is refused in words; the colleague cannot see it: 404); 0 messages in the database.
 *      6 a shared Query and the internal thread on one entry stay two threads: C's mark messages are unchanged by the internal replies.
 *     24 remove: the replies' words are blank at the database (0 non-blank), who and when stay (2 rows).  25 a flag message as 'external' or in another organisation: refused by the database.
 *     26 a seatless login of the firm: 404 at the api and no internal notice.  28 a reply on a resolved note is refused in words; after it is opened again it is accepted.
 *   D 14 acct1 replies in a mark thread aud1 raised: aud1 rings, the partner rings, acct1 does not.  15 aud1 opens the bell: aud1 badge 0, acct1 and the partner keep theirs.
 *     16 a pre-change row (no person) rings nobody of the firm.  17 a blank actor gets no internal row.  21 a person who never opened the bell shows the organisation's mark, not the full feed.
 *     22 a shop: the cashier opens the bell, the owner's badge is unchanged.  23 the badge number equals the fresh rows of the feed, for three persons.  19 the notice names the client.
 * Run: DATABASE_URL=postgres://cb_app:...@db:5432/<scratch built by tools/fresh-db-check.cjs> node tests/msg2-firm-messaging.realstack.cjs
 * CARD      22-channels-capture-and-messaging/notifications-and-the-bell
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.CB_TRIPS = '1'; /* the round trips of the new flag routes and the bell are measured here (X-DB-Trips) for round-trips.budget.json */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'msg2_realauth_secret_at_least_32_chars_padding';
const path = require('path');
const express = require('express');
const jsonWebToken = require('jsonwebtoken');
const API = path.join(__dirname, '..');
const net = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));
const reqctx = require(path.join(API, 'lib', 'reqctx'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 600) : '')); } };
const RUN = 'm2f' + (Date.now() % 1e10).toString(36);
const madeIdentities = [];
const tokenFor = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'Msg2 ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  madeIdentities.push(identity.identity_id);
  return { tag, bridgeId, id: identity.identity_id, name: identity.display_name, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
const ownerToken = (biz) => tokenFor({ identity_id: biz.id, identity_type: 'entity', bridge_id: biz.bridgeId, display_name: biz.name });
async function person(biz, tag, level, whole) {
  const { rows: [row] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, $6, true, 'act') RETURNING identity_id, display_name`, [biz.bridgeId + tag, 'Person ' + tag + ' ' + RUN, biz.id, (biz.bridgeId + tag).toLowerCase(), level, whole !== false]);
  madeIdentities.push(row.identity_id);
  return { id: row.identity_id, biz, token: tokenFor({ identity_id: row.identity_id, identity_type: 'actor', bridge_id: biz.bridgeId, display_name: row.display_name, parent_entity_id: biz.id }) };
}
let base = '';
const TRIPS = {}; /* the dearest successful call of each route */
async function call(token, method, route, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (o.member) headers['x-books-for'] = o.member;
  if (o.role) headers['x-books-role'] = o.role;
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  if (res.status < 300 && res.headers.get('x-db-trips')) { const k = method + ' ' + route.replace(/[0-9]+/g, ':n').split('?')[0]; TRIPS[k] = Math.max(TRIPS[k] || 0, Number(res.headers.get('x-db-trips'))); }
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}
/** a DB count in a party's OWN session: the organisation bound, the person set (as the api does for a request) */
const countIn = (entityId, actorId, sql, args) => reqctx.runWithActor(actorId || null, () => withEntity(entityId, (db) => db.query(sql, args || []))).then((r) => Number(r.rows[0].n));
const rowsOf = (bell) => ((bell && bell.notifications) || []);
const noteRows = (bell) => rowsOf(bell).filter((x) => x.action === 'note_reply');
const markReplies = (bell) => rowsOf(bell).filter((x) => x.action === 'mark_reply');
const badge = async (who) => (await call(who.token || who, 'GET', '/api/notifications?count=1')).body || {};
const feed = async (who) => (await call(who.token || who, 'GET', '/api/notifications')).body || {};

async function main() {
  const P = await business('p'), C = await business('c'), K = await business('k'), F2 = await business('f');
  for (const [parent, child] of [[P, C]]) { const asked = await net.requestConnect({ parentId: parent.node.id, childId: child.node.id }, parent.node); await net.approve({ edgeId: asked.id }, child.node); }
  const aud1 = await person(P, 'a', 'commenter'), acct1 = await person(P, 'b', 'editor'), late = await person(P, 'l', 'commenter'), seatless = await person(P, 's', 'viewer', false);
  const cashier = await person(C, 'x', 'viewer', false), f2staff = await person(F2, 'z', 'editor');
  const partner = ownerTokenOf(P), cOwner = ownerTokenOf(C), kOwner = ownerTokenOf(K), f2Owner = ownerTokenOf(F2);
  function ownerTokenOf(biz) { return { token: ownerToken(biz), id: biz.id }; }
  const app = express();
  app.use(require(path.join(API, 'lib', 'trips')).middleware());
  app.use(express.json());
  for (const [mount, file] of [['/api/books', 'books.js'], ['/api/books-grants', 'books-grants.js'], ['/api/marks', 'marks.js'], ['/api/notifications', 'notifications.js'], ['/api/folders', 'folders.js'], ['/api/flags', 'flags.js']]) app.use(mount, require(path.join(API, 'routes', file)));
  app.use((err, req, res, next) => res.status(500).json({ code: 'TEST_500', message: String(err && err.message) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    await withEntity(C.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, C.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, C.id));
    const on = await call(cOwner.token, 'POST', '/api/books/enable', { body: {} });
    const gA = await call(cOwner.token, 'POST', '/api/books-grants', { body: { grantee: P.id, purpose: 'audit of the books', consent: true } });
    const gV = await call(cOwner.token, 'POST', '/api/books-grants', { body: { grantee: P.id, purpose: 'adviser of the books', consent: true, preset: 'adviser', posting: 'owner_approves' } });
    ok('0 client C: ledger on, P holds an auditor grant and an adviser grant', on.status === 200 && gA.status === 201 && gV.status === 201, JSON.stringify([on.status, gA.status, gV.status]));
    const accounts = (await call(cOwner.token, 'GET', '/api/books/accounts')).body;
    const list = accounts.accounts || accounts.rows || accounts || [];
    const cash = (list.find((a) => /cash/i.test(a.name || '')) || {}).code || '1000';
    const sales = (list.find((a) => /^sales/i.test(a.name || '')) || {}).code || '4000';
    const day = shopToday();
    const entry = async (ref) => (await call(cOwner.token, 'POST', '/api/books/entries', { body: { narration: 'msg2 ' + RUN + ref, date: day, client_ref: RUN + ref, lines: [{ code: cash, dr_minor: 10000 }, { code: sales, cr_minor: 10000 }] } })).body;
    const E1 = await entry('e1'), E2 = await entry('e2');
    const noteBody = (entryRow, text, visibility) => ({ kind: 'note', visibility: visibility || 'org', subject_kind: 'posting', subject_entity: C.id, items: [{ id: entryRow.entry_id, label: entryRow.entry_no + ' · test' }], note: text });

    // ── A · the firm's own thread ──
    const w = await call(aud1.token, 'POST', '/api/flags', { body: noteBody(E1, 'Check the cash bank slip before sign-off') });
    const flagId = w.body && w.body.flags && w.body.flags[0] && w.body.flags[0].flag_id;
    ok('A1a aud1 writes a My-firm note on E1: 201', w.status === 201 && !!flagId, JSON.stringify(w));
    const markMsgsBefore = await countIn(C.id, null, `SELECT count(*)::int AS n FROM chit_messages WHERE subject_type = 'mark'`);
    const r1 = await call(acct1.token, 'POST', '/api/flags/' + flagId + '/messages', { body: { message_text: 'I will ring the client on Monday.' } });
    const r2 = await call(aud1.token, 'POST', '/api/flags/' + flagId + '/messages', { body: { message_text: 'Thanks, noted.' } });
    ok('A1b acct1 and then aud1 reply: 201 and 201', r1.status === 201 && r2.status === 201, JSON.stringify([r1.status, r1.body, r2.status, r2.body]));
    const th = await call(acct1.token, 'GET', '/api/flags/' + flagId + '/messages');
    ok('A1c acct1 reads the thread: two replies in order, mine marked, reply may be done', th.status === 200 && th.body.messages.length === 2 && th.body.messages[0].text.startsWith('I will ring') && th.body.messages[0].mine === true && th.body.messages[1].mine === false && th.body.may.reply.ok === true, JSON.stringify(th.body).slice(0, 500));
    ok('A1d the database: P holds 1 flag and 2 flag messages, both stamped with a person', (await countIn(P.id, aud1.id, `SELECT count(*)::int AS n FROM private_flag WHERE kind = 'note' AND visibility = 'org'`)) === 1 && (await countIn(P.id, aud1.id, `SELECT count(*)::int AS n FROM chit_messages WHERE subject_type = 'flag' AND sender_identity_id IS NOT NULL`)) === 2);
    ok('A1e the person is the SESSION\'s: the first reply carries acct1\'s id, never a body\'s', (await countIn(P.id, acct1.id, `SELECT count(*)::int AS n FROM chit_messages WHERE subject_type = 'flag' AND sender_identity_id = $1::uuid AND message_text LIKE 'I will ring%'`, [acct1.id])) === 1);
    const forged = await call(acct1.token, 'POST', '/api/flags/' + flagId + '/messages', { body: { message_text: 'forged', sender_identity_id: aud1.id } });
    ok('A1f a body naming another person is refused (strict input)', forged.status === 400 || forged.status === 422, JSON.stringify(forged).slice(0, 200));
    ok('A6 the shared Query side is unchanged by the internal replies: C\'s mark messages count the same', (await countIn(C.id, null, `SELECT count(*)::int AS n FROM chit_messages WHERE subject_type = 'mark'`)) === markMsgsBefore);

    // who hears the internal thread
    const aBell = noteRows(await feed(aud1)), bBell = noteRows(await feed(acct1)), pBell = noteRows(await feed(partner)), sBell = noteRows(await feed(seatless)), lBell = noteRows(await feed(late));
    ok('D-A aud1 (the author) hears acct1\'s reply, not her own words', aBell.length === 1 && /ring the client/.test(aBell[0].detail || '') && !aBell.some((x) => /Thanks, noted/.test(x.detail || '')), JSON.stringify(aBell));
    ok('D-A acct1 (replied) hears aud1\'s reply only; the partner (owner login) hears both; the seatless and the unrelated colleague hear none', bBell.length === 1 && /Thanks, noted/.test(bBell[0].detail || '') && pBell.length === 2 && sBell.length === 0 && lBell.length === 0, JSON.stringify([bBell.length, pBell.length, sBell.length, lBell.length]));
    ok('D-A the notice words the client and the record: label carried, no entry text read from the client\'s books', pBell[0].mark_entry && /test/.test(pBell[0].mark_entry.label || '') && pBell[0].action === 'note_reply', JSON.stringify(pBell[0]));

    // the function's own gate: p_internal false gives even the owner login no internal row; true gives it both
    const gateOff = await countIn(P.id, partner.id, `SELECT count(*)::int AS n FROM mark_notices(90, 50, false) WHERE notice_kind = 'internal'`);
    const gateOn = await countIn(P.id, partner.id, `SELECT count(*)::int AS n FROM mark_notices(90, 50, true) WHERE notice_kind = 'internal'`);
    ok('D-A5 the own gate of the function: p_internal false = 0 internal rows even for the owner login, true = 2', gateOff === 0 && gateOn === 2, JSON.stringify([gateOff, gateOn]));

    // 2 and 3 · nobody else reads it
    const cList = await call(cOwner.token, 'GET', '/api/flags'), cThread = await call(cOwner.token, 'GET', '/api/flags/' + flagId + '/messages'), cReply = await call(cOwner.token, 'POST', '/api/flags/' + flagId + '/messages', { body: { message_text: 'let me in' } });
    ok('A2a C: the flag list holds none, the thread is a 404, a reply is a 404', cList.status === 200 && cList.body.total === 0 && cThread.status === 404 && cReply.status === 404, JSON.stringify([cList.status, cThread.status, cReply.status]));
    for (const [who, label] of [[C.id, 'C'], [K.id, 'K'], [F2.id, 'F2']]) {
      const msgs = await countIn(who, who === C.id ? cOwner.id : who === K.id ? kOwner.id : f2Owner.id, `SELECT count(*)::int AS n FROM chit_messages WHERE subject_type = 'flag'`);
      const flags = await countIn(who, who === C.id ? cOwner.id : who === K.id ? kOwner.id : f2Owner.id, `SELECT count(*)::int AS n FROM private_flag`);
      ok('A2b/A3 ' + label + ': flag messages 0 and private_flag rows 0 BY THE DATABASE in its own session', msgs === 0 && flags === 0, JSON.stringify([msgs, flags]));
    }
    const kThread = await call(kOwner.token, 'GET', '/api/flags/' + flagId + '/messages'), f2Thread = await call(f2Owner.token, 'GET', '/api/flags/' + flagId + '/messages'), f2sThread = await call(f2staff.token, 'POST', '/api/flags/' + flagId + '/messages', { body: { message_text: 'x' } });
    ok('A3 K, F2 and F2\'s staff: 404 at the api', kThread.status === 404 && f2Thread.status === 404 && f2sThread.status === 404, JSON.stringify([kThread.status, f2Thread.status, f2sThread.status]));
    const cBell = await feed(cOwner), cInbox = (await call(cOwner.token, 'GET', '/api/folders/messages?all=1')).body || {};
    ok('A2c C: no internal row in the bell, no flag message in the Messages inbox', noteRows(cBell).length === 0 && !JSON.stringify(cInbox).includes('ring the client') && !(cInbox.messages || []).some((m) => m.subject_type === 'flag'), JSON.stringify(cInbox).slice(0, 200));
    const seatlessThread = await call(seatless.token, 'GET', '/api/flags/' + flagId + '/messages'), seatlessReply = await call(seatless.token, 'POST', '/api/flags/' + flagId + '/messages', { body: { message_text: 'x' } });
    ok('A26 a seatless login of the firm: 404 on the thread and on a reply, and no internal notice (above)', seatlessThread.status === 404 && seatlessReply.status === 404, JSON.stringify([seatlessThread.status, seatlessReply.status]));
    const mid = await countIn(P.id, null, `SELECT count(*)::int AS n FROM mark_notices(90, 50, true) WHERE notice_kind = 'internal'`);
    ok('D17 a blank actor (a job) gets no internal row, even when the caller says internal', mid === 0, mid);

    // 5 · Only me
    const me = await call(aud1.token, 'POST', '/api/flags', { body: noteBody(E2, 'Only for my own memory', 'me') });
    const meId = me.body && me.body.flags && me.body.flags[0] && me.body.flags[0].flag_id;
    const meSelf = await call(aud1.token, 'POST', '/api/flags/' + meId + '/messages', { body: { message_text: 'talking to myself' } });
    const meColleague = await call(acct1.token, 'POST', '/api/flags/' + meId + '/messages', { body: { message_text: 'can I?' } });
    const meCount = await countIn(P.id, aud1.id, `SELECT count(*)::int AS n FROM chit_messages m WHERE m.subject_type = 'flag' AND m.subject_id = (SELECT thread_id FROM private_flag WHERE flag_id = $1::bigint)`, [meId]);
    const meSeen = await countIn(P.id, acct1.id, `SELECT count(*)::int AS n FROM private_flag WHERE visibility = 'me'`);
    ok('A5 an Only-me note: the writer is refused in words (409), the colleague gets a 404, 0 messages, and the colleague\'s database session sees 0 Only-me rows', meSelf.status === 409 && /no replies/i.test(JSON.stringify(meSelf.body)) && meColleague.status === 404 && meCount === 0 && meSeen === 0, JSON.stringify([meSelf, meColleague.status, meCount, meSeen]));

    // a reply FORCED into the Only-me thread at the database (the api refuses it): the bell arm restates the visibility wall, so the owner login is not rung by it
    const meThread = (await reqctx.runWithActor(aud1.id, () => withEntity(P.id, (db) => db.query(`SELECT thread_id::text AS t FROM private_flag WHERE flag_id = $1::bigint`, [meId])))).rows[0].t;
    await reqctx.runWithActor(aud1.id, () => withEntity(P.id, (db) => db.query(`INSERT INTO chit_messages (entity_id, chit_id, subject_type, subject_id, sender_entity_id, sender_display_name, thread_type, message_text) VALUES ($1, NULL, 'flag', $2::uuid, $1, 'forced', 'internal', 'forced into an Only-me thread')`, [P.id, meThread])));
    ok('A5b a reply forced into an Only-me thread at the database rings nobody (the bell arm names visibility org)', noteRows(await feed(partner)).every((x) => !/forced/.test(x.detail || '')) && noteRows(await feed(partner)).length === 2, JSON.stringify(noteRows(await feed(partner))).slice(0, 300));

    // 28 · resolved / reopen
    const resolved = await call(aud1.token, 'POST', '/api/flags/' + flagId + '/resolve');
    const onResolved = await call(acct1.token, 'POST', '/api/flags/' + flagId + '/messages', { body: { message_text: 'after resolve' } });
    const thResolved = await call(acct1.token, 'GET', '/api/flags/' + flagId + '/messages');
    const reopened = await call(aud1.token, 'POST', '/api/flags/' + flagId + '/reopen');
    const afterOpen = await call(acct1.token, 'POST', '/api/flags/' + flagId + '/messages', { body: { message_text: 'after reopening' } });
    ok('A28 resolved: a reply is refused in words (409) and the thread says so; opened again: accepted', resolved.status === 200 && onResolved.status === 409 && /resolved/i.test(JSON.stringify(onResolved.body)) && thResolved.body.may.reply.ok === false && reopened.status === 200 && afterOpen.status === 201, JSON.stringify([resolved.status, onResolved.status, onResolved.body, reopened.status, afterOpen.status]));

    // D · the colleague bell on a mark thread
    const q = await call(aud1.token, 'POST', '/api/marks', { member: C.id, role: 'auditor', body: { adopter: 'acc.audit', subject_id: E1.entry_id, kind: 'query', note: 'Which bank took this cash?' } });
    const thread = q.body && q.body.mark && q.body.mark.thread_id;
    ok('D0 aud1 raises a Query on E1: 201', q.status === 201 && !!thread, JSON.stringify(q));
    const cReplied = await call(cOwner.token, 'POST', '/api/marks/' + thread + '/messages', { body: { message_text: 'Cash in hand, banked on Monday.' } });
    ok('D0b the owner of C replies: 201', cReplied.status === 201, JSON.stringify(cReplied));
    // a row from BEFORE the change: no person on it (written with no actor set), from the firm's side
    await withEntity(C.id, (db) => db.query(`INSERT INTO chit_messages (entity_id, chit_id, subject_type, subject_id, sender_entity_id, sender_display_name, thread_type, message_text) VALUES ($1, NULL, 'mark', $2::uuid, $3, 'Old colleague', 'external', 'a pre-change colleague reply')`, [C.id, thread, P.id]));
    const baseA = await badge(aud1), baseB = await badge(acct1), baseP = await badge(partner), baseL = await badge(late);
    const rb = await call(acct1.token, 'POST', '/api/marks/' + thread + '/messages', { member: C.id, role: 'adviser', body: { message_text: 'Deposit slip is on file.' } });
    ok('D14a acct1 replies in the mark thread under the adviser door: 201', rb.status === 201, JSON.stringify(rb));
    const afterA = await badge(aud1), afterB = await badge(acct1), afterP = await badge(partner), afterL = await badge(late);
    const bellA = await feed(aud1), bellB = await feed(acct1), bellP = await feed(partner), bellL = await feed(late);
    ok('D14b the colleague\'s reply rings aud1 (+1) and the partner (+1), and not acct1 (+0, her own words)', afterA.count === baseA.count + 1 && afterP.count === baseP.count + 1 && afterB.count === baseB.count, JSON.stringify([baseA, afterA, baseP, afterP, baseB, afterB]));
    ok('D14c aud1\'s bell holds the Deposit slip row; acct1\'s bell does not hold her own words', markReplies(bellA).some((x) => /Deposit slip/.test(x.detail || '')) && !markReplies(bellB).some((x) => /Deposit slip/.test(x.detail || '')), JSON.stringify(markReplies(bellB)).slice(0, 300));
    ok('D14d a colleague not in the thread (late) is not rung by it', afterL.count === baseL.count && !markReplies(bellL).some((x) => /Deposit slip/.test(x.detail || '')), JSON.stringify([baseL, afterL]));
    ok('D16 the pre-change row (no person) rings nobody of the firm', ![bellA, bellB, bellP].some((b) => markReplies(b).some((x) => /pre-change colleague/.test(x.detail || ''))), 'a pre-change row rang');
    ok('D19 the notice names the client', markReplies(bellA).concat(markReplies(bellP)).filter((x) => /Deposit slip|banked/.test(x.detail || '')).every((x) => x.mark_client === C.name), JSON.stringify(markReplies(bellA)).slice(0, 400));
    ok('D19b the notice carries the client entity id beside its name (mark_client_id = the client, never a name look-up)', markReplies(bellA).concat(markReplies(bellP)).filter((x) => /Deposit slip|banked/.test(x.detail || '')).every((x) => x.mark_client_id === C.id), JSON.stringify(markReplies(bellA)).slice(0, 400));
    for (const [who, label, bell, count] of [[aud1, 'aud1', bellA, afterA], [acct1, 'acct1', bellB, afterB], [partner, 'the partner', bellP, afterP]]) {
      const fresh = (bell.notifications || []).filter((n) => !bell.seen_at || new Date(n.created_at) > new Date(bell.seen_at)).filter((n) => n.action !== 'message_sent').length;
      ok('D23 badge number = fresh rows in the feed for ' + label, count.count === fresh && bell.count === fresh, JSON.stringify([count.count, fresh, bell.count]));
    }

    // 15 · one colleague opening the bell does not clear another's
    const seenA = await call(aud1.token, 'POST', '/api/notifications/seen');
    const a15 = await badge(aud1), b15 = await badge(acct1), p15 = await badge(partner);
    ok('D15 aud1 opens the bell: aud1 0, acct1 and the partner keep their badges', seenA.status === 200 && a15.count === 0 && b15.count === afterB.count && p15.count === afterP.count && p15.count > 0, JSON.stringify([a15.count, b15.count, afterB.count, p15.count]));
    ok('D15b aud1\'s person mark is on aud1\'s own row, not the organisation\'s', (await countIn(P.id, aud1.id, `SELECT count(*)::int AS n FROM identities WHERE identity_id = $1::uuid AND notif_seen_at IS NOT NULL`, [aud1.id])) === 1 && (await countIn(P.id, aud1.id, `SELECT count(*)::int AS n FROM identities WHERE identity_id = $1::uuid AND notif_seen_at IS NOT NULL`, [P.id])) === 0);

    // 21 · landing day: a person who never opened the bell shows the organisation's mark, not the full feed
    const lateBefore = await badge(late);
    const seenP = await call(partner.token, 'POST', '/api/notifications/seen');
    const lateAfter = await badge(late), lateFeed = await feed(late);
    ok('D21 landing day: after the organisation\'s mark moved, `late` (who never opened) shows 0 fresh although the feed holds rows', lateBefore.count > 0 && seenP.status === 200 && lateAfter.count === 0 && lateFeed.notifications.length > 0, JSON.stringify([lateBefore.count, lateAfter.count, lateFeed.notifications.length]));

    // 22 · a shop: the cashier opens the bell, the owner's badge is unchanged
    const ownerC0 = await badge(cOwner), cashC0 = await badge(cashier);
    const seenC = await call(cashier.token, 'POST', '/api/notifications/seen');
    const ownerC1 = await badge(cOwner), cashC1 = await badge(cashier);
    ok('D22 a shop: the cashier opens the bell (her badge 0); the owner\'s badge is unchanged', ownerC0.count > 0 && seenC.status === 200 && cashC1.count === 0 && ownerC1.count === ownerC0.count, JSON.stringify([ownerC0.count, cashC0.count, cashC1.count, ownerC1.count]));

    // 24 · removal blanks the replies, who and when stay
    const rm = await call(aud1.token, 'POST', '/api/flags/' + flagId + '/remove');
    const nonBlank = await countIn(P.id, aud1.id, `SELECT count(*)::int AS n FROM chit_messages m WHERE m.subject_type = 'flag' AND m.subject_id = (SELECT thread_id FROM private_flag WHERE flag_id = $1::bigint) AND btrim(m.message_text) <> ''`, [flagId]);
    const kept = await countIn(P.id, aud1.id, `SELECT count(*)::int AS n FROM chit_messages m WHERE m.subject_type = 'flag' AND m.subject_id = (SELECT thread_id FROM private_flag WHERE flag_id = $1::bigint) AND m.sender_identity_id IS NOT NULL AND m.sender_display_name <> ''`, [flagId]);
    const thGone = await call(acct1.token, 'GET', '/api/flags/' + flagId + '/messages'), replyGone = await call(acct1.token, 'POST', '/api/flags/' + flagId + '/messages', { body: { message_text: 'too late' } });
    const afterRemoveBell = noteRows(await feed(partner));
    ok('A24 remove: 0 non-blank replies at the database, the rows (who, when) stay, no reply taken, no internal notice of it', rm.status === 200 && nonBlank === 0 && kept >= 3 && replyGone.status === 409 && afterRemoveBell.length === 0 && thGone.body.messages.every((m) => m.text === ''), JSON.stringify([rm.status, nonBlank, kept, replyGone.status, afterRemoveBell.length]));

    // 25 · the database's own wall
    const insert = (entityId, senderEntity, thread) => withEntity(P.id, (db) => db.query(`INSERT INTO chit_messages (entity_id, chit_id, subject_type, subject_id, sender_entity_id, sender_display_name, thread_type, message_text) VALUES ($1::uuid, NULL, 'flag', gen_random_uuid(), $2::uuid, 'x', $3, 'wall test')`, [entityId, senderEntity, thread])).then(() => 'inserted', (e) => e.code);
    const asExternal = await insert(P.id, P.id, 'external'), otherOrg = await insert(C.id, P.id, 'internal'), foreignSender = await insert(P.id, C.id, 'internal');
    console.log('  trips ' + JSON.stringify(TRIPS));
    ok('A25 a flag message as external, in another organisation, or sent by another organisation is refused by the database (23514 / 42501)', asExternal === '23514' && ['23514', '42501'].includes(otherOrg) && foreignSender === '23514', JSON.stringify([asExternal, otherOrg, foreignSender]));
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
  console.log('\n── FIRM MESSAGING D + A through the REAL sign-in (cb_app, RLS on) · run ' + RUN + ' ──');
  try { await main(); } catch (e) { ok('the run reached its end', false, e && e.stack); } finally { await cleanup().catch((e) => console.log('  note  the throwaway businesses stay: ' + (e && e.code))); }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
