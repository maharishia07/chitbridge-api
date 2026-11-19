#!/usr/bin/env node
// @type: unit
/**
 * CARD 18-identity-sign-in-and-access/sign-in
 * tests/signin-switched-off.test.cjs — lib/signin-switched-off.js (RC-13): MIN unit-per-rule · refusal-path · fail-closed. No DB, no network.
 */
'use strict';
const assert = require('assert');
const { told, words } = require('../lib/signin-switched-off');
let pass = 0;
let fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' ' + String(e.message).slice(0, 200)); } };
const parts = (ok, seen) => ({ actorSecretCheck: async () => ({ ok }), note: (...a) => seen.push(a), methodOf: () => 'pin', textOf: (v) => String(v || ''), problem: (req, res, spec) => { seen.push(spec); } });
const req = { body: { pin: '1234' } };
(async () => {
  await t('unit-per-rule: the words name the business and say the account is switched off', () => assert.ok(/switched off/.test(words('Shop One')) && /Shop One/.test(words('Shop One'))));
  await t('refusal-path: a RIGHT secret is answered 403 ACCOUNT_SWITCHED_OFF and logged, and the door stops', async () => {
    const seen = []; const res = { locals: {} };
    assert.strictEqual(await told(parts(true, seen), req, res, { pin_hash: 'x' }, { display_name: 'Shop One' }), true);
    assert.ok(seen.some((s) => s && s.code === 'ACCOUNT_SWITCHED_OFF' && s.status === 403));
  });
  await t('fail-closed: a WRONG secret is told nothing (false, nothing answered, the one old answer follows)', async () => {
    const seen = []; const res = { locals: {} };
    assert.strictEqual(await told(parts(false, seen), req, res, { pin_hash: 'x' }, { display_name: 'Shop One' }), false);
    assert.strictEqual(seen.length, 0);
  });
  console.log((pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
