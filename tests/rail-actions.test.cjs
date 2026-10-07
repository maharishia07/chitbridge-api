/**
 * tests/rail-actions.test.cjs — MAY I DO X ON THIS COPY: THE ANSWER AND THE DOOR ARE ONE ENGINE (R01, MASTER-BUILD-2026-10 row 10).
 *
 * The REAL middleware/auth.js (and the hat gate inside it), the REAL routes/chits.js and the adopted rail engine (lib/rail.js).
 * Only the database is a stand-in: one row per (chit, entity, direction) for chit_status and chit_header, read by the
 * params each query passes — so "my copy" is exactly what RLS would give.
 *
 *   A  the 14 situations (sender / receiver / self / auditor / commenter / viewer / co-assist / stranger × step × level):
 *      GET /chits/:id carries `actions`, one verdict per action, each why from the engine's vocabulary; the writing routes
 *      answer every action the way that verdict says — never ok:true for a door that then refuses (accept/reject/complete →
 *      PUT /status, assign → /assign-lines, amend → /amend, message_* → /messages, dispute → POST /disputes, which is NOT
 *      changed by R01: it is called to prove the verdict agrees with it)
 *   B  OUTCOMES UNCHANGED: every (situation × action) request is also sent to the routes as they were before R01 (the base
 *      commit's routes/chits.js, read from git) — the same status, the same error and message. `why` is the one addition.
 *      In a clone without that history (CI's shallow checkout) section B says SKIPPED, loudly — it never passes silently.
 *   C  one vocabulary: every `why` any response carries is a key of rail.WHY; the old refusal code (validTransitions,
 *      access.canMessage's ladder) is gone from the route.
 *
 * Run: node tests/rail-actions.test.cjs · no DB, no network beyond 127.0.0.1.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const jwt = require('jsonwebtoken');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-rail-actions';
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const API = path.join(__dirname, '..');
const BASE = 'fa1527f';   // origin/main when R01 branched — the routes as they were before the engine decided

/* ── the cast ─────────────────────────────────────────────────────────────────────────────────────────────── */
const S = 'aaaaaaaa-0000-4000-8000-00000000000a';   // sends C1
const R = 'bbbbbbbb-0000-4000-8000-00000000000b';   // receives C1
const F = 'ffffffff-0000-4000-8000-00000000000f';   // sends C2 to itself
const X = 'eeeeeeee-0000-4000-8000-00000000000e';   // holds nothing
const C1 = '0000c417-0000-4000-8000-0000000000c1', C2 = '0000c417-0000-4000-8000-0000000000c2';
const ACTORS = {   // co-assists: parent, level — what auth reads with break_status
  'a-aud': { parent: R, access_level: 'commenter', whole_entity: true, hat: 'audit' },
  'a-cmt': { parent: R, access_level: 'commenter', whole_entity: false, hat: 'view_only' },
  'a-vw':  { parent: R, access_level: 'viewer', whole_entity: false, hat: 'view_only' },
  'a-ed':  { parent: R, access_level: 'editor', whole_entity: false, hat: 'act' },
  'a-scm': { parent: S, access_level: 'commenter', whole_entity: false, hat: 'audit' },
};

/* ── the store: chit_status / chit_header rows, (chit, entity, direction) ───────────────────────────────────── */
let STATUS = [], HEADER = [];
function world(c1Received, c2Received) {
  STATUS = [
    { chit_id: C1, entity_id: S, direction: 'sent', current_status: 'delivered' },
    { chit_id: C1, entity_id: R, direction: 'received', current_status: c1Received },
    { chit_id: C2, entity_id: F, direction: 'sent', current_status: 'delivered' },
    { chit_id: C2, entity_id: F, direction: 'received', current_status: c2Received },
  ];
  HEADER = [
    { chit_id: C1, entity_id: S, direction: 'sent', role: 'Act', sender_entity_id: S, purpose: 'order', business_json: null, all_recipients: [{ entity_id: R }] },
    { chit_id: C1, entity_id: R, direction: 'received', role: 'To', sender_entity_id: S, purpose: 'order', business_json: null, all_recipients: [{ entity_id: R }] },
    { chit_id: C2, entity_id: F, direction: 'received', role: 'To', sender_entity_id: F, purpose: 'order', business_json: null, all_recipients: [{ entity_id: F }] },
  ];
}
const st = (chit, ent, dir) => STATUS.filter((r) => r.chit_id === chit && r.entity_id === ent && (!dir || r.direction === dir));
const hd = (chit, ent) => HEADER.filter((r) => r.chit_id === chit && r.entity_id === ent);

