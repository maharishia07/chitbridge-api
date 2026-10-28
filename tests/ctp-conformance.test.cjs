/**
 * ── ⭐⭐⭐ THE CONFORMANCE RULE — BOTH TRANSPORTS MUST WRITE THE SAME ROWS ────────────────────────────────────────
 *
 * Athi, 2026-09-15: *"this can be a completely different new machinery or a part of an existing engine — THE
 * BEHAVIOUR SHOULD BE THE SAME."*
 *
 * docs/CTP-DESIGN.md §8.2 turns that into something checkable: the same delivery, run locally and run over the
 * wire, must produce identical rows. This is that check, at the only point where it can be made without a second
 * machine — and it is stronger than a row diff, not weaker:
 *
 *   ⭐ `chit_deliver` is handed a COPY. If `open(sign(build(copy))) ` deep-equals that copy, the two transports
 *     write identical rows BY CONSTRUCTION. There is nothing left for a database to disagree about.
 *
 * ⚠️ WHICH IS WHY THE ENVELOPE MUST NOT TIDY. Dropping a null, reordering a key, coercing a date — each is a row
 * that differs, and each is the kind of change somebody makes in good faith six months from now. This file is
 * what stops it.
 *
 * ⚠️ OFFLINE, ON PURPOSE. A conformance test that needs a running server is a conformance test that gets skipped,
 * and the claim it protects is the one the whole federation design rests on. [[feedback-testing-ladder]] T0.
 */
const assert = require('assert');
const env = require('../lib/ctpenvelope');

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); }
};

console.log('\n══ CTP CONFORMANCE — an envelope carries a copy losslessly ══\n');

/* a copy of the awkward shape real ones have: nulls, nesting, an array, a date string, a zero, an empty string */
const COPY = {
  entity_id: '19adb2dd-be8d-4d2f-9512-82ac533b7f20',
  direction: 'received',
  role: 'Act',
  current_status: 'pending',
  priority_flag: null,
  business_json: {
    kind: 'incident', severity: 'Sev-2', screen_code: null, note: '',
    routed_by: { desk: 'them', rung: 'routing rule', population: 'live', at: '2026-09-15T04:00:00.000Z' },
    lines: [{ n: 1, qty: 0, unit: null }, { n: 2, qty: 2.5, unit: 'kg' }],
  },
  log: { action: 'delivered', new_status: 'pending', detail: 'Support ticket from a shop' },
};
const HEADER = {
  summary_json: { line_item_count: 0, total_value: 0, currency_code: 'INR', purpose: 'general',
                  forwarded_from: null, governed: { pattern: 'support-ticket', assignee: null } },
  auto_subject: 'Support — a shop — 2026-09-15',
  manual_subject: '[incident] something broke',
  all_recipients: [{ entity_id: 'a', role: 'sender' }, { entity_id: 'b', role: 'receiver' }],
};
const FROM = { installation_key: 'platform-0', population: 'live', bridge_id: 'CBAAAAAAAA', display_name: 'A Shop' };
const TO = { bridge_id: 'CBBBBBBBBB' };
const CHIT = { chit_id: 'd07f5862-0fc2-45bb-9fc7-e7f9999b1943', header: HEADER, copy: COPY,
               attachments: [{ id: 'x1', sha256: 'abc', href: 'https://s/x1', bytes: 12 }] };

const ctx = { population: 'live', verify: () => true }; /* RAIL-141 (a): open needs a verifier; the hash is still checked */

/* ── ① THE CLAIM ───────────────────────────────────────────────────────────────────────────────────────────── */
ok('a copy survives the envelope byte for byte', () => {
  const out = env.open(env.sign(env.build(FROM, TO, CHIT), null), ctx);
  assert.ok(out.ok, out.why);
  assert.deepStrictEqual(out.copy, COPY, 'the copy changed in transit — the two transports would write '
    + 'different rows, and lifting a world onto its own machine would silently change behaviour');
});

ok('…and so does the header', () => {
  const out = env.open(env.sign(env.build(FROM, TO, CHIT), null), ctx);
  assert.deepStrictEqual(out.header, HEADER);
});

