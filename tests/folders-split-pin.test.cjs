#!/usr/bin/env node
// @type: contract
/**
 * folders-split-pin.test.cjs — MNT-59 pin: the four /api/folders routes that no test read the body of, pinned before routes/folders.js is split.
 *
 * OWNS      GET /messages (list, ?all=1 and ?count=1 bodies), POST /messages/:message_id/mark (the flags reach the definer, 404 when nothing was marked),
 *           GET /rules/vocabulary (the condition keys the builder may offer), GET /rules (this shop's rules only, in the pager's shape): status and body of each.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real router over a stand-in sign-in and a db that answers by the text of the statement.
 * FLOW      stub db + auth → real routes/folders.js on an express app → request over http → status · body · the statement's parameters
 * CARD      01-rail-core-the-chit/user-folders-and-auto-file-rules
 * RED under: the `kept` filter dropped from GET /messages, the read flag flipped in /mark, a condition key renamed in lib/match.js KEYS, the entity filter removed from lib/folder-rules.js list.
 *
 * MIN 3 checks
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const ROOT = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const MSG = (n) => '3333333' + n + '-3333-4333-8333-333333333333';
const asked = [];

const MESSAGES = [
  { message_id: MSG(1), chit_id: 'c1', line_id: null, sender_display_name: 'Chola', sender_entity_id: OTHER, message_text: 'Is it ready?', created_at: '2026-10-03T04:00:00Z', msg_type: 'text', read_at: null, kept: false, manual_subject: 'Order 1', auto_subject: null, track: 'task', particulars: null, chit_status: 'pending' },
  { message_id: MSG(2), chit_id: 'c2', line_id: null, sender_display_name: 'Chola', sender_entity_id: OTHER, message_text: 'Pinned note', created_at: '2026-10-02T04:00:00Z', msg_type: 'text', read_at: '2026-10-02T05:00:00Z', kept: true, manual_subject: 'Order 2', auto_subject: null, track: 'order', particulars: null, chit_status: 'pending' },
  { message_id: MSG(3), chit_id: 'c3', line_id: null, sender_display_name: 'Chola', sender_entity_id: OTHER, message_text: 'Seen, not kept', created_at: '2026-10-01T04:00:00Z', msg_type: 'text', read_at: '2026-10-01T05:00:00Z', kept: false, manual_subject: 'Order 3', auto_subject: null, track: 'task', particulars: null, chit_status: 'closed' },
];
const RULE_ROWS = [
  { rule_id: 'a1', entity_id: SHOP, folder_id: 'f1', name: 'Chola orders', when: { from: 'Chola' }, enabled: true, sort: 0, stop_processing: false, last_matched_at: null, match_count: 2, created_at: '2026-10-01T00:00:00Z' },
  { rule_id: 'a2', entity_id: SHOP, folder_id: 'f2', name: 'Fuel bills', when: { subject: 'fuel' }, enabled: false, sort: 1, stop_processing: false, last_matched_at: null, match_count: 0, created_at: '2026-10-02T00:00:00Z' },
  { rule_id: 'b1', entity_id: OTHER, folder_id: 'f9', name: 'Another shop rule', when: { from: 'X' }, enabled: true, sort: 0, stop_processing: false, last_matched_at: null, match_count: 0, created_at: '2026-10-03T00:00:00Z' },
];

/* the stand-in db answers by the statement's text: the kept filter and the entity filter act only when the statement carries them */
const run = async (sql, params) => {
  asked.push({ sql, params });
  if (/count\(\*\)::int AS n FROM chit_messages/.test(sql)) return { rows: [{ n: MESSAGES.filter((m) => !m.read_at).length }] };
  if (/FROM chit_messages m/.test(sql)) {
    const keptFilter = /\(to_jsonb\(m\)->>'kept'\)::boolean\) /.test(sql);
    return { rows: keptFilter ? MESSAGES.filter((m) => !m.read_at || m.kept) : MESSAGES };
  }
  if (/chit_message_mark/.test(sql)) return { rows: [{ marked_count: params[0] === MSG(9) ? 0 : 1 }] };
  if (/FROM folder_rule/.test(sql)) return { rows: /entity_id = \$1/.test(sql) ? RULE_ROWS.filter((r) => r.entity_id === params[0]) : RULE_ROWS };
  return { rows: [] };
};
const stubDb = { query: run };
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: run, withEntity: async (id, fn) => fn(stubDb), onEntity: async (id, db, fn) => (typeof db === 'function' ? db(stubDb) : fn(stubDb)), pool: {} } };
const authPath = require.resolve(path.join(ROOT, 'middleware', 'auth'));
const stubAuth = (req, res, next) => {
  req.identity = { identity_id: SHOP, identity_type: 'entity' };
  next();
};
stubAuth.entityOf = (req) => req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: stubAuth };

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.id = 'req-test';
  next();
});
app.use('/api/folders', require(path.join(ROOT, 'routes', 'folders.js')));

let failed = 0;
let total = 0;
const check = (ok, label) => {
  total++;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
};
const call = (server, method, url, body) =>
  new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ port: server.address().port, path: url, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, text, body: (() => { try { return JSON.parse(text); } catch (e) { return {}; } })() }));
    });
    if (data) req.write(data);
    req.end();
  });

