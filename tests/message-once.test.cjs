/**
 * tests/message-once.test.cjs — A MESSAGE IS POSTED ONCE, OR NOT AT ALL (RAIL-136 d).
 *
 * OWNS      the rule that POST /:chit_id/messages writes its per-party copies and its timeline line in ONE transaction
 * CALLED BY scripts/guards.cjs (offline, no DB)
 * FLOW      a db stub that holds each withEntity's writes until it commits (a throw discards them, as BEGIN/ROLLBACK does)
 *           → the real routes/chits.js → POST a message with the timeline write failing → nothing held → POST again → one copy
 * CARD      docs/01-rail-core-the-chit/functions/thread-messages-on-a-chit.md
 *
 * Before the fix the copies committed in their own transaction and the timeline ran in a second one: a failed timeline write
 * answered 500 with the message already held by every party, so the person's retry posted it twice.
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CH = '33333333-3333-4333-8333-333333333333';
const MSGS = [];
const LOG = [];
let logFails = false;

/* one transaction: its writes land in MSGS / LOG only when it commits */
function txFor(ctx) {
  const held = { msgs: [], log: [] };
  const query = async (sql, p) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (/to_regprocedure/.test(s)) return { rows: [{ ok: true }] };
    if (/^SELECT entity_id FROM chit_status WHERE chit_id = \$1 AND entity_id = \$2/.test(s)) return { rows: p[1] === A || p[1] === B ? [{ entity_id: p[1] }] : [] };
    if (/SELECT chit_message_deliver\(/.test(s)) {
      if (p[2] !== ctx) throw new Error('chit_message_deliver: claimed sender <> caller');
      [A, B].forEach((e) => held.msgs.push({ message_id: p[0], entity_id: e, text: p[5] }));
      return { rows: [{ created_at: '2026-10-28T00:00:00Z' }] };
    }
    if (/SELECT chit_log_all\(/.test(s)) {
      if (logFails) throw Object.assign(new Error('could not extend file "base/16384/2619"'), { code: '53100' });
      [A, B].forEach((e) => held.log.push({ entity_id: e, action: p[1] }));
      return { rows: [{}] };
    }
    return { rows: [] };
  };
  return { db: { query }, held };
}
const withEntity = async (id, fn) => {
  const { db, held } = txFor(id);
  const out = await fn(db); /* a throw skips the commit: the writes are discarded */
  MSGS.push(...held.msgs);
  LOG.push(...held.log);
  return out;
};

const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (s, p) => txFor(null).db.query(s, p),
  withEntity, withTransaction: async (fn) => withEntity(null, fn),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
  onEntity: async (id, db, fn) => fn(db && db.query ? db : txFor(id).db),
} };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: A, identity_type: 'entity', display_name: 'Shop A' }; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n(),
    userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };
try { const sc = require(path.join(API, 'lib', 'schema')); sc.hasColumn = async () => true; sc.hasTable = async () => true; sc.hasColumns = async () => ({}); } catch (_) {}
const events = require(path.join(API, 'lib', 'events'));
events.notifyAfter = () => {};
events.emit = () => {};

const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const srv = app.listen(0, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${srv.address().port}/api/chits/${CH}/messages`;
  const post = async () => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message_text: 'Short by 2 boxes', thread_type: 'external' }) });
    return { status: r.status, body: await r.json().catch(() => ({})) }; };
  try {
    console.log('\n══ a message is posted once, or not at all (RAIL-136 d) ══\n');
    logFails = true;
    const first = await post();
    ok('the timeline write fails → 500, the safe sentence', first.status === 500, JSON.stringify(first));
    ok('…and NO party holds the message (the copies rolled back with it)', MSGS.length === 0 && LOG.length === 0, JSON.stringify({ MSGS, LOG }));
    logFails = false;
    const again = await post();
    ok('the retry → 200', again.status === 200 && again.body.message_id, JSON.stringify(again));
    ok('…each party holds it ONCE (one message_id, one copy each)', MSGS.length === 2 && new Set(MSGS.map((m) => m.message_id)).size === 1 && MSGS.every((m) => m.message_id === again.body.message_id), JSON.stringify(MSGS));
    ok('…and one timeline line per party', LOG.length === 2 && LOG.every((l) => l.action === 'message_sent'), JSON.stringify(LOG));
  } catch (e) {
    fail++; console.log('   FAIL threw: ' + (e && e.stack));
  } finally {
    console.log(`\n${pass} passed, ${fail} failed · ${pass + fail} checks`);
    process.exitCode = fail ? 1 : 0;
    srv.closeAllConnections();
    srv.close();
  }
});
