// OWNS      Standards register proof for lei (ISO 17442), wco-hs, gs1-gpc (structure checks) and incoterms (Incoterms 2020 codes and mode)
// CALLED BY the standards lane 10 run on SIT; node tests/std10-ids-incoterms.test.cjs
// FLOW      lib/verify.js verifyFormat · lib/incoterms.js incotermCheck ──▶ ok / refused with a reason
// CARD      21-compliance-attestation-and-trade/know-your-business
const assert = require('assert');
const { verifyFormat, verifyRegistry } = require('../lib/verify');
const { incotermCheck, CODES } = require('../lib/incoterms');

// LEI: published sample LEIs are valid; a flipped check digit, a wrong length and a lower-case one are handled
for (const ok of ['5493001KJTIIGC8Y1R12', '529900T8BM49AURSDO55']) {
  assert.strictEqual(verifyFormat('lei', ok).ok, true, ok + ' is a real LEI');
}
assert.strictEqual(verifyFormat('lei', '5493001KJTIIGC8Y1R13').ok, false, 'one check digit off is refused');
assert.strictEqual(verifyFormat('lei', '5493001KJTIIGC8Y1R12').label, 'LEI (ISO 17442)');
assert.strictEqual(verifyFormat('lei', '5493001KJTIIGC8Y1R1').reason, 'format', 'nineteen characters is refused');
assert.strictEqual(verifyFormat('lei', ' 5493001kjtiigc8y1r12 ').ok, true, 'trimmed and upper-cased');
assert.strictEqual(verifyFormat('lei', '5493001KJTIIGC8Y1RAB').ok, false, 'the last two must be digits');

// every single-character change to a valid LEI breaks MOD 97-10 (the check catches all single-symbol errors)
const base = '5493001KJTIIGC8Y1R12';
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
for (let i = 0; i < 20; i++) {
  for (const c of alphabet) {
    if (c === base[i]) continue;
    assert.strictEqual(verifyFormat('lei', base.slice(0, i) + c + base.slice(i + 1)).ok, false, 'position ' + i + ' ' + c);
  }
}

// HS: six digits, chapter 01-97, 77 reserved; GPC: eight digits, segment 10 or more
assert.strictEqual(verifyFormat('hs', '847130').ok, true);
assert.strictEqual(verifyFormat('hs', '8471').ok, false);
assert.strictEqual(verifyFormat('hs', '770000').ok, false, 'chapter 77 is reserved');
assert.strictEqual(verifyFormat('hs', '980000').ok, false, 'chapter 98 is not in the nomenclature');
assert.strictEqual(verifyFormat('gpc', '10000025').ok, true);
assert.strictEqual(verifyFormat('gpc', '1000002').ok, false);
assert.strictEqual(verifyFormat('gpc', '05000025').ok, false);

// Incoterms 2020: eleven codes; the four sea rules refuse air, road and rail
assert.strictEqual(CODES.length, 11);
for (const c of CODES) assert.strictEqual(incotermCheck(c).ok, true, c);
assert.strictEqual(incotermCheck('cif').ok, true, 'case-blind');
assert.strictEqual(incotermCheck('DDU').reason, 'unknown', 'DDU left the rules in 2010');
assert.strictEqual(incotermCheck('').reason, 'unknown');
for (const c of ['FAS', 'FOB', 'CFR', 'CIF']) {
  assert.strictEqual(incotermCheck(c, 'air').reason, 'mode', c + ' by air');
  assert.strictEqual(incotermCheck(c, 'sea').ok, true);
  assert.strictEqual(incotermCheck(c, 'inland_waterway').ok, true);
}
for (const c of ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']) assert.strictEqual(incotermCheck(c, 'air').ok, true, c + ' by air');

// the registry path still refuses a bad LEI before any lookup, and honestly labels a good one format-only
(async () => {
  const bad = await verifyRegistry('lei', '5493001KJTIIGC8Y1R13');
  assert.strictEqual(bad.ok, false);
  const good = await verifyRegistry('lei', '5493001KJTIIGC8Y1R12');
  assert.strictEqual(good.ok, true);
  assert.strictEqual(good.method, 'format', 'format-valid, never called registry-confirmed');
  console.log('std10-ids-incoterms: all assertions passed');
})();
