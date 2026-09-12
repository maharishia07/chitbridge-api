'use strict';
// canon.test.js — lib/canon.js is BYTE-IDENTICAL to the three hand-rolled copies it replaces.
//
// ⚠️⚠️ THIS IS A CHARACTERISATION AND IT SAYS SO. It does not assert that canon() is CORRECT in the abstract;
// it asserts that it produces exactly what routes/connectors.js and middleware/idempotency.js already produce.
// That is the only property that matters at the moment of extraction, because both are LIVE and both PERSIST
// their output: an idempotency key that changes shape stops matching the replay it exists to catch, so the
// same mutation runs twice; a connector receipt hash that changes stops matching the receipt already written
// on the other side of the wire.
//
// ⭐ The originals are copied in here DELIBERATELY, exactly as they are written today. A characterisation that
// imports the thing it is characterising proves nothing. When the call sites adopt canon.js these copies stay,
// and they become the record of what the output was on the day it was unified.
//
// Run: node tests/canon.test.js   · no network, no DB.
const assert = require('node:assert');
const C = require('../lib/canon');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  XX  ' + name + ' — ' + e.message); fail++; }
};

/* ── the originals, verbatim ─────────────────────────────────────────────────────────────────────────────── */
const CANON_MAX_DEPTH = 256;

/** middleware/idempotency.js `stable`, as at 2026-09-12 */
function stable(o, depth = 0) {
  if (depth > CANON_MAX_DEPTH) throw new Error('request body nesting exceeds ' + CANON_MAX_DEPTH + ' levels');
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map((x) => stable(x, depth + 1)).join(',') + ']';
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k], depth + 1)).join(',') + '}';
}

/** routes/connectors.js `stableStringify`, as at 2026-09-12 */
const stableStringify = (v, depth = 0) => {
  if (depth > CANON_MAX_DEPTH) throw new Error('payload nesting exceeds ' + CANON_MAX_DEPTH + ' levels');
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map((x) => stableStringify(x, depth + 1)).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k], depth + 1)).join(',') + '}';
};

/**
 * ── THE CORPUS ─────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ Shaped like what these two actually hash — a chit body and a connector receipt — not like a JSON tutorial.
 * The awkward cases are deliberate: a rupee sign and Tamil text (escaping), a null beside a missing key, an
 * empty array beside an empty object, a number that looks like a string, and a key order that differs.
 */
const CORPUS = [
  null, true, false, 0, -0, 1, 1.5, 1e21, '', 'plain',
  'quote " backslash \\ newline \n tab \t',
  '₹ 1,200.50 · கிலோ',
  [], {}, [[]], [{}], [null, undefined],
  { a: 1, b: 2 },
  { b: 2, a: 1 },
  { z: null, a: undefined, m: 0 },
  [1, 2, 3], [3, 2, 1],
  /* a chit-shaped body */
  { chit_id: 'c-1', recipients: [{ kind: 'to', bridge_id: 'CBV97P3TYA' }, { kind: 'cc', bridge_id: 'CBXX11' }],
    summary_json: { total: { amount: 1200.5, currency: 'INR' }, lines: 2, note: '₹ total' },
    business_json: { po: 'PO/2026/0041', terms: null } },
  /* a connector receipt */
  { kind: 'order', ref: 'ORD-9', hash: null, outcome: 'ok', their_ref: 'TALLY/44',
    counters: { sent: 3, failed: 0 }, at: '2026-09-12T05:00:00.000Z' },
  /* nesting that is deep but legal */
  (function () { const r = {}; let c = r; for (let i = 0; i < 60; i++) { c.n = {}; c = c.n; } return r; })(),
];

t('⭐⭐⭐ byte-identical to middleware/idempotency.js `stable`, over the whole corpus', () => {
  CORPUS.forEach((v, i) => {
    assert.strictEqual(C.canon(v), stable(v), 'corpus[' + i + '] diverges');
  });
});

t('⭐⭐⭐ byte-identical to routes/connectors.js `stableStringify`, over the whole corpus', () => {
  CORPUS.forEach((v, i) => {
    assert.strictEqual(C.canon(v), stableStringify(v), 'corpus[' + i + '] diverges');
  });
});

