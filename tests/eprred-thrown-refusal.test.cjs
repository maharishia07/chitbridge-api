#!/usr/bin/env node
// @type: unit
/**
 * eprred-thrown-refusal.test.cjs — EPRRED (26 Nov 2026): junk-fuzz reds of POST /api/relationships/suppliers (500) and POST /api/integrations/ask/:handle/stock (422 with a body no client could read).
 *
 * OWNS      the proof that (1) a refusal a route THROWS on purpose (textOf: refused + 400 + INVALID_INPUT) reaches the one problem+json through internalSpec / failed(), never a 500 INTERNAL,
 *           while a plain Error still answers the 500 that says nothing of its cause; (2) schemaValidate lists at most 100 failures, so 10 000 wrong items are not an 840 KB refusal.
 * CALLED BY scripts/guards.cjs (tests/ run) · CI. No database, no network.
 * FLOW      textOf(junk) → throw → failed(e, req, label) → problem(req, res, spec) → body; schemaValidate over a 10 000-item array → the 422 body
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const assert = require('assert');
const { textOf } = require('../lib/input-hygiene');
const { problem, build } = require('../lib/problem');
const { failed } = require('../lib/relationships-contract');
const { schemaValidate } = require('../middleware/validate');
const { ASK_OPERATION } = require('../lib/integrations-contract');

const req = { id: 'req-1', path: '/x' };
const thrownBy = (value) => { try { textOf(value, { field: 'supplier_bridge_id' }); } catch (e) { return e; } return null; };

for (const junk of [['a'], { a: 1 }, 5, true]) {
  const err = thrownBy(junk);
  assert(err, 'textOf refuses ' + JSON.stringify(junk));
  const spec = failed(err, req, 'Add supplier failed');
  assert.strictEqual(spec.status, 400, 'a thrown text refusal is 400, not 500');
  assert.strictEqual(spec.code, 'INVALID_INPUT');
  const body = build(req, spec);
  assert.strictEqual(body.status, 400);
  assert.strictEqual(body.field, 'supplier_bridge_id');
  assert(typeof body.title === 'string' && typeof body.type === 'string' && body.detail, 'problem shape');
}
const plain = failed(new Error('relation "x" does not exist'), req, 'Add supplier failed');
assert.strictEqual(plain.status, 500);
assert.strictEqual(plain.code, 'INTERNAL');
assert(!JSON.stringify(build(req, plain)).includes('relation'), 'a 5xx never carries the error text');

/* a 10 000-item junk array: one answer, bounded */
let sent = null;
const res = { locals: {}, status(s) { this.s = s; return this; }, set() {}, getHeader() {}, json(b) { sent = b; return this; } };
schemaValidate(ASK_OPERATION)({ query: {}, params: { handle: 'abc' }, body: { codes: new Array(10000).fill(1) }, id: 'r' }, res, () => assert.fail('must refuse'));
assert.strictEqual(res.s, 422);
assert(sent.errors.length <= 100, 'listed failures are capped, got ' + sent.errors.length);
assert(JSON.stringify(sent).length < 20000, 'the refusal is small');
console.log('eprred-thrown-refusal: ok');
console.log('  13 checks'); /* the guards runner counts "<n> checks" (a guard that counts nothing proved nothing; zeroreds 26 Nov: seven guards ended without it and read FAIL in the full run) */