function rowsFor(sql, p) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  p = p || [];
  if (/break_status/.test(s) && /FROM identities/.test(s)) { const a = ACTORS[p[0]]; return a ? [{ break_status: 'active', hat: a.hat, access_level: a.access_level, whole_entity: a.whole_entity }] : []; }
  /* GET */
  if (/^SELECT \* FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2/.test(s)) return hd(p[0], p[1]);
  if (/FROM chit_detail/.test(s)) return [{ detail_type: 'order', line_item_count: 0, total_value: null, currency_code: 'INR', line_items: null }];
  if (/AS participants/.test(s) && /AS deliveries/.test(s)) {
    const mine = st(p[1], p[0], 'received')[0];
    return [{ participants: [], amendments: [], lines: [], assignments: [], deliveries: [], my_received: mine ? mine.current_status : null }];
  }
  /* PUT /status — the received-copy read, then the header */
  if (/SELECT current_status FROM chit_status/.test(s) && /direction = 'received'/.test(s)) return st(p[0], p[1], 'received').map((r) => ({ current_status: r.current_status }));
  if (/SELECT sender_entity_id, purpose, business_json FROM chit_header/.test(s)) return hd(p[0], p[1]);
  if (/FROM chit_header h/.test(s) && /h.chit_id = \$1 AND h.entity_id = \$2/.test(s)) return hd(p[0], p[1]).map((h) => Object.assign({ current_status: (st(p[0], p[1], 'received')[0] || {}).current_status }, h));
  /* POST /messages + POST /disputes — "do I hold a copy" (any direction) */
  if (/SELECT entity_id FROM chit_status WHERE chit_id = \$1 AND entity_id = \$2/.test(s)) return st(p[0], p[1]).map((r) => ({ entity_id: r.entity_id }));
  if (/SELECT current_status FROM chit_status WHERE chit_id=\$1 AND entity_id=\$2/.test(s)) return st(p[0], p[1]).map((r) => ({ current_status: r.current_status }));
  if (/chit_message_deliver/.test(s)) return [{ created_at: '2026-10-07T00:00:00.000Z' }];
  if (/SELECT sender_entity_id, all_recipients FROM chit_header/.test(s)) return hd(p[0], p[1]);
  /* assign-lines / amend — "do I hold a copy" (the header) */
  if (/SELECT (1|role) FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2/.test(s)) return hd(p[0], p[1]).map((h) => ({ role: h.role }));
  if (/SELECT COUNT\(/.test(s)) return [{ count: 0, n: 0 }];
  return [];
}
const q = async (sql, p) => { const rows = rowsFor(sql, p); return { rows, rowCount: rows.length }; };
const tx = { query: q };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: q, pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) },
  withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx), onEntity: async (id, db, fn) => fn(tx),
  readBatch: async () => ({}), trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
} };
const sc = require(path.join(API, 'lib', 'schema'));
sc.hasColumn = async () => true; sc.hasTable = async () => false;   // no dispute table probe, no attachment store
try { require(path.join(API, 'lib', 'books-hooks')).afterChit = () => Promise.resolve({}); } catch (_) {}
try { require(path.join(API, 'lib', 'whatsapp-out')).notifyChitStatus = async () => null; } catch (_) {}
try { require(path.join(API, 'lib', 'events')).notifyAfter = () => {}; } catch (_) {}
const origErr = console.error; console.error = () => {};   // the routes log their stand-in-db misses; the verdicts are under test

const rail = require(path.join(API, 'lib', 'rail'));

