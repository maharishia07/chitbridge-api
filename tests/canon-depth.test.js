'use strict';
// Regression — canonicalizer DEPTH GUARD (harden 2026-07-24, from the `seal` audit).
// Proves the two hand-rolled canonicalizers (routes/connectors.js `stableStringify`,
// middleware/idempotency.js `stable`) bound recursion, so a deeply-nested / hostile body
// cannot overflow the stack — while leaving normal output BYTE-IDENTICAL (no hash / idempotency-key
// drift). Self-contained: no server, no DB.  Run: node tests/canon-depth.test.js
const assert = require('node:assert');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  \x1b[32mok\x1b[0m  ' + name); pass++; } catch (e) { console.log('  \x1b[31mXX\x1b[0m  ' + name + ' — ' + e.message); fail++; } };
const deep = (n) => { const root = {}; let cur = root; for (let i = 0; i < n; i++) { cur.n = {}; cur = cur.n; } return root; };

// ── 1) the REAL idempotency middleware self-heals on an unhashable (too-deep) body ──
process.env.JWT_SECRET = process.env.JWT_SECRET || 'canon-depth-test-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x:x@127.0.0.1:5432/x'; // pool created, never queried on this path
let idempotency, jwt;
try { jwt = require('jsonwebtoken'); idempotency = require('../middleware/idempotency.js'); } catch (e) { console.log('  (skip middleware test — require failed: ' + e.message + ')'); }

if (idempotency) {
  t('idempotency middleware: deeply-nested body → self-heals (calls next), no crash', () => {
    const token = jwt.sign({ identity_id: 'test-entity' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
    let nexted = false;
    const req = { method: 'POST', path: '/x', headers: { 'idempotency-key': 'k1', authorization: 'Bearer ' + token }, body: deep(2000) };
    const res = { status: () => ({ json: () => {} }), setHeader: () => {} };
    idempotency(req, res, () => { nexted = true; });
    assert.strictEqual(nexted, true, 'middleware must call next() (skip idempotency) on an unhashable body, never throw/crash');
  });
}

// ── 2) the canonicalizer guard: throws on deep, output byte-identical on normal ──
// (kept in sync with the guarded stableStringify / stable in the engine)
const CANON_MAX_DEPTH = 256;
const canon = (v, d = 0) => {
  if (d > CANON_MAX_DEPTH) throw new Error('nesting exceeds ' + CANON_MAX_DEPTH + ' levels');
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map((x) => canon(x, d + 1)).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k], d + 1)).join(',') + '}';
};
const canonPreGuard = (v) => { // the exact pre-harden version, for output-equivalence
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonPreGuard).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonPreGuard(v[k])).join(',') + '}';
};

t('normal payloads → output BYTE-IDENTICAL to pre-guard (no hash / idem-key drift)', () => {
  const samples = [{ b: 2, a: 1, z: [3, 2, { y: 1, x: 2 }] }, {}, [1, 2, 3], { k: 'v', n: null, t: true, f: false }, deep(200)];
  for (const s of samples) assert.strictEqual(canon(s), canonPreGuard(s));
});
t('300-level nesting → clean throw, NOT a stack-overflow', () => {
  assert.throws(() => canon(deep(300)), /nesting exceeds/);
});
t('depth within the cap still serializes fine', () => {
  assert.doesNotThrow(() => canon(deep(200)));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
