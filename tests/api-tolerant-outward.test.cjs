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

test('the real scope file lists exactly the API-43 doors and each has a reason', () => {
  const found = register.hardeningScope().tolerantOutward;
  assert.deepStrictEqual(Object.keys(found).sort(), ['POST /api/offers/evaluate', 'POST /api/offers/explain', KEY]);
});

test('scopeProblems: short reason, unknown route and a route with no schema check are named', () => {
  const rows = [{ key: KEY, declared: [], columns: { schema_in: true } }, { key: 'POST /api/x', declared: [], columns: { schema_in: false } }];
  const none = register.scopeProblems({ tolerant_outward: { [KEY]: REASON } }, rows);
  assert.deepStrictEqual(none, []);
  const bad = register.scopeProblems({ tolerant_outward: { [KEY]: 'short', 'POST /api/x': REASON, 'POST /api/nope': REASON } }, rows).join('\n');
  assert.ok(/needs a reason/.test(bad) && /must still check the fields/.test(bad) && /not a route of the app/.test(bad), bad);
});

test('ratchet: the list may not grow, may shrink; first run records', () => {
  const head = (n) => ({ counts: { tolerant_outward: n } });
  const quiet = console.log;
  console.log = () => {};
  try {
    assert.strictEqual(ratchet.checkTolerant({ tolerant_outward: 3 }, head(4), { tolerant_outward: 4 }).length, 1);
    assert.strictEqual(ratchet.checkTolerant({ tolerant_outward: 3 }, head(2), { tolerant_outward: 3 }).length, 0);
    assert.strictEqual(ratchet.checkTolerant({}, head(3), { tolerant_outward: 3 }).length, 0);
    assert.strictEqual(ratchet.checkTolerant({ tolerant_outward: 3 }, head(3), {}).length, 1);
  } finally { console.log = quiet; }
});