ok('…and the attachments stay references, not bytes', () => {
  const e = env.build(FROM, TO, CHIT);
  assert.deepStrictEqual(e.attachments, CHIT.attachments);
  assert.ok(!JSON.stringify(e).includes('"data"'), 'bytes must never ride in an envelope — §6 rule 3');
});

ok('a null is preserved, not dropped', () => {
  const out = env.open(env.sign(env.build(FROM, TO, CHIT), null), ctx);
  assert.strictEqual(out.copy.priority_flag, null, 'a dropped null is a different row');
  assert.strictEqual(out.copy.business_json.screen_code, null);
  assert.strictEqual(out.copy.business_json.note, '', 'an empty string is not a null');
  assert.strictEqual(out.copy.business_json.lines[0].qty, 0, 'zero is not absent');
});

/* ── ①b THE WIRE, WHICH IS WHERE THIS TEST WAS BLIND ───────────────────────────────────────────────────────── */
/**
 * ⚠️⚠️ EVERY ASSERTION ABOVE PASSED WHILE A REAL CROSSING FAILED. They round-trip the envelope IN MEMORY, and
 * the wire does not: JSON turns a Date into a string, drops an `undefined`, and has no opinion about -0. The
 * first real delivery was refused with *"the seal does not match the contents"* because `header.created_at` was
 * a Date on one side and a string on the other.
 *
 * ⭐ So the test now does what the transport does — JSON.stringify then JSON.parse — before opening. A
 * conformance test that never crosses the thing it is conforming to is decoration.
 */
const overTheWire = (e) => JSON.parse(JSON.stringify(e));

ok('a Date in the header does not break the seal', () => {
  const withDate = Object.assign({}, CHIT, {
    header: Object.assign({}, HEADER, { created_at: new Date('2026-09-15T04:00:00.000Z') }),
  });
  const sent = env.sign(env.build(FROM, TO, withDate), { alg: 'test', sign: (h) => 'sig:' + h });
  const got = env.open(overTheWire(sent), { population: 'live', verify: () => true });
  assert.ok(got.ok, got.why + ' — the digest must cover the WIRE form, not the in-memory one');
});

ok('the copy still matches after a real serialisation', () => {
  const got = env.open(overTheWire(env.sign(env.build(FROM, TO, CHIT), null)), ctx);
  assert.ok(got.ok, got.why);
  assert.deepStrictEqual(got.copy, COPY, 'the copy changed crossing JSON');
});

ok('the digest is stable across the wire', () => {
  const sent = env.sign(env.build(FROM, TO, CHIT), null);
  assert.strictEqual(env.digest(overTheWire(sent)), sent.sealed.hash,
    'sender and receiver must compute the same hash or no signature can ever verify');
});

/* ── ② ONE COPY, ONE RECIPIENT ─────────────────────────────────────────────────────────────────────────────── */
ok('an envelope carries exactly one recipient', () => {
  assert.throws(() => env.build(FROM, {}, CHIT), /one recipient/);
});

ok('and refuses to be built without a copy', () => {
  assert.throws(() => env.build(FROM, TO, { chit_id: 'x' }), /carries a copy/);
});

/* ── ③ THE BOUNDARY, WHICH IS THE DANGEROUS ONE ────────────────────────────────────────────────────────────── */
ok('⚠️ a test world may NOT deliver into a live one', () => {
  const e = env.sign(env.build(Object.assign({}, FROM, { population: 'test' }), TO, CHIT), null);
  const out = env.open(e, { population: 'live', verify: () => true });
  assert.strictEqual(out.ok, false, 'a population mismatch must be refused — §7');
  assert.ok(/may not deliver/.test(out.why), out.why);
});

ok('⚠️ and "test" to "test" is refused too, without an explicit pairing', () => {
  const e = env.sign(env.build(Object.assign({}, FROM, { population: 'test' }), TO, CHIT), null);
  const out = env.open(e, { population: 'test', verify: () => true });
  assert.strictEqual(out.ok, false,
    'a population code is a LOCAL name — matching on the string wires a stranger’s sandbox to ours (§7.1)');
  assert.ok(/explicit pairing/.test(out.why), out.why);
});

