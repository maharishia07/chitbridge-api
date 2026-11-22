'use strict';
/**
 * otp-writers-hashed.test.cjs — VERIFY-EL-DB A11: every writer of a staff / owner / connector / claim sign-in code stores the KEYED HASH through
 * employee-code.codeSet (the one hasher, lib/otp.js codeHash), never `otp_code = $n` with the code. No DB, no network. Run: node tests/otp-writers-hashed.test.cjs
 * Mutant: put `otp_code = $1` back in lib/signin-code.js storeCode and the static check below fails.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
process.env.VAULT_ENC_KEY = process.env.VAULT_ENC_KEY || 'a'.repeat(64);
const schema = require('../lib/schema');
const real = schema.hasColumn;
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
let pass = 0; const q = [];
const it = (w, f) => q.push([w, f]);

it('codeSet in hash mode writes the keyed hash and nulls the plain column', async () => {
  schema.hasColumn = async () => true;
  const ec = require('../lib/employee-code'); const { codeHash } = require('../lib/otp');
  const s = await ec.codeSet('11111111-1111-1111-1111-111111111111', '123456', 1);
  assert.strictEqual(s.sql, 'otp_code = NULL, otp_code_hash = $1');
  assert.strictEqual(s.value, codeHash('11111111-1111-1111-1111-111111111111', '123456'));
  assert.notStrictEqual(s.value, '123456');
});
it('codeSet before b781 (no column) keeps the old plain write, one parameter', async () => {
  schema.hasColumn = async () => false;
  const ec = require('../lib/employee-code');
  const s = await ec.codeSet('x', '123456', 2);
  assert.strictEqual(s.sql, 'otp_code = $2'); assert.strictEqual(s.value, '123456');
});
it('no writer outside employee-code puts the code itself into otp_code (static, the four A11 writers)', () => {
  for (const f of ['lib/identity-auth.js', 'lib/signin-code.js', 'routes/connectors.js', 'routes/network-design.js']) {
    const s = read(f);
    assert(!/SET otp_code = \$\d/.test(s), f + ' still writes the plain code');
    assert(s.includes('codeSet('), f + ' does not go through codeSet');
  }
});
(async () => {
  for (const [w, f] of q) { try { await f(); pass++; console.log('  ok  ' + w); } catch (e) { console.log('  FAIL ' + w + '\n      ' + e.message); process.exitCode = 1; } }
  schema.hasColumn = real; console.log(pass + '/' + q.length + ' passed');
})();
