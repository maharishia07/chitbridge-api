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

// ── TIER 1 (review 2026-07-29) — "the declaration must stop lying" ────────────────────────────────────────────
// Each of these reproduced a real defect before the fix. They exist so it cannot come back.

t('T1.1 · an unsupported keyword is REPORTED, and the bad declaration does not govern', () => {
  const r = OI.resolve({ preset: 'form', schema: { properties: { gstin: { type: 'string', pattern: '^[0-9]{15}$' } } } });
  assert.ok(r.errors.some((e) => /pattern/.test(e)), 'declaring `pattern` must be reported, not silently ignored');
  assert.ok(!r.schema.properties.gstin, 'a declaration we cannot enforce must not be honoured');
});
t('T1.1 · an untyped field is rejected — it cannot be validated', () => {
  assert.ok(OI.resolve({ preset: 'form', schema: { properties: { x: {} } } }).errors.some((e) => /"type" is required/.test(e)));
});
t('T1.1 · a required field that is not declared is reported', () => {
  assert.ok(OI.resolve({ preset: 'form', schema: { properties: {}, required: ['ghost'] } }).errors.some((e) => /ghost/.test(e)));
});
t('T1.1 · every declaration the seed scripts write is still VALID', () => {
  const live = [
    { preset: 'form', schema: { properties: { pan: { type: 'string', maxLength: 10 }, assessment_year: { type: 'string', enum: ['2025-26', '2026-27'] },
        income_from_salary: { type: 'number' }, bank_account_ifsc: { type: 'string', maxLength: 11 } },
        required: ['pan', 'assessment_year', 'income_from_salary', 'bank_account_ifsc'] },
      documents: { max: 2, accept: ['application/pdf'], required: true, label: 'Form 16' } },
    { preset: 'form', schema: { properties: { question: { type: 'string', maxLength: 2000 } }, required: ['question'] } },
    { preset: 'cart', pipeline: 'commerce' }, { preset: 'range', pipeline: 'commerce' },
  ];
  live.forEach((d, i) => assert.deepStrictEqual(OI.resolve(d).errors, [], 'seed declaration ' + i + ' must stay valid'));
});

t('T1.2 · forItem KEEPS the catalogue document rule (a required proof must not become optional)', () => {
  const cat = OI.resolve({ preset: 'form', schema: { properties: { a: { type: 'string' } } },
                           documents: { required: true, label: 'Form 16', accept: ['application/pdf'] } });
  const item = OI.forItem(cat, { schema: { properties: { a: { type: 'string' } } } });
  assert.ok(item.documents, 'the document rule was dropped');
  assert.strictEqual(item.documents.required, true);
  assert.strictEqual(OI.validateDocuments([], item.documents, crypto).ok, false, 'a required proof must still be required');
});

t('T3.1 · an item override does NOT resurrect a field the catalogue deleted', () => {
  const cat = OI.resolve({ preset: 'cart', schema: { properties: { quantity: null, ref: { type: 'string' } } } });
  const item = OI.forItem(cat, { schema: { properties: { extra: { type: 'string' } } } });
  assert.ok(!item.schema.properties.quantity, 'the tombstone was lost — merge-patch was applied over a merged document');
  assert.ok(!(item.schema.required || []).includes('quantity'));
});

t('T1.4 · an object or array value is REJECTED, never stringified onto the chit', () => {
  const s = { type: 'object', properties: { note: { type: 'string' } } };
  assert.strictEqual(OI.validate({ note: { a: 1 } }, s).ok, false);
  assert.strictEqual(OI.validate({ note: ['a'] }, s).ok, false);
  assert.ok(!JSON.stringify(OI.validate({ note: { a: 1 } }, s).value).includes('[object Object]'));
});

t('T1.5 · Object.prototype members are not readable off the payload', () => {
  const s = { type: 'object', properties: { constructor: { type: 'string' }, ref: { type: 'string' } }, required: ['constructor'] };
  const r = OI.validate({ ref: 'a' }, s);
  assert.strictEqual(r.ok, false, 'a required field was satisfied without being sent');
  assert.strictEqual(r.value.constructor === undefined || typeof r.value.constructor !== 'string', true);
});