/* ── the two routers: today's, and the base commit's (section B) ──────────────────────────────────────────── */
const afterRouter = require(path.join(API, 'routes', 'chits'));
let beforeRouter = null, beforeWhy = '';
try {
  const src = execFileSync('git', ['-C', API, 'show', BASE + ':routes/chits.js'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const tmp = path.join(API, 'routes', '.r01-before.tmp.js');
  fs.writeFileSync(tmp, src);
  try { beforeRouter = require(tmp); } finally { try { fs.unlinkSync(tmp); } catch (_) {} }
} catch (e) { beforeWhy = String(e.message || e).split('\n')[0]; }
const mk = (router) => { const a = express(); a.use(express.json()); a.use('/api/chits', router); return a; };
const AFTER = mk(afterRouter), BEFORE = beforeRouter ? mk(beforeRouter) : null;

/* ── the callers ───────────────────────────────────────────────────────────────────────────────────────────── */
const tok = (id, type, parent) => jwt.sign(Object.assign({ identity_id: id, identity_type: type, display_name: 'who-' + id.slice(0, 5) },
  parent ? { parent_entity_id: parent } : {}), process.env.JWT_SECRET, { algorithm: 'HS256' });
const entity = (id) => ({ token: tok(id, 'entity'), entity: id });
const actor = (id) => ({ token: tok(id, 'actor', ACTORS[id].parent), entity: ACTORS[id].parent });

/* ⭐ THE 14 SITUATIONS — who · which chit · the step my received copy is at · the level */
const SITUATIONS = [
  ['sender (editor), receiver pending',          entity(S),       C1, ['pending', 'pending']],
  ['receiver (editor), pending',                 entity(R),       C1, ['pending', 'pending']],
  ['receiver (editor), accepted',                entity(R),       C1, ['accepted', 'pending']],
  ['receiver (editor), completed',               entity(R),       C1, ['completed', 'pending']],
  ['receiver (editor), rejected',                entity(R),       C1, ['rejected', 'pending']],
  ['receiver (editor), cancelled',               entity(R),       C1, ['cancelled', 'pending']],
  ['self-chit (editor), pending',                entity(F),       C2, ['pending', 'pending']],
  ['self-chit (editor), in_progress',            entity(F),       C2, ['pending', 'in_progress']],
  ['auditor of the receiver (commenter, whole)', actor('a-aud'),  C1, ['pending', 'pending']],
  ['commenter of the receiver, accepted',        actor('a-cmt'),  C1, ['accepted', 'pending']],
  ['viewer of the receiver, pending',            actor('a-vw'),   C1, ['pending', 'pending']],
  ['co-assist editor of the receiver, pending',  actor('a-ed'),   C1, ['pending', 'pending']],
  ['commenter of the sender',                    actor('a-scm'),  C1, ['pending', 'pending']],
  ['stranger (holds no copy)',                   entity(X),       C1, ['pending', 'pending']],
];
const DOOR = {
  accept:           ['PUT', '/status', { status: 'accepted' }],
  reject:           ['PUT', '/status', { status: 'rejected' }],
  complete:         ['PUT', '/status', { status: 'completed' }],
  assign:           ['POST', '/assign-lines', { edits: [] }],
  amend:            ['POST', '/amend', { edits: [] }],
  message_external: ['POST', '/messages', { message_text: 'hello there', thread_type: 'external' }],
  message_internal: ['POST', '/messages', { message_text: 'hello there', thread_type: 'internal' }],
  dispute:          ['POST', '/disputes', { category: 'quality', reason: 'the rice was wet on arrival', target_entity_id: null }],
};

function call(app, method, url, token, body) {
  return new Promise((done) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      const data = body ? JSON.stringify(body) : '';
      const headers = { Authorization: 'Bearer ' + token };
      if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
      const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method, headers }, (res) => {
        let b = ''; res.on('data', (c) => { b += c; });
        res.on('end', () => { srv.close(); let j = null; try { j = JSON.parse(b); } catch (_) {} done({ status: res.statusCode, body: j || {} }); });
      });
      r.on('error', (e) => { srv.close(); done({ status: 'ERR ' + e.code, body: {} }); });
      r.end(data);
    });
  });
}
/* a refusal of the ACTION (not of the body): the hat gate, a missing copy, a forbidden level, a wrong step */
const refused = (r) => r.status === 403 || r.status === 404 || (r.status === 400 && r.body.error === 'Invalid transition');

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) pass++; else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
const tally = {};

