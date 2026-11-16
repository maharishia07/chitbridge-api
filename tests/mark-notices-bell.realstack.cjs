'use strict';
/**
 * tests/mark-notices-bell.realstack.cjs — W15-80: the owner's bell row for a Query/reply opens the same sheet for a SALES entry (SV) and a PAYMENT entry (PY), on a REAL Postgres.
 *
 * OWNS      the payload of GET /api/notifications for the marks' news: every row names its entry by `mark_entry.entry_id` (the key the Day book's Query chip opens the sheet by), whatever the entry's series.
 *           Before the fix the row carried the number, day and money but NO id, so the web looked the entry up in the OPEN list by its number: an SV row (a reply on a thread no longer open, or a label that is not the number) found nothing.
 * HAND      the shop BO_ENTITY (a real shop with posted SV and PY entries; its own ledger, no row of it is changed except the marks and messages this run adds in a SCRATCH database).
 *           firm P with an auditor person U; the shop gives P an auditor grant. U raises a Query on one SV entry and one PY entry, and replies on each thread.
 *           The owner's feed then holds 4 mark rows (2 mark_query, 2 mark_reply); each carries the entry_id of its entry, the entry_no starting SV/ or PY/, and the same two ids as the Day book names.
 * Run: DATABASE_URL=postgres://cb_app:...@localhost:5432/<scratch> BO_ENTITY=<shop id> node tests/mark-notices-bell.realstack.cjs   (a SIT box, a scratch copy of its database; never the live one)
 * CARD      22-channels-capture-and-messaging/notifications-and-the-bell
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
if (!process.env.BO_ENTITY) { console.error('REFUSED: BO_ENTITY (the shop id) is required'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'bell_open_test_secret_at_least_32_chars_padding';
const path = require('path');
const express = require('express');
const API = path.join(__dirname, '..');

const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const { query, withEntity } = require(path.join(API, 'db'));
const fakeAuth = async (req, res, next) => {
  if (req.identity) return next();
  let who;
  try { who = JSON.parse(String(req.headers['x-test-as'] || '')); } catch (_) { return res.status(401).json({ error: 'no test identity' }); }
  if (who.identity_type === 'actor' && /^[0-9a-f-]{36}$/i.test(String(who.identity_id))) {
    const row = (await query('SELECT access_level, whole_entity, can_see_costs FROM identities WHERE identity_id = $1', [who.identity_id])).rows[0];
    Object.assign(who, { access_level: row.access_level, whole_entity: row.whole_entity === true, can_see_costs: row.can_see_costs === true });
  }
  req.identity = who;
  return next();
};
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const net = require(path.join(API, 'src', 'services', 'network'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 600) : '')); } };
const RUN = 'bo' + (Date.now() % 1e10).toString(36);
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

async function main() {
  const shop = (await query(`SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_id = $1`, [process.env.BO_ENTITY])).rows[0];
  if (!shop) throw new Error('no such shop');
  const owner = { identity_id: shop.identity_id, bridge_id: shop.bridge_id, identity_type: 'entity', parent_entity_id: null, display_name: shop.display_name };
  const bridgeId = 'CB' + RUN + 'p';
  const { rows: [firm] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'AE', 'AED', $3) RETURNING identity_id, display_name`, [bridgeId, 'Firm ' + RUN, bridgeId.toLowerCase()]);
  const { rows: [aud] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'AE', 'AED', $4, 'commenter', true, true, 'act') RETURNING identity_id, display_name`, [bridgeId + 'u', 'Auditor ' + RUN, firm.identity_id, (bridgeId + 'u').toLowerCase()]);
  const U = { identity_id: aud.identity_id, identity_type: 'actor', parent_entity_id: firm.identity_id, bridge_id: bridgeId, display_name: aud.display_name };
  const nodeFirm = await net.nodeOf(firm.identity_id, { ensure: true }), nodeShop = await net.nodeOf(shop.identity_id, { ensure: true });
  /* the shop is already in a network (a tree edge): the firm becomes its AGENCY parent, an active edge, which is what isGrantParentSql also accepts (scratch database only) */
  await query(`INSERT INTO cb_edge (parent_id, child_id, type, state) VALUES ($1, $2, 'agency', 'active')`, [nodeFirm.id, nodeShop.id]);

  const app = express();
  app.use(express.json());
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  app.use('/api/marks', require(path.join(API, 'routes', 'marks.js')));
  app.use('/api/notifications', require(path.join(API, 'routes', 'notifications.js')));
  app.use((err, req, res, next) => res.status(500).json({ code: 'TEST_500', message: String(err && err.message) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    const pick = async (series) => (await withEntity(shop.identity_id, (h) => h.query(
      `SELECT j.entry_id, j.entry_no FROM journal_entry j WHERE j.entity_id = $1 AND j.series = $2 AND j.reverses_entry_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = j.entity_id AND r.reverses_entry_id = j.entry_id) ORDER BY j.posting_date DESC, j.entry_no DESC LIMIT 1`, [shop.identity_id, series]))).rows[0];
    const SV = await pick('SV'), PY = await pick('PY');
    ok('0 the shop has a posted sales entry and a posted payment entry', SV && PY && /^SV\//.test(SV.entry_no) && /^PY\//.test(PY.entry_no), JSON.stringify([SV, PY]));
    const g = await call(owner, 'POST', '/api/books-grants', { body: { grantee: firm.identity_id, purpose: 'audit of the books', consent: true } });
    ok('0 the shop gives the firm an auditor grant', g.status === 201, JSON.stringify(g));
    const asAud = (method, route, body) => call(U, method, route, { member: shop.identity_id, role: 'auditor', body });
    const threads = {};
    for (const [tag, e] of [['SV', SV], ['PY', PY]]) {
      const q = await asAud('POST', '/api/marks', { adopter: 'acc.audit', subject_id: e.entry_id, kind: 'query', note: 'Please explain ' + e.entry_no });
      ok('1 ' + tag + ': the auditor raises a Query', q.status === 201 && q.body.mark.class === 'open', JSON.stringify(q));
      threads[tag] = q.body.mark.thread_id;
      const r = await asAud('POST', '/api/marks/' + threads[tag] + '/messages', { message_text: 'Coastal replied about ' + e.entry_no, msg_type: 'info' });
      ok('1 ' + tag + ': the auditor replies in the thread', r.status === 201, JSON.stringify(r));
    }
    const feed = await call(owner, 'GET', '/api/notifications?limit=50');
    const rows = (feed.body && feed.body.notifications || []).filter((n) => /^mark_/.test(n.action));
    ok('2 the owner feed holds 2 mark_query and 2 mark_reply rows', feed.status === 200 && rows.filter((n) => n.action === 'mark_query').length === 2 && rows.filter((n) => n.action === 'mark_reply').length === 2, JSON.stringify(feed.body).slice(0, 600));
    for (const [tag, e] of [['SV', SV], ['PY', PY]]) {
      const mine = rows.filter((n) => n.mark_entry && n.mark_entry.entry_no === e.entry_no);
      ok('3 ' + tag + ': both rows (query and reply) carry entry_id = the id the Day book names, and the number', mine.length === 2 && mine.every((n) => n.mark_entry.entry_id === e.entry_id), JSON.stringify(mine));
      const th = await call(owner, 'GET', '/api/marks/' + threads[tag] + '/messages');
      ok('4 ' + tag + ': the thread opens by that id for the owner (the sheet the row asks for)', th.status === 200 && th.body.subject_id === e.entry_id, JSON.stringify(th).slice(0, 300));
    }
  } finally {
    server.close();
  }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('CRASH', e); process.exit(1); });
