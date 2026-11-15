'use strict';
// @type: unit
/**
 * tests/profile-map-ladder.test.cjs - what we look for about a store, and how far to trust it (lib/profile-map.js, the engines profilemap adopted).
 *
 * OWNS      the proof of the GSTIN check (shape, holder-type letter, check digit), PAN and state read out of a GSTIN, a PIN's state, what assess()
 *           fills from a GSTIN and the rung each value reaches (declared < copied < checked < verified), the issues it raises when two facts disagree,
 *           and merge(): a lower rung never overwrites a higher one, equal rungs go to the newer as_of, blank values are ignored.
 * CALLED BY scripts/guards.cjs (offline, pure).
 * CARD      docs/23-connectors-and-integrations/functions/profile-map.md
 * Hand-worked: GSTIN 27AAPFU0939F1ZV is state 27 (Maharashtra), PAN AAPFU0939F (4th letter F = firm), check digit V (the base-36 sum of the first 14 characters gives it).
 * A PIN starting 56 is state 29, 11 is state 07 (Delhi), 40 is state 27.
 */
const assert = require('assert');
const P = require('../lib/profile-map');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  PASS  ' + name); pass++; } catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; } };
const G = '27AAPFU0939F1ZV';

t('a GSTIN with the right check digit passes; one wrong character fails on the digit, with the digit it expected', () => {
  assert.strictEqual(P.gstinChecksum(G).ok, true);
  const bad = P.gstinChecksum('27AAPFU0939F1ZW'); assert.deepStrictEqual([bad.ok, bad.reason, bad.expected], [false, 'check digit', 'V']);
});
t('a right check digit on a wrong PAN holder letter is still not a GSTIN (format)', () => { assert.strictEqual(P.gstinChecksum('27ABCDE0939F1Z5').reason, 'format'); });
t('state, PAN, PIN-state and state-name read-outs', () => {
  assert.strictEqual(P.stateOfGstin(G), '27'); assert.strictEqual(P.panOfGstin(G), 'AAPFU0939F');
  assert.strictEqual(P.stateOfPin('560001'), '29'); assert.strictEqual(P.stateOfPin('110001'), '07'); assert.strictEqual(P.stateOfPin('12345'), null);
  assert.strictEqual(P.stateCodeOfName('Delhi'), '07'); assert.strictEqual(P.stateCodeOfName('27'), '27'); assert.strictEqual(P.stateCodeOfName('Narnia'), null);
});
t('assess fills PAN, state, country and currency from the GSTIN alone and lifts them to checked', () => {
  const a = P.assess({ gstin: { value: G } });
  assert.deepStrictEqual([a.fields.pan.value, a.fields.state.value, a.fields.country.value, a.fields.currency.value], ['AAPFU0939F', '27', 'IN', 'INR']);
  assert.strictEqual(a.fields.gstin.rung, 'checked'); assert.strictEqual(a.fields.pan.rung, 'checked'); assert.strictEqual(a.fields.state.rung, 'checked');
  assert.strictEqual(a.fields.pan.source, 'derived:gstin'); assert.strictEqual(a.fields.pan.derived, true);
  assert.deepStrictEqual([a.filled, a.total, a.state_name, a.issues.length], [5, 16, 'Maharashtra', 0]);
});
t('a PIN of the same state is checked; a PIN of another state is an issue and stays declared', () => {
  const ok = P.assess({ gstin: { value: G }, pincode: { value: '400001' } }); assert.strictEqual(ok.fields.pincode.rung, 'checked');
  const no = P.assess({ gstin: { value: G }, pincode: { value: '560001' } });
  assert.strictEqual(no.fields.pincode.rung, 'declared'); assert.ok(/PIN 560001 belongs to/.test(no.fields.pincode.issues[0]), no.fields.pincode.issues[0]);
});
t('a PAN that differs from the PAN inside the GSTIN, and a state that is not the GSTIN state, are both raised', () => {
  const a = P.assess({ gstin: { value: G }, pan: { value: 'ZZZZZ9999Z' }, state: { value: 'Delhi' } });
  assert.ok(a.issues.some((i) => i.key === 'pan' && /differs from the PAN inside the GSTIN \(AAPFU0939F\)/.test(i.issue)));
  assert.ok(a.issues.some((i) => i.key === 'state' && /is not the GSTIN's state \(27 Maharashtra\)/.test(i.issue)));
});
t('a mistyped GSTIN is reported "check digit does not match" and is not lifted to checked', () => {
  const a = P.assess({ gstin: { value: '27AAPFU0939F1ZW' } }); assert.strictEqual(a.fields.gstin.rung, 'declared');
  assert.deepStrictEqual(a.fields.gstin.issues, ['check digit does not match — one character is wrong']);
});
t('nothing given: 0 of 16 filled, every field missing', () => { const a = P.assess({}); assert.deepStrictEqual([a.filled, a.total], [0, 16]); assert.ok(Object.values(a.fields).every((f) => f.missing)); });
t('merge: a checked value stands above a copied one, and says why', () => {
  const m = P.merge({ gstin: { value: G, rung: 'checked', as_of: '2026-01-01' } }, [{ key: 'gstin', value: '29ABCDE1234F1Z5', rung: 'copied', source: 'tally' }]);
  assert.deepStrictEqual(m.written, []); assert.strictEqual(m.kept[0].why, 'a checked value stands above a copied one'); assert.strictEqual(m.values.gstin.value, G);
});
t('merge: a higher rung overwrites; equal rungs go to the NEWER as_of; an older differing value is kept out', () => {
  const cur = { phone: { value: '111', rung: 'declared', as_of: '2026-05-01' } };
  assert.deepStrictEqual(P.merge(cur, [{ key: 'phone', value: '222', rung: 'copied', as_of: '2026-01-01' }]).written, ['phone']);
  assert.deepStrictEqual(P.merge(cur, [{ key: 'phone', value: '333', rung: 'declared', as_of: '2026-06-01' }]).written, ['phone']);
  const old = P.merge(cur, [{ key: 'phone', value: '444', rung: 'declared', as_of: '2026-04-01' }]);
  assert.deepStrictEqual([old.written.length, old.kept[0].why, old.values.phone.value], [0, 'the held value is newer', '111']);
});
t('merge: blank or key-less rows are ignored, a new key lands trimmed with source and rung', () => {
  const m = P.merge({}, [{ key: 'city', value: '   ' }, { value: 'x' }, null, { key: 'city2', value: '  Pune ', source: 'csv', rung: 'copied' }]);
  assert.deepStrictEqual(m.written, ['city2']); assert.deepStrictEqual([m.values.city2.value, m.values.city2.source, m.values.city2.rung], ['Pune', 'csv', 'copied']);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
