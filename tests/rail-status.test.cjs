/**
 * tests/rail-status.test.cjs — ⭐⭐ EVERY STATUS CHANGE GOES THROUGH THE ONE STATUS WRITE (T1-RAIL, 2026-10-14 · RC1 / DSP-ONE).
 *
 *   A  lib/rail-status statusGate, unit: the rail's table decides (completed → cancelled refused, write() throws, nothing written);
 *      a sent copy is gated by the same table; noop writes nothing; a viewer is refused; opts.from saves the read
 *   B  PUT /chits/:id/void over the REAL route: a completed chit is refused 409 with why (nothing written); a delivered one cancels
 *      the sent copy through the gate
 *   C  each former bypass goes through statusGate (spied): auto-assign, assign-bulk, actors pull, actors push, moveStatus
 *   D  THE GUARD: no SQL in lib/ or routes/ writes current_status outside lib/rail-status.js (a sixth cannot appear) — and the
 *      scanner itself catches every form the five bypasses used
 *
 * Run: node tests/rail-status.test.cjs · no DB, no network beyond 127.0.0.1.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-rail-status';
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const API = path.join(__dirname, '..');

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

/* ── the store: chit_status rows (chit, entity, direction) and every statement sent ─────────────────────────── */
const S = 'aaaaaaaa-0000-4000-8000-00000000000a', R = 'bbbbbbbb-0000-4000-8000-00000000000b';
const C1 = '0000c417-0000-4000-8000-0000000000c1', A1 = 'cccccccc-0000-4000-8000-0000000000a1';
let STATUS = [], SENT = [];
const one = (s) => String(s).replace(/\s+/g, ' ').trim();
function rowsFor(sql, p) {
  const s = one(sql); p = p || [];
  SENT.push(s);
  const dir = (s.match(/direction = '(received|sent)'/) || [])[1];
  const mine = STATUS.filter((r) => r.chit_id === p[0] && r.entity_id === p[1] && (!dir || r.direction === dir));
  if (/^SELECT current_status FROM chit_status/.test(s)) return mine.map((r) => ({ current_status: r.current_status }));
  if (/^UPDATE chit_status SET current_status = \$1/.test(s)) {
    STATUS.filter((r) => r.chit_id === p[1] && r.entity_id === p[2] && r.direction === dir).forEach((r) => { r.current_status = p[0]; });
    return [];
  }
  if (/SELECT sender_entity_id FROM chit_header/.test(s)) return [{ sender_entity_id: p[1] === S ? S : S }];
  if (/break_status/.test(s) && /FROM identities/.test(s) && /parent_entity_id/.test(s) === false) return [];
  /* auto-assign */
  if (/FROM entity_actor_settings/.test(s) && /auto_assign_mode/.test(s)) return [{ auto_assign_mode: 'default_assignee', default_assignee_actor_id: A1, default_max_tasks: 10 }];
  if (/FROM entity_actor_settings/.test(s)) return [{ assignment_model: 'both', default_max_tasks: 10 }];
  if (/SELECT assigned_to_actor_id, current_status FROM chit_status/.test(s)) return mine.map((r) => ({ assigned_to_actor_id: null, current_status: r.current_status }));
  if (/SELECT assigned_to_actor_id FROM chit_status/.test(s)) return [{ assigned_to_actor_id: null }];
  if (/SELECT identity_id, break_status, hat, delegate_actor_id/.test(s)) return [{ identity_id: A1, break_status: 'active', hat: 'act', delegate_actor_id: null }];
  if (/SELECT identity_id, display_name/.test(s) && /FROM identities/.test(s)) return [{ identity_id: A1, display_name: 'Asha', current_task_count: 0, max_tasks: 10 }];
  /* actors PUT /assign */
  if (/SELECT cs\.\*, i\.display_name as actor_name/.test(s)) return STATUS.filter((r) => r.chit_id === p[0] && r.entity_id === p[1]).map((r) => Object.assign({ assigned_to_actor_id: null, actor_name: null }, r));
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
sc.hasColumn = async () => false; sc.hasTable = async () => false;
try { require(path.join(API, 'lib', 'books-hooks')).afterChit = () => Promise.resolve({}); } catch (_) {}
try { require(path.join(API, 'lib', 'whatsapp-out')).notifyChitStatus = async () => null; } catch (_) {}
const origErr = console.error; console.error = () => {};

const railStatus = require(path.join(API, 'lib', 'rail-status'));
const rail = require(path.join(API, 'lib', 'rail'));
/* the spy: every statusGate call, by (to, copy) */
const GATES = [];
const realGate = railStatus.statusGate;
railStatus.statusGate = async (db, e, c, to, me, o) => { GATES.push({ to, copy: (o && o.copy) || 'received', entity: e }); return realGate(db, e, c, to, me, o); };

const chits = require(path.join(API, 'routes', 'chits'));
const actors = require(path.join(API, 'routes', 'actors'));
const app = express(); app.use(express.json()); app.use('/api/chits', chits); app.use('/api/actors', actors);
const tok = (id) => jwt.sign({ identity_id: id, identity_type: 'entity', display_name: 'who-' + id.slice(0, 5) }, process.env.JWT_SECRET, { algorithm: 'HS256' });
function call(method, url, token, body) {
  return new Promise((done) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      const data = body ? JSON.stringify(body) : '';
      const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
      const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method, headers }, (res) => {
        let b = ''; res.on('data', (c) => { b += c; });
        res.on('end', () => { srv.close(); let j = null; try { j = JSON.parse(b); } catch (_) {} done({ status: res.statusCode, body: j || {} }); });
      });
      r.on('error', (e) => { srv.close(); done({ status: 'ERR ' + e.code, body: {} }); });
      r.end(data);
    });
  });
}
const EDITOR = { level: 'editor' };
const updates = () => SENT.filter((s) => /^UPDATE chit_status SET current_status/.test(s));
const world = (rows) => { STATUS = rows.map((r) => Object.assign({ chit_id: C1 }, r)); SENT = []; GATES.length = 0; };