ok('…but a declared pairing lets two sandboxes talk', () => {
  const e = env.sign(env.build(Object.assign({}, FROM, { population: 'test' }), TO, CHIT), null);
  const out = env.open(e, { population: 'test', pairedWith: () => true, verify: () => true });
  assert.ok(out.ok, out.why);
});

ok('live to live is allowed on the name alone', () => {
  const out = env.open(env.sign(env.build(FROM, TO, CHIT), null), ctx);
  assert.ok(out.ok, out.why);
});

ok('an envelope with no population is refused', () => {
  assert.throws(() => env.build({ installation_key: 'x' }, TO, CHIT), /population/);
});

/* ── ④ THE SEAL ────────────────────────────────────────────────────────────────────────────────────────────── */
ok('a tampered envelope does not open', () => {
  const e = env.sign(env.build(FROM, TO, CHIT), { alg: 'test', sign: (h) => 'sig:' + h });
  e.copy.current_status = 'completed';                       /* someone changes it in flight */
  const out = env.open(e, { population: 'live', verify: () => true });
  assert.strictEqual(out.ok, false, 'the seal must cover the contents');
  assert.ok(/seal does not match/.test(out.why), out.why);
});

ok('a re-ordered key is still the same message', () => {
  /* ⭐ this is what lib/canon.js is FOR: two representations of one value must hash the same, or a signature
     verifies on the sender and fails on the receiver for no reason anybody can see. */
  const a = env.build(FROM, TO, CHIT);
  const b = env.build(FROM, TO, { chit_id: CHIT.chit_id, attachments: CHIT.attachments,
                                  copy: CHIT.copy, header: CHIT.header });
  assert.strictEqual(env.digest(a), env.digest(b), 'key order must not change the digest');
});

ok('a bad signature is refused', () => {
  const e = env.sign(env.build(FROM, TO, CHIT), { alg: 'test', sign: (h) => 'sig:' + h });
  const out = env.open(e, { population: 'live', verify: () => false });
  assert.strictEqual(out.ok, false);
  assert.ok(/signature/.test(out.why), out.why);
});

ok('⚠️ no verifier is a refusal, not a pass (RAIL-141 a)', () => {
  const e = env.sign(env.build(FROM, TO, CHIT), null);
  e.sealed = Object.assign({}, e.sealed, { hash: 'not-the-hash' });
  const out = env.open(e, { population: 'live' });
  assert.strictEqual(out.ok, false, 'an envelope opened with no verifier must not be believed');
  assert.strictEqual(out.why, 'no way to check the signature here — refused');
});

/* RAIL-141 (c): contents canon cannot read are an ANSWER, never a throw — at the door and on the way out */
const deep = (n) => { let v = { leaf: 1 }; for (let i = 0; i < n; i++) v = { v }; return v; };
ok('⚠️ a copy nested past the canon limit is refused, not thrown (RAIL-141 c)', () => {
  const e = env.build(FROM, TO, CHIT);
  e.copy = Object.assign({}, e.copy, { business_json: deep(300) });
  e.sealed = { alg: 'test', hash: 'x', sig: 's', at: '2026-10-29T00:00:00.000Z' };
  let out;
  assert.doesNotThrow(() => { out = env.open(e, ctx); });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.why, 'the envelope cannot be read as one sealed message — refused');
});

ok('⚠️ a BigInt in a copy is refused, not thrown (RAIL-141 c)', () => {
  const e = env.build(FROM, TO, CHIT);
  e.copy = Object.assign({}, e.copy, { business_json: { qty: BigInt(2) } });
  e.sealed = { alg: 'test', hash: 'x', sig: 's', at: '2026-10-29T00:00:00.000Z' };
  let out;
  assert.doesNotThrow(() => { out = env.open(e, ctx); });
  assert.strictEqual(out.ok, false);
});

/* ── ⑤ THE VERSIONED SEAL (RAIL-141 b · Q21 draft): 1.1 seals its own time, alg and nonce ──────────────────── */
const asV11 = (fn) => { process.env.CTP_SEAL_VERSION = '1.1'; try { return fn(); } finally { delete process.env.CTP_SEAL_VERSION; } };
const TEST_SIGNER = { alg: 'test', sign: (h) => 'sig:' + h };

