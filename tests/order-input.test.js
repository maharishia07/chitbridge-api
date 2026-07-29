'use strict';
// Regression — the DECLARED INPUT contract (SPEC-negotiation-position, revised).
// Proves the thing Athi asked for: the catalogue declares WHAT DATA it receives, a new kind of input is a data change
// rather than a release, and a forms catalogue works through the same rail. Self-contained: no server, no DB.
// Run:  node tests/order-input.test.js
const assert = require('node:assert');
const OI = require('../lib/order-input');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  \x1b[32mok\x1b[0m  ' + name); pass++; } catch (e) { console.log('  \x1b[31mXX\x1b[0m  ' + name + ' — ' + e.message); fail++; } };

// ── the contract is catalogue-level, and unknown/absent degrades to today's behaviour ──
t('absent declaration → cart/commerce (every existing shop unchanged)', () => {
  const r = OI.resolve(undefined);
  assert.strictEqual(r.preset, 'cart'); assert.strictEqual(r.pipeline, 'commerce');
});
t('unknown preset → cart, never a broken screen', () => {
  assert.strictEqual(OI.resolve({ preset: 'wat' }).preset, 'cart');
});
t('legacy "text" still resolves (to enquiry/payload)', () => {
  const r = OI.resolve({ preset: 'text' });
  assert.strictEqual(r.preset, 'enquiry'); assert.strictEqual(r.pipeline, 'payload');
});

// ── THE PIPELINE SPLIT — the load-bearing distinction ──
t('commerce presets route to commerce; enquiry/form route to payload', () => {
  for (const p of ['cart', 'qty', 'range', 'choice', 'qtyprice']) assert.strictEqual(OI.resolve({ preset: p }).pipeline, 'commerce', p);
  for (const p of ['enquiry', 'form'])                            assert.strictEqual(OI.resolve({ preset: p }).pipeline, 'payload', p);
});

// ── "range, but only a few options" — Athi's case. Must need NO new code. ──
t('choice = range with an enum — a DATA change, not a release', () => {
  const base = OI.resolve({ preset: 'choice' });
  const schema = OI.withBounds(base.schema, 'price', { options: [3200, 3400, 3600] });
  assert.deepStrictEqual(schema.properties.price.enum, [3200, 3400, 3600]);
  assert.strictEqual(OI.validate({ quantity: 2, price: 3400 }, schema).ok, true);
  const bad = OI.validate({ quantity: 2, price: 3300 }, schema);
  assert.strictEqual(bad.ok, false);
  assert.match(bad.errors[0], /must be one of/);
});
t('range band bounds the buyer', () => {
  const s = OI.withBounds(OI.resolve({ preset: 'range' }).schema, 'price', { min: 3200, max: 3600 });
  assert.strictEqual(OI.validate({ quantity: 1, price: 3400 }, s).ok, true);
  assert.match(OI.validate({ quantity: 1, price: 100 },  s).errors.join(), /below the allowed minimum/);
  assert.match(OI.validate({ quantity: 1, price: 9999 }, s).errors.join(), /above the allowed maximum/);
});

// ── A CATALOGUE OF FORMS — the case that proves the design ──
const FORM_CAT = { preset: 'form', schema: { properties: {
  exporter:      { type: 'string', maxLength: 120 },
  hs_code:       { type: 'string', maxLength: 12 },
  gross_weight:  { type: 'number', exclusiveMinimum: 0 },
  incoterm:      { type: 'string', enum: ['FOB', 'CIF', 'EXW'] },
}, required: ['exporter', 'hs_code'] } };
t('a forms catalogue declares its own fields and runs the PAYLOAD pipeline', () => {
  const r = OI.resolve(FORM_CAT);
  assert.strictEqual(r.pipeline, 'payload');
  assert.deepStrictEqual(Object.keys(r.schema.properties).sort(), ['exporter', 'gross_weight', 'hs_code', 'incoterm']);
});
t('a valid form submission passes and is coerced', () => {
  const r = OI.validate({ exporter: 'Acme', hs_code: '7108.13', gross_weight: '12.5', incoterm: 'FOB' }, OI.resolve(FORM_CAT).schema);
  assert.strictEqual(r.ok, true, r.errors.join('; '));
  assert.strictEqual(r.value.gross_weight, 12.5, 'numbers coerced, not left as strings');
});
t('a missing required field is rejected', () => {
  assert.match(OI.validate({ hs_code: '7108.13' }, OI.resolve(FORM_CAT).schema).errors.join(), /"exporter" is required/);
});
t('an undeclared field is REJECTED, never silently carried', () => {
  const r = OI.validate({ exporter: 'A', hs_code: 'x', sneaky_price: 1 }, OI.resolve(FORM_CAT).schema);
  assert.strictEqual(r.ok, false);
  assert.match(r.errors.join(), /"sneaky_price" is not accepted/);
});
t('a form has NO price/quantity — which is exactly why it needs the payload pipeline', () => {
  const s = OI.resolve(FORM_CAT).schema;
  assert.ok(!s.properties.price && !s.properties.quantity);
  assert.match(OI.validate({ exporter: 'A', hs_code: 'x', price: 5 }, s).errors.join(), /"price" is not accepted/);
});

// ── HELPDESK = a one-field form (Athi's (d), no new machinery) ──
t('helpdesk is just a form with one field', () => {
  const r = OI.resolve({ preset: 'form', schema: { properties: { question: { type: 'string', maxLength: 2000 } }, required: ['question'] } });
  assert.strictEqual(r.pipeline, 'payload');
  assert.strictEqual(OI.validate({ question: 'Is this in stock?' }, r.schema).ok, true);
});

// ── per-ITEM override (opt-in) — the catalogue governs unless the item declares ──
t('no item declaration → the CATALOGUE contract governs', () => {
  const cat = OI.resolve({ preset: 'range' });
  assert.strictEqual(OI.forItem(cat, null).preset, 'range');
});
t('an item MAY override the catalogue contract (merge-patch)', () => {
  const cat = OI.resolve({ preset: 'cart' });
  const item = OI.forItem(cat, { preset: 'qtyprice' });
  assert.strictEqual(item.preset, 'qtyprice');
  assert.strictEqual(cat.preset, 'cart', 'the catalogue declaration must not be mutated');
});

// ── the guard: quantity bounds still hold everywhere ──
t('quantity is still bounded (0 < q <= 100000)', () => {
  const s = OI.resolve({ preset: 'cart' }).schema;
  assert.strictEqual(OI.validate({ quantity: 5 }, s).ok, true);
  assert.strictEqual(OI.validate({ quantity: 0 }, s).ok, false);
  assert.strictEqual(OI.validate({ quantity: -1 }, s).ok, false);
  assert.strictEqual(OI.validate({ quantity: 1e9 }, s).ok, false);
});
t('resolve() never mutates the shared PRESETS', () => {
  OI.withBounds(OI.resolve({ preset: 'choice' }).schema, 'price', { options: [1, 2] });
  assert.deepStrictEqual(OI.PRESETS.choice.schema.properties.price.enum, [], 'PRESETS leaked mutation');
});

// ── CARRIED DOCUMENTS — "the line item is the filled form AND its proof" (SPEC-document-carrying phase 1) ──
const crypto = require('node:crypto');
const b64 = (s) => Buffer.from(s).toString('base64');
const pdf = (name, body) => ({ name, mime: 'application/pdf', data_base64: b64(body || name) });

t('docs · a catalogue that declares nothing accepts NO documents (no storefront changes behaviour)', () => {
  const decl = OI.resolve({ preset: 'form' }).documents;
  assert.strictEqual(decl, null);
  const r = OI.validateDocuments([pdf('f.pdf')], decl, crypto);
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /does not accept documents/);
});
t('docs · a declared document is accepted and HASHED (the proof)', () => {
  const decl = OI.resolve({ preset: 'form', documents: { max: 2, accept: ['application/pdf'] } }).documents;
  const r = OI.validateDocuments([pdf('form16.pdf', 'hello')], decl, crypto);
  assert.strictEqual(r.ok, true, r.errors.join('; '));
  assert.strictEqual(r.docs[0].size, 5);
  assert.strictEqual(r.docs[0].sha256, crypto.createHash('sha256').update('hello').digest('hex'), 'sha256 must be of the real bytes');
  assert.ok(Buffer.isBuffer(r.docs[0].buffer));
});
t('docs · a disallowed MIME is rejected before any byte is written', () => {
  const decl = OI.resolve({ preset: 'form', documents: { accept: ['application/pdf'] } }).documents;
  const r = OI.validateDocuments([{ name: 'x.exe', mime: 'application/x-msdownload', data_base64: 'AA==' }], decl, crypto);
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /is not accepted/);
});
t('docs · declared caps are enforced, and cannot exceed the platform ceiling', () => {
  const decl = OI.resolve({ preset: 'form', documents: { max: 2, accept: ['application/pdf'] } }).documents;
  const over = OI.validateDocuments([pdf('a'), pdf('b'), pdf('c')], decl, crypto);
  assert.strictEqual(over.ok, false);
  assert.match(over.errors[0], /At most 2/);
  const greedy = OI.resolve({ preset: 'form', documents: { max: 99, accept: ['application/pdf', 'text/html'] } }).documents;
  assert.strictEqual(greedy.max, OI.DOC_MAX_COUNT, 'a declaration may only be MORE restrictive than the ceiling');
  assert.deepStrictEqual(greedy.accept, ['application/pdf'], 'a declaration cannot widen the MIME allowlist');
});
t('docs · a required document that is missing is rejected', () => {
  const decl = OI.resolve({ preset: 'form', documents: { required: true, label: 'Form 16' } }).documents;
  const r = OI.validateDocuments([], decl, crypto);
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /Form 16 is required/);
});
t('docs · an oversized file is rejected', () => {
  const decl = OI.resolve({ preset: 'form', documents: { accept: ['application/pdf'] } }).documents;
  const big = { name: 'big.pdf', mime: 'application/pdf', data_base64: Buffer.alloc(OI.DOC_MAX_BYTES + 1024).toString('base64') };
  const r = OI.validateDocuments([big], decl, crypto);
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /larger than/);
});
t('docs · an empty file is rejected (an empty proof is not a proof)', () => {
  const decl = OI.resolve({ preset: 'form', documents: { accept: ['application/pdf'] } }).documents;
  const r = OI.validateDocuments([{ name: 'e.pdf', mime: 'application/pdf', data_base64: '' }], decl, crypto);
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /empty file/);
});
t('docs · no documents and none required → fine (documents are optional by default)', () => {
  const decl = OI.resolve({ preset: 'form', documents: { accept: ['application/pdf'] } }).documents;
  assert.strictEqual(OI.validateDocuments([], decl, crypto).ok, true);
  assert.strictEqual(OI.validateDocuments(undefined, decl, crypto).ok, true);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
