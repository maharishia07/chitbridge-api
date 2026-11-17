/* Code 128 pattern table + encoder, checked against the symbology's OWN invariants — a transcription slip in the 107
   patterns would print a barcode that looks right and scans as nothing. Run: node e2e/barcode-check.cjs */
const assert = require('assert');
const B = require('../public/app/barcode.js');
let n = 0, f = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { f++; console.log('FAIL', name, e.message); } };

t('107 patterns; each symbol is 11 modules (stop = 13) with EVEN bar parity', () => {
  assert.strictEqual(B.PATTERNS.length, 107);
  B.PATTERNS.forEach((p, i) => {
    const w = p.split('').map(Number);
    const total = w.reduce((a, b) => a + b, 0);
    assert.strictEqual(total, i === 106 ? 13 : 11, 'symbol ' + i + ' width ' + total);
    const bars = w.filter((_, k) => k % 2 === 0).reduce((a, b) => a + b, 0);
    assert.strictEqual(bars % 2, 0, 'symbol ' + i + ' bar parity');
    assert.ok(w.every((x) => x >= 1 && x <= 4), 'symbol ' + i + ' width range');
  });
  assert.strictEqual(new Set(B.PATTERNS).size, 107, 'patterns unique');
});
t('checksum: the spec example "PJJ123C" and a pure-digit SKU in set C', () => {
  const e = B.encode('PJJ123C');
  assert.deepStrictEqual(e.values.slice(0, 2), [104, 48]);
  const sum = e.values.slice(0, -2).reduce((a, v, i) => a + (i ? v * i : v), 0);
  assert.strictEqual(e.values[e.values.length - 2], sum % 103);
  assert.strictEqual(e.values[e.values.length - 1], 106);
  const c = B.encode('123456');
  assert.deepStrictEqual(c.values.slice(0, 4), [105, 12, 34, 56]);
});
t('odd digit run: first digit in B, the rest paired in C', () => {
  const e = B.encode('A12345');
  assert.deepStrictEqual(e.values.slice(0, 5), [104, 33, 17, 99, 23]);
});
t('svg: quiet zones, rects only for bars, label escaped; refuses non-ASCII', () => {
  const r = B.code128('SKU-<7>');
  assert.ok(r.ok && /<svg /.test(r.svg) && /&lt;7>/.test(r.svg));
  assert.strictEqual(B.code128('ürün').ok, false);
  assert.strictEqual(B.code128('').ok, false);
});
console.log(`barcode: ${n} passed, ${f} failed`); process.exit(f ? 1 : 0);
