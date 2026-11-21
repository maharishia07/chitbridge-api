#!/usr/bin/env node
// @type: unit
/**
 * tests/lens2-1129.test.cjs — LENS2 (batch 1129) integrity money-01 M2: preparing an action takes a lock on the BODY hash as well as on the ref, so two tabs sending the same journal body under different client_refs cannot both pass the "same content already waiting" check and double-post. No database, no network.
 * OWNS      refuseRepeatedRef takes pg_advisory_xact_lock on store|ref AND on store|body|hash (fails on the parent: only the ref was locked)
 * CALLED BY scripts/guards.cjs · CI
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.DATABASE_URL = '';
const path = require('path');
const assert = require('assert');
const action = require(path.join(__dirname, '..', 'lib', 'books-action'));

const itemCost = require(path.join(__dirname, '..', 'lib', 'item-cost'));
const adopt = require(path.join(__dirname, '..', 'lib', 'adopt'));

(async () => {
  assert.strictEqual(itemCost.costOf({ cost: { value: '' } }), null, "a blank cost is unknown, not 0");
  assert.deepStrictEqual(itemCost.setCost(''), { cost: null }, 'a blank cost clears to unknown');
  assert.strictEqual(itemCost.costOf({ cost: { value: 0 } }).value, 0, 'a real 0 is kept');
  assert.strictEqual(adopt.numOrNull(null), null);
  assert.strictEqual(adopt.numOrNull(''), null, 'a missing supplier cost seeds unknown, not 0');
  assert.strictEqual(adopt.numOrNull('12.5'), 12.5);
  console.log('  ok   blank cost is unknown (item-cost, adopt)');
  const locks = [];
  const handle = { query: async (sql, params) => { if (/pg_advisory_xact_lock/.test(sql)) locks.push(params[0]); return { rows: [] }; } };
  await action.refuseRepeatedRef(handle, 'S1', 'ref-A', 'abc123');
  assert.ok(locks.includes('S1|ref-A'), 'the ref lock is kept');
  assert.ok(locks.some((key) => key.includes('abc123')), 'the body hash is locked too, so a same-body action under another ref waits');
  console.log('  ok   refuseRepeatedRef locks the ref and the body hash');
  console.log('lens2-1129: 2 passed, 0 failed');
})().catch((e) => { console.error('  FAIL ' + (e && e.message)); process.exit(1); });
