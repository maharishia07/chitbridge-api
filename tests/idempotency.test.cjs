'use strict';
/**
 * idempotency.test.cjs — ⭐ LIM2 (W1-PLAT): WHEN IDEMPOTENCY IS OFF, A RETRY WARNS AND IS REFUSED (DISCIPLINES §7, middleware row:
 * each rule it enforces · the refusal path · fail-closed · no empty catch).
 *
 * Before: an unreadable token, a body the canon could not fingerprint, and a store error each made middleware/idempotency.js step
 * aside in SILENCE — the retried mutation ran a second time. Now every "off" path writes a warn line (lib/logger) and the key is held in
 * a bounded per-process memory with the store's own contract: a retry gets the recorded answer (X-Idempotent-Replay) or 409
 * IDEMPOTENCY_IN_PROGRESS, a different body gets 422 IDEMPOTENCY_CONFLICT, and every such answer says `X-Idempotency: unverified`.
 *
 * Offline: db, jwt-verify and the logger are recorders. Run: node tests/idempotency.test.cjs
 */
const assert = require('assert'), path = require('path'), fs = require('fs');
const API = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { fail++; console.log('  FAIL ' + what + '\n      ' + e.message); } };

/* ── recorders ── */
let storeRows = {};            /* (entity\nkey) → the idempotency_key row the "database" holds */
let storeError = null;         /* set → every store call rejects with it (the store is OFF) */
let stmts = [];
const dbStub = {
  withEntity: async (entity, fn) => {
    if (storeError) throw storeError;
    return fn({ query: async (sql, params) => {
      stmts.push(sql);
      const slot = entity + '\n' + params[/INSERT/.test(sql) ? 1 : (/\$3\)/.test(sql) && /FROM idempotency_key WHERE entity_id = \$1 AND idem_key = \$3/.test(sql) ? 2 : 1)];
      if (/^\s*SELECT/.test(sql)) return { rows: storeRows[slot] ? [Object.assign({ expired: false }, storeRows[slot])] : [] };
      if (/INSERT/.test(sql)) { if (storeRows[slot]) return { rows: [] }; storeRows[slot] = { idem_key: params[1], req_hash: params[4], state: 'in_progress', status: null, response: null }; return { rows: [{ idem_key: params[1] }] }; }
      if (/UPDATE/.test(sql)) { Object.assign(storeRows[slot], { state: 'done', status: params[2], response: JSON.parse(params[3]) }); return { rows: [] }; }
      if (/DELETE/.test(sql) && !/idem_key <>/.test(sql)) { delete storeRows[slot]; return { rows: [] }; }
      return { rows: [] };
    } });
  },
};
let tokenClaims = { identity_id: 'shop-1' };
let tokenThrows = null;
const jwtStub = { verifyJwt: () => { if (tokenThrows) throw tokenThrows; return { claims: tokenClaims }; } };
const warns = [];
const logStub = { warn: (msg, ctx) => warns.push({ msg, ctx }), info() {}, debug() {}, error: (msg, ctx) => warns.push({ msg, ctx, level: 'error' }), critical() {}, fellBack: (msg) => warns.push({ msg }) };
const stub = (rel, exports) => { const id = path.join(API, rel); require.cache[require.resolve(id)] = { id, filename: id, loaded: true, exports }; };
stub('db', dbStub); stub('lib/jwt-verify', jwtStub); stub('lib/logger', logStub);
const idempotency = require(path.join(API, 'middleware', 'idempotency'));

/* ── one request through the middleware, with a route that answers what it is told ── */
function send(o) {
  const x = o || {};
  const req = { id: 'req-' + Math.random().toString(36).slice(2, 7), method: x.method || 'POST', path: x.path || '/api/chits', body: x.body || { a: 1 },
    headers: Object.assign({ authorization: 'Bearer t' }, x.key ? { 'idempotency-key': x.key } : {}, x.headers || {}) };
  const res = { statusCode: 200, headers: {}, body: undefined,
    status(s) { this.statusCode = s; return this; }, setHeader(k, v) { this.headers[k] = v; }, json(b) { this.body = b; return this; } };
  let ran = false;
  return new Promise((resolve) => {
    const finish = () => setTimeout(() => resolve({ ran, status: res.statusCode, body: res.body, headers: res.headers }), 5);
    idempotency(req, res, () => { ran = true; if (x.answer) { res.status(x.answer.status || 200).json(x.answer.body); } finish(); });
    setTimeout(finish, 20);   /* a refusal never calls next */
  });
}
const reset = () => { storeRows = {}; storeError = null; stmts = []; warns.length = 0; tokenThrows = null; tokenClaims = { identity_id: 'shop-1' }; idempotency._memory.clear(); };

