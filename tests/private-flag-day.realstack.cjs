'use strict';
/**
 * tests/private-flag-day.realstack.cjs — "clear the bookmarks of a day" cuts the day in the WRITER'S SHOP ZONE, never the UTC date (tzsweep, 18 Nov 2026). Real Postgres as cb_app (RLS on), through routes/flags.js.
 * Fixture   one owner per zone: an IN shop (Asia/Kolkata, +05:30: its day 17 Nov = 16 Nov 18:30Z .. 17 Nov 18:30Z) and an AU shop (Australia/Sydney, AEDT +11: its day 17 Nov = 16 Nov 13:00Z .. 17 Nov 13:00Z).
 *           Four open bookmarks each, planted with a created_at at a fixed instant (a faked clock): two INSIDE the shop day, one 15 min past its end, one 15 min before its start.
 * HAND-COMPUTED  clear from=to=2026-11-17 removes exactly the two inside rows (cleared 2); the UTC cut (the old code) would take the 17th-UTC rows instead (one inside, one outside = wrong on both edges).
 * Run: DATABASE_URL=postgres://cb_app:cbapp@127.0.0.1:55471/flags_t node tests/private-flag-day.realstack.cjs   (a scratch database; never shared or production)
 */
const url = process.env.DATABASE_URL || '';
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !/^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'private_flag_test_secret_at_least_32_chars_padding';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const API = path.join(__dirname, '..');
const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const { query, withEntity } = require(path.join(API, 'db'));
const reqctx = require(path.join(API, 'lib', 'reqctx.js'));
const fakeAuth = async (req, res, next) => {
  let who;
  try { who = JSON.parse(String(req.headers['x-test-as'] || '')); } catch (_) { return res.status(401).json({ error: 'no test identity' }); }
  req.identity = who;
  return reqctx.runWithActor(who.identity_id, () => next());
};
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 700) : '')); } };
const RUN = 'pd' + (Date.now() % 1e10).toString(36).padStart(6, '0');
const sqlAs = (entity, actor, text, params) => reqctx.runWithActor(actor, () => withEntity(entity, (h) => h.query(text, params)));

/** [tag, country, zone, the four planted instants: [inside start edge, inside end edge, just past the end, just before the start]] */
const SHOPS = [
  ['IN', 'IN', 'Asia/Kolkata', ['2026-11-16T18:45:00Z', '2026-11-17T18:15:00Z', '2026-11-17T18:45:00Z', '2026-11-16T18:15:00Z']],
  ['AU', 'AU', 'Australia/Sydney', ['2026-11-16T13:30:00Z', '2026-11-17T12:30:00Z', '2026-11-17T13:30:00Z', '2026-11-16T12:30:00Z']]
];

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/flags', require(path.join(API, 'routes', 'flags.js')));
  app.use((err, req, res, next) => res.status(500).json({ code: 'TEST_500', message: String(err && err.message) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const [tag, country, zone, instants] of SHOPS) {
      const { rows: [shop] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, timezone, user_id) VALUES ($1, $2, 'entity', $3, 'INR', $4, $5) RETURNING identity_id, display_name`,
        ['CB' + RUN + tag, 'Day shop ' + tag, country, zone, crypto.randomUUID()]);
      const who = { identity_id: shop.identity_id, bridge_id: 'CB' + RUN + tag, identity_type: 'entity', parent_entity_id: null, display_name: shop.display_name };
      for (const [n, at] of instants.entries()) {
        await sqlAs(shop.identity_id, shop.identity_id, `INSERT INTO private_flag (entity_id, kind, visibility, subject_kind, subject_entity, subject_id, label, state, author_identity_id, author_name, seat, created_at)
          VALUES ($1::uuid, 'bookmark', 'org', 'posting', $1::uuid, $2, $3, 'open', $1::uuid, 'owner', 'business', $4::timestamptz)`, [shop.identity_id, 'p' + n, 'Entry ' + n, at]);
      }
      const res = await fetch(base + '/api/flags/clear', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-as': JSON.stringify(who) }, body: JSON.stringify({ subject_entity: shop.identity_id, from: '2026-11-17', to: '2026-11-17' }) });
      const body = await res.json().catch(() => null);
      const left = (await sqlAs(shop.identity_id, shop.identity_id, `SELECT subject_id FROM private_flag WHERE state = 'open' ORDER BY subject_id`)).rows.map((r) => r.subject_id);
      ok(tag + ' (' + zone + ') clear 17 Nov removes the two bookmarks set INSIDE the shop day (p0, p1), keeps the one 15 min after its end (p2) and the one 15 min before its start (p3)', res.status === 200 && body && body.cleared === 2 && left.join() === 'p2,p3', JSON.stringify([res.status, body, left]));
    }
  } finally { server.close(); }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('CRASH', e); process.exit(1); });
