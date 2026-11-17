'use strict';
/**
 * tests/sec101-truth.realstack.cjs - SEC-101 TRUTH, on the LOCAL stack (written, not run on the laptop; S41 runs every *-truth.realstack.cjs).
 *
 * An Aadhaar filed through the real route is stored with a KEYED hash (HMAC under a key derived from VAULT_ENC_KEY), never
 * sha256('AADHAAR:' + digits); filing the same number again is still ONE document with the same hash; a PHONE keeps the plain
 * sha256('PHONE:' + digits) that sign-in by a verified contact recomputes (lib/identity-auth.js). The database is only READ.
 * Values are obviously fake. Needs VAULT_ENC_KEY on the stack (CI sets one); without it the route answers 503 and the cases say so.
 * Run: node tests/sec101-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 18-identity-sign-in-and-access/README
 */
const crypto = require('crypto');
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'sec1x' + (Date.now() % 1e8).toString(36);
const AADHAAR = '000000000000', PHONE = '000000000001';
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

(async () => {
  console.log('\n-- sec101 truth on ' + H.API + ' - run ' + RUN + ' --');
  ok(await j('/health'), 'health');
  const A = await freshShop(RUN, 'Sec101 truth');
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  const hashOf = async (scheme) => {
    const r = await pg.query('SELECT value_hash, value_enc FROM identity_documents WHERE identity_id = $1 AND scheme = $2', [A.entity, scheme]);
    return r.rows;
  };
  const file = (scheme, value) => j('/api/identity/documents/' + scheme, { method: 'PUT', token: A.token, body: { value } });

  await kase('SEC101-1', 'an Aadhaar filed through the route is stored with a hash that is NOT sha256(AADHAAR:digits)', async () => {
    ok(await file('AADHAAR', AADHAAR), 'file aadhaar (is VAULT_ENC_KEY set on the stack?)');
    const rows = await hashOf('AADHAAR');
    expect(rows.length === 1 && /^[0-9a-f]{64}$/.test(rows[0].value_hash), 'one row with a 64-hex hash, saw ' + JSON.stringify(rows.map((r) => r.value_hash)));
    expect(rows[0].value_hash !== sha('AADHAAR:' + AADHAAR), 'the stored hash is the plain sha256 of the Aadhaar number');
    expect(rows[0].value_enc === null, 'the number itself must still not be stored');
  });

  await kase('SEC101-2', 'filing the same Aadhaar again is still one document with the same hash', async () => {
    const before = (await hashOf('AADHAAR'))[0].value_hash;
    ok(await file('AADHAAR', AADHAAR), 'file again');
    const rows = await hashOf('AADHAAR');
    expect(rows.length === 1 && rows[0].value_hash === before, 'rows ' + rows.length + ', hash changed: ' + (rows[0] && rows[0].value_hash !== before));
  });

  await kase('SEC101-3', 'a PHONE keeps the plain sha256(PHONE:digits) that sign-in recomputes', async () => {
    ok(await file('PHONE', PHONE), 'file phone');
    const rows = await hashOf('PHONE');
    expect(rows.length === 1 && rows[0].value_hash === sha('PHONE:' + PHONE), 'phone hash is ' + (rows[0] && rows[0].value_hash));
  });

  await pg.end();
  finish('sec101-truth', process.env.SEC101_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('sec101 truth could not run:', e && e.message); process.exit(2); });