t('T1.6 · document caps accumulate ACROSS the forms of one submission', () => {
  const decl = OI.resolve({ preset: 'form', documents: { max: 5, accept: ['application/pdf'] } }).documents;
  const doc = () => ({ name: 'f.pdf', mime: 'application/pdf', data_base64: Buffer.alloc(64).toString('base64') });
  const budget = { count: 0, bytes: 0 };
  let rejected = false;
  for (let i = 0; i < 4; i++) if (!OI.validateDocuments([doc(), doc()], decl, crypto, budget).ok) rejected = true;
  assert.ok(rejected, `8 documents across 4 forms must breach the ${OI.DOC_MAX_COUNT}-per-submission ceiling`);
});

t('T1.7 · boolean rejects an unrecognised value instead of recording false', () => {
  const s = { type: 'object', properties: { agreed: { type: 'boolean' } } };
  assert.strictEqual(OI.validate({ agreed: 'yes' }, s).ok, false, "'yes' silently became false — a consent never given");
  assert.strictEqual(OI.validate({ agreed: 'true' }, s).value.agreed, true);
  assert.strictEqual(OI.validate({ agreed: 'false' }, s).value.agreed, false);
  assert.strictEqual(OI.validate({ agreed: false }, s).ok, true, 'an explicit false is still a valid answer');
});

t('T1.8 · an empty enum rejects everything (it is a constraint, not the absence of one)', () => {
  const ch = OI.resolve({ preset: 'choice' });
  assert.deepStrictEqual(ch.schema.properties.price.enum, [], 'the choice preset ships an empty enum by design');
  assert.strictEqual(OI.validate({ quantity: 1, price: 99 }, ch.schema).ok, false, 'unbounded is the opposite of fail-closed');
  const bounded = OI.withBounds(ch.schema, 'price', { options: [3200, 3400] });
  assert.strictEqual(OI.validate({ quantity: 1, price: 3400 }, bounded).ok, true);
});

t('T1.9 · resolve() returns a CLONE and PRESETS is frozen', () => {
  assert.notStrictEqual(OI.resolve({ preset: 'cart' }).schema, OI.PRESETS.cart.schema, 'handed out by reference');
  assert.ok(Object.isFrozen(OI.PRESETS.cart.schema), 'the shared source of truth must be immutable');
  const oi = OI.resolve({ preset: 'cart' });
  oi.schema.properties.injected = { type: 'string' };            // must not leak into the next caller
  assert.ok(!OI.resolve({ preset: 'cart' }).schema.properties.injected, 'cross-request contamination');
});

t('numbers reject the values Number() would silently have accepted', () => {
  const s = { type: 'object', properties: { n: { type: 'number' } } };
  // Number(true)===1, Number([])===0, Number(['7'])===7 — all previously became "valid" numbers.
  for (const v of [true, false, [], [7], {}]) assert.strictEqual(OI.validate({ n: v }, s).ok, false, JSON.stringify(v) + ' must not become a number');
  assert.strictEqual(OI.validate({ n: '7.5' }, s).value.n, 7.5, 'a genuine numeric string still works');
  assert.strictEqual(OI.validate({ n: 0 }, s).ok, true, 'zero is a valid number');
  assert.strictEqual(OI.validate({ n: 'abc' }, s).ok, false);
});
t('an empty string means NOT PROVIDED — fine when optional, an error when required', () => {
  assert.strictEqual(OI.validate({ n: '' }, { type: 'object', properties: { n: { type: 'number' } } }).ok, true,
    'an optional field left blank is not a type error');
  const req = { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] };
  assert.strictEqual(OI.validate({ n: '' }, req).ok, false, 'blank must not satisfy a required field');
  assert.strictEqual(OI.validate({ n: '   ' }, req).ok, false, 'whitespace must not satisfy it either');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
