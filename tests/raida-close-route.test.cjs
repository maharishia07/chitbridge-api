/**
 * tests/raida-close-route.test.cjs — RAIL-93: ending a register entry from a chit closes it end to end.
 *
 * OWNS      the route half of POST /api/chits/:chit_id/raida/:raida_id/close: what the worklist sends ({ body, disposition },
 *           cap-worklist wlRaidaEnd) reaches lib/raida.js close(), and the closing row is written with that disposition.
 * CALLED BY scripts/guards.cjs (the offline gate).
 * FLOW      real routes/chits.js on express ──▶ stubbed auth + a stand-in db (full register: register_subject present) ──▶ POST close
 *           ──▶ the INSERT INTO register_entry carries the disposition, the carried-forward subject and the evidence
 * CARD      01-rail-core-the-chit/raida
 * Before the fix the route passed only { body, by_name }, so a full register refused every close: 400 "An ending needs a disposition".
 * No database: db and auth are stubbed; the route and lib/raida.js are the real ones.   Run: node tests/raida-close-route.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const CHIT = '22222222-2222-4222-8222-222222222222';
const ENTRY = '33333333-3333-4333-8333-333333333333';
const NEXT_SUBJECT = '44444444-4444-4444-8444-444444444444';

let SQL = [];
let CLOSED = false;   // whether the entry already has a closing row
function rowsFor(s, p) {
  if (/SELECT kind, line_id, closes_id, subject_id, chit_id FROM register_entry/.test(s)) {
    return p[1] === ENTRY ? [{ kind: 'risk', line_id: null, closes_id: null, subject_id: '55555555-5555-4555-8555-555555555555', chit_id: CHIT }] : [];
  }
  if (/SELECT 1 FROM register_entry WHERE entity_id = \$1 AND closes_id = \$2/.test(s)) return CLOSED ? [{ '?column?': 1 }] : [];
  if (/INSERT INTO register_entry/.test(s)) return [{ raida_id: '66666666-6666-4666-8666-666666666666', created_at: '2026-10-23T06:00:00Z' }];
  return [];
}
const tx = { query: async (s, p) => { const text = String(s).replace(/\s+/g, ' ').trim(); SQL.push({ s: text, p }); return { rows: rowsFor(text, p || []), rowCount: 1 }; } };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: tx.query, withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
  onEntity: async (id, db, fn) => fn(tx),
} };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Traders' }; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n(),
    userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };
/* the full register (b185): register_subject exists, so close() demands a disposition */
const schema = require(path.join(API, 'lib', 'schema'));
schema.hasTable = async (t) => t === 'register_subject' || t === 'register_entry';
schema.hasColumn = async () => true;

const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const insertArgs = () => (SQL.find((x) => /INSERT INTO register_entry/.test(x.s)) || {}).p;

const srv = app.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  const close = async (body, entry) => { SQL = []; const r = await fetch(`${base}/api/chits/${CHIT}/raida/${entry || ENTRY}/close`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) }; };
  try {
    console.log('\n══ RAIL-93 · an ending from the worklist closes the entry ══\n');
    let r = await close({ body: 'Booked the slot.', disposition: 'resolved' });
    ok('the worklist\'s { body, disposition } closes it: 200', r.status === 200, JSON.stringify(r.body));
    ok('the answer names the entry and the disposition', r.body.closed === ENTRY && r.body.disposition === 'resolved', JSON.stringify(r.body));
    const a = insertArgs() || [];
    ok('one closing row is written, closing that entry', !!insertArgs() && a[6] === ENTRY, JSON.stringify(a));
    ok('the closing row carries the disposition', a[7] === 'resolved', JSON.stringify(a));
    ok('the closing row carries the words and who ended it', a[5] === 'Booked the slot.' && a[12] === 'Mayur Traders', JSON.stringify(a));

    r = await close({ body: 'Next audit.', disposition: 'carried_forward', carried_to_subject_id: NEXT_SUBJECT, evidence_ref: 'IMG-12', evidence_hash: 'abc123' });
    const c = insertArgs() || [];
    ok('carried forward with its register: 200, and the row names where it went and its evidence',
      r.status === 200 && c[8] === NEXT_SUBJECT && c[9] === 'IMG-12' && c[10] === 'abc123', r.status + ' ' + JSON.stringify(c));

    r = await close({ body: 'Later.', disposition: 'carried_forward' });
    ok('carried forward with no register is still refused (400), nothing written', r.status === 400 && !insertArgs(), r.status + ' ' + JSON.stringify(r.body));

    r = await close({ body: 'Done.' });
    ok('no disposition is still refused on a full register (400), nothing written', r.status === 400 && /disposition/i.test(r.body.message || '') && !insertArgs(), JSON.stringify(r.body));

    r = await close({ body: 'Done.', disposition: 'fixed-ish' });
    ok('an unknown disposition is refused (400) and named', r.status === 400 && /must be one of/.test(r.body.message || ''), JSON.stringify(r.body));

    CLOSED = true;
    r = await close({ body: 'Again.', disposition: 'resolved' });
    ok('a second ending is refused (400): one entry, one ending', r.status === 400 && /already closed/.test(r.body.message || ''), JSON.stringify(r.body));
    CLOSED = false;
  } catch (e) {
    fail++; console.log('   FAIL threw: ' + (e && e.stack || e));
  } finally {
    srv.close();
    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    /* exitCode, not exit(): exit() while the closing server socket is mid-close aborts Node 24 on Windows (UV_HANDLE_CLOSING, src/win/async.c:94) - the 10 checks passed, then the process crashed (QA-82) */
    process.exitCode = fail ? 1 : 0;
    if (srv.closeAllConnections) srv.closeAllConnections();
  }
});
