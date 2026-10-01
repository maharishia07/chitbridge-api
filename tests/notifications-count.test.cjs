'use strict';
/**
 * notifications-count.test.cjs — ⭐⭐ THE BADGE'S NUMBER IN ONE STATEMENT (2026-09-28, BACKLOG "THE BADGE COSTS A
 * FULL FEED READ").
 *
 * GET /api/notifications?count=1 answers the badge's one question — how many arrived since you last looked — as
 * ONE withEntity statement, over the SAME rows the feed shows, with the SAME rule. Before it the badge paid for
 * the whole feed: an unscoped identities read, the DISTINCT ON join returning thirty full rows, and a second
 * transaction for notif_seen_at.
 *
 * ⭐ Runs the real route with db and auth replaced by recorders — no database, no server. What is asserted is
 * what the route SENDS: how many transactions, whether any statement escapes withEntity, and that the count and
 * the feed read one shared fragment (two copies of a WHERE clause drift; one cannot).
 *
 * Run: node tests/notifications-count.test.cjs   · no DB, no network.
 */
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');

let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/* ── the recorders, planted where the route will require them ── */
const calls = [];
const dbStub = {
  query: async (sql, params) => { calls.push({ via: 'pool', sql: String(sql), params }); return { rows: [] }; },
  withEntity: async (entity, fn) => {
    const tx = { entity, statements: [] };
    calls.push({ via: 'withEntity', tx });
    return fn({ query: async (sql, params) => { tx.statements.push({ sql: String(sql), params });
      return { rows: /count\(\*\)/.test(sql) ? [{ count: 3, total: 7, seen_at: '2026-09-28T10:00:00Z' }] : [] }; } });
  },
};
const authStub = Object.assign((req, res, next) => next(), { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id });
require.cache[require.resolve(path.join(API, 'db'))] = { id: 'db', filename: 'db', loaded: true, exports: dbStub };
require.cache[require.resolve(path.join(API, 'middleware', 'auth'))] = { id: 'auth', filename: 'auth', loaded: true, exports: authStub };
const router = require(path.join(API, 'routes', 'notifications.js'));

function getRoot() {
  const layer = router.stack.find((l) => l.route && l.route.path === '/' && l.route.methods.get);
  assert.ok(layer, 'GET / is gone from routes/notifications.js — this test is measuring nothing');
  const st = layer.route.stack; return st[st.length - 1].handle;
}
async function call(queryString) {
  calls.length = 0;
  let body = null, status = 200;
  const req = { query: queryString, identity: { identity_id: 'caller-1', parent_entity_id: 'shop-1' } };
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  await getRoot()(req, res);
  return { body, status };
}
const norm = (s) => s.replace(/\s+/g, ' ').trim();

(async () => {
  console.log('\nTHE BADGE ASKS ONE QUESTION\n');

  await ita('⭐⭐ ?count=1 is ONE withEntity transaction with ONE statement — nothing on the bare pool', async () => {
    const r = await call({ count: '1' });
    assert.strictEqual(r.status, 200, 'status ' + r.status + ' ' + JSON.stringify(r.body));
    assert.strictEqual(calls.filter((c) => c.via === 'pool').length, 0, 'a statement escaped withEntity: ' + JSON.stringify(calls.filter((c) => c.via === 'pool')));
    const tx = calls.filter((c) => c.via === 'withEntity');
    assert.strictEqual(tx.length, 1, 'expected one transaction, got ' + tx.length);
    assert.strictEqual(tx[0].tx.entity, 'shop-1', 'scoped to the wrong entity');
    assert.strictEqual(tx[0].tx.statements.length, 1, 'expected one statement, got ' + tx[0].tx.statements.length);
  });

  await ita('it answers the number and nothing else — no rows travel', async () => {
    const r = await call({ count: '1' });
    assert.deepStrictEqual(Object.keys(r.body).sort(), ['count', 'seen_at', 'total']);
    assert.strictEqual(r.body.count, 3);
  });

  await ita('⭐ the same rule as the feed: newer than notif_seen_at, messages excluded, the same newest-N window', async () => {
    await call({ count: '1', limit: '30' });
    const st = calls.find((c) => c.via === 'withEntity').tx.statements[0];
    const sql = norm(st.sql);
    assert.ok(/d\.action <> 'message_sent'/.test(sql), 'messages are counted again — two badges for one fact');
    assert.ok(/notif_seen_at/.test(sql), 'the count no longer reads "since you last looked"');
    assert.ok(/ORDER BY x\.created_at DESC LIMIT \$3/.test(sql), 'not the same newest-N window as the feed');
    assert.deepStrictEqual(st.params, ['shop-1', 'caller-1', 30]);
  });

  await ita('⭐⭐ the count and the feed read ONE shared fragment of SQL — they cannot drift apart', async () => {
    await call({ count: '1' });
    const countSql = norm(calls.find((c) => c.via === 'withEntity').tx.statements[0].sql);
    await call({});
    const feed = calls.filter((c) => c.via === 'withEntity').map((c) => c.tx.statements[0]).find((s) => /DISTINCT ON/.test(s.sql));
    assert.ok(feed, 'the feed statement was not found');
    const feedSql = norm(feed.sql);
    /* the fragment as SENT: its source text, with the one constant it interpolates filled in */
    const frag = norm(require('fs').readFileSync(path.join(API, 'routes', 'notifications.js'), 'utf8')
      .match(/const FEED_FROM = `([\s\S]*?)`;/)[1]
      .replace(/\$\{FEED_DAYS\}/g, String(Math.max(1, parseInt(process.env.NOTIF_FEED_DAYS || '90', 10) || 90)))
      /* the bill-privacy predicate it interpolates (lib/bill-privacy, 2026-10-01), filled in the same way */
      .replace("${billPrivacy.billSql('ch', 'cs')}", () => require(path.join(API, 'lib', 'bill-privacy')).billSql('ch', 'cs'))
      .replace("${billPrivacy.foreignStepSql('sl', '$1')}", () => require(path.join(API, 'lib', 'bill-privacy')).foreignStepSql('sl', '$1')));
    assert.ok(countSql.indexOf(frag) >= 0, 'the count does not use FEED_FROM');
    assert.ok(feedSql.indexOf(frag) >= 0, 'the feed does not use FEED_FROM');
    assert.ok(/notif_dismissed/.test(frag) && /sl\.entity_id = \$1 OR sl\.action IN/.test(frag),
      'the fragment lost the dismissed rows or the F3 isolation rule');
    /* ⚠️ external review 2026-09-25: the poll re-sorted the whole state_log — both paths are bounded in time */
    assert.ok(/sl\.created_at > now\(\) - interval '\d+ days'/.test(countSql) && /sl\.created_at > now\(\) - interval '\d+ days'/.test(feedSql),
      'the feed or the count is no longer bounded in time — it re-sorts the whole history on every poll');
  });

  await ita('without ?count=1 the feed is unchanged: rows, count, total, seen_at', async () => {
    const r = await call({});
    assert.deepStrictEqual(Object.keys(r.body).sort(), ['count', 'notifications', 'seen_at', 'total']);
  });

  console.log('\n  ' + pass + ' checks\n');
})();