(async () => {
  console.log('\n— A · statusGate: the rail\'s table decides —');
  world([{ entity_id: R, direction: 'received', current_status: 'completed' }]);
  let g = await railStatus.statusGate(tx, R, C1, 'cancelled', EDITOR);
  t('completed → cancelled is refused with wrong_step (lib/rail.js has no such step)', !g.ok && g.why === 'wrong_step' && g.from === 'completed');
  let threw = false; try { await g.write(); } catch (_) { threw = true; }
  t('write() past a refusal throws, and nothing is written', threw && updates().length === 0);
  world([{ entity_id: R, direction: 'received', current_status: 'pending' }]);
  g = await railStatus.statusGate(tx, R, C1, 'cancelled', EDITOR);
  t('pending → cancelled is allowed and write() moves the received copy', g.ok && (await g.write()) === true && STATUS[0].current_status === 'cancelled' && /direction = 'received'/.test(updates()[0] || ''));
  world([{ entity_id: S, direction: 'sent', current_status: 'delivered' }]);
  g = await railStatus.statusGate(tx, S, C1, 'cancelled', EDITOR, { copy: 'sent' });
  t('a sent copy is gated by the same table and written on its own direction', g.ok && (await g.write()) && STATUS[0].current_status === 'cancelled' && /direction = 'sent'/.test(updates()[0] || ''));
  world([{ entity_id: R, direction: 'received', current_status: 'pending' }]);
  g = await railStatus.statusGate(tx, R, C1, 'pending', EDITOR);
  t('already there: noop, write() writes nothing', g.ok && g.noop && (await g.write()) === false && updates().length === 0);
  g = await railStatus.statusGate(tx, R, C1, 'accepted', { level: 'viewer' });
  t('a viewer is refused read_only (the level ladder, before the table)', !g.ok && g.why === 'read_only');
  world([]);
  g = await railStatus.statusGate(tx, R, C1, 'pending', EDITOR, { from: 'accepted' });
  t('opts.from: the caller\'s own read in this transaction is used — no second read', g.ok && SENT.length === 0);
  g = await railStatus.statusGate(tx, R, C1, 'pending', EDITOR);
  t('no copy: not_received (the door decides what that means)', !g.ok && g.why === 'not_received');
  t('every refusal word is the engine\'s', ['wrong_step', 'read_only', 'not_received'].every((w) => Object.prototype.hasOwnProperty.call(rail.WHY, w)));

  console.log('\n— B · PUT /chits/:id/void over the real route —');
  world([{ entity_id: S, direction: 'sent', current_status: 'delivered' }, { entity_id: S, direction: 'received', current_status: 'completed' }]);
  let r = await call('PUT', '/api/chits/' + C1 + '/void', tok(S), { reason: 'ordered twice' });
  t('voiding a completed chit is refused 409 with why wrong_step', r.status === 409 && r.body.why === 'wrong_step' && r.body.from === 'completed', r.status + ' ' + JSON.stringify(r.body));
  t('…in words (what happened · what to do)', /cannot be withdrawn/.test(r.body.message || '') && /dispute/.test(r.body.message || ''));
  t('…and nothing was written — neither copy moved, no timeline row', updates().length === 0 && STATUS.every((x) => x.current_status !== 'cancelled') && !SENT.some((s) => /INSERT INTO state_log/.test(s)));
  world([{ entity_id: S, direction: 'sent', current_status: 'delivered' }]);
  r = await call('PUT', '/api/chits/' + C1 + '/void', tok(S), { reason: 'ordered twice' });
  t('voiding a delivered chit: 200, the sent copy cancelled through the gate', r.status === 200 && STATUS[0].current_status === 'cancelled'
    && GATES.some((x) => x.to === 'cancelled' && x.copy === 'sent'), r.status + ' ' + JSON.stringify(r.body));

  console.log('\n— C · each former bypass goes through statusGate —');
  world([{ entity_id: R, direction: 'received', current_status: 'accepted' }]);
  await chits._autoAssignReceived(R, C1);
  t('auto-assign: back to pending through the gate', GATES.some((x) => x.to === 'pending') && STATUS[0].current_status === 'pending');
  t('auto-assign: the assignment UPDATE no longer sets current_status', !SENT.some((s) => /assignment_type = 'auto'/.test(s) && /current_status/.test(s)));
  world([{ entity_id: R, direction: 'received', current_status: 'accepted' }, { entity_id: R, direction: 'sent', current_status: 'delivered' }]);
  r = await call('POST', '/api/chits/assign-bulk', tok(R), { chit_ids: [C1], target_actor_id: A1 });
  t('assign-bulk: back to pending through the gate — only the received copy', r.status === 200 && GATES.some((x) => x.to === 'pending')
    && STATUS.find((x) => x.direction === 'received').current_status === 'pending' && STATUS.find((x) => x.direction === 'sent').current_status === 'delivered', r.status + ' ' + JSON.stringify(r.body));
  world([{ entity_id: R, direction: 'received', current_status: 'in_progress' }]);
  r = await call('PUT', '/api/actors/assign/' + C1, tok(R), { action: 'pull' });
  t('actors pull: back to pending through the gate', r.status === 200 && GATES.some((x) => x.to === 'pending') && STATUS[0].current_status === 'pending', r.status + ' ' + JSON.stringify(r.body));
  world([{ entity_id: R, direction: 'received', current_status: 'accepted' }]);
  r = await call('PUT', '/api/actors/assign/' + C1, tok(R), { action: 'push', target_actor_id: A1 });
  t('actors push: back to pending through the gate', r.status === 200 && GATES.some((x) => x.to === 'pending') && STATUS[0].current_status === 'pending', r.status + ' ' + JSON.stringify(r.body));
  t('actors push: the status_pending timeline row carries the gate\'s from', SENT.some((s) => /'status_pending'/.test(s)));
  world([{ entity_id: R, direction: 'received', current_status: 'pending' }]);
  const mv = await chits.moveStatus(R, C1, 'accepted', { id: R, name: 'R' }, '', EDITOR);
  t('moveStatus: its write is the gate\'s write', mv.code === 200 && GATES.some((x) => x.to === 'accepted') && STATUS[0].current_status === 'accepted');
  for (const x of updates()) t('every status UPDATE names its copy (direction)', /direction = '(received|sent)'/.test(x), x);

  console.log('\n— D · THE GUARD: one place writes current_status —');
  /* a write = `current_status = <value>` inside a SET clause (after SET, before WHERE) or an ON CONFLICT … DO UPDATE SET */
  function writes(src) {
    const out = [];
    const re = /current_status\s*=\s*(\$\d+|'[a-z_]+'|EXCLUDED\.current_status|NULL)/gi;
    let m;
    while ((m = re.exec(src))) {
      const back = src.slice(Math.max(0, m.index - 800), m.index);
      const set = back.search(/\bSET\b(?![\s\S]*\bSET\b)/i);
      if (set < 0) continue;
      const between = back.slice(set);
      if (/\b(WHERE|AND|OR|ON|WHEN|SELECT|FROM)\b|[;`]/i.test(between.replace(/^SET/i, ''))) continue;
      out.push(src.slice(0, m.index).split('\n').length);
    }
    return out;
  }
  /* the scanner catches the forms the five bypasses used, and lets a filter through */
  t('scanner: a one-line SET is a write', writes("db.query(`UPDATE chit_status SET current_status = 'cancelled', updated_at = NOW() WHERE x`)").length === 1);
  t('scanner: a multi-line SET after other columns is a write', writes("`UPDATE chit_status\n SET assigned_to_actor_id = $1,\n assigned_at = NOW(), assignment_type = 'push',\n current_status = 'pending',\n updated_at = NOW()\n WHERE a`").length === 1);
  t('scanner: ON CONFLICT DO UPDATE SET is a write', writes('ON CONFLICT (chit_id) DO UPDATE SET current_status = EXCLUDED.current_status').length === 1);
  t('scanner: a WHERE filter is not a write', writes("UPDATE chit_status SET read_at = NOW() WHERE chit_id = $1 AND current_status = 'pending'").length === 0
    && writes("SELECT 1 FROM chit_status cs WHERE cs.current_status = $2").length === 0);
  const files = [];
  for (const dir of ['lib', 'routes']) {
    (function walk(d) {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) { if (f.name !== 'node_modules') walk(p); }
        else if (/\.(c?js|mjs)$/.test(f.name)) files.push(p);
      }
    })(path.join(API, dir));
  }
  const offenders = [];
  for (const f of files) {
    const rel = path.relative(API, f).split(path.sep).join('/');
    if (rel === 'lib/rail-status.js') continue;
    for (const line of writes(fs.readFileSync(f, 'utf8'))) offenders.push(rel + ':' + line);
  }
  t('no SQL in lib/ or routes/ writes current_status outside lib/rail-status.js (' + files.length + ' files)', offenders.length === 0,
    'write it through lib/rail-status statusGate: ' + offenders.join(', '));
  t('lib/rail-status.js holds the one write', writes(fs.readFileSync(path.join(API, 'lib', 'rail-status.js'), 'utf8')).length === 1);

  console.error = origErr;
  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error = origErr; console.error(e); process.exit(1); });