(async () => {
  console.log('\n— A · the 14 situations: GET\'s `actions` and the doors agree —');
  const pairs = [];
  for (const [name, who, chit, steps] of SITUATIONS) {
    world(steps[0], steps[1]);
    const g = await call(AFTER, 'GET', '/api/chits/' + chit, who.token);
    const holds = who.entity !== X;
    if (!holds) t(name + ': GET answers 404 — a stranger is told nothing, not even its actions', g.status === 404 && !g.body.actions, 'got ' + g.status);
    else {
      t(name + ': GET answers 200 with `actions`', g.status === 200 && g.body.actions, 'got ' + g.status + ' ' + JSON.stringify(g.body).slice(0, 160));
      t(name + ': `actions` answers exactly the engine\'s ACTIONS', g.body.actions && JSON.stringify(Object.keys(g.body.actions)) === JSON.stringify(rail.ACTIONS));
    }
    const acts = (g.body && g.body.actions) || {};
    const row = [];
    for (const a of rail.ACTIONS) {
      const [method, sub, body] = DOOR[a];
      world(steps[0], steps[1]);
      const r = await call(AFTER, method, '/api/chits/' + chit + sub, who.token, body);
      pairs.push({ name, a, who, chit, steps, method, sub, body, after: r });
      if (r.body && r.body.why !== undefined) t(name + ' · ' + a + ': the refusal word "' + r.body.why + '" is the engine\'s', Object.prototype.hasOwnProperty.call(rail.WHY, r.body.why));
      if (!holds) { t(name + ' · ' + a + ': refused', refused(r), 'got ' + r.status); row.push('✗'); continue; }
      const v = acts[a] || {};
      if (v.ok) {
        t(name + ' · ' + a + ': ok:true → the door does not refuse', !refused(r) && !r.body.noop, 'got ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 160));
        row.push('✓');
      } else if (v.why === 'already_done') {
        t(name + ' · ' + a + ': already_done → the door answers it as a no-op', r.status === 200 && r.body.noop === true, 'got ' + r.status);
        row.push('=');
      } else if (v.why === 'read_only' || v.why === 'comment_only') {
        t(name + ' · ' + a + ': ' + v.why + ' → the door refuses (403)', r.status === 403, 'got ' + r.status);
        if (r.body.why) t(name + ' · ' + a + ': …with the same word', r.body.why === v.why, r.body.why);
        row.push('✗');
      } else {
        t(name + ' · ' + a + ': ' + v.why + ' → the door refuses with the same word', refused(r) && (a === 'dispute' || r.body.why === v.why),
          'got ' + r.status + ' why=' + r.body.why);
        row.push('✗');
      }
    }
    tally[name] = row.join(' ');
  }
  console.log('     ' + rail.ACTIONS.map((a) => a.replace('message_', 'msg_')).join(' · '));
  for (const [n, r] of Object.entries(tally)) console.log('  ' + r + '   ' + n);

  console.log('\n— B · outcomes unchanged: the same requests against the routes before R01 (' + BASE + ') —');
  if (!BEFORE) console.log('  ⚠️ SKIPPED — the base commit is not in this clone (' + beforeWhy + '). Run where history exists; this is NOT a pass.');
  else {
    let same = 0;
    for (const x of pairs) {
      world(x.steps[0], x.steps[1]);
      const o = await call(BEFORE, x.method, '/api/chits/' + x.chit + x.sub, x.who.token, x.body);
      const strip = (b) => { const c = Object.assign({}, b); delete c.why; delete c.created_at; delete c.message_id; delete c.dispute_id; return JSON.stringify(c); };
      const ok = o.status === x.after.status && strip(o.body) === strip(x.after.body);
      if (ok) same++;
      t(x.name + ' · ' + x.a + ': before ' + o.status + ' = after ' + x.after.status + ', same body but `why`', ok,
        'before ' + o.status + ' ' + strip(o.body).slice(0, 160) + '\n       after  ' + x.after.status + ' ' + strip(x.after.body).slice(0, 160));
    }
    console.log('  ' + same + ' of ' + pairs.length + ' (situation × action) requests answer identically before and after');
  }

  console.log('\n— C · one vocabulary, one rule —');
  const SRC = fs.readFileSync(path.join(API, 'routes', 'chits.js'), 'utf8');
  t('routes/chits.js no longer holds a transition table (validTransitions moved to the engine)', !/validTransitions\s*=/.test(SRC));
  t('routes/chits.js no longer asks access.canMessage — the message route asks the engine', !/access\.canMessage\(/.test(SRC));
  t('PUT /status, /messages, /assign-lines and /amend each ask the engine', (SRC.match(/railActions\.(can|move)\(/g) || []).length >= 5);
  const acc = require(path.join(API, 'lib', 'access'));
  for (const lvl of ['viewer', 'commenter', 'editor']) {
    const id = { identity_type: 'actor', access_level: lvl };
    t('access.canMessage / canRaiseDispute answer as before for a ' + lvl,
      acc.canMessage(id, 'internal') === (lvl !== 'viewer') && acc.canMessage(id, 'external') === (lvl === 'editor') && acc.canRaiseDispute(id) === (lvl === 'editor'));
  }
  console.error = origErr;
  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