(async () => {
  const server = app.listen(0);

  /* GET /messages — unread or kept; a read message that was not kept stays out; ?all=1 lists every one; ?count=1 is the badge */
  const list = await call(server, 'GET', '/api/folders/messages');
  const ids = (list.body.messages || []).map((m) => m.message_id);
  check(list.status === 200, 'GET /messages → 200 (got ' + list.status + ')');
  check(JSON.stringify(ids) === JSON.stringify([MSG(1), MSG(2)]), 'GET /messages lists the unread and the kept one only: ' + ids.length + ' messages');
  check(list.body.count === 2 && !ids.includes(MSG(3)), 'GET /messages count is the rows it returns and the read-not-kept message is left out');
  const first = (list.body.messages || [])[0] || {};
  check(first.sender_display_name === 'Chola' && first.message_text === 'Is it ready?' && first.track === 'task' && first.chit_status === 'pending' && first.kept === false, 'GET /messages carries sender, text, track, chit status and kept flag');
  const every = await call(server, 'GET', '/api/folders/messages?all=1');
  check(every.status === 200 && (every.body.messages || []).length === 3, 'GET /messages?all=1 lists all three messages');
  const badge = await call(server, 'GET', '/api/folders/messages?count=1');
  check(badge.status === 200 && badge.body.count === 1 && !badge.body.messages, 'GET /messages?count=1 answers the unread count alone');

  /* POST /messages/:id/mark — the flags reach the definer as asked, an absent flag is null, nothing marked is a 404, a bad id is a 400 */
  asked.length = 0;
  const mark = await call(server, 'POST', '/api/folders/messages/' + MSG(1) + '/mark', { read: true });
  const call1 = asked.find((q) => /chit_message_mark/.test(q.sql));
  check(mark.status === 200 && mark.body.ok === true && mark.body.updated === 1, 'POST /messages/:id/mark → 200 { ok: true, updated: 1 }');
  check(call1 && JSON.stringify(call1.params) === JSON.stringify([MSG(1), true, null]), 'mark read:true reaches the definer as (id, true, null): ' + JSON.stringify(call1 && call1.params));
  asked.length = 0;
  await call(server, 'POST', '/api/folders/messages/' + MSG(1) + '/mark', { kept: false });
  const call2 = asked.find((q) => /chit_message_mark/.test(q.sql));
  check(call2 && JSON.stringify(call2.params) === JSON.stringify([MSG(1), null, false]), 'mark kept:false reaches the definer as (id, null, false)');
  const none = await call(server, 'POST', '/api/folders/messages/' + MSG(9) + '/mark', { read: true });
  check(none.status === 404 && none.body.code === 'NOT_FOUND', 'mark of a message that is not mine → 404 NOT_FOUND (got ' + none.status + ')');
  const bad = await call(server, 'POST', '/api/folders/messages/not-a-uuid/mark', { read: true });
  check(bad.status === 400, 'mark of a non-uuid id → 400 (got ' + bad.status + ')');

  /* GET /rules/vocabulary — the keys the builder may offer, with their kinds */
  const vocabulary = await call(server, 'GET', '/api/folders/rules/vocabulary');
  const kinds = vocabulary.body.keys || {};
  const expected = { from: 'text', subject: 'text', text: 'text', purpose: 'exact', direction: 'exact', status: 'exact', channel: 'exact', min_amount: 'number', max_amount: 'number', has_dispute: 'bool', unread: 'bool', older_than_days: 'number', doc: 'exact' };
  check(vocabulary.status === 200 && JSON.stringify(Object.keys(kinds)) === JSON.stringify(Object.keys(expected)), 'GET /rules/vocabulary answers the 13 condition keys in order: ' + Object.keys(kinds).join(','));
  check(Object.keys(expected).every((k) => kinds[k] === expected[k]), 'GET /rules/vocabulary gives each key its kind (text · exact · number · bool)');

  /* GET /rules — this shop's rules, in sort order, in the pager's shape, never another shop's */
  const mine = await call(server, 'GET', '/api/folders/rules');
  const names = (mine.body.rules || []).map((r) => r.name);
  check(mine.status === 200 && JSON.stringify(names) === JSON.stringify(['Chola orders', 'Fuel bills']), 'GET /rules lists this shop\'s two rules: ' + names.join(' | '));
  check(!names.includes('Another shop rule'), 'GET /rules never lists another shop\'s rule');
  const rule = (mine.body.rules || [])[0] || {};
  check(rule.rule_id === 'a1' && rule.folder_id === 'f1' && rule.enabled === true && rule.sort === 0 && rule.match_count === 2 && rule.when && rule.when.from === 'Chola' && !('entity_id' in rule), 'GET /rules carries the rule\'s columns and not the entity id');
  check(mine.body.total === 2, 'GET /rules carries the pager\'s total (' + mine.body.total + ')');

  server.close();
  console.log('\n' + (total - failed) + '/' + total + ' passed');
  process.exit(failed ? 1 : 0);
})();
