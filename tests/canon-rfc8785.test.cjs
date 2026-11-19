// tests/canon-rfc8785.test.cjs - lib/canon.js against the RFC 8785 (JCS) published vectors.
//   1 Appendix B: the 25 IEEE-754 double -> JCS number strings (the ES number form the RFC names)
//   2 section 3.2.2: the whole worked example (numbers, string escapes, literals, sorted keys)
//   3 section 3.2.3: keys sort by UTF-16 code units (the control, digit, Latin, euro, emoji, Hebrew example)
//   4 arrays keep order; no insignificant white space
// Offline: no database, no network. Run: node tests/canon-rfc8785.test.cjs
'use strict';
const assert = require('node:assert');
const C = require('../lib/canon');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  ok  ' + name); pass++; } catch (e) { console.log('  XX  ' + name + ' - ' + e.message); fail++; } };

const fromHex = (hex) => Buffer.from(hex, 'hex').readDoubleBE(0);

/** RFC 8785 Appendix B, IEEE-754 hex and the JCS text it must print as */
const APPENDIX_B = [
  ['0000000000000000', '0'], ['8000000000000000', '0'],
  ['0000000000000001', '5e-324'], ['8000000000000001', '-5e-324'],
  ['7fefffffffffffff', '1.7976931348623157e+308'], ['ffefffffffffffff', '-1.7976931348623157e+308'],
  ['4340000000000000', '9007199254740992'], ['4340000000000001', '9007199254740994'], ['c340000000000000', '-9007199254740992'],
  ['4430000000000000', '295147905179352830000'],
  ['44b52d02c7e14af5', '9.999999999999997e+22'], ['44b52d02c7e14af6', '1e+23'], ['44b52d02c7e14af7', '1.0000000000000001e+23'],
  ['444b1ae4d6e2ef4e', '999999999999999700000'], ['444b1ae4d6e2ef4f', '999999999999999900000'], ['444b1ae4d6e2ef50', '1e+21'],
  ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'], ['3eb0c6f7a0b5ed8d', '0.000001'],
  ['41b3de4355555553', '333333333.3333332'], ['41b3de4355555554', '333333333.33333325'], ['41b3de4355555555', '333333333.3333333'],
  ['41b3de4355555556', '333333333.3333334'], ['41b3de4355555557', '333333333.33333343'],
  ['becbf647612f3696', '-0.0000033333333333333333'], ['43143ff3c1cb0959', '1424953923781206.2'],
];

t('Appendix B: every double prints as the RFC says', () => {
  for (const [hex, want] of APPENDIX_B) assert.strictEqual(C.canon(fromHex(hex)), want, hex);
});

t('section 3.2.2 worked example', () => {
  const B = String.fromCharCode(92); // one backslash; the escapes are spelled out so no tool rewrites them
  const value = '€$' + String.fromCharCode(15) + String.fromCharCode(10) + "A'B" + '"' + B + B + '"/';
  const input = { numbers: [333333333.33333329, 1e30, 4.50, 2e-3, 0.000000000000000000000000001], string: value, literals: [null, true, false] };
  const want = '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$' + B + 'u000f' + B + "nA'B" + B + '"' + B + B + B + B + B + '"/"}';
  assert.strictEqual(C.canon(input), want);
});

t('section 3.2.3 keys sort by UTF-16 code units', () => {
  const input = JSON.parse(String.raw`{"€":"Euro Sign","\r":"Carriage Return","דּ":"Hebrew Letter Dalet With Dagesh","1":"One","😀":"Emoji: Grinning Face","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis"}`);
  const order = ['\r', '1', '\u0080', 'ö', '€', '😀', 'דּ'];
  const want = '{' + order.map((k) => JSON.stringify(k) + ':' + JSON.stringify(input[k])).join(',') + '}';
  assert.strictEqual(C.canon(input), want);
});

t('arrays keep order, nested objects sort, no white space', () => {
  assert.strictEqual(C.canon({ b: [3, 1, 2], a: { d: 1, c: 2 } }), '{"a":{"c":2,"d":1},"b":[3,1,2]}');
  assert.strictEqual(C.canon({ b: 1, a: 2 }), C.canon({ a: 2, b: 1 }));
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
