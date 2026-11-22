'use strict';
/**
 * tests/sec3-s9-pair-hats.test.cjs - S9 (VERIFY-EL-SECURITY): any signed-in actor could mint a 365-day screen key, and one good claim wiped the wrong-guess count.
 * ATTACK    a cashier on the "act" hat presses Pair and holds a year-long key; a guesser at an address that also has a legitimate screen pairing gets a fresh 8 tries after every good claim.
 * RULE      POST /api/till/pair is for the owner, a manager hat, or a counter key (its own narrow right); a good claim does NOT clear the address's miss count.
 * RUN       node tests/sec3-s9-pair-hats.test.cjs        STANDARD  OWASP ASVS 4.0.3 V4.1.1/V4.1.3 (least privilege) · API5:2023 (function-level authorization)
 * CARD      09-counter/customer-display-promo-screen
 */
const assert = require('assert');
const G = require('./support/route-golden.cjs');
const PSHOP = '22222222-2222-4222-8222-222222222222';
const h = G.harness({ known: { [PSHOP]: 'PSHOP' }, rows: (sql) => (/SELECT display_name FROM identities/.test(sql) ? [{ display_name: 'Anand Stores' }] : []) });
const till = require('../routes/till');
require('../lib/api-keys').mint = async () => ({ key: 'cbk_screen_1' });
const app = h.app('/api/till', till);
const run = (method, url, body, extra) => h.run(app, Object.assign({ method, url, body, identity: { identity_id: PSHOP }, settle: 5 }, extra || {}));
const actor = (hat) => ({ identity: { identity_id: '44444444-4444-4444-8444-444444444444', identity_type: 'actor', parent_entity_id: PSHOP, hat } });
let n = 0, failed = 0;
const it = async (name, fn) => { n++; try { await fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } };
(async () => {
  await it('a cashier on the act hat is refused 403 OWNER_ONLY', async () => {
    const r = await run('POST', '/api/till/pair', {}, actor('act'));
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
    assert.ok(/OWNER_ONLY/.test(JSON.stringify(r.body)));
  });
  await it('audit and mis hats are refused too', async () => {
    for (const hat of ['audit', 'mis']) assert.strictEqual((await run('POST', '/api/till/pair', {}, actor(hat))).status, 403, hat);
  });
  await it('a manager hat and the owner still pair', async () => {
    assert.strictEqual((await run('POST', '/api/till/pair', {}, actor('manager'))).status, 200);
    assert.strictEqual((await run('POST', '/api/till/pair', {}, {})).status, 200);
  });
  await it('a counter key still pairs a screen (its own narrow right)', async () => {
    assert.strictEqual((await run('POST', '/api/till/pair', {}, { identity: { identity_id: PSHOP }, till: { key: { scopes: ['till'], jti: 'c1' } } })).status, 200);
  });
  await it('a good claim does not wipe the wrong-guess count of the address', async () => {
    for (let k = 0; k < 6; k++) await run('POST', '/api/till/pair/claim', { code: 'ZZZZZ' + k }, {});
    const code = (await run('POST', '/api/till/pair', {}, {})).body.code;
    assert.strictEqual((await run('POST', '/api/till/pair/claim', { code }, {})).status, 200);
    let shutAt = 0;
    for (let k = 10; k < 14 && !shutAt; k++) if ((await run('POST', '/api/till/pair/claim', { code: 'ZZZZZ' + k }, {})).status === 429) shutAt = k - 9;
    assert.ok(shutAt > 0 && shutAt <= 3, 'the 6 earlier misses still count: shut within 3 more, shut at ' + shutAt);
  });
  console.log('\n  ' + (n - failed) + ' passed, ' + failed + ' failed · ' + n + ' checks');
  process.exit(failed ? 1 : 0);
})();
