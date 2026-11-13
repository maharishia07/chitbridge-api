/**
 * RAIL-141 (b) · the versioned CTP seal "1.1" — the four refusals Athi asked for (DECISIONS 14 Nov), each proved on its own:
 * alg none · an old sealed.at · a smuggled top-level key · and a valid 1.1 still opens; plus how a "1" envelope is treated.
 * Each refusal is placed where the seal's own hash still MATCHES (the verifier is stubbed true), so only the named check can stop it.
 * Run: node tests/rail-141b-seal-v11.test.cjs
 */
const assert = require('assert');
const env = require('../lib/ctpenvelope');

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); }
};
const FROM = { installation_key: 'platform-0', population: 'live', bridge_id: 'CBAAAAAAAA', display_name: 'A Shop' };
const TO = { bridge_id: 'CBBBBBBBBB' };
const CHIT = { chit_id: 'c1', header: { auto_subject: 'x' }, copy: { entity_id: 'e', business_json: { a: 1 } }, attachments: [] };
const ctx = { population: 'live', verify: () => true };
const SIGNER = { alg: 'ed25519', sign: (h) => 'sig:' + h };
const wire = (e) => JSON.parse(JSON.stringify(e));
const v11 = (signer) => { process.env.CTP_SEAL_VERSION = '1.1'; try { return env.sign(env.build(FROM, TO, CHIT), signer); } finally { delete process.env.CTP_SEAL_VERSION; } };
const at = (e, ms) => Object.assign({}, ctx, { now: () => new Date(Date.parse(e.sealed.at) + ms) });

console.log('\n══ RAIL-141 b — seal 1.1 ══\n');

ok('a valid 1.1 envelope is accepted (and so is a 1.1 event envelope)', () => {
  const sent = v11(SIGNER);
  assert.strictEqual(sent.ctp, '1.1');
  assert.ok(env.open(wire(sent), ctx).ok);
  process.env.CTP_SEAL_VERSION = '1.1';
  let ev; try { ev = env.sign(env.buildEvent(FROM, TO, { chit_id: 'c1', event: { kind: 'status', seq: 1, to: 'accepted' } }), SIGNER); } finally { delete process.env.CTP_SEAL_VERSION; }
  assert.strictEqual(ev.ctp, '1.1');
  assert.ok(env.open(wire(ev), ctx).ok, 'event');
});

ok('alg none is refused', () => {
  const out = env.open(wire(v11(null)), ctx);
  assert.strictEqual(out.ok, false);
  assert.match(out.why, /alg none is refused/);
});

ok('a seal older than the window is refused, one inside it is accepted (window ' + env.SEAL_MAX_AGE_MS / 60000 + ' min, lib/ctpenvelope.js SEAL_MAX_AGE_MS)', () => {
  const sent = wire(v11(SIGNER));
  assert.ok(env.open(sent, at(sent, env.SEAL_MAX_AGE_MS - 1000)).ok, 'just inside');
  const out = env.open(sent, at(sent, env.SEAL_MAX_AGE_MS + 1000));
  assert.strictEqual(out.why, 'the seal is too old to be delivered');
});

ok('an extra top-level key is refused (it is outside the digest, so only this check sees it)', () => {
  const sent = wire(v11(SIGNER));
  const out = env.open(Object.assign({}, sent, { smuggled: { to: 'CBCCCCCCCC' } }), ctx);
  assert.strictEqual(out.ok, false);
  assert.match(out.why, /not sealed \(smuggled\)/);
});

ok('a restamped sealed.at breaks the hash (1.1 seals its time)', () => {
  const sent = wire(v11(SIGNER));
  const out = env.open(Object.assign({}, sent, { sealed: Object.assign({}, sent.sealed, { at: new Date(Date.parse(sent.sealed.at) + 500).toISOString() }) }), at(sent, 1000));
  assert.strictEqual(out.why, 'the seal does not match the contents');
});

ok('a "1" envelope: accepted for reading until CTP_ACCEPT_V1_UNTIL passes, then refused; a minor such as 1.2 follows the same rule', () => {
  const v1 = env.sign(env.build(FROM, TO, CHIT), SIGNER);
  assert.strictEqual(v1.ctp, '1');
  assert.ok(env.open(wire(v1), ctx).ok, 'default: still taken');
  const minor = env.sign(Object.assign(env.build(FROM, TO, CHIT), { ctp: '1.2' }), SIGNER);
  assert.ok(env.open(wire(minor), ctx).ok, '1.2 is read as ours (tolerant reader)');
  process.env.CTP_ACCEPT_V1_UNTIL = '2026-01-01';
  try {
    assert.match(env.open(wire(v1), ctx).why, /no longer accepted/);
    assert.match(env.open(wire(minor), ctx).why, /no longer accepted/, 'a minor cannot slip past the cut-off');
    assert.ok(env.open(wire(v11(SIGNER)), ctx).ok, '1.1 is unaffected by the cut-off');
  } finally { delete process.env.CTP_ACCEPT_V1_UNTIL; }
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