t('the same value in a different key order is the same bytes', () => {
  assert.strictEqual(C.canon({ a: 1, b: 2 }), C.canon({ b: 2, a: 1 }));
  assert.strictEqual(C.hash({ a: 1, b: 2 }), C.hash({ b: 2, a: 1 }));
});

t('⚠️ an ARRAY keeps its order — sorting one would make two different values identical', () => {
  assert.notStrictEqual(C.canon([1, 2]), C.canon([2, 1]));
});

t('⚠️ depth is bounded, and it throws rather than overflowing the stack', () => {
  const deep = (n) => { const r = {}; let c = r; for (let i = 0; i < n; i++) { c.n = {}; c = c.n; } return r; };
  assert.doesNotThrow(() => C.canon(deep(200)));
  assert.throws(() => C.canon(deep(400)), /nesting exceeds/);
});

t('⚠️ …and the bound is the SAME 256 the originals used', () => {
  assert.strictEqual(C.MAX_DEPTH, CANON_MAX_DEPTH);
});

/* ── the seal ────────────────────────────────────────────────────────────────────────────────────────────── */

t('⭐ a seal carries WHAT IT COVERED, not just a hash', () => {
  const s = C.seal(['b', 'a'], { a: 1, b: 2, c: 3 });
  assert.deepStrictEqual(s.fields, ['a', 'b'], 'the field list is sorted, so two callers agree');
  assert.strictEqual(s.v, 1);
  assert.match(s.hash, /^[0-9a-f]{64}$/);
});

t('⭐ a field OUTSIDE the seal may change and the seal still holds', () => {
  const s = C.seal(['a'], { a: 1, note: 'mine' });
  assert.ok(C.verify(s, { a: 1, note: 'theirs' }).ok,
    'each party keeps its own copy: only the AGREED fields are sealed');
});

t('⭐⭐⭐ a field INSIDE the seal changing is caught', () => {
  const s = C.seal(['a'], { a: 1 });
  const v = C.verify(s, { a: 2 });
  assert.strictEqual(v.ok, false);
  assert.deepStrictEqual(v.covered, ['a']);
});

t('⚠️ a MISSING sealed field is not the same as a null one… and both are caught', () => {
  const s = C.seal(['a', 'b'], { a: 1, b: 2 });
  assert.strictEqual(C.verify(s, { a: 1 }).ok, false, 'b went missing');
  assert.strictEqual(C.verify(s, { a: 1, b: null }).ok, false, 'b became null');
});

t('⚠️⚠️ the FIELD LIST is part of the sealed value — a wider seal is a different seal', () => {
  const narrow = C.seal(['a'], { a: 1, b: 2 });
  const wide = C.seal(['a', 'b'], { a: 1, b: 2 });
  assert.notStrictEqual(narrow.hash, wide.hash,
    'otherwise adding a field later would silently change what an old seal meant');
});

t('⭐ verify re-reads the SEAL\'s field list, not today\'s', () => {
  const old = C.seal(['a'], { a: 1, b: 'did not exist yet' });
  assert.ok(C.verify(old, { a: 1, b: 'added later' }).ok,
    'a seal made under older rules stays verifiable under those rules');
});

t('⚠️ no seal, or a seal that does not say what it covered, is refused with a reason', () => {
  assert.strictEqual(C.verify(null, {}).ok, false);
  assert.match(C.verify(null, {}).why, /no seal/);
  assert.match(C.verify({ hash: 'x' }, {}).why, /does not say what it covered/);
});

t('⚠️⚠️ verify NEVER claims to know which field moved', () => {
  const v = C.verify(C.seal(['a', 'b'], { a: 1, b: 2 }), { a: 9, b: 2 });
  assert.strictEqual(v.differs, undefined,
    'a hash proves THAT a copy differs, never WHICH field — that needs both copies side by side');
  assert.ok(v.note.indexOf('never WHICH') > -1, 'and it says so out loud');
});

console.log('\n  ' + pass + ' passed · ' + fail + ' failed\n');
process.exitCode = fail ? 1 : 0;
