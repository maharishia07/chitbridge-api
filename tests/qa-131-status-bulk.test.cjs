/**
 * tests/qa-131-status-bulk.test.cjs — QA-131: a bulk status change is ONE call per record, names the status it saw, and is safe to replay.
 *   A  from: a record that moved since is REFUSED (409 status_from_changed) and nothing is written — never moved back
 *   B  use: said in the same call, through lib/bill-use set(), after the from-check (a moved record writes no choice) and only with an acceptance
 *   C  the single move (no from, no use) answers exactly the body it always did
 *   D  replay through the REAL middleware/idempotency: the second send with the same key answers the stored answer; the books hook,
 *      the other-installation tell and the choice happen ONCE
 * Offline: db, books, ctp and bill-use are recorders. Run: node tests/qa-131-status-bulk.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = 'test-only-qa131';
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
let pass = 0, fail = 0;
const t = (n, ok, x) => { if (ok) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n       ' + x : '')); } };
const R = 'bbbbbbbb-0000-4000-8000-00000000000b', C1 = '0000c417-0000-4000-8000-0000000000c1';
let ROWS = [], WRITES = [], IDEM = {};
const one = (s) => String(s).replace(/\s+/g, ' ').trim();
const q = async (sql, p) => {
  const s = one(sql); p = p || [];
  if (/idempotency_key/.test(s)) {
    /* the real middleware's store, in memory: one row per key */
    if (/^SELECT/.test(s)) { const hit = IDEM[p[p.length - 1]] || IDEM[p[1]]; return { rows: hit ? [Object.assign({ expired: false }, hit)] : [] }; }
    if (/INSERT/.test(s)) { if (IDEM[p[1]]) return { rows: [] }; IDEM[p[1]] = { idem_key: p[1], req_hash: p[4], state: 'in_progress', status: null, response: null }; return { rows: [{ idem_key: p[1] }] }; }
    if (/UPDATE/.test(s)) { if (IDEM[p[1]]) Object.assign(IDEM[p[1]], { state: 'done', status: p[2], response: JSON.parse(p[3]) }); return { rows: [] }; }
    return { rows: [] };
  }
  if (/^SELECT current_status FROM chit_status/.test(s)) return { rows: ROWS.filter((r) => r.chit_id === p[0] && r.entity_id === p[1]).map((r) => ({ current_status: r.current_status })) };
  if (/^UPDATE chit_status SET current_status = \$1/.test(s)) {
    const hit = ROWS.filter((r) => r.chit_id === p[1] && r.entity_id === p[2] && r.current_status === p[3]);
    hit.forEach((r) => { r.current_status = p[0]; WRITES.push(p[0]); });
    return { rows: hit.map((r) => ({ chit_id: r.chit_id })), rowCount: hit.length };
  }
  if (/FROM chit_header/.test(s)) return { rows: [{ sender_entity_id: 'sss', purpose: 'order', business_json: {}, all_recipients: [] }] };
  return { rows: [], rowCount: 0 };
};
const tx = { query: q };
const stub = (rel, exports) => { const id = require.resolve(path.join(API, rel)); require.cache[id] = { id, filename: id, loaded: true, exports }; };
stub('db', { query: q, pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) }, withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx), onEntity: async (i, d, fn) => fn(tx), readBatch: async () => ({}), trySavepoint: async (d, fn) => fn(d) });
stub('middleware/auth', (req, res, next) => next());
stub('lib/jwt-verify', { verifyJwt: () => ({ claims: { identity_id: R } }) });
const sc = require(path.join(API, 'lib', 'schema')); sc.hasColumn = async () => false; sc.hasTable = async () => false;
let BOOKS = 0, TOLD = 0, USED = [], USE_OK = true;
const hooks = require(path.join(API, 'lib', 'books-hooks')); hooks.afterChit = () => { BOOKS++; return Promise.resolve({}); }; hooks.takeBackCancelled = async () => null;
const ctp = require(path.join(API, 'lib', 'ctpreturn')); ctp.onStatusMoved = async () => { TOLD++; return null; };
require(path.join(API, 'lib', 'bill-use')).set = async (e, c, body) => { USED.push(body.use); return USE_OK ? { ok: true, use: body } : { ok: false, status: 409, message: 'already accepted' }; };
require(path.join(API, 'lib', 'chit-crossing')).crossing = async () => null;
require(path.join(API, 'lib', 'bill-privacy')).writeStep = async () => null;
const cm = require(path.join(API, 'lib', 'chit-move'));
const { moveStatus } = cm;
const idem = require(path.join(API, 'middleware', 'idempotency'));
const E = { level: 'editor' }, BY = { id: R, name: 'R' };
const world = (st) => { ROWS = [{ chit_id: C1, entity_id: R, direction: 'received', current_status: st }]; WRITES = []; BOOKS = 0; TOLD = 0; USED = []; USE_OK = true; IDEM = {}; };
const origErr = console.error; console.error = () => {};
(async () => {
  console.log('\n— A · from —');
  world('accepted');
  let r = await moveStatus(R, C1, 'in_progress', BY, '', E, { from: 'pending' });
  t('a moved record is refused 409 status_from_changed, with where it is now', r.code === 409 && r.body.code === 'status_from_changed' && r.body.current_status === 'accepted' && r.body.expected_from === 'pending', JSON.stringify(r));
  t('nothing was written, nothing was told', WRITES.length === 0 && ROWS[0].current_status === 'accepted' && BOOKS === 0 && TOLD === 0);
  world('pending');
  r = await moveStatus(R, C1, 'accepted', BY, '', E, { from: 'pending' });
  t('the expected status holds: it moves', r.code === 200 && r.moved === true && ROWS[0].current_status === 'accepted');
  world('accepted');
  r = await moveStatus(R, C1, 'accepted', BY, '', E, { from: 'pending' });
  t('already at the target: the same no-op 200 as today (a resume after a lost answer)', r.code === 200 && r.noop === true && WRITES.length === 0);

  console.log('\n— B · use —');
  world('pending');
  r = await moveStatus(R, C1, 'accepted', BY, '', E, { from: 'pending', use: 'resale' });
  t('use is saved once, before the move, and the move follows', r.code === 200 && USED.length === 1 && USED[0] === 'resale' && ROWS[0].current_status === 'accepted');
  world('pending');
  r = await moveStatus(R, C1, 'in_progress', BY, '', E, { use: 'resale' });
  t('use with a status that is not an acceptance is refused 400 status_use_unneeded, nothing written', r.code === 400 && r.body.code === 'status_use_unneeded' && USED.length === 0 && WRITES.length === 0);
  world('read');
  r = await moveStatus(R, C1, 'accepted', BY, '', E, { from: 'pending', use: 'use' });
  t('a moved record writes NO choice: refused from_changed first', r.code === 409 && r.body.code === 'status_from_changed' && USED.length === 0 && WRITES.length === 0);
  world('pending'); USE_OK = false;
  r = await moveStatus(R, C1, 'accepted', BY, '', E, { use: 'use' });
  t('a refused choice stops the move (409, the bill-use words), nothing moved', r.code === 409 && r.body.message === 'already accepted' && ROWS[0].current_status === 'pending');
  world('pending');
  r = await moveStatus(R, C1, 'accepted', BY, '', { level: 'viewer' }, { use: 'use' });
  t('a viewer writes no choice (the move refuses by level)', r.code === 403 && USED.length === 0);

  console.log('\n— C · the single move is unchanged —');
  world('pending');
  r = await moveStatus(R, C1, 'accepted', BY, 'ok', E);
  t('no opts: the 200 body is the one it always was', r.code === 200 && r.body.message === 'Chit accepted' && r.body.previous_status === 'pending' && r.body.new_status === 'accepted' && !('current_status' in r.body), JSON.stringify(r.body));
  world('accepted');
  r = await moveStatus(R, C1, 'in_progress', BY, '', E);
  t('no opts: a record moved on still moves from where it is (the single path never refuses on from)', r.code === 200 && ROWS[0].current_status === 'in_progress');

  console.log('\n— D · replay through the real idempotency middleware —');
  await new Promise((x) => setTimeout(x, 20)); /* earlier moves' books hooks run on setImmediate */
  world('pending');
  const send = (key, body) => new Promise((resolve) => {
    const req = { id: 'r', method: 'PUT', path: '/api/chits/' + C1 + '/status', body, headers: { authorization: 'Bearer t', 'idempotency-key': key } };
    const res = { statusCode: 200, headers: {}, body: undefined, status(s) { this.statusCode = s; return this; }, setHeader(k, v) { this.headers[k] = v; }, json(b) { this.body = b; return this; } };
    let ran = false;
    const done = () => setTimeout(() => resolve({ ran, status: res.statusCode, body: res.body, headers: res.headers }), 10);
    idem(req, res, async () => { ran = true; const m = await moveStatus(R, C1, body.status, BY, '', E, { from: body.from, use: body.use }); res.status(m.code).json(m.body); done(); });
    setTimeout(done, 60);
  });
  const body = { status: 'accepted', from: 'pending', use: 'resale' };
  const a = await send('k-1-step', body);
  await new Promise((x) => setTimeout(x, 30));
  const b = await send('k-1-step', body);
  t('first send ran and moved', a.ran && a.status === 200 && a.body.new_status === 'accepted', JSON.stringify(a));
  t('the replay did NOT run: it answers the stored answer', b.ran === false && b.status === 200 && b.body && b.body.new_status === 'accepted', JSON.stringify(b));
  await new Promise((x) => setTimeout(x, 20));
  t('books hook, other-installation tell, the choice and the write happened once', BOOKS === 1 && TOLD === 1 && USED.length === 1 && WRITES.length === 1, `books ${BOOKS} told ${TOLD} used ${USED.length} writes ${WRITES.length}`);
  const c = await send('k-1-step', { status: 'accepted', from: 'read', use: 'resale' });
  t('the same key with another body is refused 422, not run', c.ran === false && c.status === 422, c.status + '');
  console.error = origErr;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