(async () => {
  console.log('\nIDEMPOTENCY — off is never silent, a retry never runs twice in this process\n');

  await ita('no Idempotency-Key, or a GET → untouched (next, no store call, no warn)', async () => {
    reset(); const r1 = await send({}); const r2 = await send({ key: 'k', method: 'GET' });
    assert.ok(r1.ran && r2.ran); assert.strictEqual(stmts.length, 0); assert.strictEqual(warns.length, 0);
  });
  await ita('the store works: the first request runs and is recorded; the retry is the recorded answer (X-Idempotent-Replay), never a second run', async () => {
    reset();
    const first = await send({ key: 'k1', answer: { status: 201, body: { chit_id: 'c1' } } });
    assert.ok(first.ran); assert.strictEqual(first.status, 201); assert.strictEqual(first.headers['X-Idempotency'], undefined, 'a verified answer carries no unverified mark');
    const retry = await send({ key: 'k1' });
    assert.strictEqual(retry.ran, false); assert.strictEqual(retry.status, 201); assert.deepStrictEqual(retry.body, { chit_id: 'c1' }); assert.strictEqual(retry.headers['X-Idempotent-Replay'], 'true');
    assert.strictEqual(warns.length, 0, 'nothing to warn about');
  });
  await ita('the store works: the same key with a different body → 422 IDEMPOTENCY_CONFLICT (a code the client branches on)', async () => {
    reset(); await send({ key: 'k2', answer: { body: { ok: true } } });
    const other = await send({ key: 'k2', body: { a: 2 } });
    assert.strictEqual(other.status, 422); assert.strictEqual(other.body.code, 'IDEMPOTENCY_CONFLICT'); assert.strictEqual(other.ran, false);
  });
  await ita('the store is OFF (table missing, pre-b109): the request still runs, the answer says X-Idempotency: unverified, and a warn line names the why', async () => {
    reset(); storeError = Object.assign(new Error('relation "idempotency_key" does not exist'), { code: '42P01' });
    const first = await send({ key: 'k3', answer: { body: { chit_id: 'c3' } } });
    assert.ok(first.ran); assert.strictEqual(first.headers['X-Idempotency'], 'unverified');
    assert.ok(warns.some((w) => /store off/.test(w.msg) && /b109/.test(w.ctx.why) && w.ctx.id), 'a warn with the request id and the reason: ' + JSON.stringify(warns));
  });
  await ita('the store is OFF: the retry is REFUSED with the recorded answer (X-Idempotent-Replay + unverified) — the route does not run again', async () => {
    reset(); storeError = Object.assign(new Error('boom'), { code: '08006' });
    await send({ key: 'k4', answer: { status: 201, body: { chit_id: 'c4' } } });
    const retry = await send({ key: 'k4' });
    assert.strictEqual(retry.ran, false, 'the route ran a second time'); assert.strictEqual(retry.status, 201); assert.deepStrictEqual(retry.body, { chit_id: 'c4' });
    assert.strictEqual(retry.headers['X-Idempotent-Replay'], 'true'); assert.strictEqual(retry.headers['X-Idempotency'], 'unverified');
    assert.ok(warns.filter((w) => /store off/.test(w.msg)).length >= 2, 'both requests warned');
  });
  await ita('the store is OFF: a retry while the first is still running → 409 IDEMPOTENCY_IN_PROGRESS', async () => {
    reset(); storeError = new Error('boom');
    const slow = send({ key: 'k5' });   /* next is called but the route never answers within this test's window */
    const retry = await send({ key: 'k5' });
    assert.strictEqual(retry.status, 409); assert.strictEqual(retry.body.code, 'IDEMPOTENCY_IN_PROGRESS'); assert.strictEqual(retry.ran, false);
    await slow;
  });
  await ita('the store is OFF: the same key with another body → 422 IDEMPOTENCY_CONFLICT; a 500 answer is not an outcome — the retry runs again', async () => {
    reset(); storeError = new Error('boom');
    await send({ key: 'k6', answer: { body: { ok: true } } });
    const other = await send({ key: 'k6', body: { b: 2 } }); assert.strictEqual(other.status, 422); assert.strictEqual(other.body.code, 'IDEMPOTENCY_CONFLICT');
    await send({ key: 'k7', answer: { status: 500, body: { error: 'Failed' } } });
    const again = await send({ key: 'k7', answer: { body: { ok: true } } }); assert.ok(again.ran, 'after a 500 the retry runs'); assert.strictEqual(again.status, 200);
  });
  await ita('a body the canon cannot fingerprint → held by key alone in memory (warned), the retry refused — never a silent skip', async () => {
    reset(); let deep = {}; for (let i = 0; i < 400; i++) deep = { d: deep };
    const first = await send({ key: 'k8', body: deep, answer: { body: { ok: true } } });
    assert.ok(first.ran); assert.strictEqual(first.headers['X-Idempotency'], 'unverified');
    assert.ok(warns.some((w) => /fingerprint/.test(w.msg)), 'the fingerprint failure is warned');
    const retry = await send({ key: 'k8', body: deep }); assert.strictEqual(retry.ran, false); assert.strictEqual(retry.headers['X-Idempotent-Replay'], 'true');
  });
  await ita('an unreadable token → the route\'s auth decides (next), and it is SAID (warn), never a bare catch', async () => {
    reset(); tokenThrows = new Error('jwt malformed');
    const r = await send({ key: 'k9' });
    assert.ok(r.ran); assert.strictEqual(stmts.length, 0); assert.ok(warns.some((w) => /no scope/.test(w.msg) && /jwt malformed/.test(w.ctx.why)));
  });
  await ita('the memory is bounded: past UNVERIFIED_MEMORY_MAX keys the oldest is forgotten (never unbounded growth)', async () => {
    reset(); storeError = new Error('boom');
    const max = idempotency.UNVERIFIED_MEMORY_MAX;
    for (let i = 0; i < max + 5; i++) await idempotency._memory.begin('shop-1', 'm' + i, { method: 'POST', path: '/x' }, 'h', 48);
    assert.strictEqual(idempotency._memory.size(), max);
    const oldest = await idempotency._memory.begin('shop-1', 'm0', { method: 'POST', path: '/x' }, 'h', 48);
    assert.ok(oldest.claimed, 'm0 was forgotten and can be claimed again');
  });
  await ita('L3 · a key stuck in_progress past the stale minutes is reclaimable; a fresh one still refuses (memory store)', async () => {
    reset(); storeError = new Error('boom');
    const fresh = await idempotency._memory.begin('shop-1', 'stale1', { method: 'POST', path: '/x' }, 'h', 48);
    assert.ok(fresh.claimed);
    assert.ok((await idempotency._memory.begin('shop-1', 'stale1', { method: 'POST', path: '/x' }, 'h', 48)).existing, 'still running → refused');
    const realNow = Date.now; Date.now = () => realNow() + (idempotency.IN_PROGRESS_STALE_MINUTES + 1) * 60000;
    try { assert.ok((await idempotency._memory.begin('shop-1', 'stale1', { method: 'POST', path: '/x' }, 'h', 48)).claimed, 'crashed request → the retry may claim it'); }
    finally { Date.now = realNow; }
  });
  await ita('L3 · the durable store treats an old in_progress row as expired (the SQL carries the stale term)', async () => {
    reset(); await send({ key: 'k-sql' });
    const select = stmts.find((q) => /^\s*SELECT/.test(q) && /expired/.test(q));
    assert.ok(/state = 'in_progress' AND created_at < now\(\) - \(\$4 \|\| ' minutes'\)/.test(select), 'stale in_progress is expired');
  });
  /* ── ⭐ API-3 S36 · the public money doors (order/start, order/confirm): no bearer, so the door names the shop and the contact ── */
  const SHOPS = { 'shop-a': { identity_id: 'ent-a' }, 'shop-b': { identity_id: 'ent-b' } };
  let shopFails = null;
  const gate = idempotency.requireKey({
    shopOf: async (req) => { if (shopFails) throw shopFails; return SHOPS[req.params.bridge_id] || null; },
    contactOf: (req) => req.body.identifier || null
  });
  function tap(o) {
    const req = { id: 'req-pub', method: 'POST', path: '/' + o.shop + '/order/confirm', params: { bridge_id: o.shop }, body: { identifier: o.contact, line_items: [1] },
      headers: o.key === undefined ? {} : { 'idempotency-key': o.key } };
    const res = { statusCode: 200, headers: {}, body: undefined, locals: {},
      status(code) { this.statusCode = code; return this; }, setHeader(k, v) { this.headers[k] = v; }, set(k, v) { this.headers[k] = v; }, json(b) { this.body = b; return this; } };
    let ran = false;
    return new Promise((resolve) => {
      const finish = () => setTimeout(() => resolve({ ran, status: res.statusCode, body: res.body, headers: res.headers }), 5);
      gate(req, res, () => { ran = true; res.status(200).json({ order: o.contact + '@' + o.shop }); finish(); });
      setTimeout(finish, 20);
    });
  }
  await ita('S36 · the gate is named requireIdempotencyKey — tools/api-register.cjs finds a money door\'s gate by that name', async () => {
    assert.strictEqual(gate.name, 'requireIdempotencyKey');
  });
  await ita('S36 · no key, or one longer than 200 → 422 IDEMPOTENCY_KEY_REQUIRED as a Problem with the old words; nothing runs, nothing is stored', async () => {
    reset(); shopFails = null;
    for (const key of [undefined, '', 'k'.repeat(201)]) {
      const r = await tap({ shop: 'shop-a', contact: 'a@b.co', key });
      assert.strictEqual(r.status, 422); assert.strictEqual(r.ran, false); assert.strictEqual(r.body.code, 'IDEMPOTENCY_KEY_REQUIRED');
      assert.strictEqual(r.body.error, 'Missing Idempotency-Key'); assert.ok(/Idempotency-Key/.test(r.body.message)); assert.strictEqual(r.body.status, 422);
    }
    assert.strictEqual(stmts.length, 0);
  });
  await ita('S36 · no such shop, no usable contact, or the shop read failing → the route answers (next), nothing stored', async () => {
    reset();
    assert.ok((await tap({ shop: 'shop-x', contact: 'a@b.co', key: 'k' })).ran, 'unknown shop: the route says 404');
    assert.ok((await tap({ shop: 'shop-a', contact: null, key: 'k' })).ran, 'no contact: the route says 422');
    shopFails = new Error('db down');
    assert.ok((await tap({ shop: 'shop-a', contact: 'a@b.co', key: 'k' })).ran, 'the read failed: the route reads again and answers its own 500');
    shopFails = null;
    assert.strictEqual(stmts.length, 0);
  });
  await ita('S36 · one shop, one contact, one key → the retry is the recorded answer, never a second run', async () => {
    reset();
    const first = await tap({ shop: 'shop-a', contact: 'a@b.co', key: 'k1' });
    const retry = await tap({ shop: 'shop-a', contact: 'a@b.co', key: 'k1' });
    assert.ok(first.ran); assert.strictEqual(retry.ran, false); assert.deepStrictEqual(retry.body, first.body); assert.strictEqual(retry.headers['X-Idempotent-Replay'], 'true');
  });
  await ita('S36 · scoped by shop AND contact: the same key from another shopper, or on another shop, is its own attempt', async () => {
    reset();
    const mine = await tap({ shop: 'shop-a', contact: 'a@b.co', key: 'same' });
    const theirs = await tap({ shop: 'shop-a', contact: 'c@d.co', key: 'same' });
    const elsewhere = await tap({ shop: 'shop-b', contact: 'a@b.co', key: 'same' });
    assert.ok(mine.ran && theirs.ran && elsewhere.ran, 'three attempts, three runs');
    assert.deepStrictEqual(theirs.body, { order: 'c@d.co@shop-a' }, 'never another shopper\'s answer');
    assert.deepStrictEqual(Object.keys(storeRows).map((slot) => slot.split('\n')[0]).sort(), ['ent-a', 'ent-a', 'ent-b'], 'each row sits inside its shop\'s RLS entity');
  });
  await ita('S36 · the contact is never kept in clear: the stored key holds its hash', async () => {
    reset();
    await tap({ shop: 'shop-a', contact: 'a@b.co', key: 'k2' });
    const slots = Object.keys(storeRows);
    assert.strictEqual(slots.length, 1); assert.ok(!/a@b\.co/.test(slots[0]), slots[0]); assert.ok(/^ent-a\npublic [0-9a-f]{32} k2$/.test(slots[0]), slots[0]);
  });
  await ita('S36 · the conflict and in-progress answers are Problems that keep code, error and message', async () => {
    reset();
    await tap({ shop: 'shop-a', contact: 'a@b.co', key: 'k3' });
    const other = await send({ key: 'g1', answer: { status: 200, body: {} } });
    const conflict = await send({ key: 'g1', body: { b: 2 } });
    assert.ok(other.ran); assert.strictEqual(conflict.status, 422);
    assert.deepStrictEqual([conflict.body.code, conflict.body.error, conflict.body.status], ['IDEMPOTENCY_CONFLICT', 'Idempotency conflict', 422]);
    assert.ok(conflict.body.message && conflict.body.detail === conflict.body.message);
  });
  /* ── SEC (laptop1, 23 Oct): an answer that carries a token replays for TOKEN_REPLAY_MINUTES, then is no longer kept ── */
  await ita('SEC · a token answer replays within 15 minutes and not after (memory store); a tokenless one keeps the full window', async () => {
    reset(); storeError = new Error('boom');
    assert.strictEqual(idempotency.TOKEN_REPLAY_MINUTES, 15);
    await send({ key: 'tok', answer: { status: 200, body: { token: 't', chit_id: 'c' } } });
    await send({ key: 'plain', answer: { status: 200, body: { chit_id: 'c' } } });
    assert.strictEqual((await send({ key: 'tok' })).ran, false, 'within the minutes: the retry is the recorded answer');
    const realNow = Date.now; Date.now = () => realNow() + (idempotency.TOKEN_REPLAY_MINUTES + 1) * 60000;
    try {
      assert.strictEqual((await send({ key: 'tok' })).ran, true, 'past them: the token is not replayed, the request runs as new');
      assert.strictEqual((await send({ key: 'plain' })).ran, false, 'an answer without a token still replays');
    } finally { Date.now = realNow; }
  });
  await ita('SEC · the durable store: the expiry carries the token term, and recording a token answer sweeps the shop\'s older ones', async () => {
    reset();
    await send({ key: 'tok-db', answer: { status: 200, body: { token: 't' } } });
    const select = stmts.find((q) => /^\s*SELECT/.test(q) && /expired/.test(q));
    assert.ok(/response \? 'token' AND created_at < now\(\) - \(\$5 \|\| ' minutes'\)/.test(select), 'a token answer expires on the minutes');
    const sweep = stmts.find((q) => /DELETE FROM idempotency_key/.test(q) && /idem_key <> \$2/.test(q));
    assert.ok(sweep && /response \? 'token'/.test(sweep), 'older token answers of this shop are deleted');
    assert.ok(storeRows['shop-1\ntok-db'], 'the answer just recorded stays for its retry');
    reset();
    await send({ key: 'plain-db', answer: { status: 200, body: { chit_id: 'c' } } });
    assert.ok(!stmts.some((q) => /idem_key <>/.test(q)), 'no sweep when the answer carries no token');
  });
  await ita('no empty catch in middleware/idempotency.js and no console.* — the logger says what the person sees instead', async () => {
    const src = fs.readFileSync(path.join(API, 'middleware', 'idempotency.js'), 'utf8');
    assert.ok(!/catch\s*\(\s*_?\s*\)\s*\{\s*(return[^;]*;)?\s*\}/.test(src), 'an empty catch is back');
    assert.ok(!/console\.(warn|log|error)/.test(src), 'console.* is back — use lib/logger');
  });

  console.log('\n  ' + (pass + fail) + ' checks' + (fail ? ', ' + fail + ' FAILED' : '') + '\n');
  if (fail) process.exitCode = 1;
})();
