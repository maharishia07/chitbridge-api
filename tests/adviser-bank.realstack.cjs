'use strict';
const { shopToday, shopDayAt } = require('./lib/shop-day.cjs'); /* the shop's own day, never the UTC day (tzsweep) */
/**
 * tests/adviser-bank.realstack.cjs — l16 adviser-bank: an ADVISER firm's person reconciles the client's bank through the ONE Bank page's doors, on a REAL Postgres as cb_app (RLS on), through the real routes
 * (routes/books.js, routes/books-grants.js) and the real grant front (middleware/books-grant.js). Only the sign-in is a stand-in (a header names who calls; the person's row is read every request, as acc-176b).
 * Migrations b863, b864, b866 and b871 must be applied (fresh-db step, or the box copy + the files).
 * HAND-COMPUTED  AU shop M1 (GST regular, AUD), firm P with person A (editor, whole entity) and U (auditor preset); P holds an ADVISER grant (adviser_posts) and an AUDITOR grant on M1; M2: adviser grant owner_approves; M3: adviser_posts with a cap; M4: adviser_posts then revoked.
 *   Every line is an account fee of 10.00 (1000 minor), ref bank:<24 hex>-<n>.
 *   1 adviser reads bank/log and bank/rail: 200.  2 adviser POST events (expense): 200, ONE entry, created_by A, grant_id set, by_name A, by_firm P.  3 marks + a signed statement: 201, rows carry by_name/by_firm/for_client.
 *   4 the OWNER reads the log: marks, statement and posted[] name A and P; the Day book entry says posted_by {A, P}; the owner's looks show POST /events, and ONE books_delegated_first record.
 *   5 the auditor: bank/log 403 GRANT_ROUTE_NOT_LISTED; marks, statements, events, payments 403 GRANT_READ_ONLY; nothing posted.  6 an event that is no bank line (capital; a party; no bank: ref): 403 not listed; nothing posted.
 *   7 owner_approves: reads 200, every write 403 ADVISER_POSTING_NOT_ALLOWED.  8 a cap: 403 ADVISER_POSTING_CAPPED.  9 revoked: 403 BOOKS_GRANT_ENDED.
 *   10 a month locked by the owner: the adviser's line is refused with the owner's own words (same code, same sentence).  11 a body that names by/at: refused.  12 the owner's own mark has no firm.
 * Run: DATABASE_URL=postgres://cb_app:...@<db host>/<throwaway db> node tests/adviser-bank.realstack.cjs   (a SIT box's throwaway database only; the guard below refuses anything else)
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'adviserbank_test_secret_at_least_32_chars_pad';
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
const RUN = 'ab' + (Date.now() % 1e10).toString(36);
const code = (r) => r.body && r.body.code;

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query("INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'AU', 'AUD', $3) RETURNING identity_id, display_name", [bridgeId, 'AdvBank ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  return { tag, bridgeId, id: identity.identity_id, name: identity.display_name, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
async function join(parent, member) {
  const asked = await net.requestConnect({ parentId: parent.node.id, childId: member.node.id }, parent.node);
  await net.approve({ edgeId: asked.id }, member.node);
}
const ownerOf = (biz) => ({ identity_id: biz.id, bridge_id: biz.bridgeId, identity_type: 'entity', parent_entity_id: null, display_name: biz.name });
async function person(biz, tag, level) {
  const { rows: [row] } = await query("INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'AU', 'AUD', $4, $5, true, true, 'act') RETURNING identity_id, display_name", [biz.bridgeId + tag, 'Person ' + tag + ' ' + RUN, biz.id, (biz.bridgeId + tag).toLowerCase(), level]);
  return { identity_id: row.identity_id, identity_type: 'actor', parent_entity_id: biz.id, bridge_id: biz.bridgeId, display_name: row.display_name };
}
let base = '';
async function call(who, method, route, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json', 'x-test-as': JSON.stringify(who), 'idempotency-key': 'ab-' + crypto.randomUUID() };
  if (o.member) headers['x-books-for'] = o.member;
  if (o.role) headers['x-books-role'] = o.role;
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}
const give = (P, M, extra) => call(ownerOf(M), 'POST', '/api/books-grants', { body: Object.assign({ grantee: P.id, purpose: 'bank reconciliation', consent: true }, extra) });
const adv = (who, M, method, route, body) => call(who, method, '/api/books' + route, { member: M.id, role: 'adviser', body });
const day = shopToday();
const FP = (RUN.replace(/[^0-9a-f]/g, 'a') + 'a'.repeat(24)).slice(0, 24);
const ref = (n) => 'bank:' + FP + '-' + n;
const fee = (n, extra) => Object.assign({ kind: 'expense', class: 'bank_charges', date: day, amount_minor: 1000, narration: 'Account fee ' + n, paid_from: 'bank', client_ref: ref(n) }, extra);
const entries = (M, like) => withEntity(M.id, (h) => h.query('SELECT entry_id, created_by, grant_id, by_name, by_firm, source_ref FROM journal_entry WHERE entity_id = $1 AND source_ref LIKE $2', [M.id, like])).then((r) => r.rows);

async function ledgerOn(M) {
  await withEntity(M.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, M.id, { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: true, number: '51824753556', scheme: 'regular' }, source: { tax: 'typed' } }, M.id));
  const on = await call(ownerOf(M), 'POST', '/api/books/enable', { body: {} });
  ok('the ledger of ' + M.tag + ' is on', on.status === 200, JSON.stringify(on));
}
const bankCodeOf = async (M) => { const a = (await call(ownerOf(M), 'GET', '/api/books/accounts')).body; const l = a.accounts || a.rows || a; return (l.find((x) => x.role === 'bank') || {}).code; };

async function main() {
  const P = await business('p'); const M1 = await business('1'); const M2 = await business('2'); const M3 = await business('3'); const M4 = await business('4');
  for (const M of [M1, M2, M3, M4]) await join(P, M);
  const A = await person(P, 'a', 'editor'); const U = await person(P, 'u', 'commenter');
  const app = express();
  app.use(express.json());
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const M of [M1, M2, M3, M4]) await ledgerOn(M);
    const bank = await bankCodeOf(M1);
    const g1 = await give(P, M1, { preset: 'adviser', posting: 'adviser_posts' });
    const g1a = await give(P, M1, { preset: 'auditor' });
    const g2 = await give(P, M2, { preset: 'adviser', posting: 'owner_approves' });
    const g3 = await give(P, M3, { preset: 'adviser', posting: 'adviser_posts', posting_cap_minor: 5000, posting_cap_currency: 'AUD' });
    const g4 = await give(P, M4, { preset: 'adviser', posting: 'adviser_posts' });
    ok('grants given: M1 adviser_posts + auditor, M2 owner_approves, M3 capped, M4 adviser_posts', [g1, g1a, g2, g3, g4].every((g) => g.status === 201), JSON.stringify([g1, g1a, g2, g3, g4].map((g) => g.status + ' ' + (g.body.code || ''))));
    ok('a bank ledger exists', !!bank, bank);

    /* 1 reads */
    const log0 = await adv(A, M1, 'GET', '/bank/log?account=' + bank);
    const rail0 = await adv(A, M1, 'GET', '/bank/rail');
    ok('1 the adviser reads the bank log and the bank rail: 200', log0.status === 200 && rail0.status === 200, JSON.stringify([log0.status, rail0.status, log0.body]));

    /* 2 post a line */
    const p1 = await adv(A, M1, 'POST', '/events', fee(1));
    const e1 = await entries(M1, '%' + ref(1));
    ok('2 the adviser adds a bank line through POST /events: 200, one entry', p1.status === 200 && e1.length === 1, JSON.stringify([p1.status, p1.body, e1]));
    ok('2 the entry is created_by A, carries the grant, names A and the firm', e1.length === 1 && e1[0].created_by === A.identity_id && e1[0].grant_id === g1.body.grant_id && e1[0].by_name === A.display_name && e1[0].by_firm === P.name, JSON.stringify(e1));
    const again = await adv(A, M1, 'POST', '/events', fee(1));
    ok('2 the same client_ref again answers the first entry (duplicate), still one entry', again.status === 200 && again.body.duplicate === true && (await entries(M1, '%' + ref(1))).length === 1, JSON.stringify(again));

    /* 3 marks and statement */
    const mk = await adv(A, M1, 'POST', '/bank/marks', { account: bank, file_hash: FP, marks: [{ act: 'accept', key: ref(1), how: 'matched', ledger: [String(p1.body.entry_no)] }] });
    const st = await adv(A, M1, 'POST', '/bank/statements', { account: bank, period_from: day, period_to: day, opening_minor: 0, closing_bank_minor: -1000, closing_books_minor: -1000, difference_minor: 0, currency: 'AUD', file_hash: FP });
    ok('3 the adviser marks a line and signs the statement: 201 each, rows name A and the firm', mk.status === 201 && st.status === 201 && st.body.statement.by_name === A.display_name && st.body.statement.by_firm === P.name && mk.body.marks[0].by_firm === P.name, JSON.stringify([mk, st]));
    const spoof = await adv(A, M1, 'POST', '/bank/marks', { account: bank, file_hash: FP, by: crypto.randomUUID(), marks: [{ act: 'note', key: ref(1), text: 'x' }] });
    ok('11 a body naming `by` is refused, not stored', spoof.status >= 400 && spoof.status < 500, JSON.stringify(spoof));

    /* 4 the owner reads */
    const olog = (await call(ownerOf(M1), 'GET', '/api/books/bank/log?account=' + bank)).body;
    ok('4 the owner reads marks, the signed statement and posted[] with A and the firm', olog.marks.some((m) => m.by_name === A.display_name && m.by_firm === P.name) && olog.statements[0].by_name === A.display_name && olog.statements[0].by_firm === P.name && olog.posted.some((r) => r.ref === ref(1) && r.by_name === A.display_name && r.by_firm === P.name), JSON.stringify(olog).slice(0, 700));
    const dbk = (await call(ownerOf(M1), 'GET', '/api/books/daybook?from=' + day + '&to=' + day)).body;
    const de = (dbk.entries || []).find((x) => String(x.entry_no) === String(p1.body.entry_no));
    ok('4 the Day book entry says posted_by A, the firm', de && de.posted_by && de.posted_by.name === A.display_name && de.posted_by.firm === P.name, JSON.stringify(de));
    const looks = await grants.looks(M1.id, { limit: 200 });
    const lp = looks.filter((x) => x.preset === 'adviser' && /POST \/events/.test(x.route_pattern));
    ok('4 the owner\'s looks show POST /events by A, firm P', lp.length >= 1 && lp[0].actor_name === A.display_name && lp[0].actor_entity_name === P.name, JSON.stringify(lp.slice(0, 1)));
    const firstAlerts = await withEntity(M1.id, (h) => h.query("SELECT count(*)::int AS n FROM access_events WHERE entity_id = $1 AND action = 'books_delegated_first' AND after_value ->> 'grant_id' = $2", [M1.id, g1.body.grant_id]));
    ok('4 ONE books_delegated_first record for the grant, however many writes', firstAlerts.rows[0].n === 1, JSON.stringify(firstAlerts.rows));

    /* 5 the auditor */
    const before5 = (await entries(M1, '%')).length;
    const aud = (route, method, body) => call(U, method, '/api/books' + route, { member: M1.id, role: 'auditor', body });
    const r5 = [await aud('/bank/log?account=' + bank, 'GET'), await aud('/bank/rail', 'GET')];
    const w5 = [await aud('/bank/marks', 'POST', { account: bank, marks: [{ act: 'accept', key: ref(2) }] }), await aud('/bank/statements', 'POST', {}), await aud('/events', 'POST', fee(2)), await aud('/payments', 'POST', { party_id: crypto.randomUUID(), direction: 'in', amount_minor: 1, client_ref: ref(3) })];
    ok('5 the auditor reads the bank log (200, on GRANT_READS since audbank) but not the rail (not listed) and every bank write is GRANT_READ_ONLY; nothing posted', r5[0].status === 200 && r5[1].status === 403 && code(r5[1]) === 'GRANT_ROUTE_NOT_LISTED' && w5.every((r) => r.status === 403 && code(r) === 'GRANT_READ_ONLY') && (await entries(M1, '%')).length === before5, JSON.stringify([r5.map((r) => r.status + code(r)), w5.map((r) => r.status + code(r))]));
    const noRole = await call(U, 'POST', '/api/books/events', { member: M1.id, body: fee(2) }); /* SEC-117: U holds the AUDITOR seat */
    ok('5 the auditor-seat person with NO role header stays the auditor: 403 GRANT_READ_ONLY, nothing posted', noRole.status === 403 && code(noRole) === 'GRANT_READ_ONLY' && (await entries(M1, '%' + ref(2))).length === 0, JSON.stringify(noRole));
    const advNoRole = await call(A, 'POST', '/api/books/events', { member: M1.id, body: fee(14) }); /* SEC-117: A holds the ADVISER seat; no header = the adviser grant (adviser_posts) */
    ok('5 the adviser-seat person with NO role header works as the adviser: 200, stamped with the grant', advNoRole.status === 200 && (await entries(M1, '%' + ref(14))).length > 0 && (await entries(M1, '%' + ref(14))).every((r) => r.grant_id === g1.body.grant_id), JSON.stringify(advNoRole));

    /* 6 not a bank line */
    const bad = [await adv(A, M1, 'POST', '/events', { kind: 'capital', amount_minor: 100000, date: day, client_ref: ref(4) }), await adv(A, M1, 'POST', '/events', fee(5, { party_id: crypto.randomUUID() })), await adv(A, M1, 'POST', '/events', fee(6, { client_ref: 'free-text' })), await adv(A, M1, 'POST', '/events', fee(11, { event: 'journal' })), await adv(A, M1, 'POST', '/events', fee(12, { event: { kind: 'capital', client_ref: 'free' } })), await adv(A, M1, 'POST', '/events', fee(13, { supplier: crypto.randomUUID() })), await adv(A, M1, 'POST', '/payments', { party_id: crypto.randomUUID(), mode: 'cheque', direction: 'in', amount_minor: 1, client_ref: ref(14) }), await adv(A, M1, 'POST', '/entries', { narration: 'x', date: day, lines: [], client_ref: ref(7) }), await adv(A, M1, 'POST', '/payments', { party_id: crypto.randomUUID(), cheque: { number: '1' }, direction: 'in', amount_minor: 1, client_ref: ref(8) })];
    ok('6 a capital event, a party event, a non-bank ref, inner event/supplier overrides, a cheque-mode payment, a direct entry, a cheque payment: all 403 not listed, nothing posted', bad.every((r) => r.status === 403 && code(r) === 'GRANT_ROUTE_NOT_LISTED') && (await entries(M1, '%bank:%')).length === 1, JSON.stringify(bad.map((r) => r.status + code(r))));

    /* 7, 8, 9 policy */
    const bank2 = await bankCodeOf(M2);
    const w7 = [await adv(A, M2, 'POST', '/events', fee(1)), await adv(A, M2, 'POST', '/bank/marks', { account: bank2, file_hash: FP, marks: [{ act: 'accept', key: ref(1) }] })];
    const r7 = await adv(A, M2, 'GET', '/bank/log?account=' + bank2);
    ok('7 owner_approves: the bank log reads (200), every write is 403 ADVISER_POSTING_NOT_ALLOWED, nothing posted', r7.status === 200 && w7.every((r) => r.status === 403 && code(r) === 'ADVISER_POSTING_NOT_ALLOWED') && (await entries(M2, '%')).length === 0, JSON.stringify([r7.status, w7.map((r) => r.status + code(r))]));
    const w8 = await adv(A, M3, 'POST', '/events', fee(1));
    ok('8 a posting cap: bank writes 403 ADVISER_POSTING_CAPPED, nothing posted', w8.status === 403 && code(w8) === 'ADVISER_POSTING_CAPPED' && (await entries(M3, '%')).length === 0, JSON.stringify(w8));
    const bank4 = await bankCodeOf(M4);
    const rv = await call(ownerOf(M4), 'POST', '/api/books-grants/' + g4.body.grant_id + '/revoke', { body: {} });
    const w9 = [await adv(A, M4, 'POST', '/events', fee(1)), await adv(A, M4, 'GET', '/bank/log?account=' + bank4)];
    ok('9 a revoked grant: reads and writes 403 BOOKS_GRANT_ENDED, nothing posted', rv.status === 200 && w9.every((r) => r.status === 403 && code(r) === 'BOOKS_GRANT_ENDED') && (await entries(M4, '%')).length === 0, JSON.stringify([rv.status, w9.map((r) => r.status + code(r))]));

    /* 12 the owner's own mark carries no firm */
    const own = await call(ownerOf(M1), 'POST', '/api/books/bank/marks', { body: { account: bank, file_hash: FP, marks: [{ act: 'note', key: ref(1), text: 'owner note' }] } });
    ok('12 the owner\'s own mark: 201, no firm, no name stamped', own.status === 201 && own.body.marks[0].by_firm === null && own.body.marks[0].for_client === false, JSON.stringify(own));

    /* 10 month lock: the same words as the owner's (last: it locks the month) */
    const periods = (await call(ownerOf(M1), 'GET', '/api/books/periods')).body;
    const rows = Array.isArray(periods.periods || periods.rows || periods) ? (periods.periods || periods.rows || periods) : [];
    const todayRow = rows.find((r) => String(r.start_date).slice(0, 10) <= day && String(r.end_date).slice(0, 10) >= day) || rows.find((r) => r.status === 'open');
    if (!todayRow) ok('10 a period row covering today was found', false, JSON.stringify(periods).slice(0, 300));
    else {
      const fy = todayRow.fiscal_year || periods.fiscal_year;
      const lk = await call(ownerOf(M1), 'POST', '/api/books/periods/' + fy + '/' + Number(todayRow.period) + '/lock', { body: {} });
      const viaAdviser = await adv(A, M1, 'POST', '/events', fee(9));
      const viaOwner = await call(ownerOf(M1), 'POST', '/api/books/events', { body: fee(10) });
      ok('10 the owner locks the month; the adviser\'s line is refused with the owner\'s own code and sentence', lk.status === 200 && viaAdviser.status === viaOwner.status && viaAdviser.status >= 400 && code(viaAdviser) === code(viaOwner) && (viaAdviser.body.detail || viaAdviser.body.message) === (viaOwner.body.detail || viaOwner.body.message), JSON.stringify([lk.status, viaAdviser, viaOwner]));
      ok('10 nothing was posted in the locked month', (await entries(M1, '%' + ref(9))).length === 0 && (await entries(M1, '%' + ref(10))).length === 0);

      /* 13 W15-85a/b: the month is locked; the accountant (adviser_posts) and the owner each post a line in the NEXT open month, the own day of the line kept, the note "<Month> locked", the firm and grant stamped on the accountant's */
      const SUP = await business('s'); await withEntity(M1.id, (h) => h.query("INSERT INTO supplier_list (owner_entity_id, supplier_entity_id, nickname) VALUES ($1, $2, 'Metro Trade Supplies')", [M1.id, SUP.id]));
      const monthWord = new Date(day + 'T00:00:00Z').toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
      const rowsOf = (ref_) => withEntity(M1.id, (h) => h.query('SELECT entry_id, entry_no, posting_date, doc_date, narration, grant_id, by_name, by_firm, created_by FROM journal_entry WHERE entity_id = $1 AND source_ref LIKE $2', [M1.id, ref_])).then((r) => r.rows);
      const mvA = await adv(A, M1, 'POST', '/events', fee(15, { if_locked: 'next_open' }));
      const mvAe = await rowsOf('%' + ref(15));
      ok('13 the accountant: if_locked next_open posts (200), moved, the own day of the line kept as doc_date, the note says "' + monthWord + ' locked"', mvA.status === 200 && mvA.body.moved === true && mvAe.length === 1 && String(mvAe[0].doc_date.toISOString ? mvAe[0].doc_date.toISOString() : mvAe[0].doc_date).slice(0, 10) === day && String(mvAe[0].posting_date.toISOString ? mvAe[0].posting_date.toISOString() : mvAe[0].posting_date).slice(0, 10) > day && new RegExp(monthWord + ' locked$').test(mvAe[0].narration), JSON.stringify([mvA.status, mvA.body, mvAe]));
      ok('13 …stamped with the grant, her name and the firm', mvAe.length === 1 && mvAe[0].grant_id === g1.body.grant_id && mvAe[0].by_name === A.display_name && mvAe[0].by_firm === P.name && mvAe[0].created_by === A.identity_id, JSON.stringify(mvAe));
      const mvO = await call(ownerOf(M1), 'POST', '/api/books/events', { body: fee(16, { if_locked: 'next_open' }) });
      const mvOe = await rowsOf('%' + ref(16));
      ok('13 the owner: the same press posts the same way, no firm', mvO.status === 200 && mvO.body.moved === true && mvOe.length === 1 && mvOe[0].grant_id === null && mvOe[0].by_firm === null && new RegExp(monthWord + ' locked$').test(mvOe[0].narration), JSON.stringify([mvO.status, mvO.body, mvOe]));
      const mvP = await adv(A, M1, 'POST', '/payments', { party_id: SUP.id, direction: 'out', amount_minor: 2500, mode: 'bank', received_at: day, allocate: 'none', client_ref: ref(17), if_locked: 'next_open' });
      const mvPe = await rowsOf('pay:%');
      ok('13 the accountant payment to a supplier moves too, with the same note from the same helper, stamped', mvP.status === 200 && mvP.body.ok !== false && mvPe.length >= 1 && mvPe.every((r) => new RegExp(monthWord + ' locked$').test(r.narration) && r.grant_id === g1.body.grant_id && r.by_firm === P.name), JSON.stringify([mvP.status, mvP.body, mvPe]));
      const strictP = await adv(A, M1, 'POST', '/payments', { party_id: SUP.id, direction: 'out', amount_minor: 100, mode: 'bank', received_at: day, allocate: 'none', client_ref: ref(18) });
      ok('13 without the word a locked month still refuses the accountant payment; a value that is not next_open is not a bank body (403)', strictP.status >= 400 && (await adv(A, M1, 'POST', '/events', fee(19, { if_locked: 'always' }))).status === 403, JSON.stringify(strictP));
      const unlock = await adv(A, M1, 'POST', '/periods/' + fy + '/' + Number(todayRow.period) + '/unlock', { reason: 'x' });
      ok('13 Reopen is not for the accountant: unlocking the month through her door is 403, and the month stays locked', unlock.status === 403 && (await adv(A, M1, 'POST', '/events', fee(20))).status >= 400, JSON.stringify(unlock));
      /* 14 W15-89b: the bank ledger's lines name the other side and the party, read in one statement */
      const led = (await call(ownerOf(M1), 'GET', '/api/books/ledger/' + bank + '?from=' + day.slice(0, 4) + '-01-01&to=' + day.slice(0, 4) + '-12-31&limit=100')).body;
      const lines = (led && led.lines) || [];
      const feeLine = lines.find((x) => x.entry_no === mvOe[0].entry_no), payLine = lines.find((x) => x.entry_no === mvPe[0].entry_no);
      ok('14 an expense line on the bank ledger says its other side: { code, name } of the expense ledger, no party', feeLine && feeLine.other && feeLine.other.code && feeLine.other.name && feeLine.party_name === null, JSON.stringify(feeLine));
      ok('14 a payment line says the creditors ledger and the supplier by its nickname', payLine && payLine.other && payLine.other.name && payLine.party_name === 'Metro Trade Supplies', JSON.stringify(payLine));
      const dayLines = (await call(ownerOf(M1), 'GET', '/api/books/ledger/' + bank + '?from=' + day.slice(0, 4) + '-01-01&to=' + day.slice(0, 4) + '-12-31')).body.lines;
      ok('14 the unpaged ledger carries the same other side', dayLines.some((x) => x.entry_no === mvOe[0].entry_no && x.other && x.other.code === feeLine.other.code));
    }
  } finally {
    server.close();
  }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((err) => { console.error('ERROR', (err && err.stack) || err); process.exit(2); });
