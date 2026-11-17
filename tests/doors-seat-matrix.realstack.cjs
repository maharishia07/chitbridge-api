'use strict';
/**
 * tests/doors-seat-matrix.realstack.cjs - DOORS SWEEP (17 Nov 2026): the route x seat matrix of every route added on 17 Nov, through the REAL sign-in (middleware/auth is NOT replaced: every call carries a signed token; the real auth re-reads the person's row, swaps in the grant's identity and runs the hat gate).
 * WHY      POST /api/flags/query answered 403 to the auditor seat and the flag realstack could not see it: it fakes auth, so the hat gate never ran. This file fakes nothing.
 * Seats    AUD = commenter seat of firm F2 (auditor grant on client B) . ADV = editor seat of firm F1 (adviser grant on B) . OWN = B's own owner token . FIRM_OWNER = F2's owner token (never gated).
 * Run on a THROWAWAY migrated Postgres as cb_app:  DATABASE_URL=postgres://cb_app:...@host/db node tests/doors-seat-matrix.realstack.cjs   (without it: skipped, exit 0). Prints the matrix; exits 1 on any cell that differs from the expectation.
 * CARD     18-identity-sign-in-and-access/access-levels-and-roles
 */
const url = process.env.DATABASE_URL || '';
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts) { console.log('skipped: needs DATABASE_URL (cb_app, a throwaway migrated database)'); process.exit(0); }
if (parts[1] !== 'cb_app') { console.error('REFUSED: needs DATABASE_URL as cb_app'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'doors_matrix_secret_at_least_32_chars_padding_x';
const path = require('path');
const express = require('express');
const jsonWebToken = require('jsonwebtoken');
const API = path.join(__dirname, '..');
const net = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));
const RUN = 'dr' + (Date.now() % 1e10).toString(36);
const made = [];
let bad = 0;
async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [i] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'Doors ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  made.push(i.identity_id);
  return { bridgeId, id: i.identity_id, name: i.display_name, node: await net.nodeOf(i.identity_id, { ensure: true }) };
}
async function join(parent, member) { const a = await net.requestConnect({ parentId: parent.node.id, childId: member.node.id }, parent.node); await net.approve({ edgeId: a.id }, member.node); }
const tokenFor = (c) => jsonWebToken.sign(c, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const ownerOf = (b) => ({ token: tokenFor({ identity_id: b.id, identity_type: 'entity', bridge_id: b.bridgeId, display_name: b.name }) });
async function person(biz, tag, level) {
  const { rows: [r] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, true, true, 'act') RETURNING identity_id, display_name`, [biz.bridgeId + tag, 'P' + tag + ' ' + RUN, biz.id, (biz.bridgeId + tag).toLowerCase(), level]);
  made.push(r.identity_id);
  return { token: tokenFor({ identity_id: r.identity_id, identity_type: 'actor', bridge_id: biz.bridgeId, display_name: r.display_name, parent_entity_id: biz.id }) };
}
let base = '';
async function call(who, method, route, o) {
  o = o || {};
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + who.token };
  if (who.member) headers['x-books-for'] = who.member;
  if (who.role) headers['x-books-role'] = who.role;
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  let body = null; try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}
async function main() {
  const B = await business('b'), F1 = await business('1'), F2 = await business('2');
  await join(F1, B); await join(F2, F1);
  const aud = await person(F2, 'u', 'commenter'), adv = await person(F1, 'a', 'editor');
  const OWN = ownerOf(B), FIRM_OWNER = ownerOf(F2);
  const app = express(); app.use(express.json());
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  app.use('/api/flags', require(path.join(API, 'routes', 'flags.js')));
  app.use((err, req, res, next) => res.status(500).json({ code: 'TEST_500', message: String(err && err.message) }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    await withEntity(B.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, B.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, B.id));
    const on = await call(OWN, 'POST', '/api/books/enable', { body: {} });
    const gA = await call(OWN, 'POST', '/api/books-grants', { body: { grantee: F2.id, purpose: 'audit of the books', consent: true } });
    const gV = await call(OWN, 'POST', '/api/books-grants', { body: { grantee: F1.id, purpose: 'adviser of the books', consent: true, preset: 'adviser', posting: 'owner_approves' } });
    if (on.status !== 200 || gA.status !== 201 || gV.status !== 201) throw new Error('fixture ' + JSON.stringify([on.status, gA.status, gV.status]));
    const list = (await call(OWN, 'GET', '/api/books/accounts')).body; const accounts = list.accounts || list.rows || list || [];
    const cash = (accounts.find((a) => /cash/i.test(a.name || '')) || {}).code || '1000', sales = (accounts.find((a) => /^sales/i.test(a.name || '')) || {}).code || '4000';
    const day = new Date().toISOString().slice(0, 10);
    const E = (await call(OWN, 'POST', '/api/books/entries', { body: { narration: 'doors ' + RUN, date: day, client_ref: RUN + 'e', lines: [{ code: cash, dr_minor: 10000 }, { code: sales, cr_minor: 10000 }] } })).body;
    const entryId = E.entry_id || (E.entry && E.entry.entry_id);
    /* each seat: [name, caller with the grant headers (books routes), caller without (flags never take the grant header)] */
    const seats = [
      ['AUD', Object.assign({ member: B.id, role: 'auditor' }, aud), aud],
      ['ADV', Object.assign({ member: B.id, role: 'adviser' }, adv), adv],
      ['OWN', OWN, OWN],
      ['FIRM_OWNER', Object.assign({ member: B.id, role: 'auditor' }, FIRM_OWNER), FIRM_OWNER]
    ];
    const pend = '2026-03-31';
    const flagIds = {}, noteIds = {};
    const rows = [];
    const row = (name, fn, expect) => rows.push({ name, fn, expect });
    const subj = (kind) => ({ subject_kind: kind, subject_entity: B.id });
    const idOf = (r) => r.body && r.body.flags && r.body.flags[0] && r.body.flags[0].flag_id;
    const ALL = (n) => ({ AUD: n, ADV: n, OWN: n, FIRM_OWNER: n });
    row('GET /books/trial-balance (rank 9 bank block)', (s) => call(s[1], 'GET', '/api/books/trial-balance'), ALL(200));
    row('GET /books/daybook (JET keys)', (s) => call(s[1], 'GET', '/api/books/daybook?from=' + day + '&to=' + day), ALL(200));
    row('GET /books/daybook?since=mine (rank 10)', (s) => call(s[1], 'GET', '/api/books/daybook?since=mine'), { AUD: 200, ADV: 200, OWN: 400, FIRM_OWNER: 200 });
    row('GET /books/pl?compare=year (P&L comparatives)', (s) => call(s[1], 'GET', '/api/books/pl?compare=year'), ALL(200));
    row('GET /books/overview (MIS A3)', (s) => call(s[1], 'GET', '/api/books/overview?period=ytd'), ALL(200));
    row('POST /books-grants/practice/baseline (rank 10)', (s) => call(s[2], 'POST', '/api/books-grants/practice/baseline', { body: { client: B.id, seen_to: new Date().toISOString() } }), { AUD: 201, ADV: 201 /* W12: the accountant seat also opens an auditor-role grant, read only */, OWN: 403, FIRM_OWNER: 201 });
    row('POST /books/entries (a client write: must stay shut)', (s) => call(s[1], 'POST', '/api/books/entries', { body: { narration: 'x', date: day, lines: [] } }), { AUD: 403, ADV: 403, OWN: 422, FIRM_OWNER: 403 });
    row('POST /flags (bookmark a posting)', async (s) => { const r = await call(s[2], 'POST', '/api/flags', { body: Object.assign({ kind: 'bookmark', visibility: 'me', items: [{ id: entryId, label: 'Entry 1' }] }, subj('posting')) }); flagIds[s[0]] = idOf(r); return r; }, ALL(201));
    row('POST /flags (note on an account line, P&L Explain)', async (s) => { const r = await call(s[2], 'POST', '/api/flags', { body: Object.assign({ kind: 'note', visibility: 'me', note: 'why this moved', items: [{ id: '4000@' + pend, label: 'Sales to Mar' }] }, subj('account')) }); noteIds[s[0]] = idOf(r); return r; }, ALL(201));
    row('POST /flags/query (the bookmark chips)', (s) => call(s[2], 'POST', '/api/flags/query', { body: Object.assign({ ids: [entryId] }, subj('posting')) }), ALL(200));
    row('GET /flags and GET /flags/counts', async (s) => { const a = await call(s[2], 'GET', '/api/flags'), b = await call(s[2], 'GET', '/api/flags/counts'); return { status: a.status === b.status ? a.status : a.status * 1000 + b.status }; }, ALL(200));
    row('POST /flags/:id/share', (s) => call(s[2], 'POST', '/api/flags/' + flagIds[s[0]] + '/share'), { AUD: 200, ADV: 200, OWN: 200, FIRM_OWNER: 409 /* one shared bookmark per record per organisation: the firm already holds the auditor's */ });
    row('POST /flags/:id/resolve', (s) => call(s[2], 'POST', '/api/flags/' + noteIds[s[0]] + '/resolve'), ALL(200));
    row('POST /flags/:id/reopen', (s) => call(s[2], 'POST', '/api/flags/' + noteIds[s[0]] + '/reopen'), ALL(200));
    row('POST /flags/clear', (s) => call(s[2], 'POST', '/api/flags/clear', { body: { subject_entity: B.id } }), ALL(200));
    row('POST /flags/:id/remove', (s) => call(s[2], 'POST', '/api/flags/' + flagIds[s[0]] + '/remove'), ALL(200));
    console.log('\nROUTE x SEAT (expected/actual)   AUD=commenter seat . ADV=editor seat . OWN=client owner . FIRM_OWNER');
    for (const r of rows) {
      const cells = [];
      for (const s of seats) {
        let got;
        try { got = await r.fn(s); } catch (e) { got = { status: 'ERR ' + e.message }; }
        const want = r.expect[s[0]]; const good = got.status === want;
        if (!good) { bad++; console.log('      DIFF ' + r.name + ' ' + s[0] + ' ' + JSON.stringify(got.body || '').slice(0, 220)); }
        cells.push(s[0] + ' ' + want + '/' + got.status + (good ? '' : ' !!'));
        if (good && /trial-balance/.test(r.name) && !Array.isArray(got.body && got.body.bank)) { bad++; cells.push('NO bank block'); }
      }
      console.log('  ' + r.name.padEnd(58) + cells.join(' . '));
    }
  } finally { server.close(); }
}
async function cleanup() {
  const nodes = (await query(`SELECT e.id FROM cb_entity e JOIN identities i ON upper(i.bridge_id) = upper(e.bridge_id) WHERE i.identity_id = ANY($1::uuid[])`, [made])).rows.map((x) => x.id);
  await query(`DELETE FROM cb_edge WHERE parent_id = ANY($1::uuid[]) OR child_id = ANY($1::uuid[])`, [nodes]).catch(() => {});
}
main().then(async () => { await cleanup().catch(() => {}); console.log(bad ? '\n' + bad + ' cell(s) differ' : '\nall cells as expected'); process.exit(bad ? 1 : 0); }).catch((e) => { console.error('ERROR', e); process.exit(2); });
