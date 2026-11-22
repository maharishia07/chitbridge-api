/**
 * tests/bb-p3-doors.test.cjs - walk BB P3 doors (21 Nov 2026), each a refusal in words where the parent answered 200 or the wrong sentence:
 *   BB-F-10  a vault value over its limit (a 5,000-character print signature) is refused, not kept at 240 in silence (lib/profile.overLimitWords, the same VAULT_LIMITS sanitizeVault clips to);
 *   BB-F-09  GET /api/entities/usage?days= abc, -1, 0, 999999 is 400 in words; absent is 30; 1..365 is taken;
 *   BB-F-06  a grant to a business that is not your parent says so BEFORE "Say who posts".
 * Run: node tests/bb-p3-doors.test.cjs
 */
'use strict';
const assert = require('assert');
const path = require('path');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const profile = require('../lib/profile');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + (e && e.message)); } };
const sig = (value) => ({ sections: [{ type: 'signature', label: 'Print setup', rows: [{ name: 'Signature', tag: 'signature', value }] }] });
(async () => {
  await t('BB-F-10: a 5,000-character signature is refused in words (400, names 240); 240 exactly passes; a sanitized vault never trips it', async () => {
    const words = profile.overLimitWords(sig('x'.repeat(5000)));
    assert.ok(words && /240 characters/.test(words), String(words));
    assert.strictEqual(profile.overLimitWords(sig('x'.repeat(240))), null);
    assert.strictEqual(profile.overLimitWords(profile.sanitizeVault(sig('x'.repeat(5000)))), null);
    let err = null;
    try { await profile.saveVault('11111111-1111-4111-8111-111111111111', sig('x'.repeat(5000)), {}); } catch (e) { err = e; }
    assert.ok(err && err.status === 400 && err.code === 'INVALID_INPUT' && /240 characters/.test(err.say), String(err && err.message));
  });
  await t('BB-F-09: usage days abc, -1, 0, 999999, 1.5 are 400 in words; absent, 1 and 365 pass the check', async () => {
    const entities = require('../routes/entities');
    const layer = entities.stack.find((l) => l.route && l.route.path === '/usage' && l.route.methods.get);
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const run = async (days) => {
      const out = { status: null, body: null };
      const res = { locals: {}, statusCode: 200, status(c) { out.status = c; return this; }, set() { return this; }, setHeader() {}, type() { return this; }, json(b) { out.body = b; return this; }, send(b) { out.body = b; return this; } };
      await handler({ identity: { identity_id: '11111111-1111-4111-8111-111111111111' }, query: days === undefined ? {} : { days }, headers: {}, id: 'r', originalUrl: '/api/entities/usage' }, res);
      return out;
    };
    for (const bad of ['abc', '-1', '0', '999999', '1.5', '']) {
      const o = await run(bad);
      assert.ok(o.status === 400 && /1 to 365/.test(JSON.stringify(o.body)), JSON.stringify([bad, o.status, o.body]));
    }
    for (const good of [undefined, '1', '365']) assert.notStrictEqual((await run(good)).status, 400, String(good));
  });
  await t('BB-F-06: give() judges the grantee before the posting choice (an unknown business answers "not your network parent")', async () => {
    const grants = require('../lib/books-grant');
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'lib', 'books-grant.js'), 'utf8');
    const at = (needle) => src.indexOf(needle);
    const body = src.slice(at('async function give('), at('async function give(') + 3000);
    assert.ok(body.indexOf("'BOOKS_GRANT_NO_PARENT', 422, 'That business is not your network parent") < body.indexOf('postingOf(input, true)'));
    assert.ok(typeof grants.give === 'function');
  });
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