ok('a sender sends 1 until it is switched, and 1.1 once it is', () => {
  assert.strictEqual(env.build(FROM, TO, CHIT).ctp, '1');
  assert.strictEqual(asV11(() => env.build(FROM, TO, CHIT)).ctp, '1.1');
});

ok('a 1.1 envelope opens, across the wire, and carries a nonce', () => {
  const sent = asV11(() => env.sign(env.build(FROM, TO, CHIT), TEST_SIGNER));
  assert.ok(sent.sealed.nonce && sent.sealed.nonce.length === 32, 'expected a nonce');
  const got = env.open(overTheWire(sent), ctx);
  assert.ok(got.ok, got.why);
  assert.deepStrictEqual(got.copy, COPY);
});

ok('⚠️ 1.1: restamping the time breaks the seal — the replay 1 cannot stop', () => {
  const sent = asV11(() => env.sign(env.build(FROM, TO, CHIT), TEST_SIGNER));
  const replayed = Object.assign({}, sent, { sealed: Object.assign({}, sent.sealed, { at: new Date(Date.now() + 1000).toISOString() }) });
  const out = env.open(replayed, ctx);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.why, 'the seal does not match the contents');
  /* …while version 1 cannot tell: its digest does not cover at */
  const v1 = env.sign(env.build(FROM, TO, CHIT), TEST_SIGNER);
  const v1Replayed = Object.assign({}, v1, { sealed: Object.assign({}, v1.sealed, { at: new Date(Date.now() + 1000).toISOString() }) });
  assert.ok(env.open(v1Replayed, ctx).ok, 'version 1 still opens a restamped seal — the reason for 1.1');
});

ok('1.1: a seal older than the window, or from the future, is refused', () => {
  const sent = asV11(() => env.sign(env.build(FROM, TO, CHIT), TEST_SIGNER));
  const later = env.open(sent, Object.assign({}, ctx, { now: () => new Date(Date.now() + env.SEAL_MAX_AGE_MS + 60000) }));
  assert.strictEqual(later.why, 'the seal is too old to be delivered');
  const earlier = env.open(sent, Object.assign({}, ctx, { now: () => new Date(Date.now() - 10 * 60000) }));
  assert.strictEqual(earlier.why, 'the seal is dated in the future');
});

ok('1.1 without its nonce is refused', () => {
  const sent = asV11(() => env.sign(env.build(FROM, TO, CHIT), TEST_SIGNER));
  const bare = Object.assign({}, sent, { sealed: Object.assign({}, sent.sealed, { nonce: undefined }) });
  assert.strictEqual(env.open(bare, ctx).why, 'a 1.1 seal must carry its time and nonce');
});

ok('version 1 is accepted until CTP_ACCEPT_V1_UNTIL passes, then refused in words', () => {
  const v1 = env.sign(env.build(FROM, TO, CHIT), TEST_SIGNER);
  process.env.CTP_ACCEPT_V1_UNTIL = '2999-01-01';
  try { assert.ok(env.open(v1, ctx).ok, 'before the date, 1 is still taken'); } finally { delete process.env.CTP_ACCEPT_V1_UNTIL; }
  process.env.CTP_ACCEPT_V1_UNTIL = '2026-01-01';
  try { assert.strictEqual(env.open(v1, ctx).why, 'a version 1 seal is no longer accepted here — send 1.1'); } finally { delete process.env.CTP_ACCEPT_V1_UNTIL; }
  process.env.CTP_ACCEPT_V1_UNTIL = 'soon';
  try { assert.strictEqual(env.open(v1, ctx).ok, false, 'an unreadable date refuses 1 rather than guessing'); } finally { delete process.env.CTP_ACCEPT_V1_UNTIL; }
});

ok('signing twice gives the same digest and does not nest', () => {
  const e1 = env.sign(env.build(FROM, TO, CHIT), null);
  const e2 = env.sign(env.build(FROM, TO, CHIT), null);
  assert.strictEqual(e1.sealed.hash, e2.sealed.hash);
  assert.strictEqual(e2.sealed.sealed, undefined, 'sign() must not mutate or nest');
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
