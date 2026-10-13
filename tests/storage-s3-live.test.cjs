/**
 * storage-s3-live.test.cjs — HX1: lib/storage-object.js against a REAL S3-compatible store (MinIO in deploy/compose.yml, or any bucket).
 * Needs S3_ENDPOINT + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY (+ S3_BUCKET, S3_REGION) — unset, it says so and exits 0 (not an offline
 * guard: deploy/proof.sh runs it against the stack's MinIO). Proves put → get (same bytes) → del → get throws, a key with every awkward
 * character, a 2 MB body, and that a wrong secret is REFUSED by the store (the signature is really checked).
 */
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
if (!(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY)) {
  console.log('  skip: S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY not set (deploy/proof.sh sets them for the stack\'s MinIO)'); process.exit(0);
}
const store = require('../lib/storage-object');
let pass = 0, fail = 0;
async function it(name, fn) { try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('  XX  ' + name + ' — ' + e.message); } }
(async () => {
  assert.strictEqual(store.transport(), 'sigv4');
  const ent = crypto.randomUUID(), key = store.objectKey(ent, crypto.randomUUID());
  const bytes = crypto.randomBytes(2 * 1024 * 1024 + 7);
  await it('put → get gives back the same 2 MB, byte for byte', async () => {
    await store.put(key, bytes, 'application/pdf');
    assert.ok((await store.get(key)).equals(bytes));
  });
  await it('a key with spaces, $, +, (), ! and unicode signs and round-trips', async () => {
    const odd = ent + '/odd/a b$c+d(e)!f*g~ü.bin', b = Buffer.from('odd key');
    await store.put(odd, b, 'text/plain'); assert.ok((await store.get(odd)).equals(b)); await store.del(odd);
  });
  await it('del → get THROWS (never an empty file); a second del is still success', async () => {
    await store.del(key);
    await assert.rejects(() => store.get(key), /get 404/);
    await store.del(key);
  });
  await it('a wrong secret is refused by the store — the signature is really checked', async () => {
    const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'storage-object.js'))}).put('x/y', Buffer.from('n'), 'text/plain').then(() => console.log('STORED'), (e) => console.log(e.message))`],
      { env: Object.assign({}, process.env, { S3_SECRET_ACCESS_KEY: 'not-the-secret' }), encoding: 'utf8' });
    assert.match(r.stdout, /put 403/);
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed  (' + process.env.S3_ENDPOINT + ' bucket ' + store.BUCKET + ')');
  process.exit(fail ? 1 : 0);
})();
