/**
 * tests/signin-provider-door.test.cjs — lib/signin-provider-door.js: who may be signed in after a provider's callback (SEC-112 P1a).
 * OWNS      the proof that every refusal has its sentence and its status (the door never answers a bare code), that a code nobody holds, a code spent or one used from another device
 *           is ONE answer (SSO_HANDOFF 401), that the held row is taken before anything else is looked at (single use), and that no refusal carries a claim value or a token in its words.
 * CALLED BY scripts/guards.cjs · CI. No database: signin-pending.take is stood in.
 * FLOW      decide(code, device) → pending.take → refusal {refusal, status, detail} | an account
 * CARD      18-identity-sign-in-and-access/sign-in
 * MIN unit-per-rule · MIN refusal-path · MIN fail-closed
 */
'use strict';
const assert = require('assert');
const pending = require('../lib/signin-pending');
let held = null, taken = [];
pending.take = async (kind, code) => { taken.push([kind, code]); return held; };
const door = require('../lib/signin-provider-door');
let checks = 0;
const ok = async (name, got, want) => { assert.deepStrictEqual(await got, want, name); checks++; console.log('   ok   ' + name); };
(async () => {
  await ok('every refusal word has a status and a sentence, and no sentence is empty', Object.keys(door.WORDS).every((code) => typeof door.STATUS[code] === 'number' && door.WORDS[code].length > 20) && Object.keys(door.STATUS).length === Object.keys(door.WORDS).length, true);
  await ok('the words are frozen (a route cannot rewrite what a refusal says)', [Object.isFrozen(door.WORDS), Object.isFrozen(door.STATUS)], [true, true]);
  await ok('a refusal carries no claim value: the words name no e-mail and no token', Object.values(door.WORDS).some((text) => /@|token|eyJ/.test(text)), false);
  held = null; taken = [];
  const none = await door.decide('code-1', 'dev-1');
  await ok('a code nobody holds (or spent) is refused 401 SSO_HANDOFF with the sentence, and was taken first', [none.refusal, none.status, none.detail === door.WORDS.SSO_HANDOFF, taken], ['SSO_HANDOFF', 401, true, [['handoff', 'code-1']]]);
  held = { device_id: 'dev-1', provider: 'google', claims: {}, links: [] };
  const other = await door.decide('code-2', 'dev-2');
  await ok('a code used from another device is the same one answer, never a different word that would tell which', [other.refusal, other.status], ['SSO_HANDOFF', 401]);
  held = { device_id: null, provider: 'google' };
  await ok('a row with no device is dead too (fail closed)', (await door.decide('code-3', null)).refusal, 'SSO_HANDOFF');
  console.log('\n' + checks + ' checks');
})().catch((e) => { console.log('   FAIL ' + e.message); process.exit(1); });
