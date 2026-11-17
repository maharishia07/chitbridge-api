/**
 * VAULT — repeatable sections of user-named rows (2026-08-16).
 *
 * ⚠️ THE LEGACY CONVERSION IS THE POINT OF THIS FILE. The vault shape changed inside an encrypted jsonb blob with
 * no SQL migration, which is only safe because group-shaped payloads are converted on read. If that conversion
 * regresses, an existing vault reads back EMPTY and the next save writes that emptiness over real data — a silent
 * loss with no error anywhere. These assertions are the thing standing between that and a user.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { sanitizeVault } = require('../lib/profile');

test('legacy group shape converts, keeping the value AND the tag', () => {
  const out = sanitizeVault({
    identity: { legal_name: 'Acme Exports', city: 'Chennai' },
    registrations: { gstin: '33AAAAA0000A1Z5' },
    banking: { ifsc: 'HDFC0001234' },
  });
  const types = out.sections.map((s) => s.type);
  assert.deepStrictEqual(types, ['identity', 'licence', 'bank'], 'registrations→licence, banking→bank');

  const gst = out.sections[1].rows[0];
  assert.strictEqual(gst.value, '33AAAAA0000A1Z5');
  assert.strictEqual(gst.name, 'GSTIN', 'the legacy key gets a human name, not gstin');
  // ⚠️ the tag is what keeps an already-gathered value pre-fillable and verifiable after the shape change
  assert.strictEqual(gst.tag, 'gstin');
});

test('new shape survives, and an unknown section type folds to other rather than being dropped', () => {
  const out = sanitizeVault({ sections: [
    { type: 'bank', label: 'Export receipts', rows: [{ name: 'IFSC code', tag: 'IFSC', value: 'HDFC0001234' }] },
    { type: 'wat', rows: [{ name: 'Anything', value: 'kept' }] },
  ] });
  assert.strictEqual(out.sections[0].label, 'Export receipts');
  assert.strictEqual(out.sections[0].rows[0].tag, 'ifsc', 'tags normalise to lowercase');
  assert.strictEqual(out.sections[1].type, 'other', 'unknown type is folded, never discarded');
  assert.strictEqual(out.sections[1].rows[0].value, 'kept');
});

test('two sections of the same type both survive — the whole reason sections repeat', () => {
  const out = sanitizeVault({ sections: [
    { type: 'bank', label: 'Export', rows: [{ name: 'Bank name', value: 'HDFC' }] },
    { type: 'bank', label: 'Domestic', rows: [{ name: 'Bank name', value: 'Canara' }] },
  ] });
  assert.strictEqual(out.sections.length, 2);
  assert.deepStrictEqual(out.sections.map((s) => s.label), ['Export', 'Domestic']);
});

test('a row with no value is dropped; a row with no NAME is kept', () => {
  const out = sanitizeVault({ sections: [{ type: 'other', rows: [
    { name: 'Opened but never filled', value: '   ' },
    { name: '', value: 'a value under a labelled section still means something' },
  ] }] });
  assert.strictEqual(out.sections[0].rows.length, 1);
  assert.strictEqual(out.sections[0].rows[0].name, '');
});

test('a section whose rows are all empty does not survive as an empty shell', () => {
  const out = sanitizeVault({ sections: [{ type: 'bank', label: 'x', rows: [{ name: 'a', value: '' }] }] });
  assert.deepStrictEqual(out.sections, []);
});

test('free-form input is BOUNDED — caps hold on count and length', () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ name: 'n' + i, value: 'v' + i }));
  const sections = Array.from({ length: 500 }, () => ({ type: 'other', rows }));
  const out = sanitizeVault({ sections });
  assert.strictEqual(out.sections.length, 40, 'section cap');
  assert.strictEqual(out.sections[0].rows.length, 40, 'row cap');

  const long = sanitizeVault({ sections: [{ type: 'other', label: 'L'.repeat(500),
    rows: [{ name: 'N'.repeat(500), value: 'V'.repeat(500) }] }] });
  assert.strictEqual(long.sections[0].label.length, 80);
  assert.strictEqual(long.sections[0].rows[0].name.length, 80);
  assert.strictEqual(long.sections[0].rows[0].value.length, 240);
});

test('junk never throws — the sanitizer is the trust boundary', () => {
  for (const junk of [null, undefined, 'string', 42, [], { sections: 'nope' }, { sections: [null, 7, {}] }]) {
    assert.deepStrictEqual(sanitizeVault(junk), { sections: [] }, JSON.stringify(junk));
  }
});
