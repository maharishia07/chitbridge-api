#!/usr/bin/env node
// @type: contract
/**
 * api-tolerant-outward.test.cjs — API-43: the tolerant_outward list of docs/contracts/api-hardening-scope.json, how the register reads it and how the ratchet holds its length.
 *
 * OWNS      a listed route: strict_input does not apply; a reason under 20 characters counts for nothing; a listed route that no longer checks its fields (schema_in false) or is not a route is a sentence; the list may only get shorter.
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      scope entries → tools/api-register.cjs (hardeningApplies, scopeProblems) · tools/api-ratchet.cjs (checkTolerant) → expected answer
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const register = require('../tools/api-register.cjs');
const ratchet = require('../tools/api-ratchet.cjs');

const KEY = 'POST /api/pricing/price';
const REASON = 'API-43 (Athi 6 Nov, restated 8 Nov): unknown keys ignored until /v2 with notice';
const leaf = { method: 'POST', path: '/api/pricing/price' };
const scopeWith = (list) => Object.assign({ money: new Set(), inbound: new Set(), publicIds: new Set(), platformOnly: new Set() }, { tolerantOutward: list });

test('a listed route: strict_input does not apply; an unlisted one still does', () => {
  assert.strictEqual(register.hardeningApplies(leaf, null, scopeWith({ [KEY]: REASON })).strict_input, false);
  assert.strictEqual(register.hardeningApplies(leaf, null, scopeWith({})).strict_input, true);
});

test('the real scope file lists the API-43 doors and the S33-T doors, each sound', () => {
  const found = register.hardeningScope().tolerantOutward;
  assert.deepStrictEqual(Object.keys(found).sort(), ['PATCH /api/products/:id', 'POST /api/capture/webhook/email', 'POST /api/capture/webhook/whatsapp', 'POST /api/chits/send', 'POST /api/connectors/erp-ingest', 'POST /api/connectors/ingest', 'POST /api/ctp/deliver', 'POST /api/ctp/query', 'POST /api/events/ticket', 'POST /api/governance/conformance', 'POST /api/integrations/heartbeat', 'POST /api/integrations/profile', 'POST /api/offers/evaluate', 'POST /api/offers/explain', KEY, 'POST /api/products/availability/bulk', 'POST /api/testing/results', 'POST /api/testing/results/junit', 'POST /api/till/flags', 'POST /api/till/quick-keys/hide', 'POST /api/till/quick-keys/unhide', 'POST /api/till/reward', 'POST /api/till/reward/claim', 'POST /api/till/stock', 'POST /api/till/stock/bulk', 'PUT /api/testing/cmdb/:ci']);
});

const rows = [{ key: KEY, declared: [], columns: { schema_in: true } }, { key: 'POST /api/x', declared: [], columns: { schema_in: false } }];
const entry = (extra) => Object.assign({ reason: REASON, caller_class: 'keyed_outward', test: 'tests/api-43-pricing-tolerant.test.cjs' }, extra);

test('scopeProblems: a sound entry has none; short reason, bad class, missing or empty test file, unknown route and no schema check are named', () => {
  assert.deepStrictEqual(register.scopeProblems({ tolerant_outward: { [KEY]: entry() } }, rows), []);
  const bad = register.scopeProblems({ tolerant_outward: { [KEY]: entry({ reason: 'short', caller_class: 'someone', test: 'tests/nope.test.cjs' }), 'POST /api/x': entry(), 'POST /api/nope': entry() } }, rows).join('\n');
  assert.ok(/needs a reason/.test(bad) && /caller_class must be one of/.test(bad) && /does not exist/.test(bad) && /must still check the fields/.test(bad) && /not a route of the app/.test(bad), bad);
});

test('scopeProblems: an old string entry, and a test file that never sends zz_unknown, count for nothing', () => {
  assert.match(register.scopeProblems({ tolerant_outward: { [KEY]: REASON } }, rows).join('\n'), /must be { reason, caller_class, test }/);
  assert.match(register.scopeProblems({ tolerant_outward: { [KEY]: entry({ test: 'tests/api-tolerant-outward.test.cjs' }) } }, rows).join('\n').replace('POST /api/pricing/price', 'X'), /does not mention/);
  assert.deepStrictEqual(Object.keys(register.hardeningScope().tolerantOutward).includes(KEY), true);
});

test('an unsound entry does not exempt: the route stays strict; a list past its ceiling is a sentence', () => {
  const found = register.scopeProblems({ tolerant_outward_ceiling: 1, tolerant_outward: { [KEY]: entry(), 'POST /api/x': entry() } }, rows).join('\n');
  assert.match(found, /above its ceiling 1/);
});

test('ratchet: the list is held by its ceiling, not by its length', () => {
  const ceiling = require('../docs/contracts/api-hardening-scope.json').tolerant_outward_ceiling;
  const quiet = console.log;
  console.log = () => {};
  try {
    assert.strictEqual(ratchet.checkTolerant({}, { counts: { tolerant_outward: ceiling + 1 } }).length, 1);
    assert.strictEqual(ratchet.checkTolerant({ tolerant_outward: 3 }, { counts: { tolerant_outward: ceiling } }).length, 0);
  } finally { console.log = quiet; }
});

test('a tolerant door meets only when every known key is typed (knownKeysTyped)', () => {
  const op = (properties) => ({ requestBody: { content: { 'application/json': { schema: { type: 'object', properties } } } } });
  assert.strictEqual(register.knownKeysTyped(op({ a: { type: 'string' }, b: { enum: [1] } })), true);
  assert.strictEqual(register.knownKeysTyped(op({ a: {} })), false);
  assert.strictEqual(register.knownKeysTyped(op({})), true, 'a door that reads no body key has nothing untyped');
  assert.strictEqual(register.knownKeysTyped(null), false, 'a door with no schema check is unchecked, not tolerant');
});

test('the one schema middleware: a known key is validated, an unknown key is accepted and logged by name once (never its value), a closed schema still refuses (API-43, Athi 12 Nov)', () => {
  const { schemaValidate } = require('../middleware/validate');
  const open = schemaValidate({ requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { qty: { type: 'integer' } } } } } } });
  const closed = schemaValidate({ requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { qty: { type: 'integer' } }, additionalProperties: false } } } } });
  const run = (mw, body) => { const out = { next: false, status: 0 }; const res = { status(code) { out.status = code; return this; }, type() { return this; }, set() { return this; }, setHeader() { return this; }, json() { return this; }, send() { return this; }, end() { return this; } }; mw({ method: 'POST', baseUrl: '/api/x', route: { path: '/y' }, body, query: {}, params: {}, id: 'r1', headers: {}, get: () => undefined }, res, () => { out.next = true; }); return out; };
  const lines = []; const realWarn = console.warn; console.warn = (line) => lines.push(String(line));
  try {
    assert.strictEqual(run(open, { qty: 2, zz_stray: 'secret-value' }).next, true, 'an unknown key is accepted');
    assert.strictEqual(run(open, { qty: 2, zz_stray: 'secret-value' }).next, true);
    assert.strictEqual(lines.length, 1, 'named once per process');
    assert.ok(lines[0].includes('unknown_key_accepted') && lines[0].includes('zz_stray') && lines[0].includes('POST /api/x/y') && !lines[0].includes('secret-value'), lines[0]);
    assert.strictEqual(run(open, { qty: 'many' }).next, false, 'a wrong type on a known key is refused');
    assert.strictEqual(run(closed, { qty: 2, zz_stray2: 1 }).next, false, 'a closed schema still refuses');
    assert.strictEqual(lines.length, 1, 'a refused key is not logged as accepted');
  } finally { console.warn = realWarn; }
});
