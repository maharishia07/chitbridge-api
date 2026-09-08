/**
 * lotfields.test.js — WHAT A VERTICAL ASKS FOR, AND WHAT A BARCODE ALREADY KNOWS (2026-09-08).
 *
 * Athi: *"pharma may require batch number, production date, exp date"* · *"we have already vertical in our governance, so it can
 * nicely tide upon."* Two things are proven here: the field pack a sector implies, and the GS1 parsing that means a pharma counter
 * types none of it — the pack's own barcode carries the batch and the expiry.
 *
 * Run: node tests/lotfields.test.js   · no DB, no browser, no network.
 */
'use strict';
const assert = require('assert'), path = require('path');
const lot = require(path.join(__dirname, '..', 'lib', 'lotfields.js'));
const gs1 = require(path.join(__dirname, '..', 'lib', 'gs1.js'));

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

console.log('— the vertical decides what is asked —');

it('⭐ general trade is asked for NOTHING — the shop the counter was built for gets no form', () => {
  const p = lot.forEntity([]);
  assert.strictEqual(p.vertical, null);
  assert.deepStrictEqual(p.required, []);
  assert.deepStrictEqual(p.optional, []);
  const q = lot.forEntity(['retail']);
  assert.strictEqual(q.vertical, null, 'a plain retailer must not inherit somebody else\'s fields');
});

it('pharma must have a batch AND an expiry', () => {
  const p = lot.forEntity(['pharma']);
  assert.strictEqual(p.vertical, 'pharma');
  assert.deepStrictEqual(p.required, ['batch', 'expiry']);
  assert.ok(p.optional.indexOf('mrp') >= 0, 'a pharma batch carries its own printed MRP');
  assert.ok(p.why && p.why.length > 20, 'a required field without a reason is a form nobody respects');
});

it('the sector is matched loosely — "Pharmaceuticals" is pharma', () => {
  assert.strictEqual(lot.forEntity(['Pharmaceuticals']).vertical, 'pharma');
  assert.strictEqual(lot.forEntity(['FMCG / Grocery']).vertical, 'food');
  assert.strictEqual(lot.forEntity(['Mobile & electronics']).vertical, 'serialised');
  assert.strictEqual(lot.forEntity(['Paints and coatings']).vertical, 'chemical');
});

it('a shop of two trades takes the first one it declared', () => {
  assert.strictEqual(lot.forEntity(['pharma', 'food']).vertical, 'pharma');
  assert.strictEqual(lot.forEntity(['food', 'pharma']).vertical, 'food');
});

it('every field named by a pack has a label a person can read', () => {
  for (const p of lot.PACKS) for (const n of p.required.concat(p.optional)) {
    assert.ok(lot.FIELDS[n], p.key + ' asks for "' + n + '", which this layer cannot describe');
    assert.ok(lot.FIELDS[n].label && lot.FIELDS[n].hint, n + ' has no words');
  }
});

console.log('— what is wrong with this consignment —');

it('a missing required field is ASKED for, not refused', () => {
  const p = lot.forEntity(['pharma']);
  const r = lot.check({ batch: 'AC2431' }, p, '2026-09-08');
  assert.deepStrictEqual(r.missing, ['expiry']);
  assert.strictEqual(r.refuse, null);
});

it('⚠️⚠️ stock that has already expired is REFUSED, never warned about', () => {
  const p = lot.forEntity(['pharma']);
  const r = lot.check({ batch: 'AC2431', expiry: '2026-08-31' }, p, '2026-09-08');
  assert.ok(r.refuse && r.refuse.indexOf('cannot be received') > 0, 'it let expired medicine through: ' + r.refuse);
});

it('a date still ahead is fine, and so is one with no date at all', () => {
  const p = lot.forEntity(['pharma']);
  assert.strictEqual(lot.check({ batch: 'A', expiry: '2028-03-31' }, p, '2026-09-08').refuse, null);
  assert.strictEqual(lot.check({ batch: 'A', expiry: '2028-03-31' }, p, '2026-09-08').missing.length, 0);
  assert.strictEqual(lot.check({ batch: 'A' }, lot.forEntity(['food']), '2026-09-08').missing.length, 0);
});

it('general trade can never be blocked by this layer', () => {
  const p = lot.forEntity([]);
  const r = lot.check({}, p, '2026-09-08');
  assert.deepStrictEqual(r.missing, []);
  assert.strictEqual(r.refuse, null);
});

console.log('— the barcode already knows —');

it('⭐⭐ a scanned GS1 string gives up its batch and expiry — a pharma counter types nothing', () => {
  const GS = String.fromCharCode(29);
  /* a real GTIN-14: the check digit has to be right, or the parser is correct to leave it out */
  const scanned = '01' + '08906000000014' + '10AC2431' + GS + '17280331';
  const r = gs1.parseElementString(scanned);
  assert.strictEqual(r.batch, 'AC2431');
  assert.strictEqual(r.expiry, '2028-03-31');
  assert.ok(r.gtin, 'the product itself is in there too');
});

it('⚠️ a variable field ends at the separator — without that, a batch swallows the expiry', () => {
  const GS = String.fromCharCode(29);
  const r = gs1.parseElementString('10AB12' + GS + '17280331');
  assert.strictEqual(r.batch, 'AB12');
  assert.strictEqual(r.expiry, '2028-03-31');
});

it('a fixed-length field needs no separator at all', () => {
  const r = gs1.parseElementString('17280331' + '10XYZ');
  assert.strictEqual(r.expiry, '2028-03-31');
  assert.strictEqual(r.batch, 'XYZ');
});

it('the typed form works too, because a barcode that will not read gets keyed in', () => {
  const r = gs1.parseElementString('(10)AC2431(17)280331(21)SER-9');
  assert.strictEqual(r.batch, 'AC2431');
  assert.strictEqual(r.expiry, '2028-03-31');
  assert.strictEqual(r.serial, 'SER-9');
});

it('a two-digit year follows the GS1 rule, not a guess', () => {
  assert.strictEqual(gs1.parseElementString('17490101').expiry, '2049-01-01');
  assert.strictEqual(gs1.parseElementString('17510101').expiry, '1951-01-01', '51 and up is the last century');
});

it('day 00 means end of month, and is read as a real date rather than dropped', () => {
  assert.strictEqual(gs1.parseElementString('17280300').expiry, '2028-03-01');
});

it('⚠️ it never guesses: an ordinary barcode is not an element string', () => {
  assert.strictEqual(gs1.parseElementString('8901234567890'), null);
  assert.strictEqual(gs1.parseElementString(''), null);
  assert.strictEqual(gs1.parseElementString(null), null);
});

it('what it parses is what lotOf will store, unchanged', () => {
  const parsed = gs1.parseElementString('(10)AC2431(17)280331');
  const stored = gs1.lotOf(parsed);
  assert.strictEqual(stored.batch, 'AC2431');
  assert.strictEqual(stored.expiry, '2028-03-31');
  assert.strictEqual(gs1.expiryState(stored, '2026-09-08'), 'fine');
  assert.strictEqual(gs1.expiryState({ batch: 'X', expiry: '2026-09-01' }, '2026-09-08'), 'expired');
});

console.log(pass + ' checks');
